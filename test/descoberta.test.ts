import type { IDataObject, ILoadOptionsFunctions, JsonObject } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { estadoDeEscopos, listaDeDescoberta } from '../nodes/FluxoCrm/compartilhado/capacidades';
import {
	classificarFalhaDeDescoberta,
	diagnosticarDescoberta,
	endpointAusente,
	ErroDeDescoberta,
} from '../nodes/FluxoCrm/compartilhado/descoberta';
import { erroDaApi } from '../nodes/FluxoCrm/compartilhado/transporte';

/**
 * O diagnostico da descoberta (`/capabilities`, `/me`, listas).
 *
 * Antes, toda falha virava "confira a conectividade" — inclusive o 404 de uma
 * instancia com API anterior ao `/capabilities`. O que estes testes travam sao
 * os quatro desfechos: (a) 404 so no `/capabilities` segue para o `/me` em
 * silencio; (b) 404 nos dois e "instancia desatualizada", nomeando as rotas;
 * (c) 401 e credencial recusada e 403 e falta de permissao; (d) sem status e,
 * ai sim, conectividade. Erro tipado, com motivo, nunca string vazia.
 */

const BASE = 'https://api-crm.nafluxo.com.br/v1';

type Resposta = { corpo: IDataObject } | { falha: unknown };

/** O que o helper do n8n levanta para uma resposta de erro da API. */
function recusa(status: number, codigo: string): { falha: unknown } {
	return {
		falha: {
			statusCode: status,
			response: { body: { erro: { codigo, mensagem: `mensagem de ${codigo}` } } },
		},
	};
}

/**
 * O `AxiosError` que o transporte do n8n produz para uma resposta de erro.
 *
 * `constructor.name === 'AxiosError'` importa: e por ele que o `NodeApiError`
 * decide ler `response.status` (`n8n-workflow/dist/cjs/errors/node-api.error.js`,
 * l.90-94).
 */
class AxiosError extends Error {
	readonly isAxiosError = true;
	readonly response: { status: number; data: unknown; headers: Record<string, string> };

	constructor(status: number, data: unknown, headers: Record<string, string> = {}) {
		super(`Request failed with status code ${status}`);
		this.name = 'AxiosError';
		this.response = { status, data, headers };
	}
}

/**
 * O erro como ele chega em PRODUCAO.
 *
 * `httpRequestWithAuthentication` levanta sempre `new NodeApiError(node, axiosError)`
 * (n8n-core, `request-helpers/authentication.ts`), e `NodeError` guarda um
 * `Error` em `cause` (`errors/abstract/node.error.js`, l.38-48). O envelope da
 * API fica, portanto, em `cause.response.data` — nunca no primeiro nivel.
 */
function recusaReal(
	status: number,
	codigo: string,
	cabecalhos: Record<string, string> = {},
): { falha: unknown } {
	const axios = new AxiosError(
		status,
		{ erro: { codigo, mensagem: `mensagem de ${codigo}` } },
		cabecalhos,
	);
	return {
		falha: new NodeApiError(
			criarContexto({}).ctx.getNode(),
			axios as unknown as JsonObject,
		),
	};
}

/** O que o helper levanta quando nao ha resposta HTTP nenhuma. */
function semRede(): { falha: unknown } {
	return {
		falha: Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), {
			code: 'ECONNREFUSED',
		}),
	};
}

function contextoDeMe(): Resposta {
	return {
		corpo: {
			organizacao: { id: 'org-1', nome: 'Acme', slug: 'acme' },
			chave: { id: 'k-1', escopos: ['contatos:ler'], limite_por_minuto: 120 },
			ator: {},
			versao: 'v1',
		},
	};
}

function criarContexto(rotas: Record<string, Resposta>): {
	ctx: ILoadOptionsFunctions;
	caminhos: string[];
	avisos: string[];
} {
	const caminhos: string[] = [];
	const avisos: string[] = [];
	const ctx = {
		getNode: () => ({ name: 'Fluxo CRM', type: 'fluxoCrm', typeVersion: 1 }),
		// Chave unica por contexto: os caches sao do processo, chaveados pela
		// impressao da credencial.
		getCredentials: async () => ({
			baseUrl: BASE,
			apiKey: `flx_test_${Math.random().toString(36).slice(2)}`,
		}),
		logger: {
			debug: () => undefined,
			info: () => undefined,
			warn: (mensagem: string) => {
				avisos.push(mensagem);
			},
			error: () => undefined,
		},
		helpers: {
			httpRequestWithAuthentication: async (_credencial: string, requisicao: IDataObject) => {
				const url = String(requisicao.url);
				const caminho = url.startsWith(BASE) ? url.slice(BASE.length) : url;
				caminhos.push(caminho);
				const resposta = rotas[caminho] ?? recusa(404, 'nao_encontrado');
				if ('falha' in resposta) throw resposta.falha;
				return { body: resposta.corpo, statusCode: 200, headers: {} };
			},
		},
	} as unknown as ILoadOptionsFunctions;

	return { ctx, caminhos, avisos };
}

/** O erro como ele chega de verdade: ja embrulhado por `erroDaApi`. */
function embrulhado(bruto: unknown): unknown {
	return erroDaApi(criarContexto({}).ctx, bruto, 'GET /capabilities');
}

describe('classificarFalhaDeDescoberta — pelo status, nunca por suposicao', () => {
	it('404 e endpoint ausente, e a frase cita a versao da API e o prefixo /v1', () => {
		const falha = classificarFalhaDeDescoberta(recusa(404, 'nao_encontrado').falha, '/capabilities');
		expect(falha).toBeInstanceOf(ErroDeDescoberta);
		expect(falha.motivo).toBe('endpoint_ausente');
		expect(falha.status).toBe(404);
		expect(falha.message).toContain('/v1/capabilities (HTTP 404)');
		expect(falha.message).toContain('desatualizada');
		expect(falha.message).not.toMatch(/conectividade/);
	});

	it('401 e credencial recusada, com o codigo que a API devolveu', () => {
		const falha = classificarFalhaDeDescoberta(embrulhado(recusa(401, 'chave_invalida').falha), '/me');
		expect(falha.motivo).toBe('credencial_recusada');
		expect(falha.message).toContain('HTTP 401, chave_invalida');
		expect(falha.message).toContain('/v1/me');
		expect(falha.message).not.toMatch(/conectividade/);
	});

	it('403 e falta de permissao, nao credencial invalida nem rede', () => {
		const falha = classificarFalhaDeDescoberta(
			embrulhado(recusa(403, 'escopo_insuficiente').falha),
			'/me',
		);
		expect(falha.motivo).toBe('sem_permissao');
		expect(falha.message).toContain('HTTP 403, escopo_insuficiente');
		expect(falha.message).toContain('permissao');
	});

	it('sem status nenhum e conectividade, e a frase diz o que a rede respondeu', () => {
		const falha = classificarFalhaDeDescoberta(embrulhado(semRede().falha), '/capabilities');
		expect(falha.motivo).toBe('conectividade');
		expect(falha.status).toBeUndefined();
		expect(falha.message).toContain('ECONNREFUSED');
		expect(falha.message).toContain('conectividade');
	});

	it('outro status e resposta inesperada, com o numero — nada e adivinhado', () => {
		const falha = classificarFalhaDeDescoberta(recusa(502, '').falha, '/usuarios');
		expect(falha.motivo).toBe('resposta_inesperada');
		expect(falha.message).toContain('HTTP 502');
		expect(falha.message).not.toMatch(/conectividade|desatualizada|recusada/);
	});

	it('429 e resposta inesperada, e a frase diz que o limite e POR CHAVE — nao "do lado do CRM"', () => {
		const falha = classificarFalhaDeDescoberta(recusa(429, 'limite_excedido').falha, '/usuarios');
		expect(falha.motivo).toBe('resposta_inesperada');
		expect(falha.status).toBe(429);
		expect(falha.message).toContain('POR CHAVE');
		expect(falha.message).not.toMatch(/do lado do CRM/);
	});

	it('o erro REAL do n8n (NodeApiError com cause AxiosError) e classificado igual ao cru', () => {
		const casos: Array<[number, string, string]> = [
			[404, 'nao_encontrado', 'endpoint_ausente'],
			[401, 'chave_invalida', 'credencial_recusada'],
			[403, 'escopo_insuficiente', 'sem_permissao'],
			[500, 'erro_interno', 'resposta_inesperada'],
		];

		for (const [status, codigo, motivo] of casos) {
			const daProducao = classificarFalhaDeDescoberta(recusaReal(status, codigo).falha, '/me');
			expect(daProducao.motivo, `${status}`).toBe(motivo);
			expect(daProducao.status, `${status}`).toBe(status);
			// O codigo da API tem de sobreviver ao embrulho, senao a frase perde o
			// que o servidor disse e vira suposicao deste node.
			if (status !== 404) expect(daProducao.message, `${status}`).toContain(codigo);
		}
	});

	it('nenhuma frase e vazia, e o erro ja tipado passa intacto', () => {
		for (const bruto of [recusa(404, 'x').falha, recusa(401, 'x').falha, semRede().falha, {}, null]) {
			expect(classificarFalhaDeDescoberta(bruto, '/me').message.trim()).not.toBe('');
		}
		const pronto = endpointAusente('/me');
		expect(classificarFalhaDeDescoberta(pronto, '/outra')).toBe(pronto);
	});
});

describe('erroDaApi — a descricao por codigo tem de rodar tambem no erro real', () => {
	const ctx = criarContexto({}).ctx;

	it('escava o envelope de dentro do NodeApiError: o switch por codigo volta a rodar', () => {
		// A forma CRUA (a dos testes e dos helpers puros) sempre funcionou.
		const doCru = erroDaApi(ctx, recusa(403, 'escopo_insuficiente').falha, 'GET /usuarios');
		expect(doCru.description).toContain('escopo exigido');

		// A forma REAL (a que chega em execucao) devolvia o `NodeApiError` intacto
		// e nunca chegava ao `switch`: a descricao era a generica do n8n.
		const daProducao = erroDaApi(ctx, recusaReal(403, 'escopo_insuficiente').falha, 'GET /usuarios');
		expect(daProducao.description).toContain('escopo exigido');
		expect(daProducao.description).toContain('Configuracoes › Integracoes');
		expect(daProducao.httpCode).toBe('403');
		expect(daProducao.message).toContain('GET /usuarios');
	});

	it('cada codigo do switch chega a sua descricao a partir do erro real', () => {
		const esperado: Array<[number, string, RegExp]> = [
			[401, 'chave_invalida', /chave de API foi recusada/],
			[402, 'assinatura_inativa', /assinatura da organizacao esta inativa/],
			[403, 'ip_nao_permitido', /lista permitida/],
			[404, 'nao_encontrado', /UUID malformado/],
			[409, 'idempotencia_conflito', /Idempotency-Key/],
			[500, 'erro_interno', /erro interno/],
		];

		for (const [status, codigo, frase] of esperado) {
			const erro = erroDaApi(ctx, recusaReal(status, codigo).falha, 'GET /x');
			expect(erro.description, codigo).toMatch(frase);
			expect(erro.httpCode, codigo).toBe(String(status));
		}
	});

	it('o Retry-After do 429 sobrevive ao embrulho — e some quando o servidor nao o manda', () => {
		const comCabecalho = erroDaApi(
			ctx,
			recusaReal(429, 'limite_excedido', { 'retry-after': '30' }).falha,
			'GET /x',
		);
		expect(comCabecalho.description).toContain('30');
		expect(comCabecalho.description).toContain('Retry-After');

		// Sem o cabecalho o node NAO inventa um numero.
		const sem = erroDaApi(ctx, recusaReal(429, 'limite_excedido').falha, 'GET /x');
		expect(sem.description).toContain('120 por chave');
		expect(sem.description).not.toMatch(/Retry-After/);
	});

	it('NodeApiError sem cause nem errorResponse passa intacto: nao ha envelope para escavar', () => {
		// `NodeError` so guarda `errorResponse` quando o payload e TRUTHY
		// (`abstract/node.error.js` + `abstract/execution-base.error.js`), entao um
		// payload falsy produz um erro sem nada por baixo. Reconstruir a partir do
		// nada trocaria a descricao que ele ja tem por um generico deste node.
		const orfao = new NodeApiError(ctx.getNode(), 0 as unknown as JsonObject, {
			message: 'mensagem propria',
			description: 'descricao propria',
		});
		expect((orfao as unknown as { cause?: unknown }).cause).toBeUndefined();
		expect(orfao.errorResponse).toBeUndefined();
		expect(erroDaApi(ctx, orfao, 'GET /x')).toBe(orfao);
	});

	it('o envelope de dentro de um errorResponse (payload nao-Error) tambem e escavado', () => {
		// Nem todo helper do n8n embrulha um `AxiosError`: quando o payload nao e
		// um `Error`, ele vai para `errorResponse` em vez de `cause`.
		const embrulho = new NodeApiError(ctx.getNode(), {
			statusCode: 403,
			response: { body: { erro: { codigo: 'ip_nao_permitido', mensagem: 'ip' } } },
		} as unknown as JsonObject);

		const traduzido = erroDaApi(ctx, embrulho, 'GET /x');
		expect(traduzido.description).toContain('lista permitida');
		expect(traduzido.httpCode).toBe('403');
	});
});

describe('diagnosticarDescoberta — mais de uma rota falhou', () => {
	it('404 nas duas: instancia desatualizada, com a frase completa', () => {
		const diagnostico = diagnosticarDescoberta([endpointAusente('/capabilities'), endpointAusente('/me')]);
		expect(diagnostico.motivo).toBe('instancia_desatualizada');
		expect(diagnostico.rotas).toEqual(['/capabilities', '/me']);
		expect(diagnostico.message).toBe(
			'Esta instancia do Fluxo CRM esta desatualizada: a API nao expoe /v1/capabilities nem /v1/me. Atualize a API do CRM.',
		);
	});

	it('um 404 so mantem a frase da rota, que cita a URL base como causa possivel', () => {
		const unico = endpointAusente('/etiquetas');
		expect(diagnosticarDescoberta([unico])).toBe(unico);
	});

	it('a falha mais especifica vence: credencial > permissao > rede > inesperada > 404', () => {
		const ausente = endpointAusente('/capabilities');
		const semPermissao = classificarFalhaDeDescoberta(recusa(403, 'escopo_insuficiente').falha, '/me');
		const recusada = classificarFalhaDeDescoberta(recusa(401, 'chave_invalida').falha, '/me');
		const rede = classificarFalhaDeDescoberta(semRede().falha, '/me');

		expect(diagnosticarDescoberta([ausente, semPermissao]).motivo).toBe('sem_permissao');
		expect(diagnosticarDescoberta([ausente, rede]).motivo).toBe('conectividade');
		expect(diagnosticarDescoberta([recusada, semPermissao]).motivo).toBe('credencial_recusada');
		expect(diagnosticarDescoberta([rede, recusada]).motivo).toBe('credencial_recusada');
	});
});

describe('estadoDeEscopos — o que o log diz quando a descoberta falha', () => {
	it('(a) 404 no /capabilities segue para o /me em silencio: escopos conhecidos, sem aviso', async () => {
		const { ctx, caminhos, avisos } = criarContexto({
			'/capabilities': recusa(404, 'nao_encontrado'),
			'/me': contextoDeMe(),
		});

		const estado = await estadoDeEscopos(ctx);
		expect(estado).toMatchObject({ conhecidos: true, escopos: ['contatos:ler'], origem: 'me' });
		expect(caminhos).toEqual(['/capabilities', '/me']);
		expect(avisos).toEqual([]);
	});

	it('(b) 404 nos dois: fail-open, e o aviso diz "instancia desatualizada" nomeando as rotas', async () => {
		const { ctx, avisos } = criarContexto({
			'/capabilities': recusa(404, 'nao_encontrado'),
			'/me': recusa(404, 'nao_encontrado'),
		});

		const estado = await estadoDeEscopos(ctx);
		expect(estado.conhecidos).toBe(false);
		expect(avisos).toHaveLength(1);
		expect(avisos[0]).toContain('nenhuma operacao sera bloqueada');
		expect(avisos[0]).toContain(
			'Esta instancia do Fluxo CRM esta desatualizada: a API nao expoe /v1/capabilities nem /v1/me. Atualize a API do CRM.',
		);
		expect(avisos[0]).not.toMatch(/conectividade/);
	});

	it('(c) 401: credencial recusada; 404 + 403: sem permissao — nunca "conectividade"', async () => {
		const recusada = criarContexto({
			'/capabilities': recusa(401, 'chave_invalida'),
			'/me': recusa(401, 'chave_invalida'),
		});
		expect((await estadoDeEscopos(recusada.ctx)).conhecidos).toBe(false);
		expect(recusada.avisos[0]).toContain('HTTP 401, chave_invalida');
		expect(recusada.avisos[0]).toContain('recusada');
		expect(recusada.avisos[0]).not.toMatch(/conectividade|desatualizada/);

		const semPermissao = criarContexto({
			'/capabilities': recusa(404, 'nao_encontrado'),
			'/me': recusa(403, 'escopo_insuficiente'),
		});
		expect((await estadoDeEscopos(semPermissao.ctx)).conhecidos).toBe(false);
		expect(semPermissao.avisos[0]).toContain('HTTP 403, escopo_insuficiente');
		expect(semPermissao.avisos[0]).toContain('permissao');
		expect(semPermissao.avisos[0]).not.toMatch(/conectividade|desatualizada/);
	});

	it('(c2) 5xx no /capabilities + 404 no /me: o aviso cita o 500, nao "instancia desatualizada"', async () => {
		const { ctx, avisos } = criarContexto({
			'/capabilities': recusa(500, 'erro_interno'),
			'/me': recusa(404, 'nao_encontrado'),
		});

		expect((await estadoDeEscopos(ctx)).conhecidos).toBe(false);
		expect(avisos[0]).toContain('HTTP 500');
		expect(avisos[0]).not.toMatch(/desatualizada/);
	});

	it('(d) sem resposta da rede: ai sim conectividade, com o que a rede disse', async () => {
		const { ctx, avisos } = criarContexto({ '/capabilities': semRede(), '/me': semRede() });

		expect((await estadoDeEscopos(ctx)).conhecidos).toBe(false);
		expect(avisos[0]).toContain('ECONNREFUSED');
		expect(avisos[0]).toContain('conectividade');
		expect(avisos[0]).not.toMatch(/desatualizada|recusada/);
	});
});

describe('listaDeDescoberta — o dropdown recebe o motivo, nao a frase generica', () => {
	it('(a) 404 no /capabilities cai para o endpoint individual em silencio', async () => {
		const { ctx, caminhos } = criarContexto({
			'/capabilities': recusa(404, 'nao_encontrado'),
			'/usuarios': { corpo: { dados: [{ id: 'u-1', nome: 'Ana' }] } },
		});

		const lista = await listaDeDescoberta(ctx, 'usuarios');
		expect(lista).toEqual([{ id: 'u-1', nome: 'Ana' }]);
		expect(caminhos).toEqual(['/capabilities', '/usuarios']);
	});

	it('(b) 404 nos dois: "instancia desatualizada", nomeando /capabilities e a lista', async () => {
		const { ctx } = criarContexto({
			'/capabilities': recusa(404, 'nao_encontrado'),
			'/usuarios': recusa(404, 'nao_encontrado'),
		});

		await expect(listaDeDescoberta(ctx, 'usuarios')).rejects.toMatchObject({
			name: 'ErroDeDescoberta',
			motivo: 'instancia_desatualizada',
			message: expect.stringContaining('nao expoe /v1/capabilities nem /v1/usuarios'),
		});
	});

	it('(c) 401 no /capabilities sobe tipado, sem nem tentar o endpoint individual', async () => {
		const { ctx, caminhos } = criarContexto({ '/capabilities': recusa(401, 'chave_invalida') });

		await expect(listaDeDescoberta(ctx, 'pipelines')).rejects.toMatchObject({
			motivo: 'credencial_recusada',
			message: expect.stringContaining('HTTP 401, chave_invalida'),
		});
		expect(caminhos).toEqual(['/capabilities']);
	});

	it('(d) rede fora sobe como conectividade, e NAO fica memorizada como "sem endpoint"', async () => {
		const { ctx, caminhos } = criarContexto({ '/capabilities': semRede() });

		await expect(listaDeDescoberta(ctx, 'equipes')).rejects.toMatchObject({
			motivo: 'conectividade',
			message: expect.stringContaining('ECONNREFUSED'),
		});
		// Segunda tentativa refaz a requisicao: falha de rede nao vira `null` por um minuto.
		await expect(listaDeDescoberta(ctx, 'equipes')).rejects.toMatchObject({ motivo: 'conectividade' });
		expect(caminhos).toEqual(['/capabilities', '/capabilities']);
	});

	it('(e) 5xx no aggregate cai para o individual e nao memoriza', async () => {
		const { ctx, caminhos } = criarContexto({
			'/capabilities': recusa(500, 'erro_interno'),
			'/usuarios': { corpo: { dados: [{ id: 'u-1', nome: 'Ana' }] } },
		});

		// O agregado existe por ECONOMIA de requisicoes; um 500 passageiro nele
		// nao pode derrubar os cinco dropdowns que tem rota propria.
		expect(await listaDeDescoberta(ctx, 'usuarios')).toEqual([{ id: 'u-1', nome: 'Ana' }]);
		// E o 500 nao vira `null` memorizado por um minuto: a segunda abertura do
		// painel tenta o agregado de novo.
		expect(await listaDeDescoberta(ctx, 'usuarios')).toEqual([{ id: 'u-1', nome: 'Ana' }]);
		expect(caminhos).toEqual(['/capabilities', '/usuarios', '/capabilities', '/usuarios']);
	});

	it('(f) 5xx no aggregate + 404 no individual NAO vira "instancia desatualizada"', async () => {
		const { ctx } = criarContexto({
			'/capabilities': recusa(503, ''),
			'/etiquetas': recusa(404, 'nao_encontrado'),
		});

		// O 500 nao e prova de que a instancia nao tem `/capabilities`: acusar
		// "desatualizada" mandaria o usuario atualizar um servidor que so caiu.
		await expect(listaDeDescoberta(ctx, 'etiquetas')).rejects.toMatchObject({
			motivo: 'endpoint_ausente',
			rotas: ['/etiquetas'],
		});
	});

	it('429 no aggregate tambem cai para o individual', async () => {
		const { ctx, caminhos } = criarContexto({
			'/capabilities': recusa(429, 'limite_excedido'),
			'/pipelines': { corpo: { dados: [{ id: 'p-1' }] } },
		});

		expect(await listaDeDescoberta(ctx, 'pipelines')).toEqual([{ id: 'p-1' }]);
		expect(caminhos).toEqual(['/capabilities', '/pipelines']);
	});

	it('403 no endpoint individual continua subindo com a descricao do codigo da API', async () => {
		const { ctx } = criarContexto({
			'/capabilities': recusa(404, 'nao_encontrado'),
			'/etiquetas': recusa(403, 'escopo_insuficiente'),
		});

		await expect(listaDeDescoberta(ctx, 'etiquetas')).rejects.toMatchObject({
			description: expect.stringContaining('escopo'),
			httpCode: '403',
		});
	});
});

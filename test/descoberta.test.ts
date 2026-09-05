import type { IDataObject, ILoadOptionsFunctions } from 'n8n-workflow';
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

	it('nenhuma frase e vazia, e o erro ja tipado passa intacto', () => {
		for (const bruto of [recusa(404, 'x').falha, recusa(401, 'x').falha, semRede().falha, {}, null]) {
			expect(classificarFalhaDeDescoberta(bruto, '/me').message.trim()).not.toBe('');
		}
		const pronto = endpointAusente('/me');
		expect(classificarFalhaDeDescoberta(pronto, '/outra')).toBe(pronto);
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

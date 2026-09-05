import type {
	IDataObject,
	IHookFunctions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	IWebhookFunctions,
} from 'n8n-workflow';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MARCA_DE_CADEADO } from '../nodes/FluxoCrm/compartilhado/catalogo';
import {
	cacheDeEscopos,
	ESTADO_DESCONHECIDO,
	impressaoDaCredencial,
	montarCarimbo,
} from '../nodes/FluxoCrm/compartilhado/escopos';
import { FluxoCrmTrigger } from '../nodes/FluxoCrmTrigger/FluxoCrmTrigger.node';
import { CHAVE_DO_ID, CHAVE_DO_SEGREDO } from '../nodes/FluxoCrmTrigger/estado';

const BASE = 'https://api-crm.nafluxo.com.br/v1';
const SEGREDO = `whsec_${'cd'.repeat(32)}`;
const ID_DA_ASSINATURA = '7f000000-0000-4000-8000-00000000abcd';

const node = new FluxoCrmTrigger();
const ciclo = node.webhookMethods.default;

interface Chamada {
	metodo: string;
	caminho: string;
	corpo?: IDataObject;
}

interface Resposta {
	body?: unknown;
	statusCode?: number;
}

interface Falha {
	status: number;
	codigo: string;
}

type Manipulador = (chamada: Chamada) => Resposta | Falha;

function ehFalha(saida: Resposta | Falha): saida is Falha {
	return typeof (saida as Falha).codigo === 'string';
}

interface OpcoesDoContexto {
	parametros?: Record<string, unknown>;
	estado?: IDataObject;
	/** `null` simula "nao foi possivel descobrir os escopos" — o estado fail-open. */
	escopos?: string[] | null;
	urlDoWebhook?: string;
	responder?: Manipulador;
}

interface ContextoFalso {
	ctx: IHookFunctions;
	estado: IDataObject;
	chamadas: Chamada[];
	avisos: string[];
}

/**
 * Um `IHookFunctions` de mentira, com o suficiente para o ciclo de vida rodar.
 *
 * A chave de API e unica por contexto de proposito: o cache de escopos e do
 * processo e chaveado pela impressao digital da credencial, entao dois testes
 * com a mesma chave e escopos diferentes se contaminariam.
 */
function criarContextoDeHook(opcoes: OpcoesDoContexto = {}): ContextoFalso {
	const apiKey = `flx_test_${Math.random().toString(36).slice(2)}`;
	const estado: IDataObject = opcoes.estado ?? {};
	const chamadas: Chamada[] = [];
	const avisos: string[] = [];
	const parametros = opcoes.parametros ?? {};

	const escopos = opcoes.escopos === undefined ? ['*'] : opcoes.escopos;
	const credenciais = {
		baseUrl: BASE,
		apiKey,
		// `null` grava o carimbo de "desconhecido", que `lerCarimbo` descarta: a
		// resolucao cai para /capabilities e /me, os dois respondem em formato
		// inesperado no falso, e o node entra em fail-open de verdade.
		escoposDaChave:
			escopos === null
				? montarCarimbo(impressaoDaCredencial(BASE, apiKey), ESTADO_DESCONHECIDO)
				: montarCarimbo(impressaoDaCredencial(BASE, apiKey), {
						conhecidos: true,
						escopos,
						origem: 'credencial',
					}),
	};

	const registrar = (mensagem: string): void => {
		avisos.push(mensagem);
	};

	const ctx = {
		getCredentials: async () => credenciais,
		getNode: () => ({ name: 'Fluxo CRM Trigger', type: 'fluxoCrmTrigger', typeVersion: 1 }),
		getWorkflow: () => ({ id: 'wf-42', name: 'Sincroniza CRM', active: true }),
		getWorkflowStaticData: () => estado,
		getNodeWebhookUrl: () =>
			opcoes.urlDoWebhook ?? 'https://n8n.exemplo.com.br/webhook/abc/webhook',
		getNodeParameter: (nome: string, padrao?: unknown) =>
			nome in parametros ? parametros[nome] : padrao,
		logger: { debug: registrar, info: registrar, warn: registrar, error: registrar },
		helpers: {
			httpRequestWithAuthentication: async (_credencial: string, requisicao: IDataObject) => {
				const url = String(requisicao.url);
				const chamada: Chamada = {
					metodo: String(requisicao.method),
					caminho: url.startsWith(BASE) ? url.slice(BASE.length) : url,
					corpo: requisicao.body as IDataObject | undefined,
				};
				chamadas.push(chamada);

				const saida = opcoes.responder?.(chamada) ?? { body: {}, statusCode: 200 };
				if (ehFalha(saida)) {
					throw {
						statusCode: saida.status,
						response: {
							status: saida.status,
							body: { erro: { codigo: saida.codigo, mensagem: 'recusado no teste' } },
						},
					};
				}
				return { body: saida.body ?? {}, statusCode: saida.statusCode ?? 200, headers: {} };
			},
		},
	} as unknown as IHookFunctions;

	return { ctx, estado, chamadas, avisos };
}

beforeEach(() => {
	cacheDeEscopos.limpar();
});

describe('loadOptions — o caminho de verdade, do catalogo ate a resposta REST', () => {
	it('carregarModos entrega o modo bloqueado com disabled, cadeado e motivo intactos', async () => {
		// Este e o unico teste que passa pelo metodo registrado no node: se algum
		// dia o node reconstruir a opcao (um `.map` de rotulo, por exemplo), o
		// `disabled` cairia aqui e em lugar nenhum mais.
		const { ctx } = criarContextoDeHook({ escopos: ['contatos:ler'] });

		const opcoes = await node.methods.loadOptions.carregarModos.call(
			ctx as unknown as ILoadOptionsFunctions,
		);
		// O JSON e o que o backend do n8n devolve ao front pela REST.
		const viajadas = JSON.parse(JSON.stringify(opcoes)) as INodePropertyOptions[];
		const webhook = viajadas.find((opcao) => opcao.value === 'webhook')!;

		expect(webhook.disabled).toBe(true);
		expect(webhook.name.startsWith(MARCA_DE_CADEADO)).toBe(true);
		expect(webhook.description).toContain('webhooks:escrever');

		const polling = viajadas.find((opcao) => opcao.value === 'polling')!;
		expect(polling.disabled).toBeUndefined();
		expect(polling.name).not.toContain(MARCA_DE_CADEADO);
	});
});

describe('checkExists', () => {
	it('nao mexe em nada quando o node esta em modo sondagem', async () => {
		const { ctx, chamadas } = criarContextoDeHook({ parametros: { modo: 'polling' } });
		await expect(ciclo.checkExists.call(ctx)).resolves.toBe(true);
		expect(chamadas).toHaveLength(0);
	});

	it('devolve false sem chamar a API quando nunca houve assinatura', async () => {
		const { ctx, chamadas } = criarContextoDeHook({ parametros: { modo: 'webhook' } });
		await expect(ciclo.checkExists.call(ctx)).resolves.toBe(false);
		expect(chamadas).toHaveLength(0);
	});

	it('confirma a assinatura existente sem reescrever nada', async () => {
		const { ctx, estado, chamadas } = criarContextoDeHook({
			parametros: { modo: 'webhook', eventos: ['contato.criado'] },
			estado: { [CHAVE_DO_ID]: ID_DA_ASSINATURA, [CHAVE_DO_SEGREDO]: SEGREDO },
			responder: () => ({
				body: { id: ID_DA_ASSINATURA, eventos: ['contato.criado'], ativo: true },
			}),
		});

		await expect(ciclo.checkExists.call(ctx)).resolves.toBe(true);
		expect(chamadas.map((c) => `${c.metodo} ${c.caminho}`)).toEqual([
			`GET /webhooks/${ID_DA_ASSINATURA}`,
		]);
		expect(estado[CHAVE_DO_ID]).toBe(ID_DA_ASSINATURA);
		expect(estado[CHAVE_DO_SEGREDO]).toBe(SEGREDO);
	});

	it('🔴 no 404 apaga webhookId E webhookSecret do estado duravel', async () => {
		// Sem esta limpeza a ativacao entra em laco: `create` grava um id novo por
		// cima, e na ativacao seguinte `checkExists` acha o id velho de novo.
		const { ctx, estado } = criarContextoDeHook({
			parametros: { modo: 'webhook' },
			estado: { [CHAVE_DO_ID]: ID_DA_ASSINATURA, [CHAVE_DO_SEGREDO]: SEGREDO, outra: 'preservar' },
			responder: () => ({ status: 404, codigo: 'nao_encontrado' }),
		});

		await expect(ciclo.checkExists.call(ctx)).resolves.toBe(false);
		expect(estado).not.toHaveProperty(CHAVE_DO_ID);
		expect(estado).not.toHaveProperty(CHAVE_DO_SEGREDO);
		// O objeto e o MESMO — mutado no lugar, nunca substituido, senao o n8n
		// nao enxerga a mudanca no diff que decide persistir.
		expect(estado.outra).toBe('preservar');
	});

	it('levanta (e nao limpa) quando a API falha por outro motivo', async () => {
		const { ctx, estado } = criarContextoDeHook({
			parametros: { modo: 'webhook' },
			estado: { [CHAVE_DO_ID]: ID_DA_ASSINATURA, [CHAVE_DO_SEGREDO]: SEGREDO },
			responder: () => ({ status: 500, codigo: 'erro_interno' }),
		});

		await expect(ciclo.checkExists.call(ctx)).rejects.toThrow();
		expect(estado[CHAVE_DO_ID]).toBe(ID_DA_ASSINATURA);
	});

	it('recria a assinatura quando o segredo se perdeu — ele nao e recuperavel', async () => {
		const { ctx, estado, chamadas } = criarContextoDeHook({
			parametros: { modo: 'webhook' },
			estado: { [CHAVE_DO_ID]: ID_DA_ASSINATURA },
			responder: () => ({ body: { id: ID_DA_ASSINATURA, eventos: ['*'], ativo: true } }),
		});

		await expect(ciclo.checkExists.call(ctx)).resolves.toBe(false);
		// A assinatura orfa e removida no servidor, para nao ficar entregando em
		// paralelo com a que `create` vai criar em seguida.
		expect(chamadas.map((c) => c.metodo)).toEqual(['GET', 'DELETE']);
		expect(estado).not.toHaveProperty(CHAVE_DO_ID);
	});

	it('ajusta por PATCH quando a lista de eventos mudou, em vez de criar outra', async () => {
		const { ctx, chamadas } = criarContextoDeHook({
			parametros: { modo: 'webhook', eventos: ['contato.criado', 'negocio.ganho'] },
			estado: { [CHAVE_DO_ID]: ID_DA_ASSINATURA, [CHAVE_DO_SEGREDO]: SEGREDO },
			responder: (chamada) =>
				chamada.metodo === 'GET'
					? { body: { id: ID_DA_ASSINATURA, eventos: ['contato.criado'], ativo: true } }
					: { body: { id: ID_DA_ASSINATURA } },
		});

		await expect(ciclo.checkExists.call(ctx)).resolves.toBe(true);
		const patch = chamadas.find((c) => c.metodo === 'PATCH');
		expect(patch?.corpo?.eventos).toEqual(['contato.criado', 'negocio.ganho']);
	});

	it('reativa a assinatura desligada pelo circuit breaker', async () => {
		const { ctx, chamadas } = criarContextoDeHook({
			parametros: { modo: 'webhook', eventos: ['contato.criado'] },
			estado: { [CHAVE_DO_ID]: ID_DA_ASSINATURA, [CHAVE_DO_SEGREDO]: SEGREDO },
			responder: (chamada) =>
				chamada.metodo === 'GET'
					? { body: { id: ID_DA_ASSINATURA, eventos: ['contato.criado'], ativo: false } }
					: { body: { id: ID_DA_ASSINATURA } },
		});

		await expect(ciclo.checkExists.call(ctx)).resolves.toBe(true);
		expect(chamadas.find((c) => c.metodo === 'PATCH')?.corpo).toEqual({ ativo: true });
	});

	it('a mesma lista de eventos em outra ordem nao gera PATCH', async () => {
		const { ctx, chamadas } = criarContextoDeHook({
			parametros: { modo: 'webhook', eventos: ['negocio.ganho', 'contato.criado'] },
			estado: { [CHAVE_DO_ID]: ID_DA_ASSINATURA, [CHAVE_DO_SEGREDO]: SEGREDO },
			responder: () => ({
				body: {
					id: ID_DA_ASSINATURA,
					eventos: ['contato.criado', 'negocio.ganho'],
					ativo: true,
				},
			}),
		});

		await expect(ciclo.checkExists.call(ctx)).resolves.toBe(true);
		expect(chamadas.some((c) => c.metodo === 'PATCH')).toBe(false);
	});
});

describe('create', () => {
	it('guarda o id e o segredo — que so chegam nesta resposta', async () => {
		const { ctx, estado, chamadas } = criarContextoDeHook({
			parametros: { modo: 'webhook', eventos: ['negocio.ganho'] },
			responder: () => ({
				statusCode: 201,
				body: { id: ID_DA_ASSINATURA, eventos: ['negocio.ganho'], segredo: SEGREDO },
			}),
		});

		await expect(ciclo.create.call(ctx)).resolves.toBe(true);
		expect(estado[CHAVE_DO_ID]).toBe(ID_DA_ASSINATURA);
		expect(estado[CHAVE_DO_SEGREDO]).toBe(SEGREDO);

		const criacao = chamadas.find((c) => c.metodo === 'POST');
		expect(criacao?.caminho).toBe('/webhooks');
		expect(criacao?.corpo?.url).toBe('https://n8n.exemplo.com.br/webhook/abc/webhook');
		expect(String(criacao?.corpo?.descricao)).toContain('wf-42');
		expect(String(criacao?.corpo?.descricao)).toContain('n8n');
	});

	it('recusa //localhost antes de falar com a API, e diz o que fazer', async () => {
		const { ctx, chamadas } = criarContextoDeHook({
			parametros: { modo: 'webhook', eventos: ['*'] },
			urlDoWebhook: 'http://localhost:5678/webhook/abc/webhook',
		});

		await expect(ciclo.create.call(ctx)).rejects.toThrow(/URL de webhook/i);
		expect(chamadas.some((c) => c.metodo === 'POST')).toBe(false);
	});

	it('recusa lista de eventos vazia', async () => {
		const { ctx } = criarContextoDeHook({ parametros: { modo: 'webhook', eventos: [] } });
		await expect(ciclo.create.call(ctx)).rejects.toThrow(/ao menos um evento/i);
	});

	it('falha com mensagem de escopo quando a chave nao tem webhooks:escrever', async () => {
		const { ctx, chamadas } = criarContextoDeHook({
			parametros: { modo: 'webhook', eventos: ['*'] },
			escopos: ['contatos:ler'],
		});

		// A mensagem NUNCA pode ser o generico do n8n: ela diz qual escopo falta
		// e onde conseguir um.
		const erro = (await ciclo.create.call(ctx).catch((e: unknown) => e)) as Error & {
			description?: string;
		};
		expect(erro.message).toMatch(/nao pode executar/i);
		expect(erro.description).toMatch(/webhooks:escrever/);
		expect(chamadas.some((c) => c.metodo === 'POST')).toBe(false);
	});

	it('nao bloqueia quando os escopos sao desconhecidos (fail-open)', async () => {
		const { ctx } = criarContextoDeHook({
			parametros: { modo: 'webhook', eventos: ['*'] },
			escopos: null,
			responder: (chamada) =>
				chamada.metodo === 'POST'
					? { statusCode: 201, body: { id: ID_DA_ASSINATURA, segredo: SEGREDO } }
					: { body: {} },
		});
		await expect(ciclo.create.call(ctx)).resolves.toBe(true);
	});

	it('remove a assinatura e falha quando a API nao devolve o segredo', async () => {
		const { ctx, estado, chamadas } = criarContextoDeHook({
			parametros: { modo: 'webhook', eventos: ['*'] },
			responder: (chamada) =>
				chamada.metodo === 'POST'
					? { statusCode: 201, body: { id: ID_DA_ASSINATURA } }
					: { body: { removido: true } },
		});

		await expect(ciclo.create.call(ctx)).rejects.toThrow(/segredo/i);
		expect(chamadas.map((c) => c.metodo)).toEqual(['POST', 'DELETE']);
		expect(estado).not.toHaveProperty(CHAVE_DO_ID);
	});

	it('nao registra nada em modo sondagem', async () => {
		const { ctx, chamadas } = criarContextoDeHook({ parametros: { modo: 'polling' } });
		await expect(ciclo.create.call(ctx)).resolves.toBe(true);
		expect(chamadas).toHaveLength(0);
	});
});

describe('delete', () => {
	it('remove no servidor e limpa o estado', async () => {
		const { ctx, estado, chamadas } = criarContextoDeHook({
			parametros: { modo: 'webhook' },
			estado: { [CHAVE_DO_ID]: ID_DA_ASSINATURA, [CHAVE_DO_SEGREDO]: SEGREDO },
			responder: () => ({ body: { id: ID_DA_ASSINATURA, removido: true } }),
		});

		await expect(ciclo.delete.call(ctx)).resolves.toBe(true);
		expect(chamadas).toEqual([
			{ metodo: 'DELETE', caminho: `/webhooks/${ID_DA_ASSINATURA}`, corpo: undefined },
		]);
		expect(estado).not.toHaveProperty(CHAVE_DO_ID);
		expect(estado).not.toHaveProperty(CHAVE_DO_SEGREDO);
	});

	it('trata 404 como ja removido', async () => {
		const { ctx, estado } = criarContextoDeHook({
			estado: { [CHAVE_DO_ID]: ID_DA_ASSINATURA, [CHAVE_DO_SEGREDO]: SEGREDO },
			responder: () => ({ status: 404, codigo: 'nao_encontrado' }),
		});

		await expect(ciclo.delete.call(ctx)).resolves.toBe(true);
		expect(estado).not.toHaveProperty(CHAVE_DO_ID);
	});

	it('mantem o id guardado quando a remocao falha, para poder tentar de novo', async () => {
		const { ctx, estado, avisos } = criarContextoDeHook({
			estado: { [CHAVE_DO_ID]: ID_DA_ASSINATURA, [CHAVE_DO_SEGREDO]: SEGREDO },
			responder: () => ({ status: 500, codigo: 'erro_interno' }),
		});

		await expect(ciclo.delete.call(ctx)).resolves.toBe(false);
		expect(estado[CHAVE_DO_ID]).toBe(ID_DA_ASSINATURA);
		expect(avisos.join('\n')).toMatch(/Falha ao remover/);
	});

	it('e um no-op quando nunca houve assinatura', async () => {
		const { ctx, chamadas } = criarContextoDeHook({});
		await expect(ciclo.delete.call(ctx)).resolves.toBe(true);
		expect(chamadas).toHaveLength(0);
	});
});

// ── webhook() ────────────────────────────────────────────────────────

function assinar(segredo: string, corpo: string, t: number): string {
	const v1 = createHmac('sha256', segredo).update(`${t}.${corpo}`, 'utf8').digest('hex');
	return `t=${t},v1=${v1}`;
}

interface ContextoDeEntrega {
	ctx: IWebhookFunctions;
	resposta: { status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> };
	statusEnviado: () => number | undefined;
}

function criarContextoDeWebhook(opcoes: {
	corpoBruto: Buffer;
	cabecalho?: string;
	segredo?: string;
	parametros?: Record<string, unknown>;
}): ContextoDeEntrega {
	const enviados: number[] = [];
	const json = vi.fn();
	const status = vi.fn((codigo: number) => {
		enviados.push(codigo);
		return { json };
	});

	const estado: IDataObject = {};
	if (opcoes.segredo !== undefined) estado[CHAVE_DO_SEGREDO] = opcoes.segredo;

	const parametros = opcoes.parametros ?? {};
	const corpo = JSON.parse(opcoes.corpoBruto.toString('utf8')) as IDataObject;

	const ctx = {
		getWorkflowStaticData: () => estado,
		getHeaderData: () => ({
			'x-fluxo-signature': opcoes.cabecalho,
			'x-fluxo-evento': String(corpo.evento ?? ''),
			'x-fluxo-entrega': 'entrega-1',
		}),
		getRequestObject: () => ({ rawBody: opcoes.corpoBruto }),
		getResponseObject: () => ({ status }),
		getBodyData: () => corpo,
		getNodeParameter: (nome: string, padrao?: unknown) =>
			nome in parametros ? parametros[nome] : padrao,
		getNode: () => ({ name: 'Fluxo CRM Trigger', type: 'fluxoCrmTrigger', typeVersion: 1 }),
		logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	} as unknown as IWebhookFunctions;

	return { ctx, resposta: { status, json }, statusEnviado: () => enviados[0] };
}

describe('webhook()', () => {
	const corpo = JSON.stringify({
		id: 'entrega-1',
		evento: 'contato.criado',
		criado_em: '2026-09-04T12:00:00.000Z',
		dados: { id: 'c1', nome: 'Ana' },
	});
	const corpoBruto = Buffer.from(corpo, 'utf8');
	const agora = () => Math.floor(Date.now() / 1000);

	it('dispara o workflow com a entrega quando a assinatura confere', async () => {
		const { ctx } = criarContextoDeWebhook({
			corpoBruto,
			segredo: SEGREDO,
			cabecalho: assinar(SEGREDO, corpo, agora()),
		});

		const saida = await node.webhook.call(ctx);
		expect(saida.workflowData?.[0]?.[0]?.json).toMatchObject({ evento: 'contato.criado' });
		expect(saida.noWebhookResponse).toBeUndefined();
	});

	it('responde 401 e NAO dispara quando a assinatura e invalida', async () => {
		const { ctx, resposta, statusEnviado } = criarContextoDeWebhook({
			corpoBruto,
			segredo: SEGREDO,
			cabecalho: assinar('whsec_outro', corpo, agora()),
		});

		const saida = await node.webhook.call(ctx);
		expect(statusEnviado()).toBe(401);
		expect(saida).toEqual({ noWebhookResponse: true });
		expect(saida.workflowData).toBeUndefined();
		expect(resposta.json).toHaveBeenCalledWith(
			expect.objectContaining({ erro: 'assinatura_invalida' }),
		);
	});

	it('responde 401 quando o carimbo esta fora da janela de 300 segundos', async () => {
		const { ctx, statusEnviado } = criarContextoDeWebhook({
			corpoBruto,
			segredo: SEGREDO,
			cabecalho: assinar(SEGREDO, corpo, agora() - 601),
		});

		const saida = await node.webhook.call(ctx);
		expect(statusEnviado()).toBe(401);
		expect(saida.workflowData).toBeUndefined();
	});

	it('responde 401 (sem quebrar) quando v1 tem outro comprimento', async () => {
		const { ctx, statusEnviado } = criarContextoDeWebhook({
			corpoBruto,
			segredo: SEGREDO,
			cabecalho: `t=${agora()},v1=abcd`,
		});

		const saida = await node.webhook.call(ctx);
		expect(statusEnviado()).toBe(401);
		expect(saida.workflowData).toBeUndefined();
	});

	it('responde 401 quando o segredo nao esta guardado neste node', async () => {
		const { ctx, statusEnviado } = criarContextoDeWebhook({
			corpoBruto,
			cabecalho: assinar(SEGREDO, corpo, agora()),
		});

		await node.webhook.call(ctx);
		expect(statusEnviado()).toBe(401);
	});

	it('assina sobre o corpo BRUTO: um corpo que o JSON.stringify reescreveria continua valido', async () => {
		const bruto = '{"evento": "contato.criado",  "dados": {"nome": "Servi\\u00e7o"}}';
		expect(JSON.stringify(JSON.parse(bruto))).not.toBe(bruto);

		const { ctx } = criarContextoDeWebhook({
			corpoBruto: Buffer.from(bruto, 'utf8'),
			segredo: SEGREDO,
			cabecalho: assinar(SEGREDO, bruto, agora()),
		});

		const saida = await node.webhook.call(ctx);
		expect(saida.workflowData).toBeDefined();
	});

	it('ignora a entrega de teste quando a opcao esta ligada, respondendo 200', async () => {
		const teste = JSON.stringify({
			id: 'e1',
			evento: 'webhook.teste',
			criado_em: '2026-09-04T12:00:00.000Z',
			dados: { mensagem: 'Entrega de teste do Fluxo CRM.' },
		});
		const { ctx, statusEnviado } = criarContextoDeWebhook({
			corpoBruto: Buffer.from(teste, 'utf8'),
			segredo: SEGREDO,
			cabecalho: assinar(SEGREDO, teste, agora()),
			parametros: { opcoesDoWebhook: { ignorarEntregaDeTeste: true } },
		});

		const saida = await node.webhook.call(ctx);
		expect(statusEnviado()).toBe(200);
		expect(saida).toEqual({ noWebhookResponse: true });
	});

	it('acrescenta __entrega quando os metadados sao pedidos', async () => {
		const { ctx } = criarContextoDeWebhook({
			corpoBruto,
			segredo: SEGREDO,
			cabecalho: assinar(SEGREDO, corpo, agora()),
			parametros: { opcoesDoWebhook: { incluirMetadados: true } },
		});

		const saida = await node.webhook.call(ctx);
		expect(saida.workflowData?.[0]?.[0]?.json.__entrega).toMatchObject({
			id: 'entrega-1',
			evento: 'contato.criado',
		});
	});
});

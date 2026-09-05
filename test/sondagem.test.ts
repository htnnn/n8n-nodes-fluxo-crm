import type { IDataObject, IPollFunctions } from 'n8n-workflow';
import { beforeEach, describe, expect, it } from 'vitest';

import {
	cacheDeEscopos,
	impressaoDaCredencial,
	montarCarimbo,
} from '../nodes/FluxoCrm/compartilhado/escopos';
import { FluxoCrmTrigger } from '../nodes/FluxoCrmTrigger/FluxoCrmTrigger.node';
import { CHAVE_DA_MARCA, CHAVE_DOS_IDS_NA_MARCA } from '../nodes/FluxoCrmTrigger/estado';

const BASE = 'https://api-crm.nafluxo.com.br/v1';
const node = new FluxoCrmTrigger();

interface Chamada {
	caminho: string;
	query: IDataObject;
}

interface OpcoesDaSondagem {
	parametros?: Record<string, unknown>;
	estado?: IDataObject;
	modo?: 'trigger' | 'manual';
	escopos?: string[];
	responder?: (chamada: Chamada) => IDataObject;
}

function criarContextoDePoll(opcoes: OpcoesDaSondagem): {
	ctx: IPollFunctions;
	estado: IDataObject;
	chamadas: Chamada[];
} {
	const apiKey = `flx_test_${Math.random().toString(36).slice(2)}`;
	const estado: IDataObject = opcoes.estado ?? {};
	const chamadas: Chamada[] = [];
	const parametros = opcoes.parametros ?? {};

	const credenciais = {
		baseUrl: BASE,
		apiKey,
		escoposDaChave: montarCarimbo(impressaoDaCredencial(BASE, apiKey), {
			conhecidos: true,
			escopos: opcoes.escopos ?? ['*'],
			origem: 'credencial',
		}),
	};

	const ctx = {
		getMode: () => opcoes.modo ?? 'trigger',
		getCredentials: async () => credenciais,
		getNode: () => ({ name: 'Fluxo CRM Trigger', type: 'fluxoCrmTrigger', typeVersion: 1 }),
		getWorkflowStaticData: () => estado,
		getNodeParameter: (nome: string, padrao?: unknown) =>
			nome in parametros ? parametros[nome] : padrao,
		logger: {
			debug: () => undefined,
			info: () => undefined,
			warn: () => undefined,
			error: () => undefined,
		},
		helpers: {
			httpRequestWithAuthentication: async (_credencial: string, requisicao: IDataObject) => {
				const url = String(requisicao.url);
				const chamada: Chamada = {
					caminho: url.startsWith(BASE) ? url.slice(BASE.length) : url,
					query: (requisicao.qs ?? {}) as IDataObject,
				};
				chamadas.push(chamada);
				return {
					body: opcoes.responder?.(chamada) ?? { dados: [], tem_mais: false },
					statusCode: 200,
					headers: {},
				};
			},
		},
	} as unknown as IPollFunctions;

	return { ctx, estado, chamadas };
}

function contato(id: string, criadoEm: string): IDataObject {
	return { id, nome: `Contato ${id}`, criado_em: criadoEm, atualizado_em: criadoEm };
}

beforeEach(() => {
	cacheDeEscopos.limpar();
});

describe('sondagem — marca d’água', () => {
	it('sai de cena quando o node esta em modo webhook', async () => {
		const { ctx, chamadas } = criarContextoDePoll({
			parametros: { modo: 'webhook', recursoSondado: 'contato' },
		});
		await expect(node.poll.call(ctx)).resolves.toBeNull();
		expect(chamadas).toHaveLength(0);
	});

	it('a primeira sondagem fixa a marca e NAO emite a base inteira', async () => {
		const { ctx, estado, chamadas } = criarContextoDePoll({
			parametros: { modo: 'polling', recursoSondado: 'contato' },
		});

		await expect(node.poll.call(ctx)).resolves.toBeNull();
		expect(typeof estado[CHAVE_DA_MARCA]).toBe('number');
		// Nem uma requisicao de lista: nao ha nada a emitir na ativacao.
		expect(chamadas.filter((c) => c.caminho.startsWith('/contatos'))).toHaveLength(0);
	});

	it('emite o que e novo, em ordem cronologica, e avanca a marca', async () => {
		const marca = Date.parse('2026-09-04T12:00:00.000Z');
		const { ctx, estado, chamadas } = criarContextoDePoll({
			parametros: { modo: 'polling', recursoSondado: 'contato', gatilhoDeSondagem: 'criado' },
			estado: { [CHAVE_DA_MARCA]: marca, [CHAVE_DOS_IDS_NA_MARCA]: ['antigo'] },
			responder: () => ({
				// A API devolve o mais recente primeiro.
				dados: [
					contato('novo-2', '2026-09-04T12:00:20.000Z'),
					contato('novo-1', '2026-09-04T12:00:10.000Z'),
				],
				tem_mais: false,
			}),
		});

		const saida = await node.poll.call(ctx);
		expect(saida?.[0]?.map((item) => item.json.id)).toEqual(['novo-1', 'novo-2']);
		expect(estado[CHAVE_DA_MARCA]).toBe(Date.parse('2026-09-04T12:00:20.000Z'));
		expect(estado[CHAVE_DOS_IDS_NA_MARCA]).toEqual(['novo-2']);

		// O filtro de data foi para o servidor, com a marca anterior.
		expect(chamadas[0].query.criado_apos).toBe(new Date(marca).toISOString());
	});

	it('nao reemite o item da fronteira — os filtros da API sao >=, nao >', async () => {
		const instante = '2026-09-04T12:00:00.000Z';
		const marca = Date.parse(instante);
		const { ctx } = criarContextoDePoll({
			parametros: { modo: 'polling', recursoSondado: 'contato' },
			estado: { [CHAVE_DA_MARCA]: marca, [CHAVE_DOS_IDS_NA_MARCA]: ['fronteira'] },
			responder: () => ({ dados: [contato('fronteira', instante)], tem_mais: false }),
		});

		// O servidor devolve o mesmo registro de novo; o node o descarta.
		await expect(node.poll.call(ctx)).resolves.toBeNull();
	});

	it('emite outro registro gravado no MESMO milissegundo da marca', async () => {
		const instante = '2026-09-04T12:00:00.000Z';
		const marca = Date.parse(instante);
		const { ctx, estado } = criarContextoDePoll({
			parametros: { modo: 'polling', recursoSondado: 'contato' },
			estado: { [CHAVE_DA_MARCA]: marca, [CHAVE_DOS_IDS_NA_MARCA]: ['fronteira'] },
			responder: () => ({
				dados: [contato('gemeo', instante), contato('fronteira', instante)],
				tem_mais: false,
			}),
		});

		const saida = await node.poll.call(ctx);
		expect(saida?.[0]?.map((item) => item.json.id)).toEqual(['gemeo']);
		// Os dois ids ficam guardados na fronteira, para o proximo ciclo.
		expect(estado[CHAVE_DOS_IDS_NA_MARCA]).toEqual(expect.arrayContaining(['fronteira', 'gemeo']));
	});

	it('devolve null, e nunca um array vazio, quando nao ha nada novo', async () => {
		const { ctx } = criarContextoDePoll({
			parametros: { modo: 'polling', recursoSondado: 'contato' },
			estado: { [CHAVE_DA_MARCA]: Date.parse('2026-09-04T12:00:00.000Z') },
			responder: () => ({ dados: [], tem_mais: false }),
		});

		const saida = await node.poll.call(ctx);
		expect(saida).toBeNull();
	});

	it('percorre o cursor quando ha mais paginas — a lista ordena por criacao, e atualizado_apos nao', async () => {
		const marca = Date.parse('2026-09-04T12:00:00.000Z');
		let pagina = 0;
		const { ctx, chamadas } = criarContextoDePoll({
			parametros: { modo: 'polling', recursoSondado: 'contato', gatilhoDeSondagem: 'atualizado' },
			estado: { [CHAVE_DA_MARCA]: marca },
			responder: () => {
				pagina += 1;
				if (pagina === 1) {
					return {
						dados: [contato('a', '2026-09-04T12:10:00.000Z')],
						proximo_cursor: 'cursor-2',
						tem_mais: true,
					};
				}
				return { dados: [contato('b', '2026-09-04T12:05:00.000Z')], tem_mais: false };
			},
		});

		const saida = await node.poll.call(ctx);
		expect(saida?.[0]).toHaveLength(2);
		expect(chamadas[0].query.atualizado_apos).toBe(new Date(marca).toISOString());
		expect(chamadas[1].query.cursor).toBe('cursor-2');
	});

	it('respeita o teto de paginas em vez de varrer a base inteira', async () => {
		const { ctx, chamadas } = criarContextoDePoll({
			parametros: {
				modo: 'polling',
				recursoSondado: 'contato',
				opcoesDeSondagem: { maximoDePaginas: 2 },
			},
			estado: { [CHAVE_DA_MARCA]: Date.parse('2026-09-04T12:00:00.000Z') },
			responder: () => ({
				dados: [contato(`x${Math.random()}`, '2026-09-04T13:00:00.000Z')],
				proximo_cursor: 'sempre-tem-mais',
				tem_mais: true,
			}),
		});

		await node.poll.call(ctx);
		expect(chamadas).toHaveLength(2);
	});

	it('em modo manual traz 1 amostra sem filtro de data e NAO mexe na marca', async () => {
		const marca = Date.parse('2026-09-04T12:00:00.000Z');
		const { ctx, estado, chamadas } = criarContextoDePoll({
			modo: 'manual',
			parametros: { modo: 'polling', recursoSondado: 'contato' },
			estado: { [CHAVE_DA_MARCA]: marca },
			responder: () => ({
				dados: [contato('antigo', '2020-01-01T00:00:00.000Z')],
				tem_mais: false,
			}),
		});

		const saida = await node.poll.call(ctx);
		expect(saida?.[0]).toHaveLength(1);
		expect(saida?.[0][0].json.id).toBe('antigo');
		expect(chamadas[0].query).toEqual({ limite: 1 });
		expect(estado[CHAVE_DA_MARCA]).toBe(marca);
	});

	it('bloqueia com mensagem de escopo quando a chave nao alcanca o recurso', async () => {
		const { ctx } = criarContextoDePoll({
			parametros: { modo: 'polling', recursoSondado: 'conversa' },
			estado: { [CHAVE_DA_MARCA]: Date.now() },
			escopos: ['contatos:ler'],
		});

		const erro = (await node.poll.call(ctx).catch((e: unknown) => e)) as Error & {
			description?: string;
		};
		expect(erro.description).toMatch(/atendimento:ler/);
	});

	it('exige o slug ao sondar um modulo generico', async () => {
		const { ctx } = criarContextoDePoll({
			parametros: { modo: 'polling', recursoSondado: 'registroDeModulo', slugDoModulo: '' },
			estado: { [CHAVE_DA_MARCA]: Date.now() },
		});
		await expect(node.poll.call(ctx)).rejects.toThrow(/slug/i);
	});

	it('monta o caminho do modulo com o slug informado', async () => {
		const { ctx, chamadas } = criarContextoDePoll({
			parametros: {
				modo: 'polling',
				recursoSondado: 'registroDeModulo',
				slugDoModulo: 'orcamentos',
			},
			estado: { [CHAVE_DA_MARCA]: Date.now() },
			responder: () => ({ dados: [], tem_mais: false }),
		});

		await node.poll.call(ctx);
		expect(chamadas[0].caminho.startsWith('/modulos/orcamentos/registros')).toBe(true);
	});
});

describe('sondagem — atendimento (o unico caminho, porque nao ha webhook)', () => {
	const marca = Date.parse('2026-09-04T12:00:00.000Z');

	function conversa(id: string, ultima: string): IDataObject {
		return { id, canal_id: 'canal-1', status: 'aberta', ultima_mensagem_em: ultima };
	}

	function mensagem(id: string, enviadoEm: string, direcao: string): IDataObject {
		return { id, conversa_id: 'conv-1', direcao, conteudo: 'oi', enviado_em: enviadoEm };
	}

	it('conversas: corta localmente, porque a rota nao tem filtro "depois de"', async () => {
		const { ctx, chamadas } = criarContextoDePoll({
			parametros: { modo: 'polling', recursoSondado: 'conversa' },
			estado: { [CHAVE_DA_MARCA]: marca },
			responder: () => ({
				dados: [
					conversa('nova', '2026-09-04T12:05:00.000Z'),
					conversa('antiga', '2026-09-04T11:00:00.000Z'),
				],
				tem_mais: true,
			}),
		});

		const saida = await node.poll.call(ctx);
		expect(saida?.[0]?.map((item) => item.json.id)).toEqual(['nova']);
		// Achou um item antigo na primeira pagina: nao ha por que descer mais.
		expect(chamadas).toHaveLength(1);
		expect(chamadas[0].query).not.toHaveProperty('criado_apos');
	});

	it('mensagens: visita as conversas que se moveram e filtra por direcao', async () => {
		const { ctx, chamadas } = criarContextoDePoll({
			parametros: { modo: 'polling', recursoSondado: 'mensagem' },
			estado: { [CHAVE_DA_MARCA]: marca },
			responder: (chamada) => {
				if (chamada.caminho.includes('/mensagens')) {
					return {
						dados: [
							mensagem('m2', '2026-09-04T12:05:00.000Z', 'saida'),
							mensagem('m1', '2026-09-04T12:04:00.000Z', 'entrada'),
							mensagem('m0', '2026-09-04T11:00:00.000Z', 'entrada'),
						],
					};
				}
				return {
					dados: [
						conversa('conv-1', '2026-09-04T12:05:00.000Z'),
						conversa('conv-0', '2026-09-04T10:00:00.000Z'),
					],
					tem_mais: false,
				};
			},
		});

		const saida = await node.poll.call(ctx);
		// `m2` e da equipe (saida) e `m0` e anterior a marca.
		expect(saida?.[0]?.map((item) => item.json.id)).toEqual(['m1']);
		// Uma requisicao de conversas e uma de mensagens da unica conversa que moveu.
		expect(chamadas.map((c) => c.caminho.includes('/mensagens'))).toEqual([false, true]);
		// A conversa que originou a mensagem viaja junto, para nao exigir outra
		// chamada so para saber de quem e.
		expect(saida?.[0]?.[0].json.__conversa).toMatchObject({ id: 'conv-1' });
	});

	it('mensagens: com "somente recebidas" desligado, a saida da equipe tambem dispara', async () => {
		const { ctx } = criarContextoDePoll({
			parametros: {
				modo: 'polling',
				recursoSondado: 'mensagem',
				opcoesDeSondagem: { somenteRecebidas: false },
			},
			estado: { [CHAVE_DA_MARCA]: marca },
			responder: (chamada) =>
				chamada.caminho.includes('/mensagens')
					? { dados: [mensagem('m2', '2026-09-04T12:05:00.000Z', 'saida')] }
					: { dados: [conversa('conv-1', '2026-09-04T12:05:00.000Z')], tem_mais: false },
		});

		const saida = await node.poll.call(ctx);
		expect(saida?.[0]?.map((item) => item.json.id)).toEqual(['m2']);
	});

	it('mensagens: a marca avanca mesmo quando a conversa moveu sem mensagem visivel', async () => {
		// Uma nota interna move `ultima_mensagem_em` sem virar mensagem na rota
		// publica. Sem avancar a marca, a conversa seria relida a cada ciclo.
		const { ctx, estado } = criarContextoDePoll({
			parametros: { modo: 'polling', recursoSondado: 'mensagem' },
			estado: { [CHAVE_DA_MARCA]: marca },
			responder: (chamada) =>
				chamada.caminho.includes('/mensagens')
					? { dados: [] }
					: { dados: [conversa('conv-1', '2026-09-04T12:05:00.000Z')], tem_mais: false },
		});

		await expect(node.poll.call(ctx)).resolves.toBeNull();
		expect(estado[CHAVE_DA_MARCA]).toBe(Date.parse('2026-09-04T12:05:00.000Z'));
	});

	it('mensagens: respeita o teto de conversas visitadas por sondagem', async () => {
		const { ctx, chamadas } = criarContextoDePoll({
			parametros: {
				modo: 'polling',
				recursoSondado: 'mensagem',
				opcoesDeSondagem: { maximoDeConversas: 2 },
			},
			estado: { [CHAVE_DA_MARCA]: marca },
			responder: (chamada) =>
				chamada.caminho.includes('/mensagens')
					? { dados: [] }
					: {
							dados: [
								conversa('c1', '2026-09-04T12:05:00.000Z'),
								conversa('c2', '2026-09-04T12:04:00.000Z'),
								conversa('c3', '2026-09-04T12:03:00.000Z'),
							],
							tem_mais: false,
						},
		});

		await node.poll.call(ctx);
		expect(chamadas.filter((c) => c.caminho.includes('/mensagens'))).toHaveLength(2);
	});

	it('conversas: repassa os filtros de status e canal ao servidor', async () => {
		const { ctx, chamadas } = criarContextoDePoll({
			parametros: {
				modo: 'polling',
				recursoSondado: 'conversa',
				opcoesDeSondagem: { statusDaConversa: 'aberta', canalId: 'canal-9' },
			},
			estado: { [CHAVE_DA_MARCA]: marca },
			responder: () => ({ dados: [], tem_mais: false }),
		});

		await node.poll.call(ctx);
		expect(chamadas[0].query).toMatchObject({ status: 'aberta', canal_id: 'canal-9' });
	});
});

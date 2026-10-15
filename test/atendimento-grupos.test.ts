import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { executarAtendimento } from '../nodes/FluxoCrm/acoes/atendimento';
import { encontrarRecurso } from '../nodes/FluxoCrm/compartilhado/catalogo';

/**
 * Grupos de WhatsApp e participantes (API 2026-10-14, FLU-1558).
 *
 * Escrito antes do codigo, a partir das formas de falhar: rota errada; filtro
 * do usuario perdido no caminho; id de grupo ou de canal malformado indo ao
 * servidor (que responde 404, e nao 422, e o usuario conclui que o grupo nao
 * existe); `status` mandado sempre — o padrao `ativos` esconderia as saidas
 * justamente quando a pessoa pede `alterado_desde`; limite acima de 200, o teto
 * da rota.
 */

const BASE = 'https://api-crm.nafluxo.com.br/v1';
const GRUPO = '83d49895-af12-4cb3-aa0e-7a6bed9ea690';
const CANAL = '0ac5efa5-aaab-400a-934c-ac12eeb7b39a';

interface Chamada {
	metodo: string;
	caminho: string;
	query: IDataObject | undefined;
}

function criarContexto(
	parametros: Record<string, unknown>,
	dados: IDataObject[] = [{ id: GRUPO }],
): { ctx: IExecuteFunctions; chamadas: Chamada[] } {
	const chamadas: Chamada[] = [];
	const ctx = {
		getNodeParameter: (nome: string, _i: number, padrao?: unknown) =>
			nome in parametros ? parametros[nome] : padrao,
		getNode: () => ({ name: 'Fluxo CRM', type: 'fluxoCrm', typeVersion: 1 }),
		getCredentials: async () => ({ baseUrl: BASE, apiKey: 'flx_test_grupos' }),
		logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
		helpers: {
			httpRequestWithAuthentication: async (_credencial: string, requisicao: IDataObject) => {
				const url = String(requisicao.url);
				chamadas.push({
					metodo: String(requisicao.method),
					caminho: url.startsWith(BASE) ? url.slice(BASE.length) : url,
					query: requisicao.qs as IDataObject | undefined,
				});
				return { body: { dados, proximo_cursor: null, tem_mais: false }, statusCode: 200, headers: {} };
			},
		},
	} as unknown as IExecuteFunctions;
	return { ctx, chamadas };
}

describe('catalogo: Atendimento › Grupo', () => {
	it('o recurso existe, com as duas operacoes de leitura e o escopo atendimento:ler', () => {
		const recurso = encontrarRecurso('grupoAtendimento');
		expect(recurso?.nome).toBe('Atendimento › Grupo');
		expect(recurso?.operacoes.map((op) => [op.valor, op.escopo])).toEqual([
			['listar', 'atendimento:ler'],
			['listarParticipantes', 'atendimento:ler'],
		]);
	});
});

describe('grupo: listar', () => {
	it('chama /atendimento/grupos com os filtros do usuario e o limite', async () => {
		const { ctx, chamadas } = criarContexto({
			returnAll: false,
			limit: 20,
			filters: { canal_id: CANAL, busca: 'Black' },
		});

		const saida = await executarAtendimento(ctx, 'grupoAtendimento', 'listar', 0);

		expect(chamadas).toHaveLength(1);
		expect(chamadas[0]).toMatchObject({ metodo: 'GET', caminho: '/atendimento/grupos' });
		expect(chamadas[0].query).toEqual({ canal_id: CANAL, busca: 'Black', limite: 20 });
		expect(saida.map((item) => item.json.id)).toEqual([GRUPO]);
	});

	it('canal malformado nao vai ao servidor', async () => {
		const { ctx, chamadas } = criarContexto({ returnAll: false, limit: 20, filters: { canal_id: 'abc' } });
		await expect(executarAtendimento(ctx, 'grupoAtendimento', 'listar', 0)).rejects.toThrow(/canal_id/);
		expect(chamadas).toHaveLength(0);
	});
});

describe('grupo: listar participantes', () => {
	it('sem status escolhido, o node nao manda `status`: o servidor decide (e com `alterado_desde` traz as saidas)', async () => {
		const { ctx, chamadas } = criarContexto({
			grupoId: GRUPO,
			returnAll: false,
			limit: 50,
			filters: { alterado_desde: '2026-10-13T19:00:00' },
		});

		await executarAtendimento(ctx, 'grupoAtendimento', 'listarParticipantes', 0);

		expect(chamadas[0]).toMatchObject({
			metodo: 'GET',
			caminho: `/atendimento/grupos/${GRUPO}/participantes`,
		});
		expect(chamadas[0].query).toEqual({ alterado_desde: '2026-10-13T19:00:00', limite: 50 });
	});

	it('status escolhido vai na query', async () => {
		const { ctx, chamadas } = criarContexto({
			grupoId: GRUPO,
			returnAll: false,
			limit: 50,
			filters: { status: 'saidos' },
		});

		await executarAtendimento(ctx, 'grupoAtendimento', 'listarParticipantes', 0);
		expect(chamadas[0].query).toEqual({ status: 'saidos', limite: 50 });
	});

	it('limite acima de 200 nao passa do teto da rota numa pagina', async () => {
		const { ctx, chamadas } = criarContexto({ grupoId: GRUPO, returnAll: false, limit: 150, filters: {} });
		await executarAtendimento(ctx, 'grupoAtendimento', 'listarParticipantes', 0);
		expect(chamadas[0].query).toEqual({ limite: 150 });
	});

	it('grupo malformado nao vai ao servidor', async () => {
		const { ctx, chamadas } = criarContexto({ grupoId: 'grupo-da-black', returnAll: false, limit: 50, filters: {} });
		await expect(executarAtendimento(ctx, 'grupoAtendimento', 'listarParticipantes', 0)).rejects.toThrow();
		expect(chamadas).toHaveLength(0);
	});
});

import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it, vi } from 'vitest';

import {
	lerPaginaPorData,
	varrerConversas,
	type PaginaPorData,
} from '../nodes/FluxoCrm/compartilhado/conversas';

/**
 * A paginacao por DATA de `GET /atendimento/conversas`.
 *
 * E a unica lista da v1 que nao usa cursor keyset: o `proximo_cursor` e o
 * `ultima_mensagem_em` do ultimo item, e ele volta em `antes_de`. Sem desempate
 * por `id` no servidor, um laco ingenuo aqui roda para sempre dentro do
 * processo do n8n — e um laco medroso demais devolve lista incompleta que passa
 * por completa.
 */

const PADRAO = {
	retornarTudo: true,
	limite: 50,
	limitePorPagina: 200,
	maxRequisicoes: 200,
};

function pagina(ids: string[], cursor: string | null, temMais: boolean): PaginaPorData {
	return {
		dados: ids.map((id) => ({ id, ultima_mensagem_em: cursor }) as IDataObject),
		proximoCursor: cursor,
		temMais,
	};
}

describe('leitura da pagina crua', () => {
	it('le a forma que o servidor devolve', () => {
		expect(
			lerPaginaPorData({
				dados: [{ id: 'a' }],
				proximo_cursor: '2026-09-03T10:00:00-03:00',
				tem_mais: true,
			}),
		).toEqual({
			dados: [{ id: 'a' }],
			proximoCursor: '2026-09-03T10:00:00-03:00',
			temMais: true,
		});
	});

	it('`proximo_cursor` nulo ou vazio vira null, e nunca string', () => {
		expect(
			lerPaginaPorData({ dados: [], proximo_cursor: null, tem_mais: true }).proximoCursor,
		).toBeNull();
		expect(
			lerPaginaPorData({ dados: [], proximo_cursor: '', tem_mais: true }).proximoCursor,
		).toBeNull();
	});

	it('resposta fora de forma nao derruba a leitura', () => {
		expect(lerPaginaPorData(null)).toEqual({ dados: [], proximoCursor: null, temMais: false });
		expect(lerPaginaPorData('texto')).toEqual({ dados: [], proximoCursor: null, temMais: false });
		expect(lerPaginaPorData({ dados: 7 }).dados).toEqual([]);
	});
});

describe('varredura por data', () => {
	it('segue `antes_de` de pagina em pagina ate o servidor dizer que acabou', async () => {
		const vistos: Array<string | undefined> = [];
		const buscar = vi.fn(async (antesDe?: string) => {
			vistos.push(antesDe);
			if (antesDe === undefined) return pagina(['a', 'b'], 'T2', true);
			if (antesDe === 'T2') return pagina(['c'], 'T3', true);
			return pagina(['d'], null, false);
		});

		const dados = await varrerConversas(buscar, PADRAO);

		// A primeira requisicao vai SEM `antes_de`; as seguintes levam o cursor da
		// anterior. E `antes_de` e ao mesmo tempo filtro e cursor nesta rota.
		expect(vistos).toEqual([undefined, 'T2', 'T3']);
		expect(dados.map((conversa) => conversa.id)).toEqual(['a', 'b', 'c', 'd']);
	});

	it('para quando o servidor devolve pagina vazia', async () => {
		const buscar = vi.fn(async () => pagina([], 'T2', true));
		const dados = await varrerConversas(buscar, PADRAO);

		expect(dados).toEqual([]);
		expect(buscar).toHaveBeenCalledTimes(1);
	});

	it('DEDUPLICA por id: sem desempate no servidor, a mesma conversa pode voltar', async () => {
		let volta = 0;
		const buscar = vi.fn(async () => {
			volta += 1;
			if (volta === 1) return pagina(['a', 'b'], 'T2', true);
			if (volta === 2) return pagina(['b', 'c'], 'T3', true);
			return pagina(['c'], null, false);
		});

		const dados = await varrerConversas(buscar, PADRAO);
		expect(dados.map((conversa) => conversa.id)).toEqual(['a', 'b', 'c']);
	});

	it('AVISA e para quando `tem_mais` e true sem `proximo_cursor` — a paginacao travou', async () => {
		// Acontece quando a ultima conversa da pagina nao tem mensagem: o servidor
		// serializa `null` no cursor. Parar em silencio devolveria uma lista
		// incompleta indistinguivel de uma completa.
		const avisos: string[] = [];
		const buscar = vi.fn(async () => pagina(['a'], null, true));

		const dados = await varrerConversas(buscar, {
			...PADRAO,
			registrarAviso: (mensagem) => avisos.push(mensagem),
		});

		expect(dados.map((conversa) => conversa.id)).toEqual(['a']);
		expect(buscar).toHaveBeenCalledTimes(1);
		expect(avisos.join(' ')).toContain('sem proximo_cursor');
	});

	it('AVISA e para quando o cursor se repete — a guarda contra laco infinito', async () => {
		const avisos: string[] = [];
		const buscar = vi.fn(async (antesDe?: string) =>
			antesDe === undefined ? pagina(['a'], 'T', true) : pagina(['b'], 'T', true),
		);

		const dados = await varrerConversas(buscar, {
			...PADRAO,
			registrarAviso: (mensagem) => avisos.push(mensagem),
		});

		// Duas requisicoes e para: a segunda devolveu o MESMO cursor que ja tinha
		// sido usado, entao a terceira pediria exatamente a mesma pagina.
		expect(buscar).toHaveBeenCalledTimes(2);
		expect(dados.map((conversa) => conversa.id)).toEqual(['a', 'b']);
		expect(avisos.join(' ')).toContain('mesmo cursor');
	});

	it('respeita o teto de requisicoes e avisa em vez de truncar em silencio', async () => {
		let volta = 0;
		const avisos: string[] = [];
		const buscar = vi.fn(async () => {
			volta += 1;
			return pagina([`c${volta}`], `T${volta}`, true);
		});

		const dados = await varrerConversas(buscar, {
			...PADRAO,
			maxRequisicoes: 3,
			registrarAviso: (mensagem) => avisos.push(mensagem),
		});

		expect(buscar).toHaveBeenCalledTimes(3);
		expect(dados).toHaveLength(3);
		expect(avisos.join(' ')).toContain('teto de 3 requisicoes');
	});

	it('com limite explicito, para assim que o acumulado o alcanca e corta o excedente', async () => {
		const buscar = vi.fn(async () => pagina(['a', 'b', 'c'], 'T', true));

		const dados = await varrerConversas(buscar, {
			...PADRAO,
			retornarTudo: false,
			limite: 2,
		});

		expect(buscar).toHaveBeenCalledTimes(1);
		expect(dados.map((conversa) => conversa.id)).toEqual(['a', 'b']);
	});

	it('com "retornar tudo", o limite nao corta nada', async () => {
		const buscar = vi.fn(async (antesDe?: string) =>
			antesDe === undefined ? pagina(['a', 'b', 'c'], 'T2', true) : pagina(['d'], null, false),
		);

		const dados = await varrerConversas(buscar, { ...PADRAO, retornarTudo: true, limite: 2 });
		expect(dados).toHaveLength(4);
	});
});

import { describe, expect, it } from 'vitest';

import {
	blocosDeItens,
	consolidarLote,
	jsonDaLinha,
	MAX_ITENS_POR_BLOCO,
	resumoDasFalhas,
} from '../nodes/FluxoCrm/compartilhado/lote';

/**
 * O transformador da resposta de lote.
 *
 * A regra que estes testes protegem: `POST /v1/bulk/*` responde **HTTP 200
 * mesmo com falhas parciais**. Se o consolidador perder uma linha, ou marcar
 * como sucesso o que falhou, o usuario ve um item verde e nunca descobre que
 * parte do lote nao entrou.
 */

function relatorio(resultados: unknown[], agregados: Record<string, number> = {}) {
	return {
		total: resultados.length,
		criados: 0,
		atualizados: 0,
		falhas: resultados.filter((r) => (r as { ok?: boolean }).ok !== true).length,
		...agregados,
		resultados,
	};
}

describe('fatiamento em blocos', () => {
	it('respeita o teto de 200 itens por requisicao', () => {
		const itens = Array.from({ length: 450 }, (_, n) => ({ n }));
		const blocos = blocosDeItens(itens, MAX_ITENS_POR_BLOCO);

		expect(blocos.map((bloco) => bloco.length)).toEqual([200, 200, 50]);
		expect(blocos.flat()).toEqual(itens);
	});

	it('uma lista menor que o teto vira um bloco so', () => {
		expect(blocosDeItens([{ a: 1 }], MAX_ITENS_POR_BLOCO)).toEqual([[{ a: 1 }]]);
	});

	it('lista vazia nao produz bloco nenhum, e portanto nenhuma requisicao', () => {
		expect(blocosDeItens([], MAX_ITENS_POR_BLOCO)).toEqual([]);
	});
});

describe('consolidacao do relatorio', () => {
	it('emite uma linha por resultado, e nao um agregado', () => {
		const { linhas } = consolidarLote(
			[
				relatorio([
					{ indice: 0, ok: true, id: 'a', criado: true, casou_por: null },
					{ indice: 1, ok: false, erro: { codigo: 'validacao', mensagem: 'Email invalido.' } },
					{ indice: 2, ok: true, id: 'c', criado: false, casou_por: 'email' },
				]),
			],
			[0],
		);

		expect(linhas).toHaveLength(3);
		expect(linhas.map((linha) => linha.ok)).toEqual([true, false, true]);
	});

	it('REINDEXA o segundo bloco: o indice 0 dele nao pode virar o item 0 do array', () => {
		// O servidor reinicia `indice` em cada requisicao. Sem o deslocamento, o
		// usuario procuraria o defeito na linha errada.
		const { linhas } = consolidarLote(
			[
				relatorio([{ indice: 0, ok: true, id: 'a' }]),
				relatorio([
					{ indice: 0, ok: false, erro: { codigo: 'validacao', mensagem: 'Nome vazio.' } },
					{ indice: 1, ok: true, id: 'c' },
				]),
			],
			[0, 200],
		);

		expect(linhas.map((linha) => linha.indice)).toEqual([0, 200, 201]);
		expect(linhas[1].erro?.mensagem).toBe('Nome vazio.');
	});

	it('soma os agregados de todos os blocos e conta os blocos', () => {
		const { agregado } = consolidarLote(
			[
				relatorio([{ indice: 0, ok: true }], {
					total: 200,
					criados: 190,
					atualizados: 5,
					falhas: 5,
				}),
				relatorio([{ indice: 0, ok: true }], { total: 50, criados: 50, atualizados: 0, falhas: 0 }),
			],
			[0, 200],
		);

		expect(agregado).toEqual({ total: 250, criados: 240, atualizados: 5, falhas: 5, blocos: 2 });
	});

	it('qualquer coisa diferente de ok:true conta como FALHA', () => {
		// O discriminador e `ok`, e nao um campo `status` — que nao existe. Uma
		// forma inesperada nunca pode passar por sucesso.
		const { linhas } = consolidarLote(
			[relatorio([{ indice: 0 }, { indice: 1, ok: 'sim' }, { indice: 2, ok: false }])],
			[0],
		);

		expect(linhas.every((linha) => !linha.ok)).toBe(true);
		expect(linhas[0].erro?.codigo).toBe('erro_item');
	});

	it('resultado sem indice numerico cai na posicao dentro do bloco', () => {
		const { linhas } = consolidarLote(
			[
				relatorio([
					{ ok: true, id: 'a' },
					{ ok: true, id: 'b' },
				]),
			],
			[100],
		);
		expect(linhas.map((linha) => linha.indice)).toEqual([100, 101]);
	});

	it('`casou_por` nulo e INFORMACAO e sobrevive; ausente nao vira chave', () => {
		const { linhas } = consolidarLote(
			[
				relatorio([
					{ indice: 0, ok: true, id: 'a', casou_por: null },
					{ indice: 1, ok: true, id: 'b' },
				]),
			],
			[0],
		);

		expect(linhas[0].casouPor).toBeNull();
		expect('casouPor' in linhas[1]).toBe(false);
	});

	it('relatorio malformado nao derruba a consolidacao', () => {
		const { linhas, agregado } = consolidarLote(
			[null, 'nao é objeto', { resultados: 7 }],
			[0, 1, 2],
		);
		expect(linhas).toEqual([]);
		expect(agregado.blocos).toBe(3);
	});
});

describe('o JSON de cada item de saida', () => {
	it('o sucesso carrega id, criado, casou_por e o agregado do lote', () => {
		const { linhas, agregado } = consolidarLote(
			[relatorio([{ indice: 3, ok: true, id: 'abc', criado: true, casou_por: null }])],
			[0],
		);

		expect(jsonDaLinha(linhas[0], agregado)).toEqual({
			indice: 3,
			ok: true,
			id: 'abc',
			criado: true,
			casou_por: null,
			_lote: agregado,
		});
	});

	it('a falha carrega o erro, e NUNCA um id que ela nao tem', () => {
		const { linhas, agregado } = consolidarLote(
			[
				relatorio([
					{ indice: 1, ok: false, erro: { codigo: 'validacao', mensagem: 'Nome vazio.' } },
				]),
			],
			[0],
		);

		const json = jsonDaLinha(linhas[0], agregado);
		expect(json.ok).toBe(false);
		expect(json.erro).toEqual({ codigo: 'validacao', mensagem: 'Nome vazio.' });
		expect('id' in json).toBe(false);
	});
});

describe('resumo das falhas', () => {
	it('nomeia os indices e diz quantas de quantas falharam', () => {
		const { linhas } = consolidarLote(
			[
				relatorio([
					{ indice: 0, ok: true, id: 'a' },
					{ indice: 1, ok: false, erro: { codigo: 'validacao', mensagem: 'Email invalido.' } },
				]),
			],
			[0],
		);

		const resumo = resumoDasFalhas(linhas);
		expect(resumo).toContain('1 de 2');
		expect(resumo).toContain('#1');
		expect(resumo).toContain('Email invalido.');
	});

	it('acima de cinco falhas, resume o resto em vez de despejar tudo', () => {
		const resultados = Array.from({ length: 8 }, (_, n) => ({
			indice: n,
			ok: false,
			erro: { codigo: 'validacao', mensagem: `falha ${n}` },
		}));
		const { linhas } = consolidarLote([relatorio(resultados)], [0]);

		expect(resumoDasFalhas(linhas)).toContain('e mais 3');
	});
});

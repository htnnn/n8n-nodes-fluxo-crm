import type { IDataObject } from 'n8n-workflow';

/**
 * O transformador da resposta de `POST /v1/bulk/*`.
 *
 * POR QUE ELE EXISTE. A rota devolve **sempre HTTP 200**, inclusive quando
 * metade dos itens falhou: nao ha ramo que responda 4xx por falha de item. Um
 * node que emitisse a resposta crua produziria UM item verde com um agregado
 * dentro, e o usuario nao descobriria que 3 dos 200 nao entraram. Aqui o
 * relatorio vira N itens de saida, um por linha enviada, com o `indice`
 * apontando de volta para a posicao no array que o usuario montou.
 *
 * Forma da resposta (`api-publica/rotas/bulk.ts`):
 *
 * ```
 * { total, criados, atualizados, falhas,
 *   resultados: [ {indice, ok: true,  id, criado, casou_por}
 *               | {indice, ok: false, erro: {codigo, mensagem, detalhes?}} ] }
 * ```
 *
 * `indice` e 0-based e REINICIA em cada bloco de 200, porque o node fatia a
 * entrada. A reindexacao para o array completo acontece aqui — e o ponto onde
 * o `pairedItem` e o diagnostico costumam sair errados.
 *
 * Modulo puro: nao conhece o n8n nem faz requisicao.
 */

/** Teto de itens por requisicao (`MAX_ITENS` em `bulk.ts`). */
export const MAX_ITENS_POR_BLOCO = 200;

export interface ErroDeItemDoLote {
	codigo: string;
	mensagem: string;
	detalhes?: unknown;
}

export interface LinhaDoLote {
	/** Posicao no array COMPLETO enviado pelo usuario, ja reindexada. */
	indice: number;
	ok: boolean;
	id?: string;
	criado?: boolean;
	casouPor?: string | null;
	erro?: ErroDeItemDoLote;
}

export interface AgregadoDoLote {
	total: number;
	criados: number;
	atualizados: number;
	falhas: number;
	blocos: number;
}

export interface RelatorioConsolidado {
	linhas: LinhaDoLote[];
	agregado: AgregadoDoLote;
}

function objeto(valor: unknown): IDataObject {
	return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
		? (valor as IDataObject)
		: {};
}

function inteiro(valor: unknown): number {
	return typeof valor === 'number' && Number.isFinite(valor) ? valor : 0;
}

function erroDoResultado(valor: unknown): ErroDeItemDoLote {
	const bruto = objeto(valor);
	const detalhes = bruto.detalhes;
	return {
		codigo: typeof bruto.codigo === 'string' ? bruto.codigo : 'erro_item',
		mensagem:
			typeof bruto.mensagem === 'string' && bruto.mensagem !== ''
				? bruto.mensagem
				: 'Nao foi possivel gravar este item.',
		...(detalhes === undefined ? {} : { detalhes }),
	};
}

/**
 * Fatia a lista de itens em blocos do tamanho que a rota aceita.
 *
 * Nao valida o conteudo: quem decide o que e um item valido e o servidor, e
 * antecipar a regra aqui produziria duas validacoes divergentes.
 */
export function blocosDeItens<T>(itens: T[], tamanho: number = MAX_ITENS_POR_BLOCO): T[][] {
	const passo = Math.max(1, Math.trunc(tamanho));
	const blocos: T[][] = [];
	for (let inicio = 0; inicio < itens.length; inicio += passo) {
		blocos.push(itens.slice(inicio, inicio + passo));
	}
	return blocos;
}

/**
 * Junta os relatorios de todos os blocos numa lista unica de linhas.
 *
 * `deslocamentos[n]` e a posicao, no array completo, do primeiro item do bloco
 * `n`. Sem ele, o `indice: 0` do segundo bloco apontaria para o primeiro item
 * do array inteiro — e o usuario procuraria o defeito na linha errada.
 *
 * Resultado sem `indice` numerico usa a POSICAO dentro do proprio bloco: a
 * ordem de `resultados` espelha a de `itens` no servidor (`itens.entries()`),
 * entao a posicao e a melhor aproximacao disponivel, e nunca deixa uma falha
 * sem linha de saida.
 */
export function consolidarLote(
	relatorios: unknown[],
	deslocamentos: number[],
): RelatorioConsolidado {
	const linhas: LinhaDoLote[] = [];
	const agregado: AgregadoDoLote = {
		total: 0,
		criados: 0,
		atualizados: 0,
		falhas: 0,
		blocos: relatorios.length,
	};

	relatorios.forEach((bruto, bloco) => {
		const relatorio = objeto(bruto);
		const deslocamento = inteiro(deslocamentos[bloco]);

		agregado.total += inteiro(relatorio.total);
		agregado.criados += inteiro(relatorio.criados);
		agregado.atualizados += inteiro(relatorio.atualizados);
		agregado.falhas += inteiro(relatorio.falhas);

		const resultados = Array.isArray(relatorio.resultados) ? relatorio.resultados : [];

		resultados.forEach((cru, posicao) => {
			const resultado = objeto(cru);
			const local =
				typeof resultado.indice === 'number' && Number.isFinite(resultado.indice)
					? resultado.indice
					: posicao;

			const linha: LinhaDoLote = {
				indice: deslocamento + local,
				// O discriminador e `ok`, e nao um campo `status` — que nao existe.
				// Qualquer coisa diferente de `true` conta como falha, para que uma
				// forma inesperada nunca passe por sucesso.
				ok: resultado.ok === true,
			};

			if (linha.ok) {
				if (typeof resultado.id === 'string') linha.id = resultado.id;
				if (typeof resultado.criado === 'boolean') linha.criado = resultado.criado;
				// `casou_por` vem `null` quando criou. `null` e informacao, `undefined`
				// nao — por isso a chave so nasce quando o servidor a mandou.
				if ('casou_por' in resultado) {
					linha.casouPor = typeof resultado.casou_por === 'string' ? resultado.casou_por : null;
				}
			} else {
				linha.erro = erroDoResultado(resultado.erro);
			}

			linhas.push(linha);
		});
	});

	return { linhas, agregado };
}

/** O JSON de um item de saida de lote bem-sucedido. */
export function jsonDaLinha(linha: LinhaDoLote, agregado: AgregadoDoLote): IDataObject {
	const base: IDataObject = {
		indice: linha.indice,
		ok: linha.ok,
		_lote: { ...agregado },
	};

	if (linha.ok) {
		if (linha.id !== undefined) base.id = linha.id;
		if (linha.criado !== undefined) base.criado = linha.criado;
		if (linha.casouPor !== undefined) base.casou_por = linha.casouPor;
		return base;
	}

	base.erro = { ...linha.erro } as IDataObject;
	return base;
}

/** A mensagem do erro que sobe quando ha falha parcial e `continueOnFail` esta desligado. */
export function resumoDasFalhas(linhas: LinhaDoLote[]): string {
	const falhas = linhas.filter((linha) => !linha.ok);
	const amostra = falhas
		.slice(0, 5)
		.map((linha) => `#${linha.indice}: ${linha.erro?.mensagem ?? 'sem mensagem'}`)
		.join(' | ');

	const resto = falhas.length > 5 ? ` (e mais ${falhas.length - 5})` : '';
	return `${falhas.length} de ${linhas.length} itens do lote falharam — ${amostra}${resto}`;
}

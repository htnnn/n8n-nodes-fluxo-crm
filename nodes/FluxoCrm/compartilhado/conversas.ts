import type { IDataObject } from 'n8n-workflow';

/**
 * A varredura de `GET /atendimento/conversas`, que e a UNICA lista da v1 que
 * nao pagina por cursor keyset.
 *
 * O que o servidor faz (`api-publica/rotas/atendimento.ts`):
 *
 * ```ts
 * proximo_cursor: temMais ? dados[dados.length - 1]?.ultima_mensagem_em : null
 * ```
 *
 * ou seja, o cursor E a data do ultimo item da pagina, e ela volta em
 * **`antes_de`** — a rota nem le `cursor`. Tres consequencias que este modulo
 * existe para absorver:
 *
 * 1. uma pagina cujo ultimo item nao tem mensagem produz `tem_mais: true` com
 *    `proximo_cursor: null`, e a paginacao TRAVA. Nao e fim de lista, e o node
 *    nao pode fingir que foi;
 * 2. o filtro e `lt(ultima_mensagem_em, d)`, que exclui NULL; no Postgres o
 *    `ORDER BY ... DESC` poe NULLS FIRST. Conversas sem mensagem aparecem na
 *    primeira pagina e somem nas seguintes;
 * 3. nao ha desempate por `id`: conversas com o mesmo instante podem repetir
 *    entre paginas — dai a deduplicacao por `id` no acumulado.
 *
 * A funcao e pura de proposito: recebe o buscador como parametro e nao conhece
 * o n8n. E a regra que, errada, produz laco infinito dentro do processo do n8n
 * ou lista truncada em silencio.
 */

export interface PaginaPorData {
	dados: IDataObject[];
	/** `ultima_mensagem_em` do ultimo item, ou `null`. */
	proximoCursor: string | null;
	temMais: boolean;
}

export interface OpcoesDaVarredura {
	retornarTudo: boolean;
	/** Teto de itens quando `retornarTudo` e `false`. */
	limite: number;
	/** Teto de itens por requisicao. O servidor trunca acima de 200. */
	limitePorPagina: number;
	/** Teto de requisicoes da varredura inteira. */
	maxRequisicoes: number;
	registrarAviso?: (mensagem: string) => void;
}

/** Le uma resposta crua de `/atendimento/conversas` sem confiar na forma. */
export function lerPaginaPorData(corpo: unknown): PaginaPorData {
	const raiz =
		typeof corpo === 'object' && corpo !== null && !Array.isArray(corpo)
			? (corpo as IDataObject)
			: {};

	const cursor = raiz.proximo_cursor;
	return {
		dados: Array.isArray(raiz.dados) ? (raiz.dados as IDataObject[]) : [],
		proximoCursor: typeof cursor === 'string' && cursor !== '' ? cursor : null,
		temMais: raiz.tem_mais === true,
	};
}

/**
 * Percorre a lista de conversas seguindo `antes_de`.
 *
 * Para em qualquer uma destas condicoes, e nunca so na primeira:
 * - `temMais !== true`;
 * - `proximoCursor` nulo ou vazio;
 * - `proximoCursor` IGUAL ao anterior (guarda de resposta identica — sem ela, a
 *   ausencia de desempate por `id` no servidor vira laco infinito);
 * - pagina vazia;
 * - acumulado ja atingiu `limite`, quando `retornarTudo` e `false`;
 * - contador de requisicoes atingiu `maxRequisicoes`.
 */
export async function varrerConversas(
	buscar: (antesDe: string | undefined) => Promise<PaginaPorData>,
	opcoes: OpcoesDaVarredura,
): Promise<IDataObject[]> {
	const avisar = opcoes.registrarAviso ?? (() => undefined);
	const limite = Math.max(1, Math.trunc(opcoes.limite));

	const vistos = new Set<string>();
	const acumulado: IDataObject[] = [];

	let antesDe: string | undefined;
	let requisicoes = 0;

	while (requisicoes < opcoes.maxRequisicoes) {
		const pagina = await buscar(antesDe);
		requisicoes += 1;

		for (const conversa of pagina.dados) {
			const id = typeof conversa.id === 'string' ? conversa.id : undefined;
			if (id !== undefined) {
				if (vistos.has(id)) continue;
				vistos.add(id);
			}
			acumulado.push(conversa);
		}

		if (pagina.dados.length === 0) break;
		if (!opcoes.retornarTudo && acumulado.length >= limite) break;
		if (!pagina.temMais) break;

		if (pagina.proximoCursor === null) {
			// Esta e a condicao 1 do cabecalho: o servidor disse que ha mais e nao
			// soube dizer por onde continuar. Parar em silencio devolveria uma lista
			// incompleta que passa por completa.
			avisar(
				'A lista de conversas foi interrompida: o servidor respondeu tem_mais=true sem proximo_cursor, o que acontece quando a ultima conversa da pagina nao tem mensagem. Estreite o filtro por data para alcancar o resto.',
			);
			break;
		}

		if (pagina.proximoCursor === antesDe) {
			avisar(
				'A lista de conversas foi interrompida: o servidor repetiu o mesmo cursor de data duas vezes seguidas. Ha conversas com o mesmo instante de ultima mensagem e a rota nao desempata por identificador.',
			);
			break;
		}

		antesDe = pagina.proximoCursor;
	}

	if (requisicoes >= opcoes.maxRequisicoes) {
		avisar(
			`A varredura de conversas parou no teto de ${opcoes.maxRequisicoes} requisicoes. Estreite os filtros ou use um limite explicito.`,
		);
	}

	return opcoes.retornarTudo ? acumulado : acumulado.slice(0, limite);
}

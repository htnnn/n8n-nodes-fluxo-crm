import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { ehUuid } from './utilitarios';

/**
 * Os filtros por campo de modulo (`campo:{slug}[operador]=valor`), usados por
 * `negocio:listar` e por `registro:listar`.
 *
 * Vive aqui, e nao dentro de um dos dois recursos, porque as duas rotas leem o
 * MESMO motor (`api-publica/filtros-registro.ts`). Duas copias divergiriam na
 * primeira vez que um operador fosse acrescentado.
 */

/** Os 14 operadores aceitos em `campo:{slug}[operador]`. */
export const OPERADORES_DE_CAMPO = [
	'igual',
	'nao_igual',
	'contem',
	'nao_contem',
	'comeca_com',
	'termina_com',
	'vazio',
	'nao_vazio',
	'maior',
	'menor',
	'maior_igual',
	'menor_igual',
	'antes',
	'depois',
] as const;

/** Operadores que castam o valor no Postgres — texto aqui vira 500, nao 422. */
const OPERADORES_NUMERICOS = ['maior', 'menor', 'maior_igual', 'menor_igual'];
const OPERADORES_DE_DATA = ['antes', 'depois'];
/** Estes dois ignoram o valor, e tratam 0 e false como preenchidos. */
const OPERADORES_SEM_VALOR = ['vazio', 'nao_vazio'];

function objeto(valor: unknown): IDataObject {
	return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
		? (valor as IDataObject)
		: {};
}

/**
 * Traduz o `fixedCollection` de criterios para `campo:{slug}[operador]=valor`.
 *
 * Duas guardas locais, ambas por causa de comportamento medido do servidor:
 * o operador precisa ir em minusculas (maiuscula passa na regex e falha na
 * comparacao, com 422), e comparacao numerica ou de data com valor de outro
 * tipo estoura o cast do Postgres e volta como 500 `erro_interno`.
 */
export function filtrosDeCampo(
	ctx: IExecuteFunctions,
	nomeDoParametro: string,
	i: number,
): IDataObject {
	const bruto = objeto(ctx.getNodeParameter(nomeDoParametro, i, {}));
	const criterios = Array.isArray(bruto.criterios) ? (bruto.criterios as IDataObject[]) : [];
	const query: IDataObject = {};

	for (const criterio of criterios) {
		const slug = typeof criterio.slug === 'string' ? criterio.slug.trim() : '';
		if (slug === '') continue;

		const operador = (
			typeof criterio.operador === 'string' ? criterio.operador : 'igual'
		).toLowerCase();
		const valor = criterio.valor;

		if (OPERADORES_SEM_VALOR.includes(operador)) {
			query[`campo:${slug}[${operador}]`] = '';
			continue;
		}

		const texto = typeof valor === 'string' ? valor.trim() : String(valor ?? '');

		if (OPERADORES_NUMERICOS.includes(operador) && !Number.isFinite(Number(texto))) {
			throw new NodeOperationError(
				ctx.getNode(),
				`O filtro "${slug}" usa a comparacao "${operador}" com um valor que nao e numero`,
				{
					description: `Recebido: ${JSON.stringify(texto)}. Comparacao numerica com texto estoura o cast no banco e a API devolve 500, nao 422 — por isso o node confere antes de enviar.`,
					itemIndex: i,
				},
			);
		}

		if (OPERADORES_DE_DATA.includes(operador) && Number.isNaN(new Date(texto).getTime())) {
			throw new NodeOperationError(
				ctx.getNode(),
				`O filtro "${slug}" usa a comparacao "${operador}" com um valor que nao e data`,
				{
					description: `Recebido: ${JSON.stringify(texto)}. Comparacao de data com texto invalido estoura o cast no banco e a API devolve 500, nao 422.`,
					itemIndex: i,
				},
			);
		}

		query[`campo:${slug}[${operador}]`] = texto;
	}

	return query;
}

/**
 * Copia os filtros de uma `collection` para a query, conferindo o formato dos
 * identificadores.
 *
 * A conferencia local de UUID existe porque a API devolve **404** para
 * identificador malformado em filtro — o usuario receberia "nao encontrado" e
 * nao teria como distinguir de um registro de outra organizacao.
 */
export function filtrosSimples(
	ctx: IExecuteFunctions,
	nomeDoParametro: string,
	i: number,
	transformar?: (chave: string, valor: unknown) => unknown,
): IDataObject {
	const filtros = objeto(ctx.getNodeParameter(nomeDoParametro, i, {}));
	const query: IDataObject = {};

	for (const [chave, bruto] of Object.entries(filtros)) {
		if (bruto === undefined || bruto === '' || bruto === null) continue;

		if (chave.endsWith('_id') && !ehUuid(bruto)) {
			throw new NodeOperationError(
				ctx.getNode(),
				`O filtro "${chave}" nao recebeu um UUID valido`,
				{
					description:
						'A API devolve 404 (e nao 422) para identificador malformado em filtro, entao a conferencia acontece aqui.',
					itemIndex: i,
				},
			);
		}

		const valor = transformar === undefined ? bruto : transformar(chave, bruto);
		if (valor === undefined || valor === '' || valor === null) continue;
		query[chave] = valor as IDataObject[string];
	}

	return query;
}

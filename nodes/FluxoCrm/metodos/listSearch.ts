import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
} from 'n8n-workflow';

import { requisitar } from '../compartilhado/transporte';

/** Uma pagina de busca do `resourceLocator` — teto do servidor e 200. */
const LIMITE_DA_BUSCA = 50;

function texto(valor: unknown): string {
	return typeof valor === 'string' ? valor : '';
}

function dados(corpo: unknown): IDataObject[] {
	const raiz = corpo as IDataObject | null;
	return raiz !== null && Array.isArray(raiz.dados) ? (raiz.dados as IDataObject[]) : [];
}

/**
 * Busca de contatos para o modo "Da Lista" do `resourceLocator`.
 *
 * `GET /contatos` aceita `busca`, que faz ILIKE em nome, email e telefone —
 * entao o filtro digitado pelo usuario vai direto ao servidor.
 */
export async function buscarContatos(
	this: ILoadOptionsFunctions,
	filtro?: string,
): Promise<INodeListSearchResult> {
	const query: IDataObject = { limite: LIMITE_DA_BUSCA };
	if (filtro !== undefined && filtro.trim() !== '') query.busca = filtro.trim();

	const resposta = await requisitar(this, { metodo: 'GET', caminho: '/contatos', query });

	const resultados: INodeListSearchItems[] = dados(resposta.corpo)
		.map((contato) => ({
			name:
				texto(contato.nome) || texto(contato.email) || texto(contato.telefone) || texto(contato.id),
			value: texto(contato.id),
		}))
		.filter((item) => item.value !== '');

	return { results: resultados };
}

/**
 * Busca de negocios para o modo "Da Lista".
 *
 * `GET /negocios` NAO aceita `busca` — os filtros dele sao por pipeline,
 * estagio, dono, empresa e campo. Por isso o filtro digitado e aplicado em
 * memoria sobre a primeira pagina, e o rotulo diz isso ao usuario quando nada
 * casa.
 */
export async function buscarNegocios(
	this: ILoadOptionsFunctions,
	filtro?: string,
): Promise<INodeListSearchResult> {
	const resposta = await requisitar(this, {
		metodo: 'GET',
		caminho: '/negocios',
		query: { limite: LIMITE_DA_BUSCA },
	});

	const procurado = (filtro ?? '').trim().toLowerCase();

	const resultados: INodeListSearchItems[] = dados(resposta.corpo)
		.map((negocio) => {
			const valores = (negocio.valores ?? {}) as IDataObject;
			const rotulo = texto(valores.titulo) || texto(valores.nome) || texto(negocio.id);
			return { name: rotulo, value: texto(negocio.id) };
		})
		.filter((item) => item.value !== '')
		.filter((item) => procurado === '' || item.name.toLowerCase().includes(procurado));

	return { results: resultados };
}

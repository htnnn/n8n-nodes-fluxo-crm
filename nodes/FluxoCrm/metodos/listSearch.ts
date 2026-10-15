import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
} from 'n8n-workflow';

import { camposDoModulo } from '../compartilhado/capacidades';
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
 * Busca de empresas para o modo "Da Lista".
 *
 * `GET /empresas` aceita `busca`, que faz ILIKE em nome **e website** — entao o
 * filtro digitado vai direto ao servidor.
 */
export async function buscarEmpresas(
	this: ILoadOptionsFunctions,
	filtro?: string,
): Promise<INodeListSearchResult> {
	const query: IDataObject = { limite: LIMITE_DA_BUSCA };
	if (filtro !== undefined && filtro.trim() !== '') query.busca = filtro.trim();

	const resposta = await requisitar(this, { metodo: 'GET', caminho: '/empresas', query });

	const resultados: INodeListSearchItems[] = dados(resposta.corpo)
		.map((empresa) => ({
			name: texto(empresa.nome) || texto(empresa.cnpj) || texto(empresa.id),
			value: texto(empresa.id),
		}))
		.filter((item) => item.value !== '');

	return { results: resultados };
}

/**
 * Rotulo de um negocio na busca: o campo PRINCIPAL do modulo (FLU-1590), e so
 * entao `titulo`, `nome` e o id. Antes caia no uuid sempre que a organizacao
 * tinha renomeado o campo principal.
 */
export function rotuloDoNegocio(negocio: IDataObject, slugPrincipal: string | null): string {
	const valores = (negocio.valores ?? {}) as IDataObject;
	return (
		(slugPrincipal ? texto(valores[slugPrincipal]) : '') ||
		texto(valores.titulo) ||
		texto(valores.nome) ||
		texto(negocio.id)
	);
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
	const [resposta, campos] = await Promise.all([
		requisitar(this, { metodo: 'GET', caminho: '/negocios', query: { limite: LIMITE_DA_BUSCA } }),
		// Sem `meta:ler` o dicionario nao vem: o rotulo cai em titulo/nome.
		camposDoModulo(this, 'negocios').catch(() => [] as IDataObject[]),
	]);
	const principal = campos.find((c) => c.is_primario === true);
	const slugPrincipal = principal ? texto(principal.slug) || null : null;

	const procurado = (filtro ?? '').trim().toLowerCase();

	const resultados: INodeListSearchItems[] = dados(resposta.corpo)
		.map((negocio) => ({ name: rotuloDoNegocio(negocio, slugPrincipal), value: texto(negocio.id) }))
		.filter((item) => item.value !== '')
		.filter((item) => procurado === '' || item.name.toLowerCase().includes(procurado));

	return { results: resultados };
}

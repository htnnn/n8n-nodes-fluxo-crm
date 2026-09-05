import type { IDataObject } from 'n8n-workflow';

import { impressaoDaCredencial, resolverEscopos, type EstadoDeEscopos } from './escopos';
import { NOME_DA_CREDENCIAL, requisitar, type ContextoDeRequisicao } from './transporte';

/**
 * Ponte entre o resolvedor puro de escopos (`escopos.ts`) e o runtime do n8n.
 *
 * Tambem guarda o payload agregado de `GET /capabilities`, que serve os
 * dropdowns: abrir o painel de "Criar Negocio" com pipeline, dono e etiquetas
 * custa tres requisicoes pelos endpoints individuais e uma pelo agregado. Com
 * 120 req/min por chave, essa diferenca e um painel que responde contra um que
 * toma 429 no meio da edicao.
 */

const TTL_DAS_CAPACIDADES_MS = 60 * 1000;
const TETO_DE_CAPACIDADES = 500;

interface EntradaDeCapacidades {
	payload: IDataObject | null;
	expiraEm: number;
}

const capacidadesEmCache = new Map<string, EntradaDeCapacidades>();

function guardarCapacidades(impressao: string, payload: IDataObject | null): void {
	capacidadesEmCache.delete(impressao);
	capacidadesEmCache.set(impressao, {
		payload,
		expiraEm: Date.now() + TTL_DAS_CAPACIDADES_MS,
	});
	while (capacidadesEmCache.size > TETO_DE_CAPACIDADES) {
		const maisAntiga = capacidadesEmCache.keys().next();
		if (maisAntiga.done === true) break;
		capacidadesEmCache.delete(maisAntiga.value);
	}
}

async function impressaoDoContexto(ctx: ContextoDeRequisicao): Promise<string> {
	const credenciais = await ctx.getCredentials(NOME_DA_CREDENCIAL);
	return impressaoDaCredencial(credenciais.baseUrl, credenciais.apiKey);
}

/**
 * Resolve os escopos da chave da credencial atual.
 *
 * Fail-open por construcao: se `/capabilities` e `/me` falharem, devolve
 * "escopos desconhecidos" e nenhuma operacao e marcada com cadeado.
 */
export async function estadoDeEscopos(ctx: ContextoDeRequisicao): Promise<EstadoDeEscopos> {
	const credenciais = await ctx.getCredentials(NOME_DA_CREDENCIAL);
	const impressao = impressaoDaCredencial(credenciais.baseUrl, credenciais.apiKey);

	return await resolverEscopos({
		impressao,
		carimbo: credenciais.escoposDaChave,
		fontes: {
			buscarCapacidades: async () => {
				const payload = await buscarCapacidades(ctx, impressao);
				if (payload === null) throw new Error('capabilities indisponivel');
				return payload;
			},
			buscarContexto: async () => (await requisitar(ctx, { metodo: 'GET', caminho: '/me' })).corpo,
		},
		registrarAviso: (mensagem) => ctx.logger.debug(`[Fluxo CRM] ${mensagem}`),
	});
}

/**
 * Busca (uma vez por credencial, por minuto) o agregado `/capabilities`.
 *
 * `null` significa "esta instancia nao tem o endpoint" — e a resposta e
 * memorizada tambem nesse caso, para nao pagar um 404 por dropdown aberto.
 */
async function buscarCapacidades(
	ctx: ContextoDeRequisicao,
	impressao: string,
): Promise<IDataObject | null> {
	const entrada = capacidadesEmCache.get(impressao);
	if (entrada !== undefined && entrada.expiraEm > Date.now()) {
		return entrada.payload;
	}

	try {
		const resposta = await requisitar(ctx, { metodo: 'GET', caminho: '/capabilities' });
		const payload =
			typeof resposta.corpo === 'object' && resposta.corpo !== null ? resposta.corpo : null;
		guardarCapacidades(impressao, payload);
		return payload;
	} catch {
		// 404 numa instancia com API anterior ao /capabilities e o caso comum.
		guardarCapacidades(impressao, null);
		return null;
	}
}

/**
 * Devolve uma lista de descoberta (pipelines, usuarios, equipes, etiquetas...),
 * preferindo o agregado e caindo para o endpoint individual.
 *
 * Todos os `loadOptions` passam por aqui: quando `/capabilities` entrar no ar,
 * a migracao e uma linha, nao uma reescrita.
 *
 * ATENCAO: os nomes de chave dentro do agregado (`pipelines`, `usuarios`,
 * `etiquetas`, `camposDeNegocio`, `camposDeContato`) sao uma APOSTA — o
 * endpoint estava sendo escrito quando este node foi feito, e a forma real e
 * NAO VERIFICADA. Por isso a leitura e guardada por `Array.isArray` e cai para
 * o endpoint individual quando a chave nao existe: uma aposta errada custa uma
 * requisicao a mais, nunca um dropdown vazio.
 */
export async function listaDeDescoberta(
	ctx: ContextoDeRequisicao,
	chaveNoAgregado: string,
	caminhoIndividual: string,
	query?: IDataObject,
): Promise<IDataObject[]> {
	const impressao = await impressaoDoContexto(ctx);
	const agregado = await buscarCapacidades(ctx, impressao);

	const doAgregado = agregado?.[chaveNoAgregado];
	if (Array.isArray(doAgregado)) return doAgregado as IDataObject[];

	const resposta = await requisitar(ctx, { metodo: 'GET', caminho: caminhoIndividual, query });
	const corpo = resposta.corpo as IDataObject;
	return Array.isArray(corpo?.dados) ? (corpo.dados as IDataObject[]) : [];
}

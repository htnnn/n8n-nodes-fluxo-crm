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

/**
 * Os blocos de dado da organizacao que o agregado devolve, e o endpoint
 * individual de cada um.
 *
 * Forma conferida contra o handler (`api-publica/rotas/meta.ts`, `/capabilities`):
 *
 * ```
 * { chave, ator, organizacao, modulos, pipelines, usuarios, equipes,
 *   etiquetas, catalogo, blocos_omitidos, versao }
 * ```
 *
 * `camposDeContato` e `camposDeNegocio` NAO existem la — o dicionario de campos
 * continua saindo so por `GET /modulos/{slug}/campos`, e quem precisa dele nao
 * passa por este mapa.
 */
export const BLOCOS_DO_AGREGADO = {
	modulos: '/modulos',
	pipelines: '/pipelines',
	usuarios: '/usuarios',
	equipes: '/equipes',
	etiquetas: '/etiquetas',
} as const;

export type BlocoDoAgregado = keyof typeof BLOCOS_DO_AGREGADO;

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
 *
 * As duas rotas deixaram de exigir escopo, mas o fallback para `/me` continua:
 * uma instancia com API anterior a essa mudanca ainda devolve 404 em
 * `/capabilities`, e uma anterior ainda devolve 403 em `/me`.
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
 * `true` quando o agregado declarou que NAO pode mostrar aquele bloco.
 *
 * O handler responde 200 sempre. Quando a chave nao tem `meta:ler`, os blocos
 * de dado da organizacao voltam como lista VAZIA e o nome de cada um aparece em
 * `blocos_omitidos`. Sem ler esse campo, uma chave sem `meta:ler` produziria
 * dropdowns vazios indistinguiveis de "esta organizacao nao tem usuario nenhum"
 * — que e exatamente a conclusao errada que o campo existe para evitar.
 *
 * O endpoint individual tambem vai recusar (ele exige `meta:ler`), mas recusa
 * com 403 `escopo_insuficiente`, que sobe como erro nomeado em vez de virar
 * silencio.
 */
export function blocoOmitido(agregado: IDataObject | null, bloco: string): boolean {
	if (agregado === null) return false;
	const omitidos = agregado.blocos_omitidos;
	return Array.isArray(omitidos) && (omitidos as unknown[]).includes(bloco);
}

/**
 * Devolve uma lista de descoberta (modulos, pipelines, usuarios, equipes,
 * etiquetas), preferindo o agregado e caindo para o endpoint individual.
 *
 * Todos os `loadOptions` de descoberta passam por aqui, e a queda para o
 * endpoint individual acontece em tres casos, nesta ordem:
 *
 * 1. a instancia nao tem `/capabilities` (agregado `null`);
 * 2. o bloco esta em `blocos_omitidos` — a lista vazia dali NAO e resposta;
 * 3. ha `query` a aplicar (o recorte `?modulo_id=` das etiquetas, por exemplo):
 *    o agregado traz sempre a lista inteira e filtrar aqui reimplementaria uma
 *    regra do servidor.
 */
export async function listaDeDescoberta(
	ctx: ContextoDeRequisicao,
	bloco: BlocoDoAgregado,
	query?: IDataObject,
): Promise<IDataObject[]> {
	const temRecorte = query !== undefined && Object.keys(query).length > 0;

	if (!temRecorte) {
		const impressao = await impressaoDoContexto(ctx);
		const agregado = await buscarCapacidades(ctx, impressao);

		if (!blocoOmitido(agregado, bloco)) {
			const doAgregado = agregado?.[bloco];
			if (Array.isArray(doAgregado)) return doAgregado as IDataObject[];
		}
	}

	const resposta = await requisitar(ctx, {
		metodo: 'GET',
		caminho: BLOCOS_DO_AGREGADO[bloco],
		query,
	});
	const corpo = resposta.corpo as IDataObject;
	return Array.isArray(corpo?.dados) ? (corpo.dados as IDataObject[]) : [];
}

/**
 * O dicionario de campos de um modulo.
 *
 * Nao passa pelo agregado: `/capabilities` nao carrega campo nenhum, e nem
 * poderia — o dicionario e por modulo e a organizacao pode ter dezenas.
 *
 * A resposta traz os campos do layout e, depois deles, os campos de SISTEMA
 * (`sistema: true`: responsavel, equipe, criado em/por, atualizado em/por),
 * com `somente_leitura: true` nos que o servidor preenche. Instancia com API
 * anterior nao manda as duas flags — quem consome trata ausencia como `false`.
 */
export async function camposDoModulo(
	ctx: ContextoDeRequisicao,
	slug: string,
): Promise<IDataObject[]> {
	const resposta = await requisitar(ctx, {
		metodo: 'GET',
		caminho: `/modulos/${encodeURIComponent(slug)}/campos`,
	});
	const corpo = resposta.corpo as IDataObject;
	return Array.isArray(corpo?.dados) ? (corpo.dados as IDataObject[]) : [];
}

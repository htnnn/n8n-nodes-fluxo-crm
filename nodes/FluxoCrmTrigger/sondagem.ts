import type { IDataObject, INodeExecutionData, IPollFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { erroDeEscopoFaltante } from '../FluxoCrm/compartilhado/transporte';
import { encontrarRecursoSondavel, permitido, type RecursoSondavel } from './catalogo';
import { gravarMarca, instante, lerMarca, type MarcaDagua } from './estado';
import {
	erroDoGatilho,
	escoposDoGatilho,
	extrairDados,
	requisitarNoGatilho,
	texto,
} from './transporte';

/**
 * Sondagem — o caminho que nao depende de webhook.
 *
 * Ele existe por duas razoes, e nenhuma delas e conveniencia:
 *
 * 1. **Atendimento nao tem evento de webhook nenhum.** Nao ha
 *    `conversa.criada`, nem `mensagem.recebida`, nem `conversa.atribuida`.
 *    "Disparar quando chegar mensagem no WhatsApp" so existe por aqui.
 * 2. **Os webhooks da v1 so disparam quando a escrita passou PELA API.**
 *    `emitirEvento` e chamado exclusivamente de `api-publica/rotas/*`; o que a
 *    equipe faz na tela do CRM nao emite nada. Quem quiser reagir ao trabalho
 *    humano precisa sondar.
 *
 * Teto do plano: o intervalo minimo do n8n e 1 minuto e a API aceita 120
 * requisicoes por minuto por chave — por isso todo laco aqui tem teto de
 * paginas e de conversas visitadas.
 */

const LIMITE_PADRAO_POR_PAGINA = 100;
const LIMITE_MAXIMO_DA_PAGINA = 200;
const MAXIMO_DE_PAGINAS_PADRAO = 5;
const TETO_DE_PAGINAS = 25;
const MAXIMO_DE_CONVERSAS_PADRAO = 20;
const MENSAGENS_POR_CONVERSA_PADRAO = 50;

interface Opcoes {
	limitePorPagina: number;
	maximoDePaginas: number;
	statusDaConversa?: string;
	canalId?: string;
	somenteRecebidas: boolean;
	maximoDeConversas: number;
	mensagensPorConversa: number;
}

function inteiro(valor: unknown, padrao: number, minimo: number, maximo: number): number {
	const numero = typeof valor === 'number' ? Math.trunc(valor) : Number.NaN;
	if (!Number.isFinite(numero)) return padrao;
	return Math.min(Math.max(numero, minimo), maximo);
}

function lerOpcoes(ctx: IPollFunctions): Opcoes {
	const bruto = (ctx.getNodeParameter('opcoesDeSondagem', {}) ?? {}) as IDataObject;
	const status = texto(bruto.statusDaConversa).trim();
	const canal = texto(bruto.canalId).trim();

	return {
		limitePorPagina: inteiro(
			bruto.limitePorPagina,
			LIMITE_PADRAO_POR_PAGINA,
			1,
			LIMITE_MAXIMO_DA_PAGINA,
		),
		maximoDePaginas: inteiro(bruto.maximoDePaginas, MAXIMO_DE_PAGINAS_PADRAO, 1, TETO_DE_PAGINAS),
		statusDaConversa: status === '' ? undefined : status,
		canalId: canal === '' ? undefined : canal,
		somenteRecebidas: bruto.somenteRecebidas !== false,
		maximoDeConversas: inteiro(bruto.maximoDeConversas, MAXIMO_DE_CONVERSAS_PADRAO, 1, 200),
		mensagensPorConversa: inteiro(
			bruto.mensagensPorConversa,
			MENSAGENS_POR_CONVERSA_PADRAO,
			1,
			LIMITE_MAXIMO_DA_PAGINA,
		),
	};
}

/** Um item colhido, com o instante que decide a marca d'agua. */
interface Colhido {
	item: IDataObject;
	id: string;
	ms: number;
}

/** `true` quando o item e novo em relacao a marca. Os filtros da API sao `>=`. */
function ehNovo(colhido: Colhido, marca: MarcaDagua): boolean {
	if (marca.ms === undefined) return true;
	if (colhido.ms > marca.ms) return true;
	return colhido.ms === marca.ms && !marca.ids.includes(colhido.id);
}

function proximaMarca(colhidos: Colhido[], anterior: MarcaDagua): MarcaDagua {
	let ms = anterior.ms;
	for (const colhido of colhidos) {
		if (ms === undefined || colhido.ms > ms) ms = colhido.ms;
	}
	if (ms === undefined) return anterior;

	const ids = colhidos.filter((colhido) => colhido.ms === ms).map((colhido) => colhido.id);
	// Quando a marca nao andou, os ids da fronteira anterior continuam valendo.
	const anteriores = anterior.ms === ms ? anterior.ids : [];
	return { ms, ids: [...new Set([...anteriores, ...ids])] };
}

function colher(itens: IDataObject[], campo: string): Colhido[] {
	const saida: Colhido[] = [];
	for (const item of itens) {
		const ms = instante(item[campo]);
		const id = texto(item.id);
		if (ms === undefined || id === '') continue;
		saida.push({ item, id, ms });
	}
	return saida;
}

function caminhoDoRecurso(ctx: IPollFunctions, recurso: RecursoSondavel): string {
	if (!recurso.caminho.includes('{slug}')) return recurso.caminho;

	const slug = texto(ctx.getNodeParameter('slugDoModulo', '')).trim();
	if (!/^[a-z0-9][a-z0-9-]*$/i.test(slug)) {
		throw new NodeOperationError(ctx.getNode(), 'Informe o slug do modulo a sondar', {
			description:
				'O slug e o identificador do modulo na URL do CRM (por exemplo `contatos`, `negocios`, ou o slug de um modulo personalizado). Letras, numeros e hifens.',
		});
	}
	return recurso.caminho.replace('{slug}', slug);
}

/** Uma pagina de lista, ja separada em itens e continuacao. */
interface Pagina {
	itens: IDataObject[];
	proximoCursor: string | null;
	temMais: boolean;
}

async function buscarPagina(
	ctx: IPollFunctions,
	caminho: string,
	query: IDataObject,
): Promise<Pagina> {
	try {
		const resposta = await requisitarNoGatilho(ctx, { metodo: 'GET', caminho, query });
		const corpo = resposta.corpo;
		return {
			itens: extrairDados(corpo),
			proximoCursor: typeof corpo.proximo_cursor === 'string' ? corpo.proximo_cursor : null,
			temMais: corpo.tem_mais === true,
		};
	} catch (erro) {
		throw erroDoGatilho(ctx, erro, `GET ${caminho}`);
	}
}

// ── Recursos com filtro de data no servidor ──────────────────────────

/**
 * Lista paginada por cursor com filtro `criado_apos` / `atualizado_apos`.
 *
 * ARMADILHA DA API: as listas ordenam por `criado_em` DESC, mas
 * `atualizado_apos` filtra por `atualizado_em`. Um registro antigo que acabou
 * de ser editado aparece no FIM da ordenacao, nao no comeco — ler so a primeira
 * pagina perderia exatamente a atualizacao que se queria capturar. Por isso
 * este laco percorre o cursor ate `tem_mais` acabar (com teto de paginas), em
 * vez de parar quando encontra um item antigo.
 */
async function sondarComFiltro(
	ctx: IPollFunctions,
	recurso: RecursoSondavel,
	opcoes: Opcoes,
	marca: MarcaDagua,
	manual: boolean,
): Promise<Colhido[]> {
	const caminho = caminhoDoRecurso(ctx, recurso);
	const porAtualizacao =
		ctx.getNodeParameter('gatilhoDeSondagem', 'criado') === 'atualizado' &&
		recurso.filtroDeAtualizacao !== null;

	const campo = porAtualizacao ? recurso.campoDeAtualizacao : recurso.campoDeCriacao;
	const filtro = porAtualizacao ? recurso.filtroDeAtualizacao : recurso.filtroDeCriacao;

	if (manual) {
		const pagina = await buscarPagina(ctx, caminho, { limite: 1 });
		return colher(pagina.itens, campo);
	}

	const query: IDataObject = { limite: opcoes.limitePorPagina };
	if (filtro !== null && marca.ms !== undefined) {
		query[filtro] = new Date(marca.ms).toISOString();
	}

	const colhidos: Colhido[] = [];
	let cursor: string | null = null;

	for (let pagina = 0; pagina < opcoes.maximoDePaginas; pagina++) {
		const atual: Pagina = await buscarPagina(
			ctx,
			caminho,
			cursor === null ? query : { ...query, cursor },
		);
		colhidos.push(...colher(atual.itens, campo).filter((colhido) => ehNovo(colhido, marca)));

		if (!atual.temMais || atual.proximoCursor === null || atual.itens.length === 0) break;
		cursor = atual.proximoCursor;

		if (pagina === opcoes.maximoDePaginas - 1) {
			ctx.logger.warn(
				`[Fluxo CRM] A sondagem de ${recurso.valor} parou no teto de ${opcoes.maximoDePaginas} paginas e ainda havia mais. Aumente "Maximo de Paginas por Sondagem" ou reduza o intervalo.`,
			);
		}
	}

	return colhidos;
}

// ── Atendimento ──────────────────────────────────────────────────────

/**
 * Conversas que se moveram desde a marca.
 *
 * `GET /atendimento/conversas` nao tem filtro "depois de" — o cursor dela e
 * `antes_de`, e a ordenacao ja e por `ultima_mensagem_em` DESC. O corte,
 * portanto, e local: descemos pelas paginas enquanto todos os itens forem mais
 * novos que a marca e paramos no primeiro item antigo.
 */
async function conversasQueMoveram(
	ctx: IPollFunctions,
	opcoes: Opcoes,
	marca: MarcaDagua,
	manual: boolean,
): Promise<{ colhidos: Colhido[]; completo: boolean }> {
	const base: IDataObject = {};
	if (opcoes.statusDaConversa !== undefined) base.status = opcoes.statusDaConversa;
	if (opcoes.canalId !== undefined) base.canal_id = opcoes.canalId;

	if (manual) {
		const pagina = await buscarPagina(ctx, '/atendimento/conversas', { ...base, limite: 1 });
		return { colhidos: colher(pagina.itens, 'ultima_mensagem_em'), completo: true };
	}

	const colhidos: Colhido[] = [];
	let antesDe: string | null = null;
	let completo = false;

	for (let pagina = 0; pagina < opcoes.maximoDePaginas; pagina++) {
		const query: IDataObject = { ...base, limite: opcoes.limitePorPagina };
		if (antesDe !== null) query.antes_de = antesDe;

		const atual: Pagina = await buscarPagina(ctx, '/atendimento/conversas', query);
		const daPagina = colher(atual.itens, 'ultima_mensagem_em');
		const novos = daPagina.filter((colhido) => ehNovo(colhido, marca));
		colhidos.push(...novos);

		// Um item antigo nesta pagina significa que ja passamos da marca: como a
		// ordem e decrescente, nao ha nada mais novo abaixo.
		if (novos.length < daPagina.length || !atual.temMais || daPagina.length === 0) {
			completo = true;
			break;
		}

		antesDe = String(daPagina[daPagina.length - 1].item.ultima_mensagem_em ?? '');
		if (antesDe === '') {
			completo = true;
			break;
		}
	}

	return { colhidos, completo };
}

/**
 * Mensagens novas — o unico caminho para "chegou mensagem no WhatsApp".
 *
 * Custa uma requisicao por conversa que se moveu, porque
 * `GET /conversas/:id/mensagens` nao aceita filtro de data. O teto de conversas
 * por sondagem existe para que uma caixa movimentada nao consuma o limite de
 * 120 requisicoes por minuto da chave inteira.
 */
async function sondarMensagens(
	ctx: IPollFunctions,
	opcoes: Opcoes,
	marca: MarcaDagua,
	manual: boolean,
): Promise<{ colhidos: Colhido[]; marcaDeFronteira?: number }> {
	const conversas = await conversasQueMoveram(ctx, opcoes, marca, manual);
	if (conversas.colhidos.length === 0) return { colhidos: [] };

	const visitadas = conversas.colhidos.slice(0, manual ? 1 : opcoes.maximoDeConversas);
	const truncou = visitadas.length < conversas.colhidos.length;
	if (truncou) {
		ctx.logger.warn(
			`[Fluxo CRM] ${conversas.colhidos.length} conversas se moveram e a sondagem visitou ${visitadas.length}. Aumente "Maximo de Conversas por Sondagem" ou reduza o intervalo.`,
		);
	}

	const colhidos: Colhido[] = [];
	for (const conversa of visitadas) {
		const pagina = await buscarPagina(ctx, `/atendimento/conversas/${conversa.id}/mensagens`, {
			limite: manual ? 1 : opcoes.mensagensPorConversa,
		});

		for (const mensagem of colher(pagina.itens, 'enviado_em')) {
			if (opcoes.somenteRecebidas && mensagem.item.direcao !== 'entrada') continue;
			if (!manual && !ehNovo(mensagem, marca)) continue;
			colhidos.push({
				...mensagem,
				item: { ...mensagem.item, __conversa: conversa.item },
			});
		}
	}

	// Quando visitamos TODAS as conversas que se moveram, a marca pode avancar
	// ate a mais recente delas mesmo que nenhuma mensagem tenha passado no
	// filtro — uma nota interna, por exemplo, move a conversa sem virar mensagem
	// visivel aqui. Sem isso, aquela conversa seria relida em toda sondagem.
	const marcaDeFronteira =
		truncou || conversas.colhidos.length === 0
			? undefined
			: Math.max(...conversas.colhidos.map((conversa) => conversa.ms));

	return { colhidos, marcaDeFronteira };
}

// ── Entrada ──────────────────────────────────────────────────────────

export async function sondar(ctx: IPollFunctions): Promise<INodeExecutionData[][] | null> {
	// O n8n registra o webhook E inicia o poller quando os dois existem na
	// mesma classe. Em modo webhook a sondagem precisa sair de cena aqui.
	if (ctx.getNodeParameter('modo', 'polling') !== 'polling') return null;

	const valor = texto(ctx.getNodeParameter('recursoSondado', ''));
	const recurso = encontrarRecursoSondavel(valor);
	if (recurso === undefined) {
		throw new NodeOperationError(ctx.getNode(), `O recurso "${valor}" nao existe neste gatilho`, {
			description:
				'Reabra o campo "Recurso a Sondar". Se o workflow veio de outra versao do node, o recurso pode ter sido renomeado.',
		});
	}

	const escopos = await escoposDoGatilho(ctx);
	if (!permitido(recurso.escopo, escopos)) {
		throw erroDeEscopoFaltante(
			ctx as unknown as Parameters<typeof erroDeEscopoFaltante>[0],
			recurso.nome,
			recurso.escopo,
			escopos.escopos,
		);
	}

	const manual = ctx.getMode() === 'manual';
	const opcoes = lerOpcoes(ctx);
	const estado = ctx.getWorkflowStaticData('node');
	const marca = lerMarca(estado);

	// Primeira sondagem de um workflow ativo: fixa a marca e NAO emite nada.
	// Emitir a base inteira na ativacao e a forma mais rapida de inundar um
	// workflow — e nao e o que "disparar quando acontecer" quer dizer.
	if (!manual && marca.ms === undefined) {
		gravarMarca(estado, { ms: Date.now(), ids: [] });
		ctx.logger.info(
			'[Fluxo CRM] Primeira sondagem: marca d’agua fixada no instante atual. Os proximos ciclos emitem o que for novo a partir daqui.',
		);
		return null;
	}

	let colhidos: Colhido[];
	let marcaDeFronteira: number | undefined;

	if (recurso.valor === 'mensagem') {
		const resultado = await sondarMensagens(ctx, opcoes, marca, manual);
		colhidos = resultado.colhidos;
		marcaDeFronteira = resultado.marcaDeFronteira;
	} else if (recurso.valor === 'conversa') {
		colhidos = (await conversasQueMoveram(ctx, opcoes, marca, manual)).colhidos;
	} else {
		colhidos = await sondarComFiltro(ctx, recurso, opcoes, marca, manual);
	}

	// Em modo manual o usuario esta olhando o formato do dado; mexer na marca
	// aqui faria um teste na interface roubar itens da proxima execucao real.
	if (manual) {
		const amostra = colhidos.slice(0, 1);
		return amostra.length === 0 ? null : [amostra.map((colhido) => ({ json: colhido.item }))];
	}

	if (colhidos.length === 0) {
		if (marcaDeFronteira !== undefined && marcaDeFronteira > (marca.ms ?? 0)) {
			gravarMarca(estado, { ms: marcaDeFronteira, ids: [] });
		}
		// `null`, nunca `[]`: um array vazio conta como execucao com zero itens e
		// polui o historico a cada minuto.
		return null;
	}

	// Mais antigo primeiro: as listas da API vem em ordem decrescente, e um
	// workflow que processa eventos espera a ordem cronologica.
	colhidos.sort((a, b) => a.ms - b.ms);

	let adiante = proximaMarca(colhidos, marca);
	if (marcaDeFronteira !== undefined && marcaDeFronteira > (adiante.ms ?? 0)) {
		adiante = { ms: marcaDeFronteira, ids: [] };
	}
	gravarMarca(estado, adiante);

	return [colhidos.map((colhido) => ({ json: colhido.item }))];
}

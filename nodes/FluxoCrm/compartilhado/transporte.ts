import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	// eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions -- `requestWithAuthenticationPaginated` so aceita `IRequestOptions`; e a unica paginacao com maxRequests, requestInterval e guarda de resposta identica, e nao existe equivalente em `IHttpRequestOptions`
	IRequestOptions,
	JsonObject,
	PaginationOptions,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

export const NOME_DA_CREDENCIAL = 'fluxoCrmApi';

/** Teto duro do parametro `limite` da API (`api-publica/paginacao.ts`). */
export const LIMITE_MAXIMO_DA_PAGINA = 200;

/**
 * Teto de requisicoes de um unico `returnAll`. 200 paginas x 200 itens = 40.000
 * registros. Estourar isso levanta erro em vez de truncar em silencio.
 */
export const TETO_DE_REQUISICOES = 200;

/** Pausa entre paginas, em ms. O padrao da API e 120 req/min por chave. */
export const INTERVALO_ENTRE_PAGINAS_MS = 300;

export type ContextoDeRequisicao = IExecuteFunctions | ILoadOptionsFunctions;

export interface OpcoesDeRequisicao {
	metodo: IHttpRequestMethods;
	/** Caminho relativo a `baseUrl`, comecando com `/`. */
	caminho: string;
	corpo?: IDataObject;
	query?: IDataObject;
	cabecalhos?: Record<string, string>;
}

export interface RespostaDaApi<T = IDataObject> {
	corpo: T;
	status: number;
	cabecalhos: IDataObject;
}

export async function baseDaApi(ctx: ContextoDeRequisicao): Promise<string> {
	const credenciais = await ctx.getCredentials(NOME_DA_CREDENCIAL);
	const bruto = typeof credenciais.baseUrl === 'string' ? credenciais.baseUrl.trim() : '';
	return bruto.replace(/\/+$/, '');
}

/**
 * Uma requisicao a API.
 *
 * Sempre por `httpRequestWithAuthentication`: montar o header `Authorization` a
 * mao e proibido pelo lint do n8n, e alem disso e o unico caminho que dispara o
 * `preAuthentication` da credencial (medido no spike: `getCredentials()`
 * sozinho nao dispara).
 *
 * Devolve a resposta completa porque o status HTTP carrega informacao nesta API
 * — 201 criou / 200 atualizou nos upserts, 200 com `idempotente` nos reenvios.
 */
export async function requisitar<T = IDataObject>(
	ctx: ContextoDeRequisicao,
	opcoes: OpcoesDeRequisicao,
): Promise<RespostaDaApi<T>> {
	const base = await baseDaApi(ctx);

	const requisicao: IHttpRequestOptions = {
		method: opcoes.metodo,
		url: `${base}${opcoes.caminho}`,
		headers: { Accept: 'application/json', ...(opcoes.cabecalhos ?? {}) },
		json: true,
		returnFullResponse: true,
	};

	if (opcoes.query !== undefined && Object.keys(opcoes.query).length > 0) {
		requisicao.qs = opcoes.query;
	}
	if (opcoes.corpo !== undefined) {
		requisicao.body = opcoes.corpo;
		requisicao.headers = { ...requisicao.headers, 'Content-Type': 'application/json' };
	}

	try {
		const resposta = (await ctx.helpers.httpRequestWithAuthentication.call(
			ctx,
			NOME_DA_CREDENCIAL,
			requisicao,
		)) as { body: T; statusCode: number; headers: IDataObject };

		return {
			corpo: resposta.body,
			status: resposta.statusCode,
			cabecalhos: resposta.headers ?? {},
		};
	} catch (erro) {
		throw erroDaApi(ctx, erro, `${opcoes.metodo} ${opcoes.caminho}`);
	}
}

interface EnvelopeDeErro {
	codigo?: string;
	mensagem?: string;
	detalhes?: Array<{ campo?: string; mensagem?: string }>;
}

function comoObjeto(valor: unknown): Record<string, unknown> | null {
	return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
		? (valor as Record<string, unknown>)
		: null;
}

/**
 * Escava o envelope `{erro: {codigo, mensagem, detalhes}}` de dentro do erro que
 * o helper do n8n levanta. A forma varia conforme a camada que falhou, entao
 * tentamos os quatro lugares conhecidos em vez de assumir um.
 */
function extrairEnvelope(erro: unknown): {
	erro: EnvelopeDeErro | null;
	status: number | undefined;
	cabecalhos: Record<string, unknown>;
} {
	const raiz = comoObjeto(erro);
	if (raiz === null) return { erro: null, status: undefined, cabecalhos: {} };

	const resposta = comoObjeto(raiz.response);
	const candidatos = [
		comoObjeto(resposta?.data),
		comoObjeto(resposta?.body),
		comoObjeto(raiz.error),
		comoObjeto(raiz.body),
		comoObjeto(comoObjeto(raiz.cause)?.response),
	];

	let envelope: EnvelopeDeErro | null = null;
	for (const candidato of candidatos) {
		const interno = comoObjeto(candidato?.erro);
		if (interno !== null) {
			envelope = interno as EnvelopeDeErro;
			break;
		}
	}

	const status =
		typeof raiz.statusCode === 'number'
			? raiz.statusCode
			: typeof resposta?.status === 'number'
				? (resposta.status as number)
				: typeof raiz.httpCode === 'string'
					? Number(raiz.httpCode)
					: undefined;

	return {
		erro: envelope,
		status: Number.isFinite(status) ? status : undefined,
		cabecalhos: comoObjeto(resposta?.headers) ?? {},
	};
}

function detalhesLegiveis(envelope: EnvelopeDeErro | null): string {
	if (envelope === null || !Array.isArray(envelope.detalhes)) return '';
	const linhas = envelope.detalhes
		.map((detalhe) => {
			const campo = typeof detalhe?.campo === 'string' ? detalhe.campo : '';
			const mensagem = typeof detalhe?.mensagem === 'string' ? detalhe.mensagem : '';
			if (campo !== '' && mensagem !== '') return `${campo}: ${mensagem}`;
			return campo !== '' ? campo : mensagem;
		})
		.filter((linha) => linha !== '');
	return linhas.join(' | ');
}

/**
 * Traduz o erro da API para um `NodeApiError` com descricao acionavel.
 *
 * Sempre pelo `erro.codigo`, NUNCA pela `mensagem`: a mensagem e em pt-BR e a
 * propria especificacao avisa que ela muda sem aviso.
 */
export function erroDaApi(
	ctx: ContextoDeRequisicao,
	erro: unknown,
	contexto?: string,
): NodeApiError {
	if (erro instanceof NodeApiError) return erro;

	const { erro: envelope, status, cabecalhos } = extrairEnvelope(erro);
	const codigo = typeof envelope?.codigo === 'string' ? envelope.codigo : '';
	const mensagemDaApi =
		typeof envelope?.mensagem === 'string' && envelope.mensagem !== ''
			? envelope.mensagem
			: 'A API do Fluxo CRM recusou a requisicao';
	const detalhes = detalhesLegiveis(envelope);
	const ondeGerarChave = 'Gere uma chave nova em Configuracoes › Integracoes no Fluxo CRM.';

	let descricao: string;
	switch (codigo) {
		case 'nao_autenticado':
		case 'chave_invalida':
		case 'chave_revogada':
		case 'chave_expirada':
			descricao = `A chave de API foi recusada (${codigo}). ${ondeGerarChave}`;
			break;
		case 'assinatura_inativa':
			descricao =
				'A assinatura da organizacao esta inativa. Regularize o plano no Fluxo CRM antes de usar a API.';
			break;
		case 'ip_nao_permitido':
			descricao =
				'O IP desta instancia do n8n nao esta na lista permitida da chave de API. Libere-o em Configuracoes › Integracoes.';
			break;
		case 'escopo_insuficiente':
			descricao = `A chave nao tem o escopo exigido por esta operacao${
				detalhes !== '' ? ` (${detalhes})` : ''
			}. ${ondeGerarChave}`;
			break;
		case 'nao_encontrado':
			descricao =
				'Registro nao encontrado. Confira o identificador — um UUID malformado tambem devolve 404 nesta API. Se o caminho existe, o modulo pode nao estar habilitado nesta organizacao.';
			break;
		case 'conflito':
			descricao =
				detalhes !== ''
					? `Conflito recusado pelo servidor: ${detalhes}`
					: 'O servidor recusou a operacao por conflito de estado.';
			break;
		case 'idempotencia_conflito':
			descricao =
				'A mesma Idempotency-Key ja foi usada com um corpo diferente nas ultimas 24 horas. Use uma chave nova ou reenvie exatamente o mesmo corpo.';
			break;
		case 'idempotencia_em_andamento':
			descricao =
				'Uma requisicao com esta Idempotency-Key ainda esta em processamento. Tente de novo em alguns segundos.';
			break;
		case 'validacao':
			descricao =
				detalhes !== ''
					? `Campos recusados: ${detalhes}`
					: 'O corpo da requisicao foi recusado pela validacao do servidor.';
			break;
		case 'limite_excedido': {
			const esperar = cabecalhos['retry-after'] ?? cabecalhos['Retry-After'];
			descricao =
				esperar === undefined
					? 'Limite de requisicoes por minuto excedido (padrao: 120 por chave).'
					: `Limite de requisicoes por minuto excedido. O servidor pediu para aguardar ${String(esperar)} segundos (Retry-After).`;
			break;
		}
		case 'erro_interno':
			descricao =
				'A API respondeu com erro interno. Filtros de comparacao com valor de tipo errado (por exemplo `maior` com texto) sao uma causa conhecida deste 500.';
			break;
		default:
			descricao =
				detalhes !== ''
					? detalhes
					: 'Resposta inesperada da API do Fluxo CRM. Confira a conectividade e a URL base da credencial.';
	}

	const mensagem = contexto === undefined ? mensagemDaApi : `${mensagemDaApi} (${contexto})`;

	return new NodeApiError(ctx.getNode(), erro as JsonObject, {
		message: mensagem,
		description: descricao,
		httpCode: status === undefined ? undefined : String(status),
	});
}

/**
 * O erro que o usuario recebe ao executar uma operacao com cadeado.
 *
 * Existe para que a mensagem NUNCA seja o generico do n8n
 * (`The value "x" is not supported!`), que nao diz qual escopo falta nem onde
 * conseguir um.
 */
export function erroDeEscopoFaltante(
	ctx: ContextoDeRequisicao,
	rotuloDaOperacao: string,
	escopo: string,
	escoposDaChave: readonly string[],
): NodeApiError {
	const tem =
		escoposDaChave.length === 0 ? 'nenhum escopo' : `os escopos ${escoposDaChave.join(', ')}`;

	return new NodeApiError(
		ctx.getNode(),
		{ message: 'escopo_insuficiente', escopo, operacao: rotuloDaOperacao } as JsonObject,
		{
			message: `A chave de API nao pode executar "${rotuloDaOperacao}"`,
			description: `Esta operacao exige o escopo ${escopo}, e a chave configurada tem ${tem}. Gere uma chave nova com esse escopo em Configuracoes › Integracoes no Fluxo CRM e atualize a credencial.`,
			httpCode: '403',
		},
	);
}

/**
 * Devolve o erro pronto para subir ao usuario.
 *
 * `NodeApiError` e `NodeOperationError` passam intactos — eles ja carregam a
 * descricao acionavel e o `itemIndex`. O resto vira `NodeApiError`, para que
 * nada chegue a interface como erro cru sem contexto de HTTP.
 */
export function comoErroDoNode(
	ctx: ContextoDeRequisicao,
	erro: unknown,
	contexto?: string,
): NodeApiError | NodeOperationError {
	if (erro instanceof NodeApiError || erro instanceof NodeOperationError) return erro;
	return erroDaApi(ctx, erro, contexto);
}

export interface OpcoesDeLista extends OpcoesDeRequisicao {
	/** `true` percorre todas as paginas ate o fim. */
	retornarTudo: boolean;
	/** Teto de itens quando `retornarTudo` e `false`. */
	limite: number;
	itemIndex: number;
}

function extrairDados(corpo: unknown): IDataObject[] {
	const raiz = comoObjeto(corpo);
	if (raiz === null) return [];
	return Array.isArray(raiz.dados) ? (raiz.dados as IDataObject[]) : [];
}

/**
 * Percorre uma lista paginada por cursor keyset (`{dados, proximo_cursor, tem_mais}`).
 *
 * Usa `requestWithAuthenticationPaginated` de proposito, e nao a paginacao
 * declarativa: so este helper tem `maxRequests`, `requestInterval` e a guarda
 * contra resposta identica. Um `continue` mal escrito na paginacao declarativa
 * vira laco infinito dentro do processo do n8n.
 *
 * `proximo_cursor` so vem preenchido quando `tem_mais` e `true`, mas o tipo nao
 * garante a reciproca — por isso a condicao de continuar exige os dois.
 */
export async function requisitarLista(
	ctx: IExecuteFunctions,
	opcoes: OpcoesDeLista,
): Promise<IDataObject[]> {
	const base = await baseDaApi(ctx);
	const query: IDataObject = { ...(opcoes.query ?? {}) };

	const limitePagina = opcoes.retornarTudo
		? LIMITE_MAXIMO_DA_PAGINA
		: Math.min(Math.max(1, Math.trunc(opcoes.limite)), LIMITE_MAXIMO_DA_PAGINA);
	query.limite = limitePagina;

	const precisaPaginar = opcoes.retornarTudo || Math.trunc(opcoes.limite) > LIMITE_MAXIMO_DA_PAGINA;

	if (!precisaPaginar) {
		const resposta = await requisitar(ctx, { ...opcoes, query });
		return extrairDados(resposta.corpo).slice(0, Math.trunc(opcoes.limite));
	}

	const maxRequests = opcoes.retornarTudo
		? TETO_DE_REQUISICOES
		: Math.min(TETO_DE_REQUISICOES, Math.ceil(Math.trunc(opcoes.limite) / LIMITE_MAXIMO_DA_PAGINA));

	// eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions -- ver a nota no import: a assinatura do helper de paginacao exige este tipo
	const requisicao: IRequestOptions = {
		method: opcoes.metodo,
		uri: `${base}${opcoes.caminho}`,
		qs: query,
		headers: { Accept: 'application/json', ...(opcoes.cabecalhos ?? {}) },
		json: true,
		resolveWithFullResponse: true,
	};

	const paginacao: PaginationOptions = {
		continue:
			'={{ $response.body.tem_mais === true && !!$response.body.proximo_cursor && ($response.body.dados || []).length > 0 }}',
		request: { qs: { cursor: '={{ $response.body.proximo_cursor }}' } },
		requestInterval: INTERVALO_ENTRE_PAGINAS_MS,
		maxRequests,
	};

	let paginas: Array<{ body?: unknown }>;
	try {
		paginas = (await ctx.helpers.requestWithAuthenticationPaginated.call(
			ctx,
			requisicao,
			opcoes.itemIndex,
			paginacao,
			NOME_DA_CREDENCIAL,
		)) as Array<{ body?: unknown }>;
	} catch (erro) {
		throw erroDaApi(ctx, erro, `${opcoes.metodo} ${opcoes.caminho}`);
	}

	// Deduplica por `id`: a API pagina por keyset com desempate, mas registros
	// escritos durante a varredura ainda podem aparecer duas vezes.
	const vistos = new Set<string>();
	const acumulado: IDataObject[] = [];
	for (const pagina of paginas) {
		for (const item of extrairDados(pagina?.body)) {
			const id = typeof item.id === 'string' ? item.id : undefined;
			if (id !== undefined) {
				if (vistos.has(id)) continue;
				vistos.add(id);
			}
			acumulado.push(item);
		}
	}

	if (opcoes.retornarTudo) {
		if (paginas.length >= TETO_DE_REQUISICOES) {
			throw new NodeOperationError(
				ctx.getNode(),
				`A varredura parou no teto de ${TETO_DE_REQUISICOES} requisicoes`,
				{
					description:
						'A lista tem mais paginas do que o teto de seguranca deste node. Estreite os filtros ou desligue "Retornar Tudo" e use um limite explicito.',
					itemIndex: opcoes.itemIndex,
				},
			);
		}
		return acumulado;
	}

	return acumulado.slice(0, Math.trunc(opcoes.limite));
}

/** Lista sem paginacao no servidor: a rota devolve tudo e o corte e local. */
export async function requisitarListaSimples(
	ctx: IExecuteFunctions,
	opcoes: OpcoesDeRequisicao & { retornarTudo: boolean; limite: number },
): Promise<IDataObject[]> {
	const resposta = await requisitar(ctx, opcoes);
	const dados = extrairDados(resposta.corpo);
	return opcoes.retornarTudo ? dados : dados.slice(0, Math.trunc(opcoes.limite));
}

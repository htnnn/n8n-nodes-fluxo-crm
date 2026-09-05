import type { IDataObject, IHookFunctions, IPollFunctions, IWebhookFunctions } from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

import { estadoDeEscopos } from '../FluxoCrm/compartilhado/capacidades';
import type { EstadoDeEscopos } from '../FluxoCrm/compartilhado/escopos';
import {
	comoErroDoNode,
	requisitar,
	type ContextoDeRequisicao,
	type OpcoesDeRequisicao,
	type RespostaDaApi,
} from '../FluxoCrm/compartilhado/transporte';

/**
 * Ponte entre os contextos do gatilho e o transporte compartilhado.
 *
 * `requisitar`, `erroDaApi` e `estadoDeEscopos` tipam o contexto como
 * `IExecuteFunctions | ILoadOptionsFunctions`. Os contextos de um trigger node
 * — `IPollFunctions`, `IHookFunctions`, `IWebhookFunctions` — NAO sao
 * estruturalmente atribuiveis a esse par: falta-lhes `getCurrentNodeParameter`
 * e os helpers de SSH/DataTable que `ILoadOptionsFunctions` declara.
 *
 * O que essas funcoes de fato consomem e apenas `getNode()`, `getCredentials()`,
 * `logger` e `helpers.httpRequestWithAuthentication`, que os TRES contextos de
 * gatilho tem. Por isso a conversao vive aqui, num unico lugar e explicada, em
 * vez de espalhada por chamada — quando o tipo do compartilhado for ampliado,
 * apaga-se uma funcao e nao uma duzia de casts. Nada em `FluxoCrm/` foi tocado.
 */

export type ContextoDoGatilho = IHookFunctions | IPollFunctions | IWebhookFunctions;

function comoContextoDeRequisicao(ctx: ContextoDoGatilho): ContextoDeRequisicao {
	return ctx as unknown as ContextoDeRequisicao;
}

export async function requisitarNoGatilho<T = IDataObject>(
	ctx: ContextoDoGatilho,
	opcoes: OpcoesDeRequisicao,
): Promise<RespostaDaApi<T>> {
	return await requisitar<T>(comoContextoDeRequisicao(ctx), opcoes);
}

export function erroDoGatilho(ctx: ContextoDoGatilho, erro: unknown, contexto?: string): Error {
	return comoErroDoNode(comoContextoDeRequisicao(ctx), erro, contexto);
}

export async function escoposDoGatilho(ctx: ContextoDoGatilho): Promise<EstadoDeEscopos> {
	return await estadoDeEscopos(comoContextoDeRequisicao(ctx));
}

/**
 * `true` quando o erro e um 404 da API.
 *
 * Vale para o ciclo de vida do webhook: assinatura apagada no CRM tem de
 * derrubar o `webhookId` guardado, e nao virar falha de ativacao. Qualquer
 * outro status significa "nao sei se existe", e ai continuar seria pior.
 *
 * `requisitar` ja converteu tudo em `NodeApiError` com o `httpCode` preenchido,
 * entao ler o codigo do envelope original nao e necessario aqui.
 */
export function ehNaoEncontrado(erro: unknown): boolean {
	return erro instanceof NodeApiError && erro.httpCode === '404';
}

/** Le uma lista `{dados: [...]}` sem assumir que o envelope veio como esperado. */
export function extrairDados(corpo: unknown): IDataObject[] {
	if (typeof corpo !== 'object' || corpo === null || Array.isArray(corpo)) return [];
	const dados = (corpo as IDataObject).dados;
	return Array.isArray(dados) ? (dados as IDataObject[]) : [];
}

export function texto(valor: unknown): string {
	return typeof valor === 'string' ? valor : '';
}

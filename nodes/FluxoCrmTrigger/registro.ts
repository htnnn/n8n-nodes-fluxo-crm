import type { IDataObject, IHookFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { erroDeEscopoFaltante } from '../FluxoCrm/compartilhado/transporte';
import { CORINGA_DE_EVENTOS, permitido } from './catalogo';
import { COMO_RESOLVER, conferirDestino } from './destino';
import { esquecerWebhook, gravarRegistroDoWebhook, lerRegistroDoWebhook } from './estado';
import {
	ehNaoEncontrado,
	erroDoGatilho,
	escoposDoGatilho,
	requisitarNoGatilho,
	texto,
} from './transporte';

/**
 * Ciclo de vida da assinatura de webhook no Fluxo CRM.
 *
 * As tres funcoes aqui sao o corpo dos metodos `webhookMethods.default` do
 * node. Elas ficam num modulo proprio porque a regra de lint
 * `webhook-lifecycle-complete` exige que os tres metodos apareçam LITERALMENTE
 * dentro do objeto `webhookMethods` da classe — o que se resolve com metodos
 * curtos que delegam para ca, e nao empurrando a logica toda para dentro da
 * descricao do node.
 */

const ESCOPO_DE_ESCRITA = 'webhooks:escrever';

/** `true` quando o node esta em modo webhook. Em sondagem nao ha nada a registrar. */
export function emModoWebhook(ctx: IHookFunctions): boolean {
	return ctx.getNodeParameter('modo', 'polling') === 'webhook';
}

function eventosEscolhidos(ctx: IHookFunctions): string[] {
	const bruto = ctx.getNodeParameter('eventos', []) as unknown;
	if (!Array.isArray(bruto)) return [];
	const vistos = new Set<string>();
	for (const item of bruto) {
		const evento = texto(item).trim();
		if (evento !== '') vistos.add(evento);
	}
	return [...vistos];
}

function descricaoDaAssinatura(ctx: IHookFunctions): string {
	const workflow = ctx.getWorkflow();
	const nome = texto(workflow.name).trim();
	const id = texto(workflow.id).trim();
	const identificacao = nome === '' ? (id === '' ? 'sem identificacao' : id) : `${nome} (${id})`;
	// 500 caracteres e o teto do campo no servidor (`criarSchema`).
	return `Criado pelo n8n — workflow ${identificacao}, node ${ctx.getNode().name}`.slice(0, 500);
}

/** As duas listas descrevem a mesma assinatura, independentemente da ordem. */
function mesmosEventos(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	const conjunto = new Set(a);
	return b.every((evento) => conjunto.has(evento));
}

async function exigirEscopoDeEscrita(ctx: IHookFunctions): Promise<void> {
	const estado = await escoposDoGatilho(ctx);
	if (permitido(ESCOPO_DE_ESCRITA, estado)) return;
	throw erroDeEscopoFaltante(
		ctx as unknown as Parameters<typeof erroDeEscopoFaltante>[0],
		'Webhook',
		ESCOPO_DE_ESCRITA,
		estado.escopos,
	);
}

// ── checkExists ──────────────────────────────────────────────────────

/**
 * Confere se a assinatura guardada ainda existe no servidor.
 *
 * Tres desfechos merecem atencao:
 *
 * - **404** — a assinatura foi apagada no CRM. Aqui esta a armadilha numero um
 *   dos trigger nodes: e obrigatorio limpar `webhookId` E `webhookSecret` do
 *   estado duravel antes de devolver `false`. Sem isso, `create` grava um id
 *   novo por cima e a ativacao seguinte repete o ciclo — assinaturas orfas se
 *   acumulam no CRM a cada ativacao.
 * - **segredo ausente** — o id sobreviveu mas o segredo nao. Devolver `true`
 *   deixaria um workflow ativo que recusa toda entrega por nao ter como
 *   verificar a assinatura; o segredo NAO e recuperavel (nem GET nem PATCH o
 *   devolvem). Entao a assinatura orfa e apagada e tudo recomeca.
 * - **evento ou situacao divergentes** — o usuario mudou a lista de eventos, ou
 *   o circuit breaker desativou a assinatura depois de 15 falhas seguidas. Os
 *   dois viram um PATCH aqui. Devolver `false` nesses casos criaria uma segunda
 *   assinatura e deixaria a primeira entregando em paralelo.
 */
export async function conferirWebhook(ctx: IHookFunctions): Promise<boolean> {
	if (!emModoWebhook(ctx)) return true;

	const estado = ctx.getWorkflowStaticData('node');
	const { id, segredo } = lerRegistroDoWebhook(estado);
	if (id === undefined || id === '') return false;

	let assinatura: IDataObject;
	try {
		assinatura = (await requisitarNoGatilho(ctx, { metodo: 'GET', caminho: `/webhooks/${id}` }))
			.corpo;
	} catch (erro) {
		if (ehNaoEncontrado(erro)) {
			esquecerWebhook(estado);
			ctx.logger.info(
				`[Fluxo CRM] A assinatura de webhook ${id} nao existe mais no servidor; o node vai registrar uma nova.`,
			);
			return false;
		}
		throw erroDoGatilho(ctx, erro, 'conferir a assinatura de webhook');
	}

	if (segredo === undefined || segredo === '') {
		ctx.logger.warn(
			`[Fluxo CRM] A assinatura ${id} existe no servidor mas o segredo nao esta guardado neste node. O segredo so e devolvido na criacao, entao a assinatura sera recriada.`,
		);
		await removerNoServidor(ctx, id, 'assinatura sem segredo local');
		esquecerWebhook(estado);
		return false;
	}

	const eventos = eventosEscolhidos(ctx);
	const noServidor = Array.isArray(assinatura.eventos)
		? (assinatura.eventos as unknown[]).map(texto)
		: [];
	const precisaDeEventos = eventos.length > 0 && !mesmosEventos(eventos, noServidor);
	const precisaReativar = assinatura.ativo === false;

	if (!precisaDeEventos && !precisaReativar) return true;

	const corpo: IDataObject = {};
	if (precisaDeEventos) corpo.eventos = eventos;
	// Reativar zera o contador de falhas do servidor: sem isso a assinatura
	// voltaria ja no limite e se desativaria na primeira entrega ruim.
	if (precisaReativar) corpo.ativo = true;

	try {
		await requisitarNoGatilho(ctx, { metodo: 'PATCH', caminho: `/webhooks/${id}`, corpo });
		ctx.logger.info(
			`[Fluxo CRM] Assinatura ${id} ajustada${precisaDeEventos ? ' (eventos)' : ''}${
				precisaReativar ? ' (reativada)' : ''
			}.`,
		);
		return true;
	} catch (erro) {
		throw erroDoGatilho(ctx, erro, 'ajustar a assinatura de webhook');
	}
}

// ── create ───────────────────────────────────────────────────────────

export async function criarWebhook(ctx: IHookFunctions): Promise<boolean> {
	if (!emModoWebhook(ctx)) return true;

	await exigirEscopoDeEscrita(ctx);

	const url = ctx.getNodeWebhookUrl('default');
	const veredicto = conferirDestino(url);
	if (!veredicto.aceitavel) {
		throw new NodeOperationError(
			ctx.getNode(),
			`O Fluxo CRM nao aceita a URL de webhook desta instancia: ${veredicto.motivo}`,
			{
				description: `URL recebida: ${texto(url) || '(vazia)'}. ${COMO_RESOLVER}`,
			},
		);
	}

	const eventos = eventosEscolhidos(ctx);
	if (eventos.length === 0) {
		throw new NodeOperationError(ctx.getNode(), 'Escolha ao menos um evento para assinar', {
			description: `Sem evento nenhum a assinatura nunca dispararia. Use "${CORINGA_DE_EVENTOS}" (Todos os Eventos) se quiser tudo, inclusive o que o Fluxo CRM criar depois.`,
		});
	}

	let criada: IDataObject;
	try {
		criada = (
			await requisitarNoGatilho(ctx, {
				metodo: 'POST',
				caminho: '/webhooks',
				corpo: { url, eventos, descricao: descricaoDaAssinatura(ctx) },
			})
		).corpo;
	} catch (erro) {
		throw erroDoGatilho(ctx, erro, 'registrar a assinatura de webhook');
	}

	const id = texto(criada.id);
	const segredo = texto(criada.segredo);

	// O segredo vem UMA UNICA VEZ, nesta resposta. Nem GET nem PATCH o devolvem.
	// Uma assinatura sem segredo guardado entregaria eventos que este node nunca
	// conseguiria verificar — pior que nao existir, porque parece funcionar.
	if (id === '' || segredo === '') {
		if (id !== '') await removerNoServidor(ctx, id, 'resposta de criacao sem segredo');
		throw new NodeOperationError(
			ctx.getNode(),
			'A API criou a assinatura mas nao devolveu o segredo',
			{
				description:
					'O segredo do webhook so aparece na resposta de criacao e e o que permite verificar a assinatura das entregas. A assinatura recem-criada foi removida para nao ficar orfa. Confira a versao da API do Fluxo CRM desta instancia.',
			},
		);
	}

	const estado = ctx.getWorkflowStaticData('node');
	gravarRegistroDoWebhook(estado, { id, segredo });
	ctx.logger.info(`[Fluxo CRM] Assinatura de webhook ${id} criada para ${texto(url)}.`);
	return true;
}

// ── delete ───────────────────────────────────────────────────────────

export async function removerWebhook(ctx: IHookFunctions): Promise<boolean> {
	const estado = ctx.getWorkflowStaticData('node');
	const { id } = lerRegistroDoWebhook(estado);
	if (id === undefined || id === '') return true;

	try {
		await requisitarNoGatilho(ctx, { metodo: 'DELETE', caminho: `/webhooks/${id}` });
	} catch (erro) {
		if (!ehNaoEncontrado(erro)) {
			// Nao limpamos o estado aqui de proposito: enquanto o id continuar
			// guardado, a proxima ativacao/desativacao tenta de novo. Apaga-lo
			// deixaria uma assinatura viva no CRM que ninguem mais sabe remover.
			ctx.logger.error(
				`[Fluxo CRM] Falha ao remover a assinatura de webhook ${id}: ${(erro as Error).message}. Ela continua registrada; remova-a em Configuracoes › Integracoes se o workflow nao voltar.`,
			);
			return false;
		}
		ctx.logger.info(`[Fluxo CRM] A assinatura ${id} ja nao existia no servidor.`);
	}

	esquecerWebhook(estado);
	return true;
}

/** Remoçao de melhor esforço: usada para nao deixar assinatura orfa. Nunca levanta. */
async function removerNoServidor(ctx: IHookFunctions, id: string, porque: string): Promise<void> {
	try {
		await requisitarNoGatilho(ctx, { metodo: 'DELETE', caminho: `/webhooks/${id}` });
		ctx.logger.info(`[Fluxo CRM] Assinatura ${id} removida (${porque}).`);
	} catch (erro) {
		ctx.logger.warn(
			`[Fluxo CRM] Nao foi possivel remover a assinatura ${id} (${porque}): ${(erro as Error).message}. Remova-a em Configuracoes › Integracoes no Fluxo CRM.`,
		);
	}
}

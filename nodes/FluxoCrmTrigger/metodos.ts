import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { estadoDeEscopos } from '../FluxoCrm/compartilhado/capacidades';
import { opcoesDeEventosAssinaveis } from '../FluxoCrm/compartilhado/eventos';
import { requisitar } from '../FluxoCrm/compartilhado/transporte';
import { MODOS, opcoesComEscopo, RECURSOS_SONDAVEIS } from './catalogo';
import { extrairDados, texto } from './transporte';

/**
 * Metodos remotos do gatilho.
 *
 * `ILoadOptionsFunctions` e o unico contexto do node que o transporte
 * compartilhado ja aceita sem conversao, entao aqui as chamadas sao diretas.
 */

export async function carregarModos(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	return opcoesComEscopo(MODOS, await estadoDeEscopos(this));
}

export async function carregarRecursosSondaveis(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return opcoesComEscopo(RECURSOS_SONDAVEIS, await estadoDeEscopos(this));
}

/**
 * Os eventos assinaveis, do servidor quando possivel e da lista estatica
 * quando nao — a mesma rotina que serve `Webhook › Criar` no node de acoes
 * (`compartilhado/eventos.ts`, onde esta o porque do fallback).
 */
export async function carregarEventos(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return await opcoesDeEventosAssinaveis(this);
}

/** Canais de atendimento da organizacao, para filtrar a sondagem por canal. */
export async function carregarCanaisDeAtendimento(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const resposta = await requisitar(this, { metodo: 'GET', caminho: '/atendimento/canais' });
	return extrairDados(resposta.corpo)
		.map((linha) => ({
			name: `${texto(linha.nome)} (${texto(linha.tipo)})`,
			value: texto(linha.id),
		}))
		.filter((opcao) => opcao.value !== '');
}

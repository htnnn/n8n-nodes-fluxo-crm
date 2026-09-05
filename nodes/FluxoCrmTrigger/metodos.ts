import type { ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { estadoDeEscopos } from '../FluxoCrm/compartilhado/capacidades';
import { requisitar } from '../FluxoCrm/compartilhado/transporte';
import {
	EVENTOS_CONHECIDOS,
	MODOS,
	opcoesComEscopo,
	opcoesDeEvento,
	RECURSOS_SONDAVEIS,
} from './catalogo';
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
 * Os eventos assinaveis, do servidor quando possivel.
 *
 * `GET /webhooks/eventos` exige `webhooks:ler`, e uma chave criada so para
 * REGISTRAR webhooks pode ter apenas `webhooks:escrever` — os dois escopos sao
 * independentes nesta API ("escrever nao implica ler"). Sem o fallback, essa
 * chave perfeitamente valida abriria um `multiOptions` vazio e nao teria como
 * assinar nada. A lista estatica e o espelho de `EVENTOS_DISPONIVEIS`.
 */
export async function carregarEventos(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	try {
		const resposta = await requisitar(this, { metodo: 'GET', caminho: '/webhooks/eventos' });
		// Esta rota e a unica da API cujo `dados` traz STRINGS, e nao objetos —
		// por isso ela nao passa por `extrairDados`.
		const brutos = (resposta.corpo as { dados?: unknown }).dados;
		if (Array.isArray(brutos)) {
			const lista = brutos.map(texto).filter((evento) => evento !== '');
			if (lista.length > 0) return opcoesDeEvento(lista);
		}
	} catch {
		// 403 por falta de `webhooks:ler` e o caso comum, e nao e motivo para
		// deixar o usuario sem lista: a estatica cobre os eventos existentes.
		this.logger.debug(
			'[Fluxo CRM] GET /webhooks/eventos indisponivel; usando a lista estatica de eventos.',
		);
	}

	return opcoesDeEvento(EVENTOS_CONHECIDOS);
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

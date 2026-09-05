import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { filtrosSimples } from '../compartilhado/filtros';
import { requisitar, requisitarLista } from '../compartilhado/transporte';
import {
	cabecalhoDeIdempotencia,
	corpoDaColecao,
	exigirUuid,
	itemDeSaida as item,
	itensDaColecao,
	objeto,
	paraUtc,
	secaoUnica,
	texto,
} from '../compartilhado/utilitarios';

/**
 * Interacoes — reunioes, ligacoes, follow-ups e e-mails registrados contra uma
 * entidade do CRM.
 *
 * Os escopos `interacoes:ler` e `interacoes:escrever` eram concediveis no
 * painel desde que o catalogo nasceu e nao tinham porta nenhuma atras deles;
 * estas rotas sao essa porta.
 *
 * Duas guardas do servidor que aparecem como erro e o node nomeia:
 * - a entidade vinculada precisa ser DESTA organizacao (e, para registros,
 *   estar na visibilidade da chave), senao 404;
 * - `entidade_tipo: "lead"` numa organizacao sem o modulo Leads devolve 404
 *   "Rota nao encontrada", e nao 403.
 */

const CAMPOS_DE_DATA = ['data', 'data_lembrete'];

/** Le a recorrencia do `fixedCollection`, ou `undefined` quando nao foi preenchida. */
function recorrenciaDoCorpo(ctx: IExecuteFunctions, i: number): IDataObject | undefined {
	const secao = secaoUnica(ctx, 'recorrencia', i);
	const freq = texto(secao.freq).trim();
	if (freq === '') return undefined;

	const recorrencia: IDataObject = {
		freq,
		intervalo: Math.max(1, Math.trunc((secao.intervalo as number) ?? 1)),
	};

	const ate = paraUtc(secao.ate);
	if (ate !== undefined) recorrencia.ate = ate;

	return recorrencia;
}

/** Le os participantes do `fixedCollection`. So a criacao aceita este bloco. */
function participantesDoCorpo(ctx: IExecuteFunctions, i: number): IDataObject[] | undefined {
	const participantes: IDataObject[] = [];

	for (const bruto of itensDaColecao(ctx, 'participantes', i)) {
		const participante: IDataObject = {};

		const contato = texto(bruto.contato_id).trim();
		if (contato !== '') participante.contato_id = exigirUuid(ctx, contato, 'contato', i);

		const usuario = texto(bruto.usuario_id).trim();
		if (usuario !== '') participante.usuario_id = exigirUuid(ctx, usuario, 'usuario', i);

		const rsvp = texto(bruto.rsvp_state).trim();
		if (rsvp !== '') participante.rsvp_state = rsvp;

		// Participante sem contato e sem usuario nao aponta para ninguem: o
		// servidor o aceitaria e gravaria uma linha vazia na agenda.
		if (participante.contato_id === undefined && participante.usuario_id === undefined) continue;
		participantes.push(participante);
	}

	return participantes.length > 0 ? participantes : undefined;
}

function corpoDaInteracao(ctx: IExecuteFunctions, i: number, nomeDaColecao: string): IDataObject {
	return corpoDaColecao(ctx, nomeDaColecao, i, (chave, valor) =>
		CAMPOS_DE_DATA.includes(chave) ? paraUtc(valor) : valor,
	);
}

export async function executarInteracao(
	ctx: IExecuteFunctions,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operacao) {
		case 'listar': {
			const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
			const limite = ctx.getNodeParameter('limit', i, 50) as number;

			const dados = await requisitarLista(ctx, {
				metodo: 'GET',
				caminho: '/interacoes',
				query: filtrosSimples(ctx, 'filters', i),
				retornarTudo,
				limite,
				itemIndex: i,
			});
			return dados.map((interacao) => item(interacao, i));
		}

		case 'obter': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('interacaoId', i), 'interacao', i);
			const resposta = await requisitar(ctx, { metodo: 'GET', caminho: `/interacoes/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'excluir': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('interacaoId', i), 'interacao', i);
			const resposta = await requisitar(ctx, { metodo: 'DELETE', caminho: `/interacoes/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'criar': {
			const corpo = corpoDaInteracao(ctx, i, 'additionalFields');
			corpo.tipo = ctx.getNodeParameter('tipo', i, 'reuniao');
			corpo.titulo = texto(ctx.getNodeParameter('titulo', i, '')).trim();
			corpo.entidade_tipo = ctx.getNodeParameter('entidade_tipo', i, 'contato');
			corpo.entidade_id = exigirUuid(
				ctx,
				ctx.getNodeParameter('entidade_id', i),
				'entidade vinculada',
				i,
			);

			const data = paraUtc(ctx.getNodeParameter('data', i, ''));
			if (data === undefined) {
				throw new NodeOperationError(ctx.getNode(), 'A interacao precisa de data', {
					description:
						'Informe quando a interacao acontece ou aconteceu. O servidor exige data e hora completas.',
					itemIndex: i,
				});
			}
			corpo.data = data;

			if (corpo.titulo === '') {
				throw new NodeOperationError(ctx.getNode(), 'A interacao precisa de titulo', {
					description: 'O campo Titulo e obrigatorio, de 1 a 255 caracteres.',
					itemIndex: i,
				});
			}

			const recorrencia = recorrenciaDoCorpo(ctx, i);
			if (recorrencia !== undefined) corpo.recorrencia = recorrencia;

			const participantes = participantesDoCorpo(ctx, i);
			if (participantes !== undefined) corpo.participantes = participantes;

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: '/interacoes',
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});
			return [item(resposta.corpo, i)];
		}

		case 'atualizar': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('interacaoId', i), 'interacao', i);
			const corpo = corpoDaInteracao(ctx, i, 'updateFields');

			const recorrencia = recorrenciaDoCorpo(ctx, i);
			if (recorrencia !== undefined) corpo.recorrencia = recorrencia;

			if (Object.keys(corpo).length === 0) {
				throw new NodeOperationError(ctx.getNode(), 'Nenhum campo para atualizar', {
					description:
						'Preencha ao menos um campo em "Campos a Atualizar". A entidade vinculada nao e alteravel: o corpo do PATCH a recusa com 422.',
					itemIndex: i,
				});
			}

			const resposta = await requisitar(ctx, {
				metodo: 'PATCH',
				caminho: `/interacoes/${id}`,
				corpo,
			});
			return [item(resposta.corpo, i)];
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Interacao`,
				{ itemIndex: i },
			);
	}
}

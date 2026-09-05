import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { requisitar, requisitarListaSimples } from '../compartilhado/transporte';
import {
	cabecalhoDeIdempotencia,
	corpoDaColecao,
	exigirUuid,
	itemDeSaida as item,
	objeto,
	texto,
} from '../compartilhado/utilitarios';

/**
 * Assinaturas de webhook e suas entregas.
 *
 * O ponto que o node precisa deixar evidente: `POST /webhooks` devolve o
 * `segredo` UMA UNICA VEZ. Nem `GET /webhooks` nem `GET /webhooks/{id}` o
 * devolvem, e nao existe rota de rotacao — perde-lo significa recriar a
 * assinatura.
 */

/** Le a lista de eventos, tolerando texto separado por virgula vindo de expressao. */
function eventosDoCorpo(valor: unknown): string[] | undefined {
	const brutos = Array.isArray(valor) ? valor : typeof valor === 'string' ? valor.split(',') : [];
	const vistos = new Set<string>();

	for (const cru of brutos) {
		if (typeof cru !== 'string') continue;
		const evento = cru.trim();
		if (evento !== '') vistos.add(evento);
	}

	return vistos.size > 0 ? [...vistos] : undefined;
}

export async function executarWebhook(
	ctx: IExecuteFunctions,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operacao) {
		case 'listar':
		case 'listarEntregas':
		case 'listarEventos': {
			const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
			const limite = ctx.getNodeParameter('limit', i, 50) as number;

			let caminho = '/webhooks';
			if (operacao === 'listarEventos') caminho = '/webhooks/eventos';
			if (operacao === 'listarEntregas') {
				const id = exigirUuid(ctx, ctx.getNodeParameter('webhookId', i), 'assinatura', i);
				caminho = `/webhooks/${id}/entregas`;
			}

			const dados = await requisitarListaSimples(ctx, {
				metodo: 'GET',
				caminho,
				retornarTudo,
				limite,
			});

			// `GET /webhooks/eventos` devolve um array de strings, e nao de objetos.
			return dados.map((linha) => item(typeof linha === 'string' ? { evento: linha } : linha, i));
		}

		case 'obter': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('webhookId', i), 'assinatura', i);
			const resposta = await requisitar(ctx, { metodo: 'GET', caminho: `/webhooks/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'excluir': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('webhookId', i), 'assinatura', i);
			const resposta = await requisitar(ctx, { metodo: 'DELETE', caminho: `/webhooks/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'criar': {
			const url = texto(ctx.getNodeParameter('url', i, '')).trim();
			const eventos = eventosDoCorpo(ctx.getNodeParameter('eventos', i, []));

			if (!/^https:\/\//i.test(url)) {
				throw new NodeOperationError(ctx.getNode(), 'A URL do webhook precisa comecar com https', {
					description: `Recebido: ${JSON.stringify(url)}. O servidor recusa http sem TLS, credenciais na URL, localhost, dominios .local, .internal e metadata, e IP privado ou link-local.`,
					itemIndex: i,
				});
			}
			if (eventos === undefined) {
				throw new NodeOperationError(ctx.getNode(), 'Escolha ao menos um evento', {
					description:
						'A assinatura aceita de 1 a 50 eventos. Use o asterisco sozinho para assinar todos.',
					itemIndex: i,
				});
			}

			const corpo: IDataObject = { url, eventos, ...corpoDaColecao(ctx, 'additionalFields', i) };

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: '/webhooks',
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});

			const saida = objeto(resposta.corpo);
			const segredo = texto(saida.segredo);

			if (segredo === '') {
				ctx.logger.warn(
					'[Fluxo CRM] A assinatura foi criada mas a resposta nao trouxe o segredo. Sem ele nao ha como validar a assinatura das entregas, e nao existe rota de rotacao: recrie a assinatura.',
				);
			} else {
				ctx.logger.warn(
					`[Fluxo CRM] A assinatura ${String(saida.id)} devolveu o segredo NESTA resposta e em nenhuma outra: guarde-o agora, no proprio fluxo. Nem "Obter" nem "Listar" o devolvem, e nao ha rotacao.`,
				);
			}

			return [
				item(
					{
						...saida,
						// Redundante de proposito: o campo com nome proprio sobrevive a um
						// mapeamento distraido que so leve `id` e `url` adiante.
						__segredoSoAparecAqui: segredo === '' ? null : segredo,
					},
					i,
				),
			];
		}

		case 'atualizar': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('webhookId', i), 'assinatura', i);
			const corpo = corpoDaColecao(ctx, 'updateFields', i, (chave, valor) =>
				chave === 'eventos' ? eventosDoCorpo(valor) : valor,
			);

			if (Object.keys(corpo).length === 0) {
				throw new NodeOperationError(ctx.getNode(), 'Nenhum campo para atualizar', {
					description: 'Preencha ao menos um campo em "Campos a Atualizar"',
					itemIndex: i,
				});
			}

			const resposta = await requisitar(ctx, {
				metodo: 'PATCH',
				caminho: `/webhooks/${id}`,
				corpo,
			});
			return [item(resposta.corpo, i)];
		}

		case 'testar': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('webhookId', i), 'assinatura', i);
			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));

			// Devolve 202 com `{entrega_id, enfileirada}`: a entrega ainda nao
			// aconteceu quando esta resposta chega.
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: `/webhooks/${id}/testar`,
				corpo: {},
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});
			return [item({ ...objeto(resposta.corpo), __statusHttp: resposta.status }, i)];
		}

		case 'reenviarEntrega': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('entregaId', i), 'entrega', i);
			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));

			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: `/webhooks/entregas/${id}/reenviar`,
				corpo: {},
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});
			return [item({ ...objeto(resposta.corpo), __statusHttp: resposta.status }, i)];
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Webhook`,
				{ itemIndex: i },
			);
	}
}

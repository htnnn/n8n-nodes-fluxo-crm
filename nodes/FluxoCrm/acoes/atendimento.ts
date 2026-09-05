import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { lerPaginaPorData, varrerConversas } from '../compartilhado/conversas';
import { filtrosSimples } from '../compartilhado/filtros';
import {
	LIMITE_MAXIMO_DA_PAGINA,
	requisitar,
	requisitarListaSimples,
	TETO_DE_REQUISICOES,
} from '../compartilhado/transporte';
import {
	cabecalhoDeIdempotencia,
	corpoDaColecao,
	exigirUuid,
	itemDeSaida as item,
	objeto,
	texto,
} from '../compartilhado/utilitarios';

/**
 * Atendimento: conversas, mensagens, canais e agentes.
 *
 * O caso especial esta em `conversa:listar` — a unica lista da v1 que pagina
 * por DATA e nao por cursor keyset. A regra do laco vive em
 * `compartilhado/conversas.ts`, que e puro e testado; aqui so ha a ligacao com
 * o transporte.
 */

function limiteDaPagina(retornarTudo: boolean, limite: number): number {
	if (retornarTudo) return LIMITE_MAXIMO_DA_PAGINA;
	return Math.min(Math.max(1, Math.trunc(limite)), LIMITE_MAXIMO_DA_PAGINA);
}

async function listarConversas(ctx: IExecuteFunctions, i: number): Promise<INodeExecutionData[]> {
	const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
	const limite = ctx.getNodeParameter('limit', i, 50) as number;
	const filtros = filtrosSimples(ctx, 'filters', i);

	const dados = await varrerConversas(
		async (antesDe) => {
			const query: IDataObject = { ...filtros, limite: limiteDaPagina(retornarTudo, limite) };
			// `antes_de` e ao mesmo tempo o filtro e o cursor desta rota. Enquanto o
			// laco nao avanca, vale o que o usuario informou.
			if (antesDe !== undefined) query.antes_de = antesDe;

			const resposta = await requisitar(ctx, {
				metodo: 'GET',
				caminho: '/atendimento/conversas',
				query,
			});
			return lerPaginaPorData(resposta.corpo);
		},
		{
			retornarTudo,
			limite,
			limitePorPagina: limiteDaPagina(retornarTudo, limite),
			maxRequisicoes: TETO_DE_REQUISICOES,
			registrarAviso: (mensagem) => ctx.logger.warn(`[Fluxo CRM] ${mensagem}`),
		},
	);

	return dados.map((conversa) => item(conversa, i));
}

export async function executarAtendimento(
	ctx: IExecuteFunctions,
	recurso: string,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	if (recurso === 'canalAtendimento' || recurso === 'agenteAtendimento') {
		const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
		const limite = ctx.getNodeParameter('limit', i, 50) as number;
		const caminho = recurso === 'canalAtendimento' ? '/atendimento/canais' : '/atendimento/agentes';

		// Estas duas rotas nao leem query alguma: devolvem tudo, e o corte e local.
		const dados = await requisitarListaSimples(ctx, {
			metodo: 'GET',
			caminho,
			retornarTudo,
			limite,
		});
		return dados.map((linha) => item(linha, i));
	}

	if (recurso === 'conversa') {
		switch (operacao) {
			case 'listar':
				return await listarConversas(ctx, i);

			case 'obter': {
				const id = exigirUuid(ctx, ctx.getNodeParameter('conversaId', i), 'conversa', i);
				const resposta = await requisitar(ctx, {
					metodo: 'GET',
					caminho: `/atendimento/conversas/${id}`,
				});
				return [item(resposta.corpo, i)];
			}

			case 'atualizar': {
				const id = exigirUuid(ctx, ctx.getNodeParameter('conversaId', i), 'conversa', i);
				const corpo = corpoDaColecao(ctx, 'updateFields', i);

				if (Object.keys(corpo).length === 0) {
					throw new NodeOperationError(ctx.getNode(), 'Nenhum campo para atualizar', {
						description:
							'Informe o status, o responsavel ou os dois. O servidor recusa este PATCH vazio com 422.',
						itemIndex: i,
					});
				}

				const resposta = await requisitar(ctx, {
					metodo: 'PATCH',
					caminho: `/atendimento/conversas/${id}`,
					corpo,
				});
				return [item(resposta.corpo, i)];
			}

			default:
				throw new NodeOperationError(
					ctx.getNode(),
					`A operacao "${operacao}" nao existe no recurso Conversa`,
					{ itemIndex: i },
				);
		}
	}

	const conversaId = exigirUuid(ctx, ctx.getNodeParameter('conversaId', i), 'conversa', i);

	switch (operacao) {
		case 'listar': {
			const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
			const limite = ctx.getNodeParameter('limit', i, 50) as number;

			// Sem cursor e sem `antes_de`: teto duro de 200 mensagens.
			const dados = await requisitarListaSimples(ctx, {
				metodo: 'GET',
				caminho: `/atendimento/conversas/${conversaId}/mensagens`,
				query: { limite: retornarTudo ? 200 : Math.min(Math.max(1, Math.trunc(limite)), 200) },
				retornarTudo,
				limite,
			});
			return dados.map((mensagem) => item(mensagem, i));
		}

		case 'enviar': {
			const conteudo = texto(ctx.getNodeParameter('conteudo', i, '')).trim();
			if (conteudo === '') {
				throw new NodeOperationError(ctx.getNode(), 'A mensagem precisa de conteudo', {
					description:
						'A API publica so envia texto. Conteudo vazio devolve 422 com a mensagem "Midia ainda nao e suportada pela API publica".',
					itemIndex: i,
				});
			}

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			// `tipo` fica fixo em texto: o schema aceita imagem, arquivo, audio e
			// video, mas nao ha campo nenhum para anexar a midia.
			const corpo: IDataObject = { conteudo, tipo: 'texto' };

			if (typeof opcoes.client_message_id === 'string' && opcoes.client_message_id !== '') {
				corpo.client_message_id = exigirUuid(
					ctx,
					opcoes.client_message_id,
					'mensagem do cliente',
					i,
				);
			}
			if (typeof opcoes.parent_message_id === 'string' && opcoes.parent_message_id !== '') {
				corpo.parent_message_id = exigirUuid(ctx, opcoes.parent_message_id, 'mensagem citada', i);
			}

			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: `/atendimento/conversas/${conversaId}/mensagens`,
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});

			// 201 enviou, 200 e reenvio reconhecido pelo `client_message_id`. A
			// especificacao declara so 201, entao quem decide e o status.
			const saida = objeto(resposta.corpo);
			return [
				item(
					{
						...saida,
						__idempotente: saida.idempotente === true || resposta.status === 200,
						__statusHttp: resposta.status,
					},
					i,
				),
			];
		}

		case 'criarNotaInterna': {
			const conteudo = texto(ctx.getNodeParameter('conteudo', i, '')).trim();
			if (conteudo === '') {
				throw new NodeOperationError(ctx.getNode(), 'A nota interna precisa de conteudo', {
					description: 'O texto e obrigatorio, de 1 a 10000 caracteres.',
					itemIndex: i,
				});
			}

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: `/atendimento/conversas/${conversaId}/notas`,
				corpo: { conteudo },
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});
			return [item(resposta.corpo, i)];
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Mensagem`,
				{ itemIndex: i },
			);
	}
}

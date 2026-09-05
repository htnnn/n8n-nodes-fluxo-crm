import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { filtrosSimples } from '../compartilhado/filtros';
import { valoresDoMapeador } from '../compartilhado/mapeador';
import { requisitar, requisitarLista } from '../compartilhado/transporte';
import {
	cabecalhoDeIdempotencia,
	corpoDaColecao,
	envelopeDeEscrita,
	exigirUuid,
	itemDeSaida as item,
	objeto,
	paraUtc,
	texto,
} from '../compartilhado/utilitarios';

/**
 * O dicionario de `tarefas` anuncia `dono_id` e `equipe_id` como campos de
 * sistema, mas `POST/PATCH /atividades` sao `.strict()` e nao os aceitam: o
 * responsavel da atividade e `usuario_id`. Chegando pelo mapeador (so por
 * expressao — o mapper nao os oferece), a execucao recusa com este motivo.
 */
const ORIENTACAO_DE_SISTEMA =
	'A rota de atividades nao recebe dono nem equipe: o responsavel e o campo usuario_id, em Campos Adicionais. Tire o campo do mapeador.';

/** Le o `resourceMapper` de campos personalizados, sem campo de sistema. */
function dadosDaAtividade(ctx: IExecuteFunctions, i: number, operacao: string): IDataObject | undefined {
	return envelopeDeEscrita(ctx, i, valoresDoMapeador(ctx.getNodeParameter('dados', i, {})), {
		recurso: 'atividade',
		operacao,
		orientacao: ORIENTACAO_DE_SISTEMA,
	}).blob;
}

/**
 * Atividades — tarefas, ligacoes e reunioes presas a uma entidade do CRM.
 *
 * Duas armadilhas tratadas aqui:
 *
 * 1. `deadline` usa `z.string().datetime()` no servidor, que EXIGE `Z` e recusa
 *    offset. O `dateTime` do n8n emite offset local por padrao, entao o valor
 *    passa por `paraUtc` antes de sair — sem isso o usuario recebe 422 sem ter
 *    como diagnosticar.
 * 2. `dados` SUBSTITUI o blob inteiro de campos personalizados, como em Contato
 *    e Empresa e ao contrario de `valores` de Negocio e Registro.
 */

function corpoDaAtividade(ctx: IExecuteFunctions, i: number, nomeDaColecao: string): IDataObject {
	return corpoDaColecao(ctx, nomeDaColecao, i, (chave, valor) =>
		chave === 'deadline' ? paraUtc(valor) : valor,
	);
}

export async function executarAtividade(
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
				caminho: '/atividades',
				query: filtrosSimples(ctx, 'filters', i),
				retornarTudo,
				limite,
				itemIndex: i,
			});
			return dados.map((atividade) => item(atividade, i));
		}

		case 'obter': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('atividadeId', i), 'atividade', i);
			const resposta = await requisitar(ctx, { metodo: 'GET', caminho: `/atividades/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'excluir': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('atividadeId', i), 'atividade', i);
			// Esta rota NAO emite webhook: nao existe evento `atividade.removida`.
			const resposta = await requisitar(ctx, { metodo: 'DELETE', caminho: `/atividades/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'criar': {
			const corpo = corpoDaAtividade(ctx, i, 'additionalFields');
			corpo.tipo = ctx.getNodeParameter('tipo', i, 'tarefa');
			corpo.titulo = texto(ctx.getNodeParameter('titulo', i, '')).trim();
			corpo.entidade_tipo = ctx.getNodeParameter('entidade_tipo', i, 'contato');
			corpo.entidade_id = exigirUuid(
				ctx,
				ctx.getNodeParameter('entidade_id', i),
				'entidade vinculada',
				i,
			);

			if (corpo.titulo === '') {
				throw new NodeOperationError(ctx.getNode(), 'A atividade precisa de titulo', {
					description: 'O campo Titulo e obrigatorio, de 1 a 300 caracteres.',
					itemIndex: i,
				});
			}

			const dados = dadosDaAtividade(ctx, i, 'criar');
			if (dados !== undefined) corpo.dados = dados;

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: '/atividades',
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});
			return [item(resposta.corpo, i)];
		}

		case 'atualizar': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('atividadeId', i), 'atividade', i);
			const corpo = corpoDaAtividade(ctx, i, 'updateFields');

			const dados = dadosDaAtividade(ctx, i, 'atualizar');
			if (dados !== undefined) corpo.dados = dados;

			if (Object.keys(corpo).length === 0) {
				throw new NodeOperationError(ctx.getNode(), 'Nenhum campo para atualizar', {
					description: 'Preencha ao menos um campo em "Campos a Atualizar"',
					itemIndex: i,
				});
			}

			const resposta = await requisitar(ctx, {
				metodo: 'PATCH',
				caminho: `/atividades/${id}`,
				corpo,
			});
			return [item(resposta.corpo, i)];
		}

		case 'concluir': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('atividadeId', i), 'atividade', i);
			const feedback = texto(ctx.getNodeParameter('feedback', i, ''));

			// O corpo desta rota NAO passa por Zod: o handler le o JSON num try/catch,
			// aceita so `{feedback?}` e TRUNCA em 5000 caracteres em silencio. Avisar
			// aqui e a unica forma de o usuario saber que o texto foi cortado.
			if (feedback.length > 5000) {
				ctx.logger.warn(
					`[Fluxo CRM] O feedback tem ${feedback.length} caracteres e o servidor vai truncar em 5000 sem avisar no corpo da resposta.`,
				);
			}

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: `/atividades/${id}/concluir`,
				corpo: feedback === '' ? {} : { feedback },
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});
			return [item(resposta.corpo, i)];
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Atividade`,
				{ itemIndex: i },
			);
	}
}

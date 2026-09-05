import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { requisitar, requisitarListaSimples } from '../compartilhado/transporte';
import {
	cabecalhoDeIdempotencia,
	corpoDaColecao,
	exigirUuid,
	itemDeSaida as item,
	itensDaColecao,
	objeto,
	texto,
} from '../compartilhado/utilitarios';

/**
 * Funis e estagios.
 *
 * A leitura mora sob `meta:ler` e a escrita sob `pipelines:escrever` — o
 * escopo `pipelines:ler` existe no catalogo do CRM e nao libera nada.
 *
 * O upsert casa pelo NOME, comparado em minusculas e sem espacos de borda,
 * dentro do modulo (funil) ou do funil (estagio). Consequencia que precisa
 * ficar visivel: num funil que ja existe, so `is_padrao` e aplicado — nome,
 * estagios e o resto sao ignorados sem erro.
 */

const CAMPOS_DO_ESTAGIO = ['nome', 'tipo', 'probabilidade'];

/** Le os estagios do `fixedCollection`, preservando a ordem informada. */
function estagiosDoCorpo(ctx: IExecuteFunctions, i: number): IDataObject[] | undefined {
	const itens = itensDaColecao(ctx, 'estagios', i);
	const estagios: IDataObject[] = [];

	for (const bruto of itens) {
		const nome = texto(bruto.nome).trim();
		if (nome === '') continue;

		const estagio: IDataObject = { nome };
		for (const chave of CAMPOS_DO_ESTAGIO) {
			if (chave === 'nome') continue;
			const valor = bruto[chave];
			if (valor === undefined || valor === '') continue;
			estagio[chave] = valor;
		}
		estagios.push(estagio);
	}

	return estagios.length > 0 ? estagios : undefined;
}

export async function executarPipeline(
	ctx: IExecuteFunctions,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operacao) {
		case 'listar': {
			const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
			const limite = ctx.getNodeParameter('limit', i, 50) as number;

			// Rota sem paginacao no servidor: ela devolve todos os funis, com os
			// estagios ja aninhados. O corte e local.
			const dados = await requisitarListaSimples(ctx, {
				metodo: 'GET',
				caminho: '/pipelines',
				retornarTudo,
				limite,
			});
			return dados.map((pipeline) => item(pipeline, i));
		}

		case 'criarOuAtualizar': {
			const nome = texto(ctx.getNodeParameter('nome', i, '')).trim();
			if (nome === '') {
				throw new NodeOperationError(ctx.getNode(), 'O funil precisa de nome', {
					description:
						'O nome e a chave natural do upsert: e por ele que a API decide criar ou reaproveitar.',
					itemIndex: i,
				});
			}

			const corpo: IDataObject = {
				nome,
				modulo_slug: texto(ctx.getNodeParameter('modulo_slug', i, 'negocios')).trim() || 'negocios',
				is_padrao: ctx.getNodeParameter('is_padrao', i, false) as boolean,
			};

			const estagios = estagiosDoCorpo(ctx, i);
			if (estagios !== undefined) corpo.estagios = estagios;

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: '/pipelines/upsert',
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});

			return [
				item(
					{
						...objeto(resposta.corpo),
						__criado: resposta.status === 201,
						__statusHttp: resposta.status,
					},
					i,
				),
			];
		}

		case 'criarOuAtualizarEstagio': {
			const pipelineId = exigirUuid(ctx, ctx.getNodeParameter('pipelineId', i), 'pipeline', i);
			const nome = texto(ctx.getNodeParameter('nome', i, '')).trim();

			if (nome === '') {
				throw new NodeOperationError(ctx.getNode(), 'O estagio precisa de nome', {
					description: 'O nome e a chave natural do upsert dentro do funil.',
					itemIndex: i,
				});
			}

			const corpo: IDataObject = { nome, ...corpoDaColecao(ctx, 'additionalFields', i) };

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: `/pipelines/${pipelineId}/estagios/upsert`,
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});

			// A resposta NAO traz `pipeline_id`, embora a especificacao prometa.
			// Devolve-lo aqui evita que o proximo no do fluxo tenha de guardar o id
			// que ele acabou de informar.
			return [
				item(
					{
						...objeto(resposta.corpo),
						pipeline_id: pipelineId,
						__criado: resposta.status === 201,
						__statusHttp: resposta.status,
					},
					i,
				),
			];
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Pipeline`,
				{ itemIndex: i },
			);
	}
}

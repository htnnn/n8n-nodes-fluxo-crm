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
 * Anexos.
 *
 * Esta rota NAO faz upload: ela registra o vinculo entre uma entidade e uma URL
 * ja hospedada. O corpo e JSON, nao ha `multipart` e nao ha campo binario — por
 * isso o node nao expoe `binaryPropertyName`.
 *
 * O `dono_id` e forcado ao usuario da chave pelo servidor e nao e informavel.
 * Nenhuma rota de arquivos emite webhook.
 */
export async function executarArquivo(
	ctx: IExecuteFunctions,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operacao) {
		case 'listar': {
			const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
			const limite = ctx.getNodeParameter('limit', i, 50) as number;

			// Os dois sao OBRIGATORIOS: sem qualquer um deles a resposta e 422, e nao
			// a lista geral de anexos da organizacao.
			const query: IDataObject = {
				entidade_tipo: ctx.getNodeParameter('entidade_tipo', i, 'registro'),
				entidade_id: exigirUuid(ctx, ctx.getNodeParameter('entidade_id', i), 'entidade', i),
				limite: retornarTudo ? 200 : Math.min(Math.max(1, Math.trunc(limite)), 200),
			};

			const dados = await requisitarListaSimples(ctx, {
				metodo: 'GET',
				caminho: '/arquivos',
				query,
				retornarTudo,
				limite,
			});
			return dados.map((arquivo) => item(arquivo, i));
		}

		case 'obter': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('arquivoId', i), 'anexo', i);
			const resposta = await requisitar(ctx, { metodo: 'GET', caminho: `/arquivos/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'excluir': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('arquivoId', i), 'anexo', i);
			const resposta = await requisitar(ctx, { metodo: 'DELETE', caminho: `/arquivos/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'criar': {
			const url = texto(ctx.getNodeParameter('url', i, '')).trim();

			// A validacao anti-SSRF do servidor recusa http sem TLS. Conferir aqui
			// nomeia o problema; deixar passar devolveria um 422 generico sobre a URL.
			if (!/^https:\/\//i.test(url)) {
				throw new NodeOperationError(ctx.getNode(), 'A URL do anexo precisa comecar com https', {
					description: `Recebido: ${JSON.stringify(url)}. O servidor recusa http sem TLS, credenciais embutidas na URL, localhost, dominios .local e .internal e IP literal.`,
					itemIndex: i,
				});
			}

			const corpo: IDataObject = {
				entidade_tipo: ctx.getNodeParameter('entidade_tipo', i, 'registro'),
				entidade_id: exigirUuid(ctx, ctx.getNodeParameter('entidade_id', i), 'entidade', i),
				nome: texto(ctx.getNodeParameter('nome', i, '')).trim(),
				url,
				mime_type: texto(ctx.getNodeParameter('mime_type', i, '')).trim(),
				tamanho: Math.max(0, Math.trunc(ctx.getNodeParameter('tamanho', i, 0) as number)),
				...corpoDaColecao(ctx, 'additionalFields', i),
			};

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: '/arquivos',
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});
			return [item(resposta.corpo, i)];
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Arquivo`,
				{ itemIndex: i },
			);
	}
}

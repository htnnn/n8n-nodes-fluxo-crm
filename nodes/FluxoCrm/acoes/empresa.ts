import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { filtrosSimples } from '../compartilhado/filtros';
import { valoresDoMapeador } from '../compartilhado/mapeador';
import { requisitar, requisitarLista, requisitarListaSimples } from '../compartilhado/transporte';
import {
	aplicarNoTopo,
	cabecalhoDeIdempotencia,
	corpoDaColecao,
	envelopeDeEscrita,
	idDoLocalizador,
	itemDeSaida as item,
	objeto,
	propagarAvisos,
	texto,
	type EnvelopeDeEscrita,
} from '../compartilhado/utilitarios';

/**
 * Empresas.
 *
 * Duas diferencas em relacao a Contatos que o codigo tem de respeitar:
 *
 * - o corpo e `.strict()` SEM preparador, entao chave desconhecida devolve 422
 *   de verdade — inclusive `etiquetas`, que Empresas nao tem;
 * - o upsert NAO faz cascata: se a chave escolhida veio preenchida e nao casou,
 *   a API CRIA, em vez de tentar a proxima. E o oposto de `/contatos/upsert`.
 */

/** Le o corpo comum de criacao e atualizacao. */
function corpoDaEmpresa(ctx: IExecuteFunctions, i: number, nomeDaColecao: string): IDataObject {
	return corpoDaColecao(ctx, nomeDaColecao, i);
}

/**
 * Le o `resourceMapper` de campos personalizados.
 *
 * O responsavel vem do dicionario como campo de SISTEMA e vai para o topo do
 * corpo (`envelope.topo`), nao para `dados` — que e `.strict()` por fora e
 * livre por dentro, entao um `responsavel_id` dentro do blob seria gravado
 * como campo personalizado, em silencio.
 */
function dadosDaEmpresa(ctx: IExecuteFunctions, i: number, operacao: string): EnvelopeDeEscrita {
	return envelopeDeEscrita(ctx, i, valoresDoMapeador(ctx.getNodeParameter('dados', i, {})), {
		recurso: 'empresa',
		operacao,
	});
}

export async function executarEmpresa(
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
				caminho: '/empresas',
				query: filtrosSimples(ctx, 'filters', i),
				retornarTudo,
				limite,
				itemIndex: i,
			});
			return dados.map((empresa) => item(empresa, i));
		}

		case 'obter': {
			const id = idDoLocalizador(ctx, 'empresaId', 'empresa', i);
			const resposta = await requisitar(ctx, { metodo: 'GET', caminho: `/empresas/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'excluir': {
			const id = idDoLocalizador(ctx, 'empresaId', 'empresa', i);
			const resposta = await requisitar(ctx, { metodo: 'DELETE', caminho: `/empresas/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'listarContatos':
		case 'listarNegocios': {
			const id = idDoLocalizador(ctx, 'empresaId', 'empresa', i);
			const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
			const limite = ctx.getNodeParameter('limit', i, 50) as number;
			const filho = operacao === 'listarContatos' ? 'contatos' : 'negocios';

			// Sem cursor nestas duas rotas: o handler ignora o parametro e devolve
			// `{dados}` sem envelope de paginacao, com teto de 200.
			const dados = await requisitarListaSimples(ctx, {
				metodo: 'GET',
				caminho: `/empresas/${id}/${filho}`,
				query: { limite: retornarTudo ? 200 : Math.min(limite, 200) },
				retornarTudo,
				limite,
			});
			return dados.map((linha) => item(linha, i));
		}

		case 'criar': {
			const corpo = corpoDaEmpresa(ctx, i, 'additionalFields');
			corpo.nome = texto(ctx.getNodeParameter('nome', i, '')).trim();

			if (corpo.nome === '') {
				throw new NodeOperationError(ctx.getNode(), 'Uma empresa precisa de nome', {
					description: 'O campo Nome e obrigatorio nesta rota, de 1 a 300 caracteres.',
					itemIndex: i,
				});
			}

			const envelope = dadosDaEmpresa(ctx, i, 'criar');
			if (envelope.blob !== undefined) corpo.dados = envelope.blob;
			aplicarNoTopo(ctx, i, corpo, envelope.topo);

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: '/empresas',
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});
			return [item(propagarAvisos(ctx, resposta.corpo), i)];
		}

		case 'atualizar': {
			const id = idDoLocalizador(ctx, 'empresaId', 'empresa', i);
			const corpo = corpoDaEmpresa(ctx, i, 'updateFields');

			const envelope = dadosDaEmpresa(ctx, i, 'atualizar');
			if (envelope.blob !== undefined) corpo.dados = envelope.blob;
			aplicarNoTopo(ctx, i, corpo, envelope.topo);

			if (Object.keys(corpo).length === 0) {
				throw new NodeOperationError(ctx.getNode(), 'Nenhum campo para atualizar', {
					description:
						'Preencha ao menos um campo em "Campos a Atualizar" ou em "Campos Personalizados". O servidor recusa um PATCH sem nenhum campo mapeavel.',
					itemIndex: i,
				});
			}

			const resposta = await requisitar(ctx, {
				metodo: 'PATCH',
				caminho: `/empresas/${id}`,
				corpo,
			});
			return [item(propagarAvisos(ctx, resposta.corpo), i)];
		}

		case 'criarOuAtualizar': {
			const corpo = corpoDaEmpresa(ctx, i, 'additionalFields');
			// O nome continua obrigatorio mesmo quando o casamento e por CNPJ. E a
			// pegadinha mais cara desta rota.
			corpo.nome = texto(ctx.getNodeParameter('nome', i, '')).trim();
			corpo.chave = ctx.getNodeParameter('chave', i, 'cnpj') as string;

			if (corpo.nome === '') {
				throw new NodeOperationError(
					ctx.getNode(),
					'O upsert de empresa exige o nome mesmo casando por outro campo',
					{
						description:
							'O schema do servidor cobra o nome sempre, inclusive quando a chave de casamento e o CNPJ ou o site.',
						itemIndex: i,
					},
				);
			}

			const chave = corpo.chave as string;
			if (chave !== 'nome' && (corpo[chave] === undefined || corpo[chave] === '')) {
				throw new NodeOperationError(
					ctx.getNode(),
					`A chave de casamento "${chave}" foi escolhida sem o valor correspondente`,
					{
						description: `Preencha "${chave}" em "Campos Adicionais". Sem ele, a API nao teria por onde casar e criaria uma ficha nova a cada execucao.`,
						itemIndex: i,
					},
				);
			}

			const envelope = dadosDaEmpresa(ctx, i, 'criarOuAtualizar');
			if (envelope.blob !== undefined) corpo.dados = envelope.blob;
			aplicarNoTopo(ctx, i, corpo, envelope.topo);

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: '/empresas/upsert',
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});

			// 201 criou, 200 atualizou — a especificacao declara so 201.
			const saida = propagarAvisos(ctx, resposta.corpo);
			return [
				item(
					{
						...saida,
						__criado: saida.criado === true || resposta.status === 201,
						__statusHttp: resposta.status,
					},
					i,
				),
			];
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Empresa`,
				{ itemIndex: i },
			);
	}
}

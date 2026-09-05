import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { requisitar, requisitarListaSimples } from '../compartilhado/transporte';
import {
	cabecalhoDeIdempotencia,
	ehUuid,
	exigirUuid,
	itemDeSaida as item,
	objeto,
	slugDoModulo,
	texto,
} from '../compartilhado/utilitarios';

/**
 * Descoberta e plataforma: Modulo, Etiqueta e Organizacao.
 *
 * O recurso Etiqueta junta duas coisas diferentes de proposito, e a interface
 * as nomeia diferente: `listar` devolve o CATALOGO de etiquetas da organizacao,
 * enquanto `listarVinculos` devolve as etiquetas APLICADAS a um registro. Sao
 * tabelas distintas, e confundi-las e o erro de expectativa mais provavel aqui.
 *
 * `vincular` e `desvincular` sao a lacuna que a v1 tinha: o campo `etiquetas`
 * do corpo de contato e negocio ACRESCENTA e nunca remove, entao ate estas
 * rotas existirem uma automacao conseguia marcar e nunca desmarcar.
 */

async function listaSimples(
	ctx: IExecuteFunctions,
	i: number,
	caminho: string,
	query?: IDataObject,
): Promise<INodeExecutionData[]> {
	const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
	const limite = ctx.getNodeParameter('limit', i, 50) as number;

	const dados = await requisitarListaSimples(ctx, {
		metodo: 'GET',
		caminho,
		query,
		retornarTudo,
		limite,
	});
	return dados.map((linha) => item(linha, i));
}

/** O caminho de vinculo de etiqueta: `/entidades/{slug do modulo}/{id}/etiquetas`. */
function caminhoDoVinculo(ctx: IExecuteFunctions, i: number): string {
	const slug = slugDoModulo(ctx, 'moduloSlug', i);
	const entidadeId = exigirUuid(ctx, ctx.getNodeParameter('entidadeId', i), 'registro', i);
	return `/entidades/${encodeURIComponent(slug)}/${entidadeId}/etiquetas`;
}

async function executarModulo(
	ctx: IExecuteFunctions,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operacao) {
		case 'listar':
			return await listaSimples(ctx, i, '/modulos');

		case 'obter': {
			const slug = slugDoModulo(ctx, 'moduloSlug', i);
			const resposta = await requisitar(ctx, {
				metodo: 'GET',
				caminho: `/modulos/${encodeURIComponent(slug)}`,
			});
			return [item(resposta.corpo, i)];
		}

		case 'listarCampos': {
			const slug = slugDoModulo(ctx, 'moduloSlug', i);
			return await listaSimples(ctx, i, `/modulos/${encodeURIComponent(slug)}/campos`);
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Modulo`,
				{ itemIndex: i },
			);
	}
}

async function executarEtiqueta(
	ctx: IExecuteFunctions,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operacao) {
		case 'listar': {
			const filtros = objeto(ctx.getNodeParameter('filters', i, {}));
			const query: IDataObject = {};

			const moduloId = texto(filtros.modulo_id).trim();
			if (moduloId !== '') {
				// Valor fora do formato e IGNORADO em silencio pelo servidor, que
				// devolve a lista completa. Sem esta guarda, o usuario receberia
				// etiquetas de todos os modulos achando que filtrou por um.
				if (!ehUuid(moduloId)) {
					throw new NodeOperationError(
						ctx.getNode(),
						'O filtro de modulo precisa ser o ID do modulo, no formato UUID',
						{
							description: `Recebido: ${JSON.stringify(moduloId)}. E o identificador, e nao o slug. Um valor invalido seria ignorado em silencio pela API, que devolveria o catalogo inteiro.`,
							itemIndex: i,
						},
					);
				}
				query.modulo_id = moduloId;
			}

			return await listaSimples(ctx, i, '/etiquetas', query);
		}

		case 'listarVinculos': {
			const caminho = caminhoDoVinculo(ctx, i);
			return await listaSimples(ctx, i, caminho);
		}

		case 'vincular': {
			const caminho = caminhoDoVinculo(ctx, i);
			const modo = ctx.getNodeParameter('modoDeVinculo', i, 'nome') as string;

			// O corpo aceita um OU outro: mandar os dois devolve 422.
			const corpo: IDataObject =
				modo === 'id'
					? { etiqueta_id: exigirUuid(ctx, ctx.getNodeParameter('etiqueta_id', i), 'etiqueta', i) }
					: { nome: texto(ctx.getNodeParameter('nome', i, '')).trim() };

			if (modo !== 'id' && corpo.nome === '') {
				throw new NodeOperationError(ctx.getNode(), 'Informe o nome da etiqueta', {
					description: 'O nome tem de 1 a 100 caracteres. Nome inexistente e criado pelo servidor.',
					itemIndex: i,
				});
			}

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho,
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});

			// A resposta e a LISTA de etiquetas da entidade mais `ja_tinha`, que e o
			// campo que um fluxo idempotente le para nao registrar "apliquei" mil
			// vezes sobre o mesmo estado. Devolver um item so, com a lista dentro,
			// preserva os dois.
			return [item(objeto(resposta.corpo), i)];
		}

		case 'desvincular': {
			const caminho = caminhoDoVinculo(ctx, i);
			const etiquetaId = exigirUuid(ctx, ctx.getNodeParameter('etiquetaId', i), 'etiqueta', i);

			const resposta = await requisitar(ctx, {
				metodo: 'DELETE',
				caminho: `${caminho}/${etiquetaId}`,
			});

			// 200 mesmo quando nao havia vinculo: `removido` diz qual dos dois foi.
			return [item(objeto(resposta.corpo), i)];
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Etiqueta`,
				{ itemIndex: i },
			);
	}
}

async function executarOrganizacao(
	ctx: IExecuteFunctions,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operacao) {
		case 'obterContexto': {
			const resposta = await requisitar(ctx, { metodo: 'GET', caminho: '/me' });
			return [item(resposta.corpo, i)];
		}

		case 'obterCapacidades': {
			// Sem passar pelo cache de `capacidades.ts`: quem pediu esta operacao quer
			// o estado ATUAL, e nao o que os dropdowns memorizaram ha um minuto.
			const resposta = await requisitar(ctx, { metodo: 'GET', caminho: '/capabilities' });
			const corpo = objeto(resposta.corpo);

			const omitidos = Array.isArray(corpo.blocos_omitidos) ? corpo.blocos_omitidos : [];
			if (omitidos.length > 0) {
				ctx.logger.warn(
					`[Fluxo CRM] Estes blocos vieram VAZIOS porque a chave nao tem meta:ler, e nao porque a organizacao nao tenha o dado: ${omitidos.join(', ')}.`,
				);
			}

			return [item(corpo, i)];
		}

		case 'listarEscopos': {
			const resposta = await requisitar(ctx, { metodo: 'GET', caminho: '/catalogo' });
			return [item(resposta.corpo, i)];
		}

		case 'listarUsuarios':
			return await listaSimples(ctx, i, '/usuarios');

		case 'listarEquipes':
			return await listaSimples(ctx, i, '/equipes');

		case 'verificarDisponibilidade': {
			// A rota e aberta, mas o helper de autenticacao do n8n manda o cabecalho
			// assim mesmo — e inofensivo, porque `/ping` e registrada ANTES do
			// middleware de autenticacao e responde 200 a qualquer requisicao.
			const resposta = await requisitar(ctx, { metodo: 'GET', caminho: '/ping' });
			return [item({ ...objeto(resposta.corpo), __statusHttp: resposta.status }, i)];
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Organizacao`,
				{ itemIndex: i },
			);
	}
}

export async function executarPlataforma(
	ctx: IExecuteFunctions,
	recurso: string,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	if (recurso === 'modulo') return await executarModulo(ctx, operacao, i);
	if (recurso === 'etiqueta') return await executarEtiqueta(ctx, operacao, i);
	return await executarOrganizacao(ctx, operacao, i);
}

import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { filtrosDeCampo, filtrosSimples } from '../compartilhado/filtros';
import { valoresDoMapeador } from '../compartilhado/mapeador';
import { requisitar, requisitarLista } from '../compartilhado/transporte';
import {
	aplicarNoTopo,
	cabecalhoDeIdempotencia,
	corpoDaColecao,
	envelopeDeEscrita,
	exigirUuid,
	itemDeSaida as item,
	objeto,
	propagarAvisos,
	slugDoModulo,
} from '../compartilhado/utilitarios';

/**
 * Registros de qualquer modulo, inclusive os personalizados.
 *
 * Tres desvios do padrao da API vivem aqui:
 *
 * - a query e lida CRUA pelo servidor, entao parametro desconhecido e ignorado
 *   sem erro. Um typo em filtro nao avisa: devolve a lista inteira. Por isso o
 *   node monta a query a partir de uma lista fechada, e nunca repassa o que o
 *   usuario digitou;
 * - `valores` faz MERGE, ao contrario de `dados` de contato, empresa e
 *   atividade, que substituem;
 * - a criacao pode devolver 200 com apenas quatro chaves quando a politica de
 *   unicidade reutilizou um registro fora do recorte de visibilidade da chave.
 */

/**
 * `__donoId` dentro de `valores` e um atalho nao documentado do servico: ele
 * troca o dono e DESCARTA os demais campos do mesmo PATCH, sem erro. O
 * `resourceMapper` nunca gera essa chave sozinho, mas uma expressao do usuario
 * pode — e a perda silenciosa de dado e exatamente o que este node existe para
 * nao deixar acontecer.
 */
function recusarAtalhoDeDono(ctx: IExecuteFunctions, valores: IDataObject, i: number): void {
	if (!('__donoId' in valores)) return;

	throw new NodeOperationError(
		ctx.getNode(),
		'O campo __donoId nao pode ser enviado dentro dos valores do modulo',
		{
			description:
				'O servidor trata __donoId como um atalho: ele troca o dono e DESCARTA todos os outros campos do mesmo corpo, sem devolver erro. Use uma chamada separada para trocar o dono.',
			itemIndex: i,
		},
	);
}

function marcarRespostaParcial(ctx: IExecuteFunctions, corpo: IDataObject): IDataObject {
	if (corpo.oculto_por_visibilidade !== true) return corpo;

	ctx.logger.warn(
		`[Fluxo CRM] O registro ${String(corpo.id)} existe e foi reutilizado pela politica de duplicidade, mas esta fora do recorte de visibilidade desta chave: a resposta veio sem os campos do registro e nenhum webhook foi emitido. Um GET de complemento devolveria 404 pela mesma razao.`,
	);
	return { ...corpo, __parcial: true };
}

export async function executarRegistro(
	ctx: IExecuteFunctions,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	const slug = slugDoModulo(ctx, 'moduloSlug', i);
	const base = `/modulos/${encodeURIComponent(slug)}/registros`;

	switch (operacao) {
		case 'listar': {
			const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
			const limite = ctx.getNodeParameter('limit', i, 50) as number;

			const query = filtrosSimples(ctx, 'filters', i);
			Object.assign(query, filtrosDeCampo(ctx, 'filtrosDeCampo', i));

			const condicao = ctx.getNodeParameter('condicao', i, 'e') as string;
			if (Object.keys(query).some((chave) => chave.startsWith('campo:'))) {
				query.condicao = condicao;
			}

			const dados = await requisitarLista(ctx, {
				metodo: 'GET',
				caminho: base,
				query,
				retornarTudo,
				limite,
				itemIndex: i,
			});
			return dados.map((registro) => item(registro, i));
		}

		case 'obter': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('registroId', i), 'registro', i);
			const resposta = await requisitar(ctx, { metodo: 'GET', caminho: `${base}/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'excluir': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('registroId', i), 'registro', i);
			const resposta = await requisitar(ctx, { metodo: 'DELETE', caminho: `${base}/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'listarHistorico': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('registroId', i), 'registro', i);
			const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
			const limite = ctx.getNodeParameter('limit', i, 50) as number;
			const porPagina = retornarTudo ? 200 : Math.min(Math.max(1, Math.trunc(limite)), 200);

			// O handler trava a pagina em 1: nao ha como alcancar o evento 201 em
			// diante. Pedir mais de 200 nao adianta, e simular paginacao aqui
			// devolveria a MESMA pagina varias vezes.
			const resposta = await requisitar(ctx, {
				metodo: 'GET',
				caminho: `${base}/${id}/historico`,
				query: { porPagina },
			});

			const corpo = objeto(resposta.corpo);
			const eventos = Array.isArray(corpo.dados) ? (corpo.dados as IDataObject[]) : [];
			const paginacao = objeto(corpo.paginacao);

			if (typeof paginacao.total === 'number' && paginacao.total > eventos.length) {
				ctx.logger.warn(
					`[Fluxo CRM] O historico tem ${paginacao.total} eventos e apenas ${eventos.length} sao alcancaveis: o servidor trava esta rota na primeira pagina.`,
				);
			}

			// Esta e a unica rota da API em camelCase e com datas em UTC. O node NAO
			// normaliza — a decisao de nao mexer na saida vale para toda a superficie,
			// e converter so aqui produziria duas convencoes no mesmo fluxo.
			return eventos.map((evento) => item({ ...evento, _paginacao: paginacao }, i));
		}

		case 'criar': {
			const mapeado = valoresDoMapeador(ctx.getNodeParameter('valores', i, {}));
			if (mapeado !== undefined) recusarAtalhoDeDono(ctx, mapeado, i);
			const envelope = envelopeDeEscrita(ctx, i, mapeado, {
				recurso: 'registro',
				operacao: 'criar',
			});

			// O servidor exige a chave `valores`, mesmo que vazia.
			const corpo: IDataObject = {
				valores: envelope.blob ?? {},
				...corpoDaColecao(ctx, 'additionalFields', i),
			};
			// Dono e equipe vindos do mapeador vao para o topo do corpo, que e onde
			// a rota os le — dentro de `valores` virariam campo personalizado.
			aplicarNoTopo(ctx, i, corpo, envelope.topo);

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: base,
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});

			const saida = marcarRespostaParcial(ctx, propagarAvisos(ctx, resposta.corpo));
			return [
				item(
					{
						...saida,
						__criado: saida.criado === true,
						__statusHttp: resposta.status,
					},
					i,
				),
			];
		}

		case 'atualizar': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('registroId', i), 'registro', i);
			const mapeado = valoresDoMapeador(ctx.getNodeParameter('valores', i, {}));
			if (mapeado !== undefined) recusarAtalhoDeDono(ctx, mapeado, i);
			const envelope = envelopeDeEscrita(ctx, i, mapeado, {
				recurso: 'registro',
				operacao: 'atualizar',
				orientacao:
					'Este PATCH aceita a equipe no topo do corpo, mas nao o dono — trocar de dono e outra operacao. Tire "Dono" do mapeador de campos.',
			});

			const equipe = ctx.getNodeParameter('equipe_id', i, '') as string;

			const corpo: IDataObject = {};
			// `valores` faz MERGE no servidor: campo ausente e preservado.
			if (envelope.blob !== undefined) corpo.valores = envelope.blob;
			if (equipe !== '') corpo.equipe_id = exigirUuid(ctx, equipe, 'equipe', i);
			aplicarNoTopo(ctx, i, corpo, envelope.topo);

			if (Object.keys(corpo).length === 0) {
				throw new NodeOperationError(ctx.getNode(), 'Nenhum campo para atualizar', {
					description:
						'Preencha "Valores do Modulo" ou a equipe. Este PATCH nao aceita o dono no topo do corpo.',
					itemIndex: i,
				});
			}

			// O schema do PATCH exige a chave `valores` mesmo quando so a equipe
			// muda (`rotas/registros.ts`, `atualizarSchema`). `{}` mescla nada e
			// preserva tudo.
			if (corpo.valores === undefined) corpo.valores = {};

			const resposta = await requisitar(ctx, {
				metodo: 'PATCH',
				caminho: `${base}/${id}`,
				corpo,
			});
			return [item(propagarAvisos(ctx, resposta.corpo), i)];
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Registro`,
				{ itemIndex: i },
			);
	}
}

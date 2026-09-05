import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { filtrosSimples } from '../compartilhado/filtros';
import { requisitar, requisitarLista } from '../compartilhado/transporte';
import {
	cabecalhoDeIdempotencia,
	corpoDaColecao,
	emailNormalizado,
	exigirUuid,
	itemDeSaida as item,
	objeto,
	texto,
} from '../compartilhado/utilitarios';

/**
 * Leads.
 *
 * Lead nao tem campos personalizados, nao tem etiquetas e nao passa pelo
 * saneador — a resposta nunca traz `campos_ignorados` nem `campos_invalidos`,
 * entao nao ha o que propagar como aviso aqui.
 *
 * O modulo Leads e uma CAPACIDADE: numa organizacao sem ele, estas rotas
 * respondem 404 "Rota nao encontrada", e nao 403. O tradutor de erro do
 * transporte ja diz isso na descricao do 404.
 */

const CAMPOS_DE_CONVERSAO = [
	'criar_contato',
	'criar_empresa',
	'criar_oportunidade',
	'contato_existente_id',
	'empresa_existente_id',
	'pipeline_id',
];

function corpoDoLead(ctx: IExecuteFunctions, i: number, nomeDaColecao: string): IDataObject {
	return corpoDaColecao(ctx, nomeDaColecao, i, (chave, valor) =>
		chave === 'email' ? emailNormalizado(valor) : valor,
	);
}

export async function executarLead(
	ctx: IExecuteFunctions,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operacao) {
		case 'listar': {
			const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
			const limite = ctx.getNodeParameter('limit', i, 50) as number;

			const query = filtrosSimples(ctx, 'filters', i, (chave, valor) =>
				chave === 'email' ? emailNormalizado(valor) : valor,
			);

			const dados = await requisitarLista(ctx, {
				metodo: 'GET',
				caminho: '/leads',
				query,
				retornarTudo,
				limite,
				itemIndex: i,
			});
			return dados.map((lead) => item(lead, i));
		}

		case 'obter': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('leadId', i), 'lead', i);
			const resposta = await requisitar(ctx, { metodo: 'GET', caminho: `/leads/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'excluir': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('leadId', i), 'lead', i);
			const resposta = await requisitar(ctx, { metodo: 'DELETE', caminho: `/leads/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'criar': {
			const corpo = corpoDoLead(ctx, i, 'additionalFields');
			corpo.nome = texto(ctx.getNodeParameter('nome', i, '')).trim();

			if (corpo.nome === '') {
				throw new NodeOperationError(ctx.getNode(), 'Um lead precisa de nome', {
					description: 'O campo Nome e obrigatorio nesta rota, de 1 a 300 caracteres.',
					itemIndex: i,
				});
			}

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: '/leads',
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});
			return [item(resposta.corpo, i)];
		}

		case 'atualizar': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('leadId', i), 'lead', i);
			const corpo = corpoDoLead(ctx, i, 'updateFields');

			if (Object.keys(corpo).length === 0) {
				throw new NodeOperationError(ctx.getNode(), 'Nenhum campo para atualizar', {
					description: 'Preencha ao menos um campo em "Campos a Atualizar"',
					itemIndex: i,
				});
			}

			const resposta = await requisitar(ctx, {
				metodo: 'PATCH',
				caminho: `/leads/${id}`,
				corpo,
			});
			return [item(resposta.corpo, i)];
		}

		case 'converter': {
			const id = exigirUuid(ctx, ctx.getNodeParameter('leadId', i), 'lead', i);
			const escolhas = objeto(ctx.getNodeParameter('conversao', i, {}));

			const corpo: IDataObject = {};
			for (const chave of CAMPOS_DE_CONVERSAO) {
				const valor = escolhas[chave];
				if (valor === undefined || valor === '') continue;
				corpo[chave] = chave.endsWith('_id')
					? exigirUuid(ctx, valor, chave.replace(/_id$/, ''), i)
					: valor;
			}

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: `/leads/${id}/converter`,
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});

			// A conversao NAO e transacional: empresa e contato sao gravados antes do
			// negocio, e o negocio pode falhar com 500 depois disso. Nesse caso o erro
			// sobe normalmente — o que este aviso faz e nomear os silencios da rota
			// BEM-SUCEDIDA, onde `negocio_id` nulo significa "pulei" e nao "falhei".
			const saida = objeto(resposta.corpo);
			if (saida.negocio_id === null && escolhas.criar_oportunidade === true) {
				ctx.logger.warn(
					`[Fluxo CRM] O lead ${id} foi convertido, mas nenhum negocio foi criado: a organizacao nao tem o modulo Negocios. A operacao respondeu 2xx e pulou essa etapa em silencio.`,
				);
			}
			if (saida.empresa_id === null && escolhas.criar_empresa === true) {
				ctx.logger.warn(
					`[Fluxo CRM] O lead ${id} foi convertido sem criar empresa: o campo "Nome da Empresa" do lead esta vazio. A API nao avisa esse caso no corpo.`,
				);
			}

			return [item(saida, i)];
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Lead`,
				{ itemIndex: i },
			);
	}
}

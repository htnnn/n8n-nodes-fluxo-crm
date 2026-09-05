import type { IDataObject, IExecuteFunctions, INodeExecutionData, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import {
	blocosDeItens,
	consolidarLote,
	jsonDaLinha,
	MAX_ITENS_POR_BLOCO,
	resumoDasFalhas,
} from '../compartilhado/lote';
import { requisitar } from '../compartilhado/transporte';
import {
	cabecalhoDeIdempotencia,
	itemDeSaida as item,
	objeto,
	texto,
} from '../compartilhado/utilitarios';

/**
 * Gravacao em lote.
 *
 * O ponto inteiro deste arquivo: a API responde **HTTP 200 mesmo com falhas
 * parciais**, e um node que emitisse a resposta crua entregaria um item verde
 * escondendo que 3 das 200 linhas nao entraram. Aqui o relatorio vira N itens
 * de saida, e uma falha parcial NUNCA passa por sucesso:
 *
 * - com "Continuar em Caso de Erro" ligado, as linhas que falharam saem com o
 *   campo `error` e o `pairedItem` correto;
 * - com ele desligado, a execucao para com um erro que nomeia os indices.
 */

const CAMINHOS: Record<string, string> = {
	gravarContatos: '/bulk/contatos',
	gravarEmpresas: '/bulk/empresas',
	gravarLeads: '/bulk/leads',
};

/** Le o campo `itens` e devolve um array de objetos, ou levanta erro nomeando o problema. */
function listaDeItens(ctx: IExecuteFunctions, i: number): IDataObject[] {
	const bruto = ctx.getNodeParameter('itens', i, []);

	let candidato: unknown = bruto;
	if (typeof bruto === 'string') {
		const conteudo = bruto.trim();
		if (conteudo === '' || conteudo === '[]') candidato = [];
		else {
			try {
				candidato = JSON.parse(conteudo);
			} catch {
				throw new NodeOperationError(ctx.getNode(), 'O campo Itens nao e um JSON valido', {
					description: 'Informe um array de objetos, por exemplo [{"nome": "Ana"}]',
					itemIndex: i,
				});
			}
		}
	}

	if (!Array.isArray(candidato)) {
		throw new NodeOperationError(ctx.getNode(), 'O campo Itens precisa ser um array', {
			description:
				'Um lote e sempre uma lista, mesmo com um unico elemento. Envolva o objeto em colchetes.',
			itemIndex: i,
		});
	}

	const itens = candidato.filter(
		(linha): linha is IDataObject =>
			typeof linha === 'object' && linha !== null && !Array.isArray(linha),
	);

	if (itens.length !== candidato.length) {
		throw new NodeOperationError(ctx.getNode(), 'O campo Itens tem elementos que nao sao objetos', {
			description:
				'Cada elemento do array precisa ser um objeto com os campos da ficha. Valores soltos e listas aninhadas nao sao aceitos.',
			itemIndex: i,
		});
	}

	if (itens.length === 0) {
		throw new NodeOperationError(ctx.getNode(), 'O lote esta vazio', {
			description: 'Informe ao menos um item. O servidor recusa um lote sem linhas com 422.',
			itemIndex: i,
		});
	}

	return itens;
}

export async function executarLote(
	ctx: IExecuteFunctions,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	const caminho = CAMINHOS[operacao];
	if (caminho === undefined) {
		throw new NodeOperationError(
			ctx.getNode(),
			`A operacao "${operacao}" nao existe no recurso Lote`,
			{ itemIndex: i },
		);
	}

	const itens = listaDeItens(ctx, i);
	const modo = ctx.getNodeParameter('modo', i, 'criar') as string;
	const dispararWebhooks = ctx.getNodeParameter('dispararWebhooks', i, true) as boolean;
	const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
	const chaveBase = texto(opcoes.idempotencyKey).trim();

	const blocos = blocosDeItens(itens, MAX_ITENS_POR_BLOCO);
	const deslocamentos = blocos.map((_, indice) => indice * MAX_ITENS_POR_BLOCO);

	const relatorios: unknown[] = [];
	for (const [indice, bloco] of blocos.entries()) {
		const corpo: IDataObject = { modo, itens: bloco };
		// Omitir `trigger` DISPARA os webhooks; a lista vazia e o que silencia.
		if (!dispararWebhooks) corpo.trigger = [];

		// A chave ganha o numero do bloco: repetir a mesma chave com corpos
		// diferentes devolveria 409 `idempotencia_conflito` a partir do segundo.
		const chave = chaveBase === '' ? '' : `${chaveBase}-b${indice}`;

		const resposta = await requisitar(ctx, {
			metodo: 'POST',
			caminho,
			corpo,
			cabecalhos: cabecalhoDeIdempotencia(chave),
		});
		relatorios.push(resposta.corpo);
	}

	const { linhas, agregado } = consolidarLote(relatorios, deslocamentos);
	const falhas = linhas.filter((linha) => !linha.ok);

	if (falhas.length > 0 && !ctx.continueOnFail()) {
		throw new NodeApiError(
			ctx.getNode(),
			{ message: 'lote_com_falhas', falhas: falhas.length, total: linhas.length } as JsonObject,
			{
				message: resumoDasFalhas(linhas),
				description:
					'A rota de lote responde HTTP 200 mesmo com falhas parciais, entao este erro vem do relatorio, e nao do status. Ligue "Continuar em Caso de Erro" no no para receber cada linha, inclusive as que falharam, como item de saida.',
				httpCode: '200',
			},
		);
	}

	if (falhas.length > 0) {
		ctx.logger.warn(
			`[Fluxo CRM] ${falhas.length} de ${linhas.length} itens do lote falharam; a rota respondeu 200 assim mesmo.`,
		);
	}

	return linhas.map((linha) => {
		const json = jsonDaLinha(linha, agregado);
		if (linha.ok) return item(json, i);

		// O item que falhou sai pelo ramo de erro do n8n, com o `pairedItem`
		// apontando para a entrada que carregava o array — todas as linhas vieram
		// do mesmo item de entrada.
		return {
			json: { ...json, error: linha.erro?.mensagem ?? 'Falha ao gravar este item do lote' },
			error: new NodeOperationError(
				ctx.getNode(),
				`Item ${linha.indice} do lote: ${linha.erro?.mensagem ?? 'falha sem mensagem'}`,
				{ itemIndex: i, description: `Codigo devolvido: ${linha.erro?.codigo ?? 'desconhecido'}` },
			),
			pairedItem: { item: i },
		};
	});
}

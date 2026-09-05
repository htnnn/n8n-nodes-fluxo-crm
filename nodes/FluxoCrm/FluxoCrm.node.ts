import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { executarContato } from './acoes/contato';
import { executarNegocio } from './acoes/negocio';
import { estadoDeEscopos } from './compartilhado/capacidades';
import {
	encontrarOperacao,
	encontrarRecurso,
	opcoesEstaticasDeOperacao,
	opcoesEstaticasDeRecurso,
	operacaoPermitida,
} from './compartilhado/catalogo';
import { comoErroDoNode, erroDeEscopoFaltante } from './compartilhado/transporte';
import { descricaoDoContato } from './descricoes/contato';
import { descricaoDoNegocio } from './descricoes/negocio';
import { testarCredencial } from './metodos/credentialTest';
import { buscarContatos, buscarNegocios } from './metodos/listSearch';
import {
	carregarCamposDeNegocio,
	carregarChavesDeIndice,
	carregarEstagios,
	carregarEstagiosDeGanho,
	carregarEstagiosDePerda,
	carregarEtiquetas,
	carregarOperacoesDeContato,
	carregarOperacoesDeNegocio,
	carregarPipelines,
	carregarRecursos,
	carregarUsuarios,
} from './metodos/loadOptions';

/**
 * Descricao comum aos dois parametros de operacao.
 *
 * Eles carregam os DOIS conjuntos de opcoes de proposito, e essa e a descoberta
 * central do spike que precedeu este node:
 *
 * - o array `options` ESTATICO alimenta o painel de Actions do node creator,
 *   que renderiza antes de existir qualquer credencial e portanto nunca pode
 *   filtrar por escopo;
 * - `typeOptions.loadOptionsMethod` alimenta o dropdown dentro do node, onde ja
 *   ha credencial e o cadeado por escopo faz sentido.
 *
 * A lista remota SUBSTITUI a estatica, nunca concatena — e as duas saem do
 * mesmo catalogo justamente para nao divergirem. Os dois parametros estao
 * escritos por extenso, e nao produzidos por uma funcao, porque o lint do n8n
 * so consegue conferir rotulo, descricao e default quando enxerga o objeto
 * literal.
 */
export class FluxoCrm implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Fluxo CRM',
		name: 'fluxoCrm',
		icon: { light: 'file:fluxoCrm.svg', dark: 'file:fluxoCrm.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Ler e gravar dados no Fluxo CRM',
		defaults: { name: 'Fluxo CRM' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'fluxoCrmApi', required: true, testedBy: 'testarCredencial' }],
		properties: [
			{
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options -- mesma razao do parametro de operacao: interface em portugues, com lista estatica completa por tras
				displayName: 'Recurso',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'contato',
				typeOptions: { loadOptionsMethod: 'carregarRecursos' },
				options: opcoesEstaticasDeRecurso(),
				// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- a regra exige a descricao boilerplate em ingles; esta explica o que o cadeado significa
				description:
					'Entidade do CRM sobre a qual trabalhar. O cadeado marca o recurso cujas operacoes estao todas fora do alcance da chave.',
			},
			{
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options -- a regra exige o rotulo em ingles "Operation Name or ID"; a interface deste node e em portugues por decisao do fundador, e este parametro tem lista estatica COMPLETA, entao o rotulo nao esconde nada de quem usa expressao
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['contato'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeContato' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('contato')!),
				// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- a regra exige a descricao boilerplate em ingles sobre expressoes; este texto explica o cadeado, que e a duvida real de quem abre o dropdown
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options -- mesma razao do parametro de operacao de Contato
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['negocio'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeNegocio' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('negocio')!),
				// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- mesma razao do parametro de operacao de Contato
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			...descricaoDoContato,
			...descricaoDoNegocio,
		],
	};

	methods = {
		loadOptions: {
			carregarCamposDeNegocio,
			carregarChavesDeIndice,
			carregarEstagios,
			carregarEstagiosDeGanho,
			carregarEstagiosDePerda,
			carregarEtiquetas,
			carregarOperacoesDeContato,
			carregarOperacoesDeNegocio,
			carregarPipelines,
			carregarRecursos,
			carregarUsuarios,
		},
		listSearch: { buscarContatos, buscarNegocios },
		credentialTest: { testarCredencial },
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const itens = this.getInputData();
		const recurso = this.getNodeParameter('resource', 0) as string;
		const operacao = this.getNodeParameter('operation', 0) as string;

		const definicao = encontrarOperacao(recurso, operacao);
		if (definicao === undefined) {
			throw new NodeOperationError(
				this.getNode(),
				`A combinacao ${recurso} › ${operacao} nao existe neste node`,
				{
					description:
						'Reabra os campos Recurso e Operacao. Se o workflow veio de outra versao do node, a operacao pode ter sido renomeada.',
				},
			);
		}

		// Resolvido UMA vez por execucao, e nao por item: o resultado e o mesmo
		// para todos, e cada item repetindo a descoberta consumiria o rate limit
		// que a operacao em si precisa.
		const escopos = await estadoDeEscopos(this);

		const saida: INodeExecutionData[] = [];

		for (let i = 0; i < itens.length; i++) {
			try {
				// A operacao com cadeado continua selecionavel — decisao de desenho,
				// para que o painel de Actions e o dropdown nao se contradigam. Quem
				// insistir recebe aqui uma mensagem que diz qual escopo falta e onde
				// consegui-lo, em vez do generico do n8n.
				if (!operacaoPermitida(definicao, escopos)) {
					throw erroDeEscopoFaltante(
						this,
						definicao.nome,
						definicao.escopo as string,
						escopos.escopos,
					);
				}

				const resultado =
					recurso === 'contato'
						? await executarContato(this, operacao, i)
						: await executarNegocio(this, operacao, i);

				saida.push(...resultado);
			} catch (erro) {
				if (this.continueOnFail()) {
					saida.push({
						json: { error: (erro as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// `comoErroDoNode` devolve o proprio erro quando ele ja e um
				// `NodeApiError`/`NodeOperationError` — que e o caso de tudo que sobe
				// daqui — e so embrulha o que escapou sem tipo.
				throw comoErroDoNode(this, erro, `${recurso} › ${operacao}`);
			}
		}

		return [saida];
	}
}

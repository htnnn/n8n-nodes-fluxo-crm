/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options -- a regra exige o rotulo em ingles ("Operation Name or ID", "Resource Name or ID") em todo parametro com `loadOptionsMethod`. A interface deste node e integralmente em portugues por decisao do fundador, e estes parametros tem lista estatica COMPLETA por tras, entao o rotulo nao esconde nada de quem usa expressao. Desativado no arquivo inteiro porque a excecao vale para os vinte parametros de recurso e operacao. */
/* eslint-disable n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- a regra exige a descricao boilerplate em ingles sobre expressoes; o texto usado aqui explica o cadeado por escopo, que e a duvida real de quem abre o dropdown. Mesma razao do disable acima. */
import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeProperties,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { executarArquivo } from './acoes/arquivo';
import { executarAtendimento } from './acoes/atendimento';
import { executarAtividade } from './acoes/atividade';
import { executarContato } from './acoes/contato';
import { executarEmpresa } from './acoes/empresa';
import { executarInteracao } from './acoes/interacao';
import { executarLead } from './acoes/lead';
import { executarLote } from './acoes/lote';
import { executarNegocio } from './acoes/negocio';
import { executarNota } from './acoes/nota';
import { executarPipeline } from './acoes/pipeline';
import { executarPlataforma } from './acoes/plataforma';
import { executarRegistro } from './acoes/registro';
import { executarWebhook } from './acoes/webhook';
import { estadoDeEscopos } from './compartilhado/capacidades';
import {
	encontrarOperacao,
	encontrarRecurso,
	opcoesEstaticasDeOperacao,
	opcoesEstaticasDeRecurso,
	operacaoPermitida,
} from './compartilhado/catalogo';
import { comoErroDoNode, erroDeEscopoFaltante } from './compartilhado/transporte';
import { descricaoDoArquivo } from './descricoes/arquivo';
import { descricaoDoAtendimento } from './descricoes/atendimento';
import { descricaoDaAtividade } from './descricoes/atividade';
import { descricaoDoContato } from './descricoes/contato';
import { descricaoDaEmpresa } from './descricoes/empresa';
import { descricaoDaInteracao } from './descricoes/interacao';
import { descricaoDoLead } from './descricoes/lead';
import { descricaoDoLote } from './descricoes/lote';
import { descricaoDoNegocio } from './descricoes/negocio';
import { descricaoDaNota } from './descricoes/nota';
import { descricaoDaPipeline } from './descricoes/pipeline';
import { descricaoDaPlataforma } from './descricoes/plataforma';
import { descricaoDoRegistro } from './descricoes/registro';
import { descricaoDoWebhook } from './descricoes/webhook';
import { testarCredencial } from './metodos/credentialTest';
import { buscarContatos, buscarEmpresas, buscarNegocios } from './metodos/listSearch';
import {
	carregarAgentes,
	carregarCamposDeNegocio,
	carregarCamposDoModulo,
	carregarCanais,
	carregarChavesDeIndice,
	carregarEquipes,
	carregarEstagios,
	carregarEstagiosDeGanho,
	carregarEstagiosDePerda,
	carregarEtiquetas,
	carregarEtiquetasPorId,
	carregarEventosWebhook,
	carregarModulos,
	carregarOperacoesDeAgenteAtendimento,
	carregarOperacoesDeArquivo,
	carregarOperacoesDeAtividade,
	carregarOperacoesDeCanalAtendimento,
	carregarOperacoesDeContato,
	carregarOperacoesDeConversa,
	carregarOperacoesDeEmpresa,
	carregarOperacoesDeEtiqueta,
	carregarOperacoesDeInteracao,
	carregarOperacoesDeLead,
	carregarOperacoesDeLote,
	carregarOperacoesDeMensagem,
	carregarOperacoesDeModulo,
	carregarOperacoesDeNegocio,
	carregarOperacoesDeNota,
	carregarOperacoesDeOrganizacao,
	carregarOperacoesDePipeline,
	carregarOperacoesDeRegistro,
	carregarOperacoesDeWebhook,
	carregarPipelines,
	carregarRecursos,
	carregarUsuarios,
} from './metodos/loadOptions';
import {
	mapearCamposDeAtividade,
	mapearCamposDeContato,
	mapearCamposDeEmpresa,
	mapearCamposDeNegocio,
	mapearCamposDoModulo,
} from './metodos/resourceMapping';

/**
 * Os vinte parametros de recurso e operacao.
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
 * mesmo catalogo justamente para nao divergirem. Os parametros estao escritos
 * por extenso, e nao produzidos por uma funcao, porque o lint do n8n so
 * consegue conferir rotulo, descricao e default quando enxerga o objeto
 * literal — e pela mesma razao a descricao de cada um esta repetida por
 * extenso: uma constante compartilhada some da analise estatica e a regra
 * `node-param-description-missing-from-dynamic-options` passa a acusar campo
 * sem descricao onde ha uma.
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
				displayName: 'Recurso',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				default: 'contato',
				typeOptions: { loadOptionsMethod: 'carregarRecursos' },
				options: opcoesEstaticasDeRecurso(),
				description:
					'Entidade do CRM sobre a qual trabalhar. O cadeado marca o recurso cujas operacoes estao todas fora do alcance da chave.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['contato'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeContato' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('contato')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['negocio'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeNegocio' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('negocio')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['empresa'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeEmpresa' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('empresa')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['lead'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeLead' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('lead')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['pipeline'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDePipeline' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('pipeline')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['atividade'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeAtividade' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('atividade')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['registro'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeRegistro' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('registro')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['nota'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeNota' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('nota')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['arquivo'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeArquivo' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('arquivo')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'gravarContatos',
				displayOptions: { show: { resource: ['lote'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeLote' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('lote')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['conversa'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeConversa' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('conversa')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['mensagem'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeMensagem' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('mensagem')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['canalAtendimento'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeCanalAtendimento' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('canalAtendimento')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['agenteAtendimento'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeAgenteAtendimento' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('agenteAtendimento')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['webhook'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeWebhook' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('webhook')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['modulo'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeModulo' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('modulo')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['etiqueta'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeEtiqueta' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('etiqueta')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'listar',
				displayOptions: { show: { resource: ['interacao'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeInteracao' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('interacao')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			{
				displayName: 'Operação',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				default: 'obterContexto',
				displayOptions: { show: { resource: ['organizacao'] } },
				typeOptions: { loadOptionsMethod: 'carregarOperacoesDeOrganizacao' },
				options: opcoesEstaticasDeOperacao(encontrarRecurso('organizacao')!),
				description:
					'Operacao a executar. Operacoes com cadeado exigem um escopo que a chave configurada nao tem — a razao aparece sob o nome.',
			},
			...(descricaoDoContato as INodeProperties[]),
			...descricaoDoNegocio,
			...descricaoDaEmpresa,
			...descricaoDoLead,
			...descricaoDaPipeline,
			...descricaoDaAtividade,
			...descricaoDoRegistro,
			...descricaoDaNota,
			...descricaoDoArquivo,
			...descricaoDoLote,
			...descricaoDoAtendimento,
			...descricaoDoWebhook,
			...descricaoDaInteracao,
			...descricaoDaPlataforma,
		],
	};

	methods = {
		loadOptions: {
			carregarAgentes,
			carregarCamposDeNegocio,
			carregarCamposDoModulo,
			carregarCanais,
			carregarChavesDeIndice,
			carregarEquipes,
			carregarEstagios,
			carregarEstagiosDeGanho,
			carregarEstagiosDePerda,
			carregarEtiquetas,
			carregarEtiquetasPorId,
			carregarEventosWebhook,
			carregarModulos,
			carregarOperacoesDeAgenteAtendimento,
			carregarOperacoesDeArquivo,
			carregarOperacoesDeAtividade,
			carregarOperacoesDeCanalAtendimento,
			carregarOperacoesDeContato,
			carregarOperacoesDeConversa,
			carregarOperacoesDeEmpresa,
			carregarOperacoesDeEtiqueta,
			carregarOperacoesDeInteracao,
			carregarOperacoesDeLead,
			carregarOperacoesDeLote,
			carregarOperacoesDeMensagem,
			carregarOperacoesDeModulo,
			carregarOperacoesDeNegocio,
			carregarOperacoesDeNota,
			carregarOperacoesDeOrganizacao,
			carregarOperacoesDePipeline,
			carregarOperacoesDeRegistro,
			carregarOperacoesDeWebhook,
			carregarPipelines,
			carregarRecursos,
			carregarUsuarios,
		},
		listSearch: { buscarContatos, buscarEmpresas, buscarNegocios },
		resourceMapping: {
			mapearCamposDeAtividade,
			mapearCamposDeContato,
			mapearCamposDeEmpresa,
			mapearCamposDeNegocio,
			mapearCamposDoModulo,
		},
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

				saida.push(...(await despachar(this, recurso, operacao, i)));
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

/**
 * Encaminha para o executor do recurso.
 *
 * Atendimento e Plataforma recebem tambem o `recurso`, porque cada um atende
 * mais de um: os quatro recursos de atendimento compartilham o mesmo prefixo de
 * rota, e os tres de plataforma compartilham a natureza de descoberta. Separa-los
 * em sete arquivos multiplicaria os cabecalhos sem separar regra nenhuma.
 */
async function despachar(
	ctx: IExecuteFunctions,
	recurso: string,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (recurso) {
		case 'contato':
			return await executarContato(ctx, operacao, i);
		case 'negocio':
			return await executarNegocio(ctx, operacao, i);
		case 'empresa':
			return await executarEmpresa(ctx, operacao, i);
		case 'lead':
			return await executarLead(ctx, operacao, i);
		case 'pipeline':
			return await executarPipeline(ctx, operacao, i);
		case 'atividade':
			return await executarAtividade(ctx, operacao, i);
		case 'registro':
			return await executarRegistro(ctx, operacao, i);
		case 'nota':
			return await executarNota(ctx, operacao, i);
		case 'arquivo':
			return await executarArquivo(ctx, operacao, i);
		case 'lote':
			return await executarLote(ctx, operacao, i);
		case 'webhook':
			return await executarWebhook(ctx, operacao, i);
		case 'interacao':
			return await executarInteracao(ctx, operacao, i);
		case 'conversa':
		case 'mensagem':
		case 'canalAtendimento':
		case 'agenteAtendimento':
			return await executarAtendimento(ctx, recurso, operacao, i);
		default:
			return await executarPlataforma(ctx, recurso, operacao, i);
	}
}

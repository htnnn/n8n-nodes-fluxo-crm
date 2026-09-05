/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options, n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- as duas regras exigem rotulo em ingles e a descricao boilerplate em todo campo com loadOptionsMethod; a interface deste node e em portugues por decisao do fundador. */
/* eslint-disable n8n-nodes-base/node-param-display-name-miscased -- a regra aplica title case do INGLES; em portugues Title Case mantem preposicoes em minusculas ("Modulo do Funil"). */
import type { INodeProperties } from 'n8n-workflow';

import { camposDeLista, opcoesComIdempotencia } from './comuns';

const RECURSO = 'pipeline';

const TIPOS_DE_ESTAGIO: INodeProperties['options'] = [
	{ name: 'Aberto', value: 'aberto', description: 'Estagio de trabalho em andamento' },
	{ name: 'Ganho', value: 'ganho', description: 'Estagio de fechamento com sucesso' },
	{ name: 'Perdido', value: 'perdido', description: 'Estagio de fechamento sem sucesso' },
];

export const descricaoDaPipeline: INodeProperties[] = [
	...camposDeLista({
		recurso: RECURSO,
		operacoes: ['listar'],
		notaDeLimite:
			'A rota devolve todos os funis de uma vez e nao aceita paginacao: o corte acontece dentro do node.',
	}),

	{
		displayName: 'Nome',
		name: 'nome',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: { resource: [RECURSO], operation: ['criarOuAtualizar', 'criarOuAtualizarEstagio'] },
		},
		description:
			'Nome do funil ou do estagio, de 1 a 150 caracteres. E a CHAVE natural do upsert, comparada sem caixa e sem espacos de borda — por isso ela nunca e renomeada por esta operacao.',
	},

	{
		displayName: 'Módulo do Funil',
		name: 'modulo_slug',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'carregarModulos' },
		default: 'negocios',
		displayOptions: { show: { resource: [RECURSO], operation: ['criarOuAtualizar'] } },
		description:
			'Modulo a que o funil pertence. O padrao do servidor e negocios, e o nome do funil so precisa ser unico dentro do modulo.',
	},

	{
		displayName: 'Definir Como Padrão',
		name: 'is_padrao',
		type: 'boolean',
		default: false,
		displayOptions: { show: { resource: [RECURSO], operation: ['criarOuAtualizar'] } },
		// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether -- interface em portugues por decisao do fundador; "Se deve" e o equivalente literal de "Whether"
		description:
			'Se deve tornar este o funil padrao do modulo. Ligar ZERA o padrao de todos os outros funis do mesmo modulo.',
	},

	{
		displayName:
			'Num funil que ja existe, so "Definir Como Padrao" e aplicado. Nome, estagios e o resto sao usados apenas na criacao — o servidor nao renomeia nem reordena um funil existente.',
		name: 'avisoDeUpsertDeFunil',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RECURSO], operation: ['criarOuAtualizar'] } },
	},

	{
		displayName: 'Estágios',
		name: 'estagios',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Adicionar estagio',
		displayOptions: { show: { resource: [RECURSO], operation: ['criarOuAtualizar'] } },
		description:
			'Colunas do funil, ate 50. A ordem enviada e a ordem criada; este corpo nao aceita o campo de ordem.',
		options: [
			{
				displayName: 'Estágio',
				name: 'itens',
				values: [
					{
						displayName: 'Nome',
						name: 'nome',
						type: 'string',
						default: '',
						required: true,
						description: 'Nome do estagio, de 1 a 150 caracteres',
					},
					{
						displayName: 'Probabilidade',
						name: 'probabilidade',
						type: 'number',
						typeOptions: { minValue: 0, maxValue: 100 },
						default: 0,
						description: 'Chance de fechamento neste estagio, de 0 a 100',
					},
					{
						displayName: 'Tipo',
						name: 'tipo',
						type: 'options',
						options: TIPOS_DE_ESTAGIO,
						default: 'aberto',
						description: 'Papel do estagio no funil',
					},
				],
			},
		],
	},

	{
		displayName: 'Pipeline',
		name: 'pipelineId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'carregarPipelines' },
		default: '',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criarOuAtualizarEstagio'] } },
		description: 'Funil que recebe o estagio, ou uma expressao com o UUID',
	},

	{
		displayName: 'Campos do Estágio',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Adicionar campo',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['criarOuAtualizarEstagio'] } },
		options: [
			{
				displayName: 'Ordem',
				name: 'ordem',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 999 },
				default: 0,
				description:
					'Posicao no funil, de 0 a 999. Sem este campo, o estagio novo entra depois do ultimo.',
			},
			{
				displayName: 'Probabilidade',
				name: 'probabilidade',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 100 },
				default: 0,
				description: 'Chance de fechamento neste estagio, de 0 a 100',
			},
			{
				displayName: 'Tipo',
				name: 'tipo',
				type: 'options',
				options: TIPOS_DE_ESTAGIO,
				default: 'aberto',
				description: 'Papel do estagio no funil',
			},
		],
	},

	opcoesComIdempotencia(RECURSO, ['criarOuAtualizar', 'criarOuAtualizarEstagio']),
];

/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options, n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- as duas regras exigem rotulo em ingles e a descricao boilerplate em todo campo com loadOptionsMethod; a interface deste node e em portugues por decisao do fundador. */
/* eslint-disable n8n-nodes-base/node-param-display-name-miscased -- a regra aplica title case do INGLES; em portugues Title Case mantem preposicoes em minusculas ("Tipo da Entidade"). */
/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-update-fields -- a regra exige o rotulo literal "Update Fields"; aqui ele se chama "Campos a Atualizar". */
import type { INodeProperties } from 'n8n-workflow';

import {
	avisoDeSubstituicao,
	campoDeId,
	camposDeLista,
	mapeadorDeCampos,
	opcoesComIdempotencia,
} from './comuns';

const RECURSO = 'atividade';

const TIPOS: INodeProperties['options'] = [
	{ name: 'E-Mail', value: 'email' },
	{ name: 'Ligação', value: 'ligacao' },
	{ name: 'Outro', value: 'outro' },
	{ name: 'Reunião', value: 'reuniao' },
	{ name: 'Tarefa', value: 'tarefa' },
	{ name: 'Visita', value: 'visita' },
];

const STATUS: INodeProperties['options'] = [
	{ name: 'Cancelada', value: 'cancelada' },
	{ name: 'Concluída', value: 'concluida' },
	{ name: 'Pendente', value: 'pendente' },
];

const ENTIDADES: INodeProperties['options'] = [
	{ name: 'Contato', value: 'contato' },
	{ name: 'Empresa', value: 'empresa' },
	{ name: 'Lead', value: 'lead' },
	{ name: 'Negócio', value: 'negocio' },
];

const DESCRICAO_DO_PRAZO =
	'Prazo da atividade. A API exige data e hora em UTC com Z e recusa offset local, entao o node converte antes de enviar.';

export const descricaoDaAtividade: INodeProperties[] = [
	campoDeId({
		nome: 'atividadeId',
		rotulo: 'Atividade',
		descricao: 'Identificador da atividade, no formato UUID',
		recurso: RECURSO,
		operacoes: ['obter', 'atualizar', 'excluir', 'concluir'],
	}),

	...camposDeLista({ recurso: RECURSO, operacoes: ['listar'] }),

	{
		displayName: 'Filtros',
		name: 'filters',
		type: 'collection',
		placeholder: 'Adicionar filtro',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['listar'] } },
		options: [
			{
				displayName: 'Criada Após',
				name: 'criado_apos',
				type: 'dateTime',
				default: '',
				description: 'Somente atividades criadas depois deste instante',
			},
			{
				displayName: 'Entidade',
				name: 'entidade_id',
				type: 'string',
				default: '',
				description:
					'Identificador da entidade ligada, no formato UUID. Nao ha filtro por tipo de entidade nesta rota.',
			},
			{
				displayName: 'Responsável',
				name: 'usuario_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
				default: '',
				description: 'Usuario dono da atividade, ou uma expressao com o UUID',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: STATUS,
				default: 'pendente',
				description: 'Situacao da atividade',
			},
			{
				displayName: 'Tipo',
				name: 'tipo',
				type: 'options',
				options: TIPOS,
				default: 'tarefa',
				description: 'Natureza da atividade',
			},
		],
	},

	{
		displayName: 'Tipo',
		name: 'tipo',
		type: 'options',
		options: TIPOS,
		default: 'tarefa',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description: 'Natureza da atividade',
	},

	{
		displayName: 'Título',
		name: 'titulo',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description: 'Titulo da atividade, de 1 a 300 caracteres',
	},

	{
		displayName: 'Tipo da Entidade',
		name: 'entidade_tipo',
		type: 'options',
		options: ENTIDADES,
		default: 'contato',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description: 'A que a atividade fica presa',
	},

	{
		displayName: 'Entidade',
		name: 'entidade_id',
		type: 'string',
		default: '',
		required: true,
		placeholder: '4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d',
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description: 'Identificador da entidade escolhida acima, no formato UUID',
	},

	{
		displayName: 'Campos Adicionais',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Adicionar campo',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		options: [
			{
				displayName: 'Descrição',
				name: 'descricao',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'Texto livre, ate 5000 caracteres',
			},
			{
				displayName: 'Prazo',
				name: 'deadline',
				type: 'dateTime',
				default: '',
				description: DESCRICAO_DO_PRAZO,
			},
			{
				displayName: 'Responsável',
				name: 'usuario_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
				default: '',
				description:
					'Usuario dono da atividade. Sem este campo, o servidor usa o usuario vinculado a chave.',
			},
		],
	},

	{
		displayName: 'Campos a Atualizar',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Adicionar campo',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['atualizar'] } },
		options: [
			{
				displayName: 'Descrição',
				name: 'descricao',
				type: 'string',
				typeOptions: { rows: 3 },
				default: '',
				description: 'Texto livre, ate 5000 caracteres',
			},
			{
				displayName: 'Feedback',
				name: 'feedback',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				description: 'Resultado da atividade, ate 5000 caracteres',
			},
			{
				displayName: 'Prazo',
				name: 'deadline',
				type: 'dateTime',
				default: '',
				description: DESCRICAO_DO_PRAZO,
			},
			{
				displayName: 'Responsável',
				name: 'usuario_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
				default: '',
				description: 'Usuario dono da atividade, ou uma expressao com o UUID',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: STATUS,
				default: 'pendente',
				description:
					'Situacao da atividade. Gravar "Concluida" carimba a data de conclusao e emite o evento atividade.concluida em vez de atividade.atualizada.',
			},
			{
				displayName: 'Tipo',
				name: 'tipo',
				type: 'options',
				options: TIPOS,
				default: 'tarefa',
				description: 'Natureza da atividade',
			},
			{
				displayName: 'Título',
				name: 'titulo',
				type: 'string',
				default: '',
				description: 'Titulo da atividade, de 1 a 300 caracteres',
			},
		],
	},

	{
		displayName: 'Feedback',
		name: 'feedback',
		type: 'string',
		typeOptions: { rows: 2 },
		default: '',
		displayOptions: { show: { resource: [RECURSO], operation: ['concluir'] } },
		description:
			'Resultado da atividade. O servidor TRUNCA em 5000 caracteres sem avisar, e concluir de novo sobrescreve o feedback anterior — inclusive apagando-o quando este campo vem vazio.',
	},

	avisoDeSubstituicao({
		nome: 'avisoDeSubstituicaoDaAtividade',
		recurso: RECURSO,
		operacoes: ['atualizar'],
		texto:
			'Os campos personalizados abaixo SUBSTITUEM o conjunto atual da atividade: chave que voce nao preencher aqui e APAGADA. Na criacao, omitir o bloco NAO isenta os campos que o layout marcou como obrigatorios.',
	}),

	mapeadorDeCampos({
		nome: 'dados',
		rotulo: 'Campos Personalizados',
		metodo: 'mapearCamposDeAtividade',
		recurso: RECURSO,
		operacoes: ['criar', 'atualizar'],
		descricao:
			'Campos personalizados do modulo Tarefas, lidos do layout desta organizacao. Este conjunto substitui o anterior.',
	}),

	opcoesComIdempotencia(RECURSO, ['criar', 'concluir']),
];

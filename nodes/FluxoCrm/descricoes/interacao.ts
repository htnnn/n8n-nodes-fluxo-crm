/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options, n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- as duas regras exigem rotulo em ingles e a descricao boilerplate em todo campo com loadOptionsMethod; a interface deste node e em portugues por decisao do fundador. */
/* eslint-disable n8n-nodes-base/node-param-display-name-miscased -- a regra aplica title case do INGLES; em portugues Title Case mantem preposicoes em minusculas ("Link de Video", "Tipo da Entidade"). */
/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-update-fields -- a regra exige o rotulo literal "Update Fields"; aqui ele se chama "Campos a Atualizar". */
import type { INodeProperties } from 'n8n-workflow';

import { campoDeId, camposDeLista, opcoesComIdempotencia, ordenarPorRotulo } from './comuns';

const RECURSO = 'interacao';

const TIPOS: INodeProperties['options'] = [
	{ name: 'E-Mail Enviado', value: 'email_enviado' },
	{ name: 'Follow-Up', value: 'follow_up' },
	{ name: 'Ligação', value: 'ligacao' },
	{ name: 'Reunião', value: 'reuniao' },
];

const STATUS: INodeProperties['options'] = [
	{ name: 'Agendado', value: 'agendado' },
	{ name: 'Cancelado', value: 'cancelado' },
	{ name: 'Realizado', value: 'realizado' },
];

const ENTIDADES: INodeProperties['options'] = [
	{ name: 'Contato', value: 'contato' },
	{ name: 'Empresa', value: 'empresa' },
	{ name: 'Lead', value: 'lead' },
	{ name: 'Registro', value: 'registro' },
];

const DIRECOES: INodeProperties['options'] = [
	{ name: 'Entrada', value: 'entrada' },
	{ name: 'Saída', value: 'saida' },
];

const RESULTADOS: INodeProperties['options'] = [
	{ name: 'Atendida', value: 'atendida' },
	{ name: 'Caixa Postal', value: 'caixa_postal' },
	{ name: 'Número Errado', value: 'numero_errado' },
	{ name: 'Ocupado', value: 'ocupado' },
	{ name: 'Reagendada', value: 'reagendada' },
	{ name: 'Sem Resposta', value: 'sem_resposta' },
];

const FINALIDADES: INodeProperties['options'] = [
	{ name: 'Demonstração', value: 'demo' },
	{ name: 'Follow-Up', value: 'follow_up' },
	{ name: 'Negociação', value: 'negociacao' },
	{ name: 'Outro', value: 'outro' },
	{ name: 'Prospecção', value: 'prospeccao' },
	{ name: 'Suporte', value: 'suporte' },
];

const PROVEDORES: INodeProperties['options'] = [
	{ name: 'Google Meet', value: 'google_meet' },
	{ name: 'Outro', value: 'outro' },
	{ name: 'Teams', value: 'teams' },
	{ name: 'Zoom', value: 'zoom' },
];

/**
 * Os campos opcionais do corpo, iguais em criar e atualizar.
 *
 * `entidade_tipo` e `entidade_id` ficam de fora: eles so existem na criacao —
 * o PATCH e `.strict()` e recusa os dois com 422, porque uma interacao nao
 * troca de dono polimorfico depois de criada.
 */
function camposDaInteracao(): INodeProperties[] {
	return [
		{
			displayName: 'Agenda',
			name: 'agenda',
			type: 'string',
			typeOptions: { rows: 3 },
			default: '',
			description: 'Pauta da reuniao, ate 2000 caracteres',
		},
		{
			displayName: 'Descrição',
			name: 'descricao',
			type: 'string',
			typeOptions: { rows: 3 },
			default: '',
			description: 'Texto livre sobre a interacao',
		},
		{
			displayName: 'Direção',
			name: 'direcao',
			type: 'options',
			options: DIRECOES,
			default: 'saida',
			description: 'Quem iniciou a ligacao',
		},
		{
			displayName: 'Duração (Minutos)',
			name: 'duracao_minutos',
			type: 'number',
			typeOptions: { minValue: 0 },
			default: 0,
			description: 'Quanto tempo a interacao durou, em minutos inteiros',
		},
		{
			displayName: 'Finalidade',
			name: 'finalidade',
			type: 'options',
			options: FINALIDADES,
			default: 'outro',
			description: 'Objetivo da ligacao',
		},
		{
			displayName: 'Lembrete',
			name: 'data_lembrete',
			type: 'dateTime',
			default: '',
			description: 'Quando avisar sobre esta interacao',
		},
		{
			displayName: 'Link de Vídeo',
			name: 'link_video',
			type: 'string',
			default: '',
			placeholder: 'https://meet.google.com/abc-defg-hij',
			description: 'Endereco da sala, ate 2000 caracteres, validado como URL',
		},
		{
			displayName: 'Local',
			name: 'local',
			type: 'string',
			default: '',
			description: 'Onde a interacao acontece, ate 500 caracteres',
		},
		{
			displayName: 'Provedor de Vídeo',
			name: 'provedor_video',
			type: 'options',
			options: PROVEDORES,
			default: 'outro',
			description: 'Servico da sala de video',
		},
		{
			displayName: 'Responsável',
			name: 'responsavel_id',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
			default: '',
			description: 'Usuario dono da interacao, ou uma expressao com o UUID',
		},
		{
			displayName: 'Resultado',
			name: 'resultado',
			type: 'options',
			options: RESULTADOS,
			default: 'atendida',
			description: 'Desfecho da ligacao',
		},
		{
			displayName: 'Status',
			name: 'status',
			type: 'options',
			options: STATUS,
			default: 'agendado',
			description: 'Situacao da interacao',
		},
	];
}

export const descricaoDaInteracao: INodeProperties[] = [
	campoDeId({
		nome: 'interacaoId',
		rotulo: 'Interação',
		descricao: 'Identificador da interacao, no formato UUID',
		recurso: RECURSO,
		operacoes: ['obter', 'atualizar', 'excluir'],
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
				displayName: 'Até',
				name: 'data_fim',
				type: 'dateTime',
				default: '',
				description: 'Somente interacoes com data anterior a este instante',
			},
			{
				displayName: 'De',
				name: 'data_inicio',
				type: 'dateTime',
				default: '',
				description: 'Somente interacoes com data posterior a este instante',
			},
			{
				displayName: 'Direção',
				name: 'direcao',
				type: 'options',
				options: DIRECOES,
				default: 'saida',
				description: 'Quem iniciou a ligacao',
			},
			{
				displayName: 'Entidade',
				name: 'entidade_id',
				type: 'string',
				default: '',
				description: 'Identificador da entidade ligada, no formato UUID',
			},
			{
				displayName: 'Responsável',
				name: 'responsavel_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
				default: '',
				description: 'Usuario dono da interacao, ou uma expressao com o UUID',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: STATUS,
				default: 'agendado',
				description: 'Situacao da interacao',
			},
			{
				displayName: 'Tipo',
				name: 'tipo',
				type: 'options',
				options: TIPOS,
				default: 'reuniao',
				description: 'Natureza da interacao',
			},
			{
				displayName: 'Tipo da Entidade',
				name: 'entidade_tipo',
				type: 'options',
				options: ENTIDADES,
				default: 'contato',
				description: 'A que a interacao esta presa',
			},
		],
	},

	{
		displayName: 'Tipo',
		name: 'tipo',
		type: 'options',
		options: TIPOS,
		default: 'reuniao',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description: 'Natureza da interacao',
	},

	{
		displayName: 'Título',
		name: 'titulo',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description: 'Titulo da interacao, de 1 a 255 caracteres',
	},

	{
		displayName: 'Data',
		name: 'data',
		type: 'dateTime',
		default: '',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description: 'Quando a interacao acontece ou aconteceu',
	},

	{
		displayName: 'Tipo da Entidade',
		name: 'entidade_tipo',
		type: 'options',
		options: ENTIDADES,
		default: 'contato',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description:
			'A que a interacao fica presa. O tipo Lead depende do modulo Leads estar habilitado: sem ele, a API responde 404 "Rota nao encontrada".',
	},

	{
		displayName: 'Entidade',
		name: 'entidade_id',
		type: 'string',
		default: '',
		required: true,
		placeholder: '4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d',
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description:
			'Identificador da entidade escolhida acima, no formato UUID. O servidor confere que ela e desta organizacao e, para registros, que ela esta na visibilidade da chave.',
	},

	{
		displayName: 'Campos Adicionais',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Adicionar campo',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		options: camposDaInteracao(),
	},

	{
		displayName: 'Campos a Atualizar',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Adicionar campo',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['atualizar'] } },
		description:
			'Ao menos um campo precisa vir preenchido. A entidade vinculada NAO e alteravel: o corpo do PATCH recusa tipo e identificador de entidade com 422.',
		options: ordenarPorRotulo([
			...camposDaInteracao(),
			{
				displayName: 'Data',
				name: 'data',
				type: 'dateTime',
				default: '',
				description: 'Quando a interacao acontece ou aconteceu',
			},
			{
				displayName: 'Tipo',
				name: 'tipo',
				type: 'options',
				options: TIPOS,
				default: 'reuniao',
				description: 'Natureza da interacao',
			},
			{
				displayName: 'Título',
				name: 'titulo',
				type: 'string',
				default: '',
				description: 'Titulo da interacao, de 1 a 255 caracteres',
			},
		]),
	},

	{
		displayName: 'Participantes',
		name: 'participantes',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Adicionar participante',
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description:
			'Quem participa da interacao. So a criacao aceita este bloco; alterar a lista depois exige recriar a interacao.',
		options: [
			{
				displayName: 'Participante',
				name: 'itens',
				values: [
					{
						displayName: 'Contato',
						name: 'contato_id',
						type: 'string',
						default: '',
						description: 'Identificador do contato participante, no formato UUID',
					},
					{
						displayName: 'Resposta ao Convite',
						name: 'rsvp_state',
						type: 'options',
						default: 'pendente',
						options: [
							{ name: 'Aceito', value: 'aceito' },
							{ name: 'Pendente', value: 'pendente' },
							{ name: 'Recusado', value: 'recusado' },
							{ name: 'Talvez', value: 'talvez' },
						],
						description: 'Situacao do convite deste participante',
					},
					{
						displayName: 'Usuário',
						name: 'usuario_id',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
						default: '',
						description: 'Usuario participante, ou uma expressao com o UUID',
					},
				],
			},
		],
	},

	{
		displayName: 'Recorrência',
		name: 'recorrencia',
		type: 'fixedCollection',
		default: {},
		placeholder: 'Definir recorrencia',
		displayOptions: { show: { resource: [RECURSO], operation: ['criar', 'atualizar'] } },
		description: 'Repeticao da interacao. Deixe em branco para uma interacao unica.',
		options: [
			{
				displayName: 'Campos',
				name: 'campos',
				values: [
					{
						displayName: 'Frequência',
						name: 'freq',
						type: 'options',
						default: 'semanal',
						options: [
							{ name: 'Diária', value: 'diaria' },
							{ name: 'Mensal', value: 'mensal' },
							{ name: 'Semanal', value: 'semanal' },
						],
						description: 'Periodicidade da repeticao',
					},
					{
						displayName: 'Intervalo',
						name: 'intervalo',
						type: 'number',
						typeOptions: { minValue: 1, maxValue: 365 },
						default: 1,
						description: 'De quantos em quantos periodos a interacao se repete, de 1 a 365',
					},
					{
						displayName: 'Até',
						name: 'ate',
						type: 'dateTime',
						default: '',
						description: 'Quando a repeticao termina. Em branco, a recorrencia nao tem fim.',
					},
				],
			},
		],
	},

	opcoesComIdempotencia(RECURSO, ['criar']),
];

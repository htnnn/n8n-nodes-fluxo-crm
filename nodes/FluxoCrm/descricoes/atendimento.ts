/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options, n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- as duas regras exigem rotulo em ingles e a descricao boilerplate em todo campo com loadOptionsMethod; a interface deste node e em portugues por decisao do fundador. */
/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-update-fields -- a regra exige o rotulo literal "Update Fields"; aqui ele se chama "Campos a Atualizar", pela mesma decisao de idioma. */
/* eslint-disable n8n-nodes-base/node-param-display-name-miscased -- a regra aplica title case do INGLES; em portugues Title Case mantem preposicoes em minusculas ("Nota Interna da Conversa"). */
import type { INodeProperties } from 'n8n-workflow';

import { campoDeId, camposDeLista, camposDeListaSemPaginacao, opcaoDeIdempotencia } from './comuns';

const CONVERSA = 'conversa';
const MENSAGEM = 'mensagem';

/**
 * Os 3 status FILTRAVEIS. O banco tem um quarto, `adiada`, que aparece nas
 * respostas e devolve 422 quando usado como filtro — por isso ele fica fora.
 */
const STATUS_DE_CONVERSA: INodeProperties['options'] = [
	{ name: 'Aberta', value: 'aberta' },
	{ name: 'Pendente', value: 'pendente' },
	{ name: 'Resolvida', value: 'resolvida' },
];

export const descricaoDoAtendimento: INodeProperties[] = [
	// ── Conversa ───────────────────────────────────────────────────────────
	campoDeId({
		nome: 'conversaId',
		rotulo: 'Conversa',
		descricao: 'Identificador do atendimento, no formato UUID',
		recurso: CONVERSA,
		operacoes: ['obter', 'atualizar'],
	}),

	...camposDeLista({
		recurso: CONVERSA,
		operacoes: ['listar'],
		notaDeLimite:
			'Esta lista pagina por DATA, e nao por cursor: o node segue o campo "antes de" ate o fim. Quando a ultima conversa de uma pagina nao tem mensagem, o servidor devolve "ha mais" sem dizer por onde continuar, e a varredura para com um aviso no log em vez de fingir que acabou.',
	}),

	{
		displayName: 'Filtros',
		name: 'filters',
		type: 'collection',
		placeholder: 'Adicionar filtro',
		default: {},
		displayOptions: { show: { resource: [CONVERSA], operation: ['listar'] } },
		options: [
			{
				displayName: 'Anteriores A',
				name: 'antes_de',
				type: 'dateTime',
				default: '',
				description:
					'Somente conversas cuja ultima mensagem e anterior a este instante. E o mesmo campo que a paginacao usa, entao informar um valor aqui e pedir a pagina que comeca nele.',
			},
			{
				displayName: 'Atendente',
				name: 'atendente_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarAgentes' },
				default: '',
				description: 'Pessoa responsavel pelo atendimento',
			},
			{
				displayName: 'Canal',
				name: 'canal_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarCanais' },
				default: '',
				description: 'Canal por onde a conversa chegou',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: STATUS_DE_CONVERSA,
				default: 'aberta',
				description:
					'Situacao do atendimento. O status "adiada" existe no banco e aparece nas respostas, mas nao e filtravel: usa-lo aqui devolve 422.',
			},
		],
	},

	{
		displayName: 'Campos a Atualizar',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Adicionar campo',
		default: {},
		displayOptions: { show: { resource: [CONVERSA], operation: ['atualizar'] } },
		description:
			'Ao menos um dos dois precisa vir preenchido, senao a API devolve 422. Se o usuario da chave tiver o papel de atendente, informar o responsavel devolve 403.',
		options: [
			{
				displayName: 'Responsável',
				name: 'atendente_usuario_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarAgentes' },
				default: '',
				description: 'Quem passa a responder pelo atendimento',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: STATUS_DE_CONVERSA,
				default: 'resolvida',
				description: 'Nova situacao do atendimento',
			},
		],
	},

	// ── Mensagem ───────────────────────────────────────────────────────────
	campoDeId({
		nome: 'conversaId',
		rotulo: 'Conversa',
		descricao: 'Identificador do atendimento, no formato UUID',
		recurso: MENSAGEM,
		operacoes: ['listar', 'enviar', 'criarNotaInterna'],
	}),

	...camposDeLista({
		recurso: MENSAGEM,
		operacoes: ['listar'],
		notaDeLimite:
			'Esta rota nao aceita cursor nem filtro por data: o teto e de 200 mensagens, da mais recente para a mais antiga.',
	}),

	{
		displayName:
			'A API publica envia SOMENTE texto. Nao ha campo para anexar midia, e um conteudo vazio devolve 422 com a mensagem "Midia ainda nao e suportada pela API publica". A recusa do canal (fora da janela de 24 h, canal desconectado) chega como conflito, e o codigo especifico aparece na descricao do erro.',
		name: 'avisoDeEnvio',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [MENSAGEM], operation: ['enviar'] } },
	},

	{
		displayName: 'Conteúdo',
		name: 'conteudo',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		required: true,
		displayOptions: { show: { resource: [MENSAGEM], operation: ['enviar'] } },
		description: 'Texto enviado ao contato, ate 8000 caracteres',
	},

	{
		displayName: 'Conteúdo',
		name: 'conteudo',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		required: true,
		displayOptions: { show: { resource: [MENSAGEM], operation: ['criarNotaInterna'] } },
		description:
			'Recado interno, de 1 a 10000 caracteres. Fica gravado na conversa e NUNCA vai ao provedor do canal.',
	},

	{
		displayName: 'Opções',
		name: 'options',
		type: 'collection',
		placeholder: 'Adicionar opcao',
		default: {},
		displayOptions: { show: { resource: [MENSAGEM], operation: ['enviar'] } },
		options: [
			{
				displayName: 'ID da Mensagem no Cliente',
				name: 'client_message_id',
				type: 'string',
				default: '',
				// eslint-disable-next-line n8n-nodes-base/node-param-placeholder-miscased-id -- a regra quer "ID" em maiusculas, mas aqui o "id" faz parte da expressao `$execution.id`, que e sintaxe e nao prosa
				placeholder: '={{ $execution.id }}-{{ $itemIndex }}',
				description:
					'Identificador proprio no formato UUID. Repetir o mesmo valor devolve 200 com a marca de reenvio, em vez de mandar a mensagem duas vezes.',
			},
			{
				displayName: 'Responder A',
				name: 'parent_message_id',
				type: 'string',
				default: '',
				description: 'Identificador da mensagem citada, no formato UUID',
			},
			opcaoDeIdempotencia,
		],
	},

	{
		displayName: 'Opções',
		name: 'options',
		type: 'collection',
		placeholder: 'Adicionar opcao',
		default: {},
		displayOptions: { show: { resource: [MENSAGEM], operation: ['criarNotaInterna'] } },
		options: [opcaoDeIdempotencia],
	},

	// ── Canal e Agente ─────────────────────────────────────────────────────
	...camposDeListaSemPaginacao('canalAtendimento'),
	...camposDeListaSemPaginacao('agenteAtendimento'),
];

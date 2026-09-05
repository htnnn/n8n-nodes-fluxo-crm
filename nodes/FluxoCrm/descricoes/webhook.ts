/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options -- a regra exige o rotulo em ingles ("Eventos Names or IDs") em campo alimentado por loadOptionsMethod; a interface deste node e em portugues por decisao do fundador. */
/* eslint-disable n8n-nodes-base/node-param-description-missing-from-dynamic-multi-options -- a descricao existe nos dois campos de eventos; ela so mora numa constante, porque o texto e o mesmo na criacao e na atualizacao, e a regra nao enxerga referencia — so literal. */
/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-update-fields -- a regra exige o rotulo literal "Update Fields"; aqui ele se chama "Campos a Atualizar". */
import type { INodeProperties } from 'n8n-workflow';

import { campoDeId, camposDeListaSemPaginacao, opcoesComIdempotencia } from './comuns';

const RECURSO = 'webhook';

const DESCRICAO_DA_URL =
	'Endereco que recebe as entregas, ate 2000 caracteres. So HTTPS: a validacao anti-SSRF recusa credenciais na URL, localhost, dominios .local, .internal e metadata, e IP privado, CGNAT, link-local ou mapeado. A URL e revalidada A CADA entrega, entao uma regra nova pode desligar uma assinatura antiga.';

const DESCRICAO_DOS_EVENTOS =
	'De 1 a 50 eventos. O unico coringa aceito e o asterisco sozinho, que assina tudo; formas como contato:* ou contato.* devolvem 422. O asterisco nao aparece na lista da API e e acrescentado por este node.';

export const descricaoDoWebhook: INodeProperties[] = [
	campoDeId({
		nome: 'webhookId',
		rotulo: 'Assinatura',
		descricao: 'Identificador da assinatura de webhook, no formato UUID',
		recurso: RECURSO,
		operacoes: ['obter', 'atualizar', 'excluir', 'testar', 'listarEntregas'],
	}),

	campoDeId({
		nome: 'entregaId',
		rotulo: 'Entrega',
		descricao: 'Identificador da entrega a reenviar, no formato UUID',
		recurso: RECURSO,
		operacoes: ['reenviarEntrega'],
	}),

	...camposDeListaSemPaginacao(RECURSO, ['listar', 'listarEntregas', 'listarEventos']),

	{
		displayName:
			'O SEGREDO da assinatura aparece SOMENTE nesta resposta, no campo "segredo" (formato whsec_ seguido de 64 caracteres). Ele nao volta em "Obter" nem em "Listar", e nao existe rota de rotacao: guarde-o agora, no mesmo fluxo, ou a assinatura tera de ser recriada.',
		name: 'avisoDoSegredo',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
	},

	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://exemplo.com/hooks/fluxo',
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description: DESCRICAO_DA_URL,
	},

	{
		displayName: 'Eventos',
		name: 'eventos',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'carregarEventosWebhook' },
		default: [],
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description: DESCRICAO_DOS_EVENTOS,
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
				default: '',
				description: 'Para que serve esta assinatura, ate 500 caracteres',
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
				displayName: 'Ativa',
				name: 'ativo',
				type: 'boolean',
				default: true,
				// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether -- interface em portugues por decisao do fundador; "Se deve" e o equivalente literal de "Whether"
				description:
					'Se deve manter a assinatura ativa. Ligar ZERA o contador de falhas consecutivas e limpa a data de desativacao: e o botao de reativacao depois de 15 falhas seguidas terem desligado a assinatura.',
			},
			{
				displayName: 'Descrição',
				name: 'descricao',
				type: 'string',
				default: '',
				description: 'Para que serve esta assinatura, ate 500 caracteres',
			},
			{
				displayName: 'Eventos',
				name: 'eventos',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'carregarEventosWebhook' },
				default: [],
				description: DESCRICAO_DOS_EVENTOS,
			},
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				description: DESCRICAO_DA_URL,
			},
		],
	},

	opcoesComIdempotencia(RECURSO, ['criar', 'testar', 'reenviarEntrega']),
];

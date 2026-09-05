/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options, n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- as duas regras exigem rotulo em ingles e a descricao boilerplate em todo campo com loadOptionsMethod; a interface deste node e em portugues por decisao do fundador. */
/* eslint-disable n8n-nodes-base/node-param-display-name-miscased -- a regra aplica title case do INGLES; em portugues Title Case mantem preposicoes em minusculas ("Nome da Empresa", "Motivo da Perda"). */
/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-update-fields -- a regra exige o rotulo literal "Update Fields"; aqui ele se chama "Campos a Atualizar". */
import type { INodeProperties } from 'n8n-workflow';

import {
	campoDeId,
	camposDeLista,
	notaDaOperacao,
	opcoesComIdempotencia,
	ordenarPorRotulo,
} from './comuns';

const RECURSO = 'lead';

/**
 * Os 6 status que o FILTRO aceita. O corpo aceita apenas 5: `convertido` e
 * recusado na escrita, porque a conversao tem efeitos colaterais e so acontece
 * pela operacao "Converter".
 */
const STATUS_DE_FILTRO: INodeProperties['options'] = [
	{ name: 'Contatado', value: 'contatado' },
	{ name: 'Convertido', value: 'convertido' },
	{ name: 'Desqualificado', value: 'desqualificado' },
	{ name: 'Novo', value: 'novo' },
	{ name: 'Perdido', value: 'perdido' },
	{ name: 'Qualificado', value: 'qualificado' },
];

const STATUS_DE_ESCRITA: INodeProperties['options'] = STATUS_DE_FILTRO.filter(
	(opcao) => (opcao as { value: string }).value !== 'convertido',
);

const MOTIVOS_DE_PERDA: INodeProperties['options'] = [
	{ name: 'Concorrência', value: 'concorrencia' },
	{ name: 'Fit Ruim', value: 'fit_ruim' },
	{ name: 'Outro', value: 'outro' },
	{ name: 'Preço', value: 'preco' },
	{ name: 'Sem Resposta', value: 'sem_resposta' },
	{ name: 'Timing', value: 'timing' },
];

/** Campos de coluna do lead. Lead nao tem campos personalizados nem etiquetas. */
function camposDoLead(): INodeProperties[] {
	return [
		{
			displayName: 'Cargo',
			name: 'cargo',
			type: 'string',
			default: '',
			description: 'Cargo da pessoa, ate 150 caracteres',
		},
		{
			displayName: 'Email',
			name: 'email',
			type: 'string',
			placeholder: 'nome@email.com',
			default: '',
			description: 'Endereco do lead, ate 320 caracteres, enviado sempre em minusculas',
		},
		{
			displayName: 'Empresa',
			name: 'empresa_id',
			type: 'string',
			default: '',
			description: 'Identificador da empresa ja cadastrada, no formato UUID',
		},
		{
			displayName: 'Motivo da Perda',
			name: 'motivo_perda',
			type: 'options',
			options: MOTIVOS_DE_PERDA,
			default: 'outro',
			description: 'Classificacao da perda, aceita mesmo sem o status perdido',
		},
		{
			displayName: 'Nome da Empresa',
			name: 'empresa_nome',
			type: 'string',
			default: '',
			description:
				'Nome da empresa em texto livre, ate 300 caracteres. E o campo que a conversao le para decidir se cria a ficha de empresa.',
		},
		{
			displayName: 'Notas de Perda',
			name: 'notas_perda',
			type: 'string',
			typeOptions: { rows: 3 },
			default: '',
			description: 'Texto livre sobre a perda, ate 2000 caracteres',
		},
		{
			displayName: 'Origem',
			name: 'origem',
			type: 'string',
			default: '',
			description: 'Como o lead chegou, ate 100 caracteres',
		},
		{
			displayName: 'Responsável',
			name: 'responsavel_id',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
			default: '',
			description: 'Usuario dono do lead, ou uma expressao com o UUID',
		},
		{
			displayName: 'Status',
			name: 'status',
			type: 'options',
			options: STATUS_DE_ESCRITA,
			default: 'novo',
			description:
				'Situacao do lead. "Convertido" nao e aceito aqui: use a operacao Converter, que e a unica que cria as fichas.',
		},
		{
			displayName: 'Telefone',
			name: 'telefone',
			type: 'string',
			default: '',
			description: 'Telefone do lead, ate 50 caracteres',
		},
	];
}

export const descricaoDoLead: INodeProperties[] = [
	campoDeId({
		nome: 'leadId',
		rotulo: 'Lead',
		descricao: 'Identificador do lead, no formato UUID',
		recurso: RECURSO,
		operacoes: ['obter', 'atualizar', 'excluir', 'converter'],
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
				displayName: 'Atualizado Após',
				name: 'atualizado_apos',
				type: 'dateTime',
				default: '',
				description: 'Somente leads alterados depois deste instante',
			},
			{
				displayName: 'Busca',
				name: 'busca',
				type: 'string',
				default: '',
				description:
					'Texto procurado em nome, email e nome da empresa. Os curingas % e _ nao sao escapados pelo servidor.',
			},
			{
				displayName: 'Criado Após',
				name: 'criado_apos',
				type: 'dateTime',
				default: '',
				description: 'Somente leads criados depois deste instante',
			},
			{
				displayName: 'Email',
				name: 'email',
				type: 'string',
				placeholder: 'nome@email.com',
				default: '',
				description: 'Igualdade exata contra o endereco ja gravado em minusculas',
			},
			{
				displayName: 'Responsável',
				name: 'responsavel_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
				default: '',
				description: 'Usuario dono do lead, ou uma expressao com o UUID',
			},
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: STATUS_DE_FILTRO,
				default: 'novo',
				description: 'Situacao do lead; aqui "Convertido" e um valor valido',
			},
		],
	},

	{
		displayName: 'Nome',
		name: 'nome',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description: 'Nome do lead, de 1 a 300 caracteres',
	},

	{
		displayName: 'Campos Adicionais',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Adicionar campo',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		options: camposDoLead(),
	},

	{
		displayName: 'Campos a Atualizar',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Adicionar campo',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['atualizar'] } },
		options: ordenarPorRotulo([
			{
				displayName: 'Nome',
				name: 'nome',
				type: 'string',
				default: '',
				description: 'Nome do lead, de 1 a 300 caracteres',
			},
			...camposDoLead(),
		]),
	},

	notaDaOperacao({
		nome: 'avisoDeConversao',
		recurso: RECURSO,
		operacoes: ['converter'],
		texto:
			'A conversao NAO e transacional: ela cria a empresa, depois o contato, depois o negocio e so entao marca o lead. Se o negocio falhar (organizacao sem pipeline de Negocios, por exemplo), o contato e a empresa JA FORAM CRIADOS e o lead continua nao convertido — e a falha chega como erro 500. Repetir a chamada cria duplicatas, e a chave de idempotencia nao protege aqui, porque resposta nao-2xx libera a chave.',
	}),

	{
		displayName: 'Opções de Conversão',
		name: 'conversao',
		type: 'collection',
		placeholder: 'Adicionar opcao',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['converter'] } },
		options: [
			{
				displayName: 'Contato Existente',
				name: 'contato_existente_id',
				type: 'string',
				default: '',
				description: 'Vincula a este contato em vez de criar um novo, no formato UUID',
			},
			{
				displayName: 'Criar Contato',
				name: 'criar_contato',
				type: 'boolean',
				default: true,
				// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether -- interface em portugues por decisao do fundador; "Se deve" e o equivalente literal de "Whether"
				description: 'Se deve criar um registro do modulo Contatos a partir do lead',
			},
			{
				displayName: 'Criar Empresa',
				name: 'criar_empresa',
				type: 'boolean',
				default: false,
				// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether -- interface em portugues por decisao do fundador
				description:
					'Se deve criar a ficha de empresa. So cria quando o lead tem "Nome da Empresa" preenchido; sem ele, nao cria e NAO avisa.',
			},
			{
				displayName: 'Criar Oportunidade',
				name: 'criar_oportunidade',
				type: 'boolean',
				default: false,
				// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether -- interface em portugues por decisao do fundador
				description:
					'Se deve criar um negocio com o titulo "Negocio — {nome}". Com o modulo Negocios ausente na organizacao, a conversao pula em silencio e devolve negocio_id nulo.',
			},
			{
				displayName: 'Empresa Existente',
				name: 'empresa_existente_id',
				type: 'string',
				default: '',
				description: 'Vincula a esta empresa em vez de criar uma nova, no formato UUID',
			},
			{
				displayName: 'Pipeline',
				name: 'pipeline_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarPipelines' },
				default: '',
				description:
					'Funil do negocio criado. Sem ele, a API usa a pipeline padrao do modulo — e falha com 500 se nao houver nenhuma.',
			},
		],
	},

	opcoesComIdempotencia(RECURSO, ['criar', 'converter']),
];

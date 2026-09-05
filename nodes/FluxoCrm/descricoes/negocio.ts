/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options, n8n-nodes-base/node-param-description-wrong-for-dynamic-options, n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options, n8n-nodes-base/node-param-description-wrong-for-dynamic-multi-options -- mesma justificativa de contato.ts: as quatro regras exigem rotulo em ingles e descricao boilerplate em todo campo com loadOptionsMethod, e a interface deste node e integralmente em portugues por decisao do fundador. */
/* eslint-disable n8n-nodes-base/node-param-display-name-miscased -- a regra aplica title case do INGLES; em portugues Title Case mantem preposicoes em minusculas ("Papel do Contato", "Escopo do Casamento"). */
import type { INodeProperties } from 'n8n-workflow';

import {
	AVISO_DE_ETIQUETAS,
	camposDeLista,
	localizadorDeRegistro,
	opcaoDeIdempotencia,
} from './comuns';
import { OPCOES_DE_OPERADOR } from './operadores';

const RECURSO = 'negocio';

const OPERACOES_COM_ID = ['obter', 'atualizar', 'excluir', 'mover', 'marcarGanho', 'marcarPerdido'];

const blocoDeContato: INodeProperties = {
	displayName: 'Contato',
	name: 'contato',
	type: 'fixedCollection',
	default: {},
	placeholder: 'Vincular contato',
	description:
		'A ficha vinculada ao negocio. A ordem de tentativa e fixa no servidor: ID, email, telefone, Instagram.',
	options: [
		{
			displayName: 'Campos',
			name: 'campos',
			values: [
				{
					displayName: 'Email',
					name: 'email',
					type: 'string',
					placeholder: 'nome@email.com',
					default: '',
					description: 'Endereco usado para achar ou criar a ficha',
				},
				{
					displayName: 'ID',
					name: 'id',
					type: 'string',
					default: '',
					description: 'Identificador da ficha ja conhecida, no formato UUID',
				},
				{
					displayName: 'Instagram',
					name: 'instagram',
					type: 'string',
					default: '',
					description: 'Perfil usado para achar ou criar a ficha',
				},
				{
					displayName: 'Nome',
					name: 'nome',
					type: 'string',
					default: '',
					description: 'Nome usado apenas quando a ficha precisa ser criada',
				},
				{
					displayName: 'Telefone',
					name: 'telefone',
					type: 'string',
					default: '',
					description: 'Numero usado para achar ou criar a ficha',
				},
			],
		},
	],
};

const referenciaDeFunil = (nome: string, rotulo: string, descricao: string): INodeProperties => ({
	displayName: rotulo,
	name: nome,
	type: 'fixedCollection',
	default: {},
	placeholder: `Informar ${rotulo.toLowerCase()}`,
	description: descricao,
	options: [
		{
			displayName: 'Campos',
			name: 'campos',
			values: [
				{
					displayName: 'ID',
					name: 'id',
					type: 'string',
					default: '',
					description: 'Identificador no formato UUID',
				},
				{
					displayName: 'Nome',
					name: 'nome',
					type: 'string',
					default: '',
					description: 'Nome exato, usado quando o identificador nao e conhecido',
				},
			],
		},
	],
});

export const descricaoDoNegocio: INodeProperties[] = [
	localizadorDeRegistro({
		nome: 'negocioId',
		rotulo: 'Negócio',
		descricao: 'A oportunidade sobre a qual esta operacao vai agir',
		metodoDeBusca: 'buscarNegocios',
		recurso: RECURSO,
		operacoes: OPERACOES_COM_ID,
		exemploDeUrl: 'https://crm.nafluxo.com.br/crm/<org>/tab/negocios/<id>',
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
				description: 'Somente negocios alterados depois deste instante',
			},
			{
				displayName: 'Campanha',
				name: 'campanha_id',
				type: 'string',
				default: '',
				description: 'Identificador da campanha, no formato UUID',
			},
			{
				displayName: 'Contato',
				name: 'contato_id',
				type: 'string',
				default: '',
				description: 'Identificador do contato vinculado, no formato UUID',
			},
			{
				displayName: 'Contato (Email)',
				name: 'contato_email',
				type: 'string',
				placeholder: 'nome@email.com',
				default: '',
				description: 'Resolve o contato pelo mesmo casamento usado no upsert',
			},
			{
				displayName: 'Contato (Instagram)',
				name: 'contato_instagram',
				type: 'string',
				default: '',
				description: 'Aceita o perfil com arroba ou a URL completa',
			},
			{
				displayName: 'Contato (Telefone)',
				name: 'contato_telefone',
				type: 'string',
				default: '',
				description: 'Casa por sufixo de pelo menos oito digitos',
			},
			{
				displayName: 'Criado Após',
				name: 'criado_apos',
				type: 'dateTime',
				default: '',
				description: 'Somente negocios criados depois deste instante',
			},
			{
				displayName: 'Dono',
				name: 'dono_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
				default: '',
				description: 'Usuario responsavel pela oportunidade',
			},
			{
				displayName: 'Empresa',
				name: 'empresa_id',
				type: 'string',
				default: '',
				description: 'Identificador da empresa vinculada, no formato UUID',
			},
			{
				displayName: 'Estágio',
				name: 'estagio_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarEstagios' },
				default: '',
				description: 'Coluna do funil em que a oportunidade esta',
			},
			{
				displayName: 'Pipeline',
				name: 'pipeline_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarPipelines' },
				default: '',
				description: 'Funil ao qual a oportunidade pertence',
			},
		],
	},

	{
		displayName: 'Filtros por Campo',
		name: 'filtrosDeCampo',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		placeholder: 'Adicionar filtro por campo',
		displayOptions: { show: { resource: [RECURSO], operation: ['listar'] } },
		description:
			'Filtros sobre os campos do modulo, enviados como campo:{slug}[operador]. Comparacoes numericas ou de data com valor de outro tipo devolvem 500, entao o node confere antes de enviar.',
		options: [
			{
				displayName: 'Critérios',
				name: 'criterios',
				values: [
					{
						displayName: 'Campo',
						name: 'slug',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'carregarCamposDeNegocio' },
						default: '',
						description: 'Slug do campo do modulo de negocios',
					},
					{
						displayName: 'Operador',
						name: 'operador',
						type: 'options',
						options: OPCOES_DE_OPERADOR,
						default: 'igual',
						description: 'Comparacao aplicada ao valor do campo',
					},
					{
						displayName: 'Valor',
						name: 'valor',
						type: 'string',
						default: '',
						description:
							'Ignorado por "Esta Vazio" e "Nao Esta Vazio", que tratam 0 e false como preenchidos',
					},
				],
			},
		],
	},

	{
		displayName: 'Combinação dos Filtros por Campo',
		name: 'condicao',
		type: 'options',
		default: 'e',
		displayOptions: { show: { resource: [RECURSO], operation: ['listar'] } },
		options: [
			{ name: 'E', value: 'e', description: 'Todos os criterios precisam casar' },
			{ name: 'Ou', value: 'ou', description: 'Basta um criterio casar' },
		],
		description:
			'Combina apenas os filtros por campo entre si. Os demais filtros seguem sempre somados.',
	},

	{
		displayName: 'Pipeline',
		name: 'pipeline_id',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'carregarPipelines' },
		default: '',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description:
			'Funil em que a oportunidade nasce. Ela entra no primeiro estagio aberto por ordem — nao ha estagio no corpo desta operacao.',
	},

	{
		displayName: 'Estágio',
		name: 'estagio_id',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'carregarEstagios' },
		default: '',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['mover'] } },
		description:
			'Destino da oportunidade. Mover para um estagio de outro funil e permitido e troca a pipeline do negocio.',
	},

	{
		displayName: 'Estágio de Ganho',
		name: 'estagio_id',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'carregarEstagiosDeGanho' },
		default: '',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['marcarGanho'] } },
		description: 'A lista traz apenas estagios do tipo ganho, que sao os unicos aceitos aqui',
	},

	{
		displayName: 'Estágio de Perda',
		name: 'estagio_id',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'carregarEstagiosDePerda' },
		default: '',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['marcarPerdido'] } },
		description: 'A lista traz apenas estagios do tipo perdido, que sao os unicos aceitos aqui',
	},

	{
		displayName:
			'Campos nao preenchidos aqui sao PRESERVADOS: esta operacao mescla os valores. Para limpar um campo, envie-o explicitamente vazio.',
		name: 'avisoDeMesclagem',
		type: 'notice',
		default: '',
		displayOptions: {
			show: { resource: [RECURSO], operation: ['atualizar', 'criarOuAtualizar'] },
		},
	},

	{
		// `resourceMapper` e nao `json`: a obrigatoriedade vem do layout da
		// organizacao, e so o mapper a le em tempo de edicao. Ver a nota no
		// cabecalho de `compartilhado/mapeador.ts`.
		displayName: 'Valores do Módulo',
		name: 'valores',
		type: 'resourceMapper',
		default: { mappingMode: 'defineBelow', value: null },
		displayOptions: {
			show: { resource: [RECURSO], operation: ['criar', 'atualizar', 'criarOuAtualizar'] },
		},
		typeOptions: {
			resourceMapper: {
				resourceMapperMethod: 'mapearCamposDeNegocio',
				mode: 'add',
				fieldWords: { singular: 'campo', plural: 'campos' },
				addAllFields: false,
				supportAutoMap: true,
			},
		},
		description:
			'Campos do modulo de negocios, lidos do layout desta organizacao. Slug desconhecido e descartado em silencio pelo servidor.',
	},

	{
		...blocoDeContato,
		displayOptions: {
			show: { resource: [RECURSO], operation: ['criar', 'atualizar', 'criarOuAtualizar'] },
		},
	},

	{
		...referenciaDeFunil(
			'pipeline',
			'Pipeline',
			'Obrigatoria na criacao; dispensavel quando o negocio ja existe',
		),
		displayOptions: { show: { resource: [RECURSO], operation: ['criarOuAtualizar'] } },
	},

	{
		...referenciaDeFunil(
			'estagio',
			'Estágio',
			'Estagio de destino, aplicado somente quando "Mover Estagio" estiver ligado',
		),
		displayOptions: { show: { resource: [RECURSO], operation: ['criarOuAtualizar'] } },
	},

	{
		displayName: 'Etiquetas',
		name: 'etiquetas',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'carregarEtiquetas' },
		default: [],
		displayOptions: {
			show: { resource: [RECURSO], operation: ['criar', 'atualizar', 'criarOuAtualizar'] },
		},
		description: 'Etiquetas ja existentes na organizacao, escolhidas pelo nome',
	},

	{
		displayName: 'Etiquetas Novas',
		name: 'etiquetasNovas',
		type: 'string',
		default: '',
		displayOptions: {
			show: { resource: [RECURSO], operation: ['criar', 'atualizar', 'criarOuAtualizar'] },
		},
		description: AVISO_DE_ETIQUETAS,
	},

	{
		displayName: 'Opções',
		name: 'options',
		type: 'collection',
		placeholder: 'Adicionar opcao',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		options: [
			opcaoDeIdempotencia,
			{
				displayName: 'Dono',
				name: 'dono_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
				default: '',
				description:
					'Sem este campo o negocio nasce SEM responsavel: o servidor nao usa o dono da chave como padrao',
			},
		],
	},

	{
		displayName: 'Opções',
		name: 'options',
		type: 'collection',
		placeholder: 'Adicionar opcao',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['criarOuAtualizar'] } },
		options: [
			opcaoDeIdempotencia,
			{
				displayName: 'Criar Contato Se Nao Existir',
				name: 'criar_contato_se_nao_existir',
				type: 'boolean',
				default: true,
				// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether -- interface em portugues por decisao do fundador; "Se deve" e o equivalente literal do "Whether" que a regra exige
				description: 'Se deve criar a ficha de contato quando o casamento nao achar nenhuma',
			},
			{
				displayName: 'Dono',
				name: 'dono_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
				default: '',
				description: 'Usuario responsavel pela oportunidade',
			},
			{
				displayName: 'Escopo do Casamento',
				name: 'escopo',
				type: 'options',
				default: 'modulo',
				options: [
					{ name: 'Módulo', value: 'modulo', description: 'Procura em todo o modulo' },
					{
						name: 'Pipeline',
						value: 'pipeline',
						description: 'Procura apenas dentro da pipeline informada',
					},
				],
				description: 'Onde procurar um negocio existente do mesmo contato',
			},
			{
				displayName: 'Incluir Fechados',
				name: 'incluir_fechados',
				type: 'boolean',
				default: false,
				// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether -- interface em portugues por decisao do fundador; "Se deve" e o equivalente literal do "Whether" que a regra exige
				description:
					'Se deve casar tambem com negocios em estagio de ganho ou perda. Desligado, um cliente recorrente ganha um negocio novo em vez de sobrescrever o historico.',
			},
			{
				displayName: 'Mover Estágio',
				name: 'mover_estagio',
				type: 'boolean',
				default: false,
				// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether -- interface em portugues por decisao do fundador; "Se deve" e o equivalente literal do "Whether" que a regra exige
				description:
					'Se deve aplicar o estagio informado a um negocio ja existente. Desligado por padrao para que uma sincronizacao periodica nao jogue todo negocio de volta ao comeco do funil.',
			},
			{
				displayName: 'Papel do Contato',
				name: 'papel',
				type: 'string',
				default: 'Outro',
				description: 'Papel do contato dentro do negocio, ate 100 caracteres',
			},
			{
				displayName: 'Quando Houver Vários',
				name: 'quando_multiplos',
				type: 'options',
				default: 'mais_recente',
				options: [
					{
						name: 'Mais Recente',
						value: 'mais_recente',
						description: 'Atualiza o negocio ativo mais recente',
					},
					{
						name: 'Erro',
						value: 'erro',
						description: 'Recusa com 422 quando ha mais de um negocio ativo',
					},
				],
				description: 'O que fazer quando o contato tem mais de um negocio ativo',
			},
		],
	},
];

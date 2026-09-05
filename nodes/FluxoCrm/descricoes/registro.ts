/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options, n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- as duas regras exigem rotulo em ingles e a descricao boilerplate em todo campo com loadOptionsMethod; a interface deste node e em portugues por decisao do fundador. */
/* eslint-disable n8n-nodes-base/node-param-display-name-miscased -- a regra aplica title case do INGLES; em portugues Title Case mantem preposicoes em minusculas ("Filtros por Campo"). */
import type { INodeProperties } from 'n8n-workflow';

import {
	campoDeId,
	campoDeModulo,
	camposDeLista,
	mapeadorDeCampos,
	opcoesComIdempotencia,
} from './comuns';
import { OPCOES_DE_OPERADOR } from './operadores';

const RECURSO = 'registro';

const TODAS = ['listar', 'obter', 'criar', 'atualizar', 'excluir', 'listarHistorico'];
const COM_ID = ['obter', 'atualizar', 'excluir', 'listarHistorico'];

export const descricaoDoRegistro: INodeProperties[] = [
	campoDeModulo({ recurso: RECURSO, operacoes: TODAS }),

	campoDeId({
		nome: 'registroId',
		rotulo: 'Registro',
		descricao: 'Identificador da linha do modulo, no formato UUID',
		recurso: RECURSO,
		operacoes: COM_ID,
	}),

	...camposDeLista({ recurso: RECURSO, operacoes: ['listar'] }),

	...camposDeLista({
		recurso: RECURSO,
		operacoes: ['listarHistorico'],
		notaDeLimite:
			'O historico e a unica rota da API com paginacao por pagina, e o servidor a trava na pagina 1: so os 200 eventos mais recentes sao alcancaveis. As chaves saem em camelCase e as datas em UTC, fora do padrao do resto da API.',
	}),

	{
		displayName: 'Filtros',
		name: 'filters',
		type: 'collection',
		placeholder: 'Adicionar filtro',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['listar'] } },
		description:
			'Filtros de query. Metade deles nao esta na especificacao publicada, e o servidor ignora em silencio qualquer parametro que nao conheca — por isso o node so envia os desta lista.',
		options: [
			{
				displayName: 'Atualizado Após',
				name: 'atualizado_apos',
				type: 'dateTime',
				default: '',
				description: 'Somente registros alterados depois deste instante',
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
				description:
					'Resolve o contato pelo mesmo casamento do upsert. Sem contato correspondente, a resposta e uma pagina VAZIA, e nao 404.',
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
				description: 'Casa por sufixo de pelo menos oito digitos, com as variantes do nono digito',
			},
			{
				displayName: 'Criado Após',
				name: 'criado_apos',
				type: 'dateTime',
				default: '',
				description: 'Somente registros criados depois deste instante',
			},
			{
				displayName: 'Dono',
				name: 'dono_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
				default: '',
				description: 'Usuario responsavel pelo registro',
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
				description: 'Coluna do funil em que o registro esta',
			},
			{
				displayName: 'Pipeline',
				name: 'pipeline_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarPipelines' },
				default: '',
				description: 'Funil ao qual o registro pertence',
			},
		],
	},

	{
		displayName: 'Filtros por Campo',
		name: 'filtrosDeCampo',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, loadOptionsDependsOn: ['moduloSlug'] },
		default: {},
		placeholder: 'Adicionar filtro por campo',
		displayOptions: { show: { resource: [RECURSO], operation: ['listar'] } },
		description:
			'Filtros sobre os campos do modulo, enviados como campo:{slug}[operador]. Slug desconhecido aqui devolve 422, ao contrario da escrita, que o descarta em silencio.',
		options: [
			{
				displayName: 'Critérios',
				name: 'criterios',
				values: [
					{
						displayName: 'Campo',
						name: 'slug',
						type: 'options',
						typeOptions: {
							loadOptionsMethod: 'carregarCamposDoModulo',
							loadOptionsDependsOn: ['moduloSlug'],
						},
						default: '',
						description: 'Slug do campo do modulo escolhido acima',
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
		displayName:
			'Campos nao preenchidos aqui sao PRESERVADOS: esta operacao mescla os valores no registro. Para limpar um campo, envie-o explicitamente vazio. E o oposto de "Campos Personalizados" de Contato, Empresa e Atividade, que substituem o conjunto inteiro.',
		name: 'avisoDeMesclagemDoRegistro',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RECURSO], operation: ['criar', 'atualizar'] } },
	},

	mapeadorDeCampos({
		nome: 'valores',
		rotulo: 'Valores do Módulo',
		metodo: 'mapearCamposDoModulo',
		recurso: RECURSO,
		operacoes: ['criar', 'atualizar'],
		dependeDe: ['moduloSlug'],
		descricao:
			'Campos do modulo escolhido, lidos do layout desta organizacao. Slug desconhecido e descartado em silencio pelo servidor.',
	}),

	{
		displayName: 'Campos Adicionais',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Adicionar campo',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		options: [
			{
				displayName: 'Dono',
				name: 'dono_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
				default: '',
				description: 'Usuario responsavel pelo registro',
			},
			{
				displayName: 'Equipe',
				name: 'equipe_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarEquipes' },
				default: '',
				description:
					'Equipe dona do registro. Sem este campo, o registro herda a equipe do membro vinculado a chave.',
			},
		],
	},

	{
		displayName: 'Equipe',
		name: 'equipe_id',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'carregarEquipes' },
		default: '',
		displayOptions: { show: { resource: [RECURSO], operation: ['atualizar'] } },
		description:
			'Equipe dona do registro. Este PATCH nao aceita o dono no topo do corpo — trocar de dono e outra operacao.',
	},

	opcoesComIdempotencia(RECURSO, ['criar']),
];

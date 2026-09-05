/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options, n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- as duas regras exigem o rotulo em ingles ("Responsavel Name or ID") e a descricao boilerplate ("Choose from the list, or specify an ID using an expression") em todo campo alimentado por loadOptionsMethod. A interface deste node e integralmente em portugues por decisao do fundador, e cada campo aqui ja traz o texto equivalente. */
/* eslint-disable n8n-nodes-base/node-param-display-name-miscased -- a regra aplica title case do INGLES, que capitaliza toda palavra; em portugues Title Case mantem preposicoes em minusculas ("Nome da Empresa"). */
/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-update-fields -- a regra exige o rotulo literal "Update Fields" para o parametro `updateFields`; aqui ele se chama "Campos a Atualizar", pela mesma decisao de idioma. */
import type { INodeProperties } from 'n8n-workflow';

import {
	avisoDeSubstituicao,
	camposDeLista,
	localizadorDeRegistro,
	mapeadorDeCampos,
	opcoesComIdempotencia,
	ordenarPorRotulo,
} from './comuns';

const RECURSO = 'empresa';

const OPERACOES_COM_ID = ['obter', 'atualizar', 'excluir', 'listarContatos', 'listarNegocios'];
const OPERACOES_DE_ESCRITA = ['criar', 'atualizar', 'criarOuAtualizar'];

/**
 * Os campos de coluna da empresa.
 *
 * Espelha `baseEmpresa` em `api-publica/rotas/empresas.ts`. Empresas NAO tem
 * `etiquetas`: o schema e `.strict()` sem preparador, entao mandar a chave
 * devolve 422 de verdade — ao contrario de Contatos, onde ela seria descartada
 * em silencio.
 */
function camposDaEmpresa(): INodeProperties[] {
	return [
		{
			displayName: 'Cidade',
			name: 'cidade',
			type: 'string',
			default: '',
			description: 'Cidade da sede, ate 150 caracteres',
		},
		{
			displayName: 'CNPJ',
			name: 'cnpj',
			type: 'string',
			default: '',
			description:
				'CNPJ em texto livre, ate 20 caracteres. O filtro de busca compara por igualdade exata, entao grave sempre com a mesma pontuacao.',
		},
		{
			displayName: 'Estado',
			name: 'estado',
			type: 'string',
			default: '',
			description: 'Unidade federativa da sede, ate 100 caracteres',
		},
		{
			displayName: 'Responsável',
			name: 'responsavel_id',
			type: 'options',
			typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
			default: '',
			description: 'Usuario dono da ficha, ou uma expressao com o UUID',
		},
		{
			displayName: 'Setor',
			name: 'setor',
			type: 'string',
			default: '',
			description: 'Segmento de atuacao, ate 150 caracteres',
		},
		{
			displayName: 'Tamanho',
			name: 'tamanho',
			type: 'string',
			default: '',
			description: 'Porte da empresa em texto livre, ate 50 caracteres',
		},
		{
			displayName: 'Telefone',
			name: 'telefone',
			type: 'string',
			default: '',
			description: 'Telefone principal, ate 50 caracteres',
		},
		{
			displayName: 'Website',
			name: 'website',
			type: 'string',
			default: '',
			description: 'Endereco do site, ate 500 caracteres',
		},
	];
}

export const descricaoDaEmpresa: INodeProperties[] = [
	localizadorDeRegistro({
		nome: 'empresaId',
		rotulo: 'Empresa',
		descricao: 'A ficha sobre a qual esta operacao vai agir',
		metodoDeBusca: 'buscarEmpresas',
		recurso: RECURSO,
		operacoes: OPERACOES_COM_ID,
		exemploDeUrl: 'https://crm.nafluxo.com.br/crm/<org>/tab/Empresas/<id>',
	}),

	...camposDeLista({ recurso: RECURSO, operacoes: ['listar'] }),

	...camposDeLista({
		recurso: RECURSO,
		operacoes: ['listarContatos', 'listarNegocios'],
		notaDeLimite:
			'Esta rota nao aceita cursor: o teto e de 200 linhas, e "Retornar Tudo" apenas pede as 200. Em Negocios, a lista tambem respeita o recorte de visibilidade da chave — registros de outra equipe somem sem aviso.',
	}),

	{
		displayName: 'Filtros',
		name: 'filters',
		type: 'collection',
		placeholder: 'Adicionar filtro',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['listar'] } },
		options: [
			{
				displayName: 'Atualizada Após',
				name: 'atualizado_apos',
				type: 'dateTime',
				default: '',
				description: 'Somente empresas alteradas depois deste instante',
			},
			{
				displayName: 'Busca',
				name: 'busca',
				type: 'string',
				default: '',
				description: 'Texto procurado no nome e no site',
			},
			{
				displayName: 'CNPJ',
				name: 'cnpj',
				type: 'string',
				default: '',
				description:
					'Igualdade exata, sensivel a pontuacao e a caixa — o valor tem de bater com o que foi gravado',
			},
			{
				displayName: 'Criada Após',
				name: 'criado_apos',
				type: 'dateTime',
				default: '',
				description: 'Somente empresas criadas depois deste instante',
			},
			{
				displayName: 'Responsável',
				name: 'responsavel_id',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'carregarUsuarios' },
				default: '',
				description: 'Usuario dono da ficha, ou uma expressao com o UUID',
			},
		],
	},

	{
		displayName: 'Nome',
		name: 'nome',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criar', 'criarOuAtualizar'] } },
		description:
			'Razao social ou nome fantasia, de 1 a 300 caracteres. Continua obrigatorio no upsert mesmo quando o casamento e por CNPJ.',
	},

	{
		displayName: 'Chave de Casamento',
		name: 'chave',
		type: 'options',
		default: 'cnpj',
		displayOptions: { show: { resource: [RECURSO], operation: ['criarOuAtualizar'] } },
		options: [
			{ name: 'CNPJ', value: 'cnpj', description: 'Casa pelo CNPJ ja gravado' },
			{ name: 'Nome', value: 'nome', description: 'Casa pelo nome exato' },
			{ name: 'Website', value: 'website', description: 'Casa pelo endereco do site' },
		],
		description:
			'Campo usado para achar a empresa. Sem cascata: se o campo escolhido veio preenchido e nao casou, a API CRIA em vez de tentar o proximo — diferente do upsert de contatos.',
	},

	{
		displayName: 'Campos Adicionais',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Adicionar campo',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['criar', 'criarOuAtualizar'] } },
		options: camposDaEmpresa(),
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
				description: 'Razao social ou nome fantasia, de 1 a 300 caracteres',
			},
			...camposDaEmpresa(),
		]),
	},

	avisoDeSubstituicao({
		nome: 'avisoDeSubstituicaoDaEmpresa',
		recurso: RECURSO,
		operacoes: OPERACOES_DE_ESCRITA,
		texto:
			'Os campos personalizados abaixo SUBSTITUEM o conjunto atual: chave que voce nao preencher aqui e APAGADA da empresa. Este endpoint nao tem opcao de mesclagem — leia a ficha antes se precisar preservar o que ja existe.',
	}),

	mapeadorDeCampos({
		nome: 'dados',
		rotulo: 'Campos Personalizados',
		metodo: 'mapearCamposDeEmpresa',
		recurso: RECURSO,
		operacoes: OPERACOES_DE_ESCRITA,
		descricao:
			'Campos personalizados do modulo Empresas, lidos do layout desta organizacao. Este conjunto substitui o anterior.',
	}),

	opcoesComIdempotencia(RECURSO, ['criar', 'criarOuAtualizar']),
];

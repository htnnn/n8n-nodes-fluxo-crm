/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options, n8n-nodes-base/node-param-description-wrong-for-dynamic-options, n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options, n8n-nodes-base/node-param-description-wrong-for-dynamic-multi-options -- estas quatro regras exigem o rotulo em ingles ("Responsavel Name or ID") e a descricao boilerplate ("Choose from the list, or specify an ID using an expression") em TODO campo alimentado por loadOptionsMethod. A interface deste node e integralmente em portugues por decisao do fundador, e cada campo aqui ja traz o texto equivalente. E o mesmo caminho que o node Moneybird usa em producao. Desativado no arquivo inteiro, e nao linha a linha, porque a excecao vale para todos os campos dinamicos deste arquivo. */
/* eslint-disable n8n-nodes-base/node-param-display-name-miscased -- a regra aplica title case do INGLES, que capitaliza toda palavra. Em portugues, Title Case mantem preposicoes e artigos em minusculas ("Data de Nascimento", "Nome da Empresa"), e "Data De Nascimento" esta errado no idioma da interface. */
/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-update-fields -- a regra exige o rotulo literal "Update Fields" para o parametro `updateFields`; aqui ele se chama "Campos a Atualizar", pela mesma decisao de idioma. */
import type { INodeProperties } from 'n8n-workflow';

import {
	AVISO_DE_ETIQUETAS,
	camposDeLista,
	localizadorDeRegistro,
	opcaoDeIdempotencia,
} from './comuns';

const RECURSO = 'contato';

const OPERACOES_COM_ID = [
	'obter',
	'atualizar',
	'excluir',
	'verificarExistencia',
	'listarAtividades',
];

const OPERACOES_DE_ESCRITA = ['criar', 'atualizar', 'criarOuAtualizar'];

/**
 * O antidoto para a armadilha mais cara do catalogo: `dados` de contato
 * SUBSTITUI o blob inteiro (omitir uma chave apaga o valor), enquanto `valores`
 * de negocio MESCLA. Duas semanticas opostas na mesma API.
 *
 * O padrao aqui e `true` porque quem monta automacao espera PATCH-como-merge, e
 * o comportamento perigoso nao pode ser o silencioso.
 */
const opcaoDeMesclagem: INodeProperties = {
	displayName: 'Mesclar Com os Valores Atuais',
	name: 'mesclarCamposPersonalizados',
	type: 'boolean',
	default: true,
	// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether -- interface em portugues por decisao do fundador; "Se deve" e o equivalente literal do "Whether" que a regra exige
	description:
		'Se deve ler os campos personalizados atuais e mesclar antes de gravar. Custa uma requisicao a mais por item, e evita que a gravacao apague o que nao foi preenchido.',
};

/**
 * Os campos de coluna do contato.
 *
 * A lista espelha `baseContato` em `api-publica/rotas/contatos.ts` (lida em
 * `origin/main`), inclusive os limites de tamanho: campo aqui que nao existe la
 * e descartado em silencio pelo preparador, com 201 no retorno.
 */
function camposDoContato(): INodeProperties[] {
	return [
		{
			displayName: 'Cargo',
			name: 'cargo',
			type: 'string',
			default: '',
			description: 'Cargo da pessoa na empresa, ate 150 caracteres',
		},
		{
			displayName: 'Celular',
			name: 'celular',
			type: 'string',
			default: '',
			description: 'Telefone celular, ate 50 caracteres. Nao conta como identificador na criacao.',
		},
		{
			displayName: 'Contato Superior',
			name: 'reporta_a',
			type: 'string',
			default: '',
			description: 'Identificador do contato a quem esta pessoa reporta, no formato UUID',
		},
		{
			displayName: 'CPF',
			name: 'cpf',
			type: 'string',
			default: '',
			description: 'CPF em texto livre, ate 20 caracteres, sem validacao de digito verificador',
		},
		{
			displayName: 'Data de Nascimento',
			name: 'data_nascimento',
			type: 'string',
			default: '',
			placeholder: '1990-04-23',
			description:
				'Data de nascimento no formato AAAA-MM-DD. Este campo nao aceita data e hora ISO.',
		},
		{
			displayName: 'Email',
			name: 'email',
			type: 'string',
			placeholder: 'nome@email.com',
			default: '',
			description: 'Endereco principal, ate 320 caracteres, enviado sempre em minusculas',
		},
		{
			displayName: 'Emails Adicionais',
			name: 'emails',
			type: 'string',
			default: '',
			description: 'Ate 20 enderecos separados por virgula, alem do principal',
		},
		{
			displayName: 'Empresa',
			name: 'empresa_id',
			type: 'string',
			default: '',
			description: 'Identificador da empresa a vincular, no formato UUID',
		},
		{
			displayName: 'Etiquetas',
			name: 'etiquetas',
			type: 'multiOptions',
			typeOptions: { loadOptionsMethod: 'carregarEtiquetas' },
			default: [],
			description: 'Etiquetas ja existentes na organizacao, escolhidas pelo nome',
		},
		{
			displayName: 'Etiquetas Novas',
			name: 'etiquetasNovas',
			type: 'string',
			default: '',
			description: AVISO_DE_ETIQUETAS,
		},
		{
			displayName: 'Indústria',
			name: 'industria_id',
			type: 'string',
			default: '',
			description: 'Identificador da industria, no formato UUID',
		},
		{
			displayName: 'Instagram',
			name: 'instagram',
			type: 'string',
			default: '',
			description: 'Perfil principal, ate 150 caracteres',
		},
		{
			displayName: 'Instagrams Adicionais',
			name: 'instagrams',
			type: 'string',
			default: '',
			description: 'Ate 20 perfis separados por virgula, alem do principal',
		},
		{
			displayName: 'Nome',
			name: 'nome',
			type: 'string',
			default: '',
			description: 'Primeiro nome, ate 300 caracteres',
		},
		{
			displayName: 'Nome da Empresa',
			name: 'empresa_nome',
			type: 'string',
			default: '',
			description: 'Nome da empresa em texto livre, quando nao ha ficha para vincular',
		},
		{
			displayName: 'Observações',
			name: 'observacoes',
			type: 'string',
			typeOptions: { rows: 3 },
			default: '',
			description: 'Texto livre, ate 5000 caracteres',
		},
		{
			displayName: 'Origem',
			name: 'origem',
			type: 'string',
			default: '',
			description: 'Como o contato chegou, ate 100 caracteres',
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
			description: 'Setor ou departamento, ate 150 caracteres',
		},
		{
			displayName: 'Sobrenome',
			name: 'sobrenome',
			type: 'string',
			default: '',
			description: 'Sobrenome, ate 300 caracteres',
		},
		{
			displayName: 'Telefone',
			name: 'telefone',
			type: 'string',
			default: '',
			description: 'Telefone principal, ate 50 caracteres',
		},
		{
			displayName: 'Telefone Comercial',
			name: 'telefone_comercial',
			type: 'string',
			default: '',
			description: 'Telefone da empresa, ate 50 caracteres',
		},
		{
			displayName: 'Telefones Adicionais',
			name: 'telefones',
			type: 'string',
			default: '',
			description: 'Ate 20 numeros separados por virgula, alem do principal',
		},
		{
			displayName: 'Tratamento',
			name: 'tratamento',
			type: 'string',
			default: '',
			description: 'Pronome de tratamento, ate 50 caracteres',
		},
		{
			displayName: 'VAT',
			name: 'vat',
			type: 'string',
			default: '',
			description: 'Numero fiscal internacional, ate 30 caracteres',
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

function camposDeEndereco(prefixo: string): INodeProperties[] {
	return [
		{ displayName: 'Bairro', name: `${prefixo}bairro`, type: 'string', default: '' },
		{ displayName: 'CEP', name: `${prefixo}cep`, type: 'string', default: '' },
		{ displayName: 'Cidade', name: `${prefixo}cidade`, type: 'string', default: '' },
		{ displayName: 'Complemento', name: `${prefixo}complemento`, type: 'string', default: '' },
		{ displayName: 'Estado', name: `${prefixo}estado`, type: 'string', default: '' },
		{ displayName: 'Logradouro', name: `${prefixo}logradouro`, type: 'string', default: '' },
		{ displayName: 'Número', name: `${prefixo}numero`, type: 'string', default: '' },
		{ displayName: 'País', name: `${prefixo}pais`, type: 'string', default: '' },
	];
}

export const descricaoDoContato: INodeProperties[] = [
	localizadorDeRegistro({
		nome: 'contatoId',
		rotulo: 'Contato',
		descricao: 'A ficha sobre a qual esta operacao vai agir',
		metodoDeBusca: 'buscarContatos',
		recurso: RECURSO,
		operacoes: OPERACOES_COM_ID,
		exemploDeUrl: 'https://crm.nafluxo.com.br/crm/<org>/tab/Contacts/<id>',
	}),

	...camposDeLista({ recurso: RECURSO, operacoes: ['listar'] }),

	...camposDeLista({
		recurso: RECURSO,
		operacoes: ['listarAtividades'],
		notaDeLimite:
			'Esta rota nao aceita cursor: o teto e de 200 atividades, e "Retornar Tudo" apenas pede as 200.',
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
				displayName: 'Atualizado Após',
				name: 'atualizado_apos',
				type: 'dateTime',
				default: '',
				description: 'Somente contatos alterados depois deste instante',
			},
			{
				displayName: 'Busca',
				name: 'busca',
				type: 'string',
				default: '',
				description: 'Texto procurado em nome, email e telefone',
			},
			{
				displayName: 'Criado Após',
				name: 'criado_apos',
				type: 'dateTime',
				default: '',
				description: 'Somente contatos criados depois deste instante',
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
				displayName: 'Empresa',
				name: 'empresa_id',
				type: 'string',
				default: '',
				description: 'Identificador da empresa vinculada, no formato UUID',
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
				displayName: 'Telefone',
				name: 'telefone',
				type: 'string',
				default: '',
				description: 'Casa por sufixo de pelo menos oito digitos, com as variantes do nono digito',
			},
		],
	},

	{
		displayName: 'Campos Adicionais',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Adicionar campo',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['criar', 'criarOuAtualizar'] } },
		options: camposDoContato(),
	},

	{
		displayName: 'Campos a Atualizar',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Adicionar campo',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['atualizar'] } },
		options: camposDoContato(),
	},

	{
		displayName: 'Endereço',
		name: 'endereco',
		type: 'fixedCollection',
		default: {},
		placeholder: 'Preencher endereco',
		displayOptions: { show: { resource: [RECURSO], operation: OPERACOES_DE_ESCRITA } },
		options: [{ displayName: 'Campos', name: 'campos', values: camposDeEndereco('endereco_') }],
	},

	{
		displayName: 'Endereço Alternativo',
		name: 'enderecoAlternativo',
		type: 'fixedCollection',
		default: {},
		placeholder: 'Preencher endereco alternativo',
		displayOptions: { show: { resource: [RECURSO], operation: OPERACOES_DE_ESCRITA } },
		options: [{ displayName: 'Campos', name: 'campos', values: camposDeEndereco('endereco_alt_') }],
	},

	{
		displayName:
			'Estes campos personalizados SUBSTITUEM o conjunto atual: chave que voce nao preencher aqui e APAGADA do contato. Ative "Mesclar Com os Valores Atuais" nas opcoes para preservar o que ja existe.',
		name: 'avisoDeSubstituicao',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RECURSO], operation: ['atualizar'] } },
	},

	{
		displayName:
			'No ramo de atualizacao, estes campos personalizados SUBSTITUEM o conjunto atual do contato que casar. Nao ha opcao de mesclagem aqui: o node so descobre qual ficha casou depois de gravar.',
		name: 'avisoDeSubstituicaoNoUpsert',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RECURSO], operation: ['criarOuAtualizar'] } },
	},

	{
		// `resourceMapper` e nao `json`: a obrigatoriedade de cada campo vem do
		// LAYOUT da organizacao, entao o mesmo corpo devolve 201 numa org e 422
		// noutra. So o mapper mostra o `required` real, em tempo de edicao e na
		// org daquela credencial.
		displayName: 'Campos Personalizados',
		name: 'dados',
		type: 'resourceMapper',
		default: { mappingMode: 'defineBelow', value: null },
		displayOptions: { show: { resource: [RECURSO], operation: OPERACOES_DE_ESCRITA } },
		typeOptions: {
			resourceMapper: {
				resourceMapperMethod: 'mapearCamposDeContato',
				mode: 'add',
				fieldWords: { singular: 'campo personalizado', plural: 'campos personalizados' },
				addAllFields: false,
				supportAutoMap: true,
			},
		},
		description:
			'Campos personalizados do modulo Contatos, lidos do layout desta organizacao. Este conjunto SUBSTITUI o anterior; veja o aviso acima.',
	},

	{
		displayName: 'Chave de Casamento',
		name: 'chave',
		type: 'multiOptions',
		typeOptions: { loadOptionsMethod: 'carregarChavesDeIndice' },
		default: [],
		displayOptions: { show: { resource: [RECURSO], operation: ['criarOuAtualizar'] } },
		description:
			'Campos de indice usados para achar o contato, em ordem de precedencia. Declarar a chave torna TODOS os campos escolhidos obrigatorios no corpo; deixar em branco usa o indice inteiro do layout.',
	},

	{
		displayName: 'Opções',
		name: 'options',
		type: 'collection',
		placeholder: 'Adicionar opcao',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		options: [opcaoDeIdempotencia],
	},

	{
		displayName: 'Opções',
		name: 'options',
		type: 'collection',
		placeholder: 'Adicionar opcao',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['criarOuAtualizar'] } },
		options: [opcaoDeIdempotencia],
	},

	{
		// PATCH nao aceita `Idempotency-Key` — o cabecalho vale so para POST.
		displayName: 'Opções',
		name: 'options',
		type: 'collection',
		placeholder: 'Adicionar opcao',
		default: {},
		displayOptions: { show: { resource: [RECURSO], operation: ['atualizar'] } },
		options: [opcaoDeMesclagem],
	},
];

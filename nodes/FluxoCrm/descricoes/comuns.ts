/* eslint-disable n8n-nodes-base/node-param-description-missing-from-dynamic-options -- a regra so reconhece a descricao quando ela e um literal dentro do proprio objeto. Este arquivo e feito de CONSTRUTORES de campo: a descricao existe sempre, mas chega por parametro, e a regra reporta o objeto inteiro (nao a linha da descricao), entao um disable de linha nao a alcanca. */
/* eslint-disable n8n-nodes-base/node-param-display-name-miscased -- a regra aplica title case do INGLES, que capitaliza toda palavra; em portugues Title Case mantem preposicoes em minusculas ("Chave de Idempotencia"). */
/* eslint-disable n8n-nodes-base/node-param-description-wrong-for-return-all, n8n-nodes-base/node-param-description-missing-from-limit -- as duas exigem a frase em ingles ("Whether to return all results…", "Max number of results to return"). A interface deste node e em portugues por decisao do fundador, e a descricao daqui diz o mesmo — e mais, porque avisa quando a rota nao pagina de verdade. */
import type { INodeProperties } from 'n8n-workflow';

/**
 * Blocos de interface reutilizados pelos recursos.
 *
 * Toda a interface deste node e em portugues, por decisao do fundador:
 * `displayName` em Title Case, `action` em sentence case.
 */

const REGEX_UUID_TEXTO =
	'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

const REGEX_URL_DO_CRM =
	'https?://[^/]+/crm/[^/]+/tab/[^/]+/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})';

const MENSAGEM_DE_UUID =
	'Informe um UUID. A API devolve 404 (e nao 422) para identificador malformado, entao a conferencia acontece aqui';

/**
 * Monta o `resourceLocator` de um registro.
 *
 * Tres modos: escolher da lista (busca no servidor), colar o UUID, ou colar a
 * URL da tela do CRM. O modo `url` funciona porque o espelho do contato em
 * `registros` reusa o mesmo id que aparece no endereco.
 */
export function localizadorDeRegistro(parametros: {
	nome: string;
	rotulo: string;
	descricao: string;
	metodoDeBusca: string;
	recurso: string;
	operacoes: string[];
	exemploDeUrl: string;
	obrigatorio?: boolean;
}): INodeProperties {
	return {
		displayName: parametros.rotulo,
		name: parametros.nome,
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: parametros.obrigatorio ?? true,
		description: parametros.descricao,
		displayOptions: {
			show: { resource: [parametros.recurso], operation: parametros.operacoes },
		},
		modes: [
			{
				displayName: 'Da Lista',
				name: 'list',
				type: 'list',
				placeholder: 'Escolha um registro…',
				typeOptions: {
					searchListMethod: parametros.metodoDeBusca,
					searchable: true,
					searchFilterRequired: false,
				},
			},
			{
				displayName: 'Por ID',
				name: 'id',
				type: 'string',
				placeholder: '4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d',
				validation: [
					{
						type: 'regex',
						properties: { regex: REGEX_UUID_TEXTO, errorMessage: MENSAGEM_DE_UUID },
					},
				],
			},
			{
				displayName: 'Por URL',
				name: 'url',
				type: 'string',
				placeholder: parametros.exemploDeUrl,
				extractValue: { type: 'regex', regex: REGEX_URL_DO_CRM },
				validation: [
					{
						type: 'regex',
						properties: {
							regex: REGEX_URL_DO_CRM,
							errorMessage: 'Cole o endereco de um registro aberto na tela do Fluxo CRM',
						},
					},
				],
			},
		],
	};
}

/**
 * O par canonico de toda operacao de lista.
 *
 * `notaDeLimite` existe porque nem toda lista da API pagina: varias devolvem
 * tudo de uma vez com teto duro de 200. Nesses casos o corte e local, e dizer
 * isso na descricao e melhor do que simular uma paginacao que nao existe.
 */
export function camposDeLista(parametros: {
	recurso: string;
	operacoes: string[];
	notaDeLimite?: string;
}): INodeProperties[] {
	const mostrar = {
		show: { resource: [parametros.recurso], operation: parametros.operacoes },
	};

	const descricaoDoLimite =
		parametros.notaDeLimite === undefined
			? 'Numero maximo de resultados a retornar'
			: `Numero maximo de resultados a retornar. ${parametros.notaDeLimite}`;

	return [
		{
			displayName: 'Retornar Tudo',
			name: 'returnAll',
			type: 'boolean',
			default: false,
			displayOptions: mostrar,
			// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether -- a interface deste node e em portugues por decisao do fundador; "Se deve" e o equivalente literal de "Whether" que a regra exige
			description: 'Se deve retornar todos os resultados ou apenas ate um limite',
		},
		{
			displayName: 'Limite',
			name: 'limit',
			type: 'number',
			default: 50,
			typeOptions: { minValue: 1 },
			displayOptions: {
				show: {
					resource: [parametros.recurso],
					operation: parametros.operacoes,
					returnAll: [false],
				},
			},
			description: descricaoDoLimite,
		},
	];
}

/**
 * Ordena uma lista de campos por rotulo.
 *
 * Existe por duas razoes praticas: a regra de lint que confere a ordem
 * alfabetica so enxerga arrays LITERAIS, e as colecoes deste node sao montadas
 * por funcao para nao duplicar dezenas de campos entre "Campos Adicionais" e
 * "Campos a Atualizar" — entao a ordem fica por conta desta funcao e do teste
 * que a cobra. E, de quebra, o parametro tipado contextualiza os objetos
 * literais, que sem ele o TypeScript alarga para `string`.
 */
export function ordenarPorRotulo(campos: INodeProperties[]): INodeProperties[] {
	return [...campos].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * O par de lista para as rotas que NAO paginam no servidor.
 *
 * Sao varias: canais, agentes, modulos, campos, etiquetas, usuarios, equipes,
 * funis e eventos de webhook devolvem tudo de uma vez, com teto duro. Dizer
 * isso na descricao e melhor do que simular uma paginacao que nao existe.
 */
export function camposDeListaSemPaginacao(
	recurso: string,
	operacoes: string[] = ['listar'],
): INodeProperties[] {
	return camposDeLista({
		recurso,
		operacoes,
		notaDeLimite:
			'Esta rota devolve a lista inteira de uma vez e nao aceita paginacao: o corte acontece dentro do node.',
	});
}

/**
 * A opcao `Idempotency-Key`, aceita por todo POST da API.
 *
 * Replay devolve o corpo e o status originais; a mesma chave com corpo
 * diferente devolve 409. Resposta nao-2xx LIBERA a chave, entao corrigir o
 * payload e retentar funciona.
 */
export const opcaoDeIdempotencia: INodeProperties = {
	displayName: 'Chave de Idempotência',
	name: 'idempotencyKey',
	type: 'string',
	default: '',
	// eslint-disable-next-line n8n-nodes-base/node-param-placeholder-miscased-id -- a regra quer "ID" em maiusculas, mas aqui o "id" faz parte da expressao `$execution.id`, que e sintaxe e nao prosa
	placeholder: '={{ $execution.id }}-{{ $itemIndex }}',
	description:
		'Enviada no cabecalho Idempotency-Key. Repetir a mesma chave em 24 horas devolve a resposta original; a mesma chave com corpo diferente devolve 409.',
};

/**
 * Um identificador solto, no formato UUID.
 *
 * Usado onde NAO ha `resourceLocator`: so Contato, Empresa e Negocio tem
 * endpoint de busca por texto que alimente o modo "Da Lista". Para o resto, um
 * campo de texto com validacao local de UUID e o mais honesto — e a validacao
 * importa porque a API devolve 404, nunca 422, para identificador malformado.
 */
export function campoDeId(parametros: {
	nome: string;
	rotulo: string;
	descricao: string;
	recurso: string;
	operacoes: string[];
	obrigatorio?: boolean;
}): INodeProperties {
	return {
		displayName: parametros.rotulo,
		name: parametros.nome,
		type: 'string',
		default: '',
		required: parametros.obrigatorio ?? true,
		placeholder: '4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d',
		description: parametros.descricao,
		displayOptions: {
			show: { resource: [parametros.recurso], operation: parametros.operacoes },
		},
	};
}

/**
 * O seletor de modulo (`slug`), presente em Registro, Nota, Modulo e Etiqueta.
 *
 * A lista vem de `GET /modulos`, que so devolve modulo ATIVO. `GET /modulos/{slug}`
 * serve modulo inativo, entao o campo aceita valor livre por expressao — travar
 * na lista esconderia um modulo que a API atende.
 */
export function campoDeModulo(parametros: {
	recurso: string;
	operacoes: string[];
	descricao?: string;
}): INodeProperties {
	return {
		// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options -- a regra exige o rotulo em ingles "Modulo Name or ID"; a interface deste node e em portugues por decisao do fundador
		displayName: 'Módulo',
		name: 'moduloSlug',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'carregarModulos' },
		default: '',
		required: true,
		displayOptions: {
			show: { resource: [parametros.recurso], operation: parametros.operacoes },
		},
		description:
			parametros.descricao ??
			'Slug do modulo, ou uma expressao com ele. A lista traz apenas modulos ativos; um modulo desativado continua acessivel por expressao.',
	};
}

/**
 * O `resourceMapper` de campos definidos pela organizacao.
 *
 * Existe porque a obrigatoriedade de cada campo vem do LAYOUT — o mesmo corpo
 * devolve 201 numa organizacao e 422 noutra. Ver `compartilhado/mapeador.ts`.
 */
export function mapeadorDeCampos(parametros: {
	nome: string;
	rotulo: string;
	metodo: string;
	recurso: string;
	operacoes: string[];
	descricao: string;
	dependeDe?: string[];
}): INodeProperties {
	return {
		displayName: parametros.rotulo,
		name: parametros.nome,
		type: 'resourceMapper',
		default: { mappingMode: 'defineBelow', value: null },
		displayOptions: {
			show: { resource: [parametros.recurso], operation: parametros.operacoes },
		},
		typeOptions: {
			...(parametros.dependeDe === undefined ? {} : { loadOptionsDependsOn: parametros.dependeDe }),
			resourceMapper: {
				resourceMapperMethod: parametros.metodo,
				mode: 'add',
				fieldWords: { singular: 'campo', plural: 'campos' },
				addAllFields: false,
				supportAutoMap: true,
			},
		},
		description: parametros.descricao,
	};
}

/** O bloco "Opcoes" com a chave de idempotencia, para as operacoes POST simples. */
export function opcoesComIdempotencia(
	recurso: string,
	operacoes: string[],
	extras: INodeProperties[] = [],
): INodeProperties {
	return {
		displayName: 'Opções',
		name: 'options',
		type: 'collection',
		placeholder: 'Adicionar opcao',
		default: {},
		displayOptions: { show: { resource: [recurso], operation: operacoes } },
		options: ordenarPorRotulo([...extras, opcaoDeIdempotencia]),
	};
}

/**
 * O aviso que precede um campo cuja gravacao SUBSTITUI o conjunto anterior.
 *
 * A API e inconsistente de proposito nesse ponto: `dados` (contato, empresa,
 * atividade) substitui o blob inteiro, enquanto `valores` (registro, negocio)
 * mescla. Unificar os dois numa abstracao so ensinaria a regra errada.
 */
export function avisoDeSubstituicao(parametros: {
	nome: string;
	recurso: string;
	operacoes: string[];
	texto: string;
}): INodeProperties {
	return {
		displayName: parametros.texto,
		name: parametros.nome,
		type: 'notice',
		default: '',
		displayOptions: {
			show: { resource: [parametros.recurso], operation: parametros.operacoes },
		},
	};
}

/**
 * Uma nota sem parametro, para a operacao que nao tem nenhum.
 *
 * Sem ela o painel fica em branco e o usuario nao sabe se esqueceu de preencher
 * algo. Tambem e o que garante que toda operacao do catalogo tenha ao menos uma
 * propriedade ligada a ela — conferido por teste.
 */
export function notaDaOperacao(parametros: {
	nome: string;
	recurso: string;
	operacoes: string[];
	texto: string;
}): INodeProperties {
	return {
		displayName: parametros.texto,
		name: parametros.nome,
		type: 'notice',
		default: '',
		displayOptions: {
			show: { resource: [parametros.recurso], operation: parametros.operacoes },
		},
	};
}

export const AVISO_DE_ETIQUETAS =
	'Separe por virgula. Etiqueta que ainda nao existe e CRIADA pelo servidor, e cada valor e re-dividido por virgula e ponto e virgula la tambem — "VIP, Urgente" vira duas etiquetas. A API acrescenta e nunca substitui: nao ha como remover etiqueta pela v1';

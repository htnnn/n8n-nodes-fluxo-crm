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

export const AVISO_DE_ETIQUETAS =
	'Separe por virgula. Etiqueta que ainda nao existe e CRIADA pelo servidor, e cada valor e re-dividido por virgula e ponto e virgula la tambem — "VIP, Urgente" vira duas etiquetas. A API acrescenta e nunca substitui: nao ha como remover etiqueta pela v1';

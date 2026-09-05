/* eslint-disable n8n-nodes-base/node-param-display-name-miscased -- a regra aplica title case do INGLES, que capitaliza toda palavra; em portugues Title Case mantem preposicoes em minusculas ("Maximo de Paginas por Sondagem"). A interface deste pacote e em portugues por decisao do fundador. */
import type { INodeProperties } from 'n8n-workflow';

import { MODOS, opcoesEstaticas, RECURSOS_COM_ATUALIZACAO, RECURSOS_SONDAVEIS } from './catalogo';

/**
 * Os campos da interface do gatilho, em portugues.
 *
 * `modo` e `recursoSondado` carregam ao mesmo tempo um array `options`
 * ESTATICO e um `loadOptionsMethod`, pela mesma razao do node de acoes: o
 * painel do node creator renderiza antes de existir credencial e nunca pode
 * filtrar por escopo, enquanto o dropdown dentro do node ja tem credencial e e
 * onde o cadeado faz sentido. A lista remota SUBSTITUI a estatica.
 */

const MOSTRAR_WEBHOOK = { show: { modo: ['webhook'] } };
const MOSTRAR_SONDAGEM = { show: { modo: ['polling'] } };

export const descricaoDoGatilho: INodeProperties[] = [
	{
		// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options -- a regra exige o rotulo em ingles "Modo Name or ID"; este parametro tem lista estatica COMPLETA por tras, entao o rotulo nao esconde nada de quem usa expressao
		displayName: 'Modo',
		name: 'modo',
		type: 'options',
		noDataExpression: true,
		default: 'webhook',
		typeOptions: { loadOptionsMethod: 'carregarModos' },
		options: opcoesEstaticas(MODOS),
		// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- a regra exige a descricao boilerplate em ingles sobre expressoes; este texto responde a duvida real de quem abre o dropdown
		description:
			'Como este node fica sabendo do que acontece. O cadeado marca o modo que a chave de API configurada nao consegue usar.',
	},

	// ── Webhook ──────────────────────────────────────────────────────
	{
		displayName:
			'A lista traz os 34 eventos que a API atual emite, inclusive os de etiqueta, atendimento (conversa iniciada/resolvida, mensagem recebida/enviada) e automacao. Numa instancia com API anterior, os eventos so disparam para escrita feita PELA API v1 — o que a equipe faz na tela nao emite — e os oito mais novos nao existem: a assinatura e recusada. Para reagir a atendimento nessas instancias, use o modo Sondagem.',
		name: 'avisoDoWebhook',
		type: 'notice',
		default: '',
		displayOptions: MOSTRAR_WEBHOOK,
	},
	{
		// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-multi-options -- a regra exige "Eventos Names or IDs" em ingles; a interface deste pacote e em portugues, e a descricao abaixo ja avisa que o valor e o identificador da API
		displayName: 'Eventos',
		name: 'eventos',
		type: 'multiOptions',
		default: [],
		required: true,
		typeOptions: { loadOptionsMethod: 'carregarEventos' },
		displayOptions: MOSTRAR_WEBHOOK,
		// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-multi-options -- mesma razao do rotulo: o boilerplate exigido e em ingles e nao diz o que "Todos os Eventos" faz
		description:
			'Eventos que a assinatura vai escutar. "Todos os Eventos" usa o coringa * do servidor e passa a valer tambem para eventos criados depois. Mudar esta lista com o workflow ativo atualiza a assinatura existente, sem criar outra.',
	},
	{
		displayName: 'Opções do Webhook',
		name: 'opcoesDoWebhook',
		type: 'collection',
		placeholder: 'Adicionar opção',
		default: {},
		displayOptions: MOSTRAR_WEBHOOK,
		options: [
			{
				displayName: 'Ignorar Entrega de Teste',
				name: 'ignorarEntregaDeTeste',
				type: 'boolean',
				default: false,
				// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether -- "Se deve" e o equivalente literal do "Whether" que a regra exige, na lingua desta interface
				description:
					'Se deve descartar a entrega gerada por "Testar" no Fluxo CRM (evento webhook.teste) em vez de disparar o workflow com ela',
			},
			{
				displayName: 'Incluir Metadados da Entrega',
				name: 'incluirMetadados',
				type: 'boolean',
				default: false,
				// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether -- mesma razao da opcao acima
				description:
					'Se deve acrescentar __entrega ao item de saida, com o ID da entrega e os cabecalhos que o Fluxo CRM enviou',
			},
		],
	},

	// ── Sondagem ─────────────────────────────────────────────────────
	{
		// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options -- mesma razao do parametro Modo: lista estatica completa por tras e interface em portugues
		displayName: 'Recurso a Sondar',
		name: 'recursoSondado',
		type: 'options',
		noDataExpression: true,
		default: 'conversa',
		typeOptions: { loadOptionsMethod: 'carregarRecursosSondaveis' },
		options: opcoesEstaticas(RECURSOS_SONDAVEIS),
		displayOptions: MOSTRAR_SONDAGEM,
		// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- mesma razao do parametro Modo
		description:
			'O que consultar a cada ciclo. Conversa e Mensagem sao os unicos caminhos para o atendimento, que nao tem webhook nenhum.',
	},
	{
		displayName: 'Slug do Módulo',
		name: 'slugDoModulo',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'negocios',
		displayOptions: { show: { modo: ['polling'], recursoSondado: ['registroDeModulo'] } },
		description:
			'Identificador do modulo na URL do CRM. Aceita letras, numeros e hifens — por exemplo negocios, contatos, ou o slug de um modulo personalizado.',
	},
	{
		displayName: 'Disparar Quando',
		name: 'gatilhoDeSondagem',
		type: 'options',
		noDataExpression: true,
		default: 'criado',
		displayOptions: { show: { modo: ['polling'], recursoSondado: RECURSOS_COM_ATUALIZACAO } },
		options: [
			{
				name: 'For Atualizado',
				value: 'atualizado',
				description:
					'Usa atualizado_apos. A lista continua ordenada por data de criacao, entao a sondagem percorre as paginas ate o fim para nao perder a edicao de um registro antigo.',
			},
			{
				name: 'For Criado',
				value: 'criado',
				description: 'Usa criado_apos, que e o mesmo eixo da ordenacao da lista',
			},
		],
		description: 'Qual data move a marca d’água entre um ciclo e o seguinte',
	},
	{
		displayName: 'Opções da Sondagem',
		name: 'opcoesDeSondagem',
		type: 'collection',
		placeholder: 'Adicionar opção',
		default: {},
		displayOptions: MOSTRAR_SONDAGEM,
		options: [
			{
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options -- a regra exige o rotulo em ingles "Canal Name or ID"; a interface deste pacote e em portugues, e a descricao abaixo diz que o valor enviado e o ID do canal
				displayName: 'Canal',
				name: 'canalId',
				type: 'options',
				default: '',
				typeOptions: { loadOptionsMethod: 'carregarCanaisDeAtendimento' },
				displayOptions: { show: { '/recursoSondado': ['conversa', 'mensagem'] } },
				// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- mesma razao do rotulo: o boilerplate exigido e em ingles e nao diz o que a lista vazia significa
				description:
					'Limita a sondagem a um canal de atendimento; o valor enviado e o ID do canal. Vazio sonda todos os canais da organizacao.',
			},
			{
				displayName: 'Itens por Consulta',
				name: 'limitePorPagina',
				type: 'number',
				default: 100,
				typeOptions: { minValue: 1, maxValue: 200 },
				description:
					'Tamanho de cada pagina pedida a API. O teto do servidor e 200 — valores maiores sao reduzidos por ele.',
			},
			{
				displayName: 'Máximo de Conversas por Sondagem',
				name: 'maximoDeConversas',
				type: 'number',
				default: 20,
				typeOptions: { minValue: 1, maxValue: 200 },
				displayOptions: { show: { '/recursoSondado': ['mensagem'] } },
				description:
					'Ler mensagens custa uma requisicao por conversa que se moveu, porque a rota de mensagens nao aceita filtro de data. Este teto protege o limite de 120 requisicoes por minuto da chave.',
			},
			{
				displayName: 'Máximo de Páginas por Sondagem',
				name: 'maximoDePaginas',
				type: 'number',
				default: 5,
				typeOptions: { minValue: 1, maxValue: 25 },
				description:
					'Teto de paginas percorridas em um ciclo. Ao bater no teto o node registra um aviso no log, em vez de truncar em silencio.',
			},
			{
				displayName: 'Mensagens por Conversa',
				name: 'mensagensPorConversa',
				type: 'number',
				default: 50,
				typeOptions: { minValue: 1, maxValue: 200 },
				displayOptions: { show: { '/recursoSondado': ['mensagem'] } },
				description:
					'Quantas mensagens recentes ler de cada conversa que se moveu. Precisa ser maior que a rajada esperada entre dois ciclos.',
			},
			{
				displayName: 'Somente Mensagens Recebidas',
				name: 'somenteRecebidas',
				type: 'boolean',
				default: true,
				displayOptions: { show: { '/recursoSondado': ['mensagem'] } },
				// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether -- "Se deve" e o equivalente literal do "Whether" que a regra exige, na lingua desta interface
				description:
					'Se deve descartar o que a propria equipe enviou (direcao saida) e disparar apenas com mensagem do contato',
			},
			{
				displayName: 'Status da Conversa',
				name: 'statusDaConversa',
				type: 'options',
				default: '',
				displayOptions: { show: { '/recursoSondado': ['conversa', 'mensagem'] } },
				options: [
					{ name: 'Aberta', value: 'aberta' },
					{ name: 'Pendente', value: 'pendente' },
					{ name: 'Qualquer Um', value: '' },
					{ name: 'Resolvida', value: 'resolvida' },
				],
				description: 'Limita a sondagem as conversas em um status',
			},
		],
	},
];

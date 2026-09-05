/* eslint-disable n8n-nodes-base/node-param-display-name-miscased -- a regra aplica title case do INGLES; em portugues Title Case mantem preposicoes em minusculas ("Modo de Gravacao"). */
import type { INodeProperties } from 'n8n-workflow';

import { opcoesComIdempotencia } from './comuns';

const RECURSO = 'lote';

const TODAS = ['gravarContatos', 'gravarEmpresas', 'gravarLeads'];

export const descricaoDoLote: INodeProperties[] = [
	{
		displayName:
			'A API responde HTTP 200 mesmo quando itens falham. Este no desmonta o relatorio em UM ITEM DE SAIDA POR LINHA enviada, com o campo "indice" apontando de volta para a posicao no array. Com "Continuar em Caso de Erro" desligado, qualquer falha parcial interrompe a execucao; com ele ligado, as linhas que falharam saem pelo ramo de erro.',
		name: 'avisoDoLote',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RECURSO], operation: TODAS } },
	},

	{
		displayName: 'Itens',
		name: 'itens',
		type: 'json',
		default: '[]',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: TODAS } },
		description:
			'Array de objetos a gravar. Acima de 200 itens o node fatia em blocos e reindexa o relatorio, para que "indice" continue apontando para a posicao no array completo. Chave desconhecida DENTRO de um item e descartada em silencio pelo servidor.',
	},

	{
		displayName: 'Modo de Gravação',
		name: 'modo',
		type: 'options',
		default: 'criar',
		displayOptions: { show: { resource: [RECURSO], operation: TODAS } },
		options: [
			{
				name: 'Criar',
				value: 'criar',
				description: 'Cria toda linha, mesmo quando ja existe ficha equivalente',
			},
			{
				// eslint-disable-next-line n8n-nodes-base/node-param-option-name-wrong-for-upsert -- a regra exige o rotulo em ingles "Create or Update" para o valor `upsert`; `upsert` aqui e o valor do campo `modo` DO SERVIDOR, e o rotulo segue o idioma da interface
				name: 'Criar ou Atualizar',
				value: 'upsert',
				// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-upsert -- mesma razao: a regra exige a frase boilerplate em ingles, e esta descricao diz o que a API faz de fato em cada recurso
				description:
					'Casa por regra propria de cada recurso: contatos pelo indice do layout, empresas por CNPJ e depois site, leads por email e depois telefone',
			},
		],
		description:
			'O padrao do servidor e criar. No modo criar ou atualizar, item SEM identificador nenhum e CRIADO em vez de recusado — divergencia deliberada em relacao a rota unitaria.',
	},

	{
		displayName: 'Disparar Webhooks',
		name: 'dispararWebhooks',
		type: 'boolean',
		default: true,
		displayOptions: { show: { resource: [RECURSO], operation: TODAS } },
		// eslint-disable-next-line n8n-nodes-base/node-param-description-boolean-without-whether -- interface em portugues por decisao do fundador; "Se deve" e o equivalente literal de "Whether"
		description:
			'Se deve emitir os eventos de webhook das linhas gravadas. Desligado, o node envia a lista de gatilhos vazia e um lote grande deixa de inundar as assinaturas.',
	},

	opcoesComIdempotencia(RECURSO, TODAS),
];

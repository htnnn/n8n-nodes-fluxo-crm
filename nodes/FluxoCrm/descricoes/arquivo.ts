/* eslint-disable n8n-nodes-base/node-param-display-name-miscased -- a regra aplica title case do INGLES; em portugues Title Case mantem preposicoes em minusculas ("Tipo da Entidade"). */
import type { INodeProperties } from 'n8n-workflow';

import { campoDeId, camposDeLista, opcoesComIdempotencia } from './comuns';

const RECURSO = 'arquivo';

/**
 * Os tipos de entidade aceitos.
 *
 * `interacao` esta no enum do servidor e e SEMPRE recusado com 422 pelo
 * handler ("Anexos em `interacao` ainda nao sao suportados pela API publica"),
 * entao ele nao entra nesta lista: oferecer um valor que sempre falha e pior do
 * que nao oferece-lo.
 */
const ENTIDADES: INodeProperties['options'] = [
	{ name: 'Lead', value: 'lead' },
	{ name: 'Nota', value: 'nota' },
	{ name: 'Registro', value: 'registro' },
];

export const descricaoDoArquivo: INodeProperties[] = [
	campoDeId({
		nome: 'arquivoId',
		rotulo: 'Anexo',
		descricao: 'Identificador do anexo, no formato UUID',
		recurso: RECURSO,
		operacoes: ['obter', 'excluir'],
	}),

	{
		displayName: 'Tipo da Entidade',
		name: 'entidade_tipo',
		type: 'options',
		options: ENTIDADES,
		default: 'registro',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['listar', 'criar'] } },
		description:
			'A que o arquivo esta preso. Com o modulo Leads desabilitado na organizacao, o valor Lead devolve 404 "Rota nao encontrada" em vez de 403.',
	},

	{
		displayName: 'Entidade',
		name: 'entidade_id',
		type: 'string',
		default: '',
		required: true,
		placeholder: '4a3b2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d',
		displayOptions: { show: { resource: [RECURSO], operation: ['listar', 'criar'] } },
		description:
			'Identificador da entidade, no formato UUID. Na listagem ele e OBRIGATORIO junto com o tipo: sem os dois a API devolve 422, e nao a lista geral.',
	},

	...camposDeLista({
		recurso: RECURSO,
		operacoes: ['listar'],
		notaDeLimite:
			'Esta rota nao aceita cursor: o teto e de 200 anexos, e "Retornar Tudo" apenas pede os 200.',
	}),

	{
		displayName:
			'Esta operacao NAO faz upload: ela registra o vinculo entre a entidade e um arquivo que ja esta hospedado em algum lugar. Suba o arquivo antes, por outro no do fluxo, e informe aqui a URL publica resultante.',
		name: 'avisoDeUpload',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
	},

	{
		displayName: 'Nome',
		name: 'nome',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description: 'Nome do arquivo como ele aparece no CRM, de 1 a 255 caracteres',
	},

	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://arquivos.exemplo.com/contrato.pdf',
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description:
			'Endereco ja hospedado, ate 2000 caracteres. A validacao anti-SSRF do servidor recusa http sem TLS, credenciais embutidas na URL, localhost, dominios .local e .internal e IP literal — e pode haver lista de hosts permitidos.',
	},

	{
		displayName: 'Tipo MIME',
		name: 'mime_type',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'application/pdf',
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description: 'Tipo do conteudo, de 1 a 100 caracteres',
	},

	{
		displayName: 'Tamanho',
		name: 'tamanho',
		type: 'number',
		typeOptions: { minValue: 0 },
		default: 0,
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criar'] } },
		description: 'Tamanho do arquivo em bytes, ate 5000000000',
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
				description: 'Texto livre sobre o anexo, ate 500 caracteres',
			},
		],
	},

	opcoesComIdempotencia(RECURSO, ['criar']),
];

/* eslint-disable n8n-nodes-base/node-param-display-name-wrong-for-dynamic-options, n8n-nodes-base/node-param-description-wrong-for-dynamic-options -- as duas regras exigem rotulo em ingles ("Etiqueta Name or ID") e a descricao boilerplate em todo campo com loadOptionsMethod; a interface deste node e em portugues por decisao do fundador. */
/* eslint-disable n8n-nodes-base/node-param-display-name-miscased -- a regra aplica title case do INGLES; em portugues Title Case mantem preposicoes em minusculas ("Tipo da Entidade", "Forma de Identificar"). */
import type { INodeProperties } from 'n8n-workflow';

import {
	campoDeId,
	campoDeModulo,
	camposDeListaSemPaginacao,
	notaDaOperacao,
	opcoesComIdempotencia,
} from './comuns';

const MODULO = 'modulo';
const ETIQUETA = 'etiqueta';
const ORGANIZACAO = 'organizacao';

const VINCULOS = ['listarVinculos', 'vincular', 'desvincular'];

export const descricaoDaPlataforma: INodeProperties[] = [
	// ── Modulo ─────────────────────────────────────────────────────────────
	campoDeModulo({ recurso: MODULO, operacoes: ['obter', 'listarCampos'] }),

	...camposDeListaSemPaginacao(MODULO, ['listar', 'listarCampos']),

	notaDaOperacao({
		nome: 'notaDeListarCampos',
		recurso: MODULO,
		operacoes: ['listarCampos'],
		texto:
			'Esta e a fonte dos campos personalizados do node: cada linha traz slug, tipo, se e obrigatorio na organizacao e as opcoes de um campo de selecao. O campo "opcoes" sai como JSON cru, sem contrato — leia-o defensivamente.',
	}),

	// ── Etiqueta ───────────────────────────────────────────────────────────
	...camposDeListaSemPaginacao(ETIQUETA, ['listar', 'listarVinculos']),

	{
		displayName: 'Filtros',
		name: 'filters',
		type: 'collection',
		placeholder: 'Adicionar filtro',
		default: {},
		displayOptions: { show: { resource: [ETIQUETA], operation: ['listar'] } },
		options: [
			{
				displayName: 'Módulo',
				name: 'modulo_id',
				type: 'string',
				default: '',
				description:
					'Identificador do modulo, no formato UUID — e o ID, nao o slug. Um valor fora do formato e IGNORADO em silencio pelo servidor e devolve a lista completa, entao o node confere antes de enviar.',
			},
		],
	},

	notaDaOperacao({
		nome: 'notaDoCatalogoDeEtiquetas',
		recurso: ETIQUETA,
		operacoes: ['listar'],
		texto:
			'Esta operacao lista o CATALOGO de etiquetas da organizacao, e nao as etiquetas aplicadas a um registro. Para essas, use "Listar Vinculos".',
	}),

	campoDeModulo({
		recurso: ETIQUETA,
		operacoes: VINCULOS,
		descricao:
			'Slug do modulo a que o registro pertence — contatos, negocios, empresas, tarefas ou qualquer modulo personalizado. E o segmento de tipo da rota de vinculo.',
	}),

	campoDeId({
		nome: 'entidadeId',
		rotulo: 'Registro',
		descricao: 'Identificador do registro que recebe ou perde a etiqueta, no formato UUID',
		recurso: ETIQUETA,
		operacoes: VINCULOS,
	}),

	{
		displayName: 'Forma de Identificar',
		name: 'modoDeVinculo',
		type: 'options',
		default: 'nome',
		displayOptions: { show: { resource: [ETIQUETA], operation: ['vincular'] } },
		options: [
			{
				name: 'Por Nome',
				value: 'nome',
				description: 'Resolve sem diferenciar maiusculas e CRIA a etiqueta quando ela nao existe',
			},
			{
				name: 'Por ID',
				value: 'id',
				description: 'Exige uma etiqueta ja existente do mesmo modulo do registro',
			},
		],
		description:
			'O corpo aceita um OU outro, nunca os dois — mandar ambos devolve 422. Por nome e a via pratica numa automacao, que tem o rotulo em maos e nao o identificador.',
	},

	{
		displayName: 'Nome da Etiqueta',
		name: 'nome',
		type: 'string',
		default: '',
		required: true,
		displayOptions: {
			show: { resource: [ETIQUETA], operation: ['vincular'], modoDeVinculo: ['nome'] },
		},
		description:
			'Nome da etiqueta, de 1 a 100 caracteres. Nome inexistente e criado. Ao contrario do campo de etiquetas no corpo de um contato, aqui estourar o teto de 200 etiquetas do modulo DERRUBA a requisicao, porque vincular e a operacao inteira.',
	},

	{
		displayName: 'Etiqueta',
		name: 'etiqueta_id',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'carregarEtiquetasPorId' },
		default: '',
		required: true,
		displayOptions: {
			show: { resource: [ETIQUETA], operation: ['vincular'], modoDeVinculo: ['id'] },
		},
		description:
			'Etiqueta ja existente, ou uma expressao com o UUID. Ela precisa ser da mesma organizacao E do mesmo modulo do registro, senao a API devolve 404.',
	},

	{
		displayName: 'Etiqueta',
		name: 'etiquetaId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'carregarEtiquetasPorId' },
		default: '',
		required: true,
		displayOptions: { show: { resource: [ETIQUETA], operation: ['desvincular'] } },
		description:
			'Etiqueta a remover do registro, ou uma expressao com o UUID. A rota responde 200 mesmo quando o vinculo nao existia, e o campo "removido" da saida diz qual dos dois casos aconteceu.',
	},

	opcoesComIdempotencia(ETIQUETA, ['vincular']),

	// ── Organizacao ────────────────────────────────────────────────────────
	...camposDeListaSemPaginacao(ORGANIZACAO, ['listarUsuarios', 'listarEquipes']),

	notaDaOperacao({
		nome: 'notaDeContexto',
		recurso: ORGANIZACAO,
		operacoes: ['obterContexto'],
		texto:
			'Devolve a organizacao que emitiu a chave, os escopos concedidos e o usuario vinculado. Esta rota deixou de exigir escopo — o node ainda tolera a versao antiga da API, que respondia 403 aqui.',
	}),

	notaDaOperacao({
		nome: 'notaDeCapacidades',
		recurso: ORGANIZACAO,
		operacoes: ['obterCapacidades'],
		texto:
			'Devolve, numa requisicao so, o que antes exigia seis: escopos, modulos, funis com estagios, usuarios, equipes, etiquetas e o catalogo. Quando a chave nao tem meta:ler, os blocos da organizacao voltam VAZIOS e o nome de cada um aparece em "blocos_omitidos" — lista vazia ali NAO significa organizacao sem dado.',
	}),

	notaDaOperacao({
		nome: 'notaDeEscopos',
		recurso: ORGANIZACAO,
		operacoes: ['listarEscopos'],
		texto:
			'Lista os escopos concediveis e os eventos de webhook. Os coringas nao aparecem aqui: a lista e o produto de recursos por acoes, mas a API honra tanto o asterisco global quanto a forma recurso:asterisco.',
	}),

	notaDaOperacao({
		nome: 'notaDePing',
		recurso: ORGANIZACAO,
		operacoes: ['verificarDisponibilidade'],
		texto:
			'Sonda de rede, sem credencial: responde 200 mesmo para chave revogada. Ela NAO serve para testar a credencial — quem faz isso e o botao de teste da propria credencial, que usa a rota de contexto.',
	}),
];

import type { INodeProperties } from 'n8n-workflow';

import { campoDeId, campoDeModulo, camposDeLista, opcoesComIdempotencia } from './comuns';

const RECURSO = 'nota';

const TODAS = ['listar', 'criar', 'atualizar', 'excluir'];

export const descricaoDaNota: INodeProperties[] = [
	campoDeModulo({ recurso: RECURSO, operacoes: TODAS }),

	campoDeId({
		nome: 'registroId',
		rotulo: 'Registro',
		descricao: 'Identificador da linha a que a nota pertence, no formato UUID',
		recurso: RECURSO,
		operacoes: TODAS,
	}),

	campoDeId({
		nome: 'notaId',
		rotulo: 'Nota',
		descricao: 'Identificador da nota, no formato UUID',
		recurso: RECURSO,
		operacoes: ['atualizar', 'excluir'],
	}),

	...camposDeLista({
		recurso: RECURSO,
		operacoes: ['listar'],
		notaDeLimite:
			'Esta rota nao aceita cursor: o teto e de 200 notas, e "Retornar Tudo" apenas pede as 200.',
	}),

	{
		displayName: 'Texto',
		name: 'texto',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		required: true,
		displayOptions: { show: { resource: [RECURSO], operation: ['criar', 'atualizar'] } },
		description: 'Conteudo da nota, de 1 a 10000 caracteres. E o unico campo alteravel.',
	},

	{
		displayName:
			'Excluir uma nota e DEFINITIVO: esta rota apaga a linha do banco, sem lixeira e sem evento de webhook — ao contrario dos demais recursos, que fazem exclusao logica. Escrever, alterar e excluir nota exigem permissao de EDICAO no modulo, e nao apenas de criacao.',
		name: 'avisoDeExclusaoDaNota',
		type: 'notice',
		default: '',
		displayOptions: { show: { resource: [RECURSO], operation: ['excluir'] } },
	},

	opcoesComIdempotencia(RECURSO, ['criar']),
];

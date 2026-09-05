import type { INodeProperties } from 'n8n-workflow';

/**
 * Os 14 operadores de `campo:{slug}[operador]`, compartilhados por
 * `negocio:listar` e `registro:listar`.
 *
 * Uma copia por recurso divergiria na primeira vez que o motor de criterios
 * ganhasse um operador — e o dropdown do outro recurso continuaria oferecendo a
 * lista antiga sem nenhum erro no meio.
 */
export const OPCOES_DE_OPERADOR: INodeProperties['options'] = [
	{ name: 'Antes De', value: 'antes' },
	{ name: 'Comeca Com', value: 'comeca_com' },
	{ name: 'Contem', value: 'contem' },
	{ name: 'Depois De', value: 'depois' },
	{ name: 'Diferente De', value: 'nao_igual' },
	{ name: 'Esta Vazio', value: 'vazio' },
	{ name: 'Igual A', value: 'igual' },
	{ name: 'Maior Ou Igual', value: 'maior_igual' },
	{ name: 'Maior Que', value: 'maior' },
	{ name: 'Menor Ou Igual', value: 'menor_igual' },
	{ name: 'Menor Que', value: 'menor' },
	{ name: 'Nao Contem', value: 'nao_contem' },
	{ name: 'Nao Esta Vazio', value: 'nao_vazio' },
	{ name: 'Termina Com', value: 'termina_com' },
];

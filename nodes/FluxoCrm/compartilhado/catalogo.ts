import type { INodePropertyOptions } from 'n8n-workflow';

import { temEscopo, type EstadoDeEscopos } from './escopos';

/**
 * Catalogo dos recursos e operacoes expostos por este node.
 *
 * Esta lista e a fonte unica de tres coisas que precisam concordar entre si:
 * o array `options` ESTATICO (que o painel de Actions do node creator le, e que
 * nunca conhece credencial nenhuma), a lista REMOTA do dropdown (que filtra por
 * escopo) e a catraca de execucao. Mantidas em arquivos diferentes, elas
 * divergem — e a divergencia aparece como o erro generico do n8n
 * (`The value "x" is not supported!`), que nao diz nada a ninguem.
 */

export interface OperacaoDoCatalogo {
	valor: string;
	/** Title Case, curto — e o rotulo do dropdown. */
	nome: string;
	/** Sentence case, sem ponto final — e o texto da busca de acoes do canvas. */
	acao: string;
	descricao: string;
	/** `null` para operacao que nao exige escopo algum. */
	escopo: string | null;
}

export interface RecursoDoCatalogo {
	valor: string;
	nome: string;
	descricao: string;
	operacaoPadrao: string;
	operacoes: OperacaoDoCatalogo[];
}

/** Prefixo do rotulo de operacao que a chave atual nao pode executar. */
export const MARCA_DE_CADEADO = '\u{1F512} ';

export const RECURSOS: RecursoDoCatalogo[] = [
	{
		valor: 'contato',
		nome: 'Contato',
		descricao: 'Fichas de pessoas do CRM',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'atualizar',
				nome: 'Atualizar',
				acao: 'Atualizar um contato',
				descricao: 'Alterar campos de um contato existente',
				escopo: 'contatos:escrever',
			},
			{
				valor: 'criar',
				nome: 'Criar',
				acao: 'Criar um contato',
				descricao: 'Criar uma ficha de contato',
				escopo: 'contatos:escrever',
			},
			{
				valor: 'criarOuAtualizar',
				nome: 'Criar ou Atualizar',
				acao: 'Criar ou atualizar um contato',
				descricao: 'Casar por um campo de indice e criar quando nao existir',
				escopo: 'contatos:escrever',
			},
			{
				valor: 'excluir',
				nome: 'Excluir',
				acao: 'Excluir um contato',
				descricao: 'Remover uma ficha de contato',
				escopo: 'contatos:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar contatos',
				descricao: 'Listar contatos com filtros e paginacao',
				escopo: 'contatos:ler',
			},
			{
				valor: 'listarAtividades',
				nome: 'Listar Atividades',
				acao: 'Listar as atividades de um contato',
				// Escopo cruzado: esta operacao vive em Contato mas consome
				// `atividades:ler`. E a causa mais comum de "por que esta operacao
				// esta com cadeado?".
				descricao: 'Listar as atividades ligadas a um contato',
				escopo: 'atividades:ler',
			},
			{
				valor: 'obter',
				nome: 'Obter',
				acao: 'Obter um contato',
				descricao: 'Buscar um contato pelo identificador',
				escopo: 'contatos:ler',
			},
			{
				valor: 'verificarExistencia',
				nome: 'Verificar Existencia',
				acao: 'Verificar se um contato existe',
				descricao: 'Conferir se um identificador corresponde a um contato',
				escopo: 'contatos:ler',
			},
		],
	},
	{
		valor: 'negocio',
		nome: 'Negocio',
		descricao: 'Oportunidades comerciais dentro de um funil',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'atualizar',
				nome: 'Atualizar',
				acao: 'Atualizar um negocio',
				descricao: 'Alterar os valores de um negocio existente',
				escopo: 'negocios:escrever',
			},
			{
				valor: 'criar',
				nome: 'Criar',
				acao: 'Criar um negocio',
				descricao: 'Criar uma oportunidade no primeiro estagio aberto da pipeline',
				escopo: 'negocios:escrever',
			},
			{
				valor: 'criarOuAtualizar',
				nome: 'Criar ou Atualizar',
				acao: 'Criar ou atualizar um negocio pelo contato',
				descricao: 'Casar pelo contato e criar quando nao existir',
				escopo: 'negocios:escrever',
			},
			{
				valor: 'excluir',
				nome: 'Excluir',
				acao: 'Excluir um negocio',
				descricao: 'Remover uma oportunidade',
				escopo: 'negocios:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar negocios',
				descricao: 'Listar oportunidades com filtros e paginacao',
				escopo: 'negocios:ler',
			},
			{
				valor: 'marcarGanho',
				nome: 'Marcar Como Ganho',
				acao: 'Marcar um negocio como ganho',
				descricao: 'Mover a oportunidade para um estagio do tipo ganho',
				escopo: 'negocios:escrever',
			},
			{
				valor: 'marcarPerdido',
				nome: 'Marcar Como Perdido',
				acao: 'Marcar um negocio como perdido',
				descricao: 'Mover a oportunidade para um estagio do tipo perdido',
				escopo: 'negocios:escrever',
			},
			{
				valor: 'mover',
				nome: 'Mover',
				acao: 'Mover um negocio de estagio',
				descricao: 'Levar a oportunidade para outro estagio, inclusive de outra pipeline',
				escopo: 'negocios:escrever',
			},
			{
				valor: 'obter',
				nome: 'Obter',
				acao: 'Obter um negocio',
				descricao: 'Buscar uma oportunidade pelo identificador',
				escopo: 'negocios:ler',
			},
		],
	},
];

export function encontrarRecurso(valor: string): RecursoDoCatalogo | undefined {
	return RECURSOS.find((recurso) => recurso.valor === valor);
}

export function encontrarOperacao(
	recurso: string,
	operacao: string,
): OperacaoDoCatalogo | undefined {
	return encontrarRecurso(recurso)?.operacoes.find((item) => item.valor === operacao);
}

/**
 * O motivo que aparece como linha secundaria sob o nome da operacao.
 *
 * `disabled: true` em `INodePropertyOptions` NAO funciona: o campo nao existe
 * no tipo e a interface o ignora por completo (medido no spike). O que funciona
 * e a `description`, que renderiza como linha cinza sob o nome — por isso o
 * motivo vive aqui e nao numa flag.
 */
export function motivoDeBloqueio(escopo: string): string {
	return `Requer o escopo ${escopo} — gere uma chave nova em Configuracoes › Integracoes no Fluxo CRM`;
}

function porNome(a: INodePropertyOptions, b: INodePropertyOptions): number {
	return a.name.localeCompare(b.name, 'pt-BR');
}

/**
 * Opcoes ESTATICAS de operacao — as que o painel de Actions do node creator le.
 *
 * Nunca levam cadeado: esse painel renderiza antes de existir credencial, entao
 * filtrar por escopo aqui seria mentir com base em nada.
 */
export function opcoesEstaticasDeOperacao(recurso: RecursoDoCatalogo): INodePropertyOptions[] {
	return recurso.operacoes
		.map((operacao) => ({
			name: operacao.nome,
			value: operacao.valor,
			action: operacao.acao,
			description: operacao.descricao,
		}))
		.sort(porNome);
}

/**
 * Opcoes REMOTAS de operacao — as que o dropdown dentro do node le.
 *
 * A operacao que a chave nao pode executar CONTINUA na lista e CONTINUA
 * selecionavel, por decisao do fundador: esconde-la fecharia o dropdown mas
 * deixaria o painel de Actions oferecendo a mesma operacao sem aviso nenhum.
 * Ela ganha cadeado no nome e o motivo na descricao; se o usuario insistir, a
 * execucao falha com uma mensagem que diz qual escopo falta.
 *
 * Ordem: permitidas primeiro, bloqueadas depois; alfabetica dentro de cada grupo.
 */
export function opcoesDeOperacaoComEscopo(
	recurso: RecursoDoCatalogo,
	estado: EstadoDeEscopos,
): INodePropertyOptions[] {
	const permitidas: INodePropertyOptions[] = [];
	const bloqueadas: INodePropertyOptions[] = [];

	for (const operacao of recurso.operacoes) {
		if (operacaoPermitida(operacao, estado)) {
			permitidas.push({
				name: operacao.nome,
				value: operacao.valor,
				action: operacao.acao,
				description: operacao.descricao,
			});
			continue;
		}

		bloqueadas.push({
			name: `${MARCA_DE_CADEADO}${operacao.nome}`,
			value: operacao.valor,
			action: operacao.acao,
			description: motivoDeBloqueio(operacao.escopo as string),
		});
	}

	return [...permitidas.sort(porNome), ...bloqueadas.sort(porNome)];
}

/** `true` quando a operacao pode ser executada, ou quando nao sabemos os escopos. */
export function operacaoPermitida(operacao: OperacaoDoCatalogo, estado: EstadoDeEscopos): boolean {
	if (operacao.escopo === null) return true;
	if (!estado.conhecidos) return true;
	return temEscopo(estado.escopos, operacao.escopo);
}

export function opcoesEstaticasDeRecurso(): INodePropertyOptions[] {
	return RECURSOS.map((recurso) => ({
		name: recurso.nome,
		value: recurso.valor,
		description: recurso.descricao,
	})).sort(porNome);
}

/**
 * Opcoes remotas de recurso. O recurso so ganha cadeado quando NENHUMA de suas
 * operacoes esta ao alcance da chave — marcar "Contato" porque falta
 * `contatos:escrever` esconderia que listar continua funcionando.
 */
export function opcoesDeRecursoComEscopo(estado: EstadoDeEscopos): INodePropertyOptions[] {
	const disponiveis: INodePropertyOptions[] = [];
	const indisponiveis: INodePropertyOptions[] = [];

	for (const recurso of RECURSOS) {
		const alcancaveis = recurso.operacoes.filter((operacao) => operacaoPermitida(operacao, estado));

		if (alcancaveis.length > 0) {
			disponiveis.push({
				name: recurso.nome,
				value: recurso.valor,
				description: recurso.descricao,
			});
			continue;
		}

		const escoposFaltantes = [
			...new Set(recurso.operacoes.map((operacao) => operacao.escopo).filter(Boolean)),
		].join(', ');

		indisponiveis.push({
			name: `${MARCA_DE_CADEADO}${recurso.nome}`,
			value: recurso.valor,
			description: `Nenhuma operacao deste recurso esta ao alcance da chave. Escopos envolvidos: ${escoposFaltantes}.`,
		});
	}

	return [...disponiveis.sort(porNome), ...indisponiveis.sort(porNome)];
}

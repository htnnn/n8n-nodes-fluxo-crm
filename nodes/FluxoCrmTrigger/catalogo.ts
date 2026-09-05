import type { INodePropertyOptions } from 'n8n-workflow';

import { MARCA_DE_CADEADO, motivoDeBloqueio } from '../FluxoCrm/compartilhado/catalogo';
import { temEscopo, type EstadoDeEscopos } from '../FluxoCrm/compartilhado/escopos';

/**
 * Catalogo do gatilho: modos, eventos e recursos sondaveis.
 *
 * Mesmo desenho do catalogo do node de acoes — uma lista so, da qual saem tanto
 * as opcoes estaticas (que o painel de Actions do node creator le, antes de
 * existir credencial) quanto as remotas (que ganham cadeado por escopo). O
 * cadeado reusa `MARCA_DE_CADEADO` e `motivoDeBloqueio` do compartilhado para
 * que os dois nodes digam a mesma frase.
 */

// ── Modos ────────────────────────────────────────────────────────────

export interface ModoDoGatilho {
	valor: string;
	nome: string;
	descricao: string;
	/** `null` para o modo que nao exige escopo algum. */
	escopo: string | null;
}

export const MODOS: ModoDoGatilho[] = [
	{
		valor: 'polling',
		nome: 'Sondagem Periodica',
		descricao:
			'Consulta a API em intervalos. Nao precisa de endereco publico, e e o caminho para reagir a atendimento numa instancia cuja API ainda nao emite os eventos de conversa e mensagem.',
		escopo: null,
	},
	{
		valor: 'webhook',
		nome: 'Webhook',
		descricao:
			'O Fluxo CRM avisa esta instancia quando o evento acontece. Exige que a URL de webhook do n8n seja HTTPS e publica.',
		escopo: 'webhooks:escrever',
	},
];

// ── Eventos ──────────────────────────────────────────────────────────
//
// A tabela mora em `compartilhado/eventos.ts`, junto do node de acoes: os dois
// `multiOptions` de eventos (o deste gatilho e o de `Webhook › Criar`) leem a
// mesma lista, os mesmos rotulos e o mesmo fallback. Reexportada aqui para os
// consumidores do gatilho continuarem importando do catalogo dele.
export {
	CORINGA_DE_EVENTOS,
	EVENTOS_CONHECIDOS,
	opcoesDeEvento,
	rotuloDoEvento,
} from '../FluxoCrm/compartilhado/eventos';

// ── Recursos sondaveis ───────────────────────────────────────────────

export interface RecursoSondavel {
	valor: string;
	nome: string;
	descricao: string;
	escopo: string;
	/**
	 * Caminho da lista. `{slug}` e substituido pelo slug do modulo em
	 * `registroDeModulo`.
	 */
	caminho: string;
	/** Query que filtra por data de criacao no servidor, ou `null` quando a rota nao tem. */
	filtroDeCriacao: string | null;
	/** Query que filtra por data de atualizacao no servidor, ou `null`. */
	filtroDeAtualizacao: string | null;
	/** Campo do item que carrega o instante usado como marca d'agua. */
	campoDeCriacao: string;
	campoDeAtualizacao: string;
	/** `true` quando a lista aceita `cursor` keyset e devolve `tem_mais`. */
	temCursor: boolean;
}

/**
 * ATENCAO a uma armadilha real da API: as listas ordenam por `criado_em` DESC,
 * mas `atualizado_apos` filtra por `atualizado_em`. Sondar "atualizados" lendo
 * so a primeira pagina, portanto, PERDE a atualizacao de um registro antigo —
 * ele fica no fim da ordenacao. Por isso a sondagem por atualizacao pagina pelo
 * cursor ate esgotar (com teto), em vez de confiar na primeira pagina.
 */
export const RECURSOS_SONDAVEIS: RecursoSondavel[] = [
	{
		valor: 'atividade',
		nome: 'Atividade',
		descricao: 'Tarefas e compromissos',
		escopo: 'atividades:ler',
		caminho: '/atividades',
		filtroDeCriacao: 'criado_apos',
		// A rota nao expoe `atualizado_apos` — ver `rotas/atividades.ts`.
		filtroDeAtualizacao: null,
		campoDeCriacao: 'criado_em',
		campoDeAtualizacao: 'atualizado_em',
		temCursor: true,
	},
	{
		valor: 'conversa',
		nome: 'Atendimento › Conversa',
		descricao:
			'Conversas novas ou com mensagem nova (WhatsApp e demais canais). Alternativa aos eventos conversa.iniciada e mensagem.recebida do modo Webhook, para instancia sem eles.',
		escopo: 'atendimento:ler',
		caminho: '/atendimento/conversas',
		// A rota nao tem filtro "depois de": o cursor dela e `antes_de`, e a
		// ordenacao ja e a mais recente primeiro. O corte e local.
		filtroDeCriacao: null,
		filtroDeAtualizacao: null,
		campoDeCriacao: 'criado_em',
		campoDeAtualizacao: 'ultima_mensagem_em',
		temCursor: false,
	},
	{
		valor: 'mensagem',
		nome: 'Atendimento › Mensagem',
		descricao:
			'Mensagens novas nas conversas que se moveram (WhatsApp e demais canais). Alternativa ao evento mensagem.recebida do modo Webhook, para instancia sem ele.',
		escopo: 'atendimento:ler',
		caminho: '/atendimento/conversas',
		filtroDeCriacao: null,
		filtroDeAtualizacao: null,
		campoDeCriacao: 'enviado_em',
		campoDeAtualizacao: 'enviado_em',
		temCursor: false,
	},
	{
		valor: 'contato',
		nome: 'Contato',
		descricao: 'Fichas de pessoas do CRM',
		escopo: 'contatos:ler',
		caminho: '/contatos',
		filtroDeCriacao: 'criado_apos',
		filtroDeAtualizacao: 'atualizado_apos',
		campoDeCriacao: 'criado_em',
		campoDeAtualizacao: 'atualizado_em',
		temCursor: true,
	},
	{
		valor: 'empresa',
		nome: 'Empresa',
		descricao: 'Fichas de organizacoes',
		escopo: 'empresas:ler',
		caminho: '/empresas',
		filtroDeCriacao: 'criado_apos',
		filtroDeAtualizacao: 'atualizado_apos',
		campoDeCriacao: 'criado_em',
		campoDeAtualizacao: 'atualizado_em',
		temCursor: true,
	},
	{
		valor: 'lead',
		nome: 'Lead',
		descricao: 'Contatos ainda nao qualificados',
		escopo: 'leads:ler',
		caminho: '/leads',
		filtroDeCriacao: 'criado_apos',
		filtroDeAtualizacao: 'atualizado_apos',
		campoDeCriacao: 'criado_em',
		campoDeAtualizacao: 'atualizado_em',
		temCursor: true,
	},
	{
		valor: 'negocio',
		nome: 'Negocio',
		descricao: 'Oportunidades comerciais',
		escopo: 'negocios:ler',
		caminho: '/negocios',
		filtroDeCriacao: 'criado_apos',
		filtroDeAtualizacao: 'atualizado_apos',
		campoDeCriacao: 'criado_em',
		campoDeAtualizacao: 'atualizado_em',
		temCursor: true,
	},
	{
		valor: 'registroDeModulo',
		nome: 'Registro de Modulo',
		descricao: 'Qualquer modulo do CRM pelo slug — a saida de emergencia generica',
		escopo: 'registros:ler',
		caminho: '/modulos/{slug}/registros',
		filtroDeCriacao: 'criado_apos',
		filtroDeAtualizacao: 'atualizado_apos',
		campoDeCriacao: 'criado_em',
		campoDeAtualizacao: 'atualizado_em',
		temCursor: true,
	},
];

export function encontrarRecursoSondavel(valor: string): RecursoSondavel | undefined {
	return RECURSOS_SONDAVEIS.find((recurso) => recurso.valor === valor);
}

/** Recursos cuja sondagem por "atualizado" o servidor consegue filtrar. */
export const RECURSOS_COM_ATUALIZACAO = RECURSOS_SONDAVEIS.filter(
	(recurso) => recurso.filtroDeAtualizacao !== null,
).map((recurso) => recurso.valor);

// ── Cadeado por escopo ───────────────────────────────────────────────

function porNome(a: INodePropertyOptions, b: INodePropertyOptions): number {
	return a.name.localeCompare(b.name, 'pt-BR');
}

/** `true` quando o item pode ser usado, ou quando nao sabemos os escopos (fail-open). */
export function permitido(escopo: string | null, estado: EstadoDeEscopos): boolean {
	if (escopo === null) return true;
	if (!estado.conhecidos) return true;
	return temEscopo(estado.escopos, escopo);
}

interface ItemComEscopo {
	valor: string;
	nome: string;
	descricao: string;
	escopo: string | null;
}

/**
 * Opcoes estaticas — sem cadeado, por definicao: o painel de Actions renderiza
 * antes de existir credencial, e filtrar por escopo ali seria mentir com base
 * em nada.
 */
export function opcoesEstaticas(itens: ItemComEscopo[]): INodePropertyOptions[] {
	return itens
		.map((item) => ({ name: item.nome, value: item.valor, description: item.descricao }))
		.sort(porNome);
}

/**
 * Opcoes remotas — o item fora do alcance da chave CONTINUA na lista, com
 * `disabled: true`, cadeado no nome e o motivo na descricao. Em n8n 2.x fica
 * cinza e inselecionavel; em 1.x o `disabled` e ignorado e o cadeado e o unico
 * aviso (ver `motivoDeBloqueio`, no compartilhado). Se o valor chegar
 * preenchido por outro caminho, a ativacao falha dizendo qual escopo falta.
 */
export function opcoesComEscopo(
	itens: ItemComEscopo[],
	estado: EstadoDeEscopos,
): INodePropertyOptions[] {
	const disponiveis: INodePropertyOptions[] = [];
	const bloqueados: INodePropertyOptions[] = [];

	for (const item of itens) {
		if (permitido(item.escopo, estado)) {
			disponiveis.push({ name: item.nome, value: item.valor, description: item.descricao });
			continue;
		}
		bloqueados.push({
			name: `${MARCA_DE_CADEADO}${item.nome}`,
			value: item.valor,
			description: motivoDeBloqueio(item.escopo as string),
			disabled: true,
		});
	}

	return [...disponiveis.sort(porNome), ...bloqueados.sort(porNome)];
}

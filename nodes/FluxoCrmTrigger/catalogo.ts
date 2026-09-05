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
			'Consulta a API em intervalos. Nao precisa de endereco publico e e o UNICO caminho para atendimento (conversas e mensagens nao emitem webhook).',
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

/**
 * Espelho de `EVENTOS_DISPONIVEIS` (`api-publica/webhooks.ts`), na mesma ordem.
 *
 * Serve de fallback quando a chave nao tem `webhooks:ler` e `GET /webhooks/eventos`
 * responde 403 — sem ele o `multiOptions` ficaria vazio e o usuario nao teria
 * como assinar nada com uma chave que so tem `webhooks:escrever`.
 *
 * `webhook.teste` NAO entra: e emitido apenas por `POST /webhooks/:id/testar` e
 * o servidor recusa assinatura que o cite (`eventoValido` nao o conhece).
 */
export const EVENTOS_CONHECIDOS: readonly string[] = [
	'contato.criado',
	'contato.atualizado',
	'contato.removido',
	'empresa.criada',
	'empresa.atualizada',
	'empresa.removida',
	'lead.criado',
	'lead.atualizado',
	'lead.convertido',
	'lead.removido',
	'negocio.criado',
	'negocio.atualizado',
	'negocio.estagio_alterado',
	'negocio.ganho',
	'negocio.perdido',
	'negocio.removido',
	'atividade.criada',
	'atividade.atualizada',
	'atividade.concluida',
	'interacao.criada',
	'interacao.atualizada',
	'interacao.removida',
	'registro.criado',
	'registro.atualizado',
	'registro.removido',
	'nota.criada',
];

export const CORINGA_DE_EVENTOS = '*';

/** Rotulo legivel de um evento: `negocio.estagio_alterado` → `Negocio › Estagio Alterado`. */
export function rotuloDoEvento(evento: string): string {
	if (evento === CORINGA_DE_EVENTOS) return 'Todos os Eventos';

	const [recurso, ...resto] = evento.split('.');
	const acao = resto
		.join('.')
		.split('_')
		.map((palavra) => palavra.charAt(0).toUpperCase() + palavra.slice(1))
		.join(' ');
	const entidade = recurso.charAt(0).toUpperCase() + recurso.slice(1);
	return acao === '' ? entidade : `${entidade} › ${acao}`;
}

export function opcoesDeEvento(eventos: readonly string[]): INodePropertyOptions[] {
	const lista = [CORINGA_DE_EVENTOS, ...eventos.filter((e) => e !== CORINGA_DE_EVENTOS)];
	return lista.map((evento) => ({
		name: rotuloDoEvento(evento),
		value: evento,
		description:
			evento === CORINGA_DE_EVENTOS
				? 'Assina todos os eventos, inclusive os que o Fluxo CRM criar depois'
				: `Identificador na API: ${evento}`,
	}));
}

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
		descricao: 'Conversas novas ou com mensagem nova. Nao existe webhook para isto.',
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
			'Mensagens novas nas conversas que se moveram. Nao existe webhook para isto — este e o unico caminho.',
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

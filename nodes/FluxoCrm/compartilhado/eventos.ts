import type { INodePropertyOptions } from 'n8n-workflow';

import { classificarFalhaDeDescoberta, type MotivoDaDescoberta } from './descoberta';
import { comoErroDoNode, requisitar, type ContextoDeRequisicao } from './transporte';

/**
 * Os eventos de webhook que o servidor sabe emitir, com o rotulo de cada um.
 *
 * Fonte unica para os DOIS nodes: o `multiOptions` de eventos do gatilho e o de
 * `Webhook › Criar` / `Atualizar` do node de acoes leem daqui — a tabela e o
 * fallback. Antes, o do node de acoes chamava `GET /webhooks/eventos` sem
 * fallback nenhum, e uma chave que so tinha `webhooks:escrever` (os dois
 * escopos sao independentes: "escrever nao implica ler") abria o dropdown
 * vazio, sem ter como assinar nada.
 *
 * Espelho de `EVENTOS_DISPONIVEIS` (`apps/api/src/api-publica/webhooks.ts`,
 * linhas 23-77), na mesma ordem. `webhook.teste` NAO entra: e emitido apenas
 * por `POST /webhooks/:id/testar`, e o servidor recusa assinatura que o cite
 * (`eventoValido` nao o conhece).
 *
 * Os oito ultimos — etiqueta, atendimento e automacao — nasceram com os
 * emissores de dominio (`eventos-dominio.ts`): so existem em instancias com a
 * API que os emite. Numa anterior, `POST /webhooks` recusa a assinatura com 422
 * nomeando o evento.
 */

export const CORINGA_DE_EVENTOS = '*';

export interface EventoDoServidor {
	valor: string;
	/** Rotulo do dropdown, no padrao `Entidade › Acao` dos demais catalogos. */
	rotulo: string;
	/** Linha secundaria do dropdown; quando ausente, e o identificador na API. */
	descricao?: string;
}

const EXIGE_API_COM_EVENTOS_DE_DOMINIO =
	'Exige a API do Fluxo CRM com os emissores de dominio (etiqueta, atendimento, automacao); numa instancia anterior a assinatura e recusada.';

export const EVENTOS_DO_SERVIDOR: readonly EventoDoServidor[] = [
	{ valor: 'contato.criado', rotulo: 'Contato › Criado' },
	{ valor: 'contato.atualizado', rotulo: 'Contato › Atualizado' },
	{ valor: 'contato.removido', rotulo: 'Contato › Removido' },
	{ valor: 'empresa.criada', rotulo: 'Empresa › Criada' },
	{ valor: 'empresa.atualizada', rotulo: 'Empresa › Atualizada' },
	{ valor: 'empresa.removida', rotulo: 'Empresa › Removida' },
	{ valor: 'lead.criado', rotulo: 'Lead › Criado' },
	{ valor: 'lead.atualizado', rotulo: 'Lead › Atualizado' },
	{ valor: 'lead.convertido', rotulo: 'Lead › Convertido' },
	{ valor: 'lead.removido', rotulo: 'Lead › Removido' },
	{ valor: 'negocio.criado', rotulo: 'Negocio › Criado' },
	{ valor: 'negocio.atualizado', rotulo: 'Negocio › Atualizado' },
	{ valor: 'negocio.estagio_alterado', rotulo: 'Negocio › Estagio Alterado' },
	{ valor: 'negocio.ganho', rotulo: 'Negocio › Ganho' },
	{ valor: 'negocio.perdido', rotulo: 'Negocio › Perdido' },
	{ valor: 'negocio.removido', rotulo: 'Negocio › Removido' },
	{ valor: 'atividade.criada', rotulo: 'Atividade › Criada' },
	{ valor: 'atividade.atualizada', rotulo: 'Atividade › Atualizada' },
	{ valor: 'atividade.concluida', rotulo: 'Atividade › Concluida' },
	{ valor: 'interacao.criada', rotulo: 'Interacao › Criada' },
	{ valor: 'interacao.atualizada', rotulo: 'Interacao › Atualizada' },
	{ valor: 'interacao.removida', rotulo: 'Interacao › Removida' },
	{ valor: 'registro.criado', rotulo: 'Registro › Criado' },
	{ valor: 'registro.atualizado', rotulo: 'Registro › Atualizado' },
	{ valor: 'registro.removido', rotulo: 'Registro › Removido' },
	{ valor: 'nota.criada', rotulo: 'Nota › Criada' },
	// Etiquetas: vinculo aplicado ou removido de um registro, por qualquer
	// porta unitaria (tela ou v1). Vinculo feito por automacao nao emite.
	{
		valor: 'etiqueta.adicionada',
		rotulo: 'Etiqueta › Adicionada',
		descricao: `Uma etiqueta foi vinculada a um registro. ${EXIGE_API_COM_EVENTOS_DE_DOMINIO} Identificador na API: etiqueta.adicionada`,
	},
	{
		valor: 'etiqueta.removida',
		rotulo: 'Etiqueta › Removida',
		descricao: `Uma etiqueta foi desvinculada de um registro. ${EXIGE_API_COM_EVENTOS_DE_DOMINIO} Identificador na API: etiqueta.removida`,
	},
	// Atendimento: os quatro que "disparar quando chegar mensagem no WhatsApp"
	// pedia. `conversa.iniciada` sai dos tres funis de criacao (CRM, ingestao de
	// canal, grupos); os de mensagem saem dos pontos de persistencia, nunca para
	// nota interna nem evento de sistema.
	{
		valor: 'conversa.iniciada',
		rotulo: 'Atendimento › Conversa Iniciada',
		descricao: `Uma conversa de atendimento foi aberta, em qualquer canal (WhatsApp e demais). ${EXIGE_API_COM_EVENTOS_DE_DOMINIO} Identificador na API: conversa.iniciada`,
	},
	{
		valor: 'conversa.resolvida',
		rotulo: 'Atendimento › Conversa Resolvida',
		descricao: `Uma conversa de atendimento passou a resolvida. ${EXIGE_API_COM_EVENTOS_DE_DOMINIO} Identificador na API: conversa.resolvida`,
	},
	{
		valor: 'mensagem.recebida',
		rotulo: 'Atendimento › Mensagem Recebida',
		descricao: `O contato mandou uma mensagem numa conversa de atendimento (WhatsApp e demais canais). ${EXIGE_API_COM_EVENTOS_DE_DOMINIO} Identificador na API: mensagem.recebida`,
	},
	{
		valor: 'mensagem.enviada',
		rotulo: 'Atendimento › Mensagem Enviada',
		descricao: `A equipe mandou uma mensagem numa conversa de atendimento; nota interna nao conta. ${EXIGE_API_COM_EVENTOS_DE_DOMINIO} Identificador na API: mensagem.enviada`,
	},
	// Automacoes: emitidos ao final de cada execucao de fluxo, nunca em modo de
	// teste nem em segmento suspenso por espera.
	{
		valor: 'automacao.executada',
		rotulo: 'Automacao › Executada',
		descricao: `Uma automacao do CRM terminou com sucesso. ${EXIGE_API_COM_EVENTOS_DE_DOMINIO} Identificador na API: automacao.executada`,
	},
	{
		valor: 'automacao.falhou',
		rotulo: 'Automacao › Falhou',
		descricao: `Uma automacao do CRM terminou com erro. ${EXIGE_API_COM_EVENTOS_DE_DOMINIO} Identificador na API: automacao.falhou`,
	},
];

/** Os identificadores, na ordem do servidor — o fallback dos dois dropdowns. */
export const EVENTOS_CONHECIDOS: readonly string[] = EVENTOS_DO_SERVIDOR.map(
	(evento) => evento.valor,
);

const POR_VALOR = new Map(EVENTOS_DO_SERVIDOR.map((evento) => [evento.valor, evento]));

/**
 * Rotulo legivel de um evento.
 *
 * Os conhecidos vem da tabela. Um evento que o servidor devolva e a tabela
 * ainda nao conheca (instancia mais nova que este pacote) ganha o rotulo
 * derivado do identificador — `negocio.estagio_alterado` viraria
 * `Negocio › Estagio Alterado` — em vez de sumir ou aparecer cru.
 */
export function rotuloDoEvento(evento: string): string {
	if (evento === CORINGA_DE_EVENTOS) return 'Todos os Eventos';

	const conhecido = POR_VALOR.get(evento);
	if (conhecido !== undefined) return conhecido.rotulo;

	const [recurso, ...resto] = evento.split('.');
	const acao = resto
		.join('.')
		.split('_')
		.map((palavra) => palavra.charAt(0).toUpperCase() + palavra.slice(1))
		.join(' ');
	const entidade = recurso.charAt(0).toUpperCase() + recurso.slice(1);
	return acao === '' ? entidade : `${entidade} › ${acao}`;
}

/** As opcoes do `multiOptions`: o coringa primeiro, sem duplica-lo quando o servidor ja o manda. */
export function opcoesDeEvento(eventos: readonly string[]): INodePropertyOptions[] {
	const lista = [CORINGA_DE_EVENTOS, ...eventos.filter((e) => e !== CORINGA_DE_EVENTOS)];
	return lista.map((evento) => ({
		name: rotuloDoEvento(evento),
		value: evento,
		description:
			evento === CORINGA_DE_EVENTOS
				? 'Assina todos os eventos, inclusive os que o Fluxo CRM criar depois'
				: (POR_VALOR.get(evento)?.descricao ?? `Identificador na API: ${evento}`),
	}));
}

function texto(valor: unknown): string {
	return typeof valor === 'string' ? valor : '';
}

/** A rota `/webhooks/eventos`, como ela aparece na credencial e na documentacao. */
const ROTA_DE_EVENTOS = '/webhooks/eventos';

/**
 * As falhas em que a lista estatica E a resposta certa, e nao um disfarce.
 *
 * - `sem_permissao` (403): a chave e valida e pode REGISTRAR webhooks, so nao
 *   pode LER o catalogo — `webhooks:ler` e `webhooks:escrever` sao escopos
 *   independentes nesta API. Sem o fallback, essa chave perfeitamente util
 *   abriria um `multiOptions` vazio, sem ter como assinar nada.
 * - `endpoint_ausente` (404): instancia com API anterior a rota, ou URL base
 *   sem o prefixo `/v1`. A lista estatica cobre os eventos que ela emite.
 *
 * Qualquer outro desfecho — 401, 5xx, 429, rede fora — NAO e um caso de
 * fallback: e uma falha que o usuario precisa ver. Ate 05/09/2026 o `catch`
 * engolia todos eles em `debug` e devolvia os 34 eventos, e o painel abria
 * normal com uma credencial recusada ou o servidor fora do ar — a lista
 * estatica virava um falso "esta tudo bem".
 */
const FALHAS_QUE_CAEM_NA_ESTATICA: ReadonlySet<MotivoDaDescoberta> = new Set([
	'sem_permissao',
	'endpoint_ausente',
]);

/**
 * Os eventos assinaveis, do servidor quando possivel.
 *
 * A lista estatica cobre os eventos conhecidos; a do servidor, quando vem,
 * prevalece porque pode trazer eventos que este pacote ainda nao conhece.
 *
 * Fonte unica dos DOIS loaders (o gatilho e `Webhook › Criar/Atualizar`), entao
 * a regra de queda vale igual nos dois.
 */
export async function opcoesDeEventosAssinaveis(
	ctx: ContextoDeRequisicao,
): Promise<INodePropertyOptions[]> {
	try {
		const resposta = await requisitar(ctx, { metodo: 'GET', caminho: ROTA_DE_EVENTOS });
		// Esta rota e a unica da API cujo `dados` traz STRINGS, e nao objetos.
		const brutos = (resposta.corpo as { dados?: unknown }).dados;
		if (Array.isArray(brutos)) {
			const lista = brutos
				.map((linha) =>
					typeof linha === 'string' ? linha : texto((linha as { evento?: unknown })?.evento),
				)
				.filter((evento) => evento !== '');
			if (lista.length > 0) return opcoesDeEvento(lista);
		}
		ctx.logger.debug(
			'[Fluxo CRM] GET /webhooks/eventos respondeu sem lista; usando a lista estatica de eventos.',
		);
	} catch (erro) {
		const falha = classificarFalhaDeDescoberta(erro, ROTA_DE_EVENTOS);
		if (!FALHAS_QUE_CAEM_NA_ESTATICA.has(falha.motivo)) {
			// `comoErroDoNode` devolve intacto o `NodeApiError` que `requisitar` ja
			// montou, com a descricao acionavel do codigo que a API devolveu.
			throw comoErroDoNode(ctx, erro, `GET ${ROTA_DE_EVENTOS}`);
		}
		ctx.logger.debug(
			`[Fluxo CRM] ${falha.message} Usando a lista estatica de eventos.`,
		);
	}

	return opcoesDeEvento(EVENTOS_CONHECIDOS);
}

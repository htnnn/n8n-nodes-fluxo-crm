import type { INode, INodeProperties, INodePropertyOptions, TriggerTime } from 'n8n-workflow';
import { cronNodeOptions, NodeHelpers, toCronExpression } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { MARCA_DE_CADEADO } from '../nodes/FluxoCrm/compartilhado/catalogo';
import type { EstadoDeEscopos } from '../nodes/FluxoCrm/compartilhado/escopos';
import {
	CORINGA_DE_EVENTOS,
	EVENTOS_CONHECIDOS,
	MODOS,
	opcoesComEscopo,
	opcoesDeEvento,
	opcoesEstaticas,
	RECURSOS_COM_ATUALIZACAO,
	RECURSOS_SONDAVEIS,
	encontrarRecursoSondavel,
	rotuloDoEvento,
} from '../nodes/FluxoCrmTrigger/catalogo';
import { conferirDestino } from '../nodes/FluxoCrmTrigger/destino';
import { FluxoCrmTrigger } from '../nodes/FluxoCrmTrigger/FluxoCrmTrigger.node';

const node = new FluxoCrmTrigger();
const propriedades = node.description.properties;

function todasAsPropriedades(lista: INodeProperties[]): INodeProperties[] {
	const saida: INodeProperties[] = [];
	for (const propriedade of lista) {
		saida.push(propriedade);
		if (propriedade.type === 'collection' && Array.isArray(propriedade.options)) {
			saida.push(...todasAsPropriedades(propriedade.options as INodeProperties[]));
		}
	}
	return saida;
}

const arvore = todasAsPropriedades(propriedades);

describe('descricao do node', () => {
	it('cumpre as convencoes de trigger node exigidas pelo lint', () => {
		expect(node.description.name.endsWith('Trigger')).toBe(true);
		expect(node.description.displayName).toContain('Trigger');
		expect(node.description.inputs).toEqual([]);
		expect(node.description.group).toContain('trigger');
		// Trigger node nao pode entrar no seletor de ferramentas do agente de IA.
		expect(node.description.usableAsTool).toBeUndefined();
	});

	it('declara o ciclo de webhook completo e a sondagem', () => {
		expect(Object.keys(node.webhookMethods.default).sort()).toEqual([
			'checkExists',
			'create',
			'delete',
		]);
		// O que faz o node sondar e o METODO `poll` — `Workflow.getPollNodes()` e
		// `validateWorkflowHasTriggerLikeNode()` olham `nodeType.poll`, nunca
		// `description.polling`.
		expect(typeof node.poll).toBe('function');
		expect(node.description.webhooks?.[0]).toMatchObject({
			name: 'default',
			httpMethod: 'POST',
		});
	});

	it('todo loadOptionsMethod citado esta registrado na classe', () => {
		const registrados = Object.keys(node.methods.loadOptions);
		for (const propriedade of arvore) {
			const metodo = propriedade.typeOptions?.loadOptionsMethod;
			if (metodo === undefined) continue;
			expect(registrados, `${propriedade.name} cita ${metodo}`).toContain(metodo);
		}
	});

	it('o default de cada parametro de lista existe entre as opcoes', () => {
		const modo = propriedades.find((propriedade) => propriedade.name === 'modo');
		expect(MODOS.map((item) => item.valor)).toContain(modo?.default);

		const recurso = propriedades.find((propriedade) => propriedade.name === 'recursoSondado');
		expect(encontrarRecursoSondavel(recurso?.default as string)).toBeDefined();
	});

	it('"Disparar Quando" so aparece para recurso que o servidor sabe filtrar por atualizacao', () => {
		const gatilho = propriedades.find((propriedade) => propriedade.name === 'gatilhoDeSondagem');
		expect(gatilho?.displayOptions?.show?.recursoSondado).toEqual(RECURSOS_COM_ATUALIZACAO);
		// Atendimento e atividade ficam de fora — as rotas nao tem o filtro.
		expect(RECURSOS_COM_ATUALIZACAO).not.toContain('conversa');
		expect(RECURSOS_COM_ATUALIZACAO).not.toContain('mensagem');
		expect(RECURSOS_COM_ATUALIZACAO).not.toContain('atividade');
	});

	it('toda opcao de colecao restrita a atendimento cita um recurso que existe', () => {
		const valores = RECURSOS_SONDAVEIS.map((recurso) => recurso.valor);
		for (const propriedade of arvore) {
			const alvo = propriedade.displayOptions?.show?.['/recursoSondado'] as string[] | undefined;
			if (alvo === undefined) continue;
			for (const recurso of alvo) {
				expect(valores, `${propriedade.name} cita ${recurso}`).toContain(recurso);
			}
		}
	});
});

/**
 * O campo de intervalo da sondagem.
 *
 * A regra que estes testes seguram: o gatilho nao pode nascer agendando nada.
 * O `commonPollingParameters` que o carregador do n8n injetaria vem com
 * `default: { item: [{ mode: 'everyMinute' }] }` — este pacote declara o campo
 * por conta propria justamente para trocar esse default por vazio.
 */
describe('Poll Times', () => {
	const declarados = propriedades.filter((propriedade) => propriedade.name === 'pollTimes');
	const pollTimes = declarados[0];

	const horariosDoDefault = (propriedade: INodeProperties): TriggerTime[] =>
		((propriedade.default as { item?: TriggerTime[] }).item ?? []) as TriggerTime[];

	const noDoWorkflow = (modo: string): INode => ({
		id: 'gatilho',
		name: 'Fluxo CRM Trigger',
		type: 'n8n-nodes-fluxo-crm.fluxoCrmTrigger',
		typeVersion: 1,
		position: [0, 0],
		parameters: { modo },
	});

	it('e declarado UMA vez por este pacote, nunca injetado pelo carregador', () => {
		expect(declarados).toHaveLength(1);
		// `applySpecialNodeParameters` (n8n-core) da um `properties.unshift(...)`
		// CEGO quando `description.polling` e verdadeiro: nao confere se ja existe
		// um `pollTimes`. Ligar a flag aqui produziria dois campos "Poll Times" na
		// tela, um deles com o default de minuto em minuto.
		expect(node.description.polling).toBeUndefined();
	});

	it('nasce vazio — nenhum horario configurado', () => {
		expect(pollTimes.type).toBe('fixedCollection');
		expect(pollTimes.typeOptions?.multipleValues).toBe(true);
		expect(pollTimes.typeOptions?.multipleValueButtonText).toBe('Add Poll Time');
		expect(pollTimes.default).toEqual({});
		expect(horariosDoDefault(pollTimes)).toHaveLength(0);
	});

	it('com o default vazio o n8n nao agenda cron nenhum; um horario ja agenda', () => {
		// Reproduz `ActiveWorkflows.activatePolling`:
		//   const cronExpressions = (pollTimes.item || []).map(toCronExpression)
		expect(horariosDoDefault(pollTimes).map(toCronExpression)).toEqual([]);

		// E o modo Sondagem continua funcionando assim que a pessoa clica em
		// "Add Poll Time".
		const comUmHorario: TriggerTime[] = [{ mode: 'everyHour', minute: 0 }];
		expect(comUmHorario.map(toCronExpression)).toHaveLength(1);
	});

	it('fica resolvivel nos DOIS modos — esconde-lo mataria a ativacao', () => {
		// `activatePolling` roda para TODO node que tenha o metodo `poll`
		// (`getPollNodes()` olha `nodeType.poll`, nao o parametro `modo`) e le
		// `getNodeParameter('pollTimes')` sem valor de reserva, estourando
		// "Could not get parameter" se o parametro nao vier. E
		// `getNodeParameters` com `returnNoneDisplayed: false` — que e como o
		// n8n monta os parametros do node — DESCARTA parametro escondido. Logo,
		// um `displayOptions` aqui derrubaria a ativacao no modo Webhook.
		expect(pollTimes.displayOptions).toBeUndefined();

		for (const modo of ['webhook', 'polling']) {
			const alvo = noDoWorkflow(modo);
			const resolvidos = NodeHelpers.getNodeParameters(
				propriedades,
				alvo.parameters,
				true,
				false,
				alvo,
				node.description,
			);
			expect(resolvidos?.pollTimes, `modo ${modo}`).toEqual({});
		}
	});

	it('reaproveita a lista de modos de cron do proprio n8n, sem copia local', () => {
		expect(pollTimes.options).toBe(cronNodeOptions);
	});
});

describe('catalogo do gatilho', () => {
	it('espelha os 34 eventos do servidor e NAO oferece webhook.teste, que nao e assinavel', () => {
		// A lista completa, evento a evento, esta em `test/eventos.test.ts`.
		expect(EVENTOS_CONHECIDOS).toHaveLength(34);
		expect(EVENTOS_CONHECIDOS).toContain('interacao.criada');
		expect(EVENTOS_CONHECIDOS).toContain('negocio.estagio_alterado');
		expect(EVENTOS_CONHECIDOS).toContain('conversa.iniciada');
		expect(EVENTOS_CONHECIDOS).toContain('mensagem.recebida');
		expect(EVENTOS_CONHECIDOS).not.toContain('webhook.teste');
		// Lacunas que continuam, registradas aqui para que sumir com elas quebre o teste.
		expect(EVENTOS_CONHECIDOS).not.toContain('atividade.removida');
		expect(EVENTOS_CONHECIDOS.some((evento) => evento.startsWith('pipeline.'))).toBe(false);
		expect(EVENTOS_CONHECIDOS.some((evento) => evento.startsWith('arquivo.'))).toBe(false);
	});

	it('poe o coringa em primeiro e nao o duplica quando ele ja vem do servidor', () => {
		const opcoes = opcoesDeEvento([CORINGA_DE_EVENTOS, 'contato.criado']);
		expect(opcoes[0].value).toBe(CORINGA_DE_EVENTOS);
		expect(opcoes.filter((opcao) => opcao.value === CORINGA_DE_EVENTOS)).toHaveLength(1);
	});

	it('traduz o identificador do evento para um rotulo legivel', () => {
		expect(rotuloDoEvento('negocio.estagio_alterado')).toBe('Negocio › Estagio Alterado');
		expect(rotuloDoEvento('nota.criada')).toBe('Nota › Criada');
		expect(rotuloDoEvento(CORINGA_DE_EVENTOS)).toBe('Todos os Eventos');
	});

	it('atendimento e o unico caminho por sondagem — os dois recursos existem', () => {
		expect(encontrarRecursoSondavel('conversa')?.escopo).toBe('atendimento:ler');
		expect(encontrarRecursoSondavel('mensagem')?.escopo).toBe('atendimento:ler');
	});
});

describe('cadeado por escopo', () => {
	const comEscrita: EstadoDeEscopos = {
		conhecidos: true,
		escopos: ['webhooks:escrever'],
		origem: 'credencial',
	};
	const semEscrita: EstadoDeEscopos = {
		conhecidos: true,
		escopos: ['contatos:ler'],
		origem: 'credencial',
	};
	const desconhecido: EstadoDeEscopos = { conhecidos: false, escopos: [], origem: 'indisponivel' };

	/** As TRES marcas do bloqueio, conferidas juntas — ver `motivoDeBloqueio`. */
	function esperarBloqueada(opcao: INodePropertyOptions, escopo: string): void {
		expect(opcao.disabled).toBe(true);
		expect(opcao.name.startsWith(MARCA_DE_CADEADO)).toBe(true);
		expect(opcao.description).toContain(escopo);
	}

	function esperarLiberada(opcao: INodePropertyOptions): void {
		expect(opcao.disabled).toBeUndefined();
		expect(opcao.name).not.toContain(MARCA_DE_CADEADO);
		expect(opcao.description ?? '').not.toMatch(/Requer o escopo/);
	}

	it('o modo Webhook sem webhooks:escrever sai com disabled E cadeado E motivo', () => {
		const opcoes = opcoesComEscopo(MODOS, semEscrita);

		esperarBloqueada(opcoes.find((opcao) => opcao.value === 'webhook')!, 'webhooks:escrever');
		// Sondagem nao exige escopo nenhum e continua limpa das tres.
		const polling = opcoes.find((opcao) => opcao.value === 'polling')!;
		esperarLiberada(polling);
		expect(polling.name).toBe('Sondagem Periodica');
	});

	it('o recurso sondavel sem atendimento:ler tambem sai com as tres', () => {
		const opcoes = opcoesComEscopo(RECURSOS_SONDAVEIS, semEscrita);
		esperarBloqueada(opcoes.find((opcao) => opcao.value === 'conversa')!, 'atendimento:ler');
	});

	it('nao marca nada quando a chave tem o escopo', () => {
		for (const opcao of opcoesComEscopo(MODOS, comEscrita)) esperarLiberada(opcao);
	});

	it('nao marca nada quando os escopos sao desconhecidos — fail-open', () => {
		for (const opcao of opcoesComEscopo(RECURSOS_SONDAVEIS, desconhecido)) esperarLiberada(opcao);
	});

	it('as opcoes ESTATICAS do gatilho nunca levam disabled', () => {
		for (const opcao of [...opcoesEstaticas(MODOS), ...opcoesEstaticas(RECURSOS_SONDAVEIS)]) {
			expect(opcao.disabled).toBeUndefined();
		}
	});

	it('as tres marcas sobrevivem a serializacao JSON do loadOptions', () => {
		const viajadas = JSON.parse(
			JSON.stringify(opcoesComEscopo(MODOS, semEscrita)),
		) as INodePropertyOptions[];

		esperarBloqueada(viajadas.find((opcao) => opcao.value === 'webhook')!, 'webhooks:escrever');
	});

	it('poe os itens ao alcance da chave antes dos bloqueados', () => {
		const opcoes = opcoesComEscopo(RECURSOS_SONDAVEIS, {
			conhecidos: true,
			escopos: ['atendimento:ler'],
			origem: 'credencial',
		});
		const primeiroBloqueado = opcoes.findIndex((opcao) => opcao.name.startsWith(MARCA_DE_CADEADO));
		const ultimoLivre = opcoes.reduce(
			(indice, opcao, i) => (opcao.name.startsWith(MARCA_DE_CADEADO) ? indice : i),
			-1,
		);
		expect(ultimoLivre).toBeLessThan(primeiroBloqueado);
	});
});

describe('conferirDestino — espelho do anti-SSRF do servidor', () => {
	it('aceita HTTPS publico', () => {
		expect(conferirDestino('https://n8n.exemplo.com.br/webhook/abc')).toEqual({ aceitavel: true });
	});

	it('recusa http, localhost, .local, .internal e credenciais na URL', () => {
		const casos: Array<[string, string]> = [
			['http://n8n.exemplo.com.br/webhook', 'sem_https'],
			['https://localhost:5678/webhook', 'host_interno'],
			['https://n8n.local/webhook', 'host_interno'],
			['https://api.internal/webhook', 'host_interno'],
			['https://metadata.google.internal/webhook', 'host_interno'],
			['https://usuario:senha@exemplo.com/webhook', 'credenciais_embutidas'],
			['nao e uma url', 'malformada'],
			['', 'malformada'],
		];

		for (const [url, problema] of casos) {
			const veredicto = conferirDestino(url);
			expect(veredicto.aceitavel, url).toBe(false);
			if (!veredicto.aceitavel) expect(veredicto.problema, url).toBe(problema);
		}
	});

	it('recusa as faixas privadas de IPv4 e IPv6, inclusive o IPv4 mapeado', () => {
		const privados = [
			'https://127.0.0.1/webhook',
			'https://10.0.0.5/webhook',
			'https://192.168.1.10/webhook',
			'https://172.16.0.1/webhook',
			'https://169.254.169.254/webhook', // metadata de AWS/GCP
			'https://100.64.0.1/webhook', // CGNAT
			'https://[::1]/webhook',
			'https://[fd00::1]/webhook',
			'https://[fe80::1]/webhook',
			// `new URL()` normaliza para `[::ffff:7f00:1]`, que e o desvio classico.
			'https://[::ffff:127.0.0.1]/webhook',
		];

		for (const url of privados) {
			expect(conferirDestino(url).aceitavel, url).toBe(false);
		}
	});

	it('aceita IP publico literal', () => {
		expect(conferirDestino('https://8.8.8.8/webhook').aceitavel).toBe(true);
	});
});

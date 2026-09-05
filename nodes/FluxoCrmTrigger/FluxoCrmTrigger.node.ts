import type {
	IDataObject,
	IHookFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IPollFunctions,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { testarCredencial } from '../FluxoCrm/metodos/credentialTest';
import {
	CABECALHO_DE_ASSINATURA,
	CABECALHO_DE_ENTREGA,
	CABECALHO_DE_EVENTO,
	MOTIVOS_LEGIVEIS,
	verificarAssinatura,
} from './assinatura';
import { descricaoDoGatilho } from './descricao';
import { lerRegistroDoWebhook } from './estado';
import {
	carregarCanaisDeAtendimento,
	carregarEventos,
	carregarModos,
	carregarRecursosSondaveis,
} from './metodos';
import { conferirWebhook, criarWebhook, removerWebhook } from './registro';
import { sondar } from './sondagem';
import { texto } from './transporte';

/** Evento que so o endpoint `POST /webhooks/:id/testar` emite. Nao e assinavel. */
const EVENTO_DE_TESTE = 'webhook.teste';

/**
 * Gatilho do Fluxo CRM: webhook com registro automatico, e sondagem como o
 * caminho para tudo que webhook nao cobre.
 *
 * Os dois modos convivem na mesma classe de proposito. O n8n, ao ativar um
 * workflow, registra os webhooks declarados E inicia o poller quando as duas
 * coisas existem — entao cada lado sai de cena olhando o parametro `modo`:
 * `checkExists` devolve `true` em sondagem (nada a registrar, nada a criar) e
 * `poll` devolve `null` em webhook.
 *
 * O que este node NAO consegue fazer, e por que:
 *
 * - **Atendimento nao tem webhook.** Nenhum evento de conversa, mensagem ou
 *   atribuicao existe em `EVENTOS_DISPONIVEIS`. "Disparar quando chegar
 *   mensagem no WhatsApp" so funciona por sondagem.
 * - **Os eventos so nascem de escrita PELA API.** `emitirEvento` e chamado
 *   exclusivamente das rotas de `api-publica/`; o que a equipe faz na tela do
 *   CRM nao emite nada.
 * - Nao existe `atividade.removida`, nem evento de pipeline/estagio, arquivo ou
 *   do proprio webhook.
 */
export class FluxoCrmTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Fluxo CRM Trigger',
		name: 'fluxoCrmTrigger',
		icon: { light: 'file:fluxoCrmTrigger.svg', dark: 'file:fluxoCrmTrigger.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle:
			'={{$parameter["modo"] === "webhook" ? "webhook" : "sondagem: " + $parameter["recursoSondado"]}}',
		description: 'Dispara quando algo acontece no Fluxo CRM',
		defaults: { name: 'Fluxo CRM Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'fluxoCrmApi', required: true, testedBy: 'testarCredencial' }],
		// `pollTimes` NAO e declarado aqui: o carregador do n8n injeta o campo
		// sozinho quando `polling` e `true`, e declara-lo produziria dois campos
		// de intervalo na tela.
		polling: true,
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: descricaoDoGatilho,
	};

	methods = {
		loadOptions: {
			carregarCanaisDeAtendimento,
			carregarEventos,
			carregarModos,
			carregarRecursosSondaveis,
		},
		credentialTest: { testarCredencial },
	};

	/**
	 * Ciclo de vida da assinatura no servidor.
	 *
	 * Os tres metodos aparecem literalmente aqui porque a regra de lint
	 * `webhook-lifecycle-complete` exige os tres dentro deste objeto — o corpo
	 * fica em `registro.ts`, onde ha espaco para explicar cada desfecho.
	 */
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				return await conferirWebhook(this);
			},
			async create(this: IHookFunctions): Promise<boolean> {
				return await criarWebhook(this);
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				return await removerWebhook(this);
			},
		},
	};

	/**
	 * A entrega chegou. Verificar a assinatura ANTES de qualquer outra coisa.
	 *
	 * Duas armadilhas moram nesta funcao, e as duas estao fechadas em
	 * `assinatura.ts`:
	 *
	 * 1. O material assinado e o corpo BRUTO (`req.rawBody`). Reserializar com
	 *    `JSON.stringify(this.getBodyData())` reescreve espacos, escapes e a
	 *    notacao dos numeros — um unico byte diferente e o HMAC nunca bate.
	 * 2. A comparacao e `timingSafeEqual`, que LEVANTA quando os buffers tem
	 *    tamanhos diferentes. Um `v1` curto e a primeira coisa que se tenta.
	 */
	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const estado = this.getWorkflowStaticData('node');
		const { segredo } = lerRegistroDoWebhook(estado);
		const cabecalhos = this.getHeaderData();
		const requisicao = this.getRequestObject();

		const veredicto = verificarAssinatura({
			segredo,
			corpoBruto: requisicao.rawBody,
			cabecalho: cabecalhos[CABECALHO_DE_ASSINATURA],
		});

		if (!veredicto.valida) {
			const explicacao = MOTIVOS_LEGIVEIS[veredicto.motivo];
			this.logger.warn(
				`[Fluxo CRM] Entrega de webhook recusada (${veredicto.motivo}): ${explicacao}`,
			);
			// 401 e a resposta, e o workflow NAO dispara. Uma entrega nao verificada
			// e indistinguivel de uma forjada, e a API trata 4xx como falha — o que
			// faz a entrega legitima ser reenviada quando o problema for corrigido.
			const resposta = this.getResponseObject();
			resposta.status(401).json({ erro: 'assinatura_invalida', mensagem: explicacao });
			return { noWebhookResponse: true };
		}

		const corpo = this.getBodyData();
		const opcoes = (this.getNodeParameter('opcoesDoWebhook', {}) ?? {}) as IDataObject;
		const evento = texto(cabecalhos[CABECALHO_DE_EVENTO]) || texto(corpo.evento);

		if (evento === EVENTO_DE_TESTE && opcoes.ignorarEntregaDeTeste === true) {
			// 200 para que a entrega conte como bem-sucedida no historico do CRM —
			// so o disparo do workflow e que fica de fora.
			const resposta = this.getResponseObject();
			resposta.status(200).json({ ok: true, ignorado: EVENTO_DE_TESTE });
			return { noWebhookResponse: true };
		}

		const saida: IDataObject = { ...corpo };
		if (opcoes.incluirMetadados === true) {
			saida.__entrega = {
				id: texto(cabecalhos[CABECALHO_DE_ENTREGA]),
				evento,
				assinatura: texto(cabecalhos[CABECALHO_DE_ASSINATURA]),
				recebidoEm: new Date().toISOString(),
			};
		}

		const itens: INodeExecutionData[] = [{ json: saida }];
		return { workflowData: [itens] };
	}

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		return await sondar(this);
	}
}

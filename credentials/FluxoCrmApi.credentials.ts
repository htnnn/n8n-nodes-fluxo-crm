import type {
	IAuthenticateGeneric,
	ICredentialDataDecryptedObject,
	ICredentialType,
	IDataObject,
	IHttpRequestHelper,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

import {
	extrairEscoposDeCapacidades,
	extrairEscoposDeMe,
	impressaoDaCredencial,
	montarCarimbo,
	ESTADO_DESCONHECIDO,
} from '../nodes/FluxoCrm/compartilhado/escopos';

export class FluxoCrmApi implements ICredentialType {
	name = 'fluxoCrmApi';

	displayName = 'Fluxo CRM API';

	icon: Icon = { light: 'file:fluxoCrm.svg', dark: 'file:fluxoCrm.dark.svg' };

	documentationUrl = 'https://github.com/fluxo/n8n-nodes-fluxo-crm#credenciais';

	properties: INodeProperties[] = [
		{
			displayName: 'URL Base',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api-crm.nafluxo.com.br/v1',
			required: true,
			description:
				'Endereco da API publica, incluindo o prefixo de versao. Ex.: https://api-crm.nafluxo.com.br/v1',
		},
		{
			displayName: 'Chave de API',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'Chave gerada em Configuracoes › Integracoes no Fluxo CRM. Comeca com flx_live_.',
		},
		{
			// Preenchido pelo `preAuthentication` e lido pelos dropdowns sem custo de
			// rede. `expirable` faz o n8n reexecutar o `preAuthentication` quando o
			// valor volta a ser exatamente a string vazia, ou num retry de 401.
			displayName: 'Escopos da Chave',
			name: 'escoposDaChave',
			type: 'hidden',
			typeOptions: { expirable: true },
			default: '',
		},
	];

	/**
	 * Descobre os escopos da chave uma vez e os persiste na credencial.
	 *
	 * Tres coisas medidas no spike moldaram este metodo:
	 *
	 * 1. `getCredentials()` sozinho NAO dispara o `preAuthentication` — so
	 *    `httpRequestWithAuthentication` dispara. Por isso o valor persistido
	 *    aqui e um bonus, e nunca a unica fonte: `escopos.ts` sabe rebuscar.
	 * 2. Ele so reexecuta quando o campo esta exatamente vazio, ou num retry de
	 *    401. Por isso um erro de rede aqui grava um carimbo de "desconhecido"
	 *    em vez de string vazia — assim a interface nao fica pedindo a mesma
	 *    requisicao a cada dropdown aberto.
	 * 3. **Trocar a chave de API NAO invalida o valor guardado.** Sem defesa, o
	 *    node filtraria a interface contra os escopos da chave anterior — os
	 *    escopos antigos sobreviveram inclusive ao teste de credencial. Por isso
	 *    o valor carrega a impressao digital da credencial, e quem le descarta o
	 *    carimbo quando a impressao nao bate.
	 */
	async preAuthentication(
		this: IHttpRequestHelper,
		credentials: ICredentialDataDecryptedObject,
	): Promise<IDataObject> {
		const base = String(credentials.baseUrl ?? '')
			.trim()
			.replace(/\/+$/, '');
		const impressao = impressaoDaCredencial(credentials.baseUrl, credentials.apiKey);

		const buscar = async (caminho: string): Promise<unknown> =>
			await this.helpers.httpRequest({
				method: 'GET',
				url: `${base}${caminho}`,
				headers: {
					Accept: 'application/json',
					Authorization: `Bearer ${String(credentials.apiKey ?? '')}`,
				},
				json: true,
			});

		try {
			const escopos = extrairEscoposDeCapacidades(await buscar('/capabilities'));
			if (escopos !== null) {
				return {
					escoposDaChave: montarCarimbo(impressao, {
						conhecidos: true,
						escopos,
						origem: 'capabilities',
					}),
				};
			}
		} catch {
			// 404 numa instancia com API anterior ao /capabilities e o caso comum.
		}

		try {
			const escopos = extrairEscoposDeMe(await buscar('/me'));
			if (escopos !== null) {
				return {
					escoposDaChave: montarCarimbo(impressao, {
						conhecidos: true,
						escopos,
						origem: 'me',
					}),
				};
			}
		} catch {
			// Chave legitima sem `meta:ler` recebe 403 aqui. Falhar a autenticacao
			// por causa disso travaria uma chave que funciona para tudo o mais.
		}

		return { escoposDaChave: montarCarimbo(impressao, ESTADO_DESCONHECIDO) };
	}

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '={{"Bearer " + $credentials.apiKey}}',
			},
		},
	};
}

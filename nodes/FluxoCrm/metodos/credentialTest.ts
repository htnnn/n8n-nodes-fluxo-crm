import type {
	ICredentialDataDecryptedObject,
	ICredentialTestFunctions,
	ICredentialsDecrypted,
	INodeCredentialTestResult,
} from 'n8n-workflow';

import { normalizarEscopos } from '../compartilhado/escopos';

function texto(valor: unknown): string {
	return typeof valor === 'string' ? valor : '';
}

function comoObjeto(valor: unknown): Record<string, unknown> {
	return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
		? (valor as Record<string, unknown>)
		: {};
}

/**
 * Teste de credencial customizado.
 *
 * O declarativo (`ICredentialTestRequest`) apenas dispara a rota e reporta
 * "conectado". Aqui o teste le os escopos e devolve uma mensagem util: qual
 * organizacao respondeu e o que a chave pode fazer — que e exatamente a duvida
 * de quem acabou de colar uma chave.
 *
 * `GET /me` e a rota certa; `GET /ping` NAO serve, porque e registrada antes do
 * middleware de autenticacao e responde 200 para qualquer chave, inclusive
 * revogada.
 *
 * Uma chave legitima sem `meta:ler` recebe 403 aqui. Enquanto `GET /me` exigir
 * escopo, esse 403 e reportado como AVISO e nao como falha — reprovar a chave
 * seria um falso negativo: ela funciona para tudo que tem escopo.
 */
export async function testarCredencial(
	this: ICredentialTestFunctions,
	credencial: ICredentialsDecrypted,
): Promise<INodeCredentialTestResult> {
	const dados = (credencial.data ?? {}) as ICredentialDataDecryptedObject;
	const base = texto(dados.baseUrl).trim().replace(/\/+$/, '');
	const chave = texto(dados.apiKey).trim();

	if (base === '') {
		return { status: 'Error', message: 'Informe a URL base da API do Fluxo CRM.' };
	}
	if (chave === '') {
		return { status: 'Error', message: 'Informe a chave de API.' };
	}

	try {
		// eslint-disable-next-line @n8n/community-nodes/no-deprecated-workflow-functions -- `ICredentialTestFunctions.helpers` expoe SOMENTE `request`; `httpRequest` nao existe neste contexto, entao nao ha alternativa
		const resposta = await this.helpers.request({
			method: 'GET',
			uri: `${base}/me`,
			headers: { Accept: 'application/json', Authorization: `Bearer ${chave}` },
			json: true,
		});

		const corpo = comoObjeto(resposta);
		const organizacao = comoObjeto(corpo.organizacao);
		const dadosDaChave = comoObjeto(corpo.chave);
		const escopos = normalizarEscopos(dadosDaChave.escopos);
		const nomeDaOrg = texto(organizacao.nome) || 'organizacao sem nome';

		if (escopos.length === 0) {
			return {
				status: 'Error',
				message: `Conectado a ${nomeDaOrg}, mas a chave nao tem escopo nenhum: quase nenhuma operacao deste node estara disponivel. Gere uma chave nova em Configuracoes › Integracoes.`,
			};
		}

		if (escopos.includes('*')) {
			return {
				status: 'OK',
				message: `Conectado a ${nomeDaOrg}. A chave tem o escopo coringa (*): todas as operacoes estao liberadas.`,
			};
		}

		return {
			status: 'OK',
			message: `Conectado a ${nomeDaOrg}. ${escopos.length} escopo(s): ${escopos.join(', ')}.`,
		};
	} catch (erro) {
		return { status: 'Error', message: mensagemDeFalha(erro) };
	}
}

function mensagemDeFalha(erro: unknown): string {
	const raiz = comoObjeto(erro);
	const resposta = comoObjeto(raiz.response);
	const corpo = comoObjeto(comoObjeto(resposta.body).erro ?? comoObjeto(raiz.error).erro);
	const codigo = texto(corpo.codigo);
	const status = typeof raiz.statusCode === 'number' ? raiz.statusCode : undefined;

	switch (codigo) {
		case 'escopo_insuficiente':
			// Enquanto `GET /me` exigir `meta:ler`, uma chave valida sem esse
			// escopo cai aqui. A chave funciona; o que nao da para fazer e
			// descobrir os escopos dela — e o node opera em modo fail-open.
			return 'A chave foi aceita, mas nao tem o escopo meta:ler, entao o node nao consegue descobrir o que ela pode fazer. Nenhuma operacao sera bloqueada na interface e o servidor decidira em cada chamada. Adicione meta:ler para ter a lista filtrada.';
		case 'chave_invalida':
		case 'nao_autenticado':
			return 'Chave de API recusada. Confira se ela foi copiada inteira e se ainda esta ativa.';
		case 'chave_revogada':
			return 'Esta chave de API foi revogada. Gere uma nova em Configuracoes › Integracoes.';
		case 'chave_expirada':
			return 'Esta chave de API expirou. Gere uma nova em Configuracoes › Integracoes.';
		case 'assinatura_inativa':
			return 'A assinatura da organizacao esta inativa. Regularize o plano antes de usar a API.';
		case 'ip_nao_permitido':
			return 'O IP desta instancia do n8n nao esta na lista permitida desta chave.';
		case 'organizacao_desativada':
			return 'A organizacao esta desativada.';
		default:
			break;
	}

	if (status === 404) {
		return 'A URL base nao respondeu em /me. Confira se ela termina no prefixo de versao, por exemplo https://api-crm.nafluxo.com.br/v1';
	}

	return `Nao foi possivel falar com a API do Fluxo CRM${
		status === undefined ? '' : ` (HTTP ${status})`
	}. Confira a URL base e a conectividade desta instancia.`;
}

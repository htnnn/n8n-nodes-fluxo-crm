import type { IDataObject, ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { buscarNegocios, rotuloDoNegocio } from '../nodes/FluxoCrm/metodos/listSearch';

const BASE = 'https://crm.exemplo.com.br';

function contexto(respostas: Record<string, { status: number; corpo: IDataObject }>): ILoadOptionsFunctions {
	return {
		getNode: () => ({ name: 'Fluxo CRM', type: 'fluxoCrm', typeVersion: 1 }),
		getCredentials: async () => ({ baseUrl: BASE, apiKey: `flx_test_${Math.random().toString(36).slice(2)}` }),
		logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
		helpers: {
			httpRequestWithAuthentication: async (_credencial: string, requisicao: IDataObject) => {
				const caminho = new URL(String(requisicao.url)).pathname.replace(/^\/api\/v1/, '');
				const resposta = respostas[caminho] ?? { status: 404, corpo: { erro: { codigo: 'nao_encontrado' } } };
				// Como o helper do n8n: status de erro levanta, com o corpo em `response.data`.
				if (resposta.status >= 400) {
					throw Object.assign(new Error(`HTTP ${resposta.status}`), {
						response: { status: resposta.status, data: resposta.corpo },
					});
				}
				return { body: resposta.corpo, statusCode: resposta.status, headers: {} };
			},
		},
	} as unknown as ILoadOptionsFunctions;
}

/**
 * FLU-1590 — a busca de negocios rotulava por `titulo`/`nome` e caia no uuid
 * quando o campo principal do modulo tinha outro slug.
 *
 * Como pode falhar:
 *   - ignora o campo principal configurado e mostra o uuid
 *   - campo principal vazio nao cai nos fallbacks
 *   - valor nao textual vira "[object Object]"
 */
describe('rotulo do negocio na busca', () => {
	it('usa o campo principal do modulo', () => {
		expect(rotuloDoNegocio({ id: 'n1', valores: { assunto: 'Implante' } }, 'assunto')).toBe('Implante');
	});

	it('sem campo principal preenchido, cai em titulo, nome e por fim no id', () => {
		expect(rotuloDoNegocio({ id: 'n1', valores: { assunto: '', titulo: 'T' } }, 'assunto')).toBe('T');
		expect(rotuloDoNegocio({ id: 'n1', valores: { nome: 'N' } }, null)).toBe('N');
		expect(rotuloDoNegocio({ id: 'n1', valores: { assunto: { x: 1 } } }, 'assunto')).toBe('n1');
	});
});

describe('busca de negocios', () => {
	const negocios = { status: 200, corpo: { dados: [{ id: 'n1', valores: { assunto: 'Implante', titulo: 'velho' } }] } };

	it('rotula pelo campo principal lido do dicionario do modulo', async () => {
		const ctx = contexto({
			'/negocios': negocios,
			'/modulos/negocios/campos': { status: 200, corpo: { dados: [{ slug: 'assunto', is_primario: true }] } },
		});
		expect((await buscarNegocios.call(ctx)).results).toEqual([{ name: 'Implante', value: 'n1' }]);
	});

	it('sem acesso ao dicionario, a busca segue com titulo', async () => {
		const ctx = contexto({
			'/negocios': negocios,
			'/modulos/negocios/campos': { status: 403, corpo: { erro: { codigo: 'escopo_insuficiente' } } },
		});
		expect((await buscarNegocios.call(ctx)).results).toEqual([{ name: 'velho', value: 'n1' }]);
	});
});

import type { IDataObject, ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { mapearCamposDoModulo } from '../nodes/FluxoCrm/metodos/resourceMapping';

/**
 * FLU-1590 — campo de usuario vira lista no mapper, e a lista vai gravada no
 * `schema` do workflow, onde o editor do n8n confere o valor salvo.
 *
 * Como pode falhar:
 *   - e-mail de toda a equipe gravado no workflow exportado
 *   - homonimos indistinguiveis
 *   - valor ja salvo fora da lista (membro desativado) vira erro no editor
 *   - linha vazia (`''`) vira erro no editor
 *   - expressao salva vira opcao fantasma
 *   - falha ao ler `/usuarios` derruba o mapper inteiro ou some sem rastro
 */

const BASE = 'https://crm.exemplo.com.br';
const DICIONARIO = [
	{ slug: 'titulo', nome: 'Titulo', tipo: 'texto', sistema: false, somente_leitura: false },
	{ slug: 'dono_id', nome: 'Responsavel', tipo: 'usuario', sistema: true, somente_leitura: false },
];
const USUARIOS = [
	{ id: 'u-ana1', nome: 'Ana', email: 'ana@a.com' },
	{ id: 'u-ana2', nome: 'Ana', email: 'ana@b.com' },
	{ id: 'u-bruno', nome: 'Bruno', email: 'bruno@a.com' },
];

function contexto(salvo: IDataObject, usuarios: { status: number; corpo: IDataObject }) {
	const avisos: string[] = [];
	const respostas: Record<string, { status: number; corpo: IDataObject }> = {
		'/modulos/imoveis/campos': { status: 200, corpo: { dados: DICIONARIO } },
		'/usuarios': usuarios,
	};
	const ctx = {
		getCurrentNodeParameter: (nome: string) =>
			({ moduloSlug: 'imoveis', operation: 'criar', valores: salvo })[nome],
		getNode: () => ({ name: 'Fluxo CRM', type: 'fluxoCrm', typeVersion: 1 }),
		getCredentials: async () => ({ baseUrl: BASE, apiKey: `flx_test_${Math.random().toString(36).slice(2)}` }),
		logger: { debug: () => undefined, info: () => undefined, warn: (m: string) => avisos.push(m), error: () => undefined },
		helpers: {
			httpRequestWithAuthentication: async (_credencial: string, requisicao: IDataObject) => {
				const caminho = new URL(String(requisicao.url)).pathname.replace(/^\/api\/v1/, '');
				const resposta = respostas[caminho] ?? { status: 404, corpo: { erro: { codigo: 'nao_encontrado' } } };
				if (resposta.status >= 400) {
					throw Object.assign(new Error(`HTTP ${resposta.status}`), {
						response: { status: resposta.status, data: resposta.corpo },
					});
				}
				return { body: resposta.corpo, statusCode: resposta.status, headers: {} };
			},
		},
	} as unknown as ILoadOptionsFunctions;
	return { ctx, avisos };
}

async function dono(salvo: IDataObject, usuarios = { status: 200, corpo: { dados: USUARIOS } as IDataObject }) {
	const { ctx, avisos } = contexto(salvo, usuarios);
	const { fields } = await mapearCamposDoModulo.call(ctx);
	return { campo: fields.find((f) => f.id === 'dono_id'), avisos };
}

describe('campo de usuario no mapper', () => {
	it('rotulo so com o nome; e-mail apenas para desempatar homonimos', async () => {
		const { campo } = await dono({ value: null });
		expect(campo?.type).toBe('options');
		expect(campo?.options).toEqual([
			{ name: '— Não Enviar —', value: '' },
			{ name: 'Ana (ana@a.com)', value: 'u-ana1' },
			{ name: 'Ana (ana@b.com)', value: 'u-ana2' },
			{ name: 'Bruno', value: 'u-bruno' },
		]);
	});

	it('valor salvo fora da lista vira opcao; expressao nao', async () => {
		const inativo = await dono({ value: { dono_id: 'u-desligado' } });
		expect(inativo.campo?.options).toContainEqual({ name: 'u-desligado (fora da lista de ativos)', value: 'u-desligado' });

		const expressao = await dono({ value: { dono_id: '={{ $json.dono }}' } });
		expect(expressao.campo?.options).toHaveLength(4);
	});

	it('sem a lista de usuarios, o campo segue texto e o motivo vai ao log', async () => {
		const { campo, avisos } = await dono({ value: null }, { status: 500, corpo: { erro: { codigo: 'interno' } } });
		expect(campo?.type).toBe('string');
		expect(avisos.join('\n')).toContain('lista de usuarios indisponivel');
	});
});

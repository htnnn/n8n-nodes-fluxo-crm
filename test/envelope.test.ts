import type { IDataObject, IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { executarAtividade } from '../nodes/FluxoCrm/acoes/atividade';
import { executarContato } from '../nodes/FluxoCrm/acoes/contato';
import { executarEmpresa } from '../nodes/FluxoCrm/acoes/empresa';
import { executarNegocio } from '../nodes/FluxoCrm/acoes/negocio';
import { executarRegistro } from '../nodes/FluxoCrm/acoes/registro';
import { carregarCamposDoModulo } from '../nodes/FluxoCrm/metodos/loadOptions';
import {
	mapearCamposDeAtividade,
	mapearCamposDeContato,
	mapearCamposDeNegocio,
	mapearCamposDoModulo,
} from '../nodes/FluxoCrm/metodos/resourceMapping';

/**
 * O ENVELOPE dos campos de sistema na escrita.
 *
 * O dicionario anuncia responsavel, equipe e os campos de auditoria junto do
 * layout, mas o servidor le `dono_id`, `responsavel_id` e `equipe_id` no TOPO
 * do corpo — e todo schema de escrita e `.strict()`. O que estes testes travam:
 * o campo de sistema sai de `valores`/`dados` e vai para o topo; o que a rota
 * nao aceita e recusado antes da requisicao, nomeado; e o somente leitura
 * nunca sai do node.
 */

const BASE = 'https://api-crm.nafluxo.com.br/v1';
const DONO = '1b671a64-40d5-491e-99b0-da01ff1f3341';
const EQUIPE = '2c782b75-51e6-4a2f-aac1-eb12aa2a4452';
const REGISTRO = '3d893c86-62f7-4b30-bbd2-fc23bb3b5563';

interface Chamada {
	metodo: string;
	caminho: string;
	corpo: IDataObject | undefined;
}

function mapeado(value: IDataObject): IDataObject {
	return { mappingMode: 'defineBelow', value, matchingColumns: [], schema: [] };
}

function criarContextoDeExecucao(
	parametros: Record<string, unknown>,
	responder: (chamada: Chamada) => IDataObject = () => ({ id: REGISTRO }),
): { ctx: IExecuteFunctions; chamadas: Chamada[] } {
	const chamadas: Chamada[] = [];
	const ctx = {
		getNodeParameter: (nome: string, _i: number, padrao?: unknown) =>
			nome in parametros ? parametros[nome] : padrao,
		getNode: () => ({ name: 'Fluxo CRM', type: 'fluxoCrm', typeVersion: 1 }),
		getCredentials: async () => ({
			baseUrl: BASE,
			apiKey: `flx_test_${Math.random().toString(36).slice(2)}`,
		}),
		logger: {
			debug: () => undefined,
			info: () => undefined,
			warn: () => undefined,
			error: () => undefined,
		},
		helpers: {
			httpRequestWithAuthentication: async (_credencial: string, requisicao: IDataObject) => {
				const url = String(requisicao.url);
				const chamada: Chamada = {
					metodo: String(requisicao.method),
					caminho: url.startsWith(BASE) ? url.slice(BASE.length) : url,
					corpo: requisicao.body as IDataObject | undefined,
				};
				chamadas.push(chamada);
				return { body: responder(chamada), statusCode: 201, headers: {} };
			},
		},
	} as unknown as IExecuteFunctions;

	return { ctx, chamadas };
}

describe('registro: dono e equipe do mapeador vao para o topo do corpo', () => {
	it('criar: o layout fica em `valores`, os de sistema no primeiro nivel', async () => {
		const { ctx, chamadas } = criarContextoDeExecucao({
			moduloSlug: 'imoveis',
			valores: mapeado({ titulo: 'Casa', dono_id: DONO, equipe_id: EQUIPE }),
			additionalFields: {},
			options: {},
		});

		await executarRegistro(ctx, 'criar', 0);

		expect(chamadas).toHaveLength(1);
		expect(chamadas[0]).toMatchObject({ metodo: 'POST', caminho: '/modulos/imoveis/registros' });
		expect(chamadas[0].corpo).toEqual({
			valores: { titulo: 'Casa' },
			dono_id: DONO,
			equipe_id: EQUIPE,
		});
	});

	it('criar: so campos de sistema no mapeador ainda manda `valores` vazio, que a rota exige', async () => {
		const { ctx, chamadas } = criarContextoDeExecucao({
			moduloSlug: 'imoveis',
			valores: mapeado({ dono_id: DONO }),
			additionalFields: {},
			options: {},
		});

		await executarRegistro(ctx, 'criar', 0);
		expect(chamadas[0].corpo).toEqual({ valores: {}, dono_id: DONO });
	});

	it('criar: o mesmo dono em "Campos Adicionais" e no mapeador passa; valores diferentes param', async () => {
		const iguais = criarContextoDeExecucao({
			moduloSlug: 'imoveis',
			valores: mapeado({ dono_id: DONO.toUpperCase() }),
			additionalFields: { dono_id: DONO },
			options: {},
		});
		await executarRegistro(iguais.ctx, 'criar', 0);
		expect(iguais.chamadas[0].corpo?.dono_id).toBe(DONO);

		const diferentes = criarContextoDeExecucao({
			moduloSlug: 'imoveis',
			valores: mapeado({ dono_id: DONO }),
			additionalFields: { dono_id: EQUIPE },
			options: {},
		});
		await expect(executarRegistro(diferentes.ctx, 'criar', 0)).rejects.toThrow(
			/"dono_id" foi informado duas vezes/,
		);
		expect(diferentes.chamadas).toHaveLength(0);
	});

	it('atualizar: a equipe sobe ao topo e `valores` vai vazio, porque o PATCH exige a chave', async () => {
		const { ctx, chamadas } = criarContextoDeExecucao({
			moduloSlug: 'imoveis',
			registroId: REGISTRO,
			valores: mapeado({ equipe_id: EQUIPE }),
			equipe_id: '',
		});

		await executarRegistro(ctx, 'atualizar', 0);
		expect(chamadas[0]).toMatchObject({ metodo: 'PATCH' });
		expect(chamadas[0].corpo).toEqual({ valores: {}, equipe_id: EQUIPE });
	});

	it('atualizar: o dono e RECUSADO antes da requisicao — este PATCH nao o aceita', async () => {
		const { ctx, chamadas } = criarContextoDeExecucao({
			moduloSlug: 'imoveis',
			registroId: REGISTRO,
			valores: mapeado({ titulo: 'Casa', dono_id: DONO }),
			equipe_id: '',
		});

		await expect(executarRegistro(ctx, 'atualizar', 0)).rejects.toThrow(
			/nao aceita o campo de sistema "dono_id"/,
		);
		expect(chamadas).toHaveLength(0);
	});

	it('somente leitura no mapeador e recusado, nomeando o campo', async () => {
		const { ctx, chamadas } = criarContextoDeExecucao({
			moduloSlug: 'imoveis',
			valores: mapeado({ titulo: 'Casa', criado_em: '2026-01-01T00:00:00Z' }),
			additionalFields: {},
			options: {},
		});

		await expect(executarRegistro(ctx, 'criar', 0)).rejects.toThrow(
			/somente leitura no corpo: criado_em/,
		);
		expect(chamadas).toHaveLength(0);
	});

	it('criar: Dono vazio e RECUSADO antes da requisicao — `dono_id` nao e nullable no schema', async () => {
		const { ctx, chamadas } = criarContextoDeExecucao({
			moduloSlug: 'imoveis',
			valores: mapeado({ titulo: 'Casa', dono_id: null }),
			additionalFields: {},
			options: {},
		});

		await expect(executarRegistro(ctx, 'criar', 0)).rejects.toMatchObject({
			message: expect.stringContaining('"Registro › Criar" nao aceita vazio'),
			description: expect.stringContaining('opcional, mas NAO anulavel'),
		});
		expect(chamadas).toHaveLength(0);
	});

	it('atualizar: Equipe vazia PASSA ao topo — `equipe_id` e `.nullable()` no schema', async () => {
		const { ctx, chamadas } = criarContextoDeExecucao({
			moduloSlug: 'imoveis',
			registroId: REGISTRO,
			valores: mapeado({ equipe_id: null }),
			equipe_id: '',
		});

		await executarRegistro(ctx, 'atualizar', 0);
		expect(chamadas).toHaveLength(1);
		expect(chamadas[0].corpo).toEqual({ valores: {}, equipe_id: null });
	});

	it('criar: Equipe vazia tambem passa; so o Dono e recusado, e a mensagem nomeia os dois', async () => {
		const { ctx, chamadas } = criarContextoDeExecucao({
			moduloSlug: 'imoveis',
			valores: mapeado({ titulo: 'Casa', equipe_id: null }),
			additionalFields: {},
			options: {},
		});

		await executarRegistro(ctx, 'criar', 0);
		expect(chamadas[0].corpo).toEqual({ valores: { titulo: 'Casa' }, equipe_id: null });
	});

	it('o UUID do campo de sistema e conferido aqui: a API devolve 404 para malformado', async () => {
		const { ctx, chamadas } = criarContextoDeExecucao({
			moduloSlug: 'imoveis',
			valores: mapeado({ dono_id: 'nao-e-uuid' }),
			additionalFields: {},
			options: {},
		});

		await expect(executarRegistro(ctx, 'criar', 0)).rejects.toThrow(/dono_id nao e um UUID/);
		expect(chamadas).toHaveLength(0);
	});
});

describe('contato e empresa: o responsavel sai de `dados` e vai para o topo', () => {
	it('contato criar', async () => {
		const { ctx, chamadas } = criarContextoDeExecucao({
			additionalFields: { nome: 'Ana' },
			dados: mapeado({ camiseta: 'M', responsavel_id: DONO }),
			options: {},
		});

		await executarContato(ctx, 'criar', 0);
		expect(chamadas[0]).toMatchObject({ metodo: 'POST', caminho: '/contatos' });
		expect(chamadas[0].corpo).toEqual({
			nome: 'Ana',
			dados: { camiseta: 'M' },
			responsavel_id: DONO,
		});
	});

	it('contato atualizar so com o responsavel: nada em `dados`, e a mesclagem nem le a ficha', async () => {
		const { ctx, chamadas } = criarContextoDeExecucao({
			contatoId: REGISTRO,
			updateFields: {},
			dados: mapeado({ responsavel_id: DONO }),
			options: {},
		});

		await executarContato(ctx, 'atualizar', 0);
		// Sem GET de mesclagem: nao ha campo do layout para mesclar. E `dados`
		// nao vai como `{}`, o que APAGARIA os campos personalizados.
		expect(chamadas.map((chamada) => chamada.metodo)).toEqual(['PATCH']);
		expect(chamadas[0].corpo).toEqual({ responsavel_id: DONO });
	});

	it('contato atualizar com mesclagem: so o layout e mesclado com a ficha atual', async () => {
		const { ctx, chamadas } = criarContextoDeExecucao(
			{
				contatoId: REGISTRO,
				updateFields: {},
				dados: mapeado({ camiseta: 'G', responsavel_id: DONO }),
				options: {},
			},
			(chamada) =>
				chamada.metodo === 'GET' ? { id: REGISTRO, dados: { sapato: 42 } } : { id: REGISTRO },
		);

		await executarContato(ctx, 'atualizar', 0);
		expect(chamadas.map((chamada) => chamada.metodo)).toEqual(['GET', 'PATCH']);
		expect(chamadas[1].corpo).toEqual({
			dados: { sapato: 42, camiseta: 'G' },
			responsavel_id: DONO,
		});
	});

	it('empresa criar e upsert', async () => {
		const criar = criarContextoDeExecucao({
			nome: 'Acme',
			additionalFields: {},
			dados: mapeado({ porte: 'grande', responsavel_id: DONO }),
			options: {},
		});
		await executarEmpresa(criar.ctx, 'criar', 0);
		expect(criar.chamadas[0].corpo).toEqual({
			nome: 'Acme',
			dados: { porte: 'grande' },
			responsavel_id: DONO,
		});

		const upsert = criarContextoDeExecucao({
			nome: 'Acme',
			chave: 'nome',
			additionalFields: {},
			dados: mapeado({ responsavel_id: DONO }),
			options: {},
		});
		await executarEmpresa(upsert.ctx, 'criarOuAtualizar', 0);
		expect(upsert.chamadas[0]).toMatchObject({ caminho: '/empresas/upsert' });
		expect(upsert.chamadas[0].corpo).toEqual({ nome: 'Acme', chave: 'nome', responsavel_id: DONO });
	});
});

describe('negocio e atividade: so o que a rota aceita', () => {
	it('negocio criar: o dono sobe ao topo; a equipe e recusada, com o motivo', async () => {
		const comDono = criarContextoDeExecucao({
			pipeline_id: EQUIPE,
			valores: mapeado({ valor: 100, dono_id: DONO }),
			contato: {},
			etiquetas: [],
			etiquetasNovas: '',
			options: {},
		});
		await executarNegocio(comDono.ctx, 'criar', 0);
		expect(comDono.chamadas[0].corpo).toEqual({
			pipeline_id: EQUIPE,
			valores: { valor: 100 },
			dono_id: DONO,
		});

		const comEquipe = criarContextoDeExecucao({
			pipeline_id: EQUIPE,
			valores: mapeado({ equipe_id: EQUIPE }),
			contato: {},
			etiquetas: [],
			etiquetasNovas: '',
			options: {},
		});
		await expect(executarNegocio(comEquipe.ctx, 'criar', 0)).rejects.toMatchObject({
			message: expect.stringContaining('"equipe_id"'),
			description: expect.stringContaining('nao a equipe'),
		});
		expect(comEquipe.chamadas).toHaveLength(0);
	});

	it('negocio: Dono vazio e recusado em Criar e em Criar ou Atualizar, sem chamada', async () => {
		const criar = criarContextoDeExecucao({
			pipeline_id: EQUIPE,
			valores: mapeado({ valor: 100, dono_id: null }),
			contato: {},
			etiquetas: [],
			etiquetasNovas: '',
			options: {},
		});
		await expect(executarNegocio(criar.ctx, 'criar', 0)).rejects.toMatchObject({
			message: expect.stringContaining('"Negocio › Criar" nao aceita vazio'),
		});
		expect(criar.chamadas).toHaveLength(0);

		const upsert = criarContextoDeExecucao({
			contato: { telefone: '11999999999' },
			pipeline: {},
			estagio: {},
			valores: mapeado({ dono_id: null }),
			options: {},
		});
		await expect(executarNegocio(upsert.ctx, 'criarOuAtualizar', 0)).rejects.toMatchObject({
			message: expect.stringContaining('"Negocio › Criar ou Atualizar" nao aceita vazio'),
			description: expect.stringContaining('dono_id'),
		});
		expect(upsert.chamadas).toHaveLength(0);
	});

	it('contato e empresa: responsavel vazio PASSA — os dois schemas sao `.nullable()`', async () => {
		const contato = criarContextoDeExecucao({
			contatoId: REGISTRO,
			updateFields: {},
			dados: mapeado({ responsavel_id: null }),
			options: {},
		});
		await executarContato(contato.ctx, 'atualizar', 0);
		expect(contato.chamadas[0].corpo).toEqual({ responsavel_id: null });

		const empresa = criarContextoDeExecucao({
			nome: 'Acme',
			additionalFields: {},
			dados: mapeado({ responsavel_id: null }),
			options: {},
		});
		await executarEmpresa(empresa.ctx, 'criar', 0);
		expect(empresa.chamadas[0].corpo).toEqual({ nome: 'Acme', responsavel_id: null });
	});

	it('negocio atualizar nao aceita campo de sistema nenhum', async () => {
		const { ctx, chamadas } = criarContextoDeExecucao({
			negocioId: REGISTRO,
			valores: mapeado({ valor: 100, dono_id: DONO }),
			contato: {},
			etiquetas: [],
			etiquetasNovas: '',
		});

		await expect(executarNegocio(ctx, 'atualizar', 0)).rejects.toMatchObject({
			message: expect.stringContaining('"dono_id"'),
			description: expect.stringContaining('PATCH /negocios/{id}'),
		});
		expect(chamadas).toHaveLength(0);
	});

	it('atividade: o dicionario de `tarefas` anuncia dono e equipe, mas a rota so conhece usuario_id', async () => {
		const { ctx, chamadas } = criarContextoDeExecucao({
			tipo: 'tarefa',
			titulo: 'Ligar',
			entidade_tipo: 'contato',
			entidade_id: REGISTRO,
			additionalFields: {},
			dados: mapeado({ dono_id: DONO }),
			options: {},
		});

		await expect(executarAtividade(ctx, 'criar', 0)).rejects.toMatchObject({
			message: expect.stringContaining('"dono_id"'),
			description: expect.stringContaining('usuario_id'),
		});
		expect(chamadas).toHaveLength(0);
	});
});

// ── O mapper e os filtros, por operacao ─────────────────────────────

const DICIONARIO: IDataObject[] = [
	{ slug: 'titulo', nome: 'Titulo', tipo: 'texto', obrigatorio: true, sistema: false, somente_leitura: false },
	{ slug: 'dono_id', nome: 'Responsavel', tipo: 'usuario', obrigatorio: false, sistema: true, somente_leitura: false },
	{ slug: 'equipe_id', nome: 'Equipe', tipo: 'referencia', obrigatorio: false, sistema: true, somente_leitura: false },
	{ slug: 'criado_em', nome: 'Criado em', tipo: 'data', obrigatorio: false, sistema: true, somente_leitura: true },
	{ slug: 'atualizado_por', nome: 'Atualizado por', tipo: 'usuario', obrigatorio: false, sistema: true, somente_leitura: true },
];

const DICIONARIO_DE_CONTATOS: IDataObject[] = [
	{ slug: 'nome', nome: 'Nome', tipo: 'texto', obrigatorio: true, sistema: false, somente_leitura: false },
	{ slug: 'responsavel_id', nome: 'Responsavel', tipo: 'usuario', obrigatorio: false, sistema: true, somente_leitura: false },
	{ slug: 'criado_em', nome: 'Criado em', tipo: 'data', obrigatorio: false, sistema: true, somente_leitura: true },
];

function criarContextoDeOpcoes(
	atuais: Record<string, unknown>,
	dicionario: IDataObject[],
): { ctx: ILoadOptionsFunctions; caminhos: string[] } {
	const caminhos: string[] = [];
	const ctx = {
		getCurrentNodeParameter: (nome: string) => atuais[nome],
		getNode: () => ({ name: 'Fluxo CRM', type: 'fluxoCrm', typeVersion: 1 }),
		getCredentials: async () => ({
			baseUrl: BASE,
			apiKey: `flx_test_${Math.random().toString(36).slice(2)}`,
		}),
		logger: {
			debug: () => undefined,
			info: () => undefined,
			warn: () => undefined,
			error: () => undefined,
		},
		helpers: {
			httpRequestWithAuthentication: async (_credencial: string, requisicao: IDataObject) => {
				const url = String(requisicao.url);
				caminhos.push(url.startsWith(BASE) ? url.slice(BASE.length) : url);
				return { body: { dados: dicionario }, statusCode: 200, headers: {} };
			},
		},
	} as unknown as ILoadOptionsFunctions;

	return { ctx, caminhos };
}

describe('o mapper oferece o campo de sistema so onde a operacao o aceita', () => {
	it('registro: criar mostra dono e equipe; atualizar so equipe; auditoria nunca', async () => {
		const criar = criarContextoDeOpcoes({ moduloSlug: 'imoveis', operation: 'criar' }, DICIONARIO);
		const camposDeCriar = await mapearCamposDoModulo.call(criar.ctx);
		expect(criar.caminhos).toEqual(['/modulos/imoveis/campos']);
		expect(camposDeCriar.fields.map((campo) => campo.id)).toEqual(['titulo', 'dono_id', 'equipe_id']);
		expect(camposDeCriar.fields[1].displayName).toBe('Responsavel (sistema)');

		const atualizar = criarContextoDeOpcoes(
			{ moduloSlug: 'imoveis', operation: 'atualizar' },
			DICIONARIO,
		);
		const camposDeAtualizar = await mapearCamposDoModulo.call(atualizar.ctx);
		expect(camposDeAtualizar.fields.map((campo) => campo.id)).toEqual(['titulo', 'equipe_id']);
	});

	it('negocio: criar mostra o dono; atualizar nao mostra campo de sistema', async () => {
		const criar = await mapearCamposDeNegocio.call(
			criarContextoDeOpcoes({ operation: 'criar' }, DICIONARIO).ctx,
		);
		expect(criar.fields.map((campo) => campo.id)).toEqual(['titulo', 'dono_id']);

		const atualizar = await mapearCamposDeNegocio.call(
			criarContextoDeOpcoes({ operation: 'atualizar' }, DICIONARIO).ctx,
		);
		expect(atualizar.fields.map((campo) => campo.id)).toEqual(['titulo']);
	});

	it('atividade nunca mostra dono nem equipe: a rota nao os aceita', async () => {
		const campos = await mapearCamposDeAtividade.call(
			criarContextoDeOpcoes({ operation: 'criar' }, DICIONARIO).ctx,
		);
		expect(campos.fields.map((campo) => campo.id)).toEqual(['titulo']);
	});

	it('contato mostra o responsavel em qualquer operacao de escrita, e nunca criado_em', async () => {
		for (const operation of ['criar', 'atualizar', 'criarOuAtualizar', undefined]) {
			const campos = await mapearCamposDeContato.call(
				criarContextoDeOpcoes({ operation }, DICIONARIO_DE_CONTATOS).ctx,
			);
			expect(campos.fields.map((campo) => campo.id), String(operation)).toEqual([
				'nome',
				'responsavel_id',
			]);
		}
	});

	it('o filtro `campo:` NAO oferece campo de sistema: o servidor confere o slug contra o layout', async () => {
		const opcoes = await carregarCamposDoModulo.call(
			criarContextoDeOpcoes({ moduloSlug: 'imoveis' }, DICIONARIO).ctx,
		);
		expect(opcoes.map((opcao) => opcao.value)).toEqual(['titulo']);
	});

	it('flag ausente: a API anterior segue funcionando igual, no mapper e no filtro', async () => {
		const antigo: IDataObject[] = [
			{ slug: 'titulo', nome: 'Titulo', tipo: 'texto', obrigatorio: true },
			{ slug: 'valor', nome: 'Valor', tipo: 'moeda', obrigatorio: false },
		];
		const campos = await mapearCamposDoModulo.call(
			criarContextoDeOpcoes({ moduloSlug: 'imoveis', operation: 'atualizar' }, antigo).ctx,
		);
		expect(campos.fields.map((campo) => campo.id)).toEqual(['titulo', 'valor']);

		const opcoes = await carregarCamposDoModulo.call(
			criarContextoDeOpcoes({ moduloSlug: 'imoveis' }, antigo).ctx,
		);
		expect(opcoes.map((opcao) => opcao.value)).toEqual(['titulo', 'valor']);
	});

	it('slug de layout colidindo com campo de sistema vira erro do node, com o que fazer', async () => {
		const comColisao: IDataObject[] = [
			{ slug: 'titulo', nome: 'Titulo', tipo: 'texto', obrigatorio: true, sistema: false },
			// Slug DECLARADO no seed do modulo: o gerador nunca produziria este
			// nome, mas `campo.slug ?? gerarSlug(nome)` deixa passar o que veio.
			{ slug: 'dono_id', nome: 'Dono do imovel', tipo: 'texto', obrigatorio: false, sistema: false },
		];

		await expect(
			mapearCamposDoModulo.call(
				criarContextoDeOpcoes({ moduloSlug: 'imoveis', operation: 'criar' }, comColisao).ctx,
			),
		).rejects.toMatchObject({
			name: 'NodeOperationError',
			message: expect.stringContaining('dono_id'),
			description: expect.stringContaining('Configuracoes › Modulos'),
		});
	});
});

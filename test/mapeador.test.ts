import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	CAMPOS_DE_SISTEMA_GRAVAVEIS,
	CAMPOS_DE_SISTEMA_SOMENTE_LEITURA,
	camposParaMapeador,
	escolhasDoCampo,
	separarCamposDeSistema,
	SISTEMA_ACEITO_NA_ESCRITA,
	sistemaAceito,
	sistemaAceitoNoRecurso,
	valoresDoMapeador,
} from '../nodes/FluxoCrm/compartilhado/mapeador';

/**
 * O `resourceMapper` de campos personalizados.
 *
 * A razao de ele existir e a razao destes testes: a obrigatoriedade de cada
 * campo vem do LAYOUT DA ORGANIZACAO, entao o mesmo corpo devolve 201 numa org
 * e 422 noutra. Se a traducao perder o `required`, o node volta a ser um campo
 * JSON que so descobre a exigencia em producao.
 */

function campo(extra: IDataObject): IDataObject {
	return { slug: 'campo', nome: 'Campo', tipo: 'texto', obrigatorio: false, ...extra };
}

describe('traducao do dicionario para o mapper', () => {
	it('leva o `obrigatorio` do layout para o `required` do mapper', () => {
		const [exigido, opcional] = camposParaMapeador([
			campo({ slug: 'cnpj', nome: 'CNPJ', obrigatorio: true }),
			campo({ slug: 'apelido', nome: 'Apelido', obrigatorio: false }),
		]);

		expect(exigido).toMatchObject({ id: 'cnpj', displayName: 'CNPJ', required: true });
		expect(opcional.required).toBe(false);
	});

	it('mapeia os tipos da API para os tipos de campo do n8n', () => {
		const campos = camposParaMapeador([
			campo({ slug: 'a', tipo: 'texto' }),
			campo({ slug: 'b', tipo: 'numero' }),
			campo({ slug: 'c', tipo: 'moeda' }),
			campo({ slug: 'd', tipo: 'booleano' }),
			campo({ slug: 'e', tipo: 'data' }),
			campo({ slug: 'f', tipo: 'multiselecao' }),
			campo({ slug: 'g', tipo: 'referencia' }),
			campo({ slug: 'h', tipo: 'subformulario' }),
		]);

		expect(campos.map((item) => item.type)).toEqual([
			'string',
			'number',
			'number',
			'boolean',
			'dateTime',
			'array',
			'string',
			'object',
		]);
	});

	it('tipo desconhecido vira texto, e nao some do painel', () => {
		// Um tipo novo do CRM tem de aparecer como texto; sumir seria pior, porque
		// o campo pode ser obrigatorio no layout.
		const [item] = camposParaMapeador([campo({ tipo: 'tipo_que_ainda_nao_existe' })]);
		expect(item.type).toBe('string');
	});

	it('campos DERIVADOS ficam de fora: escrever neles nao tem efeito', () => {
		const campos = camposParaMapeador([
			campo({ slug: 'total', tipo: 'formula' }),
			campo({ slug: 'soma', tipo: 'agregacao' }),
			campo({ slug: 'nome', tipo: 'texto' }),
		]);

		expect(campos.map((item) => item.id)).toEqual(['nome']);
	});

	it('`autonumerico` entra somente leitura', () => {
		const [item] = camposParaMapeador([campo({ slug: 'numero', tipo: 'autonumerico' })]);
		expect(item).toMatchObject({ type: 'number', readOnly: true });
	});

	it('campo sem slug e descartado: ele nao teria como virar chave do corpo', () => {
		expect(camposParaMapeador([campo({ slug: '' }), campo({ slug: 'ok' })])).toHaveLength(1);
	});

	it('preserva a ordem do layout, que e a ordem em que a API devolve', () => {
		const campos = camposParaMapeador([
			campo({ slug: 'z', nome: 'Zebra' }),
			campo({ slug: 'a', nome: 'Alfa' }),
		]);
		expect(campos.map((item) => item.id)).toEqual(['z', 'a']);
	});

	it('NENHUM campo personalizado e oferecido como chave de casamento', () => {
		// Todos os mappers deste node usam o modo "add", e o unico upsert com
		// indice configuravel — o de contatos — casa por COLUNA, que tem parametro
		// proprio. Prometer casamento por campo custom seria prometer o que a API
		// nao faz.
		for (const item of camposParaMapeador([campo({ slug: 'email' }), campo({ slug: 'apelido' })])) {
			expect(item).toMatchObject({ canBeUsedToMatch: false, defaultMatch: false });
		}
	});
});

/**
 * Os campos de SISTEMA do dicionario (`api-publica/campos-de-sistema.ts`).
 *
 * `GET /modulos/{slug}/campos` passou a devolver responsavel, equipe e os
 * quatro de auditoria junto do layout, com `sistema: true`. A regra que estes
 * testes travam: somente leitura nunca entra num mapper de escrita; o gravavel
 * entra so onde a rota o aceita, e viaja no topo do corpo; e a flag ausente —
 * instancia com API anterior — se comporta exatamente como antes.
 */
function deSistema(slug: string, nome: string, somenteLeitura: boolean): IDataObject {
	return campo({
		id: null,
		slug,
		nome,
		tipo: somenteLeitura ? 'data' : 'usuario',
		sistema: true,
		somente_leitura: somenteLeitura,
	});
}

const DICIONARIO_DE_REGISTROS: IDataObject[] = [
	campo({ slug: 'titulo', nome: 'Titulo', sistema: false, somente_leitura: false }),
	deSistema('dono_id', 'Responsavel', false),
	deSistema('equipe_id', 'Equipe', false),
	deSistema('criado_em', 'Criado em', true),
	deSistema('criado_por', 'Criado por', true),
	deSistema('atualizado_em', 'Atualizado em', true),
	deSistema('atualizado_por', 'Atualizado por', true),
];

describe('campos de sistema no mapper de escrita', () => {
	it('somente leitura NUNCA entra: sao preenchidos pelo servidor', () => {
		const ids = camposParaMapeador(DICIONARIO_DE_REGISTROS, {
			deSistemaAceitos: ['dono_id', 'equipe_id'],
		}).map((item) => item.id);

		for (const slug of CAMPOS_DE_SISTEMA_SOMENTE_LEITURA) expect(ids).not.toContain(slug);
	});

	it('o gravavel entra so quando a operacao o aceita, e marcado como de sistema', () => {
		const criar = camposParaMapeador(DICIONARIO_DE_REGISTROS, {
			deSistemaAceitos: ['dono_id', 'equipe_id'],
		});
		expect(criar.map((item) => item.id)).toEqual(['titulo', 'dono_id', 'equipe_id']);
		expect(criar[1].displayName).toBe('Responsavel (sistema)');
		expect(criar[0].displayName).toBe('Titulo');

		const atualizar = camposParaMapeador(DICIONARIO_DE_REGISTROS, {
			deSistemaAceitos: ['equipe_id'],
		});
		expect(atualizar.map((item) => item.id)).toEqual(['titulo', 'equipe_id']);

		// Sem lista, nenhum campo de sistema: e o mapper de uma rota que nao
		// aceita nenhum (atividades).
		expect(camposParaMapeador(DICIONARIO_DE_REGISTROS).map((item) => item.id)).toEqual(['titulo']);
	});

	it('FLAG AUSENTE = comportamento antigo: tudo entra, como numa API anterior', () => {
		// Instancia sem as flags nunca devolve campo de sistema; mas um campo do
		// layout sem `sistema`/`somente_leitura` precisa continuar entrando.
		const antigos = [campo({ slug: 'apelido' }), campo({ slug: 'cnpj', obrigatorio: true })];
		const ids = camposParaMapeador(antigos).map((item) => item.id);
		expect(ids).toEqual(['apelido', 'cnpj']);
		expect(camposParaMapeador(antigos)[0].displayName).toBe('Campo');
	});

	it('separa o objeto do mapeador em layout, sistema e somente leitura', () => {
		expect(
			separarCamposDeSistema({
				titulo: 'Casa',
				dono_id: 'u-1',
				equipe_id: null,
				criado_em: '2026-01-01',
				responsavel_id: 'u-2',
			}),
		).toEqual({
			doLayout: { titulo: 'Casa' },
			deSistema: { dono_id: 'u-1', equipe_id: null, responsavel_id: 'u-2' },
			somenteLeitura: ['criado_em'],
		});
	});

	it('as listas fechadas espelham `camposDeSistemaDoModulo` do servidor', () => {
		// `campos-de-sistema.ts`: responsavel (`dono_id` ou `responsavel_id`) e
		// `equipe_id` gravaveis; criado/atualizado em/por somente leitura.
		expect([...CAMPOS_DE_SISTEMA_GRAVAVEIS].sort()).toEqual(['dono_id', 'equipe_id', 'responsavel_id']);
		expect([...CAMPOS_DE_SISTEMA_SOMENTE_LEITURA].sort()).toEqual([
			'atualizado_em',
			'atualizado_por',
			'criado_em',
			'criado_por',
		]);
	});

	it('a tabela de envelope segue os schemas de escrita, rota a rota', () => {
		// registros.ts: criar aceita dono e equipe; atualizar so equipe.
		expect(sistemaAceito('registro', 'criar')).toEqual(['dono_id', 'equipe_id']);
		expect(sistemaAceito('registro', 'atualizar')).toEqual(['equipe_id']);
		// negocios.ts: dono em criar e upsert; nada em atualizar; equipe nunca.
		expect(sistemaAceito('negocio', 'criar')).toEqual(['dono_id']);
		expect(sistemaAceito('negocio', 'criarOuAtualizar')).toEqual(['dono_id']);
		expect(sistemaAceito('negocio', 'atualizar')).toEqual([]);
		// contatos.ts / empresas.ts: responsavel nas tres.
		for (const recurso of ['contato', 'empresa']) {
			for (const operacao of ['criar', 'atualizar', 'criarOuAtualizar']) {
				expect(sistemaAceito(recurso, operacao)).toEqual(['responsavel_id']);
			}
		}
		// atividades.ts e .strict() e so conhece usuario_id.
		expect(sistemaAceito('atividade', 'criar')).toEqual([]);
		expect(sistemaAceito('atividade', 'atualizar')).toEqual([]);
		// Recurso ou operacao fora da tabela: nada e aceito (falha fechada).
		expect(sistemaAceito('lead', 'criar')).toEqual([]);
		expect(sistemaAceito('registro', 'excluir')).toEqual([]);

		expect(sistemaAceitoNoRecurso('registro')).toEqual(['dono_id', 'equipe_id']);
		expect(sistemaAceitoNoRecurso('atividade')).toEqual([]);
		// Toda entrada da tabela so cita campos que existem na lista de gravaveis.
		for (const porOperacao of Object.values(SISTEMA_ACEITO_NA_ESCRITA)) {
			for (const aceitos of Object.values(porOperacao)) {
				for (const slug of aceitos) expect(CAMPOS_DE_SISTEMA_GRAVAVEIS).toContain(slug);
			}
		}
	});
});

describe('campo de selecao', () => {
	it('usa `opcoes.escolhas` quando ela e um array de texto', () => {
		const [item] = camposParaMapeador([
			campo({ slug: 'porte', tipo: 'selecao', opcoes: { escolhas: ['Pequeno', 'Grande'] } }),
		]);

		expect(item.type).toBe('options');
		expect(item.options).toEqual([
			{ name: 'Pequeno', value: 'Pequeno' },
			{ name: 'Grande', value: 'Grande' },
		]);
	});

	it('aceita escolha em forma de objeto, com rotulo e valor separados', () => {
		expect(escolhasDoCampo({ opcoes: { escolhas: [{ valor: 'p', rotulo: 'Pequeno' }] } })).toEqual([
			{ name: 'Pequeno', value: 'p' },
		]);
	});

	it('CAI PARA TEXTO quando as escolhas nao sao reconheciveis', () => {
		// `opcoes` chega como jsonb cru, sem contrato. Um `options` sem `options`
		// renderiza um dropdown vazio, que trava a edicao — texto livre e pior
		// apenas na validacao, e o servidor valida de qualquer forma.
		const [semEscolhas] = camposParaMapeador([campo({ tipo: 'selecao' })]);
		const [escolhasEstranhas] = camposParaMapeador([
			campo({ tipo: 'selecao', opcoes: { escolhas: 'nao é array' } }),
		]);

		expect(semEscolhas.type).toBe('string');
		expect(semEscolhas.options).toBeUndefined();
		expect(escolhasEstranhas.type).toBe('string');
	});
});

describe('leitura do valor preenchido', () => {
	it('extrai o objeto plano de dentro do valor do parametro', () => {
		expect(
			valoresDoMapeador({
				mappingMode: 'defineBelow',
				value: { cnpj: '00.000.000/0001-00', ativo: true },
				matchingColumns: [],
				schema: [],
			}),
		).toEqual({ cnpj: '00.000.000/0001-00', ativo: true });
	});

	it('aceita o objeto plano vindo direto de uma expressao', () => {
		expect(valoresDoMapeador({ cnpj: '123' })).toEqual({ cnpj: '123' });
	});

	it('NADA preenchido devolve undefined, e nunca `{}`', () => {
		// A diferenca importa: em `dados`, um objeto vazio APAGA todos os campos
		// personalizados do registro. O node nao pode fazer isso por omissao.
		expect(valoresDoMapeador({ mappingMode: 'defineBelow', value: null })).toBeUndefined();
		expect(valoresDoMapeador({ mappingMode: 'defineBelow', value: {} })).toBeUndefined();
		expect(valoresDoMapeador(undefined)).toBeUndefined();
		expect(valoresDoMapeador(null)).toBeUndefined();
		expect(valoresDoMapeador({ value: { vazio: '' } })).toBeUndefined();
	});

	it('`null` de um campo e PRESERVADO: e como o usuario limpa um valor', () => {
		expect(valoresDoMapeador({ value: { apelido: null, nome: 'Ana' } })).toEqual({
			apelido: null,
			nome: 'Ana',
		});
	});

	it('`0` e `false` sao valores, e nao vazios', () => {
		expect(valoresDoMapeador({ value: { quantidade: 0, ativo: false } })).toEqual({
			quantidade: 0,
			ativo: false,
		});
	});
});

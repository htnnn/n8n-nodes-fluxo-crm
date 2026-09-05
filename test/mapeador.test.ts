import type { IDataObject } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	camposParaMapeador,
	escolhasDoCampo,
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

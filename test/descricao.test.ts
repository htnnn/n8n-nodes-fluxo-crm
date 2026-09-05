import type { INodeProperties } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { FluxoCrm } from '../nodes/FluxoCrm/FluxoCrm.node';
import { encontrarOperacao, RECURSOS } from '../nodes/FluxoCrm/compartilhado/catalogo';

const node = new FluxoCrm();
const propriedades = node.description.properties;

/** Percorre a arvore inteira: propriedades, opcoes de colecao e secoes de fixedCollection. */
function todasAsPropriedades(lista: INodeProperties[]): INodeProperties[] {
	const saida: INodeProperties[] = [];

	for (const propriedade of lista) {
		saida.push(propriedade);

		if (propriedade.type === 'collection' && Array.isArray(propriedade.options)) {
			saida.push(...todasAsPropriedades(propriedade.options as INodeProperties[]));
		}

		if (propriedade.type === 'fixedCollection' && Array.isArray(propriedade.options)) {
			for (const secao of propriedade.options as Array<{ values?: INodeProperties[] }>) {
				if (Array.isArray(secao.values)) saida.push(...todasAsPropriedades(secao.values));
			}
		}
	}

	return saida;
}

const arvore = todasAsPropriedades(propriedades);

describe('coerencia entre a arvore de parametros e o catalogo', () => {
	it('todo `operation` citado em displayOptions existe no catalogo do seu recurso', () => {
		// Esta e a divergencia que produz o erro generico do n8n
		// (`The value "x" is not supported!`), que nao diz nada a ninguem.
		for (const propriedade of arvore) {
			const mostrar = propriedade.displayOptions?.show;
			if (mostrar === undefined) continue;

			const recursos = (mostrar.resource ?? []) as string[];
			const operacoes = (mostrar.operation ?? []) as string[];
			if (recursos.length === 0 || operacoes.length === 0) continue;

			for (const recurso of recursos) {
				for (const operacao of operacoes) {
					expect(
						encontrarOperacao(recurso, operacao),
						`${propriedade.name}: ${recurso} › ${operacao} nao existe no catalogo`,
					).toBeDefined();
				}
			}
		}
	});

	it('todo recurso do catalogo tem o seu proprio parametro `operation`', () => {
		const parametros = propriedades.filter((propriedade) => propriedade.name === 'operation');
		const cobertos = parametros.map(
			(parametro) => (parametro.displayOptions?.show?.resource ?? [])[0] as string,
		);
		expect([...cobertos].sort()).toEqual(RECURSOS.map((recurso) => recurso.valor).sort());
	});

	it('o `default` de cada parametro `operation` e uma operacao real do recurso', () => {
		const parametros = propriedades.filter((propriedade) => propriedade.name === 'operation');
		expect(parametros).toHaveLength(RECURSOS.length);

		for (const parametro of parametros) {
			const recurso = (parametro.displayOptions?.show?.resource ?? [])[0] as string;
			expect(encontrarOperacao(recurso, parametro.default as string)).toBeDefined();
		}
	});

	it('o `default` do recurso existe no catalogo', () => {
		const recurso = propriedades.find((propriedade) => propriedade.name === 'resource');
		expect(RECURSOS.map((item) => item.valor)).toContain(recurso?.default);
	});
});

describe('metodos referenciados pela interface existem na classe', () => {
	const registrados = {
		loadOptions: Object.keys(node.methods.loadOptions),
		listSearch: Object.keys(node.methods.listSearch),
		resourceMapping: Object.keys(node.methods.resourceMapping),
		credentialTest: Object.keys(node.methods.credentialTest),
	};

	/** Os metodos de `resourceMapper` citados na arvore de parametros. */
	const mapeadoresCitados = new Set(
		arvore
			.map((propriedade) => propriedade.typeOptions?.resourceMapper?.resourceMapperMethod)
			.filter((metodo): metodo is string => typeof metodo === 'string'),
	);

	it('todo loadOptionsMethod citado esta registrado', () => {
		for (const propriedade of arvore) {
			const metodo = propriedade.typeOptions?.loadOptionsMethod;
			if (metodo === undefined) continue;
			expect(registrados.loadOptions, `loadOptions ausente: ${metodo}`).toContain(metodo);
		}
	});

	it('todo searchListMethod citado esta registrado', () => {
		for (const propriedade of arvore) {
			for (const modo of propriedade.modes ?? []) {
				const metodo = modo.typeOptions?.searchListMethod;
				if (metodo === undefined) continue;
				expect(registrados.listSearch, `listSearch ausente: ${metodo}`).toContain(metodo);
			}
		}
	});

	it('todo resourceMapperMethod citado esta registrado', () => {
		// O mapper e a unica forma de o node saber a obrigatoriedade real dos
		// campos daquela organizacao. Um metodo citado e nao registrado nao falha
		// no lint nem no build: falha na tela do usuario, com o painel vazio.
		for (const metodo of mapeadoresCitados) {
			expect(registrados.resourceMapping, `resourceMapping ausente: ${metodo}`).toContain(metodo);
		}
	});

	it('nao ha resourceMapping registrado sem uso na interface', () => {
		for (const metodo of registrados.resourceMapping) {
			expect(mapeadoresCitados.has(metodo), `resourceMapping sem uso: ${metodo}`).toBe(true);
		}
	});

	it('todo `resourceMapper` declara o default que a interface do n8n espera', () => {
		for (const propriedade of arvore) {
			if (propriedade.type !== 'resourceMapper') continue;
			expect(propriedade.default, `default errado em ${propriedade.name}`).toEqual({
				mappingMode: 'defineBelow',
				value: null,
			});
		}
	});

	it('o `testedBy` da credencial esta registrado', () => {
		for (const credencial of node.description.credentials ?? []) {
			expect(registrados.credentialTest).toContain(credencial.testedBy);
		}
	});

	it('nao ha metodo registrado sem uso na interface', () => {
		const citados = new Set(
			arvore
				.map((propriedade) => propriedade.typeOptions?.loadOptionsMethod)
				.filter((metodo): metodo is string => metodo !== undefined),
		);
		// Os dois parametros de operacao e o de recurso tambem sao dinamicos.
		for (const metodo of registrados.loadOptions) {
			expect(citados.has(metodo), `loadOptions sem uso: ${metodo}`).toBe(true);
		}
	});
});

describe('ordenacao que o lint nao consegue conferir', () => {
	// `node-param-collection-type-unsorted-items` so enxerga arrays literais. As
	// colecoes deste node sao produzidas por funcao (para nao duplicar 25 campos
	// entre "Campos Adicionais" e "Campos a Atualizar"), entao a regra passa por
	// cima delas — e a ordem fica por conta deste teste.
	const MINIMO_PARA_ORDENAR = 5;

	it('toda colecao com cinco ou mais itens esta em ordem alfabetica por displayName', () => {
		for (const propriedade of arvore) {
			if (propriedade.type !== 'collection') continue;
			const opcoes = (propriedade.options ?? []) as INodeProperties[];
			if (opcoes.length < MINIMO_PARA_ORDENAR) continue;

			const nomes = opcoes.map((opcao) => opcao.displayName);
			expect(nomes, `colecao fora de ordem: ${propriedade.name}`).toEqual(
				[...nomes].sort((a, b) => a.localeCompare(b)),
			);
		}
	});

	it('toda secao de fixedCollection com cinco ou mais campos esta em ordem alfabetica', () => {
		for (const propriedade of arvore) {
			if (propriedade.type !== 'fixedCollection') continue;
			for (const secao of (propriedade.options ?? []) as Array<{
				name?: string;
				values?: INodeProperties[];
			}>) {
				const valores = secao.values ?? [];
				if (valores.length < MINIMO_PARA_ORDENAR) continue;

				const nomes = valores.map((valor) => valor.displayName);
				expect(nomes, `secao fora de ordem: ${propriedade.name}.${secao.name}`).toEqual(
					[...nomes].sort((a, b) => a.localeCompare(b)),
				);
			}
		}
	});
});

describe('contrato do node com o n8n', () => {
	it('toda operacao do catalogo tem ao menos um parametro proprio ou e sem parametro', () => {
		const cobertas = new Set<string>();
		for (const propriedade of arvore) {
			const mostrar = propriedade.displayOptions?.show;
			if (mostrar === undefined) continue;
			for (const recurso of (mostrar.resource ?? []) as string[]) {
				for (const operacao of (mostrar.operation ?? []) as string[]) {
					cobertas.add(`${recurso}:${operacao}`);
				}
			}
		}

		// `excluir` de qualquer recurso so precisa do localizador, que ja conta.
		for (const recurso of RECURSOS) {
			for (const operacao of recurso.operacoes) {
				expect(
					cobertas.has(`${recurso.valor}:${operacao.valor}`),
					`${recurso.valor} › ${operacao.valor} nao tem nenhum parametro na interface`,
				).toBe(true);
			}
		}
	});

	it('a credencial e obrigatoria e o node declara entrada e saida', () => {
		expect(node.description.credentials?.[0]).toMatchObject({
			name: 'fluxoCrmApi',
			required: true,
		});
		expect(node.description.inputs).toHaveLength(1);
		expect(node.description.outputs).toHaveLength(1);
	});
});

import { describe, expect, it } from 'vitest';

import {
	encontrarOperacao,
	encontrarRecurso,
	MARCA_DE_CADEADO,
	opcoesDeOperacaoComEscopo,
	opcoesDeRecursoComEscopo,
	opcoesEstaticasDeOperacao,
	opcoesEstaticasDeRecurso,
	operacaoPermitida,
	RECURSOS,
} from '../nodes/FluxoCrm/compartilhado/catalogo';
import type { EstadoDeEscopos } from '../nodes/FluxoCrm/compartilhado/escopos';

const contato = encontrarRecurso('contato')!;
const negocio = encontrarRecurso('negocio')!;

function conhecidos(escopos: string[]): EstadoDeEscopos {
	return { conhecidos: true, escopos, origem: 'me' };
}

const DESCONHECIDOS: EstadoDeEscopos = {
	conhecidos: false,
	escopos: [],
	origem: 'indisponivel',
};

describe('catalogo', () => {
	it('todo recurso tem uma operacao padrao que existe', () => {
		for (const recurso of RECURSOS) {
			expect(encontrarOperacao(recurso.valor, recurso.operacaoPadrao)).toBeDefined();
		}
	});

	it('nenhuma operacao repete valor dentro do recurso', () => {
		for (const recurso of RECURSOS) {
			const valores = recurso.operacoes.map((operacao) => operacao.valor);
			expect(new Set(valores).size).toBe(valores.length);
		}
	});

	it('as opcoes estaticas trazem `action`, que e o que o painel de Actions le', () => {
		for (const opcao of opcoesEstaticasDeOperacao(contato)) {
			expect(opcao.action).toBeTruthy();
		}
	});

	it('as opcoes estaticas cobrem TODAS as operacoes e nunca levam cadeado', () => {
		// O painel de Actions renderiza antes de existir credencial: filtrar ali
		// por escopo seria mentir com base em nada.
		const estaticas = opcoesEstaticasDeOperacao(contato);
		expect(estaticas).toHaveLength(contato.operacoes.length);
		for (const opcao of estaticas) {
			expect(opcao.name).not.toContain(MARCA_DE_CADEADO);
		}
	});

	it('as opcoes estaticas ficam em ordem alfabetica, como o lint exige', () => {
		const nomes = opcoesEstaticasDeOperacao(negocio).map((opcao) => opcao.name);
		expect(nomes).toEqual([...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR')));

		const recursos = opcoesEstaticasDeRecurso().map((opcao) => opcao.name);
		expect(recursos).toEqual([...recursos].sort((a, b) => a.localeCompare(b, 'pt-BR')));
	});
});

describe('cadeado por escopo no dropdown remoto', () => {
	it('a operacao sem escopo recebe CADEADO no nome E o motivo na descricao', () => {
		const opcoes = opcoesDeOperacaoComEscopo(contato, conhecidos(['contatos:ler']));
		const criar = opcoes.find((opcao) => opcao.value === 'criar')!;

		expect(criar.name).toBe(`${MARCA_DE_CADEADO}Criar`);
		expect(criar.description).toContain('contatos:escrever');
		expect(criar.description).toMatch(/Requer o escopo/);
	});

	it('a operacao bloqueada CONTINUA na lista e continua selecionavel', () => {
		// Decisao de desenho: esconder fecharia o dropdown mas deixaria o painel
		// de Actions oferecendo a mesma operacao sem aviso nenhum.
		const opcoes = opcoesDeOperacaoComEscopo(contato, conhecidos(['contatos:ler']));
		expect(opcoes).toHaveLength(contato.operacoes.length);
		expect(opcoes.map((opcao) => opcao.value)).toContain('excluir');
	});

	it('a operacao permitida nao ganha cadeado nem motivo', () => {
		const opcoes = opcoesDeOperacaoComEscopo(contato, conhecidos(['contatos:ler']));
		const listar = opcoes.find((opcao) => opcao.value === 'listar')!;

		expect(listar.name).toBe('Listar');
		expect(listar.description).not.toMatch(/Requer o escopo/);
	});

	it('as permitidas vem antes das bloqueadas, alfabeticas dentro de cada grupo', () => {
		const opcoes = opcoesDeOperacaoComEscopo(contato, conhecidos(['contatos:ler']));
		const bloqueada = (opcao: { name: string }) => opcao.name.startsWith(MARCA_DE_CADEADO);

		const primeiraBloqueada = opcoes.findIndex(bloqueada);
		expect(primeiraBloqueada).toBeGreaterThan(0);
		expect(opcoes.slice(primeiraBloqueada).every(bloqueada)).toBe(true);

		const permitidas = opcoes.slice(0, primeiraBloqueada).map((opcao) => opcao.name);
		expect(permitidas).toEqual([...permitidas].sort((a, b) => a.localeCompare(b, 'pt-BR')));
	});

	it('o escopo CRUZADO e respeitado: listarAtividades exige atividades:ler', () => {
		// A causa mais comum de "por que esta operacao esta com cadeado?".
		const soContatos = opcoesDeOperacaoComEscopo(contato, conhecidos(['contatos:*']));
		const atividades = soContatos.find((opcao) => opcao.value === 'listarAtividades')!;
		expect(atividades.name).toContain(MARCA_DE_CADEADO);
		expect(atividades.description).toContain('atividades:ler');

		const comAtividades = opcoesDeOperacaoComEscopo(
			contato,
			conhecidos(['contatos:*', 'atividades:ler']),
		);
		expect(comAtividades.find((opcao) => opcao.value === 'listarAtividades')!.name).not.toContain(
			MARCA_DE_CADEADO,
		);
	});

	it('escrever nao destrava leitura no dropdown', () => {
		const opcoes = opcoesDeOperacaoComEscopo(negocio, conhecidos(['negocios:escrever']));
		const nomePorValor = new Map(opcoes.map((opcao) => [opcao.value, opcao.name]));

		expect(nomePorValor.get('criar')).toBe('Criar');
		expect(nomePorValor.get('listar')).toContain(MARCA_DE_CADEADO);
		expect(nomePorValor.get('obter')).toContain(MARCA_DE_CADEADO);
	});

	it('o coringa global libera tudo, sem nenhum cadeado', () => {
		for (const recurso of RECURSOS) {
			for (const opcao of opcoesDeOperacaoComEscopo(recurso, conhecidos(['*']))) {
				expect(opcao.name).not.toContain(MARCA_DE_CADEADO);
			}
		}
	});

	it('FAIL-OPEN: com escopos desconhecidos nada recebe cadeado', () => {
		for (const recurso of RECURSOS) {
			for (const opcao of opcoesDeOperacaoComEscopo(recurso, DESCONHECIDOS)) {
				expect(opcao.name).not.toContain(MARCA_DE_CADEADO);
			}
			expect(recurso.operacoes.every((op) => operacaoPermitida(op, DESCONHECIDOS))).toBe(true);
		}
	});
});

describe('cadeado por escopo na lista de recursos', () => {
	it('o recurso so ganha cadeado quando NENHUMA operacao esta ao alcance', () => {
		// Marcar "Contato" porque falta `contatos:escrever` esconderia que listar
		// continua funcionando.
		const parcial = opcoesDeRecursoComEscopo(conhecidos(['contatos:ler']));
		const nomePorValor = new Map(parcial.map((opcao) => [opcao.value, opcao.name]));

		expect(nomePorValor.get('contato')).toBe('Contato');
		expect(nomePorValor.get('negocio')).toContain(MARCA_DE_CADEADO);
	});

	it('o recurso bloqueado nomeia os escopos envolvidos', () => {
		const opcoes = opcoesDeRecursoComEscopo(conhecidos(['contatos:ler']));
		const negocioBloqueado = opcoes.find((opcao) => opcao.value === 'negocio')!;

		expect(negocioBloqueado.description).toContain('negocios:ler');
		expect(negocioBloqueado.description).toContain('negocios:escrever');
	});

	it('FAIL-OPEN tambem na lista de recursos', () => {
		for (const opcao of opcoesDeRecursoComEscopo(DESCONHECIDOS)) {
			expect(opcao.name).not.toContain(MARCA_DE_CADEADO);
		}
	});
});

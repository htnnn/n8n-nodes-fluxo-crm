import type { INodePropertyOptions } from 'n8n-workflow';
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
import codexDoNode from '../nodes/FluxoCrm/FluxoCrm.node.json';
import { RECURSOS_SONDAVEIS } from '../nodes/FluxoCrmTrigger/catalogo';
import codexDoGatilho from '../nodes/FluxoCrmTrigger/FluxoCrmTrigger.node.json';

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

/**
 * As TRES marcas do bloqueio, conferidas JUNTAS.
 *
 * Uma so nao basta: `disabled` e o que impede o clique em n8n 2.x e e ignorado
 * em 1.x, o cadeado e o unico aviso visivel em 1.x, e a descricao e onde mora o
 * escopo que falta. Conferir uma delas deixaria as outras duas regredirem em
 * silencio.
 */
function esperarBloqueada(opcao: INodePropertyOptions, escopo: string): void {
	expect(opcao.disabled).toBe(true);
	expect(opcao.name.startsWith(MARCA_DE_CADEADO)).toBe(true);
	expect(opcao.description).toContain(escopo);
}

/** A opcao liberada nao carrega NENHUMA das tres. */
function esperarLiberada(opcao: INodePropertyOptions): void {
	expect(opcao.disabled).toBeUndefined();
	expect(opcao.name).not.toContain(MARCA_DE_CADEADO);
	expect(opcao.description ?? '').not.toMatch(/Requer o escopo|Nenhuma operacao deste recurso/);
}

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

describe('achabilidade do Atendimento', () => {
	/**
	 * O `valor` e o que o workflow salvo referencia: mudar um deles quebraria
	 * todo node ja configurado, com o generico `The value "x" is not supported!`.
	 * O `nome` e so o rotulo — e e nele que "Atendimento" precisa estar.
	 */
	const ROTULOS: Record<string, string> = {
		conversa: 'Atendimento › Conversa',
		mensagem: 'Atendimento › Mensagem',
		canalAtendimento: 'Atendimento › Canal',
		agenteAtendimento: 'Atendimento › Atendente',
	};

	it('os quatro recursos mantem o valor e levam "Atendimento" no rotulo', () => {
		for (const [valor, nome] of Object.entries(ROTULOS)) {
			const recurso = encontrarRecurso(valor);
			expect(recurso, valor).toBeDefined();
			expect(recurso!.valor).toBe(valor);
			expect(recurso!.nome).toBe(nome);
		}
		// Todos os recursos, e nao so estes, precisam estar la para o dropdown.
		expect(opcoesEstaticasDeRecurso().map((opcao) => opcao.value)).toEqual(
			expect.arrayContaining(Object.keys(ROTULOS)),
		);
	});

	it('toda operacao desses recursos e achavel por "atendimento" no painel de Actions', () => {
		// O painel busca no `action` e na descricao; o nome do recurso nao entra.
		for (const valor of Object.keys(ROTULOS)) {
			for (const operacao of encontrarRecurso(valor)!.operacoes) {
				const texto = `${operacao.acao} ${operacao.descricao}`.toLowerCase();
				expect(texto, `${valor} › ${operacao.valor}`).toContain('atendimento');
			}
		}
	});

	it('conversa, mensagem e canal citam WhatsApp, que e como o usuario procura', () => {
		for (const valor of ['conversa', 'mensagem', 'canalAtendimento']) {
			const recurso = encontrarRecurso(valor)!;
			const textos = [recurso.descricao, ...recurso.operacoes.flatMap((op) => [op.acao, op.descricao])];
			expect(textos.some((texto) => texto.includes('WhatsApp')), valor).toBe(true);
		}
	});

	it('o gatilho usa os mesmos rotulos para conversa e mensagem', () => {
		const doGatilho = new Map(RECURSOS_SONDAVEIS.map((recurso) => [recurso.valor, recurso.nome]));
		expect(doGatilho.get('conversa')).toBe(ROTULOS.conversa);
		expect(doGatilho.get('mensagem')).toBe(ROTULOS.mensagem);
	});

	it('os dois nodes entram na categoria Communication, alem das que ja tinham', () => {
		for (const codex of [codexDoNode, codexDoGatilho]) {
			expect(codex.categories).toEqual(['Sales', 'Productivity', 'Communication']);
		}
	});
});

describe('cadeado por escopo no dropdown remoto', () => {
	it('a operacao sem escopo sai com disabled E cadeado no nome E o motivo na descricao', () => {
		const opcoes = opcoesDeOperacaoComEscopo(contato, conhecidos(['contatos:ler']));
		const criar = opcoes.find((opcao) => opcao.value === 'criar')!;

		esperarBloqueada(criar, 'contatos:escrever');
		expect(criar.name).toBe(`${MARCA_DE_CADEADO}Criar`);
		expect(criar.description).toMatch(/Requer o escopo/);
	});

	it('TODA operacao bloqueada leva as tres marcas, em todos os recursos', () => {
		for (const recurso of RECURSOS) {
			const opcoes = opcoesDeOperacaoComEscopo(recurso, conhecidos(['contatos:ler']));
			for (const opcao of opcoes) {
				const definicao = recurso.operacoes.find((item) => item.valor === opcao.value)!;
				if (operacaoPermitida(definicao, conhecidos(['contatos:ler']))) {
					esperarLiberada(opcao);
					continue;
				}
				esperarBloqueada(opcao, definicao.escopo as string);
			}
		}
	});

	it('a operacao bloqueada CONTINUA na lista, so que inselecionavel em 2.x', () => {
		// Decisao de desenho: esconder fecharia o dropdown mas deixaria o painel
		// de Actions oferecendo a mesma operacao sem aviso nenhum. Ela fica, com
		// `disabled` para 2.x e cadeado para 1.x.
		const opcoes = opcoesDeOperacaoComEscopo(contato, conhecidos(['contatos:ler']));
		expect(opcoes).toHaveLength(contato.operacoes.length);
		expect(opcoes.map((opcao) => opcao.value)).toContain('excluir');
	});

	it('a operacao permitida nao ganha NENHUMA das tres marcas', () => {
		const opcoes = opcoesDeOperacaoComEscopo(contato, conhecidos(['contatos:ler']));
		const listar = opcoes.find((opcao) => opcao.value === 'listar')!;

		esperarLiberada(listar);
		expect(listar.name).toBe('Listar');
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

	it('FAIL-OPEN: com escopos desconhecidos nada recebe cadeado NEM disabled', () => {
		for (const recurso of RECURSOS) {
			for (const opcao of opcoesDeOperacaoComEscopo(recurso, DESCONHECIDOS)) {
				esperarLiberada(opcao);
			}
			expect(recurso.operacoes.every((op) => operacaoPermitida(op, DESCONHECIDOS))).toBe(true);
		}
	});

	it('as opcoes ESTATICAS nunca levam disabled — o painel de Actions nao sabe de escopo', () => {
		for (const recurso of RECURSOS) {
			for (const opcao of opcoesEstaticasDeOperacao(recurso)) {
				expect(opcao.disabled).toBeUndefined();
			}
		}
		for (const opcao of opcoesEstaticasDeRecurso()) {
			expect(opcao.disabled).toBeUndefined();
		}
	});

	it('as tres marcas sobrevivem a serializacao JSON, que e como o loadOptions viaja', () => {
		// O backend do n8n devolve o retorno do `loadOptions` por REST: se
		// `disabled` nao sobrevivesse ao JSON, a interface nunca o veria.
		const opcoes = opcoesDeOperacaoComEscopo(contato, conhecidos(['contatos:ler']));
		const viajadas = JSON.parse(JSON.stringify(opcoes)) as INodePropertyOptions[];

		esperarBloqueada(viajadas.find((opcao) => opcao.value === 'criar')!, 'contatos:escrever');
		esperarLiberada(viajadas.find((opcao) => opcao.value === 'listar')!);
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

	it('o recurso bloqueado sai com as TRES marcas e nomeia os escopos envolvidos', () => {
		const opcoes = opcoesDeRecursoComEscopo(conhecidos(['contatos:ler']));
		const negocioBloqueado = opcoes.find((opcao) => opcao.value === 'negocio')!;

		esperarBloqueada(negocioBloqueado, 'negocios:ler');
		expect(negocioBloqueado.description).toContain('negocios:escrever');

		// O recurso que ainda tem alguma operacao ao alcance nao leva nenhuma.
		esperarLiberada(opcoes.find((opcao) => opcao.value === 'contato')!);
	});

	it('FAIL-OPEN tambem na lista de recursos: nem cadeado nem disabled', () => {
		for (const opcao of opcoesDeRecursoComEscopo(DESCONHECIDOS)) {
			esperarLiberada(opcao);
		}
	});
});

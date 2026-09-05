import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
	corpoNaoPublicado,
	notasDaVersao,
	promoverNaoPublicado,
	versoesRegistradas,
} from '../scripts/changelog.mjs';

/**
 * O arquivo e `.mjs` de proposito. O `tsconfig.test.json` nao tem `allowJs`,
 * entao o `tsc` ignora este arquivo — e o alvo testado (`scripts/changelog.mjs`)
 * tambem fica fora do `include` do build. O vitest, por outro lado, coleta
 * `*.test.mjs` por padrao. E o unico jeito de cobrir o script de release sem
 * arrasta-lo para dentro do `dist/` publicado.
 */

const CHANGELOG_REAL = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

const EXEMPLO = [
	'# Changelog',
	'',
	'Preambulo qualquer.',
	'',
	'## [Não publicado]',
	'',
	'### Adicionado',
	'',
	'- Coisa nova.',
	'',
	'### Corrigido',
	'',
	'- Coisa velha que quebrava.',
	'',
	'## [0.1.0] - 2026-09-05',
	'',
	'- Primeira versao.',
	'',
	'[Não publicado]: https://github.com/htnnn/n8n-nodes-fluxo-crm/compare/v0.1.0...HEAD',
	'[0.1.0]: https://github.com/htnnn/n8n-nodes-fluxo-crm/releases/tag/v0.1.0',
	'',
].join('\n');

const SO_NAO_PUBLICADO = [
	'# Changelog',
	'',
	'## [Não publicado]',
	'',
	'- Primeira coisa de todas.',
	'',
	'[Não publicado]: https://github.com/htnnn/n8n-nodes-fluxo-crm/compare/v0.0.0...HEAD',
	'',
].join('\n');

describe('leitura do changelog', () => {
	it('devolve o corpo acumulado em [Não publicado]', () => {
		expect(corpoNaoPublicado(EXEMPLO)).toContain('- Coisa nova.');
		expect(corpoNaoPublicado(EXEMPLO)).toContain('### Corrigido');
		expect(corpoNaoPublicado(EXEMPLO)).not.toContain('Primeira versao');
	});

	it('lista as versoes registradas sem incluir [Não publicado]', () => {
		expect(versoesRegistradas(EXEMPLO)).toEqual(['0.1.0']);
	});

	it('devolve as notas de uma versao ja registrada', () => {
		expect(notasDaVersao(EXEMPLO, '0.1.0')).toBe('- Primeira versao.');
	});

	it('reclama de versao que nao existe no arquivo', () => {
		expect(() => notasDaVersao(EXEMPLO, '9.9.9')).toThrow(/nao tem a secao/);
	});
});

describe('promocao de [Não publicado]', () => {
	it('move o corpo para a versao nova, com a data', () => {
		const novo = promoverNaoPublicado(EXEMPLO, '0.2.0', '2026-10-01');

		expect(novo).toContain('## [0.2.0] - 2026-10-01');
		expect(notasDaVersao(novo, '0.2.0')).toBe(corpoNaoPublicado(EXEMPLO));
	});

	it('deixa [Não publicado] vazio e no topo', () => {
		const novo = promoverNaoPublicado(EXEMPLO, '0.2.0', '2026-10-01');

		expect(corpoNaoPublicado(novo)).toBe('');
		expect(novo.indexOf('## [Não publicado]')).toBeLessThan(novo.indexOf('## [0.2.0]'));
	});

	it('preserva as versoes anteriores, na ordem', () => {
		const novo = promoverNaoPublicado(EXEMPLO, '0.2.0', '2026-10-01');

		expect(versoesRegistradas(novo)).toEqual(['0.2.0', '0.1.0']);
		expect(notasDaVersao(novo, '0.1.0')).toBe('- Primeira versao.');
	});

	it('refaz os links de comparacao do rodape', () => {
		const novo = promoverNaoPublicado(EXEMPLO, '0.2.0', '2026-10-01');
		const base = 'https://github.com/htnnn/n8n-nodes-fluxo-crm';

		expect(novo).toContain(`[Não publicado]: ${base}/compare/v0.2.0...HEAD`);
		expect(novo).toContain(`[0.2.0]: ${base}/compare/v0.1.0...v0.2.0`);
		expect(novo).toContain(`[0.1.0]: ${base}/releases/tag/v0.1.0`);
		expect(novo).not.toContain('compare/v0.1.0...HEAD');
	});

	it('usa releases/tag quando nao ha versao anterior', () => {
		const novo = promoverNaoPublicado(SO_NAO_PUBLICADO, '0.1.0', '2026-09-05');

		expect(novo).toContain(
			'[0.1.0]: https://github.com/htnnn/n8n-nodes-fluxo-crm/releases/tag/v0.1.0',
		);
	});

	it('preserva o preambulo', () => {
		const novo = promoverNaoPublicado(EXEMPLO, '0.2.0', '2026-10-01');

		expect(novo.startsWith('# Changelog\n\nPreambulo qualquer.\n')).toBe(true);
	});

	it('termina com uma unica quebra de linha', () => {
		const novo = promoverNaoPublicado(EXEMPLO, '0.2.0', '2026-10-01');

		expect(novo.endsWith('\n')).toBe(true);
		expect(novo.endsWith('\n\n')).toBe(false);
	});

	it('recusa promover quando [Não publicado] esta vazio', () => {
		const vazio = EXEMPLO.replace('### Adicionado\n\n- Coisa nova.\n\n### Corrigido\n\n- Coisa velha que quebrava.\n', '');

		expect(() => promoverNaoPublicado(vazio, '0.2.0', '2026-10-01')).toThrow(/esta vazia/);
	});

	it('recusa promover para uma versao que ja existe', () => {
		expect(() => promoverNaoPublicado(EXEMPLO, '0.1.0', '2026-10-01')).toThrow(/ja tem uma secao/);
	});

	it('recusa promover duas vezes seguidas', () => {
		const novo = promoverNaoPublicado(EXEMPLO, '0.2.0', '2026-10-01');

		expect(() => promoverNaoPublicado(novo, '0.3.0', '2026-10-02')).toThrow(/esta vazia/);
	});

	it('recusa versao e data malformadas', () => {
		expect(() => promoverNaoPublicado(EXEMPLO, 'v0.2.0', '2026-10-01')).toThrow(/Versao invalida/);
		expect(() => promoverNaoPublicado(EXEMPLO, '0.2.0', '01/10/2026')).toThrow(/Data invalida/);
	});
});

describe('o CHANGELOG.md deste repositorio', () => {
	it('tem a secao [Não publicado] e a versao do package.json', () => {
		const pacote = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

		// A secao precisa EXISTIR; conteudo acumulado nela e o estado normal
		// entre releases (Keep a Changelog) — exigir que estivesse vazia criava
		// um beco: o release so promove conteudo commitado com CI verde, e o CI
		// reprovava qualquer commit que adicionasse conteudo.
		expect(CHANGELOG_REAL).toContain('## [Não publicado]');
		expect(versoesRegistradas(CHANGELOG_REAL)).toContain(pacote.version);
	});

	it('tem notas de release utilizaveis para a versao atual', () => {
		const pacote = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
		const notas = notasDaVersao(CHANGELOG_REAL, pacote.version);

		// Uma versao de patch pode ter so "Corrigido" — a 0.1.1 e assim. O que
		// toda versao precisa e de ao menos uma categoria do Keep a Changelog e
		// de texto que diga algo a quem instala.
		expect(notas.length).toBeGreaterThan(100);
		expect(notas).toMatch(
			/^### (Adicionado|Alterado|Descontinuado|Removido|Corrigido|Segurança|Limitações conhecidas)$/m,
		);
		// "Limitações conhecidas" e um contrato do DOCUMENTO, nao de cada versao:
		// as restricoes do servidor precisam estar registradas em algum lugar.
		expect(CHANGELOG_REAL).toContain('### Limitações conhecidas');
	});

	it('e promovivel — o rodape de links tem a forma que o script espera', () => {
		// Com conteudo real acumulado em [Não publicado], promove-o como esta;
		// vazio, injeta um sintetico. Nos dois casos o rodape real e exercitado.
		const conteudoReal = corpoNaoPublicado(CHANGELOG_REAL);
		const base = conteudoReal
			? CHANGELOG_REAL
			: CHANGELOG_REAL.replace(
					'## [Não publicado]\n',
					'## [Não publicado]\n\n### Adicionado\n\n- Teste.\n',
				);
		const esperado = conteudoReal || '### Adicionado\n\n- Teste.';
		const pacote = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
		const novo = promoverNaoPublicado(base, '99.0.0', '2026-10-01');

		expect(notasDaVersao(novo, '99.0.0')).toBe(esperado);
		expect(corpoNaoPublicado(novo)).toBe('');
		expect(novo).toContain(
			`[99.0.0]: https://github.com/htnnn/n8n-nodes-fluxo-crm/compare/v${pacote.version}...v99.0.0`,
		);
		expect(novo).toContain(
			'[Não publicado]: https://github.com/htnnn/n8n-nodes-fluxo-crm/compare/v99.0.0...HEAD',
		);
	});
});

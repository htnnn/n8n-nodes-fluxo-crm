import { describe, expect, it } from 'vitest';

import { resolverVersao } from '../scripts/release.mjs';

/**
 * `scripts/release.mjs` so executa `principal()` quando e o programa; importado
 * daqui, ele apenas expoe as funcoes puras. Ver a guarda EXECUTADO_DIRETO no
 * fim do arquivo.
 */

describe('resolverVersao', () => {
	it('sobe o patch', () => {
		expect(resolverVersao('patch', '0.1.0')).toBe('0.1.1');
		expect(resolverVersao('patch', '1.2.9')).toBe('1.2.10');
	});

	it('sobe o minor e zera o patch', () => {
		expect(resolverVersao('minor', '0.1.7')).toBe('0.2.0');
	});

	it('sobe o major e zera o resto', () => {
		expect(resolverVersao('major', '0.9.9')).toBe('1.0.0');
		expect(resolverVersao('major', '2.4.1')).toBe('3.0.0');
	});

	it('aceita uma versao literal maior que a atual', () => {
		expect(resolverVersao('1.0.0', '0.1.0')).toBe('1.0.0');
		expect(resolverVersao('0.1.1', '0.1.0')).toBe('0.1.1');
		expect(resolverVersao('0.2.0', '0.1.9')).toBe('0.2.0');
	});

	it('aceita a versao igual a atual — e o caso da primeira release', () => {
		expect(resolverVersao('0.1.0', '0.1.0')).toBe('0.1.0');
	});

	it('recusa uma versao menor que a atual', () => {
		expect(() => resolverVersao('0.0.9', '0.1.0')).toThrow(/menor que a atual/);
		expect(() => resolverVersao('1.9.9', '2.0.0')).toThrow(/menor que a atual/);
		expect(() => resolverVersao('0.1.0', '0.1.1')).toThrow(/menor que a atual/);
	});

	it('recusa um tipo que nao existe', () => {
		expect(() => resolverVersao('banana', '0.1.0')).toThrow(/Tipo invalido/);
		expect(() => resolverVersao('v0.2.0', '0.1.0')).toThrow(/Tipo invalido/);
		expect(() => resolverVersao('0.2', '0.1.0')).toThrow(/Tipo invalido/);
	});
});

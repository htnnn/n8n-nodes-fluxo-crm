import { describe, expect, it } from 'vitest';

import { rotuloDoNegocio } from '../nodes/FluxoCrm/metodos/listSearch';

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

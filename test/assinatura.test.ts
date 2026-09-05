import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
	analisarCabecalho,
	assinaturaEsperada,
	TOLERANCIA_DE_REPLAY_SEG,
	verificarAssinatura,
} from '../nodes/FluxoCrmTrigger/assinatura';

const SEGREDO = `whsec_${'ab'.repeat(32)}`;

/**
 * A implementacao do servidor, escrita de novo aqui a partir da especificacao
 * (`t=<unix>,v1=HMAC_SHA256(segredo, "<t>.<corpo>")`) e nao chamando o codigo
 * do node. Se as duas concordarem por engano, o teste nao serviria de nada.
 */
function assinarComoOServidor(segredo: string, corpo: string, t: number): string {
	const v1 = createHmac('sha256', segredo).update(`${t}.${corpo}`, 'utf8').digest('hex');
	return `t=${t},v1=${v1}`;
}

const agoraSeg = 1_800_000_000;

describe('analisarCabecalho', () => {
	it('le o par t/v1', () => {
		const analisado = analisarCabecalho('t=1700000000,v1=abcdef01');
		expect(analisado).toEqual({ t: 1_700_000_000, v1: 'abcdef01' });
	});

	it('tolera espacos e pares desconhecidos', () => {
		const analisado = analisarCabecalho(' t = 1700000000 , v0 = ruido , v1 = ABCDEF ');
		expect(analisado?.t).toBe(1_700_000_000);
		expect(analisado?.v1).toBe('ABCDEF');
	});

	it('recusa v1 que nao e hexadecimal, para que nunca chegue a comparacao', () => {
		expect(analisarCabecalho('t=1700000000,v1=nao-e-hex')).toBeNull();
	});

	it('recusa cabecalho sem t, sem v1, vazio ou de outro tipo', () => {
		expect(analisarCabecalho('v1=abcdef')).toBeNull();
		expect(analisarCabecalho('t=1700000000')).toBeNull();
		expect(analisarCabecalho('')).toBeNull();
		expect(analisarCabecalho(undefined)).toBeNull();
		expect(analisarCabecalho(42)).toBeNull();
	});
});

describe('verificarAssinatura', () => {
	const corpo = JSON.stringify({
		id: 'e2b7c1a0-0000-4000-8000-000000000001',
		evento: 'negocio.ganho',
		criado_em: '2026-09-04T12:00:00.000Z',
		dados: { id: 'd1', estagio_anterior_id: 'e0', estagio_tipo: 'ganho' },
	});
	const corpoBruto = Buffer.from(corpo, 'utf8');

	it('aceita a assinatura que o servidor teria produzido', () => {
		const cabecalho = assinarComoOServidor(SEGREDO, corpo, agoraSeg);
		expect(verificarAssinatura({ segredo: SEGREDO, corpoBruto, cabecalho, agoraSeg })).toEqual({
			valida: true,
		});
	});

	it('recusa assinatura de outro segredo', () => {
		const cabecalho = assinarComoOServidor('whsec_outro', corpo, agoraSeg);
		expect(verificarAssinatura({ segredo: SEGREDO, corpoBruto, cabecalho, agoraSeg })).toEqual({
			valida: false,
			motivo: 'assinatura_incorreta',
		});
	});

	it('recusa quando um unico byte do corpo mudou', () => {
		const cabecalho = assinarComoOServidor(SEGREDO, corpo, agoraSeg);
		const adulterado = Buffer.from(corpo.replace('negocio.ganho', 'negocio.perdi'), 'utf8');
		expect(
			verificarAssinatura({ segredo: SEGREDO, corpoBruto: adulterado, cabecalho, agoraSeg }),
		).toEqual({ valida: false, motivo: 'assinatura_incorreta' });
	});

	it('recusa carimbo mais velho que a janela de 300 segundos', () => {
		const velho = agoraSeg - TOLERANCIA_DE_REPLAY_SEG - 1;
		const cabecalho = assinarComoOServidor(SEGREDO, corpo, velho);
		expect(verificarAssinatura({ segredo: SEGREDO, corpoBruto, cabecalho, agoraSeg })).toEqual({
			valida: false,
			motivo: 'fora_da_janela',
		});
	});

	it('recusa carimbo no futuro alem da janela — relogio adiantado nao vira validade eterna', () => {
		const futuro = agoraSeg + TOLERANCIA_DE_REPLAY_SEG + 1;
		const cabecalho = assinarComoOServidor(SEGREDO, corpo, futuro);
		expect(verificarAssinatura({ segredo: SEGREDO, corpoBruto, cabecalho, agoraSeg })).toEqual({
			valida: false,
			motivo: 'fora_da_janela',
		});
	});

	it('aceita exatamente na borda da janela', () => {
		for (const t of [agoraSeg - TOLERANCIA_DE_REPLAY_SEG, agoraSeg + TOLERANCIA_DE_REPLAY_SEG]) {
			const cabecalho = assinarComoOServidor(SEGREDO, corpo, t);
			expect(verificarAssinatura({ segredo: SEGREDO, corpoBruto, cabecalho, agoraSeg })).toEqual({
				valida: true,
			});
		}
	});

	it('NAO derruba o processo com v1 de comprimento diferente — `timingSafeEqual` levanta nesse caso', () => {
		// A guarda de comprimento e o motivo deste teste existir: sem ela o erro
		// sobe do `webhook()` e o n8n responde 500, que ja e informacao de graca
		// sobre o formato aceito.
		for (const v1 of ['ab', 'a'.repeat(63), 'a'.repeat(65), 'f'.repeat(128)]) {
			const chamada = () =>
				verificarAssinatura({
					segredo: SEGREDO,
					corpoBruto,
					cabecalho: `t=${agoraSeg},v1=${v1}`,
					agoraSeg,
				});
			expect(chamada).not.toThrow();
			expect(chamada()).toEqual({ valida: false, motivo: 'assinatura_incorreta' });
		}
	});

	it('recusa sem segredo, sem corpo bruto e sem cabecalho, cada um com seu motivo', () => {
		const cabecalho = assinarComoOServidor(SEGREDO, corpo, agoraSeg);

		expect(verificarAssinatura({ segredo: '', corpoBruto, cabecalho, agoraSeg })).toEqual({
			valida: false,
			motivo: 'segredo_ausente',
		});
		expect(
			verificarAssinatura({ segredo: SEGREDO, corpoBruto: undefined, cabecalho, agoraSeg }),
		).toEqual({ valida: false, motivo: 'corpo_ausente' });
		expect(
			verificarAssinatura({ segredo: SEGREDO, corpoBruto, cabecalho: undefined, agoraSeg }),
		).toEqual({ valida: false, motivo: 'cabecalho_ausente' });
		expect(
			verificarAssinatura({ segredo: SEGREDO, corpoBruto, cabecalho: 'lixo', agoraSeg }),
		).toEqual({ valida: false, motivo: 'cabecalho_malformado' });
	});
});

describe('a assinatura e calculada sobre o corpo BRUTO, nunca sobre o reserializado', () => {
	// Um corpo cujo `JSON.stringify(JSON.parse(x))` NAO devolve `x`: espacos
	// entre as chaves, escape unicode do "c cedilha" e um numero em notacao
	// cientifica. E exatamente o que um `JSON.stringify(this.getBodyData())`
	// produziria de diferente.
	const bruto = '{"evento": "contato.criado",  "dados": {"nome": "Servi\\u00e7o", "valor": 1.0e2}}';
	const corpoBruto = Buffer.from(bruto, 'utf8');
	const reserializado = JSON.stringify(JSON.parse(bruto));

	it('o reserializado difere do bruto — o teste so vale se isso for verdade', () => {
		expect(reserializado).not.toBe(bruto);
	});

	it('a assinatura do servidor bate com o bruto e NAO bate com o reserializado', () => {
		const cabecalho = assinarComoOServidor(SEGREDO, bruto, agoraSeg);

		expect(verificarAssinatura({ segredo: SEGREDO, corpoBruto, cabecalho, agoraSeg })).toEqual({
			valida: true,
		});

		expect(
			verificarAssinatura({
				segredo: SEGREDO,
				corpoBruto: Buffer.from(reserializado, 'utf8'),
				cabecalho,
				agoraSeg,
			}),
		).toEqual({ valida: false, motivo: 'assinatura_incorreta' });
	});

	it('`assinaturaEsperada` concatena "<t>." aos BYTES recebidos, sem passar por string', () => {
		// Corpo com byte que nao sobrevive a uma conversao ingenua para latin1.
		const bytes = Buffer.from('{"n":"日本語 — ç"}', 'utf8');
		const t = 1_700_000_123;
		const esperado = createHmac('sha256', SEGREDO)
			.update(Buffer.concat([Buffer.from(`${t}.`, 'utf8'), bytes]))
			.digest('hex');

		expect(assinaturaEsperada(SEGREDO, t, bytes)).toBe(esperado);
	});
});

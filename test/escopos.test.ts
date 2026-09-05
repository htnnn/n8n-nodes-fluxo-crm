import { describe, expect, it, vi } from 'vitest';

import {
	CacheDeEscopos,
	ESTADO_DESCONHECIDO,
	extrairEscoposDeCapacidades,
	extrairEscoposDeMe,
	impressaoDaCredencial,
	lerCarimbo,
	montarCarimbo,
	normalizarEscopos,
	resolverEscopos,
	temEscopo,
	TTL_PADRAO_MS,
} from '../nodes/FluxoCrm/compartilhado/escopos';

const BASE = 'https://api-crm.nafluxo.com.br/v1';

function respostaDeMe(escopos: string[]) {
	return {
		organizacao: { id: 'org-1', nome: 'Acme', slug: 'acme' },
		chave: { id: 'chave-1', escopos, limite_por_minuto: 120 },
		ator: { usuario_id: 'u-1' },
		versao: 'v1',
	};
}

describe('temEscopo — replica a regra do servidor', () => {
	it('o coringa global "*" satisfaz qualquer requisito', () => {
		expect(temEscopo(['*'], 'contatos:escrever')).toBe(true);
		expect(temEscopo(['*'], 'negocios:ler')).toBe(true);
		expect(temEscopo(['*'], 'atividades:ler')).toBe(true);
	});

	it('o coringa de recurso cobre as duas acoes daquele recurso, e so daquele', () => {
		expect(temEscopo(['contatos:*'], 'contatos:ler')).toBe(true);
		expect(temEscopo(['contatos:*'], 'contatos:escrever')).toBe(true);
		expect(temEscopo(['contatos:*'], 'negocios:ler')).toBe(false);
		expect(temEscopo(['contatos:*'], 'atividades:ler')).toBe(false);
	});

	it('escrever NAO implica ler', () => {
		expect(temEscopo(['contatos:escrever'], 'contatos:ler')).toBe(false);
		expect(temEscopo(['negocios:escrever'], 'negocios:ler')).toBe(false);
	});

	it('ler nao implica escrever', () => {
		expect(temEscopo(['contatos:ler'], 'contatos:escrever')).toBe(false);
	});

	it('o escopo exato satisfaz', () => {
		expect(temEscopo(['contatos:ler', 'negocios:ler'], 'negocios:ler')).toBe(true);
	});

	it('lista vazia, nula ou nao-array nunca satisfaz', () => {
		expect(temEscopo([], 'contatos:ler')).toBe(false);
		expect(temEscopo(null, 'contatos:ler')).toBe(false);
		expect(temEscopo(undefined, 'contatos:ler')).toBe(false);
	});

	it('normaliza caixa e espaco de borda antes de comparar', () => {
		expect(temEscopo([' Contatos:Ler '], 'contatos:ler')).toBe(true);
		expect(temEscopo(['contatos:ler'], ' CONTATOS:LER ')).toBe(true);
	});

	it('nao inventa hierarquia entre recursos', () => {
		// `contato:listarAtividades` consome `atividades:ler`, nao `contatos:ler`.
		expect(temEscopo(['contatos:ler'], 'atividades:ler')).toBe(false);
	});
});

describe('normalizarEscopos', () => {
	it('descarta nao-strings, vazios e duplicados', () => {
		expect(normalizarEscopos(['contatos:ler', ' contatos:ler ', '', 7, null])).toEqual([
			'contatos:ler',
		]);
	});

	it('devolve lista vazia para entrada que nao e array', () => {
		expect(normalizarEscopos('contatos:ler')).toEqual([]);
		expect(normalizarEscopos(undefined)).toEqual([]);
	});
});

describe('impressaoDaCredencial', () => {
	it('credenciais diferentes produzem impressoes diferentes', () => {
		expect(impressaoDaCredencial(BASE, 'flx_live_a')).not.toBe(
			impressaoDaCredencial(BASE, 'flx_live_b'),
		);
	});

	it('a mesma chave em instancias diferentes produz impressoes diferentes', () => {
		expect(impressaoDaCredencial(BASE, 'flx_live_a')).not.toBe(
			impressaoDaCredencial('https://outra.example.com/v1', 'flx_live_a'),
		);
	});

	it('a barra final da URL nao muda a impressao', () => {
		expect(impressaoDaCredencial(`${BASE}/`, 'flx_live_a')).toBe(
			impressaoDaCredencial(BASE, 'flx_live_a'),
		);
	});

	it('a chave nunca aparece em claro na impressao', () => {
		const impressao = impressaoDaCredencial(BASE, 'flx_live_segredo');
		expect(impressao).not.toContain('segredo');
		expect(impressao).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('carimbo persistido na credencial', () => {
	it('o carimbo volta a virar estado quando a impressao bate', () => {
		const impressao = impressaoDaCredencial(BASE, 'flx_live_a');
		const carimbo = montarCarimbo(impressao, {
			conhecidos: true,
			escopos: ['contatos:ler', 'negocios:*'],
			origem: 'me',
		});

		expect(lerCarimbo(carimbo, impressao)).toEqual({
			conhecidos: true,
			escopos: ['contatos:ler', 'negocios:*'],
			origem: 'credencial',
		});
	});

	it('TROCAR A CHAVE invalida o carimbo: os escopos da chave antiga nao sobrevivem', () => {
		const antiga = impressaoDaCredencial(BASE, 'flx_live_antiga');
		const nova = impressaoDaCredencial(BASE, 'flx_live_nova');

		const carimbo = montarCarimbo(antiga, {
			conhecidos: true,
			escopos: ['*'],
			origem: 'me',
		});

		expect(lerCarimbo(carimbo, nova)).toBeNull();
	});

	it('o carimbo de "desconhecido" nunca e lido como escopo conhecido', () => {
		const impressao = impressaoDaCredencial(BASE, 'flx_live_a');
		expect(lerCarimbo(montarCarimbo(impressao, ESTADO_DESCONHECIDO), impressao)).toBeNull();
	});

	it('carimbo ausente, vazio ou de outra versao e ignorado', () => {
		const impressao = impressaoDaCredencial(BASE, 'flx_live_a');
		expect(lerCarimbo(undefined, impressao)).toBeNull();
		expect(lerCarimbo('', impressao)).toBeNull();
		expect(lerCarimbo(`v0|${impressao}|ok|contatos:ler`, impressao)).toBeNull();
	});
});

describe('extracao de escopos das respostas', () => {
	it('le a forma confirmada de GET /me', () => {
		expect(extrairEscoposDeMe(respostaDeMe(['contatos:ler']))).toEqual(['contatos:ler']);
	});

	it('devolve null quando a resposta nao tem a forma esperada', () => {
		expect(extrairEscoposDeMe({ chave: {} })).toBeNull();
		expect(extrairEscoposDeMe(null)).toBeNull();
		expect(extrairEscoposDeMe('ok')).toBeNull();
	});

	it('aceita as tres formas plausiveis de /capabilities e recusa o resto', () => {
		expect(extrairEscoposDeCapacidades({ escopos: ['meta:ler'] })).toEqual(['meta:ler']);
		expect(extrairEscoposDeCapacidades(respostaDeMe(['meta:ler']))).toEqual(['meta:ler']);
		expect(extrairEscoposDeCapacidades({ escopos: { concedidos: ['meta:ler'] } })).toEqual([
			'meta:ler',
		]);
		expect(extrairEscoposDeCapacidades({ modulos: [] })).toBeNull();
	});
});

describe('resolverEscopos', () => {
	const impressaoA = impressaoDaCredencial(BASE, 'flx_live_a');
	const impressaoB = impressaoDaCredencial(BASE, 'flx_live_b');

	it('prefere /capabilities e nem chega a /me', async () => {
		const buscarContexto = vi.fn();
		const estado = await resolverEscopos({
			impressao: impressaoA,
			cache: new CacheDeEscopos(),
			fontes: {
				buscarCapacidades: async () => ({ escopos: ['contatos:ler'] }),
				buscarContexto,
			},
		});

		expect(estado).toEqual({
			conhecidos: true,
			escopos: ['contatos:ler'],
			origem: 'capabilities',
		});
		expect(buscarContexto).not.toHaveBeenCalled();
	});

	it('cai para /me quando /capabilities nao existe (404)', async () => {
		const estado = await resolverEscopos({
			impressao: impressaoA,
			cache: new CacheDeEscopos(),
			fontes: {
				buscarCapacidades: async () => {
					throw new Error('404');
				},
				buscarContexto: async () => respostaDeMe(['negocios:*']),
			},
		});

		expect(estado.conhecidos).toBe(true);
		expect(estado.escopos).toEqual(['negocios:*']);
		expect(estado.origem).toBe('me');
	});

	it('usa o carimbo da credencial sem tocar na rede', async () => {
		const buscarCapacidades = vi.fn();
		const buscarContexto = vi.fn();

		const estado = await resolverEscopos({
			impressao: impressaoA,
			carimbo: montarCarimbo(impressaoA, {
				conhecidos: true,
				escopos: ['meta:ler'],
				origem: 'me',
			}),
			cache: new CacheDeEscopos(),
			fontes: { buscarCapacidades, buscarContexto },
		});

		expect(estado.escopos).toEqual(['meta:ler']);
		expect(estado.origem).toBe('credencial');
		expect(buscarCapacidades).not.toHaveBeenCalled();
		expect(buscarContexto).not.toHaveBeenCalled();
	});

	it('rebusca quando o carimbo pertence a OUTRA chave', async () => {
		const buscarContexto = vi.fn(async () => respostaDeMe(['contatos:ler']));

		const estado = await resolverEscopos({
			impressao: impressaoB,
			// Carimbo gerado para a chave A, com escopo total.
			carimbo: montarCarimbo(impressaoA, {
				conhecidos: true,
				escopos: ['*'],
				origem: 'me',
			}),
			cache: new CacheDeEscopos(),
			fontes: {
				buscarCapacidades: async () => {
					throw new Error('404');
				},
				buscarContexto,
			},
		});

		expect(buscarContexto).toHaveBeenCalledTimes(1);
		expect(estado.escopos).toEqual(['contatos:ler']);
		expect(temEscopo(estado.escopos, 'negocios:escrever')).toBe(false);
	});

	it('FAIL-OPEN: com /capabilities e /me falhando, os escopos ficam desconhecidos', async () => {
		const estado = await resolverEscopos({
			impressao: impressaoA,
			cache: new CacheDeEscopos(),
			fontes: {
				buscarCapacidades: async () => {
					throw new Error('sem rede');
				},
				buscarContexto: async () => {
					throw new Error('403 escopo_insuficiente');
				},
			},
		});

		expect(estado.conhecidos).toBe(false);
		expect(estado.escopos).toEqual([]);
		expect(estado.origem).toBe('indisponivel');
	});

	it('resposta em formato inesperado tambem cai no fail-open, sem lancar', async () => {
		const estado = await resolverEscopos({
			impressao: impressaoA,
			cache: new CacheDeEscopos(),
			fontes: {
				buscarCapacidades: async () => ({ qualquer: 'coisa' }),
				buscarContexto: async () => ({ nada: 'aqui' }),
			},
		});

		expect(estado.conhecidos).toBe(false);
	});

	it('ISOLAMENTO ENTRE TENANTS: o cache nao entrega os escopos de uma credencial a outra', async () => {
		const cache = new CacheDeEscopos();

		const primeira = await resolverEscopos({
			impressao: impressaoA,
			cache,
			fontes: {
				buscarCapacidades: async () => ({ escopos: ['*'] }),
				buscarContexto: async () => respostaDeMe(['*']),
			},
		});

		const segunda = await resolverEscopos({
			impressao: impressaoB,
			cache,
			fontes: {
				buscarCapacidades: async () => ({ escopos: ['contatos:ler'] }),
				buscarContexto: async () => respostaDeMe(['contatos:ler']),
			},
		});

		expect(primeira.escopos).toEqual(['*']);
		expect(segunda.escopos).toEqual(['contatos:ler']);
		expect(temEscopo(segunda.escopos, 'negocios:escrever')).toBe(false);
	});

	it('a segunda chamada da mesma credencial vem do cache, sem rede', async () => {
		const cache = new CacheDeEscopos();
		const buscarCapacidades = vi.fn(async () => ({ escopos: ['meta:ler'] }));

		const fontes = {
			buscarCapacidades,
			buscarContexto: async () => respostaDeMe(['meta:ler']),
		};

		await resolverEscopos({ impressao: impressaoA, cache, fontes });
		const segunda = await resolverEscopos({ impressao: impressaoA, cache, fontes });

		expect(buscarCapacidades).toHaveBeenCalledTimes(1);
		expect(segunda.origem).toBe('cache');
	});

	it('o cache expira e a descoberta e refeita', async () => {
		const cache = new CacheDeEscopos();
		const buscarCapacidades = vi.fn(async () => ({ escopos: ['meta:ler'] }));
		let relogio = 1_000;

		const parametros = {
			impressao: impressaoA,
			cache,
			agora: () => relogio,
			fontes: {
				buscarCapacidades,
				buscarContexto: async () => respostaDeMe(['meta:ler']),
			},
		};

		await resolverEscopos(parametros);
		relogio += TTL_PADRAO_MS + 1;
		await resolverEscopos(parametros);

		expect(buscarCapacidades).toHaveBeenCalledTimes(2);
	});
});

describe('CacheDeEscopos', () => {
	it('respeita o teto de entradas descartando a mais antiga', () => {
		const cache = new CacheDeEscopos(2);
		const estado = { conhecidos: true, escopos: ['meta:ler'], origem: 'me' as const };

		cache.guardar('a', estado, 0);
		cache.guardar('b', estado, 0);
		cache.guardar('c', estado, 0);

		expect(cache.tamanho).toBe(2);
		expect(cache.obter('a', 0)).toBeUndefined();
		expect(cache.obter('c', 0)).toBeDefined();
	});

	it('entrada expirada e removida na leitura', () => {
		const cache = new CacheDeEscopos();
		cache.guardar('a', { conhecidos: true, escopos: [], origem: 'me' }, 0, 10);

		expect(cache.obter('a', 5)).toBeDefined();
		expect(cache.obter('a', 20)).toBeUndefined();
		expect(cache.tamanho).toBe(0);
	});
});

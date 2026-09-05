import { createHash } from 'node:crypto';

/**
 * Resolucao de escopos da chave de API do Fluxo CRM.
 *
 * Este modulo e deliberadamente livre de dependencias do n8n: ele so conhece
 * strings, promessas e relogio. Toda a ligacao com `ILoadOptionsFunctions` /
 * `IExecuteFunctions` mora em `capacidades.ts`. E o que torna a regra de
 * escopo — a parte que, errada, vaza permissao entre organizacoes — testavel
 * sem levantar um n8n.
 */

/** De onde veio a lista de escopos que estamos usando agora. */
export type OrigemDosEscopos = 'capabilities' | 'me' | 'credencial' | 'cache' | 'indisponivel';

export interface EstadoDeEscopos {
	/**
	 * `false` significa "nao foi possivel descobrir os escopos desta chave".
	 * Nesse estado NADA pode ser bloqueado na interface: a descoberta falhar
	 * nao pode travar quem tem permissao (fail-open).
	 */
	conhecidos: boolean;
	escopos: string[];
	origem: OrigemDosEscopos;
}

export const ESTADO_DESCONHECIDO: EstadoDeEscopos = {
	conhecidos: false,
	escopos: [],
	origem: 'indisponivel',
};

/** Normaliza um escopo solto. Devolve `null` para qualquer coisa que nao seja texto util. */
export function normalizarEscopo(valor: unknown): string | null {
	if (typeof valor !== 'string') return null;
	const limpo = valor.trim().toLowerCase();
	return limpo.length > 0 ? limpo : null;
}

/** Normaliza e deduplica uma lista de escopos vinda da API. */
export function normalizarEscopos(entrada: unknown): string[] {
	if (!Array.isArray(entrada)) return [];
	const vistos = new Set<string>();
	for (const bruto of entrada) {
		const escopo = normalizarEscopo(bruto);
		if (escopo !== null) vistos.add(escopo);
	}
	return [...vistos];
}

/**
 * Replica `temEscopo` do servidor (`apps/api/src/api-publica/escopos.ts`).
 *
 * Regras que NAO podem ser "melhoradas" aqui:
 * - `*` e coringa global;
 * - `recurso:*` cobre `recurso:ler` e `recurso:escrever`, e so daquele recurso;
 * - `escrever` NAO implica `ler` — e decisao explicita do servidor, para que uma
 *   chave de formulario que so empurra dado nao consiga varrer a base.
 */
export function temEscopo(
	escoposDaChave: readonly string[] | null | undefined,
	requerido: string,
): boolean {
	if (!Array.isArray(escoposDaChave) || escoposDaChave.length === 0) return false;

	const alvo = normalizarEscopo(requerido);
	if (alvo === null) return false;

	const concedidos = normalizarEscopos(escoposDaChave as unknown[]);
	if (concedidos.includes('*')) return true;
	if (concedidos.includes(alvo)) return true;

	const recurso = alvo.split(':')[0];
	return concedidos.includes(`${recurso}:*`);
}

/**
 * Impressao digital da credencial: SHA-256 de `baseUrl` + chave.
 *
 * A classe do node e singleton do processo n8n, compartilhada entre todos os
 * usuarios e workflows da instancia. Qualquer cache chaveado pela chave em
 * claro — ou pior, por nada — vaza escopos entre organizacoes. Aqui a chave
 * nunca sai do hash, e a `baseUrl` entra no material porque a mesma chave
 * apontada para outra instancia e outra credencial.
 */
export function impressaoDaCredencial(baseUrl: unknown, apiKey: unknown): string {
	const url = typeof baseUrl === 'string' ? baseUrl.trim().replace(/\/+$/, '') : '';
	const chave = typeof apiKey === 'string' ? apiKey : '';
	return createHash('sha256').update(`${url}\n${chave}`).digest('hex');
}

const VERSAO_DO_CARIMBO = 'v1';

/**
 * Monta o valor guardado no campo `expirable` da credencial.
 *
 * Formato: `v1|<impressao>|<estado>|<escopos separados por espaco>`.
 *
 * A impressao vai junto porque trocar a chave de API NAO invalida o valor
 * guardado (medido no spike: os escopos da chave antiga sobreviveram, e nem o
 * teste de credencial corrigiu). Sem o carimbo, o node filtraria a interface
 * contra os escopos de uma chave que ja nao existe.
 */
export function montarCarimbo(impressao: string, estado: EstadoDeEscopos): string {
	const situacao = estado.conhecidos ? 'ok' : 'desconhecido';
	return [VERSAO_DO_CARIMBO, impressao, situacao, estado.escopos.join(' ')].join('|');
}

/**
 * Le o carimbo guardado na credencial.
 *
 * Devolve `null` quando o carimbo esta ausente, e de outra versao, ou foi
 * gerado para OUTRA chave — e nesse caso quem chamou precisa rebuscar.
 */
export function lerCarimbo(carimbo: unknown, impressaoAtual: string): EstadoDeEscopos | null {
	if (typeof carimbo !== 'string' || carimbo.length === 0) return null;

	const partes = carimbo.split('|');
	if (partes.length < 4) return null;

	const [versao, impressao, situacao] = partes;
	if (versao !== VERSAO_DO_CARIMBO) return null;
	if (impressao !== impressaoAtual) return null;
	if (situacao !== 'ok') return null;

	const escopos = normalizarEscopos(partes.slice(3).join('|').split(' '));
	return { conhecidos: true, escopos, origem: 'credencial' };
}

export const TTL_PADRAO_MS = 5 * 60 * 1000;
export const TTL_INDISPONIVEL_MS = 60 * 1000;
export const TETO_DE_ENTRADAS = 500;

interface EntradaDeCache {
	estado: EstadoDeEscopos;
	expiraEm: number;
}

/**
 * Cache em processo, chaveado pela impressao da credencial e com teto de
 * entradas — um `Map` sem teto num processo n8n de vida longa cresce ate a
 * memoria acabar.
 */
export class CacheDeEscopos {
	private readonly entradas = new Map<string, EntradaDeCache>();

	constructor(private readonly teto: number = TETO_DE_ENTRADAS) {}

	obter(impressao: string, agora: number): EstadoDeEscopos | undefined {
		const entrada = this.entradas.get(impressao);
		if (entrada === undefined) return undefined;
		if (entrada.expiraEm <= agora) {
			this.entradas.delete(impressao);
			return undefined;
		}
		return entrada.estado;
	}

	guardar(
		impressao: string,
		estado: EstadoDeEscopos,
		agora: number,
		ttlMs: number = TTL_PADRAO_MS,
	): void {
		// Reinsere para que a entrada mais recente fique no fim da ordem de
		// iteracao do Map — e o descarte abaixo tire sempre a mais antiga.
		this.entradas.delete(impressao);
		this.entradas.set(impressao, { estado, expiraEm: agora + ttlMs });

		while (this.entradas.size > this.teto) {
			const maisAntiga = this.entradas.keys().next();
			if (maisAntiga.done === true) break;
			this.entradas.delete(maisAntiga.value);
		}
	}

	invalidar(impressao: string): void {
		this.entradas.delete(impressao);
	}

	limpar(): void {
		this.entradas.clear();
	}

	get tamanho(): number {
		return this.entradas.size;
	}
}

/** Cache compartilhado do processo. Chaveado por credencial, nunca global. */
export const cacheDeEscopos = new CacheDeEscopos();

function comoObjeto(valor: unknown): Record<string, unknown> | null {
	return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
		? (valor as Record<string, unknown>)
		: null;
}

/**
 * Extrai a lista de escopos de uma resposta de `GET /me`.
 *
 * Forma confirmada em `origin/main` (`rotas/meta.ts`):
 * `{ organizacao, chave: { id, escopos, limite_por_minuto }, ator, versao }`.
 */
export function extrairEscoposDeMe(resposta: unknown): string[] | null {
	const raiz = comoObjeto(resposta);
	if (raiz === null) return null;
	const chave = comoObjeto(raiz.chave);
	if (chave === null) return null;
	if (!Array.isArray(chave.escopos)) return null;
	return normalizarEscopos(chave.escopos);
}

/**
 * Extrai a lista de escopos de `GET /capabilities`.
 *
 * A forma exata do endpoint NAO esta verificada — ele estava sendo criado
 * quando este node foi escrito. Por isso aceitamos os tres formatos plausiveis
 * (`escopos` na raiz, `chave.escopos` como em `/me`, ou `escopos.concedidos`) e
 * devolvemos `null` quando nenhum casa, o que empurra o fluxo para o fallback.
 */
export function extrairEscoposDeCapacidades(resposta: unknown): string[] | null {
	const raiz = comoObjeto(resposta);
	if (raiz === null) return null;

	if (Array.isArray(raiz.escopos)) return normalizarEscopos(raiz.escopos);

	const doMe = extrairEscoposDeMe(raiz);
	if (doMe !== null) return doMe;

	const aninhado = comoObjeto(raiz.escopos);
	if (aninhado !== null && Array.isArray(aninhado.concedidos)) {
		return normalizarEscopos(aninhado.concedidos);
	}

	return null;
}

export interface FontesDeEscopo {
	/** `GET /capabilities` — fonte primaria quando existe. */
	buscarCapacidades: () => Promise<unknown>;
	/** `GET /me` — fallback para instancia com API anterior ao `/capabilities`. */
	buscarContexto: () => Promise<unknown>;
}

export interface ParametrosDeResolucao {
	impressao: string;
	fontes: FontesDeEscopo;
	/** Valor guardado no campo `expirable` da credencial, se houver. */
	carimbo?: unknown;
	cache?: CacheDeEscopos;
	agora?: () => number;
	registrarAviso?: (mensagem: string) => void;
}

/**
 * Resolve os escopos da chave percorrendo as camadas, nesta ordem:
 *
 * 1. cache em processo (chaveado pela impressao da credencial);
 * 2. carimbo persistido na credencial, se a impressao ainda bate;
 * 3. `GET /capabilities`;
 * 4. `GET /me`;
 * 5. fail-open — "escopos desconhecidos", e nada e marcado com cadeado.
 */
export async function resolverEscopos(parametros: ParametrosDeResolucao): Promise<EstadoDeEscopos> {
	const { impressao, fontes, carimbo } = parametros;
	const cache = parametros.cache ?? cacheDeEscopos;
	const agora = parametros.agora ?? (() => Date.now());
	const avisar = parametros.registrarAviso ?? (() => undefined);

	const emCache = cache.obter(impressao, agora());
	if (emCache !== undefined) {
		return { ...emCache, origem: 'cache' };
	}

	const doCarimbo = lerCarimbo(carimbo, impressao);
	if (doCarimbo !== null) {
		cache.guardar(impressao, doCarimbo, agora());
		return doCarimbo;
	}

	try {
		const escopos = extrairEscoposDeCapacidades(await fontes.buscarCapacidades());
		if (escopos !== null) {
			const estado: EstadoDeEscopos = { conhecidos: true, escopos, origem: 'capabilities' };
			cache.guardar(impressao, estado, agora());
			return estado;
		}
		avisar('GET /capabilities respondeu num formato inesperado; usando GET /me.');
	} catch {
		// 404 numa instancia com API anterior ao /capabilities e o caso comum.
		// Qualquer outra falha tambem cai para /me — quem decide bloquear e o
		// servidor, nao a descoberta.
	}

	try {
		const escopos = extrairEscoposDeMe(await fontes.buscarContexto());
		if (escopos !== null) {
			const estado: EstadoDeEscopos = { conhecidos: true, escopos, origem: 'me' };
			cache.guardar(impressao, estado, agora());
			return estado;
		}
		avisar('GET /me respondeu num formato inesperado; nenhuma operacao sera bloqueada.');
	} catch {
		// Uma chave legitima sem `meta:ler` recebe 403 aqui. Bloquear tudo por
		// causa disso seria travar o usuario por um problema que nao e dele.
		avisar(
			'Nao foi possivel descobrir os escopos da chave; nenhuma operacao sera bloqueada na interface.',
		);
	}

	cache.guardar(impressao, ESTADO_DESCONHECIDO, agora(), TTL_INDISPONIVEL_MS);
	return ESTADO_DESCONHECIDO;
}

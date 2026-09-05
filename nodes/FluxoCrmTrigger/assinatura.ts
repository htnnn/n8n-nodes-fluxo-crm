import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verificacao da assinatura HMAC das entregas do Fluxo CRM.
 *
 * Esquema Stripe, replicado de `api-publica/webhooks.ts`:
 *
 *     X-Fluxo-Signature: t=<unix_segundos>,v1=<hex>
 *     v1 = HMAC_SHA256(segredo, "<t>.<corpo bruto>")
 *
 * Este modulo e deliberadamente livre de dependencias do n8n: ele so conhece
 * `Buffer`, string e relogio. E o que torna a parte que, errada, deixa qualquer
 * um disparar o workflow — testavel sem levantar um n8n.
 *
 * O helper equivalente do proprio n8n
 * (`packages/nodes-base/utils/webhook-signature-verification.ts`) NAO e
 * importavel de um node comunitario: `n8n-nodes-base` nao esta na lista de
 * modulos permitidos na n8n Cloud (regra `no-restricted-imports`), e o pacote
 * nao publica esse caminho. `node:crypto` esta na lista e e embutido, entao
 * replicar aqui nao acrescenta dependencia nenhuma.
 */

/** Tolerancia de replay do servidor, em segundos (`TOLERANCIA_ASSINATURA_SEG`). */
export const TOLERANCIA_DE_REPLAY_SEG = 300;

export const CABECALHO_DE_ASSINATURA = 'x-fluxo-signature';
export const CABECALHO_DE_EVENTO = 'x-fluxo-evento';
export const CABECALHO_DE_ENTREGA = 'x-fluxo-entrega';

export type MotivoDaRecusa =
	| 'segredo_ausente'
	| 'corpo_ausente'
	| 'cabecalho_ausente'
	| 'cabecalho_malformado'
	| 'fora_da_janela'
	| 'assinatura_incorreta';

export type Veredicto = { valida: true } | { valida: false; motivo: MotivoDaRecusa };

/** Texto curto para o log e para o corpo da resposta 401. Nunca cita o segredo. */
export const MOTIVOS_LEGIVEIS: Record<MotivoDaRecusa, string> = {
	segredo_ausente:
		'Este node nao tem o segredo do webhook guardado. Desative e reative o workflow para registrar a assinatura de novo — o segredo so e devolvido na criacao.',
	corpo_ausente:
		'A requisicao chegou sem corpo bruto, e a assinatura e calculada sobre os bytes originais. Nao ha como verificar.',
	cabecalho_ausente: 'Requisicao sem o cabecalho X-Fluxo-Signature.',
	cabecalho_malformado: 'O cabecalho X-Fluxo-Signature nao esta no formato t=<unix>,v1=<hex>.',
	fora_da_janela: `O carimbo de tempo da assinatura esta fora da janela de ${TOLERANCIA_DE_REPLAY_SEG} segundos.`,
	assinatura_incorreta: 'A assinatura nao confere com o segredo deste webhook.',
};

export interface CabecalhoAnalisado {
	/** Unix em SEGUNDOS, como o servidor assina. */
	t: number;
	v1: string;
}

/**
 * Le `t=...,v1=...`.
 *
 * Tolera espacos e pares extras (o esquema do Stripe preve `v0`, `v2`... um dia),
 * e recusa `v1` que nao seja hexadecimal — assim uma string arbitraria nunca
 * chega a `timingSafeEqual`.
 */
export function analisarCabecalho(cabecalho: unknown): CabecalhoAnalisado | null {
	if (typeof cabecalho !== 'string' || cabecalho.trim() === '') return null;

	const partes: Record<string, string> = {};
	for (const pedaco of cabecalho.split(',')) {
		const corte = pedaco.indexOf('=');
		if (corte === -1) continue;
		partes[pedaco.slice(0, corte).trim()] = pedaco.slice(corte + 1).trim();
	}

	const t = Number(partes.t);
	const v1 = partes.v1 ?? '';
	if (!Number.isFinite(t) || v1 === '') return null;
	if (!/^[0-9a-fA-F]+$/.test(v1)) return null;

	return { t, v1 };
}

/**
 * O `v1` que o servidor teria calculado.
 *
 * O material assinado e `"<t>." + corpo`, e o corpo entra como os BYTES
 * recebidos. Dois `update` concatenados sao o mesmo material de um `Buffer`
 * unico, sem a copia.
 */
export function assinaturaEsperada(
	segredo: string,
	timestampSeg: number,
	corpoBruto: Buffer,
): string {
	return createHmac('sha256', segredo)
		.update(Buffer.from(`${timestampSeg}.`, 'utf8'))
		.update(corpoBruto)
		.digest('hex');
}

export interface ParametrosDeVerificacao {
	segredo: unknown;
	/**
	 * Os bytes EXATOS do corpo (`req.rawBody`).
	 *
	 * Nunca `JSON.stringify(req.body)`: reserializar reordena nada mas reescreve
	 * espacos, escapes unicode e a notacao de numeros — e um unico byte diferente
	 * faz o HMAC nunca bater. O corpo bruto e a unica entrada correta.
	 */
	corpoBruto: unknown;
	cabecalho: unknown;
	/** Unix em segundos. Injetavel para o teste da janela de replay. */
	agoraSeg?: number;
	toleranciaSeg?: number;
}

export function verificarAssinatura(parametros: ParametrosDeVerificacao): Veredicto {
	const { segredo, corpoBruto, cabecalho } = parametros;
	const agoraSeg = parametros.agoraSeg ?? Math.floor(Date.now() / 1000);
	const toleranciaSeg = parametros.toleranciaSeg ?? TOLERANCIA_DE_REPLAY_SEG;

	if (typeof segredo !== 'string' || segredo === '') {
		return { valida: false, motivo: 'segredo_ausente' };
	}
	if (!Buffer.isBuffer(corpoBruto)) {
		return { valida: false, motivo: 'corpo_ausente' };
	}
	if (typeof cabecalho !== 'string' || cabecalho.trim() === '') {
		return { valida: false, motivo: 'cabecalho_ausente' };
	}

	const analisado = analisarCabecalho(cabecalho);
	if (analisado === null) {
		return { valida: false, motivo: 'cabecalho_malformado' };
	}

	// A janela vai para os DOIS lados: um `t` no futuro tambem e recusado, porque
	// aceita-lo daria a quem forjasse um relogio adiantado uma assinatura com
	// validade indefinida.
	if (Math.abs(agoraSeg - analisado.t) > toleranciaSeg) {
		return { valida: false, motivo: 'fora_da_janela' };
	}

	const esperado = Buffer.from(assinaturaEsperada(segredo, analisado.t, corpoBruto), 'utf8');
	const recebido = Buffer.from(analisado.v1, 'utf8');

	// `timingSafeEqual` LEVANTA quando os buffers tem tamanhos diferentes — e um
	// `v1` curto e a primeira coisa que um atacante tenta. Sem esta guarda, o
	// erro sobe do webhook e o n8n responde 500, que e informacao de graca sobre
	// o formato aceito. O comprimento do hex nao e segredo, entao compara-lo
	// diretamente nao vaza nada.
	if (esperado.length !== recebido.length) {
		return { valida: false, motivo: 'assinatura_incorreta' };
	}

	return timingSafeEqual(esperado, recebido)
		? { valida: true }
		: { valida: false, motivo: 'assinatura_incorreta' };
}

/**
 * Espelho local de `validarUrlWebhook` do servidor (`api-publica/webhooks.ts`).
 *
 * O servidor recusa a mesma coisa e revalida a cada entrega, entao esta copia
 * nao acrescenta seguranca. Ela existe pela MENSAGEM: a URL de webhook do n8n
 * e gerada pelo proprio n8n a partir de `WEBHOOK_URL`/`N8N_HOST`, e numa
 * instalacao local ela sai como `http://localhost:5678/webhook/...`. Sem esta
 * conferencia o usuario recebe um 422 generico de "URL de webhook invalida" e
 * nao tem como saber que o problema e a configuracao da propria instancia — nem
 * que o modo Sondagem existe justamente para esse caso.
 */

const HOSTS_BLOQUEADOS = new Set([
	'localhost',
	'metadata.google.internal',
	'metadata',
	'instance-data',
]);

export type ProblemaDeDestino =
	| 'malformada'
	| 'sem_https'
	| 'credenciais_embutidas'
	| 'host_interno'
	| 'rede_privada';

export type VeredictoDeDestino =
	| { aceitavel: true }
	| { aceitavel: false; problema: ProblemaDeDestino; motivo: string };

function ehIpPrivado(host: string): boolean {
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (v4 !== null) {
		const a = Number(v4[1]);
		const b = Number(v4[2]);
		if (a === 0 || a === 10 || a === 127) return true;
		if (a === 169 && b === 254) return true; // link-local + metadata de AWS/GCP
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
		return false;
	}

	const v6 = host.toLowerCase();
	if (v6 === '::1' || v6 === '::') return true;
	if (v6.startsWith('fc') || v6.startsWith('fd')) return true; // ULA
	if (v6.startsWith('fe80')) return true; // link-local

	// IPv4 mapeado. `new URL()` normaliza `::ffff:127.0.0.1` para a forma
	// hexadecimal `::ffff:7f00:1`, entao conferir so a forma pontilhada deixaria
	// passar exatamente o desvio que esta funcao existe para fechar.
	if (v6.startsWith('::ffff:')) {
		const resto = v6.slice(7);
		if (resto.includes('.')) return ehIpPrivado(resto);

		const grupos = resto.split(':');
		if (grupos.length === 2) {
			const alto = Number.parseInt(grupos[0], 16);
			const baixo = Number.parseInt(grupos[1], 16);
			if (Number.isFinite(alto) && Number.isFinite(baixo)) {
				return ehIpPrivado(
					`${(alto >> 8) & 255}.${alto & 255}.${(baixo >> 8) & 255}.${baixo & 255}`,
				);
			}
		}
		// Forma de IPv4 mapeado que nao sabemos decompor: negar por precaucao.
		return true;
	}

	return false;
}

export function conferirDestino(bruto: unknown): VeredictoDeDestino {
	if (typeof bruto !== 'string' || bruto.trim() === '') {
		return { aceitavel: false, problema: 'malformada', motivo: 'URL vazia.' };
	}

	let url: URL;
	try {
		url = new URL(bruto);
	} catch {
		return { aceitavel: false, problema: 'malformada', motivo: 'URL malformada.' };
	}

	if (url.protocol !== 'https:') {
		return {
			aceitavel: false,
			problema: 'sem_https',
			motivo: 'A API do Fluxo CRM so entrega em HTTPS.',
		};
	}
	if (url.username !== '' || url.password !== '') {
		return {
			aceitavel: false,
			problema: 'credenciais_embutidas',
			motivo: 'Credenciais embutidas na URL nao sao aceitas.',
		};
	}

	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
	if (HOSTS_BLOQUEADOS.has(host) || host.endsWith('.local') || host.endsWith('.internal')) {
		return {
			aceitavel: false,
			problema: 'host_interno',
			motivo: 'Destino interno nao e permitido.',
		};
	}
	if (ehIpPrivado(host)) {
		return {
			aceitavel: false,
			problema: 'rede_privada',
			motivo: 'Endereco de rede privada nao e permitido.',
		};
	}

	return { aceitavel: true };
}

/** O que fazer a respeito, dito na lingua de quem esta olhando a tela do n8n. */
export const COMO_RESOLVER =
	'A URL de webhook e gerada por esta instancia do n8n. Publique-a num dominio HTTPS acessivel pela internet (variavel de ambiente WEBHOOK_URL, ou um tunel como o do n8n Cloud), ou troque o Modo para "Sondagem Periodica", que nao precisa de endereco publico.';

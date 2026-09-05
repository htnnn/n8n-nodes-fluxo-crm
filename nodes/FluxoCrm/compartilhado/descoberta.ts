import { resumoDoErro } from './transporte';

/**
 * O que deu errado na DESCOBERTA — `/capabilities`, `/me` e as listas de
 * `/modulos`, `/usuarios`, `/equipes`, `/etiquetas`, `/pipelines`.
 *
 * Antes, qualquer falha dessas rotas virava a mesma frase ("confira a
 * conectividade"), inclusive o 404 de uma instancia com API anterior ao
 * `/capabilities` — que nao e problema de rede nenhum. Aqui cada desfecho tem
 * nome, status e a frase que corresponde a ele, e nada e adivinhado: o que
 * decide e o status HTTP que a API devolveu (ou nao devolveu).
 *
 * Modulo puro: nao conhece o n8n em runtime. A ligacao com o transporte e so
 * `resumoDoErro`, que le status e codigo de qualquer forma de erro.
 */

export type MotivoDaDescoberta =
	/** Uma rota respondeu 404: a instancia nao a tem (ou a URL base esta sem `/v1`). */
	| 'endpoint_ausente'
	/** Todas as rotas tentadas responderam 404: a API do servidor e anterior a elas. */
	| 'instancia_desatualizada'
	/** 401: a chave nao foi aceita. */
	| 'credencial_recusada'
	/** 403: a chave foi aceita, mas nao pode ver aquilo. */
	| 'sem_permissao'
	/** Sem status HTTP nenhum: DNS, recusa de conexao, timeout. */
	| 'conectividade'
	/** Qualquer outro status (5xx, 429...): a API respondeu, mas nao o que se esperava. */
	| 'resposta_inesperada';

export class ErroDeDescoberta extends Error {
	readonly motivo: MotivoDaDescoberta;
	/** Caminhos relativos a URL base (`/capabilities`, `/me`...). */
	readonly rotas: readonly string[];
	readonly status: number | undefined;

	constructor(
		motivo: MotivoDaDescoberta,
		rotas: readonly string[],
		status: number | undefined,
		mensagem: string,
	) {
		super(mensagem);
		this.name = 'ErroDeDescoberta';
		this.motivo = motivo;
		this.rotas = rotas;
		this.status = status;
	}
}

/** `/capabilities` → `/v1/capabilities`, que e como a rota aparece na documentacao. */
function rotaPublica(rota: string): string {
	return `/v1${rota}`;
}

/** O que sobrou de legivel num erro sem status: `ECONNREFUSED`, `ETIMEDOUT`, a mensagem. */
function causaLegivel(erro: unknown): string {
	const raiz = typeof erro === 'object' && erro !== null ? (erro as Record<string, unknown>) : {};
	const causa =
		typeof raiz.cause === 'object' && raiz.cause !== null
			? (raiz.cause as Record<string, unknown>)
			: {};

	for (const candidato of [causa.code, raiz.code, causa.message, raiz.message]) {
		if (typeof candidato === 'string' && candidato.trim() !== '') return candidato.trim();
	}
	return 'sem resposta';
}

/** O 404 de uma rota, sozinho — a forma que `buscarCapacidades` memoriza. */
export function endpointAusente(rota: string): ErroDeDescoberta {
	return new ErroDeDescoberta(
		'endpoint_ausente',
		[rota],
		404,
		`A API nao respondeu em ${rotaPublica(rota)} (HTTP 404): esta instancia do Fluxo CRM esta desatualizada, ou a URL base da credencial nao termina no prefixo de versao (/v1).`,
	);
}

/**
 * Classifica uma falha de requisicao pelo status que a API devolveu.
 *
 * Aceita o erro em qualquer forma que o transporte produza — o `NodeApiError`
 * de `erroDaApi`, o objeto cru do helper do n8n, um `Error` de rede — porque
 * `resumoDoErro` olha tambem a `cause`. O codigo da API (`chave_invalida`,
 * `escopo_insuficiente`...) entra na frase quando existe, para que a mensagem
 * diga o que o servidor disse, e nao o que este node supoe.
 */
export function classificarFalhaDeDescoberta(erro: unknown, rota: string): ErroDeDescoberta {
	if (erro instanceof ErroDeDescoberta) return erro;

	const { status, codigo } = resumoDoErro(erro);
	const detalhe = codigo === '' ? '' : `, ${codigo}`;
	const onde = rotaPublica(rota);

	if (status === 404) return endpointAusente(rota);

	if (status === 401) {
		return new ErroDeDescoberta(
			'credencial_recusada',
			[rota],
			401,
			`A chave de API foi recusada em ${onde} (HTTP 401${detalhe}). Confira se a chave foi copiada inteira e se ainda esta ativa; se nao, gere uma nova em Configuracoes › Integracoes no Fluxo CRM.`,
		);
	}

	if (status === 403) {
		return new ErroDeDescoberta(
			'sem_permissao',
			[rota],
			403,
			`A chave de API nao tem permissao para ${onde} (HTTP 403${detalhe}). Gere uma chave com o escopo exigido em Configuracoes › Integracoes no Fluxo CRM, ou libere o IP desta instancia se a chave restringe origem.`,
		);
	}

	if (status === undefined) {
		return new ErroDeDescoberta(
			'conectividade',
			[rota],
			undefined,
			`Nao foi possivel falar com a API do Fluxo CRM em ${onde} (${causaLegivel(erro)}). Confira a URL base da credencial e a conectividade desta instancia do n8n.`,
		);
	}

	if (status === 429) {
		return new ErroDeDescoberta(
			'resposta_inesperada',
			[rota],
			429,
			`A API do Fluxo CRM recusou ${onde} por excesso de requisicoes (HTTP 429${detalhe}). O limite e POR CHAVE de API (padrao: 120 por minuto), entao ele conta tambem o que outros fluxos e outras instancias do n8n fazem com a mesma chave. Aguarde e tente de novo, ou use uma chave propria para este ambiente.`,
		);
	}

	return new ErroDeDescoberta(
		'resposta_inesperada',
		[rota],
		status,
		`A API do Fluxo CRM respondeu HTTP ${status} em ${onde}${detalhe === '' ? '' : ` (${codigo})`}. O servidor esta no ar, mas nao atendeu esta rota; se persistir, e do lado do CRM.`,
	);
}

/** Do mais especifico ao menos: o que decide a frase quando mais de uma rota falhou. */
const PRIORIDADE: readonly MotivoDaDescoberta[] = [
	'credencial_recusada',
	'sem_permissao',
	'conectividade',
	'resposta_inesperada',
	'instancia_desatualizada',
	'endpoint_ausente',
];

/**
 * Resume as falhas de uma descoberta que tentou mais de uma rota.
 *
 * Todas 404 → a instancia e anterior a todas elas, e a frase nomeia as rotas
 * ("nao expoe /v1/capabilities nem /v1/me"). Um unico 404 mantem a frase
 * daquela rota, que tambem cita a URL base como causa possivel. Fora isso,
 * vale a falha mais especifica: uma credencial recusada explica tudo o que
 * veio depois dela; um 404 no `/capabilities` seguido de 403 no `/me` e um
 * problema de permissao, nao de versao.
 */
export function diagnosticarDescoberta(falhas: readonly ErroDeDescoberta[]): ErroDeDescoberta {
	if (falhas.length === 0) {
		throw new Error('diagnosticarDescoberta exige ao menos uma falha');
	}

	const todasAusentes = falhas.every(
		(falha) => falha.motivo === 'endpoint_ausente' || falha.motivo === 'instancia_desatualizada',
	);
	if (todasAusentes) {
		const rotas = [...new Set(falhas.flatMap((falha) => falha.rotas))];
		if (rotas.length === 1) return falhas[0];
		return new ErroDeDescoberta(
			'instancia_desatualizada',
			rotas,
			404,
			`Esta instancia do Fluxo CRM esta desatualizada: a API nao expoe ${rotas
				.map(rotaPublica)
				.join(' nem ')}. Atualize a API do CRM.`,
		);
	}

	for (const motivo of PRIORIDADE) {
		const achada = falhas.find((falha) => falha.motivo === motivo);
		if (achada !== undefined) return achada;
	}
	return falhas[0];
}

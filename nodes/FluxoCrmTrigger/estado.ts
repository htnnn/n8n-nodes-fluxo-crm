import type { IDataObject } from 'n8n-workflow';

/**
 * O estado durável do node (`getWorkflowStaticData('node')`).
 *
 * REGRA QUE NAO PODE SER QUEBRADA: mutar o objeto NO LUGAR, nunca substitui-lo.
 * As versoes recentes do n8n comparam um snapshot tirado antes da execucao com
 * o objeto no fim dela para decidir se persistem; trocar a referencia (ou
 * fazer `Object.assign` num objeto novo) faz o diff nao enxergar mudanca
 * nenhuma, e o `webhookId` — ou a marca d'agua — se perde no reinicio.
 *
 * Por isso todas as funcoes aqui recebem o proprio objeto devolvido pelo n8n e
 * escrevem/`delete`am chaves dele.
 */

export const CHAVE_DO_ID = 'webhookId';
export const CHAVE_DO_SEGREDO = 'webhookSecret';
export const CHAVE_DA_MARCA = 'ultimaMarcaMs';
export const CHAVE_DA_MARCA_LEGIVEL = 'ultimaMarca';
export const CHAVE_DOS_IDS_NA_MARCA = 'idsNaMarca';

export interface RegistroDoWebhook {
	id: string;
	segredo: string;
}

export function lerRegistroDoWebhook(estado: IDataObject): Partial<RegistroDoWebhook> {
	return {
		id: typeof estado[CHAVE_DO_ID] === 'string' ? (estado[CHAVE_DO_ID] as string) : undefined,
		segredo:
			typeof estado[CHAVE_DO_SEGREDO] === 'string'
				? (estado[CHAVE_DO_SEGREDO] as string)
				: undefined,
	};
}

export function gravarRegistroDoWebhook(estado: IDataObject, registro: RegistroDoWebhook): void {
	estado[CHAVE_DO_ID] = registro.id;
	estado[CHAVE_DO_SEGREDO] = registro.segredo;
}

/**
 * Apaga id E segredo.
 *
 * Os dois SEMPRE juntos. Limpar so o id deixaria um segredo orfao que a
 * proxima criacao sobrescreve — inofensivo; limpar so o segredo deixaria um id
 * cujo `checkExists` responde "existe" e um `webhook()` que recusa toda entrega
 * por `segredo_ausente`, que e um workflow ativo e mudo. E esquecer os dois no
 * 404 poe a ativacao em laco: `checkExists` acha o id, o servidor devolve 404,
 * `checkExists` responde false, `create` grava outro id, e na ativacao seguinte
 * tudo se repete.
 */
export function esquecerWebhook(estado: IDataObject): void {
	delete estado[CHAVE_DO_ID];
	delete estado[CHAVE_DO_SEGREDO];
}

export interface MarcaDagua {
	/** Instante da ultima coisa ja emitida, em ms epoch. `undefined` = nunca sondou. */
	ms?: number;
	/**
	 * Ids ja emitidos cujo instante e EXATAMENTE `ms`.
	 *
	 * Os filtros de data da API sao `>=`, nao `>`: sondar de novo com a mesma
	 * marca traz o registro da fronteira outra vez. Guardar os ids daquele
	 * instante e o que impede o item duplicado — e e mais seguro que somar 1 ms
	 * a marca, que perderia o registro gravado no mesmo milissegundo.
	 */
	ids: string[];
}

export function lerMarca(estado: IDataObject): MarcaDagua {
	const ms = estado[CHAVE_DA_MARCA];
	const ids = estado[CHAVE_DOS_IDS_NA_MARCA];
	return {
		ms: typeof ms === 'number' && Number.isFinite(ms) ? ms : undefined,
		ids: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [],
	};
}

/** Teto de ids guardados na fronteira. Protege o estado durável de crescer sem fim. */
export const TETO_DE_IDS_NA_MARCA = 200;

export function gravarMarca(estado: IDataObject, marca: MarcaDagua): void {
	if (marca.ms === undefined) return;
	estado[CHAVE_DA_MARCA] = marca.ms;
	estado[CHAVE_DA_MARCA_LEGIVEL] = new Date(marca.ms).toISOString();
	estado[CHAVE_DOS_IDS_NA_MARCA] = marca.ids.slice(0, TETO_DE_IDS_NA_MARCA);
}

/** Ms epoch de um campo de data da API, ou `undefined` quando nao da para ler. */
export function instante(valor: unknown): number | undefined {
	if (typeof valor !== 'string' || valor.trim() === '') return undefined;
	const ms = Date.parse(valor);
	return Number.isFinite(ms) ? ms : undefined;
}

import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * A mesma regex que a API usa (`api-publica/rotas/comum.ts`).
 *
 * Validar localmente importa porque UUID malformado devolve **404**, nunca 422:
 * sem esta guarda, um erro de digitacao chega ao usuario como "nao encontrado",
 * indistinguivel de um registro que existe em outra organizacao.
 */
export const REGEX_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(valor: unknown): boolean {
	return typeof valor === 'string' && REGEX_UUID.test(valor);
}

export function exigirUuid(
	ctx: IExecuteFunctions,
	valor: unknown,
	rotulo: string,
	itemIndex: number,
): string {
	if (ehUuid(valor)) return (valor as string).toLowerCase();

	throw new NodeOperationError(ctx.getNode(), `O identificador de ${rotulo} nao e um UUID valido`, {
		description: `Recebido: ${JSON.stringify(valor)}. A API do Fluxo CRM devolve 404 (e nao 422) para UUID malformado, entao este node confere o formato antes de enviar.`,
		itemIndex,
	});
}

/**
 * Le um `resourceLocator` ja extraido e confere o formato.
 *
 * O modo `url` da tela do CRM traz o id no ultimo segmento; a extracao fica na
 * propria definicao da propriedade (`extractValue`), aqui so validamos.
 */
export function idDoLocalizador(
	ctx: IExecuteFunctions,
	nomeDoParametro: string,
	rotulo: string,
	itemIndex: number,
): string {
	const bruto = ctx.getNodeParameter(nomeDoParametro, itemIndex, undefined, {
		extractValue: true,
	});
	return exigirUuid(ctx, bruto, rotulo, itemIndex);
}

/**
 * Converte uma data para ISO em UTC com `Z`.
 *
 * A API aceita offset na maioria dos filtros, mas `deadline` de atividade usa
 * `z.string().datetime()`, que exige `Z` e recusa `-03:00` — e o `dateTime` do
 * n8n emite offset local por padrao. Converter na entrada evita um 422 que o
 * usuario nao teria como diagnosticar.
 */
export function paraUtc(valor: unknown): string | undefined {
	if (typeof valor !== 'string' || valor.trim() === '') return undefined;
	const data = new Date(valor);
	if (Number.isNaN(data.getTime())) return undefined;
	return data.toISOString();
}

/**
 * Quebra a entrada de etiquetas do mesmo jeito que o servidor quebra.
 *
 * Cada string recebida e re-dividida por `;` e `,` no servidor, entao
 * `"VIP, Urgente"` vira DUAS etiquetas. Dividir aqui tambem faz o que sai do
 * node ser exatamente o que o servidor vai gravar — e nao uma surpresa.
 */
export function listaDeEtiquetas(valor: unknown): string[] | undefined {
	if (valor === undefined || valor === null) return undefined;

	const brutos = Array.isArray(valor) ? valor : [valor];
	const nomes: string[] = [];
	const vistos = new Set<string>();

	for (const bruto of brutos) {
		if (typeof bruto !== 'string') continue;
		for (const pedaco of bruto.split(/[;,]/)) {
			const nome = pedaco.trim();
			if (nome === '' || vistos.has(nome)) continue;
			vistos.add(nome);
			nomes.push(nome);
		}
	}

	return nomes.length > 0 ? nomes : undefined;
}

/** Quebra um campo de texto em lista por virgula ou ponto e virgula. */
export function listaDeTexto(valor: unknown): string[] | undefined {
	if (typeof valor !== 'string' || valor.trim() === '') return undefined;
	const itens = valor
		.split(/[;,]/)
		.map((item) => item.trim())
		.filter((item) => item !== '');
	return itens.length > 0 ? itens : undefined;
}

/**
 * Minuscula o e-mail antes de enviar.
 *
 * Ha um defeito medido no ramo de update do upsert de contatos: ele nao aplica
 * `toLowerCase()`, enquanto `GET /contatos?email=` compara por igualdade exata
 * contra o valor ja minusculo. Um contato atualizado por upsert com maiusculas
 * deixa de ser encontravel por esse filtro.
 */
export function emailNormalizado(valor: unknown): string | undefined {
	if (typeof valor !== 'string') return undefined;
	const limpo = valor.trim().toLowerCase();
	return limpo === '' ? undefined : limpo;
}

/** Remove chaves `undefined` — mandar `undefined` num JSON vira chave ausente mesmo. */
export function semIndefinidos(objeto: IDataObject): IDataObject {
	const saida: IDataObject = {};
	for (const [chave, valor] of Object.entries(objeto)) {
		if (valor !== undefined) saida[chave] = valor;
	}
	return saida;
}

/**
 * Le um campo `json` da interface e devolve um objeto plano.
 *
 * Aceita tanto o objeto ja resolvido por expressao quanto o texto digitado.
 */
export function objetoDeJson(
	ctx: IExecuteFunctions,
	valor: unknown,
	rotulo: string,
	itemIndex: number,
): IDataObject | undefined {
	if (valor === undefined || valor === null || valor === '') return undefined;

	let candidato: unknown = valor;
	if (typeof valor === 'string') {
		const texto = valor.trim();
		if (texto === '' || texto === '{}') return undefined;
		try {
			candidato = JSON.parse(texto);
		} catch {
			throw new NodeOperationError(ctx.getNode(), `${rotulo} nao e um JSON valido`, {
				description: 'Informe um objeto JSON, por exemplo {"camiseta": "M"}',
				itemIndex,
			});
		}
	}

	if (typeof candidato !== 'object' || candidato === null || Array.isArray(candidato)) {
		throw new NodeOperationError(ctx.getNode(), `${rotulo} precisa ser um objeto JSON`, {
			description: 'Listas e valores soltos nao sao aceitos neste campo',
			itemIndex,
		});
	}

	const objeto = candidato as IDataObject;
	return Object.keys(objeto).length > 0 ? objeto : undefined;
}

/**
 * Move `campos_ignorados` / `campos_invalidos` para `__avisos` e registra no log.
 *
 * Essas rotas devolvem 2xx tendo descartado dado que o usuario mandou: chave
 * desconhecida e removida antes do zod (por isso o `.strict()` quase nunca
 * dispara em contatos) e valor que nao passa no saneamento e removido, nao
 * anulado. Sao a unica prova de que um 201 perdeu dado — descarta-los seria
 * apagar a evidencia.
 */
export function propagarAvisos(ctx: IExecuteFunctions, saida: IDataObject): IDataObject {
	const avisos: IDataObject = {};

	if (Array.isArray(saida.campos_ignorados) && saida.campos_ignorados.length > 0) {
		avisos.camposIgnorados = saida.campos_ignorados;
	}
	if (Array.isArray(saida.campos_invalidos) && saida.campos_invalidos.length > 0) {
		avisos.camposInvalidos = saida.campos_invalidos;
	}

	if (Object.keys(avisos).length === 0) return saida;

	ctx.logger.warn(
		`[Fluxo CRM] O servidor aceitou a gravacao mas descartou dado: ${JSON.stringify(avisos)}`,
	);
	return { ...saida, __avisos: avisos };
}

/** Le a chave de idempotencia das opcoes e devolve o cabecalho, se houver. */
export function cabecalhoDeIdempotencia(valor: unknown): Record<string, string> {
	if (typeof valor !== 'string') return {};
	const chave = valor.trim();
	if (chave === '' || chave.length > 255) return {};
	return { 'Idempotency-Key': chave };
}

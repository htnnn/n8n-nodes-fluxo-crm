import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { regrasDeSistema, rotuloDaEscrita, separarCamposDeSistema } from './mapeador';

/** Um objeto plano, ou `{}` para qualquer outra coisa. */
export function objeto(valor: unknown): IDataObject {
	return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
		? (valor as IDataObject)
		: {};
}

/** Uma string, ou `''` para qualquer outra coisa. */
export function texto(valor: unknown): string {
	return typeof valor === 'string' ? valor : '';
}

/**
 * Um item de saida com `pairedItem`.
 *
 * Sempre por aqui: sem `pairedItem`, o n8n perde o rastro de qual entrada
 * produziu qual saida e as expressoes `$('No').item` do resto do workflow param
 * de resolver.
 */
export function itemDeSaida(json: IDataObject, i: number): INodeExecutionData {
	return { json, pairedItem: { item: i } };
}

/**
 * Le uma `collection` da interface e devolve o corpo, sem as chaves vazias.
 *
 * String vazia e descartada porque a interface do n8n produz `''` para todo
 * campo que o usuario acrescentou e nao preencheu — mandar isso viraria
 * "grave string vazia", que quase nunca e a intencao. Quem quiser limpar um
 * campo usa uma expressao com `null`, que passa.
 */
export function corpoDaColecao(
	ctx: IExecuteFunctions,
	nome: string,
	i: number,
	transformar?: (chave: string, valor: unknown) => unknown,
): IDataObject {
	const colecao = objeto(ctx.getNodeParameter(nome, i, {}));
	const corpo: IDataObject = {};

	for (const [chave, bruto] of Object.entries(colecao)) {
		if (bruto === undefined || bruto === '') continue;
		const valor = transformar === undefined ? bruto : transformar(chave, bruto);
		if (valor === undefined || valor === '') continue;
		corpo[chave] = valor as IDataObject[string];
	}

	return corpo;
}

/** Le os itens de um `fixedCollection` de multiplos valores. */
export function itensDaColecao(ctx: IExecuteFunctions, nome: string, i: number): IDataObject[] {
	const bruto = objeto(ctx.getNodeParameter(nome, i, {}));
	return Array.isArray(bruto.itens) ? (bruto.itens as IDataObject[]) : [];
}

/** Le a secao unica de um `fixedCollection` de item unico. */
export function secaoUnica(ctx: IExecuteFunctions, nome: string, i: number): IDataObject {
	return objeto(objeto(ctx.getNodeParameter(nome, i, {})).campos);
}

/**
 * Le o slug do modulo e recusa o que a API nao aceitaria no path.
 *
 * O slug entra na URL, entao um valor com barra montaria outra rota — e a
 * mensagem de erro seria sobre uma rota que o usuario nao pediu.
 */
export function slugDoModulo(ctx: IExecuteFunctions, nome: string, i: number): string {
	const bruto = texto(ctx.getNodeParameter(nome, i, '')).trim();

	if (bruto === '' || !/^[a-z0-9][a-z0-9_-]*$/i.test(bruto)) {
		throw new NodeOperationError(ctx.getNode(), 'O slug do modulo nao e valido', {
			description: `Recebido: ${JSON.stringify(bruto)}. Informe o slug como aparece em "Listar Modulos" (por exemplo negocios, contatos ou tarefas).`,
			itemIndex: i,
		});
	}

	return bruto;
}

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

export interface EnvelopeDeEscrita {
	/** O que vai em `valores`/`dados`; `undefined` quando nao sobrou campo do layout. */
	blob: IDataObject | undefined;
	/** Campos de sistema gravaveis, ja conferidos, para o primeiro nivel do corpo. */
	topo: IDataObject;
}

export interface OpcoesDoEnvelope {
	/** Recurso da tabela de escrita: `contato`, `empresa`, `negocio`, `registro`, `atividade`. */
	recurso: string;
	/** Operacao da tabela: `criar`, `atualizar`, `criarOuAtualizar`. */
	operacao: string;
	/** Onde o usuario deve informar o campo que a operacao recusa. */
	orientacao?: string;
}

/**
 * Separa o que o mapeador devolveu em `valores`/`dados` (campos do layout) e
 * primeiro nivel do corpo (campos de sistema), recusando o que a rota nao
 * aceita.
 *
 * O dicionario anuncia responsavel, equipe e os quatro campos de auditoria
 * junto dos campos do layout, mas eles NAO vivem em `valores`/`dados`: o
 * servidor le `dono_id`, `responsavel_id` e `equipe_id` no topo do corpo, e os
 * schemas sao `.strict()`. Deixa-los dentro do blob gravaria lixo em silencio
 * — e mandar um que a rota nao aceita no topo devolveria 422. As duas saidas
 * erradas viram erro nomeado aqui, antes de qualquer requisicao.
 *
 * `blob` volta `undefined` quando so vieram campos de sistema, e nunca `{}`:
 * em `dados`, um objeto vazio APAGA todos os campos personalizados.
 *
 * `null` NAO passa em todo campo aceito. Ele so limpa o valor onde o schema
 * declara `.nullable()` — `equipe_id` em Registro, `responsavel_id` em Contato
 * e Empresa. `dono_id` e `z.string().uuid().optional()` em `registros.ts` e
 * `negocios.ts` (criar e upsert): `optional()` aceita a AUSENCIA da chave, e
 * `null` reprova com 422. A tabela em `mapeador.ts` guarda essa diferenca por
 * (rota × campo) e a recusa acontece aqui, antes da requisicao.
 */
export function envelopeDeEscrita(
	ctx: IExecuteFunctions,
	i: number,
	mapeado: IDataObject | undefined,
	opcoes: OpcoesDoEnvelope,
): EnvelopeDeEscrita {
	if (mapeado === undefined) return { blob: undefined, topo: {} };

	const { doLayout, deSistema, somenteLeitura } = separarCamposDeSistema(mapeado);

	if (somenteLeitura.length > 0) {
		throw new NodeOperationError(
			ctx.getNode(),
			`Campo somente leitura no corpo: ${somenteLeitura.join(', ')}`,
			{
				description:
					'Criado em/por e atualizado em/por sao preenchidos pelo servidor. Eles servem para leitura e para mapear a saida, nunca para escrita — tire-os do mapeador de campos.',
				itemIndex: i,
			},
		);
	}

	const regras = regrasDeSistema(opcoes.recurso, opcoes.operacao);
	const rotulo = rotuloDaEscrita(opcoes.recurso, opcoes.operacao);

	const topo: IDataObject = {};
	for (const [chave, valor] of Object.entries(deSistema)) {
		const regra = regras[chave];
		if (regra === undefined || !regra.aceito) {
			throw new NodeOperationError(
				ctx.getNode(),
				`Esta operacao nao aceita o campo de sistema "${chave}"`,
				{
					description:
						opcoes.orientacao ??
						`A rota desta operacao nao recebe ${chave}, nem no topo do corpo nem dentro dos valores. Tire-o do mapeador de campos.`,
					itemIndex: i,
				},
			);
		}
		if (valor === null && !regra.anulavel) {
			throw new NodeOperationError(
				ctx.getNode(),
				`"${rotulo}" nao aceita vazio no campo de sistema "${chave}"`,
				{
					description: `O schema desta rota declara ${chave} como opcional, mas NAO anulavel: mandar vazio devolve 422. Para deixar o campo sem valor, tire-o do mapeador de campos — a ausencia da chave e o que o servidor entende como "nao mexer".`,
					itemIndex: i,
				},
			);
		}
		// `null` chega aqui so onde a rota o aceita: e como se limpa o responsavel
		// ou a equipe. Texto tem de ser UUID — a API devolve 404 (e nao 422) para
		// identificador malformado.
		topo[chave] = typeof valor === 'string' ? exigirUuid(ctx, valor, chave, i) : valor;
	}

	return { blob: Object.keys(doLayout).length > 0 ? doLayout : undefined, topo };
}

/**
 * Poe os campos de sistema do mapeador no primeiro nivel do corpo.
 *
 * O mesmo campo pode vir por dois caminhos — "Campos Adicionais" e o mapeador
 * — e escolher um deles em silencio gravaria o valor que o usuario nao viu.
 * Valores iguais passam; diferentes param a execucao nomeando o campo.
 */
export function aplicarNoTopo(
	ctx: IExecuteFunctions,
	i: number,
	corpo: IDataObject,
	topo: IDataObject,
): void {
	for (const [chave, valor] of Object.entries(topo)) {
		const atual = corpo[chave];
		const informado = atual !== undefined && atual !== '';
		const iguais =
			typeof atual === 'string' && typeof valor === 'string'
				? atual.trim().toLowerCase() === valor.toLowerCase()
				: atual === valor;

		if (informado && !iguais) {
			throw new NodeOperationError(
				ctx.getNode(),
				`O campo "${chave}" foi informado duas vezes com valores diferentes`,
				{
					description: `Ele veio num campo proprio do painel e tambem no mapeador de campos, com valores que nao batem. Preencha-o num lugar so.`,
					itemIndex: i,
				},
			);
		}
		corpo[chave] = valor;
	}
}

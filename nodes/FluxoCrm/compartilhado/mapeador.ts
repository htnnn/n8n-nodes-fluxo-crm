import type {
	FieldType,
	IDataObject,
	INodePropertyOptions,
	ResourceMapperField,
} from 'n8n-workflow';

/**
 * Traducao do dicionario de campos de um modulo para o `resourceMapper`.
 *
 * POR QUE UM MAPPER, E NAO UM CAMPO JSON. A obrigatoriedade de cada campo vem
 * do LAYOUT DA ORGANIZACAO, nao do codigo da API: o mesmo POST devolve 201 numa
 * org e 422 noutra (`api-publica/campos-obrigatorios.ts`, que consulta
 * `campos.obrigatorio` filtrando por `modulos.orgId`). Nao existe lista de
 * obrigatorios que o node possa chumbar. O `resourceMapper` e a unica forma de
 * o usuario ver, em tempo de EDICAO e na org daquela credencial, quais campos
 * o servidor vai cobrar — antes de a automacao rodar em producao.
 *
 * Fonte: `GET /modulos/{slug}/campos`, que devolve por campo
 * `{id, slug, nome, tipo, obrigatorio, unico, is_primario, valor_padrao,
 *   opcoes, validacoes, secao, ordem}`.
 *
 * Modulo puro: nao conhece o n8n em runtime, so os tipos.
 */

/**
 * `tipo` da API → `FieldType` do n8n.
 *
 * Os 24 valores literais vem de `tipoCampoEnum` (`db/schema/modulos.ts`). O que
 * nao estiver aqui cai em `string`, que e o unico default que nunca impede a
 * gravacao: um campo novo do CRM aparece como texto em vez de sumir do painel.
 */
const TIPO_POR_CAMPO: Record<string, FieldType> = {
	texto: 'string',
	texto_rico: 'string',
	url: 'string',
	email: 'string',
	telefone: 'string',
	instagram: 'string',
	codigo_barras: 'string',
	criptografado: 'string',
	numero: 'number',
	moeda: 'number',
	autonumerico: 'number',
	booleano: 'boolean',
	data: 'dateTime',
	selecao: 'options',
	multiselecao: 'array',
	lista: 'array',
	referencia: 'string',
	conectado_a: 'string',
	usuario: 'string',
	arquivo: 'string',
	subformulario: 'object',
	geolocalizacao: 'object',
};

/**
 * Campos derivados pelo servidor. Escrever neles nao tem efeito, entao eles
 * ficam FORA do mapper — oferecer um campo que o servidor descarta ensina a
 * regra errada.
 */
const TIPOS_DERIVADOS = new Set(['formula', 'agregacao']);

/** Campos que o servidor preenche sozinho e o usuario nao deve editar. */
const TIPOS_SOMENTE_LEITURA = new Set(['autonumerico']);

function texto(valor: unknown): string {
	return typeof valor === 'string' ? valor : '';
}

function objeto(valor: unknown): IDataObject {
	return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
		? (valor as IDataObject)
		: {};
}

/**
 * As escolhas de um campo `selecao`.
 *
 * `opcoes` chega como jsonb CRU (`rotas/meta.ts` devolve a coluna sem tratar) e
 * o schema publicado o declara `unknown().nullable()`. O dicionario historico
 * mora em `opcoes.escolhas`, mas NAO ha contrato: existe uma tabela nova
 * `campo_opcoes` que esta rota nem le. Por isso a leitura e defensiva e, quando
 * nao reconhece nada, o campo cai para texto livre em vez de virar um dropdown
 * vazio que o usuario nao consegue preencher.
 */
export function escolhasDoCampo(campo: IDataObject): INodePropertyOptions[] | undefined {
	const escolhas = objeto(campo.opcoes).escolhas;
	if (!Array.isArray(escolhas) || escolhas.length === 0) return undefined;

	const opcoes: INodePropertyOptions[] = [];
	for (const bruta of escolhas) {
		if (typeof bruta === 'string') {
			if (bruta === '') continue;
			opcoes.push({ name: bruta, value: bruta });
			continue;
		}

		const item = objeto(bruta);
		const valor = texto(item.valor) || texto(item.value) || texto(item.id);
		const rotulo = texto(item.rotulo) || texto(item.label) || texto(item.nome) || valor;
		if (valor === '') continue;
		opcoes.push({ name: rotulo, value: valor });
	}

	return opcoes.length > 0 ? opcoes : undefined;
}

/**
 * Converte o dicionario de campos numa lista de `ResourceMapperField`.
 *
 * Ordem preservada: a rota ja devolve `ordem ASC, nome ASC`, que e a ordem do
 * layout — reordenar aqui trocaria a leitura do painel pela nossa.
 */
export function camposParaMapeador(campos: IDataObject[]): ResourceMapperField[] {
	const saida: ResourceMapperField[] = [];

	for (const campo of campos) {
		const slug = texto(campo.slug);
		if (slug === '') continue;

		const tipoDaApi = texto(campo.tipo);
		if (TIPOS_DERIVADOS.has(tipoDaApi)) continue;

		const tipo = TIPO_POR_CAMPO[tipoDaApi] ?? 'string';
		const escolhas = tipo === 'options' ? escolhasDoCampo(campo) : undefined;

		saida.push({
			id: slug,
			displayName: texto(campo.nome) || slug,
			// `required` sai do layout daquela organizacao, e e a razao de este
			// mapper existir. Ver o cabecalho do arquivo.
			required: campo.obrigatorio === true,
			display: true,
			// Nenhum campo personalizado e chave de casamento: todos os mappers deste
			// node usam o modo "add", e o unico upsert com indice configuravel — o de
			// contatos — casa por COLUNA (email, telefone, CPF...), que tem parametro
			// proprio. Oferecer "Matching Columns" aqui prometeria um casamento por
			// campo custom que a API nao faz.
			defaultMatch: false,
			canBeUsedToMatch: false,
			// `selecao` sem escolhas reconheciveis vira texto: um `options` sem
			// `options` renderiza um dropdown vazio, que trava a edicao.
			type: escolhas === undefined && tipo === 'options' ? 'string' : tipo,
			...(escolhas === undefined ? {} : { options: escolhas }),
			...(TIPOS_SOMENTE_LEITURA.has(tipoDaApi) ? { readOnly: true } : {}),
		});
	}

	return saida;
}

/**
 * Le o valor de uma propriedade `resourceMapper` e devolve o objeto plano que
 * vai no corpo.
 *
 * Devolve `undefined` quando o usuario nao preencheu nada — que e diferente de
 * `{}`: em `dados`, um objeto vazio APAGA todos os campos personalizados, e o
 * node nao pode fazer isso por omissao.
 *
 * `null` de um campo e PRESERVADO: e como o usuario limpa um valor.
 * `undefined` e string vazia sao descartados — a interface produz os dois para
 * campo simplesmente nao tocado.
 */
export function valoresDoMapeador(bruto: unknown): IDataObject | undefined {
	if (bruto === undefined || bruto === null) return undefined;

	// O parametro chega como `{mappingMode, value, matchingColumns, schema}`.
	// Uma expressao pode devolver o objeto plano direto, e nesse caso ele proprio
	// e o valor.
	const raiz = objeto(bruto);
	const valores = 'value' in raiz || 'mappingMode' in raiz ? raiz.value : raiz;
	if (valores === null || valores === undefined) return undefined;

	const plano = objeto(valores);
	const saida: IDataObject = {};
	for (const [chave, valor] of Object.entries(plano)) {
		if (valor === undefined || valor === '') continue;
		saida[chave] = valor;
	}

	return Object.keys(saida).length > 0 ? saida : undefined;
}

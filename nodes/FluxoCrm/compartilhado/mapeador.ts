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
 *   opcoes, validacoes, secao, ordem, sistema, somente_leitura}`.
 *
 * As duas ultimas chaves chegaram com os campos de SISTEMA
 * (`api-publica/campos-de-sistema.ts`): responsavel, equipe, criado em/por e
 * atualizado em/por passaram a vir no dicionario junto do layout, com
 * `sistema: true`. Instancia com API anterior nao manda nenhuma das duas —
 * flag ausente vale `false`, que e o comportamento que sempre existiu.
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

// ── Campos de sistema ────────────────────────────────────────────────
//
// O dicionario anuncia os campos de sistema com o NOME PUBLICO que a v1 aceita
// e devolve (`campos-de-sistema.ts`, `camposDeSistemaDoModulo`): `dono_id` e
// `equipe_id` na superficie de registros, `responsavel_id` em Contatos e
// Empresas, e os quatro de auditoria em todos. Eles viajam no PRIMEIRO NIVEL do
// corpo — nunca dentro de `valores`/`dados`, que e onde o mapeador joga tudo o
// que vem do layout. O que esta abaixo e a regra que separa os dois.
//
// As listas sao fechadas e copiadas do servidor porque na EXECUCAO o node so
// tem o objeto plano do mapeador, sem as flags. Nao ha risco de colisao com
// campo do layout: o gerador de slug do dicionario troca tudo que nao e
// alfanumerico por hifen ("Dono id" vira `dono-id`), entao um slug com
// underscore nunca nasce do layout.

/** Campos de sistema que a escrita aceita, no primeiro nivel do corpo. */
export const CAMPOS_DE_SISTEMA_GRAVAVEIS: readonly string[] = [
	'dono_id',
	'responsavel_id',
	'equipe_id',
];

/**
 * Campos de sistema preenchidos pelo servidor (`somente_leitura: true`).
 * Servem para leitura e mapeamento de saida, nunca para escrita.
 */
export const CAMPOS_DE_SISTEMA_SOMENTE_LEITURA: readonly string[] = [
	'criado_em',
	'criado_por',
	'atualizado_em',
	'atualizado_por',
];

/**
 * Quais campos de sistema cada rota de escrita aceita no primeiro nivel.
 *
 * Conferido schema a schema em `apps/api/src/api-publica/rotas/` do branch
 * `integracao/pilha-na-main`:
 *
 * - `contatos.ts:130` — `responsavel_id` no schema base, herdado por
 *   `atualizarSchema` (`.partial()`, l.183) e `upsertSchema` (`.extend()`, l.185);
 * - `empresas.ts:36` — idem, com os derivados nas l.43-44;
 * - `registros.ts:70-76` — criar aceita `dono_id` e `equipe_id`; `79-84` —
 *   atualizar aceita SO `equipe_id`;
 * - `negocios.ts:172-191` — criar aceita `dono_id`; `197-209` — atualizar nao
 *   aceita nenhum ("dono e pipeline mudam por endpoints proprios");
 *   `400-429` — upsert aceita `dono_id`. Nenhuma das tres aceita `equipe_id`;
 * - `atividades.ts:40-68` — nenhum: o responsavel da atividade e `usuario_id`,
 *   e a rota e `.strict()`. O dicionario de `tarefas` anuncia `dono_id` e
 *   `equipe_id` mesmo assim, por isso a lista aqui e por ROTA e nao por modulo.
 *
 * Todos os schemas sao `.strict()`: mandar um campo fora desta lista no topo
 * do corpo devolve 422, e deixa-lo dentro de `valores`/`dados` grava lixo em
 * silencio. Por isso o node recusa antes de enviar.
 */
export const SISTEMA_ACEITO_NA_ESCRITA: Readonly<
	Record<string, Readonly<Record<string, readonly string[]>>>
> = {
	contato: {
		criar: ['responsavel_id'],
		atualizar: ['responsavel_id'],
		criarOuAtualizar: ['responsavel_id'],
	},
	empresa: {
		criar: ['responsavel_id'],
		atualizar: ['responsavel_id'],
		criarOuAtualizar: ['responsavel_id'],
	},
	registro: {
		criar: ['dono_id', 'equipe_id'],
		atualizar: ['equipe_id'],
	},
	negocio: {
		criar: ['dono_id'],
		atualizar: [],
		criarOuAtualizar: ['dono_id'],
	},
	atividade: {
		criar: [],
		atualizar: [],
	},
};

/** Os campos de sistema que a operacao aceita; lista vazia para o que nao consta. */
export function sistemaAceito(recurso: string, operacao: string): readonly string[] {
	return SISTEMA_ACEITO_NA_ESCRITA[recurso]?.[operacao] ?? [];
}

/**
 * A uniao do que TODAS as operacoes do recurso aceitam — para o mapper quando
 * a operacao atual nao e conhecida.
 */
export function sistemaAceitoNoRecurso(recurso: string): readonly string[] {
	const porOperacao = SISTEMA_ACEITO_NA_ESCRITA[recurso] ?? {};
	return [...new Set(Object.values(porOperacao).flat())];
}

export interface CamposSeparados {
	/** O que vai dentro de `valores`/`dados`. */
	doLayout: IDataObject;
	/** Campos de sistema gravaveis, para o primeiro nivel do corpo. */
	deSistema: IDataObject;
	/** Campos de sistema somente leitura que vieram no mapeador — nunca podem ser enviados. */
	somenteLeitura: string[];
}

/**
 * Separa o objeto plano do mapeador em campos do layout e campos de sistema.
 *
 * Funcao pura: quem decide o que fazer com cada parte (recusar, hastear para o
 * topo do corpo) e `envelopeDeEscrita`, em `utilitarios.ts`, que conhece a
 * operacao e o `NodeOperationError`.
 */
export function separarCamposDeSistema(valores: IDataObject): CamposSeparados {
	const doLayout: IDataObject = {};
	const deSistema: IDataObject = {};
	const somenteLeitura: string[] = [];

	for (const [chave, valor] of Object.entries(valores)) {
		if (CAMPOS_DE_SISTEMA_SOMENTE_LEITURA.includes(chave)) {
			somenteLeitura.push(chave);
			continue;
		}
		if (CAMPOS_DE_SISTEMA_GRAVAVEIS.includes(chave)) {
			deSistema[chave] = valor;
			continue;
		}
		doLayout[chave] = valor;
	}

	return { doLayout, deSistema, somenteLeitura };
}

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

export interface OpcoesDoMapeador {
	/**
	 * Campos de sistema gravaveis que a operacao atual aceita no topo do corpo.
	 * Os demais campos de sistema ficam fora do mapper: oferecer `dono_id` numa
	 * rota que o recusa com 422 seria prometer o que a API nao faz.
	 */
	deSistemaAceitos?: readonly string[];
}

/**
 * Converte o dicionario de campos numa lista de `ResourceMapperField` para as
 * operacoes de ESCRITA (Criar, Atualizar, Criar ou Atualizar).
 *
 * Tres recortes, alem dos tipos derivados:
 *
 * - `somente_leitura: true` NUNCA entra: sao os campos que o servidor preenche
 *   (criado em/por, atualizado em/por). Em leitura e mapeamento de saida eles
 *   aparecem normalmente, so que essa lista nao passa por aqui;
 * - `sistema: true` gravavel entra so quando a operacao aceita o campo no topo
 *   do corpo (`deSistemaAceitos`), e sai marcado no rotulo para o usuario saber
 *   que ele nao e do layout;
 * - flag ausente (instancia com API anterior as flags) e tratada como `false`,
 *   e o campo entra como sempre entrou.
 *
 * Ordem preservada: a rota ja devolve `ordem ASC, nome ASC`, que e a ordem do
 * layout, com os de sistema no fim — reordenar aqui trocaria a leitura do
 * painel pela nossa.
 */
export function camposParaMapeador(
	campos: IDataObject[],
	opcoes: OpcoesDoMapeador = {},
): ResourceMapperField[] {
	const aceitos = new Set(opcoes.deSistemaAceitos ?? []);
	const saida: ResourceMapperField[] = [];

	for (const campo of campos) {
		const slug = texto(campo.slug);
		if (slug === '') continue;

		const tipoDaApi = texto(campo.tipo);
		if (TIPOS_DERIVADOS.has(tipoDaApi)) continue;

		if (campo.somente_leitura === true) continue;
		const deSistema = campo.sistema === true;
		if (deSistema && !aceitos.has(slug)) continue;

		const tipo = TIPO_POR_CAMPO[tipoDaApi] ?? 'string';
		const escolhas = tipo === 'options' ? escolhasDoCampo(campo) : undefined;
		const nome = texto(campo.nome) || slug;

		saida.push({
			id: slug,
			displayName: deSistema ? `${nome} (sistema)` : nome,
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

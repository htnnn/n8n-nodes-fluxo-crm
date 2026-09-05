import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { camposDoModulo, estadoDeEscopos, listaDeDescoberta } from '../compartilhado/capacidades';
import {
	encontrarRecurso,
	opcoesDeOperacaoComEscopo,
	opcoesDeRecursoComEscopo,
} from '../compartilhado/catalogo';
import { requisitar } from '../compartilhado/transporte';

/**
 * Metodos remotos que alimentam os dropdowns.
 *
 * Os de recurso e operacao existem por causa do resultado do spike: um
 * parametro pode carregar ao mesmo tempo um array `options` ESTATICO e um
 * `loadOptionsMethod`. O painel de Actions do node creator le o estatico (e por
 * isso a descoberta funciona sem credencial); o dropdown dentro do node le o
 * remoto (e por isso o cadeado por escopo aparece). O remoto SUBSTITUI o
 * estatico, nunca concatena.
 *
 * Os de descoberta (usuarios, pipelines, etiquetas...) passam por
 * `listaDeDescoberta`, que prefere o agregado `/capabilities` e cai para o
 * endpoint individual quando o bloco vem em `blocos_omitidos` — a lista vazia
 * de um bloco omitido NAO e resposta.
 */

function texto(valor: unknown): string {
	return typeof valor === 'string' ? valor : '';
}

export async function carregarRecursos(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return opcoesDeRecursoComEscopo(await estadoDeEscopos(this));
}

/**
 * Fabrica o carregador de operacoes de um recurso.
 *
 * Um metodo por recurso, e nao um metodo unico que leia o `resource` atual: o
 * nome do metodo fica no JSON do workflow, e um metodo generico dependeria de
 * `getCurrentNodeParameter` acertar o momento da leitura. Dezenove nomes
 * explicitos custam esta funcao e nao dependem de nada.
 */
function operacoesDe(recurso: string) {
	return async function (this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		return opcoesDeOperacaoComEscopo(encontrarRecurso(recurso)!, await estadoDeEscopos(this));
	};
}

export const carregarOperacoesDeContato = operacoesDe('contato');
export const carregarOperacoesDeNegocio = operacoesDe('negocio');
export const carregarOperacoesDeEmpresa = operacoesDe('empresa');
export const carregarOperacoesDeLead = operacoesDe('lead');
export const carregarOperacoesDePipeline = operacoesDe('pipeline');
export const carregarOperacoesDeAtividade = operacoesDe('atividade');
export const carregarOperacoesDeRegistro = operacoesDe('registro');
export const carregarOperacoesDeNota = operacoesDe('nota');
export const carregarOperacoesDeArquivo = operacoesDe('arquivo');
export const carregarOperacoesDeLote = operacoesDe('lote');
export const carregarOperacoesDeConversa = operacoesDe('conversa');
export const carregarOperacoesDeMensagem = operacoesDe('mensagem');
export const carregarOperacoesDeCanalAtendimento = operacoesDe('canalAtendimento');
export const carregarOperacoesDeAgenteAtendimento = operacoesDe('agenteAtendimento');
export const carregarOperacoesDeWebhook = operacoesDe('webhook');
export const carregarOperacoesDeModulo = operacoesDe('modulo');
export const carregarOperacoesDeEtiqueta = operacoesDe('etiqueta');
export const carregarOperacoesDeInteracao = operacoesDe('interacao');
export const carregarOperacoesDeOrganizacao = operacoesDe('organizacao');

export async function carregarUsuarios(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const linhas = await listaDeDescoberta(this, 'usuarios');
	return linhas
		.map((linha) => ({
			name: `${texto(linha.nome)} (${texto(linha.email)})`,
			value: texto(linha.id),
		}))
		.filter((opcao) => opcao.value !== '');
}

export async function carregarEquipes(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	// So equipes-espelho de cargo sao ofertadas pela API; equipes legadas seguem
	// no banco por causa de chaves estrangeiras historicas e nao sao alvo valido.
	const linhas = await listaDeDescoberta(this, 'equipes');
	return linhas
		.map((linha) => ({ name: texto(linha.nome), value: texto(linha.id) }))
		.filter((opcao) => opcao.value !== '');
}

export async function carregarModulos(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const linhas = await listaDeDescoberta(this, 'modulos');
	return linhas
		.map((linha) => ({
			name: `${texto(linha.nome)} (${texto(linha.slug)})`,
			value: texto(linha.slug),
		}))
		.filter((opcao) => opcao.value !== '');
}

export async function carregarPipelines(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const linhas = await listaDeDescoberta(this, 'pipelines');
	return linhas
		.map((linha) => ({
			name: linha.is_padrao === true ? `${texto(linha.nome)} (padrao)` : texto(linha.nome),
			value: texto(linha.id),
		}))
		.filter((opcao) => opcao.value !== '');
}

/**
 * Achata `pipelines[].estagios[]` num dropdown unico.
 *
 * O rotulo traz o funil porque o mesmo nome de estagio ("Qualificacao") se
 * repete entre funis, e o valor enviado e sempre o UUID: `mover`, `ganhar` e
 * `perder` identificam o estagio exclusivamente por UUID — nome, slug e
 * posicao nao sao aceitos.
 */
async function estagios(
	ctx: ILoadOptionsFunctions,
	tipoAceito?: string,
): Promise<INodePropertyOptions[]> {
	const pipelines = await listaDeDescoberta(ctx, 'pipelines');
	const opcoes: INodePropertyOptions[] = [];

	for (const pipeline of pipelines) {
		const lista = Array.isArray(pipeline.estagios) ? (pipeline.estagios as IDataObject[]) : [];
		for (const estagio of lista) {
			if (tipoAceito !== undefined && estagio.tipo !== tipoAceito) continue;
			const id = texto(estagio.id);
			if (id === '') continue;
			opcoes.push({
				name: `${texto(pipeline.nome)} › ${texto(estagio.nome)}`,
				value: id,
			});
		}
	}

	return opcoes;
}

export async function carregarEstagios(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return await estagios(this);
}

export async function carregarEstagiosDeGanho(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return await estagios(this, 'ganho');
}

export async function carregarEstagiosDePerda(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return await estagios(this, 'perdido');
}

/**
 * Etiquetas ja existentes na organizacao, por NOME.
 *
 * O valor e o nome, nunca o id: o corpo de contato e negocio recebe
 * `etiquetas: string[]` de nomes, e nome inexistente e criado automaticamente.
 */
export async function carregarEtiquetas(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const linhas = await listaDeDescoberta(this, 'etiquetas');
	const vistos = new Set<string>();

	return linhas
		.map((linha) => ({ name: texto(linha.nome), value: texto(linha.nome) }))
		.filter((opcao) => {
			if (opcao.value === '' || vistos.has(opcao.value)) return false;
			vistos.add(opcao.value);
			return true;
		});
}

/**
 * Etiquetas por IDENTIFICADOR, para as rotas de vinculo.
 *
 * Aqui o id importa: `DELETE .../etiquetas/{id}` so aceita UUID, e o vinculo
 * por id exige que a etiqueta seja do mesmo modulo do registro — por isso o
 * rotulo carrega o modulo, que e o unico jeito de o usuario distinguir duas
 * etiquetas "Urgente" de modulos diferentes.
 */
export async function carregarEtiquetasPorId(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const [linhas, modulos] = await Promise.all([
		listaDeDescoberta(this, 'etiquetas'),
		listaDeDescoberta(this, 'modulos'),
	]);

	const nomeDoModulo = new Map<string, string>();
	for (const modulo of modulos) nomeDoModulo.set(texto(modulo.id), texto(modulo.nome));

	return linhas
		.map((linha) => {
			const modulo = nomeDoModulo.get(texto(linha.modulo_id));
			return {
				name: modulo === undefined ? texto(linha.nome) : `${texto(linha.nome)} — ${modulo}`,
				value: texto(linha.id),
			};
		})
		.filter((opcao) => opcao.value !== '');
}

export async function carregarCanais(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const resposta = await requisitar(this, { metodo: 'GET', caminho: '/atendimento/canais' });
	const corpo = resposta.corpo as IDataObject;
	const linhas = Array.isArray(corpo?.dados) ? (corpo.dados as IDataObject[]) : [];

	return linhas
		.map((linha) => ({
			name: `${texto(linha.nome)} — ${texto(linha.tipo)}`,
			value: texto(linha.id),
		}))
		.filter((opcao) => opcao.value !== '');
}

export async function carregarAgentes(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const resposta = await requisitar(this, { metodo: 'GET', caminho: '/atendimento/agentes' });
	const corpo = resposta.corpo as IDataObject;
	const linhas = Array.isArray(corpo?.dados) ? (corpo.dados as IDataObject[]) : [];

	// O valor e `usuario_id`, e nao `id`: e o que `atendente_id` e
	// `atendente_usuario_id` esperam.
	return linhas
		.map((linha) => ({
			name: `${texto(linha.nome)} (${texto(linha.email)})`,
			value: texto(linha.usuario_id),
		}))
		.filter((opcao) => opcao.value !== '');
}

/** O coringa aceito por `POST /webhooks`, que NAO aparece na listagem da API. */
const CORINGA_DE_EVENTO: INodePropertyOptions = {
	// eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased -- e o valor coringa da API renderizado como rotulo, nao um nome de campo; title case do ingles o transformaria em outra coisa
	name: '* (todos os eventos)',
	value: '*',
	description: 'Assina todos os eventos, inclusive os que a API vier a acrescentar',
};

export async function carregarEventosWebhook(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const resposta = await requisitar(this, { metodo: 'GET', caminho: '/webhooks/eventos' });
	const corpo = resposta.corpo as IDataObject;
	const linhas = Array.isArray(corpo?.dados) ? corpo.dados : [];

	const eventos = linhas
		.map((linha) => (typeof linha === 'string' ? linha : texto((linha as IDataObject)?.evento)))
		.filter((evento) => evento !== '')
		.map((evento) => ({ name: evento, value: evento }));

	// O coringa e acrescentado a mao porque o validador o aceita e a listagem nao
	// o inclui. Formas como `contato:*` e `contato.*` NAO sao aceitas.
	return [CORINGA_DE_EVENTO, ...eventos];
}

/** O slug do modulo escolhido no painel, para os dropdowns que dependem dele. */
function slugAtual(ctx: ILoadOptionsFunctions): string {
	const bruto = ctx.getCurrentNodeParameter('moduloSlug');
	return typeof bruto === 'string' ? bruto.trim() : '';
}

/**
 * Campos do modulo escolhido, para os filtros `campo:` de `registro:listar`.
 *
 * Sem modulo selecionado a lista vem com uma linha de instrucao em vez de
 * vazia: um dropdown vazio nao diz ao usuario o que fazer.
 */
export async function carregarCamposDoModulo(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const slug = slugAtual(this);
	if (slug === '') {
		return [
			{
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased -- e uma frase de instrucao na lista, nao um rotulo de campo
				name: 'Escolha o modulo primeiro',
				value: '',
				description: 'O dicionario de campos e por modulo, e esta lista depende dele',
			},
		];
	}

	return opcoesDeCampos(await camposDoModulo(this, slug));
}

export async function carregarCamposDeNegocio(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return opcoesDeCampos(await camposDoModulo(this, 'negocios'));
}

function opcoesDeCampos(campos: IDataObject[]): INodePropertyOptions[] {
	return campos
		.map((campo) => ({
			name: `${texto(campo.nome)} (${texto(campo.tipo)})`,
			value: texto(campo.slug),
		}))
		.filter((opcao) => opcao.value !== '');
}

const TIPOS_IDENTIFICADORES = new Set(['email', 'telefone', 'instagram']);
const INDICE_DE_FALLBACK = ['email', 'telefone', 'celular', 'telefone_comercial', 'instagram'];

/**
 * Que tipo de identificador um campo do dicionario e, se e algum.
 *
 * Espelho de `tipoIdentificador` em `engine/indice-upsert.ts`.
 */
function tipoIdentificador(campo: IDataObject): string | null {
	const tipo = texto(campo.tipo);
	if (tipo === 'email' || tipo === 'telefone' || tipo === 'instagram' || tipo === 'texto') {
		return tipo;
	}
	if (tipo === 'lista') {
		const opcoes = (campo.opcoes ?? {}) as IDataObject;
		const subtipo = texto(opcoes.subtipo);
		if (subtipo === 'telefone' || subtipo === 'instagram') return subtipo;
	}
	return null;
}

function numeroOuTeto(valor: unknown): number {
	return typeof valor === 'number' && Number.isFinite(valor) ? valor : Number.MAX_SAFE_INTEGER;
}

/**
 * O indice de casamento do upsert de contatos daquela organizacao.
 *
 * Nao existe endpoint que devolva o indice pronto, mas ele e derivavel de
 * `GET /modulos/contatos/campos`: a configuracao mora em `opcoes.usarComoIndice`
 * e `opcoes.ordemIndice` do proprio campo. Este metodo replica, nesta ordem,
 * `indiceDeclarado` → `derivarIndiceUpsert` → fallback.
 *
 * O valor enviado e o SLUG do dicionario. O servidor aceita tanto o slug quanto
 * o nome publico da v1, e o nome publico depende de um tradutor que so existe
 * no servidor — a unica excecao documentada e `e-mail`, cujo nome publico e
 * `email`, e essa esta tratada aqui.
 */
export async function carregarChavesDeIndice(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const campos = await camposDoModulo(this, 'contatos');

	const nomePublico = (slug: string): string => (slug === 'e-mail' ? 'email' : slug);
	const paraOpcao = (campo: IDataObject): INodePropertyOptions => ({
		name: `${texto(campo.nome)} (${nomePublico(texto(campo.slug))})`,
		value: nomePublico(texto(campo.slug)),
	});

	const seDeclararam = campos.filter(
		(campo) => typeof ((campo.opcoes ?? {}) as IDataObject).usarComoIndice === 'boolean',
	);

	if (seDeclararam.length > 0) {
		const declarados = seDeclararam
			.filter((campo) => ((campo.opcoes ?? {}) as IDataObject).usarComoIndice === true)
			.filter((campo) => tipoIdentificador(campo) !== null)
			.sort((a, b) => {
				const ordemA = numeroOuTeto(((a.opcoes ?? {}) as IDataObject).ordemIndice);
				const ordemB = numeroOuTeto(((b.opcoes ?? {}) as IDataObject).ordemIndice);
				if (ordemA !== ordemB) return ordemA - ordemB;
				return numeroOuTeto(a.ordem) - numeroOuTeto(b.ordem);
			});

		// Lista vazia e resposta legitima: significa que a organizacao desligou o
		// casamento automatico na tela de layout. Cair no fallback aqui desfaria
		// essa escolha em silencio — melhor dizer o que esta acontecendo.
		if (declarados.length === 0) {
			return [
				{
					// eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased -- isto e uma frase de aviso na lista, nao um rotulo de campo; title case do ingles a deixaria ilegivel
					name: 'Nenhum campo de indice configurado nesta organizacao',
					value: '',
					description:
						'O layout do modulo Contatos desmarcou todos os campos de indice, e o upsert vai recusar com 422. Configure em Configuracoes › Modulos › Contatos › Layout.',
				},
			];
		}

		return declarados.map(paraOpcao);
	}

	const derivados = [...campos]
		.sort((a, b) => numeroOuTeto(a.ordem) - numeroOuTeto(b.ordem))
		.filter((campo) => {
			const tipo = tipoIdentificador(campo);
			return tipo !== null && TIPOS_IDENTIFICADORES.has(tipo);
		});

	if (derivados.length > 0) return derivados.map(paraOpcao);

	// Organizacao antiga, com o modulo ainda nao semeado: sem linhas em `campos`
	// o derivado da vazio, e e o fallback da rota que passa a valer.
	return INDICE_DE_FALLBACK.map((slug) => ({ name: slug, value: slug }));
}

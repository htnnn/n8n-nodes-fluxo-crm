import type { IDataObject, ILoadOptionsFunctions, INodePropertyOptions } from 'n8n-workflow';

import { estadoDeEscopos, listaDeDescoberta } from '../compartilhado/capacidades';
import {
	encontrarRecurso,
	opcoesDeOperacaoComEscopo,
	opcoesDeRecursoComEscopo,
} from '../compartilhado/catalogo';

/**
 * Metodos remotos que alimentam os dropdowns.
 *
 * Os tres primeiros existem por causa do resultado do spike: um parametro pode
 * carregar ao mesmo tempo um array `options` ESTATICO e um `loadOptionsMethod`.
 * O painel de Actions do node creator le o estatico (e por isso a descoberta
 * funciona sem credencial); o dropdown dentro do node le o remoto (e por isso o
 * cadeado por escopo aparece). O remoto SUBSTITUI o estatico, nunca concatena.
 */

function texto(valor: unknown): string {
	return typeof valor === 'string' ? valor : '';
}

export async function carregarRecursos(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return opcoesDeRecursoComEscopo(await estadoDeEscopos(this));
}

export async function carregarOperacoesDeContato(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return opcoesDeOperacaoComEscopo(encontrarRecurso('contato')!, await estadoDeEscopos(this));
}

export async function carregarOperacoesDeNegocio(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	return opcoesDeOperacaoComEscopo(encontrarRecurso('negocio')!, await estadoDeEscopos(this));
}

export async function carregarUsuarios(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const linhas = await listaDeDescoberta(this, 'usuarios', '/usuarios');
	return linhas
		.map((linha) => ({
			name: `${texto(linha.nome)} (${texto(linha.email)})`,
			value: texto(linha.id),
		}))
		.filter((opcao) => opcao.value !== '');
}

export async function carregarPipelines(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const linhas = await listaDeDescoberta(this, 'pipelines', '/pipelines');
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
	const pipelines = await listaDeDescoberta(ctx, 'pipelines', '/pipelines');
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
 * Etiquetas ja existentes na organizacao.
 *
 * O valor e o NOME, nunca o id: o corpo da API recebe `etiquetas: string[]` de
 * nomes, e nome inexistente e criado automaticamente. Quem quiser uma etiqueta
 * que ainda nao existe usa o campo de texto ao lado, porque `multiOptions` nao
 * aceita valor livre.
 */
export async function carregarEtiquetas(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const linhas = await listaDeDescoberta(this, 'etiquetas', '/etiquetas');
	return linhas
		.map((linha) => ({ name: texto(linha.nome), value: texto(linha.nome) }))
		.filter((opcao) => opcao.value !== '');
}

export async function carregarCamposDeNegocio(
	this: ILoadOptionsFunctions,
): Promise<INodePropertyOptions[]> {
	const linhas = await listaDeDescoberta(this, 'camposDeNegocio', '/modulos/negocios/campos');
	return linhas
		.map((linha) => ({
			name: `${texto(linha.nome)} (${texto(linha.tipo)})`,
			value: texto(linha.slug),
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
	const campos = await listaDeDescoberta(this, 'camposDeContato', '/modulos/contatos/campos');

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

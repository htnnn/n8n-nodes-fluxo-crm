import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { requisitar, requisitarLista } from '../compartilhado/transporte';
import {
	cabecalhoDeIdempotencia,
	ehUuid,
	emailNormalizado,
	exigirUuid,
	idDoLocalizador,
	listaDeEtiquetas,
	objetoDeJson,
	propagarAvisos,
	semIndefinidos,
} from '../compartilhado/utilitarios';

/** Operadores que castam o valor no Postgres — texto aqui vira 500, nao 422. */
const OPERADORES_NUMERICOS = ['maior', 'menor', 'maior_igual', 'menor_igual'];
const OPERADORES_DE_DATA = ['antes', 'depois'];
/** Estes dois ignoram o valor, e tratam 0 e false como preenchidos. */
const OPERADORES_SEM_VALOR = ['vazio', 'nao_vazio'];

function objeto(valor: unknown): IDataObject {
	return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
		? (valor as IDataObject)
		: {};
}

function item(json: IDataObject, i: number): INodeExecutionData {
	return { json, pairedItem: { item: i } };
}

/**
 * Le o bloco `contato`, saneando o e-mail e conferindo o UUID.
 *
 * O bloco e `.strict()` no servidor: chave desconhecida devolve 422 nomeando a
 * chave. Aqui so passam as cinco que existem.
 */
function blocoDeContato(ctx: IExecuteFunctions, i: number): IDataObject | undefined {
	const secao = objeto(objeto(ctx.getNodeParameter('contato', i, {})).campos);
	const bloco: IDataObject = {};

	for (const chave of ['id', 'email', 'telefone', 'instagram', 'nome']) {
		const valor = secao[chave];
		if (typeof valor !== 'string' || valor.trim() === '') continue;
		if (chave === 'id') {
			bloco.id = exigirUuid(ctx, valor.trim(), 'contato do bloco', i);
			continue;
		}
		if (chave === 'email') {
			bloco.email = emailNormalizado(valor);
			continue;
		}
		bloco[chave] = valor.trim();
	}

	return Object.keys(bloco).length > 0 ? semIndefinidos(bloco) : undefined;
}

/** Le um `fixedCollection` de referencia a funil (`{id?, nome?}`). */
function referenciaDeFunil(
	ctx: IExecuteFunctions,
	nome: string,
	rotulo: string,
	i: number,
): IDataObject | undefined {
	const secao = objeto(objeto(ctx.getNodeParameter(nome, i, {})).campos);
	const referencia: IDataObject = {};

	const id = secao.id;
	if (typeof id === 'string' && id.trim() !== '') {
		referencia.id = exigirUuid(ctx, id.trim(), rotulo, i);
	}
	const nomeInformado = secao.nome;
	if (typeof nomeInformado === 'string' && nomeInformado.trim() !== '') {
		referencia.nome = nomeInformado.trim();
	}

	return Object.keys(referencia).length > 0 ? referencia : undefined;
}

function etiquetasDoItem(ctx: IExecuteFunctions, i: number): string[] | undefined {
	const escolhidas = ctx.getNodeParameter('etiquetas', i, []) as string[];
	const novas = ctx.getNodeParameter('etiquetasNovas', i, '') as string;
	return listaDeEtiquetas([...(Array.isArray(escolhidas) ? escolhidas : []), novas]);
}

/**
 * Traduz os filtros por campo para `campo:{slug}[operador]=valor`.
 *
 * Duas guardas locais, ambas por causa de comportamento medido do servidor:
 * o operador precisa ir em minusculas (maiuscula passa na regex e falha na
 * comparacao, com 422), e comparacao numerica ou de data com valor de outro
 * tipo estoura o cast do Postgres e volta como 500 `erro_interno`.
 */
function filtrosDeCampo(ctx: IExecuteFunctions, i: number): IDataObject {
	const bruto = objeto(ctx.getNodeParameter('filtrosDeCampo', i, {}));
	const criterios = Array.isArray(bruto.criterios) ? (bruto.criterios as IDataObject[]) : [];
	const query: IDataObject = {};

	for (const criterio of criterios) {
		const slug = typeof criterio.slug === 'string' ? criterio.slug.trim() : '';
		if (slug === '') continue;

		const operador = (
			typeof criterio.operador === 'string' ? criterio.operador : 'igual'
		).toLowerCase();
		const valor = criterio.valor;

		if (OPERADORES_SEM_VALOR.includes(operador)) {
			query[`campo:${slug}[${operador}]`] = '';
			continue;
		}

		const texto = typeof valor === 'string' ? valor.trim() : String(valor ?? '');

		if (OPERADORES_NUMERICOS.includes(operador) && !Number.isFinite(Number(texto))) {
			throw new NodeOperationError(
				ctx.getNode(),
				`O filtro "${slug}" usa a comparacao "${operador}" com um valor que nao e numero`,
				{
					description: `Recebido: ${JSON.stringify(texto)}. Comparacao numerica com texto estoura o cast no banco e a API devolve 500, nao 422 — por isso o node confere antes de enviar.`,
					itemIndex: i,
				},
			);
		}

		if (OPERADORES_DE_DATA.includes(operador) && Number.isNaN(new Date(texto).getTime())) {
			throw new NodeOperationError(
				ctx.getNode(),
				`O filtro "${slug}" usa a comparacao "${operador}" com um valor que nao e data`,
				{
					description: `Recebido: ${JSON.stringify(texto)}. Comparacao de data com texto invalido estoura o cast no banco e a API devolve 500, nao 422.`,
					itemIndex: i,
				},
			);
		}

		query[`campo:${slug}[${operador}]`] = texto;
	}

	return query;
}

/**
 * Reconhece a resposta reduzida de `POST /negocios`.
 *
 * A rota pode devolver **200 com quatro chaves** — sem `valores`, sem datas, e
 * sem emitir webhook — quando a politica de unicidade reutilizou um negocio que
 * esta fora do recorte de visibilidade da chave. Tipar a resposta como
 * "registro" quebra exatamente nesse caso. Nao adianta complementar com um GET:
 * ele devolveria 404 pela mesma razao.
 */
function marcarRespostaParcial(ctx: IExecuteFunctions, corpo: IDataObject): IDataObject {
	if (corpo.oculto_por_visibilidade !== true) return corpo;

	ctx.logger.warn(
		`[Fluxo CRM] O negocio ${String(corpo.id)} existe e foi reutilizado pela politica de duplicidade, mas esta fora do recorte de visibilidade desta chave: a resposta veio sem os campos do registro e nenhum webhook foi emitido.`,
	);
	return { ...corpo, __parcial: true };
}

export async function executarNegocio(
	ctx: IExecuteFunctions,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operacao) {
		case 'listar': {
			const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
			const limite = ctx.getNodeParameter('limit', i, 50) as number;
			const filtros = objeto(ctx.getNodeParameter('filters', i, {}));

			const query: IDataObject = {};
			for (const [chave, valor] of Object.entries(filtros)) {
				if (valor === undefined || valor === '' || valor === null) continue;
				if (chave.endsWith('_id') && !ehUuid(valor)) {
					throw new NodeOperationError(
						ctx.getNode(),
						`O filtro "${chave}" nao recebeu um UUID valido`,
						{
							description:
								'A API devolve 404 (e nao 422) para identificador malformado em filtro, entao a conferencia acontece aqui.',
							itemIndex: i,
						},
					);
				}
				query[chave] = chave === 'contato_email' ? emailNormalizado(valor) : valor;
			}

			Object.assign(query, filtrosDeCampo(ctx, i));

			const condicao = ctx.getNodeParameter('condicao', i, 'e') as string;
			if (Object.keys(query).some((chave) => chave.startsWith('campo:'))) {
				query.condicao = condicao;
			}

			const dados = await requisitarLista(ctx, {
				metodo: 'GET',
				caminho: '/negocios',
				query: semIndefinidos(query),
				retornarTudo,
				limite,
				itemIndex: i,
			});
			return dados.map((negocio) => item(negocio, i));
		}

		case 'obter': {
			const id = idDoLocalizador(ctx, 'negocioId', 'negocio', i);
			const resposta = await requisitar(ctx, { metodo: 'GET', caminho: `/negocios/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'excluir': {
			const id = idDoLocalizador(ctx, 'negocioId', 'negocio', i);
			const resposta = await requisitar(ctx, {
				metodo: 'DELETE',
				caminho: `/negocios/${id}`,
			});
			return [item(resposta.corpo, i)];
		}

		case 'criar': {
			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const corpo: IDataObject = {
				pipeline_id: exigirUuid(
					ctx,
					ctx.getNodeParameter('pipeline_id', i) as string,
					'pipeline',
					i,
				),
				// O servidor exige a chave `valores`, mesmo que vazia.
				valores:
					objetoDeJson(ctx, ctx.getNodeParameter('valores', i, '{}'), 'Valores do Modulo', i) ?? {},
				contato: blocoDeContato(ctx, i),
				etiquetas: etiquetasDoItem(ctx, i),
				dono_id:
					typeof opcoes.dono_id === 'string' && opcoes.dono_id !== ''
						? exigirUuid(ctx, opcoes.dono_id, 'dono', i)
						: undefined,
			};

			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: '/negocios',
				corpo: semIndefinidos(corpo),
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});

			// "POST" nao e sinonimo de "criou": a politica de unicidade pode
			// reutilizar um negocio existente e devolver 200 com `criado: false`.
			const saida = marcarRespostaParcial(ctx, propagarAvisos(ctx, resposta.corpo));
			return [
				item(
					{
						...saida,
						__criado: saida.criado === true,
						__statusHttp: resposta.status,
					},
					i,
				),
			];
		}

		case 'atualizar': {
			const id = idDoLocalizador(ctx, 'negocioId', 'negocio', i);
			// Aqui `valores` faz MERGE no servidor — o oposto de `dados` de contato.
			const corpo: IDataObject = {
				valores: objetoDeJson(
					ctx,
					ctx.getNodeParameter('valores', i, '{}'),
					'Valores do Modulo',
					i,
				),
				contato: blocoDeContato(ctx, i),
				etiquetas: etiquetasDoItem(ctx, i),
			};

			const enxuto = semIndefinidos(corpo);
			if (Object.keys(enxuto).length === 0) {
				throw new NodeOperationError(ctx.getNode(), 'Nenhum campo para atualizar', {
					description:
						'Preencha "Valores do Modulo", o bloco de contato ou as etiquetas. Dono, pipeline e estagio mudam por operacoes proprias.',
					itemIndex: i,
				});
			}

			const resposta = await requisitar(ctx, {
				metodo: 'PATCH',
				caminho: `/negocios/${id}`,
				corpo: enxuto,
			});
			return [item(propagarAvisos(ctx, resposta.corpo), i)];
		}

		case 'criarOuAtualizar': {
			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const corpo: IDataObject = {
				contato: blocoDeContato(ctx, i),
				pipeline: referenciaDeFunil(ctx, 'pipeline', 'pipeline', i),
				estagio: referenciaDeFunil(ctx, 'estagio', 'estagio', i),
				valores: objetoDeJson(
					ctx,
					ctx.getNodeParameter('valores', i, '{}'),
					'Valores do Modulo',
					i,
				),
				papel: typeof opcoes.papel === 'string' && opcoes.papel !== '' ? opcoes.papel : undefined,
				dono_id:
					typeof opcoes.dono_id === 'string' && opcoes.dono_id !== ''
						? exigirUuid(ctx, opcoes.dono_id, 'dono', i)
						: undefined,
				escopo: opcoes.escopo,
				mover_estagio: opcoes.mover_estagio,
				criar_contato_se_nao_existir: opcoes.criar_contato_se_nao_existir,
				incluir_fechados: opcoes.incluir_fechados,
				quando_multiplos: opcoes.quando_multiplos,
			};

			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: '/negocios/upsert',
				corpo: semIndefinidos(corpo),
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});

			// `casou_por` aqui e conjunto FECHADO — "id", "email", "telefone",
			// "instagram" ou null —, ao contrario do de contatos, que e aberto.
			const saida = propagarAvisos(ctx, resposta.corpo);
			return [
				item(
					{
						...saida,
						__criado: saida.criado === true || resposta.status === 201,
						__casouPor: saida.casou_por ?? null,
						__estagioMovido: saida.estagio_movido ?? null,
						__statusHttp: resposta.status,
					},
					i,
				),
			];
		}

		case 'mover':
		case 'marcarGanho':
		case 'marcarPerdido': {
			const id = idDoLocalizador(ctx, 'negocioId', 'negocio', i);
			const estagioId = exigirUuid(
				ctx,
				ctx.getNodeParameter('estagio_id', i) as string,
				'estagio',
				i,
			);
			const caminhos: Record<string, string> = {
				mover: 'mover',
				marcarGanho: 'ganhar',
				marcarPerdido: 'perder',
			};

			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: `/negocios/${id}/${caminhos[operacao]}`,
				corpo: { estagio_id: estagioId },
			});
			return [item(resposta.corpo, i)];
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Negocio`,
				{ itemIndex: i },
			);
	}
}

import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { filtrosDeCampo, filtrosSimples } from '../compartilhado/filtros';
import { valoresDoMapeador } from '../compartilhado/mapeador';
import { requisitar, requisitarLista } from '../compartilhado/transporte';
import {
	aplicarNoTopo,
	cabecalhoDeIdempotencia,
	emailNormalizado,
	envelopeDeEscrita,
	exigirUuid,
	idDoLocalizador,
	itemDeSaida as item,
	listaDeEtiquetas,
	objeto,
	propagarAvisos,
	semIndefinidos,
	type EnvelopeDeEscrita,
} from '../compartilhado/utilitarios';

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

/** Onde cada operacao recusa o campo de sistema que a rota nao aceita. */
const ORIENTACAO_DE_SISTEMA: Record<string, string> = {
	criar:
		'POST /negocios aceita o dono no topo do corpo, mas nao a equipe. Tire "Equipe" do mapeador de campos.',
	atualizar:
		'PATCH /negocios/{id} so aceita valores, contato e etiquetas: dono, pipeline e estagio mudam por operacoes proprias. Tire o campo do mapeador.',
	criarOuAtualizar:
		'POST /negocios/upsert aceita o dono no topo do corpo, mas nao a equipe. Tire "Equipe" do mapeador de campos.',
};

/**
 * Le o `resourceMapper` de `valores`, que e alimentado pelo modulo `negocios`.
 *
 * O dicionario de `negocios` anuncia `dono_id` e `equipe_id` como campos de
 * sistema; so o dono tem lugar nas rotas de negocio, e no topo do corpo. O que
 * a operacao nao aceita e recusado aqui, nomeado, em vez de virar 422 ou campo
 * personalizado gravado em silencio.
 */
function valoresDoModulo(ctx: IExecuteFunctions, i: number, operacao: string): EnvelopeDeEscrita {
	return envelopeDeEscrita(ctx, i, valoresDoMapeador(ctx.getNodeParameter('valores', i, {})), {
		recurso: 'negocio',
		operacao,
		orientacao: ORIENTACAO_DE_SISTEMA[operacao],
	});
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

			const query = filtrosSimples(ctx, 'filters', i, (chave, valor) =>
				chave === 'contato_email' ? emailNormalizado(valor) : valor,
			);

			Object.assign(query, filtrosDeCampo(ctx, 'filtrosDeCampo', i));

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
			const envelope = valoresDoModulo(ctx, i, 'criar');
			const corpo: IDataObject = {
				pipeline_id: exigirUuid(
					ctx,
					ctx.getNodeParameter('pipeline_id', i) as string,
					'pipeline',
					i,
				),
				// O servidor exige a chave `valores`, mesmo que vazia.
				valores: envelope.blob ?? {},
				contato: blocoDeContato(ctx, i),
				etiquetas: etiquetasDoItem(ctx, i),
				dono_id:
					typeof opcoes.dono_id === 'string' && opcoes.dono_id !== ''
						? exigirUuid(ctx, opcoes.dono_id, 'dono', i)
						: undefined,
			};
			// O dono vindo do mapeador vai para o topo do corpo, e nao pode
			// discordar do que veio em Opcoes.
			aplicarNoTopo(ctx, i, corpo, envelope.topo);

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
			// A operacao nao aceita campo de sistema nenhum: `envelope.topo` e sempre
			// vazio, porque qualquer um teria sido recusado com o motivo.
			const corpo: IDataObject = {
				valores: valoresDoModulo(ctx, i, 'atualizar').blob,
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
			const envelope = valoresDoModulo(ctx, i, 'criarOuAtualizar');
			const corpo: IDataObject = {
				contato: blocoDeContato(ctx, i),
				pipeline: referenciaDeFunil(ctx, 'pipeline', 'pipeline', i),
				estagio: referenciaDeFunil(ctx, 'estagio', 'estagio', i),
				valores: envelope.blob,
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
			aplicarNoTopo(ctx, i, corpo, envelope.topo);

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

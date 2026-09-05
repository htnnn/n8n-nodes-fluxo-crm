import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { filtrosSimples } from '../compartilhado/filtros';
import { valoresDoMapeador } from '../compartilhado/mapeador';
import { requisitar, requisitarLista, requisitarListaSimples } from '../compartilhado/transporte';
import {
	cabecalhoDeIdempotencia,
	emailNormalizado,
	idDoLocalizador,
	itemDeSaida as item,
	listaDeEtiquetas,
	listaDeTexto,
	objeto,
	propagarAvisos,
	secaoUnica,
	semIndefinidos,
} from '../compartilhado/utilitarios';

/** Campos que, sozinhos, ja permitem achar o contato depois. */
const IDENTIFICADORES = ['nome', 'email', 'telefone', 'cpf', 'instagram'];

/** Campos do corpo que sao listas, e chegam da interface como texto separado por virgula. */
const CAMPOS_DE_LISTA = ['emails', 'telefones', 'instagrams'];

/**
 * Monta o corpo a partir da colecao de campos da interface.
 *
 * Tres normalizacoes acontecem aqui, e todas tem motivo medido:
 * - o e-mail vai em minusculas, porque o ramo de update do upsert do servidor
 *   nao aplica `toLowerCase()` e o filtro `?email=` compara por igualdade exata
 *   contra o valor ja minusculo;
 * - `emails`, `telefones` e `instagrams` viram arrays;
 * - as etiquetas escolhidas e as digitadas viram uma lista so.
 */
function corpoDoContato(ctx: IExecuteFunctions, i: number, nomeDaColecao: string): IDataObject {
	const colecao = objeto(ctx.getNodeParameter(nomeDaColecao, i, {}));
	const corpo: IDataObject = {};

	for (const [chave, valor] of Object.entries(colecao)) {
		if (valor === undefined || valor === '' || valor === null) continue;
		if (chave === 'etiquetas' || chave === 'etiquetasNovas') continue;

		if (CAMPOS_DE_LISTA.includes(chave)) {
			const lista = listaDeTexto(valor);
			if (lista !== undefined) corpo[chave] = lista;
			continue;
		}

		if (chave === 'email') {
			const email = emailNormalizado(valor);
			if (email !== undefined) corpo.email = email;
			continue;
		}

		corpo[chave] = valor;
	}

	const etiquetas = listaDeEtiquetas([
		...(Array.isArray(colecao.etiquetas) ? (colecao.etiquetas as string[]) : []),
		...(typeof colecao.etiquetasNovas === 'string' ? [colecao.etiquetasNovas] : []),
	]);
	if (etiquetas !== undefined) corpo.etiquetas = etiquetas;

	const endereco = secaoUnica(ctx, 'endereco', i);
	const enderecoAlternativo = secaoUnica(ctx, 'enderecoAlternativo', i);
	for (const [chave, valor] of Object.entries({ ...endereco, ...enderecoAlternativo })) {
		if (valor !== undefined && valor !== '' && valor !== null) corpo[chave] = valor;
	}

	return semIndefinidos(corpo);
}

/**
 * Resolve o blob `dados` respeitando a opcao de mesclagem.
 *
 * `PATCH /contatos/{id}` SUBSTITUI o blob inteiro: omitir uma chave apaga o
 * valor. Quem monta automacao espera PATCH-como-merge, entao a mesclagem e o
 * padrao — ao custo de uma leitura a mais, declarada na descricao da opcao.
 */
async function dadosParaGravar(
	ctx: IExecuteFunctions,
	i: number,
	contatoId?: string,
): Promise<IDataObject | undefined> {
	const informado = valoresDoMapeador(ctx.getNodeParameter('dados', i, {}));
	if (informado === undefined) return undefined;

	const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
	const deveMesclar = opcoes.mesclarCamposPersonalizados !== false;
	if (!deveMesclar || contatoId === undefined) return informado;

	const atual = await requisitar(ctx, { metodo: 'GET', caminho: `/contatos/${contatoId}` });
	const anteriores = objeto((atual.corpo as IDataObject).dados);
	return { ...anteriores, ...informado };
}

export async function executarContato(
	ctx: IExecuteFunctions,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	switch (operacao) {
		case 'listar': {
			const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
			const limite = ctx.getNodeParameter('limit', i, 50) as number;

			const query = filtrosSimples(ctx, 'filters', i, (chave, valor) =>
				chave === 'email' ? emailNormalizado(valor) : valor,
			);

			const dados = await requisitarLista(ctx, {
				metodo: 'GET',
				caminho: '/contatos',
				query,
				retornarTudo,
				limite,
				itemIndex: i,
			});
			return dados.map((contato) => item(contato, i));
		}

		case 'obter': {
			const id = idDoLocalizador(ctx, 'contatoId', 'contato', i);
			const resposta = await requisitar(ctx, { metodo: 'GET', caminho: `/contatos/${id}` });
			return [item(resposta.corpo, i)];
		}

		case 'verificarExistencia': {
			const id = idDoLocalizador(ctx, 'contatoId', 'contato', i);
			const resposta = await requisitar(ctx, {
				metodo: 'GET',
				caminho: `/contatos/${id}/existe`,
			});
			return [item(resposta.corpo, i)];
		}

		case 'listarAtividades': {
			const id = idDoLocalizador(ctx, 'contatoId', 'contato', i);
			const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
			const limite = ctx.getNodeParameter('limit', i, 50) as number;

			// Sem cursor nesta rota: o teto e 200, e "Retornar Tudo" so pede 200.
			const dados = await requisitarListaSimples(ctx, {
				metodo: 'GET',
				caminho: `/contatos/${id}/atividades`,
				query: { limite: retornarTudo ? 200 : Math.min(limite, 200) },
				retornarTudo,
				limite,
			});
			return dados.map((atividade) => item(atividade, i));
		}

		case 'excluir': {
			const id = idDoLocalizador(ctx, 'contatoId', 'contato', i);
			const resposta = await requisitar(ctx, {
				metodo: 'DELETE',
				caminho: `/contatos/${id}`,
			});
			return [item(resposta.corpo, i)];
		}

		case 'criar': {
			const corpo = corpoDoContato(ctx, i, 'additionalFields');
			const dados = await dadosParaGravar(ctx, i);
			if (dados !== undefined) corpo.dados = dados;

			// O servidor recusa com 422 e a mensagem
			// "Informe ao menos um identificador: nome, email, telefone, cpf ou
			// instagram." Conferir aqui poupa a viagem e nomeia o problema.
			const temIdentificador = IDENTIFICADORES.some(
				(campo) => typeof corpo[campo] === 'string' && (corpo[campo] as string).trim() !== '',
			);
			if (!temIdentificador) {
				throw new NodeOperationError(
					ctx.getNode(),
					'Um contato precisa de ao menos um identificador',
					{
						description:
							'Preencha ao menos um entre Nome, Email, Telefone, CPF e Instagram. Celular, Emails Adicionais e Telefones Adicionais nao contam para essa regra no servidor.',
						itemIndex: i,
					},
				);
			}

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: '/contatos',
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});
			return [item(propagarAvisos(ctx, resposta.corpo), i)];
		}

		case 'atualizar': {
			const id = idDoLocalizador(ctx, 'contatoId', 'contato', i);
			const corpo = corpoDoContato(ctx, i, 'updateFields');
			const dados = await dadosParaGravar(ctx, i, id);
			if (dados !== undefined) corpo.dados = dados;

			const chaves = Object.keys(corpo);
			if (chaves.length === 0) {
				throw new NodeOperationError(ctx.getNode(), 'Nenhum campo para atualizar', {
					description: 'Preencha ao menos um campo em "Campos a Atualizar"',
					itemIndex: i,
				});
			}
			// Um PATCH so com `etiquetas` devolve 422 no servidor: etiqueta nao e
			// coluna do contato, entao nao ha nada para gravar.
			if (chaves.length === 1 && chaves[0] === 'etiquetas') {
				throw new NodeOperationError(
					ctx.getNode(),
					'Atualizar apenas etiquetas nao e aceito pela API',
					{
						description:
							'Etiqueta nao e coluna do contato. Preencha tambem ao menos um campo de dado, ou use "Criar ou Atualizar".',
						itemIndex: i,
					},
				);
			}

			const resposta = await requisitar(ctx, {
				metodo: 'PATCH',
				caminho: `/contatos/${id}`,
				corpo,
			});
			return [item(propagarAvisos(ctx, resposta.corpo), i)];
		}

		case 'criarOuAtualizar': {
			const corpo = corpoDoContato(ctx, i, 'additionalFields');
			const dados = await dadosParaGravar(ctx, i);
			if (dados !== undefined) corpo.dados = dados;

			const chave = ctx.getNodeParameter('chave', i, []) as string[];
			const declaradas = chave.filter((slug) => slug !== '');
			if (declaradas.length > 0) {
				corpo.chave = declaradas.length === 1 ? declaradas[0] : declaradas;

				// Semantica contraintuitiva do servidor: com `chave` declarada,
				// TODOS os campos listados passam a ser exigidos no corpo. E "e" na
				// exigencia e "ou" no casamento.
				const ausentes = declaradas.filter(
					(slug) => corpo[slug] === undefined || corpo[slug] === '',
				);
				if (ausentes.length > 0) {
					throw new NodeOperationError(
						ctx.getNode(),
						`Chave de casamento declarada sem o valor correspondente: ${ausentes.join(', ')}`,
						{
							description:
								'Declarar a chave torna todos os campos escolhidos obrigatorios no corpo. Preencha-os em "Campos Adicionais" ou remova-os da chave.',
							itemIndex: i,
						},
					);
				}
			}

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: '/contatos/upsert',
				corpo,
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});

			// 201 criou, 200 atualizou — a especificacao declara so 201, entao quem
			// decide e o status junto do campo `criado`. `casou_por` diz QUAL campo
			// de indice decidiu, e e a unica pista de por que a ficha errada foi
			// atualizada: descarta-lo cega o diagnostico.
			const saida = propagarAvisos(ctx, resposta.corpo);
			return [
				item(
					{
						...saida,
						__criado: saida.criado === true || resposta.status === 201,
						__casouPor: saida.casou_por ?? null,
						__statusHttp: resposta.status,
					},
					i,
				),
			];
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Contato`,
				{ itemIndex: i },
			);
	}
}

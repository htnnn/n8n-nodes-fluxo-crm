import type { IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { requisitar, requisitarListaSimples } from '../compartilhado/transporte';
import {
	cabecalhoDeIdempotencia,
	exigirUuid,
	itemDeSaida as item,
	objeto,
	slugDoModulo,
	texto,
} from '../compartilhado/utilitarios';

/**
 * Notas de um registro.
 *
 * Duas particularidades que o resto da API nao tem:
 *
 * - a exclusao e HARD DELETE (a linha some do banco), enquanto os demais
 *   recursos fazem exclusao logica;
 * - so o POST emite webhook (`nota.criada`); PATCH e DELETE nao emitem nada.
 *
 * E a permissao de modulo cobrada por POST, PATCH e DELETE e a de EDICAO, e nao
 * a de criacao ou remocao — uma chave que so pode criar no modulo recebe 403
 * aqui.
 */
export async function executarNota(
	ctx: IExecuteFunctions,
	operacao: string,
	i: number,
): Promise<INodeExecutionData[]> {
	const slug = slugDoModulo(ctx, 'moduloSlug', i);
	const registroId = exigirUuid(ctx, ctx.getNodeParameter('registroId', i), 'registro', i);
	const base = `/modulos/${encodeURIComponent(slug)}/registros/${registroId}/notas`;

	switch (operacao) {
		case 'listar': {
			const retornarTudo = ctx.getNodeParameter('returnAll', i, false) as boolean;
			const limite = ctx.getNodeParameter('limit', i, 50) as number;

			// Sem cursor nesta rota: o teto e 200 e "Retornar Tudo" so pede 200.
			const dados = await requisitarListaSimples(ctx, {
				metodo: 'GET',
				caminho: base,
				query: { limite: retornarTudo ? 200 : Math.min(Math.max(1, Math.trunc(limite)), 200) },
				retornarTudo,
				limite,
			});
			return dados.map((nota) => item(nota, i));
		}

		case 'criar':
		case 'atualizar': {
			const conteudo = texto(ctx.getNodeParameter('texto', i, '')).trim();
			if (conteudo === '') {
				throw new NodeOperationError(ctx.getNode(), 'A nota precisa de texto', {
					description: 'O texto e obrigatorio, de 1 a 10000 caracteres.',
					itemIndex: i,
				});
			}

			if (operacao === 'atualizar') {
				const notaId = exigirUuid(ctx, ctx.getNodeParameter('notaId', i), 'nota', i);
				const resposta = await requisitar(ctx, {
					metodo: 'PATCH',
					caminho: `${base}/${notaId}`,
					corpo: { texto: conteudo },
				});
				return [item(resposta.corpo, i)];
			}

			const opcoes = objeto(ctx.getNodeParameter('options', i, {}));
			const resposta = await requisitar(ctx, {
				metodo: 'POST',
				caminho: base,
				corpo: { texto: conteudo },
				cabecalhos: cabecalhoDeIdempotencia(opcoes.idempotencyKey),
			});
			return [item(resposta.corpo, i)];
		}

		case 'excluir': {
			const notaId = exigirUuid(ctx, ctx.getNodeParameter('notaId', i), 'nota', i);
			const resposta = await requisitar(ctx, {
				metodo: 'DELETE',
				caminho: `${base}/${notaId}`,
			});
			return [item(resposta.corpo, i)];
		}

		default:
			throw new NodeOperationError(
				ctx.getNode(),
				`A operacao "${operacao}" nao existe no recurso Nota`,
				{ itemIndex: i },
			);
	}
}

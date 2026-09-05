import type { ILoadOptionsFunctions, ResourceMapperFields } from 'n8n-workflow';

import { camposDoModulo } from '../compartilhado/capacidades';
import {
	camposParaMapeador,
	sistemaAceito,
	sistemaAceitoNoRecurso,
} from '../compartilhado/mapeador';

/**
 * Os `resourceMapper` de campos definidos pela organizacao.
 *
 * Sao cinco metodos porque sao cinco modulos diferentes, e o `resourceMapper`
 * do n8n nomeia o metodo dentro do proprio parametro. A conversao em si mora em
 * `compartilhado/mapeador.ts`, que e puro e testado.
 *
 * A razao de existirem esta escrita la: a obrigatoriedade de cada campo vem do
 * LAYOUT da organizacao, entao o mesmo corpo devolve 201 numa org e 422 noutra.
 * Nenhuma lista chumbada no node acerta isso — so uma leitura em tempo de
 * edicao, na org daquela credencial.
 *
 * Os campos de SISTEMA (responsavel, equipe) entram no mapper so quando a
 * operacao atual os aceita no topo do corpo — `SISTEMA_ACEITO_NA_ESCRITA`, no
 * mapeador, e a tabela conferida rota a rota. A operacao vem de
 * `getCurrentNodeParameter('operation')`; quando ela nao esta ao alcance, vale
 * a uniao do recurso, e a execucao recusa o que sobrar.
 */

function operacaoAtual(ctx: ILoadOptionsFunctions): string {
	const bruto = ctx.getCurrentNodeParameter('operation');
	return typeof bruto === 'string' ? bruto : '';
}

/** Campos de sistema aceitos pela operacao atual, ou pela uniao do recurso. */
function deSistemaAceitos(ctx: ILoadOptionsFunctions, recurso: string): readonly string[] {
	const operacao = operacaoAtual(ctx);
	return operacao === '' ? sistemaAceitoNoRecurso(recurso) : sistemaAceito(recurso, operacao);
}

function mapeadorDe(slug: string, recurso: string) {
	return async function (this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
		return {
			fields: camposParaMapeador(await camposDoModulo(this, slug), {
				deSistemaAceitos: deSistemaAceitos(this, recurso),
			}),
		};
	};
}

export const mapearCamposDeContato = mapeadorDe('contatos', 'contato');
export const mapearCamposDeEmpresa = mapeadorDe('empresas', 'empresa');
export const mapearCamposDeNegocio = mapeadorDe('negocios', 'negocio');
/**
 * Atividades sao registros do modulo `tarefas` — o slug nao coincide com o
 * nome. O dicionario de `tarefas` anuncia `dono_id` e `equipe_id`, mas
 * `POST/PATCH /atividades` nao os aceita (o responsavel ali e `usuario_id`),
 * entao a tabela do mapeador os deixa de fora deste mapper.
 */
export const mapearCamposDeAtividade = mapeadorDe('tarefas', 'atividade');

/**
 * O mapeador de Registro, que depende do modulo escolhido no painel.
 *
 * Sem modulo selecionado, devolve a lista vazia com um aviso em vez de tentar
 * `/modulos//campos` — que seria 404 e chegaria ao usuario como "modulo nao
 * encontrado" quando o problema e nao ter escolhido nenhum.
 */
export async function mapearCamposDoModulo(
	this: ILoadOptionsFunctions,
): Promise<ResourceMapperFields> {
	const bruto = this.getCurrentNodeParameter('moduloSlug');
	const slug = typeof bruto === 'string' ? bruto.trim() : '';

	if (slug === '') {
		return {
			fields: [],
			emptyFieldsNotice: 'Escolha o modulo primeiro: o dicionario de campos e por modulo.',
		};
	}

	return {
		fields: camposParaMapeador(await camposDoModulo(this, slug), {
			deSistemaAceitos: deSistemaAceitos(this, 'registro'),
		}),
	};
}

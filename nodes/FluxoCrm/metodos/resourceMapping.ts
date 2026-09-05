import type { ILoadOptionsFunctions, ResourceMapperFields } from 'n8n-workflow';

import { camposDoModulo } from '../compartilhado/capacidades';
import { camposParaMapeador } from '../compartilhado/mapeador';

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
 */

function mapeadorDe(slug: string) {
	return async function (this: ILoadOptionsFunctions): Promise<ResourceMapperFields> {
		return { fields: camposParaMapeador(await camposDoModulo(this, slug)) };
	};
}

export const mapearCamposDeContato = mapeadorDe('contatos');
export const mapearCamposDeEmpresa = mapeadorDe('empresas');
export const mapearCamposDeNegocio = mapeadorDe('negocios');
/** Atividades sao registros do modulo `tarefas` — o slug nao coincide com o nome. */
export const mapearCamposDeAtividade = mapeadorDe('tarefas');

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

	return { fields: camposParaMapeador(await camposDoModulo(this, slug)) };
}

import type { IDataObject, ILoadOptionsFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import {
	CORINGA_DE_EVENTOS,
	EVENTOS_CONHECIDOS,
	EVENTOS_DO_SERVIDOR,
	opcoesDeEvento,
	rotuloDoEvento,
} from '../nodes/FluxoCrm/compartilhado/eventos';
import { carregarEventosWebhook } from '../nodes/FluxoCrm/metodos/loadOptions';
import { EVENTOS_CONHECIDOS as DO_GATILHO } from '../nodes/FluxoCrmTrigger/catalogo';
import { carregarEventos } from '../nodes/FluxoCrmTrigger/metodos';

/**
 * A tabela de eventos e o fallback dos dois dropdowns.
 *
 * O que estes testes travam: a lista e EXATAMENTE `EVENTOS_DISPONIVEIS` do
 * servidor (`api-publica/webhooks.ts`, l.23-77), na ordem; todo evento tem
 * rotulo proprio; e os dois `multiOptions` — do gatilho e de `Webhook › Criar`
 * — caem para a mesma lista quando `GET /webhooks/eventos` nao responde.
 */

const EVENTOS_DISPONIVEIS_NO_SERVIDOR = [
	'contato.criado',
	'contato.atualizado',
	'contato.removido',
	'empresa.criada',
	'empresa.atualizada',
	'empresa.removida',
	'lead.criado',
	'lead.atualizado',
	'lead.convertido',
	'lead.removido',
	'negocio.criado',
	'negocio.atualizado',
	'negocio.estagio_alterado',
	'negocio.ganho',
	'negocio.perdido',
	'negocio.removido',
	'atividade.criada',
	'atividade.atualizada',
	'atividade.concluida',
	'interacao.criada',
	'interacao.atualizada',
	'interacao.removida',
	'registro.criado',
	'registro.atualizado',
	'registro.removido',
	'nota.criada',
	'etiqueta.adicionada',
	'etiqueta.removida',
	'conversa.iniciada',
	'conversa.resolvida',
	'mensagem.recebida',
	'mensagem.enviada',
	'automacao.executada',
	'automacao.falhou',
];

const BASE = 'https://api-crm.nafluxo.com.br/v1';

function criarContexto(
	responder: () => IDataObject,
): { ctx: ILoadOptionsFunctions; caminhos: string[]; avisos: string[] } {
	const caminhos: string[] = [];
	const avisos: string[] = [];
	const ctx = {
		getNode: () => ({ name: 'Fluxo CRM', type: 'fluxoCrm', typeVersion: 1 }),
		getCredentials: async () => ({
			baseUrl: BASE,
			apiKey: `flx_test_${Math.random().toString(36).slice(2)}`,
		}),
		logger: {
			debug: (mensagem: string) => {
				avisos.push(mensagem);
			},
			info: () => undefined,
			warn: () => undefined,
			error: () => undefined,
		},
		helpers: {
			httpRequestWithAuthentication: async (_credencial: string, requisicao: IDataObject) => {
				const url = String(requisicao.url);
				caminhos.push(url.startsWith(BASE) ? url.slice(BASE.length) : url);
				return { body: responder(), statusCode: 200, headers: {} };
			},
		},
	} as unknown as ILoadOptionsFunctions;

	return { ctx, caminhos, avisos };
}

function recusarCom(status: number, codigo: string): () => IDataObject {
	return () => {
		throw { statusCode: status, response: { body: { erro: { codigo, mensagem: codigo } } } };
	};
}

/** O que o helper levanta quando nao ha resposta HTTP nenhuma. */
function semRede(): () => IDataObject {
	return () => {
		throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:443'), {
			code: 'ECONNREFUSED',
		});
	};
}

describe('a tabela de eventos', () => {
	it('e exatamente EVENTOS_DISPONIVEIS do servidor, os 34, na mesma ordem', () => {
		expect([...EVENTOS_CONHECIDOS]).toEqual(EVENTOS_DISPONIVEIS_NO_SERVIDOR);
		expect(EVENTOS_CONHECIDOS).toHaveLength(34);
		expect(EVENTOS_CONHECIDOS).not.toContain('webhook.teste');
		expect(EVENTOS_CONHECIDOS).not.toContain(CORINGA_DE_EVENTOS);
	});

	it('o gatilho reexporta a MESMA lista — nao ha duas copias para divergir', () => {
		expect(DO_GATILHO).toBe(EVENTOS_CONHECIDOS);
	});

	it('todo evento tem rotulo proprio, em portugues, e nenhum rotulo se repete', () => {
		const rotulos = new Set<string>();
		for (const evento of EVENTOS_DO_SERVIDOR) {
			expect(evento.rotulo.trim(), evento.valor).not.toBe('');
			expect(evento.rotulo, evento.valor).toContain(' › ');
			expect(rotuloDoEvento(evento.valor)).toBe(evento.rotulo);
			rotulos.add(evento.rotulo);
		}
		expect(rotulos.size).toBe(EVENTOS_DO_SERVIDOR.length);
	});

	it('os oito eventos novos levam o rotulo pt-BR e dizem que exigem a API atual', () => {
		const novos: Record<string, string> = {
			'etiqueta.adicionada': 'Etiqueta › Adicionada',
			'etiqueta.removida': 'Etiqueta › Removida',
			'conversa.iniciada': 'Atendimento › Conversa Iniciada',
			'conversa.resolvida': 'Atendimento › Conversa Resolvida',
			'mensagem.recebida': 'Atendimento › Mensagem Recebida',
			'mensagem.enviada': 'Atendimento › Mensagem Enviada',
			'automacao.executada': 'Automacao › Executada',
			'automacao.falhou': 'Automacao › Falhou',
		};

		const opcoes = new Map(opcoesDeEvento(EVENTOS_CONHECIDOS).map((opcao) => [opcao.value, opcao]));
		for (const [valor, rotulo] of Object.entries(novos)) {
			expect(rotuloDoEvento(valor)).toBe(rotulo);
			const opcao = opcoes.get(valor)!;
			expect(opcao.name).toBe(rotulo);
			expect(opcao.description).toContain('instancia anterior');
			expect(opcao.description).toContain(`Identificador na API: ${valor}`);
		}
		// Os de atendimento precisam ser achaveis por "WhatsApp".
		expect(opcoes.get('mensagem.recebida')!.description).toContain('WhatsApp');
	});

	it('os rotulos dos 26 eventos antigos nao mudaram', () => {
		expect(rotuloDoEvento('negocio.estagio_alterado')).toBe('Negocio › Estagio Alterado');
		expect(rotuloDoEvento('nota.criada')).toBe('Nota › Criada');
		expect(rotuloDoEvento('interacao.removida')).toBe('Interacao › Removida');
		expect(rotuloDoEvento(CORINGA_DE_EVENTOS)).toBe('Todos os Eventos');
	});

	it('evento que o servidor mande e a tabela nao conheca ganha rotulo derivado, nao some', () => {
		expect(rotuloDoEvento('pipeline.estagio_criado')).toBe('Pipeline › Estagio Criado');
		const opcoes = opcoesDeEvento(['pipeline.estagio_criado']);
		expect(opcoes.map((opcao) => opcao.value)).toEqual([CORINGA_DE_EVENTOS, 'pipeline.estagio_criado']);
		expect(opcoes[1].description).toBe('Identificador na API: pipeline.estagio_criado');
	});
});

describe('o fallback e o mesmo nos dois nodes', () => {
	const carregadores: Array<[string, (this: ILoadOptionsFunctions) => Promise<unknown>]> = [
		['Fluxo CRM › Webhook › Criar', carregarEventosWebhook],
		['Fluxo CRM Trigger › Eventos', carregarEventos],
	];

	for (const [nome, carregar] of carregadores) {
		it(`${nome}: sem webhooks:ler (403) cai para os 34 eventos, com o coringa primeiro`, async () => {
			const { ctx, caminhos, avisos } = criarContexto(recusarCom(403, 'escopo_insuficiente'));
			const opcoes = (await carregar.call(ctx)) as Array<{ name: string; value: string }>;

			expect(caminhos).toEqual(['/webhooks/eventos']);
			expect(opcoes).toHaveLength(35);
			expect(opcoes[0]).toMatchObject({ value: CORINGA_DE_EVENTOS, name: 'Todos os Eventos' });
			expect(opcoes.slice(1).map((opcao) => opcao.value)).toEqual(EVENTOS_DISPONIVEIS_NO_SERVIDOR);
			for (const opcao of opcoes) expect(opcao.name).not.toBe(opcao.value);
			expect(avisos.some((aviso) => aviso.includes('lista estatica'))).toBe(true);
		});

		it(`${nome}: com o servidor respondendo, a lista dele prevalece e ganha os rotulos`, async () => {
			const { ctx } = criarContexto(() => ({
				dados: ['contato.criado', 'mensagem.recebida', 'novo.evento_futuro'],
			}));
			const opcoes = (await carregar.call(ctx)) as Array<{ name: string; value: string }>;

			expect(opcoes.map((opcao) => opcao.value)).toEqual([
				CORINGA_DE_EVENTOS,
				'contato.criado',
				'mensagem.recebida',
				'novo.evento_futuro',
			]);
			expect(opcoes.map((opcao) => opcao.name)).toEqual([
				'Todos os Eventos',
				'Contato › Criado',
				'Atendimento › Mensagem Recebida',
				'Novo › Evento Futuro',
			]);
		});

		it(`${nome}: resposta sem lista tambem cai para a estatica`, async () => {
			const { ctx } = criarContexto(() => ({ dados: [] }));
			const opcoes = (await carregar.call(ctx)) as Array<{ value: string }>;
			expect(opcoes).toHaveLength(35);
		});

		it(`${nome}: 404 (instancia sem a rota) tambem cai para os 34 eventos`, async () => {
			const { ctx, avisos } = criarContexto(recusarCom(404, 'nao_encontrado'));
			const opcoes = (await carregar.call(ctx)) as Array<{ value: string }>;

			expect(opcoes).toHaveLength(35);
			expect(opcoes.slice(1).map((opcao) => opcao.value)).toEqual(EVENTOS_DISPONIVEIS_NO_SERVIDOR);
			expect(avisos.some((aviso) => aviso.includes('lista estatica'))).toBe(true);
		});

		it(`${nome}: 401 SOBE com credencial recusada, em vez de disfarcar de lista estatica`, async () => {
			const { ctx } = criarContexto(recusarCom(401, 'chave_invalida'));

			await expect(carregar.call(ctx)).rejects.toMatchObject({
				httpCode: '401',
				description: expect.stringContaining('chave_invalida'),
			});
		});

		it(`${nome}: 500 SOBE nomeando o status — a lista estatica nao esconde servidor fora`, async () => {
			const { ctx } = criarContexto(recusarCom(500, 'erro_interno'));

			await expect(carregar.call(ctx)).rejects.toMatchObject({
				httpCode: '500',
				description: expect.stringContaining('erro interno'),
			});
		});

		it(`${nome}: rede fora SOBE como conectividade, nao como lista estatica`, async () => {
			const { ctx } = criarContexto(semRede());

			await expect(carregar.call(ctx)).rejects.toMatchObject({
				description: expect.stringContaining('conectividade'),
			});
		});
	}
});

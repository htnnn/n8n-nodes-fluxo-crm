import type { INodePropertyOptions } from 'n8n-workflow';

import { temEscopo, type EstadoDeEscopos } from './escopos';

/**
 * Catalogo dos recursos e operacoes expostos por este node.
 *
 * Esta lista e a fonte unica de tres coisas que precisam concordar entre si:
 * o array `options` ESTATICO (que o painel de Actions do node creator le, e que
 * nunca conhece credencial nenhuma), a lista REMOTA do dropdown (que filtra por
 * escopo) e a catraca de execucao. Mantidas em arquivos diferentes, elas
 * divergem — e a divergencia aparece como o erro generico do n8n
 * (`The value "x" is not supported!`), que nao diz nada a ninguem.
 */

export interface OperacaoDoCatalogo {
	valor: string;
	/** Title Case, curto — e o rotulo do dropdown. */
	nome: string;
	/** Sentence case, sem ponto final — e o texto da busca de acoes do canvas. */
	acao: string;
	descricao: string;
	/** `null` para operacao que nao exige escopo algum. */
	escopo: string | null;
}

export interface RecursoDoCatalogo {
	valor: string;
	nome: string;
	descricao: string;
	operacaoPadrao: string;
	operacoes: OperacaoDoCatalogo[];
}

/** Prefixo do rotulo de operacao que a chave atual nao pode executar. */
export const MARCA_DE_CADEADO = '\u{1F512} ';

export const RECURSOS: RecursoDoCatalogo[] = [
	{
		valor: 'contato',
		nome: 'Contato',
		descricao: 'Fichas de pessoas do CRM',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'atualizar',
				nome: 'Atualizar',
				acao: 'Atualizar um contato',
				descricao: 'Alterar campos de um contato existente',
				escopo: 'contatos:escrever',
			},
			{
				valor: 'criar',
				nome: 'Criar',
				acao: 'Criar um contato',
				descricao: 'Criar uma ficha de contato',
				escopo: 'contatos:escrever',
			},
			{
				valor: 'criarOuAtualizar',
				nome: 'Criar ou Atualizar',
				acao: 'Criar ou atualizar um contato',
				descricao: 'Casar por um campo de indice e criar quando nao existir',
				escopo: 'contatos:escrever',
			},
			{
				valor: 'excluir',
				nome: 'Excluir',
				acao: 'Excluir um contato',
				descricao: 'Remover uma ficha de contato',
				escopo: 'contatos:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar contatos',
				descricao: 'Listar contatos com filtros e paginacao',
				escopo: 'contatos:ler',
			},
			{
				valor: 'listarAtividades',
				nome: 'Listar Atividades',
				acao: 'Listar as atividades de um contato',
				// Escopo cruzado: esta operacao vive em Contato mas consome
				// `atividades:ler`. E a causa mais comum de "por que esta operacao
				// esta com cadeado?".
				descricao: 'Listar as atividades ligadas a um contato',
				escopo: 'atividades:ler',
			},
			{
				valor: 'obter',
				nome: 'Obter',
				acao: 'Obter um contato',
				descricao: 'Buscar um contato pelo identificador',
				escopo: 'contatos:ler',
			},
			{
				valor: 'verificarExistencia',
				nome: 'Verificar Existencia',
				acao: 'Verificar se um contato existe',
				descricao: 'Conferir se um identificador corresponde a um contato',
				escopo: 'contatos:ler',
			},
		],
	},
	{
		valor: 'negocio',
		nome: 'Negocio',
		descricao: 'Oportunidades comerciais dentro de um funil',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'atualizar',
				nome: 'Atualizar',
				acao: 'Atualizar um negocio',
				descricao: 'Alterar os valores de um negocio existente',
				escopo: 'negocios:escrever',
			},
			{
				valor: 'criar',
				nome: 'Criar',
				acao: 'Criar um negocio',
				descricao: 'Criar uma oportunidade no primeiro estagio aberto da pipeline',
				escopo: 'negocios:escrever',
			},
			{
				valor: 'criarOuAtualizar',
				nome: 'Criar ou Atualizar',
				acao: 'Criar ou atualizar um negocio pelo contato',
				descricao: 'Casar pelo contato e criar quando nao existir',
				escopo: 'negocios:escrever',
			},
			{
				valor: 'excluir',
				nome: 'Excluir',
				acao: 'Excluir um negocio',
				descricao: 'Remover uma oportunidade',
				escopo: 'negocios:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar negocios',
				descricao: 'Listar oportunidades com filtros e paginacao',
				escopo: 'negocios:ler',
			},
			{
				valor: 'marcarGanho',
				nome: 'Marcar Como Ganho',
				acao: 'Marcar um negocio como ganho',
				descricao: 'Mover a oportunidade para um estagio do tipo ganho',
				escopo: 'negocios:escrever',
			},
			{
				valor: 'marcarPerdido',
				nome: 'Marcar Como Perdido',
				acao: 'Marcar um negocio como perdido',
				descricao: 'Mover a oportunidade para um estagio do tipo perdido',
				escopo: 'negocios:escrever',
			},
			{
				valor: 'mover',
				nome: 'Mover',
				acao: 'Mover um negocio de estagio',
				descricao: 'Levar a oportunidade para outro estagio, inclusive de outra pipeline',
				escopo: 'negocios:escrever',
			},
			{
				valor: 'obter',
				nome: 'Obter',
				acao: 'Obter um negocio',
				descricao: 'Buscar uma oportunidade pelo identificador',
				escopo: 'negocios:ler',
			},
		],
	},
	{
		valor: 'empresa',
		nome: 'Empresa',
		descricao: 'Fichas de organizacoes clientes e fornecedoras',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'atualizar',
				nome: 'Atualizar',
				acao: 'Atualizar uma empresa',
				descricao: 'Alterar campos de uma empresa existente',
				escopo: 'empresas:escrever',
			},
			{
				valor: 'criar',
				nome: 'Criar',
				acao: 'Criar uma empresa',
				descricao: 'Criar uma ficha de empresa',
				escopo: 'empresas:escrever',
			},
			{
				valor: 'criarOuAtualizar',
				nome: 'Criar ou Atualizar',
				acao: 'Criar ou atualizar uma empresa',
				descricao: 'Casar por CNPJ, site ou nome e criar quando nao existir',
				escopo: 'empresas:escrever',
			},
			{
				valor: 'excluir',
				nome: 'Excluir',
				acao: 'Excluir uma empresa',
				descricao: 'Remover uma ficha de empresa',
				escopo: 'empresas:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar empresas',
				descricao: 'Listar empresas com filtros e paginacao',
				escopo: 'empresas:ler',
			},
			{
				valor: 'listarContatos',
				nome: 'Listar Contatos',
				acao: 'Listar os contatos de uma empresa',
				// Escopo cruzado: vive em Empresa e consome `contatos:ler`.
				descricao: 'Listar as pessoas vinculadas a uma empresa',
				escopo: 'contatos:ler',
			},
			{
				valor: 'listarNegocios',
				nome: 'Listar Negocios',
				acao: 'Listar os negocios de uma empresa',
				// Escopo cruzado: vive em Empresa e consome `negocios:ler`.
				descricao: 'Listar as oportunidades vinculadas a uma empresa',
				escopo: 'negocios:ler',
			},
			{
				valor: 'obter',
				nome: 'Obter',
				acao: 'Obter uma empresa',
				descricao: 'Buscar uma empresa pelo identificador',
				escopo: 'empresas:ler',
			},
		],
	},
	{
		valor: 'lead',
		nome: 'Lead',
		descricao: 'Contatos ainda nao qualificados, antes de virarem ficha',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'atualizar',
				nome: 'Atualizar',
				acao: 'Atualizar um lead',
				descricao: 'Alterar campos de um lead existente',
				escopo: 'leads:escrever',
			},
			{
				valor: 'converter',
				nome: 'Converter',
				acao: 'Converter um lead em contato, empresa e negocio',
				descricao: 'Promover o lead criando as fichas escolhidas',
				escopo: 'leads:escrever',
			},
			{
				valor: 'criar',
				nome: 'Criar',
				acao: 'Criar um lead',
				descricao: 'Registrar um contato ainda nao qualificado',
				escopo: 'leads:escrever',
			},
			{
				valor: 'excluir',
				nome: 'Excluir',
				acao: 'Excluir um lead',
				descricao: 'Remover um lead',
				escopo: 'leads:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar leads',
				descricao: 'Listar leads com filtros e paginacao',
				escopo: 'leads:ler',
			},
			{
				valor: 'obter',
				nome: 'Obter',
				acao: 'Obter um lead',
				descricao: 'Buscar um lead pelo identificador',
				escopo: 'leads:ler',
			},
		],
	},
	{
		valor: 'pipeline',
		nome: 'Pipeline',
		descricao: 'Funis e seus estagios',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'criarOuAtualizar',
				nome: 'Criar ou Atualizar',
				acao: 'Criar ou atualizar uma pipeline',
				descricao: 'Casar a pipeline pelo nome dentro do modulo',
				escopo: 'pipelines:escrever',
			},
			{
				valor: 'criarOuAtualizarEstagio',
				nome: 'Criar ou Atualizar Estagio',
				acao: 'Criar ou atualizar um estagio da pipeline',
				descricao: 'Casar o estagio pelo nome dentro da pipeline',
				escopo: 'pipelines:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar pipelines e estagios',
				// Escopo cruzado: a leitura de funis mora sob `meta:ler`, e nao sob
				// `pipelines:ler` — que existe no catalogo do CRM e nao libera nada.
				descricao: 'Listar os funis da organizacao com os estagios aninhados',
				escopo: 'meta:ler',
			},
		],
	},
	{
		valor: 'atividade',
		nome: 'Atividade',
		descricao: 'Tarefas, ligacoes e reunioes ligadas a uma entidade',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'atualizar',
				nome: 'Atualizar',
				acao: 'Atualizar uma atividade',
				descricao: 'Alterar campos de uma atividade existente',
				escopo: 'atividades:escrever',
			},
			{
				valor: 'concluir',
				nome: 'Concluir',
				acao: 'Concluir uma atividade',
				descricao: 'Marcar a atividade como concluida e registrar o feedback',
				escopo: 'atividades:escrever',
			},
			{
				valor: 'criar',
				nome: 'Criar',
				acao: 'Criar uma atividade',
				descricao: 'Registrar uma tarefa ligada a uma entidade do CRM',
				escopo: 'atividades:escrever',
			},
			{
				valor: 'excluir',
				nome: 'Excluir',
				acao: 'Excluir uma atividade',
				descricao: 'Remover uma atividade',
				escopo: 'atividades:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar atividades',
				descricao: 'Listar atividades com filtros e paginacao',
				escopo: 'atividades:ler',
			},
			{
				valor: 'obter',
				nome: 'Obter',
				acao: 'Obter uma atividade',
				descricao: 'Buscar uma atividade pelo identificador',
				escopo: 'atividades:ler',
			},
		],
	},
	{
		valor: 'registro',
		nome: 'Registro',
		descricao: 'Linhas de qualquer modulo, inclusive os personalizados',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'atualizar',
				nome: 'Atualizar',
				acao: 'Atualizar um registro',
				descricao: 'Mesclar valores num registro existente',
				escopo: 'registros:escrever',
			},
			{
				valor: 'criar',
				nome: 'Criar',
				acao: 'Criar um registro',
				descricao: 'Criar uma linha no modulo escolhido',
				escopo: 'registros:escrever',
			},
			{
				valor: 'excluir',
				nome: 'Excluir',
				acao: 'Excluir um registro',
				descricao: 'Remover uma linha do modulo',
				escopo: 'registros:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar registros de um modulo',
				descricao: 'Listar linhas com filtros por campo e paginacao',
				escopo: 'registros:ler',
			},
			{
				valor: 'listarHistorico',
				nome: 'Listar Historico',
				acao: 'Listar o historico de alteracoes de um registro',
				descricao: 'Ler o rastro de alteracoes; unica rota em camelCase e paginada por pagina',
				escopo: 'registros:ler',
			},
			{
				valor: 'obter',
				nome: 'Obter',
				acao: 'Obter um registro',
				descricao: 'Buscar uma linha pelo identificador',
				escopo: 'registros:ler',
			},
		],
	},
	{
		valor: 'nota',
		nome: 'Nota',
		descricao: 'Anotacoes de texto presas a um registro',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'atualizar',
				nome: 'Atualizar',
				acao: 'Atualizar uma nota',
				descricao: 'Trocar o texto de uma nota existente',
				escopo: 'notas:escrever',
			},
			{
				valor: 'criar',
				nome: 'Criar',
				acao: 'Criar uma nota',
				descricao: 'Anotar um texto num registro',
				escopo: 'notas:escrever',
			},
			{
				valor: 'excluir',
				nome: 'Excluir',
				acao: 'Excluir uma nota',
				descricao: 'Apagar a nota em definitivo, sem lixeira',
				escopo: 'notas:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar as notas de um registro',
				descricao: 'Listar as anotacoes de uma linha do modulo',
				escopo: 'notas:ler',
			},
		],
	},
	{
		valor: 'arquivo',
		nome: 'Arquivo',
		descricao: 'Vinculos entre uma entidade e um arquivo ja hospedado',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'criar',
				nome: 'Registrar',
				acao: 'Registrar um anexo',
				descricao: 'Gravar o vinculo entre a entidade e uma URL ja hospedada',
				escopo: 'arquivos:escrever',
			},
			{
				valor: 'excluir',
				nome: 'Excluir',
				acao: 'Excluir um anexo',
				descricao: 'Remover o vinculo do arquivo com a entidade',
				escopo: 'arquivos:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar os anexos de uma entidade',
				descricao: 'Listar os arquivos de uma entidade; exige tipo e identificador',
				escopo: 'arquivos:ler',
			},
			{
				valor: 'obter',
				nome: 'Obter',
				acao: 'Obter um anexo',
				descricao: 'Buscar um anexo pelo identificador',
				escopo: 'arquivos:ler',
			},
		],
	},
	{
		valor: 'lote',
		nome: 'Lote',
		descricao: 'Gravacao de ate 200 fichas numa requisicao so',
		operacaoPadrao: 'gravarContatos',
		operacoes: [
			{
				valor: 'gravarContatos',
				nome: 'Gravar Contatos',
				acao: 'Gravar contatos em lote',
				descricao: 'Enviar ate 200 contatos e receber um item de saida por linha',
				escopo: 'contatos:escrever',
			},
			{
				valor: 'gravarEmpresas',
				nome: 'Gravar Empresas',
				acao: 'Gravar empresas em lote',
				descricao: 'Enviar ate 200 empresas e receber um item de saida por linha',
				escopo: 'empresas:escrever',
			},
			{
				valor: 'gravarLeads',
				nome: 'Gravar Leads',
				acao: 'Gravar leads em lote',
				descricao: 'Enviar ate 200 leads e receber um item de saida por linha',
				escopo: 'leads:escrever',
			},
		],
	},
	{
		valor: 'conversa',
		nome: 'Conversa',
		descricao: 'Atendimentos abertos nos canais de mensageria',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'atualizar',
				nome: 'Atualizar',
				acao: 'Atualizar o status ou o responsavel de uma conversa',
				descricao: 'Trocar o status do atendimento ou quem responde por ele',
				escopo: 'atendimento:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar conversas',
				descricao: 'Listar atendimentos; esta lista pagina por data, nao por cursor',
				escopo: 'atendimento:ler',
			},
			{
				valor: 'obter',
				nome: 'Obter',
				acao: 'Obter uma conversa',
				descricao: 'Buscar um atendimento pelo identificador',
				escopo: 'atendimento:ler',
			},
		],
	},
	{
		valor: 'mensagem',
		nome: 'Mensagem',
		descricao: 'Mensagens e notas internas dentro de uma conversa',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'criarNotaInterna',
				nome: 'Criar Nota Interna',
				acao: 'Registrar uma nota interna na conversa',
				descricao: 'Gravar um recado que a equipe ve e o contato nao',
				escopo: 'atendimento:escrever',
			},
			{
				valor: 'enviar',
				nome: 'Enviar',
				acao: 'Enviar uma mensagem ao contato',
				descricao: 'Mandar texto pelo canal do atendimento; midia ainda nao e aceita',
				escopo: 'atendimento:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar as mensagens de uma conversa',
				descricao: 'Ler ate 200 mensagens, da mais recente para a mais antiga',
				escopo: 'atendimento:ler',
			},
		],
	},
	{
		valor: 'canalAtendimento',
		nome: 'Canal de Atendimento',
		descricao: 'Canais conectados ao atendimento da organizacao',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar canais de atendimento',
				descricao: 'Listar os canais conectados e o status de cada um',
				escopo: 'atendimento:ler',
			},
		],
	},
	{
		valor: 'agenteAtendimento',
		nome: 'Agente de Atendimento',
		descricao: 'Pessoas habilitadas a responder atendimentos',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar agentes de atendimento',
				descricao: 'Listar quem pode assumir um atendimento',
				escopo: 'atendimento:ler',
			},
		],
	},
	{
		valor: 'webhook',
		nome: 'Webhook',
		descricao: 'Assinaturas de evento e as entregas de cada uma',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'atualizar',
				nome: 'Atualizar',
				acao: 'Atualizar uma assinatura de webhook',
				descricao: 'Trocar URL, eventos ou reativar a assinatura desligada',
				escopo: 'webhooks:escrever',
			},
			{
				valor: 'criar',
				nome: 'Criar',
				acao: 'Criar uma assinatura de webhook',
				descricao: 'Assinar eventos; o segredo aparece SO nesta resposta',
				escopo: 'webhooks:escrever',
			},
			{
				valor: 'excluir',
				nome: 'Excluir',
				acao: 'Excluir uma assinatura de webhook',
				descricao: 'Cancelar a assinatura de eventos',
				escopo: 'webhooks:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar assinaturas de webhook',
				descricao: 'Listar as assinaturas da organizacao',
				escopo: 'webhooks:ler',
			},
			{
				valor: 'listarEntregas',
				nome: 'Listar Entregas',
				acao: 'Listar as entregas de uma assinatura',
				descricao: 'Ver o resultado de cada tentativa de entrega',
				escopo: 'webhooks:ler',
			},
			{
				valor: 'listarEventos',
				nome: 'Listar Eventos',
				acao: 'Listar os eventos de webhook disponiveis',
				descricao: 'Descobrir os nomes de evento que a assinatura aceita',
				escopo: 'webhooks:ler',
			},
			{
				valor: 'obter',
				nome: 'Obter',
				acao: 'Obter uma assinatura de webhook',
				descricao: 'Buscar uma assinatura pelo identificador; nao devolve o segredo',
				escopo: 'webhooks:ler',
			},
			{
				valor: 'reenviarEntrega',
				nome: 'Reenviar Entrega',
				acao: 'Reenviar uma entrega de webhook',
				descricao: 'Enfileirar de novo uma entrega que ja aconteceu',
				escopo: 'webhooks:escrever',
			},
			{
				valor: 'testar',
				nome: 'Testar',
				acao: 'Enviar uma entrega de teste',
				descricao: 'Disparar o evento webhook.teste na URL assinada',
				escopo: 'webhooks:escrever',
			},
		],
	},
	{
		valor: 'modulo',
		nome: 'Modulo',
		descricao: 'Modulos da organizacao e o dicionario de campos de cada um',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar modulos ativos',
				descricao: 'Listar os modulos habilitados na organizacao',
				escopo: 'meta:ler',
			},
			{
				valor: 'listarCampos',
				nome: 'Listar Campos',
				acao: 'Listar os campos de um modulo',
				descricao: 'Ler o dicionario de campos, com tipo e obrigatoriedade',
				escopo: 'meta:ler',
			},
			{
				valor: 'obter',
				nome: 'Obter',
				acao: 'Obter um modulo',
				descricao: 'Buscar um modulo pelo slug, mesmo desativado',
				escopo: 'meta:ler',
			},
		],
	},
	{
		valor: 'etiqueta',
		nome: 'Etiqueta',
		descricao: 'Catalogo de etiquetas e os vinculos com cada registro',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'desvincular',
				nome: 'Desvincular',
				acao: 'Desvincular uma etiqueta de um registro',
				// Escopo cruzado: o vinculo e metadado do registro, entao ele mora sob
				// `registros:escrever` e nao sob um escopo proprio de etiquetas.
				descricao: 'Tirar a etiqueta de um registro; a unica forma de remover pela v1',
				escopo: 'registros:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar etiquetas',
				descricao: 'Listar o catalogo de etiquetas da organizacao',
				escopo: 'meta:ler',
			},
			{
				valor: 'listarVinculos',
				nome: 'Listar Vinculos',
				acao: 'Listar as etiquetas de um registro',
				descricao: 'Ler as etiquetas aplicadas a um registro',
				escopo: 'registros:ler',
			},
			{
				valor: 'vincular',
				nome: 'Vincular',
				acao: 'Vincular uma etiqueta a um registro',
				descricao: 'Aplicar uma etiqueta pelo identificador ou pelo nome',
				escopo: 'registros:escrever',
			},
		],
	},
	{
		valor: 'interacao',
		nome: 'Interacao',
		descricao: 'Reunioes, ligacoes, follow-ups e e-mails registrados',
		operacaoPadrao: 'listar',
		operacoes: [
			{
				valor: 'atualizar',
				nome: 'Atualizar',
				acao: 'Atualizar uma interacao',
				descricao: 'Alterar campos de uma interacao existente',
				escopo: 'interacoes:escrever',
			},
			{
				valor: 'criar',
				nome: 'Criar',
				acao: 'Criar uma interacao',
				descricao: 'Registrar uma reuniao, ligacao, follow-up ou e-mail',
				escopo: 'interacoes:escrever',
			},
			{
				valor: 'excluir',
				nome: 'Excluir',
				acao: 'Excluir uma interacao',
				descricao: 'Remover uma interacao',
				escopo: 'interacoes:escrever',
			},
			{
				valor: 'listar',
				nome: 'Listar',
				acao: 'Listar interacoes',
				descricao: 'Listar interacoes com filtros e paginacao',
				escopo: 'interacoes:ler',
			},
			{
				valor: 'obter',
				nome: 'Obter',
				acao: 'Obter uma interacao',
				descricao: 'Buscar uma interacao pelo identificador',
				escopo: 'interacoes:ler',
			},
		],
	},
	{
		valor: 'organizacao',
		nome: 'Organizacao',
		descricao: 'Contexto da chave: escopos, usuarios, equipes e disponibilidade',
		operacaoPadrao: 'obterContexto',
		operacoes: [
			{
				valor: 'listarEquipes',
				nome: 'Listar Equipes',
				acao: 'Listar as equipes',
				descricao: 'Listar as equipes-espelho de cargo; equipes legadas ficam de fora',
				escopo: 'meta:ler',
			},
			{
				valor: 'listarEscopos',
				nome: 'Listar Escopos e Eventos',
				acao: 'Listar os escopos e eventos disponiveis',
				descricao: 'Ler o catalogo de escopos concediveis e de eventos de webhook',
				escopo: 'meta:ler',
			},
			{
				valor: 'listarUsuarios',
				nome: 'Listar Usuarios',
				acao: 'Listar os usuarios ativos',
				descricao: 'Listar quem esta ativo na organizacao',
				escopo: 'meta:ler',
			},
			{
				valor: 'obterCapacidades',
				nome: 'Obter Capacidades',
				acao: 'Obter escopos, modulos, pipelines, usuarios e etiquetas',
				// Sem escopo: `/capabilities` responde a qualquer chave autenticada e
				// diz, em `blocos_omitidos`, o que ela nao pode ver.
				descricao: 'Ler o agregado de descoberta numa requisicao so',
				escopo: null,
			},
			{
				valor: 'obterContexto',
				nome: 'Obter Contexto',
				acao: 'Obter a organizacao e os escopos da chave',
				// Sem escopo desde a mudanca que tirou `meta:ler` de `/me`: exigir o
				// escopo para o portador se descrever era um beco sem saida.
				descricao: 'Ler qual organizacao respondeu e o que a chave pode fazer',
				escopo: null,
			},
			{
				valor: 'verificarDisponibilidade',
				nome: 'Verificar Disponibilidade',
				acao: 'Verificar se a API esta disponivel',
				descricao: 'Sondar a rota aberta de saude, sem enviar credencial',
				escopo: null,
			},
		],
	},
];

export function encontrarRecurso(valor: string): RecursoDoCatalogo | undefined {
	return RECURSOS.find((recurso) => recurso.valor === valor);
}

export function encontrarOperacao(
	recurso: string,
	operacao: string,
): OperacaoDoCatalogo | undefined {
	return encontrarRecurso(recurso)?.operacoes.find((item) => item.valor === operacao);
}

/**
 * O motivo que aparece como linha secundaria sob o nome da opcao bloqueada.
 *
 * A opcao bloqueada carrega TRES marcas, e a redundancia e deliberada porque
 * cada versao do n8n honra um subconjunto diferente:
 *
 * - `disabled: true` — o campo EXISTE em `INodePropertyOptions` (n8n-workflow
 *   2.37.4) e o backend o repassa intacto na resposta REST do `loadOptions`.
 *   Em n8n 2.x a interface o impoe: a linha renderiza cinza
 *   (`el-select-dropdown__item is-disabled`, `aria-disabled="true"`,
 *   `cursor: not-allowed`) e o clique NAO troca o valor do parametro — medido
 *   em 2.37.10 lendo o workflow salvo pela REST, nao o DOM. Em n8n 1.x o campo
 *   e ignorado por completo: chega ao front e nada acontece com ele.
 * - `MARCA_DE_CADEADO` no nome — funciona nas duas versoes, e e o unico aviso
 *   visivel em 1.x, onde a opcao segue selecionavel.
 * - Esta `description` — a linha cinza sob o nome, tambem nas duas versoes; e
 *   onde cabe dizer qual escopo falta e onde gerar chave nova.
 *
 * Nenhuma delas e a defesa real: o painel de Actions do node creator escreve
 * `operation` sem passar por dropdown nenhum, entao a execucao continua
 * verificando o escopo e falhando com `NodeApiError`. As tres marcas so
 * antecipam esse desfecho para quem ainda esta montando o node.
 */
export function motivoDeBloqueio(escopo: string): string {
	return `Requer o escopo ${escopo} — gere uma chave nova em Configuracoes › Integracoes no Fluxo CRM`;
}

function porNome(a: INodePropertyOptions, b: INodePropertyOptions): number {
	return a.name.localeCompare(b.name, 'pt-BR');
}

/**
 * Opcoes ESTATICAS de operacao — as que o painel de Actions do node creator le.
 *
 * Nunca levam cadeado: esse painel renderiza antes de existir credencial, entao
 * filtrar por escopo aqui seria mentir com base em nada.
 */
export function opcoesEstaticasDeOperacao(recurso: RecursoDoCatalogo): INodePropertyOptions[] {
	return recurso.operacoes
		.map((operacao) => ({
			name: operacao.nome,
			value: operacao.valor,
			action: operacao.acao,
			description: operacao.descricao,
		}))
		.sort(porNome);
}

/**
 * Opcoes REMOTAS de operacao — as que o dropdown dentro do node le.
 *
 * A operacao que a chave nao pode executar CONTINUA na lista, por decisao do
 * fundador: esconde-la fecharia o dropdown mas deixaria o painel de Actions
 * oferecendo a mesma operacao sem aviso nenhum. Ela sai com `disabled: true`,
 * cadeado no nome e o motivo na descricao — em 2.x fica cinza e inselecionavel,
 * em 1.x segue selecionavel com o cadeado (ver `motivoDeBloqueio`). Se o valor
 * chegar preenchido por outro caminho, a execucao falha dizendo qual escopo
 * falta.
 *
 * Ordem: permitidas primeiro, bloqueadas depois; alfabetica dentro de cada grupo.
 */
export function opcoesDeOperacaoComEscopo(
	recurso: RecursoDoCatalogo,
	estado: EstadoDeEscopos,
): INodePropertyOptions[] {
	const permitidas: INodePropertyOptions[] = [];
	const bloqueadas: INodePropertyOptions[] = [];

	for (const operacao of recurso.operacoes) {
		if (operacaoPermitida(operacao, estado)) {
			permitidas.push({
				name: operacao.nome,
				value: operacao.valor,
				action: operacao.acao,
				description: operacao.descricao,
			});
			continue;
		}

		bloqueadas.push({
			name: `${MARCA_DE_CADEADO}${operacao.nome}`,
			value: operacao.valor,
			action: operacao.acao,
			description: motivoDeBloqueio(operacao.escopo as string),
			disabled: true,
		});
	}

	return [...permitidas.sort(porNome), ...bloqueadas.sort(porNome)];
}

/** `true` quando a operacao pode ser executada, ou quando nao sabemos os escopos. */
export function operacaoPermitida(operacao: OperacaoDoCatalogo, estado: EstadoDeEscopos): boolean {
	if (operacao.escopo === null) return true;
	if (!estado.conhecidos) return true;
	return temEscopo(estado.escopos, operacao.escopo);
}

export function opcoesEstaticasDeRecurso(): INodePropertyOptions[] {
	return RECURSOS.map((recurso) => ({
		name: recurso.nome,
		value: recurso.valor,
		description: recurso.descricao,
	})).sort(porNome);
}

/**
 * Opcoes remotas de recurso. O recurso so ganha cadeado quando NENHUMA de suas
 * operacoes esta ao alcance da chave — marcar "Contato" porque falta
 * `contatos:escrever` esconderia que listar continua funcionando.
 */
export function opcoesDeRecursoComEscopo(estado: EstadoDeEscopos): INodePropertyOptions[] {
	const disponiveis: INodePropertyOptions[] = [];
	const indisponiveis: INodePropertyOptions[] = [];

	for (const recurso of RECURSOS) {
		const alcancaveis = recurso.operacoes.filter((operacao) => operacaoPermitida(operacao, estado));

		if (alcancaveis.length > 0) {
			disponiveis.push({
				name: recurso.nome,
				value: recurso.valor,
				description: recurso.descricao,
			});
			continue;
		}

		const escoposFaltantes = [
			...new Set(recurso.operacoes.map((operacao) => operacao.escopo).filter(Boolean)),
		].join(', ');

		indisponiveis.push({
			name: `${MARCA_DE_CADEADO}${recurso.nome}`,
			value: recurso.valor,
			description: `Nenhuma operacao deste recurso esta ao alcance da chave. Escopos envolvidos: ${escoposFaltantes}.`,
			disabled: true,
		});
	}

	return [...disponiveis.sort(porNome), ...indisponiveis.sort(porNome)];
}

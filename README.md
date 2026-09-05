# n8n-nodes-fluxo-crm

Node comunitário do n8n para a API pública do **Fluxo CRM**.

A interface é toda em português, por decisão de produto — rótulos, descrições e
mensagens de erro.

O pacote traz:

| Item                   | O que é                                                                  |
| ---------------------- | ------------------------------------------------------------------------ |
| **Fluxo CRM**          | Node de ação: 19 recursos e 92 operações de leitura e escrita             |
| **Fluxo CRM Trigger**  | Node de gatilho: modo Webhook e modo Sondagem Periódica                   |
| **Fluxo CRM API**      | Credencial compartilhada pelos dois                                       |

O node é **stack-agnóstico quanto a dependências**: não tem nenhuma dependência
de runtime. Só usa o que o próprio n8n já oferece.

O que mudou em cada versão está em **[CHANGELOG.md](CHANGELOG.md)** — inclusive
as limitações conhecidas, que vale ler antes de instalar.

---

## Sumário

- [Instalação](#instalação)
- [Credencial](#credencial)
- [Como obter uma chave de API](#como-obter-uma-chave-de-api)
- [Escopos e o cadeado 🔒](#escopos-e-o-cadeado-)
- [Recursos](#recursos)
- [Gatilho (Fluxo CRM Trigger)](#gatilho-fluxo-crm-trigger)
- [Peculiaridades da API que afetam o seu fluxo](#peculiaridades-da-api-que-afetam-o-seu-fluxo)
- [Exemplos de workflow](#exemplos-de-workflow)
- [Publicação](#publicação)
- [Desenvolvimento](#desenvolvimento)
- [Licença](#licença)

---

## Instalação

### Pela interface do n8n (self-hosted)

1. Abra **Configurações → Community nodes**.
2. Clique em **Install a community node**.
3. Informe `n8n-nodes-fluxo-crm` e confirme o aviso de risco.

Community nodes exigem uma instância **self-hosted**. No n8n Cloud, apenas
pacotes verificados pela n8n aparecem — e este não busca a verificação oficial,
porque a interface é em português e o processo de verificação exige inglês.

### Por `npm`, na pasta `custom`

Funciona em qualquer instância self-hosted, inclusive as que desabilitaram a
instalação pela interface:

```bash
mkdir -p ~/.n8n/custom
cd ~/.n8n/custom
npm init -y                      # só na primeira vez
npm install n8n-nodes-fluxo-crm
```

Reinicie o n8n. Se a sua instalação usa outra pasta de dados, aponte a variável
de ambiente:

```bash
export N8N_CUSTOM_EXTENSIONS=/caminho/para/custom/node_modules/n8n-nodes-fluxo-crm
```

### Docker

Monte a pasta `custom` no contêiner:

```bash
docker run -it --rm -p 5678:5678 \
  -v ~/.n8n:/home/node/.n8n \
  docker.n8n.io/n8nio/n8n
```

Com `~/.n8n/custom` preparado como acima, o node é carregado no boot.

---

## Credencial

Credencial **Fluxo CRM API**:

| Campo                | Para que serve                                                                 |
| -------------------- | ------------------------------------------------------------------------------ |
| **URL Base**         | Endereço da API **com o prefixo de versão** — `https://api-crm.nafluxo.com.br/v1` |
| **Chave de API**     | Enviada como `Authorization: Bearer <chave>`                                    |
| **Escopos da Chave** | Campo oculto, preenchido sozinho. Você não edita.                               |

O botão **Test** chama a API, lê os escopos e responde com a organização que
atendeu e o que a chave pode fazer — não é um simples "conectou".

> **A URL Base precisa terminar em `/v1`.** Sem o prefixo de versão, toda
> operação responde 404.

### O campo oculto "Escopos da Chave"

O node descobre os escopos **uma vez** e guarda o resultado na credencial, para
que os menus não gastem uma requisição cada vez que você abre um dropdown.

O valor guardado carrega uma **impressão digital da credencial**. Se você trocar
a chave de API, a impressão deixa de bater e o carimbo antigo é descartado — sem
isso, o node filtraria a interface contra os escopos da chave anterior.

---

## Como obter uma chave de API

No Fluxo CRM, vá em **Configurações › Integrações** e gere uma chave nova. Ela
começa com `flx_live_`.

**Guarde a chave na hora.** Ela é exibida uma única vez.

### Os escopos são explícitos, e a chave nova nasce quase vazia

Uma chave recém-criada nasce **apenas com `meta:ler`** — o suficiente para dizer
quem ela é e listar módulos, e nada além disso. Todo acesso a dado precisa ser
concedido explicitamente na tela de criação da chave.

Os escopos seguem o formato `recurso:acao`:

| Exemplo               | Concede                                     |
| --------------------- | ------------------------------------------- |
| `contatos:ler`        | Listar, obter e verificar contatos          |
| `contatos:escrever`   | Criar, atualizar e excluir contatos         |
| `negocios:*`          | As duas ações de negócios                   |
| `*`                   | Coringa global                              |

Três regras que valem tanto no servidor quanto na interface do node:

1. `*` é coringa global.
2. `recurso:*` cobre as duas ações daquele recurso.
3. **`escrever` NÃO implica `ler`.** São escopos independentes. Uma chave que só
   escreve não consegue listar.

Operações costumam pedir o escopo do próprio recurso, mas nem sempre — algumas
atravessam. `Contato › Listar Atividades` pede `atividades:ler`, não
`contatos:ler`. `Etiqueta › Vincular` pede `registros:escrever`. E
`Pipeline › Listar` pede `meta:ler`. Cada operação mostra o escopo que exige na
própria descrição.

---

## Escopos e o cadeado 🔒

Operação que a sua chave **não pode** executar continua na lista, com cadeado no
nome e o motivo logo abaixo:

```text
🔒 Criar Contato
   Requer o escopo contatos:escrever — gere uma chave nova em Configurações › Integrações no Fluxo CRM
```

Ela também sai marcada com `disabled`. Em **n8n 2.x** isso é imposto pela
interface: a linha fica cinza e o clique não troca o valor. Em **n8n 1.x** o
campo é ignorado, e aí o cadeado é o único aviso — a opção segue selecionável.
Os dois mecanismos coexistem de propósito: um cobre a versão em que o outro não
funciona.

Manter a opção na lista é deliberado, e a razão é do próprio n8n: o painel de
**Actions** do node creator renderiza **antes** de existir qualquer credencial,
então ele nunca consegue filtrar por escopo. Se o dropdown escondesse a
operação, os dois se contradiriam — a operação existiria num lugar e sumiria no
outro. Com o cadeado, as duas telas contam a mesma história.

Quem chegar à execução com uma operação sem escopo — pelo painel de Actions, por
n8n 1.x ou por expressão — recebe um erro dizendo qual escopo falta e onde
consegui-lo, nunca o genérico `The value "x" is not supported!`.

> **O cadeado é da interface; a autorização real é do servidor.** O filtro
> existe para orientar, não para proteger. Quem decide é o **403** da API. Se os
> escopos mudarem no servidor e o carimbo local estiver velho, o cadeado pode
> mostrar um estado desatualizado — a chamada real continua correta.

**Comportamento _fail-open_.** Se o node não conseguir descobrir os escopos —
uma chave legítima sem `meta:ler`, ou uma instância antiga — ele **não trava**
nada. Nenhum cadeado aparece, e o servidor decide a cada chamada.

---

## Recursos

19 recursos, 92 operações.

| Recurso                 | Para que serve                                                     | Operações |
| ----------------------- | ------------------------------------------------------------------ | --------- |
| **Agente de Atendimento** | Pessoas habilitadas a responder atendimentos                     | 1         |
| **Arquivo**             | Vínculos entre uma entidade e um arquivo já hospedado               | 4         |
| **Atividade**           | Tarefas, ligações e reuniões ligadas a uma entidade                 | 6         |
| **Canal de Atendimento** | Canais conectados ao atendimento da organização                    | 1         |
| **Contato**             | Fichas de pessoas do CRM                                            | 8         |
| **Conversa**            | Atendimentos abertos nos canais de mensageria                       | 3         |
| **Empresa**             | Fichas de organizações clientes e fornecedoras                      | 8         |
| **Etiqueta**            | Catálogo de etiquetas e os vínculos com cada registro               | 4         |
| **Interação**           | Reuniões, ligações, follow-ups e e-mails registrados                | 5         |
| **Lead**                | Contatos ainda não qualificados, antes de virarem ficha             | 6         |
| **Lote**                | Gravação de até 200 fichas numa requisição só                       | 3         |
| **Mensagem**            | Mensagens e notas internas dentro de uma conversa                   | 3         |
| **Módulo**              | Módulos da organização e o dicionário de campos de cada um          | 3         |
| **Negócio**             | Oportunidades comerciais dentro de um funil                         | 9         |
| **Nota**                | Anotações de texto presas a um registro                             | 4         |
| **Organização**         | Contexto da chave: escopos, usuários, equipes e disponibilidade     | 6         |
| **Pipeline**            | Funis e seus estágios                                               | 3         |
| **Registro**            | Linhas de qualquer módulo, inclusive os personalizados              | 6         |
| **Webhook**             | Assinaturas de evento e as entregas de cada uma                     | 9         |

### Destaques

**Contato, Empresa e Negócio têm seletor de registro.** Você escolhe *Da Lista*
(busca por nome enquanto digita), *Por ID* (UUID) ou *Por URL* (cole o endereço
da tela do CRM e o node extrai o identificador).

**Campos personalizados vêm do layout da sua organização.** Contato, Empresa,
Atividade, Negócio e Registro trazem um mapeador que lê os campos reais da sua
org — com o `obrigatório` real de cada um, em tempo de edição.

**Campos de sistema entram no mesmo mapeador, marcados `(sistema)`.** Quando a
API devolve o dicionário com as flags `sistema` e `somente_leitura`, o mapeador
oferece também o responsável (Contato, Empresa), o dono e a equipe (Registro) e
o dono (Negócio) — só nas operações em que a rota os aceita — e os envia no
**primeiro nível do corpo**, nunca dentro de `valores`/`dados`. Criado em/por e
atualizado em/por são somente leitura: aparecem em `Módulo › Listar Campos` e
na saída, mas a escrita os recusa antes de chamar a API. Numa instância com API
anterior às flags, nada muda.

**`Criar ou Atualizar` existe em Contato, Empresa, Lead, Negócio e Pipeline.**
Casa por um campo de índice e cria quando não encontra.

**`Lote` grava até 200 fichas numa requisição** e devolve um item de saída por
linha enviada, preservando o índice.

**`Registro` é a saída de emergência genérica**: opera qualquer módulo pelo
slug, inclusive os personalizados que este node não conhece pelo nome.

---

## Gatilho (Fluxo CRM Trigger)

### ⚠️ Limitações — leia antes de escolher o modo

Estas restrições são do **servidor**, não do node. Elas mudam qual modo resolve
o seu caso, então vêm primeiro.

#### 1. Webhooks só disparam para escritas feitas **pela API v1**

O evento é emitido exclusivamente pelas rotas da API pública. **O que a sua
equipe faz na tela do Fluxo CRM não emite evento nenhum.**

Um contato criado pelo comercial na interface do CRM **não** dispara
`contato.criado`. Só dispara o contato criado por uma integração que chamou
`POST /v1/contatos`.

> Há correção em andamento no servidor. Enquanto ela não chega, este é o
> comportamento real — e quem precisa reagir ao trabalho humano hoje precisa usar
> o modo **Sondagem**.

#### 2. Atendimento não emite evento nenhum

Não existe `conversa.criada`, nem `mensagem.recebida`, nem `conversa.atribuida`.
Nenhum evento de atendimento existe no servidor.

**"Disparar quando chegar mensagem no WhatsApp" só funciona por sondagem.** Não
há webhook para isso, e não é uma limitação que este node possa contornar.

#### 3. Eventos que não existem

- Não existe `atividade.removida` (as outras três de atividade existem).
- Não existe nenhum evento de **pipeline** ou de **estágio**.
- Não existe nenhum evento de **arquivo**.
- Não existe nenhum evento do **próprio webhook**.

#### 4. "Tempo real" é *até ~1 minuto*

A entrega dos eventos sai de um **cron de 1 minuto**. Uma escrita feita agora
pode levar até cerca de um minuto para virar uma chamada ao seu workflow. O
mesmo teto vale para a sondagem: o intervalo mínimo do n8n também é 1 minuto.

Se o seu caso exige latência abaixo disso, este gatilho não atende.

#### 5. Datas de saída **não são normalizadas**

O node **não mexe na saída** da API — de propósito, porque converter só em
alguns lugares produziria duas convenções no mesmo fluxo.

A maioria dos campos de data vem no fuso **America/Sao_Paulo**. Mas três lugares
vêm em **UTC**:

| Onde                                | Fuso                |
| ----------------------------------- | ------------------- |
| Campos de data em geral             | America/Sao_Paulo   |
| `enviada_em` (mensagens)            | **UTC**             |
| Envelope do webhook (`criado_em`)   | **UTC**             |
| `Registro › Listar Histórico`       | **UTC**             |

Se você compara datas de fontes diferentes no mesmo workflow, **converta
explicitamente**. Não presuma que duas datas da mesma resposta estão no mesmo
fuso.

Na **entrada** o node converte quando a API exige: `Prazo` de atividade usa
`Z` obrigatório e recusa offset local, então o node normaliza antes de enviar.

---

### Modo Webhook

O Fluxo CRM avisa a sua instância quando o evento acontece.

**Exige URL HTTPS pública.** O node valida o endereço antes de registrar e
recusa `http://`, `localhost`, redes privadas (`10.x`, `192.168.x`, `172.16-31.x`),
CGNAT, link-local e endereços de metadados de nuvem. Se a sua instância não tem
endereço público, use Sondagem.

| Parâmetro                       | O que faz                                                            |
| ------------------------------- | -------------------------------------------------------------------- |
| **Eventos**                     | Quais eventos assinar. `Todos os Eventos` usa o coringa `*` do servidor e passa a valer também para eventos criados depois. |
| **Ignorar Entrega de Teste**    | Descarta a entrega gerada pelo botão "Testar" do CRM (`webhook.teste`) |
| **Incluir Metadados da Entrega** | Acrescenta `__entrega` à saída, com o ID e os cabeçalhos recebidos    |

**Eventos disponíveis** (26, mais o coringa `*`):

`contato.criado` · `contato.atualizado` · `contato.removido` ·
`empresa.criada` · `empresa.atualizada` · `empresa.removida` ·
`lead.criado` · `lead.atualizado` · `lead.convertido` · `lead.removido` ·
`negocio.criado` · `negocio.atualizado` · `negocio.estagio_alterado` ·
`negocio.ganho` · `negocio.perdido` · `negocio.removido` ·
`atividade.criada` · `atividade.atualizada` · `atividade.concluida` ·
`interacao.criada` · `interacao.atualizada` · `interacao.removida` ·
`registro.criado` · `registro.atualizado` · `registro.removido` ·
`nota.criada`

**Toda entrega é verificada.** O cabeçalho `X-Fluxo-Signature` traz
`t=<unix>,v1=<hex>`, onde `v1 = HMAC_SHA256(segredo, "<t>.<corpo bruto>")`. A
assinatura é conferida sobre os **bytes originais** do corpo, com janela de
replay de 300 segundos. Entrega que não confere recebe **401** e **não dispara o
workflow** — uma entrega não verificada é indistinguível de uma forjada.

O corpo entregue tem esta forma:

```json
{
  "evento": "contato.criado",
  "criado_em": "2026-09-04T12:00:00.000Z",
  "dados": { "id": "c1", "nome": "Ana" }
}
```

> **Ativar e desativar o workflow registra e remove a assinatura no CRM.** O
> segredo é devolvido **uma única vez**, na criação — nem `GET` nem `PATCH` o
> devolvem depois. Se o segredo se perder, desative e reative o workflow para
> registrar de novo.
>
> Mudar a lista de eventos com o workflow ativo **atualiza** a assinatura
> existente, sem criar outra.

Escopo exigido: `webhooks:escrever`.

---

### Modo Sondagem Periódica

Consulta a API em intervalos. **Não precisa de endereço público**, e é o **único
caminho para atendimento**.

| Recurso a Sondar          | Escopo             | Observação                                       |
| ------------------------- | ------------------ | ------------------------------------------------ |
| **Atendimento › Conversa** | `atendimento:ler`  | Não existe webhook para isto                     |
| **Atendimento › Mensagem** | `atendimento:ler`  | Não existe webhook — este é o único caminho      |
| **Atividade**             | `atividades:ler`   | Só "For Criado" (a rota não expõe `atualizado_apos`) |
| **Contato**               | `contatos:ler`     |                                                  |
| **Empresa**               | `empresas:ler`     |                                                  |
| **Lead**                  | `leads:ler`        |                                                  |
| **Negócio**               | `negocios:ler`     |                                                  |
| **Registro de Módulo**    | `registros:ler`    | Qualquer módulo pelo slug                        |

**Disparar Quando** escolhe qual data move a marca d'água: `For Criado`
(`criado_apos`) ou `For Atualizado` (`atualizado_apos`). Disponível em Contato,
Empresa, Lead, Negócio e Registro de Módulo.

> **Por que "For Atualizado" é mais caro.** As listas da API ordenam por
> `criado_em` decrescente, mas `atualizado_apos` filtra por `atualizado_em`. Um
> registro antigo recém-editado aparece no **fim** da ordenação, não no começo —
> ler só a primeira página perderia exatamente a atualização que se queria
> capturar. Por isso a sondagem por atualização percorre o cursor até o fim, com
> teto de páginas.

#### Comportamento que vale conhecer

- **A primeira sondagem não emite nada.** Ela apenas fixa a marca d'água no
  instante atual. Emitir a base inteira na ativação é a forma mais rápida de
  inundar um workflow — e não é o que "disparar quando acontecer" quer dizer.
- **Execução manual não mexe na marca d'água** e devolve no máximo 1 item. Testar
  na interface não rouba itens da próxima execução real.
- **Itens saem do mais antigo para o mais novo.**
- **Zero resultados não gera execução.** O poller devolve nada, em vez de uma
  execução vazia por minuto.
- **Sem duplicatas na fronteira.** Os filtros de data da API são `>=`, não `>`.
  O node guarda os ids do instante da marca (até 200) para não reemitir o
  registro da fronteira.

#### Opções de sondagem

| Opção                            | Padrão | Quando aparece            |
| -------------------------------- | ------ | ------------------------- |
| **Itens por Consulta**           | 100    | sempre (teto do servidor: 200) |
| **Máximo de Páginas por Sondagem** | 5    | sempre (teto: 25)         |
| **Canal**                        | todos  | Conversa e Mensagem       |
| **Status da Conversa**           | qualquer | Conversa e Mensagem     |
| **Máximo de Conversas por Sondagem** | 20 | Mensagem                  |
| **Mensagens por Conversa**       | 50     | Mensagem                  |
| **Somente Mensagens Recebidas**  | ligado | Mensagem                  |

> **Sondar mensagens custa caro.** A rota de mensagens não aceita filtro de data,
> então é **uma requisição por conversa que se moveu**. A chave tem limite de 120
> requisições por minuto — os tetos existem para que uma caixa movimentada não
> consuma o limite inteiro. Ao bater num teto, o node registra um aviso no log em
> vez de truncar em silêncio.

Ao sondar **Mensagem**, cada item de saída traz a conversa de origem em
`__conversa`.

---

## Peculiaridades da API que afetam o seu fluxo

### `PATCH` tem semânticas **opostas** conforme o recurso

Esta é a pegadinha que mais custa caro. O node avisa na tela, mas vale saber
antes:

| Campo         | Recursos                        | Semântica      | Chave não preenchida       |
| ------------- | ------------------------------- | -------------- | -------------------------- |
| **`dados`**   | Contato, Empresa, Atividade     | **SUBSTITUI**  | é **APAGADA**              |
| **`valores`** | Registro, Negócio               | **MESCLA**     | é **PRESERVADA**           |

Em Contato, Empresa e Atividade, o blob de campos personalizados substitui o
conjunto inteiro: **o que você não preencher é apagado**.

Em Registro e Negócio, os valores são mesclados: o que você não preencher
continua lá. Para limpar um campo, envie-o explicitamente vazio.

**Contato tem escapatória.** A opção **Mesclar Com os Valores Atuais** (ligada
por padrão) lê os campos atuais e mescla antes de gravar. Custa uma requisição a
mais por item. Empresa e Atividade **não** têm essa opção — leia a ficha antes se
precisar preservar o que já existe.

### Etiquetas são re-divididas pelo servidor

Você separa por vírgula, mas **o servidor re-divide cada valor por `,` e `;`
também**. Então `"VIP, Urgente"` vira **duas** etiquetas, não uma.

Etiqueta que ainda não existe é **criada** pelo servidor. E a API **acrescenta e
nunca substitui**: não há como remover etiqueta pela v1 a não ser com
`Etiqueta › Desvincular`.

### Outras

- **`Mensagem › Enviar` só manda texto.** Não há campo de mídia; a API responde
  422 com "Mídia ainda não é suportada pela API pública".
- **`Registro › Listar Histórico`** é a única rota em `camelCase`, a única
  paginada por página, e o servidor a trava na página 1 — só os 200 eventos mais
  recentes são alcançáveis.
- **`Mensagem › Listar`** não aceita cursor nem filtro de data: teto de 200, da
  mais recente para a mais antiga.
- **Limite de 120 requisições por minuto por chave.** O node traduz o 429 com o
  `Retry-After` que o servidor pediu.
- **Chave de Idempotência** está disponível nas operações de escrita, em
  **Opções**. Use `{{ $execution.id }}-{{ $itemIndex }}` para tornar um reprocessamento seguro.

---

## Exemplos de workflow

Cole no canvas do n8n (Ctrl+V). Depois de colar, **selecione a sua credencial**
em cada node — os exemplos trazem um `id` de espaço reservado.

### 1. Mensagem nova no atendimento → nota interna com o horário

Demonstra o único caminho para atendimento: **sondagem**. A cada minuto lê as
mensagens recebidas e registra uma nota interna na conversa.

```json
{
  "name": "Fluxo CRM — mensagem nova vira nota interna",
  "nodes": [
    {
      "parameters": {
        "modo": "polling",
        "recursoSondado": "mensagem",
        "opcoesDeSondagem": {
          "somenteRecebidas": true,
          "maximoDeConversas": 20,
          "mensagensPorConversa": 50
        },
        "pollTimes": { "item": [{ "mode": "everyMinute" }] }
      },
      "id": "a1000000-0000-4000-8000-000000000001",
      "name": "Fluxo CRM Trigger",
      "type": "n8n-nodes-fluxo-crm.fluxoCrmTrigger",
      "typeVersion": 1,
      "position": [0, 0],
      "credentials": {
        "fluxoCrmApi": { "id": "1", "name": "Fluxo CRM API" }
      }
    },
    {
      "parameters": {
        "resource": "mensagem",
        "operation": "criarNotaInterna",
        "conversaId": "={{ $json.__conversa.id }}",
        "conteudo": "=Mensagem recebida via n8n em {{ $now.format('dd/MM/yyyy HH:mm') }}."
      },
      "id": "a1000000-0000-4000-8000-000000000002",
      "name": "Registrar nota interna",
      "type": "n8n-nodes-fluxo-crm.fluxoCrm",
      "typeVersion": 1,
      "position": [220, 0],
      "credentials": {
        "fluxoCrmApi": { "id": "1", "name": "Fluxo CRM API" }
      }
    }
  ],
  "connections": {
    "Fluxo CRM Trigger": {
      "main": [[{ "node": "Registrar nota interna", "type": "main", "index": 0 }]]
    }
  },
  "settings": {}
}
```

> Escopos necessários: `atendimento:ler` e `atendimento:escrever`.

### 2. Negócio ganho → cria a atividade de onboarding

Demonstra o modo **Webhook**. Lembre-se da limitação: só dispara se o negócio for
marcado como ganho **pela API**, não pela tela do CRM.

```json
{
  "name": "Fluxo CRM — negócio ganho abre onboarding",
  "nodes": [
    {
      "parameters": {
        "modo": "webhook",
        "eventos": ["negocio.ganho"],
        "opcoesDoWebhook": { "ignorarEntregaDeTeste": true }
      },
      "id": "b2000000-0000-4000-8000-000000000001",
      "name": "Fluxo CRM Trigger",
      "type": "n8n-nodes-fluxo-crm.fluxoCrmTrigger",
      "typeVersion": 1,
      "position": [0, 0],
      "webhookId": "b2000000-0000-4000-8000-0000000000ff",
      "credentials": {
        "fluxoCrmApi": { "id": "1", "name": "Fluxo CRM API" }
      }
    },
    {
      "parameters": {
        "resource": "atividade",
        "operation": "criar",
        "tipo": "tarefa",
        "titulo": "=Onboarding do negócio ganho em {{ $json.criado_em }}",
        "entidade_tipo": "negocio",
        "entidade_id": "={{ $json.dados.id }}",
        "additionalFields": {
          "descricao": "=Criada automaticamente pelo n8n a partir do evento {{ $json.evento }}."
        }
      },
      "id": "b2000000-0000-4000-8000-000000000002",
      "name": "Criar atividade",
      "type": "n8n-nodes-fluxo-crm.fluxoCrm",
      "typeVersion": 1,
      "position": [220, 0],
      "credentials": {
        "fluxoCrmApi": { "id": "1", "name": "Fluxo CRM API" }
      }
    }
  ],
  "connections": {
    "Fluxo CRM Trigger": {
      "main": [[{ "node": "Criar atividade", "type": "main", "index": 0 }]]
    }
  },
  "settings": {}
}
```

> Escopos necessários: `webhooks:escrever` e `atividades:escrever`.
> `criado_em` do envelope vem em **UTC**.

### 3. Listar os contatos atualizados nos últimos 7 dias

Execução manual, sem gatilho — útil para conferir a credencial e o formato do
dado antes de montar um fluxo maior.

```json
{
  "name": "Fluxo CRM — contatos atualizados na semana",
  "nodes": [
    {
      "parameters": {},
      "id": "c3000000-0000-4000-8000-000000000001",
      "name": "Executar manualmente",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [0, 0]
    },
    {
      "parameters": {
        "resource": "contato",
        "operation": "listar",
        "returnAll": true,
        "filters": {
          "atualizado_apos": "={{ $now.minus(7, 'days').toISO() }}"
        }
      },
      "id": "c3000000-0000-4000-8000-000000000002",
      "name": "Listar contatos",
      "type": "n8n-nodes-fluxo-crm.fluxoCrm",
      "typeVersion": 1,
      "position": [220, 0],
      "credentials": {
        "fluxoCrmApi": { "id": "1", "name": "Fluxo CRM API" }
      }
    }
  ],
  "connections": {
    "Executar manualmente": {
      "main": [[{ "node": "Listar contatos", "type": "main", "index": 0 }]]
    }
  },
  "settings": {}
}
```

> Escopo necessário: `contatos:ler`.

---

## Publicação

O histórico de versões está em **[CHANGELOG.md](CHANGELOG.md)**. O processo
completo de release — comandos, ordem e o que conferir antes — está em
**[CONTRIBUTING.md](CONTRIBUTING.md)**. O resumo:

```bash
npm run release:ensaio -- minor   # mostra o que faria, sem escrever nada
npm run release -- minor          # versão, CHANGELOG, tag, push, GitHub Release
```

Criar o GitHub Release é o **gatilho**: `.github/workflows/publish.yml` roda em
`release: published`, com `permissions: { id-token: write, contents: read }`, e
publica no npm por **OIDC Trusted Publishing** — o runner troca um token OIDC de
curta duração por uma credencial efêmera, e a *provenance* é gerada junto.
Ninguém publica da própria máquina.

### 🔴 A primeira publicação não pode usar OIDC

O **Trusted Publishing só pode ser configurado num pacote que já existe no
registro** — a página de Settings onde se cadastra o publicador confiável não
existe enquanto ninguém publicou o nome. Então a `0.1.0` sai com autenticação
normal (`npm login` + `npm publish`, ou um `NPM_TOKEN` temporário como secret), e
**da `0.1.1` em diante o OIDC assume, sem token nenhum**.

O passo a passo dos dois momentos está em
[CONTRIBUTING.md → A primeira publicação é diferente](CONTRIBUTING.md#-a-primeira-publicação-é-diferente).

Depois da primeira publicação, cadastre o publicador confiável em npmjs.com →
página do pacote → **Settings** → **Trusted Publisher** → **GitHub Actions**:

| Campo                | Valor                 |
| -------------------- | --------------------- |
| Organization or user | `htnnn`               |
| Repository           | `n8n-nodes-fluxo-crm` |
| Workflow filename    | `publish.yml`         |
| Environment          | *(deixe vazio)*       |

Os campos precisam bater **exatamente** com o repositório que roda o workflow, ou
o npm recusa a troca do token. Se a conta exige 2FA para publicar, marque a
exceção para *Trusted Publishers* — senão o CI é barrado pedindo OTP.

---

## Desenvolvimento

```bash
npm install
npm run dev        # sobe um n8n com este node linkado
npm run lint       # regras do n8n-node lint
npm run typecheck
npm test           # 216 testes
npm run build
```

Convenções de commit, formato do CHANGELOG e o processo de release estão em
[CONTRIBUTING.md](CONTRIBUTING.md).

O pacote **não tem dependências de runtime**, e o CI falha se alguma for
adicionada — o node roda dentro do processo do n8n, e tudo que entra aqui entra
no processo de quem instalar.

---

## Licença

[MIT](LICENSE) © Helton Rodrigues

# n8n-nodes-fluxo-crm

Node comunitário do n8n para a API pública do **Fluxo CRM**.

A interface é em português, por decisão do produto.

> **Estado: fundação + 2 recursos piloto.** Contato e Negócio estão completos.
> Os outros 16 recursos do catálogo (Empresa, Lead, Pipeline, Atividade,
> Registro, Nota, Arquivo, Lote, Atendimento, Webhook, Módulo, Etiqueta,
> Organização) vêm nas próximas ondas, reusando a mesma fundação. O **Trigger
> node** já está no pacote — veja [Gatilho](#gatilho-fluxo-crm-trigger).

## Instalação

Pela interface do n8n em `Configurações → Community nodes`, ou localmente:

```bash
npm install
npm run build
npm run dev      # sobe um n8n com este node linkado
```

## Credencial

`Fluxo CRM API`:

| Campo            | Para que serve                                                                |
| ---------------- | ----------------------------------------------------------------------------- |
| URL Base         | Endereço da API com o prefixo de versão (`https://api-crm.nafluxo.com.br/v1`) |
| Chave de API     | Enviada como `Authorization: Bearer <chave>`                                  |
| Escopos da Chave | `hidden` + `expirable`, preenchido pelo `preAuthentication`                   |

O teste da credencial chama `GET /me`, lê os escopos e devolve uma mensagem
útil — a organização que respondeu e o que a chave pode fazer.

**Chave sem `meta:ler`.** Enquanto `GET /me` exigir esse escopo, uma chave
legítima sem ele não permite descobrir os escopos. O node não trava: ele entra
em modo _fail-open_ (nada fica com cadeado) e deixa o servidor decidir a cada
chamada.

## Como o cadeado por escopo funciona

Operação que a chave **não pode** executar continua na lista e continua
selecionável, com cadeado no nome e o motivo logo abaixo:

```
🔒 Criar Contato
   Requer o escopo contatos:escrever — gere uma chave nova em Configurações › Integrações
```

Isso é deliberado. O painel de _Actions_ do node creator renderiza **antes** de
existir credencial, então ele nunca filtra por escopo; esconder a operação no
dropdown faria os dois se contradizerem. Quem selecionar mesmo assim recebe, na
execução, um erro que diz qual escopo falta e onde consegui-lo — nunca o
genérico `The value "x" is not supported!`.

A regra de escopo replica a do servidor: `*` é coringa global, `recurso:*` cobre
as duas ações daquele recurso, e **`escrever` não implica `ler`**.

## Recursos

| Recurso | Operações                                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| Contato | Listar, Obter, Criar, Criar ou Atualizar, Atualizar, Excluir, Verificar Existência, Listar Atividades       |
| Negócio | Listar, Obter, Criar, Criar ou Atualizar, Atualizar, Excluir, Mover, Marcar Como Ganho, Marcar Como Perdido |

### Armadilhas da API que o node trata para você

- **`Campos Personalizados` de contato SUBSTITUI o conjunto inteiro**, enquanto
  `Valores do Módulo` de negócio **mescla**. Semânticas opostas na mesma API. Há
  um aviso fixo em cada operação, e a opção _Mesclar Com os Valores Atuais_
  (ligada por padrão) em `Contato › Atualizar`.
- **`POST /negocios` pode devolver 200 com `criado: false`**, e há um ramo que
  devolve só quatro chaves (`oculto_por_visibilidade`). Os dois casos saem
  marcados em `__criado` e `__parcial`.
- **Upsert alterna 201/200.** O node emite `__criado`, `__casouPor` e
  `__statusHttp` — `casou_por` é a única pista de por que a ficha errada foi
  atualizada.
- **`campos_ignorados` / `campos_invalidos`** viram `__avisos` no item de saída e
  um aviso no log. São a única prova de que um 201 perdeu dado.
- **UUID malformado devolve 404, não 422.** O node confere o formato antes de
  enviar, para que um erro de digitação não vire "não encontrado".
- **Etiquetas** viajam por nome, e cada string é re-dividida por `,` e `;` no
  servidor. O node divide igual, para que o que sai seja o que será gravado.
- **Filtro `campo:` com comparação numérica ou de data** sobre valor de outro
  tipo devolve **500**. O node valida antes.

### Datas

As respostas saem como a API as devolve — em geral ISO com offset
`America/Sao_Paulo`, e em UTC em alguns campos. O node **não** reescreve datas de
saída: normalizar só metade seria pior, e reescrever tudo arriscaria corromper
strings que apenas se parecem com data. Use `{{ new Date($json.criado_em) }}` se
precisar de UTC.

## Gatilho (Fluxo CRM Trigger)

Um segundo node, `Fluxo CRM Trigger`, dispara workflows a partir do CRM. Ele tem
**dois modos**, e a escolha entre eles não é preferência: metade do que as
pessoas querem disparar **não tem webhook nenhum**.

| Modo                   | Como funciona                                                                                                                                   | Escopo exigido              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Webhook**            | O node registra uma assinatura em `POST /v1/webhooks` ao ativar o workflow e a remove ao desativar. O Fluxo CRM entrega o evento na URL do n8n. | `webhooks:escrever`         |
| **Sondagem Periódica** | O node consulta a API a cada intervalo (mínimo de 1 minuto, imposto pelo n8n) e emite o que apareceu desde a última vez.                        | o `:ler` do recurso sondado |

O modo que a chave não alcança aparece com **cadeado**, igual às operações do
node de ações, e a ativação falha com uma mensagem que diz qual escopo falta.

### 🔴 O que a API **não** notifica (leia antes de escolher Webhook)

**1. Não existe evento de atendimento.** Nenhum. Não há `conversa.criada`, nem
`mensagem.recebida`, nem `conversa.atribuida`, nem `conversa.resolvida`.
"Disparar quando chegar mensagem no WhatsApp" **só funciona por sondagem** — é
por isso que o modo Sondagem existe, e não como conveniência.

**2. Os eventos só nascem de escrita PELA API.** `emitirEvento` é chamado
exclusivamente das rotas de `api-publica/`; nenhuma rota de sessão emite. Na
prática, o canal de webhooks notifica _"escreveram pela API v1"_, e **não**
_"mudou no CRM"_. Um contato criado pela equipe na tela do Fluxo CRM **não**
dispara `contato.criado`. Quem precisa reagir ao trabalho humano precisa sondar.

**3. Buracos pontuais no catálogo:**

| Ausente              | Consequência                                                                                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `atividade.removida` | O `DELETE` de atividade não emite nada. Criada, atualizada e concluída emitem.                                                                                                                                                            |
| Pipeline / estágio   | Renomear, criar ou reordenar estágio não emite evento.                                                                                                                                                                                    |
| Arquivo              | Upload e exclusão de arquivo não emitem evento.                                                                                                                                                                                           |
| Webhook              | A própria assinatura não notifica quando é desativada pelo circuit breaker.                                                                                                                                                               |
| `webhook.teste`      | Emitido **apenas** por `POST /v1/webhooks/:id/testar` e **não é assinável** — o servidor recusa uma assinatura que o cite. Ele chega mesmo assim quando você clica em "Testar", e há a opção _Ignorar Entrega de Teste_ para descartá-lo. |

Os **26 eventos que existem** são `contato.{criado,atualizado,removido}`,
`empresa.{criada,atualizada,removida}`,
`lead.{criado,atualizado,convertido,removido}`,
`negocio.{criado,atualizado,estagio_alterado,ganho,perdido,removido}`,
`atividade.{criada,atualizada,concluida}`,
`interacao.{criada,atualizada,removida}`,
`registro.{criado,atualizado,removido}` e `nota.criada`. O coringa `*` assina
todos, **inclusive os que forem criados depois**.

### Modo Webhook

**A URL precisa ser HTTPS pública.** O servidor recusa `localhost`, `*.local`,
`*.internal`, faixas privadas de IPv4/IPv6 e endpoints de metadados — e
**revalida a cada entrega**. O node confere antes de chamar a API para que a
mensagem diga o que fazer (publicar a instância, ou trocar para Sondagem) em vez
de virar um 422 genérico.

**O segredo vem uma única vez.** `POST /v1/webhooks` devolve `segredo`
(`whsec_` + 64 hex) apenas na resposta de criação; nem `GET` nem `PATCH` o
devolvem. O node o guarda no _static data_, junto com o `webhookId`. Se o
segredo se perder, a assinatura antiga é apagada no servidor e uma nova é
criada — não há como recuperá-lo.

**Toda entrega é verificada antes de disparar o workflow:**

```
X-Fluxo-Signature: t=<unix_segundos>,v1=<hex>
v1 = HMAC_SHA256(segredo, "<t>." + corpo bruto)
```

O HMAC é calculado sobre `req.rawBody` — os bytes originais — e nunca sobre um
`JSON.stringify` do corpo já parseado, que reescreveria espaços, escapes e a
notação dos números. A comparação é `timingSafeEqual`, com o comprimento
conferido antes (ele **lança** com buffers de tamanhos diferentes). Carimbo fora
da janela de **300 segundos** é recusado nos dois sentidos. Falha de assinatura
responde **401** e o workflow **não** dispara.

**Coisas que o modo Webhook faz sozinho:**

- mudar a lista de Eventos com o workflow ativo faz um `PATCH` na assinatura
  existente, em vez de criar uma segunda;
- assinatura desativada pelo circuit breaker (**15 falhas consecutivas**) é
  reativada na próxima ativação, o que zera o contador no servidor;
- `404` no `checkExists` limpa `webhookId` **e** `webhookSecret` e registra de
  novo — sem isso a ativação entra em laço e acumula assinaturas órfãs.

**Latência real.** A entrega não sai de dentro do request: `emitirEvento`
enfileira e um cron de **1 minuto** faz o POST. "Tempo real" aqui significa _até
cerca de um minuto_. O reenvio segue o backoff 1min → 5min → 25min → 2h05 →
10h25, com no máximo 5 tentativas e timeout de 10 s por entrega.

**Se o workflow for excluído sem ser desativado**, o _static data_ some junto e a
assinatura fica órfã no CRM. Remova-a em _Configurações › Integrações_.

### Modo Sondagem

| Recurso                         | Rota                                            | Filtro no servidor                |
| ------------------------------- | ----------------------------------------------- | --------------------------------- |
| Contato, Empresa, Lead, Negócio | `/contatos`, `/empresas`, `/leads`, `/negocios` | `criado_apos` e `atualizado_apos` |
| Atividade                       | `/atividades`                                   | só `criado_apos`                  |
| Registro de Módulo              | `/modulos/{slug}/registros`                     | `criado_apos` e `atualizado_apos` |
| Atendimento › Conversa          | `/atendimento/conversas`                        | **nenhum** — o corte é local      |
| Atendimento › Mensagem          | `/atendimento/conversas` + `/:id/mensagens`     | **nenhum** — o corte é local      |

- **A primeira sondagem não emite nada.** Ela fixa a marca d'água no instante
  atual; do ciclo seguinte em diante sai o que for novo. Emitir a base inteira
  na ativação inundaria o workflow.
- **Em modo manual** (o botão _Fetch Test Event_) o node traz **1 amostra** sem
  filtro de data, para você ver o formato, e **não** move a marca d'água.
- **Nada novo devolve `null`**, nunca uma lista vazia — um array vazio contaria
  como execução e poluiria o histórico a cada minuto.
- **Armadilha da ordenação:** as listas ordenam por `criado_em` DESC, mas
  `atualizado_apos` filtra por `atualizado_em`. Um registro antigo recém-editado
  aparece no _fim_ da ordenação, não no começo — por isso a sondagem por
  atualização percorre o cursor até o fim (com teto de páginas configurável) em
  vez de ler só a primeira página.
- **Os filtros da API são `>=`, não `>`.** O node guarda os ids da fronteira
  junto com a marca para não reemitir o registro do limite, e ainda assim emitir
  outro gravado no mesmo milissegundo.
- **Custo do atendimento:** `GET /conversas/:id/mensagens` não aceita filtro de
  data, então cada conversa que se moveu custa uma requisição. Com 120
  requisições/minuto por chave, o teto _Máximo de Conversas por Sondagem_
  (padrão 20) é o que impede um ciclo de consumir a cota inteira. Ao bater no
  teto o node registra um aviso no log, em vez de truncar em silêncio.
- Mensagens saem com a conversa de origem em `__conversa`, para não exigir outra
  chamada só para saber de quem é. _Somente Mensagens Recebidas_ (ligado por
  padrão) descarta o que a própria equipe enviou.
- Uma nota interna move `ultima_mensagem_em` sem virar mensagem na rota pública.
  O node avança a marca mesmo assim quando visitou todas as conversas, para não
  reler a mesma conversa em todo ciclo.
- A marca d'água é o relógio **do n8n**, e os carimbos são do **servidor**: um
  desvio grande entre os dois relógios reemite ou perde a janela da diferença.

### Saída

Em webhook, o item é o envelope da entrega como a API o manda:

```json
{ "id": "<uuid da entrega>", "evento": "negocio.ganho", "criado_em": "<ISO>", "dados": {} }
```

`negocio.{estagio_alterado,ganho,perdido}` trazem também `estagio_anterior_id` e
`estagio_tipo` dentro de `dados`. Em operações de lote e em todo `*.removido`,
`dados` é apenas `{ "id": … }`. A opção _Incluir Metadados da Entrega_
acrescenta `__entrega` com o id e os cabeçalhos.

Em sondagem, o item é o recurso como a lista o devolve.

## Desenvolvimento

```bash
npm run lint        # @n8n/node-cli lint (precisa sair 0)
npm run typecheck   # tsc --noEmit no pacote e nos testes
npm test            # vitest
npm run build
```

### Arquitetura

```
credentials/FluxoCrmApi.credentials.ts   credencial + preAuthentication
nodes/FluxoCrm/
  FluxoCrm.node.ts                       descrição + execute
  compartilhado/escopos.ts               regra de escopo, cache e carimbo (sem dependência do n8n)
  compartilhado/catalogo.ts              recursos × operações × escopo exigido
  compartilhado/capacidades.ts           ponte entre o resolvedor e o runtime do n8n
  compartilhado/transporte.ts            HTTP, paginação e tradução de erro
  compartilhado/utilitarios.ts           UUID, datas, etiquetas, avisos
  descricoes/                            os campos da interface
  metodos/                               loadOptions, listSearch, credentialTest
  acoes/                                 os executores de cada recurso
nodes/FluxoCrmTrigger/
  FluxoCrmTrigger.node.ts                descrição + webhookMethods + webhook() + poll()
  assinatura.ts                          verificação HMAC (sem dependência do n8n)
  destino.ts                             espelho do anti-SSRF do servidor (sem dependência do n8n)
  catalogo.ts                            modos × eventos × recursos sondáveis × escopo exigido
  estado.ts                              o static data: registro do webhook e marca d'água
  registro.ts                            checkExists / create / delete
  sondagem.ts                            o motor da sondagem
  descricao.ts                           os campos da interface
  metodos.ts                             loadOptions
  transporte.ts                          ponte entre os contextos de gatilho e o compartilhado
test/                                    vitest
```

O cache de escopos é chaveado pelo **SHA-256 da credencial** (URL base + chave).
A classe do node é singleton do processo do n8n, compartilhada entre todos os
usuários da instância: cache mal chaveado vazaria escopos entre organizações.
Trocar a chave de API invalida o valor guardado, porque ele carrega a impressão
digital da credencial que o gerou.

## Licença

MIT

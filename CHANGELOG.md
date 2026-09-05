# Changelog

Todas as mudanças relevantes deste pacote são registradas aqui.

O formato segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e o
versionamento segue [Semantic Versioning](https://semver.org/lang/pt-BR/).

Além das seções padrão, cada versão pode trazer **Limitações conhecidas** —
restrições que continuam valendo depois da atualização. Elas não são defeitos
pendentes deste pacote: são comportamentos do servidor do Fluxo CRM que mudam o
que dá para montar, e quem instala precisa saber delas **antes**, não depois.

## [Não publicado]

### Adicionado

- **Campos de sistema no mapeador de campos.** Quando a API devolve o
  dicionário do módulo com as flags `sistema` e `somente_leitura` (API
  atualizada), o mapeador de Contato, Empresa, Negócio e Registro passa a
  oferecer também os campos de sistema que a operação aceita — o responsável em
  Contato e Empresa, o dono e a equipe em `Registro › Criar`, só a equipe em
  `Registro › Atualizar`, o dono em `Negócio › Criar` e `Criar ou Atualizar` —
  e os envia no **primeiro nível do corpo**, que é onde o servidor os lê, e não
  dentro de `valores`/`dados`. Criado em/por e atualizado em/por nunca entram
  na escrita: se chegarem por expressão, a execução recusa nomeando o campo,
  sem chamar a API. O mesmo campo informado no painel e no mapeador com valores
  diferentes também para a execução, em vez de gravar um dos dois em silêncio.
  Instância com API anterior às flags continua exatamente como antes.

- **Os 34 eventos de webhook do servidor, com rótulo em português.** O gatilho
  e `Webhook › Criar/Atualizar` passam a conhecer os oito eventos novos —
  `etiqueta.adicionada`, `etiqueta.removida`, `conversa.iniciada`,
  `conversa.resolvida`, `mensagem.recebida`, `mensagem.enviada`,
  `automacao.executada`, `automacao.falhou` — e todo evento aparece com rótulo
  (`Atendimento › Mensagem Recebida`, `Automacao › Falhou`…) em vez do
  identificador cru. Evento que o servidor devolva e este pacote ainda não
  conheça ganha rótulo derivado do identificador, sem sumir da lista.

- **`Webhook › Criar` no node de ação ganhou o mesmo fallback do gatilho.** Sem
  `webhooks:ler` (uma chave só de escrita), `GET /webhooks/eventos` responde
  403 e o dropdown abria vazio; agora cai para a lista estática dos 34, nos
  dois nodes, a partir de uma única tabela.

### Alterado

- **Os recursos de atendimento agora se chamam `Atendimento › Conversa`,
  `Atendimento › Mensagem`, `Atendimento › Canal` e `Atendimento › Atendente`**
  (antes: Conversa, Mensagem, Canal de Atendimento, Agente de Atendimento). Só
  o rótulo muda — o valor que o workflow salvo referencia é o mesmo, e nenhum
  node configurado precisa ser tocado. As operações desses recursos passam a
  citar "atendimento" e, onde cabe, "WhatsApp", para que a busca do painel de
  Actions as encontre. "Atendente", e não "Agente", porque o agente da v1 é
  uma pessoa — o nome fica livre para o futuro Agente de IA.
- Os dois nodes entram também na categoria **Communication** do n8n, além de
  Sales e Productivity.

### Corrigido

- **A descoberta diz o que falhou de verdade.** Quando `/v1/capabilities` e
  `/v1/me` falham, o node deixava de bloquear operações (fail-open, como
  antes) mas mandava "conferir a conectividade" para qualquer causa. Agora
  cada falha é classificada pelo status: 404 só em `/capabilities` segue para
  `/me` em silêncio; 404 nos dois é "Esta instância do Fluxo CRM está
  desatualizada: a API não expõe /v1/capabilities nem /v1/me. Atualize a API
  do CRM."; 401 é credencial recusada e 403 é falta de permissão, com o código
  que a API devolveu; e só a ausência de resposta é conectividade. Os dropdowns
  de descoberta (usuários, equipes, pipelines, etiquetas, módulos) recebem o
  mesmo motivo, e falha de rede deixa de ser memorizada por um minuto como
  "instância sem `/capabilities`".
- `Registro › Atualizar` só com a equipe preenchida devolvia 422: o `PATCH`
  exige a chave `valores` mesmo vazia, e o node passou a enviá-la (`{}` mescla
  nada e preserva tudo).
- "Filtros por Campo" de Registro e Negócio deixa de listar campos de sistema
  (`dono_id`, `criado_em`…) quando a API os devolve: o servidor confere o slug
  do filtro contra o layout e recusava com 422. Dono e datas já têm filtro
  próprio na mesma lista.
- **A descrição acionável de cada código de erro da API voltou a aparecer.** Em
  execução real o n8n entrega o erro embrulhado num `NodeApiError` (com o erro
  do transporte em `cause`), e o node o devolvia intacto: o envelope
  `{erro: {codigo}}` nunca era lido, e todo o mapa de códigos —
  `escopo_insuficiente` → "gere uma chave com o escopo exigido",
  `idempotencia_conflito`, `ip_nao_permitido`, `validacao` com os campos
  recusados — ficava sem uso. O que chegava ao painel era a frase genérica do
  n8n ("Forbidden - perhaps check your credentials?"). Agora o envelope é
  escavado de dentro do embrulho e a descrição é remontada pelo código, com o
  `Retry-After` do 429 quando o servidor o envia.
- **5xx e 429 em `/v1/capabilities` deixam de derrubar os cinco dropdowns de
  descoberta.** Usuários, equipes, módulos, pipelines e etiquetas têm rota
  própria, e o agregado existe por economia de requisições: uma falha passageira
  nele agora cai para a rota do bloco em vez de subir. Se a rota própria também
  falhar, quem sobe é o erro dela. O 5xx não é memorizado (a abertura seguinte
  do painel tenta o agregado de novo) e não conta mais como prova de "instância
  desatualizada" no diagnóstico.
- **O dropdown de eventos de webhook não disfarça mais falha de verdade.** Ele
  caía para a lista estática dos 34 eventos em QUALQUER falha de
  `GET /v1/webhooks/eventos`, registrando o motivo só em log de depuração — com
  a credencial recusada ou o servidor fora do ar, o painel abria normal, como
  se estivesse tudo certo. A queda agora acontece só em **403** (chave sem
  `webhooks:ler`, que é o caso legítimo) e **404** (instância anterior à rota);
  401, 5xx, 429 e rede fora sobem como erro, com o motivo. Vale para o gatilho e
  para `Webhook › Criar/Atualizar`.
- **`Dono` vazio é recusado antes da requisição em `Registro › Criar` e
  `Negócio › Criar` / `Criar ou Atualizar`.** O node deixava `null` passar para
  o primeiro nível do corpo em qualquer campo de sistema aceito, mas o schema
  do servidor declara `dono_id` como `optional()` sem `.nullable()` nessas três
  rotas: o vazio voltava 422. Agora a recusa nomeia o campo e a operação, e
  explica que a forma de deixar o campo sem valor é tirá-lo do mapeador.
  `equipe_id` (Registro) e `responsavel_id` (Contato e Empresa) são `.nullable()`
  e continuam aceitando vazio, que é como se limpa o responsável.
- Campo do **layout** cujo slug colide com um campo de sistema (`dono_id`,
  `criado_em`…) passa a ser recusado ao montar o mapeador, dizendo qual é o
  campo e onde renomeá-lo, em vez de ser tratado como campo de sistema em
  silêncio — o que mandaria o valor para a coluna errada do corpo.

### Limitações conhecidas

- O dicionário do módulo `tarefas` anuncia `dono_id` e `equipe_id` como
  graváveis, mas `POST` e `PATCH /atividades` não os aceitam — o responsável de
  uma atividade é `usuario_id`. O mapeador de Atividade não os oferece, e a
  execução recusa se vierem por expressão.
- `criado_por` e `atualizado_por` aparecem no dicionário, mas a leitura da v1
  ainda não os devolve nos registros, contatos e empresas.
- **Os oito eventos novos exigem a API com os emissores de domínio.** Numa
  instância anterior eles não existem: `POST /webhooks` recusa a assinatura com
  422 nomeando o evento, e os demais eventos continuam disparando só para
  escrita feita pela API v1. Nessas instâncias, a sondagem segue sendo o
  caminho para atendimento. O node não tem como saber a versão antes de
  tentar — a recusa vem do servidor.

## [0.1.1] - 2026-09-05

### Corrigido

- O ícone dos dois nodes e da credencial agora é o logotipo oficial do Fluxo
  (o "F" com gradiente azul), no tema claro e no escuro. A 0.1.0 saiu com um
  ícone genérico de CPU herdado do template.

## [0.1.0] - 2026-09-05

Primeira versão pública. O pacote entrega dois nodes e uma credencial para
automatizar o Fluxo CRM dentro do n8n, com a interface inteira em português.

### Adicionado

- **Node `Fluxo CRM`** — 19 recursos e 92 operações de leitura e escrita:
  Contato, Empresa, Negócio, Lead, Pipeline, Atividade, Interação, Nota,
  Arquivo, Etiqueta, Registro, Lote, Módulo, Organização, Webhook e os cinco de
  atendimento (Conversa, Mensagem, Canal de Atendimento, Agente de Atendimento).
- **Node `Fluxo CRM Trigger`** — gatilho com dois modos:
  - **Webhook**, para reagir ao evento na hora em que o CRM o emite;
  - **Sondagem Periódica**, para instâncias sem endereço público — e o único
    caminho para atendimento.
- **Credencial `Fluxo CRM API`** — URL base, chave de API e um botão **Test**
  que responde qual organização atendeu e o que a chave pode fazer, em vez de um
  "conectou" genérico.

- **A interface se adapta à sua chave.** O node lê os escopos uma única vez e
  guarda o resultado na credencial. Operação que a sua chave não pode executar
  aparece com cadeado 🔒 e o motivo logo abaixo, dizendo qual escopo falta e onde
  gerá-lo. Quem mesmo assim chegar à execução recebe esse erro, não o
  `The value "x" is not supported!` do n8n.

  O carimbo carrega uma impressão digital da credencial: trocar a chave descarta
  o carimbo antigo, em vez de filtrar a interface contra os escopos da chave
  anterior.

- **Comportamento _fail-open_.** Se o node não conseguir descobrir os escopos —
  uma chave legítima sem `meta:ler`, uma instância mais antiga — nada é
  bloqueado. Nenhum cadeado aparece e o servidor decide a cada chamada. A
  descoberta de escopos nunca vira um ponto de falha do seu fluxo.

- **Seletor de registro** em Contato, Empresa e Negócio: buscar pelo nome
  enquanto digita, colar o UUID, ou colar a URL da tela do CRM e deixar o node
  extrair o identificador.

- **Campos personalizados vindos do layout da sua organização.** Contato,
  Empresa, Atividade, Negócio e Registro trazem um mapeador que lê os campos
  reais da sua org, com o `obrigatório` de cada um respeitado em tempo de edição
  — sem montar JSON à mão.

- **`Criar ou Atualizar`** em Contato, Empresa, Lead, Negócio e Pipeline: casa
  por um campo de índice e cria quando não encontra.

- **`Lote`** grava até 200 fichas numa requisição só e devolve um item de saída
  por linha enviada, preservando o índice — importação em massa sem estourar o
  limite de requisições.

- **`Registro`, a saída de emergência genérica.** Opera qualquer módulo pelo
  slug, inclusive os personalizados que este node não conhece pelo nome. Um
  módulo criado na sua org depois desta versão continua alcançável.

- **`Chave de Idempotência`** disponível nas operações de escrita, em
  **Opções**. Com `{{ $execution.id }}-{{ $itemIndex }}`, reprocessar uma
  execução deixa de duplicar fichas.

- **Toda entrega de webhook é verificada.** A assinatura `X-Fluxo-Signature` é
  conferida sobre os bytes originais do corpo, com janela de replay de 300
  segundos. Entrega que não confere recebe **401 e não dispara o workflow** —
  uma entrega não verificada é indistinguível de uma forjada.

- **Endereço de webhook validado antes do registro.** O node recusa `http://`,
  `localhost`, redes privadas, CGNAT, link-local e endereços de metadados de
  nuvem, em vez de registrar uma assinatura que nunca receberia nada.

- **Sondagem que não inunda o workflow.** A primeira sondagem apenas fixa a
  marca d'água, sem emitir a base inteira. A execução manual não mexe na marca e
  devolve no máximo um item. Zero resultados não gera execução. E os ids do
  instante da marca (até 200) são guardados para que o registro da fronteira não
  saia duas vezes — os filtros de data da API são `>=`, não `>`.

- **Nenhuma dependência de runtime.** O node roda dentro do processo do n8n, e
  o campo `dependencies` é deliberadamente vazio. O CI reprova se alguém
  adicionar uma.

### Limitações conhecidas

Todas são do **servidor** do Fluxo CRM, não deste pacote. Elas decidem qual modo
de gatilho resolve o seu caso.

- **Webhooks só disparam para escritas feitas pela API v1.** O que a sua equipe
  faz na tela do Fluxo CRM não emite evento nenhum: um contato criado pelo
  comercial na interface **não** dispara `contato.criado`. Há correção em
  andamento no servidor, mas ela **ainda não está no ar** — quem precisa reagir
  ao trabalho humano hoje precisa usar o modo **Sondagem**.

- **Atendimento não emite evento nenhum.** Não existe `conversa.criada`, nem
  `mensagem.recebida`, nem `conversa.atribuida`. "Disparar quando chegar
  mensagem no WhatsApp" **só funciona por sondagem**, e não é algo que este node
  possa contornar.

- **"Tempo real" é até cerca de 1 minuto.** A entrega dos eventos sai de um cron
  de 1 minuto, e o intervalo mínimo da sondagem do n8n também é 1 minuto. Casos
  que exigem latência abaixo disso não são atendidos por este gatilho.

- **Datas de saída não são normalizadas**, de propósito — converter só em alguns
  lugares produziria duas convenções no mesmo fluxo. A maioria dos campos vem em
  `America/Sao_Paulo`, mas `enviada_em` das mensagens, o `criado_em` do envelope
  do webhook e `Registro › Listar Histórico` vêm em **UTC**. Ao comparar datas
  de fontes diferentes no mesmo workflow, converta explicitamente.

- **`PATCH` tem semânticas opostas conforme o recurso.** Em Contato, Empresa e
  Atividade o campo `dados` **substitui** o conjunto inteiro: a chave que você
  não preencher é **apagada**. Em Registro e Negócio o campo `valores`
  **mescla**: o que você não preencher é preservado. Contato tem escapatória — a
  opção **Mesclar Com os Valores Atuais**, ligada por padrão, lê a ficha e
  mescla antes de gravar, ao custo de uma requisição a mais por item. Empresa e
  Atividade **não** têm essa opção.

- **Etiquetas são re-divididas pelo servidor** por `,` e `;`, então
  `"VIP, Urgente"` vira duas etiquetas. A API acrescenta e nunca substitui; para
  remover, use `Etiqueta › Desvincular`.

- **`Mensagem › Enviar` só manda texto.** Mídia responde 422.

- **Limite de 120 requisições por minuto por chave.** O node traduz o 429 com o
  `Retry-After` que o servidor pediu, mas o teto é do servidor.

### Notas

- Community nodes exigem uma instância **self-hosted**. Este pacote não busca a
  verificação oficial da n8n, porque a interface é em português e o processo de
  verificação exige inglês — então ele não aparece no n8n Cloud.

[Não publicado]: https://github.com/htnnn/n8n-nodes-fluxo-crm/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/htnnn/n8n-nodes-fluxo-crm/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/htnnn/n8n-nodes-fluxo-crm/releases/tag/v0.1.0

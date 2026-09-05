# n8n-nodes-fluxo-crm

Node comunitário do n8n para a API pública do **Fluxo CRM**.

A interface é em português, por decisão do produto.

> **Estado: fundação + 2 recursos piloto.** Contato e Negócio estão completos.
> Os outros 16 recursos do catálogo (Empresa, Lead, Pipeline, Atividade,
> Registro, Nota, Arquivo, Lote, Atendimento, Webhook, Módulo, Etiqueta,
> Organização) e o Trigger node vêm nas próximas ondas, reusando a mesma
> fundação.

## Instalação

Pela interface do n8n em `Configurações → Community nodes`, ou localmente:

```bash
npm install
npm run build
npm run dev      # sobe um n8n com este node linkado
```

## Credencial

`Fluxo CRM API`:

| Campo | Para que serve |
| --- | --- |
| URL Base | Endereço da API com o prefixo de versão (`https://api-crm.nafluxo.com.br/v1`) |
| Chave de API | Enviada como `Authorization: Bearer <chave>` |
| Escopos da Chave | `hidden` + `expirable`, preenchido pelo `preAuthentication` |

O teste da credencial chama `GET /me`, lê os escopos e devolve uma mensagem
útil — a organização que respondeu e o que a chave pode fazer.

**Chave sem `meta:ler`.** Enquanto `GET /me` exigir esse escopo, uma chave
legítima sem ele não permite descobrir os escopos. O node não trava: ele entra
em modo *fail-open* (nada fica com cadeado) e deixa o servidor decidir a cada
chamada.

## Como o cadeado por escopo funciona

Operação que a chave **não pode** executar continua na lista e continua
selecionável, com cadeado no nome e o motivo logo abaixo:

```
🔒 Criar Contato
   Requer o escopo contatos:escrever — gere uma chave nova em Configurações › Integrações
```

Isso é deliberado. O painel de *Actions* do node creator renderiza **antes** de
existir credencial, então ele nunca filtra por escopo; esconder a operação no
dropdown faria os dois se contradizerem. Quem selecionar mesmo assim recebe, na
execução, um erro que diz qual escopo falta e onde consegui-lo — nunca o
genérico `The value "x" is not supported!`.

A regra de escopo replica a do servidor: `*` é coringa global, `recurso:*` cobre
as duas ações daquele recurso, e **`escrever` não implica `ler`**.

## Recursos

| Recurso | Operações |
| --- | --- |
| Contato | Listar, Obter, Criar, Criar ou Atualizar, Atualizar, Excluir, Verificar Existência, Listar Atividades |
| Negócio | Listar, Obter, Criar, Criar ou Atualizar, Atualizar, Excluir, Mover, Marcar Como Ganho, Marcar Como Perdido |

### Armadilhas da API que o node trata para você

- **`Campos Personalizados` de contato SUBSTITUI o conjunto inteiro**, enquanto
  `Valores do Módulo` de negócio **mescla**. Semânticas opostas na mesma API. Há
  um aviso fixo em cada operação, e a opção *Mesclar Com os Valores Atuais*
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
test/                                    vitest
```

O cache de escopos é chaveado pelo **SHA-256 da credencial** (URL base + chave).
A classe do node é singleton do processo do n8n, compartilhada entre todos os
usuários da instância: cache mal chaveado vazaria escopos entre organizações.
Trocar a chave de API invalida o valor guardado, porque ele carrega a impressão
digital da credencial que o gerou.

## Licença

MIT

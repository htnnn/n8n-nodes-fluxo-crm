# Contribuindo

Este documento cobre duas coisas: o dia a dia de desenvolvimento e o **processo
de release**, que é sempre o mesmo — versão bumpada, CHANGELOG atualizado, tag,
GitHub Release, e a publicação no npm como consequência do Release.

- [Ambiente](#ambiente)
- [Catracas](#catracas)
- [Commits](#commits)
- [O CHANGELOG](#o-changelog)
- [Cortar uma release](#cortar-uma-release)
- [🔴 A primeira publicação é diferente](#-a-primeira-publicação-é-diferente)
- [Da 0.1.1 em diante](#da-011-em-diante)
- [Quando algo dá errado](#quando-algo-dá-errado)
- [Por que não usamos `n8n-node release`](#por-que-não-usamos-n8n-node-release)

---

## Ambiente

```bash
npm install
npm run dev        # sobe um n8n com este node linkado
```

Node 22 é a versão usada no CI.

## Catracas

As quatro precisam passar antes de qualquer push:

```bash
npm run lint       # eslint com as regras do n8n-node
npm run typecheck  # tsc --noEmit no pacote e nos testes
npm test           # vitest
npm run build      # tsc + cópia dos assets para dist/
```

Há uma quinta, que não é um comando: **o campo `dependencies` do
`package.json` tem de continuar vazio**. O node roda dentro do processo do n8n,
e tudo que entra aqui entra no processo de quem instalar. O CI reprova se alguém
adicionar uma, e o script de release também.

`devDependencies` são livres.

## Commits

Conventional commits, em português:

```
feat(gatilho): adiciona sondagem por atualização em Registro
fix(escopos): descarta o carimbo quando a chave muda
docs: explica a semântica oposta do PATCH
chore(release): v0.2.0
```

O tipo decide o bump: `feat` → `minor`, `fix` → `patch`, `BREAKING CHANGE` →
`major`. Mas nada disso é automático — **você escolhe o tipo na hora de cortar a
release**, de propósito: um `feat` pode ser uma mudança que quebra fluxos
existentes, e só quem escreveu sabe.

## O CHANGELOG

`CHANGELOG.md` segue [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/).

**A cada mudança que um usuário perceberia, acrescente uma linha em
`## [Não publicado]`** — não deixe para a hora da release. As categorias são
`Adicionado`, `Alterado`, `Descontinuado`, `Removido`, `Corrigido`, `Segurança`,
mais `Limitações conhecidas` quando uma restrição do servidor muda o que dá para
montar.

Escreva para **quem consome o node**, não para quem escreveu o código. "Refatora
o transporte HTTP" não diz nada a ninguém; "as respostas 429 agora respeitam o
`Retry-After` do servidor" diz.

O script de release move essa seção para a versão nova, com a data, e refaz os
links de comparação do rodapé. Você não mexe nisso à mão.

---

## Cortar uma release

Um comando:

```bash
npm run release -- minor        # ou patch, ou major, ou 1.2.3
```

### Antes, confira

1. **Você está na `main`, sem nada pendente**, e `main` está em sincronia com
   `origin/main`. O script recusa qualquer outra situação.
2. **O CI está verde no commit que vai virar release.** O script confere isso
   pelo SHA (`gh run list --commit <sha>`), não pela branch — verde do CI
   pertence ao commit, e um rebase deixa o verde para trás.
3. **`## [Não publicado]` descreve o que muda.** Se estiver vazio, não há
   release a cortar.
4. **O tipo do bump está certo.** Ensaie primeiro:

```bash
npm run release:ensaio -- minor
```

O ensaio roda as pré-condições e as catracas, mostra a versão que sairia, o
commit, a tag, e **imprime as notas exatas que iriam para o GitHub Release** —
sem escrever, commitar ou empurrar nada. É a forma de ver o resultado antes de
produzi-lo.

### O que o comando faz, em ordem

| # | Passo | Detalhe |
|---|-------|---------|
| 1 | Pré-condições | branch `main`, árvore limpa, sincronia com `origin`, tag livre, CI verde no SHA |
| 2 | Catracas | `lint`, `typecheck`, `test`, `build`, e `dependencies` vazio |
| 3 | Versão | `npm version <alvo> --no-git-tag-version` — atualiza `package.json` **e** `package-lock.json` |
| 4 | CHANGELOG | move `[Não publicado]` para `[X.Y.Z] - AAAA-MM-DD` e refaz os links |
| 5 | Commit e tag | `chore(release): vX.Y.Z` e a tag anotada `vX.Y.Z` |
| 6 | Push | `origin main` e a tag |
| 7 | GitHub Release | criado com as notas daquela seção do CHANGELOG |

**O passo 7 é o gatilho.** `.github/workflows/publish.yml` roda em
`release: published` e é ele quem publica no npm — com proveniência, a partir do
código que está na tag. O script **nunca** publica: publicar da máquina de
alguém produz um pacote sem proveniência, que é exatamente o que o trusted
publishing existe para evitar.

Depois de cortar, acompanhe:

```bash
gh run list --workflow "Publicar no npm"
```

### Flags

| Flag | Para que serve |
|------|----------------|
| `--dry-run` | Roda tudo o que não escreve e mostra o que faria. Não toca em disco, git nem GitHub. |
| `--sem-github` | Vai até a tag empurrada e para. **Não** cria o Release, então **não** publica. É o caminho da primeira publicação. |
| `--sem-gates` | Pula lint/typecheck/testes/build. Só vale junto de `--dry-run` — uma release de verdade sempre roda as catracas. |

---

## 🔴 A primeira publicação é diferente

**Leia isto antes de tentar publicar a `0.1.0`.**

O **Trusted Publishing do npm só pode ser configurado num pacote que já existe
no registro.** A página de Settings onde se cadastra o publicador confiável
simplesmente não existe enquanto ninguém publicou o nome. Ou seja: a versão que
cria o pacote no npm **não pode** ser publicada por OIDC. É um ovo-e-galinha, e
não há como contorná-lo pelo lado do GitHub.

Então a `0.1.0` sai com autenticação normal, e só depois o OIDC assume. Há dois
caminhos. **Escolha um.**

| | Caminho A — token temporário | Caminho B — publicar da sua máquina |
|---|---|---|
| Quem publica | o GitHub Actions | você, no seu terminal |
| Existe Release da `v0.1.0`? | sim, desde o começo | não, ou criado depois e vermelho |
| Precisa de secret? | sim, apagado logo em seguida | não |
| **Recomendado** | ✅ deixa o histórico coerente | quando você não quer criar secret nenhum |

---

### Caminho A — token temporário (recomendado)

Mantém a regra que vale para sempre: **toda versão publicada tem um Release
correspondente, e quem publica é o CI.**

**A1.** Em [npmjs.com](https://www.npmjs.com) → **Access Tokens** → gere um token
de publicação (*Automation*, ou *Granular* com permissão de escrita).

**A2.** No GitHub: **Settings → Secrets and variables → Actions → New repository
secret**, nome `NPM_TOKEN`, valor o token. O `publish.yml` detecta o secret
sozinho e usa esse caminho no lugar do OIDC.

**A3.** Corte a release normalmente:

```bash
npm run release -- 0.1.0
```

A `0.1.0` já é a versão do `package.json` e já está descrita no `CHANGELOG.md`,
então o comando não bumpa nem promove nada: ele confere tudo, cria a tag
`v0.1.0`, empurra e abre o GitHub Release — que dispara o workflow, e o workflow
publica. Acompanhe com `gh run list --workflow "Publicar no npm"`.

**A4.** Cadastre o publicador confiável (seção abaixo) e **apague o secret
`NPM_TOKEN`**. A partir daí o OIDC assume sozinho.

---

### Caminho B — publicar da sua máquina

**B1.** Corte a tag **sem** criar o Release, para não disparar o workflow (que
ainda não teria como se autenticar):

```bash
npm run release -- 0.1.0 --sem-github
```

**B2.** Publique à mão, uma única vez. O `dist/` já foi construído pelo passo
anterior.

O `prepublishOnly` deste pacote (`n8n-node prerelease`) **sai com código 1 de
propósito**, para barrar `npm publish` avulso. Para a publicação deliberada,
declare `RELEASE_MODE`:

```bash
npm login                                     # conta dona do pacote

# bash / WSL / macOS
RELEASE_MODE=true npm publish --access public

# PowerShell
$env:RELEASE_MODE='true'; npm publish --access public; Remove-Item Env:\RELEASE_MODE
```

**B3.** Cadastre o publicador confiável (seção abaixo).

**B4.** *(opcional)* Crie o Release da `v0.1.0` pela interface do GitHub —
**Releases → Draft a new release**, escolha a tag `v0.1.0` que já está lá, título
`v0.1.0`, e cole no corpo a seção `## [0.1.0]` do `CHANGELOG.md`. O workflow vai
rodar e tentar republicar; o npm recusa com 403 ("cannot publish over previously
published version") e o job fica vermelho. É esperado e inofensivo — mas é
exatamente por isso que o caminho A é o recomendado.

---

### Cadastrar o publicador confiável (os dois caminhos)

Agora que o pacote existe no registro:

1. Entre em [npmjs.com](https://www.npmjs.com) com a conta dona do pacote.
2. Página do pacote → **Settings** → **Trusted Publisher**.
3. Escolha **GitHub Actions** e preencha **exatamente**:

   | Campo | Valor |
   |-------|-------|
   | Organization or user | `htnnn` |
   | Repository | `n8n-nodes-fluxo-crm` |
   | Workflow filename | `publish.yml` |
   | Environment | *(deixe vazio)* |

4. Se a conta exige 2FA para publicar, marque a exceção para **Trusted
   Publishers** — senão o CI é barrado pedindo OTP.
5. **Se você criou o secret `NPM_TOKEN`, apague-o agora.** Um token de longa
   duração parado num repositório é exatamente o risco que o OIDC elimina — e
   enquanto ele existir, o `publish.yml` vai preferi-lo ao OIDC.

---

## Da 0.1.1 em diante

Nada de especial. Um comando:

```bash
npm run release -- patch
```

O Release criado dispara o workflow, que roda as catracas de novo e publica por
OIDC. **Nenhum token, em lugar nenhum.**

## Quando algo dá errado

| Sintoma | O que é |
|---------|---------|
| `Release abortada: main precisa estar em sincronia` | Você tem commit local não empurrado, ou está atrás do remoto. `git push` ou `git pull --ff-only` antes. |
| `Release abortada: O CI nao esta verde` | O commit que viraria release reprovou. Conserte e empurre antes de cortar. |
| `Release abortada: A tag vX.Y.Z ja existe` | A versão já foi cortada. Escolha outro bump. |
| `Release abortada: A secao [Não publicado] esta vazia` | Não há nada a publicar. Descreva a mudança no CHANGELOG. |
| Workflow reprovou em **Confere versao** | A tag e o `package.json` discordam. Isso é a rede de segurança fazendo o trabalho dela: apague o Release e a tag, e corte de novo com `npm run release`. |
| `Run \`npm run release\` to publish the package` e exit 1 | Você rodou `npm publish` sem `RELEASE_MODE=true`. É a guarda do `prepublishOnly`. |
| Workflow reprovou pedindo OTP | O 2FA da conta npm está exigindo OTP para publicar. Marque a exceção para Trusted Publishers. |
| npm respondeu 403 "cannot publish over previously published version" | A versão já está no registro. Versões do npm são imutáveis: suba uma nova. |

**Versão publicada não volta.** O npm não permite republicar um número, e
`npm unpublish` só funciona em janelas curtas e estreitas. É por isso que as
catracas rodam antes do `npm publish`, e não depois.

## Por que não usamos `n8n-node release`

O `@n8n/node-cli` expõe um comando `release`, e o `package.json` deste pacote já
o citava. Ele não serve aqui, por três motivos concretos — todos verificados no
código do pacote, em `node_modules/@n8n/node-cli/dist/commands/release.js`:

1. **Ele não deixa escolher o tipo do bump.** O comando invoca `release-it` com
   `-n` (não-interativo) e não repassa argumento nenhum, então toda release sai
   `patch`. Não há como cortar uma `minor` ou uma `major`.

2. **Ele destruiria o CHANGELOG.** O comando passa
   `--hooks.after:bump="npx auto-changelog -p"`, e o `auto-changelog` reescreve
   o `CHANGELOG.md` inteiro a partir das mensagens de commit. O changelog escrito
   à mão, em português e voltado a quem consome o node, seria sobrescrito por uma
   lista de commits a cada release.

3. **Ele depende de pacotes que não estão instalados.** `release-it` e
   `auto-changelog` não são dependências deste projeto; o comando os busca no
   registro via `npm exec` na hora de rodar. Uma release passaria a depender de
   rede e da versão que estivesse publicada naquele dia.

A alternativa seria adicionar `release-it` e `@release-it/keep-a-changelog` como
devDependencies. Foi descartada porque arrastaria mais de uma centena de pacotes
transitivos para um projeto cuja identidade é não ter dependência nenhuma — e
este repositório acabou de gastar quatro execuções de CI brigando com
instabilidade de resolução de árvore. `scripts/release.mjs` usa só builtins do
Node, `git` e `gh`, e as duas partes puras estão cobertas por testes:
`test/changelog.test.mjs` (transformação do CHANGELOG, inclusive contra o
arquivo real deste repositório) e `test/release-versao.test.mjs` (aritmética do
semver, inclusive a recusa de um número menor que o atual).

O `prepublishOnly: n8n-node prerelease` foi **mantido**: é uma guarda barata que
faz `npm publish` avulso sair com código 1.

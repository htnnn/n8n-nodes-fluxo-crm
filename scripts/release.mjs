#!/usr/bin/env node
/**
 * Corta uma release deste pacote.
 *
 *   node scripts/release.mjs <patch|minor|major|X.Y.Z> [opcoes]
 *   npm run release -- minor
 *
 * O que ele faz, em ordem:
 *
 *   1. confere as pre-condicoes (branch, arvore limpa, sincronia, tag livre);
 *   2. roda as catracas (lint, typecheck, testes, build, sem `dependencies`);
 *   3. sobe a versao no `package.json` e no `package-lock.json`;
 *   4. promove `[Não publicado]` para a versao nova no CHANGELOG.md;
 *   5. commita e cria a tag `vX.Y.Z`;
 *   6. empurra o commit e a tag;
 *   7. cria o GitHub Release com as notas daquela versao.
 *
 * O passo 7 e o gatilho: `.github/workflows/publish.yml` roda em
 * `release: published` e e ele quem publica no npm. Este script NUNCA publica
 * — publicar da maquina de alguem produz um pacote sem proveniencia, que e
 * exatamente o que o trusted publishing existe para evitar.
 *
 * Opcoes:
 *   --dry-run     mostra tudo o que faria e nao escreve nada
 *   --sem-github  vai ate a tag empurrada e para, sem criar o Release
 *                 (e o caminho da PRIMEIRA publicacao — veja CONTRIBUTING.md)
 *   --sem-gates   pula lint/typecheck/testes/build; so vale junto de --dry-run
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { notasDaVersao, promoverNaoPublicado, versoesRegistradas } from './changelog.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CAMINHO_PACKAGE = join(RAIZ, 'package.json');
const CAMINHO_CHANGELOG = join(RAIZ, 'CHANGELOG.md');
const NO_WINDOWS = process.platform === 'win32';

const ESC = `${String.fromCharCode(27)}[`;
const pintar = (codigo) => (texto) =>
	process.stdout.isTTY ? `${ESC}${codigo}m${texto}${ESC}0m` : texto;

const cor = {
	titulo: pintar(1),
	ok: pintar(32),
	aviso: pintar(33),
	erro: pintar(31),
	fraco: pintar(90),
};

class ErroDeRelease extends Error {}

function abortar(mensagem) {
	throw new ErroDeRelease(mensagem);
}

/** Roda um comando e devolve a saida. Lanca se o comando falhar. */
function capturar(comando, args, { permitirFalha = false } = {}) {
	const r = spawnSync(comando, args, {
		cwd: RAIZ,
		encoding: 'utf8',
		shell: NO_WINDOWS && comando === 'npm',
	});
	if (r.error) {
		if (permitirFalha) return null;
		abortar(`Nao consegui executar \`${comando}\`: ${r.error.message}`);
	}
	if (r.status !== 0) {
		if (permitirFalha) return null;
		abortar(
			`\`${comando} ${args.join(' ')}\` saiu com codigo ${r.status}.\n${(r.stderr || r.stdout || '').trim()}`,
		);
	}
	return (r.stdout ?? '').trim();
}

/** Roda um comando mostrando a saida ao vivo. Lanca se o comando falhar. */
function executar(comando, args) {
	const r = spawnSync(comando, args, {
		cwd: RAIZ,
		stdio: 'inherit',
		shell: NO_WINDOWS && comando === 'npm',
	});
	if (r.error) abortar(`Nao consegui executar \`${comando}\`: ${r.error.message}`);
	if (r.status !== 0) abortar(`\`${comando} ${args.join(' ')}\` saiu com codigo ${r.status}.`);
}

function lerPackage() {
	return JSON.parse(readFileSync(CAMINHO_PACKAGE, 'utf8'));
}

/**
 * Resolve o alvo a partir do tipo pedido.
 *
 * Exportada para `test/release-versao.test.mjs` — a aritmetica de semver e o
 * unico pedaco deste arquivo que da para cobrir sem git nem rede.
 *
 * @param {string} pedido `patch`, `minor`, `major` ou uma versao literal
 * @param {string} atual  versao do package.json
 */
export function resolverVersao(pedido, atual) {
	const partes = /^(\d+)\.(\d+)\.(\d+)$/.exec(atual);
	if (!partes) abortar(`A versao atual do package.json nao e um semver simples: "${atual}".`);
	const [maior, menor, correcao] = partes.slice(1).map(Number);

	switch (pedido) {
		case 'major':
			return `${maior + 1}.0.0`;
		case 'minor':
			return `${maior}.${menor + 1}.0`;
		case 'patch':
			return `${maior}.${menor}.${correcao + 1}`;
		default: {
			if (!/^\d+\.\d+\.\d+$/.test(pedido)) {
				abortar(
					`Tipo invalido: "${pedido}". Use \`patch\`, \`minor\`, \`major\` ou uma versao \`X.Y.Z\`.`,
				);
			}
			// Versoes do npm sao imutaveis e a ordem e monotonica: publicar um
			// numero menor que o atual deixa o `latest` apontando para tras.
			const pedidas = pedido.split('.').map(Number);
			const atuais = [maior, menor, correcao];
			for (let i = 0; i < 3; i++) {
				if (pedidas[i] > atuais[i]) break;
				if (pedidas[i] < atuais[i]) {
					abortar(`A versao pedida (${pedido}) e menor que a atual (${atual}).`);
				}
			}
			return pedido;
		}
	}
}

function dataDeHoje() {
	const agora = new Date();
	const p = (n) => String(n).padStart(2, '0');
	return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

// ---------------------------------------------------------------- pre-condicoes

function conferirPreCondicoes(tag) {
	const branch = capturar('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
	if (branch !== 'main') {
		abortar(`A release sai de \`main\`. Voce esta em \`${branch}\`.`);
	}

	const sujo = capturar('git', ['status', '--porcelain']);
	if (sujo) {
		abortar(`A arvore precisa estar limpa. Pendente:\n${sujo}`);
	}

	console.log(cor.fraco('  buscando origin/main...'));
	capturar('git', ['fetch', 'origin', 'main', '--tags']);

	const contagem = capturar('git', ['rev-list', '--left-right', '--count', 'origin/main...HEAD']);
	const [atras, adiante] = contagem.split(/\s+/).map(Number);
	if (atras > 0 || adiante > 0) {
		abortar(
			`\`main\` precisa estar em sincronia com \`origin/main\` (${atras} atras, ${adiante} adiante).\n` +
				'A versao publicada precisa ser exatamente a que o CI verificou.',
		);
	}

	const tagLocal = capturar('git', ['tag', '--list', tag]);
	if (tagLocal) abortar(`A tag \`${tag}\` ja existe localmente.`);

	const tagRemota = capturar('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
	if (tagRemota) abortar(`A tag \`${tag}\` ja existe em \`origin\`.`);

	conferirCiVerde();
}

/**
 * O CI precisa estar verde no commit que vai virar release.
 *
 * Verde do CI pertence ao COMMIT, nao a branch: por isso a consulta e por sha,
 * e nao "a ultima execucao de main".
 */
function conferirCiVerde() {
	const sha = capturar('git', ['rev-parse', 'HEAD']);
	const saida = capturar(
		'gh',
		['run', 'list', '--commit', sha, '--workflow', 'CI', '--json', 'conclusion,status', '--limit', '5'],
		{ permitirFalha: true },
	);

	if (saida === null) {
		console.log(cor.aviso(`  ! nao consegui consultar o CI (gh indisponivel) — confira a mao`));
		return;
	}

	let execucoes;
	try {
		execucoes = JSON.parse(saida);
	} catch {
		console.log(cor.aviso('  ! resposta inesperada do gh — confira o CI a mao'));
		return;
	}

	if (execucoes.length === 0) {
		console.log(cor.aviso(`  ! nenhuma execucao de CI para ${sha.slice(0, 9)} — confira a mao`));
		return;
	}

	const pendente = execucoes.find((e) => e.status !== 'completed');
	if (pendente) abortar(`O CI ainda esta rodando em ${sha.slice(0, 9)}. Espere terminar.`);

	const reprovada = execucoes.find((e) => e.conclusion !== 'success');
	if (reprovada) {
		abortar(`O CI nao esta verde em ${sha.slice(0, 9)} (conclusao: ${reprovada.conclusion}).`);
	}

	console.log(cor.ok(`  ok CI verde em ${sha.slice(0, 9)}`));
}

// -------------------------------------------------------------------- catracas

function rodarCatracas() {
	for (const script of ['lint', 'typecheck', 'test', 'build']) {
		console.log(cor.fraco(`  npm run ${script}`));
		executar('npm', ['run', script]);
	}

	const deps = lerPackage().dependencies ?? {};
	if (Object.keys(deps).length > 0) {
		abortar(
			`O package.json ganhou \`dependencies\` de runtime: ${JSON.stringify(deps)}.\n` +
				'O node roda dentro do processo do n8n — esse campo tem de continuar vazio.',
		);
	}
	console.log(cor.ok('  ok nenhuma dependencia de runtime'));
}

// ----------------------------------------------------------------------- fluxo

function principal() {
	const args = process.argv.slice(2);
	const opcoes = new Set(args.filter((a) => a.startsWith('--')));
	const posicionais = args.filter((a) => !a.startsWith('--'));

	const ensaio = opcoes.has('--dry-run');
	const semGithub = opcoes.has('--sem-github');
	const semGates = opcoes.has('--sem-gates');

	const desconhecidas = [...opcoes].filter(
		(o) => !['--dry-run', '--sem-github', '--sem-gates'].includes(o),
	);
	if (desconhecidas.length) abortar(`Opcao desconhecida: ${desconhecidas.join(', ')}`);

	if (semGates && !ensaio) {
		abortar('`--sem-gates` so vale junto de `--dry-run`. Uma release de verdade roda as catracas.');
	}

	if (posicionais.length !== 1) {
		abortar(
			'Uso: node scripts/release.mjs <patch|minor|major|X.Y.Z> [--dry-run] [--sem-github]',
		);
	}

	const pacote = lerPackage();
	const atual = pacote.version;
	const alvo = resolverVersao(posicionais[0], atual);
	const tag = `v${alvo}`;
	const changelog = readFileSync(CAMINHO_CHANGELOG, 'utf8');
	const jaRegistrada = versoesRegistradas(changelog).includes(alvo);

	console.log(cor.titulo(`\nRelease ${pacote.name} ${atual} -> ${alvo}${ensaio ? ' (ENSAIO)' : ''}\n`));

	// 1. pre-condicoes
	console.log(cor.titulo('1. Pre-condicoes'));
	conferirPreCondicoes(tag);
	console.log(cor.ok('  ok branch, arvore, sincronia e tag'));

	// 2. catracas
	console.log(cor.titulo('\n2. Catracas'));
	if (semGates) console.log(cor.aviso('  ! puladas por --sem-gates'));
	else rodarCatracas();

	// 3. changelog + versao
	console.log(cor.titulo('\n3. Versao e CHANGELOG'));

	let novoChangelog = changelog;
	if (jaRegistrada) {
		// A secao ja existe escrita a mao. E o caso da primeira release, em que o
		// package.json ja nasceu na versao alvo. Nada a promover.
		console.log(cor.fraco(`  CHANGELOG.md ja descreve a versao ${alvo} — mantido como esta`));
	} else {
		novoChangelog = promoverNaoPublicado(changelog, alvo, dataDeHoje());
		console.log(cor.ok(`  ok [Não publicado] promovido para [${alvo}] - ${dataDeHoje()}`));
	}

	const notas = notasDaVersao(novoChangelog, alvo);
	if (!notas.trim()) abortar(`A secao [${alvo}] do CHANGELOG.md esta vazia.`);

	const precisaCommit = alvo !== atual || novoChangelog !== changelog;

	if (ensaio) {
		console.log(cor.fraco(`  (ensaio) package.json ficaria em ${alvo}`));
		console.log(cor.fraco(`  (ensaio) commit: ${precisaCommit ? `chore(release): ${tag}` : 'nenhum'}`));
		console.log(cor.fraco(`  (ensaio) tag: ${tag}`));
		console.log(cor.fraco(`  (ensaio) push: origin main + ${tag}`));
		console.log(
			cor.fraco(`  (ensaio) GitHub Release: ${semGithub ? 'nao (--sem-github)' : tag}`),
		);
		console.log(cor.titulo('\n--- notas que iriam para o Release ---'));
		console.log(notas);
		console.log(cor.titulo('--- fim das notas ---'));
		console.log(cor.ok('\nEnsaio concluido. Nada foi escrito, commitado ou empurrado.\n'));
		return;
	}

	if (alvo !== atual) {
		executar('npm', ['version', alvo, '--no-git-tag-version']);
		console.log(cor.ok(`  ok package.json e package-lock.json em ${alvo}`));
	}
	if (novoChangelog !== changelog) {
		writeFileSync(CAMINHO_CHANGELOG, novoChangelog);
	}

	// 4. commit e tag
	console.log(cor.titulo('\n4. Commit e tag'));
	if (precisaCommit) {
		executar('git', ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md']);
		executar('git', ['commit', '-m', `chore(release): ${tag}`]);
		console.log(cor.ok(`  ok commit chore(release): ${tag}`));
	} else {
		console.log(cor.fraco('  nada mudou — a tag aponta para o commit atual'));
	}
	executar('git', ['tag', '-a', tag, '-m', tag]);
	console.log(cor.ok(`  ok tag ${tag}`));

	// 5. push
	console.log(cor.titulo('\n5. Push'));
	executar('git', ['push', 'origin', 'main']);
	executar('git', ['push', 'origin', tag]);
	console.log(cor.ok(`  ok origin/main e ${tag} empurrados`));

	// 6. GitHub Release — e ele quem dispara a publicacao no npm
	console.log(cor.titulo('\n6. GitHub Release'));
	if (semGithub) {
		console.log(cor.aviso('  ! pulado por --sem-github'));
		console.log(
			cor.aviso(
				`  A publicacao no npm NAO foi disparada. Crie o Release de ${tag} quando quiser publicar.`,
			),
		);
	} else {
		const pasta = mkdtempSync(join(tmpdir(), 'fluxo-release-'));
		const arquivo = join(pasta, 'notas.md');
		try {
			writeFileSync(arquivo, `${notas}\n`);
			executar('gh', [
				'release',
				'create',
				tag,
				'--title',
				tag,
				'--notes-file',
				arquivo,
				'--verify-tag',
			]);
		} finally {
			rmSync(pasta, { recursive: true, force: true });
		}
		console.log(cor.ok(`  ok Release ${tag} criado`));
		console.log(
			cor.fraco('\n  O workflow "Publicar no npm" ja foi disparado. Acompanhe com:\n') +
				cor.fraco('    gh run list --workflow "Publicar no npm"'),
		);
	}

	console.log(cor.ok(`\nRelease ${tag} concluida.\n`));
}

// Só corre quando o arquivo é o programa. Importado (pelos testes), o módulo
// apenas expõe as funções puras.
const EXECUTADO_DIRETO =
	process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (EXECUTADO_DIRETO) {
	try {
		principal();
	} catch (erro) {
		if (erro instanceof ErroDeRelease) {
			console.error(cor.erro(`\nRelease abortada: ${erro.message}\n`));
			process.exit(1);
		}
		throw erro;
	}
}

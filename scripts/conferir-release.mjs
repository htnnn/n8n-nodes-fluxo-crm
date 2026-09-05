#!/usr/bin/env node
/**
 * Confere, antes de publicar, que as tres fontes da versao concordam:
 *
 *   - a tag do GitHub Release (`vX.Y.Z`), quando existe;
 *   - o `version` do package.json;
 *   - a secao `## [X.Y.Z]` do CHANGELOG.md.
 *
 * Um Release `v0.2.0` que publica um `package.json` em `0.1.0` e um desastre
 * silencioso: o npm aceita, o numero fica errado para sempre naquela versao, e
 * ninguem descobre ate alguem instalar. Por isso esta checagem roda antes das
 * catracas, e nao depois.
 *
 *   node scripts/conferir-release.mjs [tag]
 *
 * Sem a tag (disparo manual do workflow), confere so package.json x CHANGELOG.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { notasDaVersao, versoesRegistradas } from './changelog.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NO_ACTIONS = Boolean(process.env.GITHUB_ACTIONS);

const problemas = [];

function reprovar(mensagem) {
	problemas.push(mensagem);
	console.error(NO_ACTIONS ? `::error::${mensagem}` : `ERRO: ${mensagem}`);
}

const tag = (process.argv[2] ?? '').trim();
const pacote = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8'));
const changelog = readFileSync(join(RAIZ, 'CHANGELOG.md'), 'utf8');
const versao = pacote.version;

console.log(`package.json: ${versao}`);
console.log(`tag do release: ${tag || '(nenhuma — disparo manual)'}`);

if (tag) {
	const esperada = `v${versao}`;
	if (tag !== esperada) {
		reprovar(
			`A tag do release (${tag}) nao bate com o package.json (${esperada}). ` +
				'Publicar assim gravaria no npm uma versao diferente da que o release anuncia.',
		);
	} else {
		console.log(`OK: ${tag} == ${esperada}`);
	}
}

if (!versoesRegistradas(changelog).includes(versao)) {
	reprovar(
		`O CHANGELOG.md nao tem a secao "## [${versao}]". ` +
			'Toda versao publicada precisa estar descrita.',
	);
} else if (!notasDaVersao(changelog, versao).trim()) {
	reprovar(`A secao "## [${versao}]" do CHANGELOG.md esta vazia.`);
} else {
	console.log(`OK: CHANGELOG.md descreve a versao ${versao}`);
}

const deps = pacote.dependencies ?? {};
if (Object.keys(deps).length > 0) {
	reprovar(
		`O package.json ganhou dependencies de runtime: ${JSON.stringify(deps)}. ` +
			'O node roda dentro do processo do n8n — esse campo tem de continuar vazio.',
	);
} else {
	console.log('OK: nenhuma dependencia de runtime');
}

if (problemas.length > 0) {
	console.error(`\n${problemas.length} problema(s) impedem a publicacao.`);
	process.exit(1);
}

console.log('\nTudo confere. Pode publicar.');

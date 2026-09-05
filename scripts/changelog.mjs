/**
 * Manipulacao do CHANGELOG.md no formato Keep a Changelog.
 *
 * Fica separado de `release.mjs` de proposito: aqui nao ha efeito colateral
 * nenhum — nem disco, nem git, nem rede. Sao funcoes puras de texto para
 * texto, e por isso `test/changelog.test.mjs` consegue cobri-las sem preparar
 * um repositorio de mentira.
 *
 * O arquivo e `.mjs`, e nao `.ts`, por dois motivos que se somam: o `tsconfig`
 * do pacote so inclui `credentials`, `nodes` e `test`, e o `n8n-node build`
 * compilaria qualquer `.ts` para dentro de `dist/` — um script de release nao
 * tem por que viajar no tarball publicado.
 */

/** Titulo da secao que acumula o que ainda nao saiu numa versao. */
export const TITULO_NAO_PUBLICADO = 'Não publicado';

const RE_CABECALHO_VERSAO = /^## \[([^\]]+)\](?:\s+-\s+(\d{4}-\d{2}-\d{2}))?\s*$/;
const RE_LINK = /^\[([^\]]+)\]:\s*(\S+)\s*$/;

/**
 * Quebra o changelog em cabecalho, secoes e rodape de links.
 *
 * @param {string} texto
 */
function analisar(texto) {
	const linhas = texto.split('\n');
	const secoes = [];
	const links = [];
	let preambulo = [];
	let atual = null;

	for (const linha of linhas) {
		const cabecalho = RE_CABECALHO_VERSAO.exec(linha);
		if (cabecalho) {
			if (atual) secoes.push(atual);
			atual = { titulo: cabecalho[1], data: cabecalho[2] ?? null, linha, corpo: [] };
			continue;
		}

		const link = RE_LINK.exec(linha);
		if (link) {
			links.push({ rotulo: link[1], destino: link[2] });
			continue;
		}

		if (atual) atual.corpo.push(linha);
		else preambulo.push(linha);
	}

	if (atual) secoes.push(atual);

	return { preambulo, secoes, links };
}

/** Remove linhas em branco das pontas, preservando o miolo. */
function aparar(linhas) {
	const copia = [...linhas];
	while (copia.length && copia[0].trim() === '') copia.shift();
	while (copia.length && copia[copia.length - 1].trim() === '') copia.pop();
	return copia;
}

/**
 * Corpo da secao `## [Não publicado]`, sem o cabecalho e sem linhas em branco
 * nas pontas. String vazia quando nao ha nada acumulado.
 *
 * @param {string} texto
 * @returns {string}
 */
export function corpoNaoPublicado(texto) {
	const { secoes } = analisar(texto);
	const secao = secoes.find((s) => s.titulo === TITULO_NAO_PUBLICADO);
	if (!secao) {
		throw new Error(`O CHANGELOG.md nao tem a secao "## [${TITULO_NAO_PUBLICADO}]".`);
	}
	return aparar(secao.corpo).join('\n');
}

/**
 * Corpo de uma versao ja registrada — e o texto que vira as notas do GitHub
 * Release.
 *
 * @param {string} texto
 * @param {string} versao
 * @returns {string}
 */
export function notasDaVersao(texto, versao) {
	const { secoes } = analisar(texto);
	const secao = secoes.find((s) => s.titulo === versao);
	if (!secao) {
		throw new Error(`O CHANGELOG.md nao tem a secao "## [${versao}]".`);
	}
	return aparar(secao.corpo).join('\n');
}

/**
 * Versoes ja registradas, da mais recente para a mais antiga.
 *
 * @param {string} texto
 * @returns {string[]}
 */
export function versoesRegistradas(texto) {
	return analisar(texto)
		.secoes.filter((s) => s.titulo !== TITULO_NAO_PUBLICADO)
		.map((s) => s.titulo);
}

/**
 * Base do repositorio, deduzida do proprio rodape de links.
 *
 * Deduzir em vez de receber por parametro e deliberado: o rodape ja precisa
 * apontar para o repositorio certo para que os links de comparacao funcionem,
 * entao usar a mesma fonte impede que o script escreva um link para um
 * repositorio e o leitor clique em outro.
 *
 * @param {{rotulo: string, destino: string}[]} links
 * @returns {string}
 */
function baseDoRepositorio(links) {
	for (const { destino } of links) {
		const corte = destino.indexOf('/compare/');
		if (corte !== -1) return destino.slice(0, corte);
		const corteTag = destino.indexOf('/releases/tag/');
		if (corteTag !== -1) return destino.slice(0, corteTag);
	}
	throw new Error(
		'Nao consegui deduzir a URL do repositorio pelo rodape de links do CHANGELOG.md.',
	);
}

/**
 * Move o conteudo de `[Não publicado]` para uma secao da versao nova, com a
 * data, e refaz os links de comparacao do rodape.
 *
 * @param {string} texto
 * @param {string} versao   versao nova, sem o `v` (ex.: `0.2.0`)
 * @param {string} data     data ISO curta (`YYYY-MM-DD`)
 * @returns {string}
 */
export function promoverNaoPublicado(texto, versao, data) {
	if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(versao)) {
		throw new Error(`Versao invalida para o CHANGELOG: "${versao}".`);
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
		throw new Error(`Data invalida para o CHANGELOG: "${data}".`);
	}

	const { preambulo, secoes, links } = analisar(texto);

	const indiceNaoPublicado = secoes.findIndex((s) => s.titulo === TITULO_NAO_PUBLICADO);
	if (indiceNaoPublicado === -1) {
		throw new Error(`O CHANGELOG.md nao tem a secao "## [${TITULO_NAO_PUBLICADO}]".`);
	}
	if (secoes.some((s) => s.titulo === versao)) {
		throw new Error(`O CHANGELOG.md ja tem uma secao "## [${versao}]".`);
	}

	const naoPublicado = secoes[indiceNaoPublicado];
	const corpo = aparar(naoPublicado.corpo);
	if (corpo.length === 0) {
		throw new Error(
			`A secao "## [${TITULO_NAO_PUBLICADO}]" esta vazia — nao ha o que publicar em ${versao}.`,
		);
	}

	const base = baseDoRepositorio(links);
	const anterior = secoes[indiceNaoPublicado + 1]?.titulo ?? null;

	const novasSecoes = [
		{ titulo: TITULO_NAO_PUBLICADO, data: null, corpo: [] },
		{ titulo: versao, data, corpo },
		...secoes.slice(indiceNaoPublicado + 1),
	];

	const novosLinks = [
		{ rotulo: TITULO_NAO_PUBLICADO, destino: `${base}/compare/v${versao}...HEAD` },
		{
			rotulo: versao,
			destino: anterior
				? `${base}/compare/v${anterior}...v${versao}`
				: `${base}/releases/tag/v${versao}`,
		},
		...links.filter((l) => l.rotulo !== TITULO_NAO_PUBLICADO && l.rotulo !== versao),
	];

	const partes = [aparar(preambulo).join('\n')];

	for (const secao of novasSecoes) {
		const cabecalho = secao.data ? `## [${secao.titulo}] - ${secao.data}` : `## [${secao.titulo}]`;
		const corpoSecao = aparar(secao.corpo);
		partes.push(corpoSecao.length ? `${cabecalho}\n\n${corpoSecao.join('\n')}` : cabecalho);
	}

	partes.push(novosLinks.map((l) => `[${l.rotulo}]: ${l.destino}`).join('\n'));

	return `${partes.join('\n\n')}\n`;
}

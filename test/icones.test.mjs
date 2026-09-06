import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * Os seis icones do pacote (dois por no, mais os da credencial) sao o ARQUIVO
 * OFICIAL da marca, exportado do Illustrator, copiado sem tocar na geometria
 * dos caminhos nem nas cores. Ja foram duas coisas piores: um PNG de 192x192
 * embutido em base64 dentro de um `<image>` (aquele bitmap nao tinha um unico
 * pixel transparente e 89% dele era branco opaco, entao o n8n desenhava um
 * quadrado BRANCO com a marca pequena no meio) e, depois, uma RECONSTRUCAO
 * feita a partir de um componente React do monorepo — vetorial e sem fundo,
 * mas um desenho diferente do oficial.
 *
 * O arquivo e `.mjs` pelo mesmo motivo do `changelog.test.mjs`: o alvo nao e
 * TypeScript, e assim `import.meta.url` resolve o caminho sem depender do
 * diretorio de onde o vitest foi chamado.
 *
 * O que estes testes travam:
 *  (a) nenhum bitmap volta — sem `base64`, sem `<image>`, sem `<rect>` de fundo,
 *      sem nenhuma cor branca no arquivo;
 *  (b) o `<svg>` nao fixa `width`/`height`, para escalar em qualquer tamanho;
 *  (c) a marca ENCOSTA nas quatro bordas do viewBox (folga <= 2%), calculado a
 *      partir da geometria do proprio arquivo — bezier com extremos por
 *      derivada, traco dilatado por metade do `stroke-width` e circulo pelo
 *      raio. E o que prova "a marca ocupa o quadro" sem rasterizar nada;
 *  (d) o viewBox e quadrado, para a marca nunca ser distorcida;
 *  (e) nada depende de CSS nem de nome generico: o Illustrator batiza as
 *      classes de `.st0`..`.st4` e os gradientes de `Gradiente_sem_nome*`,
 *      nomes que colidiriam com os de qualquer outro SVG inlinado na mesma
 *      pagina;
 *  (f) os seis arquivos sao identicos byte a byte.
 */

const ICONES = [
	'credentials/fluxoCrm.svg',
	'credentials/fluxoCrm.dark.svg',
	'nodes/FluxoCrm/fluxoCrm.svg',
	'nodes/FluxoCrm/fluxoCrm.dark.svg',
	'nodes/FluxoCrmTrigger/fluxoCrmTrigger.svg',
	'nodes/FluxoCrmTrigger/fluxoCrmTrigger.dark.svg',
];

/** Folga maxima tolerada entre o desenho e cada borda do viewBox. */
const FOLGA_MAXIMA = 0.02;

const conteudo = new Map(
	ICONES.map((rel) => [rel, readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')]),
);

/** Atributo de uma tag, ou `undefined` quando ausente. */
function atributo(tag, nome) {
	const achado = tag.match(new RegExp(`\\b${nome}\\s*=\\s*"([^"]*)"`));
	return achado ? achado[1] : undefined;
}

/** Extremos de um cubico em UM eixo: os pontos onde a derivada zera, mais as pontas. */
function extremosDoCubico(p0, p1, p2, p3) {
	const valores = [p0, p3];
	const a = -p0 + 3 * p1 - 3 * p2 + p3;
	const b = 2 * (p0 - 2 * p1 + p2);
	const c = p1 - p0; // a derivada e 3 * (a t^2 + b t + c)
	const avaliar = (t) => {
		if (t <= 0 || t >= 1) return;
		const u = 1 - t;
		valores.push(u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3);
	};
	if (Math.abs(a) < 1e-12) {
		if (Math.abs(b) > 1e-12) avaliar(-c / b);
	} else {
		const delta = b * b - 4 * a * c;
		if (delta >= 0) {
			const raiz = Math.sqrt(delta);
			avaliar((-b + raiz) / (2 * a));
			avaliar((-b - raiz) / (2 * a));
		}
	}
	return { min: Math.min(...valores), max: Math.max(...valores) };
}

/**
 * Caixa envolvente da geometria de um `d`. Cobre M/L/H/V/C/S/Z nas duas formas,
 * absoluta e relativa: o export do Illustrator e quase todo relativo (`c`, `s`,
 * `h`, `l`) porque isso encurta o arquivo, e usa `s` — o cubico "suave", cujo
 * primeiro ponto de controle e a reflexao do segundo ponto de controle da curva
 * anterior em torno do ponto atual.
 */
function caixaDoCaminho(d) {
	const partes = d.match(/[MLHVCSZmlhvcsz]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
	let i = 0;
	let comando = null;
	let x = 0;
	let y = 0;
	let ix = 0;
	let iy = 0;
	// Segundo ponto de controle da curva anterior, em coordenada absoluta, ou
	// `null` quando o comando anterior nao foi uma curva — nesse caso o `S`
	// reflete o proprio ponto atual, como manda a especificacao.
	let controleX = null;
	let controleY = null;
	const caixa = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
	const marcar = (px, py) => {
		caixa.minX = Math.min(caixa.minX, px);
		caixa.maxX = Math.max(caixa.maxX, px);
		caixa.minY = Math.min(caixa.minY, py);
		caixa.maxY = Math.max(caixa.maxY, py);
	};
	const numero = () => Number.parseFloat(partes[i++]);
	while (i < partes.length) {
		// `^[A-Za-z]$` e nao `[A-Za-z]`: um numero em notacao cientifica (`1e-5`)
		// vira um token unico e tem letra no meio — testar "contem letra" o
		// confundiria com um comando.
		if (/^[A-Za-z]$/.test(partes[i])) comando = partes[i++];
		if (comando === null) {
			throw new Error(`coordenada sem comando no caminho, perto de "${partes[i]}"`);
		}
		const relativo = comando === comando.toLowerCase();
		// Origem de cada par de coordenadas: o ponto atual no modo relativo, a
		// origem do viewBox no absoluto. Recalculada a cada repeticao, porque um
		// mesmo `c` pode trazer varias curvas encadeadas.
		const ox = relativo ? x : 0;
		const oy = relativo ? y : 0;
		const letra = comando.toUpperCase();
		if (letra === 'M') {
			x = ox + numero();
			y = oy + numero();
			ix = x;
			iy = y;
			marcar(x, y);
			controleX = null;
			controleY = null;
			comando = relativo ? 'l' : 'L'; // par extra depois de um M implica L
		} else if (letra === 'L') {
			x = ox + numero();
			y = oy + numero();
			marcar(x, y);
			controleX = null;
			controleY = null;
		} else if (letra === 'H') {
			x = ox + numero();
			marcar(x, y);
			controleX = null;
			controleY = null;
		} else if (letra === 'V') {
			y = oy + numero();
			marcar(x, y);
			controleX = null;
			controleY = null;
		} else if (letra === 'C' || letra === 'S') {
			let x1;
			let y1;
			if (letra === 'C') {
				x1 = ox + numero();
				y1 = oy + numero();
			} else {
				x1 = controleX === null ? x : 2 * x - controleX;
				y1 = controleY === null ? y : 2 * y - controleY;
			}
			const x2 = ox + numero();
			const y2 = oy + numero();
			const x3 = ox + numero();
			const y3 = oy + numero();
			const ex = extremosDoCubico(x, x1, x2, x3);
			const ey = extremosDoCubico(y, y1, y2, y3);
			marcar(ex.min, ey.min);
			marcar(ex.max, ey.max);
			controleX = x2;
			controleY = y2;
			x = x3;
			y = y3;
		} else if (letra === 'Z') {
			x = ix;
			y = iy;
			controleX = null;
			controleY = null;
			comando = null;
		} else {
			throw new Error(`comando de caminho nao suportado por este teste: ${comando}`);
		}
	}
	return caixa;
}

/**
 * Caixa envolvente do que o arquivo PINTA. Um traco com `stroke-linecap="round"`
 * e a soma de Minkowski do caminho com um disco de raio `stroke-width / 2`, entao
 * o maximo em cada eixo e o maximo da geometria mais esse raio — exato, nao
 * estimativa. O circulo entra pelo raio.
 */
function caixaPintada(svg) {
	const caixa = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
	const somar = (outra) => {
		caixa.minX = Math.min(caixa.minX, outra.minX);
		caixa.maxX = Math.max(caixa.maxX, outra.maxX);
		caixa.minY = Math.min(caixa.minY, outra.minY);
		caixa.maxY = Math.max(caixa.maxY, outra.maxY);
	};
	for (const tag of svg.match(/<path\b[^>]*>/g) ?? []) {
		const d = atributo(tag, 'd');
		expect(d, `<path> sem "d" em ${tag}`).toBeTruthy();
		const bruta = caixaDoCaminho(d);
		const metade = atributo(tag, 'stroke')
			? Number.parseFloat(atributo(tag, 'stroke-width') ?? '1') / 2
			: 0;
		somar({
			minX: bruta.minX - metade,
			maxX: bruta.maxX + metade,
			minY: bruta.minY - metade,
			maxY: bruta.maxY + metade,
		});
	}
	for (const tag of svg.match(/<circle\b[^>]*>/g) ?? []) {
		const cx = Number.parseFloat(atributo(tag, 'cx'));
		const cy = Number.parseFloat(atributo(tag, 'cy'));
		const r = Number.parseFloat(atributo(tag, 'r'));
		somar({ minX: cx - r, maxX: cx + r, minY: cy - r, maxY: cy + r });
	}
	return caixa;
}

describe('icones do pacote', () => {
	it.each(ICONES)('%s nao embute bitmap nem fundo', (rel) => {
		const svg = conteudo.get(rel);
		expect(svg).not.toMatch(/base64/i);
		expect(svg).not.toMatch(/<image\b/i);
		expect(svg).not.toMatch(/data:image/i);
		expect(svg).not.toMatch(/<rect\b/i);
		// A marca nao tem branco em lugar nenhum: qualquer branco no arquivo so
		// pode ser fundo, e fundo e exatamente o defeito que este teste barra.
		expect(svg).not.toMatch(/#fff\b|#ffffff\b|\bwhite\b|rgb\(\s*255\s*,\s*255\s*,\s*255/i);
	});

	it.each(ICONES)('%s nao depende de CSS nem de nome generico', (rel) => {
		const svg = conteudo.get(rel);
		// O export do Illustrator pinta por classe (`.st0`..`.st4`) declarada num
		// `<style>`. Inlinado numa pagina, esse bloco vaza para o documento
		// inteiro e dois SVGs quaisquer disputam os mesmos cinco nomes — por isso
		// aqui cada elemento carrega o proprio `fill`.
		expect(svg).not.toMatch(/<style\b/i);
		expect(svg).not.toMatch(/\bclass\s*=/i);
		// Mesma colisao pelo outro lado: `url(#Gradiente_sem_nome)` resolve para o
		// PRIMEIRO id daquele nome no documento, que pode ser o de outro SVG.
		const ids = [...svg.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1]);
		expect(ids.length).toBeGreaterThan(0);
		for (const id of ids) expect(id).toMatch(/^fluxo/);
		// Todo `url(#...)` aponta para um id que existe no proprio arquivo.
		for (const [, alvo] of svg.matchAll(/url\(#([^)]*)\)/g)) expect(ids).toContain(alvo);
	});

	it.each(ICONES)('%s escala em qualquer tamanho', (rel) => {
		const abertura = conteudo.get(rel).match(/<svg\b[^>]*>/)[0];
		expect(atributo(abertura, 'viewBox')).toBeTruthy();
		expect(atributo(abertura, 'width')).toBeUndefined();
		expect(atributo(abertura, 'height')).toBeUndefined();
	});

	it.each(ICONES)('%s tem a marca encostada nas bordas de um viewBox quadrado', (rel) => {
		const svg = conteudo.get(rel);
		const abertura = svg.match(/<svg\b[^>]*>/)[0];
		const [vx, vy, vLargura, vAltura] = atributo(abertura, 'viewBox')
			.trim()
			.split(/[\s,]+/)
			.map(Number);

		// Quadrado: com `preserveAspectRatio` no padrao, um viewBox quadrado num
		// quadro quadrado nunca distorce nem sobra faixa lateral.
		expect(vLargura).toBe(vAltura);

		const caixa = caixaPintada(svg);
		const folgas = {
			esquerda: (caixa.minX - vx) / vLargura,
			direita: (vx + vLargura - caixa.maxX) / vLargura,
			topo: (caixa.minY - vy) / vAltura,
			base: (vy + vAltura - caixa.maxY) / vAltura,
		};
		for (const [lado, folga] of Object.entries(folgas)) {
			// Negativo seria desenho cortado pela borda; acima do teto seria a
			// marca boiando pequena dentro do quadro, que e o defeito corrigido.
			const rotulo = `folga ${lado} = ${(folga * 100).toFixed(3)}%`;
			expect(folga, rotulo).toBeGreaterThanOrEqual(0);
			expect(folga, rotulo).toBeLessThanOrEqual(FOLGA_MAXIMA);
		}
	});

	it('entrega os seis arquivos identicos', () => {
		const distintos = new Set(conteudo.values());
		expect(distintos.size).toBe(1);
	});
});

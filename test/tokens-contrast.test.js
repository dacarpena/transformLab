// @ts-check

/**
 * Contraste de la paleta (CLAUDE.md F7, decisión D7a).
 *
 * Los ratios se leen del `tokens.css` REAL, no de una copia: si alguien
 * oscurece un token, este test lo detiene. Es la red que faltaba en el
 * legacy, donde `--text-muted` llevaba 3,78:1 sin que nada avisara.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../css/tokens.css', import.meta.url), 'utf8');

/**
 * Lee un token de color del CSS.
 * @param {string} name
 * @returns {string}
 */
function token(name) {
    const match = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
    assert.ok(match, `token --${name} no encontrado o no es un hex de 6 dígitos`);
    return /** @type {RegExpMatchArray} */ (match)[1];
}

/** @param {string} h @returns {number[]} */
function channels(h) {
    const clean = h.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
}

/** @param {number} c @returns {number} */
function linear(c) {
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Luminancia relativa WCAG. @param {string} hex @returns {number} */
function luminance(hex) {
    const [r, g, b] = channels(hex).map(linear);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ratio de contraste WCAG. @param {string} a @param {string} b @returns {number} */
function contrast(a, b) {
    const l1 = luminance(a);
    const l2 = luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const AA_TEXT = 4.5;
const AA_NON_TEXT = 3; // WCAG 1.4.11

test('todo texto sobre toda superficie alcanza AA (4,5:1)', () => {
    const surfaces = ['color-bg', 'color-surface', 'color-surface-2'];
    const texts = ['color-text', 'color-text-secondary', 'color-text-muted'];
    for (const s of surfaces) {
        for (const t of texts) {
            const ratio = contrast(token(t), token(s));
            assert.ok(ratio >= AA_TEXT, `--${t} sobre --${s} = ${ratio.toFixed(2)}:1 (mínimo ${AA_TEXT})`);
        }
    }
});

test('los colores semánticos y de marca alcanzan AA como texto', () => {
    for (const c of ['color-accent', 'color-success', 'color-warning', 'color-danger']) {
        for (const s of ['color-bg', 'color-surface', 'color-surface-2']) {
            const ratio = contrast(token(c), token(s));
            assert.ok(ratio >= AA_TEXT, `--${c} sobre --${s} = ${ratio.toFixed(2)}:1`);
        }
    }
});

test('el texto del botón primario contrasta en reposo y en hover', () => {
    for (const bg of ['color-accent', 'color-accent-hover']) {
        const ratio = contrast(token('color-on-accent'), token(bg));
        assert.ok(ratio >= AA_TEXT, `--color-on-accent sobre --${bg} = ${ratio.toFixed(2)}:1`);
    }
});

test('el borde de los controles alcanza 3:1 (WCAG 1.4.11)', () => {
    for (const s of ['color-bg', 'color-surface', 'color-surface-2']) {
        const ratio = contrast(token('color-border-control'), token(s));
        assert.ok(ratio >= AA_NON_TEXT, `--color-border-control sobre --${s} = ${ratio.toFixed(2)}:1`);
    }
});

test('el anillo de foco es visible sobre cualquier superficie (3:1)', () => {
    for (const s of ['color-bg', 'color-surface', 'color-surface-2']) {
        const ratio = contrast(token('color-accent'), token(s));
        assert.ok(ratio >= AA_NON_TEXT, `foco sobre --${s} = ${ratio.toFixed(2)}:1`);
    }
});

test('las insignias de fase contrastan con su texto oscuro y sobre la superficie', () => {
    const phases = ['adaptation', 'recomposition', 'cut', 'bulk', 'transition', 'maintenance'];
    for (const phase of phases) {
        const color = token(`color-phase-${phase}`);
        const asBadge = contrast(token('color-on-accent'), color);
        assert.ok(asBadge >= AA_TEXT, `insignia ${phase}: texto sobre color = ${asBadge.toFixed(2)}:1`);
        const asText = contrast(color, token('color-surface'));
        assert.ok(asText >= AA_TEXT, `leyenda ${phase} sobre surface = ${asText.toFixed(2)}:1`);
    }
});

test('el tema declara color-scheme: dark (controles nativos coherentes)', () => {
    assert.match(css, /color-scheme:\s*dark/);
});

test('la corrección de H-047 se sostiene: el muted del legacy no volvería a pasar', () => {
    const legacyMuted = '#6b6b7b';
    assert.ok(contrast(legacyMuted, token('color-bg')) < AA_TEXT, 'el valor del legacy debería fallar');
    assert.ok(contrast(token('color-text-muted'), token('color-bg')) >= AA_TEXT, 'el de v5 debe pasar');
});

/* ---------------------------------------------------------------------- *
 * La paleta de series (E13-3)
 * ---------------------------------------------------------------------- */

/**
 * sRGB → CIE Lab (D65). Hace falta para medir distancia PERCEPTUAL: dos
 * colores pueden tener el mismo contraste WCAG contra el fondo y ser
 * indistinguibles ENTRE SÍ, que es justo el fallo que arruina una gráfica de
 * cuatro líneas.
 * @param {string} hex @returns {number[]}
 */
function lab(hex) {
    const [r, g, b] = channels(hex).map(linear);
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
    const Y = (0.2126 * r + 0.7152 * g + 0.0722 * b);
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (/** @type {number} */ t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
    const [fx, fy, fz] = [X, Y, Z].map(f);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** @param {string} a @param {string} b @returns {number} */
function deltaE(a, b) {
    const A = lab(a);
    const B = lab(b);
    return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

/**
 * Simulación de las tres dicromacias (matrices de Viénot-Brettel-Mollon sobre
 * RGB lineal). Sin esto, «los colores se distinguen» solo significa «se
 * distinguen para quien escribió el test».
 * @type {Record<string, number[][]>}
 */
const DICROMACIAS = {
    protanopia: [[0.1121, 0.8853, -0.0005], [0.1127, 0.8897, -0.0001], [0.0045, 0.0085, 1.0]],
    deuteranopia: [[0.2920, 0.7054, -0.0003], [0.2934, 0.7089, 0.0], [-0.0209, 0.0270, 0.9942]],
    tritanopia: [[1.0175, 0.1130, -0.1305], [0.0113, 0.9856, 0.0027], [0.0754, -0.7724, 1.6969]]
};

/** @param {string} hex @param {number[][]} m @returns {string} */
function simulate(hex, m) {
    const v = channels(hex);
    const out = m.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
    return '#' + out
        .map((c) => Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, '0'))
        .join('');
}

const SERIES_TOKENS = ['color-series-1', 'color-series-2', 'color-series-3', 'color-series-4'];

/** Umbrales MEDIDOS, no aspiracionales: ver el comentario de `tokens.css`. */
const SERIES_MIN_CONTRAST = 4.5;
const SERIES_MIN_DELTA_E = 40;
const SERIES_MIN_DELTA_E_SEMANTIC = 32;

test('las cuatro series alcanzan AA sobre las tres superficies', () => {
    for (const c of SERIES_TOKENS) {
        for (const s of ['color-bg', 'color-surface', 'color-surface-2']) {
            const ratio = contrast(token(c), token(s));
            assert.ok(ratio >= SERIES_MIN_CONTRAST, `--${c} sobre --${s} = ${ratio.toFixed(2)}:1`);
        }
    }
});

test('las cuatro series se distinguen entre sí TAMBIÉN con daltonismo', () => {
    // El caso que este test existe para impedir: una paleta elegida por buen
    // gusto que bajaba a ΔE 25 bajo deuteranopía — dos series indistinguibles
    // para el 6 % de los hombres. La actual mide 40,1 en el peor par.
    const vistas = { normal: null, ...DICROMACIAS };
    for (const [nombre, matriz] of Object.entries(vistas)) {
        for (let i = 0; i < SERIES_TOKENS.length; i++) {
            for (let j = i + 1; j < SERIES_TOKENS.length; j++) {
                const a = matriz ? simulate(token(SERIES_TOKENS[i]), matriz) : token(SERIES_TOKENS[i]);
                const b = matriz ? simulate(token(SERIES_TOKENS[j]), matriz) : token(SERIES_TOKENS[j]);
                const d = deltaE(a, b);
                assert.ok(d >= SERIES_MIN_DELTA_E,
                    `${SERIES_TOKENS[i]} ~ ${SERIES_TOKENS[j]} bajo ${nombre}: ΔE ${d.toFixed(1)} (mínimo ${SERIES_MIN_DELTA_E})`);
            }
        }
    }
});

test('ninguna serie se confunde con un color que YA significa algo', () => {
    // Una serie del color del acento se lee como «pulsable»; una verde, como
    // «va bien». El color de una serie no significa nada: solo desempata.
    const semanticos = ['color-text', 'color-accent', 'color-success', 'color-warning', 'color-danger'];
    for (const c of SERIES_TOKENS) {
        for (const s of semanticos) {
            const d = deltaE(token(c), token(s));
            assert.ok(d >= SERIES_MIN_DELTA_E_SEMANTIC,
                `--${c} se parece demasiado a --${s}: ΔE ${d.toFixed(1)} (mínimo ${SERIES_MIN_DELTA_E_SEMANTIC})`);
        }
    }
});

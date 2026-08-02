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

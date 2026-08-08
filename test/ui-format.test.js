// @ts-check

/**
 * Formateo de cifras (M7-4, reescrito en el cierre de la v2).
 *
 * Lo que este fichero fija ahora, y antes no: **las cifras se escriben en el
 * idioma del usuario**. Hasta la v2 todo el módulo usaba `toFixed`, que siempre
 * pone punto decimal, así que la app entera decía «82.8 kg» a un usuario español
 * donde se escribe «82,8 kg». No era el descuido de una vista: era transversal a
 * las doce.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { num, int, signed, bytes, resetFormatters } from '../src/ui/format.js';
import { setLocale } from '../src/i18n/i18n.js';

beforeEach(() => {
    setLocale('es');
    resetFormatters();
});

// ============================================================
// El idioma manda
// ============================================================

test('en español la coma es el separador decimal', () => {
    setLocale('es');
    assert.equal(num(81.24), '81,2');
    assert.equal(num(81.2432, 2), '81,24');
    assert.equal(num(0), '0,0');
    assert.equal(num(-1.55), '-1,6');
});

test('en inglés el punto, y la app no se queda en el idioma con el que arrancó', () => {
    setLocale('es');
    assert.equal(num(81.24), '81,2');
    // El usuario cambia de idioma en caliente desde Ajustes: un solo formateador
    // cacheado dejaría la app en el idioma del arranque.
    setLocale('en');
    assert.equal(num(81.24), '81.2');
    setLocale('es');
    assert.equal(num(81.24), '81,2');
});

test('el separador de millares sigue al idioma, con la regla de las cuatro cifras', () => {
    setLocale('es');
    // El español NO agrupa los números de cuatro cifras (norma de la RAE), y a
    // partir de cinco sí. Es exactamente lo que hace `Intl`, y se agradece: «2437
    // kcal» se lee mejor que «2.437 kcal».
    assert.equal(int(2437), '2437');
    assert.equal(int(13000), '13.000');
    setLocale('en');
    // El inglés agrupa desde cuatro cifras.
    assert.equal(int(2437), '2,437');
    assert.equal(int(13000), '13,000');
});

test('signed usa el guion normal, no el menos tipográfico', () => {
    // `signDisplay: 'always'` de Intl escribe «−» (U+2212) en algunos idiomas, y
    // el resto de la app usa el guion de toda la vida. Dos menos distintos en la
    // misma pantalla se ven.
    setLocale('es');
    assert.equal(signed(0.4), '+0,4');
    assert.equal(signed(-0.4), '-0,4');
    assert.ok(!signed(-0.4).includes('−'));
    assert.equal(signed(0), '+0,0');
});

// ============================================================
// Lo que ya estaba, y sigue
// ============================================================

test('int redondea a entero: los gramos y las kcal no tienen decimales', () => {
    assert.equal(int(2426.4), '2426');
    assert.equal(int(2426.6), '2427');
    assert.equal(int(0), '0');
    // Y NO es lo mismo que num(): confundirlas es lo que pasaba al copiar una
    // vista como plantilla, porque las dos se llamaban `num`.
    assert.notEqual(int(2426.4), num(2426.4));
});

test('REGRESIÓN: por debajo de 1 KB se leen los bytes, no «0 KB»', () => {
    // `photos.js` no tenía la rama que sí tenía `settings.js`: una foto de 500 B
    // se leía «0 KB» en una pantalla y «500 B» en la otra.
    assert.equal(bytes(500), '500 B');
    assert.equal(bytes(0), '0 B');
    assert.equal(bytes(1023), '1023 B');
});

test('bytes escala a KB y MB con la precisión de cada tramo', () => {
    assert.equal(bytes(1024), '1 KB');
    assert.equal(bytes(1536), '2 KB');
    assert.equal(bytes(1024 * 1024), '1,0 MB');
    assert.equal(bytes(2.5 * 1024 * 1024), '2,5 MB');
});

test('nada que no sea un número finito llega a la pantalla como «NaN»', () => {
    for (const malo of [Number.NaN, Infinity, null, undefined, '81', {}]) {
        assert.equal(num(/** @type {*} */ (malo)), '—');
        assert.equal(int(/** @type {*} */ (malo)), '—');
        assert.equal(signed(/** @type {*} */ (malo)), '—');
        assert.equal(bytes(/** @type {*} */ (malo)), '—');
    }
    assert.equal(bytes(-1), '—');
});

// ============================================================
// Que no vuelva a colarse
// ============================================================

/** @param {string} dir @returns {string[]} */
function jsFilesUnder(dir) {
    /** @type {string[]} */ const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        // Duplicados de iCloud («nombre 2.js»): no son fuente.
        if (/ \d+\.(js|css|json)$/.test(entry.name)) continue;
        const p = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...jsFilesUnder(p));
        else if (entry.name.endsWith('.js')) out.push(p);
    }
    return out;
}

test('nadie usa `toFixed` en la interfaz fuera de format.js', () => {
    // Es la red que impide que el arreglo se deshaga vista a vista: un `toFixed`
    // nuevo volvería a escribir «82.8» en español sin que nadie lo note, porque
    // en inglés se ve bien y los tests en inglés pasarían.
    //
    // Única excepción: la geometría de un SVG. Un atributo `d` NO es texto que
    // nadie lea, y el punto decimal es obligatorio ahí — una coma partiría el
    // camino en dos coordenadas.
    const EXCEPCIONES = new Set(['src/ui/format.js', 'src/ui/muscle-grid.js']);
    /** @type {string[]} */ const culpables = [];

    for (const file of jsFilesUnder('src/ui')) {
        const rel = file.split('/').slice(-3).join('/').replace(/^.*?src\//, 'src/');
        const normalizado = file.startsWith('src/') ? file : rel;
        if (EXCEPCIONES.has(normalizado)) continue;
        const source = readFileSync(file, 'utf8');
        if (source.includes('.toFixed(')) culpables.push(normalizado);
    }
    assert.deepEqual(culpables, [], `usan toFixed: ${culpables.join(', ')}`);
});

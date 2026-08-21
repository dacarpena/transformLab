// @ts-check

/**
 * Las dos direcciones del contrato de i18n (E15-6).
 *
 * `test/i18n.test.js` ya comprueba que `es` y `en` tienen las MISMAS claves.
 * Eso no dice nada sobre si esas claves son las que el código pide, y por ese
 * hueco se coló `today.createPlan`: usada en dos vistas, ausente de los dos
 * diccionarios, y el botón principal del estado vacío mostraba la clave cruda
 * delante del usuario. Los 833 tests estaban en verde.
 *
 * Aquí se cierran las dos direcciones:
 *
 * 1. **Toda clave que el código referencia existe** en los dos idiomas.
 * 2. **Toda clave del diccionario está referenciada**, literalmente o por un
 *    prefijo dinámico vivo.
 *
 * Los prefijos se DERIVAN del fuente, no se listan a mano. Un catálogo escrito
 * a mano se pudre en cuanto alguien añade un `t(\`x.${y}\`)`, y entonces este
 * test empieza a acusar claves perfectamente usadas — que es la forma más
 * rápida de que alguien lo desactive.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isICloudDuplicate } from './helpers/tree.js';
import { es } from '../src/i18n/es.js';
import { en } from '../src/i18n/en.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Todo el fuente de `src/` en una sola cadena, SIN los diccionarios (donde toda
 * clave aparece por definición) y sin sus propios comentarios.
 */
const FUENTE = (() => {
    /** @type {string[]} */ const trozos = [];
    const walk = (/** @type {string} */ current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (isICloudDuplicate(entry.name)) continue;
            const full = join(current, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.name.endsWith('.js')) continue;
            if (full.includes(join('src', 'i18n'))) continue;
            trozos.push(readFileSync(full, 'utf8'));
        }
    };
    walk(join(ROOT, 'src'));
    return trozos.join('\n');
})();

/**
 * Prefijos de clave construidos en tiempo de ejecución, derivados del fuente.
 * Dos formas, las dos vivas en el repo:
 *   t(`analysis.preset.${p.id}`)      → plantilla
 *   t('phase.' + point.phaseType)     → concatenación
 * Se admite terminar en `.`, `-` o `_`: hay ids que se componen con guion bajo
 * (`series.meas_${clave}`), no solo con punto.
 */
const PREFIJOS = [...new Set([
    ...[...FUENTE.matchAll(/`([A-Za-z][\w.]*[.\-_])\$\{/g)].map((m) => m[1]),
    ...[...FUENTE.matchAll(/\b(?:t|hasKey)\(\s*'([A-Za-z][\w.]*[.\-_])'\s*\+/g)].map((m) => m[1])
])];

/**
 * Claves que solo usan los TESTS, con su motivo. Cada entrada es una excepción
 * consciente, no una lista para ir engordando cuando el test moleste.
 */
const SOLO_TESTS = new Map([
    ['test.decimal', 'plantilla mínima para comprobar el separador decimal por idioma (test/i18n.test.js)']
]);

/** @param {string} s */
const escapa = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * ¿Aparece la clave en el fuente como literal entrecomillado?
 *
 * Se busca clave a clave en vez de extraer todos los literales con una regex de
 * comillas: emparejar comillas con una expresión regular se desincroniza con el
 * primer apóstrofo de un comentario en español, y eso hacía que `foods.searchHint`
 * —usada en `views/foods.js`— saliera como huérfana.
 * @param {string} key
 */
function referenciada(key) {
    return new RegExp(`['"\`]${escapa(key)}['"\`]`).test(FUENTE);
}

test('toda clave que el código pide existe en los DOS diccionarios', () => {
    /** @type {Set<string>} */ const pedidas = new Set();
    const formas = [
        /\b(?:t|hasKey)\(\s*'([^']+)'/g,          // t('x') · hasKey('x')
        /\b\w*[Kk]ey:\s*'([^']+)'/g,              // labelKey: 'x' · titleKey: 'x'
        /\btoast\.(?:success|error|show|info)\(\s*'([^']+)'/g
    ];
    for (const forma of formas) {
        for (const m of FUENTE.matchAll(forma)) pedidas.add(m[1]);
    }

    const faltan = [...pedidas]
        // Toda clave de i18n lleva punto. Sin este filtro entra `key: 'seed'`
        // del registro de siembra de `foods-db.js`, que no es una clave de i18n.
        .filter((k) => k.includes('.'))
        // Un literal que TERMINA en punto no es una clave: es el prefijo de una
        // concatenación, `t('phase.' + tipo)`.
        .filter((k) => !k.endsWith('.'))
        .filter((k) => !(k in es) || !(k in en))
        .sort();

    assert.deepEqual(faltan, [],
        `claves usadas que faltan en algún diccionario:\n  ${faltan.join('\n  ')}`);
});

test('toda clave del diccionario la usa alguien', () => {
    const huerfanas = Object.keys(es)
        .filter((k) => !SOLO_TESTS.has(k))
        .filter((k) => !referenciada(k))
        .filter((k) => !PREFIJOS.some((p) => k.startsWith(p)))
        .sort();

    assert.deepEqual(huerfanas, [],
        'claves que ya no usa nadie — o se cablean o se borran, pero no se quedan:\n  '
        + huerfanas.join('\n  '));
});

test('las excepciones de SOLO_TESTS siguen siendo ciertas', () => {
    // Una excepción que deja de serlo es peor que no tenerla: tapa un hueco
    // real. Si la clave vuelve al producto, sale de aquí.
    for (const [key, motivo] of SOLO_TESTS) {
        assert.ok(key in es && key in en, `${key} está en SOLO_TESTS pero no existe`);
        assert.ok(!referenciada(key),
            `${key} ya se usa en src/: sobra de SOLO_TESTS (${motivo})`);
    }
});

test('los prefijos dinámicos se derivan del fuente, y hay unos cuantos', () => {
    // Si esta cifra se desplomara, el extractor se habría roto y el test de
    // huérfanas empezaría a acusar claves perfectamente usadas.
    assert.ok(PREFIJOS.length >= 30, `solo ${PREFIJOS.length} prefijos: ¿se rompió el extractor?`);
    for (const p of ['ranges.', 'phase.', 'analysis.preset.', 'error.code.']) {
        assert.ok(PREFIJOS.includes(p), `falta el prefijo ${p}`);
    }
});

// @ts-check

/**
 * Ningún estado vacío o de error puede ser un callejón sin salida (E15-1).
 *
 * `components/state.js` pinta las acciones como `<button data-action="<id>">`,
 * y quien las declara y quien las escucha son dos ficheros distintos. Nada
 * ataba las dos mitades, así que un `action: 'go-onboarding'` sin su
 * `on(..., '[data-action="go-onboarding"]', ...)` compilaba, pasaba el
 * typecheck, pasaba los 833 tests y llegaba a producción como un botón
 * primario que no hace nada.
 *
 * Llegaron CUATRO así: `go-onboarding` en Gasto y en Compra, `add-intake` en
 * Gasto, y `openPicker` en Analizar —éste último ni siquiera lo sabíamos, lo
 * encontró este test—. Los cuatro eran `primary: true`, es decir, la salida
 * principal, y tres de ellos los ve exactamente quien todavía no tiene datos.
 *
 * Es la ficha H-013 del catálogo escrita como código en vez de como costumbre.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { isICloudDuplicate } from './helpers/tree.js';
import { es } from '../src/i18n/es.js';
import { en } from '../src/i18n/en.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Todos los `.js` bajo `src/`, con su ruta relativa a la raíz. */
function sourceFiles() {
    /** @type {Array<{ path: string, code: string }>} */ const out = [];
    const walk = (/** @type {string} */ current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (isICloudDuplicate(entry.name)) continue;
            const full = join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) {
                out.push({ path: relative(ROOT, full), code: readFileSync(full, 'utf8') });
            }
        }
    };
    walk(join(ROOT, 'src'));
    return out.sort((a, b) => a.path.localeCompare(b.path));
}

const FILES = sourceFiles();

/**
 * Acciones DECLARADAS: las que viajan dentro de un `actions: [...]`, que es la
 * única forma en que `state.js` las recibe.
 *
 * Se acota al array a propósito: `core/training.js` también tiene un campo
 * `action` (`'hold' | 'increase' | 'start'`) que no es esto y no debe colarse.
 * @returns {Array<{ id: string, file: string }>}
 */
function declaredActions() {
    /** @type {Array<{ id: string, file: string }>} */ const out = [];
    for (const { path, code } of FILES) {
        for (const block of code.matchAll(/actions:\s*\[([\s\S]*?)\]/g)) {
            for (const m of block[1].matchAll(/\baction:\s*'([^']+)'/g)) {
                out.push({ id: m[1], file: path });
            }
        }
    }
    return out;
}

/**
 * Ficheros cuyos oyentes valen para CUALQUIER vista.
 *
 * `router.js` engancha `on(viewContainer, ...)` una sola vez al arrancar, sobre
 * el contenedor que aloja todas las vistas, así que su `reload` cubre a todas.
 * `main.js` cablea los estados que se pintan ANTES de que el router exista.
 * Todo lo demás delega sobre el contenedor de SU vista y solo se oye ahí.
 */
const GLOBAL_LISTENERS = new Set(['src/ui/router.js', 'src/main.js']);

/**
 * Acciones ESCUCHADAS, indexadas por fichero.
 * @returns {Map<string, Set<string>>} fichero → identificadores que escucha
 */
function listenedActions() {
    /** @type {Map<string, Set<string>>} */ const out = new Map();
    for (const { path, code } of FILES) {
        const ids = new Set([...code.matchAll(/\[data-action="([^"$]+)"\]/g)].map((m) => m[1]));
        if (ids.size > 0) out.set(path, ids);
    }
    return out;
}

test('toda acción declarada tiene quien la escuche EN SU MISMA VISTA', () => {
    // «En su misma vista» no es un detalle: `on()` delega con
    // `origin.closest(selector)` acotado por `root.contains(target)`, y cada
    // vista recibe un contenedor propio. Un oyente de `go-onboarding` en Compra
    // no atiende al botón de Gasto. Un test que solo mirase el conjunto global
    // de identificadores daría por bueno exactamente ese fallo — y de hecho lo
    // dio, en la primera versión de este fichero.
    const listened = listenedActions();
    const declared = declaredActions();

    assert.ok(declared.length >= 7, `se esperaban al menos 7 acciones declaradas, hay ${declared.length}`);

    const global = new Set(
        [...listened].filter(([file]) => GLOBAL_LISTENERS.has(file)).flatMap(([, ids]) => [...ids])
    );

    const huerfanas = declared
        .filter(({ id, file }) => !global.has(id) && !(listened.get(file)?.has(id)))
        .map(({ id, file }) => `${id} (declarada en ${file}, sin oyente ahí)`);

    assert.deepEqual(huerfanas, [],
        `botones sin oyente — son callejones sin salida (H-013):\n  ${huerfanas.join('\n  ')}`);
});

test('los identificadores de acción son kebab-case, como el resto', () => {
    // `openPicker` era el único en camelCase, y era también el único que nadie
    // escuchaba. No es casualidad: un identificador que no sigue la convención
    // es uno que se escribió sin mirar los demás.
    const raros = [...new Set(declaredActions().map((a) => a.id))]
        .filter((id) => !/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(id));
    assert.deepEqual(raros, [], `identificadores de acción fuera de convención: ${raros.join(', ')}`);
});

test('las etiquetas de esos botones existen en los dos diccionarios', () => {
    // El otro medio callejón sin salida: el oyente está, pero el botón muestra
    // la clave cruda. `today.createPlan` se usaba en dos vistas y no existía en
    // ninguno de los dos idiomas.
    /** @type {Array<{ key: string, file: string }>} */ const labels = [];
    for (const { path, code } of FILES) {
        for (const block of code.matchAll(/actions:\s*\[([\s\S]*?)\]/g)) {
            for (const m of block[1].matchAll(/\blabelKey:\s*'([^']+)'/g)) {
                labels.push({ key: m[1], file: path });
            }
        }
    }
    assert.ok(labels.length >= 7);

    // Se importan los diccionarios, NO se leen como texto: las claves conviven
    // entrecomilladas de las dos formas ('x' y "x") y un `includes` se cree que
    // faltan las que usan la otra. Comprobar el objeto es comprobar la verdad.
    const faltan = labels
        .filter(({ key }) => !(key in es) || !(key in en))
        .map(({ key, file }) => `${key} (usada en ${file})`);

    assert.deepEqual(faltan, [], `claves de botón sin traducir:\n  ${faltan.join('\n  ')}`);
});

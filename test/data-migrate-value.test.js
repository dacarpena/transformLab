// @ts-check

/**
 * `migrateValue`, extraído a su propio módulo PURO (M8-0).
 *
 * POR QUÉ SE EXTRAJO, que es lo que este fichero tiene que dejar clavado:
 * `schema.js` importa `migrateValue`; `migrations.js` importa `storage.js`; y
 * `storage.js` tiene `let activeProfileId` y `let revisionCounter` a nivel de
 * MÓDULO. En el navegador eso es inocuo —un usuario por pestaña—, pero el
 * servidor va a reutilizar `schema.js` para validar lo que le llega, y en un
 * Worker el estado de módulo se comparte entre peticiones del mismo aislado. Un
 * `activeProfileId` compartido entre dos usuarios es la clase de fuga que no se
 * ve venir hasta que alguien lee los datos de otro.
 *
 * El test que importa de verdad es el último: el cierre de imports de
 * `schema.js` no puede volver a tocar el almacén.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, resolve } from 'node:path';
import { migrateValue } from '../src/data/migrate-value.js';
import { migrateValue as reexportada } from '../src/data/migrations.js';
import { SCHEMA_VERSION } from '../src/data/version.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('un valor de la versión vigente pasa sin tocarse', () => {
    const r = migrateValue('settings', { schemaVersion: SCHEMA_VERSION, locale: 'es' });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.migrated, false);
    assert.equal(r.ok && r.from, SCHEMA_VERSION);
});

test('un valor de una versión anterior sube hasta la vigente', () => {
    const r = migrateValue('settings', { schemaVersion: SCHEMA_VERSION - 1, locale: 'es' });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.migrated, true);
    assert.equal(r.ok && /** @type {*} */ (r.value).schemaVersion, SCHEMA_VERSION);
    // El salto 5→6 no cambia formas: lo demás tiene que llegar intacto.
    assert.equal(r.ok && /** @type {*} */ (r.value).locale, 'es');
});

test('un valor del FUTURO se rechaza en vez de destruirse', () => {
    // Lo escribió una versión más nueva de la aplicación —otra pestaña
    // actualizada, un backup de mañana—. Migrar hacia atrás es adivinar.
    const r = migrateValue('settings', { schemaVersion: SCHEMA_VERSION + 1 });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'migrations.fromTheFuture');
});

test('NUNCA lanza, y lo que no es un objeto con versión se rechaza', () => {
    for (const basura of [null, undefined, 42, 'x', [], {}, { schemaVersion: 'seis' }]) {
        const r = migrateValue('settings', /** @type {*} */ (basura));
        assert.equal(typeof r.ok, 'boolean');
        assert.equal(r.ok, false);
    }
});

test('no MUTA la entrada: devuelve una copia', () => {
    // La llama `validateCollection` sobre lo que acaba de leer del almacén.
    const original = { schemaVersion: SCHEMA_VERSION - 1, locale: 'es' };
    migrateValue('settings', original);
    assert.equal(original.schemaVersion, SCHEMA_VERSION - 1, 'el objeto de entrada se ha modificado');
});

test('`migrations.js` la reexporta: ningún llamante existente cambia', () => {
    assert.equal(reexportada, migrateValue);
});

test('el cierre de imports de schema.js NO toca el almacén ni el DOM (M8-0)', () => {
    // ÉSTE es el test por el que existe el módulo. `schema.js` va a correr en un
    // Worker para validar lo que llega del cliente; si arrastra `storage.js`,
    // arrastra estado de módulo compartido entre peticiones.
    //
    // Se recorre el grafo de imports de verdad, no una lista escrita a mano: una
    // lista se pudre en cuanto alguien añade un import intermedio.
    /** @type {Set<string>} */ const visitados = new Set();
    /** @type {string[]} */ const prohibidos = [];

    const visitar = (/** @type {string} */ archivo) => {
        if (visitados.has(archivo)) return;
        visitados.add(archivo);
        if (!existsSync(archivo)) return;
        const code = readFileSync(archivo, 'utf8');

        for (const patron of [/\bglobalThis\.localStorage\b/, /(?<![.\w])localStorage\./,
            /(?<![.\w])document\./, /(?<![.\w])window\./, /(?<![.\w])indexedDB\b/]) {
            const sinComentarios = code
                .replace(/\/\*[\s\S]*?\*\//g, ' ')
                .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
            if (patron.test(sinComentarios)) {
                prohibidos.push(`${archivo.replace(ROOT, '')} usa ${patron.source}`);
            }
        }

        for (const m of code.matchAll(/from\s+'(\.[^']+)'/g)) {
            visitar(resolve(dirname(archivo), m[1]));
        }
    };
    visitar(join(ROOT, 'src/data/schema.js'));

    assert.ok(visitados.size >= 3, `solo ${visitados.size} módulos: ¿se rompió el recorrido?`);
    assert.deepEqual(prohibidos, [],
        `el cierre de imports de schema.js tiene que poder correr en un Worker:\n  ${prohibidos.join('\n  ')}`);
});

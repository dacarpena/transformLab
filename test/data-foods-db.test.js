// @ts-check

/**
 * V2-M2 · Siembra de la base de alimentos.
 *
 * Lo que se prueba aquí no es «IndexedDB funciona» sino las tres decisiones que
 * pueden salir mal en silencio: que la siembra ocurra UNA vez, que se rehaga
 * sola cuando el fichero cambia, y que la aplicación siga funcionando cuando
 * IndexedDB no está.
 */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installIndexedDbMock, uninstallIndexedDbMock } from './helpers/indexed-db-mock.js';
import * as foodsDb from '../src/data/foods-db.js';
import { normalize } from '../src/core/foods.js';

const MUESTRA = [
    { id: 'usda:arroz', n: 'Arroz blanco crudo', k: 365, p: 7.1, c: 80, f: 0.7, src: 'usda' },
    { id: 'off:1', n: 'Yogur natural', b: 'Hacendado', k: 61, p: 3.5, c: 4.7, f: 3.3, src: 'off' }
];

/**
 * Doble de `fetch` que cuenta llamadas. Es lo que permite distinguir «leyó de
 * IndexedDB» de «volvió a pedir el fichero», que es justo lo que se quiere
 * medir y no se ve desde el resultado.
 * @param {*} payload
 */
function fakeFetch(payload) {
    const calls = { n: 0 };
    /** @type {*} */ const impl = async () => {
        calls.n += 1;
        return { ok: true, status: 200, json: async () => payload };
    };
    return { impl, calls };
}

beforeEach(() => {
    // `close()` y no `resetCache()`: la CONEXIÓN también está cacheada en el
    // módulo, así que sin cerrarla dos tests seguidos comparten la base del
    // anterior y el segundo pasa por lo que dejó el primero.
    foodsDb.close();
    installIndexedDbMock();
});

afterEach(() => {
    foodsDb.close();
    uninstallIndexedDbMock();
});

test('load siembra la base la primera vez y la devuelve', async () => {
    const { impl, calls } = fakeFetch({ foods: MUESTRA });
    const r = await foodsDb.load({ fetchImpl: impl });
    assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
    assert.equal(r.value.length, 2);
    assert.equal(calls.n, 1);

    const stored = await foodsDb.getAll();
    assert.ok(stored.ok);
    assert.equal(stored.value.length, 2);
});

test('load añade el nombre normalizado al volcar, no al buscar', async () => {
    const { impl } = fakeFetch({
        foods: [{ id: 'x', n: 'Plátano', k: 89, p: 1.1, c: 22.8, f: 0.3, src: 'usda' }]
    });
    await foodsDb.load({ fetchImpl: impl });
    const stored = await foodsDb.getAll();
    assert.ok(stored.ok);
    assert.equal(/** @type {*} */ (stored.value[0]).nameNormalized, normalize('Plátano'));
    assert.equal(/** @type {*} */ (stored.value[0]).nameNormalized, 'platano');
});

test('la segunda carga NO vuelve a pedir el fichero', async () => {
    const { impl, calls } = fakeFetch({ foods: MUESTRA });
    await foodsDb.load({ fetchImpl: impl });
    foodsDb.resetCache();                 // simula un arranque nuevo
    const r = await foodsDb.load({ fetchImpl: impl });
    assert.ok(r.ok);
    assert.equal(r.value.length, 2);
    assert.equal(calls.n, 1, 'el sello coincidía: no debía tocar la red');
});

test('la caché en memoria evita ir a IndexedDB en cada búsqueda', async () => {
    const { impl, calls } = fakeFetch({ foods: MUESTRA });
    await foodsDb.load({ fetchImpl: impl });
    // Sin resetCache: la segunda llamada es la del usuario tecleando.
    const r = await foodsDb.load({ fetchImpl: impl });
    assert.ok(r.ok);
    assert.equal(calls.n, 1);
});

test('force rehace la siembra aunque el sello coincida', async () => {
    const { impl, calls } = fakeFetch({ foods: MUESTRA });
    await foodsDb.load({ fetchImpl: impl });
    await foodsDb.load({ fetchImpl: impl, force: true });
    assert.equal(calls.n, 2);
});

test('sin IndexedDB la base sigue funcionando desde el fichero', async () => {
    uninstallIndexedDbMock();
    foodsDb.resetCache();
    const { impl } = fakeFetch({ foods: MUESTRA });
    const r = await foodsDb.load({ fetchImpl: impl });
    // NO es un error para el usuario: pierde la persistencia del volcado, no la
    // función. Convertirlo en fallo de la vista sería castigarle por una
    // limitación de su navegador.
    assert.ok(r.ok, 'debe degradar a memoria, no fallar');
    assert.equal(r.value.length, 2);
});

test('un fichero ilegible se reporta, no se traga', async () => {
    /** @type {*} */ const impl404 = async () => ({ ok: false, status: 404, json: async () => ({}) });
    const r404 = await foodsDb.load({ fetchImpl: impl404 });
    assert.equal(r404.ok, false);
    assert.equal(r404.ok === false && r404.error, 'foods.seedHttp404');

    foodsDb.resetCache();
    /** @type {*} */ const implBasura = async () => ({ ok: true, status: 200, json: async () => ({ cosas: [] }) });
    const rBasura = await foodsDb.load({ fetchImpl: implBasura });
    assert.equal(rBasura.ok, false);
    assert.equal(rBasura.ok === false && rBasura.error, 'foods.seedMalformed');
});

test('el sello viaja con el módulo y es el que hay que subir al regenerar', () => {
    assert.match(foodsDb.SEED_STAMP, /^foods-/);
    assert.equal(foodsDb.SEED_URL, 'vendor/data/foods.json');
});

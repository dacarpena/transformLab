// @ts-check

/**
 * El manejador `fetch` del service worker, EJECUTADO (M8-0).
 *
 * Los tests que hay sobre `sw.js` son estáticos —el candado de `PRECACHE`, la
 * versión derivada del hash— y no ven el comportamiento. Aquí el fichero se
 * carga de verdad en un contexto de `vm` con un ámbito de service worker fingido
 * y se le despachan eventos: lo que se comprueba es qué DECIDE, no qué dice su
 * texto.
 *
 * La decisión que se fija es la del bypass de `/api/`. Sin él, una respuesta de
 * la API caería en el manejador de recursos, que es cache-first y sin revalidar,
 * y se congelaría hasta el siguiente `sw:bump`: el dispositivo creería estar
 * sincronizado sirviéndose a sí mismo una respuesta de hace semanas.
 *
 * Un test estático (`grep '/api/'`) pasaría también con la línea puesta DESPUÉS
 * del manejador de navegación, que es donde no sirve. Éste no.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const ORIGEN = 'https://motifyer.com';

/**
 * Carga `sw.js` en un ámbito fingido y devuelve una función que despacha un
 * evento `fetch` y dice si el worker se ha hecho cargo de la petición.
 */
function cargarWorker() {
    /** @type {Record<string, Function[]>} */ const oyentes = {};
    const self = {
        location: new URL(`${ORIGEN}/`),
        addEventListener: (/** @type {string} */ tipo, /** @type {Function} */ fn) => {
            (oyentes[tipo] ??= []).push(fn);
        },
        skipWaiting: () => {},
        clients: { claim: () => {}, matchAll: async () => [] },
        registration: {}
    };
    const contexto = createContext({
        self, console,
        // Una CacheStorage mínima: si el manejador de recursos llega a usarla,
        // responde. Lo que importa no es qué devuelve, sino SI se le llama.
        caches: {
            open: async () => ({ match: async () => undefined, put: async () => {}, addAll: async () => {} }),
            keys: async () => [], delete: async () => true
        },
        fetch: async () => new Response('', { status: 200 }),
        Response, Request, URL, Headers
    });
    runInContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), contexto, { filename: 'sw.js' });
    assert.ok(oyentes.fetch?.length, 'sw.js no registró ningún oyente de fetch');

    /**
     * @param {string} url
     * @param {{ method?: string, mode?: string }} [opciones]
     * @returns {boolean} true si el worker se hizo cargo (`respondWith`).
     */
    return (url, { method = 'GET', mode = 'no-cors' } = {}) => {
        let atendida = false;
        const evento = {
            request: { url, method, mode },
            respondWith: (/** @type {Promise<*>} */ p) => {
                atendida = true;
                // Que nadie se queje de un rechazo sin capturar: aquí no
                // interesa el cuerpo, solo la decisión.
                Promise.resolve(p).catch(() => {});
            },
            waitUntil: () => {}
        };
        for (const fn of oyentes.fetch) fn(evento);
        return atendida;
    };
}

test('el worker NO intercepta /api/: la red se hace directa (M8-0)', () => {
    const despachar = cargarWorker();
    for (const ruta of ['/api/health', '/api/sync?since=42', '/api/auth/login', '/api']) {
        assert.equal(despachar(`${ORIGEN}${ruta}`), false,
            `el worker se hizo cargo de ${ruta}: la respuesta acabaría en la caché`);
    }
});

test('el bypass va ANTES del manejador de navegación, no después', () => {
    // El fallo sutil: poner el bypass detrás del bloque `request.mode ===
    // 'navigate'` lo deja sin efecto para una navegación a /api/..., que es
    // exactamente lo que pasa si el usuario abre la URL de exportación en una
    // pestaña. Un grep no ve el orden.
    const despachar = cargarWorker();
    assert.equal(despachar(`${ORIGEN}/api/export`, { mode: 'navigate' }), false,
        'una navegación a /api/ se sirvió con el shell cacheado');
});

test('y SIGUE interceptando lo demás, que es para lo que existe', () => {
    // La otra mitad: un bypass demasiado ancho —`url.pathname.includes('api')`—
    // dejaría fuera de la caché a cualquier módulo con «api» en el nombre y se
    // llevaría el offline por delante sin avisar.
    const despachar = cargarWorker();
    assert.equal(despachar(`${ORIGEN}/src/main.js`), true);
    assert.equal(despachar(`${ORIGEN}/`, { mode: 'navigate' }), true);
    assert.equal(despachar(`${ORIGEN}/src/data/rapid-api.js`), true,
        'un módulo con «api» en el nombre quedó fuera de la caché');
});

test('un POST no se toca, y lo de otro origen tampoco', () => {
    const despachar = cargarWorker();
    assert.equal(despachar(`${ORIGEN}/src/main.js`, { method: 'POST' }), false);
    assert.equal(despachar('https://example.com/x.js'), false);
});

// @ts-check

/**
 * La única puerta de salida del dispositivo (M8-5c).
 *
 * Hasta M8, `src/` no tenía ni un `fetch`. Ahora hay uno, y este fichero fija lo
 * que hace que siga siendo defendible: **que no se puede mandar nada a ningún
 * sitio que no sea el propio origen**, y que un fallo de red es un estado normal
 * y no una excepción que tumbe la aplicación.
 *
 * `test/security.test.js` guarda la otra mitad: que nadie llame a `fetch` fuera
 * de aquí.
 */

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { request, maybeOnline } from '../src/data/api.js';

const ORIGEN = 'https://motifyer.com';

/** @type {{ url: string, init: * }[]} */ let llamadas = [];
/** @type {*} */ let respuesta;
/** @type {*} */ let original;

beforeEach(() => {
    llamadas = [];
    respuesta = () => new Response('{"ok":true}', { status: 200 });
    original = { fetch: globalThis.fetch, location: /** @type {*} */ (globalThis).location, navigator: globalThis.navigator };
    /** @type {*} */ (globalThis).location = new URL(`${ORIGEN}/`);
    globalThis.fetch = /** @type {*} */ (async (/** @type {*} */ url, /** @type {*} */ init) => {
        llamadas.push({ url: String(url), init });
        return respuesta(url, init);
    });
});

afterEach(() => {
    globalThis.fetch = original.fetch;
    /** @type {*} */ (globalThis).location = original.location;
});

/* ── La aduana ───────────────────────────────────────────────────────────── */

test('solo se puede llamar a rutas /api/ del propio origen', async () => {
    // Sin esta regla, un dato de un backup importado que acabase en una ruta
    // convertiría este módulo en un exfiltrador.
    for (const ruta of [
        'https://evil.example/robar',
        '//evil.example/robar',
        'http://motifyer.com/api/x',
        '/otra/cosa',
        '/api',
        'api/health',
        '',
        // Se normaliza a `/evil` y deja de ser `/api/`: por eso no basta con
        // mirar el prefijo de la cadena, hay que resolver la URL.
        '/api/../evil'
    ]) {
        const r = await request(/** @type {string} */ (ruta));
        assert.equal(r.ok, false, `pasó «${ruta}»`);
        assert.equal(r.ok === false && r.error, 'api.badPath');
    }
    assert.deepEqual(llamadas, [], 'alguna llegó a salir a la red');
});

test('una ruta legítima sí pasa, y sale relativa', async () => {
    const r = await request('/api/session');
    assert.equal(r.ok, true);
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0].url, '/api/session');
});

test('la cookie no puede viajar a otro origen', async () => {
    await request('/api/session');
    assert.equal(llamadas[0].init.credentials, 'same-origin');
});

test('nunca se cachea, y no se siguen redirecciones', async () => {
    // Una respuesta de la API cacheada miente sobre el estado del servidor. Y la
    // API no redirige nunca, así que una redirección es una anomalía —o un
    // intermediario— y seguirla es peor que fallar.
    await request('/api/session');
    assert.equal(llamadas[0].init.cache, 'no-store');
    assert.equal(llamadas[0].init.redirect, 'error');
});

test('un POST lleva Content-Type JSON: es una de las tres capas contra CSRF', async () => {
    await request('/api/auth/logout', { method: 'POST' });
    assert.equal(llamadas[0].init.headers['Content-Type'], 'application/json');
    assert.equal(llamadas[0].init.body, '{}');
});

test('un GET no lleva cuerpo', async () => {
    await request('/api/session');
    assert.equal(llamadas[0].init.body, undefined);
});

/* ── Nunca lanza ─────────────────────────────────────────────────────────── */

test('sin red devuelve un Result, no una excepción', async () => {
    // La aplicación funciona entera sin cuenta (§1), así que un fallo de red es
    // un estado normal. Si esto lanzara, cada llamante tendría que acordarse de
    // capturar, y el que se olvidara rompería una vista por estar en el metro.
    respuesta = () => { throw new TypeError('Failed to fetch'); };
    const r = await request('/api/session');
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'api.offline');
});

test('una respuesta que no es JSON se trata como fallo, nunca se interpreta', async () => {
    // El caso real es el portal cautivo de un hotel, que devuelve su HTML con un
    // 200. Interpretarlo sería tomar por respuesta de la API una página ajena.
    respuesta = () => new Response('<html>Inicia sesión en la wifi</html>', { status: 200 });
    const r = await request('/api/session');
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'api.badResponse');
});

test('un error del servidor llega con SU código, para que t() lo traduzca', async () => {
    // Aquí no se compone ningún mensaje: sería el primer literal visible fuera
    // de los diccionarios, que §5 prohíbe.
    respuesta = () => new Response('{"error":"credential.last"}', { status: 409 });
    const r = await request('/api/account/credentials/x', { method: 'DELETE' });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.status, 409);
    assert.equal(r.ok === false && r.error, 'credential.last');
});

test('un error sin código no inventa uno', async () => {
    respuesta = () => new Response('{}', { status: 500 });
    const r = await request('/api/session');
    assert.equal(r.ok === false && r.error, 'api.unknown');
});

test('una respuesta vacía con 200 no revienta', async () => {
    respuesta = () => new Response('', { status: 200 });
    const r = await request('/api/auth/logout', { method: 'POST' });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.value, null);
});

/* ── El plazo ────────────────────────────────────────────────────────────── */

test('una petición que no vuelve se corta, y lo dice', async () => {
    // Sin plazo, un botón se queda girando para siempre en un metro sin
    // cobertura.
    respuesta = (/** @type {*} */ _url, /** @type {*} */ init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
    });
    const r = await request('/api/session', { timeoutMs: 30 });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'api.timeout');
});

test('quien llama puede cancelar con su propia señal', async () => {
    // Cerrar una vista a medias no puede dejar la petición viva.
    const mia = new AbortController();
    respuesta = (/** @type {*} */ _url, /** @type {*} */ init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' })));
    });
    const promesa = request('/api/session', { signal: mia.signal, timeoutMs: 5000 });
    mia.abort();
    const r = await promesa;
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'api.timeout');
});

/* ── El estado de red ────────────────────────────────────────────────────── */

test('maybeOnline solo es de fiar cuando dice que NO', () => {
    // `navigator.onLine` dice `true` con el wifi de un tren sin salida a
    // internet. Sirve para no lanzar una petición que se sabe perdida, nunca
    // para dar por buena una que va a fallar.
    //
    // `globalThis.navigator` en Node es de SOLO LECTURA —tiene getter y no
    // setter—, así que hay que redefinir la propiedad en vez de asignarla.
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const poner = (/** @type {*} */ valor) =>
        Object.defineProperty(globalThis, 'navigator', { value: valor, configurable: true, writable: true });
    try {
        poner({ onLine: false });
        assert.equal(maybeOnline(), false);
        poner({ onLine: true });
        assert.equal(maybeOnline(), true);
        // Sin `navigator` —un worker— se supone que sí: ya lo dirá la petición.
        poner(undefined);
        assert.equal(maybeOnline(), true);
    } finally {
        if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    }
});

// @ts-check

/**
 * La API, ejecutada de punta a punta sin levantar nada (M8-1).
 *
 * `functions/` es JavaScript normal: el middleware y el enrutador reciben una
 * `Request` y devuelven una `Response`, y nada más. Así que aquí se monta la
 * misma tubería que monta Cloudflare Pages —middleware → `next()` → la Function
 * de `api/[[path]].js`— y se le mandan peticiones de verdad.
 *
 * Esto es MEJOR que probarlo con `wrangler pages dev`, no un sucedáneo: corre en
 * milisegundos, corre en CI sin credenciales, y falla señalando la línea. Lo que
 * `wrangler` sí aporta —que Pages enrute lo que creemos— se comprueba una vez a
 * mano, no en cada commit.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequest as enrutador } from '../functions/api/[[path]].js';
import { ROUTES } from '../functions/_manifest.js';
import { match } from '../functions/_lib/router.js';
import { ALLOWED_METHODS } from '../functions/_lib/guard.js';

const ORIGEN = 'https://motifyer.com';

/**
 * Manda una petición por la tubería completa.
 *
 * @param {string} ruta
 * @param {{ method?: string, headers?: Record<string,string>, body?: string, env?: * }} [opciones]
 * @returns {Promise<Response>}
 */
function llamar(ruta, { method = 'GET', headers = {}, body, env = {} } = {}) {
    const request = new Request(`${ORIGEN}${ruta}`, { method, headers, body });
    /** @type {*} */ const ctx = {
        request, env, params: {}, data: {},
        waitUntil: () => {},
        next: () => enrutador({ ...ctx, request })
    };
    return middleware(ctx);
}

/** El cuerpo como objeto. */
const cuerpo = async (/** @type {Response} */ r) => JSON.parse(await r.text());

/** Las cabeceras que un `POST` legítimo lleva. */
const POST_OK = { Origin: ORIGEN, 'Content-Type': 'application/json' };

test('la lista de métodos aceptados es la que se decidió, y no crece sola', () => {
    // `PUT` y `PATCH` no están porque nadie los sirve: la sincronización empuja
    // con `POST` y el borrado usa `DELETE`. `OPTIONS` tampoco, y ése es el
    // importante: contestar un preflight es habilitar CORS, y esta API es del
    // mismo origen. Aceptar métodos que nadie atiende solo amplía la superficie.
    assert.deepEqual([...ALLOWED_METHODS], ['GET', 'HEAD', 'POST', 'DELETE']);
});

/* ── El endpoint ─────────────────────────────────────────────────────────── */

test('GET /api/health responde, y dice si ve sus enlaces', async () => {
    const r = await llamar('/api/health');
    assert.equal(r.status, 200);
    assert.deepEqual(await cuerpo(r), { ok: true, bindings: { db: false, photos: false } });

    const conEnlaces = await llamar('/api/health', { env: { DB: {}, PHOTOS: {} } });
    assert.deepEqual((await cuerpo(conEnlaces)).bindings, { db: true, photos: true });
});

test('/health no filtra versión, entorno ni nombres de recurso', async () => {
    // Un `/health` que enumera la pila es un regalo para quien busca una versión
    // con CVE conocida, y este endpoint es público por definición.
    const texto = await (await llamar('/api/health', {
        env: { DB: { name: 'transformlab-prod' }, PHOTOS: { name: 'fotos-prod' } }
    })).text();
    assert.doesNotMatch(texto, /version|commit|prod|transformlab|wrangler|node|d1|r2/i);
});

/* ── Las cabeceras, que las pone el middleware y no el manejador ─────────── */

test('TODA respuesta sale sellada, incluidos los errores', async () => {
    // Es el motivo de que las cabeceras se pongan a la salida: si cada manejador
    // las pusiera, bastaría un camino que devuelve una `Response` a pelo para
    // que se colara una respuesta de la API sin `no-store` ni `Vary`.
    for (const [ruta, opciones] of [
        ['/api/health', {}],
        ['/api/no-existe', {}],
        ['/api/health', { method: 'DELETE', headers: POST_OK }],
        ['/api/health', { method: 'PATCH' }]
    ]) {
        const r = await llamar(/** @type {string} */ (ruta), opciones);
        const d = `${ruta} ${JSON.stringify(opciones)}`;
        assert.equal(r.headers.get('Cache-Control'), 'no-store', d);
        assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff', d);
        assert.equal(r.headers.get('Referrer-Policy'), 'no-referrer', d);
        assert.equal(r.headers.get('Vary'), 'Origin, Cookie', d);
        assert.equal(r.headers.get('Content-Security-Policy'), "default-src 'none'; sandbox", d);
        assert.equal(r.headers.get('Access-Control-Allow-Origin'), null, `${d}: CORS emitido`);
    }
});

test('el sellado NO pisa el Allow de un 405 ni el tipo del manejador', async () => {
    const r = await llamar('/api/health', { method: 'DELETE', headers: POST_OK });
    assert.equal(r.status, 405);
    assert.match(r.headers.get('Allow') ?? '', /GET/);
    assert.match(r.headers.get('Content-Type') ?? '', /application\/json/);
});

/* ── El guardián: CSRF sin token ─────────────────────────────────────────── */

test('un POST sin Origin, o con otro Origin, se rechaza', async () => {
    for (const headers of [
        { 'Content-Type': 'application/json' },
        { Origin: 'https://malo.example', 'Content-Type': 'application/json' },
        { Origin: `${ORIGEN}.malo.example`, 'Content-Type': 'application/json' },
        { Origin: 'http://motifyer.com', 'Content-Type': 'application/json' }
    ]) {
        const r = await llamar('/api/health', { method: 'POST', headers, body: '{}' });
        assert.equal(r.status, 403, `pasó con ${JSON.stringify(headers)}`);
        assert.equal((await cuerpo(r)).error, 'origin.mismatch');
    }
});

test('un POST con un Content-Type que un <form> ajeno PODRÍA producir se rechaza', async () => {
    // Son los tres únicos que un formulario de otro origen puede mandar, y por
    // eso exigir `application/json` es una capa real y no cosmética.
    for (const tipo of ['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain']) {
        const r = await llamar('/api/health', {
            method: 'POST', headers: { Origin: ORIGEN, 'Content-Type': tipo }, body: '{}'
        });
        assert.equal(r.status, 415, `pasó con ${tipo}`);
    }
    // Y sin cabecera ninguna, también.
    const sin = await llamar('/api/health', { method: 'POST', headers: { Origin: ORIGEN }, body: '{}' });
    assert.equal(sin.status, 415);
});

test('application/json CON parámetros sí pasa: es lo que manda un cliente real', async () => {
    // Comparar la cadena entera rechazaría a `fetch` con `charset`, que es
    // legítimo. El fallo sería invisible en el test y visible en producción.
    const r = await llamar('/api/health', {
        method: 'POST',
        headers: { Origin: ORIGEN, 'Content-Type': 'Application/JSON; charset=utf-8' },
        body: '{}'
    });
    // Llega al enrutador, que responde 405 porque /health solo sirve GET. Lo que
    // importa es que NO se quedó en el 415 del guardián.
    assert.equal(r.status, 405);
});

test('un GET no necesita Origin: no cambia nada', async () => {
    assert.equal((await llamar('/api/health')).status, 200);
});

test('OPTIONS no se contesta nunca: contestar un preflight es habilitar CORS', async () => {
    const r = await llamar('/api/health', { method: 'OPTIONS', headers: { Origin: 'https://malo.example' } });
    assert.equal(r.status, 405);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
    assert.equal(r.headers.get('Access-Control-Allow-Methods'), null);
});

/* ── El enrutador ────────────────────────────────────────────────────────── */

test('una ruta desconocida es 404, y el método equivocado es 405', async () => {
    assert.equal((await llamar('/api/no-existe')).status, 404);
    assert.equal((await llamar('/api/health', { method: 'DELETE', headers: POST_OK })).status, 405);
});

test('HEAD se atiende con el manejador de GET', async () => {
    // Lo dice HTTP, y no hacerlo deja un 405 en peticiones que cualquier
    // comprobador de salud hace.
    const r = await llamar('/api/health', { method: 'HEAD' });
    assert.equal(r.status, 200);
});

test('la barra final NO duplica el endpoint', async () => {
    // Si `/api/health` y `/api/health/` fueran rutas distintas, cada endpoint
    // existiría dos veces y solo una estaría probada.
    assert.equal((await llamar('/api/health/')).status, 200);
});

test('los parámetros se capturan, y un segmento vacío no cuela', () => {
    const tabla = [{ method: 'GET', path: '/api/photos/:id', handler: () => new Response(''), auth: true }];
    const r = match(tabla, 'GET', '/api/photos/abc123');
    assert.equal(r.route?.path, '/api/photos/:id');
    assert.deepEqual(r.route ? r.params : null, { id: 'abc123' });

    // `/api/photos//x` tiene el número de segmentos de `/api/photos/:id/x`, no
    // el de `/api/photos/:id`; y un `:id` vacío nunca captura.
    assert.equal(match(tabla, 'GET', '/api/photos/').route, null);
    assert.equal(match(tabla, 'GET', '/api/photos').route, null);
});

test('el enrutador no puede ser burlado con una ruta que no empieza por /api', () => {
    // `_routes.json` ya hace que Pages no invoque la Function fuera de `/api/*`,
    // pero la tabla no puede depender de eso: es una segunda capa.
    for (const ruta of ['/health', '/../api/health', '/API/health']) {
        assert.equal(match(ROUTES, 'GET', ruta).route, null, `coló ${ruta}`);
    }
});

/* ── Que un manejador que revienta no tumbe la API ───────────────────────── */

test('un manejador que lanza da 500 SIN filtrar el error', async () => {
    // Un `stack` dice rutas de fichero, nombres de tabla y a veces valores.
    const explota = {
        method: 'GET', path: '/api/boom', auth: false,
        handler: () => { throw new Error('el secreto es 1234 en /Users/dani/tabla_usuarios'); }
    };
    const encontrada = match([explota], 'GET', '/api/boom');
    assert.ok(encontrada.route);

    /** @type {*} */ const ctx = {
        request: new Request(`${ORIGEN}/api/boom`), env: {}, params: {}, data: {},
        waitUntil: () => {},
        next: async () => {
            try { return await encontrada.route.handler(ctx); } catch { return new Response('{"error":"internal"}', { status: 500 }); }
        }
    };
    const r = await middleware(ctx);
    assert.equal(r.status, 500);
    const texto = await r.text();
    assert.doesNotMatch(texto, /secreto|1234|Users|tabla_usuarios|Error:/);
    assert.equal(r.headers.get('Cache-Control'), 'no-store', 'ni el 500 se libra del sellado');
});

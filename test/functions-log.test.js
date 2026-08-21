// @ts-check

/**
 * El registro y el acolchado temporal (M9-7).
 *
 * ## Lo que se descubrió escribiendo esto
 *
 * El registro anterior **filtraba datos del usuario**. `api/[[path]].js` hacía
 * `console.error('api.handler', url.pathname, error)`, y una ruta concreta de
 * esta API lleva dentro el id de una foto —que es `ph_<fecha>`— y el de un
 * perfil. O sea que los registros del servidor acababan conteniendo en qué días
 * alguien se hizo fotos de progreso: exactamente lo que el resto del diseño se
 * toma tantas molestias en no saber, y con la particularidad de que un registro
 * no se puede des-escribir.
 *
 * | Invariante | Lo que evita |
 * |---|---|
 * | `nada_de_nadie_en_el_registro` | que una ruta concreta cuente qué días hay fotos |
 * | `un_solo_console` | que alguien registre a mano y se salte el filtro |
 * | `mensaje_no_se_registra` | que una excepción arrastre valores al registro |
 * | `suelo_de_autenticacion` | medir desde fuera si una credencial existe |
 */

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createD1 } from './helpers/d1-fake.js';
import { createR2 } from './helpers/r2-fake.js';
import { onRequest as middleware, AUTH_FLOOR_MS } from '../functions/_middleware.js';
import { onRequest as enrutador } from '../functions/api/[[path]].js';
import { createAccount, openSession } from '../functions/_lib/db.js';
import { COOKIE_NAME } from '../functions/_lib/sessions.js';
import { line, redondear, deExcepcion } from '../functions/_lib/log.js';

const ORIGEN = 'https://motifyer.com';
const PERFIL = 'op4co1234567890abcdefg';

/** Lo que se ha escrito por consola durante el test. */
/** @type {string[]} */ let escrito;
/** @type {*} */ let originales;

beforeEach(() => {
    escrito = [];
    originales = { log: console.log, error: console.error };
    console.log = (/** @type {*} */ ...args) => escrito.push(args.join(' '));
    console.error = (/** @type {*} */ ...args) => escrito.push(args.join(' '));
});

afterEach(() => {
    console.log = originales.log;
    console.error = originales.error;
});

async function conCuenta() {
    const d1 = createD1();
    const env = /** @type {*} */ ({ DB: d1.db, PHOTOS: createR2().bucket });
    const ahora = Date.now();
    await createAccount(env, {
        userId: 'u_ana', credentialId: 'c_ana', publicKey: new Uint8Array(91),
        algorithm: -7, signCount: 0, now: ahora
    });
    const { token } = await openSession(env, {
        userId: 'u_ana', credentialId: 'c_ana', ip: null, now: ahora
    });
    return { env, token, close: d1.close };
}

function llamar(ruta, { env, token, method = 'GET', body } = {}) {
    /** @type {Record<string,string>} */ const headers = {};
    if (token) headers.Cookie = `${COOKIE_NAME}=${token}`;
    if (method !== 'GET') { headers.Origin = ORIGEN; headers['Content-Type'] = 'application/json'; }
    const request = new Request(`${ORIGEN}${ruta}`, {
        method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
    });
    /** @type {*} */ const ctx = {
        request, env, params: {}, data: {}, waitUntil: () => {},
        next: () => enrutador({ ...ctx, request })
    };
    return middleware(ctx);
}

/* ── Lo que NO puede salir ───────────────────────────────────────────────── */

test('nada_de_nadie_en_el_registro: la ruta concreta NUNCA se escribe', async () => {
    // El id de una foto es `ph_<fecha>`: registrarlo es registrar en qué días
    // alguien se hizo fotos de progreso.
    const { env, token, close } = await conCuenta();
    try {
        await llamar(`/api/photos/ph_2026-05-01?profile=${PERFIL}`, { env, token });
        const todo = escrito.join('\n');

        assert.ok(escrito.length > 0, 'no se registró nada: este test no probaría nada');
        assert.doesNotMatch(todo, /ph_2026-05-01/, 'se registró el id de la foto');
        assert.doesNotMatch(todo, /\d{4}-\d{2}-\d{2}/, 'se coló una fecha');
        assert.doesNotMatch(todo, new RegExp(PERFIL), 'se registró el id del perfil');
        assert.doesNotMatch(todo, /u_ana/, 'se registró el id de la cuenta');

        // Y sí se registra el PATRÓN, que es lo que hace falta para depurar.
        assert.match(todo, /"route":"\/api\/photos\/:id"/);
    } finally { close(); }
});

test('la cookie de sesión no aparece en ninguna línea', async () => {
    const { env, token, close } = await conCuenta();
    try {
        await llamar('/api/account', { env, token });
        assert.ok(token.length > 20);
        assert.doesNotMatch(escrito.join('\n'), new RegExp(token.slice(0, 12)),
            'se registró parte del token de sesión');
    } finally { close(); }
});

test('mensaje_no_se_registra: una excepción va sin lo que llevaba dentro', () => {
    // `scoped()` lanza con el TEXTO de la consulta, y un error de D1 puede traer
    // los parámetros que se ataron. Ahí cabe una clave de objeto o un id.
    const error = new TypeError('DELETE FROM records WHERE item_tag = ph_2026-05-01');
    const { detail, at } = deExcepcion(error);
    assert.equal(detail, 'TypeError');
    assert.ok(at === undefined || !at.includes('ph_2026-05-01'), 'el marco arrastró el mensaje');

    line({ evt: 'prueba', detail, at });
    const salida = escrito.join('\n');
    assert.doesNotMatch(salida, /ph_2026-05-01/, 'el mensaje acabó en el registro');
    assert.match(salida, /"detail":"TypeError"/);
});

test('lo que no sea un campo declarado no sale, aunque lo pasen', () => {
    // La garantía es ESTRUCTURAL: `line()` compone el objeto ella misma. Un
    // llamante que pase medio contexto por error no puede filtrar nada.
    line(/** @type {*} */ ({
        evt: 'prueba', status: 200,
        token: 'secreto', userId: 'u_ana', ip: '203.0.113.7', ciphertext: 'AAAA'
    }));
    const salida = escrito.join('\n');
    assert.deepEqual(JSON.parse(salida), { evt: 'prueba', status: 200 });
});

test('la duración se redondea: al milisegundo es una medida para atacar', () => {
    assert.equal(redondear(137), 140);
    assert.equal(redondear(141), 140);
    assert.equal(redondear(4), 0);
    assert.equal(redondear(-5), 0);
});

/* ── Una sola puerta ─────────────────────────────────────────────────────── */

test('un_solo_console: nadie del servidor escribe por consola salvo `_lib/log.js`', () => {
    // El filtro de campos no sirve de nada si cualquiera puede escribir a mano,
    // y escribir a mano es lo que hacía el enrutador cuando filtraba la ruta.
    const raiz = fileURLToPath(new URL('../functions', import.meta.url));
    /** @type {string[]} */ const culpables = [];

    const recorrer = (/** @type {string} */ dir) => {
        for (const entrada of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, entrada.name);
            if (entrada.isDirectory()) { recorrer(p); continue; }
            if (!entrada.name.endsWith('.js')) continue;
            if (p.endsWith('_lib/log.js')) continue;
            const fuente = readFileSync(p, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
            if (/\bconsole\s*\./.test(fuente)) culpables.push(p.slice(raiz.length));
        }
    };
    recorrer(raiz);
    assert.deepEqual(culpables, [], 'hay código del servidor registrando por su cuenta');
});

/* ── El suelo temporal ───────────────────────────────────────────────────── */

test('suelo_de_autenticacion: toda respuesta de /api/auth/* tarda lo mismo', async () => {
    // `login/finish` con una credencial que no existe vuelve enseguida; con una
    // que sí, verifica una firma. Esa diferencia responde a «¿está registrada
    // esta credencial?», y se mide desde fuera sin autenticarse.
    const { env, close } = await conCuenta();
    try {
        for (const ruta of ['/api/auth/login/start', '/api/auth/login/finish', '/api/auth/register/finish']) {
            const t = Date.now();
            await llamar(ruta, { env, method: 'POST' });
            const tardo = Date.now() - t;
            assert.ok(tardo >= AUTH_FLOOR_MS - 5, `${ruta} tardó ${tardo} ms, por debajo del suelo`);
        }
    } finally { close(); }
});

test('el suelo cubre también los rechazos tempranos', async () => {
    // Son los rápidos, o sea los que más se distinguirían. Un `return` suelto
    // antes del acolchado sería justo el interesante.
    const { env, close } = await conCuenta();
    try {
        const request = new Request(`${ORIGEN}/api/auth/login/start`, {
            method: 'POST',
            headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
            body: '{}'
        });
        /** @type {*} */ const ctx = {
            request, env, params: {}, data: {}, waitUntil: () => {},
            next: () => enrutador({ ...ctx, request })
        };
        const t = Date.now();
        const r = await middleware(ctx);
        assert.equal(r.status, 403);
        assert.ok(Date.now() - t >= AUTH_FLOOR_MS - 5, 'un rechazo por Origin salió sin acolchar');
    } finally { close(); }
});

test('lo que NO es autenticación no paga el suelo', async () => {
    // Ponerlo en el camino de la sincronización se notaría, y ahí no hay nada
    // que medir: sin sesión no se contesta.
    const { env, token, close } = await conCuenta();
    try {
        const t = Date.now();
        await llamar('/api/health', { env });
        await llamar('/api/account', { env, token });
        assert.ok(Date.now() - t < AUTH_FLOOR_MS, 'se acolchó una ruta que no es de autenticación');
    } finally { close(); }
});

/* ── Que registre algo útil ──────────────────────────────────────────────── */

test('cada petición deja UNA línea JSON con lo que hace falta para depurar', async () => {
    const { env, token, close } = await conCuenta();
    try {
        await llamar('/api/account', { env, token });
        const lineas = escrito.filter((l) => l.includes('"evt":"req"'));
        assert.equal(lineas.length, 1, 'una petición dejó más de una línea, o ninguna');

        const o = JSON.parse(lineas[0]);
        assert.equal(o.evt, 'req');
        assert.equal(o.method, 'GET');
        assert.equal(o.route, '/api/account');
        assert.equal(o.status, 200);
        assert.equal(typeof o.ms, 'number');
    } finally { close(); }
});

test('una ruta que no existe se registra SIN ruta, no con la que se pidió', async () => {
    const { env, close } = await conCuenta();
    try {
        await llamar('/api/inventada/ph_2026-05-01', { env });
        const todo = escrito.join('\n');
        assert.doesNotMatch(todo, /inventada|ph_2026-05-01/,
            'una ruta inexistente se registró tal cual: es una vía para escribir lo que se quiera en el registro');
        assert.match(todo, /"status":404/);
    } finally { close(); }
});

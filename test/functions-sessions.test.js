// @ts-check

/**
 * Sesiones: rotación, gracia, detección de reuso y caducidad (M8-4).
 *
 * Todo el tiempo se INYECTA (`verifySession(env, token, { now })`), así que aquí
 * no hay esperas ni relojes falsos: se dice qué hora es y se comprueba qué pasa.
 * Es la misma disciplina que la capa de datos del cliente, donde `nowISO` se
 * inyecta siempre — y por la misma razón: un test que espera dos segundos es un
 * test que a veces falla.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1-fake.js';
import {
    openSession, verifySession, closeSession, openUserScope,
    createAccount, sweepExpired, ROTATE_AFTER_MS, ROTATION_GRACE_MS
} from '../functions/_lib/db.js';
import { ABSOLUTE_TTL_MS, IDLE_TTL_MS, COOKIE_NAME, readCookie, clearCookie } from '../functions/_lib/sessions.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequest as enrutador } from '../functions/api/[[path]].js';

const T0 = 1_700_000_000_000;
const ORIGEN = 'https://motifyer.com';

/**
 * Una cuenta con una sesión abierta.
 *
 * `now` es un parámetro y no una constante porque hay dos clases de test aquí:
 * los que ejercitan `verifySession` —que recibe el tiempo y por tanto pueden
 * vivir en 2023— y los que pasan por el MIDDLEWARE, que llama a `Date.now()`
 * porque es la raíz de composición y no tiene de dónde recibirlo. Una sesión
 * fechada en 2023 llega caducada a esos, y el 401 que sale no dice por qué.
 *
 * @param {number} [now]
 */
async function conSesion(now = T0) {
    const T0 = now;
    const h = createD1();
    const env = /** @type {*} */ ({ DB: h.db });
    await createAccount(env, {
        userId: 'u_ana', credentialId: 'c_ana', publicKey: new Uint8Array(91),
        algorithm: -7, signCount: 0, now: T0
    });
    const { token } = await openSession(env, { userId: 'u_ana', credentialId: 'c_ana', ip: '203.0.113.7', now: T0 });
    return { ...h, env, token };
}

const filas = async (/** @type {*} */ db) =>
    /** @type {number} */ (await db.prepare('SELECT COUNT(*) AS n FROM sessions').first('n'));

/* ── Lo normal ───────────────────────────────────────────────────────────── */

test('una sesión recién abierta vale, y no rota todavía', async () => {
    const { env, token, close } = await conSesion();
    try {
        const r = await verifySession(env, token, { now: T0 + 1000 });
        assert.equal(r.ok, true);
        assert.equal(r.ok && r.userId, 'u_ana');
        assert.equal(r.ok && r.credentialId, 'c_ana');
        assert.equal(r.ok && r.newToken, null, 'rotar en cada petición es una escritura por petición');
    } finally { close(); }
});

test('la IP se guarda TRUNCADA', async () => {
    // Sirve para que el usuario reconozca una sesión que no es suya; la IP
    // completa sería un dato de localización que esta aplicación no necesita.
    const { db, env, close } = await conSesion();
    try {
        const s = /** @type {*} */ ((await openUserScope(env, 'u_ana').sessions())[0]);
        assert.equal(s.ip_trunc, '203.0.113.0/24');
        assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE ip_trunc LIKE '%.7%'").first('n'), 0);
    } finally { close(); }
});

test('un token desconocido o ilegible no vale, y no revienta', async () => {
    const { env, close } = await conSesion();
    try {
        for (const t of ['', 'no+es+base64url', 'a'.repeat(43), '{}']) {
            const r = await verifySession(env, t, { now: T0 });
            assert.equal(r.ok, false, `pasó «${t}»`);
            assert.equal(r.ok === false && r.reason, 'unknown');
        }
    } finally { close(); }
});

/* ── Rotación ────────────────────────────────────────────────────────────── */

test('pasada una hora el token ROTA, y el nuevo vale', async () => {
    const { env, token, close } = await conSesion();
    try {
        const t1 = T0 + ROTATE_AFTER_MS + 1;
        const r = await verifySession(env, token, { now: t1 });
        assert.ok(r.ok && r.newToken, 'no rotó');
        assert.notEqual(r.ok && r.newToken, token);

        const conNuevo = await verifySession(env, /** @type {string} */ (r.ok && r.newToken), { now: t1 + 1000 });
        assert.equal(conNuevo.ok, true);
        assert.equal(await filas(env.DB), 1, 'rotar no puede crear una sesión más');
    } finally { close(); }
});

test('el token VIEJO sigue valiendo dentro de la gracia', async () => {
    // Sin gracia, perder la respuesta que traía la cookie nueva —una pestaña que
    // se cierra, un túnel que se corta, dos peticiones en paralelo— cerraría la
    // sesión del usuario y, peor, la marcaría como robo.
    const { env, token, close } = await conSesion();
    try {
        const t1 = T0 + ROTATE_AFTER_MS + 1;
        await verifySession(env, token, { now: t1 });

        const r = await verifySession(env, token, { now: t1 + ROTATION_GRACE_MS - 1 });
        assert.equal(r.ok, true, 'el token viejo se rechazó dentro de la gracia');
        assert.equal(r.ok && r.newToken, null, 'volver a rotar aquí encadenaría rotaciones');
    } finally { close(); }
});

test('pasada la gracia, el token viejo REVOCA la familia entera', async () => {
    // Alguien tiene una copia. Revocar solo esa fila dejaría dentro al atacante
    // —que ya usó el token bueno— y fuera al dueño.
    const { env, token, close } = await conSesion();
    try {
        const t1 = T0 + ROTATE_AFTER_MS + 1;
        const rot = await verifySession(env, token, { now: t1 });
        const nuevo = /** @type {string} */ (rot.ok && rot.newToken);

        const r = await verifySession(env, token, { now: t1 + ROTATION_GRACE_MS + 1 });
        assert.equal(r.ok, false);
        assert.equal(r.ok === false && r.reason, 'reuse');

        assert.equal(await filas(env.DB), 0, 'la familia tenía que caer entera');
        const conNuevo = await verifySession(env, nuevo, { now: t1 + ROTATION_GRACE_MS + 2 });
        assert.equal(conNuevo.ok, false, 'el token BUENO también deja de valer: es el punto');
    } finally { close(); }
});

/* ── Caducidad ───────────────────────────────────────────────────────────── */

test('la inactividad cierra la sesión, y borra la fila', async () => {
    const { env, token, close } = await conSesion();
    try {
        const r = await verifySession(env, token, { now: T0 + IDLE_TTL_MS });
        assert.equal(r.ok, false);
        assert.equal(r.ok === false && r.reason, 'expired');
        assert.equal(await filas(env.DB), 0, 'una sesión caducada no puede quedarse en la tabla');
    } finally { close(); }
});

test('la inactividad es DESLIZANTE: usarla cada diez días la mantiene viva', async () => {
    // Diez días y no una semana, y la razón importa: la ventana de inactividad
    // son catorce días, así que con visitas de diez días una sesión SIN
    // deslizamiento moriría en la segunda. Y no se puede alargar mucho más allá,
    // porque a los treinta días manda el límite absoluto — que es el test de
    // abajo. La primera versión de este test recorría trece semanas y se puso en
    // rojo en la quinta por el límite absoluto: medía otra cosa.
    const { env, token, close } = await conSesion();
    try {
        let actual = token;
        for (const dia of [10, 20, 28]) {
            const r = await verifySession(env, actual, { now: T0 + dia * 24 * 60 * 60 * 1000 });
            assert.equal(r.ok, true, `la sesión murió el día ${dia}, dentro del límite absoluto`);
            if (r.ok && r.newToken) actual = r.newToken;
        }
    } finally { close(); }
});

test('pero la vida ABSOLUTA no se desliza: a los 30 días se vuelve a autenticar', async () => {
    // Es lo que impide que una sesión viva para siempre solo por usarse. Se mide
    // desde `created_at`, no desde `expires_at`, y por eso no basta con mirar
    // una columna.
    const { env, token, close } = await conSesion();
    try {
        let actual = token;
        let muerta = false;
        for (let semana = 1; semana <= 6 && !muerta; semana++) {
            const r = await verifySession(env, actual, { now: T0 + semana * 7 * 24 * 60 * 60 * 1000 });
            if (!r.ok) { muerta = true; assert.equal(r.reason, 'expired'); }
            else if (r.newToken) actual = r.newToken;
        }
        assert.ok(muerta, `una sesión sobrevivió más de ${ABSOLUTE_TTL_MS / 86400000} días de uso continuo`);
    } finally { close(); }
});

test('el barrido se lleva lo caducado y NO lo vivo', async () => {
    const { db, env, close } = await conSesion();
    try {
        await openSession(env, { userId: 'u_ana', credentialId: 'c_ana', ip: null, now: T0 - IDLE_TTL_MS * 2 });
        assert.equal(await filas(db), 2);
        await sweepExpired(env, T0);
        assert.equal(await filas(db), 1, 'el barrido se llevó la sesión viva, o no se llevó la muerta');
    } finally { close(); }
});

/* ── Cerrar sesión ───────────────────────────────────────────────────────── */

test('cerrar sesión BORRA la fila, no la marca', async () => {
    // Una sesión «cerrada» que sigue en la tabla es una fila que alguien puede
    // volver a poner viva con un UPDATE.
    const { env, token, close } = await conSesion();
    try {
        await closeSession(env, token);
        assert.equal(await filas(env.DB), 0);
        assert.equal((await verifySession(env, token, { now: T0 + 1 })).ok, false);
    } finally { close(); }
});

test('cerrar en TODOS los dispositivos es inmediato, no en 60 segundos', async () => {
    // Lo es porque las sesiones viven en D1 y no en KV. KV propaga hasta un
    // minuto, y eso convertiría esta promesa en una mentira durante justo el
    // minuto que importa.
    const { env, token, close } = await conSesion();
    try {
        const otro = await openSession(env, { userId: 'u_ana', credentialId: 'c_ana', ip: null, now: T0 });
        assert.equal(await filas(env.DB), 2);

        assert.equal(await openUserScope(env, 'u_ana').revokeAllSessions(), 2);
        assert.equal((await verifySession(env, token, { now: T0 + 1 })).ok, false);
        assert.equal((await verifySession(env, otro.token, { now: T0 + 1 })).ok, false);
    } finally { close(); }
});

/* ── La tubería: cookie y 401 ────────────────────────────────────────────── */

/** Manda una petición por la tubería completa, con cookie opcional. */
function llamar(ruta, { method = 'GET', env, token } = {}) {
    /** @type {Record<string,string>} */ const headers = {};
    if (token) headers.Cookie = `${COOKIE_NAME}=${token}`;
    if (method !== 'GET') { headers.Origin = ORIGEN; headers['Content-Type'] = 'application/json'; }
    const request = new Request(`${ORIGEN}${ruta}`, {
        method, headers, body: method === 'GET' ? undefined : '{}'
    });
    /** @type {*} */ const ctx = {
        request, env, params: {}, data: {}, waitUntil: () => {},
        next: () => enrutador({ ...ctx, request })
    };
    return middleware(ctx);
}

test('una ruta con auth SIN cookie es 401, no 404 ni 500', async () => {
    const { env, close } = await conSesion(Date.now());
    try {
        const r = await llamar('/api/session', { env });
        assert.equal(r.status, 401);
        assert.equal(JSON.parse(await r.text()).error, 'auth.required');
    } finally { close(); }
});

test('con cookie válida, /api/session dice quién eres y nada más', async () => {
    const { env, token, close } = await conSesion(Date.now());
    try {
        const r = await llamar('/api/session', { env, token });
        assert.equal(r.status, 200);
        assert.deepEqual(JSON.parse(await r.text()), {
            authenticated: true, userId: 'u_ana', protected: false, credentials: 1, sessions: 1
        });
    } finally { close(); }
});

test('cuando el token rota, la cookie NUEVA sale en la respuesta', async () => {
    // Tiene que ponerla el middleware: si la pusiera el manejador, cada uno
    // tendría que acordarse, y el que se olvidara dejaría al usuario con un
    // token que va a caducar sin renovarse.
    const { env, token, close } = await conSesion(Date.now());
    try {
        // Se envejece la sesión para forzar la rotación.
        await env.DB.prepare('UPDATE sessions SET created_at = ?1, last_seen_at = ?1')
            .bind(Date.now() - ROTATE_AFTER_MS - 1000).run();

        const r = await llamar('/api/session', { env, token });
        assert.equal(r.status, 200);
        const cookie = r.headers.get('Set-Cookie') ?? '';
        assert.match(cookie, new RegExp(`^${COOKIE_NAME}=`));
        const nuevo = cookie.slice(cookie.indexOf('=') + 1).split(';')[0];
        assert.notEqual(nuevo, token, 'salió la cookie vieja');
    } finally { close(); }
});

test('una cookie muerta se BORRA en la respuesta', async () => {
    // Dejarla puesta haría que cada petición volviera a buscarla, y en el caso
    // de reuso a revocar una familia que ya no existe.
    const { env, token, close } = await conSesion(Date.now());
    try {
        await closeSession(env, token);
        const r = await llamar('/api/session', { env, token });
        assert.equal(r.status, 401);
        assert.equal(r.headers.get('Set-Cookie'), clearCookie());
    } finally { close(); }
});

test('el logout escribe SU cookie, y el middleware no se la pisa', async () => {
    const { env, token, close } = await conSesion(Date.now());
    try {
        // Sesión vieja: el middleware querría rotar y poner una cookie nueva.
        await env.DB.prepare('UPDATE sessions SET created_at = ?1, last_seen_at = ?1')
            .bind(Date.now() - ROTATE_AFTER_MS - 1000).run();

        const r = await llamar('/api/auth/logout', { method: 'POST', env, token });
        assert.equal(r.status, 200);
        assert.equal(r.headers.get('Set-Cookie'), clearCookie(),
            'el middleware pisó la cookie de cierre y el usuario se quedó dentro');
        assert.equal(await filas(env.DB), 0);
    } finally { close(); }
});

test('readCookie no se deja engañar por un nombre parecido ni por un valor con =', async () => {
    const conAmbas = new Request(ORIGEN, {
        headers: { Cookie: `${COOKIE_NAME}_falsa=intruso; ${COOKIE_NAME}=bue=no; otra=x` }
    });
    assert.equal(readCookie(conAmbas), 'bue=no');
    assert.equal(readCookie(new Request(ORIGEN)), null);
    assert.equal(readCookie(new Request(ORIGEN, { headers: { Cookie: `${COOKIE_NAME}=` } })), null);
});

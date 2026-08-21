// @ts-check

/**
 * Registro y login, de punta a punta (M8-3b).
 *
 * Se monta la tubería real de Pages —middleware → enrutador → manejador— sobre
 * el D1 de `node:sqlite`, y las respuestas de WebAuthn son las **grabadas de
 * Chrome**. O sea: bytes auténticos entrando por la puerta auténtica.
 *
 * El origen de las peticiones es el del fixture (`http://localhost:41234`),
 * porque el `origin` y el `rpId` los deriva el servidor de la URL de la
 * petición, y esos son los que el autenticador firmó.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createD1 } from './helpers/d1-fake.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequest as enrutador } from '../functions/api/[[path]].js';
import { decode, encode } from '../functions/_lib/base64url.js';
import { sha256Bytes, CHALLENGE_TTL_MS } from '../functions/_lib/webauthn.js';
import { COOKIE_NAME } from '../functions/_lib/sessions.js';
import { MAX_CHALLENGES_PER_IP } from '../functions/_lib/db.js';

const V = JSON.parse(readFileSync(new URL('./fixtures/webauthn-vectors.json', import.meta.url), 'utf8'));
const ORIGEN = V.origin;
const RETO_REG = new Uint8Array(V.challenges.register);
const RETO_LOG = new Uint8Array(V.challenges.login);

/** Manda una petición por la tubería completa. */
function llamar(ruta, { method = 'POST', body = {}, env, headers = {} } = {}) {
    const request = new Request(`${ORIGEN}${ruta}`, {
        method,
        headers: { Origin: ORIGEN, 'Content-Type': 'application/json', ...headers },
        body: method === 'GET' ? undefined : JSON.stringify(body)
    });
    /** @type {*} */ const ctx = {
        request, env, params: {}, data: {}, waitUntil: () => {},
        next: () => enrutador({ ...ctx, request })
    };
    return middleware(ctx);
}

const cuerpo = async (/** @type {Response} */ r) => JSON.parse(await r.text());

/**
 * Comprueba el código y devuelve el cuerpo ya leído.
 *
 * Existe porque el mensaje de `assert.equal(r.status, 200, await r.text())` se
 * evalúa SIEMPRE, no solo al fallar, y deja el cuerpo consumido. Cuesta un rato
 * de diagnóstico: el error que sale es «Body is unusable» tres líneas más abajo.
 */
async function ok200(/** @type {Response} */ r) {
    const texto = await r.text();
    assert.equal(r.status, 200, texto);
    return JSON.parse(texto);
}

/** Siembra un reto con el valor grabado, para poder cerrar el flujo. */
async function sembrarReto(db, reto, purpose, { pendingUserId = null, expiresAt = Date.now() + CHALLENGE_TTL_MS } = {}) {
    await db.prepare(`INSERT INTO challenges (hash, purpose, user_id, pending_user_id, created_at, expires_at)
                      VALUES (?1, ?2, NULL, ?3, ?4, ?5)`)
        .bind(await sha256Bytes(reto), purpose, pendingUserId, Date.now(), expiresAt).run();
}

/** El cuerpo de `register/finish` con los bytes grabados. */
const CUERPO_REGISTRO = {
    id: V.registro.id,
    clientDataJSON: V.registro.clientDataJSON,
    authenticatorData: V.registro.authenticatorData,
    publicKeySpki: V.registro.publicKeySpki,
    algorithm: V.registro.algorithm
};

/** El cuerpo de `login/finish` con los bytes grabados. */
const CUERPO_LOGIN = {
    id: V.login.id,
    clientDataJSON: V.login.clientDataJSON,
    authenticatorData: V.login.authenticatorData,
    signature: V.login.signature
};

/** Registra la credencial grabada y devuelve el id de cuenta. */
async function registrar(db) {
    await sembrarReto(db, RETO_REG, 'register', { pendingUserId: 'u_prueba' });
    const r = await llamar('/api/auth/register/finish', { body: CUERPO_REGISTRO, env: { DB: db } });
    // El cuerpo se lee de una copia: quien llama todavía quiere las cabeceras Y
    // el cuerpo del original.
    assert.equal(r.status, 200, await r.clone().text());
    return r;
}

/* ── El registro no pide NADA ────────────────────────────────────────────── */

test('register/start no pide ni un dato, y ofrece credenciales descubribles', async () => {
    const { db, close } = createD1();
    try {
        const r = await llamar('/api/auth/register/start', { env: { DB: db } });
        assert.equal(r.status, 200);
        const o = await cuerpo(r);

        assert.equal(o.authenticatorSelection.residentKey, 'required',
            'sin credencial descubrible el login necesitaría un campo «usuario»');
        assert.deepEqual(o.pubKeyCredParams, [{ type: 'public-key', alg: -7 }]);
        assert.equal(o.attestation, 'none');
        assert.equal(o.rp.id, 'localhost', 'el rpId sale de la URL de la petición');

        // Ni el nombre ni el displayName pueden llevar nada de la persona: no lo
        // sabemos, y no queremos saberlo.
        assert.equal(o.user.name, 'TransformLab');
        assert.equal(o.user.displayName, 'TransformLab');
        assert.match(o.user.id, /^u_/);

        // Y el reto ha quedado guardado por su HASH, con el id de cuenta
        // pendiente. Guardarlo en claro permitiría responder a un reto en vuelo
        // a quien pudiera leer la tabla.
        const fila = /** @type {*} */ (await db.prepare('SELECT * FROM challenges').first());
        assert.equal(fila.purpose, 'register');
        assert.equal(fila.pending_user_id, o.user.id);
        assert.notEqual(encode(fila.hash), o.challenge, 'el reto se guardó en claro');
        assert.equal(encode(await sha256Bytes(/** @type {Uint8Array} */ (decode(o.challenge)))), encode(fila.hash));
    } finally { close(); }
});

test('dos registros seguidos dan retos DISTINTOS', async () => {
    const { db, close } = createD1();
    try {
        const a = await cuerpo(await llamar('/api/auth/register/start', { env: { DB: db } }));
        const b = await cuerpo(await llamar('/api/auth/register/start', { env: { DB: db } }));
        assert.notEqual(a.challenge, b.challenge);
        assert.notEqual(a.user.id, b.user.id);
    } finally { close(); }
});

/* ── El registro, con los bytes de Chrome ────────────────────────────────── */

test('register/finish crea la cuenta, guarda la clave y abre sesión', async () => {
    const { db, close } = createD1();
    try {
        const r = await registrar(db);
        assert.deepEqual(await cuerpo(r), { userId: 'u_prueba', protected: false });

        const usuario = /** @type {*} */ (await db.prepare('SELECT * FROM users').first());
        assert.equal(usuario.id, 'u_prueba');
        assert.equal(usuario.protected_at, null, 'la cuenta nace SIN vía de vuelta: es la regla dura');

        const cred = /** @type {*} */ (await db.prepare('SELECT * FROM credentials').first());
        assert.equal(cred.id, V.registro.id);
        assert.equal(cred.user_id, 'u_prueba');
        assert.equal(cred.algorithm, -7);
        assert.deepEqual([...cred.public_key], [...(/** @type {Uint8Array} */ (decode(V.registro.publicKeySpki)))]);

        const sesion = /** @type {*} */ (await db.prepare('SELECT * FROM sessions').first());
        assert.equal(sesion.user_id, 'u_prueba');
        assert.equal(sesion.credential_id, V.registro.id);
    } finally { close(); }
});

test('la cookie de sesión lleva TODOS los atributos que la protegen', async () => {
    const { db, close } = createD1();
    try {
        const cookie = (await registrar(db)).headers.get('Set-Cookie') ?? '';
        assert.match(cookie, new RegExp(`^${COOKIE_NAME}=`));
        // El prefijo `__Host-` hace que el navegador RECHACE la cookie si lleva
        // Domain=, si no lleva Secure o si el Path no es «/». Es lo que cierra
        // la fijación de sesión desde un subdominio comprometido.
        assert.match(COOKIE_NAME, /^__Host-/);
        assert.match(cookie, /HttpOnly/, 'sin HttpOnly, un XSS se lleva la sesión');
        assert.match(cookie, /Secure/);
        assert.match(cookie, /SameSite=Strict/, 'es la capa fuerte contra CSRF');
        assert.match(cookie, /Path=\//);
        assert.doesNotMatch(cookie, /Domain=/, '__Host- prohíbe Domain, y el navegador tiraría la cookie');
        assert.match(cookie, /Max-Age=\d+/);
        // `Expires` es una fecha absoluta que el navegador compara con SU reloj,
        // y los relojes de los móviles están mal.
        assert.doesNotMatch(cookie, /Expires=/);
    } finally { close(); }
});

test('el token de la cookie NO está en la base: solo su hash', async () => {
    const { db, close } = createD1();
    try {
        const cookie = (await registrar(db)).headers.get('Set-Cookie') ?? '';
        const token = cookie.slice(cookie.indexOf('=') + 1).split(';')[0];
        assert.ok(token.length > 40);

        const sesion = /** @type {*} */ (await db.prepare('SELECT token_hash FROM sessions').first());
        assert.ok(sesion.token_hash instanceof Uint8Array);
        assert.equal(encode(sesion.token_hash),
            encode(await sha256Bytes(/** @type {Uint8Array} */ (decode(token)))));
        // Un volcado de la tabla de sesiones no puede permitir entrar en ninguna
        // cuenta.
        assert.notEqual(encode(sesion.token_hash), token);
    } finally { close(); }
});

/* ── El reto es de un solo uso, de verdad ────────────────────────────────── */

test('el mismo registro NO se puede repetir: el reto se gasta', async () => {
    const { db, close } = createD1();
    try {
        await registrar(db);
        // El segundo intento ya no encuentra el reto.
        const r = await llamar('/api/auth/register/finish', { body: CUERPO_REGISTRO, env: { DB: db } });
        assert.equal(r.status, 400);
        assert.equal((await cuerpo(r)).error, 'challenge.invalid');
        assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM users').first('n'), 1);
    } finally { close(); }
});

test('un reto CADUCADO no vale', async () => {
    const { db, close } = createD1();
    try {
        await sembrarReto(db, RETO_REG, 'register', { pendingUserId: 'u_x', expiresAt: Date.now() - 1 });
        const r = await llamar('/api/auth/register/finish', { body: CUERPO_REGISTRO, env: { DB: db } });
        assert.equal((await cuerpo(r)).error, 'challenge.invalid');
        assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM users').first('n'), 0);
    } finally { close(); }
});

test('un reto de LOGIN no sirve para registrar', async () => {
    // El propósito forma parte de la búsqueda. Sin él, un reto emitido para una
    // cosa valdría para la otra.
    const { db, close } = createD1();
    try {
        await sembrarReto(db, RETO_REG, 'login');
        const r = await llamar('/api/auth/register/finish', { body: CUERPO_REGISTRO, env: { DB: db } });
        assert.equal((await cuerpo(r)).error, 'challenge.invalid');
    } finally { close(); }
});

test('los cuatro motivos de reto inválido dan el MISMO error', async () => {
    // Desconocido, caducado, de otro propósito o ya gastado. Distinguirlos solo
    // le sirve a quien está probando la puerta.
    const errores = new Set();
    for (const preparar of [
        async (/** @type {*} */ db) => {},                                             // desconocido
        async (/** @type {*} */ db) => sembrarReto(db, RETO_REG, 'register', { expiresAt: Date.now() - 1 }),
        async (/** @type {*} */ db) => sembrarReto(db, RETO_REG, 'login'),
        async (/** @type {*} */ db) => { await sembrarReto(db, RETO_REG, 'register', { pendingUserId: 'u' }); await registrarSilencioso(db); }
    ]) {
        const { db, close } = createD1();
        try {
            await preparar(db);
            const r = await llamar('/api/auth/register/finish', { body: CUERPO_REGISTRO, env: { DB: db } });
            errores.add((await cuerpo(r)).error);
        } finally { close(); }
    }
    assert.deepEqual([...errores], ['challenge.invalid']);
});

async function registrarSilencioso(db) {
    await llamar('/api/auth/register/finish', { body: CUERPO_REGISTRO, env: { DB: db } });
}

/* ── El login ────────────────────────────────────────────────────────────── */

test('login/start no enumera nada: allowCredentials VACÍO', async () => {
    const { db, close } = createD1();
    try {
        const o = await cuerpo(await llamar('/api/auth/login/start', { env: { DB: db } }));
        assert.deepEqual(o.allowCredentials, [],
            'rellenarlo obligaría a preguntar antes quién eres, y el servidor tendría que decir si esa cuenta existe');
        assert.equal(o.rpId, 'localhost');
        assert.ok(o.challenge);
    } finally { close(); }
});

test('login/finish con la firma real abre sesión y adelanta el contador', async () => {
    const { db, close } = createD1();
    try {
        await registrar(db);
        const antes = await db.prepare('SELECT sign_count FROM credentials').first('sign_count');

        await sembrarReto(db, RETO_LOG, 'login');
        const r = await llamar('/api/auth/login/finish', { body: CUERPO_LOGIN, env: { DB: db } });
        assert.deepEqual(await ok200(r), { userId: 'u_prueba', protected: false });
        assert.match(r.headers.get('Set-Cookie') ?? '', new RegExp(`^${COOKIE_NAME}=`));

        const despues = await db.prepare('SELECT sign_count FROM credentials').first('sign_count');
        assert.ok(/** @type {number} */ (despues) > /** @type {number} */ (antes),
            'sin adelantar el contador, la detección de credencial clonada no sirve de nada');
        assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM sessions').first('n'), 2);
    } finally { close(); }
});

test('una credencial DESCONOCIDA y una firma MALA dan el mismo error', async () => {
    // Distinguirlas convertiría el endpoint en un oráculo de qué credenciales
    // están registradas.
    const { db, close } = createD1();
    try {
        await registrar(db);

        await sembrarReto(db, RETO_LOG, 'login');
        const desconocida = await llamar('/api/auth/login/finish',
            { body: { ...CUERPO_LOGIN, id: 'Zm9ydW5h' }, env: { DB: db } });

        await sembrarReto(db, RETO_LOG, 'login');
        const firmaMala = await llamar('/api/auth/login/finish',
            { body: { ...CUERPO_LOGIN, signature: encode(new Uint8Array(70)) }, env: { DB: db } });

        assert.equal(desconocida.status, 401);
        assert.equal(firmaMala.status, 401);
        assert.equal((await cuerpo(desconocida)).error, 'auth.failed');
        assert.equal((await cuerpo(firmaMala)).error, 'auth.failed');
    } finally { close(); }
});

test('una respuesta de login REPRODUCIDA no vale una segunda vez', async () => {
    const { db, close } = createD1();
    try {
        await registrar(db);
        await sembrarReto(db, RETO_LOG, 'login');
        assert.equal((await llamar('/api/auth/login/finish', { body: CUERPO_LOGIN, env: { DB: db } })).status, 200);

        // Aunque alguien vuelva a sembrar el reto, el contador ya avanzó: la
        // segunda es una credencial clonada.
        await sembrarReto(db, RETO_LOG, 'login');
        const segunda = await llamar('/api/auth/login/finish', { body: CUERPO_LOGIN, env: { DB: db } });
        assert.equal(segunda.status, 401);
        assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM sessions').first('n'), 2);
    } finally { close(); }
});

/* ── Entradas malas ──────────────────────────────────────────────────────── */

test('un cuerpo basura no rompe nada: 400 y ni una fila escrita', async () => {
    const { db, close } = createD1();
    try {
        for (const body of [
            {}, { id: 'x' }, { ...CUERPO_REGISTRO, clientDataJSON: 'no+es+base64url' },
            { ...CUERPO_REGISTRO, publicKeySpki: '' }, { ...CUERPO_REGISTRO, algorithm: 'siete' },
            { ...CUERPO_REGISTRO, id: 42 }
        ]) {
            const r = await llamar('/api/auth/register/finish', { body, env: { DB: db } });
            assert.equal(r.status, 400, `pasó: ${JSON.stringify(body).slice(0, 60)}`);
        }
        assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM users').first('n'), 0);
        assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM sessions').first('n'), 0);
    } finally { close(); }
});

test('un cuerpo enorme se rechaza sin leerlo entero', async () => {
    const { db, close } = createD1();
    try {
        const r = await llamar('/api/auth/register/finish',
            { body: { ...CUERPO_REGISTRO, relleno: 'x'.repeat(20_000) }, env: { DB: db } });
        assert.equal(r.status, 400);
        assert.equal((await cuerpo(r)).error, 'body.tooLarge');
    } finally { close(); }
});

test('las rutas de auth solo aceptan POST', async () => {
    const { db, close } = createD1();
    try {
        for (const ruta of ['/api/auth/register/start', '/api/auth/login/start']) {
            const r = await llamar(ruta, { method: 'GET', env: { DB: db } });
            assert.equal(r.status, 405, `${ruta} atendió un GET`);
        }
    } finally { close(); }
});


/* ── El techo por IP ─────────────────────────────────────────────────────── */

test('auth_acotada: una IP no puede pedir retos sin fin', async () => {
    // Es la única escritura sin autenticar de toda la API, o sea la única puerta
    // por la que alguien puede hacer crecer la base sin tener cuenta. Sin techo,
    // `while true; do curl; done` llena el plan gratuito.
    const h = createD1();
    const env = /** @type {*} */ ({ DB: h.db });
    const close = h.close;
    try {
        let ultimo = 0;
        for (let i = 0; i < MAX_CHALLENGES_PER_IP + 5; i++) {
            const r = await llamar('/api/auth/register/start',
                { env, headers: { 'CF-Connecting-IP': '203.0.113.7' } });
            ultimo = r.status;
            if (i < MAX_CHALLENGES_PER_IP) {
                assert.equal(r.status, 200, `el intento ${i + 1} se rechazó dentro del techo`);
            }
        }
        assert.equal(ultimo, 429, 'no hay techo: se pueden pedir retos sin fin');

        // Y la tabla queda acotada por construcción, que es lo que se protege.
        const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM challenges').first();
        assert.equal(n.n, MAX_CHALLENGES_PER_IP);

        // Otra IP no paga el techo de la primera: un NAT no puede dejar fuera a
        // toda la red que hay detrás de otro.
        const otra = await llamar('/api/auth/register/start',
            { env, headers: { 'CF-Connecting-IP': '198.51.100.9' } });
        assert.equal(otra.status, 200, 'el techo de una IP dejó fuera a otra');
    } finally { close(); }
});

test('sin IP no se limita: agrupar a todo el mundo sería peor', async () => {
    // No todos los despliegues mandan `CF-Connecting-IP`. Inventar una clave
    // común dejaría a los usuarios legítimos fuera unos a otros.
    const h = createD1();
    const env = /** @type {*} */ ({ DB: h.db });
    const close = h.close;
    try {
        for (let i = 0; i < MAX_CHALLENGES_PER_IP + 3; i++) {
            const r = await llamar('/api/auth/register/start', { env });
            assert.equal(r.status, 200, `el intento ${i + 1} se limitó sin haber IP`);
        }
    } finally { close(); }
});

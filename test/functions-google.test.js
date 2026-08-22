// @ts-check

/**
 * Entrar con Google (M10).
 *
 * Un proveedor de identidad externo es la primera vez que esta aplicación deja
 * que alguien de fuera diga quién eres, así que lo que se prueba aquí es
 * exactamente eso: **de quién se fía y de quién no**.
 *
 * | Invariante | Lo que evita |
 * |---|---|
 * | `state_de_un_solo_uso` | que te hagan completar el inicio de sesión de OTRO y acabes en su cuenta |
 * | `aud_ajeno_no_entra` | que un `id_token` de otra aplicación de Google abra cuentas aquí |
 * | `nonce_ata_el_intento` | que un `id_token` capturado en otro sitio se reutilice |
 * | `pkce_viaja` | que un código interceptado sirva sin el verificador |
 * | `misma_identidad_misma_cuenta` | que cada entrada cree una cuenta nueva y los datos se dispersen |
 * | `sin_secreto_no_rompe` | que una integración sin configurar tumbe la aplicación entera |
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1-fake.js';
import { createR2 } from './helpers/r2-fake.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequest as enrutador } from '../functions/api/[[path]].js';
import { COOKIE_NAME } from '../functions/_lib/sessions.js';
import { readIdToken, authorizeUrl, codeChallenge } from '../functions/_lib/google.js';

const ORIGEN = 'https://motifyer.com';
const CLIENT_ID = '525723957048-q018dbh80p3k9d0imiruntkqgrqk20qm.apps.googleusercontent.com';

/** Un `id_token` como el que devuelve Google. Sin firmar: no se verifica. */
function idToken(claims) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    return `${b64({ alg: 'RS256' })}.${b64(claims)}.firma-que-no-se-mira`;
}

const claimsBuenos = (nonce, extra = {}) => ({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '109876543210987654321',
    nonce,
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...extra
});

/** Un entorno con la base, el bucket y el cliente de Google configurado. */
function entorno({ conSecreto = true, respuestaDeGoogle = null } = {}) {
    const d1 = createD1();
    const env = /** @type {*} */ ({
        DB: d1.db,
        PHOTOS: createR2().bucket,
        GOOGLE_CLIENT_ID: CLIENT_ID,
        GOOGLE_CLIENT_SECRET: conSecreto ? 'secreto-de-prueba' : undefined
    });

    // El canje es la ÚNICA llamada saliente del servidor. Se sustituye aquí para
    // no depender de Google, y se guarda lo que se le manda: el cuerpo de esa
    // petición es donde viaja el verificador de PKCE.
    /** @type {*[]} */ const canjes = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = /** @type {*} */ (async (url, init) => {
        canjes.push({ url: String(url), body: new URLSearchParams(init.body) });
        if (respuestaDeGoogle) return respuestaDeGoogle();
        return new Response(JSON.stringify({ id_token: idToken(claimsBuenos(ultimoNonce)) }));
    });

    /** @type {string} */ let ultimoNonce = '';
    return {
        env, db: d1.db, canjes,
        setNonce: (n) => { ultimoNonce = n; },
        close: () => { globalThis.fetch = originalFetch; d1.close(); }
    };
}

/** @param {string} ruta */
function llamar(ruta, { env, cookie } = {}) {
    /** @type {Record<string,string>} */ const headers = {};
    if (cookie) headers.Cookie = cookie;
    const request = new Request(`${ORIGEN}${ruta}`, { method: 'GET', headers, redirect: 'manual' });
    /** @type {*} */ const ctx = {
        request, env, params: {}, data: {}, waitUntil: () => {},
        next: () => enrutador({ ...ctx, request })
    };
    return middleware(ctx);
}

/** Arranca el flujo y devuelve el `state` y el `nonce` que se mandaron a Google. */
async function arrancar(env) {
    const r = await llamar('/api/auth/google/start', { env });
    assert.equal(r.status, 302, await r.text());
    const destino = new URL(/** @type {string} */ (r.headers.get('Location')));
    return {
        destino,
        state: /** @type {string} */ (destino.searchParams.get('state')),
        nonce: /** @type {string} */ (destino.searchParams.get('nonce'))
    };
}

/* ── La ida ──────────────────────────────────────────────────────────────── */

test('el arranque manda a Google con lo justo, y con PKCE', async () => {
    const h = entorno();
    try {
        const { destino } = await arrancar(h.env);
        assert.equal(destino.origin + destino.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
        assert.equal(destino.searchParams.get('client_id'), CLIENT_ID);
        assert.equal(destino.searchParams.get('redirect_uri'), `${ORIGEN}/api/auth/google/callback`);
        assert.equal(destino.searchParams.get('response_type'), 'code');

        // SOLO `openid`. Ni correo, ni perfil: Google dice quién eres y nada más,
        // y así esta base no gana un dato personal que hoy no tiene.
        assert.equal(destino.searchParams.get('scope'), 'openid');

        assert.equal(destino.searchParams.get('code_challenge_method'), 'S256');
        assert.match(/** @type {string} */ (destino.searchParams.get('code_challenge')), /^[A-Za-z0-9_-]{43}$/);
        // Con una sola sesión de Google abierta, sin esto se entra sin ver nada
        // — y en un ordenador compartido eso es entrar en la cuenta de otro.
        assert.equal(destino.searchParams.get('prompt'), 'select_account');
    } finally { h.close(); }
});

test('el `state` no se guarda en claro en la base', async () => {
    const h = entorno();
    try {
        const { state } = await arrancar(h.env);
        const fila = /** @type {*} */ (await h.db.prepare('SELECT hash, purpose, payload FROM challenges').first());
        assert.equal(fila.purpose, 'google');
        assert.notEqual(new TextDecoder().decode(fila.hash), state);
        // Y la carga lleva el verificador y el nonce, que es lo que hace falta
        // para cerrar el flujo sin una tabla nueva.
        const carga = JSON.parse(fila.payload);
        assert.equal(typeof carga.v, 'string');
        assert.equal(typeof carga.n, 'string');
    } finally { h.close(); }
});

test('sin_secreto_no_rompe: sin configurar, se dice y lo demás sigue', async () => {
    const h = entorno();
    try {
        h.env.GOOGLE_CLIENT_ID = undefined;
        const r = await llamar('/api/auth/google/start', { env: h.env });
        assert.equal(r.status, 503);
        assert.equal((await r.json()).error, 'google.notConfigured');

        // Y la aplicación no se entera: la salud sigue respondiendo.
        assert.equal((await llamar('/api/health', { env: h.env })).status, 200);
    } finally { h.close(); }
});

/* ── La vuelta ───────────────────────────────────────────────────────────── */

test('el recorrido completo abre sesión y crea la cuenta UNA vez', async () => {
    const h = entorno();
    try {
        const { state, nonce } = await arrancar(h.env);
        h.setNonce(nonce);

        const r = await llamar(`/api/auth/google/callback?code=abc&state=${state}`, { env: h.env });
        assert.equal(r.status, 302);
        // `auth=new`: una cuenta recién creada con Google no tiene NINGUNA vía de
        // vuelta, y el cliente tiene que llevar al kit inmediatamente.
        assert.equal(r.headers.get('Location'), `${ORIGEN}/#auth=new`);
        assert.match(/** @type {string} */ (r.headers.get('Set-Cookie')), /^__Host-tl_sid=/);

        const usuarios = /** @type {*} */ (await h.db.prepare('SELECT id FROM users').all());
        assert.equal(usuarios.results.length, 1);
        const ident = /** @type {*} */ (await h.db.prepare('SELECT * FROM federated_identities').first());
        assert.equal(ident.provider, 'google');
        assert.equal(ident.subject, '109876543210987654321');
        assert.equal(ident.user_id, usuarios.results[0].id);

        // El verificador de PKCE viajó en el canje: sin él, un código
        // interceptado valdría por sí solo.
        assert.equal(h.canjes.length, 1);
        assert.match(h.canjes[0].body.get('code_verifier'), /^[A-Za-z0-9_-]{64}$/);
        assert.equal(h.canjes[0].body.get('client_secret'), 'secreto-de-prueba');
    } finally { h.close(); }
});

test('misma_identidad_misma_cuenta: entrar dos veces NO duplica la cuenta', async () => {
    // Sin esto, cada entrada crearía una cuenta nueva y los datos de alguien se
    // repartirían entre cuentas que no se ven entre sí.
    const h = entorno();
    try {
        for (let i = 0; i < 3; i++) {
            const { state, nonce } = await arrancar(h.env);
            h.setNonce(nonce);
            const r = await llamar(`/api/auth/google/callback?code=abc&state=${state}`, { env: h.env });
            assert.equal(r.status, 302);
            assert.equal(r.headers.get('Location'), `${ORIGEN}/#auth=${i === 0 ? 'new' : 'ok'}`);
        }
        const n = /** @type {*} */ (await h.db.prepare('SELECT COUNT(*) AS n FROM users').first());
        assert.equal(n.n, 1, 'cada entrada creó una cuenta nueva');
    } finally { h.close(); }
});

test('state_de_un_solo_uso: el mismo `state` no vale dos veces', async () => {
    const h = entorno();
    try {
        const { state, nonce } = await arrancar(h.env);
        h.setNonce(nonce);
        const primera = await llamar(`/api/auth/google/callback?code=abc&state=${state}`, { env: h.env });
        assert.equal(primera.headers.get('Location'), `${ORIGEN}/#auth=new`);

        const segunda = await llamar(`/api/auth/google/callback?code=abc&state=${state}`, { env: h.env });
        assert.equal(segunda.headers.get('Location'), `${ORIGEN}/#auth=error&code=google.badState`);
        assert.equal(segunda.headers.get('Set-Cookie'), null, 'una repetición abrió sesión');
    } finally { h.close(); }
});

test('un `state` inventado no abre nada', async () => {
    const h = entorno();
    try {
        const r = await llamar('/api/auth/google/callback?code=abc&state=inventado', { env: h.env });
        assert.equal(r.headers.get('Location'), `${ORIGEN}/#auth=error&code=google.badState`);
        // Y no se llegó ni a hablar con Google: el reto se comprueba ANTES de
        // gastar una petición saliente.
        assert.equal(h.canjes.length, 0);
        const n = /** @type {*} */ (await h.db.prepare('SELECT COUNT(*) AS n FROM users').first());
        assert.equal(n.n, 0);
    } finally { h.close(); }
});

test('cancelar en Google vuelve a la aplicación, sin ruido', async () => {
    const h = entorno();
    try {
        const r = await llamar('/api/auth/google/callback?error=access_denied&state=x', { env: h.env });
        assert.equal(r.headers.get('Location'), `${ORIGEN}/#auth=cancel`);
    } finally { h.close(); }
});

test('si Google no contesta, se dice y no se crea nada', async () => {
    const h = entorno({ respuestaDeGoogle: () => new Response('nope', { status: 500 }) });
    try {
        const { state, nonce } = await arrancar(h.env);
        h.setNonce(nonce);
        const r = await llamar(`/api/auth/google/callback?code=abc&state=${state}`, { env: h.env });
        assert.equal(r.headers.get('Location'), `${ORIGEN}/#auth=error&code=google.exchangeFailed`);
        const n = /** @type {*} */ (await h.db.prepare('SELECT COUNT(*) AS n FROM users').first());
        assert.equal(n.n, 0);
    } finally { h.close(); }
});

test('el error vuelve en el FRAGMENTO, que no viaja al servidor', async () => {
    // En la cadena de consulta acabaría en los registros de cualquier
    // intermediario y pegado en un enlace compartido. Tras `#` no sale del
    // navegador.
    const h = entorno();
    try {
        const r = await llamar('/api/auth/google/callback?code=abc&state=x', { env: h.env });
        const destino = /** @type {string} */ (r.headers.get('Location'));
        assert.ok(destino.includes('#auth=error'), destino);
        assert.ok(!destino.includes('?auth='), 'el resultado viaja en la consulta, no en el fragmento');
    } finally { h.close(); }
});

/* ── De quién se fía el `id_token` ───────────────────────────────────────── */

test('aud_ajeno_no_entra: un token de OTRA aplicación de Google se rechaza', () => {
    // Es el fallo que abriría la puerta de par en par: cualquiera con un cliente
    // de Google podría fabricar un token válido para SU aplicación y entrar aquí.
    const r = readIdToken({
        idToken: idToken(claimsBuenos('n1', { aud: 'otra-app.apps.googleusercontent.com' })),
        clientId: CLIENT_ID, nonce: 'n1', now: Date.now()
    });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'google.badAudience');
});

test('nonce_ata_el_intento: un token de otro intento no vale', () => {
    const r = readIdToken({
        idToken: idToken(claimsBuenos('el-de-otro')),
        clientId: CLIENT_ID, nonce: 'el-mio', now: Date.now()
    });
    assert.equal(r.ok === false && r.error, 'google.badNonce');
});

test('un emisor que no es Google se rechaza', () => {
    const r = readIdToken({
        idToken: idToken(claimsBuenos('n1', { iss: 'https://evil.example' })),
        clientId: CLIENT_ID, nonce: 'n1', now: Date.now()
    });
    assert.equal(r.ok === false && r.error, 'google.badIssuer');
});

test('`exp` viene en SEGUNDOS: compararlo mal deja pasar todo o nada', () => {
    const ahora = Date.now();
    // Caducado hace una hora.
    const viejo = readIdToken({
        idToken: idToken(claimsBuenos('n1', { exp: Math.floor(ahora / 1000) - 3600 })),
        clientId: CLIENT_ID, nonce: 'n1', now: ahora
    });
    assert.equal(viejo.ok === false && viejo.error, 'google.expired');

    // Y uno vigente sí pasa: sin esto, el test de arriba también pasaría con la
    // comparación al revés.
    const bueno = readIdToken({
        idToken: idToken(claimsBuenos('n1')), clientId: CLIENT_ID, nonce: 'n1', now: ahora
    });
    assert.equal(bueno.ok, true);
    assert.equal(bueno.ok === true && bueno.subject, '109876543210987654321');
});

test('los dos emisores que Google usa valen los dos', () => {
    for (const iss of ['https://accounts.google.com', 'accounts.google.com']) {
        const r = readIdToken({
            idToken: idToken(claimsBuenos('n1', { iss })),
            clientId: CLIENT_ID, nonce: 'n1', now: Date.now()
        });
        assert.equal(r.ok, true, `se rechazó el emisor ${iss}`);
    }
});

test('un token con forma imposible no revienta nada', () => {
    for (const malo of ['', 'no-es-un-jwt', 'a.b', 'a.@@@.c']) {
        const r = readIdToken({ idToken: malo, clientId: CLIENT_ID, nonce: 'n', now: Date.now() });
        assert.equal(r.ok, false, `se aceptó «${malo}»`);
    }
});

/* ── PKCE ────────────────────────────────────────────────────────────────── */

test('pkce_viaja: el reto es el SHA-256 del verificador, no el verificador', async () => {
    // Mandar el verificador en la URL sería PKCE sin PKCE: quien intercepte la
    // redirección tendría las dos mitades.
    const verifier = 'un-verificador-de-prueba-suficientemente-largo-1234';
    const challenge = await codeChallenge(verifier);
    assert.notEqual(challenge, verifier);
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);

    const url = new URL(authorizeUrl({
        clientId: CLIENT_ID, origin: ORIGEN, state: 's', nonce: 'n', challenge
    }));
    assert.equal(url.searchParams.get('code_challenge'), challenge);
    assert.ok(!url.toString().includes(verifier), 'el verificador viajó en la URL');
});

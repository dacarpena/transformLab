// @ts-check

/**
 * La cuenta y la REGLA DURA (M8-5b).
 *
 * La regla: **una cuenta no está protegida hasta que hay vía de vuelta**, y
 * hasta entonces no se sincroniza nada. Con cifrado extremo a extremo, subir
 * datos antes de eso es fabricar una pérdida irreversible: el día que se rompa
 * el único dispositivo, lo que hay en el servidor es ruido para todo el mundo,
 * nosotros incluidos.
 *
 * Vive en el SERVIDOR —`users.protected_at`, escrito dentro del SQL— y no en el
 * cliente, porque dejar la única salvaguarda de un dato irrecuperable en una
 * bandera que un `localStorage.clear()` borra no es una salvaguarda.
 *
 * Lo otro que se fija aquí: que **todo lo que la API devuelve de las llaves son
 * criptogramas**. Se puede devolver sin miedo porque el servidor no tiene
 * ninguna de las claves que los abren, y hace falta devolverlo porque un
 * dispositivo nuevo llega sin nada más que la passkey.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1-fake.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequest as enrutador } from '../functions/api/[[path]].js';
import { createAccount, addCredential, openSession, openUserScope } from '../functions/_lib/db.js';
import { COOKIE_NAME } from '../functions/_lib/sessions.js';
import { encode, decode } from '../functions/_lib/base64url.js';
import {
    generateDataKey, generateRecoveryCode, deriveRecoveryKek, deriveDeviceKek,
    wrapDataKey, unwrapDataKey, encryptBytes, decryptBytes, RECOVERY_SALT_BYTES
} from '../src/data/crypto.js';

const ORIGEN = 'https://motifyer.com';

/** Una cuenta con una passkey y una sesión abierta ahora. */
async function conCuenta({ credenciales = 1 } = {}) {
    const h = createD1();
    const env = /** @type {*} */ ({ DB: h.db });
    const ahora = Date.now();
    await createAccount(env, {
        userId: 'u_ana', credentialId: 'c_1', publicKey: new Uint8Array(91),
        algorithm: -7, signCount: 0, now: ahora
    });
    for (let i = 2; i <= credenciales; i++) {
        await addCredential(env, {
            userId: 'u_ana', credentialId: `c_${i}`, publicKey: new Uint8Array(91),
            algorithm: -7, signCount: 0, now: ahora
        });
    }
    const { token } = await openSession(env, {
        userId: 'u_ana', credentialId: 'c_1', ip: '203.0.113.7', now: ahora
    });
    return { ...h, env, token };
}

function llamar(ruta, { method = 'GET', body, env, token } = {}) {
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

const cuerpo = async (/** @type {Response} */ r) => JSON.parse(await r.text());

/** Genera un kit y devuelve lo que el cliente subiría. */
async function kitDe(/** @type {CryptoKey} */ dk) {
    const { code } = await generateRecoveryCode();
    const salt = crypto.getRandomValues(new Uint8Array(RECOVERY_SALT_BYTES));
    const kek = /** @type {CryptoKey} */ (await deriveRecoveryKek(code, salt));
    return { code, salt, wrapped: await wrapDataKey(kek, dk) };
}

/* ── La regla dura ───────────────────────────────────────────────────────── */

test('una cuenta recién creada NO está protegida', async () => {
    const { env, token, close } = await conCuenta();
    try {
        const o = await cuerpo(await llamar('/api/account', { env, token }));
        assert.equal(o.protected, false);
        assert.equal(o.hasRecoveryKit, false);
        assert.equal(o.credentials.length, 1);
    } finally { close(); }
});

test('guardar el kit la protege, y las dos cosas ocurren juntas', async () => {
    // Una cuenta marcada como protegida sin sobre guardado sería una mentira con
    // consecuencias irreversibles, por eso van en la misma sentencia.
    const { env, token, close } = await conCuenta();
    try {
        const dk = await generateDataKey();
        const kit = await kitDe(dk);

        const r = await llamar('/api/account/keys', {
            method: 'POST', env, token,
            body: { recovery: { wrapped: encode(kit.wrapped), salt: encode(kit.salt) } }
        });
        assert.equal(r.status, 200);
        assert.equal((await cuerpo(r)).protected, true);

        const o = await cuerpo(await llamar('/api/account', { env, token }));
        assert.equal(o.protected, true);
        assert.equal(o.hasRecoveryKit, true);
    } finally { close(); }
});

test('el estado de protección lo escribe el SERVIDOR, no se puede declarar', async () => {
    // No hay ningún camino para poner `protected` desde el cuerpo de la
    // petición: es una columna que solo escriben `saveRecoveryKit` y
    // `markProtectedIfMultiDevice`, las dos con su condición dentro del SQL.
    const { env, token, close } = await conCuenta();
    try {
        const r = await llamar('/api/account/keys', {
            method: 'POST', env, token,
            body: { protected: true, protected_at: 1, recovery: null }
        });
        assert.equal(r.status, 400, 'un cuerpo sin sobres tiene que rechazarse');
        assert.equal((await cuerpo(await llamar('/api/account', { env, token }))).protected, false);
    } finally { close(); }
});

test('marcar protegida por segunda passkey EXIGE que haya dos de verdad', async () => {
    const { env, close } = await conCuenta();
    try {
        const scope = openUserScope(env, 'u_ana');
        assert.equal(await scope.markProtectedIfMultiDevice(Date.now()), false, 'con una sola coló');

        await addCredential(env, {
            userId: 'u_ana', credentialId: 'c_2', publicKey: new Uint8Array(91),
            algorithm: -7, signCount: 0, now: Date.now()
        });
        assert.equal(await scope.markProtectedIfMultiDevice(Date.now()), true);
        assert.ok((await scope.user()).protected_at);

        // Y no se vuelve a escribir: la fecha de protección es la primera vez.
        const primera = (await scope.user()).protected_at;
        assert.equal(await scope.markProtectedIfMultiDevice(Date.now() + 10_000), false);
        assert.equal((await scope.user()).protected_at, primera);
    } finally { close(); }
});

/* ── Las llaves: solo criptogramas ───────────────────────────────────────── */

test('el ciclo completo: guardar el kit, perder el dispositivo, recuperar', async () => {
    // Es el recorrido que la regla dura protege. Si esto fallara, la regla
    // estaría defendiendo algo que no funciona.
    const { env, token, close } = await conCuenta();
    try {
        const dk = await generateDataKey();
        const kit = await kitDe(dk);
        const datos = await encryptBytes(dk, new TextEncoder().encode('{"weightKg":75.4}'), 'checkins/x');

        await llamar('/api/account/keys', {
            method: 'POST', env, token,
            body: { recovery: { wrapped: encode(kit.wrapped), salt: encode(kit.salt) } }
        });

        // — se pierde el dispositivo; en el nuevo solo está el papel del kit —

        const o = await cuerpo(await llamar('/api/account/keys', { env, token }));
        assert.ok(o.recovery, 'el servidor no devolvió el sobre de recuperación');
        const kek = await deriveRecoveryKek(kit.code, /** @type {Uint8Array} */ (decode(o.recovery.salt)));
        assert.ok(kek);
        const dk2 = await unwrapDataKey(kek, /** @type {Uint8Array} */ (decode(o.recovery.wrapped)));
        assert.ok(dk2, 'el kit no abrió el sobre que el servidor devolvió');
        assert.equal(
            new TextDecoder().decode(/** @type {Uint8Array} */ (await decryptBytes(dk2, datos, 'checkins/x'))),
            '{"weightKg":75.4}');
    } finally { close(); }
});

test('lo que la API devuelve de las llaves NO abre nada por sí solo', async () => {
    // El servidor guarda y devuelve bytes. Con la respuesta entera en la mano y
    // sin el código del kit, no hay forma de sacar la DK.
    const { env, token, close } = await conCuenta();
    try {
        const dk = await generateDataKey();
        const kit = await kitDe(dk);
        await llamar('/api/account/keys', {
            method: 'POST', env, token,
            body: { recovery: { wrapped: encode(kit.wrapped), salt: encode(kit.salt) } }
        });

        const texto = await (await llamar('/api/account/keys', { env, token })).text();
        // Ni el código del kit ni nada que se le parezca viajan nunca.
        assert.doesNotMatch(texto, /[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/, 'viajó algo con forma de kit');
        assert.equal(texto.includes(kit.code.slice(0, 9)), false);

        // Y el sobre, con la sal, sigue necesitando el código.
        const o = JSON.parse(texto);
        const mal = await deriveRecoveryKek('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ',
            /** @type {Uint8Array} */ (decode(o.recovery.salt)));
        assert.ok(mal);
        assert.equal(await unwrapDataKey(mal, /** @type {Uint8Array} */ (decode(o.recovery.wrapped))), null);
    } finally { close(); }
});

test('el sobre del dispositivo se guarda contra SU credencial, no otra', async () => {
    const { env, token, close } = await conCuenta({ credenciales: 2 });
    try {
        const dk = await generateDataKey();
        const kek = await deriveDeviceKek(new Uint8Array(32).fill(9));
        const wrapped = await wrapDataKey(kek, dk);

        const r = await llamar('/api/account/keys', {
            method: 'POST', env, token,
            body: { device: { credentialId: 'c_2', wrapped: encode(wrapped), prfSalt: encode(new Uint8Array(32)) } }
        });
        assert.equal(r.status, 200);

        const o = await cuerpo(await llamar('/api/account/keys', { env, token }));
        assert.deepEqual(o.devices.map((/** @type {*} */ d) => d.credentialId), ['c_2'],
            'solo se listan las credenciales que TIENEN sobre');
    } finally { close(); }
});

test('una credencial de otra cuenta no se puede tocar: 404, no un guardado en silencio', async () => {
    const { env, token, db, close } = await conCuenta();
    try {
        await createAccount(env, {
            userId: 'u_bea', credentialId: 'c_bea', publicKey: new Uint8Array(91),
            algorithm: -7, signCount: 0, now: Date.now()
        });

        const r = await llamar('/api/account/keys', {
            method: 'POST', env, token,
            body: { device: { credentialId: 'c_bea', wrapped: encode(new Uint8Array(60)), prfSalt: encode(new Uint8Array(32)) } }
        });
        assert.equal(r.status, 404);
        assert.equal((await cuerpo(r)).error, 'credential.notFound');
        assert.equal(await db.prepare("SELECT wrapped_dk FROM credentials WHERE id='c_bea'").first('wrapped_dk'), null);
    } finally { close(); }
});

test('un sobre desmesurado se rechaza: no es almacenamiento gratis', async () => {
    const { env, token, close } = await conCuenta();
    try {
        const r = await llamar('/api/account/keys', {
            method: 'POST', env, token,
            body: { recovery: { wrapped: encode(new Uint8Array(500)), salt: encode(new Uint8Array(16)) } }
        });
        assert.equal(r.status, 400);
        assert.equal((await cuerpo(r)).error, 'body.malformed');
    } finally { close(); }
});

test('cuerpos vacíos o malformados no escriben nada', async () => {
    const { env, token, close } = await conCuenta();
    try {
        for (const body of [
            {}, { recovery: {} }, { recovery: { wrapped: 'x' } },
            { recovery: { wrapped: encode(new Uint8Array(60)), salt: 'no+base64url' } },
            { device: { wrapped: encode(new Uint8Array(60)), prfSalt: encode(new Uint8Array(32)) } }
        ]) {
            const r = await llamar('/api/account/keys', { method: 'POST', env, token, body });
            assert.equal(r.status, 400, `pasó ${JSON.stringify(body).slice(0, 50)}`);
        }
        assert.equal((await cuerpo(await llamar('/api/account', { env, token }))).protected, false);
    } finally { close(); }
});

/* ── Dispositivos ────────────────────────────────────────────────────────── */

test('no se puede dar de baja la ÚLTIMA passkey, y se dice por qué', async () => {
    // Quedarse sin credenciales es quedarse fuera de la cuenta para siempre. Aquí
    // SÍ se distingue el motivo del 404: el usuario tiene que saber por qué no
    // puede, y no es información que ayude a nadie a atacar.
    const { env, token, close } = await conCuenta();
    try {
        const r = await llamar('/api/account/credentials/c_1', { method: 'DELETE', env, token });
        assert.equal(r.status, 409);
        assert.equal((await cuerpo(r)).error, 'credential.last');
        assert.equal((await cuerpo(await llamar('/api/account', { env, token }))).credentials.length, 1);
    } finally { close(); }
});

test('con dos, se puede quitar una', async () => {
    const { env, token, close } = await conCuenta({ credenciales: 2 });
    try {
        const r = await llamar('/api/account/credentials/c_2', { method: 'DELETE', env, token });
        assert.equal(r.status, 200);
        assert.equal((await cuerpo(r)).remaining, 1);
    } finally { close(); }
});

test('la passkey de otra cuenta no se puede dar de baja', async () => {
    const { env, token, db, close } = await conCuenta({ credenciales: 2 });
    try {
        await createAccount(env, {
            userId: 'u_bea', credentialId: 'c_bea', publicKey: new Uint8Array(91),
            algorithm: -7, signCount: 0, now: Date.now()
        });
        const r = await llamar('/api/account/credentials/c_bea', { method: 'DELETE', env, token });
        assert.equal(r.status, 404);
        assert.equal(await db.prepare("SELECT COUNT(*) AS n FROM credentials WHERE user_id='u_bea'").first('n'), 1);
    } finally { close(); }
});

test('/api/account dice cuál es la credencial de ESTA sesión', async () => {
    // Para no ofrecer «dar de baja» sobre la propia sin avisar de lo que
    // significa.
    const { env, token, close } = await conCuenta({ credenciales: 2 });
    try {
        const o = await cuerpo(await llamar('/api/account', { env, token }));
        const actual = o.credentials.filter((/** @type {*} */ c) => c.current);
        assert.equal(actual.length, 1);
        assert.equal(actual[0].id, 'c_1');
    } finally { close(); }
});

test('sin sesión, ninguna ruta de cuenta contesta', async () => {
    const { env, close } = await conCuenta();
    try {
        for (const [ruta, method] of [
            ['/api/account', 'GET'], ['/api/account/keys', 'GET'],
            ['/api/account/keys', 'POST'], ['/api/account/credentials/c_1', 'DELETE']
        ]) {
            const r = await llamar(/** @type {string} */ (ruta), { method, env });
            assert.equal(r.status, 401, `${method} ${ruta} contestó sin sesión`);
        }
    } finally { close(); }
});

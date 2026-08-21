// @ts-check

/**
 * El cliente de la cuenta (M8-5c).
 *
 * Lo que se puede probar sin navegador: que NADA de aquí lanza, que la regla
 * dura se respeta desde este lado, y que el kit de recuperación que se genera
 * abre de verdad el sobre que se sube. Los flujos completos de WebAuthn —crear
 * y usar una passkey— necesitan un autenticador, y van en `test/e2e/account.spec.js`
 * con el virtual de Chrome.
 *
 * La propiedad que más importa aquí es la primera: **ninguna función lanza**.
 * Cancelar el diálogo del sistema, no tener autenticador o estar sin red son
 * estados normales de una función opcional, y si lanzaran, cada llamante tendría
 * que acordarse de capturar.
 */

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installIndexedDbMock, uninstallIndexedDbMock } from './helpers/indexed-db-mock.js';
import * as account from '../src/data/account.js';
import * as keys from '../src/data/keys-db.js';
import { deriveRecoveryKek, unwrapDataKey, decryptBytes, encryptBytes, importDataKey } from '../src/data/crypto.js';

const ORIGEN = 'https://motifyer.com';

/** Lo que el «servidor» ha recibido. */
/** @type {{ url: string, body: * }[]} */ let recibido = [];
/** @type {Record<string, (body: *) => { status?: number, json: * }>} */ let rutas = {};
/** @type {*} */ let originalFetch;
/** @type {*} */ let originalLocation;

beforeEach(() => {
    recibido = [];
    rutas = {};
    keys.resetForTests();
    installIndexedDbMock();
    originalFetch = globalThis.fetch;
    originalLocation = /** @type {*} */ (globalThis).location;
    /** @type {*} */ (globalThis).location = new URL(`${ORIGEN}/`);
    globalThis.fetch = /** @type {*} */ (async (/** @type {string} */ url, /** @type {*} */ init) => {
        const body = init?.body ? JSON.parse(init.body) : null;
        recibido.push({ url, body });
        const manejador = rutas[url];
        if (!manejador) return new Response('{"error":"route.notFound"}', { status: 404 });
        const r = manejador(body);
        return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
    });
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    /** @type {*} */ (globalThis).location = originalLocation;
    keys.resetForTests();
    uninstallIndexedDbMock();
});

/* ── Sin autenticador ────────────────────────────────────────────────────── */

test('sin WebAuthn se dice que no, y no se sale a la red', async () => {
    // Ofrecer «crear cuenta» a alguien cuyo navegador no puede es una promesa
    // incumplida en el peor momento: cuando ya ha decidido confiar.
    assert.equal(account.isSupported(), false, 'en Node no hay PublicKeyCredential');

    for (const llamada of [account.register(), account.login()]) {
        const r = await llamada;
        assert.equal(r.ok, false);
        assert.equal(r.ok === false && r.error, 'account.unsupported');
    }
    assert.deepEqual(recibido, [], 'salió a la red sin poder terminar');
});

test('hasLocalPasskey dice que no cuando el navegador no sabe', async () => {
    // Proponer «entrar» y que no haya nada es peor que proponer «crear» y que ya
    // exista.
    assert.equal(await account.hasLocalPasskey(), false);
});

/* ── El kit ──────────────────────────────────────────────────────────────── */

test('el kit generado ABRE el sobre que se sube', async () => {
    // Es lo único que importa del kit: si no abriera, el usuario perdería sus
    // datos de forma irreversible y no habría a quién pedírselos.
    /** @type {*} */ let subido = null;
    rutas['/api/account/keys'] = (body) => { subido = body; return { json: { protected: true } }; };

    const raw = crypto.getRandomValues(new Uint8Array(32));
    const dk = await importDataKey(raw);
    const cifrado = await encryptBytes(dk, new TextEncoder().encode('75.4'), 'checkins/x');

    const r = await account.saveRecoveryKit({ userId: 'u_ana', rawKey: raw });
    assert.equal(r.ok, true, r.ok ? '' : r.error);
    const code = /** @type {*} */ (r).value.code;

    assert.ok(subido?.recovery?.wrapped && subido?.recovery?.salt);
    const kek = await deriveRecoveryKek(code, deB64u(subido.recovery.salt));
    assert.ok(kek);
    const recuperada = await unwrapDataKey(kek, deB64u(subido.recovery.wrapped));
    assert.ok(recuperada, 'el kit devuelto no abre el sobre subido');
    assert.equal(
        new TextDecoder().decode(/** @type {Uint8Array} */ (await decryptBytes(recuperada, cifrado, 'checkins/x'))),
        '75.4');
});

test('el código del kit NO viaja al servidor', async () => {
    // Guardarlo anularía su propósito: existe para que haya un secreto que solo
    // esté FUERA del sistema.
    rutas['/api/account/keys'] = () => ({ json: { protected: true } });
    const r = await account.saveRecoveryKit({ userId: 'u_ana', rawKey: new Uint8Array(32).fill(4) });
    assert.equal(r.ok, true);
    const code = /** @type {*} */ (r).value.code;

    const todo = JSON.stringify(recibido);
    assert.equal(todo.includes(code), false);
    assert.equal(todo.includes(code.replace(/-/g, '')), false);
    assert.equal(todo.includes(code.slice(0, 9)), false, 'viajó un trozo del código');
});

test('si el servidor rechaza el kit, no se dice que se guardó', async () => {
    rutas['/api/account/keys'] = () => ({ status: 400, json: { error: 'body.malformed' } });
    const r = await account.saveRecoveryKit({ userId: 'u_ana', rawKey: new Uint8Array(32) });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'body.malformed');
});

test('sin red, el kit no se da por bueno', async () => {
    // Sería el peor fallo posible de esta pantalla: enseñar un código, decir
    // «guardado», y que el servidor no lo tenga.
    globalThis.fetch = /** @type {*} */ (async () => { throw new TypeError('Failed to fetch'); });
    const r = await account.saveRecoveryKit({ userId: 'u_ana', rawKey: new Uint8Array(32) });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'api.offline');
});

/* ── Desbloqueo con el kit ───────────────────────────────────────────────── */

test('un kit equivocado no desbloquea, y lo dice sin ambigüedad', async () => {
    rutas['/api/account/keys'] = () => ({ json: { json: null } });
    // Primero se sube un kit real, para tener un sobre de verdad contra el que
    // probar. Un sobre inventado se rechazaría por razones equivocadas.
    /** @type {*} */ let subido = null;
    rutas['/api/account/keys'] = (body) => body
        ? (subido = body, { json: { protected: true } })
        : { json: { recovery: { wrapped: subido.recovery.wrapped, salt: subido.recovery.salt }, devices: [] } };

    await account.saveRecoveryKit({ userId: 'u_ana', rawKey: new Uint8Array(32).fill(9) });

    const r = await account.unlockWithRecoveryKit('u_ana', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'account.badRecoveryKit');
    assert.equal(await keys.get('u_ana'), null, 'guardó algo pese a fallar');
});

test('un kit con forma imposible se rechaza sin quemar un segundo de PBKDF2', async () => {
    rutas['/api/account/keys'] = () => ({ json: { recovery: { wrapped: 'AAAA', salt: 'AAAA' }, devices: [] } });
    const t = Date.now();
    const r = await account.unlockWithRecoveryKit('u_ana', 'esto no es un kit');
    assert.equal(r.ok === false && r.error, 'account.badRecoveryKit');
    assert.ok(Date.now() - t < 300, 'derivó antes de mirar si el código tenía forma');
});

test('sin kit guardado se dice ESO, no «kit incorrecto»', async () => {
    // Son dos problemas distintos con dos salidas distintas: uno se arregla
    // mirando el papel, el otro no tiene arreglo desde este dispositivo.
    rutas['/api/account/keys'] = () => ({ json: { recovery: null, devices: [] } });
    const r = await account.unlockWithRecoveryKit('u_ana', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    assert.equal(r.ok === false && r.error, 'account.noRecoveryKit');
});

/* ── Salir ───────────────────────────────────────────────────────────────── */

test('salir OLVIDA la clave del dispositivo', async () => {
    // Cerrar sesión sin borrarla haría que «salir» no significara nada: el
    // siguiente que use el dispositivo entraría con la clave puesta.
    rutas['/api/auth/logout'] = () => ({ json: { ok: true } });
    await keys.put('u_ana', await importDataKey(new Uint8Array(32).fill(1)));
    assert.ok(await keys.get('u_ana'));

    await account.logout('u_ana');
    assert.equal(await keys.get('u_ana'), null);
});

test('salir con el servidor caído TAMBIÉN olvida la clave local', async () => {
    // Lo local es lo que protege a quien tiene el dispositivo delante, y no
    // puede depender de que haya red.
    await keys.put('u_ana', await importDataKey(new Uint8Array(32).fill(1)));
    globalThis.fetch = /** @type {*} */ (async () => { throw new TypeError('Failed to fetch'); });
    await assert.doesNotReject(() => account.logout('u_ana'));
    assert.equal(await keys.get('u_ana'), null);
});

test('cerrar en todos los dispositivos también olvida la de éste', async () => {
    rutas['/api/auth/logout-all'] = () => ({ json: { ok: true, closed: 3 } });
    await keys.put('u_ana', await importDataKey(new Uint8Array(32).fill(1)));
    await account.logoutEverywhere('u_ana');
    assert.equal(await keys.get('u_ana'), null);
});

/* ── Lectura de estado ───────────────────────────────────────────────────── */

test('sin sesión, session() devuelve null en vez de romper la vista', async () => {
    rutas['/api/session'] = () => ({ status: 401, json: { error: 'auth.required' } });
    assert.equal(await account.session(), null);
    assert.equal(await account.overview(), null);
});

test('un id de credencial con caracteres raros se escapa en la ruta', async () => {
    // Los ids de WebAuthn son base64url y no traen nada raro, pero la ruta se
    // compone con interpolación y eso no puede depender de una suposición.
    rutas['/api/account/credentials/a%2Fb'] = () => ({ json: { ok: true, remaining: 1 } });
    const r = await account.removeCredential('a/b');
    assert.equal(r.ok, true);
});

/** base64url → bytes, para las comprobaciones. */
function deB64u(/** @type {string} */ texto) {
    const relleno = texto.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - texto.length % 4) % 4);
    const binario = atob(relleno);
    const out = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) out[i] = binario.charCodeAt(i);
    return out;
}

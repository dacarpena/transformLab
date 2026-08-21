// @ts-check

/**
 * La clave de datos guardada en el dispositivo (M8-5b).
 *
 * Dos propiedades, y las dos son de seguridad:
 *
 * 1. **Solo se guardan claves NO extraíbles.** Es el motivo de que esto sea
 *    IndexedDB y no `localStorage`: un `CryptoKey` con `extractable: false` se
 *    puede almacenar, recuperar y usar, pero nadie puede leer sus bytes. En
 *    `localStorage` habría que escribirla en claro y cualquier script se la
 *    lleva.
 * 2. **Sin IndexedDB, degrada.** En navegación privada de Safari puede no estar,
 *    y eso no puede tumbar la aplicación: significa que habrá que pedir la
 *    passkey en cada sesión, no que se pierda nada. §1 dice que la aplicación
 *    funciona entera sin cuenta, y eso incluye cuando la cuenta falla.
 */

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installIndexedDbMock, uninstallIndexedDbMock } from './helpers/indexed-db-mock.js';
import * as keys from '../src/data/keys-db.js';
import { generateDataKey, importDataKey, encryptBytes, decryptBytes } from '../src/data/crypto.js';

/** @type {ReturnType<typeof installIndexedDbMock>} */
let idb;

beforeEach(() => {
    keys.resetForTests();
    idb = installIndexedDbMock();
});
afterEach(() => {
    keys.resetForTests();
    uninstallIndexedDbMock();
});

const noExtraible = () => importDataKey(crypto.getRandomValues(new Uint8Array(32)));

test('la clave va y vuelve, y sigue sirviendo para descifrar', async () => {
    const dk = await noExtraible();
    assert.equal(await keys.put('u_ana', dk), true);

    const cifrado = await encryptBytes(dk, new TextEncoder().encode('75.4'));
    const vuelta = await keys.get('u_ana');
    assert.ok(vuelta);
    assert.equal(new TextDecoder().decode(/** @type {Uint8Array} */ (await decryptBytes(vuelta, cifrado))), '75.4');
});

test('una clave EXTRAÍBLE se rechaza: guardarla sería dejarla al alcance de un script', async () => {
    const extraible = await generateDataKey();
    assert.equal(extraible.extractable, true);
    await assert.rejects(() => keys.put('u_ana', extraible), /extraíble/);
    assert.equal(await keys.get('u_ana'), null, 'llegó a guardarse antes de fallar');
});

test('cada cuenta tiene la suya, y no se pisan', async () => {
    const a = await noExtraible();
    const b = await noExtraible();
    await keys.put('u_ana', a);
    await keys.put('u_bea', b);

    // Se distinguen por lo único observable: qué descifra cada una.
    const deAna = await encryptBytes(a, new TextEncoder().encode('ana'));
    assert.equal(await decryptBytes(/** @type {CryptoKey} */ (await keys.get('u_bea')), deAna), null);
    assert.ok(await decryptBytes(/** @type {CryptoKey} */ (await keys.get('u_ana')), deAna));
});

test('una cuenta sin clave devuelve null, no undefined ni un error', async () => {
    assert.equal(await keys.get('u_nadie'), null);
});

test('cerrar sesión OLVIDA la clave', async () => {
    // Dejarla después de salir es dejar la puerta abierta al siguiente que use
    // el dispositivo.
    await keys.put('u_ana', await noExtraible());
    await keys.remove('u_ana');
    assert.equal(await keys.get('u_ana'), null);
});

test('clear() las borra todas', async () => {
    await keys.put('u_ana', await noExtraible());
    await keys.put('u_bea', await noExtraible());
    await keys.clear();
    assert.equal(await keys.get('u_ana'), null);
    assert.equal(await keys.get('u_bea'), null);
});

test('sin IndexedDB no se rompe nada: se degrada', async () => {
    uninstallIndexedDbMock();
    keys.resetForTests();

    assert.equal(await keys.put('u_ana', await noExtraible()), false,
        'tiene que DECIR que no se guardó, no fingir que sí');
    assert.equal(await keys.get('u_ana'), null);
    await assert.doesNotReject(() => keys.remove('u_ana'));
    await assert.doesNotReject(() => keys.clear());

    idb = installIndexedDbMock();
});

test('un fallo de escritura se traga y se informa, no revienta la sesión', async () => {
    // La primera escritura ABRE la base; `failNextWrite` solo marca las que ya
    // existen. Sin esta línea el test pasaba con y sin el `try/catch`, que es
    // exactamente un test que no prueba nada.
    await keys.put('u_previa', await noExtraible());

    idb.failNextWrite();
    assert.equal(await keys.put('u_ana', await noExtraible()), false,
        'una cuota agotada tiene que DECIRSE, no fingirse');
    assert.equal(await keys.get('u_ana'), null);
    // Y lo que ya estaba guardado sigue estando: un fallo de escritura no puede
    // llevarse por delante la clave de una sesión que funcionaba.
    assert.ok(await keys.get('u_previa'));
});

test('una fila corrupta no se devuelve como si fuera una clave', async () => {
    // Otra pestaña, una versión anterior del esquema, un experimento a mano: lo
    // que salga del almacén se comprueba antes de tratarlo como CryptoKey.
    await keys.put('u_ana', await noExtraible());

    const db = idb.databases.get('tl-keys');
    assert.ok(db, 'el doble de IndexedDB no tiene la base: ¿cambió el nombre?');
    const store = db.stores.get('keys');
    assert.ok(store, 'el doble no tiene el almacén: ¿cambió el nombre?');
    for (const basura of ['no soy una clave', 42, null, {}]) {
        store.set('u_ana', { id: 'u_ana', dataKey: basura });
        assert.equal(await keys.get('u_ana'), null,
            `devolvió ${JSON.stringify(basura)} como si fuera una clave`);
    }
});

// @ts-check

/**
 * El pull, lado cliente (M9-3b).
 *
 * La garantía de esta etapa es fuerte y se puede afirmar: **el pull no pisa
 * jamás un valor local**. Aplica una fila remota solo si su clave no existe
 * aquí; lo demás lo cuenta y lo devuelve, para que M9-4 lo resuelva con el reloj
 * del servidor.
 *
 * Eso hace que estrenar la sincronía no pueda costarle a nadie un dato suyo, y
 * resuelve entero el caso que importa: un dispositivo nuevo que entra con su
 * passkey y se trae todo, porque no tiene nada que pisar.
 *
 * Lo que estos tests protegen, ordenado por lo que duele:
 *
 * | Invariante | Lo que evita |
 * |---|---|
 * | `pull_no_pisa` | que sincronizar borre lo que tenías aquí |
 * | `cursor_despues` | que una escritura fallida deje filas sin pedir NUNCA más |
 * | `servidor_no_es_de_fiar` | que lo que llegue escriba sin pasar el mismo control que un backup |
 * | `aad_ata_la_fila` | que alguien baraje filas en el servidor sin romper ningún tag |
 */

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import { installIndexedDbMock, uninstallIndexedDbMock } from './helpers/indexed-db-mock.js';
import * as storage from '../src/data/storage.js';
import * as keysDb from '../src/data/keys-db.js';
import * as sync from '../src/data/sync.js';
import { importDataKey, encryptBytes } from '../src/data/crypto.js';
import { validateCollection } from '../src/data/schema.js';
import { SCHEMA_VERSION } from '../src/data/version.js';
import { NO_PROFILE } from '../src/data/ids.js';

const ORIGEN = 'https://motifyer.com';
const USER = 'u_ana';
const PERFIL = 'op4co1234567890abcdefg';

/** @type {{ url: string }[]} */ let peticiones = [];
/** @type {(url: string) => { status?: number, json: * }} */ let responder;
/** @type {*} */ let originales;
/** @type {CryptoKey} */ let dk;

beforeEach(async () => {
    peticiones = [];
    responder = () => ({ json: { rows: [], nextSince: 0, hasMore: false, lastSeq: 0 } });
    installLocalStorageMock();
    keysDb.resetForTests();
    installIndexedDbMock();
    storage.setActiveProfile(NO_PROFILE);

    originales = { fetch: globalThis.fetch, location: /** @type {*} */ (globalThis).location };
    /** @type {*} */ (globalThis).location = new URL(`${ORIGEN}/`);
    globalThis.fetch = /** @type {*} */ (async (/** @type {string} */ url) => {
        peticiones.push({ url });
        const r = responder(url);
        return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
    });

    dk = await importDataKey(new Uint8Array(32).fill(7));
    await keysDb.put(USER, dk);
});

afterEach(() => {
    globalThis.fetch = originales.fetch;
    /** @type {*} */ (globalThis).location = originales.location;
    keysDb.resetForTests();
    uninstallIndexedDbMock();
});

/** Un check-in con su fecha. */
const checkin = (/** @type {string} */ dateISO, /** @type {number} */ peso = 88) => ({
    id: `ci_${dateISO}`, dateISO, weightKg: peso, fatPct: null, scaleMuscleKg: null,
    boneKg: null, measuresCm: {}, subjective: {}, notes: '',
    createdAtISO: '2026-05-01T08:00:00.000Z', editedAtISO: null
});

/** Cifra una fila como lo haría el otro dispositivo. */
async function filaRemota({ collection = 'checkins', keyPath, value, seq, itemTag = null, deleted = false }) {
    const tag = itemTag ?? `tag${seq}`;
    if (deleted) {
        return { profileId: PERFIL, collection, itemTag: tag, ciphertext: null, rev: 1, seq, updatedAt: 1, deleted: true };
    }
    const claro = new TextEncoder().encode(JSON.stringify({ keyPath, value }));
    const cifrado = await encryptBytes(dk, claro, `${collection}/${tag}`);
    return {
        profileId: PERFIL, collection, itemTag: tag,
        ciphertext: b64u(cifrado), rev: 1, seq, updatedAt: 1, deleted: false
    };
}

function b64u(/** @type {Uint8Array} */ bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Lo que hay guardado en local de una colección. */
const local = (/** @type {string} */ collection) =>
    /** @type {*} */ (storage.getForProfile(PERFIL, collection).value);

/** Contesta con una sola página. */
function unaPagina(rows, { nextSince = null } = {}) {
    responder = () => ({
        json: {
            rows,
            nextSince: nextSince ?? (rows.at(-1)?.seq ?? 0),
            hasMore: false,
            lastSeq: rows.at(-1)?.seq ?? 0
        }
    });
}

/* ── Un dispositivo nuevo se lo trae todo ────────────────────────────────── */

test('un dispositivo VACÍO se trae las filas y las escribe bien', async () => {
    unaPagina([
        await filaRemota({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01', 90), seq: 1 }),
        await filaRemota({ keyPath: ['items', '2026-05-08'], value: checkin('2026-05-08', 89), seq: 2 })
    ]);

    const r = await sync.pull(USER);
    assert.equal(r.ok, true, r.error);
    assert.equal(r.applied, 2);
    assert.equal(r.conflicts, 0);
    assert.equal(r.undecryptable, 0);

    const c = local('checkins');
    assert.equal(c.items.length, 2);
    assert.deepEqual(c.items.map((/** @type {*} */ i) => i.dateISO), ['2026-05-01', '2026-05-08']);
    assert.equal(c.items[0].weightKg, 90);
    assert.ok(sync.localIsValid(PERFIL, 'checkins'), 'se escribió algo que el esquema rechaza');
});

test('lo escrito pasa por `join`, así que SIEMPRE valida', async () => {
    // `join` no devuelve nunca un valor inválido, y si no puede producir uno no
    // se escribe nada. Es lo que impide que una fusión mala degrade la colección
    // a su valor de fábrica — que el siguiente gesto del usuario persistiría.
    unaPagina([await filaRemota({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01'), seq: 1 })]);
    await sync.pull(USER);
    assert.equal(validateCollection('checkins', local('checkins')).ok, true);
    assert.equal(local('checkins').schemaVersion, SCHEMA_VERSION);
});

/* ── La garantía de la etapa ─────────────────────────────────────────────── */

test('pull_no_pisa: una fila que YA existe en local no se toca', async () => {
    // Es la garantía que hace que estrenar la sincronía no pueda costarle a
    // nadie un dato suyo. Quién gana lo decide M9-4, con el reloj del servidor.
    storage.setForProfile(PERFIL, 'checkins', {
        schemaVersion: SCHEMA_VERSION, items: [checkin('2026-05-01', 75)]
    });

    unaPagina([
        await filaRemota({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01', 99), seq: 1 }),
        await filaRemota({ keyPath: ['items', '2026-05-08'], value: checkin('2026-05-08', 88), seq: 2 })
    ]);

    const r = await sync.pull(USER);
    assert.equal(r.applied, 1, 'no se aplicó la fila nueva');
    assert.equal(r.conflicts, 1, 'no se contó el choque');

    const c = local('checkins');
    assert.equal(c.items.length, 2);
    const dia1 = c.items.find((/** @type {*} */ i) => i.dateISO === '2026-05-01');
    assert.equal(dia1.weightKg, 75, 'el pull PISÓ un valor local');
});

test('pull_no_pisa: una LÁPIDA ajena no borra nada', async () => {
    // Borrar es pisar. Un borrado que llega de otro dispositivo se cuenta y se
    // deja para M9-4: si se aplicara aquí, estrenar la sincronía podría hacer
    // desaparecer un check-in que el usuario tiene delante.
    storage.setForProfile(PERFIL, 'checkins', {
        schemaVersion: SCHEMA_VERSION, items: [checkin('2026-05-01')]
    });
    unaPagina([await filaRemota({ keyPath: ['items', '2026-05-01'], value: null, seq: 1, deleted: true })]);

    const r = await sync.pull(USER);
    assert.equal(r.applied, 0);
    assert.equal(r.conflicts, 1);
    assert.equal(local('checkins').items.length, 1, 'una lápida ajena borró un dato local');
});

test('las filas remotas van DETRÁS: lo local no cambia de sitio', async () => {
    storage.setForProfile(PERFIL, 'checkins', {
        schemaVersion: SCHEMA_VERSION, items: [checkin('2026-05-10'), checkin('2026-05-03')]
    });
    unaPagina([await filaRemota({ keyPath: ['items', '2026-05-20'], value: checkin('2026-05-20'), seq: 1 })]);
    await sync.pull(USER);

    assert.deepEqual(
        local('checkins').items.map((/** @type {*} */ i) => i.dateISO),
        ['2026-05-10', '2026-05-03', '2026-05-20'],
        'el pull reordenó la lista del usuario');
});

/* ── El cursor ───────────────────────────────────────────────────────────── */

test('cursor_despues: el cursor se guarda TRAS aplicar, y no retrocede', async () => {
    // Guardarlo antes y fallar la escritura dejaría esas filas sin pedir jamás.
    assert.equal(sync.readCursor(USER), 0);
    unaPagina([await filaRemota({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01'), seq: 7 })]);

    const r = await sync.pull(USER);
    assert.equal(r.cursor, 7);
    assert.equal(sync.readCursor(USER), 7, 'el cursor no se persistió');

    // Un pull sin novedades no lo mueve.
    unaPagina([], { nextSince: 7 });
    await sync.pull(USER);
    assert.equal(sync.readCursor(USER), 7);
});

test('cursor_despues: si la escritura FALLA, el cursor NO avanza', async () => {
    // Aquí es donde el orden importa de verdad. Con el cursor guardado antes de
    // aplicar, una escritura fallida —cuota llena— dejaría esas filas apuntadas
    // como vistas y NUNCA se volverían a pedir: pérdida definitiva y muda.
    const mock = installLocalStorageMock();
    keysDb.resetForTests();
    await keysDb.put(USER, dk);
    storage.setActiveProfile(NO_PROFILE);

    unaPagina([await filaRemota({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01'), seq: 9 })]);

    // Se deja escribir el cursor, pero no la colección.
    const setItem = mock.setItem.bind(mock);
    mock.setItem = (/** @type {string} */ k, /** @type {string} */ v) => {
        if (k.endsWith('.checkins')) throw new Error('QuotaExceededError');
        return setItem(k, v);
    };
    const r = await sync.pull(USER);
    mock.setItem = setItem;

    assert.equal(r.applied, 0, 'dijo haber aplicado algo que no se escribió');
    assert.equal(sync.readCursor(USER), 0,
        'el cursor avanzó sobre filas que no llegaron a escribirse');
});

test('el cursor viaja en la petición: no se vuelve a bajar lo ya visto', async () => {
    storage.setRaw(sync.cursorKey(USER), '42');
    unaPagina([], { nextSince: 42 });
    await sync.pull(USER);
    assert.ok(peticiones[0].url.includes('since=42'), `pidió ${peticiones[0].url}`);
});

test('un cursor corrupto se trata como 0, no como basura', async () => {
    // Volver a bajarlo todo es lento; saltarse filas es perder datos.
    for (const basura of ['abc', '-3', 'NaN', '{}', '']) {
        storage.setRaw(sync.cursorKey(USER), basura);
        assert.equal(sync.readCursor(USER), 0, `aceptó «${basura}»`);
    }
});

test('con varias páginas se encadenan, y el cursor acaba en la última', async () => {
    const p1 = [await filaRemota({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01'), seq: 1 })];
    const p2 = [await filaRemota({ keyPath: ['items', '2026-05-08'], value: checkin('2026-05-08'), seq: 2 })];
    responder = (url) => (url.includes('since=0')
        ? { json: { rows: p1, nextSince: 1, hasMore: true, lastSeq: 2 } }
        : { json: { rows: p2, nextSince: 2, hasMore: false, lastSeq: 2 } });

    const r = await sync.pull(USER);
    assert.equal(r.fetched, 2);
    assert.equal(r.applied, 2);
    assert.equal(r.cursor, 2);
    assert.equal(peticiones.length, 2);
    assert.equal(local('checkins').items.length, 2);
});

/* ── El servidor no es de fiar ───────────────────────────────────────────── */

test('servidor_no_es_de_fiar: una fila con forma imposible se descarta ANTES de descifrar', async () => {
    // El servidor es un tercero. Lo que manda pasa el mismo control que un
    // backup: una colección que no existe, o un perfil con forma rara, no puede
    // acabar escribiendo en el almacén aunque su criptograma sea válido.
    const buena = await filaRemota({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01'), seq: 5 });
    unaPagina([
        { ...buena, collection: 'inventada' },
        { ...buena, collection: 'volumeLog' },      // existe, pero es LOCAL
        { ...buena, profileId: 'con.punto' },
        { ...buena, profileId: '' },
        { ...buena, itemTag: 42 },
        null,
        'no soy un objeto',
        buena
    ]);

    const r = await sync.pull(USER);
    assert.equal(r.applied, 1, 'se coló una fila con forma imposible');
    assert.equal(local('checkins').items.length, 1);
    assert.equal(storage.getForProfile('con.punto', 'checkins').ok, false);
});

test('servidor_no_es_de_fiar: una colección que este dispositivo NO sincroniza se ignora', async () => {
    // El caso peligroso de verdad, y el único que solo caza el filtro de forma:
    // una fila de `volumeLog` cifrada CORRECTAMENTE, con su propio AAD, así que
    // se abriría sin problema. `volumeLog` está marcada `local` en la política
    // —es la caché de una derivación sin consumidores—, y lo que se sincroniza
    // lo decide este dispositivo, no lo que llegue por la red.
    const claro = new TextEncoder().encode(JSON.stringify({
        keyPath: [], value: { schemaVersion: SCHEMA_VERSION, items: [] }
    }));
    const cifrado = await encryptBytes(dk, claro, 'volumeLog/tagVol');
    unaPagina([{
        profileId: PERFIL, collection: 'volumeLog', itemTag: 'tagVol',
        ciphertext: b64u(cifrado), rev: 1, seq: 1, updatedAt: 1, deleted: false
    }]);

    const r = await sync.pull(USER);
    assert.equal(r.applied, 0, 'se escribió una colección que este dispositivo no sincroniza');
    assert.equal(r.undecryptable, 0, 'se descartó por no abrir, no por el ámbito');
    assert.equal(storage.getForProfile(PERFIL, 'volumeLog').value, null);
});

test('un criptograma que no abre se CUENTA, no se traga', async () => {
    // Puede ser una fila de otra cuenta, una manipulada o un formato futuro. En
    // los tres casos hay que poder decir cuántas, en vez de fingir que todo fue
    // bien.
    const buena = await filaRemota({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01'), seq: 1 });
    unaPagina([
        buena,
        { ...buena, itemTag: 'otra', seq: 2 },                  // el AAD ya no cuadra
        { ...buena, ciphertext: 'AAAA', seq: 3 },               // basura
        { ...buena, ciphertext: 'no+es+base64url', seq: 4 }
    ]);

    const r = await sync.pull(USER);
    assert.equal(r.applied, 1);
    assert.equal(r.undecryptable, 3, 'no se contaron las filas ilegibles');
});

test('aad_ata_la_fila: una fila movida a otra colección NO descifra', async () => {
    // Sin el `additionalData`, quien pudiera escribir en el servidor barajaría
    // filas —poner el peso de enero en la de marzo— sin romper ningún tag y sin
    // que el cliente se enterase.
    const fila = await filaRemota({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01'), seq: 1 });
    unaPagina([{ ...fila, collection: 'steps' }]);

    const r = await sync.pull(USER);
    assert.equal(r.applied, 0, 'una fila movida de colección se aplicó');
    assert.equal(r.undecryptable, 1);
    assert.equal(storage.getForProfile(PERFIL, 'steps').value, null);
});

/* ── Estados normales que no son errores ─────────────────────────────────── */

test('sin la clave de datos, el pull se detiene y lo DICE', async () => {
    // Es el estado de un dispositivo que ha iniciado sesión y todavía no ha
    // desbloqueado. No es un fallo: tiene salida, y la interfaz la ofrece.
    await keysDb.remove(USER);
    const r = await sync.pull(USER);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'sync.locked');
    assert.deepEqual(peticiones, [], 'salió a la red sin poder descifrar nada');
});

test('sin red, el pull no rompe nada ni mueve el cursor', async () => {
    storage.setRaw(sync.cursorKey(USER), '5');
    globalThis.fetch = /** @type {*} */ (async () => { throw new TypeError('Failed to fetch'); });
    const r = await sync.pull(USER);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'api.offline');
    assert.equal(sync.readCursor(USER), 5, 'el cursor se movió sin haber traído nada');
});

test('una sesión caducada se reporta con su código', async () => {
    responder = () => ({ status: 401, json: { error: 'auth.required' } });
    const r = await sync.pull(USER);
    assert.equal(r.ok, false);
    assert.equal(r.error, 'auth.required');
});

test('una respuesta vacía es un pull correcto, no un error', async () => {
    const r = await sync.pull(USER);
    assert.equal(r.ok, true);
    assert.equal(r.fetched, 0);
    assert.equal(r.applied, 0);
});

/* ── Varios perfiles ─────────────────────────────────────────────────────── */

test('el pull escribe en VARIOS perfiles sin mover el activo', async () => {
    // Es exactamente el camino que causó la fuga de M7: `activeProfileId` es un
    // `let` de módulo, y cambiarlo de ida y vuelta con E/S en medio escribe en el
    // perfil equivocado. Por eso el pull usa `setForProfile`.
    storage.setActiveProfile('otro_perfil_activo');
    const otro = 'segundoPerfilOpaco12345';

    const a = await filaRemota({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01', 90), seq: 1 });
    const bClaro = new TextEncoder().encode(JSON.stringify({
        keyPath: ['items', '2026-06-01'], value: checkin('2026-06-01', 62)
    }));
    const b = {
        profileId: otro, collection: 'checkins', itemTag: 'tagB',
        ciphertext: b64u(await encryptBytes(dk, bClaro, 'checkins/tagB')),
        rev: 1, seq: 2, updatedAt: 1, deleted: false
    };
    unaPagina([a, b]);

    const r = await sync.pull(USER);
    assert.equal(r.applied, 2);
    assert.equal(storage.getActiveProfile(), 'otro_perfil_activo', 'el pull movió el perfil activo');

    assert.equal(/** @type {*} */ (storage.getForProfile(PERFIL, 'checkins').value).items[0].weightKg, 90);
    assert.equal(/** @type {*} */ (storage.getForProfile(otro, 'checkins').value).items[0].weightKg, 62);
});

test('la clave del cursor lleva la CUENTA dentro', async () => {
    // Dos cuentas en el mismo navegador no pueden compartir posición: la
    // segunda se saltaría todo lo que la primera ya vio.
    assert.notEqual(sync.cursorKey('u_ana'), sync.cursorKey('u_bea'));
    assert.ok(sync.cursorKey('u_ana').includes('u_ana'));
    // Y vive fuera del namespace de perfil: el pull trae filas de todos.
    assert.equal(sync.cursorKey('u_ana').startsWith('tl.7.'), false);
    assert.equal(sync.cursorKey('u_ana').startsWith('tl.8.'), false);
});

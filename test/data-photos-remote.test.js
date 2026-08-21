// @ts-check

/**
 * Las fotos entre este dispositivo y R2, lado cliente (M9-5).
 *
 * Dos cosas se prueban aquí, y son de naturaleza distinta.
 *
 * La primera es criptográfica: **una foto solo se abre en su sitio**. El
 * `additionalData` la ata a `photo/<perfil>/<foto>`, así que quien pudiera
 * escribir en el bucket no puede intercambiar la de enero por la de marzo sin
 * que se note. Se comprueba moviéndola a mano y viendo que no descifra.
 *
 * La segunda es de juicio: **qué se considera huérfano**. `orphans` es pura a
 * propósito, porque lo que decide es qué se borra para siempre del servidor, y
 * eso tiene que poder probarse sin red, sin claves y sin almacén.
 *
 * | Invariante | Lo que evita |
 * |---|---|
 * | `foto_atada_a_su_sitio` | que alguien baraje fotos en el bucket sin romper nada |
 * | `inventario_incompleto_no_borra` | borrar fotos vivas por leer media lista |
 * | `perfil_ajeno_no_se_juzga` | que un móvil borre las fotos de un perfil que no tiene |
 */

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installIndexedDbMock, uninstallIndexedDbMock } from './helpers/indexed-db-mock.js';
import * as keysDb from '../src/data/keys-db.js';
import * as remote from '../src/data/photos-remote.js';
import { importDataKey } from '../src/data/crypto.js';

const ORIGEN = 'https://motifyer.com';
const USER = 'u_ana';
const PERFIL = 'op4co1234567890abcdefg';

/** El bucket de mentira, indexado por la clave que compone el servidor. */
/** @type {Map<string, Uint8Array>} */ let bucket;
/** @type {{ url: string, method: string }[]} */ let peticiones;
/** @type {*} */ let originales;
/** @type {{ status: number, body?: string } | null} */ let averia;

beforeEach(async () => {
    bucket = new Map();
    peticiones = [];
    averia = null;
    keysDb.resetForTests();
    installIndexedDbMock();

    originales = { fetch: globalThis.fetch, location: /** @type {*} */ (globalThis).location };
    /** @type {*} */ (globalThis).location = new URL(`${ORIGEN}/`);
    globalThis.fetch = /** @type {*} */ (async (/** @type {string} */ ruta, /** @type {*} */ init) => {
        const u = new URL(ruta, ORIGEN);
        const method = init?.method ?? 'GET';
        peticiones.push({ url: u.pathname + u.search, method });
        if (averia) return new Response(averia.body ?? '{}', { status: averia.status });

        const foto = u.pathname.split('/').pop() ?? '';
        const perfil = u.searchParams.get('profile') ?? '';
        const clave = `${perfil}/${foto}`;

        if (u.pathname === '/api/photos') {
            return new Response(JSON.stringify({
                objects: [...bucket.entries()].map(([k, v]) => {
                    const [p, f] = k.split('/');
                    return { profileId: p, photoId: f, bytes: v.length };
                }),
                complete: true, used: 0, limit: 1000
            }));
        }
        if (method === 'PUT') {
            const bytes = new Uint8Array(init.body);
            bucket.set(clave, bytes);
            return new Response(JSON.stringify({ stored: true, bytes: bytes.length, used: bytes.length, limit: 1000 }));
        }
        if (method === 'DELETE') {
            bucket.delete(clave);
            return new Response(JSON.stringify({ deleted: true }));
        }
        const guardado = bucket.get(clave);
        if (!guardado) return new Response('{"error":"photos.notFound"}', { status: 404 });
        return new Response(guardado, { status: 200 });
    });

    await keysDb.put(USER, await importDataKey(new Uint8Array(32).fill(7)));
});

afterEach(() => {
    globalThis.fetch = originales.fetch;
    /** @type {*} */ (globalThis).location = originales.location;
    keysDb.resetForTests();
    uninstallIndexedDbMock();
});

const imagen = (/** @type {number} */ n, /** @type {number} */ len = 300) =>
    new Blob([new Uint8Array(len).fill(n)]);

/* ── La ida y vuelta ─────────────────────────────────────────────────────── */

test('una foto sube cifrada y vuelve idéntica', async () => {
    const original = imagen(0xAB, 1_000);
    const subida = await remote.upload(USER, PERFIL, 'ph_1', original);
    assert.equal(subida.ok, true, subida.ok === false ? subida.error : '');

    // Lo que hay en el bucket NO son los bytes de la foto: si lo fueran, el
    // servidor podría mirarla.
    const guardado = /** @type {Uint8Array} */ (bucket.get(`${PERFIL}/ph_1`));
    assert.notDeepEqual(guardado.subarray(13, 1_013), new Uint8Array(1_000).fill(0xAB));
    assert.ok(guardado.length > 1_000, 'no hay cabecera ni tag: eso no está cifrado');

    const bajada = await remote.download(USER, PERFIL, 'ph_1', 'image/webp');
    assert.equal(bajada.ok, true, bajada.ok === false ? bajada.error : '');
    if (!bajada.ok) return;
    assert.equal(bajada.value.type, 'image/webp', 'el tipo lo pone el puntero, no el servidor');
    assert.deepEqual(
        new Uint8Array(await bajada.value.arrayBuffer()),
        new Uint8Array(await original.arrayBuffer()));
});

test('foto_atada_a_su_sitio: movida a otra clave, NO descifra', async () => {
    await remote.upload(USER, PERFIL, 'ph_enero', imagen(1));
    await remote.upload(USER, PERFIL, 'ph_marzo', imagen(2));

    // Alguien con acceso al bucket las intercambia. El servidor no puede notarlo
    // —no sabe qué hay dentro— pero el cliente sí, y aquí está por qué.
    const enero = /** @type {Uint8Array} */ (bucket.get(`${PERFIL}/ph_enero`));
    const marzo = /** @type {Uint8Array} */ (bucket.get(`${PERFIL}/ph_marzo`));
    bucket.set(`${PERFIL}/ph_enero`, marzo);
    bucket.set(`${PERFIL}/ph_marzo`, enero);

    const r = await remote.download(USER, PERFIL, 'ph_enero');
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'photos.undecryptable');
});

test('una foto de OTRO perfil tampoco se abre en éste', async () => {
    await remote.upload(USER, PERFIL, 'ph_1', imagen(3));
    const bytes = /** @type {Uint8Array} */ (bucket.get(`${PERFIL}/ph_1`));
    bucket.set(`zz9xy1234567890abcdefg/ph_1`, bytes);

    const r = await remote.download(USER, 'zz9xy1234567890abcdefg', 'ph_1');
    assert.equal(r.ok === false && r.error, 'photos.undecryptable');
});

test('con otra clave de datos no se abre nada', async () => {
    await remote.upload(USER, PERFIL, 'ph_1', imagen(4));
    keysDb.resetForTests();
    uninstallIndexedDbMock();
    installIndexedDbMock();
    await keysDb.put(USER, await importDataKey(new Uint8Array(32).fill(9)));

    const r = await remote.download(USER, PERFIL, 'ph_1');
    assert.equal(r.ok === false && r.error, 'photos.undecryptable');
});

/* ── Sin clave y sin red ─────────────────────────────────────────────────── */

test('sin desbloquear no se sube ni se baja, y no se toca la red', async () => {
    keysDb.resetForTests();
    uninstallIndexedDbMock();
    installIndexedDbMock();

    assert.equal((await remote.upload(USER, PERFIL, 'ph_1', imagen(1))).ok, false);
    assert.equal((await remote.download(USER, PERFIL, 'ph_1')).ok, false);
    assert.equal(peticiones.length, 0, 'salió a la red sin poder cifrar ni descifrar');
});

test('un identificador imposible se rechaza AQUÍ, antes de la red', async () => {
    for (const [perfil, foto] of [['../otro', 'ph_1'], [PERFIL, 'a/b'], [PERFIL, ''], ['', 'ph_1']]) {
        assert.equal((await remote.upload(USER, perfil, foto, imagen(1))).ok, false);
        assert.equal((await remote.download(USER, perfil, foto)).ok, false);
        assert.equal((await remote.remove(perfil, foto)).ok, false);
    }
    assert.equal(peticiones.length, 0, 'una clave imposible llegó a salir del dispositivo');
});

test('el error del servidor llega con SU código', async () => {
    averia = { status: 413, body: JSON.stringify({ error: 'photos.quota' }) };
    const r = await remote.upload(USER, PERFIL, 'ph_1', imagen(1));
    assert.equal(r.ok === false && r.error, 'photos.quota');
});

/* ── Borrar ──────────────────────────────────────────────────────────────── */

test('borrar quita el objeto, y borrar dos veces sigue siendo un éxito', async () => {
    await remote.upload(USER, PERFIL, 'ph_1', imagen(1));
    assert.equal((await remote.remove(PERFIL, 'ph_1')).ok, true);
    assert.equal(bucket.size, 0);
    assert.equal((await remote.remove(PERFIL, 'ph_1')).ok, true);
});

/* ── Qué se considera huérfano ───────────────────────────────────────────── */

const inv = (/** @type {*[]} */ objects, complete = true) =>
    ({ objects, complete, used: 0, limit: 0 });

test('un objeto sin puntero es huérfano; uno con puntero, no', async () => {
    const punteros = new Map([[PERFIL, new Set(['ph_viva'])]]);
    const sobran = remote.orphans(inv([
        { profileId: PERFIL, photoId: 'ph_viva', bytes: 10 },
        { profileId: PERFIL, photoId: 'ph_huerfana', bytes: 10 }
    ]), punteros);
    assert.deepEqual(sobran.map((o) => o.photoId), ['ph_huerfana']);
});

test('inventario_incompleto_no_borra: con media lista no se borra NADA', async () => {
    // Con media lista, todo lo que no se llegó a leer parece huérfano. Es la
    // diferencia entre recoger basura y borrarle las fotos a alguien.
    const punteros = new Map([[PERFIL, new Set(['ph_viva'])]]);
    const sobran = remote.orphans(inv([
        { profileId: PERFIL, photoId: 'ph_huerfana', bytes: 10 }
    ], false), punteros);
    assert.deepEqual(sobran, []);
});

test('perfil_ajeno_no_se_juzga: un perfil que aquí no está conserva sus fotos', async () => {
    // Vive en otro móvil. Que desde aquí no se vea no es motivo para borrarlo, y
    // sin esta regla estrenar la aplicación en un dispositivo borraría las fotos
    // de todos los perfiles que ese dispositivo no tuviera.
    const punteros = new Map([[PERFIL, new Set(['ph_1'])]]);
    const sobran = remote.orphans(inv([
        { profileId: PERFIL, photoId: 'ph_1', bytes: 10 },
        { profileId: 'zz9xy1234567890abcdefg', photoId: 'ph_2', bytes: 10 }
    ]), punteros);
    assert.deepEqual(sobran, []);
});

test('un perfil CONOCIDO y sin fotos sí deja huérfanos', async () => {
    // El caso contrario, y hay que distinguirlo: aquí sí se sabe que ese perfil
    // no tiene ninguna foto, así que lo que haya en el servidor sobra.
    const punteros = new Map([[PERFIL, new Set()]]);
    const sobran = remote.orphans(inv([
        { profileId: PERFIL, photoId: 'ph_1', bytes: 10 }
    ]), punteros);
    assert.deepEqual(sobran.map((o) => o.photoId), ['ph_1']);
});

test('el inventario descarta lo que no tenga forma de objeto', async () => {
    /** @type {*} */ const raro = { objects: [{ profileId: 5 }, null, { profileId: PERFIL, photoId: 'ph_1', bytes: 1 }], complete: true };
    averia = { status: 200, body: JSON.stringify(raro) };
    const r = await remote.inventory();
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.value.objects.map((o) => o.photoId), ['ph_1']);
});

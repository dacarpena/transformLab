// @ts-check

/** M2-5 · photos-db: blobs en IndexedDB, metadatos aparte, aislamiento por perfil. */

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installIndexedDbMock, uninstallIndexedDbMock, makeBlob } from './helpers/indexed-db-mock.js';
import * as photos from '../src/data/photos-db.js';

/** @type {ReturnType<typeof installIndexedDbMock>} */
let idb;

beforeEach(() => {
    photos.close();
    idb = installIndexedDbMock();
});

afterEach(() => {
    photos.close();
    uninstallIndexedDbMock();
});

test('add + get: la foto vuelve con su blob y sus metadatos', async () => {
    const blob = makeBlob(2048);
    const added = await photos.add('p1', { id: 'foto1', dateISO: '2026-08-10', blob, note: 'frontal' });
    assert.ok(added.ok, JSON.stringify(!added.ok && added.error));
    assert.equal(added.value.bytes, 2048);
    assert.equal(added.value.profileId, 'p1');
    assert.ok(!('blob' in added.value), 'add no debería devolver el blob');

    const got = await photos.get('p1', 'foto1');
    assert.ok(got.ok);
    assert.ok(got.value);
    assert.equal(got.value.note, 'frontal');
    assert.equal(got.value.blob.size, 2048);
});

test('get de una foto inexistente devuelve null, no error', async () => {
    const got = await photos.get('p1', 'noexiste');
    assert.ok(got.ok);
    assert.equal(got.value, null);
});

test('list devuelve SOLO metadatos (sin blobs) y ordenados por fecha', async () => {
    await photos.add('p1', { id: 'b', dateISO: '2026-09-01', blob: makeBlob(100) });
    await photos.add('p1', { id: 'a', dateISO: '2026-08-01', blob: makeBlob(200) });

    const listed = await photos.list('p1');
    assert.ok(listed.ok);
    assert.equal(listed.value.length, 2);
    assert.deepEqual(listed.value.map((m) => m.dateISO), ['2026-08-01', '2026-09-01']);
    for (const meta of listed.value) {
        assert.ok(!('blob' in meta), 'la lista no debe cargar blobs en memoria');
        assert.ok(meta.bytes > 0);
    }
});

test('las fotos están aisladas por perfil', async () => {
    await photos.add('p1', { id: 'x', dateISO: '2026-08-01', blob: makeBlob(100) });
    await photos.add('p2', { id: 'x', dateISO: '2026-08-01', blob: makeBlob(999) });

    const l1 = await photos.list('p1');
    const l2 = await photos.list('p2');
    assert.ok(l1.ok && l2.ok);
    assert.equal(l1.value.length, 1);
    assert.equal(l2.value.length, 1);
    assert.equal(l1.value[0].bytes, 100);
    assert.equal(l2.value[0].bytes, 999, 'el mismo id en otro perfil pisó los datos');

    const cross = await photos.get('p1', 'x');
    assert.ok(cross.ok && cross.value?.blob.size === 100);
});

test('remove borra una foto sin tocar las demás', async () => {
    await photos.add('p1', { id: 'a', dateISO: '2026-08-01', blob: makeBlob(100) });
    await photos.add('p1', { id: 'b', dateISO: '2026-08-02', blob: makeBlob(100) });

    assert.ok((await photos.remove('p1', 'a')).ok);
    const listed = await photos.list('p1');
    assert.ok(listed.ok);
    assert.equal(listed.value.length, 1);
    assert.ok(listed.value[0].id.endsWith('b'));
});

test('removeAll deja el perfil sin blobs huérfanos y no toca a otros', async () => {
    await photos.add('p1', { id: 'a', dateISO: '2026-08-01', blob: makeBlob(100) });
    await photos.add('p1', { id: 'b', dateISO: '2026-08-02', blob: makeBlob(100) });
    await photos.add('p2', { id: 'c', dateISO: '2026-08-03', blob: makeBlob(100) });

    const removed = await photos.removeAll('p1');
    assert.ok(removed.ok);
    assert.equal(removed.value, 2);

    const l1 = await photos.list('p1');
    assert.ok(l1.ok && l1.value.length === 0);
    const l2 = await photos.list('p2');
    assert.ok(l2.ok && l2.value.length === 1);
});

test('usage suma bytes y cuenta fotos del perfil', async () => {
    const empty = await photos.usage('p1');
    assert.ok(empty.ok);
    assert.deepEqual(empty.value, { count: 0, bytes: 0 });

    await photos.add('p1', { id: 'a', dateISO: '2026-08-01', blob: makeBlob(1000) });
    await photos.add('p1', { id: 'b', dateISO: '2026-08-02', blob: makeBlob(2500) });
    const used = await photos.usage('p1');
    assert.ok(used.ok);
    assert.deepEqual(used.value, { count: 2, bytes: 3500 });
});

test('entradas inválidas se rechazan con error tipado, sin lanzar', async () => {
    for (const bad of [
        ['', { id: 'a', dateISO: '2026-08-01', blob: makeBlob() }],
        ['p1', null],
        ['p1', { id: '', dateISO: '2026-08-01', blob: makeBlob() }],
        ['p1', { id: 'a', dateISO: '', blob: makeBlob() }],
        ['p1', { id: 'a', dateISO: '2026-08-01', blob: null }],
        ['p1', { id: 'a', dateISO: '2026-08-01', blob: 'no soy un blob' }]
    ]) {
        const r = await photos.add(/** @type {*} */ (bad[0]), /** @type {*} */ (bad[1]));
        assert.equal(r.ok, false, `aceptó ${JSON.stringify(bad[1])}`);
    }
    assert.equal((await photos.get('', 'a')).ok, false);
    assert.equal((await photos.list('')).ok, false);
    assert.equal((await photos.remove('p1', '')).ok, false);
});

test('la nota se acota y las no-string degradan a cadena vacía', async () => {
    const long = await photos.add('p1', { id: 'a', dateISO: '2026-08-01', blob: makeBlob(), note: 'x'.repeat(500) });
    assert.ok(long.ok);
    assert.equal(long.value.note.length, 300);

    const weird = await photos.add('p1', { id: 'b', dateISO: '2026-08-01', blob: makeBlob(), note: /** @type {*} */ (42) });
    assert.ok(weird.ok);
    assert.equal(weird.value.note, '');
});

test('sin IndexedDB, toda la API degrada con error y sin lanzar', async () => {
    photos.close();
    uninstallIndexedDbMock();
    for (const call of [
        () => photos.add('p1', { id: 'a', dateISO: '2026-08-01', blob: makeBlob() }),
        () => photos.get('p1', 'a'),
        () => photos.list('p1'),
        () => photos.remove('p1', 'a'),
        () => photos.usage('p1')
    ]) {
        const r = await call();
        assert.equal(r.ok, false);
        assert.ok(!r.ok && r.error === 'photos.indexedDbUnavailable');
    }
});

test('un fallo de escritura (cuota de disco) se reporta sin corromper lo guardado', async () => {
    await photos.add('p1', { id: 'a', dateISO: '2026-08-01', blob: makeBlob(100) });
    idb.failNextWrite();
    const failed = await photos.add('p1', { id: 'b', dateISO: '2026-08-02', blob: makeBlob(100) });
    assert.equal(failed.ok, false);
    assert.ok(!failed.ok && failed.error.includes('QuotaExceededError'));

    const listed = await photos.list('p1');
    assert.ok(listed.ok);
    assert.equal(listed.value.length, 1, 'la foto previa debería seguir intacta');
});

test('el texto hostil de la nota se guarda literal (escapar es del render)', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const added = await photos.add('p1', { id: 'a', dateISO: '2026-08-01', blob: makeBlob(), note: payload });
    assert.ok(added.ok);
    assert.equal(added.value.note, payload);
});

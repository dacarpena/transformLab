// @ts-check
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';

/** @type {import('./helpers/local-storage-mock.js').LocalStorageMock} */
let mock;

beforeEach(() => {
    mock = installLocalStorageMock();
    storage.setActiveProfile('p1');
});

test('set + get hacen la ida y vuelta de un objeto', () => {
    const written = storage.set('checkins', [{ week: 1, weight: 80 }]);
    assert.equal(written.ok, true);

    const read = storage.get('checkins');
    assert.equal(read.ok, true);
    assert.deepEqual(read.ok && read.value, [{ week: 1, weight: 80 }]);
});

test('las claves llevan el namespace tl.5.<pid>.', () => {
    storage.set('settings', { locale: 'es' });
    assert.equal(mock.getItem('tl.5.p1.settings'), JSON.stringify({ locale: 'es' }));
});

test('setActiveProfile aísla los datos por perfil', () => {
    storage.set('weight', 80);
    storage.setActiveProfile('p2');

    const other = storage.get('weight');
    assert.equal(other.ok, true);
    assert.equal(other.ok && other.value, null);

    storage.set('weight', 60);
    storage.setActiveProfile('p1');
    const original = storage.get('weight');
    assert.equal(original.ok && original.value, 80);
});

test('setActiveProfile rechaza identificadores inválidos sin cambiar el activo', () => {
    for (const bad of ['', '  ', 'a.b']) {
        const res = storage.setActiveProfile(bad);
        assert.equal(res.ok, false);
    }
    assert.equal(storage.getActiveProfile(), 'p1');
});

test('clave ausente devuelve {ok: true, value: null}, no un error', () => {
    const res = storage.get('no-existe');
    assert.deepEqual(res, { ok: true, value: null });
});

test('JSON corrupto degrada a {ok: false} sin lanzar', () => {
    mock.setItem('tl.5.p1.roto', '{esto no es JSON');
    const res = storage.get('roto');
    assert.equal(res.ok, false);
    assert.match(!res.ok ? res.error : '', /SyntaxError/);
});

test('cuota llena degrada a {ok: false} con error tipado, sin crash', () => {
    mock.quotaFull = true;
    const res = storage.set('checkins', { big: 'data' });
    assert.equal(res.ok, false);
    assert.match(!res.ok ? res.error : '', /QuotaExceededError/);
});

test('remove elimina solo la clave del perfil activo', () => {
    storage.set('a', 1);
    storage.set('b', 2);
    const removed = storage.remove('a');
    assert.equal(removed.ok, true);
    assert.equal(storage.get('a').ok && /** @type {*} */ (storage.get('a')).value, null);
    assert.equal(/** @type {*} */ (storage.get('b')).value, 2);
});

test('usageBytes cuenta solo claves tl.* y crece al escribir', () => {
    const empty = storage.usageBytes();
    assert.equal(empty.ok && empty.value, 0);

    mock.setItem('ajena', 'x'.repeat(100));
    storage.set('datos', 'y'.repeat(50));

    const used = storage.usageBytes();
    assert.equal(used.ok, true);
    const bytes = used.ok ? used.value : 0;
    assert.ok(bytes >= 50 * 2, `esperaba ≥100 bytes, obtuve ${bytes}`);
    const expected = ('tl.5.p1.datos'.length + JSON.stringify('y'.repeat(50)).length) * 2;
    assert.equal(bytes, expected);
});

test('sin localStorage en el entorno, toda la API degrada sin lanzar', () => {
    // @ts-expect-error — se retira el backend a propósito
    delete globalThis.localStorage;
    assert.equal(storage.get('x').ok, false);
    assert.equal(storage.set('x', 1).ok, false);
    assert.equal(storage.remove('x').ok, false);
    assert.equal(storage.usageBytes().ok, false);
});

// @ts-check

/** M2-2 · Multiperfil: índice, aislamiento por namespace y borrado protegido. */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import * as profiles from '../src/data/profiles.js';

const AT = '2026-08-02T10:00:00.000Z';

/** @type {import('./helpers/local-storage-mock.js').LocalStorageMock} */
let mock;

beforeEach(() => {
    mock = installLocalStorageMock();
    storage.setActiveProfile('p1');
});

test('sin índice previo, list() devuelve vacío y getActive() cadena vacía', () => {
    const l = profiles.list();
    assert.ok(l.ok);
    assert.deepEqual(l.value, []);
    const a = profiles.getActive();
    assert.ok(a.ok && a.value === '');
});

test('create() da de alta, deja activo y siembra las colecciones por defecto', () => {
    const created = profiles.create('Dani', { createdAtISO: AT });
    assert.ok(created.ok, JSON.stringify(!created.ok && created.error));
    assert.equal(created.value.id, 'p1');

    const active = profiles.getActive();
    assert.ok(active.ok && active.value === 'p1');
    assert.equal(storage.getActiveProfile(), 'p1');

    // colecciones sembradas y válidas (menos profile, que escribe el onboarding)
    const keys = storage.keysOfProfile('p1');
    assert.ok(keys.ok);
    assert.ok(keys.value.includes('checkins'));
    assert.ok(keys.value.includes('settings'));
    assert.ok(!keys.value.includes('profile'));
    const checkins = storage.get('checkins');
    assert.ok(checkins.ok);
    assert.deepEqual(/** @type {*} */ (checkins.value).items, []);
});

test('el índice se guarda en la clave global tl.5.profiles', () => {
    profiles.create('Dani', { createdAtISO: AT });
    const raw = mock.getItem('tl.5.profiles');
    assert.ok(raw, 'el índice no está en tl.5.profiles');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.schemaVersion, 5);
    assert.equal(parsed.profiles.length, 1);
});

test('los datos de dos perfiles están aislados por namespace', () => {
    profiles.create('Dani', { createdAtISO: AT });
    storage.set('checkins', { schemaVersion: 5, items: [{ id: 'a' }] });

    const second = profiles.create('Ana', { createdAtISO: AT });
    assert.ok(second.ok);
    assert.equal(second.value.id, 'p2');
    // el perfil nuevo arranca con su colección por defecto, no con la del otro
    const fresh = storage.get('checkins');
    assert.ok(fresh.ok);
    assert.deepEqual(/** @type {*} */ (fresh.value).items, []);

    // y volver al primero recupera lo suyo
    assert.ok(profiles.setActive('p1').ok);
    const back = storage.get('checkins');
    assert.ok(back.ok);
    assert.equal(/** @type {*} */ (back.value).items.length, 1);
});

test('nombres: se sanean, no pueden quedar vacíos ni repetirse', () => {
    assert.ok(profiles.create('  Dani  ', { createdAtISO: AT }).ok);
    const l = profiles.list();
    assert.ok(l.ok && l.value[0].name === 'Dani');

    assert.equal(profiles.create('   ', { createdAtISO: AT }).ok, false);
    assert.equal(profiles.create('Dani', { createdAtISO: AT }).ok, false);
    const dup = profiles.create('Dani', { createdAtISO: AT });
    assert.ok(!dup.ok && dup.error === 'profiles.nameTaken');
});

test('el nombre del perfil se guarda como TEXTO literal (escapar es del render)', () => {
    const payload = '<img src=x onerror=alert(1)>';
    const created = profiles.create(payload, { createdAtISO: AT });
    assert.ok(created.ok);
    assert.equal(created.value.name, payload);
    const l = profiles.list();
    assert.ok(l.ok && l.value[0].name === payload);
});

test('rename() cambia el nombre y respeta la unicidad', () => {
    profiles.create('Dani', { createdAtISO: AT });
    profiles.create('Ana', { createdAtISO: AT });
    assert.ok(profiles.rename('p1', 'Daniel').ok);
    const l = profiles.list();
    assert.ok(l.ok && l.value.find((p) => p.id === 'p1')?.name === 'Daniel');

    const clash = profiles.rename('p1', 'Ana');
    assert.ok(!clash.ok && clash.error === 'profiles.nameTaken');
    assert.equal(profiles.rename('p9', 'X').ok, false);
});

test('C4: borrar exige el nombre EXACTO tecleado; sin él no se toca nada', () => {
    profiles.create('Dani', { createdAtISO: AT });
    storage.set('checkins', { schemaVersion: 5, items: [{ id: 'a' }] });

    for (const wrong of ['', 'dani', 'Dan', 'Dani ']) {
        const r = profiles.remove('p1', wrong === 'Dani ' ? 'Dani  x' : wrong);
        assert.equal(r.ok, false, `confirmación "${wrong}" aceptada`);
    }
    // los datos siguen ahí
    const keys = storage.keysOfProfile('p1');
    assert.ok(keys.ok && keys.value.length > 0);
    const l = profiles.list();
    assert.ok(l.ok && l.value.length === 1);
});

test('borrar con el nombre correcto elimina el perfil y TODAS sus claves', () => {
    profiles.create('Dani', { createdAtISO: AT });
    profiles.create('Ana', { createdAtISO: AT });
    assert.ok(profiles.setActive('p1').ok);
    storage.set('checkins', { schemaVersion: 5, items: [{ id: 'a' }] });

    const removed = profiles.remove('p1', 'Dani');
    assert.ok(removed.ok, JSON.stringify(!removed.ok && removed.error));
    assert.ok(removed.value.deletedKeys > 0);
    assert.equal(removed.value.activeProfileId, 'p2', 'debería activarse el perfil restante');

    const keys = storage.keysOfProfile('p1');
    assert.ok(keys.ok && keys.value.length === 0, 'quedaron claves huérfanas');
    const l = profiles.list();
    assert.ok(l.ok && l.value.length === 1 && l.value[0].id === 'p2');
    // y no ha tocado los datos del otro perfil
    const otherKeys = storage.keysOfProfile('p2');
    assert.ok(otherKeys.ok && otherKeys.value.length > 0);
});

test('borrar el último perfil deja el índice vacío sin activo', () => {
    profiles.create('Dani', { createdAtISO: AT });
    const removed = profiles.remove('p1', 'Dani');
    assert.ok(removed.ok);
    assert.equal(removed.value.activeProfileId, '');
    const l = profiles.list();
    assert.ok(l.ok && l.value.length === 0);
});

test('un índice corrupto se reporta, NUNCA se sobrescribe en silencio', () => {
    mock.setItem('tl.5.profiles', '{"esto no es json');
    const r = profiles.readIndex();
    assert.equal(r.ok, false);

    mock.setItem('tl.5.profiles', JSON.stringify({ schemaVersion: 5, activeProfileId: 'p9', profiles: [] }));
    const r2 = profiles.readIndex();
    assert.equal(r2.ok, false);
    assert.ok(!r2.ok && r2.error === 'profiles.indexCorrupt');
    // el dato original sigue intacto para poder recuperarlo
    assert.ok(mock.getItem('tl.5.profiles')?.includes('p9'));
});

test('activateStored() sincroniza el namespace con el perfil guardado', () => {
    profiles.create('Dani', { createdAtISO: AT });
    profiles.create('Ana', { createdAtISO: AT });
    assert.ok(profiles.setActive('p2').ok);

    storage.setActiveProfile('p1'); // simula un arranque en frío
    const r = profiles.activateStored();
    assert.ok(r.ok && r.value === 'p2');
    assert.equal(storage.getActiveProfile(), 'p2');
});

test('setActive() rechaza perfiles inexistentes sin cambiar el activo', () => {
    profiles.create('Dani', { createdAtISO: AT });
    const r = profiles.setActive('p9');
    assert.ok(!r.ok && r.error === 'profiles.notFound');
    assert.equal(storage.getActiveProfile(), 'p1');
});

test('se respeta el límite de perfiles', () => {
    for (let i = 0; i < profiles.MAX_PROFILES; i++) {
        assert.ok(profiles.create(`P${i}`, { createdAtISO: AT }).ok, `falló al crear el perfil ${i}`);
    }
    const extra = profiles.create('Uno más', { createdAtISO: AT });
    assert.ok(!extra.ok && extra.error === 'profiles.limitReached');
});

test('sin localStorage disponible, todas las operaciones degradan sin lanzar', () => {
    // @ts-expect-error — se retira el backend a propósito
    delete globalThis.localStorage;
    assert.equal(profiles.list().ok, false);
    assert.equal(profiles.getActive().ok, false);
    assert.equal(profiles.create('X', { createdAtISO: AT }).ok, false);
    assert.equal(profiles.remove('p1', 'X').ok, false);
    assert.equal(profiles.activateStored().ok, false);
});

test('cuota: quotaBudget mide perfil y total, y avisa al superar el umbral', () => {
    profiles.create('Dani', { createdAtISO: AT });
    const small = storage.quotaBudget('p1');
    assert.ok(small.ok);
    assert.ok(small.value.profileBytes > 0);
    assert.ok(small.value.totalBytes >= small.value.profileBytes);
    assert.equal(small.value.warn, false);
    assert.equal(small.value.limitBytes, storage.QUOTA_LIMIT_BYTES);

    // llenar por encima del 60 % del límite
    storage.set('bulto', 'x'.repeat(Math.ceil(storage.QUOTA_LIMIT_BYTES * 0.62 / 2)));
    const big = storage.quotaBudget('p1');
    assert.ok(big.ok);
    assert.ok(big.value.usedRatio >= storage.QUOTA_WARN_RATIO);
    assert.equal(big.value.warn, true);
});

test('usageBytes por perfil no cuenta el namespace de otro', () => {
    profiles.create('Dani', { createdAtISO: AT });
    storage.set('grande', 'y'.repeat(500));
    profiles.create('Ana', { createdAtISO: AT });

    const p1 = storage.usageBytes('p1');
    const p2 = storage.usageBytes('p2');
    assert.ok(p1.ok && p2.ok);
    assert.ok(p1.value > p2.value, `p1=${p1.ok && p1.value} p2=${p2.ok && p2.value}`);
});

// @ts-check

/**
 * M2-2 · Multiperfil: índice, aislamiento por namespace y borrado protegido.
 *
 * **Desde la v7 los ids son OPACOS** (M9-1), así que ningún test puede escribir
 * `'p1'` esperando que sea el id del primer perfil: se capturan del valor que
 * devuelve `create()`. Eso además prueba más que antes — que el id que se
 * devuelve es el que de verdad gobierna el namespace— en vez de comprobar que la
 * generación sigue una fórmula.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import { rootPrefix, SCHEMA_VERSION } from '../src/data/version.js';
import * as profiles from '../src/data/profiles.js';

const AT = '2026-08-02T10:00:00.000Z';

/** @type {import('./helpers/local-storage-mock.js').LocalStorageMock} */
let mock;

beforeEach(() => {
    mock = installLocalStorageMock();
    storage.setActiveProfile('p1');
});

/**
 * Crea un perfil y devuelve su id. Con ids opacos no hay forma de adivinarlo:
 * hay que quedárselo.
 * @param {string} nombre
 * @returns {string}
 */
function crear(nombre) {
    const r = profiles.create(nombre, { createdAtISO: AT });
    assert.ok(r.ok, `create('${nombre}') falló: ${!r.ok && r.error}`);
    return r.value.id;
}

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
    const id = created.value.id;
    // El id es OPACO: ni `p1`, ni nada derivado del nombre o del orden.
    assert.match(id, /^[A-Za-z0-9_-]{20,40}$/, `el id no parece opaco: ${id}`);
    assert.notEqual(id, 'p1');

    const active = profiles.getActive();
    assert.ok(active.ok && active.value === id);
    assert.equal(storage.getActiveProfile(), id);

    // colecciones sembradas y válidas (menos profile, que escribe el onboarding)
    const keys = storage.keysOfProfile(id);
    assert.ok(keys.ok);
    assert.ok(keys.value.includes('checkins'));
    assert.ok(keys.value.includes('settings'));
    assert.ok(!keys.value.includes('profile'));
    const checkins = storage.get('checkins');
    assert.ok(checkins.ok);
    assert.deepEqual(/** @type {*} */ (checkins.value).items, []);
});

test('el índice se guarda en la clave global `tl.<version>.profiles`', () => {
    profiles.create('Dani', { createdAtISO: AT });
    const raw = mock.getItem(`${rootPrefix()}profiles`);
    assert.ok(raw, `el índice no está en ${rootPrefix()}profiles`);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.schemaVersion, SCHEMA_VERSION);
    assert.equal(parsed.profiles.length, 1);
});

test('los datos de dos perfiles están aislados por namespace', () => {
    const dani = crear('Dani');
    storage.set('checkins', { schemaVersion: SCHEMA_VERSION, items: [{ id: 'a' }] });

    const ana = crear('Ana');
    assert.notEqual(ana, dani, 'dos perfiles con el mismo id');
    // el perfil nuevo arranca con su colección por defecto, no con la del otro
    const fresh = storage.get('checkins');
    assert.ok(fresh.ok);
    assert.deepEqual(/** @type {*} */ (fresh.value).items, []);

    // y volver al primero recupera lo suyo
    assert.ok(profiles.setActive(dani).ok);
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
    const dani = crear('Dani');
    crear('Ana');
    assert.ok(profiles.rename(dani, 'Daniel').ok);
    const l = profiles.list();
    assert.ok(l.ok && l.value.find((p) => p.id === dani)?.name === 'Daniel');

    const clash = profiles.rename(dani, 'Ana');
    assert.ok(!clash.ok && clash.error === 'profiles.nameTaken');
    assert.equal(profiles.rename('p9', 'X').ok, false);
});

test('C4: borrar exige el nombre EXACTO tecleado; sin él no se toca nada', () => {
    const dani = crear('Dani');
    storage.set('checkins', { schemaVersion: SCHEMA_VERSION, items: [{ id: 'a' }] });

    for (const wrong of ['', 'dani', 'Dan', 'Dani ']) {
        const r = profiles.remove(dani, wrong === 'Dani ' ? 'Dani  x' : wrong);
        assert.equal(r.ok, false, `confirmación "${wrong}" aceptada`);
    }
    // los datos siguen ahí
    const keys = storage.keysOfProfile(dani);
    assert.ok(keys.ok && keys.value.length > 0);
    const l = profiles.list();
    assert.ok(l.ok && l.value.length === 1);
});

test('borrar con el nombre correcto elimina el perfil y TODAS sus claves', () => {
    const dani = crear('Dani');
    const ana = crear('Ana');
    assert.ok(profiles.setActive(dani).ok);
    storage.set('checkins', { schemaVersion: SCHEMA_VERSION, items: [{ id: 'a' }] });

    const removed = profiles.remove(dani, 'Dani');
    assert.ok(removed.ok, JSON.stringify(!removed.ok && removed.error));
    assert.ok(removed.value.deletedKeys > 0);
    assert.equal(removed.value.activeProfileId, ana, 'debería activarse el perfil restante');

    const keys = storage.keysOfProfile(dani);
    assert.ok(keys.ok && keys.value.length === 0, 'quedaron claves huérfanas');
    const l = profiles.list();
    assert.ok(l.ok && l.value.length === 1 && l.value[0].id === ana);
    // y no ha tocado los datos del otro perfil
    const otherKeys = storage.keysOfProfile(ana);
    assert.ok(otherKeys.ok && otherKeys.value.length > 0);
});

test('el id de un perfil borrado NO se reutiliza (M9-1)', () => {
    // Es el defecto que los ids opacos cierran por construcción: con `pN`, el
    // siguiente perfil heredaba el id del borrado y —como `create()` no siembra
    // la colección `profile`— también sus datos personales.
    const dani = crear('Dani');
    storage.set('profile', { schemaVersion: SCHEMA_VERSION, name: 'Dani', secreto: true });
    assert.ok(profiles.remove(dani, 'Dani').ok);

    const nuevo = crear('Ana');
    assert.notEqual(nuevo, dani, 'el id del perfil borrado se reutilizó');
    const perfil = storage.get('profile');
    assert.ok(perfil.ok);
    assert.equal(perfil.value, null, 'el perfil nuevo heredó datos del borrado');
});

test('borrar el último perfil deja el índice vacío sin activo', () => {
    const dani = crear('Dani');
    const removed = profiles.remove(dani, 'Dani');
    assert.ok(removed.ok);
    assert.equal(removed.value.activeProfileId, '');
    const l = profiles.list();
    assert.ok(l.ok && l.value.length === 0);
});

test('un índice corrupto se reporta, NUNCA se sobrescribe en silencio', () => {
    mock.setItem(`${rootPrefix()}profiles`, '{"esto no es json');
    const r = profiles.readIndex();
    assert.equal(r.ok, false);

    mock.setItem(`${rootPrefix()}profiles`, JSON.stringify({ schemaVersion: SCHEMA_VERSION, activeProfileId: 'p9', profiles: [] }));
    const r2 = profiles.readIndex();
    assert.equal(r2.ok, false);
    assert.ok(!r2.ok && r2.error === 'profiles.indexCorrupt');
    // el dato original sigue intacto para poder recuperarlo
    assert.ok(mock.getItem(`${rootPrefix()}profiles`)?.includes('p9'));
});

test('activateStored() sincroniza el namespace con el perfil guardado', () => {
    const dani = crear('Dani');
    const ana = crear('Ana');
    assert.ok(profiles.setActive(ana).ok);

    storage.setActiveProfile(dani); // simula un arranque en frío
    const r = profiles.activateStored();
    assert.ok(r.ok && r.value === ana);
    assert.equal(storage.getActiveProfile(), ana);
});

test('setActive() rechaza perfiles inexistentes sin cambiar el activo', () => {
    const dani = crear('Dani');
    const r = profiles.setActive('p9');
    assert.ok(!r.ok && r.error === 'profiles.notFound');
    assert.equal(storage.getActiveProfile(), dani);
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
    const dani = crear('Dani');
    const small = storage.quotaBudget(dani);
    assert.ok(small.ok);
    assert.ok(small.value.profileBytes > 0);
    assert.ok(small.value.totalBytes >= small.value.profileBytes);
    assert.equal(small.value.warn, false);
    assert.equal(small.value.limitBytes, storage.QUOTA_LIMIT_BYTES);

    // llenar por encima del 60 % del límite
    storage.set('bulto', 'x'.repeat(Math.ceil(storage.QUOTA_LIMIT_BYTES * 0.62 / 2)));
    const big = storage.quotaBudget(dani);
    assert.ok(big.ok);
    assert.ok(big.value.usedRatio >= storage.QUOTA_WARN_RATIO);
    assert.equal(big.value.warn, true);
});

test('usageBytes por perfil no cuenta el namespace de otro', () => {
    const dani = crear('Dani');
    storage.set('grande', 'y'.repeat(500));
    const ana = crear('Ana');

    const uno = storage.usageBytes(dani);
    const dos = storage.usageBytes(ana);
    assert.ok(uno.ok && dos.ok);
    assert.ok(uno.value > dos.value, `dani=${uno.ok && uno.value} ana=${dos.ok && dos.value}`);
});

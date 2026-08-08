// @ts-check

/** M2-4 · Backup: ida y vuelta, y el import como vector de datos hostiles. */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import * as profiles from '../src/data/profiles.js';
import * as backup from '../src/data/backup.js';
import { SCHEMA_VERSION } from '../src/data/schema.js';

const NOW = '2026-08-02T12:00:00.000Z';
const XSS = '<img src=x onerror=alert(1)>';

/** @type {import('./helpers/local-storage-mock.js').LocalStorageMock} */
let mock;

/** Crea un perfil con datos reales para exportar. */
function seedProfile(name = 'Dani') {
    const created = profiles.create(name, { createdAtISO: NOW });
    assert.ok(created.ok, JSON.stringify(!created.ok && created.error));
    storage.set('profile', {
        schemaVersion: SCHEMA_VERSION,
        name, createdAtISO: NOW,
        user: { sex: 'male', age: 35, heightCm: 178, activityLevel: 'moderate', trainingStatus: 'intermediate' },
        initial: { weightKg: 80, fatPct: 20, muscleKg: null, muscleSource: 'estimated' },
        target: { fatPct: 15, muscleKg: 33 },
        startDateISO: '2026-08-03', intensity: 'moderate'
    });
    storage.set('checkins', {
        schemaVersion: SCHEMA_VERSION,
        items: [{
            id: 'ci1', dateISO: '2026-08-10', weightKg: 79.4, fatPct: 19.5,
            measuresCm: { waist: 88 }, subjective: { energy: 7, sleep: 8 },
            notes: 'buena semana', createdAtISO: NOW, editedAtISO: null
        }]
    });
    return created.value.id;
}

beforeEach(() => {
    mock = installLocalStorageMock();
    storage.setActiveProfile('p1');
});

test('ida y vuelta: exportar → inspeccionar → aplicar conserva los datos', () => {
    seedProfile();
    const exported = backup.exportProfiles({ exportedAtISO: NOW });
    assert.ok(exported.ok, JSON.stringify(!exported.ok && exported.error));
    const text = backup.serialize(exported.value);
    assert.ok(text.ok);

    // almacén limpio, como si fuese otro navegador
    mock = installLocalStorageMock();
    storage.setActiveProfile('p1');

    const inspected = backup.inspect(text.value);
    assert.ok(inspected.ok, JSON.stringify(!inspected.ok && inspected.error));
    assert.equal(inspected.value.summary.profiles.length, 1);
    assert.equal(inspected.value.summary.profiles[0].checkins, 1);
    assert.equal(inspected.value.summary.profiles[0].hasProfile, true);

    const applied = backup.apply(inspected.value.backup, { nowISO: NOW });
    assert.ok(applied.ok, JSON.stringify(!applied.ok && applied.error));
    assert.equal(applied.value.importedProfiles.length, 1);

    assert.ok(profiles.setActive(applied.value.importedProfiles[0].id).ok);
    const checkins = storage.get('checkins');
    assert.ok(checkins.ok);
    assert.equal(/** @type {*} */ (checkins.value).items[0].weightKg, 79.4);
    assert.equal(/** @type {*} */ (checkins.value).items[0].notes, 'buena semana');
    const profile = storage.get('profile');
    assert.ok(profile.ok);
    assert.equal(/** @type {*} */ (profile.value).initial.muscleSource, 'estimated');
});

test('inspect() NO escribe nada: es solo un análisis previo', () => {
    seedProfile();
    const exported = backup.exportProfiles({ exportedAtISO: NOW });
    assert.ok(exported.ok);
    const text = /** @type {*} */ (backup.serialize(exported.value)).value;

    const before = profiles.list();
    assert.ok(before.ok);
    const beforeKeys = mock.length;

    assert.ok(backup.inspect(text).ok);
    const after = profiles.list();
    assert.ok(after.ok);
    assert.deepEqual(after.value, before.value);
    assert.equal(mock.length, beforeKeys, 'inspect escribió en el almacén');
});

test('XSS: el payload sobrevive como TEXTO literal en nombre y notas', () => {
    profiles.create(XSS, { createdAtISO: NOW });
    storage.set('checkins', {
        schemaVersion: SCHEMA_VERSION,
        items: [{
            id: 'ci1', dateISO: '2026-08-10', weightKg: 80, fatPct: null,
            measuresCm: {}, subjective: {}, notes: XSS, createdAtISO: NOW, editedAtISO: null
        }]
    });
    const exported = backup.exportProfiles({ exportedAtISO: NOW });
    assert.ok(exported.ok);
    const text = /** @type {*} */ (backup.serialize(exported.value)).value;

    mock = installLocalStorageMock();
    storage.setActiveProfile('p1');
    const inspected = backup.inspect(text);
    assert.ok(inspected.ok);
    assert.equal(inspected.value.summary.profiles[0].name, XSS, 'el nombre debe conservarse literal');

    const applied = backup.apply(inspected.value.backup, { nowISO: NOW });
    assert.ok(applied.ok);
    assert.ok(profiles.setActive(applied.value.importedProfiles[0].id).ok);
    const checkins = storage.get('checkins');
    assert.ok(checkins.ok);
    assert.equal(/** @type {*} */ (checkins.value).items[0].notes, XSS);
    // y nada de lo guardado contiene HTML ya escapado (escapar es del render)
    assert.ok(!JSON.stringify(checkins.value).includes('&lt;'));
});

test('contaminación de prototipo en el fichero importado no toca Object.prototype', () => {
    const hostil = JSON.stringify({
        formatVersion: backup.BACKUP_FORMAT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        exportedAtISO: NOW,
        profiles: [{
            id: 'p1', name: 'Hostil', createdAtISO: NOW,
            collections: JSON.parse(`{"__proto__":{"pwned":true},"checkins":{"schemaVersion":${SCHEMA_VERSION},"items":[]}}`)
        }]
    });
    const inspected = backup.inspect(hostil);
    assert.ok(inspected.ok, JSON.stringify(!inspected.ok && inspected.error));
    assert.equal(/** @type {*} */ ({}).pwned, undefined, 'Object.prototype contaminado');

    const applied = backup.apply(inspected.value.backup, { nowISO: NOW });
    assert.ok(applied.ok);
    assert.equal(/** @type {*} */ ({}).pwned, undefined);
});

test('las colecciones desconocidas o corruptas se DESCARTAN con aviso, no rompen el import', () => {
    const conBasura = JSON.stringify({
        formatVersion: backup.BACKUP_FORMAT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        exportedAtISO: NOW,
        profiles: [{
            id: 'p1', name: 'Mixto', createdAtISO: NOW,
            collections: {
                checkins: { schemaVersion: SCHEMA_VERSION, items: [] },
                coleccionInventada: { hola: 1 },
                settings: { schemaVersion: SCHEMA_VERSION, locale: 'klingon', activeMeasures: [], fluctuationVisible: false, reminder: null }
            }
        }]
    });
    const inspected = backup.inspect(conBasura);
    assert.ok(inspected.ok, JSON.stringify(!inspected.ok && inspected.error));
    assert.ok(inspected.value.summary.warnings.some((w) => w.startsWith('backup.collectionDropped:settings')));
    const cols = inspected.value.backup.profiles[0].collections;
    assert.ok(Object.hasOwn(cols, 'checkins'));
    assert.ok(!Object.hasOwn(cols, 'coleccionInventada'));
    assert.ok(!Object.hasOwn(cols, 'settings'), 'locale inválido debería haber caído');
});

test('ficheros inválidos se rechazan con error tipado, sin lanzar', () => {
    for (const [text, expected] of /** @type {Array<[*, string]>} */ ([
        ['no es json', 'backup.notJson'],
        ['[]', 'backup.notObject'],
        ['null', 'backup.notObject'],
        [JSON.stringify({ formatVersion: 99, schemaVersion: SCHEMA_VERSION, profiles: [] }), 'backup.formatUnsupported'],
        [JSON.stringify({ formatVersion: 1, schemaVersion: 4, profiles: [] }), 'backup.schemaUnsupported'],
        [JSON.stringify({ formatVersion: 1, schemaVersion: SCHEMA_VERSION, profiles: [] }), 'backup.noProfiles'],
        [42, 'backup.notText'],
        [null, 'backup.notText']
    ])) {
        const r = backup.inspect(text);
        assert.equal(r.ok, false, `aceptó: ${String(text).slice(0, 30)}`);
        assert.equal(!r.ok && r.error, expected);
    }
});

test('un fichero desmesurado se rechaza antes de intentar parsearlo', () => {
    const enorme = 'x'.repeat(backup.MAX_IMPORT_BYTES);
    const r = backup.inspect(enorme);
    assert.ok(!r.ok && r.error === 'backup.tooLarge');
});

test('importar NUNCA pisa los perfiles existentes: se añaden como nuevos', () => {
    seedProfile('Dani');
    const exported = backup.exportProfiles({ exportedAtISO: NOW });
    assert.ok(exported.ok);
    const text = /** @type {*} */ (backup.serialize(exported.value)).value;

    // importar sobre el MISMO almacén, con el perfil original presente
    const inspected = backup.inspect(text);
    assert.ok(inspected.ok);
    const applied = backup.apply(inspected.value.backup, { nowISO: NOW });
    assert.ok(applied.ok, JSON.stringify(!applied.ok && applied.error));

    const l = profiles.list();
    assert.ok(l.ok);
    assert.equal(l.value.length, 2, 'debería haber dos perfiles');
    assert.equal(l.value[0].name, 'Dani');
    assert.equal(l.value[1].name, 'Dani (2)', 'el nombre debe desambiguarse');

    // los datos del original siguen intactos
    assert.ok(profiles.setActive(l.value[0].id).ok);
    const original = storage.get('checkins');
    assert.ok(original.ok);
    assert.equal(/** @type {*} */ (original.value).items.length, 1);
});

test('export selectivo por perfil', () => {
    seedProfile('Dani');
    seedProfile('Ana');
    const all = backup.exportProfiles({ exportedAtISO: NOW });
    assert.ok(all.ok && all.value.profiles.length === 2);

    const one = backup.exportProfiles({ exportedAtISO: NOW, profileIds: ['p2'] });
    assert.ok(one.ok);
    assert.equal(one.value.profiles.length, 1);
    assert.equal(one.value.profiles[0].name, 'Ana');
});

test('exportar e importar restaura el perfil activo previo', () => {
    seedProfile('Dani');
    seedProfile('Ana');
    assert.ok(profiles.setActive('p1').ok);
    assert.equal(storage.getActiveProfile(), 'p1');

    backup.exportProfiles({ exportedAtISO: NOW });
    assert.equal(storage.getActiveProfile(), 'p1', 'export cambió el perfil activo');

    const exported = backup.exportProfiles({ exportedAtISO: NOW, profileIds: ['p2'] });
    assert.ok(exported.ok);
    const inspected = backup.inspect(/** @type {*} */ (backup.serialize(exported.value)).value);
    assert.ok(inspected.ok);
    assert.ok(backup.apply(inspected.value.backup, { nowISO: NOW }).ok);
    assert.equal(storage.getActiveProfile(), 'p1', 'import cambió el perfil activo');
});

test('sin perfiles no hay nada que exportar', () => {
    const r = backup.exportProfiles({ exportedAtISO: NOW });
    assert.ok(!r.ok && r.error === 'backup.noProfiles');
});

test('apply() con entrada arbitraria no escribe nada ni lanza', () => {
    for (const bad of [null, undefined, {}, [], 'x', { profiles: [] }]) {
        const r = backup.apply(/** @type {*} */ (bad), { nowISO: NOW });
        assert.equal(r.ok, false);
    }
    const l = profiles.list();
    assert.ok(l.ok && l.value.length === 0);
});

test('si el almacén se llena a mitad del import, se reporta sin dejar el activo movido', () => {
    seedProfile('Dani');
    const exported = backup.exportProfiles({ exportedAtISO: NOW });
    assert.ok(exported.ok);
    const inspected = backup.inspect(/** @type {*} */ (backup.serialize(exported.value)).value);
    assert.ok(inspected.ok);

    assert.ok(profiles.setActive('p1').ok);
    mock.quotaFull = true;
    const applied = backup.apply(inspected.value.backup, { nowISO: NOW });
    assert.equal(applied.ok, false);
    assert.equal(storage.getActiveProfile(), 'p1', 'el perfil activo quedó desplazado tras el fallo');
});

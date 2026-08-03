// @ts-check

/**
 * M2-7 · Regresión del endurecimiento adversarial de la capa de datos.
 * 61.661 casos de ataque en 4 estrategias; 13 roturas críticas/altas
 * verificadas a mano (los verificadores del workflow murieron por 401) y
 * cerradas aquí, una por test.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import * as profiles from '../src/data/profiles.js';
import * as migrate from '../src/data/migrate.js';
import * as backup from '../src/data/backup.js';
import { validateCollection, SCHEMA_VERSION } from '../src/data/schema.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/v4-profile.json', import.meta.url), 'utf8'));
const NOW = '2026-08-02T12:00:00.000Z';

/** @type {import('./helpers/local-storage-mock.js').LocalStorageMock} */
let mock;

function seedV4(overrides = {}) {
    const data = { ...FIXTURE, ...overrides };
    for (const key of migrate.V4_KEYS) {
        if (data[key] === undefined) continue;
        mock.setItem(key, typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key]));
    }
}

beforeEach(() => {
    mock = installLocalStorageMock();
    storage.setActiveProfile('p1');
});

// ---- CRÍTICO: fuga de datos entre perfiles al borrar el último ----

test('borrar el ÚLTIMO perfil resincroniza el namespace: nada se escribe en el borrado', () => {
    profiles.create('Ana', { createdAtISO: NOW });
    storage.set('profile', { secreto: 'datos de Ana' });
    assert.ok(profiles.remove('p1', 'Ana').ok);

    assert.notEqual(storage.getActiveProfile(), 'p1', 'el namespace sigue apuntando al perfil borrado');
    storage.set('loQueSea', { x: 1 });
    assert.equal(mock.getItem('tl.5.p1.loQueSea'), null, 'se resucitó una clave en el namespace borrado');
});

test('el perfil creado tras borrar NO hereda los datos personales del anterior', () => {
    profiles.create('Ana', { createdAtISO: NOW });
    storage.set('profile', { secreto: 'datos de Ana' });
    assert.ok(profiles.remove('p1', 'Ana').ok);

    const bea = profiles.create('Bea', { createdAtISO: NOW });
    assert.ok(bea.ok);
    const leaked = storage.get('profile');
    assert.ok(leaked.ok);
    assert.equal(leaked.value, null, `Bea heredó el perfil de Ana: ${JSON.stringify(leaked.value)}`);
});

// ---- CRÍTICO: el migrador escribía datos que el esquema rechaza ----

test('el migrador NO escribe nada fuera del esquema v5, ni archiva tras fallar', () => {
    seedV4({
        transformlab_userProfile: {
            ...FIXTURE.transformlab_userProfile,
            profile: { ...FIXTURE.transformlab_userProfile.profile, age: 200 }
        }
    });
    const r = migrate.migrate({ nowISO: NOW });
    assert.equal(r.ok, false, 'migró datos inválidos reportando éxito');
    assert.ok(!r.ok && r.error === 'migrate.profileOutOfSchema');
    // y NO ha archivado las claves v4: el usuario puede reintentar
    assert.ok(mock.getItem('transformlab_userProfile'), 'archivó los originales pese al fallo');
    assert.equal(migrate.needsMigration(), true);
    const l = profiles.list();
    assert.ok(l.ok && l.value.length === 0, 'quedó un perfil huérfano');
});

test('lo que el migrador SÍ escribe valida contra el esquema, campo a campo', () => {
    seedV4();
    assert.ok(migrate.migrate({ nowISO: NOW }).ok);
    for (const collection of ['profile', 'checkins']) {
        const stored = storage.get(collection);
        assert.ok(stored.ok);
        const check = validateCollection(collection, stored.value);
        assert.ok(check.ok, `${collection} inválido: ${JSON.stringify(!check.ok && check.errors)}`);
    }
});

// ---- La copia de seguridad no puede ser sobrescrita por datos v4 ----

test('una clave v4 hostil no puede pisar la copia de seguridad automática', () => {
    seedV4();
    mock.setItem('transformlab_backup', JSON.stringify({ basura: 1 }));
    assert.ok(migrate.migrate({ nowISO: NOW }).ok);

    const b = migrate.readSafetyBackup();
    assert.ok(b.ok && b.value !== null);
    const parsed = JSON.parse(/** @type {string} */ (b.value));
    assert.equal(parsed.source, 'v4');
    assert.ok(parsed.keys.transformlab_userProfile, 'la copia de seguridad fue sobrescrita');
    assert.equal(parsed.basura, undefined);
});

// ---- La adherencia v4 es un PORCENTAJE ----

test('adherencia v4 (0-100 %) se convierte sin invertir el significado', () => {
    seedV4({
        transformlab_checkins: [0, 5, 10, 15, 50, 95, 100].map((a, i) => ({
            id: `c${i}`, date: `2026-03-${String(i + 1).padStart(2, '0')}`,
            measurements: { weight: 80 }, selfReport: { adherence: a }
        }))
    });
    assert.ok(migrate.migrate({ nowISO: NOW }).ok);
    const stored = storage.get('checkins');
    assert.ok(stored.ok);
    const got = /** @type {*} */ (stored.value).items.map((/** @type {*} */ x) => x.subjective.adherence);
    // 10 % era la PEOR banda posible en v4; no puede migrarse como 10/10
    assert.deepEqual(got, [1, 1, 1, 2, 5, 10, 10]);
});

// ---- Nada se pierde en silencio ----

test('check-ins que no son un array se señalan como descartados', () => {
    for (const raro of [{ no: 'array' }, {}, 42, true, 'texto']) {
        mock = installLocalStorageMock();
        storage.setActiveProfile('p1');
        seedV4({ transformlab_checkins: raro });
        const r = migrate.migrate({ nowISO: NOW });
        assert.ok(r.ok);
        // el aviso concreto depende de si el JSON se pudo parsear o no; lo que
        // no puede pasar es que se descarten check-ins SIN decir nada
        const avisó = r.value.warnings.some((w) => w === 'migrate.checkinsSkipped' || w === 'migrate.checkinsCorrupt');
        assert.ok(avisó, `${JSON.stringify(raro)} se perdió sin aviso: ${JSON.stringify(r.value.warnings)}`);
    }
});

// ---- storage nunca reporta éxito escribiendo basura ----

test('storage.set rechaza valores no serializables en vez de escribir "undefined"', () => {
    for (const value of [undefined, () => {}, Symbol('s')]) {
        const r = storage.set('x', value);
        assert.equal(r.ok, false, `aceptó ${String(value)}`);
        assert.ok(!r.ok && r.error === 'storage.notSerializable');
        assert.equal(mock.getItem('tl.5.p1.x'), null, 'escribió pese a rechazar');
    }
    // y la variante grave: dejar el índice de perfiles ilegible
    assert.equal(storage.setGlobal('profiles', undefined).ok, false);
    assert.ok(profiles.list().ok, 'el índice quedó corrupto');
});

// ---- profiles no lanza nunca ----

test('profiles.create sin meta devuelve error, no lanza', () => {
    for (const meta of [undefined, null, 'x', 42]) {
        const r = profiles.create('Ana', /** @type {*} */ (meta));
        assert.equal(r.ok, false, `meta=${String(meta)} debería fallar`);
    }
});

test('create es atómico: si la siembra falla, no queda perfil en el índice', () => {
    mock.maxChars = mock.usedChars + 150;
    const r = profiles.create('Ana', { createdAtISO: NOW });
    assert.equal(r.ok, false);
    mock.maxChars = Infinity;
    const l = profiles.list();
    assert.ok(l.ok);
    assert.equal(l.value.length, 0, 'quedó un perfil fantasma sin colecciones');
});

// ---- backup: inspect y apply comparten criterio ----

test('lo que inspect() acepta, apply() lo aplica: mismo criterio de fecha', () => {
    const file = JSON.stringify({
        formatVersion: backup.BACKUP_FORMAT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        exportedAtISO: NOW,
        profiles: [
            { id: 'a', name: 'Uno', createdAtISO: NOW, collections: { checkins: { schemaVersion: 5, items: [] } } },
            { id: 'b', name: 'Dos', createdAtISO: '2026-01-01', collections: { checkins: { schemaVersion: 5, items: [] } } },
            { id: 'c', name: 'Tres', createdAtISO: 'Jan 5, 2026', collections: { checkins: { schemaVersion: 5, items: [] } } }
        ]
    });
    const inspected = backup.inspect(file);
    assert.ok(inspected.ok, JSON.stringify(!inspected.ok && inspected.error));
    const applied = backup.apply(inspected.value.backup, { nowISO: NOW });
    assert.ok(applied.ok, `inspect lo aceptó pero apply lo rechazó: ${JSON.stringify(!applied.ok && applied.error)}`);
    assert.equal(applied.value.importedProfiles.length, 3);
});

test('si apply() falla a mitad, informa de lo que YA escribió', () => {
    // llenar hasta el límite de perfiles menos uno
    for (let i = 0; i < profiles.MAX_PROFILES - 1; i++) {
        assert.ok(profiles.create(`P${i}`, { createdAtISO: NOW }).ok);
    }
    const file = JSON.stringify({
        formatVersion: backup.BACKUP_FORMAT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        exportedAtISO: NOW,
        profiles: ['A', 'B', 'C'].map((n, i) => ({
            id: `x${i}`, name: n, createdAtISO: NOW, collections: { checkins: { schemaVersion: 5, items: [] } }
        }))
    });
    const inspected = backup.inspect(file);
    assert.ok(inspected.ok);
    const applied = backup.apply(inspected.value.backup, { nowISO: NOW });
    assert.equal(applied.ok, false);
    assert.ok(!applied.ok && Array.isArray(applied.imported), 'no informó de lo ya importado');
    assert.equal(!applied.ok && applied.imported?.length, 1);
});

test('apply() restaura el perfil activo TAMBIÉN en el índice persistido', () => {
    profiles.create('Mío', { createdAtISO: NOW });
    storage.set('settings', { schemaVersion: 5, locale: 'es', activeMeasures: ['waist'], fluctuationVisible: false, reminder: null });

    const file = JSON.stringify({
        formatVersion: backup.BACKUP_FORMAT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        exportedAtISO: NOW,
        profiles: [{
            id: 'x', name: 'Ajeno', createdAtISO: NOW,
            collections: { settings: { schemaVersion: 5, locale: 'en', activeMeasures: [], fluctuationVisible: true, reminder: null } }
        }]
    });
    const inspected = backup.inspect(file);
    assert.ok(inspected.ok);
    assert.ok(backup.apply(inspected.value.backup, { nowISO: NOW }).ok);

    const indexActive = profiles.getActive();
    assert.ok(indexActive.ok);
    assert.equal(indexActive.value, storage.getActiveProfile(), 'índice y namespace desincronizados');
    assert.equal(indexActive.value, 'p1');

    // y al reiniciar, el usuario sigue en SU perfil
    profiles.activateStored();
    const settings = storage.get('settings');
    assert.ok(settings.ok);
    assert.equal(/** @type {*} */ (settings.value).locale, 'es', 'el usuario acabó en el perfil importado');
});

test('apply() NO fabrica un perfil corporal que nadie introdujo', () => {
    const file = JSON.stringify({
        formatVersion: backup.BACKUP_FORMAT_VERSION,
        schemaVersion: SCHEMA_VERSION,
        exportedAtISO: NOW,
        profiles: [{ id: 'y', name: 'SinPerfil', createdAtISO: NOW, collections: { checkins: { schemaVersion: 5, items: [] } } }]
    });
    const inspected = backup.inspect(file);
    assert.ok(inspected.ok);
    const applied = backup.apply(inspected.value.backup, { nowISO: NOW });
    assert.ok(applied.ok);

    assert.ok(profiles.setActive(applied.value.importedProfiles[0].id).ok);
    const fabricated = storage.get('profile');
    assert.ok(fabricated.ok);
    assert.equal(fabricated.value, null, `se inventó un perfil: ${JSON.stringify(fabricated.value)}`);
});

// ============================================================
// M4 · Regresión del endurecimiento del ciclo de seguimiento
// ============================================================

test('M4: editar un check-in MIGRADO lo reemplaza, no lo duplica', async () => {
    const checkins = await import('../src/data/checkins.js');
    seedV4();
    assert.ok(migrate.migrate({ nowISO: NOW }).ok);

    const before = checkins.list();
    assert.equal(before.length, 2);
    // el id debe derivarse de la fecha, como el resto del producto
    assert.ok(before.every((c) => c.id === `ci_${c.dateISO}`), JSON.stringify(before.map((c) => c.id)));

    // el usuario corrige el peso de un check-in migrado
    const saved = checkins.save({ ...before[0], weightKg: 80.1 }, { nowISO: NOW });
    assert.ok(saved.ok, JSON.stringify(!saved.ok && saved.error));

    const after = checkins.list();
    assert.equal(after.length, 2, `se duplicó la fecha: ${JSON.stringify(after.map((c) => c.dateISO))}`);
    assert.equal(after.find((c) => c.dateISO === before[0].dateISO)?.weightKg, 80.1);
});

test('M4: checkins.save sin contexto devuelve error, no lanza', async () => {
    const checkins = await import('../src/data/checkins.js');
    for (const context of [undefined, null, {}, 'x']) {
        const r = checkins.save({ dateISO: '2026-08-10', weightKg: 75 }, /** @type {*} */ (context));
        assert.equal(r.ok, false, `contexto ${String(context)} aceptado`);
    }
});

test('M4: un valor fuera del rango del esquema se rechaza con el campo y el límite', async () => {
    const checkins = await import('../src/data/checkins.js');
    const r = checkins.save({ dateISO: '2026-08-10', weightKg: 745 }, { nowISO: NOW });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && Array.isArray(r.issues) && r.issues.length > 0, 'sin issues no se puede explicar el fallo');
    assert.ok(!r.ok && r.issues?.[0].path.includes('weightKg'));
    // y la colección sigue siendo válida
    assert.ok(checkins.readAll().ok);
});

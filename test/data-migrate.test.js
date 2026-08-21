// @ts-check

/** M2-3 · Migrador v4→v5, contra un fixture con las formas reales del legacy. */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import * as profiles from '../src/data/profiles.js';
import * as migrate from '../src/data/migrate.js';
import { validateProfile, validateCheckins } from '../src/data/schema.js';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/v4-profile.json', import.meta.url), 'utf8'));
const NOW = '2026-08-02T12:00:00.000Z';

/** @type {import('./helpers/local-storage-mock.js').LocalStorageMock} */
let mock;

/** Siembra el almacén con los datos v4 del fixture. */
function seedV4(overrides = {}) {
    const data = { ...FIXTURE, ...overrides };
    for (const key of migrate.V4_KEYS) {
        if (data[key] === undefined) continue;
        const value = typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key]);
        mock.setItem(key, value);
    }
}

beforeEach(() => {
    mock = installLocalStorageMock();
    storage.setActiveProfile('p1');
});

test('needsMigration detecta claves v4 y deja de hacerlo tras migrar', () => {
    assert.equal(migrate.needsMigration(), false);
    seedV4();
    assert.equal(migrate.needsMigration(), true);
    assert.ok(migrate.migrate({ nowISO: NOW }).ok);
    assert.equal(migrate.needsMigration(), false);
});

test('migración completa: perfil v5 válido con muscleSource estimated (A3)', () => {
    seedV4();
    const r = migrate.migrate({ nowISO: NOW });
    assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
    assert.equal(r.value.migrated, true);
    // El id lo genera `profiles.create` y desde la v7 es OPACO (M9-1): se afirma
    // la forma y que el perfil se alcanza por él, no un literal que cambiaría en
    // cada ejecución.
    assert.match(r.value.profileId, /^[A-Za-z0-9_-]{20,40}$/,
        `el id del perfil migrado no es opaco: ${r.value.profileId}`);
    assert.equal(storage.getActiveProfile(), r.value.profileId);

    const stored = storage.get('profile');
    assert.ok(stored.ok);
    const parsed = validateProfile(stored.value);
    assert.ok(parsed.ok, JSON.stringify(!parsed.ok && parsed.errors));

    // el músculo v4 salía del ratio 0,48: JAMÁS se marca como medido
    assert.equal(parsed.value.initial.muscleSource, 'estimated');
    assert.equal(parsed.value.initial.muscleKg, null);
    assert.ok(r.value.warnings.includes('migrate.muscleMarkedEstimated'));

    // el resto del perfil se conserva
    assert.equal(parsed.value.initial.weightKg, 80);
    assert.equal(parsed.value.initial.fatPct, 20);
    assert.equal(parsed.value.user.sex, 'male');
    assert.equal(parsed.value.user.age, 35);
    assert.equal(parsed.value.user.heightCm, 178);
    assert.equal(parsed.value.startDateISO, '2026-02-02');
    assert.equal(parsed.value.target.fatPct, 15);
});

test('el peso objetivo defectuoso de v4 (50,9 kg por el clamp) NO se importa', () => {
    seedV4();
    assert.ok(migrate.migrate({ nowISO: NOW }).ok);
    const stored = storage.get('profile');
    assert.ok(stored.ok);
    const raw = JSON.stringify(stored.value);
    assert.ok(!raw.includes('50.9'), 'el peso objetivo del legacy se ha colado');
    // el objetivo v5 se expresa como composición; el peso lo deriva el motor
    assert.ok(!Object.hasOwn(/** @type {*} */ (stored.value).target, 'weight'));
    assert.ok(!Object.hasOwn(/** @type {*} */ (stored.value).target, 'weightKg'));
});

test('la proyección v4 no se migra: el plan queda vacío para regenerarse', () => {
    seedV4();
    const r = migrate.migrate({ nowISO: NOW });
    assert.ok(r.ok);
    assert.ok(r.value.warnings.includes('migrate.planRegenerationRequired'));
    const plan = storage.get('plan');
    assert.ok(plan.ok);
    assert.equal(/** @type {*} */ (plan.value).current, null);
});

test('check-ins migrados con la escala corregida (adherencia 0-100 → 1-10)', () => {
    seedV4();
    const r = migrate.migrate({ nowISO: NOW });
    assert.ok(r.ok);
    assert.equal(r.value.checkinsMigrated, 2);

    const stored = storage.get('checkins');
    assert.ok(stored.ok);
    const parsed = validateCheckins(stored.value);
    assert.ok(parsed.ok, JSON.stringify(!parsed.ok && parsed.errors));

    const [first, second] = parsed.value.items;
    assert.equal(first.dateISO, '2026-02-09');
    assert.equal(first.weightKg, 79.4);
    assert.equal(first.fatPct, 19.6);
    assert.equal(first.measuresCm.waist, 88);
    assert.equal(first.subjective.energy, 7);
    assert.equal(first.subjective.sleep, 8, 'sleepQuality v4 → sleep v5');
    assert.equal(first.subjective.adherence, 9, 'adherencia 90/100 → 9/10');
    assert.equal(first.notes, 'Primera semana, buena adherencia.');

    // el segundo tenía nulls: se omiten, no se inventan
    assert.equal(second.fatPct, null);
    assert.ok(!Object.hasOwn(second.measuresCm, 'waist'));
    assert.equal(second.subjective.adherence, 7);
});

test('las claves v4 se ARCHIVAN en tl.legacy.*, nunca se borran', () => {
    seedV4();
    const r = migrate.migrate({ nowISO: NOW });
    assert.ok(r.ok);

    for (const key of migrate.V4_KEYS) {
        assert.equal(mock.getItem(key), null, `${key} sigue presente`);
    }
    assert.ok(r.value.archivedKeys.includes('tl.legacy.userProfile'));
    assert.ok(mock.getItem('tl.legacy.userProfile'), 'no se archivó el perfil');
    assert.ok(mock.getItem('tl.legacy.generatedData'), 'no se archivó la proyección');
    // el contenido archivado es idéntico al original
    assert.deepEqual(JSON.parse(/** @type {string} */ (mock.getItem('tl.legacy.userProfile'))), FIXTURE.transformlab_userProfile);
});

test('el export de seguridad se escribe ANTES de transformar y contiene todo', () => {
    seedV4();
    assert.ok(migrate.migrate({ nowISO: NOW }).ok);
    const backup = migrate.readSafetyBackup();
    assert.ok(backup.ok && backup.value !== null);
    const parsed = JSON.parse(/** @type {string} */ (backup.value));
    assert.equal(parsed.source, 'v4');
    assert.equal(parsed.createdAtISO, NOW);
    for (const key of migrate.V4_KEYS) {
        assert.ok(Object.hasOwn(parsed.keys, key), `${key} falta en la copia de seguridad`);
    }
});

test('si la copia de seguridad no se puede escribir, NO se migra nada', () => {
    seedV4();
    mock.quotaFull = true;
    const r = migrate.migrate({ nowISO: NOW });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.error === 'migrate.backupFailed');
    // los datos v4 siguen intactos
    assert.ok(mock.getItem('transformlab_userProfile'));
    const l = profiles.list();
    assert.ok(l.ok && l.value.length === 0, 'se creó un perfil pese al fallo');
});

test('sin datos v4, migrate() no hace nada y lo dice', () => {
    const r = migrate.migrate({ nowISO: NOW });
    assert.ok(r.ok);
    assert.equal(r.value.migrated, false);
    assert.ok(r.value.warnings.includes('migrate.nothingToMigrate'));
});

test('perfil v4 corrupto o incompleto se rechaza sin dejar el almacén a medias', () => {
    for (const bad of ['{roto', JSON.stringify({ initial: {} }), JSON.stringify({ initial: { weight: 80 }, target: {}, profile: {} })]) {
        mock = installLocalStorageMock();
        storage.setActiveProfile('p1');
        mock.setItem('transformlab_userProfile', bad);
        const r = migrate.migrate({ nowISO: NOW });
        assert.equal(r.ok, false, `aceptó: ${bad.slice(0, 30)}`);
        // no queda un perfil huérfano registrado
        const l = profiles.list();
        assert.ok(l.ok && l.value.length === 0);
    }
});

test('check-ins corruptos o incompletos se saltan; el resto se migra igual', () => {
    seedV4({
        transformlab_checkins: [
            null,
            'basura',
            { id: 'x', date: 'no-es-fecha', measurements: { weight: 80 }, selfReport: {} },
            { id: 'y', date: '2026-03-01', measurements: {}, selfReport: {} },
            { id: 'z', date: '2026-03-08', measurements: { weight: 77 }, selfReport: { energy: 99 } }
        ]
    });
    const r = migrate.migrate({ nowISO: NOW });
    assert.ok(r.ok);
    assert.equal(r.value.checkinsMigrated, 1, 'solo el último es migrable');
    assert.ok(r.value.warnings.includes('migrate.checkinsSkipped'));
    const stored = storage.get('checkins');
    assert.ok(stored.ok);
    const parsed = validateCheckins(stored.value);
    assert.ok(parsed.ok, JSON.stringify(!parsed.ok && parsed.errors));
    assert.equal(parsed.value.items[0].subjective.energy, 10, 'energía 99 acotada a 10');
});

test('el sexo desconocido cae a male con aviso explícito, jamás en silencio', () => {
    seedV4({
        transformlab_userProfile: {
            ...FIXTURE.transformlab_userProfile,
            profile: { ...FIXTURE.transformlab_userProfile.profile, sex: 'otro' }
        }
    });
    const r = migrate.migrate({ nowISO: NOW });
    assert.ok(r.ok);
    assert.ok(r.value.warnings.includes('migrate.sexDefaulted'));
});

test('si falla DESPUÉS de crear el perfil, el rollback lo deshace (sin huérfanos)', () => {
    seedV4();
    // cuota realista: solo fallan las escrituras que HACEN CRECER el almacén,
    // como en el navegador. El rollback encoge el índice, así que sí puede
    // completarse — que es justo lo que se quiere comprobar.
    mock.maxChars = mock.usedChars + 3000;
    const r = migrate.migrate({ nowISO: NOW });
    assert.equal(r.ok, false, 'la cuota debería haber cortado la migración');

    mock.maxChars = Infinity;
    const l = profiles.list();
    assert.ok(l.ok);
    assert.equal(l.value.length, 0, `quedaron perfiles huérfanos: ${JSON.stringify(l.value)}`);
});

test('un intento fallido NUNCA bloquea el siguiente: el reintento migra de verdad', () => {
    seedV4();
    // primer intento: el almacén se llena
    let writes = 0;
    const realSet = mock.setItem.bind(mock);
    mock.setItem = (/** @type {string} */ k, /** @type {string} */ v) => {
        if (++writes > 10) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
        return realSet(k, v);
    };
    assert.equal(migrate.migrate({ nowISO: NOW }).ok, false);

    // los datos v4 siguen intactos y aún hace falta migrar
    assert.equal(migrate.needsMigration(), true);
    assert.ok(mock.getItem('transformlab_userProfile'));

    // el usuario libera espacio y reintenta: debe funcionar
    mock.setItem = realSet;
    const second = migrate.migrate({ nowISO: NOW });
    assert.ok(second.ok, `el reintento quedó bloqueado: ${JSON.stringify(!second.ok && second.error)}`);
    assert.equal(second.value.migrated, true);
    assert.equal(second.value.checkinsMigrated, 2);
    assert.equal(migrate.needsMigration(), false);
});

test('el archivado copia TODO antes de borrar nada: un fallo no pierde claves v4', () => {
    seedV4();
    const originales = migrate.V4_KEYS.filter((k) => mock.getItem(k) !== null);
    let writes = 0;
    const realSet = mock.setItem.bind(mock);
    mock.setItem = (/** @type {string} */ k, /** @type {string} */ v) => {
        // deja pasar backup + perfil + checkins, y corta durante el archivado
        if (++writes > 14) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
        return realSet(k, v);
    };
    migrate.migrate({ nowISO: NOW });
    mock.setItem = realSet;

    // ni una sola clave v4 se ha perdido: o sigue en su sitio, o está archivada
    for (const key of originales) {
        const archived = `tl.legacy.${key.slice('transformlab_'.length)}`;
        assert.ok(mock.getItem(key) !== null || mock.getItem(archived) !== null, `${key} se perdió`);
    }
    // y la copia de seguridad completa está disponible pase lo que pase
    const b = migrate.readSafetyBackup();
    assert.ok(b.ok && b.value !== null);
    const parsed = JSON.parse(/** @type {string} */ (b.value));
    for (const key of originales) assert.ok(Object.hasOwn(parsed.keys, key), `${key} falta en el backup`);
});

test('migrar dos veces no duplica perfiles (las claves v4 ya no están)', () => {
    seedV4();
    assert.ok(migrate.migrate({ nowISO: NOW }).ok);
    const second = migrate.migrate({ nowISO: NOW });
    assert.ok(second.ok);
    assert.equal(second.value.migrated, false);
    const l = profiles.list();
    assert.ok(l.ok && l.value.length === 1);
});

test('el texto hostil del legacy sobrevive como texto plano, sin ejecutarse', () => {
    seedV4({
        transformlab_checkins: [{
            id: 'ci1', date: '2026-03-01',
            measurements: { weight: 80 },
            selfReport: { notes: '<img src=x onerror=alert(1)>' }
        }]
    });
    const r = migrate.migrate({ nowISO: NOW });
    assert.ok(r.ok);
    const stored = storage.get('checkins');
    assert.ok(stored.ok);
    assert.equal(/** @type {*} */ (stored.value).items[0].notes, '<img src=x onerror=alert(1)>');
});

// @ts-check

/**
 * Migración de esquema v5 → v6 (V2-M0).
 *
 * EL DEFECTO QUE ESTOS TESTS IMPIDEN, reproducido antes de escribirlos. Subir
 * `SCHEMA_VERSION` rompía la aplicación por dos sitios a la vez:
 *
 * 1. El namespace del almacén incluye la versión, así que las claves del usuario
 *    (`tl.5.p1.checkins`) quedaban invisibles bajo el prefijo nuevo.
 * 2. `rootValidator` rechazaba `schemaVersion !== 6`, así que aunque se leyera
 *    la clave vieja, la colección degradaba a vacía.
 *
 * Y la cadena acababa en pérdida REAL: sin perfil válido, `main.js` arranca el
 * onboarding y al completarlo el usuario sobrescribe su propio perfil.
 *
 * El test `migracion_sin_perdida` es el que vigila que eso no vuelva.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isICloudDuplicate } from './helpers/tree.js';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import * as backup from '../src/data/backup.js';
import * as profiles from '../src/data/profiles.js';
import { SCHEMA_VERSION, MIGRATABLE_FROM, rootPrefix } from '../src/data/version.js';
import { migrateValue, migrateStore, needsMigration, readMigrationBackup } from '../src/data/migrations.js';
import { validateCollection, COLLECTIONS } from '../src/data/schema.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NOW = '2026-08-08T12:00:00.000Z';

/** @type {import('./helpers/local-storage-mock.js').LocalStorageMock} */ let mock;

beforeEach(() => {
    mock = installLocalStorageMock();
    storage.setActiveProfile('p1');
});

/** Un usuario REAL de la v1: perfil completo, plan, check-ins y ajustes, todo en v5. */
function seedV5User() {
    const v5 = rootPrefix(5);
    // El índice REAL lleva `schemaVersion` y `activeProfileId`; el fixture
    // anterior se los saltaba y por eso los tests no vieron que la migración
    // dejaba el índice en la versión vieja (lo cazó el navegador).
    mock.setItem(`${v5}profiles`, JSON.stringify({
        schemaVersion: 5,
        activeProfileId: 'p1',
        profiles: [{ id: 'p1', name: 'Dani', createdAtISO: '2026-01-01T00:00:00.000Z' }]
    }));
    mock.setItem(`${v5}p1.profile`, JSON.stringify({
        schemaVersion: 5,
        name: 'Dani',
        createdAtISO: '2026-01-01T00:00:00.000Z',
        user: { sex: 'male', age: 30, heightCm: 175, activityLevel: 'moderate', trainingStatus: 'intermediate' },
        initial: { weightKg: 88, fatPct: 26, muscleKg: 31.9, muscleSource: 'estimated' },
        target: { fatPct: 18, muscleKg: 33 },
        startDateISO: '2026-01-01',
        intensity: 'moderate'
    }));
    mock.setItem(`${v5}p1.checkins`, JSON.stringify({
        schemaVersion: 5,
        items: [0, 7, 14].map((n) => ({
            id: `ci_2026-01-${String(1 + n).padStart(2, '0')}`,
            dateISO: `2026-01-${String(1 + n).padStart(2, '0')}`,
            weightKg: 88 - n * 0.1,
            fatPct: 26, scaleMuscleKg: null, boneKg: null,
            measuresCm: {}, subjective: {}, notes: '',
            createdAtISO: '2026-01-01T00:00:00.000Z', editedAtISO: null
        }))
    }));
    mock.setItem(`${v5}p1.settings`, JSON.stringify({
        schemaVersion: 5, locale: 'en', activeMeasures: ['waist'], fluctuationVisible: true, reminder: null
    }));
}

/* ---------------------------------------------------------------------- *
 * El invariante de la milestone
 * ---------------------------------------------------------------------- */

test('migracion_sin_perdida: un usuario de la v1 conserva TODO al pasar a la v2', () => {
    seedV5User();

    const report = migrateStore({ nowISO: NOW });
    assert.ok(report.ok, `la migración falló: ${!report.ok && report.error}`);
    assert.equal(report.value.migrated, true);
    assert.equal(report.value.from, 5);
    assert.deepEqual(report.value.warnings, [], 'hubo claves que no se pudieron migrar');

    // El perfil: lo que decide si la app arranca normal o tira al onboarding.
    const profile = storage.get('profile');
    assert.ok(profile.ok && profile.value !== null, 'el perfil no llegó a la v6');
    const validProfile = validateCollection('profile', profile.value);
    assert.ok(validProfile.ok, 'el perfil migrado no valida: la app abriría el onboarding');
    assert.equal(validProfile.value.name, 'Dani');
    assert.equal(validProfile.value.initial.weightKg, 88);
    assert.equal(validProfile.value.schemaVersion, SCHEMA_VERSION);

    // Los check-ins: el año de datos del usuario.
    const checkins = validateCollection('checkins', storage.get('checkins').ok
        ? /** @type {*} */ (storage.get('checkins')).value : null);
    assert.ok(checkins.ok, 'los check-ins migrados no validan');
    assert.equal(checkins.value.items.length, 3, 'se perdieron check-ins');
    assert.equal(checkins.value.items[0].weightKg, 88);

    // Sus ajustes, incluido el idioma que eligió.
    const settings = validateCollection('settings', storage.get('settings').ok
        ? /** @type {*} */ (storage.get('settings')).value : null);
    assert.ok(settings.ok);
    assert.equal(settings.value.locale, 'en', 'se perdió el idioma elegido');
    assert.equal(settings.value.fluctuationVisible, true);

    // El índice de perfiles, que no es una colección y se copia tal cual.
    const index = mock.getItem(`${rootPrefix()}profiles`);
    assert.ok(index !== null, 'el índice de perfiles no llegó a la v6');
    const parsedIndex = JSON.parse(index);
    assert.equal(parsedIndex.profiles[0].name, 'Dani');
    assert.equal(parsedIndex.activeProfileId, 'p1');
    // Y su VERSIÓN: copiarlo tal cual dejaba el índice en la 5, `readIndex()`
    // devolvía `profiles.indexCorrupt` y la aplicación no encontraba ningún
    // perfil — todos los datos migrados y la app inservible.
    assert.equal(parsedIndex.schemaVersion, SCHEMA_VERSION,
        'el índice de perfiles se quedó en la versión vieja');
});

test('la migración NUNCA borra: los datos originales siguen ahí', () => {
    // Es la red. Si la transformación tuviera un fallo que no vemos hoy, los
    // bytes del usuario siguen bajo `tl.5.` y se pueden rescatar a mano.
    seedV5User();
    const antes = mock.getItem(`${rootPrefix(5)}p1.checkins`);
    migrateStore({ nowISO: NOW });
    assert.equal(mock.getItem(`${rootPrefix(5)}p1.checkins`), antes,
        'la migración destruyó los datos de origen');
});

test('hay copia de seguridad ANTES de transformar', () => {
    seedV5User();
    const report = migrateStore({ nowISO: NOW });
    assert.ok(report.ok);
    const copia = /** @type {*} */ (readMigrationBackup(5));
    assert.ok(copia, 'no se escribió copia de seguridad');
    assert.equal(copia.fromVersion, 5);
    assert.equal(copia.toVersion, SCHEMA_VERSION);
    assert.ok(Object.keys(copia.keys).length >= 4, 'la copia no incluye todas las claves');
    assert.match(JSON.stringify(copia.keys), /Dani/, 'la copia no contiene los datos reales');
});

test('migrar dos veces no duplica ni pisa lo que el usuario hizo después', () => {
    seedV5User();
    migrateStore({ nowISO: NOW });
    // El usuario borra un check-in ya en la v6…
    storage.set('checkins', { schemaVersion: SCHEMA_VERSION, items: [] });
    // …y la migración vuelve a correr (otra pestaña, un refresco raro).
    const segunda = migrateStore({ nowISO: NOW });
    assert.ok(segunda.ok);
    const checkins = validateCollection('checkins', /** @type {*} */ (storage.get('checkins')).value);
    assert.ok(checkins.ok);
    assert.equal(checkins.value.items.length, 0,
        'la segunda migración resucitó datos que el usuario había borrado');
});

test('sin datos de una versión anterior, no hace nada', () => {
    const pending = needsMigration();
    assert.equal(pending.pending, false);
    const report = migrateStore({ nowISO: NOW });
    assert.ok(report.ok);
    assert.equal(report.value.migrated, false);
    assert.equal(report.value.keysMigrated, 0);
});

/* ---------------------------------------------------------------------- *
 * La red de seguridad en memoria
 * ---------------------------------------------------------------------- */

test('validateCollection acepta y migra un valor de la versión anterior', () => {
    // Es lo que hace que CUALQUIER lectura funcione aunque `migrateStore` no
    // haya corrido: un backup importado, otra pestaña, un test.
    const v5 = { schemaVersion: 5, items: [] };
    const r = validateCollection('checkins', v5);
    assert.ok(r.ok, 'una colección v5 no valida bajo v6');
    assert.equal(r.value.schemaVersion, SCHEMA_VERSION);
});

test('un valor del FUTURO se rechaza en vez de destruirse', () => {
    // Lo escribió una versión más nueva de la aplicación (otra pestaña ya
    // actualizada, un backup de mañana). Migrar hacia atrás es adivinar.
    const futuro = migrateValue('checkins', { schemaVersion: SCHEMA_VERSION + 1, items: [] });
    assert.equal(futuro.ok, false);
    assert.equal(!futuro.ok && futuro.error, 'migrations.fromTheFuture');
    assert.equal(validateCollection('checkins', { schemaVersion: SCHEMA_VERSION + 1, items: [] }).ok, false);
});

test('migrateValue es PURA: no muta lo que recibe', () => {
    const original = { schemaVersion: 5, items: [] };
    const copia = JSON.parse(JSON.stringify(original));
    migrateValue('checkins', original);
    assert.deepEqual(original, copia, 'migrateValue mutó su entrada');
});

/* ---------------------------------------------------------------------- *
 * Higiene del versionado
 * ---------------------------------------------------------------------- */

test('version_unica: SCHEMA_VERSION se declara en UN solo sitio', () => {
    // Estaba duplicado en schema.js y storage.js. Dos constantes que significan
    // lo mismo y que nadie ata es una bomba: el día que una suba y la otra no,
    // `storage` escribe en un prefijo y `schema` valida contra otro.
    /** @type {string[]} */ const declaraciones = [];
    const walk = (/** @type {string} */ dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (isICloudDuplicate(entry.name)) continue;
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) {
                const source = readFileSync(full, 'utf8');
                // una DECLARACIÓN, no un import ni un reexport
                if (/^(export )?const SCHEMA_VERSION\s*=/m.test(source)) {
                    declaraciones.push(full.slice(ROOT.length));
                }
            }
        }
    };
    walk(join(ROOT, 'src'));
    assert.deepEqual(declaraciones, ['src/data/version.js'],
        `SCHEMA_VERSION declarado en más de un sitio: ${declaraciones.join(', ')}`);
});

test('toda versión migrable tiene su prefijo y es anterior a la vigente', () => {
    assert.ok(MIGRATABLE_FROM.length > 0, 'no se declara ninguna versión migrable');
    for (const v of MIGRATABLE_FROM) {
        assert.ok(v < SCHEMA_VERSION, `${v} no es anterior a ${SCHEMA_VERSION}`);
        assert.equal(rootPrefix(v), `tl.${v}.`);
    }
});

test('las colecciones nuevas de la v2 están registradas y su default valida', () => {
    // Registrarlas en COLLECTIONS es lo que las mete SOLAS en la siembra de
    // perfil, el export/import de backups y el presupuesto de cuota.
    for (const nombre of ['intakeLog', 'preferences', 'pantry', 'recipes',
        'supplementsPlan', 'volumeLog', 'steps']) {
        assert.ok(Object.hasOwn(COLLECTIONS, nombre), `falta la colección ${nombre}`);
        const porDefecto = COLLECTIONS[nombre].makeDefault();
        assert.equal(porDefecto.schemaVersion, SCHEMA_VERSION,
            `${nombre}.makeDefault() no lleva la versión vigente`);
        const r = validateCollection(nombre, porDefecto);
        assert.ok(r.ok, `${nombre}.makeDefault() no pasa su propio validador: ${JSON.stringify(!r.ok && r.errors)}`);
    }
});

/* ---------------------------------------------------------------------- *
 * Compatibilidad de backups y lectura cruzada de perfiles
 * ---------------------------------------------------------------------- */

test('backup_compatible: un backup exportado en v5 se importa en v6', () => {
    // Antes se rechazaba de plano, o sea que cada subida de esquema convertía
    // los backups de ayer en papel mojado — justo cuando más falta hacen.
    const v5Backup = JSON.stringify({
        formatVersion: 1,
        schemaVersion: 5,
        exportedAtISO: NOW,
        profiles: [{
            id: 'p1', name: 'Dani', createdAtISO: NOW,
            collections: {
                checkins: {
                    schemaVersion: 5,
                    items: [{
                        id: 'ci_2026-01-01', dateISO: '2026-01-01', weightKg: 88, fatPct: 26,
                        scaleMuscleKg: null, boneKg: null, measuresCm: {}, subjective: {},
                        notes: '', createdAtISO: NOW, editedAtISO: null
                    }]
                }
            }
        }]
    });
    const inspected = backup.inspect(v5Backup);
    assert.ok(inspected.ok, `un backup v5 no se pudo inspeccionar: ${!inspected.ok && inspected.error}`);
    assert.equal(inspected.value.summary.profiles[0].checkins, 1, 'se perdió el check-in del backup v5');

    const applied = backup.apply(inspected.value.backup, { nowISO: NOW });
    assert.ok(applied.ok, `no se pudo aplicar: ${!applied.ok && applied.error}`);
    const restored = validateCollection('checkins', /** @type {*} */ (storage.get('checkins')).value);
    assert.ok(restored.ok);
    assert.equal(restored.value.items.length, 1);
    assert.equal(restored.value.schemaVersion, SCHEMA_VERSION, 'no se migró al restaurar');
});

test('un backup del FUTURO se rechaza con su propio error', () => {
    const futuro = JSON.stringify({
        formatVersion: 1, schemaVersion: SCHEMA_VERSION + 1, exportedAtISO: NOW,
        profiles: [{ id: 'p1', name: 'X', createdAtISO: NOW, collections: {} }]
    });
    const r = backup.inspect(futuro);
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error, 'backup.schemaFromTheFuture');
});

test('getForProfile lee otro perfil SIN cambiar el activo', () => {
    // La alternativa era `setActiveProfile` de ida y vuelta, que es el patrón
    // que abrió la fuga entre perfiles de M7.
    storage.setActiveProfile('p1');
    storage.set('settings', { schemaVersion: SCHEMA_VERSION, locale: 'es', activeMeasures: [], fluctuationVisible: false, reminder: null });
    storage.setActiveProfile('p2');
    storage.set('settings', { schemaVersion: SCHEMA_VERSION, locale: 'en', activeMeasures: [], fluctuationVisible: false, reminder: null });
    storage.setActiveProfile('p1');

    const otro = storage.getForProfile('p2', 'settings');
    assert.ok(otro.ok && otro.value !== null);
    assert.equal(/** @type {*} */ (otro.value).locale, 'en');
    assert.equal(storage.getActiveProfile(), 'p1', 'getForProfile cambió el perfil activo');
    // y lo del perfil activo sigue siendo lo suyo
    assert.equal(/** @type {*} */ (/** @type {*} */ (storage.get('settings')).value).locale, 'es');
});

test('getForProfile rechaza un profileId que rompería el namespace', () => {
    for (const malo of ['', '   ', 'p1.otra', /** @type {*} */ (null), /** @type {*} */ (7)]) {
        assert.equal(storage.getForProfile(malo, 'settings').ok, false, `aceptó ${JSON.stringify(malo)}`);
    }
});

test('tras migrar, la aplicación ENCUENTRA el perfil (no solo lo copia)', () => {
    // El test de arriba comprueba los bytes; este comprueba lo que le importa
    // al usuario: que la app arranque en su dashboard y no en un estado de
    // error. Es exactamente lo que falló al abrirlo en el navegador.
    seedV5User();
    assert.ok(migrateStore({ nowISO: NOW }).ok);

    const index = profiles.readIndex();
    assert.ok(index.ok, `readIndex falló tras migrar: ${!index.ok && index.error}`);
    assert.equal(index.value.profiles.length, 1);
    assert.equal(index.value.profiles[0].name, 'Dani');

    profiles.activateStored();
    const active = profiles.getActive();
    assert.ok(active.ok, 'no hay perfil activo tras migrar');
    assert.equal(active.value, 'p1');
});

test('la migración corre UNA vez, no en cada arranque', () => {
    // Como no se borra nada, sin testigo `needsMigration()` diría «sí» siempre:
    // cada carga rehacía el bucle y REESCRIBÍA la copia de seguridad, borrando
    // la del día de la migración real. Se vio en la consola del navegador.
    seedV5User();
    const primera = migrateStore({ nowISO: NOW });
    assert.ok(primera.ok && primera.value.migrated);
    assert.ok(primera.value.keysMigrated > 0);

    assert.equal(needsMigration().pending, false, 'sigue diciendo que hay migración pendiente');

    const segunda = migrateStore({ nowISO: '2026-09-09T00:00:00.000Z' });
    assert.ok(segunda.ok);
    assert.equal(segunda.value.migrated, false, 'volvió a migrar en el segundo arranque');

    // Y la copia de seguridad sigue siendo la del día de la migración.
    const copia = /** @type {*} */ (readMigrationBackup(5));
    assert.equal(copia.migratedAtISO, NOW, 'se reescribió la copia de seguridad');
});

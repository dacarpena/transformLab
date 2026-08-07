// @ts-check

/**
 * M2-1 · Esquema v5: typedefs + validadores de forma.
 * Contrato: los validadores NUNCA lanzan, devuelven {ok,value}|{ok:false,errors},
 * y el valor devuelto es una COPIA saneada solo con claves conocidas (las
 * desconocidas se descartan: es el vector de import de backups).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    SCHEMA_VERSION,
    COLLECTIONS,
    makeDefault,
    sanitizeText,
    validateProfilesIndex,
    validateProfile,
    validatePlan,
    validateCheckins,
    validateSettings,
    validatePhotos,
    validateAchievements,
    validateNutrition,
    validateTraining
} from '../src/data/schema.js';

const PROFILE_OK = {
    schemaVersion: 5,
    name: 'Dani',
    createdAtISO: '2026-08-02T10:00:00.000Z',
    user: { sex: 'male', age: 35, heightCm: 178, activityLevel: 'moderate', trainingStatus: 'intermediate' },
    initial: { weightKg: 80, fatPct: 20, muscleKg: null, muscleSource: 'estimated' },
    target: { fatPct: 15, muscleKg: 33 },
    startDateISO: '2026-08-03',
    intensity: 'moderate'
};

test('SCHEMA_VERSION es 5 y COLLECTIONS declara las 8 colecciones por perfil', () => {
    assert.equal(SCHEMA_VERSION, 5);
    const names = Object.keys(COLLECTIONS).sort();
    assert.deepEqual(names, ['achievements', 'checkins', 'nutrition', 'photos', 'plan', 'profile', 'settings', 'training']);
});

test('todo default generado valida contra su propio validador', () => {
    for (const [name, spec] of Object.entries(COLLECTIONS)) {
        const def = makeDefault(/** @type {*} */ (name));
        const res = spec.validate(def);
        assert.equal(res.ok, true, `${name}: ${JSON.stringify(!res.ok && res.errors)}`);
        assert.equal(def.schemaVersion, SCHEMA_VERSION, `${name} sin schemaVersion`);
    }
});

test('ningún validador lanza jamás, con ninguna entrada', () => {
    const hostiles = [null, undefined, 0, '', 'x', [], true, NaN, Symbol('s'), () => {}, Object.create(null)];
    const validators = [validateProfilesIndex, validateProfile, validatePlan, validateCheckins,
        validateSettings, validatePhotos, validateAchievements, validateNutrition, validateTraining];
    for (const v of validators) {
        for (const [i, h] of hostiles.entries()) {
            const res = v(/** @type {*} */ (h));
            assert.equal(res.ok, false, `${v.name}(hostil #${i}) debería fallar`);
            assert.ok(!res.ok && Array.isArray(res.errors) && res.errors.length > 0);
        }
    }
});

test('schemaVersion ausente o distinto de 5 es error explícito', () => {
    const { schemaVersion, ...sinVersion } = PROFILE_OK;
    void schemaVersion;
    const a = validateProfile(sinVersion);
    assert.equal(a.ok, false);
    assert.ok(!a.ok && a.errors.some((e) => e.code === 'schema.versionMissing'));

    const b = validateProfile({ ...PROFILE_OK, schemaVersion: 4 });
    assert.equal(b.ok, false);
    assert.ok(!b.ok && b.errors.some((e) => e.code === 'schema.versionUnsupported'));
});

test('perfil válido pasa y devuelve una COPIA (no la misma referencia)', () => {
    const res = validateProfile(PROFILE_OK);
    assert.ok(res.ok, JSON.stringify(!res.ok && res.errors));
    assert.notEqual(res.value, PROFILE_OK);
    assert.equal(res.value.name, 'Dani');
    assert.equal(res.value.initial.muscleSource, 'estimated');
});

test('las claves desconocidas se DESCARTAN, no se copian ni hacen fallar', () => {
    const res = validateProfile({ ...PROFILE_OK, hackKey: 'x', onerror: 'alert(1)' });
    assert.ok(res.ok);
    assert.ok(!('hackKey' in res.value));
    assert.ok(!('onerror' in res.value));
});

test('contaminación de prototipo: __proto__ y constructor no pasan al objeto ni al Object.prototype', () => {
    const hostil = JSON.parse('{"schemaVersion":5,"__proto__":{"pwned":true},"constructor":{"x":1},"activeProfileId":"p1","profiles":[{"id":"p1","name":"a","createdAtISO":"2026-08-02T00:00:00.000Z"}]}');
    const res = validateProfilesIndex(hostil);
    assert.ok(res.ok, JSON.stringify(!res.ok && res.errors));
    assert.equal(/** @type {*} */ ({}).pwned, undefined, 'Object.prototype contaminado');
    assert.equal(Object.getPrototypeOf(res.value), Object.prototype);
    assert.ok(!Object.hasOwn(res.value, 'pwned'));
});

test('validación de campos: tipos, rangos y enums del perfil', () => {
    /** @param {object} patch */
    const bad = (patch) => validateProfile({ ...PROFILE_OK, ...patch });
    assert.equal(bad({ name: 123 }).ok, false);
    assert.equal(bad({ name: '' }).ok, false);
    assert.equal(bad({ startDateISO: '2026-13-45' }).ok, false);
    assert.equal(bad({ startDateISO: 'ayer' }).ok, false);
    assert.equal(bad({ intensity: 'extreme' }).ok, false);
    assert.equal(bad({ user: { ...PROFILE_OK.user, sex: 'otro' } }).ok, false);
    assert.equal(bad({ user: { ...PROFILE_OK.user, activityLevel: 'toString' } }).ok, false, 'clave de prototipo aceptada como enum');
    assert.equal(bad({ initial: { ...PROFILE_OK.initial, muscleSource: 'invented' } }).ok, false);
    assert.equal(bad({ initial: { ...PROFILE_OK.initial, weightKg: NaN } }).ok, false);
    assert.equal(bad({ initial: { ...PROFILE_OK.initial, weightKg: Infinity } }).ok, false);
    assert.equal(bad({ target: { fatPct: 15 } }).ok, false, 'target sin muscleKg');
});

test('A3: muscleSource es obligatorio en initial y solo admite measured|estimated|derived', () => {
    const { muscleSource, ...sinFuente } = PROFILE_OK.initial;
    void muscleSource;
    assert.equal(validateProfile({ ...PROFILE_OK, initial: sinFuente }).ok, false);
    for (const src of ['measured', 'estimated', 'derived']) {
        const r = validateProfile({ ...PROFILE_OK, initial: { ...PROFILE_OK.initial, muscleSource: src, muscleKg: src === 'estimated' ? null : 33 } });
        assert.ok(r.ok, `${src}: ${JSON.stringify(!r.ok && r.errors)}`);
    }
});

test('E10/E11: las cifras de báscula del perfil son opcionales y se guardan tal cual', () => {
    const conBascula = {
        ...PROFILE_OK,
        initial: { ...PROFILE_OK.initial, muscleSource: 'derived', muscleKg: 29.24, scaleMuscleKg: 56.56, boneKg: 3.12 },
        target: { fatPct: 15, muscleKg: 32.68, scaleMuscleKg: 60 }
    };
    const r = validateProfile(conBascula);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    assert.equal(r.value.initial.scaleMuscleKg, 56.56);
    assert.equal(r.value.initial.boneKg, 3.12);
    assert.equal(r.value.target.scaleMuscleKg, 60);

    // Y un perfil de antes de E11, sin la meta en unidades de báscula, sigue
    // validando: el campo llega como null, no rompe el registro.
    const r2 = validateProfile(PROFILE_OK);
    assert.ok(r2.ok, JSON.stringify(!r2.ok && r2.errors));
    assert.equal(r2.value.target.scaleMuscleKg, null);
});

test('check-ins: peso obligatorio, resto opcional, subjetivas 1-10, medidas configurables', () => {
    const base = {
        schemaVersion: 5,
        items: [{
            id: 'ci_1', dateISO: '2026-08-10', weightKg: 79.4, fatPct: 19.5,
            measuresCm: { waist: 88, hip: null },
            subjective: { energy: 7, sleep: 8, adherence: 9, motivation: 6 },
            notes: 'buena semana', createdAtISO: '2026-08-10T08:00:00.000Z'
        }]
    };
    assert.ok(validateCheckins(base).ok, JSON.stringify(!validateCheckins(base).ok && validateCheckins(base).errors));

    // peso obligatorio
    const sinPeso = { ...base, items: [{ ...base.items[0], weightKg: undefined }] };
    assert.equal(validateCheckins(sinPeso).ok, false);

    // subjetivas fuera de 1-10
    for (const v of [0, 11, 5.5, -1]) {
        const r = validateCheckins({ ...base, items: [{ ...base.items[0], subjective: { ...base.items[0].subjective, energy: v } }] });
        assert.equal(r.ok, false, `energy=${v} aceptado`);
    }
    // todas las subjetivas son opcionales
    assert.ok(validateCheckins({ ...base, items: [{ ...base.items[0], subjective: {} }] }).ok);
    // medida desconocida se descarta, no rompe
    const conExtra = validateCheckins({ ...base, items: [{ ...base.items[0], measuresCm: { waist: 88, tentacle: 12 } }] });
    assert.ok(conExtra.ok);
    assert.ok(!('tentacle' in conExtra.value.items[0].measuresCm));
});

test('E11: el check-in admite músculo y hueso de báscula, y los de antes siguen valiendo', () => {
    const base = {
        schemaVersion: 5,
        items: [{
            id: 'ci_1', dateISO: '2026-08-10', weightKg: 80.4, fatPct: 25.8,
            scaleMuscleKg: 56.9, boneKg: 3.12,
            measuresCm: {}, subjective: {}, createdAtISO: '2026-08-10T08:00:00.000Z'
        }]
    };
    const r = validateCheckins(base);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    assert.equal(r.value.items[0].scaleMuscleKg, 56.9);
    assert.equal(r.value.items[0].boneKg, 3.12);

    // Un check-in guardado antes de E11 no tiene esos campos. Tiene que
    // seguir validando: si no, el import de un backup antiguo perdería la
    // colección ENTERA sin decir nada.
    const { scaleMuscleKg, boneKg, ...antiguo } = base.items[0];
    void scaleMuscleKg; void boneKg;
    const r2 = validateCheckins({ ...base, items: [antiguo] });
    assert.ok(r2.ok, JSON.stringify(!r2.ok && r2.errors));
    assert.equal(r2.value.items[0].scaleMuscleKg, null);
    assert.equal(r2.value.items[0].boneKg, null);

    // Y una cifra imposible se rechaza, no se recorta.
    for (const patch of [{ scaleMuscleKg: 0 }, { scaleMuscleKg: 500 }, { boneKg: 0.1 }, { boneKg: 40 }, { scaleMuscleKg: 'mucho' }]) {
        assert.equal(validateCheckins({ ...base, items: [{ ...base.items[0], ...patch }] }).ok, false, JSON.stringify(patch));
    }
});

test('plan: current opcional (aún sin plan) e historial de recalibraciones (E1)', () => {
    const vacio = makeDefault('plan');
    assert.ok(validatePlan(vacio).ok);
    assert.equal(vacio.current, null);
    assert.deepEqual(vacio.history, []);

    const conPlan = {
        schemaVersion: 5,
        current: { phases: [{ type: 'cut', days: 30, expected: { fatDeltaKg: -2, muscleDeltaKg: -0.1 }, nominalKcal: { targetKcal: 2200, deficitKcal: 500, tdeeKcal: 2700, flooredBySafety: false } }], totalDays: 30, summary: { targetWeightKg: 78, fatDeltaKg: -2, muscleDeltaKg: -0.1 }, warnings: [] },
        params: { startDateISO: '2026-08-03', seed: 12345, fluctuation: false },
        history: [{ plan: null, params: { startDateISO: '2026-01-01', seed: 1, fluctuation: false }, archivedAtISO: '2026-08-02T10:00:00.000Z', reason: 'recalibration' }]
    };
    const r = validatePlan(conPlan);
    assert.ok(r.ok, JSON.stringify(!r.ok && r.errors));
    // fase con days no entero → error
    const roto = JSON.parse(JSON.stringify(conPlan));
    roto.current.phases[0].days = 3.5;
    assert.equal(validatePlan(roto).ok, false);
});

test('settings: locale de la lista, medidas activas del set conocido, recordatorio opcional', () => {
    const s = { schemaVersion: 5, locale: 'es', activeMeasures: ['waist', 'hip'], fluctuationVisible: false, reminder: { weekday: 1, hour: 9 } };
    assert.ok(validateSettings(s).ok);
    assert.equal(validateSettings({ ...s, locale: 'fr' }).ok, false);
    assert.equal(validateSettings({ ...s, activeMeasures: ['waist', 'tentacle'] }).ok, false);
    assert.equal(validateSettings({ ...s, reminder: { weekday: 9, hour: 9 } }).ok, false);
    assert.equal(validateSettings({ ...s, reminder: { weekday: 1, hour: 24 } }).ok, false);
    assert.ok(validateSettings({ ...s, reminder: null }).ok);
});

test('índice de perfiles: ids únicos, activo presente en la lista', () => {
    const idx = { schemaVersion: 5, activeProfileId: 'p1', profiles: [{ id: 'p1', name: 'A', createdAtISO: '2026-08-02T00:00:00.000Z' }] };
    assert.ok(validateProfilesIndex(idx).ok);
    // activo que no existe
    assert.equal(validateProfilesIndex({ ...idx, activeProfileId: 'p9' }).ok, false);
    // ids duplicados
    const dup = { ...idx, profiles: [idx.profiles[0], { ...idx.profiles[0] }] };
    assert.equal(validateProfilesIndex(dup).ok, false);
    // id con punto rompería el namespace tl.5.<pid>.
    assert.equal(validateProfilesIndex({ activeProfileId: 'a.b', schemaVersion: 5, profiles: [{ id: 'a.b', name: 'A', createdAtISO: '2026-08-02T00:00:00.000Z' }] }).ok, false);
});

test('los errores llevan código y ruta, sin prosa (i18n-ready)', () => {
    const r = validateProfile({ schemaVersion: 5, name: 123, user: {}, initial: {}, target: {}, startDateISO: 'x', intensity: 'y', createdAtISO: 'z' });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.errors.length > 0);
    for (const e of !r.ok ? r.errors : []) {
        assert.match(e.code, /^[a-z]+\.[a-zA-Z]+$/, `código inválido: ${e.code}`);
        assert.equal(typeof e.path, 'string');
        assert.ok(!('message' in e));
    }
});

// ---- sanitizeText: el saneado de datos hostiles del import (M2-4) ----

test('sanitizeText deja el HTML como TEXTO literal (escapar es tarea del render, F6)', () => {
    const payload = '<img src=x onerror=alert(1)>';
    assert.equal(sanitizeText(payload), payload);
});

test('sanitizeText elimina caracteres de control y recorta longitud', () => {
    assert.equal(sanitizeText('a bc'), 'abc');
    assert.equal(sanitizeText('  hola  '), 'hola');
    assert.equal(sanitizeText('x'.repeat(5000)).length, 2000);
    assert.equal(sanitizeText('x'.repeat(50), 10).length, 10);
    assert.equal(sanitizeText('salto\nde\nlínea'), 'salto\nde\nlínea', 'los saltos de línea se conservan');
});

test('sanitizeText degrada con entradas no-string sin lanzar', () => {
    for (const v of [null, undefined, 42, {}, [], Symbol('s')]) {
        assert.equal(typeof sanitizeText(/** @type {*} */ (v)), 'string');
    }
});

test('los campos de texto pasan por sanitizeText al validar', () => {
    const r = validateProfile({ ...PROFILE_OK, name: '  Dani   ' });
    assert.ok(r.ok);
    assert.equal(r.value.name, 'Dani');
});

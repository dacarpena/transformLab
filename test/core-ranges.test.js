// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkProfile, checkComposition, checkTarget, LIMITS, isValidSex } from '../src/core/ranges.js';

const PROFILE_OK = { sex: 'male', age: 30, heightCm: 180, activityLevel: 'moderate', trainingStatus: 'intermediate' };

/** @param {import('../src/core/ranges.js').Issue[]} issues @param {string} code */
const has = (issues, code) => issues.some((i) => i.code === code);

test('perfil válido pasa sin errores ni avisos', () => {
    const r = checkProfile(PROFILE_OK);
    assert.deepEqual(r, { errors: [], warnings: [] });
});

test('MOT-06 cerrado: sexo desconocido es SIEMPRE error, nunca desactiva validación', () => {
    const r = checkProfile({ ...PROFILE_OK, sex: 'otro' });
    assert.ok(has(r.errors, 'profile.sexUnknown'));
    // y la validación de grasa con sexo inválido devuelve error, no silencio:
    const c = checkComposition({ weightKg: 80, fatPct: 2 }, /** @type {*} */ ('otro'));
    assert.ok(has(c.errors, 'profile.sexUnknown'));
});

test('edad: error fuera de 14-90, aviso en menores de 18 y mayores de 75', () => {
    assert.ok(has(checkProfile({ ...PROFILE_OK, age: 12 }).errors, 'profile.ageOutOfRange'));
    assert.ok(has(checkProfile({ ...PROFILE_OK, age: 16 }).warnings, 'profile.ageYoung'));
    assert.ok(has(checkProfile({ ...PROFILE_OK, age: 80 }).warnings, 'profile.ageSenior'));
    assert.ok(has(checkProfile({ ...PROFILE_OK, age: NaN }).errors, 'profile.ageMissing'));
});

test('actividad y estado de entrenamiento desconocidos son error (mata el NaN de MOT-13)', () => {
    assert.ok(has(checkProfile({ ...PROFILE_OK, activityLevel: 'extreme' }).errors, 'profile.activityUnknown'));
    assert.ok(has(checkProfile({ ...PROFILE_OK, trainingStatus: 'elite' }).errors, 'profile.trainingStatusUnknown'));
});

test('medición vs objetivo (MOT-11): 7 % de grasa medido en varón es AVISO; como objetivo es ERROR', () => {
    const measured = checkComposition({ weightKg: 70, fatPct: 7 }, 'male');
    assert.equal(measured.errors.length, 0);
    assert.ok(has(measured.warnings, 'composition.fatBelowSafe'));

    const initial = { weightKg: 80, fatPct: 20, muscleKg: 31.4, leanKg: 64 };
    const target = checkTarget(initial, { fatPct: 7, muscleKg: 32 }, 'male');
    assert.ok(has(target.errors, 'target.fatBelowSafe'));
});

test('grasa bajo la esencial o sobre el 60 % es error incluso como medición', () => {
    assert.ok(has(checkComposition({ weightKg: 70, fatPct: 2 }, 'male').errors, 'composition.fatBelowEssential'));
    assert.ok(has(checkComposition({ weightKg: 120, fatPct: 65 }, 'female').errors, 'composition.fatAboveAbsoluteMax'));
});

test('músculo relativo a masa magra: aviso fuera de 35-65 %, error fuera de 20-80 % (B9: sin clamp)', () => {
    // 80 kg / 20 % → magra 64 kg
    const warn = checkComposition({ weightKg: 80, fatPct: 20, muscleKg: 45 }, 'male'); // 70 %
    assert.equal(warn.errors.length, 0);
    assert.ok(has(warn.warnings, 'composition.muscleShareUnusual'));

    const err = checkComposition({ weightKg: 80, fatPct: 20, muscleKg: 12 }, 'male'); // 19 %
    assert.ok(has(err.errors, 'composition.muscleShareImplausible'));

    const impossible = checkComposition({ weightKg: 80, fatPct: 20, muscleKg: 66 }, 'male'); // > magra
    assert.ok(has(impossible.errors, 'composition.muscleExceedsLean'));
});

test('C-4 cerrado: perfil de complexión pequeña con objetivo razonable NO recibe error', () => {
    // La ficha MOT-02: el legacy exigía ≥30 kg de músculo objetivo y bloqueaba
    // a usuarios pequeños. Mujer 55 kg / 30 % → magra 38,5, músculo est. ~16,9 kg.
    const initial = { weightKg: 55, fatPct: 30, muscleKg: 16.9, leanKg: 38.5 };
    const r = checkTarget(initial, { fatPct: 25, muscleKg: 18 }, 'female');
    assert.equal(r.errors.length, 0, JSON.stringify(r.errors));
});

test('objetivo de ganancia desmesurada: aviso a partir de +20 %, error a partir de +40 %', () => {
    const initial = { weightKg: 80, fatPct: 20, muscleKg: 31, leanKg: 64 };
    assert.ok(has(checkTarget(initial, { fatPct: 15, muscleKg: 38 }, 'male').warnings, 'target.muscleGainAmbitious'));
    assert.ok(has(checkTarget(initial, { fatPct: 15, muscleKg: 45 }, 'male').errors, 'target.muscleGainImplausible'));
});

test('perder músculo es un objetivo válido con aviso (MOT-10)', () => {
    const initial = { weightKg: 90, fatPct: 18, muscleKg: 38, leanKg: 73.8 };
    const r = checkTarget(initial, { fatPct: 15, muscleKg: 35 }, 'male');
    assert.equal(r.errors.length, 0);
    assert.ok(has(r.warnings, 'target.muscleLoss'));
});

test('un objetivo que no gana músculo se AVISA, y el aviso lo ve todo perfil ya guardado (E15-2)', () => {
    // El caso real medido en producción: 32,487 → 32,500 kg de músculo en 155
    // días. Trece gramos. E14-1 arregló la cifra por defecto del asistente, pero
    // los perfiles YA creados seguían con su objetivo degenerado y nadie se lo
    // decía. Ahora lo dice el motor, así que el aviso viaja en `plan.warnings` y
    // Hoy lo pinta en el siguiente arranque.
    const initial = { weightKg: 85, fatPct: 22, muscleKg: 32.487, leanKg: 66.3 };

    const real = checkTarget(initial, { fatPct: 14, muscleKg: 32.5 }, 'male');
    assert.equal(real.errors.length, 0, 'no es un error: el objetivo es del usuario');
    assert.ok(has(real.warnings, 'target.muscleNoGain'));
    // En gramos, no en kilos: «0,0 kg» no dice nada, «13 g» sí.
    assert.equal(real.warnings.find((w) => w.code === 'target.muscleNoGain')?.params?.grams, 13);

    // Delta exactamente cero: el caso más degenerado posible.
    assert.ok(has(checkTarget(initial, { fatPct: 14, muscleKg: 32.487 }, 'male').warnings, 'target.muscleNoGain'));

    // Justo por debajo y justo por encima del umbral de 200 g.
    assert.ok(has(checkTarget(initial, { fatPct: 14, muscleKg: 32.687 }, 'male').warnings, 'target.muscleNoGain'),
        '199 g siguen siendo «no ganar nada»');
    assert.ok(!has(checkTarget(initial, { fatPct: 14, muscleKg: 32.688 }, 'male').warnings, 'target.muscleNoGain'),
        'a partir de 200 g ya es un objetivo');

    // Y un objetivo normal no lo dispara.
    assert.ok(!has(checkTarget(initial, { fatPct: 14, muscleKg: 35 }, 'male').warnings, 'target.muscleNoGain'));
});

test('«no ganar nada» y «perder músculo» son ramas excluyentes, nunca las dos', () => {
    const initial = { weightKg: 90, fatPct: 18, muscleKg: 38, leanKg: 73.8 };
    const perdiendo = checkTarget(initial, { fatPct: 15, muscleKg: 37 }, 'male');
    assert.ok(has(perdiendo.warnings, 'target.muscleLoss'));
    assert.ok(!has(perdiendo.warnings, 'target.muscleNoGain'),
        'perder músculo ya se dice con su propio aviso: dos avisos sobre lo mismo son ruido');
});

test('el umbral de «no ganar nada» tiene UNA sola definición', () => {
    // Vivía duplicado en `onboarding.js`, y por eso el aviso solo existía en el
    // asistente. `LIMITS` es la fuente única que el motor y la interfaz comparten
    // (B9), y el asistente lee de ahí.
    assert.equal(typeof LIMITS.targetMuscleGain.noGainKg, 'number');
    assert.ok(LIMITS.targetMuscleGain.noGainKg > 0);

    const onboarding = readFileSync(new URL('../src/ui/views/onboarding.js', import.meta.url), 'utf8');
    assert.match(onboarding, /LIMITS\.targetMuscleGain\.noGainKg/,
        'el asistente debe leer el umbral de LIMITS, no declararlo otra vez');
    assert.ok(!/NO_GAIN_THRESHOLD_KG\s*=\s*0\.\d/.test(onboarding),
        'el umbral no puede volver a estar escrito a mano en la interfaz');
});

test('todos los issues llevan código y ninguno lleva texto en prosa (i18n-ready)', () => {
    const r = checkProfile({ sex: 'x', age: 5, heightCm: 90, activityLevel: 'y', trainingStatus: 'z' });
    for (const issue of [...r.errors, ...r.warnings]) {
        assert.match(issue.code, /^[a-z]+\.[a-zA-Z]+$/);
        assert.ok(!('message' in issue));
    }
});

test('LIMITS expone los rangos para la UI y isValidSex funciona', () => {
    assert.equal(LIMITS.weightKg.min, 30);
    assert.ok(isValidSex('female'));
    assert.ok(!isValidSex('F'));
});

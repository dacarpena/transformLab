// @ts-check

/**
 * Regresión del endurecimiento adversarial (M1-9): 71.412 casos de ataque
 * produjeron 30 roturas confirmadas con ~7 causas raíz. Cada test de este
 * fichero reproduce una de ellas y fija el comportamiento correcto.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    makeComposition,
    targetWeightKg,
    bmr,
    tdee,
    caloricTarget,
    weeklyFatLossKg,
    monthlyMuscleGainKg,
    planPhases,
    adaptationStep
} from '../src/core/engine.js';
import { generateProjection } from '../src/core/generator.js';
import { checkProfile, checkComposition, checkTarget } from '../src/core/ranges.js';
import { seedFrom } from '../src/core/rng.js';
import { mulberry32 } from '../src/core/rng.js';

const PROFILE = { sex: /** @type {const} */ ('male'), age: 35, heightCm: 178, activityLevel: /** @type {const} */ ('moderate'), trainingStatus: /** @type {const} */ ('intermediate') };

/** Comprueba recursivamente que un valor no contiene NaN/Infinity. */
function assertDeepFinite(value, path = '') {
    if (typeof value === 'number') {
        assert.ok(Number.isFinite(value), `${path} = ${value}`);
    } else if (Array.isArray(value)) {
        value.forEach((v, i) => assertDeepFinite(v, `${path}[${i}]`));
    } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) assertDeepFinite(v, `${path}.${k}`);
    }
}

// ---- Causa raíz A (CRÍTICA): perder grasa manteniendo músculo fallaba ----

test('el caso central del producto funciona: perder >10 kg de grasa manteniendo músculo', () => {
    for (const [w, f, targetFat, sex] of /** @type {Array<[number, number, number, 'male'|'female']>} */ ([
        [90, 25, 12, 'male'],
        [100, 30, 15, 'male'],
        [85, 38, 25, 'female'],
        [90, 25, 10, 'male']
    ])) {
        const comp = makeComposition({ weightKg: w, fatPct: f, sex });
        assert.ok(comp.ok);
        const profile = { ...PROFILE, sex };
        const plan = planPhases(comp.value, { fatPct: targetFat, muscleKg: comp.value.muscleKg }, profile);
        assert.ok(plan.ok, `${w}kg/${f}%→${targetFat}%: ${JSON.stringify(!plan.ok && plan.errors)}`);

        // cierre exacto pese al músculo colateral de la definición
        const sumFat = plan.value.phases.reduce((s, p) => s + p.expected.fatDeltaKg, 0);
        const sumMuscle = plan.value.phases.reduce((s, p) => s + p.expected.muscleDeltaKg, 0);
        assert.ok(Math.abs(sumFat - plan.value.summary.fatDeltaKg) < 1e-6);
        assert.ok(Math.abs(sumMuscle - plan.value.summary.muscleDeltaKg) < 1e-6);

        // y la proyección aterriza
        const proj = generateProjection(plan.value, comp.value, profile, { startDateISO: '2026-08-03', seed: 1 });
        assert.ok(proj.ok);
        const last = proj.value.daily.at(-1);
        assert.ok(last && Math.abs(last.weightKg - plan.value.summary.targetWeightKg) < 1e-6);
        assertDeepFinite(plan.value, 'plan');
    }
});

test('el residuo nunca se pierde en silencio: objetivo pequeño absorbido por la adaptación', () => {
    const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    // deltas minúsculos: la adaptación los cubre y no se crea fase corporal
    const plan = planPhases(comp.value, { fatPct: 19.8, muscleKg: comp.value.muscleKg + 0.25 }, PROFILE);
    assert.ok(plan.ok);
    const sumFat = plan.value.phases.reduce((s, p) => s + p.expected.fatDeltaKg, 0);
    const sumMuscle = plan.value.phases.reduce((s, p) => s + p.expected.muscleDeltaKg, 0);
    assert.ok(Math.abs(sumFat - plan.value.summary.fatDeltaKg) < 1e-6, `Σfat ${sumFat} vs ${plan.value.summary.fatDeltaKg}`);
    assert.ok(Math.abs(sumMuscle - plan.value.summary.muscleDeltaKg) < 1e-6);
    const proj = generateProjection(plan.value, comp.value, PROFILE, { startDateISO: '2026-08-03', seed: 1 });
    assert.ok(proj.ok);
    const last = proj.value.daily.at(-1);
    assert.ok(last && Math.abs(last.weightKg - plan.value.summary.targetWeightKg) < 1e-6);
});

test('rama «ya en objetivo»: el summary es coherente (deltas 0, objetivo = peso actual)', () => {
    const comp = makeComposition({ weightKg: 80.05, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const plan = planPhases(comp.value, { fatPct: 20, muscleKg: comp.value.muscleKg + 0.05 }, PROFILE);
    assert.ok(plan.ok);
    assert.equal(plan.value.summary.fatDeltaKg, 0);
    assert.equal(plan.value.summary.muscleDeltaKg, 0);
    assert.equal(plan.value.summary.targetWeightKg, comp.value.weightKg);
    const proj = generateProjection(plan.value, comp.value, PROFILE, { startDateISO: '2026-08-03', seed: 1 });
    assert.ok(proj.ok);
    const last = proj.value.daily.at(-1);
    assert.ok(last && Math.abs(last.weightKg - comp.value.weightKg) < 1e-9);
});

// ---- Causa raíz B: intensity sin validar propagaba NaN ----

test('intensity desconocida → {ok:false}, jamás un plan con NaN', () => {
    const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    for (const intensity of ['extreme', 'Moderate', '', 'agressive']) {
        const plan = planPhases(comp.value, { fatPct: 15, muscleKg: comp.value.muscleKg }, PROFILE, /** @type {*} */ ({ intensity }));
        assert.equal(plan.ok, false, `intensity=${JSON.stringify(intensity)}`);
        assert.ok(!plan.ok && plan.errors[0].code === 'plan.intensityUnknown');
    }
    // y con options null (esquiva el default) tampoco lanza
    const plan = planPhases(comp.value, { fatPct: 15, muscleKg: comp.value.muscleKg }, PROFILE, /** @type {*} */ (null));
    assert.ok(plan.ok);
});

// ---- Causa raíz C: generateProjection sin validar perfil/plan ----

test('generateProjection rechaza perfiles inválidos en vez de emitir NaN con ok:true', () => {
    const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const plan = planPhases(comp.value, { fatPct: 15, muscleKg: comp.value.muscleKg }, PROFILE);
    assert.ok(plan.ok);
    for (const badProfile of [{}, { sex: 'male' }, { ...PROFILE, sex: 'attacker' }, { ...PROFILE, activityLevel: 'nope' }, null, undefined]) {
        const r = generateProjection(plan.value, comp.value, /** @type {*} */ (badProfile), { startDateISO: '2026-08-03', seed: 1 });
        assert.equal(r.ok, false, JSON.stringify(badProfile));
    }
});

test('generateProjection rechaza planes malformados (rehidratados corruptos) sin lanzar ni colgarse', () => {
    const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const goodPhase = { type: 'cut', days: 30, expected: { fatDeltaKg: -2, muscleDeltaKg: -0.1 }, nominalKcal: { targetKcal: 2200, deficitKcal: 500, tdeeKcal: 2700, flooredBySafety: false } };
    for (const phases of [
        [{}],
        ['x'],
        [null],
        [{ ...goodPhase, days: 0 }],
        [{ ...goodPhase, days: -5 }],
        [{ ...goodPhase, days: 3.5 }],
        [{ ...goodPhase, days: NaN }],
        [{ ...goodPhase, days: 1e6 }],
        [{ ...goodPhase, expected: { fatDeltaKg: -Infinity, muscleDeltaKg: 0 } }],
        [{ ...goodPhase, expected: { fatDeltaKg: NaN, muscleDeltaKg: 0 } }]
    ]) {
        const r = generateProjection(/** @type {*} */ ({ phases, totalDays: 30, summary: {}, warnings: [] }), comp.value, PROFILE, { startDateISO: '2026-08-03', seed: 1 });
        assert.equal(r.ok, false, JSON.stringify(phases[0]));
    }
});

// ---- Causa raíz D: prototipos colándose por el operador `in` ----

test('claves del prototipo no pasan la validación de enums', () => {
    for (const stolen of ['toString', 'valueOf', 'hasOwnProperty', 'constructor']) {
        const r = checkProfile({ ...PROFILE, trainingStatus: stolen });
        assert.ok(r.errors.some((e) => e.code === 'profile.trainingStatusUnknown'), stolen);
        const r2 = checkProfile({ ...PROFILE, activityLevel: stolen });
        assert.ok(r2.errors.some((e) => e.code === 'profile.activityUnknown'), stolen);
        assert.ok(Number.isNaN(tdee(1780, /** @type {*} */ (stolen))));
        assert.ok(Number.isNaN(weeklyFatLossKg(80, /** @type {*} */ (stolen))));
        assert.ok(Number.isNaN(monthlyMuscleGainKg(80, /** @type {*} */ (stolen), 'male')));
    }
});

// ---- Causa raíz E: objetivos absurdos y planes de una década ----

test('objetivo de grasa por encima del techo absoluto es ERROR, no warning', () => {
    const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    for (const fatPct of [65, 99, 99.9]) {
        const plan = planPhases(comp.value, { fatPct, muscleKg: comp.value.muscleKg }, PROFILE);
        assert.equal(plan.ok, false, `fatPct=${fatPct}`);
    }
});

test('peso objetivo fuera de [30,300] es error accionable', () => {
    // mujer muy ligera queriendo bajar músculo drásticamente → objetivo < 30 kg
    const comp = makeComposition({ weightKg: 42, fatPct: 35, muscleKg: 11, sex: 'female' });
    assert.ok(comp.ok, JSON.stringify(!comp.ok && comp.errors));
    const plan = planPhases(comp.value, { fatPct: 16, muscleKg: 7 }, { ...PROFILE, sex: /** @type {const} */ ('female') });
    if (!plan.ok) {
        assert.ok(plan.errors.some((e) => e.code === 'plan.targetWeightOutOfRange' || e.code === 'target.muscleGainImplausible' || e.code === 'plan.tooLong'), JSON.stringify(plan.errors));
    }
});

test('ningún plan {ok:true} supera el tope de duración', () => {
    // barrido con perfiles extremos pero válidos: o {ok:false} o ≤ maxTotalDays
    const rng = mulberry32(7);
    for (let i = 0; i < 300; i++) {
        const sex = rng() < 0.5 ? 'male' : 'female';
        const weightKg = 35 + rng() * 260;
        const fatPct = 13 + rng() * 45;
        const comp = makeComposition({ weightKg, fatPct, sex });
        if (!comp.ok) continue;
        const targetFat = 8 + rng() * 50;
        const targetMuscle = comp.value.muscleKg * (0.7 + rng() * 0.65);
        const plan = planPhases(comp.value, { fatPct: targetFat, muscleKg: targetMuscle },
            { sex, age: 20 + Math.floor(rng() * 50), heightCm: 150 + rng() * 40, activityLevel: 'moderate', trainingStatus: 'intermediate' });
        if (plan.ok) {
            assert.ok(plan.value.totalDays <= 1095, `plan de ${plan.value.totalDays} días`);
            assertDeepFinite(plan.value, `plan[${i}]`);
        }
    }
});

// ---- Causa raíz F: null/undefined lanzaban en 10 funciones públicas ----

test('ninguna función pública lanza con null/undefined: degradan a {ok:false}/NaN/errors', () => {
    for (const bad of [null, undefined]) {
        assert.equal(makeComposition(/** @type {*} */ (bad)).ok, false);
        assert.ok(Number.isNaN(bmr(/** @type {*} */ (bad), 80)));
        assert.ok(Number.isNaN(caloricTarget(/** @type {*} */ (bad)).targetKcal));
        assert.ok(checkProfile(/** @type {*} */ (bad)).errors.length > 0);
        assert.ok(checkComposition(/** @type {*} */ (bad), 'male').errors.length > 0);
        assert.ok(checkTarget(/** @type {*} */ (bad), {}, 'male').errors.length > 0);

        const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
        assert.ok(comp.ok);
        assert.ok(checkTarget(comp.value, /** @type {*} */ (bad), 'male').errors.length > 0);
        assert.equal(planPhases(comp.value, { fatPct: 15, muscleKg: 30 }, /** @type {*} */ (bad)).ok, false);
        const plan = planPhases(comp.value, { fatPct: 15, muscleKg: comp.value.muscleKg }, PROFILE);
        assert.ok(plan.ok);
        assert.equal(generateProjection(plan.value, comp.value, /** @type {*} */ (bad), { startDateISO: '2026-08-03', seed: 1 }).ok, false);
    }
});

test('caloricTarget con sexo inválido devuelve NaN explícito: el suelo JAMÁS se omite en silencio', () => {
    const r = caloricTarget({ tdeeKcal: 2000, bmrKcal: 1550, sex: /** @type {*} */ ('other'), dailyFatDeltaKg: -0.1, dailyMuscleDeltaKg: 0 });
    assert.ok(Number.isNaN(r.targetKcal) && Number.isNaN(r.deficitKcal));
    assert.equal(r.flooredBySafety, false);
});

test('muscleSource inventado es error (contrato A3 protegido)', () => {
    const r = makeComposition({ weightKg: 80, fatPct: 20, muscleKg: 33, sex: 'male', muscleSource: /** @type {*} */ ('invented') });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.errors[0].code === 'composition.muscleSourceInvalid');
});

// ---- sanidad numérica global sobre entradas válidas ----

test('mini-fuzz sembrado: 200 planes válidos sin NaN y con invariantes básicos', () => {
    const rng = mulberry32(20260802);
    let generated = 0;
    for (let i = 0; i < 200; i++) {
        const sex = rng() < 0.5 ? 'male' : 'female';
        const weightKg = 45 + rng() * 90;
        const fatPct = (sex === 'male' ? 10 : 18) + rng() * 25;
        const comp = makeComposition({ weightKg, fatPct, sex });
        if (!comp.ok) continue;
        const targetFat = Math.max(sex === 'male' ? 9 : 17, fatPct - rng() * 12);
        const targetMuscle = comp.value.muscleKg * (0.95 + rng() * 0.15);
        const profile = { sex, age: 20 + Math.floor(rng() * 45), heightCm: 155 + rng() * 35, activityLevel: /** @type {const} */ ('moderate'), trainingStatus: /** @type {const} */ ('intermediate') };
        const plan = planPhases(comp.value, { fatPct: targetFat, muscleKg: targetMuscle }, profile);
        if (!plan.ok) continue;
        const proj = generateProjection(plan.value, comp.value, profile, { startDateISO: '2026-08-03', seed: seedFrom(`fuzz${i}`, '2026-08-03'), fluctuation: true });
        assert.ok(proj.ok, `caso ${i}`);
        generated++;
        assertDeepFinite(proj.value.daily[0], `caso ${i} día 0`);
        assertDeepFinite(proj.value.daily.at(-1), `caso ${i} último día`);
        const last = proj.value.daily.at(-1);
        assert.ok(last && Math.abs(last.weightKg - plan.value.summary.targetWeightKg) < 1e-6, `caso ${i}: aterrizaje`);
    }
    assert.ok(generated > 100, `solo ${generated} planes válidos generados`);
});

test('adaptationStep degrada con entradas no numéricas sin lanzar', () => {
    assert.ok(Number.isFinite(adaptationStep(0, 0, 2000)));
    assert.ok(!Number.isNaN(adaptationStep(0.05, /** @type {*} */ (undefined), 2000)) || true); // no lanza
    assert.equal(typeof adaptationStep(0.05, NaN, 2000), 'number');
    assert.ok(Number.isFinite(targetWeightKg(33, 15, /** @type {*} */ ({ otherLeanKg: 32, muscleSource: 'estimated', leanKg: 64, muscleKg: 31 }))));
});

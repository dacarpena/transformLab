// @ts-check
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
    plausibleMuscleGainKg
} from '../src/core/engine.js';
import { CALORIC_FLOOR_KCAL, SMM_OF_LEAN_RATIO } from '../src/core/constants.js';

const PROFILE_M = { sex: /** @type {const} */ ('male'), age: 30, heightCm: 180, activityLevel: /** @type {const} */ ('moderate'), trainingStatus: /** @type {const} */ ('intermediate') };
const PROFILE_F = { ...PROFILE_M, sex: /** @type {const} */ ('female'), heightCm: 165, age: 40 };

/** Los 4 perfiles del test de identidad de docs/AUDITORIA.md §1.2. */
const IDENTITY_PROFILES = [
    { name: 'hombre 80 kg / 20 %', weightKg: 80, fatPct: 20, sex: /** @type {const} */ ('male') },
    { name: 'mujer 60 kg / 28 %', weightKg: 60, fatPct: 28, sex: /** @type {const} */ ('female') },
    { name: 'hombre 95 kg / 30 %', weightKg: 95, fatPct: 30, sex: /** @type {const} */ ('male') },
    { name: 'hombre 70 kg / 12 %', weightKg: 70, fatPct: 12, sex: /** @type {const} */ ('male') }
];

// ============================================================
// invariante `identidad` — el defecto C-1..C-3 del legacy es
// irreproducible: pedir la composición ACTUAL devuelve el peso ACTUAL.
// El legacy devolvía 50,9 / 42,6 / 59,9 / 45,0 kg (desvíos de −17 a −35 kg).
// ============================================================

test('identidad (ruta estimated): pedir la composición actual devuelve el peso actual ±1 kg', () => {
    for (const p of IDENTITY_PROFILES) {
        const comp = makeComposition({ weightKg: p.weightKg, fatPct: p.fatPct, sex: p.sex });
        assert.ok(comp.ok, `${p.name}: composición inválida`);
        const current = comp.value;
        assert.equal(current.muscleSource, 'estimated');

        const w = targetWeightKg(current.muscleKg, current.fatPct, current);
        assert.ok(Number.isFinite(w), `${p.name}: peso no finito`);
        assert.ok(Math.abs(w - p.weightKg) <= 1,
            `${p.name}: devuelve ${w} kg, esperaba ${p.weightKg} ±1 (el legacy daba ${p.weightKg === 80 ? 50.9 : p.weightKg === 60 ? 42.6 : p.weightKg === 95 ? 59.9 : 45.0})`);
    }
});

test('identidad (ruta measured): igual con músculo de bioimpedancia', () => {
    for (const p of IDENTITY_PROFILES) {
        const leanKg = p.weightKg * (1 - p.fatPct / 100);
        const measuredMuscle = leanKg * 0.55; // lectura plausible de bioimpedancia
        const comp = makeComposition({ weightKg: p.weightKg, fatPct: p.fatPct, muscleKg: measuredMuscle, sex: p.sex });
        assert.ok(comp.ok, `${p.name}: ${JSON.stringify(!comp.ok && comp.errors)}`);
        assert.equal(comp.value.muscleSource, 'measured');

        const w = targetWeightKg(comp.value.muscleKg, comp.value.fatPct, comp.value);
        assert.ok(Math.abs(w - p.weightKg) <= 1, `${p.name}: devuelve ${w} kg`);
    }
});

// ============================================================
// composición (M1-4)
// ============================================================

test('ruta estimated usa la proporción músculo/magra por sexo (Janssen 2000), sin clamp', () => {
    const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const c = comp.value;
    assert.ok(Math.abs(c.leanKg - 64) < 1e-9);
    assert.ok(Math.abs(c.muscleKg - 64 * SMM_OF_LEAN_RATIO.male) < 1e-9);
    // el "otro tejido magro" es el complemento real (~33 kg), no un clamp a 10:
    assert.ok(c.otherLeanKg > 30, `otherLeanKg = ${c.otherLeanKg}: ¿ha vuelto el clamp?`);
    assert.ok(Math.abs(c.weightKg - (c.fatKg + c.muscleKg + c.otherLeanKg)) < 1e-9);
});

test('composición inválida devuelve {ok:false, errors} y jamás lanza', () => {
    for (const bad of [
        { weightKg: NaN, fatPct: 20, sex: /** @type {const} */ ('male') },
        { weightKg: 80, fatPct: 2, sex: /** @type {const} */ ('male') },
        { weightKg: 80, fatPct: 20, muscleKg: 70, sex: /** @type {const} */ ('male') }
    ]) {
        const r = makeComposition(bad);
        assert.equal(r.ok, false);
        assert.ok(!r.ok && r.errors.length > 0);
    }
});

test('composición implausible pero posible produce warnings, nunca corrección silenciosa (B9)', () => {
    const r = makeComposition({ weightKg: 80, fatPct: 20, muscleKg: 45, sex: 'male' }); // 70 % de la magra
    assert.ok(r.ok);
    assert.ok(r.warnings.some((w) => w.code === 'composition.muscleShareUnusual'));
    assert.equal(r.value.muscleKg, 45); // el dato del usuario queda INTACTO
});

// ============================================================
// energía (M1-5)
// ============================================================

test('BMR Mifflin-St Jeor exacto y redondeado en origen', () => {
    assert.equal(bmr(PROFILE_M, 80), 1780);
    assert.equal(bmr(PROFILE_F, 60), 1270); // 10·60 + 6.25·165 − 5·40 − 161 = 1270.25 → 1270
});

test('TDEE aplica el multiplicador y con nivel desconocido devuelve NaN, no un default silencioso', () => {
    assert.equal(tdee(1780, 'moderate'), 2759);
    assert.ok(Number.isNaN(tdee(1780, /** @type {*} */ ('extreme'))));
});

test('B3: el déficit se DERIVA de la pérdida de grasa esperada (7700 kcal/kg)', () => {
    // perder 0,06 kg de grasa/día ≈ 462 kcal/día de déficit
    const r = caloricTarget({ tdeeKcal: 2759, bmrKcal: 1780, sex: 'male', dailyFatDeltaKg: -0.06, dailyMuscleDeltaKg: 0 });
    assert.equal(r.flooredBySafety, false);
    assert.ok(Math.abs(r.deficitKcal - 462) <= 1, `deficit ${r.deficitKcal}`);
    assert.equal(r.targetKcal, 2759 - r.deficitKcal);
});

test('B2: el suelo calórico max(BMR, 1200♀/1500♂) recorta y lo señala', () => {
    // mujer pequeña: TDEE 1450, pérdida agresiva pediría comer por debajo de 1200
    const r = caloricTarget({ tdeeKcal: 1450, bmrKcal: 1180, sex: 'female', dailyFatDeltaKg: -0.08, dailyMuscleDeltaKg: 0 });
    assert.equal(r.flooredBySafety, true);
    assert.equal(r.targetKcal, CALORIC_FLOOR_KCAL.female);
    // y con BMR alto, el suelo es el BMR:
    const r2 = caloricTarget({ tdeeKcal: 2000, bmrKcal: 1700, sex: 'male', dailyFatDeltaKg: -0.15, dailyMuscleDeltaKg: 0 });
    assert.equal(r2.flooredBySafety, true);
    assert.equal(r2.targetKcal, 1700);
});

test('superávit en ganancia: objetivo por encima del TDEE', () => {
    const r = caloricTarget({ tdeeKcal: 2759, bmrKcal: 1780, sex: 'male', dailyFatDeltaKg: 0.005, dailyMuscleDeltaKg: 0.02 });
    assert.ok(r.targetKcal > 2759);
    assert.ok(r.deficitKcal < 0);
});

test('tasas: pérdida semanal relativa al peso; ganancia mensual relativa al peso con factor por sexo', () => {
    assert.ok(Math.abs(weeklyFatLossKg(80, 'moderate') - 0.6) < 1e-9);
    const male = monthlyMuscleGainKg(75, 'intermediate', 'male');
    assert.ok(Math.abs(male - 0.675) < 1e-3); // reproduce la tasa absoluta de la fuente a 75 kg
    const female = monthlyMuscleGainKg(75, 'intermediate', 'female');
    assert.ok(female < male && female > 0);
    assert.ok(Number.isNaN(weeklyFatLossKg(80, /** @type {*} */ ('extreme'))));
});

// ============================================================
// planificador (M1-6)
// ============================================================

/** Plan estándar de prueba: hombre 80/20 quiere 15 % y +2 kg de músculo. */
function standardPlan() {
    const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const target = { fatPct: 15, muscleKg: comp.value.muscleKg + 2 };
    return { initial: comp.value, target, plan: planPhases(comp.value, target, PROFILE_M) };
}

test('cierre_de_plan: las expectativas por fase suman EXACTAMENTE el objetivo', () => {
    const { initial, target, plan } = standardPlan();
    assert.ok(plan.ok, JSON.stringify(!plan.ok && plan.errors));
    const p = plan.value;

    const targetW = targetWeightKg(target.muscleKg, target.fatPct, initial);
    const totalFat = targetW * target.fatPct / 100 - initial.fatKg;
    const totalMuscle = target.muscleKg - initial.muscleKg;

    const sumFat = p.phases.reduce((s, ph) => s + ph.expected.fatDeltaKg, 0);
    const sumMuscle = p.phases.reduce((s, ph) => s + ph.expected.muscleDeltaKg, 0);
    assert.ok(Math.abs(sumFat - totalFat) < 1e-6, `fat: ${sumFat} vs ${totalFat}`);
    assert.ok(Math.abs(sumMuscle - totalMuscle) < 1e-6, `muscle: ${sumMuscle} vs ${totalMuscle}`);
    assert.equal(p.phases.reduce((s, ph) => s + ph.days, 0), p.totalDays);
    assert.ok(p.totalDays > 30 && p.totalDays < 1000);
});

test('MOT-04 muerto: la fase de recomposición recibe déficit real, no mantenimiento', () => {
    const { plan } = standardPlan();
    assert.ok(plan.ok);
    const recomp = plan.value.phases.find((ph) => ph.type === 'recomposition');
    assert.ok(recomp, 'con 20 % de grasa y ganancia pendiente debe haber recomposición');
    assert.ok(recomp.nominalKcal.deficitKcal > 0, `déficit de recomposición = ${recomp.nominalKcal.deficitKcal}`);
    assert.ok(recomp.expected.fatDeltaKg < 0 && recomp.expected.muscleDeltaKg > 0);
});

test('estructura: adaptación al principio, transición y mantenimiento al final', () => {
    const { plan } = standardPlan();
    assert.ok(plan.ok);
    const types = plan.value.phases.map((p) => p.type);
    assert.equal(types[0], 'adaptation');
    assert.deepEqual(types.slice(-2), ['transition', 'maintenance']);
});

test('MOT-10: «ya estás en el objetivo» produce plan de mantenimiento honesto con aviso', () => {
    const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const plan = planPhases(comp.value, { fatPct: 20, muscleKg: comp.value.muscleKg }, PROFILE_M);
    assert.ok(plan.ok);
    assert.ok(plan.value.warnings.some((w) => w.code === 'plan.alreadyAtTarget'));
    const bodyPhases = plan.value.phases.filter((p) => !['maintenance', 'transition', 'adaptation'].includes(p.type));
    assert.equal(bodyPhases.length, 0);
    for (const ph of plan.value.phases) {
        assert.ok(Math.abs(ph.expected.fatDeltaKg) < 1e-9 && Math.abs(ph.expected.muscleDeltaKg) < 1e-9);
    }
});

test('MOT-10: perder músculo a propósito es una rama explícita que cierra', () => {
    const comp = makeComposition({ weightKg: 90, fatPct: 18, muscleKg: 40, sex: 'male' });
    assert.ok(comp.ok);
    const plan = planPhases(comp.value, { fatPct: 15, muscleKg: 37 }, PROFILE_M);
    assert.ok(plan.ok, JSON.stringify(!plan.ok && plan.errors));
    const sumMuscle = plan.value.phases.reduce((s, ph) => s + ph.expected.muscleDeltaKg, 0);
    assert.ok(Math.abs(sumMuscle - -3) < 1e-6, `Δmúsculo del plan = ${sumMuscle}, esperaba −3`);
});

test('C-5 muerto: entradas no finitas producen {ok:false}, jamás un plan al 0 % de grasa', () => {
    const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    for (const target of [
        { fatPct: NaN, muscleKg: 32 },
        { fatPct: 15, muscleKg: NaN },
        { fatPct: undefined, muscleKg: undefined }
    ]) {
        const plan = planPhases(comp.value, /** @type {*} */ (target), PROFILE_M);
        assert.equal(plan.ok, false);
    }
});

test('B2 aplicado al plan: cuando el suelo recorta el déficit, la definición se alarga', () => {
    // mujer pequeña y ligera: TDEE bajo → el suelo de 1200 recorta el ritmo
    const comp = makeComposition({ weightKg: 58, fatPct: 34, sex: 'female' });
    assert.ok(comp.ok);
    const profile = { ...PROFILE_F, heightCm: 152, age: 55, activityLevel: /** @type {const} */ ('sedentary') };
    const target = { fatPct: 26, muscleKg: comp.value.muscleKg };
    const plan = planPhases(comp.value, target, profile);
    assert.ok(plan.ok, JSON.stringify(!plan.ok && plan.errors));

    const cut = plan.value.phases.find((p) => p.type === 'cut');
    assert.ok(cut);
    if (cut.nominalKcal.flooredBySafety) {
        assert.ok(plan.value.warnings.some((w) => w.code === 'plan.flooredBySafety'));
        // el ritmo efectivo es menor que la tasa nominal → más días que los teóricos
        const nominalDays = Math.abs(cut.expected.fatDeltaKg) / (weeklyFatLossKg(58, 'moderate') / 7);
        assert.ok(cut.days > nominalDays, `days=${cut.days} vs nominal=${nominalDays}`);
    }
    // pase lo que pase, el objetivo nunca baja del suelo
    assert.ok(cut.nominalKcal.targetKcal >= CALORIC_FLOOR_KCAL.female);
});

test('el planificador no muta ni la composición inicial ni el objetivo (GEN-06)', () => {
    const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const initial = comp.value;
    const target = { fatPct: 15, muscleKg: initial.muscleKg + 2 };
    const snapInitial = JSON.stringify(initial);
    const snapTarget = JSON.stringify(target);
    planPhases(initial, target, PROFILE_M);
    assert.equal(JSON.stringify(initial), snapInitial);
    assert.equal(JSON.stringify(target), snapTarget);
});

/* ---------------------------------------------------------------------- *
 * Ganancia plausible (E14-1)
 * ---------------------------------------------------------------------- */

test('plausibleMuscleGainKg responde lo que el motor ya sabía pero no decía', () => {
    // El caso de la auditoría: principiante, varón, 85 kg, plan de 154 días.
    // El plan real proyectaba +0,013 kg mientras esto vale entre 5 y 8.
    const r = plausibleMuscleGainKg(85, 'beginner', 'male', 154);
    assert.ok(r);
    assert.ok(r.avg > 5 && r.avg < 8, `media ${r.avg}`);
    assert.ok(r.min < r.avg && r.avg < r.max, 'el rango tiene que ordenarse');

    // Un principiante gana más que un intermedio, y este más que un avanzado:
    // es la razón de ser de las tres tasas.
    const inter = plausibleMuscleGainKg(85, 'intermediate', 'male', 154);
    const avanz = plausibleMuscleGainKg(85, 'advanced', 'male', 154);
    assert.ok(r.avg > inter.avg && inter.avg > avanz.avg);

    // Y el factor por sexo se aplica (Helms 2014).
    const mujer = plausibleMuscleGainKg(85, 'beginner', 'female', 154);
    assert.ok(mujer.avg < r.avg);
});

test('plausibleMuscleGainKg escala con el tiempo y degrada con entradas imposibles', () => {
    const mes = plausibleMuscleGainKg(80, 'intermediate', 'male', 30.4375);
    const anio = plausibleMuscleGainKg(80, 'intermediate', 'male', 365.25);
    assert.ok(Math.abs(anio.avg / mes.avg - 12) < 0.01, 'un año son doce meses de ganancia');

    for (const malo of [[80, 'inventado', 'male', 100], [NaN, 'beginner', 'male', 100],
        [80, 'beginner', 'male', 0], [80, 'beginner', 'male', -5]]) {
        assert.equal(plausibleMuscleGainKg(...(/** @type {*} */ (malo))), null, JSON.stringify(malo));
    }
});

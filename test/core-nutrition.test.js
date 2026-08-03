// @ts-check

/**
 * M5-1 · Macros. Test primero.
 *
 * Las macros NO se calculan por su cuenta: parten del objetivo calórico que
 * ya produce el motor (derivado de la Δgrasa esperada vía 7 700 kcal/kg,
 * decisión B3). Un cálculo paralelo podría contradecir al plan.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeComposition, planPhases } from '../src/core/engine.js';
import { generateProjection } from '../src/core/generator.js';
import { macrosFor, refeedMacros, PROTEIN_G_PER_KG_LEAN, FAT_PCT_OF_KCAL } from '../src/core/nutrition.js';

const PROFILE = { sex: /** @type {const} */ ('male'), age: 30, heightCm: 175, activityLevel: /** @type {const} */ ('moderate'), trainingStatus: /** @type {const} */ ('intermediate') };

function canonical() {
    const comp = makeComposition({ weightKg: 75, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const plan = planPhases(comp.value, { fatPct: 12, muscleKg: 30 }, PROFILE);
    assert.ok(plan.ok);
    const proj = generateProjection(plan.value, comp.value, PROFILE, {
        startDateISO: '2026-08-03', seed: 1, fluctuation: false
    });
    assert.ok(proj.ok);
    return proj.value;
}

test('las kcal de las macros son EXACTAMENTE las del motor: cero cálculo paralelo', () => {
    const projection = canonical();
    for (const day of [0, 30, 90, 150]) {
        const point = projection.daily[day];
        const macros = macrosFor(point);
        assert.ok(macros.ok);
        assert.equal(macros.value.kcal, point.kcal.targetKcal, `día ${day}`);
    }
});

test('los gramos suman las calorías del objetivo (4/4/9), sin desviarse más de un redondeo', () => {
    const projection = canonical();
    for (const day of [0, 45, 120, 170]) {
        const macros = macrosFor(projection.daily[day]);
        assert.ok(macros.ok);
        const { proteinG, carbsG, fatG, kcal } = macros.value;
        const sum = proteinG * 4 + carbsG * 4 + fatG * 9;
        assert.ok(Math.abs(sum - kcal) <= 10, `día ${day}: ${sum} kcal en macros vs ${kcal} objetivo`);
    }
});

test('la proteína se expresa por kg de masa MAGRA, no de peso corporal', () => {
    // El legacy usaba 2,2 g/kg de PESO: a un usuario de 120 kg al 40 % de
    // grasa le pedía 264 g/día, proteína para 72 kg de tejido que no tiene.
    const heavy = makeComposition({ weightKg: 120, fatPct: 40, sex: 'male' });
    assert.ok(heavy.ok);
    const point = {
        weightKg: 120, fatPct: 40, fatKg: 48, leanKg: 72,
        muscleKg: heavy.value.muscleKg, otherLeanKg: heavy.value.otherLeanKg,
        phaseType: 'cut', kcal: { targetKcal: 2200, deficitKcal: 700, tdeeKcal: 2900, flooredBySafety: false }
    };
    const macros = macrosFor(/** @type {*} */ (point));
    assert.ok(macros.ok);

    const legacyWouldAsk = Math.round(120 * 2.2);
    assert.ok(macros.value.proteinG < legacyWouldAsk * 0.85,
        `${macros.value.proteinG} g está demasiado cerca de los ${legacyWouldAsk} g del legacy`);
    // y coincide con la referencia sobre masa magra
    assert.equal(macros.value.proteinG, Math.round(72 * PROTEIN_G_PER_KG_LEAN.cut));
});

test('la proteína sube en definición: es donde protege la masa magra', () => {
    const base = {
        weightKg: 80, fatPct: 20, fatKg: 16, leanKg: 64, muscleKg: 31, otherLeanKg: 33,
        kcal: { targetKcal: 2400, deficitKcal: 400, tdeeKcal: 2800, flooredBySafety: false }
    };
    const cut = macrosFor(/** @type {*} */ ({ ...base, phaseType: 'cut' }));
    const bulk = macrosFor(/** @type {*} */ ({ ...base, phaseType: 'bulk' }));
    assert.ok(cut.ok && bulk.ok);
    assert.ok(cut.value.proteinG > bulk.value.proteinG);
});

test('la grasa nunca baja del suelo endocrino, aunque las kcal aprieten', () => {
    const point = {
        weightKg: 55, fatPct: 18, fatKg: 9.9, leanKg: 45.1, muscleKg: 20, otherLeanKg: 25.1,
        phaseType: 'cut', kcal: { targetKcal: 1200, deficitKcal: 600, tdeeKcal: 1800, flooredBySafety: true }
    };
    const macros = macrosFor(/** @type {*} */ (point));
    assert.ok(macros.ok);
    const fatKcal = macros.value.fatG * 9;
    assert.ok(fatKcal / macros.value.kcal >= FAT_PCT_OF_KCAL.min - 0.01,
        `la grasa cayó al ${(fatKcal / macros.value.kcal * 100).toFixed(0)} % de las calorías`);
});

test('ningún macro sale negativo, ni siquiera con objetivos calóricos muy bajos', () => {
    for (const targetKcal of [1200, 1000, 800, 600]) {
        const point = {
            weightKg: 95, fatPct: 15, fatKg: 14.25, leanKg: 80.75, muscleKg: 39, otherLeanKg: 41.75,
            phaseType: 'cut', kcal: { targetKcal, deficitKcal: 1000, tdeeKcal: targetKcal + 1000, flooredBySafety: true }
        };
        const macros = macrosFor(/** @type {*} */ (point));
        assert.ok(macros.ok);
        assert.ok(macros.value.carbsG >= 0, `${targetKcal} kcal → ${macros.value.carbsG} g de carbohidratos`);
        assert.ok(macros.value.proteinG > 0 && macros.value.fatG > 0);
        // con muy pocas kcal, la proteína cede antes que el suelo de grasa
        assert.ok(macros.value.warnings.length > 0 || macros.value.carbsG > 0);
    }
});

test('el refeed lleva a mantenimiento, no a un multiplicador inventado', () => {
    // el legacy multiplicaba por 1,2 sin fuente; un refeed/diet break se
    // define como comer a mantenimiento (Peos 2019)
    const point = {
        weightKg: 80, fatPct: 20, fatKg: 16, leanKg: 64, muscleKg: 31, otherLeanKg: 33,
        phaseType: 'cut', kcal: { targetKcal: 2200, deficitKcal: 600, tdeeKcal: 2800, flooredBySafety: false }
    };
    const base = macrosFor(/** @type {*} */ (point));
    assert.ok(base.ok);
    const refeed = refeedMacros(base.value, /** @type {*} */ (point));
    assert.ok(refeed.ok);
    assert.equal(refeed.value.kcal, 2800, 'el refeed debe ir a mantenimiento (TDEE)');
    // la proteína se mantiene y el extra va a carbohidratos
    assert.equal(refeed.value.proteinG, base.value.proteinG);
    assert.ok(refeed.value.carbsG > base.value.carbsG);
    assert.equal(refeed.value.fatG, base.value.fatG);
});

test('un refeed en una fase que no es déficit no añade calorías', () => {
    const point = {
        weightKg: 80, fatPct: 20, fatKg: 16, leanKg: 64, muscleKg: 31, otherLeanKg: 33,
        phaseType: 'bulk', kcal: { targetKcal: 3000, deficitKcal: -200, tdeeKcal: 2800, flooredBySafety: false }
    };
    const base = macrosFor(/** @type {*} */ (point));
    assert.ok(base.ok);
    const refeed = refeedMacros(base.value, /** @type {*} */ (point));
    assert.ok(refeed.ok);
    assert.equal(refeed.value.kcal, base.value.kcal, 'no hay déficit del que descansar');
});

test('macrosFor degrada con entradas basura sin lanzar', () => {
    for (const bad of [null, undefined, {}, 'x', 42, { kcal: null }, { kcal: { targetKcal: NaN }, leanKg: 60 },
        { kcal: { targetKcal: 2000 }, leanKg: 0 }, { kcal: { targetKcal: 2000 }, leanKg: -5 }]) {
        const r = macrosFor(/** @type {*} */ (bad));
        assert.equal(r.ok, false, `aceptó ${JSON.stringify(bad)}`);
    }
});

test('refeedMacros degrada con entradas basura sin lanzar', () => {
    for (const bad of [null, undefined, {}, 'x']) {
        assert.equal(refeedMacros(/** @type {*} */ (bad), /** @type {*} */ (bad)).ok, false);
    }
});

test('las constantes de proteína y grasa están dentro de los rangos citados', () => {
    // Helms 2014: 2,3–3,1 g/kg de masa libre de grasa en déficit
    assert.ok(PROTEIN_G_PER_KG_LEAN.cut >= 2.3 && PROTEIN_G_PER_KG_LEAN.cut <= 3.1);
    // fuera de déficit basta menos
    assert.ok(PROTEIN_G_PER_KG_LEAN.default < PROTEIN_G_PER_KG_LEAN.cut);
    // la grasa no baja del 20 % de las calorías por función endocrina
    assert.ok(FAT_PCT_OF_KCAL.min >= 0.15 && FAT_PCT_OF_KCAL.target >= FAT_PCT_OF_KCAL.min);
});

test('el refeed declara lo que CUESTA, porque el motor no lo modela', () => {
    // El hallazgo más grave de la verificación adversarial de M5: la interfaz
    // afirmaba «no rompe el plan: la proyección ya lo absorbe», y la
    // proyección no sabe nada de refeeds — aplica el déficit los siete días.
    // Un refeed semanal costaba 2,29 kg en el plan canónico (14,8 % del
    // objetivo) y acababa disparando una oferta de recalibración por una
    // desviación que la propia aplicación había causado.
    const projection = canonical();
    const point = projection.daily.find((p) => p.kcal.targetKcal < p.kcal.tdeeKcal);
    assert.ok(point, 'el plan canónico debe tener días con déficit');

    const base = macrosFor(point);
    assert.ok(base.ok);
    const refeed = refeedMacros(base.value, point);
    assert.ok(refeed.ok);

    // El coste existe, es positivo y coincide con el déficit del día
    assert.ok(refeed.value.costKcal > 0);
    assert.equal(refeed.value.costKcal, Math.round(point.kcal.tdeeKcal - base.value.kcal));
    assert.ok(Math.abs(refeed.value.costKg - refeed.value.costKcal / 7700) < 0.002,
        `coste incoherente: ${refeed.value.costKg} kg vs ${refeed.value.costKcal} kcal`);

    // Sin déficit no hay nada que descansar, y el coste es cero
    const noDeficit = { ...point, kcal: { ...point.kcal, targetKcal: point.kcal.tdeeKcal + 300, tdeeKcal: point.kcal.tdeeKcal } };
    const baseUp = macrosFor(noDeficit);
    assert.ok(baseUp.ok);
    const none = refeedMacros(baseUp.value, noDeficit);
    assert.ok(none.ok);
    assert.equal(none.value.costKcal, 0);
    assert.equal(none.value.costKg, 0);
});

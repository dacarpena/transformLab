// @ts-check

/** M5-3/5/6 · Silueta, hitos estéticos y logros. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeComposition, planPhases } from '../src/core/engine.js';
import { generateProjection } from '../src/core/generator.js';
import { shapeFor, waistToShoulderRatio } from '../src/core/silhouette.js';
import { aestheticMilestonesFor, nextAesthetic, byCategory, AESTHETIC_CATALOG, VISIBILITY_LEVELS } from '../src/core/milestones.js';
import { evaluate, shareCard, ACHIEVEMENT_RULES } from '../src/core/achievements.js';

const PROFILE = { sex: /** @type {const} */ ('male'), age: 30, heightCm: 175, activityLevel: /** @type {const} */ ('moderate'), trainingStatus: /** @type {const} */ ('intermediate') };

function canonical() {
    const comp = makeComposition({ weightKg: 75, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const plan = planPhases(comp.value, { fatPct: 12, muscleKg: 30 }, PROFILE);
    assert.ok(plan.ok);
    const proj = generateProjection(plan.value, comp.value, PROFILE, { startDateISO: '2026-08-03', seed: 1, fluctuation: false });
    assert.ok(proj.ok);
    return { comp: comp.value, projection: proj.value };
}

// ---- Silueta ----

test('menos grasa estrecha la cintura más que los hombros', () => {
    const fat = shapeFor({ weightKg: 90, fatPct: 30, muscleKg: 33, sex: 'male' });
    const lean = shapeFor({ weightKg: 78, fatPct: 14, muscleKg: 33, sex: 'male' });
    assert.ok(fat && lean);
    const waistChange = (fat.waist - lean.waist) / fat.waist;
    const shoulderChange = Math.abs(fat.shoulders - lean.shoulders) / fat.shoulders;
    assert.ok(waistChange > shoulderChange, 'la grasa debe notarse más en la cintura');
    assert.ok(waistToShoulderRatio(lean) < waistToShoulderRatio(fat));
});

test('más músculo ensancha hombros y brazo', () => {
    const base = shapeFor({ weightKg: 80, fatPct: 18, muscleKg: 30, sex: 'male' });
    const strong = shapeFor({ weightKg: 80, fatPct: 18, muscleKg: 36, sex: 'male' });
    assert.ok(base && strong);
    assert.ok(strong.shoulders > base.shoulders);
    assert.ok(strong.arm > base.arm);
});

test('las medidas REALES mandan sobre la estimación y quedan señaladas', () => {
    const estimated = shapeFor({ weightKg: 80, fatPct: 18, muscleKg: 31, sex: 'male' });
    const measured = shapeFor({ weightKg: 80, fatPct: 18, muscleKg: 31, sex: 'male' }, { waist: 72 });
    assert.ok(estimated && measured);
    assert.equal(estimated.fromMeasures, false);
    assert.equal(measured.fromMeasures, true);
    assert.ok(measured.waist < estimated.waist, 'una cintura medida más estrecha debe reflejarse');
});

test('ninguna silueta se vuelve imposible, por extremos que sean los datos', () => {
    for (const comp of [
        { weightKg: 200, fatPct: 55, muscleKg: 40, sex: /** @type {const} */ ('male') },
        { weightKg: 45, fatPct: 8, muscleKg: 25, sex: /** @type {const} */ ('female') },
        { weightKg: 60, fatPct: 45, muscleKg: 15, sex: /** @type {const} */ ('female') }
    ]) {
        const shape = shapeFor(comp);
        assert.ok(shape);
        for (const [key, value] of Object.entries(shape)) {
            if (typeof value !== 'number') continue;
            assert.ok(Number.isFinite(value) && value > 0, `${key} = ${value}`);
        }
        assert.ok(shape.waist < shape.shoulders * 2, 'proporción imposible');
    }
});

test('shapeFor degrada con basura sin lanzar', () => {
    for (const bad of [null, undefined, {}, 'x', 42, { weightKg: NaN, fatPct: 20, muscleKg: 30, sex: 'male' }]) {
        assert.equal(shapeFor(/** @type {*} */ (bad)), null);
    }
    assert.equal(waistToShoulderRatio(null), 0);
});

// ---- Hitos estéticos ----

test('el catálogo está despersonalizado: sin fechas, días ni semanas del plan ajeno', () => {
    assert.ok(AESTHETIC_CATALOG.length > 50);
    for (const item of AESTHETIC_CATALOG) {
        for (const forbidden of ['day', 'date', 'dateFormatted', 'week', 'dayOfWeek', 'phase', 'metricsAtMilestone']) {
            assert.ok(!(forbidden in item), `«${item.title}» aún arrastra ${forbidden}`);
        }
        // y cada uno tiene al menos un umbral de composición: si no, no sería
        // aplicable a otro usuario
        assert.ok(item.fatPctBelow !== null || item.muscleGainKgAbove !== null, `«${item.title}» sin umbral`);
        assert.ok(VISIBILITY_LEVELS.includes(item.visibility), `visibilidad desconocida: ${item.visibility}`);
    }
});

test('los hitos se sitúan en el día del cruce REAL de la serie', () => {
    const { comp, projection } = canonical();
    const milestones = aestheticMilestonesFor(projection, { startMuscleKg: comp.muscleKg }, 60);
    assert.ok(milestones.length > 0);

    for (const m of milestones) {
        assert.ok(Number.isInteger(m.dayIndex) && m.dayIndex >= 0);
        assert.equal(m.dateISO, projection.daily[m.dayIndex].dateISO);
        if (m.fatPctBelow !== null) {
            assert.ok(projection.daily[m.dayIndex].fatPct <= m.fatPctBelow + 1e-9,
                `«${m.title}» situado donde la grasa aún es ${projection.daily[m.dayIndex].fatPct}`);
        }
    }
    // ordenados por día
    for (let i = 1; i < milestones.length; i++) {
        assert.ok(milestones[i].dayIndex >= milestones[i - 1].dayIndex);
    }
});

test('no se promete un hito que el plan NO alcanza', () => {
    const { comp, projection } = canonical();
    const milestones = aestheticMilestonesFor(projection, { startMuscleKg: comp.muscleKg }, 0);
    // este plan gana poco músculo, así que muchos hitos del catálogo no salen
    assert.ok(milestones.length < AESTHETIC_CATALOG.length,
        'se prometieron hitos que la proyección no alcanza');
    const finalFat = projection.daily[projection.daily.length - 1].fatPct;
    for (const m of milestones) {
        if (m.fatPctBelow !== null) assert.ok(m.fatPctBelow >= finalFat - 1e-9);
    }
});

test('reached distingue lo alcanzado de lo pendiente, y next es el primero pendiente', () => {
    const { comp, projection } = canonical();
    const milestones = aestheticMilestonesFor(projection, { startMuscleKg: comp.muscleKg }, 60);
    assert.ok(milestones.every((m) => m.reached === (m.dayIndex <= 60)));

    const next = nextAesthetic(milestones);
    assert.ok(next);
    assert.equal(next.reached, false);
    assert.ok(next.dayIndex > 60);
});

test('byCategory cuenta bien y no inventa categorías', () => {
    const { comp, projection } = canonical();
    const milestones = aestheticMilestonesFor(projection, { startMuscleKg: comp.muscleKg }, 60);
    const groups = byCategory(milestones);
    const total = groups.reduce((s, g) => s + g.total, 0);
    assert.equal(total, milestones.length);
    for (const g of groups) assert.ok(g.reached <= g.total);
});

test('los hitos degradan con proyecciones basura sin lanzar', () => {
    for (const bad of [null, undefined, {}, { daily: [] }, { daily: [null] }, { daily: [{}] }]) {
        assert.deepEqual(aestheticMilestonesFor(/** @type {*} */ (bad), { startMuscleKg: 30 }, 0), []);
    }
    assert.equal(nextAesthetic(/** @type {*} */ (null)), null);
    assert.deepEqual(byCategory(/** @type {*} */ (null)), []);
});

// ---- Logros ----

test('los logros se desbloquean por lo que el usuario HIZO', () => {
    const none = evaluate({});
    assert.ok(none.every((a) => !a.unlocked), 'algo se desbloqueó sin hacer nada');

    const some = evaluate({ checkins: 12, longestStreak: 5, aestheticReached: 6, personalRecords: 2 });
    assert.ok(some.find((a) => a.id === 'checkins10')?.unlocked);
    assert.ok(!some.find((a) => a.id === 'checkins25')?.unlocked);
    assert.ok(some.find((a) => a.id === 'streak4')?.unlocked);
    assert.ok(!some.find((a) => a.id === 'streak12')?.unlocked);
    assert.ok(some.find((a) => a.id === 'firstPr')?.unlocked);
});

test('el progreso de cada logro está entre 0 y 1', () => {
    for (const stats of [{}, { checkins: 3 }, { checkins: 1000, longestStreak: 500 }]) {
        for (const a of evaluate(stats)) {
            assert.ok(a.progress >= 0 && a.progress <= 1, `${a.id} → ${a.progress}`);
        }
    }
});

test('evaluate degrada con basura', () => {
    for (const bad of [null, undefined, 'x', 42, { checkins: NaN }, { checkins: -5 }]) {
        const list = evaluate(/** @type {*} */ (bad));
        assert.equal(list.length, ACHIEVEMENT_RULES.length);
        assert.ok(list.every((a) => Number.isFinite(a.progress)));
    }
});

test('la tarjeta compartible NO lleva peso ni %grasa por defecto', () => {
    const card = shareCard({ percentComplete: 45, phaseKey: 'cut', streakWeeks: 6, achievementsUnlocked: 3, weightKg: 74.2, fatPct: 17.1 });
    assert.equal(card.weightKg, null, 'el peso se filtró sin que el usuario lo pidiera');
    assert.equal(card.fatPct, null);
    assert.equal(card.percentComplete, 45);
    assert.equal(card.streakWeeks, 6);
});

test('los absolutos solo salen con opt-in explícito', () => {
    const card = shareCard({ percentComplete: 45, phaseKey: 'cut', streakWeeks: 6, achievementsUnlocked: 3, weightKg: 74.2, fatPct: 17.1 },
        { includeAbsolutes: true });
    assert.equal(card.weightKg, 74.2);
    assert.equal(card.fatPct, 17.1);
});

test('shareCard degrada con basura y acota el porcentaje', () => {
    for (const bad of [null, undefined, 'x', { percentComplete: 500 }, { percentComplete: -20 }]) {
        const card = shareCard(/** @type {*} */ (bad));
        assert.ok(card.percentComplete >= 0 && card.percentComplete <= 100);
        assert.equal(card.weightKg, null);
    }
});

// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/core/constants.js';
import { mulberry32, seedFrom } from '../src/core/rng.js';

// ---- M1-1 · constants ----

test('multiplicadores de actividad: los 5 estándar, estrictamente crecientes', () => {
    const values = [
        C.ACTIVITY_MULTIPLIERS.sedentary,
        C.ACTIVITY_MULTIPLIERS.light,
        C.ACTIVITY_MULTIPLIERS.moderate,
        C.ACTIVITY_MULTIPLIERS.active,
        C.ACTIVITY_MULTIPLIERS.veryActive
    ];
    assert.deepEqual(values, [1.2, 1.375, 1.55, 1.725, 1.9]);
    for (let i = 1; i < values.length; i++) assert.ok(values[i] > values[i - 1]);
});

test('tasas de pérdida de grasa: 0,5–1 % PC/semana (Aragon 2017)', () => {
    assert.deepEqual(C.FAT_LOSS_RATES_PCT_BW_WEEK, {
        conservative: 0.005,
        moderate: 0.0075,
        aggressive: 0.01
    });
});

test('tasas musculares relativas reproducen las absolutas de McDonald/Helms a 75 kg', () => {
    const ref = 75;
    const abs = (r) => ({ min: r.min * ref, avg: r.avg * ref, max: r.max * ref });
    const b = abs(C.MUSCLE_GAIN_RATES_PCT_BW_MONTH.beginner);
    const i = abs(C.MUSCLE_GAIN_RATES_PCT_BW_MONTH.intermediate);
    const a = abs(C.MUSCLE_GAIN_RATES_PCT_BW_MONTH.advanced);
    // legacy verificado: novato 0,9–1,4 · intermedio 0,45–0,9 · avanzado 0,2–0,45 kg/mes
    assert.ok(Math.abs(b.min - 0.9) < 0.01 && Math.abs(b.max - 1.4) < 0.01, `beginner: ${JSON.stringify(b)}`);
    assert.ok(Math.abs(i.min - 0.45) < 0.01 && Math.abs(i.max - 0.9) < 0.01, `intermediate: ${JSON.stringify(i)}`);
    assert.ok(Math.abs(a.min - 0.2) < 0.01 && Math.abs(a.max - 0.45) < 0.01, `advanced: ${JSON.stringify(a)}`);
    // decrecientes con la experiencia
    assert.ok(b.avg > i.avg && i.avg > a.avg);
});

test('umbrales de grasa coherentes: esencial < mínimo seguro < máximo', () => {
    for (const sex of /** @type {const} */ (['male', 'female'])) {
        assert.ok(C.ESSENTIAL_FAT_PCT[sex] < C.MIN_SAFE_FAT_PCT[sex]);
        assert.ok(C.MIN_SAFE_FAT_PCT[sex] < C.MAX_FAT_PCT[sex]);
        assert.ok(C.MAX_FAT_PCT[sex] < C.ABSOLUTE_MAX_FAT_PCT);
    }
});

test('equivalencia energética y suelo calórico presentes (B2/B3)', () => {
    assert.equal(C.KCAL_PER_KG_FAT, 7700);
    assert.ok(C.KCAL_PER_KG_MUSCLE >= 2000 && C.KCAL_PER_KG_MUSCLE <= 2700);
    assert.equal(C.CALORIC_FLOOR_KCAL.male, 1500);
    assert.equal(C.CALORIC_FLOOR_KCAL.female, 1200);
});

test('adaptación metabólica acotada al 10 % (Trexler 2014)', () => {
    assert.ok(C.METABOLIC_ADAPTATION.maxReduction <= 0.15);
    assert.ok(C.METABOLIC_ADAPTATION.onsetPerWeek > 0);
});

test('las constantes están congeladas (inmutables)', () => {
    assert.ok(Object.isFrozen(C.ACTIVITY_MULTIPLIERS));
    assert.ok(Object.isFrozen(C.MUSCLE_GAIN_RATES_PCT_BW_MONTH.beginner));
    assert.ok(Object.isFrozen(C.RECOMP.fatPctWindow.male));
});

// ---- M1-2 · rng ----

test('determinismo: misma semilla → secuencia idéntica', () => {
    const a = mulberry32(123456789);
    const b = mulberry32(123456789);
    for (let i = 0; i < 1000; i++) assert.equal(a(), b());
});

test('semillas distintas → secuencias distintas', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 10 }, a);
    const seqB = Array.from({ length: 10 }, b);
    assert.notDeepEqual(seqA, seqB);
});

test('los valores caen en [0, 1) y su media ronda 0,5', () => {
    const rng = mulberry32(42);
    let sum = 0;
    const N = 10000;
    for (let i = 0; i < N; i++) {
        const v = rng();
        assert.ok(v >= 0 && v < 1);
        sum += v;
    }
    assert.ok(Math.abs(sum / N - 0.5) < 0.02, `media ${sum / N}`);
});

test('seedFrom es determinista y sensible a perfil y fecha', () => {
    assert.equal(seedFrom('p1', '2026-08-02'), seedFrom('p1', '2026-08-02'));
    assert.notEqual(seedFrom('p1', '2026-08-02'), seedFrom('p2', '2026-08-02'));
    assert.notEqual(seedFrom('p1', '2026-08-02'), seedFrom('p1', '2026-08-03'));
    const s = seedFrom('p1', '2026-08-02');
    assert.ok(Number.isInteger(s) && s >= 0 && s < 2 ** 32);
});

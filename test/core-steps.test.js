// @ts-check

/**
 * Invariantes de pasos / NEAT (V2-M7).
 *
 * Los dos con nombre: `sin_doble_conteo` y `monotono`.
 *
 * El primero es el que justifica que este módulo exista. El multiplicador de
 * actividad del onboarding YA incluye andar; sumar encima las kilocalorías de
 * los pasos cuenta lo mismo dos veces, infla el gasto y rompe el balance
 * energético del que cuelga todo el plan.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    KCAL_PER_STEP_AT_70KG, REFERENCE_WEIGHT_KG, BASELINE_STEPS, MAX_DAILY_STEPS,
    stepsKcal, neatDelta, neatAverage, tradeOff, dailyTarget
} from '../src/core/steps.js';
import { ACTIVITY_MULTIPLIERS, KCAL_PER_KG_FAT } from '../src/core/constants.js';

// ============================================================
// sin_doble_conteo
// ============================================================

test('sin_doble_conteo · andar los pasos que tu nivel ya supone aporta CERO', () => {
    for (const level of Object.keys(BASELINE_STEPS)) {
        const d = neatDelta({ steps: BASELINE_STEPS[level], activityLevel: level, weightKg: 80 });
        assert.equal(d.deltaKcal, 0, `${level}: ${d.deltaKcal} kcal de más`);
        assert.equal(d.deltaSteps, 0);
    }
});

test('sin_doble_conteo · hay una referencia de pasos para CADA nivel de actividad', () => {
    // Si un nivel no tuviera referencia, sus pasos se contarían enteros sobre un
    // PAL que ya los incluye: exactamente el doble conteo que este módulo evita.
    for (const level of Object.keys(ACTIVITY_MULTIPLIERS)) {
        assert.ok(BASELINE_STEPS[level] !== undefined, `falta la referencia de «${level}»`);
    }
});

test('sin_doble_conteo · el delta es la diferencia, no el bruto', () => {
    const d = neatDelta({ steps: 12000, activityLevel: 'moderate', weightKg: 70 });
    assert.equal(d.baselineSteps, 8500);
    assert.equal(d.deltaSteps, 3500);
    // El bruto de 12 000 pasos son 480 kcal; lo que APORTA sobre el plan son las
    // 140 de los 3 500 de más. Sumar 480 sería contar dos veces las primeras
    // 8 500.
    assert.equal(d.grossKcal, 480);
    assert.equal(d.deltaKcal, 140);
    assert.notEqual(d.deltaKcal, d.grossKcal);
});

test('sin_doble_conteo · andar MENOS de lo declarado resta, y eso es una función', () => {
    // Alguien que se declaró «activo» y lleva una semana en el sofá gasta menos
    // de lo que el plan supone, y saberlo es justo lo que explica que la báscula
    // no baje.
    const d = neatDelta({ steps: 3000, activityLevel: 'active', weightKg: 70 });
    assert.ok(d.deltaKcal < 0, `debería ser negativo y salió ${d.deltaKcal}`);
    assert.equal(d.deltaSteps, 3000 - BASELINE_STEPS.active);
});

test('sin_doble_conteo · un nivel desconocido no colapsa a cero pasos de referencia', () => {
    // Degradar a 0 haría que TODOS los pasos contaran como extra: el doble
    // conteo entero, y por la puerta de atrás.
    const d = neatDelta({ steps: 8500, activityLevel: 'inventado', weightKg: 70 });
    assert.equal(d.baselineSteps, BASELINE_STEPS.moderate);
    assert.equal(d.deltaKcal, 0);
});

// ============================================================
// monotono
// ============================================================

test('monotono · más pasos nunca dan menos gasto', () => {
    let anterior = -1;
    for (let steps = 0; steps <= 30000; steps += 250) {
        const kcal = stepsKcal(steps, 80);
        assert.ok(kcal >= anterior, `${steps} pasos dieron ${kcal}, menos que el tramo anterior`);
        anterior = kcal;
    }
});

test('monotono · el delta también es monótono en los pasos', () => {
    let anterior = -Infinity;
    for (let steps = 0; steps <= 25000; steps += 500) {
        const { deltaKcal } = neatDelta({ steps, activityLevel: 'moderate', weightKg: 75 });
        assert.ok(deltaKcal >= anterior, `${steps} pasos rompieron la monotonía`);
        anterior = deltaKcal;
    }
});

test('monotono · pesar más cuesta más por el mismo paseo', () => {
    const ligero = stepsKcal(10000, 60);
    const pesado = stepsKcal(10000, 100);
    assert.ok(pesado > ligero, 'mover 100 kg debería costar más que mover 60');
});

// ============================================================
// La fórmula
// ============================================================

test('la constante cuadra con la vía MET al 5 %', () => {
    // 10 000 pasos ≈ 8 km ≈ 96 min a 5 km/h; a 3,5 MET y 70 kg:
    //   96 × 3,5 × 3,5 × 70 / 200 ≈ 411 kcal
    const porMet = (96 * 3.5 * 3.5 * REFERENCE_WEIGHT_KG) / 200;
    const porConstante = stepsKcal(10000, REFERENCE_WEIGHT_KG);
    assert.equal(porConstante, 400);
    // Que dos caminos independientes coincidan es lo que hace usable la cifra.
    assert.ok(Math.abs(porMet - porConstante) / porMet < 0.05,
        `${porMet.toFixed(0)} por MET frente a ${porConstante} por la constante`);
    assert.equal(KCAL_PER_STEP_AT_70KG, 0.04);
});

test('entrada absurda da cero, nunca NaN', () => {
    for (const steps of [Number.NaN, -500, undefined, /** @type {*} */ ('mil')]) {
        assert.equal(stepsKcal(/** @type {*} */ (steps), 80), 0);
    }
    // Y un peso absurdo cae al de referencia en vez de anular el cálculo.
    assert.equal(stepsKcal(10000, /** @type {*} */ (Number.NaN)), 400);
    assert.equal(stepsKcal(10000, 0), 400);
});

test('una cifra imposible se acota en vez de aceptarse', () => {
    // 900 000 pasos es un error de tecleo, no una maratón.
    assert.equal(stepsKcal(900000, 70), stepsKcal(MAX_DAILY_STEPS, 70));
    const d = neatDelta({ steps: 900000, activityLevel: 'moderate', weightKg: 70 });
    assert.equal(d.deltaSteps, MAX_DAILY_STEPS - BASELINE_STEPS.moderate);
});

// ============================================================
// Media del periodo
// ============================================================

test('la media mira el periodo, no el último día', () => {
    const entries = [
        { dateISO: '2026-08-01', steps: 12000 },
        { dateISO: '2026-08-02', steps: 12000 },
        { dateISO: '2026-08-03', steps: 0 }   // domingo de sofá
    ];
    const r = neatAverage({ entries, activityLevel: 'moderate', weightKg: 70, days: 7 });
    assert.ok(r);
    assert.equal(r.meanSteps, 8000);
    assert.equal(r.days, 3);
    // Un día de sofá no debe tirar el ajuste de la semana.
    assert.ok(Math.abs(r.delta.deltaKcal) < 30);
});

test('la media se queda en la ventana pedida', () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
        dateISO: `2026-08-${String(i + 1).padStart(2, '0')}`,
        steps: i < 23 ? 0 : 14000
    }));
    const r = neatAverage({ entries, activityLevel: 'moderate', weightKg: 70, days: 7 });
    assert.ok(r);
    assert.equal(r.meanSteps, 14000, 'se colaron días de fuera de la ventana');
});

test('sin registros devuelve null, no una media inventada', () => {
    assert.equal(neatAverage({ entries: [], activityLevel: 'moderate', weightKg: 70 }), null);
    assert.equal(neatAverage({ entries: /** @type {*} */ (null), weightKg: 70 }), null);
});

test('las entradas rotas se descartan sin tumbar la media', () => {
    const r = neatAverage({
        entries: /** @type {*} */ ([
            { dateISO: '2026-08-01', steps: 10000 },
            { dateISO: '2026-08-02', steps: 'muchos' },
            { steps: 5000 }
        ]),
        activityLevel: 'moderate', weightKg: 70
    });
    assert.ok(r);
    assert.equal(r.days, 1);
    assert.equal(r.meanSteps, 10000);
});

// ============================================================
// El canje
// ============================================================

test('el canje usa la MISMA equivalencia energética que el motor', () => {
    const r = tradeOff({ extraSteps: 3000, weightKg: 70 });
    assert.equal(r.kcalPerDay, 120);
    // 7 700 kcal por kilo de grasa (B3). Otra cifra aquí haría que la app se
    // contradijera consigo misma entre dos pantallas.
    assert.equal(r.kgPerWeek, Math.round(((120 * 7) / KCAL_PER_KG_FAT) * 1000) / 1000);
    assert.ok(r.kgPerMonth > r.kgPerWeek);
});

test('el canje funciona en los dos sentidos', () => {
    const menos = tradeOff({ extraSteps: -3000, weightKg: 70 });
    assert.equal(menos.kcalPerDay, -120);
    assert.ok(menos.kgPerWeek < 0);
});

test('el canje de cero pasos es exactamente cero', () => {
    const r = tradeOff({ extraSteps: 0, weightKg: 80 });
    assert.equal(r.kcalPerDay, 0);
    assert.equal(r.kgPerWeek, 0);
    assert.equal(r.kgPerMonth, 0);
});

// ============================================================
// Objetivo
// ============================================================

test('el objetivo sale del nivel declarado, no de un 10 000 universal', () => {
    // Esa cifra salió de una campaña de marketing japonesa de 1965, no de un
    // estudio, y ponerla de meta a alguien sedentario es fijarle algo que no va
    // a cumplir.
    assert.equal(dailyTarget('sedentary'), 4000);
    assert.equal(dailyTarget('veryActive'), 14000);
    assert.notEqual(dailyTarget('sedentary'), 10000);
    assert.equal(dailyTarget('loQueSea'), BASELINE_STEPS.moderate);
});

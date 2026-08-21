// @ts-check

/**
 * Gasto energético medido (V2-M1).
 *
 * El módulo despeja el gasto del balance energético invertido. Los tests de
 * aquí son sobre todo de HONESTIDAD: que no invente una cifra cuando no hay
 * datos, que no se deje arrastrar por el ruido del peso diario, y que ofrezca
 * recalibrar solo cuando la diferencia es real.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    measuredExpenditure, weightTrend, compareWithFormula,
    MIN_DAYS, MEANINGFUL_GAP_KCAL, MAX_PLAUSIBLE_DAILY_KG, activityLevelFor} from '../src/core/expenditure.js';
import { KCAL_PER_KG_FAT } from '../src/core/constants.js';

const DIA = 86400000;
const INICIO = Date.parse('2026-01-01T00:00:00Z');

/** @param {number} n @returns {string} */
const fecha = (n) => new Date(INICIO + n * DIA).toISOString().slice(0, 10);

/**
 * Serie sintética: ingesta constante y peso que cambia a un ritmo fijo, con
 * ruido opcional. Es el caso que se puede resolver a mano.
 * @param {{ days: number, kcal: number, startKg: number, kgPerDay: number, noise?: number[] }} o
 */
function serie({ days, kcal, startKg, kgPerDay, noise = [] }) {
    /** @type {Array<{dateISO: string, kcal: number}>} */ const intake = [];
    /** @type {Array<{dateISO: string, weightKg: number}>} */ const weights = [];
    for (let d = 0; d <= days; d++) {
        intake.push({ dateISO: fecha(d), kcal });
        weights.push({ dateISO: fecha(d), weightKg: startKg + kgPerDay * d + (noise[d] ?? 0) });
    }
    return { intake, weights };
}

/* ---------------------------------------------------------------------- *
 * Honestidad: sin datos, no hay cifra
 * ---------------------------------------------------------------------- */

test('sin datos suficientes devuelve null, no una cifra mala', () => {
    // Media docena de días no distinguen señal de agua. Un número inventado es
    // peor que un «todavía no lo sé», porque el usuario actuaría sobre él.
    assert.equal(measuredExpenditure({ intake: [], weights: [] }), null);
    const corta = serie({ days: 5, kcal: 2200, startKg: 80, kgPerDay: -0.05 });
    assert.equal(measuredExpenditure(corta), null, `bastaron ${5} días`);
});

test('con peso pero sin ingesta registrada, tampoco inventa', () => {
    const { weights } = serie({ days: 30, kcal: 2200, startKg: 80, kgPerDay: -0.05 });
    assert.equal(measuredExpenditure({ intake: [], weights }), null);
});

test('exige MIN_DAYS de ingesta, no solo de peso', () => {
    const { weights } = serie({ days: 30, kcal: 2200, startKg: 80, kgPerDay: -0.05 });
    const pocaIngesta = Array.from({ length: MIN_DAYS - 1 }, (_, i) => ({ dateISO: fecha(i), kcal: 2200 }));
    assert.equal(measuredExpenditure({ intake: pocaIngesta, weights }), null);
});

/* ---------------------------------------------------------------------- *
 * La aritmética, comprobable a mano
 * ---------------------------------------------------------------------- */

test('el caso resoluble a mano: peso estable ⇒ gasto = ingesta', () => {
    // Si el peso no se mueve, lo que comes ES lo que gastas. Es el ancla del
    // módulo entero: si esto fallara, todo lo demás sobra.
    const r = measuredExpenditure(serie({ days: 30, kcal: 2400, startKg: 80, kgPerDay: 0 }));
    assert.ok(r, 'no dio resultado con 30 días');
    assert.equal(r.tdeeKcal, 2400);
    assert.equal(r.trendDeltaKg, 0);
});

test('perdiendo peso, el gasto sale POR ENCIMA de la ingesta', () => {
    // 0,5 kg/semana ≈ 0,0714 kg/día ≈ 550 kcal/día de déficit.
    const kgPerDay = -0.5 / 7;
    const r = measuredExpenditure(serie({ days: 60, kcal: 2000, startKg: 85, kgPerDay }));
    assert.ok(r);
    const esperado = 2000 + (0.5 / 7) * KCAL_PER_KG_FAT;
    assert.ok(Math.abs(r.tdeeKcal - esperado) < 15,
        `gasto ${r.tdeeKcal}, esperado ≈ ${Math.round(esperado)}`);
    assert.ok(r.tdeeKcal > 2000, 'el signo está invertido');
});

test('ganando peso, el gasto sale POR DEBAJO de la ingesta', () => {
    const r = measuredExpenditure(serie({ days: 60, kcal: 3000, startKg: 70, kgPerDay: 0.25 / 7 }));
    assert.ok(r);
    assert.ok(r.tdeeKcal < 3000, `gasto ${r.tdeeKcal} no bajó de la ingesta`);
});

/* ---------------------------------------------------------------------- *
 * El ruido: la razón de que exista la tendencia
 * ---------------------------------------------------------------------- */

test('el ruido diario de agua NO mueve el gasto medido', () => {
    // Es LA razón de usar tendencia y no dos pesadas. Sin media móvil, una
    // pesada alta el primer día y otra baja el último dan cientos de kcal de
    // diferencia sobre la misma realidad fisiológica.
    const noise = Array.from({ length: 61 }, (_, i) => (i % 2 === 0 ? 0.8 : -0.8));
    const limpia = measuredExpenditure(serie({ days: 60, kcal: 2200, startKg: 80, kgPerDay: -0.05 }));
    const ruidosa = measuredExpenditure(serie({ days: 60, kcal: 2200, startKg: 80, kgPerDay: -0.05, noise }));
    assert.ok(limpia && ruidosa);
    assert.ok(Math.abs(limpia.tdeeKcal - ruidosa.tdeeKcal) < 120,
        `el ruido movió el gasto de ${limpia.tdeeKcal} a ${ruidosa.tdeeKcal}`);
});

test('una lectura imposible (error de tecleo) se descarta, no arrastra la media', () => {
    // 80 kg → 8 kg de un día para otro es un dedo, no una persona. Sin filtro,
    // esa sola lectura hunde la media de toda su ventana.
    const base = serie({ days: 40, kcal: 2200, startKg: 80, kgPerDay: -0.05 });
    const conError = {
        intake: base.intake,
        weights: base.weights.map((w, i) => (i === 20 ? { ...w, weightKg: 8 } : w))
    };
    const limpio = measuredExpenditure(base);
    const sucio = measuredExpenditure(conError);
    assert.ok(limpio && sucio);
    assert.ok(Math.abs(limpio.tdeeKcal - sucio.tdeeKcal) < 100,
        `el error de tecleo movió el gasto de ${limpio.tdeeKcal} a ${sucio.tdeeKcal}`);
});

test('weightTrend suaviza de verdad: menos recorrido que las pesadas crudas', () => {
    const noise = Array.from({ length: 31 }, (_, i) => (i % 2 === 0 ? 1 : -1));
    const { weights } = serie({ days: 30, kcal: 2200, startKg: 80, kgPerDay: 0, noise });
    // Solo los puntos de ventana COMPLETA: los del principio promedian menos
    // días y por eso conservan casi todo el ruido — es exactamente por lo que
    // `measuredExpenditure` los descarta.
    const trend = weightTrend(weights).filter((t) => t.full);
    assert.ok(trend.length > 0, 'no hubo ningún punto de ventana completa');
    const rangoCrudo = Math.max(...weights.map((w) => w.weightKg)) - Math.min(...weights.map((w) => w.weightKg));
    const rangoTend = Math.max(...trend.map((t) => t.trendKg)) - Math.min(...trend.map((t) => t.trendKg));
    assert.ok(rangoTend < rangoCrudo / 2,
        `la tendencia no suavizó: crudo ${rangoCrudo.toFixed(2)}, tendencia ${rangoTend.toFixed(2)}`);
});

test('saltarse días no finge una tendencia que no se midió', () => {
    // La ventana es de DÍAS, no de registros: con pesadas semanales, cada punto
    // de tendencia es esa pesada, no la media de las siete anteriores.
    const weights = [0, 7, 14, 21, 28].map((d) => ({ dateISO: fecha(d), weightKg: 80 - d * 0.05 }));
    const trend = weightTrend(weights);
    assert.equal(trend.length, 5);
    assert.ok(Math.abs(trend[0].trendKg - 80) < 0.001);
});

/* ---------------------------------------------------------------------- *
 * La oferta: nunca en silencio, nunca por ruido
 * ---------------------------------------------------------------------- */

test('sin datos no se ofrece nada', () => {
    const v = compareWithFormula(null, 2400);
    assert.equal(v.offer, false);
    assert.equal(v.reason, 'insufficientData');
    assert.equal(v.measuredKcal, null);
});

test('una diferencia pequeña NO dispara la oferta', () => {
    // Mover el plan por ruido es el fallo que más daña la credibilidad; la
    // misma lección que el suelo de ruido de M4.
    const medido = measuredExpenditure(serie({ days: 30, kcal: 2400, startKg: 80, kgPerDay: 0 }));
    assert.ok(medido);
    const v = compareWithFormula(medido, 2400 + MEANINGFUL_GAP_KCAL - 20);
    assert.equal(v.offer, false);
    assert.equal(v.reason, 'agrees');
});

test('una diferencia real SÍ se ofrece, con su signo y su cifra', () => {
    const medido = measuredExpenditure(serie({ days: 30, kcal: 2800, startKg: 80, kgPerDay: 0 }));
    assert.ok(medido);

    const gastaMas = compareWithFormula(medido, 2400);
    assert.equal(gastaMas.offer, true);
    assert.equal(gastaMas.reason, 'higher');
    assert.equal(gastaMas.gapKcal, 400);

    const gastaMenos = compareWithFormula(medido, 3200);
    assert.equal(gastaMenos.offer, true);
    assert.equal(gastaMenos.reason, 'lower');
    assert.equal(gastaMenos.gapKcal, -400);
});

/* ---------------------------------------------------------------------- *
 * Robustez: entra basura, no sale un NaN
 * ---------------------------------------------------------------------- */

test('entradas corruptas no producen NaN ni lanzan', () => {
    const basura = /** @type {*} */ ({
        intake: [{ dateISO: 'ayer', kcal: 'mucho' }, null, { kcal: 2000 }],
        weights: [{ dateISO: '2026-01-01', weightKg: NaN }, undefined, 'no soy un peso']
    });
    assert.doesNotThrow(() => measuredExpenditure(basura));
    assert.equal(measuredExpenditure(basura), null);
    assert.doesNotThrow(() => weightTrend(/** @type {*} */ (null)));
    assert.deepEqual(weightTrend(/** @type {*} */ (null)), []);
});

test('dos registros de ingesta del mismo día son una corrección, no dos comidas', () => {
    const base = serie({ days: 40, kcal: 2400, startKg: 80, kgPerDay: 0 });
    const sinDuplicar = measuredExpenditure(base);
    assert.ok(sinDuplicar);

    // El usuario apuntó 900 en el día 20 y luego lo corrigió a 2400: dos
    // registros de la misma fecha. Ni se suman ni cuentan como dos días.
    const conCorreccion = {
        weights: base.weights,
        intake: [
            ...base.intake.map((e) => (e.dateISO === fecha(20) ? { ...e, kcal: 900 } : e)),
            { dateISO: fecha(20), kcal: 2400 }
        ]
    };
    const r = measuredExpenditure(conCorreccion);
    assert.ok(r);
    assert.equal(r.intakeDays, sinDuplicar.intakeDays, 'contó el día corregido dos veces');
    assert.equal(r.tdeeKcal, sinDuplicar.tdeeKcal, 'no se quedó con la corrección');
});

test('el umbral y los mínimos están documentados como constantes, no incrustados', () => {
    // Si alguien los cambia, que sea a propósito y en un solo sitio.
    assert.ok(MIN_DAYS >= 14, 'menos de dos semanas no separa señal de agua');
    assert.ok(MEANINGFUL_GAP_KCAL >= 100);
    assert.ok(MAX_PLAUSIBLE_DAILY_KG > 0 && MAX_PLAUSIBLE_DAILY_KG <= 3);
});

/* ────────────────────────────────────────────────────────────────────────────
 * E15-12 · Qué significa APLICAR un gasto medido
 *
 * El motor obtiene el TDEE de `BMR × multiplicador` y no admite una cifra a
 * mano, así que aplicar un gasto medido significa exactamente una cosa:
 * corregir el nivel de actividad del perfil. Hasta E15-12, el botón que lo
 * ofrecía era un `toast.success` sobre un no-op.
 * ──────────────────────────────────────────────────────────────────────────── */

test('activityLevelFor elige el nivel cuyo multiplicador mejor explica lo medido', () => {
    const bmr = 1800;
    // Justo encima de cada multiplicador: 1,2 · 1,375 · 1,55 · 1,725 · 1,9
    assert.equal(activityLevelFor(1800 * 1.2, bmr)?.level, 'sedentary');
    assert.equal(activityLevelFor(1800 * 1.375, bmr)?.level, 'light');
    assert.equal(activityLevelFor(1800 * 1.55, bmr)?.level, 'moderate');
    assert.equal(activityLevelFor(1800 * 1.725, bmr)?.level, 'active');
    assert.equal(activityLevelFor(1800 * 1.9, bmr)?.level, 'veryActive');
});

test('activityLevelFor DEVUELVE el residuo: el modelo tiene cinco escalones', () => {
    // Lo medido cae entre «moderate» (1,55) y «active» (1,725). Se elige el más
    // cercano y se dice cuánto se queda fuera, en vez de prometer una precisión
    // que el modelo no tiene.
    const bmr = 1800;
    const r = activityLevelFor(bmr * 1.6, bmr);
    assert.equal(r?.level, 'moderate');
    assert.equal(r?.residualKcal, Math.round(bmr * 1.6 - bmr * 1.55));
    assert.ok(Math.abs(/** @type {*} */ (r).residualKcal) > 0);
});

test('activityLevelFor satura en los extremos, sin inventarse un nivel', () => {
    const bmr = 1800;
    // Por debajo del suelo del modelo y muy por encima del techo.
    assert.equal(activityLevelFor(bmr * 0.9, bmr)?.level, 'sedentary');
    const alto = activityLevelFor(bmr * 2.6, bmr);
    assert.equal(alto?.level, 'veryActive');
    // Y el residuo lo DICE: un atleta de resistencia no cabe en la rejilla.
    assert.ok(/** @type {*} */ (alto).residualKcal > 1000);
});

test('activityLevelFor devuelve null con entradas imposibles, sin lanzar', () => {
    for (const [tdee, bmr] of [[NaN, 1800], [2500, 0], [2500, NaN], [null, null], ['x', 'y']]) {
        assert.equal(activityLevelFor(/** @type {*} */ (tdee), /** @type {*} */ (bmr)), null);
    }
});

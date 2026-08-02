// @ts-check

/**
 * M4-2/5/6 · Seguimiento: desviación, umbrales de recalibración y constancia.
 * Test primero: esta lógica decide cuándo la app le dice al usuario que su
 * plan ya no le sirve, así que se especifica antes de existir.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeComposition, planPhases } from '../src/core/engine.js';
import { generateProjection } from '../src/core/generator.js';
import { seedFrom } from '../src/core/rng.js';
import {
    toleranceAt,
    evaluateCheckin,
    evaluateSeries,
    recalibrationOffer,
    streakOf,
    adherenceCalendar,
    inferFatPct,
    CHECKIN_NOISE_FLOOR_PCT_BW,
    RECALIBRATION
} from '../src/core/tracking.js';

const PROFILE = { sex: /** @type {const} */ ('male'), age: 30, heightCm: 175, activityLevel: /** @type {const} */ ('moderate'), trainingStatus: /** @type {const} */ ('intermediate') };
const START = '2026-08-03';

/** Proyección del perfil canónico de docs/VERIFICACION-MANUAL.md §3. */
function canonical() {
    const comp = makeComposition({ weightKg: 75, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const plan = planPhases(comp.value, { fatPct: 12, muscleKg: 30 }, PROFILE);
    assert.ok(plan.ok);
    const proj = generateProjection(plan.value, comp.value, PROFILE, {
        startDateISO: START, seed: seedFrom('p1', START), fluctuation: false
    });
    assert.ok(proj.ok);
    return proj.value;
}

/** Fecha civil del día N del plan. */
function dayDate(n) {
    return new Date(Date.UTC(2026, 7, 3 + n)).toISOString().slice(0, 10);
}

/** Check-in mínimo válido. */
function checkin(day, weightKg, extra = {}) {
    return {
        id: `ci${day}`, dateISO: dayDate(day), weightKg,
        fatPct: null, measuresCm: {}, subjective: {},
        notes: '', createdAtISO: '2026-08-03T00:00:00.000Z', editedAtISO: null,
        ...extra
    };
}

// ============================================================
// Tolerancia: el hallazgo que motivó el diseño
// ============================================================

test('la tolerancia NUNCA baja del suelo de ruido de medición', () => {
    const projection = canonical();
    // La banda en la semana 1 mide ±0,17 kg, más estrecha que la variación
    // real de agua y glucógeno: sin suelo, todo check-in honesto caería fuera.
    const week1 = toleranceAt(projection, 7);
    const expectedFloor = projection.daily[7].weightKg * CHECKIN_NOISE_FLOOR_PCT_BW;
    assert.ok(week1 >= expectedFloor - 1e-9, `tolerancia semana 1 = ${week1}, suelo = ${expectedFloor}`);
    assert.ok(week1 > 0.9, `la tolerancia inicial debe cubrir el ruido real: ${week1}`);
});

test('la tolerancia NUNCA es cero, ni siquiera donde la banda se cierra', () => {
    const projection = canonical();
    const last = projection.daily.length - 1;
    // Por el invariante `escenarios` de M1 los tres cierran en el objetivo,
    // así que la banda vale 0 al final. La tolerancia no puede heredar eso.
    const bandWidth = Math.abs(projection.daily[last].band.optimistKg - projection.daily[last].band.pessimistKg);
    assert.ok(bandWidth < 1e-6, 'la banda debería cerrarse al final');
    assert.ok(toleranceAt(projection, last) > 0.5, 'la tolerancia final no puede ser cero');
});

test('donde la banda es ancha, manda la banda; donde es estrecha, manda el suelo', () => {
    const projection = canonical();
    for (const day of [7, 28, 56, 84, 140, 170]) {
        const half = Math.abs(projection.daily[day].band.optimistKg - projection.daily[day].band.pessimistKg) / 2;
        const floor = projection.daily[day].weightKg * CHECKIN_NOISE_FLOOR_PCT_BW;
        assert.ok(Math.abs(toleranceAt(projection, day) - Math.max(half, floor)) < 1e-9, `día ${day}`);
    }
});

test('toleranceAt degrada sin lanzar con índices fuera de rango', () => {
    const projection = canonical();
    for (const day of [-5, 99999, NaN, /** @type {*} */ ('x')]) {
        const value = toleranceAt(projection, day);
        assert.ok(Number.isFinite(value) && value > 0, `día ${day} → ${value}`);
    }
});

// ============================================================
// Señal ternaria
// ============================================================

test('un check-in en el peso proyectado está dentro de banda', () => {
    const projection = canonical();
    const day = 28;
    const result = evaluateCheckin(projection, checkin(day, projection.daily[day].weightKg), START);
    assert.ok(result.ok);
    assert.equal(result.value.signal, 'within');
    assert.equal(result.value.dayIndex, day);
    assert.ok(Math.abs(result.value.deltaKg) < 1e-9);
});

test('el ruido de báscula normal NO se marca como desviación', () => {
    const projection = canonical();
    const day = 7;
    // ±0,8 kg es variación de agua perfectamente normal
    for (const noise of [0.8, -0.8]) {
        const result = evaluateCheckin(projection, checkin(day, projection.daily[day].weightKg + noise), START);
        assert.ok(result.ok);
        assert.equal(result.value.signal, 'within', `ruido de ${noise} kg marcado como desviación`);
    }
});

test('señal ternaria: por encima y por debajo del corredor', () => {
    const projection = canonical();
    const day = 28;
    const tolerance = toleranceAt(projection, day);
    const expected = projection.daily[day].weightKg;

    const above = evaluateCheckin(projection, checkin(day, expected + tolerance + 0.5), START);
    assert.ok(above.ok && above.value.signal === 'above');

    const below = evaluateCheckin(projection, checkin(day, expected - tolerance - 0.5), START);
    assert.ok(below.ok && below.value.signal === 'below');
});

test('un check-in fuera del rango de fechas del plan se rechaza sin lanzar', () => {
    const projection = canonical();
    for (const date of ['2026-01-01', '2030-01-01', 'no-es-fecha']) {
        const result = evaluateCheckin(projection, { ...checkin(0, 75), dateISO: date }, START);
        assert.equal(result.ok, false, `aceptó ${date}`);
    }
});

test('evaluateSeries ordena por fecha y descarta lo inevaluable', () => {
    const projection = canonical();
    const items = [
        checkin(21, 74.0),
        checkin(7, 74.8),
        { ...checkin(14, 74.5), dateISO: 'basura' },
        checkin(14, 74.5)
    ];
    const series = evaluateSeries(projection, items, START);
    assert.equal(series.length, 3);
    assert.deepEqual(series.map((s) => s.dayIndex), [7, 14, 21]);
});

// ============================================================
// Umbrales de recalibración
// ============================================================

/** Genera N check-ins consecutivos con una desviación dada, en semanas 1..N. */
function weeklySeries(projection, count, deltaFactor, options = {}) {
    const items = [];
    for (let w = 1; w <= count; w++) {
        const day = w * 7;
        const tolerance = toleranceAt(projection, day);
        const offset = tolerance * deltaFactor * (options.alternate && w % 2 === 0 ? -1 : 1);
        items.push(checkin(day, projection.daily[day].weightKg + offset, options.extra ?? {}));
    }
    return items;
}

test('no se ofrece recalibrar antes del mínimo de check-ins, por muy fuera que se vaya', () => {
    const projection = canonical();
    const series = evaluateSeries(projection, weeklySeries(projection, RECALIBRATION.minCheckins - 1, 5), START);
    const offer = recalibrationOffer(series);
    assert.equal(offer.offer, false, 'ofreció con menos del mínimo de check-ins');
});

test('A · persistencia: 3 consecutivos fuera y del MISMO lado disparan la oferta', () => {
    const projection = canonical();
    const series = evaluateSeries(projection, weeklySeries(projection, 3, 1.4), START);
    const offer = recalibrationOffer(series);
    assert.equal(offer.offer, true);
    assert.equal(offer.reason, 'persistence');
    assert.equal(offer.side, 'above');
});

test('el ruido alternante NO dispara la oferta: es lo que separa deriva de azar', () => {
    const projection = canonical();
    const series = evaluateSeries(projection, weeklySeries(projection, 6, 1.4, { alternate: true }), START);
    const offer = recalibrationOffer(series);
    assert.equal(offer.offer, false, 'el ruido alternante disparó la recalibración');
});

test('dos fuera de banda seguidos de uno dentro NO disparan nada', () => {
    const projection = canonical();
    const items = [
        checkin(7, projection.daily[7].weightKg + toleranceAt(projection, 7) * 1.5),
        checkin(14, projection.daily[14].weightKg + toleranceAt(projection, 14) * 1.5),
        checkin(21, projection.daily[21].weightKg)
    ];
    const offer = recalibrationOffer(evaluateSeries(projection, items, START));
    assert.equal(offer.offer, false);
});

test('B · magnitud: 2 consecutivos a más del doble de tolerancia bastan', () => {
    const projection = canonical();
    const series = evaluateSeries(projection, weeklySeries(projection, 3, 2.5), START);
    const offer = recalibrationOffer(series);
    assert.equal(offer.offer, true);
    assert.equal(offer.reason, 'magnitude');
});

test('la magnitud también exige el mismo lado', () => {
    const projection = canonical();
    const items = [
        checkin(7, projection.daily[7].weightKg + toleranceAt(projection, 7) * 3),
        checkin(14, projection.daily[14].weightKg - toleranceAt(projection, 14) * 3),
        checkin(21, projection.daily[21].weightKg + toleranceAt(projection, 21) * 3)
    ];
    const offer = recalibrationOffer(evaluateSeries(projection, items, START));
    assert.equal(offer.offer, false, 'lados opuestos dispararon la oferta por magnitud');
});

test('tras rechazar, NO se vuelve a ofrecer hasta que haya datos nuevos', () => {
    const projection = canonical();
    const series = evaluateSeries(projection, weeklySeries(projection, 3, 1.4), START);
    const first = recalibrationOffer(series);
    assert.equal(first.offer, true);

    // el usuario dice que no: se guarda el id del último check-in evaluado
    const declinedAt = series[series.length - 1].checkinId;
    assert.equal(recalibrationOffer(series, { declinedAtCheckinId: declinedAt }).offer, false);

    // llega un check-in NUEVO que sigue fuera: vuelve a ofrecerse
    const extended = evaluateSeries(projection, weeklySeries(projection, 4, 1.4), START);
    assert.equal(recalibrationOffer(extended, { declinedAtCheckinId: declinedAt }).offer, true);
});

test('la adherencia baja se señala como contexto, sin bloquear la oferta', () => {
    const projection = canonical();
    const low = weeklySeries(projection, 3, 1.4, { extra: { subjective: { adherence: 3 } } });
    const offer = recalibrationOffer(evaluateSeries(projection, low, START));
    assert.equal(offer.offer, true, 'la adherencia baja no debe bloquear la oferta');
    assert.equal(offer.lowAdherence, true);

    const high = weeklySeries(projection, 3, 1.4, { extra: { subjective: { adherence: 9 } } });
    assert.equal(recalibrationOffer(evaluateSeries(projection, high, START)).lowAdherence, false);
});

test('recalibrationOffer degrada con entradas vacías o basura, sin lanzar', () => {
    for (const input of [[], null, undefined, 'x', 42, [{}, null]]) {
        const offer = recalibrationOffer(/** @type {*} */ (input));
        assert.equal(offer.offer, false, `${String(input)} disparó la oferta`);
    }
});

// ============================================================
// Calibración: el sistema debe distinguir deriva de ruido
// ============================================================

/**
 * Simula un usuario semana a semana y devuelve cuándo se ofrece recalibrar.
 * @param {import('../src/core/generator.js').Projection} projection
 * @param {(week: number, expectedKg: number) => number} weightFor
 */
function simulate(projection, weightFor, weeks = 14) {
    const items = [];
    for (let w = 1; w <= weeks; w++) {
        const day = w * 7;
        if (!projection.daily[day]) break;
        items.push(checkin(day, weightFor(w, projection.daily[day].weightKg), { subjective: { adherence: 8 } }));
        const offer = recalibrationOffer(evaluateSeries(projection, items, START));
        if (offer.offer) return { firedAtWeek: w, ...offer };
    }
    return { firedAtWeek: null, offer: false, side: null, reason: null };
}

test('calibración: un usuario que sigue el plan NUNCA recibe la oferta, ni con ruido de báscula', () => {
    const projection = canonical();
    // exactamente en el plan
    assert.equal(simulate(projection, (_w, expected) => expected).firedAtWeek, null);
    // con ±0,7 kg de agua y glucógeno, que es variación normal
    const noisy = simulate(projection, (w, expected) => expected + ((w % 3) - 1) * 0.7);
    assert.equal(noisy.firedAtWeek, null, 'el ruido de báscula disparó una recalibración');
});

test('calibración: un usuario estancado SÍ recibe la oferta, y en pocas semanas', () => {
    const projection = canonical();
    const stalled = simulate(projection, () => 75);
    assert.ok(stalled.firedAtWeek !== null, 'un usuario estancado nunca recibió la oferta');
    assert.ok(stalled.firedAtWeek <= 10, `tardó ${stalled.firedAtWeek} semanas en detectarlo`);
    assert.equal(stalled.side, 'above');
});

test('calibración: perder demasiado rápido también dispara, y por el lado correcto', () => {
    const projection = canonical();
    const tooFast = simulate(projection, (_w, expected) => 75 - (75 - expected) * 2);
    assert.ok(tooFast.firedAtWeek !== null);
    assert.equal(tooFast.side, 'below', 'perder de más debe señalarse por debajo');
});

test('calibración: avanzar a la mitad del ritmo acaba detectándose', () => {
    const projection = canonical();
    const halfRate = simulate(projection, (_w, expected) => 75 - (75 - expected) * 0.5);
    assert.ok(halfRate.firedAtWeek !== null, 'medio ritmo sostenido nunca se detectó');
    assert.equal(halfRate.side, 'above');
});

// ============================================================
// Constancia (E9 a-b)
// ============================================================

test('racha: semanas consecutivas con check-in', () => {
    const items = [checkin(7, 74), checkin(14, 73.5), checkin(21, 73)];
    const streak = streakOf(items, dayDate(21), START);
    assert.equal(streak.current, 3);
    assert.equal(streak.longest, 3);
});

test('racha: un hueco la rompe pero conserva el récord', () => {
    const items = [checkin(7, 74), checkin(14, 73.5), checkin(35, 72), checkin(42, 71.5)];
    const streak = streakOf(items, dayDate(42), START);
    assert.equal(streak.current, 2);
    assert.equal(streak.longest, 2);
});

test('racha: dos check-ins en la misma semana cuentan como una', () => {
    const items = [checkin(7, 74), checkin(9, 73.9), checkin(14, 73.5)];
    const streak = streakOf(items, dayDate(14), START);
    assert.equal(streak.current, 2);
});

test('racha: sin check-ins es cero, no NaN', () => {
    const streak = streakOf([], dayDate(30), START);
    assert.deepEqual(streak, { current: 0, longest: 0, weeks: [] });
});

test('racha: degrada con entradas basura sin lanzar', () => {
    for (const input of [null, undefined, 'x', [null], [{}]]) {
        const streak = streakOf(/** @type {*} */ (input), dayDate(10), START);
        assert.ok(Number.isFinite(streak.current) && Number.isFinite(streak.longest));
    }
});

test('calendario de adherencia: una entrada por check-in con su nivel', () => {
    const items = [
        checkin(7, 74, { subjective: { adherence: 9 } }),
        checkin(14, 73.5, { subjective: { adherence: 4 } }),
        checkin(21, 73)
    ];
    const calendar = adherenceCalendar(items);
    assert.equal(calendar.length, 3);
    assert.deepEqual(calendar.map((c) => c.adherence), [9, 4, null]);
    assert.deepEqual(calendar.map((c) => c.dateISO), [dayDate(7), dayDate(14), dayDate(21)]);
});

// ============================================================
// Inferencia de composición al recalibrar
// ============================================================

test('si el usuario midió su %grasa, esa medición manda sobre cualquier inferencia', () => {
    const point = { muscleKg: 29.9, otherLeanKg: 30.6, fatPct: 16.5 };
    assert.equal(inferFatPct(point, 75, 18.2), 18.2);
});

test('sin medición, la desviación del peso se atribuye a la GRASA, no al músculo', () => {
    // Usuario estancado: pesa lo mismo que al empezar (75 kg) aunque el plan
    // preveía 73. Suponer el %grasa proyectado diría que perdió grasa que no
    // ha perdido — y desplazaría su peso objetivo sin que él cambiara la meta.
    const point = { muscleKg: 29.9, otherLeanKg: 30.6, fatPct: 16.5 };
    const inferred = inferFatPct(point, 75, null);
    // magra prevista 60,5 → grasa = 75 − 60,5 = 14,5 → 19,3 %
    assert.ok(Math.abs(inferred - 19.33) < 0.1, `inferido ${inferred}, esperaba ~19,3 %`);
    assert.ok(inferred > point.fatPct, 'quien no pierde peso no puede haber perdido esa grasa');
});

test('quien va POR DEBAJO del plan recibe un %grasa inferido menor', () => {
    const point = { muscleKg: 29.9, otherLeanKg: 30.6, fatPct: 16.5 };
    const ahead = inferFatPct(point, 71, null);
    assert.ok(ahead < point.fatPct, `${ahead} debería ser menor que ${point.fatPct}`);
    assert.ok(ahead > 0);
});

test('la inferencia nunca devuelve grasa negativa: cae al proyectado', () => {
    const point = { muscleKg: 29.9, otherLeanKg: 30.6, fatPct: 16.5 };
    // peso real por debajo de la propia masa magra prevista: imposible
    assert.equal(inferFatPct(point, 55, null), 16.5);
});

test('inferFatPct degrada con entradas basura sin lanzar', () => {
    for (const [p, w] of /** @type {Array<[any, any]>} */ ([
        [null, 75], [undefined, 75], [{ muscleKg: 1, otherLeanKg: 1, fatPct: 10 }, 0],
        [{ muscleKg: 1, otherLeanKg: 1, fatPct: 10 }, NaN], [{}, 75]
    ])) {
        const value = inferFatPct(p, w, null);
        assert.ok(Number.isNaN(value) || Number.isFinite(value), `${JSON.stringify([p, w])} → ${value}`);
    }
});

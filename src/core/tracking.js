// @ts-check

/**
 * Seguimiento: desviación de la realidad frente al plan, umbrales de
 * recalibración y constancia (decisiones A1b, E1a, E9 a-b).
 *
 * Puro y sin DOM, como el resto de `src/core/`: aquí se decide cuándo la
 * aplicación le dice al usuario que su plan ya no le sirve, así que tiene que
 * ser comprobable desde Node.
 *
 * ---
 * Por qué la tolerancia NO es la banda de escenarios, sin más.
 *
 * La banda es el corredor plausible de la proyección y sirve para dibujarla,
 * pero medida sobre un plan real resulta inservible como criterio de
 * desviación por los dos extremos:
 *
 *  - Al principio es más estrecha que la báscula: ±0,17 kg en la semana 1 del
 *    perfil canónico, cuando la variación real de agua y glucógeno en 24 h es
 *    de ±0,5–1,5 kg. Todo check-in honesto caería fuera.
 *  - Al final vale exactamente cero, porque el invariante `escenarios` de M1
 *    exige que los tres cierren en el objetivo. Cualquier desviación distinta
 *    de cero quedaría fuera, siempre.
 *
 * Por eso la tolerancia es la banda ENSANCHADA con un suelo de ruido de
 * medición. La banda sigue siendo lo que se pinta; esto es lo que se juzga.
 */

import { toleranceFloorPct } from './constants.js';

/**
 * @typedef {import('./generator.js').Projection} Projection
 * @typedef {'within' | 'above' | 'below'} DeviationSignal
 *
 * @typedef {Object} CheckinRecord
 * @property {string} id
 * @property {string} dateISO
 * @property {number} weightKg
 * @property {{ adherence?: number }} [subjective]
 *
 * @typedef {Object} Evaluation
 * @property {string} checkinId
 * @property {string} dateISO
 * @property {number} dayIndex
 * @property {number} expectedKg peso proyectado ese día
 * @property {number} actualKg peso registrado por el usuario
 * @property {number} deltaKg actual − esperado (positivo = por encima)
 * @property {number} toleranceKg corredor aceptado ese día
 * @property {DeviationSignal} signal
 * @property {number | null} adherence 1–10, si el usuario la registró
 */

/**
 * Suelo de ruido de la medición, como fracción del peso corporal.
 *
 * Fuente: la variabilidad intrasemanal del peso corporal ronda el 1 % por
 * agua, glucógeno y contenido intestinal (p. ej. Bhutani et al. 2017). Se
 * toma 1,3 % para dejar margen a la precisión de la báscula y a la hora del
 * pesaje. A 75 kg son ~1,0 kg.
 * @type {number}
 */
export const CHECKIN_NOISE_FLOOR_PCT_BW = toleranceFloorPct;

/**
 * Umbrales de la oferta de recalibración (decisión E1a: se ofrece, nunca se
 * impone). Decisión de producto, justificada en la bitácora de M4.
 * @type {Readonly<{minCheckins: number, persistenceCount: number, magnitudeCount: number, magnitudeFactor: number, lowAdherenceMax: number}>}
 */
export const RECALIBRATION = Object.freeze({
    /** Sin un mínimo de historial no hay tendencia que juzgar. */
    minCheckins: 3,
    /** Uno es ruido, dos es casualidad, tres es tendencia. */
    persistenceCount: 3,
    /** Una desviación grande no debe esperar tres semanas a reconocerse. */
    magnitudeCount: 2,
    magnitudeFactor: 2,
    /** Adherencia ≤ 4/10 se señala como contexto; nunca bloquea. */
    lowAdherenceMax: 4
});

const MS_PER_DAY = 86400000;

/** @param {unknown} v @returns {v is number} */
function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Días transcurridos entre dos fechas civiles, en UTC puro.
 * @param {string} fromISO
 * @param {string} toISO
 * @returns {number | null}
 */
function dayDiff(fromISO, toISO) {
    if (typeof fromISO !== 'string' || typeof toISO !== 'string') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromISO) || !/^\d{4}-\d{2}-\d{2}$/.test(toISO)) return null;
    const from = Date.parse(`${fromISO}T00:00:00Z`);
    const to = Date.parse(`${toISO}T00:00:00Z`);
    if (Number.isNaN(from) || Number.isNaN(to)) return null;
    return Math.round((to - from) / MS_PER_DAY);
}

/**
 * Corredor aceptado un día dado: la semianchura de la banda de escenarios o
 * el suelo de ruido de medición, lo que sea mayor.
 * @param {Projection} projection
 * @param {number} dayIndex
 * @returns {number} kg (siempre > 0)
 */
export function toleranceAt(projection, dayIndex) {
    const daily = projection?.daily;
    if (!Array.isArray(daily) || daily.length === 0) return 1;

    const index = isFiniteNumber(dayIndex)
        ? Math.min(daily.length - 1, Math.max(0, Math.round(dayIndex)))
        : 0;
    const point = daily[index];
    if (!point) return 1;

    const halfBand = Math.abs(point.band.optimistKg - point.band.pessimistKg) / 2;
    const floor = point.weightKg * CHECKIN_NOISE_FLOOR_PCT_BW;
    return Math.max(halfBand, floor);
}

/**
 * Evalúa un check-in contra la proyección.
 * @param {Projection} projection
 * @param {CheckinRecord} checkin
 * @param {string} startDateISO
 * @returns {{ ok: true, value: Evaluation } | { ok: false, error: string }}
 */
export function evaluateCheckin(projection, checkin, startDateISO) {
    if (!checkin || typeof checkin !== 'object') return { ok: false, error: 'tracking.checkinInvalid' };
    if (!isFiniteNumber(checkin.weightKg) || checkin.weightKg <= 0) {
        return { ok: false, error: 'tracking.weightInvalid' };
    }
    const daily = projection?.daily;
    if (!Array.isArray(daily) || daily.length === 0) return { ok: false, error: 'tracking.projectionInvalid' };

    const dayIndex = dayDiff(startDateISO, checkin.dateISO);
    if (dayIndex === null) return { ok: false, error: 'tracking.dateInvalid' };
    // fuera del plan no hay nada contra lo que comparar: se rechaza en vez de
    // acercarlo al extremo más próximo y fingir que encaja
    if (dayIndex < 0 || dayIndex >= daily.length) return { ok: false, error: 'tracking.outOfPlan' };

    const expectedKg = daily[dayIndex].weightKg;
    const deltaKg = checkin.weightKg - expectedKg;
    const toleranceKg = toleranceAt(projection, dayIndex);

    /** @type {DeviationSignal} */
    let signal = 'within';
    if (deltaKg > toleranceKg) signal = 'above';
    else if (deltaKg < -toleranceKg) signal = 'below';

    const adherence = checkin.subjective && isFiniteNumber(checkin.subjective.adherence)
        ? checkin.subjective.adherence
        : null;

    return {
        ok: true,
        value: {
            checkinId: String(checkin.id ?? ''),
            dateISO: checkin.dateISO,
            dayIndex,
            expectedKg,
            actualKg: checkin.weightKg,
            deltaKg,
            toleranceKg,
            signal,
            adherence
        }
    };
}

/**
 * Evalúa una colección de check-ins, ordenada por día. Lo inevaluable se
 * descarta en silencio aquí (la UI ya lo validó al guardarlo).
 * @param {Projection} projection
 * @param {CheckinRecord[]} checkins
 * @param {string} startDateISO
 * @returns {Evaluation[]}
 */
export function evaluateSeries(projection, checkins, startDateISO) {
    if (!Array.isArray(checkins)) return [];
    /** @type {Evaluation[]} */ const out = [];
    for (const item of checkins) {
        const result = evaluateCheckin(projection, item, startDateISO);
        if (result.ok) out.push(result.value);
    }
    return out.sort((a, b) => a.dayIndex - b.dayIndex);
}

/**
 * @typedef {Object} RecalibrationVerdict
 * @property {boolean} offer
 * @property {'persistence' | 'magnitude' | null} reason
 * @property {DeviationSignal | null} side lado del que se está desviando
 * @property {boolean} lowAdherence contexto, nunca bloqueo
 * @property {number} streakOutside cuántos consecutivos llevan fuera
 */

/**
 * ¿Procede OFRECER una recalibración? (decisión E1a: ofrecer, nunca imponer.)
 *
 * Dos disparadores, ambos exigiendo el MISMO lado — que es lo que separa una
 * deriva real del ruido alternante:
 *   A · persistencia: `persistenceCount` consecutivos fuera de tolerancia.
 *   B · magnitud: `magnitudeCount` consecutivos a más de `magnitudeFactor`
 *       veces la tolerancia.
 *
 * @param {Evaluation[]} series salida de `evaluateSeries`
 * @param {{ declinedAtCheckinId?: string }} [options] si el usuario ya dijo
 *   que no, no se le vuelve a preguntar hasta que haya datos NUEVOS
 * @returns {RecalibrationVerdict}
 */
export function recalibrationOffer(series, options = {}) {
    /** @type {RecalibrationVerdict} */
    const none = { offer: false, reason: null, side: null, lowAdherence: false, streakOutside: 0 };
    if (!Array.isArray(series)) return none;

    const clean = series.filter((e) => e && typeof e === 'object' && typeof e.signal === 'string');
    if (clean.length < RECALIBRATION.minCheckins) return none;

    // Racha final fuera de banda, toda del mismo lado
    /** @type {Evaluation[]} */ const tail = [];
    for (let i = clean.length - 1; i >= 0; i--) {
        const item = clean[i];
        if (item.signal === 'within') break;
        if (tail.length > 0 && item.signal !== tail[0].signal) break;
        tail.unshift(item);
    }
    if (tail.length === 0) return none;

    const side = tail[0].signal;
    const bigTail = tail.filter((e) => Math.abs(e.deltaKg) >= e.toleranceKg * RECALIBRATION.magnitudeFactor);

    /** @type {'persistence' | 'magnitude' | null} */ let reason = null;
    if (tail.length >= RECALIBRATION.persistenceCount) reason = 'persistence';
    // la magnitud exige que los grandes sean los ÚLTIMOS, no cualesquiera
    if (bigTail.length >= RECALIBRATION.magnitudeCount
        && bigTail[bigTail.length - 1] === tail[tail.length - 1]) {
        reason = 'magnitude';
    }
    if (reason === null) return { ...none, side, streakOutside: tail.length };

    // Ya se preguntó por este mismo último check-in: no se insiste.
    const lastId = clean[clean.length - 1].checkinId;
    if (options.declinedAtCheckinId && options.declinedAtCheckinId === lastId) {
        return { ...none, side, streakOutside: tail.length };
    }

    // La adherencia baja es CONTEXTO: un plan no está mal por no haberse
    // ejecutado. Se informa, no se bloquea ni se sermonea.
    const withAdherence = tail.filter((e) => e.adherence !== null);
    const lowAdherence = withAdherence.length > 0
        && withAdherence.every((e) => /** @type {number} */ (e.adherence) <= RECALIBRATION.lowAdherenceMax);

    return { offer: true, reason, side, lowAdherence, streakOutside: tail.length };
}

/**
 * Racha de semanas consecutivas con al menos un check-in (E9a).
 * La semana se cuenta desde la fecha de inicio del plan, no desde el lunes:
 * lo que importa es la constancia del usuario, no el calendario.
 * @param {CheckinRecord[]} checkins
 * @param {string} todayISO
 * @param {string} startDateISO
 * @returns {{ current: number, longest: number, weeks: number[] }}
 */
export function streakOf(checkins, todayISO, startDateISO) {
    if (!Array.isArray(checkins)) return { current: 0, longest: 0, weeks: [] };

    /** @type {Set<number>} */ const weeks = new Set();
    for (const item of checkins) {
        if (!item || typeof item !== 'object') continue;
        const day = dayDiff(startDateISO, item.dateISO);
        if (day === null || day < 0) continue;
        weeks.add(Math.floor(day / 7));
    }
    const sorted = [...weeks].sort((a, b) => a - b);
    if (sorted.length === 0) return { current: 0, longest: 0, weeks: [] };

    let longest = 1;
    let run = 1;
    for (let i = 1; i < sorted.length; i++) {
        run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
        if (run > longest) longest = run;
    }

    // La racha vigente solo cuenta si llega hasta la semana actual o la
    // anterior: con dos semanas sin registrar, la racha está rota.
    const todayDay = dayDiff(startDateISO, todayISO);
    const todayWeek = todayDay === null ? sorted[sorted.length - 1] : Math.floor(Math.max(0, todayDay) / 7);
    let current = 0;
    if (sorted[sorted.length - 1] >= todayWeek - 1) {
        current = 1;
        for (let i = sorted.length - 1; i > 0; i--) {
            if (sorted[i] === sorted[i - 1] + 1) current++;
            else break;
        }
    }
    return { current, longest, weeks: sorted };
}

/**
 * Serie para el calendario de adherencia (E9b): una entrada por check-in.
 * @param {CheckinRecord[]} checkins
 * @returns {Array<{ dateISO: string, adherence: number | null }>}
 */
export function adherenceCalendar(checkins) {
    if (!Array.isArray(checkins)) return [];
    return checkins
        .filter((c) => c && typeof c === 'object' && typeof c.dateISO === 'string')
        .map((c) => ({
            dateISO: c.dateISO,
            adherence: c.subjective && isFiniteNumber(c.subjective.adherence) ? c.subjective.adherence : null
        }))
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

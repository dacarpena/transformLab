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
    lowAdherenceMax: 4,
    /**
     * Días REALES que debe abarcar la racha. Contar check-ins y no tiempo
     * permitía que tres pesajes en tres días consecutivos —que son la MISMA
     * retención de agua contada tres veces, no tres pruebas independientes—
     * dispararan la oferta.
     */
    minSpanDays: 14,
    /**
     * Crecimiento mínimo del desvío a lo largo de la racha, como fracción de
     * la tolerancia, para aceptarla como deriva REAL.
     *
     * Es el discriminador central. La retención de agua desplaza el peso un
     * escalón y ahí se queda: sus residuos son planos (+1,0, +1,0, +1,0) y
     * acaban revirtiendo. Un estancamiento real ENSANCHA la brecha cada
     * semana, porque el plan sigue esperando progreso (+0,6, +1,2, +1,8).
     * Mirar solo el nivel confunde ambos; mirar la PENDIENTE los separa.
     */
    minGrowthFactor: 0.4
});

/**
 * Techo de la tolerancia, como múltiplo del cambio semanal que el plan
 * espera. Sin techo, la semianchura de la banda crece con la duración del
 * plan y llegaba a 18 kg en planes largos, volviendo invisible medio año de
 * deriva real justo a los usuarios con más peso que perder.
 */
const TOLERANCE_CEILING_WEEKS = 4;

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
    const from = parseCivilDate(fromISO);
    const to = parseCivilDate(toISO);
    if (from === null || to === null) return null;
    return Math.round((to - from) / MS_PER_DAY);
}

/**
 * Fecha civil a instante UTC, rechazando días que NO existen en el calendario.
 * `Date.parse` acepta '2026-02-30' y lo desplaza al 2 de marzo, lo que
 * atribuía el check-in a otro día del plan —otro peso esperado, otra fase—
 * en silencio. `schema.js` ya validaba así; el core no.
 * @param {unknown} iso
 * @returns {number | null}
 */
function parseCivilDate(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const [y, m, d] = iso.split('-').map(Number);
    const stamp = Date.UTC(y, m - 1, d);
    const date = new Date(stamp);
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return stamp;
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
    if (!Array.isArray(daily) || daily.length === 0) return DEFAULT_TOLERANCE_KG;

    const index = isFiniteNumber(dayIndex)
        ? Math.min(daily.length - 1, Math.max(0, Math.round(dayIndex)))
        : 0;
    const point = daily[index];
    if (!point || typeof point !== 'object') return DEFAULT_TOLERANCE_KG;
    if (!isFiniteNumber(point.weightKg) || point.weightKg <= 0) return DEFAULT_TOLERANCE_KG;

    const floor = point.weightKg * CHECKIN_NOISE_FLOOR_PCT_BW;

    // La banda puede faltar o venir corrupta en datos rehidratados: entonces
    // manda el suelo de ruido, no una excepción.
    const band = point.band;
    const halfBand = band && isFiniteNumber(band.optimistKg) && isFiniteNumber(band.pessimistKg)
        ? Math.abs(band.optimistKg - band.pessimistKg) / 2
        : 0;

    // Techo: la tolerancia no puede superar lo que el plan espera cambiar en
    // unas pocas semanas, o una deriva real quedaría dentro del margen.
    const weeklyRate = expectedWeeklyChangeKg(daily, index);
    const ceiling = Math.max(floor * 2, weeklyRate * TOLERANCE_CEILING_WEEKS);

    const tolerance = Math.min(Math.max(halfBand, floor), Math.max(ceiling, floor));
    return isFiniteNumber(tolerance) && tolerance > 0 ? tolerance : DEFAULT_TOLERANCE_KG;
}

/** Tolerancia de reserva cuando la proyección no permite calcular nada. */
const DEFAULT_TOLERANCE_KG = 1;

/**
 * Cambio de peso que el plan espera en la semana alrededor de `index`.
 * @param {Array<*>} daily
 * @param {number} index
 * @returns {number} kg/semana (≥ 0)
 */
function expectedWeeklyChangeKg(daily, index) {
    const from = Math.max(0, index - 7);
    const to = Math.min(daily.length - 1, index + 7);
    const a = daily[from]?.weightKg;
    const b = daily[to]?.weightKg;
    if (!isFiniteNumber(a) || !isFiniteNumber(b) || to === from) return 0;
    return (Math.abs(b - a) / (to - from)) * 7;
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

    // el punto extraído también se valida: sin esto, una proyección con un
    // punto corrupto devolvía {ok:true} con NaN y señal 'within' — la app
    // afirmaría «vas según el plan» sin haber podido compararlo con nada
    const point = daily[dayIndex];
    if (!point || typeof point !== 'object' || !isFiniteNumber(point.weightKg)) {
        return { ok: false, error: 'tracking.projectionInvalid' };
    }
    const expectedKg = point.weightKg;
    const deltaKg = checkin.weightKg - expectedKg;
    const toleranceKg = toleranceAt(projection, dayIndex);
    if (!isFiniteNumber(toleranceKg) || toleranceKg <= 0) {
        return { ok: false, error: 'tracking.projectionInvalid' };
    }

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
 * @property {string} fingerprint huella de los datos evaluados, para recordar
 *   un rechazo sin confundir «datos nuevos» con «los mismos datos otra vez»
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
 * @param {{ declinedFingerprint?: string } | null} [options] si el usuario ya
 *   dijo que no, no se le vuelve a preguntar con los MISMOS datos
 * @returns {RecalibrationVerdict}
 */
export function recalibrationOffer(series, options) {
    /** @type {RecalibrationVerdict} */
    const none = { offer: false, reason: null, side: null, lowAdherence: false, streakOutside: 0, fingerprint: '' };
    const opts = options && typeof options === 'object' ? options : {};
    if (!Array.isArray(series)) return none;

    const clean = series.filter((e) => e && typeof e === 'object' && typeof e.signal === 'string'
        && isFiniteNumber(e.deltaKg) && isFiniteNumber(e.toleranceKg));
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
    const partial = { ...none, side, streakOutside: tail.length, fingerprint: fingerprintOf(clean) };

    // La racha debe abarcar tiempo REAL. Tres pesajes en tres días son la
    // misma retención de agua contada tres veces, no tres pruebas.
    const spanDays = tail[tail.length - 1].dayIndex - tail[0].dayIndex;
    if (spanDays < RECALIBRATION.minSpanDays) return partial;

    // ¿La brecha CRECE? El agua desplaza el peso un escalón y ahí se queda
    // (residuos planos); un estancamiento real ensancha la brecha cada semana
    // porque el plan sigue esperando progreso. La pendiente los separa.
    const firstGap = Math.abs(tail[0].deltaKg);
    const lastGap = Math.abs(tail[tail.length - 1].deltaKg);
    const growth = lastGap - firstGap;
    const growing = growth >= tail[tail.length - 1].toleranceKg * RECALIBRATION.minGrowthFactor;

    const bigTail = tail.filter((e) => Math.abs(e.deltaKg) >= e.toleranceKg * RECALIBRATION.magnitudeFactor);

    /** @type {'persistence' | 'magnitude' | null} */ let reason = null;
    if (tail.length >= RECALIBRATION.persistenceCount && growing) reason = 'persistence';
    // la magnitud exige que los grandes sean los ÚLTIMOS, no cualesquiera
    if (bigTail.length >= RECALIBRATION.magnitudeCount
        && bigTail[bigTail.length - 1] === tail[tail.length - 1]) {
        reason = 'magnitude';
    }
    if (reason === null) return partial;

    // Ya se preguntó por ESTOS datos: no se insiste. La memoria es una huella
    // del CONTENIDO, no el id del último check-in. Con el id bastaba con
    // editar el check-in de hoy —que conserva su id, derivado de la fecha—
    // para heredar el silencio con datos completamente nuevos; y bastaba con
    // borrarlo para que la oferta reapareciera con MENOS información.
    if (opts.declinedFingerprint && opts.declinedFingerprint === partial.fingerprint) {
        return partial;
    }

    // La adherencia baja es CONTEXTO: un plan no está mal por no haberse
    // ejecutado. Se informa, no se bloquea ni se sermonea.
    const withAdherence = tail.filter((e) => e.adherence !== null);
    const lowAdherence = withAdherence.length > 0
        && withAdherence.every((e) => /** @type {number} */ (e.adherence) <= RECALIBRATION.lowAdherenceMax);

    return { offer: true, reason, side, lowAdherence, streakOutside: tail.length, fingerprint: partial.fingerprint };
}

/**
 * Huella del contenido evaluado: identifica los DATOS, no el último id.
 * Editar, borrar o añadir un check-in la cambia; volver a abrir la app con
 * exactamente los mismos datos, no.
 * @param {Evaluation[]} series
 * @returns {string}
 */
function fingerprintOf(series) {
    return series
        .map((e) => `${e.dateISO}:${e.actualKg.toFixed(2)}`)
        .join('|');
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

    // Las semanas se acotan al presente: una fecha futura mal tecleada no
    // puede romper la racha vigente (quedaba como semana aislada por delante)
    // ni inflarla rellenando el calendario hacia adelante.
    const todayDayRaw = dayDiff(startDateISO, todayISO);
    const maxWeek = todayDayRaw === null ? Infinity : Math.floor(Math.max(0, todayDayRaw) / 7);

    /** @type {Set<number>} */ const weeks = new Set();
    for (const item of checkins) {
        if (!item || typeof item !== 'object') continue;
        const day = dayDiff(startDateISO, item.dateISO);
        if (day === null || day < 0) continue;
        const week = Math.floor(day / 7);
        if (week > maxWeek) continue;
        weeks.add(week);
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
    const todayWeek = maxWeek === Infinity ? sorted[sorted.length - 1] : maxWeek;
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
 * Infiere la composición real de la que parte un plan recalibrado, cuando el
 * usuario solo se ha pesado (el caso normal: casi nadie mide su %grasa).
 *
 * El músculo cambia despacio y lo dirige el entrenamiento, así que se conserva
 * el proyectado; **la desviación del peso se atribuye a la GRASA**, que es lo
 * que varía con el balance energético.
 *
 * La alternativa ingenua —tomar el %grasa proyectado— supone que el usuario
 * perdió la grasa prevista pese a no haber movido la báscula, y además
 * desplaza el peso objetivo sin que él haya cambiado su meta.
 *
 * @param {{ muscleKg: number, otherLeanKg: number, fatPct: number }} projectedPoint
 * @param {number} actualWeightKg
 * @param {number | null} [measuredFatPct] si el usuario SÍ lo midió, manda
 * @returns {number} %grasa de partida para el plan nuevo
 */
export function inferFatPct(projectedPoint, actualWeightKg, measuredFatPct = null) {
    // una medición del usuario manda, pero acotada al rango físico: el 0 es
    // legítimo (el esquema lo admite) y no debe confundirse con «sin dato»
    if (isFiniteNumber(measuredFatPct) && measuredFatPct >= 0) {
        return Math.min(100, measuredFatPct);
    }
    if (!projectedPoint || typeof projectedPoint !== 'object') return NaN;
    if (!isFiniteNumber(actualWeightKg) || actualWeightKg <= 0) return NaN;
    if (!isFiniteNumber(projectedPoint.muscleKg) || !isFiniteNumber(projectedPoint.otherLeanKg)) return NaN;

    const projectedLeanKg = projectedPoint.muscleKg + projectedPoint.otherLeanKg;
    const inferredFatKg = actualWeightKg - projectedLeanKg;
    // si el peso real ya está por debajo de la magra prevista, la inferencia
    // no tiene sentido físico: se cae al proyectado en vez de dar algo negativo
    if (inferredFatKg <= 0) {
        return isFiniteNumber(projectedPoint.fatPct) ? projectedPoint.fatPct : NaN;
    }
    return (inferredFatKg / actualWeightKg) * 100;
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

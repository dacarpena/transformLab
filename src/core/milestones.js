// @ts-check

/**
 * Hitos estéticos (M5-5): catálogo editorial indexado por umbral de
 * composición, cruzado con la serie REAL de la proyección.
 *
 * El catálogo se rescató del plan personal de la v4.0 (`legacy/…json`), que
 * era la instancia de un único usuario con fechas fijas y días absolutos.
 * Aquí se conserva solo lo aplicable a cualquiera —los 97 hitos que tenían
 * umbral de grasa o de músculo— y se descartaron los 5 que solo dependían del
 * día del plan de aquella persona: el motor ya genera hitos de fase y de
 * progreso desde el cruce real de la serie (GEN-03/04), así que esos no
 * aportaban nada y sí arrastraban una biografía ajena.
 *
 * Los defectos internos del `milestones.js` legacy (fichas HIT-*) no se
 * portan: aquí no hay totales hardcodeados, ni categorías divergentes entre
 * generador y render, ni estados que el CSS no contemple.
 */

import catalog from './data/aesthetic-catalog.json' with { type: 'json' };

/**
 * @typedef {Object} AestheticItem
 * @property {string} id
 * @property {string} category
 * @property {string | null} muscleGroup
 * @property {string} title
 * @property {string} description
 * @property {string} visibility 'sutil' | 'notable' | 'evidente'
 * @property {number | null} fatPctBelow
 * @property {number | null} muscleGainKgAbove
 *
 * @typedef {AestheticItem & { dayIndex: number, dateISO: string, reached: boolean }} AestheticMilestone
 */

/** Catálogo crudo, por si una vista quiere mostrarlo entero. */
export const AESTHETIC_CATALOG = /** @type {AestheticItem[]} */ (catalog.items);

/**
 * Niveles de visibilidad, declarados en UN solo sitio (cierra la familia HIT-*
 * del catálogo, donde generador y render usaban listas distintas). Son los que
 * trae el catálogo rescatado, verificados contra él por test.
 */
export const VISIBILITY_LEVELS = Object.freeze(['sutil', 'notable', 'muy_notable']);

/** @param {unknown} v @returns {v is number} */
function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Sitúa cada hito del catálogo en el día en que la serie cruza su umbral.
 *
 * Un hito con umbral de grasa se alcanza el primer día en que la proyección
 * baja de ese porcentaje; uno con umbral de músculo, el primer día en que la
 * ganancia acumulada lo supera. Si el plan nunca llega, el hito no aparece:
 * prometer algo que la proyección no alcanza sería mentir.
 *
 * @param {import('./generator.js').Projection} projection
 * @param {{ startMuscleKg: number }} baseline
 * @param {number} todayIndex para marcar cuáles ya se han alcanzado
 * @returns {AestheticMilestone[]} ordenados por día
 */
export function aestheticMilestonesFor(projection, baseline, todayIndex) {
    const daily = projection?.daily;
    if (!Array.isArray(daily) || daily.length === 0) return [];
    const startMuscle = isFiniteNumber(baseline?.startMuscleKg) ? baseline.startMuscleKg : null;

    /** @type {AestheticMilestone[]} */ const out = [];

    for (const item of AESTHETIC_CATALOG) {
        let dayIndex = -1;
        for (let i = 0; i < daily.length; i++) {
            const point = daily[i];
            if (!point || !isFiniteNumber(point.fatPct) || !isFiniteNumber(point.muscleKg)) continue;

            const fatOk = item.fatPctBelow === null || point.fatPct <= item.fatPctBelow;
            const muscleOk = item.muscleGainKgAbove === null || startMuscle === null
                || (point.muscleKg - startMuscle) >= item.muscleGainKgAbove;

            // ambos umbrales deben cumplirse a la vez: un hito que exige menos
            // grasa Y más músculo no se alcanza con solo una de las dos cosas
            if (fatOk && muscleOk) {
                dayIndex = i;
                break;
            }
        }
        if (dayIndex < 0) continue; // el plan no llega hasta ahí: no se promete

        out.push({
            ...item,
            dayIndex,
            dateISO: daily[dayIndex].dateISO,
            reached: isFiniteNumber(todayIndex) && dayIndex <= todayIndex
        });
    }
    return out.sort((a, b) => a.dayIndex - b.dayIndex);
}

/**
 * El siguiente hito por alcanzar, o null si ya están todos.
 * @param {AestheticMilestone[]} milestones
 * @returns {AestheticMilestone | null}
 */
export function nextAesthetic(milestones) {
    if (!Array.isArray(milestones)) return null;
    return milestones.find((m) => m && !m.reached) ?? null;
}

/**
 * Resumen por categoría, para la tabla de progreso.
 * @param {AestheticMilestone[]} milestones
 * @returns {Array<{ category: string, reached: number, total: number }>}
 */
export function byCategory(milestones) {
    if (!Array.isArray(milestones)) return [];
    /** @type {Map<string, {reached: number, total: number}>} */ const map = new Map();
    for (const m of milestones) {
        if (!m || typeof m.category !== 'string') continue;
        const entry = map.get(m.category) ?? { reached: 0, total: 0 };
        entry.total++;
        if (m.reached) entry.reached++;
        map.set(m.category, entry);
    }
    return [...map.entries()]
        .map(([category, v]) => ({ category, ...v }))
        .sort((a, b) => b.total - a.total);
}

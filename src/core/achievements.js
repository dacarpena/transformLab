// @ts-check

/**
 * Logros locales (decisión E9c): se derivan del estado real del usuario, no se
 * guardan como banderas sueltas que puedan mentir.
 *
 * Un logro solo se concede por algo que el usuario HIZO: registrar check-ins,
 * sostener una racha, batir un récord, alcanzar un hito de composición. Nada
 * se concede por abrir la aplicación.
 */

/**
 * @typedef {Object} Achievement
 * @property {string} id
 * @property {'consistency' | 'composition' | 'strength'} kind
 * @property {number} threshold
 * @property {boolean} unlocked
 * @property {number} progress 0–1
 */

/** Catálogo. Los umbrales son decisión de producto, no ciencia. */
export const ACHIEVEMENT_RULES = Object.freeze([
    { id: 'firstCheckin', kind: 'consistency', threshold: 1 },
    { id: 'checkins10', kind: 'consistency', threshold: 10 },
    { id: 'checkins25', kind: 'consistency', threshold: 25 },
    { id: 'streak4', kind: 'consistency', threshold: 4 },
    { id: 'streak12', kind: 'consistency', threshold: 12 },
    { id: 'aesthetic5', kind: 'composition', threshold: 5 },
    { id: 'aesthetic20', kind: 'composition', threshold: 20 },
    { id: 'firstPr', kind: 'strength', threshold: 1 },
    { id: 'pr10', kind: 'strength', threshold: 10 }
]);

/** @param {unknown} v @returns {number} */
function count(v) {
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * Evalúa el catálogo contra el estado real.
 * @param {{ checkins?: number, longestStreak?: number, aestheticReached?: number, personalRecords?: number }} stats
 * @returns {Achievement[]}
 */
export function evaluate(stats) {
    const safe = stats && typeof stats === 'object' ? stats : {};
    const values = {
        firstCheckin: count(safe.checkins),
        checkins10: count(safe.checkins),
        checkins25: count(safe.checkins),
        streak4: count(safe.longestStreak),
        streak12: count(safe.longestStreak),
        aesthetic5: count(safe.aestheticReached),
        aesthetic20: count(safe.aestheticReached),
        firstPr: count(safe.personalRecords),
        pr10: count(safe.personalRecords)
    };
    return ACHIEVEMENT_RULES.map((rule) => {
        const value = values[/** @type {keyof typeof values} */ (rule.id)] ?? 0;
        return {
            id: rule.id,
            kind: /** @type {*} */ (rule.kind),
            threshold: rule.threshold,
            unlocked: value >= rule.threshold,
            progress: Math.min(1, rule.threshold > 0 ? value / rule.threshold : 0)
        };
    });
}

/**
 * Datos de la tarjeta compartible (E9d).
 *
 * Por defecto **no incluye peso ni %grasa absolutos**: se comparte progreso
 * relativo, racha y fase. Los datos de salud son del usuario y compartirlos
 * tiene que ser una decisión explícita suya, no el valor por omisión.
 * @param {{ percentComplete: number, phaseKey: string, streakWeeks: number, achievementsUnlocked: number, weightKg?: number, fatPct?: number }} input
 * @param {{ includeAbsolutes?: boolean }} [options]
 * @returns {{ percentComplete: number, phaseKey: string, streakWeeks: number, achievementsUnlocked: number, weightKg: number | null, fatPct: number | null }}
 */
export function shareCard(input, options = {}) {
    const safe = input && typeof input === 'object' ? input : /** @type {*} */ ({});
    const includeAbsolutes = options?.includeAbsolutes === true;
    return {
        percentComplete: Math.min(100, Math.max(0, count(safe.percentComplete))),
        phaseKey: typeof safe.phaseKey === 'string' ? safe.phaseKey : 'maintenance',
        streakWeeks: count(safe.streakWeeks),
        achievementsUnlocked: count(safe.achievementsUnlocked),
        weightKg: includeAbsolutes && typeof safe.weightKg === 'number' ? safe.weightKg : null,
        fatPct: includeAbsolutes && typeof safe.fatPct === 'number' ? safe.fatPct : null
    };
}

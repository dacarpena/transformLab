// @ts-check

/**
 * Pasos y NEAT (V2-M7). Módulo PURO.
 *
 * LA TRAMPA DE ESTE MÓDULO ES ARITMÉTICA Y SE LLAMA DOBLE CONTEO. El
 * multiplicador de actividad que el usuario eligió en el onboarding —sedentario,
 * ligero, moderado…— YA INCLUYE su actividad diaria, andar incluido. Sumar
 * encima las kilocalorías de los pasos cuenta lo mismo dos veces, infla el gasto
 * y rompe el balance energético del que cuelga todo el plan.
 *
 * La forma correcta es tratarlos como COVARIABLE, no como sumando: cada nivel de
 * actividad lleva asociado un número de pasos de referencia, y lo que aporta el
 * podómetro es la DIFERENCIA respecto a ese número. Andar los pasos que tu nivel
 * ya suponía aporta exactamente cero, y esa es la comprobación que hace el
 * invariante `sin_doble_conteo`.
 *
 * ENTRADA MANUAL, y a propósito. Apple Health y Google Fit no son accesibles
 * desde una aplicación web, y cualquier integración por nube exigiría cuenta y
 * llamadas de red con datos del usuario — justo lo que este proyecto no hace. Se
 * teclea el número, que es lo que cualquier móvil enseña en su pantalla de
 * salud.
 */

import { KCAL_PER_KG_FAT } from './constants.js';

/**
 * Kilocalorías por paso a 70 kg de peso corporal.
 *
 * Es el consenso de las estimaciones al uso (≈0,04–0,05 kcal/paso) y cuadra con
 * la vía MET: 10 000 pasos son unos 8 km, unos 96 min a 5 km/h, y a 3,5 MET
 * salen `96 × 3,5 × 3,5 × 70 / 200 ≈ 411 kcal` — frente a las 400 que da esta
 * constante. Que dos caminos independientes coincidan al 3 % es lo que la hace
 * usable; presentarla con más decimales sería precisión fingida.
 */
export const KCAL_PER_STEP_AT_70KG = 0.04;

/** Peso de referencia de la constante anterior. */
export const REFERENCE_WEIGHT_KG = 70;

/**
 * Pasos que cada nivel de actividad YA supone.
 *
 * ESTA TABLA ES LA QUE EVITA EL DOBLE CONTEO, y por eso es la pieza más
 * importante del módulo. Los multiplicadores de actividad (PAL) de
 * `constants.js` describen el gasto de alguien con ese estilo de vida, andar
 * incluido; aquí se hace explícito cuánto andar es «ese estilo de vida», para
 * poder restar.
 *
 * Las cifras son las franjas al uso en la literatura de actividad física
 * (Tudor-Locke y cols., índices de pasos/día por categoría): <5 000 sedentario,
 * 5 000–7 499 poco activo, 7 500–9 999 algo activo, ≥10 000 activo, ≥12 500 muy
 * activo. Se toma el centro de cada franja.
 * @type {Readonly<Record<string, number>>}
 */
export const BASELINE_STEPS = Object.freeze({
    sedentary: 4000,
    light: 6000,
    moderate: 8500,
    active: 11000,
    veryActive: 14000
});

/** Tope de plausibilidad diaria. Por encima, es un error de tecleo. */
export const MAX_DAILY_STEPS = 60000;

/**
 * Coste energético BRUTO de andar un número de pasos.
 *
 * Escala con el peso porque mover 100 kg cuesta más que mover 60. Devuelve 0
 * ante entrada absurda en vez de `NaN`: un NaN se propagaría por el gasto del
 * día y aparecería tres pantallas más allá.
 *
 * @param {number} steps
 * @param {number} weightKg
 * @returns {number} kcal
 */
export function stepsKcal(steps, weightKg) {
    const n = Number.isFinite(steps) && steps > 0 ? Math.min(steps, MAX_DAILY_STEPS) : 0;
    const kg = Number.isFinite(weightKg) && weightKg > 0 ? weightKg : REFERENCE_WEIGHT_KG;
    return Math.round(n * KCAL_PER_STEP_AT_70KG * (kg / REFERENCE_WEIGHT_KG));
}

/**
 * Lo que los pasos aportan SOBRE lo que el nivel de actividad ya suponía.
 *
 * INVARIANTE `sin_doble_conteo`: andar exactamente los pasos de referencia de tu
 * nivel devuelve 0. Ni un céntimo de kilocaloría se cuenta dos veces.
 *
 * El resultado puede ser NEGATIVO, y eso es una función, no un defecto: alguien
 * que se declaró «activo» y lleva una semana en el sofá está gastando menos de
 * lo que el plan supone, y saberlo es justo lo que explica que la báscula no
 * baje.
 *
 * @param {{ steps: number, activityLevel?: string, weightKg: number }} input
 * @returns {{ deltaSteps: number, deltaKcal: number, baselineSteps: number, grossKcal: number }}
 */
export function neatDelta(input) {
    const baselineSteps = BASELINE_STEPS[String(input?.activityLevel ?? '')] ?? BASELINE_STEPS.moderate;
    const steps = Number.isFinite(input?.steps) && input.steps > 0
        ? Math.min(input.steps, MAX_DAILY_STEPS)
        : 0;
    const deltaSteps = steps - baselineSteps;
    return {
        deltaSteps,
        // La diferencia entre dos brutos es una buena aproximación del neto: lo
        // que se descuenta por «estar sentado en vez de andar» aparece en los
        // dos términos y se cancela. Modelar el neto por separado daría una
        // cifra más elaborada y no más cierta.
        deltaKcal: stepsKcal(Math.abs(deltaSteps), input?.weightKg) * Math.sign(deltaSteps),
        baselineSteps,
        grossKcal: stepsKcal(steps, input?.weightKg)
    };
}

/**
 * @typedef {Object} StepsEntry
 * @property {string} dateISO
 * @property {number} steps
 */

/**
 * Media de pasos de un periodo, y lo que aporta al gasto.
 *
 * Se trabaja sobre la MEDIA y no sobre el último día por la misma razón que el
 * gasto medido de V2-M1 usa tendencia: un domingo de sofá no cambia el gasto de
 * la semana, y ajustar el plan por un día es ruido disfrazado de señal.
 *
 * @param {{ entries: StepsEntry[], activityLevel?: string, weightKg: number, days?: number }} input
 * @returns {{ meanSteps: number, days: number, delta: ReturnType<typeof neatDelta> } | null}
 */
export function neatAverage(input) {
    const days = Number.isFinite(input?.days) && /** @type {number} */ (input.days) > 0
        ? /** @type {number} */ (input.days)
        : 7;
    const entries = (Array.isArray(input?.entries) ? input.entries : [])
        .filter((e) => typeof e?.dateISO === 'string' && Number.isFinite(e?.steps))
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO))
        .slice(-days);
    if (entries.length === 0) return null;

    const meanSteps = Math.round(entries.reduce((acc, e) => acc + Math.max(0, e.steps), 0) / entries.length);
    return {
        meanSteps,
        days: entries.length,
        delta: neatDelta({ steps: meanSteps, activityLevel: input?.activityLevel, weightKg: input?.weightKg })
    };
}

/**
 * El canje: andar más para comer más, o al revés.
 *
 * ES UN ESCENARIO, NO UN CONSEJO. La app enseña la equivalencia —«3 000 pasos
 * más al día son 120 kcal, que es lo que ahorrarías comiendo esto menos»— y deja
 * elegir. Empujar hacia un lado sería decidir por el usuario algo que depende de
 * su vida, no de su fisiología.
 *
 * @param {{ extraSteps: number, weightKg: number }} input
 * @returns {{ extraSteps: number, kcalPerDay: number, kgPerWeek: number, kgPerMonth: number }}
 */
export function tradeOff(input) {
    const extraSteps = Number.isFinite(input?.extraSteps) ? input.extraSteps : 0;
    const kcalPerDay = stepsKcal(Math.abs(extraSteps), input?.weightKg) * Math.sign(extraSteps);
    // La equivalencia energética es la MISMA que usa el motor (B3): 7 700 kcal
    // por kilo de grasa. Usar otra cifra aquí haría que la app se contradijera
    // consigo misma entre dos pantallas.
    const kgPerWeek = (kcalPerDay * 7) / KCAL_PER_KG_FAT;
    return {
        extraSteps,
        kcalPerDay,
        kgPerWeek: Math.round(kgPerWeek * 1000) / 1000,
        kgPerMonth: Math.round(kgPerWeek * (30 / 7) * 1000) / 1000
    };
}

/**
 * Objetivo diario de pasos: los que su nivel declarado ya supone.
 *
 * No se inventa un «10 000» universal. Esa cifra salió de una campaña de
 * marketing japonesa de 1965, no de un estudio, y ponerla como objetivo a
 * alguien que declaró vida sedentaria es fijarle una meta que no va a cumplir.
 * @param {string} activityLevel
 * @returns {number}
 */
export function dailyTarget(activityLevel) {
    return BASELINE_STEPS[String(activityLevel)] ?? BASELINE_STEPS.moderate;
}

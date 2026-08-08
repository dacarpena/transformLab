// @ts-check

/**
 * Suplementación: qué mueve la aguja y qué no (V2-M5). Módulo PURO.
 *
 * LA HONESTIDAD ES LA FUNCIÓN, no un adorno. TransformLab no vende nada, así que
 * puede decir «esto no funciona» sin perder margen — algo que ninguna web que
 * rankea suplementos Y regenta la tienda puede permitirse. Por eso el nivel de
 * evidencia acompaña SIEMPRE a cada ítem, y los que no tienen respaldo aparecen
 * igualmente, marcados: saber que los BCAA no hacen falta ahorra más dinero que
 * cualquier recomendación.
 *
 * EL CRIBADO DE SEGURIDAD ES UNA RESTRICCIÓN DURA, del mismo rango que la
 * alergia en el menú (V2-M3): un estimulante contraindicado no se propone
 * atenuado ni «con precaución». Se retira, y se dice por qué. La app no sabe
 * nada de la historia clínica de nadie, así que el único comportamiento
 * defendible es el conservador.
 *
 * ESTO NO ES CONSEJO MÉDICO y el módulo no finge que lo sea: `disclaimerKey`
 * viaja con el resultado para que ninguna vista pueda olvidarse de decirlo.
 */

import catalog from './data/supplements-catalog.json' with { type: 'json' };

/**
 * Niveles de evidencia, de más a menos. El orden ES la ordenación del stack:
 * lo que mueve la aguja arriba, lo cosmético abajo, y lo que no funciona al
 * final pero VISIBLE.
 * @type {readonly string[]}
 */
export const EVIDENCE_ORDER = Object.freeze(['strong', 'moderate', 'preliminary', 'none']);

/**
 * Banderas de seguridad que el usuario puede declarar. Son las que retiran
 * suplementos, no las que los matizan.
 * @type {readonly string[]}
 */
export const SAFETY_FLAGS = Object.freeze([
    'anxiety', 'hypertension', 'pregnancy', 'arrhythmia', 'insomnia',
    'kidney', 'anticoagulants', 'milk_allergy', 'fish_allergy', 'hypercalcemia'
]);

/** El catálogo, tal cual. */
export const SUPPLEMENTS = /** @type {SupplementItem[]} */ (catalog.items);

/**
 * @typedef {Object} SupplementItem
 * @property {string} id
 * @property {{ es: string, en: string }} name
 * @property {string} evidence
 * @property {string[]} goals
 * @property {string[]} phases
 * @property {{ es: string, en: string }} doseText
 * @property {string} timing
 * @property {[number, number]} costEurMonth
 * @property {{ es: string, en: string }} why
 * @property {{ es: string, en: string }} caveats
 * @property {string[]} contraindications
 * @property {boolean} [neverRecommend]
 * @property {boolean} [dopingRisk]
 * @property {string} source
 */

/**
 * Texto del catálogo en el idioma pedido. Mismo criterio que
 * `core/milestones.textOf`: las fichas editoriales viven en el JSON con sus dos
 * lenguas, no en los diccionarios de interfaz.
 * @param {{ es: string, en: string } | string} value
 * @param {string} locale
 * @returns {string}
 */
export function textOf(value, locale) {
    if (typeof value === 'string') return value;
    if (!value || typeof value !== 'object') return '';
    return value[/** @type {'es'|'en'} */ (locale)] ?? value.es ?? '';
}

/** Dosis ergogénica de cafeína, en mg por kg de peso (ISSN position stand). */
export const CAFFEINE_MG_PER_KG = Object.freeze({ min: 3, max: 6 });

/**
 * Horas antes de dormir a partir de las cuales la cafeína ya estorba.
 *
 * Su vida media ronda las 5 horas, así que a las 8 todavía queda una cuarta
 * parte en sangre. No es una manía: dormir peor cuesta más de lo que la cafeína
 * aporta en el gimnasio, y esta app proyecta recuperación, no solo entreno.
 */
export const CAFFEINE_CUTOFF_HOURS = 8;

/**
 * Dosis de cafeína y hora a partir de la cual estorba para dormir.
 *
 * Se AVISA del choque; no se cambia nada por el usuario (B9). La app propone,
 * el usuario decide — igual que con la recalibración.
 *
 * @param {{ weightKg: number, bedtime?: string, trainingTime?: string }} input
 * @returns {{ minMg: number, maxMg: number, cutoffTime: string | null, conflict: boolean }}
 */
export function caffeinePlan(input) {
    const kg = Number.isFinite(input?.weightKg) && input.weightKg > 0 ? input.weightKg : 0;
    const minMg = Math.round(kg * CAFFEINE_MG_PER_KG.min);
    const maxMg = Math.round(kg * CAFFEINE_MG_PER_KG.max);

    const bed = parseTime(input?.bedtime);
    if (bed === null) return { minMg, maxMg, cutoffTime: null, conflict: false };

    // Aritmética modular sobre el reloj: restar 8 horas a las 02:00 son las
    // 18:00 del día anterior, no un número negativo.
    const cutoffMinutes = ((bed - CAFFEINE_CUTOFF_HOURS * 60) % 1440 + 1440) % 1440;
    const training = parseTime(input?.trainingTime);
    // La toma es 60 min ANTES de entrenar, así que es esa hora la que se compara
    // con el corte, no la del entrenamiento.
    const intake = training === null ? null : ((training - 60) % 1440 + 1440) % 1440;

    return {
        minMg,
        maxMg,
        cutoffTime: formatTime(cutoffMinutes),
        conflict: intake !== null && isAfterCutoff(intake, cutoffMinutes, bed)
    };
}

/**
 * ¿La toma cae dentro de la ventana prohibida (entre el corte y la hora de
 * dormir)? La ventana puede cruzar la medianoche, y compararla con `>` a secas
 * daba falso para quien se acuesta a la una.
 * @param {number} intake @param {number} cutoff @param {number} bed @returns {boolean}
 */
function isAfterCutoff(intake, cutoff, bed) {
    return cutoff <= bed
        ? intake >= cutoff && intake <= bed
        : intake >= cutoff || intake <= bed;
}

/** 'HH:MM' → minutos desde medianoche, o `null`. @param {unknown} value @returns {number | null} */
function parseTime(value) {
    if (typeof value !== 'string') return null;
    const m = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) return null;
    return h * 60 + min;
}

/** Minutos desde medianoche → 'HH:MM'. @param {number} minutes @returns {string} */
function formatTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * @typedef {Object} StackEntry
 * @property {SupplementItem} item
 * @property {boolean} recommended ¿entra en el plan, o solo se explica?
 * @property {string} [excludedBy] bandera de seguridad que lo retiró
 */

/**
 * El stack para una fase y unas condiciones concretas.
 *
 * DEVUELVE TAMBIÉN LO QUE NO RECOMIENDA, y ese es el punto: un ítem retirado por
 * seguridad o por falta de evidencia aparece con su motivo. Ocultarlo dejaría al
 * usuario comprándolo en otro sitio sin saber por qué no estaba.
 *
 * @param {{
 *   phase?: string,
 *   safetyFlags?: string[],
 *   excluded?: string[],
 *   goals?: string[]
 * }} input
 * @returns {{
 *   recommended: StackEntry[],
 *   excludedBySafety: StackEntry[],
 *   noEvidence: StackEntry[],
 *   disclaimerKey: string
 * }}
 */
export function stackFor(input) {
    const flags = new Set((input?.safetyFlags ?? []).filter((f) => SAFETY_FLAGS.includes(f)));
    const excluded = new Set(input?.excluded ?? []);
    const phase = String(input?.phase ?? '');
    const goals = input?.goals ?? [];

    /** @type {StackEntry[]} */ const recommended = [];
    /** @type {StackEntry[]} */ const excludedBySafety = [];
    /** @type {StackEntry[]} */ const noEvidence = [];

    for (const item of SUPPLEMENTS) {
        // 1. CRIBADO DURO. Va primero, antes que cualquier otra consideración:
        //    un estimulante contraindicado no se propone atenuado, se retira.
        const choque = item.contraindications.find((c) => flags.has(c));
        if (choque) {
            excludedBySafety.push({ item, recommended: false, excludedBy: choque });
            continue;
        }
        // 2. Lo que el catálogo marca como «nunca» tampoco se recomienda, pero
        //    se enseña: está para explicar POR QUÉ no, no como opción.
        if (item.neverRecommend || item.evidence === 'none') {
            noEvidence.push({ item, recommended: false });
            continue;
        }
        // 3. Lo que el usuario ha descartado él mismo sale del stack sin ruido.
        if (excluded.has(item.id)) continue;
        // 4. Pertinencia. AND sobre los criterios ESPECIFICADOS, no OR: un
        //    criterio que el usuario no ha dado debe ser neutro, no un pase
        //    libre. Con OR, pedir la fase de volumen sin declarar objetivos
        //    dejaba pasar el HMB —que es de definición— porque «sin objetivos»
        //    contaba como coincidencia y anulaba el filtro de fase.
        const encajaFase = phase === '' || item.phases.includes(phase);
        const encajaObjetivo = goals.length === 0 || item.goals.some((g) => goals.includes(g));
        if (!encajaFase || !encajaObjetivo) continue;

        recommended.push({ item, recommended: true });
    }

    const porEvidencia = (/** @type {StackEntry} */ a, /** @type {StackEntry} */ b) =>
        (EVIDENCE_ORDER.indexOf(a.item.evidence) - EVIDENCE_ORDER.indexOf(b.item.evidence))
        // Determinista a igualdad de evidencia: por id, nunca por azar.
        || a.item.id.localeCompare(b.item.id);

    return {
        recommended: recommended.sort(porEvidencia),
        excludedBySafety: excludedBySafety.sort(porEvidencia),
        noEvidence: noEvidence.sort(porEvidencia),
        disclaimerKey: 'supplements.disclaimer'
    };
}

/**
 * Coste mensual estimado de un stack, en euros.
 *
 * Se devuelve como RANGO y nunca como cifra única: los precios varían por marca
 * y por mes, y un número exacto daría una precisión que no existe.
 * @param {StackEntry[]} entries
 * @returns {{ minEur: number, maxEur: number }}
 */
export function stackCost(entries) {
    let minEur = 0;
    let maxEur = 0;
    for (const entry of Array.isArray(entries) ? entries : []) {
        const [lo, hi] = entry?.item?.costEurMonth ?? [0, 0];
        minEur += Number.isFinite(lo) ? lo : 0;
        maxEur += Number.isFinite(hi) ? hi : 0;
    }
    return { minEur, maxEur };
}

// @ts-check

/**
 * Macros del día (decisión E4a).
 *
 * Regla de oro: **las macros NO calculan sus propias calorías.** Parten del
 * objetivo que ya produce el motor, que a su vez se deriva de la Δgrasa
 * esperada de la fase vía 7 700 kcal/kg (decisión B3). Un cálculo paralelo
 * —lo que hacía el legacy, que rehacía BMR y TDEE por su cuenta— podría decir
 * algo distinto del propio plan.
 *
 * Las dos constantes del legacy que la auditoría marcó como SIN FUENTE
 * (`docs/METODOLOGIA-CIENTIFICA.md` §7.6: proteína de 2,2 g/kg y NEAT de
 * 10 000 pasos) no se portan: la proteína entra con cita y expresada sobre la
 * magnitud correcta, y el objetivo de pasos no entra en absoluto.
 */

/**
 * @typedef {import('./generator.js').DailyPoint} DailyPoint
 * @typedef {Object} Macros
 * @property {number} kcal exactamente el objetivo del motor
 * @property {number} proteinG
 * @property {number} carbsG
 * @property {number} fatG
 * @property {string[]} warnings códigos i18n, p. ej. calorías insuficientes
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} NutritionResult
 */

/**
 * Proteína en gramos por kg de masa LIBRE DE GRASA.
 *
 * Fuente: Helms et al. 2014 (recomendaciones para atletas naturales en
 * preparación) sitúa 2,3–3,1 g/kg de masa libre de grasa durante el déficit
 * para preservar tejido magro; fuera del déficit, la posición del ISSN
 * (Jäger et al. 2017) sitúa el rango en 1,4–2,0 g/kg de peso corporal, que
 * para una composición normal equivale a algo menos sobre la magra.
 *
 * Se expresa sobre la masa MAGRA a propósito. El legacy la expresaba sobre el
 * peso corporal y sin fuente: a un usuario de 120 kg con un 40 % de grasa le
 * pedía 264 g diarios, proteína para 72 kg de tejido que no tiene.
 * @type {Readonly<{cut: number, default: number}>}
 */
export const PROTEIN_G_PER_KG_LEAN = Object.freeze({
    cut: 2.4,
    default: 2.0
});

/**
 * Grasa como fracción de las calorías totales.
 *
 * Fuente: las revisiones de nutrición deportiva sitúan en torno al 20 % de la
 * energía el mínimo prudente para la función endocrina en déficit (Helms 2014
 * lo discute como suelo práctico). El objetivo del 25 % deja margen y el resto
 * va a carbohidratos, que es lo que sostiene el entrenamiento.
 * @type {Readonly<{target: number, min: number}>}
 */
export const FAT_PCT_OF_KCAL = Object.freeze({ target: 0.25, min: 0.20 });

/** @param {unknown} v @returns {v is number} */
function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Macros del día a partir de un punto de la proyección.
 * @param {DailyPoint} point
 * @returns {NutritionResult<Macros>}
 */
export function macrosFor(point) {
    if (!point || typeof point !== 'object') return { ok: false, error: 'nutrition.pointInvalid' };
    const kcal = point.kcal?.targetKcal;
    if (!isFiniteNumber(kcal) || kcal <= 0) return { ok: false, error: 'nutrition.kcalInvalid' };
    if (!isFiniteNumber(point.leanKg) || point.leanKg <= 0) return { ok: false, error: 'nutrition.leanInvalid' };

    /** @type {string[]} */ const warnings = [];

    const perKg = point.phaseType === 'cut' ? PROTEIN_G_PER_KG_LEAN.cut : PROTEIN_G_PER_KG_LEAN.default;
    let proteinG = Math.round(point.leanKg * perKg);
    let fatG = Math.round((kcal * FAT_PCT_OF_KCAL.target) / 9);

    let remainingKcal = kcal - proteinG * 4 - fatG * 9;

    // Con objetivos calóricos muy bajos, proteína y grasa pueden no caber.
    // Cede primero la grasa hasta su suelo endocrino y después la proteína:
    // los carbohidratos nunca salen negativos, y el usuario queda avisado.
    if (remainingKcal < 0) {
        const minFatG = Math.ceil((kcal * FAT_PCT_OF_KCAL.min) / 9);
        const fatSlack = Math.max(0, fatG - minFatG);
        const takeFromFat = Math.min(fatSlack, Math.ceil(-remainingKcal / 9));
        fatG -= takeFromFat;
        remainingKcal += takeFromFat * 9;
        warnings.push('nutrition.tightKcal');
    }
    if (remainingKcal < 0) {
        const takeFromProtein = Math.ceil(-remainingKcal / 4);
        proteinG = Math.max(0, proteinG - takeFromProtein);
        remainingKcal = kcal - proteinG * 4 - fatG * 9;
        warnings.push('nutrition.proteinReduced');
    }

    const carbsG = Math.max(0, Math.round(remainingKcal / 4));
    return { ok: true, value: { kcal, proteinG, carbsG, fatG, warnings } };
}

/**
 * Macros de un día de refeed o descanso de dieta.
 *
 * Un refeed se define como comer a MANTENIMIENTO (Peos et al. 2019 sobre
 * restricción energética intermitente), no como multiplicar por un factor
 * inventado: el legacy usaba ×1,2 sin fuente. Las calorías extra van a
 * carbohidratos, que es el sustrato que repone el glucógeno.
 * @param {Macros} base
 * @param {DailyPoint} point
 * @returns {NutritionResult<Macros>}
 */
export function refeedMacros(base, point) {
    if (!base || typeof base !== 'object' || !isFiniteNumber(base.kcal)) {
        return { ok: false, error: 'nutrition.macrosInvalid' };
    }
    if (!point || typeof point !== 'object' || !isFiniteNumber(point.kcal?.tdeeKcal)) {
        return { ok: false, error: 'nutrition.pointInvalid' };
    }
    const maintenance = point.kcal.tdeeKcal;
    // Sin déficit no hay nada de lo que descansar.
    if (maintenance <= base.kcal) {
        return { ok: true, value: { ...base, warnings: [...base.warnings] } };
    }
    const extraKcal = maintenance - base.kcal;
    return {
        ok: true,
        value: {
            kcal: maintenance,
            proteinG: base.proteinG,
            fatG: base.fatG,
            carbsG: base.carbsG + Math.round(extraKcal / 4),
            warnings: [...base.warnings, 'nutrition.refeedDay']
        }
    };
}

/**
 * Reparte las calorías del día entre comidas.
 * Las fracciones son una decisión de producto (un reparto cómodo), no una
 * afirmación científica: el total diario es lo que importa.
 * @param {Macros} macros
 * @param {number} mealCount
 * @returns {NutritionResult<Array<{ index: number, kcal: number, proteinG: number, carbsG: number, fatG: number }>>}
 */
export function splitIntoMeals(macros, mealCount) {
    if (!macros || typeof macros !== 'object' || !isFiniteNumber(macros.kcal)) {
        return { ok: false, error: 'nutrition.macrosInvalid' };
    }
    const count = Math.min(8, Math.max(1, Math.round(isFiniteNumber(mealCount) ? mealCount : 4)));
    const out = [];
    let usedKcal = 0;
    let usedProtein = 0;
    let usedCarbs = 0;
    let usedFat = 0;

    for (let i = 0; i < count; i++) {
        const last = i === count - 1;
        // el último recoge el resto: las porciones suman siempre el total
        const kcal = last ? macros.kcal - usedKcal : Math.round(macros.kcal / count);
        const proteinG = last ? macros.proteinG - usedProtein : Math.round(macros.proteinG / count);
        const carbsG = last ? macros.carbsG - usedCarbs : Math.round(macros.carbsG / count);
        const fatG = last ? macros.fatG - usedFat : Math.round(macros.fatG / count);
        usedKcal += kcal; usedProtein += proteinG; usedCarbs += carbsG; usedFat += fatG;
        out.push({ index: i, kcal, proteinG, carbsG, fatG });
    }
    return { ok: true, value: out };
}

// @ts-check

/**
 * Silueta paramétrica (decisión E6a): geometría normalizada a partir de la
 * composición, y afinada con las medidas REALES del usuario cuando existen.
 *
 * Es una representación esquemática, no un retrato: la vista lo dice. Lo que
 * aporta es comparar tres estados (inicio / hoy / objetivo) con la misma
 * regla, que es donde el ojo detecta cambios que una cifra no transmite.
 *
 * Puro: devuelve números, no SVG. Dibujar es cosa de la vista.
 */

/**
 * @typedef {Object} SilhouetteShape
 * @property {number} shoulders anchura de hombros, unidades relativas
 * @property {number} chest
 * @property {number} waist
 * @property {number} hips
 * @property {number} thigh
 * @property {number} arm
 * @property {number} height alto total, constante entre estados
 * @property {boolean} fromMeasures true si alguna medida real intervino
 */

/** Proporciones base por sexo, en unidades relativas a la altura del dibujo. */
const BASE = Object.freeze({
    male: { shoulders: 0.26, chest: 0.24, waist: 0.19, hips: 0.21, thigh: 0.115, arm: 0.062 },
    female: { shoulders: 0.225, chest: 0.205, waist: 0.175, hips: 0.235, thigh: 0.12, arm: 0.052 }
});

/**
 * Cuánto se ensancha cada zona por punto de grasa por encima de la referencia.
 * La grasa no se reparte igual: la cintura es la que más varía, los hombros
 * casi nada. Son coeficientes de dibujo, no una afirmación antropométrica; la
 * vista los presenta como esquema.
 */
const FAT_SENSITIVITY = Object.freeze({ shoulders: 0.10, chest: 0.35, waist: 1.0, hips: 0.55, thigh: 0.45, arm: 0.25 });

/** Cuánto se ensancha cada zona por kg de músculo sobre la referencia. */
const MUSCLE_SENSITIVITY = Object.freeze({ shoulders: 0.9, chest: 0.8, waist: 0.15, hips: 0.3, thigh: 0.7, arm: 1.0 });

/** %grasa de referencia por sexo: el punto donde el dibujo es el base. */
const REFERENCE_FAT_PCT = Object.freeze({ male: 15, female: 23 });

/** @param {unknown} v @returns {v is number} */
function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/** @param {number} v @param {number} min @param {number} max */
function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

/**
 * Geometría de una composición.
 * @param {{ weightKg: number, fatPct: number, muscleKg: number, sex: 'male'|'female' }} composition
 * @param {Record<string, number>} [measuresCm] medidas reales del último check-in
 * @returns {SilhouetteShape | null}
 */
export function shapeFor(composition, measuresCm) {
    if (!composition || typeof composition !== 'object') return null;
    const sex = composition.sex === 'female' ? 'female' : 'male';
    if (!isFiniteNumber(composition.fatPct) || !isFiniteNumber(composition.muscleKg)) return null;
    if (!isFiniteNumber(composition.weightKg) || composition.weightKg <= 0) return null;

    const base = BASE[sex];
    const fatDelta = composition.fatPct - REFERENCE_FAT_PCT[sex];
    // el músculo se normaliza por el peso: 0,40 de músculo/peso es una
    // referencia media, y desviarse de ella ensancha o estrecha el dibujo
    const muscleRatio = composition.muscleKg / composition.weightKg;
    const muscleDelta = (muscleRatio - 0.40) * 100;

    /** @type {Record<string, number>} */ const shape = {};
    for (const key of /** @type {const} */ (['shoulders', 'chest', 'waist', 'hips', 'thigh', 'arm'])) {
        const fatTerm = fatDelta * FAT_SENSITIVITY[key] * 0.006;
        const muscleTerm = muscleDelta * MUSCLE_SENSITIVITY[key] * 0.004;
        // se acota a ±45 % del base: una silueta imposible no informa de nada
        shape[key] = clamp(base[key] * (1 + fatTerm + muscleTerm), base[key] * 0.55, base[key] * 1.45);
    }

    // Las medidas REALES, si existen, mandan sobre la estimación (E2 × E6):
    // la circunferencia se convierte a anchura asumiendo sección elíptica.
    let fromMeasures = false;
    if (measuresCm && typeof measuresCm === 'object') {
        /**
         * @param {string} key
         * @param {unknown} cm
         * @param {number} referenceCm
         */
        const applyMeasure = (key, cm, referenceCm) => {
            if (!isFiniteNumber(cm) || cm <= 0) return;
            shape[key] = clamp(shape[key] * (cm / referenceCm), shape[key] * 0.6, shape[key] * 1.6);
            fromMeasures = true;
        };
        applyMeasure('waist', measuresCm.waist, sex === 'male' ? 85 : 74);
        applyMeasure('hips', measuresCm.hip, sex === 'male' ? 98 : 100);
        applyMeasure('thigh', measuresCm.thigh, sex === 'male' ? 57 : 55);
        applyMeasure('arm', measuresCm.arm, sex === 'male' ? 33 : 28);
        applyMeasure('chest', measuresCm.chest, sex === 'male' ? 100 : 88);
    }

    return {
        shoulders: shape.shoulders, chest: shape.chest, waist: shape.waist,
        hips: shape.hips, thigh: shape.thigh, arm: shape.arm,
        height: 1, fromMeasures
    };
}

/**
 * Índice cintura/hombros, la señal de forma que más se nota a simple vista.
 * @param {SilhouetteShape | null} shape
 * @returns {number} 0 si no se puede calcular
 */
export function waistToShoulderRatio(shape) {
    if (!shape || !isFiniteNumber(shape.waist) || !isFiniteNumber(shape.shoulders) || shape.shoulders <= 0) return 0;
    return shape.waist / shape.shoulders;
}

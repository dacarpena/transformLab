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

/** Zonas que una medida real puede corregir, y su circunferencia de referencia. */
const MEASURE_REFERENCE = Object.freeze({
    waist: { measure: 'waist', male: 85, female: 74 },
    hips: { measure: 'hip', male: 98, female: 100 },
    thigh: { measure: 'thigh', male: 57, female: 55 },
    arm: { measure: 'arm', male: 33, female: 28 },
    chest: { measure: 'chest', male: 100, female: 88 }
});

const MEASURED_KEYS = Object.freeze(Object.keys(MEASURE_REFERENCE));

/**
 * Factor de corrección por zona a partir de las medidas reales de HOY.
 *
 * Se calcula una vez y se aplica a las tres siluetas del comparador: es lo
 * que hace que sigan siendo comparables entre sí (misma regla) y a la vez
 * reflejen las proporciones de esta persona y no las de una tabla.
 *
 * La circunferencia se traduce a anchura asumiendo sección elíptica, de modo
 * que el factor es la razón entre la medida real y la de referencia del sexo.
 * @param {'male'|'female'} sex
 * @param {Record<string, number> | undefined} measuresCm
 * @returns {Record<string, number> | null} null si no hay ninguna medida útil
 */
export function calibrationFrom(sex, measuresCm) {
    if (!measuresCm || typeof measuresCm !== 'object') return null;
    const side = sex === 'female' ? 'female' : 'male';
    /** @type {Record<string, number>} */ const out = {};
    let any = false;
    for (const key of MEASURED_KEYS) {
        const spec = MEASURE_REFERENCE[/** @type {keyof typeof MEASURE_REFERENCE} */ (key)];
        const cm = measuresCm[spec.measure];
        if (!isFiniteNumber(cm) || cm <= 0) continue;
        out[key] = cm / spec[side];
        any = true;
    }
    return any ? out : null;
}

/**
 * Geometría de una composición.
 * @param {{ weightKg: number, fatPct: number, muscleKg: number, sex: 'male'|'female' }} composition
 * @param {Record<string, number> | null} [calibration] salida de `calibrationFrom`
 * @returns {SilhouetteShape | null}
 */
export function shapeFor(composition, calibration) {
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

    // Las medidas REALES, si existen, CALIBRAN el modelo (E2 × E6).
    //
    // Antes se multiplicaban por la estimación, y eso rompía lo único que la
    // vista aporta: comparar tres estados con la misma regla. Con medidas solo
    // en «hoy», la figura de hoy salía hasta un 60 % más ancha que la de
    // inicio aunque el usuario hubiera adelgazado 11 kg. Ahora el factor se
    // calcula una vez (`calibrationFrom`) y el llamante lo aplica a las TRES
    // figuras, así que la comparación sigue siendo válida y además usa las
    // proporciones reales de esta persona en lugar de las de la tabla.
    let fromMeasures = false;
    const factors = calibration && typeof calibration === 'object' ? calibration : null;
    if (factors) {
        for (const key of MEASURED_KEYS) {
            const factor = factors[key];
            if (!isFiniteNumber(factor) || factor <= 0) continue;
            shape[key] = clamp(shape[key] * factor, shape[key] * 0.6, shape[key] * 1.6);
            fromMeasures = true;
        }
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

// @ts-check

/**
 * Lectura de una báscula de bioimpedancia doméstica (decisión E10).
 *
 * EL PROBLEMA. Una Xiaomi miScale —y una Huawei, y una Withings— descompone el
 * peso en tres partes: `peso = grasa + músculo + hueso`. Lo que llama «masa
 * muscular» es, por tanto, TODO lo que no es grasa ni hueso: músculo, órganos,
 * piel, tejido conectivo y agua corporal. Es la masa magra menos el hueso, y
 * ronda el 95 % de la magra.
 *
 * El motor de TransformLab usa **músculo esquelético** (Janssen 2000), que es
 * ~49 % de la masa magra en varones y ~44 % en mujeres. Para una lectura real
 * de 81,20 kg y 26,5 % de grasa, la báscula dice 56,56 kg y el motor trabaja
 * con 29,24 kg. Son dos cantidades distintas con el mismo nombre.
 *
 * Eso es exactamente lo que mató a la v4.0 (`docs/AUDITORIA.md` §1): dos
 * definiciones incompatibles de «músculo» conviviendo sin que nadie lo dijera.
 * Aquí NO conviven. Este módulo traduce, en un solo sitio y a la vista:
 *
 *   1. Acepta la lectura tal y como la muestra la báscula, sin pedirle al
 *      usuario que convierta nada.
 *   2. Comprueba que las tres cifras cuadran entre sí (`peso = grasa +
 *      músculo + hueso`). Si no cuadran, avisa en vez de tragar.
 *   3. Recalcula el %grasa desde músculo + hueso, que vienen con más decimales
 *      que el porcentaje de la pantalla.
 *   4. DERIVA el músculo esquelético que el motor necesita, y lo marca como
 *      derivado: ni medido por el usuario, ni estimado a ciegas.
 *
 * Lo que este módulo NO hace, y conviene saberlo: la «masa muscular» de una
 * báscula doméstica no aporta información independiente sobre el músculo
 * esquelético, porque es casi toda la masa magra. Lo que sí aporta es la
 * comprobación cruzada del punto 2 y un %grasa más fino. La proyección sale
 * igual que estimando; hay un test que lo fija para que nadie se confunda.
 *
 * Puro: ni DOM, ni almacén, ni red.
 */

import { SMM_OF_LEAN_RATIO } from './constants.js';
import { isValidSex, checkComposition } from './ranges.js';

/**
 * @typedef {import('./ranges.js').Issue} Issue
 *
 * @typedef {Object} ScaleReading
 * @property {number} weightKg
 * @property {number} fatPct el porcentaje de grasa RECALCULADO de músculo + hueso
 * @property {number} fatKg
 * @property {number} leanKg masa magra = músculo de báscula + hueso
 * @property {number} boneKg tal cual lo dio la báscula
 * @property {number} scaleMuscleKg tal cual lo dio la báscula (magra − hueso)
 * @property {number} skeletalMuscleKg el músculo ESQUELÉTICO que usa el motor
 * @property {'male' | 'female'} sex
 *
 * @typedef {{ ok: true, value: ScaleReading, warnings: Issue[] } | { ok: false, errors: Issue[] }} ScaleResult
 */

/**
 * Fracción de la masa magra que es hueso, por sexo.
 *
 * Solo se usa para juzgar si la masa ósea que dice la báscula es plausible;
 * nunca para sustituirla. Referencia: los rangos habituales de contenido
 * mineral óseo en adultos sitúan el esqueleto en torno al 5–6 % de la masa
 * libre de grasa, algo menor en mujeres por menor tamaño esquelético.
 * @type {Readonly<Record<'male'|'female', number>>}
 */
export const BONE_SHARE_OF_LEAN = Object.freeze({ male: 0.055, female: 0.052 });

/** Cuánto puede desviarse la proporción de hueso antes de avisar. */
const BONE_SHARE_TOLERANCE = 0.4;

/** Límites duros de masa ósea, en fracción de la masa magra. */
const BONE_SHARE_HARD = Object.freeze({ min: 0.02, max: 0.12 });

/**
 * Desajuste máximo tolerado en `peso = grasa + músculo + hueso`, en kg.
 *
 * Las básculas redondean el peso a 0,05 kg, el %grasa a 0,1 y las masas a
 * 0,01–0,1: el cuadre nunca es exacto. Medio kilo deja pasar el redondeo y
 * caza una cifra mal tecleada, que es el error que de verdad ocurre.
 */
const MISMATCH_TOLERANCE_KG = 0.5;

/** @param {unknown} v @returns {v is number} */
function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/** @param {number} n */
function round2(n) {
    return Math.round(n * 100) / 100;
}

/**
 * Interpreta una lectura de báscula de bioimpedancia.
 * @param {{ weightKg: number, fatPct: number, muscleKg: number, boneKg: number, sex: 'male'|'female' }} input
 * @returns {ScaleResult}
 */
export function fromBioimpedance(input) {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) {
        return { ok: false, errors: [{ code: 'scale.inputInvalid' }] };
    }
    const { weightKg, fatPct, muscleKg, boneKg, sex } = input;
    if (!isValidSex(sex)) return { ok: false, errors: [{ code: 'profile.sexUnknown' }] };

    /** @type {Issue[]} */ const errors = [];
    for (const [key, value] of /** @type {const} */ ([
        ['weightKg', weightKg], ['fatPct', fatPct], ['muscleKg', muscleKg], ['boneKg', boneKg]
    ])) {
        if (!isFiniteNumber(value) || value <= 0) errors.push({ code: `scale.${key}Invalid` });
    }
    if (errors.length > 0) return { ok: false, errors };

    // La báscula descompone el peso en tres, así que la magra sale de sumar
    // sus dos partes no grasas. Es lo que hace útil pedir también el hueso.
    const leanKg = muscleKg + boneKg;
    if (leanKg >= weightKg) {
        return { ok: false, errors: [{ code: 'scale.leanExceedsWeight', params: { leanKg: round2(leanKg) } }] };
    }

    // Comprobación cruzada: el %grasa de la pantalla tiene que ser coherente
    // con lo que implican músculo y hueso. Es lo que caza un dedo torpe.
    const impliedFatKg = weightKg - leanKg;
    const readFatKg = weightKg * (fatPct / 100);
    const mismatchKg = Math.abs(impliedFatKg - readFatKg);
    if (mismatchKg > MISMATCH_TOLERANCE_KG) {
        return {
            ok: false,
            errors: [{
                code: 'scale.mismatch',
                params: {
                    mismatchKg: round2(mismatchKg),
                    impliedFatPct: round2((impliedFatKg / weightKg) * 100),
                    readFatPct: round2(fatPct)
                }
            }]
        };
    }

    // El %grasa se recalcula desde músculo + hueso: la pantalla lo redondea a
    // un decimal y las masas vienen con dos, así que esta vía es más fina.
    const derivedFatPct = (impliedFatKg / weightKg) * 100;

    /** @type {Issue[]} */ const warnings = [];

    // El hueso se JUZGA, nunca se corrige (invariante B9: los límites sobre
    // tejido magro avisan, no clampan).
    const boneShare = boneKg / leanKg;
    if (boneShare < BONE_SHARE_HARD.min || boneShare > BONE_SHARE_HARD.max) {
        return {
            ok: false,
            errors: [{ code: 'scale.boneImplausible', params: { sharePct: Math.round(boneShare * 100) } }]
        };
    }
    const expectedShare = BONE_SHARE_OF_LEAN[sex];
    if (Math.abs(boneShare - expectedShare) / expectedShare > BONE_SHARE_TOLERANCE) {
        warnings.push({ code: 'scale.boneUnusual', params: { boneKg: round2(boneKg), sharePct: Math.round(boneShare * 100) } });
    }

    // Y el resto de rangos los sigue mandando `ranges.js`, que es la fuente
    // única: aquí no se duplica ni un límite de grasa.
    const check = checkComposition({ weightKg, fatPct: derivedFatPct }, sex);
    if (check.errors.length > 0) return { ok: false, errors: check.errors };
    warnings.push(...check.warnings);

    // El músculo ESQUELÉTICO se deriva de la magra por la proporción de
    // Janssen, igual que en la ruta estimada. El número de la báscula NO entra
    // aquí: es otra cantidad, y confundirlas es el defecto que hundió la v4.0.
    const skeletalMuscleKg = leanKg * SMM_OF_LEAN_RATIO[sex];

    return {
        ok: true,
        value: {
            weightKg,
            fatPct: derivedFatPct,
            fatKg: impliedFatKg,
            leanKg,
            boneKg,
            scaleMuscleKg: muscleKg,
            skeletalMuscleKg,
            sex
        },
        warnings
    };
}

/* ------------------------------------------------------------------------ *
 * Conversión entre las dos unidades de «músculo» (decisión E11)
 * ------------------------------------------------------------------------ */

/**
 * La distancia entre las dos cifras, en kg:
 *
 *     musculoBascula = musculoEsqueletico + (otraMagra − hueso)
 *                      \_______________/    \________________/
 *                        lo que usa el       órganos, piel, sangre, agua
 *                        motor (Janssen)     — el «offset»
 *
 * Ese paréntesis es **constante durante todo el plan**, y no por casualidad:
 * el motor conserva `otherLeanKg` (premisa declarada de `engine.targetWeightKg`,
 * fijada en `generator.js` y protegida por el invariante `conservacion`), y la
 * masa ósea de un adulto tampoco se mueve en los meses de una transformación.
 *
 * De ahí la propiedad que hace manejable todo esto: **los INCREMENTOS son
 * iguales en ambas unidades**. «Ganar 3,4 kg» significa lo mismo en la báscula
 * y en el motor. Solo hay que traducir NIVELES absolutos.
 *
 * El offset no se guarda en ninguna parte: se calcula restando dos cifras que
 * ya viven juntas en el mismo registro del perfil, así que no puede
 * desincronizarse de ellas.
 *
 * @param {{ scaleMuscleKg?: number | null, muscleKg?: number | null }} composition
 * @returns {number | null} kg de offset, o `null` si esta composición no viene
 *   de una báscula (y entonces no hay nada que traducir).
 */
export function muscleOffsetKg(composition) {
    if (composition === null || typeof composition !== 'object') return null;
    const { scaleMuscleKg, muscleKg } = composition;
    if (!isFiniteNumber(scaleMuscleKg) || !isFiniteNumber(muscleKg)) return null;
    if (scaleMuscleKg <= 0 || muscleKg <= 0) return null;
    // Una báscula siempre da MÁS que el esquelético: su «músculo» es casi toda
    // la magra. Un offset negativo significa que las cifras no son lo que
    // dicen ser, y traducir con él desplazaría todo en la dirección contraria.
    const offset = scaleMuscleKg - muscleKg;
    return offset > 0 ? offset : null;
}

/**
 * Músculo esquelético → la cifra que muestra la báscula del usuario.
 * @param {number} skeletalMuscleKg
 * @param {number} offsetKg
 * @returns {number}
 */
export function toScaleMuscle(skeletalMuscleKg, offsetKg) {
    return skeletalMuscleKg + offsetKg;
}

/**
 * La cifra de la báscula → el músculo esquelético que entiende el motor.
 * @param {number} scaleMuscleKg
 * @param {number} offsetKg
 * @returns {number}
 */
export function toSkeletalMuscle(scaleMuscleKg, offsetKg) {
    return scaleMuscleKg - offsetKg;
}

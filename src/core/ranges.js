// @ts-check

/**
 * Fuente ÚNICA de rangos y límites del producto (decisión B9): el motor y el
 * onboarding beben de aquí, de modo que no pueden volver a divergir (cierra
 * MOT-12: rangos incoherentes entre asistente y motor).
 *
 * Contrato:
 * - `error`  = imposible o inviable: bloquea.
 * - `warning`= improbable o arriesgado: se AVISA al usuario, nunca se corrige
 *   en silencio (cierra la familia del clamp C-1..C-3 y B9).
 * - Los mensajes son códigos (`Issue.code`) + parámetros: el core no contiene
 *   literales visibles; la UI los traduce vía i18n.
 * - Un `sex` no reconocido es SIEMPRE error (cierra MOT-06: sexo desconocido
 *   desactivaba la validación de grasa).
 */

import {
    ESSENTIAL_FAT_PCT,
    MIN_SAFE_FAT_PCT,
    MAX_FAT_PCT,
    ABSOLUTE_MAX_FAT_PCT,
    ACTIVITY_MULTIPLIERS,
    MUSCLE_GAIN_RATES_PCT_BW_MONTH,
    TARGET_MUSCLE_GAIN_LIMITS
} from './constants.js';

/**
 * @typedef {{ code: string, params?: Record<string, string | number> }} Issue
 * @typedef {{ errors: Issue[], warnings: Issue[] }} CheckResult
 */

/** Límites duros y blandos, en un solo objeto consultable (UI incluida). */
export const LIMITS = Object.freeze({
    age: Object.freeze({ min: 14, max: 90, warnBelow: 18, warnAbove: 75 }),
    heightCm: Object.freeze({ min: 120, max: 230 }),
    weightKg: Object.freeze({ min: 30, max: 300 }),
    /** Cuota de músculo sobre masa magra (ambas rutas de muscleSource). */
    muscleShareOfLean: Object.freeze({ min: 0.2, max: 0.8, warnBelow: 0.35, warnAbove: 0.65 }),
    fatPct: Object.freeze({
        essential: ESSENTIAL_FAT_PCT,
        minSafe: MIN_SAFE_FAT_PCT,
        max: MAX_FAT_PCT,
        absoluteMax: ABSOLUTE_MAX_FAT_PCT
    }),
    /** Umbrales del objetivo de músculo. El asistente lee `noGainKg` de aquí. */
    targetMuscleGain: TARGET_MUSCLE_GAIN_LIMITS
});

/**
 * @param {unknown} v
 * @returns {v is number}
 */
function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param {unknown} sex
 * @returns {sex is 'male' | 'female'}
 */
export function isValidSex(sex) {
    return sex === 'male' || sex === 'female';
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
function isPlainInput(v) {
    return v !== null && typeof v === 'object';
}

/**
 * Valida el perfil (sexo, edad, altura, actividad, estado de entrenamiento).
 * Entrada no-objeto (null, undefined, primitivos) → error, jamás excepción.
 * @param {{ sex?: unknown, age?: unknown, heightCm?: unknown, activityLevel?: unknown, trainingStatus?: unknown } | null | undefined} profile
 * @returns {CheckResult}
 */
export function checkProfile(profile) {
    /** @type {Issue[]} */ const errors = [];
    /** @type {Issue[]} */ const warnings = [];

    if (!isPlainInput(profile)) {
        return { errors: [{ code: 'profile.inputInvalid' }], warnings };
    }
    if (!isValidSex(profile.sex)) {
        errors.push({ code: 'profile.sexUnknown' });
    }
    if (!isFiniteNumber(profile.age)) {
        errors.push({ code: 'profile.ageMissing' });
    } else if (profile.age < LIMITS.age.min || profile.age > LIMITS.age.max) {
        errors.push({ code: 'profile.ageOutOfRange', params: { min: LIMITS.age.min, max: LIMITS.age.max } });
    } else if (profile.age < LIMITS.age.warnBelow) {
        warnings.push({ code: 'profile.ageYoung', params: { age: profile.age } });
    } else if (profile.age > LIMITS.age.warnAbove) {
        warnings.push({ code: 'profile.ageSenior', params: { age: profile.age } });
    }
    if (!isFiniteNumber(profile.heightCm)) {
        errors.push({ code: 'profile.heightMissing' });
    } else if (profile.heightCm < LIMITS.heightCm.min || profile.heightCm > LIMITS.heightCm.max) {
        errors.push({ code: 'profile.heightOutOfRange', params: { min: LIMITS.heightCm.min, max: LIMITS.heightCm.max } });
    }
    if (typeof profile.activityLevel !== 'string' || !Object.hasOwn(ACTIVITY_MULTIPLIERS, profile.activityLevel)) {
        errors.push({ code: 'profile.activityUnknown' });
    }
    if (typeof profile.trainingStatus !== 'string' || !Object.hasOwn(MUSCLE_GAIN_RATES_PCT_BW_MONTH, profile.trainingStatus)) {
        errors.push({ code: 'profile.trainingStatusUnknown' });
    }
    return { errors, warnings };
}

/**
 * Valida una composición MEDIDA (peso, %grasa y músculo si lo hay).
 * `context: 'measurement'` — una medición fuera del rango "sano" es AVISO
 * (no puedes cambiar tu realidad); solo lo inviable es error. Cierra MOT-11.
 * @param {{ weightKg?: unknown, fatPct?: unknown, muscleKg?: unknown }} input
 * @param {'male' | 'female'} sex
 * @returns {CheckResult}
 */
export function checkComposition(input, sex) {
    /** @type {Issue[]} */ const errors = [];
    /** @type {Issue[]} */ const warnings = [];

    if (!isValidSex(sex)) {
        return { errors: [{ code: 'profile.sexUnknown' }], warnings };
    }
    if (!isPlainInput(input)) {
        return { errors: [{ code: 'composition.inputInvalid' }], warnings };
    }
    const { weightKg, fatPct, muscleKg } = input;

    if (!isFiniteNumber(weightKg)) {
        errors.push({ code: 'composition.weightMissing' });
    } else if (weightKg < LIMITS.weightKg.min || weightKg > LIMITS.weightKg.max) {
        errors.push({ code: 'composition.weightOutOfRange', params: { min: LIMITS.weightKg.min, max: LIMITS.weightKg.max } });
    }

    if (!isFiniteNumber(fatPct)) {
        errors.push({ code: 'composition.fatMissing' });
    } else if (fatPct < ESSENTIAL_FAT_PCT[sex]) {
        errors.push({ code: 'composition.fatBelowEssential', params: { min: ESSENTIAL_FAT_PCT[sex] } });
    } else if (fatPct > ABSOLUTE_MAX_FAT_PCT) {
        errors.push({ code: 'composition.fatAboveAbsoluteMax', params: { max: ABSOLUTE_MAX_FAT_PCT } });
    } else if (fatPct < MIN_SAFE_FAT_PCT[sex]) {
        warnings.push({ code: 'composition.fatBelowSafe', params: { min: MIN_SAFE_FAT_PCT[sex] } });
    } else if (fatPct > MAX_FAT_PCT[sex]) {
        warnings.push({ code: 'composition.fatAboveModelMax', params: { max: MAX_FAT_PCT[sex] } });
    }

    if (muscleKg !== undefined && muscleKg !== null) {
        if (!isFiniteNumber(muscleKg) || muscleKg <= 0) {
            errors.push({ code: 'composition.muscleInvalid' });
        } else if (isFiniteNumber(weightKg) && isFiniteNumber(fatPct)) {
            const leanKg = weightKg * (1 - fatPct / 100);
            const share = muscleKg / leanKg;
            if (muscleKg >= leanKg) {
                errors.push({ code: 'composition.muscleExceedsLean', params: { leanKg: round1(leanKg) } });
            } else if (share < LIMITS.muscleShareOfLean.min || share > LIMITS.muscleShareOfLean.max) {
                errors.push({ code: 'composition.muscleShareImplausible', params: { sharePct: Math.round(share * 100) } });
            } else if (share < LIMITS.muscleShareOfLean.warnBelow || share > LIMITS.muscleShareOfLean.warnAbove) {
                // AVISO relativo a la masa magra, jamás corrección (B9, anti C-1)
                warnings.push({ code: 'composition.muscleShareUnusual', params: { sharePct: Math.round(share * 100) } });
            }
        }
    }
    return { errors, warnings };
}

/**
 * Valida un OBJETIVO contra la composición inicial.
 * `context: 'target'` — un objetivo insostenible es error o aviso serio según
 * el umbral (distinción medición/objetivo que el legacy no hacía).
 * @param {{ weightKg: number, fatPct: number, muscleKg: number, leanKg: number }} initial composición inicial ya validada
 * @param {{ fatPct?: unknown, muscleKg?: unknown }} target
 * @param {'male' | 'female'} sex
 * @returns {CheckResult}
 */
export function checkTarget(initial, target, sex) {
    /** @type {Issue[]} */ const errors = [];
    /** @type {Issue[]} */ const warnings = [];

    if (!isValidSex(sex)) {
        return { errors: [{ code: 'profile.sexUnknown' }], warnings };
    }
    if (!isPlainInput(initial) || !isFiniteNumber(initial.muscleKg) || initial.muscleKg <= 0) {
        return { errors: [{ code: 'target.initialInvalid' }], warnings };
    }
    if (!isPlainInput(target)) {
        return { errors: [{ code: 'target.inputInvalid' }], warnings };
    }
    const { fatPct, muscleKg } = target;

    if (!isFiniteNumber(fatPct)) {
        errors.push({ code: 'target.fatMissing' });
    } else if (fatPct < MIN_SAFE_FAT_PCT[sex]) {
        // objetivo sostenido bajo el mínimo seguro: bloquea (no es una medición)
        errors.push({ code: 'target.fatBelowSafe', params: { min: MIN_SAFE_FAT_PCT[sex] } });
    } else if (fatPct > ABSOLUTE_MAX_FAT_PCT) {
        // un objetivo por encima del techo absoluto es error, no aviso: el
        // modelo no puede proyectar hacia ahí (y el peso objetivo se dispara)
        errors.push({ code: 'target.fatAboveAbsoluteMax', params: { max: ABSOLUTE_MAX_FAT_PCT } });
    } else if (fatPct > MAX_FAT_PCT[sex]) {
        warnings.push({ code: 'target.fatAboveModelMax', params: { max: MAX_FAT_PCT[sex] } });
    }

    if (!isFiniteNumber(muscleKg) || muscleKg <= 0) {
        errors.push({ code: 'target.muscleMissing' });
    } else {
        // AMBAS cifras son músculo esquelético. Si el usuario introdujo un
        // objetivo en unidades de su báscula, la UI ya lo tradujo antes de
        // llegar aquí (`src/ui/muscle-units.js`); comparar una cifra de
        // báscula con `initial.muscleKg` daría un delta absurdo — es el fallo
        // que bloqueó un objetivo perfectamente alcanzable (E11).
        const deltaKg = muscleKg - initial.muscleKg;
        const deltaPct = (deltaKg / initial.muscleKg) * 100;
        if (deltaPct > TARGET_MUSCLE_GAIN_LIMITS.implausiblePct) {
            errors.push({ code: 'target.muscleGainImplausible', params: { deltaKg: round1(deltaKg) } });
        } else if (deltaPct > TARGET_MUSCLE_GAIN_LIMITS.ambitiousPct) {
            warnings.push({ code: 'target.muscleGainAmbitious', params: { deltaKg: round1(deltaKg) } });
        } else if (deltaKg < 0) {
            warnings.push({ code: 'target.muscleLoss', params: { deltaKg: round1(Math.abs(deltaKg)) } });
        } else if (deltaKg < TARGET_MUSCLE_GAIN_LIMITS.noGainKg) {
            // El objetivo no gana nada: el plan proyectará una línea plana y la
            // gráfica autoescalará el eje sobre el ruido de la báscula, de modo
            // que 0,4 kg de oscilación se leen como un desplome. Medido en
            // producción con un perfil real: 32,487 → 32,500 kg en 155 días.
            //
            // Se AVISA, no se corrige (B9): el objetivo es del usuario. Y se
            // avisa desde AQUÍ y no desde el asistente porque los warnings
            // viajan en `plan.warnings`, que Hoy ya pinta en cada arranque: así
            // lo ve también quien creó su perfil antes de que esto existiera.
            //
            // En gramos y no en kilos a propósito: `round1(0.013)` es «0,0 kg»,
            // que no dice nada. «13 g» sí.
            warnings.push({ code: 'target.muscleNoGain', params: { grams: Math.round(deltaKg * 1000) } });
        }
    }
    return { errors, warnings };
}

/** @param {number} n @returns {number} */
function round1(n) {
    return Math.round(n * 10) / 10;
}

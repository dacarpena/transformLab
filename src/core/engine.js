// @ts-check

/**
 * Motor científico v2 — composición, energía y planificación de fases.
 * Puro: sin DOM, sin window, sin efectos; importable desde node:test.
 *
 * Diseño contra el catálogo de defectos del legacy:
 * - Dos rutas explícitas de composición por `muscleSource` (A3), sin ningún
 *   clamp absoluto en kg (C-1..C-3): los límites viven en ranges.js como avisos.
 * - Déficit calórico DERIVADO de la Δgrasa esperada vía 7 700 kcal/kg (B3),
 *   con suelo max(BMR, 1200♀/1500♁) que alarga la fase si recorta (B2).
 * - Planificador con acumulador de cierre exacto: cero restas mágicas (MOT-08).
 * - Entradas no finitas → {ok:false} con Issues, jamás NaN aguas abajo (C-5).
 */

import {
    ACTIVITY_MULTIPLIERS,
    FAT_LOSS_RATES_PCT_BW_WEEK,
    MUSCLE_GAIN_RATES_PCT_BW_MONTH,
    FEMALE_MUSCLE_GAIN_FACTOR,
    SMM_OF_LEAN_RATIO,
    KCAL_PER_KG_FAT,
    KCAL_PER_KG_MUSCLE,
    CALORIC_FLOOR_KCAL,
    RECOMP,
    CUT_MUSCLE_LOSS_PER_KG_FAT,
    BULK_FAT_PER_KG_MUSCLE,
    PHASE_DURATIONS,
    METABOLIC_ADAPTATION
} from './constants.js';
import { checkComposition, checkTarget, checkProfile, isValidSex } from './ranges.js';

/**
 * @typedef {import('./ranges.js').Issue} Issue
 *
 * @typedef {Object} UserProfile
 * @property {'male' | 'female'} sex
 * @property {number} age años
 * @property {number} heightCm
 * @property {'sedentary'|'light'|'moderate'|'active'|'veryActive'} activityLevel
 * @property {'beginner'|'intermediate'|'advanced'} trainingStatus
 *
 * @typedef {Object} Composition
 * @property {number} weightKg
 * @property {number} fatPct 0–100
 * @property {number} fatKg
 * @property {number} leanKg masa magra = peso − grasa
 * @property {number} muscleKg músculo esquelético
 * @property {number} otherLeanKg magra no muscular (hueso, órganos, agua)
 * @property {'measured' | 'estimated'} muscleSource origen del dato de músculo (A3)
 * @property {'male' | 'female'} sex
 *
 * @typedef {'adaptation'|'recomposition'|'cut'|'bulk'|'transition'|'maintenance'} PhaseType
 *
 * @typedef {Object} PhaseKcal
 * @property {number} targetKcal objetivo diario nominal de la fase
 * @property {number} deficitKcal positivo = déficit, negativo = superávit
 * @property {number} tdeeKcal TDEE nominal usado (a peso medio de fase)
 * @property {boolean} flooredBySafety el suelo de seguridad recortó el déficit (B2)
 *
 * @typedef {Object} Phase
 * @property {PhaseType} type
 * @property {number} days ≥ 1
 * @property {{ fatDeltaKg: number, muscleDeltaKg: number }} expected negativo = pérdida
 * @property {PhaseKcal} nominalKcal
 *
 * @typedef {Object} PhasePlan
 * @property {Phase[]} phases
 * @property {number} totalDays
 * @property {{ targetWeightKg: number, fatDeltaKg: number, muscleDeltaKg: number }} summary
 * @property {Issue[]} warnings
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T, warnings: Issue[] } | { ok: false, errors: Issue[] }} EngineResult
 */

/** Umbral bajo el cual una diferencia de kg se considera «ya en objetivo». */
const CLOSE_ENOUGH_KG = 0.15;

/** @param {unknown} v @returns {v is number} */
function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

// ============================================================
// Composición (M1-4)
// ============================================================

/**
 * Construye una composición corporal validada con origen del músculo marcado.
 * Ruta `estimated` (sin dato de músculo): proporción músculo/magra por sexo
 * (Janssen 2000), SIN clamp. Ruta `measured`: el dato del usuario se respeta
 * intacto; lo implausible genera aviso, nunca corrección (B9).
 * @param {{ weightKg: number, fatPct: number, muscleKg?: number | null, sex: 'male' | 'female', muscleSource?: 'measured' | 'estimated' }} input
 * @returns {EngineResult<Composition>}
 */
export function makeComposition(input) {
    const { weightKg, fatPct, sex } = input;
    if (!isValidSex(sex)) return { ok: false, errors: [{ code: 'profile.sexUnknown' }] };

    const provided = input.muscleKg !== undefined && input.muscleKg !== null;
    const check = checkComposition(
        { weightKg, fatPct, muscleKg: provided ? input.muscleKg : undefined },
        sex
    );
    if (check.errors.length > 0) return { ok: false, errors: check.errors };

    const fatKg = weightKg * (fatPct / 100);
    const leanKg = weightKg - fatKg;
    const muscleKg = provided
        ? /** @type {number} */ (input.muscleKg)
        : leanKg * SMM_OF_LEAN_RATIO[sex];
    const muscleSource = provided ? (input.muscleSource ?? 'measured') : 'estimated';

    return {
        ok: true,
        value: { weightKg, fatPct, fatKg, leanKg, muscleKg, otherLeanKg: leanKg - muscleKg, muscleSource, sex },
        warnings: check.warnings
    };
}

/**
 * Peso corporal que corresponde a una composición objetivo.
 *
 * Premisa física única para AMBAS rutas de `muscleSource`: el tejido magro no
 * muscular (hueso, órganos, agua estructural) se CONSERVA — ganar o perder
 * músculo esquelético no lo altera de forma apreciable. Con ella, la identidad
 * es exacta por construcción (objetivo = composición actual ⇒ peso actual),
 * y el plan, la serie diaria y este cálculo cuadran entre sí al miligramo:
 * lo que difiere entre rutas es CÓMO se obtuvo `muscleKg`/`otherLeanKg`
 * (medido vs estimado por proporción), no el álgebra del objetivo.
 * Sin clamps (anti C-1..C-3): lo implausible se avisa en ranges.js.
 * Entradas inválidas → NaN (los llamantes validan con isFinite).
 * @param {number} targetMuscleKg
 * @param {number} targetFatPct
 * @param {Composition} current
 * @returns {number}
 */
export function targetWeightKg(targetMuscleKg, targetFatPct, current) {
    if (!isFiniteNumber(targetMuscleKg) || targetMuscleKg <= 0) return NaN;
    if (!isFiniteNumber(targetFatPct) || targetFatPct <= 0 || targetFatPct >= 100) return NaN;
    if (!current || !isFiniteNumber(current.otherLeanKg) || current.otherLeanKg < 0) return NaN;

    const targetLeanKg = targetMuscleKg + current.otherLeanKg;
    return targetLeanKg / (1 - targetFatPct / 100);
}

// ============================================================
// Energía (M1-5)
// ============================================================

/**
 * BMR por Mifflin-St Jeor (1990), redondeado en origen.
 * @param {Pick<UserProfile, 'sex' | 'age' | 'heightCm'>} profile
 * @param {number} weightKg
 * @returns {number} kcal/día
 */
export function bmr(profile, weightKg) {
    if (!isValidSex(profile.sex) || !isFiniteNumber(weightKg) || !isFiniteNumber(profile.heightCm) || !isFiniteNumber(profile.age)) return NaN;
    const base = 10 * weightKg + 6.25 * profile.heightCm - 5 * profile.age;
    return Math.round(profile.sex === 'male' ? base + 5 : base - 161);
}

/**
 * TDEE = BMR × multiplicador de actividad. Nivel desconocido → NaN
 * (nada de defaults silenciosos: ranges.js lo habrá bloqueado antes).
 * @param {number} bmrKcal
 * @param {UserProfile['activityLevel']} activityLevel
 * @returns {number} kcal/día
 */
export function tdee(bmrKcal, activityLevel) {
    const mult = ACTIVITY_MULTIPLIERS[activityLevel];
    if (mult === undefined || !isFiniteNumber(bmrKcal)) return NaN;
    return Math.round(bmrKcal * mult);
}

/**
 * Objetivo calórico diario DERIVADO del cambio de composición esperado (B3):
 * objetivo = TDEE + Δgrasa·7700 + Δmúsculo·2500, con suelo de seguridad
 * max(BMR, 1200♀/1500♂) (B2). Si el suelo recorta, `flooredBySafety` avisa al
 * planificador para que alargue la fase.
 * @param {{ tdeeKcal: number, bmrKcal: number, sex: 'male' | 'female', dailyFatDeltaKg: number, dailyMuscleDeltaKg: number }} input
 * @returns {{ targetKcal: number, deficitKcal: number, tdeeKcal: number, flooredBySafety: boolean }}
 */
export function caloricTarget(input) {
    const { tdeeKcal, bmrKcal, sex, dailyFatDeltaKg, dailyMuscleDeltaKg } = input;
    const dailyEnergyDelta = dailyFatDeltaKg * KCAL_PER_KG_FAT + dailyMuscleDeltaKg * KCAL_PER_KG_MUSCLE;
    const rawTarget = tdeeKcal + dailyEnergyDelta;
    const floor = Math.max(bmrKcal, CALORIC_FLOOR_KCAL[sex]);

    if (rawTarget < floor) {
        return { targetKcal: Math.round(floor), deficitKcal: Math.round(tdeeKcal - floor), tdeeKcal, flooredBySafety: true };
    }
    const target = Math.round(rawTarget);
    return { targetKcal: target, deficitKcal: Math.round(tdeeKcal) - target, tdeeKcal, flooredBySafety: false };
}

/**
 * Pérdida de grasa semanal segura, relativa al peso (Aragon 2017).
 * Intensidad desconocida → NaN (mata la propagación silenciosa de MOT-13).
 * @param {number} weightKg
 * @param {'conservative'|'moderate'|'aggressive'} intensity
 * @returns {number} kg/semana
 */
export function weeklyFatLossKg(weightKg, intensity) {
    const rate = FAT_LOSS_RATES_PCT_BW_WEEK[intensity];
    if (rate === undefined || !isFiniteNumber(weightKg)) return NaN;
    return weightKg * rate;
}

/**
 * Ganancia muscular mensual esperada, relativa al peso corporal con factor por
 * sexo (B6; McDonald 2008 / Helms 2014 reexpresadas en %PC).
 * @param {number} weightKg
 * @param {UserProfile['trainingStatus']} trainingStatus
 * @param {'male' | 'female'} sex
 * @param {'min' | 'avg' | 'max'} [bound]
 * @returns {number} kg/mes
 */
export function monthlyMuscleGainKg(weightKg, trainingStatus, sex, bound = 'avg') {
    const rates = MUSCLE_GAIN_RATES_PCT_BW_MONTH[trainingStatus];
    if (rates === undefined || !isFiniteNumber(weightKg) || !isValidSex(sex)) return NaN;
    const factor = sex === 'female' ? FEMALE_MUSCLE_GAIN_FACTOR : 1;
    return weightKg * rates[bound] * factor;
}

// ============================================================
// Planificador de fases (M1-6)
// ============================================================

/**
 * Estado mutable interno del plan en construcción. `acc` acumula las
 * expectativas ya asignadas a fases: el cierre exacto sale de comparar el
 * acumulador con el objetivo total, no de constantes mágicas (MOT-08).
 */
class PlanBuilder {
    /**
     * @param {Composition} initial
     * @param {{ fatDeltaKg: number, muscleDeltaKg: number }} totals
     * @param {UserProfile} profile
     */
    constructor(initial, totals, profile) {
        this.initial = initial;
        this.totals = totals;
        this.profile = profile;
        this.acc = { fat: 0, muscle: 0 };
        /** @type {Array<{type: PhaseType, days: number, fatDeltaKg: number, muscleDeltaKg: number}>} */
        this.phases = [];
    }

    /** Peso corporal proyectado con lo acumulado hasta ahora. */
    currentWeightKg() {
        return this.initial.weightKg + this.acc.fat + this.acc.muscle;
    }

    remainingFat() {
        return this.totals.fatDeltaKg - this.acc.fat;
    }

    remainingMuscle() {
        return this.totals.muscleDeltaKg - this.acc.muscle;
    }

    /**
     * @param {PhaseType} type
     * @param {number} days
     * @param {number} fatDeltaKg
     * @param {number} muscleDeltaKg
     */
    push(type, days, fatDeltaKg, muscleDeltaKg) {
        if (days < 1) return;
        this.phases.push({ type, days: Math.round(days), fatDeltaKg, muscleDeltaKg });
        this.acc.fat += fatDeltaKg;
        this.acc.muscle += muscleDeltaKg;
    }
}

/**
 * Construye el plan de fases completo. Las expectativas por fase suman
 * exactamente el objetivo (invariante `cierre_de_plan`); la duración de la
 * definición integra la tasa sobre el peso DECRECIENTE día a día (MOT-16);
 * la recomposición tiene duración derivada (MOT-18) y déficit real (MOT-04);
 * existen ramas explícitas para «ya en objetivo» y «perder músculo» (MOT-10).
 * @param {Composition} initial
 * @param {{ fatPct: number, muscleKg: number }} target
 * @param {UserProfile} profile
 * @param {{ intensity?: 'conservative'|'moderate'|'aggressive' }} [options]
 * @returns {EngineResult<PhasePlan>}
 */
export function planPhases(initial, target, profile, options = {}) {
    /** @type {Issue[]} */ const warnings = [];
    const intensity = options.intensity ?? 'moderate';

    // ---- validación de entrada (C-5: nada no finito pasa de aquí) ----
    const profileCheck = checkProfile(profile);
    if (profileCheck.errors.length > 0) return { ok: false, errors: profileCheck.errors };
    warnings.push(...profileCheck.warnings);

    if (!initial || !isFiniteNumber(initial.weightKg) || !isFiniteNumber(initial.fatKg) || !isFiniteNumber(initial.muscleKg) || initial.muscleKg <= 0) {
        return { ok: false, errors: [{ code: 'plan.initialInvalid' }] };
    }
    const targetCheck = checkTarget(initial, target ?? {}, profile.sex);
    if (targetCheck.errors.length > 0) return { ok: false, errors: targetCheck.errors };
    warnings.push(...targetCheck.warnings);

    const finalWeightKg = targetWeightKg(target.muscleKg, target.fatPct, initial);
    if (!isFiniteNumber(finalWeightKg)) {
        return { ok: false, errors: [{ code: 'plan.targetUnreachable' }] };
    }

    const totals = {
        fatDeltaKg: finalWeightKg * (target.fatPct / 100) - initial.fatKg,
        muscleDeltaKg: target.muscleKg - initial.muscleKg
    };
    const b = new PlanBuilder(initial, totals, profile);

    const needsFatLoss = totals.fatDeltaKg < -CLOSE_ENOUGH_KG;
    const needsFatGain = totals.fatDeltaKg > CLOSE_ENOUGH_KG;
    const needsMuscleGain = totals.muscleDeltaKg > CLOSE_ENOUGH_KG;
    const needsMuscleLoss = totals.muscleDeltaKg < -CLOSE_ENOUGH_KG;
    const anyChange = needsFatLoss || needsFatGain || needsMuscleGain || needsMuscleLoss;

    const { adaptationDays, transitionDays, maintenanceDays } = PHASE_DURATIONS;

    if (!anyChange) {
        // ---- rama «ya estás en el objetivo» (MOT-10): plan honesto, sin humo ----
        warnings.push({ code: 'plan.alreadyAtTarget' });
        b.push('maintenance', maintenanceDays, 0, 0);
        return finishPlan(b, finalWeightKg, warnings, profile, intensity);
    }

    // ---- adaptación: dos semanas de arranque suave hacia el objetivo ----
    {
        const adaptFat = needsFatLoss
            ? -Math.min(Math.abs(b.remainingFat()), weeklyFatLossKg(initial.weightKg, intensity) * (adaptationDays / 7) * 0.5)
            : 0;
        const adaptMuscle = needsMuscleGain
            ? Math.min(b.remainingMuscle(), monthlyMuscleGainKg(initial.weightKg, profile.trainingStatus, profile.sex) * (adaptationDays / 30) * 0.5)
            : 0;
        b.push('adaptation', adaptationDays, adaptFat, adaptMuscle);
    }

    // ---- recomposición: si toca perder grasa Y ganar músculo en la ventana ----
    const [winLo, winHi] = RECOMP.fatPctWindow[profile.sex];
    if (needsFatLoss && needsMuscleGain && initial.fatPct >= winLo && initial.fatPct <= winHi) {
        const w = b.currentWeightKg();
        const dailyFat = -(weeklyFatLossKg(w, intensity) * RECOMP.fatLossFactor) / 7;
        const dailyMuscle = (monthlyMuscleGainKg(w, profile.trainingStatus, profile.sex) * RECOMP.muscleGainFactor) / 30;
        const daysToFat = Math.abs(b.remainingFat() / dailyFat);
        const daysToMuscle = b.remainingMuscle() / dailyMuscle;
        const days = Math.floor(Math.min(daysToFat, daysToMuscle, RECOMP.maxDays));
        if (days >= 7) {
            b.push('recomposition', days, dailyFat * days, dailyMuscle * days);
        }
    }

    // ---- definición: día a día sobre peso decreciente (MOT-16) ----
    const runCut = (/** @type {number} */ fatToLose, /** @type {number} */ deliberateMuscleLoss) => {
        let w = b.currentWeightKg();
        let fat = 0;
        let muscle = 0;
        let days = 0;
        const muscleLossPerDay = deliberateMuscleLoss > 0 && fatToLose > 0
            ? 0 // la pérdida deliberada se gestiona en su propia rama
            : 0;
        void muscleLossPerDay;
        while (fat > -fatToLose && days < 1500) {
            const dailyFat = weeklyFatLossKg(w, intensity) / 7;
            const dailyMuscle = dailyFat * CUT_MUSCLE_LOSS_PER_KG_FAT;
            fat -= dailyFat;
            muscle -= dailyMuscle;
            w -= dailyFat + dailyMuscle;
            days++;
        }
        if (days > 0) b.push('cut', days, fat, muscle);
    };

    if (needsFatLoss && b.remainingFat() < -CLOSE_ENOUGH_KG) {
        runCut(Math.abs(b.remainingFat()), 0);
    }

    // ---- pérdida deliberada de músculo (MOT-10, rama explícita) ----
    if (needsMuscleLoss && b.remainingMuscle() < -CLOSE_ENOUGH_KG) {
        const w = b.currentWeightKg();
        // aprox. documentada: el músculo se pierde en déficit al ritmo al que se ganaría
        const monthlyLoss = monthlyMuscleGainKg(w, profile.trainingStatus, profile.sex);
        const toLose = Math.abs(b.remainingMuscle());
        const days = Math.max(7, Math.ceil((toLose / monthlyLoss) * 30));
        b.push('cut', days, 0, -toLose);
    }

    // ---- ganancia deliberada de grasa (bajo peso; aprox. documentada) ----
    if (needsFatGain && b.remainingFat() > CLOSE_ENOUGH_KG) {
        const w = b.currentWeightKg();
        const dailyFatGain = (w * 0.0025) / 7; // ~0,25 % PC/semana: superávit conservador
        const toGain = b.remainingFat();
        const days = Math.max(7, Math.ceil(toGain / dailyFatGain));
        b.push('bulk', days, toGain, 0);
    }

    // ---- volumen: día a día sobre peso creciente, con grasa acompañante ----
    if (needsMuscleGain && b.remainingMuscle() > CLOSE_ENOUGH_KG) {
        let w = b.currentWeightKg();
        let muscle = 0;
        let fat = 0;
        let days = 0;
        const goal = b.remainingMuscle();
        while (muscle < goal && days < 1500) {
            const dailyMuscle = monthlyMuscleGainKg(w, profile.trainingStatus, profile.sex) / 30;
            const dailyFat = dailyMuscle * BULK_FAT_PER_KG_MUSCLE;
            muscle += dailyMuscle;
            fat += dailyFat;
            w += dailyMuscle + dailyFat;
            days++;
        }
        if (days > 0) b.push('bulk', days, fat, muscle);

        // la grasa ganada en volumen se retira en una definición corta final
        if (b.remainingFat() < -CLOSE_ENOUGH_KG) {
            runCut(Math.abs(b.remainingFat()), 0);
        }
    }

    // ---- cierre exacto: el residuo (fracciones de día, 2.º orden) se asigna
    //      a la última fase corporal. Sustituye a las restas mágicas (MOT-08).
    {
        const residualFat = b.remainingFat();
        const residualMuscle = b.remainingMuscle();
        const lastBody = [...b.phases].reverse().find((p) => p.type !== 'adaptation');
        if (lastBody && (Math.abs(residualFat) > 1e-12 || Math.abs(residualMuscle) > 1e-12)) {
            if (Math.abs(residualFat) > 0.5 || Math.abs(residualMuscle) > 0.5) {
                // nunca debería ocurrir: el residuo es fraccional por construcción
                return { ok: false, errors: [{ code: 'plan.closureFailed', params: { fat: residualFat, muscle: residualMuscle } }] };
            }
            lastBody.fatDeltaKg += residualFat;
            lastBody.muscleDeltaKg += residualMuscle;
            b.acc.fat += residualFat;
            b.acc.muscle += residualMuscle;
        }
    }

    // ---- transición y mantenimiento (decisión de producto) ----
    b.push('transition', transitionDays, 0, 0);
    b.push('maintenance', maintenanceDays, 0, 0);

    return finishPlan(b, finalWeightKg, warnings, profile, intensity);
}

/**
 * Un paso semanal del nivel de adaptación metabólica (B4, Trexler aprox.):
 * el nivel persigue un objetivo proporcional a la severidad del déficit
 * (déficit diario / (fracción de referencia × TDEE)), avanzando a
 * `onsetPerWeek` y recuperándose a `recoveryPerWeek`. Compartido por el
 * planificador y el generador para que ambos cuenten la misma historia.
 * @param {number} level nivel actual [0, maxReduction]
 * @param {number} dailyDeficitKcal déficit diario en curso (≥ 0)
 * @param {number} baseTdeeKcal TDEE sin adaptar
 * @returns {number} nuevo nivel
 */
export function adaptationStep(level, dailyDeficitKcal, baseTdeeKcal) {
    const { maxReduction, onsetPerWeek, recoveryPerWeek, severityDeficitFraction } = METABOLIC_ADAPTATION;
    const severity = dailyDeficitKcal > 0 && baseTdeeKcal > 0
        ? Math.min(1, dailyDeficitKcal / (severityDeficitFraction * baseTdeeKcal))
        : 0;
    const target = maxReduction * severity;
    if (level < target) return Math.min(target, level + onsetPerWeek);
    return Math.max(target, level - recoveryPerWeek);
}

/**
 * Días necesarios para entregar `totalEnergyKcal` (negativo) de déficit sin
 * perforar el suelo de seguridad, simulando semana a semana la adaptación
 * metabólica (B2 × B4): el TDEE se recalcula sobre el peso decreciente y la
 * adaptación persigue la severidad del déficit realmente ejecutado. Semanas
 * sin capacidad cuentan días sin entregar déficit (la adaptación se recupera
 * y la capacidad vuelve). Devuelve Infinity solo si no converge.
 * @param {UserProfile} profile
 * @param {number} startWeightKg
 * @param {number} totalEnergyKcal negativo
 * @param {number} nominalDays días que pedía la tasa nominal
 * @param {number} levelIn nivel de adaptación acumulado al entrar en la fase
 * @returns {{ days: number, levelOut: number }}
 */
function simulateDeficitDays(profile, startWeightKg, totalEnergyKcal, nominalDays, levelIn) {
    const floorSex = CALORIC_FLOOR_KCAL[profile.sex];
    const nominalDaily = totalEnergyKcal / nominalDays; // negativo
    let remaining = totalEnergyKcal;
    let w = startWeightKg;
    let level = levelIn;
    let prevDailyDeficit = 0;
    let days = 0;
    let guard = 0;
    while (remaining < -1e-9 && guard++ < 400) {
        const weekBmr = bmr(profile, w);
        const baseTdee = tdee(weekBmr, profile.activityLevel);
        level = adaptationStep(level, prevDailyDeficit, baseTdee);
        const adapted = Math.round(baseTdee * (1 - level));
        const capacity = adapted - Math.max(weekBmr, floorSex); // kcal/día de déficit disponible
        if (capacity <= 0) {
            days += 7;
            prevDailyDeficit = 0;
            continue;
        }
        const allowedDaily = Math.max(nominalDaily, -capacity); // el más cercano a 0
        const daysThisWeek = Math.min(7, Math.ceil(remaining / allowedDaily));
        remaining -= allowedDaily * daysThisWeek;
        w += (allowedDaily * daysThisWeek) / KCAL_PER_KG_FAT; // aprox.: el grueso del delta es grasa
        days += daysThisWeek;
        prevDailyDeficit = -allowedDaily;
    }
    if (remaining < -1e-9) return { days: Number.POSITIVE_INFINITY, levelOut: level };
    return { days, levelOut: level };
}

/**
 * Asigna el objetivo calórico nominal a cada fase (a peso medio de fase, con
 * el déficit derivado de sus deltas — B3) y alarga las fases de déficit que el
 * suelo de seguridad recorta, teniendo en cuenta la adaptación metabólica
 * acumulada (B2 × B4). Devuelve el plan cerrado.
 * @param {PlanBuilder} b
 * @param {number} finalWeightKg
 * @param {Issue[]} warnings
 * @param {UserProfile} profile
 * @param {'conservative'|'moderate'|'aggressive'} intensity
 * @returns {EngineResult<PhasePlan>}
 */
function finishPlan(b, finalWeightKg, warnings, profile, intensity) {
    void intensity;
    /** @type {Phase[]} */ const phases = [];
    let runningWeight = b.initial.weightKg;
    let floored = false;
    let adaptationLevel = 0;

    for (const p of b.phases) {
        const totalEnergyKcal = p.fatDeltaKg * KCAL_PER_KG_FAT + p.muscleDeltaKg * KCAL_PER_KG_MUSCLE;
        let days = p.days;

        if (totalEnergyKcal < 0) {
            const sim = simulateDeficitDays(profile, runningWeight, totalEnergyKcal, p.days, adaptationLevel);
            if (!Number.isFinite(sim.days)) {
                return { ok: false, errors: [{ code: 'plan.deficitInfeasible', params: { phase: p.type } }] };
            }
            if (sim.days > days) {
                days = sim.days;
                floored = true;
            }
            adaptationLevel = sim.levelOut;
        } else {
            // fuera de déficit la adaptación se recupera (B4)
            adaptationLevel = Math.max(0, adaptationLevel - METABOLIC_ADAPTATION.recoveryPerWeek * (p.days / 7));
        }

        const midWeight = runningWeight + (p.fatDeltaKg + p.muscleDeltaKg) / 2;
        const phaseBmr = bmr(profile, midWeight);
        const phaseTdee = tdee(phaseBmr, profile.activityLevel);
        const kcal = caloricTarget({
            tdeeKcal: phaseTdee,
            bmrKcal: phaseBmr,
            sex: profile.sex,
            dailyFatDeltaKg: p.fatDeltaKg / days,
            dailyMuscleDeltaKg: p.muscleDeltaKg / days
        });

        phases.push({
            type: p.type,
            days,
            expected: { fatDeltaKg: p.fatDeltaKg, muscleDeltaKg: p.muscleDeltaKg },
            nominalKcal: { ...kcal, flooredBySafety: kcal.flooredBySafety || days > p.days }
        });
        runningWeight += p.fatDeltaKg + p.muscleDeltaKg;
    }

    if (floored) warnings.push({ code: 'plan.flooredBySafety' });

    return {
        ok: true,
        value: {
            phases,
            totalDays: phases.reduce((s, p) => s + p.days, 0),
            summary: {
                targetWeightKg: finalWeightKg,
                fatDeltaKg: b.totals.fatDeltaKg,
                muscleDeltaKg: b.totals.muscleDeltaKg
            },
            warnings
        },
        warnings
    };
}

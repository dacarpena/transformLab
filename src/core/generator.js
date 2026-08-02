// @ts-check

/**
 * Generador de la proyección: serie diaria, agregados, escenarios e hitos.
 * Puro: trabaja sobre los datos recibidos SIN mutarlos (GEN-06) y todas las
 * fechas son UTC de punta a punta (GEN-02/10). La aleatoriedad viene solo del
 * PRNG sembrado (B8): `Math.random` está prohibido en src/.
 *
 * Convención de la serie: `daily[0]` (dayIndex 0) es el estado inicial exacto
 * (cierra el off-by-one GEN-05) y `daily[totalDays]` aterriza exactamente en
 * el objetivo (invariante `determinismo`). La fluctuación visual se emite en
 * un campo separado (`fluctuationKg`) y JAMÁS altera la composición
 * (invariante `conservacion`).
 */

import {
    KCAL_PER_KG_FAT,
    KCAL_PER_KG_MUSCLE,
    METABOLIC_ADAPTATION,
    FLUCTUATION_AMPLITUDE_PCT_BW,
    SCENARIO_PROGRESS_EXPONENTS,
    MILESTONE_CATEGORIES
} from './constants.js';
import { bmr, tdee, caloricTarget } from './engine.js';
import { mulberry32 } from './rng.js';

/**
 * @typedef {import('./ranges.js').Issue} Issue
 * @typedef {import('./engine.js').Composition} Composition
 * @typedef {import('./engine.js').UserProfile} UserProfile
 * @typedef {import('./engine.js').PhasePlan} PhasePlan
 * @typedef {import('./engine.js').PhaseType} PhaseType
 *
 * @typedef {Object} DailyPoint
 * @property {number} dayIndex 0 = estado inicial; totalDays = objetivo
 * @property {string} dateISO 'YYYY-MM-DD' (UTC)
 * @property {PhaseType} phaseType
 * @property {number} weightKg escenario esperado, sin fluctuación
 * @property {number} fatPct
 * @property {number} fatKg
 * @property {number} leanKg
 * @property {number} muscleKg
 * @property {number} otherLeanKg constante durante todo el plan
 * @property {{ pessimistKg: number, optimistKg: number }} band banda de escenarios (B5)
 * @property {{ tdeeKcal: number, targetKcal: number, deficitKcal: number, flooredBySafety: boolean }} kcal
 * @property {number} fluctuationKg ruido visual determinista; 0 con el interruptor apagado
 *
 * @typedef {Object} WeeklyPoint
 * @property {number} weekIndex base 1
 * @property {string} startISO
 * @property {string} endISO
 * @property {boolean} partial semana incompleta al final del plan (GEN-07)
 * @property {PhaseType} phaseType fase del último día del bloque
 * @property {number} endWeightKg
 * @property {number} endFatPct
 * @property {number} endMuscleKg
 * @property {number} avgTargetKcal
 *
 * @typedef {Object} MonthlyPoint
 * @property {string} monthISO 'YYYY-MM' (mes de calendario, GEN-11)
 * @property {string} startISO
 * @property {string} endISO
 * @property {boolean} partial el plan no cubre el mes completo (GEN-12)
 * @property {PhaseType} phaseType fase del último día del bloque
 * @property {number} endWeightKg
 * @property {number} endFatPct
 * @property {number} endMuscleKg
 * @property {number} avgTargetKcal
 *
 * @typedef {Object} Milestone
 * @property {string} id único dentro de la proyección
 * @property {'fatPct' | 'muscleKg' | 'weightKg' | 'phase'} category
 * @property {number | string} threshold umbral cruzado, o tipo de fase
 * @property {number} dayIndex día del cruce real en la serie (GEN-03/04)
 * @property {string} dateISO
 *
 * @typedef {Object} Projection
 * @property {DailyPoint[]} daily totalDays + 1 puntos (incluye el día 0)
 * @property {WeeklyPoint[]} weekly
 * @property {MonthlyPoint[]} monthly
 * @property {Milestone[]} milestones
 * @property {boolean} scenariosClose los tres escenarios aterrizan en el objetivo
 * @property {Issue[]} warnings
 */

/** @param {unknown} v @returns {v is number} */
function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param {string} iso
 * @returns {{ y: number, m: number, d: number } | null}
 */
function parseISODate(iso) {
    if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
    return { y, m, d };
}

/**
 * Fecha ISO del día `offset` contando desde el inicio, en UTC puro:
 * inmune a cambios de horario de verano (GEN-02).
 * @param {{ y: number, m: number, d: number }} start
 * @param {number} offset días desde el inicio
 * @returns {string}
 */
function dateAt(start, offset) {
    return new Date(Date.UTC(start.y, start.m - 1, start.d + offset)).toISOString().slice(0, 10);
}

/**
 * Genera la proyección completa a partir de un plan cerrado.
 * @param {PhasePlan} plan
 * @param {Composition} initial
 * @param {UserProfile} profile
 * @param {{ startDateISO: string, seed: number, fluctuation?: boolean }} options
 * @returns {{ ok: true, value: Projection, warnings: Issue[] } | { ok: false, errors: Issue[] }}
 */
export function generateProjection(plan, initial, profile, options) {
    /** @type {Issue[]} */ const warnings = [];

    const start = parseISODate(options?.startDateISO);
    if (!start) return { ok: false, errors: [{ code: 'projection.startDateInvalid' }] };
    if (!isFiniteNumber(options.seed)) return { ok: false, errors: [{ code: 'projection.seedInvalid' }] };
    if (!plan || !Array.isArray(plan.phases) || plan.phases.length === 0) {
        return { ok: false, errors: [{ code: 'projection.planInvalid' }] };
    }
    if (!initial || !isFiniteNumber(initial.fatKg) || !isFiniteNumber(initial.muscleKg) || !isFiniteNumber(initial.otherLeanKg)) {
        return { ok: false, errors: [{ code: 'projection.initialInvalid' }] };
    }
    const fluctuationOn = options.fluctuation === true;
    const rng = mulberry32(options.seed >>> 0);

    // ---- estados de frontera de fase (acumulados desde el inicial) ----
    /** @type {Array<{ type: PhaseType, days: number, startFatKg: number, startMuscleKg: number, fatDeltaKg: number, muscleDeltaKg: number, startDayIndex: number }>} */
    const bounds = [];
    let accFat = initial.fatKg;
    let accMuscle = initial.muscleKg;
    let accDays = 0;
    for (const ph of plan.phases) {
        bounds.push({
            type: ph.type,
            days: ph.days,
            startFatKg: accFat,
            startMuscleKg: accMuscle,
            fatDeltaKg: ph.expected.fatDeltaKg,
            muscleDeltaKg: ph.expected.muscleDeltaKg,
            startDayIndex: accDays
        });
        accFat += ph.expected.fatDeltaKg;
        accMuscle += ph.expected.muscleDeltaKg;
        accDays += ph.days;
    }
    const totalDays = accDays;
    const otherLeanKg = initial.otherLeanKg;

    // ---- kcal por semana: TDEE recalculado sobre peso proyectado + adaptación (B4) ----
    /** @type {Map<number, { tdeeKcal: number, targetKcal: number, deficitKcal: number, flooredBySafety: boolean }>} */
    const weekKcal = new Map();
    let adaptationLevel = 0;

    /** Estado esperado (sin fluctuación) en un día dado. */
    const stateAt = (/** @type {number} */ dayIndex) => {
        if (dayIndex <= 0) {
            return { fatKg: initial.fatKg, muscleKg: initial.muscleKg, phase: bounds[0] };
        }
        const phase = bounds.find((p) => dayIndex <= p.startDayIndex + p.days) ?? bounds[bounds.length - 1];
        const frac = Math.min(1, (dayIndex - phase.startDayIndex) / phase.days);
        return {
            fatKg: phase.startFatKg + phase.fatDeltaKg * frac,
            muscleKg: phase.startMuscleKg + phase.muscleDeltaKg * frac,
            phase
        };
    };

    for (let week = 0; week * 7 <= totalDays; week++) {
        const weekStartDay = week * 7;
        const s = stateAt(weekStartDay);
        const weightAtStart = s.fatKg + s.muscleKg + otherLeanKg;
        const phase = s.phase;
        const dailyFat = phase.fatDeltaKg / phase.days;
        const dailyMuscle = phase.muscleDeltaKg / phase.days;
        const dailyEnergy = dailyFat * KCAL_PER_KG_FAT + dailyMuscle * KCAL_PER_KG_MUSCLE;

        // adaptación metabólica (Trexler, aprox.): avanza en semanas de déficit,
        // se recupera fuera de él
        const inDeficit = dailyEnergy < -25;
        if (week > 0) {
            adaptationLevel = inDeficit
                ? Math.min(METABOLIC_ADAPTATION.maxReduction, adaptationLevel + METABOLIC_ADAPTATION.onsetPerWeek)
                : Math.max(0, adaptationLevel - METABOLIC_ADAPTATION.recoveryPerWeek);
        }
        const weekBmr = bmr(profile, weightAtStart);
        const baseTdee = tdee(weekBmr, profile.activityLevel);
        const adaptedTdee = Math.round(baseTdee * (1 - adaptationLevel));
        weekKcal.set(week, caloricTarget({
            tdeeKcal: adaptedTdee,
            bmrKcal: weekBmr,
            sex: profile.sex,
            dailyFatDeltaKg: dailyFat,
            dailyMuscleDeltaKg: dailyMuscle
        }));
    }

    // ---- serie diaria (dos pasadas) ----
    // 1.ª: la trayectoria esperada. 2.ª: la banda de escenarios como RETRASO o
    // ADELANTO sobre esa misma trayectoria (B5): en el día d, el pesimista está
    // donde el plan esperado estaba en el día T·(d/T)^1.3 (≤ d) y el optimista
    // donde estará en T·(d/T)^0.78 (≥ d). Orden garantizado en posición de
    // plan, y los tres cierran en el objetivo porque en d = T las tres
    // posiciones coinciden.
    /** @type {DailyPoint[]} */ const daily = [];
    /** @type {number[]} */ const expectedWeights = [];

    for (let dayIndex = 0; dayIndex <= totalDays; dayIndex++) {
        const s = stateAt(dayIndex);
        expectedWeights.push(s.fatKg + s.muscleKg + otherLeanKg);
    }

    /** Peso esperado en una posición fraccionaria del plan (interp. lineal). */
    const weightAtPosition = (/** @type {number} */ pos) => {
        const clamped = Math.min(totalDays, Math.max(0, pos));
        const i0 = Math.floor(clamped);
        const frac = clamped - i0;
        if (i0 >= totalDays) return expectedWeights[totalDays];
        return expectedWeights[i0] + (expectedWeights[i0 + 1] - expectedWeights[i0]) * frac;
    };

    const expP = SCENARIO_PROGRESS_EXPONENTS.pessimist;
    const expO = SCENARIO_PROGRESS_EXPONENTS.optimist;

    for (let dayIndex = 0; dayIndex <= totalDays; dayIndex++) {
        const s = stateAt(dayIndex);
        const phase = s.phase;
        const fatKg = s.fatKg;
        const muscleKg = s.muscleKg;
        const weightKg = expectedWeights[dayIndex];
        const leanKg = weightKg - fatKg;

        const t = totalDays === 0 ? 1 : dayIndex / totalDays;
        const pessimistKg = weightAtPosition(totalDays * Math.pow(t, expP));
        const optimistKg = weightAtPosition(totalDays * Math.pow(t, expO));

        const kcal = weekKcal.get(Math.floor(Math.max(0, dayIndex - 1) / 7))
            ?? weekKcal.get(0)
            ?? { tdeeKcal: NaN, targetKcal: NaN, deficitKcal: NaN, flooredBySafety: false };

        // ruido visual determinista; se genera SIEMPRE para que la serie de
        // composición no dependa del interruptor (mismo consumo del PRNG)
        const noise = (rng() * 2 - 1) * FLUCTUATION_AMPLITUDE_PCT_BW * weightKg;
        const fluctuationKg = fluctuationOn ? noise : 0;

        daily.push({
            dayIndex,
            dateISO: dateAt(start, dayIndex),
            phaseType: phase.type,
            weightKg,
            fatPct: (fatKg / weightKg) * 100,
            fatKg,
            leanKg,
            muscleKg,
            otherLeanKg,
            band: { pessimistKg, optimistKg },
            kcal: { tdeeKcal: kcal.tdeeKcal, targetKcal: kcal.targetKcal, deficitKcal: kcal.deficitKcal, flooredBySafety: kcal.flooredBySafety },
            fluctuationKg
        });
    }

    // ---- hitos por cruce real de la serie (GEN-03/04) ----
    /** @type {Milestone[]} */ const milestones = [];
    for (const phase of bounds) {
        const dayIndex = phase.startDayIndex === 0 ? 0 : phase.startDayIndex + 1;
        milestones.push({
            id: `phase:${phase.type}:${dayIndex}`,
            category: 'phase',
            threshold: phase.type,
            dayIndex,
            dateISO: dateAt(start, dayIndex)
        });
    }
    /**
     * Cruces de umbral sobre una métrica: registra el primer día en que la
     * serie cruza cada múltiplo del paso, en cualquier dirección.
     * @param {'fatPct' | 'muscleKg' | 'weightKg'} category
     * @param {number} step
     */
    const detectCrossings = (category, step) => {
        for (let i = 1; i < daily.length; i++) {
            const prev = daily[i - 1][category];
            const cur = daily[i][category];
            if (prev === cur) continue;
            const lo = Math.min(prev, cur);
            const hi = Math.max(prev, cur);
            for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) {
                if (t === prev) continue; // el umbral de partida no es un cruce
                milestones.push({
                    id: `${category}:${t}:${daily[i].dayIndex}`,
                    category,
                    threshold: t,
                    dayIndex: daily[i].dayIndex,
                    dateISO: daily[i].dateISO
                });
            }
        }
    };
    detectCrossings('fatPct', MILESTONE_CATEGORIES.fatPct.step);
    detectCrossings('muscleKg', MILESTONE_CATEGORIES.muscleKg.step);
    detectCrossings('weightKg', MILESTONE_CATEGORIES.weightKg.step);
    milestones.sort((a, b) => a.dayIndex - b.dayIndex);

    // ---- agregado semanal: bloques de 7 días desde el día 1 (GEN-07) ----
    /** @type {WeeklyPoint[]} */ const weekly = [];
    for (let w = 1; (w - 1) * 7 < totalDays; w++) {
        const firstDay = (w - 1) * 7 + 1;
        const lastDay = Math.min(w * 7, totalDays);
        const block = daily.slice(firstDay, lastDay + 1);
        const end = block[block.length - 1];
        weekly.push({
            weekIndex: w,
            startISO: daily[firstDay].dateISO,
            endISO: end.dateISO,
            partial: lastDay - firstDay + 1 < 7,
            phaseType: end.phaseType,
            endWeightKg: end.weightKg,
            endFatPct: end.fatPct,
            endMuscleKg: end.muscleKg,
            avgTargetKcal: Math.round(block.reduce((s, d) => s + d.kcal.targetKcal, 0) / block.length)
        });
    }

    // ---- agregado mensual: meses de calendario (GEN-11/12) ----
    /** @type {MonthlyPoint[]} */ const monthly = [];
    /** @type {Map<string, DailyPoint[]>} */ const byMonth = new Map();
    for (const d of daily.slice(1)) {
        const key = d.dateISO.slice(0, 7);
        const bucket = byMonth.get(key);
        if (bucket) bucket.push(d);
        else byMonth.set(key, [d]);
    }
    for (const [monthISO, block] of byMonth) {
        const end = block[block.length - 1];
        const [y, m] = monthISO.split('-').map(Number);
        const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
        monthly.push({
            monthISO,
            startISO: block[0].dateISO,
            endISO: end.dateISO,
            partial: block.length < daysInMonth,
            phaseType: end.phaseType,
            endWeightKg: end.weightKg,
            endFatPct: end.fatPct,
            endMuscleKg: end.muscleKg,
            avgTargetKcal: Math.round(block.reduce((s, d) => s + d.kcal.targetKcal, 0) / block.length)
        });
    }

    const last = daily[daily.length - 1];
    const scenariosClose = Math.abs(last.band.pessimistKg - last.weightKg) < 1e-6
        && Math.abs(last.band.optimistKg - last.weightKg) < 1e-6;

    return {
        ok: true,
        value: { daily, weekly, monthly, milestones, scenariosClose, warnings },
        warnings
    };
}

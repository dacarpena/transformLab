// @ts-check

/**
 * Puente entre la capa de datos y las vistas: carga el perfil, regenera la
 * proyección y la mantiene en memoria durante la sesión.
 *
 * La PROYECCIÓN no se persiste (decisión de M2): el generador es determinista,
 * así que se recalcula al arrancar a partir del plan guardado y su semilla.
 * Eso elimina de raíz la clase de bug del legacy en la que unos datos
 * cacheados sobrevivían a un cambio del motor.
 */

import * as storage from '../data/storage.js';
import { validateCollection } from '../data/schema.js';
import { makeComposition, planPhases } from '../core/engine.js';
import { generateProjection } from '../core/generator.js';
import { seedFrom } from '../core/rng.js';
import { t } from '../i18n/i18n.js';

/**
 * @typedef {import('../core/engine.js').Composition} Composition
 * @typedef {import('../core/engine.js').PhasePlan} PhasePlan
 * @typedef {import('../core/generator.js').Projection} Projection
 * @typedef {import('../core/ranges.js').Issue} Issue
 */

/**
 * @typedef {Object} PlanBundle
 * @property {*} profile registro de perfil validado
 * @property {Composition} composition
 * @property {PhasePlan} plan
 * @property {Projection} projection
 * @property {string} startDateISO
 * @property {boolean} fluctuation
 */

/** @type {PlanBundle | null} */
let bundle = null;

/** @returns {PlanBundle | null} */
export function get() {
    return bundle;
}

/** Descarta lo cargado (cambio de perfil, edición del perfil). */
export function clear() {
    bundle = null;
}

/**
 * Traduce un `Issue` del core a texto para el usuario.
 * Códigos desconocidos devuelven un mensaje genérico en vez de jerga interna.
 * @param {Issue} issue
 * @returns {string}
 */
export function issueText(issue) {
    const key = `ranges.${issue.code}`;
    const text = t(key, issue.params);
    return text === key ? t('error.generic') : text;
}

/**
 * Construye plan y proyección a partir de un perfil, sin tocar el almacén.
 * Lo usan tanto el onboarding (preview en vivo) como la carga normal.
 * @param {*} profileRecord
 * @param {{ profileId: string, fluctuation?: boolean }} options
 * @returns {{ ok: true, value: Omit<PlanBundle, 'profile'> } | { ok: false, issues: Issue[] }}
 */
export function build(profileRecord, options) {
    const composition = makeComposition({
        weightKg: profileRecord.initial.weightKg,
        fatPct: profileRecord.initial.fatPct,
        muscleKg: profileRecord.initial.muscleKg,
        muscleSource: profileRecord.initial.muscleSource,
        sex: profileRecord.user.sex
    });
    if (!composition.ok) return { ok: false, issues: composition.errors };

    const plan = planPhases(
        composition.value,
        { fatPct: profileRecord.target.fatPct, muscleKg: profileRecord.target.muscleKg },
        profileRecord.user,
        { intensity: profileRecord.intensity }
    );
    if (!plan.ok) return { ok: false, issues: plan.errors };

    const fluctuation = options.fluctuation ?? false;
    const projection = generateProjection(plan.value, composition.value, profileRecord.user, {
        startDateISO: profileRecord.startDateISO,
        seed: seedFrom(options.profileId, profileRecord.startDateISO),
        fluctuation
    });
    if (!projection.ok) return { ok: false, issues: projection.errors };

    return {
        ok: true,
        value: {
            composition: composition.value,
            plan: plan.value,
            projection: projection.value,
            startDateISO: profileRecord.startDateISO,
            fluctuation
        }
    };
}

/**
 * Carga el perfil activo desde el almacén y regenera su proyección.
 * @param {{ profileId: string, fluctuation?: boolean }} options
 * @returns {{ ok: true, value: PlanBundle } | { ok: false, reason: 'noProfile' | 'invalid' | 'unbuildable', issues?: Issue[] }}
 */
export function load(options) {
    const stored = storage.get('profile');
    if (!stored.ok) return { ok: false, reason: 'invalid' };
    if (stored.value === null) return { ok: false, reason: 'noProfile' };

    const parsed = validateCollection('profile', stored.value);
    if (!parsed.ok) return { ok: false, reason: 'invalid' };

    const built = build(parsed.value, options);
    if (!built.ok) return { ok: false, reason: 'unbuildable', issues: built.issues };

    bundle = { profile: parsed.value, ...built.value };
    return { ok: true, value: bundle };
}

/**
 * Regenera la proyección con otro valor del interruptor de fluctuación,
 * sin volver a planificar (el plan no depende de él).
 * @param {boolean} fluctuation
 * @param {string} profileId
 * @returns {boolean}
 */
export function setFluctuation(fluctuation, profileId) {
    if (!bundle) return false;
    const projection = generateProjection(bundle.plan, bundle.composition, bundle.profile.user, {
        startDateISO: bundle.startDateISO,
        seed: seedFrom(profileId, bundle.startDateISO),
        fluctuation
    });
    if (!projection.ok) return false;
    bundle = { ...bundle, projection: projection.value, fluctuation };
    return true;
}

/**
 * Índice del día de HOY dentro del plan (decisión D1a/D2a: el día REAL,
 * nunca «el punto medio para que la demo quede bonita» — ficha H-035).
 * Devuelve un índice acotado y una señal de si el plan aún no ha empezado
 * o ya terminó, para que la vista lo diga en vez de fingir.
 * @param {PlanBundle} data
 * @param {string} todayISO fecha civil de hoy, inyectada por el llamante
 * @returns {{ dayIndex: number, state: 'before' | 'during' | 'after' }}
 */
export function todayIndex(data, todayISO) {
    const MS_PER_DAY = 86400000;
    const start = Date.parse(`${data.startDateISO}T00:00:00Z`);
    const today = Date.parse(`${todayISO}T00:00:00Z`);
    if (Number.isNaN(start) || Number.isNaN(today)) return { dayIndex: 0, state: 'during' };

    const diff = Math.round((today - start) / MS_PER_DAY);
    const total = data.plan.totalDays;
    if (diff < 0) return { dayIndex: 0, state: 'before' };
    if (diff > total) return { dayIndex: total, state: 'after' };
    return { dayIndex: diff, state: 'during' };
}

/** Fecha civil de hoy en UTC, coherente con las fechas del generador. */
export function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

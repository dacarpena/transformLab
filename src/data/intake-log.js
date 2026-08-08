// @ts-check

/**
 * Registro de ingesta diaria (V2-M1).
 *
 * Es la entrada que hace posible el gasto MEDIDO: sin saber lo que alguien
 * comió, el balance energético no se puede invertir y el TDEE se queda en la
 * estimación de población de la fórmula.
 *
 * Hermano de `checkins.js` en todo: un registro por día (el id se deriva de la
 * fecha, así que apuntar dos veces el mismo día corrige en vez de duplicar),
 * validación de la colección entera antes de escribir, y caché en memoria atada
 * a `storage.revision()` para que ninguna escritura ajena —un import de backup,
 * una migración— la deje rancia.
 */

import * as storage from './storage.js';
import { SCHEMA_VERSION, validateCollection } from './schema.js';

/**
 * @typedef {{ dateISO: string, kcal: number, proteinG?: number|null, carbsG?: number|null, fatG?: number|null }} IntakeInput
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} IntakeResult
 */

const KEY = 'intakeLog';

/** @type {{ profileId: string, revision: number, list: any[] } | null} */
let cache = null;

/** @returns {any[]} lista ordenada por fecha, vacía si algo falla */
export function list() {
    const profileId = storage.getActiveProfile();
    const revision = storage.revision();
    if (cache && cache.profileId === profileId && cache.revision === revision) return cache.list;

    const stored = storage.get(KEY);
    if (!stored.ok || stored.value === null) { cache = null; return []; }
    const parsed = validateCollection(KEY, stored.value);
    if (!parsed.ok) { cache = null; return []; }

    const sorted = [...parsed.value.items].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    cache = { profileId, revision, list: sorted };
    return sorted;
}

/**
 * Guarda la ingesta de un día (alta o corrección).
 * @param {IntakeInput} input
 * @returns {IntakeResult<any>}
 */
export function save(input) {
    const dateISO = typeof input?.dateISO === 'string' ? input.dateISO.slice(0, 10) : '';
    const kcal = typeof input?.kcal === 'number' && Number.isFinite(input.kcal)
        ? Math.max(0, Math.round(input.kcal))
        : null;
    if (kcal === null) return { ok: false, error: 'intake.kcalRequired' };

    /** @param {unknown} v */
    const macro = (v) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : null);
    const record = {
        dateISO,
        kcal,
        proteinG: macro(input?.proteinG),
        carbsG: macro(input?.carbsG),
        fatG: macro(input?.fatG)
    };

    // Un día, un registro: apuntar dos veces el mismo día es una corrección.
    const items = [...list().filter((e) => e.dateISO !== dateISO), record]
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO));

    const next = { schemaVersion: SCHEMA_VERSION, items };
    const checked = validateCollection(KEY, next);
    if (!checked.ok) return { ok: false, error: 'intake.invalid' };

    const written = storage.set(KEY, checked.value);
    if (!written.ok) return { ok: false, error: written.error };
    return { ok: true, value: record };
}

/**
 * @param {string} dateISO
 * @returns {IntakeResult<number>} cuántos quedan
 */
export function remove(dateISO) {
    const items = list().filter((e) => e.dateISO !== dateISO);
    if (items.length === list().length) return { ok: false, error: 'intake.notFound' };
    const written = storage.set(KEY, { schemaVersion: SCHEMA_VERSION, items });
    if (!written.ok) return { ok: false, error: written.error };
    return { ok: true, value: items.length };
}

/** @param {string} dateISO @returns {any | null} */
export function findByDate(dateISO) {
    return list().find((e) => e.dateISO === dateISO) ?? null;
}

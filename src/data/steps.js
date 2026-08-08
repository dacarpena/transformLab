// @ts-check

/**
 * Registro de pasos por día (V2-M7).
 *
 * Mismo molde que `src/data/intake-log.js`: un día, una entrada, y volver a
 * apuntar el mismo día SUSTITUYE en vez de duplicar. Sin eso, corregir una cifra
 * mal tecleada dejaría las dos, y la media de la semana saldría inflada por el
 * error que el usuario creía haber arreglado.
 */

import * as storage from './storage.js';
import { SCHEMA_VERSION, validateCollection } from './schema.js';

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} StepsResult
 */

const KEY = 'steps';

/**
 * Todo lo registrado, en orden cronológico.
 *
 * Degrada a lista vacía: la vista tiene que poder pintar su estado vacío aunque
 * el almacén esté ilegible.
 * @returns {Array<{ dateISO: string, steps: number }>}
 */
export function list() {
    const stored = storage.get(KEY);
    if (!stored.ok || stored.value === null) return [];
    const parsed = validateCollection(KEY, stored.value);
    if (!parsed.ok) return [];
    return [...parsed.value.items].sort((/** @type {*} */ a, /** @type {*} */ b) =>
        a.dateISO.localeCompare(b.dateISO));
}

/** @param {string} dateISO */
export function findByDate(dateISO) {
    return list().find((e) => e.dateISO === dateISO) ?? null;
}

/**
 * @param {Array<{ dateISO: string, steps: number }>} items
 * @returns {StepsResult<Array<{ dateISO: string, steps: number }>>}
 */
function write(items) {
    const record = { schemaVersion: SCHEMA_VERSION, items };
    const checked = validateCollection(KEY, record);
    if (!checked.ok) return { ok: false, error: 'steps.invalid' };
    const written = storage.set(KEY, checked.value);
    if (!written.ok) return { ok: false, error: written.error };
    return { ok: true, value: items };
}

/**
 * Apunta los pasos de un día. Si ese día ya tenía, lo REEMPLAZA.
 * @param {{ dateISO: string, steps: number }} input
 * @returns {StepsResult<Array<{ dateISO: string, steps: number }>>}
 */
export function save(input) {
    const dateISO = String(input?.dateISO ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO)) return { ok: false, error: 'steps.dateInvalid' };
    const steps = Number(input?.steps);
    if (!Number.isFinite(steps) || steps < 0) return { ok: false, error: 'steps.invalidCount' };

    const items = list().filter((e) => e.dateISO !== dateISO);
    return write([...items, { dateISO, steps: Math.round(steps) }]
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO)));
}

/**
 * @param {string} dateISO
 * @returns {StepsResult<Array<{ dateISO: string, steps: number }>>}
 */
export function remove(dateISO) {
    const items = list();
    const next = items.filter((e) => e.dateISO !== dateISO);
    if (next.length === items.length) return { ok: false, error: 'steps.notFound' };
    return write(next);
}

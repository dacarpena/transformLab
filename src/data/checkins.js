// @ts-check

/**
 * Colección de check-ins: alta, edición y borrado sobre `storage.js`.
 *
 * Todo pasa por el validador de `schema.js` antes de escribirse, de modo que
 * la colección persistida siempre es válida aunque la vista tenga un fallo.
 * El id se deriva de la fecha, así que dos check-ins del mismo día se
 * reemplazan en vez de duplicarse: pesarse dos veces un martes no crea dos
 * registros que luego se contradigan.
 */

import * as storage from './storage.js';
import { SCHEMA_VERSION, validateCollection, sanitizeText, MEASURE_KEYS, SUBJECTIVE_KEYS } from './schema.js';

/**
 * @typedef {import('./schema.js').SchemaIssue} SchemaIssue
 * @typedef {Object} CheckinInput
 * @property {string} dateISO
 * @property {number} weightKg
 * @property {number | null} [fatPct]
 * @property {Record<string, number>} [measuresCm]
 * @property {Record<string, number>} [subjective]
 * @property {string} [notes]
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string, issues?: SchemaIssue[] }} CheckinResult
 */

const KEY = 'checkins';

/**
 * Id determinista a partir de la fecha: un check-in por día.
 * @param {string} dateISO
 * @returns {string}
 */
function idFor(dateISO) {
    return `ci_${dateISO}`;
}

/** @returns {CheckinResult<{ schemaVersion: number, items: any[] }>} */
export function readAll() {
    const stored = storage.get(KEY);
    if (!stored.ok) return { ok: false, error: stored.error };
    if (stored.value === null) return { ok: true, value: { schemaVersion: SCHEMA_VERSION, items: [] } };

    const parsed = validateCollection(KEY, stored.value);
    if (!parsed.ok) return { ok: false, error: 'checkins.corrupt', issues: parsed.errors };
    return { ok: true, value: parsed.value };
}

/** @returns {any[]} lista ordenada por fecha, vacía si algo falla */
export function list() {
    const all = readAll();
    if (!all.ok) return [];
    return [...all.value.items].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

/**
 * Filtra un mapa parcial dejando solo claves conocidas y números finitos.
 * @param {Record<string, unknown> | undefined} input
 * @param {readonly string[]} allowed
 * @returns {Record<string, number>}
 */
function cleanMap(input, allowed) {
    /** @type {Record<string, number>} */ const out = {};
    if (!input || typeof input !== 'object') return out;
    for (const key of allowed) {
        const value = Object.hasOwn(input, key) ? input[key] : undefined;
        if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    }
    return out;
}

/**
 * Guarda un check-in (alta o edición del mismo día).
 * @param {CheckinInput} input
 * @param {{ nowISO: string }} context
 * @returns {CheckinResult<any>}
 */
export function save(input, context) {
    const all = readAll();
    if (!all.ok) return all;

    const id = idFor(input?.dateISO ?? '');
    const existing = all.value.items.find((item) => item.id === id);

    const record = {
        id,
        dateISO: input?.dateISO ?? '',
        weightKg: input?.weightKg,
        fatPct: typeof input?.fatPct === 'number' && Number.isFinite(input.fatPct) ? input.fatPct : null,
        measuresCm: cleanMap(input?.measuresCm, MEASURE_KEYS),
        subjective: cleanMap(input?.subjective, SUBJECTIVE_KEYS),
        notes: sanitizeText(input?.notes ?? ''),
        createdAtISO: existing?.createdAtISO ?? context.nowISO,
        editedAtISO: existing ? context.nowISO : null
    };

    const items = existing
        ? all.value.items.map((item) => (item.id === id ? record : item))
        : [...all.value.items, record];

    const next = { schemaVersion: SCHEMA_VERSION, items };
    // se valida la colección ENTERA antes de escribir: un registro raro no
    // puede dejar la colección en un estado que la app no sepa releer
    const checked = validateCollection(KEY, next);
    if (!checked.ok) return { ok: false, error: 'checkins.invalid', issues: checked.errors };

    const written = storage.set(KEY, checked.value);
    if (!written.ok) return { ok: false, error: written.error };
    return { ok: true, value: record };
}

/**
 * Borra un check-in por id.
 * @param {string} id
 * @returns {CheckinResult<number>} cuántos quedan
 */
export function remove(id) {
    const all = readAll();
    if (!all.ok) return all;
    const items = all.value.items.filter((item) => item.id !== id);
    if (items.length === all.value.items.length) return { ok: false, error: 'checkins.notFound' };

    const written = storage.set(KEY, { schemaVersion: SCHEMA_VERSION, items });
    if (!written.ok) return { ok: false, error: written.error };
    return { ok: true, value: items.length };
}

/** @param {string} dateISO @returns {any | null} */
export function findByDate(dateISO) {
    return list().find((item) => item.dateISO === dateISO) ?? null;
}

/**
 * ¿Falta el check-in de esta semana? (M4-7, aviso in-app no intrusivo.)
 * @param {string} todayISO
 * @param {string} startDateISO
 * @returns {boolean}
 */
export function isWeekPending(todayISO, startDateISO) {
    const MS = 86400000;
    const start = Date.parse(`${startDateISO}T00:00:00Z`);
    const today = Date.parse(`${todayISO}T00:00:00Z`);
    if (Number.isNaN(start) || Number.isNaN(today) || today < start) return false;

    const currentWeek = Math.floor((today - start) / MS / 7);
    return !list().some((item) => {
        const day = Date.parse(`${item.dateISO}T00:00:00Z`);
        if (Number.isNaN(day)) return false;
        return Math.floor((day - start) / MS / 7) === currentWeek;
    });
}

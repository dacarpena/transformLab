// @ts-check

/**
 * Ajustes de la aplicación por perfil (E13).
 *
 * Existe porque el patrón «leer → validar → fundir → validar → escribir» estaba
 * ABIERTO EN CANAL en `reminder.js`, y el objeto por defecto estaba copiado
 * literalmente en tres sitios (`reminder.js`, `onboarding.js`, `schema.js`). Tres
 * copias de un valor por defecto son tres oportunidades de divergir, y la que
 * divergiera ganaría según qué camino escribiera el último.
 *
 * El defecto que lo hizo urgente: `settings.fluctuationVisible` se LEÍA al
 * arrancar (`main.js`) y se inicializaba a `false` (`onboarding.js`), pero
 * NINGÚN camino de la interfaz lo escribía nunca a `true`. El interruptor de
 * fluctuación se marcaba, se recargaba, y volvía apagado. No había dónde
 * escribirlo sin repetir la cuarta copia del patrón.
 */

import * as storage from './storage.js';
import { SCHEMA_VERSION, MEASURE_KEYS, validateCollection } from './schema.js';

const KEY = 'settings';

/**
 * @typedef {Object} AnalysisSettings
 * @property {string[]} seriesIds hasta 4; ids del catálogo de series
 * @property {string} window preset de ventana
 * @property {string} grain granularidad pedida
 * @property {string} normalize 'raw' | 'delta'
 *
 * @typedef {Object} Settings
 * @property {string} locale
 * @property {string[]} activeMeasures
 * @property {boolean} fluctuationVisible
 * @property {{ weekday: number, hour: number } | null} reminder
 * @property {AnalysisSettings} [analysis]
 */

/**
 * Los ajustes de fábrica. ÚNICA definición del valor por defecto: quien necesite
 * uno lo pide aquí en vez de escribir su propio literal.
 * @returns {Settings}
 */
export function defaults() {
    return {
        locale: 'es',
        // El primero del catálogo, no un literal: si mañana cambia el orden de
        // `MEASURE_KEYS`, este default lo sigue en vez de quedarse atrás.
        activeMeasures: [MEASURE_KEYS[0]],
        fluctuationVisible: false,
        reminder: null
    };
}

/**
 * Los ajustes guardados, o los de fábrica si no hay o no se pueden leer.
 *
 * Degrada en silencio A PROPÓSITO: unos ajustes ilegibles no pueden impedir que
 * la aplicación arranque, y ninguno de ellos guarda datos del usuario que se
 * puedan perder — son preferencias de presentación, todas recuperables
 * volviéndolas a marcar. (Compárese con `preferences.js`, donde la misma
 * degradación sí borraba alergias y por eso lleva su propia advertencia.)
 * @returns {Settings}
 */
export function read() {
    const stored = storage.get(KEY);
    if (!stored.ok || stored.value === null) return defaults();
    const parsed = validateCollection(KEY, stored.value);
    if (!parsed.ok) return defaults();
    const v = /** @type {*} */ (parsed.value);
    return {
        locale: v.locale,
        activeMeasures: v.activeMeasures,
        fluctuationVisible: v.fluctuationVisible,
        reminder: v.reminder ?? null,
        ...(v.analysis ? { analysis: v.analysis } : {})
    };
}

/**
 * Funde un cambio parcial sobre lo guardado y lo escribe.
 *
 * Devuelve `Result` en vez de un booleano porque los llamadores necesitan
 * distinguir «no se pudo validar» de «no se pudo escribir»: lo segundo es cuota
 * llena y merece un mensaje distinto.
 * @param {Partial<Settings>} changes
 * @returns {{ ok: true, value: Settings } | { ok: false, error: string }}
 */
export function patch(changes) {
    const next = { schemaVersion: SCHEMA_VERSION, ...read(), ...changes };
    const checked = validateCollection(KEY, next);
    if (!checked.ok) return { ok: false, error: 'settings.invalid' };
    const written = storage.set(KEY, checked.value);
    if (!written.ok) return { ok: false, error: written.error };
    return { ok: true, value: read() };
}

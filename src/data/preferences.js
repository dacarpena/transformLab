// @ts-check

/**
 * Preferencias alimentarias del perfil (V2-M3; el formulario llega en V2-M10).
 *
 * LA DISTINCIÓN DURAS/BLANDAS ES EL CONTENIDO DE ESTE MÓDULO, no un detalle de
 * su forma. Las duras —alergias, tipo de dieta— no se violan jamás; las blandas
 * —lo que no apetece— penalizan pero no prohíben. Meterlo todo en el mismo saco
 * deja al solver de menú sin solución factible, que es como un planificador de
 * comidas empieza a proponer combinaciones absurdas.
 *
 * Se lee ya, aunque el onboarding profundo que las rellena sea de V2-M10: así el
 * menú respeta desde hoy lo que haya, y cuando llegue el formulario no hay que
 * tocar el solver.
 */

import * as storage from './storage.js';
import { SCHEMA_VERSION, validateCollection, sanitizeText } from './schema.js';

const KEY = 'preferences';

/**
 * @typedef {Object} Preferences
 * @property {string[]} hardExclusions
 * @property {string[]} softExclusions
 * @property {string|null} dietType
 * @property {number|null} mealsPerDay
 * @property {number|null} householdSize
 * @property {string|null} controlLevel
 */

/** Valor por defecto: sin restricciones y omnívoro. */
function empty() {
    return {
        hardExclusions: [], softExclusions: [], dietType: null,
        mealsPerDay: null, householdSize: null, controlLevel: null
    };
}

/**
 * Preferencias guardadas. Degrada a «sin restricciones»: un almacén ilegible no
 * puede dejar al usuario sin menú.
 *
 * Ojo con el sentido de la degradación: aquí lo seguro es lo PERMISIVO porque
 * las duras se comprueban también en `core/menu.js` sobre el alimento concreto.
 * Si un día se moviera esa comprobación aquí, este `catch` se convertiría en un
 * agujero — un alérgico recibiría su alérgeno porque no se pudo leer un JSON.
 * @returns {Preferences}
 */
export function get() {
    const stored = storage.get(KEY);
    if (!stored.ok || stored.value === null) return empty();
    const parsed = validateCollection(KEY, stored.value);
    if (!parsed.ok) return empty();
    const v = parsed.value;
    return {
        hardExclusions: v.hardExclusions ?? [],
        softExclusions: v.softExclusions ?? [],
        dietType: v.dietType ?? null,
        mealsPerDay: v.mealsPerDay ?? null,
        householdSize: v.householdSize ?? null,
        controlLevel: v.controlLevel ?? null
    };
}

/**
 * Guarda un cambio parcial.
 * @param {Partial<Preferences>} patch
 * @returns {{ ok: true, value: Preferences } | { ok: false, error: string }}
 */
export function save(patch) {
    const current = get();
    const limpiarLista = (/** @type {unknown} */ list, /** @type {number} */ max) =>
        (Array.isArray(list) ? list : [])
            .map((item) => sanitizeText(item, 60))
            .filter(Boolean)
            .slice(0, max);

    const next = {
        schemaVersion: SCHEMA_VERSION,
        hardExclusions: patch.hardExclusions !== undefined
            ? limpiarLista(patch.hardExclusions, 100) : current.hardExclusions,
        softExclusions: patch.softExclusions !== undefined
            ? limpiarLista(patch.softExclusions, 200) : current.softExclusions,
        dietType: patch.dietType !== undefined
            ? (patch.dietType === null ? null : sanitizeText(patch.dietType, 40) || null)
            : current.dietType,
        mealsPerDay: patch.mealsPerDay !== undefined ? patch.mealsPerDay : current.mealsPerDay,
        householdSize: patch.householdSize !== undefined ? patch.householdSize : current.householdSize,
        controlLevel: patch.controlLevel !== undefined ? patch.controlLevel : current.controlLevel
    };

    const checked = validateCollection(KEY, next);
    if (!checked.ok) return { ok: false, error: 'preferences.invalid' };
    const written = storage.set(KEY, checked.value);
    if (!written.ok) return { ok: false, error: written.error };
    return { ok: true, value: get() };
}

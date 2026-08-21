// @ts-check

/**
 * Colección de nutrición: las plantillas de comida del usuario (M7-4).
 *
 * Vivía dentro de `src/ui/views/nutrition.js`, y por eso esa vista no tenía un
 * solo test unitario: no había nada importable desde Node que probar. Los
 * macros del día NO se guardan —se derivan del plan cada vez, en
 * `src/core/nutrition.js`—; lo único persistido son estas plantillas.
 */

import * as storage from './storage.js';
// Ids OPACOS: ver `newItemId` en `ids.js`.
import { newItemId } from './ids.js';
import { SCHEMA_VERSION, validateCollection, sanitizeText } from './schema.js';

/**
 * @typedef {{ ok: true, value: any[] } | { ok: false, error: string }} NutritionResult
 */

const KEY = 'nutrition';

/**
 * Plantillas guardadas. Degrada a lista vacía: la vista tiene que poder pintar
 * su estado vacío aunque el almacén esté ilegible.
 * @returns {any[]}
 */
export function listTemplates() {
    const stored = storage.get(KEY);
    if (!stored.ok || stored.value === null) return [];
    const parsed = validateCollection(KEY, stored.value);
    return parsed.ok ? parsed.value.mealTemplates : [];
}

/**
 * @param {any[]} templates
 * @returns {NutritionResult}
 */
function write(templates) {
    const record = { schemaVersion: SCHEMA_VERSION, mealTemplates: templates };
    const checked = validateCollection(KEY, record);
    if (!checked.ok) return { ok: false, error: 'nutrition.invalid' };
    const written = storage.set(KEY, checked.value);
    if (!written.ok) return { ok: false, error: written.error };
    return { ok: true, value: templates };
}


/**
 * Guarda una plantilla nueva.
 * @param {{ name: string, macros: { kcal: number, proteinG: number, carbsG: number, fatG: number } }} input
 * @returns {NutritionResult}
 */
export function addTemplate(input) {
    const templates = listTemplates();
    const name = sanitizeText(input.name ?? '');
    if (name === '') return { ok: false, error: 'nutrition.nameRequired' };

    const clean = (/** @type {unknown} */ v) =>
        (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);
    return write([...templates, {
        id: newItemId('meal'),
        name,
        macros: {
            kcal: clean(input.macros?.kcal),
            proteinG: clean(input.macros?.proteinG),
            carbsG: clean(input.macros?.carbsG),
            fatG: clean(input.macros?.fatG)
        },
        notes: null
    }]);
}

/**
 * @param {string} id
 * @returns {NutritionResult}
 */
export function removeTemplate(id) {
    const templates = listTemplates();
    const next = templates.filter((tpl) => tpl.id !== id);
    if (next.length === templates.length) return { ok: false, error: 'nutrition.notFound' };
    return write(next);
}

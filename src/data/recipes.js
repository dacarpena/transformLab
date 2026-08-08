// @ts-check

/**
 * Recetas del usuario y despensa (V2-M2).
 *
 * Mismo molde que `src/data/nutrition.js` (M7-4): la persistencia vive aquí y
 * no dentro de la vista, para que exista algo importable desde Node que probar.
 *
 * Las recetas NO guardan macros. Se derivan de los ingredientes con
 * `core/foods.recipeMacros` cada vez que se piden. Guardarlas congeladas es
 * exactamente cómo la v4.0 acabó enseñando cifras que ya no correspondían a los
 * datos de los que salieron.
 */

import * as storage from './storage.js';
import { SCHEMA_VERSION, validateCollection, sanitizeText } from './schema.js';

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} RecipesResult
 */

const RECIPES_KEY = 'recipes';
const PANTRY_KEY = 'pantry';

/**
 * Lee una colección degradando a lista vacía: la vista tiene que poder pintar
 * su estado vacío aunque el almacén esté ilegible.
 * @param {string} key
 * @returns {any[]}
 */
function readItems(key) {
    const stored = storage.get(key);
    if (!stored.ok || stored.value === null) return [];
    const parsed = validateCollection(key, stored.value);
    return parsed.ok ? parsed.value.items : [];
}

/**
 * @param {string} key
 * @param {any[]} items
 * @returns {RecipesResult<any[]>}
 */
function writeItems(key, items) {
    const record = { schemaVersion: SCHEMA_VERSION, items };
    const checked = validateCollection(key, record);
    if (!checked.ok) return { ok: false, error: `${key}.invalid` };
    const written = storage.set(key, checked.value);
    if (!written.ok) return { ok: false, error: written.error };
    return { ok: true, value: items };
}

/**
 * Id nuevo sin colisiones. Derivarlo de `length + 1` reutiliza el índice tras
 * un borrado, y dos recetas con el mismo id hacen que borrar una borre las dos.
 * Sin reloj ni azar, para que sea determinista.
 * @param {any[]} existing
 * @param {string} name
 * @param {string} prefix
 * @returns {string}
 */
function freshId(existing, name, prefix) {
    const taken = new Set(existing.map((it) => it?.id).filter(Boolean));
    const slug = name.slice(0, 12).replace(/[^A-Za-z0-9]/g, '') || prefix;
    let n = existing.length + 1;
    let id = `${prefix}_${n}_${slug}`;
    while (taken.has(id)) {
        n += 1;
        id = `${prefix}_${n}_${slug}`;
    }
    return id;
}

/** @returns {any[]} */
export function listRecipes() {
    return readItems(RECIPES_KEY);
}

/**
 * Sanea un ingrediente. El texto pasa por `sanitizeText` porque una receta
 * puede llegar de un backup importado, que es el vector real de inyección
 * (F6): lo que teclea uno mismo es inofensivo, lo que llega en un fichero no.
 * @param {*} raw
 * @returns {{ name: string, quantity: number, unit: string, foodId?: string } | null}
 */
function cleanIngredient(raw) {
    const name = sanitizeText(raw?.name ?? '');
    if (name === '') return null;
    const quantity = Number(raw?.quantity);
    /** @type {{ name: string, quantity: number, unit: string, foodId?: string }} */
    const out = {
        name,
        quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : 0,
        unit: sanitizeText(raw?.unit ?? 'g').slice(0, 20) || 'g'
    };
    const foodId = sanitizeText(raw?.foodId ?? '');
    if (foodId !== '') out.foodId = foodId.slice(0, 80);
    return out;
}

/**
 * @param {{ name: string, servings?: number, ingredients?: any[], notes?: string }} input
 * @returns {RecipesResult<any[]>}
 */
export function addRecipe(input) {
    const recipes = listRecipes();
    const name = sanitizeText(input?.name ?? '');
    if (name === '') return { ok: false, error: 'recipes.nameRequired' };

    const ingredients = (Array.isArray(input?.ingredients) ? input.ingredients : [])
        .map(cleanIngredient)
        .filter(Boolean)
        .slice(0, 60);
    if (ingredients.length === 0) return { ok: false, error: 'recipes.ingredientsRequired' };

    const servings = Number(input?.servings);
    const notes = sanitizeText(input?.notes ?? '');
    return writeItems(RECIPES_KEY, [...recipes, {
        id: freshId(recipes, name, 'recipe'),
        name,
        servings: Number.isFinite(servings) && servings >= 1 ? Math.min(50, Math.round(servings)) : 1,
        ingredients,
        notes: notes === '' ? null : notes.slice(0, 2000)
    }]);
}

/**
 * @param {string} id
 * @returns {RecipesResult<any[]>}
 */
export function removeRecipe(id) {
    const recipes = listRecipes();
    const next = recipes.filter((r) => r.id !== id);
    if (next.length === recipes.length) return { ok: false, error: 'recipes.notFound' };
    return writeItems(RECIPES_KEY, next);
}

/** @returns {any[]} */
export function listPantry() {
    return readItems(PANTRY_KEY);
}

/**
 * Añade a la despensa, FUSIONANDO si ya había lo mismo en la misma unidad.
 *
 * Sin fusionar, comprar arroz dos semanas seguidas deja dos entradas «Arroz
 * 1000 g» y la lista de la compra de V2-M4 descontaría solo una.
 * @param {{ name: string, quantity: number, unit?: string, foodId?: string, expiresISO?: string }} input
 * @returns {RecipesResult<any[]>}
 */
export function addPantryItem(input) {
    const items = listPantry();
    const name = sanitizeText(input?.name ?? '');
    if (name === '') return { ok: false, error: 'pantry.nameRequired' };
    const quantity = Number(input?.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) return { ok: false, error: 'pantry.quantityInvalid' };
    const unit = sanitizeText(input?.unit ?? 'g').slice(0, 20) || 'g';

    const foodId = sanitizeText(input?.foodId ?? '').slice(0, 80);
    // Se fusiona por alimento cuando se conoce, y por nombre cuando no. Fusionar
    // solo por nombre dejaría dos entradas del mismo arroz si una vino de la
    // lista de la compra y la otra la tecleó el usuario.
    const same = items.find((it) => (foodId !== '' && it.foodId === foodId)
        || (it.name.toLowerCase() === name.toLowerCase() && it.unit === unit));
    if (same) {
        const next = items.map((it) => (it === same
            ? { ...it, quantity: Math.round((it.quantity + quantity) * 10) / 10 }
            : it));
        return writeItems(PANTRY_KEY, next);
    }

    /** @type {Record<string, *>} */ const item = {
        id: freshId(items, name, 'pantry'),
        name,
        quantity: Math.round(quantity * 10) / 10,
        unit
    };
    if (foodId !== '') item.foodId = foodId;
    if (typeof input?.expiresISO === 'string' && input.expiresISO !== '') item.expiresISO = input.expiresISO;
    return writeItems(PANTRY_KEY, [...items, item]);
}

/**
 * @param {string} id
 * @returns {RecipesResult<any[]>}
 */
export function removePantryItem(id) {
    const items = listPantry();
    const next = items.filter((it) => it.id !== id);
    if (next.length === items.length) return { ok: false, error: 'pantry.notFound' };
    return writeItems(PANTRY_KEY, next);
}

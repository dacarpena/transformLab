// @ts-check

/**
 * Catálogo de ejercicios empaquetado (V2-M6).
 *
 * A diferencia de la base de alimentos, aquí NO hay IndexedDB. Son 556 fichas y
 * 102 KB de metadatos que ya viajan precacheados en `PRECACHE`: volcarlos a una
 * base de datos añadiría un almacén, una versión y una siembra que mantener a
 * cambio de nada. Los alimentos justifican IndexedDB porque son veinte veces más
 * y porque el usuario añadirá los suyos; esto es una tabla de consulta y punto.
 *
 * La caché en memoria es lo único que hace falta: el catálogo se pide una vez
 * por sesión y se comparte entre vistas.
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} ExercisesResult
 */

/**
 * @typedef {Object} Exercise
 * @property {string} id
 * @property {string} name
 * @property {Record<string, number>} muscles grupo → peso (1 primario, 0,4 secundario)
 * @property {string} equipment
 * @property {string|null} mechanic
 * @property {string|null} force
 * @property {string} level
 */

/** Fichero estático con el catálogo curado. Va en `PRECACHE`. */
export const CATALOG_URL = 'vendor/data/exercises.json';

/** @type {Record<string, Exercise> | null} */
let cache = null;

/**
 * El catálogo indexado por id.
 *
 * Devuelve un índice y no un array porque todos sus consumidores buscan por id:
 * `muscle-volume.effectiveSets` recorre las entradas de cada sesión, y hacerlo
 * sobre un array sería una búsqueda lineal por serie registrada.
 *
 * @param {{ fetchImpl?: typeof fetch, force?: boolean }} [options]
 * @returns {Promise<ExercisesResult<Record<string, Exercise>>>}
 */
export async function load(options = {}) {
    if (cache && !options.force) return { ok: true, value: cache };

    const doFetch = options.fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== 'function') return { ok: false, error: 'exercises.noFetch' };
    try {
        const res = await doFetch(CATALOG_URL);
        if (!res.ok) return { ok: false, error: `exercises.http${res.status}` };
        const data = await res.json();
        const list = Array.isArray(data?.exercises) ? data.exercises : null;
        if (!list) return { ok: false, error: 'exercises.malformed' };
        cache = Object.fromEntries(list.map((/** @type {Exercise} */ e) => [e.id, e]));
        return { ok: true, value: cache };
    } catch (err) {
        return { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
    }
}

/** Lo ya cargado, o `null`. Para las vistas que no quieren esperar. */
export function cached() {
    return cache;
}

/** Olvida la caché. Para los tests. */
export function reset() {
    cache = null;
}

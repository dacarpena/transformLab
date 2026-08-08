// @ts-check

/**
 * Base de alimentos en IndexedDB (andamiaje de V2-M0; se puebla en V2-M2).
 *
 * DOS COSAS LA HACEN DISTINTA DE TODO LO DEMÁS DEL ALMACÉN:
 *
 * 1. **No lleva namespace de perfil.** Es la ÚNICA cosa compartida entre
 *    perfiles, porque son datos de REFERENCIA de dominio público (USDA
 *    FoodData Central / NCCDB), no datos de nadie: que el bíceps de Dani y el
 *    de otro perfil consulten la misma tabla de la lenteja es lo correcto.
 * 2. **Va en IndexedDB, no en `localStorage`.** Un subconjunto curado pesa MB,
 *    y `storage.js` tiene un presupuesto de 5 MB COMPARTIDO por hasta diez
 *    perfiles. Meterla ahí se comería la cuota del usuario con datos que no son
 *    suyos. Aquí, además, queda fuera de `quotaBudget`, que es lo que se
 *    quería.
 *
 * Molde: `src/data/photos-db.js`, con su misma disciplina —`openDb` versionado
 * con `onupgradeneeded`, conexión cacheada, y NUNCA lanzar: todo devuelve un
 * resultado tipado, porque una base que no abre no puede tumbar la aplicación.
 *
 * ESTADO: la estructura está; el contenido llega en V2-M2, junto con el
 * buscador puro de `src/core/foods.js` y la decisión de qué base pública se
 * empaqueta y con qué cobertura (que se enseña al usuario, sin fingir que es
 * exhaustiva).
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} FoodsResult
 */

const DB_NAME = 'tl-foods';
const DB_VERSION = 1;

/** Alimentos de referencia (solo lectura, compartidos). */
const STORE_FOODS = 'foods';
/** Índice por nombre normalizado, para la búsqueda de V2-M2. */
const INDEX_NAME = 'byName';

/** @type {IDBDatabase | null} */
let cachedDb = null;

/** @param {unknown} err @returns {string} */
function message(err) {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
}

/**
 * Abre (y crea si hace falta) la base. Cachea la conexión.
 * @returns {Promise<FoodsResult<IDBDatabase>>}
 */
export function openDb() {
    return new Promise((resolve) => {
        if (cachedDb) return resolve({ ok: true, value: cachedDb });
        const idb = globalThis.indexedDB;
        if (!idb) return resolve({ ok: false, error: 'foods.indexedDbUnavailable' });

        /** @type {IDBOpenDBRequest} */ let request;
        try {
            request = idb.open(DB_NAME, DB_VERSION);
        } catch (err) {
            return resolve({ ok: false, error: message(err) });
        }
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_FOODS)) {
                const store = db.createObjectStore(STORE_FOODS, { keyPath: 'id' });
                store.createIndex(INDEX_NAME, 'nameNormalized', { unique: false });
            }
        };
        request.onsuccess = () => {
            cachedDb = request.result;
            cachedDb.onclose = () => { cachedDb = null; };
            resolve({ ok: true, value: cachedDb });
        };
        request.onerror = () => resolve({ ok: false, error: message(request.error) });
        request.onblocked = () => resolve({ ok: false, error: 'foods.dbBlocked' });
    });
}

/**
 * Ejecuta una operación dentro de una transacción y resuelve con su resultado.
 * @template T
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} operation
 * @returns {Promise<FoodsResult<T>>}
 */
async function withStore(mode, operation) {
    const db = await openDb();
    if (!db.ok) return db;
    return new Promise((resolve) => {
        /** @type {IDBTransaction} */ let tx;
        try {
            tx = db.value.transaction(STORE_FOODS, mode);
        } catch (err) {
            return resolve({ ok: false, error: message(err) });
        }
        /** @type {IDBRequest} */ let request;
        try {
            request = operation(tx.objectStore(STORE_FOODS));
        } catch (err) {
            return resolve({ ok: false, error: message(err) });
        }
        request.onsuccess = () => resolve({ ok: true, value: request.result });
        request.onerror = () => resolve({ ok: false, error: message(request.error) });
        tx.onabort = () => resolve({ ok: false, error: message(tx.error) });
    });
}

/**
 * ¿Está la base poblada? La interfaz lo necesita para decir honestamente que
 * todavía no hay alimentos, en vez de enseñar una búsqueda que no encuentra nada.
 * @returns {Promise<FoodsResult<number>>}
 */
export function count() {
    return withStore('readonly', (store) => store.count());
}

/**
 * Un alimento por id.
 * @param {string} id
 * @returns {Promise<FoodsResult<unknown | undefined>>}
 */
export function get(id) {
    return withStore('readonly', (store) => store.get(id));
}

/**
 * Vuelca un lote de alimentos. Lo usará la siembra inicial de V2-M2.
 * @param {Array<{ id: string, nameNormalized: string }>} foods
 * @returns {Promise<FoodsResult<number>>}
 */
export async function putAll(foods) {
    if (!Array.isArray(foods)) return { ok: false, error: 'foods.notAnArray' };
    const db = await openDb();
    if (!db.ok) return db;
    return new Promise((resolve) => {
        /** @type {IDBTransaction} */ let tx;
        try {
            tx = db.value.transaction(STORE_FOODS, 'readwrite');
        } catch (err) {
            return resolve({ ok: false, error: message(err) });
        }
        const store = tx.objectStore(STORE_FOODS);
        try {
            for (const food of foods) store.put(food);
        } catch (err) {
            return resolve({ ok: false, error: message(err) });
        }
        tx.oncomplete = () => resolve({ ok: true, value: foods.length });
        tx.onerror = () => resolve({ ok: false, error: message(tx.error) });
        tx.onabort = () => resolve({ ok: false, error: message(tx.error) });
    });
}

/**
 * Vacía la base. Solo para rehacer la siembra: los alimentos no son datos del
 * usuario, así que borrarlos no le quita nada suyo.
 * @returns {Promise<FoodsResult<undefined>>}
 */
export async function clear() {
    const r = await withStore('readwrite', (store) => store.clear());
    return r.ok ? { ok: true, value: undefined } : r;
}

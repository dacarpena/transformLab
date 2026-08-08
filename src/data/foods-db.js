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
 * LA SIEMBRA (V2-M2). El contenido viaja como fichero estático precacheado,
 * `vendor/data/foods.json`, y se vuelca aquí la primera vez. Por qué las dos
 * cosas y no solo el fichero: IndexedDB **puede no estar** —navegación privada
 * de algún Safari, cuota agotada, permisos—, así que `load()` cae de vuelta al
 * fichero y la aplicación sigue funcionando con la base en memoria. Una base de
 * alimentos que no abre no puede dejar al usuario sin diario.
 *
 * El sello `SEED_STAMP` es lo que hace que la siembra ocurra UNA vez y se
 * rehaga sola cuando el fichero cambia. Sin él, o se resiembran 2 000 registros
 * en cada arranque, o se queda para siempre la versión vieja.
 */

import { normalize } from '../core/foods.js';

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} FoodsResult
 */

const DB_NAME = 'tl-foods';
const DB_VERSION = 2;

/** Alimentos de referencia (solo lectura, compartidos). */
const STORE_FOODS = 'foods';
/** Índice por nombre normalizado, para la búsqueda de V2-M2. */
const INDEX_NAME = 'byName';
/** Metadatos de la siembra: qué versión del fichero está volcada. */
const STORE_META = 'meta';

/** Fichero estático con la base empaquetada. Va en `PRECACHE`. */
export const SEED_URL = 'vendor/data/foods.json';

/**
 * Sello de la siembra. **Súbelo cada vez que se regenere `foods.json`**, o los
 * navegadores que ya sembraron se quedarán con la base antigua para siempre.
 */
export const SEED_STAMP = 'foods-2026-08-v3';

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
            // El almacén de metadatos llegó con la versión 2. La comprobación
            // por nombre hace que el salto 1→2 funcione igual que una creación
            // desde cero, sin ramas por número de versión.
            if (!db.objectStoreNames.contains(STORE_META)) {
                db.createObjectStore(STORE_META, { keyPath: 'key' });
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
 * @param {string} [storeName]
 * @returns {Promise<FoodsResult<T>>}
 */
async function withStore(mode, operation, storeName = STORE_FOODS) {
    const db = await openDb();
    if (!db.ok) return db;
    return new Promise((resolve) => {
        /** @type {IDBTransaction} */ let tx;
        try {
            tx = db.value.transaction(storeName, mode);
        } catch (err) {
            return resolve({ ok: false, error: message(err) });
        }
        /** @type {IDBRequest} */ let request;
        try {
            request = operation(tx.objectStore(storeName));
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

/**
 * Todos los alimentos volcados.
 * @returns {Promise<FoodsResult<import('../core/foods.js').Food[]>>}
 */
export function getAll() {
    return withStore('readonly', (store) => store.getAll());
}

/**
 * Sello de la siembra ya volcada, o `null`.
 * @returns {Promise<string | null>}
 */
async function storedStamp() {
    const r = await withStore('readonly', (store) => store.get('seed'), STORE_META);
    if (!r.ok || !r.value) return null;
    const stamp = /** @type {{ stamp?: unknown }} */ (r.value).stamp;
    return typeof stamp === 'string' ? stamp : null;
}

/**
 * Descarga el fichero empaquetado.
 *
 * Es una petición a un fichero PROPIO y precacheado — no sale de origen y no
 * lleva ningún dato del usuario, así que no rompe el «cero llamadas de red con
 * datos del usuario» ni la CSP `'self'`.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<FoodsResult<import('../core/foods.js').Food[]>>}
 */
export async function fetchSeed(fetchImpl) {
    const doFetch = fetchImpl ?? globalThis.fetch;
    if (typeof doFetch !== 'function') return { ok: false, error: 'foods.noFetch' };
    try {
        const res = await doFetch(SEED_URL);
        if (!res.ok) return { ok: false, error: `foods.seedHttp${res.status}` };
        const data = await res.json();
        const foods = Array.isArray(data?.foods) ? data.foods : null;
        if (!foods) return { ok: false, error: 'foods.seedMalformed' };
        return { ok: true, value: foods };
    } catch (err) {
        return { ok: false, error: message(err) };
    }
}

/** @type {import('../core/foods.js').Food[] | null} */
let memoryCache = null;

/**
 * Deja la base lista y devuelve todos los alimentos.
 *
 * ORDEN DE PREFERENCIA, y el porqué de cada escalón:
 *
 * 1. Caché en memoria: buscar mientras se teclea no puede ir a IndexedDB en
 *    cada pulsación.
 * 2. IndexedDB, si el sello coincide: es el camino normal y no toca la red.
 * 3. Fichero + volcado a IndexedDB: la primera vez, o cuando el sello cambió.
 * 4. Fichero solo, en memoria: si IndexedDB no está disponible. **No es un
 *    error para el usuario** — pierde la persistencia del volcado, no la
 *    función. Por eso este camino devuelve `ok`.
 *
 * @param {{ fetchImpl?: typeof fetch, force?: boolean }} [options]
 * @returns {Promise<FoodsResult<import('../core/foods.js').Food[]>>}
 */
export async function load(options = {}) {
    if (memoryCache && !options.force) return { ok: true, value: memoryCache };

    if (!options.force && await storedStamp() === SEED_STAMP) {
        const stored = await getAll();
        if (stored.ok && stored.value.length > 0) {
            memoryCache = stored.value;
            return { ok: true, value: memoryCache };
        }
    }

    const seed = await fetchSeed(options.fetchImpl);
    if (!seed.ok) return seed;
    memoryCache = seed.value;

    // El volcado es MEJORA, no requisito: si falla, se sigue con la memoria.
    // Convertir un fallo de IndexedDB en un fallo de la vista sería castigar al
    // usuario por una limitación del navegador.
    const written = await putAll(seed.value.map(withNormalizedName));
    if (written.ok) {
        await withStore('readwrite', (store) => store.put({ key: 'seed', stamp: SEED_STAMP }), STORE_META);
    }
    return { ok: true, value: memoryCache };
}

/**
 * Añade el campo por el que indexa IndexedDB. Se calcula al sembrar y no al
 * buscar: normalizar 2 000 nombres en cada pulsación de tecla es justo el tipo
 * de derroche que no se ve hasta que alguien lo mide.
 * @param {import('../core/foods.js').Food} food
 * @returns {import('../core/foods.js').Food & { nameNormalized: string }}
 */
function withNormalizedName(food) {
    return { ...food, nameNormalized: normalize(food?.n) };
}

/**
 * Cierra la conexión y olvida ambas cachés.
 *
 * La conexión a IndexedDB está cacheada en un módulo, así que sobrevive a todo
 * lo que no la cierre explícitamente. `photos-db.js` ya tenía este `close()` por
 * la misma razón; su ausencia aquí hacía que dos tests seguidos compartieran la
 * base del anterior, y el segundo pasaba «por lo que había dejado el primero».
 */
export function close() {
    if (cachedDb) {
        try { cachedDb.close(); } catch { /* cerrar dos veces no es un error */ }
    }
    cachedDb = null;
    memoryCache = null;
}

/** Olvida solo la caché en memoria, dejando la base volcada. */
export function resetCache() {
    memoryCache = null;
}

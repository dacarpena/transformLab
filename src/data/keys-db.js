// @ts-check

/**
 * La clave de datos, guardada en el dispositivo (M8-5b).
 *
 * ## Por qué IndexedDB y no localStorage
 *
 * Porque IndexedDB guarda **objetos `CryptoKey`**, y `localStorage` solo guarda
 * cadenas. Un `CryptoKey` con `extractable: false` se puede almacenar, recuperar
 * y usar, pero **no se puede leer**: ni la aplicación, ni una extensión, ni un
 * XSS pueden sacar sus bytes. Guardar la clave en `localStorage` obligaría a
 * escribirla en claro, y entonces cualquier script de la página se la lleva.
 *
 * Es la misma razón por la que las fotos viven en `photos-db.js`: hay cosas que
 * `localStorage` no puede guardar sin degradarlas.
 *
 * ## Degrada, no rompe
 *
 * En navegación privada de Safari, y con almacenamiento bloqueado, IndexedDB
 * puede no estar. Aquí eso **no es un error**: significa que la sincronización
 * pedirá la passkey en cada sesión en vez de recordar la clave. La aplicación
 * sigue funcionando entera sin cuenta, que es el invariante (§1).
 */

const DB_NAME = 'tl-keys';
const DB_VERSION = 1;
const STORE = 'keys';

/** @type {IDBDatabase | null} */
let cache = null;

/**
 * Abre la base. Devuelve `null` si IndexedDB no está disponible, en vez de
 * lanzar: quedarse sin caché de clave es una degradación, no un fallo.
 *
 * @returns {Promise<IDBDatabase | null>}
 */
function open() {
    if (cache) return Promise.resolve(cache);
    return new Promise((resolve) => {
        /** @type {*} */ let request;
        try {
            request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch {
            resolve(null);
            return;
        }
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
        };
        request.onsuccess = () => { cache = request.result; resolve(cache); };
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
    });
}

/**
 * Una operación sobre el almacén, sin lanzar nunca.
 *
 * @template T
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} operacion
 * @returns {Promise<T | null>}
 */
async function conAlmacen(mode, operacion) {
    const db = await open();
    if (!db) return null;
    return new Promise((resolve) => {
        /** @type {*} */ let request;
        try {
            request = operacion(db.transaction(STORE, mode).objectStore(STORE));
        } catch {
            resolve(null);
            return;
        }
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => resolve(null);
    });
}

/**
 * Guarda la clave de datos de una cuenta.
 *
 * La clave tiene que ser **no extraíble**: si no lo fuera, guardarla aquí sería
 * dejarla al alcance de cualquier script. Se comprueba en vez de confiar, porque
 * el fallo sería silencioso y permanente.
 *
 * @param {string} userId
 * @param {CryptoKey} dataKey
 * @returns {Promise<boolean>} `false` si no se pudo guardar (sin IndexedDB)
 */
export async function put(userId, dataKey) {
    if (dataKey.extractable) {
        throw new Error('no se guarda una clave extraíble: usa importDataKey primero');
    }
    const r = await conAlmacen('readwrite', (store) => store.put({ id: userId, dataKey }));
    return r !== null;
}

/**
 * Recupera la clave de datos de una cuenta, o `null`.
 * @param {string} userId
 * @returns {Promise<CryptoKey | null>}
 */
export async function get(userId) {
    const fila = /** @type {*} */ (await conAlmacen('readonly', (store) => store.get(userId)));
    const clave = fila?.dataKey;
    // Se comprueba lo que sale: una fila de una versión anterior, o manipulada
    // por otra pestaña, no puede colarse como clave.
    if (!clave || typeof clave !== 'object' || !('algorithm' in clave)) return null;
    return /** @type {CryptoKey} */ (clave);
}

/**
 * Olvida la clave de una cuenta. Es lo que hay que llamar al cerrar sesión:
 * dejarla aquí después de salir es dejar la puerta abierta al siguiente que
 * use el dispositivo.
 *
 * @param {string} userId
 */
export async function remove(userId) {
    await conAlmacen('readwrite', (store) => store.delete(userId));
}

/** Borra todas las claves. Para el borrado de cuenta y para las pruebas. */
export async function clear() {
    await conAlmacen('readwrite', (store) => store.clear());
}

/**
 * Suelta la referencia a la base. Solo para las pruebas: sin esto, una base
 * cerrada por el test anterior quedaría cacheada aquí y el siguiente fallaría
 * por una razón que no es la suya.
 */
export function resetForTests() {
    cache = null;
}

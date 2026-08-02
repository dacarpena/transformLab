// @ts-check

/**
 * Almacén de fotos de progreso en IndexedDB (tensión 1 del plan: dos capturas
 * revientan la cuota de localStorage, así que los blobs viven aquí y solo los
 * metadatos en `tl.5.<pid>.photos`).
 *
 * Es el ÚNICO módulo del proyecto que toca IndexedDB. API asíncrona con el
 * mismo contrato de resultado tipado que el resto de la capa de datos: nada
 * lanza, todo devuelve `{ok}`; un navegador sin IndexedDB degrada con error.
 */

/**
 * @typedef {{ id: string, profileId: string, dateISO: string, blob: Blob, note: string, bytes: number }} PhotoRecord
 * @typedef {{ id: string, profileId: string, dateISO: string, note: string, bytes: number }} PhotoMeta
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} PhotoResult
 */

const DB_NAME = 'tl-photos';
const DB_VERSION = 1;
const STORE = 'photos';
const INDEX_PROFILE = 'byProfile';

/** @type {IDBDatabase | null} */
let cachedDb = null;

/** @param {unknown} err @returns {string} */
function message(err) {
    if (err instanceof Error) return `${err.name}: ${err.message}`;
    return String(err);
}

/**
 * Abre (y crea si hace falta) la base. Cachea la conexión.
 * @returns {Promise<PhotoResult<IDBDatabase>>}
 */
function openDb() {
    return new Promise((resolve) => {
        if (cachedDb) return resolve({ ok: true, value: cachedDb });
        const idb = globalThis.indexedDB;
        if (!idb) return resolve({ ok: false, error: 'photos.indexedDbUnavailable' });

        /** @type {IDBOpenDBRequest} */ let request;
        try {
            request = idb.open(DB_NAME, DB_VERSION);
        } catch (err) {
            return resolve({ ok: false, error: message(err) });
        }
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'id' });
                store.createIndex(INDEX_PROFILE, 'profileId', { unique: false });
            }
        };
        request.onsuccess = () => {
            cachedDb = request.result;
            cachedDb.onclose = () => { cachedDb = null; };
            resolve({ ok: true, value: cachedDb });
        };
        request.onerror = () => resolve({ ok: false, error: message(request.error) });
        request.onblocked = () => resolve({ ok: false, error: 'photos.dbBlocked' });
    });
}

/**
 * Ejecuta una operación dentro de una transacción y resuelve con su resultado.
 * @template T
 * @param {IDBTransactionMode} mode
 * @param {(store: IDBObjectStore) => IDBRequest} operation
 * @returns {Promise<PhotoResult<T>>}
 */
async function withStore(mode, operation) {
    const db = await openDb();
    if (!db.ok) return db;
    return new Promise((resolve) => {
        /** @type {IDBTransaction} */ let tx;
        try {
            tx = db.value.transaction(STORE, mode);
        } catch (err) {
            return resolve({ ok: false, error: message(err) });
        }
        /** @type {IDBRequest} */ let request;
        try {
            request = operation(tx.objectStore(STORE));
        } catch (err) {
            return resolve({ ok: false, error: message(err) });
        }
        request.onsuccess = () => resolve({ ok: true, value: request.result });
        request.onerror = () => resolve({ ok: false, error: message(request.error) });
        tx.onabort = () => resolve({ ok: false, error: message(tx.error) });
    });
}

/** @param {unknown} v @returns {v is string} */
function isNonEmptyString(v) {
    return typeof v === 'string' && v !== '';
}

/**
 * Guarda una foto. El id lo aporta el llamante para que la operación sea
 * determinista y reintentable (y para que el metadato de localStorage y el
 * blob compartan clave sin depender del reloj).
 * @param {string} profileId
 * @param {{ id: string, dateISO: string, blob: Blob, note?: string }} photo
 * @returns {Promise<PhotoResult<PhotoMeta>>}
 */
export async function add(profileId, photo) {
    if (!isNonEmptyString(profileId)) return { ok: false, error: 'photos.profileIdInvalid' };
    if (!photo || typeof photo !== 'object') return { ok: false, error: 'photos.recordInvalid' };
    if (!isNonEmptyString(photo.id) || !isNonEmptyString(photo.dateISO)) {
        return { ok: false, error: 'photos.recordInvalid' };
    }
    const blob = photo.blob;
    if (!blob || typeof (/** @type {*} */ (blob).size) !== 'number') {
        return { ok: false, error: 'photos.blobInvalid' };
    }

    /** @type {PhotoRecord} */
    const record = {
        id: `${profileId}:${photo.id}`,
        profileId,
        dateISO: photo.dateISO,
        blob,
        note: typeof photo.note === 'string' ? photo.note.slice(0, 300) : '',
        bytes: blob.size
    };
    const written = await withStore('readwrite', (store) => store.put(record));
    if (!written.ok) return written;
    const { blob: _blob, ...meta } = record;
    void _blob;
    return { ok: true, value: meta };
}

/**
 * Recupera una foto con su blob.
 * @param {string} profileId
 * @param {string} photoId
 * @returns {Promise<PhotoResult<PhotoRecord | null>>}
 */
export async function get(profileId, photoId) {
    if (!isNonEmptyString(profileId) || !isNonEmptyString(photoId)) {
        return { ok: false, error: 'photos.profileIdInvalid' };
    }
    /** @type {PhotoResult<PhotoRecord | undefined>} */
    const found = await withStore('readonly', (store) => store.get(`${profileId}:${photoId}`));
    if (!found.ok) return found;
    return { ok: true, value: found.value ?? null };
}

/**
 * Lista los METADATOS de las fotos de un perfil (sin blobs: una galería no
 * necesita cargar decenas de megas en memoria para pintar la lista).
 * @param {string} profileId
 * @returns {Promise<PhotoResult<PhotoMeta[]>>}
 */
export async function list(profileId) {
    if (!isNonEmptyString(profileId)) return { ok: false, error: 'photos.profileIdInvalid' };
    /** @type {PhotoResult<PhotoRecord[]>} */
    const found = await withStore('readonly', (store) =>
        store.index(INDEX_PROFILE).getAll(IDBKeyRange.only(profileId)));
    if (!found.ok) return found;
    const metas = (found.value ?? [])
        .map(({ blob, ...meta }) => { void blob; return meta; })
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    return { ok: true, value: metas };
}

/**
 * Elimina una foto.
 * @param {string} profileId
 * @param {string} photoId
 * @returns {Promise<PhotoResult<undefined>>}
 */
export async function remove(profileId, photoId) {
    if (!isNonEmptyString(profileId) || !isNonEmptyString(photoId)) {
        return { ok: false, error: 'photos.profileIdInvalid' };
    }
    const deleted = await withStore('readwrite', (store) => store.delete(`${profileId}:${photoId}`));
    if (!deleted.ok) return deleted;
    return { ok: true, value: undefined };
}

/**
 * Borra TODAS las fotos de un perfil. Lo usa el borrado de perfil, para que
 * no queden blobs huérfanos ocupando disco tras eliminar sus metadatos.
 * @param {string} profileId
 * @returns {Promise<PhotoResult<number>>}
 */
export async function removeAll(profileId) {
    const metas = await list(profileId);
    if (!metas.ok) return metas;
    for (const meta of metas.value) {
        const photoId = meta.id.slice(profileId.length + 1);
        const deleted = await remove(profileId, photoId);
        if (!deleted.ok) return deleted;
    }
    return { ok: true, value: metas.value.length };
}

/**
 * Recuento y bytes ocupados por las fotos de un perfil, para el presupuesto
 * que la UI mostrará junto al de localStorage.
 * @param {string} profileId
 * @returns {Promise<PhotoResult<{ count: number, bytes: number }>>}
 */
export async function usage(profileId) {
    const metas = await list(profileId);
    if (!metas.ok) return metas;
    return {
        ok: true,
        value: {
            count: metas.value.length,
            bytes: metas.value.reduce((sum, m) => sum + (m.bytes || 0), 0)
        }
    };
}

/** Cierra la conexión cacheada (tests y cambio de perfil). */
export function close() {
    if (cachedDb) {
        cachedDb.close();
        cachedDb = null;
    }
}

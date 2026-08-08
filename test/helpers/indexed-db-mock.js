// @ts-check

/**
 * Doble mínimo de IndexedDB para node:test, con la superficie exacta que
 * consume `src/data/photos-db.js`: open + upgrade, transacciones,
 * put/get/getAll/delete y un índice secundario.
 *
 * Se escribe a mano en lugar de añadir `fake-indexeddb` porque CLAUDE.md §5
 * restringe las dependencias y aquí la superficie usada es pequeña.
 * Las peticiones resuelven de forma asíncrona (microtarea), como las reales.
 */

/** Dispara los callbacks de una petición en la siguiente microtarea. */
function settle(request, { result, error } = {}) {
    queueMicrotask(() => {
        if (error) {
            request.error = error;
            request.onerror?.({ target: request });
        } else {
            request.result = result;
            request.onsuccess?.({ target: request });
        }
    });
    return request;
}

class FakeRequest {
    constructor() {
        this.result = undefined;
        this.error = null;
        /** @type {((e: *) => void) | null} */ this.onsuccess = null;
        /** @type {((e: *) => void) | null} */ this.onerror = null;
    }
}

class FakeIndex {
    /** @param {Map<string, *>} rows @param {string} keyPath */
    constructor(rows, keyPath) {
        this.rows = rows;
        this.keyPath = keyPath;
    }
    /** @param {{ only: * } | *} range */
    getAll(range) {
        const wanted = range && typeof range === 'object' && 'only' in range ? range.only : range;
        const out = [...this.rows.values()].filter((row) => row[this.keyPath] === wanted);
        return settle(new FakeRequest(), { result: out });
    }
}

class FakeObjectStore {
    /**
     * @param {Map<string, *>} rows @param {Record<string, string>} indexes
     * @param {{failNext: boolean}} flags @param {string} [keyPath]
     */
    constructor(rows, indexes, flags, keyPath = 'id') {
        this.rows = rows;
        this.indexes = indexes;
        this.flags = flags;
        // El almacén de metadatos de `foods-db.js` usa `key`, no `id`. Con el
        // keyPath cableado a 'id', sus registros se guardaban todos bajo la
        // clave `undefined` y el mock mentía sobre lo que hace IndexedDB.
        this.keyPath = keyPath;
    }
    /** @param {*} record */
    put(record) {
        const request = new FakeRequest();
        if (this.flags.failNext) {
            this.flags.failNext = false;
            return settle(request, { error: Object.assign(new Error('quota'), { name: 'QuotaExceededError' }) });
        }
        this.rows.set(record[this.keyPath], record);
        return settle(request, { result: record[this.keyPath] });
    }
    /** @param {string} key */
    get(key) {
        return settle(new FakeRequest(), { result: this.rows.get(key) });
    }
    getAll() {
        return settle(new FakeRequest(), { result: [...this.rows.values()] });
    }
    count() {
        return settle(new FakeRequest(), { result: this.rows.size });
    }
    clear() {
        this.rows.clear();
        return settle(new FakeRequest(), { result: undefined });
    }
    /** @param {string} key */
    delete(key) {
        this.rows.delete(key);
        return settle(new FakeRequest(), { result: undefined });
    }
    /** @param {string} name */
    index(name) {
        const keyPath = this.indexes[name];
        if (!keyPath) throw new Error(`NotFoundError: index ${name}`);
        return new FakeIndex(this.rows, keyPath);
    }
    /** @param {string} name @param {string} keyPath */
    createIndex(name, keyPath) {
        this.indexes[name] = keyPath;
    }
}

class FakeDatabase {
    /** @param {string} name */
    constructor(name) {
        this.name = name;
        this.version = 0;
        /** @type {Map<string, Map<string, *>>} */ this.stores = new Map();
        /** @type {Record<string, Record<string, string>>} */ this.indexes = {};
        /** @type {Record<string, string>} */ this.keyPaths = {};
        this.flags = { failNext: false };
        /** @type {(() => void) | null} */ this.onclose = null;
        this.closed = false;
    }
    get objectStoreNames() {
        const names = [...this.stores.keys()];
        return { contains: (/** @type {string} */ n) => names.includes(n) };
    }
    /** @param {string} name @param {{ keyPath?: string }} [options] */
    createObjectStore(name, options) {
        this.stores.set(name, new Map());
        this.indexes[name] = {};
        this.keyPaths[name] = options?.keyPath ?? 'id';
        return new FakeObjectStore(
            /** @type {Map<string, *>} */ (this.stores.get(name)),
            this.indexes[name], this.flags, this.keyPaths[name]
        );
    }
    /** @param {string} name */
    transaction(name) {
        if (this.closed) throw new Error('InvalidStateError: database is closed');
        const rows = this.stores.get(name);
        if (!rows) throw new Error(`NotFoundError: store ${name}`);
        const store = new FakeObjectStore(rows, this.indexes[name], this.flags, this.keyPaths[name]);
        /** @type {{ objectStore: () => *, error: * , onabort: (() => void) | null, oncomplete: (() => void) | null, onerror: (() => void) | null }} */
        const tx = {
            objectStore: () => store,
            error: null,
            onabort: null,
            oncomplete: null,
            onerror: null
        };
        // `oncomplete` va DESPUÉS de las peticiones que se encolen dentro de la
        // transacción: dos microtareas, no una. Sin esto, un `putAll` veía su
        // `oncomplete` antes de escribir nada y el test no medía lo que creía.
        queueMicrotask(() => queueMicrotask(() => tx.oncomplete?.()));
        return tx;
    }
    close() {
        this.closed = true;
    }
}

/**
 * Instala un IndexedDB falso en globalThis y devuelve el control del doble.
 * @returns {{ databases: Map<string, FakeDatabase>, failNextWrite: () => void, reset: () => void }}
 */
export function installIndexedDbMock() {
    /** @type {Map<string, FakeDatabase>} */ const databases = new Map();

    // @ts-expect-error — inyección deliberada del doble
    globalThis.indexedDB = {
        /** @param {string} name @param {number} [version] */
        open(name, version = 1) {
            const request = new FakeRequest();
            // @ts-expect-error — el request de open tiene callbacks extra
            request.onupgradeneeded = null;
            // @ts-expect-error
            request.onblocked = null;
            queueMicrotask(() => {
                let db = databases.get(name);
                if (!db) {
                    db = new FakeDatabase(name);
                    databases.set(name, db);
                }
                db.closed = false;
                request.result = db;
                // La actualización se dispara al crear Y al subir de versión,
                // que es donde vive el salto 1→2 de `foods-db.js`. Sin la
                // segunda rama, el mock nunca ejercitaría una migración.
                const needsUpgrade = version > db.version;
                if (needsUpgrade) {
                    db.version = version;
                    // @ts-expect-error
                    request.onupgradeneeded?.({ target: request });
                }
                request.onsuccess?.({ target: request });
            });
            return request;
        }
    };
    // @ts-expect-error — el módulo usa IDBKeyRange.only
    globalThis.IDBKeyRange = { only: (/** @type {*} */ v) => ({ only: v }) };

    return {
        databases,
        failNextWrite() {
            for (const db of databases.values()) db.flags.failNext = true;
        },
        reset() {
            databases.clear();
        }
    };
}

/** Retira el doble, para probar la degradación sin IndexedDB. */
export function uninstallIndexedDbMock() {
    // @ts-expect-error
    delete globalThis.indexedDB;
    // @ts-expect-error
    delete globalThis.IDBKeyRange;
}

/** Blob mínimo (Node lo trae desde v18, pero así el test es explícito). */
export function makeBlob(bytes = 1024) {
    return new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
}

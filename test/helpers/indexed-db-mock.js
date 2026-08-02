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
    /** @param {Map<string, *>} rows @param {Record<string, string>} indexes @param {{failNext: boolean}} flags */
    constructor(rows, indexes, flags) {
        this.rows = rows;
        this.indexes = indexes;
        this.flags = flags;
    }
    /** @param {*} record */
    put(record) {
        const request = new FakeRequest();
        if (this.flags.failNext) {
            this.flags.failNext = false;
            return settle(request, { error: Object.assign(new Error('quota'), { name: 'QuotaExceededError' }) });
        }
        this.rows.set(record.id, record);
        return settle(request, { result: record.id });
    }
    /** @param {string} key */
    get(key) {
        return settle(new FakeRequest(), { result: this.rows.get(key) });
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
        /** @type {Map<string, Map<string, *>>} */ this.stores = new Map();
        /** @type {Record<string, Record<string, string>>} */ this.indexes = {};
        this.flags = { failNext: false };
        /** @type {(() => void) | null} */ this.onclose = null;
        this.closed = false;
    }
    get objectStoreNames() {
        const names = [...this.stores.keys()];
        return { contains: (/** @type {string} */ n) => names.includes(n) };
    }
    /** @param {string} name */
    createObjectStore(name) {
        this.stores.set(name, new Map());
        this.indexes[name] = {};
        return new FakeObjectStore(/** @type {Map<string, *>} */ (this.stores.get(name)), this.indexes[name], this.flags);
    }
    /** @param {string} name */
    transaction(name) {
        if (this.closed) throw new Error('InvalidStateError: database is closed');
        const rows = this.stores.get(name);
        if (!rows) throw new Error(`NotFoundError: store ${name}`);
        const store = new FakeObjectStore(rows, this.indexes[name], this.flags);
        return {
            objectStore: () => store,
            error: null,
            /** @type {(() => void) | null} */ onabort: null
        };
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
        /** @param {string} name */
        open(name) {
            const request = new FakeRequest();
            // @ts-expect-error — el request de open tiene callbacks extra
            request.onupgradeneeded = null;
            // @ts-expect-error
            request.onblocked = null;
            queueMicrotask(() => {
                let db = databases.get(name);
                const isNew = !db;
                if (!db) {
                    db = new FakeDatabase(name);
                    databases.set(name, db);
                }
                db.closed = false;
                request.result = db;
                // @ts-expect-error
                if (isNew) request.onupgradeneeded?.({ target: request });
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

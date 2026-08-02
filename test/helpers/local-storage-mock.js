// @ts-check

/**
 * Doble de localStorage para node:test, compatible con la interfaz Storage
 * que consume src/data/storage.js. Permite simular cuota llena.
 */
export class LocalStorageMock {
    constructor() {
        /** @type {Map<string, string>} */
        this.store = new Map();
        /** Si es true, setItem lanza QuotaExceededError (simulación de cuota llena). */
        this.quotaFull = false;
    }

    get length() {
        return this.store.size;
    }

    /** @param {number} index @returns {string | null} */
    key(index) {
        return [...this.store.keys()][index] ?? null;
    }

    /** @param {string} key @returns {string | null} */
    getItem(key) {
        return this.store.has(key) ? /** @type {string} */ (this.store.get(key)) : null;
    }

    /** @param {string} key @param {string} value */
    setItem(key, value) {
        if (this.quotaFull) {
            const err = new Error('exceeded the quota');
            err.name = 'QuotaExceededError';
            throw err;
        }
        this.store.set(key, String(value));
    }

    /** @param {string} key */
    removeItem(key) {
        this.store.delete(key);
    }

    clear() {
        this.store.clear();
    }
}

/**
 * Instala un mock limpio en globalThis.localStorage y lo devuelve.
 * @returns {LocalStorageMock}
 */
export function installLocalStorageMock() {
    const mock = new LocalStorageMock();
    // @ts-expect-error — inyección deliberada del doble en el entorno de test
    globalThis.localStorage = mock;
    return mock;
}

// @ts-check

/**
 * Doble de localStorage para node:test, compatible con la interfaz Storage
 * que consume src/data/storage.js. Permite simular cuota llena.
 */
/** @returns {Error} el error que lanza el localStorage real al llenarse */
function quotaError() {
    const err = new Error('exceeded the quota');
    err.name = 'QuotaExceededError';
    return err;
}

export class LocalStorageMock {
    constructor() {
        /** @type {Map<string, string>} */
        this.store = new Map();
        /** Si es true, setItem lanza SIEMPRE (cuota llena en su forma más dura). */
        this.quotaFull = false;
        /**
         * Cuota realista en caracteres: `setItem` solo falla si la escritura
         * HACE CRECER el total por encima del tope, igual que el localStorage
         * real. Sobrescribir con un valor menor o borrar siempre funciona, que
         * es lo que permite a un rollback operar con el almacén lleno.
         * @type {number}
         */
        this.maxChars = Infinity;
    }

    /** Tamaño total actual, en caracteres (clave + valor). */
    get usedChars() {
        let total = 0;
        for (const [k, v] of this.store) total += k.length + v.length;
        return total;
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
        const next = String(value);
        if (this.quotaFull) throw quotaError();
        if (this.maxChars !== Infinity) {
            const previous = this.store.get(key);
            const delta = (key.length + next.length) - (previous === undefined ? 0 : key.length + previous.length);
            if (delta > 0 && this.usedChars + delta > this.maxChars) throw quotaError();
        }
        this.store.set(key, next);
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

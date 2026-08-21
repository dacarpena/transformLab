// @ts-check

/**
 * Doble de R2 para `node:test`.
 *
 * Más estricto que el servicio, igual que el de D1, y por la misma razón: un
 * doble permisivo deja pasar código que solo falla en producción, donde ya no se
 * puede mirar. Aquí:
 *
 * - `put` **exige** `ArrayBuffer` o `Uint8Array`. R2 acepta también cadenas y
 *   `null`, y aceptarlos aquí escondería el día que alguien suba un objeto que
 *   en realidad era `undefined`.
 * - `list` **pagina de verdad** a partir de un número pequeño de objetos, para
 *   que el bucle del inventario se ejecute más de una vuelta en los tests. Con
 *   una sola página, la paginación no se prueba nunca y el `truncated` del
 *   servicio real aparece el día que alguien tiene muchas fotos.
 * - Las claves se guardan **ordenadas**, como las devuelve R2.
 */

/** Objetos por página en `list`. Pequeño a propósito: ver la cabecera. */
export const PAGINA = 3;

/** @returns {{ bucket: *, contenido: Map<string, Uint8Array> }} */
export function createR2() {
    /** @type {Map<string, Uint8Array>} */
    const contenido = new Map();

    const bucket = {
        /** @param {string} key */
        async get(key) {
            const bytes = contenido.get(key);
            if (bytes === undefined) return null;
            return {
                key,
                size: bytes.length,
                // Un `ReadableStream`, como el servicio: quien lo consuma tiene
                // que hacerlo como lo hará en producción.
                get body() {
                    return new ReadableStream({
                        start(controller) { controller.enqueue(bytes); controller.close(); }
                    });
                },
                async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length); }
            };
        },

        /** @param {string} key @param {ArrayBuffer | Uint8Array} value */
        async put(key, value) {
            if (!(value instanceof ArrayBuffer) && !(value instanceof Uint8Array)) {
                throw new TypeError('R2.put espera ArrayBuffer o Uint8Array');
            }
            const bytes = value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
            contenido.set(key, bytes);
            return { key, size: bytes.length };
        },

        /** @param {string | string[]} keys */
        async delete(keys) {
            for (const k of Array.isArray(keys) ? keys : [keys]) contenido.delete(k);
        },

        /** @param {{ prefix?: string, cursor?: string }} [options] */
        async list(options = {}) {
            const prefijo = options.prefix ?? '';
            const todas = [...contenido.keys()].filter((k) => k.startsWith(prefijo)).sort();
            const desde = options.cursor ? todas.indexOf(options.cursor) + 1 : 0;
            const trozo = todas.slice(desde, desde + PAGINA);
            const truncated = desde + PAGINA < todas.length;
            return {
                objects: trozo.map((k) => ({ key: k, size: /** @type {Uint8Array} */ (contenido.get(k)).length })),
                truncated,
                cursor: truncated ? trozo[trozo.length - 1] : undefined
            };
        }
    };

    return { bucket, contenido };
}

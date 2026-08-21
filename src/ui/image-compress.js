// @ts-check

/**
 * Comprimir una foto antes de guardarla (M9-5).
 *
 * ## Por qué se comprime, y por qué en el cliente
 *
 * Una foto de un móvil moderno son entre tres y ocho megas. Guardarlas tal cual
 * llena IndexedDB en una tarde y hace que sincronizar sea inviable en una red
 * móvil. Comprimida a 1600 px de lado y WebP de calidad 0,82, la misma foto pesa
 * entre 150 y 250 KB: **veinte o treinta veces menos**, y a la distancia a la que
 * se mira una foto de progreso no se distingue.
 *
 * Y en el cliente porque no hay alternativa: lo que sube al servidor va cifrado,
 * así que allí nadie puede abrirlo para recomprimirlo. Cloudflare Images existe
 * precisamente para esto y no sirve aquí, porque su trabajo entero es leer la
 * imagen.
 *
 * ## Lo que se pierde a propósito
 *
 * **Los metadatos.** Pasar por un lienzo tira el EXIF entero, y eso incluye las
 * coordenadas GPS y el modelo del teléfono. En una foto de progreso —de una
 * persona, en su casa— eso no es un efecto secundario aceptable: es el efecto
 * que se busca. Una foto que se sincroniza no debe llevar dentro dónde se hizo.
 *
 * Lo que sí hay que recuperar del EXIF es la **orientación**, o las fotos hechas
 * en vertical salen tumbadas. `createImageBitmap` sabe hacerlo con
 * `imageOrientation: 'from-image'`, que aplica la rotación a los píxeles y
 * después ya no hace falta el metadato.
 *
 * ## Degradación
 *
 * WebP lo entienden todos los navegadores desde 2020; el respaldo a JPEG está
 * porque un Safari viejo sigue existiendo y porque `OffscreenCanvas` no está en
 * todos. Si nada de esto se puede hacer —sin `createImageBitmap`, sin lienzo—,
 * se devuelve **el fichero original**: guardar la foto grande es peor que
 * guardarla comprimida, y muchísimo mejor que no guardarla.
 */

/** Lado mayor de la imagen guardada, en píxeles. */
export const MAX_SIDE = 1600;

/** Calidad de WebP. 0,82 es el punto donde dejar de bajar ya no ahorra tamaño. */
export const QUALITY = 0.82;

/** Los tipos que se intentan, en orden. */
const TIPOS = ['image/webp', 'image/jpeg'];

/**
 * @typedef {Object} Comprimida
 * @property {Blob} blob
 * @property {string} contentType
 * @property {number} width
 * @property {number} height
 * @property {boolean} compressed `false` si se devolvió el original
 */

/**
 * Comprime una imagen. **No lanza nunca**: una foto que no se puede comprimir se
 * guarda como vino.
 *
 * @param {Blob} file
 * @returns {Promise<Comprimida>}
 */
export async function compress(file) {
    const original = {
        blob: file, contentType: file.type || 'application/octet-stream',
        width: 0, height: 0, compressed: false
    };
    if (typeof createImageBitmap !== 'function') return original;

    /** @type {ImageBitmap | null} */ let bitmap = null;
    try {
        // `from-image` aplica la orientación del EXIF a los píxeles. Sin esto,
        // las fotos hechas en vertical salen tumbadas en cuanto se pierde el
        // metadato —y perderlo es justo lo que hace este módulo—.
        bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
        return original;
    }

    try {
        const { width, height } = escalar(bitmap.width, bitmap.height, MAX_SIDE);
        const lienzo = crearLienzo(width, height);
        if (!lienzo) return original;

        const ctx = /** @type {*} */ (lienzo.getContext('2d'));
        if (!ctx) return original;
        ctx.drawImage(bitmap, 0, 0, width, height);

        for (const tipo of TIPOS) {
            const blob = await aBlob(lienzo, tipo, QUALITY);
            // Un navegador que no sabe codificar un tipo devuelve PNG en vez de
            // fallar, y un PNG de una foto pesa MÁS que el original. Se
            // comprueba lo que salió, no lo que se pidió.
            if (blob && blob.type === tipo) {
                // Si comprimir no ahorró nada —una imagen ya pequeña y ya
                // optimizada—, se queda la original: recodificar por recodificar
                // solo pierde calidad.
                if (blob.size >= file.size && width === bitmap.width) return original;
                return { blob, contentType: tipo, width, height, compressed: true };
            }
        }
        return original;
    } catch {
        return original;
    } finally {
        bitmap.close?.();
    }
}

/**
 * Las dimensiones tras encajar en un cuadrado de `max`, conservando la
 * proporción. Una imagen que ya cabe **no se agranda**.
 *
 * @param {number} w
 * @param {number} h
 * @param {number} max
 * @returns {{ width: number, height: number }}
 */
export function escalar(w, h, max) {
    if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
        return { width: 1, height: 1 };
    }
    const mayor = Math.max(w, h);
    if (mayor <= max) return { width: Math.round(w), height: Math.round(h) };
    const factor = max / mayor;
    // Al menos un píxel: una panorámica extrema podría redondear a cero, y un
    // lienzo de altura cero lanza al dibujar.
    return {
        width: Math.max(1, Math.round(w * factor)),
        height: Math.max(1, Math.round(h * factor))
    };
}

/** Un lienzo fuera de pantalla, o uno del DOM si no lo hay. */
function crearLienzo(/** @type {number} */ width, /** @type {number} */ height) {
    if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
    if (typeof document === 'undefined') return null;
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
}

/**
 * El blob de un lienzo, sea del tipo que sea.
 *
 * `OffscreenCanvas` da una promesa y `HTMLCanvasElement` un callback; se unifican
 * aquí para que el camino de arriba no tenga dos ramas.
 *
 * @param {*} lienzo
 * @param {string} type
 * @param {number} quality
 * @returns {Promise<Blob | null>}
 */
function aBlob(lienzo, type, quality) {
    if (typeof lienzo.convertToBlob === 'function') {
        return lienzo.convertToBlob({ type, quality }).catch(() => null);
    }
    return new Promise((resolve) => {
        try {
            lienzo.toBlob((/** @type {Blob | null} */ b) => resolve(b), type, quality);
        } catch {
            resolve(null);
        }
    });
}

// @ts-check

/**
 * Las fotos, entre este dispositivo y R2 (M9-5).
 *
 * `photos-db.js` sigue siendo el almacén local y no se entera de que existe una
 * red; este módulo es el único que sabe subir y bajar, y lo que viaja va cifrado
 * con la misma clave que todo lo demás.
 *
 * ## Qué viaja y qué no
 *
 * El **puntero** —id, fecha, nota— viaja por la sincronía normal, dentro de la
 * colección `photos`, como una fila cifrada más. El **blob** viaja aparte,
 * porque son cientos de kilobytes y una fila de D1 no es sitio para eso.
 *
 * Eso deja una consecuencia que hay que mirar de frente: **el puntero y el blob
 * pueden desincronizarse**. Un puntero sin blob es una foto que se ve como un
 * hueco; un blob sin puntero es un objeto que nadie reclama y que ocupa cuota.
 * El primero se resuelve bajándolo cuando la galería lo pida; el segundo, con el
 * barrido de huérfanos, que compara el inventario del servidor con lo que hay
 * aquí. Ninguno de los dos se arregla solo, y por eso los dos tienen su función.
 *
 * ## El orden de una subida, y por qué es ése
 *
 * Primero el blob, después el puntero. Al revés —puntero primero— el otro
 * dispositivo vería la foto en la galería antes de que existiera nada que
 * enseñar, y tendría que explicar un hueco. Con este orden, lo peor que puede
 * pasar es un objeto huérfano, que no se ve y que el barrido recoge.
 *
 * ## `additionalData`, otra vez
 *
 * El criptograma se ata a `photo/<perfil>/<foto>`. Un objeto movido a otra clave
 * del bucket **no descifra**: quien pudiera escribir en R2 no puede intercambiar
 * la foto de enero por la de marzo sin que se note.
 */

import { request, requestBinary } from './api.js';
import * as keysDb from './keys-db.js';
import { encryptBytes, decryptBytes } from './crypto.js';

/** La forma de un identificador que puede ir en la clave del objeto. */
const SEGMENTO_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * El `additionalData` de una foto. Distinto del de las colecciones —lleva
 * `photo/` delante— para que un criptograma de una fila nunca pueda pasar por el
 * de una foto ni al revés.
 */
const aad = (/** @type {string} */ profileId, /** @type {string} */ photoId) =>
    `photo/${profileId}/${photoId}`;

/**
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} Resultado
 * @template T
 */

/**
 * La clave de datos de este dispositivo, o `null`.
 *
 * Las fotos NO necesitan la clave de índice: su sitio en el servidor lo decide
 * el `photoId`, que ya es opaco y aleatorio, no un HMAC de nada.
 *
 * @param {string} userId
 */
const claveDe = (userId) => keysDb.get(userId);

/**
 * Sube una foto ya comprimida.
 *
 * @param {string} userId
 * @param {string} profileId
 * @param {string} photoId
 * @param {Blob} blob
 * @returns {Promise<Resultado<{ bytes: number, used: number, limit: number }>>}
 */
export async function upload(userId, profileId, photoId, blob) {
    if (!SEGMENTO_RE.test(profileId) || !SEGMENTO_RE.test(photoId)) {
        return { ok: false, error: 'photos.badKey' };
    }
    const dk = await claveDe(userId);
    if (!dk) return { ok: false, error: 'sync.locked' };

    const claro = new Uint8Array(await blob.arrayBuffer());
    const sobre = await encryptBytes(dk, claro, aad(profileId, photoId));

    const r = await requestBinary(`/api/photos/${photoId}?profile=${profileId}`, {
        method: 'PUT', body: sobre
    });
    if (!r.ok) return { ok: false, error: r.error };

    const datos = /** @type {*} */ (r.value);
    return {
        ok: true,
        value: {
            bytes: Number(datos?.bytes) || sobre.length,
            used: Number(datos?.used) || 0,
            limit: Number(datos?.limit) || 0
        }
    };
}

/**
 * Baja una foto y la descifra.
 *
 * Devuelve un `Blob` sin tipo declarado: **el tipo lo pone quien la guarda**, no
 * el servidor. Aquí solo hay bytes, y decirle al navegador que unos bytes son un
 * `image/webp` sin haberlo comprobado es la clase de suposición que acaba
 * pintando basura.
 *
 * @param {string} userId
 * @param {string} profileId
 * @param {string} photoId
 * @param {string} [contentType] el que dijo el puntero, si lo dijo
 * @returns {Promise<Resultado<Blob>>}
 */
export async function download(userId, profileId, photoId, contentType) {
    if (!SEGMENTO_RE.test(profileId) || !SEGMENTO_RE.test(photoId)) {
        return { ok: false, error: 'photos.badKey' };
    }
    const dk = await claveDe(userId);
    if (!dk) return { ok: false, error: 'sync.locked' };

    const r = await requestBinary(`/api/photos/${photoId}?profile=${profileId}`);
    if (!r.ok) return { ok: false, error: r.error };

    const claro = await decryptBytes(dk, /** @type {Uint8Array} */ (r.value), aad(profileId, photoId));
    // No descifra: o los bytes están manipulados, o son de otra clave, o vienen
    // de OTRA foto. Los tres casos son el mismo desde aquí y ninguno se traga.
    if (!claro) return { ok: false, error: 'photos.undecryptable' };

    return {
        ok: true,
        value: new Blob([/** @type {BlobPart} */ (/** @type {*} */ (claro))], typeof contentType === 'string' && contentType !== ''
            ? { type: contentType }
            : undefined)
    };
}

/**
 * Borra una foto del servidor. Borrar algo que ya no está cuenta como éxito.
 *
 * @param {string} profileId
 * @param {string} photoId
 * @returns {Promise<Resultado<true>>}
 */
export async function remove(profileId, photoId) {
    if (!SEGMENTO_RE.test(profileId) || !SEGMENTO_RE.test(photoId)) {
        return { ok: false, error: 'photos.badKey' };
    }
    const r = await request(`/api/photos/${photoId}?profile=${profileId}`, { method: 'DELETE' });
    return r.ok ? { ok: true, value: /** @type {true} */ (true) } : { ok: false, error: r.error };
}

/**
 * @typedef {Object} Inventario
 * @property {{ profileId: string, photoId: string, bytes: number }[]} objects
 * @property {boolean} complete si se pudo listar el bucket entero
 * @property {number} used
 * @property {number} limit
 */

/**
 * Qué hay en el servidor.
 *
 * @param {void} [_]
 * @returns {Promise<Resultado<Inventario>>}
 */
export async function inventory(_) {
    const r = await request('/api/photos');
    if (!r.ok) return { ok: false, error: r.error };
    const d = /** @type {*} */ (r.value);
    if (!Array.isArray(d?.objects)) return { ok: false, error: 'api.badResponse' };
    return {
        ok: true,
        value: {
            objects: d.objects.filter((/** @type {*} */ o) =>
                typeof o?.profileId === 'string' && typeof o?.photoId === 'string'),
            complete: d.complete === true,
            used: Number(d.used) || 0,
            limit: Number(d.limit) || 0
        }
    };
}

/**
 * Decide qué objetos del servidor sobran.
 *
 * **Es una función pura, y eso es lo importante.** Borrar fotos ajenas por un
 * inventario mal interpretado es irreversible, así que la decisión se toma en un
 * sitio que se puede probar sin red, sin claves y sin almacén.
 *
 * Las tres reglas, y las tres existen por un caso concreto:
 *
 * 1. **Un inventario incompleto no borra nada.** Con media lista, todo lo que no
 *    se llegó a leer parece huérfano.
 * 2. **Solo se juzgan los perfiles que este dispositivo conoce.** Un perfil que
 *    vive en otro móvil y que aquí no está no tiene por qué perder sus fotos
 *    porque desde aquí no se vean.
 * 3. **Solo se borra lo que no tiene puntero.** Un objeto con puntero es una
 *    foto viva aunque su blob no esté cacheado aquí.
 *
 * @param {Inventario} inventario
 * @param {Map<string, Set<string>>} punteros de perfil conocido a sus ids de foto
 * @returns {{ profileId: string, photoId: string, bytes: number }[]}
 */
export function orphans(inventario, punteros) {
    if (!inventario.complete) return [];
    return inventario.objects.filter((o) => {
        const conocidos = punteros.get(o.profileId);
        if (conocidos === undefined) return false;
        return !conocidos.has(o.photoId);
    });
}

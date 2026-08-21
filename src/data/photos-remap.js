// @ts-check

/**
 * Reetiquetar las fotos cuando el perfil cambia de id (M9-1).
 *
 * ## Por qué es una fase aparte
 *
 * Las fotos viven en IndexedDB, que es **asíncrono**, mientras que el resto de
 * la migración es síncrona sobre `localStorage`. Y llevan **doble vínculo** con
 * su perfil, no uno:
 *
 * ```js
 * { id: `${profileId}:${photoId}`,   // clave PRIMARIA, con el perfil embebido
 *   profileId,                        // campo, con índice `byProfile` encima
 *   blob, dateISO, note, bytes }
 * ```
 *
 * Hay que mover los dos. Cambiar solo el campo deja la clave primaria apuntando
 * al perfil viejo; cambiar solo la clave deja el índice mintiendo. Y la clave
 * primaria **no se puede actualizar en su sitio** —es el `keyPath`—, así que
 * cada foto es un `put` con el registro nuevo más un `delete` del viejo.
 *
 * ## Lo que pasa si se interrumpe
 *
 * Los metadatos de la foto sí viven en `localStorage` y sí migran, pero solo
 * guardan el id corto. Si esta fase no corre, `photosDb.get(nuevoId, 'ph_…')`
 * devuelve `null` y la galería **se acorta sin decir nada** — que es justo lo
 * que §D9 prohíbe. Por eso:
 *
 * - **`put` y `delete` en la MISMA transacción.** Ahí está la garantía: si la
 *   transacción aborta, IndexedDB revierte las dos y no queda nada a medias. El
 *   orden entre ellas es indiferente para eso —dentro de una transacción no hay
 *   un «entre medias» observable—; se escribe `put` primero solo porque es el
 *   orden que también sería seguro si algún día se separaran, y porque se lee
 *   mejor. Lo que **no** puede hacerse es ponerlas en transacciones distintas.
 * - **`put`, no `add`.** `add` falla si la clave ya existe, y volver a pasar por
 *   una foto ya movida es el caso NORMAL de la re-entrada.
 * - **Por lotes.** Una sola transacción con cuatrocientas fotos es una
 *   transacción que tarda segundos y que se pierde entera si algo la corta.
 * - **Criterio de terminación observable**: no quedan fotos con el id viejo.
 *   No un contador, no un porcentaje: la pregunta que de verdad importa.
 *
 * ## Sin IndexedDB, la fase está HECHA
 *
 * En navegación privada de Safari IndexedDB puede no existir. Si no hay base, no
 * hay fotos que mover, y tratarlo como error bloquearía el arranque de alguien
 * que no tiene ni una foto. Se marca como hecha y se sigue.
 */

import * as photosDb from './photos-db.js';

/**
 * Fotos por transacción. Veinticinco es un compromiso medido contra el tamaño
 * típico de una foto comprimida (~200 KB): unos 5 MB de blobs vivos por
 * transacción, que cualquier navegador aguanta, y un lote perdido cuesta poco
 * volver a hacerlo.
 */
const BATCH = 25;

/**
 * @typedef {Object} RelabelReport
 * @property {boolean} done si no queda ninguna foto bajo un id viejo
 * @property {number} moved fotos movidas en ESTA pasada
 * @property {number} pending fotos que siguen con el id viejo
 * @property {string[]} errors pares que no se pudieron completar
 * @property {boolean} skipped si no había base de datos que tocar
 */

/**
 * Mueve todas las fotos de los ids viejos a los nuevos.
 *
 * **Es idempotente**: llamarla dos veces deja el mismo resultado, y llamarla
 * cuando ya está todo movido no hace nada. Se puede llamar en cada arranque sin
 * pensar.
 *
 * @param {Record<string, string>} map viejo → nuevo
 * @returns {Promise<RelabelReport>}
 */
export async function relabel(map) {
    /** @type {RelabelReport} */
    const report = { done: true, moved: 0, pending: 0, errors: [], skipped: false };

    const pares = Object.entries(map).filter(([viejo, nuevo]) => viejo !== nuevo);
    if (pares.length === 0) return report;

    for (const [viejo, nuevo] of pares) {
        const claves = await photosDb.keysOfProfile(viejo);
        if (!claves.ok) {
            if (claves.error === 'photos.indexedDbUnavailable') {
                // No hay base: no hay fotos. La fase está hecha, y bloquear el
                // arranque por esto sería castigar a quien no tiene ni una foto.
                return { ...report, skipped: true };
            }
            report.done = false;
            report.errors.push(`${viejo}: ${claves.error}`);
            continue;
        }
        if (claves.value.length === 0) continue;   // ya movidas, o nunca hubo

        for (let i = 0; i < claves.value.length; i += BATCH) {
            const lote = claves.value.slice(i, i + BATCH);
            const movido = await moverLote(lote, viejo, nuevo);
            if (movido.ok) {
                report.moved += movido.value;
            } else {
                report.done = false;
                report.errors.push(`${viejo}: ${movido.error}`);
                // Se sigue con el lote siguiente: un lote que falla no tiene por
                // qué condenar a los demás, y la re-entrada volverá a por él.
            }
        }

        const quedan = await photosDb.countOfProfile(viejo);
        if (!quedan.ok || quedan.value > 0) {
            report.done = false;
            report.pending += quedan.ok ? quedan.value : 0;
        }
    }

    return report;
}

/**
 * Mueve un lote dentro de UNA transacción.
 *
 * @param {readonly string[]} claves claves primarias viejas
 * @param {string} viejo
 * @param {string} nuevo
 * @returns {Promise<{ ok: true, value: number } | { ok: false, error: string }>}
 */
async function moverLote(claves, viejo, nuevo) {
    return photosDb.withTransaction('readwrite', (store) => {
        let movidas = 0;
        for (const clave of claves) {
            const lectura = store.get(clave);
            lectura.onsuccess = () => {
                const registro = lectura.result;
                if (!registro) return;   // otra pasada llegó antes

                // El id corto se saca quitando el prefijo del perfil VIEJO, que
                // es de longitud conocida. No se parte por ':' porque nada
                // impide que el id de la foto lleve uno.
                const corto = String(registro.id).slice(viejo.length + 1);
                // Las dos en ESTA transacción: si aborta, se revierten juntas.
                // El orden entre ellas no cambia nada —dentro de una
                // transacción no hay un «entre medias» observable— y por eso no
                // hay test que lo distinga; lo que sí importa, y sí está
                // probado, es que compartan transacción.
                store.put({ ...registro, id: `${nuevo}:${corto}`, profileId: nuevo });
                store.delete(clave);
                movidas += 1;
            };
        }
        // Se devuelve una función porque el recuento no está listo hasta que
        // todas las lecturas han resuelto — y para entonces la transacción ya
        // está confirmando. `withTransaction` resuelve en `oncomplete`, así que
        // este valor se lee después.
        return { get count() { return movidas; } };
    }).then((r) => (r.ok
        ? { ok: /** @type {true} */ (true), value: /** @type {*} */ (r.value).count }
        : { ok: /** @type {false} */ (false), error: r.error }));
}

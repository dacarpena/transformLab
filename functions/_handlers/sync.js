// @ts-check

/**
 * El pull: traerse lo que ha cambiado (M9-3).
 *
 * **Esta etapa es de SOLO LECTURA.** No hay ningún camino por el que una
 * petición pueda destruir un dato del usuario todavía; empujar es M9-4. Es a
 * propósito: la sincronización se estrena por la mitad que no puede romper
 * nada, y así el cliente que la consume se prueba contra datos reales antes de
 * que exista la mitad que sí puede.
 *
 * ## Lo que el servidor devuelve
 *
 * Bytes. `ciphertext` es la fila cifrada con la clave de datos del usuario, que
 * nunca sale de su dispositivo, e `item_tag` es un HMAC — no el `dateISO`. El
 * servidor no sabe de qué día es un check-in ni cómo se llama una receta.
 *
 * ## Por qué `?since=<seq>` y no `?since=<fecha>`
 *
 * `seq` es un contador de la cuenta que solo avanza. Un cursor por fecha
 * obligaría a los dos lados a estar de acuerdo sobre la hora, y los relojes de
 * los móviles están mal: una fila escrita por un teléfono adelantado quedaría
 * «en el futuro» y el pull siguiente se la saltaría para siempre.
 */

import { json, fail } from '../_lib/http.js';
import { encode } from '../_lib/base64url.js';

/**
 * Filas por página.
 *
 * Doscientas y no dos mil: cada fila lleva su criptograma, y una respuesta de
 * varios megabytes es exactamente lo que no se quiere en un móvil con mala
 * cobertura — se corta a la mitad y hay que empezar de cero. Con el cursor, una
 * página perdida solo cuesta esa página.
 */
const PAGE = 200;

/** @param {EventContext} ctx */
const alcance = (ctx) => /** @type {import('../_lib/db.js').Scope} */ (ctx.data.scope);

/**
 * `GET /api/sync?since=<seq>`
 *
 * @param {EventContext} ctx
 */
export async function pull(ctx) {
    const url = new URL(ctx.request.url);
    const crudo = url.searchParams.get('since') ?? '0';

    // El cursor se valida en vez de confiarse: un `since` negativo devolvería
    // filas ya vistas —caro— y un `NaN` haría que la comparación `seq > ?` no
    // cumpliera nada y la respuesta llegara vacía en silencio, que es peor.
    const since = Number(crudo);
    if (!Number.isSafeInteger(since) || since < 0) return fail(400, 'sync.badCursor');

    const scope = alcance(ctx);
    const { rows, hasMore } = await scope.recordsSince({ since, limit: PAGE });

    // El `seq` hasta el que se ha leído. Si no vino nada, se conserva el cursor
    // que traía el cliente: devolver 0 le haría volver a empezar.
    const nextSince = rows.length > 0 ? rows[rows.length - 1].seq : since;

    return json({
        rows: rows.map((/** @type {*} */ r) => ({
            profileId: r.profile_id,
            collection: r.collection,
            itemTag: encode(r.item_tag),
            // Una lápida no lleva cuerpo: no hay nada que decir de una fila
            // borrada, y mandar bytes vacíos gasta ancho de banda por nada.
            ciphertext: r.deleted ? null : encode(r.ciphertext),
            rev: r.rev,
            seq: r.seq,
            updatedAt: r.updated_at,
            deleted: Boolean(r.deleted)
        })),
        nextSince,
        hasMore,
        // El tope de la cuenta, para que el cliente sepa cuánto le queda sin
        // tener que pedir otra página a ciegas.
        lastSeq: await scope.lastSeq()
    });
}

/**
 * `GET /api/account/records` — cuántas filas hay y cuánto ocupan.
 *
 * No sirve para sincronizar: es lo que la vista de Cuenta necesita para poder
 * decirle a alguien cuánto ocupa lo suyo, y lo que hace falta en un runbook para
 * saber si una cuenta se ha ido de tamaño. Se separa del pull a propósito —un
 * `COUNT(*)` en el camino caliente cuesta lo mismo que la consulta entera—.
 *
 * @param {EventContext} ctx
 */
export async function stats(ctx) {
    const scope = alcance(ctx);
    const { count, bytes } = await scope.recordStats();
    return json({ count, bytes, lastSeq: await scope.lastSeq() });
}

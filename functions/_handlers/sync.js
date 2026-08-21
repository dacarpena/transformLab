// @ts-check

/**
 * La sincronización, lado servidor: bajar (M9-3) y subir (M9-4).
 *
 * ## El servidor no entiende nada de lo que guarda
 *
 * Valida el SOBRE y solo el sobre: que la colección esté en el catálogo, que el
 * perfil tenga forma de identificador, que el criptograma no pase de tamaño.
 * Lo de dentro es opaco, y por eso el catálogo se importa de
 * `src/data/sync-policy.js` en vez de teclearse aquí: una lista repetida es una
 * lista que se queda vieja, y la que se quedaría vieja sería la del servidor,
 * que es la que nadie mira.
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

import { json, fail, readJson } from '../_lib/http.js';
import { encode, decode } from '../_lib/base64url.js';
import { collections as catalogo, scopeOf } from '../../src/data/sync-policy.js';

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
 * Filas por push.
 *
 * Cincuenta y no quinientas: cada fila son DOS sentencias SQL —archivar al
 * perdedor y escribir— y el lote entero va en una transacción. Un lote enorme
 * mantiene la base bloqueada más tiempo del que ningún dispositivo necesita, y
 * un móvil que pierde cobertura a la mitad reintenta cincuenta filas, no
 * quinientas.
 */
const MAX_ROWS = 50;

/** Tamaño máximo de un criptograma. Una receta larga cabe de sobra. */
const MAX_CIPHERTEXT = 128 * 1024;

/** Tamaño máximo del cuerpo entero, para que el lote quepa en un móvil malo. */
const MAX_BODY = 2 * 1024 * 1024;

/** La forma de un identificador de perfil (esquema v7: opaco, base64url). */
const PROFILE_RE = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * `POST /api/sync` — subir un lote de filas cifradas.
 *
 * ## Qué decide quién gana
 *
 * El que escribe ahora. Es «gana el último» con el reloj del SERVIDOR, que es
 * el único que las dos partes comparten —los relojes de los móviles están mal, y
 * dejar que un teléfono adelantado gane siempre sería un fallo silencioso—.
 *
 * **Pero el perdedor no se tira.** Si la fila guardada iba por delante de la
 * revisión sobre la que el cliente editó, su cuerpo se copia a
 * `record_conflicts` antes de sobrescribirlo, en la misma transacción. Perder
 * una versión es aceptable; perderla sin dejar rastro no.
 *
 * @param {EventContext} ctx
 */
export async function push(ctx) {
    const cuerpo = await readJson(ctx.request, MAX_BODY);
    if (!cuerpo.ok) return fail(400, cuerpo.error);

    const crudas = /** @type {*} */ (cuerpo.value)?.rows;
    if (!Array.isArray(crudas)) return fail(400, 'sync.badBody');
    if (crudas.length > MAX_ROWS) return fail(413, 'sync.tooManyRows');

    /** @type {*[]} */ const filas = [];
    for (const fila of crudas) {
        const revisada = revisarFila(fila);
        // Una sola fila mal formada tumba el lote entero en vez de colarse a
        // medias: un push parcial dejaría al cliente creyendo que subió todo, y
        // su sombra apuntaría a filas que no están.
        if (!revisada) return fail(400, 'sync.badRow');
        filas.push(revisada);
    }

    const scope = alcance(ctx);
    const salida = await scope.pushRecords({ rows: filas, now: Date.now() });
    // `null` es la cuenta borrada mientras el push viajaba. No es un 500: el
    // cliente tiene que dejar de reintentar y volver a autenticarse.
    if (!salida) return fail(404, 'sync.noAccount');

    return json({
        results: salida.results,
        conflicts: salida.conflicts,
        lastSeq: salida.lastSeq
    });
}

/**
 * Comprueba una fila del push y la deja lista para el SQL, o devuelve `null`.
 *
 * @param {*} fila
 * @returns {* | null}
 */
function revisarFila(fila) {
    if (fila === null || typeof fila !== 'object') return null;
    if (typeof fila.profileId !== 'string' || !PROFILE_RE.test(fila.profileId)) return null;
    if (typeof fila.collection !== 'string' || !catalogo().includes(fila.collection)) return null;
    // Una colección declarada local no se guarda aunque la manden. El ámbito lo
    // fija la política, no el cliente.
    if (scopeOf(fila.collection) !== 'sync') return null;

    const tag = decode(fila.itemTag);
    // 16 bytes exactos: es un HMAC truncado, no una cadena libre. Aceptar
    // cualquier longitud dejaría meter etiquetas gigantes en la clave primaria.
    if (!tag || tag.length !== 16) return null;

    const baseRev = fila.baseRev;
    if (!Number.isSafeInteger(baseRev) || baseRev < 0) return null;

    const deleted = fila.deleted === true;
    if (deleted) {
        // Una lápida no lleva cuerpo, y el esquema lo EXIGE. Mandarlo con
        // criptograma sería una fila que la base rechaza a mitad del lote.
        if (fila.ciphertext !== null && fila.ciphertext !== undefined) return null;
        return { profileId: fila.profileId, collection: fila.collection,
                 itemTag: tag, itemTag_b64: fila.itemTag, ciphertext: null, deleted: true, baseRev };
    }

    if (typeof fila.ciphertext !== 'string') return null;
    const ct = decode(fila.ciphertext);
    if (!ct || ct.length === 0 || ct.length > MAX_CIPHERTEXT) return null;

    return { profileId: fila.profileId, collection: fila.collection,
             itemTag: tag, itemTag_b64: fila.itemTag, ciphertext: ct, deleted: false, baseRev };
}

/**
 * `GET /api/sync/conflicts` — las versiones que perdieron.
 *
 * Cifradas, como todo lo demás. El cliente las descifra con su DK y puede
 * enseñárselas a su dueño; el servidor las devuelve sin saber qué son.
 *
 * @param {EventContext} ctx
 */
export async function conflicts(ctx) {
    const filas = await alcance(ctx).conflicts({ limit: 100 });
    return json({
        rows: filas.map((/** @type {*} */ r) => ({
            profileId: r.profile_id,
            collection: r.collection,
            itemTag: encode(r.item_tag),
            ciphertext: r.ciphertext ? encode(r.ciphertext) : null,
            rev: r.rev,
            updatedAt: r.updated_at,
            deleted: Boolean(r.deleted),
            detectedAt: r.detected_at
        }))
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
    return json({
        count, bytes,
        lastSeq: await scope.lastSeq(),
        conflicts: await scope.conflictCount()
    });
}

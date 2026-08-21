// @ts-check

/**
 * Las fotos de progreso, en R2 (M9-5).
 *
 * ## Bytes, y el servidor no sabe de qué
 *
 * Lo que se guarda es el resultado de `encryptBytes(dk, …)` sobre una imagen ya
 * comprimida en el dispositivo. El servidor recibe un cuerpo binario, lo pone en
 * un objeto y lo devuelve tal cual: no descodifica, no redimensiona y no puede
 * mirar. Por eso Cloudflare Images no sirve aquí —su trabajo entero es leer la
 * imagen— y por eso el recorte lo hace el cliente.
 *
 * ## Por qué la subida pasa POR AQUÍ y no por una URL prefirmada
 *
 * Una URL prefirmada de R2 obligaría a las dos cosas que este diseño evita:
 * meter el host de R2 en `connect-src` —la directiva que hoy hace imposible que
 * la aplicación hable con nadie más— y firmar SigV4 con `aws4fetch`, que es una
 * dependencia de runtime, y aquí no hay ninguna.
 *
 * Se paga con ancho de banda del Worker en la subida. La bajada de R2 no cuesta
 * egreso, y los borrados tampoco.
 *
 * ## La clave del objeto lleva el usuario PRIMERO
 *
 * ```
 *   u/<userId>/p/<profileId>/<photoId>
 * ```
 *
 * No es estético. Con el usuario delante, un fallo en el id de perfil no puede
 * cruzar cuentas —el prefijo ya acotó—, y `list({ prefix: 'u/<userId>/' })` da el
 * inventario exacto de una cuenta, que es lo que necesitan tanto el barrido de
 * huérfanos como el borrado de cuenta.
 *
 * Y ninguno de los tres tramos se construye con lo que manda el cliente sin
 * comprobarlo: el usuario sale de la sesión, y el perfil y la foto tienen que
 * pasar por `SEGMENTO_RE` o la petición no llega a tocar el bucket.
 */

import { json, fail, binary } from '../_lib/http.js';

/**
 * Tamaño máximo de un objeto.
 *
 * Ocho megas es holgado para una foto ya comprimida a 1600 px de lado —suelen
 * quedar en 150–250 KB— y estrecho para quien intente usar esto de disco duro.
 * El cliente comprime antes de cifrar; si algo llega aquí con ocho megas, es que
 * no pasó por ese camino.
 */
const MAX_OBJECT_BYTES = 8 * 1024 * 1024;

/**
 * Cuánto puede ocupar una cuenta entera.
 *
 * Cien megas son entre cuatrocientas y seiscientas fotos comprimidas: más de las
 * que nadie hace de sí mismo en un año de seguimiento. El plan gratuito de R2
 * son diez gigas, así que este techo también decide cuánta gente cabe antes de
 * que haya que pagar, y esa cuenta es mejor hacerla ahora que el día que se
 * llene.
 */
const MAX_ACCOUNT_BYTES = 100 * 1024 * 1024;

/**
 * La forma de un identificador dentro de la clave del objeto.
 *
 * Sin puntos, sin barras y sin nada que pueda salirse de su tramo. Es lo que
 * impide que un `photoId` de `../../otro-usuario/x` escriba donde no debe: no se
 * sanea la clave después de construirla, se rechaza la entrada antes.
 */
const SEGMENTO_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** @param {EventContext} ctx */
const alcance = (ctx) => /** @type {import('../_lib/db.js').Scope} */ (ctx.data.scope);

/**
 * La clave del objeto, o `null` si algún tramo no vale.
 *
 * @param {string} userId
 * @param {unknown} profileId
 * @param {unknown} photoId
 * @returns {string | null}
 */
function claveDe(userId, profileId, photoId) {
    if (typeof profileId !== 'string' || !SEGMENTO_RE.test(profileId)) return null;
    if (typeof photoId !== 'string' || !SEGMENTO_RE.test(photoId)) return null;
    return `u/${userId}/p/${profileId}/${photoId}`;
}

/** El id de la sesión y los parámetros de la ruta, ya comprobados. */
function partes(/** @type {EventContext} */ ctx) {
    const scope = alcance(ctx);
    const url = new URL(ctx.request.url);
    const perfil = url.searchParams.get('profile');
    const foto = /** @type {*} */ (ctx.params).id;
    return { scope, key: claveDe(scope.userId, perfil, foto) };
}

/**
 * `PUT /api/photos/:id?profile=<perfilId>` — sube una foto cifrada.
 *
 * El cuerpo son bytes en crudo, no JSON: un criptograma en base64 crece un
 * tercio y esto ya es la parte pesada del producto.
 *
 * @param {EventContext} ctx
 */
export async function upload(ctx) {
    const { scope, key } = partes(ctx);
    if (key === null) return fail(400, 'photos.badKey');

    const declarado = Number(ctx.request.headers.get('Content-Length'));
    if (Number.isFinite(declarado) && declarado > MAX_OBJECT_BYTES) {
        return fail(413, 'photos.tooLarge');
    }

    let bytes;
    try {
        bytes = await ctx.request.arrayBuffer();
    } catch {
        return fail(400, 'photos.unreadable');
    }
    // La medida de verdad, después de leer: la cabecera puede mentir o faltar.
    if (bytes.byteLength === 0) return fail(400, 'photos.empty');
    if (bytes.byteLength > MAX_OBJECT_BYTES) return fail(413, 'photos.tooLarge');

    // La cuota se comprueba contra el TAMAÑO NETO: si esta foto ya existía, lo
    // que suma es la diferencia. Sin esto, reintentar una subida que se cortó a
    // la mitad contaría dos veces y la cuenta se llenaría con una sola foto.
    const previo = await ctx.env.PHOTOS.get(key);
    const delta = bytes.byteLength - (previo?.size ?? 0);

    const cuota = await scope.reservePhotoBytes({ delta, limit: MAX_ACCOUNT_BYTES });
    if (!cuota.ok) return fail(413, 'photos.quota', { headers: cabeceraCuota(cuota) });

    try {
        await ctx.env.PHOTOS.put(key, bytes);
    } catch (error) {
        // Se devuelve lo reservado. Sin esto, cada fallo de R2 le comería a
        // alguien un trozo de su cuota para siempre, sin nada que lo ocupe.
        await scope.reservePhotoBytes({ delta: -delta, limit: MAX_ACCOUNT_BYTES });
        console.error('photos.put', error);
        return fail(502, 'photos.storeFailed');
    }

    return json({ stored: true, bytes: bytes.byteLength, used: cuota.used, limit: MAX_ACCOUNT_BYTES });
}

/**
 * `GET /api/photos/:id?profile=<perfilId>` — baja una foto cifrada.
 *
 * @param {EventContext} ctx
 */
export async function download(ctx) {
    const { key } = partes(ctx);
    if (key === null) return fail(400, 'photos.badKey');

    const objeto = await ctx.env.PHOTOS.get(key);
    if (!objeto) return fail(404, 'photos.notFound');

    return binary(objeto.body, objeto.size);
}

/**
 * `DELETE /api/photos/:id?profile=<perfilId>` — borra una foto.
 *
 * @param {EventContext} ctx
 */
export async function remove(ctx) {
    const { scope, key } = partes(ctx);
    if (key === null) return fail(400, 'photos.badKey');

    // Se mide ANTES de borrar: después ya no hay a quién preguntarle cuánto
    // ocupaba, y la cuota se quedaría contando bytes que no existen.
    const objeto = await ctx.env.PHOTOS.get(key);
    if (objeto) {
        await ctx.env.PHOTOS.delete(key);
        await scope.reservePhotoBytes({ delta: -objeto.size, limit: MAX_ACCOUNT_BYTES });
    }
    // Borrar algo que ya no está es un éxito, no un 404: el cliente reintenta
    // borrados y tiene que poder darlos por hechos.
    return json({ deleted: true });
}

/**
 * `GET /api/photos` — el inventario de la cuenta.
 *
 * Es lo que hace posible el barrido de huérfanos: un objeto cuya subida terminó
 * pero cuyo puntero nunca llegó a guardarse no lo conoce nadie, y sin inventario
 * se quedaría ocupando cuota para siempre. **Quién decide qué sobra es el
 * cliente**, porque el servidor no puede leer los punteros.
 *
 * @param {EventContext} ctx
 */
export async function inventory(ctx) {
    const scope = alcance(ctx);
    const prefijo = `u/${scope.userId}/`;

    /** @type {{ profileId: string, photoId: string, bytes: number }[]} */
    const objetos = [];
    let cursor;
    // R2 pagina; se recorre entero porque el inventario solo sirve completo —con
    // media lista, el barrido borraría lo que no vio—.
    for (let vuelta = 0; vuelta < 20; vuelta++) {
        const pagina = await ctx.env.PHOTOS.list({ prefix: prefijo, cursor });
        for (const o of pagina.objects) {
            const resto = o.key.slice(prefijo.length).split('/');
            if (resto.length !== 3 || resto[0] !== 'p') continue;
            objetos.push({ profileId: resto[1], photoId: resto[2], bytes: o.size });
        }
        if (!pagina.truncated) {
            return json({ objects: objetos, complete: true, used: await scope.photoBytes(), limit: MAX_ACCOUNT_BYTES });
        }
        cursor = pagina.cursor;
    }
    // Veinte páginas sin terminar es una cuenta imposible con este techo de
    // cuota. Se dice que la lista está incompleta en vez de darla por buena: un
    // barrido sobre un inventario a medias borra fotos que sí tienen puntero.
    return json({ objects: objetos, complete: false, used: await scope.photoBytes(), limit: MAX_ACCOUNT_BYTES });
}

/** La cabecera que acompaña a un 413 por cuota, para poder enseñar cuánto queda. */
const cabeceraCuota = (/** @type {*} */ cuota) => ({
    'X-Quota-Used': String(cuota.used),
    'X-Quota-Limit': String(MAX_ACCOUNT_BYTES)
});

export { MAX_OBJECT_BYTES, MAX_ACCOUNT_BYTES };

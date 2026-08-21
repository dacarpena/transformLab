// @ts-check

/**
 * Lo que atraviesa TODA petición a la API, antes de saber qué pide (M8-1).
 *
 * Aquí van las comprobaciones que no pueden depender de que un manejador se
 * acuerde: método, `Origin`, `Content-Type` y las cabeceras de seguridad de la
 * respuesta. Es una capa, no una convención.
 *
 * **Las cabeceras se ponen a la SALIDA, sobre lo que sea que devuelva el
 * manejador.** Si cada manejador las pusiera, bastaría uno que devolviera una
 * `Response` a pelo —un 500 del runtime, un `redirect`— para que se colara una
 * respuesta de la API sin `no-store` ni `Vary`. Poniéndolas aquí, no hay camino
 * por el que una respuesta salga sin ellas.
 *
 * A partir de M8-4 este fichero además autentica y deja en `ctx.data.scope` el
 * único objeto con el que un manejador puede tocar la base: un `Scope` que lleva
 * el `userId` cerrado dentro y cuyas sentencias contienen todas
 * `WHERE user_id = ?1`. Un manejador no tendrá físicamente un `D1Database`, así
 * que no podrá escribir una consulta sin acotar.
 */

import { checkRequest } from './_lib/guard.js';
import { API_HEADERS, fail } from './_lib/http.js';

/**
 * @param {EventContext} ctx
 * @returns {Promise<Response>}
 */
export async function onRequest(ctx) {
    const origin = new URL(ctx.request.url).origin;

    const rechazo = checkRequest(ctx.request, { origin });
    if (rechazo) return sellar(rechazo);

    let respuesta;
    try {
        respuesta = await ctx.next();
    } catch (error) {
        // Un fallo del propio runtime, fuera del `try` del enrutador. Sin esto
        // Cloudflare devuelve su página de error, que es HTML y no lleva
        // ninguna de estas cabeceras.
        console.error('api.middleware', error);
        respuesta = fail(500, 'internal');
    }
    return sellar(respuesta);
}

/**
 * Copia la respuesta poniéndole las cabeceras de la API.
 *
 * Se construye una `Response` nueva porque las cabeceras de la que devuelve
 * `ctx.next()` son **inmutables**: intentar `set` sobre ellas lanza, y ese fallo
 * aparecería solo en producción, sobre la respuesta de un manejador concreto.
 *
 * @param {Response} respuesta
 * @returns {Response}
 */
function sellar(respuesta) {
    const headers = new Headers(respuesta.headers);
    for (const [k, v] of Object.entries(API_HEADERS)) headers.set(k, v);
    // El `Allow` de un 405 y el `Set-Cookie` de un login viven en la respuesta
    // del manejador y sobreviven: `API_HEADERS` no los nombra.
    return new Response(respuesta.body, {
        status: respuesta.status,
        statusText: respuesta.statusText,
        headers
    });
}

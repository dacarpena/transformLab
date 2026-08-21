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
 * Desde M8-4 este fichero además AUTENTICA, y deja en `ctx.data.scope` el único
 * objeto con el que un manejador puede tocar la base: un `Scope` que lleva el
 * `userId` cerrado dentro y cuyas sentencias contienen todas `user_id = ?1`. Un
 * manejador **no tiene físicamente un `D1Database`**, así que no puede escribir
 * una consulta sin acotar. No es una convención: es que no hay dónde agarrarse.
 *
 * La rotación de la cookie también se resuelve aquí, y tiene que ser aquí: si la
 * pusiera el manejador, cada manejador tendría que acordarse, y el que se
 * olvidara dejaría al usuario con un token que va a caducar sin renovarse.
 *
 * Y desde M9-7, dos cosas más que solo pueden vivir en una capa: el **acolchado
 * temporal** de `/api/auth/*` y la **línea de registro** de cada petición.
 */

import { checkRequest } from './_lib/guard.js';
import { API_HEADERS, fail } from './_lib/http.js';
import { readCookie, sessionCookie, clearCookie } from './_lib/sessions.js';
import { verifySession, openUserScope } from './_lib/db.js';
import { line, deExcepcion } from './_lib/log.js';

/**
 * Lo que tarda como mínimo cualquier respuesta de `/api/auth/*`.
 *
 * ## Qué se está tapando
 *
 * Los caminos de autenticación tardan cosas distintas según lo que encuentren.
 * `login/finish` con una credencial que no existe vuelve enseguida; con una que
 * sí existe, verifica una firma ECDSA y lee la base. Esa diferencia es una
 * respuesta a la pregunta «¿está esta credencial registrada aquí?», y se puede
 * medir desde fuera sin autenticarse.
 *
 * Poniendo un suelo común, todas las respuestas de autenticación tardan lo mismo
 * y la pregunta deja de tener respuesta.
 *
 * ## Lo que un suelo NO tapa, y conviene decirlo
 *
 * Solo esconde las diferencias que caen POR DEBAJO. Si algún día un camino de
 * autenticación pasara de 120 ms —D1 lenta, un lote grande—, ese camino volvería
 * a distinguirse. El suelo se eligió con margen sobre lo que tardan hoy, y es una
 * capa más, no la única: las credenciales son descubribles, así que no hay
 * ningún campo «usuario» que enumerar de entrada.
 *
 * ## Por qué fijo y no aleatorio
 *
 * Un retardo aleatorio parece más seguro y es peor: el ruido se promedia con
 * suficientes muestras y la diferencia reaparece. Un suelo fijo cuantiza de
 * verdad.
 *
 * Se paga con 120 ms en cada entrada y en cada alta. Es una vez por sesión, y no
 * se nota; ponerlo en el camino de la sincronización sí se notaría, y por eso
 * solo cubre `/api/auth/`.
 */
export const AUTH_FLOOR_MS = 120;

/** Las rutas que se acolchan. */
const acolchada = (/** @type {string} */ pathname) => pathname.startsWith('/api/auth/');

/** @param {number} ms */
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {EventContext} ctx
 * @returns {Promise<Response>}
 */
export async function onRequest(ctx) {
    const url = new URL(ctx.request.url);
    const origin = url.origin;
    const empezado = Date.now();

    // TODAS las salidas pasan por aquí, y ése es el punto: el acolchado y el
    // registro no pueden depender de por qué se vuelve. Un `return` suelto en
    // mitad de la función sería una respuesta sin acolchar —o sin registrar— y
    // justo la interesante, porque los rechazos tempranos son los rápidos.
    const salir = async (/** @type {Response} */ respuesta) => {
        if (acolchada(url.pathname)) {
            const falta = AUTH_FLOOR_MS - (Date.now() - empezado);
            if (falta > 0) await esperar(falta);
        }
        line({
            evt: 'req',
            method: ctx.request.method,
            // El PATRÓN, nunca la ruta concreta: ahí van ids de foto y de perfil.
            // Lo deja el enrutador; si no llegó a haberlo, no se registra ruta.
            route: /** @type {*} */ (ctx.data)?.route,
            status: respuesta.status,
            ms: Date.now() - empezado,
            error: /** @type {*} */ (ctx.data)?.errorCode
        });
        return sellar(respuesta);
    };

    const rechazo = checkRequest(ctx.request, { origin });
    if (rechazo) return salir(rechazo);

    // ── Autenticación ──────────────────────────────────────────────────────
    //
    // Sin cookie no se falla: hay rutas públicas —salud, registro, login— y es
    // el enrutador quien sabe cuáles piden sesión, mirando `auth` en la tabla.
    const token = readCookie(ctx.request);
    /** @type {string | null} */ let cookieNueva = null;
    /** @type {boolean} */ let borrarCookie = false;

    if (token) {
        const sesion = await verifySession(ctx.env, token, { now: Date.now() });
        if (sesion.ok) {
            ctx.data.scope = openUserScope(ctx.env, sesion.userId);
            ctx.data.credentialId = sesion.credentialId;
            if (sesion.newToken) cookieNueva = sessionCookie(sesion.newToken);
        } else {
            // La cookie ya no sirve. Se borra SIEMPRE, y eso importa: dejarla
            // puesta haría que cada petición volviera a buscarla y —en el caso
            // de reuso— a revocar una familia que ya no existe.
            borrarCookie = true;
            if (sesion.reason === 'reuse') {
                // Vale la pena en el registro: es la única señal de que un token
                // de sesión se ha copiado. Sin decir de quién: la familia entera
                // ya se ha revocado, y saber a qué cuenta pertenecía no cambia
                // nada de lo que se pueda hacer al respecto.
                line({ evt: 'session.reuse' });
            }
        }
    }

    let respuesta;
    try {
        respuesta = await ctx.next();
    } catch (error) {
        // Un fallo del propio runtime, fuera del `try` del enrutador. Sin esto
        // Cloudflare devuelve su página de error, que es HTML y no lleva
        // ninguna de estas cabeceras.
        line({ evt: 'middleware.threw', ...deExcepcion(error) });
        respuesta = fail(500, 'internal');
    }

    // La cookie se pone al FINAL y solo si el manejador no puso la suya: el
    // cierre de sesión y el login escriben su propio `Set-Cookie`, y pisárselo
    // dejaría al usuario dentro después de pulsar «salir».
    if ((cookieNueva || borrarCookie) && !respuesta.headers.has('Set-Cookie')) {
        respuesta = new Response(respuesta.body, {
            status: respuesta.status,
            statusText: respuesta.statusText,
            headers: new Headers(respuesta.headers)
        });
        respuesta.headers.set('Set-Cookie', cookieNueva ?? clearCookie());
    }

    return salir(respuesta);
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

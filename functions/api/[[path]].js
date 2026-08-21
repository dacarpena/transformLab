// @ts-check

/**
 * La única puerta de la API (M8-1).
 *
 * Todo `/api/*` entra por aquí y se despacha con la tabla de `_manifest.js`. El
 * enrutado por nombre de fichero de Pages queda sin usar a propósito: ver el
 * comentario de `_lib/router.js`.
 */

import { ROUTES } from '../_manifest.js';
import { match } from '../_lib/router.js';
import { fail } from '../_lib/http.js';
import { line, deExcepcion } from '../_lib/log.js';

/**
 * @param {EventContext} ctx
 * @returns {Promise<Response>}
 */
export async function onRequest(ctx) {
    const url = new URL(ctx.request.url);
    const encontrada = match(ROUTES, ctx.request.method, url.pathname);

    // El PATRÓN de la ruta, para que el middleware pueda registrarla sin
    // registrar la ruta CONCRETA: ahí dentro van el id de una foto —que es
    // `ph_<fecha>`— y el de un perfil. Un registro con eso acaba contando en qué
    // días alguien se hizo fotos, y eso no se puede des-registrar.
    if (encontrada.route) /** @type {*} */ (ctx.data).route = encontrada.route.path;

    if (!encontrada.route) {
        // La ruta existe pero no con ese método: 405 con `Allow`, que es lo que
        // manda HTTP y lo que hace depurable un cliente mal escrito.
        if (encontrada.allow.length) {
            return fail(405, 'method.notAllowed', { headers: { Allow: encontrada.allow.join(', ') } });
        }
        return fail(404, 'route.notFound');
    }

    // `auth` se lee aquí y no dentro del manejador: un manejador que se olvide de
    // comprobar la sesión es el fallo clásico de este tipo de código, y la única
    // forma de que no pueda pasar es que el manejador no tenga voz en el asunto.
    // La comprobación entra en M8-4, con las sesiones; hasta entonces ninguna
    // ruta la pide, y este `if` deja escrito dónde va.
    if (encontrada.route.auth && !ctx.data?.scope) {
        return fail(401, 'auth.required');
    }

    try {
        return await encontrada.route.handler({ ...ctx, params: encontrada.params });
    } catch (error) {
        // Nunca se filtra el error al cliente: un `stack` dice rutas de fichero,
        // nombres de tabla y a veces valores. Al registro sí va entero, que es
        // donde sirve.
        line({ evt: 'handler.threw', route: encontrada.route.path, ...deExcepcion(error) });
        return fail(500, 'internal');
    }
}

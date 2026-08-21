// @ts-check

/**
 * La sesión vista desde dentro: quién soy, y cómo salir (M8-4).
 *
 * Las tres rutas de aquí llevan `auth: true` en el manifiesto, así que el
 * enrutador ya ha respondido 401 si no hay sesión: cuando el manejador se
 * ejecuta, `ctx.data.scope` existe siempre. Comprobarlo otra vez sería una
 * defensa que oculta lo que de verdad la garantiza.
 */

import { json } from '../_lib/http.js';
import { readCookie, clearCookie } from '../_lib/sessions.js';
import { closeSession } from '../_lib/db.js';

/**
 * `GET /api/session` — el estado de la cuenta, sin un solo dato personal.
 *
 * Lo consulta la interfaz al arrancar para saber si hay sesión y si la cuenta
 * está protegida. `protected` es lo que gobierna la regla dura: mientras sea
 * falso no se sube ni un byte, porque no hay vía de vuelta.
 *
 * @param {EventContext} ctx
 */
export async function current(ctx) {
    const scope = /** @type {import('../_lib/db.js').Scope} */ (ctx.data.scope);
    const usuario = await scope.user();
    if (!usuario) {
        // La cuenta se borró desde otro dispositivo mientras esta sesión vivía.
        // El `ON DELETE CASCADE` ya se llevó la fila de sesión, así que esto es
        // una carrera muy estrecha; aun así, no se inventa una respuesta.
        return json({ authenticated: false }, { headers: { 'Set-Cookie': clearCookie() } });
    }

    return json({
        authenticated: true,
        userId: scope.userId,
        protected: Boolean(usuario.protected_at),
        credentials: (await scope.credentials()).length,
        sessions: (await scope.sessions()).length
    });
}

/**
 * `POST /api/auth/logout` — cierra ESTA sesión.
 *
 * Se borra la fila, no se marca: una sesión «cerrada» que sigue en la tabla es
 * una fila que alguien puede volver a poner viva con un `UPDATE`.
 *
 * @param {EventContext} ctx
 */
export async function logout(ctx) {
    const token = readCookie(ctx.request);
    if (token) await closeSession(ctx.env, token);
    return json({ ok: true }, { headers: { 'Set-Cookie': clearCookie() } });
}

/**
 * `POST /api/auth/logout-all` — cierra la sesión en TODOS los dispositivos.
 *
 * Es lo que se pulsa cuando se pierde un teléfono, así que tiene que ser
 * inmediato de verdad. Lo es porque las sesiones viven en D1 y no en KV: KV
 * propaga hasta 60 segundos, y eso convertiría esta promesa en una mentira
 * durante justo el minuto que importa.
 *
 * @param {EventContext} ctx
 */
export async function logoutAll(ctx) {
    const scope = /** @type {import('../_lib/db.js').Scope} */ (ctx.data.scope);
    const cerradas = await scope.revokeAllSessions();
    return json({ ok: true, closed: cerradas }, { headers: { 'Set-Cookie': clearCookie() } });
}

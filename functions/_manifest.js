// @ts-check

/**
 * **La lista completa de lo que este servidor expone.** Fuente única (M8-1).
 *
 * Mismo papel que `src/ui/views/_manifest.js`, y por la misma razón: sin una
 * tabla, publicar una ruta es dejar caer un fichero, y acaba habiendo rutas que
 * nadie ha revisado. `functions/_handlers/` no lo enruta Pages —el guion bajo se
 * lo prohíbe—, así que lo que no esté escrito aquí sencillamente no existe.
 *
 * `test/functions-manifest.test.js` exige las dos direcciones: ningún manejador
 * sin ruta, ninguna ruta sin manejador.
 *
 * `auth` es OBLIGATORIO en cada entrada y no tiene valor por omisión. Con uno,
 * olvidarlo abriría la ruta; sin él, olvidarlo no compila. El fallo tiene que
 * caer siempre del lado de cerrar.
 */

import { onRequest as health } from './_handlers/health.js';
import { registerStart, registerFinish, loginStart, loginFinish } from './_handlers/auth.js';
import { current, logout, logoutAll } from './_handlers/session.js';

/** @type {readonly import('./_lib/router.js').Route[]} */
export const ROUTES = Object.freeze([
    { method: 'GET', path: '/api/health', handler: health, auth: false },

    // Autenticación. `auth: false` en las cuatro por definición: son las rutas
    // que EXISTEN para conseguir una sesión, así que exigirla sería un bucle.
    { method: 'POST', path: '/api/auth/register/start', handler: registerStart, auth: false },
    { method: 'POST', path: '/api/auth/register/finish', handler: registerFinish, auth: false },
    { method: 'POST', path: '/api/auth/login/start', handler: loginStart, auth: false },
    { method: 'POST', path: '/api/auth/login/finish', handler: loginFinish, auth: false },

    // Y las que SÍ piden sesión.
    { method: 'GET', path: '/api/session', handler: current, auth: true },
    { method: 'POST', path: '/api/auth/logout', handler: logout, auth: true },
    { method: 'POST', path: '/api/auth/logout-all', handler: logoutAll, auth: true }
]);

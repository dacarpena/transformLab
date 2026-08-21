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

/** @type {readonly import('./_lib/router.js').Route[]} */
export const ROUTES = Object.freeze([
    { method: 'GET', path: '/api/health', handler: health, auth: false }
]);

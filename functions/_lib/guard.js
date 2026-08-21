// @ts-check

/**
 * Lo que se comprueba de TODA petición antes de mirar qué pide (M8-1).
 *
 * Es una función **pura**: recibe una `Request` y devuelve o bien `null` —pasa—
 * o bien la `Response` con la que hay que rechazarla. No toca la base de datos,
 * no lee cookies y no depende del entorno, así que se prueba entera desde
 * `node:test` sin levantar nada.
 *
 * ## El CSRF, sin token
 *
 * La defensa son tres capas independientes, y las tres tienen que caer para que
 * un origen ajeno consiga que el navegador de alguien escriba en su cuenta:
 *
 * 1. **`SameSite=Strict`** en la cookie de sesión (M8-4): el navegador no la
 *    manda en una petición originada en otro sitio. Es la capa fuerte.
 * 2. **`Origin` exacto** en todo lo que no sea GET, comprobado aquí. Los
 *    navegadores mandan `Origin` en toda petición con efectos desde 2020, así
 *    que su ausencia también se rechaza: no hay un caso legítimo en esta API.
 * 3. **`Content-Type: application/json` obligatorio**. Un `<form>` de otro
 *    origen solo puede producir tres tipos —`application/x-www-form-urlencoded`,
 *    `multipart/form-data` y `text/plain`—, y ninguno es éste. Un `fetch` sí
 *    podría ponerlo, pero entonces ya está sujeto al preflight de CORS, que esta
 *    API nunca contesta.
 *
 * No hay token anti-CSRF porque no aporta una cuarta capa independiente: viviría
 * en la misma cookie o en el mismo documento que las anteriores.
 */

import { fail } from './http.js';

/**
 * Los métodos que la API acepta. `PUT` y `PATCH` no están: la sincronización
 * empuja con `POST` y el borrado usa `DELETE`. Aceptar métodos que nadie sirve
 * solo amplía la superficie.
 */
const METHODS = Object.freeze(['GET', 'HEAD', 'POST', 'DELETE']);

/** Los métodos que NO cambian nada y por tanto no necesitan la defensa de CSRF. */
const SAFE = Object.freeze(['GET', 'HEAD']);

/**
 * @param {Request} request
 * @param {{ origin: string }} context El origen propio, `https://motifyer.com`
 *   en producción y `http://localhost:8788` en desarrollo. Se saca de la URL de
 *   la petición, no de una constante: así no hay una lista de entornos que
 *   mantener, y una petición a un origen que el servidor no atiende no llega.
 * @returns {Response | null} `null` si la petición puede seguir.
 */
export function checkRequest(request, { origin }) {
    if (!METHODS.includes(request.method)) {
        // 405 y no 404: mentir sobre la existencia de la ruta no oculta nada
        // —el método sí existe en otras— y complica el diagnóstico.
        return fail(405, 'method.notAllowed', { headers: { Allow: METHODS.join(', ') } });
    }

    // Nunca se contesta al preflight. `OPTIONS` no está en METHODS, así que ya
    // cae arriba; esto lo deja escrito por si alguien lo añade sin pensarlo:
    // contestar un preflight es habilitar CORS, y esta API es del mismo origen.

    if (SAFE.includes(request.method)) return null;

    const enviado = request.headers.get('Origin');
    if (enviado !== origin) {
        // Incluye el caso `null` (sin cabecera): un navegador la manda siempre
        // en peticiones con efectos, así que su ausencia es anómala.
        return fail(403, 'origin.mismatch');
    }

    // `split(';')` porque el tipo legítimo viene con parámetros:
    // `application/json; charset=utf-8`. Comparar la cadena entera rechazaría
    // clientes correctos.
    const tipo = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (tipo !== 'application/json') {
        return fail(415, 'contentType.required');
    }

    return null;
}

export const ALLOWED_METHODS = METHODS;

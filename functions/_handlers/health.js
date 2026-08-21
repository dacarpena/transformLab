// @ts-check

/**
 * `GET /api/health` — el único endpoint de M8-1.
 *
 * Existe para responder a una pregunta operativa y a ninguna más: **¿está viva
 * la Function y ve sus enlaces?** Sirve para comprobar un despliegue y para el
 * runbook, y es el primer sitio donde se mira cuando la sincronización falla.
 *
 * Lo que NO devuelve, a propósito:
 *
 * - Ninguna versión, `commit` ni nombre de entorno. Un `/health` que enumera la
 *   pila es un regalo para quien busca una versión con CVE conocida, y este
 *   endpoint es público por definición.
 * - Ningún dato del usuario, y ninguna consulta a la base. Un `SELECT` de prueba
 *   convertiría el endpoint más llamado en un consumidor de cuota, y con el
 *   techo de 100 000 peticiones al día eso importa. Que el enlace EXISTE se
 *   comprueba mirando el objeto; que RESPONDE, no: eso es lo que dirá la primera
 *   petición real, y con un error honesto.
 */

import { json } from '../_lib/http.js';

/**
 * @param {EventContext} ctx
 * @returns {Response}
 */
export function onRequest(ctx) {
    return json({
        ok: true,
        // Booleanos, nunca identificadores: decir «falta el enlace DB» es
        // diagnóstico útil; decir cuál es la base de datos, no.
        bindings: {
            db: Boolean(ctx.env?.DB),
            photos: Boolean(ctx.env?.PHOTOS)
        }
    });
}

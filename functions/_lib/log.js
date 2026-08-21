// @ts-check

/**
 * El registro del servidor (M9-7).
 *
 * ## Una línea JSON por petición, y solo estos campos
 *
 * `wrangler pages deployment tail` da un chorro de texto; buscar dentro de él
 * cuando algo falla en producción es lo que convierte una incidencia de cinco
 * minutos en una de una hora. Con una línea JSON por petición se filtra por
 * campo, se cuentan errores por código y se ve una latencia sin leer nada a ojo.
 *
 * ## Lo que este módulo existe para NO registrar
 *
 * Ésta es la parte importante, y no es teórica: **el registro anterior filtraba
 * datos del usuario**. `console.error('api.handler', url.pathname, error)`
 * escribía la ruta concreta, y una ruta concreta de esta API lleva dentro el id
 * de una foto —que es `ph_<fecha>`— y el id de un perfil. O sea que los registros
 * del servidor acababan conteniendo **en qué días alguien se hizo fotos de
 * progreso**, que es exactamente lo que el resto del diseño se toma tantas
 * molestias en no saber.
 *
 * Por eso aquí no se registra una ruta: se registra el PATRÓN de la ruta
 * (`/api/photos/:id`), que no lleva nada de nadie. Y por eso `line()` **compone
 * el objeto ella misma** a partir de argumentos con nombre en vez de aceptar uno
 * y volcarlo: lo que no está en esta función no puede salir por aquí, y eso es
 * una garantía estructural en vez de una advertencia en un comentario.
 *
 * La lista completa de lo que se escribe está abajo. Lo que **nunca** entra:
 * tokens de sesión, hashes de reto, criptogramas, etiquetas de fila, claves de
 * objeto, direcciones IP —ni truncadas—, agentes de usuario y cualquier
 * identificador de perfil, foto o cuenta.
 *
 * El `userId` tampoco. Es opaco, pero permitiría reconstruir el historial de
 * actividad de una persona a partir de los registros, y el resto del sistema
 * está construido para que eso no se pueda hacer.
 *
 * ## Lo que esto NO controla, y hay que decirlo
 *
 * `wrangler pages deployment tail` no enseña solo estas líneas: envuelve cada
 * una en el evento de Cloudflare, que trae **la URL completa y la IP del
 * cliente**. Eso lo pone la plataforma y desde aquí no se puede quitar.
 *
 * La diferencia importa y no es cosmética. Ese envoltorio es efímero —existe
 * mientras alguien tiene un `tail` abierto— mientras que lo que se escribe con
 * `console` es lo que acabaría en cualquier destino de registros persistente que
 * se conecte algún día. O sea: esto controla lo que se GUARDA; lo que se ve en
 * vivo mirando por encima del hombro de la plataforma es otra cosa y hay que
 * saberlo antes de dejar un `tail` abierto en una pantalla compartida.
 */

/**
 * @typedef {Object} Linea
 * @property {string} evt qué pasó: `req` o el nombre de un incidente
 * @property {string} [route] el PATRÓN de la ruta, nunca la ruta concreta
 * @property {string} [method]
 * @property {number} [status]
 * @property {number} [ms] duración, redondeada a 10 ms
 * @property {string} [error] el código que se le devolvió al cliente
 * @property {string} [detail] el NOMBRE de la excepción, nunca su mensaje
 * @property {string} [at] el primer marco de la pila: fichero y línea
 */

/**
 * Redondea una duración.
 *
 * A decenas de milisegundo, y a propósito: una latencia al milisegundo es una
 * medida útil para un atacante —es lo que el acolchado de `/api/auth/*` está
 * evitando— y no lo es para nadie que esté depurando. Quien mira un registro
 * quiere saber si algo tarda 20 ms o 2000, no si tardó 137 o 141.
 *
 * @param {number} ms
 * @returns {number}
 */
export const redondear = (ms) => Math.max(0, Math.round(ms / 10) * 10);

/**
 * Escribe una línea. Es la ÚNICA función del servidor que llama a `console`.
 *
 * @param {Linea} campos
 */
export function line(campos) {
    // El objeto se compone campo a campo: lo que no esté nombrado aquí no puede
    // salir, aunque quien llame pase medio contexto por error.
    /** @type {Record<string, string | number>} */ const salida = { evt: campos.evt };
    if (campos.route !== undefined) salida.route = campos.route;
    if (campos.method !== undefined) salida.method = campos.method;
    if (campos.status !== undefined) salida.status = campos.status;
    if (campos.ms !== undefined) salida.ms = redondear(campos.ms);
    if (campos.error !== undefined) salida.error = campos.error;
    if (campos.detail !== undefined) salida.detail = campos.detail;
    if (campos.at !== undefined) salida.at = campos.at;

    // `console.log` y no `console.error` salvo para lo que de verdad es un
    // fallo: en `tail` los dos salen, pero el nivel es lo que permite filtrar.
    const texto = JSON.stringify(salida);
    if (typeof campos.status === 'number' && campos.status >= 500) console.error(texto);
    else if (campos.evt !== 'req') console.error(texto);
    else console.log(texto);
}

/**
 * De qué excepción se trata, sin lo que llevaba dentro.
 *
 * El MENSAJE no se registra, y es el detalle que hace falta explicar. Un mensaje
 * de excepción de esta API puede llevar valores: `scoped()` lanza con el texto
 * de la consulta, y un error de D1 puede traer los parámetros que se ataron. Ahí
 * cabe una clave de objeto o el id de un perfil.
 *
 * Lo que sí se queda es el **nombre de la clase** y el **primer marco de la
 * pila**, que son fichero y línea. Con eso se localiza el fallo en el código
 * —que es para lo que sirve un registro— sin llevarse por delante el dato de
 * nadie. Renunciar al mensaje cuesta algo de diagnóstico, y es un cambio
 * consciente: el mensaje se reproduce en local, el dato de un usuario no se
 * puede des-registrar.
 *
 * @param {unknown} error
 * @returns {{ detail: string, at: string | undefined }}
 */
export function deExcepcion(error) {
    const detail = error instanceof Error && typeof error.name === 'string' && error.name !== ''
        ? error.name
        : 'Error';
    if (!(error instanceof Error) || typeof error.stack !== 'string') return { detail, at: undefined };

    // La primera línea de `stack` es «Nombre: mensaje»; se salta entera, que es
    // justo donde vive lo que no puede registrarse.
    const marco = error.stack.split('\n').slice(1).map((l) => l.trim()).find((l) => l.startsWith('at '));
    return { detail, at: marco };
}

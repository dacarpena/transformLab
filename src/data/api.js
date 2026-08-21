// @ts-check

/**
 * **La única puerta de salida de este dispositivo** (M8-5c).
 *
 * Hasta aquí, `src/` no tenía ni un `fetch`: la aplicación no hablaba con nadie,
 * y eso era comprobable de un vistazo. Ahora hay una cuenta opcional, así que
 * hay red — y la forma de no perder la propiedad es la misma que con
 * `localStorage`: **una sola puerta**, con un test que falla si alguien abre
 * otra.
 *
 * Este módulo es, por tanto, el punto de auditoría de qué sale del dispositivo.
 * Cabe en una pantalla a propósito.
 *
 * ## Lo que impone, y no se puede saltar
 *
 * - **Mismo origen, siempre.** La ruta tiene que empezar por `/api/`. No se
 *   admite una URL absoluta: sin esta regla, un dato de un backup importado que
 *   acabase en una ruta convertiría esto en un exfiltrador.
 * - **`credentials: 'same-origin'`**, que es el valor por omisión de `fetch` pero
 *   se escribe: la cookie de sesión no puede viajar a ningún otro sitio.
 * - **Nunca lanza.** Sin red, con red mala o con un 500, devuelve un `Result`.
 *   La aplicación funciona entera sin cuenta (§1), así que un fallo de red es un
 *   estado normal, no una excepción.
 * - **Con plazo.** Una petición sin límite deja un botón girando para siempre en
 *   un metro sin cobertura.
 *
 * ## Lo que NO hace
 *
 * Ni reintentos, ni cola, ni caché. Eso es política de sincronización y vive en
 * M9: aquí solo está el transporte, para que se pueda leer entero y creer.
 */

/** Plazo por omisión. Diez segundos: más es un botón girando para siempre. */
const TIMEOUT_MS = 10_000;

/**
 * @template T
 * @typedef {{ ok: true, status: number, value: T }
 *         | { ok: false, status: number, error: string }} ApiResult
 */

/**
 * Una petición a la API propia.
 *
 * @param {string} path ruta que empieza por `/api/`
 * @param {{ method?: string, body?: unknown, timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<ApiResult<*>>}
 */
export async function request(path, options = {}) {
    // La aduana. Va antes que nada, y `startsWith('/api/')` no basta: `//evil.com`
    // empieza por `/` y el navegador lo resuelve como otro ORIGEN, y
    // `/api/../..//evil.com` se normaliza a algo que ya no es `/api/`.
    if (typeof path !== 'string' || !path.startsWith('/api/') || path.startsWith('//')) {
        return { ok: false, status: 0, error: 'api.badPath' };
    }
    const resuelta = new URL(path, location.origin);
    if (resuelta.origin !== location.origin || !resuelta.pathname.startsWith('/api/')) {
        return { ok: false, status: 0, error: 'api.badPath' };
    }

    const method = options.method ?? 'GET';
    const control = new AbortController();
    const plazo = setTimeout(() => control.abort(), options.timeoutMs ?? TIMEOUT_MS);
    // Si quien llama trae su propio `signal` —cerrar una vista a medias—, los dos
    // tienen que poder cancelar.
    options.signal?.addEventListener('abort', () => control.abort(), { once: true });

    /** @type {Record<string, string>} */ const headers = {};
    // El servidor EXIGE `application/json` en todo lo que no sea GET: es una de
    // las tres capas contra CSRF. Mandarlo también en GET no molesta y evita que
    // alguien lo olvide al copiar esta llamada.
    if (method !== 'GET') headers['Content-Type'] = 'application/json';

    let respuesta;
    try {
        respuesta = await fetch(resuelta.pathname + resuelta.search, {
            method,
            headers,
            credentials: 'same-origin',
            // Ni caché de navegador ni revalidación: una respuesta de la API
            // cacheada es una respuesta que miente sobre el estado del servidor.
            cache: 'no-store',
            // Sin redirecciones: la API no redirige nunca, así que una redirección
            // es una anomalía —o un intermediario— y seguirla es peor que fallar.
            redirect: 'error',
            body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
            signal: control.signal
        });
    } catch (error) {
        clearTimeout(plazo);
        const abortada = control.signal.aborted;
        return { ok: false, status: 0, error: abortada ? 'api.timeout' : 'api.offline' };
    }
    clearTimeout(plazo);

    let datos = null;
    try {
        const texto = await respuesta.text();
        datos = texto ? JSON.parse(texto) : null;
    } catch {
        // Una respuesta que no es JSON solo puede venir de un intermediario —el
        // portal cautivo de un hotel es el caso clásico—, porque la API siempre
        // responde JSON. Se trata como fallo, nunca se interpreta.
        return { ok: false, status: respuesta.status, error: 'api.badResponse' };
    }

    if (!respuesta.ok) {
        // El código de error lo pone el servidor y lo traduce el cliente con
        // `t()`. Aquí no se compone ningún mensaje: sería el primer literal
        // visible fuera de los diccionarios.
        const codigo = typeof datos?.error === 'string' ? datos.error : 'api.unknown';
        return { ok: false, status: respuesta.status, error: codigo };
    }

    return { ok: true, status: respuesta.status, value: datos };
}

/**
 * ¿Hay red, según el navegador?
 *
 * `navigator.onLine` miente en un sentido: dice `true` con el wifi de un tren sin
 * salida a internet. Sirve para lo contrario —cuando dice `false`, no la hay— y
 * así se usa: para no lanzar una petición que se sabe perdida, nunca para dar por
 * buena una que va a fallar.
 *
 * @returns {boolean}
 */
export function maybeOnline() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
}

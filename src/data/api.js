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
 * El plazo de las peticiones con bytes.
 *
 * Sesenta segundos y no diez: una foto de doscientos kilobytes por una red móvil
 * mala tarda más que un JSON de dos, y cortarla a los diez sería no poder subir
 * fotos precisamente donde se hacen.
 */
const BINARY_TIMEOUT_MS = 60_000;

/**
 * @template T
 * @typedef {{ ok: true, status: number, value: T }
 *         | { ok: false, status: number, error: string }} ApiResult
 */

/**
 * La ADUANA, y es de las dos puertas.
 *
 * `startsWith('/api/')` no basta: `//evil.com` empieza por `/` y el navegador lo
 * resuelve como otro ORIGEN, y `/api/../..//evil.com` se normaliza a algo que ya
 * no es `/api/`. Por eso se resuelve la URL y se comprueba lo resuelto, no lo
 * escrito.
 *
 * Vive en una función porque hay dos formas de salir de aquí —JSON y bytes— y
 * una aduana duplicada es una aduana que se queda a medias en una de las dos.
 *
 * @param {string} path
 * @returns {{ ok: true, url: URL } | { ok: false, error: string }}
 */
function comprobarRuta(path) {
    if (typeof path !== 'string' || !path.startsWith('/api/') || path.startsWith('//')) {
        return { ok: false, error: 'api.badPath' };
    }
    const url = new URL(path, location.origin);
    if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) {
        return { ok: false, error: 'api.badPath' };
    }
    return { ok: true, url };
}

/**
 * Una petición a la API propia.
 *
 * @param {string} path ruta que empieza por `/api/`
 * @param {{ method?: string, body?: unknown, timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<ApiResult<*>>}
 */
export async function request(path, options = {}) {
    const aduana = comprobarRuta(path);
    if (!aduana.ok) return { ok: false, status: 0, error: aduana.error };
    const resuelta = aduana.url;

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
 * Como `request`, pero con BYTES: para las fotos, que son lo único de esta
 * aplicación que no cabe razonablemente en JSON.
 *
 * Comparte la aduana entera —el mismo control de ruta, el mismo `same-origin`,
 * el mismo `no-store`, el mismo `redirect: 'error'`— porque **esta sigue siendo
 * la única puerta de salida** y partirla en dos sería partir también el sitio
 * donde se audita qué sale del dispositivo. Lo único que cambia es la forma del
 * cuerpo.
 *
 * El plazo es más largo: una foto de doscientos kilobytes por una red móvil mala
 * tarda más que un JSON de dos, y cortarla a los diez segundos sería no poder
 * subir fotos precisamente donde se hacen.
 *
 * @param {string} path
 * @param {{ method?: string, body?: Uint8Array, timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: true, status: number, value: unknown } | { ok: false, status: number, error: string }>}
 */
export async function requestBinary(path, options = {}) {
    const aduana = comprobarRuta(path);
    if (!aduana.ok) return { ok: false, status: 0, error: aduana.error };

    const method = options.method ?? 'GET';
    const control = new AbortController();
    const plazo = setTimeout(() => control.abort(), options.timeoutMs ?? BINARY_TIMEOUT_MS);
    options.signal?.addEventListener('abort', () => control.abort(), { once: true });

    /** @type {Record<string, string>} */ const headers = {};
    // `application/octet-stream` es uno de los DOS tipos que el servidor acepta
    // en una petición con efectos, y sigue cumpliendo la capa de CSRF: no es
    // ninguno de los tres que un `<form>` de otro origen puede producir.
    if (method !== 'GET') headers['Content-Type'] = 'application/octet-stream';

    let respuesta;
    try {
        respuesta = await fetch(aduana.url.pathname + aduana.url.search, {
            method,
            headers,
            credentials: 'same-origin',
            cache: 'no-store',
            redirect: 'error',
            body: method === 'GET' ? undefined : /** @type {BodyInit} */ (/** @type {*} */ (options.body)),
            signal: control.signal
        });
    } catch {
        clearTimeout(plazo);
        return { ok: false, status: 0, error: control.signal.aborted ? 'api.timeout' : 'api.offline' };
    }
    clearTimeout(plazo);

    if (!respuesta.ok) {
        // Los errores SÍ vienen en JSON, también aquí: el cuerpo binario es el
        // camino feliz, y un fallo tiene que poder explicarse con su código.
        let codigo = 'api.unknown';
        try {
            const datos = JSON.parse(await respuesta.text());
            if (typeof datos?.error === 'string') codigo = datos.error;
        } catch { /* un intermediario que no habla JSON: se queda el genérico */ }
        return { ok: false, status: respuesta.status, error: codigo };
    }

    // Un GET devuelve los bytes; un PUT o un DELETE devuelven el JSON de siempre.
    if (method === 'GET') {
        try {
            return { ok: true, status: respuesta.status, value: new Uint8Array(await respuesta.arrayBuffer()) };
        } catch {
            return { ok: false, status: respuesta.status, error: 'api.badResponse' };
        }
    }
    try {
        const texto = await respuesta.text();
        return { ok: true, status: respuesta.status, value: texto ? JSON.parse(texto) : null };
    } catch {
        return { ok: false, status: respuesta.status, error: 'api.badResponse' };
    }
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

// @ts-check

/**
 * Las respuestas de la API: una sola forma, y las cabeceras en un solo sitio.
 *
 * `_headers` **no se aplica a lo que genera el código** —Cloudflare Pages solo
 * lo usa para los ficheros estáticos—, así que las cabeceras de seguridad de la
 * API tienen que ponerse aquí. Es un detalle fácil de no saber y caro de
 * descubrir: la CSP estricta de la aplicación no protege ni una respuesta de
 * `/api/`.
 */

/**
 * Las cabeceras que lleva TODA respuesta de la API, sin excepción.
 *
 * - `no-store`: una respuesta de sincronización cacheada es una respuesta que
 *   miente sobre el estado del servidor. Va aquí además del bypass del service
 *   worker (M8-0), porque son dos cachés distintas.
 * - `default-src 'none'; sandbox`: una respuesta de la API nunca es un
 *   documento. Si alguna vez alguien la abre en una pestaña —o consigue que se
 *   interprete como HTML—, no puede ejecutar nada ni cargar nada.
 * - `nosniff`: sin él, un cuerpo JSON que empiece por `<` puede acabar
 *   interpretado como HTML por un navegador viejo.
 * - `Vary: Origin, Cookie`: la respuesta depende de quién la pide. Sin esto, una
 *   caché intermedia podría servirle a alguien la respuesta de otro. Es la
 *   cabecera cuya ausencia causa las fugas entre cuentas más silenciosas.
 * - `no-referrer`: las rutas de la API no tienen por qué viajar a ningún sitio.
 *
 * NO está `Access-Control-Allow-Origin`, y no es un olvido: la API es del mismo
 * origen que la aplicación, así que no hace falta CORS para nada. Emitirla sería
 * abrir la puerta que `SameSite=Strict` y la comprobación de `Origin` cierran.
 * Hay un test estático que falla si aparece en cualquier fichero de `functions/`.
 *
 * Tampoco está `Content-Type`, y eso es deliberado: el middleware SELLA estas
 * cabeceras sobre lo que devuelva cada manejador, así que meter aquí el tipo
 * convertiría en JSON toda respuesta —incluidas las fotos cifradas de M9-5, que
 * son bytes—. El tipo lo pone quien construye el cuerpo, que es el único que
 * sabe cuál es.
 */
export const API_HEADERS = Object.freeze({
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Vary': 'Origin, Cookie'
});

/**
 * Una respuesta JSON con las cabeceras de la API puestas.
 *
 * @param {unknown} body
 * @param {{ status?: number, headers?: Record<string, string> }} [init]
 * @returns {Response}
 */
export function json(body, init = {}) {
    const headers = new Headers(API_HEADERS);
    headers.set('Content-Type', 'application/json; charset=utf-8');
    for (const [k, v] of Object.entries(init.headers ?? {})) headers.set(k, v);
    return new Response(JSON.stringify(body), { status: init.status ?? 200, headers });
}

/**
 * Un error de la API. Siempre la misma forma: `{ error: '<código>' }`.
 *
 * El código es estable y legible por máquina; el texto para el usuario lo pone
 * el cliente con `t()`, que es donde vive la i18n. Un mensaje en prosa desde el
 * servidor sería el primer literal visible fuera de los diccionarios, y §5 de
 * `CLAUDE.md` lo prohíbe.
 *
 * Y no lleva detalle: «qué has hecho mal exactamente» es información que solo
 * le sirve a quien está probando la puerta.
 *
 * @param {number} status
 * @param {string} code
 * @param {{ headers?: Record<string, string> }} [init]
 * @returns {Response}
 */
export function fail(status, code, init = {}) {
    return json({ error: code }, { status, headers: init.headers });
}

/**
 * Una respuesta de BYTES. Existe para las fotos, y existe para que el guardián
 * «ningún manejador construye una Response a mano» siga siendo cierto: un
 * criptograma de 200 KB no cabe en `json()`, pero eso no es motivo para que un
 * manejador se salte los ayudantes y se lleve por delante la única regla que
 * garantiza que todas las respuestas tienen la misma forma.
 *
 * `application/octet-stream` y no un tipo de imagen, porque no lo es: son bytes
 * cifrados. Declararlos `image/webp` haría que un navegador intentara pintarlos
 * y que un intermediario creyera que puede recomprimirlos.
 *
 * @param {ReadableStream | ArrayBuffer} cuerpo
 * @param {number} bytes
 * @returns {Response}
 */
export function binary(cuerpo, bytes) {
    return new Response(cuerpo, {
        headers: {
            ...API_HEADERS,
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(bytes)
        }
    });
}

/**
 * Lee el cuerpo como JSON, sin lanzar nunca.
 *
 * @param {Request} request
 * @param {number} maxBytes
 * @returns {Promise<{ ok: true, value: unknown } | { ok: false, error: string }>}
 */
export async function readJson(request, maxBytes) {
    const declarado = Number(request.headers.get('Content-Length'));
    // Se mira la cabecera ANTES de leer: rechazar por el tamaño declarado evita
    // traerse el cuerpo entero a memoria para luego tirarlo. No basta —la
    // cabecera puede mentir o faltar—, por eso debajo se vuelve a medir.
    if (Number.isFinite(declarado) && declarado > maxBytes) {
        return { ok: false, error: 'body.tooLarge' };
    }
    let texto;
    try {
        texto = await request.text();
    } catch {
        return { ok: false, error: 'body.unreadable' };
    }
    // La medida de verdad, en BYTES y no en caracteres: un cuerpo de emojis
    // ocupa el cuádruple de lo que dice `.length`.
    if (new TextEncoder().encode(texto).length > maxBytes) {
        return { ok: false, error: 'body.tooLarge' };
    }
    try {
        return { ok: true, value: JSON.parse(texto) };
    } catch {
        return { ok: false, error: 'body.notJson' };
    }
}

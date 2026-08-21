// @ts-check

/**
 * El enrutador de la API: puro, y con una tabla como única fuente (M8-1).
 *
 * ## Por qué una tabla y no el enrutado por ficheros de Pages
 *
 * Cloudflare Pages enruta por nombre de fichero: `functions/api/health.js` se
 * convierte solo en `/api/health`. Es cómodo y es exactamente lo que aquí NO se
 * quiere, por la misma razón por la que existe `src/ui/views/_manifest.js`:
 * cuando añadir una ruta pública es dejar caer un fichero, hay rutas que nadie
 * ha revisado. En una API con datos de personas eso no es un riesgo aceptable.
 *
 * Aquí los manejadores viven en `functions/_handlers/`, que Pages **no enruta**
 * —el guion bajo se lo prohíbe—, y la única puerta es `functions/api/[[path]].js`.
 * Para publicar una ruta hay que escribirla en `_manifest.js`, y hay un test que
 * falla si un manejador no está en la tabla o si la tabla nombra uno que no
 * existe.
 *
 * Efecto secundario que también se buscaba: la tabla es la lista completa y
 * legible de lo que este servidor expone. Cabe en una pantalla y se audita de
 * un vistazo.
 */

/**
 * @typedef {object} Route
 * @property {string} method
 * @property {string} path Patrón: segmentos literales y `:nombre` para capturar.
 * @property {(ctx: EventContext & { params: Record<string, string> }) => Promise<Response> | Response} handler
 * @property {boolean} auth Si exige sesión. Explícito SIEMPRE: un valor por
 *   omisión aquí significaría que olvidarlo abre la ruta, y el fallo tiene que
 *   caer del lado de cerrar.
 */

/**
 * Busca la ruta que atiende a `method` + `pathname`.
 *
 * @param {readonly Route[]} routes
 * @param {string} method
 * @param {string} pathname
 * @returns {{ route: Route, params: Record<string, string> } | { route: null, allow: string[] }}
 *   Cuando no hay ruta, `allow` lleva los métodos que SÍ sirven esa ruta: si no
 *   está vacío, la respuesta correcta es 405 y no 404.
 */
export function match(routes, method, pathname) {
    // `HEAD` se atiende con el manejador de `GET`. Es lo que dice HTTP, y no
    // hacerlo deja un 405 en peticiones que cualquier comprobador de salud hace.
    const buscado = method === 'HEAD' ? 'GET' : method;
    const partes = split(pathname);
    /** @type {Set<string>} */ const allow = new Set();

    for (const route of routes) {
        const patron = split(route.path);
        if (patron.length !== partes.length) continue;

        /** @type {Record<string, string>} */ const params = {};
        let encaja = true;
        for (let i = 0; i < patron.length; i++) {
            const p = patron[i];
            if (p.startsWith(':')) {
                // Un segmento vacío no captura: `/api/photos//x` no puede pasar
                // por `/api/photos/:id`.
                if (partes[i] === '') { encaja = false; break; }
                params[p.slice(1)] = partes[i];
            } else if (p !== partes[i]) {
                encaja = false;
                break;
            }
        }
        if (!encaja) continue;

        if (route.method === buscado) return { route, params };
        allow.add(route.method);
        if (route.method === 'GET') allow.add('HEAD');
    }

    return { route: null, allow: [...allow].sort() };
}

/**
 * Trocea una ruta en segmentos, normalizando la barra final.
 *
 * `/api/health` y `/api/health/` tienen que ser la misma ruta: si no, cada
 * endpoint existe dos veces y solo una está probada.
 *
 * @param {string} pathname
 * @returns {string[]}
 */
function split(pathname) {
    const limpio = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
    return limpio.split('/').slice(1);
}

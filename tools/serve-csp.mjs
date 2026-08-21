// @ts-check

/**
 * Servidor con las cabeceras de producción (M6-3, cableado en M7-7).
 *
 * `python3 -m http.server` no manda cabeceras, así que la CSP de `_headers`
 * solo se probaría en producción — es decir, cuando ya es tarde.
 *
 * Este fichero existía desde M6-3 y estaba HUÉRFANO: `playwright.config.js`
 * levantaba el servidor de Python, y `docs/RELEASE-V5.md` afirmaba mientras
 * tanto que los E2E corrían bajo la CSP real citándolo. Ningún E2E se había
 * ejecutado nunca bajo la política. Desde M7-7 lo levanta Playwright en el
 * 8081 y es el servidor por omisión de toda la suite.
 *
 * Las cabeceras se LEEN de `_headers`, no se copian: la política que se prueba
 * es literalmente la que despliega Cloudflare Pages.
 *
 * **Y desde E15-0 es también el servidor de `npm run serve`, en el 8080.**
 * `python3 -m http.server` no manda `Cache-Control`, así que el navegador
 * aplicaba caché HEURÍSTICA a los módulos: medido en un navegador real, tras
 * editar `expenditure.js` y recargar con el service worker ya desinstalado, la
 * página seguía ejecutando el módulo anterior —sin `setOnCreatePlan` en sus
 * exports—. Es el mismo fósil que E15-0 fue a matar, por la otra puerta: la del
 * caché HTTP en vez de la del service worker. `_headers` trae `no-cache`, este
 * servidor lo sirve, y además nunca responde 304, así que lo que se ejecuta es
 * siempre lo que hay en disco.
 *
 * El 8080 y el 8081 son el mismo servidor a propósito, y solo se distinguen en
 * el puerto: `src/ui/pwa.js#swPolicy` registra el service worker en el 8081
 * (paridad con producción, donde corre `pwa.spec.js`) y lo DESINSTALA en el
 * 8080. Un solo servidor, dos políticas de service worker.
 *
 * Uso manual: node tools/serve-csp.mjs [puerto]
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2]) || 8081;

/**
 * `--api` monta las Pages Functions REALES en este mismo proceso, con el D1 de
 * `node:sqlite` detrás (M8-5d).
 *
 * POR QUÉ ESTO Y NO `wrangler pages dev`: el E2E de la cuenta necesita un
 * servidor con `/api/*` vivo, y meter `wrangler` en el arranque de Playwright
 * traería workerd, un D1 en disco y un paso de migraciones a CI. Aquí se
 * ejecutan **el middleware y el enrutador de verdad** —el mismo código que
 * despliega Pages— sobre el mismo doble de D1 que usan los tests unitarios. Lo
 * único sustituido es el runtime, y eso se verifica aparte, a mano, con
 * `npm run serve:api`.
 *
 * Sin la bandera no se carga nada de esto: los servidores 8081 y 8082 siguen
 * siendo exactamente lo que eran.
 */
const WITH_API = process.argv.includes('--api');

/** @type {null | ((req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>)} */
let apiHandler = null;

if (WITH_API) {
    const [{ onRequest: middleware }, { onRequest: enrutador }, { createD1 }] = await Promise.all([
        import('../functions/_middleware.js'),
        import('../functions/api/[[path]].js'),
        import('../test/helpers/d1-fake.js')
    ]);
    const { db } = createD1();
    const env = { DB: db, PHOTOS: null };

    apiHandler = async (req, res) => {
        const cuerpo = await new Promise((resolve) => {
            /** @type {Buffer[]} */ const trozos = [];
            req.on('data', (c) => trozos.push(c));
            req.on('end', () => resolve(Buffer.concat(trozos)));
        });

        const request = new Request(`http://localhost:${PORT}${req.url}`, {
            method: req.method,
            headers: /** @type {*} */ (req.headers),
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : cuerpo
        });

        const ctx = {
            request, env, params: {}, data: {},
            waitUntil: (/** @type {Promise<unknown>} */ p) => { Promise.resolve(p).catch(() => {}); },
            next: () => enrutador({ ...ctx, request })
        };
        const respuesta = await middleware(/** @type {*} */ (ctx));

        /** @type {Record<string, string | string[]>} */ const cabeceras = {};
        respuesta.headers.forEach((v, k) => {
            // `Set-Cookie` puede repetirse; `headers.forEach` las junta con
            // coma, y una cookie con coma es una cookie rota.
            cabeceras[k] = k.toLowerCase() === 'set-cookie'
                ? /** @type {*} */ (respuesta.headers.getSetCookie?.() ?? [v])
                : v;
        });
        res.writeHead(respuesta.status, cabeceras);
        res.end(Buffer.from(await respuesta.arrayBuffer()));
    };
}

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    // Sin estos dos, `robots.txt` y `llms.txt` salían como
    // application/octet-stream y, con `nosniff`, el navegador los rechazaba.
    '.txt': 'text/plain; charset=utf-8',
    '.ico': 'image/x-icon'
};

/**
 * Lee TODAS las secciones de `_headers`, no solo la global.
 *
 * La primera versión solo parseaba `/*`, y eso dejaba fuera precisamente la
 * regla que `CLAUDE.md` §6 señala como crítica: el `Cache-Control: no-cache`
 * de `/sw.js`. O sea que el servidor afirmaba servir «literalmente lo que
 * despliega Cloudflare Pages» omitiendo la única cabecera cuyo fallo produce
 * el peor defecto del proyecto — un service worker rancio.
 * @returns {Map<string, Record<string, string>>} ruta → cabeceras
 */
function headersByPath() {
    const lines = readFileSync(join(ROOT, '_headers'), 'utf8').split('\n');
    /** @type {Map<string, Record<string, string>>} */ const sections = new Map();
    let current = null;
    for (const line of lines) {
        if (line.trim().startsWith('#') || line.trim() === '') continue;
        if (!line.startsWith(' ')) {
            current = line.trim();
            if (!sections.has(current)) sections.set(current, {});
            continue;
        }
        if (current === null) continue;
        const at = line.indexOf(':');
        if (at > 0) (sections.get(current) ?? {})[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    return sections;
}

const SECTIONS = headersByPath();
const HEADERS = SECTIONS.get('/*') ?? {};

/** Cabeceras globales más las de la ruta concreta, si `_headers` define alguna. */
function headersFor(pathname) {
    return { ...HEADERS, ...(SECTIONS.get(pathname) ?? {}) };
}

console.log('Cabeceras servidas:');
for (const [k, v] of Object.entries(HEADERS)) console.log(`  ${k}: ${v.slice(0, 120)}${v.length > 120 ? '…' : ''}`);
for (const [ruta, h] of SECTIONS) {
    if (ruta === '/*') continue;
    console.log(`  ${ruta} → ${Object.entries(h).map(([k, v]) => `${k}: ${v}`).join(', ')}`);
}

createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

    if (apiHandler && url.pathname.startsWith('/api/')) {
        apiHandler(req, res).catch((error) => {
            console.error('api', error);
            if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end('{"error":"internal"}');
        });
        return;
    }

    // Cloudflare Pages responde 308 a /index.html y redirige a /. Se imita
    // aquí porque esa redirección es la que rompe el service worker: una
    // respuesta redirigida devuelta a una navegación la rechaza el navegador.
    if (url.pathname === '/index.html') {
        res.writeHead(308, { ...HEADERS, Location: '/' }).end();
        return;
    }
    // `decodeURIComponent` LANZA con un `%` mal formado (`/%zz`, `/%C0%AF`,
    // `/a%2`), y sin capturarlo el proceso moría — con él, los 81 E2E que
    // ahora dependen de este servidor. `%C0%AF` es, además, lo que manda
    // cualquier escáner de traversal. Cloudflare Pages devuelve 400, no se cae.
    let decoded;
    try {
        decoded = decodeURIComponent(url.pathname);
    } catch {
        res.writeHead(400, HEADERS).end('URI mal formada');
        return;
    }
    // normalize + prefijo: nadie sale de ROOT con ../
    let filePath = join(ROOT, normalize(decoded));
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403).end();
        return;
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
    if (!existsSync(filePath)) {
        res.writeHead(404, HEADERS).end('no encontrado');
        return;
    }
    res.writeHead(200, {
        ...headersFor(url.pathname),
        'Content-Type': TYPES[extname(filePath)] ?? 'application/octet-stream'
    });
    res.end(readFileSync(filePath));
}).listen(PORT, () => console.log(`\nCSP real en http://localhost:${PORT}${WITH_API ? ' (con /api/*)' : ''}`));

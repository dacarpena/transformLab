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
 * Uso manual: node tools/serve-csp.mjs [puerto]
 */

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.argv[2]) || 8081;

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
}).listen(PORT, () => console.log(`\nCSP real en http://localhost:${PORT}`));

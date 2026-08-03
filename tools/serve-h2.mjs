// @ts-check

/**
 * Servidor HTTP/2 con las cabeceras de `_headers`, para medir rendimiento
 * sobre la misma superficie que Cloudflare Pages.
 *
 * Existe porque medir esta aplicación sobre HTTP/1.1 miente: sin bundler son
 * ~50 peticiones, y el límite de 6 conexiones por origen de HTTP/1.1 las
 * serializa en unas 9 rondas. Cloudflare Pages sirve HTTP/2, donde esas 50
 * peticiones viajan multiplexadas por una sola conexión. La cifra de
 * Lighthouse cambia mucho según cuál de las dos se mida, y la que vale es la
 * que verá el usuario.
 *
 * Uso: node tools/serve-h2.mjs <cert.pem> <key.pem> [puerto]
 */

import { createSecureServer } from 'node:http2';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const [certPath, keyPath, portArg] = process.argv.slice(2);
const PORT = Number(portArg) || 8443;

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.txt': 'text/plain; charset=utf-8'
};

function globalHeaders() {
    const lines = readFileSync(join(ROOT, '_headers'), 'utf8').split('\n');
    /** @type {Record<string, string>} */ const headers = {};
    let inGlobal = false;
    for (const line of lines) {
        if (line.startsWith('#') || line.trim() === '') continue;
        if (!line.startsWith(' ')) {
            inGlobal = line.trim() === '/*';
            continue;
        }
        if (!inGlobal) continue;
        const at = line.indexOf(':');
        if (at > 0) headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
    }
    return headers;
}

const HEADERS = globalHeaders();

createSecureServer({
    cert: readFileSync(certPath),
    key: readFileSync(keyPath),
    allowHTTP1: true
}, (req, res) => {
    const path = (req.url ?? '/').split('?')[0];
    let filePath = join(ROOT, normalize(decodeURIComponent(path)));
    if (!filePath.startsWith(ROOT)) {
        res.writeHead(403).end();
        return;
    }
    if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = join(filePath, 'index.html');
    if (!existsSync(filePath)) {
        res.writeHead(404, HEADERS).end('no encontrado');
        return;
    }
    res.writeHead(200, { ...HEADERS, 'Content-Type': TYPES[extname(filePath)] ?? 'application/octet-stream' });
    res.end(readFileSync(filePath));
}).listen(PORT, () => console.log(`HTTP/2 + CSP en https://localhost:${PORT}`));

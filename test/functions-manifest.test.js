// @ts-check

/**
 * Las guardas estáticas del servidor (M8-1).
 *
 * Mismo espíritu que `test/security.test.js` y `test/views-manifest.test.js`:
 * hay decisiones que no se pueden dejar en «acuérdate», porque el día que
 * alguien no se acuerde el fallo es silencioso y está en la puerta de la API.
 *
 * La más importante es la del manifiesto. Cloudflare Pages enruta por nombre de
 * fichero: dejar caer un `.js` en `functions/api/` PUBLICA una ruta. Aquí los
 * manejadores viven en `functions/_handlers/`, que el guion bajo saca del
 * enrutado, y la única forma de exponer algo es escribirlo en `_manifest.js`.
 * Estos tests exigen que las dos listas coincidan en las dos direcciones.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isICloudDuplicate } from './helpers/tree.js';
import { ROUTES } from '../functions/_manifest.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FUNCTIONS = join(ROOT, 'functions');

/** Todos los `.js` de `functions/`, con su ruta relativa. */
const FICHEROS = (() => {
    /** @type {{ rel: string, code: string }[]} */ const out = [];
    const walk = (/** @type {string} */ dir, /** @type {string} */ prefijo) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (isICloudDuplicate(e.name)) continue;
            const full = join(dir, e.name);
            const rel = prefijo ? `${prefijo}/${e.name}` : e.name;
            if (e.isDirectory()) walk(full, rel);
            else if (e.name.endsWith('.js')) out.push({ rel, code: readFileSync(full, 'utf8') });
        }
    };
    walk(FUNCTIONS, '');
    return out;
})();

const MANIFIESTO = readFileSync(join(FUNCTIONS, '_manifest.js'), 'utf8');

/* ── El manifiesto es la fuente única ────────────────────────────────────── */

test('todo manejador de functions/_handlers/ está en el manifiesto', () => {
    const handlers = readdirSync(join(FUNCTIONS, '_handlers'))
        .filter((n) => n.endsWith('.js') && !isICloudDuplicate(n));
    assert.ok(handlers.length > 0, '¿se movió la carpeta de manejadores?');
    const huerfanos = handlers.filter((n) => !MANIFIESTO.includes(`_handlers/${n}`));
    assert.deepEqual(huerfanos, [],
        `manejadores que no expone nadie —o rutas publicadas sin revisar—: ${huerfanos.join(', ')}`);
});

test('toda ruta del manifiesto apunta a una función de verdad', () => {
    for (const r of ROUTES) {
        assert.equal(typeof r.handler, 'function', `${r.method} ${r.path} no tiene manejador`);
    }
});

test('functions/api/ contiene SOLO el atrapatodo', () => {
    // Es la guarda que impide volver al enrutado por fichero sin darse cuenta:
    // cualquier `.js` suelto aquí se publica como ruta sin pasar por la tabla.
    const enApi = readdirSync(join(FUNCTIONS, 'api')).filter((n) => !isICloudDuplicate(n));
    assert.deepEqual(enApi, ['[[path]].js'],
        `en functions/api/ solo puede estar el atrapatodo, y hay: ${enApi.join(', ')}`);
});

test('cada ruta declara `auth` explícitamente, y ninguna se repite', () => {
    // Sin valor por omisión: con uno, olvidar `auth` abriría la ruta. El fallo
    // tiene que caer siempre del lado de cerrar.
    const vistas = new Set();
    for (const r of ROUTES) {
        assert.equal(typeof r.auth, 'boolean', `${r.method} ${r.path} no declara auth`);
        assert.ok(r.path.startsWith('/api/'), `${r.path} no cuelga de /api/`);
        const clave = `${r.method} ${r.path}`;
        assert.equal(vistas.has(clave), false, `ruta duplicada: ${clave} (la segunda no se alcanza nunca)`);
        vistas.add(clave);
    }
});

test('_routes.json limita la Function a /api/*', () => {
    // Sin esto, Pages invoca la Function en CADA petición, incluidas las de los
    // ficheros estáticos: se gastaría el techo de peticiones sirviendo CSS.
    const rutas = JSON.parse(readFileSync(join(ROOT, '_routes.json'), 'utf8'));
    assert.deepEqual(rutas.include, ['/api/*']);
    assert.deepEqual(rutas.exclude, []);
});

/* ── CORS: la puerta que este diseño mantiene cerrada ────────────────────── */

test('NADIE emite Access-Control-* en functions/', () => {
    // La API es del mismo origen que la aplicación: no hace falta CORS para
    // nada, y emitirlo abriría la puerta que `SameSite=Strict` y la comprobación
    // de `Origin` cierran. Se descartan los comentarios antes de mirar, porque
    // los que explican la decisión nombran la cabecera.
    const culpables = FICHEROS
        .filter(({ code }) => /['"`]Access-Control-[A-Za-z-]+['"`]/.test(sinComentarios(code)))
        .map(({ rel }) => rel);
    assert.deepEqual(culpables, [], `emiten CORS: ${culpables.join(', ')}`);
});

test('la CSP de _headers sigue SIN relajar connect-src: es lo que compra el mismo origen', () => {
    // Toda la topología —Pages Functions en vez de un Worker aparte— se eligió
    // para no tener que tocar esta línea. Si algún día aparece un host ajeno
    // aquí, la decisión se ha deshecho y hay que rehacer el análisis, no
    // actualizar el test.
    const headers = readFileSync(join(ROOT, '_headers'), 'utf8');
    const directivas = headers.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    assert.match(directivas, /connect-src 'self';/);
    assert.doesNotMatch(directivas, /connect-src [^;]*https:\/\//);
});

/* ── Que el servidor no arrastre el cliente ──────────────────────────────── */

test('functions/ no importa NADA de src/ui ni toca el DOM', () => {
    // El servidor puede reutilizar `src/core` y `src/data/schema.js` —son puros—
    // pero no la interfaz. Un import de `src/ui/` metería `document` en un
    // Worker, y el fallo aparecería en la primera petición en producción.
    for (const { rel, code } of FICHEROS) {
        assert.doesNotMatch(code, /from\s+['"][^'"]*src\/ui\//, `${rel} importa de src/ui/`);
        const limpio = sinComentarios(code);
        for (const global of ['document.', 'window.', 'localStorage.', 'indexedDB']) {
            assert.equal(limpio.includes(global), false, `${rel} usa ${global}`);
        }
    }
});

test('ningún manejador construye una Response saltándose los ayudantes', () => {
    // Las cabeceras de seguridad las sella el middleware a la salida, así que un
    // `new Response` no las pierde. Pero sí pierde la forma `{error: código}` y
    // el `Content-Type`, y eso convierte un error de la API en algo que el
    // cliente no sabe leer. El atrapatodo y el middleware sí pueden: son los
    // dueños de los caminos de fallo.
    const permitidos = new Set(['api/[[path]].js', '_middleware.js', '_lib/http.js']);
    for (const { rel, code } of FICHEROS) {
        if (permitidos.has(rel)) continue;
        assert.doesNotMatch(sinComentarios(code), /new Response\(/, `${rel} construye Response a mano`);
    }
});

test('nada de functions/_lib/ está escrito y sin cablear', () => {
    // La lección de E15, aplicada al servidor: `renderCoordinatedOffer` estuvo
    // meses escrita, probada y sin que la llamara nadie, y un invariante que no
    // gobierna nada del producto es documentación, no garantía. Aquí eso sería
    // peor: una función de seguridad que nadie invoca —un barrido que no barre,
    // una revocación que no revoca— parece una defensa y no lo es.
    //
    // Se acepta que la use `functions/` O un test: un ayudante probado a fondo y
    // aún sin consumidor es trabajo en curso legítimo, mientras conste.
    const consumidores = [
        ...FICHEROS.map(({ code }) => code),
        ...readdirSync(join(ROOT, 'test'))
            .filter((n) => n.endsWith('.test.js') && !isICloudDuplicate(n))
            .map((n) => readFileSync(join(ROOT, 'test', n), 'utf8'))
    ].join('\n');

    /** @type {string[]} */ const huerfanas = [];
    for (const { rel, code } of FICHEROS) {
        if (!rel.startsWith('_lib/')) continue;
        for (const m of sinComentarios(code).matchAll(
            /export\s+(?:async\s+)?(?:function|const|class)\s+(\w+)/g)) {
            const nombre = m[1];
            // Se busca el nombre en un contexto de uso, no en cualquier sitio:
            // su propia declaración no cuenta como consumidor.
            const usos = [...consumidores.matchAll(new RegExp(`\\b${nombre}\\b`, 'g'))].length;
            if (usos <= 1) huerfanas.push(`${rel}: ${nombre}`);
        }
    }
    assert.deepEqual(huerfanas, [],
        `exportadas y sin cablear —una defensa que nadie invoca parece una defensa—: ${huerfanas.join(', ')}`);
});

/** Quita comentarios de bloque y de línea, para no leer lo que solo se explica. */
function sinComentarios(/** @type {string} */ code) {
    return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

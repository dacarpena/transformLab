// @ts-check

/**
 * La PWA (M6-1) se cae de una forma muy concreta: alguien añade un módulo,
 * nadie lo añade a `PRECACHE`, y la aplicación deja de abrir sin red — pero
 * solo para quien ya la tenía instalada, así que en desarrollo no se ve.
 *
 * Estos tests comparan la lista contra el árbol REAL de ficheros y contra lo
 * que `index.html` carga, para que ese fallo se vea aquí y no en el móvil de
 * alguien en el metro.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { isICloudDuplicate } from './helpers/tree.js';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { swPolicy, PROD_PARITY_PORT } from '../src/ui/pwa.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** @param {string} dir @param {string[]} extensions */
function filesUnder(dir, extensions) {
    /** @type {string[]} */ const out = [];
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (isICloudDuplicate(entry.name)) continue;  // duplicado de iCloud, no fuente
            const full = join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (extensions.some((ext) => entry.name.endsWith(ext))) {
                out.push(relative(ROOT, full));
            }
        }
    };
    walk(join(ROOT, dir));
    return out.sort();
}

const swSource = readFileSync(join(ROOT, 'sw.js'), 'utf8');

/**
 * Extrae el array PRECACHE del fuente del service worker.
 *
 * Quitando los comentarios primero: dentro del array hay uno que menciona
 * `'index.html'` entrecomillado para explicar por qué NO está, y sin esto se
 * colaba en la lista como si lo estuviera.
 */
function precacheList() {
    const match = swSource.match(/const PRECACHE = \[([\s\S]*?)\];/);
    assert.ok(match, 'sw.js debe declarar `const PRECACHE = [...]`');
    const body = match[1]
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('PRECACHE incluye todos los módulos de src/ (si falta uno, no abre offline)', () => {
    const modules = filesUnder('src', ['.js', '.json']);
    const cached = new Set(precacheList());
    const missing = modules.filter((file) => !cached.has(file));
    assert.deepEqual(missing, [], `módulos fuera de PRECACHE: ${missing.join(', ')}`);
});

test('PRECACHE incluye el CSS, el vendor y los iconos del manifiesto', () => {
    const cached = new Set(precacheList());
    // './' y no 'index.html': ver el test de más abajo sobre el 308 de Cloudflare
    for (const file of ['css/tokens.css', 'css/app.css', 'vendor/chart.umd.min.js', './', 'manifest.webmanifest']) {
        assert.ok(cached.has(file), `falta ${file} en PRECACHE`);
    }
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
    for (const icon of manifest.icons) {
        assert.ok(cached.has(icon.src), `falta el icono ${icon.src} en PRECACHE`);
    }
});

test('PRECACHE no contiene index.html: Cloudflare lo redirige y tumba el precache', () => {
    // El peor fallo de M6. `GET /index.html` responde 308 → / en Cloudflare
    // Pages, y `cache.addAll` es todo-o-nada: esa sola entrada hacía que el
    // service worker NO se instalara nunca en producción, así que la
    // aplicación no tenía offline en absoluto. Y no se notaba, porque cargaba
    // de red igual. El shell se precachea como './', que sí responde 200.
    const cached = precacheList();
    assert.ok(!cached.includes('index.html'),
        'index.html en PRECACHE: en producción redirige (308) y tumba el precache entero');
    assert.ok(cached.includes('./'), 'falta el shell (./) en PRECACHE');

    // Y la navegación tiene que servirse de './', no de 'index.html'
    assert.match(swSource, /\bcache\.match\('\.\/'\)/,
        'la navegación debe resolverse con match(\'./\')');
    assert.ok(!/match\('index\.html'\)/.test(swSource),
        'devolver index.html a una navegación sirve una respuesta redirigida, que el navegador rechaza');
});

test('un precache fallido no puede ser silencioso', () => {
    // Todo-o-nada es deliberado, pero enterarse no es opcional: sin el aviso,
    // una app sin offline se descubre en el metro.
    assert.match(swSource, /console\.error\(\s*'\[sw\] precache incompleto/);
});

test('todo lo que PRECACHE promete existe de verdad en el repositorio', () => {
    const phantom = precacheList()
        .filter((entry) => entry !== './')
        .filter((entry) => !existsSync(join(ROOT, entry)));
    assert.deepEqual(phantom, [], `PRECACHE apunta a ficheros inexistentes: ${phantom.join(', ')}`);
});

test('el manifiesto declara iconos any y maskable, y todos existen', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
    const purposes = new Set(manifest.icons.map((/** @type {*} */ i) => i.purpose));
    assert.ok(purposes.has('any'), 'falta un icono con purpose "any"');
    assert.ok(purposes.has('maskable'), 'falta un icono maskable (Android recorta el otro)');

    const sizes = new Set(manifest.icons.map((/** @type {*} */ i) => i.sizes));
    assert.ok(sizes.has('192x192') && sizes.has('512x512'), 'faltan los tamaños 192 y 512');

    for (const icon of manifest.icons) {
        assert.ok(existsSync(join(ROOT, icon.src)), `el icono ${icon.src} no existe`);
    }
    assert.equal(manifest.display, 'standalone');
    assert.equal(manifest.start_url, '/');
});

test('el service worker no llama a skipWaiting sin que lo pida la página', () => {
    // Recargar sola a alguien que está escribiendo un check-in es perder su
    // trabajo: `skipWaiting` solo puede aparecer dentro del manejador de
    // mensajes, disparado por el botón del aviso.
    const calls = [...swSource.matchAll(/skipWaiting\(\)/g)];
    assert.equal(calls.length, 1, 'skipWaiting debe aparecer una sola vez');

    const inMessageHandler = /addEventListener\('message'[\s\S]*?skipWaiting\(\)/.test(swSource);
    assert.ok(inMessageHandler, 'skipWaiting debe estar dentro del manejador de "message"');

    const inInstall = /addEventListener\('install'[\s\S]*?skipWaiting\(\)[\s\S]*?addEventListener\('activate'/.test(swSource);
    assert.ok(!inInstall, 'skipWaiting en install recargaría al usuario por sorpresa');
});

test('el service worker no cachea respuestas fallidas ni de otros orígenes', () => {
    assert.match(swSource, /response\.ok/, 'debe comprobar response.ok antes de cachear');
    assert.match(swSource, /url\.origin !== self\.location\.origin/, 'debe ignorar otros orígenes');
});

test('index.html enlaza el manifiesto y los iconos que el manifiesto declara', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
    assert.match(html, /rel="apple-touch-icon"/);
    assert.match(html, /<meta name="theme-color"/);

    // El theme-color del HTML y el del manifiesto tienen que coincidir, o la
    // barra del sistema cambia de color al instalar.
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
    const themeColor = html.match(/<meta name="theme-color" content="([^"]+)"/);
    assert.ok(themeColor);
    assert.equal(themeColor[1], manifest.theme_color);
});

test('Open Graph usa URLs absolutas y apunta a una imagen que existe', () => {
    // La especificación de Open Graph exige URL absoluta, y los rastreadores
    // de WhatsApp, LinkedIn y Facebook no resuelven una ruta relativa: con una
    // relativa, el enlace se comparte sin imagen.
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    for (const prop of ['og:url', 'og:image']) {
        const m = html.match(new RegExp(`<meta property="${prop}" content="([^"]+)"`));
        assert.ok(m, `falta ${prop}`);
        assert.match(m[1], /^https:\/\//, `${prop} tiene que ser una URL absoluta: ${m[1]}`);
    }
    const image = html.match(/<meta property="og:image" content="[^"]*\/([^"/]+)"/);
    assert.ok(image);
    assert.ok(existsSync(join(ROOT, 'icons', image[1])), `la imagen de Open Graph no existe: ${image[1]}`);
});

test('el service worker se registra saltándose la caché HTTP del navegador', () => {
    // Medido en producción: la zona de Cloudflare reescribe `Cache-Control` a
    // `max-age=14400` para los `.js`, incluido `sw.js` —que tiene su propia
    // regla `no-cache` en `_headers` y aun así llega con cuatro horas de caché.
    //
    // Sin `updateViaCache: 'none'`, el navegador comprueba si hay service worker
    // nuevo LEYENDO EL VIEJO de su caché, así que durante cuatro horas no hay
    // actualización posible: ni del service worker ni de nada de lo que él
    // precachea. Es el único punto del que depende que la app se pueda
    // actualizar, y por eso tiene test.
    const source = readFileSync(join(ROOT, 'src/ui/pwa.js'), 'utf8');
    assert.match(source, /updateViaCache:\s*'none'/,
        'el registro del SW debe saltarse la caché HTTP');
});

test('el precache pide los ficheros con `cache: reload`', () => {
    // La otra mitad del mismo problema: instalar el service worker nuevo no
    // sirve de nada si precachea los módulos VIEJOS desde la caché HTTP.
    const source = readFileSync(join(ROOT, 'sw.js'), 'utf8');
    assert.match(source, /cache:\s*'reload'/);
});

/* ────────────────────────────────────────────────────────────────────────────
 * E15-0 · El service worker no puede secuestrar el desarrollo
 *
 * `sw.js` es cache-first SIN revalidar y no llama a `skipWaiting()` (las dos
 * cosas, a propósito). En producción eso es lo correcto. En `npm run serve`
 * significaba que editabas un módulo, recargabas, y el navegador seguía
 * ejecutando el de antes indefinidamente: la capacidad de verificar cualquier
 * cosa en local, perdida, y en silencio.
 *
 * `swPolicy` es la decisión entera, y es pura para poder probarla como una
 * tabla de verdad. El único origen local que sigue registrando es el que
 * reproduce producción, porque ahí corre `test/e2e/pwa.spec.js`, que es lo que
 * comprueba el precache y el modo avión.
 * ──────────────────────────────────────────────────────────────────────────── */

test('swPolicy: producción registra, desarrollo limpia, y el 8081 sigue siendo producción', () => {
    /** @type {Array<[string, string, boolean, 'register'|'skip'|'cleanup', string]>} */
    const casos = [
        // hostname          port    seguro   esperado     por qué
        ['motifyer.com',     '',     true,    'register',  'producción'],
        ['transformlab.pages.dev', '', true,  'register',  'el despliegue de Pages'],
        ['127.0.0.1',        '8081', true,    'register',  'serve-csp.mjs reproduce producción; ahí corre pwa.spec.js'],
        ['localhost',        '8081', true,    'register',  'el mismo servidor por su otro nombre'],
        ['localhost',        '8080', true,    'cleanup',   'npm run serve: aquí nacía el módulo fósil'],
        ['127.0.0.1',        '8080', true,    'cleanup',   'npm run serve por IP'],
        ['127.0.0.1',        '8082', true,    'cleanup',   'el servidor sin cabeceras de dom-security.spec.js'],
        ['[::1]',            '8080', true,    'cleanup',   'bucle local en IPv6'],
        ['app.localhost',    '3000', true,    'cleanup',   'subdominio de localhost, que también es contexto seguro'],
        ['motifyer.com',     '',     false,   'skip',      'sin contexto seguro no hay service worker que registrar'],
        ['127.0.0.1',        '8080', false,   'skip',      'ni que limpiar: la API no existe'],
        ['',                 '',     false,   'skip',      'file://']
    ];

    for (const [hostname, port, isSecureContext, esperado, porque] of casos) {
        assert.equal(
            swPolicy({ hostname, port, isSecureContext }),
            esperado,
            `${hostname || 'file://'}:${port || '-'} (seguro=${isSecureContext}) debería dar «${esperado}» — ${porque}`
        );
    }
});

test('PROD_PARITY_PORT es el puerto que levanta Playwright, no el de npm run serve', () => {
    // Dos escrituras del mismo número atadas por un test: el mismo candado que
    // `sw.lock.json` pone sobre `CACHE_VERSION`. Si alguien mueve el puerto en
    // `playwright.config.js` y no aquí, `pwa.spec.js` se quedaría sin service
    // worker que probar y sus tests fallarían de una forma incomprensible.
    const playwright = readFileSync(join(ROOT, 'playwright.config.js'), 'utf8');
    assert.ok(
        playwright.includes(`serve-csp.mjs ${PROD_PARITY_PORT}`),
        `playwright.config.js debe levantar serve-csp.mjs en el puerto ${PROD_PARITY_PORT}`
    );
    assert.ok(
        playwright.includes(`baseURL: 'http://127.0.0.1:${PROD_PARITY_PORT}'`),
        `los E2E deben apuntar al puerto ${PROD_PARITY_PORT}`
    );

    // Y el servidor de desarrollo NO puede coincidir con él, o volveríamos a
    // registrar el service worker justo donde estorba.
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.ok(
        !pkg.scripts.serve.includes(PROD_PARITY_PORT),
        `npm run serve no puede usar el puerto ${PROD_PARITY_PORT}: ahí sí se registra el service worker`
    );
});

test('npm run serve manda las cabeceras de _headers, o el caché HTTP fosiliza igual', () => {
    // Desinstalar el service worker cierra UNA de las dos puertas por las que
    // entra un módulo fósil. La otra es el caché HTTP del navegador:
    // `python3 -m http.server` no manda `Cache-Control`, así que el navegador
    // aplica caché HEURÍSTICA. Medido en un navegador real con el SW ya
    // desinstalado: tras editar `expenditure.js` y recargar, la página seguía
    // ejecutando el módulo anterior — `import()` devolvía un objeto sin
    // `setOnCreatePlan` entre sus exports.
    //
    // `_headers` trae `Cache-Control: no-cache` y `tools/serve-csp.mjs` lo
    // sirve, además de no responder 304 nunca. Bonus: la CSP de producción pasa
    // a estar activa también en desarrollo, así que una violación se ve el día
    // que se escribe y no el día que se despliega.
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.match(pkg.scripts.serve, /serve-csp\.mjs/,
        'npm run serve debe usar tools/serve-csp.mjs: un servidor sin Cache-Control fosiliza los módulos');

    const headers = readFileSync(join(ROOT, '_headers'), 'utf8');
    assert.match(headers, /Cache-Control:\s*no-cache/,
        '_headers debe seguir trayendo no-cache: es lo que el servidor de desarrollo sirve');
});

test('la limpieza de desarrollo solo borra cachés de TransformLab', () => {
    // Un `caches.delete` sin filtro en un origen compartido —localhost lo es,
    // y ahí conviven todos los proyectos de la máquina— borraría las cachés de
    // otra aplicación. El prefijo `tl-` es la frontera.
    const source = readFileSync(join(ROOT, 'src/ui/pwa.js'), 'utf8');
    assert.match(source, /startsWith\('tl-'\)/,
        'cleanup() debe filtrar por el prefijo tl- antes de borrar cachés');
});

test('el service worker sirve SOLO de la caché de su versión, nunca de la búsqueda global', () => {
    // `CacheStorage.match()` recorre TODAS las cachés y devuelve la primera por
    // orden de creación. Con una caché vieja superviviente, eso sirve el módulo
    // fósil aunque el actual esté cacheado — y entre `install` y `activate` las
    // dos coexisten SIEMPRE, durante todo el tiempo que el usuario tarde en
    // aceptar el aviso de versión nueva, porque no hay `skipWaiting`.
    //
    // Comprobado en un navegador real antes de escribir este test: la búsqueda
    // global devolvía el `pwa.js` viejo teniendo el nuevo delante. Es el mismo
    // fallo que `CACHE_VERSION` existe para impedir, colado por la puerta de al
    // lado.
    // Sin comentarios: la explicación de por qué NO se usa contiene la cadena.
    const code = swSource
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const global = [...code.matchAll(/(?<![.\w])caches\.match\s*\(/g)];
    assert.deepEqual(global.map((m) => m[0]), [],
        'usa `(await caches.open(CACHE_VERSION)).match(...)`, no `caches.match(...)`');

    // Y que de verdad se abre la caché versionada antes de responder.
    assert.match(swSource, /caches\.open\(CACHE_VERSION\)/);
});

/* ── Poder ver la versión, y poder cambiarla ─────────────────────────────── */

test('la carrera de `updatefound`: también se vigila lo que YA se está instalando', () => {
    // Entre que `register()` resuelve y `watchForUpdate` engancha su oyente, el
    // navegador puede haber disparado ya `updatefound`. Ese evento NO se vuelve
    // a emitir: sin mirar `registration.installing` en el momento de enganchar,
    // la actualización se instalaba y nadie avisaba. Es una carrera estrecha y
    // explica exactamente el síntoma de quedarse en la versión vieja.
    const fuente = readFileSync(new URL('../src/ui/pwa.js', import.meta.url), 'utf8');
    const cuerpo = fuente.slice(fuente.indexOf('function watchForUpdate'));
    const hasta = cuerpo.slice(0, cuerpo.indexOf('\nexport'));
    assert.match(hasta, /if \(registration\.installing\)/,
        'watchForUpdate no mira `installing` al enganchar: la carrera sigue abierta');
    assert.match(hasta, /registration\.waiting/, 'ya no se mira `waiting`');
});

test('una instalación descartada NO se traga: `redundant` se registra', () => {
    // `addAll` es todo-o-nada y basta una petición mala para descartar la
    // actualización entera. Eso era un `console.error` DENTRO del service
    // worker, o sea invisible, y quien lo sufría se quedaba en la versión vieja
    // sin enterarse y sin nada que reintentar.
    const fuente = readFileSync(new URL('../src/ui/pwa.js', import.meta.url), 'utf8');
    assert.match(fuente, /state === 'redundant'/, 'no se detecta una instalación descartada');
    assert.match(fuente, /installFailed = true/, 'detectarla no cambia nada');
});

test('se puede saber qué versión se ejecuta y cuál hay publicada', () => {
    // Sin esto, «sigo viendo la versión vieja» no se puede ni confirmar ni
    // desmentir: ni el usuario puede comprobarlo ni nadie puede pedírselo.
    const fuente = readFileSync(new URL('../src/ui/pwa.js', import.meta.url), 'utf8');
    for (const nombre of ['runningVersion', 'publishedVersion', 'checkForUpdate']) {
        assert.ok(fuente.includes(`export async function ${nombre}(`),
            `pwa.js ya no exporta ${nombre}`);
    }
    // La publicada se lee SALTÁNDOSE la caché: preguntarle a la caché del
    // navegador qué hay publicado es preguntarle justo al problema.
    assert.match(fuente, /fetch\('sw\.js', \{ cache: 'reload' \}\)/,
        'la versión publicada se lee de la caché, que es lo que puede estar viejo');
});

test('Ajustes enseña la versión y ofrece buscar actualización', () => {
    const settings = readFileSync(new URL('../src/ui/views/settings.js', import.meta.url), 'utf8');
    assert.match(settings, /data-version-running/, 'no se enseña la versión en marcha');
    assert.match(settings, /data-version-check/, 'no hay botón para buscar actualización');

    // Y cada resultado tiene su texto: un botón que no dice nada deja a alguien
    // sin saber si funcionó, que es el estado del que se venía.
    const es = readFileSync(new URL('../src/i18n/es.js', import.meta.url), 'utf8');
    for (const clave of ['settings.version.running', 'settings.version.check',
        'settings.version.found', 'settings.version.uptodate', 'settings.version.failed']) {
        assert.ok(es.includes(`'${clave}'`), `falta el texto ${clave}`);
    }
});

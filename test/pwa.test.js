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
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/** @param {string} dir @param {string[]} extensions */
function filesUnder(dir, extensions) {
    /** @type {string[]} */ const out = [];
    const walk = (current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
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

/** Extrae el array PRECACHE del fuente del service worker. */
function precacheList() {
    const match = swSource.match(/const PRECACHE = \[([\s\S]*?)\];/);
    assert.ok(match, 'sw.js debe declarar `const PRECACHE = [...]`');
    return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

test('PRECACHE incluye todos los módulos de src/ (si falta uno, no abre offline)', () => {
    const modules = filesUnder('src', ['.js', '.json']);
    const cached = new Set(precacheList());
    const missing = modules.filter((file) => !cached.has(file));
    assert.deepEqual(missing, [], `módulos fuera de PRECACHE: ${missing.join(', ')}`);
});

test('PRECACHE incluye el CSS, el vendor y los iconos del manifiesto', () => {
    const cached = new Set(precacheList());
    for (const file of ['css/tokens.css', 'css/app.css', 'vendor/chart.umd.min.js', 'index.html', 'manifest.webmanifest']) {
        assert.ok(cached.has(file), `falta ${file} en PRECACHE`);
    }
    const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
    for (const icon of manifest.icons) {
        assert.ok(cached.has(icon.src), `falta el icono ${icon.src} en PRECACHE`);
    }
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

// @ts-check

/**
 * Vigilancia estática de la seguridad de render y de la CSP (M6-3).
 *
 * El vector real de este producto es el import de backups y el multiperfil:
 * texto que escribió alguien y que acaba en el DOM. La defensa está en
 * `src/ui/dom.js`, pero solo funciona si NADIE se la salta. Estos tests
 * fallan en cuanto alguien lo intenta, aunque el resultado se vea bien.
 *
 * No sustituyen a la CSP: la duplican. Si una de las dos capas cede, la otra
 * sigue en pie.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

/**
 * Quita comentarios antes de escanear.
 *
 * Sin esto, estos mismos tests fallan por los comentarios que explican las
 * reglas: `rng.js` documenta que `Math.random` está prohibido y `photos-db.js`
 * explica por qué no usa localStorage. Un vigilante que se dispara con su
 * propia documentación se acaba desactivando, que es peor que no tenerlo.
 *
 * `//` no cuenta como comentario si va precedido de `:` (una URL en una
 * cadena). En el peor caso esto oculta código tras una URL en la misma línea:
 * puede haber falsos negativos, nunca falsos positivos.
 * @param {string} source
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** @returns {Array<{ path: string, source: string }>} */
function sourceFiles() {
    /** @type {Array<{ path: string, source: string }>} */ const out = [];
    const walk = (/** @type {string} */ dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) {
                out.push({ path: relative(ROOT, full), source: stripComments(readFileSync(full, 'utf8')) });
            }
        }
    };
    walk(join(ROOT, 'src'));
    return out;
}

const FILES = sourceFiles();
const HEADERS = readFileSync(join(ROOT, '_headers'), 'utf8');
const CSP = (HEADERS.match(/Content-Security-Policy:\s*(.+)/) ?? [])[1] ?? '';

test('ningún manejador inline en src/ (los prohíbe la CSP y el sentido común)', () => {
    // `onclick=`, `onerror=`, `onload=`… dentro de cadenas HTML. El legacy los
    // usaba a manos llenas; con `script-src 'self'` no ejecutarían siquiera.
    const offenders = [];
    for (const file of FILES) {
        const matches = [...file.source.matchAll(/\bon[a-z]+\s*=\s*["'][^"']*\$\{/g)];
        if (matches.length > 0) offenders.push(`${file.path}: ${matches[0][0]}`);
    }
    assert.deepEqual(offenders, []);
});

test('nadie escribe innerHTML fuera de src/ui/dom.js', () => {
    // `render()` es el único punto donde el HTML entra al documento, y ahí ya
    // pasó por `html``. Un innerHTML suelto se salta el escapado entero.
    const offenders = FILES
        .filter((f) => f.path !== 'src/ui/dom.js')
        .filter((f) => /\.innerHTML\s*=/.test(f.source))
        .map((f) => f.path);
    assert.deepEqual(offenders, []);
});

test('nadie usa el atributo style= con interpolación (lo prohíbe style-src)', () => {
    // La CSP no lleva `unsafe-inline` en style-src, así que un style="" con
    // datos no se aplicaría: la barra de progreso se quedaría a cero y nadie
    // se enteraría hasta producción. Los valores van por `applyCssVars`.
    const offenders = [];
    for (const file of FILES) {
        const matches = [...file.source.matchAll(/style\s*=\s*["'][^"']*\$\{/g)];
        if (matches.length > 0) offenders.push(`${file.path}: ${matches[0][0]}`);
    }
    assert.deepEqual(offenders, []);
});

test('nadie toca localStorage fuera de src/data/storage.js', () => {
    const offenders = FILES
        .filter((f) => f.path !== 'src/data/storage.js')
        .filter((f) => /\blocalStorage\s*\./.test(f.source))
        .map((f) => f.path);
    assert.deepEqual(offenders, []);
});

test('nadie usa Math.random en src/ (el motor es determinista)', () => {
    const offenders = FILES
        .filter((f) => /Math\.random/.test(f.source))
        .map((f) => f.path);
    assert.deepEqual(offenders, []);
});

test('`raw()` solo se usa con HTML propio, nunca con una interpolación', () => {
    // `raw()` es la única salida del escapado. Si alguien le pasa una
    // plantilla con `${}`, ahí se acabó la defensa.
    const offenders = [];
    for (const file of FILES) {
        if (file.path === 'src/ui/dom.js') continue;
        const matches = [...file.source.matchAll(/\braw\(\s*`[^`]*\$\{/g)];
        if (matches.length > 0) offenders.push(`${file.path}: ${matches[0][0]}`);
    }
    assert.deepEqual(offenders, []);
});

test('la CSP no admite unsafe-inline ni unsafe-eval en ninguna directiva', () => {
    assert.ok(CSP !== '', '_headers debe declarar Content-Security-Policy');
    assert.ok(!CSP.includes('unsafe-inline'), `unsafe-inline en la CSP: ${CSP}`);
    assert.ok(!CSP.includes('unsafe-eval'), `unsafe-eval en la CSP: ${CSP}`);
});

test('la CSP cierra por defecto y no deja escapar nada al exterior', () => {
    for (const directive of [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'",
        "form-action 'none'"
    ]) {
        assert.ok(CSP.includes(directive), `falta «${directive}» en la CSP`);
    }
    // Las fotos vienen de IndexedDB (blob:) y la tarjeta de un canvas (data:)
    assert.match(CSP, /img-src 'self' data: blob:/);
});

test('_headers trae nosniff y una Referrer-Policy que no filtra la ruta', () => {
    assert.match(HEADERS, /X-Content-Type-Options:\s*nosniff/);
    assert.match(HEADERS, /Referrer-Policy:\s*strict-origin-when-cross-origin/);
});

test('index.html no carga nada de un origen ajeno', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const remote = [...html.matchAll(/(?:src|href)="(https?:)?\/\/[^"]+"/g)].map((m) => m[0]);
    assert.deepEqual(remote, [], `recursos remotos en index.html: ${remote.join(', ')}`);
    // Y ningún <script> ni <style> con cuerpo inline: la CSP los rechazaría
    assert.ok(!/<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(html), 'hay un <script> inline');
    assert.ok(!/<style[^>]*>/.test(html), 'hay un <style> inline');
});

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
import { isICloudDuplicate } from './helpers/tree.js';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Quita comentarios antes de escanear.
 *
 * Sin esto, estos mismos tests fallan por los comentarios que explican las
 * reglas: `rng.js` documenta que `Math.random` está prohibido y `photos-db.js`
 * explica por qué no usa localStorage. Un vigilante que se dispara con su
 * propia documentación se acaba desactivando, que es peor que no tenerlo.
 *
 * RECORRE EL FUENTE, no lo pasa por un regex, y la diferencia no es teórica.
 * La versión anterior emparejaba `/*` con el siguiente `*​/` sin mirar si
 * estaban dentro de una cadena, y `photos.js` tiene un
 * `accept="image/*"`: ese `/*` abría un comentario falso que se tragaba
 * **3 358 bytes** —un tercio del fichero, con sus `<img src="${…}">` dentro—
 * y los dejaba invisibles para TODOS los tests de seguridad de aquí. Lo
 * destapó el guardián de imports muertos de M7, que daba falsos positivos en
 * ese fichero y solo en ese.
 * @param {string} source
 */
function stripComments(source) {
    let out = '';
    let i = 0;
    /** @type {null | "'" | '"' | '`' | 'line' | 'block'} */ let mode = null;
    while (i < source.length) {
        const ch = source[i];
        const next = source[i + 1];
        if (mode === null) {
            if (ch === '/' && next === '*') { mode = 'block'; i += 2; continue; }
            if (ch === '/' && next === '/') { mode = 'line'; i += 2; continue; }
            if (ch === "'" || ch === '"' || ch === '`') { mode = /** @type {*} */ (ch); }
            out += ch; i += 1; continue;
        }
        if (mode === 'block') {
            if (ch === '*' && next === '/') { mode = null; out += ' '; i += 2; continue; }
            if (ch === '\n') out += '\n';   // se conservan las líneas: los mensajes citan número
            i += 1; continue;
        }
        if (mode === 'line') {
            if (ch === '\n') { mode = null; out += '\n'; }
            i += 1; continue;
        }
        // dentro de una cadena: se copia tal cual, incluidos los escapes
        if (ch === '\\') { out += ch + (next ?? ''); i += 2; continue; }
        if (ch === mode) mode = null;
        out += ch; i += 1;
    }
    return out;
}

/** @returns {Array<{ path: string, source: string }>} */
function sourceFiles() {
    /** @type {Array<{ path: string, source: string }>} */ const out = [];
    const walk = (/** @type {string} */ dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (isICloudDuplicate(entry.name)) continue;  // duplicado de iCloud, no fuente
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

test('_headers manda revalidar SIEMPRE: nada se cachea por tiempo', () => {
    // Medido en producción: Cloudflare Pages sirve `max-age=14400` por defecto,
    // y con eso el navegador ejecutaba `i18n.js` y `format.js` viejos mientras
    // servía `es.js` nuevo — una MEZCLA de dos versiones, que es el peor fallo
    // posible. Aquí ningún fichero lleva huella en el nombre, así que cachear
    // por tiempo es siempre incorrecto.
    const global = HEADERS.split('\n/sw.js')[0];
    assert.match(global, /Cache-Control:\s*no-cache/,
        'la regla global debe mandar revalidar');

    // Y que a nadie se le ocurra volver a poner un max-age largo. Se miran solo
    // las DIRECTIVAS: los comentarios de este mismo fichero citan el 14400 que
    // motivó el arreglo, y contarlos haría que el test se delatara a sí mismo.
    const directivas = HEADERS.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    const maxAges = [...directivas.matchAll(/max-age=(\d+)/g)].map((m) => Number(m[1]));
    for (const edad of maxAges) {
        assert.ok(edad === 0, `hay un max-age de ${edad} s en _headers`);
    }
});

test('_headers no lleva comentarios DENTRO de una regla', () => {
    // Cloudflare no documenta que los admita, y un `_headers` mal parseado
    // tumbaría la CSP entera: un riesgo desproporcionado para colocar una
    // explicación que cabe encima del bloque.
    for (const linea of HEADERS.split('\n')) {
        if (/^\s+/.test(linea) && linea.trim().startsWith('#')) {
            assert.fail(`comentario dentro de una regla: ${linea.trim()}`);
        }
    }
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

/* ---------------------------------------------------------------------- *
 * Higiene: imports que ya no usa nadie (M7, ataque adversarial)
 * ---------------------------------------------------------------------- */

test('ningún módulo importa algo que ya no usa', () => {
    // El barrido de código muerto de M7-8 CREÓ imports muertos: al borrar
    // `todayTolerance` quedó su `toleranceAt`, al borrar el re-export de
    // `estimatedOneRepMax` quedó el suyo, y al mover el modal del hito a
    // `plan-chart.js` quedaron dos `import * as modal`. `tsc` no los ve
    // (`noUnusedLocals` está apagado a propósito, porque marcaría también los
    // parámetros de las firmas JSDoc), así que la vigilancia va aquí.
    /** @type {string[]} */ const offenders = [];
    for (const { path, source } of FILES) {
        // Se quitan las SENTENCIAS import, no las líneas que empiezan por
        // «import»: `stripComments` colapsa los bloques JSDoc y deja código
        // pegado a la línea de al lado, así que filtrar por prefijo se comía
        // usos reales y daba falsos positivos.
        const cuerpo = source.replace(/import\s+(?:\* as \w+|\{[^}]*\}|\w+)\s+from\s+['"][^'"]+['"];?/g, '');
        for (const m of source.matchAll(/import\s+(?:\* as (\w+)|\{([^}]+)\})\s+from/g)) {
            const nombres = m[1]
                ? [m[1]]
                : m[2].split(',').map((n) => n.trim().split(/\s+as\s+/).pop() ?? '');
            for (const nombre of nombres.filter(Boolean)) {
                if (!new RegExp(`\\b${nombre}\\b`).test(cuerpo)) offenders.push(`${path} → ${nombre}`);
            }
        }
    }
    assert.deepEqual(offenders, [], `imports sin usar:\n  ${offenders.join('\n  ')}`);
});

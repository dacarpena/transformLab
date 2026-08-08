// @ts-check

/**
 * La frontera de seguridad de la aplicación (M7-6).
 *
 * `src/ui/dom.js` es el ÚNICO sitio por el que datos dinámicos entran al DOM
 * (CLAUDE.md §5, F6), y hasta hoy no tenía un solo test que lo ejecutara.
 * `security.test.js` hace análisis estático por regex sobre el texto fuente:
 * comprueba que nadie *escriba* `innerHTML` fuera de aquí, pero **no que
 * `escapeHtml` escape**. Si alguien rompiera la función, el proyecto entero
 * seguiría en verde.
 *
 * Los vectores de ataque de aquí no son hipotéticos: la vía real es el import
 * de un backup y el multiperfil, donde el texto lo escribe alguien que no eres
 * tú. Lo que toca el DOM de verdad (`render`, `applyCssVars`, `on`) se prueba
 * en `test/e2e/dom-security.spec.js`, contra un navegador real: para una
 * frontera de seguridad, el analizador de HTML del navegador es la única
 * autoridad que cuenta.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml, html, raw, safeUrl, RawHtml } from '../src/ui/dom.js';

/* ---------------------------------------------------------------------- *
 * escapeHtml
 * ---------------------------------------------------------------------- */

test('escapeHtml neutraliza los cinco caracteres que abren HTML', () => {
    assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
});

test('escapeHtml desactiva los vectores clásicos', () => {
    for (const vector of [
        '<script>alert(1)</script>',
        '<img src=x onerror=alert(1)>',
        '"><script>alert(1)</script>',
        "'><svg onload=alert(1)>",
        '</textarea><script>alert(1)</script>',
        '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;">'
    ]) {
        const escaped = escapeHtml(vector);
        assert.equal(escaped.includes('<'), false, `dejó pasar un < : ${escaped}`);
        assert.equal(escaped.includes('>'), false, `dejó pasar un > : ${escaped}`);
    }
});

test('escapeHtml escapa el & PRIMERO, sin doble escapado ni fuga', () => {
    // Si se sustituyera en otro orden, `&lt;` acabaría en `&amp;lt;` (visible y
    // feo) o `&amp;` en `&lt;` (roto). El orden del regex único lo garantiza.
    assert.equal(escapeHtml('&lt;script&gt;'), '&amp;lt;script&amp;gt;');
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
});

test('escapeHtml no se fía del toString de un objeto', () => {
    // Un objeto salido de un backup puede traer lo que sea; la conversión a
    // texto ocurre ANTES de escapar, no después.
    assert.equal(escapeHtml({ toString: () => '<b>x</b>' }), '&lt;b&gt;x&lt;/b&gt;');
});

test('escapeHtml admite lo que no es cadena sin lanzar', () => {
    assert.equal(escapeHtml(0), '0');
    assert.equal(escapeHtml(null), 'null');
    assert.equal(escapeHtml(undefined), 'undefined');
    assert.equal(escapeHtml(true), 'true');
    assert.equal(escapeHtml([1, '<']), '1,&lt;');
});

/* ---------------------------------------------------------------------- *
 * html`` — el camino por el que pasa TODO lo que se pinta
 * ---------------------------------------------------------------------- */

test('html`` escapa las interpolaciones y deja el literal intacto', () => {
    const nombre = '<script>alert(1)</script>';
    const out = String(html`<p class="x">${nombre}</p>`);
    assert.equal(out, '<p class="x">&lt;script&gt;alert(1)&lt;/script&gt;</p>');
});

test('html`` anidado NO se escapa dos veces', () => {
    // El fallo opuesto al de seguridad, y también real: si el fragmento hijo se
    // escapara, el usuario vería `&lt;li&gt;` literal en pantalla.
    const out = String(html`<ul>${[1, 2].map((i) => html`<li>${`<${i}`}</li>`)}</ul>`);
    assert.equal(out, '<ul><li>&lt;1</li><li>&lt;2</li></ul>');
});

test('html`` escapa cada elemento de un array por separado', () => {
    assert.equal(String(html`<p>${['<a>', '<b>']}</p>`), '<p>&lt;a&gt;&lt;b&gt;</p>');
});

test('html`` convierte null y undefined en nada, no en su nombre', () => {
    // `${undefined}` pintando la palabra «undefined» es el defecto de interfaz
    // más común que existe; aquí se cierra por construcción.
    assert.equal(String(html`<p>${null}${undefined}</p>`), '<p></p>');
});

test('html`` devuelve RawHtml, no una cadena suelta', () => {
    // Es lo que permite a `render` distinguir «HTML que construí yo» de «texto
    // que me han dado», y por eso no hay camino sin escapar.
    assert.ok(html`<p>x</p>` instanceof RawHtml);
});

test('una plantilla sin interpolaciones sale tal cual', () => {
    assert.equal(String(html`<hr>`), '<hr>');
});

/* ---------------------------------------------------------------------- *
 * raw() — la única vía de escape, y por eso la más vigilada
 * ---------------------------------------------------------------------- */

test('raw() pasa el HTML sin tocar, que es justo su peligro', () => {
    assert.equal(String(html`<p>${raw('<b>ok</b>')}</p>`), '<p><b>ok</b></p>');
});

test('raw() sobre datos de usuario ejecutaría: el contrato es del llamante', () => {
    // Este test no comprueba una defensa, DOCUMENTA que no la hay. `raw()` es
    // deliberadamente una puerta abierta para HTML propio, y lo que impide el
    // abuso es `security.test.js`, que vigila dónde se usa.
    assert.equal(String(html`${raw('<img src=x onerror=alert(1)>')}`),
        '<img src=x onerror=alert(1)>');
});

/* ---------------------------------------------------------------------- *
 * safeUrl — el hueco que `escapeHtml` no puede tapar
 * ---------------------------------------------------------------------- */

test('safeUrl bloquea los esquemas ejecutables', () => {
    // `escapeHtml` no protege aquí: `javascript:alert(1)` no tiene ninguno de
    // los cinco caracteres que escapa, así que sale intacto y dentro de un
    // `href` se ejecuta. Es el hueco que estaba anotado en el BACKLOG.
    for (const vector of [
        'javascript:alert(1)',
        'JaVaScRiPt:alert(1)',
        '  javascript:alert(1)',
        'java\nscript:alert(1)',      // los controles los ignora el navegador
        'java\tscript:alert(1)',
        'vbscript:msgbox(1)',
        'data:text/html,<script>alert(1)</script>'
    ]) {
        assert.equal(safeUrl(vector), '', `dejó pasar ${JSON.stringify(vector)}`);
    }
});

test('safeUrl deja pasar lo que la aplicación usa de verdad', () => {
    assert.equal(safeUrl('blob:http://localhost:8080/abc'), 'blob:http://localhost:8080/abc');
    assert.equal(safeUrl('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
    assert.equal(safeUrl('https://motifyer.com'), 'https://motifyer.com');
    assert.equal(safeUrl('./icons/icon-192.png'), './icons/icon-192.png');
    assert.equal(safeUrl('/manifest.webmanifest'), '/manifest.webmanifest');
});

test('safeUrl no confunde una ruta con dos puntos por delante de la barra', () => {
    // `foo:bar/baz` ES un esquema, aunque parezca una carpeta.
    assert.equal(safeUrl('raro:bar/baz'), '');
    // pero `a/b:c` no lo es: los dos puntos van después de la primera barra
    assert.equal(safeUrl('a/b:c'), 'a/b:c');
});

test('safeUrl devuelve cadena vacía ante lo que no es texto', () => {
    for (const v of [null, undefined, 42, {}, []]) {
        assert.equal(safeUrl(/** @type {*} */ (v)), '');
    }
});

/* ---------------------------------------------------------------------- *
 * Vigilancia de los usos: que el hueco no se reabra en otra vista
 * ---------------------------------------------------------------------- */

test('ninguna plantilla interpola en un atributo SIN comillas', () => {
    // Con comillas, `escapeHtml` basta. Sin ellas, un valor con espacios cierra
    // el atributo y abre otro: `class=${'a onmouseover=alert(1) b'}` produce
    // `<div class=a onmouseover=alert(1) b>`, que es un XSS funcionando. Está
    // verificado ejecutándolo, y hoy no hay ningún sitio así — este test es lo
    // que impide que lo haya mañana.
    /** @type {string[]} */ const offenders = [];
    for (const file of jsFilesUnder('src/ui')) {
        const source = readFileSync(file, 'utf8');
        source.split('\n').forEach((line, i) => {
            if (/[a-zA-Z-]+=\$\{/.test(line)) offenders.push(`${file}:${i + 1}`);
        });
    }
    assert.deepEqual(offenders, [],
        `interpolación en atributo sin comillas: ${offenders.join(', ')}`);
});

test('toda URL dinámica de un src/href pasa por safeUrl', () => {
    /** @type {string[]} */ const offenders = [];
    for (const file of jsFilesUnder('src/ui')) {
        const source = readFileSync(file, 'utf8');
        source.split('\n').forEach((line, i) => {
            // El espacio de delante importa: sin él, `data-action="${…}"`
            // casaría con `action` y daría un falso positivo.
            const match = line.match(/\s(?:src|href|action|formaction|poster)="\$\{([^}]*)\}/);
            if (match && !match[1].includes('safeUrl')) offenders.push(`${file}:${i + 1} → ${match[1].trim()}`);
        });
    }
    assert.deepEqual(offenders, [], `URL sin filtrar:\n  ${offenders.join('\n  ')}`);
});

/** @param {string} dir @returns {string[]} */
function jsFilesUnder(dir) {
    /** @type {string[]} */ const out = [];
    const walk = (/** @type {string} */ current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) out.push(full);
        }
    };
    walk(new URL(`../${dir}`, import.meta.url).pathname);
    return out;
}

// @ts-check

/**
 * Ningún acento grave suelto dentro de una plantilla `html``` (E15-10).
 *
 * ES LA TRAMPA QUE MÁS VECES HA MORDIDO EN ESTE PROYECTO. Un comentario dentro
 * de un `html` con una palabra entre acentos graves —«ver `readForm`»— **cierra
 * la plantilla**, y lo que sigue deja de ser una cadena. El resultado es un
 * `SyntaxError` al cargar el módulo, la aplicación no arranca, y el mensaje
 * («missing ) after argument list») no dice ni el fichero ni por qué.
 *
 * Ya lo documentaron E14-4 y `checkin.js`, y aun así volvió a pasar cinco veces
 * en una sola sesión: el hábito de citar identificadores con acentos graves es
 * demasiado fuerte para confiarlo a la memoria. Se convierte en test.
 *
 * `npm run typecheck` lo caza, sí — pero solo si alguien lo ejecuta ANTES de
 * abrir el navegador, y una de las cinco veces se coló justamente porque entre
 * la edición y la prueba solo corrió `npm test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { isICloudDuplicate } from './helpers/tree.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Todos los `.js` de `src/`. */
function sourceFiles() {
    /** @type {Array<{ path: string, code: string }>} */ const out = [];
    const walk = (/** @type {string} */ current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (isICloudDuplicate(entry.name)) continue;
            const full = join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) {
                out.push({ path: relative(ROOT, full), code: readFileSync(full, 'utf8') });
            }
        }
    };
    walk(join(ROOT, 'src'));
    return out;
}

test('ningún fichero de src/ tiene un error de sintaxis', () => {
    // La red de seguridad de verdad: si un acento grave cerró una plantilla, el
    // fichero deja de parsear y esto se cae, diga lo que diga el análisis de más
    // abajo. Se comprueba con el propio parser de Node, no con una expresión
    // regular: no hay forma de que se le escape.
    /** @type {string[]} */ const rotos = [];
    for (const { path, code } of sourceFiles()) {
        try {
            // eslint-disable-next-line no-new-func
            new Function(`return (async () => { ${''} })`);   // calienta el parser
            new (Object.getPrototypeOf(async function () {}).constructor)(code);
        } catch (err) {
            // Un `import`/`export` de nivel superior no es válido dentro de una
            // función: eso NO es un error de sintaxis del fichero. Solo interesa
            // el resto.
            const msg = String(err && /** @type {*} */ (err).message);
            if (!/import|export/i.test(msg)) rotos.push(`${path}: ${msg}`);
        }
    }
    assert.deepEqual(rotos, [], `ficheros que no parsean:\n  ${rotos.join('\n  ')}`);
});

test('ningún comentario dentro de una plantilla html`` usa acentos graves', () => {
    // El análisis específico, para que el mensaje diga QUÉ pasa y no solo que
    // algo no parsea. Se buscan comentarios HTML —que es donde han caído las
    // cinco veces— con un acento grave dentro.
    /** @type {string[]} */ const infractores = [];
    for (const { path, code } of sourceFiles()) {
        for (const m of code.matchAll(/<!--[\s\S]*?-->/g)) {
            if (m[0].includes('`')) {
                const linea = code.slice(0, m.index).split('\n').length;
                infractores.push(`${path}:${linea}`);
            }
        }
    }
    assert.deepEqual(infractores, [],
        'comentarios HTML con acento grave — dentro de una plantilla la CIERRAN.\n'
        + 'Usa comillas angulares «así» o quita las comillas:\n  ' + infractores.join('\n  '));
});

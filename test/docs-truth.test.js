// @ts-check

/**
 * La documentación no puede mentir sobre cifras que el árbol conoce (E15-7).
 *
 * `CLAUDE.md` §7 obliga a leer el plan al abrir sesión, así que lo que ahí ponga
 * es lo que la siguiente sesión da por cierto. Cuando se escribió este test, el
 * plan mandaba **rehacer dos cosas que ya estaban hechas** —convertir `chart.js`
 * en factoría (V2-M8) y arreglar la recalibración sin báscula (V2-M9)— y callaba
 * dos que faltaban. El README hablaba de 453 tests cuando había 860, de un
 * precache de 64 entradas cuando eran 102, y de «las once vistas» cuando son
 * dieciséis. `ESTADO.md` decía «el proyecto acaba de nacer · cabos sueltos:
 * ninguno» sobre 27 000 líneas desplegadas en producción.
 *
 * La regla que sale de ahí: **una cifra que el árbol conoce, o se deriva o no se
 * escribe.** Este test impone las dos mitades.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { VIEWS } from '../src/ui/views/_manifest.js';
import { SCHEMA_VERSION, rootPrefix } from '../src/data/version.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const leer = (/** @type {string} */ f) => readFileSync(join(ROOT, f), 'utf8');

const README = leer('README.md');
const CLAUDE = leer('CLAUDE.md');

/** Las entradas de PRECACHE, contadas sobre el fuente real de `sw.js`. */
function precacheList() {
    const sw = leer('sw.js');
    const m = sw.match(/const PRECACHE = \[([\s\S]*?)\];/);
    assert.ok(m, 'sw.js debe declarar `const PRECACHE = [...]`');
    const cuerpo = m[1]
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    return [...cuerpo.matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

test('el README NO copia el tamaño del precache: cambia con cada módulo nuevo', () => {
    // Decía «64 entradas» cuando había 102, y volvió a desviarse en cuanto E15-9
    // añadió un módulo — este test lo cazó, que era su trabajo. Pero la cifra no
    // le dice nada a nadie y su único destino es volver a mentir: se quita, igual
    // que el número de tests. Lo que sí se comprueba es que el precache existe y
    // no está vacío, que es lo que el README promete.
    assert.equal(README.match(/precache de \d+ entradas/), null,
        'el README no debe llevar un número duro de entradas de precache');
    assert.match(README, /precache/i, 'el README debe seguir explicando que hay precache');
    assert.ok(precacheList().length > 50, 'el precache no puede estar vacío');
});

test('el README dice el número real de vistas', () => {
    const PALABRAS = ['cero', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho',
        'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete',
        'dieciocho', 'diecinueve', 'veinte'];
    const declarado = README.match(/router, componentes y las (\S+) vistas/);
    assert.ok(declarado, 'el README debe decir cuántas vistas hay');
    assert.equal(declarado[1], PALABRAS[VIEWS.length],
        `el README dice «${declarado[1]} vistas» y _manifest.js declara ${VIEWS.length}`);
});

test('el README NO copia el número de tests: esa cifra solo puede desviarse', () => {
    // Iba a 453 unitarios y 82 E2E cuando había 860 y 210. Una cifra que cambia
    // en cada commit no se documenta: se ejecuta.
    const sospechosas = [
        /(\d+)\s+tests unitarios/,
        /(\d+)\s+tests Playwright/,
        /\*\*(\d+)\*\*\s+unitarios/
    ].map((re) => README.match(re)).filter(Boolean);
    assert.deepEqual(sospechosas.map((m) => m?.[0]), [],
        'el README no debe llevar un número duro de tests');
});

test('ningún documento de la raíz codifica una versión de esquema vieja', () => {
    // `CLAUDE.md` documentaba `tl.5.*` con el código en `tl.6.*`, así que quien
    // leyera el fichero al arrancar sesión buscaría claves que no existen.
    const viejas = [];
    for (let v = 1; v < SCHEMA_VERSION; v++) {
        for (const [nombre, texto] of [['CLAUDE.md', CLAUDE], ['README.md', README]]) {
            if (texto.includes(`tl.${v}.`)) viejas.push(`${nombre} menciona tl.${v}.`);
        }
    }
    assert.deepEqual(viejas, [], viejas.join(' · '));
    // Y el prefijo vigente sale de `version.js`, que es su fuente única.
    assert.equal(rootPrefix(), `tl.${SCHEMA_VERSION}.`);
});

test('ESTADO.md describe el proyecto que hay, no uno que acaba de nacer', () => {
    // Lo lee otro sistema. Decía «etapa: chispa · el proyecto acaba de nacer ·
    // cabos sueltos: ninguno» sobre un producto desplegado.
    const estado = leer('ESTADO.md');
    assert.ok(!/acaba de nacer|etapa:\s*chispa/i.test(estado),
        'ESTADO.md sigue diciendo que el proyecto acaba de nacer');
    assert.ok(!/cabos sueltos:\s*ninguno/i.test(estado),
        'ESTADO.md afirma que no hay cabos sueltos, y los hay');
    assert.match(estado, /motifyer\.com/, 'ESTADO.md debe decir dónde está desplegado');
});

test('el BACKLOG no manda rehacer lo que ya está hecho', () => {
    const plan = leer('PLAN-V5.md');
    const i = plan.indexOf('## BACKLOG');
    assert.ok(i > -1, 'PLAN-V5.md debe tener su sección BACKLOG');
    const backlog = plan.slice(i, plan.indexOf('## Bitácora general', i));

    // Las dos entradas rancias que costaron este test. Si vuelven a aparecer sin
    // tachar, alguien va a rehacer ~600 líneas ya escritas.
    for (const [marca, donde] of [
        ['`chart.js` es un SINGLETON', 'V2-M8'],
        ['Recalibrar tira el músculo proyectado', 'V2-M9']
    ]) {
        const linea = backlog.split('\n').find((l) => l.includes(marca));
        assert.ok(linea, `falta la entrada de BACKLOG sobre «${marca}»`);
        assert.match(linea, /~~|HECHO/,
            `la entrada «${marca}» sigue escrita como pendiente, y está hecha en ${donde}`);
    }
});

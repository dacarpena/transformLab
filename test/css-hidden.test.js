// @ts-check

/**
 * `hidden` tiene que ocultar (E15-1b).
 *
 * La hoja del navegador trae `[hidden] { display: none }`, pero es un selector
 * de atributo: cualquier regla de CLASE que fije `display` le gana. `app.css`
 * tiene 88 de ésas, y no tenía ninguna regla `[hidden]`.
 *
 * Consecuencia medida en un navegador real, en el selector de series de
 * Analizar con cero series elegidas: el aviso `.notice[data-picker-limit]` —con
 * el atributo `hidden` puesto de verdad en el DOM— se pintaba y decía «Ya
 * tienes 8 series. Quita una para añadir otra.» tres líneas encima de «0 de 8
 * series · Todavía no has elegido ninguna serie». La interfaz se contradecía a
 * sí misma dentro del mismo diálogo.
 *
 * El marcado ya lo hacía bien; era el CSS el que no cumplía su parte.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isICloudDuplicate } from './helpers/tree.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Sin comentarios: el que explica esta regla la cita literalmente, y un
// `match` ingenuo la encuentra ahí y da por buena una hoja que no la tiene.
const APP_CSS = readFileSync(join(ROOT, 'css/app.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

test('el CSS oculta de verdad lo que lleva el atributo hidden', () => {
    const regla = APP_CSS.match(/\[hidden\]\s*\{([^}]*)\}/);
    assert.ok(regla, 'falta la regla [hidden] en app.css');
    assert.match(regla[1], /display:\s*none/, '[hidden] debe poner display: none');
    // Sin `!important` la regla no sirve para nada: pierde contra cualquier
    // `.clase { display: flex }`, que es exactamente el estado del que venimos.
    assert.match(regla[1], /!important/,
        '[hidden] necesita !important: si no, pierde contra las reglas de clase');
});

test('el marcado que usa hidden sigue existiendo, para que la regla tenga sentido', () => {
    // Si un día nadie usara `hidden`, la regla sobraría. Mientras haya usuarios,
    // este test explica por qué está.
    /** @type {string[]} */ const usuarios = [];
    const walk = (/** @type {string} */ current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (isICloudDuplicate(entry.name)) continue;
            const full = join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js') && /\bhidden\b(?=[\s>}])/.test(readFileSync(full, 'utf8'))) {
                usuarios.push(entry.name);
            }
        }
    };
    walk(join(ROOT, 'src/ui'));
    assert.ok(usuarios.length > 0, 'nadie usa el atributo hidden: la regla [hidden] sobraría');
});

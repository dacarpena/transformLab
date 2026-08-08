// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { es } from '../src/i18n/es.js';
import { en } from '../src/i18n/en.js';
import { t, hasKey, setLocale, getLocale, availableLocales } from '../src/i18n/i18n.js';

test('paridad de claves entre es y en (CLAUDE.md §5: misma clave en ambos, mismo commit)', () => {
    const esKeys = Object.keys(es).sort();
    const enKeys = Object.keys(en).sort();
    assert.deepEqual(enKeys, esKeys, 'los diccionarios es/en deben tener exactamente las mismas claves');
});

test('ningún diccionario tiene valores vacíos', () => {
    for (const [name, dict] of [['es', es], ['en', en]]) {
        for (const [key, value] of Object.entries(dict)) {
            assert.ok(typeof value === 'string' && value.trim() !== '', `${name}.${key} está vacío`);
        }
    }
});

test('t() traduce en el idioma activo y cambia con setLocale', () => {
    setLocale('es');
    assert.equal(t('nav.today'), 'Hoy');
    setLocale('en');
    assert.equal(t('nav.today'), 'Today');
    setLocale('es');
});

test('t() interpola parámetros y deja intactos los placeholders sin dato', () => {
    setLocale('es');
    assert.equal(t('today.progress', { percent: 26 }), '26 % completado');
    assert.equal(t('today.progress'), '{percent} % completado');
});

test('la interpolación no ejecuta ni expande HTML: el valor va como texto', () => {
    setLocale('es');
    const out = t('today.progress', { percent: '<img src=x onerror=alert(1)>' });
    assert.equal(out, '<img src=x onerror=alert(1)> % completado');
    // El escapado ocurre en la capa de render (dom.js), no aquí: t() nunca genera HTML.
});

test('clave ausente devuelve la propia clave sin lanzar', () => {
    setLocale('es');
    assert.equal(t('no.existe'), 'no.existe');
});

test('setLocale rechaza idiomas no soportados manteniendo el activo', () => {
    setLocale('es');
    assert.equal(setLocale('fr'), false);
    assert.equal(getLocale(), 'es');
});

test('availableLocales expone es y en', () => {
    assert.deepEqual(availableLocales().sort(), ['en', 'es']);
});

/* ---------------------------------------------------------------------- *
 * Cobertura de los codes de aviso/error del motor (defecto preexistente
 * hallado al ejecutar los E2E de la v2: `today.plan.target.muscleLoss`).
 * ---------------------------------------------------------------------- */

import { readFileSync, readdirSync } from 'node:fs';
import { isICloudDuplicate } from './helpers/tree.js';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import * as plans from '../src/ui/plan-state.js';

const CORE_DIR = fileURLToPath(new URL('../src/core', import.meta.url));

/** Todos los `code: '...'` que emite el motor (avisos Y errores). */
function coreIssueCodes() {
    /** @type {Set<string>} */ const codes = new Set();
    const walk = (/** @type {string} */ dir) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (isICloudDuplicate(entry.name)) continue;  // duplicado de iCloud, no fuente
            const full = join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith('.js')) {
                for (const m of readFileSync(full, 'utf8').matchAll(/code:\s*'([^']+)'/g)) codes.add(m[1]);
            }
        }
    };
    walk(CORE_DIR);
    return [...codes].sort();
}

test('hasKey distingue presente de ausente sin avisar', () => {
    setLocale('es');
    const original = console.warn;
    /** @type {string[]} */ const avisos = [];
    console.warn = (/** @type {string} */ m) => { avisos.push(String(m)); };
    try {
        assert.equal(hasKey('nav.today'), true);
        assert.equal(hasKey('esta.clave.no.existe.jamas'), false);
    } finally {
        console.warn = original;
    }
    assert.deepEqual(avisos, [], 'hasKey no debe avisar por consola');
});

test('todo code del motor tiene su clave ranges.* en es Y en en', () => {
    // Sin esto, `issueText` (que traduce vía `ranges.<code>`) cae a
    // `error.generic` y —antes del arreglo— avisaba por consola en cada
    // aparición. La cobertura completa es lo que mantiene la consola limpia.
    const codes = coreIssueCodes();
    assert.ok(codes.length > 0, 'no se encontró ningún code en src/core');
    const faltan = [];
    for (const code of codes) {
        const key = `ranges.${code}`;
        if (typeof es[key] !== 'string') faltan.push(`es → ${key}`);
        if (typeof en[key] !== 'string') faltan.push(`en → ${key}`);
    }
    assert.deepEqual(faltan, [], `codes del motor sin clave ranges.*:\n  ${faltan.join('\n  ')}`);
});

test('ningún code del motor produce una clave ausente al traducirse', () => {
    // Reproduce el defecto original: se traduce cada code por las dos vías que
    // usa la UI —la genérica de `issueText` y la amable `today.<code>` del
    // dashboard— capturando `console.warn`. Cero avisos.
    setLocale('es');
    const original = console.warn;
    /** @type {string[]} */ const avisos = [];
    console.warn = (/** @type {string} */ msg) => { avisos.push(String(msg)); };
    try {
        for (const code of coreIssueCodes()) {
            plans.issueText({ code });
            // la vía del dashboard: today.<code>, que debe resolverse por hasKey
            // sin llamar a t() cuando no existe (no debe avisar).
            hasKey(`today.${code}`) && t(`today.${code}`);
        }
    } finally {
        console.warn = original;
    }
    const ausentes = avisos.filter((m) => m.includes('clave ausente'));
    assert.deepEqual(ausentes, [], `traducir los codes del motor avisó de claves ausentes:\n  ${ausentes.join('\n  ')}`);
});

test('los parámetros numéricos se escriben en el idioma activo', () => {
    // Arreglar `ui/format.js` no bastaba: media docena de vistas pasaban el
    // número CRUDO como parámetro y `String()` lo escribía con punto en
    // español, saltándose el formateador. Aquí pasa TODO el texto visible de la
    // aplicación, así que es imposible saltárselo.
    setLocale('es');
    assert.equal(t('test.decimal', { v: 4.8 }), '4,8');
    setLocale('en');
    assert.equal(t('test.decimal', { v: 4.8 }), '4.8');
    setLocale('es');
});

test('no se inventan decimales que el número no traía', () => {
    // Para decimales FIJOS está `ui/format.js`, que es otra decisión y se toma
    // en la vista. Aquí solo se cambia el separador.
    setLocale('es');
    assert.equal(t('test.decimal', { v: 12 }), '12');
    assert.equal(t('test.decimal', { v: 2437 }), '2437');
    assert.equal(t('test.decimal', { v: 13000 }), '13.000');
});

test('un parámetro no numérico pasa tal cual', () => {
    setLocale('es');
    assert.equal(t('test.decimal', { v: 'mucho' }), 'mucho');
    assert.equal(t('test.decimal', { v: Number.NaN }), 'NaN');
});

// @ts-check

/**
 * La exportación a CSV (E13-6).
 *
 * El test que justifica el fichero es el de la inyección de fórmulas: un campo
 * que empieza por `=` se convierte en una FÓRMULA en cuanto alguien abre el
 * archivo. Hoy no viaja texto del usuario en el CSV, así que es una guarda
 * preventiva — y por eso necesita test: una guarda que nadie ejercita se borra
 * en el primer refactor por parecer código muerto.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { separator, escapeField, formatNumber, toCsv } from '../src/ui/csv.js';
import { setLocale } from '../src/i18n/i18n.js';

test.beforeEach(() => setLocale('es'));

test('el separador y los decimales siguen el idioma', () => {
    setLocale('es');
    assert.equal(separator(), ';', 'en español, punto y coma: la coma ya es el decimal');
    assert.equal(formatNumber(74.25, 1), '74,3');

    setLocale('en');
    assert.equal(separator(), ',');
    assert.equal(formatNumber(74.25, 1), '74.3');
});

test('los números NO llevan separador de millares', () => {
    // `Intl` escribiría «13.000» en español, y eso en una hoja de cálculo es
    // otro número —o dos columnas—. Solo cambia el separador DECIMAL.
    setLocale('es');
    assert.equal(formatNumber(13000, 0), '13000');
    assert.equal(formatNumber(2437.5, 1), '2437,5');

    setLocale('en');
    assert.equal(formatNumber(13000, 0), '13000');
});

test('un valor ausente es una celda VACÍA, no un cero', () => {
    // Un cero es una afirmación sobre el cuerpo del usuario; un hueco no lo es.
    assert.equal(formatNumber(null, 1), '');
    assert.equal(formatNumber(undefined, 1), '');
    assert.equal(formatNumber(NaN, 1), '');
    assert.equal(escapeField(null), '');
});

test('inyección de fórmulas: los prefijos peligrosos se neutralizan', () => {
    for (const peligroso of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
        const salida = escapeField(peligroso);
        assert.ok(salida.startsWith("'") || salida.startsWith('"\''),
            `«${JSON.stringify(peligroso)}» sale como ${JSON.stringify(salida)}: seguiría siendo una fórmula`);
    }
    // Y un texto normal no se toca.
    assert.equal(escapeField('Peso previsto'), 'Peso previsto');
});

test('las comillas y el separador se escapan según RFC 4180', () => {
    setLocale('es');
    assert.equal(escapeField('di "hola"'), '"di ""hola"""');
    assert.equal(escapeField('a;b'), '"a;b"', 'el separador dentro del campo obliga a entrecomillar');
    assert.equal(escapeField('linea\nsalto'), '"linea\nsalto"');

    // En inglés el separador es otro, así que lo que hay que entrecomillar cambia.
    setLocale('en');
    assert.equal(escapeField('a;b'), 'a;b');
    assert.equal(escapeField('a,b'), '"a,b"');
});

test('el fichero lleva BOM y saltos CRLF', () => {
    const csv = toCsv({ headers: ['Fecha', 'Peso'], rows: [['2026-08-03', '80,0']] });
    assert.ok(csv.startsWith('﻿'),
        'sin BOM, Excel abre en Latin-1 y destroza los acentos');
    assert.ok(csv.includes('\r\n'));
    assert.equal(csv.split('\r\n')[0], '﻿Fecha;Peso');
});

test('la cabecera lleva la unidad Y la procedencia', () => {
    // Una hoja de cálculo es donde la v4.0 hizo su daño: cifras estimadas
    // mezcladas con medidas y tratadas después como si todas fueran datos.
    const csv = toCsv({
        headers: ['Fecha', 'Peso previsto (kg, Prevista)', 'Cintura (cm, Medida)'],
        rows: [['2026-08-03', '80,0', '88,0']]
    });
    const cabecera = csv.split('\r\n')[0];
    assert.ok(cabecera.includes('Prevista'));
    assert.ok(cabecera.includes('Medida'));
    assert.ok(cabecera.includes('kg'));
    assert.ok(cabecera.includes('cm'));
});

test('la primera columna es la fecha en ISO', () => {
    // Legible es para la pantalla; un CSV lo lee una máquina antes que una
    // persona, y «3 de agosto de 2026» no ordena ni se parsea.
    const csv = toCsv({ headers: ['Fecha'], rows: [['2026-08-03'], ['2026-08-10']] });
    const filas = csv.replace('﻿', '').trim().split('\r\n');
    assert.equal(filas[1], '2026-08-03');
    assert.equal(filas[2], '2026-08-10');
    assert.deepEqual([...filas.slice(1)].sort(), filas.slice(1), 'el ISO ordena bien como texto');
});

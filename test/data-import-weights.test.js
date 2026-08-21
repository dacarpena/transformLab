// @ts-check

/**
 * Importar un histórico de pesos desde CSV (E15-9).
 *
 * Un CSV es un fichero AJENO, y los ficheros ajenos son el vector hostil de este
 * producto. Estos tests van sobre lo que de verdad sueltan las aplicaciones de
 * báscula: separadores distintos, coma decimal, fechas europeas, BOM de Excel,
 * horas pegadas a la fecha y columnas en cualquier orden.
 *
 * La regla que gobierna el módulo: **NUNCA lanza, y nunca escribe.** Devuelve lo
 * que ha entendido y lo que ha descartado, con el motivo, para que una persona lo
 * mire antes de que nada toque el almacén.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect, applyRows, parseDate, parseNumber, detectSeparator, MAX_IMPORT_BYTES }
    from '../src/data/import-weights.js';

const ok = (/** @type {*} */ r) => { assert.ok(r.ok, `esperaba ok, salió ${r.ok ? '' : r.error}`); return r.value; };

test('parseDate: ISO, europeo, con hora pegada, y lo que NO se adivina', () => {
    assert.equal(parseDate('2026-01-05'), '2026-01-05');
    assert.equal(parseDate('05/01/2026'), '2026-01-05');
    assert.equal(parseDate('05-01-2026'), '2026-01-05');
    assert.equal(parseDate('05.01.2026'), '2026-01-05');
    assert.equal(parseDate('2026-01-05 07:31'), '2026-01-05');
    assert.equal(parseDate('2026-01-05T07:31:00Z'), '2026-01-05');
    assert.equal(parseDate('"2026-01-05"'), '2026-01-05');

    // Calendario de verdad: 2026 no es bisiesto.
    assert.equal(parseDate('2026-02-29'), null);
    assert.equal(parseDate('2024-02-29'), '2024-02-29');
    assert.equal(parseDate('2026-13-01'), null);
    assert.equal(parseDate('2026-01-32'), null);

    // Ni fecha, ni intento de adivinar.
    assert.equal(parseDate(''), null);
    assert.equal(parseDate('Fecha'), null);
    assert.equal(parseDate('74.2'), null);
    assert.equal(parseDate(/** @type {*} */ (null)), null);
});

test('parseNumber: coma y punto decimal, y la unidad pegada detrás', () => {
    assert.equal(parseNumber('74.2'), 74.2);
    assert.equal(parseNumber('74,2'), 74.2);
    assert.equal(parseNumber(' 74,2 '), 74.2);
    assert.equal(parseNumber('74,2 kg'), 74.2);
    assert.equal(parseNumber('"74,2"'), 74.2);
    assert.equal(parseNumber('-1,5'), -1.5);
    assert.equal(parseNumber('Peso'), null);
    assert.equal(parseNumber(''), null);
    assert.equal(parseNumber('74,2,3'), null);
});

test('detectSeparator: el punto y coma gana a la coma, que en español es decimal', () => {
    assert.equal(detectSeparator(['fecha;peso', '2026-01-05;74,2']), ';');
    assert.equal(detectSeparator(['fecha\tpeso', '2026-01-05\t74.2']), '\t');
    assert.equal(detectSeparator(['fecha,peso', '2026-01-05,74.2']), ',');
});

test('un CSV español con cabecera, punto y coma y coma decimal', () => {
    const v = ok(inspect('Fecha;Peso (kg)\n2026-01-05;74,2\n2026-01-12;73,8\n'));
    assert.deepEqual(v.rows.map((/** @type {*} */ r) => [r.dateISO, r.weightKg]),
        [['2026-01-05', 74.2], ['2026-01-12', 73.8]]);
    assert.deepEqual(v.skipped, [], 'la cabecera no es un descarte: se reconoce sola');
    assert.equal(v.firstISO, '2026-01-05');
    assert.equal(v.lastISO, '2026-01-12');
});

test('sin cabecera, con BOM de Excel y con CRLF', () => {
    const v = ok(inspect('﻿05/01/2026;74,2\r\n12/01/2026;73,8\r\n'));
    assert.equal(v.rows.length, 2);
    assert.equal(v.rows[0].dateISO, '2026-01-05');
});

test('el ORDEN de las columnas da igual: manda el contenido', () => {
    // Cada báscula exporta lo suyo y en el orden que le parece.
    const v = ok(inspect('Peso;Grasa;Fecha\n74,2;22,1;2026-01-05\n'));
    assert.deepEqual(v.rows.map((/** @type {*} */ r) => [r.dateISO, r.weightKg]), [['2026-01-05', 74.2]]);
});

test('con más columnas, se coge el primer número que PUEDA ser un peso', () => {
    // 22,1 % de grasa no es un peso plausible; 74,2 kg sí.
    const v = ok(inspect('Fecha;Grasa;Peso;Pasos\n2026-01-05;22,1;74,2;8300\n'));
    assert.deepEqual(v.rows.map((/** @type {*} */ r) => r.weightKg), [74.2]);
});

test('las filas descartadas se CUENTAN, con su motivo', () => {
    const v = ok(inspect([
        'Fecha;Peso',
        '2026-01-05;74,2',
        '2026-01-06;999',        // fuera de rango
        '2026-01-07;',           // sin peso
        'sin fecha;73,0',        // sin fecha
        '2026-01-05;72,0'        // duplicada en el propio fichero
    ].join('\n')));

    assert.equal(v.rows.length, 1);
    assert.deepEqual(v.skipped.map((/** @type {*} */ s) => s.reason), [
        'importWeights.weightOutOfRange',
        'importWeights.noWeight',
        'importWeights.noDate',
        'importWeights.duplicateInFile'
    ]);
    // Y cada descarte dice en qué línea, para que se pueda ir a mirar.
    assert.deepEqual(v.skipped.map((/** @type {*} */ s) => s.line), [3, 4, 5, 6]);
});

test('una fecha que YA tiene check-in se descarta, nunca se sobrescribe', () => {
    // Ese día puede llevar perímetros, notas o escalas que el import no ve.
    const v = ok(inspect('2026-01-05;74,2\n2026-01-12;73,8\n', { existingDates: ['2026-01-05'] }));
    assert.deepEqual(v.rows.map((/** @type {*} */ r) => r.dateISO), ['2026-01-12']);
    assert.deepEqual(v.skipped.map((/** @type {*} */ s) => s.reason), ['importWeights.alreadyExists']);
});

test('las fechas fuera del plan se descartan con su motivo', () => {
    const plan = { startDateISO: '2026-01-01', totalDays: 30 };
    const v = ok(inspect('2025-12-25;74,2\n2026-01-05;73,8\n2026-03-01;73,0\n', { plan }));
    assert.deepEqual(v.rows.map((/** @type {*} */ r) => r.dateISO), ['2026-01-05']);
    assert.deepEqual(v.skipped.map((/** @type {*} */ s) => s.reason),
        ['importWeights.outOfPlan', 'importWeights.outOfPlan']);
});

test('las filas salen ORDENADAS por fecha, venga como venga el fichero', () => {
    const v = ok(inspect('2026-01-12;73,8\n2026-01-05;74,2\n2026-01-08;74,0\n'));
    assert.deepEqual(v.rows.map((/** @type {*} */ r) => r.dateISO),
        ['2026-01-05', '2026-01-08', '2026-01-12']);
});

test('un fichero sin nada aprovechable devuelve error, no una lista vacía', () => {
    const vacio = inspect('Fecha;Peso\n');
    assert.equal(vacio.ok, false);
    assert.equal(vacio.ok === false && vacio.error, 'importWeights.noRows');

    const todoMal = inspect('2026-01-05;999\n2026-01-06;0,5\n');
    assert.equal(todoMal.ok, false);
    assert.equal(todoMal.ok === false && todoMal.error, 'importWeights.allSkipped');
});

test('NUNCA lanza, ni con la entrada más hostil', () => {
    const hostiles = [
        null, undefined, 42, {}, [],
        ' ',
        '=SUM(A1:A9)\n',
        '"sin cerrar;74,2\n',
        ';;;;;;;;;\n',
        '2026-01-05;74,2;'.repeat(200)
    ];
    for (const h of hostiles) {
        const r = inspect(/** @type {*} */ (h));
        assert.equal(typeof r.ok, 'boolean',
            `entrada ${String(JSON.stringify(h)).slice(0, 20)} no devolvió un resultado`);
    }
});

test('un fichero enorme se rechaza antes de parsearlo', () => {
    const gigante = 'x'.repeat(MAX_IMPORT_BYTES);
    const r = inspect(gigante);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'importWeights.tooLarge');
});

test('diez mil filas se procesan sin ahogarse', () => {
    const lineas = [];
    for (let i = 0; i < 10000; i++) {
        const d = new Date(Date.UTC(2000, 0, 1) + i * 86400000).toISOString().slice(0, 10);
        lineas.push(`${d};${(70 + (i % 100) / 10).toFixed(1)}`);
    }
    const t0 = Date.now();
    const v = ok(inspect(lineas.join('\n')));
    assert.equal(v.rows.length, 10000);
    assert.ok(Date.now() - t0 < 3000, 'el parseo no puede congelar la pestaña');
});

test('applyRows escribe por el `save` que se le inyecta, y devuelve la cuenta', () => {
    /** @type {*[]} */ const escritos = [];
    const r = applyRows(
        [{ dateISO: '2026-01-05', weightKg: 74.2, line: 1 }, { dateISO: '2026-01-12', weightKg: 73.8, line: 2 }],
        { save: (/** @type {*} */ input) => { escritos.push(input); return { ok: true }; }, nowISO: '2026-01-20T00:00:00.000Z' }
    );
    assert.deepEqual(r, { ok: true, imported: 2 });
    assert.deepEqual(escritos, [
        { dateISO: '2026-01-05', weightKg: 74.2 },
        { dateISO: '2026-01-12', weightKg: 73.8 }
    ]);
});

test('applyRows se para al primer fallo y DICE cuánto había escrito ya', () => {
    // Un import a medias que miente sobre cuánto entró es peor que uno que se
    // para y lo dice: el usuario tiene que saber desde dónde reintentar.
    let n = 0;
    const r = applyRows(
        [1, 2, 3].map((i) => ({ dateISO: `2026-01-0${i}`, weightKg: 74, line: i })),
        {
            save: () => (++n === 2 ? { ok: false, error: 'QuotaExceededError' } : { ok: true }),
            nowISO: '2026-01-20T00:00:00.000Z'
        }
    );
    assert.equal(r.ok, false);
    assert.equal(r.imported, 1);
    assert.equal(r.ok === false && r.dateISO, '2026-01-02');
});

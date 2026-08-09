// @ts-check

/**
 * La geometría de los gestos (E13-7).
 *
 * `attachGestures` necesita un navegador, pero las dos funciones que deciden
 * DÓNDE acaba la ventana son puras y se prueban aquí. Son las que pueden
 * equivocarse en silencio: un zoom mal anclado no lanza ningún error, solo
 * aparta de la vista el punto que el usuario estaba mirando.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { clampWindow, zoomAround } from '../src/ui/chart-gestures.js';
import { windowRect } from '../src/ui/spark.js';

const PLAN = { from: 0, to: 200 };

test('clampWindow conserva la ANCHURA al chocar con un extremo', () => {
    // Recortar en vez de desplazar sería el defecto sutil: el usuario panea
    // hacia el principio y la ventana se le encoge sin haberlo pedido.
    const r = clampWindow(-30, 20, PLAN);
    assert.equal(r.from, 0);
    assert.equal(r.to - r.from, 50, 'la anchura se mantiene, la ventana se desplaza');

    const derecha = clampWindow(190, 240, PLAN);
    assert.equal(derecha.to, 200);
    assert.equal(derecha.to - derecha.from, 50);
});

test('clampWindow no deja hacer zoom por debajo del mínimo legible', () => {
    const r = clampWindow(100, 101, PLAN);
    assert.ok(r.to - r.from >= 5, `ventana de ${r.to - r.from} días: el eje X no tendría rótulos distintos`);
});

test('una ventana más ancha que el plan se ajusta al plan entero', () => {
    assert.deepEqual(clampWindow(-500, 900, PLAN), { from: 0, to: 200 });
});

test('zoomAround deja quieto el día bajo el cursor', () => {
    // Es lo que hace que el zoom se sienta natural: sin ancla, acercarse sobre
    // un punto concreto lo aparta de la vista.
    const ventana = { from: 50, to: 150 };
    const ancla = 75;   // a un cuarto de la ventana

    const acercado = zoomAround(ventana, ancla, 0.5, PLAN);
    const proporcionAntes = (ancla - ventana.from) / (ventana.to - ventana.from);
    const proporcionDespues = (ancla - acercado.from) / (acercado.to - acercado.from);
    assert.ok(Math.abs(proporcionAntes - proporcionDespues) < 0.02,
        `el ancla se movió del ${(proporcionAntes * 100).toFixed(0)} % al ${(proporcionDespues * 100).toFixed(0)} %`);
    assert.ok(acercado.to - acercado.from < 100, 'factor < 1 acerca');

    const alejado = zoomAround(ventana, ancla, 2, PLAN);
    assert.ok(alejado.to - alejado.from > 100, 'factor > 1 aleja');
});

test('el zoom nunca se sale del plan', () => {
    for (const ancla of [0, 1, 100, 199, 200]) {
        for (const factor of [0.25, 0.5, 1, 2, 8]) {
            const r = zoomAround({ from: 0, to: 200 }, ancla, factor, PLAN);
            assert.ok(r.from >= PLAN.from, `from=${r.from} con ancla ${ancla} y factor ${factor}`);
            assert.ok(r.to <= PLAN.to, `to=${r.to} con ancla ${ancla} y factor ${factor}`);
            assert.ok(r.to > r.from);
        }
    }
});

test('alejarse del todo devuelve el plan entero, sin residuo', () => {
    // Un usuario que se aleja hasta el tope tiene que llegar EXACTAMENTE al
    // plan completo; quedarse a dos días del final se ve como un fallo.
    let ventana = { from: 80, to: 120 };
    for (let i = 0; i < 40; i++) ventana = zoomAround(ventana, 100, 1.15, PLAN);
    assert.deepEqual(ventana, PLAN);
});

test('las coordenadas son enteras: media jornada no existe', () => {
    const r = zoomAround({ from: 10, to: 90 }, 33, 0.7, PLAN);
    assert.ok(Number.isInteger(r.from) && Number.isInteger(r.to), `${r.from}..${r.to}`);
});

/* ---------------------------------------------------------------------- *
 * Geometría de la tira de contexto (E13-14)
 * ---------------------------------------------------------------------- */

test('windowRect sitúa la ventana en proporción al plan', () => {
    // La mitad central de un plan de 200 días ocupa la mitad central de la tira.
    const medio = windowRect(50, 150, 200, 1000);
    assert.equal(medio.x, '250.0');
    assert.equal(medio.width, '500.0');

    // El principio ancla en cero, el final no se sale.
    assert.equal(windowRect(0, 20, 200, 1000).x, '0.0');
    const fin = windowRect(180, 200, 200, 1000);
    assert.ok(Number(fin.x) + Number(fin.width) <= 1000.01);
});

test('windowRect nunca produce un rectángulo invisible ni fuera de la tira', () => {
    // Una ventana de un solo día tendría anchura cero: sería invisible justo
    // cuando más falta hace saber dónde estás.
    assert.ok(Number(windowRect(100, 100, 200, 1000).width) >= 2);

    // Y una ventana que se sale por los extremos se recorta, no desborda.
    for (const [from, to] of [[-50, 300], [-10, 10], [190, 400]]) {
        const r = windowRect(from, to, 200, 1000);
        assert.ok(Number(r.x) >= 0, `x=${r.x}`);
        assert.ok(Number(r.x) + Number(r.width) <= 1000.01, `${r.x}+${r.width}`);
    }
});

test('windowRect degrada con un plan imposible', () => {
    for (const total of [0, -5, NaN, undefined]) {
        assert.deepEqual(windowRect(0, 10, /** @type {*} */ (total), 1000), { x: '0', width: '0' });
    }
});

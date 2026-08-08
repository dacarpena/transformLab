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

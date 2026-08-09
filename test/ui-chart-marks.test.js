// @ts-check

/**
 * Los marcadores de hito sobre el lienzo (E14-3).
 *
 * El dibujo necesita un navegador; las dos decisiones que pueden equivocarse en
 * silencio son puras y se prueban aquí. Y las dos son de la misma familia: qué
 * se enseña cuando no cabe todo. Un adelgazamiento por orden de llegada tapa un
 * aviso de salud con el hito estético número 54 y nadie se entera.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { groupMarks, thinMarks, MARK_PRIORITY } from '../src/ui/chart.js';

/** @param {number} dayIndex @param {*} kind @param {string} [label] */
const mark = (dayIndex, kind, label = `${kind}@${dayIndex}`) => ({ dayIndex, kind, label });

test('los hitos del mismo día son UN marcador, no cinco triángulos apilados', () => {
    const groups = groupMarks([
        mark(10, 'aesthetic'), mark(10, 'aesthetic'), mark(10, 'health'), mark(30, 'phase')
    ]);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].dayIndex, 10);
    assert.equal(groups[0].marks.length, 3);
    assert.equal(groups[0].kind, 'health', 'el grupo se pinta con el tipo de mayor prioridad');
    // Y dentro del grupo, lo importante primero: es el orden en que se lee la ficha.
    assert.equal(groups[0].marks[0].kind, 'health');
});

test('un aviso manda sobre todo lo demás', () => {
    assert.equal(MARK_PRIORITY[0], 'risk');
    const groups = groupMarks([mark(5, 'phase'), mark(5, 'risk'), mark(5, 'body')]);
    assert.equal(groups[0].kind, 'risk');
});

test('groupMarks ordena por día y aguanta basura', () => {
    const groups = groupMarks([mark(90, 'body'), mark(3, 'body'), mark(40, 'body')]);
    assert.deepEqual(groups.map((g) => g.dayIndex), [3, 40, 90]);
    assert.deepEqual(groupMarks(/** @type {*} */ (null)), []);
    assert.deepEqual(groupMarks([/** @type {*} */ (null), /** @type {*} */ ({ dayIndex: NaN })]), []);
});

test('adelgazar respeta la PRIORIDAD, no el orden de llegada', () => {
    // Dos hitos a un día de distancia en un plan de 200 días sobre 400 px: sus
    // marcadores caerían a 2 px uno de otro. Solo cabe uno, y tiene que ser el
    // aviso, aunque llegue después.
    const groups = groupMarks([mark(50, 'aesthetic'), mark(51, 'risk')]);
    const { visible, hiddenCount } = thinMarks(groups, 400, { from: 0, to: 200 });
    assert.equal(visible.length, 1);
    assert.equal(visible[0].kind, 'risk');
    assert.equal(hiddenCount, 1);
});

test('lo que no cabe se CUENTA: un recorte silencioso se lee como «esto es todo»', () => {
    const groups = groupMarks(Array.from({ length: 40 }, (_, i) => mark(i, 'aesthetic')));
    const { visible, hiddenCount } = thinMarks(groups, 200, { from: 0, to: 200 }, 16);
    assert.ok(visible.length < groups.length);
    assert.equal(visible.length + hiddenCount, groups.length, 'la cuenta tiene que cuadrar');
});

test('con sitio de sobra no se esconde nada, y salen en orden de fecha', () => {
    const groups = groupMarks([mark(0, 'phase'), mark(60, 'health'), mark(120, 'aesthetic')]);
    const { visible, hiddenCount } = thinMarks(groups, 1200, { from: 0, to: 180 });
    assert.equal(hiddenCount, 0);
    assert.deepEqual(visible.map((g) => g.dayIndex), [0, 60, 120]);
});

test('fuera de la ventana no se cuenta como escondido: no está, y ya está', () => {
    // Contarlo diría «5 hitos no caben» en una ventana donde no hay ninguno,
    // que es una alarma sobre nada.
    const groups = groupMarks([mark(5, 'phase'), mark(190, 'phase')]);
    const { visible, hiddenCount } = thinMarks(groups, 800, { from: 100, to: 200 });
    assert.deepEqual(visible.map((g) => g.dayIndex), [190]);
    assert.equal(hiddenCount, 0);
});

test('al acercar el zoom cabe MÁS, no lo mismo', () => {
    const groups = groupMarks(Array.from({ length: 30 }, (_, i) => mark(i * 2, 'aesthetic')));
    const lejos = thinMarks(groups, 600, { from: 0, to: 200 });
    const cerca = thinMarks(groups, 600, { from: 0, to: 20 });
    const dentroCerca = groups.filter((g) => g.dayIndex <= 20).length;
    assert.equal(cerca.visible.length, dentroCerca, 'acercado caben todos los del tramo');
    assert.ok(lejos.visible.length < groups.length);
});

test('thinMarks degrada con geometría imposible en vez de dividir por cero', () => {
    const groups = groupMarks([mark(1, 'phase'), mark(2, 'phase')]);
    for (const [w, r] of [[0, { from: 0, to: 10 }], [500, { from: 5, to: 5 }], [NaN, { from: 0, to: 10 }]]) {
        const out = thinMarks(groups, /** @type {*} */ (w), /** @type {*} */ (r));
        assert.equal(out.hiddenCount, 0, `${w} / ${JSON.stringify(r)}`);
    }
    assert.deepEqual(thinMarks(/** @type {*} */ (null), 100, { from: 0, to: 10 }),
        { visible: [], hiddenCount: 0 });
});

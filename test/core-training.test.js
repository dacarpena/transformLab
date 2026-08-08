// @ts-check

/** M5-2 · Entrenamiento: 1RM estimado, récords y progresión desde el histórico. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimatedOneRepMax, personalRecord, newRecordsIn, suggestProgression, sessionVolumeKg, LOAD_STEPS_KG, SESSIONS_BEFORE_PROGRESSION, e1rmSeries, tonnageSeries } from '../src/core/training.js';

/** @param {string} id @param {string} dateISO @param {Array<[number, number]>} sets */
function session(id, dateISO, sets, exerciseId = 'squat') {
    return {
        id, dateISO,
        entries: [{ exerciseId, sets: sets.map(([reps, loadKg]) => ({ reps, loadKg })) }]
    };
}

test('1RM por Epley: una repetición es la propia carga, y crece con las reps', () => {
    assert.equal(estimatedOneRepMax(1, 100), 100 * (1 + 1 / 30));
    assert.ok(estimatedOneRepMax(5, 100) > estimatedOneRepMax(3, 100));
    // 5×100 kg ≈ 116,7 kg
    assert.ok(Math.abs(estimatedOneRepMax(5, 100) - 116.67) < 0.1);
});

test('1RM: por encima de 12 repeticiones no se extrapola', () => {
    assert.equal(estimatedOneRepMax(13, 60), estimatedOneRepMax(12, 60));
    assert.equal(estimatedOneRepMax(30, 60), estimatedOneRepMax(12, 60));
});

test('1RM degrada a NaN con entradas imposibles, sin lanzar', () => {
    for (const [reps, load] of /** @type {Array<[any, any]>} */ ([
        [0, 100], [-3, 100], [5, 0], [5, -20], [NaN, 100], [5, NaN], ['x', 100], [null, null]
    ])) {
        assert.ok(Number.isNaN(estimatedOneRepMax(reps, load)), `${reps}×${load}`);
    }
});

test('el récord es el mejor 1RM estimado, no la carga más alta', () => {
    const sessions = [
        session('s1', '2026-01-05', [[10, 80]]),   // e1RM ≈ 106,7
        session('s2', '2026-01-12', [[1, 100]])    // e1RM ≈ 103,3 · más carga, peor récord
    ];
    const pr = personalRecord(sessions, 'squat');
    assert.ok(pr);
    assert.equal(pr.bestLoadKg, 80);
    assert.equal(pr.bestReps, 10);
    assert.equal(pr.dateISO, '2026-01-05');
});

test('sin histórico del ejercicio, no hay récord', () => {
    assert.equal(personalRecord([session('s1', '2026-01-05', [[5, 100]])], 'bench'), null);
    assert.equal(personalRecord([], 'squat'), null);
});

test('el PRIMER registro de un ejercicio NO se anuncia como récord', () => {
    const sessions = [session('s1', '2026-01-05', [[5, 100]])];
    assert.deepEqual(newRecordsIn(sessions, 's1'), []);
});

test('batir el récord anterior SÍ se detecta', () => {
    const sessions = [
        session('s1', '2026-01-05', [[5, 100]]),
        session('s2', '2026-01-12', [[5, 105]])
    ];
    assert.deepEqual(newRecordsIn(sessions, 's2'), ['squat']);
    // y una sesión peor no lo es
    const worse = [...sessions, session('s3', '2026-01-19', [[5, 95]])];
    assert.deepEqual(newRecordsIn(worse, 's3'), []);
});

test('el récord se compara contra el pasado, no contra sesiones futuras', () => {
    const sessions = [
        session('s1', '2026-01-05', [[5, 100]]),
        session('s2', '2026-01-12', [[5, 110]]),
        session('s3', '2026-01-19', [[5, 105]])
    ];
    // s3 es peor que s2, que es anterior: no es récord
    assert.deepEqual(newRecordsIn(sessions, 's3'), []);
    // pero s2 sí lo fue en su momento
    assert.deepEqual(newRecordsIn(sessions, 's2'), ['squat']);
});

test('progresión: sin histórico sugiere empezar, no una carga inventada', () => {
    const p = suggestProgression([], { id: 'squat', sets: 3, reps: 10 });
    assert.equal(p.action, 'start');
    assert.equal(p.loadKg, null);
});

test('progresión: se sube solo tras cumplir el tope del rango N sesiones seguidas', () => {
    const exercise = { id: 'squat', sets: 3, reps: 10 };
    // una sola sesión completa: todavía no
    const one = suggestProgression([session('s1', '2026-01-05', [[10, 80], [10, 80], [10, 80]])], exercise);
    assert.equal(one.action, 'hold', 'subió con una sola sesión');

    // dos seguidas completas: ahora sí
    const two = suggestProgression([
        session('s1', '2026-01-05', [[10, 80], [10, 80], [10, 80]]),
        session('s2', '2026-01-12', [[10, 80], [10, 80], [10, 80]])
    ], exercise);
    assert.equal(two.action, 'increase');
    assert.ok(two.loadKg !== null && two.loadKg > 80);
    assert.ok(LOAD_STEPS_KG.includes(two.incrementKg), `incremento ${two.incrementKg} no es un disco real`);
});

test('progresión: no sube si no se completaron todas las series', () => {
    const exercise = { id: 'squat', sets: 3, reps: 10 };
    const p = suggestProgression([
        session('s1', '2026-01-05', [[10, 80], [10, 80], [10, 80]]),
        session('s2', '2026-01-12', [[10, 80], [8, 80]])   // faltó una serie y se quedó corto
    ], exercise);
    assert.equal(p.action, 'hold');
    assert.equal(p.loadKg, 80);
});

test('progresión: nunca sugiere BAJAR la carga si el usuario retrocede', () => {
    const exercise = { id: 'squat', sets: 3, reps: 10 };
    const p = suggestProgression([
        session('s1', '2026-01-05', [[10, 90], [10, 90], [10, 90]]),
        session('s2', '2026-01-12', [[6, 90], [5, 90], [5, 90]])
    ], exercise);
    assert.equal(p.action, 'hold');
    assert.ok(p.incrementKg === 0);
    assert.ok(p.loadKg !== null && p.loadKg >= 90, 'sugirió retroceder');
});

test('el incremento escala con la carga y siempre cae en un disco real', () => {
    const exercise = { id: 'x', sets: 2, reps: 8 };
    for (const load of [20, 60, 100, 200]) {
        const p = suggestProgression([
            session('s1', '2026-01-05', [[8, load], [8, load]], 'x'),
            session('s2', '2026-01-12', [[8, load], [8, load]], 'x')
        ], exercise);
        assert.equal(p.action, 'increase');
        assert.ok(LOAD_STEPS_KG.includes(p.incrementKg), `${load} kg → incremento ${p.incrementKg}`);
    }
});

test('el volumen suma series × reps × carga e ignora lo mal formado', () => {
    assert.equal(sessionVolumeKg(session('s', '2026-01-05', [[10, 80], [8, 80]])), 10 * 80 + 8 * 80);
    const dirty = {
        id: 's', dateISO: '2026-01-05',
        entries: [{ exerciseId: 'x', sets: [{ reps: 10, loadKg: 50 }, { reps: NaN, loadKg: 50 }, null, { reps: -5, loadKg: 50 }] }]
    };
    assert.equal(sessionVolumeKg(/** @type {*} */ (dirty)), 500);
});

test('todas las funciones degradan con basura sin lanzar', () => {
    for (const bad of [null, undefined, 'x', 42, {}, [null], [{}]]) {
        assert.doesNotThrow(() => personalRecord(/** @type {*} */ (bad), 'squat'));
        assert.doesNotThrow(() => newRecordsIn(/** @type {*} */ (bad), 's1'));
        assert.doesNotThrow(() => suggestProgression(/** @type {*} */ (bad), { id: 'x', sets: 3, reps: 10 }));
        assert.doesNotThrow(() => sessionVolumeKg(/** @type {*} */ (bad)));
        assert.doesNotThrow(() => suggestProgression([], /** @type {*} */ (bad)));
    }
    assert.equal(sessionVolumeKg(/** @type {*} */ (null)), 0);
    assert.equal(SESSIONS_BEFORE_PROGRESSION >= 2, true);
});

test('un récord se anuncia UNA vez por ejercicio, aunque la sesión lo repita', () => {
    // El fallo que esto cierra: se empujaba un id por cada `entry`, así que
    // una sesión con el ejercicio repetido —una rutina que lo hace dos días,
    // o dos ejercicios con el id colisionado— anunciaba dos toasts iguales y
    // el logro `pr10` se desbloqueaba con cinco récords reales.
    const twice = (dateISO, loadKg) => ({
        id: `s_${dateISO}`, dateISO,
        entries: [
            { exerciseId: 'curl', sets: [{ reps: 10, loadKg }] },
            { exerciseId: 'curl', sets: [{ reps: 10, loadKg }] }
        ]
    });
    const records = newRecordsIn([twice('2026-03-02', 50), twice('2026-03-09', 55)], 's_2026-03-09');
    assert.deepEqual(records, ['curl']);
});

test('un esfuerzo EQUIVALENTE no es un récord (empates rotos por coma flotante)', () => {
    // 77,5 kg × 10 y 100 kg × 1 dan el mismo 1RM de Epley (103,333…), pero en
    // coma flotante uno sale 1,4e-14 mayor. Anunciar récord por eso es mentir.
    const one = (dateISO, reps, loadKg) => ({ id: `s_${dateISO}`, dateISO, entries: [{ exerciseId: 'x', sets: [{ reps, loadKg }] }] });
    assert.deepEqual(
        newRecordsIn([one('2026-03-02', 10, 77.5), one('2026-03-09', 1, 100)], 's_2026-03-09'),
        [], '77,5×10 y 100×1 son el mismo 1RM'
    );
    // Pero una mejora real sí se anuncia
    assert.deepEqual(
        newRecordsIn([one('2026-03-02', 10, 77.5), one('2026-03-09', 10, 80)], 's_2026-03-09'),
        ['x']
    );
});

test('barrido: ningún par de esfuerzos con el MISMO 1RM produce un récord', () => {
    const one = (dateISO, reps, loadKg) => ({ id: `s_${dateISO}`, dateISO, entries: [{ exerciseId: 'x', sets: [{ reps, loadKg }] }] });
    /** @type {Map<number, Array<[number, number]>>} */ const byE1rm = new Map();
    for (let load = 5; load <= 300; load += 2.5) {
        for (let reps = 1; reps <= 12; reps += 1) {
            const key = Math.round(estimatedOneRepMax(reps, load) * 1e6) / 1e6;
            byE1rm.set(key, [...(byE1rm.get(key) ?? []), [reps, load]]);
        }
    }
    let checked = 0;
    for (const group of byE1rm.values()) {
        if (group.length < 2) continue;
        for (let i = 1; i < group.length; i += 1) {
            const [r0, l0] = group[0];
            const [r1, l1] = group[i];
            const sessions = [one('2026-03-02', r0, l0), one('2026-03-09', r1, l1)];
            assert.deepEqual(newRecordsIn(sessions, 's_2026-03-09'), [],
                `${l0}×${r0} y ${l1}×${r1} tienen el mismo 1RM y no deberían ser récord`);
            checked += 1;
        }
    }
    assert.ok(checked > 50, `se esperaban muchos empates, se probaron ${checked}`);
});

/* ---------------------------------------------------------------------- *
 * Series para la gráfica (E13-1)
 * ---------------------------------------------------------------------- */

test('e1rmSeries da el mejor esfuerzo de CADA día, no el de toda la vida', () => {
    const sessions = [
        { id: 's1', dateISO: '2026-03-01', entries: [
            { exerciseId: 'squat', sets: [{ reps: 10, loadKg: 80 }, { reps: 5, loadKg: 95 }] }
        ] },
        { id: 's2', dateISO: '2026-03-08', entries: [
            { exerciseId: 'squat', sets: [{ reps: 8, loadKg: 90 }] },
            { exerciseId: 'bench', sets: [{ reps: 5, loadKg: 200 }] }
        ] }
    ];

    const serie = e1rmSeries(/** @type {*} */ (sessions), 'squat');
    assert.equal(serie.length, 2, 'un punto por día que tocó el ejercicio');
    // Día 1: 80×(1+10/30)=106,67 frente a 95×(1+5/30)=110,83 → gana el segundo.
    assert.equal(serie[0].dateISO, '2026-03-01');
    assert.ok(Math.abs(serie[0].e1rmKg - 110.833) < 0.01);
    assert.equal(serie[0].loadKg, 95, 'se guarda el esfuerzo que produjo el máximo, no otro');
    assert.ok(Math.abs(serie[1].e1rmKg - 114) < 0.01);

    // El press banca del día 8 NO contamina la sentadilla, aunque su 1RM sea
    // mucho mayor: `personalRecord` filtra por ejercicio y esto también.
    assert.ok(serie.every((p) => p.e1rmKg < 120));
    assert.deepEqual(e1rmSeries(/** @type {*} */ (sessions), 'inexistente'), []);
    assert.deepEqual(e1rmSeries(/** @type {*} */ (null), 'squat'), []);
});

test('e1rmSeries se queda con el mejor de DOS sesiones del mismo día', () => {
    const sessions = [
        { id: 'a', dateISO: '2026-03-01', entries: [{ exerciseId: 'squat', sets: [{ reps: 5, loadKg: 90 }] }] },
        { id: 'b', dateISO: '2026-03-01', entries: [{ exerciseId: 'squat', sets: [{ reps: 3, loadKg: 100 }] }] }
    ];
    const serie = e1rmSeries(/** @type {*} */ (sessions), 'squat');
    assert.equal(serie.length, 1, 'dos sesiones el mismo día son UN punto en la gráfica');
    assert.ok(Math.abs(serie[0].e1rmKg - 110) < 0.01, '100×(1+3/30)=110 gana a 90×(1+5/30)=105');
});

test('tonnageSeries suma las sesiones del mismo día y ordena por fecha', () => {
    const sessions = [
        { id: 'b', dateISO: '2026-03-08', entries: [
            { exerciseId: 'squat', sets: [{ reps: 5, loadKg: 100 }] }
        ] },
        { id: 'a1', dateISO: '2026-03-01', entries: [
            { exerciseId: 'squat', sets: [{ reps: 10, loadKg: 50 }] }
        ] },
        { id: 'a2', dateISO: '2026-03-01', entries: [
            { exerciseId: 'bench', sets: [{ reps: 10, loadKg: 40 }] }
        ] }
    ];
    const serie = tonnageSeries(/** @type {*} */ (sessions));
    assert.deepEqual(serie, [
        { dateISO: '2026-03-01', kg: 900, sessions: 2 },
        { dateISO: '2026-03-08', kg: 500, sessions: 1 }
    ]);
    assert.deepEqual(tonnageSeries(/** @type {*} */ ('no')), []);
});

// @ts-check

/**
 * Volumen semanal por grupo muscular (V2-M6).
 *
 * El test central es `glúteo_no_se_anula`: el diseño inicial contaba solo el
 * músculo PRIMARIO, y sobre el catálogo real eso da cero estímulo de glúteo a
 * quien sentadillea y hace peso muerto — porque el dataset asigna «lower back»
 * como primario del peso muerto y solo 11 de 556 ejercicios tienen glúteo.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    MUSCLE_GROUPS, BASE_LANDMARKS, landmarksFor, effectiveSets,
    zoneOf, stimulusOf, volumeReport
} from '../src/core/muscle-volume.js';

const CATALOGO = JSON.parse(readFileSync(
    fileURLToPath(new URL('../vendor/data/exercises.json', import.meta.url)), 'utf8'));
const POR_ID = Object.fromEntries(CATALOGO.exercises.map((/** @type {*} */ e) => [e.id, e]));
const idDe = (/** @type {string} */ n) => {
    const e = CATALOGO.exercises.find((/** @type {*} */ x) => x.name === n);
    assert.ok(e, `no está en el catálogo: ${n}`);
    return e.id;
};
const series = (/** @type {number} */ n) => Array.from({ length: n }, () => ({ reps: 8, loadKg: 60 }));

/* ---------------------------------------------------------------------- *
 * El invariante de la milestone
 * ---------------------------------------------------------------------- */

test('gluteo_no_se_anula: sentadilla y peso muerto SÍ estimulan el glúteo', () => {
    // Contando solo el motor primario esto daría 0, porque el catálogo asigna
    // «lower back» al peso muerto y «quadriceps» a la sentadilla. Un usuario
    // vería «tu glúteo no recibe estímulo» haciendo justo los dos ejercicios
    // que más lo trabajan.
    const sessions = [{
        dateISO: '2026-01-05',
        entries: [
            { exerciseId: idDe('Barbell Squat'), sets: series(4) },
            { exerciseId: idDe('Barbell Deadlift'), sets: series(4) },
            { exerciseId: idDe('Romanian Deadlift'), sets: series(3) }
        ]
    }];
    const { sets } = effectiveSets(sessions, POR_ID);
    assert.ok(sets.glutes > 0, 'el glúteo se quedó a cero: se está contando solo el primario');
    assert.ok(sets.glutes >= 4, `solo ${sets.glutes} series efectivas de glúteo`);
    assert.ok(sets.hamstrings > 0, 'los isquios también se anularon');
    assert.ok(sets.quads > 0);
});

test('el primario pesa MÁS que el secundario, no lo mismo', () => {
    // Si pesaran igual, un press de banca acreditaría tanto tríceps como pecho
    // y la proyección repartiría mal la ganancia.
    const banca = POR_ID[idDe('Barbell Bench Press - Medium Grip')];
    assert.equal(banca.muscles.chest, 1, 'el pecho no es el primario del press de banca');
    assert.ok(banca.muscles.triceps < 1, 'el tríceps pesa igual que el pecho');
    assert.ok(banca.muscles.triceps > 0, 'el tríceps no recibe nada');
});

/* ---------------------------------------------------------------------- *
 * Aritmética del volumen
 * ---------------------------------------------------------------------- */

test('las series se cuentan por SEMANA, no en total', () => {
    // Cuatro series repartidas en cuatro semanas no son cuatro semanales. Sin
    // dividir, la app felicitaría por un volumen que no existe.
    const sessions = [{ dateISO: '2026-01-05', entries: [{ exerciseId: idDe('Barbell Squat'), sets: series(8) }] }];
    const unaSemana = volumeReport({ sessions, catalog: POR_ID, weeks: 1 });
    const cuatro = volumeReport({ sessions, catalog: POR_ID, weeks: 4 });
    const q1 = unaSemana.groups.find((g) => g.group === 'quads');
    const q4 = cuatro.groups.find((g) => g.group === 'quads');
    assert.ok(q1 && q4);
    assert.equal(q4.weeklySets, Math.round((q1.weeklySets / 4) * 10) / 10);
});

test('un ejercicio que no está en el catálogo se DECLARA, no se ignora', () => {
    // Si alguien lleva media rutina con ejercicios propios, tiene que saber que
    // la cuenta no le cubre — callarlo sería enseñarle un volumen falso.
    const sessions = [{ dateISO: '2026-01-05', entries: [{ exerciseId: 'mi_ejercicio_raro', sets: series(4) }] }];
    const { sets, unknown } = effectiveSets(sessions, POR_ID);
    assert.deepEqual(unknown, ['mi_ejercicio_raro']);
    assert.equal(sets.chest, 0);
});

test('sin sesiones, todo a cero y sin lanzar', () => {
    const r = volumeReport({ sessions: [], catalog: POR_ID });
    assert.equal(r.groups.length, MUSCLE_GROUPS.length);
    for (const g of r.groups) {
        assert.equal(g.weeklySets, 0);
        assert.equal(g.stimulus, 0);
        assert.equal(g.zone, g.landmarks.mv === 0 ? 'belowMev' : 'belowMv');
    }
});

test('entradas corruptas no producen NaN ni lanzan', () => {
    const basura = /** @type {*} */ ([
        null, { entries: null }, { entries: [{ exerciseId: null, sets: 'muchas' }] },
        { entries: [{ sets: [{}] }] }
    ]);
    assert.doesNotThrow(() => effectiveSets(basura, POR_ID));
    const { sets } = effectiveSets(basura, POR_ID);
    for (const g of MUSCLE_GROUPS) assert.ok(Number.isFinite(sets[g]), `${g} salió NaN`);
});

/* ---------------------------------------------------------------------- *
 * Zonas y dosis-respuesta
 * ---------------------------------------------------------------------- */

test('las zonas ordenan el volumen correctamente', () => {
    const l = { mv: 8, mev: 10, mav: 20, mrv: 22 };
    assert.equal(zoneOf(4, l), 'belowMv');
    assert.equal(zoneOf(9, l), 'belowMev');
    assert.equal(zoneOf(15, l), 'productive');
    assert.equal(zoneOf(21, l), 'aboveMav');
    assert.equal(zoneOf(30, l), 'aboveMrv');
});

test('la dosis-respuesta es LOGARÍTMICA: doblar el volumen no dobla el estímulo', () => {
    // Es el hallazgo más replicado de la literatura de volumen. Modelarlo lineal
    // haría que la app recomendara entrenar sin techo.
    const l = { mv: 8, mev: 10, mav: 20, mrv: 22 };
    const cinco = stimulusOf(5, l);
    const diez = stimulusOf(10, l);
    assert.ok(diez > cinco, 'más volumen no dio más estímulo');
    assert.ok(diez < cinco * 2, `el estímulo escaló lineal: ${cinco} → ${diez}`);
});

test('el estímulo es monótono hasta el MAV y decae pasado el MRV', () => {
    const l = { mv: 8, mev: 10, mav: 20, mrv: 22 };
    let previo = -1;
    for (let s = 0; s <= 20; s++) {
        const actual = stimulusOf(s, l);
        assert.ok(actual >= previo, `bajó el estímulo en ${s} series`);
        previo = actual;
    }
    assert.equal(stimulusOf(20, l), 1, 'el MAV no llega al estímulo máximo');
    assert.equal(stimulusOf(22, l), 1, 'entre MAV y MRV debe mantenerse');
    assert.ok(stimulusOf(40, l) < 1, 'pasarse del MRV no penalizó');
    assert.ok(stimulusOf(100, l) >= 0.5, 'el castigo por exceso no tiene suelo');
});

/* ---------------------------------------------------------------------- *
 * Landmarks
 * ---------------------------------------------------------------------- */

test('los landmarks están ordenados mv ≤ mev ≤ mav ≤ mrv en TODOS los grupos', () => {
    for (const [grupo, l] of Object.entries(BASE_LANDMARKS)) {
        assert.ok(l.mv <= l.mev, `${grupo}: mv > mev`);
        assert.ok(l.mev <= l.mav, `${grupo}: mev > mav`);
        assert.ok(l.mav <= l.mrv, `${grupo}: mav > mrv`);
    }
    assert.deepEqual(Object.keys(BASE_LANDMARKS).sort(), [...MUSCLE_GROUPS].sort());
});

test('los landmarks escalan con la experiencia, y el orden se conserva', () => {
    const novato = landmarksFor('beginner');
    const avanzado = landmarksFor('advanced');
    for (const g of MUSCLE_GROUPS) {
        assert.ok(novato[g].mav <= avanzado[g].mav, `${g}: el novato no tiene menos MAV`);
        assert.ok(novato[g].mev <= novato[g].mav, `${g}: se rompió el orden al escalar`);
    }
});

test('un trainingStatus desconocido cae en intermedio, no en NaN', () => {
    const raro = landmarksFor(/** @type {*} */ ('astronauta'));
    assert.deepEqual(raro, landmarksFor('intermediate'));
});

/* ---------------------------------------------------------------------- *
 * El catálogo empaquetado
 * ---------------------------------------------------------------------- */

test('el catálogo empaquetado es coherente con el vocabulario del motor', () => {
    assert.ok(CATALOGO.exercises.length > 400, `solo ${CATALOGO.exercises.length} ejercicios`);
    assert.equal(CATALOGO.license, 'Unlicense');
    const grupos = new Set(MUSCLE_GROUPS);
    for (const e of CATALOGO.exercises) {
        assert.ok(e.id && e.name, 'ejercicio sin id o nombre');
        assert.ok(Object.keys(e.muscles).length > 0, `${e.name} sin músculos`);
        for (const [g, w] of Object.entries(e.muscles)) {
            assert.ok(grupos.has(g), `${e.name} usa un grupo desconocido: ${g}`);
            assert.ok(typeof w === 'number' && w > 0 && w <= 1, `${e.name}/${g}: peso ${w}`);
        }
    }
});

test('cada grupo del motor tiene ejercicios que lo trabajan de primario', () => {
    // Si un grupo no tuviera ninguno, la app no podría proponer nada para él.
    const primarios = {};
    for (const e of CATALOGO.exercises) {
        for (const [g, w] of Object.entries(e.muscles)) if (w === 1) primarios[g] = (primarios[g] ?? 0) + 1;
    }
    for (const g of MUSCLE_GROUPS) {
        assert.ok((primarios[g] ?? 0) > 0, `ningún ejercicio tiene ${g} como primario`);
    }
});

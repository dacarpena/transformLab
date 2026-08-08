// @ts-check

/**
 * Rutina y sesiones de entrenamiento (M7-4).
 *
 * Esta lógica vivía dentro de la vista, y por eso llevaba desde M5 sin un solo
 * test: no había nada importable desde Node. No era código de pintar — era
 * integridad de datos, con una colisión de ids ya arreglada a mano y sin red
 * que impidiera que volviera.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import * as training from '../src/data/training.js';

/** @type {import('./helpers/local-storage-mock.js').LocalStorageMock} */ let mock;

beforeEach(() => {
    mock = installLocalStorageMock();
    storage.setActiveProfile('p1');
});

const RUTINA = { dayName: 'Rutina' };

test('sin nada guardado devuelve una colección vacía, no null', () => {
    // La vista pinta su estado vacío con esto; un `null` la reventaría.
    assert.deepEqual(training.read(), { routine: null, sessions: [] });
});

test('el primer ejercicio crea la rutina', () => {
    assert.ok(training.addExercise({ name: 'Sentadilla', sets: 4, reps: 8 }, RUTINA).ok);
    const data = training.read();
    assert.equal(data.routine.days.length, 1);
    assert.equal(data.routine.days[0].name, 'Rutina');
    const [ex] = training.exercisesOf(data.routine);
    assert.equal(ex.name, 'Sentadilla');
    assert.equal(ex.sets, 4);
    assert.equal(ex.loadKg, null);
});

test('los ids no colisionan aunque se borre por medio', () => {
    // El generador anterior era `ex_${length + 1}_${slug}` y reutilizaba el
    // índice tras un borrado: dos ejercicios con el mismo id hacían que el
    // modal leyera siempre el primer campo y que borrar uno borrara los dos.
    training.addExercise({ name: 'Curl', sets: 3, reps: 10 }, RUTINA);
    training.addExercise({ name: 'Curl', sets: 3, reps: 10 }, RUTINA);
    const primero = training.exercisesOf(training.read().routine)[0].id;
    training.removeExercise(primero);
    training.addExercise({ name: 'Curl', sets: 3, reps: 10 }, RUTINA);

    const ids = training.exercisesOf(training.read().routine).map((/** @type {*} */ e) => e.id);
    assert.equal(new Set(ids).size, ids.length, `ids repetidos: ${ids.join(', ')}`);
});

test('el id de un ejercicio nunca sale de [A-Za-z0-9_]', () => {
    // Un id con comillas o corchetes rompería el selector CSS con el que la
    // vista lo localiza, y el validador del esquema.
    training.addExercise({ name: 'Press "banca" <b>[1]</b>', sets: 3, reps: 8 }, RUTINA);
    const [ex] = training.exercisesOf(training.read().routine);
    assert.match(ex.id, /^[A-Za-z0-9_]+$/, `id inseguro: ${ex.id}`);
});

test('un nombre sin caracteres utilizables sigue dando un id válido', () => {
    assert.ok(training.addExercise({ name: '«»…', sets: 3, reps: 8 }, RUTINA).ok);
    const [ex] = training.exercisesOf(training.read().routine);
    assert.match(ex.id, /^ex_\d+_ex$/);
});

test('borrar un ejercicio no toca a los demás', () => {
    training.addExercise({ name: 'Sentadilla', sets: 4, reps: 8 }, RUTINA);
    training.addExercise({ name: 'Peso muerto', sets: 3, reps: 5 }, RUTINA);
    const objetivo = training.exercisesOf(training.read().routine)[0].id;

    assert.ok(training.removeExercise(objetivo).ok);
    const quedan = training.exercisesOf(training.read().routine);
    assert.equal(quedan.length, 1);
    assert.equal(quedan[0].name, 'Peso muerto');
});

test('borrar sin rutina falla explícitamente, no en silencio', () => {
    const r = training.removeExercise('ex_1_loquesea');
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error, 'training.noRoutine');
});

test('dos sesiones del mismo día se reemplazan, no se duplican', () => {
    training.addExercise({ name: 'Remo', sets: 3, reps: 10 }, RUTINA);
    const id = training.exercisesOf(training.read().routine)[0].id;
    const entry = (/** @type {number} */ kg) =>
        [{ exerciseId: id, sets: [{ reps: 10, loadKg: kg }] }];

    training.saveSession({ dateISO: '2026-03-02', entries: entry(60) });
    training.saveSession({ dateISO: '2026-03-02', entries: entry(65) });

    const { sessions } = training.read();
    assert.equal(sessions.length, 1, 'se duplicó la sesión del día');
    assert.equal(sessions[0].entries[0].sets[0].loadKg, 65, 'no se quedó la última');
    assert.equal(sessions[0].id, training.sessionIdFor('2026-03-02'));
});

test('lo que no pasa el esquema NO se escribe, y lo anterior sobrevive', () => {
    // La razón de que todo pase por `validateCollection` antes de `storage.set`:
    // un registro raro no puede dejar la colección en un estado que la
    // aplicación no sepa releer.
    training.addExercise({ name: 'Fondos', sets: 3, reps: 12 }, RUTINA);
    const antes = training.read();

    const r = training.addExercise(
        /** @type {*} */ ({ name: 'Roto', sets: 'muchas', reps: null }), RUTINA);
    assert.equal(r.ok, false, 'el esquema aceptó `sets: "muchas"`');
    assert.deepEqual(training.read(), antes, 'la escritura fallida dejó rastro');
});

test('un almacén corrupto degrada a vacío en vez de reventar la vista', () => {
    mock.setItem('tl.5.p1.training', '{"schemaVersion":5,"routine":"no soy un objeto"}');
    assert.deepEqual(training.read(), { routine: null, sessions: [] });
});

test('cada perfil tiene su propia rutina', () => {
    training.addExercise({ name: 'Sentadilla', sets: 4, reps: 8 }, RUTINA);
    storage.setActiveProfile('p2');
    assert.deepEqual(training.read(), { routine: null, sessions: [] }, 'se filtró la rutina del otro perfil');
    storage.setActiveProfile('p1');
    assert.equal(training.exercisesOf(training.read().routine).length, 1);
});

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
import { rootPrefix, SCHEMA_VERSION } from '../src/data/version.js';
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

test('el id de un ejercicio es SEGURO: nada que rompa el marcado ni el esquema', () => {
    // Un id con comillas o corchetes rompería el atributo del que cuelga el
    // botón de borrar. El alfabeto es el de `SAFE_ID`, que incluye el guion:
    // base64url lo usa, y es inofensivo porque la vista delega por PRESENCIA del
    // atributo (`[data-remove-exercise]`) y lee el valor con `getAttribute` —
    // el id nunca entra en un selector como valor.
    training.addExercise({ name: 'Press "banca" <b>[1]</b>', sets: 3, reps: 8 }, RUTINA);
    const [ex] = training.exercisesOf(training.read().routine);
    assert.match(ex.id, /^[A-Za-z0-9_-]+$/, `id inseguro: ${ex.id}`);
    assert.ok(training.read().routine, 'la rutina no quedó válida');
});

test('el id NO se deriva del nombre: dos ejercicios distintos nunca colisionan', () => {
    // Es la razón del cambio, y está reproducida. El generador anterior usaba
    // los doce primeros caracteres alfanuméricos del nombre, así que «Press de
    // banca con barra» y «Press de banca con mancuernas» daban los DOS
    // `ex_1_Pressdeban`. En dos dispositivos eso son dos ejercicios distintos
    // con el mismo id: al sincronizar, las series de uno se atribuirían al grupo
    // muscular del otro — un dato falso presentado como verdadero.
    training.addExercise({ name: 'Press de banca con barra', sets: 4, reps: 8 }, RUTINA);
    training.addExercise({ name: 'Press de banca con mancuernas', sets: 4, reps: 8 }, RUTINA);
    const ids = training.exercisesOf(training.read().routine).map((/** @type {*} */ e) => e.id);
    assert.equal(new Set(ids).size, 2, `ids repetidos: ${ids.join(', ')}`);
    for (const id of ids) {
        assert.doesNotMatch(id, /Press|banca|barra|mancuern/i, `el id lleva el nombre dentro: ${id}`);
        assert.match(id, /^ex_[A-Za-z0-9_-]{22}$/, `no parece opaco: ${id}`);
    }
});

test('un nombre sin caracteres utilizables sigue dando un id válido', () => {
    // Antes el nombre alimentaba el id y un nombre sin alfanuméricos necesitaba
    // un caso especial. Ahora no lo alimenta, así que esto es gratis — pero se
    // queda: es el camino por el que se rompía.
    assert.ok(training.addExercise({ name: '«»…', sets: 3, reps: 8 }, RUTINA).ok);
    const [ex] = training.exercisesOf(training.read().routine);
    assert.match(ex.id, /^ex_[A-Za-z0-9_-]{22}$/);
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
    mock.setItem(`${rootPrefix()}p1.training`, `{"schemaVersion":${SCHEMA_VERSION},"routine":"no soy un objeto"}`);
    assert.deepEqual(training.read(), { routine: null, sessions: [] });
});

test('cada perfil tiene su propia rutina', () => {
    training.addExercise({ name: 'Sentadilla', sets: 4, reps: 8 }, RUTINA);
    storage.setActiveProfile('p2');
    assert.deepEqual(training.read(), { routine: null, sessions: [] }, 'se filtró la rutina del otro perfil');
    storage.setActiveProfile('p1');
    assert.equal(training.exercisesOf(training.read().routine).length, 1);
});

// @ts-check

/**
 * Colección de entrenamiento: rutina y sesiones registradas (M7-4).
 *
 * POR QUÉ SE SACA DE LA VISTA. Hasta ahora esto vivía dentro de
 * `src/ui/views/training.js`, y por eso la vista **no tenía un solo test
 * unitario**: no había nada importable desde Node que probar. Lo que había ahí
 * dentro no era pintar, era integridad de datos — generar ids que no colisionen,
 * decidir si una sesión reemplaza a otra, validar antes de escribir. Justo lo
 * que más se agradece tener cubierto.
 *
 * Como en `checkins.js`: todo pasa por `validateCollection` antes de escribirse,
 * de modo que la colección persistida siempre es válida aunque la vista falle.
 */

import * as storage from './storage.js';
import { SCHEMA_VERSION, validateCollection } from './schema.js';

/**
 * @typedef {{ routine: any, sessions: any[] }} TrainingData
 * @typedef {{ ok: true, value: TrainingData } | { ok: false, error: string }} TrainingResult
 */

const KEY = 'training';

/**
 * Lee la colección. Degrada a vacía —nunca lanza, nunca devuelve `null`— porque
 * la vista tiene que poder pintar algo aunque el almacén esté ilegible.
 * @returns {TrainingData}
 */
export function read() {
    const stored = storage.get(KEY);
    if (!stored.ok || stored.value === null) return { routine: null, sessions: [] };
    const parsed = validateCollection(KEY, stored.value);
    if (!parsed.ok) return { routine: null, sessions: [] };
    return { routine: parsed.value.routine, sessions: parsed.value.sessions };
}

/**
 * @param {TrainingData} data
 * @returns {TrainingResult}
 */
function write(data) {
    const record = { schemaVersion: SCHEMA_VERSION, routine: data.routine, sessions: data.sessions };
    const checked = validateCollection(KEY, record);
    if (!checked.ok) return { ok: false, error: 'training.invalid' };
    const written = storage.set(KEY, checked.value);
    if (!written.ok) return { ok: false, error: written.error };
    return { ok: true, value: data };
}

/** Ejercicios de la rutina, aplanados de todos sus días. */
export function exercisesOf(/** @type {*} */ routine) {
    if (!routine || !Array.isArray(routine.days)) return [];
    return routine.days.flatMap((/** @type {*} */ day) => (Array.isArray(day.exercises) ? day.exercises : []));
}

/**
 * Id nuevo que NO colisiona con ninguno existente.
 *
 * El generador anterior era `ex_${existing.length + 1}_${nombre}`, y eso
 * reutiliza el índice tras un borrado: añadir «Curl», añadir «Curl», borrar el
 * primero y añadir «Curl» otra vez producía dos ejercicios con el mismo id.
 * A partir de ahí, el modal de sesión leía siempre el primer campo (perdiendo
 * lo tecleado en el segundo) y borrar uno borraba los dos.
 *
 * El id se restringe además a `[A-Za-z0-9_]`, para que nunca pueda romper un
 * selector CSS ni el esquema de validación.
 * @param {Array<{id?: string}>} existing
 * @param {string} name
 * @returns {string}
 */
export function freshExerciseId(existing, name) {
    const taken = new Set(existing.map((e) => e?.id).filter(Boolean));
    const slug = name.slice(0, 12).replace(/[^A-Za-z0-9]/g, '') || 'ex';
    let n = existing.length + 1;
    let id = `ex_${n}_${slug}`;
    while (taken.has(id)) {
        n += 1;
        id = `ex_${n}_${slug}`;
    }
    return id;
}

/**
 * Añade un ejercicio al primer día de la rutina, creándola si no existía.
 * @param {{ name: string, sets: number, reps: number }} input
 * @param {{ dayName: string }} context nombre del día por si hay que crear la rutina
 * @returns {TrainingResult}
 */
export function addExercise(input, context) {
    const data = read();
    const id = freshExerciseId(exercisesOf(data.routine), input.name);
    const routine = data.routine ?? { days: [{ name: context.dayName, exercises: [] }] };
    routine.days[0].exercises = [
        ...(routine.days[0].exercises ?? []),
        { id, name: input.name, sets: input.sets, reps: input.reps, loadKg: null }
    ];
    return write({ ...data, routine });
}

/**
 * Quita un ejercicio de todos los días de la rutina.
 * @param {string} id
 * @returns {TrainingResult}
 */
export function removeExercise(id) {
    const data = read();
    if (!data.routine) return { ok: false, error: 'training.noRoutine' };
    const routine = {
        ...data.routine,
        days: data.routine.days.map((/** @type {*} */ day) => ({
            ...day, exercises: (day.exercises ?? []).filter((/** @type {*} */ ex) => ex.id !== id)
        }))
    };
    return write({ ...data, routine });
}

/**
 * Id determinista de una sesión: uno por día. Registrar dos veces el mismo día
 * reemplaza en vez de duplicar — misma regla que en `checkins.js`.
 * @param {string} dateISO
 * @returns {string}
 */
export function sessionIdFor(dateISO) {
    return `s_${dateISO}`;
}

/**
 * Guarda una sesión del día, reemplazando la que hubiera.
 * @param {{ dateISO: string, entries: any[] }} input
 * @returns {TrainingResult}
 */
export function saveSession(input) {
    const data = read();
    const id = sessionIdFor(input.dateISO);
    const sessions = [
        ...data.sessions.filter((s) => s.id !== id),
        { id, dateISO: input.dateISO, entries: input.entries }
    ];
    return write({ ...data, sessions });
}

// @ts-check

/**
 * Vista de entrenamiento (M5-2): rutina editable, registro de sesión, récords
 * y progresión sugerida desde el histórico real.
 *
 * La rutina es del usuario. El legacy traía programas hardcodeados por fase y
 * nivel que no se podían tocar; aquí se crean y se editan los ejercicios que
 * uno hace de verdad, que es lo único que permite sugerir progresión honesta.
 */

import { html, render, on } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import { SCHEMA_VERSION, validateCollection, sanitizeText } from '../../data/schema.js';
import * as storage from '../../data/storage.js';
import * as plans from '../plan-state.js';
import { personalRecord, newRecordsIn, suggestProgression, sessionVolumeKg, estimatedOneRepMax } from '../../core/training.js';
import * as modal from '../components/modal.js';
import * as toast from '../components/toast.js';
import { empty } from '../components/state.js';
import { num } from '../format.js';

/** @returns {{ routine: any, sessions: any[] }} */
function readTraining() {
    const stored = storage.get('training');
    if (!stored.ok || stored.value === null) return { routine: null, sessions: [] };
    const parsed = validateCollection('training', stored.value);
    if (!parsed.ok) return { routine: null, sessions: [] };
    return { routine: parsed.value.routine, sessions: parsed.value.sessions };
}

/** @param {{ routine: any, sessions: any[] }} data @returns {boolean} */
function writeTraining(data) {
    const record = { schemaVersion: SCHEMA_VERSION, routine: data.routine, sessions: data.sessions };
    const checked = validateCollection('training', record);
    if (!checked.ok) return false;
    return storage.set('training', checked.value).ok;
}

/** Ejercicios de la rutina, aplanados. */
function exercisesOf(/** @type {*} */ routine) {
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
function freshExerciseId(existing, name) {
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

function renderRoutine(/** @type {*} */ data) {
    const exercises = exercisesOf(data.routine);
    return html`
        <section class="card" aria-labelledby="routine-title">
            <div class="card__header">
                <h2 id="routine-title" class="card__title">${t('training.routine')}</h2>
                <button type="button" class="btn btn--sm" data-add-exercise>${t('training.addExercise')}</button>
            </div>
            ${exercises.length === 0
                ? empty({ icon: '🏋', titleKey: 'training.routineEmpty', bodyKey: 'training.routineEmptyBody' })
                : html`
                    <ul class="profile-list">
                        ${exercises.map((/** @type {*} */ ex) => {
                            const pr = personalRecord(data.sessions, ex.id);
                            const suggestion = suggestProgression(data.sessions, { id: ex.id, sets: ex.sets, reps: ex.reps });
                            return html`
                                <li class="profile-item">
                                    <span>
                                        <strong>${ex.name}</strong>
                                        <span class="muted"> · ${ex.sets}×${ex.reps}</span>
                                        <br>
                                        <span class="muted">${pr
                                            ? t('training.pr', { load: num(pr.bestLoadKg), reps: pr.bestReps, e1rm: num(pr.bestE1rmKg) })
                                            : t('training.noPr')}</span>
                                        <br>
                                        <span class="secondary">${suggestion.action === 'increase'
                                            ? t('training.readyToIncrease', { load: num(suggestion.loadKg ?? 0), increment: num(suggestion.incrementKg) })
                                            : suggestion.action === 'hold'
                                                ? t('training.keepWorking', { load: num(suggestion.loadKg ?? 0) })
                                                : t('training.noHistory')}</span>
                                    </span>
                                    <button type="button" class="btn btn--sm btn--danger" data-remove-exercise="${ex.id}">
                                        ${t('action.delete')}
                                    </button>
                                </li>
                            `;
                        })}
                    </ul>
                    <div class="btn-row">
                        <button type="button" class="btn btn--primary" data-log-session>${t('training.logSession')}</button>
                    </div>
                `}
        </section>
    `;
}

function renderSessions(/** @type {*} */ data) {
    if (data.sessions.length === 0) return '';
    return html`
        <section class="card">
            <h2 class="card__title">${t('training.sessions')}</h2>
            <ul class="profile-list">
                ${[...data.sessions].reverse().slice(0, 12).map((s) => html`
                    <li class="profile-item">
                        <span>${s.dateISO}</span>
                        <span class="muted numeric">${t('training.volume', { kg: Math.round(sessionVolumeKg(s)) })}</span>
                    </li>
                `)}
            </ul>
        </section>
    `;
}

/** @param {HTMLElement} container */
function draw(container) {
    const data = readTraining();
    render(container, html`
        <h1 class="card__title">${t('training.title')}</h1>
        ${renderRoutine(data)}
        ${renderSessions(data)}
    `);
}

/** @param {HTMLElement} container */
export function mount(container) {
    draw(container);

    on(container, 'click', '[data-add-exercise]', () => {
        const dialog = modal.open({
            titleKey: 'training.addExercise',
            body: html`
                <label class="field">
                    <span class="field__label">${t('training.exerciseName')}</span>
                    <input type="text" class="input" data-name autocomplete="off">
                </label>
                <div class="field-grid">
                    <label class="field">
                        <span class="field__label">${t('training.sets')}</span>
                        <input type="number" class="input" inputmode="numeric" data-sets value="3" min="1" max="20">
                    </label>
                    <label class="field">
                        <span class="field__label">${t('training.reps')}</span>
                        <input type="number" class="input" inputmode="numeric" data-reps value="10" min="1" max="100">
                    </label>
                </div>
                <div class="modal__actions">
                    <button type="button" class="btn" data-modal-close>${t('action.cancel')}</button>
                    <button type="button" class="btn btn--primary" data-go>${t('action.save')}</button>
                </div>
            `
        });
        dialog.querySelector('[data-go]')?.addEventListener('click', () => {
            const name = sanitizeText(/** @type {HTMLInputElement | null} */ (dialog.querySelector('[data-name]'))?.value, 80);
            if (name === '') {
                toast.error('training.nameRequired');
                return;
            }
            const sets = Math.max(1, Math.round(Number(/** @type {HTMLInputElement | null} */ (dialog.querySelector('[data-sets]'))?.value) || 3));
            const reps = Math.max(1, Math.round(Number(/** @type {HTMLInputElement | null} */ (dialog.querySelector('[data-reps]'))?.value) || 10));

            const data = readTraining();
            const existing = exercisesOf(data.routine);
            const id = freshExerciseId(existing, name);
            const routine = data.routine ?? { days: [{ name: t('training.routine'), exercises: [] }] };
            routine.days[0].exercises = [...(routine.days[0].exercises ?? []), { id, name, sets, reps, loadKg: null }];

            if (!writeTraining({ ...data, routine })) {
                toast.error('error.generic');
                return;
            }
            modal.close();
            draw(container);
        });
    });

    on(container, 'click', '[data-remove-exercise]', (_event, target) => {
        const id = target.getAttribute('data-remove-exercise');
        if (!id) return;
        const data = readTraining();
        if (!data.routine) return;
        data.routine.days = data.routine.days.map((/** @type {*} */ day) => ({
            ...day, exercises: (day.exercises ?? []).filter((/** @type {*} */ ex) => ex.id !== id)
        }));
        if (!writeTraining(data)) {
            toast.error('error.generic');
            return;
        }
        draw(container);
    });

    on(container, 'click', '[data-log-session]', () => {
        const data = readTraining();
        const exercises = exercisesOf(data.routine);
        if (exercises.length === 0) return;

        const dialog = modal.open({
            titleKey: 'training.logSession',
            size: 'lg',
            body: html`
                ${exercises.map((/** @type {*} */ ex) => html`
                    <div class="field-grid">
                        <label class="field">
                            <span class="field__label">${ex.name} · ${t('training.reps')}</span>
                            <input type="number" class="input" inputmode="numeric" data-log-reps="${ex.id}" value="${ex.reps}">
                        </label>
                        <label class="field">
                            <span class="field__label">${t('training.load')}</span>
                            <input type="number" class="input" inputmode="decimal" step="0.5" data-log-load="${ex.id}"
                                   value="${ex.loadKg ?? ''}">
                        </label>
                    </div>
                `)}
                <div class="modal__actions">
                    <button type="button" class="btn" data-modal-close>${t('action.cancel')}</button>
                    <button type="button" class="btn btn--primary" data-go>${t('action.save')}</button>
                </div>
            `
        });

        dialog.querySelector('[data-go]')?.addEventListener('click', () => {
            const dateISO = plans.todayISO();
            const entries = [];
            // Los campos se leen por POSICIÓN, no por selector con el id
            // dentro. Un id con comillas —que puede llegar por import de un
            // backup— rompía `querySelector` con una DOMException dentro del
            // manejador: la sesión no se guardaba, no salía aviso, y el
            // usuario perdía todo lo tecleado sin enterarse.
            const repsFields = dialog.querySelectorAll('[data-log-reps]');
            const loadFields = dialog.querySelectorAll('[data-log-load]');
            for (let i = 0; i < exercises.length; i += 1) {
                const ex = exercises[i];
                const reps = Number(/** @type {HTMLInputElement | undefined} */ (repsFields[i])?.value);
                const loadKg = Number(/** @type {HTMLInputElement | undefined} */ (loadFields[i])?.value);
                if (!Number.isFinite(reps) || !Number.isFinite(loadKg) || loadKg <= 0) continue;
                entries.push({
                    exerciseId: ex.id,
                    sets: Array.from({ length: ex.sets }, () => ({ reps, loadKg }))
                });
            }
            if (entries.length === 0) {
                modal.close();
                return;
            }
            const fresh = readTraining();
            const id = `s_${dateISO}`;
            const sessions = [...fresh.sessions.filter((s) => s.id !== id), { id, dateISO, entries }];

            if (!writeTraining({ ...fresh, sessions })) {
                toast.error('error.generic');
                return;
            }
            modal.close();

            // los récords se anuncian DESPUÉS de guardar, comparando contra
            // todo el histórico anterior
            const records = newRecordsIn(sessions, id);
            for (const exerciseId of records) {
                const ex = exercises.find((/** @type {*} */ e) => e.id === exerciseId);
                if (ex) toast.success('training.newRecord', { exercise: ex.name });
            }
            if (records.length === 0) toast.success('training.sessionSaved');
            draw(container);
        });
    });
}

/**
 * Cuántas veces se ha BATIDO un récord, para los logros (E9c).
 *
 * No es «cuántos ejercicios tienen historial»: `newRecordsIn` no considera
 * récord el primer registro de un ejercicio, y el logro «primer récord» tiene
 * que significar lo mismo que el aviso que lo anunció. Un logro que se
 * concede por registrar la primera serie sería justo el regalo vacío que la
 * decisión E9c descarta.
 */
export function recordCount() {
    const data = readTraining();
    const ordered = [...data.sessions].sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)));
    let total = 0;
    for (let i = 0; i < ordered.length; i += 1) {
        total += newRecordsIn(ordered.slice(0, i + 1), ordered[i].id).length;
    }
    return total;
}

/** 1RM estimado del mejor ejercicio, para la tarjeta compartible. */
export function bestEstimatedOneRepMax() {
    const data = readTraining();
    let best = 0;
    for (const ex of exercisesOf(data.routine)) {
        const pr = personalRecord(data.sessions, ex.id);
        if (pr && pr.bestE1rmKg > best) best = pr.bestE1rmKg;
    }
    return best > 0 ? best : null;
}

export { estimatedOneRepMax };

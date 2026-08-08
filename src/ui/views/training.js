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
import { listDate } from '../dates.js';
import { sanitizeText } from '../../data/schema.js';
import * as trainingStore from '../../data/training.js';
import { exercisesOf } from '../../data/training.js';
import * as plans from '../plan-state.js';
import { personalRecord, newRecordsIn, suggestProgression, sessionVolumeKg } from '../../core/training.js';
import * as modal from '../components/modal.js';
import * as toast from '../components/toast.js';
import { empty } from '../components/state.js';
import { num } from '../format.js';

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
                        <span>${listDate(s.dateISO)}</span>
                        <span class="muted numeric">${t('training.volume', { kg: Math.round(sessionVolumeKg(s)) })}</span>
                    </li>
                `)}
            </ul>
        </section>
    `;
}

/** @param {HTMLElement} container */
function draw(container) {
    const data = trainingStore.read();
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

            const added = trainingStore.addExercise(
                { name, sets, reps }, { dayName: t('training.routine') });
            if (!added.ok) {
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
        if (!trainingStore.removeExercise(id).ok) {
            toast.error('error.generic');
            return;
        }
        draw(container);
    });

    on(container, 'click', '[data-log-session]', () => {
        const data = trainingStore.read();
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
            const saved = trainingStore.saveSession({ dateISO, entries });
            if (!saved.ok) {
                toast.error('error.generic');
                return;
            }
            modal.close();

            // los récords se anuncian DESPUÉS de guardar, comparando contra
            // todo el histórico anterior
            const records = newRecordsIn(saved.value.sessions, trainingStore.sessionIdFor(dateISO));
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
    const data = trainingStore.read();
    const ordered = [...data.sessions].sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)));
    let total = 0;
    for (let i = 0; i < ordered.length; i += 1) {
        total += newRecordsIn(ordered.slice(0, i + 1), ordered[i].id).length;
    }
    return total;
}


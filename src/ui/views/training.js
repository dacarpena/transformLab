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
import { volumeReport } from '../../core/muscle-volume.js';
import { weeklyPlan } from '../../core/training-plan.js';
import * as exercisesDb from '../../data/exercises-db.js';
import * as checkins from '../../data/checkins.js';
import * as modal from '../components/modal.js';
import * as toast from '../components/toast.js';
import { empty } from '../components/state.js';
import { num } from '../format.js';

/**
 * Catálogo de ejercicios, cargado bajo demanda. `null` = todavía no está.
 * @type {Record<string, import('../../data/exercises-db.js').Exercise> | null}
 */
let catalog = null;

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

/**
 * Volumen por grupo muscular (V2-M6).
 *
 * ES LA PIEZA QUE CONVIERTE «hice 4 series de sentadilla» EN «tu glúteo lleva
 * 4,4 series efectivas esta semana, por debajo de su mínimo». Y declara los
 * ejercicios que no puede atribuir: contarlos como cero en silencio haría que la
 * app le dijera a alguien que no entrena un músculo que sí entrena.
 */
function renderVolume(/** @type {*} */ data, /** @type {*} */ catalog) {
    if (catalog === null) {
        return html`
            <section class="card">
                <h2 class="card__title">${t('volume.title')}</h2>
                <p class="muted" role="status">${t('volume.loading')}</p>
            </section>
        `;
    }

    // El catálogo se indexa por el id del ejercicio EN LA RUTINA, no por el del
    // catálogo: las sesiones referencian lo que el usuario tiene apuntado.
    /** @type {Record<string, *>} */ const porRutina = {};
    for (const ex of exercisesOf(data.routine)) {
        if (ex.catalogId && catalog[ex.catalogId]) porRutina[ex.id] = catalog[ex.catalogId];
    }

    const semanas = Math.max(1, Math.min(8, data.sessions.length === 0 ? 1 : weeksSpanned(data.sessions)));
    const report = volumeReport({
        sessions: data.sessions,
        catalog: porRutina,
        trainingStatus: plans.get()?.profile?.user?.trainingStatus ?? 'intermediate',
        weeks: semanas
    });
    const plan = weeklyPlan({
        report,
        trainingStatus: plans.get()?.profile?.user?.trainingStatus ?? 'intermediate',
        checkins: checkins.list(),
        sessionsPerWeek: sessionsPerWeek(data.sessions, semanas)
    });

    return html`
        <section class="card" aria-labelledby="volume-title">
            <div class="card__header">
                <h2 id="volume-title" class="card__title">${t('volume.title')}</h2>
            </div>
            <p class="muted">${t('volume.explain', { weeks: semanas })}</p>

            ${plan.deload.offer
                // Se OFRECE, no se aplica (B9). Igual que la recalibración.
                ? html`
                    <p class="notice notice--warning">
                        <span class="notice__icon" aria-hidden="true">⚠</span>
                        <span>${t('volume.deloadOffer', {
                            reasons: plan.deload.reasons.map((/** @type {string} */ r) => t(r)).join(' ')
                        })}</span>
                    </p>
                `
                : ''}

            <ul class="profile-list">
                ${plan.groups.map((/** @type {*} */ g) => html`
                    <li class="profile-item">
                        <span class="food-row">
                            <span class="food-row__name">${t(`muscle.${g.group}`)}</span>
                            <span class="muted numeric">${t('volume.sets', {
                                sets: g.currentSets, mev: g.landmarks.mev, mav: g.landmarks.mav
                            })}</span>
                            <span class="muted">${t(`volume.action.${g.action}`, {
                                sets: g.targetSets, rir: g.rir
                            })}</span>
                        </span>
                        <span class="badge badge--zone-${g.zone}">${t(`volume.zone.${g.zone}`)}</span>
                    </li>
                `)}
            </ul>

            ${report.unknown.length > 0
                ? html`
                    <p class="notice">
                        <span class="notice__icon" aria-hidden="true">◌</span>
                        <span>${t('volume.unattributed', { n: report.unknown.length })}</span>
                    </p>
                `
                : ''}
            <p class="muted">${plan.recovery.declared
                ? t('volume.recovery', { score: Math.round(plan.recovery.score * 100) })
                : t('volume.recoveryUnknown')}</p>
        </section>
    `;
}

/**
 * Busca en el catálogo por nombre.
 *
 * El catálogo está en inglés («Barbell Squat») y el usuario escribe en
 * castellano, así que la coincidencia es por subcadena normalizada y se acepta
 * que no siempre encuentre. Traducir 556 nombres a mano es trabajo de otra
 * milestone; fingir una traducción automática daría nombres que nadie busca.
 * @param {Record<string, *>} catalog
 * @param {string} query
 * @param {number} limit
 * @returns {Array<*>}
 */
function matchExercises(catalog, query, limit) {
    const terms = String(query ?? '').toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return [];
    const hits = [];
    for (const ex of Object.values(catalog)) {
        const haystack = ex.name.toLowerCase();
        if (terms.every((term) => haystack.includes(term))) hits.push(ex);
        if (hits.length >= limit * 4) break;
    }
    return hits.sort((a, b) => a.name.length - b.name.length).slice(0, limit);
}

/** Los grupos que trabaja un ejercicio, ya traducidos. */
function muscleSummary(/** @type {*} */ ex) {
    return Object.entries(ex.muscles)
        .sort((a, b) => Number(b[1]) - Number(a[1]))
        .map(([group, weight]) => `${t(`muscle.${group}`)}${weight === 1 ? '' : '*'}`)
        .join(' · ');
}

/** Semanas distintas que abarcan las sesiones registradas. */
function weeksSpanned(/** @type {*[]} */ sessions) {
    if (sessions.length === 0) return 1;
    const fechas = sessions.map((s) => Date.parse(`${s.dateISO}T00:00:00Z`)).filter(Number.isFinite);
    if (fechas.length === 0) return 1;
    const dias = (Math.max(...fechas) - Math.min(...fechas)) / 86400000;
    return Math.max(1, Math.ceil((dias + 1) / 7));
}

/** Sesiones por semana, para repartir el volumen prescrito. */
function sessionsPerWeek(/** @type {*[]} */ sessions, /** @type {number} */ semanas) {
    return Math.max(1, Math.round(sessions.length / Math.max(1, semanas)));
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
        ${renderVolume(data, catalog)}
        ${renderSessions(data)}
    `);
}

/** @param {HTMLElement} container */
export async function mount(container) {
    draw(container);

    // Después del primer pintado: la rutina y los récords no dependen del
    // catálogo, y esperar 556 fichas para enseñarlos sería castigar al usuario.
    if (catalog === null) {
        const loaded = await exercisesDb.load();
        if (loaded.ok) catalog = loaded.value;
        else console.warn('[training] no se pudo cargar el catálogo:', loaded.error);
        draw(container);
    }

    on(container, 'click', '[data-add-exercise]', () => {
        const dialog = modal.open({
            titleKey: 'training.addExercise',
            body: html`
                <label class="field">
                    <span class="field__label">${t('training.exerciseName')}</span>
                    <input type="text" class="input" data-name autocomplete="off">
                </label>
                <!--
                    El enlace al catalogo es lo que permite atribuir las series a
                    un grupo muscular. Es OPCIONAL: quien quiera apuntar un
                    ejercicio suyo puede, y la vista de volumen lo declara como
                    no atribuible en vez de contarlo como cero.
                -->
                <div data-catalog-picker>
                    <p class="muted">${t('training.pickFromCatalog')}</p>
                    <ul class="profile-list" data-catalog-results></ul>
                </div>
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
        /**
         * El ejercicio del catálogo que el usuario haya elegido, si alguno.
         * @type {string | null}
         */
        let catalogId = null;

        // Buscar mientras se teclea el nombre. Los resultados van a su propio
        // contenedor: recrear el `<input>` en cada tecla pierde el foco y hace
        // imposible escribir.
        const nameInput = /** @type {HTMLInputElement | null} */ (dialog.querySelector('[data-name]'));
        const results = /** @type {HTMLElement | null} */ (dialog.querySelector('[data-catalog-results]'));
        nameInput?.addEventListener('input', () => {
            catalogId = null;
            if (results === null || catalog === null) return;
            const hits = matchExercises(catalog, nameInput.value, 6);
            render(results, html`${hits.map((ex) => html`
                <li class="profile-item">
                    <span class="food-row">
                        <span class="food-row__name">${ex.name}</span>
                        <span class="muted">${muscleSummary(ex)}</span>
                    </span>
                    <button type="button" class="btn btn--sm" data-pick="${ex.id}">
                        ${t('training.useThis')}
                    </button>
                </li>
            `)}`);
        });
        results?.addEventListener('click', (event) => {
            const button = /** @type {HTMLElement} */ (event.target).closest('[data-pick]');
            if (!button || catalog === null) return;
            catalogId = button.getAttribute('data-pick');
            const elegido = catalogId ? catalog[catalogId] : null;
            if (elegido && nameInput) nameInput.value = elegido.name;
            render(results, html`<li class="profile-item">
                <span>${t('training.picked', { name: elegido?.name ?? '' })}</span>
            </li>`);
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
                { name, sets, reps, catalogId }, { dayName: t('training.routine') });
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


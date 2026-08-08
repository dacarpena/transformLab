// @ts-check

/**
 * Vista de nutrición (E4a): macros del día derivadas del plan, reparto en
 * comidas y plantillas de comida propias del usuario.
 *
 * Las macros se etiquetan como lo que son —consecuencia del objetivo calórico
 * del plan— y la vista dice explícitamente que la proteína se calcula sobre la
 * masa magra, que es la corrección de fondo frente al legacy.
 */

import { html, render, on } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import { SCHEMA_VERSION, validateCollection, sanitizeText } from '../../data/schema.js';
import * as storage from '../../data/storage.js';
import * as plans from '../plan-state.js';
import { macrosFor, refeedMacros, splitIntoMeals } from '../../core/nutrition.js';
import * as modal from '../components/modal.js';
import * as toast from '../components/toast.js';
import { empty, error as errorState } from '../components/state.js';
import { int as num } from '../format.js';

let mealCount = 4;
let refeedToday = false;

/** Plantillas guardadas por el usuario. */
function readTemplates() {
    const stored = storage.get('nutrition');
    if (!stored.ok || stored.value === null) return [];
    const parsed = validateCollection('nutrition', stored.value);
    return parsed.ok ? parsed.value.mealTemplates : [];
}

/**
 * @param {Array<*>} templates
 * @returns {boolean}
 */
function writeTemplates(templates) {
    const record = { schemaVersion: SCHEMA_VERSION, mealTemplates: templates };
    const checked = validateCollection('nutrition', record);
    if (!checked.ok) return false;
    return storage.set('nutrition', checked.value).ok;
}

/** Tarjeta de macros del día. */
function renderMacros(/** @type {*} */ macros, /** @type {*} */ point) {
    return html`
        <section class="card" aria-labelledby="macros-title">
            <div class="card__header">
                <h2 id="macros-title" class="card__title">${t('nutrition.todayTitle')}</h2>
                <span class="badge badge--${point.phaseType}">${t(`phase.${point.phaseType}`)}</span>
            </div>

            <div class="metrics">
                <div class="metric">
                    <span class="metric__value">${num(macros.kcal)}</span>
                    <span class="metric__label">${t('nutrition.kcal')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${num(macros.proteinG)} <span class="muted">g</span></span>
                    <span class="metric__label">${t('nutrition.protein')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${num(macros.carbsG)} <span class="muted">g</span></span>
                    <span class="metric__label">${t('nutrition.carbs')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${num(macros.fatG)} <span class="muted">g</span></span>
                    <span class="metric__label">${t('nutrition.fat')}</span>
                </div>
            </div>

            <p class="muted">${t('nutrition.fromPlan')}</p>
            <p class="muted">${t('nutrition.proteinNote', { lean: point.leanKg.toFixed(1) })}</p>

            ${macros.warnings.map((/** @type {*} */ code) => html`
                <p class="notice notice--warning">
                    <span class="notice__icon" aria-hidden="true">⚠</span>
                    <span>${t(code)}</span>
                </p>
            `)}

            <label class="switch">
                <input type="checkbox" data-refeed ${refeedToday ? 'checked' : ''}>
                <span>${t('nutrition.refeedToggle')}</span>
            </label>
            <p class="muted">${t('nutrition.refeedHint')}</p>
            ${refeedToday && Number.isFinite(macros.costKg) && macros.costKg > 0 ? html`
                <p class="notice notice--warning">
                    <span class="notice__icon" aria-hidden="true">⚠</span>
                    <span>${t('nutrition.refeedCost', {
                        kcal: macros.costKcal ?? 0,
                        kg: (macros.costKg ?? 0).toFixed(2)
                    })}</span>
                </p>
            ` : ''}
        </section>
    `;
}

/** Reparto en comidas. */
function renderMeals(/** @type {*} */ macros) {
    const split = splitIntoMeals(macros, mealCount);
    if (!split.ok) return '';
    return html`
        <section class="card" aria-labelledby="meals-title">
            <h2 id="meals-title" class="card__title">${t('nutrition.mealsTitle')}</h2>
            <label class="range-row">
                <span>${t('nutrition.mealCount')}</span>
                <input type="range" min="1" max="8" step="1" value="${mealCount}" data-meal-count>
                <span class="numeric" data-meal-count-label>${mealCount}</span>
            </label>
            <ul class="profile-list">
                ${split.value.map((meal) => html`
                    <li class="profile-item">
                        <span>${t('nutrition.meal', { n: meal.index + 1 })}</span>
                        <span class="muted numeric">
                            ${num(meal.kcal)} kcal · ${num(meal.proteinG)} P · ${num(meal.carbsG)} C · ${num(meal.fatG)} G
                        </span>
                    </li>
                `)}
            </ul>
        </section>
    `;
}

/** Plantillas de comida del usuario (CRUD). */
function renderTemplates(/** @type {*} */ templates) {
    return html`
        <section class="card" aria-labelledby="templates-title">
            <div class="card__header">
                <h2 id="templates-title" class="card__title">${t('nutrition.templatesTitle')}</h2>
                <button type="button" class="btn btn--sm" data-new-template>${t('nutrition.newTemplate')}</button>
            </div>
            ${templates.length === 0
                ? empty({ icon: '🍽', titleKey: 'nutrition.templatesEmpty', bodyKey: 'nutrition.templatesEmptyBody' })
                : html`
                    <ul class="profile-list">
                        ${templates.map((/** @type {*} */ tpl) => html`
                            <li class="profile-item">
                                <span>
                                    <strong>${tpl.name}</strong>
                                    <span class="muted numeric"> · ${num(tpl.macros.kcal)} kcal · ${num(tpl.macros.proteinG)} P · ${num(tpl.macros.carbsG)} C · ${num(tpl.macros.fatG)} G</span>
                                </span>
                                <button type="button" class="btn btn--sm btn--danger" data-delete-template="${tpl.id}">
                                    ${t('action.delete')}
                                </button>
                            </li>
                        `)}
                    </ul>
                `}
        </section>
    `;
}

/** @param {HTMLElement} container */
function draw(container) {
    const data = plans.get();
    if (!data) {
        // Sin plan no es un ERROR, es un estado vacío. Con `errorState` esto
        // pintaba un `role="alert"` SIN ninguna salida, que es exactamente lo
        // que la cabecera de `state.js` declara prohibido (ficha H-013).
        render(container, empty({ icon: '🍽', titleKey: 'nutrition.title', bodyKey: 'nutrition.noPlan', actions: [] }));
        return;
    }
    const today = plans.todayIndex(data, plans.todayISO());
    const point = data.projection.daily[today.dayIndex];
    const base = macrosFor(point);
    if (!base.ok) {
        render(container, errorState({ titleKey: 'nutrition.title', bodyKey: 'error.viewBody' }));
        return;
    }
    const macros = refeedToday
        ? (refeedMacros(base.value, point).ok ? /** @type {*} */ (refeedMacros(base.value, point)).value : base.value)
        : base.value;

    render(container, html`
        <h1 class="card__title">${t('nutrition.title')}</h1>
        ${renderMacros(macros, point)}
        ${renderMeals(macros)}
        ${renderTemplates(readTemplates())}
    `);
}

/** @param {HTMLElement} container */
export function mount(container) {
    draw(container);

    on(container, 'change', '[data-refeed]', (_event, target) => {
        refeedToday = /** @type {HTMLInputElement} */ (target).checked;
        draw(container);
    });

    on(container, 'input', '[data-meal-count]', (_event, target) => {
        mealCount = Number(/** @type {HTMLInputElement} */ (target).value);
        draw(container);
    });

    on(container, 'click', '[data-new-template]', () => {
        const data = plans.get();
        if (!data) return;
        const today = plans.todayIndex(data, plans.todayISO());
        const base = macrosFor(data.projection.daily[today.dayIndex]);
        if (!base.ok) return;
        const suggested = splitIntoMeals(base.value, mealCount);
        const meal = suggested.ok ? suggested.value[0] : { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };

        const dialog = modal.open({
            titleKey: 'nutrition.newTemplate',
            body: html`
                <label class="field">
                    <span class="field__label">${t('nutrition.templateName')}</span>
                    <input type="text" class="input" data-name autocomplete="off">
                </label>
                <div class="field-grid">
                    ${[['kcal', 'nutrition.kcal', meal.kcal], ['proteinG', 'nutrition.protein', meal.proteinG],
                       ['carbsG', 'nutrition.carbs', meal.carbsG], ['fatG', 'nutrition.fat', meal.fatG]].map(([key, label, value]) => html`
                        <label class="field">
                            <span class="field__label">${t(String(label))}</span>
                            <input type="number" class="input" inputmode="numeric" data-macro="${key}" value="${value}">
                        </label>
                    `)}
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
                toast.error('nutrition.templateNameRequired');
                return;
            }
            /** @type {Record<string, number>} */ const macros = {};
            for (const input of dialog.querySelectorAll('[data-macro]')) {
                const key = input.getAttribute('data-macro');
                const value = Number(/** @type {HTMLInputElement} */ (input).value);
                if (key) macros[key] = Number.isFinite(value) ? Math.max(0, value) : 0;
            }
            const templates = readTemplates();
            // el id se deriva del número de plantillas, sin reloj ni azar
            const id = `meal_${templates.length + 1}_${name.slice(0, 12).replace(/[^A-Za-z0-9]/g, '')}`;
            const next = [...templates, {
                id, name,
                macros: { kcal: macros.kcal, proteinG: macros.proteinG, carbsG: macros.carbsG, fatG: macros.fatG },
                notes: null
            }];
            if (!writeTemplates(next)) {
                toast.error('error.generic');
                return;
            }
            modal.close();
            toast.success('nutrition.templateSaved');
            draw(container);
        });
    });

    on(container, 'click', '[data-delete-template]', (_event, target) => {
        const id = target.getAttribute('data-delete-template');
        if (!id) return;
        const next = readTemplates().filter((/** @type {*} */ tpl) => tpl.id !== id);
        if (!writeTemplates(next)) {
            toast.error('error.generic');
            return;
        }
        toast.success('nutrition.templateDeleted');
        draw(container);
    });
}

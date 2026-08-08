// @ts-check

/**
 * Vista «Gasto»: lo que dicen TUS datos frente a lo que dice la fórmula (V2-M1).
 *
 * Es la superficie del módulo de gasto adaptativo, y su regla de diseño es una:
 * **enseñar la aritmética, no un número**. MacroFactor hace este mismo cálculo y
 * no publica su filtro; aquí se ve la ingesta media, el cambio de la tendencia y
 * la equivalencia energética, de modo que el usuario pueda comprobar la cuenta o
 * discutirla. Un número sin su origen es una caja negra, y este proyecto no
 * vende cajas negras.
 *
 * Y cuando el gasto medido diverge de la fórmula, se OFRECE recalibrar (B9).
 * Nunca se toca el plan solo.
 */

import { html, render, on } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import * as plans from '../plan-state.js';
import * as checkins from '../../data/checkins.js';
import * as intakeLog from '../../data/intake-log.js';
import * as toast from '../components/toast.js';
import { empty, error as errorState } from '../components/state.js';
import { listDate } from '../dates.js';
import { num, int } from '../format.js';
import { measuredExpenditure, compareWithFormula, MIN_DAYS } from '../../core/expenditure.js';

/** El TDEE que el plan usa hoy, según la proyección. */
function formulaTdee(/** @type {*} */ data) {
    const today = plans.todayIndex(data, plans.todayISO());
    const point = data.projection.daily[today.dayIndex];
    return point?.kcal?.tdeeKcal ?? null;
}

/** Reúne lo que el módulo necesita: ingesta registrada y pesos reales. */
function gather() {
    return {
        intake: intakeLog.list().map((/** @type {*} */ e) => ({ dateISO: e.dateISO, kcal: e.kcal })),
        weights: checkins.list().map((/** @type {*} */ c) => ({ dateISO: c.dateISO, weightKg: c.weightKg }))
    };
}

/** Tarjeta del gasto medido, con la aritmética a la vista. */
function renderMeasured(/** @type {*} */ measured, /** @type {number|null} */ formulaKcal) {
    if (measured === null) {
        return empty({
            icon: '⚖',
            titleKey: 'expenditure.emptyTitle',
            bodyKey: 'expenditure.emptyBody',
            params: { days: MIN_DAYS },
            actions: [{ labelKey: 'expenditure.goToIntake', action: 'add-intake', primary: true }]
        });
    }
    const verdict = compareWithFormula(measured, formulaKcal ?? 0);
    return html`
        <section class="card" aria-labelledby="exp-title">
            <div class="card__header">
                <h2 id="exp-title" class="card__title">${t('expenditure.title')}</h2>
            </div>

            <div class="metrics">
                <div class="metric">
                    <span class="metric__value">${int(measured.tdeeKcal)}</span>
                    <span class="metric__label">${t('expenditure.measured')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${formulaKcal === null ? '—' : int(formulaKcal)}</span>
                    <span class="metric__label">${t('expenditure.formula')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${verdict.gapKcal === null ? '—' : int(verdict.gapKcal)}</span>
                    <span class="metric__label">${t('expenditure.gap')}</span>
                </div>
            </div>

            <!--
                LA CUENTA, A LA VISTA. Es lo que separa esto de una caja negra:
                el usuario puede rehacerla con una calculadora.
            -->
            <p class="muted">${t('expenditure.formulaExplained', {
                intake: int(measured.intakeMeanKcal),
                delta: num(measured.trendDeltaKg, 2),
                days: measured.days,
                result: int(measured.tdeeKcal)
            })}</p>
            <p class="muted">${t('expenditure.basedOn', { intakeDays: measured.intakeDays, days: measured.days })}</p>
            <p class="muted">${t('expenditure.trendRange', {
                start: num(measured.trend.startKg),
                end: num(measured.trend.endKg)
            })}</p>

            ${verdict.offer
                ? html`
                    <p class="notice notice--warning">
                        <span class="notice__icon" aria-hidden="true">⚠</span>
                        <span>${t(verdict.reason === 'higher'
                            ? 'expenditure.offerHigher'
                            : 'expenditure.offerLower', { gap: int(Math.abs(verdict.gapKcal ?? 0)) })}</span>
                    </p>
                    <div class="btn-row">
                        <button type="button" class="btn btn--primary" data-recalibrate>
                            ${t('expenditure.recalibrate')}
                        </button>
                    </div>
                `
                : html`<p class="muted">${t('expenditure.agrees')}</p>`}

            <p class="muted">${t('expenditure.disclaimer')}</p>
        </section>
    `;
}

/** Formulario para apuntar la ingesta de un día. */
function renderIntakeForm() {
    const hoy = plans.todayISO();
    const existing = intakeLog.findByDate(hoy);
    return html`
        <section class="card" aria-labelledby="intake-title">
            <div class="card__header">
                <h2 id="intake-title" class="card__title">${t('intake.title')}</h2>
            </div>
            <!--
                Etiqueta ENVOLVENTE, no for/id: es la convención del resto de las
                vistas (checkin.js, onboarding.js) y la única que reconoce el test
                de nombres accesibles, que solo mira el.closest('label').
                (Sin acentos graves aquí: dentro de una plantilla los CIERRAN.)
            -->
            <label class="field">
                <span class="field__label">${t('intake.date')}</span>
                <input class="input" type="date" data-field="dateISO" value="${hoy}">
            </label>
            <label class="field">
                <span class="field__label">${t('intake.kcal')}</span>
                <input class="input" type="number" inputmode="numeric" min="0" max="20000"
                       data-field="kcal" value="${existing ? String(existing.kcal) : ''}">
            </label>
            <div class="btn-row">
                <button type="button" class="btn btn--primary" data-save-intake>${t('action.save')}</button>
            </div>
            ${intakeLog.list().length > 0
                ? html`
                    <ul class="profile-list">
                        ${[...intakeLog.list()].reverse().slice(0, 14).map((/** @type {*} */ e) => html`
                            <li class="profile-item">
                                <span>${t('intake.entry', { date: listDate(e.dateISO), kcal: int(e.kcal) })}</span>
                                <button type="button" class="btn btn--sm" data-delete-intake="${e.dateISO}">
                                    ${t('action.delete')}
                                </button>
                            </li>
                        `)}
                    </ul>
                `
                : ''}
        </section>
    `;
}

/** @param {HTMLElement} container */
function draw(container) {
    const data = plans.get();
    if (data === null) {
        render(container, empty({
            icon: '⚖',
            titleKey: 'expenditure.noPlanTitle',
            bodyKey: 'expenditure.noPlanBody',
            actions: [{ labelKey: 'today.createPlan', action: 'go-onboarding', primary: true }]
        }));
        return;
    }
    try {
        const measured = measuredExpenditure(gather());
        // El contenedor `.view[data-view-id]` lo crea el ROUTER; la vista solo
        // pone su contenido. Envolverlo otra vez daba dos elementos con el
        // mismo id y los selectores de los E2E resolvían a dos.
        render(container, html`
            <h1 class="visually-hidden">${t('expenditure.title')}</h1>
            ${renderMeasured(measured, formulaTdee(data))}
            ${renderIntakeForm()}
        `);
    } catch (err) {
        console.error('[expenditure] no se pudo construir la vista', err);
        // Salida clara y NO destructiva (ficha H-013).
        render(container, errorState({ titleKey: 'error.viewTitle', bodyKey: 'error.viewBody' }));
    }
}

/** @param {HTMLElement} container */
export function mount(container) {
    draw(container);

    on(container, 'click', '[data-save-intake]', () => {
        const dateInput = /** @type {HTMLInputElement | null} */ (container.querySelector('[data-field="dateISO"]'));
        const kcalInput = /** @type {HTMLInputElement | null} */ (container.querySelector('[data-field="kcal"]'));
        const kcal = Number(kcalInput?.value);
        if (!Number.isFinite(kcal) || kcal <= 0) {
            toast.error('intake.kcalRequired');
            return;
        }
        const saved = intakeLog.save({ dateISO: dateInput?.value ?? plans.todayISO(), kcal });
        if (!saved.ok) {
            toast.error('error.generic');
            return;
        }
        toast.success('intake.saved');
        draw(container);
    });

    on(container, 'click', '[data-delete-intake]', (_event, target) => {
        const dateISO = target.getAttribute('data-delete-intake');
        if (!dateISO) return;
        if (!intakeLog.remove(dateISO).ok) {
            toast.error('error.generic');
            return;
        }
        draw(container);
    });

    on(container, 'click', '[data-recalibrate]', () => {
        // La oferta llega hasta aquí; APLICARLA es de V2-M10, cuando exista la
        // superficie única de recalibración que coordina las tres fuentes
        // (calorías, volumen y gasto). Ofrecer algo que luego no hace nada sería
        // la clase de promesa incumplida que M7-1 tuvo que ir a cerrar, así que
        // por ahora se dice con todas las letras.
        toast.success('expenditure.recalibrateComingSoon');
    });
}

export function unmount() {
    // Sin timers ni gráficas propias: nada que soltar.
}

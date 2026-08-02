// @ts-check

/**
 * Vista HOY (decisiones D1a y D2a). Responde a «¿dónde estoy hoy respecto al
 * plan?» antes que a ninguna otra cosa: el día es el día REAL calculado desde
 * la fecha de inicio, nunca un punto medio para que la demo quede bonita
 * (ficha H-035 del catálogo).
 *
 * Las cifras se etiquetan explícitamente como PROYECCIÓN, no como medición:
 * es la corrección de producto del defecto por el que el legacy presentaba
 * métricas sintéticas como datos del usuario.
 */

import { html, render, on } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import * as plans from '../plan-state.js';
import * as chart from '../chart.js';
import * as modal from '../components/modal.js';
import * as storage from '../../data/storage.js';
import * as checkins from '../../data/checkins.js';
import { evaluateSeries } from '../../core/tracking.js';
import * as toast from '../components/toast.js';
import { error as errorState } from '../components/state.js';

/** @type {'weight'|'fatPct'|'muscle'} */
let metric = 'weight';
let rangeTo = 0;
/** @type {(() => void) | null} */
let onEditProfile = null;
/** @type {(() => void) | null} */
let onGoToCheckin = null;

/** @param {number} value @param {number} digits */
function num(value, digits = 1) {
    return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

/**
 * Cabecera HOY.
 * @param {import('../plan-state.js').PlanBundle} data
 * @param {{ dayIndex: number, state: 'before'|'during'|'after' }} today
 */
function renderToday(data, today, evaluations) {
    const hasCheckins = evaluations.length > 0;
    const latest = hasCheckins ? evaluations[evaluations.length - 1] : null;
    const point = data.projection.daily[today.dayIndex];
    const total = data.plan.totalDays;
    const percent = total > 0 ? Math.round((today.dayIndex / total) * 100) : 0;
    const week = Math.floor(today.dayIndex / 7) + 1;
    const lastISO = data.projection.daily[total].dateISO;

    return html`
        <section class="card" aria-labelledby="today-title">
            <div class="today__head">
                <div>
                    <h1 id="today-title" class="card__title">${t('today.title')}</h1>
                    <p class="today__day">
                        ${today.state === 'before' ? t('today.notStarted', { date: data.startDateISO })
                          : today.state === 'after' ? t('today.finished', { date: lastISO })
                          : t('today.dayOf', { day: today.dayIndex, total, week })}
                    </p>
                </div>
                <span class="badge badge--${point.phaseType}">${t(`phase.${point.phaseType}`)}</span>
            </div>

            <div class="progress" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"
                 aria-label="${t('today.progress', { percent })}">
                <div class="progress__fill" style="--progress: ${percent / 100}"></div>
            </div>
            <p class="muted">${t('today.progress', { percent })}</p>

            <div class="metrics">
                <div class="metric">
                    <span class="metric__value">${num(point.weightKg)} <span class="muted">${t('today.unit.kg')}</span></span>
                    <span class="metric__label">${t('today.metric.weight')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${num(point.fatPct)} <span class="muted">${t('today.unit.pct')}</span></span>
                    <span class="metric__label">${t('today.metric.fatPct')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${num(point.muscleKg)} <span class="muted">${t('today.unit.kg')}</span></span>
                    <span class="metric__label">${t('today.metric.muscle')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${point.kcal.targetKcal} <span class="muted">${t('today.unit.kcal')}</span></span>
                    <span class="metric__label">${t('today.metric.kcal')}</span>
                </div>
            </div>

            ${latest ? html`
                <div class="card__header">
                    <span class="signal signal--${latest.signal}">${t(`deviation.${latest.signal}`)}</span>
                    <span class="muted numeric">${t('deviation.detail', {
                        actual: num(latest.actualKg),
                        expected: num(latest.expectedKg),
                        delta: `${latest.deltaKg >= 0 ? '+' : ''}${num(latest.deltaKg)}`,
                        tolerance: num(latest.toleranceKg)
                    })}</span>
                </div>
            ` : ''}

            <div class="projection-note">
                <span class="projection-note__tag">${t('today.projectionTag')}</span>
                <p>${latest ? t(`deviation.explain${latest.signal.charAt(0).toUpperCase()}${latest.signal.slice(1)}`) : t('today.projectionNote')}</p>
                <div class="btn-row">
                    <button type="button" class="btn btn--sm" data-go-checkin>
                        ${t(hasCheckins ? 'checkin.pendingAction' : 'today.firstCheckin')}
                    </button>
                </div>
            </div>
        </section>
    `;
}

/**
 * Tarjeta del plan: de dónde a dónde, y en qué fases.
 * @param {import('../plan-state.js').PlanBundle} data
 */
function renderPlan(data) {
    const { plan, composition } = data;
    const total = plan.totalDays;
    const warnings = plan.warnings ?? [];

    return html`
        <section class="card" aria-labelledby="plan-title">
            <h2 id="plan-title" class="card__title">${t('today.plan.title')}</h2>

            <div class="plan-summary">
                <div class="plan-summary__side">
                    <span class="plan-summary__weight">${num(composition.weightKg)} ${t('today.unit.kg')}</span>
                    <span class="muted">${num(composition.fatPct)} ${t('today.unit.pct')} · ${t('today.plan.muscleLabel', { value: num(composition.muscleKg) })}</span>
                    <span class="muted">${t('today.plan.start')}</span>
                </div>
                <span class="plan-summary__arrow" aria-hidden="true">→</span>
                <div class="plan-summary__side">
                    <span class="plan-summary__weight">${num(plan.summary.targetWeightKg)} ${t('today.unit.kg')}</span>
                    <span class="muted">${num(data.profile.target.fatPct)} ${t('today.unit.pct')} · ${t('today.plan.muscleLabel', { value: num(data.profile.target.muscleKg) })}</span>
                    <span class="muted">${t('today.plan.goal')}</span>
                </div>
            </div>

            <div class="phase-bar" role="img" aria-label="${plan.phases.map((p) => t('today.plan.phaseDays', { name: t(`phase.${p.type}`), days: p.days })).join('. ')}">
                ${plan.phases.map((p) => html`
                    <div class="phase-bar__segment"
                         style="flex-grow: ${p.days}; background: var(--color-phase-${p.type})"></div>
                `)}
            </div>
            <ul class="phase-legend">
                ${plan.phases.map((p) => html`
                    <li class="phase-legend__item">
                        <span class="phase-legend__dot" style="background: var(--color-phase-${p.type})"></span>
                        ${t('today.plan.phaseDays', { name: t(`phase.${p.type}`), days: p.days })}
                    </li>
                `)}
            </ul>

            ${warnings.map((w) => html`
                <p class="notice notice--warning">
                    <span class="notice__icon" aria-hidden="true">⚠</span>
                    <span>${t(`today.plan.${w.code.replace('plan.', '')}`) !== `today.plan.${w.code.replace('plan.', '')}`
                        ? t(`today.plan.${w.code.replace('plan.', '')}`)
                        : plans.issueText(w)}</span>
                </p>
            `)}
            <p class="muted">${t('today.plan.phaseDays', { name: t('onboarding.preview.duration'), days: total })}</p>
        </section>
    `;
}

/** Sección de la gráfica. */
function renderChartSection(data) {
    return html`
        <section class="card" aria-labelledby="chart-title">
            <div class="card__header">
                <h2 id="chart-title" class="card__title">${t('chart.title')}</h2>
                <div class="chart-toolbar">
                    ${(['weight', 'fatPct', 'muscle']).map((m) => html`
                        <button type="button" class="btn btn--sm ${m === metric ? 'btn--primary' : ''}" data-metric="${m}">
                            ${t(`chart.metric.${m}`)}
                        </button>
                    `)}
                    <button type="button" class="btn btn--sm" data-png>${t('action.downloadPng')}</button>
                </div>
            </div>

            <div class="chart-wrap" data-chart-host>
                <canvas data-canvas
                        role="img"
                        tabindex="0"
                        aria-label="${t('chart.title')}. ${t('chart.readoutHint')}"></canvas>
            </div>

            <p class="chart-readout" data-readout role="status" aria-live="polite"></p>
            <p class="muted">${t('chart.readoutHint')}</p>

            <label class="switch">
                <input type="checkbox" data-fluctuation ${data.fluctuation ? 'checked' : ''}>
                <span>${t('chart.fluctuation')}</span>
            </label>
            <p class="muted">${t('chart.fluctuationHint')}</p>

            <label class="range-row">
                <span>${t('chart.range')}</span>
                <input type="range" data-range min="7" max="${data.plan.totalDays}" value="${rangeTo}">
                <span class="numeric" data-range-label>${rangeTo}</span>
            </label>
        </section>
    `;
}

/** Redibuja solo la gráfica (cambio de métrica, rango o fluctuación). */
function redraw(container) {
    const data = plans.get();
    if (!data) return;
    const host = container.querySelector('[data-chart-host]');
    const canvas = /** @type {HTMLCanvasElement | null} */ (container.querySelector('[data-canvas]'));
    const readout = /** @type {HTMLElement | null} */ (container.querySelector('[data-readout]'));
    if (!host || !canvas || !readout) return;

    const today = plans.todayIndex(data, plans.todayISO());
    const evaluations = evaluateSeries(data.projection, checkins.list(), data.startDateISO);
    const ok = chart.draw({
        canvas,
        readout,
        projection: data.projection,
        metric,
        todayIndex: today.dayIndex,
        range: { from: 0, to: rangeTo },
        checkins: evaluations.map((e) => ({
            dayIndex: e.dayIndex,
            actualKg: e.actualKg,
            fatPct: checkins.findByDate(e.dateISO)?.fatPct ?? null,
            signal: e.signal
        })),
        onMilestone: (m) => {
            modal.open({
                titleKey: 'chart.milestoneModalTitle',
                size: 'sm',
                body: html`
                    <p>${chart.milestoneLabel(m)}</p>
                    <p class="muted">${t('chart.milestoneDay', { day: m.dayIndex, date: m.dateISO })}</p>
                `
            });
        }
    });
    if (!ok) chart.renderFallback(/** @type {HTMLElement} */ (host));
}

/**
 * Monta el dashboard.
 * @param {HTMLElement} container
 */
export function mount(container) {
    const data = plans.get();
    if (!data) {
        render(container, errorState({ titleKey: 'error.viewTitle', bodyKey: 'error.viewBody' }));
        return;
    }
    const today = plans.todayIndex(data, plans.todayISO());
    if (rangeTo === 0 || rangeTo > data.plan.totalDays) rangeTo = data.plan.totalDays;
    const evaluations = evaluateSeries(data.projection, checkins.list(), data.startDateISO);

    render(container, html`
        ${renderToday(data, today, evaluations)}
        ${renderPlan(data)}
        ${renderChartSection(data)}
    `);

    redraw(container);

    on(container, 'click', '[data-metric]', (_event, target) => {
        metric = /** @type {*} */ (target.getAttribute('data-metric'));
        for (const button of container.querySelectorAll('[data-metric]')) {
            button.classList.toggle('btn--primary', button.getAttribute('data-metric') === metric);
        }
        redraw(container);
    });

    on(container, 'change', '[data-fluctuation]', (_event, target) => {
        const enabled = /** @type {HTMLInputElement} */ (target).checked;
        plans.setFluctuation(enabled, storage.getActiveProfile());
        redraw(container);
    });

    on(container, 'input', '[data-range]', (_event, target) => {
        rangeTo = Number(/** @type {HTMLInputElement} */ (target).value);
        const label = container.querySelector('[data-range-label]');
        if (label) label.textContent = String(rangeTo);
        redraw(container);
    });

    on(container, 'click', '[data-png]', () => {
        const url = chart.toPng();
        if (!url) {
            toast.error('chart.unavailableTitle');
            return;
        }
        const link = document.createElement('a');
        link.href = url;
        link.download = 'transformlab.png';
        link.click();
    });

    // Recorrido de la serie con el teclado: la alternativa al canvas
    const canvas = container.querySelector('[data-canvas]');
    const readout = /** @type {HTMLElement | null} */ (container.querySelector('[data-readout]'));
    canvas?.addEventListener('keydown', (event) => {
        const current = plans.get();
        if (!current || !readout) return;
        const handled = chart.handleKey({
            readout,
            projection: current.projection,
            key: /** @type {KeyboardEvent} */ (event).key,
            range: { from: 0, to: rangeTo }
        });
        if (handled) event.preventDefault();
    });

    on(container, 'click', '[data-edit-profile]', () => {
        if (onEditProfile) onEditProfile();
    });

    on(container, 'click', '[data-go-checkin]', () => {
        if (onGoToCheckin) onGoToCheckin();
    });
}

/** @param {() => void} fn */
export function setOnGoToCheckin(fn) {
    onGoToCheckin = fn;
}

/** Limpia la gráfica al salir de la vista: sin esto, fuga de memoria. */
export function unmount() {
    chart.destroy();
}

/** @param {() => void} fn */
export function setOnEditProfile(fn) {
    onEditProfile = fn;
}


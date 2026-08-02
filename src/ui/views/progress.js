// @ts-check

/**
 * Vista Progreso (M4-3, M4-6): historial real frente al plan, desviación
 * acumulada, las cuatro métricas subjetivas como serie temporal y la
 * constancia (racha + calendario de adherencia).
 *
 * Todo lo que se muestra aquí son datos REALES del usuario. Es la vista que
 * el legacy no podía tener, porque sus métricas de bienestar eran sintéticas.
 */

import { html, render, on } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import { SUBJECTIVE_KEYS } from '../../data/schema.js';
import * as checkins from '../../data/checkins.js';
import * as plans from '../plan-state.js';
import { evaluateSeries, streakOf, adherenceCalendar } from '../../core/tracking.js';
import { empty } from '../components/state.js';

/** @type {(() => void) | null} */
let onGoToCheckin = null;

/** @param {number} n @param {number} d */
function num(n, d = 1) {
    return Number.isFinite(n) ? n.toFixed(d) : '—';
}

/** @param {number} n */
function signed(n) {
    if (!Number.isFinite(n)) return '—';
    return `${n >= 0 ? '+' : ''}${n.toFixed(1)}`;
}

/** Historial de check-ins con su señal de desviación. */
function renderHistory(evaluations) {
    return html`
        <section class="card">
            <h2 class="card__title">${t('checkin.history')}</h2>
            <ul class="profile-list">
                ${[...evaluations].reverse().map((e) => html`
                    <li class="profile-item">
                        <span>
                            <strong class="numeric">${num(e.actualKg)} ${t('today.unit.kg')}</strong>
                            <span class="muted"> · ${e.dateISO}</span>
                        </span>
                        <span>
                            <span class="signal signal--${e.signal}">${t(`deviation.${e.signal}`)}</span>
                            <span class="muted numeric"> ${signed(e.deltaKg)} ${t('today.unit.kg')}</span>
                        </span>
                    </li>
                `)}
            </ul>
        </section>
    `;
}

/** Desviación acumulada y último estado. */
function renderDeviation(evaluations) {
    const last = evaluations[evaluations.length - 1];
    const accumulated = evaluations.reduce((sum, e) => sum + e.deltaKg, 0) / evaluations.length;
    return html`
        <section class="card" aria-labelledby="dev-title">
            <div class="card__header">
                <h2 id="dev-title" class="card__title">${t('deviation.accumulated')}</h2>
                <span class="signal signal--${last.signal}">${t(`deviation.${last.signal}`)}</span>
            </div>
            <div class="metrics">
                <div class="metric">
                    <span class="metric__value">${signed(last.deltaKg)} <span class="muted">${t('today.unit.kg')}</span></span>
                    <span class="metric__label">${t('deviation.above') === '' ? '' : t('checkin.title')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${signed(accumulated)} <span class="muted">${t('today.unit.kg')}</span></span>
                    <span class="metric__label">${t('deviation.accumulated')}</span>
                </div>
            </div>
            <p class="muted">${t('deviation.detail', {
                actual: num(last.actualKg),
                expected: num(last.expectedKg),
                delta: signed(last.deltaKg),
                tolerance: num(last.toleranceKg)
            })}</p>
            <p class="secondary">${t(`deviation.explain${last.signal.charAt(0).toUpperCase()}${last.signal.slice(1)}`)}</p>
            <p class="muted">${t('deviation.toleranceNote')}</p>
        </section>
    `;
}

/** Series de las cuatro métricas subjetivas, como barras por check-in. */
function renderSubjective(items) {
    const withData = SUBJECTIVE_KEYS.filter((key) =>
        items.some((item) => item.subjective && item.subjective[key] !== undefined));
    if (withData.length === 0) return '';

    return html`
        <section class="card" aria-labelledby="subj-title">
            <h2 id="subj-title" class="card__title">${t('checkin.section.subjective')}</h2>
            ${withData.map((key) => {
                const values = items.map((item) => item.subjective?.[key] ?? null);
                const known = values.filter((v) => v !== null);
                const avg = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : NaN;
                return html`
                    <div class="subj-row">
                        <span class="field__label">${t(`checkin.subjective.${key}`)}</span>
                        <div class="subj-bars" role="img"
                             aria-label="${t('checkin.subjective.scale', { value: num(avg, 1) })}">
                            ${values.map((v) => html`
                                <span class="subj-bar" style="--level: ${v === null ? 0 : v / 10}"></span>
                            `)}
                        </div>
                        <span class="muted numeric">${num(avg, 1)}</span>
                    </div>
                `;
            })}
        </section>
    `;
}

/** Racha y calendario de adherencia (E9 a-b). */
function renderStreak(items, startDateISO) {
    const streak = streakOf(items, plans.todayISO(), startDateISO);
    const calendar = adherenceCalendar(items);
    return html`
        <section class="card" aria-labelledby="streak-title">
            <h2 id="streak-title" class="card__title">${t('streak.title')}</h2>
            <div class="metrics">
                <div class="metric">
                    <span class="metric__value">${streak.current}</span>
                    <span class="metric__label">${t('streak.current')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${streak.longest}</span>
                    <span class="metric__label">${t('streak.longest')}</span>
                </div>
            </div>
            <h3 class="card__title">${t('streak.calendar')}</h3>
            <ul class="calendar">
                ${calendar.map((day) => html`
                    <li class="calendar__cell"
                        style="--level: ${day.adherence === null ? 0 : day.adherence / 10}"
                        title="${day.dateISO}">
                        <span class="visually-hidden">
                            ${day.dateISO}: ${day.adherence === null
                                ? t('streak.noAdherence')
                                : t('checkin.subjective.scale', { value: day.adherence })}
                        </span>
                    </li>
                `)}
            </ul>
        </section>
    `;
}

/** @param {HTMLElement} container */
function draw(container) {
    const data = plans.get();
    const items = checkins.list();

    if (!data || items.length === 0) {
        render(container, html`
            <h1 class="card__title">${t('progress.title')}</h1>
            <section class="card">
                ${empty({
                    icon: '📈',
                    titleKey: 'progress.emptyTitle',
                    bodyKey: 'progress.emptyBody',
                    actions: [{ labelKey: 'checkin.pendingAction', action: 'go-checkin', primary: true }]
                })}
            </section>
        `);
        return;
    }

    const evaluations = evaluateSeries(data.projection, items, data.startDateISO);
    render(container, html`
        <h1 class="card__title">${t('progress.title')}</h1>
        ${evaluations.length > 0 ? renderDeviation(evaluations) : ''}
        ${renderStreak(items, data.startDateISO)}
        ${renderSubjective(items)}
        ${evaluations.length > 0 ? renderHistory(evaluations) : ''}
    `);
}

/** @param {HTMLElement} container */
export function mount(container) {
    draw(container);
    on(container, 'click', '[data-action="go-checkin"]', () => {
        if (onGoToCheckin) onGoToCheckin();
    });
}

/** @param {() => void} fn */
export function setOnGoToCheckin(fn) {
    onGoToCheckin = fn;
}

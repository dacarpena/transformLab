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
import { t, hasKey } from '../../i18n/i18n.js';
import * as plans from '../plan-state.js';
import { muscleUnitsOf } from '../muscle-units.js';
import * as chart from '../chart.js';
import { drawPlanChart } from '../plan-chart.js';
import * as checkins from '../../data/checkins.js';
import { evaluateSeries } from '../../core/tracking.js';
import { error as errorState } from '../components/state.js';
import { num } from '../format.js';

/** @type {(() => void) | null} */
let onGoToCheckin = null;
/** @type {(() => void) | null} */
let onGoToProjection = null;

/**
 * Cabecera HOY.
 * @param {import('../plan-state.js').PlanBundle} data
 * @param {{ dayIndex: number, state: 'before'|'during'|'after' }} today
 */
function renderToday(data, today, /** @type {*} */ evaluations) {
    const muscle = muscleUnitsOf(data);
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
                <div class="progress__fill" data-css-progress="${percent / 100}"></div>
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
                    <span class="metric__value">${num(muscle.toDisplay(point.muscleKg))} <span class="muted">${t('today.unit.kg')}</span></span>
                    <span class="metric__label">${muscle.isScale ? muscle.label() : t('today.metric.muscle')}</span>
                    ${muscle.isScale ? html`<span class="metric__note muted">${muscle.secondary(point.muscleKg)}</span>` : ''}
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
 * Texto de un aviso del plan en Hoy.
 *
 * Dos avisos (`plan.flooredBySafety`, `plan.alreadyAtTarget`) tienen aquí una
 * redacción más amable y larga que la genérica de `ranges.*`; el resto usan la
 * traducción común de `issueText`. La clave amable es `today.` + el código,
 * SIN el `.replace('plan.', '')` de antes: aquel replace no tocaba códigos como
 * `target.muscleLoss`, así que pedía `today.plan.target.muscleLoss` —clave
 * inexistente— y `t()` lo cantaba por consola en cada arranque, aunque la vista
 * cayera al fallback. `hasKey` decide sin sondear con `t()`, así que la consola
 * queda limpia.
 * @param {{ code: string, params?: Record<string, string | number> }} w
 * @returns {string}
 */
function warningText(w) {
    const friendly = `today.${w.code}`;
    return hasKey(friendly) ? t(friendly) : plans.issueText(w);
}

/**
 * Tarjeta del plan: de dónde a dónde, y en qué fases.
 * @param {import('../plan-state.js').PlanBundle} data
 */
function renderPlan(data) {
    const { plan, composition } = data;
    const total = plan.totalDays;
    const warnings = plan.warnings ?? [];
    // Los dos extremos de la tarjeta, en la unidad del usuario. El OBJETIVO se
    // muestra tal y como él lo escribió (`target.scaleMuscleKg`) siempre que
    // esté guardado: así, si una recalibración mueve la estimación interna, la
    // meta que se fijó sigue siendo la misma cifra en pantalla.
    //
    // Pero solo si CUADRA con la meta que persigue el motor. Ese campo puede
    // llegar de un backup importado, que es el vector hostil del producto, y
    // enseñarlo a ciegas dejaba que un fichero mintiera sobre el objetivo:
    // «99,0 kg de músculo» en pantalla mientras el plan iba a 60,0. Cuando no
    // cuadran gana la cifra que el motor realmente persigue, porque es la que
    // describe el plan que el usuario está viendo.
    const muscle = muscleUnitsOf(data);
    const derivedTarget = muscle.toDisplay(data.profile.target.muscleKg);
    const storedTarget = data.profile.target.scaleMuscleKg;
    const targetMuscleShown = muscle.isScale
        && Number.isFinite(storedTarget)
        && Math.abs(storedTarget - derivedTarget) < 0.1
        ? storedTarget
        : derivedTarget;

    return html`
        <section class="card" aria-labelledby="plan-title">
            <h2 id="plan-title" class="card__title">${t('today.plan.title')}</h2>

            <div class="plan-summary">
                <div class="plan-summary__side">
                    <span class="plan-summary__weight">${num(composition.weightKg)} ${t('today.unit.kg')}</span>
                    <span class="muted">${num(composition.fatPct)} ${t('today.unit.pct')} · ${t('today.plan.muscleLabel', { value: num(muscle.toDisplay(composition.muscleKg)) })}</span>
                    <span class="muted">${t('today.plan.start')}</span>
                </div>
                <span class="plan-summary__arrow" aria-hidden="true">→</span>
                <div class="plan-summary__side">
                    <span class="plan-summary__weight">${num(plan.summary.targetWeightKg)} ${t('today.unit.kg')}</span>
                    <span class="muted">${num(data.profile.target.fatPct)} ${t('today.unit.pct')} · ${t('today.plan.muscleLabel', { value: num(targetMuscleShown) })}</span>
                    <span class="muted">${t('today.plan.goal')}</span>
                </div>
            </div>

            <div class="phase-bar" role="img" aria-label="${plan.phases.map((p) => t('today.plan.phaseDays', { name: t(`phase.${p.type}`), days: p.days })).join('. ')}">
                ${plan.phases.map((p) => html`
                    <div class="phase-bar__segment is-phase-${p.type}" data-css-grow="${p.days}"></div>
                `)}
            </div>
            <ul class="phase-legend">
                ${plan.phases.map((p) => html`
                    <li class="phase-legend__item">
                        <span class="phase-legend__dot is-phase-${p.type}"></span>
                        ${t('today.plan.phaseDays', { name: t(`phase.${p.type}`), days: p.days })}
                    </li>
                `)}
            </ul>

            ${warnings.map((w) => html`
                <p class="notice notice--warning">
                    <span class="notice__icon" aria-hidden="true">⚠</span>
                    <span>${warningText(w)}</span>
                </p>
            `)}
            <p class="muted">${t('today.plan.phaseDays', { name: t('onboarding.preview.duration'), days: total })}</p>
        </section>
    `;
}

/** Sección de la gráfica. */
function renderChartSection(/** @type {*} */ data) {
    void data;
    // Compacta a propósito (E12): la gráfica de Hoy responde «¿qué pinta tiene
    // mi plan?» de un vistazo. Los controles —métrica, detalle, ventana,
    // fluctuación, PNG— viven en la vista Proyección, que es el instrumento.
    // Antes aquí se apilaban cinco bloques de texto gris compitiendo.
    return html`
        <section class="card" aria-labelledby="chart-title">
            <div class="card__header">
                <h2 id="chart-title" class="card__title">${t('chart.title')}</h2>
                <button type="button" class="btn btn--sm" data-go-projection>${t('today.seeProjection')}</button>
            </div>

            <div class="chart-wrap" data-chart-host>
                <canvas data-canvas
                        role="img"
                        tabindex="0"
                        aria-label="${t('chart.title')}. ${t('chart.readoutHint')}"></canvas>
            </div>

            <p class="chart-readout" data-readout role="status" aria-live="polite"></p>
        </section>
    `;
}

/**
 * Dibuja la gráfica compacta.
 *
 * Es asíncrona porque Chart.js se carga bajo demanda: sus 208 KB no pintan
 * nada de la primera pantalla y no tienen por qué retrasarla.
 *
 * Métrica fija (peso) y rango completo, y ambos son CONTRATO, no casualidad:
 * `smoke.spec.js` recorre la serie con `End` y espera aterrizar en el último
 * día del plan, y los tests de release cuentan píxeles de ESTE lienzo — el
 * primero del documento.
 */
async function redraw(/** @type {*} */ container) {
    // Métrica y rango los fija esta vista; el resto es común con Proyección y
    // vive en `plan-chart.js` desde M7-4, cuando las dos copias divergieron.
    await drawPlanChart(container, { metric: 'weight' });
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
    const evaluations = evaluateSeries(data.projection, checkins.list(), data.startDateISO);

    render(container, html`
        ${renderToday(data, today, evaluations)}
        ${renderPlan(data)}
        ${renderChartSection(data)}
    `);

    redraw(container);

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
            range: { from: 0, to: current.plan.totalDays }
        });
        if (handled) event.preventDefault();
    });

    on(container, 'click', '[data-go-projection]', () => {
        if (onGoToProjection) onGoToProjection();
    });

    on(container, 'click', '[data-go-checkin]', () => {
        if (onGoToCheckin) onGoToCheckin();
    });
}

/** @param {() => void} fn */
export function setOnGoToCheckin(fn) {
    onGoToCheckin = fn;
}

/** @param {() => void} fn */
export function setOnGoToProjection(fn) {
    onGoToProjection = fn;
}

/** Limpia la gráfica al salir de la vista: sin esto, fuga de memoria. */
export function unmount() {
    chart.destroy();
}


// @ts-check

/**
 * Vista Proyección (decisión E12).
 *
 * POR QUÉ EXISTE. La proyección recalibrable es lo que define este producto, y
 * hasta ahora vivía apretada al final de Hoy: una gráfica con el eje rotulado
 * en números de día, sin leyenda pese a dibujar cuatro cosas distintas, y con
 * cinco bloques de texto gris debajo. Aquí tiene el espacio que necesita.
 *
 * EL ORDEN DE LAS SECCIONES RESPONDE A PREGUNTAS, no a jerarquía de datos:
 *
 *   1. «¿Dónde acabo y cuándo?»  → el resumen, que es TEXTO
 *   2. «¿Cómo llego?»            → la curva
 *
 * Que la primera sea texto no es casual: sobrevive a que Chart.js no cargue, a
 * la tipografía al 200 %, a 320 px y a un lector de pantalla. Hoy toda la
 * historia vive dentro del `<canvas>`, que es el punto único de fallo que esta
 * vista elimina.
 *
 * LA VENTANA TEMPORAL ES ESTADO COMPARTIDO: un solo control gobierna el eje de
 * la gráfica y, cuando lleguen, la tabla y la línea de tiempo. Eso convierte
 * varias tarjetas sueltas en un instrumento.
 */

import { html, render, on } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import * as plans from '../plan-state.js';
import * as chart from '../chart.js';
import * as modal from '../components/modal.js';
import * as checkins from '../../data/checkins.js';
import { muscleUnitsOf } from '../muscle-units.js';
import { shortDate, longDate } from '../dates.js';
import { buildTimeline } from '../../core/timeline.js';
import { evaluateSeries } from '../../core/tracking.js';
import { empty, error as errorState } from '../components/state.js';

/** @typedef {'weight'|'fatPct'|'muscle'} Metric */
/** @typedef {'day'|'week'|'month'} Grain */
/** @typedef {'all'|'phase'|'90'|'30'} WindowPreset */

/**
 * Estado de la vista, a nivel de módulo como en el resto de vistas: sobrevive a
 * la navegación y se pierde al recargar, que es el comportamiento que ya tiene
 * el dashboard con su métrica y su rango.
 */
/** @type {Metric} */ let metric = 'weight';
/** @type {Grain} */ let grain = 'week';
/** @type {WindowPreset} */ let preset = 'all';

/** @param {number} value @param {number} digits */
function num(value, digits = 1) {
    return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

/**
 * El detalle que le corresponde a una ventana por su anchura.
 *
 * No es cosmética: con granularidad mensual los puntos están al final de cada
 * mes, así que una ventana de 30 días se quedaba **casi sin puntos que
 * dibujar** — una gráfica vacía sin ningún error. Y al revés, 378 puntos
 * diarios en 290 px de un móvil son tinta, no información.
 *
 * Se aplica al cambiar de periodo; después el usuario puede sobrescribirlo con
 * los botones de detalle, que es lo que hace que sea una ayuda y no una jaula.
 *
 * @param {number} spanDays
 * @returns {Grain}
 */
export function grainForSpan(spanDays) {
    if (spanDays <= 45) return 'day';
    if (spanDays <= 200) return 'week';
    return 'month';
}

/**
 * Los límites de la ventana visible, en índices de día.
 *
 * Guarda deliberada contra un `totalDays` que cambia bajo los pies: al
 * recalibrar, el plan se rehace y puede acortarse. Sin acotar aquí, la ventana
 * quedaría fuera de rango y la gráfica saldría vacía SIN dar error, que es
 * peor que fallar — es la misma protección que tiene el dashboard.
 *
 * @param {import('../plan-state.js').PlanBundle} data
 * @param {number} todayIndex
 * @returns {{ from: number, to: number }}
 */
export function windowBounds(data, todayIndex) {
    const total = data.plan.totalDays;
    const clamp = (/** @type {number} */ v) => Math.min(Math.max(Math.round(v), 0), total);

    if (preset === 'phase') {
        let start = 0;
        for (const phase of data.plan.phases) {
            if (todayIndex < start + phase.days) return { from: clamp(start), to: clamp(start + phase.days) };
            start += phase.days;
        }
        return { from: 0, to: total };
    }
    if (preset === '30' || preset === '90') {
        const half = Number(preset);
        return { from: clamp(todayIndex - half / 3), to: clamp(todayIndex + half) };
    }
    return { from: 0, to: total };
}

/** Cabecera: dónde acabas y cuándo. Es TEXTO, y por eso va primero. */
function renderSummary(data, today) {
    const muscle = muscleUnitsOf(data);
    const total = data.plan.totalDays;
    const daily = data.projection.daily;
    const percent = total > 0 ? Math.round((today.dayIndex / total) * 100) : 0;
    const start = daily[0];
    const now = daily[today.dayIndex];
    const goal = daily[total];

    /** Un lado del recorrido: inicio, hoy y objetivo. */
    const side = (point, labelKey) => html`
        <div class="plan-summary__side">
            <span class="plan-summary__weight">${num(point.weightKg)} ${t('today.unit.kg')}</span>
            <span class="muted">${num(point.fatPct)} ${t('today.unit.pct')} · ${t('today.plan.muscleLabel', {
                value: num(muscle.toDisplay(point.muscleKg))
            })}</span>
            <span class="muted">${t(labelKey)}</span>
        </div>
    `;

    return html`
        <section class="card" aria-labelledby="proj-summary">
            <div class="card__header">
                <h2 id="proj-summary" class="card__title">${t('projection.summary.title')}</h2>
                <span class="badge badge--${now.phaseType}">${t(`phase.${now.phaseType}`)}</span>
            </div>

            <div class="plan-summary">
                ${side(start, 'today.plan.start')}
                <span class="plan-summary__arrow" aria-hidden="true">→</span>
                ${side(now, 'projection.summary.now')}
                <span class="plan-summary__arrow" aria-hidden="true">→</span>
                ${side(goal, 'today.plan.goal')}
            </div>

            <div class="progress" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100"
                 aria-label="${t('today.progress', { percent })}">
                <div class="progress__fill" data-css-progress="${percent / 100}"></div>
            </div>
            <p class="muted">${today.state === 'before'
                ? t('today.notStarted', { date: longDate(data.startDateISO) })
                : today.state === 'after'
                ? t('today.finished', { date: longDate(daily[total].dateISO) })
                : t('projection.summary.dayOf', {
                    day: today.dayIndex, total, percent, date: longDate(daily[total].dateISO)
                })}</p>
        </section>
    `;
}

/**
 * Los próximos hitos, cada uno con su ventana de fechas.
 *
 * La ventana no dice «terminas antes o después»: los tres escenarios aterrizan
 * el mismo día. Dice cuándo cruzas ESTE umbral yendo más rápido o más lento, y
 * cuando los dos extremos caen demasiado cerca se imprime una sola fecha —
 * fingir precisión es lo que este producto no hace.
 */
function renderNext(data, today) {
    const muscle = muscleUnitsOf(data);
    const events = buildTimeline({
        projection: data.projection,
        plan: data.plan,
        todayIndex: today.dayIndex
    });
    const next = events
        .filter((e) => e.kind === 'threshold' && e.dayIndex > today.dayIndex)
        .slice(0, 4);

    if (next.length === 0) return '';

    return html`
        <section class="card" aria-labelledby="proj-next">
            <h2 id="proj-next" class="card__title">${t('projection.next.title')}</h2>
            <ul class="profile-list">
                ${next.map((e) => html`
                    <li class="profile-item">
                        <span>${chart.milestoneLabel(e.data.milestone, muscle)}</span>
                        <span class="muted numeric">${e.window && e.window.meaningful
                            ? t('projection.next.window', {
                                from: shortDate(e.window.fromISO), to: shortDate(e.window.toISO)
                            })
                            : t('projection.next.single', { date: shortDate(e.dateISO) })}</span>
                    </li>
                `)}
            </ul>
            <div class="projection-note">
                <span class="projection-note__tag">${t('today.projectionTag')}</span>
                <p>${t('projection.next.explain')}</p>
            </div>
        </section>
    `;
}

/** Un grupo de botones excluyentes. El estado vive en `aria-pressed`. */
function segmented(labelKey, attr, options, active) {
    return html`
        <div class="segmented" role="group" aria-label="${t(labelKey)}">
            ${options.map((o) => html`
                <button type="button" class="btn btn--sm" ${attr}="${o.value}"
                        aria-pressed="${o.value === active ? 'true' : 'false'}">${t(o.labelKey)}</button>
            `)}
        </div>
    `;
}

/** La curva, con sus tres controles excluyentes. */
function renderChart(data) {
    const muscle = muscleUnitsOf(data);
    return html`
        <section class="card" aria-labelledby="proj-chart">
            <h2 id="proj-chart" class="card__title">${t('projection.chart.title')}</h2>

            <div class="chart-toolbar">
                ${segmented('projection.metric.label', 'data-metric', [
                    { value: 'weight', labelKey: 'chart.metric.weight' },
                    { value: 'fatPct', labelKey: 'chart.metric.fatPct' },
                    { value: 'muscle', labelKey: muscle.isScale ? 'muscleUnits.label.scale' : 'chart.metric.muscle' }
                ], metric)}
                ${segmented('projection.grain.label', 'data-grain', [
                    { value: 'day', labelKey: 'projection.grain.day' },
                    { value: 'week', labelKey: 'projection.grain.week' },
                    { value: 'month', labelKey: 'projection.grain.month' }
                ], grain)}
            </div>
            <div class="chart-toolbar">
                ${segmented('projection.window.label', 'data-window', [
                    { value: 'all', labelKey: 'projection.window.all' },
                    { value: 'phase', labelKey: 'projection.window.phase' },
                    { value: '90', labelKey: 'projection.window.90' },
                    { value: '30', labelKey: 'projection.window.30' }
                ], preset)}
            </div>

            <div class="chart-wrap chart-wrap--tall" data-chart-host>
                <canvas data-canvas role="img" tabindex="0"
                        aria-label="${t('projection.chart.title')}. ${t('chart.readoutHint')}"></canvas>
            </div>
            <p class="chart-readout" data-readout role="status" aria-live="polite"></p>
        </section>
    `;
}

/** @param {HTMLElement} container */
function draw(container) {
    const data = plans.get();
    if (!data) {
        render(container, html`
            <h1 class="card__title">${t('projection.title')}</h1>
            <section class="card">
                ${empty({
                    icon: '📈',
                    titleKey: 'projection.empty.title',
                    bodyKey: 'projection.empty.body',
                    actions: []
                })}
            </section>
        `);
        return;
    }
    const today = plans.todayIndex(data, plans.todayISO());
    render(container, html`
        <h1 class="card__title">${t('projection.title')}</h1>
        ${renderSummary(data, today)}
        ${renderNext(data, today)}
        ${renderChart(data)}
    `);
    void redraw(container);
}

/** Redibuja el lienzo. Asíncrona porque Chart.js se carga bajo demanda. */
async function redraw(container) {
    const data = plans.get();
    if (!data) return;
    const host = container.querySelector('[data-chart-host]');
    const canvas = /** @type {HTMLCanvasElement | null} */ (container.querySelector('[data-canvas]'));
    const readout = /** @type {HTMLElement | null} */ (container.querySelector('[data-readout]'));
    if (!host || !canvas || !readout) return;

    if (!await chart.ensureLoaded()) {
        chart.renderFallback(/** @type {HTMLElement} */ (host));
        return;
    }
    // el usuario pudo cambiar de vista mientras llegaba el vendor
    if (!container.isConnected) return;

    const today = plans.todayIndex(data, plans.todayISO());
    const evaluations = evaluateSeries(data.projection, checkins.list(), data.startDateISO);
    const ok = chart.draw({
        canvas,
        readout,
        projection: data.projection,
        metric,
        grain,
        muscle: muscleUnitsOf(data),
        todayIndex: today.dayIndex,
        range: windowBounds(data, today.dayIndex),
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
                    <p>${chart.milestoneLabel(m, muscleUnitsOf(data))}</p>
                    <p class="muted">${t('chart.milestoneDay', { day: m.dayIndex, date: longDate(m.dateISO) })}</p>
                `
            });
        }
    });
    if (!ok) chart.renderFallback(/** @type {HTMLElement} */ (host));
}

/**
 * Refresca solo el estado de un grupo de botones, sin volver a pintar la vista.
 * Reconstruir el HTML entero perdería el foco del usuario a cada pulsación.
 */
function refreshPressed(container, attr, active) {
    for (const btn of container.querySelectorAll(`[${attr}]`)) {
        btn.setAttribute('aria-pressed', btn.getAttribute(attr) === active ? 'true' : 'false');
    }
}

/** @param {HTMLElement} container */
export function mount(container) {
    const data = plans.get();
    if (data === null) {
        draw(container);
        return;
    }
    if (!data.plan || !Array.isArray(data.projection?.daily)) {
        render(container, errorState({ titleKey: 'error.viewTitle', bodyKey: 'error.viewBody' }));
        return;
    }
    draw(container);

    on(container, 'click', '[data-metric]', (_event, target) => {
        metric = /** @type {Metric} */ (target.getAttribute('data-metric'));
        refreshPressed(container, 'data-metric', metric);
        void redraw(container);
    });

    on(container, 'click', '[data-grain]', (_event, target) => {
        grain = /** @type {Grain} */ (target.getAttribute('data-grain'));
        refreshPressed(container, 'data-grain', grain);
        void redraw(container);
    });

    on(container, 'click', '[data-window]', (_event, target) => {
        preset = /** @type {WindowPreset} */ (target.getAttribute('data-window'));
        refreshPressed(container, 'data-window', preset);
        const current = plans.get();
        if (!current) return;
        const today = plans.todayIndex(current, plans.todayISO());
        const bounds = windowBounds(current, today.dayIndex);

        // El detalle se adapta al periodo: con granularidad mensual una ventana
        // de un mes se queda casi sin puntos, y la gráfica saldría vacía sin
        // dar ningún error. Si cambia, hay que rehacer la serie; si no, basta
        // mover los dos números de la escala y no se reconstruye nada (E12-2).
        const wanted = grainForSpan(bounds.to - bounds.from);
        if (wanted !== grain) {
            grain = wanted;
            refreshPressed(container, 'data-grain', grain);
            void redraw(container);
            return;
        }
        if (!chart.setWindow(bounds.from, bounds.to)) void redraw(container);
    });

    const canvas = container.querySelector('[data-canvas]');
    const readout = /** @type {HTMLElement | null} */ (container.querySelector('[data-readout]'));
    canvas?.addEventListener('keydown', (event) => {
        const current = plans.get();
        if (!current || !readout) return;
        const today = plans.todayIndex(current, plans.todayISO());
        const handled = chart.handleKey({
            readout,
            projection: current.projection,
            key: /** @type {KeyboardEvent} */ (event).key,
            range: windowBounds(current, today.dayIndex)
        });
        if (handled) event.preventDefault();
    });
}

/** Sin esto, cambiar de vista deja la gráfica colgada consumiendo memoria. */
export function unmount() {
    chart.destroy();
}

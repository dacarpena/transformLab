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

import { html, raw, render, on } from '../dom.js';
import { t, getLocale } from '../../i18n/i18n.js';
import * as plans from '../plan-state.js';
import * as chart from '../chart.js';
import * as modal from '../components/modal.js';
import * as toast from '../components/toast.js';
import * as checkins from '../../data/checkins.js';
import * as storage from '../../data/storage.js';
import { muscleUnitsOf } from '../muscle-units.js';
import { shortDate, longDate } from '../dates.js';
import { buildTimeline, groupByPhase } from '../../core/timeline.js';
import { aestheticMilestonesFor, textOf } from '../../core/milestones.js';
import { evaluateSeries } from '../../core/tracking.js';
import { empty, error as errorState } from '../components/state.js';

/** @typedef {'weight'|'fatPct'|'muscle'|'kcal'} Metric */
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
/** La línea de tiempo empieza acotada; «mostrar más» la abre entera. */
let showAllEvents = false;

/**
 * Tope de eventos renderizados de entrada. Un plan largo produce más de cien
 * momentos, y una lista así no es una historia, es un muro. El recorte se
 * anuncia con su contador — nunca en silencio.
 */
const EVENT_LIMIT = 25;

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
                    { value: 'muscle', labelKey: muscle.isScale ? 'muscleUnits.label.scale' : 'chart.metric.muscle' },
                    { value: 'kcal', labelKey: 'chart.metric.kcal' }
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
                <button type="button" class="btn btn--sm" data-png>${t('action.downloadPng')}</button>
            </div>

            <div class="chart-wrap chart-wrap--tall" data-chart-host>
                <canvas data-canvas role="img" tabindex="0"
                        aria-label="${t('projection.chart.title')}. ${t('chart.readoutHint')}"></canvas>
            </div>
            <!-- La leyenda vive en DOM, no en el lienzo: así usa tokens, la lee
                 un lector de pantalla y refluye a 320 px. El lienzo dibujaba
                 hasta cuatro cosas distintas sin decir cuál era cuál. -->
            <ul class="phase-legend" data-legend aria-label="${t('projection.legend.label')}"></ul>
            <p class="chart-readout" data-readout role="status" aria-live="polite"></p>

            <label class="switch">
                <input type="checkbox" data-fluctuation aria-describedby="fluct-hint"
                       ${data.fluctuation ? raw('checked') : ''}>
                <span>${t('chart.fluctuation')}</span>
            </label>
            <p class="field__hint" id="fluct-hint">${t('chart.fluctuationHint')}</p>
        </section>
    `;
}

/**
 * Qué hay dibujado ahora mismo en el lienzo. Se regenera con cada dibujado
 * desde el mismo estado que decide los datasets: si divergieran, la leyenda
 * describiría otra gráfica.
 * @param {boolean} hasCheckins
 * @param {import('../muscle-units.js').MuscleUnits} muscle
 */
function renderLegend(hasCheckins, muscle) {
    /** @type {Array<{ dot: string, label: string }>} */
    const items = [];
    if (metric === 'kcal') {
        items.push({ dot: 'dot--accent', label: t('chart.kcalTarget') });
        items.push({ dot: 'dot--warning', label: t('chart.kcalTdee') });
        items.push({ dot: 'dot--band', label: t('projection.legend.deficit') });
    } else {
        items.push({ dot: 'dot--accent', label: t('chart.expected') });
        if (metric === 'weight') items.push({ dot: 'dot--band', label: t('chart.band') });
        if (hasCheckins && metric !== 'muscle') items.push({ dot: 'dot--real', label: t('checkin.title') });
        items.push({ dot: 'dot--warning', label: t('chart.milestoneModalTitle') });
    }
    return html`${items.map((i) => html`
        <li class="phase-legend__item"><span class="phase-legend__dot ${i.dot}" aria-hidden="true"></span>${i.label}</li>
    `)}`;
}

/**
 * Calorías, TDEE y adaptación: el material que el motor calculaba día a día
 * desde M1 y del que la interfaz solo enseñaba un número suelto.
 * @param {import('../plan-state.js').PlanBundle} data
 * @param {{ dayIndex: number }} today
 */
function renderKcal(data, today) {
    const daily = data.projection.daily;
    const now = daily[today.dayIndex].kcal;
    const startTdee = daily[0].kcal.tdeeKcal;

    /** @param {*} k */
    const balance = (k) => {
        const d = Math.round(k?.deficitKcal ?? NaN);
        if (!Number.isFinite(d)) return '—';
        if (d >= 1) return t('projection.kcal.rowDeficit', { value: d });
        if (d <= -1) return t('projection.kcal.rowSurplus', { value: -d });
        return t('projection.kcal.rowEven');
    };
    const todayBalance = Math.round(now.deficitKcal);
    const anyFloored = data.plan.phases.some((p) => p.nominalKcal?.flooredBySafety);

    return html`
        <section class="card" aria-labelledby="proj-kcal">
            <h2 id="proj-kcal" class="card__title">${t('projection.kcal.title')}</h2>
            <div class="metrics">
                <div class="metric">
                    <span class="metric__value">${now.targetKcal} <span class="muted">${t('today.unit.kcal')}</span></span>
                    <span class="metric__label">${t('projection.kcal.targetToday')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${now.tdeeKcal} <span class="muted">${t('today.unit.kcal')}</span></span>
                    <span class="metric__label">${t('projection.kcal.tdeeToday')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${todayBalance >= 1 ? '−' : todayBalance <= -1 ? '+' : '±'}${Math.abs(todayBalance)} <span class="muted">${t('today.unit.kcal')}</span></span>
                    <span class="metric__label">${t('projection.kcal.balanceToday')}</span>
                </div>
            </div>
            <p class="secondary">${t('projection.kcal.note', { start: startTdee })}</p>

            <ul class="profile-list">
                ${data.plan.phases.map((p) => html`
                    <li class="profile-item">
                        <span>
                            <span class="badge badge--${p.type}">${t(`phase.${p.type}`)}</span>
                            <span class="muted">${t('projection.days', { days: p.days })}</span>
                        </span>
                        <span class="muted numeric">${p.nominalKcal
                            ? t('projection.kcal.phaseNumbers', {
                                target: p.nominalKcal.targetKcal,
                                balance: balance(p.nominalKcal),
                                tdee: p.nominalKcal.tdeeKcal
                            })
                            : '—'}</span>
                    </li>
                `)}
            </ul>
            ${anyFloored ? html`
                <p class="notice notice--warning">
                    <span class="notice__icon" aria-hidden="true">⚠</span>
                    <span>${t('today.plan.flooredBySafety')}</span>
                </p>
            ` : ''}
            <div class="btn-row">
                <button type="button" class="btn btn--sm" data-show-kcal>${t('projection.kcal.showInChart')}</button>
            </div>
        </section>
    `;
}

/**
 * Funde los cambios visibles que caen el mismo día en una sola entrada.
 * El catálogo tiene 97 fichas y varias maduran a la vez: sin esto, un día
 * bueno se convierte en seis filas casi idénticas.
 * @param {import('../../core/timeline.js').TimelineEvent[]} events
 */
function mergeAesthetic(events) {
    /** @type {Array<*>} */
    const out = [];
    for (const e of events) {
        const prev = out[out.length - 1];
        if (e.kind === 'aesthetic' && prev?.kind === 'aesthetic' && prev.dayIndex === e.dayIndex) {
            prev.data.items.push(e.data.item);
        } else if (e.kind === 'aesthetic') {
            out.push({ ...e, data: { items: [e.data.item] } });
        } else {
            out.push(e);
        }
    }
    return out;
}

/**
 * El contenido de una fila de la línea de tiempo, según su tipo.
 * Los umbrales usan `milestoneLabel()` tal cual: un segundo camino de
 * etiquetado es literalmente el defecto HIT-* del legacy.
 * @param {*} e
 * @param {import('../muscle-units.js').MuscleUnits} muscle
 */
function eventContent(e, muscle) {
    if (e.kind === 'planStart') {
        return html`<strong>${t('projection.timeline.planStart', {
            weight: num(e.data.weightKg), fat: num(e.data.fatPct)
        })}</strong>`;
    }
    if (e.kind === 'planEnd') {
        return html`<strong>${t('projection.timeline.planEnd', {
            weight: num(e.data.weightKg), fat: num(e.data.fatPct)
        })}</strong>`;
    }
    if (e.kind === 'phaseStart') {
        const delta = e.data.kcalDelta;
        return html`
            <span class="badge badge--${e.data.phaseType}">${t(`phase.${e.data.phaseType}`)}</span>
            <strong>${t('projection.timeline.phaseKcal', { kcal: e.data.targetKcal ?? '—' })}</strong>
            ${Number.isFinite(delta) && Math.abs(delta) >= 1 ? html`<span class="muted">${delta > 0
                ? t('projection.timeline.kcalUp', { delta: Math.round(delta) })
                : t('projection.timeline.kcalDown', { delta: Math.round(-delta) })}</span>` : ''}
        `;
    }
    if (e.kind === 'threshold') {
        return html`
            <strong>${chart.milestoneLabel(e.data.milestone, muscle)}</strong>
            <span class="muted">${e.window && e.window.meaningful
                ? t('projection.next.window', { from: shortDate(e.window.fromISO), to: shortDate(e.window.toISO) })
                : ''}</span>
        `;
    }
    if (e.kind === 'aesthetic') {
        const items = e.data.items;
        const first = items[0];
        return html`
            <strong>${textOf(first.title, getLocale())}</strong>
            <span class="badge badge--maintenance">${t(`milestones.visibility.${first.visibility}`)}</span>
            ${items.length > 1 ? html`<span class="muted">${t('projection.timeline.moreSameDay', { count: items.length - 1 })}</span>` : ''}
        `;
    }
    if (e.kind === 'checkin') {
        return html`
            <strong>${t('projection.timeline.checkin', { weight: num(e.data.actualKg) })}</strong>
            <span class="signal signal--${e.data.signal}">${t(`deviation.${e.data.signal}`)}</span>
        `;
    }
    if (e.kind === 'recalibration') {
        return html`<strong>${t('projection.timeline.recalibrated')}</strong>`;
    }
    return html`<strong>${e.id}</strong>`;
}

/**
 * La historia del proceso: qué pasa, cuándo y en qué orden — el añadido que
 * pidió el usuario, con sus palabras: «ubicar los cambios en todos los
 * aspectos durante el proceso a modo de hitos».
 *
 * Agrupada por FASE y no por mes: la fase es lo que cambia las calorías y lo
 * que hace el cuerpo, y da un puñado de grupos en vez de un calendario. Lo
 * pasado va plegado; la ventana temporal de la gráfica filtra qué se ve.
 *
 * @param {import('../plan-state.js').PlanBundle} data
 * @param {{ dayIndex: number }} today
 */
function renderTimeline(data, today) {
    const muscle = muscleUnitsOf(data);
    const daily = data.projection.daily;
    const stored = storage.get('plan');
    const history = stored.ok && stored.value ? (/** @type {*} */ (stored.value).history ?? []) : [];
    const aesthetic = aestheticMilestonesFor(
        data.projection,
        { startMuscleKg: data.composition.muscleKg },
        today.dayIndex
    );
    const events = buildTimeline({
        projection: data.projection,
        plan: data.plan,
        todayIndex: today.dayIndex,
        aesthetic,
        checkins: evaluateSeries(data.projection, checkins.list(), data.startDateISO),
        history
    });
    const dateAt = (/** @type {number} */ d) =>
        daily[Math.min(Math.max(Math.round(d), 0), daily.length - 1)]?.dateISO ?? '';

    // La ventana de la gráfica también gobierna la historia: un solo control,
    // un solo estado. Con «Todo», el pasado previo al plan también entra.
    const bounds = windowBounds(data, today.dayIndex);
    const fullWindow = bounds.from === 0 && bounds.to === data.plan.totalDays;
    const visible = events.filter((e) => e.beforePlan
        ? fullWindow
        : e.dayIndex >= bounds.from && e.dayIndex <= bounds.to);

    let groups = groupByPhase(visible, data.plan, today.dayIndex, dateAt)
        .map((g) => ({ ...g, events: mergeAesthetic(g.events) }));

    // El tope se aplica sobre el total y se ANUNCIA: recortar en silencio
    // haría parecer completa una historia que no lo es.
    const total = groups.reduce((n, g) => n + g.events.length, 0);
    let remaining = showAllEvents ? Infinity : EVENT_LIMIT;
    if (!showAllEvents && total > EVENT_LIMIT) {
        groups = groups.map((g) => {
            const take = Math.max(0, remaining);
            remaining -= g.events.length;
            return { ...g, events: g.events.slice(0, take) };
        }).filter((g) => g.events.length > 0);
    }
    const shown = groups.reduce((n, g) => n + g.events.length, 0);

    /** @param {*} g */
    const groupRow = (g) => html`
        <li class="timeline__phase">
            <details ${g.past ? '' : raw('open')}>
                <summary class="timeline__summary">
                    ${g.phaseType === 'beforePlan'
                        ? html`<strong>${t('projection.timeline.before')}</strong>`
                        : html`<span class="badge badge--${g.phaseType}">${t(`phase.${g.phaseType}`)}</span>`}
                    <span class="muted">${g.phaseType === 'beforePlan'
                        ? ''
                        : `${shortDate(g.startISO)} – ${shortDate(g.endISO)}`}</span>
                </summary>
                <ol class="timeline__events">
                    ${g.events.map((e) => {
                        const inner = html`
                            <span class="timeline__dot ${e.kind === 'aesthetic' ? 'timeline__dot--hollow' : (e.phaseType ? `is-phase-${e.phaseType}` : '')}" aria-hidden="true"></span>
                            <span class="timeline__when numeric">${e.beforePlan ? shortDate(e.dateISO) : shortDate(e.dateISO)}</span>
                            <span class="timeline__what">${eventContent(e, muscle)}</span>
                        `;
                        const marker = g.current && e.dayIndex > today.dayIndex && !g.events.slice(0, g.events.indexOf(e)).some((p) => p.dayIndex > today.dayIndex)
                            ? html`<li class="timeline__now" aria-hidden="true">${t('chart.today')}</li>` : '';
                        return html`${marker}<li>
                            ${e.beforePlan
                                ? html`<div class="timeline__event timeline__event--static">${inner}</div>`
                                : html`<button type="button" class="timeline__event ${e.past ? 'timeline__event--past' : ''}"
                                        data-focus-day="${e.dayIndex}">${inner}</button>`}
                        </li>`;
                    })}
                </ol>
            </details>
        </li>
    `;

    return html`
        <section class="card" aria-labelledby="proj-timeline">
            <div class="card__header">
                <h2 id="proj-timeline" class="card__title">${t('projection.timeline.title')}</h2>
                <span class="muted">${t('projection.timeline.count', { shown, total })}</span>
            </div>
            <ol class="timeline">
                ${groups.map(groupRow)}
            </ol>
            ${shown < total ? html`
                <div class="btn-row">
                    <button type="button" class="btn btn--sm" data-show-all-events>
                        ${t('projection.timeline.showMore', { count: total - shown })}
                    </button>
                </div>
            ` : ''}
            <p class="muted">${t('milestones.notPromised')}</p>
        </section>
    `;
}

/** Marca la fila más cercana al cursor de la gráfica, sin mover el foco. */
function markTimelineRow(container, day) {
    /** @type {Element | null} */ let best = null;
    let bestDist = Infinity;
    for (const btn of container.querySelectorAll('[data-focus-day]')) {
        const d = Math.abs(Number(btn.getAttribute('data-focus-day')) - day);
        if (d < bestDist) { bestDist = d; best = btn; }
    }
    for (const btn of container.querySelectorAll('[data-focus-day]')) btn.removeAttribute('aria-current');
    best?.setAttribute('aria-current', 'true');
}

/** Repinta SOLO la línea de tiempo (cambio de ventana, «mostrar más»). */
function redrawTimeline(container) {
    const data = plans.get();
    const host = container.querySelector('[data-timeline-host]');
    if (!data || !host) return;
    const today = plans.todayIndex(data, plans.todayISO());
    render(/** @type {HTMLElement} */ (host), renderTimeline(data, today));
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
        <div data-timeline-host>${renderTimeline(data, today)}</div>
        ${renderKcal(data, today)}
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
    if (!ok) {
        chart.renderFallback(/** @type {HTMLElement} */ (host));
        return;
    }
    const legendHost = container.querySelector('[data-legend]');
    if (legendHost) {
        render(/** @type {HTMLElement} */ (legendHost), renderLegend(evaluations.length > 0, muscleUnitsOf(data)));
    }
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
        } else if (!chart.setWindow(bounds.from, bounds.to)) {
            void redraw(container);
        }
        // la ventana también gobierna qué momentos muestra la historia
        redrawTimeline(container);
    });

    on(container, 'click', '[data-show-all-events]', () => {
        showAllEvents = true;
        redrawTimeline(container);
    });

    on(container, 'click', '[data-focus-day]', (_event, target) => {
        const current = plans.get();
        const readout = /** @type {HTMLElement | null} */ (container.querySelector('[data-readout]'));
        const host = container.querySelector('[data-chart-host]');
        if (!current || !readout) return;
        const day = Number(target.getAttribute('data-focus-day'));
        const today = plans.todayIndex(current, plans.todayISO());
        let bounds = windowBounds(current, today.dayIndex);

        // Si el momento cae fuera de la ventana, la ventana se ensancha ANTES
        // de enfocar: mover el cursor a un día invisible no enseñaría nada.
        if (day < bounds.from || day > bounds.to) {
            preset = 'all';
            refreshPressed(container, 'data-window', preset);
            bounds = windowBounds(current, today.dayIndex);
            chart.setWindow(bounds.from, bounds.to);
        }
        chart.focusDay(readout, current.projection, day, bounds);
        markTimelineRow(container, day);
        host?.scrollIntoView({
            block: 'nearest',
            behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
        });
    });

    on(container, 'change', '[data-fluctuation]', (_event, target) => {
        plans.setFluctuation(/** @type {HTMLInputElement} */ (target).checked, storage.getActiveProfile());
        void redraw(container);
    });

    on(container, 'click', '[data-png]', () => {
        const url = chart.toPng();
        if (!url) {
            toast.error('chart.unavailableTitle');
            return;
        }
        const link = document.createElement('a');
        link.href = url;
        // Con la métrica y el día: un fichero que se llama igual para todo
        // no se distingue en la carpeta de descargas.
        link.download = `transformlab-${metric}-${plans.todayISO()}.png`;
        link.click();
    });

    on(container, 'click', '[data-show-kcal]', () => {
        metric = 'kcal';
        refreshPressed(container, 'data-metric', metric);
        void redraw(container);
        container.querySelector('[data-chart-host]')?.scrollIntoView({
            block: 'nearest',
            behavior: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
        });
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
        if (handled) {
            event.preventDefault();
            // La fila más cercana se marca, pero SIN scroll automático: con
            // las flechas sería un salto por pulsación, y bajo movimiento
            // reducido, directamente hostil.
            markTimelineRow(container, chart.cursorIndex());
        }
    });
}

/** Sin esto, cambiar de vista deja la gráfica colgada consumiendo memoria. */
export function unmount() {
    chart.destroy();
}

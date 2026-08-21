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
import { renderPlanSummary } from '../plan-summary.js';
import { evaluateSeries } from '../../core/tracking.js';
import { error as errorState } from '../components/state.js';
import { num } from '../format.js';
import * as toast from '../components/toast.js';

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
                <!-- APUNTAR EL PESO DESDE AQUÍ (E15-8).

                     La app estaba vacía porque registrar costaba: navegar a
                     Check-in y rellenar un formulario. Aquí es un número y un
                     botón, en la pantalla de arranque.

                     No son dos mecanismos: esto escribe por checkins.save, el
                     mismo de siempre, con la misma validación. Lo que cambia es
                     la distancia. Y el enlace al formulario completo se queda al
                     lado, porque hay semanas en las que sí se miden perímetros. -->
                <div class="quick-weight">
                    <label class="field field--inline">
                        <span class="field__label">${t('today.quickWeight.label')}</span>
                        <input class="input" type="number" inputmode="decimal" step="0.1"
                               data-quick-weight
                               placeholder="${t('today.quickWeight.placeholder')}">
                    </label>
                    <div class="btn-row">
                        <button type="button" class="btn btn--primary btn--sm" data-quick-save>
                            ${t('action.save')}
                        </button>
                        <button type="button" class="btn btn--sm" data-go-checkin>
                            ${t(hasCheckins ? 'checkin.pendingAction' : 'today.firstCheckin')}
                        </button>
                    </div>
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
                    ${w.code === 'target.muscleNoGain'
                        // Este aviso, y solo éste, tiene una salida: es el único
                        // que el usuario puede resolver ahora mismo cambiando un
                        // número. Un aviso sin salida es la misma falta que
                        // arregló E15-1 (ficha H-013).
                        ? html`<button type="button" class="btn btn--sm" data-edit-target>${t('action.editTarget')}</button>`
                        : ''}
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
                <!-- Hermano del lienzo, no sustituto (E15-5). Sin acentos
                     graves aquí dentro: en una plantilla la CIERRAN. -->
                <div data-chart-fallback hidden></div>
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
/**
 * La gráfica de ESTA vista (V2-M8).
 *
 * Desde que `chart.js` es una factoría, el cursor y la instancia son de cada
 * lienzo, no del módulo: hay que guardar el asa para el recorrido con teclado y
 * para soltarla al desmontar.
 * @type {import('../chart.js').ChartInstance | null}
 */
let chartInstance = null;

async function redraw(/** @type {*} */ container) {
    // Métrica y rango los fija esta vista; el resto es común con Proyección y
    // vive en `plan-chart.js` desde M7-4, cuando las dos copias divergieron.
    const { chart: instance } = await drawPlanChart(container, { metric: 'weight' });
    if (instance) chartInstance = instance;
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
        ${renderPlanSummary({ ...data, todayIndex: today.dayIndex })}
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
        const handled = chartInstance?.handleKey({
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

    // Guardar el peso de hoy sin salir de la pantalla de arranque (E15-8).
    on(container, 'click', '[data-quick-save]', () => {
        const input = /** @type {HTMLInputElement | null} */ (container.querySelector('[data-quick-weight]'));
        const weightKg = Number(input?.value);
        if (!input || !Number.isFinite(weightKg) || weightKg <= 0) {
            toast.error('today.quickWeight.invalid');
            input?.focus();
            return;
        }
        const hoy = plans.todayISO();
        const previo = checkins.findByDate(hoy);
        // Se guarda por `checkins.save`, el mismo camino y la misma validación
        // que el formulario completo.
        //
        // Y se le DEVUELVEN los campos que ya hubiera de hoy. `save` conserva por
        // su cuenta las cifras de báscula (`keepOptional` sobre scaleMuscleKg y
        // boneKg), pero la grasa, los perímetros, las escalas y las notas los
        // reconstruye desde `input`: sin esto, apuntar el peso por la tarde
        // borraría los perímetros medidos por la mañana. Y no vale arreglarlo en
        // `save` haciéndolo conservar todo, porque entonces vaciar un perímetro
        // en el formulario dejaría de borrarlo.
        const guardado = checkins.save({
            dateISO: hoy,
            weightKg,
            ...(previo ? {
                fatPct: previo.fatPct,
                measuresCm: previo.measuresCm,
                subjective: previo.subjective,
                notes: previo.notes ?? ''
            } : {})
        }, { nowISO: new Date().toISOString() });
        if (!guardado.ok) {
            toast.fromErrorCode(String(guardado.error).split(':')[0]);
            return;
        }
        input.value = '';
        toast.success('checkin.saved');
        if (onSaved) onSaved();
    });

    on(container, 'click', '[data-go-checkin]', () => {
        if (onGoToCheckin) onGoToCheckin();
    });

    on(container, 'click', '[data-edit-target]', () => {
        if (onEditProfile) onEditProfile();
    });

    // Reintentar la gráfica sin recargar la página (E15-5).
    on(container, 'click', '[data-action="retry-chart"]', () => { void redraw(container); });

    // Cada línea del plan integral lleva a la vista de su módulo. Se delega al
    // router en vez de a un callback por módulo: siete `setOnGoToX` serían
    // exactamente el coste que M7-3 quitó de en medio.
    on(container, 'click', '[data-go-module]', (_event, target) => {
        const viewId = target.getAttribute('data-go-module');
        if (viewId && onGoToModule) onGoToModule(viewId);
    });
}

/** @type {(() => void) | null} */
let onSaved = null;

/**
 * Qué hacer tras guardar el peso desde aquí. Lo cablea `main.js` al mismo
 * `route()` que usa el formulario completo: el plan y la desviación se
 * recalculan igual, venga el dato de donde venga.
 * @param {() => void} fn
 */
export function setOnSaved(fn) {
    onSaved = fn;
}

/** @type {(() => void) | null} */
let onEditProfile = null;

/**
 * Abrir el asistente para corregir el objetivo. Lo cablea `main.js` al mismo
 * `editProfile` que ya usa Ajustes: una sola puerta a la edición del perfil.
 * @param {() => void} fn
 */
export function setOnEditProfile(fn) {
    onEditProfile = fn;
}

/** @type {((viewId: string) => void) | null} */
let onGoToModule = null;

/** @param {(viewId: string) => void} fn */
export function setOnGoToModule(fn) {
    onGoToModule = fn;
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
    chartInstance?.destroy();
    chartInstance = null;
}


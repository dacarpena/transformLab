// @ts-check

/**
 * Dibuja la gráfica del plan en la vista que se le pase (M7-4).
 *
 * POR QUÉ EXISTE. `dashboard.js` y `projection.js` tenían la misma función
 * `redraw` copiada casi línea a línea: leer el plan, localizar los tres nodos,
 * cargar el vendor, evaluar los check-ins contra la proyección y llamar a
 * `chart.draw`. Y ya habían divergido: la copia de Hoy no reenviaba
 * `scaleMuscleKg`, y la de Proyección formateaba la fecha del hito con
 * `longDate` mientras Hoy imprimía el ISO crudo. Ninguna de las dos diferencias
 * fue una decisión; fueron dos ediciones que solo tocaron una copia.
 *
 * Lo que cambia entre vistas —métrica, granularidad, ventana— son parámetros.
 * Lo que no cambia vive aquí una sola vez.
 *
 * DESDE V2-M8 gestiona además una INSTANCIA DE GRÁFICA POR LIENZO. Antes
 * `chart.js` era un singleton y dibujar una segunda gráfica mataba la primera
 * sin error; ahora cada lienzo tiene la suya y `drawPlanChart` la devuelve para
 * que la vista pueda moverle el cursor, la ventana o pedirle el PNG.
 */

import { html } from './dom.js';
import { t } from '../i18n/i18n.js';
import * as plans from './plan-state.js';
import * as chart from './chart.js';
import * as modal from './components/modal.js';
import * as checkins from '../data/checkins.js';
import { muscleUnitsOf } from './muscle-units.js';
import { longDate } from './dates.js';
import { evaluateSeries } from '../core/tracking.js';

/**
 * Una instancia de gráfica por LIENZO.
 *
 * `WeakMap` y no `Map`: cuando el router descarta el elemento de la vista, el
 * lienzo deja de estar referenciado y su instancia se puede recolectar sola. Un
 * `Map` las iría acumulando para siempre — una fuga silenciosa por cada
 * navegación.
 * @type {WeakMap<HTMLCanvasElement, import('./chart.js').ChartInstance>}
 */
const instances = new WeakMap();

/**
 * La instancia de un lienzo, creándola la primera vez.
 * @param {HTMLCanvasElement} canvas
 * @returns {import('./chart.js').ChartInstance}
 */
export function chartFor(canvas) {
    let instance = instances.get(canvas);
    if (!instance) {
        instance = chart.createChart();
        instances.set(canvas, instance);
    }
    return instance;
}

/**
 * @typedef {Object} PlanChartOptions
 * @property {'weight'|'fatPct'|'muscle'|'kcal'} [metric] por omisión, peso
 * @property {'day'|'week'|'month'} [grain] por omisión, la que decida `chart.js`
 * @property {(data: *, todayIndex: number) => { from: number, to: number }} [range]
 *   ventana visible; por omisión, el plan entero
 */

/**
 * Redibuja el lienzo de `container`. Asíncrona porque Chart.js llega bajo
 * demanda. Si no se pudo dibujar, el respaldo ya está pintado.
 *
 * `checkinCount` es cuántos check-ins reales entraron en el lienzo, que no es
 * lo mismo que cuántos hay guardados: los que caen fuera del plan no se
 * dibujan, y los que no aplican a la métrica pedida tampoco. La leyenda de
 * Proyección lo necesita para decidir si nombra la serie real, y calcularlo por
 * su cuenta sería reevaluar la serie entera.
 *
 * Ese «ni los que no aplican a la métrica» es un arreglo, no un matiz: antes
 * este número era `evaluations.length` a secas mientras el lienzo filtraba por
 * métrica, así que con métrica «grasa» y check-ins sin porcentaje la leyenda
 * anunciaba una serie que no existía en el lienzo. Ahora el filtro es el MISMO
 * predicado que usa el lienzo, `chart.checkinAppliesTo`.
 * @param {HTMLElement} container
 * @param {PlanChartOptions} [options]
 * @returns {Promise<{ ok: boolean, checkinCount: number, chart: import('./chart.js').ChartInstance | null }>}
 */
export async function drawPlanChart(container, options = {}) {
    /** @type {{ ok: boolean, checkinCount: number, chart: import('./chart.js').ChartInstance | null }} */
    const fallo = { ok: false, checkinCount: 0, chart: null };
    const data = plans.get();
    if (!data) return fallo;

    const host = /** @type {HTMLElement | null} */ (container.querySelector('[data-chart-host]'));
    const canvas = /** @type {HTMLCanvasElement | null} */ (container.querySelector('[data-canvas]'));
    const readout = /** @type {HTMLElement | null} */ (container.querySelector('[data-readout]'));
    if (!host || !canvas || !readout) return fallo;

    if (!await chart.ensureLoaded()) {
        chart.renderFallback(host);
        return fallo;
    }
    // El usuario puede haber cambiado de vista mientras llegaba el vendor: sin
    // esto se dibujaría sobre un lienzo ya desconectado del documento.
    if (!container.isConnected) return fallo;

    const muscle = muscleUnitsOf(data);
    const today = plans.todayIndex(data, plans.todayISO());
    const evaluations = evaluateSeries(data.projection, checkins.list(), data.startDateISO);

    const metric = options.metric ?? 'weight';
    const checkinPoints = evaluations.map((evaluation) => {
        const record = checkins.findByDate(evaluation.dateISO);
        return {
            dayIndex: evaluation.dayIndex,
            actualKg: evaluation.actualKg,
            fatPct: record?.fatPct ?? null,
            // Sin esto, la métrica de músculo no dibuja NINGÚN check-in
            // aunque el perfil sea de báscula y lo haya guardado:
            // `chart.js` filtra por este campo. Es lo que le pasaba a la
            // copia de Hoy, latente solo porque su métrica es fija.
            scaleMuscleKg: record?.scaleMuscleKg ?? null,
            signal: evaluation.signal
        };
    });

    const instance = chartFor(canvas);
    const ok = instance.draw({
        canvas,
        readout,
        projection: data.projection,
        metric,
        ...(options.grain ? { grain: options.grain } : {}),
        muscle,
        todayIndex: today.dayIndex,
        range: options.range
            ? options.range(data, today.dayIndex)
            : { from: 0, to: data.plan.totalDays },
        checkins: checkinPoints,
        onMilestone: (/** @type {*} */ m) => {
            modal.open({
                titleKey: 'chart.milestoneModalTitle',
                size: 'sm',
                body: html`
                    <p>${chart.milestoneLabel(m, muscle)}</p>
                    <p class="muted">${t('chart.milestoneDay', { day: m.dayIndex, date: longDate(m.dateISO) })}</p>
                `
            });
        }
    });

    if (!ok) chart.renderFallback(host);
    const drawn = checkinPoints.filter((c) => chart.checkinAppliesTo(metric, muscle.isScale, c));
    return { ok, checkinCount: drawn.length, chart: instance };
}

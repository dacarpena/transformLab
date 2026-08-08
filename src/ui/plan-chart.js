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
import * as intakeLog from '../data/intake-log.js';
import * as stepsLog from '../data/steps.js';
import * as trainingStore from '../data/training.js';
import { exercisesOf } from '../data/training.js';
import * as exercisesDb from '../data/exercises-db.js';
import { volumeReport } from '../core/muscle-volume.js';
import { projectByGroup, checkReparto } from '../core/muscle-groups.js';

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

/**
 * Ensambla el contexto que consume el catálogo de series (E13).
 *
 * ÚNICO sitio que toca todos los almacenes para esto, por la misma razón que
 * existe este módulo: si cada vista reuniera sus propios datos, dos vistas
 * acabarían con dos ideas distintas de qué es «la serie de pasos».
 *
 * Las colecciones llegan al catálogo ya resueltas a `dayIndex`. La traducción de
 * fecha a índice es de la INTERFAZ, no del motor: el motor no sabe cuándo
 * empezó el plan de este usuario, y hacerlo aquí una vez evita que cada
 * productor del catálogo repita el mismo `findIndex`.
 *
 * Degrada por partes: un almacén ilegible deja SU serie sin datos, no la vista
 * entera. El usuario verá «sin datos todavía» en esa fila y las otras tres
 * seguirán dibujándose.
 *
 * @param {*} data el `PlanBundle` de `plan-state`
 * @returns {Promise<import('../core/series-catalog.js').SeriesContext>}
 */
export async function buildSeriesContext(data) {
    /** @type {import('../core/series-catalog.js').SeriesContext} */
    const ctx = { projection: data.projection };
    /** @type {Map<string, number>} */ const dayOf = new Map();
    data.projection.daily.forEach((/** @type {*} */ d, /** @type {number} */ i) => dayOf.set(d.dateISO, i));

    // Check-ins, con su evaluación contra el plan: de ahí salen la tendencia y
    // la desviación, que son series `derived` y no medidas.
    try {
        const evaluations = evaluateSeries(data.projection, checkins.list(), data.startDateISO);
        ctx.checkins = evaluations.map((/** @type {*} */ e) => {
            const record = checkins.findByDate(e.dateISO);
            return {
                dayIndex: e.dayIndex,
                weightKg: e.actualKg,
                fatPct: record?.fatPct ?? null,
                scaleMuscleKg: record?.scaleMuscleKg ?? null,
                measuresCm: record?.measuresCm ?? {},
                subjective: record?.subjective ?? {},
                trendKg: e.trendKg ?? null,
                deviationKg: e.deviationKg ?? null
            };
        });
    } catch { /* sin check-ins, esas series salen vacías con su motivo */ }

    try {
        ctx.intake = intakeLog.list()
            .map((/** @type {*} */ r) => ({ ...r, dayIndex: dayOf.get(r.dateISO) ?? -1 }))
            .filter((/** @type {*} */ r) => r.dayIndex >= 0);
    } catch { /* idem */ }

    try {
        ctx.steps = stepsLog.list()
            .map((/** @type {*} */ r) => ({ dayIndex: dayOf.get(r.dateISO) ?? -1, steps: r.steps }))
            .filter((/** @type {*} */ r) => r.dayIndex >= 0);
    } catch { /* idem */ }

    try {
        const training = trainingStore.read();
        if (Array.isArray(training?.sessions) && training.sessions.length > 0) {
            ctx.sessions = training.sessions;
        }
    } catch { /* idem */ }

    // Músculo por grupo. Pasa por el MISMO cortafuegos que la rejilla de V2-M9:
    // si la suma de los grupos no reconstituye el músculo global, no se ofrecen.
    // Once gráficas que se contradicen entre sí son peores que ninguna.
    try {
        const desagregada = await muscleByGroup(data);
        if (desagregada) ctx.muscleByGroup = desagregada;
    } catch { /* idem */ }

    return ctx;
}

/**
 * Las series por grupo muscular, o `null` si el reparto no cuadra.
 * @param {*} data
 * @returns {Promise<Record<string, import('../core/series-catalog.js').SeriesPoint[]> | null>}
 */
async function muscleByGroup(data) {
    const training = trainingStore.read();
    /** @type {Record<string, *>} */ const porRutina = {};
    const loaded = await exercisesDb.load();
    if (loaded.ok) {
        for (const ex of exercisesOf(training.routine)) {
            if (ex.catalogId && loaded.value[ex.catalogId]) porRutina[ex.id] = loaded.value[ex.catalogId];
        }
    }
    const report = volumeReport({
        sessions: training.sessions,
        catalog: porRutina,
        trainingStatus: data.profile?.user?.trainingStatus ?? 'intermediate',
        weeks: 1
    });
    /** @type {Record<string, number>} */ const stimulusByGroup = {};
    for (const g of report.groups) stimulusByGroup[g.group] = g.stimulus;

    const desagregada = projectByGroup({ daily: data.projection.daily, stimulusByGroup });
    if (!checkReparto(desagregada, data.projection.daily, 1e-6).ok) return null;

    /** @type {Record<string, import('../core/series-catalog.js').SeriesPoint[]>} */ const out = {};
    for (const g of desagregada.groups) {
        out[g.group] = g.daily.map((/** @type {*} */ p) => ({ x: p.dayIndex, y: p.muscleKg }));
    }
    return out;
}

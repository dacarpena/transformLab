// @ts-check

/**
 * Analizar: hasta cuatro series superpuestas (E13-5).
 *
 * POR QUÉ ES UNA VISTA PROPIA. Proyección cuenta EL PLAN: dónde acabas, cuándo,
 * y cómo va lo real contra lo previsto. Eso es una historia con una métrica cada
 * vez. Comparar cuatro series cualesquiera es otro trabajo —el usuario llega con
 * una pregunta concreta («¿mi cintura baja al ritmo de mi peso?»)— y meterlo en
 * Proyección habría convertido una pantalla que se lee en una que se opera.
 * Misma decisión que E12 al separar Hoy de Proyección: cada pantalla, un trabajo.
 *
 * LA LEYENDA ES LA INTERFAZ DE SELECCIÓN, y las dos reglas que lo sostienen:
 *
 * 1. **Las filas se generan desde el MANIFIESTO de `drawMulti`**, nunca desde el
 *    estado de selección. Una serie que no se dibujó no puede aparecer como
 *    dibujada. Ese era el defecto real de Proyección, resuelto por construcción.
 * 2. **Correspondencia 1:1 con lo elegido.** Una serie que resolvió a cero
 *    puntos NO desaparece: se queda con «sin datos en este periodo». Desaparecer
 *    sería la otra mitad de la mentira — el usuario la eligió y no entendería
 *    adónde fue.
 *
 * No hay una fila de chips ADEMÁS de la leyenda: sería un tercer sitio donde la
 * misma verdad puede divergir, y a 320 px cuesta un bloque vertical que no sobra.
 */

import { html, render, on, safeUrl } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import * as plans from '../plan-state.js';
import * as chart from '../chart.js';
import { chartFor, buildSeriesContext } from '../plan-chart.js';
import * as modal from '../components/modal.js';
import * as toast from '../components/toast.js';
import * as settingsStore from '../../data/settings.js';
import { muscleUnitsOf, translateSeries } from '../muscle-units.js';
import { longDate, shortDate } from '../dates.js';
import { num } from '../format.js';
import { toCsv, toBlob, formatNumber } from '../csv.js';
import { empty, error as errorState } from '../components/state.js';
import { SERIES, UNITS, seriesById, resolveSeries } from '../../core/series-catalog.js';
import { MAX_SERIES, PROVENANCE_STYLE } from '../series-style.js';
import { attachGestures, clampWindow } from '../chart-gestures.js';

/** @typedef {import('../../core/series-catalog.js').ResolvedSeries} ResolvedSeries */

/**
 * Comparaciones que responden a una pregunta real, no combinaciones bonitas.
 * La primera se aplica sola en la primera visita: un lienzo en blanco con un
 * botón «elige algo» no enseña qué hace la pantalla.
 */
const PRESETS = Object.freeze([
    { id: 'planVsReal', ids: ['proj_weight', 'meas_weight'] },
    { id: 'energy', ids: ['proj_kcal_target', 'meas_intake_kcal'] },
    { id: 'shape', ids: ['proj_weight', 'meas_waist'] }
]);

/** El orden en que se agrupan las series en el selector. Por TEMA, no por procedencia. */
const GROUP_ORDER = Object.freeze([
    'body', 'energy', 'macros', 'measures', 'subjective', 'activity', 'muscleGroups', 'training'
]);

/** @type {string[]} */ let selected = [];
/**
 * El periodo elegido. `custom` no es un botón: lo produce el zoom.
 *
 * SIN esta variante, la ventana se derivaría del preset en CADA redibujado y
 * cualquier cosa que redibuje —marcar una serie, cambiar de escala— se comería
 * el zoom del usuario al instante. Los gestos funcionarían y se desharían solos.
 * @type {'all'|'phase'|'90'|'30'|'custom'}
 */
let windowPreset = 'all';
/** Los límites que fijó el zoom, cuando el periodo es `custom`. @type {{from:number,to:number}|null} */
let customBounds = null;
/** @type {(() => void) | null} */ let detachGestures = null;
/** @type {'day'|'week'|'month'} */ let grain = 'week';
/** @type {'raw'|'delta'} */ let normalize = 'raw';
/** @type {import('../../core/series-catalog.js').SeriesContext | null} */ let context = null;
/** @type {import('../chart.js').ChartInstance | null} */ let chartInstance = null;
/** @type {import('../chart.js').DrawManifest | null} */ let manifest = null;
/** @type {ResolvedSeries[]} */ let resolved = [];
/** Texto del buscador del selector. Vive fuera del modal para sobrevivir a su re-render. */
let query = '';

/**
 * Ancho por debajo del cual la gráfica se simplifica sola.
 *
 * El mecanismo es uno y se aprende una vez: **se guarda lo PEDIDO y se dibuja lo
 * EFECTIVO, y el control muestra lo efectivo**. Si el usuario pulsa «Día» y se
 * dibuja «Semana», `aria-pressed` tiene que reflejar Semana — reflejar lo pedido
 * sería la leyenda mentirosa reencarnada en otro control.
 */
const NARROW_PX = 560;

/** @returns {boolean} */
function isNarrow() {
    return typeof globalThis.matchMedia === 'function'
        && globalThis.matchMedia(`(max-width: ${NARROW_PX}px)`).matches;
}

/** El grano que se DIBUJA, que puede no ser el pedido. */
function effectiveGrain() {
    if (!isNarrow()) return grain;
    // A 320 px, un punto por día con cuatro series es una mancha.
    return grain === 'day' ? 'week' : grain;
}

/** La escala que se DIBUJA: con más de dos unidades, solo el cambio es comparable. */
function effectiveNormalize() {
    if (normalize === 'delta') return 'delta';
    const unidades = new Set(resolved.map((r) => r.unit));
    return unidades.size > 2 ? 'delta' : 'raw';
}

/**
 * La ventana visible. Misma lógica que Proyección, que ya la tenía resuelta.
 * @param {*} data @param {number} todayIndex
 */
function windowBounds(data, todayIndex) {
    const total = data.plan.totalDays;
    const clamp = (/** @type {number} */ v) => Math.min(Math.max(Math.round(v), 0), total);
    if (windowPreset === 'custom' && customBounds) {
        return clampWindow(customBounds.from, customBounds.to, { from: 0, to: total });
    }
    if (windowPreset === 'phase') {
        let start = 0;
        for (const phase of data.plan.phases) {
            if (todayIndex < start + phase.days) return { from: clamp(start), to: clamp(start + phase.days) };
            start += phase.days;
        }
        return { from: 0, to: total };
    }
    if (windowPreset === '30' || windowPreset === '90') {
        const half = Number(windowPreset);
        return { from: clamp(todayIndex - half / 3), to: clamp(todayIndex + half) };
    }
    return { from: 0, to: total };
}

/** Un grupo de botones excluyentes; el estado vive en `aria-pressed`. */
function segmented(/** @type {string} */ labelKey, /** @type {string} */ attr,
    /** @type {Array<{value: string, labelKey: string}>} */ options, /** @type {string} */ active) {
    return html`
        <div class="segmented" role="group" aria-label="${t(labelKey)}">
            ${options.map((o) => html`
                <button type="button" class="btn btn--sm" ${attr}="${o.value}"
                        aria-pressed="${o.value === active ? 'true' : 'false'}">${t(o.labelKey)}</button>
            `)}
        </div>
    `;
}

/**
 * El glifo de la leyenda: el TRAZO REAL en miniatura, no un punto de color.
 *
 * Un punto redondo no se parece a lo que hay dibujado. Con cuatro patrones de
 * trazo distintos codificando la procedencia, la leyenda tiene que enseñar el
 * patrón o el usuario no puede emparejar fila y línea.
 */
function glyph(/** @type {number} */ slot, /** @type {string} */ provenance) {
    // El MISMO `borderDash` que usa el lienzo, leído de su fuente única: si un
    // día cambiara ahí, un glifo con su propia copia dejaría de parecerse a la
    // línea que dice describir.
    const dash = (/** @type {*} */ (PROVENANCE_STYLE)[provenance]?.borderDash ?? []).join(' ');
    return html`
        <svg class="series-glyph is-series-${slot + 1}" viewBox="0 0 24 12" aria-hidden="true" focusable="false">
            <line x1="1" y1="6" x2="23" y2="6" stroke="currentColor" stroke-width="2"
                  stroke-dasharray="${dash}"></line>
        </svg>
    `;
}

/** Una fila de leyenda, construida desde el MANIFIESTO. */
function legendRow(/** @type {*} */ item) {
    const spec = seriesById(item.id);
    if (!spec) return html``;
    const unidad = /** @type {*} */ (UNITS)[item.unit];
    const vacia = item.pointCount === 0;
    const meta = vacia
        ? t(item.reason ?? 'series.reason.outOfWindow')
        : `${t(unidad?.key ?? 'unit.kg')} · ${t(`analysis.axis.${item.axis === 'y2' ? 'right' : 'left'}`)} · ${t('analysis.legend.points', { count: item.pointCount })}`;

    return html`
        <li class="series-legend__item is-series-${item.slot + 1}"
            data-legend-row="${item.id}" data-slot="${item.slot + 1}"
            data-provenance="${item.provenance}" data-state="${vacia ? 'emptyWindow' : 'ok'}">
            ${glyph(item.slot, item.provenance)}
            <span class="series-legend__name">${t(spec.labelKey)}</span>
            <span class="badge badge--outline badge--prov-${item.provenance}">${t(`series.provenance.${item.provenance}`)}</span>
            <span class="series-legend__meta muted">${meta}</span>
            <span class="series-legend__value numeric" data-legend-value="${item.id}"></span>
            ${vacia && windowPreset !== 'all'
                ? html`<button type="button" class="btn btn--sm" data-widen-window>${t('analysis.legend.widen')}</button>`
                : ''}
            <button type="button" class="btn btn--icon" data-remove-series="${item.id}"
                    aria-label="${t('analysis.series.remove', { name: t(spec.labelKey) })}">
                <span aria-hidden="true">✕</span>
            </button>
        </li>
    `;
}

/**
 * La nota de procedencia mixta: el valor central del producto en una frase que
 * se genera sola.
 *
 * SIN CIFRAS, y es deliberado. La primera versión decía «1 previstas, 1 medidas
 * y 0 estimadas»: concordancia rota tres veces y un cero que solo hace ruido.
 * Construir plurales para cuatro palabras en dos idiomas es mucha maquinaria
 * para un dato que la leyenda ya da fila a fila —cada una lleva su insignia—.
 * Lo que la frase aporta no es cuántas hay, sino QUÉ significa mezclarlas.
 */
function mixedNotice() {
    if (!manifest) return null;
    const presentes = new Set(manifest.rendered.map((s) => s.provenance));
    if (presentes.size < 2) return null;

    const orden = ['projected', 'measured', 'derived', 'estimated'];
    const nombres = orden
        .filter((p) => presentes.has(/** @type {*} */ (p)))
        .map((p) => t(`series.provenance.${p}Plural`));
    const lista = nombres.length === 1
        ? nombres[0]
        : `${nombres.slice(0, -1).join(', ')} ${t('analysis.provenance.and')} ${nombres.at(-1)}`;

    // Y el remate cambia según haya o no algo medido: decir «solo las medidas
    // salen de algo que has medido» cuando no hay ninguna sería absurdo.
    const remate = presentes.has('measured')
        ? t('analysis.provenance.mixedMeasured')
        : t('analysis.provenance.mixedNoneMeasured');
    return `${t('analysis.provenance.mixed', { classes: lista })} ${remate}`;
}

/** La vista entera. */
function view() {
    const efectivoGrano = effectiveGrain();
    const efectivaEscala = effectiveNormalize();

    return html`
        <h1 class="card__title">${t('analysis.title')}</h1>
        <p class="muted">${t('analysis.intro')}</p>

        <section class="card" aria-labelledby="analysis-series">
            <div class="card__header">
                <h2 id="analysis-series" class="card__title">${t('analysis.series.title')}</h2>
                <span class="muted" data-series-count>${t('analysis.series.count', { count: selected.length, max: MAX_SERIES })}</span>
            </div>
            <div class="btn-row">
                <button type="button" class="btn btn--primary" data-open-picker aria-haspopup="dialog">
                    ${t('analysis.series.choose')}
                </button>
                <div class="segmented" role="group" aria-label="${t('analysis.preset.label')}">
                    ${PRESETS.map((p) => html`
                        <button type="button" class="btn btn--sm" data-preset="${p.id}">${t(`analysis.preset.${p.id}`)}</button>
                    `)}
                </div>
            </div>
        </section>

        <section class="card" aria-labelledby="analysis-chart">
            <h2 id="analysis-chart" class="card__title">${t('analysis.chart.title')}</h2>
            <div class="chart-toolbar">
                ${segmented('analysis.window.label', 'data-window', [
                    { value: 'all', labelKey: 'projection.window.all' },
                    { value: 'phase', labelKey: 'projection.window.phase' },
                    { value: '90', labelKey: 'projection.window.90' },
                    { value: '30', labelKey: 'projection.window.30' }
                ], windowPreset)}
                ${segmented('analysis.grain.label', 'data-grain', [
                    { value: 'day', labelKey: 'analysis.grain.day' },
                    { value: 'week', labelKey: 'analysis.grain.week' },
                    { value: 'month', labelKey: 'analysis.grain.month' }
                ], efectivoGrano)}
                ${segmented('analysis.normalize.label', 'data-normalize', [
                    { value: 'raw', labelKey: 'analysis.normalize.raw' },
                    { value: 'delta', labelKey: 'analysis.normalize.delta' }
                ], efectivaEscala)}
            </div>
            <p class="field__hint" data-effective-hint hidden></p>

            <div class="chart-wrap" data-chart-host>
                <canvas data-canvas role="img" tabindex="0"
                        aria-label="${t('analysis.chart.label', { count: selected.length })}"
                        aria-describedby="analysis-keys"></canvas>
            </div>
            <p id="analysis-keys" class="visually-hidden">${t('analysis.readout.hint')}</p>

            <ul class="series-legend" data-legend aria-label="${t('analysis.legend.label')}">
                ${(manifest?.rendered ?? []).map(legendRow)}
            </ul>
            <p class="notice" data-mixed-notice hidden></p>
            <p class="chart-readout" data-readout role="status" aria-live="polite"></p>
        </section>

        <section class="card" aria-labelledby="analysis-table">
            <div class="card__header">
                <h2 id="analysis-table" class="card__title">${t('analysis.table.title')}</h2>
                <span class="muted" data-table-count></span>
            </div>
            <details data-table-details>
                <summary>${t('analysis.table.toggle')}</summary>
                <!-- Zona desplazable con role=region y tabindex=0: a 320 px
                     cinco columnas no caben, y algo que se desplaza en horizontal
                     tiene que ser alcanzable con teclado (WCAG 2.1.1). El
                     envoltorio propio impide además que ese desplazamiento
                     contamine el scrollWidth del documento, que es lo que miden
                     los tests de desborde.
                     (Sin acentos graves aqui dentro: CIERRAN la plantilla.) -->
                <div class="table-scroll" role="region" tabindex="0"
                     aria-label="${t('analysis.table.scrollRegion')}" data-table-scroll></div>
            </details>
            <div class="btn-row">
                <button type="button" class="btn btn--sm" data-csv>${t('analysis.csv.download')}</button>
            </div>
            <p class="field__hint">${t('analysis.csv.hint')}</p>
        </section>
    `;
}

/**
 * Los datos de la tabla y del CSV, en UNA sola función.
 *
 * Se construyen de las series RESUELTAS, no del lienzo: por eso la tabla y la
 * descarga siguen enteras cuando Chart.js no carga. Si salieran del lienzo, un
 * fallo de la librería de gráficos se llevaría también los números — y los
 * números son lo que el usuario vino a ver.
 *
 * @returns {{ headers: string[], rows: Array<Array<string|number|null>>,
 *   anchors: number[], units: Array<{decimals: number}> }}
 */
function tableData(/** @type {*} */ data) {
    const anchors = new Set();
    for (const serie of resolved) for (const p of serie.points) anchors.add(p.x);
    const dias = [...anchors].sort((a, b) => a - b);

    const headers = [t('analysis.table.colDate'), ...resolved.map((serie) => t('analysis.table.header', {
        name: t(serie.spec.labelKey),
        unit: t(/** @type {*} */ (UNITS)[serie.unit]?.key ?? 'unit.kg'),
        provenance: t(`series.provenance.${serie.spec.provenance}`)
    }))];

    const units = resolved.map((serie) => ({
        decimals: /** @type {*} */ (UNITS)[serie.unit]?.decimals ?? 1
    }));

    const rows = dias.map((dia) => {
        const punto = data.projection.daily[dia];
        /** @type {Array<string|number|null>} */
        const fila = [punto?.dateISO ?? ''];
        for (const serie of resolved) {
            const hit = serie.points.find((p) => p.x === dia);
            fila.push(hit ? hit.y : null);
        }
        return fila;
    });

    return { headers, rows, anchors: dias, units };
}

/** Estado sin selección: nunca un lienzo en blanco sin salida. */
function emptySelection() {
    return html`
        ${empty({
            titleKey: 'analysis.emptySelection.title',
            bodyKey: 'analysis.emptySelection.body',
            actions: [{ labelKey: 'analysis.series.choose', action: 'openPicker', primary: true }]
        })}
        <div class="btn-row">
            ${PRESETS.map((p) => html`
                <button type="button" class="btn btn--sm" data-preset="${p.id}">${t(`analysis.preset.${p.id}`)}</button>
            `)}
        </div>
    `;
}

/* ---------------------------------------------------------------------- *
 * El selector
 * ---------------------------------------------------------------------- */

/**
 * Una sola vía a todos los anchos: modal.
 *
 * El proyecto ya pagó el precio de dos caminos para lo mismo (`plan-chart.js`
 * documenta las dos divergencias que aparecieron entre las copias de `redraw`).
 * El modal ya tiene focus-trap, `Escape` y devolución de foco, y el test de
 * accesibilidad ya lo verifica: un segundo camino sería superficie nueva a
 * cambio de nada.
 */
function pickerBody() {
    const q = query.trim().toLowerCase();
    const disponibles = SERIES.filter((spec) => {
        if (!q) return true;
        const texto = `${t(spec.labelKey)} ${t(UNITS[spec.unit]?.key ?? '')} ${t(`series.provenance.${spec.provenance}`)}`;
        return texto.toLowerCase().includes(q);
    });

    const porGrupo = GROUP_ORDER
        .map((g) => ({ group: g, items: disponibles.filter((s) => s.group === g) }))
        .filter((g) => g.items.length > 0);

    return html`
        <div class="picker" data-picker>
            <label class="field">
                <span class="field__label">${t('analysis.series.search')}</span>
                <input type="search" class="field__input" data-picker-search value="${query}"
                       autocomplete="off" aria-describedby="picker-results">
            </label>
            <p class="field__hint" id="picker-results" role="status">
                ${disponibles.length === 0
                    ? t('analysis.series.noResults', { query })
                    : t('analysis.series.results', { count: disponibles.length })}
            </p>
            <p class="notice" data-picker-limit ${selected.length >= MAX_SERIES ? '' : 'hidden'}>
                ${t('analysis.series.limitReached', { max: MAX_SERIES })}
            </p>

            <div data-picker-groups>
                ${porGrupo.map((g) => html`
                    <details ${q || g.group === 'body' ? 'open' : ''} data-group="${g.group}">
                        <summary>
                            ${t(`series.group.${g.group}`)}
                            <span class="muted">${t('analysis.group.count', { count: g.items.length })}</span>
                        </summary>
                        <ul class="picker__list">
                            ${g.items.map((spec) => {
                                const marcada = selected.includes(spec.id);
                                const sinDatos = !hasData(spec.id);
                                return html`
                                    <li class="picker__row">
                                        <label class="picker__label">
                                            <input type="checkbox" data-series="${spec.id}"
                                                   ${marcada ? 'checked' : ''}>
                                            <span class="picker__name">${t(spec.labelKey)}</span>
                                            <span class="badge badge--outline badge--prov-${spec.provenance}">${t(`series.provenance.${spec.provenance}`)}</span>
                                            <span class="picker__meta muted">
                                                ${t(UNITS[spec.unit]?.key ?? 'unit.kg')}${sinDatos ? ` · ${t('analysis.series.noData')}` : ''}
                                            </span>
                                        </label>
                                    </li>
                                `;
                            })}
                        </ul>
                    </details>
                `)}
            </div>

            <div class="picker__tray" data-picker-tray>${trayBody()}</div>
        </div>
    `;
}

/** La bandeja de elegidas. Se repinta SOLA al marcar, sin tocar la lista. */
function trayBody() {
    return html`
        <span class="muted">${t('analysis.series.count', { count: selected.length, max: MAX_SERIES })}</span>
        ${selected.length === 0
            ? html`<span class="muted">${t('analysis.series.trayEmpty')}</span>`
            : selected.map((id, i) => {
                const spec = seriesById(id);
                return spec ? html`
                    <span class="picker__chip is-series-${i + 1}">
                        ${t(spec.labelKey)}
                        <button type="button" class="btn btn--icon" data-remove-series="${id}"
                                aria-label="${t('analysis.series.remove', { name: t(spec.labelKey) })}">
                            <span aria-hidden="true">✕</span>
                        </button>
                    </span>
                ` : '';
            })}
    `;
}

/** Si una serie tiene algo que dibujar con el contexto actual. */
function hasData(/** @type {string} */ id) {
    const spec = seriesById(id);
    if (!spec || !context) return false;
    return spec.needs.every((need) => {
        const value = context?.[need];
        if (value === undefined || value === null) return false;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'object') return Object.keys(value).length > 0;
        return true;
    });
}

/* ---------------------------------------------------------------------- *
 * Dibujado
 * ---------------------------------------------------------------------- */

async function redraw(/** @type {HTMLElement} */ container) {
    const data = plans.get();
    if (!data) return;
    const host = /** @type {HTMLElement | null} */ (container.querySelector('[data-chart-host]'));
    const canvas = /** @type {HTMLCanvasElement | null} */ (container.querySelector('[data-canvas]'));
    if (!host || !canvas) return;

    if (!await chart.ensureLoaded()) {
        chart.renderFallback(host);
        return;
    }
    if (!container.isConnected) return;

    const today = plans.todayIndex(data, plans.todayISO());
    const range = windowBounds(data, today.dayIndex);

    chartInstance = chartFor(canvas);
    manifest = chartInstance.drawMulti({
        canvas,
        readout: /** @type {*} */ (container.querySelector('[data-readout]')),
        projection: data.projection,
        series: resolved,
        todayIndex: today.dayIndex,
        range,
        normalize: effectiveNormalize(),
        // A 320 px, ocho rótulos en el eje X se solapan.
        ...(isNarrow() ? { maxTicks: 4 } : {})
    });
    if (!manifest.ok && manifest.status === 'noChart') chart.renderFallback(host);

    // La leyenda se REHACE desde el manifiesto, siempre. Es la regla que impide
    // que anuncie una serie que el lienzo no dibujó.
    const legendHost = container.querySelector('[data-legend]');
    if (legendHost) {
        render(/** @type {HTMLElement} */ (legendHost),
            html`${(manifest.rendered ?? []).map(legendRow)}`);
    }

    // La nota de procedencia también sale del manifiesto, y por eso se rellena
    // AQUÍ y no al construir el marcado: cuando se pinta la vista, el manifiesto
    // es todavía el del dibujado anterior —null la primera vez—, así que la nota
    // no habría salido nunca en la primera visita.
    const noticeHost = /** @type {HTMLElement | null} */ (container.querySelector('[data-mixed-notice]'));
    if (noticeHost) {
        const texto = mixedNotice();
        noticeHost.textContent = texto ?? '';
        noticeHost.hidden = texto === null;
    }

    renderHints(container, data);
    wireGestures(container, canvas, data);
}

/**
 * Conecta los gestos al lienzo recién dibujado.
 *
 * Se reconecta en cada dibujado porque `render` recrea el nodo del lienzo; lo
 * primero es soltar los anteriores, o cada redibujado dejaría otra capa de
 * escuchas sobre un nodo muerto.
 * @param {HTMLElement} container @param {HTMLCanvasElement} canvas @param {*} data
 */
function wireGestures(container, canvas, data) {
    detachGestures?.();
    const instancia = chartInstance;
    if (!instancia) return;
    const total = data.plan.totalDays;

    detachGestures = attachGestures(canvas, {
        getWindow: () => {
            const today = plans.todayIndex(data, plans.todayISO());
            return windowBounds(data, today.dayIndex);
        },
        getBounds: () => ({ from: 0, to: total }),
        dayAtPixel: (px) => {
            const escala = /** @type {*} */ (instancia).scaleX?.() ?? null;
            if (escala) return escala(px);
            // Sin acceso a la escala, se interpola sobre la ventana visible.
            const today = plans.todayIndex(data, plans.todayISO());
            const w = windowBounds(data, today.dayIndex);
            return w.from + (px / Math.max(1, canvas.clientWidth)) * (w.to - w.from);
        },
        pixelsPerDay: () => {
            const today = plans.todayIndex(data, plans.todayISO());
            const w = windowBounds(data, today.dayIndex);
            return canvas.clientWidth / Math.max(1, w.to - w.from);
        },
        onWindow: (from, to) => {
            windowPreset = 'custom';
            customBounds = { from, to };
            // `setWindow` mueve la escala sin reconstruir la gráfica: es lo que
            // permite que un gesto continuo se sienta continuo.
            instancia.setWindow(from, to);
            refreshWindowButtons(container);
        }
    });
}

/**
 * Apaga los botones de periodo cuando la ventana ya no es la de ninguno.
 *
 * Dejar «Todo» pulsado mientras se mira un tramo de treinta días sería el mismo
 * defecto que la leyenda mentirosa: un control afirmando algo que la gráfica
 * contradice.
 * @param {HTMLElement} container
 */
function refreshWindowButtons(container) {
    for (const boton of container.querySelectorAll('[data-window]')) {
        boton.setAttribute('aria-pressed',
            boton.getAttribute('data-window') === windowPreset ? 'true' : 'false');
    }
}

/** Cuántas filas se enseñan antes de pedir permiso para el resto. */
const TABLE_LIMIT = 30;
let showAllRows = false;

/**
 * La tabla de datos: la alternativa textual completa.
 *
 * Sale de las series RESUELTAS, no del lienzo, y por eso sobrevive a que
 * Chart.js no cargue. Un fallo de la librería de gráficos no puede llevarse
 * también los números.
 * @param {HTMLElement} container @param {*} data
 */
function renderTable(container, data) {
    const host = /** @type {HTMLElement | null} */ (container.querySelector('[data-table-scroll]'));
    if (!host) return;
    const { headers, rows, units } = tableData(data);
    const visibles = showAllRows ? rows : rows.slice(0, TABLE_LIMIT);

    render(host, html`
        <table class="data-table" data-table>
            <caption>${t('analysis.table.caption', {
                grain: t(`analysis.grain.${effectiveGrain()}`)
            })}</caption>
            <thead>
                <tr>${headers.map((h) => html`<th scope="col">${h}</th>`)}</tr>
            </thead>
            <tbody>
                ${visibles.map((fila) => html`
                    <tr>
                        <th scope="row">${shortDate(String(fila[0]))}</th>
                        ${fila.slice(1).map((valor, i) => html`
                            <td class="numeric">${typeof valor === 'number'
                                ? num(valor, units[i].decimals)
                                : html`<span title="${t('analysis.table.noValue')}">—</span>`}</td>
                        `)}
                    </tr>
                `)}
            </tbody>
        </table>
    `);

    const contador = /** @type {HTMLElement | null} */ (container.querySelector('[data-table-count]'));
    if (contador) {
        contador.textContent = t('analysis.table.count', { shown: visibles.length, total: rows.length });
    }

    // El tope se DICE, no se aplica en silencio: un recorte callado se lee como
    // «esto es todo lo que hay», que es una afirmación falsa.
    const detalles = container.querySelector('[data-table-details]');
    const yaHay = container.querySelector('[data-show-all-rows]');
    if (!showAllRows && rows.length > TABLE_LIMIT && detalles && !yaHay) {
        const boton = document.createElement('button');
        boton.type = 'button';
        boton.className = 'btn btn--sm';
        boton.setAttribute('data-show-all-rows', '');
        boton.textContent = t('analysis.table.showAll', { count: rows.length - TABLE_LIMIT });
        detalles.appendChild(boton);
    } else if ((showAllRows || rows.length <= TABLE_LIMIT) && yaHay) {
        yaHay.remove();
    }
}

/**
 * Los avisos de «lo que se dibuja no es lo que pediste», en UN solo sitio.
 *
 * Van aquí y no al construir el marcado porque uno de ellos —desde qué día se
 * mide el cambio— sale del manifiesto, y cuando se pinta la vista el manifiesto
 * es todavía el del dibujado anterior. Repartirlos entre dos sitios ya me costó
 * que la nota de procedencia no saliera nunca en la primera visita; con tres
 * avisos, la probabilidad de que vuelva a pasar era del cien por cien.
 * @param {HTMLElement} container @param {*} data
 */
function renderHints(container, data) {
    const host = /** @type {HTMLElement | null} */ (container.querySelector('[data-effective-hint]'));
    if (!host) return;

    /** @type {string[]} */ const avisos = [];
    const efectivoGrano = effectiveGrain();
    if (efectivoGrano !== grain) {
        avisos.push(t('analysis.grain.forced', { grain: t(`analysis.grain.${efectivoGrano}`) }));
    }
    const efectivaEscala = effectiveNormalize();
    if (efectivaEscala !== normalize) {
        avisos.push(t('analysis.normalize.forced', { units: new Set(resolved.map((r) => r.unit)).size }));
    }
    // Que el origen se mueva con la ventana NO puede ser un secreto: sin decirlo,
    // cambiar de periodo altera la referencia en silencio y la misma serie
    // parece otra cosa. Ese es el vector de engaño real de este modo.
    if (efectivaEscala === 'delta' && typeof manifest?.baselineX === 'number') {
        const punto = data.projection.daily[manifest.baselineX];
        if (punto) avisos.push(t('analysis.normalize.deltaBaseline', { date: longDate(punto.dateISO) }));
    }

    host.textContent = avisos.join(' ');
    host.hidden = avisos.length === 0;
}

/** Resuelve la selección contra el contexto y la pasa por la aduana de músculo. */
function resolveSelection(/** @type {*} */ data) {
    if (!context) {
        resolved = [];
        return;
    }
    const anchors = chart.seriesAnchors(data.projection, effectiveGrain());
    const crudas = selected
        .map((id) => seriesById(id))
        .filter(Boolean)
        .map((spec) => resolveSeries(/** @type {*} */ (spec), /** @type {*} */ (context), anchors));
    resolved = translateSeries(crudas, muscleUnitsOf(data));
}

/** Guarda el estado de la vista. Si falla, se avisa pero NO se revierte nada. */
function persist() {
    const r = settingsStore.patch({
        analysis: {
            seriesIds: selected.slice(0, MAX_SERIES),
            // Un zoom son dos índices de día que solo significan algo dentro de
            // ESTE plan: restaurarlos sobre uno recalibrado señalaría un tramo
            // que ya no existe. Al recargar se vuelve al plan entero, que es un
            // sitio del que se sabe salir.
            window: windowPreset === 'custom' ? 'all' : windowPreset,
            grain, normalize
        }
    });
    if (!r.ok) toast.error('analysis.saveFailed');
}

/** Repinta la vista entera y redibuja. */
async function refresh(/** @type {HTMLElement} */ container) {
    const data = plans.get();
    if (!data) return;
    resolveSelection(data);
    render(container, selected.length === 0 ? emptySelection() : view());
    if (selected.length === 0) return;
    // La tabla se pinta ANTES de dibujar y fuera de `redraw`, a propósito:
    // `redraw` sale antes de tiempo cuando Chart.js no carga, y la tabla es
    // justo lo que tiene que seguir ahí en ese caso. Con la tabla dentro, un
    // fallo del vendor se habría llevado también los números.
    renderTable(container, data);
    await redraw(container);
}

/* ---------------------------------------------------------------------- *
 * Ciclo de vida
 * ---------------------------------------------------------------------- */

export async function mount(/** @type {HTMLElement} */ container) {
    const data = plans.get();
    if (data === null) {
        render(container, empty({
            titleKey: 'analysis.empty.title',
            bodyKey: 'analysis.empty.body'
        }));
        return;
    }
    if (!data.plan || !Array.isArray(data.projection?.daily)) {
        render(container, errorState({ titleKey: 'error.viewTitle', bodyKey: 'error.viewBody' }));
        return;
    }

    context = await buildSeriesContext(data);
    if (!container.isConnected) return;

    // Selección guardada, filtrando los ids que ya no existen. Se DICE cuántos
    // se han caído: un backup de otro perfil o una serie retirada no pueden
    // tumbar la vista, ni desaparecer en silencio.
    const guardado = settingsStore.read().analysis;
    if (guardado) {
        const validos = guardado.seriesIds.filter((id) => seriesById(id) !== null);
        const perdidos = guardado.seriesIds.length - validos.length;
        selected = validos.slice(0, MAX_SERIES);
        windowPreset = /** @type {*} */ (guardado.window);
        grain = /** @type {*} */ (guardado.grain);
        normalize = /** @type {*} */ (guardado.normalize);
        if (perdidos > 0) toast.success('analysis.series.dropped', { count: perdidos });
    }
    // Primera visita: una comparación rápida aplicada sola. Un lienzo en blanco
    // no enseña qué hace la pantalla.
    if (selected.length === 0 && !guardado) selected = [...PRESETS[0].ids];

    await refresh(container);
    wire(container);
}

function wire(/** @type {HTMLElement} */ container) {
    on(container, 'click', '[data-open-picker]', () => openPicker(container));

    on(container, 'click', '[data-preset]', async (_event, target) => {
        const preset = PRESETS.find((p) => p.id === target.getAttribute('data-preset'));
        if (!preset) return;
        selected = [...preset.ids];
        persist();
        await refresh(container);
        const nombres = selected.map((id) => t(seriesById(id)?.labelKey ?? id)).join(', ');
        toast.success('analysis.preset.applied', { count: selected.length, names: nombres });
    });

    on(container, 'click', '[data-remove-series]', async (_event, target) => {
        const id = target.getAttribute('data-remove-series');
        // El foco NUNCA cae al <body>: pasa al siguiente botón de quitar, o al
        // de elegir series si era la última fila.
        const fila = target.closest('[data-legend-row]');
        const siguiente = fila?.nextElementSibling?.querySelector('[data-remove-series]')
            ?? fila?.previousElementSibling?.querySelector('[data-remove-series]');
        selected = selected.filter((s) => s !== id);
        persist();
        await refresh(container);
        const destino = siguiente
            ? container.querySelector(`[data-remove-series="${siguiente.getAttribute('data-remove-series')}"]`)
            : container.querySelector('[data-open-picker]');
        /** @type {HTMLElement | null} */ (destino)?.focus();
    });

    on(container, 'click', '[data-window]', async (_event, target) => {
        windowPreset = /** @type {*} */ (target.getAttribute('data-window'));
        customBounds = null;
        persist();
        await refresh(container);
    });
    on(container, 'click', '[data-grain]', async (_event, target) => {
        grain = /** @type {*} */ (target.getAttribute('data-grain'));
        persist();
        await refresh(container);
    });
    on(container, 'click', '[data-normalize]', async (_event, target) => {
        normalize = /** @type {*} */ (target.getAttribute('data-normalize'));
        persist();
        await refresh(container);
    });
    on(container, 'click', '[data-widen-window]', async () => {
        windowPreset = 'all';
        customBounds = null;
        persist();
        await refresh(container);
    });

    on(container, 'click', '[data-show-all-rows]', async () => {
        showAllRows = true;
        await refresh(container);
        /** @type {HTMLElement | null} */ (container.querySelector('[data-table] tbody tr:last-child th'))?.focus();
    });

    on(container, 'click', '[data-csv]', () => {
        const data = plans.get();
        if (!data) return;
        try {
            const { headers, rows, units } = tableData(data);
            const csv = toCsv({
                headers,
                rows: rows.map((fila) => [
                    // ISO SIEMPRE en la primera columna: inequívoca, ordena bien
                    // como texto y la parsea cualquier hoja de cálculo.
                    String(fila[0]),
                    ...fila.slice(1).map((v, i) =>
                        (typeof v === 'number' ? formatNumber(v, units[i].decimals) : ''))
                ])
            });
            const url = URL.createObjectURL(toBlob(csv));
            const link = document.createElement('a');
            link.href = safeUrl(url);
            link.download = `transformlab-analisis-${plans.todayISO()}.csv`;
            link.click();
            URL.revokeObjectURL(url);
        } catch {
            // Si la descarga falla, los datos SIGUEN en la tabla: se dice eso,
            // no un error genérico que sugiera que se han perdido.
            toast.error('analysis.csv.failed');
        }
    });

    // Recorrido con teclado sobre el lienzo.
    on(container, 'keydown', '[data-canvas]', (event, _target) => {
        const data = plans.get();
        if (!data || !chartInstance) return;
        const today = plans.todayIndex(data, plans.todayISO());
        const consumed = chartInstance.handleKey({
            readout: /** @type {*} */ (container.querySelector('[data-readout]')),
            projection: data.projection,
            key: /** @type {KeyboardEvent} */ (event).key,
            range: windowBounds(data, today.dayIndex)
        });
        if (consumed) {
            event.preventDefault();
            updateLegendValues(container);
        }
    });
}

/**
 * Reescribe SOLO los valores de la leyenda, nunca la fila entera.
 *
 * Re-renderizar perdería el foco si está en un botón de quitar — el mismo
 * motivo por el que Proyección tiene `refreshPressed()` en vez de repintar.
 */
function updateLegendValues(/** @type {HTMLElement} */ container) {
    if (!chartInstance) return;
    const index = chartInstance.cursorIndex();
    for (const serie of resolved) {
        const nodo = container.querySelector(`[data-legend-value="${serie.spec.id}"]`);
        if (!nodo) continue;
        const punto = serie.points.find((p) => p.x === index);
        const unidad = UNITS[serie.unit];
        nodo.textContent = punto ? num(punto.y, unidad?.decimals ?? 1) : '—';
    }
}

function openPicker(/** @type {HTMLElement} */ container) {
    query = '';
    const dialog = modal.open({ titleKey: 'analysis.series.pickerTitle', size: 'lg', body: pickerBody() });

    /** Repinta el cuerpo ENTERO. Solo para la búsqueda, que cambia la lista. */
    const repaintAll = () => {
        const body = dialog.querySelector('.modal__body');
        if (body) render(/** @type {HTMLElement} */ (body), pickerBody());
    };

    /**
     * Repinta SOLO lo que cambia al marcar o desmarcar: la bandeja, su contador
     * y el aviso del tope.
     *
     * Repintar la lista entera destruye el nodo que el usuario acaba de pulsar
     * —y con él la posición del scroll y el foco—, así que marcar algo en
     * «Perímetros» devolvía la lista al principio. Con cincuenta filas eso hace
     * el selector inusable. Lo delató un test que no conseguía marcar cuatro
     * casillas seguidas.
     */
    const repaintTray = () => {
        const tray = dialog.querySelector('[data-picker-tray]');
        if (tray) render(/** @type {HTMLElement} */ (tray), trayBody());
        const limite = /** @type {HTMLElement | null} */ (dialog.querySelector('[data-picker-limit]'));
        if (limite) limite.hidden = selected.length < MAX_SERIES;
        // Las casillas que YA no están seleccionadas se desmarcan aquí, sin
        // recrearlas: es lo que mantiene vivo el nodo bajo el dedo del usuario.
        for (const box of dialog.querySelectorAll('[data-series]')) {
            const input = /** @type {HTMLInputElement} */ (box);
            const id = input.getAttribute('data-series') ?? '';
            input.checked = selected.includes(id);
        }
    };

    on(dialog, 'input', '[data-picker-search]', (_event, target) => {
        query = /** @type {HTMLInputElement} */ (target).value;
        const activo = document.activeElement;
        repaintAll();
        // Recrear el input en cada tecla haría imposible escribir: se devuelve
        // el foco y el cursor al final del texto.
        if (activo?.hasAttribute?.('data-picker-search')) {
            const nuevo = /** @type {HTMLInputElement | null} */ (dialog.querySelector('[data-picker-search]'));
            if (nuevo) {
                nuevo.focus();
                nuevo.setSelectionRange(nuevo.value.length, nuevo.value.length);
            }
        }
    });

    on(dialog, 'change', '[data-series]', async (_event, target) => {
        const input = /** @type {HTMLInputElement} */ (target);
        const id = input.getAttribute('data-series') ?? '';
        if (input.checked) {
            if (selected.length >= MAX_SERIES) {
                // NUNCA se quita nada solo. La casilla se desmarca y se dice
                // cuál se ha rechazado y qué hacer.
                input.checked = false;
                const nombre = t(seriesById(id)?.labelKey ?? id);
                toast.error('analysis.series.limitRefused', { name: nombre, max: MAX_SERIES });
                return;
            }
            selected = [...selected, id];
        } else {
            selected = selected.filter((s) => s !== id);
        }
        persist();
        repaintTray();
        // NO se vuelve a llamar a `wire`: los manejadores están DELEGADOS en el
        // contenedor, así que sobreviven al repintado de sus hijos. Volver a
        // registrarlos los duplicaba, y cada clic acababa disparando una vez por
        // cada cambio anterior — con dos casillas marcadas, la selección crecía
        // a saltos y el tope saltaba antes de tiempo.
        await refresh(container);
    });

    on(dialog, 'click', '[data-remove-series]', async (_event, target) => {
        const id = target.getAttribute('data-remove-series');
        selected = selected.filter((s) => s !== id);
        persist();
        repaintTray();
        await refresh(container);
    });
}

export function unmount() {
    detachGestures?.();
    detachGestures = null;
    windowPreset = 'all';
    customBounds = null;
    showAllRows = false;
    chartInstance?.destroy();
    chartInstance = null;
    manifest = null;
    resolved = [];
    context = null;
}

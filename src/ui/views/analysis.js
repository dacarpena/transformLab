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
import * as trainingStore from '../../data/training.js';
import { exercisesOf } from '../../data/training.js';
import { MAX_SERIES, PROVENANCE_STYLE } from '../series-style.js';
import { attachGestures, clampWindow } from '../chart-gestures.js';
import { pathOf, sample, windowRect } from '../spark.js';
import { buildMarks, MARK_CATEGORIES, openMarkCard } from '../marks.js';

/** @typedef {import('../../core/series-catalog.js').ResolvedSeries} ResolvedSeries */

/**
 * Comparaciones que responden a una pregunta real, no combinaciones bonitas.
 * La primera se aplica sola en la primera visita: un lienzo en blanco con un
 * botón «elige algo» no enseña qué hace la pantalla.
 */
const PRESETS = Object.freeze([
    // La primera es LA pregunta del producto —¿sube el músculo mientras baja la
    // grasa?— y faltaba: la primera prueba real quiso exactamente eso y no lo
    // encontró. Músculo en kg y grasa en %, dos unidades → dos ejes.
    { id: 'muscleVsFat', ids: ['proj_muscle_kg', 'proj_fat_pct', 'meas_fat_pct'] },
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
/**
 * Detalle DIARIO por defecto: el máximo que existe. La petición literal fue
 * «con todo el detalle posible», y el coste está pagado — los marcadores se
 * espacian solos (`markerEvery`) y a pantalla estrecha el grano efectivo baja a
 * semana. Quien prefiera menos, lo baja y se le guarda.
 * @type {'day'|'week'|'month'}
 */
let grain = 'day';
/** @type {'raw'|'delta'} */ let normalize = 'raw';
/**
 * Qué familias de hito se marcan sobre el lienzo (E14-3).
 *
 * Todas encendidas de salida: la queja que abrió E14 fue justamente que los
 * hitos no se veían, y estrenarlas apagadas repetiría el problema con un
 * interruptor delante. Vive en memoria y no en `settings`: el esquema
 * persistido de la vista se cierra en su propio commit, y una clave nueva sin
 * `opt()` es exactamente el defecto que costó las alergias en V2-M10.
 * @type {Set<string>}
 */
let markCategories = new Set(MARK_CATEGORIES);
/** Los del último dibujado, para la ficha del clic. @type {import('../chart.js').ChartMark[]} */
let marks = [];
/** @type {import('../../core/series-catalog.js').SeriesContext | null} */ let context = null;
/** @type {import('../chart.js').ChartInstance | null} */ let chartInstance = null;
/** @type {import('../chart.js').DrawManifest | null} */ let manifest = null;
/** @type {ResolvedSeries[]} */ let resolved = [];
/** Texto del buscador del selector. Vive fuera del modal para sobrevivir a su re-render. */
let query = '';

/**
 * Separador de los ids de serie parametrizada: `est_e1rm__<exerciseId>`.
 * Doble guion bajo y no punto: el punto rompería `SAFE_ID` y con él la
 * persistencia de la selección.
 */
const PARAM_SEP = '__';

/**
 * @typedef {Object} SeriesEntry
 * @property {string} id el que se persiste y viaja por el manifiesto
 * @property {import('../../core/series-catalog.js').SeriesSpec} spec
 * @property {string} [param] argumento de la serie parametrizada (exerciseId)
 * @property {string} label YA compuesta; para las normales, la traducción de su clave
 */

/**
 * Las series ELEGIBLES: el catálogo expandido para este perfil.
 *
 * Existe por una promesa incumplible que se coló en E13-1: `est_e1rm` («1RM
 * estimado») necesita un ejercicio como parámetro, y el selector la ofrecía
 * como una fila abstracta que ninguna interfaz podía rellenar — «sin datos
 * todavía» PARA SIEMPRE. Aquí la plantilla se expande a una fila por ejercicio
 * de la rutina, con su nombre, y la fila abstracta desaparece. Sin rutina no
 * hay filas de 1RM, que es la verdad.
 *
 * El catálogo del motor no se toca: la expansión depende de la rutina del
 * perfil, y eso es de la interfaz.
 * @type {Map<string, SeriesEntry>}
 */
let entries = new Map();

/** Reconstruye las entradas elegibles. Se llama al montar: la rutina no cambia
 *  mientras la vista está abierta. */
function rebuildEntries() {
    entries = new Map();
    for (const spec of SERIES) {
        if (spec.needs.includes('param')) continue;   // las plantillas no se ofrecen crudas
        entries.set(spec.id, { id: spec.id, spec, label: t(spec.labelKey) });
    }
    const e1rm = seriesById('est_e1rm');
    if (!e1rm) return;
    try {
        for (const ex of exercisesOf(trainingStore.read().routine)) {
            if (!ex?.id || typeof ex.name !== 'string') continue;
            entries.set(`est_e1rm${PARAM_SEP}${ex.id}`, {
                id: `est_e1rm${PARAM_SEP}${ex.id}`,
                spec: e1rm,
                param: ex.id,
                // El nombre lo escribió el usuario: `html\`\`` lo escapa al
                // pintarlo y `escapeField` lo neutraliza en el CSV.
                label: `${t('series.est_e1rm')} · ${ex.name}`
            });
        }
    } catch { /* sin rutina legible no hay filas de 1RM, y es la verdad */ }
}

/** @param {string} id @returns {SeriesEntry | null} */
function entryById(id) {
    return entries.get(id) ?? null;
}

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

/**
 * Un grupo de botones excluyentes, con su etiqueta A LA VISTA.
 *
 * La etiqueta era `aria-label` y solo existía para los lectores de pantalla:
 * quien mira la barra veía trece botones seguidos —«Todo · Fase actual · 90
 * días · Día · Semana · Valores reales»— sin ninguna pista de que fueran tres
 * preguntas distintas. Ahora el rótulo es un nodo real y el grupo lo usa con
 * `aria-labelledby`, así que **el nombre accesible y el visible son el mismo**:
 * no pueden divergir, que es como se estropean estas cosas.
 */
function segmented(/** @type {string} */ labelKey, /** @type {string} */ attr,
    /** @type {Array<{value: string, labelKey: string}>} */ options, /** @type {string} */ active) {
    const id = `cg-${attr.replace(/[^a-z]/g, '')}`;
    return html`
        <div class="control-group">
            <span class="control-group__label" id="${id}">${t(labelKey)}</span>
            <div class="segmented" role="group" aria-labelledby="${id}">
                ${options.map((o) => html`
                    <button type="button" class="btn btn--sm" ${attr}="${o.value}"
                            aria-pressed="${o.value === active ? 'true' : 'false'}">${t(o.labelKey)}</button>
                `)}
            </div>
        </div>
    `;
}

/**
 * El preset que describe la selección actual, o null si no la describe ninguno.
 *
 * Sin esto, los cuatro atajos se pintaban idénticos a los controles de estado
 * que tienen al lado y ninguno se marcaba nunca: parecían un grupo excluyente
 * que jamás recordaba tu elección. O son estado y lo enseñan, o son acciones y
 * se ven como acciones. Son las dos cosas —fijan la selección— así que se marca
 * el que coincide y punto.
 */
function activePreset() {
    const actual = [...selected].sort().join('|');
    return PRESETS.find((p) => [...p.ids].sort().join('|') === actual)?.id ?? null;
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
            <span class="series-legend__name">${item.label}</span>
            <span class="badge badge--outline badge--prov-${item.provenance}">${t(`series.provenance.${item.provenance}`)}</span>
            <span class="series-legend__meta muted">${meta}</span>
            <span class="series-legend__value numeric" data-legend-value="${item.id}"></span>
            ${vacia && windowPreset !== 'all'
                ? html`<button type="button" class="btn btn--sm" data-widen-window>${t('analysis.legend.widen')}</button>`
                : ''}
            <button type="button" class="btn btn--icon" data-remove-series="${item.id}"
                    aria-label="${t('analysis.series.remove', { name: item.label })}">
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

/** La vista entera. La gráfica MANDA: una sola tarjeta, sin antesalas. */
function view() {
    const efectivoGrano = effectiveGrain();
    const efectivaEscala = effectiveNormalize();

    return html`
        <section class="card" aria-labelledby="analysis-chart">
            <div class="card__header">
                <h1 id="analysis-chart" class="card__title">${t('analysis.title')}</h1>
                <span class="muted" data-series-count>${t('analysis.series.count', { count: selected.length, max: MAX_SERIES })}</span>
            </div>
            <!-- Primero QUÉ se mira. Es la acción principal de la vista y va
                 sola, separada de los controles de cómo se mira: mezclarlas en
                 una fila de trece botones era pedirle al usuario que adivinara
                 cuáles cambian los datos y cuáles la presentación. -->
            <div class="control-bar control-bar--primary">
                <button type="button" class="btn btn--primary" data-open-picker aria-haspopup="dialog">
                    ${t('analysis.series.choose')}
                </button>
                <!-- A 320 px los cuatro atajos y los once interruptores ocupan
                     pantalla y media, y la gráfica —que es la vista— quedaba
                     debajo del pliegue. Aquí se pliegan tras un control; en
                     escritorio el resorte se oculta por CSS, así que no hay dos
                     caminos: hay uno, plegado o no.

                     Nace ABIERTO y lo cierra collapseDrawer si la pantalla es
                     estrecha, nunca al revés. Dos motivos: interpolar un
                     atributo suelto no funciona —la plantilla escapa el espacio
                     y «open» acaba siendo texto, que es como este cajón nació
                     cerrado para todo el mundo y dejó los controles
                     inalcanzables en escritorio—; y si un día el JS de cerrar
                     no llega a correr, lo que queda es todo a la vista, que es
                     el fallo bueno. -->
                <details class="control-drawer" open>
                    <summary class="btn btn--sm">${t('analysis.controls.toggle')}</summary>
                    <div class="control-drawer__body">
                    <div class="control-bar">
                <div class="control-group control-group--grow">
                    <span class="control-group__label" id="cg-preset">${t('analysis.preset.label')}</span>
                    <div class="chip-row" role="group" aria-labelledby="cg-preset">
                        ${PRESETS.map((p) => html`
                            <button type="button" class="chip" data-preset="${p.id}"
                                    aria-pressed="${p.id === activePreset() ? 'true' : 'false'}">${t(`analysis.preset.${p.id}`)}</button>
                        `)}
                    </div>
                </div>
                    </div>
            <!-- Y después CÓMO se mira. Tres preguntas rotuladas, no once botones. -->
            <div class="control-bar">
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
                <!-- Los hitos NO son excluyentes: se encienden y apagan sueltos,
                     así que son interruptores, no un grupo de radio disfrazado. -->
                <div class="control-group">
                    <span class="control-group__label" id="cg-marks">${t('analysis.marks.label')}</span>
                    <div class="chip-row" role="group" aria-labelledby="cg-marks">
                        ${MARK_CATEGORIES.map((c) => html`
                            <button type="button" class="chip chip--mark is-mark-${c}" data-mark-cat="${c}"
                                    aria-pressed="${markCategories.has(c) ? 'true' : 'false'}">${t(`analysis.marks.${c}`)}</button>
                        `)}
                    </div>
                </div>
            </div>
                    </div>
                </details>
            </div>
            <p class="field__hint" data-effective-hint hidden></p>
            <p class="field__hint" data-marks-note hidden></p>

            <div class="chart-wrap" data-chart-host>
                <canvas data-canvas role="img" tabindex="0"
                        aria-label="${t('analysis.chart.label', { count: selected.length })}"
                        aria-describedby="analysis-keys"></canvas>
                <!-- Hermano del lienzo, no sustituto (E15-5). Sin acentos
                     graves aquí dentro: en una plantilla la CIERRAN. -->
                <div data-chart-fallback hidden></div>
            </div>
            <div class="context-strip" data-context-strip hidden></div>
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
                <div class="table-scroll" role="region" tabindex="0"
                     aria-label="${t('analysis.table.scrollRegion')}" data-table-scroll></div>
            </details>
            <div class="btn-row">
                <button type="button" class="btn btn--sm" data-csv>${t('analysis.csv.download')}</button>
                <button type="button" class="btn btn--sm" data-png>${t('action.downloadPng')}</button>
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
        name: serie.label ?? t(serie.spec.labelKey),
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
            actions: [{ labelKey: 'analysis.series.choose', action: 'open-picker', primary: true }]
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
    const disponibles = [...entries.values()].filter((entry) => {
        if (!q) return true;
        const texto = `${entry.label} ${t(/** @type {*} */ (UNITS)[entry.spec.unit]?.key ?? '')} ${t(`series.provenance.${entry.spec.provenance}`)}`;
        return texto.toLowerCase().includes(q);
    });

    const porGrupo = GROUP_ORDER
        .map((g) => ({ group: g, items: disponibles.filter((e) => e.spec.group === g) }))
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
                            ${g.items.map((entry) => {
                                const marcada = selected.includes(entry.id);
                                const sinDatos = !hasData(entry.id);
                                return html`
                                    <li class="picker__row">
                                        <label class="picker__label">
                                            <input type="checkbox" data-series="${entry.id}"
                                                   ${marcada ? 'checked' : ''}>
                                            <span class="picker__name">${entry.label}</span>
                                            <span class="badge badge--outline badge--prov-${entry.spec.provenance}">${t(`series.provenance.${entry.spec.provenance}`)}</span>
                                            <span class="picker__meta muted">
                                                ${t(/** @type {*} */ (UNITS)[entry.spec.unit]?.key ?? 'unit.kg')}${sinDatos ? ` · ${t('analysis.series.noData')}` : ''}
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

/**
 * El contador de la cabecera y el nombre accesible del lienzo, desde el
 * manifiesto de lo que se DIBUJÓ.
 *
 * Las dos cifras salen del mismo sitio a propósito: si el rótulo visible y el
 * `aria-label` contaran cosas distintas, quien usa lector de pantalla y quien
 * mira la pantalla estarían viendo dos gráficas.
 *
 * El contador de la BANDEJA del selector es otra cosa y sigue contando lo
 * elegido: allí la pregunta es «cuántas has marcado», no «cuántas se ven».
 * @param {HTMLElement} container
 */
function renderSeriesCount(container) {
    const rendered = manifest?.rendered ?? [];
    const dibujadas = rendered.filter((s) => s.pointCount > 0).length;
    const vacias = rendered.length - dibujadas;
    const texto = t('analysis.series.count', { count: dibujadas, max: MAX_SERIES })
        + (vacias > 0 ? ` ${t('analysis.series.countEmpty', { count: vacias })}` : '');

    const host = container.querySelector('[data-series-count]');
    if (host) host.textContent = texto;

    container.querySelector('[data-canvas]')
        ?.setAttribute('aria-label', t('analysis.chart.label', { count: dibujadas }));
}

/** La bandeja de elegidas. Se repinta SOLA al marcar, sin tocar la lista. */
function trayBody() {
    return html`
        <span class="muted">${t('analysis.series.count', { count: selected.length, max: MAX_SERIES })}</span>
        ${selected.length === 0
            ? html`<span class="muted">${t('analysis.series.trayEmpty')}</span>`
            : selected.map((id, i) => {
                const entry = entryById(id);
                return entry ? html`
                    <span class="picker__chip is-series-${i + 1}">
                        ${entry.label}
                        <button type="button" class="btn btn--icon" data-remove-series="${id}"
                                aria-label="${t('analysis.series.remove', { name: entry.label })}">
                            <span aria-hidden="true">✕</span>
                        </button>
                    </span>
                ` : '';
            })}
    `;
}

/** Si una serie tiene algo que dibujar con el contexto actual. */
function hasData(/** @type {string} */ id) {
    const entry = entryById(id);
    if (!entry || !context) return false;
    // El parámetro de una serie parametrizada se comprueba contra los datos de
    // verdad: un ejercicio de la rutina SIN sesiones registradas no tiene 1RM.
    if (entry.param) {
        const sessions = context.sessions ?? [];
        return sessions.some((s) => s?.entries?.some?.((e) => e?.exerciseId === entry.param));
    }
    return entry.spec.needs.every((need) => {
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
    if (!host || !canvas) {
        console.error('[analysis] falta el andamiaje de la gráfica', { host: !!host, canvas: !!canvas });
        return;
    }

    if (!await chart.ensureLoaded()) {
        console.error('[analysis] el vendor de Chart.js no llegó');
        chart.renderFallback(host);
        return;
    }
    if (!container.isConnected) return;

    const today = plans.todayIndex(data, plans.todayISO());
    const range = windowBounds(data, today.dayIndex);

    marks = buildMarks(data, today.dayIndex, {
        muscle: muscleUnitsOf(data),
        checkins: /** @type {*} */ (context?.checkins ?? []),
        categories: [...markCategories]
    });

    chartInstance = chartFor(canvas);
    manifest = chartInstance.drawMulti({
        canvas,
        readout: /** @type {*} */ (container.querySelector('[data-readout]')),
        projection: data.projection,
        series: resolved,
        todayIndex: today.dayIndex,
        range,
        normalize: effectiveNormalize(),
        marks,
        onMark: (group) => openMarkCard(group, data.projection.daily[group.dayIndex]?.dateISO ?? null),
        onMarksThinned: (hidden) => renderMarksNote(container, hidden),
        // A 320 px, ocho rótulos en el eje X se solapan.
        ...(isNarrow() ? { maxTicks: 4 } : {})
    });
    if (!manifest.ok && manifest.status === 'noChart') {
        console.error('[analysis] la gráfica no se pudo dibujar', manifest.status);
        chart.renderFallback(host);
    } else {
        // Un dibujado que sale bien limpia el error anterior (E15-5).
        chart.clearFallback(host);
    }

    // La leyenda se REHACE desde el manifiesto, siempre. Es la regla que impide
    // que anuncie una serie que el lienzo no dibujó.
    const legendHost = container.querySelector('[data-legend]');
    if (legendHost) {
        render(/** @type {HTMLElement} */ (legendHost),
            html`${(manifest.rendered ?? []).map(legendRow)}`);
    }

    // Y el contador, por la MISMA regla (E15-4). Leía `selected.length`, así que
    // una serie elegida con CERO puntos —una medida que el usuario todavía no ha
    // registrado— contaba como serie: se anunciaban «3 de 8 series» sobre un
    // lienzo con dos líneas. Medido en producción con `meas_fat_pct` y ningún
    // check-in.
    //
    // La LEYENDA no se toca: ya marca las vacías con su motivo y su botón de
    // «ampliar ventana», y hay un E2E desde E13-5 que exige que NO desaparezcan
    // —esconderlas sería mentir por el otro lado—. Lo que mentía era el número.
    renderSeriesCount(container);

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
    renderContextStrip(container, data);
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
        // SIN `?.` (E15-13). Antes esto llamaba a `instancia.scaleX?.()`, un
        // método que nunca ha existido en la factoría, y el encadenamiento
        // opcional lo convertía en degradación muda: siempre se tomaba el
        // respaldo, que interpola sobre `canvas.clientWidth` e ignora los ~40 px
        // de los rótulos del eje. El zoom anclaba en el día equivocado y el
        // paneo resbalaba, sin un solo error en consola. Si mañana la factoría
        // deja de exponer esto, tiene que ser un fallo de tipos, no un silencio.
        dayAtPixel: (px) => {
            const dia = instancia.dayAtPixel(px);
            if (dia !== null) return dia;
            // Respaldo para el instante entre montar el lienzo y dibujarlo, en
            // el que todavía no hay escala a la que preguntar.
            const today = plans.todayIndex(data, plans.todayISO());
            const w = windowBounds(data, today.dayIndex);
            return w.from + (px / Math.max(1, canvas.clientWidth)) * (w.to - w.from);
        },
        pixelsPerDay: () => {
            const pxDia = instancia.pixelsPerDay();
            if (pxDia !== null) return pxDia;
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
            // La tira se repinta con el gesto, no al final: si esperara al
            // siguiente dibujado completo, la ventana marcada iría un paso por
            // detrás del lienzo y señalaría un tramo que ya no es el visible.
            renderContextStrip(container, data);
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

/** Geometría de la tira, en unidades de `viewBox`. */
const STRIP = Object.freeze({ w: 1000, h: 40 });

/**
 * La tira de contexto: el plan ENTERO en miniatura, con la ventana marcada.
 *
 * POR QUÉ EXISTE. Con zoom, la gráfica deja de decir dónde estás: ves treinta
 * días sin saber si son los primeros o los últimos. La tira responde eso de un
 * vistazo — y es la mitad del zoom que faltaba, porque orientarse es lo que
 * convierte «acercarse» en «explorar».
 *
 * POR QUÉ SVG Y NO OTRA INSTANCIA DE CHART.JS. Mismo criterio que ya cerró
 * `muscle-grid.js` para gráficas pequeñas sin ejes: un `path` de cien puntos
 * hace el trabajo de un controlador completo con escalas y detección de
 * impactos, y una segunda instancia sería un segundo ciclo de vida que destruir
 * en cada `unmount` — por ahí sangró V2-M8 entera.
 *
 * `aria-hidden`: es un adorno de orientación. Lo que la tira enseña ya lo dicen
 * el eje X y la región `aria-live`, y duplicarlo en ARIA sería más superficie
 * para cero capacidad añadida. El teclado maneja la ventana desde el lienzo.
 *
 * @param {HTMLElement} container @param {*} data
 */
function renderContextStrip(container, data) {
    const host = /** @type {HTMLElement | null} */ (container.querySelector('[data-context-strip]'));
    if (!host) return;

    const total = data.plan.totalDays;
    const principal = resolved.find((r) => r.points.length > 1);
    const today = plans.todayIndex(data, plans.todayISO());
    const ventana = windowBounds(data, today.dayIndex);
    // Sin serie que perfilar, o con el plan entero a la vista, la tira no
    // aporta nada: se esconde en vez de dibujar un rectángulo que lo cubre todo.
    const completa = ventana.from <= 0 && ventana.to >= total;
    if (!principal || total <= 0 || completa) {
        host.hidden = true;
        render(host, html``);
        return;
    }
    host.hidden = false;

    const puntos = sample(principal.points, 120);
    const valores = puntos.map((p) => p.y);
    const min = Math.min(...valores);
    const max = Math.max(...valores);
    const d = pathOf(valores, min, max, STRIP.w, STRIP.h);

    const marco = windowRect(ventana.from, ventana.to, total, STRIP.w);

    render(host, html`
        <svg class="context-strip__svg" viewBox="0 0 ${STRIP.w} ${STRIP.h}"
             preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <path class="context-strip__line" d="${d}"></path>
            <rect class="context-strip__window" x="${marco.x}" y="0"
                  width="${marco.width}" height="${STRIP.h}"></rect>
        </svg>
        <p class="context-strip__hint muted">${t('analysis.strip.hint', {
            from: shortDate(data.projection.daily[Math.max(0, ventana.from)]?.dateISO ?? ''),
            to: shortDate(data.projection.daily[Math.min(total, ventana.to)]?.dateISO ?? '')
        })}</p>
    `);
}


/**
 * Dice cuántos marcadores no cupieron. Nunca se calla un recorte: una gráfica
 * que enseña doce de treinta hitos sin decirlo se lee como «hay doce».
 * @param {HTMLElement} container @param {number} hidden
 */
function renderMarksNote(container, hidden) {
    const nodo = /** @type {HTMLElement | null} */ (container.querySelector('[data-marks-note]'));
    if (!nodo) return;
    nodo.textContent = hidden > 0 ? t('analysis.marks.hidden', { count: hidden }) : '';
    nodo.hidden = hidden <= 0;
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
        .map((id) => entryById(id))
        .filter((e) => e !== null)
        .map((entry) => {
            const ctx = entry.param ? { ...context, param: entry.param } : context;
            const r = resolveSeries(entry.spec, /** @type {*} */ (ctx), anchors);
            // El id del manifiesto es el COMPUESTO: es el que la leyenda usa
            // para quitar la serie y el que se persiste. Y la etiqueta viaja ya
            // montada, porque la clave i18n sola no sabe qué ejercicio es.
            return { ...r, spec: { ...entry.spec, id: entry.id }, label: entry.label };
        });
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
/**
 * Pliega el cajón de controles si la pantalla es estrecha.
 *
 * Se hace desde JS y después de renderizar porque el marcado nace abierto (ver
 * el comentario del `<details>`): el estado por defecto es «todo a la vista», y
 * plegar es la excepción.
 * @param {HTMLElement} container
 */
function collapseDrawer(container) {
    const cajon = /** @type {HTMLDetailsElement | null} */ (container.querySelector('.control-drawer'));
    if (cajon && isNarrow()) cajon.open = false;
}

async function refresh(/** @type {HTMLElement} */ container) {
    const data = plans.get();
    if (!data) return;
    resolveSelection(data);

    // Destruir ANTES de repintar (E15-14). `render` reemplaza el `<canvas>`, y
    // `chartFor` crea una instancia nueva por lienzo a través de un `WeakMap`:
    // sin esto, cada repintado dejaba una instancia de Chart.js viva colgada de
    // un nodo desconectado, retenida por el registro interno de la librería.
    // Y `refresh` se llama desde ONCE sitios —métrica, ventana, granularidad,
    // normalización, cada filtro de hito, el selector, la tabla—, así que tras
    // veinte toques la vista se volvía pegajosa.
    //
    // `unmount()` ya lo hacía; `refresh` es el camino que se olvidó. Proyección
    // no lo sufre porque usa `redraw()` sin re-renderizar el lienzo.
    chartInstance?.destroy();
    chartInstance = null;

    render(container, selected.length === 0 ? emptySelection() : view());
    collapseDrawer(container);
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
    rebuildEntries();

    // Selección guardada, filtrando los ids que ya no existen. Se DICE cuántos
    // se han caído: un backup de otro perfil o una serie retirada no pueden
    // tumbar la vista, ni desaparecer en silencio.
    const guardado = settingsStore.read().analysis;
    if (guardado) {
        const validos = guardado.seriesIds.filter((id) => entryById(id) !== null);
        const perdidos = guardado.seriesIds.length - validos.length;
        selected = validos.slice(0, MAX_SERIES);
        windowPreset = /** @type {*} */ (guardado.window);
        grain = /** @type {*} */ (guardado.grain);
        normalize = /** @type {*} */ (guardado.normalize);
        if (perdidos > 0) toast.success('analysis.series.dropped', { count: perdidos });
    }
    // Primera visita: una comparación rápida aplicada sola. Un lienzo en blanco
    // no enseña qué hace la pantalla.
    if (selected.length === 0 && !guardado) {
        const inicial = PRESETS.find((p) => p.id === 'planVsReal') ?? PRESETS[0];
        selected = [...inicial.ids];
    }

    await refresh(container);
    wire(container);
}

function wire(/** @type {HTMLElement} */ container) {
    // El respaldo ofrece reintentar antes que recargar: el fallo típico es
    // transitorio y recargar cuesta todo lo que el usuario tuviera a medias.
    on(container, 'click', '[data-action="retry-chart"]', () => { void redraw(container); });

    // Dos selectores, un oyente. El botón de la barra lleva `data-open-picker`;
    // el del estado sin selección lo pinta `components/state.js`, que SIEMPRE
    // emite `data-action="<id>"`. Estaba declarado como `openPicker` y nadie lo
    // escuchaba: deseleccionabas todas las series y el botón principal —el único
    // camino de vuelta— no hacía nada.
    on(container, 'click', '[data-open-picker], [data-action="open-picker"]', () => openPicker(container));

    on(container, 'click', '[data-preset]', async (_event, target) => {
        const preset = PRESETS.find((p) => p.id === target.getAttribute('data-preset'));
        if (!preset) return;
        selected = [...preset.ids];
        persist();
        await refresh(container);
        const nombres = selected.map((id) => entryById(id)?.label ?? id).join(', ');
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
    on(container, 'click', '[data-mark-cat]', async (_event, target) => {
        const cat = target.getAttribute('data-mark-cat');
        if (!cat) return;
        // Apagar la última no deja la gráfica sin explicación: el propio botón
        // queda sin pulsar, que es la señal. No se impide, porque quitarlos
        // todos es una petición legítima cuando se comparan series finas.
        if (markCategories.has(cat)) markCategories.delete(cat);
        else markCategories.add(cat);
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

    on(container, 'click', '[data-png]', () => {
        // El PNG solo se ofrece cuando hay gráfica: sin ella no hay nada que
        // exportar y un fichero vacío sería peor que el aviso.
        const url = chartInstance?.toPng() ?? null;
        if (!url) {
            toast.error('chart.unavailableTitle');
            return;
        }
        const link = document.createElement('a');
        link.href = safeUrl(url);
        link.download = `transformlab-analisis-${plans.todayISO()}.png`;
        link.click();
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
                const nombre = entryById(id)?.label ?? id;
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

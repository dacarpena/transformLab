// @ts-check

/**
 * Gráfica de la proyección (decisión D3). Chart.js se sirve desde `vendor/`
 * (tensión 3 del plan: CSP `'self'` y funcionamiento offline).
 *
 * Capas, de fondo a frente: bandas de fase · banda de escenarios
 * (relleno entre pesimista y optimista) · línea esperada · línea vertical HOY
 * · marcadores de hito.
 *
 * Accesibilidad (F7): el `<canvas>` es inerte para un lector de pantalla, así
 * que la serie se recorre con el teclado y cada punto se anuncia en una región
 * `aria-live`. Es la alternativa textual, no un adorno.
 *
 * Si Chart.js no está disponible, se muestra un mensaje con recarga. NUNCA una
 * acción destructiva como salida de un error (ficha H-013 del catálogo).
 */

import { html, render } from './dom.js';
import { t } from '../i18n/i18n.js';
import { muscleUnitsFor } from './muscle-units.js';
import { axisLabel, longDate } from './dates.js';
import { num } from './format.js';
import { UNITS } from '../core/series-catalog.js';
import { planAxes, axisIdFor, styleFor, rebase, axisSpan, MAX_SERIES } from './series-style.js';

/** @typedef {import('../core/generator.js').Projection} Projection */
/** @typedef {import('../core/engine.js').PhasePlan} PhasePlan */
/** @typedef {import('./muscle-units.js').MuscleUnits} MuscleUnits */

/**
 * La región `aria-live` donde se anuncia el punto bajo el cursor.
 *
 * NO se declara `HTMLElement` a propósito: `chart-factory.spec.js` le pasa un
 * doble `{ textContent: '' }`, y hoy eso funciona por accidente porque el tipo
 * miente. Con este typedef el contrato queda en el sistema de tipos, y un
 * `HTMLElement` real sigue siendo asignable.
 * @typedef {{ textContent: string | null }} Readout
 *
 * @typedef {Object} DrawSeriesOptions
 * @property {HTMLCanvasElement} canvas
 * @property {*[]} datasets objetos de dataset de Chart.js, YA construidos por el
 *   llamador, en el orden EXACTO en que van a `data.datasets`
 * @property {{ from: number, to: number }} range ventana visible, en índices de día
 * @property {(value: number, span: number) => string} xTickLabel rótulo del eje X
 * @property {(items: *[]) => string} [tooltipTitle]
 * @property {Array<{ id: string, position: 'left'|'right', beginAtZero?: boolean, minSpan?: number }>} [yAxes]
 *   omitido = UN eje `y` a la izquierda y **cero `yAxisID` en los datasets**, que
 *   es exactamente la configuración que produce hoy el camino de una métrica
 * @property {*[]} [extraPlugins]
 * @property {number} [maxTicks]
 * @property {number} [clickDatasetIndex] dataset cuyos puntos abren ficha; -1 = ninguno
 * @property {(index: number) => void} [onPointClick]
 * @property {Array<{ x: number, group: MarkGroup }>} [markHitBoxes] los rellena `marksPlugin`
 * @property {(group: MarkGroup) => void} [onMarkClick]
 *
 * @typedef {Object} RenderedSeries
 * @property {string} id
 * @property {string} label ya traducida (o compuesta, si la serie es parametrizada)
 * @property {number} slot 0..3, y por tanto qué color le tocó
 * @property {number} pointCount cuántos puntos ENTRARON en el lienzo
 * @property {string} axis 'y' o 'y2'
 * @property {import('../core/series-catalog.js').UnitId} unit
 * @property {import('../core/series-catalog.js').Provenance} provenance
 * @property {string|null} reason clave i18n si quedó vacía, o null
 *
 * @typedef {Object} DrawManifest
 * @property {boolean} ok
 * @property {RenderedSeries[]} rendered lo que se dibujó DE VERDAD
 * @property {Array<{ id: string, unit: string, position: string, series: number[] }>} axes
 * @property {'ok'|'empty'|'tooManyUnits'|'noChart'} status
 * @property {number|null} baselineX día desde el que se mide el cambio, o null
 *
 * @typedef {Object} DrawMultiOptions
 * @property {HTMLCanvasElement} canvas
 * @property {Readout} [readout]
 * @property {Projection} projection
 * @property {import('../core/series-catalog.js').ResolvedSeries[]} series 1..4, YA
 *   pasadas por la aduana de músculo
 * @property {number} todayIndex
 * @property {{ from: number, to: number }} range
 * @property {'raw'|'delta'} [normalize]
 * @property {number} [maxTicks]
 * @property {ChartMark[]} [marks] hitos a marcar como columnas (E14-3)
 * @property {(group: MarkGroup) => void} [onMark] clic sobre un marcador
 * @property {(hiddenCount: number) => void} [onMarksThinned] cuántos no cupieron
 */

/** @returns {*} el global Chart, o null si el vendor no cargó */
function getChartLib() {
    return /** @type {*} */ (globalThis).Chart ?? null;
}

/** @type {Promise<boolean> | null} */
let loadPromise = null;

/**
 * Carga Chart.js bajo demanda desde `vendor/`.
 *
 * Son 208 KB, el recurso más pesado con diferencia, y no hace falta ninguno
 * para pintar la primera pantalla: se pedía en el `<head>` y competía por el
 * ancho de banda con lo que el usuario sí está esperando. Ahora se pide
 * cuando toca dibujar una gráfica.
 *
 * Sigue siendo del propio origen (CSP `script-src 'self'`) y sigue sin CDN.
 * Si falla, `draw` devuelve false y la vista enseña su estado de error: nunca
 * una acción destructiva (ficha H-013).
 * @returns {Promise<boolean>} true si la biblioteca está disponible
 */
export function ensureLoaded() {
    if (getChartLib()) return Promise.resolve(true);
    if (loadPromise) return loadPromise;
    if (typeof document === 'undefined') return Promise.resolve(false);

    loadPromise = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = 'vendor/chart.umd.min.js';
        script.addEventListener('load', () => resolve(Boolean(getChartLib())), { once: true });
        script.addEventListener('error', () => {
            // Se descarta la promesa fallida para que un reintento del usuario
            // (recargar la vista) vuelva a intentarlo de verdad.
            loadPromise = null;
            resolve(false);
        }, { once: true });
        document.head.appendChild(script);
    });
    return loadPromise;
}

/**
 * Lee un token de color del documento (D8: los colores viven en tokens.css,
 * también los que consume el canvas). Si el token no resuelve, se cae al de
 * texto secundario en vez de a un hex inventado.
 */
function cssVar(/** @type {*} */ name) {
    const hit = tokenCache.get(name);
    if (hit !== undefined) return hit;
    if (typeof getComputedStyle !== 'function') return '';
    const styles = getComputedStyle(document.documentElement);
    const value = styles.getPropertyValue(name).trim()
        || styles.getPropertyValue('--color-text-secondary').trim();
    tokenCache.set(name, value);
    return value;
}

/**
 * Tokens ya resueltos del dibujado en curso.
 *
 * `getComputedStyle` fuerza un recálculo de estilo, y los dos plugins lo
 * pedían unas ocho veces por FOTOGRAMA: durante los 250 ms de animación eso
 * son más de cien recálculos para leer seis colores que no cambian. Se vacía
 * al empezar cada `draw()`, que es justo cuando el tema podría haber cambiado.
 * @type {Map<string, string>}
 */
const tokenCache = new Map();

/**
 * Los tramos contiguos de una misma fase, en índices de día.
 *
 * Se calcula UNA vez por dibujado y no dentro del plugin. La diferencia no es
 * estética: el plugin se ejecuta en CADA fotograma, y con 250 ms de animación
 * son unos quince por dibujado. Recorrer ahí los 1096 días de un plan de tres
 * años son ~16 000 iteraciones para pintar seis rectángulos. Precalculado son
 * seis, y ese margen es justo el que pagan cuatro series simultáneas.
 * Se exporta solo para poder probarlo desde Node: un plugin que dibuja no se
 * puede comprobar sin navegador, pero los tramos que consume sí.
 * @param {Projection} projection
 * @returns {Array<{ from: number, to: number, phaseType: string }>}
 */
export function phaseSpansOf(projection) {
    const daily = projection?.daily;
    if (!Array.isArray(daily) || daily.length === 0) return [];
    /** @type {Array<{ from: number, to: number, phaseType: string }>} */ const spans = [];
    let start = 0;
    for (let i = 1; i <= daily.length; i++) {
        if (i !== daily.length && daily[i].phaseType === daily[start].phaseType) continue;
        spans.push({ from: start, to: i - 1, phaseType: daily[start].phaseType });
        start = i;
    }
    return spans;
}

/**
 * Plugin de bandas de fase: pinta el fondo por tramos usando el color del
 * token de cada fase. Va detrás de todo lo demás.
 * @param {Projection} projection
 */
function phaseBandsPlugin(projection) {
    const spans = phaseSpansOf(projection);
    return {
        id: 'phaseBands',
        beforeDatasetsDraw(/** @type {*} */ chart) {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea || !scales.x) return;
            ctx.save();
            // RECORTE OBLIGATORIO. Este plugin usa índices absolutos, así que en
            // cuanto la ventana deja de empezar en el día 0 hay fases cuyos
            // píxeles caen fuera del área de trazado, y `fillRect` no las
            // recorta solo: pintaría el fondo de color por encima de los
            // rótulos del eje. No se notaba antes porque la ventana siempre iba
            // de 0 al final (E12).
            ctx.beginPath();
            ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
            ctx.clip();
            for (const span of spans) {
                const x1 = scales.x.getPixelForValue(span.from);
                const x2 = scales.x.getPixelForValue(span.to);
                ctx.globalAlpha = 0.10;
                ctx.fillStyle = cssVar(`--color-phase-${span.phaseType}`);
                ctx.fillRect(x1, chartArea.top, Math.max(1, x2 - x1), chartArea.bottom - chartArea.top);
            }
            ctx.restore();
        }
    };
}

/**
 * Plugin de la línea vertical de HOY (decisión D2a).
 * @param {() => number} getTodayIndex
 */
function todayLinePlugin(getTodayIndex) {
    return {
        id: 'todayLine',
        afterDatasetsDraw(/** @type {*} */ chart) {
            const { ctx, chartArea, scales } = chart;
            const index = getTodayIndex();
            if (!chartArea || !scales.x || index < 0) return;
            const x = scales.x.getPixelForValue(index);
            if (!Number.isFinite(x)) return;
            // Si HOY cae fuera de la ventana, la línea NO se dibuja. Recortar
            // no basta: una etiqueta «HOY» cortada por la mitad contra el
            // borde es peor que ninguna, porque señala un sitio que no es.
            if (x < chartArea.left || x > chartArea.right) return;
            ctx.save();
            ctx.strokeStyle = cssVar('--color-text');
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, chartArea.top);
            ctx.lineTo(x, chartArea.bottom);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = cssVar('--color-text');
            ctx.font = '11px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(t('chart.today'), x, chartArea.top - 4);
            ctx.restore();
        }
    };
}

/* ------------------------------------------------------------------ *
 * Marcadores de hito sobre el lienzo (E14-3)
 * ------------------------------------------------------------------ */

/**
 * @typedef {'phase' | 'risk' | 'health' | 'body' | 'aesthetic'} MarkKind
 *
 * @typedef {Object} ChartMark
 * @property {number} dayIndex
 * @property {string} label YA traducido: el lienzo no sabe de idiomas
 * @property {MarkKind} kind
 * @property {string} [detail] la fuente del umbral, para la ficha
 *
 * @typedef {Object} MarkGroup
 * @property {number} dayIndex
 * @property {MarkKind} kind la de mayor prioridad del grupo
 * @property {ChartMark[]} marks
 */

/**
 * Prioridad de los marcadores, de más a menos.
 *
 * No es estética: decide QUÉ se ve cuando dos hitos caen tan juntos que sus
 * marcadores se tocarían. Un aviso de salud tapado por el hito estético número
 * 54 sería exactamente al revés de lo que hace falta.
 */
export const MARK_PRIORITY = /** @type {readonly MarkKind[]} */ (
    Object.freeze(['risk', 'phase', 'health', 'body', 'aesthetic']));

/** Token de color por tipo. El color NO carga solo con el significado: la ficha lo dice con palabras. */
const MARK_COLOR = Object.freeze({
    risk: '--color-danger',
    phase: '--color-accent',
    health: '--color-success',
    body: '--color-warning',
    aesthetic: '--color-text-muted'
});

/**
 * Junta en un solo marcador los hitos que caen el mismo día.
 *
 * Un plan típico alcanza varios hitos estéticos a la vez —el catálogo tiene 97
 * fichas sobre los mismos dos umbrales—, y pintar cinco triángulos en la misma
 * columna de píxeles no dibuja cinco cosas: dibuja una mancha.
 *
 * @param {ChartMark[]} marks
 * @returns {MarkGroup[]} ordenados por día
 */
export function groupMarks(marks) {
    if (!Array.isArray(marks)) return [];
    /** @type {Map<number, ChartMark[]>} */ const byDay = new Map();
    for (const m of marks) {
        if (!m || !Number.isFinite(m.dayIndex)) continue;
        const day = Math.round(m.dayIndex);
        const list = byDay.get(day) ?? [];
        list.push(m);
        byDay.set(day, list);
    }
    return [...byDay.entries()]
        .map(([dayIndex, list]) => ({
            dayIndex,
            kind: MARK_PRIORITY.find((k) => list.some((m) => m.kind === k)) ?? 'aesthetic',
            marks: [...list].sort((a, b) => MARK_PRIORITY.indexOf(a.kind) - MARK_PRIORITY.indexOf(b.kind))
        }))
        .sort((a, b) => a.dayIndex - b.dayIndex);
}

/**
 * Descarta los marcadores que no caben, por prioridad y no por orden de llegada.
 *
 * Y devuelve **cuántos ha descartado**: un recorte silencioso se lee como «esto
 * es todo lo que hay», que es justo la mentira que este proyecto persigue. La
 * vista lo dice en una línea bajo la gráfica.
 *
 * @param {MarkGroup[]} groups
 * @param {number} plotWidthPx ancho útil del lienzo
 * @param {{ from: number, to: number }} range ventana visible, en días
 * @param {number} [minGapPx] separación mínima entre dos marcadores. 20 px es
 *   algo más que el triángulo (12 px): pegados se leen como una banda continua
 *   y deja de verse dónde empieza cada uno.
 * @returns {{ visible: MarkGroup[], hiddenCount: number }}
 */
export function thinMarks(groups, plotWidthPx, range, minGapPx = 20) {
    if (!Array.isArray(groups) || groups.length === 0) return { visible: [], hiddenCount: 0 };
    const span = (range?.to ?? 0) - (range?.from ?? 0);
    const dentro = groups.filter((g) => g.dayIndex >= range.from && g.dayIndex <= range.to);
    if (!Number.isFinite(plotWidthPx) || plotWidthPx <= 0 || span <= 0) {
        return { visible: dentro, hiddenCount: 0 };
    }
    const px = (/** @type {number} */ day) => ((day - range.from) / span) * plotWidthPx;

    // Se recorre por prioridad, no por fecha: si el primer día del plan trae un
    // hito estético y el segundo un aviso de salud, recorrer por fecha dejaría
    // fuera el aviso.
    const orden = [...dentro].sort((a, b) => {
        const p = MARK_PRIORITY.indexOf(a.kind) - MARK_PRIORITY.indexOf(b.kind);
        return p !== 0 ? p : a.dayIndex - b.dayIndex;
    });
    /** @type {MarkGroup[]} */ const aceptados = [];
    for (const g of orden) {
        const x = px(g.dayIndex);
        if (aceptados.some((a) => Math.abs(px(a.dayIndex) - x) < minGapPx)) continue;
        aceptados.push(g);
    }
    return {
        visible: aceptados.sort((a, b) => a.dayIndex - b.dayIndex),
        hiddenCount: dentro.length - aceptados.length
    };
}

/** Radio de acierto del clic sobre un marcador: el triángulo mide 12 px de ancho. */
const MARK_HIT_PX = 12;

/**
 * Dibuja los marcadores como columnas verticales, no como puntos sobre una línea.
 *
 * Es la única forma honesta con varias series: un punto necesita un valor en
 * ALGÚN eje, y con dos unidades a la vez elegir eje es elegir a cuál de las dos
 * se le miente sobre la altura. Una columna no afirma ninguna altura: afirma un
 * DÍA, que es lo único que el hito sabe de verdad.
 *
 * @param {() => MarkGroup[]} getGroups
 * @param {Array<{ x: number, group: MarkGroup }>} hitBoxes se rellena al dibujar
 * @param {((hiddenCount: number) => void) | undefined} onThinned
 */
function marksPlugin(getGroups, hitBoxes, onThinned) {
    const GLYPH = 6;
    let lastHidden = -1;
    return {
        id: 'milestoneMarks',
        afterDatasetsDraw(/** @type {*} */ chart) {
            hitBoxes.length = 0;
            const { ctx, chartArea, scales } = chart;
            if (!chartArea || !scales.x) return;
            // El adelgazamiento se hace AQUÍ y no al construir, con el área real
            // y la ventana real: al hacer zoom entran más marcadores porque de
            // verdad caben, y el recuento de ocultos no se queda rancio.
            const { visible, hiddenCount } = thinMarks(
                getGroups(),
                chartArea.right - chartArea.left,
                { from: scales.x.min, to: scales.x.max }
            );
            if (hiddenCount !== lastHidden) {
                lastHidden = hiddenCount;
                if (onThinned) onThinned(hiddenCount);
            }
            for (const group of visible) {
                const x = scales.x.getPixelForValue(group.dayIndex);
                if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) continue;
                const color = cssVar(MARK_COLOR[group.kind] ?? MARK_COLOR.aesthetic);
                ctx.save();
                // Una marca de regla, NO una línea de arriba abajo. La primera
                // versión cruzaba el lienzo entero y con treinta hitos el plan
                // quedaba detrás de una empalizada: los marcadores tapaban justo
                // las series que venían a anotar. La columna completa no añadía
                // información —el día ya lo dice la posición— y sí quitaba la
                // que el usuario vino a mirar.
                ctx.globalAlpha = 0.55;
                ctx.strokeStyle = color;
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top + GLYPH * 1.6);
                ctx.lineTo(x, chartArea.top + GLYPH * 3);
                ctx.stroke();
                ctx.globalAlpha = 1;
                // Triángulo colgando del borde superior. Apunta hacia abajo, a su
                // propia columna: hacia arriba señalaría fuera del lienzo.
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(x - GLYPH, chartArea.top);
                ctx.lineTo(x + GLYPH, chartArea.top);
                ctx.lineTo(x, chartArea.top + GLYPH * 1.6);
                ctx.closePath();
                ctx.fill();
                ctx.restore();
                hitBoxes.push({ x, group });
            }
        }
    };
}

/**
 * Etiqueta legible de un hito.
 *
 * El umbral de los hitos de músculo es un NIVEL absoluto de músculo
 * esquelético, así que hay que traducirlo como cualquier otro nivel: si el
 * usuario lee su gráfica en cifras de báscula, el hito que se marca en la
 * línea tiene que decir esa misma cifra. Deja de ser un número redondo, y es
 * el precio correcto: la alternativa es un punto cuya etiqueta no coincide con
 * el eje sobre el que está dibujado.
 * @param {import('../core/generator.js').Milestone} milestone
 * @param {MuscleUnits} [muscle]
 */
export function milestoneLabel(milestone, muscle = muscleUnitsFor(null)) {
    if (milestone.category === 'muscleKg' && muscle.isScale && typeof milestone.threshold === 'number') {
        return t('milestone.muscleKg', { threshold: num(muscle.toDisplay(milestone.threshold)) });
    }
    const threshold = milestone.category === 'phase'
        ? t(`phase.${milestone.threshold}`)
        : milestone.threshold;
    return t(`milestone.${milestone.category}`, { threshold: /** @type {string|number} */ (threshold) });
}

/**
 * Si un check-in real se dibuja o no en la métrica pedida.
 *
 * FUENTE ÚNICA de esa decisión, y existe porque había dos. El lienzo filtraba
 * por métrica mientras `plan-chart.js` contaba `evaluations.length` a secas, así
 * que con métrica «grasa» y check-ins sin porcentaje la leyenda anunciaba la
 * serie «Check-in» y el lienzo no pintaba ni un punto. El JSDoc de aquel
 * contador prometía «cuántos entraron en el lienzo» y no era verdad.
 *
 * Las tres reglas, con su motivo:
 * - `fatPct`: solo si el check-in trae porcentaje. Es opcional en el formulario.
 * - `muscle`: solo con báscula. El check-in guarda la cifra de la báscula (E11)
 *   y el eje ya está en esa unidad, así que se pinta TAL CUAL, sin conversión:
 *   es una medición, no un nivel del motor. Sin báscula no hay dato que pintar.
 * - `kcal`: nunca. Un check-in es un peso; en un eje de kcal no significa nada.
 *
 * @param {'weight'|'fatPct'|'muscle'|'kcal'} metric
 * @param {boolean} isScale si el perfil mide el músculo con báscula
 * @param {{ fatPct?: number|null, scaleMuscleKg?: number|null }} record
 * @returns {boolean}
 */
export function checkinAppliesTo(metric, isScale, record) {
    if (metric === 'kcal') return false;
    if (metric === 'fatPct') return record.fatPct !== null && record.fatPct !== undefined;
    if (metric === 'muscle') return isScale && Number.isFinite(record.scaleMuscleKg);
    return true;
}

/**
 * Los índices de día que se dibujan según la granularidad pedida.
 *
 * Se DERIVAN de los agregados que el generador ya produce; no se recalculan
 * los bloques aquí. Recalcularlos sería duplicar las reglas de GEN-07 (semanas
 * de siete días desde el día 1) y GEN-11/12 (meses de calendario), y el día que
 * alguien tocara el generador las dos versiones divergirían en silencio.
 *
 * El día 0 se ancla siempre a mano: los agregados arrancan en el día 1, así que
 * sin él la línea no empezaría en el estado real de partida del usuario.
 *
 * @param {Projection} projection
 * @param {'day'|'week'|'month'} grain
 * @returns {number[]} índices absolutos, crecientes, empezando en 0
 */
export function seriesAnchors(projection, grain) {
    const daily = projection?.daily;
    if (!Array.isArray(daily) || daily.length === 0) return [];
    if (grain === 'day') return daily.map((_, i) => i);

    /** @type {Map<string, number>} */
    const indexOf = new Map();
    for (let i = 0; i < daily.length; i++) indexOf.set(daily[i].dateISO, i);

    const blocks = grain === 'week' ? projection.weekly : projection.monthly;
    const out = [0];
    for (const b of blocks ?? []) {
        const i = indexOf.get(b.endISO);
        if (i !== undefined && i > out[out.length - 1]) out.push(i);
    }
    return out;
}

/**
 * @typedef {Object} ChartInstance
 * @property {(options: *) => boolean} draw
 * @property {(options: DrawMultiOptions) => DrawManifest} drawMulti
 * @property {(options: DrawSeriesOptions) => boolean} drawSeries
 * @property {() => void} destroy
 * @property {(from: number, to: number) => boolean} setWindow
 * @property {(readout: Readout, projection: Projection, index: number) => void} announce
 * @property {(readout: Readout, projection: Projection, index: number) => void} announceMulti
 * @property {(readout: Readout, projection: Projection, delta: number) => boolean} focusSeries
 * @property {() => number} activeSeriesIndex
 * @property {() => number} cursorIndex
 * @property {(readout: Readout, projection: Projection, index: number, range: {from: number, to: number}) => void} focusDay
 * @property {(options: *) => boolean} handleKey
 * @property {() => string | null} toPng
 */

/**
 * La unidad del catálogo que corresponde a cada métrica del camino de UNA sola
 * serie (`draw`).
 *
 * Existe para que ese camino comparta el suelo de eje con el de varias series
 * en vez de tener su propia tabla de cifras: si divergieran, la misma serie se
 * dibujaría con dos escalas mínimas distintas según la vista desde la que se
 * mira, que es exactamente la clase de incoherencia que este proyecto persigue.
 *
 * @param {'weight'|'fatPct'|'muscle'|'kcal'} metric
 * @param {boolean} isScale el perfil habla en unidades de báscula
 * @returns {number | undefined}
 */
function minSpanForMetric(metric, isScale) {
    if (metric === 'fatPct') return UNITS.pct?.minSpan;
    if (metric === 'kcal') return UNITS.kcal?.minSpan;
    if (metric === 'muscle') {
        return (isScale ? UNITS.kgMuscleScale : UNITS.kgMuscleSkeletal)?.minSpan;
    }
    return UNITS.kgBody?.minSpan;
}

/**
 * Recorrido real de los datos que van a parar a un eje.
 *
 * `singleAxis` existe porque con un solo eje los datasets NO llevan `yAxisID`
 * —es una regla dura de `series-style.js`: escribirlo cambiaría la
 * configuración que produce el camino de una sola métrica, cuyos contratos de
 * test son posicionales—. Así que ahí valen todos.
 *
 * @param {*[]} datasets
 * @param {string} axisId
 * @param {boolean} singleAxis
 * @returns {{ min: number, max: number } | null} `null` si no hay un solo valor finito
 */
function axisExtent(datasets, axisId, singleAxis) {
    let min = Infinity;
    let max = -Infinity;
    for (const ds of datasets ?? []) {
        if (!singleAxis && (ds?.yAxisID ?? 'y') !== axisId) continue;
        for (const point of ds?.data ?? []) {
            const y = typeof point === 'number' ? point : point?.y;
            if (!Number.isFinite(y)) continue;
            if (y < min) min = y;
            if (y > max) max = y;
        }
    }
    return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}


/**
 * Crea una gráfica con su PROPIO estado (V2-M8).
 *
 * POR QUÉ DEJÓ DE SER UN SINGLETON. Hasta aquí `chartInstance`, `cursor`,
 * `muscleUnits` y `announceMetric` eran variables de MÓDULO: había UNA gráfica,
 * no una por lienzo. Y como `draw()` destruye la instancia previa, dibujar la
 * segunda mataba la primera **sin un solo error**. Reproducido antes de tocar
 * nada: tras el segundo `draw()` el primer lienzo quedaba en 0 píxeles pintados
 * y ancho 300 —Chart.js lo había reseteado— mientras el segundo tenía 57 508, y
 * las DOS llamadas devolvieron `true`. La región `aria-live` del primero seguía
 * describiendo una gráfica que ya no existía.
 *
 * Eso hacía imposibles la rejilla músculo a músculo (V2-M9), que es una gráfica
 * por grupo, y comparar dos perfiles lado a lado.
 *
 * QUÉ SIGUE COMPARTIDO, y con razón: el cargador del vendor (`ensureLoaded`),
 * que debe pedir Chart.js UNA vez aunque haya doce gráficas; el caché de tokens
 * del tema, que da el mismo color a todas; y las funciones puras
 * (`seriesAnchors`, `milestoneLabel`).
 *
 * @returns {ChartInstance}
 */
export function createChart() {
    /** @type {*} */
    let chartInstance = null;

    /** Índice del punto activo para el recorrido con teclado. */
    let cursor = 0;

    /**
     * Unidad de músculo con la que se dibujó la última vez (E11).
     *
     * Es estado de ESTA gráfica: el recorrido con teclado ocurre mucho después
     * del `draw()` y tiene que anunciar la MISMA cifra que se ve en el lienzo.
     * Un lector de pantalla que dijera 29,2 mientras el eje marca 56,6 estaría
     * describiendo otra gráfica.
     * @type {MuscleUnits}
     */
    let muscleUnits = muscleUnitsFor(null);

    /**
     * Métrica con la que se dibujó la última vez, por la misma razón que
     * `muscleUnits`: si el lienzo muestra calorías y la región `aria-live`
     * recita kilos, el lector está describiendo otra gráfica (E12).
     * @type {'weight'|'fatPct'|'muscle'|'kcal'}
     */
    let announceMetric = 'weight';

    /**
     * En qué modo se dibujó: una métrica del plan, o series del catálogo.
     * Lo mismo que `announceMetric` pero un escalón arriba — el recorrido con
     * teclado tiene que recitar lo que hay en el lienzo, no lo que había antes.
     * @type {'metric'|'multi'}
     */
    let announceMode = 'metric';

    /** Las series del último `drawMulti`, para poder anunciarlas. @type {import('../core/series-catalog.js').ResolvedSeries[]} */
    let multiSeries = [];

    /** Si el lienzo muestra valores reales o el cambio desde el inicio. @type {'raw'|'delta'} */
    let multiNormalize = 'raw';

    /** Cuál de las series recorre el teclado (flechas arriba/abajo). */
    let activeSeries = 0;

    /**
     * Mata SOLO la instancia de Chart.js, sin tocar el estado de anuncio.
     *
     * Existe separado de `destroy()` porque `drawSeries` tiene que limpiar la
     * gráfica anterior, pero para entonces `draw()` YA ha fijado la métrica con
     * la que va a anunciar. Con una sola función, esa segunda llamada devolvería
     * `announceMetric` a 'weight' y el lector de pantalla recitaría kilos sobre
     * un eje de calorías — que es exactamente el defecto que ese estado existe
     * para evitar.
     */
    function destroyInstance() {
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
    }

    /**
     * Destruye la instancia previa. Imprescindible: sin esto, cambiar de vista o
     * de métrica deja gráficas colgadas consumiendo memoria (defecto REN del legacy).
     */
    function destroy() {
        destroyInstance();
        // El cursor pertenece a la gráfica que acaba de morir. Sin esto, la
        // siguiente vista arranca con el índice de la anterior hasta su primer
        // `draw()`, y con rangos distintos ese índice puede caer fuera del suyo.
        // La métrica de anuncio, por lo mismo.
        cursor = 0;
        announceMetric = 'weight';
        announceMode = 'metric';
        multiSeries = [];
        multiNormalize = 'raw';
        activeSeries = 0;
    }

/**
     * Mueve la ventana visible sin reconstruir nada.
     *
     * La ventana son DOS NÚMEROS DE LA ESCALA, no un recorte de los datos. Antes
     * `draw()` hacía las dos cosas a la vez —recortaba la serie y además fijaba
     * `min`/`max` al mismo rango—, y por eso el deslizador solo podía mover el
     * extremo derecho: mover el izquierdo dejaba el lienzo vacío. Separarlo permite
     * panorámica y zoom reales, y hace que cambiar de ventana no cueste reconstruir
     * cinco series.
     *
     * @param {number} from índice de día
     * @param {number} to
     * @returns {boolean} false si no hay gráfica viva
     */
    function setWindow(from, to) {
        if (!chartInstance) return false;
        const x = chartInstance.options?.scales?.x;
        if (!x) return false;
        x.min = from;
        x.max = to;
        // En modo relativo, mover la ventana MUEVE EL ORIGEN: el cambio se mide
        // desde el primer día visible, así que hay que recalcular las Y. Son
        // como mucho cuatro series × mil puntos de división, décimas de ms — y
        // sobre todo NO se reconstruye la instancia, así que la gráfica sigue
        // siendo la misma y el contrato de «la misma instancia tras veinte
        // cambios de ventana» se mantiene.
        if (announceMode === 'multi' && multiNormalize === 'delta') rebaseDatasets(from);
        // 'none' es a la vez lo rápido y lo que respeta `prefers-reduced-motion`
        chartInstance.update('none');
        return true;
    }

    /**
     * Recalcula las Y de los datasets con el origen puesto en `from`.
     * @param {number} from
     */
    function rebaseDatasets(from) {
        const datasets = chartInstance?.data?.datasets;
        if (!Array.isArray(datasets)) return;
        multiSeries.forEach((serie, slot) => {
            const dataset = datasets[slot];
            if (!dataset) return;
            const r = rebase(serie.points, from);
            dataset.data = r && r.points ? r.points.map((p) => ({ x: p.x, y: p.y })) : [];
        });
    }

/**
     * Dibuja la gráfica.
     * @param {{ canvas: HTMLCanvasElement, readout: HTMLElement, projection: Projection, metric: 'weight'|'fatPct'|'muscle'|'kcal', todayIndex: number, range: {from: number, to: number}, onMilestone: (m: import('../core/generator.js').Milestone) => void, checkins?: Array<{dayIndex: number, actualKg: number, fatPct: number|null, scaleMuscleKg?: number|null, signal: string}>, muscle?: MuscleUnits, grain?: 'day'|'week'|'month' }} options
     * @returns {boolean} false si Chart.js no está disponible
     */
    function draw(options) {
        const Chart = getChartLib();
        if (!Chart) return false;
        // El vendor se carga con `await`, y en ese hueco el usuario puede haber
        // cambiado de vista: el router llama a `unmount()` ANTES de reemplazar el
        // host, así que el lienzo viejo sigue conectado un instante. Dibujar aquí
        // dejaría una instancia viva colgada de un nodo que se va a descartar.
        if (!options.canvas?.isConnected) return false;
        destroy();
        tokenCache.clear();
    
        const { projection, metric, range } = options;
        muscleUnits = options.muscle ?? muscleUnitsFor(null);
        announceMetric = metric;
    
        // La serie va ENTERA. El recorte lo hace la escala, no un `slice`.
        const anchors = seriesAnchors(projection, options.grain ?? 'day');
        const points = anchors.map((i) => projection.daily[i]).filter(Boolean);
    
        // Único punto donde la serie se convierte en coordenadas: hitos, tooltip y
        // banda pasan por aquí, así que el eje de músculo queda en la unidad del
        // usuario sin que ningún otro sitio tenga que acordarse (E11).
        /** @param {import('../core/generator.js').DailyPoint} d */
        const pick = (d) => {
            if (metric === 'fatPct') return d.fatPct;
            if (metric === 'muscle') return muscleUnits.toDisplay(d.muscleKg);
            return d.weightKg + d.fluctuationKg;
        };
        /** Un punto de serie: la X es SIEMPRE el índice absoluto de día. */
        const xy = (/** @type {*} */ d, /** @type {(p: *) => number} */ f) =>
            ({ x: d.dayIndex, y: f(d) });
    
        const accent = cssVar('--color-accent');

        /** @type {*[]} */
        const datasets = [];
    
        // La banda solo tiene sentido en peso: los escenarios se expresan como
        // adelanto/retraso de la trayectoria de peso.
        if (metric === 'weight') {
            datasets.push({
                label: t('chart.band'),
                data: points.map((d) => xy(d, (p) => p.band.optimistKg)),
                borderWidth: 0,
                pointRadius: 0,
                fill: '+1',
                backgroundColor: `${accent}22`,
                order: 3
            });
            datasets.push({
                label: t('chart.band'),
                data: points.map((d) => xy(d, (p) => p.band.pessimistKg)),
                borderWidth: 0,
                pointRadius: 0,
                fill: false,
                order: 3
            });
        }
    
        // Con granularidad semanal o mensual hay pocos puntos y merecen verse;
        // con 378 puntos diarios, marcarlos sería tinta, no información.
        const dotRadius = options.grain && options.grain !== 'day' ? 3 : 0;
    
        if (metric === 'kcal') {
            // Dos líneas cuya DISTANCIA es el déficit, y por eso se sombrea el
            // hueco entre ambas: no hace falta un tercer trazo para lo que ya
            // cuenta la geometría. El TDEE viene adaptado día a día del generador
            // (peso proyectado + adaptación metabólica), así que la curva de
            // adaptación se ve sola, sin tocar el motor.
            datasets.push({
                label: t('chart.kcalTarget'),
                data: points.map((d) => xy(d, (p) => p.kcal.targetKcal)),
                borderColor: accent,
                backgroundColor: accent,
                borderWidth: 2,
                pointRadius: dotRadius,
                pointHoverRadius: 5,
                tension: 0.15,
                order: 1,
                // Los días en que el suelo de seguridad recortó el déficit van en
                // trazo discontinuo: son los que explican por qué una fase dura
                // más de lo que uno esperaría.
                segment: {
                    borderDash: (/** @type {*} */ ctx) => {
                        const d = projection.daily[Math.round(ctx.p1?.parsed?.x ?? -1)];
                        return d?.kcal?.flooredBySafety ? [3, 3] : undefined;
                    }
                }
            });
            datasets.push({
                label: t('chart.kcalTdee'),
                data: points.map((d) => xy(d, (p) => p.kcal.tdeeKcal)),
                borderColor: cssVar('--color-warning'),
                borderWidth: 2,
                borderDash: [6, 4],
                pointRadius: dotRadius,
                pointHoverRadius: 5,
                tension: 0.15,
                fill: '-1',
                backgroundColor: `${accent}22`,
                order: 2
            });
        } else {
            datasets.push({
                label: metric === 'muscle' && muscleUnits.isScale ? muscleUnits.label() : t(`chart.metric.${metric}`),
                data: points.map((d) => xy(d, pick)),
                borderColor: accent,
                backgroundColor: accent,
                borderWidth: 2,
                pointRadius: dotRadius,
                pointHoverRadius: 5,
                tension: 0.15,
                order: 1
            });
        }
    
        // Check-ins reales superpuestos a la proyección (M4-4). Van con estilo
        // propio y en primer plano: lo medido no puede confundirse con lo previsto.
        // No se filtran por ventana: los recorta la escala, como a todo lo demás.
        // Qué check-in aplica a qué métrica lo decide `checkinAppliesTo`, que es
        // el MISMO predicado que usa la leyenda para saber si nombrar la serie.
        const realPoints = (options.checkins ?? [])
            .filter((c) => checkinAppliesTo(metric, muscleUnits.isScale, c));
        if (realPoints.length > 0 && metric !== 'kcal') {
            datasets.push({
                label: t('checkin.title'),
                data: realPoints.map((c) => ({
                    x: c.dayIndex,
                    y: metric === 'fatPct' ? c.fatPct : metric === 'muscle' ? c.scaleMuscleKg : c.actualKg
                })),
                showLine: true,
                borderColor: cssVar('--color-text'),
                borderWidth: 1,
                borderDash: [3, 3],
                pointRadius: 5,
                pointHoverRadius: 8,
                pointStyle: 'rectRot',
                pointBackgroundColor: realPoints.map((c) =>
                    cssVar(c.signal === 'within' ? '--color-success' : '--color-warning')),
                pointBorderColor: cssVar('--color-bg'),
                pointBorderWidth: 2,
                order: 0
            });
        }
    
        // Hitos como puntos sobre la línea. Sin filtrar por ventana: recorta la
        // escala. Filtrarlos aquí obligaba a redibujar en cada movimiento y, peor,
        // desalineaba `visibleMilestones` con el índice que devuelve el clic.
        //
        // En la métrica de calorías NO se dibujan: sus umbrales son de peso, grasa
        // y músculo, y `pick` los anclaría con la unidad equivocada — un hito
        // flotando en mitad de un eje de kcal señala un sitio que no existe.
        const visibleMilestones = projection.milestones;
        if (metric !== 'kcal') {
            datasets.push({
                label: t('chart.milestoneModalTitle'),
                data: visibleMilestones.map((m) => ({
                    x: m.dayIndex,
                    y: pick(projection.daily[m.dayIndex])
                })),
                showLine: false,
                pointRadius: 5,
                pointHoverRadius: 8,
                pointBackgroundColor: cssVar('--color-warning'),
                pointBorderColor: cssVar('--color-bg'),
                pointBorderWidth: 2,
                order: 0
            });
        }
        const milestoneDatasetIndex = metric === 'kcal' ? -1 : datasets.length - 1;

        const ok = drawSeries({
            canvas: options.canvas,
            datasets,
            range,
            // Se declara el eje explícitamente —antes se dejaba el implícito—
            // solo para poder darle su suelo de recorrido. `id`, `position` y la
            // ausencia de `beginAtZero` reproducen exactamente el que había.
            yAxes: [{
                id: 'y',
                position: 'left',
                minSpan: minSpanForMetric(metric, muscleUnits.isScale)
            }],
            xTickLabel: (value, span) => {
                const point = projection.daily[Math.round(value)];
                return point ? axisLabel(point.dateISO, span) : '';
            },
            tooltipTitle: (items) => {
                const point = projection.daily[Number(items[0]?.parsed?.x ?? 0)];
                return point ? `${point.dateISO} · ${t('phase.' + point.phaseType)}` : '';
            },
            extraPlugins: [phaseBandsPlugin(projection), todayLinePlugin(() => options.todayIndex)],
            clickDatasetIndex: milestoneDatasetIndex,
            onPointClick: (index) => {
                const milestone = visibleMilestones[index];
                if (milestone) options.onMilestone(milestone);
            }
        });
        if (!ok) return false;

        cursor = Math.min(Math.max(options.todayIndex, range.from), range.to);
        announce(options.readout, projection, cursor);
        return true;
    }

/**
     * Dibuja hasta cuatro series arbitrarias del catálogo.
     *
     * HERMANA de `draw()`, no su implementación: las dos construyen sus
     * datasets y las dos delegan en `drawSeries`. Reexpresar `draw` sobre esta
     * sería apostar a que produce el mismo array, y sus contratos de test son
     * posicionales.
     *
     * **Devuelve un MANIFIESTO de lo que ha dibujado de verdad**, no un
     * booleano. Es el arreglo estructural de la leyenda mentirosa: toda leyenda
     * se renderiza desde `rendered`, así que no puede anunciar una serie que el
     * lienzo no pintó. Con un booleano, la vista tendría que volver a decidir
     * qué se dibujó — y eso es, literalmente, el segundo sitio calculando el
     * mismo hecho.
     *
     * @param {DrawMultiOptions} options
     * @returns {DrawManifest}
     */
    function drawMulti(options) {
        /** @type {DrawManifest} */
        const fallo = { ok: false, rendered: [], axes: [], status: 'noChart', baselineX: null };
        const series = (options.series ?? []).slice(0, MAX_SERIES);
        if (series.length === 0) return { ...fallo, status: 'empty' };
        const relativo = options.normalize === 'delta';

        // En modo relativo TODO está en porcentaje de cambio, así que hay una
        // sola unidad y un solo eje: es lo que desbloquea comparar cuatro series
        // cualesquiera. En modo de valores reales manda la unidad de cada una.
        const plan = relativo
            ? planAxes(series.map((s) => ({ ...s, unit: /** @type {*} */ ('pct') })))
            : planAxes(series);
        if (plan.status === 'tooManyUnits') {
            // NO se dibuja, y se dice por qué. Meter tres unidades en dos ejes
            // obliga a elegir cuál miente sobre su escala; normalizar en
            // silencio cambiaría lo que significan los números sin pedirlo. La
            // salida es el modo relativo, que el usuario enciende a propósito.
            return { ...fallo, status: 'tooManyUnits', axes: [], rendered: [] };
        }

        const palette = Array.from({ length: MAX_SERIES }, (_, i) => cssVar(`--color-series-${i + 1}`));
        const { projection, range } = options;

        /** @type {*[]} */ const datasets = [];
        /** @type {RenderedSeries[]} */ const rendered = [];
        /** @type {number | null} */ let baselineX = null;

        series.forEach((serie, slot) => {
            const rebased = relativo ? rebase(serie.points, range.from) : null;
            /** @type {string | null} */ let motivoRelativo = null;
            /** @type {import('../core/series-catalog.js').SeriesPoint[]} */ let points;
            if (!relativo) {
                points = serie.points;
            } else if (rebased && rebased.points) {
                points = rebased.points;
                if (baselineX === null) baselineX = rebased.baselineX;
            } else {
                // Una serie que ya es un delta no tiene cambio porcentual: se
                // queda vacía CON motivo, no dibujada como un número absurdo.
                points = [];
                motivoRelativo = (rebased && 'reason' in rebased ? rebased.reason : null)
                    ?? 'series.reason.outOfWindow';
            }
            const axisId = axisIdFor(plan, slot);

            datasets.push({
                // Las series parametrizadas (1RM de UN ejercicio) traen su
                // etiqueta ya compuesta: la clave i18n sola no sabe qué
                // ejercicio es.
                label: serie.label ?? t(serie.spec.labelKey),
                data: points.map((p) => ({ x: p.x, y: p.y })),
                ...styleFor(serie.spec.provenance, slot, palette, points.length),
                ...(axisId ? { yAxisID: axisId } : {}),
                order: slot
            });
            rendered.push({
                id: serie.spec.id,
                label: serie.label ?? t(serie.spec.labelKey),
                slot,
                pointCount: points.length,
                axis: axisId ?? 'y',
                unit: relativo ? /** @type {*} */ ('pct') : serie.unit,
                provenance: serie.spec.provenance,
                reason: points.length === 0
                    ? (motivoRelativo ?? serie.reason ?? 'series.reason.outOfWindow')
                    : null
            });
        });

        const markGroups = groupMarks(options.marks ?? []);
        /** @type {Array<{ x: number, group: MarkGroup }>} */ const markHitBoxes = [];

        const ok = drawSeries({
            canvas: options.canvas,
            datasets,
            range,
            yAxes: plan.axes.map((a) => ({
                id: a.id,
                position: a.position,
                // El cero solo se fuerza donde significa algo. Forzarlo en un
                // peso corporal aplasta la serie contra el techo y esconde justo
                // la variación que se quiere ver.
                beginAtZero: options.normalize === 'delta' ? false : UNITS[a.unit]?.zeroMeaningful === true,
                // En modo «cambio desde el inicio» la unidad real del eje es el
                // porcentaje, no la de la serie: usar el suelo de kilos ahí
                // ensancharía el eje 2 puntos porcentuales por nada.
                minSpan: options.normalize === 'delta' ? UNITS.pct?.minSpan : UNITS[a.unit]?.minSpan
            })),
            xTickLabel: (value, span) => {
                const point = projection.daily[Math.round(value)];
                return point ? axisLabel(point.dateISO, span) : '';
            },
            tooltipTitle: (items) => {
                const point = projection.daily[Number(items[0]?.parsed?.x ?? 0)];
                return point ? `${point.dateISO} · ${t('phase.' + point.phaseType)}` : '';
            },
            extraPlugins: [
                phaseBandsPlugin(projection),
                todayLinePlugin(() => options.todayIndex),
                marksPlugin(() => markGroups, markHitBoxes, options.onMarksThinned)
            ],
            markHitBoxes,
            onMarkClick: options.onMark,
            maxTicks: options.maxTicks
        });
        if (!ok) {
            // El manifiesto dice lo que se DIBUJÓ, y aquí no se dibujó nada. Sin
            // esto, la leyenda anunciaba «24 puntos» de una serie que no existe
            // en el lienzo — exactamente la mentira que este manifiesto viene a
            // hacer imposible, colada por la puerta de atrás del caso de fallo.
            return {
                ...fallo,
                rendered: rendered.map((s) => ({ ...s, pointCount: 0, reason: 'series.reason.noChart' })),
                axes: plan.axes
            };
        }

        announceMode = 'multi';
        multiSeries = series;
        multiNormalize = options.normalize === 'delta' ? 'delta' : 'raw';
        activeSeries = 0;
        cursor = Math.min(Math.max(options.todayIndex, range.from), range.to);
        if (options.readout) announceMulti(options.readout, projection, cursor);

        return { ok: true, rendered, axes: plan.axes, status: 'ok', baselineX };
    }

    /**
     * Anuncia el punto bajo el cursor en modo multi-serie.
     *
     * SOLO la serie activa, no las cuatro. Recitar cuatro series completas en
     * cada pulsación de flecha son dos docenas de palabras por tecla, que es
     * inusable. Las otras tres viven en la leyenda, que es texto normal del DOM
     * —no `aria-live`— y un lector la recorre cuando quiere.
     *
     * @param {Readout} readout
     * @param {Projection} projection
     * @param {number} index
     */
    function announceMulti(readout, projection, index) {
        const point = projection.daily[index];
        if (!point) return;
        const serie = multiSeries[activeSeries];
        if (!serie) {
            readout.textContent = t('analysis.readout.empty');
            return;
        }
        const nombre = t(serie.spec.labelKey);
        const hit = serie.points.find((p) => p.x === index);
        if (!hit) {
            // Se dice que no hay dato ese día. NUNCA un cero: un cero es una
            // afirmación sobre el cuerpo del usuario, y un hueco no lo es.
            readout.textContent = t('analysis.readout.noValue', {
                date: longDate(point.dateISO), series: nombre
            });
            return;
        }
        const unidad = UNITS[serie.unit];
        readout.textContent = t('analysis.readout.point', {
            date: longDate(point.dateISO),
            series: nombre,
            value: num(hit.y, unidad?.decimals ?? 1),
            unit: t(unidad?.key ?? 'unit.kg')
        });
    }

    /**
     * Cambia de serie activa y anuncia su identidad completa.
     * @param {Readout} readout
     * @param {Projection} projection
     * @param {number} delta +1 / −1
     * @returns {boolean} false si no hay series que recorrer
     */
    function focusSeries(readout, projection, delta) {
        if (multiSeries.length === 0) return false;
        const total = multiSeries.length;
        activeSeries = ((activeSeries + delta) % total + total) % total;
        const serie = multiSeries[activeSeries];
        const unidad = UNITS[serie.unit];
        readout.textContent = t('analysis.readout.seriesChanged', {
            index: activeSeries + 1,
            total,
            series: t(serie.spec.labelKey),
            provenance: t(`series.provenance.${serie.spec.provenance}`),
            unit: t(unidad?.key ?? 'unit.kg')
        });
        return true;
    }

    /** Qué serie recorre el teclado ahora mismo (0..3). Para los tests. */
    function activeSeriesIndex() {
        return activeSeries;
    }

/**
     * Construye la instancia de Chart.js. **ÚNICO sitio del módulo que llama a
     * `new Chart(...)`.**
     *
     * Nace por EXTRACCIÓN de `draw()`, no reescribiéndolo: los datasets se los
     * pasa el llamador ya construidos, byte a byte como estaban. La razón es que
     * tres contratos de test son POSICIONALES —los hitos son el último dataset,
     * la serie principal se localiza por `borderWidth === 2`, el check-in por
     * `pointStyle === 'rectRot'`— y recrearlos desde una tubería genérica sería
     * apostar a que produce exactamente el mismo array. Así el diff se revisa
     * comprobando que no cambia ni un campo.
     *
     * **La regla de los hitos deja de ser disciplina y pasa a ser código:** si
     * `clickDatasetIndex` no apunta al último dataset, esto devuelve `false` en
     * vez de dibujar. Antes solo lo vigilaba un test, y un test solo protege lo
     * que alguien se acordó de escribir.
     *
     * @param {DrawSeriesOptions} options
     * @returns {boolean} false si Chart.js no está, el lienzo no está conectado,
     *   o el índice de clic viola el invariante de los hitos
     */
    function drawSeries(options) {
        const Chart = getChartLib();
        if (!Chart) return false;
        // El vendor se carga con `await`, y en ese hueco el usuario puede haber
        // cambiado de vista: el router llama a `unmount()` ANTES de reemplazar el
        // host, así que el lienzo viejo sigue conectado un instante. Dibujar aquí
        // dejaría una instancia viva colgada de un nodo que se va a descartar.
        if (!options.canvas?.isConnected) return false;
        // `destroyInstance` y NO `destroy`: en el camino de `draw()` la métrica
        // de anuncio ya está fijada, y `destroy()` la devolvería a 'weight'.
        destroyInstance();

        const { datasets, range } = options;
        if (options.clickDatasetIndex !== undefined && options.clickDatasetIndex >= 0
            && options.clickDatasetIndex !== datasets.length - 1) {
            console.error('[chart] la capa pulsable debe ser la ÚLTIMA: '
                + `${options.clickDatasetIndex} de ${datasets.length} datasets`);
            return false;
        }

        const muted = cssVar('--color-text-muted');
        const grid = cssVar('--color-border');
        const spanDays = Math.max(1, range.to - range.from);

        /** El eje Y implícito, o los que pida el llamador. Ver `yAxes`. */
        /** @type {Record<string, *>} */
        const yScales = {};
        const ejes = options.yAxes ?? [{ id: 'y', position: 'left' }];
        for (const axis of ejes) {
            /** @type {Record<string, *>} */
            const scale = {
                position: axis.position,
                ticks: { color: muted },
                // Dos rejillas superpuestas convierten el fondo en papel
                // milimetrado: solo la del eje principal se dibuja en el área.
                grid: { color: grid, drawOnChartArea: axis.position !== 'right' },
                ...(axis.beginAtZero === true ? { beginAtZero: true } : {})
            };

            // Suelo de recorrido (E15-3). Sin esto, Chart.js autoescala al
            // extent de los datos y una serie plana se dibuja como una montaña
            // rusa de ruido de báscula. No aplica a los ejes que arrancan en
            // cero: ésos ya tienen su recorrido acotado por la MAGNITUD del
            // dato, no por su variación.
            if (axis.beginAtZero !== true && Number.isFinite(axis.minSpan)) {
                const extent = axisExtent(datasets, axis.id, ejes.length <= 1);
                if (extent) {
                    // `suggested*` y no `min`/`max`: ensancha cuando hace falta
                    // pero deja a Chart.js elegir los ticks, y no impide que el
                    // eje crezca más si los datos lo piden.
                    const span = axisSpan(extent.min, extent.max, /** @type {number} */ (axis.minSpan));
                    scale.suggestedMin = span.min;
                    scale.suggestedMax = span.max;
                }
            }
            yScales[axis.id] = scale;
        }

        chartInstance = new Chart(options.canvas, {
            type: 'line',
            // Sin `labels`: todos los puntos llevan su propia X. Con anclajes
            // dispersos (semana, mes) la correspondencia `data[i] ↔ labels[i]` deja
            // de existir, y además el lienzo ya mezclaba los dos modos de parseo
            // —la línea por `labels`, los hitos por `{x,y}`—. Unificar simplifica.
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                // el legacy animaba siempre; aquí se respeta la preferencia del sistema
                animation: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
                    ? false
                    : { duration: 250 },
                interaction: { mode: 'index', intersect: false },
                scales: {
                    x: {
                        // NO se usa `type: 'time'`: el Chart.js vendorizado trae la
                        // escala pero NO un adaptador de fechas, así que lanzaría.
                        // La X es el índice absoluto de día; la fecha es una
                        // ETIQUETA, no una coordenada.
                        type: 'linear',
                        min: range.from,
                        max: range.to,
                        ticks: {
                            color: muted,
                            maxTicksLimit: options.maxTicks ?? 8,
                            // `function` y no flecha: Chart.js invoca el callback con
                            // la ESCALA como `this`, y hace falta para leer el ancho
                            // de la ventana ACTUAL. Con el ancho capturado en el
                            // dibujado, mover la ventana con `setWindow()` dejaba los
                            // rótulos congelados en el formato anterior: una ventana
                            // de 30 días seguía rotulando «sept 2026» en vez del día.
                            callback: /** @type {*} */ (
                                /** @this {{ min: number, max: number }} @param {*} value */
                                function (value) {
                                const scale = this;
                                const span = Number.isFinite(scale?.max) && Number.isFinite(scale?.min)
                                    ? scale.max - scale.min
                                    : spanDays;
                                return options.xTickLabel(Number(value), span);
                            })
                        },
                        grid: { color: grid }
                    },
                    ...yScales
                },
                plugins: {
                    legend: { display: false },
                    ...(options.tooltipTitle
                        ? { tooltip: { callbacks: { title: options.tooltipTitle } } }
                        : {})
                },
                onClick: (/** @type {*} */ event, /** @type {*} */ _elements, /** @type {*} */ chart) => {
                    // `interaction.intersect: false` está bien para el tooltip —que
                    // debe seguir al dedo— pero NO para abrir una ficha: con él,
                    // `elements` trae el hito más CERCANO aunque el clic haya caído
                    // en zona vacía, y se abría la ficha de un hito que no estaba
                    // ahí. Aquí se vuelve a consultar exigiendo intersección real.
                    // Los marcadores van PRIMERO: viven en el borde superior,
                    // donde no hay puntos de ninguna serie, así que preguntarles
                    // después significaría no preguntarles nunca en la práctica.
                    if (options.onMarkClick && options.markHitBoxes?.length) {
                        const px = /** @type {*} */ (event).x
                            ?? /** @type {*} */ (event).native?.offsetX;
                        if (Number.isFinite(px)) {
                            const cerca = options.markHitBoxes
                                .filter((b) => Math.abs(b.x - px) <= MARK_HIT_PX)
                                .sort((a, b) => Math.abs(a.x - px) - Math.abs(b.x - px))[0];
                            if (cerca) {
                                options.onMarkClick(cerca.group);
                                return;
                            }
                        }
                    }
                    const index = options.clickDatasetIndex ?? -1;
                    if (index < 0 || !options.onPointClick) return;
                    const hits = chart.getElementsAtEventForMode(
                        /** @type {*} */ (event), 'point', { intersect: true }, true
                    );
                    const hit = hits.find((/** @type {*} */ e) => e.datasetIndex === index);
                    if (hit) options.onPointClick(hit.index);
                }
            },
            plugins: options.extraPlugins ?? []
        });
        return true;
    }

/**
     * Anuncia un punto en la región `aria-live`: es la alternativa textual del
     * canvas, que para un lector de pantalla es opaco.
     * @param {Readout} readout
     * @param {Projection} projection
     * @param {number} index
     */
    function announce(readout, projection, index) {
        const point = projection.daily[index];
        if (!point) return;
        if (announceMetric === 'kcal') {
            const deficit = Math.round(point.kcal.deficitKcal);
            const balance = deficit >= 1 ? t('chart.kcalDeficit', { value: deficit })
                : deficit <= -1 ? t('chart.kcalSurplus', { value: -deficit })
                : t('chart.kcalEven');
            readout.textContent = t('chart.readoutKcal', {
                day: point.dayIndex,
                // Fecha larga y no ISO: esto lo LEE un lector de pantalla, donde
                // «dos mil veintiséis guion cero ocho» es lo peor de los dos mundos.
                date: longDate(point.dateISO),
                target: point.kcal.targetKcal,
                tdee: point.kcal.tdeeKcal,
                balance,
                phase: t(`phase.${point.phaseType}`)
            });
            return;
        }
        readout.textContent = t('chart.readout', {
            day: point.dayIndex,
            date: longDate(point.dateISO),
            weight: num(point.weightKg + point.fluctuationKg),
            fat: num(point.fatPct),
            muscle: num(muscleUnits.toDisplay(point.muscleKg)),
            phase: t(`phase.${point.phaseType}`)
        });
    }

/**
     * Posición actual del cursor de lectura.
     *
     * Existe para poder observarlo desde los tests sin DOM: `handleKey` solo
     * devuelve si consumió la tecla, y sin esto la única forma de saber dónde
     * quedó el cursor era leer el texto ya traducido de la región `aria-live`.
     * @returns {number}
     */
    function cursorIndex() {
        return cursor;
    }

/**
     * Lleva el cursor a un día concreto y lo anuncia.
     *
     * Es lo que conecta la línea de tiempo con la gráfica: pulsar un evento no
     * abre otra pantalla, mueve el cursor de ESTA. El mismo cursor que ya usa el
     * recorrido con teclado, para que las dos vías cuenten la misma historia.
     * @param {Readout} readout
     * @param {Projection} projection
     * @param {number} index
     * @param {{ from: number, to: number }} range
     */
    function focusDay(readout, projection, index, range) {
        cursor = Math.min(Math.max(index, range.from), range.to);
        announce(readout, projection, cursor);
    }

/**
     * Mueve el cursor de lectura por teclado y lo anuncia.
     * @param {{ readout: HTMLElement, projection: Projection, key: string, range: {from: number, to: number} }} options
     * @returns {boolean} true si la tecla se ha consumido
     */
    function handleKey(options) {
        const { key, range } = options;

        // Arriba/abajo cambian de SERIE, no de fecha, y solo cuando hay series
        // que recorrer. En el camino de una métrica `focusSeries` devuelve
        // false, así que estas teclas se siguen devolviendo al navegador — que
        // es lo que exige el contrato de `ui-chart.test.js`.
        if (key === 'ArrowUp' || key === 'ArrowDown') {
            if (announceMode !== 'multi') return false;
            return focusSeries(options.readout, options.projection, key === 'ArrowUp' ? -1 : 1);
        }

        const step = key === 'PageUp' || key === 'PageDown' ? 7 : 1;
        let next = cursor;
        if (key === 'ArrowRight' || key === 'PageUp') next = cursor + step;
        else if (key === 'ArrowLeft' || key === 'PageDown') next = cursor - step;
        else if (key === 'Home') next = range.from;
        else if (key === 'End') next = range.to;
        else return false;

        cursor = Math.min(Math.max(next, range.from), range.to);
        if (announceMode === 'multi') announceMulti(options.readout, options.projection, cursor);
        else announce(options.readout, options.projection, cursor);
        return true;
    }

/**
     * Exporta el lienzo a PNG, con el fondo del tema debajo.
     *
     * `toBase64Image` devuelve el lienzo tal cual, y el lienzo es TRANSPARENTE: el
     * fondo lo pone la página. El PNG salía con líneas y texto claros sobre nada,
     * así que en cualquier visor o chat con fondo blanco —que son casi todos— se
     * veía ilegible. Aquí se compone sobre el color de superficie del tema.
     * @returns {string | null} data URL, o null si no hay gráfica
     */
    function toPng() {
        if (!chartInstance) return null;
        const source = chartInstance.canvas;
        if (!source || typeof document === 'undefined') {
            return chartInstance.toBase64Image('image/png', 1);
        }
        const leyenda = legendEntriesOf(chartInstance);
        const ratio = source.width / Math.max(1, source.clientWidth || source.width);
        const alto = legendHeight(leyenda, source.width, ratio);

        const out = document.createElement('canvas');
        out.width = source.width;
        out.height = source.height + alto;
        const ctx = out.getContext('2d');
        if (!ctx) return chartInstance.toBase64Image('image/png', 1);
        ctx.fillStyle = cssVar('--color-surface') || '#14141d';
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(source, 0, 0);
        if (alto > 0) drawLegendInto(ctx, leyenda, source.width, source.height, ratio);
        return out.toDataURL('image/png');
    }

    return { draw, drawMulti, drawSeries, destroy, setWindow, announce, announceMulti,
        focusSeries, activeSeriesIndex, cursorIndex, focusDay, handleKey, toPng };
}

/**
 * Las entradas de leyenda de una instancia, LEÍDAS DE SUS DATASETS.
 *
 * Fuente única y no un parámetro: si el llamador pasara su propia lista, el PNG
 * podría describir una gráfica distinta de la que enseña — exactamente la
 * mentira que el manifiesto vino a cerrar en pantalla, colada por el fichero
 * que el usuario comparte. De los datasets no se puede divergir.
 *
 * Se descartan los de `borderWidth: 0` (el relleno de la banda, que aporta dos
 * datasets sin línea) y los nombres repetidos: la banda usa el mismo rótulo dos
 * veces y en una leyenda sería ruido.
 *
 * @param {*} instance
 * @returns {Array<{ label: string, color: string, dash: number[] }>}
 */
export function legendEntriesOf(instance) {
    const datasets = instance?.data?.datasets;
    if (!Array.isArray(datasets)) return [];
    /** @type {Array<{ label: string, color: string, dash: number[] }>} */ const out = [];
    const vistos = new Set();
    for (const d of datasets) {
        const label = typeof d?.label === 'string' ? d.label.trim() : '';
        if (!label || vistos.has(label)) continue;
        if (d.borderWidth === 0) continue;
        vistos.add(label);
        out.push({
            label,
            color: typeof d.borderColor === 'string' ? d.borderColor : '#ffffff',
            dash: Array.isArray(d.borderDash) ? d.borderDash : []
        });
    }
    return out;
}

/** Geometría de la leyenda del PNG, en píxeles de DISPOSITIVO. */
const LEGEND_PNG = Object.freeze({
    fontPx: 13, rowPx: 22, padPx: 12, glyphPx: 26, gapPx: 8, minColPx: 190
});

/**
 * Alto que hay que añadir al lienzo para que quepa la leyenda.
 * @param {Array<*>} entries @param {number} width en píxeles de dispositivo
 * @param {number} ratio devicePixelRatio efectivo del lienzo
 * @returns {number} 0 si no hay nada que rotular
 */
export function legendHeight(entries, width, ratio = 1) {
    if (!Array.isArray(entries) || entries.length === 0) return 0;
    const filas = Math.ceil(entries.length / legendColumns(entries.length, width, ratio));
    return Math.round((LEGEND_PNG.padPx * 2 + filas * LEGEND_PNG.rowPx) * ratio);
}

/**
 * Cuántas columnas usa la leyenda del PNG.
 *
 * Se acota por el NÚMERO DE ENTRADAS, no solo por el ancho: con tres series en
 * un lienzo grande caben cinco columnas, y repartir tres rótulos en cinco huecos
 * los recorta a «Porcentaje de grasa previ…» teniendo sitio de sobra. Usando
 * tantas columnas como series, cada una se lleva su parte entera del ancho.
 * @param {number} count @param {number} width @param {number} ratio
 * @returns {number}
 */
function legendColumns(count, width, ratio) {
    const caben = Math.max(1, Math.floor(width / (LEGEND_PNG.minColPx * ratio)));
    return Math.max(1, Math.min(count, caben));
}

/**
 * Pinta la leyenda bajo la gráfica ya compuesta.
 *
 * Reproduce el TRAZO de cada serie, no un cuadrito de color: es la misma razón
 * que en la leyenda de pantalla —un punto no se parece a la línea que dice
 * describir— y aquí pesa más, porque un PNG se mira en escala de grises, se
 * imprime y se reenvía sin la app al lado.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Array<{label: string, color: string, dash: number[]}>} entries
 * @param {number} width @param {number} top @param {number} ratio
 */
export function drawLegendInto(ctx, entries, width, top, ratio = 1) {
    const px = (/** @type {number} */ v) => v * ratio;
    const cols = legendColumns(entries.length, width, ratio);
    const colW = width / cols;

    ctx.save();
    ctx.font = `${px(LEGEND_PNG.fontPx)}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    entries.forEach((entry, i) => {
        const col = i % cols;
        const fila = Math.floor(i / cols);
        const x = col * colW + px(LEGEND_PNG.padPx);
        const y = top + px(LEGEND_PNG.padPx) + fila * px(LEGEND_PNG.rowPx) + px(LEGEND_PNG.rowPx) / 2;

        ctx.strokeStyle = entry.color;
        ctx.lineWidth = px(2);
        ctx.setLineDash(entry.dash.map((n) => px(n)));
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + px(LEGEND_PNG.glyphPx), y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = cssVar('--color-text') || '#eaeaf4';
        const textoX = x + px(LEGEND_PNG.glyphPx + LEGEND_PNG.gapPx);
        const maxAncho = colW - (textoX - col * colW) - px(LEGEND_PNG.padPx);
        ctx.fillText(ellipsize(ctx, entry.label, maxAncho), textoX, y);
    });
    ctx.restore();
}

/**
 * Recorta un texto al ancho disponible, con puntos suspensivos.
 * @param {CanvasRenderingContext2D} ctx @param {string} text @param {number} maxWidth
 * @returns {string}
 */
function ellipsize(ctx, text, maxWidth) {
    if (maxWidth <= 0 || ctx.measureText(text).width <= maxWidth) return text;
    let corte = text.length;
    while (corte > 1 && ctx.measureText(`${text.slice(0, corte)}…`).width > maxWidth) corte--;
    return `${text.slice(0, corte)}…`;
}

/** Estado de error de la gráfica: recarga, jamás borrado (H-013). */
export function unavailable() {
    return html`
        <div class="state state--error" role="alert">
            <div class="state__icon" aria-hidden="true">⚠</div>
            <h3 class="state__title">${t('chart.unavailableTitle')}</h3>
            <p class="state__body">${t('chart.unavailableBody')}</p>
            <div class="state__actions">
                <button type="button" class="btn btn--primary" data-action="reload">${t('action.reload')}</button>
            </div>
        </div>
    `;
}

/** Render auxiliar para pruebas del módulo sin Chart.js. */
export function renderFallback(/** @type {*} */ container) {
    render(container, unavailable());
}

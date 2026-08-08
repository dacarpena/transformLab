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

/** @typedef {import('../core/generator.js').Projection} Projection */
/** @typedef {import('../core/engine.js').PhasePlan} PhasePlan */
/** @typedef {import('./muscle-units.js').MuscleUnits} MuscleUnits */

/** @type {*} */
let chartInstance = null;

/** Índice del punto activo para el recorrido con teclado. */
let cursor = 0;

/**
 * Unidad de músculo con la que se dibujó la última vez (E11).
 *
 * Vive en el módulo, como `cursor`, porque el recorrido con teclado ocurre
 * mucho después del `draw()` y tiene que anunciar la MISMA cifra que se ve en
 * la gráfica. Un lector de pantalla que dijera 29,2 mientras el eje marca 56,6
 * estaría describiendo otra gráfica.
 * @type {MuscleUnits}
 */
let muscleUnits = muscleUnitsFor(null);

/**
 * Métrica con la que se dibujó la última vez, por la misma razón que
 * `muscleUnits`: si el lienzo muestra calorías y la región `aria-live` recita
 * kilos, el lector de pantalla está describiendo otra gráfica (E12).
 * @type {'weight'|'fatPct'|'muscle'|'kcal'}
 */
let announceMetric = 'weight';

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
 * Plugin de bandas de fase: pinta el fondo por tramos usando el color del
 * token de cada fase. Va detrás de todo lo demás.
 * @param {Projection} projection
 */
function phaseBandsPlugin(projection) {
    return {
        id: 'phaseBands',
        beforeDatasetsDraw(/** @type {*} */ chart) {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea || !scales.x) return;
            const daily = projection.daily;
            let start = 0;
            ctx.save();
            // RECORTE OBLIGATORIO. Este plugin recorre la serie ENTERA con
            // índices absolutos, así que en cuanto la ventana deja de empezar
            // en el día 0 hay fases cuyos píxeles caen fuera del área de
            // trazado, y `fillRect` no las recorta solo: pintaría el fondo de
            // color por encima de los rótulos del eje. No se notaba antes
            // porque la ventana siempre iba de 0 al final (E12).
            ctx.beginPath();
            ctx.rect(chartArea.left, chartArea.top, chartArea.right - chartArea.left, chartArea.bottom - chartArea.top);
            ctx.clip();
            for (let i = 1; i <= daily.length; i++) {
                const changed = i === daily.length || daily[i].phaseType !== daily[start].phaseType;
                if (!changed) continue;
                const x1 = scales.x.getPixelForValue(start);
                const x2 = scales.x.getPixelForValue(i - 1);
                ctx.globalAlpha = 0.10;
                ctx.fillStyle = cssVar(`--color-phase-${daily[start].phaseType}`);
                ctx.fillRect(x1, chartArea.top, Math.max(1, x2 - x1), chartArea.bottom - chartArea.top);
                start = i;
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
export function milestoneLabel(milestone, muscle = muscleUnits) {
    if (milestone.category === 'muscleKg' && muscle.isScale && typeof milestone.threshold === 'number') {
        return t('milestone.muscleKg', { threshold: muscle.toDisplay(milestone.threshold).toFixed(1) });
    }
    const threshold = milestone.category === 'phase'
        ? t(`phase.${milestone.threshold}`)
        : milestone.threshold;
    return t(`milestone.${milestone.category}`, { threshold: /** @type {string|number} */ (threshold) });
}

/**
 * Destruye la instancia previa. Imprescindible: sin esto, cambiar de vista o
 * de métrica deja gráficas colgadas consumiendo memoria (defecto REN del legacy).
 */
export function destroy() {
    if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
    }
    // El cursor pertenece a la gráfica que acaba de morir. Sin esto, la
    // siguiente vista arranca con el índice de la anterior hasta su primer
    // `draw()`, y con rangos distintos ese índice puede caer fuera del suyo.
    // La métrica de anuncio, por lo mismo.
    cursor = 0;
    announceMetric = 'weight';
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
export function setWindow(from, to) {
    if (!chartInstance) return false;
    const x = chartInstance.options?.scales?.x;
    if (!x) return false;
    x.min = from;
    x.max = to;
    // 'none' es a la vez lo rápido y lo que respeta `prefers-reduced-motion`
    chartInstance.update('none');
    return true;
}

/**
 * Dibuja la gráfica.
 * @param {{ canvas: HTMLCanvasElement, readout: HTMLElement, projection: Projection, metric: 'weight'|'fatPct'|'muscle'|'kcal', todayIndex: number, range: {from: number, to: number}, onMilestone: (m: import('../core/generator.js').Milestone) => void, checkins?: Array<{dayIndex: number, actualKg: number, fatPct: number|null, scaleMuscleKg?: number|null, signal: string}>, muscle?: MuscleUnits, grain?: 'day'|'week'|'month' }} options
 * @returns {boolean} false si Chart.js no está disponible
 */
export function draw(options) {
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
    const muted = cssVar('--color-text-muted');
    const grid = cssVar('--color-border');
    const spanDays = Math.max(1, range.to - range.from);

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
    // En músculo solo se dibujan si el perfil es de báscula: el check-in
    // guarda la cifra de la báscula (E11) y el eje ya está en esa unidad, así
    // que se pinta TAL CUAL, sin conversión — es una medición, no un nivel del
    // motor. Sin báscula no hay dato de músculo medido, y en kcal los
    // check-ins no significan nada: son pesos.
    const realPoints = (options.checkins ?? []).filter((c) => {
        if (metric === 'fatPct') return c.fatPct !== null;
        if (metric === 'muscle') return muscleUnits.isScale && Number.isFinite(c.scaleMuscleKg);
        if (metric === 'kcal') return false;
        return true;
    });
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
                        maxTicksLimit: 8,
                        // `function` y no flecha: Chart.js invoca el callback con
                        // la ESCALA como `this`, y hace falta para leer el ancho
                        // de la ventana ACTUAL. Con el ancho capturado en el
                        // dibujado, mover la ventana con `setWindow()` dejaba los
                        // rótulos congelados en el formato anterior: una ventana
                        // de 30 días seguía rotulando «sept 2026» en vez del día.
                        // `@this` no es decorativo: Chart.js invoca el callback
                        // con la ESCALA como `this`, y de ahí sale la ventana
                        // ACTUAL. Por eso es `function` y no una flecha.
                        callback: /** @type {*} */ (
                            /** @this {{ min: number, max: number }} @param {*} value */
                            function (value) {
                            const point = projection.daily[Math.round(Number(value))];
                            if (!point) return '';
                            const scale = this;
                            const span = Number.isFinite(scale?.max) && Number.isFinite(scale?.min)
                                ? scale.max - scale.min
                                : spanDays;
                            return axisLabel(point.dateISO, span);
                        })
                    },
                    grid: { color: grid }
                },
                y: {
                    ticks: { color: muted },
                    grid: { color: grid }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: (/** @type {*} */ items) => {
                            const point = projection.daily[Number(items[0]?.parsed?.x ?? 0)];
                            return point ? `${point.dateISO} · ${t('phase.' + point.phaseType)}` : '';
                        }
                    }
                }
            },
            onClick: (/** @type {*} */ event, /** @type {*} */ _elements, /** @type {*} */ chart) => {
                // `interaction.intersect: false` está bien para el tooltip —que
                // debe seguir al dedo— pero NO para abrir una ficha: con él,
                // `elements` trae el hito más CERCANO aunque el clic haya caído
                // en zona vacía, y se abría la ficha de un hito que no estaba
                // ahí. Aquí se vuelve a consultar exigiendo intersección real.
                const hits = chart.getElementsAtEventForMode(
                    /** @type {*} */ (event), 'point', { intersect: true }, true
                );
                if (milestoneDatasetIndex < 0) return; // en kcal no hay hitos
                const hit = hits.find((/** @type {*} */ e) => e.datasetIndex === milestoneDatasetIndex);
                if (!hit) return;
                const milestone = visibleMilestones[hit.index];
                if (milestone) options.onMilestone(milestone);
            }
        },
        plugins: [phaseBandsPlugin(projection), todayLinePlugin(() => options.todayIndex)]
    });

    cursor = Math.min(Math.max(options.todayIndex, range.from), range.to);
    announce(options.readout, projection, cursor);
    return true;
}

/**
 * Anuncia un punto en la región `aria-live`: es la alternativa textual del
 * canvas, que para un lector de pantalla es opaco.
 * @param {HTMLElement} readout
 * @param {Projection} projection
 * @param {number} index
 */
export function announce(readout, projection, index) {
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
        weight: (point.weightKg + point.fluctuationKg).toFixed(1),
        fat: point.fatPct.toFixed(1),
        muscle: muscleUnits.toDisplay(point.muscleKg).toFixed(1),
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
export function cursorIndex() {
    return cursor;
}

/**
 * Lleva el cursor a un día concreto y lo anuncia.
 *
 * Es lo que conecta la línea de tiempo con la gráfica: pulsar un evento no
 * abre otra pantalla, mueve el cursor de ESTA. El mismo cursor que ya usa el
 * recorrido con teclado, para que las dos vías cuenten la misma historia.
 * @param {HTMLElement} readout
 * @param {Projection} projection
 * @param {number} index
 * @param {{ from: number, to: number }} range
 */
export function focusDay(readout, projection, index, range) {
    cursor = Math.min(Math.max(index, range.from), range.to);
    announce(readout, projection, cursor);
}

/**
 * Mueve el cursor de lectura por teclado y lo anuncia.
 * @param {{ readout: HTMLElement, projection: Projection, key: string, range: {from: number, to: number} }} options
 * @returns {boolean} true si la tecla se ha consumido
 */
export function handleKey(options) {
    const { key, range } = options;
    const step = key === 'PageUp' || key === 'PageDown' ? 7 : 1;
    let next = cursor;
    if (key === 'ArrowRight' || key === 'PageUp') next = cursor + step;
    else if (key === 'ArrowLeft' || key === 'PageDown') next = cursor - step;
    else if (key === 'Home') next = range.from;
    else if (key === 'End') next = range.to;
    else return false;

    cursor = Math.min(Math.max(next, range.from), range.to);
    announce(options.readout, options.projection, cursor);
    return true;
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

/**
 * Exporta el lienzo a PNG, con el fondo del tema debajo.
 *
 * `toBase64Image` devuelve el lienzo tal cual, y el lienzo es TRANSPARENTE: el
 * fondo lo pone la página. El PNG salía con líneas y texto claros sobre nada,
 * así que en cualquier visor o chat con fondo blanco —que son casi todos— se
 * veía ilegible. Aquí se compone sobre el color de superficie del tema.
 * @returns {string | null} data URL, o null si no hay gráfica
 */
export function toPng() {
    if (!chartInstance) return null;
    const source = chartInstance.canvas;
    if (!source || typeof document === 'undefined') {
        return chartInstance.toBase64Image('image/png', 1);
    }
    const out = document.createElement('canvas');
    out.width = source.width;
    out.height = source.height;
    const ctx = out.getContext('2d');
    if (!ctx) return chartInstance.toBase64Image('image/png', 1);
    ctx.fillStyle = cssVar('--color-surface') || '#14141d';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(source, 0, 0);
    return out.toDataURL('image/png');
}

/** Render auxiliar para pruebas del módulo sin Chart.js. */
export function renderFallback(/** @type {*} */ container) {
    render(container, unavailable());
}

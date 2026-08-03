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

/** @typedef {import('../core/generator.js').Projection} Projection */
/** @typedef {import('../core/engine.js').PhasePlan} PhasePlan */

/** @type {*} */
let chartInstance = null;

/** Índice del punto activo para el recorrido con teclado. */
let cursor = 0;

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
function cssVar(name) {
    if (typeof getComputedStyle !== 'function') return '';
    const styles = getComputedStyle(document.documentElement);
    return styles.getPropertyValue(name).trim()
        || styles.getPropertyValue('--color-text-secondary').trim();
}

/**
 * Plugin de bandas de fase: pinta el fondo por tramos usando el color del
 * token de cada fase. Va detrás de todo lo demás.
 * @param {Projection} projection
 */
function phaseBandsPlugin(projection) {
    return {
        id: 'phaseBands',
        beforeDatasetsDraw(chart) {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea || !scales.x) return;
            const daily = projection.daily;
            let start = 0;
            for (let i = 1; i <= daily.length; i++) {
                const changed = i === daily.length || daily[i].phaseType !== daily[start].phaseType;
                if (!changed) continue;
                const x1 = scales.x.getPixelForValue(start);
                const x2 = scales.x.getPixelForValue(i - 1);
                ctx.save();
                ctx.globalAlpha = 0.10;
                ctx.fillStyle = cssVar(`--color-phase-${daily[start].phaseType}`);
                ctx.fillRect(x1, chartArea.top, Math.max(1, x2 - x1), chartArea.bottom - chartArea.top);
                ctx.restore();
                start = i;
            }
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
        afterDatasetsDraw(chart) {
            const { ctx, chartArea, scales } = chart;
            const index = getTodayIndex();
            if (!chartArea || !scales.x || index < 0) return;
            const x = scales.x.getPixelForValue(index);
            if (!Number.isFinite(x)) return;
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
 * @param {import('../core/generator.js').Milestone} milestone
 */
export function milestoneLabel(milestone) {
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
}

/**
 * Dibuja la gráfica.
 * @param {{ canvas: HTMLCanvasElement, readout: HTMLElement, projection: Projection, metric: 'weight'|'fatPct'|'muscle', todayIndex: number, range: {from: number, to: number}, onMilestone: (m: import('../core/generator.js').Milestone) => void, checkins?: Array<{dayIndex: number, actualKg: number, fatPct: number|null, signal: string}> }} options
 * @returns {boolean} false si Chart.js no está disponible
 */
export function draw(options) {
    const Chart = getChartLib();
    if (!Chart) return false;
    destroy();

    const { projection, metric, range } = options;
    const slice = projection.daily.slice(range.from, range.to + 1);
    const labels = slice.map((d) => d.dayIndex);

    /** @param {import('../core/generator.js').DailyPoint} d */
    const pick = (d) => {
        if (metric === 'fatPct') return d.fatPct;
        if (metric === 'muscle') return d.muscleKg;
        return d.weightKg + d.fluctuationKg;
    };

    const accent = cssVar('--color-accent');
    const muted = cssVar('--color-text-muted');
    const grid = cssVar('--color-border');

    /** @type {*[]} */
    const datasets = [];

    // La banda solo tiene sentido en peso: los escenarios se expresan como
    // adelanto/retraso de la trayectoria de peso.
    if (metric === 'weight') {
        datasets.push({
            label: t('chart.band'),
            data: slice.map((d) => d.band.optimistKg),
            borderWidth: 0,
            pointRadius: 0,
            fill: '+1',
            backgroundColor: `${accent}22`,
            order: 3
        });
        datasets.push({
            label: t('chart.band'),
            data: slice.map((d) => d.band.pessimistKg),
            borderWidth: 0,
            pointRadius: 0,
            fill: false,
            order: 3
        });
    }

    datasets.push({
        label: t(`chart.metric.${metric}`),
        data: slice.map(pick),
        borderColor: accent,
        backgroundColor: accent,
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 5,
        tension: 0.15,
        order: 1
    });

    // Check-ins reales superpuestos a la proyección (M4-4). Van con estilo
    // propio y en primer plano: lo medido no puede confundirse con lo previsto.
    const realPoints = (options.checkins ?? []).filter(
        (c) => c.dayIndex >= range.from && c.dayIndex <= range.to
            && (metric !== 'fatPct' || c.fatPct !== null)
    );
    if (realPoints.length > 0 && metric !== 'muscle') {
        datasets.push({
            label: t('checkin.title'),
            data: realPoints.map((c) => ({
                x: c.dayIndex,
                y: metric === 'fatPct' ? c.fatPct : c.actualKg
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

    // Hitos visibles dentro del rango, como puntos sobre la línea
    const visibleMilestones = projection.milestones.filter(
        (m) => m.dayIndex >= range.from && m.dayIndex <= range.to
    );
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

    chartInstance = new Chart(options.canvas, {
        type: 'line',
        data: { labels, datasets },
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
                    type: 'linear',
                    min: range.from,
                    max: range.to,
                    ticks: { color: muted, maxTicksLimit: 8 },
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
                        title: (items) => {
                            const point = projection.daily[Number(items[0]?.parsed?.x ?? 0)];
                            return point ? `${point.dateISO} · ${t('phase.' + point.phaseType)}` : '';
                        }
                    }
                }
            },
            onClick: (_event, elements) => {
                const hit = elements.find((/** @type {*} */ e) => e.datasetIndex === datasets.length - 1);
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
    readout.textContent = t('chart.readout', {
        day: point.dayIndex,
        date: point.dateISO,
        weight: (point.weightKg + point.fluctuationKg).toFixed(1),
        fat: point.fatPct.toFixed(1),
        muscle: point.muscleKg.toFixed(1),
        phase: t(`phase.${point.phaseType}`)
    });
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
 * Exporta el lienzo a PNG.
 * @returns {string | null} data URL, o null si no hay gráfica
 */
export function toPng() {
    if (!chartInstance) return null;
    return chartInstance.toBase64Image('image/png', 1);
}

/** Render auxiliar para pruebas del módulo sin Chart.js. */
export function renderFallback(container) {
    render(container, unavailable());
}

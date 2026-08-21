// @ts-check

/**
 * Reúne en UNA lista los hitos de las tres familias que el producto ya calcula
 * por separado (E14-3), para que la gráfica pueda dibujarlos todos.
 *
 * Antes de esto había tres conceptos de «hito» que no se veían nunca juntos: los
 * del motor (fases y cruces de umbral), los estéticos del catálogo y —desde
 * E14-2— los de salud. Cada uno vivía en su vista, así que ninguna respondía a
 * la pregunta que se hace el usuario delante de la gráfica: *¿qué pasa este
 * mes?*
 *
 * Este módulo es la aduana: traduce las tres formas a la única que entiende el
 * lienzo (`ChartMark`), y ES el sitio donde se decide qué es un aviso y qué un
 * logro. Vive en `ui/` y no en `core/` porque su salida lleva texto ya
 * traducido: el lienzo no sabe de idiomas y no debe aprender.
 */

import { t, getLocale } from '../i18n/i18n.js';
import { html } from './dom.js';
import { longDate } from './dates.js';
import * as modal from './components/modal.js';
import { milestoneLabel } from './chart.js';
import { num } from './format.js';
import { aestheticMilestonesFor, textOf } from '../core/milestones.js';
import { projectedHealthMilestones, measuredHealthMilestones } from '../core/health-milestones.js';

/**
 * Categorías que el usuario puede encender y apagar.
 *
 * El orden es el de la barra de filtros y el de la ficha. `phase` va primero
 * porque es la estructura del plan: lo demás cuelga de ella.
 */
export const MARK_CATEGORIES = /** @type {readonly ('phase'|'body'|'health'|'aesthetic')[]} */ (
    Object.freeze(['phase', 'body', 'health', 'aesthetic']));

/**
 * Formatea los parámetros numéricos de un hito de salud.
 *
 * Genérico a propósito: la alternativa es que este módulo sepa que `bmi` lleva
 * un decimal y `cm` ninguno, y entonces añadir un umbral obligaría a tocar dos
 * ficheros. Un 18.5 con punto en una interfaz en español es el defecto que ya
 * costó media milestone.
 * @param {Record<string, string | number>} params
 */
function formatParams(params) {
    /** @type {Record<string, string | number>} */ const out = {};
    for (const [k, v] of Object.entries(params ?? {})) {
        out[k] = typeof v === 'number' ? num(v, Number.isInteger(v) ? 0 : 1) : v;
    }
    return out;
}

/**
 * Todos los hitos del plan, ya traducidos, listos para el lienzo.
 *
 * @param {*} data el `PlanBundle` de `plan-state.js`
 * @param {number} todayIndex
 * @param {Object} [options]
 * @param {import('./muscle-units.js').MuscleUnits} [options.muscle] para que el
 *   umbral de músculo se lea en la misma unidad que el eje
 * @param {Array<{ dayIndex: number, measuresCm?: Record<string, number>, subjective?: Record<string, number> }>} [options.checkins]
 * @param {ReadonlyArray<string>} [options.categories] cuáles se quieren; por defecto todas
 * @returns {import('./chart.js').ChartMark[]}
 */
export function buildMarks(data, todayIndex, options = {}) {
    const projection = data?.projection;
    if (!projection?.daily?.length) return [];
    const quiere = (/** @type {string} */ c) => !options.categories || options.categories.includes(c);
    const locale = getLocale();
    /** @type {import('./chart.js').ChartMark[]} */ const out = [];

    // 1 · Motor: fases y cruces de umbral. Ya venían con la gráfica de
    // Proyección; lo único nuevo es que aquí se separan en dos categorías,
    // porque «empieza la definición» y «cruzas los 80 kg» no son lo mismo.
    if (quiere('phase') || quiere('body')) {
        for (const m of projection.milestones ?? []) {
            const kind = m.category === 'phase' ? 'phase' : 'body';
            if (!quiere(kind)) continue;
            out.push({
                dayIndex: m.dayIndex,
                kind: /** @type {*} */ (kind),
                label: milestoneLabel(m, options.muscle)
            });
        }
    }

    // 2 · Catálogo estético. Los de partida se descartan: el usuario los traía
    // puestos desde antes de empezar y marcar el día 0 con veinte triángulos
    // dice, falsamente, que ese día pasó algo.
    if (quiere('aesthetic')) {
        const esteticos = aestheticMilestonesFor(
            projection, { startMuscleKg: data.composition?.muscleKg }, todayIndex);
        for (const m of esteticos) {
            if (m.fromStart) continue;
            out.push({
                dayIndex: m.dayIndex,
                kind: 'aesthetic',
                label: textOf(m.title, locale),
                detail: textOf(m.description, locale)
            });
        }
    }

    // 3 · Salud. Los proyectados salen del plan; los de cintura y energía solo
    // existen si el usuario los midió, y por eso llegan por `options.checkins`
    // en vez de deducirse: estimar una cintura y anunciarla como umbral de
    // riesgo sería inventar el dato más delicado de la lista.
    if (quiere('health')) {
        const perfil = {
            heightCm: data.profile?.user?.heightCm,
            sex: data.profile?.user?.sex === 'female' ? 'female' : 'male'
        };
        const salud = [
            ...projectedHealthMilestones(projection, /** @type {*} */ (perfil), todayIndex),
            ...measuredHealthMilestones(
                (options.checkins ?? []).map((c) => ({
                    ...c,
                    dateISO: projection.daily[c.dayIndex]?.dateISO ?? ''
                })),
                /** @type {*} */ (perfil), todayIndex)
        ];
        for (const m of salud) {
            out.push({
                dayIndex: m.dayIndex,
                // Un aviso NO se pinta como un logro. Es la única distinción de
                // color que carga con significado, y por eso la ficha la repite
                // con palabras: el color solo desempata.
                kind: m.kind === 'risk' ? 'risk' : 'health',
                label: t(m.labelKey, formatParams(m.labelParams)),
                detail: t(m.sourceKey)
            });
        }
    }

    return out.sort((a, b) => a.dayIndex - b.dayIndex);
}

/**
 * La ficha de un grupo de hitos.
 *
 * Vive aquí, junto al vocabulario de hitos, y no dentro de una vista: hasta
 * E15-17 solo la tenía Analizar, y Proyección enseñaba sus hitos de otra forma
 * —puntos sobre la línea, con su propio modal—. Dos mecanismos son dos cosas que
 * mantener y dos que pueden divergir, y divergieron: por los puntos solo cabían
 * los del motor, así que Proyección no enseñaba ni los estéticos ni los de
 * salud.
 *
 * @param {import('./chart.js').MarkGroup} group
 * @param {string | null} [dateISO] la fecha de ese día, si el llamante la sabe
 */
export function openMarkCard(group, dateISO = null) {
    modal.open({
        titleKey: 'analysis.marks.cardTitle',
        body: html`
            ${dateISO ? html`<p class="muted">${longDate(dateISO)}</p>` : ''}
            <ul class="mark-card">
                ${group.marks.map((m) => html`
                    <li class="mark-card__item is-mark-${m.kind}">
                        <span class="badge badge--outline">${t(`analysis.marks.kind.${m.kind}`)}</span>
                        <p class="mark-card__label">${m.label}</p>
                        ${m.detail ? html`<p class="muted">${m.detail}</p>` : ''}
                    </li>
                `)}
            </ul>
        `
    });
}

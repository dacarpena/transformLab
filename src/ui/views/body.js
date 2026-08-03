// @ts-check

/**
 * Vista de silueta (M5-3): comparador inicio / hoy / objetivo.
 *
 * El SVG se dibuja aquí a partir de la geometría que devuelve `core/silhouette`.
 * La vista dice que es un esquema, no un retrato: comparar tres estados con la
 * misma regla es lo que aporta, no simular un cuerpo.
 */

import { html, render } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import * as plans from '../plan-state.js';
import * as checkins from '../../data/checkins.js';
import { shapeFor, waistToShoulderRatio } from '../../core/silhouette.js';
import { error as errorState } from '../components/state.js';

const W = 180;
const H = 320;
const CX = W / 2;

/** Alturas de referencia del lienzo, de la coronilla a los tobillos. */
const Y = Object.freeze({
    headCenter: 22, headRadius: 13, neck: 38, shoulder: 54,
    chest: 94, waist: 140, hip: 174, knee: 240, ankle: 300
});

/**
 * Altura del dibujo en píxeles. `core/silhouette` devuelve cada anchura como
 * FRACCIÓN de la altura total de la figura (`height: 1`), así que esta es la
 * constante que convierte esas fracciones en píxeles del lienzo.
 */
const FIGURE_PX = Y.ankle - (Y.headCenter - Y.headRadius);

/** @param {number} n */
const r1 = (n) => Math.round(n * 10) / 10;

/**
 * Camino SVG de una silueta: tronco, dos piernas, dos brazos y cabeza, como
 * subcaminos de un único `d` (así una sola transición los anima a la vez).
 *
 * Cada valor de `shape` es la anchura COMPLETA de esa zona; para dibujar
 * media figura se usa la mitad.
 * @param {import('../../core/silhouette.js').SilhouetteShape} shape
 * @returns {string}
 */
function pathFor(shape) {
    /** Fracción de altura → media anchura en píxeles. */
    const half = (v) => (v * FIGURE_PX) / 2;

    const sh = half(shape.shoulders);
    const ch = half(shape.chest);
    const wa = half(shape.waist);
    const hi = half(shape.hips);
    const thighW = shape.thigh * FIGURE_PX;   // anchura de UN muslo
    const armW = shape.arm * FIGURE_PX;       // anchura de UN brazo
    const neck = 7;

    // Tronco: cuello → hombro → pecho → cintura → cadera, y su espejo.
    const torso = [
        `M ${r1(CX - neck)} ${Y.neck}`,
        `L ${r1(CX + neck)} ${Y.neck}`,
        `L ${r1(CX + sh)} ${Y.shoulder}`,
        `L ${r1(CX + ch)} ${Y.chest}`,
        `L ${r1(CX + wa)} ${Y.waist}`,
        `L ${r1(CX + hi)} ${Y.hip}`,
        `L ${r1(CX - hi)} ${Y.hip}`,
        `L ${r1(CX - wa)} ${Y.waist}`,
        `L ${r1(CX - ch)} ${Y.chest}`,
        `L ${r1(CX - sh)} ${Y.shoulder}`,
        'Z'
    ].join(' ');

    // Piernas: de la cadera al tobillo, adelgazando. `sign` da la simétrica.
    /** @param {1 | -1} sign */
    const leg = (sign) => {
        const crotch = CX + sign * 2;
        const kneeIn = CX + sign * 4;
        const kneeOut = CX + sign * (4 + thighW * 0.74);
        const ankleIn = CX + sign * 6;
        const ankleOut = CX + sign * (6 + thighW * 0.42);
        return [
            `M ${r1(crotch)} ${Y.hip - 2}`,
            `L ${r1(CX + sign * hi)} ${Y.hip}`,
            `L ${r1(kneeOut)} ${Y.knee}`,
            `L ${r1(ankleOut)} ${Y.ankle}`,
            `L ${r1(ankleIn)} ${Y.ankle}`,
            `L ${r1(kneeIn)} ${Y.knee}`,
            'Z'
        ].join(' ');
    };

    // Brazos: cuelgan pegados al tronco, del hombro a la altura de la cadera.
    /** @param {1 | -1} sign */
    const arm = (sign) => {
        const handY = Y.waist + 26;
        return [
            `M ${r1(CX + sign * (sh - armW * 0.35))} ${Y.shoulder - 1}`,
            `L ${r1(CX + sign * (sh + 1))} ${Y.shoulder + 3}`,
            `L ${r1(CX + sign * (ch + armW + 2))} ${handY}`,
            `L ${r1(CX + sign * (ch + 2))} ${handY}`,
            `L ${r1(CX + sign * (ch + 1))} ${Y.chest}`,
            'Z'
        ].join(' ');
    };

    const head = `M ${CX} ${Y.headCenter - Y.headRadius} `
        + `a ${Y.headRadius} ${Y.headRadius} 0 1 0 0.1 0 Z`;

    return `${torso} ${leg(1)} ${leg(-1)} ${arm(1)} ${arm(-1)} ${head}`;
}

/**
 * @param {import('../../core/silhouette.js').SilhouetteShape | null} shape
 * @param {string} labelKey
 * @param {string} color
 */
function renderFigure(shape, labelKey, color) {
    if (!shape) return '';
    const ratio = waistToShoulderRatio(shape);
    return html`
        <figure class="silhouette">
            <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
                 aria-label="${t(labelKey)}. ${t('body.ratio')}: ${ratio.toFixed(2)}">
                <path d="${pathFor(shape)}" fill="var(${color})" fill-opacity="0.9"
                      stroke="var(--color-bg)" stroke-width="1.5" fill-rule="evenodd"/>
            </svg>
            <figcaption>
                <strong>${t(labelKey)}</strong>
                <span class="muted numeric"> · ${ratio.toFixed(2)}</span>
            </figcaption>
        </figure>
    `;
}

/** @param {HTMLElement} container */
export function mount(container) {
    const data = plans.get();
    if (!data) {
        render(container, errorState({ titleKey: 'body.title', bodyKey: 'nutrition.noPlan', actions: [] }));
        return;
    }
    const today = plans.todayIndex(data, plans.todayISO());
    const daily = data.projection.daily;
    const lastCheckin = checkins.list().at(-1);
    const measures = lastCheckin?.measuresCm;
    const sex = data.profile.user.sex;

    const toComposition = (point) => ({
        weightKg: point.weightKg, fatPct: point.fatPct, muscleKg: point.muscleKg, sex
    });

    const start = shapeFor(toComposition(daily[0]));
    const now = shapeFor(toComposition(daily[today.dayIndex]), measures);
    const goal = shapeFor(toComposition(daily[daily.length - 1]));

    render(container, html`
        <h1 class="card__title">${t('body.title')}</h1>
        <section class="card">
            <div class="silhouette-row">
                ${renderFigure(start, 'body.start', '--color-text-muted')}
                ${renderFigure(now, 'body.today', '--color-accent')}
                ${renderFigure(goal, 'body.goal', '--color-success')}
            </div>
            <p class="muted">${t('body.schematic')}</p>
            <p class="muted">${t(now?.fromMeasures ? 'body.fromMeasures' : 'body.fromEstimate')}</p>
        </section>
    `);
}

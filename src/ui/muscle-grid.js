// @ts-check

/**
 * La rejilla músculo a músculo: diez gráficas pequeñas (V2-M9).
 *
 * SVG EN LÍNEA, NO DIEZ INSTANCIAS DE CHART.JS. La factoría de V2-M8 permitiría
 * lo segundo, pero un *small multiple* no necesita ejes, tooltips ni cursor de
 * teclado propio: necesita forma, banda y una cifra. Diez lienzos con toda la
 * maquinaria costarían lo que cuestan y darían al lector de pantalla diez
 * regiones `aria-live` compitiendo entre ellas. Con SVG el coste es el de pintar
 * un `path`, y la accesibilidad se resuelve donde debe: con una TABLA de datos
 * de verdad, que es lo que un lector sabe recorrer.
 *
 * LA HONESTIDAD ES EL REQUISITO, no un adorno. Estas series son una
 * DESAGREGACIÓN del presupuesto de músculo que ya proyectó el motor, repartido
 * por el estímulo que recibe cada grupo — no una medición. Nadie mide el músculo
 * de su bíceps en casa. Por eso cada tarjeta va rotulada como estimación y la
 * rejilla entera lleva su aviso: presentarlo como dato repetiría, a escala fina,
 * el error que hundió la v4.0.
 *
 * SOBRE LA UNIDAD (E11). Los niveles por grupo se muestran en **músculo
 * esquelético**, NO en unidad de báscula, y esto es una desviación deliberada
 * del plan: la báscula mide el cuerpo entero, así que trasladar su desfase a un
 * bíceps concreto le atribuiría a ese músculo el agua y el hueso de todo el
 * cuerpo. No convertir es más honesto que convertir mal.
 */

import { html } from './dom.js';
import { t } from '../i18n/i18n.js';
import { num } from './format.js';
import { MUSCLE_GROUPS } from '../core/muscle-volume.js';

/** Tamaño del lienzo de cada gráfica pequeña, en unidades de `viewBox`. */
const W = 120;
const H = 36;

/**
 * Camino SVG de una serie, normalizado al lienzo.
 *
 * La escala vertical es COMÚN a la banda y a la línea, y se calcula sobre el
 * conjunto de los tres escenarios: con escalas distintas la banda podría salir
 * por debajo de la línea que envuelve, que es exactamente la clase de gráfica
 * que engaña sin mentir en ningún número.
 *
 * @param {number[]} values
 * @param {number} min
 * @param {number} max
 * @returns {string}
 */
function pathOf(values, min, max) {
    if (values.length === 0) return '';
    const span = max - min;
    // Una serie plana no puede dividir por cero: se dibuja en el centro.
    const y = (/** @type {number} */ v) => (span <= 0 ? H / 2 : H - ((v - min) / span) * H);
    const x = (/** @type {number} */ i) => (values.length === 1 ? 0 : (i / (values.length - 1)) * W);
    return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
}

/**
 * Área cerrada entre dos series, para pintar la banda.
 * @param {number[]} lower @param {number[]} upper @param {number} min @param {number} max
 * @returns {string}
 */
function bandPath(lower, upper, min, max) {
    if (lower.length === 0) return '';
    const span = max - min;
    const y = (/** @type {number} */ v) => (span <= 0 ? H / 2 : H - ((v - min) / span) * H);
    const x = (/** @type {number} */ i) => (lower.length === 1 ? 0 : (i / (lower.length - 1)) * W);
    const ida = upper.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
    const vuelta = [...lower].reverse()
        .map((v, i) => `L${x(lower.length - 1 - i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
    return `${ida} ${vuelta} Z`;
}

/**
 * Muestrea una serie larga a un número manejable de puntos.
 *
 * Un plan de 200 días son 200 puntos por grupo y 2 000 en la rejilla. A 120
 * unidades de ancho, más de ~60 puntos no añaden un píxel de información y sí
 * multiplican por tres el tamaño del documento.
 * @template T
 * @param {T[]} list
 * @param {number} maxPoints
 * @returns {T[]}
 */
function sample(list, maxPoints = 60) {
    if (list.length <= maxPoints) return list;
    const step = (list.length - 1) / (maxPoints - 1);
    return Array.from({ length: maxPoints }, (_, i) => list[Math.round(i * step)]);
}

/**
 * Una tarjeta: nombre, cifras y la gráfica pequeña.
 * @param {import('../core/muscle-groups.js').GroupSeries} serie
 * @param {number} todayIndex
 */
function card(serie, todayIndex) {
    const puntos = sample(serie.daily);
    const esperado = puntos.map((p) => p.muscleKg);
    const pesimista = puntos.map((p) => p.band.pessimistKg);
    const optimista = puntos.map((p) => p.band.optimistKg);

    const todos = [...esperado, ...pesimista, ...optimista];
    const min = Math.min(...todos);
    const max = Math.max(...todos);

    const hoy = serie.daily[Math.min(todayIndex, serie.daily.length - 1)];
    const gananciaHastaHoy = hoy.muscleKg - serie.startKg;

    // El SVG se construye con `html`, NO con `raw`. Los caminos son geometría
    // generada aquí —dígitos y letras de comando— así que no habría nada que
    // escapar, pero `raw` con una interpolación es exactamente el patrón que el
    // test de seguridad prohíbe, y con razón: la excepción obligaría a auditar a
    // mano cada uso. Escapar path data no cuesta nada y la regla se queda
    // entera.
    const svg = html`
        <svg class="muscle-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"
             role="img" aria-label="${t(`muscle.${serie.group}`)}" focusable="false">
            <path class="muscle-spark__band" d="${bandPath(pesimista, optimista, min, max)}"></path>
            <path class="muscle-spark__line" d="${pathOf(esperado, min, max)}"></path>
        </svg>
    `;

    return html`
        <li class="muscle-card">
            <div class="muscle-card__head">
                <span class="muscle-card__name">${t(`muscle.${serie.group}`)}</span>
                <span class="badge badge--estimate">${t('muscleGrid.estimate')}</span>
            </div>
            ${svg}
            <span class="muted numeric">${t('muscleGrid.now', { kg: num(hoy.muscleKg, 2) })}</span>
            <span class="muted numeric">${t('muscleGrid.gain', {
                sofar: num(gananciaHastaHoy, 2), total: num(serie.gainKg, 2)
            })}</span>
        </li>
    `;
}

/**
 * La rejilla completa.
 *
 * @param {{
 *   projection: { groups: import('../core/muscle-groups.js').GroupSeries[], stimulusKnown: boolean },
 *   todayIndex: number,
 *   repartoOk: boolean
 * }} input
 */
export function renderMuscleGrid(input) {
    const groups = input?.projection?.groups ?? [];
    if (groups.length === 0) {
        return html`<p class="muted">${t('muscleGrid.empty')}</p>`;
    }

    // EL CORTAFUEGOS, DICHO. Si la suma por grupo no reconstituyera el músculo
    // global, la rejilla estaría contradiciendo a la gráfica principal sobre los
    // mismos datos. Es mejor decirlo que pintar once gráficas que no cuadran.
    if (!input.repartoOk) {
        return html`
            <p class="notice notice--warning">
                <span class="notice__icon" aria-hidden="true">⚠</span>
                <span>${t('muscleGrid.repartoBroken')}</span>
            </p>
        `;
    }

    const ordenados = [...groups].sort((a, b) => b.gainKg - a.gainKg);
    const todayIndex = Number.isFinite(input?.todayIndex) ? input.todayIndex : 0;

    return html`
        <p class="muted">${t('muscleGrid.explain')}</p>
        ${input.projection.stimulusKnown
            ? html`<p class="muted">${t('muscleGrid.fromTraining')}</p>`
            : html`<p class="muted">${t('muscleGrid.noTraining')}</p>`}

        <ul class="muscle-grid">${ordenados.map((serie) => card(serie, todayIndex))}</ul>

        <!--
            LA TABLA NO ES UN EXTRA DE ACCESIBILIDAD, es la version accesible de
            la rejilla. Diez graficas con su propia region aria-live competirian
            entre ellas; una tabla es lo que un lector de pantalla sabe recorrer.
            (Sin acentos graves aqui dentro: CIERRAN la plantilla.)
        -->
        <details class="muscle-grid__table">
            <summary>${t('muscleGrid.tableToggle')}</summary>
            <table class="data-table">
                <caption>${t('muscleGrid.tableCaption')}</caption>
                <thead>
                    <tr>
                        <th scope="col">${t('muscleGrid.colGroup')}</th>
                        <th scope="col">${t('muscleGrid.colNow')}</th>
                        <th scope="col">${t('muscleGrid.colEnd')}</th>
                        <th scope="col">${t('muscleGrid.colGain')}</th>
                    </tr>
                </thead>
                <tbody>
                    ${ordenados.map((serie) => {
                        const hoy = serie.daily[Math.min(todayIndex, serie.daily.length - 1)];
                        return html`
                            <tr>
                                <th scope="row">${t(`muscle.${serie.group}`)}</th>
                                <td class="numeric">${num(hoy.muscleKg, 2)}</td>
                                <td class="numeric">${num(serie.endKg, 2)}</td>
                                <td class="numeric">${num(serie.gainKg, 2)}</td>
                            </tr>
                        `;
                    })}
                </tbody>
            </table>
        </details>

        <p class="muted">${t('muscleGrid.disclaimer')}</p>
        <p class="muted">${t('muscleGrid.unitNote')}</p>
    `;
}

/** Los grupos, en el orden canónico. Para los tests y la tabla. */
export { MUSCLE_GROUPS };

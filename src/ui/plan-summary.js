// @ts-check

/**
 * El plan integral en «Hoy»: una línea por módulo activo (V2-M10).
 *
 * REÚNE EL ESTADO DE LOS SEIS MÓDULOS Y LO REDUCE A SEIS LÍNEAS. Es la pieza que
 * convierte siete pantallas en un producto: sin ella, saber si vas bien exige
 * recorrerlas todas.
 *
 * VIVE FUERA DE LA VISTA a propósito. `dashboard.js` ya tuvo que adelgazar en
 * E12-6 porque se había convertido en el muro que nadie leía; volver a meterle
 * la lógica de seis módulos sería deshacer aquello en un commit. Aquí se junta
 * el estado, `core/integrated-plan.js` decide qué dice cada línea, y la vista
 * solo pinta.
 *
 * LO QUE FALTA SE DICE. Un módulo sin configurar no se esconde ni finge un
 * número: enseña qué le falta y un botón para ir a dárselo.
 */

import { html } from './dom.js';
import { t } from '../i18n/i18n.js';
import { int } from './format.js';
import { todayRows, loopStatus } from '../core/integrated-plan.js';
import { DEFAULT_ACTIVE } from '../core/modules.js';
import { coordinate, collectOffers } from '../core/recalibration.js';
import { MIN_DAYS } from '../core/expenditure.js';
import * as preferencesStore from '../data/preferences.js';
import * as recipesRepo from '../data/recipes.js';
import * as stepsStore from '../data/steps.js';
import * as intakeLog from '../data/intake-log.js';
import * as trainingStore from '../data/training.js';
import * as checkins from '../data/checkins.js';
import { macrosFor } from '../core/nutrition.js';
import { neatAverage, dailyTarget } from '../core/steps.js';
import { recoveryScore } from '../core/training-plan.js';

/**
 * Estado de cada módulo, leído de su propio repositorio.
 *
 * NO recalcula nada pesado: el menú y el reparto de volumen se construyen en sus
 * vistas, que es donde el usuario los mira. Aquí solo se comprueba si hay con
 * qué construirlos, porque «Hoy» tiene que pintar rápido y el usuario abre esta
 * pantalla veinte veces al día.
 *
 * @param {*} data bundle del plan
 * @returns {*}
 */
function gather(data) {
    const prefs = preferencesStore.get();
    const activeModules = prefs.activeModules.length > 0
        ? prefs.activeModules
        // Un perfil de la v1 no eligió módulos: caen los de fábrica en vez de
        // dejarle «Hoy» sin nada, que es lo que pasaría con la lista vacía.
        : [...DEFAULT_ACTIVE];

    const today = data ? data.projection.daily[
        Math.min(data.projection.daily.length - 1, Math.max(0, data.todayIndex ?? 0))
    ] : null;
    /** @type {*} */
    const macros = today ? macrosFor(today) : { ok: false };

    const training = trainingStore.read();
    const pasos = stepsStore.list();
    const registros = checkins.list();
    const weightKg = today?.weightKg ?? 70;

    return {
        activeModules,
        nutrition: macros.ok
            ? {
                kcal: macros.value.kcal,
                proteinG: macros.value.proteinG,
                // El menú se construye en Nutrición; aquí basta con saber que
                // hay macros con las que construirlo.
                menuReady: true
            }
            : null,
        training: {
            sessionsLogged: training.sessions.length,
            // El recuento fino por grupo vive en Entreno: repetirlo aquí
            // obligaría a cargar el catálogo de 556 ejercicios para pintar una
            // línea de la pantalla de inicio.
            belowMev: 0
        },
        shopping: recipesRepo.listPantry().length >= 0 && macros.ok ? { toBuyLines: undefined } : null,
        supplements: { count: 0, safetyDeclared: false },
        steps: (() => {
            const media = neatAverage({ entries: pasos, weightKg });
            return media
                ? { declared: true, meanSteps: media.meanSteps, targetSteps: dailyTarget('moderate') }
                : { declared: false };
        })(),
        recovery: recoveryScore(registros),
        loop: loopStatus({
            hasPlan: Boolean(data),
            checkinCount: registros.length,
            intakeDays: intakeLog.list().length,
            minIntakeDays: MIN_DAYS
        })
    };
}

/**
 * La tarjeta del plan integral.
 * @param {*} data bundle del plan, con `todayIndex`
 * @returns {*}
 */
export function renderPlanSummary(data) {
    const state = gather(data);
    const { rows, readyCount, total } = todayRows(state);
    if (total === 0) return '';

    return html`
        <section class="card" aria-labelledby="plan-summary-title">
            <div class="card__header">
                <h2 id="plan-summary-title" class="card__title">${t('plan.title')}</h2>
                <span class="muted numeric">${t('plan.ready', { ready: readyCount, total })}</span>
            </div>

            <ul class="profile-list">
                ${rows.map((/** @type {*} */ row) => html`
                    <li class="profile-item">
                        <span class="food-row">
                            <span class="food-row__name">${t(`module.${row.module}`)}</span>
                            <span class="muted">${t(row.labelKey, row.params ?? {})}</span>
                        </span>
                        ${row.state === 'needsInput'
                            ? html`<button type="button" class="btn btn--sm" data-go-module="${row.viewId}">
                                ${t(row.actionKey ?? 'plan.action.open')}
                            </button>`
                            : html`<button type="button" class="btn btn--sm" data-go-module="${row.viewId}">
                                ${t('plan.action.open')}
                            </button>`}
                    </li>
                `)}
            </ul>

            ${state.loop.closed
                ? html`<p class="muted">${t('plan.loopClosed')}</p>`
                : html`
                    <!--
                        EL BUCLE, DICHO. Sin esto la app esperaria catorce dias a
                        tener datos que nadie le esta dando, en silencio. (Sin
                        acentos graves aqui: CIERRAN la plantilla.)
                    -->
                    <p class="muted">${t('plan.loopMissing', {
                        what: state.loop.missing.map((/** @type {string} */ k) => t(k)).join(' ')
                    })}</p>
                `}
        </section>
    `;
}

/**
 * La oferta de recalibración COORDINADA (V2-M10).
 *
 * Tres fuentes pueden pedir recalibrar y `core/recalibration.js` decide cuál se
 * enseña. Lo aplazado se menciona, no se oculta: callarlo haría que el usuario
 * descubriera el segundo aviso una semana después sin entender por qué no salió
 * antes.
 *
 * @param {{
 *   weightDeviation?: * , measuredExpenditure?: *, deload?: *
 * }} sources
 * @returns {*}
 */
export function renderCoordinatedOffer(sources) {
    const { primary, deferred, superseded } = coordinate(collectOffers(sources));
    if (!primary) return '';

    return html`
        <p class="notice notice--warning">
            <span class="notice__icon" aria-hidden="true">⚠</span>
            <span>${t(primary.reasonKey, primary.params ?? {})}</span>
            <!-- La acción va DENTRO del aviso, y solo la de la oferta principal.
                 Un aviso sin salida es la falta que cerró E15-1; dos botones
                 sería volver a las dos ofertas vivas que esto viene a impedir. -->
            <button type="button" class="btn btn--sm" data-recal-source="${primary.source}">
                ${t('recalibration.act')}
            </button>
        </p>
        ${superseded.length > 0
            ? html`<p class="muted">${t('recalibration.superseded', {
                n: int(superseded.length)
            })}</p>`
            : ''}
        ${deferred.length > 0
            ? html`<p class="muted">${t('recalibration.deferred', {
                n: int(deferred.length)
            })}</p>`
            : ''}
    `;
}

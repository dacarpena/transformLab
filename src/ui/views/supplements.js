// @ts-check

/**
 * Vista «Suplementos»: qué mueve la aguja, qué no, y por qué (V2-M5).
 *
 * LA HONESTIDAD ES LA FUNCIÓN. Esta app no vende nada, así que la pantalla puede
 * decir «los BCAA no te hacen falta» y «los quemagrasas son cafeína cara» sin
 * perder margen. Ninguna web que rankee suplementos Y regente la tienda puede
 * escribir eso, y por eso lo que aquí se lee es distinto de lo que se lee fuera.
 *
 * EL NIVEL DE EVIDENCIA VA SIEMPRE AL LADO, incluso cuando es «ninguna». No hay
 * una sección de recomendados y otra escondida: hay tres bloques a la vista —lo
 * que sirve, lo que se ha retirado por seguridad, y lo que se vende mucho y no
 * funciona— porque ocultar el tercero deja al usuario comprándolo en otro sitio.
 *
 * ESTO NO ES CONSEJO MÉDICO, y el aviso viene con el resultado del selector
 * (`disclaimerKey`) precisamente para que esta vista no pueda olvidarlo.
 */

import { html, render, on } from '../dom.js';
import { t, getLocale } from '../../i18n/i18n.js';
import * as plans from '../plan-state.js';
import * as storage from '../../data/storage.js';
import * as toast from '../components/toast.js';
import { error as errorState } from '../components/state.js';
import { SCHEMA_VERSION, validateCollection } from '../../data/schema.js';
import {
    SUPPLEMENTS, SAFETY_FLAGS, stackFor, stackCost, caffeinePlan, textOf
} from '../../core/supplements.js';

const KEY = 'supplementsPlan';

/**
 * Horas del usuario. Viven en el módulo y no en el almacén: son un ajuste de
 * consulta —«¿me choca si entreno a las ocho?»— y persistirlas exigiría subir el
 * esquema por dos campos que solo alimentan un aviso.
 */
let bedtime = '';
let trainingTime = '';

/**
 * Lo que el usuario ha declarado y elegido. Degrada a vacío, nunca lanza.
 * @returns {{ excluded: string[], chosen: string[] }}
 */
function readPlan() {
    const stored = storage.get(KEY);
    if (!stored.ok || stored.value === null) return { excluded: [], chosen: [] };
    const parsed = validateCollection(KEY, stored.value);
    return parsed.ok ? { excluded: parsed.value.excluded, chosen: parsed.value.chosen } : { excluded: [], chosen: [] };
}

/** @param {{ excluded: string[], chosen: string[] }} plan */
function writePlan(plan) {
    const checked = validateCollection(KEY, { schemaVersion: SCHEMA_VERSION, ...plan });
    if (!checked.ok) return false;
    return storage.set(KEY, checked.value).ok;
}

/**
 * Banderas de seguridad declaradas.
 *
 * Se guardan en `excluded` con un prefijo, y no en una colección nueva, para no
 * subir el esquema por cuatro casillas. El prefijo las mantiene distinguibles de
 * los suplementos que el usuario descarta por gusto, que es una decisión de otra
 * naturaleza: una se puede reconsiderar, la otra protege su salud.
 */
const FLAG_PREFIX = 'safety:';

function readFlags(/** @type {string[]} */ excluded) {
    return excluded.filter((e) => e.startsWith(FLAG_PREFIX)).map((e) => e.slice(FLAG_PREFIX.length));
}

function readExcludedIds(/** @type {string[]} */ excluded) {
    return excluded.filter((e) => !e.startsWith(FLAG_PREFIX));
}

/** Insignia de nivel de evidencia. */
function evidenceBadge(/** @type {string} */ evidence) {
    return html`<span class="badge badge--ev-${evidence}">${t(`supplements.evidence.${evidence}`)}</span>`;
}

/** Una ficha de suplemento. */
function card(/** @type {*} */ entry, /** @type {string} */ locale, /** @type {boolean} */ conExcluir) {
    const { item } = entry;
    return html`
        <li class="profile-item profile-item--stacked">
            <span class="food-row">
                <span class="food-row__name">${textOf(item.name, locale)}</span>
                ${evidenceBadge(item.evidence)}
                <span class="muted">${textOf(item.doseText, locale)}</span>
                <span class="muted">${textOf(item.why, locale)}</span>
                <span class="muted">${textOf(item.caveats, locale)}</span>
                <span class="muted">${t('supplements.cost', {
                    min: item.costEurMonth[0], max: item.costEurMonth[1]
                })}</span>
                ${entry.excludedBy
                    ? html`<span class="muted">${t('supplements.removedBy', {
                        reason: t(`supplements.flag.${entry.excludedBy}`)
                    })}</span>`
                    : ''}
                ${item.dopingRisk
                    ? html`<span class="muted">${t('supplements.dopingRisk')}</span>`
                    : ''}
            </span>
            ${conExcluir
                ? html`<button type="button" class="btn btn--sm" data-exclude="${item.id}">
                    ${t('supplements.notForMe')}
                </button>`
                : ''}
        </li>
    `;
}

/** Casillas de seguridad. Son la entrada del cribado duro. */
function renderSafety(/** @type {string[]} */ flags) {
    return html`
        <section class="card" aria-labelledby="safety-title">
            <div class="card__header">
                <h2 id="safety-title" class="card__title">${t('supplements.safetyTitle')}</h2>
            </div>
            <p class="muted">${t('supplements.safetyExplain')}</p>
            <div class="safety-grid">
                ${SAFETY_FLAGS.map((flag) => html`
                    <label class="switch">
                        <input type="checkbox" data-flag="${flag}" ${flags.includes(flag) ? 'checked' : ''}>
                        <span>${t(`supplements.flag.${flag}`)}</span>
                    </label>
                `)}
            </div>
        </section>
    `;
}

/** @param {HTMLElement} container */
function draw(container) {
    try {
        const locale = getLocale();
        const plan = readPlan();
        const flags = readFlags(plan.excluded);
        const excludedIds = readExcludedIds(plan.excluded);

        const bundle = plans.get();
        const point = bundle
            ? bundle.projection.daily[plans.todayIndex(bundle, plans.todayISO()).dayIndex]
            : null;
        const phase = point?.phaseType ?? '';
        const weightKg = point?.weightKg ?? bundle?.profile?.initial?.weightKg ?? 0;

        const stack = stackFor({ phase, safetyFlags: flags, excluded: excludedIds });
        const cost = stackCost(stack.recommended);
        const caffeine = caffeinePlan({ weightKg, bedtime, trainingTime });
        const enElStack = stack.recommended.some((e) => e.item.id === 'caffeine');

        render(container, html`
            <h1 class="visually-hidden">${t('supplements.title')}</h1>

            <section class="card" aria-labelledby="stack-title">
                <div class="card__header">
                    <h2 id="stack-title" class="card__title">${t('supplements.title')}</h2>
                    ${phase ? html`<span class="badge badge--${phase}">${t(`phase.${phase}`)}</span>` : ''}
                </div>
                <p class="muted">${t('supplements.intro')}</p>

                ${stack.recommended.length === 0
                    ? html`<p class="muted">${t('supplements.noneLeft')}</p>`
                    : html`<ul class="profile-list">
                        ${stack.recommended.map((/** @type {*} */ e) => card(e, locale, true))}
                    </ul>`}

                <p class="muted numeric">${t('supplements.totalCost', {
                    min: cost.minEur, max: cost.maxEur
                })}</p>
                <!--
                    El aviso viene del selector, no de esta plantilla: asi
                    ninguna pantalla puede olvidarse de ponerlo. (Sin acentos
                    graves aqui dentro: CIERRAN la plantilla.)
                -->
                <p class="muted">${t(stack.disclaimerKey)}</p>
            </section>

            ${enElStack && weightKg > 0
                ? html`
                    <section class="card" aria-labelledby="caffeine-title">
                        <h2 id="caffeine-title" class="card__title">${t('supplements.caffeineTitle')}</h2>
                        <p class="muted">${t('supplements.caffeineDose', {
                            min: caffeine.minMg, max: caffeine.maxMg
                        })}</p>
                        ${caffeine.cutoffTime
                            ? html`<p class="muted">${t('supplements.caffeineCutoff', { time: caffeine.cutoffTime })}</p>`
                            : html`<p class="muted">${t('supplements.caffeineNoBedtime')}</p>`}
                        <label class="field">
                            <span class="field__label">${t('supplements.bedtime')}</span>
                            <input class="input" type="time" data-bedtime value="${bedtime}">
                        </label>
                        <label class="field">
                            <span class="field__label">${t('supplements.trainingTime')}</span>
                            <input class="input" type="time" data-training-time value="${trainingTime}">
                        </label>
                        ${caffeine.conflict
                            // Se AVISA; no se cambia nada por el usuario (B9).
                            ? html`
                                <p class="notice notice--warning">
                                    <span class="notice__icon" aria-hidden="true">⚠</span>
                                    <span>${t('supplements.caffeineConflict')}</span>
                                </p>
                            `
                            : ''}
                    </section>
                `
                : ''}

            ${renderSafety(flags)}

            ${stack.excludedBySafety.length > 0
                ? html`
                    <section class="card" aria-labelledby="removed-title">
                        <h2 id="removed-title" class="card__title">${t('supplements.removedTitle')}</h2>
                        <p class="muted">${t('supplements.removedExplain')}</p>
                        <ul class="profile-list">
                            ${stack.excludedBySafety.map((/** @type {*} */ e) => card(e, locale, false))}
                        </ul>
                    </section>
                `
                : ''}

            <section class="card" aria-labelledby="noev-title">
                <h2 id="noev-title" class="card__title">${t('supplements.noEvidenceTitle')}</h2>
                <p class="muted">${t('supplements.noEvidenceExplain')}</p>
                <ul class="profile-list">
                    ${stack.noEvidence.map((/** @type {*} */ e) => card(e, locale, false))}
                </ul>
            </section>

            ${excludedIds.length > 0
                ? html`
                    <section class="card" aria-labelledby="mine-title">
                        <h2 id="mine-title" class="card__title">${t('supplements.excludedTitle')}</h2>
                        <ul class="profile-list">
                            ${excludedIds.map((id) => {
                                const item = SUPPLEMENTS.find((s) => s.id === id);
                                return html`
                                    <li class="profile-item">
                                        <span>${item ? textOf(item.name, locale) : id}</span>
                                        <button type="button" class="btn btn--sm" data-include="${id}">
                                            ${t('supplements.putBack')}
                                        </button>
                                    </li>
                                `;
                            })}
                        </ul>
                    </section>
                `
                : ''}
        `);
    } catch (err) {
        console.error('[supplements] no se pudo construir la vista', err);
        // Salida clara y NO destructiva (ficha H-013).
        render(container, errorState({ titleKey: 'error.viewTitle', bodyKey: 'error.viewBody' }));
    }
}

/** @param {HTMLElement} container */
export function mount(container) {
    draw(container);

    on(container, 'change', '[data-flag]', (_event, target) => {
        const flag = target.getAttribute('data-flag');
        if (!flag) return;
        const plan = readPlan();
        const marcada = /** @type {HTMLInputElement} */ (target).checked;
        const sin = plan.excluded.filter((e) => e !== `${FLAG_PREFIX}${flag}`);
        const next = { ...plan, excluded: marcada ? [...sin, `${FLAG_PREFIX}${flag}`] : sin };
        if (!writePlan(next)) {
            toast.error('error.generic');
            return;
        }
        draw(container);
    });

    on(container, 'click', '[data-exclude]', (_event, target) => {
        const id = target.getAttribute('data-exclude');
        if (!id) return;
        const plan = readPlan();
        if (!writePlan({ ...plan, excluded: [...new Set([...plan.excluded, id])] })) {
            toast.error('error.generic');
            return;
        }
        draw(container);
    });

    on(container, 'click', '[data-include]', (_event, target) => {
        const id = target.getAttribute('data-include');
        if (!id) return;
        const plan = readPlan();
        if (!writePlan({ ...plan, excluded: plan.excluded.filter((e) => e !== id) })) {
            toast.error('error.generic');
            return;
        }
        draw(container);
    });

    on(container, 'change', '[data-bedtime]', (_event, target) => {
        bedtime = /** @type {HTMLInputElement} */ (target).value;
        draw(container);
    });

    on(container, 'change', '[data-training-time]', (_event, target) => {
        trainingTime = /** @type {HTMLInputElement} */ (target).value;
        draw(container);
    });
}

export function unmount() {
    // Sin timers ni gráficas: nada que soltar.
}

// @ts-check

/**
 * Vista de hitos (M5-5): qué vas a ir notando y cuándo, según tu propio plan.
 *
 * A diferencia del legacy, aquí no hay totales hardcodeados ni un plan ajeno
 * de fondo: cada hito se sitúa en el día en que TU serie cruza su umbral, y
 * los que tu plan no alcanza sencillamente no se muestran.
 */

import { html, render } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import * as plans from '../plan-state.js';
import { aestheticMilestonesFor, nextAesthetic, byCategory } from '../../core/milestones.js';
import { empty } from '../components/state.js';

/** @param {string} category */
function categoryLabel(category) {
    const key = `milestones.category.${category}`;
    const label = t(key);
    return label === key ? category : label;
}

/** @param {HTMLElement} container */
export function mount(container) {
    const data = plans.get();
    if (!data) {
        render(container, html`
            <h1 class="card__title">${t('milestones.title')}</h1>
            <section class="card">
                ${empty({ icon: '🎯', titleKey: 'milestones.emptyTitle', bodyKey: 'milestones.emptyBody' })}
            </section>
        `);
        return;
    }

    const today = plans.todayIndex(data, plans.todayISO());
    const milestones = aestheticMilestonesFor(
        data.projection,
        { startMuscleKg: data.composition.muscleKg },
        today.dayIndex
    );
    const next = nextAesthetic(milestones);
    const reached = milestones.filter((m) => m.reached).length;
    const groups = byCategory(milestones);

    render(container, html`
        <h1 class="card__title">${t('milestones.title')}</h1>

        ${next ? html`
            <section class="card" aria-labelledby="next-title">
                <div class="card__header">
                    <h2 id="next-title" class="card__title">${t('milestones.next')}</h2>
                    <span class="badge badge--recomposition">${t(`milestones.visibility.${next.visibility}`)}</span>
                </div>
                <p><strong>${next.title}</strong></p>
                <p class="secondary">${next.description}</p>
                <p class="muted">${t('milestones.onDay', { day: next.dayIndex, date: next.dateISO })}</p>
            </section>
        ` : ''}

        <section class="card" aria-labelledby="cats-title">
            <div class="card__header">
                <h2 id="cats-title" class="card__title">${t('milestones.byCategory')}</h2>
                <span class="muted">${t('milestones.reachedCount', { reached, total: milestones.length })}</span>
            </div>
            ${groups.map((g) => html`
                <div class="milestone-cat">
                    <span class="field__label">${categoryLabel(g.category)}</span>
                    <span class="muted numeric">${g.reached}/${g.total}</span>
                    <div class="progress"
                         role="progressbar" aria-valuenow="${g.reached}" aria-valuemin="0" aria-valuemax="${g.total}"
                         aria-label="${categoryLabel(g.category)}: ${g.reached}/${g.total}">
                        <div class="progress__fill" data-css-progress="${g.total > 0 ? g.reached / g.total : 0}"></div>
                    </div>
                </div>
            `)}
            <p class="muted">${t('milestones.notPromised')}</p>
        </section>

        <section class="card">
            <h2 class="card__title">${t('milestones.title')}</h2>
            <ul class="profile-list">
                ${milestones.map((m) => html`
                    <li class="profile-item ${m.reached ? 'profile-item--active' : ''}">
                        <span>
                            <strong>${m.title}</strong>
                            <span class="muted"> · ${categoryLabel(m.category)}</span>
                            <br>
                            <span class="secondary">${m.description}</span>
                        </span>
                        <span class="muted numeric">
                            ${m.reached ? '✓ ' : ''}${t('milestones.onDay', { day: m.dayIndex, date: m.dateISO })}
                        </span>
                    </li>
                `)}
            </ul>
        </section>
    `);
}

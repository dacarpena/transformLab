// @ts-check

/**
 * Vista de nutrición (E4a): macros del día derivadas del plan, reparto en
 * comidas y plantillas de comida propias del usuario.
 *
 * Las macros se etiquetan como lo que son —consecuencia del objetivo calórico
 * del plan— y la vista dice explícitamente que la proteína se calcula sobre la
 * masa magra, que es la corrección de fondo frente al legacy.
 */

import { html, render, on } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import { sanitizeText } from '../../data/schema.js';
import * as nutritionStore from '../../data/nutrition.js';
import * as plans from '../plan-state.js';
import { macrosFor, refeedMacros, splitIntoMeals } from '../../core/nutrition.js';
import { buildMenu, regenerateMeal } from '../../core/menu.js';
import * as foodsDb from '../../data/foods-db.js';
import * as preferencesStore from '../../data/preferences.js';
import { seedFrom } from '../../core/rng.js';
import * as profiles from '../../data/profiles.js';
import * as modal from '../components/modal.js';
import * as toast from '../components/toast.js';
import { empty, error as errorState } from '../components/state.js';
import { int as num, num as dec } from '../format.js';

/**
 * Comidas al día. Vive en `preferences` y NO solo aquí dentro: la lista de la
 * compra construye el menú por su cuenta, y si cada vista tuviera su propio
 * número la lista no correspondería al menú que el usuario está viendo.
 */
let mealCount = 4;
let refeedToday = false;

/**
 * Catálogo de alimentos, cargado bajo demanda. `null` = todavía no está.
 * @type {import('../../core/foods.js').Food[] | null}
 */
let catalog = null;

/**
 * El menú del día. NO se persiste: es determinista, así que se regenera igual
 * que la proyección. Guardarlo solo crearía una copia que puede envejecer mal.
 * @type {* | null}
 */
let currentMenu = null;

/** Semilla del menú actual, para que regenerar una comida sea reproducible. */
let menuSeed = 1;

/** Tarjeta de macros del día. */
function renderMacros(/** @type {*} */ macros, /** @type {*} */ point) {
    return html`
        <section class="card" aria-labelledby="macros-title">
            <div class="card__header">
                <h2 id="macros-title" class="card__title">${t('nutrition.todayTitle')}</h2>
                <span class="badge badge--${point.phaseType}">${t(`phase.${point.phaseType}`)}</span>
            </div>

            <div class="metrics">
                <div class="metric">
                    <span class="metric__value">${num(macros.kcal)}</span>
                    <span class="metric__label">${t('nutrition.kcal')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${num(macros.proteinG)} <span class="muted">g</span></span>
                    <span class="metric__label">${t('nutrition.protein')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${num(macros.carbsG)} <span class="muted">g</span></span>
                    <span class="metric__label">${t('nutrition.carbs')}</span>
                </div>
                <div class="metric">
                    <span class="metric__value">${num(macros.fatG)} <span class="muted">g</span></span>
                    <span class="metric__label">${t('nutrition.fat')}</span>
                </div>
            </div>

            <p class="muted">${t('nutrition.fromPlan')}</p>
            <p class="muted">${t('nutrition.proteinNote', { lean: dec(point.leanKg) })}</p>

            ${macros.warnings.map((/** @type {*} */ code) => html`
                <p class="notice notice--warning">
                    <span class="notice__icon" aria-hidden="true">⚠</span>
                    <span>${t(code)}</span>
                </p>
            `)}

            <label class="switch">
                <input type="checkbox" data-refeed ${refeedToday ? 'checked' : ''}>
                <span>${t('nutrition.refeedToggle')}</span>
            </label>
            <p class="muted">${t('nutrition.refeedHint')}</p>
            ${refeedToday && Number.isFinite(macros.costKg) && macros.costKg > 0 ? html`
                <p class="notice notice--warning">
                    <span class="notice__icon" aria-hidden="true">⚠</span>
                    <span>${t('nutrition.refeedCost', {
                        kcal: macros.costKcal ?? 0,
                        kg: dec(macros.costKg ?? 0, 2)
                    })}</span>
                </p>
            ` : ''}
        </section>
    `;
}

/** Reparto en comidas. */
function renderMeals(/** @type {*} */ macros) {
    const split = splitIntoMeals(macros, mealCount);
    if (!split.ok) return '';
    return html`
        <section class="card" aria-labelledby="meals-title">
            <h2 id="meals-title" class="card__title">${t('nutrition.mealsTitle')}</h2>
            <label class="range-row">
                <span>${t('nutrition.mealCount')}</span>
                <input type="range" min="1" max="8" step="1" value="${mealCount}" data-meal-count>
                <span class="numeric" data-meal-count-label>${mealCount}</span>
            </label>
            <ul class="profile-list">
                ${split.value.map((meal) => html`
                    <li class="profile-item">
                        <span>${t('nutrition.meal', { n: meal.index + 1 })}</span>
                        <span class="muted numeric">
                            ${num(meal.kcal)} kcal · ${num(meal.proteinG)} P · ${num(meal.carbsG)} C · ${num(meal.fatG)} G
                        </span>
                    </li>
                `)}
            </ul>
        </section>
    `;
}

/**
 * El menú de verdad: qué comer y cuántos gramos (V2-M3).
 *
 * El reparto de arriba dice «525 kcal y 41 g de proteína», que es correcto y no
 * le sirve a nadie para hacer la compra. Esto lo convierte en comida.
 */
function renderMenu() {
    if (catalog === null) {
        return html`
            <section class="card">
                <h2 class="card__title">${t('menu.title')}</h2>
                <p class="muted" role="status">${t('foods.loading')}</p>
            </section>
        `;
    }
    if (currentMenu === null) {
        // Sin menú posible se DICE por qué. Un planificador que calla cuando no
        // puede es peor que uno que no planifica.
        return html`
            <section class="card">
                <h2 class="card__title">${t('menu.title')}</h2>
                <p class="notice notice--warning">
                    <span class="notice__icon" aria-hidden="true">⚠</span>
                    <span>${t('menu.unavailable')}</span>
                </p>
            </section>
        `;
    }

    const off = currentMenu.bands.off ?? {};
    return html`
        <section class="card" aria-labelledby="menu-title">
            <div class="card__header">
                <h2 id="menu-title" class="card__title">${t('menu.title')}</h2>
                <button type="button" class="btn btn--sm" data-regenerate-menu>${t('menu.regenerate')}</button>
            </div>
            <p class="muted">${t('menu.explain')}</p>

            ${currentMenu.meals.map((/** @type {*} */ meal) => html`
                <div class="menu-meal">
                    <div class="card__header">
                        <h3 class="menu-meal__title">${t('nutrition.meal', { n: meal.index + 1 })}</h3>
                        <button type="button" class="btn btn--sm" data-regenerate-meal="${meal.index}">
                            ${t('menu.another')}
                        </button>
                    </div>
                    <ul class="profile-list">
                        ${meal.items.map((/** @type {*} */ item) => html`
                            <li class="profile-item">
                                <span>${item.name}</span>
                                <span class="muted numeric">${num(item.grams)} g · ${num(item.macros.kcal)} kcal</span>
                            </li>
                        `)}
                    </ul>
                    <p class="muted numeric">${t('menu.mealTotal', {
                        kcal: num(meal.totals.kcal), p: num(meal.totals.proteinG),
                        c: num(meal.totals.carbsG), f: num(meal.totals.fatG)
                    })}</p>
                </div>
            `)}

            <!--
                El total del dia frente al objetivo, y cuanto se desvia. Es la
                misma disciplina que la vista de Gasto: ensenar la cuenta, no un
                numero. (Sin acentos graves aqui: CIERRAN la plantilla.)
            -->
            <p class="muted numeric">${t('menu.dayTotal', {
                kcal: num(currentMenu.totals.kcal), p: num(currentMenu.totals.proteinG),
                c: num(currentMenu.totals.carbsG), f: num(currentMenu.totals.fatG)
            })}</p>
            <p class="muted">${t('menu.deviation', {
                kcal: Math.round((off.kcal ?? 0) * 100),
                protein: Math.round((off.proteinG ?? 0) * 100)
            })}</p>
        </section>
    `;
}

/** Plantillas de comida del usuario (CRUD). */
function renderTemplates(/** @type {*} */ templates) {
    return html`
        <section class="card" aria-labelledby="templates-title">
            <div class="card__header">
                <h2 id="templates-title" class="card__title">${t('nutrition.templatesTitle')}</h2>
                <button type="button" class="btn btn--sm" data-new-template>${t('nutrition.newTemplate')}</button>
            </div>
            ${templates.length === 0
                ? empty({ icon: '🍽', titleKey: 'nutrition.templatesEmpty', bodyKey: 'nutrition.templatesEmptyBody' })
                : html`
                    <ul class="profile-list">
                        ${templates.map((/** @type {*} */ tpl) => html`
                            <li class="profile-item">
                                <span>
                                    <strong>${tpl.name}</strong>
                                    <span class="muted numeric"> · ${num(tpl.macros.kcal)} kcal · ${num(tpl.macros.proteinG)} P · ${num(tpl.macros.carbsG)} C · ${num(tpl.macros.fatG)} G</span>
                                </span>
                                <button type="button" class="btn btn--sm btn--danger" data-delete-template="${tpl.id}">
                                    ${t('action.delete')}
                                </button>
                            </li>
                        `)}
                    </ul>
                `}
        </section>
    `;
}

/**
 * Macros de HOY, si hay plan. Es la entrada del solver, y sale del motor: el
 * menú las RELLENA, nunca las recalcula (B3).
 * @returns {{ kcal: number, proteinG: number, carbsG: number, fatG: number } | null}
 */
function todayMacros() {
    const data = plans.get();
    if (!data) return null;
    const today = plans.todayIndex(data, plans.todayISO());
    const base = macrosFor(data.projection.daily[today.dayIndex]);
    if (!base.ok) return null;
    const { kcal, proteinG, carbsG, fatG } = base.value;
    return { kcal, proteinG, carbsG, fatG };
}

/** Rehace el menú del día con la semilla actual. */
function rebuildMenu() {
    const macros = todayMacros();
    if (macros === null || catalog === null) { currentMenu = null; return; }
    const split = splitIntoMeals(/** @type {*} */ ({ ...macros, warnings: [] }), mealCount);
    if (!split.ok) { currentMenu = null; return; }
    const built = buildMenu({
        macros,
        mealTargets: split.value,
        foods: catalog,
        preferences: /** @type {*} */ (preferencesStore.get()),
        seed: menuSeed
    });
    currentMenu = built.ok ? built.value : null;
    if (!built.ok) console.warn('[menu] sin solución:', built.error, built.detail ?? {});
}

/** @param {HTMLElement} container */
function draw(container) {
    const data = plans.get();
    if (!data) {
        // Sin plan no es un ERROR, es un estado vacío. Con `errorState` esto
        // pintaba un `role="alert"` SIN ninguna salida, que es exactamente lo
        // que la cabecera de `state.js` declara prohibido (ficha H-013).
        render(container, empty({ icon: '🍽', titleKey: 'nutrition.title', bodyKey: 'nutrition.noPlan', actions: [] }));
        return;
    }
    const today = plans.todayIndex(data, plans.todayISO());
    const point = data.projection.daily[today.dayIndex];
    const base = macrosFor(point);
    if (!base.ok) {
        render(container, errorState({ titleKey: 'nutrition.title', bodyKey: 'error.viewBody' }));
        return;
    }
    const macros = refeedToday
        ? (refeedMacros(base.value, point).ok ? /** @type {*} */ (refeedMacros(base.value, point)).value : base.value)
        : base.value;

    render(container, html`
        <h1 class="card__title">${t('nutrition.title')}</h1>
        ${renderMacros(macros, point)}
        ${renderMeals(macros)}
        ${renderMenu()}
        ${renderTemplates(nutritionStore.listTemplates())}
    `);
}

/** @param {HTMLElement} container */
export async function mount(container) {
    mealCount = preferencesStore.get().mealsPerDay ?? 4;
    draw(container);

    // El catálogo se carga DESPUÉS del primer pintado: las macros del día no
    // dependen de él, y esperar 2 000 alimentos para enseñar cuatro cifras que
    // ya están calculadas sería castigar al usuario por una función que quizá ni
    // mire.
    if (catalog === null) {
        const loaded = await foodsDb.load();
        if (loaded.ok) {
            catalog = loaded.value;
            const bundle = plans.get();
            // Semilla del perfil + el día: mismo perfil y mismo día, mismo menú;
            // días distintos, menús distintos. Sin el día, comerías lo mismo
            // toda la definición.
            const dayIndex = bundle ? plans.todayIndex(bundle, plans.todayISO()).dayIndex : 0;
            const active = profiles.getActive();
            menuSeed = seedFrom(active.ok ? active.value : 'p1',
                bundle?.startDateISO ?? '1970-01-01') + dayIndex;
            rebuildMenu();
        } else {
            console.warn('[menu] no se pudo cargar la base de alimentos:', loaded.error);
        }
        draw(container);
    }

    on(container, 'change', '[data-refeed]', (_event, target) => {
        refeedToday = /** @type {HTMLInputElement} */ (target).checked;
        draw(container);
    });

    on(container, 'input', '[data-meal-count]', (_event, target) => {
        mealCount = Number(/** @type {HTMLInputElement} */ (target).value);
        // Se persiste para que Compra construya el mismo menú. Si falla, la
        // vista sigue funcionando con el número en memoria: no vale la pena
        // molestar al usuario por una preferencia.
        preferencesStore.save({ mealsPerDay: mealCount });
        // Cambiar el número de comidas cambia los objetivos por comida, así que
        // el menú anterior deja de corresponder a nada.
        rebuildMenu();
        draw(container);
    });

    on(container, 'click', '[data-regenerate-menu]', () => {
        // Otra semilla, mismo objetivo. El menú no se persiste, así que
        // «regenerar» es literalmente volver a resolver.
        menuSeed += 1;
        rebuildMenu();
        draw(container);
    });

    on(container, 'click', '[data-regenerate-meal]', (_event, target) => {
        const index = Number(target.getAttribute('data-regenerate-meal'));
        if (currentMenu === null || catalog === null || !Number.isInteger(index)) return;
        const cambiado = regenerateMeal(currentMenu, index, {
            foods: catalog,
            preferences: /** @type {*} */ (preferencesStore.get()),
            seed: menuSeed
        });
        if (!cambiado.ok) {
            // No hay alternativa que mantenga el DÍA dentro de banda. Se dice,
            // en vez de servir algo que rompe el plan sin avisar.
            toast.error('menu.noAlternative');
            return;
        }
        currentMenu = cambiado.value;
        draw(container);
    });

    on(container, 'click', '[data-new-template]', () => {
        const data = plans.get();
        if (!data) return;
        const today = plans.todayIndex(data, plans.todayISO());
        const base = macrosFor(data.projection.daily[today.dayIndex]);
        if (!base.ok) return;
        const suggested = splitIntoMeals(base.value, mealCount);
        const meal = suggested.ok ? suggested.value[0] : { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };

        const dialog = modal.open({
            titleKey: 'nutrition.newTemplate',
            body: html`
                <label class="field">
                    <span class="field__label">${t('nutrition.templateName')}</span>
                    <input type="text" class="input" data-name autocomplete="off">
                </label>
                <div class="field-grid">
                    ${[['kcal', 'nutrition.kcal', meal.kcal], ['proteinG', 'nutrition.protein', meal.proteinG],
                       ['carbsG', 'nutrition.carbs', meal.carbsG], ['fatG', 'nutrition.fat', meal.fatG]].map(([key, label, value]) => html`
                        <label class="field">
                            <span class="field__label">${t(String(label))}</span>
                            <input type="number" class="input" inputmode="numeric" data-macro="${key}" value="${value}">
                        </label>
                    `)}
                </div>
                <div class="modal__actions">
                    <button type="button" class="btn" data-modal-close>${t('action.cancel')}</button>
                    <button type="button" class="btn btn--primary" data-go>${t('action.save')}</button>
                </div>
            `
        });

        dialog.querySelector('[data-go]')?.addEventListener('click', () => {
            const name = sanitizeText(/** @type {HTMLInputElement | null} */ (dialog.querySelector('[data-name]'))?.value, 80);
            if (name === '') {
                toast.error('nutrition.templateNameRequired');
                return;
            }
            /** @type {Record<string, number>} */ const macros = {};
            for (const input of dialog.querySelectorAll('[data-macro]')) {
                const key = input.getAttribute('data-macro');
                const value = Number(/** @type {HTMLInputElement} */ (input).value);
                if (key) macros[key] = Number.isFinite(value) ? Math.max(0, value) : 0;
            }
            const saved = nutritionStore.addTemplate({
                name,
                macros: /** @type {*} */ ({
                    kcal: macros.kcal, proteinG: macros.proteinG,
                    carbsG: macros.carbsG, fatG: macros.fatG
                })
            });
            if (!saved.ok) {
                toast.error('error.generic');
                return;
            }
            modal.close();
            toast.success('nutrition.templateSaved');
            draw(container);
        });
    });

    on(container, 'click', '[data-delete-template]', (_event, target) => {
        const id = target.getAttribute('data-delete-template');
        if (!id) return;
        if (!nutritionStore.removeTemplate(id).ok) {
            toast.error('error.generic');
            return;
        }
        toast.success('nutrition.templateDeleted');
        draw(container);
    });
}

// @ts-check

/**
 * Vista «Compra»: del menú de la semana a la lista, sin fricción (V2-M4).
 *
 * CIERRA EL BUCLE menú → compra → despensa. Marcar una línea como comprada la
 * mete en la despensa con su `foodId`, y la siguiente lista ya la descuenta. Sin
 * ese identificador la vuelta solo casaría si el usuario escribió el nombre
 * exacto, que es justo lo que no hace nadie.
 *
 * LA LISTA NO SE PERSISTE. Sale del menú, que es determinista y tampoco se
 * guarda. Persistir una lista crearía una copia que envejece: cambias las
 * calorías, el menú cambia, y la lista guardada seguiría diciendo lo de ayer.
 * Lo que sí se persiste es la consecuencia —lo que has comprado, en la despensa.
 */

import { html, render, on } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import * as plans from '../plan-state.js';
import * as foodsDb from '../../data/foods-db.js';
import * as recipesRepo from '../../data/recipes.js';
import * as preferencesStore from '../../data/preferences.js';
import * as profiles from '../../data/profiles.js';
import * as toast from '../components/toast.js';
import { empty, error as errorState } from '../components/state.js';
import { listDate } from '../dates.js';
import { int } from '../format.js';
import { macrosFor, splitIntoMeals } from '../../core/nutrition.js';
import { buildMenu } from '../../core/menu.js';
import { buildShoppingList, sortLines, toPlainText } from '../../core/shopping.js';
import { seedFrom } from '../../core/rng.js';

/** Días de menú que cubre la lista. Una semana es la unidad real de compra. */
const DEFAULT_DAYS = 7;

/** @type {import('../../core/foods.js').Food[] | null} */
let catalog = null;

/** @type {* | null} */
let list = null;

/** @type {'aisle'|'expiry'|'owned'|'name'} */
let sortBy = 'aisle';

let days = DEFAULT_DAYS;

/** Construye la lista desde el plan, el menú de cada día y la despensa. */
function rebuild() {
    const bundle = plans.get();
    if (bundle === null || catalog === null) { list = null; return; }

    const today = plans.todayIndex(bundle, plans.todayISO());
    const active = profiles.getActive();
    const baseSeed = seedFrom(active.ok ? active.value : 'p1', bundle.startDateISO);
    const preferences = /** @type {*} */ (preferencesStore.get());
    const byId = Object.fromEntries(catalog.map((food) => [food.id, food]));

    /** @type {*[]} */ const menus = [];
    for (let offset = 0; offset < days; offset++) {
        // Las macros de CADA día, no las de hoy repetidas: en una definición
        // largan las calorías bajan con el peso, y una lista hecha sobre el día
        // de hoy compraría de más para el final de la semana.
        const point = bundle.projection.daily[today.dayIndex + offset];
        if (!point) break;
        const macros = macrosFor(point);
        if (!macros.ok) continue;
        const objetivo = {
            kcal: macros.value.kcal, proteinG: macros.value.proteinG,
            carbsG: macros.value.carbsG, fatG: macros.value.fatG
        };
        const split = splitIntoMeals(macros.value, preferences.mealsPerDay ?? 4);
        if (!split.ok) continue;
        // Misma semilla que usa Nutrición para ese día: la lista tiene que
        // corresponder al menú que el usuario ve, no a otro equivalente.
        const built = buildMenu({
            macros: objetivo,
            mealTargets: split.value,
            foods: catalog,
            preferences,
            seed: baseSeed + today.dayIndex + offset
        });
        if (built.ok) menus.push(built.value);
    }

    list = menus.length === 0
        ? null
        : buildShoppingList({ days: menus, pantry: recipesRepo.listPantry(), foods: byId });
    if (list) list.dayCount = menus.length;
}

/** Una línea de la lista. */
function renderLine(/** @type {*} */ line) {
    const cubierta = line.toBuyG === 0;
    return html`
        <li class="profile-item ${cubierta ? 'shopping-line--covered' : ''}">
            <span class="food-row">
                <span class="food-row__name">${line.name}</span>
                <span class="muted">${cubierta
                    ? t('shopping.covered', { grams: int(line.pantryUsedG) })
                    : t('shopping.buy', { grams: int(line.buyRoundedG) })}</span>
                ${line.pantryUsedG > 0 && !cubierta
                    ? html`<span class="muted">${t('shopping.partial', { grams: int(line.pantryUsedG) })}</span>`
                    : ''}
                ${line.expiresISO
                    ? html`<span class="muted">${t('shopping.expires', { date: listDate(line.expiresISO) })}</span>`
                    : ''}
            </span>
            ${cubierta
                ? ''
                : html`<button type="button" class="btn btn--sm" data-bought="${line.foodId}">
                    ${t('shopping.markBought')}
                </button>`}
        </li>
    `;
}

/** @type {(() => void) | null} */
let onCreatePlan = null;

/** @param {HTMLElement} container */
function draw(container) {
    if (plans.get() === null) {
        render(container, empty({
            icon: '🛒',
            titleKey: 'shopping.title',
            bodyKey: 'shopping.noPlan',
            actions: [{ labelKey: 'today.createPlan', action: 'go-onboarding', primary: true }]
        }));
        return;
    }
    if (catalog === null) {
        render(container, html`
            <h1 class="visually-hidden">${t('shopping.title')}</h1>
            <p class="muted" role="status">${t('foods.loading')}</p>
        `);
        return;
    }
    if (list === null) {
        render(container, empty({
            icon: '🛒', titleKey: 'shopping.title', bodyKey: 'shopping.unavailable', actions: []
        }));
        return;
    }

    try {
        // Agrupar o no agrupar: por pasillo la lista se recorre una vez; con
        // cualquier otro criterio el agrupamiento estorba, así que va plana.
        const cuerpo = sortBy === 'aisle'
            ? list.groups.map((/** @type {*} */ group) => html`
                <div class="shopping-group">
                    <h3 class="shopping-group__title">${t(`aisle.${group.aisle}`)}</h3>
                    <ul class="profile-list">${group.lines.map(renderLine)}</ul>
                </div>
            `)
            : html`<ul class="profile-list">${sortLines(list.lines, sortBy).map(renderLine)}</ul>`;

        render(container, html`
            <h1 class="visually-hidden">${t('shopping.title')}</h1>
            <section class="card" aria-labelledby="shopping-title">
                <div class="card__header">
                    <h2 id="shopping-title" class="card__title">${t('shopping.title')}</h2>
                    <button type="button" class="btn btn--sm" data-copy-list>${t('shopping.copy')}</button>
                </div>
                <p class="muted">${t('shopping.explain', { days: int(list.dayCount) })}</p>

                <label class="field">
                    <span class="field__label">${t('shopping.sortBy')}</span>
                    <select class="select" data-sort>
                        ${['aisle', 'name', 'owned', 'expiry'].map((value) => html`
                            <option value="${value}" ${value === sortBy ? 'selected' : ''}>
                                ${t(`shopping.sort.${value}`)}
                            </option>
                        `)}
                    </select>
                </label>

                ${list.lines.length === 0
                    ? html`<p class="muted">${t('shopping.empty')}</p>`
                    : cuerpo}

                <p class="muted numeric">${t('shopping.totals', {
                    lines: int(list.totals.lines),
                    buy: int(list.totals.toBuyG),
                    pantry: int(list.totals.pantryUsedG)
                })}</p>

                ${list.unmatchedPantry.length > 0
                    // Lo que no se pudo restar se DICE. Restar «3 unidades» de
                    // 250 g exigiría saber lo que pesa una unidad, y ese dato no
                    // lo tenemos: a ojo saldría una compra corta.
                    ? html`
                        <p class="notice">
                            <span class="notice__icon" aria-hidden="true">◌</span>
                            <span>${t('shopping.unmatched', {
                                names: list.unmatchedPantry.map((/** @type {*} */ i) => i.name).join(', ')
                            })}</span>
                        </p>
                    `
                    : ''}
            </section>
        `);
    } catch (err) {
        console.error('[shopping] no se pudo construir la vista', err);
        // Salida clara y NO destructiva (ficha H-013).
        render(container, errorState({ titleKey: 'error.viewTitle', bodyKey: 'error.viewBody' }));
    }
}

/** @param {HTMLElement} container */
export async function mount(container) {
    draw(container);

    // ANTES del trabajo asíncrono, y a propósito. El botón principal del estado
    // sin plan estaba declarado y sin oyente —un callejón sin salida, que es lo
    // que prohíbe la ficha H-013—, y registrarlo abajo con los demás no bastaba:
    // si `foodsDb.load()` falla, `mount` sale antes de llegar allí y el estado
    // vacío se quedaría otra vez sin salida, justo en el caso de fallo.
    on(container, 'click', '[data-action="go-onboarding"]', () => {
        if (onCreatePlan) onCreatePlan();
    });

    if (catalog === null) {
        const loaded = await foodsDb.load();
        if (!loaded.ok) {
            console.error('[shopping] no se pudo cargar la base', loaded.error);
            render(container, errorState({
                titleKey: 'foods.loadErrorTitle', bodyKey: 'foods.loadErrorBody', actions: []
            }));
            return;
        }
        catalog = loaded.value;
    }
    rebuild();
    draw(container);

    on(container, 'change', '[data-sort]', (_event, target) => {
        const value = /** @type {HTMLSelectElement} */ (target).value;
        if (value === 'aisle' || value === 'name' || value === 'owned' || value === 'expiry') {
            sortBy = value;
            // Solo se repinta: reordenar NUNCA reconstruye la lista, para que un
            // criterio de ordenación no pueda tocar las cantidades.
            draw(container);
        }
    });

    on(container, 'click', '[data-bought]', (_event, target) => {
        const foodId = target.getAttribute('data-bought');
        const line = list?.lines.find((/** @type {*} */ l) => l.foodId === foodId);
        if (!line) return;
        // Con `foodId`, no solo con el nombre: es lo que hace que la próxima
        // lista lo descuente sin depender de cómo se escriba.
        const added = recipesRepo.addPantryItem({
            name: line.name, quantity: line.buyRoundedG, unit: 'g', foodId: line.foodId
        });
        if (!added.ok) {
            toast.error('error.generic');
            return;
        }
        toast.success('shopping.addedToPantry');
        rebuild();
        draw(container);
    });

    on(container, 'click', '[data-copy-list]', async () => {
        if (list === null) return;
        const texto = toPlainText(list, {
            title: t('shopping.title'),
            aisleLabel: (aisle) => t(`aisle.${aisle}`)
        });
        try {
            await navigator.clipboard.writeText(texto);
            toast.success('shopping.copied');
        } catch {
            // Sin portapapeles —permiso denegado, contexto no seguro— no se
            // pierde el trabajo: se enseña el texto para copiarlo a mano.
            toast.error('shopping.copyFailed');
            console.info('[shopping] lista:\n%s', texto);
        }
    });
}

export function unmount() {
    // El catálogo se conserva entre visitas (son datos de referencia); la lista
    // no, porque depende del plan y de la despensa, y ambos pueden haber
    // cambiado mientras el usuario estaba en otra pantalla.
    list = null;
}

/**
 * Qué hacer cuando el usuario, sin plan, pide crearlo. Lo cablea `main.js`.
 * @param {() => void} fn
 */
export function setOnCreatePlan(fn) {
    onCreatePlan = fn;
}

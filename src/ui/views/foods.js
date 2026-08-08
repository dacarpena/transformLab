// @ts-check

/**
 * Vista «Alimentos»: buscador, recetas y despensa (V2-M2).
 *
 * SU REGLA DE DISEÑO ES LA PROCEDENCIA VISIBLE. Cada alimento enseña de dónde
 * sale su cifra —genérico verificado, marca subida por la comunidad, o tuyo—
 * porque las tres cosas tienen garantías muy distintas y la v4.0 se hundió
 * presentando estimaciones como certezas. Y cuando la búsqueda no encuentra
 * nada, la vista dice QUÉ cubre la base en vez de fingir exhaustividad: el
 * fresco de marca y los precios no están, y eso se cuenta.
 *
 * LOS MACROS DE UNA RECETA SE DERIVAN, NO SE GUARDAN. Y los ingredientes que no
 * se pudieron contar —sin alimento enlazado, o en una unidad que no sabemos
 * convertir— se declaran uno a uno. Un total que ignora en silencio la mitad de
 * los ingredientes es un total falso, y encima invita a planificar sobre él.
 */

import { html, render, on } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import * as foodsDb from '../../data/foods-db.js';
import * as recipesRepo from '../../data/recipes.js';
import * as toast from '../components/toast.js';
import { empty, error as errorState } from '../components/state.js';
import { int, num } from '../format.js';
import { search, coverage, recipeMacros } from '../../core/foods.js';

/** Alimentos cargados, o `null` mientras no lo estén. */
/** @type {import('../../core/foods.js').Food[] | null} */
let catalog = null;

/** Índice por id, para no rehacerlo en cada receta pintada. */
/** @type {Record<string, import('../../core/foods.js').Food>} */
let byId = {};

/** Ingredientes que el usuario va montando antes de guardar la receta. */
/** @type {import('../../core/foods.js').Ingredient[]} */
let draftIngredients = [];

/** Última consulta escrita, para poder repintar sin perderla. */
let query = '';

/** Rótulo de procedencia. Es la pieza que hace honesta a toda la vista. */
function sourceBadge(/** @type {string} */ src) {
    const key = src === 'usda' ? 'foods.src.generic'
        : src === 'off' ? 'foods.src.brand'
        : 'foods.src.user';
    return html`<span class="badge badge--${src}">${t(key)}</span>`;
}

/** Una fila de resultado de búsqueda. */
function foodRow(/** @type {import('../../core/foods.js').Food} */ food) {
    return html`
        <li class="profile-item">
            <span class="food-row">
                <span class="food-row__name">${food.n}${food.b ? ` · ${food.b}` : ''}</span>
                <span class="muted">${t('foods.per100', {
                    kcal: int(food.k), p: num(food.p), c: num(food.c), f: num(food.f)
                })}</span>
                ${sourceBadge(food.src)}
            </span>
            <button type="button" class="btn btn--sm" data-add-ingredient="${food.id}">
                ${t('foods.addToRecipe')}
            </button>
        </li>
    `;
}

/**
 * Buscador. Los resultados van en su propio contenedor para poder repintarlos
 * sin volver a crear el `<input>`: recrearlo en cada tecla pierde el foco y el
 * cursor, y escribir se vuelve imposible.
 */
function renderSearch() {
    const cover = coverage(catalog ?? []);
    return html`
        <section class="card" aria-labelledby="foods-title">
            <div class="card__header">
                <h2 id="foods-title" class="card__title">${t('foods.title')}</h2>
            </div>
            <label class="field">
                <span class="field__label">${t('foods.searchLabel')}</span>
                <input class="input" type="search" data-food-search
                       placeholder="${t('foods.searchPlaceholder')}" value="${query}">
            </label>
            <div data-food-results></div>
            <!--
                La cobertura, DICHA. Es el invariante cobertura_declarada: la
                interfaz sabe cuantos alimentos cubre y de que tipo, y no finge
                que estan todos. (Sin acentos graves aqui dentro: CIERRAN la
                plantilla.)
            -->
            <p class="muted">${t('foods.coverage', {
                generic: int(cover.bySource.usda ?? 0),
                brand: int(cover.bySource.off ?? 0)
            })}</p>
            <p class="muted">${t('foods.coverageGaps')}</p>
        </section>
    `;
}

/** Resultados de la consulta actual, o el porqué de que no haya. */
function renderResults() {
    if (query.trim() === '') return html`<p class="muted">${t('foods.searchHint')}</p>`;
    const hits = search(catalog ?? [], query, { limit: 25 });
    if (hits.length === 0) {
        return html`
            <p class="notice">
                <span class="notice__icon" aria-hidden="true">◌</span>
                <span>${t('foods.noResults', { query })}</span>
            </p>
        `;
    }
    return html`<ul class="profile-list">${hits.map(foodRow)}</ul>`;
}

/** La receta que se está montando. */
function renderDraft() {
    const macros = recipeMacros({ servings: 1, ingredients: draftIngredients }, byId);
    return html`
        <section class="card" aria-labelledby="recipe-new-title">
            <div class="card__header">
                <h2 id="recipe-new-title" class="card__title">${t('recipes.newTitle')}</h2>
            </div>
            <label class="field">
                <span class="field__label">${t('recipes.name')}</span>
                <input class="input" type="text" maxlength="120" data-field="recipeName">
            </label>
            <label class="field">
                <span class="field__label">${t('recipes.servings')}</span>
                <input class="input" type="number" inputmode="numeric" min="1" max="50"
                       data-field="recipeServings" value="1">
            </label>

            ${draftIngredients.length === 0
                ? html`<p class="muted">${t('recipes.draftEmpty')}</p>`
                : html`
                    <ul class="profile-list">
                        ${draftIngredients.map((ing, index) => html`
                            <li class="profile-item">
                                <span>${ing.name}</span>
                                <span class="ingredient-controls">
                                    <label class="visually-hidden" for="ing-${index}">
                                        ${t('recipes.grams', { name: ing.name })}
                                    </label>
                                    <input class="input input--inline" id="ing-${index}" type="number"
                                           inputmode="numeric" min="0" max="5000"
                                           data-ingredient-grams="${index}" value="${String(ing.quantity)}">
                                    <span class="muted">${t('recipes.gramsUnit')}</span>
                                    <button type="button" class="btn btn--sm" data-remove-ingredient="${index}">
                                        ${t('action.delete')}
                                    </button>
                                </span>
                            </li>
                        `)}
                    </ul>
                    <p class="muted">${t('recipes.draftTotal', {
                        kcal: int(macros.total.kcal), p: num(macros.total.proteinG),
                        c: num(macros.total.carbsG), f: num(macros.total.fatG)
                    })}</p>
                `}

            <div class="btn-row">
                <button type="button" class="btn btn--primary" data-save-recipe>${t('action.save')}</button>
            </div>
        </section>
    `;
}

/** Recetas guardadas, con sus macros derivadas cada vez. */
function renderRecipes() {
    const saved = recipesRepo.listRecipes();
    if (saved.length === 0) {
        return empty({
            icon: '◈',
            titleKey: 'recipes.emptyTitle',
            bodyKey: 'recipes.emptyBody',
            actions: []
        });
    }
    return html`
        <section class="card" aria-labelledby="recipes-title">
            <div class="card__header">
                <h2 id="recipes-title" class="card__title">${t('recipes.title')}</h2>
            </div>
            <ul class="profile-list">
                ${saved.map((/** @type {*} */ recipe) => {
                    const m = recipeMacros(recipe, byId);
                    return html`
                        <li class="profile-item profile-item--stacked">
                            <span class="food-row">
                                <span class="food-row__name">${recipe.name}</span>
                                <span class="muted">${t('recipes.perServing', {
                                    kcal: int(m.perServing.kcal), p: num(m.perServing.proteinG),
                                    c: num(m.perServing.carbsG), f: num(m.perServing.fatG),
                                    servings: int(recipe.servings)
                                })}</span>
                                ${m.unknown.length > 0
                                    // Lo que no se pudo contar se DICE, en vez
                                    // de sumarse como cero.
                                    ? html`<span class="muted">${t('recipes.uncounted', {
                                        n: m.unknown.length, names: m.unknown.join(', ')
                                    })}</span>`
                                    : ''}
                            </span>
                            <button type="button" class="btn btn--sm" data-delete-recipe="${recipe.id}">
                                ${t('action.delete')}
                            </button>
                        </li>
                    `;
                })}
            </ul>
        </section>
    `;
}

/** Despensa: lo que ya hay en casa. */
function renderPantry() {
    const items = recipesRepo.listPantry();
    return html`
        <section class="card" aria-labelledby="pantry-title">
            <div class="card__header">
                <h2 id="pantry-title" class="card__title">${t('pantry.title')}</h2>
            </div>
            <p class="muted">${t('pantry.explain')}</p>
            <label class="field">
                <span class="field__label">${t('pantry.name')}</span>
                <input class="input" type="text" maxlength="120" data-field="pantryName">
            </label>
            <label class="field">
                <span class="field__label">${t('pantry.quantity')}</span>
                <input class="input" type="number" inputmode="numeric" min="0" max="100000"
                       data-field="pantryQuantity">
            </label>
            <div class="btn-row">
                <button type="button" class="btn" data-add-pantry>${t('pantry.add')}</button>
            </div>
            ${items.length > 0
                ? html`
                    <ul class="profile-list">
                        ${items.map((/** @type {*} */ item) => html`
                            <li class="profile-item">
                                <span>${t('pantry.entry', {
                                    name: item.name, quantity: num(item.quantity), unit: item.unit
                                })}</span>
                                <button type="button" class="btn btn--sm" data-delete-pantry="${item.id}">
                                    ${t('action.delete')}
                                </button>
                            </li>
                        `)}
                    </ul>
                `
                : ''}
        </section>
    `;
}

/** @param {HTMLElement} container */
function draw(container) {
    if (catalog === null) {
        render(container, html`
            <h1 class="visually-hidden">${t('foods.title')}</h1>
            <p class="muted" role="status">${t('foods.loading')}</p>
        `);
        return;
    }
    try {
        // El contenedor `.view[data-view-id]` lo crea el ROUTER; la vista solo
        // pone su contenido.
        render(container, html`
            <h1 class="visually-hidden">${t('foods.title')}</h1>
            ${renderSearch()}
            ${renderDraft()}
            ${renderRecipes()}
            ${renderPantry()}
        `);
        drawResults(container);
    } catch (err) {
        console.error('[foods] no se pudo construir la vista', err);
        // Salida clara y NO destructiva (ficha H-013).
        render(container, errorState({ titleKey: 'error.viewTitle', bodyKey: 'error.viewBody' }));
    }
}

/** Repinta SOLO los resultados, para no tocar el `<input>` que tiene el foco. */
function drawResults(/** @type {HTMLElement} */ container) {
    const slot = /** @type {HTMLElement | null} */ (container.querySelector('[data-food-results]'));
    if (slot) render(slot, renderResults());
}

/** @param {HTMLElement} container */
export async function mount(container) {
    draw(container);

    const loaded = await foodsDb.load();
    if (!loaded.ok) {
        console.error('[foods] no se pudo cargar la base', loaded.error);
        // No es motivo para ofrecer borrar nada (H-013): se dice qué pasó y se
        // deja un botón para reintentar.
        render(container, errorState({
            titleKey: 'foods.loadErrorTitle',
            bodyKey: 'foods.loadErrorBody',
            actions: [{ labelKey: 'foods.retry', action: 'retry-foods', primary: true }]
        }));
        on(container, 'click', '[data-action="retry-foods"]', () => { void mount(container); });
        return;
    }
    catalog = loaded.value;
    byId = Object.fromEntries(catalog.map((food) => [food.id, food]));
    draw(container);

    on(container, 'input', '[data-food-search]', (_event, target) => {
        query = /** @type {HTMLInputElement} */ (target).value;
        drawResults(container);
    });

    on(container, 'click', '[data-add-ingredient]', (_event, target) => {
        const id = target.getAttribute('data-add-ingredient');
        const food = id ? byId[id] : undefined;
        if (!food) return;
        // 100 g por defecto: es la unidad en la que vienen los macros, así que
        // el usuario ve la cifra de la etiqueta y la ajusta desde ahí.
        draftIngredients = [...draftIngredients, {
            name: food.n, quantity: 100, unit: 'g', foodId: food.id
        }];
        draw(container);
    });

    on(container, 'input', '[data-ingredient-grams]', (_event, target) => {
        const index = Number(target.getAttribute('data-ingredient-grams'));
        const grams = Number(/** @type {HTMLInputElement} */ (target).value);
        if (!Number.isInteger(index) || !draftIngredients[index]) return;
        draftIngredients[index].quantity = Number.isFinite(grams) && grams >= 0 ? grams : 0;
        // Sin repintar: el `<input>` que se está escribiendo tiene el foco. El
        // total se recalcula al guardar o al añadir el siguiente ingrediente.
    });

    on(container, 'click', '[data-remove-ingredient]', (_event, target) => {
        const index = Number(target.getAttribute('data-remove-ingredient'));
        draftIngredients = draftIngredients.filter((_, i) => i !== index);
        draw(container);
    });

    on(container, 'click', '[data-save-recipe]', () => {
        const nameInput = /** @type {HTMLInputElement | null} */ (container.querySelector('[data-field="recipeName"]'));
        const servingsInput = /** @type {HTMLInputElement | null} */ (container.querySelector('[data-field="recipeServings"]'));
        const saved = recipesRepo.addRecipe({
            name: nameInput?.value ?? '',
            servings: Number(servingsInput?.value ?? 1),
            ingredients: draftIngredients
        });
        if (!saved.ok) {
            toast.error(saved.error === 'recipes.nameRequired' ? 'recipes.nameRequired' : 'recipes.ingredientsRequired');
            return;
        }
        draftIngredients = [];
        toast.success('recipes.saved');
        draw(container);
    });

    on(container, 'click', '[data-delete-recipe]', (_event, target) => {
        const id = target.getAttribute('data-delete-recipe');
        if (!id || !recipesRepo.removeRecipe(id).ok) return;
        draw(container);
    });

    on(container, 'click', '[data-add-pantry]', () => {
        const nameInput = /** @type {HTMLInputElement | null} */ (container.querySelector('[data-field="pantryName"]'));
        const qtyInput = /** @type {HTMLInputElement | null} */ (container.querySelector('[data-field="pantryQuantity"]'));
        const added = recipesRepo.addPantryItem({
            name: nameInput?.value ?? '',
            quantity: Number(qtyInput?.value),
            unit: 'g'
        });
        if (!added.ok) {
            toast.error('pantry.invalid');
            return;
        }
        draw(container);
    });

    on(container, 'click', '[data-delete-pantry]', (_event, target) => {
        const id = target.getAttribute('data-delete-pantry');
        if (!id || !recipesRepo.removePantryItem(id).ok) return;
        draw(container);
    });
}

export function unmount() {
    // El catálogo se conserva a propósito entre visitas: son 2 000 registros de
    // referencia que no cambian, y soltarlos obligaría a releer IndexedDB cada
    // vez que se entra. El borrador de receta SÍ se suelta: dejarlo vivo haría
    // que al volver aparecieran ingredientes que uno no recuerda haber puesto.
    draftIngredients = [];
    query = '';
}

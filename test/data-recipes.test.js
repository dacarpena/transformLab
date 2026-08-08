// @ts-check

/**
 * Recetas y despensa (V2-M2).
 *
 * Mismo molde que `data-nutrition.test.js`: la persistencia vive en
 * `src/data/recipes.js` y no dentro de la vista, precisamente para que exista
 * algo importable desde Node que probar.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import * as recipes from '../src/data/recipes.js';
import { recipeMacros } from '../src/core/foods.js';

beforeEach(() => {
    installLocalStorageMock();
    storage.setActiveProfile('p1');
});

const ARROZ_CON_POLLO = {
    name: 'Arroz con pollo',
    servings: 2,
    ingredients: [
        { name: 'Arroz', quantity: 150, unit: 'g', foodId: 'usda:arroz_blanco_crudo' },
        { name: 'Pechuga de pollo', quantity: 300, unit: 'g', foodId: 'usda:pechuga_de_pollo_cruda' }
    ]
};

test('sin nada guardado las listas están vacías', () => {
    assert.deepEqual(recipes.listRecipes(), []);
    assert.deepEqual(recipes.listPantry(), []);
});

test('guardar y releer una receta conserva sus ingredientes y su enlace', () => {
    const saved = recipes.addRecipe(ARROZ_CON_POLLO);
    assert.ok(saved.ok, JSON.stringify(!saved.ok && saved.error));

    const [r] = recipes.listRecipes();
    assert.equal(r.name, 'Arroz con pollo');
    assert.equal(r.servings, 2);
    assert.equal(r.ingredients.length, 2);
    assert.equal(r.ingredients[0].foodId, 'usda:arroz_blanco_crudo');
});

test('una receta sin nombre o sin ingredientes se rechaza con su motivo', () => {
    assert.equal(recipes.addRecipe({ name: '  ', ingredients: [{ name: 'X', quantity: 1, unit: 'g' }] }).ok, false);
    assert.equal(recipes.addRecipe({ name: 'Vacía', ingredients: [] }).ok, false);
    const r = recipes.addRecipe({ name: 'Vacía', ingredients: [] });
    assert.equal(r.ok === false && r.error, 'recipes.ingredientsRequired');
});

test('las recetas NO guardan macros: se derivan de los ingredientes', () => {
    recipes.addRecipe(ARROZ_CON_POLLO);
    const [r] = recipes.listRecipes();
    // Guardarlas congeladas es exactamente cómo la v4.0 acabó enseñando cifras
    // que ya no correspondían a los datos de los que salieron.
    assert.equal(r.macros, undefined);
    assert.equal(r.kcal, undefined);

    const index = {
        'usda:arroz_blanco_crudo': { id: 'usda:arroz_blanco_crudo', n: 'Arroz', k: 365, p: 7.1, c: 80, f: 0.7, src: 'usda' },
        'usda:pechuga_de_pollo_cruda': { id: 'usda:pechuga_de_pollo_cruda', n: 'Pollo', k: 120, p: 22.5, c: 0, f: 2.6, src: 'usda' }
    };
    const m = recipeMacros(r, /** @type {*} */ (index));
    assert.equal(m.total.kcal, Math.round((365 * 1.5 + 120 * 3) * 10) / 10);
    assert.equal(m.perServing.kcal, Math.round((m.total.kcal / 2) * 10) / 10);
    assert.deepEqual(m.unknown, []);
});

test('dos recetas con el mismo nombre no comparten id', () => {
    recipes.addRecipe(ARROZ_CON_POLLO);
    recipes.addRecipe(ARROZ_CON_POLLO);
    const [a, b] = recipes.listRecipes();
    // Derivar el id de `length + 1` reutiliza el índice tras un borrado, y dos
    // recetas con el mismo id hacen que borrar una borre las dos.
    assert.notEqual(a.id, b.id);
});

test('borrar una receta no toca la otra, y borrar lo inexistente falla', () => {
    recipes.addRecipe(ARROZ_CON_POLLO);
    recipes.addRecipe({ ...ARROZ_CON_POLLO, name: 'Otra' });
    const [a] = recipes.listRecipes();
    assert.ok(recipes.removeRecipe(a.id).ok);
    assert.equal(recipes.listRecipes().length, 1);
    assert.equal(recipes.listRecipes()[0].name, 'Otra');
    assert.equal(recipes.removeRecipe('noexiste').ok, false);
});

test('el texto hostil se guarda literal (escapar es del render) y sin controles', () => {
    // Mismo criterio que en fotos: el almacen guarda EXACTAMENTE lo que le
    // dieron, y quien escapa es `escapeHtml` en el render (F6). Sanear tambien
    // aqui daria falsa seguridad: la vista tiene que escapar igual, porque el
    // mismo texto puede llegar por otros caminos.
    const hostil = '<img src=x onerror=alert(1)>';
    recipes.addRecipe({
        name: hostil,
        ingredients: [{ name: 'Arroz\u0000 blanco\u0007', quantity: 10, unit: 'g' }]
    });
    const [r] = recipes.listRecipes();
    assert.equal(r.name, hostil, 'el nombre se guarda tal cual');
    // Los caracteres de control si se quitan: no son contenido, y `escapeHtml`
    // no los toca, asi que llegarian intactos al DOM.
    assert.equal(r.ingredients[0].name, 'Arroz blanco');
});

test('la despensa fusiona lo mismo en la misma unidad', () => {
    recipes.addPantryItem({ name: 'Arroz', quantity: 1000, unit: 'g' });
    recipes.addPantryItem({ name: 'arroz', quantity: 500, unit: 'g' });
    const items = recipes.listPantry();
    // Sin fusionar, comprar arroz dos semanas seguidas deja dos entradas y la
    // lista de la compra de V2-M4 descontaría solo una.
    assert.equal(items.length, 1);
    assert.equal(items[0].quantity, 1500);
});

test('la despensa NO fusiona unidades distintas', () => {
    recipes.addPantryItem({ name: 'Tomate', quantity: 200, unit: 'g' });
    recipes.addPantryItem({ name: 'Tomate', quantity: 3, unit: 'ud' });
    assert.equal(recipes.listPantry().length, 2);
});

test('cantidades imposibles en la despensa se rechazan', () => {
    assert.equal(recipes.addPantryItem({ name: 'X', quantity: Number.NaN }).ok, false);
    assert.equal(recipes.addPantryItem({ name: 'X', quantity: -5 }).ok, false);
    assert.equal(recipes.addPantryItem({ name: '', quantity: 5 }).ok, false);
});

test('cada perfil tiene sus recetas', () => {
    recipes.addRecipe(ARROZ_CON_POLLO);
    storage.setActiveProfile('p2');
    assert.deepEqual(recipes.listRecipes(), []);
    storage.setActiveProfile('p1');
    assert.equal(recipes.listRecipes().length, 1);
});

// @ts-check

/**
 * Invariante de la lista de la compra (V2-M4).
 *
 * `conservacion_de_la_compra` es hermano del `conservacion` del motor: **nada
 * aparece ni desaparece**. Para cada alimento, lo que pide el menú es
 * exactamente lo que cubre la despensa más lo que hay que comprar; y la lista
 * contiene los alimentos del menú, ni uno más ni uno menos.
 *
 * Se prueba con un menú generado por el solver real sobre la base real: una
 * lista que cuadra con dos ingredientes de juguete y se descuadra con cuarenta
 * no vale para nada, y esa diferencia solo se ve así.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    AISLE_ORDER, DEFAULT_AISLE, BUY_ROUNDING_G,
    indexPantry, consolidate, buildShoppingList, sortLines, toPlainText
} from '../src/core/shopping.js';
import { buildMenu } from '../src/core/menu.js';
import { splitIntoMeals } from '../src/core/nutrition.js';

const BASE = JSON.parse(readFileSync(new URL('../vendor/data/foods.json', import.meta.url), 'utf8'));
/** @type {import('../src/core/foods.js').Food[]} */
const FOODS = BASE.foods;
const BY_ID = Object.fromEntries(FOODS.map((f) => [f.id, f]));

const MACROS = { kcal: 2100, proteinG: 165, carbsG: 200, fatG: 58 };

/** Una semana de menús reales, uno por día, cada uno con su semilla. */
function semanaDeMenus(dias = 7) {
    const split = splitIntoMeals(/** @type {*} */ ({ ...MACROS, warnings: [] }), 4);
    assert.ok(split.ok);
    const out = [];
    for (let d = 0; d < dias; d++) {
        const r = buildMenu({ macros: MACROS, mealTargets: split.value, foods: FOODS, seed: 1000 + d });
        assert.ok(r.ok, r.ok === false ? r.error : '');
        out.push(r.value);
    }
    return out;
}

/** Gramos totales que pide un conjunto de días, contados a mano. */
function gramosDelMenu(days) {
    let total = 0;
    for (const day of days) for (const meal of day.meals) for (const item of meal.items) total += item.grams;
    return Math.round(total * 10) / 10;
}

// ============================================================
// conservacion_de_la_compra
// ============================================================

test('conservacion_de_la_compra · lo que pide el menú = despensa + compra, alimento a alimento', () => {
    const days = semanaDeMenus();
    const pantry = [
        { id: 'p1', name: 'Arroz blanco crudo', quantity: 300, unit: 'g', foodId: 'usda:arroz_blanco_crudo' },
        { id: 'p2', name: 'Aceite de oliva virgen extra', quantity: 500, unit: 'g', foodId: 'usda:aceite_de_oliva_virgen_extra' }
    ];
    const list = buildShoppingList({ days, pantry, foods: BY_ID });

    for (const line of list.lines) {
        assert.equal(round(line.pantryUsedG + line.toBuyG), line.neededG,
            `${line.name}: ${line.pantryUsedG} + ${line.toBuyG} ≠ ${line.neededG}`);
        assert.ok(line.toBuyG >= 0, `${line.name} pide comprar cantidad negativa`);
        assert.ok(line.pantryUsedG >= 0);
    }
    assert.equal(round(list.totals.pantryUsedG + list.totals.toBuyG), list.totals.neededG);
});

test('conservacion_de_la_compra · la lista tiene los alimentos del menú, ni uno más ni uno menos', () => {
    const days = semanaDeMenus();
    const list = buildShoppingList({ days, foods: BY_ID });

    const enMenu = new Set();
    for (const day of days) for (const meal of day.meals) for (const item of meal.items) enMenu.add(item.foodId);
    const enLista = new Set(list.lines.map((l) => l.foodId));

    assert.deepEqual([...enLista].sort(), [...enMenu].sort());
    // Sin duplicados: la lista es un alimento por línea.
    assert.equal(list.lines.length, enLista.size);
});

test('conservacion_de_la_compra · el total en gramos cuadra con el menú entero', () => {
    const days = semanaDeMenus();
    const list = buildShoppingList({ days, foods: BY_ID });
    assert.equal(list.totals.neededG, gramosDelMenu(days));
});

test('conservacion_de_la_compra · sin despensa se compra todo', () => {
    const days = semanaDeMenus(2);
    const list = buildShoppingList({ days, foods: BY_ID });
    assert.equal(list.totals.pantryUsedG, 0);
    assert.equal(list.totals.toBuyG, list.totals.neededG);
});

test('conservacion_de_la_compra · una despensa enorme no genera compra negativa', () => {
    const days = semanaDeMenus(1);
    const pantry = days[0].meals.flatMap((/** @type {*} */ meal, i) =>
        meal.items.map((/** @type {*} */ item, j) => ({
            id: `p${i}_${j}`, name: item.name, quantity: 99999, unit: 'g', foodId: item.foodId
        })));
    const list = buildShoppingList({ days, pantry, foods: BY_ID });
    assert.equal(list.totals.toBuyG, 0);
    for (const line of list.lines) assert.equal(line.pantryUsedG, line.neededG);
});

test('conservacion_de_la_compra · un bote de despensa no se gasta dos veces', () => {
    // Si dos líneas del menú casaran con la misma entrada de despensa, restarla
    // dos veces dejaría la compra corta justo en lo que más se nota.
    const days = [{ meals: [{ items: [
        { foodId: 'a', name: 'Arroz', grams: 200 },
        { foodId: 'b', name: 'Arroz', grams: 200 }   // mismo NOMBRE, otro alimento
    ] }] }];
    const pantry = [{ id: 'p1', name: 'Arroz', quantity: 200, unit: 'g' }];
    const list = buildShoppingList({ days, pantry, foods: {} });

    const usado = list.lines.reduce((acc, l) => acc + l.pantryUsedG, 0);
    assert.equal(usado, 200, 'la despensa cubrió más de lo que había');
    assert.equal(list.totals.toBuyG, 200);
});

// ============================================================
// Consolidación
// ============================================================

test('consolidate suma el mismo alimento entre comidas y entre días', () => {
    const days = [
        { meals: [{ items: [{ foodId: 'huevo', name: 'Huevo', grams: 120 }] },
                  { items: [{ foodId: 'huevo', name: 'Huevo', grams: 180 }] }] },
        { meals: [{ items: [{ foodId: 'huevo', name: 'Huevo', grams: 60 }] }] }
    ];
    const total = consolidate(days);
    assert.equal(total.size, 1);
    assert.equal(total.get('huevo')?.grams, 360);
});

test('consolidate agrupa por foodId, NO por nombre', () => {
    // Dos días pueden traer el mismo alimento con el nombre escrito distinto, y
    // sumarlos mal es la forma silenciosa de comprar el doble.
    const total = consolidate([{ meals: [{ items: [
        { foodId: 'x', name: 'Arroz blanco', grams: 100 },
        { foodId: 'x', name: 'arroz', grams: 100 },
        { foodId: 'y', name: 'Arroz', grams: 50 }
    ] }] }]);
    assert.equal(total.size, 2);
    assert.equal(total.get('x')?.grams, 200);
    assert.equal(total.get('y')?.grams, 50);
});

test('consolidate ignora líneas sin alimento en vez de crear una clave vacía', () => {
    const total = consolidate([{ meals: [{ items: [
        { foodId: '', name: 'Un chorrito', grams: 10 },
        { foodId: 'x', name: 'Arroz', grams: 100 }
    ] }] }]);
    assert.equal(total.size, 1);
});

// ============================================================
// Despensa
// ============================================================

test('la despensa casa primero por foodId y solo después por nombre', () => {
    const days = [{ meals: [{ items: [{ foodId: 'usda:arroz', name: 'Arroz blanco crudo', grams: 300 }] }] }];

    const porId = buildShoppingList({
        days,
        pantry: [{ id: 'p1', name: 'lo que sea', quantity: 100, unit: 'g', foodId: 'usda:arroz' }],
        foods: {}
    });
    assert.equal(porId.lines[0].pantryUsedG, 100);

    const porNombre = buildShoppingList({
        days,
        pantry: [{ id: 'p1', name: 'ARROZ  blanco crudo', quantity: 120, unit: 'g' }],
        foods: {}
    });
    assert.equal(porNombre.lines[0].pantryUsedG, 120);
});

test('una unidad que no casa se DECLARA, no se resta a ojo', () => {
    // Restar «2 unidades» de 250 g exigiría saber lo que pesa una unidad, y ese
    // dato no lo tenemos. A ojo produciría una compra corta y una cena a medias.
    const days = [{ meals: [{ items: [{ foodId: 'x', name: 'Tomate', grams: 250 }] }] }];
    const list = buildShoppingList({
        days,
        pantry: [{ id: 'p1', name: 'Tomate', quantity: 3, unit: 'ud' }],
        foods: {}
    });
    assert.equal(list.lines[0].pantryUsedG, 0);
    assert.equal(list.lines[0].toBuyG, 250);
    assert.equal(list.unmatchedPantry.length, 1);
    assert.equal(list.unmatchedPantry[0].name, 'Tomate');
});

test('indexPantry separa lo comparable de lo que no lo es', () => {
    const { byFoodId, byName, unmatched } = indexPantry([
        { id: '1', name: 'Arroz', quantity: 500, unit: 'g', foodId: 'usda:arroz' },
        { id: '2', name: 'Huevos', quantity: 6, unit: 'ud' },
        { id: '3', name: 'Leche', quantity: 1000, unit: 'ml' }
    ]);
    assert.equal(byFoodId.size, 1);
    assert.equal(byName.size, 1);
    // El mililitro tampoco se resta de gramos aquí: la equivalencia se declara
    // en `core/foods.js` para escalar macros, no para contar existencias.
    assert.equal(unmatched.length, 2);
});

// ============================================================
// Pasillos y orden
// ============================================================

test('la lista se agrupa por el orden en que se recorre el súper, no alfabético', () => {
    const days = [{ meals: [{ items: [
        { foodId: 'a', name: 'Aceite', grams: 20 },
        { foodId: 'b', name: 'Brócoli', grams: 200 },
        { foodId: 'c', name: 'Pollo', grams: 300 }
    ] }] }];
    const foods = {
        a: { id: 'a', n: 'Aceite', k: 884, p: 0, c: 0, f: 100, cat: 'despensa', src: 'usda' },
        b: { id: 'b', n: 'Brócoli', k: 34, p: 2.8, c: 6.6, f: 0.4, cat: 'verdura', src: 'usda' },
        c: { id: 'c', n: 'Pollo', k: 120, p: 22.5, c: 0, f: 2.6, cat: 'carne', src: 'usda' }
    };
    const list = buildShoppingList({ days, foods: /** @type {*} */ (foods) });
    assert.deepEqual(list.groups.map((g) => g.aisle), ['verdura', 'carne', 'despensa']);
});

test('un alimento sin pasillo va a «otros» y no se pierde', () => {
    const days = [{ meals: [{ items: [{ foodId: 'x', name: 'Misterio', grams: 100 }] }] }];
    const list = buildShoppingList({ days, foods: {} });
    assert.equal(list.lines[0].aisle, DEFAULT_AISLE);
    assert.equal(list.groups.length, 1);
    assert.equal(list.groups[0].lines.length, 1);
});

test('un pasillo desconocido tampoco se pierde: va al final', () => {
    const days = [{ meals: [{ items: [
        { foodId: 'x', name: 'Raro', grams: 100 },
        { foodId: 'y', name: 'Brócoli', grams: 100 }
    ] }] }];
    const foods = /** @type {*} */ ({
        x: { id: 'x', n: 'Raro', k: 100, p: 5, c: 20, f: 0, cat: 'pasillo_inventado', src: 'usda' },
        y: { id: 'y', n: 'Brócoli', k: 34, p: 2.8, c: 6.6, f: 0.4, cat: 'verdura', src: 'usda' }
    });
    const list = buildShoppingList({ days, foods });
    assert.equal(list.groups.length, 2);
    assert.equal(list.groups[1].aisle, 'pasillo_inventado');
    assert.ok(!AISLE_ORDER.includes('pasillo_inventado'));
});

test('sortLines no cambia las cantidades, solo el orden', () => {
    const days = semanaDeMenus(2);
    const list = buildShoppingList({ days, foods: BY_ID });
    for (const criterio of /** @type {const} */ (['aisle', 'expiry', 'owned', 'name'])) {
        const ordenadas = sortLines(list.lines, criterio);
        assert.equal(ordenadas.length, list.lines.length);
        const suma = (/** @type {*[]} */ ls) => round(ls.reduce((a, l) => a + l.toBuyG, 0));
        assert.equal(suma(ordenadas), suma(list.lines), `«${criterio}» alteró la compra`);
    }
});

test('ordenar por caducidad pone lo que caduca antes primero, y lo sin fecha al final', () => {
    /** @type {*[]} */ const lines = [
        { foodId: 'a', name: 'Sin fecha', aisle: 'otros', neededG: 1, pantryUsedG: 0, toBuyG: 1, buyRoundedG: 10 },
        { foodId: 'b', name: 'Tarde', aisle: 'otros', neededG: 1, pantryUsedG: 1, toBuyG: 0, buyRoundedG: 0, expiresISO: '2026-12-01' },
        { foodId: 'c', name: 'Pronto', aisle: 'otros', neededG: 1, pantryUsedG: 1, toBuyG: 0, buyRoundedG: 0, expiresISO: '2026-08-10' }
    ];
    // Sin fecha NO es «caduca hoy», es «no sabemos»: delante haría gastar antes
    // lo que no corre prisa.
    assert.deepEqual(sortLines(lines, 'expiry').map((l) => l.name), ['Pronto', 'Tarde', 'Sin fecha']);
});

// ============================================================
// Redondeo y exportación
// ============================================================

test('el redondeo al alza vive aparte y no toca la conservación', () => {
    const days = [{ meals: [{ items: [{ foodId: 'x', name: 'Arroz', grams: 237 }] }] }];
    const list = buildShoppingList({ days, foods: {} });
    assert.equal(list.lines[0].toBuyG, 237, 'la cantidad exacta no se toca');
    assert.equal(list.lines[0].buyRoundedG, 240);
    assert.equal(list.lines[0].buyRoundedG % BUY_ROUNDING_G, 0);
    // Al alza: comprar de menos deja la receta a medias.
    assert.ok(list.lines[0].buyRoundedG >= list.lines[0].toBuyG);
});

test('el texto plano trae lo que hay que comprar y omite lo ya cubierto', () => {
    const days = [{ meals: [{ items: [
        { foodId: 'a', name: 'Pollo', grams: 300 },
        { foodId: 'b', name: 'Arroz', grams: 200 }
    ] }] }];
    const foods = /** @type {*} */ ({
        a: { id: 'a', n: 'Pollo', k: 120, p: 22.5, c: 0, f: 2.6, cat: 'carne', src: 'usda' },
        b: { id: 'b', n: 'Arroz', k: 365, p: 7.1, c: 80, f: 0.7, cat: 'despensa', src: 'usda' }
    });
    const pantry = [{ id: 'p', name: 'Arroz', quantity: 500, unit: 'g' }];
    const texto = toPlainText(buildShoppingList({ days, pantry, foods }), { title: 'Compra' });

    assert.match(texto, /Compra/);
    assert.match(texto, /CARNE/);
    assert.match(texto, /- Pollo: 300 g/);
    assert.ok(!texto.includes('Arroz'), 'lo que ya está en casa no se compra');
});

test('el texto de una lista vacía no revienta ni miente', () => {
    assert.equal(toPlainText({ groups: [] }), '');
    assert.equal(toPlainText(/** @type {*} */ ({})), '');
});

/** @param {number} v */
function round(v) {
    return Math.round(v * 10) / 10;
}

test('conservacion_de_la_compra · un bote a medias conserva el resto para la siguiente línea', () => {
    // Un bote de 500 g del que se gastan 150 tiene que dejar 350 disponibles.
    // Consumir la entrada entera «porque se tocó» hace comprar de más — y no se
    // nota hasta que llegas a casa con arroz de sobra.
    const days = [{ meals: [{ items: [
        { foodId: 'a', name: 'Arroz', grams: 150 },
        { foodId: 'b', name: 'Arroz', grams: 300 }
    ] }] }];
    const pantry = [{ id: 'p1', name: 'Arroz', quantity: 500, unit: 'g' }];
    const list = buildShoppingList({ days, pantry, foods: {} });

    const porId = Object.fromEntries(list.lines.map((l) => [l.foodId, l]));
    assert.equal(porId.a.pantryUsedG, 150);
    // 300 y no 350: `b` solo NECESITA 300. Lo que se comprueba es que el bote
    // conserve lo suyo tras la primera línea, no que la segunda se lo lleve todo.
    assert.equal(porId.b.pantryUsedG, 300, 'el resto del bote se perdió tras la primera línea');
    assert.equal(porId.b.toBuyG, 0);
    // Y sigue sin gastarse más de lo que había: 150 + 300 = 450 de 500.
    assert.equal(list.totals.pantryUsedG, 450);
});

test('conservacion_de_la_compra · varias entradas del mismo alimento no se sobreconsumen', () => {
    // Tres botes de 100 g y una línea que pide 150: se tocan dos, no los tres.
    // Sin el tope, la tercera entrada quedaba marcada y la línea siguiente se
    // quedaba sin nada que descontar.
    const days = [{ meals: [{ items: [
        { foodId: 'a', name: 'Arroz', grams: 150 },
        { foodId: 'b', name: 'Arroz', grams: 100 }
    ] }] }];
    const pantry = [
        { id: 'p1', name: 'Arroz', quantity: 100, unit: 'g' },
        { id: 'p2', name: 'Arroz', quantity: 100, unit: 'g' },
        { id: 'p3', name: 'Arroz', quantity: 100, unit: 'g' }
    ];
    const list = buildShoppingList({ days, pantry, foods: {} });
    const porId = Object.fromEntries(list.lines.map((l) => [l.foodId, l]));
    assert.equal(porId.a.pantryUsedG, 150);
    assert.equal(porId.b.pantryUsedG, 100, 'la segunda línea se quedó sin despensa');
    assert.equal(list.totals.toBuyG, 0);
    assert.equal(list.totals.pantryUsedG, 250, 'se gastó más despensa de la que había');
});

test('la caducidad manda: se gasta antes lo que antes caduca', () => {
    const days = [{ meals: [{ items: [{ foodId: 'a', name: 'Yogur', grams: 100 }] }] }];
    const pantry = [
        { id: 'tarde', name: 'Yogur', quantity: 100, unit: 'g', expiresISO: '2026-12-01' },
        { id: 'pronto', name: 'Yogur', quantity: 100, unit: 'g', expiresISO: '2026-08-10' }
    ];
    const list = buildShoppingList({ days, pantry, foods: {} });
    assert.equal(list.lines[0].pantryUsedG, 100);
    assert.equal(list.lines[0].expiresISO, '2026-08-10', 'gastó el que caduca más tarde');
});

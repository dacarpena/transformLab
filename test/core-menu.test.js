// @ts-check

/**
 * Invariantes del solver de menú (V2-M3).
 *
 * Los cinco con nombre: `nunca_dura` (jamás un alérgeno ni un suelo violado),
 * `dentro_de_banda`, `no_recalcula_kcal` (B3: las kcal las fija el motor),
 * `determinista` y `siempre_hay_solucion` (o se dice por qué no, sin inventar).
 *
 * Se prueba contra la BASE REAL empaquetada, no contra un puñado de alimentos de
 * juguete: un solver que cuadra con cuatro alimentos elegidos a mano y se atasca
 * con dos mil no sirve de nada, y esa diferencia solo se ve así.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    MACRO_BANDS, PROTEIN_FLOOR_RATIO, DIET_EXCLUDED_ORIGINS, VEG_PORTION_G,
    roleOf, isAllowed, candidatePool, solvePortions, withinBands, buildMenu, regenerateMeal
} from '../src/core/menu.js';
import { splitIntoMeals } from '../src/core/nutrition.js';

const BASE = JSON.parse(readFileSync(new URL('../vendor/data/foods.json', import.meta.url), 'utf8'));
/** @type {import('../src/core/foods.js').Food[]} */
const FOODS = BASE.foods;

/** Macros de un día de definición realista: 2 100 kcal, 165 g de proteína. */
const MACROS = { kcal: 2100, proteinG: 165, carbsG: 200, fatG: 58 };

/** @param {*} extra */
function menu(extra = {}) {
    const meals = splitIntoMeals({ ...MACROS, warnings: [] }, extra.mealCount ?? 4);
    assert.ok(meals.ok);
    return buildMenu({
        macros: MACROS,
        mealTargets: meals.value,
        foods: FOODS,
        preferences: extra.preferences ?? {},
        seed: extra.seed ?? 12345
    });
}

// ============================================================
// Clasificación por papel
// ============================================================

test('roleOf clasifica por reparto ENERGÉTICO, no por gramos', () => {
    const pollo = { id: 'a', n: 'Pechuga', k: 120, p: 22.5, c: 0, f: 2.6, src: 'usda' };
    const arroz = { id: 'b', n: 'Arroz', k: 365, p: 7.1, c: 80, f: 0.7, src: 'usda' };
    const aceite = { id: 'c', n: 'Aceite', k: 884, p: 0, c: 0, f: 100, src: 'usda' };
    const lechuga = { id: 'd', n: 'Lechuga', k: 15, p: 1.4, c: 2.9, f: 0.2, src: 'usda' };

    assert.equal(roleOf(/** @type {*} */ (pollo)), 'protein');
    assert.equal(roleOf(/** @type {*} */ (arroz)), 'carb');
    assert.equal(roleOf(/** @type {*} */ (aceite)), 'fat');
    // 100 g de aceite son 100 g de grasa pero 884 kcal; 100 g de lechuga, 15.
    // Clasificar por gramos pondría lechuga y pollo en la misma casilla.
    assert.equal(roleOf(/** @type {*} */ (lechuga)), 'veg');
});

test('roleOf no explota con un alimento sin energía', () => {
    assert.equal(roleOf(/** @type {*} */ ({ id: 'x', n: 'Agua', k: 0, p: 0, c: 0, f: 0, src: 'usda' })), 'mixed');
    assert.equal(roleOf(/** @type {*} */ (null)), 'mixed');
});

// ============================================================
// nunca_dura
// ============================================================

test('nunca_dura · un alérgeno declarado no entra en el menú, jamás', () => {
    const r = menu({ preferences: { hardExclusions: ['milk'] } });
    assert.ok(r.ok, r.ok === false ? r.error : '');
    for (const meal of r.value.meals) {
        for (const item of meal.items) {
            const food = FOODS.find((f) => f.id === item.foodId);
            assert.ok(food);
            assert.ok(!(food.a ?? []).includes('milk'), `${food.n} lleva leche`);
        }
    }
});

test('nunca_dura · el veto por nombre también es duro', () => {
    const r = menu({ preferences: { hardExclusions: ['pollo'] } });
    assert.ok(r.ok, r.ok === false ? r.error : '');
    for (const meal of r.value.meals) {
        for (const item of meal.items) assert.ok(!/pollo/i.test(item.name), item.name);
    }
});

test('nunca_dura · una dieta vegana no recibe carne, pescado, huevo ni lácteo', () => {
    const r = menu({ preferences: { dietType: 'vegan' } });
    assert.ok(r.ok, r.ok === false ? r.error : '');
    for (const meal of r.value.meals) {
        for (const item of meal.items) {
            const food = FOODS.find((f) => f.id === item.foodId);
            assert.ok(food);
            assert.ok(!DIET_EXCLUDED_ORIGINS.vegan.includes(String(food.diet)),
                `${food.n} es de origen ${food.diet}`);
            // Y conservador: sin origen conocido tampoco pasa. Las categorías
            // de OFF se equivocan, y ante la duda un vegano prefiere menos
            // opciones a un marisco mal clasificado.
            assert.notEqual(food.diet, undefined, `${food.n} entró sin origen conocido`);
        }
    }
});

test('REGRESIÓN · el pasillo NO decide la dieta: unas gambas congeladas no son veganas', () => {
    // El defecto real que esto cierra: `cat` contesta «dónde está en la tienda»
    // y la dieta necesita «de qué viene». Unas gambas peladas están en el
    // pasillo de CONGELADOS, así que el filtro por pasillo se las servía a un
    // vegano tan tranquilo. Un campo haciendo dos trabajos distintos es como se
    // hundió la v4.0 con la palabra «músculo».
    const gambas = { id: 'off:x', n: 'Gambas peladas congeladas', k: 73, p: 14.7, c: 0.5, f: 1,
        cat: 'congelados', diet: 'fish', src: 'off' };
    assert.equal(isAllowed(/** @type {*} */ (gambas), { dietType: 'vegan' }).ok, false);
    assert.equal(isAllowed(/** @type {*} */ (gambas), { dietType: 'vegetarian' }).ok, false);
    assert.equal(isAllowed(/** @type {*} */ (gambas), { dietType: 'pescatarian' }).ok, true);
    assert.equal(isAllowed(/** @type {*} */ (gambas), { dietType: 'omnivore' }).ok, true);

    // Y sin origen conocido, una dieta restrictiva lo deja fuera.
    const sinOrigen = { ...gambas, diet: undefined };
    const veredicto = isAllowed(/** @type {*} */ (sinOrigen), { dietType: 'vegan' });
    assert.equal(veredicto.ok, false);
    assert.equal(veredicto.ok === false && veredicto.reason, 'menu.unknownOrigin');
});

test('REGRESIÓN · un alimento de 26 kcal no puede ser la fuente proteica', () => {
    // La rúcula —26 kcal y 4,3 g de proteína— caía en el grupo de proteínas
    // porque la regla de verdura exigía además cierto reparto de hidratos. El
    // solver llegó a ofrecerla de plato principal.
    const rucula = { id: 'r', n: 'Rúcula', k: 26, p: 4.3, c: 1, f: 0.7, src: 'usda' };
    assert.equal(roleOf(/** @type {*} */ (rucula)), 'veg');
});

test('nunca_dura · el suelo de proteína se cumple o se dice que no se puede', () => {
    const r = menu();
    assert.ok(r.ok, r.ok === false ? r.error : '');
    assert.ok(r.value.totals.proteinG >= MACROS.proteinG * PROTEIN_FLOOR_RATIO,
        `${r.value.totals.proteinG} g frente a un suelo de ${MACROS.proteinG * PROTEIN_FLOOR_RATIO}`);
});

test('nunca_dura · lo que teclea el usuario no se le sirve como dato verificado', () => {
    const inventado = { id: 'user:1', n: 'Mi mezcla', k: 500, p: 50, c: 50, f: 10, src: 'user' };
    const { pools } = candidatePool(/** @type {*} */ ([inventado]), {});
    assert.equal(pools.protein.length, 0);
    assert.equal(isAllowed(/** @type {*} */ (inventado), {}).ok, false);
});

// ============================================================
// dentro_de_banda y no_recalcula_kcal
// ============================================================

test('dentro_de_banda · el total diario cae dentro de las bandas', () => {
    const r = menu();
    assert.ok(r.ok, r.ok === false ? r.error : '');
    assert.ok(r.value.bands.within, `desvíos: ${JSON.stringify(r.value.bands.off)}`);
});

test('dentro_de_banda · aguanta con 3, 4, 5 y 6 comidas', () => {
    for (const mealCount of [3, 4, 5, 6]) {
        const r = menu({ mealCount });
        assert.ok(r.ok, `${mealCount} comidas: ${r.ok === false ? r.error : ''}`);
        assert.ok(r.value.bands.within,
            `${mealCount} comidas, desvíos ${JSON.stringify(r.value.bands.off)}`);
        assert.equal(r.value.meals.length, mealCount);
    }
});

test('no_recalcula_kcal · el menú rellena las kcal de la fase, no las inventa (B3)', () => {
    const r = menu();
    assert.ok(r.ok, r.ok === false ? r.error : '');
    // El objetivo que sale es EXACTAMENTE el que entró: si el menú recalculara
    // las calorías acabaría discutiendo con el motor, y ganaría el que se
    // pintase el último.
    assert.deepEqual(r.value.target, MACROS);
    const desvio = Math.abs(r.value.totals.kcal - MACROS.kcal) / MACROS.kcal;
    assert.ok(desvio <= MACRO_BANDS.kcal, `${r.value.totals.kcal} kcal frente a ${MACROS.kcal}`);
});

test('withinBands señala QUÉ macro se sale, no solo que algo falla', () => {
    const fuera = withinBands(
        { kcal: 2600, proteinG: 165, carbsG: 200, fatG: 58 },
        MACROS
    );
    assert.equal(fuera.within, false);
    assert.ok(fuera.off.kcal > MACRO_BANDS.kcal);
    assert.ok(Math.abs(fuera.off.proteinG) < 0.001, 'la proteína no se señala: está en su sitio');
});

// ============================================================
// determinista
// ============================================================

test('determinista · misma semilla, mismo menú hasta el gramo', () => {
    const a = menu({ seed: 777 });
    const b = menu({ seed: 777 });
    assert.ok(a.ok && b.ok);
    assert.deepEqual(a.value.meals, b.value.meals);
});

test('determinista · semillas distintas dan menús distintos', () => {
    const a = menu({ seed: 1 });
    const b = menu({ seed: 999 });
    assert.ok(a.ok && b.ok);
    // Sin variedad el solver serviría pollo con arroz siete días seguidos:
    // técnicamente cuadra y nadie lo sostiene.
    assert.notDeepEqual(a.value.meals, b.value.meals);
});

test('determinista · no se repite el mismo alimento en todas las comidas', () => {
    const r = menu({ mealCount: 4 });
    assert.ok(r.ok);
    const proteinas = r.value.meals.map((m) => m.items[0]?.foodId);
    assert.ok(new Set(proteinas).size > 1, `siempre la misma proteína: ${proteinas[0]}`);
});

// ============================================================
// siempre_hay_solucion
// ============================================================

test('siempre_hay_solucion · restricciones razonables siguen dando menú', () => {
    const casos = [
        { dietType: 'vegetarian' },
        { dietType: 'pescatarian' },
        { hardExclusions: ['gluten'] },
        { hardExclusions: ['milk', 'eggs'] },
        { softExclusions: ['pollo', 'arroz', 'atun', 'yogur'] }
    ];
    for (const preferences of casos) {
        const r = menu({ preferences });
        assert.ok(r.ok, `${JSON.stringify(preferences)} → ${r.ok === false ? r.error : ''}`);
        assert.ok(r.value.bands.within,
            `${JSON.stringify(preferences)} se sale: ${JSON.stringify(r.value.bands.off)}`);
    }
});

test('siempre_hay_solucion · lo blando penaliza pero NO prohíbe', () => {
    // Meterlo todo como duro deja el problema sin solución factible. Con la
    // preferencia blanda el pollo baja en la lista; con la dura desaparece.
    const blando = menu({ preferences: { softExclusions: ['pollo'] } });
    assert.ok(blando.ok);
    const { pools } = candidatePool(FOODS, { softExclusions: ['pollo'] });
    assert.ok(pools.protein.some((f) => /pollo/i.test(f.n)), 'lo blando no debe eliminar');
});

test('siempre_hay_solucion · sin fuentes posibles se DICE, no se inventa', () => {
    const soloVerdura = FOODS.filter((f) => roleOf(f) === 'veg');
    const r = buildMenu({
        macros: MACROS,
        mealTargets: [{ index: 0, ...MACROS }],
        foods: soloVerdura,
        seed: 1
    });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'menu.noProteinSource');
    // Y con el motivo desglosado, para que la interfaz pueda explicarlo.
    assert.ok(r.ok === false && typeof r.detail === 'object');
});

test('siempre_hay_solucion · entrada inválida se rechaza con su motivo', () => {
    assert.equal(buildMenu(/** @type {*} */ ({})).ok, false);
    assert.equal(buildMenu(/** @type {*} */ ({ macros: MACROS, mealTargets: [], foods: FOODS })).ok, false);
    const sinMacros = buildMenu(/** @type {*} */ ({ macros: { kcal: 0 }, mealTargets: [{}], foods: FOODS }));
    assert.equal(sinMacros.ok === false && sinMacros.error, 'menu.macrosInvalid');
});

// ============================================================
// Porciones
// ============================================================

test('solvePortions da gramajes que se pueden pesar y sumar', () => {
    const picks = {
        protein: /** @type {*} */ ({ id: 'p', n: 'Pollo', k: 120, p: 22.5, c: 0, f: 2.6, src: 'usda' }),
        carb: /** @type {*} */ ({ id: 'c', n: 'Arroz', k: 365, p: 7.1, c: 80, f: 0.7, src: 'usda' }),
        fat: /** @type {*} */ ({ id: 'f', n: 'Aceite', k: 884, p: 0, c: 0, f: 100, src: 'usda' }),
        veg: /** @type {*} */ ({ id: 'v', n: 'Brócoli', k: 34, p: 2.8, c: 6.6, f: 0.4, src: 'usda' })
    };
    const items = solvePortions(picks, { kcal: 525, proteinG: 41, carbsG: 50, fatG: 14 });
    assert.ok(items.length >= 3);
    for (const item of items) {
        assert.equal(item.grams % 5, 0, `${item.food.n}: ${item.grams} g no se pesa cómodo`);
        assert.ok(item.grams > 0);
    }
    assert.equal(items.find((i) => i.food.id === 'v')?.grams, VEG_PORTION_G);
});

test('solvePortions no divide por cero con un alimento de macro nula', () => {
    const picks = {
        protein: /** @type {*} */ ({ id: 'p', n: 'Raro', k: 100, p: 0, c: 25, f: 0, src: 'usda' }),
        carb: /** @type {*} */ ({ id: 'c', n: 'Arroz', k: 365, p: 7.1, c: 80, f: 0.7, src: 'usda' }),
        fat: /** @type {*} */ ({ id: 'f', n: 'Nada', k: 0, p: 0, c: 0, f: 0, src: 'usda' }),
        veg: null
    };
    const items = solvePortions(picks, { kcal: 500, proteinG: 40, carbsG: 50, fatG: 15 });
    for (const item of items) {
        assert.ok(Number.isFinite(item.grams), `${item.food.n} salió ${item.grams}`);
        assert.ok(Number.isFinite(item.macros.kcal));
    }
});

// ============================================================
// Regenerar una sola comida
// ============================================================

test('regenerateMeal cambia una comida y el DÍA sigue dentro de banda', () => {
    const r = menu();
    assert.ok(r.ok);
    const antes = r.value.meals[1].items.map((i) => i.foodId);

    const nuevo = regenerateMeal(r.value, 1, { foods: FOODS, seed: 12345 });
    assert.ok(nuevo.ok, nuevo.ok === false ? nuevo.error : '');
    const despues = nuevo.value.meals[1].items.map((i) => i.foodId);

    assert.notDeepEqual(despues, antes, 'debe ser OTRA comida, no la misma');
    // Y esto es lo importante: cambiar una comida cambia el total del día.
    // Sustituir a ciegas convertiría «otra opción» en la forma más rápida de
    // romper el plan sin enterarse.
    assert.ok(nuevo.value.bands.within, JSON.stringify(nuevo.value.bands.off));
    assert.ok(nuevo.value.totals.proteinG >= MACROS.proteinG * PROTEIN_FLOOR_RATIO);
});

test('regenerateMeal no toca las demás comidas', () => {
    const r = menu();
    assert.ok(r.ok);
    const nuevo = regenerateMeal(r.value, 2, { foods: FOODS, seed: 12345 });
    assert.ok(nuevo.ok);
    for (const i of [0, 1, 3]) {
        assert.deepEqual(nuevo.value.meals[i], r.value.meals[i], `la comida ${i} cambió`);
    }
});

test('regenerateMeal es determinista: pedir «otra opción» dos veces da lo mismo', () => {
    const r = menu();
    assert.ok(r.ok);
    const a = regenerateMeal(r.value, 0, { foods: FOODS, seed: 12345 });
    const b = regenerateMeal(r.value, 0, { foods: FOODS, seed: 12345 });
    assert.ok(a.ok && b.ok);
    assert.deepEqual(a.value.meals, b.value.meals);
});

test('regenerateMeal respeta las duras: la alternativa tampoco lleva el alérgeno', () => {
    const preferences = { hardExclusions: ['milk'] };
    const r = menu({ preferences });
    assert.ok(r.ok);
    const nuevo = regenerateMeal(r.value, 1, { foods: FOODS, preferences, seed: 12345 });
    assert.ok(nuevo.ok, nuevo.ok === false ? nuevo.error : '');
    for (const item of nuevo.value.meals[1].items) {
        const food = FOODS.find((f) => f.id === item.foodId);
        assert.ok(!(food?.a ?? []).includes('milk'), `${item.name} lleva leche`);
    }
});

test('regenerateMeal con un índice que no existe se rechaza, no revienta', () => {
    const r = menu();
    assert.ok(r.ok);
    const nuevo = regenerateMeal(r.value, 99, { foods: FOODS, seed: 1 });
    assert.equal(nuevo.ok, false);
    assert.equal(nuevo.ok === false && nuevo.error, 'menu.mealNotFound');
});

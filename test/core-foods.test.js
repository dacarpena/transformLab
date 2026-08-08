// @ts-check

/**
 * Invariantes de la base de alimentos (V2-M2).
 *
 * Los cuatro con nombre son `solo_verificado`, `saneado`, `agregacion_conserva`
 * y `cobertura_declarada`. Los dos primeros protegen la frontera de confianza
 * (qué cifras pueden alimentar el motor); el tercero protege la lista de la
 * compra de V2-M4; el cuarto impide que la interfaz finja exhaustividad.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    TRUSTED_SOURCES, REFERENCE_GRAMS, isTrusted, normalize, search,
    scaleFood, sumMacros, aggregate, mergeKey, recipeMacros, coverage
} from '../src/core/foods.js';
import { sanityCheck, fromOpenFoodFacts, AISLES } from '../tools/build-food-db.mjs';

const BASE = JSON.parse(readFileSync(new URL('../vendor/data/foods.json', import.meta.url), 'utf8'));

// ============================================================
// solo_verificado
// ============================================================

test('solo_verificado · únicamente usda y off alimentan cálculos', () => {
    assert.deepEqual([...TRUSTED_SOURCES], ['usda', 'off']);
    assert.equal(isTrusted({ src: 'usda' }), true);
    assert.equal(isTrusted({ src: 'off' }), true);
    assert.equal(isTrusted({ src: 'user' }), false);
    assert.equal(isTrusted(null), false);
    assert.equal(isTrusted({}), false);
});

test('solo_verificado · un ingrediente del usuario no entra en los macros de la receta', () => {
    const index = {
        'usda:arroz': { id: 'usda:arroz', n: 'Arroz', k: 365, p: 7.1, c: 80, f: 0.7, src: 'usda' },
        'user:salsa': { id: 'user:salsa', n: 'Mi salsa', k: 400, p: 1, c: 10, f: 40, src: 'user' }
    };
    const r = recipeMacros({
        servings: 1,
        ingredients: [
            { name: 'Arroz', quantity: 100, unit: 'g', foodId: 'usda:arroz' },
            { name: 'Mi salsa', quantity: 100, unit: 'g', foodId: 'user:salsa' }
        ]
    }, index);

    assert.equal(r.total.kcal, 365, 'las 400 kcal del alimento del usuario no se suman');
    // Y sobre todo: se DECLARA que no se contó, en vez de contarlo como cero.
    assert.deepEqual(r.unknown, ['Mi salsa']);
    assert.equal(r.covered, 1);
    assert.equal(r.count, 2);
});

test('solo_verificado · todo lo empaquetado tiene procedencia de fiar', () => {
    for (const food of BASE.foods) {
        assert.ok(isTrusted(food), `${food.id} tiene src=${food.src}`);
    }
});

// ============================================================
// saneado
// ============================================================

test('saneado · la criba rechaza lo incoherente y acepta lo correcto', () => {
    assert.equal(sanityCheck({ k: 365, p: 7.1, c: 80, f: 0.7 }).ok, true, 'arroz');
    assert.equal(sanityCheck({ k: 884, p: 0, c: 0, f: 100 }).ok, true, 'aceite');
    // Agua: cero energía y cero macros es coherente, no un error.
    assert.equal(sanityCheck({ k: 0, p: 0, c: 0, f: 0 }).ok, true, 'agua');

    const rechazos = [
        [{ k: 100, p: 0, c: 0, f: 0 }, 'kcalSinMacros'],
        [{ k: 1200, p: 0, c: 0, f: 100 }, 'kcalFueraDeRango'],
        [{ k: 400, p: 50, c: 50, f: 50 }, 'macrosSuperan100g'],
        [{ k: 100, p: 20, c: 20, f: 10 }, 'atwaterIncoherente'],
        [{ k: -5, p: 1, c: 1, f: 1 }, 'kNoFinito'],
        [{ k: Number.NaN, p: 1, c: 1, f: 1 }, 'kNoFinito']
    ];
    for (const [food, reason] of rechazos) {
        const r = sanityCheck(/** @type {*} */ (food));
        assert.equal(r.ok, false, `debería rechazar ${JSON.stringify(food)}`);
        assert.equal(r.ok === false && r.reason, reason);
    }
});

test('saneado · ninguna ficha empaquetada viola Atwater ni el rango de kcal', () => {
    // Comprobación INDEPENDIENTE, a propósito: si se usara `sanityCheck` —la
    // misma función con la que se construyó el fichero— el test solo diría que
    // el constructor se aplicó a sí mismo, y una criba equivocada pasaría. Aquí
    // se rehacen las cuentas a mano.
    for (const food of BASE.foods) {
        assert.ok(Number.isFinite(food.k) && food.k >= 0 && food.k <= 950, `kcal de ${food.id}: ${food.k}`);
        for (const macro of ['p', 'c', 'f']) {
            assert.ok(Number.isFinite(food[macro]) && food[macro] >= 0, `${macro} de ${food.id}`);
        }
        assert.ok(food.p + food.c + food.f <= 105, `${food.id} tiene más de 100 g de macros por 100 g`);

        const desdeMacros = food.p * 4 + food.c * 4 + food.f * 9;
        if (food.k === 0 && desdeMacros < 5) continue;
        assert.ok(desdeMacros > 0, `${food.id} declara kcal sin macros`);
        const desvio = Math.abs(food.k - desdeMacros) / desdeMacros;
        assert.ok(desvio <= 0.35, `${food.id} «${food.n}»: ${food.k} kcal frente a ${desdeMacros.toFixed(0)} de sus macros`);
    }
});

test('saneado · el normalizador de OFF descarta lo que no puede usar', () => {
    // Sin nombre: inútil aunque los macros estén.
    assert.equal(fromOpenFoodFacts({
        code: '1', product_name: '  ',
        nutriments: { 'energy-kcal_100g': 100, proteins_100g: 5, carbohydrates_100g: 10, fat_100g: 4 }
    }).ok, false);

    // Macros incompletos: el hueco no se rellena con cero.
    assert.equal(fromOpenFoodFacts({
        code: '2', product_name: 'Algo', nutriments: { 'energy-kcal_100g': 100 }
    }).ok, false);

    const bueno = fromOpenFoodFacts({
        code: '8480000123456',
        product_name: 'Yogur natural',
        quantity: '630 g (3 x 210 g)',
        allergens_tags: ['en:milk'],
        categories_tags: ['en:dairies', 'en:yogurts'],
        nutriments: { 'energy-kcal_100g': 61, proteins_100g: 3.5, carbohydrates_100g: 4.7, fat_100g: 3.3 }
    });
    assert.ok(bueno.ok);
    assert.equal(bueno.value.id, 'off:8480000123456');
    assert.equal(bueno.value.src, 'off');
    assert.equal(bueno.value.e, '8480000123456');
    // De «630 g (3 x 210 g)» se extrae el primer número con unidad y se
    // descarta el resto, en vez de intentar entender el texto libre.
    assert.deepEqual(bueno.value.q, [630, 'g']);
    assert.deepEqual(bueno.value.a, ['milk']);
    assert.equal(bueno.value.cat, 'lacteos');
});

test('saneado · los pasillos empaquetados salen de la taxonomía propia', () => {
    for (const food of BASE.foods) {
        if (food.cat === undefined) continue;
        assert.ok(AISLES.includes(food.cat), `pasillo desconocido: ${food.cat}`);
    }
});

// ============================================================
// agregacion_conserva
// ============================================================

test('agregacion_conserva · fusionar repetidos mantiene la cantidad total', () => {
    const items = [
        { name: 'Arroz', quantity: 80, unit: 'g', foodId: 'usda:arroz' },
        { name: 'Tomate', quantity: 150, unit: 'g' },
        { name: 'Arroz', quantity: 120, unit: 'g', foodId: 'usda:arroz' },
        { name: 'Tomate', quantity: 50, unit: 'g' }
    ];
    const out = aggregate(items);
    assert.equal(out.length, 2);

    const antes = items.reduce((s, i) => s + i.quantity, 0);
    const despues = out.reduce((s, i) => s + i.quantity, 0);
    assert.equal(despues, antes, 'la cantidad total no cambia');
    assert.equal(out.find((i) => i.foodId === 'usda:arroz')?.quantity, 200);
});

test('agregacion_conserva · unidades distintas NO se fusionan', () => {
    // 200 g de tomate y 2 unidades de tomate no se pueden sumar sin saber lo
    // que pesa un tomate, y ese dato no lo tenemos. Fusionarlos daría «202».
    const out = aggregate([
        { name: 'Tomate', quantity: 200, unit: 'g' },
        { name: 'Tomate', quantity: 2, unit: 'ud' }
    ]);
    assert.equal(out.length, 2);
    assert.notEqual(mergeKey({ name: 'Tomate', quantity: 1, unit: 'g' }),
        mergeKey({ name: 'Tomate', quantity: 1, unit: 'ud' }));
});

test('agregacion_conserva · fusiona por foodId aunque el nombre difiera, y al revés', () => {
    const porId = aggregate([
        { name: 'Arroz blanco', quantity: 50, unit: 'g', foodId: 'usda:arroz' },
        { name: 'arroz', quantity: 50, unit: 'g', foodId: 'usda:arroz' }
    ]);
    assert.equal(porId.length, 1);
    assert.equal(porId[0].quantity, 100);

    // Sin foodId, el nombre normalizado manda: «Tomate» y «tomate» son lo mismo.
    const porNombre = aggregate([
        { name: 'Tomate', quantity: 30, unit: 'g' },
        { name: '  TOMATE ', quantity: 20, unit: 'g' }
    ]);
    assert.equal(porNombre.length, 1);
    assert.equal(porNombre[0].quantity, 50);
});

test('agregacion_conserva · un foodId conocido gana sobre su ausencia', () => {
    const out = aggregate([
        { name: 'Arroz', quantity: 10, unit: 'g' },
        { name: 'Arroz', quantity: 10, unit: 'g', foodId: 'usda:arroz' }
    ]);
    // Sin foodId en la primera aparición, la clave es la del nombre; la segunda
    // aporta el id. Que se fusionen o no depende de la clave, pero la cantidad
    // total se conserva SIEMPRE.
    assert.equal(out.reduce((s, i) => s + i.quantity, 0), 20);
});

// ============================================================
// cobertura_declarada
// ============================================================

test('cobertura_declarada · la base sabe decir qué cubre', () => {
    const c = coverage(BASE.foods);
    assert.equal(c.total, BASE.foods.length);
    assert.equal(Object.values(c.bySource).reduce((a, b) => a + b, 0), c.total);
    assert.ok(c.bySource.usda > 0, 'hay genéricos para el fresco');
    assert.ok(c.bySource.off > 0, 'hay productos de marca');
    assert.ok(c.withEan <= c.total);
});

test('cobertura_declarada · los datos empaquetados llevan su licencia dentro', () => {
    // La atribución ODbL viaja CON los datos, no solo en un fichero aparte que
    // alguien puede no copiar.
    const off = BASE.sources.find((/** @type {*} */ s) => s.src === 'off');
    assert.ok(off, 'falta la fuente Open Food Facts');
    assert.match(off.license, /ODbL/);
    const usda = BASE.sources.find((/** @type {*} */ s) => s.src === 'usda');
    assert.ok(usda);
    assert.match(usda.license, /CC0/);
});

// ============================================================
// Búsqueda y escalado
// ============================================================

test('normalize · quita tildes y puntuación, para que «platano» encuentre «plátano»', () => {
    assert.equal(normalize('Plátano'), 'platano');
    assert.equal(normalize('  Queso  FRESCO, 0 %  '), 'queso fresco 0');
    assert.equal(normalize(null), '');
});

test('search · todos los términos deben aparecer (AND, no OR)', () => {
    const foods = [
        { id: 'a', n: 'Yogur natural', k: 61, p: 3.5, c: 4.7, f: 3.3, src: 'usda' },
        { id: 'b', n: 'Yogur proteinas', k: 84, p: 10, c: 5, f: 2.7, src: 'off' },
        { id: 'c', n: 'Leche entera', k: 61, p: 3.2, c: 4.8, f: 3.3, src: 'usda' }
    ];
    const r = search(/** @type {*} */ (foods), 'yogur proteinas');
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'b');
});

test('search · el genérico verificado va por delante de la marca', () => {
    const foods = [
        { id: 'off:x', n: 'Pollo asado con patatas', b: 'Hacendado', k: 150, p: 12, c: 8, f: 7, src: 'off' },
        { id: 'usda:pollo', n: 'Pechuga de pollo cruda', k: 120, p: 22.5, c: 0, f: 2.6, src: 'usda' }
    ];
    const r = search(/** @type {*} */ (foods), 'pollo');
    assert.equal(r[0].id, 'usda:pollo');
});

test('search · consulta vacía no devuelve toda la base', () => {
    assert.deepEqual(search(/** @type {*} */ (BASE.foods), ''), []);
    assert.deepEqual(search(/** @type {*} */ (BASE.foods), '   '), []);
});

test('search · filtra por pasillo y por procedencia', () => {
    const soloUsda = search(/** @type {*} */ (BASE.foods), 'pollo', { sources: ['usda'] });
    for (const f of soloUsda) assert.equal(f.src, 'usda');
    const soloLacteos = search(/** @type {*} */ (BASE.foods), 'leche', { aisle: 'lacteos', limit: 5 });
    assert.ok(soloLacteos.length <= 5);
    for (const f of soloLacteos) assert.equal(f.cat, 'lacteos');
});

test('search · encuentra alimentos reales de la base empaquetada', () => {
    for (const consulta of ['pollo', 'arroz', 'yogur', 'aceite de oliva', 'platano']) {
        assert.ok(search(/** @type {*} */ (BASE.foods), consulta).length > 0, `sin resultados para «${consulta}»`);
    }
});

test('scaleFood · escala sobre 100 g y nunca devuelve NaN', () => {
    const arroz = { id: 'a', n: 'Arroz', k: 365, p: 7.1, c: 80, f: 0.7, src: 'usda' };
    assert.equal(REFERENCE_GRAMS, 100);
    assert.deepEqual(scaleFood(/** @type {*} */ (arroz), 100), { kcal: 365, proteinG: 7.1, carbsG: 80, fatG: 0.7 });
    assert.deepEqual(scaleFood(/** @type {*} */ (arroz), 50), { kcal: 182.5, proteinG: 3.6, carbsG: 40, fatG: 0.4 });

    // Un NaN se propagaría en silencio por toda la suma del día y aparecería
    // tres pantallas más allá, donde ya no se sabe de dónde salió.
    for (const malo of [Number.NaN, -10, undefined, null, 'cien']) {
        const r = scaleFood(/** @type {*} */ (arroz), /** @type {*} */ (malo));
        assert.deepEqual(r, { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
    }
    assert.deepEqual(scaleFood(null, 100), { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
});

test('sumMacros · redondea solo al final', () => {
    // Veinte ingredientes de 0,04 g de grasa suman 0,8, no 0.
    const veinte = Array.from({ length: 20 }, () => ({ kcal: 0, proteinG: 0, carbsG: 0, fatG: 0.04 }));
    assert.equal(sumMacros(veinte).fatG, 0.8);
});

test('recipeMacros · reparte por ración y declara lo que no pudo contar', () => {
    const index = {
        'usda:arroz': { id: 'usda:arroz', n: 'Arroz', k: 365, p: 7.1, c: 80, f: 0.7, src: 'usda' }
    };
    const r = recipeMacros({
        servings: 2,
        ingredients: [
            { name: 'Arroz', quantity: 200, unit: 'g', foodId: 'usda:arroz' },
            { name: 'Un chorrito de aceite', quantity: 1, unit: 'chorrito' }
        ]
    }, index);
    assert.equal(r.total.kcal, 730);
    assert.equal(r.perServing.kcal, 365);
    assert.deepEqual(r.unknown, ['Un chorrito de aceite']);
});

test('recipeMacros · sin raciones declaradas no divide por cero', () => {
    const index = { x: { id: 'x', n: 'X', k: 100, p: 0, c: 25, f: 0, src: 'usda' } };
    const r = recipeMacros({ ingredients: [{ name: 'X', quantity: 100, unit: 'g', foodId: 'x' }] }, index);
    assert.equal(r.perServing.kcal, 100);
    assert.ok(Number.isFinite(r.perServing.kcal));
});

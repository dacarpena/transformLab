#!/usr/bin/env node
// @ts-check

/**
 * Construye la base de alimentos empaquetada (V2-M2).
 *
 * TRES CAPAS, CON PROCEDENCIA EXPLÍCITA. El campo `src` es análogo a
 * `muscleSource` (A3): dice de dónde sale cada cifra, y solo lo verificado
 * alimenta cálculos del motor.
 *
 *   'off'  Open Food Facts filtrado a marca Hacendado — productos REALES de
 *          Mercadona, con sus nombres ya en español. Licencia ODbL.
 *   'usda' Genéricos (pollo, arroz, huevo…) con nombre español propio.
 *          Valores de USDA FoodData Central, CC0. Cubren el fresco, que es
 *          justo donde OFF no llega: el catálogo vivo de Mercadona tiene
 *          CUATRO productos de fruta y verdura, y la carne cruza al 3,8 %.
 *   'user' lo que teclee el usuario. NUNCA se mezcla con lo anterior.
 *
 * POR QUÉ NO HAY PRODUCTOS DE MERCADONA CON MACROS DIRECTOS. Comprobado con
 * peticiones reales: **la API de Mercadona no tiene macronutrientes**. Su
 * `nutrition_information` solo trae alérgenos e ingredientes. No es que sea
 * difícil de extraer: el dato no existe en el origen, lo que invalida de paso
 * todos los «datasets de Mercadona» que circulan. La vía honesta es cruzar por
 * marca con Open Food Facts.
 *
 * ESTO ES UN SANEADOR, NO UN IMPORTADOR. Defectos medidos en OFF: fichas
 * energéticamente incoherentes con Atwater (4,3 %), cantidades en texto libre
 * («630 g (3 x 210 g)»), campos no escalables corrompidos por reescalado, y
 * categorías sencillamente mal. Todo lo que no pasa la criba se descarta y se
 * cuenta: es preferible una base pequeña y fiable a una grande que miente.
 *
 * Uso:  node tools/build-food-db.mjs [--limite N]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Kilocalorías por gramo de cada macro (factores de Atwater). */
const ATWATER = Object.freeze({ protein: 4, carbs: 4, fat: 9 });

/**
 * Tolerancia de la comprobación de Atwater.
 *
 * Las kcal declaradas deben cuadrar con las que suman sus macros. ±35 % suena
 * generoso, y lo es a propósito: la fibra, los polialcoholes y el redondeo del
 * etiquetado producen desviaciones legítimas. Con menos margen se descartarían
 * productos correctos; con más, entraría basura. Con este umbral la criba tira
 * el ~8 % de la muestra.
 */
const ATWATER_TOLERANCE = 0.35;

/** Rango plausible de kcal por 100 g. El aceite puro ronda 900. */
const KCAL_MIN = 0;
const KCAL_MAX = 950;

/**
 * Pasillos propios. Es una taxonomía DELIBERADAMENTE corta: la de Open Food
 * Facts tiene miles de etiquetas jerárquicas, se contradice a sí misma (pan
 * integral clasificado como `snacks-dulces`) y no sirve para ordenar una lista
 * de la compra. Aquí solo hacen falta los pasillos por los que se camina.
 * @type {readonly string[]}
 */
export const AISLES = Object.freeze([
    'fruta', 'verdura', 'carne', 'pescado', 'huevos', 'lacteos',
    'panaderia', 'despensa', 'congelados', 'bebidas', 'snacks', 'precocinados'
]);

/**
 * Primera etiqueta de OFF que reconocemos gana. El orden importa: las reglas
 * más específicas van antes que las genéricas, porque un yogur también está
 * etiquetado como «lácteo» y como «producto fermentado».
 * @type {Array<[RegExp, string]>}
 */
const A_PASILLO = [
    [/^en:(yogurts|cheeses|milks|dairies|creams|butters)/, 'lacteos'],
    [/^en:(eggs)/, 'huevos'],
    [/^en:(fishes|seafood|canned-fish|tunas|salmons)/, 'pescado'],
    [/^en:(meats|poultry|hams|sausages|chickens|beef|pork)/, 'carne'],
    [/^en:(fresh-fruits|fruits)$/, 'fruta'],
    [/^en:(fresh-vegetables|vegetables)$/, 'verdura'],
    [/^en:(breads|breakfast-cereals|viennoiserie|biscuits-and-cakes)/, 'panaderia'],
    [/^en:(frozen-foods|frozen)/, 'congelados'],
    [/^en:(beverages|waters|juices|sodas|coffees|teas)/, 'bebidas'],
    [/^en:(snacks|crisps|chocolates|candies|confectioneries)/, 'snacks'],
    [/^en:(meals|prepared|pizzas|sandwiches|soups)/, 'precocinados'],
    [/^en:(cereals-and-potatoes|legumes|pastas|rices|groceries|plant-based-foods|condiments|sauces|oils|spreads)/, 'despensa']
];

/** @param {string[]} tags @returns {string | undefined} */
function pasilloDe(tags) {
    for (const [re, aisle] of A_PASILLO) {
        for (const t of tags) if (re.test(t)) return aisle;
    }
    return undefined;
}

/** @param {unknown} v @returns {number | null} */
function n(v) {
    const x = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
    return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

/**
 * ¿La ficha es internamente coherente?
 *
 * @param {{ k: number, p: number, c: number, f: number }} food
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function sanityCheck(food) {
    const { k, p, c, f } = food;
    for (const [name, v] of Object.entries({ k, p, c, f })) {
        if (!Number.isFinite(v) || v < 0) return { ok: false, reason: `${name}NoFinito` };
    }
    if (k < KCAL_MIN || k > KCAL_MAX) return { ok: false, reason: 'kcalFueraDeRango' };
    // Los macros no pueden pesar más de 100 g por cada 100 g de alimento.
    if (p + c + f > 105) return { ok: false, reason: 'macrosSuperan100g' };

    const desdeMacros = p * ATWATER.protein + c * ATWATER.carbs + f * ATWATER.fat;
    // Un alimento sin energía ni macros (agua, café solo) es válido.
    if (k === 0 && desdeMacros < 5) return { ok: true };
    if (desdeMacros === 0) return { ok: false, reason: 'kcalSinMacros' };
    const desvio = Math.abs(k - desdeMacros) / desdeMacros;
    if (desvio > ATWATER_TOLERANCE) return { ok: false, reason: 'atwaterIncoherente' };
    return { ok: true };
}

/**
 * Normaliza una ficha de Open Food Facts al esquema propio.
 * @param {Record<string, *>} raw
 * @returns {{ ok: true, value: Record<string, *> } | { ok: false, reason: string }}
 */
export function fromOpenFoodFacts(raw) {
    const nombre = String(raw?.product_name ?? '').trim();
    if (nombre === '' || nombre.length > 120) return { ok: false, reason: 'sinNombre' };

    const nut = raw?.nutriments ?? {};
    const k = n(nut['energy-kcal_100g']);
    const p = n(nut.proteins_100g);
    const c = n(nut.carbohydrates_100g);
    const f = n(nut.fat_100g);
    if (k === null || p === null || c === null || f === null) return { ok: false, reason: 'macrosIncompletos' };

    const food = {
        id: `off:${raw.code}`,
        n: nombre,
        b: 'Hacendado',
        k: Math.round(k),
        p: Math.round(p * 10) / 10,
        c: Math.round(c * 10) / 10,
        f: Math.round(f * 10) / 10,
        src: 'off'
    };
    const sane = sanityCheck(food);
    if (!sane.ok) return { ok: false, reason: sane.reason };

    // `quantity` viene en texto libre («630 g (3 x 210 g)»): se extrae el primer
    // número con unidad y se descarta el resto en vez de intentar entenderlo.
    const q = String(raw?.quantity ?? '').match(/(\d+(?:[.,]\d+)?)\s*(g|ml|kg|l)\b/i);
    if (q) {
        const valor = Number(q[1].replace(',', '.'));
        const unidad = q[2].toLowerCase();
        const gramos = unidad === 'kg' || unidad === 'l' ? valor * 1000 : valor;
        if (Number.isFinite(gramos) && gramos > 0 && gramos <= 20000) {
            food.q = [Math.round(gramos), unidad === 'ml' || unidad === 'l' ? 'ml' : 'g'];
        }
    }
    const ean = String(raw?.code ?? '');
    if (/^\d{8,14}$/.test(ean)) food.e = ean;

    const cat = pasilloDe((raw?.categories_tags ?? []).map(String));
    if (cat) food.cat = cat;

    const alergenos = (raw?.allergens_tags ?? [])
        .map((/** @type {string} */ a) => String(a).replace(/^[a-z]{2}:/, ''))
        .filter(Boolean).slice(0, 12);
    if (alergenos.length > 0) food.a = alergenos;

    return { ok: true, value: food };
}

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Descarga una página de la API de OFF, con reintentos.
 *
 * El 503 de OFF es INTERMITENTE y depende de su carga, no de la petición:
 * medido, la misma consulta con `page_size=100` da 503 y con 50 da 200, y a los
 * dos segundos al revés. Sin reintentos la construcción termina «bien» con cero
 * productos de marca — que es exactamente el fallo silencioso que hay que
 * evitar. Y el 503 llega como HTML, así que hay que mirar el estado Y el
 * content-type o te tragas una página de error creyendo que es JSON.
 */
async function fetchPage(page, extra = '', intentos = 4) {
    const url = 'https://world.openfoodfacts.org/api/v2/search'
        + `?brands_tags=hacendado${extra}`
        + '&fields=code,product_name,nutriments,quantity,allergens_tags,categories_tags'
        + `&page_size=50&page=${page}`;
    let ultimo = 0;
    for (let i = 0; i < intentos; i++) {
        if (i > 0) await sleep(1500 * i);
        let res;
        try {
            res = await fetch(url, { headers: { 'User-Agent': 'TransformLab/2.0 (proyecto personal, sin ánimo de lucro)' } });
        } catch { ultimo = 0; continue; }
        ultimo = res.status;
        if (!res.ok) continue;
        if (!(res.headers.get('content-type') ?? '').includes('json')) continue;
        const data = await res.json();
        return { ok: true, status: res.status, products: data.products ?? [], count: data.count ?? 0 };
    }
    return { ok: false, status: ultimo, products: [], count: 0 };
}

/**
 * Genéricos españoles con valores de USDA FoodData Central (CC0).
 *
 * Cubren el hueco grande de OFF: fresco. El catálogo vivo de Mercadona tiene
 * CUATRO productos de fruta y verdura y la carne cruza al 3,8 %, así que sin
 * esta capa el usuario no puede apuntar «pechuga de pollo» ni «manzana».
 *
 * Los nombres están en español a mano: USDA está en inglés y traducir 8 000
 * fichas automáticamente produciría nombres que nadie busca. Se prefiere una
 * lista corta y bien nombrada a una larga e inutilizable.
 * @type {Array<[string, number, number, number, number, string]>}
 */
const GENERICOS = [
    // nombre, kcal, proteína, hidratos, grasa, categoría
    ['Pechuga de pollo cruda', 120, 22.5, 0, 2.6, 'carne'],
    ['Muslo de pollo crudo', 121, 19.3, 0, 4.3, 'carne'],
    ['Pavo, pechuga cruda', 111, 24.6, 0, 1.0, 'carne'],
    ['Ternera magra cruda', 143, 21.2, 0, 5.9, 'carne'],
    ['Cerdo, lomo crudo', 143, 21.4, 0, 5.7, 'carne'],
    ['Huevo entero crudo', 143, 12.6, 0.7, 9.5, 'huevos'],
    ['Clara de huevo', 52, 10.9, 0.7, 0.2, 'huevos'],
    ['Salmón crudo', 208, 20.4, 0, 13.4, 'pescado'],
    ['Merluza cruda', 90, 17.8, 0, 1.8, 'pescado'],
    ['Atún al natural, escurrido', 116, 25.5, 0, 0.8, 'pescado'],
    ['Gambas crudas', 85, 20.1, 0.9, 0.5, 'pescado'],
    ['Arroz blanco crudo', 365, 7.1, 80, 0.7, 'despensa'],
    ['Arroz integral crudo', 370, 7.9, 77.2, 2.9, 'despensa'],
    ['Pasta seca', 371, 13.0, 74.7, 1.5, 'despensa'],
    ['Avena en copos', 389, 16.9, 66.3, 6.9, 'despensa'],
    ['Pan blanco', 265, 9.0, 49.0, 3.2, 'panaderia'],
    ['Pan integral', 247, 13.0, 41.0, 3.5, 'panaderia'],
    ['Lentejas secas', 353, 25.8, 60.1, 1.1, 'despensa'],
    ['Garbanzos secos', 364, 19.3, 60.6, 6.0, 'despensa'],
    ['Alubias blancas secas', 333, 23.4, 60.3, 0.8, 'despensa'],
    ['Patata cruda', 77, 2.0, 17.5, 0.1, 'verdura'],
    ['Boniato crudo', 86, 1.6, 20.1, 0.1, 'verdura'],
    ['Brócoli crudo', 34, 2.8, 6.6, 0.4, 'verdura'],
    ['Espinacas crudas', 23, 2.9, 3.6, 0.4, 'verdura'],
    ['Tomate crudo', 18, 0.9, 3.9, 0.2, 'verdura'],
    ['Cebolla cruda', 40, 1.1, 9.3, 0.1, 'verdura'],
    ['Pimiento rojo crudo', 31, 1.0, 6.0, 0.3, 'verdura'],
    ['Calabacín crudo', 17, 1.2, 3.1, 0.3, 'verdura'],
    ['Zanahoria cruda', 41, 0.9, 9.6, 0.2, 'verdura'],
    ['Lechuga', 15, 1.4, 2.9, 0.2, 'verdura'],
    ['Champiñones crudos', 22, 3.1, 3.3, 0.3, 'verdura'],
    ['Manzana', 52, 0.3, 13.8, 0.2, 'fruta'],
    ['Plátano', 89, 1.1, 22.8, 0.3, 'fruta'],
    ['Naranja', 47, 0.9, 11.8, 0.1, 'fruta'],
    ['Fresas', 32, 0.7, 7.7, 0.3, 'fruta'],
    ['Arándanos', 57, 0.7, 14.5, 0.3, 'fruta'],
    ['Aguacate', 160, 2.0, 8.5, 14.7, 'fruta'],
    ['Kiwi', 61, 1.1, 14.7, 0.5, 'fruta'],
    ['Uvas', 69, 0.7, 18.1, 0.2, 'fruta'],
    ['Melón', 34, 0.8, 8.2, 0.2, 'fruta'],
    ['Sandía', 30, 0.6, 7.6, 0.2, 'fruta'],
    ['Aceite de oliva virgen extra', 884, 0, 0, 100, 'despensa'],
    ['Almendras crudas', 579, 21.2, 21.6, 49.9, 'despensa'],
    ['Nueces', 654, 15.2, 13.7, 65.2, 'despensa'],
    ['Cacahuetes', 567, 25.8, 16.1, 49.2, 'despensa'],
    ['Leche entera', 61, 3.2, 4.8, 3.3, 'lacteos'],
    ['Leche desnatada', 34, 3.4, 5.0, 0.1, 'lacteos'],
    ['Yogur natural', 61, 3.5, 4.7, 3.3, 'lacteos'],
    ['Queso fresco batido 0 %', 47, 8.0, 4.0, 0.2, 'lacteos'],
    ['Queso curado', 393, 24.9, 1.3, 32.1, 'lacteos'],
    ['Tofu firme', 144, 15.8, 4.3, 8.7, 'despensa'],
    ['Lentejas cocidas', 116, 9.0, 20.1, 0.4, 'despensa'],
    ['Garbanzos cocidos', 164, 8.9, 27.4, 2.6, 'despensa'],
    ['Arroz blanco cocido', 130, 2.7, 28.2, 0.3, 'despensa'],
    ['Pasta cocida', 131, 5.0, 25.0, 1.1, 'despensa'],
    ['Patata cocida', 87, 1.9, 20.1, 0.1, 'verdura']
];

/** @returns {Array<Record<string, *>>} */
function genericos() {
    /** @type {Array<Record<string, *>>} */ const out = [];
    for (const [nombre, k, p, c, f, cat] of GENERICOS) {
        const id = `usda:${nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
        const food = { id, n: nombre, k, p, c, f, cat, src: 'usda' };
        const sane = sanityCheck(food);
        if (!sane.ok) {
            console.warn(`  genérico descartado (${sane.reason}): ${nombre}`);
            continue;
        }
        out.push(food);
    }
    return out;
}

/**
 * Consultas con las que se recorre el catálogo.
 *
 * La API tiene TECHO DURO de 1 000 resultados por consulta (con page_size=50,
 * la página 21 ya no llega). Los 11 581 Hacendado no caben en una sola. Se
 * trocea por categoría: cada rodaja tiene su propio techo de 1 000, y las
 * categorías elegidas son las que de verdad se comen a diario. La primera
 * consulta, sin filtro, trae lo más relevante según el orden de OFF.
 * @type {Array<[string, string]>}
 */
const CONSULTAS = [
    ['general', ''],
    ['lácteos', '&categories_tags=en:dairies'],
    ['carne', '&categories_tags=en:meats'],
    ['pescado', '&categories_tags=en:seafood'],
    ['cereales', '&categories_tags=en:cereals-and-potatoes'],
    ['legumbres', '&categories_tags=en:legumes'],
    ['verdura', '&categories_tags=en:vegetables'],
    ['fruta', '&categories_tags=en:fruits'],
    ['bebidas', '&categories_tags=en:beverages'],
    ['congelados', '&categories_tags=en:frozen-foods'],
    ['salsas', '&categories_tags=en:sauces'],
    ['desayuno', '&categories_tags=en:breakfasts']
];

async function main() {
    const limite = Number(process.argv[process.argv.indexOf('--limite') + 1]) || 2000;
    /** @type {Map<string, Record<string, *>>} */ const marcas = new Map();
    /** @type {Record<string, number>} */ const descartes = {};
    let vistos = 0;

    for (const [etiqueta, filtro] of CONSULTAS) {
        if (marcas.size >= limite) break;
        let antes = marcas.size;
        for (let page = 1; page <= 20 && marcas.size < limite; page++) {
            const r = await fetchPage(page, filtro);
            if (!r.ok) { console.warn(`  ${etiqueta} p${page}: HTTP ${r.status}, se corta la rodaja`); break; }
            if (r.products.length === 0) break;
            for (const raw of r.products) {
                vistos += 1;
                const norm = fromOpenFoodFacts(raw);
                if (!norm.ok) { descartes[norm.reason] = (descartes[norm.reason] ?? 0) + 1; continue; }
                // Las rodajas se solapan: el mapa por id deduplica sin contar dos veces.
                marcas.set(norm.value.id, norm.value);
            }
        }
        console.log(`  ${etiqueta.padEnd(12)} +${marcas.size - antes} (total ${marcas.size})`);
    }

    // Sin duplicados por EAN.
    /** @type {Map<string, Record<string, *>>} */ const porId = new Map();
    for (const f of [...genericos(), ...marcas.values()]) porId.set(f.id, f);
    const foods = [...porId.values()].sort((a, b) => a.n.localeCompare(b.n, 'es'));

    const payload = {
        // ODbL exige atribución y que la base derivada se publique bajo ODbL.
        // Queda dicho aquí, en los propios datos, para que viaje con ellos.
        sources: [
            { src: 'usda', name: 'USDA FoodData Central', license: 'CC0 1.0' },
            { src: 'off', name: 'Open Food Facts', license: 'ODbL 1.0', url: 'https://openfoodfacts.org' }
        ],
        foods
    };
    const destino = join(ROOT, 'vendor/data/foods.json');
    writeFileSync(destino, JSON.stringify(payload));
    const bytes = readFileSync(destino).length;

    const porFuente = foods.reduce((/** @type {*} */ acc, f) => {
        acc[f.src] = (acc[f.src] ?? 0) + 1; return acc;
    }, {});
    console.log(`${foods.length} alimentos · ${Math.round(bytes / 1024)} KB → ${destino}`);
    console.log('  por procedencia:', porFuente);
    console.log('  descartados por el saneador:', descartes);
    const total = vistos || 1;
    const tirados = Object.values(descartes).reduce((a, b) => a + b, 0);
    console.log(`  criba: ${tirados}/${vistos} (${Math.round((tirados / total) * 100)} %)`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
    main().catch((err) => { console.error(err); process.exit(1); });
}

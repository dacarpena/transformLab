// @ts-check

/**
 * Alimentos: búsqueda, escalado y agregación (V2-M2). Módulo PURO.
 *
 * No toca IndexedDB ni el DOM: recibe la lista de alimentos y devuelve
 * respuestas. Eso lo hace probable desde Node, que es la razón por la que este
 * módulo existe separado de `src/data/foods-db.js`.
 *
 * LA PROCEDENCIA MANDA. Cada alimento lleva `src`, igual que cada dato de
 * músculo lleva `muscleSource` (A3), y por el mismo motivo: la v4.0 se hundió
 * mezclando cantidades de origen distinto bajo un nombre común. Aquí hay tres
 * orígenes con garantías muy distintas:
 *
 *   'usda' genéricos de USDA FoodData Central (CC0), curados a mano con nombre
 *          español. Es lo más fiable que hay y cubre el fresco.
 *   'off'  productos de marca de Open Food Facts (ODbL). Los sube la comunidad
 *          desde la etiqueta: buenos de media, con erratas ocasionales, y con
 *          códigos que Mercadona rota cada temporada.
 *   'user' lo que teclee el usuario. No es de fiar para nada más que para él.
 *
 * El invariante `solo_verificado` impone que solo los dos primeros alimenten
 * cálculos del motor. `user` se registra y se muestra, pero no se promociona a
 * verdad.
 *
 * LAS UNIDADES. Todo lo empaquetado es «por 100 g» — es como viene el etiquetado
 * europeo y como viene USDA. Los mililitros se tratan como gramos a propósito y
 * con la mentira declarada: la leche pesa 1,03 g/ml y el aceite 0,92, así que el
 * error es del orden del 3–8 %, muy por debajo de la variación real entre el
 * envase y lo que uno se sirve. Mantener densidades por alimento sería precisión
 * fingida.
 */

/** Orígenes cuyos datos pueden alimentar cálculos del motor. */
export const TRUSTED_SOURCES = Object.freeze(['usda', 'off']);

/** Gramos a los que están referidos los macros de un alimento. */
export const REFERENCE_GRAMS = 100;

/**
 * @typedef {Object} Food
 * @property {string} id
 * @property {string} n nombre
 * @property {string} [b] marca
 * @property {number} k kcal/100 g
 * @property {number} p proteína g/100 g
 * @property {number} c hidratos g/100 g
 * @property {number} f grasa g/100 g
 * @property {[number, 'g'|'ml']} [q] formato del envase
 * @property {string} [cat] pasillo de la tienda («dónde está»)
 * @property {string} [diet] origen alimentario («de qué viene»): meat|fish|dairy|egg|plant
 * @property {string} [prep] 'cooked' si la ficha es del alimento YA cocinado
 * @property {string} [e] EAN
 * @property {string[]} [a] alérgenos
 * @property {'usda'|'off'|'user'} src
 */

/**
 * @typedef {Object} Macros
 * @property {number} kcal
 * @property {number} proteinG
 * @property {number} carbsG
 * @property {number} fatG
 */

/**
 * ¿Puede este alimento alimentar un cálculo del motor?
 * @param {{ src?: string } | null | undefined} food
 * @returns {boolean}
 */
export function isTrusted(food) {
    return TRUSTED_SOURCES.includes(String(food?.src ?? ''));
}

/**
 * Normaliza un texto para buscar: minúsculas, sin tildes, sin puntuación.
 *
 * Sin quitar tildes, «platano» no encuentra «plátano», que es exactamente lo que
 * teclea cualquiera con prisa. Se aplica igual al índice y a la consulta, así
 * que la comparación es simétrica.
 * @param {unknown} text
 * @returns {string}
 */
export function normalize(text) {
    return String(text ?? '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9\s]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Puntuación de un alimento frente a una consulta ya normalizada.
 *
 * TODOS los términos deben aparecer (AND, no OR): buscar «yogur proteinas» y
 * recibir todos los yogures del mundo no sirve de nada. La puntuación premia,
 * por este orden, que la coincidencia empiece la palabra, que sea el nombre
 * entero, y que el alimento sea un genérico verificado — porque quien escribe
 * «pollo» quiere el pollo, no la lasaña de pollo de una marca.
 * @param {Food} food
 * @param {string[]} terms
 * @returns {number} 0 = no coincide
 */
function scoreOf(food, terms) {
    const haystack = normalize(`${food.n} ${food.b ?? ''}`);
    let score = 0;
    for (const term of terms) {
        const at = haystack.indexOf(term);
        if (at < 0) return 0;
        // Empezar palabra vale más que aparecer en medio de una.
        const startsWord = at === 0 || haystack[at - 1] === ' ';
        score += startsWord ? 10 : 3;
        if (at === 0) score += 5;
    }
    if (haystack === terms.join(' ')) score += 30;
    // Los genéricos verificados por delante de las marcas comunitarias.
    if (food.src === 'usda') score += 12;
    else if (food.src === 'off') score += 2;
    // A igualdad, el nombre más corto es el más genérico y el más probable.
    score -= Math.min(8, normalize(food.n).length / 12);
    return score;
}

/**
 * Busca alimentos por nombre.
 *
 * @param {Food[]} foods
 * @param {string} query
 * @param {{ limit?: number, aisle?: string, sources?: readonly string[] }} [options]
 * @returns {Food[]} ordenados por relevancia
 */
export function search(foods, query, options = {}) {
    const terms = normalize(query).split(' ').filter(Boolean);
    if (terms.length === 0) return [];
    const limit = Number.isFinite(options.limit) ? /** @type {number} */ (options.limit) : 30;
    const sources = options.sources;

    /** @type {Array<{ food: Food, score: number }>} */ const hits = [];
    for (const food of Array.isArray(foods) ? foods : []) {
        if (options.aisle && food.cat !== options.aisle) continue;
        if (sources && !sources.includes(food.src)) continue;
        const score = scoreOf(food, terms);
        if (score > 0) hits.push({ food, score });
    }
    hits.sort((a, b) => (b.score - a.score) || a.food.n.localeCompare(b.food.n, 'es'));
    return hits.slice(0, Math.max(0, limit)).map((h) => h.food);
}

/**
 * Macros de una cantidad concreta de un alimento.
 *
 * Devuelve ceros ante entrada absurda en vez de `NaN`: un NaN se propaga
 * silenciosamente por toda la suma del día y aparece como «NaN kcal» tres
 * pantallas más allá, donde ya no se sabe de dónde salió.
 *
 * @param {Food | null | undefined} food
 * @param {number} grams
 * @returns {Macros}
 */
export function scaleFood(food, grams) {
    const g = Number.isFinite(grams) && grams > 0 ? grams : 0;
    const factor = g / REFERENCE_GRAMS;
    const num = (/** @type {unknown} */ v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    return {
        kcal: round1(num(food?.k) * factor),
        proteinG: round1(num(food?.p) * factor),
        carbsG: round1(num(food?.c) * factor),
        fatG: round1(num(food?.f) * factor)
    };
}

/** @param {number} v @returns {number} */
function round1(v) {
    return Math.round(v * 10) / 10;
}

/** @returns {Macros} */
export function zeroMacros() {
    return { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 };
}

/**
 * Suma macros. Redondea SOLO al final: redondear en cada paso acumula el sesgo
 * y hace que veinte ingredientes de 0,04 g de grasa sumen 0 en vez de 0,8.
 * @param {Macros[]} list
 * @returns {Macros}
 */
export function sumMacros(list) {
    const total = zeroMacros();
    for (const m of Array.isArray(list) ? list : []) {
        total.kcal += Number.isFinite(m?.kcal) ? m.kcal : 0;
        total.proteinG += Number.isFinite(m?.proteinG) ? m.proteinG : 0;
        total.carbsG += Number.isFinite(m?.carbsG) ? m.carbsG : 0;
        total.fatG += Number.isFinite(m?.fatG) ? m.fatG : 0;
    }
    return {
        kcal: round1(total.kcal),
        proteinG: round1(total.proteinG),
        carbsG: round1(total.carbsG),
        fatG: round1(total.fatG)
    };
}

/**
 * @typedef {Object} Ingredient
 * @property {string} name
 * @property {number} quantity
 * @property {string} unit
 * @property {string} [foodId]
 */

/**
 * Clave de fusión de dos ingredientes.
 *
 * Se fusionan por `foodId` cuando lo hay, y si no por nombre normalizado. La
 * unidad forma parte de la clave SIEMPRE: 200 g de tomate y 2 unidades de tomate
 * no se pueden sumar sin saber lo que pesa un tomate, y ese dato no lo tenemos.
 * Fusionarlos daría «202» de algo.
 * @param {Ingredient} ing
 * @returns {string}
 */
export function mergeKey(ing) {
    const unit = normalize(ing?.unit) || 'g';
    const id = String(ing?.foodId ?? '').trim();
    return id !== '' ? `id:${id}|${unit}` : `n:${normalize(ing?.name)}|${unit}`;
}

/**
 * Agrega una lista de ingredientes fusionando los repetidos.
 *
 * INVARIANTE `agregacion_conserva`: la cantidad total por (alimento, unidad) es
 * exactamente la misma antes y después. Es lo que impide que la lista de la
 * compra de V2-M4 pida dos veces el mismo arroz, o —peor— que pida menos del
 * que hace falta.
 *
 * @param {Ingredient[]} ingredients
 * @returns {Ingredient[]}
 */
export function aggregate(ingredients) {
    /** @type {Map<string, Ingredient>} */ const merged = new Map();
    for (const ing of Array.isArray(ingredients) ? ingredients : []) {
        const qty = Number.isFinite(ing?.quantity) ? ing.quantity : 0;
        const key = mergeKey(ing);
        const prev = merged.get(key);
        if (prev) {
            prev.quantity = round1(prev.quantity + qty);
            // Un foodId conocido gana sobre la ausencia: si una de las dos
            // apariciones sabe qué alimento es, la fusión lo sabe.
            if (!prev.foodId && ing.foodId) prev.foodId = ing.foodId;
        } else {
            /** @type {Ingredient} */ const copia = {
                name: String(ing?.name ?? ''),
                quantity: round1(qty),
                unit: String(ing?.unit ?? 'g')
            };
            if (ing?.foodId) copia.foodId = String(ing.foodId);
            merged.set(key, copia);
        }
    }
    return [...merged.values()];
}

/**
 * Macros de una receta: total y por ración.
 *
 * Los ingredientes SIN `foodId`, o con una unidad que no sabemos convertir a
 * gramos, se devuelven en `unknown` en vez de contarse como cero. La diferencia
 * importa: un total que ignora en silencio la mitad de los ingredientes es un
 * total falso, y el usuario planificaría sobre él.
 *
 * @param {{ servings?: number, ingredients?: Ingredient[] }} recipe
 * @param {Record<string, Food>} index alimentos por id
 * @returns {{ total: Macros, perServing: Macros, unknown: string[], covered: number, count: number }}
 */
export function recipeMacros(recipe, index) {
    const servings = Number.isFinite(recipe?.servings) && /** @type {number} */ (recipe.servings) > 0
        ? /** @type {number} */ (recipe.servings)
        : 1;
    const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
    /** @type {Macros[]} */ const parts = [];
    /** @type {string[]} */ const unknown = [];

    for (const ing of ingredients) {
        const food = ing?.foodId ? index?.[ing.foodId] : undefined;
        const unit = normalize(ing?.unit);
        const enGramos = unit === 'g' || unit === 'gr' || unit === 'gramos' || unit === 'ml';
        if (!food || !isTrusted(food) || !enGramos) {
            unknown.push(String(ing?.name ?? ''));
            continue;
        }
        parts.push(scaleFood(food, Number(ing.quantity)));
    }

    const total = sumMacros(parts);
    const perServing = {
        kcal: round1(total.kcal / servings),
        proteinG: round1(total.proteinG / servings),
        carbsG: round1(total.carbsG / servings),
        fatG: round1(total.fatG / servings)
    };
    return { total, perServing, unknown, covered: parts.length, count: ingredients.length };
}

/**
 * Qué cubre la base, para poder DECIRLO.
 *
 * INVARIANTE `cobertura_declarada`. La v4.0 presentaba estimaciones como
 * certezas; aquí la interfaz tiene que poder escribir «la base trae 56 genéricos
 * y 1 944 productos de Mercadona; el fresco de marca y los precios van a mano».
 * Fingir exhaustividad es peor que declarar el hueco.
 *
 * @param {Food[]} foods
 * @returns {{ total: number, bySource: Record<string, number>, byAisle: Record<string, number>, withEan: number }}
 */
export function coverage(foods) {
    /** @type {Record<string, number>} */ const bySource = {};
    /** @type {Record<string, number>} */ const byAisle = {};
    let withEan = 0;
    const list = Array.isArray(foods) ? foods : [];
    for (const food of list) {
        const src = String(food?.src ?? 'user');
        bySource[src] = (bySource[src] ?? 0) + 1;
        const cat = String(food?.cat ?? 'other');
        byAisle[cat] = (byAisle[cat] ?? 0) + 1;
        if (food?.e) withEan += 1;
    }
    return { total: list.length, bySource, byAisle, withEan };
}

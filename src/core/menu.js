// @ts-check

/**
 * El menú del día: rellenar con comida las macros que ya fijó el motor (V2-M3).
 *
 * ES UN SOLVER COMBINATORIO, NO UN MODELO NI «IA». Recibe unas macros objetivo
 * —ya derivadas en `src/core/nutrition.js` a partir de la fase— y busca
 * alimentos y gramajes que caigan dentro de sus bandas. **Nunca recalcula las
 * calorías** (B3): si el plan dice 2 100 kcal, el menú rellena 2 100 kcal. Un
 * módulo de menú que recalcula el objetivo acaba discutiendo con el motor, y
 * gana el que se pinte último.
 *
 * LA JERARQUÍA DE RESTRICCIONES ES LO QUE HACE QUE EXISTA SOLUCIÓN. Dos niveles,
 * y la diferencia no es de matiz:
 *
 *   DURAS  alergias, tipo de dieta, suelo de proteína. No se violan jamás. Si no
 *          hay menú posible respetándolas, se dice — no se sirve algo que las
 *          incumple «un poquito».
 *   BLANDAS lo que al usuario no le gusta. Se PENALIZAN, no se prohíben. Meterlo
 *          todo como duro deja el problema sin solución factible y produce
 *          combinaciones absurdas: es el riesgo que más veces hunde a un
 *          planificador de comidas.
 *
 * DETERMINISTA POR SEMILLA DEL PERFIL. Mismo perfil, mismo día, mismo menú. Sin
 * esto, cada repintado propondría una comida distinta y la lista de la compra de
 * V2-M4 no valdría para nada. Por eso el menú NO se persiste: se regenera, igual
 * que la proyección.
 */

import { mulberry32 } from './rng.js';
import { scaleFood, sumMacros, isTrusted, normalize } from './foods.js';

/**
 * Tolerancia de cada macro, como fracción del objetivo.
 *
 * Las calorías son la banda estrecha porque son la magnitud que gobierna el
 * resultado (B3); los hidratos, la ancha, porque son el macro de relleno y
 * absorben el resto del ajuste. No son cifras sagradas: son la tolerancia con la
 * que un menú real se puede montar sin pesar el arroz al gramo.
 */
export const MACRO_BANDS = Object.freeze({
    kcal: 0.07,
    proteinG: 0.12,
    carbsG: 0.20,
    fatG: 0.20
});

/**
 * Suelo DURO de proteína, como fracción del objetivo.
 *
 * Es la única macro con un suelo fisiológico real que defender: en déficit, la
 * proteína es lo que protege el tejido magro, que es justamente lo que este
 * proyecto proyecta. Quedarse corto de hidratos un día no tiene consecuencia;
 * quedarse corto de proteína durante una definición, sí.
 */
export const PROTEIN_FLOOR_RATIO = 0.9;

/** Gramajes con los que una comida sigue siendo una comida y no una broma. */
export const PORTION_MIN_G = 20;
export const PORTION_MAX_G = 400;

/** Ración fija de verdura por comida: aporta volumen y micros, no macros. */
export const VEG_PORTION_G = 120;

/**
 * Orígenes que cada dieta excluye. **Del campo `diet`, NO del pasillo.**
 *
 * Filtrar por pasillo era un defecto real y de la peor familia: `cat` contesta
 * «dónde está en la tienda» y aquí hace falta «de qué viene». Unas gambas
 * congeladas están en el pasillo de CONGELADOS, así que el filtro vegano se las
 * servía tan tranquilo. Es el mismo error que hundió la v4.0 con la palabra
 * «músculo»: un campo haciendo dos trabajos distintos.
 *
 * El filtro es DURO y conservador: bajo una dieta restrictiva, un alimento de
 * origen DESCONOCIDO también queda fuera. Las categorías de Open Food Facts las
 * sube la comunidad y se equivocan; ante la duda, un vegano prefiere menos
 * opciones a un marisco. Los genéricos de USDA llevan su origen escrito a mano,
 * así que la despensa básica sigue completa.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const DIET_EXCLUDED_ORIGINS = Object.freeze({
    omnivore: Object.freeze([]),
    pescatarian: Object.freeze(['meat']),
    vegetarian: Object.freeze(['meat', 'fish']),
    vegan: Object.freeze(['meat', 'fish', 'dairy', 'egg'])
});

/**
 * Pasillos de los que puede salir cada papel de la comida.
 *
 * ESTO NO ES NUTRICIÓN, ES SENTIDO COMÚN, y hace falta. Sin el filtro, el solver
 * cuadraba las macros con **miel de flores de fuente de hidratos, postre
 * gelificado de fresa de guarnición y caldo cocido de verdura**: aritméticamente
 * impecable, y nadie se lo come. La causa es que ordenar por pureza de macro
 * premia justo a los alimentos extremos — el azúcar es hidrato al 100 %.
 *
 * El pasillo sí sirve para esto, porque es literalmente su pregunta: los básicos
 * con los que se cocina viven en unos pasillos y los caprichos en otros. Bebidas
 * y precocinados quedan fuera de todos los papeles.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const ROLE_AISLES = Object.freeze({
    protein: Object.freeze(['carne', 'pescado', 'huevos', 'lacteos', 'despensa', 'congelados']),
    carb: Object.freeze(['despensa', 'panaderia', 'verdura', 'fruta']),
    fat: Object.freeze(['despensa', 'lacteos', 'snacks']),
    veg: Object.freeze(['verdura', 'fruta'])
});

/**
 * @typedef {import('./foods.js').Food} Food
 * @typedef {import('./foods.js').Macros} Macros
 * @typedef {'protein'|'carb'|'fat'|'veg'|'mixed'} FoodRole
 */

/** Reparto energético de un alimento entre sus tres macros. */
function energyShares(/** @type {Food} */ food) {
    const p = Math.max(0, food.p) * 4;
    const c = Math.max(0, food.c) * 4;
    const f = Math.max(0, food.f) * 9;
    const total = p + c + f;
    if (total <= 0) return { p: 0, c: 0, f: 0, total: 0 };
    return { p: p / total, c: c / total, f: f / total, total };
}

/**
 * Qué papel juega un alimento en una comida.
 *
 * Se decide por el reparto ENERGÉTICO, no por los gramos: 100 g de aceite son
 * 100 g de grasa pero también 884 kcal, y 100 g de brócoli son 34. Clasificar
 * por gramos pondría la lechuga y el pollo en la misma casilla.
 *
 * @param {Food} food
 * @returns {FoodRole}
 */
export function roleOf(food) {
    if (!food || typeof food !== 'object') return 'mixed';
    const s = energyShares(food);
    if (s.total === 0) return 'mixed';
    // La verdura se define por DENSIDAD y solo por densidad. Exigirle además un
    // reparto de hidratos dejaba a la rúcula —26 kcal y 4,3 g de proteína— en el
    // grupo de las fuentes proteicas, y el solver la ofrecía de plato principal.
    // Ningún alimento de 60 kcal por 100 g puede anclar una comida.
    if (food.k <= 60) return 'veg';
    if (s.p >= 0.4) return 'protein';
    if (s.f >= 0.6) return 'fat';
    if (s.c >= 0.55) return 'carb';
    return 'mixed';
}

/**
 * @typedef {Object} Preferences
 * @property {string[]} [hardExclusions] alérgenos y vetos absolutos
 * @property {string[]} [softExclusions] lo que no gusta; penaliza, no prohíbe
 * @property {string} [dietType]
 */

/**
 * ¿Puede este alimento entrar en el menú?
 * @param {Food} food
 * @param {Preferences} preferences
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function isAllowed(food, preferences) {
    // Solo lo verificado alimenta cálculos (invariante `solo_verificado` de
    // V2-M2): lo que teclee el usuario no se le sirve como si fuera dato.
    if (!isTrusted(food)) return { ok: false, reason: 'menu.untrusted' };

    const hard = (preferences?.hardExclusions ?? []).map(normalize).filter(Boolean);
    if (hard.length > 0) {
        const haystack = normalize(`${food.n} ${food.b ?? ''}`);
        const allergens = (food.a ?? []).map(normalize);
        for (const term of hard) {
            if (allergens.includes(term)) return { ok: false, reason: 'menu.allergen' };
            if (haystack.includes(term)) return { ok: false, reason: 'menu.excluded' };
        }
    }

    const diet = String(preferences?.dietType ?? 'omnivore');
    const banned = DIET_EXCLUDED_ORIGINS[diet] ?? DIET_EXCLUDED_ORIGINS.omnivore;
    if (banned.length > 0) {
        if (food.diet === undefined) return { ok: false, reason: 'menu.unknownOrigin' };
        if (banned.includes(food.diet)) return { ok: false, reason: 'menu.dietType' };
    }
    return { ok: true };
}

/**
 * Reparte el catálogo en los cuatro papeles, ya filtrado por las duras.
 *
 * Los blandos NO se quitan: se ordenan al final. Quitarlos sería convertir en
 * dura una restricción que el usuario declaró como preferencia, y es como se
 * llega a «no hay solución» por gusto propio.
 *
 * @param {Food[]} foods
 * @param {Preferences} preferences
 * @returns {{ pools: Record<FoodRole, Food[]>, excluded: Record<string, number> }}
 */
export function candidatePool(foods, preferences) {
    /** @type {Record<string, Food[]>} */
    const pools = { protein: [], carb: [], fat: [], veg: [], mixed: [] };
    /** @type {Record<string, number>} */ const excluded = {};
    const soft = (preferences?.softExclusions ?? []).map(normalize).filter(Boolean);

    for (const food of Array.isArray(foods) ? foods : []) {
        const allowed = isAllowed(food, preferences);
        if (!allowed.ok) {
            excluded[allowed.reason] = (excluded[allowed.reason] ?? 0) + 1;
            continue;
        }
        const role = roleOf(food);
        // El pasillo decide si el alimento puede hacer ESE papel. Sin ello
        // entraban la miel de hidrato y el caldo de verdura.
        const permitidos = ROLE_AISLES[role];
        if (permitidos && !permitidos.includes(String(food.cat))) {
            excluded['menu.wrongAisleForRole'] = (excluded['menu.wrongAisleForRole'] ?? 0) + 1;
            continue;
        }
        pools[role].push(food);
    }

    const disliked = (/** @type {Food} */ food) => {
        const haystack = normalize(`${food.n} ${food.b ?? ''}`);
        return soft.some((term) => haystack.includes(term)) ? 1 : 0;
    };

    /**
     * Calidad de un alimento PARA SU PAPEL, de 0 a 1.
     *
     * No es un adorno del orden: es lo que hace que el solver encuentre
     * solución. Una fuente proteica floja (8 g/100 g) no llega al suelo de
     * proteína ni a 400 g por comida, así que un grupo ordenado por id deja al
     * vegano sin menú posible mientras el tofu y las legumbres esperan al final
     * de la lista.
     * @param {Food} food @param {string} role
     */
    const quality = (food, role) => {
        const s = energyShares(food);
        if (role === 'protein') return s.p;
        if (role === 'carb') return s.c;
        if (role === 'fat') return s.f;
        // La verdura vale más cuanto menos aporta: su papel es llenar el plato.
        if (role === 'veg') return 1 - Math.min(1, food.k / 100);
        return 0;
    };

    for (const role of Object.keys(pools)) {
        // Estable y determinista. El orden de los criterios importa:
        //
        // 1. Lo que no disgusta, primero (la restricción blanda).
        // 2. **Los genéricos por delante de las marcas**, y esto va ANTES que
        //    la calidad de macro a propósito: los 56 genéricos son justamente
        //    los básicos de una cocina —pollo, arroz, lentejas, brócoli, aceite
        //    de oliva— y son con los que se cocina de verdad. Poner la pureza
        //    de macro primero es lo que hacía ganar a la miel.
        // 3. Ya dentro de cada grupo, lo mejor para su papel.
        pools[role].sort((a, b) =>
            disliked(a) - disliked(b)
            || (a.src === 'usda' ? 0 : 1) - (b.src === 'usda' ? 0 : 1)
            || quality(b, role) - quality(a, role)
            || a.id.localeCompare(b.id));
    }
    return { pools: /** @type {Record<FoodRole, Food[]>} */ (pools), excluded };
}

/** @param {number} v @param {number} lo @param {number} hi */
function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
}

/** Gramos por 100 g de un macro, con suelo para no dividir por casi cero. */
function per100(/** @type {number} */ value) {
    return Math.max(0.5, Number.isFinite(value) ? value : 0);
}

/**
 * Gramajes que acercan una selección de alimentos a las macros de una comida.
 *
 * Resolución en dos tiempos: un reparto secuencial (proteína → hidratos → grasa,
 * descontando en cada paso lo que ya aportan los anteriores) y después unas
 * pasadas de ajuste sobre el residuo. No es un óptimo global —el problema es
 * entero y con cotas— pero converge, es determinista y da porciones que una
 * persona reconoce como una comida.
 *
 * @param {{ protein: Food, carb: Food, fat: Food, veg?: Food | null }} picks
 * @param {{ kcal: number, proteinG: number, carbsG: number, fatG: number }} target
 * @returns {Array<{ food: Food, grams: number, macros: Macros }>}
 */
export function solvePortions(picks, target) {
    const veg = picks.veg ?? null;
    /** @type {Record<string, number>} */
    const grams = { veg: veg ? VEG_PORTION_G : 0, protein: 0, carb: 0, fat: 0 };

    const contribution = (/** @type {Food|null} */ food, /** @type {number} */ g, /** @type {'p'|'c'|'f'} */ macro) =>
        (food ? (food[macro] * g) / 100 : 0);

    // 1) Proteína: la fija el alimento proteico, descontando lo que ya trae la
    //    verdura.
    grams.protein = clamp(
        ((target.proteinG - contribution(veg, grams.veg, 'p')) * 100) / per100(picks.protein.p),
        PORTION_MIN_G, PORTION_MAX_G
    );
    // 2) Hidratos: lo que falta tras proteína y verdura.
    const carbsYa = contribution(veg, grams.veg, 'c') + contribution(picks.protein, grams.protein, 'c');
    grams.carb = clamp(((target.carbsG - carbsYa) * 100) / per100(picks.carb.c), PORTION_MIN_G, PORTION_MAX_G);
    // 3) Grasa: lo que falta tras los tres anteriores. La grasa suele venir en
    //    aceites, así que su porción es pequeña y su cota mínima, más baja.
    //
    //    Y AQUÍ VA LA PIEZA QUE FALTABA: si los otros alimentos YA cubren la
    //    grasa —un salmón, un queso, unos frutos secos—, el aceite no se añade.
    //    Añadirlo igual, con el mínimo de 5 g, disparaba la grasa un 30 % por
    //    encima de la banda mientras las otras tres macros cuadraban al 1 %.
    const fatYa = contribution(veg, grams.veg, 'f')
        + contribution(picks.protein, grams.protein, 'f')
        + contribution(picks.carb, grams.carb, 'f');
    const fatHueco = target.fatG - fatYa;
    grams.fat = fatHueco <= 1 ? 0 : clamp((fatHueco * 100) / per100(picks.fat.f), 5, 120);

    // 4) Ajuste: mueve cada porción según lo que falte o sobre de SU macro
    //    dominante. Doce pasadas bastan; más no mejora y solo cuesta.
    const orden = /** @type {const} */ ([['protein', 'p'], ['carb', 'c'], ['fat', 'f']]);
    for (let pass = 0; pass < 12; pass++) {
        for (const [rol, macro] of orden) {
            const objetivo = macro === 'p' ? target.proteinG : macro === 'c' ? target.carbsG : target.fatG;
            const actual = contribution(veg, grams.veg, macro)
                + contribution(picks.protein, grams.protein, macro)
                + contribution(picks.carb, grams.carb, macro)
                + contribution(picks.fat, grams.fat, macro);
            const falta = objetivo - actual;
            if (Math.abs(falta) < 0.5) continue;
            const food = rol === 'protein' ? picks.protein : rol === 'carb' ? picks.carb : picks.fat;
            const delta = (falta * 100) / per100(food[macro]);
            const [lo, hi] = rol === 'fat' ? [5, 120] : [PORTION_MIN_G, PORTION_MAX_G];
            grams[rol] = clamp(grams[rol] + delta, lo, hi);
        }
    }

    /** @type {Array<{ food: Food, grams: number, macros: Macros }>} */ const items = [];
    const push = (/** @type {Food|null} */ food, /** @type {number} */ g) => {
        if (!food || g < 1) return;
        const redondeado = Math.round(g / 5) * 5;   // gramajes que se pueden pesar
        if (redondeado < 5) return;
        items.push({ food, grams: redondeado, macros: scaleFood(food, redondeado) });
    };
    push(picks.protein, grams.protein);
    push(picks.carb, grams.carb);
    push(veg, grams.veg);
    push(picks.fat, grams.fat);
    return items;
}

/**
 * ¿Cae este total dentro de las bandas del objetivo?
 * @param {Macros} totals
 * @param {{ kcal: number, proteinG: number, carbsG: number, fatG: number }} target
 * @returns {{ within: boolean, off: Record<string, number> }}
 */
export function withinBands(totals, target) {
    /** @type {Record<string, number>} */ const off = {};
    let within = true;
    for (const macro of /** @type {const} */ (['kcal', 'proteinG', 'carbsG', 'fatG'])) {
        const objetivo = target[macro];
        if (!Number.isFinite(objetivo) || objetivo <= 0) continue;
        const desvio = (totals[macro] - objetivo) / objetivo;
        off[macro] = Math.round(desvio * 1000) / 1000;
        if (Math.abs(desvio) > MACRO_BANDS[macro]) within = false;
    }
    return { within, off };
}

/**
 * Elige un elemento del grupo de forma determinista pero variada.
 *
 * La variedad importa más de lo que parece: sin ella el solver serviría pollo
 * con arroz siete días seguidos, que técnicamente cuadra y nadie sostiene.
 * @template T
 * @param {T[]} pool
 * @param {() => number} rand
 * @param {Set<string>} usados
 * @param {(item: T) => string} idOf
 * @returns {T | null}
 */
function pick(pool, rand, usados, idOf) {
    if (pool.length === 0) return null;
    const ventana = pool.slice(0, Math.min(24, pool.length));
    const libres = ventana.filter((item) => !usados.has(idOf(item)));
    const donde = libres.length > 0 ? libres : ventana;

    // SESGO HACIA LA CABEZA, no sorteo uniforme. La ordenación ya puso delante
    // los básicos; sortear plano dentro de una ventana grande los desperdicia y
    // saca mermelada de fuente de hidratos una comida sí y otra también. Elevar
    // el aleatorio al cuadrado concentra la elección en el primer tercio y deja
    // la cola como variedad ocasional, que es exactamente el reparto que se
    // quiere: arroz casi siempre, algo distinto de vez en cuando.
    const r = rand();
    const elegido = donde[Math.min(donde.length - 1, Math.floor(donde.length * r * r))];
    usados.add(idOf(elegido));
    return elegido;
}

/**
 * Cuántas combinaciones se prueban antes de quedarse con la mejor.
 *
 * Con 24 basta: los intentos son baratos (unas decenas de microsegundos) y en la
 * práctica el primero o el segundo ya cuadra. El techo existe para que un
 * catálogo raro no deje el bucle girando.
 */
export const MAX_ATTEMPTS = 24;

/**
 * Cuánto se sale un total de sus bandas. Cero = dentro de todas.
 *
 * Solo penaliza lo que EXCEDE la banda, y al cuadrado: un menú que se pasa 1 %
 * en tres macros es mejor que uno que se pasa 15 % en una sola, y un desvío que
 * cabe dentro de la tolerancia no debe empujar la búsqueda a ningún lado.
 * @param {Macros} totals
 * @param {{ kcal: number, proteinG: number, carbsG: number, fatG: number }} target
 * @returns {number}
 */
function penaltyOf(totals, target) {
    let penalty = 0;
    for (const macro of /** @type {const} */ (['kcal', 'proteinG', 'carbsG', 'fatG'])) {
        const objetivo = target[macro];
        if (!Number.isFinite(objetivo) || objetivo <= 0) continue;
        const exceso = Math.abs((totals[macro] - objetivo) / objetivo) - MACRO_BANDS[macro];
        if (exceso > 0) penalty += exceso * exceso;
    }
    return penalty;
}

/**
 * @typedef {Object} MenuMeal
 * @property {number} index
 * @property {{ kcal: number, proteinG: number, carbsG: number, fatG: number }} target
 * @property {Array<{ foodId: string, name: string, grams: number, macros: Macros, src: string }>} items
 * @property {Macros} totals
 */

/**
 * Monta el menú del día.
 *
 * @param {{
 *   macros: { kcal: number, proteinG: number, carbsG: number, fatG: number },
 *   mealTargets: Array<{ index: number, kcal: number, proteinG: number, carbsG: number, fatG: number }>,
 *   foods: Food[],
 *   preferences?: Preferences,
 *   seed?: number
 * }} input
 * @returns {{ ok: true, value: { meals: MenuMeal[], totals: Macros, target: *, bands: *, excluded: Record<string, number> } }
 *          | { ok: false, error: string, detail?: Record<string, number> }}
 */
export function buildMenu(input) {
    const target = input?.macros;
    if (!target || !Number.isFinite(target.kcal) || target.kcal <= 0) {
        return { ok: false, error: 'menu.macrosInvalid' };
    }
    const mealTargets = Array.isArray(input?.mealTargets) ? input.mealTargets : [];
    if (mealTargets.length === 0) return { ok: false, error: 'menu.noMeals' };

    const { pools, excluded } = candidatePool(input?.foods ?? [], input?.preferences ?? {});
    // Sin las tres piezas no hay comida que montar, y decirlo es mejor que
    // servir un plato de arroz y llamarlo menú.
    if (pools.protein.length === 0) return { ok: false, error: 'menu.noProteinSource', detail: excluded };
    if (pools.carb.length === 0) return { ok: false, error: 'menu.noCarbSource', detail: excluded };
    if (pools.fat.length === 0) return { ok: false, error: 'menu.noFatSource', detail: excluded };

    const rand = mulberry32(Number.isFinite(input?.seed) ? /** @type {number} */ (input.seed) : 1);

    // BÚSQUEDA LOCAL, y no un solo intento. Una tirada puede sacar un salmón de
    // proteína y unos frutos secos de grasa, cuadrar las kcal y pasarse de grasa
    // un 30 %. Con varias tiradas y quedándose con la mejor, el solver encuentra
    // combinaciones que una sola no ve — que es literalmente su trabajo. El
    // generador de azar es el mismo y va en orden, así que sigue siendo
    // determinista: misma semilla, misma secuencia de intentos, mismo ganador.
    /** @type {{ meals: MenuMeal[], totals: Macros, bands: *, score: number, floorOk: boolean } | null} */
    let best = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        /** @type {Set<string>} */ const usados = new Set();
        /** @type {MenuMeal[]} */ const meals = [];

        for (const mealTarget of mealTargets) {
            const picks = {
                protein: /** @type {Food} */ (pick(pools.protein, rand, usados, (f) => f.id)),
                carb: /** @type {Food} */ (pick(pools.carb, rand, usados, (f) => f.id)),
                fat: /** @type {Food} */ (pick(pools.fat, rand, usados, (f) => f.id)),
                veg: pools.veg.length > 0 ? pick(pools.veg, rand, usados, (f) => f.id) : null
            };
            const items = solvePortions(picks, mealTarget);
            meals.push({
                index: mealTarget.index,
                target: mealTarget,
                items: items.map((it) => ({
                    foodId: it.food.id, name: it.food.n, grams: it.grams, macros: it.macros, src: it.food.src
                })),
                totals: sumMacros(items.map((it) => it.macros))
            });
        }

        const totals = sumMacros(meals.map((m) => m.totals));
        const bands = withinBands(totals, target);
        // SUELO DURO DE PROTEÍNA. En déficit, la proteína protege el tejido
        // magro, que es justo lo que este proyecto proyecta. Un menú que no
        // llega incumple en silencio la restricción que el usuario cree
        // asegurada, así que pesa mil veces más que cualquier desvío de banda.
        const floorOk = totals.proteinG >= target.proteinG * PROTEIN_FLOOR_RATIO;
        const score = penaltyOf(totals, target) + (floorOk ? 0 : 1000);

        if (best === null || score < best.score) best = { meals, totals, bands, score, floorOk };
        if (floorOk && bands.within) break;   // no hay nada mejor que buscar
    }

    const elegido = /** @type {NonNullable<typeof best>} */ (best);
    if (!elegido.floorOk) return { ok: false, error: 'menu.proteinFloorUnmet', detail: excluded };

    return {
        ok: true,
        value: { meals: elegido.meals, totals: elegido.totals, target, bands: elegido.bands, excluded }
    };
}

/**
 * Cambia UNA comida sin rehacer el día.
 *
 * Es lo que hace usable a un planificador: «esta comida no me apetece» no puede
 * obligar a tirar el menú entero. Pero cambiar una comida cambia el total del
 * día, así que **cada candidata se acepta solo si el DÍA sigue dentro de banda**
 * y el suelo de proteína se mantiene. Sustituir a ciegas convertiría el botón de
 * «otra opción» en la forma más rápida de romper el plan sin enterarse.
 *
 * @param {{ meals: MenuMeal[], target: * }} current
 * @param {number} mealIndex
 * @param {{ foods: Food[], preferences?: Preferences, seed?: number }} input
 * @returns {{ ok: true, value: { meals: MenuMeal[], totals: Macros, target: *, bands: * } }
 *          | { ok: false, error: string }}
 */
export function regenerateMeal(current, mealIndex, input) {
    const meals = Array.isArray(current?.meals) ? current.meals : [];
    const posicion = meals.findIndex((m) => m.index === mealIndex);
    if (posicion < 0) return { ok: false, error: 'menu.mealNotFound' };

    const target = current.target;
    const { pools } = candidatePool(input?.foods ?? [], input?.preferences ?? {});
    if (pools.protein.length === 0 || pools.carb.length === 0 || pools.fat.length === 0) {
        return { ok: false, error: 'menu.noSources' };
    }

    const base = Number.isFinite(input?.seed) ? /** @type {number} */ (input.seed) : 1;
    const mealTarget = meals[posicion].target;
    const anterior = new Set(meals[posicion].items.map((it) => it.foodId));

    for (let intento = 1; intento <= MAX_ATTEMPTS; intento++) {
        // Semilla derivada, no azar: pedir «otra opción» dos veces desde el
        // mismo estado da lo mismo, y el menú sigue siendo reproducible.
        const rand = mulberry32(base + mealIndex * 7919 + intento * 104729);
        /** @type {Set<string>} */ const usados = new Set();
        const picks = {
            protein: /** @type {Food} */ (pick(pools.protein, rand, usados, (f) => f.id)),
            carb: /** @type {Food} */ (pick(pools.carb, rand, usados, (f) => f.id)),
            fat: /** @type {Food} */ (pick(pools.fat, rand, usados, (f) => f.id)),
            veg: pools.veg.length > 0 ? pick(pools.veg, rand, usados, (f) => f.id) : null
        };
        const items = solvePortions(picks, mealTarget);
        // Que sea OTRA comida, no la misma con otro nombre.
        if (items.every((it) => anterior.has(it.food.id))) continue;

        /** @type {MenuMeal} */ const nueva = {
            index: mealIndex,
            target: mealTarget,
            items: items.map((it) => ({
                foodId: it.food.id, name: it.food.n, grams: it.grams, macros: it.macros, src: it.food.src
            })),
            totals: sumMacros(items.map((it) => it.macros))
        };
        const candidato = meals.map((m, i) => (i === posicion ? nueva : m));
        const totals = sumMacros(candidato.map((m) => m.totals));
        const bands = withinBands(totals, target);
        const floorOk = totals.proteinG >= target.proteinG * PROTEIN_FLOOR_RATIO;
        if (!bands.within || !floorOk) continue;

        return { ok: true, value: { meals: candidato, totals, target, bands } };
    }
    // Se dice, en vez de servir algo que saca al día de su banda.
    return { ok: false, error: 'menu.noAlternative' };
}

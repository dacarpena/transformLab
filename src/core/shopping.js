// @ts-check

/**
 * Del menú a la compra (V2-M4). Módulo PURO.
 *
 * Consolida los ingredientes de uno o varios días de menú, les resta lo que ya
 * hay en la despensa y los agrupa por el pasillo por el que se pasa en el súper.
 *
 * EL INVARIANTE ES DE CONSERVACIÓN, y es hermano del `conservacion` del motor
 * (peso = grasa + magro cada día): **nada aparece ni desaparece**. Para cada
 * alimento, `neededG = pantryUsedG + toBuyG`, exactamente; y la lista contiene
 * los alimentos del menú, ni uno más ni uno menos. Una lista de la compra que
 * pierde un ingrediente se descubre en la cocina, con la sartén puesta.
 *
 * LO QUE SE REDONDEA Y LO QUE NO. Las cantidades internas son exactas; el
 * redondeo vive aparte, en `buyRoundedG`, porque redondear al alza cada línea
 * —que es lo cómodo para comprar— rompería la conservación si se hiciera sobre
 * el número bueno. Se enseña lo redondeado y se cuadra con lo exacto.
 *
 * LAS UNIDADES QUE NO CASAN NO SE IGNORAN. El menú habla en gramos. Un artículo
 * de despensa apuntado en «unidades» no se puede restar de 250 g sin saber lo
 * que pesa una unidad, y ese dato no lo tenemos: se devuelve en `unmatched` para
 * que la interfaz lo diga. Restarlo a ojo produciría una compra corta y una cena
 * a medias.
 */

import { normalize } from './foods.js';

/**
 * Orden en el que se recorre un supermercado. No es alfabético a propósito:
 * una lista ordenada por pasillo se recorre una vez, y una alfabética obliga a
 * ir y volver.
 * @type {readonly string[]}
 */
export const AISLE_ORDER = Object.freeze([
    'verdura', 'fruta', 'carne', 'pescado', 'huevos', 'lacteos',
    'panaderia', 'despensa', 'congelados', 'bebidas', 'snacks', 'precocinados', 'otros'
]);

/** Pasillo de los alimentos sin pasillo conocido. */
export const DEFAULT_AISLE = 'otros';

/** A cuántos gramos se redondea al alza lo que hay que comprar. */
export const BUY_ROUNDING_G = 10;

/** @param {number} v @returns {number} */
function round1(v) {
    return Math.round(v * 10) / 10;
}

/**
 * @typedef {Object} ShoppingLine
 * @property {string} foodId
 * @property {string} name
 * @property {string} aisle
 * @property {number} neededG lo que pide el menú
 * @property {number} pantryUsedG lo que cubre la despensa
 * @property {number} toBuyG lo que hay que comprar, exacto
 * @property {number} buyRoundedG lo mismo, redondeado al alza para comprar
 * @property {string} [expiresISO] caducidad de lo que hay en casa
 */

/**
 * @typedef {Object} PantryItem
 * @property {string} id
 * @property {string} name
 * @property {number} quantity
 * @property {string} unit
 * @property {string} [foodId]
 * @property {string} [expiresISO]
 */

/**
 * Índice de la despensa por alimento.
 *
 * Se casa primero por `foodId` y solo después por nombre normalizado. El orden
 * importa: lo que entra en la despensa desde la propia lista de la compra lleva
 * su `foodId`, así que el bucle menú → compra → despensa cierra exacto; lo que
 * el usuario teclea a mano solo casa si escribió el mismo nombre, y eso es una
 * limitación real que la interfaz tiene que contar en vez de disimular.
 *
 * @param {PantryItem[]} pantry
 * @returns {{ byFoodId: Map<string, PantryItem[]>, byName: Map<string, PantryItem[]>, unmatched: PantryItem[] }}
 */
export function indexPantry(pantry) {
    /** @type {Map<string, PantryItem[]>} */ const byFoodId = new Map();
    /** @type {Map<string, PantryItem[]>} */ const byName = new Map();
    /** @type {PantryItem[]} */ const unmatched = [];

    for (const item of Array.isArray(pantry) ? pantry : []) {
        const unidad = normalize(item?.unit);
        // El menú habla en gramos. Otra unidad no es comparable, y estimarla
        // sería inventarse cuánto pesa «una unidad» de algo.
        if (unidad !== 'g' && unidad !== 'gr' && unidad !== 'gramos') {
            unmatched.push(item);
            continue;
        }
        const push = (/** @type {Map<string, PantryItem[]>} */ map, /** @type {string} */ key) => {
            const list = map.get(key);
            if (list) list.push(item); else map.set(key, [item]);
        };
        if (item.foodId) push(byFoodId, item.foodId);
        push(byName, normalize(item.name));
    }
    return { byFoodId, byName, unmatched };
}

/**
 * @typedef {{ items: Array<{ foodId: string, name: string, grams: number }> }} MenuMealLike
 * @typedef {{ meals: MenuMealLike[] }} MenuDayLike
 */

/**
 * Consolida los ingredientes de varios días de menú.
 *
 * Aquí es donde «2 huevos + 3 huevos = 5»: la clave es el `foodId`, no el
 * nombre, porque dos días pueden traer el mismo alimento con el nombre escrito
 * distinto y sumarlos mal es la forma silenciosa de comprar el doble.
 *
 * @param {MenuDayLike[]} days
 * @returns {Map<string, { foodId: string, name: string, grams: number }>}
 */
export function consolidate(days) {
    /** @type {Map<string, { foodId: string, name: string, grams: number }>} */
    const total = new Map();
    for (const day of Array.isArray(days) ? days : []) {
        for (const meal of day?.meals ?? []) {
            for (const item of meal?.items ?? []) {
                const id = String(item?.foodId ?? '');
                if (id === '') continue;
                const grams = Number.isFinite(item?.grams) ? item.grams : 0;
                const prev = total.get(id);
                if (prev) prev.grams = round1(prev.grams + grams);
                else total.set(id, { foodId: id, name: String(item?.name ?? ''), grams: round1(grams) });
            }
        }
    }
    return total;
}

/**
 * Construye la lista de la compra.
 *
 * @param {{
 *   days: MenuDayLike[],
 *   pantry?: PantryItem[],
 *   foods?: Record<string, import('./foods.js').Food>
 * }} input
 * @returns {{
 *   lines: ShoppingLine[],
 *   groups: Array<{ aisle: string, lines: ShoppingLine[] }>,
 *   totals: { neededG: number, pantryUsedG: number, toBuyG: number, lines: number },
 *   unmatchedPantry: PantryItem[]
 * }}
 */
export function buildShoppingList(input) {
    const needed = consolidate(input?.days ?? []);
    const { byFoodId, byName, unmatched } = indexPantry(input?.pantry ?? []);
    const foods = input?.foods ?? {};

    /** @type {ShoppingLine[]} */ const lines = [];

    // Lo que queda en cada entrada de despensa, en gramos. Se lleva la cuenta
    // POR CANTIDAD y no por «bote usado / bote libre» por dos razones que se
    // notan en la cocina: un bote de 500 g del que se gastan 150 conserva 350
    // para la siguiente línea, y una entrada no se puede descontar dos veces —
    // restar el mismo arroz a dos platos deja la compra corta justo en lo que
    // más se nota.
    /** @type {Map<string, number>} */ const restante = new Map();
    for (const list of [...byFoodId.values(), ...byName.values()]) {
        for (const item of list) {
            if (!restante.has(item.id)) {
                restante.set(item.id, Number.isFinite(item.quantity) ? Math.max(0, item.quantity) : 0);
            }
        }
    }

    for (const { foodId, name, grams } of needed.values()) {
        const candidatos = byFoodId.get(foodId) ?? byName.get(normalize(name)) ?? [];
        // Lo que antes caduca se gasta primero: es lo que hay que sacar de casa
        // antes de que se estropee.
        const porCaducidad = [...candidatos].sort((a, b) =>
            (a.expiresISO ?? '￿').localeCompare(b.expiresISO ?? '￿'));

        let enCasa = 0;
        /** @type {string | undefined} */ let expiresISO;
        for (const item of porCaducidad) {
            if (enCasa >= grams) break;
            const queda = restante.get(item.id) ?? 0;
            if (queda <= 0) continue;
            const toma = Math.min(queda, grams - enCasa);
            // Sin este corte, una entrada que aporta CERO —porque ya está
            // cubierto— seguía dejando su caducidad en la línea. La fecha
            // mostrada sería la de un bote que no se ha tocado.
            if (toma <= 0) continue;
            restante.set(item.id, round1(queda - toma));
            enCasa += toma;
            if (item.expiresISO && (expiresISO === undefined || item.expiresISO < expiresISO)) {
                expiresISO = item.expiresISO;
            }
        }

        const pantryUsedG = round1(Math.min(grams, enCasa));
        const toBuyG = round1(grams - pantryUsedG);
        /** @type {ShoppingLine} */ const line = {
            foodId,
            name,
            aisle: String(foods[foodId]?.cat ?? DEFAULT_AISLE),
            neededG: grams,
            pantryUsedG,
            toBuyG,
            buyRoundedG: Math.ceil(toBuyG / BUY_ROUNDING_G) * BUY_ROUNDING_G
        };
        if (expiresISO) line.expiresISO = expiresISO;
        lines.push(line);
    }

    /** @type {Map<string, ShoppingLine[]>} */ const porPasillo = new Map();
    for (const line of lines) {
        const list = porPasillo.get(line.aisle);
        if (list) list.push(line); else porPasillo.set(line.aisle, [line]);
    }
    const groups = AISLE_ORDER
        .filter((aisle) => porPasillo.has(aisle))
        .map((aisle) => ({
            aisle,
            lines: /** @type {ShoppingLine[]} */ (porPasillo.get(aisle))
                .sort((a, b) => a.name.localeCompare(b.name, 'es'))
        }));
    // Un pasillo que no esté en el orden canónico no se pierde: va al final.
    for (const [aisle, list] of porPasillo) {
        if (!AISLE_ORDER.includes(aisle)) {
            groups.push({ aisle, lines: list.sort((a, b) => a.name.localeCompare(b.name, 'es')) });
        }
    }

    const suma = (/** @type {(l: ShoppingLine) => number} */ f) =>
        round1(lines.reduce((acc, l) => acc + f(l), 0));

    return {
        lines,
        groups,
        totals: {
            neededG: suma((l) => l.neededG),
            pantryUsedG: suma((l) => l.pantryUsedG),
            toBuyG: suma((l) => l.toBuyG),
            lines: lines.length
        },
        unmatchedPantry: unmatched
    };
}

/**
 * Reordena una lista ya construida.
 *
 * Es una función aparte y no un parámetro de `buildShoppingList` porque cambiar
 * el orden no debe poder cambiar las cantidades: separarlas hace imposible que
 * un criterio de ordenación toque el invariante de conservación.
 *
 * @param {ShoppingLine[]} lines
 * @param {'aisle'|'expiry'|'owned'|'name'} criterion
 * @returns {ShoppingLine[]}
 */
export function sortLines(lines, criterion) {
    const copia = [...(Array.isArray(lines) ? lines : [])];
    const porNombre = (/** @type {ShoppingLine} */ a, /** @type {ShoppingLine} */ b) =>
        a.name.localeCompare(b.name, 'es');

    if (criterion === 'expiry') {
        // Lo que caduca antes, primero; lo que no caduca, al final. Sin fecha no
        // es «caduca hoy», es «no sabemos», y ponerlo delante haría gastar antes
        // lo que no corre prisa.
        return copia.sort((a, b) => {
            const av = a.expiresISO ?? '￿';
            const bv = b.expiresISO ?? '￿';
            return av.localeCompare(bv) || porNombre(a, b);
        });
    }
    if (criterion === 'owned') {
        // Primero lo que ya está cubierto en casa: es lo que se puede tachar.
        return copia.sort((a, b) => (b.pantryUsedG - a.pantryUsedG) || porNombre(a, b));
    }
    if (criterion === 'name') return copia.sort(porNombre);
    return copia.sort((a, b) =>
        (AISLE_ORDER.indexOf(a.aisle) - AISLE_ORDER.indexOf(b.aisle)) || porNombre(a, b));
}

/**
 * La lista como texto plano, para copiarla o mandarla.
 *
 * Texto y no JSON porque es lo que se pega en las notas del móvil, que es donde
 * acaba una lista de la compra de verdad. El JSON ya lo devuelve
 * `buildShoppingList` para quien lo quiera.
 *
 * @param {{ groups: Array<{ aisle: string, lines: ShoppingLine[] }> }} list
 * @param {{ aisleLabel?: (aisle: string) => string, title?: string }} [options]
 * @returns {string}
 */
export function toPlainText(list, options = {}) {
    const label = options.aisleLabel ?? ((/** @type {string} */ a) => a);
    const out = [];
    if (options.title) out.push(options.title, '');
    for (const group of list?.groups ?? []) {
        const pendientes = group.lines.filter((l) => l.toBuyG > 0);
        if (pendientes.length === 0) continue;
        out.push(`${label(group.aisle).toUpperCase()}`);
        for (const line of pendientes) out.push(`- ${line.name}: ${line.buyRoundedG} g`);
        out.push('');
    }
    return out.join('\n').trimEnd();
}

// @ts-check

/**
 * Los módulos del producto, en un solo sitio (V2-M10). Módulo PURO.
 *
 * La v2 añadió seis funciones —menú, compra, suplementos, volumen, pasos,
 * recuperación— y cada una trajo sus preguntas. Preguntarlas todas de golpe
 * convierte el alta en un formulario de veinte campos que nadie termina;
 * esconderlas deja el producto configurado a medias sin que el usuario sepa que
 * existían. Este módulo es la tercera vía: **el usuario elige qué le interesa y
 * solo se le pregunta por eso**.
 *
 * DOS ACTIVOS POR DEFECTO Y CUATRO OPT-IN, y la razón no es estética. Nutrición
 * y Entreno son lo que usa todo el que se crea un plan y ya existían en la v1;
 * los otros cuatro añaden preguntas para una minoría. Un alta de cinco preguntas
 * que da un plan funcional vale más que una de veinte que da uno perfecto y que
 * nadie completa.
 *
 * INVARIANTE `plan_funcional_con_defaults`: **saltarse TODOS los bloques
 * opcionales tiene que dar un plan válido**. Cada módulo declara aquí su valor
 * por defecto, sacado de `ranges.js` y `constants.js`, y ninguno de esos valores
 * es destructivo (H-013/D9): saltar no borra ni bloquea nada, solo deja el
 * módulo con la suposición razonable.
 */

/**
 * Nivel de control que el usuario pide.
 *
 * Decide CUÁNTA profundidad se le enseña, no qué motor se usa: es el mismo
 * `engine` con más o menos preguntas. Bifurcar en «app para principiantes» y
 * «app para expertos» duplica el producto y garantiza que las dos mitades
 * diverjan.
 * @type {readonly string[]}
 */
export const CONTROL_LEVELS = Object.freeze(['coached', 'collaborative', 'manual']);

/** Nivel por defecto: el intermedio. */
export const DEFAULT_CONTROL_LEVEL = 'collaborative';

/**
 * @typedef {Object} ModuleSpec
 * @property {string} id
 * @property {boolean} defaultOn ¿viene activo de fábrica?
 * @property {boolean} core ¿es obligatorio? (solo el núcleo)
 * @property {string} viewId vista donde vive
 * @property {readonly string[]} asks claves i18n de lo que pregunta su bloque
 * @property {readonly string[]} shownFrom niveles de control que lo enseñan
 */

/**
 * Cuánto se enseña en cada nivel de control.
 *
 * `coached` ve lo mínimo —cinco preguntas y un plan—; `manual` lo ve todo. No es
 * una gradación de confianza: es una gradación de INTERÉS. Alguien que solo
 * quiere que le digan qué comer no necesita declarar su equipo de gimnasio.
 */
const TODOS = Object.freeze(['coached', 'collaborative', 'manual']);
const DESDE_COLABORATIVO = Object.freeze(['collaborative', 'manual']);
const SOLO_MANUAL = Object.freeze(['manual']);

/**
 * Los módulos, en el orden en que se preguntan.
 * @type {readonly ModuleSpec[]}
 */
export const MODULES = Object.freeze([
    {
        id: 'core',
        defaultOn: true,
        core: true,
        viewId: 'today',
        // Antropometría, objetivo y actividad. Es lo único sin lo que no hay
        // plan posible, y ya existía desde M3.
        asks: Object.freeze(['sex', 'age', 'heightCm', 'weightKg', 'fatPct', 'target', 'activityLevel']),
        shownFrom: TODOS
    },
    {
        id: 'nutrition',
        defaultOn: true,
        core: false,
        viewId: 'nutrition',
        asks: Object.freeze(['mealsPerDay', 'dietType', 'hardExclusions', 'softExclusions']),
        shownFrom: TODOS
    },
    {
        id: 'training',
        defaultOn: true,
        core: false,
        viewId: 'training',
        asks: Object.freeze(['sessionsPerWeek', 'trainingStatus']),
        shownFrom: TODOS
    },
    {
        id: 'shopping',
        defaultOn: false,
        core: false,
        viewId: 'shopping',
        asks: Object.freeze(['householdSize']),
        shownFrom: DESDE_COLABORATIVO
    },
    {
        id: 'supplements',
        defaultOn: false,
        core: false,
        viewId: 'supplements',
        // Las banderas de seguridad se preguntan en su propia vista, no aquí:
        // son diez casillas médicas y meterlas en el alta la convertiría en un
        // cuestionario clínico antes de haber enseñado nada.
        asks: Object.freeze(['safetyFlags']),
        shownFrom: DESDE_COLABORATIVO
    },
    {
        id: 'steps',
        defaultOn: false,
        core: false,
        viewId: 'expenditure',
        asks: Object.freeze(['stepsTarget']),
        shownFrom: DESDE_COLABORATIVO
    },
    {
        id: 'recovery',
        defaultOn: false,
        core: false,
        viewId: 'training',
        asks: Object.freeze(['bedtime', 'trainingTime']),
        shownFrom: SOLO_MANUAL
    }
]);

/** Ids de los módulos activos de fábrica. */
export const DEFAULT_ACTIVE = Object.freeze(
    MODULES.filter((m) => m.defaultOn).map((m) => m.id)
);

/**
 * Valores por defecto de cada módulo opcional.
 *
 * INVARIANTE `plan_funcional_con_defaults`: con esto y solo esto, el producto
 * entero funciona. Ninguno es destructivo: saltarse un bloque deja una
 * suposición razonable, nunca un bloqueo ni un borrado (H-013/D9).
 * @type {Readonly<Record<string, *>>}
 */
export const MODULE_DEFAULTS = Object.freeze({
    // Cuatro comidas es el reparto cómodo que ya usaba la v1.
    mealsPerDay: 4,
    // Omnívoro: es la dieta que NO excluye nada, así que el solver siempre tiene
    // solución. Suponer una restrictiva por defecto dejaría a la mayoría con un
    // menú recortado sin haberlo pedido.
    dietType: 'omnivore',
    hardExclusions: Object.freeze([]),
    softExclusions: Object.freeze([]),
    // Una persona: la lista de la compra sale para uno.
    householdSize: 1,
    // NINGUNA bandera marcada por defecto. Es lo único que podría parecer
    // conservador al revés, y no lo es: marcar banderas que el usuario no ha
    // declarado le retiraría suplementos por una suposición nuestra. El cribado
    // protege cuando el usuario habla, no cuando callamos por él.
    safetyFlags: Object.freeze([]),
    // Dos sesiones semanales: el mínimo con el que el reparto de volumen tiene
    // sentido.
    sessionsPerWeek: 2,
    controlLevel: DEFAULT_CONTROL_LEVEL
});

/** @param {string} id @returns {ModuleSpec | null} */
export function moduleById(id) {
    return MODULES.find((m) => m.id === String(id)) ?? null;
}

/**
 * Qué bloques se enseñan en el alta, dado el nivel de control y lo activado.
 *
 * El núcleo siempre. Los demás, solo si el nivel de control los muestra Y el
 * usuario los ha activado: son dos condiciones distintas, y confundirlas haría
 * que activar un módulo en modo `coached` abriera preguntas que ese modo existe
 * para no hacer.
 *
 * @param {{ controlLevel?: string, activeModules?: readonly string[] }} input
 * @returns {ModuleSpec[]}
 */
export function blocksFor(input) {
    const level = CONTROL_LEVELS.includes(String(input?.controlLevel ?? ''))
        ? String(input.controlLevel)
        : DEFAULT_CONTROL_LEVEL;
    const active = new Set(input?.activeModules ?? DEFAULT_ACTIVE);
    return MODULES.filter((m) => m.core || (active.has(m.id) && m.shownFrom.includes(level)));
}

/**
 * Cuántas preguntas verá el usuario con esta configuración.
 *
 * Existe para poder AFIRMAR la promesa del producto —cinco preguntas el
 * principiante, veinte y pico el experto— y para que un test la compruebe. Una
 * promesa de producto sin test es una frase de marketing.
 *
 * @param {{ controlLevel?: string, activeModules?: readonly string[] }} input
 * @returns {number}
 */
export function questionCount(input) {
    return blocksFor(input).reduce((acc, m) => acc + m.asks.length, 0);
}

/**
 * Preferencias completas a partir de lo que el usuario haya contestado.
 *
 * Lo no contestado cae al defecto. Es la función que hace verdadero el
 * invariante `plan_funcional_con_defaults`: da igual cuántos bloques se salte,
 * lo que sale de aquí es una configuración con la que todos los módulos
 * funcionan.
 *
 * @param {Record<string, *>} answers
 * @returns {Record<string, *>}
 */
export function withDefaults(answers) {
    /** @type {Record<string, *>} */ const out = {};
    for (const [key, value] of Object.entries(MODULE_DEFAULTS)) {
        // Se copian los arrays para que nadie mute los congelados por accidente.
        out[key] = Array.isArray(value) ? [...value] : value;
    }
    for (const [key, value] of Object.entries(answers ?? {})) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value) && value.length === 0 && Array.isArray(out[key])) continue;
        out[key] = value;
    }
    return out;
}

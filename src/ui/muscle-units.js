// @ts-check

/**
 * En qué unidad se le habla al usuario del músculo (decisión E11).
 *
 * EL PROBLEMA, EN UNA LÍNEA: si tu báscula dice 56,56 kg de músculo y la app
 * te enseña 29,24, no te está mintiendo — te está enseñando otra cosa con el
 * mismo nombre. Y si escribes 60 como objetivo, te contesta que ganar 30 kg de
 * músculo es imposible. Tiene razón sobre 30 kg de músculo esquelético; no
 * tiene razón sobre lo que tú querías decir.
 *
 * LA REGLA: **el motor solo habla de músculo esquelético; el usuario solo lee
 * y escribe la unidad de SU báscula.** Este módulo es la única aduana entre
 * ambos mundos, y vive deliberadamente en `src/ui/` porque es una decisión de
 * presentación: nada de esto cruza hacia `src/core/`, así que los siete
 * invariantes con nombre siguen valiendo exactamente igual.
 *
 * QUÉ HAY QUE TRADUCIR, Y QUÉ NO. Las dos cifras se llevan un offset constante
 * (`core/scale.js` lo explica y hay un test que lo fija a lo largo de una
 * proyección entera). De ahí:
 *
 *   - NIVELES absolutos («tienes 56,6 kg», «tu meta son 60»): hay que traducir.
 *   - INCREMENTOS («ganarás 3,4 kg»): NO se traducen, son iguales en ambas
 *     unidades. Por eso los hitos del catálogo, las tasas de ganancia y los
 *     mensajes «ganar X kg» se quedan como están.
 *
 * HONESTIDAD. La conversión no es una medición: reparte la masa magra entre
 * músculo esquelético y «todo lo demás» con una proporción de población
 * (Janssen 2000). Por eso, allá donde se muestra la cifra de báscula, se
 * muestra también la esquelética estimada al lado: `secondary()`. Ninguna
 * báscula doméstica mide músculo esquelético, y la interfaz no finge que sí.
 */

import { muscleOffsetKg, toScaleMuscle, toSkeletalMuscle } from '../core/scale.js';
import { t } from '../i18n/i18n.js';

/**
 * @typedef {Object} MuscleUnits
 * @property {boolean} isScale si el usuario trabaja en unidades de su báscula
 * @property {number} offsetKg 0 cuando no hay báscula
 * @property {(skeletalKg: number) => number} toDisplay esquelético → lo que se muestra
 * @property {(displayKg: number) => number} fromInput lo que se escribe → esquelético
 * @property {() => string} label etiqueta del campo/métrica, ya traducida
 * @property {(skeletalKg: number) => string} secondary nota con la cifra esquelética, o '' si no aplica
 */

/** Identidad: sin báscula, no hay nada que traducir y todo sigue como antes. */
const IDENTITY = Object.freeze(/** @type {MuscleUnits} */ ({
    isScale: false,
    offsetKg: 0,
    toDisplay: (kg) => kg,
    fromInput: (kg) => kg,
    label: () => t('muscleUnits.label.skeletal'),
    secondary: () => ''
}));

/** Un decimal, como el resto de cifras de la interfaz. @param {number} n */
function num1(n) {
    return Number.isFinite(n) ? n.toFixed(1) : '—';
}

/**
 * ¿Está este perfil en unidades de báscula? **La única definición.**
 *
 * Hacen falta las TRES cifras: la de la báscula, la esquelética y el hueso. El
 * hueso no entra en la conversión, pero es lo que dice que la lectura viene de
 * una báscula de bioimpedancia (decisión de E10: solo esas lo dan), y sin él el
 * asistente no puede reconstruirla.
 *
 * Que esto viva en un solo sitio no es estética. Cuando el predicado estaba
 * escrito en tres —aquí, en `main.js` y en `progress.js`— un perfil con
 * `scaleMuscleKg` pero sin `boneKg` (que un backup importado puede traer, y el
 * esquema acepta porque ambos campos son opcionales) hacía que el dashboard
 * tradujera, el asistente lo degradara de `derived` a `measured` y Progreso
 * comparara kilos de báscula contra kilos esqueléticos. Tres respuestas
 * distintas a la misma pregunta es exactamente el defecto que hundió la v4.0.
 *
 * @param {{ scaleMuscleKg?: number | null, muscleKg?: number | null, boneKg?: number | null } | null | undefined} initial
 * @returns {boolean}
 */
export function isScaleProfile(initial) {
    if (initial === null || typeof initial !== 'object') return false;
    if (!Number.isFinite(initial.boneKg)) return false;
    return muscleOffsetKg(initial) !== null;
}

/**
 * Construye la aduana a partir de la composición inicial del perfil.
 *
 * Sin ajuste ni selector: la señal es el propio dato, igual que en E10 la
 * presencia del hueso es lo que dice que las cifras vienen de una báscula.
 *
 * @param {{ scaleMuscleKg?: number | null, muscleKg?: number | null, boneKg?: number | null } | null | undefined} initial
 * @returns {MuscleUnits}
 */
export function muscleUnitsFor(initial) {
    if (!isScaleProfile(initial)) return IDENTITY;
    const offsetKg = /** @type {number} */ (muscleOffsetKg(/** @type {*} */ (initial)));
    return {
        isScale: true,
        offsetKg,
        toDisplay: (kg) => toScaleMuscle(kg, offsetKg),
        fromInput: (kg) => toSkeletalMuscle(kg, offsetKg),
        label: () => t('muscleUnits.label.scale'),
        secondary: (kg) => t('muscleUnits.secondary', { value: num1(kg) })
    };
}

/**
 * La misma aduana, a partir de lo que ya tienen a mano las vistas.
 * @param {{ profile?: { initial?: * } } | null | undefined} bundle
 * @returns {MuscleUnits}
 */
export function muscleUnitsOf(bundle) {
    return muscleUnitsFor(bundle?.profile?.initial);
}

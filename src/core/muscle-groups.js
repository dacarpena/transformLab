// @ts-check

/**
 * Proyección músculo a músculo (V2-M9). Módulo PURO.
 *
 * ESTO ES UNA DESAGREGACIÓN, NO UN SEGUNDO CÁLCULO, y la distinción es toda la
 * milestone. El eje agregado —`engine.js` y `generator.js`— sigue siendo la
 * ÚNICA fuente de verdad sobre cuánto músculo se gana. Aquí se reparte ese
 * presupuesto ya proyectado entre los diez grupos, en proporción al estímulo que
 * cada uno recibe. Nada de lo que pase aquí puede cambiar el total.
 *
 * EL CORTAFUEGOS es el invariante `reparto`: **la suma de las series por grupo
 * reconstituye EXACTAMENTE el `muscleKg` global de cada día**. Si un día no
 * cuadra, el test salta. Sin ese cortafuegos, este módulo sería un segundo
 * motor discutiendo con el primero, y ganaría el que se pintara al final — que
 * es literalmente el defecto que hundió la v4.0.
 *
 * Y ES UNA ESTIMACIÓN, ETIQUETADA COMO TAL. Nadie mide el músculo de su bíceps
 * en casa. Repartir el global por estímulo es la mejor aproximación disponible y
 * sigue siendo una aproximación: presentar «tu bíceps tendrá 3,4 kg el 14 de
 * marzo» como un dato repetiría, a escala fina, exactamente el error que este
 * proyecto existe para no repetir. Por eso cada serie viaja con
 * `estimated: true` y con su banda.
 */

import { SCENARIO_PROGRESS_EXPONENTS } from './constants.js';
import { MUSCLE_GROUPS } from './muscle-volume.js';

/**
 * Reparto anatómico del músculo esquelético entre los diez grupos.
 *
 * Son proporciones de POBLACIÓN, derivadas de los estudios de masa muscular
 * segmentaria por resonancia (Janssen y cols., *J Appl Physiol* 2000: piernas
 * ~50 % del músculo esquelético total, tronco ~30 %, brazos ~20 %) repartidas
 * dentro de cada región según su sección transversal relativa.
 *
 * NO SON LAS DE NADIE EN CONCRETO, y esa es exactamente la razón por la que las
 * series por grupo se etiquetan como estimación. Alguien con genética de piernas
 * tendrá otro reparto y esta tabla no lo sabe.
 * @type {Readonly<Record<string, number>>}
 */
export const ANATOMICAL_SHARE = Object.freeze({
    quads: 0.17,
    glutes: 0.12,
    hamstrings: 0.10,
    calves: 0.06,
    back: 0.16,
    chest: 0.09,
    core: 0.07,
    shoulders: 0.09,
    triceps: 0.08,
    biceps: 0.06
});

/**
 * Traducción de los grupos FINOS del catálogo estético a los diez gruesos.
 *
 * Es la trampa que el plan avisaba: el catálogo habla de braquiorradial,
 * infraespinoso y redondo mayor, y los landmarks de volumen hablan de espalda y
 * brazos. Sin este mapa, los hitos por grupo se quedarían huérfanos y la rejilla
 * no sabría dónde colgarlos.
 *
 * `null` = el hito es global y no cuelga de ningún grupo; son los de silueta
 * general y los de partes sin landmarks propios (antebrazo, aductores).
 * @type {Readonly<Record<string, string | null>>}
 */
export const FINE_TO_COARSE = Object.freeze({
    // Tronco anterior
    pectorales: 'chest',
    pectoral_superior: 'chest',
    serrato: 'chest',
    intercostales: 'core',
    // Core
    abdomen: 'core',
    abdominales: 'core',
    oblicuos: 'core',
    transverso: 'core',
    // Espalda
    espalda: 'back',
    dorsales: 'back',
    trapecios: 'back',
    trapecio_inferior: 'back',
    romboides: 'back',
    erectores: 'back',
    infraespinoso: 'back',
    redondo_mayor: 'back',
    serratos_posteriores: 'back',
    // Hombro
    hombros: 'shoulders',
    deltoides_anterior: 'shoulders',
    deltoides_lateral: 'shoulders',
    deltoides_posterior: 'shoulders',
    deltoides_completo: 'shoulders',
    deltoides_separacion: 'shoulders',
    // Brazo
    'bíceps': 'biceps',
    braquial: 'biceps',
    'tríceps': 'triceps',
    // Pierna
    'cuádriceps': 'quads',
    vasto_medial: 'quads',
    sartorio: 'quads',
    femorales: 'hamstrings',
    'glúteos': 'glutes',
    gemelos: 'calves',
    // Regiones que el catálogo trata como un todo: no cuelgan de un solo grupo.
    brazos: null,
    piernas: null,
    general: null,
    // Sin landmarks de volumen publicados: proyectar ganancia sobre un músculo
    // del que no conocemos su dosis mínima efectiva sería inventarse la cifra.
    antebrazos: null,
    braquiorradial: null,
    extensores: null,
    dorso_mano: null,
    aductores: null,
    tensor_fascia_lata: null
});

/**
 * Grupo grueso de un grupo fino del catálogo.
 * @param {string} fine
 * @returns {string | null}
 */
export function coarseGroupOf(fine) {
    const key = String(fine ?? '');
    return Object.hasOwn(FINE_TO_COARSE, key) ? FINE_TO_COARSE[key] : null;
}

/**
 * Cuota de cada grupo en el REPARTO DE LA GANANCIA.
 *
 * No es la anatómica: es la anatómica ponderada por el estímulo que cada grupo
 * está recibiendo. Un grupo por debajo de su mínimo efectivo apenas crece
 * aunque sea grande, y uno pequeño bien entrenado crece más de lo que su tamaño
 * sugeriría. Ese es justo el sentido de proyectar músculo a músculo: si el
 * reparto solo mirara el tamaño, la gráfica de cada grupo sería la global
 * escalada, y no diría nada que el usuario no supiera ya.
 *
 * Cuando NO hay estímulo en ninguna parte —nadie ha registrado sesiones— se cae
 * al reparto anatómico puro y se DECLARA con `stimulusKnown: false`. Repartir a
 * ciegas fingiendo que sabemos dónde entrena sería peor que decir que no.
 *
 * @param {Record<string, number>} stimulusByGroup 0–1 por grupo
 * @returns {{ shares: Record<string, number>, stimulusKnown: boolean }}
 */
export function gainShares(stimulusByGroup) {
    const stimulus = stimulusByGroup ?? {};
    /** @type {Record<string, number>} */ const pesos = {};
    let total = 0;
    for (const group of MUSCLE_GROUPS) {
        const s = Number.isFinite(stimulus[group]) ? Math.max(0, stimulus[group]) : 0;
        const peso = ANATOMICAL_SHARE[group] * s;
        pesos[group] = peso;
        total += peso;
    }

    if (total <= 0) {
        return { shares: { ...ANATOMICAL_SHARE }, stimulusKnown: false };
    }
    /** @type {Record<string, number>} */ const shares = {};
    for (const group of MUSCLE_GROUPS) shares[group] = pesos[group] / total;
    return { shares, stimulusKnown: true };
}

/**
 * Reparte una cantidad entre grupos de forma que la suma sea EXACTA.
 *
 * El último grupo recoge el residuo, igual que hace `splitIntoMeals` con las
 * comidas y por el mismo motivo: repartir por porcentajes y redondear cada uno
 * deja una diferencia de unos gramos que, sumada sobre 200 días, se convierte en
 * una discrepancia visible entre la gráfica global y la suma de las pequeñas.
 * Aquí la aritmética no puede fallar: se acumula y se cierra.
 *
 * @param {number} amount
 * @param {Record<string, number>} shares
 * @returns {Record<string, number>}
 */
export function distributeExactly(amount, shares) {
    /** @type {Record<string, number>} */ const out = {};
    let asignado = 0;
    for (let i = 0; i < MUSCLE_GROUPS.length; i++) {
        const group = MUSCLE_GROUPS[i];
        if (i === MUSCLE_GROUPS.length - 1) {
            out[group] = amount - asignado;
        } else {
            const parte = amount * (Number.isFinite(shares[group]) ? shares[group] : 0);
            out[group] = parte;
            asignado += parte;
        }
    }
    return out;
}

/**
 * @typedef {Object} GroupSeriesPoint
 * @property {number} dayIndex
 * @property {string} dateISO
 * @property {number} muscleKg nivel estimado del grupo
 * @property {number} gainKg ganancia acumulada desde el día 0
 * @property {{ pessimistKg: number, optimistKg: number }} band
 *
 * @typedef {Object} GroupSeries
 * @property {string} group
 * @property {GroupSeriesPoint[]} daily
 * @property {number} share cuota de la ganancia total
 * @property {number} startKg
 * @property {number} endKg
 * @property {number} gainKg
 * @property {true} estimated SIEMPRE true: nadie mide el músculo de su bíceps
 */

/**
 * Desagrega la proyección global en una serie por grupo.
 *
 * @param {{
 *   daily: Array<{ dayIndex: number, dateISO: string, muscleKg: number }>,
 *   stimulusByGroup?: Record<string, number>
 * }} input
 * @returns {{
 *   groups: GroupSeries[],
 *   stimulusKnown: boolean,
 *   estimated: true
 * }}
 */
export function projectByGroup(input) {
    const daily = Array.isArray(input?.daily) ? input.daily : [];
    const { shares, stimulusKnown } = gainShares(input?.stimulusByGroup ?? {});

    if (daily.length === 0) {
        return { groups: [], stimulusKnown, estimated: true };
    }

    const startMuscleKg = daily[0].muscleKg;
    // El punto de partida se reparte por ANATOMÍA, no por estímulo: el músculo
    // que ya tienes lo tienes, y no depende de lo que entrenes esta temporada.
    // Solo la GANANCIA se reparte por estímulo.
    const baseline = distributeExactly(startMuscleKg, ANATOMICAL_SHARE);

    const expP = SCENARIO_PROGRESS_EXPONENTS.pessimist;
    const expO = SCENARIO_PROGRESS_EXPONENTS.optimist;
    const totalDays = daily.length - 1;

    // PRIMERA PASADA: el nivel esperado de cada grupo, día a día.
    /** @type {Record<string, number[]>} */ const nivel = {};
    for (const group of MUSCLE_GROUPS) nivel[group] = [];
    for (const point of daily) {
        const porGrupo = distributeExactly(point.muscleKg - startMuscleKg, shares);
        for (const group of MUSCLE_GROUPS) nivel[group].push(baseline[group] + porGrupo[group]);
    }

    /**
     * Nivel de un grupo en una posición FRACCIONARIA del plan.
     *
     * Es la misma interpolación que usa `generator.js` para su banda, y por la
     * misma razón: un escenario es la serie esperada recorrida a otro ritmo, no
     * la ganancia final escalada. Escalarla daría por hecho que el músculo se
     * gana de forma lineal en el tiempo, y no se gana así —el motor lo modela
     * con fases—, de modo que la banda saldría desplazada justo en el tramo
     * donde el usuario está mirando.
     */
    const nivelEnPosicion = (/** @type {string} */ group, /** @type {number} */ pos) => {
        const serie = nivel[group];
        const clamped = Math.min(totalDays, Math.max(0, pos));
        const i0 = Math.floor(clamped);
        if (i0 >= totalDays) return serie[totalDays];
        const frac = clamped - i0;
        return serie[i0] + (serie[i0 + 1] - serie[i0]) * frac;
    };

    // SEGUNDA PASADA: la banda, con los MISMOS exponentes de escenario que el
    // global (B5). Así los tres escenarios de cada grupo cierran donde cierra el
    // suyo, exactamente igual que el agregado.
    /** @type {Record<string, GroupSeriesPoint[]>} */ const series = {};
    for (const group of MUSCLE_GROUPS) series[group] = [];

    for (let i = 0; i < daily.length; i++) {
        const point = daily[i];
        const t = totalDays === 0 ? 1 : point.dayIndex / totalDays;
        for (const group of MUSCLE_GROUPS) {
            const muscleKg = nivel[group][i];
            series[group].push({
                dayIndex: point.dayIndex,
                dateISO: point.dateISO,
                muscleKg,
                gainKg: muscleKg - baseline[group],
                band: {
                    pessimistKg: nivelEnPosicion(group, totalDays * Math.pow(t, expP)),
                    optimistKg: nivelEnPosicion(group, totalDays * Math.pow(t, expO))
                }
            });
        }
    }

    const groups = MUSCLE_GROUPS.map((group) => {
        const puntos = series[group];
        const startKg = puntos[0].muscleKg;
        const endKg = puntos[puntos.length - 1].muscleKg;
        return {
            group,
            daily: puntos,
            share: shares[group],
            startKg,
            endKg,
            gainKg: endKg - startKg,
            // Nunca es un dato medido, y viaja marcado para que ninguna vista
            // pueda presentarlo como si lo fuera.
            estimated: /** @type {true} */ (true)
        };
    });

    return { groups, stimulusKnown, estimated: /** @type {true} */ (true) };
}

/**
 * Comprueba el cortafuegos sobre una desagregación ya hecha.
 *
 * Existe como función exportada, y no solo como test, porque la interfaz puede
 * llamarla: si algún día la suma no cuadrase en el navegador de alguien, es
 * preferible que la vista lo diga a que pinte once gráficas que se contradicen.
 *
 * @param {{ groups: GroupSeries[] }} projection
 * @param {Array<{ dayIndex: number, muscleKg: number }>} daily
 * @param {number} [toleranceKg]
 * @returns {{ ok: boolean, worstKg: number, worstDayIndex: number }}
 */
export function checkReparto(projection, daily, toleranceKg = 1e-9) {
    let worstKg = 0;
    let worstDayIndex = -1;
    const groups = projection?.groups ?? [];
    if (groups.length === 0) return { ok: daily.length === 0, worstKg: 0, worstDayIndex: -1 };

    for (let i = 0; i < daily.length; i++) {
        const suma = groups.reduce((acc, g) => acc + (g.daily[i]?.muscleKg ?? 0), 0);
        const diff = Math.abs(suma - daily[i].muscleKg);
        if (diff > worstKg) {
            worstKg = diff;
            worstDayIndex = daily[i].dayIndex;
        }
    }
    return { ok: worstKg <= toleranceKg, worstKg, worstDayIndex };
}

// @ts-check

/**
 * Prescripción de volumen, progresión y deload (V2-M6). Módulo PURO.
 *
 * Toma el volumen MEDIDO por `core/muscle-volume.js` y contesta las tres
 * preguntas que un usuario se hace de verdad: ¿estoy haciendo suficiente para
 * este grupo, cuánto debería hacer la semana que viene, y cuándo toca bajar.
 *
 * TRES DECISIONES QUE SOSTIENEN TODO LO DEMÁS:
 *
 * 1. **Los landmarks NO son números globales.** Escalan con la experiencia
 *    (`muscle-volume.landmarksFor`) y aquí, además, con la RECUPERACIÓN
 *    declarada. Un MRV fijo para todo el mundo fue exactamente el error de la
 *    v4.0 con las tasas de ganancia: una cifra de población presentada como si
 *    fuera de la persona que está mirando la pantalla.
 *
 * 2. **La frecuencia REPARTE el volumen, no lo crea.** Entrenar pecho tres días
 *    en vez de dos no da más series efectivas: da las mismas repartidas mejor.
 *    Modelarlo al revés hace que la app recomiende entrenar más días para
 *    «ganar más», que es falso y además es como se lesiona la gente.
 *
 * 3. **El deload se dispara por SEÑALES, no por calendario.** «Cada seis
 *    semanas» es una regla de manual que no mira al usuario: aquí hace falta que
 *    el rendimiento se haya estancado, que la recuperación esté baja o que el
 *    volumen lleve tiempo por encima del máximo recuperable. Y se OFRECE, no se
 *    aplica (B9).
 */

import { MUSCLE_GROUPS, landmarksFor, zoneOf, stimulusOf } from './muscle-volume.js';

/**
 * Métricas subjetivas del check-in que informan la recuperación (A2).
 *
 * Son las cuatro que la v1 ya recoge desde M4, y bastan: no hace falta un
 * wearable para saber que alguien duerme mal y arrastra fatiga. La adherencia
 * NO entra —mide constancia con la dieta, no capacidad de recuperar— y meterla
 * castigaría el volumen de quien entrena bien y come regular.
 * @type {readonly string[]}
 */
export const RECOVERY_KEYS = Object.freeze(['energy', 'sleep', 'motivation']);

/** Semanas de check-in que se miran para juzgar la recuperación. */
export const RECOVERY_WINDOW = 3;

/**
 * Cuánto puede encoger el techo de volumen cuando la recuperación está en el
 * suelo. 0,7 = el MRV baja un 30 %, no a cero: quien duerme mal sigue pudiendo
 * entrenar, solo que menos.
 */
export const MIN_RECOVERY_FACTOR = 0.7;

/** RIR con el que se progresa. Nunca al fallo constante. */
export const RIR_RANGE = Object.freeze({ min: 0, max: 3 });

/** Series que se añaden por semana al progresar. */
export const WEEKLY_SET_INCREMENT = 1;

/**
 * Recuperación declarada, de 0 a 1.
 *
 * Sale de las últimas semanas de check-in, no de la última: un día malo no es
 * fatiga acumulada, y bajarle el volumen a alguien porque durmió mal el martes
 * sería ruido disfrazado de señal.
 *
 * @param {Array<{ dateISO: string, subjective?: Record<string, number> }>} checkins
 * @param {number} [weeks]
 * @returns {{ score: number, samples: number, declared: boolean }}
 */
export function recoveryScore(checkins, weeks = RECOVERY_WINDOW) {
    const list = (Array.isArray(checkins) ? checkins : [])
        .slice()
        .sort((a, b) => String(a.dateISO).localeCompare(String(b.dateISO)))
        .slice(-Math.max(1, weeks));

    /** @type {number[]} */ const valores = [];
    for (const checkin of list) {
        for (const key of RECOVERY_KEYS) {
            const v = checkin?.subjective?.[key];
            if (typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 10) valores.push(v);
        }
    }
    // Sin datos NO se asume lo peor ni lo mejor: se asume neutro y se DICE que
    // no está declarado, para que la vista no presente una suposición como si
    // fuera una medida.
    if (valores.length === 0) return { score: 0.5, samples: 0, declared: false };

    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    // 1–10 → 0–1. El 5,5 (mitad de la escala) cae en 0,5.
    return {
        score: Math.round(((media - 1) / 9) * 1000) / 1000,
        samples: valores.length,
        declared: true
    };
}

/**
 * Landmarks ajustados por experiencia Y por recuperación.
 *
 * INVARIANTE `landmarks_por_individuo`: aquí no hay ninguna cifra global. La
 * base es de población (Israetel), la experiencia la escala, y la recuperación
 * declarada la escala otra vez. Dos personas con el mismo nivel y distinto sueño
 * no reciben el mismo techo, que es justamente lo que hace útil el número.
 *
 * Solo se toca el techo (MAV y MRV): el MÍNIMO efectivo no baja porque uno
 * duerma mal. Por debajo del MEV no hay estímulo, y fingir que sí lo hay para
 * que el número «cuadre» sería mentir en la dirección cómoda.
 *
 * @param {{ trainingStatus?: string, recovery?: number }} input
 * @returns {Record<string, { mv: number, mev: number, mav: number, mrv: number }>}
 */
export function individualLandmarks(input) {
    const base = landmarksFor(input?.trainingStatus ?? 'intermediate');
    const recovery = Number.isFinite(input?.recovery) ? /** @type {number} */ (input.recovery) : 0.5;
    const factor = MIN_RECOVERY_FACTOR + (1 - MIN_RECOVERY_FACTOR) * Math.min(1, Math.max(0, recovery));

    /** @type {Record<string, *>} */ const out = {};
    for (const group of MUSCLE_GROUPS) {
        const l = base[group];
        out[group] = {
            mv: l.mv,
            mev: l.mev,
            mav: Math.max(l.mev, Math.round(l.mav * factor)),
            mrv: Math.max(l.mev, Math.round(l.mrv * factor))
        };
    }
    return out;
}

/**
 * Series por sesión cuando un volumen semanal se reparte en N sesiones.
 *
 * INVARIANTE `frecuencia_reparte`: el total semanal NO cambia con la frecuencia.
 * Entrenar pecho tres días en vez de dos da las mismas series repartidas mejor,
 * no más estímulo. Modelarlo al revés hace que la app recomiende entrenar más
 * días «para ganar más», que es falso y es como se lesiona la gente.
 *
 * El reparto es entero y el resto se distribuye desde la primera sesión, así que
 * la suma cuadra exactamente con el semanal.
 *
 * @param {number} weeklySets
 * @param {number} sessionsPerWeek
 * @returns {number[]} series de cada sesión
 */
export function splitAcrossSessions(weeklySets, sessionsPerWeek) {
    const total = Math.max(0, Math.round(Number.isFinite(weeklySets) ? weeklySets : 0));
    const n = Math.max(1, Math.round(Number.isFinite(sessionsPerWeek) ? sessionsPerWeek : 1));
    const base = Math.floor(total / n);
    const resto = total - base * n;
    return Array.from({ length: n }, (_, i) => base + (i < resto ? 1 : 0));
}

/**
 * @typedef {Object} GroupPrescription
 * @property {string} group
 * @property {number} currentSets lo que se está haciendo
 * @property {number} targetSets lo que tocaría la semana que viene
 * @property {number} rir repeticiones en reserva
 * @property {string} action 'raise'|'hold'|'lower'|'start'
 * @property {import('./muscle-volume.js').VolumeZone} zone
 * @property {{ mv: number, mev: number, mav: number, mrv: number }} landmarks
 */

/**
 * Qué hacer la semana que viene con un grupo.
 *
 * INVARIANTE `rir_en_rango`: el RIR prescrito siempre cae entre 0 y 3. Baja a
 * medida que el volumen se acerca al MAV —el bloque acumula fatiga y se aprieta
 * al final, no al principio— pero nunca llega a «al fallo siempre», que es la
 * receta clásica para estancarse.
 *
 * @param {{ group: string, weeklySets: number, landmarks: { mv: number, mev: number, mav: number, mrv: number } }} input
 * @returns {GroupPrescription}
 */
export function prescribeGroup(input) {
    const l = input.landmarks;
    const actuales = Math.max(0, Number.isFinite(input?.weeklySets) ? input.weeklySets : 0);
    const zone = zoneOf(actuales, l);
    // El volumen MEDIDO puede ser fraccionario —una serie de sentadilla aporta
    // 0,4 al glúteo— pero el PRESCRITO no: nadie hace 5,8 series. Se redondea
    // al entero más cercano antes de sumar, no después, o el incremento
    // arrastraría el decimal semana tras semana.
    const base = Math.round(actuales);

    let targetSets = actuales;
    let action = 'hold';
    if (actuales <= 0) {
        // Empezar por el MÍNIMO efectivo, no por el máximo: saltar de cero a
        // MAV es la forma más rápida de no volver a la semana siguiente.
        targetSets = l.mev;
        action = 'start';
    } else if (actuales < l.mev) {
        targetSets = Math.min(l.mev, base + WEEKLY_SET_INCREMENT);
        action = 'raise';
    } else if (actuales < l.mav) {
        targetSets = Math.min(l.mav, base + WEEKLY_SET_INCREMENT);
        action = 'raise';
    } else if (actuales > l.mrv) {
        // Por encima del máximo recuperable se BAJA al máximo adaptativo, no se
        // recorta un poco: si la fatiga ya supera a la adaptación, quedarse
        // cerca del techo no arregla nada.
        targetSets = l.mav;
        action = 'lower';
    }

    // RIR: 3 en la zona baja, 0 pegado al MRV. Interpolación lineal sobre el
    // tramo MEV→MRV, acotada al rango.
    const tramo = Math.max(1, l.mrv - l.mev);
    const avance = Math.min(1, Math.max(0, (targetSets - l.mev) / tramo));
    const rir = Math.round(RIR_RANGE.max - avance * (RIR_RANGE.max - RIR_RANGE.min));

    return {
        group: input.group,
        currentSets: actuales,
        targetSets,
        rir: Math.min(RIR_RANGE.max, Math.max(RIR_RANGE.min, rir)),
        action,
        zone,
        landmarks: l
    };
}

/**
 * @typedef {Object} DeloadVerdict
 * @property {boolean} offer ¿se ofrece bajar? Nunca se aplica solo (B9)
 * @property {string[]} reasons códigos i18n de las señales que lo dispararon
 * @property {Record<string, number>} suggestedSets volumen propuesto por grupo
 */

/**
 * ¿Toca descargar?
 *
 * INVARIANTE `deload_por_señal`: nunca por calendario. Tres señales, y basta con
 * una: recuperación declarada baja, volumen por encima del MRV en algún grupo, o
 * rendimiento estancado. «Cada seis semanas» es una regla de manual que no mira
 * a quien la aplica.
 *
 * Y se OFRECE. Aplicar una descarga sin preguntar sería exactamente lo que este
 * proyecto no hace con la recalibración (B9): la app propone, el usuario decide.
 *
 * @param {{
 *   groups: Array<{ group: string, weeklySets: number, landmarks: * , zone: string }>,
 *   recovery: { score: number, declared: boolean },
 *   stalled?: boolean
 * }} input
 * @returns {DeloadVerdict}
 */
export function deloadCheck(input) {
    /** @type {string[]} */ const reasons = [];
    const groups = Array.isArray(input?.groups) ? input.groups : [];

    // Señal 1: recuperación baja, y solo si está DECLARADA. Un usuario que no
    // rellena las métricas no debe recibir una descarga por su silencio.
    if (input?.recovery?.declared && input.recovery.score < 0.4) reasons.push('deload.lowRecovery');

    // Señal 2: algún grupo por encima de su máximo recuperable.
    const excedidos = groups.filter((g) => g.zone === 'aboveMrv');
    if (excedidos.length > 0) reasons.push('deload.aboveMrv');

    // Señal 3: rendimiento estancado, que lo juzga quien tiene el histórico.
    if (input?.stalled === true) reasons.push('deload.stalled');

    /** @type {Record<string, number>} */ const suggestedSets = {};
    for (const g of groups) {
        // La descarga baja al MÍNIMO efectivo, no a cero: se descarga para
        // recuperar manteniendo el estímulo, no para perder lo ganado.
        suggestedSets[g.group] = reasons.length > 0 ? g.landmarks.mev : g.weeklySets;
    }

    return { offer: reasons.length > 0, reasons, suggestedSets };
}

/**
 * El plan de la semana: qué toca en cada grupo, con su porqué.
 *
 * @param {{
 *   report: { groups: Array<{ group: string, weeklySets: number }> },
 *   trainingStatus?: string,
 *   checkins?: Array<{ dateISO: string, subjective?: Record<string, number> }>,
 *   sessionsPerWeek?: number,
 *   stalled?: boolean
 * }} input
 * @returns {{
 *   recovery: { score: number, samples: number, declared: boolean },
 *   groups: Array<GroupPrescription & { perSession: number[], stimulus: number }>,
 *   deload: DeloadVerdict
 * }}
 */
export function weeklyPlan(input) {
    const recovery = recoveryScore(input?.checkins ?? []);
    const landmarks = individualLandmarks({
        trainingStatus: input?.trainingStatus,
        recovery: recovery.score
    });
    const sessionsPerWeek = Number.isFinite(input?.sessionsPerWeek) && /** @type {number} */ (input.sessionsPerWeek) > 0
        ? /** @type {number} */ (input.sessionsPerWeek)
        : 2;

    const medido = new Map((input?.report?.groups ?? []).map((g) => [g.group, g.weeklySets]));
    const groups = MUSCLE_GROUPS.map((group) => {
        const weeklySets = medido.get(group) ?? 0;
        const p = prescribeGroup({ group, weeklySets, landmarks: landmarks[group] });
        return {
            ...p,
            perSession: splitAcrossSessions(p.targetSets, sessionsPerWeek),
            stimulus: Math.round(stimulusOf(weeklySets, landmarks[group]) * 1000) / 1000
        };
    });

    return {
        recovery,
        groups,
        deload: deloadCheck({
            groups: groups.map((g) => ({
                group: g.group, weeklySets: g.currentSets, landmarks: g.landmarks, zone: g.zone
            })),
            recovery,
            stalled: input?.stalled
        })
    };
}

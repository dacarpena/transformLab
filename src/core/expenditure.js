// @ts-check

/**
 * Gasto energético MEDIDO, reconstruido de los datos reales (V2-M1).
 *
 * LA IDEA, y por qué es honesta. El TDEE de fórmula (Mifflin + multiplicador de
 * actividad) es una estimación de población: acierta la media y falla a cada
 * individuo, a veces por 400 kcal. Pero si sabemos lo que alguien COMIÓ y cómo
 * cambió su peso, el gasto se despeja del balance energético invertido:
 *
 *     gasto ≈ ingesta_media − (Δpeso_tendencia · 7700 kcal/kg) / días
 *
 * Es aritmética de conservación de la energía, no un modelo. MacroFactor hace
 * esto y no publica su filtro («secret sauce»); aquí la fórmula está a la vista
 * y sus términos se le enseñan al usuario. Y como todo en este proyecto, el
 * resultado se OFRECE (B9): nunca se recalibran las calorías en silencio.
 *
 * LA TRAMPA, Y ESTÁ CUBIERTA. El peso diario es ruido: agua, glucógeno, sal,
 * qué hora te pesaste. Restar dos pesadas sueltas da un gasto que oscila cientos
 * de kcal. Por eso el Δ NO se calcula sobre pesadas, sino sobre la TENDENCIA —
 * media móvil— de dos ventanas. `tracking.js` ya aprendió esta lección en M4
 * (el suelo de ruido de la tolerancia); aquí se aplica a la otra magnitud.
 *
 * LÍMITES, dichos por su nombre:
 * - Basura entra, basura sale: si el usuario subregistra la ingesta —y casi todo
 *   el mundo lo hace—, el gasto medido sale bajo. La app no puede detectarlo, y
 *   por eso no se presenta como una verdad sino como «lo que dicen tus datos».
 * - Hacen falta al menos `MIN_DAYS` de registro. Antes de eso se devuelve
 *   `null`, no una cifra mala: media docena de días no distinguen señal de agua.
 */

import { KCAL_PER_KG_FAT, ACTIVITY_MULTIPLIERS} from './constants.js';

/**
 * Días mínimos de registro antes de dar una cifra.
 *
 * Catorce, no siete: un ciclo semanal completo mete el efecto del fin de semana
 * (más comida, menos actividad) en las dos ventanas y no solo en una, y dos
 * semanas dan margen para que el ruido de agua se promedie. MacroFactor pide
 * una cantidad parecida antes de mover nada.
 */
export const MIN_DAYS = 14;

/**
 * Días de la media móvil de la tendencia de peso.
 *
 * Siete: exactamente una semana, para que el promedio no dependa de en qué día
 * empieza la ventana.
 */
export const TREND_WINDOW_DAYS = 7;

/**
 * Cambio máximo creíble de peso en un día, en kg. Por encima, la lectura es un
 * error de tecleo o una báscula distinta, no fisiología: se descarta del cálculo
 * de la tendencia en vez de dejar que arrastre el gasto a un absurdo.
 */
export const MAX_PLAUSIBLE_DAILY_KG = 2;

/**
 * @typedef {{ dateISO: string, kcal: number }} IntakeEntry
 * @typedef {{ dateISO: string, weightKg: number }} WeightEntry
 */

/**
 * @typedef {Object} Expenditure
 * @property {number} tdeeKcal gasto medido, kcal/día
 * @property {number} intakeMeanKcal ingesta media del periodo
 * @property {number} trendDeltaKg cambio de la TENDENCIA (no de dos pesadas)
 * @property {number} days días cubiertos
 * @property {number} intakeDays días con ingesta registrada
 * @property {{ startKg: number, endKg: number }} trend extremos de la tendencia
 */

/** @param {unknown} v @returns {v is number} */
function isFinite_(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/** @param {string} dateISO @returns {number} milisegundos UTC, o NaN */
function ms(dateISO) {
    return Date.parse(`${String(dateISO).slice(0, 10)}T00:00:00Z`);
}

/**
 * Media móvil del peso: convierte pesadas ruidosas en una tendencia.
 *
 * Cada punto es la media de los `window` días anteriores CON dato (no de los
 * `window` registros anteriores): así, saltarse tres días no comprime la
 * ventana ni finge una tendencia que no se midió.
 *
 * `full` distingue los puntos con la ventana COMPLETA de los del principio de
 * la serie, que promedian menos días de los pedidos. La distinción no es
 * cosmética: el valor de un punto representa el CENTRO de su ventana, así que
 * mezclar un punto de ventana incompleta (centro ≈ su propia fecha) con uno
 * completa (centro ≈ fecha − 3 días) hace que el Δ de la tendencia abarque
 * menos días que el divisor, y el gasto sale sesgado. Lo cazaron los tests:
 * 2 523 kcal donde la aritmética a mano da 2 550.
 *
 * @param {WeightEntry[]} weights
 * @param {number} [window]
 * @returns {Array<{ dateISO: string, trendKg: number, full: boolean }>}
 */
export function weightTrend(weights, window = TREND_WINDOW_DAYS) {
    if (!Array.isArray(weights)) return [];
    const clean = weights
        .filter((w) => w && typeof w.dateISO === 'string' && isFinite_(w.weightKg) && !Number.isNaN(ms(w.dateISO)))
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    if (clean.length === 0) return [];

    // Una lectura que se dispara respecto a la anterior es un error de tecleo
    // (85 → 8,5 → 850), no fisiología. Se descarta antes de promediar, porque
    // una sola arrastra la media de toda la ventana.
    /** @type {WeightEntry[]} */ const plausible = [clean[0]];
    for (let i = 1; i < clean.length; i++) {
        const prev = plausible[plausible.length - 1];
        const days = Math.max(1, Math.round((ms(clean[i].dateISO) - ms(prev.dateISO)) / 86400000));
        if (Math.abs(clean[i].weightKg - prev.weightKg) / days <= MAX_PLAUSIBLE_DAILY_KG) {
            plausible.push(clean[i]);
        }
    }

    const windowMs = window * 86400000;
    return plausible.map((entry) => {
        const until = ms(entry.dateISO);
        const from = until - windowMs;
        const inWindow = plausible.filter((w) => {
            const t = ms(w.dateISO);
            return t > from && t <= until;
        });
        const sum = inWindow.reduce((acc, w) => acc + w.weightKg, 0);
        // Completa = la ventana llega hasta el principio de los `window` días,
        // o sea que hay un dato en el primer día del rango o antes.
        const full = ms(plausible[0].dateISO) <= from + 86400000;
        return { dateISO: entry.dateISO, trendKg: sum / inWindow.length, full };
    });
}

/**
 * Reconstruye el gasto diario a partir de la ingesta registrada y del peso real.
 *
 * Devuelve `null` —y no una cifra mala— cuando no hay datos suficientes: un
 * número inventado es peor que un «todavía no lo sé».
 *
 * @param {{ intake: IntakeEntry[], weights: WeightEntry[], minDays?: number }} input
 * @returns {Expenditure | null}
 */
export function measuredExpenditure(input) {
    const intake = Array.isArray(input?.intake) ? input.intake : [];
    const weights = Array.isArray(input?.weights) ? input.weights : [];
    const minDays = isFinite_(input?.minDays) ? /** @type {number} */ (input.minDays) : MIN_DAYS;

    // SOLO los puntos con la ventana completa. Con los del principio incluidos,
    // el Δ de la tendencia abarcaba menos días que el divisor y el gasto salía
    // sesgado (~1 %); además esos puntos conservan casi todo el ruido, que es
    // justo lo que la media móvil venía a quitar.
    const trend = weightTrend(weights).filter((t) => t.full);
    if (trend.length < 2) return null;

    const firstISO = trend[0].dateISO;
    const lastISO = trend[trend.length - 1].dateISO;
    const days = Math.round((ms(lastISO) - ms(firstISO)) / 86400000);
    if (!Number.isFinite(days) || days < minDays) return null;

    // Solo la ingesta DENTRO del periodo cubierto por la tendencia: sumar
    // registros de antes o de después mezclaría dos regímenes distintos.
    const inRange = intake.filter((e) =>
        e && typeof e.dateISO === 'string' && isFinite_(e.kcal) && e.kcal >= 0
        && ms(e.dateISO) >= ms(firstISO) && ms(e.dateISO) <= ms(lastISO));
    // Un día por fecha: dos registros del mismo día son una corrección, no dos
    // comidas — se queda el último, como en `checkins.js`.
    /** @type {Map<string, number>} */ const byDate = new Map();
    for (const e of inRange) byDate.set(e.dateISO.slice(0, 10), e.kcal);
    if (byDate.size < minDays) return null;

    const intakeMeanKcal = [...byDate.values()].reduce((a, b) => a + b, 0) / byDate.size;
    const trendDeltaKg = trend[trend.length - 1].trendKg - trend[0].trendKg;

    // El balance invertido. El signo: si el peso BAJA, `trendDeltaKg` es
    // negativo y el gasto sale POR ENCIMA de la ingesta, que es lo correcto.
    const tdeeKcal = intakeMeanKcal - (trendDeltaKg * KCAL_PER_KG_FAT) / days;
    if (!Number.isFinite(tdeeKcal)) return null;

    return {
        tdeeKcal: Math.round(tdeeKcal),
        intakeMeanKcal: Math.round(intakeMeanKcal),
        trendDeltaKg: Number(trendDeltaKg.toFixed(2)),
        days,
        intakeDays: byDate.size,
        trend: {
            startKg: Number(trend[0].trendKg.toFixed(2)),
            endKg: Number(trend[trend.length - 1].trendKg.toFixed(2))
        }
    };
}

/**
 * Diferencia mínima entre el gasto medido y el de fórmula para que valga la
 * pena ofrecer recalibrar, en kcal/día.
 *
 * 150 kcal: por debajo, la diferencia cabe dentro del error de registro del
 * propio usuario, y mover el plan por ruido es exactamente el fallo que más
 * daña la credibilidad del producto (la misma lección que el suelo de ruido de
 * M4). Por encima, son ~1 kg de grasa cada siete semanas: se nota.
 */
export const MEANINGFUL_GAP_KCAL = 150;

/**
 * @typedef {Object} ExpenditureVerdict
 * @property {boolean} offer ¿procede OFRECER recalibrar las calorías?
 * @property {'insufficientData'|'agrees'|'higher'|'lower'} reason
 * @property {number | null} measuredKcal
 * @property {number} formulaKcal
 * @property {number | null} gapKcal medido − fórmula
 */

/**
 * Compara el gasto medido con el de fórmula y decide si procede OFRECER
 * recalibrar. Nunca decide recalibrar: eso es del usuario (B9).
 *
 * @param {Expenditure | null} measured
 * @param {number} formulaKcal el TDEE que usó el plan
 * @returns {ExpenditureVerdict}
 */
export function compareWithFormula(measured, formulaKcal) {
    const formula = isFinite_(formulaKcal) ? formulaKcal : 0;
    if (measured === null) {
        return { offer: false, reason: 'insufficientData', measuredKcal: null, formulaKcal: formula, gapKcal: null };
    }
    const gapKcal = Math.round(measured.tdeeKcal - formula);
    if (Math.abs(gapKcal) < MEANINGFUL_GAP_KCAL) {
        return { offer: false, reason: 'agrees', measuredKcal: measured.tdeeKcal, formulaKcal: formula, gapKcal };
    }
    return {
        offer: true,
        reason: gapKcal > 0 ? 'higher' : 'lower',
        measuredKcal: measured.tdeeKcal,
        formulaKcal: formula,
        gapKcal
    };
}

/**
 * El nivel de actividad cuyo multiplicador mejor explica el gasto MEDIDO.
 *
 * El motor no admite un TDEE a mano: lo calcula como `BMR × multiplicador`
 * (Mifflin-St Jeor + los multiplicadores de Harris-Benedict). Así que aplicar un
 * gasto medido significa exactamente una cosa —corregir el nivel de actividad
 * del perfil— y no otra. Decirlo así, y no «ajusto tus calorías», es lo que
 * permite que el usuario entienda qué se le va a cambiar.
 *
 * **Devuelve también el residuo**, y ése es el punto. Los cinco multiplicadores
 * son una rejilla gruesa: un gasto medido cae entre dos escalones y algo se
 * queda fuera. Callarlo sería prometer una precisión que el modelo no tiene, así
 * que se devuelve y la interfaz lo dice cuando importa.
 *
 * @param {number} measuredTdeeKcal el gasto medido
 * @param {number} bmrKcal el metabolismo basal del perfil
 * @returns {{ level: string, multiplier: number, ratio: number, residualKcal: number } | null}
 */
export function activityLevelFor(measuredTdeeKcal, bmrKcal) {
    if (!isFinite_(measuredTdeeKcal) || !isFinite_(bmrKcal) || bmrKcal <= 0) return null;
    const ratio = measuredTdeeKcal / bmrKcal;

    /** @type {{ level: string, multiplier: number } | null} */ let best = null;
    let mejorDistancia = Infinity;
    for (const [level, multiplier] of Object.entries(ACTIVITY_MULTIPLIERS)) {
        const distancia = Math.abs(multiplier - ratio);
        if (distancia < mejorDistancia) {
            mejorDistancia = distancia;
            best = { level, multiplier };
        }
    }
    if (best === null) return null;
    return {
        level: best.level,
        multiplier: best.multiplier,
        ratio,
        residualKcal: Math.round(measuredTdeeKcal - bmrKcal * best.multiplier)
    };
}

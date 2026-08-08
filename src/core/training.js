// @ts-check

/**
 * Entrenamiento (decisión E5a): 1RM estimado, detección de récords y
 * progresión sugerida a partir del histórico REAL del usuario.
 *
 * Puro y testeable, como el resto de `src/core/`. El legacy traía la
 * progresión como un número fijo por ejercicio dentro de un programa
 * hardcodeado; aquí la sugerencia se deriva de lo que el usuario ha hecho de
 * verdad, y la rutina es una plantilla suya que puede editar.
 */

/**
 * @typedef {Object} SetEntry
 * @property {number} reps
 * @property {number} loadKg
 *
 * @typedef {Object} SessionEntry
 * @property {string} exerciseId
 * @property {SetEntry[]} sets
 *
 * @typedef {Object} Session
 * @property {string} id
 * @property {string} dateISO
 * @property {SessionEntry[]} entries
 *
 * @typedef {Object} PersonalRecord
 * @property {string} exerciseId
 * @property {number} bestLoadKg carga máxima movida
 * @property {number} bestReps repeticiones en esa carga
 * @property {number} bestE1rmKg mejor 1RM estimado
 * @property {string} dateISO cuándo se logró
 */

/**
 * Incrementos de carga disponibles en un gimnasio normal (kg).
 * Decisión de producto: son los discos que existen, no una afirmación
 * fisiológica. La sugerencia se redondea a uno de estos saltos.
 */
export const LOAD_STEPS_KG = Object.freeze([1.25, 2.5, 5]);

/**
 * Sesiones consecutivas cumpliendo el tope del rango antes de sugerir subir.
 * Decisión de producto: dos sesiones evitan que un buen día dispare una
 * subida que luego no se sostiene (doble progresión, práctica habitual).
 */
export const SESSIONS_BEFORE_PROGRESSION = 2;

/**
 * Mejora mínima de 1RM estimado para considerarlo récord (kg).
 *
 * Sin esto, dos esfuerzos matemáticamente equivalentes rompen el empate por
 * error de coma flotante: 77,5 kg × 10 y 100 kg × 1 dan ambos 103,333… kg,
 * pero uno sale 1,4e-14 mayor y la app anuncia un récord por nada. Barriendo
 * cargas de gimnasio hay 90 grupos de esfuerzos exactamente equivalentes.
 * 10 gramos está por debajo de cualquier disco real.
 */
const RECORD_MIN_GAIN_KG = 0.01;

/** @param {unknown} v @returns {v is number} */
function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * 1RM estimado por la fórmula de Epley (1985): 1RM = carga × (1 + reps/30).
 *
 * Se usa Epley y no Brzycki porque es la más extendida y se comporta mejor en
 * el rango de 1–10 repeticiones, que es donde vive el entrenamiento de fuerza
 * de este producto. Por encima de ~12 repeticiones cualquier estimación pierde
 * fiabilidad, así que se acota: no se extrapola a series muy largas.
 * @param {number} reps
 * @param {number} loadKg
 * @returns {number} kg, o NaN si la entrada no es utilizable
 */
export function estimatedOneRepMax(reps, loadKg) {
    if (!isFiniteNumber(reps) || !isFiniteNumber(loadKg)) return NaN;
    if (reps < 1 || loadKg <= 0) return NaN;
    // más allá de 12 repeticiones la fórmula deja de ser informativa
    const effectiveReps = Math.min(12, reps);
    return loadKg * (1 + effectiveReps / 30);
}

/**
 * Récords de un ejercicio a partir del histórico.
 * @param {Session[]} sessions
 * @param {string} exerciseId
 * @returns {PersonalRecord | null}
 */
export function personalRecord(sessions, exerciseId) {
    if (!Array.isArray(sessions) || typeof exerciseId !== 'string') return null;

    /** @type {PersonalRecord | null} */ let best = null;
    for (const session of sessions) {
        if (!session || typeof session !== 'object' || !Array.isArray(session.entries)) continue;
        if (typeof session.dateISO !== 'string') continue;
        for (const entry of session.entries) {
            if (!entry || entry.exerciseId !== exerciseId || !Array.isArray(entry.sets)) continue;
            for (const set of entry.sets) {
                if (!set || !isFiniteNumber(set.reps) || !isFiniteNumber(set.loadKg)) continue;
                const e1rm = estimatedOneRepMax(set.reps, set.loadKg);
                if (!isFiniteNumber(e1rm)) continue;
                if (best === null || e1rm > best.bestE1rmKg) {
                    best = {
                        exerciseId,
                        bestLoadKg: set.loadKg,
                        bestReps: set.reps,
                        bestE1rmKg: e1rm,
                        dateISO: session.dateISO
                    };
                }
            }
        }
    }
    return best;
}

/**
 * ¿La sesión más reciente batió algún récord? Devuelve los ejercicios en los
 * que se logró, comparando contra TODO lo anterior.
 * @param {Session[]} sessions histórico completo, incluida la última
 * @param {string} sessionId la sesión a evaluar
 * @returns {string[]} ids de ejercicio con récord nuevo
 */
export function newRecordsIn(sessions, sessionId) {
    if (!Array.isArray(sessions)) return [];
    const target = sessions.find((s) => s && s.id === sessionId);
    if (!target || !Array.isArray(target.entries)) return [];

    // el histórico ANTERIOR: un récord se bate contra el pasado, no contra sí mismo
    const previous = sessions.filter((s) => s && s.id !== sessionId
        && typeof s.dateISO === 'string' && s.dateISO <= target.dateISO);

    // Un conjunto, no una lista: una sesión puede traer varias entradas del
    // mismo ejercicio (una rutina que lo repite en dos días, o dos ejercicios
    // con el id colisionado). Empujando por entrada se anunciaba el mismo
    // récord dos veces y `pr10` se desbloqueaba con cinco récords reales.
    /** @type {Set<string>} */ const out = new Set();
    for (const entry of target.entries) {
        if (!entry || typeof entry.exerciseId !== 'string') continue;
        if (out.has(entry.exerciseId)) continue;
        const now = personalRecord([target], entry.exerciseId);
        if (!now) continue;
        const before = personalRecord(previous, entry.exerciseId);
        // sin histórico previo NO es un récord: es el primer registro
        if (before !== null && now.bestE1rmKg > before.bestE1rmKg + RECORD_MIN_GAIN_KG) {
            out.add(entry.exerciseId);
        }
    }
    return [...out];
}

/**
 * Redondea un incremento al salto de disco más cercano y disponible.
 * @param {number} kg
 * @returns {number}
 */
function roundToStep(kg) {
    if (!isFiniteNumber(kg) || kg <= 0) return LOAD_STEPS_KG[0];
    let best = LOAD_STEPS_KG[0];
    let bestDiff = Math.abs(kg - best);
    for (const step of LOAD_STEPS_KG) {
        const diff = Math.abs(kg - step);
        if (diff < bestDiff) {
            best = step;
            bestDiff = diff;
        }
    }
    return best;
}

/**
 * Progresión sugerida para un ejercicio, derivada del histórico real
 * (doble progresión: primero se completa el rango de repeticiones, luego sube
 * la carga).
 *
 * Devuelve `hold` mientras no se cumpla el tope del rango en todas las series
 * durante `SESSIONS_BEFORE_PROGRESSION` sesiones consecutivas. Nunca sugiere
 * bajar: si el usuario retrocede, la app no le regaña.
 * @param {Session[]} sessions
 * @param {{ id: string, sets: number, reps: number }} exercise el `reps` es el tope del rango
 * @returns {{ action: 'hold' | 'increase' | 'start', loadKg: number | null, incrementKg: number, reason: string }}
 */
export function suggestProgression(sessions, exercise) {
    const none = { action: /** @type {const} */ ('start'), loadKg: null, incrementKg: 0, reason: 'training.noHistory' };
    if (!Array.isArray(sessions) || !exercise || typeof exercise.id !== 'string') return none;
    if (!isFiniteNumber(exercise.sets) || !isFiniteNumber(exercise.reps)) return none;

    // sesiones con este ejercicio, de la más reciente a la más antigua
    const relevant = sessions
        .filter((s) => s && Array.isArray(s.entries) && typeof s.dateISO === 'string'
            && s.entries.some((e) => e && e.exerciseId === exercise.id))
        .sort((a, b) => b.dateISO.localeCompare(a.dateISO));

    if (relevant.length === 0) return none;

    const lastEntry = relevant[0].entries.find((e) => e.exerciseId === exercise.id);
    const lastSets = lastEntry && Array.isArray(lastEntry.sets) ? lastEntry.sets : [];
    const currentLoad = lastSets.length > 0
        ? Math.max(...lastSets.map((s) => (isFiniteNumber(s?.loadKg) ? s.loadKg : 0)))
        : null;

    if (currentLoad === null || currentLoad <= 0) {
        return { action: 'start', loadKg: null, incrementKg: 0, reason: 'training.noHistory' };
    }

    /**
     * ¿Esa sesión completó el tope del rango en todas las series previstas?
     * @param {Session} session
     * @returns {boolean}
     */
    const completedTop = (session) => {
        const entry = session.entries.find((/** @type {SessionEntry} */ e) => e && e.exerciseId === exercise.id);
        if (!entry || !Array.isArray(entry.sets)) return false;
        const valid = entry.sets.filter((/** @type {SetEntry} */ s) => s && isFiniteNumber(s.reps) && isFiniteNumber(s.loadKg));
        if (valid.length < exercise.sets) return false;
        return valid.every((/** @type {SetEntry} */ s) => s.reps >= exercise.reps && s.loadKg >= currentLoad);
    };

    const streak = relevant.slice(0, SESSIONS_BEFORE_PROGRESSION);
    if (streak.length >= SESSIONS_BEFORE_PROGRESSION && streak.every(completedTop)) {
        // el salto se escala con la carga: 2,5 % es un incremento sostenible
        const incrementKg = roundToStep(currentLoad * 0.025);
        return { action: 'increase', loadKg: currentLoad + incrementKg, incrementKg, reason: 'training.readyToIncrease' };
    }
    return { action: 'hold', loadKg: currentLoad, incrementKg: 0, reason: 'training.keepWorking' };
}

/**
 * Volumen total movido en una sesión (series × reps × carga), útil como
 * resumen. Ignora en silencio las series mal formadas.
 * @param {Session} session
 * @returns {number} kg
 */
export function sessionVolumeKg(session) {
    if (!session || !Array.isArray(session.entries)) return 0;
    let total = 0;
    for (const entry of session.entries) {
        if (!entry || !Array.isArray(entry.sets)) continue;
        for (const set of entry.sets) {
            if (!set || !isFiniteNumber(set.reps) || !isFiniteNumber(set.loadKg)) continue;
            if (set.reps < 0 || set.loadKg < 0) continue;
            total += set.reps * set.loadKg;
        }
    }
    return total;
}

/**
 * El mejor 1RM estimado de cada día que tocó ese ejercicio.
 *
 * Existe porque `personalRecord()` colapsa TODO el histórico a un solo mejor
 * esfuerzo: sirve para anunciar un récord, no para dibujar una progresión. Una
 * gráfica necesita el récord de cada día, no el de la vida.
 *
 * Por DÍA y no por sesión: dos sesiones el mismo día son un día de
 * entrenamiento, y la gráfica tiene como mucho un punto por día. Si las hay, se
 * queda con el mejor esfuerzo del día — que es lo que significa «mi 1RM ese día».
 *
 * @param {Session[]} sessions
 * @param {string} exerciseId
 * @returns {Array<{ dateISO: string, e1rmKg: number, loadKg: number, reps: number }>}
 *   orden creciente por fecha
 */
export function e1rmSeries(sessions, exerciseId) {
    if (!Array.isArray(sessions) || typeof exerciseId !== 'string') return [];

    /** @type {Map<string, { dateISO: string, e1rmKg: number, loadKg: number, reps: number }>} */
    const byDate = new Map();
    for (const session of sessions) {
        if (!session || typeof session !== 'object' || !Array.isArray(session.entries)) continue;
        if (typeof session.dateISO !== 'string') continue;
        for (const entry of session.entries) {
            if (!entry || entry.exerciseId !== exerciseId || !Array.isArray(entry.sets)) continue;
            for (const set of entry.sets) {
                if (!set) continue;
                const e1rm = estimatedOneRepMax(set.reps, set.loadKg);
                if (!isFiniteNumber(e1rm)) continue;
                const previo = byDate.get(session.dateISO);
                if (!previo || e1rm > previo.e1rmKg) {
                    byDate.set(session.dateISO, {
                        dateISO: session.dateISO, e1rmKg: e1rm,
                        loadKg: set.loadKg, reps: set.reps
                    });
                }
            }
        }
    }
    return [...byDate.values()].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

/**
 * Tonelaje por FECHA: series × reps × carga de todo lo que se movió ese día.
 *
 * `sessionVolumeKg` solo sabe de una sesión suelta, y quien mira una gráfica de
 * tonelaje pregunta «cuánto moví el martes», no «cuánto moví en la segunda de
 * las dos sesiones del martes». Se suman.
 *
 * Ojo al agregar esta serie a una granularidad más gruesa: es una SUMA, no un
 * nivel. Muestrear el día de cierre de la semana enseñaría el tonelaje de un
 * día donde el usuario espera el de la semana.
 *
 * @param {Session[]} sessions
 * @returns {Array<{ dateISO: string, kg: number, sessions: number }>}
 *   orden creciente por fecha
 */
export function tonnageSeries(sessions) {
    if (!Array.isArray(sessions)) return [];

    /** @type {Map<string, { dateISO: string, kg: number, sessions: number }>} */
    const byDate = new Map();
    for (const session of sessions) {
        if (!session || typeof session !== 'object') continue;
        if (typeof session.dateISO !== 'string') continue;
        const kg = sessionVolumeKg(session);
        const previo = byDate.get(session.dateISO);
        if (previo) {
            previo.kg += kg;
            previo.sessions += 1;
        } else {
            byDate.set(session.dateISO, { dateISO: session.dateISO, kg, sessions: 1 });
        }
    }
    return [...byDate.values()].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
}

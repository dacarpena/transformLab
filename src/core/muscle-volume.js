// @ts-check

/**
 * Volumen semanal por grupo muscular, y qué significa (V2-M6).
 *
 * Es el módulo que convierte «hice 4 series de sentadilla» en «esta semana el
 * cuádriceps ha recibido X series efectivas, que está por debajo de su mínimo
 * útil». De aquí sale el estímulo que V2-M9 repartirá entre grupos para
 * proyectar la ganancia muscular.
 *
 * LOS LANDMARKS. MV / MEV / MAV / MRV son el vocabulario de Renaissance
 * Periodization (Israetel y cols.): volumen de mantenimiento, mínimo efectivo,
 * máximo adaptativo y máximo recuperable, medidos en SERIES EFECTIVAS POR SEMANA
 * y por grupo. Son orientaciones de población con una dispersión individual
 * enorme, así que aquí se usan como PARÁMETROS con su fuente citada, nunca como
 * verdades: la app enseña dónde caes y por qué, y deja decidir.
 *
 * LA SERIE EFECTIVA, y por qué no es un booleano. Un músculo que trabaja de
 * secundario no recibe cero estímulo: recibe menos. Contar solo el motor
 * primario —que era el diseño inicial— produce un absurdo medible sobre el
 * catálogo real: el peso muerto tiene «lower back» como primario, la sentadilla
 * «quadriceps», y solo 11 de 556 ejercicios tienen glúteo como primario. Alguien
 * que sentadillea y hace peso muerto tres veces por semana acumularía CERO
 * estímulo de glúteo y la proyección diría que no crece. Con pesos (1 el
 * primario, 0,4 el secundario) esa misma rutina da 4,4 series efectivas de
 * glúteo — por debajo de su MEV, que es exactamente lo que la app debe decirle.
 */

/**
 * Los diez grupos sobre los que el motor razona.
 *
 * Son los que tienen landmarks de volumen publicados. El catálogo de ejercicios
 * usa diecisiete músculos finos de la taxonomía de culturismo; la traducción a
 * estos diez vive en `tools/build-exercise-db.mjs`, en la frontera de los datos,
 * y cuatro (cuello, antebrazo, aductores, abductores) se descartan a propósito:
 * proyectar ganancia sobre un músculo del que no conocemos su dosis mínima sería
 * inventarse la cifra.
 * @type {readonly string[]}
 */
export const MUSCLE_GROUPS = Object.freeze([
    'chest', 'back', 'shoulders', 'biceps', 'triceps',
    'quads', 'hamstrings', 'glutes', 'calves', 'core'
]);

/**
 * Series efectivas semanales por grupo (Israetel / Renaissance Periodization,
 * «Scientific Principles of Hypertrophy Training», tablas de landmarks).
 *
 * - `mv`  volumen de mantenimiento: lo mínimo para no perder.
 * - `mev` mínimo efectivo: por debajo, no hay estímulo de crecimiento.
 * - `mav` máximo adaptativo: la zona donde más se progresa.
 * - `mrv` máximo recuperable: por encima, la fatiga supera a la adaptación.
 *
 * Cifras de población con dispersión individual grande. Se escalan por
 * experiencia en `landmarksFor`, porque un principiante crece con la mitad de
 * volumen que satura a un avanzado.
 * @type {Readonly<Record<string, { mv: number, mev: number, mav: number, mrv: number }>>}
 */
export const BASE_LANDMARKS = Object.freeze({
    chest:      Object.freeze({ mv: 8,  mev: 10, mav: 20, mrv: 22 }),
    back:       Object.freeze({ mv: 8,  mev: 10, mav: 22, mrv: 25 }),
    shoulders:  Object.freeze({ mv: 6,  mev: 8,  mav: 22, mrv: 26 }),
    biceps:     Object.freeze({ mv: 5,  mev: 8,  mav: 20, mrv: 26 }),
    triceps:    Object.freeze({ mv: 4,  mev: 6,  mav: 18, mrv: 24 }),
    quads:      Object.freeze({ mv: 6,  mev: 8,  mav: 18, mrv: 20 }),
    hamstrings: Object.freeze({ mv: 4,  mev: 6,  mav: 16, mrv: 20 }),
    glutes:     Object.freeze({ mv: 0,  mev: 4,  mav: 12, mrv: 16 }),
    calves:     Object.freeze({ mv: 6,  mev: 8,  mav: 16, mrv: 20 }),
    core:       Object.freeze({ mv: 0,  mev: 6,  mav: 16, mrv: 25 })
});

/**
 * Factor de volumen por experiencia.
 *
 * Un principiante progresa con bastante menos volumen y su capacidad de
 * recuperación es menor; un avanzado necesita más para seguir estimulando. Es
 * el mismo criterio de `trainingStatus` que ya usa el motor de composición.
 * @type {Readonly<Record<string, number>>}
 */
export const EXPERIENCE_FACTOR = Object.freeze({
    beginner: 0.65,
    intermediate: 1,
    advanced: 1.2
});

/**
 * Landmarks ajustados a la experiencia del usuario.
 * @param {string} trainingStatus
 * @returns {Record<string, { mv: number, mev: number, mav: number, mrv: number }>}
 */
export function landmarksFor(trainingStatus) {
    const factor = EXPERIENCE_FACTOR[trainingStatus] ?? EXPERIENCE_FACTOR.intermediate;
    /** @type {Record<string, *>} */ const out = {};
    for (const group of MUSCLE_GROUPS) {
        const base = BASE_LANDMARKS[group];
        out[group] = {
            mv: Math.round(base.mv * factor),
            mev: Math.round(base.mev * factor),
            mav: Math.round(base.mav * factor),
            mrv: Math.round(base.mrv * factor)
        };
    }
    return out;
}

/**
 * @typedef {{ id: string, name: string, muscles: Record<string, number> }} Exercise
 * @typedef {{ dateISO: string, entries: Array<{ exerciseId: string, sets: Array<*> }> }} Session
 */

/**
 * Series efectivas por grupo en un conjunto de sesiones.
 *
 * «Efectivas» y no «totales»: cada serie aporta a cada grupo según su peso en el
 * ejercicio (1 el motor primario, 0,4 los secundarios). Un ejercicio que no está
 * en el catálogo aporta cero y se anota en `unknown`, en vez de descartarse en
 * silencio: si alguien lleva media rutina con ejercicios propios, tiene que
 * saber que la cuenta no le cubre.
 *
 * @param {Session[]} sessions
 * @param {Record<string, Exercise>} catalog indexado por id
 * @returns {{ sets: Record<string, number>, unknown: string[] }}
 */
export function effectiveSets(sessions, catalog) {
    /** @type {Record<string, number>} */ const sets = {};
    for (const group of MUSCLE_GROUPS) sets[group] = 0;
    /** @type {Set<string>} */ const unknown = new Set();

    for (const session of Array.isArray(sessions) ? sessions : []) {
        for (const entry of session?.entries ?? []) {
            const exercise = catalog[entry?.exerciseId];
            const count = Array.isArray(entry?.sets) ? entry.sets.length : 0;
            if (count === 0) continue;
            if (!exercise) { unknown.add(String(entry?.exerciseId ?? '')); continue; }
            for (const [group, weight] of Object.entries(exercise.muscles)) {
                if (!Object.hasOwn(sets, group)) continue;
                sets[group] += count * weight;
            }
        }
    }
    for (const group of MUSCLE_GROUPS) sets[group] = Math.round(sets[group] * 10) / 10;
    return { sets, unknown: [...unknown].filter(Boolean) };
}

/**
 * @typedef {'belowMv'|'belowMev'|'productive'|'aboveMav'|'aboveMrv'} VolumeZone
 */

/**
 * En qué zona cae un volumen respecto a los landmarks de su grupo.
 * @param {number} weeklySets
 * @param {{ mv: number, mev: number, mav: number, mrv: number }} landmarks
 * @returns {VolumeZone}
 */
export function zoneOf(weeklySets, landmarks) {
    if (weeklySets > landmarks.mrv) return 'aboveMrv';
    if (weeklySets > landmarks.mav) return 'aboveMav';
    if (weeklySets >= landmarks.mev) return 'productive';
    if (weeklySets >= landmarks.mv) return 'belowMev';
    return 'belowMv';
}

/**
 * Estímulo relativo de un grupo, entre 0 y 1. Es lo que V2-M9 usará para
 * repartir la ganancia muscular proyectada.
 *
 * DOSIS-RESPUESTA LOGARÍTMICA, no lineal: las primeras series dan casi todo el
 * estímulo y las siguientes rinden cada vez menos, hasta estancarse. Doblar el
 * volumen no dobla la hipertrofia — es el hallazgo más replicado de la
 * literatura de volumen, y modelarlo lineal haría que la app recomendara
 * entrenar sin techo.
 *
 * Por encima del MRV el estímulo BAJA: no es un castigo moral, es que la fatiga
 * acumulada supera a la adaptación.
 *
 * @param {number} weeklySets
 * @param {{ mv: number, mev: number, mav: number, mrv: number }} landmarks
 * @returns {number} 0 = sin estímulo · 1 = el máximo de ese grupo
 */
export function stimulusOf(weeklySets, landmarks) {
    if (!Number.isFinite(weeklySets) || weeklySets <= 0) return 0;
    const { mav, mrv } = landmarks;

    // Hasta el MAV: curva logarítmica normalizada, que vale ~0 en 0 series y 1
    // en el MAV. `log1p` evita el infinito en cero.
    const saturado = Math.min(weeklySets, mav);
    const base = Math.log1p(saturado) / Math.log1p(mav);

    if (weeklySets <= mav) return Math.max(0, Math.min(1, base));

    // Entre MAV y MRV la curva ya está plana: el estímulo se mantiene.
    if (weeklySets <= mrv) return 1;

    // Por encima del MRV decae: la fatiga se come la adaptación. Se acota en
    // 0,5 para no llegar a decir que entrenar mucho es peor que no entrenar.
    const exceso = (weeklySets - mrv) / Math.max(1, mrv);
    return Math.max(0.5, 1 - exceso);
}

/**
 * @typedef {Object} GroupReport
 * @property {string} group
 * @property {number} weeklySets series efectivas
 * @property {VolumeZone} zone
 * @property {number} stimulus 0–1
 * @property {{ mv: number, mev: number, mav: number, mrv: number }} landmarks
 * @property {number} toMev series que faltan para el mínimo efectivo (0 si ya está)
 */

/**
 * Informe completo por grupo: el que consume la vista y, más adelante, la
 * proyección músculo a músculo.
 *
 * @param {{ sessions: Session[], catalog: Record<string, Exercise>, trainingStatus?: string, weeks?: number }} input
 * @returns {{ groups: GroupReport[], unknown: string[], weeks: number }}
 */
export function volumeReport(input) {
    const weeks = Number.isFinite(input?.weeks) && /** @type {number} */ (input.weeks) > 0
        ? /** @type {number} */ (input.weeks)
        : 1;
    const { sets, unknown } = effectiveSets(input?.sessions ?? [], input?.catalog ?? {});
    const landmarks = landmarksFor(input?.trainingStatus ?? 'intermediate');

    const groups = MUSCLE_GROUPS.map((group) => {
        // Series POR SEMANA: si el periodo abarca cuatro semanas, cuatro series
        // en total no son cuatro semanales. Sin dividir, la app felicitaría a
        // alguien por un volumen que no tiene.
        const weeklySets = Math.round((sets[group] / weeks) * 10) / 10;
        const l = landmarks[group];
        return {
            group,
            weeklySets,
            zone: zoneOf(weeklySets, l),
            stimulus: Math.round(stimulusOf(weeklySets, l) * 1000) / 1000,
            landmarks: l,
            toMev: Math.max(0, Math.round((l.mev - weeklySets) * 10) / 10)
        };
    });
    return { groups, unknown, weeks };
}

// @ts-check

/**
 * Catálogo de series graficables (E13).
 *
 * FUENTE ÚNICA de qué se puede dibujar, en qué unidad, de dónde sale y si es
 * prevista, medida, calculada o estimada. Antes de esto, la respuesta a «qué
 * series hay» estaba repartida entre `chart.js` (cuatro métricas cableadas),
 * cada vista que pintaba lo suyo, y nadie más: superponer dos cosas cualesquiera
 * era imposible sin escribir el par a mano.
 *
 * TRES DECISIONES QUE GOBIERNAN EL FICHERO
 *
 * **1. Cada spec declara una FUNCIÓN productora, no puntos resueltos.** El
 * catálogo tiene que ser enumerable SIN datos —el selector lista cuarenta y
 * pico series antes de que exista ninguna proyección, y hay tests que recorren
 * la lista entera— y resolver 44 × 1096 puntos por dibujado sería absurdo
 * cuando se pintan cuatro.
 *
 * **2. Este módulo no conoce colores ni idioma.** Vive en `src/core/`, donde
 * `window`, `document` y compañía están prohibidos, así que declara CLAVES i18n
 * y una `provenance` de la que la interfaz deriva el estilo. El campo de motivo
 * se llama `reason` y no `code` a propósito: hay un test que exige clave
 * `ranges.<code>` para todo `code:` que aparezca en el motor, y estas razones no
 * son problemas de rango.
 *
 * **3. Las tres unidades de músculo son unidades DISTINTAS.** No es pedantería:
 * es la trampa que hundió la v4.0, convertida en estructura.
 *
 * - `kgMuscleSkeletal` (25–45 kg) es lo que produce el motor.
 * - `kgMuscleScale` (50–70 kg) es lo que guarda una báscula doméstica. Son
 *   magnitudes distintas, y la traducción vive en `src/ui/muscle-units.js`.
 * - `kgMuscleGroup` (1,8–7 kg) es un grupo suelto. Comparte nombre de unidad
 *   con el global pero está DOS ÓRDENES por debajo: en un eje común, nueve de
 *   los diez grupos se aplastan contra el suelo.
 *
 * Con un solo id de unidad, las tres acabarían compartiendo eje y la gráfica
 * mentiría sin equivocarse en ningún número. Con tres ids, el planificador de
 * ejes lo impide solo y un test puede fijarlo.
 */

import { macroSeries } from './nutrition.js';
import { e1rmSeries, tonnageSeries } from './training.js';

/**
 * @typedef {import('./generator.js').Projection} Projection
 * @typedef {import('./generator.js').DailyPoint} DailyPoint
 * @typedef {import('./training.js').Session} Session
 *
 * @typedef {'projected'|'measured'|'derived'|'estimated'} Provenance
 *   `projected` la calcula el plan · `measured` la tecleó el usuario ·
 *   `derived` se calcula a partir de lo medido · `estimated` es un reparto de
 *   lo previsto. Los tres últimos son el vocabulario de `muscleSource` (A3/E10);
 *   no se inventa un eje nuevo, se extiende el que ya existe.
 *
 * @typedef {'kgBody'|'kgMuscleSkeletal'|'kgMuscleScale'|'kgMuscleGroup'|'kgLoad'
 *          |'kgTonnage'|'kgDelta'|'pct'|'kcal'|'kcalDelta'|'g'|'cm'|'steps'
 *          |'sets'|'ratio10'} UnitId
 *
 * @typedef {Object} SeriesPoint
 * @property {number} x dayIndex ABSOLUTO — nunca una fecha, nunca un índice de array
 * @property {number} y en la unidad DECLARADA por el spec
 *
 * @typedef {Object} SeriesContext
 * @property {Projection} [projection]
 * @property {ReadonlyArray<{ dayIndex: number, weightKg: number, fatPct?: number|null,
 *   scaleMuscleKg?: number|null, measuresCm?: Record<string, number>,
 *   subjective?: Record<string, number>, trendKg?: number|null,
 *   deviationKg?: number|null }>} [checkins] ya resueltos a dayIndex
 * @property {ReadonlyArray<{ dayIndex: number, kcal: number, proteinG?: number|null,
 *   carbsG?: number|null, fatG?: number|null }>} [intake]
 * @property {ReadonlyArray<{ dayIndex: number, steps: number }>} [steps]
 * @property {ReadonlyArray<Session>} [sessions]
 * @property {Record<string, SeriesPoint[]>} [muscleByGroup] serie por grupo, ya repartida
 * @property {Record<string, number>} [weeklySets] series por semana y grupo
 * @property {string} [param] argumento de las series parametrizadas
 *
 * @typedef {Object} SeriesSpec
 * @property {string} id ESTABLE: es la clave con la que se persiste una selección
 * @property {string} labelKey clave i18n; NUNCA texto traducido
 * @property {UnitId} unit
 * @property {Provenance} provenance de aquí sale el ESTILO; el spec no sabe de colores
 * @property {'body'|'energy'|'macros'|'measures'|'subjective'|'activity'|'muscleGroups'|'training'} group
 * @property {'endpoint'|'mean'|'sum'} aggregate cómo se reduce al remuestrear
 * @property {boolean} [muscleUnitAware] su Y es un NIVEL de músculo esquelético GLOBAL (E11)
 * @property {ReadonlyArray<keyof SeriesContext>} needs qué exige del contexto
 * @property {(ctx: SeriesContext) => SeriesPoint[]} points
 * @property {(ctx: SeriesContext) => SeriesBand | null} [band]
 *
 * @typedef {Object} SeriesBand
 * @property {SeriesPoint[]} pessimist
 * @property {SeriesPoint[]} optimist
 *
 *   NO se llaman `lower`/`upper`, y la diferencia es real: en una fase de
 *   pérdida el escenario PESIMISTA pesa MÁS que el esperado (menos progreso =
 *   más kilos), así que `pessimist` es el valor numéricamente mayor. Con los
 *   nombres `lower`/`upper` cualquiera asumiría un orden que solo se cumple la
 *   mitad de las veces, y una leyenda que dijera «entre X e Y» los imprimiría
 *   al revés durante todo el déficit. El vocabulario es el del motor (B5).
 */

/**
 * Las unidades del producto, con sus decimales y su rango plausible.
 *
 * `zeroMeaningful` distingue las magnitudes que pueden valer cero de verdad
 * (tonelaje, gramos, pasos) de las que no (un peso corporal de 0 kg es un fallo,
 * no un dato). Lo usa el planificador de ejes para decidir si el eje arranca en
 * cero: forzar el cero en un peso corporal aplasta la serie contra el techo y
 * esconde justo la variación que se quiere ver.
 */
export const UNITS = Object.freeze({
    kgBody: Object.freeze({ key: 'unit.kg', decimals: 1, zeroMeaningful: false }),
    kgMuscleSkeletal: Object.freeze({ key: 'unit.kg', decimals: 1, zeroMeaningful: false }),
    kgMuscleScale: Object.freeze({ key: 'unit.kg', decimals: 1, zeroMeaningful: false }),
    kgMuscleGroup: Object.freeze({ key: 'unit.kg', decimals: 2, zeroMeaningful: false }),
    kgLoad: Object.freeze({ key: 'unit.kg', decimals: 1, zeroMeaningful: false }),
    kgTonnage: Object.freeze({ key: 'unit.kg', decimals: 0, zeroMeaningful: true }),
    kgDelta: Object.freeze({ key: 'unit.kg', decimals: 2, zeroMeaningful: true }),
    pct: Object.freeze({ key: 'unit.pct', decimals: 1, zeroMeaningful: false }),
    kcal: Object.freeze({ key: 'unit.kcal', decimals: 0, zeroMeaningful: false }),
    kcalDelta: Object.freeze({ key: 'unit.kcal', decimals: 0, zeroMeaningful: true }),
    g: Object.freeze({ key: 'unit.g', decimals: 0, zeroMeaningful: true }),
    cm: Object.freeze({ key: 'unit.cm', decimals: 1, zeroMeaningful: false }),
    steps: Object.freeze({ key: 'unit.steps', decimals: 0, zeroMeaningful: true }),
    sets: Object.freeze({ key: 'unit.sets', decimals: 0, zeroMeaningful: true }),
    ratio10: Object.freeze({ key: 'unit.ratio10', decimals: 0, zeroMeaningful: false })
});

/** Los perímetros que el usuario puede registrar. Espejo de `MEASURE_KEYS`. */
const MEASURES = Object.freeze(['waist', 'hip', 'arm', 'thigh', 'neck', 'chest']);

/** Las escalas 0–10 del check-in. */
const SUBJECTIVE = Object.freeze(['energy', 'sleep', 'adherence', 'motivation']);

/** Los diez grupos musculares del reparto anatómico (V2-M9). */
const MUSCLE_GROUPS = Object.freeze([
    'chest', 'back', 'shoulders', 'biceps', 'triceps',
    'quads', 'hamstrings', 'glutes', 'calves', 'core'
]);

/** @param {unknown} v @returns {v is number} */
function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Recorre los días de la proyección produciendo un punto por día.
 * @param {SeriesContext} ctx
 * @param {(point: DailyPoint, index: number) => number | null} pick
 * @returns {SeriesPoint[]}
 */
function fromDaily(ctx, pick) {
    const daily = ctx?.projection?.daily;
    if (!Array.isArray(daily)) return [];
    /** @type {SeriesPoint[]} */ const points = [];
    for (let i = 0; i < daily.length; i++) {
        const y = pick(daily[i], i);
        if (isFiniteNumber(y)) points.push({ x: i, y });
    }
    return points;
}

/**
 * Recorre una colección ya resuelta a `dayIndex`.
 * @template {{ dayIndex: number }} T
 * @param {ReadonlyArray<T> | undefined} rows
 * @param {(row: T) => number | null | undefined} pick
 * @returns {SeriesPoint[]}
 */
function fromRows(rows, pick) {
    if (!Array.isArray(rows)) return [];
    /** @type {SeriesPoint[]} */ const points = [];
    for (const row of rows) {
        if (!row || !isFiniteNumber(row.dayIndex)) continue;
        const y = pick(row);
        if (isFiniteNumber(y)) points.push({ x: row.dayIndex, y });
    }
    return points.sort((a, b) => a.x - b.x);
}

/**
 * Mapa `dateISO → dayIndex` de la proyección. Se construye UNA vez por serie y
 * no un `findIndex` por punto: con 1096 días y 200 sesiones, la diferencia
 * entre un Map y una búsqueda lineal son cuatro órdenes de magnitud.
 * @param {SeriesContext} ctx
 * @returns {Map<string, number>}
 */
function dayIndexOf(ctx) {
    const daily = ctx?.projection?.daily;
    /** @type {Map<string, number>} */ const map = new Map();
    if (Array.isArray(daily)) {
        for (let i = 0; i < daily.length; i++) {
            if (daily[i] && typeof daily[i].dateISO === 'string') map.set(daily[i].dateISO, i);
        }
    }
    return map;
}

/**
 * Construye un spec, rellenando los valores por defecto.
 * @param {Omit<SeriesSpec, 'aggregate'> & { aggregate?: SeriesSpec['aggregate'] }} spec
 * @returns {SeriesSpec}
 */
function series(spec) {
    return Object.freeze({ aggregate: 'endpoint', ...spec });
}

// ============================================================
// El catálogo
// ============================================================

/** @type {ReadonlyArray<SeriesSpec>} */
export const SERIES = Object.freeze([

    // ---- Cuerpo: lo que proyecta el motor -------------------

    series({
        id: 'proj_weight', labelKey: 'series.proj_weight', unit: 'kgBody',
        provenance: 'projected', group: 'body', needs: ['projection'],
        // El peso VISIBLE incluye la fluctuación: es la línea que el usuario ve
        // en Proyección, y vale exactamente `weightKg` con el interruptor
        // apagado, porque entonces `fluctuationKg` es 0.
        points: (ctx) => fromDaily(ctx, (d) => d.weightKg + (d.fluctuationKg ?? 0)),
        band: (ctx) => {
            const pessimist = fromDaily(ctx, (d) => d.band?.pessimistKg);
            const optimist = fromDaily(ctx, (d) => d.band?.optimistKg);
            return pessimist.length > 0 && optimist.length > 0 ? { pessimist, optimist } : null;
        }
    }),
    series({
        id: 'proj_fat_pct', labelKey: 'series.proj_fat_pct', unit: 'pct',
        provenance: 'projected', group: 'body', needs: ['projection'],
        points: (ctx) => fromDaily(ctx, (d) => d.fatPct)
    }),
    series({
        id: 'proj_fat_kg', labelKey: 'series.proj_fat_kg', unit: 'kgBody',
        provenance: 'projected', group: 'body', needs: ['projection'],
        points: (ctx) => fromDaily(ctx, (d) => d.fatKg)
    }),
    series({
        id: 'proj_lean_kg', labelKey: 'series.proj_lean_kg', unit: 'kgBody',
        provenance: 'projected', group: 'body', needs: ['projection'],
        points: (ctx) => fromDaily(ctx, (d) => d.leanKg)
    }),
    series({
        id: 'proj_muscle_kg', labelKey: 'series.proj_muscle_kg',
        unit: 'kgMuscleSkeletal', provenance: 'projected', group: 'body',
        // La ADUANA de E11 puede reescribir esta serie a unidad de báscula. Es
        // la ÚNICA marcada así: los grupos sueltos no se convierten (no
        // convertir es más honesto que convertir mal) y lo medido ya viene en
        // unidad de báscula de origen.
        muscleUnitAware: true, needs: ['projection'],
        points: (ctx) => fromDaily(ctx, (d) => d.muscleKg)
    }),
    series({
        id: 'proj_fluctuation', labelKey: 'series.proj_fluctuation',
        // DELTA, no nivel: oscila alrededor de cero y vale 0 con el interruptor
        // apagado. En el mismo eje que un peso sería una línea plana en el suelo.
        unit: 'kgDelta', provenance: 'projected', group: 'body',
        needs: ['projection'],
        points: (ctx) => fromDaily(ctx, (d) => d.fluctuationKg ?? 0)
    }),

    // ---- Energía --------------------------------------------

    series({
        id: 'proj_kcal_target', labelKey: 'series.proj_kcal_target', unit: 'kcal',
        provenance: 'projected', group: 'energy', needs: ['projection'],
        points: (ctx) => fromDaily(ctx, (d) => d.kcal?.targetKcal)
    }),
    series({
        id: 'proj_kcal_tdee', labelKey: 'series.proj_kcal_tdee', unit: 'kcal',
        provenance: 'projected', group: 'energy', needs: ['projection'],
        points: (ctx) => fromDaily(ctx, (d) => d.kcal?.tdeeKcal)
    }),
    series({
        id: 'proj_kcal_deficit', labelKey: 'series.proj_kcal_deficit',
        unit: 'kcalDelta', provenance: 'projected', group: 'energy',
        needs: ['projection'],
        points: (ctx) => fromDaily(ctx, (d) => d.kcal?.deficitKcal)
    }),

    // ---- Macros previstas -----------------------------------

    series({
        id: 'proj_protein_g', labelKey: 'series.proj_protein_g', unit: 'g',
        provenance: 'projected', group: 'macros', needs: ['projection'],
        points: (ctx) => (ctx.projection ? macroSeries(ctx.projection, 'proteinG') : [])
    }),
    series({
        id: 'proj_carbs_g', labelKey: 'series.proj_carbs_g', unit: 'g',
        provenance: 'projected', group: 'macros', needs: ['projection'],
        points: (ctx) => (ctx.projection ? macroSeries(ctx.projection, 'carbsG') : [])
    }),
    series({
        id: 'proj_fat_g', labelKey: 'series.proj_fat_g', unit: 'g',
        provenance: 'projected', group: 'macros', needs: ['projection'],
        points: (ctx) => (ctx.projection ? macroSeries(ctx.projection, 'fatG') : [])
    }),

    // ---- Lo que el usuario ha medido ------------------------

    series({
        id: 'meas_weight', labelKey: 'series.meas_weight', unit: 'kgBody',
        provenance: 'measured', group: 'body', needs: ['checkins'],
        points: (ctx) => fromRows(ctx.checkins, (c) => c.weightKg)
    }),
    series({
        id: 'meas_fat_pct', labelKey: 'series.meas_fat_pct', unit: 'pct',
        provenance: 'measured', group: 'body', needs: ['checkins'],
        points: (ctx) => fromRows(ctx.checkins, (c) => c.fatPct)
    }),
    series({
        id: 'meas_scale_muscle', labelKey: 'series.meas_scale_muscle',
        // `kgMuscleScale`, JAMÁS `kgMuscleSkeletal`. Es la cifra de la báscula
        // doméstica: magra menos hueso, no músculo esquelético. Ponerlas en el
        // mismo eje sin pasar por la aduana es el defecto que hundió la v4.0.
        unit: 'kgMuscleScale', provenance: 'measured', group: 'body',
        needs: ['checkins'],
        points: (ctx) => fromRows(ctx.checkins, (c) => c.scaleMuscleKg)
    }),
    series({
        id: 'deriv_weight_trend', labelKey: 'series.deriv_weight_trend',
        unit: 'kgBody', provenance: 'derived', group: 'body', needs: ['checkins'],
        points: (ctx) => fromRows(ctx.checkins, (c) => c.trendKg)
    }),
    series({
        id: 'deriv_deviation', labelKey: 'series.deriv_deviation',
        unit: 'kgDelta', provenance: 'derived', group: 'body', needs: ['checkins'],
        points: (ctx) => fromRows(ctx.checkins, (c) => c.deviationKg)
    }),

    // ---- Ingesta registrada ---------------------------------

    series({
        id: 'meas_intake_kcal', labelKey: 'series.meas_intake_kcal', unit: 'kcal',
        provenance: 'measured', group: 'energy', aggregate: 'mean', needs: ['intake'],
        points: (ctx) => fromRows(ctx.intake, (r) => r.kcal)
    }),
    series({
        id: 'meas_intake_protein_g', labelKey: 'series.meas_intake_protein_g', unit: 'g',
        provenance: 'measured', group: 'macros', aggregate: 'mean', needs: ['intake'],
        points: (ctx) => fromRows(ctx.intake, (r) => r.proteinG)
    }),
    series({
        id: 'meas_intake_carbs_g', labelKey: 'series.meas_intake_carbs_g', unit: 'g',
        provenance: 'measured', group: 'macros', aggregate: 'mean', needs: ['intake'],
        points: (ctx) => fromRows(ctx.intake, (r) => r.carbsG)
    }),
    series({
        id: 'meas_intake_fat_g', labelKey: 'series.meas_intake_fat_g', unit: 'g',
        provenance: 'measured', group: 'macros', aggregate: 'mean', needs: ['intake'],
        points: (ctx) => fromRows(ctx.intake, (r) => r.fatG)
    }),

    // ---- Actividad ------------------------------------------

    series({
        id: 'meas_steps', labelKey: 'series.meas_steps', unit: 'steps',
        provenance: 'measured', group: 'activity', aggregate: 'mean', needs: ['steps'],
        points: (ctx) => fromRows(ctx.steps, (r) => r.steps)
    }),

    // ---- Perímetros y sensaciones ---------------------------

    ...MEASURES.map((key) => series({
        id: `meas_${key}`, labelKey: `series.meas_${key}`, unit: 'cm',
        provenance: 'measured', group: 'measures', needs: ['checkins'],
        points: (ctx) => fromRows(ctx.checkins, (c) => c.measuresCm?.[key])
    })),

    ...SUBJECTIVE.map((key) => series({
        id: `subj_${key}`, labelKey: `series.subj_${key}`, unit: 'ratio10',
        provenance: 'measured', group: 'subjective', aggregate: 'mean',
        needs: ['checkins'],
        points: (ctx) => fromRows(ctx.checkins, (c) => c.subjective?.[key])
    })),

    // ---- Músculo por grupo ----------------------------------
    //
    // `kgMuscleGroup`, no `kgMuscleSkeletal`: el pecho pesa 2 kg y el total 35.
    // Y `estimated`, porque es un REPARTO de lo que proyecta el plan — nadie
    // mide el músculo de un grupo suelto en casa.

    ...MUSCLE_GROUPS.map((key) => series({
        id: `est_muscle_${key}`, labelKey: `series.est_muscle_${key}`,
        unit: 'kgMuscleGroup', provenance: 'estimated', group: 'muscleGroups',
        needs: ['muscleByGroup'],
        points: (ctx) => (ctx.muscleByGroup?.[key] ?? [])
    })),

    // ---- Entrenamiento --------------------------------------

    series({
        id: 'meas_tonnage', labelKey: 'series.meas_tonnage', unit: 'kgTonnage',
        provenance: 'measured', group: 'training',
        // SUMA, no nivel: al pasar a semana hay que sumar los días, no coger el
        // último. Muestrear el día de cierre enseñaría una sesión donde el
        // usuario espera la semana entera.
        aggregate: 'sum', needs: ['sessions', 'projection'],
        points: (ctx) => {
            const map = dayIndexOf(ctx);
            return tonnageSeries(/** @type {Session[]} */ (ctx.sessions ?? []))
                .map((r) => ({ x: map.get(r.dateISO) ?? -1, y: r.kg }))
                .filter((p) => p.x >= 0);
        }
    }),
    series({
        id: 'est_e1rm', labelKey: 'series.est_e1rm', unit: 'kgLoad',
        // `estimated` y no `measured`: lo medido es «100 kg × 8 reps»; el 1RM
        // sale de aplicarle Epley, que es un modelo. Ponerle la etiqueta de
        // medición sería vender una estimación como un dato.
        provenance: 'estimated', group: 'training',
        needs: ['sessions', 'projection', 'param'],
        points: (ctx) => {
            if (!ctx.param) return [];
            const map = dayIndexOf(ctx);
            return e1rmSeries(/** @type {Session[]} */ (ctx.sessions ?? []), ctx.param)
                .map((r) => ({ x: map.get(r.dateISO) ?? -1, y: r.e1rmKg }))
                .filter((p) => p.x >= 0);
        }
    })
]);

/** Índice por id, construido una vez. */
const BY_ID = new Map(SERIES.map((s) => [s.id, s]));

/**
 * @param {string} id
 * @returns {SeriesSpec | null}
 */
export function seriesById(id) {
    return BY_ID.get(id) ?? null;
}

/**
 * Los specs cuyas necesidades cubre el contexto.
 *
 * «Cubre» significa que la clave existe y no está vacía. Una serie sin datos
 * TODAVÍA no se esconde —el selector la ofrece diciendo que aún no hay nada que
 * dibujar—, pero quien pregunta por lo disponible necesita saberlo.
 * @param {SeriesContext} ctx
 * @returns {SeriesSpec[]}
 */
export function catalogFor(ctx) {
    if (!ctx || typeof ctx !== 'object') return [];
    return SERIES.filter((spec) => spec.needs.every((need) => {
        const value = ctx[need];
        if (value === undefined || value === null) return false;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === 'object') return Object.keys(value).length > 0;
        return true;
    }));
}

// ============================================================
// Resolución y remuestreo
// ============================================================

/**
 * @typedef {Object} ResolvedSeries
 * @property {SeriesSpec} spec
 * @property {SeriesPoint[]} points ya remuestreados a los anclajes
 * @property {SeriesBand | null} band
 * @property {UnitId} unit el del spec; la aduana de E11 puede reescribirlo
 * @property {{ min: number, max: number } | null} extent
 * @property {string | null} reason clave i18n de por qué está vacía, o null
 * @property {string} [label] etiqueta YA compuesta; solo las series
 *   parametrizadas la llevan (la clave i18n sola no sabe qué ejercicio es)
 */

/**
 * Reduce una serie a los anclajes pedidos, respetando su modo de agregación.
 *
 * Los anclajes vienen de `chart.seriesAnchors`, que los DERIVA de los agregados
 * del motor en vez de recalcular los bloques. Recalcularlos aquí duplicaría las
 * reglas GEN-07/11/12 y el día que alguien tocara el generador las dos
 * versiones divergirían en silencio.
 *
 * - `endpoint`: el último punto que cae en el bloque. Es lo que hace hoy la
 *   gráfica con el peso, así que no hay regresión.
 * - `mean`: la media de los que caen dentro. Para lo que se registra a diario
 *   y varía mucho —la ingesta, los pasos—, el último día no representa la
 *   semana: representa el domingo.
 * - `sum`: la suma. Solo el tonelaje, y es lo que impide que una semana de
 *   entreno se muestre como una sesión.
 *
 * @param {SeriesPoint[]} points
 * @param {number[]} anchors índices absolutos, crecientes
 * @param {'endpoint'|'mean'|'sum'} aggregate
 * @returns {SeriesPoint[]}
 */
export function resampleTo(points, anchors, aggregate) {
    if (!Array.isArray(points) || points.length === 0) return [];
    if (!Array.isArray(anchors) || anchors.length === 0) return [];
    // Sin remuestreo real: los anclajes son todos los días.
    if (anchors.length === 1 && points.length === 1) return points.slice();

    /** @type {SeriesPoint[]} */ const out = [];
    let cursor = 0;
    let previousAnchor = -1;

    for (const anchor of anchors) {
        /** @type {SeriesPoint[]} */ const bucket = [];
        while (cursor < points.length && points[cursor].x <= anchor) {
            if (points[cursor].x > previousAnchor) bucket.push(points[cursor]);
            cursor++;
        }
        if (bucket.length === 0) {
            previousAnchor = anchor;
            continue;
        }
        if (aggregate === 'sum') {
            out.push({ x: anchor, y: bucket.reduce((acc, p) => acc + p.y, 0) });
        } else if (aggregate === 'mean') {
            out.push({ x: anchor, y: bucket.reduce((acc, p) => acc + p.y, 0) / bucket.length });
        } else {
            out.push({ x: anchor, y: bucket[bucket.length - 1].y });
        }
        previousAnchor = anchor;
    }
    return out;
}

/**
 * Resuelve un spec sobre un contexto.
 *
 * NUNCA lanza. Un contexto incompleto produce una serie vacía CON MOTIVO, que
 * es lo que la leyenda necesita para decir «sin datos todavía» en vez de
 * desaparecer sin explicación. Degradar a una excepción dejaría la vista entera
 * en blanco por una serie que el usuario eligió de más.
 *
 * @param {SeriesSpec} spec
 * @param {SeriesContext} ctx
 * @param {number[]} anchors
 * @returns {ResolvedSeries}
 */
export function resolveSeries(spec, ctx, anchors) {
    /** @type {ResolvedSeries} */
    const vacia = {
        spec, points: [], band: null, unit: spec?.unit ?? 'kgBody',
        extent: null, reason: 'series.reason.noData'
    };
    if (!spec || typeof spec.points !== 'function') {
        return { ...vacia, reason: 'series.reason.unknown' };
    }
    if (!ctx || typeof ctx !== 'object') return vacia;

    const falta = spec.needs.find((need) => ctx[need] === undefined || ctx[need] === null);
    if (falta) return { ...vacia, reason: 'series.reason.missing' };

    /** @type {SeriesPoint[]} */ let raw;
    try {
        raw = spec.points(ctx) ?? [];
    } catch {
        // Un productor que revienta es un fallo del catálogo, no del usuario:
        // se traga aquí para que una serie rota no tumbe las otras tres.
        return { ...vacia, reason: 'series.reason.failed' };
    }
    const limpio = raw
        .filter((p) => p && isFiniteNumber(p.x) && isFiniteNumber(p.y))
        .sort((a, b) => a.x - b.x);
    if (limpio.length === 0) return vacia;

    const points = resampleTo(limpio, anchors, spec.aggregate);
    if (points.length === 0) return { ...vacia, reason: 'series.reason.outOfWindow' };

    /** @type {SeriesBand | null} */ let band = null;
    if (typeof spec.band === 'function') {
        try {
            const bruta = spec.band(ctx);
            if (bruta && bruta.pessimist.length > 0 && bruta.optimist.length > 0) {
                band = {
                    pessimist: resampleTo(bruta.pessimist, anchors, spec.aggregate),
                    optimist: resampleTo(bruta.optimist, anchors, spec.aggregate)
                };
            }
        } catch { /* la banda es un extra: su fallo no se lleva la serie */ }
    }

    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
        if (p.y < min) min = p.y;
        if (p.y > max) max = p.y;
    }
    return { spec, points, band, unit: spec.unit, extent: { min, max }, reason: null };
}

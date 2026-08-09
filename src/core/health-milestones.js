// @ts-check

/**
 * Hitos de SALUD (E14-2), derivados de umbrales publicados.
 *
 * Los hitos estéticos de `milestones.js` salen de un catálogo editorial: dicen
 * cómo se te va a ver. Estos dicen otra cosa —qué franja de riesgo abandonas— y
 * por eso no se inventan aquí: cada umbral trae su fuente citada, y ninguno se
 * redondea «para que salga más bonito».
 *
 * Tres decisiones que se toman una vez y valen para todo el módulo:
 *
 * 1. **El IMC solo cuenta hacia abajo.** El IMC no distingue músculo de grasa:
 *    subir de 24,9 a 25,1 en una fase de volumen no es un evento de salud, es
 *    aritmética. Celebrarlo al bajar y alarmar al subir sería usar dos varas.
 *    Se usa una: se anuncian los cruces descendentes y se calla el resto. La
 *    franja que SÍ distingue tejido es el porcentaje de grasa, y esa sí se
 *    anuncia en las dos direcciones.
 *
 * 2. **El perímetro de cintura no se proyecta.** El motor no lo predice, y la
 *    estimación de `silhouette.js` sale de un modelo de población, no de tu
 *    cinta métrica: convertirla en «has cruzado los 102 cm» sería exactamente
 *    la clase de promesa que hundió la v4.0. Los hitos de cintura son
 *    `measured` y salen de los check-ins o no existen.
 *
 * 3. **Bajar demasiado también es un hito, pero no es un logro.** Entrar en
 *    grasa esencial es un riesgo, y va marcado `kind: 'risk'`. Un producto que
 *    solo sabe felicitar acaba felicitando a quien se está haciendo daño.
 *
 * El módulo es puro y no traduce: declara `labelKey` y `sourceKey`, como el
 * catálogo de series. Aquí no hay `code:` a propósito — esa forma la reserva
 * `ranges.js` y arrastra su propio contrato de i18n.
 */

/**
 * @typedef {Object} HealthMilestone
 * @property {string} id único dentro de la lista
 * @property {'bmi' | 'fatCategory' | 'waist' | 'energy'} category
 * @property {string} labelKey clave i18n del enunciado
 * @property {Record<string, string | number>} labelParams
 * @property {string} sourceKey clave i18n de la referencia (quién publicó el umbral)
 * @property {'gain' | 'risk'} kind logro o aviso
 * @property {'projected' | 'measured'} provenance mismo vocabulario que el catálogo de series
 * @property {number} dayIndex día del plan en que ocurre el cruce
 * @property {string} dateISO
 * @property {boolean} reached ya ocurrió a fecha de hoy
 */

/**
 * Franjas de IMC de la OMS.
 *
 * Fuente: WHO, *Obesity: preventing and managing the global epidemic*, Technical
 * Report Series 894 (2000), tabla 2.1; reafirmadas en la clasificación vigente
 * de la OMS. El umbral de 18,5 marca el bajo peso, así que cruzarlo hacia abajo
 * es un aviso, no un logro: es el único de la lista con `kind: 'risk'`.
 */
export const BMI_THRESHOLDS = Object.freeze([
    Object.freeze({ id: 'obeseIII', bmi: 40, kind: /** @type {const} */ ('gain') }),
    Object.freeze({ id: 'obeseII', bmi: 35, kind: /** @type {const} */ ('gain') }),
    Object.freeze({ id: 'obeseI', bmi: 30, kind: /** @type {const} */ ('gain') }),
    Object.freeze({ id: 'overweight', bmi: 25, kind: /** @type {const} */ ('gain') }),
    Object.freeze({ id: 'underweight', bmi: 18.5, kind: /** @type {const} */ ('risk') })
]);

/**
 * Franjas de porcentaje de grasa por sexo.
 *
 * Fuente: American Council on Exercise (ACE), *Percent Body Fat Norms*, la tabla
 * de cinco categorías que ACSM reproduce en sus guías junto a sus percentiles
 * por edad. Son categorías de POBLACIÓN, no un diagnóstico: describen dónde caes
 * respecto a otras personas de tu sexo, no si estás sano. El módulo no dice más
 * de lo que la tabla dice.
 *
 * `enter` es el umbral que hay que cruzar hacia ABAJO para entrar en la franja.
 * La última, `essential`, es el suelo fisiológico: por debajo de ahí el cuerpo
 * no tiene grasa de reserva, y entrar en ella es un aviso.
 */
export const FAT_CATEGORIES = Object.freeze({
    male: Object.freeze([
        Object.freeze({ id: 'average', enter: 24, kind: /** @type {const} */ ('gain') }),
        Object.freeze({ id: 'fitness', enter: 17, kind: /** @type {const} */ ('gain') }),
        Object.freeze({ id: 'athletic', enter: 13, kind: /** @type {const} */ ('gain') }),
        Object.freeze({ id: 'essential', enter: 5, kind: /** @type {const} */ ('risk') })
    ]),
    female: Object.freeze([
        Object.freeze({ id: 'average', enter: 31, kind: /** @type {const} */ ('gain') }),
        Object.freeze({ id: 'fitness', enter: 24, kind: /** @type {const} */ ('gain') }),
        Object.freeze({ id: 'athletic', enter: 20, kind: /** @type {const} */ ('gain') }),
        Object.freeze({ id: 'essential', enter: 13, kind: /** @type {const} */ ('risk') })
    ])
});

/**
 * Perímetro de cintura: los dos umbrales de riesgo cardiometabólico.
 *
 * Fuente: WHO, *Waist Circumference and Waist–Hip Ratio: Report of a WHO Expert
 * Consultation* (2008), tabla 2, que recoge los cortes del NIH/NHLBI de 1998.
 * Son cortes para población europea; la propia consulta de la OMS advierte de
 * que el riesgo aparece antes en poblaciones del sur y el este de Asia. Eso se
 * dice en la interfaz junto al hito, no se corrige aquí a ojo.
 */
export const WAIST_THRESHOLDS = Object.freeze({
    male: Object.freeze([
        Object.freeze({ id: 'substantial', cm: 102 }),
        Object.freeze({ id: 'increased', cm: 94 })
    ]),
    female: Object.freeze([
        Object.freeze({ id: 'substantial', cm: 88 }),
        Object.freeze({ id: 'increased', cm: 80 })
    ])
});

/**
 * Cuánto tiene que subir la energía subjetiva, y durante cuánto, para contarla.
 *
 * La escala es 1–10 y la teclea el usuario: un solo día bueno no es una mejora,
 * es un día bueno. Se exige que la media de las últimas cuatro semanas supere en
 * dos puntos la de las cuatro primeras, que es el salto más pequeño que no se
 * confunde con el ruido de una escala entera.
 */
export const ENERGY_WINDOW = 4;
export const ENERGY_MIN_DELTA = 2;

/** @param {unknown} v @returns {v is number} */
function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Índice de masa corporal.
 * @param {number} weightKg @param {number} heightCm
 * @returns {number | null} null si los datos no permiten calcularlo
 */
export function bmiOf(weightKg, heightCm) {
    if (!isFiniteNumber(weightKg) || !isFiniteNumber(heightCm)) return null;
    if (weightKg <= 0 || heightCm <= 0) return null;
    const m = heightCm / 100;
    return weightKg / (m * m);
}

/**
 * La franja de IMC en la que cae un valor, o null si no hay valor.
 * @param {number | null} bmi
 * @returns {'obeseIII'|'obeseII'|'obeseI'|'overweight'|'normal'|'underweight'|null}
 */
export function bmiBandOf(bmi) {
    if (!isFiniteNumber(bmi)) return null;
    if (bmi >= 40) return 'obeseIII';
    if (bmi >= 35) return 'obeseII';
    if (bmi >= 30) return 'obeseI';
    if (bmi >= 25) return 'overweight';
    if (bmi >= 18.5) return 'normal';
    return 'underweight';
}

/**
 * Franja de grasa corporal según la tabla de ACE.
 * @param {number | null} fatPct @param {'male'|'female'} sex
 * @returns {'obese'|'average'|'fitness'|'athletic'|'essential'|null}
 */
export function fatCategoryOf(fatPct, sex) {
    if (!isFiniteNumber(fatPct)) return null;
    const bands = FAT_CATEGORIES[sex] ?? FAT_CATEGORIES.male;
    for (let i = 0; i < bands.length; i++) {
        if (fatPct <= bands[i].enter) continue;
        // Está por encima de este umbral: pertenece a la franja anterior.
        return i === 0 ? 'obese' : /** @type {*} */ (bands[i - 1].id);
    }
    return 'essential';
}

/**
 * El primer índice en que una serie cruza `threshold` en la dirección dada.
 *
 * Nunca cuenta el primer valor como cruce: un plan que arranca ya por debajo del
 * umbral no lo «cruza», y anunciarlo llenaría la gráfica de hitos que el usuario
 * traía puestos desde antes de empezar — el mismo defecto que `fromStart` cerró
 * en los estéticos.
 *
 * La comparación es contra el último valor CONOCIDO, no contra la posición
 * anterior. Con series densas da lo mismo, pero estas listas también son
 * check-ins, y nadie se mide la cintura todas las semanas: comparar contra un
 * hueco haría desaparecer el cruce justo en el caso normal.
 *
 * @param {Array<number | null>} values un valor por posición, null donde no hay
 * @param {number} threshold
 * @param {'down' | 'up'} direction
 * @returns {number} índice, o -1
 */
export function crossingDay(values, threshold, direction) {
    if (!Array.isArray(values)) return -1;
    /** @type {number | null} */ let prev = null;
    for (let i = 0; i < values.length; i++) {
        const cur = values[i];
        if (!isFiniteNumber(cur)) continue;
        if (prev !== null) {
            if (direction === 'down' && prev > threshold && cur <= threshold) return i;
            if (direction === 'up' && prev < threshold && cur >= threshold) return i;
        }
        prev = cur;
    }
    return -1;
}

/**
 * Hitos de salud PROYECTADOS: los que salen del plan que el motor ya calculó.
 *
 * @param {import('./generator.js').Projection} projection
 * @param {{ heightCm: number, sex: 'male'|'female' }} profile
 * @param {number} todayIndex
 * @returns {HealthMilestone[]} ordenados por día
 */
export function projectedHealthMilestones(projection, profile, todayIndex) {
    const daily = projection?.daily;
    if (!Array.isArray(daily) || daily.length === 0) return [];
    const sex = profile?.sex === 'female' ? 'female' : 'male';
    const heightCm = isFiniteNumber(profile?.heightCm) ? profile.heightCm : null;

    /** @type {HealthMilestone[]} */ const out = [];

    /** @param {HealthMilestone['category']} category @param {number} dayIndex @param {Omit<HealthMilestone,'id'|'category'|'dayIndex'|'dateISO'|'reached'|'provenance'>} rest */
    const push = (category, dayIndex, rest) => {
        const point = daily[dayIndex];
        if (!point) return;
        out.push({
            id: `health:${category}:${rest.labelKey}:${dayIndex}`,
            category,
            provenance: 'projected',
            dayIndex,
            dateISO: point.dateISO,
            reached: isFiniteNumber(todayIndex) && dayIndex <= todayIndex,
            ...rest
        });
    };

    if (heightCm !== null) {
        const bmis = daily.map((p) => bmiOf(p?.weightKg, heightCm));
        for (const band of BMI_THRESHOLDS) {
            // Hacia abajo SIEMPRE: subir de 24,9 a 25,1 ganando músculo no es
            // un evento de salud, y el IMC no sabe distinguirlo.
            const day = crossingDay(bmis, band.bmi, 'down');
            if (day < 0) continue;
            push('bmi', day, {
                labelKey: `health.bmi.${band.id}`,
                labelParams: { bmi: band.bmi },
                sourceKey: 'health.source.whoBmi',
                kind: band.kind
            });
        }
    }

    const fats = daily.map((p) => (isFiniteNumber(p?.fatPct) ? p.fatPct : null));
    for (const band of FAT_CATEGORIES[sex]) {
        const day = crossingDay(fats, band.enter, 'down');
        if (day < 0) continue;
        push('fatCategory', day, {
            labelKey: `health.fat.${band.id}`,
            labelParams: { pct: band.enter },
            sourceKey: 'health.source.aceFat',
            kind: band.kind
        });
    }

    return out.sort((a, b) => a.dayIndex - b.dayIndex);
}

/**
 * Hitos de salud MEDIDOS: los que solo existen si el usuario los midió.
 *
 * La cintura y la energía no se proyectan y no se van a proyectar. Que estos
 * hitos vivan en la misma lista que los proyectados, con `provenance` distinta,
 * es el punto: la interfaz los pinta juntos y los distingue, en vez de tener dos
 * conceptos de «hito» que acaben divergiendo.
 *
 * @param {Array<{ dayIndex: number, dateISO: string, measuresCm?: Record<string, number>|undefined, subjective?: Record<string, number>|undefined }>} checkins
 *   ya situados en el plan por la capa que los tiene, ordenados por fecha
 * @param {{ sex: 'male'|'female' }} profile
 * @param {number} todayIndex
 * @returns {HealthMilestone[]}
 */
export function measuredHealthMilestones(checkins, profile, todayIndex) {
    if (!Array.isArray(checkins) || checkins.length === 0) return [];
    const sex = profile?.sex === 'female' ? 'female' : 'male';
    /** @type {HealthMilestone[]} */ const out = [];

    const waists = checkins.map((c) => {
        const v = c?.measuresCm?.waist;
        return isFiniteNumber(v) ? v : null;
    });
    for (const band of WAIST_THRESHOLDS[sex]) {
        const idx = crossingDay(waists, band.cm, 'down');
        if (idx < 0) continue;
        const c = checkins[idx];
        out.push({
            id: `health:waist:${band.id}:${c.dayIndex}`,
            category: 'waist',
            labelKey: `health.waist.${band.id}`,
            labelParams: { cm: band.cm },
            sourceKey: 'health.source.whoWaist',
            kind: 'gain',
            provenance: 'measured',
            dayIndex: c.dayIndex,
            dateISO: c.dateISO,
            reached: isFiniteNumber(todayIndex) && c.dayIndex <= todayIndex
        });
    }

    const energy = checkins
        .map((c) => ({ c, v: c?.subjective?.energy }))
        .filter((e) => isFiniteNumber(e.v));
    if (energy.length >= ENERGY_WINDOW * 2) {
        const media = (/** @type {typeof energy} */ list) =>
            list.reduce((s, e) => s + /** @type {number} */ (e.v), 0) / list.length;
        const base = media(energy.slice(0, ENERGY_WINDOW));
        const ahora = media(energy.slice(-ENERGY_WINDOW));
        const delta = ahora - base;
        if (delta >= ENERGY_MIN_DELTA) {
            const last = energy[energy.length - 1].c;
            out.push({
                id: `health:energy:up:${last.dayIndex}`,
                category: 'energy',
                labelKey: 'health.energy.up',
                // Un punto decimal aquí sería mentir sobre la precisión de una
                // escala de enteros que se teclea a ojo. Se redondea.
                labelParams: { delta: Math.round(delta) },
                sourceKey: 'health.source.selfReported',
                kind: 'gain',
                provenance: 'measured',
                dayIndex: last.dayIndex,
                dateISO: last.dateISO,
                reached: true
            });
        }
    }

    return out.sort((a, b) => a.dayIndex - b.dayIndex);
}

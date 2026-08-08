// @ts-check

/**
 * La superficie única de recalibración (V2-M10). Módulo PURO.
 *
 * EL PROBLEMA QUE RESUELVE ES NUEVO DE LA v2. En la v1 solo había una fuente que
 * pudiera pedir recalibrar: la desviación del peso. Ahora hay tres —desviación
 * del peso, gasto medido (V2-M1) y volumen por encima del máximo recuperable
 * (V2-M6)— y dejarlas sueltas produce dos fallos distintos, los dos malos:
 *
 * 1. **Bombardeo.** Tres avisos el mismo día es ruido, y el usuario aprende a
 *    cerrarlos sin leerlos. A partir de ahí la app ya no puede avisarle de nada.
 * 2. **Contradicción.** La desviación del peso dice «vas lento, baja calorías»
 *    mientras el gasto medido dice «gastas más de lo que creíamos, sube». Las
 *    dos miran lo mismo con distinta evidencia, y enseñarlas juntas deja al
 *    usuario arbitrando entre dos partes de su propia app.
 *
 * LA REGLA DE DESEMPATE ES DE EVIDENCIA, no de orden de llegada: cuando dos
 * fuentes tocan la MISMA palanca, gana la que se apoya en más datos. El gasto
 * medido sale de la ingesta registrada Y del peso; la desviación, solo del peso.
 * Así que el gasto medido desplaza a la desviación, y se DICE que la ha
 * desplazado en vez de hacerla desaparecer.
 *
 * Y SIEMPRE SE OFRECE, NUNCA SE APLICA (B9). Este módulo decide qué se propone y
 * en qué orden; no cambia nada del plan.
 */

/**
 * Palancas sobre las que se puede recalibrar.
 *
 * Son la unidad de conflicto: dos ofertas sobre la misma palanca se contradicen;
 * sobre palancas distintas, no. Modelarlo así es lo que permite que una oferta
 * de calorías y una de volumen convivan sin ser ruido.
 * @type {readonly string[]}
 */
export const LEVERS = Object.freeze(['calories', 'volume']);

/**
 * Prioridad de cada fuente. Menor = se enseña antes.
 *
 * Las calorías van delante del volumen porque gobiernan el resultado que el
 * usuario está mirando —el peso—, y porque una descarga de entrenamiento puede
 * esperar una semana sin consecuencia.
 * @type {Readonly<Record<string, number>>}
 */
export const SOURCE_PRIORITY = Object.freeze({
    measuredExpenditure: 0,
    weightDeviation: 1,
    trainingDeload: 2
});

/** Qué palanca toca cada fuente. */
const SOURCE_LEVER = Object.freeze({
    measuredExpenditure: 'calories',
    weightDeviation: 'calories',
    trainingDeload: 'volume'
});

/**
 * Cuando dos fuentes tocan la misma palanca, cuál manda.
 *
 * `measuredExpenditure` gana a `weightDeviation` porque se apoya en la ingesta
 * registrada además del peso: dos señales frente a una. No es que la desviación
 * esté mal, es que la otra sabe más.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const SUPERSEDES = Object.freeze({
    measuredExpenditure: Object.freeze(['weightDeviation'])
});

/**
 * @typedef {Object} Offer
 * @property {string} source
 * @property {string} lever
 * @property {string} reasonKey clave i18n del porqué
 * @property {Record<string, string|number>} [params]
 *
 * @typedef {Object} Coordination
 * @property {Offer | null} primary la única que se enseña ahora
 * @property {Offer[]} deferred las que esperan turno; se listan, no se ocultan
 * @property {Offer[]} superseded las desplazadas por otra con más evidencia
 */

/**
 * Coordina las ofertas de las tres fuentes.
 *
 * INVARIANTE `recalibracion_unica`: como mucho UNA oferta principal, y nunca dos
 * ofertas vivas sobre la misma palanca.
 *
 * Lo desplazado y lo aplazado se DEVUELVEN, no se tiran. La interfaz puede
 * decir «además, tu volumen está alto; te lo propongo cuando cierres esto», que
 * es honesto, en vez de callarlo y que el usuario descubra el segundo aviso una
 * semana después sin entender por qué no salió antes.
 *
 * @param {Offer[]} candidates
 * @returns {Coordination}
 */
export function coordinate(candidates) {
    const ofertas = (Array.isArray(candidates) ? candidates : [])
        .filter((o) => o && typeof o.source === 'string' && LEVERS.includes(o.lever));

    /** @type {Set<string>} */ const desplazadas = new Set();
    for (const oferta of ofertas) {
        for (const perdedora of SUPERSEDES[oferta.source] ?? []) desplazadas.add(perdedora);
    }

    const superseded = ofertas.filter((o) => desplazadas.has(o.source));
    const vivas = ofertas
        .filter((o) => !desplazadas.has(o.source))
        .sort((a, b) => (SOURCE_PRIORITY[a.source] ?? 99) - (SOURCE_PRIORITY[b.source] ?? 99));

    // Dos fuentes que sobreviven al desplazamiento y tocan la misma palanca
    // seguirían contradiciéndose. Se queda la de mayor prioridad y la otra pasa
    // a aplazada: no se pierde, pero no compite.
    /** @type {Set<string>} */ const palancasTomadas = new Set();
    /** @type {Offer[]} */ const ordenadas = [];
    /** @type {Offer[]} */ const enEspera = [];
    for (const oferta of vivas) {
        if (palancasTomadas.has(oferta.lever)) enEspera.push(oferta);
        else { palancasTomadas.add(oferta.lever); ordenadas.push(oferta); }
    }

    return {
        primary: ordenadas[0] ?? null,
        // Lo de otras palancas también espera turno: una sola cosa que decidir
        // cada vez.
        deferred: [...ordenadas.slice(1), ...enEspera],
        superseded
    };
}

/**
 * Construye las ofertas candidatas desde el estado de los tres módulos.
 *
 * Cada fuente decide si tiene algo que decir; este módulo no reimplementa
 * ninguna de las tres comprobaciones. Duplicar aquí el umbral de desviación o el
 * de gasto crearía una segunda verdad que se separaría de la primera al primer
 * ajuste.
 *
 * @param {{
 *   weightDeviation?: { offer: boolean, reasonKey?: string, params?: * } | null,
 *   measuredExpenditure?: { offer: boolean, reason?: string, gapKcal?: number | null } | null,
 *   deload?: { offer: boolean, reasons?: string[] } | null
 * }} state
 * @returns {Offer[]}
 */
export function collectOffers(state) {
    /** @type {Offer[]} */ const out = [];

    if (state?.measuredExpenditure?.offer) {
        const gap = state.measuredExpenditure.gapKcal ?? 0;
        out.push({
            source: 'measuredExpenditure',
            lever: 'calories',
            reasonKey: state.measuredExpenditure.reason === 'higher'
                ? 'recalibration.expenditureHigher'
                : 'recalibration.expenditureLower',
            params: { gap: Math.abs(Math.round(gap)) }
        });
    }
    if (state?.weightDeviation?.offer) {
        out.push({
            source: 'weightDeviation',
            lever: 'calories',
            reasonKey: state.weightDeviation.reasonKey ?? 'recalibration.weightDeviation',
            params: state.weightDeviation.params ?? {}
        });
    }
    if (state?.deload?.offer) {
        out.push({
            source: 'trainingDeload',
            lever: 'volume',
            reasonKey: 'recalibration.deload',
            params: { n: (state.deload.reasons ?? []).length }
        });
    }
    return out;
}

// @ts-check

/**
 * La línea de tiempo del proceso (decisión E12).
 *
 * EL PROBLEMA QUE RESUELVE. La aplicación sabe muchísimo sobre lo que le va a
 * pasar al usuario y se lo cuenta en cinco sitios distintos: las fases están en
 * una barra de colores, los cruces de umbral son puntos amarillos idénticos en
 * un lienzo, los cambios estéticos viven en otra vista, los check-ins en otra y
 * las recalibraciones en un historial que casi nadie abre. Ninguno de esos
 * sitios responde a la pregunta que de verdad tiene el usuario: **¿qué me va a
 * pasar, cuándo, y en qué orden?**
 *
 * Este módulo no calcula nada nuevo. Fusiona lo que ya existe, lo ordena en el
 * tiempo y le pone a cada cosa una fecha con su margen.
 *
 * LA VENTANA DE FECHAS. Los tres escenarios del motor no son tres pesos
 * distintos: son **el mismo plan a distinto ritmo**. El pesimista, el día `d`,
 * está donde el esperado estaba en `T·(d/T)^1,3`. Como esa deformación actúa
 * sobre el AVANCE y no sobre el valor, se puede invertir y preguntarle cuándo
 * llega cada escenario a un punto dado:
 *
 *     d_escenario = T · (d_esperado / T)^(1/k)
 *
 * De ahí sale «bajas del 22 % entre el 16 de septiembre y el 12 de noviembre».
 *
 * Tres honestidades que van escritas aquí y también en la interfaz:
 *
 *   1. Los tres escenarios **terminan el mismo día**. La ventana se estrecha
 *      hasta cerrarse al final por construcción, así que cerca del objetivo no
 *      se imprime un rango: sería precisión fingida.
 *   2. La deformación está definida sobre la trayectoria de PESO. Aplicarla a
 *      hitos de grasa o de músculo asume que el plan entero se adelanta o se
 *      retrasa en bloque — que es exactamente la premisa del modelo de
 *      escenarios, no un añadido de este módulo.
 *   3. El redondeo va **hacia fuera**: la ventana se ensancha, nunca se
 *      estrecha. Prometer menos incertidumbre de la que hay es el pecado que
 *      este producto no comete.
 *
 * Puro: ni DOM, ni almacén, ni red. Y **no importa `./milestones.js`** a
 * propósito: ese módulo arrastra estáticamente los 34 KB del catálogo estético,
 * y aquí solo hacen falta los hitos ya resueltos, que entran como argumento.
 *
 * Devuelve **códigos y parámetros, nunca cadenas visibles** (el patrón
 * `Issue.code` del resto del núcleo): traducir es tarea de la interfaz.
 */

import { SCENARIO_PROGRESS_EXPONENTS } from './constants.js';

/**
 * @typedef {'planStart' | 'phaseStart' | 'threshold' | 'aesthetic' | 'checkin'
 *   | 'recalibration' | 'planEnd'} EventKind
 *
 * @typedef {Object} DateWindow
 * @property {number} fromDay día del cruce en el escenario optimista
 * @property {number} toDay día del cruce en el escenario pesimista
 * @property {string} fromISO
 * @property {string} toISO
 * @property {boolean} meaningful `false` cuando la ventana es tan estrecha que
 *   mostrarla como rango sería precisión fingida; la interfaz enseña una fecha
 *
 * @typedef {Object} TimelineEvent
 * @property {string} id estable, para el `key` del render
 * @property {EventKind} kind
 * @property {number} dayIndex negativo si ocurrió antes de este plan
 * @property {string} dateISO
 * @property {boolean} past ya ha ocurrido respecto a hoy
 * @property {boolean} beforePlan ocurrió antes del comienzo del plan vigente
 * @property {import('./generator.js').PhaseType | null} phaseType fase en la que cae
 * @property {DateWindow | null} window solo en lo proyectado, nunca en lo medido
 * @property {*} data carga útil propia de cada tipo
 *
 * @typedef {Object} TimelineGroup
 * @property {string} id
 * @property {import('./generator.js').PhaseType | 'beforePlan'} phaseType
 * @property {number} startDayIndex
 * @property {number} days
 * @property {string} startISO
 * @property {string} endISO
 * @property {boolean} past
 * @property {boolean} current contiene el día de hoy
 * @property {TimelineEvent[]} events
 */

/**
 * Ancho mínimo, en días, para que una ventana se muestre como rango.
 *
 * Por debajo de esto los dos extremos caen en la misma semana y enseñarlos
 * como «entre el 12 y el 14» sugiere una precisión que el modelo no tiene.
 */
const MIN_MEANINGFUL_WINDOW_DAYS = 5;

/**
 * Orden entre eventos que caen el mismo día. Fijo y explícito: `Array.sort` no
 * garantiza estabilidad entre motores, y un orden que baila entre recargas es
 * un defecto que solo se ve en el móvil de otra persona.
 * @type {Record<EventKind, number>}
 */
const KIND_ORDER = {
    planStart: 0,
    recalibration: 1,
    phaseStart: 2,
    checkin: 3,
    threshold: 4,
    aesthetic: 5,
    planEnd: 6
};

/** @param {unknown} v @returns {v is number} */
function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Cuándo llega un escenario al punto que el esperado alcanza el día `dayIndex`.
 *
 * Es la inversa de la deformación `T·(d/T)^k` que usa el generador para dibujar
 * la banda. Un exponente `k < 1` (optimista) adelanta; `k > 1` (pesimista)
 * retrasa.
 * @param {number} dayIndex
 * @param {number} totalDays
 * @param {number} k exponente del escenario
 * @returns {number}
 */
function scenarioDay(dayIndex, totalDays, k) {
    if (!(totalDays > 0)) return 0;
    const progress = Math.min(Math.max(dayIndex / totalDays, 0), 1);
    return totalDays * Math.pow(progress, 1 / k);
}

/**
 * La ventana optimista–pesimista de un día proyectado.
 * @param {number} dayIndex
 * @param {number} totalDays
 * @param {(d: number) => string} dateAt
 * @returns {DateWindow | null}
 */
export function windowFor(dayIndex, totalDays, dateAt) {
    if (!isFiniteNumber(dayIndex) || !isFiniteNumber(totalDays) || totalDays <= 0) return null;
    if (dayIndex < 0 || dayIndex > totalDays) return null;

    const clamp = (/** @type {number} */ d) => Math.min(Math.max(d, 0), totalDays);
    // hacia fuera en los dos sentidos: la ventana se ensancha, nunca se estrecha
    const fromDay = clamp(Math.floor(scenarioDay(dayIndex, totalDays, SCENARIO_PROGRESS_EXPONENTS.optimist)));
    const toDay = clamp(Math.ceil(scenarioDay(dayIndex, totalDays, SCENARIO_PROGRESS_EXPONENTS.pessimist)));

    return {
        fromDay,
        toDay,
        fromISO: dateAt(fromDay),
        toISO: dateAt(toDay),
        meaningful: toDay - fromDay >= MIN_MEANINGFUL_WINDOW_DAYS
    };
}

/**
 * Los límites de cada fase dentro de la serie, en índices de día.
 * @param {import('./engine.js').PhasePlan} plan
 * @returns {Array<{ type: import('./generator.js').PhaseType, startDayIndex: number, days: number, phase: import('./engine.js').Phase }>}
 */
function phaseBounds(plan) {
    const out = [];
    let cursor = 0;
    for (const phase of plan.phases ?? []) {
        out.push({ type: phase.type, startDayIndex: cursor, days: phase.days, phase });
        cursor += phase.days;
    }
    return out;
}

/**
 * Construye la línea de tiempo completa.
 *
 * @param {Object} input
 * @param {import('./generator.js').Projection} input.projection
 * @param {import('./engine.js').PhasePlan} input.plan
 * @param {number} input.todayIndex
 * @param {Array<*>} [input.aesthetic] hitos estéticos YA resueltos
 *   (`milestones.aestheticMilestonesFor`), pasados como argumento para no
 *   arrastrar el catálogo hasta aquí
 * @param {Array<*>} [input.checkins] evaluaciones de `tracking.evaluateSeries`
 * @param {Array<*>} [input.history] recalibraciones archivadas (`plan.history`)
 * @returns {TimelineEvent[]} ordenados por día y, dentro del día, por tipo
 */
export function buildTimeline(input) {
    if (input === null || typeof input !== 'object') return [];
    const { projection, plan, todayIndex } = input;
    const daily = projection?.daily;
    if (!Array.isArray(daily) || daily.length === 0) return [];
    if (plan === null || typeof plan !== 'object') return [];

    const totalDays = isFiniteNumber(plan.totalDays) ? plan.totalDays : daily.length - 1;
    const today = isFiniteNumber(todayIndex) ? todayIndex : 0;
    const dateAt = (/** @type {number} */ d) =>
        daily[Math.min(Math.max(Math.round(d), 0), daily.length - 1)]?.dateISO ?? '';
    const phaseAt = (/** @type {number} */ d) =>
        daily[Math.min(Math.max(d, 0), daily.length - 1)]?.phaseType ?? null;

    /** @type {TimelineEvent[]} */
    const events = [];

    /** Alta de un evento con los campos derivados ya resueltos. */
    const push = (/** @type {Partial<TimelineEvent> & {id: string, kind: EventKind, dayIndex: number}} */ e) => {
        const beforePlan = e.dayIndex < 0;
        events.push({
            window: null,
            phaseType: beforePlan ? null : phaseAt(e.dayIndex),
            dateISO: e.dateISO ?? dateAt(e.dayIndex),
            past: beforePlan || e.dayIndex <= today,
            beforePlan,
            data: e.data ?? {},
            ...e,
            // se recalculan tras el spread para que un `e` incompleto no los pise
            id: e.id,
            kind: e.kind,
            dayIndex: e.dayIndex
        });
    };

    // ---- el comienzo, que es un dato y no un adorno ----
    const d0 = daily[0];
    push({
        id: 'plan:start',
        kind: 'planStart',
        dayIndex: 0,
        data: { weightKg: d0.weightKg, fatPct: d0.fatPct, muscleKg: d0.muscleKg }
    });

    // ---- fases: cada una cambia lo que comes, y eso merece decirse ----
    const bounds = phaseBounds(plan);
    let previousKcal = null;
    for (const b of bounds) {
        const kcal = b.phase.nominalKcal ?? null;
        push({
            id: `phase:${b.type}:${b.startDayIndex}`,
            kind: 'phaseStart',
            dayIndex: b.startDayIndex,
            data: {
                phaseType: b.type,
                days: b.days,
                targetKcal: kcal?.targetKcal ?? null,
                deficitKcal: kcal?.deficitKcal ?? null,
                tdeeKcal: kcal?.tdeeKcal ?? null,
                flooredBySafety: kcal?.flooredBySafety ?? false,
                // el salto respecto a la fase anterior es lo accionable:
                // «a partir de aquí comes 300 kcal más»
                kcalDelta: previousKcal !== null && isFiniteNumber(kcal?.targetKcal)
                    ? kcal.targetKcal - previousKcal
                    : null,
                expected: b.phase.expected ?? null
            }
        });
        if (isFiniteNumber(kcal?.targetKcal)) previousKcal = kcal.targetKcal;
    }

    // ---- cruces de umbral, con su ventana ----
    for (const m of projection.milestones ?? []) {
        if (!m || m.category === 'phase') continue; // las fases ya están arriba
        if (!isFiniteNumber(m.dayIndex)) continue;
        push({
            id: `threshold:${m.id}`,
            kind: 'threshold',
            dayIndex: m.dayIndex,
            dateISO: m.dateISO,
            window: windowFor(m.dayIndex, totalDays, dateAt),
            // se guarda el hito ENTERO para que la interfaz pueda pasárselo a
            // `milestoneLabel()` tal cual: un segundo camino de etiquetado es
            // literalmente el defecto HIT-* del legacy
            data: { milestone: m }
        });
    }

    // ---- cambios visibles del catálogo ----
    for (const a of input.aesthetic ?? []) {
        if (!a || !isFiniteNumber(a.dayIndex)) continue;
        if (a.fromStart) continue; // ya se cumplía el día 0: no es un logro
        push({
            id: `aesthetic:${a.id}`,
            kind: 'aesthetic',
            dayIndex: a.dayIndex,
            dateISO: a.dateISO,
            window: windowFor(a.dayIndex, totalDays, dateAt),
            data: { item: a }
        });
    }

    // ---- lo medido: sin ventana, porque no se proyecta, se pesó ----
    for (const c of input.checkins ?? []) {
        if (!c || !isFiniteNumber(c.dayIndex)) continue;
        push({
            id: `checkin:${c.checkinId ?? c.dateISO}`,
            kind: 'checkin',
            dayIndex: c.dayIndex,
            dateISO: c.dateISO,
            past: true,
            data: {
                actualKg: c.actualKg,
                expectedKg: c.expectedKg,
                deltaKg: c.deltaKg,
                signal: c.signal
            }
        });
    }

    // ---- recalibraciones: SIEMPRE anteriores a este plan ----
    // `recalibrate` fija `startDateISO` a la fecha del check-in que la motivó,
    // así que el plan vigente empieza justo después y lo archivado cae fuera
    // por construcción. Va a su propio grupo en vez de descartarse en silencio.
    for (const h of input.history ?? []) {
        if (!h) continue;
        const iso = typeof h.archivedAtISO === 'string' ? h.archivedAtISO.slice(0, 10) : '';
        push({
            id: `recal:${h.archivedAtISO ?? iso}`,
            kind: 'recalibration',
            dayIndex: -1,
            dateISO: iso,
            data: { reason: h.reason ?? 'recalibration', previousTotalDays: h.plan?.totalDays ?? null }
        });
    }

    // ---- el final ----
    const last = daily[daily.length - 1];
    push({
        id: 'plan:end',
        kind: 'planEnd',
        dayIndex: totalDays,
        data: { weightKg: last.weightKg, fatPct: last.fatPct, muscleKg: last.muscleKg }
    });

    events.sort((a, b) => {
        if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
        const ka = KIND_ORDER[a.kind] ?? 99;
        const kb = KIND_ORDER[b.kind] ?? 99;
        if (ka !== kb) return ka - kb;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    return events;
}

/**
 * Agrupa los eventos por FASE, no por mes.
 *
 * La fase es la unidad narrativa del plan: es lo que cambia las calorías, lo
 * que cambia lo que hace el cuerpo, y ya es color y etiqueta de primera clase
 * en el sistema de diseño. Da tres a seis grupos en vez de trece meses, que es
 * la diferencia entre una historia y un calendario.
 *
 * @param {TimelineEvent[]} events
 * @param {import('./engine.js').PhasePlan} plan
 * @param {number} todayIndex
 * @param {(d: number) => string} dateAt
 * @returns {TimelineGroup[]}
 */
export function groupByPhase(events, plan, todayIndex, dateAt) {
    if (!Array.isArray(events)) return [];
    const bounds = phaseBounds(plan ?? /** @type {*} */ ({ phases: [] }));
    const today = isFiniteNumber(todayIndex) ? todayIndex : 0;

    /** @type {TimelineGroup[]} */
    const groups = [];

    const anteriores = events.filter((e) => e.beforePlan);
    if (anteriores.length > 0) {
        groups.push({
            id: 'group:beforePlan',
            phaseType: 'beforePlan',
            startDayIndex: -1,
            days: 0,
            startISO: anteriores[0].dateISO,
            endISO: anteriores[anteriores.length - 1].dateISO,
            past: true,
            current: false,
            events: anteriores
        });
    }

    for (const b of bounds) {
        const end = b.startDayIndex + b.days;
        // El límite superior es inclusivo solo en la última fase, para que el
        // evento de cierre del plan no se quede sin grupo.
        const isLast = b === bounds[bounds.length - 1];
        const inside = events.filter((e) => !e.beforePlan
            && e.dayIndex >= b.startDayIndex
            && (isLast ? e.dayIndex <= end : e.dayIndex < end));
        if (inside.length === 0) continue;
        groups.push({
            id: `group:${b.type}:${b.startDayIndex}`,
            phaseType: b.type,
            startDayIndex: b.startDayIndex,
            days: b.days,
            startISO: dateAt(b.startDayIndex),
            endISO: dateAt(end),
            past: end <= today,
            current: b.startDayIndex <= today && today < end,
            events: inside
        });
    }
    return groups;
}

// @ts-check

/**
 * Estilo y ejes de las series superpuestas (E13-3).
 *
 * DOS CANALES INDEPENDIENTES, y la separación es el contenido de este módulo:
 *
 * | canal              | codifica    | valores                                    |
 * |--------------------|-------------|--------------------------------------------|
 * | patrón de trazo    | procedencia | continua · discontinua · punteada · raya-punto |
 * | color + marcador   | hueco (1-4) | cuatro tokens · círculo, cuadrado, triángulo, rombo |
 *
 * No es adorno. Es lo que hace legible la gráfica en escala de grises, al
 * imprimirla y con daltonismo — y hace falta porque `tokens.css` documenta que
 * **32,1 es la separación MÁXIMA alcanzable** frente a los colores que ya
 * significan algo. Si el color tuviera que cargar con el significado, la paleta
 * semántica no dejaría sitio. Así solo desempata.
 *
 * El módulo es PURO: la paleta entra por parámetro en vez de leerse de
 * `getComputedStyle`, así que se prueba entero desde Node sin navegador.
 */

/**
 * @typedef {import('../core/series-catalog.js').Provenance} Provenance
 * @typedef {import('../core/series-catalog.js').UnitId} UnitId
 * @typedef {import('../core/series-catalog.js').ResolvedSeries} ResolvedSeries
 */

/**
 * Cómo se dibuja cada procedencia.
 *
 * `measured` reproduce EXACTAMENTE el estilo que el check-in ya tenía —trazo
 * discontinuo [3,3], `borderWidth: 1`, `pointRadius: 5` y el rombo `rectRot`—,
 * así que el contrato de test que localiza los check-ins por su `pointStyle`
 * sobrevive gratis y lo medido sigue viéndose igual en las dos vistas.
 */
export const PROVENANCE_STYLE = Object.freeze({
    projected: Object.freeze({ borderDash: /** @type {number[]} */ ([]), borderWidth: 2, tension: 0.15 }),
    measured: Object.freeze({ borderDash: [3, 3], borderWidth: 1, tension: 0 }),
    derived: Object.freeze({ borderDash: [2, 4], borderWidth: 2, tension: 0.15 }),
    estimated: Object.freeze({ borderDash: [6, 3, 2, 3], borderWidth: 2, tension: 0.15 })
});

/** Marcador de cada hueco. Ocho formas que se distinguen a 5 px. El rombo
 * (`rectRot`) se queda en el hueco 4: es el marcador del check-in de la v1 y
 * hay un contrato de test que lo localiza por esa forma. */
export const SLOT_POINT_STYLE = Object.freeze([
    'circle', 'rect', 'triangle', 'rectRot', 'star', 'cross', 'rectRounded', 'crossRot'
]);

/**
 * Cuántas series caben a la vez.
 *
 * Subió de 4 a 8 a petición del dueño del producto tras la primera prueba real
 * («deben poder graficarse todas las variables que se quieran»). El precio es
 * medido y está pagado: la paleta de 8 baja la ΔE mínima de 40,1 a 30,2 —sigue
 * siendo distinguible bajo las tres dicromacias— y con ocho series la leyenda
 * es una lista, no una fila. Más de ocho ya no se distingue por color+marcador
 * y ahí el límite vuelve a ser técnico.
 */
export const MAX_SERIES = 8;

/**
 * Cuántas veces, como mínimo, debe aparecer el marcador de una serie a lo ancho
 * de la ventana visible.
 *
 * Existe porque el camino de una sola métrica usa `pointRadius: 0` en grano
 * diario, y con cuatro series eso deja el color como ÚNICA señal para
 * distinguir dos series de la misma procedencia — que es justo lo que el doble
 * canal viene a evitar. Seis puntos bastan para reconocer la forma sin
 * convertir la línea en un collar.
 */
export const MIN_MARKERS_VISIBLE = 6;

/**
 * Cada cuántos puntos se dibuja un marcador para que se vean al menos
 * `MIN_MARKERS_VISIBLE` a lo ancho.
 *
 * `floor` y no `ceil`: con `ceil` el paso se pasa de largo y salen MENOS
 * marcadores de los pedidos. Con 7 puntos, `ceil(7/6) = 2` deja marcadores en
 * 0-2-4-6, que son cuatro. `floor(7/6) = 1` los pone en los siete. El error
 * solo aparece justo por encima del umbral, que es donde nadie mira.
 * @param {number} pointCount
 * @returns {number} 1 = todos
 */
export function markerEvery(pointCount) {
    if (!Number.isFinite(pointCount) || pointCount <= MIN_MARKERS_VISIBLE) return 1;
    return Math.max(1, Math.floor(pointCount / MIN_MARKERS_VISIBLE));
}

/**
 * El estilo de dataset de una serie.
 * @param {Provenance} provenance
 * @param {number} slot 0..3
 * @param {string[]} palette los cuatro colores YA resueltos por el llamador
 * @param {number} [pointCount] para decidir cada cuántos puntos va un marcador
 * @returns {*} campos de estilo listos para fundir en un dataset de Chart.js
 */
export function styleFor(provenance, slot, palette, pointCount = 0) {
    const trazo = PROVENANCE_STYLE[provenance] ?? PROVENANCE_STYLE.projected;
    const color = palette[slot % palette.length] ?? palette[0];
    const cada = markerEvery(pointCount);
    return {
        borderColor: color,
        backgroundColor: color,
        borderWidth: trazo.borderWidth,
        borderDash: [...trazo.borderDash],
        tension: trazo.tension,
        pointStyle: SLOT_POINT_STYLE[slot % SLOT_POINT_STYLE.length],
        // Un marcador cada `cada` puntos: el resto con radio 0. Con `pointRadius`
        // como array, Chart.js lo aplica punto a punto.
        pointRadius: (/** @type {*} */ ctx) =>
            (ctx.dataIndex % cada === 0 ? (provenance === 'measured' ? 5 : 3) : 0),
        pointHoverRadius: 8
    };
}

/**
 * @typedef {Object} AxisPlan
 * @property {Array<{ id: string, unit: UnitId, position: 'left'|'right', series: number[] }>} axes
 * @property {'ok'|'tooManyUnits'} status
 * @property {UnitId[]} units las unidades distintas presentes, en orden de hueco
 */

/**
 * Reparte las series en ejes según su unidad.
 *
 * TRES CASOS, y el tercero es una decisión de honestidad, no una limitación:
 *
 * 1. **Una unidad → un eje**, `id: 'y'`, y **cero `yAxisID` en los datasets**.
 *    No es cosmético: hoy no hay un solo `yAxisID` en el repo, y el camino de
 *    una métrica debe seguir produciendo exactamente la misma configuración.
 *    Regla dura: `yAxisID` solo se escribe cuando hay más de un eje.
 * 2. **Dos unidades → `y` a la izquierda, `y2` a la derecha.** Manda la unidad
 *    del hueco 0, así que el usuario controla qué lado ocupa cada cosa
 *    reordenando su selección. Determinista y explicable.
 * 3. **Tres o más → `tooManyUnits`, y NO se dibuja.** Meter tres unidades en dos
 *    ejes obliga a elegir cuál de las tres miente sobre su escala. Y normalizar
 *    en silencio es peor: cambia lo que SIGNIFICAN los números sin que nadie lo
 *    haya pedido. La salida es el modo «cambio desde el inicio», que el usuario
 *    enciende a propósito.
 *
 * @param {ResolvedSeries[]} resolved 1..4, YA pasadas por la aduana de músculo
 * @returns {AxisPlan}
 */
export function planAxes(resolved) {
    const lista = Array.isArray(resolved) ? resolved : [];
    /** @type {UnitId[]} */ const units = [];
    for (const r of lista) {
        if (r && !units.includes(r.unit)) units.push(r.unit);
    }
    if (units.length === 0) return { axes: [], status: 'ok', units };
    if (units.length > 2) return { axes: [], status: 'tooManyUnits', units };

    const axes = units.map((unit, i) => ({
        id: i === 0 ? 'y' : 'y2',
        unit,
        position: /** @type {'left'|'right'} */ (i === 0 ? 'left' : 'right'),
        series: lista.map((r, idx) => (r?.unit === unit ? idx : -1)).filter((idx) => idx >= 0)
    }));
    return { axes, status: 'ok', units };
}

/**
 * El eje que le toca a cada serie, o `null` si solo hay uno.
 *
 * Devolver `null` con un solo eje es la mitad que importa: es lo que impide que
 * el camino de una métrica empiece a escribir `yAxisID` y deje de coincidir con
 * la configuración que produce hoy.
 * @param {AxisPlan} plan
 * @param {number} index
 * @returns {string | null}
 */
export function axisIdFor(plan, index) {
    if (!plan || plan.axes.length <= 1) return null;
    const axis = plan.axes.find((a) => a.series.includes(index));
    return axis ? axis.id : plan.axes[0].id;
}

/**
 * @typedef {'raw'|'delta'} NormalizeMode
 */

/**
 * Por debajo de este valor absoluto, una serie no se puede expresar como cambio
 * PORCENTUAL: su origen está tan cerca de cero que el porcentaje explota.
 *
 * Le pasa por construcción a las series que YA son un delta —la fluctuación
 * diaria, el déficit calórico, la desviación del plan—, que oscilan alrededor
 * de cero. Un déficit que pasa de −5 a −300 kcal no es «un aumento del 5 900 %»:
 * es una cifra sin sentido dibujada con toda seriedad.
 */
export const REBASE_MIN_BASELINE = 1e-6;

/**
 * Reexpresa una serie como CAMBIO PORCENTUAL sobre su primer valor dentro de la
 * ventana visible.
 *
 * **Porcentual y no absoluto, y esto fue una corrección de diseño.** El primer
 * planteamiento restaba el origen y dejaba kilos, kilocalorías y centímetros en
 * el mismo eje — que es exactamente el problema que este modo venía a resolver:
 * un cambio de −5 kg y otro de −300 kcal siguen sin ser comparables, y las kcal
 * aplastan al resto por dos órdenes de magnitud. En porcentaje sí lo son, y el
 * eje puede decir qué es sin mentir.
 *
 * El origen es la VENTANA y no el día 0 a propósito: comparar formas en los
 * últimos 30 días con la referencia puesta hace ocho meses no compara formas,
 * compara acumulados. La contrapartida —que mover la ventana cambia la
 * referencia— se dice en la interfaz; callarlo sería el engaño de verdad.
 *
 * @param {import('../core/series-catalog.js').SeriesPoint[]} points
 * @param {number} from primer dayIndex visible
 * @returns {{ points: import('../core/series-catalog.js').SeriesPoint[], baseline: number, baselineX: number }
 *   | { points: null, reason: string }
 *   | null} null si no hay ningún punto dentro de la ventana
 */
export function rebase(points, from) {
    if (!Array.isArray(points) || points.length === 0) return null;
    const base = points.find((p) => p.x >= from) ?? null;
    if (!base) return null;
    if (Math.abs(base.y) < REBASE_MIN_BASELINE) {
        // Se declara, no se dibuja como ±infinito. Un número absurdo pintado con
        // seriedad es peor que un hueco explicado.
        return { points: null, reason: 'series.reason.deltaNotRelative' };
    }
    return {
        points: points.map((p) => ({ x: p.x, y: ((p.y - base.y) / Math.abs(base.y)) * 100 })),
        baseline: base.y,
        baselineX: base.x
    };
}

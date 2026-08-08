// @ts-check

/**
 * Geometría de gráficas pequeñas en SVG (E13-7).
 *
 * Extraído de `muscle-grid.js`, que ya lo tenía resuelto y ya había argumentado
 * por qué SVG y no una instancia de Chart.js para esto: sin ejes, sin tooltip y
 * sin cursor propio, un `path` de cien puntos hace el trabajo de un controlador
 * completo con escalas y detección de impactos. Dos consumidores con dos copias
 * de la misma fórmula acabarían con dos ideas distintas de dónde cae un punto.
 *
 * Las coordenadas van en unidades de `viewBox`, no en píxeles: el SVG escala
 * solo y el mismo camino sirve a 120 px y a 1 200.
 */

/**
 * Camino SVG de una serie, normalizado al lienzo.
 *
 * Una serie plana se dibuja en el CENTRO y no en el suelo: dividir por un
 * recorrido cero da infinito, y pegarla abajo sugeriría un mínimo que no existe.
 *
 * @param {number[]} values
 * @param {number} min
 * @param {number} max
 * @param {number} width en unidades de viewBox
 * @param {number} height
 * @returns {string}
 */
export function pathOf(values, min, max, width, height) {
    if (!Array.isArray(values) || values.length === 0) return '';
    const span = max - min;
    const y = (/** @type {number} */ v) => (span <= 0 ? height / 2 : height - ((v - min) / span) * height);
    const x = (/** @type {number} */ i) => (values.length === 1 ? 0 : (i / (values.length - 1)) * width);
    return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
}

/**
 * Área cerrada entre dos series, para pintar una banda.
 *
 * La escala vertical tiene que ser COMÚN a las dos y a la línea que envuelven:
 * con escalas distintas la banda podría salir por debajo de su propia línea, que
 * es exactamente la clase de gráfica que engaña sin mentir en ningún número.
 *
 * @param {number[]} lower @param {number[]} upper
 * @param {number} min @param {number} max @param {number} width @param {number} height
 * @returns {string}
 */
export function bandPath(lower, upper, min, max, width, height) {
    if (!Array.isArray(lower) || lower.length === 0) return '';
    const span = max - min;
    const y = (/** @type {number} */ v) => (span <= 0 ? height / 2 : height - ((v - min) / span) * height);
    const x = (/** @type {number} */ i) => (lower.length === 1 ? 0 : (i / (lower.length - 1)) * width);
    const ida = upper.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
    const vuelta = [...lower].reverse()
        .map((v, i) => `L${x(lower.length - 1 - i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
    return `${ida} ${vuelta} Z`;
}

/**
 * Muestrea una serie larga a un número manejable de puntos.
 *
 * Un plan de 200 días son 200 puntos por grupo y 2 000 en una rejilla de diez. A
 * 120 unidades de ancho, más de ~60 puntos no añaden un píxel de información y
 * sí multiplican por tres el tamaño del documento.
 *
 * @template T
 * @param {T[]} list
 * @param {number} maxPoints
 * @returns {T[]}
 */
export function sample(list, maxPoints = 60) {
    if (!Array.isArray(list) || list.length <= maxPoints) return list ?? [];
    const step = (list.length - 1) / (maxPoints - 1);
    return Array.from({ length: maxPoints }, (_, i) => list[Math.round(i * step)]);
}

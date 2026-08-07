// @ts-check

/**
 * Fechas legibles para la interfaz (decisión E12).
 *
 * EL PROBLEMA. Hasta ahora las fechas se imprimían en ISO crudo
 * (`2027-02-14`) o directamente como número de día («día 137»), que sobre un
 * plan de 377 días no le dice nada a nadie. Aquí se traducen al idioma activo.
 *
 * LA TRAMPA, Y ES SERIA: **`timeZone: 'UTC'` es obligatorio en todas las
 * llamadas.** Las fechas del generador son días civiles en UTC puro
 * (`generator.js`, decisión GEN-02): son cadenas `YYYY-MM-DD`, no instantes.
 * `new Date('2027-02-14')` las interpreta como medianoche UTC, y sin fijar la
 * zona el formateador las reproyecta a la del usuario — quien viva en UTC-5
 * vería «13 feb» en cada rótulo del eje, y la línea de HOY dejaría de coincidir
 * con su propia etiqueta. Un desfase de un día que solo aparece a partir de
 * cierta longitud geográfica es exactamente la clase de defecto que no se
 * reproduce en el portátil de quien lo escribió.
 *
 * Sin dependencias: `Intl` es del navegador. Los formateadores se memorizan
 * porque construir uno es caro y el eje pide decenas de etiquetas por dibujado.
 */

import { getLocale } from '../i18n/i18n.js';

/** @type {Map<string, Intl.DateTimeFormat>} */
const cache = new Map();

/**
 * @param {Intl.DateTimeFormatOptions} options
 * @returns {Intl.DateTimeFormat | null}
 */
function formatter(options) {
    const locale = getLocale();
    const key = `${locale}|${JSON.stringify(options)}`;
    const hit = cache.get(key);
    if (hit) return hit;
    try {
        const made = new Intl.DateTimeFormat(locale, { timeZone: 'UTC', ...options });
        cache.set(key, made);
        return made;
    } catch {
        return null;
    }
}

/**
 * @param {string} dateISO `YYYY-MM-DD`
 * @returns {Date | null}
 */
function parse(dateISO) {
    if (typeof dateISO !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(dateISO)) return null;
    const ms = Date.parse(`${dateISO.slice(0, 10)}T00:00:00Z`);
    return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Día y mes: «14 feb». El formato de los rótulos del eje y de la línea de tiempo.
 * @param {string} dateISO
 * @returns {string}
 */
export function shortDate(dateISO) {
    const d = parse(dateISO);
    const f = formatter({ day: 'numeric', month: 'short' });
    return d && f ? f.format(d) : (dateISO ?? '');
}

/**
 * Mes y año: «feb 2027». Para la granularidad mensual y las cabeceras.
 * @param {string} dateISO
 * @returns {string}
 */
export function monthYear(dateISO) {
    const d = parse(dateISO);
    const f = formatter({ month: 'short', year: 'numeric' });
    return d && f ? f.format(d) : (dateISO ?? '');
}

/**
 * Fecha completa: «14 de febrero de 2027». Para textos, no para ejes.
 * @param {string} dateISO
 * @returns {string}
 */
export function longDate(dateISO) {
    const d = parse(dateISO);
    const f = formatter({ day: 'numeric', month: 'long', year: 'numeric' });
    return d && f ? f.format(d) : (dateISO ?? '');
}

/**
 * El rótulo que le corresponde a un eje según lo ancho que sea su ventana.
 *
 * Una ventana de tres semanas quiere el día; una de dos años, el mes y el año.
 * Y el año solo aparece cuando de verdad hace falta, porque cada carácter de
 * más en un rótulo es un carácter que empuja el reflujo a 320 px.
 *
 * @param {string} dateISO
 * @param {number} spanDays días que abarca la ventana visible
 * @returns {string}
 */
export function axisLabel(dateISO, spanDays) {
    if (!(spanDays > 0)) return shortDate(dateISO);
    if (spanDays <= 120) return shortDate(dateISO);
    return monthYear(dateISO);
}

/** Vacía los formateadores memorizados. Lo llama el cambio de idioma. */
export function resetDateCache() {
    cache.clear();
}

// @ts-check

/**
 * i18n mínimo del proyecto (CLAUDE.md §5, A6): ningún literal visible al
 * usuario vive fuera de los diccionarios. `t()` interpola parámetros de forma
 * segura (sin eval, sin plantillas dinámicas) y cae a 'es' con aviso.
 *
 * La persistencia del idioma la orquesta el llamante vía `storage.js`
 * (este módulo no toca almacenamiento).
 */

import { es } from './es.js';
import { en } from './en.js';

/** @type {Record<string, Record<string, string>>} */
const DICTIONARIES = { es, en };

const FALLBACK_LOCALE = 'es';

/** @type {string} */
let locale = FALLBACK_LOCALE;

/** @returns {string[]} códigos de idioma disponibles */
export function availableLocales() {
    return Object.keys(DICTIONARIES);
}

/** @returns {string} */
export function getLocale() {
    return locale;
}

/**
 * Cambia el idioma activo. Idiomas no soportados se ignoran con aviso.
 * @param {string} next
 * @returns {boolean} true si el idioma se aplicó
 */
export function setLocale(next) {
    if (Object.prototype.hasOwnProperty.call(DICTIONARIES, next)) {
        locale = next;
        return true;
    }
    console.warn(`[i18n] idioma no soportado: ${JSON.stringify(next)}; se mantiene '${locale}'`);
    return false;
}

/**
 * ¿Existe la clave (en el idioma activo o en el fallback)? SIN avisar.
 *
 * Es lo que hay que usar para DECIDIR entre dos claves, en vez de llamar a
 * `t()` y comparar el resultado con la clave: `t()` avisa por consola en cuanto
 * la clave no existe, así que sondear con él ensucia la consola aunque la vista
 * tenga su fallback (el defecto de `dashboard.js` con `today.plan.target.muscleLoss`).
 * @param {string} key
 * @returns {boolean}
 */
export function hasKey(key) {
    return DICTIONARIES[locale][key] !== undefined
        || DICTIONARIES[FALLBACK_LOCALE][key] !== undefined;
}

/**
 * Traduce una clave con interpolación segura de parámetros `{nombre}`.
 * Clave ausente en el idioma activo => fallback a 'es' con aviso;
 * ausente también en 'es' => devuelve la propia clave con aviso.
 * @param {string} key
 * @param {Record<string, string | number>} [params]
 * @returns {string}
 */
export function t(key, params) {
    let text = DICTIONARIES[locale][key];
    if (text === undefined && locale !== FALLBACK_LOCALE) {
        text = DICTIONARIES[FALLBACK_LOCALE][key];
        if (text !== undefined) {
            console.warn(`[i18n] clave sin traducir en '${locale}': ${key}`);
        }
    }
    if (text === undefined) {
        console.warn(`[i18n] clave ausente: ${key}`);
        return key;
    }
    if (params) {
        text = text.replace(/\{(\w+)\}/g, (match, name) =>
            Object.prototype.hasOwnProperty.call(params, name) ? formatParam(params[name]) : match
        );
    }
    return text;
}

/**
 * Formateadores de parámetros numéricos, por idioma.
 * @type {Map<string, Intl.NumberFormat>}
 */
const paramFormatters = new Map();

/**
 * Un parámetro, listo para meter en el texto.
 *
 * LOS NÚMEROS SE LOCALIZAN AQUÍ, y este es el sitio correcto por una razón que
 * costó descubrir: arreglar `ui/format.js` no bastaba. Media docena de vistas
 * pasaban el número CRUDO como parámetro —`t('volume.sets', { sets: 4.8 })`— y
 * `String()` lo escribía «4.8» con punto, en español, saltándose el formateador
 * sin que nadie lo notara. Cualquier vista futura habría vuelto a hacerlo.
 * Aquí, en cambio, pasa TODO el texto visible de la aplicación: es imposible
 * saltárselo.
 *
 * `maximumFractionDigits: 3` y ningún mínimo: no se inventan decimales que el
 * número no traía —12 sigue siendo «12»— y solo se cambia el separador. Para
 * decimales FIJOS está `ui/format.js`, que es otra decisión y se toma en la
 * vista.
 * @param {string | number} value
 * @returns {string}
 */
function formatParam(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return String(value);
    let formatter = paramFormatters.get(locale);
    if (!formatter) {
        formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 });
        paramFormatters.set(locale, formatter);
    }
    return formatter.format(value);
}

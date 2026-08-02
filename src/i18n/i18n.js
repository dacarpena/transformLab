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
            Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
        );
    }
    return text;
}

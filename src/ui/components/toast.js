// @ts-check

/**
 * Avisos efímeros. Viven en una región `aria-live` persistente para que los
 * lectores de pantalla los anuncien sin robar el foco.
 */

import { escapeHtml } from '../dom.js';
import { t } from '../../i18n/i18n.js';

/** @type {HTMLElement | null} */
let region = null;

/** Duración por tipo: un error se lee más despacio que un «guardado». */
const DURATIONS = { info: 3500, success: 3500, error: 6000 };

/** @returns {HTMLElement} */
function ensureRegion() {
    if (region && document.contains(region)) return region;
    region = document.createElement('div');
    region.className = 'toast-region';
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    document.body.appendChild(region);
    return region;
}

/**
 * Muestra un aviso.
 * @param {string} key clave i18n (nunca un literal: CLAUDE.md A6)
 * @param {{ type?: 'info' | 'success' | 'error', params?: Record<string, string|number> }} [options]
 */
export function show(key, options = {}) {
    const type = options.type ?? 'info';
    const host = ensureRegion();
    // los errores se anuncian de forma asertiva; el resto, no interrumpe
    host.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');

    const el = document.createElement('div');
    el.className = `toast toast--${type}`;
    el.textContent = t(key, options.params); // textContent: cero riesgo de inyección
    host.appendChild(el);

    const remove = () => {
        el.classList.add('toast--leaving');
        el.addEventListener('transitionend', () => el.remove(), { once: true });
        // red de seguridad si no hay transición (prefers-reduced-motion)
        setTimeout(() => el.remove(), 400);
    };
    setTimeout(remove, DURATIONS[type]);
}

/** @param {string} key @param {Record<string, string|number>} [params] */
export function success(key, params) {
    show(key, { type: 'success', params });
}

/** @param {string} key @param {Record<string, string|number>} [params] */
export function error(key, params) {
    show(key, { type: 'error', params });
}

/**
 * Traduce un código de error de la capa de datos a un aviso legible.
 * Los códigos desconocidos caen en un mensaje genérico en vez de enseñar
 * jerga interna al usuario.
 * @param {string} code
 */
export function fromErrorCode(code) {
    const key = `error.code.${code}`;
    const translated = t(key);
    error(translated === key ? 'error.generic' : key);
}

/** Escapa un valor para insertarlo en un aviso compuesto. */
export const safe = escapeHtml;

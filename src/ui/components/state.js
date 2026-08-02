// @ts-check

/**
 * Estados vacíos y de error (decisión D9a).
 *
 * Regla que viene de la ficha H-013 del catálogo: el legacy, cuando Chart.js
 * no cargaba, ofrecía como salida «borrar todos los datos». Aquí una acción
 * destructiva NUNCA es la respuesta por defecto a un fallo. Un estado de error
 * ofrece reintentar o recargar; borrar es siempre una decisión aparte.
 */

import { html } from '../dom.js';
import { t } from '../../i18n/i18n.js';

/**
 * @typedef {{ labelKey: string, action: string, primary?: boolean }} StateAction
 */

/**
 * Estado vacío: no hay datos todavía, pero no ha fallado nada.
 * @param {{ icon?: string, titleKey: string, bodyKey: string, params?: Record<string, string|number>, actions?: StateAction[] }} options
 */
export function empty(options) {
    return html`
        <div class="state state--empty">
            ${options.icon ? html`<div class="state__icon" aria-hidden="true">${options.icon}</div>` : ''}
            <h2 class="state__title">${t(options.titleKey)}</h2>
            <p class="state__body">${t(options.bodyKey, options.params)}</p>
            ${renderActions(options.actions)}
        </div>
    `;
}

/**
 * Estado de error. Se anuncia con `role="alert"` y ofrece SIEMPRE una salida
 * no destructiva.
 * @param {{ titleKey: string, bodyKey: string, params?: Record<string, string|number>, actions?: StateAction[] }} options
 */
export function error(options) {
    const actions = options.actions ?? [{ labelKey: 'action.reload', action: 'reload', primary: true }];
    return html`
        <div class="state state--error" role="alert">
            <div class="state__icon" aria-hidden="true">⚠</div>
            <h2 class="state__title">${t(options.titleKey)}</h2>
            <p class="state__body">${t(options.bodyKey, options.params)}</p>
            ${renderActions(actions)}
        </div>
    `;
}

/**
 * Estado de carga, anunciado a los lectores de pantalla.
 * @param {string} [labelKey]
 */
export function loading(labelKey = 'state.loading') {
    return html`
        <div class="state state--loading" role="status" aria-live="polite">
            <div class="spinner" aria-hidden="true"></div>
            <p class="state__body">${t(labelKey)}</p>
        </div>
    `;
}

/**
 * @param {StateAction[]} [actions]
 */
function renderActions(actions) {
    if (!actions || actions.length === 0) return '';
    return html`
        <div class="state__actions">
            ${actions.map((a) => html`
                <button type="button" class="btn ${a.primary ? 'btn--primary' : ''}" data-action="${a.action}">
                    ${t(a.labelKey)}
                </button>
            `)}
        </div>
    `;
}

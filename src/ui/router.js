// @ts-check

/**
 * Router de vistas (decisión D5a): registro, montaje/desmontaje y navegación.
 * La barra de navegación es la misma en móvil y escritorio; lo que cambia es
 * su colocación, que resuelve el CSS (tabs abajo ≤768 px, barra lateral
 * encima). Aquí no hay ninguna medida de pantalla.
 *
 * La vista activa se persiste vía `storage.js`, así que recargar devuelve al
 * usuario donde estaba.
 */

import { html, render, on, escapeHtml } from './dom.js';
import { t } from '../i18n/i18n.js';
import * as storage from '../data/storage.js';

/**
 * @typedef {Object} ViewDefinition
 * @property {string} id
 * @property {string} labelKey clave i18n de la etiqueta de navegación
 * @property {string} icon glifo decorativo (aria-hidden)
 * @property {(container: HTMLElement) => void | Promise<void>} mount
 * @property {() => void} [unmount] limpieza (listeners, gráficas, timers)
 * @property {boolean} [hidden] fuera de la barra de navegación (p. ej. onboarding)
 */

/** @type {Map<string, ViewDefinition>} */
const views = new Map();

/** @type {ViewDefinition | null} */
let activeView = null;

/** @type {HTMLElement | null} */
let viewContainer = null;

/** @type {HTMLElement | null} */
let navContainer = null;

/** @type {Array<(id: string) => void>} */
const listeners = [];

/** Clave de persistencia de la vista activa. */
const VIEW_KEY = 'ui.activeView';

/** Los listeners del armazón se cablean una sola vez. */
let chromeWired = false;

/**
 * Registra una vista. El orden de registro es el orden de la navegación.
 * @param {ViewDefinition} view
 */
export function register(view) {
    views.set(view.id, view);
}

/** @returns {string} id de la vista activa, o cadena vacía */
export function current() {
    return activeView?.id ?? '';
}

/** @param {(id: string) => void} fn @returns {() => void} desuscripción */
export function onChange(fn) {
    listeners.push(fn);
    return () => {
        const i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
    };
}

/**
 * Pinta la barra de navegación con las vistas visibles.
 * `aria-current="page"` marca la activa para los lectores de pantalla; el
 * resaltado visual NO es la única señal.
 */
function renderNav() {
    if (!navContainer) return;
    const items = [...views.values()].filter((v) => !v.hidden);
    if (items.length === 0) {
        navContainer.hidden = true;
        return;
    }
    navContainer.hidden = false;
    render(navContainer, html`
        <ul class="nav-list">
            ${items.map((v) => html`
                <li>
                    <button type="button" class="nav-item" data-view="${v.id}"
                            ${v.id === activeView?.id ? 'aria-current="page"' : ''}>
                        <span class="nav-icon" aria-hidden="true">${v.icon}</span>
                        <span class="nav-label">${t(v.labelKey)}</span>
                    </button>
                </li>
            `)}
        </ul>
    `);
    // `aria-current` no se puede interpolar como atributo dinámico con el
    // tagged template sin romper el escapado, así que se fija aquí.
    for (const button of navContainer.querySelectorAll('.nav-item')) {
        const isActive = button.getAttribute('data-view') === activeView?.id;
        if (isActive) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    }
}

/**
 * Navega a una vista: desmonta la anterior, monta la nueva, persiste y avisa.
 * @param {string} id
 * @param {{ persist?: boolean }} [options]
 * @returns {Promise<boolean>} false si la vista no existe
 */
export async function navigate(id, options = {}) {
    const next = views.get(id);
    if (!next || !viewContainer) return false;
    if (activeView?.id === id) return true;

    if (activeView?.unmount) {
        try {
            activeView.unmount();
        } catch (err) {
            console.error('[router] fallo al desmontar', activeView.id, err);
        }
    }
    activeView = next;

    // Cada vista recibe un elemento PROPIO y recién creado. Al navegar se
    // descarta entero, y con él mueren todos sus listeners delegados. Sin
    // esto, `on(container, …)` los iba acumulando sobre el mismo contenedor
    // y una vista visitada dos veces respondía dos veces a cada clic.
    const host = document.createElement('div');
    host.className = 'view';
    host.dataset.viewId = id;
    viewContainer.replaceChildren(host);
    viewContainer.setAttribute('aria-busy', 'true');

    try {
        await next.mount(host);
    } catch (err) {
        console.error('[router] fallo al montar', id, err);
        render(host, html`
            <div class="state state--error" role="alert">
                <h2>${t('error.viewTitle')}</h2>
                <p>${t('error.viewBody')}</p>
                <button type="button" class="btn btn--primary" data-action="reload">${t('action.reload')}</button>
            </div>
        `);
    }
    viewContainer.removeAttribute('aria-busy');

    if (options.persist !== false) storage.set(VIEW_KEY, id);
    renderNav();
    for (const fn of listeners) fn(id);
    return true;
}

/**
 * Arranca el router: cablea la navegación y monta la vista inicial (la
 * persistida, si sigue existiendo y es visible; si no, la primera).
 * @param {{ viewRoot: HTMLElement, navRoot: HTMLElement, fallbackView?: string }} options
 * @returns {Promise<void>}
 */
export async function start(options) {
    viewContainer = options.viewRoot;
    navContainer = options.navRoot;

    // Los listeners del armazón se cablean UNA sola vez, aunque `start()` se
    // llame de nuevo al cambiar de perfil: si no, se apilarían.
    if (!chromeWired) {
        chromeWired = true;
        on(navContainer, 'click', '.nav-item', (_event, target) => {
            const id = target.getAttribute('data-view');
            if (id) navigate(id);
        });
        on(viewContainer, 'click', '[data-action="reload"]', () => {
            globalThis.location?.reload();
        });
    }

    let initial = options.fallbackView ?? [...views.keys()][0];
    const saved = storage.get(VIEW_KEY);
    if (saved.ok && typeof saved.value === 'string') {
        const candidate = views.get(saved.value);
        if (candidate && !candidate.hidden) initial = saved.value;
    }
    await navigate(initial);
}

/**
 * Reinicia el router (cambio de perfil, fin del onboarding): limpia el
 * registro y el estado para que el arranque vuelva a definirlo todo.
 */
export function reset() {
    if (activeView?.unmount) activeView.unmount();
    activeView = null;
    views.clear();
    if (viewContainer) viewContainer.replaceChildren();
    if (navContainer) navContainer.replaceChildren();
}

/** Vuelve a pintar la navegación (tras cambiar de idioma). */
export function refreshNav() {
    renderNav();
}

/** Etiqueta accesible de la barra, para el shell. */
export function navLabel() {
    return escapeHtml(t('nav.label'));
}

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
 * @property {(container: HTMLElement) => void | Promise<void>} [mount]
 * @property {() => void} [unmount] limpieza (listeners, gráficas, timers)
 * @property {boolean} [hidden] fuera de la barra de navegación (p. ej. onboarding)
 * @property {boolean} [primary] visible siempre en la barra inferior de móvil
 * @property {() => Promise<{ mount: (container: HTMLElement) => void | Promise<void>, unmount?: () => void }>} [load]
 *   carga diferida del módulo de la vista. Sin bundler, cada vista es una
 *   petición, y montarlas todas por adelantado ponía el catálogo de hitos
 *   (34 KB) y cinco vistas más en el camino crítico del primer pintado.
 * @property {(module: *) => void} [afterLoad] cableado que antes se hacía en
 *   el arranque (los `setOnX` de cada vista); con carga diferida hay que
 *   hacerlo cuando el módulo llega, no antes.
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

/** ¿Está desplegada la hoja de «más» de la barra inferior? */
let navExpanded = false;

/**
 * Contador de navegaciones. Con vistas diferidas, `navigate` tiene un `await`
 * en medio (la petición del módulo), así que dos navegaciones pueden estar en
 * vuelo a la vez. Sin este testigo, la LENTA terminaba después de la rápida y
 * pisaba la vista persistida, la barra de navegación y los oyentes: el
 * usuario veía B y la aplicación creía estar en A.
 */
let navToken = 0;

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

/**
 * Pinta la barra de navegación con las vistas visibles.
 * `aria-current="page"` marca la activa para los lectores de pantalla; el
 * resaltado visual NO es la única señal.
 *
 * Las vistas son once (`src/ui/views/_manifest.js`), y una barra inferior con
 * once pestañas a 320 px daría objetivos de 29 px, muy por debajo del mínimo
 * táctil. Las que no son `primary` se pliegan tras un botón «más» que
 * despliega una hoja; en escritorio la barra lateral las muestra todas y el
 * botón desaparece.
 */
function renderNav() {
    if (!navContainer) return;
    const items = [...views.values()].filter((v) => !v.hidden);
    if (items.length === 0) {
        navContainer.hidden = true;
        return;
    }
    const hasSecondary = items.some((v) => !v.primary);
    navContainer.hidden = false;
    navContainer.classList.toggle('app__nav--open', navExpanded && hasSecondary);
    render(navContainer, html`
        <ul class="nav-list">
            ${items.map((v) => html`
                <li class="nav-list__item ${v.primary ? '' : 'nav-list__item--secondary'}">
                    <button type="button" class="nav-item" data-view="${v.id}">
                        <span class="nav-icon" aria-hidden="true">${v.icon}</span>
                        <span class="nav-label">${t(v.labelKey)}</span>
                    </button>
                </li>
            `)}
            ${hasSecondary ? html`
                <li class="nav-list__item nav-list__more">
                    <button type="button" class="nav-item" data-nav-more>
                        <span class="nav-icon" aria-hidden="true">${navExpanded ? '×' : '⋯'}</span>
                        <span class="nav-label">${t(navExpanded ? 'nav.less' : 'nav.more')}</span>
                    </button>
                </li>
            ` : ''}
        </ul>
    `);
    // `aria-current` y `aria-expanded` no se interpolan como atributos con el
    // tagged template sin romper el escapado, así que se fijan aquí.
    for (const button of navContainer.querySelectorAll('.nav-item[data-view]')) {
        const isActive = button.getAttribute('data-view') === activeView?.id;
        if (isActive) button.setAttribute('aria-current', 'page');
        else button.removeAttribute('aria-current');
    }
    navContainer.querySelector('[data-nav-more]')
        ?.setAttribute('aria-expanded', navExpanded ? 'true' : 'false');
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
    // Navegar siempre repliega la hoja, incluso si se pulsa la vista actual:
    // si no, el usuario se queda con la hoja abierta tapando lo que eligió.
    navExpanded = false;
    if (activeView?.id === id) {
        renderNav();
        return true;
    }

    if (activeView?.unmount) {
        try {
            activeView.unmount();
        } catch (err) {
            console.error('[router] fallo al desmontar', activeView.id, err);
        }
    }
    activeView = next;
    const token = ++navToken;

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
        // Vista diferida: se pide su módulo la primera vez y se guarda en la
        // definición, así la segunda visita es inmediata.
        if (!next.mount && next.load) {
            const module = await next.load();
            // El cableado (`afterLoad`) se hace SIEMPRE aunque esta navegación
            // ya no valga: el módulo ya está aquí y su cableado es global.
            if (!next.mount) {
                next.mount = module.mount;
                next.unmount = module.unmount;
                next.afterLoad?.(module);
            }
            // Pero montar y persistir, no: el usuario ya está en otra vista.
            // Montar aquí dejaría una vista viva en un nodo desconectado, con
            // sus timers, sus URL de objeto y su gráfica sin nadie que las
            // limpie, porque su `unmount` ya no se va a llamar nunca.
            if (token !== navToken) return false;
        }
        if (!next.mount) throw new Error(`la vista ${id} no tiene mount`);
        await next.mount(host);
        if (token !== navToken) return false;
    } catch (err) {
        if (token !== navToken) return false;
        console.error('[router] fallo al montar', id, err);
        render(host, html`
            <div class="state state--error" role="alert">
                <h2>${t('error.viewTitle')}</h2>
                <p>${t('error.viewBody')}</p>
                <button type="button" class="btn btn--primary" data-action="reload">${t('action.reload')}</button>
            </div>
        `);
    }
    if (token !== navToken) return false;
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
            if (target.hasAttribute('data-nav-more')) {
                navExpanded = !navExpanded;
                renderNav();
                // El foco vive en el botón que se acaba de repintar: hay que
                // devolvérselo o el teclado se queda sin ancla.
                /** @type {HTMLElement | null} */
                (navContainer?.querySelector('[data-nav-more]'))?.focus();
                return;
            }
            const id = target.getAttribute('data-view');
            if (id) navigate(id);
        });
        // Escape repliega la hoja, como cualquier otra capa de la aplicación.
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && navExpanded) {
                navExpanded = false;
                renderNav();
                /** @type {HTMLElement | null} */
                (navContainer?.querySelector('[data-nav-more]'))?.focus();
            }
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
    navExpanded = false;
    // Invalida las navegaciones en vuelo: al cambiar de perfil, una vista que
    // aún estuviera cargando no puede montarse sobre el perfil nuevo.
    navToken += 1;
    views.clear();
    if (viewContainer) viewContainer.replaceChildren();
    if (navContainer) navContainer.replaceChildren();
}

/** Vuelve a pintar la navegación (tras cambiar de idioma). */
export function refreshNav() {
    renderNav();
}


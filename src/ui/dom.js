// @ts-check

/**
 * Utilidades de render seguro y delegación de eventos.
 *
 * Regla del proyecto (CLAUDE.md §5, F6): ningún dato dinámico entra al DOM
 * sin pasar por `escapeHtml`/`html``. `raw()` es la única vía de escape y
 * exige HTML de confianza construido por nosotros, nunca datos del usuario.
 */

const ESCAPE_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
};

/**
 * Escapa un valor para interpolarlo en HTML como texto plano.
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (ch) => ESCAPE_MAP[/** @type {keyof ESCAPE_MAP} */ (ch)]);
}

/** Marcador de HTML ya confiable (salida de `html`` ` o de `raw()`). */
export class RawHtml {
    /** @param {string} htmlText */
    constructor(htmlText) {
        /** @type {string} */
        this.html = htmlText;
    }
    toString() {
        return this.html;
    }
}

/**
 * Marca una cadena como HTML confiable que NO debe escaparse.
 * Uso restringido a HTML estático propio; jamás con datos de usuario o de storage.
 * @param {string} htmlText
 * @returns {RawHtml}
 */
export function raw(htmlText) {
    return new RawHtml(String(htmlText));
}

/**
 * Convierte un valor interpolado a HTML seguro.
 * @param {unknown} value
 * @returns {string}
 */
function toSafeHtml(value) {
    if (value instanceof RawHtml) return value.html;
    if (Array.isArray(value)) return value.map(toSafeHtml).join('');
    if (value === null || value === undefined) return '';
    return escapeHtml(value);
}

/**
 * Tagged template que escapa TODA interpolación por defecto.
 * Los fragmentos anidados de `html`` ` y `raw()` se insertan tal cual;
 * los arrays se concatenan elemento a elemento (cada uno escapado).
 *
 *   const card = html`<p>${userName}</p>`;          // userName escapado
 *   const list = html`<ul>${items.map(i => html`<li>${i}</li>`)}</ul>`;
 *
 * @param {TemplateStringsArray} strings
 * @param {...unknown} values
 * @returns {RawHtml}
 */
export function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) {
        out += toSafeHtml(values[i]) + strings[i + 1];
    }
    return new RawHtml(out);
}

/**
 * Vuelca una plantilla en un elemento. Si recibe una cadena suelta
 * (no marcada como confiable), la escapa: no hay camino sin escapado.
 * @param {Element} element
 * @param {RawHtml | string} template
 */
export function render(element, template) {
    element.innerHTML = template instanceof RawHtml ? template.html : escapeHtml(template);
}

/**
 * Delegación de eventos: un solo listener en `root` que atiende a los
 * descendientes que casan con `selector` (vivo: sirve para nodos re-renderizados).
 * @param {Element | Document} root
 * @param {string} eventName
 * @param {string} selector
 * @param {(event: Event, target: Element) => void} handler
 * @returns {() => void} función de desuscripción
 */
export function on(root, eventName, selector, handler) {
    /** @param {Event} event */
    const listener = (event) => {
        const origin = event.target;
        if (!(origin instanceof Element)) return;
        const target = origin.closest(selector);
        if (target && root.contains(target)) handler(event, target);
    };
    root.addEventListener(eventName, listener);
    return () => root.removeEventListener(eventName, listener);
}

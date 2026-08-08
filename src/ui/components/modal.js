// @ts-check

/**
 * Modal accesible reutilizable (CLAUDE.md F7): focus-trap, cierre con Escape
 * y devolución del foco al elemento que lo abrió.
 *
 * El legacy tenía cuatro overlays y ninguno cumplía nada de esto (fichas
 * FRO-*). Aquí es un único componente: si está bien una vez, está bien
 * en toda la aplicación.
 */

import { html, render, raw } from '../dom.js';
import { t } from '../../i18n/i18n.js';

/** Selector de lo que puede recibir foco dentro del modal. */
const FOCUSABLE = [
    'a[href]', 'button:not([disabled])', 'input:not([disabled])',
    'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])'
].join(',');

/** @type {{ overlay: HTMLElement, opener: Element | null, onClose: (() => void) | null } | null} */
let openModal = null;

let idCounter = 0;

/**
 * @param {HTMLElement} root
 * @returns {HTMLElement[]}
 */
function focusableWithin(root) {
    return /** @type {HTMLElement[]} */ ([...root.querySelectorAll(FOCUSABLE)])
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
}

/** @param {KeyboardEvent} event */
function handleKeydown(event) {
    if (!openModal) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
    }
    if (event.key !== 'Tab') return;

    const items = focusableWithin(openModal.overlay);
    if (items.length === 0) {
        event.preventDefault();
        return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    // trampa de foco: el tabulador no puede salir del diálogo
    if (event.shiftKey && (active === first || !openModal.overlay.contains(active))) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
    }
}

/**
 * Abre un modal. Devuelve el elemento del diálogo para que el llamante
 * cablee sus propios eventos dentro.
 * @param {{ titleKey: string, body: import('../dom.js').RawHtml | string, onClose?: () => void, size?: 'sm' | 'md' | 'lg' }} options
 * @returns {HTMLElement} el elemento .modal
 */
export function open(options) {
    close(); // nunca dos modales a la vez

    const opener = document.activeElement;
    const id = `modal-${++idCounter}`;
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.setAttribute('role', 'presentation');

    render(overlay, html`
        <div class="modal modal--${options.size ?? 'md'}" role="dialog" aria-modal="true" aria-labelledby="${id}-title">
            <div class="modal__header">
                <h2 class="modal__title" id="${id}-title">${t(options.titleKey)}</h2>
                <button type="button" class="modal__close" data-modal-close aria-label="${t('action.close')}">
                    <span aria-hidden="true">✕</span>
                </button>
            </div>
            <div class="modal__body">${typeof options.body === 'string' ? options.body : raw(String(options.body))}</div>
        </div>
    `);

    document.body.appendChild(overlay);
    document.body.classList.add('has-modal');
    openModal = { overlay, opener, onClose: options.onClose ?? null };

    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
        const target = /** @type {Element} */ (event.target);
        if (target instanceof Element && target.closest('[data-modal-close]')) close();
    });
    document.addEventListener('keydown', handleKeydown, true);

    // el foco entra en el diálogo, no se queda detrás
    const dialog = /** @type {HTMLElement} */ (overlay.querySelector('.modal'));
    const firstFocusable = focusableWithin(dialog)[0];
    (firstFocusable ?? dialog).focus();

    return dialog;
}

/** Cierra el modal abierto y devuelve el foco a quien lo abrió. */
export function close() {
    if (!openModal) return;
    const { overlay, opener, onClose } = openModal;
    openModal = null;

    document.removeEventListener('keydown', handleKeydown, true);
    overlay.remove();
    document.body.classList.remove('has-modal');

    if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    if (onClose) onClose();
}

/**
 * Diálogo de confirmación. `confirmText` obliga a teclear un texto exacto
 * para habilitar el botón: es el patrón de las acciones destructivas (C4).
 * @param {{ titleKey: string, messageKey: string, params?: Record<string, string|number>, confirmKey: string, danger?: boolean, confirmText?: string, onConfirm: () => void }} options
 */
export function confirm(options) {
    const needsTyping = typeof options.confirmText === 'string' && options.confirmText !== '';
    const dialog = open({
        titleKey: options.titleKey,
        size: 'sm',
        body: html`
            <p>${t(options.messageKey, options.params)}</p>
            ${needsTyping ? html`
                <label class="field">
                    <span class="field__label">${t('confirm.typeToConfirm', { text: String(options.confirmText) })}</span>
                    <input type="text" class="input" data-confirm-input autocomplete="off">
                </label>
            ` : ''}
            <div class="modal__actions">
                <button type="button" class="btn" data-modal-close>${t('action.cancel')}</button>
                <button type="button" class="btn ${options.danger ? 'btn--danger' : 'btn--primary'}" data-confirm-go ${needsTyping ? 'disabled' : ''}>
                    ${t(options.confirmKey)}
                </button>
            </div>
        `
    });

    const goButton = /** @type {HTMLButtonElement | null} */ (dialog.querySelector('[data-confirm-go]'));
    const input = /** @type {HTMLInputElement | null} */ (dialog.querySelector('[data-confirm-input]'));

    if (needsTyping && input && goButton) {
        goButton.disabled = true;
        input.addEventListener('input', () => {
            goButton.disabled = input.value !== options.confirmText;
        });
    }
    goButton?.addEventListener('click', () => {
        close();
        options.onConfirm();
    });
}

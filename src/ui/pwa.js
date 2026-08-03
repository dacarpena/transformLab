// @ts-check

/**
 * Registro del service worker y aviso de versión nueva (M6-1).
 *
 * La regla que manda: **nunca se recarga sin permiso**. Cuando hay una
 * versión nueva esperando, se avisa y se ofrece recargar; si el usuario está
 * a mitad de un check-in, esa decisión es suya. Recargar por sorpresa es
 * perder el trabajo de otro.
 *
 * Degrada en silencio: sin `serviceWorker` (Safari en privado, `file://`,
 * http sin localhost) la aplicación funciona igual, solo que sin offline.
 */

import * as toast from './components/toast.js';

/** Evita registrar dos veces si `boot()` se repite. */
let registered = false;

/**
 * Avisa de que hay una versión nueva lista y deja recargar al usuario.
 * @param {ServiceWorker} waiting
 */
function announceUpdate(waiting) {
    toast.show('pwa.updateReady', {
        type: 'info',
        duration: 0,
        action: {
            labelKey: 'pwa.reload',
            onClick: () => {
                // El SW que espera toma el control y, cuando lo hace,
                // recargamos: en ese orden, para no servir media versión.
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    globalThis.location?.reload();
                }, { once: true });
                waiting.postMessage({ type: 'SKIP_WAITING' });
            }
        }
    });
}

/** @param {ServiceWorkerRegistration} registration */
function watchForUpdate(registration) {
    if (registration.waiting && navigator.serviceWorker.controller) {
        announceUpdate(registration.waiting);
    }
    registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
            // `controller` distingue una actualización de la primera
            // instalación: en la primera no hay nada que avisar.
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                announceUpdate(installing);
            }
        });
    });
}

/**
 * Registra el service worker. Se llama al final del arranque, nunca antes:
 * si algo falla aquí, la aplicación ya está en pie.
 * @returns {Promise<void>}
 */
export async function register() {
    if (registered) return;
    if (!('serviceWorker' in navigator)) return;
    // Un SW solo se registra en origen seguro; en `file://` ni se intenta.
    if (!globalThis.isSecureContext) return;
    registered = true;

    try {
        const registration = await navigator.serviceWorker.register('sw.js', { scope: './' });
        watchForUpdate(registration);
    } catch (err) {
        // Sin offline se vive; sin aplicación no. No se molesta al usuario
        // con esto: no hay nada que pueda hacer al respecto.
        console.warn('[pwa] service worker no registrado', err);
        registered = false;
    }
}

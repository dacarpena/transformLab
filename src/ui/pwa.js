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

/** Para no apilar avisos si el evento llega más de una vez. */
let announced = false;

/** Esta pestaña pidió la actualización: su recarga ya está en marcha. */
let skipWaitingSent = false;

/**
 * Avisa de que hay una versión nueva lista y deja recargar al usuario.
 *
 * `waiting` es el service worker que espera, si esta pestaña es la que ha
 * detectado la actualización. Cuando el cambio lo aplicó OTRA pestaña, no hay
 * nada que esperar: el SW nuevo ya manda, y aquí solo queda recargar.
 * @param {ServiceWorker | null} waiting
 */
function announceUpdate(waiting) {
    if (announced) return;
    announced = true;
    toast.show('pwa.updateReady', {
        type: 'info',
        duration: 0,
        action: {
            labelKey: 'pwa.reload',
            onClick: () => {
                if (!waiting) {
                    // La actualización ya está activa (la aplicó otra pestaña):
                    // mandar SKIP_WAITING aquí no haría nada y el aviso
                    // desaparecería dejando al usuario en la versión vieja.
                    globalThis.location?.reload();
                    return;
                }
                // El SW que espera toma el control y, cuando lo hace,
                // recargamos: en ese orden, para no servir media versión.
                skipWaitingSent = true;
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

        // Si la actualización la aplica OTRA pestaña, esta se queda ejecutando
        // los módulos de la versión vieja contra la caché de la nueva, y sus
        // `import()` diferidos ya traen código nuevo: dos versiones a la vez en
        // la misma página. No se recarga sola —eso sigue prohibido—, pero sí
        // se avisa, y aquí el botón simplemente recarga.
        //
        // `hadController` distingue eso de la PRIMERA instalación: al activarse,
        // el service worker llama a `clients.claim()` y eso también dispara
        // `controllerchange`. Sin esta condición, todo el mundo veía un aviso de
        // «versión nueva» la primera vez que abría la aplicación.
        const hadController = Boolean(navigator.serviceWorker.controller);
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (skipWaitingSent) return;   // esta pestaña ya está recargando
            if (!hadController) return;    // primera instalación, no hay nada nuevo
            announceUpdate(null);
        });
    } catch (err) {
        // Sin offline se vive; sin aplicación no. No se molesta al usuario
        // con esto: no hay nada que pueda hacer al respecto.
        console.warn('[pwa] service worker no registrado', err);
        registered = false;
    }
}

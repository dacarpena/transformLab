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
 *
 * Y **en desarrollo no se registra** (E15-0). `sw.js` es cache-first sin
 * revalidar, así que en `npm run serve` servía módulos fósiles: editabas un
 * fichero, recargabas, y el navegador seguía ejecutando el de antes hasta que
 * alguien se acordaba de `npm run sw:bump`. Eso no es una molestia, es la
 * pérdida de la capacidad de verificar nada. La excepción es el origen que
 * reproduce producción, donde el modo sin conexión SÍ tiene que probarse.
 */

import * as toast from './components/toast.js';

/**
 * Puerto del servidor que reproduce producción (`tools/serve-csp.mjs`, que
 * sirve las cabeceras reales de `_headers`). Es el ÚNICO origen local donde el
 * service worker debe registrarse: ahí corre `test/e2e/pwa.spec.js`, que
 * comprueba el precache completo y el modo avión.
 *
 * Está atado a `playwright.config.js` por `test/pwa.test.js`: si uno de los dos
 * cambia el número y el otro no, el test se cae. Es el mismo candado que
 * `sw.lock.json` pone sobre `CACHE_VERSION`.
 */
export const PROD_PARITY_PORT = '8081';

/**
 * Hosts de bucle local. El navegador los considera contexto seguro sin TLS, así
 * que `isSecureContext` no los distingue de producción: hay que mirarlos.
 * @param {string} hostname
 * @returns {boolean}
 */
function isLoopback(hostname) {
    return hostname === 'localhost'
        || hostname.endsWith('.localhost')
        || hostname === '127.0.0.1'
        || hostname === '[::1]'
        || hostname === '::1';
}

/**
 * Qué hacer con el service worker en este origen. Pura a propósito: es la
 * decisión entera del módulo y se prueba como una tabla de verdad, sin
 * navegador.
 *
 * - `skip`     el origen no admite service worker; no hay nada que hacer.
 * - `register` producción, y el servidor local que la reproduce.
 * - `cleanup`  desarrollo: además de no registrar, hay que DESINSTALAR el que
 *              ya estuviera puesto. Sin esto, quien abrió el 8080 alguna vez
 *              arrastra su caché para siempre, que es justo el fallo a cerrar.
 *
 * @param {{ hostname: string, port: string, isSecureContext: boolean }} origin
 * @returns {'register' | 'skip' | 'cleanup'}
 */
export function swPolicy(origin) {
    if (!origin.isSecureContext) return 'skip';
    if (!isLoopback(origin.hostname)) return 'register';
    return origin.port === PROD_PARITY_PORT ? 'register' : 'cleanup';
}

/**
 * Desinstala el service worker de este origen y tira sus cachés.
 *
 * Solo avisa si de verdad había algo que quitar: un mensaje en cada recarga de
 * cada sesión de desarrollo es ruido, y el ruido se deja de leer.
 * @returns {Promise<void>}
 */
async function cleanup() {
    try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));

        const stale = (await caches.keys()).filter((name) => name.startsWith('tl-'));
        await Promise.all(stale.map((name) => caches.delete(name)));

        if (registrations.length > 0 || stale.length > 0) {
            console.info('[pwa] service worker de desarrollo desinstalado; recarga para servir de red');
        }
    } catch (err) {
        // Que la limpieza falle no puede tumbar el arranque: como mucho se
        // sigue viendo código viejo, que es exactamente el estado de antes.
        console.warn('[pwa] no se pudo limpiar el service worker de desarrollo', err);
    }
}

/** Evita registrar dos veces si `boot()` se repite. */
let registered = false;

/**
 * Resuelve cuando la página ha terminado de cargar y el hilo principal está
 * ocioso. `requestIdleCallback` no existe en Safari, así que hay respaldo.
 * @returns {Promise<void>}
 */
function pageIsIdle() {
    return new Promise((resolve) => {
        const idle = () => {
            const ric = /** @type {*} */ (globalThis).requestIdleCallback;
            if (typeof ric === 'function') ric(() => resolve(), { timeout: 3000 });
            else setTimeout(resolve, 1000);
        };
        if (document.readyState === 'complete') idle();
        else globalThis.addEventListener('load', idle, { once: true });
    });
}

/** Para no apilar avisos si el evento llega más de una vez. */
let announced = false;

/** Esta pestaña pidió la actualización: su recarga ya está en marcha. */
let skipWaitingSent = false;

/** La última instalación se descartó: el precache no se completó. */
let installFailed = false;

/** La registración viva, para poder buscar actualización a la orden. */
/** @type {ServiceWorkerRegistration | null} */
let current = null;

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

/**
 * Vigila una instalación en curso y avisa cuando quede lista —o cuando falle.
 *
 * @param {ServiceWorker} worker
 */
function watchInstalling(worker) {
    const mirar = () => {
        // `controller` distingue una actualización de la primera instalación: en
        // la primera no hay nada que avisar.
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            announceUpdate(worker);
            return;
        }
        // `redundant` sin haber pasado por `installed` es un precache que ha
        // fallado: `addAll` es todo-o-nada y basta una petición mala para
        // descartar la actualización ENTERA. Antes eso era un `console.error`
        // dentro del service worker, o sea invisible, y quien lo sufría se
        // quedaba en la versión vieja sin enterarse y sin nada que reintentar.
        if (worker.state === 'redundant' && navigator.serviceWorker.controller) {
            installFailed = true;
        }
    };
    mirar();
    worker.addEventListener('statechange', mirar);
}

/** @param {ServiceWorkerRegistration} registration */
function watchForUpdate(registration) {
    if (registration.waiting && navigator.serviceWorker.controller) {
        announceUpdate(registration.waiting);
    }
    // TAMBIÉN el que ya está instalándose, y no solo el que espera. Entre que
    // `register()` resuelve y esta línea corre, el navegador puede haber
    // disparado ya `updatefound`: ese evento no se vuelve a emitir, así que sin
    // esto la actualización se instalaba y NADIE avisaba. Es una carrera
    // estrecha y explica exactamente el síntoma de quedarse en la versión vieja.
    if (registration.installing) watchInstalling(registration.installing);

    registration.addEventListener('updatefound', () => {
        if (registration.installing) watchInstalling(registration.installing);
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

    const policy = swPolicy({
        hostname: globalThis.location?.hostname ?? '',
        port: globalThis.location?.port ?? '',
        isSecureContext: Boolean(globalThis.isSecureContext)
    });
    // `registered` se marca en los tres caminos: significa «ya se decidió y se
    // actuó», no «hay un service worker». Sin esto, un `boot()` repetido
    // volvería a barrer cachés en desarrollo en cada arranque.
    if (policy !== 'register') {
        registered = true;
        if (policy === 'cleanup') await cleanup();
        return;
    }
    registered = true;

    // Se espera a que la página esté quieta. Instalar el service worker
    // descarga y guarda TODO el precache de golpe, y medido contra el despliegue
    // real eso bloqueaba el hilo principal 3,4 s en la primera visita desde un
    // móvil: la aplicación ya se veía, pero no respondía al dedo. El offline
    // es para la segunda visita; no hay ninguna prisa por tenerlo en la
    // primera.
    await pageIsIdle();

    try {
        // `updateViaCache: 'none'` NO es un detalle: es lo que hace que la app
        // se pueda actualizar. Medido en producción, la zona de Cloudflare
        // reescribe `Cache-Control` a `max-age=14400` para `.js` —incluido este
        // `sw.js`, que tiene su propia regla `no-cache` en `_headers` y aun así
        // llega con cuatro horas de caché—. Sin esta opción, el navegador
        // comprueba si hay service worker nuevo LEYENDO EL VIEJO de su caché
        // HTTP, así que durante cuatro horas no hay actualización posible: ni
        // del service worker, ni por tanto de nada de lo que él precachea.
        //
        // Con `none`, la comprobación se salta la caché HTTP. Y como el propio
        // `sw.js` precachea con `{ cache: 'reload' }`, los módulos que instala
        // también son frescos. El resultado es que la aplicación se actualiza
        // bien aunque el ajuste de la zona no cambie nunca.
        const registration = await navigator.serviceWorker.register('sw.js', {
            scope: './',
            updateViaCache: 'none'
        });
        current = registration;
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

/* ── Saber en qué versión estás, y poder cambiarla ───────────────────────── */

/**
 * La versión que este dispositivo está EJECUTANDO.
 *
 * Sale del nombre de la caché, que es la fuente real: de ahí salen los módulos
 * que la página está corriendo ahora mismo, no de lo que diga el servidor.
 *
 * Existe porque hasta ahora **no había forma de saberlo**. Cuando alguien dice
 * «sigo viendo la versión vieja» no hay nada que mirar: ni él puede comprobarlo
 * ni yo puedo pedírselo, y el diagnóstico se convierte en adivinar.
 *
 * @returns {Promise<string | null>}
 */
export async function runningVersion() {
    if (typeof caches === 'undefined') return null;
    try {
        return (await caches.keys()).find((k) => k.startsWith('tl-')) ?? null;
    } catch {
        return null;
    }
}

/**
 * La versión PUBLICADA, leída del `sw.js` del servidor.
 *
 * Con `cache: 'reload'`, porque preguntarle a la caché del navegador qué hay
 * publicado es preguntarle justo al problema.
 *
 * @returns {Promise<string | null>}
 */
export async function publishedVersion() {
    try {
        const r = await fetch('sw.js', { cache: 'reload' });
        if (!r.ok) return null;
        return (await r.text()).match(/tl-[0-9a-f]{12}/)?.[0] ?? null;
    } catch {
        return null;
    }
}

/** @typedef {'unsupported' | 'uptodate' | 'ready' | 'installing' | 'failed'} UpdateState */

/**
 * Busca actualización AHORA, porque alguien lo ha pedido.
 *
 * El navegador ya comprueba por su cuenta, pero a su ritmo y sin decir nada. Un
 * botón que devuelve una respuesta —«al día», «instalando», «no se pudo»— es la
 * diferencia entre poder arreglar el problema y tener que esperar a ver.
 *
 * @returns {Promise<{ state: UpdateState, running: string | null, published: string | null }>}
 */
export async function checkForUpdate() {
    const running = await runningVersion();
    const published = await publishedVersion();

    if (!('serviceWorker' in navigator)) return { state: 'unsupported', running, published };
    const registration = current ?? (await navigator.serviceWorker.getRegistration()) ?? null;
    if (!registration) return { state: 'unsupported', running, published };

    installFailed = false;
    try {
        await registration.update();
    } catch {
        return { state: 'failed', running, published };
    }

    if (registration.waiting) {
        announceUpdate(registration.waiting);
        return { state: 'ready', running, published };
    }
    if (registration.installing) {
        watchInstalling(registration.installing);
        return { state: 'installing', running, published };
    }
    if (installFailed) return { state: 'failed', running, published };

    // Sin nada instalándose ni esperando: o está al día, o la instalación se
    // descartó y el navegador no lo cuenta. Comparar con lo publicado es lo
    // único que distingue las dos cosas, y la diferencia importa: una es «no
    // hagas nada» y la otra es «esto no se está pudiendo actualizar».
    if (running !== null && published !== null && running !== published) {
        return { state: 'failed', running, published };
    }
    return { state: 'uptodate', running, published };
}

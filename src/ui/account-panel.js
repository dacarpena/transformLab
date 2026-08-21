// @ts-check

/**
 * El panel de Cuenta, dentro de Ajustes (M8-5d).
 *
 * ## Cinco estados, y ninguno es un callejón
 *
 * ```
 *   sinSoporte    el navegador no puede con passkeys → se explica, sin botón
 *   sinCuenta     la aplicación funciona igual; la cuenta es una opción
 *   sinProteger   HAY sesión pero no hay vía de vuelta → NADA se sincroniza
 *   bloqueada     hay sesión pero la clave no está en este dispositivo
 *   lista         dispositivos, sesiones y salida
 * ```
 *
 * `sinProteger` es el estado que justifica el módulo. Con cifrado extremo a
 * extremo, subir datos antes de que haya vía de vuelta fabrica una pérdida
 * irreversible: el día que se rompa el único dispositivo, lo del servidor es
 * ruido para todo el mundo, nosotros incluidos. El aviso **no se puede
 * descartar** y dice exactamente qué está pasando —«no se está sincronizando
 * nada»— en vez de un genérico. La condición de verdad la impone el servidor
 * (`users.protected_at`); esto es la mitad que se ve.
 *
 * ## El kit se enseña UNA vez
 *
 * No se guarda en ninguna parte: existe para que haya un secreto que solo esté
 * fuera del sistema. Por eso el diálogo obliga a marcar «lo he guardado» antes
 * de dejarlo cerrar, y por eso avisa de que no se podrá volver a ver.
 *
 * ## Nadie sale a la red sin haberlo pedido
 *
 * El panel **no consulta al servidor** en un dispositivo que nunca ha tenido
 * cuenta. Sin esta regla, abrir Ajustes lanzaba un `GET /api/session` a todo el
 * mundo —incluido quien nunca va a crear cuenta— y en un despliegue sin API eso
 * es además un 404 en la consola. Lo cazó un E2E que ya existía: «todas las
 * vistas montan sin error de consola».
 *
 * La huella es una clave local (`ui.accountSeen`) que se pone al crear cuenta o
 * al entrar, y se quita al salir. Es una pista, no una autoridad: si miente, lo
 * único que pasa es una petición de más o una de menos, y el estado real lo
 * decide siempre el servidor.
 *
 * ## Ningún estado destructivo por defecto (H-013)
 *
 * Un fallo de red no ofrece «borrar la cuenta» ni deja la pantalla muda: cada
 * error tiene su texto y su reintento.
 */

import { html, render, on } from './dom.js';
import * as storage from '../data/storage.js';
import { t } from '../i18n/i18n.js';
import * as account from '../data/account.js';
import * as modal from './components/modal.js';
import * as toast from './components/toast.js';
import { longDate } from './dates.js';

/**
 * @typedef {{ estado: 'sinSoporte' | 'sinCuenta' | 'cargando' | 'error'
 *                    | 'sinProteger' | 'bloqueada' | 'lista',
 *             datos: * }} Vista
 */

/** @type {Vista} */
let vista = { estado: 'cargando', datos: null };

/** @type {HTMLElement | null} */
let raiz = null;

/** @type {(() => void) | null} */
let onChanged = null;

/**
 * La huella de «este dispositivo ha tenido cuenta alguna vez».
 *
 * Misma forma que `recalibrate.DECLINED_KEY`: una clave de interfaz en el
 * almacén del perfil, fuera de las colecciones del esquema.
 */
export const SEEN_KEY = 'ui.accountSeen';

/** ¿Merece la pena preguntarle al servidor? */
function haHabidoCuenta() {
    const r = storage.get(SEEN_KEY);
    return Boolean(r.ok && r.value);
}

/**
 * Avisa cuando el estado de la cuenta cambia, para que Ajustes se repinte
 * entera si le hace falta.
 * @param {() => void} fn
 */
export function setOnChanged(fn) {
    onChanged = fn;
}

/** El HTML del panel. Se llama desde `settings.js` al dibujar. */
export function renderSection() {
    return html`
        <section class="card" aria-labelledby="set-account" data-account-panel>
            <h2 id="set-account" class="card__title">${t('account.section')}</h2>
            <div data-account-body>${t('state.loading')}</div>
        </section>
    `;
}

/**
 * Cablea el panel. Se llama una vez desde el `mount` de Ajustes, sobre el
 * contenedor ESTABLE de la vista: `settings.js` repinta su cuerpo entero, así
 * que un oyente colgado del panel se perdería en el primer repintado.
 *
 * @param {HTMLElement} container
 */
export function mount(container) {
    raiz = container;

    on(container, 'click', '[data-account-create]', async () => {
        await conBoton('[data-account-create]', async () => {
            const r = await account.register();
            if (!r.ok) return toast.error(claveDeError(r.error));
            storage.set(SEEN_KEY, true);
            await refrescar();
            // El kit sale del propio alta —es el único momento en que la clave
            // está en crudo—, y se enseña acto seguido. Es lo que convierte la
            // regla dura en algo que se puede cumplir, en vez de en un aviso que
            // se ignora.
            mostrarKit(r.value.recoveryCode, {
                primeraVez: true,
                // La subida espera a que el usuario confirme que lo ha
                // guardado. Sin esa espera, cerrar el diálogo dejaría la cuenta
                // marcada como protegida cuando el código ya no existe en
                // ninguna parte: una mentira que solo se descubre el día que
                // hace falta recuperar.
                alConfirmar: r.value.commitRecoveryKit
            });
        });
    });

    on(container, 'click', '[data-account-login]', async () => {
        await conBoton('[data-account-login]', async () => {
            const r = await account.login();
            if (!r.ok) return toast.error(claveDeError(r.error));
            storage.set(SEEN_KEY, true);
            await refrescar();
            if (r.value.needsRecovery) abrirDesbloqueo(r.value.userId);
            else toast.success('account.loggedIn');
        });
    });

    on(container, 'click', '[data-account-kit]', () => {
        const userId = vista.datos?.userId;
        if (userId) abrirKit(userId);
    });

    on(container, 'click', '[data-account-unlock]', () => {
        const userId = vista.datos?.userId;
        if (userId) abrirDesbloqueo(userId);
    });

    on(container, 'click', '[data-account-logout]', async () => {
        const userId = vista.datos?.userId;
        if (!userId) return;
        await account.logout(userId);
        storage.remove(SEEN_KEY);
        await refrescar();
        toast.success('account.loggedOut');
    });

    on(container, 'click', '[data-account-logout-all]', () => {
        const userId = vista.datos?.userId;
        if (!userId) return;
        // Confirmación, porque cierra sesión también en el móvil de al lado y
        // desde aquí no se ve el efecto.
        modal.confirm({
            titleKey: 'account.logoutAll',
            messageKey: 'account.logoutAllConfirm',
            confirmKey: 'account.logoutAll',
            danger: true,
            onConfirm: async () => {
                await account.logoutEverywhere(userId);
                storage.remove(SEEN_KEY);
                await refrescar();
                toast.success('account.loggedOut');
            }
        });
    });

    on(container, 'click', '[data-account-remove-credential]', (_event, target) => {
        const id = /** @type {HTMLElement} */ (target).dataset.accountRemoveCredential;
        if (!id) return;
        modal.confirm({
            titleKey: 'account.device.remove',
            messageKey: 'account.device.removeConfirm',
            confirmKey: 'account.device.remove',
            danger: true,
            onConfirm: async () => {
                const r = await account.removeCredential(id);
                if (!r.ok) return toast.error(claveDeError(r.error));
                await refrescar();
                toast.success('account.device.removed');
            }
        });
    });

    on(container, 'click', '[data-account-retry]', () => { void refrescar(); });

    void refrescar();
}

/**
 * Repinta el panel con lo que ya se sabe, **sin volver a preguntar al servidor**.
 *
 * La llama `settings.js` después de cada `draw()`: ese `render` se lleva por
 * delante el cuerpo del panel, y sin esto un cambio de idioma dejaría un
 * «Cargando…» permanente. Preguntar otra vez sería una petición por cada cambio
 * de idioma.
 */
export function repaint() {
    pintar();
}

/** Vuelve a leer el estado del servidor y repinta solo este panel. */
export async function refrescar() {
    if (!account.isSupported()) {
        vista = { estado: 'sinSoporte', datos: null };
        return pintar();
    }

    if (!haHabidoCuenta()) {
        // Nunca ha habido cuenta aquí: no hay nada que preguntar, y preguntarlo
        // sería salir a la red sin que nadie lo haya pedido.
        vista = { estado: 'sinCuenta', datos: null };
        return pintar();
    }

    vista = { estado: 'cargando', datos: vista.datos };
    pintar();

    const sesion = await account.session();
    if (!sesion?.authenticated) {
        // La sesión caducó o se cerró desde otro sitio. Se borra la huella para
        // no volver a preguntar en cada apertura de Ajustes.
        storage.remove(SEEN_KEY);
        vista = { estado: 'sinCuenta', datos: null };
        return pintar();
    }

    const detalle = await account.overview();
    if (!detalle) {
        // Hay sesión pero el detalle no llegó: red intermitente. NO se degrada a
        // «sin cuenta», que llevaría al usuario a crear una segunda.
        vista = { estado: 'error', datos: { userId: sesion.userId } };
        return pintar();
    }

    vista = {
        estado: detalle.protected ? 'lista' : 'sinProteger',
        datos: detalle
    };
    pintar();
    onChanged?.();
}

/* ── Pintado ─────────────────────────────────────────────────────────────── */

function pintar() {
    const cuerpo = raiz?.querySelector('[data-account-body]');
    if (!(cuerpo instanceof HTMLElement)) return;
    render(cuerpo, cuerpoDe(vista));
}

/** @param {Vista} v */
function cuerpoDe(v) {
    if (v.estado === 'cargando') return html`<p class="secondary">${t('state.loading')}</p>`;

    if (v.estado === 'sinSoporte') {
        // Se explica y no se ofrece nada: un botón que no puede funcionar es
        // peor que ningún botón.
        return html`
            <p class="secondary">${t('account.intro')}</p>
            <p class="notice">${t('account.unsupported')}</p>
        `;
    }

    if (v.estado === 'error') {
        return html`
            <p class="notice notice--warning">${t('account.loadFailed')}</p>
            <div class="btn-row">
                <button type="button" class="btn" data-account-retry>${t('action.retry')}</button>
            </div>
        `;
    }

    if (v.estado === 'sinCuenta') {
        return html`
            <p class="secondary">${t('account.intro')}</p>
            <ul class="account-points">
                <li>${t('account.point.optional')}</li>
                <li>${t('account.point.e2e')}</li>
                <li>${t('account.point.noPassword')}</li>
            </ul>
            <div class="btn-row">
                <button type="button" class="btn btn--primary" data-account-create>${t('account.create')}</button>
                <button type="button" class="btn" data-account-login>${t('account.login')}</button>
            </div>
        `;
    }

    const dispositivos = v.datos?.credentials ?? [];

    if (v.estado === 'bloqueada') {
        return html`
            <p class="notice notice--warning">${t('account.locked')}</p>
            <div class="btn-row">
                <button type="button" class="btn btn--primary" data-account-unlock>${t('account.unlock')}</button>
                <button type="button" class="btn" data-account-logout>${t('account.logout')}</button>
            </div>
        `;
    }

    return html`
        ${v.estado === 'sinProteger' ? html`
            <p class="notice notice--warning" data-account-unprotected>
                <strong>${t('account.unprotected.title')}</strong><br>
                ${t('account.unprotected.body')}
            </p>
            <div class="btn-row">
                <button type="button" class="btn btn--primary" data-account-kit>${t('account.kit.get')}</button>
            </div>
        ` : html`
            <p class="notice notice--ok" data-account-protected>${t('account.protected')}</p>
        `}

        <h3 class="card__title">${t('account.devices')}</h3>
        <ul class="account-devices" data-account-devices>
            ${dispositivos.map((/** @type {*} */ c) => html`
                <li class="account-devices__item">
                    <span>
                        ${c.current ? t('account.device.current') : t('account.device.other')}
                        <span class="muted"> · ${longDate(new Date(c.createdAt).toISOString())}</span>
                    </span>
                    ${dispositivos.length > 1 ? html`
                        <button type="button" class="btn btn--sm"
                                data-account-remove-credential="${c.id}">${t('account.device.remove')}</button>
                    ` : ''}
                </li>
            `)}
        </ul>
        ${dispositivos.length === 1
            ? html`<p class="muted">${t('account.device.lastHint')}</p>`
            : ''}

        <div class="btn-row">
            <button type="button" class="btn" data-account-logout>${t('account.logout')}</button>
            <button type="button" class="btn" data-account-logout-all>${t('account.logoutAll')}</button>
        </div>
    `;
}

/* ── El kit ──────────────────────────────────────────────────────────────── */

/**
 * Pide un kit NUEVO para una cuenta que ya existe y lo enseña.
 *
 * Este camino necesita volver a tener la clave en crudo, y en un dispositivo que
 * ya la tiene guardada eso es imposible por diseño: la salida es el sobre del
 * PRF. Sin PRF no hay camino, y se dice con su texto propio —añadir una segunda
 * passkey— en vez de con un error genérico.
 *
 * @param {string} userId
 */
function abrirKit(userId) {
    const dialogo = abrirDialogoKit({ primeraVez: false });

    void (async () => {
        const r = await account.createRecoveryKitWithPasskey(userId);
        const slot = dialogo.querySelector('[data-kit-slot]');
        if (!(slot instanceof HTMLElement)) return;

        if (!r.ok) {
            render(slot, html`
                <p class="notice notice--warning">${t(claveDeError(r.error))}</p>
            `);
            return;
        }
        pintarCodigo(slot, r.value.code);
    })();
}

/**
 * Enseña un código ya generado. **No se puede volver a ver**: no se guarda en
 * ninguna parte, que es todo su propósito.
 *
 * @param {string} code
 * @param {{ primeraVez: boolean, alConfirmar?: () => Promise<{ ok: boolean, error?: string }> }} opciones
 */
function mostrarKit(code, { primeraVez, alConfirmar }) {
    const dialogo = abrirDialogoKit({ primeraVez });
    const slot = dialogo.querySelector('[data-kit-slot]');
    if (slot instanceof HTMLElement) pintarCodigo(slot, code, alConfirmar);
}

/** El diálogo, con su introducción y su aviso. */
function abrirDialogoKit(/** @type {{ primeraVez: boolean }} */ { primeraVez }) {
    return modal.open({
        titleKey: 'account.kit.title',
        size: 'md',
        body: html`
            <p>${t(primeraVez ? 'account.kit.introFirst' : 'account.kit.intro')}</p>
            <p class="notice notice--warning">${t('account.kit.warning')}</p>
            <div data-kit-slot><p class="secondary">${t('state.loading')}</p></div>
        `
    });
}

/**
 * Pinta el código y cablea copiar y confirmar.
 *
 * @param {HTMLElement} slot
 * @param {string} code
 * @param {(() => Promise<{ ok: boolean, error?: string }>) | undefined} [alConfirmar]
 *   Si viene, el sobre TODAVÍA NO se ha subido y se sube aquí.
 */
function pintarCodigo(slot, code, alConfirmar) {
    {
        const grupos = code.split('-');
        render(slot, html`
            <p class="kit-code" data-kit-code aria-label="${t('account.kit.aria')}">
                ${grupos.map((g) => html`<span class="kit-code__group">${g}</span>`)}
            </p>
            <div class="btn-row">
                <button type="button" class="btn" data-kit-copy>${t('account.kit.copy')}</button>
            </div>
            <label class="field--inline">
                <input type="checkbox" data-kit-saved>
                <span>${t('account.kit.confirm')}</span>
            </label>
            <div class="btn-row">
                <button type="button" class="btn btn--primary" data-kit-done disabled>${t('action.done')}</button>
            </div>
        `);

        const marca = /** @type {HTMLInputElement | null} */ (slot.querySelector('[data-kit-saved]'));
        const hecho = /** @type {HTMLButtonElement | null} */ (slot.querySelector('[data-kit-done]'));
        marca?.addEventListener('change', () => {
            if (hecho) hecho.disabled = !marca.checked;
        });
        slot.querySelector('[data-kit-copy]')?.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(code);
                toast.success('account.kit.copied');
            } catch {
                // Sin permiso de portapapeles —o sin contexto seguro— el código
                // sigue en pantalla para copiarlo a mano. No es un fallo del que
                // haya que alarmar.
                toast.show('account.kit.copyFailed');
            }
        });
        hecho?.addEventListener('click', async () => {
            if (alConfirmar) {
                hecho.disabled = true;
                const r = await alConfirmar();
                hecho.disabled = false;
                if (!r.ok) {
                    // No se cierra el diálogo: el código sigue en pantalla y se
                    // puede reintentar. Cerrarlo aquí perdería el único
                    // ejemplar que existe.
                    toast.error(claveDeError(r.error ?? 'api.unknown'));
                    return;
                }
            }
            modal.close();
            await refrescar();
            toast.success('account.kit.saved');
        });
    }
}

/* ── Desbloqueo ──────────────────────────────────────────────────────────── */

/**
 * Pide el kit para abrir la clave en un dispositivo nuevo.
 * @param {string} userId
 */
function abrirDesbloqueo(userId) {
    const dialogo = modal.open({
        titleKey: 'account.unlock',
        size: 'md',
        body: html`
            <p>${t('account.unlock.intro')}</p>
            <label class="field">
                <span class="field__label">${t('account.unlock.label')}</span>
                <input type="text" class="input" data-unlock-code autocomplete="off"
                       spellcheck="false" inputmode="text"
                       placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX">
            </label>
            <p class="notice" data-unlock-error hidden></p>
            <div class="btn-row">
                <button type="button" class="btn btn--primary" data-unlock-go>${t('account.unlock')}</button>
            </div>
        `
    });

    const entrada = /** @type {HTMLInputElement | null} */ (dialogo.querySelector('[data-unlock-code]'));
    const aviso = /** @type {HTMLElement | null} */ (dialogo.querySelector('[data-unlock-error]'));
    const boton = /** @type {HTMLButtonElement | null} */ (dialogo.querySelector('[data-unlock-go]'));

    const intentar = async () => {
        if (!entrada || !boton) return;
        boton.disabled = true;
        // La derivación tarda ~1 s a propósito (PBKDF2). Sin deshabilitar el
        // botón, el usuario pulsa tres veces y se lanzan tres derivaciones.
        const r = await account.unlockWithRecoveryKit(userId, entrada.value);
        boton.disabled = false;
        if (!r.ok) {
            if (aviso) {
                render(aviso, html`${t(claveDeError(r.error))}`);
                aviso.hidden = false;
            }
            entrada.focus();
            entrada.select();
            return;
        }
        modal.close();
        await refrescar();
        toast.success('account.unlocked');
    };

    boton?.addEventListener('click', () => { void intentar(); });
    entrada?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); void intentar(); }
    });
}

/* ── Utilidades ──────────────────────────────────────────────────────────── */

/**
 * Deshabilita un botón mientras la acción corre.
 *
 * Los flujos de passkey abren un diálogo del sistema y tardan segundos; sin esto
 * se pueden lanzar dos registros con dos pulsaciones, y el segundo deja una
 * cuenta huérfana.
 *
 * @param {string} selector
 * @param {() => Promise<void>} accion
 */
async function conBoton(selector, accion) {
    const boton = /** @type {HTMLButtonElement | null} */ (raiz?.querySelector(selector) ?? null);
    if (boton) boton.disabled = true;
    try {
        await accion();
    } finally {
        // El botón puede haber desaparecido en el repintado; se busca otra vez.
        const vivo = /** @type {HTMLButtonElement | null} */ (raiz?.querySelector(selector) ?? null);
        if (vivo) vivo.disabled = false;
    }
}

/**
 * Los códigos de error que esta pantalla sabe explicar.
 *
 * Es una lista EXPLÍCITA y no una consulta al diccionario: `t()` devuelve la
 * clave cuando falta, pero además avisa por consola, así que usarlo para
 * preguntar «¿existe esta clave?» llenaría la consola de ruido cada vez que el
 * servidor devuelve un código nuevo.
 *
 * Y hay un test que exige que cada código de aquí tenga su entrada en los DOS
 * diccionarios: un error sin texto es una pantalla muda en el peor momento.
 */
export const ERROR_KEYS = Object.freeze([
    'account.unsupported', 'account.cancelled', 'account.authenticatorFailed',
    'account.badRecoveryKit', 'account.noRecoveryKit', 'account.needsSecondPasskey',
    'account.locked',
    'api.offline', 'api.timeout', 'api.badResponse', 'api.badPath', 'api.unknown',
    'credential.last', 'credential.notFound', 'auth.required', 'auth.failed',
    'challenge.invalid', 'body.tooLarge', 'body.malformed',
    // La sincronía (M9-4). `sync.massDelete` no es un fallo: es la guarda que
    // se planta cuando un push iba a borrar más de lo que conserva, y su texto
    // tiene que decir exactamente eso o la persona no sabrá qué confirmar.
    'sync.locked', 'sync.writeFailed', 'sync.massDelete', 'sync.noProfiles',
    'sync.badResponse', 'sync.badBody', 'sync.badRow', 'sync.tooManyRows',
    'sync.noAccount', 'sync.badCursor'
]);

/**
 * Traduce un código de error a su clave de i18n.
 *
 * Lo que no esté previsto cae en un genérico, nunca en el código crudo: enseñar
 * `body.malformed` a una persona es un literal visible fuera de i18n y encima no
 * le dice nada.
 *
 * @param {string} codigo
 * @returns {string}
 */
function claveDeError(codigo) {
    return ERROR_KEYS.includes(codigo) ? `account.error.${codigo}` : 'account.error.generic';
}

// @ts-check

/**
 * La cuenta, desde el navegador (M8-5c).
 *
 * Orquesta las tres piezas que ya existen —`api.js` para la red, `crypto.js`
 * para el llavero y `keys-db.js` para recordar la clave— y añade lo único que
 * solo se puede hacer aquí: hablar con el autenticador.
 *
 * ## Todo esto es OPCIONAL
 *
 * La aplicación funciona entera sin cuenta, y eso no es una frase amable: es un
 * invariante con test. Cada función de aquí devuelve un `Result` y **ninguna
 * lanza**, porque un fallo de red, un autenticador que no está o un usuario que
 * cancela el diálogo del sistema son estados NORMALES, no excepciones.
 *
 * ## La regla dura, desde el lado del cliente
 *
 * Registrarse deja la cuenta **sin proteger**: no hay vía de vuelta hasta que el
 * usuario guarda el kit o da de alta una segunda passkey, y hasta entonces no se
 * sincroniza nada. `register()` lo devuelve explícitamente (`protected: false`)
 * para que la interfaz no pueda seguir como si nada. La condición de verdad la
 * impone el servidor; esto es la mitad que se ve.
 *
 * ## La sal del PRF es FIJA, y tiene que serlo
 *
 * Al iniciar sesión con credenciales descubribles no se sabe QUÉ passkey va a
 * elegir el usuario hasta que la ha elegido, así que no se puede consultar antes
 * una sal por credencial: haría falta un viaje de ida y vuelta en mitad del
 * diálogo del sistema. Una sal constante por aplicación resuelve eso, y no
 * debilita nada: la entropía del PRF la pone el autenticador, no la sal. La
 * columna `prf_salt` se guarda igualmente, para poder rotarla algún día sin
 * romper los sobres viejos.
 */

import { request } from './api.js';
import * as keys from './keys-db.js';
import {
    generateDataKey, importDataKey, wrapDataKey, unwrapDataKey,
    deriveDeviceKek, deriveRecoveryKek, generateRecoveryCode, RECOVERY_SALT_BYTES
} from './crypto.js';

/** La sal del PRF: constante de la aplicación. Ver la cabecera. */
const PRF_SALT = new TextEncoder().encode('tl.prf.v1.transformlab');

/** @typedef {{ ok: true, value: T }} Ok @template T */
/** @typedef {{ ok: false, error: string }} Err */

const err = (/** @type {string} */ error) => ({ ok: /** @type {false} */ (false), error });

/* ── Disponibilidad ──────────────────────────────────────────────────────── */

/**
 * ¿Puede este navegador tener cuenta?
 *
 * Se comprueba antes de enseñar la opción: ofrecer «crear cuenta» a alguien cuyo
 * navegador no puede es una promesa incumplida en el peor momento, cuando ya ha
 * decidido confiar.
 *
 * @returns {boolean}
 */
export function isSupported() {
    return typeof PublicKeyCredential === 'function' &&
        typeof navigator !== 'undefined' && !!navigator.credentials?.create;
}

/**
 * ¿Hay una passkey de esta aplicación en este dispositivo, lista para usar?
 *
 * Sirve para decidir si el botón dice «entrar» o «crear cuenta». Devuelve
 * `false` si el navegador no lo sabe, que es lo prudente: proponer «entrar» y
 * que no haya nada es peor que proponer «crear» y que ya exista.
 *
 * @returns {Promise<boolean>}
 */
export async function hasLocalPasskey() {
    try {
        // @ts-ignore — método reciente, no está en todas las definiciones de tipos
        if (typeof PublicKeyCredential?.isConditionalMediationAvailable !== 'function') return false;
        // @ts-ignore
        return await PublicKeyCredential.isConditionalMediationAvailable() === true;
    } catch {
        return false;
    }
}

/* ── Alta ────────────────────────────────────────────────────────────────── */

/**
 * Crea una cuenta: una passkey, una clave de datos y ni un dato personal.
 *
 * @returns {Promise<Ok<{ userId: string, protected: boolean, prf: boolean }> | Err>}
 */
export async function register() {
    if (!isSupported()) return err('account.unsupported');

    const inicio = await request('/api/auth/register/start', { method: 'POST' });
    if (!inicio.ok) return err(inicio.error);
    const opciones = inicio.value;

    /** @type {*} */ let credencial;
    try {
        credencial = await navigator.credentials.create({
            publicKey: {
                challenge: /** @type {BufferSource} */ (deB64u(opciones.challenge)),
                rp: opciones.rp,
                // El `user.id` lo decide el SERVIDOR y viaja como texto: WebAuthn
                // lo hornea dentro de la credencial y es lo que vuelve como
                // `userHandle` en el login descubrible.
                user: {
                    id: new TextEncoder().encode(opciones.user.id),
                    name: opciones.user.name,
                    displayName: opciones.user.displayName
                },
                pubKeyCredParams: opciones.pubKeyCredParams,
                authenticatorSelection: opciones.authenticatorSelection,
                attestation: opciones.attestation,
                timeout: opciones.timeout,
                extensions: { prf: { eval: { first: PRF_SALT } } }
            }
        });
    } catch (error) {
        // Cancelar el diálogo del sistema es lo más normal del mundo, y no es un
        // error que haya que enseñar como tal.
        return err(nombreDe(error) === 'NotAllowedError' ? 'account.cancelled' : 'account.authenticatorFailed');
    }
    if (!credencial) return err('account.cancelled');

    const fin = await request('/api/auth/register/finish', {
        method: 'POST',
        body: {
            id: credencial.id,
            clientDataJSON: b64u(credencial.response.clientDataJSON),
            authenticatorData: b64u(credencial.response.getAuthenticatorData()),
            publicKeySpki: b64u(credencial.response.getPublicKey()),
            algorithm: credencial.response.getPublicKeyAlgorithm()
        }
    });
    if (!fin.ok) return err(fin.error);

    // La clave de datos nace AQUÍ, en el dispositivo, y no sale nunca en claro.
    const extraible = await generateDataKey();
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', extraible));

    const prf = prfDe(credencial);
    let conPrf = false;
    if (prf) {
        const kek = await deriveDeviceKek(prf);
        const sobre = await wrapDataKey(kek, extraible);
        const guardado = await request('/api/account/keys', {
            method: 'POST',
            body: {
                device: {
                    credentialId: credencial.id,
                    wrapped: b64u(sobre),
                    prfSalt: b64u(PRF_SALT)
                }
            }
        });
        conPrf = guardado.ok;
    }

    await keys.put(fin.value.userId, await importDataKey(raw));
    raw.fill(0);

    // `protected: false` SIEMPRE en el alta: la interfaz tiene que llevar al
    // usuario al kit de recuperación antes de sincronizar nada.
    return { ok: true, value: { userId: fin.value.userId, protected: false, prf: conPrf } };
}

/* ── Entrada ─────────────────────────────────────────────────────────────── */

/**
 * Inicia sesión con una passkey.
 *
 * `needsRecovery` es la respuesta cuando la sesión se abrió pero la clave de
 * datos no está en este dispositivo y el autenticador no da PRF: hay cuenta,
 * pero todavía no se puede leer nada. Es un estado explícito y no un fallo,
 * porque tiene una salida clara —teclear el kit— y la interfaz debe ofrecerla.
 *
 * @returns {Promise<Ok<{ userId: string, protected: boolean, needsRecovery: boolean }> | Err>}
 */
export async function login() {
    if (!isSupported()) return err('account.unsupported');

    const inicio = await request('/api/auth/login/start', { method: 'POST' });
    if (!inicio.ok) return err(inicio.error);

    /** @type {*} */ let aserto;
    try {
        aserto = await navigator.credentials.get({
            publicKey: {
                challenge: /** @type {BufferSource} */ (deB64u(inicio.value.challenge)),
                rpId: inicio.value.rpId,
                // Vacío: es lo que hace descubrible al login. Con una lista,
                // habría que preguntar antes quién eres.
                allowCredentials: [],
                userVerification: inicio.value.userVerification,
                timeout: inicio.value.timeout,
                extensions: { prf: { eval: { first: PRF_SALT } } }
            }
        });
    } catch (error) {
        return err(nombreDe(error) === 'NotAllowedError' ? 'account.cancelled' : 'account.authenticatorFailed');
    }
    if (!aserto) return err('account.cancelled');

    const fin = await request('/api/auth/login/finish', {
        method: 'POST',
        body: {
            id: aserto.id,
            clientDataJSON: b64u(aserto.response.clientDataJSON),
            authenticatorData: b64u(aserto.response.authenticatorData),
            signature: b64u(aserto.response.signature)
        }
    });
    if (!fin.ok) return err(fin.error);

    const userId = fin.value.userId;
    // ¿Ya está la clave en este dispositivo? Es el caso normal, y no cuesta red.
    if (await keys.get(userId)) {
        return { ok: true, value: { userId, protected: fin.value.protected, needsRecovery: false } };
    }

    // Dispositivo nuevo. Con PRF se abre solo; sin él, hace falta el kit.
    const prf = prfDe(aserto);
    if (prf) {
        const material = await request('/api/account/keys');
        const sobre = material.ok
            ? material.value.devices?.find((/** @type {*} */ d) => d.credentialId === aserto.id)
            : null;
        if (sobre) {
            const dk = await unwrapDataKey(await deriveDeviceKek(prf), /** @type {*} */ (deB64u(sobre.wrapped)));
            if (dk) {
                await keys.put(userId, dk);
                return { ok: true, value: { userId, protected: fin.value.protected, needsRecovery: false } };
            }
        }
    }

    return { ok: true, value: { userId, protected: fin.value.protected, needsRecovery: true } };
}

/**
 * Abre la clave de datos con el kit de recuperación.
 *
 * @param {string} userId
 * @param {string} code tal y como lo teclea el usuario
 * @returns {Promise<Ok<{ unlocked: true }> | Err>}
 */
export async function unlockWithRecoveryKit(userId, code) {
    const material = await request('/api/account/keys');
    if (!material.ok) return err(material.error);
    const recovery = material.value.recovery;
    if (!recovery) return err('account.noRecoveryKit');

    const kek = await deriveRecoveryKek(code, /** @type {*} */ (deB64u(recovery.salt)));
    // Código mal tecleado y código de otra cuenta dan lo mismo, y está bien:
    // desde fuera son indistinguibles, y la salida es la misma —volver a mirar
    // el papel—.
    if (!kek) return err('account.badRecoveryKit');

    const dk = await unwrapDataKey(kek, /** @type {*} */ (deB64u(recovery.wrapped)));
    if (!dk) return err('account.badRecoveryKit');

    await keys.put(userId, dk);
    return { ok: true, value: { unlocked: true } };
}

/* ── El kit ──────────────────────────────────────────────────────────────── */

/**
 * Genera el kit de recuperación y lo sube envuelto.
 *
 * **Devuelve el código una sola vez.** No se guarda en ninguna parte —ni aquí,
 * ni en el servidor, ni en `localStorage`—, porque guardarlo anularía su
 * propósito: existe para que haya un secreto que solo esté FUERA del sistema.
 * La interfaz tiene que enseñarlo y confirmar que el usuario lo ha guardado.
 *
 * Recibe la clave EN CRUDO porque envolver exige extraerla, y la que vive en el
 * dispositivo no es extraíble a propósito. Los dos caminos que la tienen son el
 * alta —donde acaba de generarse— y `createRecoveryKitWithPasskey`, que la saca
 * del sobre del PRF para este único uso.
 *
 * @param {{ userId: string, rawKey: Uint8Array }} entrada
 * @returns {Promise<Ok<{ code: string }> | Err>}
 */
export async function saveRecoveryKit({ userId, rawKey }) {
    const { code } = await generateRecoveryCode();
    const salt = crypto.getRandomValues(new Uint8Array(RECOVERY_SALT_BYTES));
    const kek = await deriveRecoveryKek(code, salt);
    if (!kek) return err('account.badRecoveryKit');

    // Se importa como EXTRAÍBLE solo para envolverla, y el handle se suelta al
    // salir de esta función.
    const extraible = await crypto.subtle.importKey(
        'raw', /** @type {ArrayBuffer} */ (rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength)),
        { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    const sobre = await wrapDataKey(kek, extraible);

    const guardado = await request('/api/account/keys', {
        method: 'POST',
        body: { recovery: { wrapped: b64u(sobre), salt: b64u(salt) } }
    });
    if (!guardado.ok) return err(guardado.error);

    return { ok: true, value: { code } };
}

/**
 * Genera un kit **más tarde**: cuando el usuario se saltó el paso en el alta, o
 * quiere sustituir uno perdido.
 *
 * Hace falta volver a tener la clave en crudo, y en un dispositivo que ya la
 * tiene guardada eso es imposible por diseño —vive no extraíble—. La salida es
 * el sobre del PRF: se le pide al autenticador que vuelva a derivar su clave, se
 * abre el sobre PIDIENDO una copia extraíble, y se usa para envolver el kit
 * nuevo. Esa copia no se guarda: se usa y se suelta.
 *
 * Sin PRF no hay camino, y se dice con un error propio en vez de fallar
 * genéricamente: la salida para ese usuario es dar de alta una segunda passkey,
 * que también protege la cuenta y no necesita la clave.
 *
 * @param {string} userId
 * @returns {Promise<Ok<{ code: string }> | Err>}
 */
export async function createRecoveryKitWithPasskey(userId) {
    if (!isSupported()) return err('account.unsupported');

    const material = await request('/api/account/keys');
    if (!material.ok) return err(material.error);
    const sobres = material.value.devices ?? [];
    if (sobres.length === 0) return err('account.needsSecondPasskey');

    const inicio = await request('/api/auth/login/start', { method: 'POST' });
    if (!inicio.ok) return err(inicio.error);

    /** @type {*} */ let aserto;
    try {
        aserto = await navigator.credentials.get({
            publicKey: {
                challenge: /** @type {BufferSource} */ (deB64u(inicio.value.challenge)),
                rpId: inicio.value.rpId,
                allowCredentials: [],
                userVerification: inicio.value.userVerification,
                extensions: { prf: { eval: { first: PRF_SALT } } }
            }
        });
    } catch (error) {
        return err(nombreDe(error) === 'NotAllowedError' ? 'account.cancelled' : 'account.authenticatorFailed');
    }
    const prf = aserto && prfDe(aserto);
    if (!prf) return err('account.needsSecondPasskey');

    const sobre = sobres.find((/** @type {*} */ d) => d.credentialId === aserto.id);
    if (!sobre) return err('account.needsSecondPasskey');

    // Copia EXTRAÍBLE, para este único uso. Ver `unwrapDataKey`.
    const dk = await unwrapDataKey(await deriveDeviceKek(prf),
        /** @type {*} */ (deB64u(sobre.wrapped)), { extractable: true });
    if (!dk) return err('account.badRecoveryKit');

    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dk));
    const r = await saveRecoveryKit({ userId, rawKey: raw });
    raw.fill(0);
    return r;
}

/* ── Estado y salida ─────────────────────────────────────────────────────── */

/** El estado de la sesión, o `null` si no hay ninguna. */
export async function session() {
    const r = await request('/api/session');
    return r.ok ? r.value : null;
}

/** Dispositivos, sesiones y estado de protección. */
export async function overview() {
    const r = await request('/api/account');
    return r.ok ? r.value : null;
}

/**
 * Cierra la sesión y **olvida la clave de este dispositivo**.
 *
 * Las dos cosas, y el orden importa poco pero el conjunto no: dejar la clave
 * aquí después de salir es dejar la puerta abierta al siguiente que use el
 * dispositivo, y cerrar sesión sin borrarla haría que «salir» no significara
 * nada.
 *
 * @param {string} userId
 */
export async function logout(userId) {
    await request('/api/auth/logout', { method: 'POST' });
    await keys.remove(userId);
}

/**
 * Cierra la sesión en todos los dispositivos.
 * @param {string} userId
 */
export async function logoutEverywhere(userId) {
    await request('/api/auth/logout-all', { method: 'POST' });
    await keys.remove(userId);
}

/**
 * Da de baja una passkey.
 * @param {string} credentialId
 */
export async function removeCredential(credentialId) {
    const r = await request(`/api/account/credentials/${encodeURIComponent(credentialId)}`, { method: 'DELETE' });
    return r.ok ? { ok: /** @type {true} */ (true), value: r.value } : err(r.error);
}

/* ── Utilidades ──────────────────────────────────────────────────────────── */

/** Bytes → base64url sin relleno, que es el alfabeto de WebAuthn. */
function b64u(/** @type {ArrayBuffer | Uint8Array} */ bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binario = '';
    for (let i = 0; i < u8.length; i += 0x8000) binario += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → bytes. Lo que llega aquí lo emitió nuestro propio servidor. */
function deB64u(/** @type {string} */ texto) {
    const relleno = texto.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - texto.length % 4) % 4);
    const binario = atob(relleno);
    const out = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) out[i] = binario.charCodeAt(i);
    return out;
}

/**
 * La salida del PRF, si el autenticador la dio.
 *
 * Muchos no la dan —es una extensión relativamente nueva— y no darla no es un
 * fallo: significa que la clave se queda en IndexedDB y que el kit de
 * recuperación es la única vía de vuelta, que es exactamente el diseño.
 *
 * @param {*} credencial
 * @returns {Uint8Array | null}
 */
function prfDe(credencial) {
    try {
        const primero = credencial.getClientExtensionResults?.()?.prf?.results?.first;
        return primero ? new Uint8Array(primero) : null;
    } catch {
        return null;
    }
}

/** El `name` de un error del navegador, sin suponer que sea un `Error`. */
function nombreDe(/** @type {unknown} */ error) {
    return error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
}

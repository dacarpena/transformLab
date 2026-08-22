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
    generateDataKey, importDataKey, wrapDataKey, unwrapDataKey, deriveIndexKey,
    deriveDeviceKek, deriveRecoveryKek, generateRecoveryCode, RECOVERY_SALT_BYTES
} from './crypto.js';

/**
 * Guarda las DOS claves del dispositivo a partir de la clave en crudo.
 *
 * Son dos y no una porque la de índice —la que calcula las etiquetas de fila de
 * la sincronía— **no se puede derivar de la que se guarda**: la guardada es no
 * extraíble a propósito, para que un XSS pueda usarla pero no llevársela. Así
 * que las dos se calculan aquí, en el único momento en que la clave está en
 * crudo: el alta, el desbloqueo con PRF y el desbloqueo con el kit.
 *
 * Si esto se olvidara en alguno de los tres caminos, ese dispositivo se
 * autenticaría bien y luego no podría sincronizar, diciendo que está bloqueado
 * cuando no lo está. Por eso hay un único sitio que lo hace.
 *
 * Los bytes en crudo se borran al salir. No es teatro: un `Uint8Array` vivo en
 * el montón es lo que un volcado de memoria encuentra.
 *
 * @param {string} userId
 * @param {Uint8Array} raw los 32 bytes de la clave de datos
 * @returns {Promise<boolean>}
 */
async function guardarClaves(userId, raw) {
    try {
        const dk = await importDataKey(raw);
        const ik = await deriveIndexKey(raw);
        return await keys.put(userId, dk, ik);
    } finally {
        raw.fill(0);
    }
}

/**
 * Como `guardarClaves`, pero partiendo de un sobre. Desenvuelve una copia
 * EXTRAÍBLE para este único uso, saca los bytes y guarda las dos claves
 * definitivas, que no lo son.
 *
 * @param {string} userId
 * @param {CryptoKey} kek
 * @param {Uint8Array} sobre
 * @returns {Promise<boolean>}
 */
async function abrirYGuardar(userId, kek, sobre) {
    const copia = await unwrapDataKey(kek, sobre, { extractable: true });
    if (!copia) return false;
    return guardarClaves(userId, new Uint8Array(await crypto.subtle.exportKey('raw', copia)));
}

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
 * **El kit de recuperación se genera AQUÍ**, dentro del alta, y no en un paso
 * aparte. La razón es técnica y manda: envolver la clave exige tenerla en crudo,
 * y solo la hay en crudo en este instante — un segundo después vive no
 * extraíble, que es la propiedad que se quiere. Hacerlo después obligaría a
 * sacarla del sobre del PRF, y **muchos autenticadores no dan PRF**: sería un
 * alta que a veces no puede protegerse.
 *
 * Devuelve el código **una sola vez**, y **NO lo sube todavía**. La subida va en
 * `commitRecoveryKit`, que la interfaz llama cuando el usuario confirma que lo ha
 * guardado.
 *
 * Esa separación es el corazón de la regla dura: `protected_at` significa «hay
 * vía de vuelta», y si el código se generó pero el usuario cerró el diálogo sin
 * apuntarlo, **no la hay** — el código ya no existe en ninguna parte. Subirlo
 * antes de la confirmación marcaría la cuenta como protegida mintiendo, y la
 * mentira solo se descubriría el día que hiciera falta recuperar.
 *
 * El sobre que espera a confirmarse ya está CIFRADO, así que retenerlo no
 * empeora nada: sin el código no lo abre nadie.
 *
 * @returns {Promise<Ok<{ userId: string, protected: boolean, prf: boolean,
 *                       recoveryCode: string, commitRecoveryKit: () => Promise<Ok<{ saved: true }> | Err> }> | Err>}
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

    // El kit se prepara ANTES de borrar los bytes; `guardarClaves` los borra.
    const kit = await prepareRecoveryKit(raw);
    await guardarClaves(fin.value.userId, raw);

    return {
        ok: true,
        value: {
            userId: fin.value.userId,
            // SIEMPRE falso en el alta: hasta que el usuario confirme que ha
            // guardado el código, no hay vía de vuelta.
            protected: false,
            prf: conPrf,
            recoveryCode: kit.code,
            commitRecoveryKit: kit.commit
        }
    };
}

/**
 * ¿Puede este dispositivo descifrar los datos de esta cuenta?
 *
 * `unlocked` si la clave está guardada aquí; `locked` si no. Es la pregunta que
 * decide si hay que pedir el kit, y se responde SIN salir a la red: la clave o
 * está en este dispositivo o no está, y el servidor no tiene voz en eso.
 *
 * @param {string} userId
 * @returns {Promise<'unlocked' | 'locked'>}
 */
export async function keyMaterialState(userId) {
    return await keys.get(userId) ? 'unlocked' : 'locked';
}

/* ── Entrar con Google (M10) ─────────────────────────────────────────────── */

/**
 * Dónde empieza el flujo de Google.
 *
 * Es una NAVEGACIÓN, no un `fetch`: el navegador se va a Google y vuelve. Por
 * eso aquí no hay nada más que una URL —no se carga ningún script de Google y la
 * CSP no se toca— y por eso quien nunca lo use no paga ninguna relajación.
 */
export const GOOGLE_START = '/api/auth/google/start';

/**
 * Qué dijo el servidor al volver de Google, leído del FRAGMENTO de la URL.
 *
 * Del fragmento porque es lo único que **no viaja al servidor**: ni acaba en los
 * registros de un intermediario ni se queda pegado en un enlace compartido. Y se
 * limpia al leerlo, para que recargar la página no repita el flujo.
 *
 * @returns {{ result: 'new' | 'ok' | 'cancel' | 'error', code: string | null } | null}
 */
export function readGoogleReturn() {
    const hash = globalThis.location?.hash ?? '';
    if (!hash.startsWith('#auth=')) return null;

    const params = new URLSearchParams(hash.slice(1));
    const auth = params.get('auth');
    const code = params.get('code');

    // Se limpia SIEMPRE, incluso si el valor no vale: dejarlo puesto haría que
    // cada recarga volviera a intentar lo mismo.
    if (globalThis.history?.replaceState) {
        globalThis.history.replaceState(null, '', globalThis.location.pathname + globalThis.location.search);
    }
    if (auth !== 'new' && auth !== 'ok' && auth !== 'cancel' && auth !== 'error') return null;
    return { result: auth, code: typeof code === 'string' ? code : null };
}

/**
 * Termina el alta con Google: genera la clave de datos y prepara el kit.
 *
 * **Aquí está la diferencia que hay que entender de entrar con Google.** Google
 * dice quién eres; no puede descifrar nada, porque la clave se genera en este
 * dispositivo y no sale de él. Con una passkey hay dos vías de vuelta —el sobre
 * del PRF y el kit—; con Google **el kit es la única**, y por eso este camino
 * lleva derecho a enseñarlo.
 *
 * La sesión ya está abierta: la abrió el `callback` con su cookie. Lo que falta
 * es el material criptográfico, que nunca ha existido.
 *
 * @param {string} userId
 * @returns {Promise<Ok<{ userId: string, recoveryCode: string, commitRecoveryKit: () => Promise<Ok<{ saved: true }> | Err> }> | Err>}
 */
export async function completeGoogleSignUp(userId) {
    // La clave de datos nace AQUÍ, en el dispositivo, y no sale nunca en claro.
    const extraible = await generateDataKey();
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', extraible));

    // El kit se prepara ANTES de borrar los bytes; `guardarClaves` los borra.
    const kit = await prepareRecoveryKit(raw);
    await guardarClaves(userId, raw);

    return {
        ok: /** @type {true} */ (true),
        value: { userId, recoveryCode: kit.code, commitRecoveryKit: kit.commit }
    };
}

/**
 * Prepara un kit: genera el código, envuelve la clave y devuelve una función que
 * SUBE el sobre. Nada sale a la red hasta que se la llama.
 *
 * @param {Uint8Array} rawKey
 * @returns {Promise<{ code: string, commit: () => Promise<Ok<{ saved: true }> | Err> }>}
 */
async function prepareRecoveryKit(rawKey) {
    const { code } = await generateRecoveryCode();
    const salt = crypto.getRandomValues(new Uint8Array(RECOVERY_SALT_BYTES));
    const kek = await deriveRecoveryKek(code, salt);
    // Imposible: el código lo acabamos de generar con el formato correcto.
    if (!kek) throw new Error('kit recién generado ilegible');

    const extraible = await crypto.subtle.importKey(
        'raw', /** @type {ArrayBuffer} */ (rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength)),
        { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    const sobre = await wrapDataKey(kek, extraible);

    return {
        code,
        commit: async () => {
            const guardado = await request('/api/account/keys', {
                method: 'POST',
                body: { recovery: { wrapped: b64u(sobre), salt: b64u(salt) } }
            });
            return guardado.ok ? { ok: /** @type {true} */ (true), value: { saved: /** @type {true} */ (true) } } : err(guardado.error);
        }
    };
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
            const abierto = await abrirYGuardar(userId, await deriveDeviceKek(prf),
                /** @type {*} */ (deB64u(sobre.wrapped)));
            if (abierto) {
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

    if (!await abrirYGuardar(userId, kek, /** @type {*} */ (deB64u(recovery.wrapped)))) {
        return err('account.badRecoveryKit');
    }
    return { ok: true, value: { unlocked: true } };
}

/* ── El kit ──────────────────────────────────────────────────────────────── */

/**
 * Genera el kit y lo sube de una vez.
 *
 * Lo usa `createRecoveryKitWithPasskey`, donde no hay nada que confirmar antes:
 * la cuenta ya existe y el usuario acaba de pedir un kit nuevo a propósito.
 *
 * @param {{ userId: string, rawKey: Uint8Array }} entrada
 * @returns {Promise<Ok<{ code: string }> | Err>}
 */
export async function saveRecoveryKit({ userId, rawKey }) {
    const kit = await prepareRecoveryKit(rawKey);
    const guardado = await kit.commit();
    if (!guardado.ok) return err(guardado.error);
    return { ok: true, value: { code: kit.code } };
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
 * Cierra la cuenta y borra del servidor todo lo que había en ella (RGPD art. 17).
 *
 * **Lo de este dispositivo no se toca.** Aquí la copia local es la buena, y la
 * del servidor existe para que pueda haber más de un dispositivo; cerrar la
 * cuenta sin perder el historial tiene que ser posible, o nadie la cerrará. Lo
 * que sí se borra en local es la CLAVE —sin cuenta no hay nada que descifrar— y
 * la memoria de la sincronía: el cursor y la sombra describen un servidor que
 * ya no existe, y dejarlos convertiría un alta futura en un lío de lápidas.
 *
 * @param {string} userId
 * @returns {Promise<Ok<{ deleted: true }> | Err>}
 */
export async function deleteAccount(userId) {
    const r = await request('/api/account', { method: 'DELETE' });
    if (!r.ok) return err(r.error);
    await keys.remove(userId);
    return { ok: /** @type {true} */ (true), value: { deleted: /** @type {true} */ (true) } };
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

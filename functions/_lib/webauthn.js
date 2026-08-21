// @ts-check

/**
 * WebAuthn verificado a mano, sin una sola dependencia (M8-3).
 *
 * ## Por qué no hay librería
 *
 * Las librerías de WebAuthn son grandes porque resuelven la ATESTACIÓN: leer el
 * objeto CBOR que envuelve la clave pública, descodificar COSE, y validar
 * cadenas de certificados de fabricante. Este proyecto no necesita nada de eso,
 * y por dos decisiones concretas:
 *
 * 1. **`attestation: 'none'`.** No nos importa qué fabricante hizo el
 *    autenticador; nos importa que la misma clave que se registró sea la que
 *    firma después. Validar cadenas de certificados serviría para una política
 *    de empresa —«solo llaves YubiKey»— que aquí no existe.
 * 2. **`response.getPublicKey()`** devuelve la clave en **SPKI DER**, que entra
 *    directa en `crypto.subtle.importKey('spki', …)`. Es la ruta que evita CBOR
 *    y COSE por completo.
 *
 * Lo que queda son unas doscientas líneas auditables y un puñado de
 * comprobaciones del estándar. En un servidor que guarda datos cifrados de
 * personas, doscientas líneas que se pueden leer valen más que una dependencia
 * que no se puede auditar.
 *
 * ## La trampa que se lleva a todo el mundo por delante
 *
 * WebAuthn firma con ECDSA y entrega la firma en **ASN.1 DER**. `crypto.subtle`
 * espera **r‖s en crudo** (IEEE P1363). Sin convertir, `verify` devuelve `false`
 * siempre — y `false` no es un error, así que el síntoma es «el login no
 * funciona» sin ninguna traza. Es lo que hace `derToRaw`, y tiene sus propios
 * tests con los casos de borde que muerden: `r` o `s` con el bit alto puesto
 * (DER les mete un `0x00` delante y pasan a 33 bytes) y `r` o `s` cortos (DER
 * quita los ceros de cabecera y hay que volver a rellenar a la izquierda).
 */

import { decode as b64uDecode, encode as b64uEncode } from './base64url.js';

/** Bandera de «usuario presente». Sin ella nadie tocó el autenticador. */
const FLAG_UP = 0x01;
/** Bandera de «usuario verificado» (PIN o biometría). */
const FLAG_UV = 0x04;
/** Bandera de «hay datos de credencial adjuntos» (solo en el registro). */
const FLAG_AT = 0x40;

/** ES256. Es el único algoritmo que este servidor acepta. */
export const ALG_ES256 = -7;

/** Cuánto vive un reto. Suficiente para desbloquear el móvil, poco para más. */
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/**
 * @typedef {{ ok: true, value: T }} Ok
 * @template T
 */
/**
 * @typedef {{ ok: false, error: string }} Err
 */

const err = (/** @type {string} */ error) => ({ ok: /** @type {false} */ (false), error });

/* ── authenticatorData ───────────────────────────────────────────────────── */

/**
 * Trocea `authenticatorData`, cuyo formato es fijo:
 *
 * ```
 *   0..31   rpIdHash    SHA-256 del identificador de la parte confiante
 *   32      flags       UP(0x01) UV(0x04) BE(0x08) BS(0x10) AT(0x40) ED(0x80)
 *   33..36  signCount   entero de 32 bits, big-endian
 *   37..    attestedCredentialData / extensiones (solo si AT / ED)
 * ```
 *
 * @param {Uint8Array} bytes
 * @returns {Ok<{ rpIdHash: Uint8Array, flags: number, up: boolean, uv: boolean, at: boolean, signCount: number }> | Err}
 */
export function parseAuthenticatorData(bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.length < 37) return err('authData.tooShort');
    const flags = bytes[32];
    // `getUint32` y no aritmética a mano: el desplazamiento a la izquierda en
    // JavaScript trabaja con enteros CON SIGNO, así que un contador por encima
    // de 2^31 saldría negativo y rompería la comprobación de monotonía justo en
    // el caso raro.
    const signCount = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(33, false);
    return {
        ok: true,
        value: {
            rpIdHash: bytes.subarray(0, 32),
            flags,
            up: (flags & FLAG_UP) !== 0,
            uv: (flags & FLAG_UV) !== 0,
            at: (flags & FLAG_AT) !== 0,
            signCount
        }
    };
}

/* ── clientDataJSON ──────────────────────────────────────────────────────── */

/**
 * Comprueba el `clientDataJSON`, que es lo que el NAVEGADOR firma junto al
 * `authenticatorData`. Aquí es donde se cierra el phishing: el navegador escribe
 * el origen real, y el autenticador lo firma sin preguntar. Si alguien monta una
 * copia de la aplicación en otro dominio, el `origin` firmado será el suyo.
 *
 * @param {Uint8Array} bytes
 * @param {{ type: 'webauthn.create' | 'webauthn.get', challenge: Uint8Array, origin: string }} esperado
 * @returns {Ok<{ challenge: string }> | Err}
 */
export function checkClientData(bytes, esperado) {
    let datos;
    try {
        datos = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
        return err('clientData.notJson');
    }
    if (datos === null || typeof datos !== 'object') return err('clientData.notObject');

    // El tipo separa el registro del login. Sin comprobarlo, una firma obtenida
    // en un `create` podría presentarse como si fuera un `get`.
    if (datos.type !== esperado.type) return err('clientData.wrongType');

    // `crossOrigin` cierra el caso del iframe: la aplicación prohíbe además ser
    // embebida (`frame-ancestors 'none'`), pero eso es la aplicación, y aquí se
    // está validando lo que dice el navegador de quien firma.
    if (datos.crossOrigin === true) return err('clientData.crossOrigin');

    if (datos.origin !== esperado.origin) return err('clientData.wrongOrigin');

    // El reto se compara en su forma de TEXTO, que es como el navegador lo
    // escribe: si se decodificara primero, dos codificaciones distintas del
    // mismo reto pasarían, y el reto dejaría de ser de un solo uso.
    if (typeof datos.challenge !== 'string') return err('clientData.noChallenge');
    if (datos.challenge !== b64uEncode(esperado.challenge)) return err('clientData.wrongChallenge');

    return { ok: true, value: { challenge: datos.challenge } };
}

/* ── Firmas ──────────────────────────────────────────────────────────────── */

/**
 * ASN.1 DER `SEQUENCE { INTEGER r, INTEGER s }` → los 64 bytes crudos que
 * `crypto.subtle.verify` espera.
 *
 * Es la conversión que hay que hacer y que nadie ve venir: sin ella `verify`
 * devuelve `false` siempre, y `false` no es un error, así que no hay traza.
 *
 * @param {Uint8Array} der
 * @returns {Uint8Array | null} 64 bytes, o `null` si no es un DER válido.
 */
export function derToRaw(der) {
    if (!(der instanceof Uint8Array) || der.length < 8 || der[0] !== 0x30) return null;

    let i = 1;
    let largo = der[i++];
    if (largo === 0x81) largo = der[i++];          // forma larga de un byte
    else if (largo > 0x80) return null;            // más de 255 bytes: no es P-256
    if (largo !== der.length - i) return null;     // la longitud tiene que cuadrar

    /** Lee un INTEGER y lo devuelve normalizado a 32 bytes. */
    const entero = () => {
        if (der[i++] !== 0x02) return null;
        const n = der[i++];
        if (n === 0 || i + n > der.length) return null;
        let v = der.subarray(i, i + n);
        i += n;
        // DER mete un 0x00 delante cuando el bit alto está puesto, para que el
        // número no se lea como negativo. Hay que quitarlo.
        let inicio = 0;
        while (inicio < v.length - 1 && v[inicio] === 0) inicio++;
        v = v.subarray(inicio);
        if (v.length > 32) return null;
        // Y al revés: DER quita los ceros de cabecera, así que un valor corto
        // hay que rellenarlo A LA IZQUIERDA hasta 32.
        const out = new Uint8Array(32);
        out.set(v, 32 - v.length);
        return out;
    };

    const r = entero();
    if (!r) return null;
    const s = entero();
    if (!s) return null;
    if (i !== der.length) return null;             // bytes de sobra: no es válido

    const raw = new Uint8Array(64);
    raw.set(r, 0);
    raw.set(s, 32);
    return raw;
}

/**
 * Verifica una firma de WebAuthn.
 *
 * Lo firmado es siempre `authenticatorData ‖ SHA-256(clientDataJSON)`, y esa
 * concatenación es lo que ata la respuesta al origen: el hash de los datos del
 * cliente —donde está el origen y el reto— entra dentro de la firma.
 *
 * @param {{ publicKeySpki: Uint8Array, authenticatorData: Uint8Array, clientDataJSON: Uint8Array, signature: Uint8Array }} entrada
 * @returns {Promise<boolean>}
 */
export async function verifySignature({ publicKeySpki, authenticatorData, clientDataJSON, signature }) {
    const raw = derToRaw(signature);
    if (!raw) return false;

    let key;
    try {
        key = await crypto.subtle.importKey(
            'spki', bufferDe(publicKeySpki),
            { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    } catch {
        // Una clave guardada que ya no se puede importar es un dato corrupto, no
        // un intento de fraude; pero la respuesta es la misma: no se entra.
        return false;
    }

    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bufferDe(clientDataJSON)));
    const firmado = new Uint8Array(authenticatorData.length + hash.length);
    firmado.set(authenticatorData, 0);
    firmado.set(hash, authenticatorData.length);

    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bufferDe(raw), bufferDe(firmado));
}

/* ── Los dos flujos ──────────────────────────────────────────────────────── */

/**
 * Registro: se comprueba lo que el navegador dice, y se guarda la clave.
 *
 * No se verifica ninguna firma, y eso es correcto con `attestation: 'none'`: en
 * el registro no hay nada firmado con una clave que ya conozcamos. Lo que ata el
 * registro es el reto —de un solo uso, emitido por nosotros— y el origen, que el
 * navegador escribe y el usuario no controla.
 *
 * @param {{ clientDataJSON: Uint8Array, authenticatorData: Uint8Array, publicKeySpki: Uint8Array, algorithm: number }} respuesta
 * @param {{ challenge: Uint8Array, origin: string, rpIdHash: Uint8Array }} esperado
 * @returns {Promise<Ok<{ signCount: number }> | Err>}
 */
export async function verifyRegistration(respuesta, esperado) {
    if (respuesta.algorithm !== ALG_ES256) return err('webauthn.algorithm');

    const cliente = checkClientData(respuesta.clientDataJSON, {
        type: 'webauthn.create', challenge: esperado.challenge, origin: esperado.origin
    });
    if (!cliente.ok) return cliente;

    const auth = parseAuthenticatorData(respuesta.authenticatorData);
    if (!auth.ok) return auth;
    if (!iguales(auth.value.rpIdHash, esperado.rpIdHash)) return err('webauthn.rpIdHash');
    if (!auth.value.up) return err('webauthn.userNotPresent');
    if (!auth.value.at) return err('webauthn.noCredentialData');

    // La clave tiene que ser importable AHORA. Descubrirlo en el primer login
    // dejaría una credencial registrada con la que es imposible entrar, y el
    // usuario ya se habría ido de la pantalla que sabe rehacerla.
    try {
        await crypto.subtle.importKey('spki', bufferDe(respuesta.publicKeySpki),
            { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    } catch {
        return err('webauthn.badPublicKey');
    }

    return { ok: true, value: { signCount: auth.value.signCount } };
}

/**
 * Login: aquí sí hay firma, y con la clave que se guardó al registrar.
 *
 * @param {{ clientDataJSON: Uint8Array, authenticatorData: Uint8Array, signature: Uint8Array }} respuesta
 * @param {{ publicKeySpki: Uint8Array, storedSignCount: number }} credencial
 * @param {{ challenge: Uint8Array, origin: string, rpIdHash: Uint8Array }} esperado
 * @returns {Promise<Ok<{ signCount: number, uv: boolean }> | Err>}
 */
export async function verifyAssertion(respuesta, credencial, esperado) {
    const cliente = checkClientData(respuesta.clientDataJSON, {
        type: 'webauthn.get', challenge: esperado.challenge, origin: esperado.origin
    });
    if (!cliente.ok) return cliente;

    const auth = parseAuthenticatorData(respuesta.authenticatorData);
    if (!auth.ok) return auth;
    if (!iguales(auth.value.rpIdHash, esperado.rpIdHash)) return err('webauthn.rpIdHash');
    if (!auth.value.up) return err('webauthn.userNotPresent');

    // El contador tiene que AVANZAR. Si retrocede o se repite, hay dos copias de
    // la misma credencial en el mundo, que es la definición de clonada.
    //
    // La excepción no es una concesión: muchos autenticadores modernos —los
    // pasos de acceso sincronizados de Apple y Google, entre ellos— dejan el
    // contador siempre en cero a propósito, porque la credencial vive en varios
    // dispositivos por diseño. Cuando el guardado y el recibido son cero, el
    // autenticador está diciendo «no llevo la cuenta», y exigirle monotonía
    // dejaría fuera a la mayoría de los usuarios reales.
    const nuevo = auth.value.signCount;
    if (!(credencial.storedSignCount === 0 && nuevo === 0) && nuevo <= credencial.storedSignCount) {
        return err('webauthn.signCountReplay');
    }

    const firmaOk = await verifySignature({
        publicKeySpki: credencial.publicKeySpki,
        authenticatorData: respuesta.authenticatorData,
        clientDataJSON: respuesta.clientDataJSON,
        signature: respuesta.signature
    });
    if (!firmaOk) return err('webauthn.badSignature');

    return { ok: true, value: { signCount: nuevo, uv: auth.value.uv } };
}

/* ── Utilidades ──────────────────────────────────────────────────────────── */

/**
 * SHA-256 de una cadena, en bytes. Se usa para el `rpIdHash` y para hashear el
 * reto antes de guardarlo.
 *
 * @param {string} texto
 * @returns {Promise<Uint8Array>}
 */
export async function sha256(texto) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
}

/**
 * SHA-256 de unos bytes.
 * @param {Uint8Array} bytes
 * @returns {Promise<Uint8Array>}
 */
export async function sha256Bytes(bytes) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', bufferDe(bytes)));
}

/**
 * Un reto nuevo: 32 bytes de `crypto.getRandomValues`.
 * @returns {Uint8Array}
 */
export function newChallenge() {
    return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Decodifica un campo base64url de una petición.
 * @param {unknown} valor
 * @returns {Uint8Array | null}
 */
export const fromB64u = b64uDecode;

/** @param {Uint8Array} a @param {Uint8Array} b */
function iguales(a, b) {
    if (a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
}

/**
 * `ArrayBuffer` exacto de una vista. `crypto.subtle` no acepta una vista con
 * desplazamiento sobre un búfer mayor sin llevarse el búfer entero, y las vistas
 * que salen de `parseAuthenticatorData` son justo eso.
 *
 * @param {Uint8Array} v
 * @returns {ArrayBuffer}
 */
function bufferDe(v) {
    return /** @type {ArrayBuffer} */ (v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

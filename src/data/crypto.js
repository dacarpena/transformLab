// @ts-check

/**
 * El llavero del cifrado extremo a extremo (M8-5).
 *
 * ## El modelo, en cuatro líneas
 *
 * ```
 *   DK          AES-GCM de 256 bits, aleatoria, generada una vez. Cifra TODO.
 *               Nunca sale del dispositivo en claro.
 *   KEK_d       por dispositivo, derivada del PRF del autenticador (si lo da).
 *   KEK_r       del kit de recuperación, derivada con PBKDF2 en el NAVEGADOR.
 *   wrapped_*   la DK cifrada con cada KEK. Es lo único que ve el servidor.
 * ```
 *
 * El servidor guarda `wrapped_dk` y `wrapped_dk_recovery`, y no puede abrir
 * ninguno de los dos: le faltan las claves, y las claves nunca viajan.
 *
 * ## Lo que esto compra, y lo que cuesta
 *
 * Compra que un volcado del servidor sea ruido. **Cuesta que perder todos los
 * dispositivos Y el kit sea irreversible**: nadie puede recuperar esos datos, ni
 * nosotros. Por eso existe la regla dura —no se sube nada hasta que hay vía de
 * vuelta— y por eso los datos locales siguen intactos pase lo que pase: la
 * aplicación funciona sin cuenta, y eso no cambia.
 *
 * ## Este módulo es PURO
 *
 * No toca la red, no toca `localStorage` y no toca IndexedDB. Guardar la DK en
 * el dispositivo es cosa de `keys-db.js`. Aquí solo hay `crypto.subtle`, así que
 * todo esto se prueba desde Node sin navegador.
 */

/** Etiqueta de versión del formato. Va en el `info` de HKDF y en la cabecera. */
const VERSION = 1;

/** Bytes del vector de inicialización de AES-GCM. Doce: es lo que recomienda el estándar. */
const IV_BYTES = 12;

/** Iteraciones de PBKDF2 para el kit de recuperación. */
export const PBKDF2_ITERATIONS = 600_000;

/** Bytes de la sal del kit. */
export const RECOVERY_SALT_BYTES = 16;

/* ── La clave de datos ───────────────────────────────────────────────────── */

/**
 * Genera la DK. Sale **extraíble** a propósito, porque hay que envolverla: una
 * clave no extraíble no se puede exportar ni siquiera para cifrarla.
 *
 * El que la genera tiene que envolverla y después cambiarla por la copia no
 * extraíble de `importDataKey`, y soltar ésta. `createDataKey` hace justo esa
 * coreografía; esta función está expuesta para los tests.
 *
 * @returns {Promise<CryptoKey>}
 */
export async function generateDataKey() {
    return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/**
 * Importa una DK en bruto como clave **no extraíble**.
 *
 * Es la forma en que la DK vive en el dispositivo, y es la mejor propiedad que
 * un navegador puede dar: un XSS puede USARLA mientras la página está abierta
 * —eso no lo evita nadie—, pero **no puede leerla ni sacarla**. La diferencia
 * entre «pueden descifrar lo que haya en pantalla mientras dure el ataque» y
 * «se llevan la clave y ya descifran todo para siempre» es la que importa.
 *
 * @param {ArrayBuffer | Uint8Array} raw 32 bytes
 * @returns {Promise<CryptoKey>}
 */
export async function importDataKey(raw) {
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (bytes.length !== 32) throw new Error('la clave de datos tiene que ser de 32 bytes');
    return crypto.subtle.importKey('raw', copia(bytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/* ── Envolver y abrir ────────────────────────────────────────────────────── */

/**
 * Envuelve la DK con una clave de cifrado de clave (KEK).
 *
 * El resultado lleva delante su versión y su IV: `[versión][iv][cifrado]`. La
 * versión va DENTRO y no en una columna aparte porque el sobre tiene que poder
 * viajar solo —a un backup, a otro dispositivo— sin perder cómo se lee.
 *
 * @param {CryptoKey} kek
 * @param {CryptoKey} dk debe ser extraíble
 * @returns {Promise<Uint8Array>}
 */
export async function wrapDataKey(kek, dk) {
    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', dk));
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const cifrado = new Uint8Array(
        await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, copia(raw)));

    const out = new Uint8Array(1 + IV_BYTES + cifrado.length);
    out[0] = VERSION;
    out.set(iv, 1);
    out.set(cifrado, 1 + IV_BYTES);
    // La copia en bruto de la DK ha estado en memoria; se sobrescribe. No es una
    // garantía —el recolector puede haber movido el búfer—, pero cuesta nada y
    // acorta la ventana.
    raw.fill(0);
    return out;
}

/**
 * Abre un sobre y devuelve la DK **no extraíble**.
 *
 * Devuelve `null` si no se puede abrir, en vez de lanzar: los dos motivos
 * normales son un kit mal tecleado y un sobre de otra cuenta, y ninguno es
 * excepcional. AES-GCM detecta cualquier manipulación por el propio tag, así que
 * un sobre alterado en el servidor cae por aquí.
 *
 * @param {CryptoKey} kek
 * @param {ArrayBuffer | Uint8Array} sobre
 * @param {{ extractable?: boolean }} [opciones] `extractable: true` SOLO para
 *   volver a envolver la clave con otra KEK —crear un kit de recuperación nuevo,
 *   añadir un dispositivo—. La clave que salga así **no se guarda nunca**: se usa
 *   y se suelta. Todo lo demás usa el valor por omisión, que es la propiedad que
 *   hace que un XSS no pueda llevarse la clave.
 * @returns {Promise<CryptoKey | null>}
 */
export async function unwrapDataKey(kek, sobre, opciones = {}) {
    const bytes = sobre instanceof Uint8Array ? sobre : new Uint8Array(sobre);
    if (bytes.length <= 1 + IV_BYTES) return null;
    if (bytes[0] !== VERSION) return null;

    try {
        const raw = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: copia(bytes.subarray(1, 1 + IV_BYTES)) },
            kek, copia(bytes.subarray(1 + IV_BYTES)));
        if (raw.byteLength !== 32) return null;
        if (!opciones.extractable) return await importDataKey(raw);
        return await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    } catch {
        return null;
    }
}

/* ── Las dos KEK ─────────────────────────────────────────────────────────── */

/**
 * KEK del dispositivo, derivada de la salida PRF del autenticador.
 *
 * HKDF y no PBKDF2: la entrada ya son 32 bytes de alta entropía que produce el
 * autenticador, no algo que haya elegido una persona. Estirar por tiempo lo que
 * ya es aleatorio no compra nada y solo hace más lento cada login.
 *
 * @param {ArrayBuffer | Uint8Array} prfOutput
 * @returns {Promise<CryptoKey>}
 */
export async function deriveDeviceKek(prfOutput) {
    const material = await crypto.subtle.importKey(
        'raw', copia(prfOutput instanceof Uint8Array ? prfOutput : new Uint8Array(prfOutput)),
        'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        {
            name: 'HKDF', hash: 'SHA-256',
            // Sin sal: la entrada del PRF ya es uniforme, y la sal de HKDF existe
            // para entradas que no lo son. El `info` sí es imprescindible: separa
            // este uso de cualquier otro que derive del mismo PRF en el futuro.
            salt: new Uint8Array(0),
            info: new TextEncoder().encode(`tl.dk.v${VERSION}`)
        },
        material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * KEK del kit de recuperación, derivada del código que el usuario teclea.
 *
 * PBKDF2 con 600 000 iteraciones, y merece explicación porque en rigor **no hace
 * falta**: el código son 160 bits de `getRandomValues`, y ningún KDF cambia nada
 * frente a eso. Se pone igual porque es defensa en profundidad barata —un
 * segundo, una vez— y cubre los casos en que el supuesto no se cumple: un
 * usuario que anota el código a medias, un generador débil en un navegador
 * antiguo, un formato futuro con menos entropía.
 *
 * Corre en el NAVEGADOR. En un Worker sería imposible: el plan gratuito da 10 ms
 * de CPU por petición, y esto son ~1 000.
 *
 * @param {string} recoveryCode tal y como lo teclea el usuario
 * @param {ArrayBuffer | Uint8Array} salt
 * @returns {Promise<CryptoKey | null>} `null` si el código no es válido
 */
export async function deriveRecoveryKek(recoveryCode, salt) {
    const bytes = decodeRecoveryCode(recoveryCode);
    if (!bytes) return null;

    const material = await crypto.subtle.importKey('raw', copia(bytes), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        {
            name: 'PBKDF2', hash: 'SHA-256',
            salt: copia(salt instanceof Uint8Array ? salt : new Uint8Array(salt)),
            iterations: PBKDF2_ITERATIONS
        },
        material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * La clave con la que se calculan las ETIQUETAS de fila (M9-3).
 *
 * Derivada de la DK con HKDF y un `info` propio, para que no sea la misma clave
 * que cifra: si lo fuera, quien consiguiera una etiqueta tendría una pista sobre
 * el material que abre los datos. Separar usos de una misma clave maestra es
 * para lo que existe el `info` de HKDF.
 *
 * Se deriva de la clave EN CRUDO, no del `CryptoKey` guardado: el guardado es
 * deliberadamente no extraíble —para que un XSS no pueda llevárselo— y de una
 * clave no extraíble no se puede derivar nada. Así que se calcula en el único
 * momento en que la DK está en crudo (el alta o el desbloqueo) y se guarda
 * aparte, también no extraíble: firmar un HMAC no necesita extraer.
 *
 * @param {ArrayBuffer | Uint8Array} rawKey los 32 bytes de la DK
 * @returns {Promise<CryptoKey>}
 */
export async function deriveIndexKey(rawKey) {
    const raw = rawKey instanceof Uint8Array ? rawKey : new Uint8Array(rawKey);
    const material = await crypto.subtle.importKey('raw', copia(raw), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        {
            name: 'HKDF', hash: 'SHA-256',
            salt: new Uint8Array(0),
            info: new TextEncoder().encode(`tl.idx.v${VERSION}`)
        },
        material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** Bytes de la etiqueta de fila. */
export const ITEM_TAG_BYTES = 16;

/**
 * La etiqueta OPACA de una fila: `HMAC(K_idx, collection ‖ keyPath)`.
 *
 * Tiene que cumplir dos cosas a la vez, y por eso es un HMAC y no un hash a
 * secas ni el propio `keyPath`:
 *
 * - **Determinista**, para que dos dispositivos calculen la misma etiqueta para
 *   la misma fila y la fusión las encuentre. Un identificador aleatorio no
 *   serviría: cada dispositivo crearía una fila distinta para el mismo dato.
 * - **Opaca sin la clave**, para que el servidor no aprenda de qué día es un
 *   check-in. Un `SHA-256(dateISO)` a secas no bastaría: el espacio de fechas es
 *   diminuto y se recorre entero en un segundo.
 *
 * Los segmentos se serializan con `JSON.stringify`, que es inyectivo: unirlos
 * con un separador haría que `['a:b','c']` y `['a','b:c']` dieran la misma
 * etiqueta, y son filas distintas.
 *
 * @param {CryptoKey} indexKey
 * @param {string} collection
 * @param {readonly string[]} keyPath
 * @returns {Promise<Uint8Array>} 16 bytes
 */
export async function itemTag(indexKey, collection, keyPath) {
    const entrada = new TextEncoder().encode(JSON.stringify([collection, keyPath]));
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', indexKey, copia(entrada)));
    return mac.slice(0, ITEM_TAG_BYTES);
}

/* ── Cifrar y descifrar datos ────────────────────────────────────────────── */

/**
 * Cifra bytes con la DK. Formato: `[versión][iv][cifrado+tag]`.
 *
 * `aad` (datos autenticados pero no cifrados) ata el criptograma a su sitio: se
 * le pasa la colección y la etiqueta de la fila, de modo que un sobre movido a
 * otra fila **no descifra**. Sin eso, quien pudiera escribir en el servidor
 * podría barajar filas —poner el peso de enero en la de marzo— sin romper
 * ningún tag.
 *
 * @param {CryptoKey} dk
 * @param {ArrayBuffer | Uint8Array} datos
 * @param {string} [aad]
 * @returns {Promise<Uint8Array>}
 */
export async function encryptBytes(dk, datos, aad) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const params = /** @type {AesGcmParams} */ ({ name: 'AES-GCM', iv });
    if (aad !== undefined) params.additionalData = new TextEncoder().encode(aad);

    const cifrado = new Uint8Array(await crypto.subtle.encrypt(
        params, dk, copia(datos instanceof Uint8Array ? datos : new Uint8Array(datos))));

    const out = new Uint8Array(1 + IV_BYTES + cifrado.length);
    out[0] = VERSION;
    out.set(iv, 1);
    out.set(cifrado, 1 + IV_BYTES);
    return out;
}

/**
 * Descifra. Devuelve `null` si el sobre está manipulado, es de otra clave o
 * viene de otra fila (`aad` distinto).
 *
 * @param {CryptoKey} dk
 * @param {ArrayBuffer | Uint8Array} sobre
 * @param {string} [aad]
 * @returns {Promise<Uint8Array | null>}
 */
export async function decryptBytes(dk, sobre, aad) {
    const bytes = sobre instanceof Uint8Array ? sobre : new Uint8Array(sobre);
    if (bytes.length <= 1 + IV_BYTES || bytes[0] !== VERSION) return null;

    const params = /** @type {AesGcmParams} */ ({
        name: 'AES-GCM', iv: copia(bytes.subarray(1, 1 + IV_BYTES))
    });
    if (aad !== undefined) params.additionalData = new TextEncoder().encode(aad);

    try {
        return new Uint8Array(await crypto.subtle.decrypt(params, dk, copia(bytes.subarray(1 + IV_BYTES))));
    } catch {
        return null;
    }
}

/* ── El kit de recuperación ──────────────────────────────────────────────── */

/**
 * Alfabeto de Crockford: base32 **sin `I`, `L`, `O` ni `U`**.
 *
 * No es coquetería: este código se imprime y se teclea desde papel, meses
 * después, quizá por alguien con prisa. `I`/`1`/`l` y `O`/`0` son los pares que
 * más se confunden a mano, y la `U` se quita para no formar palabras
 * desafortunadas por azar. Al decodificar se aceptan las cuatro y se traducen.
 */
const ALFABETO = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Bytes de entropía del kit: 20 = 160 bits. */
export const RECOVERY_BYTES = 20;

/** Caracteres del código, entropía más comprobación. */
const CHARS_ENTROPIA = 32;   // 20 bytes × 8 / 5
const CHARS_CHECK = 4;

/**
 * Genera un kit nuevo: 160 bits, escritos como nueve grupos de cuatro.
 *
 * ```
 *   XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-CCCC
 * ```
 *
 * El último grupo es una comprobación derivada del resto. No aporta seguridad:
 * evita que un código mal tecleado se lleve por delante un segundo de PBKDF2
 * para acabar diciendo «no». Con 20 bits de comprobación, una errata pasa una
 * vez de cada millón.
 *
 * @returns {Promise<{ code: string, bytes: Uint8Array }>}
 */
export async function generateRecoveryCode() {
    const bytes = crypto.getRandomValues(new Uint8Array(RECOVERY_BYTES));
    return { code: await formatRecoveryCode(bytes), bytes };
}

/**
 * Da forma legible a unos bytes de kit.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>}
 */
export async function formatRecoveryCode(bytes) {
    if (bytes.length !== RECOVERY_BYTES) throw new Error(`el kit son ${RECOVERY_BYTES} bytes`);
    const cuerpo = aBase32(bytes);
    const check = await checkChars(bytes);
    return (cuerpo + check).match(/.{4}/g)?.join('-') ?? '';
}

/**
 * Lee un código tecleado y devuelve sus bytes, o `null`.
 *
 * Perdona lo que hay que perdonar y nada más: minúsculas, espacios, guiones de
 * más o de menos, y las cuatro letras excluidas del alfabeto (`I`/`L` → `1`,
 * `O` → `0`). No perdona un carácter que no exista ni una comprobación que no
 * cuadre — eso ya no es una errata previsible, es otro código.
 *
 * Es SÍNCRONA a propósito, para que la interfaz pueda validar mientras se
 * teclea; la comprobación se hace aparte, en `decodeRecoveryCode` no se puede
 * usar `await`. Por eso el dígito de control se verifica en
 * `verifyRecoveryCode`, y `deriveRecoveryKek` no lo exige: derivar con un código
 * mal tecleado simplemente no abre el sobre, que es el mismo resultado.
 *
 * @param {string} code
 * @returns {Uint8Array | null}
 */
export function decodeRecoveryCode(code) {
    if (typeof code !== 'string') return null;
    const limpio = code.toUpperCase().replace(/[\s-]/g, '')
        .replace(/[IL]/g, '1').replace(/O/g, '0');
    if (limpio.length !== CHARS_ENTROPIA + CHARS_CHECK) return null;

    const bytes = deBase32(limpio.slice(0, CHARS_ENTROPIA), RECOVERY_BYTES);
    if (!bytes) return null;
    // Que los caracteres de comprobación sean del alfabeto se valida aquí; que
    // CUADREN, en `verifyRecoveryCode`, que sí puede esperar al hash.
    for (const c of limpio.slice(CHARS_ENTROPIA)) {
        if (!ALFABETO.includes(c)) return null;
    }
    return bytes;
}

/**
 * ¿Está bien tecleado este código? Comprueba el dígito de control.
 *
 * @param {string} code
 * @returns {Promise<boolean>}
 */
export async function verifyRecoveryCode(code) {
    const bytes = decodeRecoveryCode(code);
    if (!bytes) return false;
    const limpio = code.toUpperCase().replace(/[\s-]/g, '')
        .replace(/[IL]/g, '1').replace(/O/g, '0');
    return limpio.slice(CHARS_ENTROPIA) === await checkChars(bytes);
}

/** Los cuatro caracteres de comprobación: 20 bits de SHA-256 de la entropía. */
async function checkChars(/** @type {Uint8Array} */ bytes) {
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', copia(bytes)));
    // 20 bits: los tres primeros bytes, quedándose con los 20 de más peso.
    const n = ((hash[0] << 16) | (hash[1] << 8) | hash[2]) >>> 4;
    let out = '';
    for (let i = CHARS_CHECK - 1; i >= 0; i--) out += ALFABETO[(n >>> (i * 5)) & 31];
    return out;
}

/** Bytes → base32 de Crockford, sin relleno. */
function aBase32(/** @type {Uint8Array} */ bytes) {
    let bits = 0, valor = 0, out = '';
    for (const b of bytes) {
        valor = (valor << 8) | b;
        bits += 8;
        while (bits >= 5) {
            out += ALFABETO[(valor >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += ALFABETO[(valor << (5 - bits)) & 31];
    return out;
}

/** base32 de Crockford → bytes, o `null` si hay un carácter que no existe. */
function deBase32(/** @type {string} */ texto, /** @type {number} */ esperados) {
    let bits = 0, valor = 0;
    const out = new Uint8Array(esperados);
    let i = 0;
    for (const c of texto) {
        const v = ALFABETO.indexOf(c);
        if (v < 0) return null;
        valor = (valor << 5) | v;
        bits += 5;
        if (bits >= 8) {
            if (i >= esperados) return null;
            out[i++] = (valor >>> (bits - 8)) & 0xff;
            bits -= 8;
        }
    }
    return i === esperados ? out : null;
}

/**
 * Copia exacta de una vista como `ArrayBuffer`.
 *
 * `crypto.subtle` no acepta una vista con desplazamiento sobre un búfer mayor
 * sin llevarse el búfer entero, y aquí se pasan subvistas constantemente.
 *
 * @param {Uint8Array} v
 * @returns {ArrayBuffer}
 */
function copia(v) {
    return /** @type {ArrayBuffer} */ (v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

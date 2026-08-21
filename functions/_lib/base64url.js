// @ts-check

/**
 * base64url, que es el alfabeto con el que WebAuthn habla (M8-3).
 *
 * Todo lo que viaja en WebAuthn —el reto, el id de credencial, la clave
 * pública— son bytes que van y vienen como base64url: `-` y `_` en vez de `+`
 * y `/`, y **sin relleno**. Confundirlo con base64 normal es un fallo silencioso
 * particularmente feo, porque los dos alfabetos coinciden en la mayoría de los
 * bytes: una prueba con datos cortos pasa y en producción falla una de cada
 * pocas veces, cuando toca un byte que cae en `+` o en `/`.
 *
 * `decode` es ESTRICTO a propósito. Es la primera función que toca lo que manda
 * un cliente, y un decodificador tolerante es un sitio donde dos cadenas
 * distintas producen los mismos bytes — es decir, un sitio donde un reto de un
 * solo uso podría gastarse dos veces.
 */

/**
 * Bytes → base64url sin relleno.
 *
 * @param {ArrayBuffer | Uint8Array} bytes
 * @returns {string}
 */
export function encode(bytes) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    // En trozos, porque `String.fromCharCode(...u8)` desborda la pila con
    // entradas grandes: una foto cifrada son cientos de miles de bytes.
    let binario = '';
    for (let i = 0; i < u8.length; i += 0x8000) {
        binario += String.fromCharCode(...u8.subarray(i, i + 0x8000));
    }
    return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * base64url → bytes. Devuelve `null` si la cadena no es base64url válida, en
 * vez de lanzar o de decodificar algo aproximado.
 *
 * @param {unknown} texto
 * @returns {Uint8Array | null}
 */
export function decode(texto) {
    if (typeof texto !== 'string' || texto.length === 0) return null;
    // Solo el alfabeto de base64url, y NADA de relleno: si llega un `=`, un `+`
    // o un `/`, quien lo mandó no está hablando el protocolo y hay que
    // enterarse, no adivinar.
    if (!/^[A-Za-z0-9_-]+$/.test(texto)) return null;
    // Longitud imposible: 4n+1 no corresponde a ningún número entero de bytes.
    if (texto.length % 4 === 1) return null;

    const relleno = texto.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - texto.length % 4) % 4);
    let binario;
    try {
        binario = atob(relleno);
    } catch {
        return null;
    }
    const out = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) out[i] = binario.charCodeAt(i);

    // Ida y vuelta: `atob` acepta bits sobrantes en el último carácter, así que
    // dos cadenas distintas pueden dar los mismos bytes. Aquí eso importa —el
    // reto es de un solo uso y se busca por su hash—, así que solo pasa la
    // forma canónica.
    if (encode(out) !== texto) return null;
    return out;
}

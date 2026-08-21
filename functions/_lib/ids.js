// @ts-check

/**
 * Identificadores y secretos opacos (M8-3).
 *
 * Todo id de este servidor son 16 bytes de `crypto.getRandomValues` en
 * base64url, con un prefijo que dice de qué es. Ni autoincrementos —un `id=1`
 * cuenta cuántas cuentas hay y cuándo se creó cada una— ni nada derivado de
 * datos del usuario.
 *
 * 128 bits: la probabilidad de colisión es despreciable incluso con miles de
 * millones de filas, y no hace falta comprobar si el id ya existe antes de
 * insertar —que sería una consulta más en el camino crítico y una condición de
 * carrera de regalo—. La clave primaria lo cazaría de todos modos.
 */

import { encode } from './base64url.js';

/**
 * @param {number} bytes
 * @returns {string}
 */
function aleatorio(bytes) {
    return encode(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** Id de cuenta. Es también el `userHandle` de WebAuthn. */
export const newUserId = () => `u_${aleatorio(16)}`;

/** Id de familia de sesión: sobrevive a las rotaciones (M8-4). */
export const newFamilyId = () => `f_${aleatorio(16)}`;

/**
 * El token de sesión que viaja en la cookie. **32 bytes, no 16**: es el único
 * secreto de este servidor que un atacante puede intentar adivinar sin límite si
 * alguna vez se cae el límite de tasa, así que se le dan 256 bits.
 *
 * En la base se guarda su SHA-256, nunca él. Una lectura de la tabla de sesiones
 * —un volcado, una copia de seguridad mal guardada— no permite entrar en ninguna
 * cuenta.
 */
export const newSessionToken = () => aleatorio(32);

/**
 * Trunca una IP a /24 (IPv4) o /48 (IPv6).
 *
 * Sirve para que el usuario reconozca una sesión que no es suya; la IP completa
 * sería un dato de localización que esta aplicación no necesita guardar, y que
 * habría que declarar.
 *
 * @param {string | null} ip
 * @returns {string | null}
 */
export function truncateIp(ip) {
    if (!ip) return null;
    if (ip.includes(':')) {
        const partes = ip.split(':');
        return `${partes.slice(0, 3).join(':')}::/48`;
    }
    const partes = ip.split('.');
    if (partes.length !== 4) return null;
    return `${partes.slice(0, 3).join('.')}.0/24`;
}

// @ts-check

/**
 * Sesiones: emitir la cookie y reconocerla (M8-3b; la rotación y la revocación
 * llegan en M8-4).
 *
 * ## La cookie
 *
 * `__Host-tl_sid`, `HttpOnly; Secure; SameSite=Strict; Path=/`.
 *
 * El prefijo `__Host-` no es decoración: el navegador **se niega** a aceptar una
 * cookie con ese nombre si lleva `Domain=`, si no lleva `Secure` o si su `Path`
 * no es `/`. Eso cierra la fijación de sesión desde un subdominio comprometido,
 * que es el ataque que una cookie normal no puede impedir: cualquier subdominio
 * puede escribir una cookie para el dominio padre, y sin el prefijo el servidor
 * no puede distinguir la suya de la impuesta.
 *
 * ## En D1, no en KV
 *
 * KV propaga hasta 60 segundos. Eso convertiría «cerrar sesión en todos los
 * dispositivos» en una mentira durante un minuto — justo el minuto que importa.
 *
 * ## El token no se guarda
 *
 * En la base va su SHA-256. Un volcado de la tabla de sesiones no permite entrar
 * en ninguna cuenta. Y por eso no hay KDF lento: un KDF existe para comprarle
 * tiempo a un secreto de ~30 bits que eligió una persona, y aquí son 256 bits de
 * `getRandomValues`.
 */

import { newSessionToken, newFamilyId, truncateIp } from './ids.js';
import { decode } from './base64url.js';
import { sha256Bytes } from './webauthn.js';

export const COOKIE_NAME = '__Host-tl_sid';

/** Vida absoluta: pasado esto se vuelve a autenticar, se use o no. */
export const ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Inactividad: deslizante. Un dispositivo olvidado deja de valer en dos semanas. */
export const IDLE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * SHA-256 del token, que es lo único que se guarda.
 * @param {string} token
 * @returns {Promise<Uint8Array | null>}
 */
export async function tokenHash(token) {
    const bytes = decode(token);
    if (!bytes) return null;
    return sha256Bytes(bytes);
}

/**
 * Abre una sesión y devuelve el token en claro **una sola vez**: es lo que va a
 * la cookie, y no se puede recuperar después.
 *
 * @param {{ db: *, userId: string, credentialId: string | null, ip: string | null, now: number }} entrada
 * @returns {Promise<{ token: string, expiresAt: number }>}
 */
export async function createSession({ db, userId, credentialId, ip, now }) {
    const token = newSessionToken();
    const hash = await tokenHash(token);
    if (!hash) throw new Error('token ilegible recién generado');

    // El vencimiento guardado es el MENOR de los dos límites. Guardar solo el
    // absoluto y calcular la inactividad al leer repartiría la regla entre dos
    // sitios, y el barrido de caducadas se quedaría corto.
    const expiresAt = now + Math.min(ABSOLUTE_TTL_MS, IDLE_TTL_MS);

    await db.prepare(`INSERT INTO sessions
            (token_hash, user_id, credential_id, family_id, created_at, last_seen_at, expires_at, ip_trunc)
            VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)`)
        .bind(hash, userId, credentialId, newFamilyId(), now, expiresAt, truncateIp(ip))
        .run();

    return { token, expiresAt };
}

/**
 * La cabecera `Set-Cookie` de una sesión recién abierta.
 *
 * `Max-Age` y no `Expires`: `Expires` es una fecha absoluta que el navegador
 * compara con SU reloj, y los relojes de los móviles están mal.
 *
 * @param {string} token
 * @returns {string}
 */
export function sessionCookie(token) {
    const maxAge = Math.floor(Math.min(ABSOLUTE_TTL_MS, IDLE_TTL_MS) / 1000);
    return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

/**
 * La cabecera que BORRA la cookie. `Max-Age=0` y el mismo conjunto de atributos:
 * un navegador solo sustituye una cookie por otra con nombre, dominio y ruta
 * idénticos, así que olvidar `Path=/` aquí deja la sesión viva en el navegador.
 *
 * @returns {string}
 */
export function clearCookie() {
    return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

/**
 * Lee el token de la cabecera `Cookie`.
 *
 * Se parsea a mano y con cuidado: el valor de una cookie puede contener `=`, así
 * que partir por `=` y quedarse con el segundo trozo trunca tokens. Y se compara
 * el nombre EXACTO, no un `startsWith`: `__Host-tl_sid_falsa` no puede colar.
 *
 * @param {Request} request
 * @returns {string | null}
 */
export function readCookie(request) {
    const cabecera = request.headers.get('Cookie');
    if (!cabecera) return null;
    for (const trozo of cabecera.split(';')) {
        const igual = trozo.indexOf('=');
        if (igual === -1) continue;
        if (trozo.slice(0, igual).trim() !== COOKIE_NAME) continue;
        const valor = trozo.slice(igual + 1).trim();
        return valor.length ? valor : null;
    }
    return null;
}

// @ts-check

/**
 * La mecánica de «entrar con Google» (M10).
 *
 * Flujo de **código de autorización con PKCE**, y todo por redirección del
 * navegador: aquí no se carga ni un script de Google. Eso no es una preferencia
 * estética, es lo que permite que `connect-src 'self'` y `script-src 'self'`
 * sigan intactos —la CSP que hace imposible que esta aplicación hable con nadie
 * más— y que quien nunca use Google no pague ninguna relajación.
 *
 * ```
 *   /api/auth/google/start     →  302 a accounts.google.com
 *   accounts.google.com        →  302 a /api/auth/google/callback?code&state
 *   /api/auth/google/callback  →  canjea el código, abre sesión, 302 a /
 * ```
 *
 * ## Qué le pedimos a Google: `openid` y nada más
 *
 * Ni correo, ni nombre, ni foto. Google responde «este es el sujeto 1234» y ya.
 * Pedir el correo habría sido gratis y habría metido un dato personal en una
 * base que hoy no tiene ninguno; y como `openid` no es un permiso sensible, la
 * aplicación tampoco necesita pasar la revisión de Google.
 *
 * ## Las tres defensas, y qué ataca cada una
 *
 * - **`state`**: que alguien te haga completar SU inicio de sesión y acabes
 *   dentro de su cuenta sin saberlo. Se guarda su hash, se gasta una vez.
 * - **PKCE**: que un código interceptado sirva de algo sin el verificador. Con
 *   un cliente confidencial —tenemos secreto— es defensa en profundidad, y por
 *   eso está: no cuesta nada y el día que el secreto se filtre sigue habiendo
 *   algo.
 * - **`nonce`**: que un `id_token` capturado en otro sitio se pueda reutilizar
 *   aquí. Se ata al reto y se comprueba al abrirlo.
 *
 * ## Por qué NO se verifica la firma del `id_token`
 *
 * Porque no llega por el navegador: se pide en una llamada de servidor a
 * servidor contra `oauth2.googleapis.com` sobre TLS, autenticada con nuestro
 * secreto. Lo dice la propia documentación de Google: un `id_token` obtenido
 * directamente por ese canal no necesita validación de firma. Verificarla
 * obligaría a traerse el JWKS, elegir la clave por `kid` y hacer RSA a mano, o
 * sea más código criptográfico propio para no ganar nada.
 *
 * Lo que sí se comprueba —y es barato— es `iss`, `aud`, `exp` y el `nonce`: no
 * protegen contra una firma falsa, protegen contra una configuración mal puesta,
 * que es el fallo que de verdad ocurre.
 */

/** El endpoint de autorización. Aquí es donde se manda al navegador. */
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

/** El de canje del código. Este se llama de servidor a servidor. */
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Los emisores que Google usa. Los dos son legítimos y hay que aceptar ambos. */
const ISSUERS = Object.freeze(['https://accounts.google.com', 'accounts.google.com']);

/** Lo único que se le pide. Ver la cabecera. */
const SCOPE = 'openid';

/** Cuánto vale un intento de entrada antes de caducar. */
export const OAUTH_TTL_MS = 10 * 60 * 1000;

/** La ruta de vuelta, derivada del origen: así localhost funciona igual. */
export const redirectUri = (/** @type {string} */ origin) => `${origin}/api/auth/google/callback`;

/**
 * Bytes aleatorios en base64url, que es el alfabeto que aceptan `state`,
 * `nonce` y el verificador de PKCE.
 *
 * @param {number} bytes
 * @returns {string}
 */
export function randomToken(bytes = 32) {
    const b = crypto.getRandomValues(new Uint8Array(bytes));
    let bin = '';
    for (const x of b) bin += String.fromCharCode(x);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * El `code_challenge` de PKCE: SHA-256 del verificador, en base64url.
 *
 * @param {string} verifier
 * @returns {Promise<string>}
 */
export async function codeChallenge(verifier) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    let bin = '';
    for (const x of d) bin += String.fromCharCode(x);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * La URL a la que se manda al navegador.
 *
 * `prompt=select_account` a propósito: sin él, quien tenga una sola sesión de
 * Google abierta entra sin ver nada, y en un ordenador compartido eso significa
 * acabar en la cuenta de otro sin haber elegido.
 *
 * @param {{ clientId: string, origin: string, state: string, nonce: string, challenge: string }} p
 * @returns {string}
 */
export function authorizeUrl({ clientId, origin, state, nonce, challenge }) {
    const u = new URL(AUTH_URL);
    u.searchParams.set('client_id', clientId);
    u.searchParams.set('redirect_uri', redirectUri(origin));
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', SCOPE);
    u.searchParams.set('state', state);
    u.searchParams.set('nonce', nonce);
    u.searchParams.set('code_challenge', challenge);
    u.searchParams.set('code_challenge_method', 'S256');
    u.searchParams.set('prompt', 'select_account');
    return u.toString();
}

/**
 * Canjea el código por el `id_token`. Servidor a servidor, con el secreto.
 *
 * @param {{ code: string, verifier: string, clientId: string, clientSecret: string, origin: string, fetchImpl?: typeof fetch }} p
 * @returns {Promise<{ ok: true, idToken: string } | { ok: false, error: string }>}
 */
export async function exchangeCode({ code, verifier, clientId, clientSecret, origin, fetchImpl = fetch }) {
    const cuerpo = new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri(origin),
        grant_type: 'authorization_code',
        code_verifier: verifier
    });

    let respuesta;
    try {
        respuesta = await fetchImpl(TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: cuerpo.toString()
        });
    } catch {
        return { ok: false, error: 'google.unreachable' };
    }
    if (!respuesta.ok) return { ok: false, error: 'google.exchangeFailed' };

    let datos;
    try {
        datos = await respuesta.json();
    } catch {
        return { ok: false, error: 'google.badResponse' };
    }
    const idToken = /** @type {*} */ (datos)?.id_token;
    if (typeof idToken !== 'string' || idToken === '') return { ok: false, error: 'google.noIdToken' };
    return { ok: true, idToken };
}

/**
 * Abre el `id_token` y comprueba lo que se puede comprobar.
 *
 * **No verifica la firma**, y la cabecera de este módulo explica por qué. Lo que
 * sí mira —emisor, destinatario, caducidad y `nonce`— no protege contra una
 * firma falsa: protege contra una configuración mal puesta, que es el fallo que
 * de verdad ocurre. Un `aud` que no cuadra significa que el token es de OTRA
 * aplicación, y aceptarlo sería dejar entrar a cualquiera que tenga un cliente
 * de Google.
 *
 * @param {{ idToken: string, clientId: string, nonce: string, now: number }} p
 * @returns {{ ok: true, subject: string } | { ok: false, error: string }}
 */
export function readIdToken({ idToken, clientId, nonce, now }) {
    const partes = idToken.split('.');
    if (partes.length !== 3) return { ok: false, error: 'google.badIdToken' };

    let claims;
    try {
        const relleno = partes[1].replace(/-/g, '+').replace(/_/g, '/');
        claims = JSON.parse(atob(relleno + '='.repeat((4 - relleno.length % 4) % 4)));
    } catch {
        return { ok: false, error: 'google.badIdToken' };
    }

    if (!ISSUERS.includes(claims?.iss)) return { ok: false, error: 'google.badIssuer' };
    if (claims?.aud !== clientId) return { ok: false, error: 'google.badAudience' };
    if (claims?.nonce !== nonce) return { ok: false, error: 'google.badNonce' };

    // `exp` viene en SEGUNDOS. Compararlo con milisegundos daría siempre por
    // caducado —o nunca—, según el lado en que esté el error.
    const exp = Number(claims?.exp);
    if (!Number.isFinite(exp) || exp * 1000 <= now) return { ok: false, error: 'google.expired' };

    const subject = claims?.sub;
    if (typeof subject !== 'string' || subject === '' || subject.length > 255) {
        return { ok: false, error: 'google.noSubject' };
    }
    return { ok: true, subject };
}

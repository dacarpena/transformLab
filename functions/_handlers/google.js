// @ts-check

/**
 * Entrar con Google (M10).
 *
 * Dos rutas y las dos son NAVEGACIONES del navegador, no peticiones de la
 * aplicación. Eso es lo que permite que no se cargue ni un script de Google y
 * que la CSP siga sin tocarse: quien nunca use Google no paga ninguna
 * relajación.
 *
 * ## Lo que Google puede hacer aquí, y lo que no
 *
 * Puede decir quién eres. **No puede descifrar nada**: la clave de datos se
 * genera en el dispositivo y no sale de él. Una cuenta creada con Google sigue
 * necesitando su clave de recuperación para leerse en un dispositivo nuevo, y
 * por eso el cliente lleva al kit inmediatamente después de darse de alta. Con
 * passkeys el kit es una de dos salidas; aquí es la única, y decirlo claro es
 * parte del trabajo.
 *
 * ## El reto vive en `challenges`, con su carga
 *
 * `state` es el hash de la fila; el verificador de PKCE y el `nonce` van en
 * `payload`. Es exactamente lo que esa tabla ya es —un secreto de un solo uso
 * que caduca y que alguien barre— y por eso no hay tabla nueva.
 *
 * ## Los errores vuelven a la aplicación, no a una página en blanco
 *
 * Un fallo aquí le ocurre a alguien que está mirando el navegador, no a un
 * `fetch`. Devolver un JSON con un código dejaría a esa persona delante de
 * `{"error":"google.badState"}`, así que se redirige a la aplicación con el
 * código en el fragmento —`#auth=error&code=…`—, que **no viaja al servidor** y
 * no queda en ningún registro intermedio.
 */

import { fail, redirect } from '../_lib/http.js';
import { line } from '../_lib/log.js';
import { newUserId } from '../_lib/ids.js';
import { sessionCookie } from '../_lib/sessions.js';
import {
    createChallenge, consumeChallenge, findFederated, createAccountFederated,
    touchFederated, openSession
} from '../_lib/db.js';
import {
    authorizeUrl, codeChallenge, randomToken, exchangeCode, readIdToken, OAUTH_TTL_MS
} from '../_lib/google.js';

const PROVIDER = 'google';

/** El hash con el que se guarda el `state`: en la base nunca está en claro. */
const hashDe = async (/** @type {string} */ texto) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));

/** La IP para el techo por IP. La misma cabecera que el resto de `/api/auth/`. */
const ipDe = (/** @type {Request} */ request) => request.headers.get('CF-Connecting-IP');

/**
 * Una redirección a la aplicación con el resultado en el FRAGMENTO.
 *
 * En el fragmento y no en la cadena de consulta: lo que va tras `#` no se manda
 * al servidor, así que no acaba en los registros de nadie —ni en los de un
 * intermediario— y no se queda pegado en un enlace compartido.
 *
 * @param {string} origin
 * @param {string} fragmento
 */
const volver = (origin, fragmento) => redirect(`${origin}/#${fragmento}`);

/**
 * `GET /api/auth/google/start` — manda el navegador a Google.
 *
 * @param {EventContext} ctx
 */
export async function start(ctx) {
    const clientId = ctx.env.GOOGLE_CLIENT_ID;
    if (!clientId) return fail(503, 'google.notConfigured');

    const origin = new URL(ctx.request.url).origin;
    const state = randomToken();
    const nonce = randomToken();
    const verifier = randomToken(48);

    // El mismo techo por IP que el resto de `/api/auth/*`: es una escritura sin
    // autenticar, o sea una puerta por la que hacer crecer la base sin cuenta.
    const emitido = await createChallenge(ctx.env, {
        hash: await hashDe(state),
        purpose: PROVIDER,
        userId: null,
        pendingUserId: null,
        ip: ipDe(ctx.request),
        payload: JSON.stringify({ v: verifier, n: nonce }),
        now: Date.now(),
        ttlMs: OAUTH_TTL_MS
    });
    if (!emitido) return fail(429, 'auth.tooMany');

    return redirect(authorizeUrl({
        clientId, origin, state, nonce, challenge: await codeChallenge(verifier)
    }));
}

/**
 * `GET /api/auth/google/callback` — recoge el código y abre la sesión.
 *
 * @param {EventContext} ctx
 */
export async function callback(ctx) {
    const url = new URL(ctx.request.url);
    const origin = url.origin;
    const ahora = Date.now();

    // Google avisa aquí cuando el usuario cancela. No es un fallo nuestro y no
    // se registra como tal: se vuelve a la aplicación y ya.
    if (url.searchParams.get('error')) return volver(origin, 'auth=cancel');

    const clientId = ctx.env.GOOGLE_CLIENT_ID;
    const clientSecret = ctx.env.GOOGLE_CLIENT_SECRET;
    if (!clientId || !clientSecret) return volver(origin, 'auth=error&code=google.notConfigured');

    const state = url.searchParams.get('state');
    const code = url.searchParams.get('code');
    if (!state || !code) return volver(origin, 'auth=error&code=google.badRequest');

    // El reto se GASTA aquí, de forma atómica: `DELETE … RETURNING`. Con un
    // `SELECT` y un `DELETE` por separado, dos peticiones con el mismo `state`
    // pueden ganar las dos, que es exactamente lo que `state` viene a impedir.
    const reto = await consumeChallenge(ctx.env, {
        hash: await hashDe(state), purpose: PROVIDER, now: ahora
    });
    if (!reto) return volver(origin, 'auth=error&code=google.badState');

    let carga;
    try {
        carga = JSON.parse(reto.payload ?? '{}');
    } catch {
        return volver(origin, 'auth=error&code=google.badState');
    }
    if (typeof carga?.v !== 'string' || typeof carga?.n !== 'string') {
        return volver(origin, 'auth=error&code=google.badState');
    }

    const canje = await exchangeCode({
        code, verifier: carga.v, clientId, clientSecret, origin
    });
    if (!canje.ok) {
        line({ evt: 'google.exchangeFailed', error: canje.error });
        return volver(origin, `auth=error&code=${canje.error}`);
    }

    const leido = readIdToken({
        idToken: canje.idToken, clientId, nonce: carga.n, now: ahora
    });
    if (!leido.ok) {
        line({ evt: 'google.tokenRejected', error: leido.error });
        return volver(origin, `auth=error&code=${leido.error}`);
    }

    // ¿Ya existe esta identidad? Si no, la cuenta nace aquí.
    const existente = await findFederated(ctx.env, { provider: PROVIDER, subject: leido.subject });
    let userId;
    let nueva = false;
    if (existente) {
        userId = existente.user_id;
        await touchFederated(ctx.env, { provider: PROVIDER, subject: leido.subject, now: ahora });
    } else {
        userId = newUserId();
        await createAccountFederated(ctx.env, {
            userId, provider: PROVIDER, subject: leido.subject, now: ahora
        });
        nueva = true;
    }

    const { token } = await openSession(ctx.env, {
        userId, credentialId: null, ip: ipDe(ctx.request), now: ahora
    });

    // `auth=new` frente a `auth=ok` no es cosmético: una cuenta recién creada con
    // Google no tiene NINGUNA vía de vuelta —Google autentica pero no descifra—,
    // y el cliente tiene que llevar al kit de recuperación inmediatamente. Con
    // passkeys el kit es una de dos salidas; aquí es la única.
    return redirect(`${origin}/#auth=${nueva ? 'new' : 'ok'}`, {
        headers: { 'Set-Cookie': sessionCookie(token) }
    });
}

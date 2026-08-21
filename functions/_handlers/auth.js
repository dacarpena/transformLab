// @ts-check

/**
 * Registro y login con passkeys (M8-3b).
 *
 * Cuatro endpoints y ni un dato personal en ninguno. El registro **no pide
 * nada**: ni correo, ni nombre, ni contraseña. El cuerpo de
 * `POST /api/auth/register/start` es `{}`, y esa es la propiedad que hace que
 * este servidor no tenga nada que filtrar.
 *
 * ## El reto, de un solo uso de verdad
 *
 * Se guarda su SHA-256, no él: una lectura de la tabla no permite responder a un
 * reto en vuelo. Y se consume con `DELETE … RETURNING`, que en SQLite es
 * **atómico**: dos peticiones simultáneas con el mismo reto no pueden ganar las
 * dos. Un `SELECT` seguido de un `DELETE` sí dejaría esa ventana, y es
 * exactamente la ventana que un reto de un solo uso existe para cerrar.
 *
 * El reto NO viaja en el cuerpo de la petición de cierre: se saca del
 * `clientDataJSON`, que es lo que el autenticador firmó. Así no hay forma de que
 * el servidor busque un reto distinto del que se firmó.
 *
 * ## Credenciales descubribles: no hay campo «usuario»
 *
 * `residentKey: 'required'` y `allowCredentials: []`. El login no pregunta quién
 * eres —lo dice el autenticador con el `userHandle`—, así que no hay nada que
 * enumerar y no existe el ataque de «¿está esta cuenta registrada?».
 */

import { json, fail, readJson } from '../_lib/http.js';
import {
    verifyRegistration, verifyAssertion, newChallenge, sha256, sha256Bytes,
    fromB64u, CHALLENGE_TTL_MS, ALG_ES256
} from '../_lib/webauthn.js';
import { encode } from '../_lib/base64url.js';
import { newUserId } from '../_lib/ids.js';
import { createSession, sessionCookie } from '../_lib/sessions.js';

/** Cuerpo máximo: una respuesta de WebAuthn son unos pocos KB. */
const MAX_BODY = 8 * 1024;

/** El nombre que ve el usuario en el diálogo del sistema al elegir la passkey. */
const RP_NAME = 'TransformLab';

/* ── Registro ────────────────────────────────────────────────────────────── */

/**
 * `POST /api/auth/register/start`
 * @param {EventContext} ctx
 */
export async function registerStart(ctx) {
    const { origin, rpId } = sitio(ctx.request);
    const ahora = Date.now();
    const reto = newChallenge();
    // El id de la cuenta se decide AQUÍ, antes de firmar: WebAuthn lo hornea
    // dentro de la credencial y es lo que vuelve como `userHandle` en el login.
    const userId = newUserId();

    await ctx.env.DB.prepare(
        `INSERT INTO challenges (hash, purpose, user_id, pending_user_id, created_at, expires_at)
         VALUES (?1, 'register', NULL, ?2, ?3, ?4)`)
        .bind(await sha256Bytes(reto), userId, ahora, ahora + CHALLENGE_TTL_MS).run();

    return json({
        challenge: encode(reto),
        rp: { id: rpId, name: RP_NAME },
        // `name` y `displayName` son obligatorios en la API del navegador y los
        // enseña el diálogo del sistema. Se manda el nombre de la aplicación, no
        // nada de la persona: no lo sabemos y no queremos saberlo.
        user: { id: userId, name: RP_NAME, displayName: RP_NAME },
        pubKeyCredParams: [{ type: 'public-key', alg: ALG_ES256 }],
        authenticatorSelection: {
            residentKey: 'required',
            requireResidentKey: true,
            userVerification: 'preferred'
        },
        attestation: 'none',
        timeout: CHALLENGE_TTL_MS,
        origin
    });
}

/**
 * `POST /api/auth/register/finish`
 * @param {EventContext} ctx
 */
export async function registerFinish(ctx) {
    const cuerpo = await readJson(ctx.request, MAX_BODY);
    if (!cuerpo.ok) return fail(400, cuerpo.error);
    const b = /** @type {*} */ (cuerpo.value);
    if (b === null || typeof b !== 'object') return fail(400, 'body.notObject');

    const campos = decodificar(b, /** @type {const} */ (['clientDataJSON', 'authenticatorData', 'publicKeySpki']));
    if (!campos) return fail(400, 'body.malformed');
    if (typeof b.id !== 'string' || !fromB64u(b.id)) return fail(400, 'body.malformed');
    if (typeof b.algorithm !== 'number') return fail(400, 'body.malformed');

    const reto = await consumirReto(ctx.env.DB, campos.clientDataJSON, 'register');
    if (!reto.ok) return fail(400, reto.error);

    const { origin, rpId } = sitio(ctx.request);
    const veredicto = await verifyRegistration(
        { ...campos, algorithm: b.algorithm },
        { challenge: reto.value.challenge, origin, rpIdHash: await sha256(rpId) });
    if (!veredicto.ok) return fail(400, veredicto.error);

    const userId = reto.value.pendingUserId;
    if (!userId) return fail(400, 'challenge.noPendingUser');

    const ahora = Date.now();
    // En un LOTE: si la credencial no entra, la cuenta tampoco. Una cuenta sin
    // credencial es una cuenta en la que nadie puede entrar nunca — y que el
    // usuario no puede volver a crear, porque ya está el id ocupado.
    await ctx.env.DB.batch([
        ctx.env.DB.prepare('INSERT INTO users (id, created_at) VALUES (?1, ?2)').bind(userId, ahora),
        ctx.env.DB.prepare(
            `INSERT INTO credentials (id, user_id, public_key, algorithm, sign_count, created_at, last_used_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`)
            .bind(b.id, userId, campos.publicKeySpki, b.algorithm, veredicto.value.signCount, ahora)
    ]);

    const sesion = await createSession({
        db: ctx.env.DB, userId, credentialId: b.id, ip: ipDe(ctx.request), now: ahora
    });

    // `protected: false` no es cosmético: es la REGLA DURA. Hasta que el usuario
    // guarde el kit de recuperación o dé de alta una segunda passkey, la cuenta
    // no tiene vía de vuelta y no se sube ni un byte. La interfaz lo usa para no
    // dejar de avisar.
    return json({ userId, protected: false }, { headers: { 'Set-Cookie': sessionCookie(sesion.token) } });
}

/* ── Login ───────────────────────────────────────────────────────────────── */

/**
 * `POST /api/auth/login/start`
 * @param {EventContext} ctx
 */
export async function loginStart(ctx) {
    const { rpId } = sitio(ctx.request);
    const ahora = Date.now();
    const reto = newChallenge();

    await ctx.env.DB.prepare(
        `INSERT INTO challenges (hash, purpose, user_id, pending_user_id, created_at, expires_at)
         VALUES (?1, 'login', NULL, NULL, ?2, ?3)`)
        .bind(await sha256Bytes(reto), ahora, ahora + CHALLENGE_TTL_MS).run();

    return json({
        challenge: encode(reto),
        rpId,
        // VACÍO a propósito: es lo que hace descubrible al login. Rellenarlo
        // obligaría a preguntar antes quién eres, y entonces el servidor tendría
        // que decir si esa cuenta existe.
        allowCredentials: [],
        userVerification: 'preferred',
        timeout: CHALLENGE_TTL_MS
    });
}

/**
 * `POST /api/auth/login/finish`
 * @param {EventContext} ctx
 */
export async function loginFinish(ctx) {
    const cuerpo = await readJson(ctx.request, MAX_BODY);
    if (!cuerpo.ok) return fail(400, cuerpo.error);
    const b = /** @type {*} */ (cuerpo.value);
    if (b === null || typeof b !== 'object') return fail(400, 'body.notObject');

    const campos = decodificar(b, /** @type {const} */ (['clientDataJSON', 'authenticatorData', 'signature']));
    if (!campos) return fail(400, 'body.malformed');
    if (typeof b.id !== 'string' || !fromB64u(b.id)) return fail(400, 'body.malformed');

    const reto = await consumirReto(ctx.env.DB, campos.clientDataJSON, 'login');
    if (!reto.ok) return fail(400, reto.error);

    const credencial = /** @type {*} */ (await ctx.env.DB
        .prepare('SELECT id, user_id, public_key, sign_count FROM credentials WHERE id = ?1')
        .bind(b.id).first());
    // Mismo error que una firma mala, y a propósito: distinguir «esa credencial
    // no existe» de «esa firma no vale» convertiría este endpoint en un oráculo
    // de qué credenciales están registradas.
    if (!credencial) return fail(401, 'auth.failed');

    const { origin, rpId } = sitio(ctx.request);
    const veredicto = await verifyAssertion(
        campos,
        { publicKeySpki: new Uint8Array(credencial.public_key), storedSignCount: credencial.sign_count },
        { challenge: reto.value.challenge, origin, rpIdHash: await sha256(rpId) });
    if (!veredicto.ok) return fail(401, 'auth.failed');

    const ahora = Date.now();
    await ctx.env.DB.prepare('UPDATE credentials SET sign_count = ?1, last_used_at = ?2 WHERE id = ?3')
        .bind(veredicto.value.signCount, ahora, credencial.id).run();

    const sesion = await createSession({
        db: ctx.env.DB, userId: credencial.user_id, credentialId: credencial.id,
        ip: ipDe(ctx.request), now: ahora
    });

    const usuario = /** @type {*} */ (await ctx.env.DB
        .prepare('SELECT protected_at FROM users WHERE id = ?1').bind(credencial.user_id).first());

    return json(
        { userId: credencial.user_id, protected: Boolean(usuario?.protected_at) },
        { headers: { 'Set-Cookie': sessionCookie(sesion.token) } });
}

/* ── Piezas compartidas ──────────────────────────────────────────────────── */

/**
 * El origen y el `rpId` salen de la URL de la petición, no de una constante.
 *
 * Así no hay una lista de entornos que mantener —producción, previsualización de
 * Pages, desarrollo— y no puede quedarse desfasada. Y no es un agujero: la
 * petición llega al servidor porque ese host apunta a este servidor.
 *
 * UN AVISO PARA DESARROLLO: por una IP —`http://127.0.0.1:8788`— el `rpId`
 * saldría «127.0.0.1», y WebAuthn no acepta una IP como `rpId`; el navegador
 * rechaza la llamada antes de que llegue aquí. Hay que entrar por
 * `http://localhost:8788`, que sí es un nombre y además cuenta como contexto
 * seguro sin certificado.
 *
 * @param {Request} request
 */
function sitio(request) {
    const url = new URL(request.url);
    return { origin: url.origin, rpId: url.hostname };
}

/** La IP del cliente, según Cloudflare. */
const ipDe = (/** @type {Request} */ request) => request.headers.get('CF-Connecting-IP');

/**
 * Decodifica los campos base64url que se esperan. Devuelve `null` si falta uno o
 * si alguno no es base64url válido: se falla entero, sin campos a medias.
 *
 * @template {string} K
 * @param {Record<string, unknown>} cuerpo
 * @param {readonly K[]} nombres
 * @returns {Record<K, Uint8Array> | null}
 */
function decodificar(cuerpo, nombres) {
    const out = /** @type {Record<K, Uint8Array>} */ ({});
    for (const n of nombres) {
        const bytes = fromB64u(cuerpo[n]);
        if (!bytes) return null;
        out[n] = bytes;
    }
    return out;
}

/**
 * Saca el reto del `clientDataJSON` firmado y lo GASTA, atómicamente.
 *
 * Dos decisiones dentro:
 *
 * 1. El reto se lee de lo que se firmó, no de un campo aparte del cuerpo. Si
 *    viniera aparte, el cliente podría hacer que el servidor buscase un reto
 *    distinto del que el autenticador firmó.
 * 2. `DELETE … RETURNING` en vez de `SELECT` y luego `DELETE`. En SQLite es
 *    atómico, así que dos peticiones simultáneas con el mismo reto no pueden
 *    ganar las dos. Con las dos sentencias por separado esa ventana existe, y es
 *    justo la que un reto de un solo uso está para cerrar.
 *
 * @param {*} db
 * @param {Uint8Array} clientDataJSON
 * @param {'register' | 'login' | 'add-credential'} purpose
 * @returns {Promise<{ ok: true, value: { challenge: Uint8Array, pendingUserId: string | null, userId: string | null } } | { ok: false, error: string }>}
 */
async function consumirReto(db, clientDataJSON, purpose) {
    let datos;
    try {
        datos = JSON.parse(new TextDecoder().decode(clientDataJSON));
    } catch {
        return { ok: false, error: 'clientData.notJson' };
    }
    const reto = fromB64u(datos?.challenge);
    if (!reto) return { ok: false, error: 'clientData.noChallenge' };

    const fila = /** @type {*} */ (await db.prepare(
        `DELETE FROM challenges
          WHERE hash = ?1 AND purpose = ?2 AND expires_at > ?3
      RETURNING pending_user_id, user_id`)
        .bind(await sha256Bytes(reto), purpose, Date.now()).first());

    // Un reto desconocido, caducado, de otro propósito o ya gastado: el mismo
    // error para los cuatro. Cuál de ellos fue solo le sirve a quien está
    // probando la puerta.
    if (!fila) return { ok: false, error: 'challenge.invalid' };

    return { ok: true, value: { challenge: reto, pendingUserId: fila.pending_user_id, userId: fila.user_id } };
}

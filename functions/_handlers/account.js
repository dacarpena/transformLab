// @ts-check

/**
 * La cuenta: llaves, dispositivos y la regla dura (M8-5b).
 *
 * ## La regla dura, y por qué está aquí y no en la interfaz
 *
 * Con cifrado extremo a extremo, **subir datos antes de que haya vía de vuelta
 * es fabricar una pérdida irreversible**: el día que se rompa el único
 * dispositivo, lo que hay en el servidor es ruido para todo el mundo, nosotros
 * incluidos. Por eso una cuenta no se considera protegida hasta que el usuario
 * ha guardado el kit de recuperación o ha dado de alta una segunda passkey, y
 * hasta entonces no se sincroniza nada.
 *
 * El estado vive en `users.protected_at`, lo escribe el SERVIDOR y la condición
 * va dentro del SQL. Dejarlo en el cliente sería dejar la única salvaguarda de
 * un dato irrecuperable en manos de una bandera que un `localStorage.clear()`
 * borra.
 *
 * ## Lo que el servidor ve de todo esto
 *
 * Bytes. `wrapped_dk_recovery` es la DK cifrada con una clave derivada de un
 * código que solo tiene el usuario; `wrapped_dk` lo mismo con el PRF del
 * autenticador. El servidor los guarda y los devuelve, y no puede abrir ninguno.
 */

import { json, fail, readJson } from '../_lib/http.js';
import { fromB64u } from '../_lib/webauthn.js';
import { encode } from '../_lib/base64url.js';

/** Cuerpo máximo: dos sobres de 60 bytes y sus sales. */
const MAX_BODY = 4 * 1024;

/** Tope de un sobre. 32 bytes de clave + versión + IV + tag caben de sobra. */
const MAX_WRAPPED = 128;

/** @param {EventContext} ctx */
const alcance = (ctx) => /** @type {import('../_lib/db.js').Scope} */ (ctx.data.scope);

/**
 * `GET /api/account` — dispositivos, sesiones y estado de protección.
 *
 * @param {EventContext} ctx
 */
export async function overview(ctx) {
    const scope = alcance(ctx);
    const usuario = await scope.user();
    if (!usuario) return fail(404, 'account.gone');

    const credenciales = await scope.credentials();
    return json({
        userId: scope.userId,
        createdAt: usuario.created_at,
        protected: Boolean(usuario.protected_at),
        hasRecoveryKit: Boolean(usuario.wrapped_dk_recovery),
        // `label` va cifrada con la DK: es dato del usuario, y el servidor no
        // lee datos del usuario. La descifra el cliente.
        credentials: credenciales.map((/** @type {*} */ c) => ({
            id: c.id,
            labelCt: c.label_ct ? encode(c.label_ct) : null,
            createdAt: c.created_at,
            lastUsedAt: c.last_used_at,
            // Cuál es la de ESTA sesión, para no ofrecer «cerrar» sobre la
            // propia sin avisar.
            current: c.id === ctx.data.credentialId
        })),
        sessions: (await scope.sessions()).map((/** @type {*} */ s) => ({
            familyId: s.family_id, createdAt: s.created_at,
            lastSeenAt: s.last_seen_at, ipTrunc: s.ip_trunc
        }))
    });
}

/**
 * `GET /api/account/keys` — los sobres que hacen falta para abrir la DK.
 *
 * Solo criptogramas y sales. Se puede devolver sin miedo porque el servidor no
 * tiene ninguna de las claves que los abren; y hace falta devolverlo porque un
 * dispositivo nuevo llega sin nada más que la passkey.
 *
 * @param {EventContext} ctx
 */
export async function keys(ctx) {
    const { usuario, credenciales } = await alcance(ctx).keyMaterial();
    if (!usuario) return fail(404, 'account.gone');

    return json({
        recovery: usuario.wrapped_dk_recovery
            ? { wrapped: encode(usuario.wrapped_dk_recovery), salt: encode(usuario.recovery_salt) }
            : null,
        devices: credenciales.map((/** @type {*} */ c) => ({
            credentialId: c.id,
            wrapped: encode(c.wrapped_dk),
            prfSalt: c.prf_salt ? encode(c.prf_salt) : null
        }))
    });
}

/**
 * `POST /api/account/keys` — guarda el kit de recuperación y, si el
 * autenticador da PRF, el sobre de este dispositivo.
 *
 * Guardar el kit **marca la cuenta como protegida**, y las dos cosas van en la
 * misma sentencia: una cuenta marcada como protegida sin sobre guardado sería
 * una mentira con consecuencias irreversibles.
 *
 * @param {EventContext} ctx
 */
export async function saveKeys(ctx) {
    const cuerpo = await readJson(ctx.request, MAX_BODY);
    if (!cuerpo.ok) return fail(400, cuerpo.error);
    const b = /** @type {*} */ (cuerpo.value);
    if (b === null || typeof b !== 'object') return fail(400, 'body.notObject');

    const scope = alcance(ctx);
    const ahora = Date.now();
    let hecho = false;

    if (b.recovery !== undefined) {
        const wrapped = sobre(b.recovery?.wrapped);
        const salt = sobre(b.recovery?.salt);
        if (!wrapped || !salt) return fail(400, 'body.malformed');
        await scope.saveRecoveryKit({ wrapped, salt, now: ahora });
        hecho = true;
    }

    if (b.device !== undefined) {
        const wrapped = sobre(b.device?.wrapped);
        const prfSalt = sobre(b.device?.prfSalt);
        if (!wrapped || !prfSalt || typeof b.device?.credentialId !== 'string') {
            return fail(400, 'body.malformed');
        }
        // Si el id no es de esta cuenta, no cambia nada: la sentencia lleva
        // `user_id = ?1`. Se responde 404 en vez de fingir que se guardó.
        const ok = await scope.setCredentialWrapper({
            credentialId: b.device.credentialId, wrapped, prfSalt
        });
        if (!ok) return fail(404, 'credential.notFound');
        hecho = true;
    }

    if (!hecho) return fail(400, 'body.empty');

    const usuario = await scope.user();
    return json({ protected: Boolean(usuario?.protected_at) });
}

/**
 * `DELETE /api/account/credentials/:id` — da de baja una passkey.
 *
 * No se puede quitar la última: quedarse sin credenciales es quedarse fuera de
 * la cuenta para siempre. La condición vive en el SQL y no en un `if` previo,
 * porque entre la comprobación y el borrado cabe otra petición.
 *
 * @param {EventContext & { params: Record<string, string> }} ctx
 */
export async function removeCredential(ctx) {
    const scope = alcance(ctx);
    const ok = await scope.removeCredential(ctx.params.id);
    if (!ok) {
        // Dos motivos: no es de esta cuenta, o es la última. Se distinguen
        // porque aquí SÍ importa: el usuario tiene que saber por qué no puede.
        const cuantas = (await scope.credentials()).length;
        return fail(cuantas <= 1 ? 409 : 404, cuantas <= 1 ? 'credential.last' : 'credential.notFound');
    }

    // Al bajar de dos dispositivos, la cuenta puede dejar de estar protegida por
    // esa vía. Si hay kit guardado sigue estándolo, y `protected_at` no se toca:
    // `saveRecoveryKit` lo fijó con `COALESCE`, así que solo se pone una vez.
    return json({ ok: true, remaining: (await scope.credentials()).length });
}

/**
 * Decodifica un sobre en base64url y comprueba su tamaño.
 *
 * El tope importa: sin él, el servidor guardaría lo que le manden en una columna
 * que solo debería tener sesenta bytes, y eso es almacenamiento gratis para
 * cualquiera con una cuenta.
 *
 * @param {unknown} valor
 * @returns {Uint8Array | null}
 */
function sobre(valor) {
    const bytes = fromB64u(valor);
    if (!bytes || bytes.length === 0 || bytes.length > MAX_WRAPPED) return null;
    return bytes;
}

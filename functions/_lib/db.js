// @ts-check

/**
 * **TODO el SQL de este servidor.** No hay ni una sentencia fuera de aquí (M8-4).
 *
 * ## La pieza estructural: autorización por fila imposible de olvidar
 *
 * El fallo clásico de un servidor multiusuario no es una consulta mal escrita:
 * es una consulta a la que se le olvidó el `WHERE user_id`. Pasa las revisiones
 * porque *parece* bien, funciona en desarrollo —donde solo hay una cuenta—, y en
 * producción devuelve los datos de otra persona.
 *
 * Aquí eso no se resuelve con una convención ni con una revisión: **un manejador
 * no tiene físicamente un `D1Database`**. Lo que el middleware le deja en
 * `ctx.data.scope` es un `Scope` que lleva el `userId` cerrado dentro, y cuyos
 * métodos **no aceptan ningún `userId`**. No hay dónde agarrarse para escribir
 * una consulta sin acotar.
 *
 * Y por si alguien añadiera un método aquí dentro, `scoped()` comprueba **en
 * tiempo de ejecución** que la sentencia contiene la cláusula. Una guarda
 * estática mira el texto; ésta mira lo que se ejecuta.
 *
 * ## Lo que SÍ es global, y por qué
 *
 * Las funciones de autenticación no pueden estar acotadas: se ejecutan *antes*
 * de saber quién es nadie. Están todas juntas abajo, cada una con su porqué, y
 * son las únicas exportaciones de este módulo que no pasan por `Scope`. Un test
 * comprueba que esa lista no crece sin que alguien lo escriba.
 */

import { ABSOLUTE_TTL_MS, IDLE_TTL_MS, tokenHash } from './sessions.js';
import { newSessionToken, newFamilyId, truncateIp } from './ids.js';

/**
 * Cada cuánto se rota el token de sesión. Una hora: bastante para no rotar en
 * cada petición —cada rotación es una escritura— y poco para que una copia
 * robada tenga una vida corta.
 */
export const ROTATE_AFTER_MS = 60 * 60 * 1000;

/**
 * Ventana de gracia para un token ya rotado.
 *
 * Sin ella, perder la respuesta que traía la cookie nueva —una pestaña que se
 * cierra, un túnel que se corta, dos peticiones en paralelo— cerraría la sesión
 * del usuario y, peor, la marcaría como robo. Con ella, el token viejo sigue
 * valiendo un minuto; pasado ese minuto, presentarlo significa que alguien tiene
 * una copia.
 */
export const ROTATION_GRACE_MS = 60 * 1000;

/**
 * La aduana: toda sentencia de `Scope` tiene que estar acotada al usuario.
 *
 * Se comprueba al EJECUTAR, no al revisar. Es lo que convierte «acuérdate de
 * poner el WHERE» en «no se puede olvidar».
 *
 * Se exporta ÚNICAMENTE para poder probarla con las consultas defectuosas que
 * tiene que rechazar. No debilita nada —es una función pura sobre una cadena, no
 * da acceso a la base— y a cambio convierte «el código de la guarda menciona
 * user_id» en «la guarda rechaza esto, y aquí está el esto».
 *
 * @param {string} sql
 * @returns {string}
 */
export function scoped(sql) {
    // La tabla `users` se acota por su clave primaria, que se llama `id`; todas
    // las demás, por `user_id`. En ambos casos el parámetro es SIEMPRE `?1`, que
    // es el que `Scope` rellena con el usuario de la sesión.
    const esUsers = /\b(?:FROM|INTO|UPDATE)\s+users\b/i.test(sql);

    // Un INSERT ... VALUES no tiene WHERE donde acotar, así que se acota por
    // dónde va el usuario: primera columna de la lista y primer parámetro de los
    // valores. Es la única forma de escribir una fila nueva de un usuario, y
    // sigue siendo imposible de olvidar — un INSERT que ponga otra cosa en la
    // primera columna, o que ate ahí un `?2`, no llega a ejecutarse.
    const insertaAcotado =
        /^\s*INSERT\s+INTO\s+\w+\s*\(\s*user_id\b[^)]*\)\s*VALUES\s*\(\s*\?1\b/i.test(sql);

    // Y un `SET user_id = …` deshace todo lo anterior: acotar la lectura no
    // sirve de nada si la escritura puede mudar la fila a otra cuenta.
    //
    // Se mira SOLO la lista de asignaciones —de `SET` hasta `WHERE`, `RETURNING`
    // o el final—, no la sentencia entera. La primera versión de esta guarda
    // miraba todo lo que hubiera detrás de `SET`, y así el `WHERE user_id = ?1`
    // que ES el acotamiento se leía como una reasignación: rechazaba cuatro
    // consultas legítimas de la cuenta.
    for (const trozo of sql.split(/\bSET\b/i).slice(1)) {
        const asignaciones = trozo.split(/\b(?:WHERE|RETURNING)\b/i)[0];
        if (/\buser_id\s*=/i.test(asignaciones)) {
            throw new Error(`una consulta no puede reasignar user_id: ${sql.replace(/\s+/g, ' ').trim().slice(0, 80)}`);
        }
    }

    const acotada = esUsers
        ? /\bid\s*=\s*\?1\b/.test(sql)
        : (/\buser_id\s*=\s*\?1\b/.test(sql) || insertaAcotado);
    if (!acotada) {
        throw new Error(`consulta sin acotar al usuario: ${sql.replace(/\s+/g, ' ').trim().slice(0, 80)}`);
    }
    return sql;
}

/**
 * Copia la versión que va a perder, si la hay.
 *
 * `rev > ?5` es la detección del conflicto y la condición de la copia a la vez:
 * si lo guardado va por delante de la revisión sobre la que el cliente editó, es
 * que alguien escribió entremedias. Cuando no hay conflicto, esta sentencia
 * inserta cero filas y no cuesta nada.
 *
 * `ON CONFLICT DO NOTHING` hace que reintentar un push no duplique: el mismo
 * `rev` de la misma fila ya está archivado.
 */
const SQL_ARCHIVAR_PERDEDOR = `
    INSERT INTO record_conflicts (user_id, profile_id, collection, item_tag,
                                  ciphertext, rev, updated_at, deleted, detected_at)
    SELECT user_id, profile_id, collection, item_tag,
           ciphertext, rev, updated_at, deleted, ?5
      FROM records
     WHERE user_id = ?1 AND profile_id = ?2 AND collection = ?3 AND item_tag = ?4
       AND rev > ?6
    ON CONFLICT DO NOTHING
    RETURNING rev`;

/**
 * Escribe la fila.
 *
 * `rev = records.rev + 1` en vez de la revisión que mande el cliente: así la
 * revisión la lleva el servidor y es estrictamente monótona pase lo que pase.
 * Un cliente que mintiera con su `baseRev` no puede hacer que una fila retroceda.
 */
const SQL_ESCRIBIR_FILA = `
    INSERT INTO records (user_id, profile_id, collection, item_tag,
                         ciphertext, rev, seq, updated_at, deleted)
    VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8)
    ON CONFLICT (user_id, profile_id, collection, item_tag) DO UPDATE SET
        ciphertext = excluded.ciphertext,
        rev        = records.rev + 1,
        seq        = excluded.seq,
        updated_at = excluded.updated_at,
        deleted    = excluded.deleted
    RETURNING rev, seq`;

/**
 * Abre el ámbito de un usuario. **Es la única forma de tocar sus datos.**
 *
 * @param {Env} env
 * @param {string} userId
 */
export function openUserScope(env, userId) {
    const db = env.DB;
    /** Prepara una sentencia acotada, con el usuario ya puesto en `?1`. */
    const q = (/** @type {string} */ sql, /** @type {unknown[]} */ ...resto) =>
        db.prepare(scoped(sql)).bind(userId, ...resto);

    return {
        /**
         * El identificador de la cuenta. Se expone para poder registrarlo y para
         * componer claves de R2; no sirve para consultar nada, porque ningún
         * método de aquí acepta un usuario.
         */
        get userId() { return userId; },

        /** La fila de la cuenta, o `null` si ya no existe. */
        async user() {
            return /** @type {*} */ (await q('SELECT * FROM users WHERE id = ?1').first());
        },

        /**
         * Las passkeys de la cuenta. `label_ct` va cifrada: el servidor la
         * devuelve y el cliente la descifra con la DK.
         */
        async credentials() {
            const r = await q(`SELECT id, label_ct, created_at, last_used_at
                                 FROM credentials WHERE user_id = ?1 ORDER BY created_at`).all();
            return /** @type {*[]} */ (r.results);
        },

        /**
         * Da de baja una passkey.
         *
         * Devuelve `false` si es la ÚLTIMA: quedarse sin credenciales es
         * quedarse fuera de la cuenta para siempre, y una acción destructiva no
         * puede ser la respuesta por defecto a un clic (§5 de `CLAUDE.md`, ficha
         * H-013). La condición va en el propio SQL, no en un `if` previo: entre
         * la comprobación y el borrado cabe otra petición.
         *
         * @param {string} credentialId
         */
        async removeCredential(credentialId) {
            const r = await q(`DELETE FROM credentials
                                WHERE user_id = ?1 AND id = ?2
                                  AND (SELECT COUNT(*) FROM credentials WHERE user_id = ?1) > 1`,
                credentialId).run();
            return r.meta.changes === 1;
        },

        /** Las sesiones vivas, para que el usuario pueda ver y cerrar la que no reconozca. */
        async sessions() {
            const r = await q(`SELECT family_id, credential_id, created_at, last_seen_at, expires_at, ip_trunc
                                 FROM sessions WHERE user_id = ?1 ORDER BY last_seen_at DESC`).all();
            return /** @type {*[]} */ (r.results);
        },

        /** Cierra TODAS las sesiones de la cuenta. */
        async revokeAllSessions() {
            return (await q('DELETE FROM sessions WHERE user_id = ?1').run()).meta.changes;
        },

        /**
         * Cierra una familia de sesión concreta —un dispositivo—, con sus
         * rotaciones.
         * @param {string} familyId
         */
        async revokeFamily(familyId) {
            return (await q('DELETE FROM sessions WHERE user_id = ?1 AND family_id = ?2', familyId)
                .run()).meta.changes;
        },

        /**
         * Guarda el envoltorio de recuperación y marca la cuenta como protegida.
         *
         * Las dos cosas a la vez y en una sentencia: `protected_at` es la regla
         * dura —no se sube nada sin vía de vuelta—, y una cuenta marcada como
         * protegida sin envoltorio guardado sería una mentira con consecuencias.
         *
         * @param {{ wrapped: Uint8Array, salt: Uint8Array, now: number }} kit
         */
        async saveRecoveryKit({ wrapped, salt, now }) {
            await q(`UPDATE users
                        SET wrapped_dk_recovery = ?2, recovery_salt = ?3,
                            protected_at = COALESCE(protected_at, ?4)
                      WHERE id = ?1`, wrapped, salt, now).run();
        },

        /**
         * Guarda el envoltorio de la DK para UNA credencial (la extensión PRF
         * del autenticador). El servidor guarda bytes que no puede abrir.
         *
         * La condición `user_id = ?1` en el `WHERE` no es solo la aduana: impide
         * que una sesión escriba el envoltorio de la credencial de otra persona,
         * que sería la forma de sustituirle la clave.
         *
         * @param {{ credentialId: string, wrapped: Uint8Array, prfSalt: Uint8Array }} envoltorio
         */
        async setCredentialWrapper({ credentialId, wrapped, prfSalt }) {
            const r = await q(`UPDATE credentials SET wrapped_dk = ?3, prf_salt = ?4
                                WHERE user_id = ?1 AND id = ?2`, credentialId, wrapped, prfSalt).run();
            return r.meta.changes === 1;
        },

        /**
         * Todo lo que hace falta para abrir la DK en este dispositivo: el sobre
         * de recuperación y los sobres por credencial.
         *
         * Devuelve criptogramas, y por eso puede devolverlos: el servidor no
         * tiene ninguna de las claves que los abren.
         */
        async keyMaterial() {
            const usuario = /** @type {*} */ (await q(
                'SELECT wrapped_dk_recovery, recovery_salt, protected_at FROM users WHERE id = ?1').first());
            const cred = await q(`SELECT id, wrapped_dk, prf_salt FROM credentials
                                   WHERE user_id = ?1 AND wrapped_dk IS NOT NULL`).all();
            return { usuario, credenciales: /** @type {*[]} */ (cred.results) };
        },

        /**
         * Marca la cuenta como protegida porque hay una segunda passkey.
         *
         * La condición vive en el SQL —`>= 2` credenciales— para que no pueda
         * marcarse desde un camino que no la cumpla.
         *
         * @param {number} now
         */
        async markProtectedIfMultiDevice(now) {
            const r = await q(`UPDATE users SET protected_at = ?2
                                WHERE id = ?1 AND protected_at IS NULL
                                  AND (SELECT COUNT(*) FROM credentials WHERE user_id = ?1) >= 2`,
                now).run();
            return r.meta.changes === 1;
        },

        /**
         * El pull incremental: las filas que han cambiado desde `since` (M9-3).
         *
         * Ordenadas por `seq`, que es un contador de la CUENTA. El cliente
         * guarda el último que vio y pide lo que haya después: sin relojes, sin
         * ventanas de tiempo y sin depender de que los dos lados estén en hora.
         *
         * `limit + 1` a propósito: se pide una fila de más para saber si queda
         * cola SIN hacer un `COUNT(*)` aparte, que sobre una tabla grande cuesta
         * lo mismo que la consulta entera.
         *
         * Devuelve las lápidas igual que las filas vivas. Un borrado que no
         * viaja es un borrado que el otro dispositivo deshace en el siguiente
         * push.
         *
         * @param {{ since: number, limit: number }} cursor
         */
        async recordsSince({ since, limit }) {
            const r = await q(`SELECT profile_id, collection, item_tag, ciphertext, rev, seq,
                                      updated_at, deleted
                                 FROM records
                                WHERE user_id = ?1 AND seq > ?2
                             ORDER BY seq
                                LIMIT ?3`, since, limit + 1).all();
            const filas = /** @type {*[]} */ (r.results);
            const hayMas = filas.length > limit;
            return { rows: hayMas ? filas.slice(0, limit) : filas, hasMore: hayMas };
        },

        /** El `seq` más alto que ha usado esta cuenta. */
        async lastSeq() {
            const u = /** @type {*} */ (await q('SELECT last_seq FROM users WHERE id = ?1').first());
            return u?.last_seq ?? 0;
        },

        /**
         * Escribe un lote de filas (M9-4). Devuelve la revisión resultante de
         * cada una y cuántas provocaron conflicto.
         *
         * ## Todo esto ocurre en UNA transacción, y por una razón
         *
         * Detectar el conflicto y sobrescribir al perdedor son dos operaciones
         * sobre la misma fila. Hechas por separado —leer, decidir, escribir—
         * cabe entre medias el push del otro dispositivo, y entonces se copia a
         * `record_conflicts` una versión que ya no es la que se va a pisar: se
         * archiva la equivocada y se pierde la buena. Por eso la copia del
         * perdedor es una sentencia SQL con su propio `WHERE rev > baseRev`, y
         * viaja en el mismo `batch` que el upsert.
         *
         * ## El bloque de `seq` se reserva antes
         *
         * `UPDATE … last_seq = last_seq + n RETURNING` da n números de una vez y
         * de forma atómica. Pedirlos uno a uno haría n viajes y dejaría huecos
         * si el lote fallara a la mitad.
         *
         * @param {{ rows: readonly *[], now: number }} lote
         */
        async pushRecords({ rows, now }) {
            if (rows.length === 0) return { results: [], conflicts: 0, lastSeq: await this.lastSeq() };

            // Reserva atómica del bloque de `seq`. Si la cuenta ya no existe
            // —borrada mientras el push viajaba— no hay fila que actualizar y
            // aquí se ve, en vez de escribir filas huérfanas.
            const reserva = /** @type {*} */ (await q(
                'UPDATE users SET last_seq = last_seq + ?2 WHERE id = ?1 RETURNING last_seq',
                rows.length).all());
            const fin = reserva.results?.[0]?.last_seq;
            if (typeof fin !== 'number') return null;
            const base = fin - rows.length;

            /** @type {*[]} */ const sentencias = [];
            rows.forEach((fila, i) => {
                sentencias.push(q(SQL_ARCHIVAR_PERDEDOR,
                    fila.profileId, fila.collection, fila.itemTag, now, fila.baseRev));
                sentencias.push(q(SQL_ESCRIBIR_FILA,
                    fila.profileId, fila.collection, fila.itemTag,
                    fila.ciphertext, base + i + 1, now, fila.deleted ? 1 : 0));
            });

            const salida = /** @type {*[]} */ (await db.batch(sentencias));

            /** @type {*[]} */ const results = [];
            let conflicts = 0;
            rows.forEach((fila, i) => {
                // Las sentencias van en pares: la de archivar y la de escribir.
                // Que la primera devuelva una fila ES la detección del conflicto.
                if ((salida[i * 2]?.results?.length ?? 0) > 0) conflicts += 1;
                const escrita = salida[i * 2 + 1]?.results?.[0];
                results.push({
                    itemTag: fila.itemTag_b64,
                    rev: escrita?.rev ?? null,
                    seq: escrita?.seq ?? null,
                    conflict: (salida[i * 2]?.results?.length ?? 0) > 0
                });
            });

            return { results, conflicts, lastSeq: fin };
        },

        /**
         * Reserva —o devuelve— bytes de la cuota de fotos, atómicamente.
         *
         * `UPDATE … WHERE … AND photo_bytes + ?2 <= ?3` es lo que lo hace
         * atómico: la comprobación y la escritura son la misma sentencia, así
         * que dos subidas simultáneas no pueden pasar las dos por un hueco que
         * solo daba para una. Leer y luego escribir sí lo permitiría, y con
         * fotos de megas eso es cuota real que se escapa.
         *
         * `MAX(0, …)` en la devolución: un contador que se va por debajo de cero
         * regala cuota, y de ahí no se vuelve.
         *
         * @param {{ delta: number, limit: number }} peticion
         * @returns {Promise<{ ok: boolean, used: number }>}
         */
        async reservePhotoBytes({ delta, limit }) {
            if (delta >= 0) {
                const r = /** @type {*} */ (await q(
                    `UPDATE users SET photo_bytes = photo_bytes + ?2
                      WHERE id = ?1 AND photo_bytes + ?2 <= ?3
                  RETURNING photo_bytes`, delta, limit).all());
                const fila = r.results?.[0];
                if (fila) return { ok: true, used: fila.photo_bytes };
                return { ok: false, used: await this.photoBytes() };
            }
            const r = /** @type {*} */ (await q(
                `UPDATE users SET photo_bytes = MAX(0, photo_bytes + ?2)
                  WHERE id = ?1
              RETURNING photo_bytes`, delta).all());
            return { ok: true, used: r.results?.[0]?.photo_bytes ?? 0 };
        },

        /** Cuánto ocupan las fotos de esta cuenta, según el contador. */
        async photoBytes() {
            const u = /** @type {*} */ (await q('SELECT photo_bytes FROM users WHERE id = ?1').first());
            return u?.photo_bytes ?? 0;
        },

        /** Cuántas versiones perdedoras hay guardadas. */
        async conflictCount() {
            const r = /** @type {*} */ (await q(
                'SELECT COUNT(*) AS n FROM record_conflicts WHERE user_id = ?1').first());
            return r?.n ?? 0;
        },

        /**
         * Las versiones que perdieron, más recientes primero. Cifradas: el
         * servidor las devuelve tal cual las guardó y no sabe qué hay dentro.
         *
         * @param {{ limit: number }} opciones
         */
        async conflicts({ limit }) {
            const r = await q(`SELECT profile_id, collection, item_tag, ciphertext, rev,
                                      updated_at, deleted, detected_at
                                 FROM record_conflicts
                                WHERE user_id = ?1
                             ORDER BY detected_at DESC, rev DESC
                                LIMIT ?2`, limit).all();
            return /** @type {*[]} */ (r.results);
        },

        /**
         * Cuántas filas y cuánto ocupan. Para la vista de Cuenta y para el
         * runbook; no se usa en el camino de sincronizar.
         */
        async recordStats() {
            const r = /** @type {*} */ (await q(`SELECT COUNT(*) AS n,
                                                       COALESCE(SUM(LENGTH(ciphertext)), 0) AS bytes
                                                  FROM records WHERE user_id = ?1`).first());
            return { count: r?.n ?? 0, bytes: r?.bytes ?? 0 };
        },

        /**
         * Borra la cuenta (RGPD art. 17). El `ON DELETE CASCADE` se lleva
         * credenciales, retos y sesiones; el código lo hace explícito igualmente,
         * porque depender de que la integridad referencial esté activada es
         * depender de una configuración.
         */
        async deleteAccount() {
            const db2 = env.DB;
            await db2.batch([
                db2.prepare(scoped('DELETE FROM records WHERE user_id = ?1')).bind(userId),
                db2.prepare(scoped('DELETE FROM sessions WHERE user_id = ?1')).bind(userId),
                db2.prepare(scoped('DELETE FROM challenges WHERE user_id = ?1')).bind(userId),
                db2.prepare(scoped('DELETE FROM credentials WHERE user_id = ?1')).bind(userId),
                db2.prepare(scoped('DELETE FROM users WHERE id = ?1')).bind(userId)
            ]);
        }
    };
}

/** @typedef {ReturnType<typeof openUserScope>} Scope */

/* ══ Lo GLOBAL ═══════════════════════════════════════════════════════════════
 *
 * Todo lo de abajo corre ANTES de saber quién es nadie, así que no puede pasar
 * por `Scope`. Es la lista completa, y `test/functions-scope.test.js` falla si
 * crece sin que alguien la escriba también allí.
 */

/**
 * Retos vivos que se le permiten a una IP a la vez.
 *
 * Quince, no tres: una casa con NAT, una oficina o una red móvil comparten IP
 * truncada, y un límite estrecho dejaría fuera a gente que no ha hecho nada. Y
 * no quinientos: lo que se acota es el crecimiento de la tabla, y quince filas
 * de cinco minutos por cada /24 es un techo que no se nota.
 */
export const MAX_CHALLENGES_PER_IP = 15;

/**
 * Emite un reto de WebAuthn. Global porque en el login todavía no hay usuario:
 * las credenciales son descubribles.
 *
 * **Es la única escritura sin autenticar de toda la API**, así que lleva su
 * propio techo por IP. Se cuentan los retos VIVOS y no las peticiones: un
 * contador por ventana exigiría una escritura por petición, o sea que el
 * limitador pagaría el coste del ataque. Contar lo que ya existe acota la tabla
 * por construcción y cuesta un `COUNT(*)` sobre un índice.
 *
 * Devuelve `false` cuando el techo está alcanzado; quien llama decide qué
 * contar. Sin IP no se limita: inventar una clave común agruparía a todo el
 * mundo y los usuarios legítimos se dejarían fuera unos a otros.
 *
 * @param {Env} env
 * @param {{ hash: Uint8Array, purpose: string, userId: string | null, pendingUserId: string | null, ip?: string | null, payload?: string | null, now: number, ttlMs: number }} reto
 * @returns {Promise<boolean>}
 */
export async function createChallenge(env, { hash, purpose, userId, pendingUserId, ip = null, payload = null, now, ttlMs }) {
    const desde = truncateIp(ip);
    if (desde !== null) {
        const r = /** @type {*} */ (await env.DB.prepare(
            'SELECT COUNT(*) AS n FROM challenges WHERE ip_trunc = ?1 AND expires_at > ?2')
            .bind(desde, now).first());
        if ((r?.n ?? 0) >= MAX_CHALLENGES_PER_IP) return false;
    }
    await env.DB.prepare(
        `INSERT INTO challenges (hash, purpose, user_id, pending_user_id, created_at, expires_at, ip_trunc, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
        .bind(hash, purpose, userId, pendingUserId, now, now + ttlMs, desde, payload).run();
    return true;
}

/**
 * Gasta un reto, atómicamente. `DELETE … RETURNING` y no `SELECT` + `DELETE`:
 * con las dos sentencias por separado, dos peticiones simultáneas con el mismo
 * reto pueden ganar las dos.
 *
 * @param {Env} env
 * @param {{ hash: Uint8Array, purpose: string, now: number }} reto
 */
export async function consumeChallenge(env, { hash, purpose, now }) {
    return /** @type {*} */ (await env.DB.prepare(
        `DELETE FROM challenges
          WHERE hash = ?1 AND purpose = ?2 AND expires_at > ?3
      RETURNING pending_user_id, user_id, payload`).bind(hash, purpose, now).first());
}

/**
 * Crea cuenta y primera credencial **en un lote**: si la credencial no entra, la
 * cuenta tampoco. Una cuenta sin credencial es una cuenta en la que nadie puede
 * entrar nunca, y que el usuario no puede rehacer porque el id ya está ocupado.
 *
 * @param {Env} env
 * @param {{ userId: string, credentialId: string, publicKey: Uint8Array, algorithm: number, signCount: number, now: number }} alta
 */
export async function createAccount(env, { userId, credentialId, publicKey, algorithm, signCount, now }) {
    await env.DB.batch([
        env.DB.prepare('INSERT INTO users (id, created_at) VALUES (?1, ?2)').bind(userId, now),
        env.DB.prepare(
            `INSERT INTO credentials (id, user_id, public_key, algorithm, sign_count, created_at, last_used_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`)
            .bind(credentialId, userId, publicKey, algorithm, signCount, now)
    ]);
}

/**
 * Busca a quién pertenece una identidad de un proveedor externo.
 *
 * Global por la misma razón que `findCredential`: es el paso que AVERIGUA de
 * quién es la sesión, y por tanto corre antes de que haya ninguna.
 *
 * @param {Env} env
 * @param {{ provider: string, subject: string }} id
 */
export async function findFederated(env, { provider, subject }) {
    return /** @type {*} */ (await env.DB.prepare(
        'SELECT user_id FROM federated_identities WHERE provider = ?1 AND subject = ?2')
        .bind(provider, subject).first());
}

/**
 * Crea una cuenta cuya primera credencial es una identidad externa.
 *
 * **En un solo lote, y eso importa**: una cuenta sin identidad es una cuenta en
 * la que nadie puede entrar nunca y que su dueño no puede rehacer, porque el id
 * ya está ocupado. Es el mismo cuidado que `createAccount` tiene con la passkey.
 *
 * @param {Env} env
 * @param {{ userId: string, provider: string, subject: string, now: number }} alta
 */
export async function createAccountFederated(env, { userId, provider, subject, now }) {
    await env.DB.batch([
        env.DB.prepare('INSERT INTO users (id, created_at) VALUES (?1, ?2)').bind(userId, now),
        env.DB.prepare(
            `INSERT INTO federated_identities (provider, subject, user_id, created_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?4)`)
            .bind(provider, subject, userId, now)
    ]);
}

/**
 * Anota que una identidad externa se ha usado.
 *
 * No es cosmético: es lo único que distingue una identidad viva de una que se
 * enlazó una vez y nadie volvió a tocar, y eso hace falta el día que alguien
 * pregunte qué formas de entrar tiene su cuenta.
 *
 * @param {Env} env
 * @param {{ provider: string, subject: string, now: number }} uso
 */
export async function touchFederated(env, { provider, subject, now }) {
    await env.DB.prepare(
        'UPDATE federated_identities SET last_seen_at = ?3 WHERE provider = ?1 AND subject = ?2')
        .bind(provider, subject, now).run();
}

/**
 * Busca una credencial por su id. Global porque es el paso que AVERIGUA de quién
 * es la sesión: es la consulta que convierte un id de credencial en un usuario.
 *
 * @param {Env} env
 * @param {string} credentialId
 */
export async function findCredential(env, credentialId) {
    return /** @type {*} */ (await env.DB.prepare(
        'SELECT id, user_id, public_key, sign_count FROM credentials WHERE id = ?1')
        .bind(credentialId).first());
}

/**
 * Añade una passkey a una cuenta que ya existe. Global por una razón fina: el
 * `userId` no viene de la sesión sino del reto de `add-credential`, que es lo
 * que ata el alta a un usuario ya autenticado.
 *
 * @param {Env} env
 * @param {{ userId: string, credentialId: string, publicKey: Uint8Array, algorithm: number, signCount: number, now: number }} alta
 */
export async function addCredential(env, { userId, credentialId, publicKey, algorithm, signCount, now }) {
    await env.DB.prepare(
        `INSERT INTO credentials (id, user_id, public_key, algorithm, sign_count, created_at, last_used_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)`)
        .bind(credentialId, userId, publicKey, algorithm, signCount, now).run();
}

/**
 * Adelanta el contador de firmas tras un login válido. Sin esto, la detección de
 * credencial clonada no sirve de nada.
 *
 * @param {Env} env
 * @param {{ credentialId: string, signCount: number, now: number }} uso
 */
export async function touchCredential(env, { credentialId, signCount, now }) {
    await env.DB.prepare('UPDATE credentials SET sign_count = ?1, last_used_at = ?2 WHERE id = ?3')
        .bind(signCount, now, credentialId).run();
}

/**
 * Abre una sesión y devuelve el token en claro **una sola vez**: es lo que va a
 * la cookie, y no se puede recuperar después porque en la base solo está su
 * hash.
 *
 * @param {Env} env
 * @param {{ userId: string, credentialId: string | null, ip: string | null, now: number }} datos
 * @returns {Promise<{ token: string, familyId: string }>}
 */
export async function openSession(env, { userId, credentialId, ip, now }) {
    const token = newSessionToken();
    const hash = await tokenHash(token);
    if (!hash) throw new Error('token ilegible recién generado');
    const familyId = newFamilyId();

    await env.DB.prepare(`INSERT INTO sessions
            (token_hash, user_id, credential_id, family_id, created_at, last_seen_at, expires_at, ip_trunc)
            VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7)`)
        .bind(hash, userId, credentialId, familyId, now, now + IDLE_TTL_MS, truncateIp(ip))
        .run();

    return { token, familyId };
}

/**
 * Reconoce una cookie de sesión, y rota el token cuando toca.
 *
 * ## La detección de reuso
 *
 * Al rotar, la fila se queda con el token nuevo y guarda el hash del viejo en
 * `prev_token_hash`. A partir de ahí:
 *
 * - El token nuevo funciona: es el normal.
 * - El viejo, **dentro de la gracia**, también: la respuesta que traía la cookie
 *   nueva pudo perderse —una pestaña que se cierra, un túnel que se corta, dos
 *   peticiones en paralelo—, y cerrarle la sesión al usuario por eso sería un
 *   fallo propio disfrazado de seguridad.
 * - El viejo **pasada la gracia**: alguien tiene una copia del token. Se revoca
 *   la FAMILIA entera, no solo esa fila — el atacante ya usó el token bueno, así
 *   que revocar solo el viejo dejaría dentro a quien no debe y fuera al dueño.
 *
 * @param {Env} env
 * @param {string} token
 * @param {{ now: number }} contexto
 * @returns {Promise<{ ok: true, userId: string, credentialId: string | null, newToken: string | null }
 *                  | { ok: false, reason: 'unknown' | 'expired' | 'reuse' }>}
 */
export async function verifySession(env, token, { now }) {
    const hash = await tokenHash(token);
    if (!hash) return { ok: false, reason: 'unknown' };

    const fila = /** @type {*} */ (await env.DB.prepare(
        `SELECT token_hash, prev_token_hash, user_id, credential_id, family_id,
                created_at, last_seen_at, expires_at, rotated_at
           FROM sessions
          WHERE token_hash = ?1 OR prev_token_hash = ?1`).bind(hash).first());
    if (!fila) return { ok: false, reason: 'unknown' };

    const esActual = iguales(fila.token_hash, hash);
    if (!esActual) {
        // Llegó el token ANTERIOR. Solo vale dentro de la gracia.
        if (fila.rotated_at === null || now - fila.rotated_at > ROTATION_GRACE_MS) {
            await env.DB.prepare('DELETE FROM sessions WHERE family_id = ?1').bind(fila.family_id).run();
            return { ok: false, reason: 'reuse' };
        }
        // Dentro de la gracia: se acepta y no se vuelve a rotar. Rotar aquí
        // encadenaría rotaciones cada vez que dos peticiones salen a la vez.
        return { ok: true, userId: fila.user_id, credentialId: fila.credential_id, newToken: null };
    }

    // Los dos límites. `expires_at` lleva el deslizante; el absoluto se mide
    // desde `created_at`, y por eso no basta con mirar una columna.
    if (now >= fila.expires_at || now - fila.created_at >= ABSOLUTE_TTL_MS) {
        await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(hash).run();
        return { ok: false, reason: 'expired' };
    }

    const tocaRotar = now - (fila.rotated_at ?? fila.created_at) >= ROTATE_AFTER_MS;
    if (!tocaRotar) {
        // Refrescar la inactividad es una escritura por petición, y la
        // sincronización va a hacer muchas. Solo se escribe si el reloj
        // deslizante se ha movido más de una hora: la ventana es de catorce
        // días, así que una hora de imprecisión no cambia nada.
        if (now - fila.last_seen_at >= ROTATE_AFTER_MS) {
            await env.DB.prepare('UPDATE sessions SET last_seen_at = ?1, expires_at = ?2 WHERE token_hash = ?3')
                .bind(now, now + IDLE_TTL_MS, hash).run();
        }
        return { ok: true, userId: fila.user_id, credentialId: fila.credential_id, newToken: null };
    }

    const nuevo = newSessionToken();
    const nuevoHash = await tokenHash(nuevo);
    if (!nuevoHash) throw new Error('token ilegible recién generado');
    await env.DB.prepare(
        `UPDATE sessions
            SET token_hash = ?1, prev_token_hash = ?2, rotated_at = ?3,
                last_seen_at = ?3, expires_at = ?4
          WHERE token_hash = ?2`).bind(nuevoHash, hash, now, now + IDLE_TTL_MS).run();

    return { ok: true, userId: fila.user_id, credentialId: fila.credential_id, newToken: nuevo };
}

/**
 * Cierra la sesión que trae este token. No hace falta acotar por usuario: el
 * token ES la prueba de que quien lo presenta es su dueño.
 *
 * @param {Env} env
 * @param {string} token
 */
export async function closeSession(env, token) {
    const hash = await tokenHash(token);
    if (!hash) return;
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1 OR prev_token_hash = ?1')
        .bind(hash).run();
}

/**
 * Barre retos y sesiones caducados. Se llama con `waitUntil` desde una petición
 * cualquiera —no hay cron en el plan gratuito— y por eso está acotado: un
 * barrido sin límite en una base grande gastaría el presupuesto de CPU de la
 * petición que lo lanzó.
 *
 * @param {Env} env
 * @param {number} now
 * @param {number} [limite]
 */
export async function sweepExpired(env, now, limite = 200) {
    await env.DB.batch([
        env.DB.prepare('DELETE FROM challenges WHERE hash IN (SELECT hash FROM challenges WHERE expires_at <= ?1 LIMIT ?2)').bind(now, limite),
        env.DB.prepare('DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at <= ?1 LIMIT ?2)').bind(now, limite)
    ]);
}

/** @param {Uint8Array} a @param {Uint8Array} b */
function iguales(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    let d = 0;
    for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
    return d === 0;
}

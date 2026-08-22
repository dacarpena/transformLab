// @ts-check

/**
 * El esquema de D1, ejercitado con SQLite de verdad (M8-2).
 *
 * `test/helpers/d1-fake.js` aplica `migrations/0001_init.sql` tal cual, así que
 * lo que aquí se afirma se afirma sobre el DDL que va a producción — no sobre
 * una copia escrita para los tests, que es la forma habitual de que una suite
 * entera pase mientras producción falla.
 *
 * Las dos garantías que este fichero existe para clavar:
 *
 * 1. **Un volcado completo de la base no dice quién es nadie.** No hay correo,
 *    ni nombre, ni contraseña, ni nada derivado de datos del usuario.
 * 2. **Borrar la cuenta no deja restos** (RGPD art. 17). Se prueba insertando
 *    una cuenta completa, borrando la fila de `users` y comprobando que TODAS
 *    las tablas quedan vacías.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createD1 } from './helpers/d1-fake.js';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));
const DDL = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort()
    .map((n) => readFileSync(join(MIGRATIONS, n), 'utf8')).join('\n');

/** El DDL sin comentarios: los que explican las decisiones nombran lo prohibido. */
const SQL = DDL.replace(/--[^\n]*/g, ' ');

const bytes = (/** @type {number} */ n) => new Uint8Array(Array.from({ length: n }, (_, i) => i % 251));

/** Siembra una cuenta completa: usuario, passkey, reto y sesión. */
async function sembrarCuenta(/** @type {*} */ db, /** @type {string} */ uid = 'u_abc') {
    await db.prepare('INSERT INTO users (id, created_at, photo_bytes) VALUES (?1, ?2, 0)')
        .bind(uid, 1_000).run();
    await db.prepare(`INSERT INTO credentials (id, user_id, public_key, algorithm, created_at)
                      VALUES (?1, ?2, ?3, ?4, ?5)`)
        .bind('cred_1', uid, bytes(91), -7, 1_000).run();
    await db.prepare('INSERT INTO challenges (hash, purpose, user_id, created_at, expires_at) VALUES (?1,?2,?3,?4,?5)')
        .bind(bytes(32), 'register', uid, 1_000, 61_000).run();
    await db.prepare(`INSERT INTO sessions (token_hash, user_id, credential_id, family_id,
                                            created_at, last_seen_at, expires_at)
                      VALUES (?1,?2,?3,?4,?5,?6,?7)`)
        .bind(bytes(32).map((b) => b ^ 1), uid, 'cred_1', 'fam_1', 1_000, 1_000, 99_000).run();
    // Y una fila de datos CIFRADOS, que es lo que de verdad hay que poder borrar
    // (M9-3). Sin ella, el test del art. 17 comprobaba que se borra la
    // identidad y no los datos.
    await db.prepare(`INSERT INTO records
            (user_id, profile_id, collection, item_tag, ciphertext, rev, seq, updated_at)
            VALUES (?1, ?2, 'checkins', ?3, ?4, 1, 1, ?5)`)
        .bind(uid, `perfil_${uid}`, bytes(16), bytes(64), 1_000).run();
    // Y una versión PERDEDORA archivada (M9-4). Sobrevive a su fila —no tiene
    // clave foránea a `records` a propósito—, así que si la cascada no la
    // alcanzara quedaría un cuerpo cifrado del usuario tras darse de baja.
    await db.prepare(`INSERT INTO record_conflicts
            (user_id, profile_id, collection, item_tag, ciphertext, rev, updated_at, detected_at)
            VALUES (?1, ?2, 'checkins', ?3, ?4, 1, ?5, ?5)`)
        .bind(uid, `perfil_${uid}`, bytes(16), bytes(64), 1_000).run();
    // Y una identidad de Google (M10): entrar con ella no descifra nada, pero
    // ES una forma de entrar en la cuenta, y una cuenta borrada no puede
    // conservar ninguna.
    await db.prepare(`INSERT INTO federated_identities
            (provider, subject, user_id, created_at, last_seen_at)
            VALUES ('google', ?1, ?2, 1000, 1000)`)
        .bind(`sub_${uid}`, uid).run();
}

/** Cuántas filas hay en cada tabla. */
async function censo(/** @type {*} */ db, /** @type {*} */ sqlite) {
    const tablas = /** @type {*[]} */ (sqlite.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).all()).map((r) => r.name);
    /** @type {Record<string, number>} */ const out = {};
    for (const t of tablas) {
        out[t] = /** @type {*} */ ((await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first()).n);
    }
    return out;
}

/* ── La garantía de privacidad, en el propio DDL ─────────────────────────── */

test('las filas de datos son BYTES: ni una columna en claro salvo la colección', () => {
    // El servidor guarda `ciphertext` y no puede abrirlo. La etiqueta de fila es
    // un HMAC, no el `dateISO`: guardarlo en claro habría sido más cómodo y
    // habría convertido esta tabla en un diario de cuándo se pesa cada persona.
    //
    // `collection` SÍ va en claro, y es deliberado: el servidor lo necesita para
    // validar contra el catálogo y para servir un pull. Revela qué módulos usa
    // alguien, no qué hay dentro.
    const tabla = (SQL.match(/CREATE TABLE records[\s\S]*?\)\s*STRICT/) ?? [''])[0];
    assert.ok(tabla.length > 100, 'no se encontró la tabla de filas');
    assert.match(tabla, /item_tag\s+BLOB/, 'la etiqueta de fila no es opaca');
    assert.match(tabla, /ciphertext\s+BLOB/);
    for (const enClaro of ['dateISO', 'date_iso', 'item_key', 'key_path', 'name', 'value']) {
        assert.doesNotMatch(tabla, new RegExp(`\\b${enClaro}\\b`, 'i'),
            `la tabla de filas guarda «${enClaro}» en claro`);
    }
});

test('el esquema no tiene NINGUNA columna que identifique a una persona', () => {
    // Es la propiedad que hace que este diseño se pueda defender: la identidad
    // es una clave pública, no un correo. Si algún día hace falta una de estas
    // columnas, la decisión merece un análisis, no un `ALTER TABLE`.
    for (const prohibida of [
        'email', 'mail', 'username', 'user_name', 'password', 'passwd',
        'phone', 'birth', 'full_name', 'display_name', 'given_name'
    ]) {
        assert.doesNotMatch(SQL, new RegExp(`\\b${prohibida}\\b`, 'i'),
            `el esquema declara «${prohibida}»: eso identifica a una persona`);
    }
});

test('nada que sea dato del usuario se guarda en claro', () => {
    // La convención es el sufijo `_ct` (ciphertext). La etiqueta de un
    // dispositivo —«el iPhone»— es dato del usuario y va cifrada, aunque parezca
    // inofensiva: el servidor no lee datos del usuario, y no hay excepciones
    // pequeñas.
    assert.match(SQL, /label_ct\s+BLOB/,
        'la etiqueta del dispositivo tiene que ir cifrada (sufijo _ct)');
    assert.doesNotMatch(SQL, /\blabel\s+TEXT/, 'hay una etiqueta en claro');
});

test('toda tabla es STRICT: una cadena donde va un hash tiene que lanzar', () => {
    // Sin STRICT, SQLite guarda lo que le des en la columna que le des. Un hash
    // guardado como texto compara distinto y la sesión no se encuentra: un fallo
    // silencioso en la capa de autenticación.
    const tablas = SQL.match(/CREATE TABLE\s+(\w+)/g) ?? [];
    assert.ok(tablas.length >= 4);
    const sinStrict = (SQL.match(/CREATE TABLE[\s\S]*?;/g) ?? [])
        .filter((t) => !/\)\s*STRICT\s*;/.test(t))
        .map((t) => (t.match(/CREATE TABLE\s+(\w+)/) ?? [])[1]);
    assert.deepEqual(sinStrict, [], `tablas sin STRICT: ${sinStrict.join(', ')}`);
});

test('todo lo que cuelga de users se borra o se desliga con la cuenta', () => {
    // La guarda que cubre las tablas que TODAVÍA NO EXISTEN: en M9 llegan
    // `records`, `photos` y las demás, y ninguna puede referenciar `users` sin
    // decir qué pasa al borrar la cuenta.
    const referencias = [...SQL.matchAll(/REFERENCES\s+users\s*\(id\)([^,\n]*)/g)];
    assert.ok(referencias.length >= 3, 'ninguna tabla referencia users: ¿cambió el esquema?');
    for (const [, cola] of referencias) {
        assert.match(cola, /ON DELETE (CASCADE|SET NULL)/,
            `una referencia a users(id) no dice qué pasa al borrar la cuenta: «${cola.trim()}»`);
    }
});

/* ── El borrado de cuenta, ejecutado ─────────────────────────────────────── */

test('borrar la fila de users vacía la base entera (RGPD art. 17)', async () => {
    const { db, sqlite, close } = createD1();
    try {
        await sembrarCuenta(db);
        const antes = await censo(db, sqlite);
        assert.deepEqual(antes, {
            challenges: 1, credentials: 1, federated_identities: 1, record_conflicts: 1,
            records: 1, sessions: 1, users: 1
        });

        await db.prepare('DELETE FROM users WHERE id = ?1').bind('u_abc').run();

        const despues = await censo(db, sqlite);
        for (const [tabla, n] of Object.entries(despues)) {
            assert.equal(n, 0, `quedan ${n} filas en ${tabla} tras borrar la cuenta`);
        }
    } finally { close(); }
});

test('borrar UNA cuenta no toca la otra', async () => {
    // El `ON DELETE CASCADE` bien puesto borra de más si la condición está mal.
    const { db, sqlite, close } = createD1();
    try {
        await sembrarCuenta(db, 'u_uno');
        await db.prepare('INSERT INTO users (id, created_at, photo_bytes) VALUES (?1, ?2, 0)')
            .bind('u_dos', 2_000).run();
        await db.prepare(`INSERT INTO credentials (id, user_id, public_key, algorithm, created_at)
                          VALUES (?1,?2,?3,?4,?5)`).bind('cred_2', 'u_dos', bytes(91), -7, 2_000).run();

        await db.prepare('DELETE FROM users WHERE id = ?1').bind('u_uno').run();

        assert.deepEqual(await censo(db, sqlite),
            { challenges: 0, credentials: 1, federated_identities: 0, record_conflicts: 0,
                records: 0, sessions: 0, users: 1 });
        assert.equal(await db.prepare('SELECT user_id FROM credentials').first('user_id'), 'u_dos');
    } finally { close(); }
});

test('las claves foráneas se APLICAN: no se puede colgar nada de una cuenta que no existe', async () => {
    const { db, close } = createD1();
    try {
        await assert.rejects(
            db.prepare(`INSERT INTO credentials (id, user_id, public_key, algorithm, created_at)
                        VALUES (?1,?2,?3,?4,?5)`).bind('c', 'u_fantasma', bytes(91), -7, 1).run(),
            /FOREIGN KEY/);
    } finally { close(); }
});

/* ── Decisiones del esquema que el código dará por hechas ────────────────── */

test('un reto de LOGIN se guarda sin usuario: las credenciales son descubribles', async () => {
    // Es el efecto que se busca: no hay campo «usuario» que enumerar en el
    // login. Si `user_id` fuera NOT NULL, habría que pedirle al usuario que se
    // identifique antes de autenticarse, que es justo lo que las passkeys
    // descubribles evitan.
    const { db, close } = createD1();
    try {
        await db.prepare('INSERT INTO challenges (hash, purpose, user_id, created_at, expires_at) VALUES (?1,?2,?3,?4,?5)')
            .bind(bytes(32), 'login', null, 1_000, 61_000).run();
        assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM challenges').first('n'), 1);
    } finally { close(); }
});

test('una cuenta recién creada NO está protegida: la regla dura vive en el esquema', async () => {
    // Con cifrado extremo a extremo, subir datos antes de que haya vía de vuelta
    // es fabricar una pérdida irreversible. `protected_at` nulo es el estado
    // inicial, y tiene que serlo sin que nadie lo escriba.
    const { db, close } = createD1();
    try {
        await db.prepare('INSERT INTO users (id, created_at) VALUES (?1, ?2)').bind('u', 1).run();
        const u = /** @type {*} */ (await db.prepare('SELECT * FROM users').first());
        assert.equal(u.protected_at, null);
        assert.equal(u.wrapped_dk_recovery, null);
        assert.equal(u.photo_bytes, 0, 'la cuota tiene que arrancar en 0 sin que nadie la escriba');
    } finally { close(); }
});

test('los BLOB vuelven como BYTES, no como texto', async () => {
    // Un hash que va y vuelve convertido en cadena compara distinto, y entonces
    // la sesión no se encuentra: un fallo silencioso en la autenticación.
    const { db, close } = createD1();
    try {
        const clave = bytes(91);
        await db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)').bind('u', 1).run();
        await db.prepare(`INSERT INTO credentials (id, user_id, public_key, algorithm, created_at)
                          VALUES (?1,?2,?3,?4,?5)`).bind('c', 'u', clave, -7, 1).run();
        const vuelta = await db.prepare('SELECT public_key FROM credentials').first('public_key');
        assert.ok(vuelta instanceof Uint8Array, `volvió un ${typeof vuelta}`);
        assert.deepEqual([...(/** @type {Uint8Array} */ (vuelta))], [...clave]);
    } finally { close(); }
});

test('el contador de firmas arranca en 0 y es un entero', async () => {
    const { db, close } = createD1();
    try {
        await db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)').bind('u', 1).run();
        await db.prepare(`INSERT INTO credentials (id, user_id, public_key, algorithm, created_at)
                          VALUES (?1,?2,?3,?4,?5)`).bind('c', 'u', bytes(91), -7, 1).run();
        assert.equal(await db.prepare('SELECT sign_count FROM credentials').first('sign_count'), 0);
    } finally { close(); }
});

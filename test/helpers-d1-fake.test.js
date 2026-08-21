// @ts-check

/**
 * El doble de D1, probado a sí mismo (M8-2).
 *
 * Un doble de pruebas con un fallo no rompe un test: hace que **todos** los
 * tests que lo usan mientan a la vez, y en la misma dirección. Como de aquí
 * cuelga toda la parte de servidor, se le exige lo mismo que al código: que la
 * propiedad que promete sea comprobable.
 *
 * La propiedad es una sola: **es más estricto que D1, nunca más laxo.** Un doble
 * permisivo deja pasar código que producción rechaza, y el fallo aparece con
 * usuarios delante.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1-fake.js';

/* ── Que aplica las migraciones DE VERDAD ────────────────────────────────── */

test('aplica todas las migraciones del repositorio, descubiertas del disco', () => {
    // Descubrirlas y no nombrarlas es lo que hace imposible añadir una migración
    // y olvidarse de aplicarla en los tests.
    const { migraciones, sqlite, close } = createD1();
    try {
        assert.ok(migraciones.includes('0001_init.sql'));
        assert.ok(migraciones.includes('0002_records.sql'));
        assert.ok(migraciones.includes('0003_conflicts.sql'));
        assert.deepEqual([...migraciones].sort(), migraciones, 'se aplican en orden alfabético');
        const tablas = /** @type {*[]} */ (sqlite.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).all()).map((r) => r.name).sort();
        assert.deepEqual(tablas,
            ['challenges', 'credentials', 'record_conflicts', 'records', 'sessions', 'users']);
    } finally { close(); }
});

test('cada base es nueva: un test no puede contaminar al siguiente', async () => {
    const a = createD1();
    await a.db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)').bind('u', 1).run();
    a.close();
    const b = createD1();
    try {
        assert.equal(await b.db.prepare('SELECT COUNT(*) AS n FROM users').first('n'), 0);
    } finally { b.close(); }
});

/* ── La estrictez, que es la razón de ser ────────────────────────────────── */

test('`undefined` en un bind LANZA, como en D1', async () => {
    // Es el error más frecuente al escribir consultas —un campo opcional que
    // nadie normalizó a `null`— y un doble permisivo lo convertiría en un NULL
    // silencioso que solo se nota meses después.
    const { db, close } = createD1();
    try {
        await assert.rejects(
            db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)').bind('u', undefined).run(),
            /undefined/);
        // Y `null` sí pasa: la diferencia entre los dos es justo lo que se
        // quiere poder distinguir.
        await db.prepare('INSERT INTO users (id, created_at, protected_at) VALUES (?1,?2,?3)')
            .bind('u', 1, null).run();
        assert.equal(await db.prepare('SELECT protected_at FROM users').first('protected_at'), null);
    } finally { close(); }
});

test('un booleano LANZA en vez de guardarse como 1', async () => {
    // SQLite no tiene booleanos. Guardar `true` como 1 en silencio produce
    // columnas que nadie sabe leer tres meses después.
    const { db, close } = createD1();
    try {
        await assert.rejects(
            db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)').bind('u', true).run(),
            /booleano/);
    } finally { close(); }
});

test('STRICT rechaza una cadena donde va un BLOB', async () => {
    const { db, close } = createD1();
    try {
        await db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)').bind('u', 1).run();
        await assert.rejects(
            db.prepare(`INSERT INTO credentials (id, user_id, public_key, algorithm, created_at)
                        VALUES (?1,?2,?3,?4,?5)`).bind('c', 'u', 'no soy bytes', -7, 1).run());
    } finally { close(); }
});

/* ── La interfaz de D1, en lo que el código va a dar por hecho ───────────── */

test('`bind` NO muta: devuelve una sentencia nueva', async () => {
    // En D1 una sentencia preparada se puede reutilizar con distintos valores.
    // Si el doble mutara, el código que lo hace se comportaría distinto aquí.
    const { db, close } = createD1();
    try {
        const insertar = db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)');
        await insertar.bind('a', 1).run();
        await insertar.bind('b', 2).run();
        const ids = (await db.prepare('SELECT id FROM users ORDER BY id').all()).results.map((/** @type {*} */ r) => r.id);
        assert.deepEqual(ids, ['a', 'b']);
    } finally { close(); }
});

test('`first()` devuelve null —no undefined— cuando no hay fila', async () => {
    // El código escribe `if (fila === null)`, y `undefined` no lo cumple.
    const { db, close } = createD1();
    try {
        assert.equal(await db.prepare('SELECT * FROM users WHERE id = ?1').bind('nadie').first(), null);
        assert.equal(await db.prepare('SELECT id FROM users WHERE id = ?1').bind('nadie').first('id'), null);
    } finally { close(); }
});

test('`run()` informa de cuántas filas cambió', async () => {
    const { db, close } = createD1();
    try {
        await db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)').bind('a', 1).run();
        await db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)').bind('b', 2).run();
        const r = await db.prepare('DELETE FROM users').run();
        assert.equal(r.meta.changes, 2);
        assert.equal(r.success, true);
        // Un DELETE que no encuentra nada NO es un error: son 0 cambios. El
        // código distingue «no existía» de «falló» por aquí.
        assert.equal((await db.prepare('DELETE FROM users WHERE id = ?1').bind('x').run()).meta.changes, 0);
    } finally { close(); }
});

test('las filas tienen prototipo NORMAL', async () => {
    // `node:sqlite` las devuelve con prototipo nulo, y entonces `{...fila}` y
    // `deepEqual` no se comportan como con lo que devuelve D1: un test podría
    // pasar aquí y fallar en producción.
    const { db, close } = createD1();
    try {
        await db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)').bind('u', 7).run();
        const fila = /** @type {*} */ (await db.prepare('SELECT id, created_at FROM users').first());
        assert.equal(Object.getPrototypeOf(fila), Object.prototype);
        assert.deepEqual({ ...fila }, { id: 'u', created_at: 7 });
    } finally { close(); }
});

test('`batch` es TRANSACCIONAL: si una falla, no entra ninguna', async () => {
    // Sin transacción, un lote a medias deja la base en un estado que ningún
    // test buscó, y el siguiente falla por una razón que no es la suya.
    const { db, close } = createD1();
    try {
        await assert.rejects(db.batch([
            db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)').bind('a', 1),
            db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)').bind('a', 2) // id repetido
        ]));
        assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM users').first('n'), 0,
            'el lote entró a medias');

        // Y uno que va bien entra entero.
        await db.batch([
            db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)').bind('a', 1),
            db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)').bind('b', 2)
        ]);
        assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM users').first('n'), 2);
    } finally { close(); }
});

test('`ArrayBuffer` y `Uint8Array` valen los dos, como en D1', async () => {
    const { db, close } = createD1();
    try {
        await db.prepare('INSERT INTO users (id, created_at) VALUES (?1,?2)').bind('u', 1).run();
        const clave = new Uint8Array([9, 8, 7]);
        await db.prepare(`INSERT INTO credentials (id, user_id, public_key, algorithm, created_at)
                          VALUES (?1,?2,?3,?4,?5)`).bind('c1', 'u', clave.buffer, -7, 1).run();
        await db.prepare(`INSERT INTO credentials (id, user_id, public_key, algorithm, created_at)
                          VALUES (?1,?2,?3,?4,?5)`).bind('c2', 'u', clave, -7, 1).run();
        const filas = (await db.prepare('SELECT public_key FROM credentials ORDER BY id').all()).results;
        assert.deepEqual([...(/** @type {*} */ (filas[0]).public_key)], [9, 8, 7]);
        assert.deepEqual([...(/** @type {*} */ (filas[1]).public_key)], [9, 8, 7]);
    } finally { close(); }
});

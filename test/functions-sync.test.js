// @ts-check

/**
 * El pull, de solo lectura (M9-3).
 *
 * Dos cosas se fijan aquí, y las dos son de las que no se pueden arreglar
 * después:
 *
 * 1. **Que esta etapa NO pueda destruir nada.** No hay ningún camino por el que
 *    una petición borre o cambie una fila del usuario. Hay un test que lo
 *    comprueba recorriendo el manifiesto, no leyendo intenciones.
 * 2. **Que el servidor no aprenda lo que no debe.** La respuesta lleva bytes y
 *    un HMAC, nunca un `dateISO` ni un nombre. Guardar la fecha en claro habría
 *    sido más cómodo y habría convertido la tabla en un diario de cuándo se pesa
 *    cada persona.
 *
 * Y el cursor: `?since=<seq>` y no `?since=<fecha>`. Un cursor por fecha
 * obligaría a los dos lados a estar de acuerdo sobre la hora, y los relojes de
 * los móviles están mal — una fila escrita por un teléfono adelantado quedaría
 * «en el futuro» y el pull siguiente se la saltaría para siempre.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1-fake.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequest as enrutador } from '../functions/api/[[path]].js';
import { createAccount, openSession } from '../functions/_lib/db.js';
import { COOKIE_NAME } from '../functions/_lib/sessions.js';
import { decode } from '../functions/_lib/base64url.js';
import { ROUTES } from '../functions/_manifest.js';

const ORIGEN = 'https://motifyer.com';

/** Una cuenta con sesión abierta y un puñado de filas cifradas. */
async function conFilas({ cuantas = 3, perfil = 'op4co1234567890abcdefg' } = {}) {
    const h = createD1();
    const env = /** @type {*} */ ({ DB: h.db });
    const ahora = Date.now();
    await createAccount(env, {
        userId: 'u_ana', credentialId: 'c_ana', publicKey: new Uint8Array(91),
        algorithm: -7, signCount: 0, now: ahora
    });
    const { token } = await openSession(env, {
        userId: 'u_ana', credentialId: 'c_ana', ip: null, now: ahora
    });

    for (let i = 1; i <= cuantas; i++) {
        await h.db.prepare(`INSERT INTO records
                (user_id, profile_id, collection, item_tag, ciphertext, rev, seq, updated_at, deleted)
                VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, 0)`)
            .bind('u_ana', perfil, 'checkins',
                new Uint8Array(16).fill(i), new Uint8Array(80).fill(i), i, ahora + i).run();
    }
    await h.db.prepare('UPDATE users SET last_seq = ?1 WHERE id = ?2').bind(cuantas, 'u_ana').run();
    return { ...h, env, token, perfil };
}

function llamar(ruta, { env, token, method = 'GET' } = {}) {
    /** @type {Record<string,string>} */ const headers = {};
    if (token) headers.Cookie = `${COOKIE_NAME}=${token}`;
    if (method !== 'GET') { headers.Origin = ORIGEN; headers['Content-Type'] = 'application/json'; }
    const request = new Request(`${ORIGEN}${ruta}`, {
        method, headers, body: method === 'GET' ? undefined : '{}'
    });
    /** @type {*} */ const ctx = {
        request, env, params: {}, data: {}, waitUntil: () => {},
        next: () => enrutador({ ...ctx, request })
    };
    return middleware(ctx);
}

const cuerpo = async (/** @type {Response} */ r) => JSON.parse(await r.text());

/* ── La garantía de la etapa ─────────────────────────────────────────────── */

test('M9-3 es de SOLO LECTURA: ninguna ruta de sincronía acepta escrituras', () => {
    // Se recorre el manifiesto, que es la fuente única de lo que existe. Leer
    // intenciones no vale: lo que decide es qué rutas hay publicadas.
    const escrituras = ROUTES
        .filter((r) => r.path.startsWith('/api/sync'))
        .filter((r) => r.method !== 'GET' && r.method !== 'HEAD');
    assert.deepEqual(escrituras.map((r) => `${r.method} ${r.path}`), [],
        'hay una ruta de sincronía que escribe: M9-3 no puede destruir nada');
});

test('las rutas de sincronía EXIGEN sesión', () => {
    for (const r of ROUTES.filter((x) => x.path.startsWith('/api/sync') || x.path === '/api/account/records')) {
        assert.equal(r.auth, true, `${r.method} ${r.path} no exige sesión`);
    }
});

test('sin sesión, el pull no contesta', async () => {
    const { env, close } = await conFilas();
    try {
        assert.equal((await llamar('/api/sync', { env })).status, 401);
        assert.equal((await llamar('/api/account/records', { env })).status, 401);
    } finally { close(); }
});

/* ── Lo que el servidor devuelve ─────────────────────────────────────────── */

test('el pull devuelve BYTES y un HMAC: ni una fecha, ni un nombre', async () => {
    const { env, token, perfil, close } = await conFilas();
    try {
        const texto = await (await llamar('/api/sync', { env, token })).text();
        const o = JSON.parse(texto);

        assert.equal(o.rows.length, 3);
        for (const fila of o.rows) {
            assert.equal(fila.collection, 'checkins');
            assert.equal(fila.profileId, perfil);
            // La etiqueta es opaca: 16 bytes en base64url, no una fecha.
            assert.match(fila.itemTag, /^[A-Za-z0-9_-]{22}$/);
            assert.equal(decode(fila.itemTag)?.length, 16);
            assert.match(fila.ciphertext, /^[A-Za-z0-9_-]+$/);
        }
        // Y en la respuesta entera no hay nada con forma de fecha ni de nombre.
        assert.doesNotMatch(texto, /\d{4}-\d{2}-\d{2}/, 'se coló una fecha en claro');
        assert.doesNotMatch(texto, /weightKg|dateISO|notes/, 'se coló un campo del esquema');
    } finally { close(); }
});

test('una LÁPIDA viaja, y sin cuerpo', async () => {
    // Un borrado que no viaja es un borrado que el otro dispositivo deshace en
    // el siguiente push: tiene su fila, no vio la baja, y la vuelve a subir.
    const { db, env, token, perfil, close } = await conFilas({ cuantas: 1 });
    try {
        await db.prepare(`INSERT INTO records
                (user_id, profile_id, collection, item_tag, ciphertext, rev, seq, updated_at, deleted)
                VALUES ('u_ana', ?1, 'checkins', ?2, NULL, 2, 9, 1, 1)`)
            .bind(perfil, new Uint8Array(16).fill(99)).run();

        const o = await cuerpo(await llamar('/api/sync', { env, token }));
        const lapida = o.rows.find((/** @type {*} */ f) => f.deleted);
        assert.ok(lapida, 'la lápida no llegó');
        assert.equal(lapida.ciphertext, null, 'una lápida no lleva cuerpo');
        assert.equal(lapida.rev, 2);
    } finally { close(); }
});

test('el esquema PROHÍBE las dos filas imposibles', async () => {
    // Una viva sin criptograma —que el cliente descifra a nada y descarta sin
    // decir por qué— y una lápida con cuerpo, que transporta algo que nadie va a
    // leer. Las dos son silenciosas, así que las impide el esquema y no un `if`.
    const { db, perfil, close } = await conFilas({ cuantas: 0 });
    try {
        const meter = (/** @type {number} */ n, /** @type {*} */ cipher, /** @type {number} */ deleted) =>
            db.prepare(`INSERT INTO records
                    (user_id, profile_id, collection, item_tag, ciphertext, rev, seq, updated_at, deleted)
                    VALUES ('u_ana', ?1, 'checkins', ?2, ?3, 1, ?4, 1, ?5)`)
                .bind(perfil, new Uint8Array(16).fill(n), cipher, n, deleted).run();

        await assert.rejects(() => meter(1, null, 0), /CHECK/, 'coló una fila viva sin criptograma');
        await assert.rejects(() => meter(2, new Uint8Array(10), 1), /CHECK/, 'coló una lápida con cuerpo');
        // Y las dos formas legítimas sí entran.
        await assert.doesNotReject(() => meter(3, new Uint8Array(10), 0));
        await assert.doesNotReject(() => meter(4, null, 1));
    } finally { close(); }
});

/* ── El cursor ───────────────────────────────────────────────────────────── */

test('`since` trae solo lo POSTERIOR, y el cursor avanza', async () => {
    const { env, token, close } = await conFilas({ cuantas: 5 });
    try {
        const todo = await cuerpo(await llamar('/api/sync?since=0', { env, token }));
        assert.equal(todo.rows.length, 5);
        assert.equal(todo.nextSince, 5);
        assert.equal(todo.lastSeq, 5);
        assert.equal(todo.hasMore, false);

        const desde3 = await cuerpo(await llamar('/api/sync?since=3', { env, token }));
        assert.deepEqual(desde3.rows.map((/** @type {*} */ f) => f.seq), [4, 5]);
        assert.equal(desde3.nextSince, 5);
    } finally { close(); }
});

test('sin nada nuevo, el cursor NO retrocede', async () => {
    // Devolver 0 cuando no hay filas haría que el cliente volviera a empezar en
    // cada pull: descargar la cuenta entera cada vez, para siempre.
    const { env, token, close } = await conFilas({ cuantas: 2 });
    try {
        const o = await cuerpo(await llamar('/api/sync?since=2', { env, token }));
        assert.deepEqual(o.rows, []);
        assert.equal(o.nextSince, 2, 'el cursor retrocedió');
        assert.equal(o.hasMore, false);
    } finally { close(); }
});

test('las filas llegan ORDENADAS por seq', async () => {
    // El cliente aplica en orden y guarda el último como cursor. Desordenadas,
    // guardaría un cursor por delante de filas que aún no ha visto y las
    // perdería para siempre.
    const { env, token, close } = await conFilas({ cuantas: 12 });
    try {
        const o = await cuerpo(await llamar('/api/sync', { env, token }));
        const seqs = o.rows.map((/** @type {*} */ f) => f.seq);
        assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'llegaron desordenadas');
    } finally { close(); }
});

test('un cursor imposible se rechaza en vez de devolver vacío en silencio', async () => {
    // Un `NaN` haría que `seq > ?` no cumpliera nada y la respuesta llegara
    // vacía: el cliente creería estar al día. Un negativo devolvería filas ya
    // vistas, que es caro pero no miente. Los dos se rechazan.
    const { env, token, close } = await conFilas();
    try {
        for (const malo of ['abc', '-1', '1.5', 'NaN', 'Infinity', '9007199254740993']) {
            const r = await llamar(`/api/sync?since=${encodeURIComponent(malo)}`, { env, token });
            assert.equal(r.status, 400, `aceptó since=${malo}`);
            assert.equal((await cuerpo(r)).error, 'sync.badCursor');
        }
        // Y sin `since` se empieza por el principio.
        assert.equal((await llamar('/api/sync', { env, token })).status, 200);
    } finally { close(); }
});

/* ── Paginación ──────────────────────────────────────────────────────────── */

test('con más de una página, `hasMore` lo dice y el cursor encadena', async () => {
    // Una respuesta de varios megabytes es lo que peor se lleva un móvil con
    // mala cobertura: se corta a la mitad y hay que empezar de cero.
    const { env, token, close } = await conFilas({ cuantas: 250 });
    try {
        const p1 = await cuerpo(await llamar('/api/sync?since=0', { env, token }));
        assert.equal(p1.rows.length, 200);
        assert.equal(p1.hasMore, true);
        assert.equal(p1.nextSince, 200);

        const p2 = await cuerpo(await llamar(`/api/sync?since=${p1.nextSince}`, { env, token }));
        assert.equal(p2.rows.length, 50);
        assert.equal(p2.hasMore, false);

        // Y entre las dos páginas están TODAS las filas, sin repetir ninguna.
        const seqs = [...p1.rows, ...p2.rows].map((/** @type {*} */ f) => f.seq);
        assert.equal(new Set(seqs).size, 250, 'se repitió o se perdió alguna fila');
    } finally { close(); }
});

/* ── Acotación por cuenta ────────────────────────────────────────────────── */

test('el pull de una cuenta NO ve las filas de otra', async () => {
    // La acotación la impone `Scope`, cuyas sentencias llevan `user_id = ?1`.
    // Aquí se comprueba por el camino real, de punta a punta.
    const { db, env, token, close } = await conFilas({ cuantas: 2 });
    try {
        await createAccount(env, {
            userId: 'u_bea', credentialId: 'c_bea', publicKey: new Uint8Array(91),
            algorithm: -7, signCount: 0, now: Date.now()
        });
        await db.prepare(`INSERT INTO records
                (user_id, profile_id, collection, item_tag, ciphertext, rev, seq, updated_at, deleted)
                VALUES ('u_bea', 'perfil_bea', 'checkins', ?1, ?2, 1, 1, 1, 0)`)
            .bind(new Uint8Array(16).fill(200), new Uint8Array(40).fill(200)).run();

        const o = await cuerpo(await llamar('/api/sync?since=0', { env, token }));
        assert.equal(o.rows.length, 2, 'se colaron filas de otra cuenta');
        for (const fila of o.rows) assert.notEqual(fila.profileId, 'perfil_bea');
    } finally { close(); }
});

test('borrar la cuenta se lleva también sus filas cifradas (RGPD art. 17)', async () => {
    const { db, env, close } = await conFilas({ cuantas: 4 });
    try {
        const scope = (await import('../functions/_lib/db.js')).openUserScope(env, 'u_ana');
        assert.equal((await scope.recordStats()).count, 4);
        await scope.deleteAccount();
        assert.equal(await db.prepare('SELECT COUNT(*) AS n FROM records').first('n'), 0,
            'quedaron datos cifrados de una cuenta borrada');
    } finally { close(); }
});

/* ── El recuento ─────────────────────────────────────────────────────────── */

test('las estadísticas cuentan filas y bytes, y solo los propios', async () => {
    const { env, token, close } = await conFilas({ cuantas: 3 });
    try {
        const o = await cuerpo(await llamar('/api/account/records', { env, token }));
        assert.equal(o.count, 3);
        assert.equal(o.bytes, 3 * 80, 'el tamaño no cuadra con lo sembrado');
        assert.equal(o.lastSeq, 3);
    } finally { close(); }
});

test('una cuenta sin nada devuelve ceros, no un error', async () => {
    const h = createD1();
    const env = /** @type {*} */ ({ DB: h.db });
    try {
        await createAccount(env, {
            userId: 'u_nueva', credentialId: 'c', publicKey: new Uint8Array(91),
            algorithm: -7, signCount: 0, now: Date.now()
        });
        const { token } = await openSession(env, { userId: 'u_nueva', credentialId: 'c', ip: null, now: Date.now() });
        const o = await cuerpo(await llamar('/api/account/records', { env, token }));
        assert.deepEqual(o, { count: 0, bytes: 0, lastSeq: 0 });

        const pull = await cuerpo(await llamar('/api/sync', { env, token }));
        assert.deepEqual(pull.rows, []);
        assert.equal(pull.nextSince, 0);
    } finally { h.close(); }
});

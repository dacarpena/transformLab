// @ts-check

/**
 * La sincronía en el servidor: el pull (M9-3) y el push (M9-4).
 *
 * Tres cosas se fijan aquí, y las tres son de las que no se pueden arreglar
 * después:
 *
 * 1. **Que el servidor no aprenda lo que no debe.** La respuesta lleva bytes y
 *    un HMAC, nunca un `dateISO` ni un nombre. Guardar la fecha en claro habría
 *    sido más cómodo y habría convertido la tabla en un diario de cuándo se pesa
 *    cada persona.
 * 2. **Que un push no pueda perder una versión en silencio.** Gana quien
 *    escribe, con el reloj del servidor, pero el perdedor se archiva ANTES de
 *    que lo pisen y en la misma transacción. Hay un test que lo comprueba
 *    mirando la tabla, no el código.
 * 3. **Que una fila mal formada tumbe el lote entero** en vez de colarse a
 *    medias: un push parcial dejaría al cliente creyendo que subió todo, y su
 *    sombra apuntaría a filas que no están.
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
import { decode, encode } from '../functions/_lib/base64url.js';
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

function llamar(ruta, { env, token, method = 'GET', body } = {}) {
    /** @type {Record<string,string>} */ const headers = {};
    if (token) headers.Cookie = `${COOKIE_NAME}=${token}`;
    if (method !== 'GET') { headers.Origin = ORIGEN; headers['Content-Type'] = 'application/json'; }
    const request = new Request(`${ORIGEN}${ruta}`, {
        method, headers,
        body: method === 'GET' ? undefined : JSON.stringify(body ?? {})
    });
    /** @type {*} */ const ctx = {
        request, env, params: {}, data: {}, waitUntil: () => {},
        next: () => enrutador({ ...ctx, request })
    };
    return middleware(ctx);
}

const cuerpo = async (/** @type {Response} */ r) => JSON.parse(await r.text());

/* ── La garantía de la etapa ─────────────────────────────────────────────── */

test('la sincronía publica EXACTAMENTE estas rutas, y ninguna más', () => {
    // Se recorre el manifiesto, que es la fuente única de lo que existe. Leer
    // intenciones no vale: lo que decide es qué rutas hay publicadas. Y se
    // afirma la lista entera, no «no hay ninguna que escriba»: así añadir un
    // `DELETE /api/sync/all` obliga a pasar por aquí y a explicarlo.
    const rutas = ROUTES
        .filter((r) => r.path.startsWith('/api/sync'))
        .map((r) => `${r.method} ${r.path}`)
        .sort();
    assert.deepEqual(rutas, [
        'GET /api/sync',
        'GET /api/sync/conflicts',
        'POST /api/sync'
    ]);
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
        assert.deepEqual(o, { count: 0, bytes: 0, lastSeq: 0, conflicts: 0 });

        const pull = await cuerpo(await llamar('/api/sync', { env, token }));
        assert.deepEqual(pull.rows, []);
        assert.equal(pull.nextSince, 0);
    } finally { h.close(); }
});

/* ── El push (M9-4) ──────────────────────────────────────────────────────── */

/** Una cuenta con sesión y sin ninguna fila. */
async function vacia() {
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
    return { ...h, env, token, perfil: 'op4co1234567890abcdefg' };
}

/** Una etiqueta de 16 bytes, en base64url. */
const etiqueta = (/** @type {number} */ n) => encode(new Uint8Array(16).fill(n));

/** Un «criptograma» de relleno. Aquí nadie descifra: el servidor no puede. */
const sobre = (/** @type {number} */ n, /** @type {number} */ len = 64) =>
    encode(new Uint8Array(len).fill(n));

const fila = (/** @type {*} */ o) => ({
    profileId: 'op4co1234567890abcdefg', collection: 'checkins',
    itemTag: etiqueta(1), ciphertext: sobre(1), deleted: false, baseRev: 0, ...o
});

const subir = (env, token, filas) =>
    llamar('/api/sync', { env, token, method: 'POST', body: { rows: filas } });

test('push: una fila nueva entra con revisión 1, y el pull la devuelve', async () => {
    const { env, token, close } = await vacia();
    try {
        const r = await subir(env, token, [fila({})]);
        assert.equal(r.status, 200);
        const o = await cuerpo(r);
        assert.deepEqual(o.results, [{ itemTag: etiqueta(1), rev: 1, seq: 1, conflict: false }]);
        assert.equal(o.conflicts, 0);
        assert.equal(o.lastSeq, 1);

        const bajada = await cuerpo(await llamar('/api/sync', { env, token }));
        assert.equal(bajada.rows.length, 1);
        assert.equal(bajada.rows[0].ciphertext, sobre(1));
        assert.equal(bajada.rows[0].rev, 1);
    } finally { close(); }
});

test('perdedor_archivado: pisar una versión no vista guarda la que pierde, con SUS bytes', async () => {
    const { env, db, token, close } = await vacia();
    try {
        // El primer dispositivo escribe.
        await subir(env, token, [fila({ ciphertext: sobre(0xAA) })]);

        // El segundo escribe encima creyendo que la fila no existía (baseRev 0).
        const r = await cuerpo(await subir(env, token, [fila({ ciphertext: sobre(0xBB), baseRev: 0 })]));
        assert.equal(r.conflicts, 1);
        assert.equal(r.results[0].conflict, true);
        assert.equal(r.results[0].rev, 2, 'la revisión la lleva el servidor y sube siempre');

        // Gana el que escribe...
        const vivas = await db.prepare('SELECT ciphertext FROM records').all();
        assert.deepEqual(new Uint8Array(vivas.results[0].ciphertext), new Uint8Array(64).fill(0xBB));

        // ...y el que pierde está guardado, con LOS BYTES QUE TENÍA. Esto es lo
        // que se rompería si la copia se hiciera después del upsert en vez de
        // antes: quedaría archivada la versión nueva, que no perdió nada.
        const perdedoras = await db.prepare('SELECT rev, ciphertext FROM record_conflicts').all();
        assert.equal(perdedoras.results.length, 1);
        assert.equal(perdedoras.results[0].rev, 1);
        assert.deepEqual(new Uint8Array(perdedoras.results[0].ciphertext),
            new Uint8Array(64).fill(0xAA), 'se archivó la versión equivocada');
    } finally { close(); }
});

test('sin conflicto no se archiva nada: escribir sobre la revisión que se conoce', async () => {
    const { env, db, token, close } = await vacia();
    try {
        const primera = await cuerpo(await subir(env, token, [fila({})]));
        const r = await cuerpo(await subir(env, token,
            [fila({ ciphertext: sobre(2), baseRev: primera.results[0].rev })]));
        assert.equal(r.conflicts, 0);
        assert.equal(r.results[0].conflict, false);
        const n = await db.prepare('SELECT COUNT(*) AS n FROM record_conflicts').first();
        assert.equal(n.n, 0);
    } finally { close(); }
});

test('lote_atomico: una fila mala tumba el lote entero, sin escribir la buena', async () => {
    const { env, db, token, close } = await vacia();
    try {
        const r = await subir(env, token, [
            fila({ itemTag: etiqueta(1) }),
            fila({ itemTag: 'no-son-16-bytes' })
        ]);
        assert.equal(r.status, 400);
        assert.equal((await cuerpo(r)).error, 'sync.badRow');

        const n = await db.prepare('SELECT COUNT(*) AS n FROM records').first();
        assert.equal(n.n, 0, 'se escribió media petición');
        // Y el contador de la cuenta tampoco se movió: reservar seq antes de
        // validar dejaría huecos permanentes en el cursor de todos los
        // dispositivos.
        const u = await db.prepare('SELECT last_seq FROM users').first();
        assert.equal(u.last_seq, 0);
    } finally { close(); }
});

test('cada forma de fila inválida se rechaza, una por una', async () => {
    const { env, token, close } = await vacia();
    try {
        /** @type {[string, *][]} */ const malas = [
            ['perfil con forma imposible', { profileId: 'con espacios' }],
            ['colección que no existe', { collection: 'inventada' }],
            ['colección declarada LOCAL', { collection: 'volumeLog' }],
            ['etiqueta que no mide 16 bytes', { itemTag: encode(new Uint8Array(8)) }],
            ['etiqueta que no es base64url', { itemTag: '****' }],
            ['revisión base negativa', { baseRev: -1 }],
            ['revisión base fraccionaria', { baseRev: 1.5 }],
            ['fila viva sin criptograma', { ciphertext: null }],
            ['lápida CON criptograma', { deleted: true, ciphertext: sobre(1) }],
            ['criptograma que no es base64url', { ciphertext: 'con espacios' }]
        ];
        for (const [porque, parche] of malas) {
            const r = await subir(env, token, [fila(parche)]);
            assert.equal(r.status, 400, `se aceptó una fila con ${porque}`);
        }
    } finally { close(); }
});

test('una lápida borra el cuerpo, y el pull la devuelve sin criptograma', async () => {
    const { env, db, token, close } = await vacia();
    try {
        const primera = await cuerpo(await subir(env, token, [fila({})]));
        await subir(env, token, [fila({
            deleted: true, ciphertext: null, baseRev: primera.results[0].rev
        })]);

        const guardada = await db.prepare('SELECT ciphertext, deleted FROM records').first();
        assert.equal(guardada.ciphertext, null, 'una lápida no lleva cuerpo');
        assert.equal(guardada.deleted, 1);

        const bajada = await cuerpo(await llamar('/api/sync', { env, token }));
        assert.equal(bajada.rows[0].deleted, true);
        assert.equal(bajada.rows[0].ciphertext, null);
    } finally { close(); }
});

test('seq va de uno en uno dentro del lote, y el cursor no se salta filas', async () => {
    const { env, token, close } = await vacia();
    try {
        const filas = [1, 2, 3, 4].map((i) => fila({ itemTag: etiqueta(i), ciphertext: sobre(i) }));
        const o = await cuerpo(await subir(env, token, filas));
        assert.deepEqual(o.results.map((/** @type {*} */ x) => x.seq), [1, 2, 3, 4]);
        assert.equal(o.lastSeq, 4);

        // Y pedir desde el 2 trae exactamente las dos últimas.
        const bajada = await cuerpo(await llamar('/api/sync?since=2', { env, token }));
        assert.deepEqual(bajada.rows.map((/** @type {*} */ x) => x.seq), [3, 4]);
    } finally { close(); }
});

test('más de cincuenta filas se rechazan sin tocar la base', async () => {
    const { env, db, token, close } = await vacia();
    try {
        const filas = Array.from({ length: 51 }, (_, i) =>
            fila({ itemTag: encode(new Uint8Array(16).fill(i)) }));
        assert.equal((await subir(env, token, filas)).status, 413);
        const n = await db.prepare('SELECT COUNT(*) AS n FROM records').first();
        assert.equal(n.n, 0);
    } finally { close(); }
});

test('un criptograma desmesurado se rechaza: no es almacenamiento gratis', async () => {
    const { env, token, close } = await vacia();
    try {
        const enorme = encode(new Uint8Array(128 * 1024 + 1));
        assert.equal((await subir(env, token, [fila({ ciphertext: enorme })])).status, 400);
    } finally { close(); }
});

test('sin sesión no se sube nada', async () => {
    const { env, db, close } = await vacia();
    try {
        assert.equal((await subir(env, null, [fila({})])).status, 401);
        const n = await db.prepare('SELECT COUNT(*) AS n FROM records').first();
        assert.equal(n.n, 0);
    } finally { close(); }
});

test('la misma etiqueta en dos cuentas son dos filas: nadie pisa a nadie', async () => {
    const { env, db, token, close } = await vacia();
    try {
        const ahora = Date.now();
        await createAccount(env, {
            userId: 'u_beto', credentialId: 'c_beto', publicKey: new Uint8Array(91),
            algorithm: -7, signCount: 0, now: ahora
        });
        const otra = await openSession(env, {
            userId: 'u_beto', credentialId: 'c_beto', ip: null, now: ahora
        });

        await subir(env, token, [fila({ ciphertext: sobre(0xAA) })]);
        await subir(env, otra.token, [fila({ ciphertext: sobre(0xBB) })]);

        const filas = await db.prepare('SELECT user_id, ciphertext FROM records ORDER BY user_id').all();
        assert.equal(filas.results.length, 2);
        assert.deepEqual(filas.results.map((/** @type {*} */ r) => r.user_id), ['u_ana', 'u_beto']);
        // Y cada uno solo ve la suya.
        const deAna = await cuerpo(await llamar('/api/sync', { env, token }));
        assert.equal(deAna.rows.length, 1);
        assert.deepEqual(new Uint8Array(decode(deAna.rows[0].ciphertext)),
            new Uint8Array(64).fill(0xAA));
    } finally { close(); }
});

test('las versiones perdedoras se pueden recuperar, y solo las propias', async () => {
    const { env, token, close } = await vacia();
    try {
        await subir(env, token, [fila({ ciphertext: sobre(0xAA) })]);
        await subir(env, token, [fila({ ciphertext: sobre(0xBB), baseRev: 0 })]);

        const o = await cuerpo(await llamar('/api/sync/conflicts', { env, token }));
        assert.equal(o.rows.length, 1);
        assert.equal(o.rows[0].collection, 'checkins');
        assert.equal(o.rows[0].rev, 1);
        assert.deepEqual(new Uint8Array(decode(o.rows[0].ciphertext)),
            new Uint8Array(64).fill(0xAA));

        // Y el recuento aparece en las estadísticas de la cuenta.
        const stats = await cuerpo(await llamar('/api/account/records', { env, token }));
        assert.equal(stats.conflicts, 1);
    } finally { close(); }
});

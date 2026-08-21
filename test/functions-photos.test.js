// @ts-check

/**
 * Las fotos en R2, lado servidor (M9-5).
 *
 * Lo que se fija aquí es distinto de lo demás del backend, porque las fotos son
 * lo único que puede llenar algo: son objetos de cientos de kilobytes y el plan
 * gratuito tiene un fondo.
 *
 * | Invariante | Lo que evita |
 * |---|---|
 * | `cuota_atomica` | que dos subidas simultáneas pasen por un hueco que daba para una |
 * | `cuota_neta` | que reintentar una subida cortada cuente dos veces |
 * | `cuota_se_devuelve` | que un fallo de R2 le coma a alguien su cuota para siempre |
 * | `clave_acotada` | que un id con `../` escriba en la cuenta de otro |
 * | `borrado_barre_r2` | dar por cerrada una cuenta cuyas fotos siguen ahí (art. 17) |
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createD1 } from './helpers/d1-fake.js';
import { createR2, PAGINA } from './helpers/r2-fake.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequest as enrutador } from '../functions/api/[[path]].js';
import { createAccount, openSession } from '../functions/_lib/db.js';
import { COOKIE_NAME } from '../functions/_lib/sessions.js';
import { MAX_ACCOUNT_BYTES, MAX_OBJECT_BYTES } from '../functions/_handlers/photos.js';

const ORIGEN = 'https://motifyer.com';
const PERFIL = 'op4co1234567890abcdefg';

/** Una cuenta con sesión y un bucket vacío. */
async function conCuenta(userId = 'u_ana') {
    const d1 = createD1();
    const r2 = createR2();
    const env = /** @type {*} */ ({ DB: d1.db, PHOTOS: r2.bucket });
    const ahora = Date.now();
    await createAccount(env, {
        userId, credentialId: `c_${userId}`, publicKey: new Uint8Array(91),
        algorithm: -7, signCount: 0, now: ahora
    });
    const { token } = await openSession(env, {
        userId, credentialId: `c_${userId}`, ip: null, now: ahora
    });
    return { env, db: d1.db, close: d1.close, contenido: r2.contenido, token, userId };
}

/** @param {string} ruta */
function llamar(ruta, { env, token, method = 'GET', bytes = null } = {}) {
    /** @type {Record<string,string>} */ const headers = {};
    if (token) headers.Cookie = `${COOKIE_NAME}=${token}`;
    if (method !== 'GET') {
        headers.Origin = ORIGEN;
        headers['Content-Type'] = bytes ? 'application/octet-stream' : 'application/json';
    }
    const request = new Request(`${ORIGEN}${ruta}`, {
        method, headers,
        body: method === 'GET' ? undefined : (bytes ?? '{}')
    });
    /** @type {*} */ const ctx = {
        request, env, params: {}, data: {}, waitUntil: () => {},
        next: () => enrutador({ ...ctx, request })
    };
    return middleware(ctx);
}

const cuerpo = async (/** @type {Response} */ r) => JSON.parse(await r.text());

const subir = (env, token, id, bytes, perfil = PERFIL) =>
    llamar(`/api/photos/${id}?profile=${perfil}`, { env, token, method: 'PUT', bytes });

/** Un «criptograma» de relleno. Aquí nadie descifra: el servidor no puede. */
const sobre = (/** @type {number} */ n, /** @type {number} */ len) => new Uint8Array(len).fill(n);

/* ── Subir, bajar, borrar ────────────────────────────────────────────────── */

test('una foto sube, baja igual byte a byte, y se borra', async () => {
    const { env, token, contenido, userId, close } = await conCuenta();
    try {
        const datos = sobre(0xAB, 5_000);
        const r = await subir(env, token, 'ph_1', datos);
        assert.equal(r.status, 200);
        const o = await cuerpo(r);
        assert.equal(o.bytes, 5_000);
        assert.equal(o.used, 5_000);
        assert.equal(o.limit, MAX_ACCOUNT_BYTES);

        // La clave lleva el usuario PRIMERO: es lo que impide que un fallo en el
        // id de perfil cruce cuentas, y lo que hace que el inventario de una
        // cuenta sea un solo prefijo.
        assert.deepEqual([...contenido.keys()], [`u/${userId}/p/${PERFIL}/ph_1`]);

        const bajada = await llamar(`/api/photos/ph_1?profile=${PERFIL}`, { env, token });
        assert.equal(bajada.status, 200);
        assert.equal(bajada.headers.get('Content-Type'), 'application/octet-stream');
        assert.deepEqual(new Uint8Array(await bajada.arrayBuffer()), datos);

        const borrada = await llamar(`/api/photos/ph_1?profile=${PERFIL}`, { env, token, method: 'DELETE' });
        assert.equal(borrada.status, 200);
        assert.equal(contenido.size, 0);

        // Y la cuota vuelve a cero: si no, borrar fotos no liberaría sitio.
        const inv = await cuerpo(await llamar('/api/photos', { env, token }));
        assert.equal(inv.used, 0);
    } finally { close(); }
});

test('bajar algo que no existe es 404; borrarlo es un éxito', async () => {
    const { env, token, close } = await conCuenta();
    try {
        assert.equal((await llamar(`/api/photos/ph_x?profile=${PERFIL}`, { env, token })).status, 404);
        // Borrar lo que ya no está NO es un error: el cliente reintenta borrados
        // y tiene que poder darlos por hechos.
        const r = await llamar(`/api/photos/ph_x?profile=${PERFIL}`, { env, token, method: 'DELETE' });
        assert.equal(r.status, 200);
    } finally { close(); }
});

/* ── La clave ────────────────────────────────────────────────────────────── */

test('clave_acotada: ningún tramo se construye con lo que mande el cliente', async () => {
    const { env, token, contenido, close } = await conCuenta();
    try {
        /** @type {[string, string, string][]} */ const intentos = [
            ['sube un nivel por el perfil', '../../otro', 'ph_1'],
            ['sube un nivel por la foto', PERFIL, '..'],
            ['barra en el perfil', 'a/b', 'ph_1'],
            ['perfil vacío', '', 'ph_1'],
            ['punto en la foto', PERFIL, 'ph.1'],
            ['perfil desmesurado', 'x'.repeat(65), 'ph_1']
        ];
        for (const [porque, perfil, foto] of intentos) {
            const r = await subir(env, token, encodeURIComponent(foto), sobre(1, 10), encodeURIComponent(perfil));
            assert.ok(r.status >= 400, `se aceptó una clave que ${porque}`);
        }
        assert.equal(contenido.size, 0, 'alguna clave imposible llegó a escribir');
    } finally { close(); }
});

test('la foto de una cuenta no la ve la otra, aunque el id coincida', async () => {
    const ana = await conCuenta('u_ana');
    try {
        const ahora = Date.now();
        await createAccount(ana.env, {
            userId: 'u_beto', credentialId: 'c_beto', publicKey: new Uint8Array(91),
            algorithm: -7, signCount: 0, now: ahora
        });
        const beto = await openSession(ana.env, {
            userId: 'u_beto', credentialId: 'c_beto', ip: null, now: ahora
        });

        await subir(ana.env, ana.token, 'ph_1', sobre(0xAA, 100));
        await subir(ana.env, beto.token, 'ph_1', sobre(0xBB, 100));

        const deAna = await llamar(`/api/photos/ph_1?profile=${PERFIL}`, { env: ana.env, token: ana.token });
        assert.deepEqual(new Uint8Array(await deAna.arrayBuffer()), sobre(0xAA, 100));
        assert.equal(ana.contenido.size, 2, 'una cuenta pisó el objeto de la otra');
    } finally { ana.close(); }
});

/* ── La cuota ────────────────────────────────────────────────────────────── */

test('cuota_neta: resubir la MISMA foto no cuenta dos veces', async () => {
    const { env, token, close } = await conCuenta();
    try {
        await subir(env, token, 'ph_1', sobre(1, 4_000));
        const r = await cuerpo(await subir(env, token, 'ph_1', sobre(2, 6_000)));
        // 6.000, no 10.000: lo que suma es la diferencia. Sin esto, reintentar
        // una subida que se cortó a la mitad llenaría la cuenta con una foto.
        assert.equal(r.used, 6_000);
    } finally { close(); }
});

test('cuota_atomica: pasado el techo, se rechaza y no se escribe', async () => {
    const { env, token, db, contenido, close } = await conCuenta();
    try {
        // Se coloca el contador justo debajo del techo, que es más rápido que
        // subir cien megas y prueba exactamente lo mismo.
        await db.prepare('UPDATE users SET photo_bytes = ?1 WHERE id = ?2')
            .bind(MAX_ACCOUNT_BYTES - 1_000, 'u_ana').run();

        const r = await subir(env, token, 'ph_1', sobre(1, 2_000));
        assert.equal(r.status, 413);
        assert.equal((await cuerpo(r)).error, 'photos.quota');
        assert.equal(contenido.size, 0, 'se escribió pese a no caber');

        // Y lo que sí cabe, entra.
        assert.equal((await subir(env, token, 'ph_2', sobre(1, 500))).status, 200);
    } finally { close(); }
});

test('cuota_se_devuelve: si R2 falla, la reserva no se queda cobrada', async () => {
    const { env, token, close } = await conCuenta();
    try {
        env.PHOTOS.put = async () => { throw new Error('R2 caído'); };
        const r = await subir(env, token, 'ph_1', sobre(1, 3_000));
        assert.equal(r.status, 502);

        // Sin la devolución, cada fallo de R2 le comería a alguien un trozo de
        // su cuota para siempre, sin nada que lo ocupe.
        const inv = await cuerpo(await llamar('/api/photos', { env, token }));
        assert.equal(inv.used, 0, 'la reserva se quedó cobrada tras un fallo');
    } finally { close(); }
});

test('un objeto desmesurado se rechaza antes de tocar el bucket', async () => {
    const { env, token, contenido, close } = await conCuenta();
    try {
        const r = await subir(env, token, 'ph_1', new Uint8Array(MAX_OBJECT_BYTES + 1));
        assert.equal(r.status, 413);
        assert.equal(contenido.size, 0);
        // Y un cuerpo vacío tampoco: un objeto de cero bytes es una subida que
        // salió mal, no una foto.
        assert.equal((await subir(env, token, 'ph_2', new Uint8Array(0))).status, 400);
    } finally { close(); }
});

/* ── El inventario ───────────────────────────────────────────────────────── */

test('el inventario recorre TODAS las páginas de R2', async () => {
    const { env, token, close } = await conCuenta();
    try {
        const cuantas = PAGINA * 3 + 1;
        for (let i = 0; i < cuantas; i++) await subir(env, token, `ph_${i}`, sobre(i, 100));

        const inv = await cuerpo(await llamar('/api/photos', { env, token }));
        assert.equal(inv.complete, true);
        assert.equal(inv.objects.length, cuantas,
            'el inventario se quedó en la primera página: un barrido sobre esto borra fotos vivas');
        assert.deepEqual([...new Set(inv.objects.map((/** @type {*} */ o) => o.profileId))], [PERFIL]);
        assert.equal(inv.used, cuantas * 100);
    } finally { close(); }
});

test('el inventario de una cuenta no lista las fotos de la otra', async () => {
    const ana = await conCuenta('u_ana');
    try {
        const ahora = Date.now();
        await createAccount(ana.env, {
            userId: 'u_beto', credentialId: 'c_beto', publicKey: new Uint8Array(91),
            algorithm: -7, signCount: 0, now: ahora
        });
        const beto = await openSession(ana.env, {
            userId: 'u_beto', credentialId: 'c_beto', ip: null, now: ahora
        });
        await subir(ana.env, ana.token, 'ph_1', sobre(1, 100));
        await subir(ana.env, beto.token, 'ph_2', sobre(2, 100));

        const inv = await cuerpo(await llamar('/api/photos', { env: ana.env, token: ana.token }));
        assert.deepEqual(inv.objects.map((/** @type {*} */ o) => o.photoId), ['ph_1']);
    } finally { ana.close(); }
});

/* ── Sin sesión ──────────────────────────────────────────────────────────── */

test('sin sesión, ninguna ruta de fotos contesta', async () => {
    const { env, contenido, close } = await conCuenta();
    try {
        assert.equal((await llamar('/api/photos', { env })).status, 401);
        assert.equal((await llamar(`/api/photos/ph_1?profile=${PERFIL}`, { env })).status, 401);
        assert.equal((await subir(env, null, 'ph_1', sobre(1, 100))).status, 401);
        assert.equal((await llamar(`/api/photos/ph_1?profile=${PERFIL}`, { env, method: 'DELETE' })).status, 401);
        assert.equal(contenido.size, 0);
    } finally { close(); }
});

/* ── El borrado de cuenta (RGPD art. 17) ─────────────────────────────────── */

test('borrado_barre_r2: cerrar la cuenta se lleva TODAS sus fotos', async () => {
    const ana = await conCuenta('u_ana');
    try {
        const ahora = Date.now();
        await createAccount(ana.env, {
            userId: 'u_beto', credentialId: 'c_beto', publicKey: new Uint8Array(91),
            algorithm: -7, signCount: 0, now: ahora
        });
        const beto = await openSession(ana.env, {
            userId: 'u_beto', credentialId: 'c_beto', ip: null, now: ahora
        });

        // Más de una página, para que el barrido tenga que dar varias vueltas.
        for (let i = 0; i < PAGINA * 2 + 1; i++) await subir(ana.env, ana.token, `ph_${i}`, sobre(i, 100));
        await subir(ana.env, beto.token, 'ph_beto', sobre(9, 100));

        const r = await llamar('/api/account', { env: ana.env, token: ana.token, method: 'DELETE' });
        assert.equal(r.status, 200);
        assert.equal((await cuerpo(r)).photos, PAGINA * 2 + 1);

        // Ni una foto de Ana, y las de Beto intactas.
        assert.deepEqual([...ana.contenido.keys()], ['u/u_beto/p/' + PERFIL + '/ph_beto']);
    } finally { ana.close(); }
});

test('si R2 falla al barrer, la cuenta NO se da por borrada', async () => {
    // Dar por cerrada una cuenta cuyas fotos siguen ahí es exactamente lo que el
    // artículo 17 prohíbe, y de las cosas que nadie descubre hasta que las
    // descubre alguien de fuera.
    const { env, db, token, close } = await conCuenta();
    try {
        await subir(env, token, 'ph_1', sobre(1, 100));
        env.PHOTOS.delete = async () => { throw new Error('R2 caído'); };

        const r = await llamar('/api/account', { env, token, method: 'DELETE' });
        assert.equal(r.status, 502);
        assert.equal((await cuerpo(r)).error, 'account.photosNotDeleted');

        const n = /** @type {*} */ (await db.prepare('SELECT COUNT(*) AS n FROM users').first());
        assert.equal(n.n, 1, 'se borró la cuenta dejando las fotos');
    } finally { close(); }
});

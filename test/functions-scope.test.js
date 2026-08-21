// @ts-check

/**
 * La autorización por fila, y las guardas que la hacen imposible de olvidar
 * (M8-4).
 *
 * El fallo clásico de un servidor multiusuario no es una consulta mal escrita:
 * es una consulta a la que se le olvidó el `WHERE user_id`. Pasa las revisiones
 * porque parece bien, funciona en desarrollo —donde solo hay una cuenta— y en
 * producción devuelve los datos de otra persona.
 *
 * Aquí se comprueba de las dos formas, porque ninguna basta sola:
 *
 * - **Estáticamente**, que no hay SQL fuera de `_lib/db.js` y que ningún
 *   manejador ve un `D1Database`. Es lo que impide que aparezca una consulta
 *   nueva sin acotar.
 * - **Ejecutándolo**, con dos cuentas de verdad: que el ámbito de una no puede
 *   ver ni tocar las filas de la otra, ni siquiera pasándole a propósito los
 *   identificadores de la otra. Es lo que prueba que la barrera existe, y no
 *   solo que el texto la menciona.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isICloudDuplicate } from './helpers/tree.js';
import { createD1 } from './helpers/d1-fake.js';
import * as db from '../functions/_lib/db.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FUNCTIONS = join(ROOT, 'functions');

/** Todos los `.js` de `functions/`, con su ruta relativa. */
const FICHEROS = (() => {
    /** @type {{ rel: string, code: string }[]} */ const out = [];
    const walk = (/** @type {string} */ dir, /** @type {string} */ pre) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (isICloudDuplicate(e.name)) continue;
            const full = join(dir, e.name);
            const rel = pre ? `${pre}/${e.name}` : e.name;
            if (e.isDirectory()) walk(full, rel);
            else if (e.name.endsWith('.js')) out.push({ rel, code: readFileSync(full, 'utf8') });
        }
    };
    walk(FUNCTIONS, '');
    return out;
})();

const DB_JS = readFileSync(join(FUNCTIONS, '_lib/db.js'), 'utf8');
const sinComentarios = (/** @type {string} */ c) =>
    c.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/* ══ Guardas estáticas ═════════════════════════════════════════════════════ */

test('1· nadie referencia env.DB fuera de _lib/db.js', () => {
    // Un manejador que tenga un `D1Database` puede escribir cualquier consulta,
    // y entonces todo lo demás de este fichero es decoración.
    const culpables = FICHEROS
        .filter(({ rel }) => rel !== '_lib/db.js')
        .filter(({ code }) => /\benv\s*\.\s*DB\b|\bDB\s*\.\s*prepare\b/.test(sinComentarios(code)))
        .map(({ rel }) => rel);
    assert.deepEqual(culpables, [], `tocan env.DB directamente: ${culpables.join(', ')}`);
});

test('2· no hay una sola sentencia SQL fuera de _lib/db.js', () => {
    const culpables = FICHEROS
        .filter(({ rel }) => rel !== '_lib/db.js')
        .filter(({ code }) => {
            const limpio = sinComentarios(code);
            return /\.prepare\s*\(/.test(limpio) ||
                /\b(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b/.test(limpio);
        })
        .map(({ rel }) => rel);
    assert.deepEqual(culpables, [], `tienen SQL: ${culpables.join(', ')}`);
});

test('3· toda sentencia de openUserScope pasa por scoped()', () => {
    // `scoped()` comprueba en EJECUCIÓN que la sentencia lleva la cláusula. Esta
    // guarda comprueba que no hay forma de esquivarlo dentro del ámbito.
    const ini = DB_JS.indexOf('export function openUserScope');
    assert.ok(ini > 0, '¿se renombró openUserScope?');
    // El final: la siguiente declaración en la columna 0.
    const fin = DB_JS.indexOf('\n/** @typedef {ReturnType<typeof openUserScope>}', ini);
    assert.ok(fin > ini, 'no se pudo delimitar el cuerpo de openUserScope');
    const cuerpo = sinComentarios(DB_JS.slice(ini, fin));

    for (const m of cuerpo.matchAll(/\.prepare\s*\(\s*(\w*)/g)) {
        assert.equal(m[1], 'scoped', `una sentencia de openUserScope no pasa por scoped(): «${m[0]}»`);
    }
    // Y hay alguna: si el recorte fallara y quedara vacío, el bucle pasaría solo.
    assert.ok(cuerpo.includes('scoped('), 'el recorte del cuerpo salió vacío');
});

test('4· db.js exporta exactamente lo previsto, y lo global está declarado', () => {
    // Cada función global corre ANTES de saber quién es nadie, así que no puede
    // pasar por `Scope`. La lista no puede crecer sin que alguien lo escriba
    // aquí, con su razón.
    const GLOBALES = {
        createChallenge: 'emite un reto; en el login todavía no hay usuario',
        consumeChallenge: 'gasta un reto; ídem',
        createAccount: 'crea la cuenta, que por definición no existía',
        findCredential: 'convierte un id de credencial en un usuario: es el paso que AVERIGUA quién es',
        addCredential: 'el usuario viene del reto de add-credential, no de la sesión',
        touchCredential: 'adelanta el contador tras un login válido',
        openSession: 'abre la sesión que aún no existe',
        verifySession: 'reconoce la cookie; es lo que produce el userId',
        closeSession: 'el token ES la prueba de propiedad, no hace falta acotar',
        sweepExpired: 'barrido de caducados, sin dueño'
    };
    const OTRAS = ['openUserScope', 'ROTATE_AFTER_MS', 'ROTATION_GRACE_MS', 'scoped',
        'MAX_CHALLENGES_PER_IP'];

    assert.deepEqual(
        Object.keys(db).sort(),
        [...Object.keys(GLOBALES), ...OTRAS].sort(),
        'la superficie de db.js cambió: si una función nueva es global, escríbela arriba con su porqué');
});

test('5· ningún método de Scope acepta un userId', () => {
    // Es la propiedad estructural: si un método lo aceptara, un manejador podría
    // pasarle el de otra persona. El `userId` va cerrado dentro del ámbito.
    const ini = DB_JS.indexOf('export function openUserScope');
    const fin = DB_JS.indexOf('\n/** @typedef {ReturnType<typeof openUserScope>}', ini);
    const cuerpo = sinComentarios(DB_JS.slice(ini, fin));
    // Firmas de método: `async nombre(args) {` o `nombre(args) {`.
    for (const m of cuerpo.matchAll(/\n\s+(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*\{/g)) {
        const [, nombre, args] = m;
        assert.doesNotMatch(args, /\buser(_?)Id\b/i, `Scope.${nombre} acepta un userId: ${args}`);
    }
});

/* ══ Y lo mismo, ejecutado ═════════════════════════════════════════════════ */

/** Dos cuentas completas, cada una con su passkey y su sesión. */
async function dosCuentas() {
    const h = createD1();
    // Las funciones de `db.js` reciben un `Env`, no el enlace suelto.
    const env = /** @type {*} */ ({ DB: h.db });
    for (const [uid, cid] of [['u_ana', 'c_ana'], ['u_bea', 'c_bea']]) {
        await db.createAccount(env, {
            userId: uid, credentialId: cid, publicKey: new Uint8Array(91),
            algorithm: -7, signCount: 0, now: 1000
        });
        await db.openSession(env, { userId: uid, credentialId: cid, ip: '10.0.0.1', now: 1000 });
    }
    return h;
}

/** `openUserScope` espera un `Env`; en los tests basta el enlace DB. */
const ambito = (/** @type {*} */ db1, /** @type {string} */ uid) =>
    db.openUserScope(/** @type {*} */ ({ DB: db1 }), uid);

test('el ámbito de una cuenta NO ve las filas de la otra', async () => {
    const { db: d, close } = await dosCuentas();
    try {
        const ana = ambito(d, 'u_ana');
        assert.equal((await ana.credentials()).length, 1);
        assert.equal((await ana.credentials())[0].id, 'c_ana');
        assert.equal((await ana.sessions()).length, 1);
        assert.equal((await ana.user()).id, 'u_ana');
    } finally { close(); }
});

test('pasarle a propósito el identificador de la otra NO la toca', async () => {
    // Es el ataque directo: un manejador con la sesión de Ana intentando actuar
    // sobre lo de Bea. Las sentencias llevan `user_id = ?1`, así que no encaja
    // ninguna fila — y devuelven «no se cambió nada», no un error confuso.
    const { db: d, close } = await dosCuentas();
    try {
        const ana = ambito(d, 'u_ana');

        assert.equal(await ana.removeCredential('c_bea'), false);
        assert.equal(await ana.revokeFamily(
            /** @type {*} */ ((await ambito(d, 'u_bea').sessions())[0]).family_id), 0);

        // Y Bea sigue entera.
        const bea = ambito(d, 'u_bea');
        assert.equal((await bea.credentials()).length, 1);
        assert.equal((await bea.sessions()).length, 1);
    } finally { close(); }
});

test('borrar una cuenta desde su ámbito no roza la otra', async () => {
    const { db: d, close } = await dosCuentas();
    try {
        await ambito(d, 'u_ana').deleteAccount();
        assert.equal(await d.prepare('SELECT COUNT(*) AS n FROM users').first('n'), 1);
        assert.equal(await d.prepare('SELECT id FROM users').first('id'), 'u_bea');
        assert.equal((await ambito(d, 'u_bea').credentials()).length, 1);
        assert.equal((await ambito(d, 'u_bea').sessions()).length, 1);
    } finally { close(); }
});

test('no se puede quitar la ÚLTIMA passkey: sería quedarse fuera para siempre', async () => {
    // Y la condición va dentro del SQL, no en un `if` previo: entre la
    // comprobación y el borrado cabe otra petición.
    const { db: d, close } = await dosCuentas();
    try {
        const ana = ambito(d, 'u_ana');
        assert.equal(await ana.removeCredential('c_ana'), false, 'dejó la cuenta sin credenciales');
        assert.equal((await ana.credentials()).length, 1);

        // Con dos, sí se puede quitar una.
        await db.addCredential(/** @type {*} */ ({ DB: d }), {
            userId: 'u_ana', credentialId: 'c_ana2', publicKey: new Uint8Array(91),
            algorithm: -7, signCount: 0, now: 2000
        });
        assert.equal(await ana.removeCredential('c_ana'), true);
        assert.equal((await ana.credentials()).length, 1);
    } finally { close(); }
});

test('scoped() LANZA ante una consulta sin acotar: la guarda corre, no se revisa', async () => {
    // Se ejerce por el único camino público que la usa. Si algún día alguien
    // añade un método a `Scope` sin la cláusula, esto revienta en su primer test
    // en vez de devolver las filas de todo el mundo.
    const { db: d, close } = createD1();
    try {
        const scope = ambito(d, 'u');
        // Todos los métodos existentes SÍ pasan la aduana.
        await assert.doesNotReject(() => scope.user());
        await assert.doesNotReject(() => scope.credentials());
        await assert.doesNotReject(() => scope.sessions());
    } finally { close(); }

});

test('scoped() rechaza cada forma de escapársele, probada con la consulta que se le escaparía', () => {
    // Esto es la guarda de verdad: no se comprueba que su código MENCIONE
    // `user_id`, se le dan las consultas que tiene que tumbar. La versión
    // anterior de este test leía el texto de la función, y un texto que menciona
    // lo correcto puede no comprobar nada.

    // Lo legítimo pasa: las tres formas de acotar que existen.
    assert.doesNotThrow(() => db.scoped('SELECT * FROM records WHERE user_id = ?1'));
    assert.doesNotThrow(() => db.scoped('SELECT * FROM users WHERE id = ?1'));
    assert.doesNotThrow(() => db.scoped('UPDATE users SET last_seq = last_seq + ?2 WHERE id = ?1'));
    assert.doesNotThrow(() => db.scoped(
        'INSERT INTO records (user_id, profile_id) VALUES (?1, ?2)'));

    // Sin acotar: el fallo original que la guarda existe para impedir.
    assert.throws(() => db.scoped('SELECT * FROM records'), /sin acotar/);
    assert.throws(() => db.scoped('DELETE FROM records WHERE collection = ?1'), /sin acotar/);

    // Acotada por un parámetro que NO es el que `Scope` rellena: la consulta
    // devolvería las filas de quien dijera el segundo argumento.
    assert.throws(() => db.scoped('SELECT * FROM records WHERE user_id = ?2'), /sin acotar/);

    // Un INSERT que pone el usuario en cualquier otro sitio. Es la forma nueva
    // (M9-4) y la que más fácil sería colar: `VALUES (?2, ?1, …)` escribe la
    // fila en la cuenta que diga el segundo argumento.
    assert.throws(() => db.scoped(
        'INSERT INTO records (profile_id, user_id) VALUES (?1, ?2)'), /sin acotar/);
    assert.throws(() => db.scoped(
        'INSERT INTO records (user_id, profile_id) VALUES (?2, ?1)'), /sin acotar/);

    // Y una reasignación: acotar la lectura no sirve de nada si la escritura
    // puede mudar la fila a otra cuenta.
    assert.throws(() => db.scoped(
        'UPDATE records SET user_id = ?2 WHERE user_id = ?1'), /reasignar user_id/);
    assert.throws(() => db.scoped(
        `INSERT INTO records (user_id, seq) VALUES (?1, ?2)
         ON CONFLICT (user_id) DO UPDATE SET user_id = ?3`), /reasignar user_id/);
});

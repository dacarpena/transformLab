// @ts-check

/**
 * La sincronización, lado cliente: el pull (M9-3b) y el push (M9-4).
 *
 * ## Cómo está montado esto, y por qué así
 *
 * No hay dobles de `sync.js`. Hay **dos dispositivos de verdad** —dos almacenes
 * locales distintos, el mismo módulo, la misma cuenta y la misma clave— contra
 * un **servidor de mentira con la semántica del de verdad**: revisiones que solo
 * suben, `seq` por cuenta, lápidas sin cuerpo y el perdedor archivado.
 *
 * Es más trabajo que simular respuestas a mano, y es la única forma de poder
 * afirmar lo que de verdad importa: que dos dispositivos que editan a la vez
 * **convergen**. Un test que fabrica la respuesta del servidor demuestra que el
 * cliente sabe leerla, no que el sistema llegue a algún sitio.
 *
 * ## Lo que protegen, ordenado por lo que duele
 *
 * | Invariante | Lo que evita |
 * |---|---|
 * | `nada_se_pierde` | que sincronizar borre una edición que solo estaba aquí |
 * | `convergen` | que los dos dispositivos se manden la misma fila para siempre |
 * | `borrar_viaja` | que borrar en un sitio sea invisible en el otro |
 * | `cursor_despues` | que una escritura fallida deje filas sin pedir NUNCA más |
 * | `no_borrado_masivo` | que un almacén vaciado destruya los datos en todos los dispositivos |
 * | `servidor_no_es_de_fiar` | que lo que llegue escriba sin pasar el control de un backup |
 * | `aad_ata_la_fila` | que alguien baraje filas en el servidor sin romper ningún tag |
 */

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LocalStorageMock } from './helpers/local-storage-mock.js';
import { installIndexedDbMock, uninstallIndexedDbMock } from './helpers/indexed-db-mock.js';
import * as storage from '../src/data/storage.js';
import * as profiles from '../src/data/profiles.js';
import * as keysDb from '../src/data/keys-db.js';
import * as sync from '../src/data/sync.js';
import { importDataKey, deriveIndexKey, encryptBytes, itemTag } from '../src/data/crypto.js';
import { SCHEMA_VERSION } from '../src/data/version.js';
import { COLLECTIONS } from '../src/data/schema.js';
import { NO_PROFILE } from '../src/data/ids.js';

const ORIGEN = 'https://motifyer.com';
const USER = 'u_ana';
const PERFIL = 'op4co1234567890abcdefg';

/* ══ El servidor de mentira ═════════════════════════════════════════════════ */

/**
 * Las mismas reglas que `functions/_handlers/sync.js` y `_lib/db.js`.
 *
 * Se reimplementan aquí a propósito en vez de importar el servidor: lo que se
 * prueba es que el CLIENTE es correcto contra un servidor que se comporta como
 * el contrato dice, no que las dos mitades compartan el mismo error.
 */
function servidorFalso() {
    /** @type {Map<string, *>} */ const filas = new Map();
    /** @type {*[]} */ const perdedoras = [];
    let lastSeq = 0;
    let reloj = 1000;
    /** @type {*[]} */ const peticiones = [];

    const clave = (/** @type {*} */ f) => `${f.profileId}|${f.collection}|${f.itemTag}`;

    return {
        filas, perdedoras, peticiones,
        get lastSeq() { return lastSeq; },

        /** @param {string} url @param {*} [init] */
        responder(url, init) {
            peticiones.push({ url, method: init?.method ?? 'GET' });
            const u = new URL(url, ORIGEN);

            if (u.pathname === '/api/sync' && (init?.method ?? 'GET') === 'GET') {
                const since = Number(u.searchParams.get('since') ?? '0');
                const rows = [...filas.values()]
                    .filter((f) => f.seq > since)
                    .sort((a, b) => a.seq - b.seq)
                    .map((f) => ({
                        profileId: f.profileId, collection: f.collection, itemTag: f.itemTag,
                        ciphertext: f.deleted ? null : f.ciphertext,
                        rev: f.rev, seq: f.seq, updatedAt: f.updatedAt, deleted: f.deleted
                    }));
                return { rows, nextSince: rows.at(-1)?.seq ?? since, hasMore: false, lastSeq };
            }

            if (u.pathname === '/api/sync' && init?.method === 'POST') {
                const entrada = JSON.parse(init.body).rows;
                const results = entrada.map((/** @type {*} */ f) => {
                    const k = clave(f);
                    const previa = filas.get(k);
                    const conflict = Boolean(previa && previa.rev > f.baseRev);
                    // El perdedor se archiva ANTES de que lo pisen. Igual que en
                    // el servidor de verdad, y por la misma razón.
                    if (conflict) perdedoras.push({ ...previa });
                    lastSeq += 1;
                    reloj += 1;
                    filas.set(k, {
                        profileId: f.profileId, collection: f.collection, itemTag: f.itemTag,
                        ciphertext: f.deleted ? null : f.ciphertext,
                        rev: previa ? previa.rev + 1 : 1,
                        seq: lastSeq, updatedAt: reloj, deleted: f.deleted
                    });
                    return { itemTag: f.itemTag, rev: filas.get(k).rev, seq: lastSeq, conflict };
                });
                return { results, conflicts: results.filter((/** @type {*} */ r) => r.conflict).length, lastSeq };
            }

            throw new Error(`el servidor de mentira no conoce ${init?.method ?? 'GET'} ${u.pathname}`);
        }
    };
}

/* ══ Dos dispositivos ═══════════════════════════════════════════════════════ */

/** @type {ReturnType<typeof servidorFalso>} */ let servidor;
/** @type {*} */ let originales;
/** @type {CryptoKey} */ let dk;
/** @type {CryptoKey} */ let ik;
/** @type {{ status?: number, error?: boolean, body?: string } | null} */ let averia;

/**
 * Un dispositivo: su propio `localStorage`.
 *
 * Con `virgen: true` no tiene índice de perfiles, que es lo que de verdad es un
 * teléfono recién estrenado: ni datos, ni nombres, ni saber que ese perfil
 * existe.
 *
 * @param {string} _nombre
 * @param {{ virgen?: boolean }} [opciones]
 */
function dispositivo(_nombre, opciones = {}) {
    const store = new LocalStorageMock();
    const antes = /** @type {*} */ (globalThis).localStorage;
    /** @type {*} */ (globalThis).localStorage = store;
    if (!opciones.virgen) {
        storage.setGlobal('profiles', {
            schemaVersion: SCHEMA_VERSION,
            activeProfileId: PERFIL,
            profiles: [{ id: PERFIL, name: 'Ana', createdAtISO: '2026-05-01T08:00:00.000Z' }]
        });
    }
    /** @type {*} */ (globalThis).localStorage = antes;

    return {
        store,
        /**
         * Corre algo «en» este dispositivo.
         * @template T @param {() => T | Promise<T>} fn @returns {Promise<T>}
         */
        async en(fn) {
            const previo = /** @type {*} */ (globalThis).localStorage;
            /** @type {*} */ (globalThis).localStorage = store;
            storage.setActiveProfile(NO_PROFILE);
            try {
                return await fn();
            } finally {
                /** @type {*} */ (globalThis).localStorage = previo;
            }
        }
    };
}

beforeEach(async () => {
    servidor = servidorFalso();
    averia = null;
    keysDb.resetForTests();
    installIndexedDbMock();
    /** @type {*} */ (globalThis).localStorage = new LocalStorageMock();

    originales = { fetch: globalThis.fetch, location: /** @type {*} */ (globalThis).location };
    /** @type {*} */ (globalThis).location = new URL(`${ORIGEN}/`);
    globalThis.fetch = /** @type {*} */ (async (/** @type {string} */ url, /** @type {*} */ init) => {
        if (averia?.error) throw new TypeError('failed to fetch');
        if (averia?.status) return new Response(averia.body ?? '{}', { status: averia.status });
        return new Response(JSON.stringify(servidor.responder(url, init)), { status: 200 });
    });

    const cruda = new Uint8Array(32).fill(7);
    dk = await importDataKey(cruda);
    ik = await deriveIndexKey(cruda);
    await keysDb.put(USER, dk, ik);
});

afterEach(() => {
    globalThis.fetch = originales.fetch;
    /** @type {*} */ (globalThis).location = originales.location;
    keysDb.resetForTests();
    uninstallIndexedDbMock();
});

/* ══ Utilidades ═════════════════════════════════════════════════════════════ */

/** Un check-in con su fecha. */
const checkin = (/** @type {string} */ dateISO, /** @type {*} */ extra = {}) => ({
    id: `ci_${dateISO}`, dateISO, weightKg: 88, fatPct: null, scaleMuscleKg: null,
    boneKg: null, measuresCm: {}, subjective: {}, notes: '',
    createdAtISO: '2026-05-01T08:00:00.000Z', editedAtISO: null, ...extra
});

/** Escribe una colección de check-ins en el dispositivo actual. */
const ponerCheckins = (/** @type {*[]} */ items) =>
    storage.setForProfile(PERFIL, 'checkins', { schemaVersion: SCHEMA_VERSION, items });

/** Los check-ins guardados en el dispositivo actual. */
const leerCheckins = () =>
    /** @type {*} */ (storage.getForProfile(PERFIL, 'checkins').value)?.items ?? [];

function b64u(/** @type {Uint8Array} */ bytes) {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Mete una fila en el servidor como si la hubiera subido otro dispositivo. */
async function sembrar({ collection = 'checkins', keyPath, value, deleted = false, tag = null }) {
    const etiqueta = tag ?? b64u(await itemTag(ik, collection, keyPath));
    const ciphertext = deleted ? null : b64u(await encryptBytes(
        dk, new TextEncoder().encode(JSON.stringify({ keyPath, value })),
        `${collection}/${etiqueta}`));
    servidor.responder('/api/sync', {
        method: 'POST',
        body: JSON.stringify({ rows: [{ profileId: PERFIL, collection, itemTag: etiqueta, ciphertext, deleted, baseRev: 0 }] })
    });
    return etiqueta;
}

/* ══ Un dispositivo nuevo se lo trae todo ═══════════════════════════════════ */

test('un dispositivo VACÍO se trae las filas y las escribe bien', async () => {
    await sembrar({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01', { weightKg: 90 }) });
    await sembrar({ keyPath: ['items', '2026-05-08'], value: checkin('2026-05-08', { weightKg: 89 }) });

    const a = dispositivo('A');
    const r = await a.en(() => sync.pull(USER));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.applied, 2);
    assert.equal(r.merged, 0);
    assert.equal(r.undecryptable, 0);

    await a.en(() => {
        const items = leerCheckins();
        assert.deepEqual(items.map((/** @type {*} */ i) => i.dateISO), ['2026-05-01', '2026-05-08']);
        assert.equal(items[0].weightKg, 90);
        assert.ok(sync.localIsValid(PERFIL, 'checkins'), 'se escribió algo que el esquema rechaza');
    });
});

test('el pull no pide dos veces lo mismo: el cursor viaja en la petición', async () => {
    await sembrar({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01') });
    const a = dispositivo('A');

    await a.en(() => sync.pull(USER));
    const primera = servidor.peticiones.filter((p) => p.method === 'GET').at(-1);
    assert.match(primera.url, /since=0/);

    await a.en(() => sync.pull(USER));
    const segunda = servidor.peticiones.filter((p) => p.method === 'GET').at(-1);
    assert.match(segunda.url, /since=1/, 'el cursor no avanzó');
});

/* ══ La ida y vuelta entre dos dispositivos ═════════════════════════════════ */

test('convergen: lo que escribe A aparece en B, y viceversa', async () => {
    const a = dispositivo('A');
    const b = dispositivo('B');

    await a.en(async () => {
        ponerCheckins([checkin('2026-05-01')]);
        const r = await sync.push(USER);
        assert.equal(r.ok, true, r.error);
        assert.equal(r.pushed, 1);
    });

    await b.en(async () => {
        const r = await sync.sync(USER);
        assert.equal(r.ok, true, r.error);
        assert.deepEqual(leerCheckins().map((/** @type {*} */ i) => i.dateISO), ['2026-05-01']);
    });

    // B añade otro y lo sube; A se lo trae.
    await b.en(async () => {
        ponerCheckins([...leerCheckins(), checkin('2026-05-08')]);
        await sync.push(USER);
    });
    await a.en(async () => {
        await sync.pull(USER);
        assert.deepEqual(leerCheckins().map((/** @type {*} */ i) => i.dateISO),
            ['2026-05-01', '2026-05-08']);
    });
});

test('convergen: dos ediciones simultáneas de la MISMA fila acaban iguales en los dos', async () => {
    const a = dispositivo('A');
    const b = dispositivo('B');

    // Los dos parten de la misma fila sincronizada.
    await a.en(async () => { ponerCheckins([checkin('2026-05-01')]); await sync.push(USER); });
    await b.en(() => sync.sync(USER));

    // Sin verse, A apunta la cintura y B apunta el porcentaje de grasa.
    await a.en(async () => {
        ponerCheckins([checkin('2026-05-01', { measuresCm: { waist: 84 } })]);
        await sync.push(USER);
    });
    await b.en(async () => {
        ponerCheckins([checkin('2026-05-01', { fatPct: 19.5 })]);
        await sync.sync(USER);
    });
    await a.en(() => sync.sync(USER));
    await b.en(() => sync.sync(USER));

    // NADA SE PIERDE: las dos medidas están, en los dos dispositivos.
    /** @type {*} */ let deA;
    await a.en(() => { deA = leerCheckins(); });
    /** @type {*} */ let deB;
    await b.en(() => { deB = leerCheckins(); });

    assert.equal(deA.length, 1);
    assert.equal(deA[0].measuresCm.waist, 84, 'se perdió la cintura de A');
    assert.equal(deA[0].fatPct, 19.5, 'se perdió la grasa de B');
    assert.deepEqual(deA, deB, 'los dos dispositivos no acabaron en el mismo estado');
});

test('convergen: y luego se CALLAN. Sincronizar dos veces seguidas no sube nada', async () => {
    const a = dispositivo('A');
    const b = dispositivo('B');
    await a.en(async () => { ponerCheckins([checkin('2026-05-01')]); await sync.push(USER); });
    await b.en(async () => {
        ponerCheckins([checkin('2026-05-01', { notes: 'buena semana' })]);
        await sync.sync(USER);
    });
    await a.en(() => sync.sync(USER));
    await b.en(() => sync.sync(USER));

    // Una vuelta más: si el diseño hiciera ping-pong, aquí subiría algo.
    const antes = servidor.lastSeq;
    await a.en(() => sync.sync(USER));
    await b.en(() => sync.sync(USER));
    await a.en(() => sync.sync(USER));
    assert.equal(servidor.lastSeq, antes,
        'los dispositivos siguen mandándose la fila: no convergen, oscilan');
});

/* ══ Borrar ═════════════════════════════════════════════════════════════════ */

test('borrar_viaja: lo que A borra desaparece en B', async () => {
    const a = dispositivo('A');
    const b = dispositivo('B');

    await a.en(async () => {
        ponerCheckins([checkin('2026-05-01'), checkin('2026-05-08')]);
        await sync.push(USER);
    });
    await b.en(() => sync.sync(USER));

    await a.en(async () => {
        ponerCheckins([checkin('2026-05-01')]);
        const r = await sync.push(USER);
        assert.equal(r.tombstones, 1, 'no se emitió la lápida');
    });

    await b.en(async () => {
        const r = await sync.pull(USER);
        assert.equal(r.removed, 1);
        assert.deepEqual(leerCheckins().map((/** @type {*} */ i) => i.dateISO), ['2026-05-01']);
    });
});

test('nada_se_pierde: una lápida NO borra una fila que se editó aquí', async () => {
    const a = dispositivo('A');
    const b = dispositivo('B');

    await a.en(async () => { ponerCheckins([checkin('2026-05-01')]); await sync.push(USER); });
    await b.en(() => sync.sync(USER));

    // A la borra; B, sin verlo, le pone una nota.
    await a.en(async () => { ponerCheckins([]); await sync.push(USER); });
    await b.en(async () => {
        ponerCheckins([checkin('2026-05-01', { notes: 'la pesé dos veces' })]);
        const r = await sync.pull(USER);
        assert.equal(r.kept, 1, 'la edición viva no ganó a la lápida');
        assert.equal(leerCheckins().length, 1, 'se perdió una edición local');
    });

    // Y el push siguiente la resucita, que es la dirección segura del error.
    await b.en(() => sync.push(USER));
    await a.en(async () => {
        await sync.pull(USER);
        const items = leerCheckins();
        assert.equal(items.length, 1);
        assert.equal(items[0].notes, 'la pesé dos veces');
    });
});

test('una lápida de algo que aquí no existe no rompe nada', async () => {
    await sembrar({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01'), deleted: true });
    const a = dispositivo('A');
    const r = await a.en(() => sync.pull(USER));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.removed, 0);
    assert.equal(r.applied, 0);
});

test('no_borrado_masivo: un almacén vaciado NO se lleva por delante el servidor', async () => {
    const a = dispositivo('A');
    await a.en(async () => {
        ponerCheckins(Array.from({ length: 30 }, (_, i) =>
            checkin(`2026-05-${String(i + 1).padStart(2, '0')}`)));
        const r = await sync.push(USER);
        assert.equal(r.pushed, 30);
    });

    // El almacén se vacía —modo privado que expira, un borrado mal dirigido—
    // pero la sombra sigue ahí. Sin la guarda, esto son treinta lápidas.
    await a.en(async () => {
        storage.remove(`${PERFIL}.checkins`);
        ponerCheckins([]);
        const r = await sync.push(USER);
        assert.equal(r.ok, false);
        assert.equal(r.error, 'sync.massDelete');
        assert.equal(r.tombstones, 30, 'no dice cuántas iba a borrar');
    });

    // Y las filas siguen enteras en el servidor.
    assert.equal([...servidor.filas.values()].filter((f) => !f.deleted).length, 30);

    // Confirmándolo sí se borra: la guarda pregunta, no prohíbe.
    await a.en(async () => {
        const r = await sync.push(USER, { allowMassDelete: true });
        assert.equal(r.ok, true, r.error);
        assert.equal(r.tombstones, 30);
    });
    assert.equal([...servidor.filas.values()].filter((f) => !f.deleted).length, 0);
});

test('una colección ILEGIBLE no se convierte en lápidas', async () => {
    const a = dispositivo('A');
    await a.en(async () => {
        ponerCheckins([checkin('2026-05-01'), checkin('2026-05-08')]);
        await sync.push(USER);
    });

    // La colección se corrompe: `split` no puede repartirla. No poder leer algo
    // no es haberlo borrado, y aquí esa confusión cuesta los datos.
    await a.en(async () => {
        storage.setForProfile(PERFIL, 'checkins', { schemaVersion: SCHEMA_VERSION, items: 'no es una lista' });
        const r = await sync.push(USER);
        assert.equal(r.ok, true, r.error);
        assert.equal(r.tombstones, 0, 'una colección ilegible se leyó como un borrado');
        assert.equal(r.unreadable, 1);
    });
    assert.equal([...servidor.filas.values()].filter((f) => !f.deleted).length, 2);
});

test('sin índice de perfiles el push se para: «no se sabe» no es «no hay nada»', async () => {
    const a = dispositivo('A');
    await a.en(async () => { ponerCheckins([checkin('2026-05-01')]); await sync.push(USER); });
    await a.en(async () => {
        storage.setGlobal('profiles', { esto: 'no es un índice' });
        const r = await sync.push(USER);
        assert.equal(r.ok, false);
        assert.equal(r.error, 'sync.noProfiles');
    });
    assert.equal([...servidor.filas.values()].filter((f) => !f.deleted).length, 1);
});

/* ══ El cursor y la sombra ══════════════════════════════════════════════════ */

test('cursor_despues: si la escritura falla, el cursor NO avanza', async () => {
    await sembrar({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01') });
    const a = dispositivo('A');

    await a.en(async () => {
        a.store.quotaFull = true;
        const r = await sync.pull(USER);
        assert.equal(r.ok, false);
        assert.equal(r.error, 'sync.writeFailed');
        assert.equal(sync.readCursor(USER), 0, 'el cursor avanzó sobre una escritura fallida');
    });

    // Con sitio otra vez, la misma página se vuelve a pedir y entra.
    await a.en(async () => {
        a.store.quotaFull = false;
        const r = await sync.pull(USER);
        assert.equal(r.ok, true, r.error);
        assert.equal(r.applied, 1);
        assert.equal(leerCheckins().length, 1);
    });
});

test('el push anota lo subido lote a lote: una caída no lo hace repetir todo', async () => {
    const a = dispositivo('A');
    await a.en(async () => {
        // Sesenta filas son dos lotes de cincuenta y diez.
        ponerCheckins(Array.from({ length: 60 }, (_, i) =>
            checkin(`2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`)));
        const r = await sync.push(USER);
        assert.equal(r.ok, true, r.error);
        assert.equal(r.pushed, 60);

        // Y el siguiente push no sube nada: la sombra ya lo sabe.
        const antes = servidor.lastSeq;
        const otra = await sync.push(USER);
        assert.equal(otra.pushed, 0);
        assert.equal(servidor.lastSeq, antes);
    });
});

test('una sombra corrupta degrada hacia «no destruyas»', async () => {
    const a = dispositivo('A');
    await a.en(async () => {
        ponerCheckins([checkin('2026-05-01'), checkin('2026-05-08')]);
        await sync.push(USER);
    });

    await a.en(async () => {
        storage.setRaw(sync.shadowKey(USER), 'esto no es json');
        assert.deepEqual(sync.readShadow(USER), { v: 1, e: {} });
        // Sin sombra no hay lápidas, aunque el almacén se vacíe.
        ponerCheckins([]);
        const r = await sync.push(USER);
        assert.equal(r.ok, true, r.error);
        assert.equal(r.tombstones, 0);
    });
    assert.equal([...servidor.filas.values()].filter((f) => !f.deleted).length, 2);
});

/* ══ El servidor es un tercero ══════════════════════════════════════════════ */

test('servidor_no_es_de_fiar: una fila con forma imposible se descarta ANTES de descifrar', async () => {
    const buena = await sembrar({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01') });

    // Se cuelan filas peligrosas de cada clase, todas bien formadas por fuera.
    const mala = (/** @type {*} */ parche) => ({
        profileId: PERFIL, collection: 'checkins', itemTag: buena,
        ciphertext: [...servidor.filas.values()][0].ciphertext,
        rev: 1, seq: 99, updatedAt: 1, deleted: false, ...parche
    });
    const original = servidor.responder.bind(servidor);
    servidor.responder = (url, init) => {
        const r = original(url, init);
        if (init?.method === 'POST') return r;
        return {
            ...r,
            rows: [
                mala({ profileId: 'con espacios' }),
                mala({ collection: 'inventada' }),
                mala({ collection: 'volumeLog' }),
                mala({ itemTag: 'corta' }),
                mala({ rev: 0 }),
                ...r.rows
            ]
        };
    };

    const a = dispositivo('A');
    const r = await a.en(() => sync.pull(USER));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.applied, 1, 'entró alguna de las filas peligrosas');
    await a.en(() => {
        assert.equal(leerCheckins().length, 1);
        assert.equal(storage.getForProfile(PERFIL, 'volumeLog').value, null,
            'una colección declarada LOCAL entró desde el servidor');
    });
});

test('aad_ata_la_fila: una fila movida a otra colección NO descifra', async () => {
    // Se cifra para `checkins` y se sirve como si fuera de `steps`.
    const keyPath = ['items', '2026-05-01'];
    const tag = b64u(await itemTag(ik, 'checkins', keyPath));
    const claro = new TextEncoder().encode(JSON.stringify({ keyPath, value: checkin('2026-05-01') }));
    const ciphertext = b64u(await encryptBytes(dk, claro, `checkins/${tag}`));

    servidor.responder = () => ({
        rows: [{ profileId: PERFIL, collection: 'steps', itemTag: tag, ciphertext, rev: 1, seq: 1, updatedAt: 1, deleted: false }],
        nextSince: 1, hasMore: false, lastSeq: 1
    });

    const a = dispositivo('A');
    const r = await a.en(() => sync.pull(USER));
    assert.equal(r.applied, 0);
    assert.equal(r.undecryptable, 1, 'el aad no ató la fila a su colección');
});

test('una etiqueta que no corresponde a la clave de dentro se rechaza', async () => {
    // El `aad` ya lo hace imposible desde el servidor; esto caza el fallo propio
    // —una etiqueta calculada mal aquí— que escribiría el dato en otro sitio.
    const keyPath = ['items', '2026-05-01'];
    const tag = b64u(await itemTag(ik, 'checkins', ['items', '2026-12-31']));
    const claro = new TextEncoder().encode(JSON.stringify({ keyPath, value: checkin('2026-05-01') }));
    const ciphertext = b64u(await encryptBytes(dk, claro, `checkins/${tag}`));

    servidor.responder = () => ({
        rows: [{ profileId: PERFIL, collection: 'checkins', itemTag: tag, ciphertext, rev: 1, seq: 1, updatedAt: 1, deleted: false }],
        nextSince: 1, hasMore: false, lastSeq: 1
    });

    const a = dispositivo('A');
    const r = await a.en(() => sync.pull(USER));
    assert.equal(r.applied, 0);
    assert.equal(r.undecryptable, 1);
});

test('un criptograma que no abre se CUENTA, no se traga', async () => {
    const otra = await importDataKey(new Uint8Array(32).fill(9));
    const keyPath = ['items', '2026-05-01'];
    const tag = b64u(await itemTag(ik, 'checkins', keyPath));
    const ciphertext = b64u(await encryptBytes(
        otra, new TextEncoder().encode(JSON.stringify({ keyPath, value: checkin('2026-05-01') })),
        `checkins/${tag}`));

    servidor.responder = () => ({
        rows: [{ profileId: PERFIL, collection: 'checkins', itemTag: tag, ciphertext, rev: 1, seq: 1, updatedAt: 1, deleted: false }],
        nextSince: 1, hasMore: false, lastSeq: 1
    });

    const a = dispositivo('A');
    const r = await a.en(() => sync.pull(USER));
    assert.equal(r.ok, true, r.error);
    assert.equal(r.undecryptable, 1);
});

/* ══ Sin claves y sin red ═══════════════════════════════════════════════════ */

test('sin desbloquear, ni pull ni push hacen nada', async () => {
    keysDb.resetForTests();
    uninstallIndexedDbMock();
    installIndexedDbMock();
    const a = dispositivo('A');
    await a.en(async () => {
        assert.equal((await sync.pull(USER)).error, 'sync.locked');
        assert.equal((await sync.push(USER)).error, 'sync.locked');
    });
    assert.equal(servidor.peticiones.length, 0, 'se llamó a la red sin poder descifrar');
});

test('una clave de datos SIN clave de índice cuenta como bloqueado', async () => {
    // Es el dispositivo que guardó su clave antes de que existiera la sincronía.
    // Sin la de índice no se pueden calcular etiquetas, y adivinar sería escribir
    // en el sitio equivocado.
    keysDb.resetForTests();
    uninstallIndexedDbMock();
    installIndexedDbMock();
    await keysDb.put(USER, dk);
    const a = dispositivo('A');
    await a.en(async () => {
        assert.equal((await sync.pull(USER)).error, 'sync.locked');
    });
});

test('sin red, ni el pull ni el push rompen nada', async () => {
    const a = dispositivo('A');
    await a.en(async () => {
        ponerCheckins([checkin('2026-05-01')]);
        averia = { error: true };
        const p = await sync.pull(USER);
        assert.equal(p.ok, false);
        assert.equal(sync.readCursor(USER), 0);
        const s = await sync.push(USER);
        assert.equal(s.ok, false);
        // Y lo local sigue intacto.
        assert.equal(leerCheckins().length, 1);
    });
});

test('una sesión caducada se reporta con su código', async () => {
    const a = dispositivo('A');
    await a.en(async () => {
        // El cuerpo es el que emite el servidor de verdad: lo que se comprueba
        // es que el cliente propaga SU código, no uno inventado aquí.
        averia = { status: 401, body: JSON.stringify({ error: 'auth.required' }) };
        const r = await sync.pull(USER);
        assert.equal(r.ok, false);
        assert.equal(r.error, 'auth.required');
    });
});

/* ══ Varios perfiles y varias colecciones ═══════════════════════════════════ */

test('el push sube TODAS las colecciones que viajan, y ninguna local', async () => {
    const a = dispositivo('A');
    await a.en(async () => {
        ponerCheckins([checkin('2026-05-01')]);
        storage.setForProfile(PERFIL, 'volumeLog', { schemaVersion: SCHEMA_VERSION, entries: [] });
        storage.setForProfile(PERFIL, 'photos', {
            schemaVersion: SCHEMA_VERSION,
            items: [{ id: 'ph_1', dateISO: '2026-05-01', note: '', contentType: 'image/webp', bytes: 1234 }]
        });
        await sync.push(USER);
    });
    const subidas = new Set([...servidor.filas.values()].map((f) => f.collection));
    assert.ok(subidas.has('checkins'));
    assert.ok(!subidas.has('volumeLog'), 'se subió una colección declarada local');
    // Los PUNTEROS de las fotos sí viajan desde M9-5. Los blobs no: van a R2 por
    // su propio camino, y una fila de D1 no es sitio para cientos de kilobytes.
    assert.ok(subidas.has('photos'), 'los punteros de las fotos ya no viajan');
});

test('el pull escribe en VARIOS perfiles sin mover el activo', async () => {
    const OTRO = 'zz9xy1234567890abcdefg';
    const a = dispositivo('A');
    await a.en(() => {
        storage.setGlobal('profiles', {
            schemaVersion: SCHEMA_VERSION, activeProfileId: PERFIL,
            profiles: [
                { id: PERFIL, name: 'Ana', createdAtISO: '2026-05-01T08:00:00.000Z' },
                { id: OTRO, name: 'Beto', createdAtISO: '2026-05-01T08:00:00.000Z' }
            ]
        });
    });

    await sembrar({ keyPath: ['items', '2026-05-01'], value: checkin('2026-05-01') });
    // La segunda fila va al otro perfil.
    const keyPath = ['items', '2026-06-01'];
    const tag = b64u(await itemTag(ik, 'checkins', keyPath));
    const ciphertext = b64u(await encryptBytes(
        dk, new TextEncoder().encode(JSON.stringify({ keyPath, value: checkin('2026-06-01') })),
        `checkins/${tag}`));
    servidor.responder('/api/sync', {
        method: 'POST',
        body: JSON.stringify({ rows: [{ profileId: OTRO, collection: 'checkins', itemTag: tag, ciphertext, deleted: false, baseRev: 0 }] })
    });

    await a.en(async () => {
        storage.setActiveProfile(PERFIL);
        const r = await sync.pull(USER);
        assert.equal(r.applied, 2);
        assert.equal(storage.getActiveProfile(), PERFIL, 'el pull movió el perfil activo');
        assert.equal(
            /** @type {*} */ (storage.getForProfile(OTRO, 'checkins').value).items[0].dateISO,
            '2026-06-01');
    });
});

/* ══ El teléfono nuevo ══════════════════════════════════════════════════════ */

/** Un perfil de usuario válido, del propio catálogo del esquema. */
const perfilDe = (/** @type {string} */ nombre) => ({
    ...COLLECTIONS.profile.makeDefault(),
    name: nombre,
    createdAtISO: '2026-05-01T08:00:00.000Z'
});

test('un teléfono recién estrenado se lo trae todo Y SABE QUE ESTÁ AHÍ', async () => {
    // El recorrido que justifica la sincronía entera. Lo que estuvo roto: el
    // índice de perfiles es local y no viaja, así que el dispositivo nuevo se
    // descargaba la cuenta completa y no enseñaba nada — los datos en el
    // almacén y ninguna vista sabiendo que ese perfil existía.
    const a = dispositivo('A');
    await a.en(async () => {
        storage.setForProfile(PERFIL, 'profile', perfilDe('Ana'));
        ponerCheckins([checkin('2026-05-01'), checkin('2026-05-08')]);
        const r = await sync.push(USER);
        assert.equal(r.ok, true, r.error);
    });

    const nuevo = dispositivo('nuevo', { virgen: true });
    await nuevo.en(async () => {
        assert.deepEqual(profiles.list().value, [], 'el dispositivo no estaba virgen');

        const r = await sync.pull(USER);
        assert.equal(r.ok, true, r.error);
        assert.equal(r.adopted, 1, 'el perfil no se inscribió en el índice');

        const lista = /** @type {*} */ (profiles.list().value);
        assert.equal(lista.length, 1);
        assert.equal(lista[0].id, PERFIL);
        assert.equal(lista[0].name, 'Ana', 'el nombre no salió del perfil descargado');
        // Y queda ACTIVO: si no, la aplicación arrancaría sin perfil y pediría
        // crear uno encima de los datos que se acaban de bajar.
        assert.equal(/** @type {*} */ (profiles.getActive().value), PERFIL);
        assert.deepEqual(leerCheckins().map((/** @type {*} */ i) => i.dateISO),
            ['2026-05-01', '2026-05-08']);
    });
});

test('una cuenta ENTERA cabe en un dispositivo virgen, colecciones mixtas incluidas', async () => {
    // El caso que rompía, y no era evidente: `settings` es MIXTA —los ajustes de
    // módulos viajan, el recordatorio no, porque es de este aparato—. Recompuesta
    // solo con lo que llega del servidor no valida, `join` hace bien en no
    // devolverla, y el pull entero se declaraba fallido: el teléfono nuevo se
    // quedaba sin NADA por culpa de una colección.
    const a = dispositivo('A');
    await a.en(async () => {
        for (const nombre of Object.keys(COLLECTIONS)) {
            storage.setForProfile(PERFIL, nombre, COLLECTIONS[nombre].makeDefault());
        }
        storage.setForProfile(PERFIL, 'profile', perfilDe('Ana'));
        const r = await sync.push(USER);
        assert.equal(r.ok, true, r.error);
    });

    const nuevo = dispositivo('nuevo', { virgen: true });
    await nuevo.en(async () => {
        const r = await sync.pull(USER);
        assert.equal(r.ok, true, r.error);
        assert.equal(r.adopted, 1);

        // Y TODA colección escrita valida: si alguna no lo hiciera, el siguiente
        // gesto del usuario persistiría un valor degradado.
        for (const nombre of Object.keys(COLLECTIONS)) {
            assert.ok(sync.localIsValid(PERFIL, nombre),
                `la colección «${nombre}» se escribió inválida`);
        }

        // Lo que viaja llegó, y lo que no viaja arrancó de fábrica.
        const ajustes = /** @type {*} */ (storage.getForProfile(PERFIL, 'settings').value);
        assert.ok(ajustes !== null, 'no se escribieron los ajustes');
        assert.deepEqual(ajustes.reminder, COLLECTIONS.settings.makeDefault().reminder,
            'la parte local de los ajustes no arrancó de fábrica');
    });
});

test('un perfil cuyo nombre aún no ha llegado no se bautiza a lo loco', async () => {
    // El pull pagina, y dentro de una página el orden no está garantizado. Antes
    // que inventar un «Perfil 2» —un literal visible fuera de i18n y una
    // etiqueta que nadie reconoce—, se deja para la vuelta siguiente.
    const a = dispositivo('A');
    await a.en(async () => { ponerCheckins([checkin('2026-05-01')]); await sync.push(USER); });

    const nuevo = dispositivo('nuevo', { virgen: true });
    await nuevo.en(async () => {
        const r = await sync.pull(USER);
        assert.equal(r.applied, 1, 'no llegó el check-in');
        assert.equal(r.adopted, 0, 'inscribió un perfil sin saber cómo se llama');
        assert.deepEqual(profiles.list().value, []);
    });

    // Cuando llega el perfil, se inscribe.
    await a.en(async () => {
        storage.setForProfile(PERFIL, 'profile', perfilDe('Ana'));
        await sync.push(USER);
    });
    await nuevo.en(async () => {
        const r = await sync.pull(USER);
        assert.equal(r.adopted, 1);
        assert.equal(/** @type {*} */ (profiles.list().value)[0].name, 'Ana');
    });
});

test('un nombre repetido no cuesta el perfil entero: se desambigua', async () => {
    const a = dispositivo('A');
    await a.en(async () => {
        storage.setForProfile(PERFIL, 'profile', perfilDe('Ana'));
        await sync.push(USER);
    });

    // El dispositivo receptor ya tiene un perfil suyo llamado igual, con OTRO id.
    const otro = dispositivo('otro', { virgen: true });
    await otro.en(async () => {
        storage.setGlobal('profiles', {
            schemaVersion: SCHEMA_VERSION, activeProfileId: 'zz9xy1234567890abcdefg',
            profiles: [{ id: 'zz9xy1234567890abcdefg', name: 'Ana', createdAtISO: '2026-05-01T08:00:00.000Z' }]
        });
        const r = await sync.pull(USER);
        assert.equal(r.adopted, 1, 'un nombre repetido dejó el perfil sin inscribir');

        const lista = /** @type {*} */ (profiles.list().value);
        assert.equal(lista.length, 2);
        assert.equal(lista.find((/** @type {*} */ p) => p.id === PERFIL).name, 'Ana (2)');
        // Y el que estaba mirando NO cambia: sincronizar no te mueve de sitio.
        assert.equal(/** @type {*} */ (profiles.getActive().value), 'zz9xy1234567890abcdefg');
    });
});

/* ══ Las fotos huérfanas ════════════════════════════════════════════════════ */

test('el barrido borra lo que no tiene puntero, y NADA más', async () => {
    // Un objeto cuya subida terminó y cuyo puntero no llegó a guardarse no lo
    // reclama nadie: ocupa cuota para siempre y no se ve en ninguna galería.
    const a = dispositivo('A');
    /** @type {*[]} */ const borradas = [];
    /** @type {*[]} */ const objetos = [
        { profileId: PERFIL, photoId: 'ph_viva', bytes: 100 },
        { profileId: PERFIL, photoId: 'ph_huerfana', bytes: 100 },
        { profileId: 'zz9xy1234567890abcdefg', photoId: 'ph_ajena', bytes: 100 }
    ];
    globalThis.fetch = /** @type {*} */ (async (url, init) => {
        const u = new URL(url, ORIGEN);
        if (u.pathname === '/api/photos') {
            return new Response(JSON.stringify({ objects: objetos, complete: true, used: 300, limit: 1000 }));
        }
        if (init?.method === 'DELETE') {
            borradas.push(u.pathname.split('/').pop());
            return new Response('{"deleted":true}');
        }
        return new Response(JSON.stringify(servidor.responder(url, init)));
    });

    await a.en(async () => {
        storage.setForProfile(PERFIL, 'photos', {
            schemaVersion: SCHEMA_VERSION,
            items: [{ id: 'ph_viva', dateISO: '2026-05-01', note: '' }]
        });
        const r = await sync.sweepOrphans(USER);
        assert.equal(r.ok, true, r.error);
        assert.equal(r.deleted, 1);
    });

    // La viva se queda; la ajena —de un perfil que este dispositivo no tiene—
    // tampoco se toca, o estrenar la aplicación borraría las fotos de todos los
    // perfiles que ese aparato no conociera.
    assert.deepEqual(borradas, ['ph_huerfana']);
});

test('sin índice de perfiles, el barrido no borra nada', async () => {
    const a = dispositivo('A');
    /** @type {*[]} */ const borradas = [];
    globalThis.fetch = /** @type {*} */ (async (url, init) => {
        const u = new URL(url, ORIGEN);
        if (u.pathname === '/api/photos') {
            return new Response(JSON.stringify({
                objects: [{ profileId: PERFIL, photoId: 'ph_1', bytes: 100 }],
                complete: true, used: 100, limit: 1000
            }));
        }
        if (init?.method === 'DELETE') { borradas.push(u.pathname); return new Response('{"deleted":true}'); }
        return new Response(JSON.stringify(servidor.responder(url, init)));
    });

    await a.en(async () => {
        storage.setGlobal('profiles', { esto: 'no es un índice' });
        const r = await sync.sweepOrphans(USER);
        assert.equal(r.ok, false);
        assert.equal(r.error, 'sync.noProfiles');
    });
    assert.deepEqual(borradas, []);
});

test('una colección de fotos ILEGIBLE deja su perfil fuera del juicio', async () => {
    // No poder leer los punteros de un perfil no es que ese perfil no tenga
    // fotos. Confundirlo borraría todas las suyas.
    const a = dispositivo('A');
    /** @type {*[]} */ const borradas = [];
    globalThis.fetch = /** @type {*} */ (async (url, init) => {
        const u = new URL(url, ORIGEN);
        if (u.pathname === '/api/photos') {
            return new Response(JSON.stringify({
                objects: [{ profileId: PERFIL, photoId: 'ph_1', bytes: 100 }],
                complete: true, used: 100, limit: 1000
            }));
        }
        if (init?.method === 'DELETE') { borradas.push(u.pathname); return new Response('{"deleted":true}'); }
        return new Response(JSON.stringify(servidor.responder(url, init)));
    });

    await a.en(async () => {
        // Las DOS formas de no poder leerlos, porque son ramas distintas: un
        // valor que el almacén no devuelve, y uno que devuelve sin la lista.
        storage.setRaw(`tl.${SCHEMA_VERSION}.${PERFIL}.photos`, '{ esto no es json');
        assert.equal(storage.getForProfile(PERFIL, 'photos').ok, false, '¿ya no falla al leer?');
        let r = await sync.sweepOrphans(USER);
        assert.equal(r.ok, true, r.error);
        assert.equal(r.deleted, 0, 'borró fotos de un perfil cuyos punteros no pudo LEER');

        storage.setForProfile(PERFIL, 'photos', { schemaVersion: SCHEMA_VERSION, items: 'no es una lista' });
        r = await sync.sweepOrphans(USER);
        assert.equal(r.ok, true, r.error);
        assert.equal(r.deleted, 0, 'borró fotos de un perfil cuyos punteros no eran una lista');
    });
    assert.deepEqual(borradas, []);
});

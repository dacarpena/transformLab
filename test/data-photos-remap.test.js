// @ts-check

/**
 * Reetiquetar las fotos al cambiar el id del perfil (M9-1).
 *
 * Las fotos son el sitio donde este remapeo puede perder algo de verdad y sin
 * ruido. Llevan **doble vínculo** con su perfil —la clave primaria es
 * `<perfil>:<foto>` y además hay un campo `profileId` indexado— y los metadatos
 * viven aparte, en `localStorage`, guardando solo el id corto. Si esta fase no
 * corre, `photosDb.get(nuevoId, 'ph_…')` devuelve `null` y la galería **se
 * acorta sin decir nada**: justo lo que prohíbe §D9.
 *
 * Lo que se fija aquí:
 *
 * - que se mueven **los dos** vínculos, no uno;
 * - que es **idempotente**: tres pasadas dejan `n` fotos, no `3n`;
 * - que un perfil reservado (el ejemplo) no se toca;
 * - que sin IndexedDB la fase se da por hecha en vez de bloquear el arranque.
 *
 * La prueba de que funciona con IndexedDB DE VERDAD está en
 * `test/e2e/migration-v7.spec.js`: un doble no puede demostrar la durabilidad de
 * una transacción.
 *
 * **Lo que aquí NO se puede probar, y consta:** que `put` y `delete` compartan
 * transacción. Se intentó, y el test no discriminaba — con razón: dentro de una
 * transacción no hay un «entre medias» observable, así que invertir el orden no
 * cambia nada. La garantía real es que compartan transacción, y eso solo se ve
 * abortando una de verdad.
 */

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installIndexedDbMock, uninstallIndexedDbMock, makeBlob } from './helpers/indexed-db-mock.js';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as photos from '../src/data/photos-db.js';
import { relabel } from '../src/data/photos-remap.js';
import { run } from '../src/data/migrations.js';
import { DEMO_PROFILE_ID } from '../src/data/ids.js';
import { rootPrefix, SCHEMA_VERSION } from '../src/data/version.js';

/** @type {ReturnType<typeof installIndexedDbMock>} */
let idb;

beforeEach(() => {
    photos.close();
    idb = installIndexedDbMock();
});
afterEach(() => {
    photos.close();
    uninstallIndexedDbMock();
});

/** Mete `n` fotos en un perfil. */
async function sembrar(profileId, n, desde = 1) {
    for (let i = desde; i < desde + n; i++) {
        const r = await photos.add(profileId, {
            id: `ph_${i}`, dateISO: `2026-01-${String(i).padStart(2, '0')}`,
            blob: makeBlob(512), note: `nota ${i}`
        });
        assert.ok(r.ok, `no se pudo sembrar ph_${i}: ${!r.ok && r.error}`);
    }
}

/* ── El caso normal ──────────────────────────────────────────────────────── */

test('las fotos llegan al id nuevo con sus DOS vínculos cambiados', async () => {
    // Cambiar solo el campo deja la clave primaria apuntando al perfil viejo;
    // cambiar solo la clave deja el índice mintiendo. Hay que mover los dos.
    await sembrar('p1', 3);
    const r = await relabel({ p1: 'OPACO' });

    assert.equal(r.done, true, `no terminó: ${JSON.stringify(r.errors)}`);
    assert.equal(r.moved, 3);

    // Por el índice (el campo `profileId`).
    const nuevas = await photos.list('OPACO');
    assert.ok(nuevas.ok);
    assert.equal(nuevas.value.length, 3);
    // Y por la clave primaria.
    const una = await photos.get('OPACO', 'ph_1');
    assert.ok(una.ok && una.value, 'la clave primaria no se movió');
    assert.equal(/** @type {*} */ (una.value).profileId, 'OPACO');

    // Nada bajo el viejo, por ninguna de las dos vías.
    const viejas = await photos.list('p1');
    assert.ok(viejas.ok && viejas.value.length === 0, 'quedaron fotos con el id viejo');
    const vieja = await photos.get('p1', 'ph_1');
    assert.ok(vieja.ok && vieja.value === null);
});

test('el CONTENIDO sobrevive: blob, fecha y nota', async () => {
    // Mover una foto y perder su blob sería peor que no moverla.
    await sembrar('p1', 1);
    const antes = await photos.get('p1', 'ph_1');
    assert.ok(antes.ok && antes.value);

    assert.equal((await relabel({ p1: 'OPACO' })).done, true);

    const despues = await photos.get('OPACO', 'ph_1');
    assert.ok(despues.ok && despues.value);
    const a = /** @type {*} */ (antes.value);
    const b = /** @type {*} */ (despues.value);
    assert.equal(b.dateISO, a.dateISO);
    assert.equal(b.note, a.note);
    assert.equal(b.bytes, a.bytes);
    assert.ok(b.blob, 'se perdió el blob');
});

test('cada perfil va al SUYO: dos remapeos a la vez no se mezclan', async () => {
    await sembrar('p1', 2);
    await sembrar('p2', 3, 10);

    const r = await relabel({ p1: 'A', p2: 'B' });
    assert.equal(r.done, true);
    assert.equal(r.moved, 5);

    const a = await photos.list('A');
    const b = await photos.list('B');
    assert.ok(a.ok && b.ok);
    assert.equal(a.value.length, 2);
    assert.equal(b.value.length, 3);
    assert.deepEqual(a.value.map((/** @type {*} */ m) => m.id).sort(), ['A:ph_1', 'A:ph_2']);
});

/* ── Idempotencia ────────────────────────────────────────────────────────── */

test('fotos_idempotente: tres pasadas dejan n fotos, no 3n', async () => {
    // La re-entrada es el caso NORMAL —una migración interrumpida vuelve a
    // pasar por aquí— así que duplicar sería el resultado habitual, no el raro.
    await sembrar('p1', 4);
    await relabel({ p1: 'OPACO' });
    const segunda = await relabel({ p1: 'OPACO' });
    const tercera = await relabel({ p1: 'OPACO' });

    assert.equal(segunda.moved, 0, 'la segunda pasada volvió a mover algo');
    assert.equal(tercera.done, true);
    const todas = await photos.list('OPACO');
    assert.ok(todas.ok);
    assert.equal(todas.value.length, 4, `quedaron ${todas.value.length} fotos`);
});

test('una foto ya movida a mano no rompe la pasada', async () => {
    // `put` y no `add`: `add` falla si la clave existe, y una migración a medias
    // deja exactamente ese estado.
    await sembrar('p1', 2);
    await photos.add('OPACO', { id: 'ph_1', dateISO: '2026-01-01', blob: makeBlob(64), note: 'ya estaba' });

    const r = await relabel({ p1: 'OPACO' });
    assert.equal(r.done, true, `falló con una foto ya presente: ${JSON.stringify(r.errors)}`);
    const todas = await photos.list('OPACO');
    assert.ok(todas.ok);
    assert.equal(todas.value.length, 2);
});

test('un mapa identidad no hace nada, y no cuesta una transacción', async () => {
    await sembrar('p1', 2);
    const r = await relabel({ p1: 'p1', [DEMO_PROFILE_ID]: DEMO_PROFILE_ID });
    assert.equal(r.done, true);
    assert.equal(r.moved, 0);
    const todas = await photos.list('p1');
    assert.ok(todas.ok && todas.value.length === 2, 'tocó fotos que no debía');
});

test('el perfil de EJEMPLO no se mueve: su id no se remapea', async () => {
    await sembrar('p1', 1);
    await sembrar(DEMO_PROFILE_ID, 2, 50);

    const r = await relabel({ p1: 'OPACO', [DEMO_PROFILE_ID]: DEMO_PROFILE_ID });
    assert.equal(r.done, true);
    const demo = await photos.list(DEMO_PROFILE_ID);
    assert.ok(demo.ok && demo.value.length === 2, 'se movieron las fotos del ejemplo');
});

/* ── Sin nada que mover, y sin base ──────────────────────────────────────── */

test('un perfil sin fotos no es un problema', async () => {
    const r = await relabel({ p1: 'OPACO' });
    assert.equal(r.done, true);
    assert.equal(r.moved, 0);
    assert.deepEqual(r.errors, []);
});

test('fotos_sin_base: sin IndexedDB la fase se da por HECHA, no bloquea', async () => {
    // En navegación privada de Safari puede no haber IndexedDB. Si no hay base,
    // no hay fotos que mover; tratarlo como error bloquearía el arranque de
    // alguien que no tiene ni una foto.
    photos.close();
    uninstallIndexedDbMock();
    try {
        const r = await relabel({ p1: 'OPACO' });
        assert.equal(r.done, true, 'bloqueó el arranque por no haber IndexedDB');
        assert.equal(r.skipped, true, 'no dejó constancia de que se saltó');
    } finally {
        idb = installIndexedDbMock();
    }
});

/* ── Lotes ───────────────────────────────────────────────────────────────── */

test('con más fotos que un lote, se mueven TODAS', async () => {
    // El lote son 25. Con 60 hay tres transacciones, y la última es parcial: es
    // el borde donde un `slice` mal escrito pierde el resto.
    await sembrar('p1', 60);
    const r = await relabel({ p1: 'OPACO' });
    assert.equal(r.done, true, `no terminó: ${JSON.stringify(r.errors)}`);
    assert.equal(r.moved, 60);
    const todas = await photos.list('OPACO');
    assert.ok(todas.ok);
    assert.equal(todas.value.length, 60);
    const quedan = await photos.countOfProfile('p1');
    assert.ok(quedan.ok && quedan.value === 0, 'quedaron fotos con el id viejo');
});

/* ── Las piezas nuevas de photos-db ──────────────────────────────────────── */

test('keysOfProfile devuelve CLAVES, no registros: no materializa los blobs', async () => {
    await sembrar('p1', 3);
    const claves = await photos.keysOfProfile('p1');
    assert.ok(claves.ok);
    assert.deepEqual([...claves.value].sort(), ['p1:ph_1', 'p1:ph_2', 'p1:ph_3']);
    // Cadenas, no objetos: si viniera un registro, cada elemento traería su blob.
    for (const k of claves.value) assert.equal(typeof k, 'string');
});

test('countOfProfile es el criterio de «ya está»', async () => {
    await sembrar('p1', 2);
    assert.equal((await photos.countOfProfile('p1')).ok && (await photos.countOfProfile('p1')).value, 2);
    await relabel({ p1: 'OPACO' });
    const despues = await photos.countOfProfile('p1');
    assert.ok(despues.ok);
    assert.equal(despues.value, 0);
});

test('las dos rechazan un profileId inválido en vez de barrer de más', async () => {
    for (const malo of ['', /** @type {*} */ (null), /** @type {*} */ (7)]) {
        assert.equal((await photos.keysOfProfile(malo)).ok, false, `aceptó ${JSON.stringify(malo)}`);
        assert.equal((await photos.countOfProfile(malo)).ok, false);
    }
});

/* ── El orden dentro de la migración completa ────────────────────────────── */

test('si NO CABE la migración, no se mueve ni una foto', async () => {
    // El *preflight* de cuota va el PRIMERO de todos, antes que las fotos. Si
    // fuera después, abortar por cuota dejaría los blobs bajo el id nuevo con la
    // aplicación todavía en la versión anterior: la galería vacía **en cada
    // arranque**, hasta que el usuario liberase espacio. Y como el preflight
    // vuelve a fallar cada vez, ese estado no se sale solo.
    const mock = installLocalStorageMock();
    const V6 = rootPrefix(6);
    mock.setItem(`${V6}profiles`, JSON.stringify({
        schemaVersion: 6, activeProfileId: 'p1',
        profiles: [{ id: 'p1', name: 'Dani', createdAtISO: '2026-01-01T00:00:00.000Z' }]
    }));
    mock.setItem(`${V6}p1.settings`, JSON.stringify({
        schemaVersion: 6, locale: 'es', activeMeasures: [], fluctuationVisible: false, reminder: null
    }));
    // Un bulto que deja el almacén por encima del umbral.
    mock.setItem('tl.bulto', 'x'.repeat(2_600_000));

    await sembrar('p1', 3);

    const r = await run({ nowISO: '2026-08-21T10:00:00.000Z' });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'migrations.quotaInsufficient');

    // Y las fotos siguen donde estaban.
    const quedan = await photos.countOfProfile('p1');
    assert.ok(quedan.ok);
    assert.equal(quedan.value, 3, 'se movieron fotos pese a abortar por cuota');
});

test('la fase de fotos corre ANTES de copiar las claves', async () => {
    // Al revés, un fallo al mover las fotos dejaría la aplicación ya en la
    // versión nueva con los metadatos migrados y los blobs bajo el id viejo: la
    // galería se acortaría sin decir nada (§D9).
    const mock = installLocalStorageMock();
    const V6 = rootPrefix(6);
    mock.setItem(`${V6}profiles`, JSON.stringify({
        schemaVersion: 6, activeProfileId: 'p1',
        profiles: [{ id: 'p1', name: 'Dani', createdAtISO: '2026-01-01T00:00:00.000Z' }]
    }));
    mock.setItem(`${V6}p1.settings`, JSON.stringify({
        schemaVersion: 6, locale: 'es', activeMeasures: [], fluctuationVisible: false, reminder: null
    }));
    await sembrar('p1', 2);

    // Se anota CUÁNDO se escribe la primera clave de la versión nueva y cuándo
    // termina de moverse la última foto.
    let clavesEscritasAlMoverFotos = -1;
    let escritas = 0;
    const setItem = mock.setItem.bind(mock);
    mock.setItem = (/** @type {string} */ k, /** @type {string} */ v) => {
        if (k.startsWith(rootPrefix())) escritas += 1;
        if (k.startsWith('tl.migrationPhotosDone')) clavesEscritasAlMoverFotos = escritas;
        return setItem(k, v);
    };

    const r = await run({ nowISO: '2026-08-21T10:00:00.000Z' });
    mock.setItem = setItem;
    assert.ok(r.ok, JSON.stringify(!r.ok && r.error));

    assert.notEqual(clavesEscritasAlMoverFotos, -1, 'la fase de fotos no llegó a cerrarse');
    assert.equal(clavesEscritasAlMoverFotos, 0,
        `se copiaron ${clavesEscritasAlMoverFotos} claves ANTES de terminar con las fotos`);
    assert.equal((await photos.countOfProfile('p1')).value, 0);
});

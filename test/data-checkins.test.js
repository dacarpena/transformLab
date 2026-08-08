// @ts-check

/**
 * La colección de check-ins (M7-5).
 *
 * `src/data/checkins.js` era el único módulo de la capa de datos sin test
 * propio, y escondía el peor problema de rendimiento del proyecto: `list()`
 * revalida el array ENTERO contra el esquema, y `findByDate()` la llamaba en
 * cada invocación mientras las vistas la metían dentro de un `.map()`. Es
 * cuadrático, y con datos diarios llegaba a segundos de hilo bloqueado.
 *
 * El test de rendimiento del final es el que impide que vuelva.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import { rootPrefix, SCHEMA_VERSION } from '../src/data/version.js';

/** @type {*} */ let checkins;
/** @type {import('./helpers/local-storage-mock.js').LocalStorageMock} */ let mock;
let generation = 0;

beforeEach(async () => {
    mock = installLocalStorageMock();
    // `checkins.js` guarda una caché de módulo, así que cada test necesita una
    // copia fresca o heredaría la del anterior y dejaría de probar nada.
    //
    // `storage.js` se importa SIN versionar a propósito: `checkins.js?gen=N`
    // resuelve su `./storage.js` a la instancia canónica, y si el test usara
    // una versionada estaría fijando el perfil activo en OTRO módulo.
    checkins = await import(`../src/data/checkins.js?gen=${++generation}`);
    storage.setActiveProfile('p1');
});

/** @param {number} n @param {string} [prefix] */
function seed(n, prefix = '2026-01-01') {
    const start = Date.parse(`${prefix}T00:00:00Z`);
    for (let i = 0; i < n; i++) {
        const dateISO = new Date(start + i * 86400000).toISOString().slice(0, 10);
        const r = checkins.save({ dateISO, weightKg: 80 - i * 0.01 }, { nowISO: '2026-01-01T00:00:00.000Z' });
        assert.ok(r.ok, `no se pudo sembrar ${dateISO}: ${JSON.stringify(!r.ok && r)}`);
    }
}

test('guarda, lee ordenado por fecha y encuentra por fecha', () => {
    checkins.save({ dateISO: '2026-03-10', weightKg: 79 }, { nowISO: '2026-03-10T08:00:00.000Z' });
    checkins.save({ dateISO: '2026-01-05', weightKg: 81 }, { nowISO: '2026-01-05T08:00:00.000Z' });
    checkins.save({ dateISO: '2026-02-01', weightKg: 80 }, { nowISO: '2026-02-01T08:00:00.000Z' });

    assert.deepEqual(checkins.list().map((/** @type {*} */ c) => c.dateISO),
        ['2026-01-05', '2026-02-01', '2026-03-10']);
    assert.equal(checkins.findByDate('2026-02-01')?.weightKg, 80);
    assert.equal(checkins.findByDate('2026-12-31'), null);
});

test('dos check-ins del mismo día se reemplazan, no se duplican', () => {
    // Pesarse dos veces un martes no puede crear dos registros que se contradigan.
    checkins.save({ dateISO: '2026-02-01', weightKg: 80 }, { nowISO: '2026-02-01T08:00:00.000Z' });
    checkins.save({ dateISO: '2026-02-01', weightKg: 79.5 }, { nowISO: '2026-02-01T20:00:00.000Z' });
    assert.equal(checkins.list().length, 1);
    assert.equal(checkins.findByDate('2026-02-01').weightKg, 79.5);
});

test('la caché se invalida al guardar: no se sirve una lista rancia', () => {
    seed(3);
    assert.equal(checkins.list().length, 3);
    checkins.save({ dateISO: '2026-06-01', weightKg: 78 }, { nowISO: '2026-06-01T08:00:00.000Z' });
    assert.equal(checkins.list().length, 4, 'la caché sobrevivió a una escritura');
    assert.ok(checkins.findByDate('2026-06-01'), 'el índice por fecha no se refrescó');
});

test('la caché se invalida al borrar', () => {
    seed(3);
    const id = checkins.list()[1].id;
    assert.ok(checkins.remove(id).ok);
    assert.equal(checkins.list().length, 2);
    assert.equal(checkins.findByDate('2026-01-02'), null, 'el borrado no salió del índice');
});

test('la caché NO cruza perfiles: cada uno ve los suyos', () => {
    // Las claves del almacén llevan el perfil en el namespace. Una caché sin
    // esa comprobación serviría los check-ins de otra persona — el peor fallo
    // posible en una aplicación de datos personales.
    seed(2);
    assert.equal(checkins.list().length, 2);

    storage.setActiveProfile('p2');
    assert.equal(checkins.list().length, 0, 'el perfil nuevo heredó los check-ins del anterior');
    checkins.save({ dateISO: '2026-05-05', weightKg: 70 }, { nowISO: '2026-05-05T08:00:00.000Z' });
    assert.equal(checkins.list().length, 1);

    storage.setActiveProfile('p1');
    assert.equal(checkins.list().length, 2, 'al volver al primer perfil no se recuperaron sus datos');
    assert.equal(checkins.findByDate('2026-05-05'), null, 'se filtró un check-in del otro perfil');
});

test('un almacén corrupto NO se cachea: se puede arreglar sin recargar', () => {
    mock.setItem(`${rootPrefix()}p1.checkins`, `{"schemaVersion":${SCHEMA_VERSION},"items":"no soy un array"}`);
    assert.deepEqual(checkins.list(), [], 'no degradó a lista vacía');
    assert.deepEqual(checkins.list(), [], 'la segunda lectura tampoco');

    // Reparar el almacén (importar un backup) tiene que verse sin recargar: si
    // el fallo se hubiera cacheado, el usuario restauraría sus datos y seguiría
    // viendo la pantalla vacía.
    storage.set('checkins', { schemaVersion: SCHEMA_VERSION, items: [
        { id: 'ci_2026-07-07', dateISO: '2026-07-07', weightKg: 77, fatPct: null, scaleMuscleKg: null,
            boneKg: null, measuresCm: {}, subjective: {}, notes: '',
            createdAtISO: '2026-07-07T08:00:00.000Z', editedAtISO: null }
    ] });
    assert.equal(checkins.list().length, 1, 'se quedó pegado al estado corrupto');
});

test('la caché caduca con las escrituras de OTROS módulos, no solo las suyas', () => {
    // `backup.js` (import), `migrate.js` (v4→v5) y `profiles.js` (perfil nuevo)
    // escriben esta misma clave por su cuenta, vía `storage.set`. Una caché
    // invalidada solo desde `save()`/`remove()` sobreviviría a un import de
    // backup: el usuario restauraría y seguiría viendo lo de antes.
    seed(2);
    assert.equal(checkins.list().length, 2, 'precondición: la caché está caliente');

    storage.set('checkins', { schemaVersion: SCHEMA_VERSION, items: [] });   // como un import
    assert.deepEqual(checkins.list(), [], 'la caché sobrevivió a una escritura ajena');
    assert.equal(checkins.findByDate('2026-01-01'), null, 'y el índice por fecha también');
});

test('RENDIMIENTO: el patrón de las vistas no puede volver a ser cuadrático', () => {
    // Reproduce lo que hacen `dashboard`, `progress` y `projection`: un
    // `findByDate` por cada evaluación, dentro de un `.map()`. Con 730
    // check-ins esto tardaba 6 775 ms antes de la caché.
    const N = 730;
    // Siembra en una sola escritura, como hace `backup.js` al importar. Con 730
    // `save()` la propia siembra costaría ~4 s (cada alta revalida la colección
    // entera) y estaría midiendo eso en vez de la lectura.
    const start = Date.parse('2026-01-01T00:00:00Z');
    const items = Array.from({ length: N }, (_, i) => ({
        id: `ci_${new Date(start + i * 86400000).toISOString().slice(0, 10)}`,
        dateISO: new Date(start + i * 86400000).toISOString().slice(0, 10),
        weightKg: 80 - i * 0.01, fatPct: null, scaleMuscleKg: null, boneKg: null,
        measuresCm: {}, subjective: {}, notes: '',
        createdAtISO: '2026-01-01T00:00:00.000Z', editedAtISO: null
    }));
    assert.ok(storage.set('checkins', { schemaVersion: SCHEMA_VERSION, items }).ok);

    const fechas = checkins.list().map((/** @type {*} */ c) => c.dateISO);
    assert.equal(fechas.length, N, 'la siembra no cuadra con el esquema');

    const t0 = performance.now();
    for (let vuelta = 0; vuelta < 5; vuelta++) {
        const encontrados = fechas.map((/** @type {string} */ d) => checkins.findByDate(d));
        assert.equal(encontrados.length, N);
    }
    const ms = performance.now() - t0;

    // Cinco repasos completos de 730 registros. Cuadrático serían decenas de
    // segundos; con índice son milisegundos. El umbral es deliberadamente
    // holgado para no volverse inestable en CI, y aun así lo cazaría.
    assert.ok(ms < 500, `5 × ${N} findByDate tardaron ${Math.round(ms)} ms: ha vuelto el patrón N+1`);
});

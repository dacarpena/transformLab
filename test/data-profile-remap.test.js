// @ts-check

/**
 * La migración a ids opacos (M9-1) — el **riesgo número uno de todo el plan**.
 *
 * Es la única operación irreversible sobre datos que ya existen en el navegador
 * de alguien. Cada test de aquí fija un paso concreto y **se verificó
 * reintroduciendo su defecto**: si el código vuelve atrás, el test se pone en
 * rojo.
 *
 * Los cinco que más importan, y qué pasa sin ellos:
 *
 * | Sin él | Lo que le pasa a una persona |
 * |---|---|
 * | `mapa_primero` | el proceso muere a media copia, la re-entrada genera otros ids y media colección queda huérfana |
 * | `mapa_append_only` | ídem, pero además con destinos distintos en cada intento |
 * | `perfiles_del_indice` | un perfil inscrito sin claves conserva su `pN` y el índice mezcla formatos |
 * | `ui_keys_migradas` | la oferta de recalibrar que rechazó le vuelve a saltar |
 * | `indice_o_error` | arranca el onboarding **sobre sus datos intactos e invisibles** |
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import * as profiles from '../src/data/profiles.js';
import { SCHEMA_VERSION, rootPrefix } from '../src/data/version.js';
import {
    migrateStore, needsMigration, BACKUP_KEY_PREFIX, DONE_KEY_PREFIX, PENDING_KEY_PREFIX
} from '../src/data/migrations.js';
import {
    readTable, ensureTable, remapKeyRest, remapIndex, newProfileId,
    needsRemap, REMAP_KEY, RESERVED_PROFILE_IDS, FIRST_OPAQUE_VERSION
} from '../src/data/profile-remap.js';
import { DEMO_PROFILE_ID, NO_PROFILE, isReservedProfileId } from '../src/data/ids.js';

const NOW = '2026-08-21T10:00:00.000Z';
const V6 = rootPrefix(6);

/** @type {import('./helpers/local-storage-mock.js').LocalStorageMock} */
let mock;

beforeEach(() => {
    mock = installLocalStorageMock();
    storage.setActiveProfile(NO_PROFILE);
});

/** Siembra un almacén v6 con `n` perfiles y sus claves. */
function sembrarV6({ perfiles: ids = ['p1'], activo = 'p1', conUi = true } = {}) {
    mock.setItem(`${V6}profiles`, JSON.stringify({
        schemaVersion: 6,
        activeProfileId: activo,
        profiles: ids.map((id, i) => ({ id, name: `Perfil ${i + 1}`, createdAtISO: '2026-01-01T00:00:00.000Z' }))
    }));
    for (const id of ids) {
        mock.setItem(`${V6}${id}.settings`, JSON.stringify({
            schemaVersion: 6, locale: 'es', activeMeasures: ['waist'], fluctuationVisible: false, reminder: null
        }));
        mock.setItem(`${V6}${id}.checkins`, JSON.stringify({
            schemaVersion: 6,
            items: [{
                id: `ci_2026-01-0${ids.indexOf(id) + 1}`, dateISO: `2026-01-0${ids.indexOf(id) + 1}`,
                weightKg: 80 + ids.indexOf(id), fatPct: 20, scaleMuscleKg: null, boneKg: null,
                measuresCm: {}, subjective: {}, notes: '', createdAtISO: NOW, editedAtISO: null
            }]
        }));
        if (conUi) {
            mock.setItem(`${V6}${id}.ui.activeView`, '"progress"');
            mock.setItem(`${V6}${id}.ui.recalDeclinedFingerprint`, '"huella-abc"');
        }
    }
}

/**
 * Todas las claves del almacén con un prefijo.
 *
 * Se recorre con `length`/`key(i)`, que es la API de `Storage` de verdad. La
 * primera versión hacía `Object.keys(mock.store)` —`store` es un `Map`, no un
 * objeto— y devolvía SIEMPRE una lista vacía: dos tests pasaban comparando
 * `[]` con `[]`. Se descubrió porque un tercero afirmaba una cuenta concreta.
 */
function clavesCon(/** @type {string} */ prefix) {
    /** @type {string[]} */ const out = [];
    for (let i = 0; i < mock.length; i++) {
        const k = mock.key(i);
        if (k !== null && k.startsWith(prefix)) out.push(k);
    }
    return out.sort();
}

/* ── El generador ────────────────────────────────────────────────────────── */

test('los ids nuevos son opacos, únicos, y no llevan el punto que rompe la clave', () => {
    // El punto es el separador del namespace: un id que lo contuviera partiría
    // la clave en el sitio equivocado, y `setActiveProfile` lo rechaza.
    const vistos = new Set();
    for (let i = 0; i < 300; i++) {
        const id = newProfileId();
        assert.match(id, /^[A-Za-z0-9_-]{22}$/, `id con forma rara: ${id}`);
        assert.equal(id.includes('.'), false);
        assert.equal(storage.setActiveProfile(id).ok, true, `el almacén rechazó ${id}`);
        assert.equal(vistos.has(id), false, `id repetido en 300 tiradas: ${id}`);
        vistos.add(id);
    }
});

test('el esquema acepta un id opaco tal cual: no hay que tocar el validador', () => {
    storage.setActiveProfile(NO_PROFILE);
    const creado = profiles.create('Dani', { createdAtISO: NOW, id: newProfileId() });
    assert.ok(creado.ok, JSON.stringify(!creado.ok && creado.error));
    assert.ok(profiles.readIndex().ok, 'el índice con un id opaco no valida');
});

/* ── La tabla ────────────────────────────────────────────────────────────── */

test('mapa_primero: la tabla se persiste ANTES de copiar la primera clave', () => {
    // Los ids nuevos son ALEATORIOS: si la copia empezara antes de guardarlos,
    // una interrupción dejaría media colección bajo un id que nadie puede
    // recalcular. Los datos seguirían ahí, huérfanos e invisibles.
    sembrarV6();
    const escrituras = [];
    const setItem = mock.setItem.bind(mock);
    mock.setItem = (/** @type {string} */ k, /** @type {string} */ v) => { escrituras.push(k); return setItem(k, v); };

    assert.ok(migrateStore({ nowISO: NOW }).ok);

    const iTabla = escrituras.indexOf(REMAP_KEY);
    const iPrimeraV7 = escrituras.findIndex((k) => k.startsWith(rootPrefix()));
    assert.ok(iTabla >= 0, 'no se escribió la tabla');
    assert.ok(iPrimeraV7 >= 0, 'no se copió ninguna clave');
    assert.ok(iTabla < iPrimeraV7,
        `la tabla se escribió DESPUÉS de la primera clave (${iTabla} > ${iPrimeraV7})`);
});

test('la tabla vive fuera del prefijo versionado, para sobrevivir a la migración', () => {
    sembrarV6();
    assert.ok(migrateStore({ nowISO: NOW }).ok);
    assert.equal(REMAP_KEY.startsWith('tl.7.'), false);
    assert.equal(needsMigration().pending, false, 'la tabla se contó como dato a migrar');
});

test('mapa_append_only: re-entrar NUNCA cambia un destino ya asignado', () => {
    // Es lo que hace que una migración interrumpida converja: `target = f(key)`
    // vuelve a ser una función pura en cuanto la tabla está fijada.
    sembrarV6({ perfiles: ['p1', 'p2'], activo: 'p1' });
    const primera = ensureTable({ oldProfileIds: ['p1', 'p2'], nowISO: NOW, from: 6 });
    assert.ok(primera.ok);
    const antes = { ...primera.value.map };

    for (let i = 0; i < 5; i++) {
        const otra = ensureTable({ oldProfileIds: ['p1', 'p2'], nowISO: NOW, from: 6 });
        assert.ok(otra.ok);
        assert.equal(otra.reused, true, 'regeneró la tabla en vez de reutilizarla');
        assert.deepEqual(otra.value.map, antes, 'un destino cambió entre re-entradas');
    }
});

test('un perfil que aparece más tarde se AÑADE sin tocar los ya asignados', () => {
    const primera = ensureTable({ oldProfileIds: ['p1'], nowISO: NOW, from: 6 });
    assert.ok(primera.ok);
    const p1 = primera.value.map.p1;

    const segunda = ensureTable({ oldProfileIds: ['p1', 'p2'], nowISO: NOW, from: 6 });
    assert.ok(segunda.ok);
    assert.equal(segunda.value.map.p1, p1, 'se reasignó un destino existente');
    assert.ok(segunda.value.map.p2, 'no se asignó el perfil nuevo');
});

test('una tabla corrupta se trata como ausente, nunca se usa a medias', () => {
    // Copiar datos a destinos que salen de un objeto en el que no se puede
    // confiar es peor que generar una tabla nueva y dejar claves inertes.
    for (const basura of ['{roto', 'null', '[]', '{"map":"no soy un objeto"}',
        '{"map":{"p1":"con.punto"}}', '{"map":{"p1":123}}', '{"map":{"":"x"}}']) {
        mock.setItem(REMAP_KEY, basura);
        assert.equal(readTable(), null, `aceptó una tabla corrupta: ${basura}`);
    }
});

test('perfiles_del_indice: un perfil inscrito SIN claves también se remapea', () => {
    // Un `create()` interrumpido deja el perfil en el índice y sin ninguna
    // clave. Si solo se miraran las claves, se quedaría con su `pN` y el índice
    // acabaría mezclando formatos — válido para el esquema, o sea invisible.
    mock.setItem(`${V6}profiles`, JSON.stringify({
        schemaVersion: 6,
        activeProfileId: 'p1',
        profiles: [
            { id: 'p1', name: 'Con datos', createdAtISO: '2026-01-01T00:00:00.000Z' },
            { id: 'p7', name: 'Sin datos', createdAtISO: '2026-01-01T00:00:00.000Z' }
        ]
    }));
    mock.setItem(`${V6}p1.settings`, JSON.stringify({
        schemaVersion: 6, locale: 'es', activeMeasures: [], fluctuationVisible: false, reminder: null
    }));

    assert.ok(migrateStore({ nowISO: NOW }).ok);
    const tabla = readTable();
    assert.ok(tabla);
    assert.ok(tabla.map.p7, 'el perfil sin claves no entró en la tabla');
    assert.notEqual(tabla.map.p7, 'p7');

    const indice = JSON.parse(/** @type {string} */ (mock.getItem(`${rootPrefix()}profiles`)));
    const ids = indice.profiles.map((/** @type {*} */ p) => p.id);
    assert.deepEqual(ids.filter((/** @type {string} */ id) => /^p\d+$/.test(id)), [],
        `el índice mezcla ids opacos y pN: ${JSON.stringify(ids)}`);
});

/* ── El demo no se toca ──────────────────────────────────────────────────── */

test('el perfil de EJEMPLO conserva su id: no se sincroniza y su namespace es su garantía', () => {
    // Remapearlo rompería `isInstalled()`, `isDemo()` y `uninstall()` en
    // silencio, dejando un perfil que el usuario no puede borrar ocupando uno de
    // los diez huecos.
    sembrarV6({ perfiles: ['p1', DEMO_PROFILE_ID], activo: 'p1', conUi: false });
    assert.ok(migrateStore({ nowISO: NOW }).ok);

    const tabla = readTable();
    assert.ok(tabla);
    assert.equal(tabla.map[DEMO_PROFILE_ID], DEMO_PROFILE_ID);
    assert.notEqual(tabla.map.p1, 'p1');
    assert.ok(mock.getItem(`${rootPrefix()}${DEMO_PROFILE_ID}.checkins`),
        'las claves del ejemplo no llegaron a su namespace de siempre');
    assert.ok(isReservedProfileId(DEMO_PROFILE_ID));
    assert.deepEqual([...RESERVED_PROFILE_IDS], [DEMO_PROFILE_ID]);
});

/* ── La copia de claves ──────────────────────────────────────────────────── */

test('remapeo_sin_perdida: cada clave v6 tiene su gemela v7, con el mismo valor', () => {
    sembrarV6({ perfiles: ['p1', 'p2'], activo: 'p2' });
    const antes = clavesCon(V6);
    const r = migrateStore({ nowISO: NOW });
    assert.ok(r.ok);
    assert.deepEqual(r.value.warnings, []);

    const tabla = readTable();
    assert.ok(tabla);
    for (const vieja of antes) {
        const rest = vieja.slice(V6.length);
        const nueva = `${rootPrefix()}${remapKeyRest(rest, tabla.map)}`;
        assert.ok(mock.getItem(nueva) !== null, `no llegó a destino: ${vieja} → ${nueva}`);
    }
    assert.equal(r.value.keysMigrated, antes.length,
        `se copiaron ${r.value.keysMigrated} de ${antes.length}`);
});

test('la migración NUNCA borra: los originales de la v6 siguen ahí', () => {
    sembrarV6();
    const antes = clavesCon(V6);
    assert.ok(migrateStore({ nowISO: NOW }).ok);
    assert.deepEqual(clavesCon(V6), antes, 'se borró alguna clave de origen');
});

test('ui_keys_migradas: las claves de interfaz NO se descartan', () => {
    // DEFECTO PREEXISTENTE, confirmado reproduciéndolo: `collection` sale
    // valiendo `'ui.activeView'` —las claves de interfaz llevan dos puntos—, que
    // no está en `COLLECTIONS`; `migrateValue` recibía la cadena `"progress"`,
    // devolvía `migrations.notAnObject` y la clave SE PERDÍA. En cada subida de
    // esquema, para todos los usuarios.
    //
    // Efecto real: la oferta de recalibrar que el usuario había rechazado le
    // volvía a saltar, y desde M8-5d perdía `ui.accountSeen` — o sea, la
    // aplicación le ofrecía crear una cuenta que ya tenía.
    sembrarV6();
    const r = migrateStore({ nowISO: NOW });
    assert.ok(r.ok);
    assert.deepEqual(r.value.warnings, [], 'alguna clave de interfaz se descartó');

    const tabla = readTable();
    assert.ok(tabla);
    const ns = `${rootPrefix()}${tabla.map.p1}`;
    assert.equal(mock.getItem(`${ns}.ui.activeView`), '"progress"');
    assert.equal(mock.getItem(`${ns}.ui.recalDeclinedFingerprint`), '"huella-abc"');
});

test('un valor CORRUPTO sí se avisa: no es lo mismo que una colección desconocida', () => {
    sembrarV6({ conUi: false });
    mock.setItem(`${V6}p1.checkins`, 'esto no es json');
    const r = migrateStore({ nowISO: NOW });
    assert.ok(r.ok);
    assert.ok(r.value.warnings.includes(`${V6}p1.checkins`),
        'un valor ilegible pasó sin aviso');
});

/* ── Interrupciones ──────────────────────────────────────────────────────── */

test('re-entrar tras una migración a medias converge a los MISMOS destinos', () => {
    sembrarV6({ perfiles: ['p1', 'p2'] });

    // Primera pasada: solo se deja escribir la tabla y dos claves.
    const setItem = mock.setItem.bind(mock);
    let escritas = 0;
    mock.setItem = (/** @type {string} */ k, /** @type {string} */ v) => {
        if (k.startsWith(rootPrefix()) && ++escritas > 2) throw new Error('QuotaExceededError');
        return setItem(k, v);
    };
    migrateStore({ nowISO: NOW });
    const tabla1 = readTable();
    assert.ok(tabla1);

    // Se restaura el almacén y se re-entra.
    mock.setItem = setItem;
    // El testigo de «pendiente» hace que `needsMigration` la vuelva a ver.
    mock.removeItem(`${DONE_KEY_PREFIX}6`);
    const r = migrateStore({ nowISO: '2026-08-22T10:00:00.000Z' });
    assert.ok(r.ok);

    const tabla2 = readTable();
    assert.ok(tabla2);
    assert.deepEqual(tabla2.map, tabla1.map, 'la re-entrada generó destinos distintos');

    // Y todo está en su sitio.
    for (const vieja of clavesCon(V6)) {
        const nueva = `${rootPrefix()}${remapKeyRest(vieja.slice(V6.length), tabla2.map)}`;
        assert.ok(mock.getItem(nueva) !== null, `quedó sin copiar: ${vieja}`);
    }
});

test('backup_una_sola_vez: la copia previa no se reescribe en cada pasada', () => {
    // La copia que vale es la del día en que los datos estaban enteros.
    sembrarV6();
    assert.ok(migrateStore({ nowISO: NOW }).ok);
    const primera = mock.getItem(`${BACKUP_KEY_PREFIX}6`);
    assert.ok(primera);

    mock.removeItem(`${DONE_KEY_PREFIX}6`);
    assert.ok(migrateStore({ nowISO: '2027-01-01T00:00:00.000Z' }).ok);
    assert.equal(mock.getItem(`${BACKUP_KEY_PREFIX}6`), primera,
        'la copia de seguridad se machacó en la segunda pasada');
});

test('un fallo de ESCRITURA deja la migración pendiente, no cerrada', () => {
    // Es la diferencia entre «este dato no se puede interpretar» —que
    // reintentar no arregla— y «no cupo» —que sí—. Sin distinguirlas, el testigo
    // se escribía igual y esas claves no se reintentaban NUNCA.
    sembrarV6({ conUi: false });
    const setItem = mock.setItem.bind(mock);
    let n = 0;
    mock.setItem = (/** @type {string} */ k, /** @type {string} */ v) => {
        if (k.startsWith(`${rootPrefix()}`) && k.endsWith('.checkins') && n++ === 0) {
            throw new Error('QuotaExceededError');
        }
        return setItem(k, v);
    };
    const r = migrateStore({ nowISO: NOW });
    mock.setItem = setItem;
    assert.ok(r.ok);
    assert.ok((r.value.retryable ?? []).length > 0, 'no se clasificó como reintentable');
    assert.equal(mock.getItem(`${DONE_KEY_PREFIX}6`), null,
        'se cerró la migración con claves sin escribir');
    assert.ok(mock.getItem(`${PENDING_KEY_PREFIX}6`), 'no se dejó constancia de lo pendiente');
});

test('indice_o_error: si el índice no llega, se DEVUELVE ERROR', () => {
    // Sin él, `readIndex()` devuelve un índice VACÍO —no un error— y el arranque
    // crea un perfil nuevo y lanza el onboarding sobre los datos intactos e
    // invisibles del usuario. Es el peor desenlace posible de esta función.
    sembrarV6({ conUi: false });
    const setItem = mock.setItem.bind(mock);
    mock.setItem = (/** @type {string} */ k, /** @type {string} */ v) => {
        if (k === `${rootPrefix()}profiles`) throw new Error('QuotaExceededError');
        return setItem(k, v);
    };
    const r = migrateStore({ nowISO: NOW });
    mock.setItem = setItem;
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'migrations.indexMissing');
});

test('preflight_cuota: con el almacén casi lleno se aborta SIN escribir nada', () => {
    sembrarV6({ conUi: false });
    // Un bulto que deja el almacén por encima del umbral.
    mock.setItem('tl.bulto', 'x'.repeat(2_600_000));

    const escrituras = [];
    const setItem = mock.setItem.bind(mock);
    mock.setItem = (/** @type {string} */ k, /** @type {string} */ v) => { escrituras.push(k); return setItem(k, v); };
    const r = migrateStore({ nowISO: NOW });
    mock.setItem = setItem;

    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'migrations.quotaInsufficient');
    assert.deepEqual(escrituras, [], 'escribió algo pese a abortar por cuota');
    assert.equal(mock.getItem(`${BACKUP_KEY_PREFIX}6`), null);
});

/* ── El orden de versiones ───────────────────────────────────────────────── */

test('needsMigration coge la versión MÁS NUEVA con datos, no la más vieja', () => {
    // Ascendente pierde datos con una 5→6 interrumpida sobre la que se siguió
    // usando la v6: elegiría `from = 5`, copiaría lo viejo a unos destinos v7
    // vacíos, y los datos v6 —los buenos— quedarían huérfanos para siempre.
    const V5 = rootPrefix(5);
    mock.setItem(`${V5}profiles`, JSON.stringify({ schemaVersion: 5, activeProfileId: 'p1', profiles: [{ id: 'p1', name: 'Viejo', createdAtISO: '2026-01-01T00:00:00.000Z' }] }));
    mock.setItem(`${V5}p1.settings`, JSON.stringify({ schemaVersion: 5, locale: 'en', activeMeasures: [], fluctuationVisible: false, reminder: null }));
    sembrarV6({ conUi: false });

    assert.equal(needsMigration().from, 6, 'eligió los datos rancios');
    const r = migrateStore({ nowISO: NOW });
    assert.ok(r.ok && r.value.from === 6);

    // Y lo que llegó es lo de la v6, no lo de la v5.
    const tabla = readTable();
    assert.ok(tabla);
    const settings = JSON.parse(/** @type {string} */ (mock.getItem(`${rootPrefix()}${tabla.map.p1}.settings`)));
    assert.equal(settings.locale, 'es', 'ganaron los datos de la v5');
});

test('needsRemap: solo por debajo de la primera versión opaca', () => {
    // Un salto futuro v7→v8 no puede regenerar ids que ya eran opacos.
    assert.equal(FIRST_OPAQUE_VERSION, 7);
    assert.equal(needsRemap(5), true);
    assert.equal(needsRemap(6), true);
    assert.equal(needsRemap(7), false);
    assert.equal(needsRemap(8), false);
    assert.equal(needsRemap(/** @type {*} */ ('seis')), false);
});

/* ── Las piezas puras ────────────────────────────────────────────────────── */

test('remapKeyRest corta por el PRIMER punto y respeta las claves globales', () => {
    const map = { p1: 'OPACO' };
    assert.equal(remapKeyRest('p1.checkins', map), 'OPACO.checkins');
    // Las claves de interfaz llevan dos puntos: partir por todos convertiría
    // `ui.activeView` en `ui`.
    assert.equal(remapKeyRest('p1.ui.activeView', map), 'OPACO.ui.activeView');
    assert.equal(remapKeyRest('profiles', map), 'profiles', 'tocó una clave global');
    // Un perfil que no está en la tabla se deja como está: copiarlo a su propio
    // id es preferible a descartarlo.
    assert.equal(remapKeyRest('p9.checkins', map), 'p9.checkins');
});

test('remapIndex reescribe los ids Y el activo, y no rompe un índice raro', () => {
    const map = { p1: 'A', p2: 'B' };
    const salida = /** @type {*} */ (remapIndex({
        schemaVersion: 6, activeProfileId: 'p2',
        profiles: [{ id: 'p1', name: 'Uno' }, { id: 'p2', name: 'Dos' }]
    }, map));
    assert.equal(salida.activeProfileId, 'B');
    assert.deepEqual(salida.profiles.map((/** @type {*} */ p) => p.id), ['A', 'B']);
    assert.equal(salida.profiles[0].name, 'Uno', 'perdió el resto del perfil');

    // Entradas que no tienen forma de índice se devuelven tal cual, sin lanzar.
    for (const basura of [null, 42, 'x', [], {}, { profiles: 'no soy un array' }]) {
        assert.doesNotThrow(() => remapIndex(basura, map));
    }
});

/* ── El camino completo, por la puerta de la aplicación ──────────────────── */

test('tras migrar, la aplicación encuentra su perfil y sus datos por el id nuevo', () => {
    sembrarV6({ perfiles: ['p1', 'p2'], activo: 'p2' });
    assert.ok(migrateStore({ nowISO: NOW }).ok);

    const indice = profiles.readIndex();
    assert.ok(indice.ok, `readIndex falló: ${!indice.ok && indice.error}`);
    assert.equal(indice.value.profiles.length, 2);

    profiles.activateStored();
    const activo = profiles.getActive();
    assert.ok(activo.ok && activo.value !== '');

    const tabla = readTable();
    assert.ok(tabla);
    assert.equal(activo.value, tabla.map.p2, 'el activo no es el que dice la tabla');

    const checkins = storage.get('checkins');
    assert.ok(checkins.ok && checkins.value, 'los datos no se alcanzan por el id nuevo');
    assert.equal(/** @type {*} */ (checkins.value).items[0].weightKg, 81, 'llegaron los datos del OTRO perfil');
    assert.equal(/** @type {*} */ (checkins.value).schemaVersion, SCHEMA_VERSION);
});

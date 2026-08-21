// @ts-check

/**
 * La política de sincronización: repartir cada colección en filas y volver a
 * juntarla (M9-2).
 *
 * Los invariantes de aquí son los que deciden si sincronizar **pierde datos de
 * una persona**. Cada uno lleva escrito el defecto que lo pone en rojo, y los
 * más importantes se verificaron aplicando ese defecto a mano.
 *
 * Los cuatro que más pesan:
 *
 * | Invariante | Lo que evita |
 * |---|---|
 * | `reparto_ida_y_vuelta` | que `join` ordene por clave «porque converge mejor» y destruya el orden de inserción |
 * | `join_revalida` | que una fusión inválida degrade la colección a su valor de fábrica — y que el siguiente gesto del usuario lo persista |
 * | `clave_por_fecha` | que dos check-ins del mismo día sobrevivan y la gráfica pinte dos puntos |
 * | `ambito_declarado` | que un campo nuevo viaje sin que nadie lo haya decidido |
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCollection, COLLECTIONS } from '../src/data/schema.js';
import { SCHEMA_VERSION } from '../src/data/version.js';
import {
    split, join, canonicalize, merge, mergeRow, collections, scopeOf, noteOf, partsOf
} from '../src/data/sync-policy.js';
import { FIXTURES, todasLasFormas } from './helpers/collection-fixtures.js';

const json = (/** @type {unknown} */ v) => JSON.stringify(v);

/** Reparte y junta, exigiendo que las dos mitades vayan bien. */
function ida(collection, value) {
    const partido = split(collection, value);
    assert.ok(partido.ok, `split falló en ${collection}: ${!partido.ok && partido.error}`);
    const juntado = join(collection, partido.rows);
    assert.ok(juntado.ok, `join falló en ${collection}: ${!juntado.ok && juntado.error}`);
    return juntado;
}

/* ── El manifiesto ───────────────────────────────────────────────────────── */

test('manifiesto_de_reparto: las QUINCE colecciones tienen política, y ninguna sobra', () => {
    // Sin esto, añadir una colección a `COLLECTIONS` y olvidarse de la política
    // significa que sus datos no viajan y nadie se entera.
    assert.deepEqual(collections(), Object.keys(COLLECTIONS).sort());
});

test('cada colección explica POR QUÉ se reparte así', () => {
    // El modo de una colección es una decisión con consecuencias —perder gramos,
    // perder una alergia— y una tabla sin razones se cambia sin pensarlo.
    for (const c of collections()) {
        assert.ok(noteOf(c).length > 80, `${c} no explica su modo`);
    }
});

test('ambito_declarado: qué viaja y qué no está decidido, campo por campo', () => {
    // La lista se escribe AQUÍ a mano: un campo nuevo sin ámbito da rojo, no
    // silencio.
    assert.deepEqual(
        Object.fromEntries(collections().map((c) => [c, scopeOf(c)])),
        {
            achievements: 'sync',
            checkins: 'sync',
            intakeLog: 'sync',
            nutrition: 'local',      // hasta que los ids dejen de colisionar
            pantry: 'sync',
            photos: 'local',         // la fila es un puntero; el blob va en M9-5
            plan: 'sync',            // solo `history`
            preferences: 'sync',
            profile: 'sync',
            recipes: 'local',        // ídem nutrition
            settings: 'sync',        // solo algunos campos
            steps: 'sync',
            supplementsPlan: 'sync',
            training: 'local',       // `exercise.id` colisiona entre dispositivos
            volumeLog: 'local'       // caché de una derivación, sin consumidores
        });

    // Y dentro de `settings`, campo por campo: el idioma y el recordatorio son
    // del DISPOSITIVO. Sin esta línea, mover el zoom de una gráfica en el
    // portátil le cambiaría el idioma al móvil.
    assert.deepEqual(
        Object.fromEntries(partsOf('settings').map((p) => [/** @type {*} */ (p).field, p.scope])),
        {
            locale: 'local',
            activeMeasures: 'sync',
            fluctuationVisible: 'sync',
            checkinDetailOpen: 'sync',
            reminder: 'local',
            analysis: 'local'
        });

    // Y en `plan`, solo el historial viaja: `current` se regenera en cada
    // arranque desde el perfil.
    assert.deepEqual(
        Object.fromEntries(partsOf('plan').map((p) => [/** @type {*} */ (p).field, p.scope])),
        { current: 'local', params: 'local', history: 'sync' });
});

/* ── El invariante ───────────────────────────────────────────────────────── */

test('reparto_ida_y_vuelta: sobre las 53 formas del corpus, y contra el valor VALIDADO', () => {
    // El lado derecho es el valor VALIDADO, no el crudo: `objectOf` materializa
    // los `opt()` ausentes como `null`, así que el validador devuelve un objeto
    // con MÁS claves. Comparar contra el crudo daría rojo por algo que no falla.
    //
    // Ese mismo detalle tiene una consecuencia que costó descubrir: **no hace
    // falta un test aparte de «join no compacta los nulos»**. Se escribió uno y
    // NO discriminaba — quitando el `?? null` de la reconstrucción seguía en
    // verde— porque `join` devuelve el valor validado y el validador repone la
    // clave. Un opcional ausente y uno a `null` son la misma cosa para este
    // esquema. Lo que sí puede fallar es que `join` devuelva el objeto que
    // construye en vez del validado, y eso lo caza esta comparación.
    //
    // Se deja escrito porque la tentación de volver a añadir aquel test es real,
    // y un test que no puede fallar es peor que no tenerlo.
    const formas = todasLasFormas();
    assert.ok(formas.length >= 50, `solo ${formas.length} formas: el corpus se ha encogido`);

    for (const [c, forma, v] of formas) {
        const r = ida(c, v);
        assert.equal(json(r.value), json(validateCollection(c, v).value),
            `${c}/${forma} no sobrevivió a la ida y vuelta`);
        assert.deepEqual(r.quarantined, [], `${c}/${forma} puso filas en cuarentena`);
    }
});

test('reparto_ida_y_vuelta: el ORDEN DE INSERCIÓN se conserva, no se ordena por clave', () => {
    // Ordenar «porque los dos dispositivos convergen mejor» es el defecto que
    // una implementación perezosa comete de verdad. Rellenar una fecha pasada es
    // el caso NORMAL, no el raro, y la vista de entrenamiento depende del orden.
    const desordenado = {
        schemaVersion: SCHEMA_VERSION,
        items: ['2026-05-10', '2026-05-03', '2026-05-07'].map((dateISO) => ({
            id: `ci_${dateISO}`, dateISO, weightKg: 88, fatPct: null,
            scaleMuscleKg: null, boneKg: null, measuresCm: {}, subjective: {},
            notes: '', createdAtISO: '2026-05-01T08:00:00.000Z', editedAtISO: null
        }))
    };
    const r = ida('checkins', desordenado);
    assert.deepEqual(
        /** @type {*} */ (r.value).items.map((/** @type {*} */ i) => i.dateISO),
        ['2026-05-10', '2026-05-03', '2026-05-07'],
        'se reordenó por clave');
});

test('canonizacion_estable: canonicalize es IDEMPOTENTE en todo el corpus', () => {
    // Es la forma del invariante que se cumple SIEMPRE, incluso con claves
    // repetidas — donde la primera no puede cumplirse porque el reparto colapsa
    // a propósito.
    for (const [c, forma, v] of todasLasFormas()) {
        const una = canonicalize(c, v);
        assert.ok(una.ok, `${c}/${forma}: ${!una.ok && una.error}`);
        const dos = canonicalize(c, una.value);
        assert.ok(dos.ok);
        assert.equal(json(dos.value), json(una.value), `${c}/${forma} no es idempotente`);
    }
});

/* ── Las claves ──────────────────────────────────────────────────────────── */

test('claves_sin_separador: un id con puntos, dos puntos y barras sobrevive', () => {
    // `pantry.id` y `photos.id` no tienen `pattern`. Concatenar la clave con `:`
    // o `|` es el defecto que `photos-remap.js` ya documenta haber sufrido.
    const raros = ['a.b:c/d', 'foto: a/b', 'weight|2019-04-01"x', '["ya","json"]'];
    const v = {
        schemaVersion: SCHEMA_VERSION,
        items: raros.map((id, n) => ({
            id, name: `Cosa ${n}`, quantity: n + 1, unit: 'g', foodId: null, expiresISO: null
        }))
    };
    // La despensa viaja como documento, así que se prueba sobre `recipes`, que
    // sí se parte por item y comparte la clase de id.
    const rv = {
        schemaVersion: SCHEMA_VERSION,
        items: raros.map((id, n) => ({
            id, name: `Receta ${n}`, servings: 1,
            ingredients: [{ name: 'x', quantity: 1, unit: 'g', foodId: null }], notes: null
        }))
    };
    const r = ida('recipes', rv);
    assert.deepEqual(
        /** @type {*} */ (r.value).items.map((/** @type {*} */ i) => i.id), raros,
        'un id con separadores se perdió o se fundió con otro');

    // Y las claves son ARRAYS, no cadenas: es lo que lo hace posible.
    const partido = split('recipes', rv);
    assert.ok(partido.ok);
    for (const fila of partido.rows) {
        assert.ok(Array.isArray(fila.keyPath), 'una keyPath no es un array');
        assert.equal(fila.keyPath.every((s) => typeof s === 'string'), true);
    }
    assert.ok(validateCollection('pantry', v).ok, 'el fixture de despensa no valida');
});

test('clave_por_fecha: dos check-ins del MISMO día colapsan en uno', () => {
    // Con clave `id`, los dos sobrevivirían: `findByDate` devolvería el último,
    // `evaluateSeries` evaluaría los dos, y la gráfica pintaría dos puntos ese
    // día. La aplicación se contradiría consigo misma.
    const base = {
        dateISO: '2026-05-03', weightKg: 88, fatPct: null, scaleMuscleKg: null,
        boneKg: null, measuresCm: {}, subjective: {}, notes: '',
        createdAtISO: '2026-05-01T08:00:00.000Z', editedAtISO: null
    };
    const v = {
        schemaVersion: SCHEMA_VERSION,
        items: [{ ...base, id: 'ci_2026-05-03' }, { ...base, id: 'otro_id', weightKg: 87 }]
    };
    assert.ok(validateCollection('checkins', v).ok, 'el esquema NO impide el duplicado');

    const r = ida('checkins', v);
    assert.equal(/** @type {*} */ (r.value).items.length, 1, 'sobrevivieron los dos');

    // Y el `id` viaja como carga útil, no se reconstruye: un backup con un id no
    // canónico tiene que volver tal cual.
    assert.equal(/** @type {*} */ (r.value).items[0].id, 'ci_2026-05-03');
});

test('la clave compuesta de volumeLog no funde semanas ni grupos', () => {
    // Cuatro filas: dos semanas × dos grupos. Con una clave de un solo campo,
    // dos de las cuatro desaparecerían.
    const r = ida('volumeLog', FIXTURES.volumeLog.varios);
    assert.equal(/** @type {*} */ (r.value).items.length, 4);
});

/* ── join no puede devolver basura ───────────────────────────────────────── */

test('join_revalida: NUNCA devuelve un valor que el esquema rechace', () => {
    // Es la regla más importante del módulo. Las colecciones documento degradan
    // a su valor de fábrica cuando la validación falla, y el siguiente gesto
    // normal del usuario lo PERSISTE: un fallo de fusión se convertiría en
    // pérdida definitiva de alergias o del perfil entero.
    for (const [c, forma, v] of todasLasFormas()) {
        const r = ida(c, v);
        assert.ok(validateCollection(c, r.value).ok,
            `${c}/${forma}: join devolvió algo que el esquema rechaza`);
    }
});

test('cuarentena_por_fila: una fila mala NO se lleva por delante la colección', () => {
    // `recipes.notes` no admite cadena vacía, a diferencia de `nutrition.notes` y
    // `photos.note`. Sin cuarentena, una sola receta con `notes: ''` tumbaría
    // `arrayOf` y los lectores degradarían a lista vacía: doscientas recetas
    // perdidas por una.
    const buena = {
        id: 're_ok', name: 'Buena', servings: 2,
        ingredients: [{ name: 'x', quantity: 1, unit: 'g', foodId: null }], notes: null
    };
    const mala = { ...buena, id: 're_mala', notes: '' };
    // La mala va la PRIMERA a propósito. Con ella al final, el recorte por cota
    // —que poda por la cola— la quitaba de rebote y el test pasaba aunque la
    // cuarentena no existiera: pasaba por la razón equivocada.
    assert.equal(validateCollection('recipes', { schemaVersion: SCHEMA_VERSION, items: [mala] }).ok, false,
        'el fixture malo resultó válido: este test no probaría nada');

    const filas = [mala, buena].map((item, i) => ({
        collection: 'recipes', keyPath: ['items', item.id],
        ordinal: i, scope: /** @type {const} */ ('local'), value: item
    }));
    const r = join('recipes', filas);
    assert.ok(r.ok, 'la fila mala tumbó la colección entera');
    assert.equal(/** @type {*} */ (r.value).items.length, 1);
    assert.equal(/** @type {*} */ (r.value).items[0].id, 're_ok');
    assert.equal(r.quarantined.length, 1, 'la fila descartada no se informó');
    assert.deepEqual(r.quarantined[0].keyPath, ['items', 're_mala']);
});

test('el desbordamiento de una cota se RECORTA e informa, no tumba la colección', () => {
    // Dos dispositivos con sesenta exclusiones duras cada uno dan ciento veinte.
    // `arrayOf` tumbaría `preferences`, `get()` degradaría a vacío y el siguiente
    // `save()` borraría las alergias. Recortar en silencio también es malo: lo
    // recortado se informa (§4, B9).
    const muchas = Array.from({ length: 140 }, (_, i) => `alergia_${i}`);
    const filas = muchas.map((m, i) => ({
        collection: 'preferences', keyPath: ['hardExclusions', m],
        ordinal: i, scope: /** @type {const} */ ('sync'), value: m
    }));
    const r = join('preferences', filas);
    assert.ok(r.ok, 'ciento cuarenta exclusiones tumbaron la colección');
    const dentro = /** @type {*} */ (r.value).hardExclusions;
    assert.ok(dentro.length > 0 && dentro.length < 140, `quedaron ${dentro.length}`);
    assert.equal(r.quarantined.length, 140 - dentro.length, 'lo recortado no se informó');
    assert.ok(validateCollection('preferences', r.value).ok);
});

/* ── Lápidas ─────────────────────────────────────────────────────────────── */

test('lapida_no_resucita: una fila viva no puede deshacer un borrado', () => {
    // Si pudiera, bastaría con que el dispositivo que NO vio el borrado hablara
    // el último. Y un check-in resucitado no es inocuo: entra en la serie y
    // puede ofrecer recalibrar el plan por una divergencia que el usuario ya
    // había eliminado.
    const item = {
        id: 'ci_2026-05-03', dateISO: '2026-05-03', weightKg: 88, fatPct: null,
        scaleMuscleKg: null, boneKg: null, measuresCm: {}, subjective: {}, notes: '',
        createdAtISO: '2026-05-01T08:00:00.000Z', editedAtISO: null
    };
    const viva = {
        collection: 'checkins', keyPath: ['items', '2026-05-03'],
        ordinal: 0, scope: /** @type {const} */ ('sync'), value: item
    };
    const lapida = { ...viva, deleted: /** @type {const} */ (true), value: undefined };

    // En los dos órdenes de llegada: la lápida gana siempre.
    for (const filas of [[viva, lapida], [lapida, viva]]) {
        const r = join('checkins', filas);
        assert.ok(r.ok);
        assert.equal(/** @type {*} */ (r.value).items.length, 0,
            `la lápida no ganó con el orden ${filas === undefined ? '' : json(filas.map((f) => Boolean(f.deleted)))}`);
    }
});

test('split NUNCA produce lápidas: no puede saber qué se borró', () => {
    // `split` solo ve el estado actual. Las lápidas las emite M9-3 comparando
    // dos repartos; aquí solo se define su forma.
    for (const [c, , v] of todasLasFormas()) {
        const r = split(c, v);
        assert.ok(r.ok);
        assert.equal(r.rows.some((f) => f.deleted), false, `${c} produjo una lápida`);
    }
});

/* ── Fusión ──────────────────────────────────────────────────────────────── */

test('orden_convergente: fusionar A con B da lo MISMO que B con A', () => {
    // Sin conmutatividad no hay convergencia: los dos dispositivos acabarían con
    // estados distintos y cada uno se lo enviaría al otro para siempre.
    const a = FIXTURES.achievements.varios;
    const b = {
        schemaVersion: SCHEMA_VERSION,
        unlocked: [
            { id: 'first_checkin', atISO: '2026-04-01T08:00:00.000Z' },   // más antiguo
            { id: 'streak_12', atISO: '2026-07-01T08:00:00.000Z' }
        ]
    };
    const ab = merge('achievements', a, b);
    const ba = merge('achievements', b, a);
    assert.ok(ab.ok && ba.ok);
    assert.equal(json(ab.value), json(ba.value), 'la fusión no es conmutativa');
});

test('un logro no se re-bloquea, y conserva la fecha MÁS ANTIGUA', () => {
    // Se desbloqueó entonces, no cuando el otro dispositivo se enteró.
    const a = { schemaVersion: SCHEMA_VERSION, unlocked: [{ id: 'first_kg', atISO: '2026-06-01T08:00:00.000Z' }] };
    const b = { schemaVersion: SCHEMA_VERSION, unlocked: [{ id: 'first_kg', atISO: '2026-04-01T08:00:00.000Z' }] };
    const r = merge('achievements', a, b);
    assert.ok(r.ok);
    const lista = /** @type {*} */ (r.value).unlocked;
    assert.equal(lista.length, 1, 'se duplicó el logro');
    assert.equal(lista[0].atISO, '2026-04-01T08:00:00.000Z');
});

test('el historial del plan se UNE por instante, sin duplicar', () => {
    const a = FIXTURES.plan.conHistorial;
    const b = {
        schemaVersion: SCHEMA_VERSION, current: null, params: null,
        history: [
            // La misma entrada que ya tiene A, escrita con otro formato de instante.
            { plan: null, params: null, archivedAtISO: '2026-05-01T10:00:00.000+00:00', reason: 'weightDeviation' },
            { plan: null, params: null, archivedAtISO: '2026-07-01T10:00:00.000Z', reason: 'manual' }
        ]
    };
    const r = merge('plan', a, b);
    assert.ok(r.ok, !r.ok ? r.error : '');
    const h = /** @type {*} */ (r.value).history;
    assert.equal(h.length, 3, `se esperaban 3 entradas y hay ${h.length}`);
    // El dato viaja LITERAL: la normalización vive en la clave, no en el valor.
    assert.ok(h.some((/** @type {*} */ e) => e.reason === 'manual'));
});

test('mergeRow: el peso rápido NO borra las medidas del check-in completo', () => {
    // Los dos escritores producen filas asimétricas. Entre dispositivos, «gana el
    // último» hace que apuntar el peso por la mañana en el móvil borre la
    // cintura, las escalas y las notas de la tarde — y las dos filas son
    // válidas, así que no hay conflicto que detectar.
    const rapido = {
        id: 'ci_2026-05-03', dateISO: '2026-05-03', weightKg: 87.4, fatPct: null,
        scaleMuscleKg: null, boneKg: null, measuresCm: {}, subjective: {}, notes: '',
        createdAtISO: '2026-05-03T07:00:00.000Z', editedAtISO: null
    };
    const completo = {
        ...rapido, weightKg: 87.6, fatPct: 23.5, scaleMuscleKg: 40.2, boneKg: 3.4,
        measuresCm: { waist: 92, chest: 104 },
        subjective: { energy: 7, sleep: 8 },
        notes: 'buena semana'
    };

    const r = mergeRow('checkins', rapido, completo);
    assert.equal(r.weightKg, 87.4, 'el peso lo decide quien gana, y aquí gana `a`');
    assert.deepEqual(r.measuresCm, { waist: 92, chest: 104 }, 'se perdieron las medidas');
    assert.deepEqual(r.subjective, { energy: 7, sleep: 8 }, 'se perdieron las escalas');
    assert.equal(r.notes, 'buena semana', 'se perdieron las notas');
    assert.equal(r.fatPct, 23.5, 'un nulo pisó un valor');
    assert.equal(r.scaleMuscleKg, 40.2);
    assert.equal(r.boneKg, 3.4);
    assert.ok(validateCollection('checkins', { schemaVersion: SCHEMA_VERSION, items: [r] }).ok);
});

test('mergeRow: un valor del ganador SÍ pisa al del perdedor', () => {
    // La regla es «un nulo no pisa un valor», no «el perdedor siempre gana».
    const a = { measuresCm: { waist: 90 }, subjective: {}, notes: 'nueva', fatPct: 22, scaleMuscleKg: null, boneKg: null };
    const b = { measuresCm: { waist: 92, chest: 104 }, subjective: {}, notes: 'vieja', fatPct: 24, scaleMuscleKg: null, boneKg: null };
    const r = mergeRow('checkins', a, b);
    assert.equal(r.measuresCm.waist, 90, 'el valor del ganador no se impuso');
    assert.equal(r.measuresCm.chest, 104, 'se perdió una medida que solo tenía el perdedor');
    assert.equal(r.notes, 'nueva');
    assert.equal(r.fatPct, 22);
});

test('mergeRow no toca las demás colecciones: devuelve el ganador tal cual', () => {
    // Solo `checkins` necesita fusión por campo. Para el resto, `mergeRow`
    // devuelve `a` sin mirarlo: quién es `a` lo decide M9-4 con el reloj del
    // servidor.
    assert.equal(mergeRow('steps', { a: 1 }, { a: 2 }).a, 1);
    assert.equal(mergeRow('profile', { x: 1 }, { x: 2 }).x, 1);
    assert.equal(mergeRow('pantry', null, { x: 1 }), null);
});

test('merge impone un orden CANÓNICO, aunque join conserve el de inserción', () => {
    // Son dos propiedades distintas y las dos hacen falta: `join` no reordena
    // —rellenar una fecha pasada no debe mover la lista de nadie— y `merge` sí,
    // porque entre dispositivos el orden de inserción no existe.
    const desordenado = {
        schemaVersion: SCHEMA_VERSION,
        items: ['2026-05-10', '2026-05-03'].map((dateISO) => ({ dateISO, steps: 1000 }))
    };
    const otro = {
        schemaVersion: SCHEMA_VERSION,
        items: [{ dateISO: '2026-05-07', steps: 2000 }]
    };
    // El reparto local NO reordena.
    assert.deepEqual(
        /** @type {*} */ (ida('steps', desordenado).value).items.map((/** @type {*} */ i) => i.dateISO),
        ['2026-05-10', '2026-05-03']);

    // La fusión SÍ, y por eso converge.
    const r = merge('steps', desordenado, otro);
    assert.ok(r.ok);
    assert.deepEqual(
        /** @type {*} */ (r.value).items.map((/** @type {*} */ i) => i.dateISO),
        ['2026-05-03', '2026-05-07', '2026-05-10']);
});

/* ── Entradas malas ──────────────────────────────────────────────────────── */

test('nada de esto lanza: una colección desconocida o un valor inválido se reportan', () => {
    for (const fn of [
        () => split('inventada', {}),
        () => join('inventada', []),
        () => canonicalize('inventada', {}),
        () => split('checkins', null),
        () => split('checkins', { schemaVersion: SCHEMA_VERSION, items: 'no soy un array' }),
        () => merge('checkins', {}, null)
    ]) {
        const r = fn();
        assert.equal(r.ok, false, 'aceptó una entrada inválida');
        assert.equal(typeof (/** @type {*} */ (r).error), 'string');
    }
});

test('filas de OTRA colección se ignoran en vez de colarse', () => {
    const ajena = {
        collection: 'steps', keyPath: ['items', '2026-05-01'],
        ordinal: 0, scope: /** @type {const} */ ('sync'), value: { dateISO: '2026-05-01', steps: 100 }
    };
    const r = join('checkins', [ajena]);
    assert.ok(r.ok);
    assert.deepEqual(/** @type {*} */ (r.value).items, []);
});

test('los valores de prueba del corpus son todos VÁLIDOS', () => {
    // Un fixture inválido convertiría un fallo del invariante en una discusión
    // sobre el fixture.
    for (const [c, forma, v] of todasLasFormas()) {
        assert.ok(validateCollection(c, v).ok, `el fixture ${c}/${forma} no valida`);
    }
    // Y cubren las quince colecciones.
    assert.deepEqual(Object.keys(FIXTURES).sort(), Object.keys(COLLECTIONS).sort());
});

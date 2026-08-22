// @ts-check

/**
 * Los ids de ITEM pasan a ser opacos (v7 → v8).
 *
 * Es el mismo defecto que M9-1 arregló para los perfiles, un nivel más abajo y
 * en cuatro colecciones. Los generadores construían
 * `<prefijo>_<longitud+1>_<slug>`, deterministas a propósito para no depender
 * del reloj ni del azar: dentro de un dispositivo está bien, entre dos es una
 * **certeza de colisión**.
 *
 * Y no con nombres rebuscados. Reproducido con tres pares que cualquiera
 * escribe:
 *
 * ```
 *   Press de banca con barra   /  Press de banca con mancuernas → ex_1_Pressdeban
 *   Curl de bíceps con barra   /  Curl de bíceps en polea       → ex_1_Curldebce
 *   Elevaciones laterales      /  Elevaciones frontales         → ex_1_Elevaciones
 * ```
 *
 * En `training` la consecuencia no es perder datos: es que las series de un
 * ejercicio se atribuyan al grupo muscular de otro —porque `catalogId` difiere—
 * y que el usuario vea un volumen semanal falso presentado como verdadero. Es
 * exactamente la clase de defecto que hundió la v4.0.
 *
 * La transformación va por `STEPS` y no por el renombrado de claves, porque
 * estos ids viven DENTRO del valor de la colección, no en su clave.
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import * as training from '../src/data/training.js';
import * as recipes from '../src/data/recipes.js';
import * as nutrition from '../src/data/nutrition.js';
import { migrateValue } from '../src/data/migrate-value.js';
import { validateCollection } from '../src/data/schema.js';
import { SCHEMA_VERSION } from '../src/data/version.js';
import { newItemId } from '../src/data/ids.js';
import { NO_PROFILE } from '../src/data/ids.js';

const OPACO = /^[a-z]+_[A-Za-z0-9_-]{22}$/;

beforeEach(() => {
    installLocalStorageMock();
    storage.setActiveProfile(NO_PROFILE);
    storage.setActiveProfile('u_prueba');
});

/* ── El generador ────────────────────────────────────────────────────────── */

test('newItemId es opaco, único y NO deriva del nombre', () => {
    const vistos = new Set();
    for (let i = 0; i < 300; i++) {
        const id = newItemId('ex');
        assert.match(id, OPACO, `forma rara: ${id}`);
        assert.equal(vistos.has(id), false, `repetido en 300 tiradas: ${id}`);
        vistos.add(id);
    }
});

test('los tres pares que colisionaban ya no colisionan', () => {
    // El generador anterior usaba los doce primeros caracteres alfanuméricos del
    // nombre. Éstos son nombres que un usuario escribe de verdad.
    for (const [a, b] of [
        ['Press de banca con barra', 'Press de banca con mancuernas'],
        ['Curl de bíceps con barra', 'Curl de bíceps en polea'],
        ['Elevaciones laterales', 'Elevaciones frontales']
    ]) {
        // Cada uno en su propio almacén, que es lo que simula dos dispositivos.
        /** @type {string[]} */ const ids = [];
        for (const nombre of [a, b]) {
            installLocalStorageMock();
            storage.setActiveProfile('u_prueba');
            training.addExercise({ name: nombre, sets: 4, reps: 8 }, { dayName: 'D' });
            ids.push(training.exercisesOf(training.read().routine)[0].id);
        }
        assert.notEqual(ids[0], ids[1], `«${a}» y «${b}» siguen dando el mismo id`);
    }
});

test('las cuatro colecciones generan ids opacos', () => {
    training.addExercise({ name: 'Sentadilla', sets: 4, reps: 8 }, { dayName: 'Pierna' });
    recipes.addPantryItem({ name: 'Arroz', quantity: 1000, unit: 'g' });
    // `addRecipe` exige al menos un ingrediente (`recipes.ingredientsRequired`).
    recipes.addRecipe({
        name: 'Tortilla', servings: 2,
        ingredients: [{ name: 'Huevo', quantity: 4, unit: 'ud' }]
    });
    nutrition.addTemplate({ name: 'Desayuno', macros: { kcal: 500, proteinG: 30, carbsG: 50, fatG: 15 } });

    const ids = [
        training.exercisesOf(training.read().routine)[0]?.id,
        recipes.listPantry()[0]?.id,
        recipes.listRecipes()[0]?.id,
        nutrition.listTemplates()[0]?.id
    ];
    const nombres = ['Press de banca', 'Arroz', 'Tortilla', 'Desayuno'];
    for (const [i, id] of ids.entries()) {
        assert.ok(id, 'una colección no generó ningún id');
        assert.match(id, OPACO, `no es opaco: ${id}`);
        // El formato viejo era `<prefijo>_<n>_<slug>`, y el slug salía del
        // NOMBRE. Eso es lo que se comprueba: que el nombre no está dentro.
        //
        // Antes esto era `doesNotMatch(id, /_\d+_/)` y fallaba solo el 0,4 % de
        // las veces —medido: 745 de 200.000—, porque un id opaco puede empezar
        // por `3_` y entonces `pantry_3_FQZ9…` casa con el patrón del formato
        // viejo. Un id aleatorio y el formato viejo son AMBIGUOS por expresión
        // regular, así que anclarla tampoco arreglaba nada: había que afirmar la
        // propiedad, no su parecido.
        const slug = nombres[i].replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
        assert.ok(!id.includes(slug), `el id lleva dentro el nombre: ${id}`);
    }
    assert.equal(new Set(ids).size, 4, 'dos colecciones generaron el mismo id');

    // Y lo que de verdad arreglaron los ids opacos: dos nombres que compartían
    // los doce primeros caracteres daban el MISMO id, y las series de uno
    // acababan en el grupo muscular del otro.
    recipes.addPantryItem({ name: 'Press de banca con barra', quantity: 1, unit: 'ud' });
    recipes.addPantryItem({ name: 'Press de banca con mancuernas', quantity: 1, unit: 'ud' });
    const despensa = recipes.listPantry().map((/** @type {*} */ it) => it.id);
    assert.equal(new Set(despensa).size, despensa.length,
        'dos nombres parecidos volvieron a compartir id');
});

/* ── La migración de lo que ya existe ────────────────────────────────────── */

/** Un valor v7 de entrenamiento con dos ejercicios que colisionaban. */
const TRAINING_V7 = Object.freeze({
    schemaVersion: 7,
    routine: {
        days: [{
            name: 'Empuje',
            exercises: [
                { id: 'ex_1_Pressdeban', name: 'Press de banca con barra', sets: 4, reps: 8, loadKg: 60, catalogId: 'bench_press' },
                { id: 'ex_2_Pressdeban', name: 'Press de banca con mancuernas', sets: 3, reps: 10, loadKg: 24, catalogId: 'db_bench_press' }
            ]
        }]
    },
    sessions: [{
        id: 'se_2026-05-01', dateISO: '2026-05-01',
        entries: [
            { exerciseId: 'ex_1_Pressdeban', sets: [{ reps: 8, loadKg: 60 }] },
            { exerciseId: 'ex_2_Pressdeban', sets: [{ reps: 10, loadKg: 24 }] },
            // Una referencia a un ejercicio que ya no está en la rutina: el
            // usuario la borró y su historial la conserva.
            { exerciseId: 'ex_9_borrado', sets: [{ reps: 5, loadKg: 0 }] }
        ]
    }]
});

test('training: los ids cambian Y las sesiones siguen apuntando bien', () => {
    // Es la única transformación con una referencia interna, y la que de verdad
    // importa: una sesión que apunte a un id que ya no existe deja de contar
    // para el volumen semanal, en silencio.
    const r = migrateValue('training', TRAINING_V7);
    assert.ok(r.ok, !r.ok ? r.error : '');
    const v = /** @type {*} */ (r.value);

    const ejercicios = v.routine.days[0].exercises;
    assert.match(ejercicios[0].id, OPACO);
    assert.match(ejercicios[1].id, OPACO);
    assert.notEqual(ejercicios[0].id, ejercicios[1].id, 'los dos ejercicios siguen compartiendo id');

    const refs = v.sessions[0].entries.map((/** @type {*} */ e) => e.exerciseId);
    assert.equal(refs[0], ejercicios[0].id, 'la sesión perdió el enlace con su ejercicio');
    assert.equal(refs[1], ejercicios[1].id);

    // La referencia huérfana se deja TAL CUAL: inventarle un id nuevo la
    // desconectaría igual y encima borraría la pista de a qué apuntaba.
    assert.equal(refs[2], 'ex_9_borrado');

    assert.ok(validateCollection('training', v).ok, 'el resultado no valida');
});

test('training: el resto del ejercicio no se toca', () => {
    const v = /** @type {*} */ (migrateValue('training', TRAINING_V7).value);
    const ex = v.routine.days[0].exercises;
    assert.equal(ex[0].name, 'Press de banca con barra');
    assert.equal(ex[0].catalogId, 'bench_press');
    assert.equal(ex[1].loadKg, 24);
    assert.equal(v.routine.days[0].name, 'Empuje');
    assert.equal(v.sessions[0].dateISO, '2026-05-01');
    assert.deepEqual(v.sessions[0].entries[0].sets, [{ reps: 8, loadKg: 60 }]);
});

test('las otras tres colecciones cambian el id y conservan todo lo demás', () => {
    for (const [coleccion, campo, prefijo, item] of /** @type {Array<[string,string,string,*]>} */ ([
        ['pantry', 'items', 'pantry',
            { id: 'pantry_1_Arroz', name: 'Arroz', quantity: 1000, unit: 'g', foodId: 'usda_20450', expiresISO: '2026-12-01' }],
        ['recipes', 'items', 'recipe',
            { id: 'recipe_1_Tortilla', name: 'Tortilla', servings: 2, ingredients: [{ name: 'Huevo', quantity: 4, unit: 'ud', foodId: null }], notes: null }],
        ['nutrition', 'mealTemplates', 'meal',
            { id: 'meal_1_Desayuno', name: 'Desayuno', macros: { kcal: 520, proteinG: 35, carbsG: 55, fatG: 15 }, notes: 'con avena' }]
    ])) {
        const r = migrateValue(coleccion, { schemaVersion: 7, [campo]: [item] });
        assert.ok(r.ok, `${coleccion}: ${!r.ok && r.error}`);
        const salida = /** @type {*} */ (r.value)[campo][0];

        assert.notEqual(salida.id, item.id, `${coleccion}: el id no cambió`);
        assert.match(salida.id, new RegExp(`^${prefijo}_[A-Za-z0-9_-]{22}$`), `${coleccion}: ${salida.id}`);
        // Todo lo demás, intacto.
        for (const [k, valor] of Object.entries(item)) {
            if (k === 'id') continue;
            assert.deepEqual(salida[k], valor, `${coleccion}.${k} cambió`);
        }
        assert.ok(validateCollection(coleccion, r.value).ok, `${coleccion} no valida tras migrar`);
    }
});

test('una lista vacía o un valor raro no rompen la migración', () => {
    for (const v of [
        { schemaVersion: 7, items: [] },
        { schemaVersion: 7, items: [null] },
        { schemaVersion: 7 }                     // sin la lista siquiera
    ]) {
        assert.doesNotThrow(() => migrateValue('pantry', v));
    }
    const r = migrateValue('training', { schemaVersion: 7, routine: null, sessions: [] });
    assert.ok(r.ok);
    assert.equal(/** @type {*} */ (r.value).routine, null);
});

/* ── La referencia que vive fuera de su colección ────────────────────────── */

test('las series de Analizar parametrizadas por ejercicio se QUITAN, no se dejan colgando', () => {
    // `settings.analysis.seriesIds` guarda ids compuestos `est_e1rm__<exerciseId>`,
    // y ese id acaba de cambiar. Es la ÚNICA referencia a un id de item que vive
    // fuera de su colección, y `migrateValue` no puede resolverla: trabaja
    // colección a colección.
    //
    // Se quitan porque una serie seleccionada que ya no puede corresponder con
    // nada no falla — simplemente no aparece nunca. Quitarla cuesta un clic;
    // dejarla es una referencia muerta que nadie va a limpiar.
    const v7 = {
        schemaVersion: 7, locale: 'es', activeMeasures: ['waist'],
        fluctuationVisible: false, reminder: null, checkinDetailOpen: null,
        analysis: {
            seriesIds: ['peso', 'est_e1rm__ex_1_Pressdeban', 'grasa', 'est_e1rm__ex_2_Curl'],
            window: 'all', grain: 'week', normalize: 'raw'
        }
    };
    const r = migrateValue('settings', v7);
    assert.ok(r.ok, !r.ok ? r.error : '');
    const salida = /** @type {*} */ (r.value);
    assert.deepEqual(salida.analysis.seriesIds, ['peso', 'grasa'],
        'quedaron series apuntando a un ejercicio que ya no existe');
    // Y lo demás de `analysis` no se toca.
    assert.equal(salida.analysis.window, 'all');
    assert.equal(salida.analysis.grain, 'week');
    assert.equal(salida.locale, 'es');
    assert.ok(validateCollection('settings', salida).ok);
});

test('unos ajustes sin `analysis` pasan sin tocarse', () => {
    const v7 = {
        schemaVersion: 7, locale: 'en', activeMeasures: [],
        fluctuationVisible: true, reminder: { weekday: 1, hour: 8 },
        checkinDetailOpen: true, analysis: null
    };
    const r = migrateValue('settings', v7);
    assert.ok(r.ok);
    assert.equal(/** @type {*} */ (r.value).analysis, null);
    assert.deepEqual(/** @type {*} */ (r.value).reminder, { weekday: 1, hour: 8 });
});

/* ── El salto completo ───────────────────────────────────────────────────── */

test('un valor de la v5 llega a la v8 pasando por todos los escalones', () => {
    // `migrateValue` recorre `STEPS` desde la versión de origen: un hueco en la
    // cadena haría que un valor viejo se rechazara en vez de subir.
    const v5 = { schemaVersion: 5, items: [{ id: 'pantry_1_Arroz', name: 'Arroz', quantity: 500, unit: 'g', foodId: null, expiresISO: null }] };
    const r = migrateValue('pantry', v5);
    assert.ok(r.ok, !r.ok ? r.error : '');
    assert.equal(/** @type {*} */ (r.value).schemaVersion, SCHEMA_VERSION);
    assert.match(/** @type {*} */ (r.value).items[0].id, OPACO);
    assert.equal(/** @type {*} */ (r.value).items[0].name, 'Arroz');
});

test('un valor que YA es de la v8 no se vuelve a remapear', () => {
    // Sería un remapeo gratuito y destructivo: los ids ya eran opacos, y
    // cambiarlos otra vez rompería las referencias de las sesiones.
    const ya = /** @type {*} */ (migrateValue('training', TRAINING_V7).value);
    const idAntes = ya.routine.days[0].exercises[0].id;
    const otra = migrateValue('training', ya);
    assert.ok(otra.ok);
    assert.equal(/** @type {*} */ (otra.value).routine.days[0].exercises[0].id, idAntes,
        'un valor ya migrado volvió a cambiar de ids');
    assert.equal(otra.ok && otra.migrated, false);
});

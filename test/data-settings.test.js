// @ts-check

/**
 * Ajustes por perfil y compatibilidad hacia atrás del esquema (E13-0).
 *
 * El test que da nombre al fichero no es el de `settings`: es
 * `preferencias_antiguas_validan`. Un campo añadido sin `opt()` a una colección
 * ya poblada no rompe nada visible —los tests pasan, el typecheck pasa— y borra
 * datos del usuario en silencio la próxima vez que guarde. Esa clase de defecto
 * necesita un vigilante, no un comentario.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { readFileSync } from 'node:fs';
import { SCHEMA_VERSION, validateCollection } from '../src/data/schema.js';

test('preferencias_antiguas_validan: un registro anterior a V2-M10 no se cae', () => {
    // Exactamente lo que había en el almacén de quien completó el alta entre
    // V2-M3 y V2-M10: sin `activeModules`, porque ese campo no existía.
    const antiguo = {
        schemaVersion: SCHEMA_VERSION,
        hardExclusions: ['gluten', 'frutos secos'],
        softExclusions: ['brócoli'],
        dietType: 'vegan',
        mealsPerDay: 5,
        householdSize: 2,
        controlLevel: 'manual'
    };

    const parsed = validateCollection('preferences', antiguo);
    assert.equal(parsed.ok, true,
        'un registro sin `activeModules` debe validar: si no, `get()` degrada a vacío y el siguiente `save()` borra las alergias');
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value.hardExclusions, ['gluten', 'frutos secos'],
        'las exclusiones duras sobreviven íntegras');
    assert.equal(parsed.value.dietType, 'vegan');
});

test('los ajustes ya guardados sobreviven a la llegada de `analysis`', () => {
    const antiguo = {
        schemaVersion: SCHEMA_VERSION,
        locale: 'es',
        activeMeasures: ['waist'],
        fluctuationVisible: true,
        reminder: null
    };
    const parsed = validateCollection('settings', antiguo);
    assert.equal(parsed.ok, true, '`analysis` es `opt()`: su ausencia no tumba los ajustes');
});

test('la selección de series se acota: nueve no caben y los ids raros se caen', () => {
    const base = {
        schemaVersion: SCHEMA_VERSION,
        locale: 'es',
        activeMeasures: ['waist'],
        fluctuationVisible: false,
        reminder: null
    };
    const conAnalysis = (/** @type {*} */ analysis) =>
        validateCollection('settings', { ...base, analysis });

    assert.equal(conAnalysis({
        seriesIds: ['proj_weight', 'meas_waist'], window: 'all', grain: 'week', normalize: 'raw'
    }).ok, true, 'dos series válidas pasan');

    assert.equal(conAnalysis({
        seriesIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], window: 'all', grain: 'week', normalize: 'raw'
    }).ok, true, 'ocho series válidas pasan (tope subido en E13-9)');

    assert.equal(conAnalysis({
        seriesIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], window: 'all', grain: 'week', normalize: 'raw'
    }).ok, false, 'nueve series se rechazan: el tope de ocho es del esquema, no solo de la interfaz');

    // El punto y el espacio romperían el namespace de claves si algún día un id
    // acabara formando parte de una: `SAFE_ID` lo impide desde el esquema.
    assert.equal(conAnalysis({
        seriesIds: ['tl.5.p1.checkins'], window: 'all', grain: 'week', normalize: 'raw'
    }).ok, false, 'un id con puntos se rechaza');

    assert.equal(conAnalysis({
        seriesIds: [], window: 'todo', grain: 'week', normalize: 'raw'
    }).ok, false, 'una ventana inventada se rechaza');

    // 'custom' NO se persiste: son dos índices de día que solo significan algo
    // dentro de un plan concreto. Restaurarlos tras recalibrar señalaría un
    // tramo que ya no existe.
    assert.equal(conAnalysis({
        seriesIds: [], window: 'custom', grain: 'week', normalize: 'raw'
    }).ok, false, 'una ventana «custom» no se guarda');
});

test('todo ajuste guardado se vuelve a LEER: read() no puede olvidarse de un campo (E15-8)', () => {
    // `read()` reconstruye el objeto campo a campo. Eso está bien —solo salen
    // claves conocidas—, pero tiene un modo de fallo silencioso: un ajuste nuevo
    // añadido solo al validador se ESCRIBE y no se lee nunca. Pasó con
    // `checkinDetailOpen`, y el síntoma («la preferencia no se guarda») manda a
    // buscar el fallo justo al otro lado.
    //
    // Este test compara las dos listas: lo que el validador acepta y lo que
    // `read()` devuelve. No hace falta acordarse de nada la próxima vez.
    const source = readFileSync(new URL('../src/data/settings.js', import.meta.url), 'utf8');
    const schema = readFileSync(new URL('../src/data/schema.js', import.meta.url), 'utf8');

    const bloque = schema.match(/export const validateSettings = rootValidator\(\{([\s\S]*?)\n\}\);/);
    assert.ok(bloque, 'no encuentro validateSettings');
    const aceptados = [...bloque[1]
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
        .matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);

    assert.ok(aceptados.length >= 5, `solo ${aceptados.length} campos: ¿se rompió el extractor?`);

    const leidos = source.slice(source.indexOf('export function read()'));
    const olvidados = aceptados.filter((campo) => !leidos.includes(campo));
    assert.deepEqual(olvidados, [],
        `campos que el validador acepta y read() no devuelve: ${olvidados.join(', ')}`);
});

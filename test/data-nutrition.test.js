// @ts-check

/**
 * Plantillas de comida (M7-4).
 *
 * Como en entrenamiento, esta lógica vivía dentro de la vista y llevaba desde
 * M5 sin cobertura. Los macros del día NO se guardan —se derivan del plan en
 * `src/core/nutrition.js`, que sí tiene tests—; lo único persistido es esto.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import { rootPrefix, SCHEMA_VERSION } from '../src/data/version.js';
import * as nutrition from '../src/data/nutrition.js';

/** @type {import('./helpers/local-storage-mock.js').LocalStorageMock} */ let mock;

beforeEach(() => {
    mock = installLocalStorageMock();
    storage.setActiveProfile('p1');
});

const MACROS = { kcal: 500, proteinG: 40, carbsG: 50, fatG: 15 };

test('sin nada guardado la lista está vacía', () => {
    assert.deepEqual(nutrition.listTemplates(), []);
});

test('guarda una plantilla con sus macros', () => {
    assert.ok(nutrition.addTemplate({ name: 'Desayuno', macros: MACROS }).ok);
    const [tpl] = nutrition.listTemplates();
    assert.equal(tpl.name, 'Desayuno');
    assert.deepEqual(tpl.macros, MACROS);
    assert.equal(tpl.notes, null);
});

test('los ids no colisionan aunque se borre por medio', () => {
    // Mismo defecto que en entrenamiento: derivar el id de `length + 1`
    // reutiliza el índice tras un borrado, y entonces borrar una plantilla
    // borra las dos que comparten id.
    nutrition.addTemplate({ name: 'Comida', macros: MACROS });
    nutrition.addTemplate({ name: 'Comida', macros: MACROS });
    nutrition.removeTemplate(nutrition.listTemplates()[0].id);
    nutrition.addTemplate({ name: 'Comida', macros: MACROS });

    const ids = nutrition.listTemplates().map((/** @type {*} */ t) => t.id);
    assert.equal(new Set(ids).size, ids.length, `ids repetidos: ${ids.join(', ')}`);
});

test('el id nunca sale de [A-Za-z0-9_]', () => {
    nutrition.addTemplate({ name: 'Café "solo" <b>', macros: MACROS });
    assert.match(nutrition.listTemplates()[0].id, /^[A-Za-z0-9_]+$/);
});

test('un nombre vacío o solo espacios se rechaza', () => {
    for (const name of ['', '   ', '\n\t']) {
        const r = nutrition.addTemplate({ name, macros: MACROS });
        assert.equal(r.ok, false, `aceptó el nombre ${JSON.stringify(name)}`);
    }
    assert.deepEqual(nutrition.listTemplates(), []);
});

test('un macro imposible se satura en 0 en vez de guardarse', () => {
    // La vista ya lo hace en el formulario, pero el repositorio no puede
    // fiarse de su único llamante de hoy.
    const r = nutrition.addTemplate(/** @type {*} */ ({
        name: 'Raro', macros: { kcal: -100, proteinG: NaN, carbsG: 'mucho', fatG: undefined }
    }));
    assert.ok(r.ok);
    assert.deepEqual(nutrition.listTemplates()[0].macros, { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 });
});

test('el nombre se sanea antes de persistirse', () => {
    // El vector real es el import de un backup, pero la puerta se cierra aquí.
    nutrition.addTemplate({ name: '  Batido  ', macros: MACROS });
    assert.equal(nutrition.listTemplates()[0].name, 'Batido');
});

test('borrar quita solo la plantilla pedida', () => {
    nutrition.addTemplate({ name: 'Desayuno', macros: MACROS });
    nutrition.addTemplate({ name: 'Cena', macros: MACROS });
    const objetivo = nutrition.listTemplates()[0].id;

    assert.ok(nutrition.removeTemplate(objetivo).ok);
    const quedan = nutrition.listTemplates();
    assert.equal(quedan.length, 1);
    assert.equal(quedan[0].name, 'Cena');
});

test('borrar algo que no existe falla explícitamente', () => {
    const r = nutrition.removeTemplate('meal_99_fantasma');
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error, 'nutrition.notFound');
});

test('un almacén corrupto degrada a lista vacía', () => {
    mock.setItem(`${rootPrefix()}p1.nutrition`, `{"schemaVersion":${SCHEMA_VERSION},"mealTemplates":"no soy un array"}`);
    assert.deepEqual(nutrition.listTemplates(), []);
});

test('cada perfil tiene sus propias plantillas', () => {
    nutrition.addTemplate({ name: 'Desayuno', macros: MACROS });
    storage.setActiveProfile('p2');
    assert.deepEqual(nutrition.listTemplates(), [], 'se filtraron las plantillas del otro perfil');
    storage.setActiveProfile('p1');
    assert.equal(nutrition.listTemplates().length, 1);
});

// @ts-check

/**
 * Registro de ingesta (V2-M1). Hermano de `checkins.js`: un registro por día,
 * validación antes de escribir, y caché atada a `storage.revision()`.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import { SCHEMA_VERSION, rootPrefix } from '../src/data/version.js';
import * as intake from '../src/data/intake-log.js';

/** @type {import('./helpers/local-storage-mock.js').LocalStorageMock} */ let mock;

beforeEach(() => {
    mock = installLocalStorageMock();
    storage.setActiveProfile('p1');
});

test('sin nada guardado la lista está vacía', () => {
    assert.deepEqual(intake.list(), []);
});

test('guarda y devuelve ordenado por fecha', () => {
    intake.save({ dateISO: '2026-03-10', kcal: 2200 });
    intake.save({ dateISO: '2026-01-05', kcal: 2000 });
    intake.save({ dateISO: '2026-02-01', kcal: 2100 });
    assert.deepEqual(intake.list().map((/** @type {*} */ e) => e.dateISO),
        ['2026-01-05', '2026-02-01', '2026-03-10']);
});

test('dos registros del mismo día son una CORRECCIÓN, no dos comidas', () => {
    // Si se sumaran, la ingesta media saldría inflada y el gasto medido —que se
    // despeja de ella— saldría bajo. El error se propagaría al plan entero.
    intake.save({ dateISO: '2026-02-01', kcal: 900 });
    intake.save({ dateISO: '2026-02-01', kcal: 2400 });
    assert.equal(intake.list().length, 1);
    assert.equal(intake.findByDate('2026-02-01').kcal, 2400);
});

test('las kcal son obligatorias; los macros, opcionales', () => {
    assert.equal(intake.save(/** @type {*} */ ({ dateISO: '2026-02-01' })).ok, false);
    assert.equal(intake.save(/** @type {*} */ ({ dateISO: '2026-02-01', kcal: 'muchas' })).ok, false);
    assert.ok(intake.save({ dateISO: '2026-02-01', kcal: 2000 }).ok);
    assert.equal(intake.findByDate('2026-02-01').proteinG, null);
});

test('valores imposibles se saturan en vez de guardarse', () => {
    intake.save({ dateISO: '2026-02-01', kcal: -500, proteinG: NaN });
    const e = intake.findByDate('2026-02-01');
    assert.equal(e.kcal, 0);
    assert.equal(e.proteinG, null);
});

test('borrar quita solo ese día', () => {
    intake.save({ dateISO: '2026-02-01', kcal: 2000 });
    intake.save({ dateISO: '2026-02-02', kcal: 2100 });
    assert.ok(intake.remove('2026-02-01').ok);
    assert.equal(intake.list().length, 1);
    assert.equal(intake.remove('2026-12-31').ok, false);
});

test('la caché caduca con escrituras ajenas y no cruza perfiles', () => {
    intake.save({ dateISO: '2026-02-01', kcal: 2000 });
    assert.equal(intake.list().length, 1);

    storage.set('intakeLog', { schemaVersion: SCHEMA_VERSION, items: [] });   // como un import
    assert.deepEqual(intake.list(), [], 'la caché sobrevivió a una escritura ajena');

    intake.save({ dateISO: '2026-02-01', kcal: 2000 });
    storage.setActiveProfile('p2');
    assert.deepEqual(intake.list(), [], 'se filtró la ingesta del otro perfil');
    storage.setActiveProfile('p1');
    assert.equal(intake.list().length, 1);
});

test('un almacén corrupto degrada a vacío sin lanzar', () => {
    mock.setItem(`${rootPrefix()}p1.intakeLog`, '{"schemaVersion":6,"items":"no soy un array"}');
    assert.deepEqual(intake.list(), []);
});

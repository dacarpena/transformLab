// @ts-check

/**
 * Formateo de cifras compartido (M7-1).
 *
 * Este módulo nace de una divergencia que ya se veía en pantalla: `photos.js`
 * no tenía la rama de bytes que sí tenía `settings.js`, así que el mismo
 * fichero de 500 B se leía «0 KB» en una pantalla y «500 B» en otra. El test
 * de esa rama es, literalmente, la regresión.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, int, signed, bytes } from '../src/ui/format.js';

test('num fija los decimales y admite cambiarlos', () => {
    assert.equal(num(81.24), '81.2');
    assert.equal(num(81.26), '81.3');
    assert.equal(num(81.2432, 2), '81.24');
    assert.equal(num(0), '0.0');
    assert.equal(num(-1.55), '-1.6');
});

test('int redondea a entero: los gramos y las kcal no tienen decimales', () => {
    assert.equal(int(2426.4), '2426');
    assert.equal(int(2426.6), '2427');
    assert.equal(int(0), '0');
    // y NO es lo mismo que num(): confundirlas es lo que pasaba al copiar una
    // vista como plantilla, porque las dos se llamaban `num`
    assert.notEqual(int(2426.4), num(2426.4));
});

test('signed antepone el signo, que es lo que hace legible un delta', () => {
    assert.equal(signed(0.4), '+0.4');
    assert.equal(signed(-0.4), '-0.4');
    assert.equal(signed(0), '+0.0');
    assert.equal(signed(1.25, 2), '+1.25');
});

test('REGRESIÓN: por debajo de 1 KB se leen los bytes, no «0 KB»', () => {
    // El defecto que motivó el módulo, en una línea.
    assert.equal(bytes(500), '500 B');
    assert.equal(bytes(0), '0 B');
    assert.equal(bytes(1023), '1023 B');
});

test('bytes escala a KB y MB con la precisión de cada tramo', () => {
    assert.equal(bytes(1024), '1 KB');
    assert.equal(bytes(1024 * 512), '512 KB');
    assert.equal(bytes(1024 * 1024), '1.0 MB');
    assert.equal(bytes(1024 * 1024 * 2.5), '2.5 MB');
});

test('nada que no sea un número finito llega a la pantalla como «NaN»', () => {
    // El legacy imprimía «NaN» y «undefined» al usuario. El guion largo no es
    // decorativo: es lo que lo impide.
    for (const bad of [NaN, Infinity, -Infinity, null, undefined, 'x', {}, []]) {
        for (const fn of [num, int, signed, bytes]) {
            const out = fn(/** @type {*} */ (bad));
            assert.equal(out, '—', `${fn.name}(${String(bad)}) devolvió «${out}»`);
        }
    }
    // y un tamaño negativo tampoco es un tamaño
    assert.equal(bytes(-1), '—');
});

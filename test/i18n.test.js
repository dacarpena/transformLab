// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { es } from '../src/i18n/es.js';
import { en } from '../src/i18n/en.js';
import { t, setLocale, getLocale, availableLocales } from '../src/i18n/i18n.js';

test('paridad de claves entre es y en (CLAUDE.md §5: misma clave en ambos, mismo commit)', () => {
    const esKeys = Object.keys(es).sort();
    const enKeys = Object.keys(en).sort();
    assert.deepEqual(enKeys, esKeys, 'los diccionarios es/en deben tener exactamente las mismas claves');
});

test('ningún diccionario tiene valores vacíos', () => {
    for (const [name, dict] of [['es', es], ['en', en]]) {
        for (const [key, value] of Object.entries(dict)) {
            assert.ok(typeof value === 'string' && value.trim() !== '', `${name}.${key} está vacío`);
        }
    }
});

test('t() traduce en el idioma activo y cambia con setLocale', () => {
    setLocale('es');
    assert.equal(t('nav.today'), 'Hoy');
    setLocale('en');
    assert.equal(t('nav.today'), 'Today');
    setLocale('es');
});

test('t() interpola parámetros y deja intactos los placeholders sin dato', () => {
    setLocale('es');
    assert.equal(t('today.progress', { percent: 26 }), '26 % completado');
    assert.equal(t('today.progress'), '{percent} % completado');
});

test('la interpolación no ejecuta ni expande HTML: el valor va como texto', () => {
    setLocale('es');
    const out = t('today.progress', { percent: '<img src=x onerror=alert(1)>' });
    assert.equal(out, '<img src=x onerror=alert(1)> % completado');
    // El escapado ocurre en la capa de render (dom.js), no aquí: t() nunca genera HTML.
});

test('clave ausente devuelve la propia clave sin lanzar', () => {
    setLocale('es');
    assert.equal(t('no.existe'), 'no.existe');
});

test('setLocale rechaza idiomas no soportados manteniendo el activo', () => {
    setLocale('es');
    assert.equal(setLocale('fr'), false);
    assert.equal(getLocale(), 'es');
});

test('availableLocales expone es y en', () => {
    assert.deepEqual(availableLocales().sort(), ['en', 'es']);
});

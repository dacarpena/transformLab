// @ts-check

/**
 * El manifiesto de vistas y el candado del service worker (M7-3).
 *
 * Estos tests existen para que añadir una vista cueste UN sitio. Antes costaba
 * siete —registro en `main.js`, `PRECACHE`, `CACHE_VERSION`, y tres listas de
 * test— y ninguno avisaba si olvidabas los otros: la vista no aparecía en la
 * navegación, o aparecía pero no abría sin red, o abría pero nadie comprobaba
 * su accesibilidad. Cada uno de los tests de aquí cierra uno de esos olvidos.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { VIEWS, VIEW_IDS } from '../src/ui/views/_manifest.js';
import { precacheList, precacheHash, cacheVersionOf, readLock } from '../tools/sw-version.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (/** @type {string} */ p) => readFileSync(join(ROOT, p), 'utf8');

/**
 * Vistas que existen como fichero pero NO se registran en el router, con el
 * motivo. Si mañana hay otra, se anota aquí a propósito; lo que no puede pasar
 * es que una vista quede fuera sin que nadie lo note.
 */
const FUERA_DEL_ROUTER = {
    'onboarding.js': 'flujo previo al router: se monta desde main.js antes de que exista navegación',
    '_manifest.js': 'es este manifiesto, no una vista'
};

test('toda vista de la carpeta está en el manifiesto, o justificada fuera', () => {
    const ficheros = readdirSync(join(ROOT, 'src/ui/views')).filter((f) => f.endsWith('.js'));
    const enManifiesto = new Set(VIEWS.map((v) => v.path.split('/').pop()));
    const huerfanas = ficheros.filter((f) => !enManifiesto.has(f) && !(f in FUERA_DEL_ROUTER));
    assert.deepEqual(huerfanas, [],
        `vistas sin registrar y sin justificar en FUERA_DEL_ROUTER: ${huerfanas.join(', ')}`);
});

test('cada entrada apunta a un fichero que existe y su `load` lo importa', () => {
    for (const view of VIEWS) {
        assert.doesNotThrow(() => read(view.path), `${view.id}: ${view.path} no existe`);
        if (!view.load) continue;
        // El `path` (que consume el precache) y el especificador del `load`
        // (que consume el navegador) son dos escrituras de la misma ruta y
        // pueden separarse en silencio. Se comparan por el fuente del thunk.
        const basename = view.path.split('/').pop();
        assert.match(String(view.load), new RegExp(`\\./${basename?.replace('.', '\\.')}`),
            `${view.id}: \`load\` y \`path\` apuntan a ficheros distintos`);
    }
});

test('main.js registra desde el manifiesto, sin lista propia', () => {
    const source = read('src/main.js');
    assert.match(source, /from '\.\/ui\/views\/_manifest\.js'/, 'main.js no lee el manifiesto');
    // Una `id:` literal suelta en main.js sería una vista registrada a mano,
    // invisible para el manifiesto y para todo lo que bebe de él.
    const sueltas = [...source.matchAll(/router\.register\(\{\s*id:\s*'([^']+)'/g)]
        .map((m) => m[1])
        .filter((id) => !(`${id}.js` in FUERA_DEL_ROUTER));
    assert.deepEqual(sueltas, [], `vistas registradas a mano en main.js: ${sueltas.join(', ')}`);
});

test('los rótulos de navegación existen en los dos diccionarios', async () => {
    const { es } = await import('../src/i18n/es.js');
    const { en } = await import('../src/i18n/en.js');
    for (const view of VIEWS) {
        for (const [nombre, dict] of /** @type {Array<[string, *]>} */ ([['es', es], ['en', en]])) {
            assert.equal(typeof dict[view.labelKey], 'string',
                `falta ${view.labelKey} en ${nombre}.js (vista ${view.id})`);
        }
    }
});

test('los ids son únicos y solo cuatro vistas son primarias', () => {
    assert.equal(new Set(VIEW_IDS).size, VIEW_IDS.length, 'hay ids repetidos');
    const primarias = VIEWS.filter((v) => v.primary).map((v) => v.id);
    // Cuatro y no cinco: a 320 px la quinta deja los objetivos táctiles por
    // debajo de 44 px. Si esto cambia, es una decisión de diseño, no un
    // descuido — y este test obliga a tomarla a propósito.
    assert.equal(primarias.length, 4, `pestañas primarias: ${primarias.join(', ')}`);
    assert.equal(VIEWS[0].id, 'today', 'la primera vista debe ser la del arranque');
});

test('todas las vistas del manifiesto están en PRECACHE', () => {
    const cached = new Set(precacheList());
    const fuera = VIEWS.map((v) => v.path).filter((p) => !cached.has(p));
    assert.deepEqual(fuera, [], `vistas que no abrirían sin red: ${fuera.join(', ')}`);
});

test('CACHE_VERSION sube cuando cambia lo precacheado', () => {
    // El fallo que esto impide: `sw.js` sirve lo precacheado primero y sin
    // revalidar. Cambiar un fichero sin subir la versión deja a quien ya tenga
    // la app instalada ejecutando el módulo viejo para siempre, junto a los
    // nuevos que sí pidió de red — mitad de la aplicación en cada versión.
    // La regla estaba escrita en `sw.js:19` y nada la imponía.
    const lock = readLock();
    assert.ok(lock, 'falta sw.lock.json; ejecuta `npm run sw:bump`');
    const hash = precacheHash();
    if (lock.precacheHash === hash) return;   // nada precacheado ha cambiado
    assert.notEqual(lock.cacheVersion, cacheVersionOf(),
        'lo precacheado cambió y CACHE_VERSION sigue igual: ejecuta `npm run sw:bump` ' +
        'antes de desplegar, o los usuarios instalados se quedarán con módulos viejos');
});

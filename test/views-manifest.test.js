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
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { VIEWS, VIEW_IDS, EAGER_VIEW_ID } from '../src/ui/views/_manifest.js';
import { precacheList, precacheHash, cacheVersionOf, readLock } from '../tools/sw-version.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
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

test('solo la vista del arranque puede no tener `load`', () => {
    // El ataque adversarial de M7 registró una vista con `load: null` y salió
    // en la navegación pintando HOY, con los 445 tests en verde: la pestaña
    // existía, era navegable, y era la vista equivocada. Es exactamente el
    // olvido silencioso que el manifiesto se escribió para eliminar.
    const sinLoad = VIEWS.filter((v) => !v.load).map((v) => v.id);
    assert.deepEqual(sinLoad, [EAGER_VIEW_ID],
        `vistas sin \`load\` que no son la del arranque: ${sinLoad.join(', ')}`);
    assert.ok(VIEWS.some((v) => v.id === EAGER_VIEW_ID), 'EAGER_VIEW_ID no está en el manifiesto');
});

test('todo cableado de main.js corresponde a una vista que existe', () => {
    // `wiringFor()` se consume como `wiring[view.id]`. Renombrar un id dejaba
    // el cableado huérfano SIN error: el botón «ir a check-in» de Progreso se
    // convertía en un no-op mudo, y con `checkin` guardar dejaba de refrescar
    // la aplicación. Reproducido en el ataque de M7, typecheck y tests en verde.
    const source = read('src/main.js');
    const cuerpo = source.slice(source.indexOf('function wiringFor'));
    const claves = [...cuerpo.slice(0, cuerpo.indexOf('\n}')).matchAll(/^\s{8}(\w+):/gm)]
        .map((m) => m[1]);
    assert.ok(claves.length > 0, 'no se pudo leer el cableado de wiringFor');
    const huerfanas = claves.filter((k) => !VIEW_IDS.includes(k));
    assert.deepEqual(huerfanas, [], `cableado sin vista: ${huerfanas.join(', ')}`);

    // Y lo mismo con los destinos de navegación escritos a mano.
    const destinos = [...source.matchAll(/router\.navigate\('([^']+)'\)|navigate\('([^']+)'\)/g)]
        .map((m) => m[1] ?? m[2])
        .filter((id) => id !== 'onboarding');
    const inexistentes = [...new Set(destinos)].filter((id) => !VIEW_IDS.includes(id));
    assert.deepEqual(inexistentes, [], `navigate() a vistas que no existen: ${inexistentes.join(', ')}`);
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
    //
    // LA COMPARACIÓN ES CONTRA EL HASH, NO CONTRA LA VERSIÓN. La primera
    // versión de este test pedía `lock.cacheVersion !== CACHE_VERSION`, y el
    // ataque adversarial de M7 demostró que eso se muere: en cuanto alguien
    // sube la versión A MANO —que es justo lo que ordena `sw.js:19`— los dos
    // valores quedan separados para siempre y la condición se cumple sola.
    // Reproducido: dos módulos del arranque cambiados y el test en verde.
    //
    // Exigiendo que el hash del candado coincida con el del árbol, el único
    // camino para ponerlo en verde es `npm run sw:bump`, que sube la versión
    // y sella el hash a la vez. No hay forma de contentar al test sin invalidar
    // el caché de verdad.
    const lock = readLock();
    assert.ok(lock, 'falta sw.lock.json; ejecuta `npm run sw:bump`');
    assert.equal(lock.precacheHash, precacheHash(),
        'lo precacheado cambió: ejecuta `npm run sw:bump` antes de desplegar, o ' +
        'los usuarios instalados se quedarán con módulos viejos');
    assert.equal(lock.cacheVersion, cacheVersionOf(),
        'sw.lock.json y sw.js discrepan en la versión; ejecuta `npm run sw:bump`');
});

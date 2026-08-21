// @ts-check

/**
 * Cuándo se sincroniza (M9-4b).
 *
 * `sync.js` sabe cómo; esto decide cuándo, y las decisiones de cuándo son las
 * que se rompen sin que nadie se entere: un bucle que reintenta cada cinco
 * segundos contra un servidor caído funciona igual de bien en un test que en
 * producción, y solo se nota en la factura.
 *
 * Se prueba con relojes falsos y un `sync.sync` sustituido, porque lo que se
 * mide aquí es **cuántas veces se llama y cuándo**, no qué hace la llamada.
 *
 * | Invariante | Lo que evita |
 * |---|---|
 * | `espera_antes_de_subir` | diez sincronías por cada check-in tecleado |
 * | `no_se_solapa` | dos pulls a la vez escribiendo las mismas filas |
 * | `retrocede_al_fallar` | martillear un servidor caído cada cinco segundos |
 * | `parada_dura` | que un almacén vaciado borre los datos en todos los dispositivos |
 * | `oculta_no_gasta` | que un móvil en segundo plano siga hablando por radio |
 */

import test, { beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import * as loop from '../src/ui/sync-loop.js';
import { NO_PROFILE } from '../src/data/ids.js';

const USER = 'u_ana';

/** Lo que devolverá la próxima sincronía. */
/** @type {*} */ let respuesta;
/** @type {number} */ let llamadas;
/** @type {*} */ let pasada;
/** @type {*} */ let originalDocument;
/** @type {*} */ let originalNavigator;
/** @type {*} */ let visibilidad;

const bien = () => ({
    ok: true,
    pull: { ok: true, fetched: 0, applied: 0, removed: 0, merged: 0, kept: 0, adopted: 0, undecryptable: 0, cursor: 0, hasMore: false },
    push: { ok: true, pushed: 0, tombstones: 0, conflicts: 0, unreadable: 0 }
});

const mal = (/** @type {string} */ error, /** @type {*} */ push = null) => ({
    ok: false, error,
    pull: { ok: true, fetched: 0, applied: 0, removed: 0, merged: 0, kept: 0, adopted: 0, undecryptable: 0, cursor: 0, hasMore: false },
    push: push ?? { ok: false, error, pushed: 0, tombstones: 0, conflicts: 0, unreadable: 0 }
});

beforeEach(() => {
    installLocalStorageMock();
    storage.setActiveProfile(NO_PROFILE);
    llamadas = 0;
    respuesta = bien();

    // La pasada se INYECTA. Un espacio de nombres de módulo está congelado, así
    // que sustituir `sync.sync` no es posible; y no hace falta, porque lo que
    // este módulo programa es un argumento suyo.
    pasada = async () => {
        llamadas += 1;
        return typeof respuesta === 'function' ? respuesta() : respuesta;
    };

    originalDocument = /** @type {*} */ (globalThis).document;
    originalNavigator = /** @type {*} */ (globalThis).navigator;
    visibilidad = { estado: 'visible', oyentes: /** @type {*[]} */ ([]) };
    /** @type {*} */ (globalThis).document = {
        get visibilityState() { return visibilidad.estado; },
        addEventListener: (/** @type {string} */ tipo, /** @type {*} */ fn) => visibilidad.oyentes.push({ tipo, fn }),
        removeEventListener: (/** @type {string} */ tipo, /** @type {*} */ fn) => {
            visibilidad.oyentes = visibilidad.oyentes.filter((o) => !(o.tipo === tipo && o.fn === fn));
        }
    };
    ponerRed(true);

    mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'] });
});

afterEach(() => {
    mock.timers.reset();
    loop.resetForTests();
    /** @type {*} */ (globalThis).document = originalDocument;
    if (originalNavigator === undefined) delete /** @type {*} */ (globalThis).navigator;
    else Object.defineProperty(globalThis, 'navigator', { configurable: true, value: originalNavigator });
});

/**
 * `globalThis.navigator` en Node solo tiene captador, así que asignarlo lanza.
 * @param {boolean} online
 */
function ponerRed(online) {
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true, value: { onLine: online }
    });
}

/**
 * Adelanta el reloj falso y deja correr las promesas que disparen los timers.
 *
 * En rodajas de un segundo, y no de un salto: `mock.timers.tick()` ejecuta la
 * cola que había al empezar, así que un temporizador **programado durante el
 * salto no se ejecuta en ese mismo salto**. Este bucle programa su espera desde
 * dentro de un intervalo, que es exactamente ese caso; con un solo `tick`
 * gigante los tests medirían un bucle que no existe.
 *
 * @param {number} ms
 */
async function avanzar(ms) {
    for (let restante = ms; restante > 0; restante -= 1_000) {
        mock.timers.tick(Math.min(1_000, restante));
        // `ejecutar` es async y encadena; sin vaciar microtareas, el contador de
        // llamadas se leería antes de que la pasada haya empezado.
        for (let i = 0; i < 4; i++) await Promise.resolve();
    }
    if (ms === 0) {
        mock.timers.tick(0);
        for (let i = 0; i < 4; i++) await Promise.resolve();
    }
}

const ocultar = async (estado) => {
    visibilidad.estado = estado;
    for (const o of visibilidad.oyentes) if (o.tipo === 'visibilitychange') o.fn();
    await Promise.resolve();
};

/* ── Arrancar ────────────────────────────────────────────────────────────── */

test('arrancar sincroniza una vez, y no más hasta que pase algo', async () => {
    loop.start(USER, { run: pasada });
    await avanzar(0);
    assert.equal(llamadas, 1, 'no sincronizó al arrancar');
    assert.equal(loop.status().state, 'idle');

    // Treinta segundos sin cambios locales: nada. El pull de cortesía es cada
    // minuto, no cada latido.
    await avanzar(30_000);
    assert.equal(llamadas, 1);
});

test('arrancar dos veces con el mismo usuario no monta dos bucles', async () => {
    loop.start(USER, { run: pasada });
    await avanzar(0);
    loop.start(USER, { run: pasada });
    await avanzar(0);
    assert.equal(llamadas, 1);
});

test('sin arrancar, nada sincroniza', async () => {
    await avanzar(120_000);
    assert.equal(llamadas, 0);
    assert.equal(loop.status().state, 'off');
});

/* ── La espera ───────────────────────────────────────────────────────────── */

test('espera_antes_de_subir: diez escrituras seguidas son UNA sincronía', async () => {
    loop.start(USER, { run: pasada });
    await avanzar(0);
    llamadas = 0;

    for (let i = 0; i < 10; i++) {
        storage.setRaw(`tl.prueba.${i}`, String(i));
        await avanzar(3_000);
    }
    // Han pasado 30 s de escrituras. La espera se reinicia con cada latido que
    // ve cambios, así que todavía no debería haber subido más de una vez.
    assert.ok(llamadas <= 1, `subió ${llamadas} veces mientras se escribía`);

    await avanzar(10_000);
    assert.equal(llamadas, 1, 'al parar de escribir, sube exactamente una vez');
});

test('el botón se salta la espera', async () => {
    loop.start(USER, { run: pasada });
    await avanzar(0);
    llamadas = 0;

    storage.setRaw('tl.prueba', '1');
    await avanzar(0);
    await loop.syncNow();
    assert.equal(llamadas, 1, 'el botón no sincronizó al momento');
});

test('no_se_solapa: una sincronía en curso no lanza otra', async () => {
    /** @type {*} */ let soltar;
    pasada = () => { llamadas += 1; return new Promise((r) => { soltar = () => r(bien()); }); };

    loop.start(USER, { run: pasada });
    await avanzar(0);
    assert.equal(llamadas, 1);

    // Mientras la primera sigue en vuelo, se escribe y se pulsa el botón.
    storage.setRaw('tl.prueba', '1');
    await avanzar(10_000);
    await loop.syncNow();
    assert.equal(llamadas, 1, 'se lanzó una segunda sincronía sobre la primera');

    soltar();
    await avanzar(0);
});

/* ── Fallar ──────────────────────────────────────────────────────────────── */

test('retrocede_al_fallar: no se reintenta cada cinco segundos', async () => {
    respuesta = mal('api.offline');
    loop.start(USER, { run: pasada });
    await avanzar(0);
    assert.equal(llamadas, 1);
    assert.equal(loop.status().state, 'error');

    // Hay cambios locales, así que sin retroceso el latido pediría uno cada
    // cinco segundos. Con retroceso, el primer reintento no llega hasta los 30.
    storage.setRaw('tl.prueba', '1');
    await avanzar(20_000);
    assert.equal(llamadas, 1, 'reintentó antes de tiempo');

    await avanzar(15_000);
    assert.equal(llamadas, 2, 'no reintentó nunca');
});

test('la espera se DOBLA con cada fallo, y se reinicia al acertar', async () => {
    respuesta = mal('api.offline');
    loop.start(USER, { run: pasada });
    await avanzar(0);
    storage.setRaw('tl.prueba', '1');

    await avanzar(35_000);
    assert.equal(llamadas, 2, 'segundo intento a los 30 s');

    // El siguiente ya no es a los 30, es a los 60.
    await avanzar(35_000);
    assert.equal(llamadas, 2, 'la espera no se dobló');
    await avanzar(30_000);
    assert.equal(llamadas, 3);

    // Y al acertar, el retroceso se reinicia: la siguiente vuelve a salir en
    // cinco segundos, no en dos minutos.
    respuesta = bien();
    await avanzar(130_000);
    const tras = llamadas;
    assert.equal(tras, 4, 'no llegó a hacerse la sincronía buena');

    storage.setRaw('tl.prueba', '2');
    await avanzar(10_000);
    assert.equal(llamadas, tras + 1, 'el retroceso no se reinició tras una sincronía buena');
});

test('el botón se salta el retroceso: quien lo pulsa ya sabe que falló', async () => {
    respuesta = mal('api.offline');
    loop.start(USER, { run: pasada });
    await avanzar(0);
    assert.equal(llamadas, 1);

    await loop.syncNow();
    assert.equal(llamadas, 2);
});

/* ── La parada dura ──────────────────────────────────────────────────────── */

test('parada_dura: un borrado masivo detiene el bucle y NO se reintenta solo', async () => {
    respuesta = mal('sync.massDelete', {
        ok: false, error: 'sync.massDelete', pushed: 0, tombstones: 42, conflicts: 0, unreadable: 0
    });
    loop.start(USER, { run: pasada });
    await avanzar(0);
    assert.equal(loop.status().state, 'blocked');
    assert.equal(loop.status().last?.tombstones, 42, 'no dice cuántas iba a borrar');

    // Ni el tiempo ni las escrituras ni el botón lo levantan.
    storage.setRaw('tl.prueba', '1');
    await avanzar(600_000);
    await loop.syncNow();
    assert.equal(llamadas, 1, 'siguió sincronizando pese a la parada');
    assert.equal(loop.status().state, 'blocked');
});

test('confirmándolo, y solo así, el bucle vuelve a andar', async () => {
    respuesta = mal('sync.massDelete', {
        ok: false, error: 'sync.massDelete', pushed: 0, tombstones: 42, conflicts: 0, unreadable: 0
    });
    loop.start(USER, { run: pasada });
    await avanzar(0);

    respuesta = bien();
    await loop.syncNow({ allowMassDelete: true });
    assert.equal(llamadas, 2);
    assert.equal(loop.status().state, 'idle');
});

/* ── La pestaña y la red ─────────────────────────────────────────────────── */

test('oculta_no_gasta: con la pestaña escondida no se sincroniza', async () => {
    loop.start(USER, { run: pasada });
    await avanzar(0);
    llamadas = 0;

    await ocultar('hidden');
    storage.setRaw('tl.prueba', '1');
    await avanzar(300_000);
    assert.equal(llamadas, 0, 'sincronizó con la pestaña en segundo plano');

    // Y al volver, lo primero que hace es mirar.
    await ocultar('visible');
    await avanzar(0);
    assert.ok(llamadas >= 1, 'volver a la pestaña no disparó una sincronía');
});

test('sin red no se intenta, y al volver sí', async () => {
    loop.start(USER, { run: pasada });
    await avanzar(0);
    llamadas = 0;

    ponerRed(false);
    storage.setRaw('tl.prueba', '1');
    await avanzar(60_000);
    assert.equal(llamadas, 0);
    assert.equal(loop.status().state, 'offline');

    ponerRed(true);
    await avanzar(10_000);
    assert.equal(llamadas, 1, 'al volver la red no se sincronizó');
});

/* ── Parar ───────────────────────────────────────────────────────────────── */

test('parar deja el bucle mudo, aunque siga habiendo cambios', async () => {
    loop.start(USER, { run: pasada });
    await avanzar(0);
    loop.stop();
    llamadas = 0;

    storage.setRaw('tl.prueba', '1');
    await avanzar(300_000);
    assert.equal(llamadas, 0, 'siguió sincronizando tras cerrar sesión');
    assert.equal(loop.status().state, 'off');
});

test('una sincronía buena no se dispara a sí misma', async () => {
    // El pull escribe en el almacén, y esas escrituras suben el mismo contador
    // que las del usuario. Si la revisión se tomara al EMPEZAR, cada sincronía
    // que trajera algo provocaría la siguiente, en bucle y para siempre.
    respuesta = () => {
        storage.setRaw(`tl.venido.${llamadas}`, 'del servidor');
        return bien();
    };
    loop.start(USER, { run: pasada });
    await avanzar(0);
    assert.equal(llamadas, 1);

    await avanzar(45_000);
    assert.equal(llamadas, 1, 'la sincronía se disparó a sí misma');
});

test('adoptedTotal es un ACUMULADOR: quien lo escucha puede avisar UNA vez', async () => {
    // El fallo que esto impide es un bucle infinito, y costó encontrarlo. El
    // panel repinta la aplicación entera cuando aparece un perfil nuevo;
    // repintar escribe en el almacén; el almacén marca cambios; el bucle vuelve
    // a sincronizar. Mirando el último informe —que conserva su `adopted`— se
    // avisaba en CADA cambio de estado y la rueda no paraba.
    respuesta = () => ({
        ok: true,
        pull: { ok: true, applied: 1, removed: 0, merged: 0, kept: 0, adopted: 1 },
        push: { ok: true, pushed: 0, tombstones: 0, conflicts: 0 }
    });
    loop.start(USER, { run: pasada });
    await avanzar(0);
    assert.equal(loop.status().adoptedTotal, 1);

    // Cambiar de estado no lo mueve: solo lo mueve una sincronía que adopte.
    storage.setRaw('tl.prueba', '1');
    await avanzar(4_000);
    assert.equal(loop.status().state, 'pending');
    assert.equal(loop.status().adoptedTotal, 1, 'el acumulador se movió sin adoptar nada');

    respuesta = bien();
    await avanzar(15_000);
    assert.equal(loop.status().state, 'idle');
    assert.equal(loop.status().adoptedTotal, 1);
});

test('repintar tras adoptar no vuelve a disparar el bucle', async () => {
    // La otra mitad del mismo fallo, con el oyente montado EXACTAMENTE como lo
    // monta el panel: solo actúa cuando el acumulador sube. Y la revisión se
    // toma después de avisar, porque quien escucha escribe al repintar.
    let atendidas = 0;
    let repintados = 0;
    loop.onChange(() => {
        const total = loop.status().adoptedTotal;
        if (total <= atendidas) return;
        atendidas = total;
        repintados += 1;
        // Esto es lo que hace el panel: repintar la aplicación, que escribe.
        storage.setRaw('tl.repintado', String(repintados));
    });

    respuesta = () => ({
        ok: true,
        pull: { ok: true, applied: 1, removed: 0, merged: 0, kept: 0, adopted: llamadas === 1 ? 1 : 0 },
        push: { ok: true, pushed: 0, tombstones: 0, conflicts: 0 }
    });
    loop.start(USER, { run: pasada });
    await avanzar(0);
    assert.equal(repintados, 1, 'no avisó de la adopción');

    // Y no vuelve a avisar ni a sincronizar: ni por el repintado, ni por los
    // cambios de estado que vienen después.
    await avanzar(50_000);
    assert.equal(repintados, 1, 'avisó más de una vez de la misma adopción');
    assert.equal(llamadas, 1, 'las escrituras del repintado dispararon otra sincronía');
});

test('el estado que se enseña nombra una clave de i18n que existe', async () => {
    // El panel pinta `account.sync.state.<estado>`; un estado sin texto es una
    // pantalla muda. Se comprueba contra el diccionario de verdad.
    const { es } = await import('../src/i18n/es.js');
    for (const estado of ['off', 'idle', 'syncing', 'pending', 'offline', 'error', 'blocked']) {
        assert.ok(`account.sync.state.${estado}` in es,
            `el estado «${estado}» no tiene texto en es.js`);
    }
});

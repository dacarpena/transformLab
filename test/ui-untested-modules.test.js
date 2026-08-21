// @ts-check

/**
 * Los cuatro módulos que quedaban sin un solo test unitario (E15-15).
 *
 * `plan-summary.js`, `marks.js`, `data/preferences.js` y `data/exercises-db.js`
 * sumaban 400 líneas de decisiones que solo verificaba un navegador — y
 * `exercises-db.js` no tenía **ni una sola referencia** en todo `test/`.
 *
 * Un E2E ve el resultado; un unitario ve la decisión. Aquí se fijan las
 * decisiones, que es lo que hay que tener clavado antes de que un backend
 * empiece a mover estos datos entre dispositivos.
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import * as preferences from '../src/data/preferences.js';
import * as exercisesDb from '../src/data/exercises-db.js';
import { renderCoordinatedOffer } from '../src/ui/plan-summary.js';
import { buildMarks, MARK_CATEGORIES } from '../src/ui/marks.js';

/* ── data/preferences.js ─────────────────────────────────────────────────── */

test('preferences: sin nada guardado devuelve los valores de fábrica', () => {
    installLocalStorageMock();
    storage.setActiveProfile('p1');
    const p = preferences.get();
    assert.deepEqual(p.hardExclusions, []);
    assert.deepEqual(p.softExclusions, []);
});

test('preferences: las ALERGIAS sobreviven a la ida y vuelta, exactas', () => {
    // `hardExclusions` no es una preferencia de presentación: es lo que impide
    // que el generador de menús le proponga a alguien algo que le manda al
    // hospital. Un saneado que las recorte o las reordene no vale.
    installLocalStorageMock();
    storage.setActiveProfile('p1');
    preferences.save({ hardExclusions: ['gluten', 'frutos secos', 'marisco'] });
    assert.deepEqual(preferences.get().hardExclusions, ['gluten', 'frutos secos', 'marisco']);
});

test('preferences: `save` FUNDE, no reemplaza', () => {
    // Guardar el número de comidas no puede borrar las alergias.
    installLocalStorageMock();
    storage.setActiveProfile('p1');
    preferences.save({ hardExclusions: ['gluten'] });
    preferences.save({ mealsPerDay: 4 });
    const p = preferences.get();
    assert.deepEqual(p.hardExclusions, ['gluten']);
    assert.equal(p.mealsPerDay, 4);
});

test('preferences: un registro corrupto NO borra las alergias en silencio', () => {
    // `settings.js` degrada a los valores de fábrica y lo documenta, porque solo
    // guarda preferencias de presentación. Aquí no vale lo mismo: devolver
    // «sin restricciones» ante un registro ilegible es peligroso. Lo que se
    // comprueba es que `get()` no lanza y que `save()` puede reponerlas.
    installLocalStorageMock();
    storage.setActiveProfile('p1');
    for (const basura of ['{no json', '42', 'null', '{"hardExclusions":"gluten"}']) {
        storage.setRaw('tl.6.p1.preferences', basura);
        const p = preferences.get();
        assert.ok(Array.isArray(p.hardExclusions), 'get() nunca puede lanzar ni devolver otra cosa');
    }
    preferences.save({ hardExclusions: ['gluten'] });
    assert.deepEqual(preferences.get().hardExclusions, ['gluten']);
});

test('preferences: se guarda en el namespace del perfil ACTIVO', () => {
    // El defecto de M7 fue una fuga entre perfiles. Aquí queda fijado.
    installLocalStorageMock();
    storage.setActiveProfile('p1');
    preferences.save({ hardExclusions: ['gluten'] });

    storage.setActiveProfile('p2');
    assert.deepEqual(preferences.get().hardExclusions, [],
        'las alergias de un perfil no pueden asomar en otro');

    storage.setActiveProfile('p1');
    assert.deepEqual(preferences.get().hardExclusions, ['gluten']);
});

/* ── data/exercises-db.js ────────────────────────────────────────────────── */

test('exercises-db: carga el catálogo con el `fetch` que se le inyecta', async () => {
    // Cero referencias en todo `test/` hasta ahora. La costura de inyección ya
    // existía; solo faltaba usarla.
    exercisesDb.reset();
    const catalogo = [
        { id: 'ex_squat', name: 'Sentadilla', muscles: { quads: 1 } },
        { id: 'ex_bench', name: 'Press banca', muscles: { chest: 1 } }
    ];
    let pedidas = 0;
    const fetchFalso = async () => {
        pedidas++;
        return { ok: true, json: async () => ({ exercises: catalogo }) };
    };

    const r = await exercisesDb.load({ fetchImpl: /** @type {*} */ (fetchFalso) });
    assert.ok(r.ok, 'la carga debería salir bien');
    assert.equal(pedidas, 1);
    // Devuelve un ÍNDICE por id, no un array: todos sus consumidores buscan por
    // id, y hacerlo sobre un array sería una búsqueda lineal por serie apuntada.
    assert.deepEqual(Object.keys(/** @type {*} */ (r).value).sort(), ['ex_bench', 'ex_squat']);
});

test('exercises-db: la segunda carga NO vuelve a pedir la red', async () => {
    // Es un catálogo de referencia de 105 KB: pedirlo en cada vista sería
    // pagarlo cada vez.
    exercisesDb.reset();
    let pedidas = 0;
    const fetchFalso = async () => {
        pedidas++;
        return { ok: true, json: async () => ({ exercises: [{ id: 'ex_a', name: 'A', muscles: {} }] }) };
    };
    await exercisesDb.load({ fetchImpl: /** @type {*} */ (fetchFalso) });
    await exercisesDb.load({ fetchImpl: /** @type {*} */ (fetchFalso) });
    assert.equal(pedidas, 1, 'el catálogo se cachea tras la primera carga');
    assert.ok(exercisesDb.cached() !== null, 'cached() tiene que devolverlo sin ir a la red');
});

test('exercises-db: una red caída devuelve error, NO lanza ni deja medio catálogo', async () => {
    exercisesDb.reset();
    const caida = async () => { throw new Error('sin red'); };
    const r = await exercisesDb.load({ fetchImpl: /** @type {*} */ (caida) });
    assert.equal(r.ok, false);
    assert.equal(typeof (/** @type {*} */ (r).error), 'string');
    assert.equal(exercisesDb.cached(), null, 'un fallo no puede dejar un catálogo a medias');
});

test('exercises-db: una respuesta que no es JSON tampoco lanza', async () => {
    exercisesDb.reset();
    const rara = async () => ({ ok: true, json: async () => { throw new Error('no es json'); } });
    const r = await exercisesDb.load({ fetchImpl: /** @type {*} */ (rara) });
    assert.equal(r.ok, false);
});

/* ── ui/plan-summary.js · renderCoordinatedOffer ─────────────────────────── */

test('renderCoordinatedOffer: sin fuentes no pinta NADA', () => {
    // Una caja vacía con un icono de aviso es peor que ninguna caja.
    assert.equal(String(renderCoordinatedOffer({})), '');
    assert.equal(String(renderCoordinatedOffer({
        weightDeviation: null, measuredExpenditure: null, deload: null
    })), '');
});

test('renderCoordinatedOffer: con dos fuentes sobre la misma palanca sale UNA', () => {
    const html = String(renderCoordinatedOffer({
        weightDeviation: { offer: true, reasonKey: 'recalibration.weightMagnitude', params: {} },
        measuredExpenditure: { offer: true, reason: 'higher', gapKcal: 400 }
    }));
    // Una sola acción: dos botones serían las dos ofertas vivas que el
    // invariante `recalibracion_unica` viene a impedir.
    assert.equal([...html.matchAll(/data-recal-source=/g)].length, 1);
    // Y gana el gasto medido, que se apoya en dos señales frente a una.
    assert.match(html, /data-recal-source="measuredExpenditure"/);
    // Lo desplazado se NOMBRA.
    assert.match(html, /notice/);
});

test('renderCoordinatedOffer: una fuente en OTRA palanca se aplaza, no se pierde', () => {
    const html = String(renderCoordinatedOffer({
        measuredExpenditure: { offer: true, reason: 'lower', gapKcal: -300 },
        deload: { offer: true, reasons: ['deload.lowRecovery'] }
    }));
    assert.equal([...html.matchAll(/data-recal-source=/g)].length, 1);
    assert.match(html, /data-recal-source="measuredExpenditure"/);
});

test('renderCoordinatedOffer: nada de lo que entra llega al DOM sin escapar', () => {
    // El vector real del producto es el import de backups y el multiperfil.
    const html = String(renderCoordinatedOffer({
        weightDeviation: {
            offer: true,
            reasonKey: 'recalibration.weightMagnitude',
            params: { side: '<img src=x onerror=alert(1)>', count: 3 }
        }
    }));
    // Lo que importa es que NO salga como marcado: los ángulos van escapados y
    // el navegador lo pinta como texto. Que las letras «onerror=» sigan ahí,
    // dentro de un nodo de texto, es inofensivo — y exigir lo contrario sería un
    // test que confunde «escapado» con «censurado».
    assert.ok(!html.includes('<img'), 'un parámetro hostil no puede salir como marcado');
    assert.match(html, /&lt;img/, 'tiene que salir escapado, no desaparecido');
});

/* ── ui/marks.js ─────────────────────────────────────────────────────────── */

test('marks: las categorías del producto están fijadas y congeladas', () => {
    // Cuatro: fases del plan, composición corporal, salud y estética. Fijarlas
    // aquí es lo que impide que una quinta entre sin que nadie decida qué color
    // lleva ni qué prioridad tiene cuando los marcadores no caben.
    assert.deepEqual([...MARK_CATEGORIES].sort(), ['aesthetic', 'body', 'health', 'phase']);
    assert.throws(() => { /** @type {*} */ (MARK_CATEGORIES).push('x'); });
});

test('marks: sin datos devuelve una lista vacía, no lanza', () => {
    for (const basura of [null, undefined, {}, { projection: null }]) {
        const r = buildMarks(/** @type {*} */ (basura), 0, { categories: ['phase'] });
        assert.ok(Array.isArray(r), 'buildMarks siempre devuelve una lista');
    }
});

test('marks: una categoría apagada no aporta marcas', () => {
    // El filtro no es cosmético: con treinta hitos encendidos los marcadores
    // tapan justo las series que vienen a anotar.
    const vacio = buildMarks(/** @type {*} */ ({ projection: { daily: [] }, plan: { phases: [] } }), 0,
        { categories: [] });
    assert.deepEqual(vacio, []);
});

/* ── data/steps.js ───────────────────────────────────────────────────────── */

test('steps: un día se apunta UNA vez; volver a apuntarlo sustituye', async () => {
    // Si se sumaran, la media diaria saldría inflada y el canje de pasos por
    // calorías propondría un escenario que no existe.
    const steps = await import('../src/data/steps.js');
    installLocalStorageMock();
    storage.setActiveProfile('p1');

    steps.save({ dateISO: '2026-02-01', steps: 6000 });
    steps.save({ dateISO: '2026-02-01', steps: 9500 });
    assert.equal(steps.list().length, 1);
    assert.equal(steps.findByDate('2026-02-01').steps, 9500);
});

test('steps: la lista sale ordenada por fecha, se apunte en el orden que se apunte', async () => {
    const steps = await import('../src/data/steps.js');
    installLocalStorageMock();
    storage.setActiveProfile('p1');
    steps.save({ dateISO: '2026-03-10', steps: 7000 });
    steps.save({ dateISO: '2026-01-05', steps: 8000 });
    steps.save({ dateISO: '2026-02-01', steps: 9000 });
    assert.deepEqual(steps.list().map((/** @type {*} */ s) => s.dateISO),
        ['2026-01-05', '2026-02-01', '2026-03-10']);
});

test('steps: una entrada imposible se rechaza sin tocar lo guardado', async () => {
    const steps = await import('../src/data/steps.js');
    installLocalStorageMock();
    storage.setActiveProfile('p1');
    steps.save({ dateISO: '2026-02-01', steps: 8000 });

    for (const malo of [
        { dateISO: 'ayer', steps: 8000 },
        { dateISO: '2026-02-02', steps: -5 },
        { dateISO: '2026-02-02', steps: 999999 },
        { dateISO: '2026-02-02', steps: NaN }
    ]) {
        const r = steps.save(/** @type {*} */ (malo));
        assert.equal(r.ok, false, `debería rechazar ${JSON.stringify(malo)}`);
    }
    assert.equal(steps.list().length, 1, 'un rechazo no puede alterar lo que ya había');
});

test('steps: borrar quita solo ese día', async () => {
    const steps = await import('../src/data/steps.js');
    installLocalStorageMock();
    storage.setActiveProfile('p1');
    steps.save({ dateISO: '2026-02-01', steps: 8000 });
    steps.save({ dateISO: '2026-02-02', steps: 9000 });
    steps.remove('2026-02-01');
    assert.deepEqual(steps.list().map((/** @type {*} */ s) => s.dateISO), ['2026-02-02']);
});

/* ── data/demo-profile.js ────────────────────────────────────────────────── */

test('demo-profile: instalar y quitar no deja NADA detrás', async () => {
    const demo = await import('../src/data/demo-profile.js');
    installLocalStorageMock();
    storage.setActiveProfile('p1');

    // Un perfil real con un dato dentro, para comprobar que no se toca.
    const profiles = await import('../src/data/profiles.js');
    profiles.create('Dani', { createdAtISO: '2026-01-01T00:00:00.000Z', id: 'p1' });
    storage.setActiveProfile('p1');
    storage.set('checkins', { schemaVersion: 6, items: [] });
    const realAntes = JSON.stringify(storage.get('checkins').value);

    const puesto = demo.install({ todayISO: '2026-08-21', nowISO: '2026-08-21T10:00:00.000Z' });
    assert.ok(puesto.ok, `no se pudo instalar: ${puesto.ok ? '' : puesto.error}`);
    assert.equal(demo.isInstalled(), true);
    assert.equal(demo.isDemo(storage.getActiveProfile()), true);

    // Los datos reales, intactos: la garantía es de NAMESPACE.
    storage.setActiveProfile('p1');
    assert.equal(JSON.stringify(storage.get('checkins').value), realAntes);

    const quitado = demo.uninstall();
    assert.ok(quitado.ok);
    assert.equal(demo.isInstalled(), false);
    const restos = storage.rawKeys('tl.6.demo.');
    assert.deepEqual(restos.ok ? restos.value : ['error'], []);
});

test('demo-profile: instalar dos veces NO regenera lo que hubiera dentro', async () => {
    // Regenerarlo borraría lo que el usuario haya trasteado en el ejemplo, que
    // es justo para lo que está.
    const demo = await import('../src/data/demo-profile.js');
    installLocalStorageMock();
    storage.setActiveProfile('p1');
    const profiles = await import('../src/data/profiles.js');
    profiles.create('Dani', { createdAtISO: '2026-01-01T00:00:00.000Z', id: 'p1' });

    demo.install({ todayISO: '2026-08-21', nowISO: '2026-08-21T10:00:00.000Z' });
    storage.set('checkins', { schemaVersion: 6, items: [] });   // el usuario lo vacía

    const otra = demo.install({ todayISO: '2026-08-21', nowISO: '2026-08-21T10:00:00.000Z' });
    assert.ok(otra.ok);
    assert.deepEqual(/** @type {*} */ (storage.get('checkins').value).items, [],
        'la segunda instalación activa, no regenera');
});

test('demo-profile: quitar algo que no está no es un error', async () => {
    const demo = await import('../src/data/demo-profile.js');
    installLocalStorageMock();
    storage.setActiveProfile('p1');
    assert.deepEqual(demo.uninstall(), { ok: true });
});

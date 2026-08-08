// @ts-check

/**
 * Primera cobertura unitaria de `src/ui/chart.js` (E12-0).
 *
 * Hasta ahora el módulo tenía **cero** tests: toda su verificación era
 * indirecta, a través de specs de Playwright que comprueban que el lienzo pinta
 * más de cien píxeles opacos. Eso detecta que la gráfica existe, no que diga la
 * verdad.
 *
 * Esto se escribe ANTES de reformar el módulo, y a propósito solo sobre lo que
 * no va a cambiar: es la red que avisará si la reforma altera el comportamiento
 * observable. Un test escrito después del cambio describe el código nuevo; uno
 * escrito antes describe el contrato.
 *
 * El módulo es importable desde Node porque solo toca `document` dentro de las
 * funciones que dibujan, que aquí no se llaman.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
    milestoneLabel,
    handleKey,
    announce,
    cursorIndex,
    destroy,
    unavailable,
    toPng,
    seriesAnchors,
    setWindow
} from '../src/ui/chart.js';
import { shortDate, monthYear, axisLabel, longDate } from '../src/ui/dates.js';
import { muscleUnitsFor } from '../src/ui/muscle-units.js';
import { makeComposition, planPhases } from '../src/core/engine.js';
import { generateProjection } from '../src/core/generator.js';
import { setLocale } from '../src/i18n/i18n.js';

const PROFILE = {
    sex: /** @type {const} */ ('male'), age: 30, heightCm: 180,
    activityLevel: /** @type {const} */ ('moderate'),
    trainingStatus: /** @type {const} */ ('intermediate')
};

/** Una proyección real del motor: nada de dobles, para que el contrato sea el de verdad. */
function projection() {
    const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const plan = planPhases(comp.value, { fatPct: 15, muscleKg: comp.value.muscleKg + 2 }, PROFILE);
    assert.ok(plan.ok);
    const proj = generateProjection(plan.value, comp.value, PROFILE, {
        startDateISO: '2026-08-03', seed: 1, fluctuation: false
    });
    assert.ok(proj.ok);
    return proj.value;
}

/** Un doble mínimo de la región `aria-live`: solo necesita `textContent`. */
function readout() {
    return /** @type {*} */ ({ textContent: '' });
}

test.beforeEach(() => {
    setLocale('es');
    destroy(); // deja el cursor en 0 y no arrastra estado entre tests
});

/* ---------------------------------------------------------------------- *
 * milestoneLabel
 * ---------------------------------------------------------------------- */

test('milestoneLabel traduce las cuatro categorías de hito', () => {
    assert.match(milestoneLabel({ category: 'fatPct', threshold: 18 }), /18/);
    assert.match(milestoneLabel({ category: 'muscleKg', threshold: 32 }), /32/);
    assert.match(milestoneLabel({ category: 'weightKg', threshold: 75 }), /75/);
    // el de fase traduce el TIPO, no imprime el código interno
    const fase = milestoneLabel({ category: 'phase', threshold: 'cut' });
    assert.match(fase, /Definición/);
    assert.ok(!fase.includes('cut'), `se coló el código interno: ${fase}`);
});

test('milestoneLabel pasa el umbral de músculo por la aduana de unidades (E11)', () => {
    const bascula = muscleUnitsFor({ scaleMuscleKg: 56.56, muscleKg: 29.2432, boneKg: 3.12 });
    // 30 kg esqueléticos son 57,3 en la báscula del usuario
    const conBascula = milestoneLabel({ category: 'muscleKg', threshold: 30 }, bascula);
    assert.match(conBascula, /57\.3/, conBascula);

    // sin báscula, la cifra se queda como está
    const sinBascula = milestoneLabel({ category: 'muscleKg', threshold: 30 }, muscleUnitsFor(null));
    assert.match(sinBascula, /30/);
    assert.ok(!sinBascula.includes('57'), sinBascula);

    // y las OTRAS categorías no se traducen jamás: son grasa y peso
    assert.match(milestoneLabel({ category: 'weightKg', threshold: 75 }, bascula), /75/);
    assert.match(milestoneLabel({ category: 'fatPct', threshold: 18 }, bascula), /18/);
});

/* ---------------------------------------------------------------------- *
 * handleKey — el recorrido con teclado es la alternativa textual del lienzo
 * ---------------------------------------------------------------------- */

test('handleKey mueve el cursor con cada tecla y consume solo las suyas', () => {
    const proj = projection();
    const range = { from: 0, to: proj.daily.length - 1 };
    const base = { readout: readout(), projection: proj, range };

    assert.equal(cursorIndex(), 0);

    assert.equal(handleKey({ ...base, key: 'ArrowRight' }), true);
    assert.equal(cursorIndex(), 1);

    assert.equal(handleKey({ ...base, key: 'ArrowLeft' }), true);
    assert.equal(cursorIndex(), 0);

    // PageUp avanza una semana y PageDown retrocede: es la asociación escrita
    assert.equal(handleKey({ ...base, key: 'PageUp' }), true);
    assert.equal(cursorIndex(), 7);
    assert.equal(handleKey({ ...base, key: 'PageDown' }), true);
    assert.equal(cursorIndex(), 0);

    assert.equal(handleKey({ ...base, key: 'End' }), true);
    assert.equal(cursorIndex(), range.to);
    assert.equal(handleKey({ ...base, key: 'Home' }), true);
    assert.equal(cursorIndex(), range.from);

    // cualquier otra tecla se devuelve al navegador sin tocar nada
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'Tab', 'a']) {
        assert.equal(handleKey({ ...base, key }), false, `consumió ${key}`);
        assert.equal(cursorIndex(), range.from);
    }
});

test('handleKey no se sale del rango por ninguno de los dos extremos', () => {
    const proj = projection();
    const range = { from: 10, to: 20 };
    const base = { readout: readout(), projection: proj, range };

    // el cursor arranca en 0, fuera del rango: la primera tecla ya lo mete dentro
    handleKey({ ...base, key: 'ArrowLeft' });
    assert.equal(cursorIndex(), 10, 'no se ha respetado el extremo inferior');

    for (let i = 0; i < 30; i++) handleKey({ ...base, key: 'ArrowRight' });
    assert.equal(cursorIndex(), 20, 'se ha salido por el extremo superior');

    for (let i = 0; i < 30; i++) handleKey({ ...base, key: 'PageDown' });
    assert.equal(cursorIndex(), 10, 'se ha salido por el extremo inferior');
});

test('destroy() devuelve el cursor al origen: no se hereda entre gráficas', () => {
    const proj = projection();
    handleKey({ readout: readout(), projection: proj, key: 'End', range: { from: 0, to: 50 } });
    assert.equal(cursorIndex(), 50);
    destroy();
    assert.equal(cursorIndex(), 0, 'el cursor sobrevivió a la destrucción de la gráfica');
});

/* ---------------------------------------------------------------------- *
 * announce — lo que oye quien no ve el lienzo
 * ---------------------------------------------------------------------- */

test('announce describe el punto con sus tres métricas y su fase', () => {
    const proj = projection();
    const r = readout();
    announce(r, proj, 0);

    const d0 = proj.daily[0];
    assert.match(r.textContent, /Día 0/);
    // Fecha legible, NO el ISO: esto lo lee un lector de pantalla (M7-4).
    assert.equal(r.textContent.includes(d0.dateISO), false, `ISO crudo en la lectura: ${r.textContent}`);
    assert.match(r.textContent, new RegExp(longDate(d0.dateISO)));
    assert.match(r.textContent, new RegExp(d0.weightKg.toFixed(1).replace('.', '\\.')));
    assert.ok(!r.textContent.includes('{'), `quedó un placeholder: ${r.textContent}`);
    // la fase va traducida, no como código interno
    assert.ok(!/adaptation|cut|bulk/.test(r.textContent), r.textContent);
});

test('announce con un índice inexistente no escribe ni lanza', () => {
    const proj = projection();
    const r = readout();
    r.textContent = 'intacto';
    for (const idx of [-1, proj.daily.length, 9999, NaN]) {
        announce(r, proj, idx);
        assert.equal(r.textContent, 'intacto', `escribió con el índice ${idx}`);
    }
});

/* ---------------------------------------------------------------------- *
 * Estado de error y exportación
 * ---------------------------------------------------------------------- */

test('el estado de error ofrece recargar y NUNCA borrar (ficha H-013)', () => {
    const salida = String(unavailable());
    assert.match(salida, /role="alert"/);
    assert.match(salida, /data-action="reload"/);
    // el legacy ofrecía borrar todos los datos si la gráfica no cargaba
    assert.ok(!/borrar|eliminar|reset|delete/i.test(salida),
        `una acción destructiva como salida de un error: ${salida}`);
});

test('toPng sin gráfica viva devuelve null en vez de lanzar', () => {
    destroy();
    assert.equal(toPng(), null);
});

/* ---------------------------------------------------------------------- *
 * Modelo de coordenadas (E12-2)
 * ---------------------------------------------------------------------- */

test('los anclajes de granularidad salen de los agregados del motor, no de un cálculo propio', () => {
    // Si se recalcularan aquí los bloques, duplicarían las reglas GEN-07
    // (semanas de 7 días desde el día 1) y GEN-11/12 (meses de calendario), y
    // divergirían en silencio el día que alguien tocara el generador.
    const proj = projection();

    const dias = seriesAnchors(proj, 'day');
    assert.equal(dias.length, proj.daily.length);
    assert.equal(dias[0], 0);
    assert.equal(dias[dias.length - 1], proj.daily.length - 1);

    for (const grain of /** @type {const} */ (['week', 'month'])) {
        const anchors = seriesAnchors(proj, grain);
        const blocks = grain === 'week' ? proj.weekly : proj.monthly;

        assert.equal(anchors[0], 0, `${grain}: falta el ancla del día 0`);
        for (let i = 1; i < anchors.length; i++) {
            assert.ok(anchors[i] > anchors[i - 1], `${grain}: los anclajes no crecen`);
        }
        // cada ancla (salvo el día 0) es el ÚLTIMO día de un bloque real
        const finales = new Set(blocks.map((b) => b.endISO));
        for (const i of anchors.slice(1)) {
            assert.ok(finales.has(proj.daily[i].dateISO),
                `${grain}: el ancla ${i} (${proj.daily[i].dateISO}) no cierra ningún bloque`);
        }
        // y reduce de verdad: menos puntos que días
        assert.ok(anchors.length < proj.daily.length, `${grain} no reduce la densidad`);
    }

    // semana da más puntos que mes, que es lo que significa «más detalle»
    assert.ok(seriesAnchors(proj, 'week').length > seriesAnchors(proj, 'month').length);
});

test('seriesAnchors degrada con proyecciones rotas', () => {
    for (const bad of [null, undefined, {}, { daily: [] }, { daily: null }]) {
        assert.deepEqual(seriesAnchors(/** @type {*} */ (bad), 'week'), []);
    }
});

test('setWindow sin gráfica viva devuelve false en vez de lanzar', () => {
    destroy();
    assert.equal(setWindow(10, 50), false);
});

/* ---------------------------------------------------------------------- *
 * Fechas — la trampa de la zona horaria
 * ---------------------------------------------------------------------- */

test('las fechas se formatean en el idioma activo', () => {
    setLocale('es');
    const es = shortDate('2027-02-14');
    assert.match(es, /14/);
    assert.match(es, /feb/i);

    setLocale('en');
    const en = shortDate('2027-02-14');
    assert.match(en, /14/);
    assert.match(en, /feb/i);
    setLocale('es');

    assert.match(monthYear('2027-02-14'), /2027/);
});

test('una fecha ilegible se devuelve tal cual, sin «Invalid Date»', () => {
    for (const bad of ['', 'ayer', '2027-13-45', null, undefined, '2027']) {
        const salida = shortDate(/** @type {*} */ (bad));
        assert.ok(!/invalid/i.test(salida), `«${bad}» produjo: ${salida}`);
    }
});

test('el rótulo del eje se adapta al ancho de la ventana', () => {
    setLocale('es');
    // ventana corta: interesa el día
    assert.match(axisLabel('2027-02-14', 30), /14/);
    // ventana larga: el día es ruido, manda el mes con su año
    const largo = axisLabel('2027-02-14', 400);
    assert.match(largo, /2027/);
    assert.ok(!/14/.test(largo), `el rótulo largo conserva el día: ${largo}`);
});

test('LAS FECHAS SON UTC: la zona horaria del usuario no puede correrlas un día', () => {
    // Las fechas del generador son días civiles en UTC (GEN-02), no instantes.
    // Sin `timeZone: 'UTC'` en el formateador, quien viva en UTC-5 vería «13
    // feb» donde pone `2027-02-14`, y la línea de HOY dejaría de coincidir con
    // su propio rótulo. Es un desfase que no se reproduce en el portátil de
    // quien escribe el código, así que se prueba en un proceso con otra zona.
    const script = `
        import { shortDate } from '${new URL('../src/ui/dates.js', import.meta.url).href}';
        process.stdout.write(shortDate('2027-02-14'));
    `;
    const run = (/** @type {string} */ tz) => execFileSync(
        process.execPath, ['--input-type=module', '-e', script],
        { env: { ...process.env, TZ: tz }, encoding: 'utf8' }
    );

    const madrid = run('Europe/Madrid');
    const nuevaYork = run('America/New_York');
    const tokio = run('Asia/Tokyo');

    assert.equal(madrid, nuevaYork, `Madrid dice «${madrid}» y Nueva York «${nuevaYork}»`);
    assert.equal(madrid, tokio, `Madrid dice «${madrid}» y Tokio «${tokio}»`);
    assert.match(madrid, /14/, `la fecha se corrió de día: ${madrid}`);
});

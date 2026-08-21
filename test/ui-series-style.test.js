// @ts-check

/**
 * Estilo, ejes y aduana de las series superpuestas (E13-3).
 *
 * Se prueba desde Node porque el módulo es puro: la paleta entra por parámetro
 * en vez de leerse del documento. Esa decisión de diseño es justo lo que hace
 * posible este fichero.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    PROVENANCE_STYLE, SLOT_POINT_STYLE, MAX_SERIES, MIN_MARKERS_VISIBLE,
    markerEvery, styleFor, planAxes, axisIdFor, rebase, axisSpan} from '../src/ui/series-style.js';
import { translateSeries, muscleUnitsFor } from '../src/ui/muscle-units.js';

const PALETA = ['#111111', '#222222', '#333333', '#444444'];

/** Una serie resuelta de pega, con la forma mínima que consume el estilo. */
function serie(unit, provenance = 'projected', points = [{ x: 0, y: 1 }], extra = {}) {
    return {
        spec: { id: 'x', labelKey: 'k', unit, provenance, group: 'body', aggregate: 'endpoint', needs: [], points: () => [], ...extra },
        points, band: null, unit, extent: null, reason: null
    };
}

/* ---------------------------------------------------------------------- *
 * Los dos canales
 * ---------------------------------------------------------------------- */

test('el trazo codifica procedencia y el color codifica hueco, sin cruzarse', () => {
    // Cuatro procedencias, cuatro patrones de trazo DISTINTOS.
    const trazos = Object.values(PROVENANCE_STYLE).map((s) => JSON.stringify(s.borderDash));
    assert.equal(new Set(trazos).size, 4, 'dos procedencias con el mismo trazo serían indistinguibles en gris');

    // Cuatro huecos, cuatro marcadores distintos.
    assert.equal(new Set(SLOT_POINT_STYLE).size, MAX_SERIES);

    // La MISMA procedencia en dos huecos: mismo trazo, distinto color y marcador.
    const a = styleFor('measured', 0, PALETA);
    const b = styleFor('measured', 1, PALETA);
    assert.deepEqual(a.borderDash, b.borderDash, 'la procedencia manda en el trazo');
    assert.notEqual(a.borderColor, b.borderColor);
    assert.notEqual(a.pointStyle, b.pointStyle);

    // El MISMO hueco con dos procedencias: mismo color, distinto trazo.
    const c = styleFor('projected', 0, PALETA);
    const d = styleFor('estimated', 0, PALETA);
    assert.equal(c.borderColor, d.borderColor, 'el hueco manda en el color');
    assert.notDeepEqual(c.borderDash, d.borderDash);
});

test('lo medido conserva EXACTAMENTE el estilo del check-in de la v1', () => {
    // El contrato de test que localiza los check-ins por su `pointStyle` no se
    // rompe porque `measured` reproduce el rombo, el trazo [3,3] y el grosor 1.
    const s = styleFor('measured', 3, PALETA);
    assert.deepEqual(PROVENANCE_STYLE.measured.borderDash, [3, 3]);
    assert.equal(PROVENANCE_STYLE.measured.borderWidth, 1);
    assert.equal(s.pointStyle, 'rectRot', 'el hueco 4 usa el rombo, el mismo del check-in');
});

test('cada línea lleva su marcador al menos seis veces', () => {
    // Sin esto, en grano diario `pointRadius` sería 0 y el color quedaría como
    // ÚNICA señal para distinguir dos series de la misma procedencia.
    for (const n of [1, 5, 6, 7, 50, 366, 1096]) {
        const cada = markerEvery(n);
        const visibles = Math.ceil(n / cada);
        assert.ok(visibles >= Math.min(n, MIN_MARKERS_VISIBLE),
            `con ${n} puntos solo se verían ${visibles} marcadores`);
    }

    // Y el radio se aplica punto a punto: el primero SIEMPRE lleva marcador.
    const s = styleFor('projected', 0, PALETA, 1096);
    assert.ok(s.pointRadius({ dataIndex: 0 }) > 0);
    assert.equal(s.pointRadius({ dataIndex: 1 }), 0);
});

/* ---------------------------------------------------------------------- *
 * Ejes
 * ---------------------------------------------------------------------- */

test('eje_unico_sin_yaxisid: una unidad produce un eje y ningún yAxisID', () => {
    const plan = planAxes([serie('kgBody'), serie('kgBody'), serie('kgBody')]);
    assert.equal(plan.status, 'ok');
    assert.equal(plan.axes.length, 1);
    assert.equal(plan.axes[0].id, 'y');
    assert.equal(plan.axes[0].position, 'left');

    // LO QUE IMPORTA: con un solo eje, `axisIdFor` devuelve null para todas, y
    // por tanto ningún dataset lleva `yAxisID`. Es la configuración exacta que
    // produce hoy el camino de una métrica.
    for (let i = 0; i < 3; i++) assert.equal(axisIdFor(plan, i), null);
});

test('dos unidades reparten izquierda y derecha, y manda el hueco 0', () => {
    const plan = planAxes([serie('kcal'), serie('kgBody'), serie('kcal')]);
    assert.equal(plan.status, 'ok');
    assert.equal(plan.axes.length, 2);
    assert.equal(plan.axes[0].unit, 'kcal', 'la unidad del hueco 0 manda en la izquierda');
    assert.equal(plan.axes[0].position, 'left');
    assert.equal(plan.axes[1].position, 'right');

    assert.equal(axisIdFor(plan, 0), 'y');
    assert.equal(axisIdFor(plan, 1), 'y2');
    assert.equal(axisIdFor(plan, 2), 'y', 'las de la misma unidad comparten eje');

    // Reordenar la selección cambia el lado: determinista y controlable.
    const alReves = planAxes([serie('kgBody'), serie('kcal')]);
    assert.equal(alReves.axes[0].unit, 'kgBody');
});

test('tres unidades NO se dibujan: se declara el problema', () => {
    const plan = planAxes([serie('kgBody'), serie('kcal'), serie('cm')]);
    assert.equal(plan.status, 'tooManyUnits');
    assert.deepEqual(plan.axes, [], 'no se inventa un reparto que obligue a una escala a mentir');
    assert.equal(plan.units.length, 3, 'pero SÍ se dice cuántas unidades hay, para poder explicarlo');
});

test('las tres unidades de músculo no se mezclan por accidente', () => {
    // Global (25–45) y de grupo (1,8–7) en el mismo eje aplastarían los grupos.
    const plan = planAxes([serie('kgMuscleSkeletal'), serie('kgMuscleGroup')]);
    assert.equal(plan.axes.length, 2, 'son unidades distintas: dos ejes, no uno');

    // Y la de báscula tampoco es la del motor.
    const conBascula = planAxes([serie('kgMuscleSkeletal'), serie('kgMuscleScale')]);
    assert.equal(conBascula.axes.length, 2);
});

test('planAxes degrada sin lanzar', () => {
    for (const roto of [null, undefined, [], 'no']) {
        const plan = planAxes(/** @type {*} */ (roto));
        assert.equal(plan.status, 'ok');
        assert.deepEqual(plan.axes, []);
    }
});

/* ---------------------------------------------------------------------- *
 * Rebase (modo «cambio desde el inicio»)
 * ---------------------------------------------------------------------- */

test('rebase da cambio PORCENTUAL, que es lo único comparable entre unidades', () => {
    const points = [{ x: 0, y: 80 }, { x: 30, y: 78 }, { x: 60, y: 76 }];
    const r = rebase(points, 0);
    assert.ok(r && r.points);
    assert.equal(r.baseline, 80);
    // −2 kg sobre 80 = −2,5 %; −4 sobre 80 = −5 %.
    assert.deepEqual(r.points.map((p) => Number(p.y.toFixed(4))), [0, -2.5, -5]);

    // La razón de ser del porcentaje: dos series de unidades distintas caen en
    // la misma escala. En valores absolutos, −300 kcal aplastaría a −2 kg.
    const kcal = rebase([{ x: 0, y: 2400 }, { x: 30, y: 2340 }], 0);
    assert.ok(kcal && kcal.points);
    assert.equal(Number(kcal.points[1].y.toFixed(4)), -2.5, 'el mismo −2,5 % que el peso');
});

test('rebase usa el primer punto DE LA VENTANA, no el día 0', () => {
    const points = [{ x: 0, y: 80 }, { x: 30, y: 78 }, { x: 60, y: 76 }];
    const desdeTreinta = rebase(points, 30);
    assert.ok(desdeTreinta && desdeTreinta.points);
    assert.equal(desdeTreinta.baseline, 78, 'el origen es 78, no 80');
    assert.equal(desdeTreinta.baselineX, 30);
    assert.equal(desdeTreinta.points[1].y, 0, 'el primer punto visible siempre vale 0');
});

test('una serie que YA es un delta no tiene cambio porcentual, y se dice', () => {
    // La fluctuación diaria y el déficit oscilan alrededor de cero: su cambio
    // porcentual explota. Un déficit que pasa de −5 a −300 kcal no es «un
    // aumento del 5 900 %», es una cifra sin sentido dibujada con seriedad.
    const r = rebase([{ x: 0, y: 0 }, { x: 1, y: -300 }], 0);
    assert.ok(r);
    assert.equal(r.points, null);
    assert.equal(/** @type {*} */ (r).reason, 'series.reason.deltaNotRelative');
});

test('rebase devuelve null cuando no hay nada dentro de la ventana', () => {
    assert.equal(rebase([{ x: 0, y: 1 }], 50), null);
    assert.equal(rebase([], 0), null);
    assert.equal(rebase(/** @type {*} */ (null), 0), null);
});

/* ---------------------------------------------------------------------- *
 * La aduana de músculo (E11)
 * ---------------------------------------------------------------------- */

// Un perfil de báscula de verdad: hace falta el par (esquelético, báscula) con
// una razón dentro del rango fisiológico, MÁS el hueso. Solo con `boneKg` no
// basta — `muscleOffsetKg` necesita las dos cifras para saber el desfase.
const BASCULA = muscleUnitsFor({
    weightKg: 80, fatPct: 20, muscleKg: 30, scaleMuscleKg: 60, boneKg: 3.2, muscleSource: 'derived'
});
const SIN_BASCULA = muscleUnitsFor(null);

test('la aduana traduce SOLO el músculo global, y solo con báscula', () => {
    assert.equal(BASCULA.isScale, true, 'el perfil de prueba debe ser de báscula');

    const global = serie('kgMuscleSkeletal', 'projected', [{ x: 0, y: 30 }], { muscleUnitAware: true });
    const [traducida] = translateSeries([global], BASCULA);
    assert.equal(traducida.unit, 'kgMuscleScale', 'la unidad cambia CON los datos, en el mismo sitio');
    assert.ok(traducida.points[0].y > 30, 'la cifra de báscula es mayor que el músculo esquelético');
    assert.equal(traducida.points[0].y, BASCULA.toDisplay(30));

    // Sin báscula no se toca nada.
    const [intacta] = translateSeries([global], SIN_BASCULA);
    assert.equal(intacta.unit, 'kgMuscleSkeletal');
    assert.equal(intacta.points[0].y, 30);
});

test('la aduana NO toca el músculo por grupo ni lo ya medido', () => {
    // Un grupo suelto no tiene equivalente en la escala de una báscula: no
    // convertir es más honesto que convertir mal.
    const grupo = serie('kgMuscleGroup', 'estimated', [{ x: 0, y: 2.1 }]);
    const [g] = translateSeries([grupo], BASCULA);
    assert.equal(g.unit, 'kgMuscleGroup');
    assert.equal(g.points[0].y, 2.1);

    // Lo medido YA viene en unidad de báscula: traducirlo sería hacerlo dos veces.
    const medido = serie('kgMuscleScale', 'measured', [{ x: 0, y: 62 }]);
    const [m] = translateSeries([medido], BASCULA);
    assert.equal(m.unit, 'kgMuscleScale');
    assert.equal(m.points[0].y, 62);
});

test('sin báscula, el músculo medido se declara indisponible con motivo', () => {
    const medido = serie('kgMuscleScale', 'measured', [{ x: 0, y: 62 }]);
    const [m] = translateSeries([medido], SIN_BASCULA);
    assert.deepEqual(m.points, [], 'sin báscula esa cifra no existe');
    assert.equal(m.reason, 'series.reason.noScale',
        'y se dice por qué: ofrecer una serie que nunca tendrá datos es prometer algo que no va a pasar');
});

test('la aduana traduce también la banda, o la gráfica se descuadra', () => {
    const global = {
        ...serie('kgMuscleSkeletal', 'projected', [{ x: 0, y: 30 }], { muscleUnitAware: true }),
        band: { pessimist: [{ x: 0, y: 29 }], optimist: [{ x: 0, y: 31 }] }
    };
    const [r] = translateSeries([global], BASCULA);
    assert.equal(r.band.pessimist[0].y, BASCULA.toDisplay(29));
    assert.equal(r.band.optimist[0].y, BASCULA.toDisplay(31));
    // Y el extent se recalcula: si no, el eje se dimensionaría con las cifras
    // viejas y la línea se saldría del área.
    assert.equal(r.extent.min, BASCULA.toDisplay(30));
});

/* ────────────────────────────────────────────────────────────────────────────
 * E15-3 · El eje deja de amplificar el ruido de medida
 *
 * Chart.js autoescala el eje Y al extent de los datos. Con una serie plana eso
 * dibuja una montaña rusa: medido en producción, un músculo previsto de 32,487
 * a 32,500 kg produjo un eje `[32,10 – 32,50]` en el que 0,4 kg de oscilación
 * —el ruido de cualquier báscula doméstica— llenaban el lienzo entero.
 *
 * No era un fallo de la gráfica: dibujaba fielmente unos datos sin señal, a
 * toda página. `axisSpan` pone el suelo por debajo del cual el eje estaría
 * dibujando error de medida.
 * ──────────────────────────────────────────────────────────────────────────── */

test('axisSpan no toca un recorrido que ya es bastante ancho', () => {
    assert.deepEqual(axisSpan(70, 85, 2), { min: 70, max: 85 });
    // Justo en el umbral tampoco: `>=` y no `>`.
    assert.deepEqual(axisSpan(30, 32, 2), { min: 30, max: 32 });
});

test('axisSpan ensancha CENTRADO, no anclando un extremo', () => {
    // El caso de producción: 32,487 → 32,500, suelo de 2 kg.
    const r = axisSpan(32.1, 32.5, 2);
    assert.equal(r.max - r.min, 2);
    // El punto medio se conserva: mover un solo extremo desplazaría la serie
    // contra un borde y sugeriría una tendencia que no existe.
    assert.equal((r.min + r.max) / 2, (32.1 + 32.5) / 2);
    assert.ok(r.min < 32.1 && r.max > 32.5, 'el recorrido real queda dentro');
});

test('axisSpan aguanta una serie constante', () => {
    const r = axisSpan(80, 80, 2);
    assert.deepEqual(r, { min: 79, max: 81 });
});

test('axisSpan devuelve la entrada tal cual si no puede hacer nada', () => {
    // Un eje mal escalado es un defecto visual; lanzar aquí dejaría la vista
    // entera sin gráfica, que es mucho peor.
    assert.deepEqual(axisSpan(NaN, 10, 2), { min: NaN, max: 10 });
    assert.deepEqual(axisSpan(0, Infinity, 2), { min: 0, max: Infinity });
    assert.deepEqual(axisSpan(1, 1.1, 0), { min: 1, max: 1.1 });
    assert.deepEqual(axisSpan(1, 1.1, -5), { min: 1, max: 1.1 });
    assert.deepEqual(axisSpan(1, 1.1, NaN), { min: 1, max: 1.1 });
});

test('axisSpan funciona con recorridos negativos, que los deltas los tienen', () => {
    const r = axisSpan(-0.2, 0.1, 2);
    assert.equal(r.max - r.min, 2);
    assert.ok(r.min < -0.2 && r.max > 0.1);
});

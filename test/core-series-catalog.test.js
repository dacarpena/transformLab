// @ts-check

/**
 * El catálogo de series (E13-1).
 *
 * Los invariantes con nombre viven aquí. Cuatro de ellos —los de las trampas de
 * unidad— existen porque la v4.0 se hundió exactamente por confundir dos
 * magnitudes que compartían nombre, y este catálogo es el sitio donde esa
 * confusión volvería a entrar sin que nadie lo notase: basta con teclear
 * `kgMuscleSkeletal` donde va `kgMuscleScale`.
 *
 * La proyección es REAL, del motor, no un doble: un catálogo probado contra
 * datos inventados solo demuestra que sabe leer datos inventados.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    SERIES, UNITS, seriesById, catalogFor, resolveSeries, resampleTo
} from '../src/core/series-catalog.js';
import { makeComposition, planPhases } from '../src/core/engine.js';
import { generateProjection } from '../src/core/generator.js';
import { seriesAnchors } from '../src/ui/chart.js';
import { es } from '../src/i18n/es.js';
import { en } from '../src/i18n/en.js';

const PROFILE = Object.freeze({
    sex: 'male', age: 30, heightCm: 178,
    activityLevel: 'moderate', trainingStatus: 'intermediate'
});

/** Una proyección real del motor. */
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

/** Un contexto completo: todas las colecciones con algo dentro. */
function fullContext() {
    const proj = projection();
    const dias = proj.daily.length;
    return {
        projection: proj,
        checkins: [0, 7, 14, 21].map((d) => ({
            dayIndex: d, weightKg: 80 - d * 0.05, fatPct: 20 - d * 0.02,
            scaleMuscleKg: 62 + d * 0.01,
            measuresCm: { waist: 88 - d * 0.05, arm: 35 },
            subjective: { energy: 7, sleep: 8, adherence: 9, motivation: 6 },
            trendKg: 80 - d * 0.04, deviationKg: -0.2
        })),
        intake: [0, 1, 2, 3, 8, 9].map((d) => ({
            dayIndex: d, kcal: 2400 + d, proteinG: 180, carbsG: 250, fatG: 70
        })),
        steps: [0, 1, 2, 8].map((d) => ({ dayIndex: d, steps: 9000 + d * 100 })),
        sessions: [
            { id: 's1', dateISO: proj.daily[3].dateISO, entries: [
                { exerciseId: 'squat', sets: [{ reps: 8, loadKg: 100 }, { reps: 8, loadKg: 100 }] }
            ] },
            // Dos sesiones el MISMO día: la trampa del tonelaje.
            { id: 's2', dateISO: proj.daily[3].dateISO, entries: [
                { exerciseId: 'squat', sets: [{ reps: 5, loadKg: 110 }] }
            ] },
            { id: 's3', dateISO: proj.daily[10].dateISO, entries: [
                { exerciseId: 'squat', sets: [{ reps: 6, loadKg: 105 }] }
            ] }
        ],
        muscleByGroup: {
            chest: [{ x: 0, y: 2.1 }, { x: dias - 1, y: 2.4 }],
            quads: [{ x: 0, y: 6.2 }, { x: dias - 1, y: 6.8 }]
        },
        param: 'squat'
    };
}

/* ---------------------------------------------------------------------- *
 * Invariantes con nombre
 * ---------------------------------------------------------------------- */

test('catalogo_unidades: toda unidad declarada existe en UNITS', () => {
    for (const spec of SERIES) {
        assert.ok(Object.hasOwn(UNITS, spec.unit),
            `la serie ${spec.id} declara la unidad «${spec.unit}», que no está en UNITS`);
    }
});

test('catalogo_i18n: toda clave del catálogo existe en los DOS diccionarios', () => {
    /** @type {string[]} */ const claves = [];
    for (const spec of SERIES) claves.push(spec.labelKey);
    for (const unit of Object.values(UNITS)) claves.push(unit.key);
    // Los motivos que puede devolver `resolveSeries`.
    claves.push('series.reason.noData', 'series.reason.unknown',
        'series.reason.missing', 'series.reason.failed', 'series.reason.outOfWindow');

    for (const clave of new Set(claves)) {
        assert.ok(Object.hasOwn(es, clave), `falta «${clave}» en es.js`);
        assert.ok(Object.hasOwn(en, clave), `falta «${clave}» en en.js`);
    }
});

test('catalogo_ids: únicos, y con la forma que el esquema acepta persistir', () => {
    const vistos = new Set();
    for (const spec of SERIES) {
        assert.ok(!vistos.has(spec.id), `id duplicado: ${spec.id}`);
        vistos.add(spec.id);
        // `SAFE_ID` del esquema. Un punto rompería el namespace de claves de
        // almacenamiento si algún día un id acabara formando parte de una.
        assert.match(spec.id, /^[A-Za-z0-9_-]+$/, `id no persistible: ${spec.id}`);
        assert.ok(spec.id.length <= 40, `id demasiado largo: ${spec.id}`);
    }
    assert.ok(SERIES.length >= 40, `el catálogo tiene ${SERIES.length} series; se esperaban 40+`);
});

test('catalogo_x_absoluto: x es entero, creciente y dentro del plan', () => {
    const ctx = fullContext();
    const total = ctx.projection.daily.length - 1;
    const anchors = seriesAnchors(ctx.projection, 'day');

    for (const spec of SERIES) {
        const r = resolveSeries(spec, ctx, anchors);
        let previo = -1;
        for (const p of r.points) {
            assert.ok(Number.isInteger(p.x), `${spec.id}: x=${p.x} no es entero`);
            assert.ok(p.x >= 0 && p.x <= total, `${spec.id}: x=${p.x} fuera de [0,${total}]`);
            assert.ok(p.x > previo, `${spec.id}: x no es estrictamente creciente`);
            previo = p.x;
            assert.ok(Number.isFinite(p.y), `${spec.id}: y=${p.y} no es finito`);
        }
    }
});

test('catalogo_degrada: un contexto roto devuelve vacío CON motivo, nunca una excepción', () => {
    const anchors = [0, 1, 2];
    for (const spec of SERIES) {
        for (const roto of [undefined, null, {}, { projection: null }, { projection: { daily: 'no' } }]) {
            const r = resolveSeries(spec, /** @type {*} */ (roto), anchors);
            assert.equal(r.points.length, 0, `${spec.id} produjo puntos con un contexto roto`);
            assert.ok(typeof r.reason === 'string' && r.reason.length > 0,
                `${spec.id} devolvió vacío SIN motivo: la leyenda no podría explicarlo`);
        }
    }
});

test('catalogo_sin_agregados: ningún productor lee projection.weekly ni monthly', async () => {
    // Los agregados solo traen CUATRO métricas. Un productor que los leyera
    // funcionaría para el peso y devolvería `undefined` para todo lo demás,
    // en silencio. El remuestreo se hace con `seriesAnchors`, que los deriva.
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/core/series-catalog.js', import.meta.url), 'utf8');
    assert.equal(/projection\?\.weekly|projection\.weekly|\.monthly/.test(src), false,
        'el catálogo lee agregados del motor: debe derivarlos de `daily` vía anclajes');
});

test('catalogo_puro: el módulo no toca el DOM ni el almacén', async () => {
    const { readFile } = await import('node:fs/promises');
    const src = await readFile(new URL('../src/core/series-catalog.js', import.meta.url), 'utf8');
    const cuerpo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/\b(window|document|localStorage|navigator)\b/.test(cuerpo), false,
        'el catálogo vive en core: no puede conocer el navegador');
});

/* ---------------------------------------------------------------------- *
 * Las cuatro trampas de unidad, una por test
 * ---------------------------------------------------------------------- */

test('trampa 1: el músculo global y el de grupo NO comparten unidad', () => {
    const global = seriesById('proj_muscle_kg');
    const grupo = seriesById('est_muscle_chest');
    assert.ok(global && grupo);
    assert.equal(global.unit, 'kgMuscleSkeletal');
    assert.equal(grupo.unit, 'kgMuscleGroup');
    assert.notEqual(global.unit, grupo.unit,
        'con la misma unidad compartirían eje, y los diez grupos se aplastarían contra el suelo');

    // Y los diez grupos comparten unidad ENTRE ELLOS: sí son comparables.
    const grupos = SERIES.filter((s) => s.group === 'muscleGroups');
    assert.equal(grupos.length, 10);
    for (const g of grupos) assert.equal(g.unit, 'kgMuscleGroup');
});

test('trampa 2: el músculo de la báscula NUNCA se declara músculo esquelético', () => {
    const medido = seriesById('meas_scale_muscle');
    assert.ok(medido);
    assert.equal(medido.unit, 'kgMuscleScale');
    assert.notEqual(medido.unit, 'kgMuscleSkeletal',
        'la báscula da magra menos hueso, no músculo esquelético: es el defecto que hundió la v4.0');
    assert.equal(medido.provenance, 'measured');

    // Solo la serie global pasa por la aduana de E11. Ni la medida (ya viene en
    // unidad de báscula) ni las de grupo (no convertir es más honesto).
    const aduana = SERIES.filter((s) => s.muscleUnitAware === true).map((s) => s.id);
    assert.deepEqual(aduana, ['proj_muscle_kg']);
});

test('trampa 3: la fluctuación es un DELTA, y el peso visible ya la incluye', () => {
    const fluct = seriesById('proj_fluctuation');
    assert.ok(fluct);
    assert.equal(fluct.unit, 'kgDelta',
        'un delta en el eje de un peso corporal sería una línea plana pegada al suelo');

    const ctx = fullContext();
    const anchors = seriesAnchors(ctx.projection, 'day');
    // Con el interruptor apagado la fluctuación es cero y el peso visible es
    // exactamente el peso proyectado.
    const peso = resolveSeries(/** @type {*} */ (seriesById('proj_weight')), ctx, anchors);
    for (let i = 0; i < peso.points.length; i++) {
        assert.equal(peso.points[i].y, ctx.projection.daily[peso.points[i].x].weightKg);
    }
    const f = resolveSeries(fluct, ctx, anchors);
    for (const p of f.points) assert.equal(p.y, 0);
});

test('trampa 4: el tonelaje se SUMA al agregar, y suma los días de la semana', () => {
    const spec = seriesById('meas_tonnage');
    assert.ok(spec);
    assert.equal(spec.aggregate, 'sum');

    const ctx = fullContext();
    const diario = resolveSeries(spec, ctx, seriesAnchors(ctx.projection, 'day'));
    // Día 3: dos sesiones. 2×8×100 + 1×5×110 = 1600 + 550 = 2150.
    const dia3 = diario.points.find((p) => p.x === 3);
    assert.ok(dia3, 'el día con dos sesiones debe producir UN punto');
    assert.equal(dia3.y, 2150, 'dos sesiones el mismo día son un día de entrenamiento: se suman');
    // Día 10: 1×6×105 = 630.
    assert.equal(diario.points.find((p) => p.x === 10)?.y, 630);

    // A grano de semana, los días 3 y 10 caen en semanas distintas (la semana 1
    // es 1–7). Lo que se comprueba: el total no se pierde ni se duplica.
    const semanal = resolveSeries(spec, ctx, seriesAnchors(ctx.projection, 'week'));
    const totalDiario = diario.points.reduce((a, p) => a + p.y, 0);
    const totalSemanal = semanal.points.reduce((a, p) => a + p.y, 0);
    assert.equal(totalSemanal, totalDiario,
        'sumar por semanas debe conservar el tonelaje total: ni se pierde un día ni se cuenta dos veces');
});

/* ---------------------------------------------------------------------- *
 * Remuestreo
 * ---------------------------------------------------------------------- */

test('resampleTo respeta los tres modos de agregación', () => {
    const puntos = [
        { x: 0, y: 10 }, { x: 1, y: 20 }, { x: 2, y: 30 },
        { x: 3, y: 40 }, { x: 4, y: 50 }
    ];
    const anchors = [2, 4];

    assert.deepEqual(resampleTo(puntos, anchors, 'endpoint'),
        [{ x: 2, y: 30 }, { x: 4, y: 50 }], 'endpoint coge el último de cada bloque');
    assert.deepEqual(resampleTo(puntos, anchors, 'sum'),
        [{ x: 2, y: 60 }, { x: 4, y: 90 }], 'sum acumula el bloque');
    assert.deepEqual(resampleTo(puntos, anchors, 'mean'),
        [{ x: 2, y: 20 }, { x: 4, y: 45 }], 'mean promedia el bloque');
});

test('resampleTo no inventa puntos donde no había datos', () => {
    // Un check-in cada tres semanas, anclajes semanales: las semanas sin
    // check-in NO producen punto. Inventar uno interpolado sería dibujar una
    // medición que el usuario nunca hizo.
    const puntos = [{ x: 0, y: 80 }, { x: 21, y: 79 }];
    const anchors = [0, 7, 14, 21];
    const out = resampleTo(puntos, anchors, 'endpoint');
    assert.deepEqual(out, [{ x: 0, y: 80 }, { x: 21, y: 79 }]);
});

/* ---------------------------------------------------------------------- *
 * Disponibilidad
 * ---------------------------------------------------------------------- */

test('catalogFor solo ofrece lo que el contexto puede alimentar', () => {
    const soloPlan = { projection: projection() };
    const ids = catalogFor(soloPlan).map((s) => s.id);

    assert.ok(ids.includes('proj_weight'));
    assert.ok(ids.includes('proj_kcal_target'));
    assert.ok(!ids.includes('meas_weight'), 'sin check-ins no hay peso medido');
    assert.ok(!ids.includes('meas_tonnage'), 'sin sesiones no hay tonelaje');
    assert.ok(!ids.includes('est_muscle_chest'), 'sin reparto no hay grupos');

    const completo = catalogFor(fullContext()).map((s) => s.id);
    assert.ok(completo.includes('meas_weight'));
    assert.ok(completo.includes('meas_tonnage'));
    assert.ok(completo.length > ids.length);

    assert.deepEqual(catalogFor(/** @type {*} */ (null)), []);
});

test('todas las series del catálogo resuelven con un contexto completo', () => {
    const ctx = fullContext();
    const anchors = seriesAnchors(ctx.projection, 'day');
    const disponibles = catalogFor(ctx);

    const vacias = disponibles
        .map((spec) => ({ id: spec.id, r: resolveSeries(spec, ctx, anchors) }))
        .filter(({ r }) => r.points.length === 0)
        .map(({ id }) => id);

    // El doble solo alimenta dos grupos y dos perímetros; el resto está vacío a
    // propósito, y eso es información, no un fallo: la leyenda lo dirá.
    const esperadasVacias = disponibles
        .filter((s) => (s.group === 'muscleGroups'
            && !['est_muscle_chest', 'est_muscle_quads'].includes(s.id))
            || (s.group === 'measures' && !['meas_waist', 'meas_arm'].includes(s.id)))
        .map((s) => s.id);
    assert.deepEqual(vacias.sort(), esperadasVacias.sort(),
        'solo deberían quedar vacías las series que el doble no alimenta');
});

test('la banda del peso envuelve la línea, y NO se llama lower/upper', () => {
    const ctx = fullContext();
    const anchors = seriesAnchors(ctx.projection, 'week');
    const r = resolveSeries(/** @type {*} */ (seriesById('proj_weight')), ctx, anchors);

    assert.ok(r.band, 'el peso proyectado debe traer su banda de escenarios');
    assert.equal(r.band.pessimist.length, r.points.length);
    assert.equal(r.band.optimist.length, r.points.length);

    // La comprobación que importa: durante la pérdida el escenario pesimista
    // pesa MÁS que el esperado (menos progreso = más kilos). Si algún día
    // alguien renombra esto a `lower`/`upper`, este test dice por qué no.
    let pesimistaMayor = 0;
    for (let i = 0; i < r.points.length; i++) {
        if (r.band.pessimist[i].y > r.band.optimist[i].y) pesimistaMayor++;
    }
    assert.ok(pesimistaMayor > 0,
        'si el pesimista nunca fuera el mayor, `lower`/`upper` sería un nombre correcto y este renombrado sobraría');

    // NO se comprueba aquí que el esperado caiga DENTRO de la banda, y no es un
    // olvido: hoy NO se cumple. En este mismo plan, 25 de 176 días tienen el
    // esperado fuera de su banda, concentrados en volumen (14 de 25 días). Es un
    // defecto del MOTOR, anotado en el BACKLOG de `docs/v2/PLAN-V2.md` con su
    // reproducción, junto con el hallazgo de que el invariante `escenarios`
    // promete ese orden en su NOMBRE y no lo comprueba en su cuerpo. Afirmarlo
    // aquí sería poner en rojo un test de la gráfica por un fallo que no es suyo.

    // Y ninguna otra serie trae banda: la del peso es la del motor, no un
    // adorno que se pueda pintar sobre cualquier cosa.
    const conBanda = SERIES.filter((s) => typeof s.band === 'function').map((s) => s.id);
    assert.deepEqual(conBanda, ['proj_weight']);
});

test('el nombre de una serie NO repite su unidad ni su procedencia', () => {
    // Son campos APARTE, y se muestran aparte: la insignia dice la procedencia y
    // la cabecera de la tabla dice la unidad. Con la unidad también en el
    // nombre, la cabecera salía como «Grasa prevista (%) (%, Prevista)».
    const UNIDADES = ['(%)', '(kg)', '(cm)', '(kcal)', '(g)'];
    for (const spec of SERIES) {
        const etiqueta = es[spec.labelKey];
        assert.ok(etiqueta, `sin traducción: ${spec.labelKey}`);
        for (const u of UNIDADES) {
            assert.ok(!etiqueta.includes(u),
                `«${etiqueta}» lleva la unidad ${u} en el nombre, y la cabecera la repetiría`);
        }
    }
});

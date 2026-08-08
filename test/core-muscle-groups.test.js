// @ts-check

/**
 * Invariantes de la proyección músculo a músculo (V2-M9).
 *
 * Los cuatro con nombre: `reparto` (EL CORTAFUEGOS), `escenarios_por_grupo`,
 * `mapeo_completo` y `estimulo_monotono`.
 *
 * `reparto` es el que sostiene la milestone entera: la suma de las series por
 * grupo tiene que reconstituir EXACTAMENTE el `muscleKg` global de cada día. Sin
 * él, este módulo sería un segundo motor discutiendo con el primero, y ganaría
 * el que se pintara al final — que es literalmente el defecto que hundió la
 * v4.0.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    ANATOMICAL_SHARE, FINE_TO_COARSE,
    coarseGroupOf, gainShares, distributeExactly, projectByGroup, checkReparto
} from '../src/core/muscle-groups.js';
import { MUSCLE_GROUPS, BASE_LANDMARKS, stimulusOf } from '../src/core/muscle-volume.js';
import { SCENARIO_PROGRESS_EXPONENTS } from '../src/core/constants.js';
import { generateProjection } from '../src/core/generator.js';
import { makeComposition, planPhases } from '../src/core/engine.js';

const CATALOG = JSON.parse(
    readFileSync(new URL('../src/core/data/aesthetic-catalog.json', import.meta.url), 'utf8')
);

/** Una proyección REAL del motor, no una serie de juguete. */
function proyeccionReal() {
    const profile = {
        sex: 'male', age: 32, heightCm: 178,
        activityLevel: 'moderate', trainingStatus: 'intermediate'
    };
    const comp = makeComposition({ weightKg: 85, fatPct: 22, sex: 'male' });
    assert.ok(comp.ok, JSON.stringify(!comp.ok && comp.errors));
    const target = { fatPct: 13, muscleKg: comp.value.muscleKg + 3 };
    const plan = planPhases(comp.value, target, profile);
    assert.ok(plan.ok, JSON.stringify(!plan.ok && plan.errors));
    const projection = generateProjection(plan.value, comp.value, profile, {
        startDateISO: '2026-08-01', seed: 12345, fluctuation: false
    });
    assert.ok(projection.ok, JSON.stringify(!projection.ok && projection.errors));
    return projection.value;
}

/** Estímulo por grupo a partir de un volumen semanal dado. */
function estimulo(/** @type {Record<string, number>} */ setsPorGrupo) {
    /** @type {Record<string, number>} */ const out = {};
    for (const group of MUSCLE_GROUPS) {
        out[group] = stimulusOf(setsPorGrupo[group] ?? 0, BASE_LANDMARKS[group]);
    }
    return out;
}

// ============================================================
// reparto · EL CORTAFUEGOS
// ============================================================

test('reparto · la suma por grupo reconstituye el muscleKg global CADA día', () => {
    const projection = proyeccionReal();
    const stimulusByGroup = estimulo({ chest: 14, back: 16, quads: 12, biceps: 10, triceps: 8 });
    const desagregada = projectByGroup({ daily: projection.daily, stimulusByGroup });

    for (let i = 0; i < projection.daily.length; i++) {
        const suma = desagregada.groups.reduce((acc, g) => acc + g.daily[i].muscleKg, 0);
        assert.ok(Math.abs(suma - projection.daily[i].muscleKg) < 1e-9,
            `día ${i}: ${suma} ≠ ${projection.daily[i].muscleKg}`);
    }
});

test('reparto · el cortafuegos se puede comprobar desde la interfaz, no solo desde el test', () => {
    const projection = proyeccionReal();
    const desagregada = projectByGroup({
        daily: projection.daily,
        stimulusByGroup: estimulo({ chest: 12, quads: 14 })
    });
    // Existe como función exportada porque si algún día la suma no cuadrase en el
    // navegador de alguien, es preferible que la vista lo diga a que pinte once
    // gráficas que se contradicen.
    const check = checkReparto(desagregada, projection.daily);
    assert.equal(check.ok, true, `peor desvío ${check.worstKg} kg el día ${check.worstDayIndex}`);
    assert.ok(check.worstKg < 1e-9);
});

test('reparto · cuadra también SIN estímulo declarado', () => {
    const projection = proyeccionReal();
    const desagregada = projectByGroup({ daily: projection.daily });
    assert.equal(desagregada.stimulusKnown, false);
    assert.equal(checkReparto(desagregada, projection.daily).ok, true);
});

test('reparto · cuadra con un solo grupo entrenado', () => {
    const projection = proyeccionReal();
    const desagregada = projectByGroup({
        daily: projection.daily,
        stimulusByGroup: estimulo({ biceps: 20 })
    });
    assert.equal(checkReparto(desagregada, projection.daily).ok, true);
    // Y toda la ganancia va a ese grupo: es el sentido de repartir por estímulo.
    const biceps = desagregada.groups.find((g) => g.group === 'biceps');
    assert.ok(biceps);
    assert.ok(Math.abs(biceps.share - 1) < 1e-9, `cuota del bíceps: ${biceps.share}`);
});

test('reparto · el residuo no se acumula a lo largo de 200 días', () => {
    // Repartir por porcentajes y redondear cada uno deja unos gramos de
    // diferencia que, sumados sobre todo el plan, producen una discrepancia
    // visible entre la gráfica global y la suma de las pequeñas.
    const projection = proyeccionReal();
    assert.ok(projection.daily.length > 100, 'el plan de prueba debería ser largo');
    const desagregada = projectByGroup({
        daily: projection.daily,
        stimulusByGroup: estimulo({ chest: 13, back: 17, quads: 11, glutes: 9, core: 7 })
    });
    const ultimo = projection.daily.length - 1;
    const suma = desagregada.groups.reduce((acc, g) => acc + g.daily[ultimo].muscleKg, 0);
    assert.ok(Math.abs(suma - projection.daily[ultimo].muscleKg) < 1e-9);
});

test('distributeExactly reparte sin perder ni inventar', () => {
    for (const amount of [0, 3.7, -1.25, 100]) {
        const out = distributeExactly(amount, ANATOMICAL_SHARE);
        const suma = Object.values(out).reduce((a, b) => a + b, 0);
        assert.ok(Math.abs(suma - amount) < 1e-12, `${amount} → ${suma}`);
        assert.equal(Object.keys(out).length, MUSCLE_GROUPS.length);
    }
});

// ============================================================
// escenarios_por_grupo
// ============================================================

test('escenarios_por_grupo · pesimista ≤ esperado ≤ optimista EN POSICIÓN DE PLAN', () => {
    // Igual que el invariante `escenarios` de la v1, y por el mismo motivo: los
    // escenarios se ordenan en POSICIÓN, no en magnitud. Un plan con fase de
    // definición hace que el músculo baje en algún tramo, y ahí ir «más
    // adelantado» significa tener MENOS. Exigir orden de magnitud sería exigir
    // que el músculo solo suba, que es justo lo que el motor no promete.
    const projection = proyeccionReal();
    const desagregada = projectByGroup({
        daily: projection.daily,
        stimulusByGroup: estimulo({ chest: 14, back: 16, quads: 12 })
    });
    const totalDays = projection.daily.length - 1;

    for (const g of desagregada.groups) {
        const niveles = g.daily.map((p) => p.muscleKg);
        const minimo = Math.min(...niveles);
        const maximo = Math.max(...niveles);

        for (const p of g.daily) {
            assert.ok(Number.isFinite(p.band.pessimistKg) && Number.isFinite(p.band.optimistKg),
                `${g.group} día ${p.dayIndex}: banda no finita`);

            // UN ESCENARIO NO PUEDE INVENTAR UN VALOR QUE EL PLAN NUNCA ALCANZA.
            // Es lo que garantiza recorrer la MISMA serie a otro ritmo, y lo que
            // se rompería si la banda se calculara escalando la ganancia final.
            for (const v of [p.band.pessimistKg, p.band.optimistKg]) {
                assert.ok(v >= minimo - 1e-9 && v <= maximo + 1e-9,
                    `${g.group} día ${p.dayIndex}: ${v} fuera de [${minimo}, ${maximo}]`);
            }

            // Y las posiciones sí están ordenadas, siempre.
            const t = p.dayIndex / totalDays;
            assert.ok(Math.pow(t, SCENARIO_PROGRESS_EXPONENTS.pessimist) <= t + 1e-12);
            assert.ok(t <= Math.pow(t, SCENARIO_PROGRESS_EXPONENTS.optimist) + 1e-12);
        }
    }
});

test('escenarios_por_grupo · en un plan que solo gana músculo, el orden TAMBIÉN es de magnitud', () => {
    // Cuando la serie del grupo es monótona creciente —volumen puro, sin fase de
    // definición— ir más adelantado sí es tener más. Es el caso que el usuario
    // ve casi siempre, y conviene que esté fijado.
    const projection = proyeccionReal();
    const desagregada = projectByGroup({
        daily: projection.daily, stimulusByGroup: estimulo({ chest: 14, quads: 14 })
    });
    for (const g of desagregada.groups) {
        const creciente = g.daily.every((p, i) => i === 0 || p.muscleKg >= g.daily[i - 1].muscleKg - 1e-12);
        if (!creciente) continue;
        for (const p of g.daily) {
            assert.ok(p.band.pessimistKg <= p.muscleKg + 1e-9, `${g.group} día ${p.dayIndex}`);
            assert.ok(p.muscleKg <= p.band.optimistKg + 1e-9, `${g.group} día ${p.dayIndex}`);
        }
    }
});

test('escenarios_por_grupo · los tres escenarios cierran donde cierra el grupo', () => {
    const projection = proyeccionReal();
    const desagregada = projectByGroup({
        daily: projection.daily,
        stimulusByGroup: estimulo({ chest: 14, quads: 14 })
    });
    for (const g of desagregada.groups) {
        const final = g.daily[g.daily.length - 1];
        // En el último día el progreso vale 1 en los tres exponentes, así que
        // los tres aterrizan en el mismo sitio — igual que el agregado (B5).
        assert.ok(Math.abs(final.band.pessimistKg - final.muscleKg) < 1e-9, g.group);
        assert.ok(Math.abs(final.band.optimistKg - final.muscleKg) < 1e-9, g.group);
    }
});

test('escenarios_por_grupo · usan los MISMOS exponentes que el global', () => {
    // Otra anchura de banda aquí haría que la rejilla contase una historia
    // distinta de la gráfica principal, sobre los mismos datos.
    const projection = proyeccionReal();
    const desagregada = projectByGroup({
        daily: projection.daily,
        stimulusByGroup: estimulo({ chest: 20 })
    });
    const chest = desagregada.groups.find((g) => g.group === 'chest');
    assert.ok(chest);
    const totalDays = chest.daily.length - 1;
    const mitad = Math.floor(chest.daily.length / 2);
    const p = chest.daily[mitad];
    const t = p.dayIndex / totalDays;

    // Un escenario es la serie esperada recorrida a otro ritmo, NO la ganancia
    // final escalada: escalarla daría por hecho que el músculo se gana de forma
    // lineal en el tiempo, y el motor lo modela con fases. Se rehace aquí la
    // interpolación a mano para no depender de la del módulo.
    const pos = totalDays * Math.pow(t, SCENARIO_PROGRESS_EXPONENTS.pessimist);
    const i0 = Math.floor(pos);
    const frac = pos - i0;
    const esperadoP = i0 >= totalDays
        ? chest.daily[totalDays].muscleKg
        : chest.daily[i0].muscleKg + (chest.daily[i0 + 1].muscleKg - chest.daily[i0].muscleKg) * frac;

    assert.ok(Math.abs(p.band.pessimistKg - esperadoP) < 1e-9,
        `${p.band.pessimistKg} frente a ${esperadoP}`);
});

// ============================================================
// mapeo_completo
// ============================================================

test('mapeo_completo · todo grupo fino del catálogo tiene entrada en el mapa', () => {
    // Sin esto los hitos por grupo se quedan huérfanos y la rejilla no sabe
    // dónde colgarlos.
    const finos = new Set();
    for (const item of CATALOG.items) if (item.muscleGroup) finos.add(item.muscleGroup);
    assert.ok(finos.size > 30, `solo ${finos.size} grupos finos; ¿cambió el catálogo?`);

    const huerfanos = [...finos].filter((f) => !Object.hasOwn(FINE_TO_COARSE, String(f)));
    assert.deepEqual(huerfanos, [], `sin mapear: ${huerfanos.join(', ')}`);
});

test('mapeo_completo · todo destino del mapa es un grupo grueso real, o null', () => {
    for (const [fino, grueso] of Object.entries(FINE_TO_COARSE)) {
        if (grueso === null) continue;
        assert.ok(MUSCLE_GROUPS.includes(grueso), `«${fino}» apunta a «${grueso}», que no existe`);
    }
});

test('mapeo_completo · lo que no tiene landmarks NO se mapea, y eso es a propósito', () => {
    // Proyectar ganancia sobre un músculo del que no conocemos su dosis mínima
    // efectiva sería inventarse la cifra.
    for (const fino of ['antebrazos', 'braquiorradial', 'aductores']) {
        assert.equal(coarseGroupOf(fino), null, `«${fino}» no debería mapear a ningún grupo`);
    }
    // Y lo que sí, sí.
    assert.equal(coarseGroupOf('dorsales'), 'back');
    assert.equal(coarseGroupOf('deltoides_posterior'), 'shoulders');
    assert.equal(coarseGroupOf('femorales'), 'hamstrings');
});

test('mapeo_completo · un grupo fino inventado devuelve null sin lanzar', () => {
    assert.equal(coarseGroupOf('musculo_inventado'), null);
    assert.equal(coarseGroupOf(''), null);
    assert.equal(coarseGroupOf(/** @type {*} */ (undefined)), null);
    // Y no se leen propiedades del prototipo como si fueran datos.
    assert.equal(coarseGroupOf('constructor'), null);
    assert.equal(coarseGroupOf('toString'), null);
});

// ============================================================
// estimulo_monotono
// ============================================================

test('estimulo_monotono · más volumen en un grupo → más ganancia proyectada en ÉL', () => {
    const projection = proyeccionReal();
    let anterior = -Infinity;
    for (const sets of [0, 4, 8, 12, 16, 20]) {
        const d = projectByGroup({
            daily: projection.daily,
            // Los demás grupos se mantienen fijos para aislar el efecto.
            stimulusByGroup: estimulo({ chest: sets, back: 10, quads: 10 })
        });
        const chest = d.groups.find((g) => g.group === 'chest');
        assert.ok(chest);
        assert.ok(chest.gainKg >= anterior - 1e-9,
            `con ${sets} series el pecho ganó ${chest.gainKg}, menos que con menos volumen`);
        anterior = chest.gainKg;
    }
});

test('estimulo_monotono · lo que gana uno lo deja de ganar otro: el total no cambia', () => {
    const projection = proyeccionReal();
    const total = (/** @type {*} */ d) => d.groups.reduce((/** @type {number} */ a, /** @type {*} */ g) => a + g.gainKg, 0);
    const equilibrado = projectByGroup({
        daily: projection.daily, stimulusByGroup: estimulo({ chest: 12, back: 12, quads: 12 })
    });
    const sesgado = projectByGroup({
        daily: projection.daily, stimulusByGroup: estimulo({ chest: 20, back: 4, quads: 4 })
    });
    // Es la consecuencia directa del cortafuegos: esto reparte un presupuesto,
    // no lo crea. Entrenar más pecho no da más músculo TOTAL del que el motor
    // proyectó; da más pecho y menos de lo demás.
    assert.ok(Math.abs(total(equilibrado) - total(sesgado)) < 1e-9);
});

test('estimulo_monotono · un grupo sin estímulo no gana nada', () => {
    const projection = proyeccionReal();
    const d = projectByGroup({
        daily: projection.daily, stimulusByGroup: estimulo({ chest: 14 })
    });
    const biceps = d.groups.find((g) => g.group === 'biceps');
    assert.ok(biceps);
    assert.ok(Math.abs(biceps.gainKg) < 1e-9, `el bíceps ganó ${biceps.gainKg} sin entrenarse`);
    // Pero SÍ tiene masa de partida: el músculo que ya tienes lo tienes.
    assert.ok(biceps.startKg > 0);
});

// ============================================================
// Honestidad de la presentación
// ============================================================

test('toda serie por grupo viaja marcada como ESTIMACIÓN', () => {
    const projection = proyeccionReal();
    const d = projectByGroup({ daily: projection.daily, stimulusByGroup: estimulo({ chest: 12 }) });
    assert.equal(d.estimated, true);
    // Nadie mide el músculo de su bíceps en casa. Presentarlo como dato
    // repetiría, a escala fina, el error que hundió la v4.0.
    for (const g of d.groups) assert.equal(g.estimated, true, g.group);
});

test('sin estímulo declarado se DICE, en vez de repartir a ciegas fingiendo saber', () => {
    const projection = proyeccionReal();
    const sin = projectByGroup({ daily: projection.daily });
    assert.equal(sin.stimulusKnown, false);
    // Y se cae al reparto anatómico, que es la suposición honesta.
    const chest = sin.groups.find((g) => g.group === 'chest');
    assert.ok(chest);
    assert.ok(Math.abs(chest.share - ANATOMICAL_SHARE.chest) < 1e-9);

    const con = projectByGroup({ daily: projection.daily, stimulusByGroup: estimulo({ chest: 12 }) });
    assert.equal(con.stimulusKnown, true);
});

test('el reparto anatómico suma exactamente 1', () => {
    const suma = Object.values(ANATOMICAL_SHARE).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(suma - 1) < 1e-9, `suma ${suma}`);
    // Y cubre los diez grupos, ni uno más ni uno menos.
    assert.deepEqual(Object.keys(ANATOMICAL_SHARE).sort(), [...MUSCLE_GROUPS].sort());
});

test('una proyección vacía no revienta', () => {
    const d = projectByGroup({ daily: [] });
    assert.deepEqual(d.groups, []);
    assert.equal(d.estimated, true);
    assert.equal(checkReparto(d, []).ok, true);
});

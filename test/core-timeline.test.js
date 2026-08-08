// @ts-check

/**
 * La línea de tiempo del proceso (E12-1).
 *
 * Lo que se prueba aquí, por orden de importancia:
 *
 *   1. Que la ventana de fechas **significa algo**. Es fácil escribir una
 *      fórmula que produzca dos números bonitos; el test que la ata al motor es
 *      el que impide que se convierta en decoración.
 *   2. Que el orden es determinista. Un orden que baila entre recargas es un
 *      defecto que solo se ve en el móvil de otra persona.
 *   3. Que nada se descarta en silencio — sobre todo las recalibraciones, que
 *      caen fuera del plan vigente por construcción.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTimeline, groupByPhase, windowFor } from '../src/core/timeline.js';
import { makeComposition, planPhases } from '../src/core/engine.js';
import { generateProjection } from '../src/core/generator.js';
import { SCENARIO_PROGRESS_EXPONENTS } from '../src/core/constants.js';

const PROFILE = {
    sex: /** @type {const} */ ('male'), age: 30, heightCm: 180,
    activityLevel: /** @type {const} */ ('moderate'),
    trainingStatus: /** @type {const} */ ('intermediate')
};

function fixture() {
    const comp = makeComposition({ weightKg: 81.2, fatPct: 26.5, sex: 'male' });
    assert.ok(comp.ok);
    const plan = planPhases(comp.value, { fatPct: 15, muscleKg: comp.value.muscleKg + 3.4 }, PROFILE);
    assert.ok(plan.ok, JSON.stringify(!plan.ok && plan.errors));
    const proj = generateProjection(plan.value, comp.value, PROFILE, {
        startDateISO: '2026-08-07', seed: 1, fluctuation: false
    });
    assert.ok(proj.ok);
    const daily = proj.value.daily;
    const dateAt = (/** @type {number} */ d) =>
        daily[Math.min(Math.max(Math.round(d), 0), daily.length - 1)].dateISO;
    return { projection: proj.value, plan: plan.value, dateAt, totalDays: plan.value.totalDays };
}

/* ---------------------------------------------------------------------- *
 * La ventana de fechas
 * ---------------------------------------------------------------------- */

test('la ventana contiene siempre al día esperado y está ordenada', () => {
    const { totalDays, dateAt } = fixture();
    for (let d = 0; d <= totalDays; d += 7) {
        const w = windowFor(d, totalDays, dateAt);
        assert.ok(w, `sin ventana en el día ${d}`);
        assert.ok(w.fromDay <= d && d <= w.toDay,
            `el día ${d} queda fuera de su propia ventana [${w.fromDay}, ${w.toDay}]`);
        assert.ok(w.fromDay >= 0 && w.toDay <= totalDays, `ventana fuera del plan en el día ${d}`);
    }
});

test('los tres escenarios coinciden en los extremos: ni antes de empezar ni al terminar hay margen', () => {
    const { totalDays, dateAt } = fixture();
    const inicio = windowFor(0, totalDays, dateAt);
    assert.deepEqual([inicio?.fromDay, inicio?.toDay], [0, 0]);
    const fin = windowFor(totalDays, totalDays, dateAt);
    assert.deepEqual([fin?.fromDay, fin?.toDay], [totalDays, totalDays]);
    // y por tanto NO se muestran como rango
    assert.equal(inicio?.meaningful, false);
    assert.equal(fin?.meaningful, false);
});

test('la ventana se estrecha al acercarse al objetivo, y deja de mostrarse como rango', () => {
    // Es la consecuencia honesta del modelo: los tres escenarios aterrizan el
    // mismo día. Cerca del final, enseñar «entre el 12 y el 14» sería fingir
    // una precisión que no existe.
    const { totalDays, dateAt } = fixture();
    const medio = windowFor(Math.round(totalDays / 2), totalDays, dateAt);
    const casiFinal = windowFor(totalDays - 2, totalDays, dateAt);
    assert.ok(medio && casiFinal);
    const anchoMedio = medio.toDay - medio.fromDay;
    const anchoFinal = casiFinal.toDay - casiFinal.fromDay;
    assert.ok(anchoMedio > anchoFinal, `${anchoMedio} no es mayor que ${anchoFinal}`);
    assert.equal(medio.meaningful, true, 'a mitad de plan la ventana sí es informativa');
    assert.equal(casiFinal.meaningful, false, 'a dos días del final no debe presentarse como rango');
});

test('PROPIEDAD: la ventana reproduce la banda que dibuja el motor', () => {
    // Éste es el test que impide que la ventana sea un número bonito sin
    // significado. Si `toDay` es el día en que el PESIMISTA llega a donde el
    // esperado está el día `d`, la banda de `toDay` tiene que CONTENER el peso
    // esperado de `d` — y la de `fromDay` (donde llega el optimista), también.
    //
    // «Contener» y no «valer»: desde E13-8 la banda es la ENVOLVENTE del peso
    // sobre el intervalo de posiciones entre los dos escenarios, así que en un
    // tramo no monótono el borde puede ser un pico intermedio y no la muestra
    // del extremo. La versión anterior de este test comparaba contra la muestra
    // del extremo, es decir, reimplementaba la fórmula vieja — que era
    // exactamente la defectuosa. La posición `d` sigue dentro del intervalo de
    // `toDay` por construcción, así que la contención es la propiedad exacta.
    const { projection, totalDays, dateAt } = fixture();
    const daily = projection.daily;
    let comprobados = 0;
    for (let d = 20; d <= totalDays - 20; d += 13) {
        const w = windowFor(d, totalDays, dateAt);
        assert.ok(w);
        const esperado = daily[d].weightKg;
        // tolerancia de un día de trayectoria: `windowFor` redondea hacia fuera
        const pasoDiario = Math.abs(daily[d].weightKg - daily[d + 1].weightKg) + 0.02;
        const margen = pasoDiario * 3;

        for (const [nombre, dia] of [['toDay', w.toDay], ['fromDay', w.fromDay]]) {
            const banda = daily[dia].band;
            const lo = Math.min(banda.pessimistKg, banda.optimistKg) - margen;
            const hi = Math.max(banda.pessimistKg, banda.optimistKg) + margen;
            assert.ok(esperado >= lo && esperado <= hi,
                `día ${d}: el esperado ${esperado.toFixed(3)} queda fuera de la banda de ${nombre}=${dia} [${lo.toFixed(3)}, ${hi.toFixed(3)}]`);
        }
        comprobados++;
    }
    assert.ok(comprobados > 10, `solo se comprobaron ${comprobados} puntos`);
});

test('windowFor degrada con entradas imposibles en vez de emitir NaN', () => {
    const dateAt = () => '2026-01-01';
    for (const [d, T] of [[NaN, 100], [10, NaN], [10, 0], [10, -5], [-1, 100], [101, 100]]) {
        assert.equal(windowFor(d, T, dateAt), null, `aceptó día=${d} total=${T}`);
    }
});

test('los exponentes usados son los del motor, no una copia', () => {
    // Si alguien cambia los escenarios en `constants.js`, la ventana debe
    // seguirlos. Se comprueba que la inversión usa esos mismos números.
    const T = 300, d = 150;
    const dateAt = (/** @type {number} */ x) => String(x);
    const w = windowFor(d, T, dateAt);
    assert.ok(w);
    const esperadoOptimista = Math.floor(T * Math.pow(d / T, 1 / SCENARIO_PROGRESS_EXPONENTS.optimist));
    const esperadoPesimista = Math.ceil(T * Math.pow(d / T, 1 / SCENARIO_PROGRESS_EXPONENTS.pessimist));
    assert.equal(w.fromDay, esperadoOptimista);
    assert.equal(w.toDay, esperadoPesimista);
});

/* ---------------------------------------------------------------------- *
 * La fusión de eventos
 * ---------------------------------------------------------------------- */

test('la línea de tiempo empieza por el principio y acaba por el final', () => {
    const { projection, plan } = fixture();
    const events = buildTimeline({ projection, plan, todayIndex: 0 });
    assert.equal(events[0].kind, 'planStart');
    assert.equal(events[events.length - 1].kind, 'planEnd');
    assert.equal(events[0].dayIndex, 0);
    assert.equal(events[events.length - 1].dayIndex, plan.totalDays);
});

test('el orden es determinista: por día y, dentro del día, por tipo', () => {
    const { projection, plan } = fixture();
    const events = buildTimeline({ projection, plan, todayIndex: 50 });
    for (let i = 1; i < events.length; i++) {
        assert.ok(events[i - 1].dayIndex <= events[i].dayIndex,
            `desordenado en ${i}: ${events[i - 1].dayIndex} > ${events[i].dayIndex}`);
    }
    // y dos construcciones seguidas dan exactamente la misma secuencia
    const otra = buildTimeline({ projection, plan, todayIndex: 50 });
    assert.deepEqual(events.map((e) => e.id), otra.map((e) => e.id));
});

test('cada fase aporta su evento, con sus calorías y el salto respecto a la anterior', () => {
    const { projection, plan } = fixture();
    const events = buildTimeline({ projection, plan, todayIndex: 0 });
    const fases = events.filter((e) => e.kind === 'phaseStart');
    assert.equal(fases.length, plan.phases.length);

    // la primera no tiene salto (no hay anterior); las demás sí
    assert.equal(fases[0].data.kcalDelta, null);
    for (const f of fases.slice(1)) {
        assert.ok(Number.isFinite(f.data.kcalDelta), `la fase ${f.data.phaseType} no trae salto de kcal`);
    }
    // y todas traen el objetivo calórico, que hoy no se enseña en ninguna parte
    for (const f of fases) {
        assert.ok(Number.isFinite(f.data.targetKcal), `la fase ${f.data.phaseType} no trae targetKcal`);
    }
});

test('los cruces de umbral llevan ventana; lo medido NO la lleva', () => {
    const { projection, plan } = fixture();
    const events = buildTimeline({
        projection, plan, todayIndex: 60,
        checkins: [{ checkinId: 'ci_1', dateISO: projection.daily[30].dateISO, dayIndex: 30, actualKg: 80, expectedKg: 79.5, deltaKg: 0.5, signal: 'within' }]
    });
    const umbral = events.find((e) => e.kind === 'threshold');
    assert.ok(umbral, 'no hay ningún cruce de umbral');
    assert.ok(umbral.window, 'un cruce proyectado sin ventana');

    const checkin = events.find((e) => e.kind === 'checkin');
    assert.ok(checkin);
    assert.equal(checkin.window, null, 'un check-in es una medición: no se proyecta');
    assert.equal(checkin.past, true);
});

test('el hito de umbral viaja entero, para que la interfaz no invente su propia etiqueta', () => {
    // Un segundo camino de etiquetado es literalmente el defecto HIT-* del
    // legacy: la vista tiene que poder pasarle el hito a `milestoneLabel()`.
    const { projection, plan } = fixture();
    const events = buildTimeline({ projection, plan, todayIndex: 0 });
    const umbral = events.find((e) => e.kind === 'threshold');
    assert.ok(umbral);
    assert.ok(umbral.data.milestone, 'no viaja el hito');
    assert.ok('category' in umbral.data.milestone && 'threshold' in umbral.data.milestone);
});

test('las fases NO se duplican como cruces de umbral', () => {
    const { projection, plan } = fixture();
    const events = buildTimeline({ projection, plan, todayIndex: 0 });
    const umbrales = events.filter((e) => e.kind === 'threshold');
    assert.ok(umbrales.every((e) => e.data.milestone.category !== 'phase'),
        'una fase se coló como cruce de umbral, y aparecería dos veces');
});

test('un hito estético que ya se cumplía el día 0 no entra: no es un logro', () => {
    const { projection, plan } = fixture();
    const events = buildTimeline({
        projection, plan, todayIndex: 0,
        aesthetic: [
            { id: 'ya_estaba', dayIndex: 0, dateISO: projection.daily[0].dateISO, fromStart: true },
            { id: 'de_verdad', dayIndex: 40, dateISO: projection.daily[40].dateISO, fromStart: false }
        ]
    });
    const ids = events.filter((e) => e.kind === 'aesthetic').map((e) => e.data.item.id);
    assert.deepEqual(ids, ['de_verdad']);
});

test('las recalibraciones caen fuera del plan y NO se descartan en silencio', () => {
    // `recalibrate` fija `startDateISO` a la fecha del check-in que la motivó,
    // así que lo archivado es SIEMPRE anterior al plan vigente.
    const { projection, plan } = fixture();
    const events = buildTimeline({
        projection, plan, todayIndex: 10,
        history: [{ archivedAtISO: '2026-06-01T10:00:00.000Z', reason: 'recalibration', plan: { totalDays: 200 } }]
    });
    const recal = events.find((e) => e.kind === 'recalibration');
    assert.ok(recal, 'la recalibración se ha perdido');
    assert.equal(recal.beforePlan, true);
    assert.equal(recal.past, true);
    assert.equal(recal.dateISO, '2026-06-01');
    assert.equal(recal.window, null);
    // y va la primera de todas
    assert.equal(events[0].kind, 'recalibration');
});

test('degrada con basura sin lanzar, como todo el núcleo', () => {
    for (const bad of [null, undefined, {}, 'x', 42, [],
        { projection: null, plan: null },
        { projection: { daily: [] }, plan: {} },
        { projection: { daily: null }, plan: { phases: [] } }]) {
        const r = buildTimeline(/** @type {*} */ (bad));
        assert.ok(Array.isArray(r), `no devolvió array con ${JSON.stringify(bad)}`);
    }
});

/* ---------------------------------------------------------------------- *
 * La agrupación por fase
 * ---------------------------------------------------------------------- */

test('agrupa por fase y no pierde ni un evento', () => {
    const { projection, plan, dateAt } = fixture();
    const events = buildTimeline({ projection, plan, todayIndex: 100 });
    const groups = groupByPhase(events, plan, 100, dateAt);

    assert.ok(groups.length >= 3 && groups.length <= 7,
        `${groups.length} grupos: la fase debe dar un puñado, no un calendario`);

    const enGrupos = groups.reduce((n, g) => n + g.events.length, 0);
    assert.equal(enGrupos, events.length, 'se han perdido o duplicado eventos al agrupar');

    // exactamente un grupo es el actual
    assert.equal(groups.filter((g) => g.current).length, 1);
    // y los anteriores a hoy están marcados como pasados
    const actual = groups.findIndex((g) => g.current);
    assert.ok(groups.slice(0, actual).every((g) => g.past));
});

test('las recalibraciones van a su propio grupo, delante de todo', () => {
    const { projection, plan, dateAt } = fixture();
    const events = buildTimeline({
        projection, plan, todayIndex: 10,
        history: [{ archivedAtISO: '2026-06-01T10:00:00.000Z', reason: 'recalibration' }]
    });
    const groups = groupByPhase(events, plan, 10, dateAt);
    assert.equal(groups[0].phaseType, 'beforePlan');
    assert.equal(groups[0].events.length, 1);
    assert.equal(groups[0].past, true);
    assert.equal(groups[0].current, false);
});

test('el evento de cierre del plan no se queda huérfano', () => {
    const { projection, plan, dateAt } = fixture();
    const events = buildTimeline({ projection, plan, todayIndex: 0 });
    const groups = groupByPhase(events, plan, 0, dateAt);
    const ultimo = groups[groups.length - 1];
    assert.ok(ultimo.events.some((e) => e.kind === 'planEnd'),
        'el final del plan no está en ningún grupo');
});

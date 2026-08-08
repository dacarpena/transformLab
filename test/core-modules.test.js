// @ts-check

/**
 * Invariantes de la integración (V2-M10).
 *
 * `plan_funcional_con_defaults` y `recalibracion_unica`. El tercero,
 * `preview_no_reconstruye`, vive en los E2E porque es sobre el foco del cursor y
 * eso solo se comprueba en un navegador de verdad.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    CONTROL_LEVELS, DEFAULT_CONTROL_LEVEL, MODULES, DEFAULT_ACTIVE, MODULE_DEFAULTS,
    moduleById, blocksFor, questionCount, withDefaults
} from '../src/core/modules.js';
import {
    LEVERS, SOURCE_PRIORITY, SUPERSEDES, coordinate, collectOffers
} from '../src/core/recalibration.js';
import { buildMenu } from '../src/core/menu.js';
import { splitIntoMeals } from '../src/core/nutrition.js';
import { stackFor } from '../src/core/supplements.js';
import { weeklyPlan } from '../src/core/training-plan.js';
import { dailyTarget } from '../src/core/steps.js';
import { todayRows, loopStatus } from '../src/core/integrated-plan.js';
import { readFileSync } from 'node:fs';

const BASE = JSON.parse(readFileSync(new URL('../vendor/data/foods.json', import.meta.url), 'utf8'));

// ============================================================
// plan_funcional_con_defaults
// ============================================================

test('plan_funcional_con_defaults · sin contestar NADA opcional, todos los módulos funcionan', () => {
    // Es el invariante que hace honesta la promesa de «cinco preguntas y un
    // plan»: saltarse los bloques no puede dejar el producto a medias.
    const prefs = withDefaults({});

    // 1 · El menú tiene solución con los defaults.
    const macros = { kcal: 2100, proteinG: 165, carbsG: 200, fatG: 58 };
    const split = splitIntoMeals(/** @type {*} */ ({ ...macros, warnings: [] }), prefs.mealsPerDay);
    assert.ok(split.ok);
    const menu = buildMenu({
        macros, mealTargets: split.value, foods: BASE.foods, preferences: /** @type {*} */ (prefs), seed: 7
    });
    assert.ok(menu.ok, menu.ok === false ? menu.error : '');
    assert.ok(menu.value.bands.within);

    // 2 · El stack de suplementos sale, y sin banderas marcadas por nosotros.
    const stack = stackFor({ phase: 'cut', safetyFlags: prefs.safetyFlags });
    assert.ok(stack.recommended.length > 0);

    // 3 · El plan de entreno reparte con el número de sesiones por defecto.
    const plan = weeklyPlan({
        report: { groups: [] }, trainingStatus: 'intermediate', sessionsPerWeek: prefs.sessionsPerWeek
    });
    assert.equal(plan.groups.length, 10);

    // 4 · Los pasos tienen objetivo.
    assert.ok(dailyTarget('moderate') > 0);
});

test('plan_funcional_con_defaults · ningún defecto es destructivo (H-013/D9)', () => {
    const prefs = withDefaults({});
    // Saltarse un bloque deja una suposición razonable, nunca un bloqueo.
    assert.deepEqual(prefs.hardExclusions, [], 'un veto por defecto recortaría el menú sin pedirlo');
    assert.deepEqual(prefs.softExclusions, []);
    assert.equal(prefs.dietType, 'omnivore', 'la dieta por defecto debe ser la que NO excluye nada');
    assert.ok(prefs.mealsPerDay >= 1);
    assert.ok(prefs.householdSize >= 1);
});

test('plan_funcional_con_defaults · NINGUNA bandera de seguridad viene marcada', () => {
    // Parece lo contrario de conservador y no lo es: marcar banderas que el
    // usuario no ha declarado le retiraría suplementos por una suposición
    // nuestra. El cribado protege cuando el usuario habla, no cuando callamos
    // por él.
    assert.deepEqual(MODULE_DEFAULTS.safetyFlags, []);
    const conDefaults = stackFor({ phase: 'cut', safetyFlags: withDefaults({}).safetyFlags });
    assert.equal(conDefaults.excludedBySafety.length, 0);
});

test('withDefaults respeta lo contestado y rellena lo demás', () => {
    const prefs = withDefaults({ mealsPerDay: 6, dietType: 'vegan' });
    assert.equal(prefs.mealsPerDay, 6);
    assert.equal(prefs.dietType, 'vegan');
    assert.equal(prefs.householdSize, MODULE_DEFAULTS.householdSize);
});

test('withDefaults no se traga un null como respuesta', () => {
    const prefs = withDefaults({ mealsPerDay: null, dietType: undefined });
    assert.equal(prefs.mealsPerDay, MODULE_DEFAULTS.mealsPerDay);
    assert.equal(prefs.dietType, MODULE_DEFAULTS.dietType);
});

test('withDefaults devuelve copias: nadie muta los arrays congelados', () => {
    const a = withDefaults({});
    a.hardExclusions.push('gluten');
    const b = withDefaults({});
    assert.deepEqual(b.hardExclusions, []);
});

// ============================================================
// El alta graduada
// ============================================================

test('el principiante ve pocas preguntas y el experto muchas', () => {
    // La promesa del producto, con un test detrás. Una promesa sin test es una
    // frase de marketing.
    const principiante = questionCount({ controlLevel: 'coached', activeModules: [] });
    const experto = questionCount({
        controlLevel: 'manual', activeModules: MODULES.map((m) => m.id)
    });
    assert.ok(principiante <= 8, `el principiante ve ${principiante} preguntas`);
    assert.ok(experto >= 18, `el experto solo ve ${experto}`);
    assert.ok(experto > principiante * 2);
});

test('el núcleo se pregunta SIEMPRE, en cualquier nivel', () => {
    for (const level of CONTROL_LEVELS) {
        const bloques = blocksFor({ controlLevel: level, activeModules: [] });
        assert.ok(bloques.some((b) => b.id === 'core'), `${level} se saltó el núcleo`);
    }
});

test('activar un módulo NO abre preguntas que el nivel existe para no hacer', () => {
    // Son dos condiciones distintas —el nivel lo muestra Y el usuario lo activa—
    // y confundirlas haría que `coached` acabara preguntando lo mismo que
    // `manual`.
    const conRecovery = blocksFor({ controlLevel: 'coached', activeModules: ['recovery'] });
    assert.ok(!conRecovery.some((b) => b.id === 'recovery'));

    const enManual = blocksFor({ controlLevel: 'manual', activeModules: ['recovery'] });
    assert.ok(enManual.some((b) => b.id === 'recovery'));
});

test('los dos módulos activos de fábrica son Nutrición y Entreno', () => {
    // Son lo que usa todo el que se crea un plan y ya existían en la v1; los
    // otros cuatro añaden preguntas para una minoría.
    assert.deepEqual([...DEFAULT_ACTIVE].sort(), ['core', 'nutrition', 'training']);
});

test('un nivel de control inventado cae al de por defecto sin romper', () => {
    const bloques = blocksFor({ controlLevel: 'ninja', activeModules: ['shopping'] });
    assert.ok(bloques.some((b) => b.id === 'core'));
    assert.equal(DEFAULT_CONTROL_LEVEL, 'collaborative');
    // Y `collaborative` sí muestra Compra, así que el módulo activado aparece.
    assert.ok(bloques.some((b) => b.id === 'shopping'));
});

test('cada módulo apunta a una vista y no hay ids repetidos', () => {
    const ids = MODULES.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const m of MODULES) {
        assert.ok(m.viewId, `${m.id} sin vista`);
        assert.ok(m.asks.length > 0, `${m.id} no pregunta nada`);
    }
    assert.equal(moduleById('nutrition')?.viewId, 'nutrition');
    assert.equal(moduleById('inventado'), null);
});

// ============================================================
// recalibracion_unica
// ============================================================

const OFERTA_GASTO = { source: 'measuredExpenditure', lever: 'calories', reasonKey: 'a' };
const OFERTA_PESO = { source: 'weightDeviation', lever: 'calories', reasonKey: 'b' };
const OFERTA_DELOAD = { source: 'trainingDeload', lever: 'volume', reasonKey: 'c' };

test('recalibracion_unica · nunca dos ofertas vivas sobre la misma palanca', () => {
    const r = coordinate([OFERTA_PESO, OFERTA_GASTO, OFERTA_DELOAD]);
    const vivas = [r.primary, ...r.deferred].filter(Boolean);
    const palancas = vivas.map((o) => /** @type {*} */ (o).lever);
    assert.equal(new Set(palancas).size, palancas.length,
        `dos ofertas sobre la misma palanca: ${palancas.join(', ')}`);
});

test('recalibracion_unica · el gasto MEDIDO desplaza a la desviación del peso', () => {
    // Las dos miran las calorías; el gasto medido se apoya en la ingesta Y en el
    // peso, dos señales frente a una. Enseñarlas juntas dejaría al usuario
    // arbitrando entre dos partes de su propia app.
    const r = coordinate([OFERTA_PESO, OFERTA_GASTO]);
    assert.equal(r.primary?.source, 'measuredExpenditure');
    assert.deepEqual(r.superseded.map((o) => o.source), ['weightDeviation']);
    assert.ok(!r.deferred.some((o) => o.source === 'weightDeviation'));
});

test('recalibracion_unica · lo desplazado se DEVUELVE, no se tira', () => {
    // La interfaz puede decir por qué no salió; callarlo haría que el usuario
    // descubriera el aviso una semana después sin entender nada.
    const r = coordinate([OFERTA_PESO, OFERTA_GASTO, OFERTA_DELOAD]);
    assert.equal(r.superseded.length, 1);
    assert.equal(r.deferred.length, 1);
    assert.equal(r.deferred[0].source, 'trainingDeload');
});

test('recalibracion_unica · como mucho UNA oferta principal', () => {
    for (const combinacion of [
        [OFERTA_PESO], [OFERTA_GASTO], [OFERTA_DELOAD],
        [OFERTA_PESO, OFERTA_DELOAD], [OFERTA_GASTO, OFERTA_DELOAD],
        [OFERTA_PESO, OFERTA_GASTO, OFERTA_DELOAD]
    ]) {
        const r = coordinate(/** @type {*} */ (combinacion));
        assert.ok(r.primary !== null, 'debería haber una oferta');
        assert.ok(!Array.isArray(r.primary));
    }
});

test('recalibracion_unica · sin nada que ofrecer, no se ofrece nada', () => {
    const r = coordinate([]);
    assert.equal(r.primary, null);
    assert.deepEqual(r.deferred, []);
    assert.deepEqual(r.superseded, []);
    assert.deepEqual(coordinate(/** @type {*} */ (null)).deferred, []);
});

test('recalibracion_unica · las calorías van antes que el volumen', () => {
    // Gobiernan el resultado que el usuario mira, y una descarga de
    // entrenamiento puede esperar una semana sin consecuencia.
    const r = coordinate([OFERTA_DELOAD, OFERTA_PESO]);
    assert.equal(r.primary?.lever, 'calories');
    assert.ok(SOURCE_PRIORITY.weightDeviation < SOURCE_PRIORITY.trainingDeload);
});

test('recalibracion_unica · una oferta con palanca inventada se descarta', () => {
    const r = coordinate(/** @type {*} */ ([{ source: 'x', lever: 'karma', reasonKey: 'y' }]));
    assert.equal(r.primary, null);
    assert.ok(LEVERS.every((l) => l !== 'karma'));
});

test('collectOffers no reimplementa ninguno de los tres umbrales', () => {
    // Cada fuente decide si tiene algo que decir; duplicar aquí el umbral
    // crearía una segunda verdad que se separaría de la primera al primer
    // ajuste.
    assert.deepEqual(collectOffers({}), []);
    assert.deepEqual(collectOffers({
        weightDeviation: { offer: false },
        measuredExpenditure: { offer: false },
        deload: { offer: false }
    }), []);

    const todas = collectOffers({
        weightDeviation: { offer: true },
        measuredExpenditure: { offer: true, reason: 'higher', gapKcal: 210 },
        deload: { offer: true, reasons: ['deload.lowRecovery'] }
    });
    assert.equal(todas.length, 3);
    assert.equal(todas.find((o) => o.source === 'measuredExpenditure')?.params?.gap, 210);
});

test('SUPERSEDES declara la regla de desempate, no la esconde en el código', () => {
    assert.deepEqual([...(SUPERSEDES.measuredExpenditure ?? [])], ['weightDeviation']);
    // Y nadie se desplaza a sí mismo.
    for (const [fuente, perdedoras] of Object.entries(SUPERSEDES)) {
        assert.ok(!perdedoras.includes(fuente), `${fuente} se desplaza a sí mismo`);
    }
});

// ============================================================
// El plan integral
// ============================================================

test('el bucle cierra: onboarding → plan → check-in + ingesta → recalibración', () => {
    // No es una métrica de vanidad: es lo que permite a «Hoy» decir qué falta en
    // vez de esperar en silencio catorce días a datos que nadie le está dando.
    assert.deepEqual(loopStatus({ hasPlan: true, checkinCount: 4, intakeDays: 20, minIntakeDays: 14 }),
        { closed: true, missing: [] });

    const sinNada = loopStatus({ hasPlan: false, checkinCount: 0, intakeDays: 0, minIntakeDays: 14 });
    assert.equal(sinNada.closed, false);
    assert.deepEqual(sinNada.missing, ['loop.noPlan', 'loop.noCheckins', 'loop.notEnoughIntake']);

    const casi = loopStatus({ hasPlan: true, checkinCount: 3, intakeDays: 13, minIntakeDays: 14 });
    assert.deepEqual(casi.missing, ['loop.notEnoughIntake']);
});

test('«Hoy» da UNA línea por módulo activo, no la vista entera', () => {
    // Meter el menú, la compra, el stack y la rejilla de volumen en la pantalla
    // de inicio la devolvería a ser el muro que E12 desmontó.
    const { rows, total } = todayRows({
        activeModules: ['nutrition', 'training'],
        nutrition: { kcal: 2100, proteinG: 165, menuReady: true },
        training: { belowMev: 3, sessionsLogged: 6 }
    });
    assert.equal(total, 2);
    assert.deepEqual(rows.map((r) => r.module), ['nutrition', 'training']);
    for (const row of rows) assert.ok(row.viewId, `${row.module} no lleva a ninguna vista`);
});

test('un módulo no activado NO aparece', () => {
    const { rows } = todayRows({ activeModules: ['nutrition'] });
    assert.deepEqual(rows.map((r) => r.module), ['nutrition']);
});

test('un módulo sin datos DICE qué le falta, ni se esconde ni finge un número', () => {
    // Esconderlo haría que el usuario no supiera que existe; fingir el número es
    // lo que hundió la v4.0.
    const { rows, readyCount } = todayRows({
        activeModules: ['nutrition', 'training', 'steps', 'supplements'],
        nutrition: null, training: { sessionsLogged: 0 }, steps: { declared: false },
        supplements: { count: 5, safetyDeclared: false }
    });
    assert.equal(readyCount, 0);
    for (const row of rows) {
        assert.equal(row.state, 'needsInput', row.module);
        assert.ok(row.actionKey, `${row.module} no ofrece salida`);
        assert.ok(row.labelKey, `${row.module} no dice qué le falta`);
    }
});

test('el stack sin banderas declaradas NO se da por listo', () => {
    // Se puede calcular, pero no está cribado por la salud de nadie.
    const conCribado = todayRows({
        activeModules: ['supplements'], supplements: { count: 6, safetyDeclared: true }
    });
    assert.equal(conCribado.rows[0].state, 'ready');
    const sinCribado = todayRows({
        activeModules: ['supplements'], supplements: { count: 6, safetyDeclared: false }
    });
    assert.equal(sinCribado.rows[0].state, 'needsInput');
});

test('un grupo por debajo del MEV es información, no un error del módulo', () => {
    const { rows } = todayRows({
        activeModules: ['training'], training: { belowMev: 4, sessionsLogged: 9 }
    });
    assert.equal(rows[0].state, 'ready');
    assert.equal(rows[0].labelKey, 'plan.row.trainingBelowMev');
    assert.equal(rows[0].params?.n, 4);
});

test('todas las filas llevan a la vista del módulo que las produce', () => {
    const { rows } = todayRows({
        activeModules: ['nutrition', 'training', 'shopping', 'supplements', 'steps', 'recovery'],
        nutrition: { kcal: 2000, menuReady: true },
        training: { sessionsLogged: 3, belowMev: 0 },
        shopping: { toBuyLines: 12 },
        supplements: { count: 5, safetyDeclared: true },
        steps: { declared: true, meanSteps: 9000, targetSteps: 8500 },
        recovery: { declared: true, score: 0.7 }
    });
    assert.equal(rows.length, 6);
    for (const row of rows) {
        assert.equal(row.viewId, MODULES.find((m) => m.id === row.module)?.viewId, row.module);
    }
});

test('todayRows no revienta con un estado vacío', () => {
    assert.deepEqual(todayRows(/** @type {*} */ ({})), { rows: [], readyCount: 0, total: 0 });
    assert.deepEqual(todayRows(/** @type {*} */ (null)).rows, []);
});

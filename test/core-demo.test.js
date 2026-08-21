// @ts-check

/**
 * El perfil de ejemplo (E15-10).
 *
 * La ficha H-035 del catálogo nació de un botón «Hoy» del legacy que navegaba al
 * punto medio del plan «para que la demo quedara bonita». La regla que salió de
 * ahí gobierna este módulo: **lo simulado no puede ser confundible con lo real, y
 * no puede estar dibujado a mano.** Estos tests comprueban las dos mitades.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildDemo, DEMO_PROFILE, DEMO_DAYS_ELAPSED } from '../src/core/demo.js';
import { validateCollection } from '../src/data/schema.js';
import { makeComposition, planPhases } from '../src/core/engine.js';
import { generateProjection } from '../src/core/generator.js';
import { LIMITS } from '../src/core/ranges.js';
import { isICloudDuplicate } from './helpers/tree.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CTX = { todayISO: '2026-08-21', nowISO: '2026-08-21T10:00:00.000Z' };

const build = (/** @type {*} */ ctx = CTX) => {
    const r = buildDemo(ctx);
    assert.ok(r.ok, `buildDemo falló: ${r.ok ? '' : r.error}`);
    return r.value;
};

test('todas las colecciones que genera VALIDAN contra el esquema', () => {
    // Si no validaran, el ejemplo entraría al almacén y la aplicación lo
    // descartaría al releerlo: un perfil que se instala y sale vacío.
    const value = build();
    for (const [nombre, coleccion] of Object.entries(value)) {
        const r = validateCollection(nombre, coleccion);
        assert.ok(r.ok, `la colección ${nombre} no valida: ${JSON.stringify(r.ok ? [] : r.errors?.slice(0, 2))}`);
    }
});

test('es DETERMINISTA: dos instalaciones producen exactamente lo mismo', () => {
    // Que la semilla sea fija es el contrato: un fallo que alguien vea en su
    // ejemplo se puede reproducir aquí, exactamente.
    assert.deepEqual(build(), build());
});

test('los check-ins salen de la proyección del MOTOR, no dibujados a mano', () => {
    // Se rehace el mismo cálculo por fuera y se comprueba que cada peso medido
    // cae junto al proyectado de ese día. Si alguien sustituyera esto por una
    // lista escrita a mano «para que quede bonito», este test se cae.
    const value = build();
    const startDateISO = value.profile.startDateISO;

    const composition = makeComposition({
        weightKg: DEMO_PROFILE.initial.weightKg,
        fatPct: DEMO_PROFILE.initial.fatPct,
        muscleKg: null,
        muscleSource: 'estimated',
        sex: DEMO_PROFILE.user.sex
    });
    assert.ok(composition.ok);
    const plan = planPhases(composition.value, DEMO_PROFILE.target, DEMO_PROFILE.user,
        { intensity: DEMO_PROFILE.intensity });
    assert.ok(plan.ok);
    const proj = generateProjection(plan.value, composition.value, DEMO_PROFILE.user,
        { startDateISO, seed: 1, fluctuation: false });
    assert.ok(proj.ok);

    /** @type {Map<string, number>} */ const porFecha = new Map();
    for (const d of proj.value.daily) porFecha.set(d.dateISO, d.weightKg);

    assert.ok(value.checkins.items.length >= 10, 'un ejemplo con cuatro check-ins no enseña nada');
    for (const c of value.checkins.items) {
        const esperado = porFecha.get(c.dateISO);
        assert.ok(esperado !== undefined, `el check-in ${c.dateISO} cae fuera del plan`);
        assert.ok(Math.abs(c.weightKg - esperado) < 0.6,
            `${c.dateISO}: ${c.weightKg} kg está lejos de los ${esperado.toFixed(2)} proyectados`);
    }
});

test('el objetivo del ejemplo GANA músculo de verdad', () => {
    // Un ejemplo con el objetivo degenerado enseñaría el defecto que E15-2 vino
    // a cerrar en vez del producto.
    const value = build();
    const delta = value.profile.target.muscleKg - value.profile.initial.muscleKg;
    assert.ok(delta > LIMITS.targetMuscleGain.noGainKg,
        `el ejemplo solo gana ${delta.toFixed(3)} kg de músculo`);
});

test('el ejemplo enseña una adherencia REAL, no un cien por cien', () => {
    // Nadie apunta ciento diecinueve días seguidos. Un ejemplo perfecto enseña
    // una aplicación que no existe y pone un listón que desanima.
    const value = build();
    const dias = DEMO_DAYS_ELAPSED + 1;
    assert.ok(value.intakeLog.items.length < dias, 'la ingesta está apuntada TODOS los días');
    assert.ok(value.intakeLog.items.length > dias * 0.5, 'hay tan pocos días de ingesta que no se ve nada');
    assert.ok(value.steps.items.length < dias);
    assert.ok(value.steps.items.length > dias * 0.5);
});

test('todas las fechas caen dentro del plan y ninguna es futura', () => {
    const value = build();
    const start = value.profile.startDateISO;
    const fechas = [
        ...value.checkins.items.map((/** @type {*} */ c) => c.dateISO),
        ...value.intakeLog.items.map((/** @type {*} */ i) => i.dateISO),
        ...value.steps.items.map((/** @type {*} */ s) => s.dateISO),
        ...value.training.sessions.map((/** @type {*} */ s) => s.dateISO)
    ];
    assert.ok(fechas.length > 100);
    for (const f of fechas) {
        assert.ok(f >= start, `${f} es anterior al inicio del plan (${start})`);
        assert.ok(f <= CTX.todayISO, `${f} está en el futuro`);
    }
});

test('no hay dos registros del mismo día en ninguna colección', () => {
    const value = build();
    for (const [nombre, items] of /** @type {[string, *[]][]} */ ([
        ['checkins', value.checkins.items],
        ['intakeLog', value.intakeLog.items],
        ['steps', value.steps.items],
        ['sessions', value.training.sessions]
    ])) {
        const fechas = items.map((/** @type {*} */ i) => i.dateISO);
        assert.equal(new Set(fechas).size, fechas.length, `${nombre} tiene fechas repetidas`);
    }
});

test('buildDemo NUNCA lanza, y devuelve error con un contexto malo', () => {
    for (const malo of [null, undefined, {}, { todayISO: 'ayer', nowISO: 'x' }, { todayISO: '2026-08-21' }]) {
        const r = buildDemo(/** @type {*} */ (malo));
        assert.equal(typeof r.ok, 'boolean');
        if (r.ok === false) assert.equal(typeof r.error, 'string');
    }
});

test('nadie fuera del ejemplo conoce el id `demo`', () => {
    // La garantía de que el ejemplo no contamina los datos reales es de
    // NAMESPACE: `storage.js` inyecta `tl.<v>.<profileId>.`. Esa garantía se cae
    // en cuanto alguien empieza a comparar contra el id por su cuenta, así que
    // el id vive en un solo módulo y aquí se comprueba que sigue así.
    /** @type {string[]} */ const infractores = [];
    const walk = (/** @type {string} */ current) => {
        for (const entry of readdirSync(current, { withFileTypes: true })) {
            if (isICloudDuplicate(entry.name)) continue;
            const full = join(current, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!entry.name.endsWith('.js')) continue;
            if (entry.name === 'demo-profile.js') continue;   // es su casa
            const code = readFileSync(full, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, ' ')
                .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
            if (/['"`]demo['"`]/.test(code)) infractores.push(entry.name);
        }
    };
    walk(join(ROOT, 'src'));
    assert.deepEqual(infractores, [],
        `estos módulos escriben el id 'demo' a mano en vez de preguntar a demo-profile.js: ${infractores.join(', ')}`);
});

// @ts-check

/**
 * La aduana entre las dos unidades de músculo (E11).
 *
 * Lo que se prueba aquí es la frontera, no el motor: que un perfil con cifras
 * de báscula traduce, que uno sin ellas no toca nada, y que el objetivo real
 * que bloqueaba la app produce un plan cerrado en la unidad correcta.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { muscleUnitsFor, muscleUnitsOf, isScaleProfile } from '../src/ui/muscle-units.js';
import { fromBioimpedance } from '../src/core/scale.js';
import { makeComposition, planPhases } from '../src/core/engine.js';
import { generateProjection } from '../src/core/generator.js';
import { setLocale } from '../src/i18n/i18n.js';

const XIAOMI = { weightKg: 81.20, fatPct: 26.5, muscleKg: 56.56, boneKg: 3.12, sex: /** @type {const} */ ('male') };

const PROFILE_USER = {
    sex: /** @type {const} */ ('male'), age: 30, heightCm: 180,
    activityLevel: /** @type {const} */ ('moderate'),
    trainingStatus: /** @type {const} */ ('intermediate')
};

/** El `initial` que el onboarding persiste para una lectura de báscula. */
function scaleInitial() {
    const r = fromBioimpedance(XIAOMI);
    assert.ok(r.ok);
    return {
        weightKg: r.value.weightKg,
        fatPct: r.value.fatPct,
        muscleKg: r.value.skeletalMuscleKg,
        muscleSource: /** @type {const} */ ('derived'),
        scaleMuscleKg: r.value.scaleMuscleKg,
        boneKg: r.value.boneKg
    };
}

test('un perfil sin báscula no traduce nada: la identidad, como antes de E11', () => {
    for (const initial of [
        null, undefined, {},
        { muscleKg: 30, muscleSource: 'estimated', scaleMuscleKg: null, boneKg: null },
        { muscleKg: 33, muscleSource: 'measured', scaleMuscleKg: null, boneKg: null }
    ]) {
        const u = muscleUnitsFor(/** @type {*} */ (initial));
        assert.equal(u.isScale, false, JSON.stringify(initial));
        assert.equal(u.offsetKg, 0);
        assert.equal(u.toDisplay(29.24), 29.24);
        assert.equal(u.fromInput(31), 31);
        assert.equal(u.secondary(29.24), '', 'sin báscula no hay nota secundaria que enseñar');
    }
});

test('un perfil de báscula traduce, y la vuelta es exacta', () => {
    const u = muscleUnitsFor(scaleInitial());
    assert.equal(u.isScale, true);
    assert.ok(Math.abs(u.offsetKg - 27.32) < 0.02, `offset ${u.offsetKg}`);

    // lo que el usuario ve de su estado actual es LO QUE MARCA SU BÁSCULA
    assert.ok(Math.abs(u.toDisplay(scaleInitial().muscleKg) - 56.56) < 1e-9);
    for (const kg of [29.24, 32.68, 40]) {
        assert.ok(Math.abs(u.fromInput(u.toDisplay(kg)) - kg) < 1e-9);
    }
});

test('la nota secundaria dice la cifra esquelética, y solo cuando hay báscula', () => {
    setLocale('es');
    const u = muscleUnitsFor(scaleInitial());
    const nota = u.secondary(29.2432);
    assert.ok(nota.includes('29,2') || nota.includes('29.2'), nota);
    assert.ok(!nota.includes('{'), `quedó un placeholder sin interpolar: ${nota}`);
    // y la etiqueta cambia, para que nadie confunda las dos cifras
    assert.notEqual(u.label(), muscleUnitsFor(null).label());
});

test('muscleUnitsOf lee del bundle sin explotar si aún no hay perfil', () => {
    assert.equal(muscleUnitsOf(null).isScale, false);
    assert.equal(muscleUnitsOf(/** @type {*} */ ({})).isScale, false);
    assert.equal(muscleUnitsOf(/** @type {*} */ ({ profile: {} })).isScale, false);
    assert.equal(muscleUnitsOf(/** @type {*} */ ({ profile: { initial: scaleInitial() } })).isScale, true);
});

test('el caso real: escribir 60 produce un plan cerrado que aterriza en 60,0 de báscula', () => {
    // Esto es exactamente lo que el usuario intentó hacer y la app rechazó.
    const initial = scaleInitial();
    const u = muscleUnitsFor(initial);

    const targetSkeletal = u.fromInput(60);
    const comp = makeComposition({
        weightKg: initial.weightKg, fatPct: initial.fatPct,
        muscleKg: initial.muscleKg, muscleSource: 'derived', sex: 'male'
    });
    assert.ok(comp.ok, JSON.stringify(!comp.ok && comp.errors));

    const plan = planPhases(comp.value, { fatPct: 15, muscleKg: targetSkeletal }, PROFILE_USER);
    assert.ok(plan.ok, `el objetivo del usuario sigue siendo rechazado: ${JSON.stringify(!plan.ok && plan.errors)}`);

    const proj = generateProjection(plan.value, comp.value, PROFILE_USER, {
        startDateISO: '2026-08-03', seed: 1, fluctuation: false
    });
    assert.ok(proj.ok, JSON.stringify(!proj.ok && proj.errors));

    // el último día, en la unidad del usuario, es su objetivo
    const ultimo = proj.value.daily[proj.value.daily.length - 1];
    assert.ok(Math.abs(u.toDisplay(ultimo.muscleKg) - 60) < 0.05,
        `el plan no cierra en 60 de báscula: ${u.toDisplay(ultimo.muscleKg)}`);

    // y el primero es lo que marcó su báscula
    assert.ok(Math.abs(u.toDisplay(proj.value.daily[0].muscleKg) - 56.56) < 0.05);

    // un plan de meses, no de años: la ganancia real son ~3,4 kg
    assert.ok(plan.value.totalDays > 200 && plan.value.totalDays < 500,
        `duración inesperada: ${plan.value.totalDays} días`);
});

/* ---------------------------------------------------------------------- *
 * Hallazgos del ataque adversarial a E11, cada uno con su test
 * ---------------------------------------------------------------------- */

test('un perfil a medias (báscula sin hueso) NO se trata como de báscula', () => {
    // El esquema permite `scaleMuscleKg` y `boneKg` de forma independiente, así
    // que un backup importado puede traer solo uno. Cuando el predicado estaba
    // escrito en tres sitios distintos, ese perfil traducía en el dashboard,
    // se degradaba a «medido» en el asistente y comparaba unidades cruzadas en
    // Progreso. Una sola respuesta a la pregunta, y es «no».
    const aMedias = { scaleMuscleKg: 56.56, muscleKg: 29.2432, boneKg: null };
    assert.equal(isScaleProfile(aMedias), false);
    assert.equal(muscleUnitsFor(aMedias).isScale, false);
    assert.equal(muscleUnitsFor(aMedias).toDisplay(29.2432), 29.2432);
    // con las tres cifras, sí
    assert.equal(isScaleProfile({ ...aMedias, boneKg: 3.12 }), true);
});

test('una proporción imposible entre las dos cifras no se traduce: se deja de traducir', () => {
    // Vector real: un backup importado que declara 199 kg de músculo junto a
    // 29,24 haría que toda la interfaz tradujera con un offset de 170 kg.
    // Fuera de rango no se corrige nada — se muestra el esquelético, que es
    // siempre una cifra honesta (B9: avisar o abstenerse, nunca inventar).
    for (const scaleMuscleKg of [199, 120, 31]) {
        const u = muscleUnitsFor({ scaleMuscleKg, muscleKg: 29.2432, boneKg: 3.12 });
        assert.equal(u.isScale, false, `aceptó una proporción de ${(scaleMuscleKg / 29.2432).toFixed(1)}×`);
    }
    // y las proporciones reales de ambos sexos siguen pasando
    for (const [scale, smm] of [[56.56, 29.2432], [40.9, 19.096]]) {
        assert.equal(muscleUnitsFor({ scaleMuscleKg: scale, muscleKg: smm, boneKg: 3 }).isScale, true,
            `rechazó una lectura real: ${scale}/${smm} = ${(scale / smm).toFixed(2)}×`);
    }
});

test('el objetivo tecleado conserva su CANTIDAD al cambiar de unidad, no su número', () => {
    // Reproduce lo que hace el asistente: se teclea 33 sin báscula (esquelético)
    // y luego se añaden las cifras de una Xiaomi. Si el número se releyera como
    // kilos de báscula, 33 pasarían a ser 5,7 esqueléticos y la app avisaría de
    // que el objetivo implica perder 23 kg de músculo.
    const reexpresar = (valor, offsetTecleado, offsetActual) =>
        Math.round((valor - offsetTecleado + offsetActual) * 10) / 10;

    assert.equal(reexpresar(33, 0, 27.32), 60.3);          // esquelético → báscula
    assert.equal(reexpresar(60, 27.32, 0), 32.7);          // báscula → esquelético
    assert.equal(reexpresar(60, 27.32, 27.32), 60);        // sin cambio de unidad, intacto
    // y es idempotente: re-expresar dos veces desde el par guardado no acumula
    assert.equal(reexpresar(reexpresar(33, 0, 27.32), 27.32, 27.32), 60.3);
});

test('recalibrar conserva el offset EXACTO y no tira el músculo ya ganado', () => {
    // El defecto que encontró el ataque: recalibrar re-estimaba el músculo con
    // la proporción de POBLACIÓN (0,49 × magra), que es transversal, mientras
    // que el motor usa el modelo LONGITUDINAL contrario. Resultado en el día
    // 300: 1,67 kg de ganancia tirados, el offset saltando de 27,32 a 28,99 y
    // un registro que ya no cuadraba consigo mismo.
    const initial = scaleInitial();
    const offset = muscleUnitsFor(initial).offsetKg;
    const boneKg = initial.boneKg;

    const comp = makeComposition({
        weightKg: initial.weightKg, fatPct: initial.fatPct,
        muscleKg: initial.muscleKg, muscleSource: 'derived', sex: 'male'
    });
    assert.ok(comp.ok);
    const plan = planPhases(comp.value, { fatPct: 15, muscleKg: 60 - offset }, PROFILE_USER);
    assert.ok(plan.ok);
    const proj = generateProjection(plan.value, comp.value, PROFILE_USER, { startDateISO: '2026-08-03', seed: 1, fluctuation: false });
    assert.ok(proj.ok);

    // lo que hace `recalibrate.applyRecalibration` en el día 300
    const d = proj.value.daily[300];
    const fatPct = Math.round(d.fatPct * 10) / 10;
    const leanKg = d.weightKg * (1 - fatPct / 100);
    const nextScale = Math.round((leanKg - boneKg) * 100) / 100;
    const nextMuscle = nextScale - offset;

    const despues = muscleUnitsFor({ scaleMuscleKg: nextScale, muscleKg: nextMuscle, boneKg });
    assert.ok(despues.isScale, 'la recalibración perdió la unidad del usuario');
    assert.ok(Math.abs(despues.offsetKg - offset) < 1e-9,
        `el offset derivó de ${offset} a ${despues.offsetKg}`);

    // no se tira la ganancia: el músculo recalibrado sigue al proyectado
    assert.ok(Math.abs(nextMuscle - d.muscleKg) < 0.05,
        `se perdieron ${(d.muscleKg - nextMuscle).toFixed(2)} kg de músculo ya ganado`);

    // y el registro resultante cuadra consigo mismo: si no, al reeditar el
    // perfil la app rechazaría sus propios datos
    const cruce = fromBioimpedance({ weightKg: d.weightKg, fatPct, muscleKg: nextScale, boneKg, sex: 'male' });
    assert.ok(cruce.ok, `el perfil recalibrado no pasa su propio cruce: ${JSON.stringify(!cruce.ok && cruce.errors)}`);

    // el objetivo del usuario sigue siendo el mismo número en pantalla
    assert.equal(despues.toDisplay(60 - offset).toFixed(1), '60.0');
});

test('el incremento es el mismo en las dos unidades a lo largo de todo el plan', () => {
    // La propiedad que permite NO tocar hitos, tasas ni mensajes «ganar X kg».
    const initial = scaleInitial();
    const u = muscleUnitsFor(initial);
    const comp = makeComposition({
        weightKg: initial.weightKg, fatPct: initial.fatPct,
        muscleKg: initial.muscleKg, muscleSource: 'derived', sex: 'male'
    });
    assert.ok(comp.ok);
    const plan = planPhases(comp.value, { fatPct: 15, muscleKg: u.fromInput(60) }, PROFILE_USER);
    assert.ok(plan.ok);
    const proj = generateProjection(plan.value, comp.value, PROFILE_USER, {
        startDateISO: '2026-08-03', seed: 1, fluctuation: false
    });
    assert.ok(proj.ok);

    const base = proj.value.daily[0];
    for (const day of proj.value.daily) {
        const deltaSmm = day.muscleKg - base.muscleKg;
        const deltaScale = u.toDisplay(day.muscleKg) - u.toDisplay(base.muscleKg);
        assert.ok(Math.abs(deltaSmm - deltaScale) < 1e-9, `día ${day.dateISO}: ${deltaSmm} vs ${deltaScale}`);
    }
});

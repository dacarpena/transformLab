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
import { muscleUnitsFor, muscleUnitsOf } from '../src/ui/muscle-units.js';
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

test('recalibrar conserva el offset, así que el objetivo del usuario no se mueve', () => {
    // Reproduce lo que hace `recalibrate.applyRecalibration`: el peso real
    // cambia, la composición se vuelve a derivar y la cifra de báscula se
    // recalcula CONSERVANDO el offset. Lo que no puede pasar es que el
    // objetivo que el usuario se fijó (60) aparezca de pronto como 59,8.
    const initial = scaleInitial();
    const antes = muscleUnitsFor(initial);
    const objetivoEscrito = 60;
    const objetivoEsqueletico = antes.fromInput(objetivoEscrito);

    // una semana peor de lo previsto: pesa 1,5 kg más, todo atribuido a grasa
    const nuevoPeso = initial.weightKg + 1.5;
    const nuevaComp = makeComposition({
        weightKg: nuevoPeso,
        fatPct: ((nuevoPeso - (initial.weightKg - initial.weightKg * initial.fatPct / 100)) / nuevoPeso) * 100,
        sex: 'male'
    });
    assert.ok(nuevaComp.ok, JSON.stringify(!nuevaComp.ok && nuevaComp.errors));

    const nuevaEscala = Math.round((nuevaComp.value.muscleKg + antes.offsetKg) * 100) / 100;
    const despues = muscleUnitsFor({ scaleMuscleKg: nuevaEscala, muscleKg: nuevaComp.value.muscleKg });

    assert.ok(despues.isScale, 'la recalibración ha perdido la unidad del usuario');
    assert.ok(Math.abs(despues.offsetKg - antes.offsetKg) < 0.01,
        `el offset se movió de ${antes.offsetKg} a ${despues.offsetKg}`);
    // y el objetivo, visto desde la unidad nueva, sigue siendo el mismo número
    assert.equal(despues.toDisplay(objetivoEsqueletico).toFixed(1), objetivoEscrito.toFixed(1));
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

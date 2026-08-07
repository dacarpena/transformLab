// @ts-check

/**
 * Lectura de báscula de bioimpedancia doméstica (E10).
 *
 * El problema que resuelve: una Xiaomi (y una Huawei, y una Withings) llama
 * «masa muscular» a `peso − grasa − hueso`, que NO es músculo esquelético. Con
 * 81,20 kg y 26,5 % de grasa da 56,56 kg, el 94,8 % de la masa magra; el motor
 * usa músculo esquelético (Janssen 2000, ~49 % de la magra), que serían 29,24 kg.
 * Dos cantidades con el mismo nombre — exactamente la clase de defecto que
 * mató a la v4.0 (`docs/AUDITORIA.md` §1).
 *
 * Aquí NO se mezclan: se acepta la lectura tal cual la da la báscula, se
 * comprueba que sus tres cifras cuadran entre sí, y de ahí se DERIVA la
 * composición del motor. El origen queda marcado como derivado, ni medido ni
 * estimado.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    fromBioimpedance,
    BONE_SHARE_OF_LEAN,
    muscleOffsetKg,
    toScaleMuscle,
    toSkeletalMuscle
} from '../src/core/scale.js';
import { makeComposition } from '../src/core/engine.js';
import { SMM_OF_LEAN_RATIO } from '../src/core/constants.js';
import { planPhases } from '../src/core/engine.js';
import { generateProjection } from '../src/core/generator.js';
import { checkTarget } from '../src/core/ranges.js';

/** La lectura real que motivó esto: Xiaomi miScale, varón. */
const XIAOMI = { weightKg: 81.20, fatPct: 26.5, muscleKg: 56.56, boneKg: 3.12, sex: /** @type {const} */ ('male') };

test('la lectura real de una Xiaomi se acepta y cuadra consigo misma', () => {
    const r = fromBioimpedance(XIAOMI);
    assert.ok(r.ok, `rechazada: ${JSON.stringify(r.ok ? null : r.errors)}`);

    // magra = músculo + hueso, que es como descompone el peso la báscula
    assert.ok(Math.abs(r.value.leanKg - (XIAOMI.muscleKg + XIAOMI.boneKg)) < 1e-9);
    // y coincide con peso − grasa, que es de donde parte el motor
    assert.ok(Math.abs(r.value.leanKg - XIAOMI.weightKg * (1 - XIAOMI.fatPct / 100)) < 0.02);

    // el músculo del motor es esquelético: ni de lejos el de la báscula
    assert.ok(r.value.skeletalMuscleKg > 25 && r.value.skeletalMuscleKg < 33,
        `músculo esquelético implausible: ${r.value.skeletalMuscleKg}`);
    assert.ok(r.value.skeletalMuscleKg < XIAOMI.muscleKg / 1.5,
        'se está confundiendo el músculo de la báscula con el esquelético');
});

test('la composición derivada es la MISMA que la estimada: la báscula no inventa músculo', () => {
    // Es la consecuencia honesta de la decisión: la «masa muscular» de una
    // báscula doméstica es ~95 % de la magra, así que no aporta información
    // independiente sobre el músculo esquelético. Lo que sí aporta es la
    // comprobación cruzada del %grasa. Si algún día esto dejara de cumplirse,
    // sería que alguien metió el dato de la báscula en el motor.
    const r = fromBioimpedance(XIAOMI);
    assert.ok(r.ok);
    const estimada = makeComposition({ weightKg: XIAOMI.weightKg, fatPct: r.value.fatPct, sex: 'male' });
    assert.ok(estimada.ok);
    assert.ok(Math.abs(r.value.skeletalMuscleKg - estimada.value.muscleKg) < 1e-9);
});

test('la comprobación cruzada detecta una cifra mal tecleada', () => {
    // Un dedo torpe: 65,56 en vez de 56,56. Los tres números dejan de cuadrar.
    const r = fromBioimpedance({ ...XIAOMI, muscleKg: 65.56 });
    assert.ok(!r.ok, 'debería avisar de que las cifras no cuadran');
    assert.ok(r.errors.some((e) => e.code === 'scale.mismatch'), JSON.stringify(r.errors));
});

test('un desajuste pequeño por redondeo NO se rechaza', () => {
    // Las básculas redondean a 0,1 kg y el %grasa a 0,1: el cuadre nunca es
    // exacto. Rechazar por 200 gramos sería inutilizable.
    for (const delta of [-0.2, -0.1, 0, 0.1, 0.2]) {
        const r = fromBioimpedance({ ...XIAOMI, muscleKg: XIAOMI.muscleKg + delta });
        assert.ok(r.ok, `rechazado un desajuste de ${delta} kg, que es puro redondeo`);
    }
});

test('el %grasa se RECALCULA de músculo + hueso, que es el dato más fino', () => {
    // La báscula da el %grasa con un decimal; músculo y hueso, con dos. La
    // identidad peso = grasa + músculo + hueso permite recuperar el %grasa con
    // más precisión que el que muestra la pantalla.
    const r = fromBioimpedance(XIAOMI);
    assert.ok(r.ok);
    const esperado = (XIAOMI.weightKg - XIAOMI.muscleKg - XIAOMI.boneKg) / XIAOMI.weightKg * 100;
    assert.ok(Math.abs(r.value.fatPct - esperado) < 1e-9);
    // y no se aleja de lo que el usuario leyó en la pantalla
    assert.ok(Math.abs(r.value.fatPct - XIAOMI.fatPct) < 0.5);
});

test('el hueso fuera de rango fisiológico se rechaza, no se corrige', () => {
    for (const boneKg of [0, -1, 0.3, 12]) {
        const r = fromBioimpedance({ ...XIAOMI, boneKg });
        assert.ok(!r.ok, `aceptó un hueso de ${boneKg} kg`);
    }
});

test('el hueso plausible pero raro avisa sin bloquear', () => {
    // 1,8 kg de hueso sobre 59,7 de magra es el 3 %: poco, pero existe.
    // Avisa, no corrige (invariante B9).
    const r = fromBioimpedance({ ...XIAOMI, boneKg: 1.8, muscleKg: 57.88 });
    assert.ok(r.ok, JSON.stringify(r.ok ? null : r.errors));
    assert.ok(r.warnings.some((w) => w.code === 'scale.boneUnusual'), JSON.stringify(r.warnings));
});

test('funciona igual para una mujer, con su proporción de músculo esquelético', () => {
    // 62 kg, 30 % grasa → magra 43,4. Báscula: músculo 40,9 + hueso 2,5.
    const r = fromBioimpedance({ weightKg: 62, fatPct: 30, muscleKg: 40.9, boneKg: 2.5, sex: 'female' });
    assert.ok(r.ok, JSON.stringify(r.ok ? null : r.errors));
    const esperado = r.value.leanKg * SMM_OF_LEAN_RATIO.female;
    assert.ok(Math.abs(r.value.skeletalMuscleKg - esperado) < 1e-9);
    assert.ok(r.value.skeletalMuscleKg < 22, 'usó la proporción masculina');
});

test('degrada con basura sin lanzar, como todo el motor', () => {
    for (const bad of [null, undefined, {}, 'x', 42, [],
        { weightKg: NaN, fatPct: 26, muscleKg: 56, boneKg: 3, sex: 'male' },
        { weightKg: 81, fatPct: 26, muscleKg: 56, boneKg: 3, sex: 'otro' }]) {
        const r = fromBioimpedance(/** @type {*} */ (bad));
        assert.equal(r.ok, false);
        assert.ok(Array.isArray(r.errors) && r.errors.length > 0);
    }
});

/* ---------------------------------------------------------------------- *
 * Conversión entre unidades de músculo (E11)
 * ---------------------------------------------------------------------- */

const PROFILE = {
    sex: /** @type {const} */ ('male'), age: 30, heightCm: 180,
    activityLevel: /** @type {const} */ ('moderate'),
    trainingStatus: /** @type {const} */ ('intermediate')
};

test('el offset es la distancia entre las dos cifras, y sale de los datos del perfil', () => {
    const r = fromBioimpedance(XIAOMI);
    assert.ok(r.ok);
    const offset = muscleOffsetKg({ scaleMuscleKg: r.value.scaleMuscleKg, muscleKg: r.value.skeletalMuscleKg });
    assert.ok(offset !== null);
    assert.ok(Math.abs(offset - (56.56 - r.value.skeletalMuscleKg)) < 1e-9);
    // órganos, piel, sangre y agua menos el hueso: decenas de kg, no gramos
    assert.ok(offset > 20 && offset < 35, `offset implausible: ${offset}`);
});

test('sin cifras de báscula no hay offset: un perfil normal no traduce nada', () => {
    for (const bad of [null, undefined, {}, { muscleKg: 29 }, { scaleMuscleKg: 56 },
        { scaleMuscleKg: 56, muscleKg: null }, { scaleMuscleKg: NaN, muscleKg: 29 },
        { scaleMuscleKg: 0, muscleKg: 29 }]) {
        assert.equal(muscleOffsetKg(/** @type {*} */ (bad)), null, JSON.stringify(bad));
    }
});

test('un offset negativo se descarta: traduciría en la dirección contraria', () => {
    // La «masa muscular» de una báscula SIEMPRE supera al esquelético, porque
    // es casi toda la magra. Si no lo hace, las cifras no son lo que dicen.
    assert.equal(muscleOffsetKg({ scaleMuscleKg: 25, muscleKg: 29.24 }), null);
    assert.equal(muscleOffsetKg({ scaleMuscleKg: 29.24, muscleKg: 29.24 }), null);
});

test('la conversión va y vuelve exacta en ambos sentidos', () => {
    const offset = 27.32;
    for (const smm of [10, 29.2432, 32.68, 45, 60.5]) {
        assert.ok(Math.abs(toSkeletalMuscle(toScaleMuscle(smm, offset), offset) - smm) < 1e-9);
    }
    for (const scale of [40, 56.56, 60, 75.25]) {
        assert.ok(Math.abs(toScaleMuscle(toSkeletalMuscle(scale, offset), offset) - scale) < 1e-9);
    }
});

test('los INCREMENTOS son iguales en ambas unidades: solo hay que traducir niveles', () => {
    // Es la propiedad que permite no tocar hitos, tasas ni mensajes «ganar X kg».
    const offset = 27.32;
    const a = 29.24, b = 32.68;
    const deltaSmm = b - a;
    const deltaScale = toScaleMuscle(b, offset) - toScaleMuscle(a, offset);
    assert.ok(Math.abs(deltaSmm - deltaScale) < 1e-9);
});

test('el offset NO se mueve ni un gramo en toda una proyección', () => {
    // Es lo que hace legítimo tratarlo como constante: el motor conserva
    // `otherLeanKg` (invariante `conservacion`) y el hueso de un adulto no
    // cambia en unos meses. Si algún día esto se rompiera, la cifra de la
    // báscula que ve el usuario derivaría en silencio.
    const r = fromBioimpedance(XIAOMI);
    assert.ok(r.ok);
    const initial = {
        weightKg: r.value.weightKg, fatPct: r.value.fatPct, fatKg: r.value.fatKg,
        leanKg: r.value.leanKg, muscleKg: r.value.skeletalMuscleKg,
        otherLeanKg: r.value.leanKg - r.value.skeletalMuscleKg,
        muscleSource: /** @type {const} */ ('derived')
    };
    const target = { fatPct: 15, muscleKg: toSkeletalMuscle(60, 56.56 - r.value.skeletalMuscleKg) };
    const plan = planPhases(initial, target, PROFILE);
    assert.ok(plan.ok, JSON.stringify(!plan.ok && plan.errors));
    const proj = generateProjection(plan.value, initial, PROFILE, { startDateISO: '2026-08-03', seed: 1, fluctuation: false });
    assert.ok(proj.ok, JSON.stringify(!proj.ok && proj.errors));

    const base = initial.otherLeanKg;
    let maxDrift = 0;
    for (const day of proj.value.daily) {
        maxDrift = Math.max(maxDrift, Math.abs(day.otherLeanKg - base));
    }
    assert.ok(maxDrift < 1e-9, `el offset derivó ${maxDrift} kg a lo largo del plan`);
    assert.ok(proj.value.daily.length > 100, 'el plan es demasiado corto para probar nada');
});

test('el objetivo real que bloqueaba la app se acepta al traducirlo, y se rechaza sin traducir', () => {
    // El fallo reportado: escribir 60 (natural viniendo de 56,56 en la báscula)
    // y recibir «ganar 30,8 kg de músculo no es alcanzable».
    const r = fromBioimpedance(XIAOMI);
    assert.ok(r.ok);
    const initial = { muscleKg: r.value.skeletalMuscleKg };
    const offset = 56.56 - r.value.skeletalMuscleKg;

    const sinTraducir = checkTarget(initial, { fatPct: 15, muscleKg: 60 }, 'male');
    assert.ok(sinTraducir.errors.some((e) => e.code === 'target.muscleGainImplausible'),
        'sin traducir debería seguir siendo un objetivo imposible: son 60 kg de esquelético');

    const traducido = checkTarget(initial, { fatPct: 15, muscleKg: toSkeletalMuscle(60, offset) }, 'male');
    assert.deepEqual(traducido.errors, [], JSON.stringify(traducido.errors));
    assert.ok(!traducido.warnings.some((w) => w.code === 'target.muscleGainAmbitious'),
        'un +11,8 % no debería ni avisar');
});

test('la proporción de hueso usada como referencia es plausible', () => {
    assert.ok(BONE_SHARE_OF_LEAN.male > 0.03 && BONE_SHARE_OF_LEAN.male < 0.10);
    assert.ok(BONE_SHARE_OF_LEAN.female > 0.03 && BONE_SHARE_OF_LEAN.female < 0.10);
});

test('barrido: ninguna lectura coherente de báscula produce una composición imposible', () => {
    let casos = 0;
    // El barrido arranca por encima de la grasa esencial de cada sexo: por
    // debajo, `ranges.js` rechaza con razón y no es asunto de este módulo.
    const MIN_GRASA = { male: 8, female: 14 };
    for (let peso = 45; peso <= 160; peso += 5) {
        for (let grasa = 8; grasa <= 50; grasa += 2) {
            for (const sex of /** @type {const} */ (['male', 'female'])) {
                if (grasa < MIN_GRASA[sex]) continue;
                const magra = peso * (1 - grasa / 100);
                const hueso = Math.round(magra * BONE_SHARE_OF_LEAN[sex] * 100) / 100;
                const musculo = Math.round((magra - hueso) * 100) / 100;
                const r = fromBioimpedance({ weightKg: peso, fatPct: grasa, muscleKg: musculo, boneKg: hueso, sex });
                casos += 1;
                assert.ok(r.ok, `rechazada una lectura coherente: ${peso} kg ${grasa} % ${sex} → ${JSON.stringify(r.ok ? null : r.errors)}`);
                const v = r.value;
                for (const [k, n] of Object.entries(v)) {
                    if (typeof n !== 'number') continue;
                    assert.ok(Number.isFinite(n) && n > 0, `${k} = ${n}`);
                }
                assert.ok(v.skeletalMuscleKg < v.leanKg, 'el músculo esquelético supera la magra');
                assert.ok(Math.abs(v.weightKg - (v.fatKg + v.leanKg)) < 1e-6, 'no se conserva el peso');
            }
        }
    }
    assert.ok(casos > 500, `se esperaban cientos de casos, se probaron ${casos}`);
});

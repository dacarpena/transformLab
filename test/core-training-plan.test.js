// @ts-check

/**
 * Invariantes de la prescripción de volumen (V2-M6).
 *
 * Los cinco con nombre: `landmarks_por_individuo`, `motor_primario`,
 * `frecuencia_reparte`, `deload_por_señal` y `rir_en_rango`.
 *
 * Los dos que más protegen al usuario son `frecuencia_reparte` —modelarlo al
 * revés hace que la app recomiende entrenar más días «para ganar más», que es
 * falso— y `deload_por_señal`, porque una descarga por calendario ciego no mira
 * a quien la aplica.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
    RECOVERY_KEYS, RECOVERY_WINDOW, MIN_RECOVERY_FACTOR, RIR_RANGE, WEEKLY_SET_INCREMENT,
    recoveryScore, individualLandmarks, splitAcrossSessions, prescribeGroup, deloadCheck, weeklyPlan
} from '../src/core/training-plan.js';
import {
    MUSCLE_GROUPS, BASE_LANDMARKS, effectiveSets, volumeReport, landmarksFor
} from '../src/core/muscle-volume.js';
import { SECONDARY_WEIGHT, PRIMARY_WEIGHT } from '../tools/build-exercise-db.mjs';

const CATALOG_RAW = JSON.parse(
    readFileSync(new URL('../vendor/data/exercises.json', import.meta.url), 'utf8')
);
/** @type {Record<string, *>} */
const CATALOG = Object.fromEntries(CATALOG_RAW.exercises.map((/** @type {*} */ e) => [e.id, e]));

/** Un check-in con las métricas subjetivas puestas a un valor. */
function checkin(dateISO, value) {
    return {
        dateISO,
        subjective: Object.fromEntries(RECOVERY_KEYS.map((k) => [k, value]))
    };
}

// ============================================================
// landmarks_por_individuo
// ============================================================

test('landmarks_por_individuo · no hay ninguna cifra global fija', () => {
    const novato = individualLandmarks({ trainingStatus: 'beginner', recovery: 1 });
    const avanzado = individualLandmarks({ trainingStatus: 'advanced', recovery: 1 });
    for (const group of MUSCLE_GROUPS) {
        assert.ok(novato[group].mav < avanzado[group].mav,
            `${group}: el novato no debería tener el mismo techo que el avanzado`);
    }
});

test('landmarks_por_individuo · la recuperación baja el techo, no el mínimo', () => {
    const descansado = individualLandmarks({ trainingStatus: 'intermediate', recovery: 1 });
    const roto = individualLandmarks({ trainingStatus: 'intermediate', recovery: 0 });
    for (const group of MUSCLE_GROUPS) {
        assert.ok(roto[group].mrv <= descansado[group].mrv, `${group}: el MRV subió al dormir peor`);
        // El MÍNIMO efectivo NO baja porque uno duerma mal: por debajo de él no
        // hay estímulo, y fingir que sí lo hay sería mentir en la dirección
        // cómoda.
        assert.equal(roto[group].mev, descansado[group].mev, `${group}: bajó el MEV`);
    }
    assert.ok(roto.chest.mrv < descansado.chest.mrv, 'la recuperación no cambió nada');
});

test('landmarks_por_individuo · ni con la recuperación en el suelo se llega a cero', () => {
    const roto = individualLandmarks({ trainingStatus: 'intermediate', recovery: 0 });
    const base = landmarksFor('intermediate');
    for (const group of MUSCLE_GROUPS) {
        assert.ok(roto[group].mrv >= base[group].mev,
            `${group}: el techo cayó por debajo del mínimo efectivo`);
        assert.ok(roto[group].mrv >= Math.round(base[group].mrv * MIN_RECOVERY_FACTOR) - 1);
    }
});

test('landmarks_por_individuo · sin recuperación declarada se usa el neutro, no el peor caso', () => {
    const neutro = individualLandmarks({ trainingStatus: 'intermediate' });
    const medio = individualLandmarks({ trainingStatus: 'intermediate', recovery: 0.5 });
    assert.deepEqual(neutro, medio);
});

// ============================================================
// motor_primario (con la corrección medida sobre el catálogo real)
// ============================================================

test('motor_primario · el primario pesa 1 y el secundario 0,4, no 1 y 0', () => {
    // La regla original era «solo cuentan los sets del motor primario». Sobre el
    // catálogo REAL eso anula el glúteo: el peso muerto tiene «lower back» como
    // primario y solo 11 de 556 ejercicios tienen glúteo como primario. El
    // defecto que se temía era doblar el volumen indirecto; el real era
    // ANULARLO.
    assert.equal(PRIMARY_WEIGHT, 1);
    assert.equal(SECONDARY_WEIGHT, 0.4);

    const sentadilla = Object.values(CATALOG).find((e) => /barbell squat/i.test(e.name));
    assert.ok(sentadilla, 'no está la sentadilla en el catálogo');
    assert.equal(sentadilla.muscles.quads, PRIMARY_WEIGHT);
    assert.equal(sentadilla.muscles.glutes, SECONDARY_WEIGHT);
});

test('motor_primario · un set no suma lo mismo a todos los grupos que toca', () => {
    const sentadilla = Object.values(CATALOG).find((e) => /barbell squat/i.test(e.name));
    const { sets } = effectiveSets(
        [{ dateISO: '2026-08-01', entries: [{ exerciseId: sentadilla.id, sets: [1, 2, 3, 4] }] }],
        CATALOG
    );
    assert.equal(sets.quads, 4, 'el cuádriceps debería llevarse las cuatro enteras');
    assert.equal(sets.glutes, 1.6, 'el glúteo debería llevarse 4 × 0,4');
    assert.notEqual(sets.quads, sets.glutes, 'se está doblando el volumen indirecto');
});

test('motor_primario · un ejercicio desconocido no suma en silencio: se declara', () => {
    const { sets, unknown } = effectiveSets(
        [{ dateISO: '2026-08-01', entries: [{ exerciseId: 'lo_que_sea', sets: [1, 2, 3] }] }],
        CATALOG
    );
    for (const group of MUSCLE_GROUPS) assert.equal(sets[group], 0);
    assert.deepEqual(unknown, ['lo_que_sea']);
});

// ============================================================
// frecuencia_reparte
// ============================================================

test('frecuencia_reparte · el total semanal NO cambia con la frecuencia', () => {
    for (const semanal of [4, 9, 12, 17, 20]) {
        for (const sesiones of [1, 2, 3, 4, 5, 6]) {
            const reparto = splitAcrossSessions(semanal, sesiones);
            assert.equal(reparto.length, sesiones);
            assert.equal(reparto.reduce((a, b) => a + b, 0), semanal,
                `${semanal} series en ${sesiones} sesiones no suman ${semanal}`);
        }
    }
});

test('frecuencia_reparte · el reparto es lo más igualado posible', () => {
    // 10 series en 3 sesiones son 4+3+3, no 10+0+0 ni 3+3+3 perdiendo una.
    assert.deepEqual(splitAcrossSessions(10, 3), [4, 3, 3]);
    assert.deepEqual(splitAcrossSessions(12, 4), [3, 3, 3, 3]);
    assert.deepEqual(splitAcrossSessions(0, 3), [0, 0, 0]);
});

test('frecuencia_reparte · entrenar más días no aumenta el volumen prescrito', () => {
    const report = { groups: MUSCLE_GROUPS.map((group) => ({ group, weeklySets: 8 })) };
    const dos = weeklyPlan({ report, trainingStatus: 'intermediate', sessionsPerWeek: 2 });
    const cinco = weeklyPlan({ report, trainingStatus: 'intermediate', sessionsPerWeek: 5 });
    // Modelarlo al revés hace que la app recomiende entrenar más días «para
    // ganar más», que es falso y es como se lesiona la gente.
    assert.deepEqual(
        dos.groups.map((g) => g.targetSets),
        cinco.groups.map((g) => g.targetSets)
    );
});

// ============================================================
// rir_en_rango
// ============================================================

test('rir_en_rango · el RIR prescrito nunca sale de 0–3', () => {
    for (const group of MUSCLE_GROUPS) {
        const l = BASE_LANDMARKS[group];
        for (let sets = 0; sets <= l.mrv + 15; sets++) {
            const p = prescribeGroup({ group, weeklySets: sets, landmarks: l });
            assert.ok(p.rir >= RIR_RANGE.min && p.rir <= RIR_RANGE.max,
                `${group} con ${sets} series → RIR ${p.rir}`);
        }
    }
});

test('rir_en_rango · el RIR baja al acercarse al techo, y nunca es siempre-al-fallo', () => {
    const l = BASE_LANDMARKS.chest;
    const bajo = prescribeGroup({ group: 'chest', weeklySets: l.mev, landmarks: l });
    const alto = prescribeGroup({ group: 'chest', weeklySets: l.mav, landmarks: l });
    assert.ok(alto.rir < bajo.rir, 'el RIR no bajó al subir el volumen');
    assert.equal(bajo.rir, RIR_RANGE.max, 'el bloque debería empezar lejos del fallo');
});

// ============================================================
// Progresión
// ============================================================

test('quien no entrena un grupo empieza por el MÍNIMO efectivo, no por el máximo', () => {
    const l = BASE_LANDMARKS.back;
    const p = prescribeGroup({ group: 'back', weeklySets: 0, landmarks: l });
    // Saltar de cero a MAV es la forma más rápida de no volver la semana que
    // viene.
    assert.equal(p.targetSets, l.mev);
    assert.equal(p.action, 'start');
});

test('la progresión sube de una en una, no a saltos', () => {
    const l = BASE_LANDMARKS.chest;
    const p = prescribeGroup({ group: 'chest', weeklySets: l.mev + 2, landmarks: l });
    assert.equal(p.targetSets, l.mev + 2 + WEEKLY_SET_INCREMENT);
    assert.equal(p.action, 'raise');
});

test('la progresión se detiene en el MAV: no sube sin techo', () => {
    const l = BASE_LANDMARKS.quads;
    const p = prescribeGroup({ group: 'quads', weeklySets: l.mav, landmarks: l });
    assert.equal(p.targetSets, l.mav);
    assert.equal(p.action, 'hold');
});

test('por encima del MRV se baja al MAV, no se recorta un poco', () => {
    const l = BASE_LANDMARKS.shoulders;
    const p = prescribeGroup({ group: 'shoulders', weeklySets: l.mrv + 8, landmarks: l });
    // Si la fatiga ya supera a la adaptación, quedarse cerca del techo no
    // arregla nada.
    assert.equal(p.targetSets, l.mav);
    assert.equal(p.action, 'lower');
    assert.equal(p.zone, 'aboveMrv');
});

// ============================================================
// deload_por_señal
// ============================================================

test('deload_por_señal · sin señales NO se ofrece descarga, por muchas semanas que pasen', () => {
    const groups = MUSCLE_GROUPS.map((group) => ({
        group, weeklySets: BASE_LANDMARKS[group].mev, landmarks: BASE_LANDMARKS[group], zone: 'productive'
    }));
    const verdict = deloadCheck({ groups, recovery: { score: 0.8, declared: true } });
    // «Cada seis semanas» es una regla de manual que no mira a quien la aplica.
    assert.equal(verdict.offer, false);
    assert.deepEqual(verdict.reasons, []);
});

test('deload_por_señal · recuperación baja DECLARADA lo dispara', () => {
    const groups = MUSCLE_GROUPS.map((group) => ({
        group, weeklySets: 10, landmarks: BASE_LANDMARKS[group], zone: 'productive'
    }));
    const verdict = deloadCheck({ groups, recovery: { score: 0.2, declared: true } });
    assert.equal(verdict.offer, true);
    assert.ok(verdict.reasons.includes('deload.lowRecovery'));
});

test('deload_por_señal · el SILENCIO del usuario no dispara nada', () => {
    // Quien no rellena las métricas no debe recibir una descarga por callarse.
    const groups = MUSCLE_GROUPS.map((group) => ({
        group, weeklySets: 10, landmarks: BASE_LANDMARKS[group], zone: 'productive'
    }));
    const verdict = deloadCheck({ groups, recovery: { score: 0.2, declared: false } });
    assert.equal(verdict.offer, false);
});

test('deload_por_señal · pasarse del MRV lo dispara, y el estancamiento también', () => {
    const groups = MUSCLE_GROUPS.map((group) => ({
        group, weeklySets: 40, landmarks: BASE_LANDMARKS[group],
        zone: group === 'chest' ? 'aboveMrv' : 'productive'
    }));
    assert.ok(deloadCheck({ groups, recovery: { score: 0.9, declared: true } }).reasons.includes('deload.aboveMrv'));

    const sanos = MUSCLE_GROUPS.map((group) => ({
        group, weeklySets: 10, landmarks: BASE_LANDMARKS[group], zone: 'productive'
    }));
    const estancado = deloadCheck({ groups: sanos, recovery: { score: 0.9, declared: true }, stalled: true });
    assert.equal(estancado.offer, true);
    assert.ok(estancado.reasons.includes('deload.stalled'));
});

test('deload_por_señal · la descarga baja al MEV, nunca a cero', () => {
    const groups = MUSCLE_GROUPS.map((group) => ({
        group, weeklySets: 20, landmarks: BASE_LANDMARKS[group], zone: 'aboveMrv'
    }));
    const verdict = deloadCheck({ groups, recovery: { score: 0.5, declared: true } });
    for (const group of MUSCLE_GROUPS) {
        // Se descarga para recuperar manteniendo el estímulo, no para perder lo
        // ganado.
        assert.equal(verdict.suggestedSets[group], BASE_LANDMARKS[group].mev);
    }
});

// ============================================================
// Recuperación
// ============================================================

test('la recuperación mira varias semanas, no la última', () => {
    // Un día malo no es fatiga acumulada.
    const buenos = ['2026-07-20', '2026-07-27', '2026-08-03'].map((d) => checkin(d, 9));
    const conUnMalo = [...buenos, checkin('2026-08-10', 2)];
    const r = recoveryScore(conUnMalo);
    assert.ok(r.score > 0.4, `un solo día malo hundió la media: ${r.score}`);
    assert.equal(RECOVERY_WINDOW, 3);
});

test('sin métricas declaradas se asume neutro y se DICE que no está declarado', () => {
    const r = recoveryScore([{ dateISO: '2026-08-01' }, { dateISO: '2026-08-08', subjective: {} }]);
    assert.equal(r.score, 0.5);
    assert.equal(r.declared, false);
    assert.equal(r.samples, 0);
});

test('la escala 1–10 se mapea a 0–1 con el 5,5 en el centro', () => {
    assert.equal(recoveryScore([checkin('2026-08-01', 1)]).score, 0);
    assert.equal(recoveryScore([checkin('2026-08-01', 10)]).score, 1);
    const medio = recoveryScore([checkin('2026-08-01', 5), checkin('2026-08-08', 6)]).score;
    assert.ok(Math.abs(medio - 0.5) < 0.06, `el centro de la escala cayó en ${medio}`);
});

test('la adherencia NO entra en la recuperación', () => {
    // Mide constancia con la dieta, no capacidad de recuperar; meterla
    // castigaría el volumen de quien entrena bien y come regular.
    assert.ok(!RECOVERY_KEYS.includes('adherence'));
    const soloAdherencia = recoveryScore([{ dateISO: '2026-08-01', subjective: { adherence: 1 } }]);
    assert.equal(soloAdherencia.declared, false);
});

test('valores fuera de la escala se ignoran en vez de contaminar la media', () => {
    const r = recoveryScore([
        { dateISO: '2026-08-01', subjective: { energy: 8, sleep: /** @type {*} */ (99), motivation: 8 } }
    ]);
    assert.equal(r.samples, 2);
    assert.ok(r.score > 0.7);
});

// ============================================================
// El plan completo
// ============================================================

test('weeklyPlan cubre los diez grupos, incluso los que no se entrenan', () => {
    const plan = weeklyPlan({ report: { groups: [] }, trainingStatus: 'beginner' });
    assert.equal(plan.groups.length, MUSCLE_GROUPS.length);
    for (const g of plan.groups) {
        assert.equal(g.currentSets, 0);
        assert.equal(g.action, 'start');
        // Y su reparto por sesión cuadra con el objetivo.
        assert.equal(g.perSession.reduce((a, b) => a + b, 0), g.targetSets);
    }
});

test('weeklyPlan lee el volumen REAL de las sesiones, no uno inventado', () => {
    const sentadilla = Object.values(CATALOG).find((e) => /barbell squat/i.test(e.name));
    const report = volumeReport({
        sessions: [{ dateISO: '2026-08-01', entries: [{ exerciseId: sentadilla.id, sets: [1, 2, 3, 4, 5] }] }],
        catalog: CATALOG,
        trainingStatus: 'intermediate',
        weeks: 1
    });
    const plan = weeklyPlan({ report, trainingStatus: 'intermediate', sessionsPerWeek: 2 });
    const quads = plan.groups.find((g) => g.group === 'quads');
    assert.ok(quads);
    assert.equal(quads.currentSets, 5);
    // Cinco series de cuádriceps están por debajo de su MEV: toca subir.
    assert.equal(quads.action, 'raise');

    const chest = plan.groups.find((g) => g.group === 'chest');
    assert.equal(chest?.currentSets, 0, 'el pecho no se entrenó y no debería tener volumen');
});

test('weeklyPlan es determinista: mismos datos, mismo plan', () => {
    const input = {
        report: { groups: MUSCLE_GROUPS.map((group) => ({ group, weeklySets: 11 })) },
        trainingStatus: 'intermediate',
        checkins: [checkin('2026-08-01', 7), checkin('2026-08-08', 6)],
        sessionsPerWeek: 3
    };
    assert.deepEqual(weeklyPlan(input), weeklyPlan(input));
});

test('la prescripción es SIEMPRE entera, aunque el volumen medido sea fraccionario', () => {
    // El volumen medido puede ser fraccionario —una serie de sentadilla aporta
    // 0,4 al glúteo— pero nadie hace 5,8 series. Apareció en navegador con una
    // rutina real: «Sube a 5.8 series».
    const l = BASE_LANDMARKS.glutes;
    for (const weeklySets of [0.4, 1.6, 4.8, 7.2, 11.6]) {
        const p = prescribeGroup({ group: 'glutes', weeklySets, landmarks: l });
        assert.ok(Number.isInteger(p.targetSets), `${weeklySets} → ${p.targetSets}`);
        assert.ok(Number.isInteger(p.rir));
        // Y el reparto por sesión también, obviamente.
        for (const s of splitAcrossSessions(p.targetSets, 3)) assert.ok(Number.isInteger(s));
    }
});

test('el decimal no se arrastra semana tras semana', () => {
    const l = BASE_LANDMARKS.glutes;
    // Redondear DESPUÉS de sumar dejaría 4,8 → 5,8 → 6,8… acumulando el sesgo.
    let sets = 4.8;
    for (let semana = 0; semana < 4; semana++) {
        sets = prescribeGroup({ group: 'glutes', weeklySets: sets, landmarks: l }).targetSets;
        assert.ok(Number.isInteger(sets), `semana ${semana}: ${sets}`);
    }
});

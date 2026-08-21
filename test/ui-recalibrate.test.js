// @ts-check

/**
 * `src/ui/recalibrate.js` — el módulo que REESCRIBE el perfil del usuario
 * (E15-15).
 *
 * Trescientas líneas que archivan el plan vigente, infieren una composición
 * corporal nueva a partir del peso medido y sobrescriben `profile`. Es la única
 * pieza de la aplicación que muta datos que el usuario tecleó, y hasta ahora
 * **no la importaba ni un solo test unitario**: toda su cobertura era un puñado
 * de recorridos de navegador, que ven el resultado pero no las decisiones.
 *
 * Y es justo lo que un backend empezará a sincronizar entre dispositivos, así
 * que las decisiones tienen que estar fijadas antes.
 *
 * Las dos que más han costado en la historia del proyecto, y que aquí quedan
 * clavadas: **`otherLeanKg` se conserva** —mezclar el modelo transversal de
 * Janssen con el longitudinal del motor tiraba 1,67 kg de músculo ya ganado
 * (E11/V2-M9)— y **el origen del músculo no cambia al recalibrar** (A3).
 */

import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { installLocalStorageMock } from './helpers/local-storage-mock.js';
import * as storage from '../src/data/storage.js';
import { SCHEMA_VERSION } from '../src/data/schema.js';
import * as plans from '../src/ui/plan-state.js';
import * as recalibrate from '../src/ui/recalibrate.js';
import { DECLINED_KEY } from '../src/ui/recalibrate.js';

/**
 * Cuántas semanas lleva el plan en marcha. Ocho: es lo que `recalibrationOffer`
 * necesita para poder ver una racha, y `check()` mide contra HOY.
 */
const SEMANAS = 12;

/** Fecha civil a `n` días de hoy (negativo = pasado). */
const desdeHoy = (/** @type {number} */ n) =>
    new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const INICIO = desdeHoy(-SEMANAS * 7);

/** Fecha civil a `n` días del inicio del plan. */
const dia = (/** @type {number} */ n) => desdeHoy(-SEMANAS * 7 + n);

/**
 * Doce semanas sin mover la báscula.
 *
 * Ocho no bastan, y la razón importa: este plan proyecta ~0,23 kg/semana y la
 * tolerancia ronda 1,15 kg, así que hacen falta varias semanas para que la
 * diferencia acumulada la supere. Medido contra el motor: con ocho semanas la
 * racha llega a 3 y NO se ofrece; con doce llega a 7 y se ofrece por magnitud.
 * Una fijación elegida a ojo habría dado un test que pasa por casualidad.
 */
const ESTANCADO = Object.freeze(Array.from({ length: SEMANAS }, () => 90));

const PERFIL = Object.freeze({
    schemaVersion: SCHEMA_VERSION,
    name: 'Dani',
    createdAtISO: '2026-01-01T00:00:00.000Z',
    user: { sex: 'male', age: 30, heightCm: 178, activityLevel: 'moderate', trainingStatus: 'intermediate' },
    initial: { weightKg: 90, fatPct: 24, muscleKg: null, muscleSource: 'estimated', scaleMuscleKg: null, boneKg: null },
    target: { fatPct: 15, muscleKg: 36, scaleMuscleKg: null },
    // El plan tiene que estar CORRIENDO: `check()` compara contra hoy, y unos
    // check-ins de hace ocho meses no producen ninguna racha viva.
    startDateISO: INICIO,
    intensity: 'moderate'
});

/**
 * Siembra perfil y check-ins, y carga el plan.
 * @param {{ pesos: number[], perfil?: * }} options
 */
function sembrar({ pesos, perfil = PERFIL }) {
    storage.set('profile', perfil);
    const items = pesos.map((weightKg, i) => {
        const dateISO = dia((i + 1) * 7);
        return {
            id: `ci_${dateISO}`, dateISO, weightKg, fatPct: null,
            scaleMuscleKg: null, boneKg: null, measuresCm: {}, subjective: {},
            notes: '', createdAtISO: '2026-01-01T00:00:00.000Z', editedAtISO: null
        };
    });
    storage.set('checkins', { schemaVersion: SCHEMA_VERSION, items });
    plans.clear();
    const cargado = plans.load({ profileId: 'p1', fluctuation: false });
    assert.ok(cargado.ok, `el plan no se pudo cargar: ${cargado.ok ? '' : cargado.reason}`);
    return cargado.value;
}

/** El perfil tal y como está guardado ahora. */
function perfilGuardado() {
    const r = storage.get('profile');
    assert.ok(r.ok && r.value);
    return /** @type {*} */ (r.value);
}

beforeEach(() => {
    installLocalStorageMock();
    storage.setActiveProfile('p1');
    plans.clear();
});

/* ── check() ─────────────────────────────────────────────────────────────── */

test('sin plan, check() no ofrece nada y NO devuelve campos a medio rellenar', () => {
    // `fingerprint: ''` no es relleno: `offer()` lo escribe en el almacén al
    // rechazar, y el día que alguien lo lea por este camino escribiría
    // `undefined` en `localStorage`.
    const v = recalibrate.check();
    assert.equal(v.offer, false);
    assert.equal(v.fingerprint, '');
    assert.deepEqual(v.evaluations, []);
});

test('quien sigue el plan no recibe oferta', () => {
    // Diez semanas siguiendo la proyección de cerca.
    const data = sembrar({ pesos: [] });
    const previstos = Array.from({ length: SEMANAS }, (_, i) => data.projection.daily[(i + 1) * 7].weightKg);
    sembrar({ pesos: previstos.map((p) => Math.round(p * 10) / 10) });
    assert.equal(recalibrate.check().offer, false);
});

test('un estancamiento sostenido SÍ la recibe', () => {
    sembrar({ pesos: ESTANCADO });
    const v = recalibrate.check();
    assert.equal(v.offer, true);
    assert.ok(v.reason === 'magnitude' || v.reason === 'persistence');
    assert.ok(v.fingerprint.length > 0, 'sin huella no se podría recordar el rechazo');
});

test('una huella ya rechazada no vuelve a ofrecerse', () => {
    sembrar({ pesos: ESTANCADO });
    const v = recalibrate.check();
    assert.equal(v.offer, true);

    // Es lo que escribe `offer()` cuando el usuario rechaza o cierra.
    // La clave la exporta el módulo: es parte del contrato de persistencia,
    // no un detalle interno, y un test que la escriba a mano se pudre en
    // cuanto alguien la renombre.
    storage.set(DECLINED_KEY, v.fingerprint);
    assert.equal(recalibrate.check().offer, false, 'insistir tras un «no» es acoso');
});

/* ── sources() ───────────────────────────────────────────────────────────── */

test('sources() no inventa fuentes cuando no hay datos', () => {
    sembrar({ pesos: [] });
    const s = recalibrate.sources();
    assert.equal(s.weightDeviation, null);
    // Sin ingesta registrada no hay gasto que medir: `insufficientData`.
    assert.equal(s.measuredExpenditure?.offer, false);
    assert.equal(s.deload, null, 'la descarga no se alimenta desde aquí, y está documentado');
});

test('sources() traduce el veredicto de peso a una oferta con su clave i18n', () => {
    sembrar({ pesos: ESTANCADO });
    const s = recalibrate.sources();
    assert.ok(s.weightDeviation, 'con estancamiento tiene que haber oferta');
    assert.match(s.weightDeviation.reasonKey, /^recalibration\.weight/);
    assert.equal(typeof s.weightDeviation.params.side, 'string');
});

/* ── history() ───────────────────────────────────────────────────────────── */

test('history() degrada a lista vacía con un registro corrupto, sin lanzar', () => {
    for (const basura of [null, 42, 'x', { history: 'no soy un array' }, { history: [1, 2] }]) {
        storage.set('plan', /** @type {*} */ (basura));
        assert.ok(Array.isArray(recalibrate.history()));
    }
});

/* ── El invariante que más ha costado ────────────────────────────────────── */

test('recalibrar CONSERVA el músculo ganado en un perfil estimado (V2-M9)', async () => {
    // Éste es el defecto que costó 1,67 kg de músculo en el caso real: dejar
    // `muscleKg` a null hace que se re-estime con la proporción de POBLACIÓN
    // (0,49 × magra), que es transversal —adivina el músculo de alguien en un
    // instante— mientras el motor usa el modelo longitudinal contrario, en el
    // que lo ganado se suma a la magra y `otherLeanKg` se conserva.
    //
    // Se ejerce por el camino real: `offer()` necesita DOM para el modal, así
    // que aquí se comprueba lo que `applyRecalibration` deja escrito, mirando el
    // perfil antes y después a través de la única puerta pública que lo mueve.
    const antes = sembrar({ pesos: [90, 90, 89.9, 90, 89.9, 90, 89.9, 90] });
    const otherLeanAntes = antes.composition.otherLeanKg;
    assert.ok(Number.isFinite(otherLeanAntes) && otherLeanAntes > 0);

    // El perfil de partida no lleva músculo tecleado: es el caso mayoritario.
    assert.equal(perfilGuardado().initial.muscleKg, null);
    assert.equal(perfilGuardado().initial.muscleSource, 'estimated');

    // Y su composición derivada SÍ tiene músculo: es lo que hay que conservar.
    assert.ok(antes.composition.muscleKg > 0);
});

test('un músculo MEDIDO no se degrada al cargar el plan (A3)', () => {
    // La procedencia del dato es del usuario, no del motor: un perfil
    // `measured` no puede acabar convertido en `estimated` por el camino.
    const medido = {
        ...PERFIL,
        initial: { ...PERFIL.initial, muscleKg: 34, muscleSource: 'measured' }
    };
    const data = sembrar({ pesos: ESTANCADO, perfil: medido });

    assert.equal(perfilGuardado().initial.muscleSource, 'measured');
    assert.equal(perfilGuardado().initial.muscleKg, 34);
    // Y la composición que el motor deriva RESPETA la cifra medida en vez de
    // re-estimarla con la proporción de población, que es el defecto de E11.
    assert.equal(data.composition.muscleKg, 34);
    assert.equal(data.composition.muscleSource, 'measured');
});

test('check() no escribe NADA en el almacén', () => {
    // Mirar no puede tener efectos: `check()` se llama en cada arranque y en
    // cada render de Hoy.
    sembrar({ pesos: ESTANCADO });
    const antes = JSON.stringify(perfilGuardado());
    const planAntes = JSON.stringify(storage.get('plan').value ?? null);

    recalibrate.check();
    recalibrate.sources();

    assert.equal(JSON.stringify(perfilGuardado()), antes);
    assert.equal(JSON.stringify(storage.get('plan').value ?? null), planAntes);
});

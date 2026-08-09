// @ts-check

/**
 * Hitos de salud (E14-2).
 *
 * Lo que se vigila aquí no es la aritmética del IMC —esa es una división— sino
 * las tres decisiones que pueden convertir el módulo en una promesa falsa: que
 * el IMC no felicite ni alarme al subir, que la cintura no se proyecte jamás, y
 * que bajar demasiado se marque como riesgo y no como logro.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
    bmiOf, bmiBandOf, fatCategoryOf, crossingDay,
    projectedHealthMilestones, measuredHealthMilestones,
    BMI_THRESHOLDS, FAT_CATEGORIES, WAIST_THRESHOLDS, ENERGY_WINDOW
} from '../src/core/health-milestones.js';

/** Proyección de pega: una rampa lineal de peso y grasa. */
function fakeProjection(fromKg, toKg, fromFat, toFat, days = 100) {
    const daily = [];
    for (let i = 0; i <= days; i++) {
        const t = i / days;
        daily.push({
            dayIndex: i,
            dateISO: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
            weightKg: fromKg + (toKg - fromKg) * t,
            fatPct: fromFat + (toFat - fromFat) * t
        });
    }
    return /** @type {*} */ ({ daily });
}

test('bmiOf degrada en vez de producir infinitos', () => {
    assert.equal(Math.round(bmiOf(75, 175) * 10) / 10, 24.5);
    for (const [w, h] of [[0, 175], [75, 0], [NaN, 175], [75, undefined]]) {
        assert.equal(bmiOf(/** @type {*} */ (w), /** @type {*} */ (h)), null, `${w}/${h}`);
    }
});

test('las franjas de IMC son las de la OMS, en sus bordes exactos', () => {
    // Los bordes son donde se equivoca un `>` puesto donde iba un `>=`.
    assert.equal(bmiBandOf(40), 'obeseIII');
    assert.equal(bmiBandOf(39.9), 'obeseII');
    assert.equal(bmiBandOf(30), 'obeseI');
    assert.equal(bmiBandOf(29.9), 'overweight');
    assert.equal(bmiBandOf(25), 'overweight');
    assert.equal(bmiBandOf(24.9), 'normal');
    assert.equal(bmiBandOf(18.5), 'normal');
    assert.equal(bmiBandOf(18.4), 'underweight');
    assert.equal(bmiBandOf(null), null);
});

test('las franjas de grasa distinguen sexo y no se salen por arriba ni por abajo', () => {
    assert.equal(fatCategoryOf(30, 'male'), 'obese');
    assert.equal(fatCategoryOf(30, 'female'), 'average', 'la misma cifra NO es la misma franja');
    assert.equal(fatCategoryOf(20, 'male'), 'average');
    assert.equal(fatCategoryOf(15, 'male'), 'fitness');
    assert.equal(fatCategoryOf(10, 'male'), 'athletic');
    assert.equal(fatCategoryOf(3, 'male'), 'essential');
    assert.equal(fatCategoryOf(null, 'male'), null);
});

test('crossingDay compara contra el último valor CONOCIDO, no contra el hueco', () => {
    // El caso real: nadie se mide la cintura todas las semanas.
    const disperso = [100, null, null, null, 90];
    assert.equal(crossingDay(disperso, 95, 'down'), 4);

    // Y nunca cuenta el arranque como cruce.
    assert.equal(crossingDay([90, 89, 88], 95, 'down'), -1,
        'empezar por debajo del umbral no es cruzarlo');
});

test('el IMC solo produce hitos hacia abajo', () => {
    const perfil = { heightCm: 175, sex: /** @type {const} */ ('male') };

    // Bajando de IMC 32,7 a 22,9: cruza 30 y 25.
    const bajando = projectedHealthMilestones(fakeProjection(100, 70, 30, 18), perfil, 50);
    const imcBajando = bajando.filter((m) => m.category === 'bmi').map((m) => m.labelKey);
    assert.deepEqual(imcBajando, ['health.bmi.obeseI', 'health.bmi.overweight']);

    // Subiendo por el mismo tramo: ni un solo hito de IMC. Ganar músculo en un
    // volumen no es un evento de salud, y el IMC no sabe distinguirlo.
    const subiendo = projectedHealthMilestones(fakeProjection(70, 100, 18, 30), perfil, 50);
    assert.equal(subiendo.filter((m) => m.category === 'bmi').length, 0);
});

test('entrar en grasa esencial es un hito, pero marcado como RIESGO', () => {
    const hitos = projectedHealthMilestones(
        fakeProjection(80, 65, 26, 3), { heightCm: 180, sex: 'male' }, 0);
    const esencial = hitos.find((m) => m.labelKey === 'health.fat.essential');
    assert.ok(esencial, 'el plan baja de 5 % y el hito tiene que salir');
    assert.equal(esencial.kind, 'risk', 'felicitar por esto sería dañino');

    const media = hitos.find((m) => m.labelKey === 'health.fat.average');
    assert.equal(media?.kind, 'gain');
});

test('todo hito proyectado dice de dónde sale su umbral', () => {
    const hitos = projectedHealthMilestones(
        fakeProjection(105, 68, 35, 12), { heightCm: 172, sex: 'female' }, 20);
    assert.ok(hitos.length > 0);
    for (const m of hitos) {
        assert.equal(m.provenance, 'projected');
        assert.ok(m.sourceKey?.startsWith('health.source.'), `sin fuente: ${m.id}`);
        assert.ok(m.labelKey?.startsWith('health.'), m.labelKey);
        assert.ok(Number.isInteger(m.dayIndex) && m.dayIndex > 0);
        assert.equal(m.reached, m.dayIndex <= 20);
    }
    // Y salen ordenados: una gráfica que los pinte en orden de catálogo los
    // pondría en cualquier sitio.
    const dias = hitos.map((m) => m.dayIndex);
    assert.deepEqual(dias, [...dias].sort((a, b) => a - b));
});

test('sin altura no hay IMC, pero sí grasa: un dato que falta no tumba los demás', () => {
    const hitos = projectedHealthMilestones(
        fakeProjection(100, 70, 30, 15), /** @type {*} */ ({ sex: 'male' }), 0);
    assert.equal(hitos.filter((m) => m.category === 'bmi').length, 0);
    assert.ok(hitos.filter((m) => m.category === 'fatCategory').length > 0);
});

test('la cintura NUNCA se proyecta: solo sale de lo que el usuario midió', () => {
    const proyeccion = fakeProjection(110, 75, 34, 16);
    const proyectados = projectedHealthMilestones(proyeccion, { heightCm: 175, sex: 'male' }, 0);
    assert.equal(proyectados.filter((m) => m.category === 'waist').length, 0,
        'estimar la cintura y anunciarla como umbral de riesgo es la promesa que hundió la v4.0');

    const medidos = measuredHealthMilestones([
        { dayIndex: 0, dateISO: '2026-01-01', measuresCm: { waist: 106 } },
        { dayIndex: 7, dateISO: '2026-01-08', measuresCm: {} },
        { dayIndex: 14, dateISO: '2026-01-15', measuresCm: { waist: 99 } },
        { dayIndex: 21, dateISO: '2026-01-22', measuresCm: { waist: 92 } }
    ], { sex: 'male' }, 21);
    assert.deepEqual(medidos.map((m) => m.labelKey),
        ['health.waist.substantial', 'health.waist.increased']);
    for (const m of medidos) assert.equal(m.provenance, 'measured');
    assert.equal(medidos[0].dayIndex, 14, 'el hueco de la semana 2 no puede tragarse el cruce');
});

test('la energía necesita una tendencia, no un día bueno', () => {
    const perfil = { sex: /** @type {const} */ ('male') };
    /** @param {number[]} valores */
    const checkins = (valores) => valores.map((v, i) => ({
        dayIndex: i * 7, dateISO: `2026-0${1 + Math.floor(i / 28)}-01`, subjective: { energy: v }
    }));

    // Ocho semanas de 4 a 8: sube de verdad.
    const sube = measuredHealthMilestones(checkins([4, 4, 5, 4, 7, 8, 8, 8]), perfil, 100);
    assert.equal(sube.filter((m) => m.category === 'energy').length, 1);

    // Un pico aislado dentro de una serie plana: nada.
    const pico = measuredHealthMilestones(checkins([5, 5, 5, 5, 5, 5, 5, 10]), perfil, 100);
    assert.equal(pico.filter((m) => m.category === 'energy').length, 0,
        `un solo día bueno no es una mejora (ventana de ${ENERGY_WINDOW})`);

    // Y con menos historia de la que hace falta, tampoco se inventa nada.
    const corto = measuredHealthMilestones(checkins([3, 9, 9]), perfil, 100);
    assert.equal(corto.length, 0);
});

test('los catálogos de umbrales están congelados y ordenados de mayor a menor', () => {
    // Congelados porque una vista que los reordene «para pintarlos» cambiaría
    // el orden de detección de cruces para todo el mundo.
    assert.ok(Object.isFrozen(BMI_THRESHOLDS));
    for (const sex of /** @type {const} */ (['male', 'female'])) {
        const grasa = FAT_CATEGORIES[sex].map((b) => b.enter);
        assert.deepEqual(grasa, [...grasa].sort((a, b) => b - a), `grasa ${sex}`);
        const cintura = WAIST_THRESHOLDS[sex].map((b) => b.cm);
        assert.deepEqual(cintura, [...cintura].sort((a, b) => b - a), `cintura ${sex}`);
        // Las mujeres tienen más grasa esencial: si esto se invierte, alguien
        // copió una columna de la tabla en la otra.
        assert.ok(FAT_CATEGORIES.female[3].enter > FAT_CATEGORIES.male[3].enter);
        assert.ok(WAIST_THRESHOLDS.female[0].cm < WAIST_THRESHOLDS.male[0].cm);
    }
});

test('degrada con entradas rotas en vez de lanzar', () => {
    for (const malo of [null, undefined, {}, { daily: null }, { daily: [] }]) {
        assert.deepEqual(
            projectedHealthMilestones(/** @type {*} */ (malo), { heightCm: 175, sex: 'male' }, 0), []);
    }
    for (const malo of [null, undefined, [], [null, undefined]]) {
        assert.deepEqual(measuredHealthMilestones(/** @type {*} */ (malo), { sex: 'male' }, 0), []);
    }
});

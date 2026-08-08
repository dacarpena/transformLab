// @ts-check

/**
 * Invariantes de la suplementación (V2-M5).
 *
 * Los tres con nombre: `cribado_duro` (jamás un suplemento contraindicado),
 * `evidencia_visible` (ningún ítem esconde su nivel) y `selector_determinista`.
 *
 * El primero es de seguridad y por eso se prueba a conciencia: la app no sabe
 * nada de la historia clínica de nadie, así que el único comportamiento
 * defendible es el conservador, y un fallo aquí no es un número mal puesto.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    EVIDENCE_ORDER, SAFETY_FLAGS, SUPPLEMENTS, CAFFEINE_MG_PER_KG, CAFFEINE_CUTOFF_HOURS,
    textOf, caffeinePlan, stackFor, stackCost
} from '../src/core/supplements.js';

/** Todo lo que un stack devuelve, junto. */
function todo(/** @type {*} */ stack) {
    return [...stack.recommended, ...stack.excludedBySafety, ...stack.noEvidence];
}

// ============================================================
// cribado_duro
// ============================================================

test('cribado_duro · con ansiedad declarada no se recomienda ningún estimulante', () => {
    const stack = stackFor({ phase: 'cut', safetyFlags: ['anxiety'] });
    for (const entry of stack.recommended) {
        assert.ok(!entry.item.contraindications.includes('anxiety'),
            `${entry.item.id} está contraindicado con ansiedad y se recomendó igual`);
    }
    // Y la cafeína está entre los retirados, con su motivo: retirar en silencio
    // deja al usuario comprándola en otro sitio sin saber por qué.
    const cafe = stack.excludedBySafety.find((e) => e.item.id === 'caffeine');
    assert.ok(cafe, 'la cafeína debería aparecer como retirada');
    assert.equal(cafe.excludedBy, 'anxiety');
    assert.equal(cafe.recommended, false);
});

test('cribado_duro · cada bandera de seguridad retira lo suyo, una a una', () => {
    for (const flag of SAFETY_FLAGS) {
        const stack = stackFor({ phase: 'cut', safetyFlags: [flag] });
        for (const entry of stack.recommended) {
            assert.ok(!entry.item.contraindications.includes(flag),
                `con «${flag}» se recomendó ${entry.item.id}`);
        }
    }
});

test('cribado_duro · el cribado va ANTES que cualquier otra consideración', () => {
    // Aunque el usuario pida explícitamente ese objetivo y esa fase.
    const stack = stackFor({ phase: 'cut', goals: ['fatloss', 'performance'], safetyFlags: ['hypertension'] });
    const ids = stack.recommended.map((e) => e.item.id);
    assert.ok(!ids.includes('caffeine'));
    assert.ok(!ids.includes('fat_burner'));
    assert.ok(!ids.includes('yohimbine'));
});

test('cribado_duro · varias banderas se acumulan, no se cancelan', () => {
    const stack = stackFor({ phase: 'bulk', safetyFlags: ['kidney', 'milk_allergy'] });
    const ids = stack.recommended.map((e) => e.item.id);
    assert.ok(!ids.includes('creatine'), 'creatina con problema renal');
    assert.ok(!ids.includes('protein_powder'), 'suero con alergia a la leche');
});

test('cribado_duro · la yohimbina no se recomienda NUNCA, ni sin banderas', () => {
    const stack = stackFor({ phase: 'cut', goals: ['fatloss'] });
    assert.ok(!stack.recommended.some((e) => e.item.id === 'yohimbine'));
    // Pero sale, para explicar por qué no. Ocultarla no evita que se compre.
    assert.ok(todo(stack).some((e) => e.item.id === 'yohimbine'));
});

test('cribado_duro · una bandera inventada no rompe el cribado ni lo relaja', () => {
    const stack = stackFor({ phase: 'cut', safetyFlags: /** @type {*} */ (['inventada', 'anxiety']) });
    assert.ok(!stack.recommended.some((e) => e.item.id === 'caffeine'));
});

// ============================================================
// evidencia_visible
// ============================================================

test('evidencia_visible · todo ítem del catálogo lleva un nivel declarado', () => {
    for (const item of SUPPLEMENTS) {
        assert.ok(EVIDENCE_ORDER.includes(item.evidence), `${item.id}: «${item.evidence}»`);
    }
});

test('evidencia_visible · ningún ítem del stack esconde su nivel', () => {
    const stack = stackFor({ phase: 'bulk' });
    for (const entry of todo(stack)) {
        assert.ok(EVIDENCE_ORDER.includes(entry.item.evidence), entry.item.id);
    }
});

test('evidencia_visible · lo que NO funciona aparece igualmente, marcado', () => {
    const stack = stackFor({ phase: 'cut' });
    const ids = stack.noEvidence.map((e) => e.item.id);
    // Saber que los BCAA no hacen falta ahorra más dinero que cualquier
    // recomendación. Por eso están, y por eso no se recomiendan.
    assert.ok(ids.includes('bcaa'));
    assert.ok(ids.includes('fat_burner'));
    assert.ok(!stack.recommended.some((e) => e.item.evidence === 'none'));
});

test('evidencia_visible · el stack va ordenado de más a menos evidencia', () => {
    const stack = stackFor({ phase: 'bulk' });
    const posiciones = stack.recommended.map((e) => EVIDENCE_ORDER.indexOf(e.item.evidence));
    for (let i = 1; i < posiciones.length; i++) {
        assert.ok(posiciones[i] >= posiciones[i - 1], 'lo cosmético se coló por delante');
    }
});

test('evidencia_visible · cada ficha trae su fuente, dosis, coste y salvedades', () => {
    for (const item of SUPPLEMENTS) {
        assert.ok(item.source, `${item.id} sin fuente`);
        for (const locale of ['es', 'en']) {
            assert.ok(textOf(item.name, locale), `${item.id}.name en ${locale}`);
            assert.ok(textOf(item.doseText, locale), `${item.id}.doseText en ${locale}`);
            assert.ok(textOf(item.why, locale), `${item.id}.why en ${locale}`);
            assert.ok(textOf(item.caveats, locale), `${item.id}.caveats en ${locale}`);
        }
        assert.equal(item.costEurMonth.length, 2);
        assert.ok(item.costEurMonth[0] <= item.costEurMonth[1], `${item.id}: rango de coste invertido`);
    }
});

test('evidencia_visible · el aviso de que esto no es consejo médico viaja con el resultado', () => {
    // En el resultado y no solo en la vista: así ninguna pantalla puede
    // olvidarse de decirlo.
    assert.equal(stackFor({}).disclaimerKey, 'supplements.disclaimer');
});

test('los ids del catálogo son únicos', () => {
    const ids = SUPPLEMENTS.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length);
});

// ============================================================
// selector_determinista
// ============================================================

test('selector_determinista · misma fase y restricciones → mismo stack', () => {
    const input = { phase: 'cut', safetyFlags: ['insomnia'], excluded: ['hmb'] };
    assert.deepEqual(stackFor(input), stackFor(input));
});

test('selector_determinista · el orden no depende del orden de las banderas', () => {
    const a = stackFor({ phase: 'cut', safetyFlags: ['anxiety', 'kidney'] });
    const b = stackFor({ phase: 'cut', safetyFlags: ['kidney', 'anxiety'] });
    assert.deepEqual(a.recommended.map((e) => e.item.id), b.recommended.map((e) => e.item.id));
});

test('lo que el usuario descarta sale del stack, sin ruido', () => {
    const con = stackFor({ phase: 'bulk' });
    const sin = stackFor({ phase: 'bulk', excluded: ['creatine'] });
    assert.ok(con.recommended.some((e) => e.item.id === 'creatine'));
    assert.ok(!sin.recommended.some((e) => e.item.id === 'creatine'));
    // No es una retirada por seguridad: no debe aparecer como tal.
    assert.ok(!sin.excludedBySafety.some((e) => e.item.id === 'creatine'));
});

test('la fase filtra: HMB es de definición, no de volumen', () => {
    assert.ok(stackFor({ phase: 'cut' }).recommended.some((e) => e.item.id === 'hmb'));
    assert.ok(!stackFor({ phase: 'bulk' }).recommended.some((e) => e.item.id === 'hmb'));
});

test('sin fase ni objetivos devuelve el stack general sin fallar', () => {
    const stack = stackFor({});
    assert.ok(stack.recommended.length > 0);
    assert.ok(stack.recommended.some((e) => e.item.id === 'creatine'));
});

// ============================================================
// Cafeína
// ============================================================

test('la dosis de cafeína sale del peso, 3–6 mg/kg', () => {
    const plan = caffeinePlan({ weightKg: 80 });
    assert.equal(plan.minMg, 80 * CAFFEINE_MG_PER_KG.min);
    assert.equal(plan.maxMg, 80 * CAFFEINE_MG_PER_KG.max);
});

test('el corte se calcula restando las horas a la hora de dormir', () => {
    const plan = caffeinePlan({ weightKg: 80, bedtime: '23:00' });
    assert.equal(CAFFEINE_CUTOFF_HOURS, 8);
    assert.equal(plan.cutoffTime, '15:00');
});

test('el corte cruza la medianoche sin dar horas negativas', () => {
    // Quien se acuesta a las 02:00 corta a las 18:00 del día anterior. Restar
    // sin aritmética modular daba un número negativo y una hora imposible.
    assert.equal(caffeinePlan({ weightKg: 70, bedtime: '02:00' }).cutoffTime, '18:00');
    assert.equal(caffeinePlan({ weightKg: 70, bedtime: '00:30' }).cutoffTime, '16:30');
});

test('entrenar tarde AVISA del choque; entrenar pronto, no', () => {
    // La toma es 60 min ANTES de entrenar, así que es esa hora la que se compara.
    const tarde = caffeinePlan({ weightKg: 80, bedtime: '23:00', trainingTime: '20:00' });
    assert.equal(tarde.conflict, true, '19:00 está después del corte de las 15:00');

    const pronto = caffeinePlan({ weightKg: 80, bedtime: '23:00', trainingTime: '09:00' });
    assert.equal(pronto.conflict, false);

    // Justo en el límite: entrenar a las 16:00 significa tomarla a las 15:00,
    // que ES el corte.
    assert.equal(caffeinePlan({ weightKg: 80, bedtime: '23:00', trainingTime: '16:00' }).conflict, true);
});

test('el choque se detecta también cuando la ventana cruza la medianoche', () => {
    // Se acuesta a las 02:00, corte a las 18:00: entrenar a las 22:00 (toma a
    // las 21:00) choca, y hacerlo a las 10:00 no.
    const noche = caffeinePlan({ weightKg: 70, bedtime: '02:00', trainingTime: '22:00' });
    assert.equal(noche.conflict, true);
    const mañana = caffeinePlan({ weightKg: 70, bedtime: '02:00', trainingTime: '10:00' });
    assert.equal(mañana.conflict, false);
});

test('sin hora de dormir no se inventa un corte', () => {
    const plan = caffeinePlan({ weightKg: 80 });
    assert.equal(plan.cutoffTime, null);
    assert.equal(plan.conflict, false);
});

test('horas mal escritas se ignoran en vez de producir un corte falso', () => {
    for (const bedtime of ['25:00', '23:99', 'noche', '', '2300']) {
        const plan = caffeinePlan({ weightKg: 80, bedtime });
        assert.equal(plan.cutoffTime, null, `«${bedtime}» produjo un corte`);
    }
});

test('un peso absurdo no produce una dosis absurda', () => {
    for (const weightKg of [0, -70, Number.NaN, /** @type {*} */ ('ochenta')]) {
        const plan = caffeinePlan({ weightKg });
        assert.equal(plan.minMg, 0);
        assert.equal(plan.maxMg, 0);
    }
});

// ============================================================
// Coste
// ============================================================

test('el coste se da como RANGO, nunca como cifra exacta', () => {
    const stack = stackFor({ phase: 'bulk' });
    const coste = stackCost(stack.recommended);
    assert.ok(coste.minEur > 0);
    assert.ok(coste.maxEur >= coste.minEur, 'el rango está invertido');
});

test('el coste de un stack vacío es cero, no NaN', () => {
    assert.deepEqual(stackCost([]), { minEur: 0, maxEur: 0 });
    assert.deepEqual(stackCost(/** @type {*} */ (null)), { minEur: 0, maxEur: 0 });
});

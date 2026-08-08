// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeComposition, planPhases } from '../src/core/engine.js';
import { generateProjection } from '../src/core/generator.js';
import { FLUCTUATION_AMPLITUDE_PCT_BW, CALORIC_FLOOR_KCAL, SCENARIO_PROGRESS_EXPONENTS } from '../src/core/constants.js';
import { seedFrom } from '../src/core/rng.js';

const PROFILE = { sex: /** @type {const} */ ('male'), age: 30, heightCm: 180, activityLevel: /** @type {const} */ ('moderate'), trainingStatus: /** @type {const} */ ('intermediate') };

/** Proyección estándar: hombre 80/20 → 15 % y +2 kg de músculo. */
function standard(opts = {}) {
    const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const target = { fatPct: 15, muscleKg: comp.value.muscleKg + 2 };
    const plan = planPhases(comp.value, target, PROFILE);
    assert.ok(plan.ok);
    const proj = generateProjection(plan.value, comp.value, PROFILE, {
        startDateISO: '2026-08-03',
        seed: seedFrom('p1', '2026-08-03'),
        fluctuation: false,
        ...opts
    });
    assert.ok(proj.ok, JSON.stringify(!proj.ok && proj.errors));
    return { initial: comp.value, target, plan: plan.value, proj: proj.value };
}

test('el día 0 es EXACTAMENTE la composición inicial (cierra GEN-05)', () => {
    const { initial, proj } = standard();
    const d0 = proj.daily[0];
    assert.equal(d0.dayIndex, 0);
    assert.ok(Math.abs(d0.weightKg - initial.weightKg) < 1e-9);
    assert.ok(Math.abs(d0.fatPct - initial.fatPct) < 1e-9);
    assert.ok(Math.abs(d0.muscleKg - initial.muscleKg) < 1e-9);
});

test('determinismo: el último día aterriza EXACTAMENTE en el objetivo', () => {
    const { initial, target, plan, proj } = standard();
    const last = proj.daily.at(-1);
    assert.ok(last);
    assert.equal(last.dayIndex, plan.totalDays);
    assert.ok(Math.abs(last.weightKg - plan.summary.targetWeightKg) < 1e-6, `peso final ${last.weightKg} vs ${plan.summary.targetWeightKg}`);
    assert.ok(Math.abs(last.fatPct - target.fatPct) < 0.01, `%grasa final ${last.fatPct}`);
    assert.ok(Math.abs(last.muscleKg - target.muscleKg) < 1e-6);
    void initial;
});

test('conservacion: peso = grasa + músculo + otra magra CADA día, y la otra magra es constante', () => {
    const { initial, proj } = standard();
    for (const d of proj.daily) {
        assert.ok(Math.abs(d.weightKg - (d.fatKg + d.muscleKg + d.otherLeanKg)) < 1e-9, `día ${d.dayIndex}`);
        assert.ok(Math.abs(d.otherLeanKg - initial.otherLeanKg) < 1e-9, `día ${d.dayIndex}: otherLean varió`);
    }
});

test('fechas UTC puras: un día por punto, sin saltos ni duplicados en el cambio de hora (GEN-02/10)', () => {
    // 2026-03-25 → cruza el cambio al horario de verano europeo (29 de marzo)
    const { proj } = standard({ startDateISO: '2026-03-25' });
    assert.equal(proj.daily[0].dateISO, '2026-03-25');
    const MS = 86400000;
    for (let i = 1; i < proj.daily.length; i++) {
        const prev = Date.parse(proj.daily[i - 1].dateISO + 'T00:00:00Z');
        const cur = Date.parse(proj.daily[i].dateISO + 'T00:00:00Z');
        assert.equal(cur - prev, MS, `salto entre ${proj.daily[i - 1].dateISO} y ${proj.daily[i].dateISO}`);
    }
});

test('determinismo: misma semilla → serie idéntica; la fluctuación NO toca la composición', () => {
    const a = standard({ fluctuation: true, seed: 42 });
    const b = standard({ fluctuation: true, seed: 42 });
    assert.deepEqual(a.proj.daily, b.proj.daily);

    const c = standard({ fluctuation: true, seed: 99 });
    for (let i = 0; i < a.proj.daily.length; i++) {
        // la composición es independiente de la semilla…
        assert.equal(a.proj.daily[i].weightKg, c.proj.daily[i].weightKg);
        assert.equal(a.proj.daily[i].fatKg, c.proj.daily[i].fatKg);
    }
    // …y solo cambia el ruido visual
    assert.ok(a.proj.daily.some((d, i) => d.fluctuationKg !== c.proj.daily[i].fluctuationKg));
});

test('fluctuación: apagada = 0 en todos los puntos; encendida = acotada por la amplitud (B8)', () => {
    const off = standard({ fluctuation: false });
    assert.ok(off.proj.daily.every((d) => d.fluctuationKg === 0));

    const on = standard({ fluctuation: true });
    for (const d of on.proj.daily) {
        assert.ok(Math.abs(d.fluctuationKg) <= FLUCTUATION_AMPLITUDE_PCT_BW * d.weightKg + 1e-12, `día ${d.dayIndex}: ${d.fluctuationKg}`);
    }
});

test('escenarios: pesimista ≤ esperado ≤ optimista en posición de plan, y los tres cierran (B5)', () => {
    const { proj } = standard();
    const T = proj.daily.length - 1;
    /** interpolación lineal del peso esperado en una posición fraccionaria */
    const at = (/** @type {number} */ pos) => {
        const p = Math.min(T, Math.max(0, pos));
        const i = Math.floor(p);
        if (i >= T) return proj.daily[T].weightKg;
        return proj.daily[i].weightKg + (proj.daily[i + 1].weightKg - proj.daily[i].weightKg) * (p - i);
    };
    for (const d of proj.daily) {
        const t = d.dayIndex / T;
        const posP = T * Math.pow(t, SCENARIO_PROGRESS_EXPONENTS.pessimist);
        const posO = T * Math.pow(t, SCENARIO_PROGRESS_EXPONENTS.optimist);
        // orden en posición de plan: el pesimista va por detrás, el optimista por delante
        assert.ok(posP <= d.dayIndex + 1e-9 && d.dayIndex <= posO + 1e-9, `día ${d.dayIndex}`);

        // La banda es la ENVOLVENTE del peso sobre [posP, posO] (E13-8). La
        // versión anterior de este test afirmaba «banda = trayectoria evaluada
        // en los dos extremos», que era EXACTAMENTE el defecto: en una
        // trayectoria no monótona los dos extremos pueden caer al mismo lado
        // del esperado y la banda dibujada no lo contenía. Un test que
        // reimplementa la fórmula defiende la fórmula, no la propiedad.
        //
        // El oráculo recalcula la envolvente por su cuenta: bordes del
        // intervalo más los días enteros interiores (la trayectoria es lineal
        // a trozos, así que los extremos solo pueden estar ahí).
        let lo = Math.min(at(posP), at(posO));
        let hi = Math.max(at(posP), at(posO));
        for (let i = Math.ceil(posP); i <= Math.floor(posO); i++) {
            lo = Math.min(lo, proj.daily[i].weightKg);
            hi = Math.max(hi, proj.daily[i].weightKg);
        }
        const bandLo = Math.min(d.band.pessimistKg, d.band.optimistKg);
        const bandHi = Math.max(d.band.pessimistKg, d.band.optimistKg);
        assert.ok(Math.abs(bandLo - lo) < 1e-9 && Math.abs(bandHi - hi) < 1e-9,
            `día ${d.dayIndex}: banda [${bandLo}, ${bandHi}] ≠ envolvente [${lo}, ${hi}]`);
        // ...y por tanto contiene al esperado, que es lo que el usuario ve.
        assert.ok(d.weightKg >= bandLo - 1e-9 && d.weightKg <= bandHi + 1e-9,
            `día ${d.dayIndex}: esperado fuera de su banda`);
        // Cada campo conserva el LADO de su escenario: solo se ensancha, no se
        // reordena (los consumidores documentan que en pérdida el pesimista es
        // el valor mayor).
        if (at(posP) > at(posO)) assert.ok(d.band.pessimistKg >= d.band.optimistKg, `día ${d.dayIndex}: lados invertidos`);
        if (at(posP) < at(posO)) assert.ok(d.band.pessimistKg <= d.band.optimistKg, `día ${d.dayIndex}: lados invertidos`);
    }
    const last = proj.daily.at(-1);
    assert.ok(last);
    assert.ok(Math.abs(last.band.pessimistKg - last.weightKg) < 1e-6);
    assert.ok(Math.abs(last.band.optimistKg - last.weightKg) < 1e-6);
    assert.equal(proj.scenariosClose, true);
});

test('kcal: presentes cada día, nunca bajo el suelo, y recalculadas semanalmente sobre peso proyectado (B4)', () => {
    const { proj } = standard();
    const floor = CALORIC_FLOOR_KCAL.male;
    const targets = new Set();
    for (const d of proj.daily) {
        assert.ok(Number.isFinite(d.kcal.targetKcal) && d.kcal.targetKcal >= Math.min(floor, d.kcal.tdeeKcal), `día ${d.dayIndex}`);
        targets.add(d.kcal.targetKcal);
    }
    // en un plan de meses con peso decreciente, el objetivo semanal varía:
    assert.ok(targets.size > 3, `solo ${targets.size} objetivos distintos: ¿TDEE no se recalcula?`);
    // y dentro de una misma semana es constante:
    const week1 = proj.daily.filter((d) => d.dayIndex >= 1 && d.dayIndex <= 7);
    assert.equal(new Set(week1.map((d) => d.kcal.targetKcal)).size, 1);
});

test('hitos: derivados del cruce REAL de la serie, sin NaN (GEN-03/04)', () => {
    const { proj } = standard();
    assert.ok(proj.milestones.length > 0);
    for (const m of proj.milestones) {
        assert.ok(Number.isInteger(m.dayIndex) && m.dayIndex >= 0, `hito ${m.id}: día ${m.dayIndex}`);
        assert.match(m.dateISO, /^\d{4}-\d{2}-\d{2}$/);
    }
    // el cruce del 18 % de grasa ocurre justo donde la serie lo cruza:
    const fat18 = proj.milestones.find((m) => m.category === 'fatPct' && m.threshold === 18);
    assert.ok(fat18, 'falta el hito del 18 %');
    const before = proj.daily[fat18.dayIndex - 1];
    const at = proj.daily[fat18.dayIndex];
    assert.ok(before.fatPct > 18 && at.fatPct <= 18, `cruce en día ${fat18.dayIndex}: ${before.fatPct} → ${at.fatPct}`);
    // hay un hito de fase por cada fase:
    const phaseMilestones = proj.milestones.filter((m) => m.category === 'phase');
    assert.ok(phaseMilestones.length >= 4);
});

test('agregado semanal: bloques de 7 días, la semana parcial final va marcada (GEN-07)', () => {
    const { plan, proj } = standard();
    const expectedWeeks = Math.ceil(plan.totalDays / 7);
    assert.equal(proj.weekly.length, expectedWeeks);
    const last = proj.weekly.at(-1);
    assert.ok(last);
    assert.equal(last.partial, plan.totalDays % 7 !== 0);
    for (const w of proj.weekly.slice(0, -1)) assert.equal(w.partial, false);
    // la semana 1 refleja el estado de su último día:
    assert.equal(proj.weekly[0].endWeightKg, proj.daily[7].weightKg);
});

test('agregado mensual: meses de CALENDARIO con parciales marcados (GEN-11/12)', () => {
    const { proj } = standard({ startDateISO: '2026-08-15' });
    assert.ok(proj.monthly.length >= 2);
    const first = proj.monthly[0];
    assert.equal(first.monthISO, '2026-08');
    assert.equal(first.partial, true); // empieza el día 15
    const second = proj.monthly[1];
    assert.equal(second.monthISO, '2026-09');
    assert.equal(second.partial, false); // septiembre completo dentro del plan
});

test('el generador NO muta ni el plan ni la composición ni el perfil (GEN-06)', () => {
    const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const plan = planPhases(comp.value, { fatPct: 15, muscleKg: comp.value.muscleKg + 2 }, PROFILE);
    assert.ok(plan.ok);
    const snaps = [JSON.stringify(plan.value), JSON.stringify(comp.value), JSON.stringify(PROFILE)];
    generateProjection(plan.value, comp.value, PROFILE, { startDateISO: '2026-08-03', seed: 1, fluctuation: true });
    assert.deepEqual([JSON.stringify(plan.value), JSON.stringify(comp.value), JSON.stringify(PROFILE)], snaps);
});

test('entradas inválidas → {ok:false} con Issues, sin lanzar', () => {
    const comp = makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const plan = planPhases(comp.value, { fatPct: 15, muscleKg: comp.value.muscleKg + 2 }, PROFILE);
    assert.ok(plan.ok);
    for (const bad of [
        { startDateISO: 'hoy', seed: 1 },
        { startDateISO: '2026-13-45', seed: 1 },
        { startDateISO: '2026-08-03', seed: NaN }
    ]) {
        const r = generateProjection(plan.value, comp.value, PROFILE, /** @type {*} */ (bad));
        assert.equal(r.ok, false, JSON.stringify(bad));
    }
});

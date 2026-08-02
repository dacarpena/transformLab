// @ts-check

/**
 * Los 7 invariantes del motor (CLAUDE.md §4), como tests con nombre.
 * Deben estar en verde antes de CUALQUIER commit que toque src/core/.
 * Se ejecutan sobre una matriz de perfiles × objetivos que cubre las ramas
 * del planificador, incluidos los 4 perfiles de docs/AUDITORIA.md §1.2.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { makeComposition, targetWeightKg, planPhases } from '../src/core/engine.js';
import { generateProjection } from '../src/core/generator.js';
import {
    ESSENTIAL_FAT_PCT,
    ABSOLUTE_MAX_FAT_PCT,
    CALORIC_FLOOR_KCAL,
    KCAL_PER_KG_FAT,
    KCAL_PER_KG_MUSCLE
} from '../src/core/constants.js';
import { seedFrom } from '../src/core/rng.js';

/** @typedef {import('../src/core/engine.js').UserProfile} UserProfile */

/** Matriz de casos: perfil físico + objetivo, cubriendo todas las ramas. */
const CASES = buildCases();

function buildCases() {
    /** @type {Array<{name: string, weightKg: number, fatPct: number, muscleKg?: number, profile: UserProfile, goal: (m: number) => {fatPct: number, muscleKg: number}}>} */
    const cases = [
        {
            name: 'auditoría-1: hombre 80/20, recomp+cut+bulk',
            weightKg: 80, fatPct: 20,
            profile: { sex: 'male', age: 30, heightCm: 180, activityLevel: 'moderate', trainingStatus: 'intermediate' },
            goal: (m) => ({ fatPct: 15, muscleKg: m + 2 })
        },
        {
            name: 'auditoría-2: mujer 60/28, definición pura',
            weightKg: 60, fatPct: 28,
            profile: { sex: 'female', age: 40, heightCm: 165, activityLevel: 'light', trainingStatus: 'beginner' },
            goal: (m) => ({ fatPct: 22, muscleKg: m })
        },
        {
            name: 'auditoría-3: hombre 95/30, definición larga',
            weightKg: 95, fatPct: 30,
            profile: { sex: 'male', age: 45, heightCm: 175, activityLevel: 'sedentary', trainingStatus: 'beginner' },
            goal: (m) => ({ fatPct: 20, muscleKg: m + 1 })
        },
        {
            name: 'auditoría-4: hombre 70/12, volumen puro',
            weightKg: 70, fatPct: 12,
            profile: { sex: 'male', age: 25, heightCm: 178, activityLevel: 'active', trainingStatus: 'intermediate' },
            goal: (m) => ({ fatPct: 12, muscleKg: m + 3 })
        },
        {
            name: 'ya en objetivo (rama MOT-10)',
            weightKg: 75, fatPct: 18,
            profile: { sex: 'male', age: 35, heightCm: 176, activityLevel: 'moderate', trainingStatus: 'advanced' },
            goal: (m) => ({ fatPct: 18, muscleKg: m })
        },
        {
            name: 'perder músculo a propósito (rama MOT-10)',
            weightKg: 90, fatPct: 18, muscleKg: 42,
            profile: { sex: 'male', age: 33, heightCm: 185, activityLevel: 'active', trainingStatus: 'advanced' },
            goal: (m) => ({ fatPct: 15, muscleKg: m - 3 })
        },
        {
            name: 'mujer pequeña sedentaria: suelo calórico activo (B2)',
            weightKg: 58, fatPct: 34,
            profile: { sex: 'female', age: 55, heightCm: 152, activityLevel: 'sedentary', trainingStatus: 'beginner' },
            goal: (m) => ({ fatPct: 26, muscleKg: m })
        },
        {
            name: 'músculo medido por bioimpedancia (ruta measured)',
            weightKg: 82, fatPct: 22, muscleKg: 35,
            profile: { sex: 'male', age: 28, heightCm: 182, activityLevel: 'moderate', trainingStatus: 'intermediate' },
            goal: (m) => ({ fatPct: 16, muscleKg: m + 1.5 })
        }
    ];
    return cases.map((c) => {
        const comp = makeComposition({ weightKg: c.weightKg, fatPct: c.fatPct, muscleKg: c.muscleKg, sex: c.profile.sex });
        assert.ok(comp.ok, `${c.name}: composición inválida`);
        const target = c.goal(comp.value.muscleKg);
        const plan = planPhases(comp.value, target, c.profile);
        assert.ok(plan.ok, `${c.name}: plan inválido — ${JSON.stringify(!plan.ok && plan.errors)}`);
        const proj = generateProjection(plan.value, comp.value, c.profile, {
            startDateISO: '2026-08-03',
            seed: seedFrom('inv', '2026-08-03'),
            fluctuation: true
        });
        assert.ok(proj.ok, `${c.name}: proyección inválida`);
        return { ...c, initial: comp.value, target, plan: plan.value, proj: proj.value };
    });
}

// ============================================================

test('identidad — pedir la composición actual devuelve el peso actual ±1 kg (los 4 perfiles de la auditoría incluidos)', () => {
    for (const c of CASES) {
        const w = targetWeightKg(c.initial.muscleKg, c.initial.fatPct, c.initial);
        assert.ok(Math.abs(w - c.initial.weightKg) <= 1, `${c.name}: identidad rota — ${w} vs ${c.initial.weightKg}`);
    }
});

test('conservacion — peso = grasa + magro cada día, con magro = músculo + otra magra constante', () => {
    for (const c of CASES) {
        for (const d of c.proj.daily) {
            assert.ok(Math.abs(d.weightKg - (d.fatKg + d.leanKg)) < 1e-9, `${c.name} día ${d.dayIndex}`);
            assert.ok(Math.abs(d.leanKg - (d.muscleKg + d.otherLeanKg)) < 1e-9, `${c.name} día ${d.dayIndex}`);
            assert.ok(Math.abs(d.otherLeanKg - c.initial.otherLeanKg) < 1e-9, `${c.name} día ${d.dayIndex}: otra magra varió`);
        }
    }
});

test('limites — grasa y kcal dentro de rango todos los días de todos los planes', () => {
    for (const c of CASES) {
        const sex = c.profile.sex;
        const floor = CALORIC_FLOOR_KCAL[sex];
        for (const d of c.proj.daily) {
            assert.ok(d.fatPct >= ESSENTIAL_FAT_PCT[sex] - 0.5, `${c.name} día ${d.dayIndex}: grasa ${d.fatPct} bajo la esencial`);
            assert.ok(d.fatPct <= ABSOLUTE_MAX_FAT_PCT, `${c.name} día ${d.dayIndex}: grasa ${d.fatPct} sobre el máximo`);
            assert.ok(d.weightKg > 0 && d.muscleKg > 0 && d.fatKg >= 0, `${c.name} día ${d.dayIndex}: magnitud negativa`);
            assert.ok(Number.isFinite(d.kcal.targetKcal), `${c.name} día ${d.dayIndex}: kcal no finitas`);
            assert.ok(d.kcal.targetKcal >= floor || d.kcal.targetKcal >= d.kcal.tdeeKcal, `${c.name} día ${d.dayIndex}: objetivo ${d.kcal.targetKcal} bajo el suelo ${floor}`);
        }
    }
});

test('determinismo — misma semilla produce serie idéntica y el último día aterriza en el objetivo', () => {
    for (const c of CASES) {
        const again = generateProjection(c.plan, c.initial, c.profile, {
            startDateISO: '2026-08-03',
            seed: seedFrom('inv', '2026-08-03'),
            fluctuation: true
        });
        assert.ok(again.ok);
        assert.deepEqual(again.value.daily, c.proj.daily, `${c.name}: no determinista`);

        const last = c.proj.daily.at(-1);
        assert.ok(last);
        assert.ok(Math.abs(last.weightKg - c.plan.summary.targetWeightKg) < 1e-6, `${c.name}: aterriza en ${last.weightKg}, objetivo ${c.plan.summary.targetWeightKg}`);
        assert.ok(Math.abs(last.muscleKg - c.target.muscleKg) < 1e-6, `${c.name}: músculo final`);
        assert.ok(Math.abs(last.fatPct - c.target.fatPct) < 0.01, `${c.name}: %grasa final ${last.fatPct} vs ${c.target.fatPct}`);
    }
});

test('cierre_de_plan — las expectativas por fase suman exactamente el objetivo y los días suman el total', () => {
    for (const c of CASES) {
        const sumFat = c.plan.phases.reduce((s, p) => s + p.expected.fatDeltaKg, 0);
        const sumMuscle = c.plan.phases.reduce((s, p) => s + p.expected.muscleDeltaKg, 0);
        assert.ok(Math.abs(sumFat - c.plan.summary.fatDeltaKg) < 1e-6, `${c.name}: Σgrasa ${sumFat} vs ${c.plan.summary.fatDeltaKg}`);
        assert.ok(Math.abs(sumMuscle - c.plan.summary.muscleDeltaKg) < 1e-6, `${c.name}: Σmúsculo ${sumMuscle} vs ${c.plan.summary.muscleDeltaKg}`);
        assert.equal(c.plan.phases.reduce((s, p) => s + p.days, 0), c.plan.totalDays, c.name);
        assert.equal(c.proj.daily.length, c.plan.totalDays + 1, `${c.name}: puntos diarios`);
    }
});

test('coherencia_energetica — el déficit acumulado de cada fase equivale a su cambio de composición', () => {
    for (const c of CASES) {
        let dayCursor = 1;
        for (const phase of c.plan.phases) {
            const days = c.proj.daily.slice(dayCursor, dayCursor + phase.days);
            dayCursor += phase.days;
            const sumDeficit = days.reduce((s, d) => s + d.kcal.deficitKcal, 0);
            const expectedEnergy = -(phase.expected.fatDeltaKg * KCAL_PER_KG_FAT + phase.expected.muscleDeltaKg * KCAL_PER_KG_MUSCLE);
            const tolerance = Math.max(Math.abs(expectedEnergy) * 0.15, phase.days * 20);
            assert.ok(
                Math.abs(sumDeficit - expectedEnergy) <= tolerance,
                `${c.name} fase ${phase.type}: Σdéficit ${Math.round(sumDeficit)} kcal vs esperado ${Math.round(expectedEnergy)} (tolerancia ${Math.round(tolerance)})`
            );
        }
    }
});

test('escenarios — pesimista ≤ esperado ≤ optimista en posición de plan y los tres cierran el plan', () => {
    for (const c of CASES) {
        assert.equal(c.proj.scenariosClose, true, c.name);
        const last = c.proj.daily.at(-1);
        assert.ok(last);
        assert.ok(Math.abs(last.band.pessimistKg - last.weightKg) < 1e-6, c.name);
        assert.ok(Math.abs(last.band.optimistKg - last.weightKg) < 1e-6, c.name);
        for (const d of c.proj.daily) {
            assert.ok(Number.isFinite(d.band.pessimistKg) && Number.isFinite(d.band.optimistKg), `${c.name} día ${d.dayIndex}`);
        }
    }
});

// ============================================================
// Pureza del core (criterios de cierre M1 + regla B8)
// ============================================================

/** @param {string} dir @returns {string[]} */
function jsFilesUnder(dir) {
    /** @type {string[]} */ const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...jsFilesUnder(p));
        else if (entry.name.endsWith('.js')) out.push(p);
    }
    return out;
}

test('Math.random está prohibido en TODO src/ (la aleatoriedad sale solo de rng.js)', () => {
    for (const file of jsFilesUnder('src')) {
        const source = readFileSync(file, 'utf8');
        assert.ok(!source.includes('Math.random('), `${file} invoca Math.random`);
    }
});

test('src/core no toca DOM ni window ni localStorage (core puro)', () => {
    const forbidden = /\b(window|document|localStorage|navigator)\s*[.[]/;
    for (const file of jsFilesUnder('src/core')) {
        const source = readFileSync(file, 'utf8');
        assert.ok(!forbidden.test(source), `${file} referencia el DOM o el navegador`);
    }
});

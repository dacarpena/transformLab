// @ts-check

/**
 * E15-2 · Un objetivo de músculo que no gana nada se dice, y se puede corregir.
 *
 * Medido en producción: un perfil real pedía ir de 32,487 a 32,500 kg de
 * músculo en 155 días. **Trece gramos.** El plan proyectaba una línea plana y
 * Chart.js autoescalaba el eje Y a `[32,10 – 32,50]`, de modo que 0,4 kg de
 * oscilación —que es ruido de báscula— llenaban el lienzo y se leían como un
 * desplome muscular catastrófico.
 *
 * E14-1 arregló la cifra que el ASISTENTE propone por defecto. Este test cubre
 * lo que aquello no podía cubrir: un perfil **ya guardado** con el objetivo
 * degenerado, que es el caso de todo el mundo que creó su perfil antes. El
 * aviso lo emite ahora el motor (`core/ranges.js#checkTarget`), así que viaja en
 * `plan.warnings` y Hoy lo pinta en el siguiente arranque, sin migración.
 *
 * Nunca se corrige solo (B9): se avisa y se ofrece la puerta al asistente.
 */

import { test, expect } from '@playwright/test';
import { rootPrefix, SCHEMA_VERSION } from '../../src/data/version.js';

const P = rootPrefix();
const V = SCHEMA_VERSION;
const PROFILE_ID = 'p1';

/**
 * Siembra un perfil con el objetivo de músculo que se le pase, en kilos.
 * El resto de cifras son las del perfil real que se midió en producción.
 */
async function seedConObjetivo(page, targetMuscleKg) {
    await page.goto('/');
    await page.evaluate(({ targetMuscleKg, PROFILE_ID, P, V }) => {
        localStorage.clear();
        localStorage.setItem(`${P}profiles`, JSON.stringify({
            schemaVersion: V, activeProfileId: PROFILE_ID,
            profiles: [{ id: PROFILE_ID, name: 'Dani', createdAtISO: '2026-01-01T00:00:00.000Z' }]
        }));
        localStorage.setItem(`${P}${PROFILE_ID}.profile`, JSON.stringify({
            schemaVersion: V, name: 'Dani', createdAtISO: '2026-01-01T00:00:00.000Z',
            user: { sex: 'male', age: 30, heightCm: 175, activityLevel: 'moderate', trainingStatus: 'beginner' },
            // `muscleKg: null` + `estimated` es el caso mayoritario: casi nadie
            // sabe cuántos kilos de músculo tiene, así que el motor lo deriva.
            initial: { weightKg: 85, fatPct: 22, muscleKg: null, muscleSource: 'estimated' },
            target: { fatPct: 14, muscleKg: targetMuscleKg },
            startDateISO: new Date().toISOString().slice(0, 10),
            intensity: 'moderate'
        }));
        localStorage.setItem(`${P}${PROFILE_ID}.settings`, JSON.stringify({
            schemaVersion: V, locale: 'es', activeMeasures: ['waist'],
            fluctuationVisible: false, reminder: null
        }));
        localStorage.setItem(`${P}${PROFILE_ID}.ui.activeView`, '"today"');
    }, { targetMuscleKg, PROFILE_ID, P, V });
    await page.reload();
    await expect(page.locator('#today-title')).toBeVisible();
}

/** El músculo que el motor deriva para ese perfil, en kilos. */
async function musculoDerivado(page) {
    return page.evaluate(async () => {
        const plans = await import('/src/ui/plan-state.js');
        return plans.get()?.composition.muscleKg ?? null;
    });
}

test('un perfil YA guardado cuyo objetivo no gana músculo recibe el aviso en Hoy', async ({ page }) => {
    await seedConObjetivo(page, 32.5);
    const derivado = await musculoDerivado(page);
    expect(derivado).not.toBeNull();
    // El perfil de producción, reproducido: el objetivo está a un pelo del actual.
    expect(Math.abs(/** @type {number} */ (derivado) - 32.5)).toBeLessThan(0.2);

    const aviso = page.locator('[data-view-id="today"] .notice--warning', { hasText: 'músculo' });
    await expect(aviso).toBeVisible();

    // Y el aviso NO es un callejón sin salida: lleva a donde se corrige (H-013).
    const boton = aviso.locator('[data-edit-target]');
    await expect(boton).toBeVisible();
    await boton.click();
    await expect(page.locator('#onboarding-title')).toBeVisible({ timeout: 5000 });
});

test('el aviso NO aparece con un objetivo de músculo normal', async ({ page }) => {
    // Sin este test, el aviso podría estar saliendo siempre y el primero pasaría igual.
    await seedConObjetivo(page, 36);
    await expect(page.locator('[data-view-id="today"] [data-edit-target]')).toHaveCount(0);
});

test('el objetivo degenerado NO se corrige solo: sigue guardado tal cual (B9)', async ({ page }) => {
    await seedConObjetivo(page, 32.5);
    const guardado = await page.evaluate(({ P, PROFILE_ID }) =>
        JSON.parse(localStorage.getItem(`${P}${PROFILE_ID}.profile`) ?? '{}').target.muscleKg,
    { P, PROFILE_ID });
    expect(guardado).toBe(32.5);
});

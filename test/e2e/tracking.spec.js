// @ts-check

/**
 * E2E de M4-8: el guion del producto entero.
 *
 * onboarding → check-ins → desviación → oferta de recalibración →
 * recalibrar → el historial conserva el plan anterior → la gráfica muestra
 * el plan nuevo con los puntos reales.
 *
 * Los check-ins se siembran en `localStorage` en vez de teclearse uno a uno:
 * hacen falta ocho semanas de historial para cruzar el umbral, y lo que se
 * está probando aquí es el ciclo de seguimiento, no el formulario (que tiene
 * su propio test más abajo).
 */

import { test, expect } from '@playwright/test';

const PROFILE_ID = 'p1';

/** Siembra un perfil canónico que empezó hace `weeksAgo` semanas. */
async function seedProfile(page, { weeksAgo, checkinWeights }) {
    await page.goto('/');
    await page.evaluate(({ weeksAgo, checkinWeights, PROFILE_ID }) => {
        localStorage.clear();
        const days = weeksAgo * 7;
        const iso = (offsetDays) =>
            new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
        const start = iso(days);

        localStorage.setItem('tl.5.profiles', JSON.stringify({
            schemaVersion: 5, activeProfileId: PROFILE_ID,
            profiles: [{ id: PROFILE_ID, name: 'Dani', createdAtISO: '2026-01-01T00:00:00.000Z' }]
        }));
        localStorage.setItem(`tl.5.${PROFILE_ID}.profile`, JSON.stringify({
            schemaVersion: 5, name: 'Dani', createdAtISO: '2026-01-01T00:00:00.000Z',
            user: { sex: 'male', age: 30, heightCm: 175, activityLevel: 'moderate', trainingStatus: 'intermediate' },
            initial: { weightKg: 75, fatPct: 20, muscleKg: null, muscleSource: 'estimated' },
            target: { fatPct: 12, muscleKg: 30 },
            startDateISO: start, intensity: 'moderate'
        }));
        localStorage.setItem(`tl.5.${PROFILE_ID}.settings`, JSON.stringify({
            schemaVersion: 5, locale: 'es', activeMeasures: ['waist'],
            fluctuationVisible: false, reminder: null
        }));
        const items = checkinWeights.map((weightKg, i) => {
            const dateISO = iso(days - (i + 1) * 7);
            return {
                id: `ci_${dateISO}`, dateISO, weightKg, fatPct: null,
                measuresCm: { waist: 88 },
                subjective: { adherence: 8, energy: 6, sleep: 7, motivation: 6 },
                notes: '', createdAtISO: '2026-01-01T00:00:00.000Z', editedAtISO: null
            };
        });
        localStorage.setItem(`tl.5.${PROFILE_ID}.checkins`, JSON.stringify({ schemaVersion: 5, items }));
        localStorage.setItem(`tl.5.${PROFILE_ID}.ui.activeView`, '"today"');
    }, { weeksAgo, checkinWeights, PROFILE_ID });
    await page.reload();
}

test('un usuario que sigue el plan NO recibe la oferta de recalibrar', async ({ page }) => {
    // pesos que siguen la proyección de cerca, con ruido normal de báscula
    await seedProfile(page, { weeksAgo: 9, checkinWeights: [74.8, 74.4, 74.5, 74.0, 73.6, 73.4, 73.0, 72.8] });
    await expect(page.locator('#today-title')).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(page.locator('.signal--within').first()).toBeVisible();
});

test('el guion completo: estancamiento → oferta → recalibrar → historial', async ({ page }) => {
    // ocho semanas sin mover la báscula
    await seedProfile(page, { weeksAgo: 9, checkinWeights: [75, 75, 75, 75, 75, 75, 75, 75] });

    // 1 · la app OFRECE, no impone
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/por encima del plan/i);

    // 2 · el plan anterior, antes de tocar nada
    const before = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('tl.5.p1.plan') ?? 'null')?.current?.totalDays ?? null);

    // 3 · recalibrar
    await page.click('[data-accept]');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#today-title')).toBeVisible();

    // 4 · el historial conserva el plan anterior
    const after = await page.evaluate(() => {
        const plan = JSON.parse(localStorage.getItem('tl.5.p1.plan') ?? 'null');
        const profile = JSON.parse(localStorage.getItem('tl.5.p1.profile') ?? 'null');
        const checkins = JSON.parse(localStorage.getItem('tl.5.p1.checkins') ?? 'null');
        return {
            history: plan?.history?.length ?? 0,
            archivedReason: plan?.history?.[0]?.reason ?? null,
            archivedDays: plan?.history?.[0]?.plan?.totalDays ?? null,
            currentDays: plan?.current?.totalDays ?? null,
            startsFromRealWeight: profile?.initial?.weightKg ?? null,
            goalFat: profile?.target?.fatPct ?? null,
            goalMuscle: profile?.target?.muscleKg ?? null,
            muscleSource: profile?.initial?.muscleSource ?? null,
            checkinsKept: checkins?.items?.length ?? 0
        };
    });

    expect(after.history).toBe(1);
    expect(after.archivedReason).toBe('recalibration');
    if (before !== null) expect(after.archivedDays).toBe(before);
    // el plan nuevo parte del peso REAL, no del proyectado
    expect(after.startsFromRealWeight).toBe(75);
    // y conserva la meta y el origen del músculo (A3)
    expect(after.goalFat).toBe(12);
    expect(after.goalMuscle).toBe(30);
    expect(after.muscleSource).toBe('estimated');
    // los check-ins no se tocan al recalibrar
    expect(after.checkinsKept).toBe(8);

    // 5 · la gráfica sigue dibujándose con el plan nuevo
    await expect(page.locator('[data-canvas]')).toBeVisible();
    await expect(page.locator('.chart-wrap .state--error')).toHaveCount(0);
});

test('rechazar mantiene el plan intacto y no vuelve a preguntar', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 9, checkinWeights: [75, 75, 75, 75, 75, 75, 75, 75] });
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    const before = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('tl.5.p1.plan') ?? 'null'));

    await page.click('[data-decline]');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    // el plan no ha cambiado
    const after = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('tl.5.p1.plan') ?? 'null'));
    expect(after).toEqual(before);

    // y al recargar NO se vuelve a insistir con los mismos datos
    await page.reload();
    await expect(page.locator('#today-title')).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});

test('registrar un check-in desde el formulario y verlo en el historial', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [] });

    await page.click('[data-view="checkin"]');
    await expect(page.locator('[data-field="weightKg"]')).toBeVisible();

    await page.fill('[data-field="weightKg"]', '73.6');
    await page.fill('[data-field="fatPct"]', '18.5');
    await page.click('[data-save]');

    // aparece en el historial de la propia vista
    await expect(page.locator('.profile-item').first()).toContainText('73.6');

    // y en Progreso, con su señal de desviación
    await page.click('[data-view="progress"]');
    await expect(page.locator('.signal').first()).toBeVisible();
    await expect(page.getByText(/Constancia|Consistency/)).toBeVisible();
});

test('un check-in con fecha fuera del plan se rechaza con mensaje', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [] });
    await page.click('[data-view="checkin"]');

    await page.fill('[data-field="dateISO"]', '2020-01-01');
    await page.fill('[data-field="weightKg"]', '73');
    await page.click('[data-save]');

    await expect(page.locator('[data-messages]')).toContainText(/fuera de tu plan/i);
});

test('el peso es obligatorio y el resto no', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [] });
    await page.click('[data-view="checkin"]');

    await page.click('[data-save]');
    await expect(page.locator('[data-messages]')).toContainText(/obligatorio/i);

    // solo con el peso, se guarda
    await page.fill('[data-field="weightKg"]', '74.2');
    await page.click('[data-save]');
    await expect(page.locator('.profile-item').first()).toContainText('74.2');
});

test('borrar un check-in pide confirmación y lo elimina', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [74.5, 74.0] });
    await page.click('[data-view="checkin"]');

    // el formulario abre en la fecha de hoy, sin check-in: se edita uno existente
    await page.locator('[data-edit]').first().click();
    await expect(page.locator('[data-delete]')).toBeVisible();

    await page.click('[data-delete]');
    await page.click('[data-confirm-go]');

    const remaining = await page.evaluate(() =>
        JSON.parse(localStorage.getItem('tl.5.p1.checkins') ?? 'null')?.items?.length ?? -1);
    expect(remaining).toBe(1);
});

test('sin check-ins, Progreso muestra su estado vacío con acción directa', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [] });
    await page.click('[data-view="progress"]');

    await expect(page.locator('.state--empty')).toBeVisible();
    await page.click('[data-action="go-checkin"]');
    await expect(page.locator('[data-field="weightKg"]')).toBeVisible();
});

test('no hay errores de consola en el ciclo de seguimiento completo', async ({ page }) => {
    /** @type {string[]} */ const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));

    await seedProfile(page, { weeksAgo: 9, checkinWeights: [75, 75, 75, 75, 75, 75, 75, 75] });
    await page.click('[data-accept]');
    await page.click('[data-view="progress"]');
    await page.click('[data-view="checkin"]');
    await page.click('[data-view="today"]');

    expect(errors).toEqual([]);
});

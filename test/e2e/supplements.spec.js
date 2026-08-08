// @ts-check

/**
 * E2E de la suplementación (V2-M5).
 *
 * El cribado de seguridad es lo que más importa que funcione en el navegador
 * real: es la única parte de la app cuyo fallo no es un número mal puesto.
 */

import { test, expect } from '@playwright/test';

const CANONICAL = {
    name: 'Dani',
    trainingStatus: 'intermediate',
    weightKg: '80',
    fatPct: '20',
    targetFatPct: '13',
    targetMuscleKg: '32'
};

async function completeOnboarding(page) {
    await page.fill('[data-field="name"]', CANONICAL.name);
    await page.selectOption('[data-field="trainingStatus"]', CANONICAL.trainingStatus);
    await page.click('[data-next]');
    await page.fill('[data-field="weightKg"]', CANONICAL.weightKg);
    await page.fill('[data-field="fatPct"]', CANONICAL.fatPct);
    await page.click('[data-next]');
    await page.fill('[data-field="targetFatPct"]', CANONICAL.targetFatPct);
    await page.fill('[data-field="targetMuscleKg"]', CANONICAL.targetMuscleKg);
    await page.click('[data-next]');
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();
}

async function goToSupplements(page) {
    const directo = page.locator('[data-view="supplements"]');
    if (await directo.count() === 0 || !(await directo.first().isVisible())) {
        await page.locator('[data-nav-more]').click();
    }
    await directo.first().click();
    await expect(page.locator('#stack-title')).toBeVisible();
}

const stack = (page) => page.locator('[aria-labelledby="stack-title"]');

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await completeOnboarding(page);
});

test('el stack sale ordenado por evidencia, con el nivel a la vista', async ({ page }) => {
    await goToSupplements(page);
    await expect(stack(page)).toContainText('Creatina');
    await expect(stack(page).locator('.badge--ev-strong').first()).toBeVisible();
    // Nada de lo recomendado puede llevar la insignia de «sin respaldo».
    await expect(stack(page).locator('.badge--ev-none')).toHaveCount(0);
});

test('cribado_duro · marcar ansiedad retira la cafeína del stack y dice por qué', async ({ page }) => {
    await goToSupplements(page);
    await expect(stack(page)).toContainText('Cafeína');

    await page.locator('[data-flag="anxiety"]').check();

    await expect(stack(page)).not.toContainText('Cafeína');
    // Y aparece entre los retirados, con el motivo: quitarla en silencio deja al
    // usuario comprándola en otro sitio sin saber por qué.
    const retirados = page.locator('[aria-labelledby="removed-title"]');
    await expect(retirados).toContainText('Cafeína');
    await expect(retirados).toContainText('Ansiedad');
});

test('cribado_duro · el cribado persiste al salir y volver', async ({ page }) => {
    await goToSupplements(page);
    await page.locator('[data-flag="hypertension"]').check();
    await expect(stack(page)).not.toContainText('Cafeína');

    await page.locator('[data-view="today"]').first().click();
    await goToSupplements(page);
    // Una restricción de seguridad que se olvida al navegar no es una
    // restricción.
    await expect(page.locator('[data-flag="hypertension"]')).toBeChecked();
    await expect(stack(page)).not.toContainText('Cafeína');
});

test('lo que no funciona se enseña igualmente, marcado', async ({ page }) => {
    await goToSupplements(page);
    const bloque = page.locator('[aria-labelledby="noev-title"]');
    await expect(bloque).toContainText('BCAA');
    await expect(bloque.locator('.badge--ev-none').first()).toBeVisible();
});

test('el aviso de que esto no es consejo médico está en pantalla', async ({ page }) => {
    await goToSupplements(page);
    await expect(stack(page)).toContainText(/no es consejo médico/i);
});

test('el usuario puede descartar un suplemento y devolverlo', async ({ page }) => {
    await goToSupplements(page);
    await stack(page).locator('[data-exclude="creatine"]').click();
    await expect(stack(page)).not.toContainText('Creatina');

    const mios = page.locator('[aria-labelledby="mine-title"]');
    await expect(mios).toContainText('Creatina');
    await mios.locator('[data-include="creatine"]').click();
    await expect(stack(page)).toContainText('Creatina');
});

test('la cafeína trae su dosis por peso y avisa si entrenas tarde', async ({ page }) => {
    await goToSupplements(page);
    const tarjeta = page.locator('[aria-labelledby="caffeine-title"]');
    // 80 kg × 3–6 mg/kg = 240–480 mg.
    await expect(tarjeta).toContainText('240');
    await expect(tarjeta).toContainText('480');

    await tarjeta.locator('[data-bedtime]').fill('23:00');
    await expect(tarjeta).toContainText('15:00');
    await tarjeta.locator('[data-training-time]').fill('20:00');
    // Se AVISA; no se cambia nada por el usuario (B9).
    await expect(tarjeta.locator('.notice--warning')).toBeVisible();
});

test('a 320 px la vista no desborda a lo ancho', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await goToSupplements(page);
    const desborda = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(desborda).toBe(false);
});

test('no hay errores de consola en el recorrido de suplementos', async ({ page }) => {
    /** @type {string[]} */ const errores = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errores.push(msg.text()); });
    page.on('pageerror', (err) => errores.push(String(err)));

    await goToSupplements(page);
    await page.locator('[data-flag="anxiety"]').check();
    await page.locator('[data-flag="anxiety"]').uncheck();
    await stack(page).locator('[data-exclude]').first().click();
    expect(errores).toEqual([]);
});

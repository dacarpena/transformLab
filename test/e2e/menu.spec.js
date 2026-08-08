// @ts-check

/**
 * E2E del menú del día (V2-M3).
 *
 * Lo que solo se ve en un navegador real: que el solver corre sobre la base
 * sembrada sin bloquear la vista, que el menú aparece DESPUÉS de las macros (que
 * no dependen de él), y que «otra opción» cambia una comida sin romper el día.
 */

import { test, expect } from '@playwright/test';

const CANONICAL = {
    name: 'Dani',
    trainingStatus: 'intermediate',
    weightKg: '85',
    fatPct: '22',
    targetFatPct: '14',
    targetMuscleKg: '34'
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

async function goToNutrition(page) {
    await page.locator('[data-view="nutrition"]').first().click();
    await expect(page.locator('#macros-title')).toBeVisible();
    // El menú llega después: la base de alimentos se carga tras el primer
    // pintado, a propósito.
    await expect(page.locator('#menu-title')).toBeVisible({ timeout: 15000 });
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            const req = indexedDB.deleteDatabase('tl-foods');
            req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
        });
    });
    await page.reload();
    await completeOnboarding(page);
});

test('el menú propone comida de verdad, con gramos', async ({ page }) => {
    await goToNutrition(page);
    const comidas = page.locator('.menu-meal');
    await expect(comidas).toHaveCount(4);
    // Con gramos: el reparto en macros ya existía y no sirve para cocinar.
    await expect(comidas.first().locator('.profile-item').first()).toContainText(/\d+ g/);
    await expect(page.locator('[data-view-id="nutrition"]')).toContainText('Total del día');
});

test('las macros del día se ven ANTES de que cargue la base de alimentos', async ({ page }) => {
    await page.locator('[data-view="nutrition"]').first().click();
    // Las macros no dependen del catálogo, así que esperar 2 000 alimentos para
    // enseñar cuatro cifras ya calculadas sería castigar al usuario.
    await expect(page.locator('#macros-title')).toBeVisible();
    await expect(page.locator('.metric__value').first()).not.toBeEmpty();
});

test('«otra opción» cambia una comida y mantiene el resto', async ({ page }) => {
    await goToNutrition(page);
    const primera = page.locator('.menu-meal').first();
    const segunda = page.locator('.menu-meal').nth(1);
    const antes = await primera.innerText();
    const segundaAntes = await segunda.innerText();

    await primera.locator('[data-regenerate-meal]').click();
    await expect(primera).not.toHaveText(antes);
    await expect(segunda).toHaveText(segundaAntes);
});

test('«otro menú» rehace el día entero', async ({ page }) => {
    await goToNutrition(page);
    const menu = page.locator('[aria-labelledby="menu-title"]');
    const antes = await menu.innerText();
    await page.click('[data-regenerate-menu]');
    await expect(menu).not.toHaveText(antes);
});

test('cambiar el número de comidas rehace el menú con ese número', async ({ page }) => {
    await goToNutrition(page);
    await expect(page.locator('.menu-meal')).toHaveCount(4);
    // El objetivo por comida cambia, así que el menú anterior deja de
    // corresponder a nada.
    await page.locator('[data-meal-count]').fill('3');
    await page.locator('[data-meal-count]').dispatchEvent('input');
    await expect(page.locator('.menu-meal')).toHaveCount(3);
});

test('a 320 px el menú no desborda a lo ancho', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await goToNutrition(page);
    const desborda = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(desborda).toBe(false);
});

test('no hay errores de consola generando y regenerando el menú', async ({ page }) => {
    /** @type {string[]} */ const errores = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errores.push(msg.text()); });
    page.on('pageerror', (err) => errores.push(String(err)));

    await goToNutrition(page);
    await page.click('[data-regenerate-menu]');
    await page.locator('[data-regenerate-meal]').first().click();
    expect(errores).toEqual([]);
});

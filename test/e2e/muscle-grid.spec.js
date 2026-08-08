// @ts-check

/**
 * E2E de la proyección músculo a músculo (V2-M9).
 *
 * Dos cosas importan aquí por encima del resto: que la pantalla DIGA que es una
 * estimación —presentarlo como dato repetiría a escala fina el error que hundió
 * la v4.0— y que exista la versión accesible de la rejilla, que es la tabla.
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

async function goToProjection(page) {
    const directo = page.locator('[data-view="projection"]');
    if (await directo.count() === 0 || !(await directo.first().isVisible())) {
        await page.locator('[data-nav-more]').click();
    }
    await directo.first().click();
    await expect(page.locator('#muscle-grid-title')).toBeVisible();
    await expect(page.locator('.muscle-card').first()).toBeVisible({ timeout: 15000 });
}

const rejilla = (page) => page.locator('[aria-labelledby="muscle-grid-title"]');

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await completeOnboarding(page);
});

test('la rejilla pinta los diez grupos con su gráfica y su banda', async ({ page }) => {
    await goToProjection(page);
    await expect(page.locator('.muscle-card')).toHaveCount(10);
    await expect(page.locator('.muscle-spark')).toHaveCount(10);

    // Y las gráficas tienen geometría de verdad, no un `path` vacío.
    const conDatos = await page.evaluate(() =>
        [...document.querySelectorAll('.muscle-spark__line')]
            .filter((p) => (p.getAttribute('d') ?? '').length > 10).length);
    expect(conDatos).toBe(10);
    const bandas = await page.evaluate(() =>
        [...document.querySelectorAll('.muscle-spark__band')]
            .filter((p) => (p.getAttribute('d') ?? '').length > 10).length);
    expect(bandas).toBe(10);
});

test('cada grupo va rotulado como ESTIMACIÓN, y la rejilla lo explica', async ({ page }) => {
    await goToProjection(page);
    // Presentarlo como dato repetiría, a escala fina, el error que hundió la
    // v4.0. No es un adorno: es el requisito de la milestone.
    await expect(page.locator('.badge--estimate')).toHaveCount(10);
    await expect(rejilla(page)).toContainText(/No es una medición/);
    await expect(rejilla(page)).toContainText(/desagregación de tu proyección/);
});

test('se dice que las cifras son de músculo esquelético, no de la báscula', async ({ page }) => {
    await goToProjection(page);
    // Trasladar el desfase de una báscula de cuerpo entero a un bíceps le
    // atribuiría a ese músculo el agua y el hueso de todo el cuerpo.
    await expect(rejilla(page)).toContainText(/músculo esquelético/);
});

test('sin entreno registrado se DICE que el reparto es anatómico medio', async ({ page }) => {
    await goToProjection(page);
    await expect(rejilla(page)).toContainText(/proporciones anatómicas medias/);
});

test('la tabla es la versión accesible de la rejilla, no un extra', async ({ page }) => {
    await goToProjection(page);
    // Diez gráficas con su propia región aria-live competirían entre ellas; una
    // tabla es lo que un lector de pantalla sabe recorrer.
    const tabla = rejilla(page).locator('.data-table');
    await page.locator('.muscle-grid__table summary').click();
    await expect(tabla).toBeVisible();
    await expect(tabla.locator('caption')).not.toBeEmpty();
    await expect(tabla.locator('tbody tr')).toHaveCount(10);
    await expect(tabla.locator('tbody th[scope="row"]').first()).not.toBeEmpty();
});

test('a 320 px la rejilla cabe en dos columnas y no desborda', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await goToProjection(page);
    const desborda = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(desborda).toBe(false);

    // Uno por pantalla sería una lista con dibujos, no small multiples.
    const columnas = await page.evaluate(() => {
        const cards = [...document.querySelectorAll('.muscle-card')];
        if (cards.length < 2) return 0;
        const top = cards[0].getBoundingClientRect().top;
        return cards.filter((c) => Math.abs(c.getBoundingClientRect().top - top) < 2).length;
    });
    expect(columnas).toBeGreaterThanOrEqual(2);
});

test('no hay errores de consola en la vista de proyección con la rejilla', async ({ page }) => {
    /** @type {string[]} */ const errores = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errores.push(msg.text()); });
    page.on('pageerror', (err) => errores.push(String(err)));
    await goToProjection(page);
    // Un fallo del cortafuegos se registra por consola: este test también lo
    // atrapa.
    expect(errores).toEqual([]);
});

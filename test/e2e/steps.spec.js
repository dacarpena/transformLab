// @ts-check

/**
 * E2E de pasos / NEAT (V2-M7).
 *
 * Lo que importa comprobar en el navegador es que la pantalla DICE que estas
 * calorías no se suman al objetivo. Es la única defensa que tiene el usuario
 * contra el doble conteo, porque el error es invisible desde fuera: el número
 * saldría igual de plausible estando mal.
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

async function goToExpenditure(page) {
    const directo = page.locator('[data-view="expenditure"]');
    if (await directo.count() === 0 || !(await directo.first().isVisible())) {
        await page.locator('[data-nav-more]').click();
    }
    await directo.first().click();
    await expect(page.locator('#steps-title')).toBeVisible();
}

const pasos = (page) => page.locator('[aria-labelledby="steps-title"]');

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await completeOnboarding(page);
});

test('la pantalla DICE que estas calorías no se suman al objetivo', async ({ page }) => {
    await goToExpenditure(page);
    // Es la única defensa del usuario contra el doble conteo: el número saldría
    // igual de plausible estando mal.
    await expect(pasos(page)).toContainText(/NO se suman/);
    await expect(pasos(page)).toContainText(/contar lo mismo dos veces/);
});

test('el objetivo sale del nivel declarado, no de un 10 000 universal', async ({ page }) => {
    await goToExpenditure(page);
    // El perfil canónico es «moderate» → 8 500.
    await expect(pasos(page)).toContainText('8500');
    await expect(pasos(page)).not.toContainText('10000 pasos al día');
});

test('apuntar pasos por encima del nivel muestra la DIFERENCIA, no el bruto', async ({ page }) => {
    await goToExpenditure(page);
    await pasos(page).locator('[data-field="steps"]').fill('13000');
    await pasos(page).locator('[data-save-steps]').click();

    await expect(pasos(page)).toContainText('4500');

    // Lo que se comprueba es la MAGNITUD, no un número exacto: el peso del día 0
    // sale de la proyección y atarlo a una cifra haría fallar el test por un
    // cambio del motor que no rompe nada. 4 500 pasos de más a ~80 kg son ~205
    // kcal; el bruto de 13 000 son ~595, casi el triple.
    const texto = await pasos(page).innerText();
    const delta = Number(texto.match(/unas (\d+) kcal extra/)?.[1]);
    expect(delta).toBeGreaterThan(180);
    expect(delta).toBeLessThan(240);
    expect(texto).not.toMatch(/\b59\d kcal extra/);
});

test('andar MENOS de lo declarado se dice, y explica que la báscula no baje', async ({ page }) => {
    await goToExpenditure(page);
    await pasos(page).locator('[data-field="steps"]').fill('2000');
    await pasos(page).locator('[data-save-steps]').click();
    await expect(pasos(page)).toContainText(/MENOS/);
    await expect(pasos(page)).toContainText(/báscula no baja/);
});

test('el canje se ofrece como escenario, no como consejo', async ({ page }) => {
    await goToExpenditure(page);
    await expect(pasos(page)).toContainText(/tú decides/);
});

test('volver a apuntar el mismo día sustituye, no duplica', async ({ page }) => {
    await goToExpenditure(page);
    await pasos(page).locator('[data-field="steps"]').fill('9000');
    await pasos(page).locator('[data-save-steps]').click();
    await pasos(page).locator('[data-field="steps"]').fill('11000');
    await pasos(page).locator('[data-save-steps]').click();

    const guardado = await page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.endsWith('.steps'));
        return key ? JSON.parse(localStorage.getItem(key) ?? 'null') : null;
    });
    // Corregir una cifra mal tecleada no puede dejar las dos: la media de la
    // semana saldría inflada por el error que el usuario creía haber arreglado.
    expect(guardado.items.length).toBe(1);
    expect(guardado.items[0].steps).toBe(11000);
});

test('a 320 px la tarjeta de pasos no desborda', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await goToExpenditure(page);
    const desborda = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(desborda).toBe(false);
});

test('no hay errores de consola apuntando pasos', async ({ page }) => {
    /** @type {string[]} */ const errores = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errores.push(msg.text()); });
    page.on('pageerror', (err) => errores.push(String(err)));
    await goToExpenditure(page);
    await pasos(page).locator('[data-field="steps"]').fill('7500');
    await pasos(page).locator('[data-save-steps]').click();
    expect(errores).toEqual([]);
});

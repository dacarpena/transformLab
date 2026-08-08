// @ts-check

/**
 * E2E de alimentos, recetas y despensa (V2-M2).
 *
 * Lo que solo se puede comprobar en un navegador real: que la base de 2 000
 * alimentos se siembra en IndexedDB y se busca sin bloquear la escritura, que
 * la procedencia de cada cifra se VE, que los macros de una receta salen de sus
 * ingredientes, y que todo eso ocurre bajo la CSP `'self'` de producción.
 */

import { test, expect } from '@playwright/test';

const CANONICAL = {
    name: 'Dani',
    trainingStatus: 'intermediate',
    weightKg: '75',
    fatPct: '20',
    targetFatPct: '12',
    targetMuscleKg: '30'
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

async function goToFoods(page) {
    // `foods` es `primary: false`, así que en la barra vive detrás de «más».
    // A ancho de escritorio el botón está siempre; a 320 px hay que desplegarlo.
    const directo = page.locator('[data-view="foods"]');
    if (await directo.count() === 0 || !(await directo.first().isVisible())) {
        await page.locator('[data-nav-more]').click();
    }
    await page.locator('[data-view="foods"]').first().click();
    // La base tarda en sembrarse; esperar al buscador es esperar a que esté.
    await expect(page.locator('[data-food-search]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(async () => {
        // IndexedDB también, o la siembra del test anterior falsea este.
        await new Promise((resolve) => {
            const req = indexedDB.deleteDatabase('tl-foods');
            req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
        });
    });
    await page.reload();
    await completeOnboarding(page);
});

test('la base se siembra y la búsqueda encuentra alimentos reales', async ({ page }) => {
    await goToFoods(page);
    await page.fill('[data-food-search]', 'pollo');
    const filas = page.locator('[data-food-results] li');
    await expect(filas.first()).toBeVisible();
    // Lo que la ordenación GARANTIZA es que el genérico verificado va antes que
    // la marca: quien escribe «pollo» quiere el pollo, no la lasaña de pollo de
    // una marca. Cuál de los dos genéricos de pollo sale primero es un desempate
    // por longitud del nombre, y afirmarlo aquí sería atar el test a un detalle
    // que puede cambiar con el catálogo sin que nada esté roto.
    await expect(filas.first()).toContainText('pollo');
    await expect(filas.first()).toContainText('genérico verificado');
    await expect(filas.first().locator('.badge--usda')).toBeVisible();
});

test('la procedencia de cada alimento se VE, y distingue genérico de marca', async ({ page }) => {
    await goToFoods(page);
    await page.fill('[data-food-search]', 'yogur');
    await expect(page.locator('[data-food-results] .badge--usda').first()).toBeVisible();
    await expect(page.locator('[data-food-results] .badge--off').first()).toBeVisible();
});

test('escribir en el buscador no roba el foco ni el cursor', async ({ page }) => {
    await goToFoods(page);
    const input = page.locator('[data-food-search]');
    await input.click();
    // Tecla a tecla: recrear el input en cada pulsación haría imposible escribir.
    await page.keyboard.type('arroz', { delay: 30 });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('arroz');
    await expect(page.locator('[data-food-results] li').first()).toBeVisible();
});

test('la cobertura se declara con cifras, sin fingir exhaustividad', async ({ page }) => {
    await goToFoods(page);
    const vista = page.locator('[data-view-id="foods"]');
    await expect(vista).toContainText(/genéricos verificados/);
    await expect(vista).toContainText(/Lo que NO cubre/);
});

test('una receta deriva sus macros de los ingredientes', async ({ page }) => {
    await goToFoods(page);
    await page.fill('[data-food-search]', 'arroz blanco crudo');
    await page.locator('[data-add-ingredient]').first().click();

    await page.fill('[data-field="recipeName"]', 'Arroz sin más');
    await page.fill('[data-field="recipeServings"]', '2');
    await page.click('[data-save-recipe]');

    // 100 g de arroz crudo = 365 kcal; entre 2 raciones, 182,5 → 183 (redondeo).
    const guardada = page.locator('[data-view-id="foods"] .profile-item', { hasText: 'Arroz sin más' });
    await expect(guardada).toContainText('183 kcal');
    await expect(guardada).toContainText('2 raciones');

    // Y NO se guardan congeladas: en el almacén solo hay ingredientes.
    const persistida = await page.evaluate(() => {
        const raw = Object.keys(localStorage).find((k) => k.endsWith('.recipes'));
        return raw ? JSON.parse(localStorage.getItem(raw) ?? 'null') : null;
    });
    expect(persistida.items[0].ingredients.length).toBe(1);
    expect(persistida.items[0].macros).toBeUndefined();
});

test('una receta sin ingredientes se rechaza con su motivo', async ({ page }) => {
    await goToFoods(page);
    await page.fill('[data-field="recipeName"]', 'Aire');
    await page.click('[data-save-recipe]');
    await expect(page.locator('.toast')).toContainText(/al menos un ingrediente/);
    await expect(page.locator('[data-view-id="foods"]')).toContainText('Todavía no tienes recetas');
});

test('la despensa fusiona lo mismo y no fusiona lo distinto', async ({ page }) => {
    await goToFoods(page);
    await page.fill('[data-field="pantryName"]', 'Arroz');
    await page.fill('[data-field="pantryQuantity"]', '1000');
    await page.click('[data-add-pantry]');
    await page.fill('[data-field="pantryName"]', 'arroz');
    await page.fill('[data-field="pantryQuantity"]', '500');
    await page.click('[data-add-pantry]');

    const items = page.locator('[data-view-id="foods"] .profile-item', { hasText: 'rroz ·' });
    await expect(items).toHaveCount(1);
    await expect(items.first()).toContainText('1500');
});

test('a 320 px la vista no desborda a lo ancho', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await goToFoods(page);
    await page.fill('[data-food-search]', 'yogur');
    await expect(page.locator('[data-food-results] li').first()).toBeVisible();
    const desborda = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(desborda).toBe(false);
});

test('no hay errores de consola al recorrer alimentos', async ({ page }) => {
    /** @type {string[]} */ const errores = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errores.push(msg.text()); });
    page.on('pageerror', (err) => errores.push(String(err)));

    await goToFoods(page);
    await page.fill('[data-food-search]', 'pollo');
    await page.locator('[data-add-ingredient]').first().click();
    await page.fill('[data-field="recipeName"]', 'Prueba');
    await page.click('[data-save-recipe]');
    await page.locator('[data-delete-recipe]').first().click();

    expect(errores).toEqual([]);
});

// @ts-check

/**
 * E2E de la lista de la compra (V2-M4).
 *
 * Lo que solo se comprueba en un navegador: que la lista corresponde al menú que
 * el usuario está viendo (no a otro equivalente), que agrupa por pasillo, y que
 * marcar como comprado cierra el bucle menú → compra → despensa.
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

/**
 * Pulsa la entrada de navegación de Compra, abriendo antes la hoja «Más» si la
 * pestaña no está a la vista. NO afirma nada sobre lo que se pinta: sin plan, la
 * vista es un estado vacío y no tiene `#shopping-title`.
 */
async function navegarACompra(page) {
    const directo = page.locator('[data-view="shopping"]');
    if (await directo.count() === 0 || !(await directo.first().isVisible())) {
        await page.locator('[data-nav-more]').click();
    }
    await directo.first().click();
}

async function goToShopping(page) {
    await navegarACompra(page);
    await expect(page.locator('#shopping-title')).toBeVisible({ timeout: 15000 });
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

test('la lista sale del menú, agrupada por pasillo', async ({ page }) => {
    await goToShopping(page);
    const grupos = page.locator('.shopping-group');
    await expect(grupos.first()).toBeVisible();
    // Agrupada por pasillo: así se recorre el súper una vez y no hay que ir y
    // volver, que es lo que pasa con una lista alfabética.
    expect(await grupos.count()).toBeGreaterThan(1);
    await expect(page.locator('[data-view-id="shopping"]')).toContainText(/por comprar/);
});

test('la lista corresponde al menú que se ve en Nutrición', async ({ page }) => {
    await page.locator('[data-view="nutrition"]').first().click();
    await expect(page.locator('#menu-title')).toBeVisible({ timeout: 15000 });
    const primerAlimento = await page.locator('.menu-meal').first()
        .locator('.profile-item').first().innerText();
    const nombre = primerAlimento.split('\n')[0].trim();

    await goToShopping(page);
    // Si la compra construyera el menú con otra semilla o con otro número de
    // comidas, la lista sería de un menú que el usuario nunca ha visto.
    await expect(page.locator('[data-view-id="shopping"]')).toContainText(nombre);
});

test('marcar como comprado lo mete en la despensa y la lista lo descuenta', async ({ page }) => {
    await goToShopping(page);
    const primera = page.locator('[data-bought]').first();
    const linea = page.locator('.profile-item', { has: primera }).first();
    const nombre = (await linea.innerText()).split('\n')[0].trim();

    await primera.click();
    await expect(page.locator('.toast')).toContainText(/despensa/);

    // El bucle cierra: la misma línea aparece ya cubierta.
    const cubierta = page.locator('.profile-item', { hasText: nombre }).first();
    await expect(cubierta).toContainText(/Ya lo tienes|en casa/);

    const pantry = await page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.endsWith('.pantry'));
        return key ? JSON.parse(localStorage.getItem(key) ?? 'null') : null;
    });
    expect(pantry.items.length).toBe(1);
    // Con `foodId`: es lo que hace que la próxima lista lo descuente sin
    // depender de cómo esté escrito el nombre.
    expect(pantry.items[0].foodId).toBeTruthy();
});

test('cambiar el orden no cambia las cantidades', async ({ page }) => {
    await goToShopping(page);
    const totales = page.locator('[data-view-id="shopping"] .numeric').last();
    const antes = await totales.innerText();

    await page.selectOption('[data-sort]', 'name');
    await expect(page.locator('.shopping-group')).toHaveCount(0, { timeout: 5000 });
    await expect(totales).toHaveText(antes);

    await page.selectOption('[data-sort]', 'aisle');
    await expect(page.locator('.shopping-group').first()).toBeVisible();
    await expect(totales).toHaveText(antes);
});

test('sin plan, la compra ofrece crear uno y el botón LLEVA al asistente', async ({ page }) => {
    // Este test se llamaba así y no navegaba a Compra (E15-1). Vaciaba
    // `localStorage`, recargaba, y comprobaba
    // `.onboarding !== null || innerText.includes('plan')`: sin almacén la app
    // sale al asistente, la primera rama se cumple SIEMPRE, y el test pasaba sin
    // haber pintado jamás el estado que decía comprobar. Debajo de ese verde
    // vivían dos defectos: el botón mostraba el literal `today.createPlan`
    // porque la clave no existía en ningún diccionario, y no tenía oyente.
    //
    // Vaciar el almacén NO sirve para reproducirlo: `route()` manda al asistente
    // antes de montar ninguna vista, así que Compra no llega a existir. Hay que
    // entrar en Compra CON plan y quitarle el plan a la vista.
    await goToShopping(page);
    await expect(page.locator('[data-view-id="shopping"]')).toBeVisible();

    await page.evaluate(async () => {
        const plans = await import('/src/ui/plan-state.js');
        plans.clear();
    });
    // Repintar la vista sin plan: se sale y se vuelve, que es lo que haría un
    // usuario cuyo perfil dejó de poder construirse. Sin `goToShopping`, porque
    // ese ayudante espera `#shopping-title` y el estado vacío no lo tiene.
    await page.locator('[data-view="today"]').click();
    await navegarACompra(page);

    const boton = page.locator('[data-view-id="shopping"] [data-action="go-onboarding"]');
    await expect(boton).toBeVisible();

    // 1. La etiqueta está traducida: si la clave faltara, el botón mostraría
    //    literalmente `today.createPlan`, que es lo que hacía.
    await expect(boton).not.toHaveText(/today\.createPlan/);
    await expect(boton).toHaveText(/plan/i);

    // 2. Y lleva a alguna parte. Sin oyente, esto se queda en Compra para
    //    siempre: un callejón sin salida (ficha H-013).
    await boton.click();
    await expect(page.locator('#onboarding-title')).toBeVisible({ timeout: 5000 });
});

test('a 320 px la lista no desborda a lo ancho', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await goToShopping(page);
    const desborda = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(desborda).toBe(false);
});

test('no hay errores de consola en el ciclo de compra', async ({ page }) => {
    /** @type {string[]} */ const errores = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errores.push(msg.text()); });
    page.on('pageerror', (err) => errores.push(String(err)));

    await goToShopping(page);
    await page.locator('[data-bought]').first().click();
    await page.selectOption('[data-sort]', 'owned');
    await page.selectOption('[data-sort]', 'expiry');
    expect(errores).toEqual([]);
});

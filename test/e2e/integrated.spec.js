// @ts-check

/**
 * E2E de cierre de la v2 (V2-M10): el alta graduada y el plan integral.
 *
 * Es el recorrido que prueba que los siete módulos son UN producto: alta →
 * plan → «Hoy» resume cada módulo con su siguiente acción → cada línea lleva a
 * su vista → el bucle se cierra con el check-in y la ingesta.
 *
 * `preview_no_reconstruye` vive aquí y no en los unitarios porque es sobre el
 * foco y el cursor, y eso solo se comprueba en un navegador de verdad.
 */

import { test, expect } from '@playwright/test';

async function completeOnboarding(page, { modules = [] } = {}) {
    await page.fill('[data-field="name"]', 'Dani');
    await page.selectOption('[data-field="trainingStatus"]', 'intermediate');
    await page.click('[data-next]');
    await page.fill('[data-field="weightKg"]', '85');
    await page.fill('[data-field="fatPct"]', '22');
    await page.click('[data-next]');
    await page.fill('[data-field="targetFatPct"]', '14');
    await page.fill('[data-field="targetMuscleKg"]', '34');
    await page.click('[data-next]');
    for (const id of modules) await page.locator(`[data-module="${id}"]`).check();
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
});

// ============================================================
// preview_no_reconstruye
// ============================================================

test('preview_no_reconstruye · teclear en el alta no pierde el foco ni el cursor', async ({ page }) => {
    await page.fill('[data-field="name"]', 'Dani');
    await page.click('[data-next]');

    const peso = page.locator('[data-field="weightKg"]');
    await peso.click();
    await peso.fill('');
    // Tecla a tecla: si el formulario se reconstruyera, el foco saltaría y
    // escribir sería imposible. Es la promesa de M3 y la v2 la hereda entera.
    await page.keyboard.type('82.5', { delay: 40 });
    await expect(peso).toBeFocused();
    await expect(peso).toHaveValue('82.5');

    // Y el CURSOR sigue al final, no al principio: un repintado lo devolvería
    // a cero y la siguiente tecla escribiría del revés.
    const cursor = await peso.evaluate((el) => /** @type {HTMLInputElement} */ (el).selectionStart);
    // Los `input[type=number]` no exponen `selectionStart` (devuelven null); lo
    // que sí se puede afirmar es que seguir tecleando AÑADE al final.
    await page.keyboard.type('9');
    await expect(peso).toHaveValue('82.59');
    if (cursor !== null) expect(cursor).toBe('82.5'.length);

    // Y la preview SÍ se ha refrescado con lo tecleado.
    await expect(page.locator('[data-preview]')).not.toBeEmpty();
});

// ============================================================
// El alta graduada
// ============================================================

test('el alta pregunta por el nivel de control y por los módulos', async ({ page }) => {
    await page.fill('[data-field="name"]', 'Dani');
    await page.click('[data-next]');
    await page.fill('[data-field="weightKg"]', '85');
    await page.fill('[data-field="fatPct"]', '22');
    await page.click('[data-next]');
    await page.fill('[data-field="targetFatPct"]', '14');
    await page.click('[data-next]');

    await expect(page.locator('[data-control="coached"]')).toBeVisible();
    await expect(page.locator('[data-control="manual"]')).toBeVisible();
    // Nutrición y Entreno SÍ aparecen como casilla, marcadas: vienen activos de
    // fábrica pero se pueden quitar. Quien no quiere que le planifiquen la
    // comida debe poder decirlo, no encontrarse la sección igualmente.
    await expect(page.locator('[data-module="nutrition"]')).toBeChecked();
    await expect(page.locator('[data-module="training"]')).toBeChecked();
    await expect(page.locator('[data-module="shopping"]')).not.toBeChecked();
});

test('bajar el nivel de control DESACTIVA los módulos que ese nivel no muestra', async ({ page }) => {
    await page.fill('[data-field="name"]', 'Dani');
    await page.click('[data-next]');
    await page.fill('[data-field="weightKg"]', '85');
    await page.fill('[data-field="fatPct"]', '22');
    await page.click('[data-next]');
    await page.fill('[data-field="targetFatPct"]', '14');
    await page.click('[data-next]');

    await page.click('[data-control="manual"]');
    await page.locator('[data-module="recovery"]').check();
    await expect(page.locator('[data-module="recovery"]')).toBeChecked();

    // Dejarlo activo pero invisible configuraría el producto a espaldas del
    // usuario, que es justo lo que el nivel de control existe para evitar.
    await page.click('[data-control="coached"]');
    await expect(page.locator('[data-module="recovery"]')).toHaveCount(0);
    await page.click('[data-control="manual"]');
    await expect(page.locator('[data-module="recovery"]')).not.toBeChecked();
});

test('el alta dice cuántas preguntas va a hacer', async ({ page }) => {
    await page.fill('[data-field="name"]', 'Dani');
    await page.click('[data-next]');
    await page.fill('[data-field="weightKg"]', '85');
    await page.fill('[data-field="fatPct"]', '22');
    await page.click('[data-next]');
    await page.fill('[data-field="targetFatPct"]', '14');
    await page.click('[data-next]');
    // La longitud del cuestionario se percibe como rigor si se anuncia; como
    // carga, si sorprende.
    await expect(page.locator('.card', { hasText: 'preguntas en total' })).toBeVisible();
});

// ============================================================
// plan_funcional_con_defaults, en el navegador
// ============================================================

test('plan_funcional_con_defaults · sin activar NADA opcional, el plan funciona', async ({ page }) => {
    await completeOnboarding(page);

    // Hoy resume, y hay plan.
    await expect(page.locator('#plan-summary-title')).toBeVisible();
    await expect(page.locator('#today-title')).toBeVisible();

    // Y los módulos de fábrica dan sus cifras.
    const resumen = page.locator('[aria-labelledby="plan-summary-title"]');
    await expect(resumen).toContainText('Nutrición');
    await expect(resumen).toContainText('Entrenamiento');
    await expect(resumen).toContainText(/kcal/);
    // Lo que no se activó no aparece.
    await expect(resumen).not.toContainText('Suplementos');
});

// ============================================================
// El plan integral
// ============================================================

test('«Hoy» da UNA línea por módulo y cada una lleva a su vista', async ({ page }) => {
    await completeOnboarding(page, { modules: ['shopping', 'supplements', 'steps'] });

    const resumen = page.locator('[aria-labelledby="plan-summary-title"]');
    await expect(resumen).toContainText('Compra');
    await expect(resumen).toContainText('Suplementos');
    await expect(resumen).toContainText('Pasos');

    // La línea de suplementos lleva a suplementos, no a otra parte.
    const fila = resumen.locator('.profile-item', { hasText: 'Suplementos' });
    await fila.locator('[data-go-module]').click();
    await expect(page.locator('#stack-title')).toBeVisible();
});

test('un módulo sin datos DICE qué le falta y ofrece la salida', async ({ page }) => {
    await completeOnboarding(page, { modules: ['steps'] });
    const resumen = page.locator('[aria-labelledby="plan-summary-title"]');
    const fila = resumen.locator('.profile-item', { hasText: 'Pasos' });
    // Esconderlo haría que el usuario no supiera que existe; fingir el número es
    // lo que hundió la v4.0.
    await expect(fila).toContainText(/Sin pasos apuntados/);
    await expect(fila.locator('[data-go-module]')).toBeVisible();
});

test('el bucle se declara: qué falta para que el plan se ajuste solo', async ({ page }) => {
    await completeOnboarding(page);
    const resumen = page.locator('[aria-labelledby="plan-summary-title"]');
    // Sin esto la app esperaría catorce días a tener datos que nadie le está
    // dando, en silencio.
    await expect(resumen).toContainText(/Para que el plan se ajuste solo, falta/);
    await expect(resumen).toContainText(/check-in/);
});

test('a 320 px el plan integral no desborda', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await completeOnboarding(page, { modules: ['shopping', 'supplements', 'steps'] });
    const desborda = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(desborda).toBe(false);
});

test('no hay errores de consola en el alta ni en el plan integral', async ({ page }) => {
    /** @type {string[]} */ const errores = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errores.push(msg.text()); });
    page.on('pageerror', (err) => errores.push(String(err)));

    await completeOnboarding(page, { modules: ['shopping', 'steps'] });
    await page.locator('[data-go-module]').first().click();
    expect(errores).toEqual([]);
});

// @ts-check

/**
 * Carreras del router con vistas diferidas (M6-5).
 *
 * Al diferir las vistas con `import()`, `navigate()` pasó a tener un `await`
 * en medio, y con él la posibilidad de que dos navegaciones estén en vuelo a
 * la vez. Estos tests provocan la carrera a propósito retrasando la petición
 * del módulo: es un caso normalísimo en un móvil con mala cobertura, y sin el
 * testigo de navegación la aplicación acababa mostrando B y creyendo estar
 * en A.
 */

import { test, expect } from '@playwright/test';

async function completeOnboarding(page) {
    await page.fill('[data-field="name"]', 'Dani');
    await page.selectOption('[data-field="trainingStatus"]', 'intermediate');
    await page.click('[data-next]');
    await page.fill('[data-field="weightKg"]', '75');
    await page.fill('[data-field="fatPct"]', '20');
    await page.click('[data-next]');
    await page.fill('[data-field="targetFatPct"]', '12');
    await page.fill('[data-field="targetMuscleKg"]', '30');
    await page.click('[data-next]');
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await completeOnboarding(page);
});

test('una vista lenta que llega tarde NO pisa a la que el usuario eligió después', async ({ page }) => {
    // La vista de hitos tarda 3 s en llegar (arrastra el catálogo de 34 KB)
    await page.route('**/src/ui/views/milestones.js', async (route) => {
        await new Promise((r) => setTimeout(r, 3000));
        await route.continue();
    });

    // El usuario pulsa Hitos, se cansa de esperar y pulsa Entreno
    await page.locator('[data-view="milestones"]').click();
    await page.waitForTimeout(150);
    await page.locator('[data-view="training"]').click();
    await expect(page.locator('.view[data-view-id="training"] .card').first()).toBeVisible();

    // Pasa de sobra el tiempo en el que la vista lenta llega
    await page.waitForTimeout(3500);

    // Lo que ve el usuario es lo que eligió
    await expect(page.locator('.view[data-view-id="training"]')).toBeVisible();
    await expect(page.locator('.view[data-view-id="milestones"]')).toHaveCount(0);

    // Y la aplicación cree lo mismo: barra de navegación y vista persistida
    const state = await page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.endsWith('.ui.activeView'));
        return {
            persistida: key ? JSON.parse(localStorage.getItem(key)) : null,
            marcada: document.querySelector('.nav-item[aria-current="page"]')?.getAttribute('data-view')
        };
    });
    expect(state.persistida, 'se persistió la vista que el usuario abandonó').toBe('training');
    expect(state.marcada, 'la barra marca la vista equivocada').toBe('training');

    // Y al recargar aterriza donde estaba, no en la abandonada
    await page.unroute('**/src/ui/views/milestones.js');
    await page.reload();
    await expect(page.locator('.view[data-view-id="training"]')).toBeVisible();
});

/**
 * El camino de «el módulo de la vista no llega».
 *
 * Solo existe en la PRIMERA visita: en cuanto el service worker se instala,
 * precachea las 55 piezas y el `import()` se sirve del caché sin tocar la red
 * — que es exactamente lo que queremos en producción. Por eso estos tests
 * bloquean el service worker: sin eso, `page.route` ni siquiera se dispara,
 * porque las peticiones que hace el SW no pasan por él.
 */
test.describe('cuando el módulo de una vista no llega', () => {
    test.use({ serviceWorkers: 'block' });

test('se muestra un error con salida no destructiva', async ({ page }) => {
    await page.route('**/src/ui/views/photos.js', (route) => route.abort('failed'));

    await page.locator('[data-view="photos"]').click();

    // Ni pantalla en blanco ni cuelgue: un estado de error anunciado
    const state = page.locator('.view[data-view-id="photos"] .state--error');
    await expect(state).toBeVisible();
    await expect(state).toHaveAttribute('role', 'alert');

    // La salida que ofrece NO puede ser destructiva (ficha H-013)
    const acciones = await state.locator('button').allTextContents();
    expect(acciones.length, 'un error sin ninguna salida es un callejón').toBeGreaterThan(0);
    for (const texto of acciones) {
        expect(texto.toLowerCase()).not.toMatch(/borrar|delete|restablecer|reset/);
    }

    // Y el resto de la aplicación sigue viva: se puede seguir navegando
    await page.locator('[data-view="today"]').click();
    await expect(page.locator('#today-title')).toBeVisible();
});

test('un import fallido no se recupera sin recargar, y por eso la salida es recargar', async ({ page }) => {
    let falla = true;
    await page.route('**/src/ui/views/milestones.js', (route) => (
        falla ? route.abort('failed') : route.continue()
    ));

    await page.locator('[data-view="milestones"]').click();
    await expect(page.locator('.view[data-view-id="milestones"] .state--error')).toBeVisible();

    // Vuelve la red. Volver a entrar NO basta: el navegador memoriza el fallo
    // de un `import()` en su mapa de módulos y devuelve la misma promesa
    // rechazada para siempre. No es cosa nuestra y no se puede sortear sin
    // duplicar la instancia del módulo (y con ella su estado).
    falla = false;
    await page.locator('[data-view="today"]').click();
    await page.locator('[data-view="milestones"]').click();
    await expect(page.locator('.view[data-view-id="milestones"] .state--error')).toBeVisible();

    // Por eso la salida que ofrece el estado de error es RECARGAR: es la única
    // que funciona de verdad, y no toca ni un dato del usuario.
    await page.locator('.view[data-view-id="milestones"] [data-action="reload"]').click();
    await expect(page.locator('#today-title').or(page.locator('.view[data-view-id="milestones"] .card').first())).toBeVisible();

    await page.locator('[data-view="milestones"]').click();
    await expect(page.locator('.view[data-view-id="milestones"] .card').first()).toBeVisible();
    await expect(page.locator('.view[data-view-id="milestones"] .state--error')).toHaveCount(0);

    // Y los datos del usuario siguen ahí tras la recarga
    await page.locator('[data-view="today"]').click();
    await expect(page.locator('#today-title')).toBeVisible();
});

});

test('cambiar de perfil mientras carga una vista no la monta sobre el perfil nuevo', async ({ page }) => {
    await page.route('**/src/ui/views/body.js', async (route) => {
        await new Promise((r) => setTimeout(r, 2500));
        await route.continue();
    });

    await page.locator('[data-view="body"]').click();
    await page.waitForTimeout(150);

    // Crear otro perfil resetea el router mientras `body` sigue en vuelo
    await page.evaluate(async () => {
        const profiles = await import('/src/data/profiles.js');
        profiles.create('Segundo', { createdAtISO: new Date().toISOString() });
    });
    await page.reload();
    await page.waitForTimeout(3000);

    // No se ha colado la silueta del perfil viejo
    await expect(page.locator('.view[data-view-id="body"]')).toHaveCount(0);
    const errores = await page.evaluate(() => document.querySelectorAll('.state--error').length);
    expect(errores).toBe(0);
});

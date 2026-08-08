// @ts-check

/**
 * E2E de los módulos satélite (M5-8). Comprueba lo que solo se puede
 * comprobar en un navegador real: que todas las vistas montan, que la barra
 * inferior sigue siendo usable a 320 px con diez secciones, y que la tarjeta
 * compartible no filtra peso ni %grasa mientras nadie lo pida.
 */

import { test, expect } from '@playwright/test';
import { VIEW_IDS } from '../../src/ui/views/_manifest.js';

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

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await completeOnboarding(page);
});

// Del manifiesto, no de una lista a mano: era una de las tres copias que
// había que acordarse de actualizar al añadir una vista (M7-3).
const VIEWS = VIEW_IDS;

test('todas las vistas montan sin error de consola', async ({ page }) => {
    /** @type {string[]} */ const errors = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    for (const id of VIEWS) {
        await page.evaluate((v) => {
            /** @type {HTMLElement | null} */
            const button = document.querySelector(`[data-view="${v}"]`);
            button?.click();
        }, id);
        // Cada vista deja contenido propio en su contenedor
        await expect(page.locator(`.view[data-view-id="${id}"]`)).toBeVisible();
        await expect(page.locator(`.view[data-view-id="${id}"] .card, .view[data-view-id="${id}"] .state`).first()).toBeVisible();
    }
    expect(errors).toEqual([]);
});

test('a 320 px la barra inferior pliega las secciones sobrantes tras «más»', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });

    // Con TODAS las pestañas visibles los objetivos táctiles caerían muy por
    // debajo de 44 px: se pliegan las que no son primarias tras «más».
    const visibleTabs = page.locator('.nav-list__item:visible');
    await expect(visibleTabs).toHaveCount(5);   // 4 primarias + «más»

    const more = page.locator('[data-nav-more]');
    await expect(more).toHaveAttribute('aria-expanded', 'false');

    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    // Desplegada: todas las vistas del manifiesto más el botón «más».
    await expect(page.locator('.nav-list__item:visible')).toHaveCount(VIEW_IDS.length + 1);

    // Escape repliega y devuelve el foco al botón que la abrió
    await page.keyboard.press('Escape');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await expect(more).toBeFocused();

    // Y no hay desborde horizontal con la hoja desplegada
    await more.click();
    const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
});

test('navegar desde la hoja la repliega y monta la vista elegida', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await page.locator('[data-nav-more]').click();
    await page.locator('[data-view="milestones"]').click();

    await expect(page.locator('.view[data-view-id="milestones"]')).toBeVisible();
    await expect(page.locator('[data-nav-more]')).toHaveAttribute('aria-expanded', 'false');
});

test('sin mediciones, la tarjeta no puede publicar cifras: ni siquiera se ofrece', async ({ page }) => {
    // Antes caían aquí el peso y el %grasa PROYECTADOS y se imprimían con el
    // mismo formato que una medición. Una proyección no es un dato del usuario.
    await page.locator('[data-view="achievements"]').click();

    await expect(page.locator('[data-card]')).toHaveAttribute('aria-label', /%/);
    await expect(page.locator('[data-card]')).not.toHaveAttribute('aria-label', /kg/);
    await expect(page.locator('[data-absolutes]')).toBeDisabled();
});

test('con un check-in real, el opt-in de peso y %grasa funciona en los dos sentidos', async ({ page }) => {
    await page.locator('[data-view="checkin"]').click();
    await page.fill('[data-field="weightKg"]', '74.2');
    await page.fill('[data-field="fatPct"]', '19.4');
    await page.locator('[data-save]').click();

    await page.locator('[data-view="achievements"]').click();
    await expect(page.locator('[data-card]')).not.toHaveAttribute('aria-label', /kg/);

    await page.locator('[data-absolutes]').check();
    await expect(page.locator('[data-card]')).toHaveAttribute('aria-label', /74,2 kg/);

    // Desmarcar vuelve a ocultarlos: el opt-in no es de un solo sentido
    await page.locator('[data-absolutes]').uncheck();
    await expect(page.locator('[data-card]')).not.toHaveAttribute('aria-label', /kg/);
});

test('el consentimiento no se hereda al volver a la vista', async ({ page }) => {
    await page.locator('[data-view="checkin"]').click();
    await page.fill('[data-field="weightKg"]', '74.2');
    await page.locator('[data-save]').click();

    await page.locator('[data-view="achievements"]').click();
    await page.locator('[data-absolutes]').check();
    await expect(page.locator('[data-card]')).toHaveAttribute('aria-label', /kg/);

    // Salir y volver: la casilla arranca apagada otra vez, como promete su
    // comentario. Vivía en el módulo y sobrevivía incluso al cambio de perfil.
    await page.locator('[data-view="today"]').click();
    await page.locator('[data-view="achievements"]').click();
    await expect(page.locator('[data-absolutes]')).not.toBeChecked();
    await expect(page.locator('[data-card]')).not.toHaveAttribute('aria-label', /kg/);
});

test('la rutina de entrenamiento se crea, registra y detecta el récord', async ({ page }) => {
    await page.locator('[data-view="training"]').click();
    await expect(page.locator('.state--empty')).toBeVisible();

    await page.locator('[data-add-exercise]').click();
    await page.fill('[data-name]', 'Press banca');
    await page.fill('[data-sets]', '4');
    await page.fill('[data-reps]', '8');
    await page.locator('.modal [data-go]').click();

    // Acotado a la tarjeta de la RUTINA: desde V2-M6 la vista también lista los
    // diez grupos musculares, y un `.profile-item` a secas resuelve a once.
    const rutina = page.locator('[aria-labelledby="routine-title"]');
    await expect(rutina.locator('.profile-item')).toContainText('Press banca');

    // Primera sesión: NO es récord, es el primer registro
    await page.locator('[data-log-session]').click();
    await page.fill('[data-log-load]', '60');
    await page.locator('.modal [data-go]').click();
    await expect(page.locator('.toast')).not.toContainText('Récord');

    // Segunda, más pesada: ahí sí
    await page.locator('[data-log-session]').click();
    await page.fill('[data-log-load]', '70');
    await page.locator('.modal [data-go]').click();
    await expect(rutina.locator('.profile-item').first()).toContainText('70,0 kg');
});

test('la silueta dibuja los tres estados con la misma regla', async ({ page }) => {
    await page.locator('[data-view="body"]').click();

    const figures = page.locator('.silhouette');
    await expect(figures).toHaveCount(3);

    // Cada figura se anuncia con su etiqueta y su índice cintura/hombros
    for (let i = 0; i < 3; i += 1) {
        await expect(figures.nth(i).locator('svg')).toHaveAttribute('aria-label', /0,\d\d/);
    }

    // Y las tres caben en pantalla a la vez: ninguna desborda a lo alto
    const { tallest, viewport } = await page.evaluate(() => ({
        tallest: Math.max(...[...document.querySelectorAll('.silhouette svg')]
            .map((s) => s.getBoundingClientRect().height)),
        viewport: window.innerHeight
    }));
    expect(tallest).toBeLessThanOrEqual(viewport * 0.5);
});

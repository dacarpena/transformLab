// @ts-check

/**
 * Smoke E2E (M3-8). Recorre el producto con el **perfil canónico** de
 * `docs/VERIFICACION-MANUAL.md` §3, el mismo con el que el legacy producía
 * un peso objetivo de 45,5 kg.
 *
 * Cubre además los criterios de cierre de M3 que solo se pueden comprobar en
 * un navegador real: teclado, `Escape` en modales, 320 px sin desborde.
 */

import { test, expect } from '@playwright/test';

/** Perfil canónico: músculo VACÍO (la ruta por defecto, sin bioimpedancia). */
const CANONICAL = {
    name: 'Dani',
    trainingStatus: 'intermediate',
    weightKg: '75',
    fatPct: '20',
    targetFatPct: '12',
    targetMuscleKg: '30'
};

/** Completa el asistente de 4 pasos. */
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
});

test('onboarding completo con el perfil canónico lleva al dashboard', async ({ page }) => {
    await expect(page.locator('#onboarding-title')).toBeVisible();
    await completeOnboarding(page);

    // El defecto central del legacy: para este perfil daba 45,5 kg.
    const summary = page.locator('.plan-summary__weight');
    await expect(summary.first()).toHaveText('75,0 kg');
    await expect(summary.last()).toHaveText('68,9 kg');

    // Y las cifras se declaran como proyección, no como medición
    await expect(page.locator('.projection-note__tag')).toBeVisible();
});

test('la preview del plan se actualiza en vivo sin perder el foco', async ({ page }) => {
    await page.fill('[data-field="name"]', 'X');
    await page.click('[data-next]');

    const fat = page.locator('[data-field="fatPct"]');
    await fat.fill('25');
    // el campo que se está editando conserva el foco tras el re-render
    await expect(fat).toBeFocused();
    await expect(page.locator('[data-preview]')).toContainText('kg');
});

test('el músculo se marca como estimado o medido según lo introduzca el usuario', async ({ page }) => {
    await page.click('[data-next]');
    const source = page.locator('[data-muscle-source]');
    await expect(source).toHaveText(/[Ee]stimado/);

    await page.fill('[data-field="muscleKg"]', '33');
    await expect(source).toHaveText(/[Mm]edido/);

    await page.fill('[data-field="muscleKg"]', '');
    await expect(source).toHaveText(/[Ee]stimado/);
});

test('la navegación cambia de vista y recargar conserva la vista activa', async ({ page }) => {
    await completeOnboarding(page);

    await page.click('[data-view="settings"]');
    await expect(page.getByRole('heading', { name: /Ajustes|Settings/ }).first()).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: /Ajustes|Settings/ }).first()).toBeVisible();
});

test('la gráfica se dibuja y se puede recorrer con el teclado', async ({ page }) => {
    await completeOnboarding(page);

    const canvas = page.locator('[data-canvas]');
    await expect(canvas).toBeVisible();
    await expect(page.locator('.chart-wrap .state--error')).toHaveCount(0);

    const readout = page.locator('[data-readout]');
    await expect(readout).toContainText('Día 0');

    await canvas.focus();
    await page.keyboard.press('ArrowRight');
    await expect(readout).toContainText('Día 1');
    await page.keyboard.press('End');
    await expect(readout).toContainText('Día 170');
});

test('Escape cierra el modal y devuelve el foco a quien lo abrió', async ({ page }) => {
    await completeOnboarding(page);
    await page.click('[data-view="settings"]');

    const opener = page.locator('[data-new-profile]');
    await opener.click();
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(opener).toBeFocused();
});

test('el foco queda atrapado dentro del modal', async ({ page }) => {
    await completeOnboarding(page);
    await page.click('[data-view="settings"]');
    await page.click('[data-new-profile]');

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // muchos tabuladores no consiguen sacar el foco del diálogo
    for (let i = 0; i < 12; i++) await page.keyboard.press('Tab');
    const inside = await page.evaluate(() =>
        document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false);
    expect(inside).toBe(true);
});

test('borrar un perfil exige teclear su nombre exacto', async ({ page }) => {
    await completeOnboarding(page);
    await page.click('[data-view="settings"]');
    await page.click('[data-delete-profile]');

    const go = page.locator('[data-confirm-go]');
    await expect(go).toBeDisabled();

    await page.fill('[data-confirm-input]', 'nombre incorrecto');
    await expect(go).toBeDisabled();
});

test('el onboarding es recorrible solo con el teclado', async ({ page }) => {
    await page.keyboard.press('Tab'); // enlace de salto
    let reached = false;
    for (let i = 0; i < 25 && !reached; i++) {
        await page.keyboard.press('Tab');
        reached = await page.evaluate(() =>
            document.activeElement?.hasAttribute('data-next') ?? false);
    }
    expect(reached).toBe(true);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-field="weightKg"]')).toBeVisible();
});

test('a 320 px no hay desbordamiento horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await completeOnboarding(page);

    const overflow = await page.evaluate(() => ({
        doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        // y ningún elemento se sale de la ventana
        widest: Math.max(...[...document.querySelectorAll('body *')]
            .map((el) => el.getBoundingClientRect().right))
    }));
    expect(overflow.doc).toBeLessThanOrEqual(0);
    expect(overflow.widest).toBeLessThanOrEqual(321);
});

test('a 320 px la navegación es de pestañas inferiores', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await completeOnboarding(page);
    const nav = page.locator('[data-nav]');
    const position = await nav.evaluate((el) => getComputedStyle(el).position);
    expect(position).toBe('fixed');
});

test('cambiar de idioma traduce la interfaz y persiste', async ({ page }) => {
    await completeOnboarding(page);
    await page.click('[data-view="settings"]');
    await page.selectOption('[data-locale]', 'en');

    await expect(page.locator('[data-view="today"]')).toContainText('Today');
    await page.reload();
    await expect(page.locator('[data-view="today"]')).toContainText('Today');
    expect(await page.evaluate(() => document.documentElement.lang)).toBe('en');
});

test('no hay errores de consola en el recorrido completo', async ({ page }) => {
    /** @type {string[]} */ const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));

    await completeOnboarding(page);
    await page.click('[data-view="progress"]');
    await page.click('[data-view="settings"]');
    await page.click('[data-view="today"]');

    expect(errors).toEqual([]);
});

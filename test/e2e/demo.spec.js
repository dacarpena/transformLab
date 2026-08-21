// @ts-check

/**
 * El perfil de ejemplo, en un navegador real (E15-10).
 *
 * Lo que solo se comprueba aquí: que la banda de «datos simulados» aparece en
 * TODAS las vistas, que los datos reales del usuario siguen intactos mientras el
 * ejemplo está activo, y que borrarlo no deja ni una clave detrás.
 *
 * La ficha H-035 del catálogo —una demo que se hacía pasar por real— es la razón
 * de que este fichero exista.
 */

import { test, expect } from '@playwright/test';
import { rootPrefix } from '../../src/data/version.js';
import { VIEW_IDS } from '../../src/ui/views/_manifest.js';

const P = rootPrefix();

/** Alta canónica: deja un perfil REAL con un check-in propio. */
async function conPerfilReal(page) {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.fill('[data-field="name"]', 'Dani');
    await page.selectOption('[data-field="trainingStatus"]', 'intermediate');
    await page.click('[data-next]');
    await page.fill('[data-field="weightKg"]', '75');
    await page.fill('[data-field="fatPct"]', '20');
    await page.click('[data-next]');
    await page.fill('[data-field="targetFatPct"]', '12');
    await page.fill('[data-field="targetMuscleKg"]', '33');
    await page.click('[data-next]');
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();

    await page.fill('[data-quick-weight]', '74.8');
    await page.click('[data-quick-save]');
    await expect.poll(() => contarCheckins(page, 'p1')).toBe(1);
}

async function contarCheckins(page, profileId) {
    return page.evaluate(({ P, profileId }) => {
        const raw = localStorage.getItem(`${P}${profileId}.checkins`);
        return raw ? JSON.parse(raw).items.length : -1;
    }, { P, profileId });
}

async function irAAjustes(page) {
    await expect(page.locator('[data-nav]')).toBeVisible();
    const entrada = page.locator('[data-view="settings"]');
    await entrada.first().waitFor({ state: 'attached', timeout: 15000 });
    if (!(await entrada.first().isVisible())) await page.locator('[data-nav-more]').click();
    await entrada.first().click();
    await expect(page.locator('[data-new-profile]')).toBeVisible();
}

async function crearEjemplo(page) {
    await irAAjustes(page);
    await page.click('[data-demo-create]');
    await expect(page.locator('[data-demo-banner]')).toBeVisible({ timeout: 15000 });
}

test('el ejemplo llega LLENO, y lo generó el motor', async ({ page }) => {
    await conPerfilReal(page);
    await crearEjemplo(page);

    // Diecisiete semanas de historial: check-ins, ingesta, pasos y sesiones.
    const cuentas = await page.evaluate(({ P }) => ({
        checkins: JSON.parse(localStorage.getItem(`${P}demo.checkins`) ?? '{"items":[]}').items.length,
        intake: JSON.parse(localStorage.getItem(`${P}demo.intakeLog`) ?? '{"items":[]}').items.length,
        steps: JSON.parse(localStorage.getItem(`${P}demo.steps`) ?? '{"items":[]}').items.length,
        sessions: JSON.parse(localStorage.getItem(`${P}demo.training`) ?? '{"sessions":[]}').sessions.length
    }), { P });
    expect(cuentas.checkins).toBeGreaterThan(10);
    expect(cuentas.intake).toBeGreaterThan(50);
    expect(cuentas.steps).toBeGreaterThan(50);
    expect(cuentas.sessions).toBeGreaterThan(30);

    // Y las vistas que estaban vacías ahora enseñan algo.
    await page.click('[data-view="progress"]');
    await expect(page.locator('.signal').first()).toBeVisible();
});

test('la banda de «datos simulados» se ve en TODAS las vistas y no se puede descartar', async ({ page }) => {
    await conPerfilReal(page);
    await crearEjemplo(page);

    const banda = page.locator('[data-demo-banner]');
    for (const id of VIEW_IDS) {
        const entrada = page.locator(`[data-view="${id}"]`);
        if (await entrada.count() === 0) continue;
        if (!(await entrada.first().isVisible())) await page.locator('[data-nav-more]').click();
        await entrada.first().click();
        await expect(banda, `la banda no se ve en la vista ${id}`).toBeVisible();
    }

    // No hay forma de cerrarla: la única salida es salir del ejemplo.
    await expect(banda.locator('[data-modal-close], [data-dismiss]')).toHaveCount(0);
    await expect(banda.locator('[data-demo-exit]')).toBeVisible();
});

test('mientras el ejemplo está activo, los datos REALES no se tocan', async ({ page }) => {
    await conPerfilReal(page);
    const antes = await page.evaluate(({ P }) => localStorage.getItem(`${P}p1.checkins`), { P });
    await crearEjemplo(page);

    // Se trastea dentro del ejemplo: se apunta un peso.
    await page.click('[data-view="today"]');
    await page.fill('[data-quick-weight]', '90.1');
    await page.click('[data-quick-save]');
    await page.waitForTimeout(500);

    // El perfil real, byte por byte, sigue igual. La garantía es de NAMESPACE:
    // `storage.js` inyecta `tl.<v>.<profileId>.` y el ejemplo vive en el suyo.
    const despues = await page.evaluate(({ P }) => localStorage.getItem(`${P}p1.checkins`), { P });
    expect(despues).toBe(antes);
    expect(await contarCheckins(page, 'p1')).toBe(1);
});

test('salir del ejemplo lo BORRA entero y devuelve al perfil real', async ({ page }) => {
    await conPerfilReal(page);
    await crearEjemplo(page);
    expect(await contarCheckins(page, 'demo')).toBeGreaterThan(10);

    await page.click('[data-demo-exit]');
    await expect(page.locator('[data-demo-banner]')).toBeHidden({ timeout: 15000 });

    // Ni una clave del ejemplo sobrevive.
    const restos = await page.evaluate(({ P }) =>
        Object.keys(localStorage).filter((k) => k.startsWith(`${P}demo.`)), { P });
    expect(restos).toEqual([]);

    // Y el perfil real vuelve, con su check-in. Se navega a Hoy a propósito: al
    // salir, el router restaura la vista persistida —que era Ajustes—, no Hoy.
    expect(await contarCheckins(page, 'p1')).toBe(1);
    await page.locator('[data-view="today"]').first().click();
    await expect(page.locator('#today-title')).toBeVisible();
});

test('el ejemplo no se instala solo: hay que pedirlo', async ({ page }) => {
    await conPerfilReal(page);
    await expect(page.locator('[data-demo-banner]')).toBeHidden();
    const claves = await page.evaluate(({ P }) =>
        Object.keys(localStorage).filter((k) => k.startsWith(`${P}demo`)), { P });
    expect(claves).toEqual([]);
});

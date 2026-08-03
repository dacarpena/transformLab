// @ts-check
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

async function addExercise(page, name) {
    await page.click('[data-add-exercise]');
    await page.fill('.modal [data-name]', name);
    await page.click('.modal [data-go]');
    await expect(page.locator('.modal')).toHaveCount(0);
}

test('duplicados por indice reutilizado', async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await completeOnboarding(page);
    await page.evaluate(() => document.querySelector('[data-view="training"]')?.click());
    await expect(page.locator('.view[data-view-id="training"]')).toBeVisible();

    await addExercise(page, 'Elevaciones laterales');
    await addExercise(page, 'Elevaciones frontales');
    await addExercise(page, 'Elevaciones posteriores');

    const idsBefore = await page.$$eval('[data-remove-exercise]', (els) => els.map((e) => e.getAttribute('data-remove-exercise')));
    console.log('IDS tras 3 altas:', JSON.stringify(idsBefore));

    // el usuario borra la PRIMERA
    await page.locator('[data-remove-exercise="ex_1_Elevaciones"]').first().click();
    await addExercise(page, 'Elevaciones de gemelo');

    const idsAfter = await page.$$eval('[data-remove-exercise]', (els) => els.map((e) => e.getAttribute('data-remove-exercise')));
    const names = await page.$$eval('.profile-item strong', (els) => els.map((e) => e.textContent));
    console.log('IDS tras borrar+alta:', JSON.stringify(idsAfter));
    console.log('NOMBRES:', JSON.stringify(names));
    console.log('DUPLICADOS:', new Set(idsAfter).size !== idsAfter.length);

    // === registrar sesión con valores DISTINTOS por ejercicio ===
    await page.click('[data-log-session]');
    const repsInputs = page.locator('.modal [data-log-reps]');
    const loadInputs = page.locator('.modal [data-log-load]');
    const n = await repsInputs.count();
    console.log('campos en el modal:', n);
    // frontales 12x10, posteriores 12x5, gemelo 12x60
    const cargas = ['10', '5', '60'];
    for (let i = 0; i < n; i++) {
        await repsInputs.nth(i).fill('12');
        await loadInputs.nth(i).fill(cargas[i]);
    }
    const tecleado = await page.$$eval('.modal [data-log-load]', (els) => els.map((e) => ({ id: e.getAttribute('data-log-load'), value: e.value })));
    console.log('LO QUE TECLEA EL USUARIO:', JSON.stringify(tecleado));
    await page.click('.modal [data-go]');
    await expect(page.locator('.modal')).toHaveCount(0);

    const stored = await page.evaluate(() => {
        const k = Object.keys(localStorage).find((x) => x.endsWith('.training'));
        return JSON.parse(localStorage.getItem(k));
    });
    console.log('SESION GUARDADA:', JSON.stringify(stored.sessions, null, 1));
    console.log('VOLUMEN mostrado:', await page.locator('.profile-item .numeric').first().textContent());
    console.log('PR/sugerencia por ejercicio:');
    const cards = await page.$$eval('.profile-item', (els) => els.map((e) => e.innerText.replace(/\n/g, ' | ')));
    for (const c of cards) console.log('  -', c);
    console.log('ERRORES DE PAGINA:', JSON.stringify(errors));
});

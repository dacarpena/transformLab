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

test('borrar uno borra dos', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await completeOnboarding(page);
    await page.evaluate(() => document.querySelector('[data-view="training"]')?.click());
    await addExercise(page, 'Press banca plano');
    await addExercise(page, 'Press banca inclinado');
    await addExercise(page, 'Press banca declinado');
    console.log('IDS:', JSON.stringify(await page.$$eval('[data-remove-exercise]', e => e.map(x => x.getAttribute('data-remove-exercise')))));
    await page.locator('[data-remove-exercise="ex_1_Pressbanca"]').first().click();
    await addExercise(page, 'Press banca con mancuernas');
    console.log('IDS:', JSON.stringify(await page.$$eval('[data-remove-exercise]', e => e.map(x => x.getAttribute('data-remove-exercise')))));
    console.log('NOMBRES antes:', JSON.stringify(await page.$$eval('.profile-item strong', e => e.map(x => x.textContent))));
    // el usuario pulsa Borrar SOLO en el ULTIMO ("Press banca con mancuernas")
    const botones = page.locator('[data-remove-exercise]');
    await botones.nth(2).click();
    console.log('NOMBRES despues de borrar SOLO el ultimo:', JSON.stringify(await page.$$eval('.profile-item strong', e => e.map(x => x.textContent))));
});

test('record atribuido al ejercicio equivocado', async ({ page }) => {
    const toasts = [];
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await completeOnboarding(page);
    await page.evaluate(() => document.querySelector('[data-view="training"]')?.click());
    await addExercise(page, 'Elevaciones laterales');
    await addExercise(page, 'Elevaciones frontales');
    await addExercise(page, 'Elevaciones posteriores');
    await page.locator('[data-remove-exercise="ex_1_Elevaciones"]').first().click();
    await addExercise(page, 'Elevaciones de gemelo');
    // sesion 1: posteriores 8 kg (el gemelo NO se entrena, campo a 0 -> se descarta... pero el duplicado lo fuerza)
    await page.click('[data-log-session]');
    let loads = page.locator('.modal [data-log-load]');
    await loads.nth(0).fill('10'); await loads.nth(1).fill('8'); await loads.nth(2).fill('90');
    await page.click('.modal [data-go]');
    await expect(page.locator('.modal')).toHaveCount(0);
    // sesion 2 al dia siguiente: subimos posteriores a 12
    await page.evaluate(() => { const k = Object.keys(localStorage).find(x => x.endsWith('.training')); const v = JSON.parse(localStorage.getItem(k)); v.sessions[0].dateISO = '2026-08-01'; v.sessions[0].id = 's_2026-08-01'; localStorage.setItem(k, JSON.stringify(v)); });
    await page.reload();
    await page.evaluate(() => document.querySelector('[data-view="training"]')?.click());
    await page.click('[data-log-session]');
    loads = page.locator('.modal [data-log-load]');
    await loads.nth(0).fill('10'); await loads.nth(1).fill('12'); await loads.nth(2).fill('90');
    await page.click('.modal [data-go]');
    await page.waitForTimeout(300);
    console.log('TOASTS:', JSON.stringify(await page.$$eval('.toast', e => e.map(x => x.innerText))));
    const cards = await page.$$eval('.profile-item', e => e.map(x => x.innerText.replace(/\n/g, ' | ')));
    for (const c of cards) console.log('  -', c);
});

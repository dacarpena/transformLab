// @ts-check
/** TEMPORAL — verificación adversarial. Se borra al terminar. */
import { test, expect } from '@playwright/test';

const CANONICAL = {
    name: 'Dani', trainingStatus: 'intermediate',
    weightKg: '75', fatPct: '20', targetFatPct: '12', targetMuscleKg: '30'
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

function backupFile(poisonId) {
    return {
        formatVersion: 1,
        schemaVersion: 5,
        exportedAtISO: '2026-08-01T10:00:00.000Z',
        profiles: [{
            id: 'imported1',
            name: 'Importado',
            createdAtISO: '2026-08-01T10:00:00.000Z',
            collections: {
                profile: {
                    schemaVersion: 5,
                    name: 'Importado',
                    createdAtISO: '2026-08-01T10:00:00.000Z',
                    user: { sex: 'male', age: 30, heightCm: 175, activityLevel: 'moderate', trainingStatus: 'intermediate' },
                    initial: { weightKg: 75, fatPct: 20, muscleKg: null, muscleSource: 'estimated' },
                    target: { fatPct: 12, muscleKg: 30 },
                    startDateISO: '2026-08-01',
                    intensity: 'moderate'
                },
                training: {
                    schemaVersion: 5,
                    routine: {
                        days: [{
                            name: 'Dia 1',
                            exercises: [
                                { id: 'ex_1_sentadilla', name: 'Sentadilla', sets: 3, reps: 10, loadKg: 80 },
                                { id: poisonId, name: 'Press banca', sets: 3, reps: 10, loadKg: 60 }
                            ]
                        }]
                    },
                    sessions: []
                }
            }
        }]
    };
}

test('repro: id de ejercicio con comilla via import', async ({ page }) => {
    /** @type {string[]} */ const pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));

    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await completeOnboarding(page);

    // --- import del backup hostil por la UI real ---
    await page.click('[data-view="settings"]');
    await page.setInputFiles('[data-import]', {
        name: 'hostil.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(backupFile('ex_2_a"b')), 'utf8')
    });
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    console.log('AVISOS EN EL DIALOGO DE IMPORT:', await page.locator('[role="dialog"]').innerText());
    await page.click('[role="dialog"] [data-go]');
    await expect(page.locator('.toast')).toContainText(/import/i);

    // --- el usuario cambia al perfil importado ---
    await page.click('[data-switch]');
    await page.waitForTimeout(300);

    // --- vista de entrenamiento ---
    await page.click('[data-view="training"]');
    await expect(page.locator('.profile-item').first()).toBeVisible();
    console.log('RUTINA VISIBLE:', (await page.locator('.profile-item').allInnerTexts()).join(' || '));

    // --- registrar sesión ---
    await page.click('[data-log-session]');
    await expect(page.locator('[role="dialog"]')).toBeVisible();
    const inputs = page.locator('[role="dialog"] input[type="number"]');
    console.log('N INPUTS EN EL MODAL:', await inputs.count());
    const attrs = await page.locator('[role="dialog"] [data-log-reps]').evaluateAll(
        (els) => els.map((e) => e.getAttribute('data-log-reps'))
    );
    console.log('ATRIBUTOS data-log-reps REALES:', JSON.stringify(attrs));

    // teclea datos reales en los cuatro campos
    for (let i = 0; i < await inputs.count(); i++) {
        await inputs.nth(i).fill(i % 2 === 0 ? '8' : '70');
    }

    await page.click('[role="dialog"] [data-go]');
    await page.waitForTimeout(500);

    console.log('ERRORES DE PAGINA:', JSON.stringify(pageErrors, null, 2));
    console.log('MODAL SIGUE ABIERTO:', await page.locator('[role="dialog"]').count() > 0);
    console.log('TOASTS:', await page.locator('.toast').allInnerTexts());

    const stored = await page.evaluate(() => {
        const out = {};
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.includes('training')) out[k] = localStorage.getItem(k);
        }
        return out;
    });
    console.log('TRAINING EN STORAGE:', JSON.stringify(stored, null, 2));
});

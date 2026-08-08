// @ts-check

/**
 * E2E del volumen por músculo (V2-M6).
 *
 * Lo que solo se ve en el navegador: que el catálogo se carga, que las series de
 * una sentadilla real llegan al glúteo, y que los ejercicios sin enlazar se
 * DECLARAN en vez de contarse como cero.
 */

import { test, expect } from '@playwright/test';

const CANONICAL = {
    name: 'Dani',
    trainingStatus: 'intermediate',
    weightKg: '80',
    fatPct: '20',
    targetFatPct: '13',
    targetMuscleKg: '32'
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

/** Siembra una rutina con dos ejercicios del catálogo y uno propio. */
async function seedTraining(page) {
    await page.evaluate(async () => {
        const cat = await (await fetch('vendor/data/exercises.json')).json();
        const squat = cat.exercises.find((/** @type {*} */ e) => /barbell squat/i.test(e.name));
        const bench = cat.exercises.find((/** @type {*} */ e) => /bench press/i.test(e.name));
        const key = Object.keys(localStorage).find((k) => k.endsWith('.training')) ?? 'tl.6.p1.training';
        const version = Number(key.split('.')[1]) || 6;
        localStorage.setItem(key, JSON.stringify({
            schemaVersion: version,
            routine: { days: [{ name: 'Rutina', exercises: [
                { id: 'ex_1_squat', name: 'Sentadilla', sets: 4, reps: 8, loadKg: null, catalogId: squat.id },
                { id: 'ex_2_bench', name: 'Press banca', sets: 4, reps: 8, loadKg: null, catalogId: bench.id },
                { id: 'ex_3_propio', name: 'Mi invento', sets: 3, reps: 12, loadKg: null, catalogId: null }
            ] }] },
            sessions: ['2026-08-03', '2026-08-05', '2026-08-07'].map((d, i) => ({
                id: `ses_${i}`,
                dateISO: d,
                entries: [
                    { exerciseId: 'ex_1_squat', sets: Array.from({ length: 4 }, () => ({ reps: 8, loadKg: 100 })) },
                    { exerciseId: 'ex_2_bench', sets: Array.from({ length: 4 }, () => ({ reps: 8, loadKg: 80 })) },
                    { exerciseId: 'ex_3_propio', sets: Array.from({ length: 3 }, () => ({ reps: 12, loadKg: 20 })) }
                ]
            }))
        }));
    });
    await page.reload();
}

async function goToTraining(page) {
    const directo = page.locator('[data-view="training"]');
    if (await directo.count() === 0 || !(await directo.first().isVisible())) {
        await page.locator('[data-nav-more]').click();
    }
    await directo.first().click();
    await expect(page.locator('#volume-title')).toBeVisible({ timeout: 15000 });
}

const volumen = (page) => page.locator('[aria-labelledby="volume-title"]');

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await completeOnboarding(page);
    await seedTraining(page);
});

test('las series de una sentadilla llegan al glúteo, no solo al cuádriceps', async ({ page }) => {
    await goToTraining(page);
    const fila = volumen(page).locator('.profile-item', { hasText: 'Glúteos' });
    // Con la regla «solo el motor primario» esto sería CERO: el peso muerto
    // tiene «lower back» como primario y solo 11 de 556 ejercicios tienen glúteo.
    await expect(fila).toContainText('4.8');
    await expect(volumen(page).locator('.profile-item', { hasText: 'Cuádriceps' })).toContainText('12');
});

test('la prescripción es entera: nadie hace 5,8 series', async ({ page }) => {
    await goToTraining(page);
    const texto = await volumen(page).innerText();
    const prescritas = [...texto.matchAll(/(?:Sube a|Mantén|Empieza con|Baja a) ([\d.]+) series/g)]
        .map((m) => m[1]);
    expect(prescritas.length).toBeGreaterThan(0);
    for (const n of prescritas) expect(n).not.toContain('.');
});

test('un ejercicio sin enlazar se DECLARA, no se cuenta como cero en silencio', async ({ page }) => {
    await goToTraining(page);
    // Decir «no entrenas ese músculo» cuando sí lo entrena es peor que callar.
    await expect(volumen(page)).toContainText(/no puedo atribuir/i);
});

test('cada grupo lleva su zona con texto, no solo con color', async ({ page }) => {
    await goToTraining(page);
    // El color no puede ser la única señal (WCAG 1.4.1).
    await expect(volumen(page).locator('.badge').first()).not.toBeEmpty();
    await expect(volumen(page)).toContainText(/productivo|sin estímulo|mantiene/);
});

test('sin métricas subjetivas se dice que la recuperación no está declarada', async ({ page }) => {
    await goToTraining(page);
    await expect(volumen(page)).toContainText(/asumo recuperación normal/i);
});

test('a 320 px la sección de volumen no desborda', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await goToTraining(page);
    const desborda = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(desborda).toBe(false);
});

test('no hay errores de consola con la rutina cargada', async ({ page }) => {
    /** @type {string[]} */ const errores = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errores.push(msg.text()); });
    page.on('pageerror', (err) => errores.push(String(err)));
    await goToTraining(page);
    expect(errores).toEqual([]);
});

// @ts-check

/**
 * El músculo en la unidad de la báscula del usuario (E11), de punta a punta.
 *
 * Nace de un fallo reportado con datos reales: una Xiaomi miScale marca
 * 81,20 kg · 26,5 % · 56,56 kg de músculo · 3,12 kg de hueso, y al escribir
 * `60` como objetivo —el número natural viniendo de 56,56— la app contestaba
 * «ganar 30,8 kg de músculo no es alcanzable». Tenía razón sobre 30 kg de
 * músculo ESQUELÉTICO; no la tenía sobre lo que el usuario quiso decir.
 *
 * Lo que se comprueba aquí no lo puede ver ningún test unitario: que las
 * cifras que aparecen en pantalla son las de SU báscula, en todas las vistas
 * a la vez, y que un perfil sin báscula no ha cambiado en nada.
 */

import { test, expect } from '@playwright/test';

/** La lectura real que originó todo esto. */
const XIAOMI = {
    name: 'Dani',
    trainingStatus: 'intermediate',
    weightKg: '81.2',
    fatPct: '26.5',
    muscleKg: '56.56',
    boneKg: '3.12',
    targetFatPct: '15',
    targetMuscleKg: '60'
};

/** Alta con las cifras de la báscula, tal cual las da la pantalla. */
async function onboardWithScale(page, over = {}) {
    const data = { ...XIAOMI, ...over };
    await page.fill('[data-field="name"]', data.name);
    await page.selectOption('[data-field="trainingStatus"]', data.trainingStatus);
    await page.click('[data-next]');

    await page.fill('[data-field="weightKg"]', data.weightKg);
    await page.fill('[data-field="fatPct"]', data.fatPct);
    await page.fill('[data-field="muscleKg"]', data.muscleKg);
    await page.fill('[data-field="boneKg"]', data.boneKg);
    await page.click('[data-next]');

    await page.fill('[data-field="targetFatPct"]', data.targetFatPct);
    await page.fill('[data-field="targetMuscleKg"]', data.targetMuscleKg);
    return data;
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
});

test('el objetivo de 60 kg que la app rechazaba ahora produce un plan', async ({ page }) => {
    await onboardWithScale(page);

    // Antes de E11 esto era un error bloqueante y el botón quedaba inerte.
    await expect(page.locator('.field__error')).toHaveCount(0);
    await expect(page.locator('[data-next]')).toBeEnabled();

    // Y debajo del campo se dice, sin esconderlo, qué músculo esquelético
    // implica esa cifra: la conversión es una estimación de población.
    await expect(page.locator('[data-target-muscle-note]')).toContainText('32.7');

    await page.click('[data-next]');
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();
});

test('el dashboard habla en la unidad de la báscula, con la esquelética al lado', async ({ page }) => {
    await onboardWithScale(page);
    await page.click('[data-next]');
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();

    // La métrica de HOY: la cifra grande es la de su báscula (día 0 = 56,6),
    // no los 29,2 de músculo esquelético.
    const muscleMetric = page.locator('.metric', { has: page.locator('.metric__note') });
    await expect(muscleMetric).toHaveCount(1);
    await expect(muscleMetric.locator('.metric__value')).toContainText('56.6');
    await expect(muscleMetric.locator('.metric__note')).toContainText('29.2');

    // Y la tarjeta del plan, de dónde a dónde, en la misma unidad.
    const plan = page.locator('.plan-summary');
    await expect(plan).toContainText('56.6');
    await expect(plan).toContainText('60.0');
});

test('un perfil SIN báscula sigue viendo músculo esquelético, exactamente como antes', async ({ page }) => {
    // Regresión explícita: E11 no puede haber cambiado nada para quien no usa
    // una báscula de bioimpedancia, que es la mayoría.
    await page.fill('[data-field="name"]', 'Sin bascula');
    await page.selectOption('[data-field="trainingStatus"]', 'intermediate');
    await page.click('[data-next]');
    await page.fill('[data-field="weightKg"]', '75');
    await page.fill('[data-field="fatPct"]', '20');
    await page.click('[data-next]');
    await page.fill('[data-field="targetFatPct"]', '12');
    await page.fill('[data-field="targetMuscleKg"]', '30');

    // ni nota de conversión en el objetivo...
    await expect(page.locator('[data-target-muscle-note]')).toHaveText('');
    await page.click('[data-next]');
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();

    // ...ni nota bajo la métrica de músculo
    await expect(page.locator('.metric__note')).toHaveCount(0);
    await expect(page.locator('.plan-summary')).toContainText('30.0');
    // el peso objetivo del perfil canónico no se ha movido
    await expect(page.locator('.plan-summary__weight').last()).toHaveText('68.9 kg');
});

test('el check-in pide músculo y hueso, comprueba que cuadran y aparece en Progreso', async ({ page }) => {
    await onboardWithScale(page);
    await page.click('[data-next]');
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();

    await page.click('[data-go-checkin]');
    await expect(page.locator('[data-field="scaleMuscleKg"]')).toBeVisible();

    // el hueso viene prellenado con el del perfil: no se teclea dos veces
    await expect(page.locator('[data-field="boneKg"]')).toHaveValue('3.12');

    // una cifra mal copiada NO se guarda en silencio: se avisa
    await page.fill('[data-field="weightKg"]', '80.4');
    await page.fill('[data-field="fatPct"]', '25.8');
    await page.fill('[data-field="scaleMuscleKg"]', '65.9');
    await page.click('[data-save]');
    await expect(page.locator('[data-messages] .field__error')).toBeVisible();

    // corregida, se guarda
    await page.fill('[data-field="scaleMuscleKg"]', '56.9');
    await page.click('[data-save]');
    await expect(page.locator('[data-messages] .field__error')).toHaveCount(0);

    // y en Progreso se compara con el plan, en la MISMA unidad
    await page.click('[data-view="progress"]');
    const muscleCard = page.locator('section.card', { has: page.locator('#muscle-title') });
    await expect(muscleCard).toBeVisible();
    await expect(muscleCard).toContainText('56.9');
});

test('reeditar el perfil devuelve las cifras de la báscula, no las internas', async ({ page }) => {
    // Fallo introducido en E10: el asistente se resembraba con el músculo
    // esquelético, así que al reabrirlo el usuario veía 29,2 donde había
    // escrito 56,56 y su perfil se degradaba de «derivado» a «medido».
    await onboardWithScale(page);
    await page.click('[data-next]');
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();

    await page.click('[data-view="settings"]');
    await page.click('[data-edit-profile]');
    await expect(page.locator('#onboarding-title')).toBeVisible();
    await page.click('[data-next]');

    await expect(page.locator('[data-field="muscleKg"]')).toHaveValue('56.56');
    await expect(page.locator('[data-field="boneKg"]')).toHaveValue('3.12');
    await page.click('[data-next]');
    await expect(page.locator('[data-field="targetMuscleKg"]')).toHaveValue('60');
});

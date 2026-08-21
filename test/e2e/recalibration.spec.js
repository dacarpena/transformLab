// @ts-check

/**
 * La recalibración, cableada de punta a punta (E15-11 y E15-12).
 *
 * DOS PROMESAS INCUMPLIDAS QUE ESTO CIERRA, y las dos llevaban meses en verde:
 *
 * 1. `core/recalibration.js` —178 líneas y ocho tests del invariante
 *    `recalibracion_unica`— **no lo llamaba nadie**. El único consumidor,
 *    `plan-summary.renderCoordinatedOffer`, estaba escrito y sin cablear. Un
 *    invariante que no gobierna nada del producto es documentación, no garantía.
 * 2. El botón «Aplicar la recalibración» de Gasto era un `toast.success` sobre
 *    un no-op, aplazado por comentario a V2-M10 — una milestone cerrada el
 *    2026-08-08. Felicitar al usuario por una acción que no ocurre es la misma
 *    clase de defecto que M7-1 tuvo que ir a cerrar.
 */

import { test, expect } from '@playwright/test';
import { rootPrefix, SCHEMA_VERSION } from '../../src/data/version.js';

const P = rootPrefix();
const V = SCHEMA_VERSION;
const ID = 'p1';

/**
 * Siembra un perfil con historial de peso e ingesta.
 *
 * Los dos parámetros fabrican los dos veredictos por separado, y de ahí salen
 * las combinaciones que hacen falta:
 *
 * - `weeklyLossKg` es lo que el usuario ADELGAZA de verdad cada semana. Comparado
 *   con lo que el plan proyecta, dispara —o no— la desviación de peso.
 * - `kcalPerDay` es lo que registra que come. El gasto medido sale de ahí más la
 *   tendencia del peso: `intake + Δpeso × 7700 / días`. Comparado con el TDEE de
 *   fórmula del plan (~2 114 kcal para este perfil), dispara —o no— la oferta de
 *   gasto.
 *
 * Las cifras están medidas contra el motor, no supuestas: con 0,45 kg/semana el
 * gasto medido son `kcalPerDay + 495`.
 */
async function seed(page, { weeks = 10, kcalPerDay = 2400, weeklyLossKg = 0.45 } = {}) {
    await page.goto('/');
    await page.evaluate(({ P, V, ID, weeks, kcalPerDay, weeklyLossKg }) => {
        localStorage.clear();
        const dias = weeks * 7;
        const iso = (offset) => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);
        const start = iso(dias);

        localStorage.setItem(`${P}profiles`, JSON.stringify({
            schemaVersion: V, activeProfileId: ID,
            profiles: [{ id: ID, name: 'Dani', createdAtISO: '2026-01-01T00:00:00.000Z' }]
        }));
        localStorage.setItem(`${P}${ID}.profile`, JSON.stringify({
            schemaVersion: V, name: 'Dani', createdAtISO: '2026-01-01T00:00:00.000Z',
            user: { sex: 'male', age: 30, heightCm: 178, activityLevel: 'sedentary', trainingStatus: 'intermediate' },
            initial: { weightKg: 90, fatPct: 24, muscleKg: null, muscleSource: 'estimated' },
            target: { fatPct: 15, muscleKg: 36 },
            startDateISO: start, intensity: 'moderate'
        }));
        localStorage.setItem(`${P}${ID}.settings`, JSON.stringify({
            schemaVersion: V, locale: 'es', activeMeasures: ['waist'],
            fluctuationVisible: false, reminder: null
        }));

        // Un check-in por semana y una ingesta diaria: es lo que necesita
        // `measuredExpenditure` para tener algo que medir.
        const checkins = [];
        for (let w = 1; w <= weeks; w++) {
            const d = iso(dias - w * 7);
            checkins.push({
                id: `ci_${d}`, dateISO: d,
                weightKg: Math.round((90 - w * weeklyLossKg) * 10) / 10,
                fatPct: null, scaleMuscleKg: null, boneKg: null,
                measuresCm: {}, subjective: {},
                notes: '', createdAtISO: '2026-01-01T00:00:00.000Z', editedAtISO: null
            });
        }
        localStorage.setItem(`${P}${ID}.checkins`, JSON.stringify({ schemaVersion: V, items: checkins }));

        const intake = [];
        for (let d = 1; d <= dias; d++) {
            intake.push({ dateISO: iso(dias - d), kcal: kcalPerDay, proteinG: null, carbsG: null, fatG: null });
        }
        localStorage.setItem(`${P}${ID}.intakeLog`, JSON.stringify({ schemaVersion: V, items: intake }));
        localStorage.setItem(`${P}${ID}.ui.activeView`, '"today"');
    }, { P, V, ID, weeks, kcalPerDay, weeklyLossKg });
    await page.reload();
}

async function irA(page, view) {
    await expect(page.locator('[data-nav]')).toBeVisible();
    const entrada = page.locator(`[data-view="${view}"]`);
    await entrada.first().waitFor({ state: 'attached', timeout: 15000 });
    if (!(await entrada.first().isVisible())) await page.locator('[data-nav-more]').click();
    await entrada.first().click();
}

/** El nivel de actividad guardado en el perfil. */
async function nivelActividad(page) {
    return page.evaluate(({ P, ID }) =>
        JSON.parse(localStorage.getItem(`${P}${ID}.profile`) ?? '{}').user?.activityLevel, { P, ID });
}

/* ── E15-12 ────────────────────────────────────────────────────────────────── */

test('aplicar la recalibración por gasto CAMBIA el plan, no enseña un aviso', async ({ page }) => {
    // Ingesta alta y peso que baja igual: el gasto real es muy superior al que
    // supone un perfil «sedentario».
    // 3 200 kcal registradas + 0,45 kg/semana = ~3 695 medidas, frente a 2 114 de
    // fórmula: un abismo que solo se explica con otro nivel de actividad.
    await seed(page, { kcalPerDay: 3200 });
    const antes = await nivelActividad(page);
    expect(antes).toBe('sedentary');

    await irA(page, 'expenditure');
    const boton = page.locator('[data-recalibrate]');
    await expect(boton).toBeVisible({ timeout: 15000 });
    await boton.click();

    // Se explica QUÉ se va a cambiar antes de cambiarlo.
    const dialogo = page.locator('[role="dialog"]');
    await expect(dialogo).toBeVisible();
    await expect(dialogo).toContainText(/nivel de actividad/i);
    await dialogo.locator('[data-accept]').click();

    // Y ocurre de verdad: el perfil cambia de nivel.
    await expect.poll(() => nivelActividad(page), { timeout: 15000 }).not.toBe(antes);

    // El plan anterior no se pierde: queda archivado con su motivo.
    const historial = await page.evaluate(({ P, ID }) =>
        JSON.parse(localStorage.getItem(`${P}${ID}.plan`) ?? '{"history":[]}').history, { P, ID });
    expect(historial.length).toBe(1);
    expect(historial[0].reason).toBe('expenditure');
});

test('el gasto que CONCUERDA con el plan no ofrece nada', async ({ page }) => {
    // Mover el plan por ruido es el fallo que más daña la credibilidad del
    // producto, y por eso `MEANINGFUL_GAP_KCAL` existe. Aquí lo medido cae
    // encima de lo proyectado: no hay botón, y no hay aviso.
    //
    // Con 0,2 kg/semana tampoco discrepa el peso, y eso importa: si discrepara,
    // su diálogo se abriría al arrancar y taparía la navegación.
    await seed(page, { kcalPerDay: 1900, weeklyLossKg: 0.2 });
    await irA(page, 'expenditure');
    await expect(page.locator('[data-view-id="expenditure"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[data-recalibrate]')).toHaveCount(0);
});

/* ── E15-11 ────────────────────────────────────────────────────────────────── */

test('con dos fuentes sobre la MISMA palanca, Hoy enseña UNA oferta y nombra la otra', async ({ page }) => {
    // Peso muy desviado (dispara `weightDeviation`) e ingesta alta que revela un
    // gasto muy distinto (dispara `measuredExpenditure`). Las dos tocan las
    // calorías: `SUPERSEDES` dice que gana el gasto, porque se apoya en dos
    // señales frente a una.
    await seed(page, { kcalPerDay: 3400 });
    await irA(page, 'today');

    const avisos = page.locator('[data-view-id="today"] [data-recal-source]');
    await expect(avisos, 'nunca dos ofertas vivas sobre la misma palanca').toHaveCount(1);
    await expect(avisos.first()).toHaveAttribute('data-recal-source', 'measuredExpenditure');

    // Lo desplazado se NOMBRA: descubrir el segundo aviso una semana después sin
    // saber por qué no salió antes es peor que no darlo.
    await expect(page.locator('[data-view-id="today"]')).toContainText(/se apoya en más datos tuyos/i);
});

test('cuando el gasto desplaza a la desviación, el diálogo automático NO se abre', async ({ page }) => {
    // Antes, `main.js` abría el modal de recalibrar por peso en cuanto procedía,
    // sin mirar si otra fuente con más evidencia decía otra cosa: un modal
    // contradiciendo al aviso que Hoy tenía debajo.
    await seed(page, { kcalPerDay: 3400 });
    await irA(page, 'today');
    await page.waitForTimeout(800);
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});

test('sin gasto que discrepe, la desviación de peso SIGUE abriendo su diálogo', async ({ page }) => {
    // La coordinación no puede convertirse en una excusa para dejar de avisar.
    // 1 620 kcal registradas + 0,45 kg/semana = ~2 115 medidas, que es justo el
    // TDEE de fórmula: el gasto CONCUERDA y no ofrece nada. Queda sola la
    // desviación de peso, y su diálogo tiene que seguir abriéndose.
    await seed(page, { kcalPerDay: 1620 });
    await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[role="dialog"]')).toContainText(/recalibrar|plan/i);
});

test('la oferta de Hoy LLEVA a alguna parte', async ({ page }) => {
    await seed(page, { kcalPerDay: 3400 });
    await irA(page, 'today');
    const boton = page.locator('[data-view-id="today"] [data-recal-source]');
    await expect(boton).toHaveCount(1);
    await boton.click();
    // La fuente de gasto lleva a Gasto, que es donde está la aritmética a la
    // vista: enseñar aquí un resumen sería el segundo sitio contando lo mismo.
    await expect(page.locator('[data-view-id="expenditure"]')).toBeVisible({ timeout: 15000 });
});

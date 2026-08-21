// @ts-check

/**
 * E2E de M4-8: el guion del producto entero.
 *
 * onboarding → check-ins → desviación → oferta de recalibración →
 * recalibrar → el historial conserva el plan anterior → la gráfica muestra
 * el plan nuevo con los puntos reales.
 *
 * Los check-ins se siembran en `localStorage` en vez de teclearse uno a uno:
 * hacen falta ocho semanas de historial para cruzar el umbral, y lo que se
 * está probando aquí es el ciclo de seguimiento, no el formulario (que tiene
 * su propio test más abajo).
 */

import { test, expect } from '@playwright/test';
import { rootPrefix, SCHEMA_VERSION } from '../../src/data/version.js';

// El prefijo y la versión salen del código, no de un literal: así el próximo
// bump de esquema no vuelve a romper estos specs (lo hizo en V2-M0).
const P = rootPrefix();
const V = SCHEMA_VERSION;

const PROFILE_ID = 'p1';

/** Siembra un perfil canónico que empezó hace `weeksAgo` semanas. */
async function seedProfile(page, { weeksAgo, checkinWeights }) {
    await page.goto('/');
    await page.evaluate(({ weeksAgo, checkinWeights, PROFILE_ID, P, V }) => {
        localStorage.clear();
        const days = weeksAgo * 7;
        const iso = (offsetDays) =>
            new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10);
        const start = iso(days);

        localStorage.setItem(`${P}profiles`, JSON.stringify({
            schemaVersion: V, activeProfileId: PROFILE_ID,
            profiles: [{ id: PROFILE_ID, name: 'Dani', createdAtISO: '2026-01-01T00:00:00.000Z' }]
        }));
        localStorage.setItem(`${P}${PROFILE_ID}.profile`, JSON.stringify({
            schemaVersion: V, name: 'Dani', createdAtISO: '2026-01-01T00:00:00.000Z',
            user: { sex: 'male', age: 30, heightCm: 175, activityLevel: 'moderate', trainingStatus: 'intermediate' },
            initial: { weightKg: 75, fatPct: 20, muscleKg: null, muscleSource: 'estimated' },
            target: { fatPct: 12, muscleKg: 30 },
            startDateISO: start, intensity: 'moderate'
        }));
        localStorage.setItem(`${P}${PROFILE_ID}.settings`, JSON.stringify({
            schemaVersion: V, locale: 'es', activeMeasures: ['waist'],
            fluctuationVisible: false, reminder: null
        }));
        const items = checkinWeights.map((weightKg, i) => {
            const dateISO = iso(days - (i + 1) * 7);
            return {
                id: `ci_${dateISO}`, dateISO, weightKg, fatPct: null,
                measuresCm: { waist: 88 },
                subjective: { adherence: 8, energy: 6, sleep: 7, motivation: 6 },
                notes: '', createdAtISO: '2026-01-01T00:00:00.000Z', editedAtISO: null
            };
        });
        localStorage.setItem(`${P}${PROFILE_ID}.checkins`, JSON.stringify({ schemaVersion: V, items }));
        localStorage.setItem(`${P}${PROFILE_ID}.ui.activeView`, '"today"');
    }, { weeksAgo, checkinWeights, PROFILE_ID, P, V });
    await page.reload();
}

test('un usuario que sigue el plan NO recibe la oferta de recalibrar', async ({ page }) => {
    // pesos que siguen la proyección de cerca, con ruido normal de báscula
    await seedProfile(page, { weeksAgo: 9, checkinWeights: [74.8, 74.4, 74.5, 74.0, 73.6, 73.4, 73.0, 72.8] });
    await expect(page.locator('#today-title')).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(page.locator('.signal--within').first()).toBeVisible();
});

test('el guion completo: estancamiento → oferta → recalibrar → historial', async ({ page }) => {
    // ocho semanas sin mover la báscula
    await seedProfile(page, { weeksAgo: 9, checkinWeights: [75, 75, 75, 75, 75, 75, 75, 75] });

    // 1 · la app OFRECE, no impone
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/por encima del plan/i);

    // 2 · el plan anterior, antes de tocar nada
    const before = await page.evaluate((P) =>
        JSON.parse(localStorage.getItem(P + 'p1.plan') ?? 'null')?.current?.totalDays ?? null, P);

    // 3 · recalibrar
    await page.click('[data-accept]');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#today-title')).toBeVisible();

    // 4 · el historial conserva el plan anterior
    const after = await page.evaluate((P) => {
        const plan = JSON.parse(localStorage.getItem(P + 'p1.plan') ?? 'null');
        const profile = JSON.parse(localStorage.getItem(P + 'p1.profile') ?? 'null');
        const checkins = JSON.parse(localStorage.getItem(P + 'p1.checkins') ?? 'null');
        return {
            history: plan?.history?.length ?? 0,
            archivedReason: plan?.history?.[0]?.reason ?? null,
            archivedDays: plan?.history?.[0]?.plan?.totalDays ?? null,
            currentDays: plan?.current?.totalDays ?? null,
            startsFromRealWeight: profile?.initial?.weightKg ?? null,
            goalFat: profile?.target?.fatPct ?? null,
            goalMuscle: profile?.target?.muscleKg ?? null,
            muscleSource: profile?.initial?.muscleSource ?? null,
            checkinsKept: checkins?.items?.length ?? 0
        };
    }, P);

    expect(after.history).toBe(1);
    expect(after.archivedReason).toBe('recalibration');
    if (before !== null) expect(after.archivedDays).toBe(before);
    // el plan nuevo parte del peso REAL, no del proyectado
    expect(after.startsFromRealWeight).toBe(75);
    // y conserva la meta y el origen del músculo (A3)
    expect(after.goalFat).toBe(12);
    expect(after.goalMuscle).toBe(30);
    expect(after.muscleSource).toBe('estimated');
    // los check-ins no se tocan al recalibrar
    expect(after.checkinsKept).toBe(8);

    // 5 · la gráfica sigue dibujándose con el plan nuevo
    await expect(page.locator('[data-canvas]')).toBeVisible();
    await expect(page.locator('.chart-wrap .state--error')).toHaveCount(0);
});

test('rechazar mantiene el plan intacto y no vuelve a preguntar', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 9, checkinWeights: [75, 75, 75, 75, 75, 75, 75, 75] });
    await expect(page.locator('[role="dialog"]')).toBeVisible();

    const before = await page.evaluate((P) =>
        JSON.parse(localStorage.getItem(P + 'p1.plan') ?? 'null'), P);

    await page.click('[data-decline]');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);

    // el plan no ha cambiado
    const after = await page.evaluate((P) =>
        JSON.parse(localStorage.getItem(P + 'p1.plan') ?? 'null'), P);
    expect(after).toEqual(before);

    // y al recargar NO se vuelve a insistir con los mismos datos
    await page.reload();
    await expect(page.locator('#today-title')).toBeVisible();
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
});

test('registrar un check-in desde el formulario y verlo en el historial', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [] });

    await page.click('[data-view="checkin"]');
    await expect(page.locator('[data-field="weightKg"]')).toBeVisible();

    await page.fill('[data-field="weightKg"]', '73.6');

    // La grasa vive dentro del detalle plegable desde E15-8: el formulario pedía
    // dieciséis campos cada semana y por eso el almacén estaba vacío. Sigue ahí
    // entera, a un clic. Que este test tuviera que cambiar es la prueba de que la
    // portada del formulario cambió de verdad.
    await page.click('[data-more] > summary');
    await page.fill('[data-field="fatPct"]', '18.5');
    await page.click('[data-save]');

    // aparece en el historial de la propia vista
    await expect(page.locator('.profile-item').first()).toContainText('73,6');

    // y en Progreso, con su señal de desviación
    await page.click('[data-view="progress"]');
    await expect(page.locator('.signal').first()).toBeVisible();
    await expect(page.getByText(/Constancia|Consistency/)).toBeVisible();
});

test('un check-in con fecha fuera del plan se rechaza con mensaje', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [] });
    await page.click('[data-view="checkin"]');

    await page.fill('[data-field="dateISO"]', '2020-01-01');
    await page.fill('[data-field="weightKg"]', '73');
    await page.click('[data-save]');

    await expect(page.locator('[data-messages]')).toContainText(/fuera de tu plan/i);
});

test('el peso es obligatorio y el resto no', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [] });
    await page.click('[data-view="checkin"]');

    await page.click('[data-save]');
    await expect(page.locator('[data-messages]')).toContainText(/obligatorio/i);

    // solo con el peso, se guarda
    await page.fill('[data-field="weightKg"]', '74.2');
    await page.click('[data-save]');
    await expect(page.locator('.profile-item').first()).toContainText('74,2');
});

test('borrar un check-in pide confirmación y lo elimina', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [74.5, 74.0] });
    await page.click('[data-view="checkin"]');

    // el formulario abre en la fecha de hoy, sin check-in: se edita uno existente
    await page.locator('[data-edit]').first().click();
    await expect(page.locator('[data-delete]')).toBeVisible();

    await page.click('[data-delete]');
    await page.click('[data-confirm-go]');

    const remaining = await page.evaluate((P) =>
        JSON.parse(localStorage.getItem(P + 'p1.checkins') ?? 'null')?.items?.length ?? -1, P);
    expect(remaining).toBe(1);
});

test('sin check-ins, Progreso muestra su estado vacío con acción directa', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [] });
    await page.click('[data-view="progress"]');

    await expect(page.locator('.state--empty')).toBeVisible();
    await page.click('[data-action="go-checkin"]');
    await expect(page.locator('[data-field="weightKg"]')).toBeVisible();
});

test('no hay errores de consola en el ciclo de seguimiento completo', async ({ page }) => {
    /** @type {string[]} */ const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (err) => errors.push(String(err)));

    await seedProfile(page, { weeksAgo: 9, checkinWeights: [75, 75, 75, 75, 75, 75, 75, 75] });
    await page.click('[data-accept]');
    await page.click('[data-view="progress"]');
    await page.click('[data-view="checkin"]');
    await page.click('[data-view="today"]');

    expect(errors).toEqual([]);
});

test('recalibrar CONSERVA el músculo ganado también en un perfil estimado (V2-M9)', async ({ page }) => {
    // El pendiente decidido de la v1: E11 arregló la conservación solo para
    // quien da cifras de báscula. Para todos los demás —la mayoría— `muscleKg`
    // se iba a null y se re-estimaba con la proporción de POBLACIÓN, que sirve
    // para adivinar el músculo de alguien en un instante pero no para seguir a
    // UNA persona en el tiempo. El resultado era que recalibrar tiraba parte de
    // la ganancia que el propio plan decía haber conseguido.
    await seedProfile(page, {
        weeksAgo: 9,
        checkinWeights: [75.2, 75.1, 75.3, 75.2, 75.1, 75.2, 75.3, 75.2]
    });

    // El perfil es `estimated`, sin báscula: es justo el caso que faltaba.
    const antes = await page.evaluate(({ P, PROFILE_ID }) => {
        const raw = localStorage.getItem(`${P}${PROFILE_ID}.profile`);
        return JSON.parse(raw ?? 'null');
    }, { P, PROFILE_ID });
    expect(antes.initial.muscleSource).toBe('estimated');
    expect(antes.initial.muscleKg).toBeNull();

    // El músculo que la app dice que tiene HOY, antes de tocar nada.
    const musculoHoy = await page.evaluate(() => {
        const texto = document.body.innerText;
        const m = texto.match(/([\d.,]+)\s*kg de músculo/);
        // La app escribe la coma decimal del español: hay que traducirla antes
        // de que `Number()` la vea, o «31,9» se convierte en NaN.
        return m ? Number(m[1].replace(',', '.')) : null;
    });

    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();
    await page.click('[data-accept]');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('#today-title')).toBeVisible();

    const despues = await page.evaluate(({ P, PROFILE_ID }) => {
        const raw = localStorage.getItem(`${P}${PROFILE_ID}.profile`);
        return JSON.parse(raw ?? 'null');
    }, { P, PROFILE_ID });

    // Lo que cierra el pendiente: el músculo se ESCRIBE, no se deja a null para
    // que la proporción de población lo vuelva a adivinar.
    expect(despues.initial.muscleKg).not.toBeNull();
    expect(despues.initial.muscleSource).toBe('estimated');
    if (musculoHoy !== null) {
        // Y es el que llevaba, no uno re-estimado desde cero.
        expect(Math.abs(despues.initial.muscleKg - musculoHoy)).toBeLessThan(1.5);
    }
});

/* ────────────────────────────────────────────────────────────────────────────
 * E15-8 · Un check-in son un peso y un botón
 *
 * La causa raíz de «las funcionalidades no están acabadas» no era el código: la
 * aplicación estaba VACÍA —cero check-ins, cero ingesta, cero pasos— porque la
 * única puerta de entrada era un formulario de dieciséis bloques. El peso ya era
 * el único campo obligatorio; lo que faltaba era que fuera lo único que se ve, y
 * que se pudiera apuntar sin salir de la pantalla de arranque.
 * ──────────────────────────────────────────────────────────────────────────── */

test('el formulario enseña fecha y peso, y pliega el resto', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [] });
    await page.click('[data-view="checkin"]');

    // Lo obligatorio, a la vista.
    await expect(page.locator('[data-field="dateISO"]')).toBeVisible();
    await expect(page.locator('[data-field="weightKg"]')).toBeVisible();

    // Lo demás, plegado pero PRESENTE: nada se ha quitado.
    await expect(page.locator('[data-field="fatPct"]')).toBeHidden();
    await expect(page.locator('[data-field="fatPct"]')).toHaveCount(1);
    await expect(page.locator('[data-subjective]')).toHaveCount(4);
    await expect(page.locator('[data-field="notes"]')).toHaveCount(1);

    await page.click('[data-more] > summary');
    await expect(page.locator('[data-field="fatPct"]')).toBeVisible();
});

test('el detalle desplegado se recuerda entre visitas', async ({ page }) => {
    // Quien SÍ mide perímetros no debería desplegarlo cada semana.
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [] });
    await page.click('[data-view="checkin"]');
    await page.click('[data-more] > summary');
    await expect(page.locator('[data-field="fatPct"]')).toBeVisible();

    await page.reload();
    await page.click('[data-view="checkin"]');
    await expect(page.locator('[data-field="fatPct"]')).toBeVisible();
});

test('el detalle se despliega si el registro TRAE detalle, no por editar', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [] });

    // 1. Un registro con SOLO peso se reabre PLEGADO: desplegarle catorce campos
    //    vacíos sería devolverle el formulario del que esta etapa viene a
    //    sacarlo. Se crea desde la entrada rápida de Hoy, que es el único camino
    //    que produce un registro así: el formulario completo escribe siempre las
    //    cuatro escalas subjetivas —nacen en 5 aunque nadie las toque—, de modo
    //    que todo lo guardado desde ahí cuenta como «con detalle», y está bien
    //    que así sea: el usuario estaba en el formulario detallado.
    await page.fill('[data-quick-weight]', '73.6');
    await page.click('[data-quick-save]');
    await page.click('[data-view="checkin"]');
    await expect(page.locator('[data-field="weightKg"]')).toBeVisible();
    await expect(page.locator('[data-field="fatPct"]')).toBeHidden();

    // 2. Uno CON grasa se reabre desplegado: si no, parecería que se han perdido.
    await page.click('[data-more] > summary');
    await page.fill('[data-field="fatPct"]', '18.5');
    await page.click('[data-save]');
    await page.reload();
    await page.click('[data-view="checkin"]');
    await page.click('[data-edit]');
    await expect(page.locator('[data-field="fatPct"]')).toBeVisible();
});

test('desde HOY se apunta el peso sin salir de la pantalla', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [] });
    await expect(page.locator('#today-title')).toBeVisible();

    await page.fill('[data-quick-weight]', '73.4');
    await page.click('[data-quick-save]');

    // Ha llegado al almacén por el mismo camino que el formulario completo.
    await expect.poll(() => page.evaluate(() => {
        const k = Object.keys(localStorage).find((x) => x.endsWith('.checkins'));
        return JSON.parse(localStorage.getItem(k ?? '') ?? '{"items":[]}').items.length;
    })).toBe(1);

    await page.click('[data-view="checkin"]');
    await expect(page.locator('.profile-item').first()).toContainText('73,4');
});

test('apuntar el peso desde HOY no borra lo que ya se registró ese día', async ({ page }) => {
    // `checkins.save` conserva por su cuenta las cifras de báscula, pero la
    // grasa, los perímetros, las escalas y las notas los reconstruye desde su
    // entrada: sin devolvérselos, apuntar el peso por la tarde borraría los
    // perímetros medidos por la mañana.
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [] });
    await page.click('[data-view="checkin"]');
    await page.fill('[data-field="weightKg"]', '73.6');
    await page.click('[data-more] > summary');
    await page.fill('[data-field="fatPct"]', '18.5');
    await page.fill('[data-measure="waist"]', '84.2');
    await page.click('[data-save]');

    await page.click('[data-view="today"]');
    await page.fill('[data-quick-weight]', '73.1');
    await page.click('[data-quick-save]');

    const registro = await page.evaluate(() => {
        const k = Object.keys(localStorage).find((x) => x.endsWith('.checkins'));
        return JSON.parse(localStorage.getItem(k ?? '') ?? '{"items":[]}').items.at(-1);
    });
    expect(registro.weightKg).toBe(73.1);
    expect(registro.fatPct).toBe(18.5);
    expect(registro.measuresCm.waist).toBe(84.2);
});

test('el peso rápido rechaza lo que no es un peso, sin escribir nada', async ({ page }) => {
    await seedProfile(page, { weeksAgo: 3, checkinWeights: [] });
    await page.click('[data-quick-save]');
    await expect(page.locator('.toast')).toContainText(/peso|weight/i);

    const n = await page.evaluate(() => {
        const k = Object.keys(localStorage).find((x) => x.endsWith('.checkins'));
        return JSON.parse(localStorage.getItem(k ?? '') ?? '{"items":[]}').items.length;
    });
    expect(n).toBe(0);
});

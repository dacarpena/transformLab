// @ts-check

/**
 * Los puntos de la checklist de release (M6-8) que se pueden automatizar.
 *
 * Están aquí y no en un guion manual porque un guion manual solo se ejecuta
 * cuando alguien se acuerda. Lo que queda para la mano —Lighthouse sobre el
 * dominio, la migración con los datos reales del dispositivo, la PWA abierta
 * sin red en un móvil— es lo que de verdad no se puede automatizar.
 */

import { test, expect } from '@playwright/test';
import { rootPrefix } from '../../src/data/version.js';

const P = rootPrefix();
import { readFileSync } from 'node:fs';

async function completeOnboarding(page, over = {}) {
    const data = {
        name: 'Dani', trainingStatus: 'intermediate',
        weightKg: '75', fatPct: '20', targetFatPct: '12', targetMuscleKg: '30', ...over
    };
    await page.fill('[data-field="name"]', data.name);
    await page.selectOption('[data-field="trainingStatus"]', data.trainingStatus);
    await page.click('[data-next]');
    await page.fill('[data-field="weightKg"]', data.weightKg);
    await page.fill('[data-field="fatPct"]', data.fatPct);
    await page.click('[data-next]');
    await page.fill('[data-field="targetFatPct"]', data.targetFatPct);
    await page.fill('[data-field="targetMuscleKg"]', data.targetMuscleKg);
    await page.click('[data-next]');
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
});

test('backup → borrar el perfil → restaurar devuelve TODO lo del usuario', async ({ page }) => {
    await completeOnboarding(page);

    // Datos de verdad en tres colecciones distintas
    await page.locator('[data-view="checkin"]').click();
    await page.fill('[data-field="weightKg"]', '74.1');
    await page.fill('[data-field="fatPct"]', '19.5');
    await page.locator('[data-save]').click();

    await page.locator('[data-view="training"]').click();
    await page.locator('[data-add-exercise]').click();
    await page.fill('[data-name]', 'Sentadilla');
    await page.locator('.modal [data-go]').click();
    await page.locator('[data-log-session]').click();
    await page.fill('[data-log-load]', '90');
    await page.locator('.modal [data-go]').click();

    await page.locator('[data-view="settings"]').click();

    // El export produce el JSON que descargaría el usuario
    const backupJson = await page.evaluate(async () => {
        const backup = await import('/src/data/backup.js');
        const exported = backup.exportProfiles({ exportedAtISO: new Date().toISOString() });
        if (!exported.ok) throw new Error('export falló: ' + exported.error);
        const text = backup.serialize(exported.value);
        if (!text.ok) throw new Error('serialize falló');
        return text.value;
    });
    expect(backupJson.length).toBeGreaterThan(100);

    // Borrar el perfil de verdad, por la zona de peligro, tecleando su nombre
    const profileName = await page.evaluate(async () => {
        const profiles = await import('/src/data/profiles.js');
        const active = profiles.getActive();
        const list = profiles.list();
        return list.value.find((p) => p.id === active.value).name;
    });
    await page.locator('[data-delete-profile]').click();
    await page.fill('[data-confirm-input]', profileName);
    await page.locator('[data-confirm-go]').click();

    // No queda nada
    const afterDelete = await page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.includes('.checkins') || k.includes('.training')).length);
    expect(afterDelete, 'el borrado dejó datos atrás').toBe(0);

    // Restaurar
    const restored = await page.evaluate(async (json) => {
        const backup = await import('/src/data/backup.js');
        const seen = backup.inspect(json);
        if (!seen.ok) return { ok: false, error: String(seen.error) };
        const result = backup.apply(seen.value.backup, { nowISO: new Date().toISOString() });
        return result.ok ? { ok: true } : { ok: false, error: String(result.error) };
    }, backupJson);
    expect(restored, `restaurar falló: ${restored.error}`).toEqual({ ok: true });

    await page.reload();
    await expect(page.locator('#today-title')).toBeVisible();

    // Y los datos están: el check-in y la sesión de entrenamiento
    await page.locator('[data-view="progress"]').click();
    await expect(page.locator('.view')).toContainText('74.1');

    await page.locator('[data-view="training"]').click();
    await expect(page.locator('.view')).toContainText('Sentadilla');
    await expect(page.locator('.view')).toContainText('90.0 kg');
});

test('un backup ajeno y hostil no ejecuta nada ni rompe la aplicación', async ({ page }) => {
    await completeOnboarding(page);

    const hostile = JSON.stringify({
        formatVersion: 1,
        schemaVersion: 5,
        exportedAtISO: '2026-01-01T00:00:00.000Z',
        profiles: [{
            id: 'p_evil',
            name: '<img src=x onerror="document.title=\'PWNED\'">',
            createdAtISO: '2026-01-01T00:00:00.000Z',
            collections: {
                checkins: {
                    schemaVersion: 5,
                    items: [{
                        id: 'c1', dateISO: '2026-08-03', weightKg: 70, fatPct: null,
                        muscleKg: null, measuresCm: {}, subjective: {},
                        note: '</script><script>document.title="PWNED2"</script>',
                        createdAtISO: '2026-08-03T00:00:00.000Z'
                    }]
                }
            }
        }]
    });

    const result = await page.evaluate(async (json) => {
        const backup = await import('/src/data/backup.js');
        const seen = backup.inspect(json);
        if (!seen.ok) return 'rechazado en inspect';
        const imported = backup.apply(seen.value.backup, { nowISO: new Date().toISOString() });
        return imported.ok ? 'importado' : 'rechazado en apply';
    }, hostile);

    await page.reload();
    await expect(page.locator('#today-title')).toBeVisible();

    // Pase lo que pase con el import, nada se ha ejecutado y la app sigue viva
    expect(await page.title()).not.toContain('PWNED');
    expect(['importado', 'rechazado en inspect', 'rechazado en apply']).toContain(result);

    if (result === 'importado') {
        // Si entró, el nombre se pinta como TEXTO, no como marcado
        await page.locator('[data-view="settings"]').click();
        const injected = await page.locator('.view img').count();
        expect(injected, 'el nombre del perfil se interpretó como HTML').toBe(0);
        await expect(page.locator('.profile-list')).toContainText('<img');
    }
});

test('la migración v4 → v5 conserva los datos y NO hereda el objetivo roto', async ({ page }) => {
    // El fixture trae las formas EXACTAS que escribía el legacy, con su peso
    // objetivo de 50,9 kg: el defecto central de la v4.0 para este perfil
    // (80 kg / 20 %). La migración no puede arrastrarlo.
    const v4 = JSON.parse(readFileSync(new URL('../fixtures/v4-profile.json', import.meta.url), 'utf8'));

    await page.evaluate((data) => {
        localStorage.clear();
        for (const [key, value] of Object.entries(data)) {
            if (key.startsWith('_')) continue;
            localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
    }, v4);
    await page.reload();

    // Arranca en el dashboard: hay perfil migrado, no pide el asistente
    await expect(page.locator('#today-title')).toBeVisible();

    const state = await page.evaluate((P) => {
        const keys = Object.keys(localStorage);
        return {
            vigente: keys.filter((k) => k.startsWith(P)).length,
            archivo: keys.filter((k) => k.startsWith('tl.legacy')),
            v4Original: keys.filter((k) => k.startsWith('transformlab_'))
        };
    }, P);
    expect(state.vigente, 'no se escribió nada en el espacio de la versión vigente').toBeGreaterThan(2);

    // Los datos v4 no se destruyen: se archivan bajo `tl.legacy.*` más una
    // copia completa en `tl.legacyBackup.v4`. Si la migración salió mal, ahí
    // siguen — que es la única razón por la que uno se atreve a migrar.
    expect(state.archivo, 'la migración no archivó los datos v4').toContain('tl.legacyBackup.v4');
    expect(state.archivo).toContain('tl.legacy.userProfile');
    expect(state.archivo).toContain('tl.legacy.checkins');
    expect(state.v4Original, 'quedaron claves v4 sin archivar').toEqual([]);

    // El objetivo roto de la v4.0 NO se hereda: el motor lo recalcula
    const target = await page.locator('.plan-summary__weight').last().textContent();
    const targetKg = parseFloat((target ?? '').replace(',', '.'));
    expect(targetKg, `heredó el objetivo roto de la v4.0: ${target}`).toBeGreaterThan(60);
    expect(targetKg).toBeLessThan(80);

    // Y los check-ins del usuario llegaron enteros
    await page.locator('[data-view="progress"]').click();
    await expect(page.locator('.view')).toContainText('79.4');
    await expect(page.locator('.view')).toContainText('78.9');
});

test('migrar dos veces no duplica nada', async ({ page }) => {
    const v4 = JSON.parse(readFileSync(new URL('../fixtures/v4-profile.json', import.meta.url), 'utf8'));
    await page.evaluate((data) => {
        localStorage.clear();
        for (const [key, value] of Object.entries(data)) {
            if (key.startsWith('_')) continue;
            localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
        }
    }, v4);

    await page.reload();
    await expect(page.locator('#today-title')).toBeVisible();
    const first = await page.evaluate((P) => Object.keys(localStorage).filter((k) => k.startsWith(P)).sort(), P);

    await page.reload();
    await expect(page.locator('#today-title')).toBeVisible();
    const second = await page.evaluate((P) => Object.keys(localStorage).filter((k) => k.startsWith(P)).sort(), P);

    expect(second).toEqual(first);
    const profiles = await page.evaluate((P) => {
        const raw = localStorage.getItem(P + 'profiles');
        return raw ? JSON.parse(raw).profiles.length : 0;
    }, P);
    expect(profiles, 'la segunda carga creó otro perfil').toBe(1);

    const checkins = await page.evaluate((P) => {
        // OJO: `tl.legacy.checkins` también acaba en «.checkins» y guarda el
        // array crudo de la v4. Aquí queremos el de la versión vigente.
        const key = Object.keys(localStorage).find((k) => k.startsWith(P) && k.endsWith('.checkins'));
        return key ? JSON.parse(localStorage.getItem(key)).items.length : -1;
    }, P);
    expect(checkins, 'los check-ins se duplicaron al migrar dos veces').toBe(2);
});

test('el recorrido de humo completo no deja ningún error de consola', async ({ page }) => {
    /** @type {string[]} */ const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

    await completeOnboarding(page);

    // check-in
    await page.locator('[data-view="checkin"]').click();
    await page.fill('[data-field="weightKg"]', '74.5');
    await page.locator('[data-save]').click();

    // progreso, gráfica, nutrición con refeed
    await page.locator('[data-view="progress"]').click();
    await page.locator('[data-view="nutrition"]').click();
    await page.locator('[data-refeed]').check();
    await page.locator('[data-refeed]').uncheck();

    // entrenamiento completo
    await page.locator('[data-view="training"]').click();
    await page.locator('[data-add-exercise]').click();
    await page.fill('[data-name]', 'Peso muerto');
    await page.locator('.modal [data-go]').click();
    await page.locator('[data-log-session]').click();
    await page.fill('[data-log-load]', '120');
    await page.locator('.modal [data-go]').click();

    // el resto de vistas
    for (const v of ['body', 'milestones', 'photos', 'achievements', 'settings']) {
        await page.locator(`[data-view="${v}"]`).click();
        await expect(page.locator(`.view[data-view-id="${v}"] .card, .view[data-view-id="${v}"] .state`).first()).toBeVisible();
    }

    // idioma ida y vuelta
    await page.selectOption('[data-locale]', 'en');
    await expect(page.locator('.view')).toContainText('Settings');
    await page.selectOption('[data-locale]', 'es');

    // la gráfica, que ahora carga Chart.js bajo demanda
    await page.locator('[data-view="today"]').click();
    await expect(page.locator('canvas')).toBeVisible();
    const painted = await page.evaluate(() => {
        const c = /** @type {HTMLCanvasElement} */ (document.querySelector('canvas'));
        const ctx = c?.getContext('2d');
        if (!ctx) return 0;
        const d = ctx.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 400) if (d[i] > 0) n += 1;
        return n;
    });
    expect(painted, 'la gráfica no dibujó nada').toBeGreaterThan(100);

    expect(errors).toEqual([]);
});

test('las cifras de una báscula Xiaomi se pueden introducir tal cual', async ({ page }) => {
    // El caso real que motivó E10: 81,20 kg · 26,5 % · 56,56 kg de «músculo».
    // Ese 56,56 es el 94,8 % de la masa magra, porque la Xiaomi llama «masa
    // muscular» a `peso − grasa − hueso`. El validador lo rechazaba —con
    // razón, no es músculo esquelético— y el usuario se quedaba sin poder
    // meter sus propios datos.
    await page.fill('[data-field="name"]', 'Dani');
    await page.selectOption('[data-field="sex"]', 'male');
    await page.click('[data-next]');

    await page.fill('[data-field="weightKg"]', '81.20');
    await page.fill('[data-field="fatPct"]', '26.5');
    await page.fill('[data-field="muscleKg"]', '56.56');

    // Sin la masa ósea NO se puede avanzar, y el mensaje señala la salida
    await expect(page.locator('.field__error, [role="alert"]').first()).toContainText(/masa ósea|bone mass/i);

    // Con ella, la lectura se interpreta y se etiqueta como derivada
    await page.fill('[data-field="boneKg"]', '3.12');
    await expect(page.locator('[data-muscle-source]')).toContainText(/Derivado|Derived/);
    await expect(page.locator('.field__error')).toHaveCount(0);

    await page.click('[data-next]');
    await page.fill('[data-field="targetFatPct"]', '18');
    await page.click('[data-next]');
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();

    const inicial = await page.evaluate(() => {
        const key = Object.keys(localStorage).find((k) => k.endsWith('.profile'));
        return JSON.parse(localStorage.getItem(key)).initial;
    });
    // El motor guarda músculo ESQUELÉTICO (~49 % de la magra), no el de la
    // báscula. Confundirlos es el defecto que hundió la v4.0.
    expect(inicial.muscleSource).toBe('derived');
    expect(inicial.muscleKg).toBeGreaterThan(27);
    expect(inicial.muscleKg).toBeLessThan(31);
    // Y las cifras del usuario se conservan tal cual: son suyas
    expect(inicial.scaleMuscleKg).toBe(56.56);
    expect(inicial.boneKg).toBe(3.12);
});

test('una cifra mal copiada de la báscula se detecta y se explica', async ({ page }) => {
    await page.fill('[data-field="name"]', 'Dani');
    await page.click('[data-next]');
    await page.fill('[data-field="weightKg"]', '81.20');
    await page.fill('[data-field="fatPct"]', '26.5');
    await page.fill('[data-field="muscleKg"]', '65.56');   // 65 en vez de 56
    await page.fill('[data-field="boneKg"]', '3.12');

    const error = page.locator('.field__error, [role="alert"]').first();
    await expect(error).toContainText(/no cuadran|do not add up/i);
    // El mensaje dice QUÉ no cuadra, no un genérico «revisa el dato»
    await expect(error).toContainText(/15[.,]4/);
    await expect(page.locator('[data-next]')).toBeDisabled();

    // Y al corregirlo, desbloquea
    await page.fill('[data-field="muscleKg"]', '56.56');
    await expect(page.locator('[data-next]')).toBeEnabled();
});

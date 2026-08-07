// @ts-check

/**
 * La vista Proyección de punta a punta (E12).
 *
 * Cubre lo que ningún test podía ver hasta ahora: el RECORTE de los plugins
 * con una ventana que no empieza en el día 0 (el mayor riesgo del cambio, y
 * invisible mientras la ventana estuvo clavada en 0), el clic sobre un hito y
 * el no-clic en zona vacía, el PNG compuesto, y que mover la ventana veinte
 * veces conserva la misma instancia de Chart.js — el contrato de rendimiento
 * convertido en aserción.
 */

import { test, expect } from '@playwright/test';

// Sin animación de Chart.js: los puntos se colocan en su posición final desde
// el primer frame, así que un clic calculado por píxel no cae en mitad de una
// interpolación. Además ejercita el camino de `prefers-reduced-motion`, que la
// gráfica respeta a mano (el bloque global de CSS no llega al lienzo).
test.use({ reducedMotion: 'reduce' });

/** Fecha civil de hace `n` días, para que HOY caiga dentro del plan. */
function daysAgoISO(n) {
    return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/** Alta con el perfil canónico, empezando hace 60 días: HOY es el día 60. */
async function onboard(page) {
    await page.fill('[data-field="name"]', 'Proyeccion');
    await page.selectOption('[data-field="trainingStatus"]', 'intermediate');
    await page.click('[data-next]');
    await page.fill('[data-field="weightKg"]', '75');
    await page.fill('[data-field="fatPct"]', '20');
    await page.click('[data-next]');
    await page.fill('[data-field="targetFatPct"]', '12');
    await page.fill('[data-field="targetMuscleKg"]', '30');
    await page.fill('[data-field="startDateISO"]', daysAgoISO(60));
    await page.click('[data-next]');
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();
}

/** La instancia de Chart.js del lienzo de la vista activa. */
const chartState = () => /** @type {*} */ ((/** @type {*} */ (globalThis)).Chart)
    ? (() => {
        const cv = document.querySelector('.view canvas');
        const c = /** @type {*} */ (globalThis).Chart.getChart(cv);
        if (!c) return null;
        return {
            id: c.id,
            min: c.scales.x.min,
            max: c.scales.x.max,
            points: c.data.datasets.map((/** @type {*} */ d) => d.data.length)
        };
    })()
    : null;

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await onboard(page);
    await page.click('[data-view="projection"]');
    await expect(page.locator('.view[data-view-id="projection"] canvas')).toBeVisible();
});

test('las cuatro secciones montan y la gráfica pinta de verdad', async ({ page }) => {
    for (const id of ['proj-summary', 'proj-next', 'proj-chart', 'proj-timeline', 'proj-kcal']) {
        await expect(page.locator(`#${id}`)).toBeVisible();
    }
    // píxeles reales, no solo un <canvas> en el DOM
    await expect.poll(async () => page.evaluate(() => {
        const cv = /** @type {HTMLCanvasElement} */ (document.querySelector('.view canvas'));
        const img = cv.getContext('2d')?.getImageData(0, 0, cv.width, cv.height).data;
        if (!img) return 0;
        let opaque = 0;
        for (let i = 3; i < img.length; i += 400) if (img[i] > 0) opaque++;
        return opaque;
    })).toBeGreaterThan(100);
});

test('la granularidad cambia cuántos puntos se dibujan, siempre desde los agregados', async ({ page }) => {
    const points = async () => page.evaluate(() => {
        const cv = document.querySelector('.view canvas');
        const c = /** @type {*} */ (globalThis).Chart.getChart(cv);
        // la serie principal es la de trazo grueso
        const main = c.data.datasets.find((/** @type {*} */ d) => d.borderWidth === 2);
        return main.data.length;
    });
    await page.click('[data-grain="day"]');
    const day = await points();
    await page.click('[data-grain="week"]');
    const week = await points();
    await page.click('[data-grain="month"]');
    const month = await points();
    expect(day).toBeGreaterThan(week);
    expect(week).toBeGreaterThan(month);
    expect(month).toBeGreaterThan(1);
});

test('mover la ventana NO reconstruye la gráfica, y los plugins no derraman fuera del área', async ({ page }) => {
    const state = () => page.evaluate(chartState);

    // `90 días` y `todo` comparten granularidad (semana), así que alternar
    // entre ambos debe mover solo los dos números de la escala.
    await page.click('[data-window="90"]');
    const first = await state();
    expect(first?.min).toBeGreaterThan(0); // HOY es el día 60: la ventana no empieza en 0
    for (let i = 0; i < 10; i++) {
        await page.click('[data-window="all"]');
        await page.click('[data-window="90"]');
    }
    const last = await state();
    expect(last?.id).toBe(first?.id); // la MISMA instancia tras veinte cambios

    // Y con la ventana empezando en el día 50, las fases anteriores NO pueden
    // pintar en el margen izquierdo, donde viven los rótulos del eje Y. Antes
    // de E12-2 este muestreo salía manchado: los plugins no recortaban.
    const spill = await page.evaluate(() => {
        const cv = /** @type {HTMLCanvasElement} */ (document.querySelector('.view canvas'));
        const c = /** @type {*} */ (globalThis).Chart.getChart(cv);
        const a = c.chartArea;
        const ratio = globalThis.devicePixelRatio || 1;
        const ctx = cv.getContext('2d');
        if (!ctx || a.left < 8) return -1;
        let stained = 0;
        // franja vertical pegada al borde izquierdo del lienzo, fuera del área
        const img = ctx.getImageData(0, Math.round(a.top * ratio) + 2, 3, Math.round((a.bottom - a.top) * ratio) - 4).data;
        for (let i = 3; i < img.length; i += 4) if (img[i] > 0) stained++;
        return stained;
    });
    expect(spill).toBe(0);
});

test('clic sobre un hito abre su ficha; clic en zona vacía, no', async ({ page }) => {
    await page.locator('.view canvas').scrollIntoViewIfNeeded();

    // Se despacha el evento sobre el PÍXEL exacto del marcador, calculado desde
    // Chart.js, en vez de con `mouse.click` por coordenadas de página: bajo
    // carga el layout tarda en estabilizarse y el clic por ratón aterrizaba
    // fuera. Esto prueba el mismo `onClick` (getElementsAtEventForMode) sin la
    // fragilidad de la posición en pantalla.
    const clickCanvasAt = (/** @type {'hit'|'empty'} */ where) => page.evaluate((w) => {
        const cv = /** @type {HTMLCanvasElement} */ (document.querySelector('.view canvas'));
        const c = /** @type {*} */ (globalThis).Chart.getChart(cv);
        const meta = c.getDatasetMeta(c.data.datasets.length - 1);
        const el = meta.data.find((/** @type {*} */ p) => p.x > c.chartArea.left && p.x < c.chartArea.right);
        if (!el) return false;
        // 'hit' = encima del punto; 'empty' = misma X, arriba del todo, sobre la línea no
        const rect = cv.getBoundingClientRect();
        const x = rect.x + el.x;
        const y = w === 'hit' ? rect.y + el.y : rect.y + c.chartArea.top + 4;
        for (const type of ['mousemove', 'mousedown', 'mouseup', 'click']) {
            cv.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
        }
        return true;
    }, where);

    const dialog = page.locator('[role="dialog"]');

    expect(await clickCanvasAt('hit')).toBe(true);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await clickCanvasAt('empty');
    await expect(dialog).toHaveCount(0);
});

test('el PNG se descarga con la métrica y el día en el nombre, y no viene vacío', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');
    await page.click('[data-png]');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^transformlab-weight-\d{4}-\d{2}-\d{2}\.png$/);
    const path = await download.path();
    expect(path).toBeTruthy();
    const { statSync } = await import('node:fs');
    expect(statSync(/** @type {string} */ (path)).size).toBeGreaterThan(1000);
});

test('la fluctuación redibuja el lienzo con otra silueta', async ({ page }) => {
    const snapshot = () => page.evaluate(() =>
        /** @type {HTMLCanvasElement} */ (document.querySelector('.view canvas')).toDataURL());
    const before = await snapshot();
    await page.check('[data-fluctuation]');
    await expect.poll(snapshot).not.toBe(before);
});

test('pulsar un momento de la historia enfoca la gráfica en ese día', async ({ page }) => {
    // un evento futuro cualquiera de la historia. Solo los grupos abiertos:
    // lo pasado va plegado en <details> y sus filas no son visibles.
    const button = page.locator('details[open] button[data-focus-day]:not([data-focus-day="0"])').first();
    const day = await button.getAttribute('data-focus-day');
    await button.scrollIntoViewIfNeeded();
    await button.click();
    await expect(page.locator('.view [data-readout]')).toContainText(`Día ${day}`);
    await expect(page.locator(`[data-focus-day="${day}"][aria-current="true"]`)).toBeVisible();
});

test('ida y vuelta Hoy ↔ Proyección: ambos lienzos pintan y la consola queda limpia', async ({ page }) => {
    /** @type {string[]} */
    const errors = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

    await page.click('[data-view="today"]');
    // Hoy tiene exactamente UN lienzo, y es la gráfica: los tests de release
    // muestrean «el primer canvas del documento» y cuentan con ello.
    await expect(page.locator('.view[data-view-id="today"] canvas')).toHaveCount(1);
    await expect(page.locator('[data-go-projection]')).toBeVisible();

    await page.click('[data-go-projection]');
    await expect(page.locator('.view[data-view-id="projection"] canvas')).toBeVisible();
    await page.click('[data-view="today"]');
    await expect(page.locator('.view[data-view-id="today"] canvas')).toBeVisible();

    await expect.poll(async () => page.evaluate(() => {
        const cv = /** @type {HTMLCanvasElement} */ (document.querySelector('.view canvas'));
        const img = cv.getContext('2d')?.getImageData(0, 0, cv.width, cv.height).data;
        if (!img) return 0;
        let opaque = 0;
        for (let i = 3; i < img.length; i += 400) if (img[i] > 0) opaque++;
        return opaque;
    })).toBeGreaterThan(100);

    expect(errors).toEqual([]);
});

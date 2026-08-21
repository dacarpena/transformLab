// @ts-check

/**
 * La factoría de gráficas (V2-M8).
 *
 * EL DEFECTO QUE CIERRA, reproducido antes del refactor: `chart.js` guardaba la
 * instancia, el cursor y la unidad de músculo en variables de MÓDULO, y `draw()`
 * destruye la instancia previa. Dibujar una segunda gráfica mataba la primera
 * **sin un solo error**: tras el segundo `draw()`, el primer lienzo quedaba en
 * 0 píxeles pintados y ancho 300 mientras el segundo tenía 57 508 — y las dos
 * llamadas devolvieron `true`.
 *
 * Va contra un navegador real porque lo que se comprueba son PÍXELES: que un
 * lienzo siga pintado no se puede simular.
 */

import { test, expect } from '@playwright/test';

/** Onboarding canónico, para tener un plan del que dibujar. */
async function conPlan(page) {
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
    await page.fill('[data-field="targetMuscleKg"]', '30');
    await page.click('[data-next]');
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();
}

test('DOS gráficas conviven: dibujar la segunda no borra la primera', async ({ page }) => {
    await conPlan(page);
    const r = await page.evaluate(async () => {
        const chart = await import('/src/ui/chart.js');
        const plans = await import('/src/ui/plan-state.js');
        const data = plans.get();
        if (!data) return { error: 'sin plan' };
        if (!await chart.ensureLoaded()) return { error: 'vendor' };

        const lienzo = (id) => {
            const caja = document.createElement('div');
            caja.style.cssText = 'width:400px;height:200px';
            const c = document.createElement('canvas');
            c.id = id;
            caja.appendChild(c);
            document.body.appendChild(caja);
            return c;
        };
        const pintados = (c) => {
            if (!c.width) return 0;
            const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
            return n;
        };
        const readout = () => ({ textContent: '' });
        const a = lienzo('ca');
        const b = lienzo('cb');
        const base = {
            projection: data.projection, metric: 'weight', todayIndex: 0,
            range: { from: 0, to: data.plan.totalDays }, onMilestone() {}, checkins: []
        };

        // UNA INSTANCIA POR LIENZO: es lo que el singleton no permitía.
        const ga = chart.createChart();
        const gb = chart.createChart();
        const ok1 = ga.draw({ ...base, canvas: a, readout: readout() });
        await new Promise((r) => setTimeout(r, 400));
        const trasPrimera = pintados(a);
        const ok2 = gb.draw({ ...base, canvas: b, readout: readout() });
        await new Promise((r) => setTimeout(r, 400));

        return {
            ok1, ok2,
            trasPrimera,
            aDespues: pintados(a), bDespues: pintados(b),
            anchoA: a.width
        };
    });

    expect(r.error, `no se pudo montar: ${r.error}`).toBeUndefined();
    expect(r.ok1).toBe(true);
    expect(r.ok2).toBe(true);
    expect(r.trasPrimera, 'la primera gráfica no llegó a pintar').toBeGreaterThan(1000);
    // LO QUE ANTES FALLABA: aquí valía 0 y el ancho se reseteaba a 300.
    expect(r.aDespues, 'dibujar la segunda gráfica borró la primera').toBeGreaterThan(1000);
    expect(r.bDespues, 'la segunda gráfica no pintó').toBeGreaterThan(1000);
    expect(r.anchoA, 'Chart.js reseteó el tamaño del primer lienzo').toBe(400);
});

test('cada gráfica tiene SU cursor: mover una no mueve la otra', async ({ page }) => {
    // El cursor era una variable de módulo, así que el recorrido con teclado de
    // una gráfica movía el de todas — y su región aria-live recitaba el punto
    // de la vecina.
    await conPlan(page);
    const r = await page.evaluate(async () => {
        const chart = await import('/src/ui/chart.js');
        const plans = await import('/src/ui/plan-state.js');
        const data = plans.get();
        const rango = { from: 0, to: data.plan.totalDays };
        const ga = chart.createChart();
        const gb = chart.createChart();
        const ro = () => ({ textContent: '' });
        ga.handleKey({ readout: ro(), projection: data.projection, key: 'ArrowRight', range: rango });
        ga.handleKey({ readout: ro(), projection: data.projection, key: 'ArrowRight', range: rango });
        gb.handleKey({ readout: ro(), projection: data.projection, key: 'End', range: rango });
        return { a: ga.cursorIndex(), b: gb.cursorIndex(), total: data.plan.totalDays };
    });
    expect(r.a, 'el cursor de la primera se contaminó').toBe(2);
    expect(r.b, 'el cursor de la segunda no llegó al final').toBe(r.total);
});

test('las vistas de la v1 siguen dibujando igual', async ({ page }) => {
    // Sin regresión: Hoy y Proyección son gráficas de una sola instancia y deben
    // comportarse exactamente como antes del refactor.
    await conPlan(page);
    await expect(page.locator('canvas')).toBeVisible();

    // `poll` y no una lectura suelta: «el lienzo es visible» NO significa «el
    // lienzo está pintado». La animación dura 250 ms, así que muestrear justo
    // después de `toBeVisible()` puede caer en el fotograma cero y contar menos
    // de mil píxeles opacos sin que nada esté roto. Este test falló así una vez
    // en la suite completa y pasó tres veces aislado, que es la firma de una
    // carrera. Un vigilante intermitente es peor que ninguno: enseña a ignorarlo.
    await expect.poll(() => pixelesOpacos(page, 'canvas'),
        { message: 'la gráfica de Hoy dejó de pintar' }).toBeGreaterThan(1000);

    await page.locator('[data-view="projection"]').click();
    await expect(page.locator('.view[data-view-id="projection"] canvas')).toBeVisible();
    await expect.poll(() => pixelesOpacos(page, '.view[data-view-id="projection"] canvas'),
        { message: 'la gráfica de Proyección dejó de pintar' }).toBeGreaterThan(1000);
});

/** Cuántos píxeles no transparentes hay en el lienzo que case el selector. */
function pixelesOpacos(page, selector) {
    return page.evaluate((sel) => {
        const c = /** @type {HTMLCanvasElement | null} */ (document.querySelector(sel));
        if (!c) return 0;
        const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data;
        if (!d) return 0;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
    }, selector);
}

/* ────────────────────────────────────────────────────────────────────────────
 * E15-5 · Un fallo transitorio ya no borra el lienzo para siempre
 *
 * `renderFallback` hacía `render()` sobre `[data-chart-host]`, que es el PADRE
 * del `<canvas>`. `render` es `innerHTML = …`, así que el lienzo desaparecía del
 * DOM y **no volvía nunca**: los redibujados posteriores salían por
 * `plan-chart.js` sin log, sin respaldo y sin señal, y la única salida era
 * recargar la página. Un vendor que tardara un instante de más dejaba la vista
 * sin gráfica para el resto de la sesión.
 *
 * `serviceWorkers: 'block'` NO es opcional: `page.route` no intercepta lo que
 * pide el service worker, y el vendor está precacheado.
 * ──────────────────────────────────────────────────────────────────────────── */
test.describe('respaldo de la gráfica', () => {
    test.use({ serviceWorkers: 'block' });

    test('si el vendor no llega, el lienzo SIGUE en el DOM y reintentar lo dibuja', async ({ page }) => {
        // Se corta el vendor ANTES de tener plan, para que el primer dibujado falle.
        await page.route('**/vendor/chart.umd.min.js', (route) => route.abort());
        await conPlan(page);

        const host = page.locator('[data-view-id="today"] [data-chart-host]');
        await expect(host.locator('[data-chart-fallback]')).toBeVisible();

        // LO QUE IMPORTA: el lienzo no se ha ido. Antes de E15-5, aquí había cero.
        await expect(host.locator('[data-canvas]')).toHaveCount(1);
        await expect(page.locator('[data-action="retry-chart"]')).toBeVisible();

        // Se restablece el vendor y se reintenta SIN recargar la página.
        await page.unroute('**/vendor/chart.umd.min.js');
        await page.click('[data-action="retry-chart"]');

        await expect.poll(async () => page.evaluate(() => {
            const c = /** @type {HTMLCanvasElement|null} */ (
                document.querySelector('[data-view-id="today"] [data-canvas]'));
            if (!c) return -1;
            const d = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data ?? new Uint8ClampedArray();
            let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
            return n;
        }), { timeout: 15000, message: 'el reintento no dibujó' }).toBeGreaterThan(1000);

        // Y el respaldo se retira solo: no se queda un error encima de una
        // gráfica que ya funciona.
        await expect(host.locator('[data-chart-fallback]')).toBeHidden();
        await expect(host.locator('[data-canvas]')).toBeVisible();
    });
});

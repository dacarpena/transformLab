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
    const hoy = await page.evaluate(() => {
        const c = /** @type {HTMLCanvasElement} */ (document.querySelector('canvas'));
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
    });
    expect(hoy, 'la gráfica de Hoy dejó de pintar').toBeGreaterThan(1000);

    await page.locator('[data-view="projection"]').click();
    await expect(page.locator('.view[data-view-id="projection"] canvas')).toBeVisible();
    const proy = await page.evaluate(() => {
        const c = /** @type {HTMLCanvasElement} */ (document.querySelector('.view[data-view-id="projection"] canvas'));
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
    });
    expect(proy, 'la gráfica de Proyección dejó de pintar').toBeGreaterThan(1000);
});

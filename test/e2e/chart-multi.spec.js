// @ts-check

/**
 * La primitiva de dibujado (E13-2) y las series múltiples (E13-3+).
 *
 * Se prueba llamando a la API desde `page.evaluate`, el patrón que estableció
 * `chart-factory.spec.js`: hay contratos que solo existen frente a la Chart.js
 * de verdad —cuántas escalas se crean, si un dataset lleva `yAxisID`— y que un
 * doble no puede verificar sin convertirse en una reimplementación.
 */

import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    // La gráfica necesita el vendor cargado; se pide igual que lo pide la app.
    await page.evaluate(async () => {
        const chart = await import('/src/ui/chart.js');
        await chart.ensureLoaded();
        /** @type {*} */ (globalThis).__chart = chart;
    });
});

/** Un lienzo conectado al documento, que es lo que `drawSeries` exige. */
async function withCanvas(page, fn) {
    return page.evaluate(fn);
}

test('la capa pulsable DEBE ser la última, y si no lo es no se dibuja', async ({ page }) => {
    const r = await withCanvas(page, () => {
        const chart = /** @type {*} */ (globalThis).__chart;
        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas);
        const instancia = chart.createChart();
        const base = {
            canvas,
            range: { from: 0, to: 10 },
            xTickLabel: (/** @type {number} */ v) => String(v),
            onPointClick: () => {}
        };
        const capas = [
            { label: 'a', data: [{ x: 0, y: 1 }] },
            { label: 'b', data: [{ x: 0, y: 2 }] },
            { label: 'c', data: [{ x: 0, y: 3 }] }
        ];

        // La última: se dibuja.
        const ultima = instancia.drawSeries({ ...base, datasets: capas, clickDatasetIndex: 2 });
        instancia.destroy();
        // Una del medio: se NIEGA. Antes esto solo lo vigilaba un test, y un
        // test solo protege lo que alguien se acordó de escribir.
        const media = instancia.drawSeries({ ...base, datasets: capas, clickDatasetIndex: 1 });
        instancia.destroy();
        // Sin capa pulsable: legítimo (es lo que hace la métrica de calorías).
        const ninguna = instancia.drawSeries({ ...base, datasets: capas, clickDatasetIndex: -1 });
        instancia.destroy();
        canvas.remove();
        return { ultima, media, ninguna };
    });

    expect(r.ultima).toBe(true);
    expect(r.media).toBe(false);
    expect(r.ninguna).toBe(true);
});

test('sin ejes declarados hay UN eje y y CERO yAxisID', async ({ page }) => {
    // No es cosmético: es la configuración exacta que produce hoy el camino de
    // una sola métrica, y el contrato que impide que la reforma la altere.
    const r = await withCanvas(page, () => {
        const chart = /** @type {*} */ (globalThis).__chart;
        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas);
        const instancia = chart.createChart();
        instancia.drawSeries({
            canvas,
            datasets: [{ label: 'a', data: [{ x: 0, y: 1 }, { x: 5, y: 2 }] }],
            range: { from: 0, to: 10 },
            xTickLabel: (/** @type {number} */ v) => String(v)
        });
        const c = /** @type {*} */ (globalThis).Chart.getChart(canvas);
        const out = {
            escalas: Object.keys(c.options.scales).sort(),
            yAxisIDs: c.data.datasets.map((/** @type {*} */ d) => d.yAxisID ?? null),
            posicion: c.options.scales.y.position
        };
        instancia.destroy();
        canvas.remove();
        return out;
    });

    expect(r.escalas).toEqual(['x', 'y']);
    expect(r.yAxisIDs).toEqual([null]);
    expect(r.posicion).toBe('left');
});

test('con dos ejes, el derecho no dibuja su rejilla sobre el área', async ({ page }) => {
    // Dos rejillas superpuestas convierten el fondo en papel milimetrado.
    const r = await withCanvas(page, () => {
        const chart = /** @type {*} */ (globalThis).__chart;
        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas);
        const instancia = chart.createChart();
        instancia.drawSeries({
            canvas,
            datasets: [
                { label: 'a', data: [{ x: 0, y: 80 }], yAxisID: 'y' },
                { label: 'b', data: [{ x: 0, y: 2400 }], yAxisID: 'y2' }
            ],
            yAxes: [{ id: 'y', position: 'left' }, { id: 'y2', position: 'right' }],
            range: { from: 0, to: 10 },
            xTickLabel: (/** @type {number} */ v) => String(v)
        });
        const c = /** @type {*} */ (globalThis).Chart.getChart(canvas);
        const out = {
            escalas: Object.keys(c.options.scales).sort(),
            izq: c.options.scales.y.grid.drawOnChartArea,
            der: c.options.scales.y2.grid.drawOnChartArea,
            posDer: c.options.scales.y2.position
        };
        instancia.destroy();
        canvas.remove();
        return out;
    });

    expect(r.escalas).toEqual(['x', 'y', 'y2']);
    expect(r.izq).toBe(true);
    expect(r.der).toBe(false);
    expect(r.posDer).toBe('right');
});

test('drawSeries no dibuja sobre un lienzo desconectado', async ({ page }) => {
    // El vendor llega con `await`, y en ese hueco el usuario puede haber
    // cambiado de vista: dibujar dejaría una instancia colgada de un nodo muerto.
    const ok = await withCanvas(page, () => {
        const chart = /** @type {*} */ (globalThis).__chart;
        const canvas = document.createElement('canvas'); // NO se añade al documento
        const instancia = chart.createChart();
        return instancia.drawSeries({
            canvas,
            datasets: [{ label: 'a', data: [{ x: 0, y: 1 }] }],
            range: { from: 0, to: 10 },
            xTickLabel: (/** @type {number} */ v) => String(v)
        });
    });
    expect(ok).toBe(false);
});

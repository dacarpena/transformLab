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

/* ---------------------------------------------------------------------- *
 * drawMulti (E13-3)
 * ---------------------------------------------------------------------- */

/** Monta un plan real y devuelve un entorno con el catálogo cargado. */
async function conPlanYCatalogo(page) {
    await page.evaluate(async () => {
        const g = /** @type {*} */ (globalThis);
        const [engine, generator, catalogo, chart] = await Promise.all([
            import('/src/core/engine.js'), import('/src/core/generator.js'),
            import('/src/core/series-catalog.js'), import('/src/ui/chart.js')
        ]);
        const perfil = { sex: 'male', age: 30, heightCm: 178, activityLevel: 'moderate', trainingStatus: 'intermediate' };
        const comp = engine.makeComposition({ weightKg: 80, fatPct: 20, sex: 'male' });
        const plan = engine.planPhases(comp.value, { fatPct: 15, muscleKg: comp.value.muscleKg + 2 }, perfil);
        const proj = generator.generateProjection(plan.value, comp.value, perfil, {
            startDateISO: '2026-08-03', seed: 1, fluctuation: false
        });
        g.__env = { catalogo, chart, projection: proj.value };
    });
}

/** Dibuja `ids` y devuelve el manifiesto junto con lo que hay en el lienzo. */
async function dibujar(page, ids, opts = {}) {
    return page.evaluate(({ ids, opts }) => {
        const { catalogo, chart, projection } = /** @type {*} */ (globalThis).__env;
        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas);
        const anchors = chart.seriesAnchors(projection, 'week');
        const ctx = { projection };
        const series = ids.map((id) => catalogo.resolveSeries(catalogo.seriesById(id), ctx, anchors));
        const instancia = chart.createChart();
        const readout = { textContent: '' };
        const manifiesto = instancia.drawMulti({
            canvas, readout, projection, series,
            todayIndex: 10, range: { from: 0, to: projection.daily.length - 1 },
            ...opts
        });
        const c = /** @type {*} */ (globalThis).Chart.getChart(canvas);
        const lienzo = c ? {
            datasets: c.data.datasets.length,
            etiquetas: c.data.datasets.map((/** @type {*} */ d) => d.label),
            yAxisIDs: c.data.datasets.map((/** @type {*} */ d) => d.yAxisID ?? null),
            escalas: Object.keys(c.options.scales).sort(),
            dashes: c.data.datasets.map((/** @type {*} */ d) => JSON.stringify(d.borderDash)),
            colores: c.data.datasets.map((/** @type {*} */ d) => d.borderColor),
            marcadores: c.data.datasets.map((/** @type {*} */ d) => d.pointStyle),
            puntos: c.data.datasets.map((/** @type {*} */ d) => d.data.length)
        } : null;
        const out = { manifiesto, lienzo, readout: readout.textContent, activa: instancia.activeSeriesIndex() };
        instancia.destroy();
        canvas.remove();
        return out;
    }, { ids, opts });
}

test('cuatro series producen cuatro datasets, en orden de hueco', async ({ page }) => {
    await conPlanYCatalogo(page);
    const r = await dibujar(page, ['proj_weight', 'proj_fat_kg', 'proj_lean_kg', 'proj_muscle_kg']);

    expect(r.manifiesto.ok).toBe(true);
    expect(r.manifiesto.status).toBe('ok');
    expect(r.lienzo.datasets).toBe(4);
    expect(r.manifiesto.rendered.map((s) => s.id))
        .toEqual(['proj_weight', 'proj_fat_kg', 'proj_lean_kg', 'proj_muscle_kg']);
    expect(r.manifiesto.rendered.map((s) => s.slot)).toEqual([0, 1, 2, 3]);

    // Los cuatro colores son distintos y los cuatro marcadores también.
    expect(new Set(r.lienzo.colores).size).toBe(4);
    expect(new Set(r.lienzo.marcadores).size).toBe(4);
});

test('el manifiesto dice cuántos puntos ENTRARON en el lienzo', async ({ page }) => {
    await conPlanYCatalogo(page);
    const r = await dibujar(page, ['proj_weight', 'proj_kcal_target']);
    // Es el arreglo estructural de la leyenda mentirosa: el recuento sale de lo
    // dibujado, no de lo que había guardado.
    for (const s of r.manifiesto.rendered) {
        const i = s.slot;
        expect(s.pointCount, `serie ${s.id}`).toBe(r.lienzo.puntos[i]);
        expect(s.pointCount).toBeGreaterThan(0);
        expect(s.reason).toBeNull();
    }
});

test('una serie vacía NO desaparece del manifiesto: sale con su motivo', async ({ page }) => {
    await conPlanYCatalogo(page);
    // Sin check-ins no hay peso medido. La serie se eligió, así que tiene que
    // seguir estando — desaparecer sin explicación es la otra mitad de la mentira.
    const r = await dibujar(page, ['proj_weight', 'meas_weight']);
    expect(r.manifiesto.rendered).toHaveLength(2);
    const medida = r.manifiesto.rendered.find((s) => s.id === 'meas_weight');
    expect(medida.pointCount).toBe(0);
    expect(medida.reason).toBeTruthy();
});

test('una unidad → un eje y CERO yAxisID; dos → izquierda y derecha', async ({ page }) => {
    await conPlanYCatalogo(page);

    const una = await dibujar(page, ['proj_weight', 'proj_fat_kg']);
    expect(una.lienzo.escalas).toEqual(['x', 'y']);
    expect(una.lienzo.yAxisIDs).toEqual([null, null]);

    const dos = await dibujar(page, ['proj_weight', 'proj_kcal_target']);
    expect(dos.lienzo.escalas).toEqual(['x', 'y', 'y2']);
    expect(dos.lienzo.yAxisIDs).toEqual(['y', 'y2']);
    expect(dos.manifiesto.axes[0].position).toBe('left');
    expect(dos.manifiesto.axes[1].position).toBe('right');
});

test('tres unidades sin normalizar NO se dibujan, y se dice por qué', async ({ page }) => {
    await conPlanYCatalogo(page);
    const r = await dibujar(page, ['proj_weight', 'proj_kcal_target', 'proj_fat_pct']);
    expect(r.manifiesto.ok).toBe(false);
    expect(r.manifiesto.status).toBe('tooManyUnits');
    expect(r.lienzo).toBeNull();
});

test('con «cambio desde el inicio», tres unidades SÍ caben en UN eje y arrancan en cero', async ({ page }) => {
    await conPlanYCatalogo(page);
    const r = await page.evaluate(() => {
        const { catalogo, chart, projection } = /** @type {*} */ (globalThis).__env;
        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas);
        const anchors = chart.seriesAnchors(projection, 'week');
        const ids = ['proj_weight', 'proj_kcal_target', 'proj_fat_pct'];
        const series = ids.map((id) => catalogo.resolveSeries(catalogo.seriesById(id), { projection }, anchors));
        const instancia = chart.createChart();
        const m = instancia.drawMulti({
            canvas, projection, series, todayIndex: 10,
            range: { from: 0, to: projection.daily.length - 1 }, normalize: 'delta'
        });
        const c = /** @type {*} */ (globalThis).Chart.getChart(canvas);
        const primeros = c.data.datasets.map((/** @type {*} */ d) => d.data[0].y);
        const escalas = Object.keys(c.options.scales).sort();
        instancia.destroy();
        canvas.remove();
        return { m, primeros, escalas };
    });
    expect(r.m.ok).toBe(true);
    // UN solo eje: en modo relativo todo está en porcentaje de cambio, así que
    // hay una sola unidad. Es lo que desbloquea comparar cuatro series
    // cualesquiera, y es la razón de que el modo sea porcentual y no absoluto.
    expect(r.escalas).toEqual(['x', 'y']);
    // Todas empiezan en 0: es lo que las hace comparables.
    expect(r.primeros).toEqual([0, 0, 0]);
    expect(r.m.baselineX).toBe(0);
    // Y el manifiesto declara la unidad efectiva, no la original.
    expect(r.m.rendered.map((s) => s.unit)).toEqual(['pct', 'pct', 'pct']);
});

test('en modo relativo, una serie que ya es un delta se declara, no explota', async ({ page }) => {
    await conPlanYCatalogo(page);
    const r = await dibujar(page, ['proj_weight', 'proj_fluctuation'], { normalize: 'delta' });
    expect(r.manifiesto.ok).toBe(true);
    const fluct = r.manifiesto.rendered.find((s) => s.id === 'proj_fluctuation');
    expect(fluct.pointCount).toBe(0);
    expect(fluct.reason).toBe('series.reason.deltaNotRelative');
    // La otra sigue dibujándose: una serie no dibujable no se lleva a las demás.
    expect(r.manifiesto.rendered.find((s) => s.id === 'proj_weight').pointCount).toBeGreaterThan(0);
});

test('la procedencia va en el trazo y el hueco en el color, sin cruzarse', async ({ page }) => {
    await conPlanYCatalogo(page);
    // `proj_weight` es prevista y `deriv_weight_trend` calculada: mismo grupo,
    // procedencias distintas, así que trazos distintos.
    const r = await dibujar(page, ['proj_weight', 'proj_fat_kg']);
    expect(r.lienzo.dashes[0]).toBe(r.lienzo.dashes[1]);   // misma procedencia
    expect(r.lienzo.colores[0]).not.toBe(r.lienzo.colores[1]); // distinto hueco
});

test('el readout describe SOLO la serie activa, y ↑↓ la cambian', async ({ page }) => {
    await conPlanYCatalogo(page);
    const r = await page.evaluate(() => {
        const { catalogo, chart, projection } = /** @type {*} */ (globalThis).__env;
        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas);
        const anchors = chart.seriesAnchors(projection, 'week');
        const series = ['proj_weight', 'proj_fat_pct'].map((id) =>
            catalogo.resolveSeries(catalogo.seriesById(id), { projection }, anchors));
        const instancia = chart.createChart();
        const readout = { textContent: '' };
        const range = { from: 0, to: projection.daily.length - 1 };
        instancia.drawMulti({ canvas, readout, projection, series, todayIndex: 0, range });
        const inicial = readout.textContent;
        // Abajo: pasa a la serie 2 y anuncia su identidad completa.
        const consumioAbajo = instancia.handleKey({ readout, projection, key: 'ArrowDown', range });
        const trasAbajo = readout.textContent;
        const activa = instancia.activeSeriesIndex();
        // Derecha: mueve la fecha y sigue nombrando la MISMA serie activa.
        instancia.handleKey({ readout, projection, key: 'ArrowRight', range });
        const trasDerecha = readout.textContent;
        instancia.destroy();
        canvas.remove();
        return { inicial, consumioAbajo, trasAbajo, activa, trasDerecha };
    });

    expect(r.consumioAbajo).toBe(true);
    expect(r.activa).toBe(1);
    expect(r.trasAbajo).toContain('Serie 2 de 2');
    expect(r.trasAbajo).toContain('Prevista');
    // Y al mover la fecha se sigue hablando de la serie 2, no de la 1.
    expect(r.trasDerecha).not.toBe(r.trasAbajo);
    expect(r.inicial).not.toBe(r.trasDerecha);
});

test('normalizado_rebasa: mover la ventana mueve el origen, sin reconstruir', async ({ page }) => {
    await conPlanYCatalogo(page);
    const r = await page.evaluate(() => {
        const { catalogo, chart, projection } = /** @type {*} */ (globalThis).__env;
        const canvas = document.createElement('canvas');
        document.body.appendChild(canvas);
        const anchors = chart.seriesAnchors(projection, 'week');
        const series = ['proj_weight', 'proj_kcal_target'].map((id) =>
            catalogo.resolveSeries(catalogo.seriesById(id), { projection }, anchors));
        const instancia = chart.createChart();
        const total = projection.daily.length - 1;
        instancia.drawMulti({
            canvas, projection, series, todayIndex: 0,
            range: { from: 0, to: total }, normalize: 'delta'
        });
        const C = /** @type {*} */ (globalThis).Chart;
        const idAntes = C.getChart(canvas).id;

        // Veinte cambios de ventana, como el contrato de la v1.
        for (let i = 0; i < 20; i++) instancia.setWindow(i, total - i);
        instancia.setWindow(60, total);

        const c = C.getChart(canvas);
        const primerosVisibles = c.data.datasets.map((/** @type {*} */ d) => {
            const p = d.data.find((/** @type {*} */ q) => q.x >= 60);
            return p ? Number(p.y.toFixed(6)) : null;
        });
        const out = { idAntes, idDespues: c.id, primerosVisibles };
        instancia.destroy();
        canvas.remove();
        return out;
    });

    // El primer punto VISIBLE de cada serie vale exactamente 0: el origen se ha
    // movido con la ventana.
    expect(r.primerosVisibles).toEqual([0, 0]);
    // Y es la MISMA instancia: el rebase reescribe las Y, no reconstruye.
    expect(r.idDespues).toBe(r.idAntes);
});

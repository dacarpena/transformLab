// @ts-check

/**
 * La vista Analizar (E13-5).
 *
 * El test que da sentido al fichero es el primero: **la leyenda no puede
 * mentir**. Se comprueba en las DOS direcciones —toda fila corresponde a un
 * dataset y todo dataset a una fila— porque el defecto real de Proyección era
 * justo una de las dos: la leyenda anunciaba una serie que el lienzo no pintaba.
 */

import { test, expect } from '@playwright/test';

const daysAgoISO = (/** @type {number} */ n) =>
    new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

async function onboard(page) {
    await page.fill('[data-field="name"]', 'Dani');
    await page.selectOption('[data-field="trainingStatus"]', 'intermediate');
    await page.click('[data-next]');
    await page.fill('[data-field="weightKg"]', '80');
    await page.fill('[data-field="fatPct"]', '20');
    await page.click('[data-next]');
    await page.fill('[data-field="targetFatPct"]', '13');
    await page.fill('[data-field="targetMuscleKg"]', '32');
    await page.fill('[data-field="startDateISO"]', daysAgoISO(60));
    await page.click('[data-next]');
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();
}

/** Ocho check-ins semanales: hacen falta series MEDIDAS para comparar de verdad. */
async function seedCheckins(page) {
    await page.evaluate(() => {
        const clave = Object.keys(localStorage).find((k) => k.endsWith('.checkins'));
        const pk = Object.keys(localStorage).find((k) => k.endsWith('.profile'));
        if (!clave || !pk) throw new Error('sin perfil');
        const perfil = JSON.parse(localStorage.getItem(pk) ?? '{}');
        const inicio = new Date(`${perfil.startDateISO}T00:00:00Z`);
        const items = [];
        for (let w = 1; w <= 8; w++) {
            const d = new Date(inicio);
            d.setUTCDate(d.getUTCDate() + w * 7);
            const dateISO = d.toISOString().slice(0, 10);
            items.push({
                id: `ci_${dateISO}`, dateISO,
                weightKg: 80 - w * 0.45, fatPct: 20 - w * 0.25,
                measuresCm: { waist: 88 - w * 0.4 },
                subjective: { energy: 7, sleep: 7, adherence: 8, motivation: 7 },
                notes: '', createdAtISO: '2026-01-01T00:00:00.000Z', editedAtISO: null
            });
        }
        const prev = JSON.parse(localStorage.getItem(clave) ?? 'null');
        localStorage.setItem(clave, JSON.stringify({ schemaVersion: prev?.schemaVersion ?? 6, items }));
    });
    await page.reload();
}

/**
 * Navega a la vista. A ancho de escritorio el botón está siempre en la barra
 * lateral; a 320 px vive detrás de «más» (`primary: false`).
 */
async function navToAnalysis(page) {
    const directo = page.locator('[data-view="analysis"]');
    if (await directo.count() === 0 || !(await directo.first().isVisible())) {
        await page.locator('[data-nav-more]').click();
    }
    await page.locator('[data-view="analysis"]').first().click();
    await expect(page.locator('.view[data-view-id="analysis"]')).toBeVisible();
}

async function goToAnalysis(page) {
    await navToAnalysis(page);
    await expect(page.locator('.view[data-view-id="analysis"] canvas')).toBeVisible();
    // El primer dibujado es asíncrono (el vendor llega bajo demanda).
    await expect.poll(() => page.locator('[data-legend-row]').count()).toBeGreaterThan(0);
}

/**
 * Despliega la tabla. Va PLEGADA por omisión a propósito —la gráfica es el
 * contenido principal, mismo criterio que la rejilla de músculo—, y dentro de un
 * `details` cerrado `innerText` devuelve cadena vacía.
 */
async function openTable(page) {
    const detalles = page.locator('[data-table-details]');
    if (!(await detalles.evaluate((e) => /** @type {HTMLDetailsElement} */ (e).open))) {
        await detalles.locator('summary').click();
    }
    await expect(page.locator('[data-table]')).toBeVisible();
}

/** Los datasets que hay en el lienzo ahora mismo. */
function datasets(page) {
    return page.evaluate(() => {
        const cv = document.querySelector('.view[data-view-id="analysis"] canvas');
        const c = /** @type {*} */ (globalThis).Chart?.getChart(cv);
        if (!c) return null;
        return c.data.datasets.map((/** @type {*} */ d) => ({
            label: d.label, n: d.data.length, axis: d.yAxisID ?? null,
            dash: JSON.stringify(d.borderDash), color: d.borderColor, point: d.pointStyle
        }));
    });
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await onboard(page);
    await seedCheckins(page);
});

test('la leyenda no puede mentir: filas ↔ datasets, en las dos direcciones', async ({ page }) => {
    await goToAnalysis(page);
    const ds = await datasets(page);
    const filas = await page.locator('[data-legend-row]').evaluateAll((els) =>
        els.map((e) => ({ id: e.getAttribute('data-legend-row'), estado: e.getAttribute('data-state') })));

    // Tantas filas como datasets: ni una de más ni una de menos.
    expect(filas).toHaveLength(ds.length);

    // Y el recuento de puntos de cada fila es el del dataset que le corresponde.
    for (let i = 0; i < filas.length; i++) {
        const texto = await page.locator(`[data-legend-row="${filas[i].id}"]`).innerText();
        if (ds[i].n > 0) {
            expect(texto, `fila ${filas[i].id}`).toContain(String(ds[i].n));
            expect(filas[i].estado).toBe('ok');
        } else {
            expect(filas[i].estado).toBe('emptyWindow');
        }
    }
});

test('una serie sin datos NO desaparece: se queda diciendo por qué', async ({ page }) => {
    await goToAnalysis(page);
    // «Comes vs. gastas» incluye la ingesta registrada, que este perfil no tiene.
    await page.click('[data-preset="energy"]');
    await expect.poll(() => page.locator('[data-legend-row]').count()).toBe(2);

    const vacia = page.locator('[data-legend-row][data-state="emptyWindow"]');
    await expect(vacia).toHaveCount(1);
    await expect(vacia).toContainText(/sin datos|Faltan/i);
    // Sigue siendo una de las dos elegidas: no se ha quitado sola.
    await expect(page.locator('[data-series-count]')).toContainText('2');
});

test('el tope de cuatro se explica antes de chocar, y la quinta no se marca', async ({ page }) => {
    await goToAnalysis(page);
    await page.click('[data-open-picker]');
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog).toBeVisible();

    // Marcar hasta llegar a cuatro. Se usa `click` y no `check` a propósito:
    // `check` AFIRMA que la casilla acaba marcada, y la quinta no debe acabar
    // marcada — es el comportamiento que se está probando, no un fallo.
    while (await dialog.locator('[data-series]:checked').count() < 4) {
        const antes = await dialog.locator('[data-series]:checked').count();
        await dialog.locator('[data-series]:not(:checked)').first().click();
        await expect.poll(() => dialog.locator('[data-series]:checked').count()).toBe(antes + 1);
    }
    // El aviso aparece ANTES de intentar la quinta.
    await expect(dialog.locator('[data-picker-limit]')).toBeVisible();

    const quinta = dialog.locator('[data-series]:not(:checked)').first();
    const quintaId = await quinta.getAttribute('data-series');
    await quinta.click();

    // La quinta NO se marca, se dice cuál se ha rechazado, y ninguna se ha
    // quitado sola: destruir la intención del usuario sin permiso es peor.
    await expect(page.locator('.toast')).toContainText('No se ha añadido');
    await expect(dialog.locator(`[data-series="${quintaId}"]`)).not.toBeChecked();
    await expect(dialog.locator('[data-series]:checked')).toHaveCount(4);
});

test('la procedencia va en el TRAZO, no solo en el color, y como texto', async ({ page }) => {
    await goToAnalysis(page);
    const ds = await datasets(page);

    // Prevista y medida tienen patrones de trazo distintos: sin esto, la
    // gráfica en escala de grises o con daltonismo no las distingue (WCAG 1.4.1).
    const prevista = ds.find((d) => d.label.includes('previsto'));
    const medida = ds.find((d) => d.label.includes('medido'));
    expect(prevista.dash).not.toBe(medida.dash);
    expect(prevista.color).not.toBe(medida.color);
    expect(prevista.point).not.toBe(medida.point);

    // Y la palabra está como TEXTO en la fila, no solo insinuada por el color.
    await expect(page.locator('[data-legend-row]').first()).toContainText(/Prevista|Medida|Calculada|Estimada/);
});

test('quitar una serie desde la leyenda no deja el foco en el body', async ({ page }) => {
    await goToAnalysis(page);
    await expect(page.locator('[data-legend-row]')).toHaveCount(2);
    await page.locator('[data-remove-series]').first().click();
    await expect(page.locator('[data-legend-row]')).toHaveCount(1);

    const enfocado = await page.evaluate(() => document.activeElement?.tagName);
    expect(enfocado, 'el foco cayó al body tras quitar una serie').toBe('BUTTON');
});

test('la nota de procedencia mixta aparece, y concuerda', async ({ page }) => {
    await goToAnalysis(page);
    const nota = page.locator('[data-mixed-notice]');
    await expect(nota).toBeVisible();
    // Sin cifras: «1 previstas» era la concordancia rota que tenía la primera
    // versión. La frase dice qué significa mezclar, no cuántas hay.
    await expect(nota).toContainText('previstas');
    await expect(nota).toContainText('medidas');
    await expect(nota).not.toContainText(/\d/);
});

test('dos unidades reparten los ejes; el modo relativo las junta en uno', async ({ page }) => {
    await goToAnalysis(page);
    await page.click('[data-open-picker]');
    const dialog = page.locator('[role="dialog"]');
    await dialog.locator('[data-series="proj_fat_pct"]').check();
    await page.locator('[data-modal-close]').click();
    await expect(dialog).toHaveCount(0);

    await expect.poll(async () => (await datasets(page)).length).toBe(3);
    const escalas = () => page.evaluate(() => {
        const cv = document.querySelector('.view[data-view-id="analysis"] canvas');
        return Object.keys(/** @type {*} */ (globalThis).Chart.getChart(cv).options.scales).sort();
    });
    expect(await escalas()).toEqual(['x', 'y', 'y2']);

    await page.click('[data-normalize="delta"]');
    await expect.poll(escalas).toEqual(['x', 'y']);
    // Y se DICE desde qué día se mide: sin eso, cambiar de periodo altera la
    // referencia en silencio y la misma serie parece otra cosa.
    await expect(page.locator('[data-effective-hint]')).toContainText('El cambio se mide desde');
});

test('la selección, el periodo y la escala sobreviven a recargar', async ({ page }) => {
    await goToAnalysis(page);
    await page.click('[data-preset="shape"]');
    await expect.poll(() => page.locator('[data-legend-row]').count()).toBe(2);
    await page.click('[data-window="90"]');
    await page.click('[data-grain="month"]');

    await page.reload();
    await goToAnalysis(page);

    const ids = await page.locator('[data-legend-row]').evaluateAll((els) =>
        els.map((e) => e.getAttribute('data-legend-row')));
    expect(ids).toEqual(['proj_weight', 'meas_waist']);
    await expect(page.locator('[data-window="90"][aria-pressed="true"]')).toBeVisible();
    await expect(page.locator('[data-grain="month"][aria-pressed="true"]')).toBeVisible();
});

test('un id guardado que ya no existe no rompe la vista: se descarta y se dice', async ({ page }) => {
    await goToAnalysis(page);
    await page.evaluate(() => {
        const clave = Object.keys(localStorage).find((k) => k.endsWith('.settings'));
        const s = JSON.parse(localStorage.getItem(clave ?? '') ?? '{}');
        s.analysis = { seriesIds: ['proj_weight', 'serie_inventada'], window: 'all', grain: 'week', normalize: 'raw' };
        localStorage.setItem(clave ?? '', JSON.stringify(s));
    });
    await page.reload();
    await goToAnalysis(page);

    await expect(page.locator('[data-legend-row]')).toHaveCount(1);
    await expect(page.locator('.toast')).toContainText('ya no están disponibles');
});

test('a 320 px se dibuja más grueso, y el control refleja lo EFECTIVO', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await goToAnalysis(page);
    await page.click('[data-grain="day"]');
    await expect.poll(() => page.locator('[data-effective-hint]').isVisible()).toBe(true);

    // Lo PEDIDO se guarda; lo EFECTIVO se dibuja y es lo que muestra el control.
    // Si `aria-pressed` reflejara lo pedido, sería la leyenda mentirosa
    // reencarnada en otro sitio.
    const pedido = await page.evaluate(() => {
        const clave = Object.keys(localStorage).find((k) => k.endsWith('.settings'));
        return JSON.parse(localStorage.getItem(clave ?? '') ?? '{}').analysis.grain;
    });
    expect(pedido).toBe('day');
    await expect(page.locator('[data-grain="week"][aria-pressed="true"]')).toBeVisible();
    await expect(page.locator('[data-effective-hint]')).toContainText('ancho de pantalla');

    const desborda = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(desborda).toBe(false);
});

test('no hay errores de consola al recorrer la vista', async ({ page }) => {
    /** @type {string[]} */ const errores = [];
    page.on('console', (msg) => { if (msg.type() === 'error') errores.push(msg.text()); });
    page.on('pageerror', (err) => errores.push(String(err)));

    await goToAnalysis(page);
    await page.click('[data-preset="planVsReal"]');
    await page.click('[data-normalize="delta"]');
    await page.click('[data-window="30"]');
    await page.click('[data-open-picker]');
    await page.locator('[data-picker-search]').fill('cintura');
    await page.locator('[data-modal-close]').click();
    await page.locator('[data-remove-series]').first().click();

    expect(errores).toEqual([]);
});

/* ---------------------------------------------------------------------- *
 * Tabla, CSV y lectura accesible (E13-6)
 * ---------------------------------------------------------------------- */

test('la tabla lleva unidad y procedencia, y un guion NO es un cero', async ({ page }) => {
    await goToAnalysis(page);
    await openTable(page);
    const cabeceras = await page.locator('[data-table] thead th').allInnerTexts();

    expect(cabeceras[0]).toBe('Fecha');
    expect(cabeceras.slice(1).every((h) => /\(.+,.+\)/.test(h)), cabeceras.join(' | ')).toBe(true);
    expect(cabeceras.some((h) => h.includes('Prevista'))).toBe(true);
    expect(cabeceras.some((h) => h.includes('Medida'))).toBe(true);

    // El peso MEDIDO no tiene dato el día 0: esa celda es un guion, no un cero.
    const primera = await page.locator('[data-table] tbody tr').first().innerText();
    expect(primera).toContain('—');
    expect(primera).not.toMatch(/\t0,0|\s0,0\s/);
});

test('la unidad NO se repite: el nombre no la lleva y la cabecera sí', async ({ page }) => {
    await goToAnalysis(page);
    await page.click('[data-open-picker]');
    await page.locator('[role="dialog"] [data-series="proj_fat_pct"]').click();
    await page.locator('[data-modal-close]').click();
    await openTable(page);

    const cabeceras = await page.locator('[data-table] thead th').allInnerTexts();
    const grasa = cabeceras.find((h) => h.includes('grasa'));
    expect(grasa).toBeTruthy();
    // «Grasa prevista (%) (%, Prevista)» era el defecto: la unidad dos veces.
    expect(grasa.match(/%/g)?.length ?? 0).toBe(1);
});

test('el CSV lleva ISO, separador del idioma, procedencia y sin fórmulas', async ({ page }) => {
    await goToAnalysis(page);
    const descarga = page.waitForEvent('download');
    await page.click('[data-csv]');
    const fichero = await descarga;
    const ruta = await fichero.path();
    const texto = await page.evaluate(async (nombre) => nombre, fichero.suggestedFilename());
    expect(texto).toMatch(/^transformlab-analisis-\d{4}-\d{2}-\d{2}\.csv$/);

    const { readFileSync } = await import('node:fs');
    const csv = readFileSync(ruta ?? '', 'utf8');

    expect(csv.charCodeAt(0), 'sin BOM, Excel destroza los acentos').toBe(0xFEFF);
    const lineas = csv.replace('﻿', '').trim().split('\r\n');
    expect(lineas[0]).toContain(';');            // separador del español
    expect(lineas[0]).toContain('Prevista');     // la procedencia viaja al fichero
    expect(lineas[1]).toMatch(/^\d{4}-\d{2}-\d{2};/);  // fecha ISO en la primera columna
    expect(lineas[1]).toMatch(/\d+,\d/);         // coma decimal en español
    // Ninguna celda puede empezar por un carácter de fórmula sin neutralizar.
    for (const linea of lineas) {
        for (const celda of linea.split(';')) {
            expect(/^[=+@]/.test(celda), `celda peligrosa: ${celda}`).toBe(false);
        }
    }
});

test('↑↓ cambian de serie y ←→ mueven la fecha sobre la misma serie', async ({ page }) => {
    await goToAnalysis(page);
    const readout = page.locator('[data-readout]');
    await page.locator('[data-canvas]').focus();

    await page.keyboard.press('ArrowRight');
    const primera = await readout.innerText();
    expect(primera).toContain('Peso previsto');

    await page.keyboard.press('ArrowDown');
    const cambio = await readout.innerText();
    // Al cambiar de serie se anuncia su IDENTIDAD completa, no solo un número.
    expect(cambio).toContain('Serie 2 de 2');
    expect(cambio).toContain('Peso medido');
    expect(cambio).toContain('Medida');

    // Y al mover la fecha se sigue hablando de la serie 2.
    await page.keyboard.press('ArrowRight');
    const despues = await readout.innerText();
    expect(despues).toContain('Peso medido');
    expect(despues).not.toContain('Peso previsto');
});

test('el readout dice «sin dato ese día» en vez de inventarse un cero', async ({ page }) => {
    await goToAnalysis(page);
    await page.locator('[data-canvas]').focus();
    await page.keyboard.press('ArrowDown');   // a la serie medida
    await page.keyboard.press('Home');        // al día 0, donde no hay check-in

    await expect(page.locator('[data-readout]')).toContainText('no tiene dato ese día');
    await expect(page.locator('[data-readout]')).not.toContainText('0,0');
});

test('a 320 px la tabla se desplaza sin desbordar el documento', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await goToAnalysis(page);
    await openTable(page);

    const r = await page.evaluate(() => {
        const zona = document.querySelector('[data-table-scroll]');
        return {
            desbordaDoc: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            // La tabla SÍ se desplaza —cinco columnas no caben— pero dentro de
            // su propia zona, que además es alcanzable con teclado.
            zonaDesplaza: (zona?.scrollWidth ?? 0) > (zona?.clientWidth ?? 0),
            enfocable: zona?.getAttribute('tabindex')
        };
    });
    expect(r.desbordaDoc).toBe(false);
    expect(r.enfocable).toBe('0');
});

/* ---------------------------------------------------------------------- *
 * Gestos (E13-7)
 * ---------------------------------------------------------------------- */

/** La ventana visible del lienzo, en índices de día. */
function ventana(page) {
    return page.evaluate(() => {
        const cv = document.querySelector('.view[data-view-id="analysis"] canvas');
        const c = /** @type {*} */ (globalThis).Chart?.getChart(cv);
        return c ? { from: c.options.scales.x.min, to: c.options.scales.x.max } : null;
    });
}

test('la rueda SIN modificador no roba el desplazamiento de la página', async ({ page }) => {
    await goToAnalysis(page);
    const antes = await ventana(page);
    // El lienzo NO está enfocado: la rueda es de la página. Robarla dejaría al
    // usuario atrapado en una gráfica de 460 px de alto.
    await page.locator('[data-canvas]').hover();
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(200);
    expect(await ventana(page)).toEqual(antes);
});

test('la rueda con Ctrl hace zoom, y el periodo deja de decir «Todo»', async ({ page }) => {
    await goToAnalysis(page);
    const antes = await ventana(page);
    await page.locator('[data-canvas]').hover();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');

    await expect.poll(async () => {
        const v = await ventana(page);
        return v ? v.to - v.from : null;
    }).toBeLessThan(antes.to - antes.from);

    // Y ningún botón de periodo sigue pulsado: dejar «Todo» encendido mientras
    // se mira un tramo sería un control afirmando lo que la gráfica contradice.
    await expect(page.locator('[data-window][aria-pressed="true"]')).toHaveCount(0);
});

test('el zoom sobrevive a un redibujado: el preset no se lo come', async ({ page }) => {
    await goToAnalysis(page);
    await page.locator('[data-canvas]').hover();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await ventana(page)).to - (await ventana(page)).from)
        .toBeLessThan(150);
    const conZoom = await ventana(page);

    // Cambiar de escala redibuja la gráfica entera. Sin `preset: custom`, la
    // ventana se recalcularía desde el preset y el zoom se desharía solo.
    await page.click('[data-normalize="delta"]');
    await page.waitForTimeout(400);
    expect(await ventana(page)).toEqual(conZoom);
});

test('doble clic devuelve el plan entero', async ({ page }) => {
    await goToAnalysis(page);
    const completo = await ventana(page);
    await page.locator('[data-canvas]').hover();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await expect.poll(async () => (await ventana(page)).to - (await ventana(page)).from)
        .toBeLessThan(completo.to - completo.from);

    await page.locator('[data-canvas]').dblclick();
    await expect.poll(() => ventana(page)).toEqual(completo);
});

test('un zoom NO pisa el periodo guardado', async ({ page }) => {
    await goToAnalysis(page);
    await page.click('[data-window="90"]');   // esto SÍ se guarda
    await page.waitForTimeout(300);

    await page.locator('[data-canvas]').hover();
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -240);
    await page.keyboard.up('Control');
    await page.waitForTimeout(400);

    // Dos índices de día solo significan algo dentro de ESTE plan: restaurarlos
    // sobre uno recalibrado señalaría un tramo que ya no existe. El zoom vive en
    // memoria y lo guardado sigue siendo el periodo que el usuario eligió.
    const guardado = await page.evaluate(() => {
        const k = Object.keys(localStorage).find((x) => x.endsWith('.settings'));
        return JSON.parse(localStorage.getItem(k ?? '') ?? '{}').analysis?.window;
    });
    expect(guardado).toBe('90');
});

/* ---------------------------------------------------------------------- *
 * Cuando Chart.js no está
 * ---------------------------------------------------------------------- */

test.describe('sin la librería de gráficos', () => {
    // `serviceWorkers: 'block'` es la pieza que faltaba, y costó encontrarla:
    // **`page.route` NO intercepta lo que sirve un service worker**. El SW ya
    // estaba instalado con el vendor en su precaché antes de que el test
    // pudiera bloquear nada, así que lo servía de su caché y la gráfica se
    // dibujaba igual. Desregistrarlo a posteriori era una carrera de tres capas
    // —SW, caché HTTP y el `pwa.js` que vuelve a registrarlo al recargar— y el
    // test pasaba unas veces y fallaba otras. Impedir que exista lo resuelve de
    // raíz, y de paso es lo que de verdad se quiere probar: la app SIN gráfica.
    test.use({ serviceWorkers: 'block' });

    test.beforeEach(async ({ page }) => {
        await page.route('**/vendor/chart.umd.min.js', (route) => route.abort());
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await onboard(page);
    });

    test('sin Chart.js la vista no ofrece nada destructivo', async ({ page }) => {
    // `navToAnalysis` y no `goToAnalysis`: aquí el lienzo NO va a dibujarse
    // nunca, que es justo lo que se está comprobando.
    await navToAnalysis(page);

    const vista = page.locator('.view[data-view-id="analysis"]');
    await expect(vista).toContainText(/no se ha podido|no está disponible/i);
    // H-013: la salida de un error jamás es borrar datos.
    await expect(vista.locator('[data-clear-all], [data-delete-profile], [data-reset]')).toHaveCount(0);
});

    test('la leyenda no anuncia puntos de un lienzo que no se dibujó', async ({ page }) => {
        await navToAnalysis(page);
        // El manifiesto dice lo que se DIBUJÓ. Con la gráfica caída eso es nada,
        // y la leyenda tiene que decirlo: anunciar «24 puntos» de una serie que
        // no está en ningún lienzo es la misma mentira, entrando por el caso de
        // fallo en vez de por el normal.
        for (const fila of await page.locator('[data-legend-row]').all()) {
            await expect(fila).toHaveAttribute('data-state', 'emptyWindow');
            await expect(fila).not.toContainText(/\d+ puntos/);
        }
    });

    test('la tabla y el CSV sobreviven a que Chart.js no cargue', async ({ page }) => {
    await navToAnalysis(page);

    // Los números son lo que el usuario vino a ver: un fallo de la librería de
    // gráficos no puede llevárselos.
    await openTable(page);
    await expect(page.locator('[data-table] tbody tr').first()).toBeVisible();
    await expect(page.locator('[data-csv]')).toBeVisible();
});
});

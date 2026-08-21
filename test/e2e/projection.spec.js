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

/**
 * Dónde están, en coordenadas de página, los marcadores de esas familias.
 *
 * Se pregunta a la escala en vez de barrer el carril a clics: barrer era lento
 * —cientos de clics— y frágil bajo carga. `buildMarks` da los días y
 * `getPixelForValue` da la X.
 *
 * Se devuelven varios candidatos porque el carril ADELGAZA por prioridad cuando
 * no caben todos, así que un día concreto puede no estar dibujado.
 * @param {string[]} categorias
 */
async function puntosDeMarcador(page, categorias) {
    // El lienzo tiene que estar EN PANTALLA antes de medir: las coordenadas son
    // relativas a la ventana y Proyección es una vista larga.
    await page.locator('.view[data-view-id="projection"] canvas').scrollIntoViewIfNeeded();
    // Y a que el carril haya asentado: cada chip dispara un redibujado
    // asíncrono, y medir antes lee el carril ANTERIOR. Bajo la carga de la suite
    // completa esa ventana se ensancha lo bastante para que se note.
    await carrilAsentado(page);
    return page.evaluate(async (cats) => {
        const marksMod = await import('/src/ui/marks.js');
        const plans = await import('/src/ui/plan-state.js');
        const data = plans.get();
        if (!data) return [];
        const today = plans.todayIndex(data, plans.todayISO());
        const ms = marksMod.buildMarks(data, today.dayIndex, { categories: cats });
        const cv = /** @type {HTMLCanvasElement|null} */ (
            document.querySelector('.view[data-view-id="projection"] canvas'));
        if (!cv) return [];
        const c = /** @type {*} */ (globalThis).Chart.getChart(cv);
        if (!c) return [];
        const rect = cv.getBoundingClientRect();
        /** @type {{x: number, y: number, plotY: number}[]} */ const out = [];
        for (const m of ms) {
            const x = c.scales.x.getPixelForValue(m.dayIndex);
            if (x > c.chartArea.left + 6 && x < c.chartArea.right - 6) {
                out.push({
                    x: rect.x + x,
                    y: rect.y + c.chartArea.top + 4,
                    // La MISMA columna, pero sobre la curva: el clic que no debe
                    // abrir nada.
                    plotY: rect.y + c.chartArea.top + 120
                });
            }
            if (out.length >= 12) break;
        }
        return out;
    }, categorias);
}

/**
 * Espera a que el carril deje de cambiar.
 *
 * Cada chip dispara un redibujado asíncrono. Medir o pulsar antes de que asiente
 * lee el carril ANTERIOR, y el fallo —«ningún marcador respondió»— no apunta a
 * la causa.
 */
async function carrilAsentado(page) {
    // TRES lecturas iguales seguidas, no dos. Con dos, dos lecturas tomadas
    // ANTES de que el redibujado empiece se dan por asentadas — y bajo la carga
    // de la suite completa esa ventana se ensancha lo bastante para que pase.
    // Más una espera mínima, por la misma razón.
    await page.waitForTimeout(350);
    /** @type {number[]} */ const ultimas = [];
    await expect.poll(async () => {
        ultimas.push(await marcadoresEnElCarril(page));
        if (ultimas.length > 3) ultimas.shift();
        return ultimas.length === 3 && ultimas[0] === ultimas[1] && ultimas[1] === ultimas[2];
    }, { timeout: 20000, intervals: [200] }).toBe(true);
}

test('clic sobre un marcador de hito abre su ficha; clic en zona vacía, no', async ({ page }) => {
    // Depende de píxeles y de coordenadas: bajo la carga de la suite completa
    // el lienzo tarda más en asentarse que el presupuesto de un test normal.
    test.slow();
    // ESTE TEST CAMBIÓ DE FORMA EN E15-17, y el cambio es el arreglo.
    //
    // Antes buscaba el ÚLTIMO dataset del lienzo, porque los hitos se dibujaban
    // como puntos anclados a la serie. Ese contrato posicional era la otra cara
    // del defecto: por los puntos solo cabían los hitos del MOTOR —había que
    // anclarlos a un valor del eje—, así que Proyección no podía enseñar ni los
    // estéticos ni los de salud. Ahora van en el mismo carril que Analizar.
    await page.locator('.view[data-view-id="projection"] canvas').scrollIntoViewIfNeeded();
    const dialog = page.locator('[role="dialog"]');

    const candidatos = await puntosDeMarcador(page, ['phase', 'body', 'health', 'aesthetic']);
    expect(candidatos.length, 'el plan tiene que traer hitos que dibujar').toBeGreaterThan(0);

    let abierto = false;
    for (const punto of candidatos) {
        await page.mouse.click(punto.x, punto.y);
        if (await dialog.count() > 0) { abierto = true; break; }
    }
    expect(abierto, 'ningún marcador respondió al clic').toBe(true);
    await expect(dialog.locator('.mark-card__item')).not.toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Y en mitad del área de trazado —en la MISMA columna de un hito, sobre la
    // curva— no abre nada. La prueba de impacto del carril solo miraba la X, así
    // que un clic sobre la línea abría la ficha del hito que tuviera encima, a
    // media pantalla de distancia. Lo destapó este test (E15-17).
    const sobreLaCurva = candidatos[0];
    await page.mouse.click(sobreLaCurva.x, sobreLaCurva.plotY);
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

// ============================================================
// E13-0 · Los dos defectos que el usuario veía
// ============================================================

test('el interruptor de fluctuación sobrevive a recargar', async ({ page }) => {
    const casilla = page.locator('[data-fluctuation]');
    await expect(casilla).not.toBeChecked();
    await casilla.check();
    await expect(casilla).toBeChecked();

    // Y está EN EL ALMACÉN, no solo en memoria: ese era el defecto exacto.
    // `plan-state.setFluctuation()` regeneraba la proyección y nadie escribía
    // `settings.fluctuationVisible`, que `main.js` sí lee al arrancar.
    const guardado = await page.evaluate(() => {
        const clave = Object.keys(localStorage).find((k) => k.endsWith('.settings'));
        return clave ? JSON.parse(localStorage.getItem(clave) ?? 'null') : null;
    });
    expect(guardado.fluctuationVisible).toBe(true);

    await page.reload();
    await page.click('[data-view="projection"]');
    await expect(page.locator('[data-fluctuation]')).toBeChecked();
});

test('la leyenda no promete check-ins que el lienzo no dibuja', async ({ page }) => {
    // Un check-in con peso pero SIN porcentaje de grasa: el formulario lo
    // permite, y es el caso que destapaba la mentira.
    await page.evaluate(() => {
        const clave = Object.keys(localStorage).find((k) => k.endsWith('.checkins'));
        const perfilClave = Object.keys(localStorage).find((k) => k.endsWith('.profile'));
        if (!clave || !perfilClave) throw new Error('sin perfil sembrado');
        const perfil = JSON.parse(localStorage.getItem(perfilClave) ?? '{}');
        const inicio = new Date(`${perfil.startDateISO}T00:00:00Z`);
        inicio.setUTCDate(inicio.getUTCDate() + 7);
        const dateISO = inicio.toISOString().slice(0, 10);
        const previo = JSON.parse(localStorage.getItem(clave) ?? 'null');
        localStorage.setItem(clave, JSON.stringify({
            schemaVersion: previo?.schemaVersion ?? 6,
            items: [{
                id: `ci_${dateISO}`, dateISO, weightKg: 74.2,
                fatPct: null, measuresCm: {}, subjective: {},
                notes: '', createdAtISO: '2026-01-01T00:00:00.000Z', editedAtISO: null
            }]
        }));
    });
    await page.reload();
    await page.click('[data-view="projection"]');
    await expect(page.locator('.view[data-view-id="projection"] canvas')).toBeVisible();

    const leyenda = page.locator('[data-legend]');

    // En peso SÍ se dibuja y SÍ se nombra.
    await expect(leyenda).toContainText('Check-in');
    expect(await puntosDeCheckin(page)).toBeGreaterThan(0);

    // En grasa NO hay dato, así que ni se dibuja ni se nombra. Antes la leyenda
    // lo listaba igual, porque contaba check-ins guardados en vez de dibujados.
    await page.click('[data-metric="fatPct"]');
    await expect(leyenda).not.toContainText('Check-in');
    expect(await puntosDeCheckin(page)).toBe(0);
});

/** Cuántos puntos de check-in hay en el lienzo (el dataset del rombo). */
async function puntosDeCheckin(page) {
    return page.evaluate(() => {
        const cv = document.querySelector('.view[data-view-id="projection"] canvas');
        const c = /** @type {*} */ (globalThis).Chart?.getChart(cv);
        if (!c) return -1;
        const real = c.data.datasets.find((/** @type {*} */ d) => d.pointStyle === 'rectRot');
        return real ? real.data.length : 0;
    });
}

test('la gráfica de Proyección lleva a Analizar: la multi-selección se encuentra', async ({ page }) => {
    // Descubribilidad, y no es teórica: en la primera prueba real el usuario
    // buscó la multi-selección EN esta gráfica y concluyó que no existía. La
    // función vivía a una vista de distancia sin ningún camino desde aquí.
    const boton = page.locator('[data-go-analysis]');
    await expect(boton).toBeVisible();
    await boton.click();
    await expect(page.locator('.view[data-view-id="analysis"]')).toBeVisible();
    await expect(page.locator('.view[data-view-id="analysis"] [data-open-picker]')).toBeVisible();
});

/* ---------------------------------------------------------------------- *
 * E15-17 · Proyección enseña TODAS las familias de hito
 *
 * Es lo que se pidió en E14 —«deben poder verse los hitos estéticos, de energía
 * y de salud»— y lo que esta vista no podía dar, porque dibujaba los hitos como
 * puntos anclados a la serie: solo cabían los del motor. Ahora comparte carril
 * con Analizar.
 * ---------------------------------------------------------------------- */

test('los filtros de hito están en Proyección, y las cuatro familias nacen encendidas', async ({ page }) => {
    const chips = page.locator('[data-view-id="projection"] [data-mark-cat]');
    await expect(chips).toHaveCount(4);
    for (const cat of ['phase', 'body', 'health', 'aesthetic']) {
        await expect(page.locator(`[data-view-id="projection"] [data-mark-cat="${cat}"]`))
            .toHaveAttribute('aria-pressed', 'true');
    }
});

/** Cuántos marcadores dibuja el carril ahora mismo. */
async function marcadoresEnElCarril(page) {
    // Se cuentan los píxeles opacos de la banda superior del área de trazado,
    // que es donde vive el carril: contar marcas por el DOM no vale, porque
    // están pintadas en el lienzo.
    return page.evaluate(() => {
        const cv = /** @type {HTMLCanvasElement} */ (
            document.querySelector('.view[data-view-id="projection"] canvas'));
        const c = /** @type {*} */ (globalThis).Chart.getChart(cv);
        const dpr = cv.width / cv.clientWidth;
        const area = c.chartArea;
        const ctx = cv.getContext('2d');
        const alto = Math.max(1, Math.round(10 * dpr));
        const d = ctx.getImageData(
            Math.round(area.left * dpr), Math.round(area.top * dpr),
            Math.max(1, Math.round((area.right - area.left) * dpr)), alto).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
    });
}

test('apagar una familia la quita del carril; encenderla la devuelve', async ({ page }) => {
    // Depende del lienzo: bajo la carga de la suite completa tarda en asentarse.
    test.slow();

    // Se afirma por COMPORTAMIENTO, no contando píxeles. Contarlos era frágil de
    // raíz: este plan cruza UN solo umbral de salud, así que su marcador son unas
    // decenas de píxeles sobre un fondo que ya lleva las franjas de fase pintadas,
    // y el margen quedaba dentro del ruido de medida. Lo que de verdad importa es
    // si el marcador RESPONDE, que es lo que hace el usuario.
    const dialog = page.locator('[role="dialog"]');

    // Con salud encendida —lo está por omisión— su marcador abre su ficha.
    for (const cat of ['phase', 'body', 'aesthetic']) {
        await page.locator(`[data-view-id="projection"] [data-mark-cat="${cat}"]`).click();
    }
    const conSalud = await puntosDeMarcador(page, ['health']);
    expect(conSalud.length).toBeGreaterThan(0);

    let abierto = false;
    for (const punto of conSalud) {
        await page.mouse.click(punto.x, punto.y);
        if (await dialog.count() > 0) { abierto = true; break; }
    }
    expect(abierto).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    // Y apagándola, el MISMO sitio deja de responder.
    await page.locator('[data-view-id="projection"] [data-mark-cat="health"]').click();
    await expect(page.locator('[data-view-id="projection"] [data-mark-cat="health"]'))
        .toHaveAttribute('aria-pressed', 'false');
    const tras = await puntosDeMarcador(page, ['health']);
    for (const punto of tras) {
        await page.mouse.click(punto.x, punto.y);
    }
    await expect(dialog, 'con la familia apagada, su marcador no puede seguir ahí').toHaveCount(0);
});

test('los hitos de SALUD llegan a Proyección, con su umbral y su fuente', async ({ page }) => {
    // Depende de píxeles y de coordenadas: bajo la carga de la suite completa
    // el lienzo tarda más en asentarse que el presupuesto de un test normal.
    test.slow();
    // Lo que la vista NO podía enseñar antes de E15-17: los umbrales de salud
    // —con su fuente publicada— vivían en `core/health-milestones.js` y solo los
    // dibujaba Analizar.
    for (const cat of ['phase', 'body', 'aesthetic']) {
        await page.locator(`[data-view-id="projection"] [data-mark-cat="${cat}"]`).click();
    }
    const candidatos = await puntosDeMarcador(page, ['health']);
    expect(candidatos.length, 'este plan tiene que cruzar algún umbral de salud').toBeGreaterThan(0);

    const dialog = page.locator('[role="dialog"]');
    let abierto = false;
    for (const punto of candidatos) {
        await page.mouse.click(punto.x, punto.y);
        if (await dialog.count() > 0) { abierto = true; break; }
    }
    expect(abierto, 'con solo salud encendida, algún marcador tiene que responder').toBe(true);
    // La familia va en PALABRAS, no solo en el color de la barra lateral.
    await expect(dialog.locator('.badge').first()).toHaveText('Salud');
});

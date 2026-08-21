// @ts-check

/**
 * La PWA, comprobada en un navegador real (M6-1).
 *
 * `test/pwa.test.js` solo lee el fuente del service worker, y eso dejó pasar
 * el peor fallo de M6: en producción el precache fallaba ENTERO —Cloudflare
 * responde 308 a `/index.html` y `addAll` es todo-o-nada—, así que el service
 * worker no llegaba a instalarse y la aplicación no tenía offline en absoluto.
 * Desde fuera todo parecía correcto porque la app cargaba de red. Solo el
 * modo avión lo habría delatado; aquí se activa el modo avión.
 */

import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VIEW_IDS } from '../../src/ui/views/_manifest.js';

async function completeOnboarding(page) {
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

/**
 * Espera a que el service worker esté activo y el precache completo.
 *
 * Con `page.waitForFunction` y una función async no vale: la promesa que
 * devuelve ya es «truthy» y la espera termina en el primer sondeo, antes de
 * que la condición se cumpla. `expect.poll` sí espera al valor.
 */
async function esperarPrecache(page) {
    await expect.poll(async () => page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg?.active?.state !== 'activated') return -1;
        const keys = await caches.keys();
        if (keys.length === 0) return -1;
        const cache = await caches.open(keys[0]);
        return (await cache.keys()).length;
    }), { timeout: 25000, message: 'el precache no se completó' }).toBeGreaterThan(50);
}

test('el precache se completa: si falla, la aplicación no tiene offline', async ({ page }) => {
    await page.goto('/');
    await esperarPrecache(page);

    const estado = await page.evaluate(async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        const keys = await caches.keys();
        const cache = await caches.open(keys[0]);
        const entradas = await cache.keys();
        return {
            sw: reg?.active?.state,
            cachés: keys,
            entradas: entradas.length,
            // El shell se guarda como './', no como 'index.html': ver sw.js
            shell: Boolean(await cache.match('./')),
            vendor: Boolean(await cache.match('vendor/chart.umd.min.js'))
        };
    });

    expect(estado.sw).toBe('activated');
    expect(estado.cachés).toHaveLength(1);
    expect(estado.entradas, 'el precache quedó incompleto').toBeGreaterThan(50);
    expect(estado.shell, 'el shell no está cacheado').toBe(true);
    expect(estado.vendor, 'Chart.js no está cacheado: no habría gráfica sin red').toBe(true);
});

test('sin red, la aplicación abre y se puede recorrer entera', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await completeOnboarding(page);
    await esperarPrecache(page);

    // Modo avión
    await context.setOffline(true);
    try {
        await page.reload();
        await expect(page.locator('#today-title')).toBeVisible();

        // Todas las vistas, incluidas las que se cargan con import() diferido
        // y que en esta sesión no se habían visitado nunca. La lista sale del
        // manifiesto: una vista nueva entra aquí sola (M7-3).
        for (const v of VIEW_IDS.filter((id) => id !== 'today')) {
            await page.locator(`[data-view="${v}"]`).click();
            await expect(
                page.locator(`.view[data-view-id="${v}"] .card, .view[data-view-id="${v}"] .state`).first()
            ).toBeVisible();
        }

        // Y la gráfica dibuja: Chart.js sale del precache, no de la red.
        //
        // `expect.poll` y no una lectura suelta tras `toBeVisible()`. El lienzo
        // es VISIBLE a su tamaño por defecto (300×150) antes de que Chart.js
        // exista, así que la primera muestra sale a cero y el test acusa de un
        // fallo que no hay. Era una carrera latente —el recorrido de vistas de
        // arriba tarda distinto según lo que pese cada una— y se volvió
        // determinista al engordar el montaje de Ajustes en M8-5d. La misma
        // corrección que ya se hizo en `csp.spec.js`.
        await page.locator('[data-view="today"]').click();
        await expect(page.locator('canvas')).toBeVisible();
        await expect.poll(() => page.evaluate(() => {
            const c = /** @type {HTMLCanvasElement} */ (document.querySelector('canvas'));
            const ctx = c?.getContext('2d');
            if (!ctx || !c.width) return 0;
            const d = ctx.getImageData(0, 0, c.width, c.height).data;
            let n = 0;
            for (let i = 3; i < d.length; i += 400) if (d[i] > 0) n += 1;
            return n;
        }), { message: 'la gráfica no dibujó sin red', timeout: 15000 }).toBeGreaterThan(100);
    } finally {
        await context.setOffline(false);
    }
});

test('sin red se puede guardar un check-in y sigue ahí al volver la red', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await completeOnboarding(page);
    await esperarPrecache(page);

    await context.setOffline(true);
    try {
        await page.reload();
        await page.locator('[data-view="checkin"]').click();
        await page.fill('[data-field="weightKg"]', '73.6');
        await page.locator('[data-save]').click();
        await page.locator('[data-view="progress"]').click();
        await expect(page.locator('.view')).toContainText('73,6');
    } finally {
        await context.setOffline(false);
    }

    await page.reload();
    await page.locator('[data-view="progress"]').click();
    await expect(page.locator('.view')).toContainText('73,6');
});

test('el aviso de versión nueva se puede pulsar con el puntero, no solo con el teclado', async ({ page }) => {
    // El botón del aviso es el ÚNICO camino para aplicar una versión nueva.
    // `.toast-region` desactiva el puntero para dejar pasar los clics al
    // contenido, y eso lo dejaba muerto: se veía, se enfocaba con el tabulador,
    // pero ni el ratón ni el dedo lo alcanzaban. En un móvil, sin teclado, era
    // un banner permanente e inútil que además activaba lo que tuviera debajo.
    await page.goto('/');
    await expect(page.locator('#onboarding-title').or(page.locator('#today-title'))).toBeVisible();

    await page.evaluate(async () => {
        const toast = await import('/src/ui/components/toast.js');
        /** @type {*} */ (globalThis).__pulsado = 0;
        toast.show('pwa.updateReady', {
            type: 'info',
            duration: 0,
            action: { labelKey: 'pwa.reload', onClick() { /** @type {*} */ (globalThis).__pulsado += 1; } }
        });
    });

    const boton = page.locator('.toast__action');
    await expect(boton).toBeVisible();

    // Lo que hay en el centro del botón ES el botón, no el contenido de debajo
    const encima = await page.evaluate(() => {
        const b = /** @type {HTMLElement} */ (document.querySelector('.toast__action'));
        const r = b.getBoundingClientRect();
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.className ?? '';
    });
    expect(encima, 'algo tapa el botón del aviso').toContain('toast__action');

    await boton.click({ timeout: 3000 });
    expect(await page.evaluate(() => /** @type {*} */ (globalThis).__pulsado)).toBe(1);
});

test('un toque sobre el aviso no activa el control que queda debajo', async ({ browser }) => {
    const context = await browser.newContext({
        viewport: { width: 393, height: 851 },
        hasTouch: true, isMobile: true
    });
    const page = await context.newPage();
    try {
        await page.goto('/');
        await page.evaluate(() => localStorage.clear());
        await page.reload();
        await completeOnboarding(page);

        await page.evaluate(async () => {
            const toast = await import('/src/ui/components/toast.js');
            /** @type {*} */ (globalThis).__pulsado = 0;
            toast.show('pwa.updateReady', {
                type: 'info',
                duration: 0,
                action: { labelKey: 'pwa.reload', onClick() { /** @type {*} */ (globalThis).__pulsado += 1; } }
            });
        });

        const b = await page.locator('.toast__action').boundingBox();
        expect(b).not.toBeNull();
        await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
        expect(await page.evaluate(() => /** @type {*} */ (globalThis).__pulsado)).toBe(1);
    } finally {
        await context.close();
    }
});

/* ── Que una versión nueva LLEGUE ────────────────────────────────────────── */

/**
 * El recorrido que faltaba, y es el que decide si esto se puede arreglar en
 * producción: instalada la versión A, se publica la B, y **el usuario tiene que
 * acabar ejecutando la B**.
 *
 * Todo lo demás de este fichero prueba que el service worker instala y sirve sin
 * red. Nada probaba que se pueda SUSTITUIR, que es justo donde alguien se queda
 * clavado: «recargo y sigo viendo la de siempre».
 *
 * El despliegue se simula **cambiando `sw.js` en disco**, porque es literalmente
 * lo que hace un despliegue y porque no hay otra forma: Playwright no intercepta
 * la petición del script del service worker —lo comprobé—, así que `route()` no
 * sirve para esto. El fichero se restaura pase lo que pase, y estos dos tests
 * corren en serie para no pisarse entre ellos.
 */
test.describe.serial('actualización', () => {
    const SW = fileURLToPath(new URL('../../sw.js', import.meta.url));
    /** @type {string} */ let original;

    test.beforeEach(() => { original = readFileSync(SW, 'utf8'); });
    test.afterEach(() => { writeFileSync(SW, original); });

    /** Publica una «versión nueva»: mismo código, otro `CACHE_VERSION`. */
    function publicar(version) {
        writeFileSync(SW, original.replace(/tl-[0-9a-f]{12}/g, version));
    }

    test('una versión nueva llega al usuario: aviso, un clic, y está ejecutándola', async ({ page }) => {
        await page.goto('/');
        await completeOnboarding(page);
        await esperarPrecache(page);

        publicar('tl-000000000000');
        await page.reload();
        await expect(page.locator('#today-title')).toBeVisible({ timeout: 20000 });

        // El aviso aparece SOLO. Sin él, no hay forma de saber que hay algo
        // nuevo y uno se queda en la versión vieja indefinidamente.
        const aviso = page.locator('.toast', { hasText: /versión nueva/i });
        await expect(aviso, 'no se avisó de que había una versión nueva')
            .toBeVisible({ timeout: 25000 });

        // Y un clic basta: la página vuelve ejecutando la nueva, y la vieja se
        // ha ido —dos cachés conviviendo es media aplicación de cada una—.
        // El clic RECARGA —es lo que se busca—, así que hay que esperar a que la
        // página vuelva antes de preguntarle nada: sondear a través de una
        // navegación revienta con «execution context was destroyed», que es un
        // fallo del test disfrazado de fallo del producto.
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }),
            aviso.getByRole('button').click()
        ]);
        await expect(page.locator('#today-title')).toBeVisible({ timeout: 20000 });

        await expect.poll(async () => page.evaluate(async () => {
            const reg = await navigator.serviceWorker.getRegistration();
            if (reg?.active?.state !== 'activated') return null;
            return (await caches.keys()).filter((k) => k.startsWith('tl-'));
        }), { timeout: 30000, message: 'la versión nueva no llegó a activarse' })
            .toEqual(['tl-000000000000']);
    });

    test('Ajustes dice qué versión se está ejecutando, y sabe buscar otra', async ({ page }) => {
        // Sin esto, «sigo viendo la versión vieja» no se puede ni confirmar ni
        // desmentir: no había NINGUNA forma de saber qué versión corría nadie.
        await page.goto('/');
        await completeOnboarding(page);
        await esperarPrecache(page);

        const entrada = page.locator('[data-nav] [data-view="settings"]');
        if (!(await entrada.first().isVisible())) await page.locator('[data-nav-more]').click();
        await entrada.first().click();

        const version = page.locator('[data-version-running]');
        await expect(version).toBeVisible({ timeout: 20000 });
        await expect(version).toHaveText(/^tl-[0-9a-f]{12}$/);

        // Al día: el botón lo dice, en vez de no hacer nada visible.
        await page.locator('[data-version-check]').click();
        await expect(page.locator('.toast')).toContainText(/última versión/i, { timeout: 25000 });

        // Y con una publicada de verdad, la encuentra a la orden en vez de
        // esperar al ritmo del navegador.
        publicar('tl-222222222222');
        await page.locator('[data-version-check]').click();
        await expect(page.locator('.toast', { hasText: /versión nueva/i }),
            'buscar actualización no encontró la que acababa de publicarse')
            .toBeVisible({ timeout: 30000 });
    });
});

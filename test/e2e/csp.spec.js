// @ts-check

/**
 * La CSP de producción, ejercitada de verdad (M7-7).
 *
 * `docs/RELEASE-V5.md` afirmaba desde M6-3 que los E2E corrían bajo la política
 * real citando `tools/serve-csp.mjs`. Era falso: ese fichero estaba huérfano y
 * `playwright.config.js` levantaba `python3 -m http.server`, que no manda una
 * sola cabecera. **Ningún E2E se había ejecutado nunca bajo la CSP**, así que
 * la única prueba de que la aplicación funciona con ella era la afirmación.
 *
 * Desde M7-7 toda la suite corre contra el servidor de la política —de ahí que
 * los demás specs también la ejerciten sin saberlo—, y este fichero comprueba
 * las dos cosas que solo se pueden comprobar aquí: que la política LLEGA, y
 * que es la segunda capa que apaga lo que `dom.js` ya apaga por su cuenta.
 */

import { test, expect } from '@playwright/test';

test('la respuesta trae la política de `_headers`, no una copia', async ({ page }) => {
    const response = await page.goto('/');
    const csp = response?.headers()['content-security-policy'] ?? '';
    // Las directivas que de verdad cierran algo. Si alguien relaja una en
    // `_headers`, este test lo dice antes del despliegue, no después.
    for (const directiva of [
        "default-src 'self'",
        "script-src 'self'",   // sin 'unsafe-inline': ni handlers ni javascript:
        "style-src 'self'",    // por eso existe applyCssVars en vez de style=""
        "object-src 'none'",
        "base-uri 'none'",
        "frame-ancestors 'none'"
    ]) {
        expect(csp, `falta la directiva ${directiva}`).toContain(directiva);
    }
    expect(csp, "la CSP no puede llevar 'unsafe-inline'").not.toContain('unsafe-inline');
    expect(csp, "la CSP no puede llevar 'unsafe-eval'").not.toContain('unsafe-eval');
});

test('la aplicación arranca entera bajo la política, sin una sola violación', async ({ page }) => {
    // Este es el test que la afirmación de RELEASE-V5 daba por hecho. Una
    // violación de CSP sale por consola como error: si la política rompiera
    // algo —un módulo, la hoja de estilos, el service worker, la gráfica—,
    // aquí se ve.
    /** @type {string[]} */ const violaciones = [];
    page.on('console', (msg) => {
        if (msg.type() === 'error' && /Content Security Policy|Refused to/i.test(msg.text())) {
            violaciones.push(msg.text());
        }
    });
    page.on('pageerror', (err) => violaciones.push(String(err)));

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

    // La gráfica es el caso interesante: Chart.js llega bajo demanda desde
    // `vendor/`, y `script-src 'self'` la dejaría fuera si alguien la moviera
    // a un CDN «solo para probar».
    await expect(page.locator('canvas')).toBeVisible();
    const pintado = await page.evaluate(() => {
        const c = /** @type {HTMLCanvasElement} */ (document.querySelector('canvas'));
        const data = c.getContext('2d')?.getImageData(0, 0, c.width, c.height).data ?? new Uint8ClampedArray();
        let n = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
        return n;
    });
    expect(pintado, 'la gráfica no dibujó bajo la CSP').toBeGreaterThan(1000);

    expect(violaciones, `violaciones de CSP:\n  ${violaciones.join('\n  ')}`).toEqual([]);
});

test('applyCssVars funciona con `style-src self`, que es la razón de que exista', async ({ page }) => {
    // El atributo `style=""` está prohibido por la política; la CSSOM no. Si
    // esa distinción dejara de cumplirse, media interfaz perdería sus barras
    // de progreso en producción y en local no se vería.
    await page.goto('/');
    const valor = await page.evaluate(async () => {
        const { html, render } = await import('/src/ui/dom.js');
        const div = document.createElement('div');
        document.body.appendChild(div);
        render(div, html`<i id="probeta" data-css-progress="73"></i>`);
        const el = /** @type {HTMLElement} */ (div.querySelector('#probeta'));
        const leido = el.style.getPropertyValue('--progress');
        div.remove();
        return leido;
    });
    expect(valor).toBe('73');
});

test('la CSP es la SEGUNDA capa: apaga lo que dom.js ya apaga', async ({ page }) => {
    // `dom-security.spec.js` prueba que `dom.js` se defiende sin ayuda, contra
    // el servidor sin cabeceras. Aquí se prueba lo complementario: que aunque
    // el escapado fallara, la política sigue en medio.
    await page.goto('/');
    const ejecutado = await page.evaluate(async () => {
        /** @type {*} */ (globalThis).__csp = 0;
        const div = document.createElement('div');
        document.body.appendChild(div);
        // innerHTML A PELO, saltándose `dom.js` a propósito: es la simulación
        // de que el escapado se hubiera roto.
        div.innerHTML = '<img src=x onerror="globalThis.__csp=1">';
        await new Promise((r) => setTimeout(r, 300));
        const v = /** @type {*} */ (globalThis).__csp;
        div.remove();
        return v;
    });
    expect(ejecutado, "script-src 'self' dejó correr un handler inline").toBe(0);
});

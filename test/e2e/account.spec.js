// @ts-check

/**
 * La cuenta, con un autenticador de verdad (M8-5d).
 *
 * Corre contra el servidor 8793, que monta las **Pages Functions reales** en
 * proceso con el D1 de `node:sqlite` detrás, y usa el **autenticador virtual de
 * Chrome** por CDP: la implementación real de CTAP2 del navegador. O sea, todo
 * el camino —panel, `account.js`, `api.js`, middleware, enrutador, manejadores,
 * SQL— con lo único sustituido siendo workerd.
 *
 * Se accede por `localhost` y no por la IP: el `rpId` sale del `hostname` y
 * WebAuthn no acepta una IP; el navegador rechazaría la llamada antes de que
 * llegara al servidor.
 *
 * Lo que solo se puede comprobar aquí: que la **regla dura** se ve, que el kit
 * se enseña una vez y desbloquea de verdad, y que nada de esto estorba a quien
 * no quiere cuenta.
 */

import { test, expect } from '@playwright/test';

/** Da de alta el autenticador virtual y devuelve la sesión CDP. */
async function conAutenticador(page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
        options: {
            protocol: 'ctap2',
            transport: 'internal',
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true
        }
    });
    return { cdp, authenticatorId };
}

/** Alta mínima del perfil local, para llegar a Ajustes. */
async function conPerfil(page) {
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
    await page.fill('[data-field="targetMuscleKg"]', '33');
    await page.click('[data-next]');
    await page.click('[data-next]');
    await expect(page.locator('#today-title')).toBeVisible();
}

async function irAAjustes(page) {
    await expect(page.locator('[data-nav]')).toBeVisible();
    const entrada = page.locator('[data-view="settings"]');
    await entrada.first().waitFor({ state: 'attached', timeout: 15000 });
    if (!(await entrada.first().isVisible())) await page.locator('[data-nav-more]').click();
    await entrada.first().click();
    await expect(page.locator('[data-account-panel]')).toBeVisible();
}

/* ── Sin cuenta, nada cambia ─────────────────────────────────────────────── */

test('la aplicación funciona ENTERA sin cuenta, y el panel no estorba', async ({ page }) => {
    // Es el invariante de §1, y aquí deja de ser una frase: se recorre la
    // aplicación sin tocar el panel y no hay ni un aviso ni un bloqueo.
    // El oyente va ANTES de nada: la primera versión de este test lo ponía
    // después de abrir Ajustes y no veía el `GET /api/session` que el panel
    // lanzaba al montarse. Lo cazó otro E2E —«todas las vistas montan sin error
    // de consola»— por el 404 en un servidor sin API.
    const peticiones = [];
    page.on('request', (r) => { if (r.url().includes('/api/')) peticiones.push(r.url()); });

    await conPerfil(page);
    await irAAjustes(page);
    await expect(page.locator('[data-account-create]')).toBeVisible();

    await page.locator('[data-view="today"]').first().click();
    await expect(page.locator('#today-title')).toBeVisible();
    await page.fill('[data-quick-weight]', '74.8');
    await page.click('[data-quick-save]');
    await page.waitForTimeout(400);

    expect(peticiones, 'salió a la red sin que nadie lo pidiera').toEqual([]);
});

/* ── Alta ────────────────────────────────────────────────────────────────── */

test('crear cuenta lleva DERECHO al kit, y no lo da por guardado sin confirmar', async ({ page }) => {
    // La regla dura, vista desde el usuario: con cifrado extremo a extremo,
    // subir datos antes de que haya vía de vuelta fabrica una pérdida
    // irreversible.
    await conAutenticador(page);
    await conPerfil(page);
    await irAAjustes(page);

    await page.click('[data-account-create]');

    // El diálogo del kit se abre solo.
    const dialogo = page.locator('[role="dialog"]');
    await expect(dialogo).toBeVisible({ timeout: 20000 });
    await expect(dialogo.locator('[data-kit-code]')).toBeVisible({ timeout: 20000 });

    // Nueve grupos de cuatro, sin las letras que se confunden al copiar a mano.
    const grupos = dialogo.locator('.kit-code__group');
    await expect(grupos).toHaveCount(9);
    const codigo = (await grupos.allTextContents()).join('-');
    expect(codigo).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){8}$/);

    // Y avisa de que no se va a poder volver a ver.
    await expect(dialogo).toContainText(/no vas a poder volver a verla/i);

    // No se sale sin confirmar que se ha guardado.
    const hecho = dialogo.locator('[data-kit-done]');
    await expect(hecho).toBeDisabled();
    await dialogo.locator('[data-kit-saved]').check();
    await expect(hecho).toBeEnabled();
    await hecho.click();

    // Ahora sí: la cuenta tiene vía de vuelta.
    await expect(page.locator('[data-account-protected]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('[data-account-unprotected]')).toHaveCount(0);
});

test('si se cierra el kit sin guardarlo, el aviso SIGUE ahí', async ({ page }) => {
    // Es lo que impide que la regla dura sea un aviso que se ignora: cerrar el
    // diálogo no marca nada, y el panel vuelve a decir que no se sincroniza.
    await conAutenticador(page);
    await conPerfil(page);
    await irAAjustes(page);

    await page.click('[data-account-create]');
    await expect(page.locator('[data-kit-code]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-modal-close]').click();

    const aviso = page.locator('[data-account-unprotected]');
    await expect(aviso).toBeVisible({ timeout: 20000 });
    // El texto NO promete sincronía: M9 todavía no existe, y decir «ahora se
    // sincroniza» sería la clase de promesa incumplida que E15 fue a cerrar.
    await expect(aviso).toContainText(/no tiene vía de vuelta/i);
    await expect(aviso).not.toContainText(/sincroniz/i);
    // Y no hay forma de descartarlo.
    await expect(aviso.locator('[data-dismiss], [data-modal-close]')).toHaveCount(0);
});

/* ── El ciclo completo ───────────────────────────────────────────────────── */

test('el kit desbloquea de verdad en un navegador que ha perdido la clave', async ({ page, context }) => {
    // El recorrido que justifica todo el diseño. Se simula «perder el
    // dispositivo» borrando la clave de IndexedDB: la passkey sigue en el
    // autenticador, pero la clave de datos ya no está aquí.
    await conAutenticador(page);
    await conPerfil(page);
    await irAAjustes(page);

    await page.click('[data-account-create]');
    await expect(page.locator('[data-kit-code]')).toBeVisible({ timeout: 20000 });
    const codigo = (await page.locator('.kit-code__group').allTextContents()).join('-');
    await page.locator('[data-kit-saved]').check();
    await page.locator('[data-kit-done]').click();
    await expect(page.locator('[data-account-protected]')).toBeVisible({ timeout: 20000 });

    // — se pierde la clave del dispositivo, y la sesión —
    await page.evaluate(() => new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('tl-keys');
        req.onsuccess = () => resolve(null);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
    }));
    await context.clearCookies();
    await page.reload();
    await irAAjustes(page);

    // Entrar con la passkey deja la cuenta abierta pero BLOQUEADA.
    await page.click('[data-account-login]');
    const dialogo = page.locator('[role="dialog"]');
    await expect(dialogo.locator('[data-unlock-code]')).toBeVisible({ timeout: 20000 });

    // Un código equivocado no desbloquea y lo dice.
    await dialogo.locator('[data-unlock-code]').fill('ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ');
    await dialogo.locator('[data-unlock-go]').click();
    await expect(dialogo.locator('[data-unlock-error]')).toBeVisible({ timeout: 20000 });

    // El bueno sí, y en minúsculas y sin guiones: se teclea desde papel.
    await dialogo.locator('[data-unlock-code]').fill(codigo.toLowerCase().replace(/-/g, ''));
    await dialogo.locator('[data-unlock-go]').click();
    await expect(dialogo).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator('[data-account-protected]')).toBeVisible({ timeout: 20000 });
});

/* ── Salir ───────────────────────────────────────────────────────────────── */

test('salir olvida la clave de ESTE dispositivo', async ({ page }) => {
    // Dejarla después de salir es dejar la puerta abierta al siguiente que use
    // el dispositivo.
    await conAutenticador(page);
    await conPerfil(page);
    await irAAjustes(page);

    await page.click('[data-account-create]');
    await expect(page.locator('[data-kit-code]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-kit-saved]').check();
    await page.locator('[data-kit-done]').click();
    await expect(page.locator('[data-account-protected]')).toBeVisible({ timeout: 20000 });

    await page.click('[data-account-logout]');
    await expect(page.locator('[data-account-create]')).toBeVisible({ timeout: 20000 });

    const guardadas = await page.evaluate(() => new Promise((resolve) => {
        const req = indexedDB.open('tl-keys');
        req.onsuccess = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('keys')) return resolve(0);
            const all = db.transaction('keys').objectStore('keys').getAll();
            all.onsuccess = () => resolve(all.result.length);
            all.onerror = () => resolve(-1);
        };
        req.onerror = () => resolve(-1);
    }));
    expect(guardadas, 'la clave siguió guardada tras cerrar sesión').toBe(0);
});

/* ── Accesibilidad y 320 px ──────────────────────────────────────────────── */

test('el panel se maneja con teclado y cabe en 320 px', async ({ page }) => {
    await conAutenticador(page);
    await conPerfil(page);
    await page.setViewportSize({ width: 320, height: 720 });
    await irAAjustes(page);

    // Sin desbordes horizontales.
    const desborda = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    expect(desborda, 'la página desborda a 320 px').toBe(false);

    // El botón se alcanza con el teclado y responde a Enter.
    await page.locator('[data-account-create]').focus();
    await expect(page.locator('[data-account-create]')).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-kit-code]')).toBeVisible({ timeout: 20000 });

    // El diálogo se cierra con Escape y devuelve el foco.
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]')).toHaveCount(0);
    await expect(page.locator('[data-account-kit], [data-account-create]').first()).toBeVisible();
});

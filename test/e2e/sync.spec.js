// @ts-check

/**
 * La sincronía, de punta a punta (M9-4).
 *
 * Corre contra el servidor 8793, que monta las **Pages Functions reales** en
 * proceso con el D1 de `node:sqlite` detrás, y usa el **autenticador virtual de
 * Chrome** por CDP. O sea: navegador de verdad, criptografía de verdad, SQL de
 * verdad. Lo único sustituido es workerd.
 *
 * Lo que solo se puede comprobar aquí, y es lo que decide si esto sirve para
 * algo:
 *
 * 1. **Que un teléfono que lo ha perdido todo recupera sus datos** con su kit y
 *    los ENSEÑA. Recuperar el almacén sin recuperar el índice de perfiles es
 *    bajarse la cuenta entera y ver una pantalla vacía; estuvo así hasta que
 *    este recorrido lo destapó.
 * 2. **Que el servidor no puede leer nada.** Se descarga lo guardado por la
 *    propia API y se busca dentro cualquier campo del esquema en claro.
 * 3. **Que sin cuenta no sale ni un byte.** Es la promesa de `CLAUDE.md` §1 tal
 *    y como quedó reescrita, y aquí es una aserción sobre el tráfico real.
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
async function conPerfil(page, nombre = 'Dani') {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.fill('[data-field="name"]', nombre);
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

/**
 * Navega a una vista.
 *
 * Por la barra y no por la URL: el enrutador de esta aplicación **no usa la
 * dirección**, la navegación vive en memoria. `page.goto('/#/checkin')` recarga
 * en el panel de Hoy y el test se queda esperando un campo que nunca llega.
 */
async function irA(page, id) {
    await expect(page.locator('[data-nav]')).toBeVisible();
    const entrada = page.locator(`[data-view="${id}"]`);
    await entrada.first().waitFor({ state: 'attached', timeout: 15000 });
    if (!(await entrada.first().isVisible())) await page.locator('[data-nav-more]').click();
    await entrada.first().click();
}

async function irAAjustes(page) {
    await irA(page, 'settings');
    await expect(page.locator('[data-account-panel]')).toBeVisible();
}

/**
 * Apunta un peso desde el formulario completo.
 *
 * Se espera a que el dato ESTÉ EN EL ALMACÉN, no a que la pantalla cambie:
 * adónde lleva guardar es una decisión de producto que puede moverse, y lo que
 * este test necesita afirmar es que el check-in existe.
 */
async function apuntarPeso(page, kg) {
    await irA(page, 'checkin');
    await page.fill('[data-field="weightKg"]', kg);
    await page.click('[data-save]');
    await expect.poll(async () => page.evaluate((peso) => {
        const clave = Object.keys(localStorage).find((k) => k.endsWith('.checkins'));
        if (!clave) return false;
        const v = JSON.parse(localStorage.getItem(clave) ?? '{}');
        return (v.items ?? []).some((/** @type {*} */ i) => i.weightKg === peso);
    }, Number(kg)), { timeout: 20000 }).toBe(true);
}

/** Crea la cuenta y guarda el kit. Devuelve el código. */
async function conCuenta(page) {
    await page.click('[data-account-create]');
    await expect(page.locator('[data-kit-code]')).toBeVisible({ timeout: 20000 });
    const codigo = (await page.locator('.kit-code__group').allTextContents()).join('-');
    await page.locator('[data-kit-saved]').check();
    await page.locator('[data-kit-done]').click();
    await expect(page.locator('[data-account-protected]')).toBeVisible({ timeout: 20000 });
    return codigo;
}

/** Espera a que el bucle diga que ha terminado, y sincroniza a mano primero. */
async function sincronizar(page) {
    const boton = page.locator('[data-account-sync]');
    await expect(boton).toBeVisible({ timeout: 20000 });
    await boton.click();
    // Se afirma sobre el ESTADO, leído del atributo: si acaba en `error` el
    // mensaje dice cuál, en vez de un «no encontré el selector» que no explica
    // nada.
    // Se afirma sobre el ESTADO más su código de error: si acaba mal, el mensaje
    // dice POR QUÉ, en vez de un «no encontré el selector» que no explica nada.
    await expect
        .poll(async () => {
            const p = page.locator('[data-account-sync-state]');
            const estado = await p.getAttribute('data-account-sync-state').catch(() => 'sin-panel');
            const error = await p.getAttribute('data-account-sync-error').catch(() => '');
            return error ? `${estado}:${error}` : estado;
        }, { timeout: 30000 })
        .toBe('idle');
}

/* ── El recorrido completo ───────────────────────────────────────────────── */

test('un dispositivo que lo pierde todo recupera sus datos Y LOS ENSEÑA', async ({ page, context }) => {
    await conAutenticador(page);
    await conPerfil(page, 'Ana');
    await irAAjustes(page);
    const codigo = await conCuenta(page);

    // Un check-in con un peso reconocible: es lo que hay que volver a ver.
    await apuntarPeso(page, '73.4');
    await irAAjustes(page);
    await sincronizar(page);

    // — se pierde TODO lo local: el almacén, la clave y la sesión —
    await page.evaluate(() => new Promise((resolve) => {
        localStorage.clear();
        const req = indexedDB.deleteDatabase('tl-keys');
        req.onsuccess = () => resolve(null);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
    }));
    await context.clearCookies();
    await page.reload();

    // Es un teléfono nuevo: arranca por el asistente, porque aquí no hay nada.
    await expect(page.locator('[data-field="name"]')).toBeVisible({ timeout: 20000 });

    // Se entra desde el asistente igual que se entraría desde Ajustes: la
    // huella local de «aquí hubo cuenta» también se ha ido, así que hay que
    // llegar al panel. Se completa un perfil mínimo para poder navegar.
    await conPerfil(page, 'Provisional');
    await irAAjustes(page);
    await page.click('[data-account-login]');

    // Entra, pero bloqueada: la clave de datos ya no está aquí.
    const dialogo = page.locator('[role="dialog"]');
    await expect(dialogo.locator('[data-unlock-code]')).toBeVisible({ timeout: 20000 });
    await dialogo.locator('[data-unlock-code]').fill(codigo.toLowerCase().replace(/-/g, ''));
    await dialogo.locator('[data-unlock-go]').click();
    await expect(dialogo).toHaveCount(0, { timeout: 20000 });

    await sincronizar(page);

    // Y AQUÍ está lo que importa: el perfil que estaba en el servidor aparece
    // en la lista de perfiles de este dispositivo. Sin eso, los datos estarían
    // en el almacén y ninguna vista los enseñaría.
    await expect(page.locator('#set-profiles').locator('xpath=..').locator('.profile-list'))
        .toContainText('Ana', { timeout: 20000 });

    // Y el check-in vuelve, con su peso.
    const perfiles = await page.evaluate(() => {
        const clave = Object.keys(localStorage).find((k) => k.endsWith('.profiles'));
        return clave ? JSON.parse(localStorage.getItem(clave) ?? '{}') : null;
    });
    const idDeAna = perfiles.profiles.find((/** @type {*} */ p) => p.name === 'Ana')?.id;
    expect(idDeAna, 'el perfil recuperado no está en el índice').toBeTruthy();

    const pesos = await page.evaluate((id) => {
        const clave = Object.keys(localStorage).find((k) => k.includes(`.${id}.checkins`));
        const v = clave ? JSON.parse(localStorage.getItem(clave) ?? '{}') : { items: [] };
        return v.items.map((/** @type {*} */ i) => i.weightKg);
    }, idDeAna);
    expect(pesos).toContain(73.4);
});

/* ── Lo que el servidor guarda ───────────────────────────────────────────── */

test('lo que hay en el servidor son BYTES: ni una fecha, ni un peso, ni un nombre', async ({ page }) => {
    await conAutenticador(page);
    await conPerfil(page, 'Ana');
    await irAAjustes(page);
    await conCuenta(page);
    await sincronizar(page);

    // Se pide por la API real, con la sesión real, y se mira lo que devuelve.
    const crudo = await page.evaluate(async () => {
        const r = await fetch('/api/sync?since=0', { credentials: 'same-origin' });
        return r.text();
    });
    const datos = JSON.parse(crudo);
    expect(datos.rows.length, 'no se subió nada, así que este test no prueba nada')
        .toBeGreaterThan(0);

    // Ni una fecha, ni un nombre, ni un campo del esquema.
    expect(crudo).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(crudo).not.toContain('Ana');
    expect(crudo).not.toMatch(/weightKg|dateISO|fatPct|muscleKg|notes/);

    // Las etiquetas son HMAC de 16 bytes, no claves legibles.
    for (const fila of datos.rows) {
        expect(fila.itemTag).toMatch(/^[A-Za-z0-9_-]{22}$/);
    }

    // Y el relleno hace su trabajo: todos los criptogramas miden un múltiplo de
    // 256 bytes más la cabecera, así que su tamaño no distingue un check-in con
    // notas de uno sin ellas.
    const tamanos = new Set(datos.rows.map((/** @type {*} */ f) => {
        const bytes = Math.floor(f.ciphertext.length * 3 / 4);
        return (bytes - 1 - 12 - 16) % 256;
    }));
    expect([...tamanos], 'el relleno a 256 bytes no se está aplicando').toEqual([0]);
});

/* ── Sin cuenta, cero red ────────────────────────────────────────────────── */

test('sin cuenta no se llama NUNCA a la API, ni siquiera para preguntar', async ({ page }) => {
    // La promesa de §1 tal y como quedó reescrita: la aplicación funciona entera
    // sin cuenta, y «sin cuenta» significa sin una sola petición.
    /** @type {string[]} */ const llamadas = [];
    page.on('request', (r) => {
        const u = new URL(r.url());
        if (u.pathname.startsWith('/api/')) llamadas.push(`${r.method()} ${u.pathname}`);
    });

    await conPerfil(page, 'Ana');
    await apuntarPeso(page, '73.4');
    await irAAjustes(page);

    // Y se le da tiempo de sobra al bucle por si arrancara sin cuenta.
    await page.waitForTimeout(4000);
    expect(llamadas, 'se salió a la red sin que nadie hubiera creado cuenta').toEqual([]);
});

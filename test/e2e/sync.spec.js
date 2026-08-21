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

/* ── La puerta de entrada ────────────────────────────────────────────────── */

test('se puede ENTRAR desde el asistente, sin inventarse un perfil primero', async ({ page, context }) => {
    // El fallo que esto arregla, y que solo se ve mirando la aplicación desde
    // fuera: el panel de cuenta vive dentro de Ajustes, y a Ajustes no se llega
    // hasta terminar de crear un plan. Quien ya tenía cuenta y abría la
    // aplicación en un móvil nuevo no veía NINGUNA forma de entrar.
    await conAutenticador(page);
    await conPerfil(page, 'Ana');
    await irAAjustes(page);
    const codigo = await conCuenta(page);
    await apuntarPeso(page, '73.4');
    await irAAjustes(page);
    await sincronizar(page);

    // — móvil nuevo: ni datos, ni clave, ni sesión —
    await page.evaluate(() => new Promise((resolve) => {
        localStorage.clear();
        const req = indexedDB.deleteDatabase('tl-keys');
        req.onsuccess = () => resolve(null);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
    }));
    await context.clearCookies();
    await page.reload();

    // Arranca en el asistente, y la puerta está ahí, en el primer paso.
    await expect(page.locator('[data-field="name"]')).toBeVisible({ timeout: 20000 });
    const entrar = page.locator('[data-signin-go]');
    await expect(entrar).toBeVisible();
    await entrar.click();

    // Desbloquear con el kit, que es lo único que se le pide.
    const dialogo = page.locator('[role="dialog"]');
    await expect(dialogo.locator('[data-unlock-code]')).toBeVisible({ timeout: 20000 });
    await dialogo.locator('[data-unlock-code]').fill(codigo.toLowerCase().replace(/-/g, ''));
    await dialogo.locator('[data-unlock-go]').click();

    // Y se sale del asistente directo a los datos, sin tocar nada más.
    await expect(page.locator('#today-title')).toBeVisible({ timeout: 30000 });

    // El perfil recuperado es el activo, y NO queda ningún perfil de relleno.
    const indice = await page.evaluate(() => {
        const k = Object.keys(localStorage).find((x) => x.endsWith('.profiles'));
        return k ? JSON.parse(localStorage.getItem(k) ?? '{}') : null;
    });
    expect(indice.profiles.map((/** @type {*} */ p) => p.name)).toEqual(['Ana']);
    expect(indice.activeProfileId).toBe(indice.profiles[0].id);

    // Y el check-in está donde tiene que estar.
    const pesos = await page.evaluate((id) => {
        const k = Object.keys(localStorage).find((x) => x.includes(`.${id}.checkins`));
        const v = k ? JSON.parse(localStorage.getItem(k) ?? '{}') : { items: [] };
        return v.items.map((/** @type {*} */ i) => i.weightKg);
    }, indice.profiles[0].id);
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

/* ── Las fotos (M9-5) ────────────────────────────────────────────────────── */

/** Sube una foto de verdad por el input de la galería. */
async function subirFoto(page, nombre = 'progreso.png') {
    await irA(page, 'photos');
    await expect(page.locator('[data-file]')).toBeAttached({ timeout: 20000 });
    // Un PNG real y pequeño, generado aquí: el compresor tiene que poder
    // decodificarlo de verdad, así que no vale un fichero inventado.
    const png = await page.evaluate(async () => {
        const c = document.createElement('canvas');
        c.width = 300; c.height = 400;
        const g = /** @type {*} */ (c.getContext('2d'));
        g.fillStyle = '#3aa'; g.fillRect(0, 0, 300, 400);
        g.fillStyle = '#f60'; g.fillRect(40, 60, 120, 200);
        const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
        const buf = new Uint8Array(await blob.arrayBuffer());
        return [...buf];
    });
    await page.setInputFiles('[data-file]', {
        name: nombre, mimeType: 'image/png', buffer: Buffer.from(png)
    });
}

test('una foto se comprime, se cifra y aparece en el otro dispositivo', async ({ page, context }) => {
    await conAutenticador(page);
    await conPerfil(page, 'Ana');
    await irAAjustes(page);
    const codigo = await conCuenta(page);

    await subirFoto(page);
    // La galería la enseña, y el almacén local guarda la COMPRIMIDA.
    await expect(page.locator('.photo-grid img, [data-photo-id] img').first())
        .toBeVisible({ timeout: 30000 });

    const local = await page.evaluate(async () => {
        const db = await new Promise((res, rej) => {
            const r = indexedDB.open('tl-photos');
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
        });
        const filas = await new Promise((res) => {
            const req = db.transaction('photos').objectStore('photos').getAll();
            req.onsuccess = () => res(req.result);
            req.onerror = () => res([]);
        });
        return filas.map((f) => ({ bytes: f.bytes, contentType: f.contentType }));
    });
    expect(local.length).toBe(1);
    expect(local[0].contentType, 'no se recodificó: el PNG se guardó tal cual')
        .toMatch(/^image\/(webp|jpeg)$/);

    await irAAjustes(page);
    await sincronizar(page);

    // Lo que hay en R2 son BYTES: se pide por la API y no se parece a un PNG.
    const crudo = await page.evaluate(async () => {
        const inv = await (await fetch('/api/photos', { credentials: 'same-origin' })).json();
        const o = inv.objects[0];
        const r = await fetch(`/api/photos/${o.photoId}?profile=${o.profileId}`, { credentials: 'same-origin' });
        const b = new Uint8Array(await r.arrayBuffer());
        return { total: inv.objects.length, tipo: r.headers.get('Content-Type'), cabecera: [...b.slice(0, 8)] };
    });
    expect(crudo.total).toBe(1);
    expect(crudo.tipo).toBe('application/octet-stream');
    // Ni firma PNG (137 80 78 71) ni RIFF de WebP: está cifrado.
    expect(crudo.cabecera.slice(0, 4)).not.toEqual([137, 80, 78, 71]);
    expect(crudo.cabecera.slice(0, 4)).not.toEqual([82, 73, 70, 70]);

    // — móvil nuevo —
    await page.evaluate(() => new Promise((resolve) => {
        localStorage.clear();
        let quedan = 2;
        const listo = () => { if (--quedan === 0) resolve(null); };
        for (const nombre of ['tl-keys', 'tl-photos']) {
            const req = indexedDB.deleteDatabase(nombre);
            req.onsuccess = listo; req.onerror = listo; req.onblocked = listo;
        }
    }));
    await context.clearCookies();
    await page.reload();

    await expect(page.locator('[data-signin-go]')).toBeVisible({ timeout: 20000 });
    await page.locator('[data-signin-go]').click();
    const dialogo = page.locator('[role="dialog"]');
    await expect(dialogo.locator('[data-unlock-code]')).toBeVisible({ timeout: 20000 });
    await dialogo.locator('[data-unlock-code]').fill(codigo.toLowerCase().replace(/-/g, ''));
    await dialogo.locator('[data-unlock-go]').click();
    await expect(page.locator('#today-title')).toBeVisible({ timeout: 30000 });

    // Y la foto vuelve: el puntero llegó por la sincronía y el blob se baja de
    // R2 cuando la galería lo pide.
    await irA(page, 'photos');
    await expect(page.locator('.photo-grid img, [data-photo-id] img').first())
        .toBeVisible({ timeout: 30000 });
    await expect(page.locator('[data-photos-missing]')).toHaveCount(0);
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

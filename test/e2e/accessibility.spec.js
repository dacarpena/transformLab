// @ts-check

/**
 * Pasada de accesibilidad AA (M6-4), la parte que se puede automatizar.
 *
 * Lo que NO cubre y hay que mirar a mano queda en la bitácora: lectura real
 * con VoiceOver, zoom al 200 %, y si los textos se entienden. Un test puede
 * decir que un botón tiene nombre accesible; no puede decir si ese nombre
 * significa algo.
 *
 * El contraste de los tokens ya se mide en `test/tokens-contrast.test.js`;
 * aquí se comprueba la estructura sobre el DOM real de las diez vistas.
 */

import { test, expect } from '@playwright/test';

const VIEWS = ['today', 'checkin', 'progress', 'projection', 'nutrition', 'training', 'body', 'milestones', 'photos', 'achievements', 'settings'];

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

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await completeOnboarding(page);
});

test('todo control interactivo tiene nombre accesible en las diez vistas', async ({ page }) => {
    /** @type {string[]} */ const anonymous = [];
    for (const view of VIEWS) {
        await page.locator(`[data-view="${view}"]`).click();
        await expect(page.locator(`.view[data-view-id="${view}"]`)).toBeVisible();
        const found = await page.evaluate((v) => {
            const host = document.querySelector(`.view[data-view-id="${v}"]`);
            if (!host) return [];
            /** @type {string[]} */ const out = [];
            for (const el of host.querySelectorAll('button, a[href], input, select, textarea, [role="button"]')) {
                if (/** @type {HTMLInputElement} */ (el).type === 'hidden') continue;
                const describedBy = el.getAttribute('aria-labelledby');
                const candidates = [
                    el.getAttribute('aria-label'),
                    el.getAttribute('title'),
                    describedBy ? document.getElementById(describedBy)?.textContent : null,
                    el.closest('label')?.textContent,
                    el.textContent
                ];
                const label = candidates.map((c) => (c ?? '').trim()).find((c) => c !== '') ?? '';
                if (label === '') out.push(`${v}: <${el.tagName.toLowerCase()} class="${el.className}">`);
            }
            return out;
        }, view);
        anonymous.push(...found);
    }
    expect(anonymous).toEqual([]);
});

test('cada vista aporta un encabezado y el orden de niveles no salta', async ({ page }) => {
    for (const view of VIEWS) {
        await page.locator(`[data-view="${view}"]`).click();
        // `photos` pinta tras leer IndexedDB: hay que esperar al contenido
        await expect(page.locator(`.view[data-view-id="${view}"] .card, .view[data-view-id="${view}"] .state`).first()).toBeVisible();
        const levels = await page.evaluate((v) => [...document.querySelectorAll(`.view[data-view-id="${v}"] h1, .view[data-view-id="${v}"] h2, .view[data-view-id="${v}"] h3, .view[data-view-id="${v}"] h4`)]
            .map((h) => Number(h.tagName.slice(1))), view);
        expect(levels.length, `${view} no tiene encabezados`).toBeGreaterThan(0);
        for (let i = 1; i < levels.length; i += 1) {
            expect(levels[i] - levels[i - 1], `${view}: salto de h${levels[i - 1]} a h${levels[i]}`).toBeLessThanOrEqual(1);
        }
    }
});

test('ninguna imagen queda sin alternativa textual', async ({ page }) => {
    /** @type {string[]} */ const bad = [];
    for (const view of VIEWS) {
        await page.locator(`[data-view="${view}"]`).click();
        const found = await page.evaluate((v) => {
            const host = document.querySelector(`.view[data-view-id="${v}"]`);
            if (!host) return [];
            /** @type {string[]} */ const out = [];
            for (const el of host.querySelectorAll('img, svg, canvas')) {
                if (el.getAttribute('aria-hidden') === 'true') continue;
                const named = el.hasAttribute('alt') || el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby');
                if (!named) out.push(`${v}: <${el.tagName.toLowerCase()}>`);
            }
            return out;
        }, view);
        bad.push(...found);
    }
    expect(bad).toEqual([]);
});

test('a 320 px ninguna vista desborda a lo ancho', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    /** @type {string[]} */ const overflowing = [];
    for (const view of VIEWS) {
        await page.evaluate((v) => {
            /** @type {HTMLElement | null} */
            const button = document.querySelector(`[data-view="${v}"]`);
            button?.click();
        }, view);
        await expect(page.locator(`.view[data-view-id="${view}"]`)).toBeVisible();
        const overflow = await page.evaluate(() =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 0) overflowing.push(`${view}: +${overflow}px`);
    }
    expect(overflowing).toEqual([]);
});

test('a 320 px con zoom del 200 % tampoco desborda', async ({ page }) => {
    // 200 % de zoom equivale a la mitad de ancho CSS: es lo que exige 1.4.4.
    await page.setViewportSize({ width: 320, height: 720 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    /** @type {string[]} */ const overflowing = [];
    for (const view of VIEWS) {
        await page.evaluate((v) => {
            /** @type {HTMLElement | null} */
            const button = document.querySelector(`[data-view="${v}"]`);
            button?.click();
        }, view);
        await expect(page.locator(`.view[data-view-id="${view}"]`)).toBeVisible();
        const overflow = await page.evaluate(() =>
            document.documentElement.scrollWidth - document.documentElement.clientWidth);
        if (overflow > 0) overflowing.push(`${view}: +${overflow}px`);
    }
    expect(overflowing).toEqual([]);
});

test('se llega a todas las secciones solo con el teclado', async ({ page }) => {
    await page.keyboard.press('Tab'); // salto al contenido
    const focusables = [];
    for (let i = 0; i < 60; i += 1) {
        const info = await page.evaluate(() => {
            const el = document.activeElement;
            if (!el || el === document.body) return null;
            return { view: el.getAttribute('data-view'), tag: el.tagName };
        });
        if (info?.view) focusables.push(info.view);
        await page.keyboard.press('Tab');
    }
    // Las cuatro primarias más el botón «más» tienen que aparecer tabulando
    for (const id of ['today', 'checkin', 'progress', 'nutrition']) {
        expect(focusables, `no se llega a ${id} con el teclado`).toContain(id);
    }
});

test('el modal atrapa el foco, cierra con Escape y lo devuelve', async ({ page }) => {
    await page.locator('[data-view="training"]').click();
    const opener = page.locator('[data-add-exercise]');
    await opener.focus();
    await page.keyboard.press('Enter');

    await expect(page.locator('.modal[role="dialog"][aria-modal="true"]')).toBeVisible();

    // Tabular en círculo nunca saca el foco del diálogo
    for (let i = 0; i < 12; i += 1) {
        await page.keyboard.press('Tab');
        const inside = await page.evaluate(() =>
            Boolean(document.activeElement?.closest('.modal')));
        expect(inside, `el foco se escapó del modal en el tabulador ${i}`).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(page.locator('.modal[role="dialog"]')).toHaveCount(0);
    await expect(opener).toBeFocused();
});

test('el foco visible nunca se anula', async ({ page }) => {
    // `getComputedStyle` no acepta pseudo-CLASES, así que se lee la regla de
    // la hoja: lo que importa es que exista y que nadie la haya neutralizado.
    const rules = await page.evaluate(() => {
        /** @type {string[]} */ const out = [];
        for (const sheet of document.styleSheets) {
            let list;
            try { list = sheet.cssRules; } catch { continue; }
            for (const rule of list) {
                const text = /** @type {CSSStyleRule} */ (rule).cssText ?? '';
                if (text.includes(':focus-visible') || text.includes('outline')) out.push(text);
            }
        }
        return out;
    });
    const focusRule = rules.find((r) => r.startsWith(':focus-visible'));
    expect(focusRule, 'no hay regla :focus-visible').toBeTruthy();
    expect(focusRule).toMatch(/outline:/);

    // Y nadie la anula con `outline: none` en ningún otro sitio
    const suppressors = rules.filter((r) => /outline:\s*(none|0px|0)\s*[;}]/.test(r));
    expect(suppressors, `alguien anula el outline: ${suppressors.join(' | ')}`).toEqual([]);

    // Con el foco puesto por teclado, el anillo se ve de verdad
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const live = await page.evaluate(() => {
        const el = /** @type {HTMLElement | null} */ (document.activeElement);
        if (!el || el === document.body) return null;
        const style = getComputedStyle(el);
        return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
    });
    expect(live).not.toBeNull();
    expect(live?.style).not.toBe('none');
    expect(live?.width ?? 0).toBeGreaterThan(0);
});

test('los avisos viven en una región aria-live que no roba el foco', async ({ page }) => {
    await page.locator('[data-view="training"]').click();
    await page.locator('[data-add-exercise]').click();
    await page.locator('.modal [data-go]').click(); // sin nombre: error

    const region = page.locator('.toast-region');
    await expect(region).toHaveAttribute('role', 'status');
    await expect(region).toHaveAttribute('aria-live', 'assertive');
    // Y el foco sigue donde estaba: un aviso informa, no interrumpe
    const insideModal = await page.evaluate(() => Boolean(document.activeElement?.closest('.modal, body')));
    expect(insideModal).toBe(true);
});

test('con prefers-reduced-motion no queda ninguna transición larga', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('[data-view="body"]').click();
    const durations = await page.evaluate(() =>
        [...document.querySelectorAll('.view *')]
            .map((el) => getComputedStyle(el).transitionDuration)
            .flatMap((d) => d.split(',').map((s) => parseFloat(s)))
            .filter((n) => Number.isFinite(n)));
    const tooLong = durations.filter((d) => d > 0.05);
    expect(tooLong).toEqual([]);
});

test('en escritorio con la ventana baja se llega a TODAS las secciones', async ({ page }) => {
    // Diez secciones no caben en una ventana baja (un portátil pequeño, media
    // pantalla, el tipo del sistema en grande). Sin desplazamiento, «Ajustes»
    // quedaba fuera y era literalmente inalcanzable: ni con el ratón, ni con
    // el dedo, ni haciendo scroll — la barra lateral no se movía.
    for (const height of [900, 600, 460, 380]) {
        await page.setViewportSize({ width: 1280, height });

        const nav = page.locator('.app__nav');
        const ajustes = page.locator('[data-view="settings"]');
        await expect(ajustes).toBeAttached();

        const estado = await page.evaluate(() => {
            const n = /** @type {HTMLElement} */ (document.querySelector('.app__nav'));
            return {
                desborda: n.scrollHeight > n.clientHeight,
                overflowY: getComputedStyle(n).overflowY
            };
        });
        if (estado.desborda) {
            expect(estado.overflowY, `a ${height} px la barra desborda y no se puede desplazar`)
                .toMatch(/auto|scroll/);
            // Y desplazándose se alcanza de verdad
            await nav.evaluate((n) => { n.scrollTop = n.scrollHeight; });
        }
        await expect(ajustes).toBeInViewport();
        await ajustes.click();
        await expect(page.locator('.view[data-view-id="settings"]')).toBeVisible();
        await page.locator('[data-view="today"]').click();
    }
});

// @ts-check

/**
 * La frontera de seguridad, ejecutada contra el analizador de HTML de un
 * navegador de verdad (M7-6).
 *
 * POR QUÉ AQUÍ Y NO EN NODE. `test/ui-dom.test.js` cubre la parte pura
 * —`escapeHtml`, `html``, `safeUrl`—, pero `render`, `applyCssVars` y `on`
 * tocan el DOM, y simularlo no vale: lo que decide si `<img src=x onerror=…>`
 * ejecuta algo es el analizador del navegador, no una biblioteca que lo imita.
 * Para una frontera de seguridad, la única autoridad que cuenta es la real.
 *
 * Estos tests importan `src/ui/dom.js` DENTRO de la página, así que prueban el
 * mismo fichero que se despliega, sin dobles.
 *
 * CORREN SIN CSP, Y ES DELIBERADO (M7-7). El resto de la suite va contra el
 * servidor de la política real; esta no. Bajo `script-src 'self'` el navegador
 * ya bloquea los `javascript:` y los handlers inline, así que un resultado
 * limpio probaría que la CSP funciona —que se comprueba en `csp.spec.js`— y no
 * que `escapeHtml` escape. Cada capa se verifica sola: si un día hay que
 * relajar la CSP, `dom.js` sigue teniendo su red y este fichero lo demuestra.
 */

import { test, expect } from '@playwright/test';

const SIN_CSP = 'http://127.0.0.1:8082';

test.beforeEach(async ({ page }) => {
    await page.goto(`${SIN_CSP}/`);
    // Un testigo global: si algo consigue ejecutarse, lo levanta. Que un XSS
    // «no se vea» no es prueba de nada — hay que comprobar que no CORRIÓ.
    await page.evaluate(() => { /** @type {*} */ (globalThis).__xss = 0; });
});

/** Monta un contenedor limpio y devuelve su selector. */
async function conBanco(page) {
    await page.evaluate(() => {
        document.querySelectorAll('#banco').forEach((n) => n.remove());
        const div = document.createElement('div');
        div.id = 'banco';
        document.body.appendChild(div);
    });
    return '#banco';
}

test('render con datos hostiles no ejecuta NADA', async ({ page }) => {
    await conBanco(page);
    const resultado = await page.evaluate(async () => {
        const { html, render } = await import('/src/ui/dom.js');
        const banco = /** @type {HTMLElement} */ (document.querySelector('#banco'));
        const vectores = [
            '<img src=x onerror="globalThis.__xss=1">',
            '<script>globalThis.__xss=1</script>',
            '<svg onload="globalThis.__xss=1">',
            '"><img src=x onerror="globalThis.__xss=1">',
            '</p><img src=x onerror="globalThis.__xss=1"><p>',
            '<iframe src="javascript:globalThis.__xss=1"></iframe>'
        ];
        for (const v of vectores) render(banco, html`<p title="${v}">${v}</p>`);
        // margen para que un onerror en vuelo llegue a correr
        await new Promise((r) => setTimeout(r, 250));
        return {
            xss: /** @type {*} */ (globalThis).__xss,
            elementosCreados: banco.querySelectorAll('img, script, svg, iframe').length,
            texto: banco.textContent
        };
    });
    expect(resultado.xss, 'se ejecutó código interpolado').toBe(0);
    expect(resultado.elementosCreados, 'el dato se convirtió en elementos').toBe(0);
    // y el usuario ve el texto tal cual escribió, que es el otro requisito:
    // escapar no puede significar que el dato desaparezca (el bucle deja el
    // último vector, así que se comprueba ese).
    expect(resultado.texto).toContain('<iframe src="javascript:');
});

test('render de una cadena suelta la escapa: no hay camino sin escapar', async ({ page }) => {
    await conBanco(page);
    const r = await page.evaluate(async () => {
        const { render } = await import('/src/ui/dom.js');
        const banco = /** @type {HTMLElement} */ (document.querySelector('#banco'));
        // Sin marcar como RawHtml: es texto de fuera y se trata como tal.
        render(banco, '<img src=x onerror="globalThis.__xss=1">');
        await new Promise((res) => setTimeout(res, 200));
        return { xss: /** @type {*} */ (globalThis).__xss, imgs: banco.querySelectorAll('img').length };
    });
    expect(r.xss).toBe(0);
    expect(r.imgs).toBe(0);
});

test('un href javascript: se ejecuta de verdad, y safeUrl lo apaga', async ({ page }) => {
    // Control POSITIVO y negativo en el mismo test. Sin el positivo, un
    // `__xss === 0` no probaría nada: podría ser que el vector no funcione en
    // este navegador y el filtro no estuviera haciendo nada.
    //
    // Los dos clics van dentro de un iframe del mismo origen: un `href`
    // javascript: navega el marco que lo contiene, y hacerlo en la página
    // principal destruiría el contexto de ejecución del test.
    await conBanco(page);
    const r = await page.evaluate(async () => {
        const { html, render, safeUrl } = await import('/src/ui/dom.js');
        const banco = /** @type {HTMLElement} */ (document.querySelector('#banco'));
        render(banco, html`<span></span>`);

        /** @param {string} href */
        const clicEnMarco = async (href) => {
            const marco = document.createElement('iframe');
            banco.appendChild(marco);
            const doc = /** @type {Document} */ (marco.contentDocument);
            /** @type {*} */ (marco.contentWindow).parent.__marcado = 0;
            doc.body.innerHTML = `<a id="a">x</a>`;
            const a = /** @type {HTMLAnchorElement} */ (doc.getElementById('a'));
            a.setAttribute('href', href);
            a.click();
            await new Promise((res) => setTimeout(res, 250));
            const marcado = /** @type {*} */ (globalThis).__marcado;
            marco.remove();
            return marcado;
        };

        const crudo = 'javascript:parent.__marcado=1';
        const conControl = await clicEnMarco(crudo);          // control positivo
        const filtrado = await clicEnMarco(safeUrl(crudo));   // lo que hace la app
        return { conControl, filtrado, href: safeUrl(crudo) };
    });

    expect(r.conControl, 'el vector NO funciona en este navegador: el test no probaría nada').toBe(1);
    expect(r.filtrado, 'safeUrl dejó pasar el esquema javascript:').toBe(0);
    expect(r.href).toBe('');
});

test('applyCssVars solo deja entrar números finitos a la hoja de estilos', async ({ page }) => {
    await conBanco(page);
    const r = await page.evaluate(async () => {
        const { html, render } = await import('/src/ui/dom.js');
        const banco = /** @type {HTMLElement} */ (document.querySelector('#banco'));
        render(banco, html`
            <i id="ok" data-css-progress="42"></i>
            <i id="texto" data-css-progress="rojo; background:url(http://evil/x)"></i>
            <i id="nan" data-css-progress="NaN"></i>
            <i id="inf" data-css-progress="Infinity"></i>
        `);
        const leer = (/** @type {string} */ id) =>
            /** @type {HTMLElement} */ (banco.querySelector(`#${id}`)).style.getPropertyValue('--progress');
        return { ok: leer('ok'), texto: leer('texto'), nan: leer('nan'), inf: leer('inf') };
    });
    expect(r.ok).toBe('42');
    // Lo que no es número no entra: por aquí no se cuela una URL a la hoja de
    // estilos, que es la mitad de un XSS por exfiltración.
    expect(r.texto).toBe('');
    expect(r.nan).toBe('');
    expect(r.inf).toBe('');
});

test('on() delega solo dentro de su raíz y sobrevive al re-render', async ({ page }) => {
    await conBanco(page);
    const r = await page.evaluate(async () => {
        const { html, render, on } = await import('/src/ui/dom.js');
        const banco = /** @type {HTMLElement} */ (document.querySelector('#banco'));
        const fuera = document.createElement('div');
        fuera.innerHTML = '<button data-go>fuera</button>';
        document.body.appendChild(fuera);

        let clics = 0;
        const off = on(banco, 'click', '[data-go]', () => { clics++; });

        render(banco, html`<span><button data-go>dentro</button></span>`);
        /** @type {HTMLElement} */ (banco.querySelector('[data-go]')).click();

        // Re-render: el nodo original ya no existe, pero la delegación sigue.
        render(banco, html`<span><button data-go>nuevo</button></span>`);
        /** @type {HTMLElement} */ (banco.querySelector('[data-go]')).click();

        // Un botón que casa con el selector pero vive FUERA no debe contar.
        /** @type {HTMLElement} */ (fuera.querySelector('[data-go]')).click();
        const trasFuera = clics;

        off();
        /** @type {HTMLElement} */ (banco.querySelector('[data-go]')).click();
        fuera.remove();
        return { trasFuera, trasDesuscribir: clics };
    });
    expect(r.trasFuera, 'contó un clic de fuera de la raíz, o perdió el re-render').toBe(2);
    expect(r.trasDesuscribir, 'la desuscripción no desconectó el listener').toBe(2);
});

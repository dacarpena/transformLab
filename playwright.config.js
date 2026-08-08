// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright levanta los servidores por su cuenta, de modo que el E2E corre
 * igual en local y en CI sin pasos manuales.
 *
 * DOS SERVIDORES, Y ES A PROPÓSITO (M7-7).
 *
 * **8081 · la CSP real.** `docs/RELEASE-V5.md` afirmaba desde M6-3 que los E2E
 * corrían bajo la política de producción citando `tools/serve-csp.mjs`. Era
 * falso: ese fichero estaba huérfano y aquí se levantaba `python3
 * -m http.server`, que no manda una sola cabecera. **Ningún E2E se había
 * ejecutado nunca bajo la CSP.** Ahora sí, y `_headers` es la única fuente:
 * el servidor lo lee, así que la política que se prueba es literalmente la que
 * despliega Cloudflare Pages, no una copia que se desincroniza.
 *
 * **8082 · sin cabeceras.** `dom-security.spec.js` tiene que demostrar que
 * `dom.js` se defiende SOLO. Bajo la CSP, `script-src 'self'` ya bloquea los
 * esquemas `javascript:` y los handlers inline, así que un resultado limpio no
 * probaría nada sobre el escapado — probaría que la CSP funciona, que es otra
 * cosa y se prueba aparte. Cada capa se verifica en aislamiento; si un día la
 * CSP se relaja, `dom.js` sigue teniendo su red.
 */
export default defineConfig({
    testDir: './test/e2e',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? 'list' : 'line',
    use: {
        baseURL: 'http://127.0.0.1:8081',
        trace: 'on-first-retry'
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
    ],
    webServer: [
        {
            command: 'node tools/serve-csp.mjs 8081',
            url: 'http://127.0.0.1:8081/',
            reuseExistingServer: !process.env.CI,
            timeout: 30000
        },
        {
            command: 'python3 -m http.server 8082 --bind 127.0.0.1',
            url: 'http://127.0.0.1:8082/index.html',
            reuseExistingServer: !process.env.CI,
            timeout: 30000
        }
    ]
});

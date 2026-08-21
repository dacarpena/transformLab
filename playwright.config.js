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
 * **8793 · con `/api/*`.** (Era 8790 hasta que otro proyecto de esta misma
 * máquina levantó ahí su `wrangler dev`: con `reuseExistingServer`, Playwright
 * daba el puerto por bueno y los tests corrían contra OTRA aplicación, colgados
 * sin decir por qué. Un puerto de test es una dependencia compartida de la
 * máquina, no del repositorio.)
 * El E2E de la cuenta necesita la API viva, y este
 * servidor monta las Pages Functions REALES en su propio proceso con el D1 de
 * `node:sqlite` detrás (`--api`). Se accede por `localhost` y no por la IP: el
 * `rpId` de WebAuthn sale del `hostname`, y una IP no es un `rpId` válido — el
 * navegador rechazaría la llamada antes de que llegara al servidor. Lo único que
 * se sustituye es workerd, y eso se verifica aparte con `npm run serve:api`.
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
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
            // La cuenta y la sincronía van en su propio proyecto: necesitan otro
            // origen —el que tiene `/api/*` vivo—. Aquí no lo tienen, y correrlas
            // igualmente da fallos que no dicen nada sobre el código.
            testIgnore: /(account|sync)\.spec\.js/
        },
        {
            name: 'account',
            testMatch: /(account|sync)\.spec\.js/,
            use: { ...devices['Desktop Chrome'], baseURL: 'http://localhost:8793' }
        }
    ],
    webServer: [
        {
            command: 'node tools/serve-csp.mjs 8081',
            url: 'http://127.0.0.1:8081/',
            reuseExistingServer: !process.env.CI,
            timeout: 30000
        },
        {
            command: 'node tools/serve-csp.mjs 8793 --api',
            url: 'http://localhost:8793/api/health',
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

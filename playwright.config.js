// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright levanta el servidor estático por su cuenta, de modo que el E2E
 * corre igual en local y en CI sin pasos manuales.
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
    webServer: {
        command: 'python3 -m http.server 8081 --bind 127.0.0.1',
        url: 'http://127.0.0.1:8081/index.html',
        reuseExistingServer: !process.env.CI,
        timeout: 30000
    }
});

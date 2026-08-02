// @ts-check

/**
 * Arranque de TransformLab v5 (CLAUDE.md §3): storage → i18n → [perfil → router].
 * En M0 el shell demuestra el pipeline completo con comportamiento mínimo real;
 * perfil y router llegan en M2/M3.
 */

import * as storage from './data/storage.js';
import { t, setLocale, getLocale } from './i18n/i18n.js';
import { html, render } from './ui/dom.js';

function boot() {
    // 1 · storage: idioma persistido (el selector de idioma llega en M3-6)
    const savedLocale = storage.get('settings.locale');
    if (savedLocale.ok && typeof savedLocale.value === 'string') {
        setLocale(savedLocale.value);
    }
    document.documentElement.lang = getLocale();
    document.title = t('app.title');

    // 2 · storage: contador de arranques — verificación viva de lectura+escritura
    const savedBoots = storage.get('meta.boots');
    const boots = savedBoots.ok && typeof savedBoots.value === 'number' ? savedBoots.value + 1 : 1;
    const writeResult = storage.set('meta.boots', boots);
    const storageState = writeResult.ok ? t('shell.storage.ok') : t('shell.storage.unavailable');

    // 3 · shell
    const app = document.getElementById('app');
    if (!app) return;
    render(app, html`
        <main class="shell">
            <header>
                <h1>${t('app.title')}</h1>
                <p class="tagline">${t('app.tagline')}</p>
            </header>
            <section class="card" aria-live="polite">
                <p>${t('shell.status.ready')}</p>
                <p class="muted">${t('shell.status.storage', { state: storageState })}</p>
                <p class="muted">${t('shell.boots', { count: boots })}</p>
            </section>
            <footer class="shell-footer">
                <p>${t('footer.privacy')}</p>
            </footer>
        </main>
    `);
}

boot();

// @ts-check

/**
 * Ajustes: perfil, idioma, multiperfil, copia de seguridad, privacidad y zona
 * de peligro (decisión C6 y M3-6).
 *
 * La zona de peligro está separada visualmente y su acción exige teclear el
 * nombre del perfil. Esa comprobación NO vive aquí sino en `profiles.remove`,
 * de modo que no se puede saltar desde ningún otro punto de la aplicación.
 */

import { html, render, on, safeUrl } from '../dom.js';
import { t, getLocale, setLocale, availableLocales } from '../../i18n/i18n.js';
import * as storage from '../../data/storage.js';
import * as profiles from '../../data/profiles.js';
import * as backup from '../../data/backup.js';
import * as plans from '../plan-state.js';
import * as router from '../router.js';
import * as reminder from '../reminder.js';
import * as modal from '../components/modal.js';
import * as toast from '../components/toast.js';
import { bytes as formatBytes, num } from '../format.js';
import { longDate } from '../dates.js';
import * as recalibrate from '../recalibrate.js';

/** @type {(() => void) | null} */
let onProfilesChanged = null;
/** @type {(() => void) | null} */
let onEditProfile = null;

function renderProfileSection() {
    const data = plans.get();
    if (!data) return '';
    return html`
        <section class="card" aria-labelledby="set-profile">
            <h2 id="set-profile" class="card__title">${t('settings.section.profile')}</h2>
            <p class="secondary">${t('settings.profileSummary', {
                weight: data.composition.weightKg.toFixed(1),
                fat: data.composition.fatPct.toFixed(1),
                target: data.plan.summary.targetWeightKg.toFixed(1)
            })}</p>
            <p class="muted">${t('settings.editProfileHint')}</p>
            <div class="btn-row">
                <button type="button" class="btn" data-edit-profile>${t('action.editProfile')}</button>
            </div>
        </section>
    `;
}

function renderProfilesSection() {
    const list = profiles.list();
    const active = profiles.getActive();
    if (!list.ok || !active.ok) {
        return html`
            <section class="card">
                <h2 class="card__title">${t('settings.section.profiles')}</h2>
                <p class="field__error">${t('error.code.profiles.indexCorrupt')}</p>
            </section>
        `;
    }
    return html`
        <section class="card" aria-labelledby="set-profiles">
            <h2 id="set-profiles" class="card__title">${t('settings.section.profiles')}</h2>
            <ul class="profile-list">
                ${list.value.map((p) => html`
                    <li class="profile-item ${p.id === active.value ? 'profile-item--active' : ''}">
                        <span>${p.name}${p.id === active.value ? html` <span class="muted">· ${t('settings.activeProfile')}</span>` : ''}</span>
                        <span class="btn-row">
                            ${p.id === active.value ? '' : html`
                                <button type="button" class="btn btn--sm" data-switch="${p.id}">${t('action.switch')}</button>
                            `}
                            <button type="button" class="btn btn--sm" data-rename="${p.id}">${t('action.rename')}</button>
                        </span>
                    </li>
                `)}
            </ul>
            <div class="btn-row">
                <button type="button" class="btn" data-new-profile>${t('settings.newProfile')}</button>
            </div>
        </section>
    `;
}

function renderDataSection() {
    const budget = storage.quotaBudget();
    const used = budget.ok ? budget.value : null;
    return html`
        <section class="card" aria-labelledby="set-data">
            <h2 id="set-data" class="card__title">${t('settings.section.data')}</h2>

            ${used ? html`
                <div class="quota-bar" role="img"
                     aria-label="${t('settings.storageUsed', { used: formatBytes(used.totalBytes), total: formatBytes(used.limitBytes) })}">
                    <div class="quota-bar__fill ${used.warn ? 'quota-bar__fill--warn' : ''}"
                         data-css-fill="${Math.min(1, used.usedRatio)}"></div>
                </div>
                <p class="muted">${t('settings.storageUsed', {
                    used: formatBytes(used.totalBytes),
                    total: formatBytes(used.limitBytes)
                })}</p>
                ${used.warn ? html`
                    <p class="notice notice--warning">
                        <span class="notice__icon" aria-hidden="true">⚠</span>
                        <span>${t('settings.storageWarn')}</span>
                    </p>
                ` : ''}
            ` : ''}

            <p class="muted">${t('settings.exportHint')}</p>
            <div class="btn-row">
                <button type="button" class="btn" data-export>${t('action.export')}</button>
                <label class="btn">
                    ${t('action.import')}
                    <input type="file" accept="application/json,.json" data-import class="visually-hidden">
                </label>
            </div>
            <p class="muted">${t('settings.importHint')}</p>
        </section>
    `;
}

function renderLanguageSection() {
    return html`
        <section class="card" aria-labelledby="set-lang">
            <h2 id="set-lang" class="card__title">${t('settings.section.language')}</h2>
            <label class="field">
                <span class="field__label">${t('onboarding.field.locale')}</span>
                <select class="select" data-locale>
                    ${availableLocales().map((code) => html`<option value="${code}">${t(`lang.${code}`)}</option>`)}
                </select>
            </label>
        </section>
    `;
}

/**
 * Recordatorio semanal (M6-2). El permiso NO se pide aquí: se pide en el
 * manejador del botón, que es el gesto del usuario que el navegador exige.
 */
function renderReminderSection() {
    const state = reminder.permissionState();
    const schedule = reminder.getSchedule();
    const active = schedule !== null && state === 'granted';

    return html`
        <section class="card" aria-labelledby="set-reminder">
            <h2 id="set-reminder" class="card__title">${t('reminder.title')}</h2>
            <p class="secondary">${t('reminder.body')}</p>

            ${state === 'unsupported' ? html`
                <p class="notice notice--warning">
                    <span class="notice__icon" aria-hidden="true">⚠</span>
                    <span>${t('reminder.unsupported')}</span>
                </p>
            ` : state === 'denied' ? html`
                <p class="notice notice--warning">
                    <span class="notice__icon" aria-hidden="true">⚠</span>
                    <span>${t('reminder.denied')}</span>
                </p>
            ` : html`
                <div class="field-grid">
                    <label class="field">
                        <span class="field__label">${t('reminder.weekday')}</span>
                        <select class="select" data-reminder-weekday>
                            ${[1, 2, 3, 4, 5, 6, 0].map((d) => html`
                                <option value="${d}" ${schedule?.weekday === d ? 'selected' : ''}>${t(`weekday.${d}`)}</option>
                            `)}
                        </select>
                    </label>
                    <label class="field">
                        <span class="field__label">${t('reminder.hour')}</span>
                        <select class="select" data-reminder-hour>
                            ${Array.from({ length: 24 }, (_, h) => html`
                                <option value="${h}" ${(schedule?.hour ?? 9) === h ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>
                            `)}
                        </select>
                    </label>
                </div>
                <div class="btn-row">
                    <button type="button" class="btn ${active ? '' : 'btn--primary'}" data-reminder-enable>
                        ${t(active ? 'reminder.update' : 'reminder.enable')}
                    </button>
                    ${active ? html`
                        <button type="button" class="btn" data-reminder-disable>${t('reminder.disable')}</button>
                    ` : ''}
                </div>
                ${active ? html`<p class="muted">${t('reminder.activeHint')}</p>` : ''}
            `}

            <p class="muted">${t('reminder.localOnly')}</p>
        </section>
    `;
}

function renderLegalSection() {
    return html`
        <section class="card" aria-labelledby="set-legal">
            <h2 id="set-legal" class="card__title">${t('settings.privacyTitle')}</h2>
            <p class="secondary">${t('settings.privacyBody')}</p>
            <h3 class="card__title">${t('settings.disclaimerTitle')}</h3>
            <p class="secondary">${t('settings.disclaimerBody')}</p>
        </section>
    `;
}

/**
 * Historial de planes archivados.
 *
 * Existía todo menos esto: `recalibrate.history()` documentaba «para la vista
 * de ajustes» y no la llamaba nadie, las cuatro claves `recal.*` estaban
 * traducidas y `.plan-history__item` esperaba en el CSS. Mientras tanto, el
 * modal de recalibración le promete al usuario que **«el plan actual se
 * guardará en el historial»** — y no había historial que abrir. Se cumple la
 * promesa en vez de retirarla: el dato ya se guardaba.
 */
function renderPlanHistorySection() {
    const entries = recalibrate.history();
    if (entries.length === 0) return '';
    return html`
        <section class="card" aria-labelledby="set-history">
            <h2 id="set-history" class="card__title">${t('recal.history')}</h2>
            <ul class="profile-list">
                ${[...entries].reverse().map((entry) => html`
                    <li class="plan-history__item">
                        <span>
                            <strong>${t(`recal.reason.${entry.reason}`) !== `recal.reason.${entry.reason}`
                                ? t(`recal.reason.${entry.reason}`)
                                : entry.reason}</strong>
                            <span class="muted"> · ${t('recal.archivedAt', { date: longDate(entry.archivedAtISO) })}</span>
                        </span>
                        <span class="muted numeric">${t('recal.planSummary', {
                            days: entry.days, target: num(entry.targetKg)
                        })}</span>
                    </li>
                `)}
            </ul>
        </section>
    `;
}

function renderDangerSection() {
    const active = profiles.getActive();
    const list = profiles.list();
    if (!active.ok || !list.ok) return '';
    const me = list.value.find((p) => p.id === active.value);
    if (!me) return '';
    return html`
        <section class="card danger-zone" aria-labelledby="set-danger">
            <h2 id="set-danger" class="card__title">${t('settings.section.danger')}</h2>
            <div class="btn-row">
                <button type="button" class="btn btn--danger" data-delete-profile="${me.id}" data-profile-name="${me.name}">
                    ${t('settings.deleteProfile')}
                </button>
            </div>
        </section>
    `;
}

/** @param {HTMLElement} container */
function draw(container) {
    render(container, html`
        <h1 class="card__title">${t('settings.title')}</h1>
        ${renderProfileSection()}
        ${renderProfilesSection()}
        ${renderLanguageSection()}
        ${renderReminderSection()}
        ${renderDataSection()}
        ${renderPlanHistorySection()}
        ${renderLegalSection()}
        ${renderDangerSection()}
    `);
    const select = /** @type {HTMLSelectElement | null} */ (container.querySelector('[data-locale]'));
    if (select) select.value = getLocale();
}

/** Descarga un texto como fichero, sin dependencias. */
function download(/** @type {*} */ filename, /** @type {*} */ text) {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    // Por `safeUrl` aunque hoy sea un `blob:` que crea esta misma línea
    link.href = safeUrl(url);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}

/** @param {HTMLElement} container */
export function mount(container) {
    draw(container);

    // El permiso se pide DENTRO del clic: es el gesto que el navegador exige,
    // y pedirlo al cargar es la vía rápida a que lo bloqueen para siempre.
    on(container, 'click', '[data-reminder-enable]', async () => {
        const weekday = Number(/** @type {HTMLSelectElement | null} */ (container.querySelector('[data-reminder-weekday]'))?.value);
        const hour = Number(/** @type {HTMLSelectElement | null} */ (container.querySelector('[data-reminder-hour]'))?.value);
        if (!Number.isInteger(weekday) || !Number.isInteger(hour)) return;

        const permission = await reminder.requestPermission();
        if (permission !== 'granted') {
            // Denegar es una respuesta válida: se repinta para explicar que
            // queda el aviso in-app, y no se insiste.
            draw(container);
            toast.show('reminder.deniedToast');
            return;
        }
        if (!reminder.setSchedule({ weekday, hour })) {
            toast.error('error.generic');
            return;
        }
        draw(container);
        toast.success('reminder.saved');
    });

    on(container, 'click', '[data-reminder-disable]', () => {
        if (!reminder.setSchedule(null)) {
            toast.error('error.generic');
            return;
        }
        draw(container);
        toast.success('reminder.disabled');
    });

    on(container, 'change', '[data-locale]', (_event, target) => {
        const locale = /** @type {HTMLSelectElement} */ (target).value;
        if (!setLocale(locale)) return;
        document.documentElement.lang = locale;
        document.title = t('app.title');

        const stored = storage.get('settings');
        const base = stored.ok && stored.value ? /** @type {object} */ (stored.value) : {};
        const saved = storage.set('settings', { ...base, schemaVersion: 5, locale });
        if (!saved.ok) toast.fromErrorCode(saved.error.split(':')[0]);

        // Cambiar de idioma repinta la vista y la navegación; NO vuelve a
        // enrutar la aplicación entera. Un re-enrutado completo remontaba el
        // asistente y descartaba este mismo cambio.
        draw(container);
        router.refreshNav();
    });

    on(container, 'click', '[data-edit-profile]', () => {
        if (onEditProfile) onEditProfile();
    });

    on(container, 'click', '[data-switch]', (_event, target) => {
        const id = target.getAttribute('data-switch');
        if (!id) return;
        const switched = profiles.setActive(id);
        if (!switched.ok) {
            toast.fromErrorCode(switched.error);
            return;
        }
        plans.clear();
        toast.success('settings.switched.success');
        if (onProfilesChanged) onProfilesChanged();
    });

    on(container, 'click', '[data-new-profile]', () => {
        const dialog = modal.open({
            titleKey: 'settings.newProfile',
            size: 'sm',
            body: html`
                <label class="field">
                    <span class="field__label">${t('settings.profileName')}</span>
                    <input type="text" class="input" data-name autocomplete="off">
                </label>
                <div class="modal__actions">
                    <button type="button" class="btn" data-modal-close>${t('action.cancel')}</button>
                    <button type="button" class="btn btn--primary" data-go>${t('action.create')}</button>
                </div>
            `
        });
        dialog.querySelector('[data-go]')?.addEventListener('click', () => {
            const input = /** @type {HTMLInputElement | null} */ (dialog.querySelector('[data-name]'));
            const created = profiles.create(input?.value ?? '', { createdAtISO: new Date().toISOString() });
            if (!created.ok) {
                toast.fromErrorCode(created.error);
                return;
            }
            modal.close();
            plans.clear();
            toast.success('settings.created.success');
            if (onProfilesChanged) onProfilesChanged();
        });
    });

    on(container, 'click', '[data-rename]', (_event, target) => {
        const id = target.getAttribute('data-rename');
        if (!id) return;
        const dialog = modal.open({
            titleKey: 'action.rename',
            size: 'sm',
            body: html`
                <label class="field">
                    <span class="field__label">${t('settings.profileName')}</span>
                    <input type="text" class="input" data-name autocomplete="off">
                </label>
                <div class="modal__actions">
                    <button type="button" class="btn" data-modal-close>${t('action.cancel')}</button>
                    <button type="button" class="btn btn--primary" data-go>${t('action.save')}</button>
                </div>
            `
        });
        dialog.querySelector('[data-go]')?.addEventListener('click', () => {
            const input = /** @type {HTMLInputElement | null} */ (dialog.querySelector('[data-name]'));
            const renamed = profiles.rename(id, input?.value ?? '');
            if (!renamed.ok) {
                toast.fromErrorCode(renamed.error);
                return;
            }
            modal.close();
            toast.success('settings.renamed.success');
            draw(container);
        });
    });

    on(container, 'click', '[data-export]', () => {
        const exported = backup.exportProfiles({ exportedAtISO: new Date().toISOString() });
        if (!exported.ok) {
            toast.fromErrorCode(exported.error);
            return;
        }
        const text = backup.serialize(exported.value);
        if (!text.ok) {
            toast.error('error.generic');
            return;
        }
        download(`transformlab-${new Date().toISOString().slice(0, 10)}.json`, text.value);
        toast.success('settings.exported.success');
    });

    on(container, 'change', '[data-import]', (event) => {
        const input = /** @type {HTMLInputElement} */ (event.target);
        const file = input.files?.[0];
        if (!file) return;
        file.text().then((text) => {
            const inspected = backup.inspect(text);
            if (!inspected.ok) {
                toast.error('settings.import.invalid');
                input.value = '';
                return;
            }
            const { summary, backup: parsed } = inspected.value;
            const checkins = summary.profiles.reduce((s, p) => s + p.checkins, 0);
            // Resumen ANTES de escribir nada: el usuario ve qué contiene el
            // fichero y confirma. `inspect` no ha tocado el almacén.
            const dialog = modal.open({
                titleKey: 'settings.importTitle',
                body: html`
                    <p>${t('settings.importSummary', { profiles: summary.profiles.length, checkins })}</p>
                    <ul class="profile-list">
                        ${summary.profiles.map((p) => html`<li class="profile-item"><span>${p.name}</span></li>`)}
                    </ul>
                    ${summary.warnings.length > 0 ? html`
                        <p class="notice notice--warning">
                            <span class="notice__icon" aria-hidden="true">⚠</span>
                            <span>${t('settings.importDropped')}</span>
                        </p>
                    ` : ''}
                    <div class="modal__actions">
                        <button type="button" class="btn" data-modal-close>${t('action.cancel')}</button>
                        <button type="button" class="btn btn--primary" data-go>${t('settings.importConfirm')}</button>
                    </div>
                `,
                onClose: () => { input.value = ''; }
            });
            dialog.querySelector('[data-go]')?.addEventListener('click', () => {
                const applied = backup.apply(parsed, { nowISO: new Date().toISOString() });
                modal.close();
                if (!applied.ok) {
                    toast.fromErrorCode(applied.error);
                    if (onProfilesChanged) onProfilesChanged();
                    return;
                }
                toast.success('settings.imported.success', { count: applied.value.importedProfiles.length });
                draw(container);
            });
        }).catch(() => {
            toast.error('settings.import.invalid');
            input.value = '';
        });
    });

    on(container, 'click', '[data-delete-profile]', (_event, target) => {
        const id = target.getAttribute('data-delete-profile');
        const name = target.getAttribute('data-profile-name');
        if (!id || !name) return;
        modal.confirm({
            titleKey: 'settings.deleteProfileTitle',
            messageKey: 'settings.deleteProfileBody',
            params: { name },
            confirmKey: 'action.delete',
            danger: true,
            confirmText: name,
            onConfirm: () => {
                const removed = profiles.remove(id, name);
                if (!removed.ok) {
                    toast.fromErrorCode(removed.error);
                    return;
                }
                plans.clear();
                toast.success('settings.deleted.success');
                if (onProfilesChanged) onProfilesChanged();
            }
        });
    });
}

/** @param {() => void} fn */
export function setOnProfilesChanged(fn) {
    onProfilesChanged = fn;
}

/** @param {() => void} fn */
export function setOnEditProfile(fn) {
    onEditProfile = fn;
}

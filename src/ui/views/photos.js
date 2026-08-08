// @ts-check

/**
 * Fotos de progreso (M5-4). Los blobs viven en IndexedDB (`photos-db.js`) y
 * solo los metadatos en localStorage — la tensión 1 del plan.
 *
 * Aviso de privacidad específico y visible: una foto del cuerpo es más
 * sensible que un número, y el usuario debe saber que se queda en el
 * dispositivo antes de hacer la primera.
 */

import { html, render, on } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import { SCHEMA_VERSION, validateCollection } from '../../data/schema.js';
import * as storage from '../../data/storage.js';
import * as photosDb from '../../data/photos-db.js';
import * as plans from '../plan-state.js';
import * as modal from '../components/modal.js';
import * as toast from '../components/toast.js';
import { empty } from '../components/state.js';
import { bytes as formatBytes } from '../format.js';

/** URLs de objeto vivas, para revocarlas al desmontar (si no, fuga). */
/** @type {string[]} */ let liveUrls = [];

/**
 * Testigo del dibujado en curso.
 *
 * `draw()` es asíncrona (lee blobs de IndexedDB uno a uno) y `unmount()` es
 * síncrona: al navegar rápido, `revokeAll()` limpiaba las URLs vivas y el
 * `draw()` en vuelo seguía creando MÁS justo después, que ya no las revocaba
 * nadie. Fuga real, y creciente con el número de fotos. Cada dibujado toma un
 * testigo; si al volver de un `await` el testigo ya no es el suyo, se retira.
 */
let drawToken = 0;

/** Fechas elegidas en el comparador antes/después. */
/** @type {{ before: string, after: string }} */
let comparison = { before: '', after: '' };

function readMeta() {
    const stored = storage.get('photos');
    if (!stored.ok || stored.value === null) return [];
    const parsed = validateCollection('photos', stored.value);
    return parsed.ok ? parsed.value.items : [];
}

/** @param {Array<*>} items */
function writeMeta(items) {
    const checked = validateCollection('photos', { schemaVersion: SCHEMA_VERSION, items });
    if (!checked.ok) return false;
    return storage.set('photos', checked.value).ok;
}

function revokeAll() {
    for (const url of liveUrls) URL.revokeObjectURL(url);
    liveUrls = [];
}

/** @param {HTMLElement} container */
async function draw(container) {
    revokeAll();
    const profileId = storage.getActiveProfile();
    const meta = readMeta();

    const token = ++drawToken;
    const usage = await photosDb.usage(profileId);
    const list = await photosDb.list(profileId);
    if (token !== drawToken || !container.isConnected) return;

    if (!list.ok) {
        render(container, html`
            <h1 class="card__title">${t('photos.title')}</h1>
            <section class="card">
                <p class="notice notice--warning">
                    <span class="notice__icon" aria-hidden="true">⚠</span>
                    <span>${t('photos.unavailable')}</span>
                </p>
            </section>
        `);
        return;
    }

    // se cargan los blobs solo de las fotos que se van a pintar
    const withBlobs = [];
    for (const item of meta) {
        const record = await photosDb.get(profileId, item.id);
        // Si mientras llegaba este blob el usuario cambió de vista o se lanzó
        // otro dibujado, se sueltan las URLs de ESTE y se abandona.
        if (token !== drawToken || !container.isConnected) {
            for (const u of withBlobs) URL.revokeObjectURL(u.url);
            return;
        }
        if (!record.ok || !record.value) continue;
        const url = URL.createObjectURL(record.value.blob);
        liveUrls.push(url);
        withBlobs.push({ ...item, url });
    }

    // El comparador arranca en los extremos: la primera y la última foto son
    // la pareja que de verdad muestra el cambio.
    const ids = withBlobs.map((p) => p.id);
    if (!ids.includes(comparison.before)) comparison.before = ids[0] ?? '';
    if (!ids.includes(comparison.after)) comparison.after = ids.at(-1) ?? '';
    const before = withBlobs.find((p) => p.id === comparison.before) ?? null;
    const after = withBlobs.find((p) => p.id === comparison.after) ?? null;

    render(container, html`
        <h1 class="card__title">${t('photos.title')}</h1>

        <section class="card">
            <p class="notice">
                <span class="notice__icon" aria-hidden="true">🔒</span>
                <span>${t('photos.privacy')}</span>
            </p>
            <div class="btn-row">
                <label class="btn btn--primary">
                    ${t('photos.add')}
                    <input type="file" accept="image/*" data-file class="visually-hidden">
                </label>
            </div>
            ${usage.ok ? html`
                <p class="muted">${t('photos.usage', { count: usage.value.count, size: formatBytes(usage.value.bytes) })}</p>
            ` : ''}
        </section>

        ${withBlobs.length >= 2 ? html`
            <section class="card" aria-labelledby="compare-title">
                <h2 id="compare-title" class="card__title">${t('photos.compare')}</h2>
                <div class="field-grid">
                    <label class="field">
                        <span class="field__label">${t('photos.before')}</span>
                        <select class="input" data-before>
                            ${withBlobs.map((p) => html`
                                <option value="${p.id}" ${p.id === comparison.before ? 'selected' : ''}>${p.dateISO}</option>
                            `)}
                        </select>
                    </label>
                    <label class="field">
                        <span class="field__label">${t('photos.after')}</span>
                        <select class="input" data-after>
                            ${withBlobs.map((p) => html`
                                <option value="${p.id}" ${p.id === comparison.after ? 'selected' : ''}>${p.dateISO}</option>
                            `)}
                        </select>
                    </label>
                </div>
                <div class="photo-compare">
                    <figure>
                        <img src="${before?.url ?? ''}" alt="${t('photos.before')}: ${before?.dateISO ?? ''}">
                        <figcaption>${before?.dateISO ?? ''}</figcaption>
                    </figure>
                    <figure>
                        <img src="${after?.url ?? ''}" alt="${t('photos.after')}: ${after?.dateISO ?? ''}">
                        <figcaption>${after?.dateISO ?? ''}</figcaption>
                    </figure>
                </div>
            </section>
        ` : ''}

        ${withBlobs.length === 0
            ? html`<section class="card">${empty({ icon: '📷', titleKey: 'photos.emptyTitle', bodyKey: 'photos.emptyBody' })}</section>`
            : html`
                <section class="card">
                    <h2 class="card__title">${t('photos.galleryTitle')}</h2>
                    <ul class="photo-grid">
                        ${withBlobs.map((p) => html`
                            <li class="photo-item">
                                <img src="${p.url}" alt="${p.dateISO}" loading="lazy">
                                <div class="photo-item__bar">
                                    <span class="muted">${p.dateISO}</span>
                                    <button type="button" class="btn btn--sm btn--danger"
                                            data-delete-photo="${p.id}" data-date="${p.dateISO}">
                                        ${t('action.delete')}
                                    </button>
                                </div>
                            </li>
                        `)}
                    </ul>
                </section>
            `}
    `);
}

/** @param {HTMLElement} container */
export function mount(container) {
    draw(container);

    on(container, 'change', '[data-before]', (event) => {
        comparison.before = /** @type {HTMLSelectElement} */ (event.target).value;
        draw(container);
    });

    on(container, 'change', '[data-after]', (event) => {
        comparison.after = /** @type {HTMLSelectElement} */ (event.target).value;
        draw(container);
    });

    on(container, 'change', '[data-file]', (event) => {
        const input = /** @type {HTMLInputElement} */ (event.target);
        const file = input.files?.[0];
        if (!file) return;
        const dateISO = plans.todayISO();

        // Dos fotos el mismo día no se pisan: el id se desambigua. Sobrescribir
        // en silencio sería perder una foto que el usuario ya no tiene.
        const taken = new Set(readMeta().map((m) => m.id));
        let id = `ph_${dateISO}`;
        for (let n = 2; taken.has(id); n += 1) id = `ph_${dateISO}_${n}`;

        photosDb.add(storage.getActiveProfile(), { id, dateISO, blob: file, note: '' }).then((added) => {
            input.value = '';
            if (!added.ok) {
                toast.error(added.error === 'photos.indexedDbUnavailable' ? 'photos.unavailable' : 'error.generic');
                return;
            }
            const meta = readMeta().filter((m) => m.id !== id);
            if (!writeMeta([...meta, { id, dateISO, note: null }])) {
                toast.error('error.generic');
                return;
            }
            toast.success('photos.saved');
            draw(container);
        });
    });

    on(container, 'click', '[data-delete-photo]', (_event, target) => {
        const id = target.getAttribute('data-delete-photo');
        const date = target.getAttribute('data-date');
        if (!id || !date) return;
        modal.confirm({
            titleKey: 'photos.deleteTitle',
            messageKey: 'photos.deleteBody',
            params: { date },
            confirmKey: 'action.delete',
            danger: true,
            onConfirm: () => {
                photosDb.remove(storage.getActiveProfile(), id).then((removed) => {
                    if (!removed.ok) {
                        toast.error('error.generic');
                        return;
                    }
                    writeMeta(readMeta().filter((m) => m.id !== id));
                    toast.success('photos.deleted');
                    draw(container);
                });
            }
        });
    });
}

/** Revoca las URLs de objeto: sin esto, cada visita a la vista fuga memoria. */
export function unmount() {
    drawToken++; // invalida cualquier dibujado en vuelo
    revokeAll();
}

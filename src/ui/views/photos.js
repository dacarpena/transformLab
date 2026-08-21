// @ts-check

/**
 * Fotos de progreso (M5-4). Los blobs viven en IndexedDB (`photos-db.js`) y
 * solo los metadatos en localStorage — la tensión 1 del plan.
 *
 * Aviso de privacidad específico y visible: una foto del cuerpo es más
 * sensible que un número, y el usuario debe saber que se queda en el
 * dispositivo antes de hacer la primera.
 */

import { html, render, on, safeUrl } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import { listDate, longDate } from '../dates.js';
import { SCHEMA_VERSION, validateCollection } from '../../data/schema.js';
import * as storage from '../../data/storage.js';
import * as photosDb from '../../data/photos-db.js';
import * as plans from '../plan-state.js';
import * as photosRemote from '../../data/photos-remote.js';
import * as syncLoop from '../sync-loop.js';
import { compress } from '../image-compress.js';
import { claveDeError } from '../account-errors.js';
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
    // Las que tienen puntero y no tienen imagen. NO se descartan en silencio: el
    // `continue` mudo que había aquí hacía desaparecer fotos de la galería sin
    // decir por qué, que es exactamente lo que §D9 prohíbe. Desde M9-5 hay
    // además un caso legítimo y frecuente —el móvil nuevo, cuyos blobs están en
    // el servidor— y confundirlo con «esta foto se perdió» sería alarmar por
    // nada.
    let ausentes = 0;
    for (const item of meta) {
        const record = await photosDb.get(profileId, item.id);
        // Si mientras llegaba este blob el usuario cambió de vista o se lanzó
        // otro dibujado, se sueltan las URLs de ESTE y se abandona.
        if (token !== drawToken || !container.isConnected) {
            for (const u of withBlobs) URL.revokeObjectURL(u.url);
            return;
        }

        let blob = record.ok && record.value ? record.value.blob : null;
        if (blob === null) blob = await traerFoto(profileId, item);
        if (token !== drawToken || !container.isConnected) {
            for (const u of withBlobs) URL.revokeObjectURL(u.url);
            return;
        }
        if (blob === null) { ausentes += 1; continue; }

        const url = URL.createObjectURL(blob);
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
            ${ausentes > 0 ? html`
                <p class="notice notice--warning" data-photos-missing>
                    <span class="notice__icon" aria-hidden="true">⚠</span>
                    <span>${t('photos.missing', { count: ausentes })}</span>
                </p>
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
                                <option value="${p.id}" ${p.id === comparison.before ? 'selected' : ''}>${listDate(p.dateISO)}</option>
                            `)}
                        </select>
                    </label>
                    <label class="field">
                        <span class="field__label">${t('photos.after')}</span>
                        <select class="input" data-after>
                            ${withBlobs.map((p) => html`
                                <option value="${p.id}" ${p.id === comparison.after ? 'selected' : ''}>${listDate(p.dateISO)}</option>
                            `)}
                        </select>
                    </label>
                </div>
                <div class="photo-compare">
                    <figure>
                        <img src="${safeUrl(before?.url)}" alt="${t('photos.before')}: ${before ? listDate(before.dateISO) : ''}">
                        <figcaption>${before ? listDate(before.dateISO) : ''}</figcaption>
                    </figure>
                    <figure>
                        <img src="${safeUrl(after?.url)}" alt="${t('photos.after')}: ${after ? listDate(after.dateISO) : ''}">
                        <figcaption>${after ? listDate(after.dateISO) : ''}</figcaption>
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
                                <img src="${safeUrl(p.url)}" alt="${listDate(p.dateISO)}" loading="lazy">
                                <div class="photo-item__bar">
                                    <span class="muted">${listDate(p.dateISO)}</span>
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
        input.value = '';
        void guardarFoto(container, file);
    });

    on(container, 'click', '[data-delete-photo]', (_event, target) => {
        const id = target.getAttribute('data-delete-photo');
        const date = target.getAttribute('data-date');
        if (!id || !date) return;
        modal.confirm({
            titleKey: 'photos.deleteTitle',
            messageKey: 'photos.deleteBody',
            // Fecha larga y con año: es un borrado sin vuelta atrás, y era el
            // ÚNICO sitio de la interfaz que seguía imprimiendo el ISO crudo
            // — justo donde la fecha más importa.
            params: { date: longDate(date) },
            confirmKey: 'action.delete',
            danger: true,
            onConfirm: () => { void borrarFoto(container, id); }
        });
    });
}

/* ── Guardar, borrar y traerse lo que falte ──────────────────────────────── */

/**
 * Guarda una foto: comprimir, escribir aquí, subir si hay cuenta.
 *
 * **Se comprime siempre, haya cuenta o no.** Una foto de un móvil moderno son
 * entre tres y ocho megas; a 1600 px y WebP quedan en doscientos kilobytes. Sin
 * eso, veinte fotos llenan IndexedDB y ninguna cabría en una red móvil el día
 * que se cree una cuenta.
 *
 * **El blob primero, el puntero después.** Al revés, el otro dispositivo vería
 * la foto en la galería antes de que existiera nada que enseñar. Con este orden,
 * lo peor que puede pasar es un objeto en el servidor que nadie reclama, que no
 * se ve y que el barrido de huérfanos recoge.
 *
 * @param {HTMLElement} container
 * @param {File} file
 */
async function guardarFoto(container, file) {
    const profileId = storage.getActiveProfile();
    const dateISO = plans.todayISO();

    // Dos fotos el mismo día no se pisan: el id se desambigua. Sobrescribir en
    // silencio sería perder una foto que el usuario ya no tiene.
    const taken = new Set(readMeta().map((/** @type {*} */ m) => m.id));
    let id = `ph_${dateISO}`;
    for (let n = 2; taken.has(id); n += 1) id = `ph_${dateISO}_${n}`;
    // El id acaba siendo una clave de R2, y ahí no caben ni puntos ni barras.
    id = id.replace(/[^A-Za-z0-9_-]/g, '_');

    const comprimida = await compress(file);

    const added = await photosDb.add(profileId, {
        id, dateISO, blob: comprimida.blob, note: '', contentType: comprimida.contentType
    });
    if (!added.ok) {
        toast.error(added.error === 'photos.indexedDbUnavailable' ? 'photos.unavailable' : 'error.generic');
        return;
    }

    const userId = syncLoop.currentUserId();
    if (userId !== null) {
        const subida = await photosRemote.upload(userId, profileId, id, comprimida.blob);
        if (!subida.ok) {
            // La foto YA está guardada aquí, así que esto no es una pérdida: es
            // una foto que de momento solo vive en este dispositivo. Se dice, y
            // no se deshace nada.
            toast.error(claveDeError(subida.error));
            escribirPuntero(container, id, dateISO, comprimida);
            return;
        }
    }
    escribirPuntero(container, id, dateISO, comprimida);
    toast.success('photos.saved');
}

/**
 * Escribe el puntero y repinta. Se separa porque hay dos caminos que llegan
 * aquí —con subida y sin ella— y el puntero se escribe en los dos: una foto que
 * está en el dispositivo tiene que verse en el dispositivo.
 *
 * @param {HTMLElement} container
 * @param {string} id
 * @param {string} dateISO
 * @param {{ blob: Blob, contentType: string }} comprimida
 */
function escribirPuntero(container, id, dateISO, comprimida) {
    const meta = readMeta().filter((/** @type {*} */ m) => m.id !== id);
    const ok = writeMeta([...meta, {
        id, dateISO, note: null,
        contentType: comprimida.contentType,
        bytes: comprimida.blob.size
    }]);
    if (!ok) toast.error('error.generic');
    draw(container);
}

/**
 * Borra una foto de los dos sitios.
 *
 * El servidor primero. Si falla, no se borra nada: dejar el puntero quitado y el
 * objeto puesto convierte una foto en cuota gastada que ya nadie puede ver ni
 * recuperar, y el barrido de huérfanos tardaría en llegar.
 *
 * @param {HTMLElement} container
 * @param {string} id
 */
async function borrarFoto(container, id) {
    const profileId = storage.getActiveProfile();
    const userId = syncLoop.currentUserId();

    if (userId !== null) {
        const quitada = await photosRemote.remove(profileId, id);
        if (!quitada.ok) {
            toast.error(claveDeError(quitada.error));
            return;
        }
    }
    const removed = await photosDb.remove(profileId, id);
    if (!removed.ok) {
        toast.error('error.generic');
        return;
    }
    writeMeta(readMeta().filter((/** @type {*} */ m) => m.id !== id));
    toast.success('photos.deleted');
    draw(container);
}

/**
 * Se trae de R2 una foto que este dispositivo no tiene.
 *
 * Es el recorrido del móvil nuevo: la sincronía trajo los punteros y los blobs
 * siguen en el servidor. Se baja **una a una y solo cuando la galería la pide**,
 * porque son cientos de kilobytes cada una y bajarlas todas de golpe al abrir la
 * vista es exactamente lo que no se debe hacer en una red móvil.
 *
 * Lo que baja se queda en IndexedDB: la segunda visita ya no cuesta nada.
 *
 * @param {string} profileId
 * @param {*} item
 * @returns {Promise<Blob | null>}
 */
async function traerFoto(profileId, item) {
    const userId = syncLoop.currentUserId();
    if (userId === null) return null;

    const bajada = await photosRemote.download(userId, profileId, item.id, item.contentType);
    if (!bajada.ok) return null;

    // Se cachea, pero si no se puede guardar igualmente se devuelve: enseñar la
    // foto es lo que pedía el usuario; cachearla es una optimización.
    await photosDb.add(profileId, {
        id: item.id, dateISO: item.dateISO, blob: bajada.value,
        note: item.note ?? '', contentType: item.contentType
    });
    return bajada.value;
}

/** Revoca las URLs de objeto: sin esto, cada visita a la vista fuga memoria. */
export function unmount() {
    drawToken++; // invalida cualquier dibujado en vuelo
    revokeAll();
}

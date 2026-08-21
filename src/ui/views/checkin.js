// @ts-check

/**
 * Vista de check-in (M4-1). Registrar la realidad es el acto central del
 * producto (A1b), así que el formulario pide lo mínimo: **el peso es el único
 * campo obligatorio**. Todo lo demás es opcional y se puede rellenar o no
 * según el día.
 *
 * Las cuatro métricas subjetivas son datos REALES del usuario (A2), no las
 * sintéticas del legacy: por eso se piden aquí en vez de inventarse.
 */

import { html, render, on } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import { listDate, longDate } from '../dates.js';
import { MEASURE_KEYS, SUBJECTIVE_KEYS } from '../../data/schema.js';
import * as checkins from '../../data/checkins.js';
import * as storage from '../../data/storage.js';
import * as settingsStore from '../../data/settings.js';
import * as plans from '../plan-state.js';
import { muscleUnitsOf } from '../muscle-units.js';
import { fromBioimpedance } from '../../core/scale.js';
import { evaluateCheckin } from '../../core/tracking.js';
import * as modal from '../components/modal.js';
import * as toast from '../components/toast.js';
import { empty } from '../components/state.js';
import { num } from '../format.js';

/** @type {(() => void) | null} */
let onSaved = null;

/** Medidas que el usuario ha activado en ajustes (E2). */
function activeMeasures() {
    const stored = storage.get('settings');
    const configured = stored.ok && stored.value ? /** @type {*} */ (stored.value).activeMeasures : null;
    if (Array.isArray(configured) && configured.length > 0) {
        return configured.filter((k) => MEASURE_KEYS.includes(k));
    }
    return ['waist'];
}

/**
 * ¿Este registro lleva algo más que la fecha y el peso?
 * @param {*} record
 * @returns {boolean}
 */
function hasDetail(record) {
    if (!record) return false;
    // Nota: el formulario completo escribe SIEMPRE las cuatro escalas
    // subjetivas —nacen en 5 aunque nadie las toque—, así que todo lo guardado
    // desde ahí cuenta como «con detalle». Es lo correcto: si el usuario estuvo
    // en el formulario detallado, al volver quiere encontrárselo. El único
    // camino que produce un registro de solo peso es la entrada rápida de Hoy.

    return record.fatPct !== null
        || record.scaleMuscleKg !== null
        || record.boneKg !== null
        || Object.keys(record.measuresCm ?? {}).length > 0
        || Object.keys(record.subjective ?? {}).length > 0
        || (record.notes ?? '') !== '';
}

/** Formulario de alta o edición. */
function renderForm(/** @type {*} */ existing, /** @type {*} */ dateISO) {
    const measures = activeMeasures();
    // Se despliega si el registro TRAE detalle, no por el mero hecho de editar:
    // si trae grasa o medidas y naciera plegado, el usuario vería un formulario
    // que parece haber perdido sus datos. Pero un registro guardado desde la
    // entrada rápida de Hoy solo tiene peso, y desplegarle catorce campos vacíos
    // sería devolverle justo el formulario del que E15-8 viene a sacarlo.
    const detailOpen = hasDetail(existing) || settingsStore.read().checkinDetailOpen === true;
    const data = plans.get();
    const muscle = muscleUnitsOf(data);
    // El hueso apenas se mueve de una semana a otra, así que se prellena con
    // el del perfil: el usuario solo teclea lo que de verdad cambia.
    const defaultBone = data?.profile?.initial?.boneKg ?? null;
    return html`
        <form class="card" data-form novalidate>
            <h2 class="card__title">${t(existing ? 'checkin.edit' : 'checkin.new')}</h2>

            <div class="field-grid">
                <label class="field">
                    <span class="field__label">${t('checkin.field.date')}</span>
                    <input class="input" type="date" data-field="dateISO" value="${dateISO}">
                </label>
                <label class="field">
                    <span class="field__label">${t('checkin.field.weight')}</span>
                    <input class="input" type="number" inputmode="decimal" step="0.1" required
                           data-field="weightKg" value="${existing ? existing.weightKg : ''}">
                    <span class="field__hint">${t('checkin.field.weightHint')}</span>
                </label>
            </div>

            <!-- TODO LO DEMÁS, PLEGADO (E15-8).

                 El formulario pedía dieciséis campos cada semana, y ésa es la
                 razón de que el almacén estuviera vacío: la app no fallaba, es
                 que nadie completa dieciséis campos siete días seguidos. El peso
                 ya era el único obligatorio; lo que faltaba era que fuera lo
                 único que se VE.

                 No se quita nada ni se guarda nada distinto: los campos siguen
                 en el DOM (un details cerrado no los saca), así que readForm no
                 se entera. Quien los rellena solo tiene que desplegar una vez: el
                 estado se recuerda por perfil.

                 SIN ACENTOS GRAVES aquí dentro: en una plantilla la CIERRAN.

                 Y el atributo va SIN espacio delante dentro de la interpolación:
                 escapeHtml convierte un espacio en &#32; y el atributo acaba
                 siendo TEXTO. Es el fallo que dejó el cajón de Analizar
                 inalcanzable en E14-4. -->
            <details class="detail" data-more ${detailOpen ? 'open' : ''}>
                <summary class="detail__summary">
                    ${t('checkin.moreDetail')}
                    <span class="muted">${t('checkin.moreDetailHint')}</span>
                </summary>

            <div class="field-grid">
                <label class="field">
                    <span class="field__label">${t('checkin.field.fatPct')}</span>
                    <input class="input" type="number" inputmode="decimal" step="0.1"
                           data-field="fatPct" value="${existing && existing.fatPct !== null ? existing.fatPct : ''}"
                           placeholder="${t('checkin.field.optional')}">
                </label>
            </div>

            ${muscle.isScale ? html`
                <div class="field-grid">
                    <label class="field">
                        <span class="field__label">${t('checkin.field.scaleMuscle')}</span>
                        <input class="input" type="number" inputmode="decimal" step="0.01"
                               data-field="scaleMuscleKg"
                               value="${existing && existing.scaleMuscleKg !== null ? existing.scaleMuscleKg : ''}"
                               placeholder="${t('checkin.field.optional')}">
                    </label>
                    <label class="field">
                        <span class="field__label">${t('checkin.field.bone')}</span>
                        <input class="input" type="number" inputmode="decimal" step="0.01"
                               data-field="boneKg"
                               value="${existing && existing.boneKg !== null ? existing.boneKg
                                        : (defaultBone === null ? '' : defaultBone)}"
                               placeholder="${t('checkin.field.optional')}">
                    </label>
                </div>
                <p class="field__hint">${t('checkin.field.scaleHint')}</p>
            ` : ''}

            <h3 class="card__title">${t('checkin.section.measures')}</h3>
            <div class="field-grid">
                ${measures.map((key) => html`
                    <label class="field">
                        <span class="field__label">${t(`checkin.measure.${key}`)}</span>
                        <input class="input" type="number" inputmode="decimal" step="0.1"
                               data-measure="${key}"
                               value="${existing && existing.measuresCm[key] !== undefined ? existing.measuresCm[key] : ''}"
                               placeholder="${t('checkin.field.optional')}">
                    </label>
                `)}
            </div>

            <h3 class="card__title">${t('checkin.section.subjective')}</h3>
            ${SUBJECTIVE_KEYS.map((key) => html`
                <label class="field">
                    <span class="field__label">
                        ${t(`checkin.subjective.${key}`)}
                        <span class="muted" data-scale-for="${key}"></span>
                    </span>
                    <input type="range" min="1" max="10" step="1"
                           data-subjective="${key}"
                           value="${existing && existing.subjective[key] !== undefined ? existing.subjective[key] : 5}">
                </label>
            `)}

            <label class="field">
                <span class="field__label">${t('checkin.section.notes')}</span>
                <textarea class="input" rows="3" data-field="notes"
                          placeholder="${t('checkin.notesPlaceholder')}">${existing ? existing.notes : ''}</textarea>
            </label>
            </details>

            <div data-messages role="status" aria-live="polite"></div>
            <div class="btn-row">
                <button type="button" class="btn btn--primary" data-save>${t('action.save')}</button>
                ${existing ? html`
                    <button type="button" class="btn btn--danger" data-delete="${existing.id}"
                            data-date="${existing.dateISO}">${t('action.delete')}</button>
                ` : ''}
            </div>
        </form>
    `;
}

/** Historial con la señal de desviación de cada registro. */
function renderHistory(/** @type {*} */ items) {
    const data = plans.get();
    if (items.length === 0) {
        return html`
            <section class="card">
                <h2 class="card__title">${t('checkin.history')}</h2>
                ${empty({ icon: '📋', titleKey: 'checkin.emptyTitle', bodyKey: 'checkin.emptyBody' })}
            </section>
        `;
    }
    return html`
        <section class="card">
            <h2 class="card__title">${t('checkin.history')}</h2>
            <ul class="profile-list">
                ${[...items].reverse().map((item) => {
                    const evaluation = data
                        ? evaluateCheckin(data.projection, item, data.startDateISO)
                        : /** @type {const} */ ({ ok: false });
                    const signal = evaluation.ok ? evaluation.value.signal : null;
                    return html`
                        <li class="profile-item">
                            <span>
                                ${t('checkin.entry', { date: listDate(item.dateISO), weight: num(item.weightKg) })}
                                ${signal ? html`<span class="signal signal--${signal}">${t(`deviation.${signal}`)}</span>` : ''}
                            </span>
                            <button type="button" class="btn btn--sm" data-edit="${item.dateISO}">${t('action.edit')}</button>
                        </li>
                    `;
                })}
            </ul>
        </section>
    `;
}

/** Lee el formulario al objeto de entrada. */
function readForm(/** @type {*} */ root) {
    /** @type {Record<string, number>} */ const measuresCm = {};
    for (const input of root.querySelectorAll('[data-measure]')) {
        const key = input.getAttribute('data-measure');
        const value = Number(/** @type {HTMLInputElement} */ (input).value);
        if (key && /** @type {HTMLInputElement} */ (input).value.trim() !== '' && Number.isFinite(value)) {
            measuresCm[key] = value;
        }
    }
    /** @type {Record<string, number>} */ const subjective = {};
    for (const input of root.querySelectorAll('[data-subjective]')) {
        const key = input.getAttribute('data-subjective');
        const value = Number(/** @type {HTMLInputElement} */ (input).value);
        if (key && Number.isFinite(value)) subjective[key] = value;
    }
    const field = (/** @type {*} */ name) => /** @type {HTMLInputElement | null} */ (root.querySelector(`[data-field="${name}"]`))?.value ?? '';
    /**
     * Campo numérico opcional. Distingue tres cosas, y la distinción importa:
     * `undefined` = el campo NO está en pantalla (no se pregunta por él, así
     * que no hay respuesta que guardar), `null` = está y el usuario lo dejó
     * vacío, número = lo rellenó. Sin el primer caso, editar el peso de un
     * check-in antiguo en un perfil que ya no es de báscula BORRABA sus cifras
     * de músculo y hueso, que ni siquiera se le habían mostrado.
     */
    const optionalNumber = (/** @type {*} */ name) => {
        const el = /** @type {HTMLInputElement | null} */ (root.querySelector(`[data-field="${name}"]`));
        if (el === null) return undefined;
        const raw = el.value.trim();
        return raw === '' ? null : Number(raw);
    };

    return {
        dateISO: field('dateISO'),
        weightKg: field('weightKg').trim() === '' ? NaN : Number(field('weightKg')),
        fatPct: optionalNumber('fatPct'),
        scaleMuscleKg: optionalNumber('scaleMuscleKg'),
        boneKg: optionalNumber('boneKg'),
        measuresCm,
        subjective,
        notes: field('notes')
    };
}

/** Refresca las etiquetas «N de 10» de los deslizadores. */
function refreshScales(/** @type {*} */ root) {
    for (const input of root.querySelectorAll('[data-subjective]')) {
        const key = input.getAttribute('data-subjective');
        const label = root.querySelector(`[data-scale-for="${key}"]`);
        if (label) label.textContent = t('checkin.subjective.scale', { value: /** @type {HTMLInputElement} */ (input).value });
    }
}

/** @param {HTMLElement} container */
function draw(container, /** @type {*} */ editDate) {
    const data = plans.get();
    const today = plans.todayISO();
    const dateISO = editDate ?? today;
    const existing = checkins.findByDate(dateISO);
    const items = checkins.list();

    render(container, html`
        <h1 class="card__title">${t('checkin.title')}</h1>
        ${data ? html`
            <p class="muted">${t('deviation.toleranceNote')}</p>
        ` : ''}
        ${renderForm(existing, dateISO)}
        ${renderHistory(items)}
    `);
    refreshScales(container);
}

/** @param {HTMLElement} container */
export function mount(container) {

    // El oyente va ANTES del primer `draw`, no después: si no, existe una
    // ventana —corta pero real— en la que el resorte ya está en el DOM y el
    // oyente todavía no. Un usuario rápido perdería su preferencia en silencio,
    // y un E2E lo cazaba una de cada varias ejecuciones.
    //
    // El estado del cajón se guarda con un oyente en fase de CAPTURA sobre el
    // contenedor. Las dos mitades importan:
    //
    // - `toggle` NO burbujea en `<details>`, así que `on(container, 'toggle', …)`
    //   —que delega en la fase de burbuja— no se entera nunca. La captura sí ve
    //   los eventos que no burbujean: recorre de la raíz al objetivo siempre.
    // - Y va en `mount`, sobre el contenedor que el router crea una vez, no
    //   dentro de `draw` sobre el `<details>` de cada render. Enganchado por
    //   render había una carrera real con el montaje diferido de la vista: el
    //   usuario podía pulsar el resorte antes de que el oyente existiera y la
    //   preferencia se perdía en silencio. Lo cazó un E2E que fallaba sin las
    //   esperas y pasaba con ellas, que es la forma en que estas carreras avisan.
    container.addEventListener('toggle', (event) => {
        const det = event.target;
        if (det instanceof HTMLDetailsElement && det.hasAttribute('data-more')) {
            settingsStore.patch({ checkinDetailOpen: det.open });
        }
    }, true);

    draw(container, null);

    on(container, 'input', '[data-subjective]', () => refreshScales(container));

    on(container, 'click', '[data-edit]', (_event, target) => {
        draw(container, target.getAttribute('data-edit'));
        /** @type {HTMLElement | null} */ (container.querySelector('[data-field="weightKg"]'))?.focus();
    });

    on(container, 'click', '[data-save]', () => {
        const input = readForm(container);
        const messages = container.querySelector('[data-messages]');
        const data = plans.get();

        if (!Number.isFinite(input.weightKg) || input.weightKg <= 0) {
            if (messages) render(messages, html`<p class="field__error">${t('checkin.weightRequired')}</p>`);
            return;
        }
        // Si ha copiado las cifras de la báscula, se comprueba que cuadran
        // entre sí antes de guardarlas: `peso = grasa + músculo + hueso`. Es
        // el mismo cruce del asistente, y caza un dedo torpe (65,56 en vez de
        // 56,56) mientras el usuario todavía tiene la pantalla de la báscula
        // delante.
        //
        // Si no anotó el %grasa, se DEDUCE de músculo + hueso en lugar de
        // saltarse la comprobación: el cruce de esas dos cifras se vuelve
        // trivial, pero siguen aplicándose los límites de hueso y de
        // composición, que son los que impiden guardar 190 kg de músculo en
        // un cuerpo de 80.
        if (typeof input.scaleMuscleKg === 'number') {
            // El hueso puede venir vacío (el campo es opcional y el usuario
            // puede borrarlo). Se recurre al del perfil, que apenas cambia; sin
            // ninguno de los dos no se puede reconstruir la lectura, pero
            // sigue habiendo una verdad que comprobar: el músculo no puede
            // pesar más que el cuerpo entero. Antes, vaciar un campo opcional
            // desactivaba TODO el control y dejaba guardar 150 kg de músculo.
            const boneKg = typeof input.boneKg === 'number' ? input.boneKg : data?.profile?.initial?.boneKg;
            if (Number.isFinite(boneKg)) {
                const leanKg = input.scaleMuscleKg + boneKg;
                const fatPct = typeof input.fatPct === 'number'
                    ? input.fatPct
                    : ((input.weightKg - leanKg) / input.weightKg) * 100;
                const read = fromBioimpedance({
                    weightKg: input.weightKg,
                    fatPct,
                    muscleKg: input.scaleMuscleKg,
                    boneKg,
                    sex: data?.profile?.user?.sex
                });
                if (!read.ok) {
                    if (messages) render(messages, html`<p class="field__error">${plans.issueText(read.errors[0])}</p>`);
                    return;
                }
            } else if (input.scaleMuscleKg >= input.weightKg) {
                if (messages) {
                    render(messages, html`<p class="field__error">${plans.issueText({
                        code: 'scale.leanExceedsWeight', params: { leanKg: input.scaleMuscleKg }
                    })}</p>`);
                }
                return;
            }
        }
        // La fecha debe caer dentro del plan: fuera de él no hay nada contra
        // lo que comparar, así que se avisa en vez de guardar un dato inerte.
        if (data) {
            const check = evaluateCheckin(data.projection, { id: 'tmp', ...input }, data.startDateISO);
            if (!check.ok && check.error === 'tracking.outOfPlan') {
                if (messages) render(messages, html`<p class="field__error">${t('checkin.outOfPlan')}</p>`);
                return;
            }
        }

        const saved = checkins.save(input, { nowISO: new Date().toISOString() });
        if (!saved.ok) {
            // el esquema sabe QUÉ campo y QUÉ límite se han violado: esa
            // información se le enseña al usuario en vez de un «algo falló»
            const issue = saved.issues?.[0];
            if (issue && messages) {
                render(messages, html`<p class="field__error">${t(`ranges.${issue.code}`) !== `ranges.${issue.code}`
                    ? t(`ranges.${issue.code}`, issue.params)
                    : t('checkin.outOfRange', { field: issue.path, ...(issue.params ?? {}) })}</p>`);
                return;
            }
            toast.fromErrorCode(saved.error.split(':')[0]);
            return;
        }
        toast.success('checkin.saved');
        draw(container, null);
        if (onSaved) onSaved();
    });

    on(container, 'click', '[data-delete]', (_event, target) => {
        const id = target.getAttribute('data-delete');
        const date = target.getAttribute('data-date');
        if (!id || !date) return;
        modal.confirm({
            titleKey: 'checkin.deleteTitle',
            messageKey: 'checkin.deleteBody',
            // Fecha larga y con año: es un borrado sin vuelta atrás, y era el
            // ÚNICO sitio de la interfaz que seguía imprimiendo el ISO crudo
            // — justo donde la fecha más importa.
            params: { date: longDate(date) },
            confirmKey: 'action.delete',
            danger: true,
            onConfirm: () => {
                const removed = checkins.remove(id);
                if (!removed.ok) {
                    toast.fromErrorCode(removed.error);
                    return;
                }
                toast.success('checkin.deleted');
                draw(container, null);
                if (onSaved) onSaved();
            }
        });
    });
}

/** @param {() => void} fn */
export function setOnSaved(fn) {
    onSaved = fn;
}


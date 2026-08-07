// @ts-check

/**
 * Onboarding (decisión D6a). La pieza central es la **preview del plan en
 * vivo**: cada cambio de campo vuelve a ejecutar el motor (es puro y barato)
 * y actualiza el resumen lateral.
 *
 * Regla de render que evita el defecto clásico: el formulario NO se
 * reconstruye nunca al teclear. Solo se refrescan la preview y los mensajes
 * de validación, de modo que el foco y la posición del cursor se conservan.
 *
 * La validación bloqueante viene de `ranges.js` y distingue error (impide
 * avanzar) de aviso (informa y deja pasar) — decisión B9. El error
 * bloqueante del legacy (C-4: sin bioimpedancia no podías fijar objetivo de
 * grasa) es imposible aquí por construcción: el músculo objetivo se propone
 * a partir de la composición y no hay mínimo absoluto en kg.
 */

import { html, render, on } from '../dom.js';
import { t, getLocale, setLocale, availableLocales } from '../../i18n/i18n.js';
import { checkProfile, checkComposition, checkTarget, LIMITS } from '../../core/ranges.js';
import { fromBioimpedance } from '../../core/scale.js';
import { muscleUnitsFor } from '../muscle-units.js';
import { makeComposition } from '../../core/engine.js';
import { SCHEMA_VERSION, MEASURE_KEYS } from '../../data/schema.js';
import * as storage from '../../data/storage.js';
import * as plans from '../plan-state.js';
import * as toast from '../components/toast.js';

const STEPS = ['profile', 'current', 'target', 'confirm'];

/** Estado del asistente. Vive aquí, no en el DOM. */
let draft = defaultDraft();
let stepIndex = 0;

/** @type {(() => void) | null} */
let onComplete = null;

function defaultDraft() {
    return {
        name: '',
        sex: 'male',
        age: 30,
        heightCm: 175,
        activityLevel: 'moderate',
        trainingStatus: 'beginner',
        weightKg: 75,
        fatPct: 20,
        muscleKg: /** @type {number | null} */ (null),
        boneKg: /** @type {number | null} */ (null),
        targetFatPct: 15,
        targetMuscleKg: /** @type {number | null} */ (null),
        /** Offset en vigor cuando se tecleó `targetMuscleKg`: es su UNIDAD. */
        targetMuscleOffsetKg: /** @type {number | null} */ (null),
        startDateISO: plans.todayISO(),
        intensity: 'moderate'
    };
}

/**
 * Composición derivada del borrador, o null si aún no es válida.
 * @returns {{ composition: import('../../core/engine.js').Composition | null, issues: import('../../core/ranges.js').Issue[] }}
 */
function currentComposition() {
    const sex = /** @type {'male'|'female'} */ (draft.sex);

    // Si el usuario ha rellenado la masa ósea, lo que tiene delante es una
    // báscula de bioimpedancia: solo esas la dan. Su «masa muscular» no es
    // músculo esquelético sino `peso − grasa − hueso`, así que la lectura la
    // interpreta `core/scale.js` en vez de entrar cruda al motor. Confundir
    // las dos cantidades es lo que hundió la v4.0.
    if (draft.muscleKg !== null && draft.boneKg !== null) {
        const read = fromBioimpedance({
            weightKg: draft.weightKg,
            fatPct: draft.fatPct,
            muscleKg: draft.muscleKg,
            boneKg: draft.boneKg,
            sex
        });
        if (!read.ok) return { composition: null, issues: read.errors };
        const derived = makeComposition({
            weightKg: read.value.weightKg,
            fatPct: read.value.fatPct,
            muscleKg: read.value.skeletalMuscleKg,
            muscleSource: 'derived',
            sex
        });
        if (!derived.ok) return { composition: null, issues: derived.errors };
        return { composition: derived.value, issues: [...read.warnings, ...derived.warnings] };
    }

    const result = makeComposition({
        weightKg: draft.weightKg,
        fatPct: draft.fatPct,
        muscleKg: draft.muscleKg,
        muscleSource: draft.muscleKg === null ? undefined : 'measured',
        sex
    });
    if (!result.ok) return { composition: null, issues: result.errors };
    return { composition: result.value, issues: result.warnings };
}

/** Cómo se ha obtenido el músculo, para etiquetarlo en la interfaz. */
function muscleSourceKey() {
    if (draft.muscleKg !== null && draft.boneKg !== null) return 'onboarding.muscleSource.derived';
    return draft.muscleKg === null ? 'onboarding.muscleSource.estimated' : 'onboarding.muscleSource.measured';
}

/**
 * En qué unidad se le habla de músculo a este usuario (E11).
 *
 * Si ha rellenado músculo Y hueso, sus cifras son de báscula y toda la
 * interfaz debe hablar en esa unidad: es la que él puede comparar con la
 * pantalla de su báscula. `draft.muscleKg` es entonces la cifra de báscula y
 * `composition.muscleKg` la esquelética, que es justo el par que necesita la
 * aduana.
 */
function draftUnits() {
    if (draft.muscleKg === null || draft.boneKg === null) return muscleUnitsFor(null);
    const { composition } = currentComposition();
    if (!composition) return muscleUnitsFor(null);
    return muscleUnitsFor({
        scaleMuscleKg: draft.muscleKg,
        muscleKg: composition.muscleKg,
        boneKg: draft.boneKg
    });
}

/**
 * Objetivo de músculo efectivo **en la unidad que ve el usuario**: el tecleado
 * o, si aún no ha tecleado nada, su cifra actual.
 *
 * OJO: esto NO es lo que consume el motor. Para eso está `targetMuscleSkeletal`.
 * Mezclarlas es exactamente lo que hacía que escribir «60» —el número natural
 * viniendo de 56,56 en su báscula— respondiera «ganar 30,8 kg no es alcanzable».
 *
 * Y por eso el borrador guarda, junto al número, el offset que estaba en vigor
 * cuando el usuario lo tecleó. Un nivel de músculo sin su unidad es
 * ambiguo: si escribes 33 sin báscula y luego vuelves atrás y añades tus
 * cifras de una Xiaomi, esos 33 pasarían a leerse como kilos de báscula —o
 * sea, 5,7 esqueléticos— y la app te avisaría de que tu objetivo implica
 * perder 23 kg de músculo. Aquí se re-expresa: lo que el usuario fijó es una
 * cantidad FÍSICA, y esa no cambia porque cambie la unidad en que se escribe.
 */
function effectiveTargetMuscle() {
    const units = draftUnits();
    if (draft.targetMuscleKg !== null) {
        const typedOffset = draft.targetMuscleOffsetKg ?? 0;
        if (typedOffset !== units.offsetKg) {
            return Math.round((draft.targetMuscleKg - typedOffset + units.offsetKg) * 10) / 10;
        }
        return draft.targetMuscleKg;
    }
    const { composition } = currentComposition();
    if (!composition) return null;
    return Math.round(units.toDisplay(composition.muscleKg) * 10) / 10;
}

/** El mismo objetivo, ya traducido a músculo esquelético para el motor. */
function targetMuscleSkeletal() {
    const shown = effectiveTargetMuscle();
    return shown === null ? null : draftUnits().fromInput(shown);
}

/** Registro de perfil v5 a partir del borrador. */
function toProfileRecord(nowISO) {
    // El músculo que se persiste es el ESQUELÉTICO, venga de donde venga: es
    // la magnitud con la que trabaja el motor. Las cifras de la báscula se
    // guardan aparte, sin mezclarse con ella.
    const { composition } = currentComposition();
    return {
        schemaVersion: SCHEMA_VERSION,
        name: draft.name.trim() || t('app.title'),
        createdAtISO: nowISO,
        user: {
            sex: draft.sex,
            age: draft.age,
            heightCm: draft.heightCm,
            activityLevel: draft.activityLevel,
            trainingStatus: draft.trainingStatus
        },
        initial: {
            weightKg: draft.weightKg,
            fatPct: draft.fatPct,
            muscleKg: composition ? composition.muscleKg : draft.muscleKg,
            muscleSource: draft.muscleKg === null
                ? 'estimated'
                : (draft.boneKg === null ? 'measured' : 'derived'),
            // Las cifras de la báscula se guardan tal cual: son SUS datos, y
            // permiten volver a interpretar la lectura más adelante.
            scaleMuscleKg: draft.boneKg === null ? null : draft.muscleKg,
            boneKg: draft.boneKg
        },
        target: {
            fatPct: draft.targetFatPct,
            // Al motor siempre esquelético...
            muscleKg: targetMuscleSkeletal() ?? 0,
            // ...y aparte, la meta tal y como el usuario la escribió. Es la
            // cifra que él se fijó, y no puede moverse porque una
            // recalibración cambie una estimación interna nuestra.
            scaleMuscleKg: draftUnits().isScale ? effectiveTargetMuscle() : null
        },
        startDateISO: draft.startDateISO,
        intensity: draft.intensity
    };
}

/**
 * Valida el paso actual. Devuelve errores (bloquean) y avisos (no bloquean).
 * @returns {{ errors: import('../../core/ranges.js').Issue[], warnings: import('../../core/ranges.js').Issue[] }}
 */
function validateStep() {
    const step = STEPS[stepIndex];
    if (step === 'profile') {
        return checkProfile({
            sex: draft.sex, age: draft.age, heightCm: draft.heightCm,
            activityLevel: draft.activityLevel, trainingStatus: draft.trainingStatus
        });
    }
    if (step === 'current') {
        // Con masa ósea, quien valida es `currentComposition` (que interpreta
        // la lectura de la báscula); `checkComposition` rechazaría el músculo
        // de una Xiaomi por ser el 95 % de la magra, y con razón: no es la
        // cantidad que ese validador espera.
        if (draft.muscleKg !== null && draft.boneKg !== null) {
            const { composition, issues } = currentComposition();
            return composition ? { errors: [], warnings: issues } : { errors: issues, warnings: [] };
        }
        return checkComposition(
            { weightKg: draft.weightKg, fatPct: draft.fatPct, muscleKg: draft.muscleKg ?? undefined },
            /** @type {'male'|'female'} */ (draft.sex)
        );
    }
    if (step === 'target') {
        const { composition } = currentComposition();
        if (!composition) return { errors: [{ code: 'target.initialInvalid', path: '' }], warnings: [] };
        // Traducido: `checkTarget` compara contra `composition.muscleKg`, que
        // es esquelético. Pasarle la cifra de báscula del usuario daba un
        // delta absurdo y bloqueaba objetivos perfectamente alcanzables (E11).
        const targetMuscle = targetMuscleSkeletal();
        const base = checkTarget(
            { weightKg: composition.weightKg, fatPct: composition.fatPct, muscleKg: composition.muscleKg, leanKg: composition.leanKg },
            { fatPct: draft.targetFatPct, muscleKg: targetMuscle ?? undefined },
            /** @type {'male'|'female'} */ (draft.sex)
        );
        // la fecha de inicio también se valida (el legacy no lo hacía)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.startDateISO) || Number.isNaN(Date.parse(draft.startDateISO))) {
            base.errors.push({ code: 'plan.initialInvalid', path: 'startDateISO' });
        }
        return base;
    }
    return { errors: [], warnings: [] };
}

/** Construye la preview del plan con el borrador actual. */
function buildPreview() {
    const record = toProfileRecord('1970-01-01T00:00:00.000Z');
    if (!record.target.muscleKg) return { ok: false, issues: [] };
    return plans.build(record, { profileId: 'preview' });
}

/** Refresca SOLO la preview y los mensajes: el formulario no se toca. */
function refreshSideEffects(root) {
    const previewHost = root.querySelector('[data-preview]');
    if (previewHost) render(previewHost, renderPreview());

    const { errors, warnings } = validateStep();
    const messages = root.querySelector('[data-messages]');
    if (messages) {
        render(messages, html`
            ${errors.map((e) => html`<p class="field__error">${plans.issueText(e)}</p>`)}
            ${warnings.map((w) => html`<p class="field__warning">${plans.issueText(w)}</p>`)}
        `);
    }
    const nextButton = /** @type {HTMLButtonElement | null} */ (root.querySelector('[data-next]'));
    if (nextButton) nextButton.disabled = errors.length > 0;

    // la fuente del músculo se anuncia en cuanto el usuario escribe o borra
    const source = root.querySelector('[data-muscle-source]');
    if (source) {
        source.textContent = t(muscleSourceKey() === 'onboarding.muscleSource.derived'
            ? 'onboarding.muscleSource.derived'
            : draft.muscleKg === null
            ? 'onboarding.muscleSource.estimated'
            : 'onboarding.muscleSource.measured');
    }

    // Y si está trabajando en cifras de báscula, debajo del objetivo va SIEMPRE
    // el músculo esquelético que implica: la conversión usa una proporción de
    // población, no una medición suya, y eso se dice, no se esconde.
    const targetNote = root.querySelector('[data-target-muscle-note]');
    if (targetNote) {
        const units = draftUnits();
        const skeletal = targetMuscleSkeletal();
        targetNote.textContent = units.isScale && skeletal !== null ? units.secondary(skeletal) : '';
    }
}

function renderPreview() {
    const built = buildPreview();
    if (!built.ok) {
        const issues = 'issues' in built ? built.issues : [];
        return html`
            <h3 class="card__title">${t('onboarding.preview.title')}</h3>
            <p class="muted">${issues.length > 0 ? plans.issueText(issues[0]) : t('onboarding.preview.pending')}</p>
        `;
    }
    const { plan } = built.value;
    return html`
        <h3 class="card__title">${t('onboarding.preview.title')}</h3>
        <div class="preview__row">
            <span>${t('onboarding.preview.targetWeight')}</span>
            <span class="preview__value">${plan.summary.targetWeightKg.toFixed(1)} ${t('today.unit.kg')}</span>
        </div>
        <div class="preview__row">
            <span>${t('onboarding.preview.duration')}</span>
            <span class="preview__value">${t('onboarding.preview.durationValue', {
                days: plan.totalDays,
                weeks: Math.round(plan.totalDays / 7)
            })}</span>
        </div>
        <ul class="phase-legend">
            ${plan.phases.map((p) => html`
                <li class="phase-legend__item">
                    <span class="phase-legend__dot is-phase-${p.type}"></span>
                    ${t('today.plan.phaseDays', { name: t(`phase.${p.type}`), days: p.days })}
                </li>
            `)}
        </ul>
    `;
}

/** @param {string} step */
function renderStepFields(step) {
    if (step === 'profile') {
        return html`
            <div class="field-grid">
                <label class="field">
                    <span class="field__label">${t('onboarding.field.name')}</span>
                    <input class="input" type="text" data-field="name" value="${draft.name}" autocomplete="nickname">
                </label>
                <label class="field">
                    <span class="field__label">${t('onboarding.field.sex')}</span>
                    <select class="select" data-field="sex">
                        <option value="male">${t('onboarding.field.sex.male')}</option>
                        <option value="female">${t('onboarding.field.sex.female')}</option>
                    </select>
                    <span class="field__hint">${t('onboarding.field.sex.hint')}</span>
                </label>
                <label class="field">
                    <span class="field__label">${t('onboarding.field.age')}</span>
                    <input class="input" type="number" inputmode="numeric" data-field="age"
                           min="${LIMITS.age.min}" max="${LIMITS.age.max}" value="${draft.age}">
                </label>
                <label class="field">
                    <span class="field__label">${t('onboarding.field.height')}</span>
                    <input class="input" type="number" inputmode="decimal" data-field="heightCm"
                           min="${LIMITS.heightCm.min}" max="${LIMITS.heightCm.max}" value="${draft.heightCm}">
                </label>
                <label class="field">
                    <span class="field__label">${t('onboarding.field.activity')}</span>
                    <select class="select" data-field="activityLevel">
                        ${['sedentary', 'light', 'moderate', 'active', 'veryActive'].map((k) => html`
                            <option value="${k}">${t(`onboarding.field.activity.${k}`)}</option>
                        `)}
                    </select>
                </label>
                <label class="field">
                    <span class="field__label">${t('onboarding.field.training')}</span>
                    <select class="select" data-field="trainingStatus">
                        ${['beginner', 'intermediate', 'advanced'].map((k) => html`
                            <option value="${k}">${t(`onboarding.field.training.${k}`)}</option>
                        `)}
                    </select>
                </label>
            </div>
        `;
    }

    if (step === 'current') {
        return html`
            <div class="field-grid">
                <label class="field">
                    <span class="field__label">${t('onboarding.field.weight')}</span>
                    <input class="input" type="number" inputmode="decimal" step="0.1" data-field="weightKg"
                           min="${LIMITS.weightKg.min}" max="${LIMITS.weightKg.max}" value="${draft.weightKg}">
                </label>
                <label class="field">
                    <span class="field__label">${t('onboarding.field.fatPct')}</span>
                    <input class="input" type="number" inputmode="decimal" step="0.1" data-field="fatPct"
                           min="0" max="60" value="${draft.fatPct}">
                </label>
            </div>
            <div class="field-grid">
                <label class="field">
                    <span class="field__label">${t('onboarding.field.muscle')}</span>
                    <input class="input" type="number" inputmode="decimal" step="0.01" data-field="muscleKg"
                           value="${draft.muscleKg === null ? '' : draft.muscleKg}"
                           placeholder="${t('onboarding.field.muscle.optional')}">
                </label>
                <label class="field">
                    <span class="field__label">${t('onboarding.field.bone')}</span>
                    <input class="input" type="number" inputmode="decimal" step="0.01" data-field="boneKg"
                           value="${draft.boneKg === null ? '' : draft.boneKg}"
                           placeholder="${t('onboarding.field.bone.optional')}">
                </label>
            </div>
            <p class="field__hint">${t('onboarding.field.muscle.explain')}</p>
            <p class="notice">
                <span class="notice__icon" aria-hidden="true">⚖</span>
                <span>${t('onboarding.field.scaleHint')}</span>
            </p>
            <p class="field__hint" data-muscle-source></p>
        `;
    }

    if (step === 'target') {
        const suggested = effectiveTargetMuscle();
        const units = draftUnits();
        return html`
            <div class="field-grid">
                <label class="field">
                    <span class="field__label">${t('onboarding.field.targetFat')}</span>
                    <input class="input" type="number" inputmode="decimal" step="0.1" data-field="targetFatPct"
                           min="0" max="60" value="${draft.targetFatPct}">
                </label>
                <label class="field">
                    <span class="field__label">${units.isScale ? t('onboarding.field.targetMuscle.scale') : t('onboarding.field.targetMuscle')}</span>
                    <input class="input" type="number" inputmode="decimal" step="0.1" data-field="targetMuscleKg"
                           aria-describedby="target-muscle-note"
                           value="${suggested ?? ''}">
                    <span class="field__hint" id="target-muscle-note" data-target-muscle-note></span>
                    ${units.isScale ? html`<span class="field__hint">${t('muscleUnits.explain')}</span>` : ''}
                </label>
                <label class="field">
                    <span class="field__label">${t('onboarding.field.startDate')}</span>
                    <input class="input" type="date" data-field="startDateISO" value="${draft.startDateISO}">
                </label>
                <label class="field">
                    <span class="field__label">${t('onboarding.field.intensity')}</span>
                    <select class="select" data-field="intensity">
                        ${['conservative', 'moderate', 'aggressive'].map((k) => html`
                            <option value="${k}">${t(`onboarding.field.intensity.${k}`)}</option>
                        `)}
                    </select>
                </label>
            </div>
        `;
    }

    // confirmar
    const { composition } = currentComposition();
    const confirmUnits = draftUnits();
    const targetSkeletal = targetMuscleSkeletal();
    return html`
        <div class="preview">
            <div class="preview__row">
                <span>${t('onboarding.summary.from')}</span>
                <span class="preview__value">
                    ${draft.weightKg} ${t('today.unit.kg')} · ${draft.fatPct} ${t('today.unit.pct')}
                </span>
            </div>
            <div class="preview__row">
                <span>${confirmUnits.label()}</span>
                <span class="preview__value">
                    ${composition ? confirmUnits.toDisplay(composition.muscleKg).toFixed(1) : '—'} ${t('today.unit.kg')}
                    · ${t(muscleSourceKey())}
                    ${composition && confirmUnits.isScale ? html`<span class="muted"> · ${confirmUnits.secondary(composition.muscleKg)}</span>` : ''}
                </span>
            </div>
            <div class="preview__row">
                <span>${t('onboarding.summary.to')}</span>
                <span class="preview__value">
                    ${effectiveTargetMuscle() ?? '—'} ${t('today.unit.kg')} · ${draft.targetFatPct} ${t('today.unit.pct')}
                    ${confirmUnits.isScale && targetSkeletal !== null ? html`<span class="muted"> · ${confirmUnits.secondary(targetSkeletal)}</span>` : ''}
                </span>
            </div>
        </div>

        <!-- El aviso va aquí, antes de crear nada, no escondido en ajustes
             (M6-6/C6): el usuario está a punto de escribir su peso y su grasa
             corporal en un dispositivo, y tiene derecho a saber dónde acaban
             ANTES de hacerlo, no después. -->
        <p class="notice">
            <span class="notice__icon" aria-hidden="true">🔒</span>
            <span>${t('settings.privacyBody')}</span>
        </p>
        <p class="notice">
            <span class="notice__icon" aria-hidden="true">ℹ</span>
            <span>${t('settings.disclaimerBody')}</span>
        </p>
    `;
}

/** @param {HTMLElement} container */
function draw(container) {
    const step = STEPS[stepIndex];
    const isLast = stepIndex === STEPS.length - 1;

    render(container, html`
        <section class="onboarding" aria-labelledby="onboarding-title">
            <header class="card">
                <h1 id="onboarding-title" class="card__title">${t('onboarding.title')}</h1>
                <div class="steps">
                    <span>${t('onboarding.stepOf', { current: stepIndex + 1, total: STEPS.length })}</span>
                    ${STEPS.map((_, i) => html`<span class="steps__dot ${i <= stepIndex ? 'steps__dot--done' : ''}"></span>`)}
                    <span>${t(`onboarding.step.${step}`)}</span>
                </div>
            </header>

            <form class="card" data-form novalidate>
                <h2 class="card__title">${t(`onboarding.step.${step}`)}</h2>
                ${renderStepFields(step)}
                <div data-messages role="status" aria-live="polite"></div>
                <div class="btn-row">
                    ${stepIndex > 0 ? html`<button type="button" class="btn" data-back>${t('action.back')}</button>` : ''}
                    <button type="button" class="btn btn--primary" data-next>
                        ${isLast ? t('onboarding.finish') : t('action.next')}
                    </button>
                </div>
            </form>

            <aside class="card preview" data-preview aria-live="polite"></aside>

            <div class="card">
                <label class="field">
                    <span class="field__label">${t('onboarding.field.locale')}</span>
                    <select class="select" data-locale>
                        ${availableLocales().map((code) => html`<option value="${code}">${t(`lang.${code}`)}</option>`)}
                    </select>
                </label>
            </div>
        </section>
    `);

    // valores de los <select>: se fijan por propiedad, no por atributo, para
    // no depender de interpolar `selected` en la plantilla
    for (const [field, value] of /** @type {Array<[string, string]>} */ ([
        ['sex', draft.sex], ['activityLevel', draft.activityLevel],
        ['trainingStatus', draft.trainingStatus], ['intensity', draft.intensity]
    ])) {
        const select = /** @type {HTMLSelectElement | null} */ (container.querySelector(`[data-field="${field}"]`));
        if (select) select.value = value;
    }
    const localeSelect = /** @type {HTMLSelectElement | null} */ (container.querySelector('[data-locale]'));
    if (localeSelect) localeSelect.value = getLocale();

    refreshSideEffects(container);
}

/** Lee un campo del formulario al borrador. */
function applyField(name, rawValue) {
    if (name === 'name' || name === 'startDateISO' || name === 'sex'
        || name === 'activityLevel' || name === 'trainingStatus' || name === 'intensity') {
        draft[name] = rawValue;
        return;
    }
    if (name === 'muscleKg' || name === 'boneKg' || name === 'targetMuscleKg') {
        const trimmed = rawValue.trim();
        draft[name] = trimmed === '' ? null : Number(trimmed);
        // El objetivo se anota CON su unidad: sin eso, cambiar después el
        // músculo o el hueso reinterpretaría el número en silencio (E11).
        if (name === 'targetMuscleKg') {
            draft.targetMuscleOffsetKg = trimmed === '' ? null : draftUnits().offsetKg;
        }
        return;
    }
    draft[name] = rawValue.trim() === '' ? NaN : Number(rawValue);
}

/**
 * Monta el asistente.
 * @param {HTMLElement} container
 */
export function mount(container) {
    draw(container);

    // Un solo listener delegado por tipo: el formulario nunca se reconstruye
    // al teclear, así que el foco del usuario se conserva siempre.
    on(container, 'input', '[data-field]', (event, target) => {
        const name = target.getAttribute('data-field');
        if (!name) return;
        applyField(name, /** @type {HTMLInputElement} */ (target).value);
        refreshSideEffects(container);
    });

    on(container, 'change', '[data-field]', (event, target) => {
        const name = target.getAttribute('data-field');
        if (!name) return;
        applyField(name, /** @type {HTMLInputElement} */ (target).value);
        refreshSideEffects(container);
    });

    on(container, 'change', '[data-locale]', (event, target) => {
        setLocale(/** @type {HTMLSelectElement} */ (target).value);
        document.documentElement.lang = getLocale();
        draw(container);
    });

    on(container, 'click', '[data-back]', () => {
        if (stepIndex === 0) return;
        stepIndex--;
        draw(container);
        /** @type {HTMLElement | null} */ (container.querySelector('.card__title'))?.focus();
    });

    on(container, 'click', '[data-next]', () => {
        const { errors } = validateStep();
        if (errors.length > 0) {
            refreshSideEffects(container);
            return;
        }
        if (stepIndex < STEPS.length - 1) {
            stepIndex++;
            draw(container);
            return;
        }
        finish();
    });
}

/** Persiste el perfil y avisa al arranque de que ya hay plan. */
function finish() {
    const record = toProfileRecord(new Date().toISOString());
    const built = plans.build(record, { profileId: storage.getActiveProfile() });
    if (!built.ok) {
        const issues = 'issues' in built ? built.issues : [];
        toast.error(issues.length > 0 ? `ranges.${issues[0].code}` : 'error.generic');
        return;
    }
    const saved = storage.set('profile', record);
    if (!saved.ok) {
        toast.fromErrorCode(saved.error.split(':')[0]);
        return;
    }
    // ajustes iniciales del perfil, con el idioma que haya elegido
    const settings = storage.get('settings');
    const base = settings.ok && settings.value ? settings.value : {};
    storage.set('settings', {
        ...(/** @type {object} */ (base)),
        schemaVersion: SCHEMA_VERSION,
        locale: getLocale(),
        activeMeasures: /** @type {*} */ (base).activeMeasures ?? [MEASURE_KEYS[0]],
        fluctuationVisible: false,
        reminder: null
    });
    plans.clear();
    draft = defaultDraft();
    stepIndex = 0;
    if (onComplete) onComplete();
}

/** @param {() => void} fn */
export function setOnComplete(fn) {
    onComplete = fn;
}

/** Reinicia el borrador (editar perfil desde ajustes). */
export function resetDraft(seed) {
    draft = { ...defaultDraft(), ...(seed ?? {}) };
    stepIndex = 0;
}

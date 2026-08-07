// @ts-check

/**
 * Recalibración (decisión E1a). La materialización a escala de producto de la
 * regla B9: **se ofrece, nunca se impone, y jamás ocurre en silencio.**
 *
 * Al aceptar, el plan vigente se archiva con fecha y motivo en un historial
 * consultable, y el motor regenera desde el último estado REAL medido. Al
 * rechazar, no se vuelve a preguntar hasta que el umbral se cruce otra vez
 * con datos nuevos.
 */

import { html } from './dom.js';
import { t } from '../i18n/i18n.js';
import * as storage from '../data/storage.js';
import { SCHEMA_VERSION, validateCollection } from '../data/schema.js';
import * as checkins from '../data/checkins.js';
import { evaluateSeries, recalibrationOffer, inferFatPct } from '../core/tracking.js';
import { muscleOffsetKg } from '../core/scale.js';
import * as plans from './plan-state.js';
import * as modal from './components/modal.js';
import * as toast from './components/toast.js';

/** Clave donde se recuerda el rechazo, para no insistir. */
const DECLINED_KEY = 'ui.recalDeclinedFingerprint';

/**
 * ¿Procede ofrecer una recalibración ahora mismo?
 * @returns {import('../core/tracking.js').RecalibrationVerdict & { evaluations: any[] }}
 */
export function check() {
    const empty = { offer: false, reason: null, side: null, lowAdherence: false, streakOutside: 0, evaluations: [] };
    const data = plans.get();
    if (!data) return empty;

    const items = checkins.list();
    const evaluations = evaluateSeries(data.projection, items, data.startDateISO);
    const declined = storage.get(DECLINED_KEY);
    const verdict = recalibrationOffer(evaluations, {
        declinedFingerprint: declined.ok && typeof declined.value === 'string' ? declined.value : undefined
    });
    return { ...verdict, evaluations };
}

/**
 * Archiva el plan vigente y regenera desde el peso real más reciente.
 * @param {import('../core/tracking.js').Evaluation} latest
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function applyRecalibration(latest) {
    const data = plans.get();
    if (!data) return { ok: false, error: 'recal.noPlan' };

    const storedProfile = storage.get('profile');
    if (!storedProfile.ok || storedProfile.value === null) return { ok: false, error: 'recal.noPlan' };
    const parsed = validateCollection('profile', storedProfile.value);
    if (!parsed.ok) return { ok: false, error: 'recal.noPlan' };

    // El plan nuevo parte del ESTADO REAL medido, no del proyectado.
    //
    // Si el usuario midió su %grasa, se usa. Si solo se pesó —que es el caso
    // normal— hay que INFERIR la composición, y hacerlo mal tiene consecuencias
    // visibles: tomar el %grasa proyectado supone que perdió la grasa prevista
    // pese a no haber movido la báscula, lo que además desplazaba el peso
    // objetivo sin que el usuario hubiera cambiado su meta.
    //
    // La inferencia defendible: el músculo cambia despacio y lo dirige el
    // entrenamiento, así que se conserva el proyectado; la desviación del peso
    // se atribuye a la GRASA, que es lo que varía con el balance energético.
    // Como el tejido magro no muscular también se conserva, esto equivale a
    // conservar toda la masa magra prevista y cargar la diferencia en grasa.
    const point = data.projection.daily[latest.dayIndex];
    const measured = checkins.list().find((c) => c.dateISO === latest.dateISO);

    const nextFatPct = inferFatPct(point, latest.actualKg, measured ? measured.fatPct : null);
    if (!Number.isFinite(nextFatPct)) return { ok: false, error: 'recal.failed' };

    const roundedFatPct = Math.round(nextFatPct * 10) / 10;

    const nextProfile = {
        ...parsed.value,
        initial: {
            ...parsed.value.initial,
            weightKg: latest.actualKg,
            fatPct: roundedFatPct,
            // el origen del músculo NO cambia al recalibrar (A3)
            muscleKg: parsed.value.initial.muscleSource === 'measured' ? parsed.value.initial.muscleKg : null
        },
        startDateISO: latest.dateISO
    };

    // Perfiles en cifras de báscula: hay que reconstruir la composición a mano
    // ANTES de planificar (E11).
    //
    // Dejar `muscleKg` a null hace que se re-estime con la proporción de
    // POBLACIÓN (0,49 × magra), que es transversal: sirve para adivinar el
    // músculo de alguien en un instante, no para seguir a una persona en el
    // tiempo. El motor usa el modelo LONGITUDINAL contrario —el músculo que
    // ganas se suma a la magra y `otherLeanKg` se conserva (invariante
    // `conservacion`)—, así que mezclar los dos aquí tenía tres consecuencias,
    // las tres verificadas: en el día 300 se tiraban 1,67 kg de la ganancia
    // que el propio plan decía haber conseguido; el offset saltaba de 27,32 a
    // 28,99, moviendo el objetivo del usuario sin que él tocara nada; y el
    // registro resultante ya no cuadraba consigo mismo (1,69 kg de desajuste,
    // sobre una tolerancia de 0,5), de modo que al reeditar el perfil la app
    // rechazaba sus propios datos y le pedía revisar cifras que nunca tecleó.
    //
    // Aquí se conserva `otherLeanKg`, que es exactamente lo que dice hacer la
    // inferencia de arriba: «el tejido magro no muscular también se conserva».
    // Con eso el offset queda constante por construcción y `scaleMuscleKg` es
    // lo que de verdad marcaría su báscula: `magra − hueso`.
    const previousOffset = muscleOffsetKg(parsed.value.initial);
    const boneKg = parsed.value.initial.boneKg;
    if (previousOffset !== null && Number.isFinite(boneKg)) {
        const nextLeanKg = latest.actualKg * (1 - roundedFatPct / 100);
        // Se redondea primero la cifra de báscula —es la que el usuario lee, y
        // una báscula da dos decimales— y el músculo se deriva de ELLA, no al
        // revés: así el offset se conserva exacto, sin arrastrar un residuo de
        // redondeo que se acumularía a cada recalibración.
        const nextScaleMuscleKg = Math.round((nextLeanKg - boneKg) * 100) / 100;
        const nextMuscleKg = nextScaleMuscleKg - previousOffset;
        // Si el usuario ha perdido tanta magra que el músculo se iría a cero,
        // el modelo ya no aplica: se deja la ruta estimada de siempre y se
        // renuncia a la unidad de báscula, en vez de escribir un imposible.
        if (nextMuscleKg > 0 && nextMuscleKg < nextLeanKg) {
            nextProfile.initial.muscleKg = nextMuscleKg;
            nextProfile.initial.scaleMuscleKg = nextScaleMuscleKg;
        }
    }

    const built = plans.build(nextProfile, { profileId: storage.getActiveProfile() });
    if (!built.ok) {
        const issues = 'issues' in built ? built.issues : [];
        return { ok: false, error: issues.length > 0 ? `ranges.${issues[0].code}` : 'recal.failed' };
    }

    // 1 · archivar el plan vigente ANTES de sobrescribir nada
    const storedPlan = storage.get('plan');
    const planRecord = storedPlan.ok && storedPlan.value
        ? /** @type {*} */ (storedPlan.value)
        : { schemaVersion: SCHEMA_VERSION, current: null, params: null, history: [] };

    const archived = {
        plan: data.plan,
        params: { startDateISO: data.startDateISO, seed: 0, fluctuation: data.fluctuation },
        archivedAtISO: new Date().toISOString(),
        reason: 'recalibration'
    };
    const nextPlanRecord = {
        schemaVersion: SCHEMA_VERSION,
        current: built.value.plan,
        params: { startDateISO: nextProfile.startDateISO, seed: 0, fluctuation: data.fluctuation },
        history: [...(planRecord.history ?? []), archived]
    };
    const checkedPlan = validateCollection('plan', nextPlanRecord);
    if (!checkedPlan.ok) return { ok: false, error: 'recal.failed' };

    // Se escribe el PERFIL primero: es de donde la app reconstruye el plan al
    // arrancar. Si la segunda escritura fallara (cuota llena), el usuario
    // vería su plan nuevo coherente, no un historial fantasma de una
    // recalibración que no ocurrió.
    const savedProfile = storage.set('profile', nextProfile);
    if (!savedProfile.ok) return { ok: false, error: savedProfile.error };

    const savedPlan = storage.set('plan', checkedPlan.value);
    if (!savedPlan.ok) {
        // el perfil ya refleja la recalibración; el registro del plan se
        // regenerará solo en el próximo arranque
        console.warn('[recalibrate] historial de planes no guardado:', savedPlan.error);
    }

    storage.remove(DECLINED_KEY);
    plans.clear();
    return { ok: true };
}

/**
 * Muestra la oferta. Nada ocurre sin que el usuario pulse.
 * @param {ReturnType<typeof check>} verdict
 * @param {() => void} onDone
 */
export function offer(verdict, onDone) {
    if (!verdict.offer || verdict.evaluations.length === 0) return;
    const latest = verdict.evaluations[verdict.evaluations.length - 1];
    const sideText = t(`recal.side.${verdict.side}`);

    const dialog = modal.open({
        titleKey: 'recal.title',
        body: html`
            <p>${verdict.reason === 'magnitude'
                ? t('recal.magnitude', { side: sideText })
                : t('recal.persistence', { count: verdict.streakOutside, side: sideText })}</p>

            <p class="muted">${t('deviation.detail', {
                actual: latest.actualKg.toFixed(1),
                expected: latest.expectedKg.toFixed(1),
                delta: `${latest.deltaKg >= 0 ? '+' : ''}${latest.deltaKg.toFixed(1)}`,
                tolerance: latest.toleranceKg.toFixed(1)
            })}</p>

            ${verdict.lowAdherence ? html`
                <p class="notice notice--warning">
                    <span class="notice__icon" aria-hidden="true">⚠</span>
                    <span>${t('recal.lowAdherence')}</span>
                </p>
            ` : ''}

            <p>${t('recal.explain')}</p>

            <div class="modal__actions">
                <button type="button" class="btn" data-decline>${t('recal.decline')}</button>
                <button type="button" class="btn btn--primary" data-accept>${t('recal.accept')}</button>
            </div>
        `,
        // cerrar con Escape o con la X equivale a rechazar: nada cambia
        onClose: () => {
            storage.set(DECLINED_KEY, verdict.fingerprint);
        }
    });

    dialog.querySelector('[data-decline]')?.addEventListener('click', () => {
        storage.set(DECLINED_KEY, verdict.fingerprint);
        modal.close();
        toast.show('recal.declined');
    });

    dialog.querySelector('[data-accept]')?.addEventListener('click', () => {
        const applied = applyRecalibration(latest);
        modal.close();
        if (!applied.ok) {
            toast.error(applied.error.startsWith('ranges.') ? applied.error : 'recal.failed');
            return;
        }
        toast.success('recal.done');
        onDone();
    });
}

/**
 * Historial de planes archivados, para la vista de ajustes.
 * @returns {Array<{ archivedAtISO: string, reason: string, days: number, targetKg: number }>}
 */
export function history() {
    const stored = storage.get('plan');
    if (!stored.ok || !stored.value) return [];
    const record = /** @type {*} */ (stored.value);
    if (!Array.isArray(record.history)) return [];
    return record.history
        .filter((entry) => entry && entry.plan)
        .map((entry) => ({
            archivedAtISO: entry.archivedAtISO,
            reason: entry.reason,
            days: entry.plan.totalDays,
            targetKg: entry.plan.summary.targetWeightKg
        }));
}

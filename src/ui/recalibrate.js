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
import { MEANINGFUL_GAP_KCAL, measuredExpenditure, compareWithFormula } from '../core/expenditure.js';
import * as intakeLog from '../data/intake-log.js';
import * as plans from './plan-state.js';
import * as modal from './components/modal.js';
import * as toast from './components/toast.js';
import { num, signed } from './format.js';

/** Clave donde se recuerda el rechazo, para no insistir. */
const DECLINED_KEY = 'ui.recalDeclinedFingerprint';

/**
 * Cuántas recalibraciones se conservan. Cada una archiva el plan completo, y
 * `localStorage` tiene cuota: veinte son más de lo que nadie va a mirar y muy
 * por debajo del máximo de 100 que admite el esquema.
 */
const MAX_HISTORY_ENTRIES = 20;

/**
 * ¿Procede ofrecer una recalibración ahora mismo?
 * @returns {import('../core/tracking.js').RecalibrationVerdict & { evaluations: any[] }}
 */
export function check() {
    // `fingerprint: ''` no es relleno: el tipo lo declara obligatorio y `offer()`
    // lo escribe en el almacén al rechazar. Hoy no se llega ahí porque
    // `offer:false` corta antes, pero el día que alguien lea ese campo en el
    // camino sin plan escribiría `undefined`. Lo destapó el comprobador.
    const empty = {
        offer: false, reason: null, side: null,
        lowAdherence: false, streakOutside: 0, fingerprint: '',
        evaluations: []
    };
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
 *
 * `userPatch` existe para la recalibración por GASTO MEDIDO (E15-12): allí lo
 * que hay que corregir no es el punto de partida sino el nivel de actividad del
 * perfil, porque el motor calcula el TDEE como `BMR × multiplicador` y no admite
 * una cifra a mano. Todo lo demás —archivar, inferir la composición, conservar
 * `otherLeanKg`, podar el historial— es idéntico, y por eso se comparte en vez
 * de escribirse dos veces.
 *
 * @param {import('../core/tracking.js').Evaluation} latest
 * @param {{ patch?: Record<string, *>, reason?: string }} [options]
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function applyRecalibration(latest, options = {}) {
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
        user: options.patch ? { ...parsed.value.user, ...options.patch } : parsed.value.user,
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
    } else {
        // PERFILES SIN BÁSCULA: el mismo arreglo, y esta es la parte que faltaba
        // (V2-M9, pendiente decidido de la v1).
        //
        // E11 arregló la conservación del músculo SOLO para quien da cifras de
        // báscula. Para todos los demás —la mayoría— `muscleKg` seguía yéndose a
        // `null` y se re-estimaba con la proporción de POBLACIÓN (0,49 × magra),
        // que es transversal: sirve para adivinar el músculo de alguien en un
        // instante, no para seguir a UNA persona en el tiempo. El resultado era
        // que recalibrar tiraba a la basura parte de la ganancia que el propio
        // plan decía haber conseguido, y el usuario no tenía forma de verlo.
        //
        // La conservación correcta es la misma que usa el motor: el tejido magro
        // no muscular (`otherLeanKg`) se conserva, y todo lo que cambie del peso
        // se atribuye a grasa y músculo. Así el músculo que llevas ganado sigue
        // ahí después de recalibrar.
        //
        // CONSECUENCIA ACEPTADA: los planes ya creados cambian de duración al
        // recalibrar, porque parten de un músculo distinto (y más fiel) del que
        // partían antes. Es el precio de dejar de perder ganancia en cada
        // recalibración, y se prefiere pagarlo.
        const otherLeanKg = data.composition?.otherLeanKg;
        const previousMuscleKg = point?.muscleKg;
        if (Number.isFinite(otherLeanKg) && Number.isFinite(previousMuscleKg)) {
            const nextLeanKg = latest.actualKg * (1 - roundedFatPct / 100);
            const nextMuscleKg = Math.round((nextLeanKg - otherLeanKg) * 100) / 100;
            // Si el usuario ha perdido tanta magra que el músculo se iría a cero
            // o superaría a la propia magra, el modelo ya no aplica: se deja la
            // ruta estimada de siempre en vez de escribir un imposible.
            if (nextMuscleKg > 0 && nextMuscleKg < nextLeanKg) {
                nextProfile.initial.muscleKg = nextMuscleKg;
            }
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
        reason: options.reason ?? 'recalibration'
    };
    const nextPlanRecord = {
        schemaVersion: SCHEMA_VERSION,
        current: built.value.plan,
        params: { startDateISO: nextProfile.startDateISO, seed: 0, fluctuation: data.fluctuation },
        // Podado: cada entrada guarda el PLAN ENTERO, así que el historial
        // crecía sin cota en un almacén con cuota — y `storage.js` ya devuelve
        // errores de cuota que la interfaz traduce. Se conservan las últimas,
        // que son las que alguien miraría; el esquema admite hasta 100.
        history: [...(planRecord.history ?? []), archived].slice(-MAX_HISTORY_ENTRIES)
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
                actual: num(latest.actualKg),
                expected: num(latest.expectedKg),
                delta: signed(latest.deltaKg),
                tolerance: num(latest.toleranceKg)
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
 * Las fuentes que pueden pedir recalibrar AHORA, para que `coordinate()` decida
 * cuál se enseña (E15-11).
 *
 * Dos de las tres. La tercera —la descarga de entrenamiento— necesita el
 * catálogo de ejercicios, que llega por `import()` asíncrono, y un informe de
 * volumen sobre todas las sesiones. Eso no cabe en el camino de render de Hoy,
 * que es sincrónico y es la primera pantalla; y Entreno ya la enseña en su
 * vista, donde ese trabajo se está haciendo de todos modos. Queda declarada en
 * `collectOffers` para cuando haya dónde encajarla.
 *
 * Las dos que sí están son justo las que se pisan: ambas tocan la palanca de
 * CALORÍAS, y `SUPERSEDES` dice que el gasto medido gana a la desviación de peso
 * porque se apoya en dos señales —ingesta registrada y peso— frente a una.
 *
 * @returns {{ weightDeviation: *, measuredExpenditure: *, deload: null }}
 */
export function sources() {
    const verdict = check();
    const data = plans.get();

    /** @type {*} */ let gasto = null;
    if (data) {
        const medido = measuredExpenditure({
            intake: intakeLog.list().map((/** @type {*} */ e) => ({ dateISO: e.dateISO, kcal: e.kcal })),
            weights: checkins.list().map((/** @type {*} */ c) => ({ dateISO: c.dateISO, weightKg: c.weightKg }))
        });
        const hoy = plans.todayIndex(data, plans.todayISO());
        const formula = data.projection.daily[hoy.dayIndex]?.kcal?.tdeeKcal ?? 0;
        gasto = compareWithFormula(medido, formula);
    }

    return {
        weightDeviation: verdict.offer
            ? {
                offer: true,
                reasonKey: verdict.reason === 'magnitude'
                    ? 'recalibration.weightMagnitude'
                    : 'recalibration.weightPersistence',
                params: { side: t(`recal.side.${verdict.side}`), count: verdict.streakOutside }
            }
            : null,
        measuredExpenditure: gasto,
        deload: null
    };
}

/**
 * La oferta de recalibrar por el GASTO MEDIDO (E15-12).
 *
 * Hasta ahora este botón era un `toast.success` sobre un no-op, con un
 * comentario que lo aplazaba a V2-M10 — una milestone cerrada el 2026-08-08. La
 * excusa caducó, y felicitar al usuario por una acción que no ocurre es
 * exactamente la clase de promesa incumplida que M7-1 tuvo que ir a cerrar.
 *
 * QUÉ HACE, DICHO CON PRECISIÓN: el motor obtiene el TDEE de `BMR ×
 * multiplicador` y no admite una cifra a mano, así que aplicar un gasto medido
 * significa **corregir el nivel de actividad del perfil** y rehacer el plan
 * desde el estado real. Se dice así en el diálogo, con las dos cifras y el
 * residuo, en vez de «ajusto tus calorías», que sonaría a magia.
 *
 * @param {import('../core/expenditure.js').ExpenditureVerdict} verdict
 * @param {{ level: string, residualKcal: number }} target el nivel que mejor explica lo medido
 * @param {() => void} onDone
 */
export function offerFromExpenditure(verdict, target, onDone) {
    if (!verdict?.offer || !target) return;
    const evaluations = check().evaluations;
    if (evaluations.length === 0) return;
    const latest = evaluations[evaluations.length - 1];

    const dialog = modal.open({
        titleKey: 'expenditure.recalibrateTitle',
        body: html`
            <p>${t(verdict.reason === 'higher' ? 'expenditure.offerHigher' : 'expenditure.offerLower', {
                gap: Math.abs(Math.round(verdict.gapKcal ?? 0))
            })}</p>

            <p>${t('expenditure.recalibrateExplain', {
                level: t(`onboarding.field.activity.${target.level}`)
            })}</p>

            ${Math.abs(target.residualKcal) >= MEANINGFUL_GAP_KCAL ? html`
                <p class="notice notice--warning">
                    <span class="notice__icon" aria-hidden="true">⚠</span>
                    <!-- El modelo tiene cinco escalones y lo medido cae entre
                         dos: se dice cuánto se queda fuera en vez de prometer
                         una precisión que no hay. -->
                    <span>${t('expenditure.recalibrateResidual', {
                        residual: Math.abs(target.residualKcal)
                    })}</span>
                </p>
            ` : ''}

            <p class="muted">${t('recal.explain')}</p>

            <div class="modal__actions">
                <button type="button" class="btn" data-modal-close>${t('action.cancel')}</button>
                <button type="button" class="btn btn--primary" data-accept>${t('recal.accept')}</button>
            </div>
        `
    });

    dialog.querySelector('[data-accept]')?.addEventListener('click', () => {
        const applied = applyRecalibration(latest, {
            patch: { activityLevel: target.level },
            reason: 'expenditure'
        });
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
        .filter((/** @type {*} */ entry) => entry && entry.plan)
        .map((/** @type {*} */ entry) => ({
            archivedAtISO: entry.archivedAtISO,
            reason: entry.reason,
            days: entry.plan.totalDays,
            targetKg: entry.plan.summary.targetWeightKg
        }));
}

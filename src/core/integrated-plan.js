// @ts-check

/**
 * El plan integral: qué toca HOY en cada módulo (V2-M10). Módulo PURO.
 *
 * ES LA PIEZA QUE CONVIERTE SEIS MÓDULOS EN UN PRODUCTO. Sin ella, la v2 son
 * siete pantallas que el usuario tiene que recorrer para saber si va bien; con
 * ella, «Hoy» contesta esa pregunta en una línea por módulo y cada línea lleva a
 * su sitio.
 *
 * «HOY» COMPACTO, NO «HOY» POR CAPAS. Es la decisión de forma de la milestone y
 * repite la de E12-6: meter el menú entero, la lista de la compra, el stack y la
 * rejilla de volumen en la pantalla de inicio la devolvería a ser el muro que
 * E12 desmontó. Cada módulo aporta UNA línea —su estado y su siguiente acción— y
 * la profundidad vive en su vista.
 *
 * CADA LÍNEA DICE SI LE FALTAN DATOS. Un módulo sin configurar no se esconde ni
 * finge un número: dice qué le falta y ofrece ir a dárselo. Esconderlo haría que
 * el usuario no supiera que existe; fingir el número es lo que hundió la v4.0.
 */

import { MODULES } from './modules.js';

/**
 * @typedef {'ready'|'needsInput'|'off'} RowState
 *
 * @typedef {Object} PlanRow
 * @property {string} module
 * @property {string} viewId a dónde lleva
 * @property {RowState} state
 * @property {string} labelKey clave i18n del titular
 * @property {Record<string, string|number>} [params]
 * @property {string} [actionKey] clave i18n de la acción, si hace falta una
 */

/** @param {unknown} v @returns {v is number} */
function isNum(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Compone la fila de cada módulo activo.
 *
 * Recibe el estado YA calculado por cada módulo; no recalcula ninguno. Repetir
 * aquí el solver del menú o el reparto de volumen crearía una segunda verdad
 * que se separaría de la primera al primer ajuste — es la misma razón por la que
 * `recalibration.collectOffers` no reimplementa los umbrales.
 *
 * @param {{
 *   activeModules?: readonly string[],
 *   nutrition?: { kcal?: number, proteinG?: number, menuReady?: boolean } | null,
 *   shopping?: { toBuyLines?: number } | null,
 *   supplements?: { count?: number, safetyDeclared?: boolean } | null,
 *   training?: { belowMev?: number, sessionsLogged?: number, deloadOffered?: boolean } | null,
 *   steps?: { meanSteps?: number, targetSteps?: number, declared?: boolean } | null,
 *   recovery?: { score?: number, declared?: boolean } | null
 * }} state
 * @returns {{ rows: PlanRow[], readyCount: number, total: number }}
 */
export function todayRows(state) {
    const active = new Set(state?.activeModules ?? []);
    /** @type {PlanRow[]} */ const rows = [];

    /** @param {string} id */
    const viewOf = (id) => MODULES.find((m) => m.id === id)?.viewId ?? 'today';

    if (active.has('nutrition')) {
        const kcal = state?.nutrition?.kcal;
        rows.push(isNum(kcal) && kcal > 0
            ? {
                module: 'nutrition',
                viewId: viewOf('nutrition'),
                state: state?.nutrition?.menuReady ? 'ready' : 'needsInput',
                labelKey: state?.nutrition?.menuReady ? 'plan.row.nutritionReady' : 'plan.row.nutritionNoMenu',
                params: { kcal: Math.round(kcal), protein: Math.round(state?.nutrition?.proteinG ?? 0) },
                actionKey: state?.nutrition?.menuReady ? 'plan.action.seeMenu' : 'plan.action.buildMenu'
            }
            : {
                module: 'nutrition', viewId: viewOf('nutrition'), state: 'needsInput',
                labelKey: 'plan.row.nutritionNoPlan', actionKey: 'plan.action.open'
            });
    }

    if (active.has('training')) {
        const belowMev = state?.training?.belowMev;
        const sessions = state?.training?.sessionsLogged ?? 0;
        rows.push(sessions === 0
            ? {
                module: 'training', viewId: viewOf('training'), state: 'needsInput',
                labelKey: 'plan.row.trainingNoSessions', actionKey: 'plan.action.logSession'
            }
            : {
                module: 'training',
                viewId: viewOf('training'),
                // Un grupo por debajo de su mínimo efectivo no es un error: es
                // información. Se marca como «listo» porque el módulo funciona,
                // y el titular dice cuántos grupos van cortos.
                state: 'ready',
                labelKey: isNum(belowMev) && belowMev > 0
                    ? 'plan.row.trainingBelowMev'
                    : 'plan.row.trainingOk',
                params: { n: belowMev ?? 0 },
                actionKey: 'plan.action.open'
            });
    }

    if (active.has('shopping')) {
        const lines = state?.shopping?.toBuyLines;
        rows.push({
            module: 'shopping',
            viewId: viewOf('shopping'),
            state: isNum(lines) ? 'ready' : 'needsInput',
            labelKey: isNum(lines) ? 'plan.row.shoppingReady' : 'plan.row.shoppingNoMenu',
            params: { n: lines ?? 0 },
            actionKey: 'plan.action.open'
        });
    }

    if (active.has('supplements')) {
        rows.push({
            module: 'supplements',
            viewId: viewOf('supplements'),
            // Sin banderas declaradas el stack SE PUEDE calcular, pero no está
            // cribado por la salud de nadie. Se pide, y se dice por qué.
            state: state?.supplements?.safetyDeclared ? 'ready' : 'needsInput',
            labelKey: state?.supplements?.safetyDeclared
                ? 'plan.row.supplementsReady'
                : 'plan.row.supplementsNoSafety',
            params: { n: state?.supplements?.count ?? 0 },
            actionKey: 'plan.action.open'
        });
    }

    if (active.has('steps')) {
        const mean = state?.steps?.meanSteps;
        rows.push(state?.steps?.declared && isNum(mean)
            ? {
                module: 'steps', viewId: viewOf('steps'), state: 'ready',
                labelKey: 'plan.row.stepsReady',
                params: { mean: Math.round(mean), target: Math.round(state?.steps?.targetSteps ?? 0) },
                actionKey: 'plan.action.open'
            }
            : {
                module: 'steps', viewId: viewOf('steps'), state: 'needsInput',
                labelKey: 'plan.row.stepsNone', actionKey: 'plan.action.logSteps'
            });
    }

    if (active.has('recovery')) {
        rows.push(state?.recovery?.declared
            ? {
                module: 'recovery', viewId: viewOf('recovery'), state: 'ready',
                labelKey: 'plan.row.recoveryReady',
                params: { pct: Math.round((state?.recovery?.score ?? 0) * 100) },
                actionKey: 'plan.action.open'
            }
            : {
                module: 'recovery', viewId: viewOf('recovery'), state: 'needsInput',
                labelKey: 'plan.row.recoveryNone', actionKey: 'plan.action.checkin'
            });
    }

    return {
        rows,
        readyCount: rows.filter((r) => r.state === 'ready').length,
        total: rows.length
    };
}

/**
 * ¿Está el bucle cerrado? — onboarding → plan → check-in + ingesta →
 * recalibración ofrecida.
 *
 * No es una métrica de vanidad: es lo que permite a «Hoy» decir «te falta
 * apuntar lo que comes para que pueda medir tu gasto» en vez de esperar en
 * silencio catorce días a tener datos que nadie le está dando.
 *
 * @param {{ hasPlan: boolean, checkinCount: number, intakeDays: number, minIntakeDays: number }} input
 * @returns {{ closed: boolean, missing: string[] }}
 */
export function loopStatus(input) {
    /** @type {string[]} */ const missing = [];
    if (!input?.hasPlan) missing.push('loop.noPlan');
    if ((input?.checkinCount ?? 0) === 0) missing.push('loop.noCheckins');
    if ((input?.intakeDays ?? 0) < (input?.minIntakeDays ?? 14)) missing.push('loop.notEnoughIntake');
    return { closed: missing.length === 0, missing };
}

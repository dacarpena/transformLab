// @ts-check

/**
 * Recordatorio semanal local (M6-2, decisión E8).
 *
 * Reglas que lo gobiernan:
 *
 * - **El permiso se pide con un gesto del usuario, nunca al cargar.** Pedirlo
 *   al arrancar es cómo se consigue que el navegador lo bloquee para siempre,
 *   y de paso es de mala educación.
 * - **Si se deniega, no pasa nada.** El aviso in-app de M4-7 sigue ahí; la
 *   notificación era un extra y el ajuste lo dice con claridad.
 * - **La notificación no sale de aquí.** No hay push, no hay servidor, no hay
 *   suscripción: es un `setTimeout` mientras la pestaña vive, y una
 *   comprobación al abrir. Un recordatorio que exigiera un servidor traería
 *   consigo mandarle a alguien cuándo se pesa.
 *
 * La contrapartida honesta de no tener servidor: si la aplicación no se abre,
 * no hay aviso. Se dice en la interfaz en vez de fingir lo contrario.
 */

import { t } from '../i18n/i18n.js';
import * as storage from '../data/storage.js';
import { SCHEMA_VERSION, validateCollection } from '../data/schema.js';

/** Última fecha en la que se avisó, para no repetir el mismo día. */
const LAST_FIRED_KEY = 'ui.reminderLastFired';

/** @type {ReturnType<typeof setTimeout> | null} */
let timer = null;

/** @returns {'unsupported' | NotificationPermission} */
export function permissionState() {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
}

/** @returns {{ weekday: number, hour: number } | null} */
export function getSchedule() {
    const stored = storage.get('settings');
    if (!stored.ok || stored.value === null) return null;
    const parsed = validateCollection('settings', stored.value);
    return parsed.ok ? parsed.value.reminder : null;
}

/**
 * Guarda (o borra, con `null`) el día y la hora del recordatorio.
 * @param {{ weekday: number, hour: number } | null} schedule
 * @returns {boolean}
 */
export function setSchedule(schedule) {
    const stored = storage.get('settings');
    const base = stored.ok && stored.value !== null
        ? stored.value
        : { schemaVersion: SCHEMA_VERSION, locale: 'es', activeMeasures: ['waist'], fluctuationVisible: false, reminder: null };
    const next = validateCollection('settings', { .../** @type {*} */ (base), reminder: schedule });
    if (!next.ok) return false;

    // Desarmar PRIMERO y escribir después. Si la escritura falla, el usuario
    // ve el error con el temporizador ya parado: no avisar cuando se pidió
    // avisar es molesto, pero avisar cuando se pidió NO avisar es peor.
    stop();
    if (!storage.set('settings', next.value).ok) return false;
    if (schedule) start();
    return true;
}

/**
 * Pide permiso. Solo se puede llamar desde un manejador de evento del
 * usuario: el navegador rechaza la petición si no hay gesto detrás.
 * @returns {Promise<'unsupported' | NotificationPermission>}
 */
export async function requestPermission() {
    if (typeof Notification === 'undefined') return 'unsupported';
    try {
        return await Notification.requestPermission();
    } catch {
        return Notification.permission;
    }
}

/**
 * Milisegundos hasta el próximo día/hora indicados, en hora LOCAL (que es la
 * que el usuario reconoce, a diferencia de las fechas del motor, que son UTC).
 * @param {{ weekday: number, hour: number }} schedule
 * @param {Date} now
 * @returns {number}
 */
export function msUntil(schedule, now) {
    const first = instantFor(schedule, now, 0);
    // si hoy es el día pero la hora ya pasó, toca la semana que viene
    const target = first.getTime() > now.getTime() ? first : instantFor(schedule, now, 1);
    return target.getTime() - now.getTime();
}

/**
 * El instante del próximo `weekday` a las `hour`, `weeksAhead` semanas después.
 *
 * Los días se mueven con el reloj puesto al MEDIODÍA y la hora se aplica
 * después: desplazar fechas con la hora ya puesta atraviesa instantes que en
 * la semana del cambio de hora no existen.
 *
 * Y aun así puede no existir la hora pedida: en Groenlandia el salto de
 * primavera se come las 23:00 del sábado, y `setHours(23)` la normalizaba a
 * las 00:00 del DOMINGO — el aviso llegaba el día equivocado. Cuando pasa, se
 * retrocede hasta volver al día pedido: avisar una hora antes es un desajuste;
 * avisar otro día es un fallo.
 * @param {{ weekday: number, hour: number }} schedule
 * @param {Date} now
 * @param {number} weeksAhead
 * @returns {Date}
 */
function instantFor(schedule, now, weeksAhead) {
    const target = new Date(now.getTime());
    target.setHours(12, 0, 0, 0);
    const dayDelta = (schedule.weekday - now.getDay() + 7) % 7;
    target.setDate(target.getDate() + dayDelta + weeksAhead * 7);
    target.setHours(schedule.hour, 0, 0, 0);

    let guard = 0;
    while (target.getDay() !== schedule.weekday && guard < 4) {
        target.setTime(target.getTime() - 3600000);
        guard += 1;
    }
    return target;
}

/**
 * Lanza la notificación, si TODAVÍA procede.
 *
 * Vuelve a leer el horario en vez de fiarse del que había al armar el
 * temporizador: entre medias el usuario ha podido desactivarlo, o cambiar de
 * perfil, o desactivarlo desde otra pestaña. Notificar a alguien que dijo que
 * no es exactamente lo que este recordatorio no puede hacer.
 */
function fire() {
    if (permissionState() !== 'granted') return;
    if (getSchedule() === null) {
        stop();
        return;
    }
    const today = new Date().toDateString();
    const last = storage.get(LAST_FIRED_KEY);
    if (last.ok && last.value === today) return; // una al día, no más
    storage.set(LAST_FIRED_KEY, today);
    try {
        new Notification(t('reminder.notificationTitle'), {
            body: t('reminder.notificationBody'),
            icon: 'icons/icon-192.png',
            tag: 'transformlab-checkin'
        });
    } catch (err) {
        // Algunos navegadores móviles exigen mandarla vía service worker.
        // No es motivo para molestar al usuario: el aviso in-app sigue ahí.
        console.warn('[reminder] no se pudo notificar', err);
    }
}

/** Programa el próximo aviso mientras la pestaña siga viva. */
export function start() {
    stop();
    const schedule = getSchedule();
    if (!schedule || permissionState() !== 'granted') return;

    const delay = msUntil(schedule, new Date());
    // `setTimeout` satura por encima de ~24,8 días; una semana cabe de sobra,
    // pero se acota igualmente por si el reloj del sistema da un salto.
    timer = setTimeout(() => {
        fire();
        start();
    }, Math.min(delay, 2 ** 31 - 1));
}

function stop() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
}

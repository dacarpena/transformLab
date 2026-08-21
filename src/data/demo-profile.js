// @ts-check

/**
 * Instalar y quitar el perfil de ejemplo (E15-10).
 *
 * La separación con `src/core/demo.js` es la de siempre: allí se GENERAN las
 * colecciones —puro, sin almacén, probable desde Node— y aquí se ESCRIBEN.
 *
 * La garantía que hace que esto sea seguro no es una convención: `storage.js`
 * inyecta el prefijo `tl.<v>.<profileId>.` del perfil activo, así que el ejemplo
 * en su propio namespace es **estructuralmente incapaz** de tocar los datos
 * reales. Y su id es fijo (`demo`), mientras que `profiles.nextId` solo produce
 * `p1, p2, …`: no pueden colisionar jamás.
 */

import * as storage from './storage.js';
import * as profiles from './profiles.js';
import { buildDemo } from '../core/demo.js';

/**
 * El id del perfil de ejemplo. Fijo y distinto de todo lo que genera
 * `profiles.nextId()` —que solo produce `pN`—, así que ni colisiona ni se puede
 * confundir con un perfil del usuario.
 */
export const DEMO_PROFILE_ID = 'demo';

/** El nombre visible. Se usa también como confirmación al borrarlo. */
export const DEMO_PROFILE_NAME = 'Ejemplo';

/** ¿Está instalado el ejemplo? */
export function isInstalled() {
    const index = profiles.readIndex();
    return index.ok && index.value.profiles.some((p) => p.id === DEMO_PROFILE_ID);
}

/** ¿Es este el perfil de ejemplo? Lo pregunta el armazón en cada arranque. */
export function isDemo(/** @type {string} */ profileId) {
    return profileId === DEMO_PROFILE_ID;
}

/**
 * Instala el ejemplo y lo deja activo.
 *
 * Si ya estaba instalado no se regenera: se activa y ya. Regenerarlo borraría lo
 * que el usuario hubiera trasteado dentro, que es exactamente para lo que está.
 *
 * @param {{ todayISO: string, nowISO: string }} context
 * @returns {{ ok: true, value: { profileId: string } } | { ok: false, error: string }}
 */
export function install(context) {
    if (isInstalled()) {
        const activated = profiles.setActive(DEMO_PROFILE_ID);
        return activated.ok
            ? { ok: true, value: { profileId: DEMO_PROFILE_ID } }
            : { ok: false, error: activated.error };
    }

    const built = buildDemo(context);
    if (!built.ok) return { ok: false, error: built.error };

    // `create` siembra las colecciones por defecto, inscribe el perfil en el
    // índice y deja el namespace apuntando a él. A partir de aquí, cada
    // `storage.set` escribe dentro del ejemplo y solo dentro del ejemplo.
    const created = profiles.create(DEMO_PROFILE_NAME, {
        id: DEMO_PROFILE_ID,
        createdAtISO: context.nowISO
    });
    if (!created.ok) return { ok: false, error: created.error };

    for (const [collection, value] of Object.entries(built.value)) {
        const written = storage.set(collection, value);
        if (!written.ok) {
            // Un ejemplo a medias es peor que ninguno: se deshace entero.
            uninstall();
            return { ok: false, error: written.error };
        }
    }
    return { ok: true, value: { profileId: DEMO_PROFILE_ID } };
}

/**
 * Lo borra.
 *
 * Sin confirmación tecleada, y es deliberado: `profiles.remove` la exige porque
 * al otro lado hay meses de datos de una persona. Aquí no hay nada del usuario
 * que perder, y pedir que teclee «Ejemplo» para quitar algo que él no escribió
 * sería ceremonia sin contenido.
 *
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
export function uninstall() {
    if (!isInstalled()) return { ok: true };
    const removed = profiles.remove(DEMO_PROFILE_ID, DEMO_PROFILE_NAME);
    return removed.ok ? { ok: true } : { ok: false, error: removed.error };
}

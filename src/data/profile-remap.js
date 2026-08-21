// @ts-check

/**
 * El remapeo de ids de perfil a ids OPACOS (M9-1).
 *
 * ## Por qué existe
 *
 * Hasta la v6 los ids de perfil los generaba `profiles.nextId()` así:
 *
 * ```js
 * for (let n = 1; n <= MAX_PROFILES * 10; n++) if (!used.has(`p${n}`)) return `p${n}`;
 * ```
 *
 * Es decir: **el `pN` libre más bajo**. Eso tiene dos consecuencias, y las dos
 * son malas:
 *
 * 1. **Colisión entre dispositivos, por construcción.** El primer perfil de
 *    cualquier persona es `p1`. En cuanto dos dispositivos sincronicen contra la
 *    misma cuenta —o contra el mismo servidor con un fallo de acotación— dos
 *    perfiles DISTINTOS comparten identificador. No es un riesgo estadístico: es
 *    una certeza.
 * 2. **Reutilización tras borrar.** Ya causó un defecto real, documentado en
 *    `profiles.remove`: al borrar `p1`, el siguiente perfil creado volvía a ser
 *    `p1` y **heredaba los datos personales del borrado**, porque `create()` no
 *    siembra la colección `profile` y el registro anterior sobrevivía dentro del
 *    perfil nuevo. Con ids aleatorios eso deja de ser posible.
 *
 * ## La tabla, y por qué se persiste ANTES de escribir nada
 *
 * Los ids nuevos son aleatorios, así que **no se pueden volver a calcular**. Si
 * el proceso muriera a mitad de la copia sin haberlos guardado, la re-entrada
 * generaría otros distintos y la mitad de las claves quedaría bajo un id que ya
 * no usa nadie: los datos seguirían ahí, huérfanos e invisibles. Por eso la
 * tabla se escribe primero, y la re-entrada la reutiliza tal cual.
 *
 * Vive **fuera del prefijo versionado** (`tl.profileRemap.opaqueV7`, no
 * `tl.7.…`) por la misma razón que la copia de seguridad de la migración: tiene
 * que sobrevivir a la propia migración y no ser vista por `needsMigration`.
 *
 * ## Dos pestañas migrando a la vez
 *
 * `localStorage` no tiene comparar-y-escribir, así que dos pestañas pueden leer
 * «no hay tabla» a la vez y escribir dos tablas distintas. La mitigación es
 * **escribir y volver a leer INMEDIATAMENTE, antes de copiar una sola clave**:
 * las dos pestañas convergen en la que haya quedado, y a partir de ahí copian a
 * los mismos destinos. Queda una ventana microscópica —que la segunda escritura
 * caiga entre la relectura de la primera y su primera copia— cuyo peor efecto
 * son claves huérfanas bajo un id que el índice no menciona: **inertes, y con
 * los originales de la versión anterior intactos**. Nunca pérdida.
 *
 * No se usa `navigator.locks` porque obligaría a volver asíncrono el arranque
 * entero, que hoy es síncrono y va antes de leer ningún dato.
 */

import * as storage from './storage.js';
// Todo lo de identidad sale del módulo HOJA `ids.js`. Estuvo aquí y creaba un
// ciclo —`profiles.js → profile-remap.js → demo-profile.js → profiles.js`— que
// el typecheck no ve y que en el navegador es una pantalla en blanco.
import { newProfileId, RESERVED_PROFILE_IDS, isReservedProfileId } from './ids.js';

export { newProfileId, RESERVED_PROFILE_IDS };

/**
 * La primera versión de esquema cuyos ids de perfil son OPACOS.
 *
 * Debajo de ésta, los ids son `p1`, `p2`… y hay que remapearlos. Es la regla que
 * decide si un salto de versión lleva remapeo, escrita una sola vez para que un
 * salto futuro (v7→v8) no vuelva a generar ids nuevos sobre unos que ya eran
 * opacos — que sería un remapeo gratuito y destructivo.
 */
export const FIRST_OPAQUE_VERSION = 7;

/**
 * ¿Un salto desde esta versión necesita remapear los ids?
 * @param {number} from
 * @returns {boolean}
 */
export function needsRemap(from) {
    return Number.isInteger(from) && from < FIRST_OPAQUE_VERSION;
}

/**
 * La clave de la tabla. **Fuera del prefijo versionado**, a propósito: tiene que
 * sobrevivir a la propia migración y no ser vista por `needsMigration`.
 *
 * Se llama por la TRANSICIÓN, no por el par de versiones: quien venga de la v5
 * salta a la v7 directamente y usa esta misma tabla.
 */
export const REMAP_KEY = 'tl.profileRemap.opaqueV7';

/**
 * @typedef {Object} RemapTable
 * @property {string} createdAtISO
 * @property {number} from
 * @property {number} to
 * @property {Record<string, string>} map viejo → nuevo
 */

/**
 * Lee la tabla guardada, o `null` si no hay ninguna o está corrupta.
 *
 * Una tabla corrupta se trata como ausente **a propósito**: es preferible
 * generar una nueva —y dejar huérfanas unas claves inertes— a copiar datos a
 * destinos que salen de un objeto en el que no se puede confiar.
 *
 * @returns {RemapTable | null}
 */
export function readTable() {
    const raw = storage.getRaw(REMAP_KEY);
    if (!raw.ok || raw.value === null) return null;
    let parsed;
    try {
        parsed = JSON.parse(raw.value);
    } catch {
        return null;
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const map = parsed.map;
    if (map === null || typeof map !== 'object' || Array.isArray(map)) return null;
    // Todo par tiene que ser cadena→cadena y el destino tiene que ser un id
    // válido: una tabla con un destino ilegal escribiría claves que
    // `setActiveProfile` luego rechaza, y el perfil quedaría inalcanzable.
    for (const [viejo, nuevo] of Object.entries(map)) {
        if (typeof viejo !== 'string' || viejo === '') return null;
        if (typeof nuevo !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(nuevo)) return null;
    }
    return /** @type {RemapTable} */ ({
        createdAtISO: typeof parsed.createdAtISO === 'string' ? parsed.createdAtISO : '',
        from: typeof parsed.from === 'number' ? parsed.from : 6,
        to: 7,
        map: /** @type {Record<string, string>} */ (map)
    });
}

/**
 * Obtiene la tabla para este remapeo: la que ya hubiera, o una nueva escrita y
 * releída.
 *
 * **La relectura no es paranoia**: es lo que hace converger a dos pestañas que
 * hayan arrancado a la vez. Ver la cabecera del módulo.
 *
 * @param {{ oldProfileIds: readonly string[], nowISO: string, from: number }} entrada
 * @returns {{ ok: true, value: RemapTable, reused: boolean } | { ok: false, error: string }}
 */
export function ensureTable({ oldProfileIds, nowISO, from }) {
    const existente = readTable();
    if (existente) {
        // Puede faltar algún perfil si la tabla se escribió en un arranque en el
        // que el índice tenía menos: se completa sin tocar lo ya asignado, que
        // es lo que garantiza que la re-entrada copie a los mismos destinos.
        const faltan = oldProfileIds.filter((id) => !Object.hasOwn(existente.map, id));
        if (faltan.length === 0) return { ok: true, value: existente, reused: true };

        const ampliada = { ...existente, from, map: { ...existente.map, ...asignar(faltan) } };
        const escrita = escribir(ampliada);
        if (!escrita.ok) return escrita;
        return { ok: true, value: escrita.value, reused: true };
    }

    const nueva = { createdAtISO: nowISO, from, to: 7, map: asignar(oldProfileIds) };
    const escrita = escribir(nueva);
    if (!escrita.ok) return escrita;
    return { ok: true, value: escrita.value, reused: false };
}

/**
 * Escribe la tabla y devuelve **la que quede guardada**, que puede no ser la que
 * se acaba de escribir si otra pestaña ganó la carrera.
 *
 * @param {RemapTable} tabla
 * @returns {{ ok: true, value: RemapTable } | { ok: false, error: string }}
 */
function escribir(tabla) {
    const written = storage.setRaw(REMAP_KEY, JSON.stringify(tabla));
    if (!written.ok) return { ok: false, error: 'remap.writeFailed' };
    const releida = readTable();
    // Si la relectura falla, se aborta: copiar datos con una tabla que no se ha
    // podido confirmar es exactamente cómo se pierden.
    if (!releida) return { ok: false, error: 'remap.readbackFailed' };
    return { ok: true, value: releida };
}

/**
 * Asigna un id nuevo a cada id viejo, respetando los reservados.
 * @param {readonly string[]} ids
 * @returns {Record<string, string>}
 */
function asignar(ids) {
    /** @type {Record<string, string>} */ const map = {};
    for (const id of ids) {
        map[id] = isReservedProfileId(id) ? id : newProfileId();
    }
    return map;
}

/**
 * Reescribe el segmento de perfil de una clave del almacén.
 *
 * La clave que llega es la parte que sigue al prefijo de versión: o bien
 * `<perfil>.<colección>` o bien una clave global como `profiles`, que no lleva
 * perfil y se devuelve tal cual.
 *
 * Se corta por el PRIMER punto y solo por ése: las claves de interfaz tienen
 * más (`p1.ui.activeView`), y partir por todos convertiría la colección
 * `ui.activeView` en `ui`.
 *
 * @param {string} rest
 * @param {Record<string, string>} map
 * @returns {string}
 */
export function remapKeyRest(rest, map) {
    const punto = rest.indexOf('.');
    if (punto === -1) return rest;                 // clave global: `profiles`
    const viejo = rest.slice(0, punto);
    const nuevo = map[viejo];
    // Un perfil que no esté en la tabla se deja como está: es preferible copiar
    // una clave a su propio id que descartarla.
    if (nuevo === undefined) return rest;
    return `${nuevo}${rest.slice(punto)}`;
}

/**
 * Reescribe los ids dentro del índice de perfiles.
 *
 * Es la pieza que se olvida: mover las CLAVES sin actualizar el índice deja los
 * datos perfectamente copiados y la aplicación sin encontrar ningún perfil —el
 * mismo fallo que ya ocurrió con `schemaVersion` en la migración 5→6, y que
 * solo se vio abriendo el navegador—.
 *
 * @param {unknown} index el índice ya parseado
 * @param {Record<string, string>} map
 * @returns {unknown} una copia con los ids reescritos, o el original si no tiene forma de índice
 */
export function remapIndex(index, map) {
    if (index === null || typeof index !== 'object' || Array.isArray(index)) return index;
    const idx = /** @type {Record<string, unknown>} */ (index);
    if (!Array.isArray(idx.profiles)) return index;

    const profiles = idx.profiles.map((p) => {
        if (p === null || typeof p !== 'object' || Array.isArray(p)) return p;
        const viejo = /** @type {Record<string, unknown>} */ (p).id;
        if (typeof viejo !== 'string' || !Object.hasOwn(map, viejo)) return p;
        return { ...p, id: map[viejo] };
    });

    const activo = idx.activeProfileId;
    const activeProfileId = typeof activo === 'string' && Object.hasOwn(map, activo)
        ? map[activo]
        : activo;

    return { ...idx, profiles, activeProfileId };
}

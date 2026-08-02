// @ts-check

/**
 * Wrapper único de localStorage (CLAUDE.md §5: prohibido `localStorage.` directo
 * fuera de este módulo). Toda operación devuelve un resultado tipado, nunca lanza.
 *
 * Esquema de claves: `tl.<schemaVersion>.<profileId>.<colección>`
 * p. ej. `tl.5.p1.checkins`. El prefijo lo inyecta este módulo; los llamantes
 * usan claves cortas ('checkins', 'settings.locale', …).
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string }} StorageResult
 */

const SCHEMA_VERSION = 5;
const ROOT_PREFIX = `tl.${SCHEMA_VERSION}.`;

/**
 * Perfil activo. 'p1' por defecto hasta que `profiles.js` (M2) gestione el
 * índice `tl.5.profiles` y la selección real.
 * @type {string}
 */
let activeProfileId = 'p1';

/**
 * Fija el perfil activo cuyo namespace usarán get/set/remove.
 * @param {string} profileId
 * @returns {StorageResult<string>}
 */
export function setActiveProfile(profileId) {
    if (typeof profileId !== 'string' || profileId.trim() === '' || profileId.includes('.')) {
        return { ok: false, error: `profileId inválido: ${JSON.stringify(profileId)}` };
    }
    activeProfileId = profileId;
    return { ok: true, value: activeProfileId };
}

/** @returns {string} */
export function getActiveProfile() {
    return activeProfileId;
}

/**
 * Backend de almacenamiento. En navegador es window.localStorage; en tests
 * (Node) se inyecta un doble en `globalThis.localStorage`.
 * @returns {Storage}
 */
function backend() {
    const ls = globalThis.localStorage;
    if (!ls) throw new Error('localStorage no disponible en este entorno');
    return ls;
}

/**
 * @param {string} key clave corta (sin prefijo)
 * @returns {string} clave completa `tl.5.<pid>.<key>`
 */
function fullKey(key) {
    return `${ROOT_PREFIX}${activeProfileId}.${key}`;
}

/** @param {unknown} err @returns {string} */
function message(err) {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/**
 * Lee y deserializa una clave del namespace del perfil activo.
 * Clave ausente => `{ok: true, value: null}`. JSON corrupto => `{ok: false}`.
 * @param {string} key
 * @returns {StorageResult<unknown | null>}
 */
export function get(key) {
    try {
        const rawValue = backend().getItem(fullKey(key));
        if (rawValue === null) return { ok: true, value: null };
        return { ok: true, value: JSON.parse(rawValue) };
    } catch (err) {
        return { ok: false, error: message(err) };
    }
}

/**
 * Serializa y escribe una clave en el namespace del perfil activo.
 * Cuota superada o storage inaccesible => `{ok: false}`, sin lanzar.
 * @param {string} key
 * @param {unknown} value serializable a JSON
 * @returns {StorageResult<undefined>}
 */
export function set(key, value) {
    try {
        backend().setItem(fullKey(key), JSON.stringify(value));
        return { ok: true, value: undefined };
    } catch (err) {
        return { ok: false, error: message(err) };
    }
}

/**
 * Elimina una clave del namespace del perfil activo.
 * @param {string} key
 * @returns {StorageResult<undefined>}
 */
export function remove(key) {
    try {
        backend().removeItem(fullKey(key));
        return { ok: true, value: undefined };
    } catch (err) {
        return { ok: false, error: message(err) };
    }
}

/**
 * Bytes aproximados ocupados por todas las claves de la app (`tl.*`),
 * a 2 bytes por unidad UTF-16. Base del presupuesto de cuota (C5; se
 * refina por perfil en M2-6).
 * @returns {StorageResult<number>}
 */
export function usageBytes() {
    try {
        const ls = backend();
        let total = 0;
        for (let i = 0; i < ls.length; i++) {
            const key = ls.key(i);
            if (key === null || !key.startsWith('tl.')) continue;
            total += (key.length + (ls.getItem(key)?.length ?? 0)) * 2;
        }
        return { ok: true, value: total };
    } catch (err) {
        return { ok: false, error: message(err) };
    }
}

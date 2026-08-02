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

/** Límite práctico de localStorage en los navegadores actuales (~5 MB). */
export const QUOTA_LIMIT_BYTES = 5 * 1024 * 1024;

/** Fracción de la cuota a partir de la cual la UI avisa (C5). */
export const QUOTA_WARN_RATIO = 0.6;

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
 * Bytes aproximados ocupados por claves de la app, a 2 bytes por unidad
 * UTF-16 (C5). Sin argumento cuenta todo (`tl.*`); con `profileId` cuenta
 * solo el namespace de ese perfil.
 * @param {string} [profileId]
 * @returns {StorageResult<number>}
 */
export function usageBytes(profileId) {
    try {
        const ls = backend();
        const prefix = profileId === undefined ? 'tl.' : `${ROOT_PREFIX}${profileId}.`;
        let total = 0;
        for (let i = 0; i < ls.length; i++) {
            const key = ls.key(i);
            if (key === null || !key.startsWith(prefix)) continue;
            total += (key.length + (ls.getItem(key)?.length ?? 0)) * 2;
        }
        return { ok: true, value: total };
    } catch (err) {
        return { ok: false, error: message(err) };
    }
}

/**
 * Presupuesto de cuota (M2-6): bytes usados por el perfil y por la app
 * frente al límite práctico de localStorage (~5 MB), con la señal de aviso
 * que la UI consumirá en M3.
 * @param {string} [profileId] perfil a medir; por defecto, el activo
 * @returns {StorageResult<{ profileBytes: number, totalBytes: number, limitBytes: number, usedRatio: number, warn: boolean }>}
 */
export function quotaBudget(profileId) {
    const profile = usageBytes(profileId ?? activeProfileId);
    if (!profile.ok) return profile;
    const total = usageBytes();
    if (!total.ok) return total;
    const usedRatio = total.value / QUOTA_LIMIT_BYTES;
    return {
        ok: true,
        value: {
            profileBytes: profile.value,
            totalBytes: total.value,
            limitBytes: QUOTA_LIMIT_BYTES,
            usedRatio,
            warn: usedRatio >= QUOTA_WARN_RATIO
        }
    };
}

/**
 * Claves cortas presentes en el namespace de un perfil.
 * @param {string} profileId
 * @returns {StorageResult<string[]>}
 */
export function keysOfProfile(profileId) {
    try {
        const ls = backend();
        const prefix = `${ROOT_PREFIX}${profileId}.`;
        /** @type {string[]} */ const out = [];
        for (let i = 0; i < ls.length; i++) {
            const key = ls.key(i);
            if (key !== null && key.startsWith(prefix)) out.push(key.slice(prefix.length));
        }
        return { ok: true, value: out };
    } catch (err) {
        return { ok: false, error: message(err) };
    }
}

/**
 * Borra TODAS las claves del namespace de un perfil. Operación destructiva:
 * `profiles.js` la protege con confirmación tipeada del nombre (C4).
 * @param {string} profileId
 * @returns {StorageResult<number>} número de claves eliminadas
 */
export function clearProfile(profileId) {
    const keys = keysOfProfile(profileId);
    if (!keys.ok) return keys;
    try {
        const ls = backend();
        for (const key of keys.value) ls.removeItem(`${ROOT_PREFIX}${profileId}.${key}`);
        return { ok: true, value: keys.value.length };
    } catch (err) {
        return { ok: false, error: message(err) };
    }
}

/**
 * Lee una clave GLOBAL (fuera del namespace de perfil), como el índice
 * `tl.5.profiles`. Uso restringido a `profiles.js` y `migrate.js`.
 * @param {string} key
 * @returns {StorageResult<unknown | null>}
 */
export function getGlobal(key) {
    try {
        const rawValue = backend().getItem(`${ROOT_PREFIX}${key}`);
        if (rawValue === null) return { ok: true, value: null };
        return { ok: true, value: JSON.parse(rawValue) };
    } catch (err) {
        return { ok: false, error: message(err) };
    }
}

/**
 * Escribe una clave GLOBAL (fuera del namespace de perfil).
 * @param {string} key
 * @param {unknown} value
 * @returns {StorageResult<undefined>}
 */
export function setGlobal(key, value) {
    try {
        backend().setItem(`${ROOT_PREFIX}${key}`, JSON.stringify(value));
        return { ok: true, value: undefined };
    } catch (err) {
        return { ok: false, error: message(err) };
    }
}

/**
 * Claves crudas del almacén que casan con un prefijo. Lo usa el migrador
 * para localizar las claves v4 (`transformlab_*`), que viven fuera de `tl.`.
 * @param {string} prefix
 * @returns {StorageResult<string[]>}
 */
export function rawKeys(prefix) {
    try {
        const ls = backend();
        /** @type {string[]} */ const out = [];
        for (let i = 0; i < ls.length; i++) {
            const key = ls.key(i);
            if (key !== null && key.startsWith(prefix)) out.push(key);
        }
        return { ok: true, value: out };
    } catch (err) {
        return { ok: false, error: message(err) };
    }
}

/**
 * Lee una clave cruda sin deserializar. Para el migrador y el export de
 * seguridad, que deben copiar los datos v4 TAL CUAL antes de tocarlos.
 * @param {string} key
 * @returns {StorageResult<string | null>}
 */
export function getRaw(key) {
    try {
        return { ok: true, value: backend().getItem(key) };
    } catch (err) {
        return { ok: false, error: message(err) };
    }
}

/**
 * Escribe una clave cruda ya serializada.
 * @param {string} key
 * @param {string} rawValue
 * @returns {StorageResult<undefined>}
 */
export function setRaw(key, rawValue) {
    try {
        backend().setItem(key, rawValue);
        return { ok: true, value: undefined };
    } catch (err) {
        return { ok: false, error: message(err) };
    }
}

/**
 * Elimina una clave cruda.
 * @param {string} key
 * @returns {StorageResult<undefined>}
 */
export function removeRaw(key) {
    try {
        backend().removeItem(key);
        return { ok: true, value: undefined };
    } catch (err) {
        return { ok: false, error: message(err) };
    }
}

// @ts-check

/**
 * Multiperfil (decisión C4b): índice global `tl.5.profiles`, perfil activo y
 * ciclo de vida (crear / renombrar / borrar / seleccionar).
 *
 * Reglas:
 * - NINGUNA clave de datos se escribe fuera del namespace `tl.5.<pid>.`; el
 *   prefijo lo inyecta `storage.js` a partir del perfil activo.
 * - Borrar un perfil es destructivo y exige **confirmación tipeada** del
 *   nombre exacto: la firma lo obliga, no es una convención de la UI.
 * - Toda operación devuelve resultado tipado; nada lanza.
 */

import * as storage from './storage.js';
import { SCHEMA_VERSION, validateProfilesIndex, sanitizeText, COLLECTIONS, makeDefault } from './schema.js';
import { newProfileId, NO_PROFILE } from './ids.js';

/**
 * @typedef {{ id: string, name: string, createdAtISO: string }} ProfileSummary
 * @typedef {{ schemaVersion: number, activeProfileId: string, profiles: ProfileSummary[] }} ProfilesIndex
 * @typedef {import('./schema.js').SchemaIssue} SchemaIssue
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string, issues?: SchemaIssue[] }} ProfilesResult
 */

/** Clave global del índice, relativa al prefijo `tl.5.` */
const INDEX_KEY = 'profiles';

/** Máximo de perfiles: el multiperfil es para una familia, no para un SaaS. */
export const MAX_PROFILES = 10;

/** Índice vacío válido. @returns {ProfilesIndex} */
function emptyIndex() {
    return { schemaVersion: SCHEMA_VERSION, activeProfileId: '', profiles: [] };
}

/**
 * Lee el índice de perfiles. Si no existe, devuelve uno vacío válido.
 * Si está corrupto, lo dice: NUNCA lo sobrescribe por su cuenta (perder los
 * perfiles del usuario en silencio sería peor que el error).
 * @returns {ProfilesResult<ProfilesIndex>}
 */
export function readIndex() {
    const raw = storage.getGlobal(INDEX_KEY);
    if (!raw.ok) return { ok: false, error: raw.error };
    if (raw.value === null) return { ok: true, value: emptyIndex() };

    const parsed = validateProfilesIndex(raw.value);
    if (!parsed.ok) return { ok: false, error: 'profiles.indexCorrupt', issues: parsed.errors };
    return { ok: true, value: /** @type {ProfilesIndex} */ (parsed.value) };
}

/**
 * Escribe el índice tras validarlo (nada corrupto sale de aquí).
 * @param {ProfilesIndex} index
 * @returns {ProfilesResult<ProfilesIndex>}
 */
function writeIndex(index) {
    const parsed = validateProfilesIndex(index);
    if (!parsed.ok) return { ok: false, error: 'profiles.indexInvalid', issues: parsed.errors };
    const written = storage.setGlobal(INDEX_KEY, parsed.value);
    if (!written.ok) return { ok: false, error: written.error };
    return { ok: true, value: /** @type {ProfilesIndex} */ (parsed.value) };
}

/**
 * Bytes de entropía de un id de perfil. Dieciséis: 128 bits, que es donde la
 * probabilidad de colisión deja de merecer una comprobación. Sin ellos habría
 * que consultar el índice antes de crear —una lectura más y una condición de
 * carrera de regalo— y aun así no cubriría el caso que importa, que es la
 * colisión entre DISPOSITIVOS distintos, donde no hay índice común que mirar.
 */
const ID_BYTES = 16;

/**
 * Genera un id de perfil libre: **opaco y aleatorio** desde la v7 (M9-1).
 *
 * Antes era el `pN` libre más bajo, y era determinista a propósito. Dos cosas
 * lo tiraron:
 *
 * 1. **Colisión entre dispositivos.** El primer perfil de cualquier persona era
 *    `p1`. En cuanto dos dispositivos sincronicen, dos perfiles DISTINTOS
 *    comparten identificador. No es un riesgo estadístico: es una certeza.
 * 2. **Reutilización tras borrar**, que ya causó un defecto real — está contado
 *    en `remove()`, aquí abajo: al borrar `p1`, el perfil siguiente volvía a ser
 *    `p1` y heredaba los datos personales del borrado.
 *
 * La aleatoriedad no viola la regla del proyecto: lo prohibido es `Math.random`
 * (`test/security.test.js`) y en el núcleo del motor, que tiene que ser
 * determinista. Aquí la fuente es `crypto.getRandomValues`, y el determinismo
 * era justamente el problema.
 *
 * No se comprueba contra el índice: con 128 bits, la probabilidad de colisión no
 * merece una lectura más — y no cubriría el caso que importa, que es la
 * colisión entre dispositivos distintos, donde no hay índice común que mirar.
 *
 * @returns {string}
 */
function nextId() {
    return newProfileId();
}

/**
 * Lista de perfiles (copia).
 * @returns {ProfilesResult<ProfileSummary[]>}
 */
export function list() {
    const index = readIndex();
    if (!index.ok) return index;
    return { ok: true, value: index.value.profiles.map((p) => ({ ...p })) };
}

/**
 * Id del perfil activo, o cadena vacía si aún no hay ninguno.
 * @returns {ProfilesResult<string>}
 */
export function getActive() {
    const index = readIndex();
    if (!index.ok) return index;
    return { ok: true, value: index.value.activeProfileId };
}

/**
 * Selecciona el perfil activo y lo aplica al namespace de `storage.js`.
 * @param {string} profileId
 * @returns {ProfilesResult<string>}
 */
export function setActive(profileId) {
    const index = readIndex();
    if (!index.ok) return index;
    if (!index.value.profiles.some((p) => p.id === profileId)) {
        return { ok: false, error: 'profiles.notFound' };
    }
    const written = writeIndex({ ...index.value, activeProfileId: profileId });
    if (!written.ok) return written;
    const applied = storage.setActiveProfile(profileId);
    if (!applied.ok) return { ok: false, error: applied.error };
    return { ok: true, value: profileId };
}

/**
 * Sincroniza el namespace de `storage.js` con el perfil activo del índice.
 * Lo llama el arranque (`main.js`) antes de leer ningún dato.
 * @returns {ProfilesResult<string>}
 */
export function activateStored() {
    const index = readIndex();
    if (!index.ok) return index;
    const id = index.value.activeProfileId;
    if (id === '') return { ok: true, value: '' };
    const applied = storage.setActiveProfile(id);
    if (!applied.ok) return { ok: false, error: applied.error };
    return { ok: true, value: id };
}

/**
 * Crea un perfil, lo deja activo e inicializa sus colecciones con valores
 * por defecto válidos (así ninguna vista se encuentra un `null` inesperado).
 * @param {string} name
 * @param {{ createdAtISO: string, id?: string }} meta el instante lo inyecta el
 *   llamante: el módulo de datos no lee el reloj, para que sea testeable.
 * @returns {ProfilesResult<ProfileSummary>}
 */
export function create(name, meta) {
    // `meta` es obligatorio pero se comprueba en vez de desreferenciarlo: el
    // contrato del módulo es que NADA lanza, ni siquiera ante una llamada mal
    // formada desde la UI (create('Ana') sin el segundo argumento).
    if (meta === null || typeof meta !== 'object') {
        return { ok: false, error: 'profiles.metaInvalid' };
    }
    const index = readIndex();
    if (!index.ok) return index;
    if (index.value.profiles.length >= MAX_PROFILES) {
        return { ok: false, error: 'profiles.limitReached' };
    }
    const cleanName = sanitizeText(name, 60);
    if (cleanName === '') return { ok: false, error: 'profiles.nameEmpty' };
    if (index.value.profiles.some((p) => p.name === cleanName)) {
        return { ok: false, error: 'profiles.nameTaken' };
    }

    const id = typeof meta.id === 'string' && meta.id !== '' ? meta.id : nextId();
    /** @type {ProfileSummary} */
    const summary = { id, name: cleanName, createdAtISO: meta.createdAtISO };

    // El namespace se apunta al perfil nuevo y se siembra ANTES de inscribirlo
    // en el índice: si la siembra falla (cuota), no queda un perfil fantasma
    // registrado y sin datos. Las claves sueltas de un id no inscrito son
    // inocuas y las sobrescribe el siguiente intento.
    const previousNamespace = storage.getActiveProfile();
    const applied = storage.setActiveProfile(id);
    if (!applied.ok) return { ok: false, error: applied.error };

    for (const collection of Object.keys(COLLECTIONS)) {
        if (collection === 'profile') continue; // lo escribe el onboarding
        const seeded = storage.set(collection, makeDefault(collection));
        if (!seeded.ok) {
            // deshacer lo sembrado y devolver el namespace donde estaba
            storage.clearProfile(id);
            storage.setActiveProfile(previousNamespace);
            return { ok: false, error: seeded.error };
        }
    }

    const written = writeIndex({
        ...index.value,
        activeProfileId: id,
        profiles: [...index.value.profiles, summary]
    });
    if (!written.ok) {
        storage.clearProfile(id);
        storage.setActiveProfile(previousNamespace);
        return written;
    }
    return { ok: true, value: { ...summary } };
}

/**
 * Renombra un perfil.
 * @param {string} profileId
 * @param {string} newName
 * @returns {ProfilesResult<ProfileSummary>}
 */
export function rename(profileId, newName) {
    const index = readIndex();
    if (!index.ok) return index;
    const target = index.value.profiles.find((p) => p.id === profileId);
    if (!target) return { ok: false, error: 'profiles.notFound' };

    const cleanName = sanitizeText(newName, 60);
    if (cleanName === '') return { ok: false, error: 'profiles.nameEmpty' };
    if (index.value.profiles.some((p) => p.name === cleanName && p.id !== profileId)) {
        return { ok: false, error: 'profiles.nameTaken' };
    }
    const profiles = index.value.profiles.map((p) => (p.id === profileId ? { ...p, name: cleanName } : p));
    const written = writeIndex({ ...index.value, profiles });
    if (!written.ok) return written;
    return { ok: true, value: { ...target, name: cleanName } };
}

/**
 * Borra un perfil y TODOS sus datos. Destructivo e irreversible: exige que
 * `confirmationName` coincida exactamente con el nombre del perfil (C4).
 * La comprobación vive aquí, no en la UI, para que no pueda saltarse.
 * @param {string} profileId
 * @param {string} confirmationName nombre exacto tecleado por el usuario
 * @returns {ProfilesResult<{ deletedKeys: number, activeProfileId: string }>}
 */
export function remove(profileId, confirmationName) {
    const index = readIndex();
    if (!index.ok) return index;
    const target = index.value.profiles.find((p) => p.id === profileId);
    if (!target) return { ok: false, error: 'profiles.notFound' };
    if (sanitizeText(confirmationName, 60) !== target.name) {
        return { ok: false, error: 'profiles.confirmationMismatch' };
    }

    const remaining = index.value.profiles.filter((p) => p.id !== profileId);
    const nextActive = index.value.activeProfileId === profileId
        ? (remaining[0]?.id ?? '')
        : index.value.activeProfileId;

    // primero el índice: si el borrado de datos falla a medias, el perfil ya
    // no aparece y no queda un registro apuntando a datos incompletos
    const written = writeIndex({ ...index.value, activeProfileId: nextActive, profiles: remaining });
    if (!written.ok) return written;

    const cleared = storage.clearProfile(profileId);
    if (!cleared.ok) return { ok: false, error: cleared.error };

    // El namespace se resincroniza SIEMPRE, también al borrar el último perfil.
    // Si se dejaba apuntando al id recién borrado, cualquier escritura posterior
    // resucitaba claves en su namespace; y como nextId() reutiliza el pN libre
    // más bajo, el siguiente perfil creado heredaba los datos personales del
    // borrado (create no siembra 'profile', así que el registro del anterior
    // sobrevivía intacto dentro del perfil nuevo).
    storage.setActiveProfile(nextActive === '' ? NO_PROFILE : nextActive);
    return { ok: true, value: { deletedKeys: cleared.value, activeProfileId: nextActive } };
}

// @ts-check

/**
 * Copia de seguridad: export e import de perfiles (decisión C3a).
 *
 * Este módulo es **el punto de entrada de datos hostiles del producto**: un
 * fichero de import puede venir de cualquier sitio. Por eso:
 * - Todo dato entrante pasa por los validadores de `schema.js`, que devuelven
 *   una copia solo con claves conocidas (nada de claves de contrabando ni
 *   contaminación de prototipo).
 * - Todo texto pasa por `sanitizeText`. El texto se conserva LITERAL: el
 *   escapado de HTML es responsabilidad del render (F6), no del almacén.
 * - El import es en dos pasos: `inspect()` produce un resumen para enseñar al
 *   usuario, y `apply()` escribe solo si él confirma. Nada se sobrescribe sin
 *   que se haya visto antes qué contiene el fichero.
 */

import * as storage from './storage.js';
import * as profiles from './profiles.js';
import { SCHEMA_VERSION, COLLECTIONS, validateCollection, sanitizeText, makeDefault } from './schema.js';

/**
 * @typedef {import('./schema.js').SchemaIssue} SchemaIssue
 * @typedef {{ id: string, name: string, createdAtISO: string, collections: Record<string, unknown> }} BackupProfile
 * @typedef {{ formatVersion: number, schemaVersion: number, exportedAtISO: string, profiles: BackupProfile[] }} BackupFile
 *
 * @typedef {Object} BackupSummary
 * @property {string} exportedAtISO
 * @property {number} schemaVersion
 * @property {Array<{ id: string, name: string, checkins: number, hasPlan: boolean, hasProfile: boolean, photos: number }>} profiles
 * @property {string[]} warnings colecciones descartadas o corregidas
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string, issues?: SchemaIssue[] }} BackupResult
 */

/** Versión del formato de fichero (independiente del esquema de datos). */
export const BACKUP_FORMAT_VERSION = 1;

/** Tope de tamaño del texto de import: por encima, ni se intenta parsear. */
export const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/**
 * Exporta uno o todos los perfiles a un objeto serializable.
 * @param {{ exportedAtISO: string, profileIds?: string[] }} options
 * @returns {BackupResult<BackupFile>}
 */
export function exportProfiles(options) {
    const index = profiles.readIndex();
    if (!index.ok) return { ok: false, error: index.error };

    const wanted = options.profileIds ?? index.value.profiles.map((p) => p.id);
    /** @type {BackupProfile[]} */ const out = [];
    const previousActive = storage.getActiveProfile();

    for (const summary of index.value.profiles) {
        if (!wanted.includes(summary.id)) continue;
        storage.setActiveProfile(summary.id);
        /** @type {Record<string, unknown>} */ const collections = {};
        for (const name of Object.keys(COLLECTIONS)) {
            const read = storage.get(name);
            if (read.ok && read.value !== null) collections[name] = read.value;
        }
        out.push({ id: summary.id, name: summary.name, createdAtISO: summary.createdAtISO, collections });
    }
    storage.setActiveProfile(previousActive);

    if (out.length === 0) return { ok: false, error: 'backup.noProfiles' };
    return {
        ok: true,
        value: {
            formatVersion: BACKUP_FORMAT_VERSION,
            schemaVersion: SCHEMA_VERSION,
            exportedAtISO: options.exportedAtISO,
            profiles: out
        }
    };
}

/**
 * Serializa un export a texto JSON listo para descargar.
 * @param {BackupFile} backup
 * @returns {BackupResult<string>}
 */
export function serialize(backup) {
    try {
        return { ok: true, value: JSON.stringify(backup, null, 2) };
    } catch {
        return { ok: false, error: 'backup.serializeFailed' };
    }
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isRecord(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Instante ISO completo, con el MISMO criterio que `schema.js`. */
const FALLBACK_INSTANT = '1970-01-01T00:00:00.000Z';

/** @param {unknown} v @returns {boolean} */
function isIsoInstant(v) {
    return typeof v === 'string' && /\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v));
}

/**
 * Analiza un fichero de import SIN escribir nada. Devuelve el contenido ya
 * validado y saneado más un resumen para que el usuario decida.
 * @param {string} text contenido del fichero
 * @returns {BackupResult<{ backup: BackupFile, summary: BackupSummary }>}
 */
export function inspect(text) {
    if (typeof text !== 'string') return { ok: false, error: 'backup.notText' };
    if (text.length * 2 > MAX_IMPORT_BYTES) return { ok: false, error: 'backup.tooLarge' };

    /** @type {unknown} */ let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        return { ok: false, error: 'backup.notJson' };
    }
    if (!isRecord(parsed)) return { ok: false, error: 'backup.notObject' };

    const formatVersion = parsed.formatVersion;
    if (formatVersion !== BACKUP_FORMAT_VERSION) {
        return { ok: false, error: 'backup.formatUnsupported' };
    }
    if (parsed.schemaVersion !== SCHEMA_VERSION) {
        return { ok: false, error: 'backup.schemaUnsupported' };
    }
    const exportedAtISO = typeof parsed.exportedAtISO === 'string' ? parsed.exportedAtISO : '';
    if (!Array.isArray(parsed.profiles) || parsed.profiles.length === 0) {
        return { ok: false, error: 'backup.noProfiles' };
    }

    /** @type {BackupProfile[]} */ const cleanProfiles = [];
    /** @type {BackupSummary['profiles']} */ const summaryProfiles = [];
    /** @type {string[]} */ const warnings = [];

    for (const [i, rawProfile] of parsed.profiles.entries()) {
        if (!isRecord(rawProfile)) { warnings.push('backup.profileSkipped'); continue; }

        const name = sanitizeText(rawProfile.name, 60) || `Perfil ${i + 1}`;
        const id = typeof rawProfile.id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(rawProfile.id)
            ? rawProfile.id
            : `imported${i + 1}`;
        // El criterio DEBE ser el mismo que el del índice de perfiles
        // (schema.js: instante ISO con 'T'). Si aquí se acepta '2026-01-01' y
        // allí no, inspect() enseña un backup como importable y apply() lo
        // rechaza a mitad, con los perfiles anteriores ya escritos.
        const createdAtISO = isIsoInstant(rawProfile.createdAtISO)
            ? /** @type {string} */ (rawProfile.createdAtISO)
            : (isIsoInstant(exportedAtISO) ? exportedAtISO : FALLBACK_INSTANT);

        const rawCollections = isRecord(rawProfile.collections) ? rawProfile.collections : {};
        /** @type {Record<string, unknown>} */ const collections = {};
        // SOLO se aceptan colecciones conocidas, y solo si validan: lo demás
        // se descarta con aviso en vez de romper el import entero
        for (const collectionName of Object.keys(COLLECTIONS)) {
            if (!Object.hasOwn(rawCollections, collectionName)) continue;
            const result = validateCollection(collectionName, rawCollections[collectionName]);
            if (result.ok) collections[collectionName] = result.value;
            else warnings.push(`backup.collectionDropped:${collectionName}`);
        }

        cleanProfiles.push({ id, name, createdAtISO, collections });
        const checkins = /** @type {*} */ (collections.checkins);
        const photos = /** @type {*} */ (collections.photos);
        summaryProfiles.push({
            id,
            name,
            checkins: Array.isArray(checkins?.items) ? checkins.items.length : 0,
            hasPlan: Boolean(/** @type {*} */ (collections.plan)?.current),
            hasProfile: Object.hasOwn(collections, 'profile'),
            photos: Array.isArray(photos?.items) ? photos.items.length : 0
        });
    }

    if (cleanProfiles.length === 0) return { ok: false, error: 'backup.noValidProfiles' };

    return {
        ok: true,
        value: {
            backup: { formatVersion: BACKUP_FORMAT_VERSION, schemaVersion: SCHEMA_VERSION, exportedAtISO, profiles: cleanProfiles },
            summary: { exportedAtISO, schemaVersion: SCHEMA_VERSION, profiles: summaryProfiles, warnings }
        }
    };
}

/**
 * Escribe un import ya inspeccionado. Los perfiles entrantes se añaden como
 * perfiles NUEVOS: un import nunca pisa los datos existentes en silencio.
 * Si falla a mitad, el error incluye `imported` con lo que YA se escribió: el
 * llamante puede decirle al usuario exactamente qué entró y qué no.
 * @param {BackupFile} backup salida de `inspect()`, no un objeto arbitrario
 * @param {{ nowISO: string }} context
 * @returns {{ ok: true, value: { importedProfiles: Array<{ id: string, name: string }> } } | { ok: false, error: string, imported?: Array<{ id: string, name: string }> }}
 */
export function apply(backup, context) {
    if (!isRecord(backup) || !Array.isArray(backup.profiles) || backup.profiles.length === 0) {
        return { ok: false, error: 'backup.nothingToApply' };
    }
    const previousActive = storage.getActiveProfile();
    /** @type {Array<{ id: string, name: string }>} */ const imported = [];

    for (const incoming of backup.profiles) {
        if (!isRecord(incoming) || !isRecord(incoming.collections)) {
            restoreActive(previousActive);
            return { ok: false, error: 'backup.nothingToApply', imported };
        }
        // nombre libre: si ya existe, se sufija para no colisionar ni pisar
        let name = sanitizeText(incoming.name, 60) || 'Perfil importado';
        const existing = profiles.list();
        if (existing.ok && existing.value.some((p) => p.name === name)) {
            let suffix = 2;
            while (existing.value.some((p) => p.name === `${name} (${suffix})`) && suffix < 100) suffix++;
            name = `${name} (${suffix})`;
        }

        const created = profiles.create(name, { createdAtISO: incoming.createdAtISO || context.nowISO });
        if (!created.ok) {
            restoreActive(previousActive);
            return { ok: false, error: created.error, imported };
        }

        // `profiles.create` ya dejó activo el perfil nuevo y sembró defaults.
        // Solo se escriben las colecciones que el backup TRAE: rellenar las
        // ausentes con makeDefault() fabricaba un `profile` con 70 kg, 20 % de
        // grasa e inicio en 1970 que nadie introdujo, presentado como dato del
        // usuario. Lo que no viene se queda como lo dejó create().
        for (const collectionName of Object.keys(COLLECTIONS)) {
            if (!Object.hasOwn(incoming.collections, collectionName)) continue;
            const value = incoming.collections[collectionName];
            if (value === null || value === undefined) continue;
            // revalidación defensiva: `apply` no confía ni en su propio input
            const checked = validateCollection(collectionName, value);
            if (!checked.ok) continue;
            const written = storage.set(collectionName, checked.value);
            if (!written.ok) {
                restoreActive(previousActive);
                return { ok: false, error: written.error, imported };
            }
        }
        imported.push({ id: created.value.id, name });
    }

    restoreActive(previousActive);
    return { ok: true, value: { importedProfiles: imported } };
}

/**
 * Devuelve el perfil activo a donde estaba, EN EL ÍNDICE y en memoria.
 * `profiles.create` marca activo el perfil nuevo también en el índice
 * persistido; restaurar solo el namespace en memoria dejaba ambos
 * desincronizados y, al siguiente arranque, el usuario aparecía dentro del
 * perfil recién importado en lugar del suyo.
 * @param {string} profileId
 */
function restoreActive(profileId) {
    if (profileId === '') return;
    const restored = profiles.setActive(profileId);
    if (!restored.ok) storage.setActiveProfile(profileId);
}

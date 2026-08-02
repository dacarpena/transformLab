// @ts-check

/**
 * Migrador v4 → v5 (decisión C1a). Corre UNA sola vez, al detectar claves
 * `transformlab_*` en el almacén.
 *
 * Secuencia obligatoria (prompts/M2-datos.md):
 *  1. **Export de seguridad**: copia literal de las claves v4 bajo
 *     `tl.legacy.backup`, ANTES de transformar nada.
 *  2. **Transformación** a esquema v5 como primer perfil, marcando siempre
 *     `muscleSource: 'estimated'` — en v4 el músculo salía del ratio 0,48
 *     (`legacy/js/onboarding.js:521`), jamás de una medición.
 *  3. **Archivado**: las claves v4 se renombran a `tl.legacy.*`. No se borran.
 *
 * Lo que NO se migra: `transformlab_generatedData`. La proyección v4 es
 * precisamente el dato defectuoso (el clamp de C-1..C-3 daba pesos objetivo
 * de IMC 15); el plan se regenera con el motor v2 desde el perfil migrado.
 */

import * as storage from './storage.js';
import { SCHEMA_VERSION, sanitizeText, MEASURE_KEYS, validateCollection } from './schema.js';
import * as profiles from './profiles.js';

/** Prefijo de las claves de la versión 4. */
const V4_PREFIX = 'transformlab_';

/** Claves v4 conocidas, en el orden en que se documentan. */
export const V4_KEYS = Object.freeze([
    'transformlab_userProfile',
    'transformlab_checkins',
    'transformlab_prefs',
    'transformlab_startDate',
    'transformlab_activeView',
    'transformlab_generatedData'
]);

/**
 * Dónde queda la copia de seguridad automática. Vive bajo un prefijo PROPIO,
 * separado del de archivado: si compartieran espacio, una clave v4 llamada
 * `transformlab_backup` (el legacy tiene claves fuera de V4_KEYS) archivaría
 * encima de la copia de seguridad justo antes de borrar los originales, y
 * borraría la única red bajo el usuario en el peor momento posible.
 */
const BACKUP_KEY = 'tl.legacyBackup.v4';

/** Prefijo de archivado de las claves originales. */
const ARCHIVE_PREFIX = 'tl.legacy.';

/**
 * @typedef {import('./schema.js').SchemaIssue} SchemaIssue
 * @typedef {{ migrated: boolean, profileId: string, checkinsMigrated: number, archivedKeys: string[], warnings: string[] }} MigrationReport
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string, issues?: SchemaIssue[] }} MigrateResult
 */

/**
 * ¿Hay datos v4 sin migrar en este navegador?
 * @returns {boolean}
 */
export function needsMigration() {
    const keys = storage.rawKeys(V4_PREFIX);
    return keys.ok && keys.value.length > 0;
}

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isRecord(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** @param {unknown} v @returns {number | null} */
function finiteOrNull(v) {
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Convierte la adherencia v4 (porcentaje 0–100) a la escala v5 (1–10).
 *
 * Sin heurística de «igual ya venía en 1–10»: en v4 el control es un deslizador
 * de 0 a 100 con paso 5 (`legacy/js/checkin.js:203`) que se consume como
 * porcentaje (`:73`, `adherence / 100`). Interpretar un 10 como «10 sobre 10»
 * convertía la peor semana del usuario en la mejor.
 * @param {unknown} v
 * @returns {number | null}
 */
function adherencePctToScale10(v) {
    const n = finiteOrNull(v);
    if (n === null) return null;
    const pct = Math.min(100, Math.max(0, n));
    return Math.min(10, Math.max(1, Math.round(pct / 10)));
}

/** @param {unknown} v @returns {number | null} */
function scale10(v) {
    const n = finiteOrNull(v);
    if (n === null) return null;
    return Math.min(10, Math.max(1, Math.round(n)));
}

/**
 * Normaliza una fecha v4 (ISO completa o 'YYYY-MM-DD') a fecha civil UTC.
 * @param {unknown} v
 * @returns {string | null}
 */
function toCivilDate(v) {
    if (typeof v !== 'string') return null;
    const direct = v.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(direct)) return null;
    const [y, m, d] = direct.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return direct;
}

/**
 * Traduce el `userProfile` v4 al perfil v5.
 * @param {unknown} v4Profile
 * @param {string} nowISO
 * @param {string[]} warnings
 * @returns {MigrateResult<object>}
 */
function buildProfileRecord(v4Profile, nowISO, warnings) {
    if (!isRecord(v4Profile)) return { ok: false, error: 'migrate.userProfileMissing' };
    const initial = isRecord(v4Profile.initial) ? v4Profile.initial : null;
    const target = isRecord(v4Profile.target) ? v4Profile.target : null;
    const prof = isRecord(v4Profile.profile) ? v4Profile.profile : null;
    if (!initial || !target || !prof) return { ok: false, error: 'migrate.userProfileIncomplete' };

    const weightKg = finiteOrNull(initial.weight);
    const fatPct = finiteOrNull(initial.fatPct);
    if (weightKg === null || fatPct === null) return { ok: false, error: 'migrate.initialInvalid' };

    const startDateISO = toCivilDate(v4Profile.startDate) ?? toCivilDate(nowISO);
    if (startDateISO === null) return { ok: false, error: 'migrate.startDateInvalid' };

    const sex = prof.sex === 'female' ? 'female' : 'male';
    if (prof.sex !== 'male' && prof.sex !== 'female') warnings.push('migrate.sexDefaulted');

    const targetMuscle = finiteOrNull(target.muscleKg);
    const targetFat = finiteOrNull(target.fatPct);
    if (targetMuscle === null || targetFat === null) return { ok: false, error: 'migrate.targetInvalid' };

    // A3: en v4 el músculo SIEMPRE venía del ratio 0,48 estimado; nunca de una
    // medición. Se migra como estimado y se descarta el valor concreto para
    // que el motor v2 lo derive con su propia proporción por sexo.
    warnings.push('migrate.muscleMarkedEstimated');

    return {
        ok: true,
        value: {
            schemaVersion: SCHEMA_VERSION,
            name: 'Perfil migrado',
            createdAtISO: nowISO,
            user: {
                sex,
                age: finiteOrNull(prof.age) ?? 30,
                heightCm: finiteOrNull(prof.height) ?? 170,
                activityLevel: typeof prof.activityLevel === 'string' ? prof.activityLevel : 'moderate',
                trainingStatus: typeof prof.trainingStatus === 'string' ? prof.trainingStatus : 'beginner'
            },
            initial: { weightKg, fatPct, muscleKg: null, muscleSource: 'estimated' },
            target: { fatPct: targetFat, muscleKg: targetMuscle },
            startDateISO,
            intensity: 'moderate'
        }
    };
}

/**
 * Traduce los check-ins v4 al esquema v5.
 * v4: `{id, week, date, measurements:{weight,fatPct,waist}, selfReport:{energy,sleepQuality,adherence,motivation,notes}}`
 * @param {unknown} v4Checkins
 * @param {string} nowISO
 * @returns {{ items: object[], skipped: number }}
 */
function buildCheckins(v4Checkins, nowISO) {
    // Un valor que no es array (objeto, número, null…) significa que había algo
    // ahí y no se entiende: se señala como descartado, no se ignora en silencio.
    if (!Array.isArray(v4Checkins)) {
        return { items: [], skipped: v4Checkins === null || v4Checkins === undefined ? 0 : 1 };
    }
    /** @type {object[]} */ const items = [];
    let skipped = 0;

    for (const [i, raw] of v4Checkins.entries()) {
        if (!isRecord(raw)) { skipped++; continue; }
        const m = isRecord(raw.measurements) ? raw.measurements : {};
        const s = isRecord(raw.selfReport) ? raw.selfReport : {};
        const weightKg = finiteOrNull(m.weight);
        const dateISO = toCivilDate(raw.date);
        // el peso y la fecha son la esencia del check-in: sin ellos no se migra
        if (weightKg === null || dateISO === null) { skipped++; continue; }

        /** @type {Record<string, number>} */ const measuresCm = {};
        const waist = finiteOrNull(m.waist);
        if (waist !== null && MEASURE_KEYS.includes('waist')) measuresCm.waist = waist;

        /** @type {Record<string, number>} */ const subjective = {};
        const energy = scale10(s.energy);
        const sleep = scale10(s.sleepQuality);
        const adherence = adherencePctToScale10(s.adherence);
        const motivation = scale10(s.motivation);
        if (energy !== null) subjective.energy = energy;
        if (sleep !== null) subjective.sleep = sleep;
        if (adherence !== null) subjective.adherence = adherence;
        if (motivation !== null) subjective.motivation = motivation;

        items.push({
            id: typeof raw.id === 'string' && raw.id !== '' ? sanitizeText(raw.id, 60) : `migrated_${i}`,
            dateISO,
            weightKg,
            fatPct: finiteOrNull(m.fatPct),
            measuresCm,
            subjective,
            notes: sanitizeText(s.notes),
            createdAtISO: nowISO,
            editedAtISO: null
        });
    }
    return { items, skipped };
}

/**
 * Ejecuta la migración completa. Idempotente por construcción: si ya no
 * quedan claves v4, no hace nada y lo dice.
 * @param {{ nowISO: string, profileName?: string }} context el instante lo
 *   inyecta el llamante: la capa de datos no lee el reloj (testeabilidad).
 * @returns {MigrateResult<MigrationReport>}
 */
export function migrate(context) {
    /** @type {string[]} */ const warnings = [];

    const v4KeysPresent = storage.rawKeys(V4_PREFIX);
    if (!v4KeysPresent.ok) return { ok: false, error: v4KeysPresent.error };
    if (v4KeysPresent.value.length === 0) {
        return { ok: true, value: { migrated: false, profileId: '', checkinsMigrated: 0, archivedKeys: [], warnings: ['migrate.nothingToMigrate'] } };
    }

    // ---- 1 · export de seguridad ANTES de tocar nada ----
    /** @type {Record<string, string>} */ const snapshot = {};
    for (const key of v4KeysPresent.value) {
        const raw = storage.getRaw(key);
        if (!raw.ok) return { ok: false, error: raw.error };
        if (raw.value !== null) snapshot[key] = raw.value;
    }
    const backupWritten = storage.setRaw(BACKUP_KEY, JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        createdAtISO: context.nowISO,
        source: 'v4',
        keys: snapshot
    }));
    if (!backupWritten.ok) {
        // sin copia de seguridad NO se sigue: es la única red bajo el usuario
        return { ok: false, error: 'migrate.backupFailed' };
    }

    // ---- 2 · transformación ----
    const rawProfile = storage.getRaw('transformlab_userProfile');
    if (!rawProfile.ok) return { ok: false, error: rawProfile.error };
    if (rawProfile.value === null) return { ok: false, error: 'migrate.userProfileMissing' };

    /** @type {unknown} */ let parsedProfile;
    try {
        parsedProfile = JSON.parse(rawProfile.value);
    } catch {
        return { ok: false, error: 'migrate.userProfileCorrupt' };
    }

    const profileRecord = buildProfileRecord(parsedProfile, context.nowISO, warnings);
    if (!profileRecord.ok) return profileRecord;

    // El nombre se desambigua si ya existe. Es la defensa que garantiza que un
    // intento fallido NUNCA bloquee el siguiente: sin ella, un fallo por cuota
    // dejaba un perfil huérfano y el reintento moría con `profiles.nameTaken`,
    // con los datos v4 intactos pero ya inalcanzables para siempre.
    const baseName = context.profileName ?? 'Perfil migrado';
    let profileName = baseName;
    const existing = profiles.list();
    if (existing.ok) {
        let suffix = 2;
        while (existing.value.some((p) => p.name === profileName) && suffix < 100) {
            profileName = `${baseName} (${suffix})`;
            suffix++;
        }
    }

    const created = profiles.create(profileName, { createdAtISO: context.nowISO });
    if (!created.ok) return { ok: false, error: created.error };
    const profileId = created.value.id;

    /**
     * Deshace el perfil recién creado. Es de MEJOR ESFUERZO: si el almacén está
     * lleno, el propio rollback puede no poder escribir el índice. Por eso la
     * garantía de que el reintento funcione no descansa aquí, sino en la
     * desambiguación del nombre de arriba.
     * @param {string} error
     * @returns {{ ok: false, error: string }}
     */
    const rollback = (error) => {
        profiles.remove(profileId, profileName);
        return { ok: false, error };
    };

    // El migrador NO escribe nada que el propio esquema v5 rechazaría. Sin esta
    // comprobación, unos datos v4 fuera de rango (edad 200, peso 0, un nivel de
    // actividad inventado) se copiaban tal cual, se reportaba éxito y acto
    // seguido se archivaban los originales: el usuario quedaba con un perfil
    // que la app no puede leer y sin señal de que algo fue mal.
    const profileValid = validateCollection('profile', profileRecord.value);
    if (!profileValid.ok) {
        return rollback('migrate.profileOutOfSchema');
    }
    const savedProfile = storage.set('profile', profileValid.value);
    if (!savedProfile.ok) return rollback(savedProfile.error);

    // check-ins (pueden no existir)
    let checkinsMigrated = 0;
    const rawCheckins = storage.getRaw('transformlab_checkins');
    if (rawCheckins.ok && rawCheckins.value !== null) {
        /** @type {unknown} */ let parsedCheckins = null;
        try {
            parsedCheckins = JSON.parse(rawCheckins.value);
        } catch {
            warnings.push('migrate.checkinsCorrupt');
        }
        const built = buildCheckins(parsedCheckins, context.nowISO);
        if (built.skipped > 0) warnings.push('migrate.checkinsSkipped');

        // los check-ins que no cuadren con el esquema se descartan uno a uno,
        // con aviso: un solo registro raro no debe tumbar toda la migración
        /** @type {object[]} */ const validItems = [];
        for (const item of built.items) {
            const check = validateCollection('checkins', { schemaVersion: SCHEMA_VERSION, items: [item] });
            if (check.ok) validItems.push(item);
            else warnings.push('migrate.checkinsSkipped');
        }
        const savedCheckins = storage.set('checkins', { schemaVersion: SCHEMA_VERSION, items: validItems });
        if (!savedCheckins.ok) return rollback(savedCheckins.error);
        checkinsMigrated = validItems.length;
    }

    // ajustes: el idioma se queda en el defecto; de v4 solo sobrevive lo que
    // tiene sentido en v5 (la granularidad y las métricas visibles no existen)
    warnings.push('migrate.planRegenerationRequired');

    // ---- 3 · archivado (renombrar, NUNCA borrar) ----
    // Se escriben TODAS las copias antes de borrar ningún original: si la
    // escritura falla a mitad, los datos v4 siguen todos en su sitio.
    /** @type {string[]} */ const archivedKeys = [];
    for (const key of v4KeysPresent.value) {
        const value = snapshot[key];
        if (value === undefined) continue;
        const archiveKey = `${ARCHIVE_PREFIX}${key.slice(V4_PREFIX.length)}`;
        const written = storage.setRaw(archiveKey, value);
        if (!written.ok) return rollback(written.error);
        archivedKeys.push(archiveKey);
    }
    for (const key of v4KeysPresent.value) {
        if (snapshot[key] === undefined) continue;
        storage.removeRaw(key); // el original ya está copiado; su borrado no puede perder nada
    }

    return {
        ok: true,
        value: { migrated: true, profileId, checkinsMigrated, archivedKeys, warnings }
    };
}

/**
 * Devuelve la copia de seguridad automática, para poder ofrecer su descarga.
 * @returns {MigrateResult<string | null>}
 */
export function readSafetyBackup() {
    const raw = storage.getRaw(BACKUP_KEY);
    if (!raw.ok) return { ok: false, error: raw.error };
    return { ok: true, value: raw.value };
}

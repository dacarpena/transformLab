// @ts-check

/**
 * Migración de esquema entre versiones de la v5 en adelante (V2-M0).
 *
 * EL PRECIPICIO QUE CIERRA, reproducido antes de escribir esto. Subir
 * `SCHEMA_VERSION` de 5 a 6 rompía la aplicación de dos formas a la vez:
 *
 * 1. **Las claves se orfanan.** El namespace es `tl.<version>.<perfil>.<col>`,
 *    así que la app pasa a mirar `tl.6.p1.checkins` mientras los datos siguen en
 *    `tl.5.p1.checkins`, intactos e invisibles.
 * 2. **El validador rechaza.** `rootValidator` exige `schemaVersion === 5`, así
 *    que aunque leyeras la clave vieja, la colección degradaría a vacía.
 *
 * Y la cadena acababa en pérdida REAL: sin perfil válido, `main.js` arranca el
 * onboarding, y al completarlo el usuario SOBRESCRIBE su propio perfil. Un año
 * de check-ins convertido en bytes huérfanos.
 *
 * DOS CAPAS, y la distinción importa:
 *
 * - **En memoria (`migrateValue`)**: pura, sin efectos. La llama
 *   `validateCollection` al toparse con una versión anterior, para que CUALQUIER
 *   lectura funcione desde el primer instante, incluso antes de que la migración
 *   del almacén haya corrido. Es la red de seguridad.
 * - **En el almacén (`migrateStore`)**: una sola vez al arrancar, con **copia de
 *   seguridad previa** —la misma disciplina export-antes-de-transformar que usa
 *   `migrate.js` para el salto v4→v5— y dejando las claves viejas intactas.
 *   Nunca borra: si algo sale mal, los datos originales siguen ahí.
 *
 * AÑADIR UNA VERSIÓN. Sube `SCHEMA_VERSION` en `version.js`, añade la anterior a
 * `MIGRATABLE_FROM`, y registra en `STEPS` qué le pasa a cada colección. Si una
 * colección no cambia de forma, no hace falta entrada: el paso por defecto sube
 * el número y deja el resto igual.
 */

import * as storage from './storage.js';
import { SCHEMA_VERSION, MIGRATABLE_FROM, rootPrefix } from './version.js';

/**
 * La migración de un valor vive en `migrate-value.js`, que es PURO. Se reexporta
 * desde aquí para que ningún llamante existente tenga que cambiar (M8-0).
 */
export { migrateValue } from './migrate-value.js';
// Y se importa además, porque `migrateStore` la usa.
import { migrateValue } from './migrate-value.js';


/** Clave donde se guarda la copia de seguridad previa a migrar. */
export const BACKUP_KEY_PREFIX = 'tl.migrationBackup.v';

/**
 * Testigo de migración completada.
 *
 * Hace falta porque la migración **copia y no borra**: las claves viejas se
 * quedan donde están (son la red de rescate), así que sin un testigo
 * `needsMigration()` seguiría diciendo «sí» en CADA arranque. Y no era solo
 * ruido en la consola: cada carga rehacía el bucle entero y **reescribía la
 * copia de seguridad**, machacando la que se hizo el día de la migración de
 * verdad — justo la que uno querría si algo hubiera salido mal.
 */
export const DONE_KEY_PREFIX = 'tl.migrationDone.v';

/**
 * ¿Hay datos de una versión anterior esperando a migrarse?
 * @returns {{ pending: boolean, from: number | null, keys: string[] }}
 */
export function needsMigration() {
    for (const version of [...MIGRATABLE_FROM].sort((a, b) => a - b)) {
        // Ya migrada: el testigo lo dice. Sin esto se repetiría en cada arranque,
        // porque las claves de origen NUNCA se borran.
        const done = storage.getRaw(`${DONE_KEY_PREFIX}${version}`);
        if (done.ok && done.value !== null) continue;

        const found = storage.rawKeys(rootPrefix(version));
        if (found.ok && found.value.length > 0) {
            return { pending: true, from: version, keys: found.value };
        }
    }
    return { pending: false, from: null, keys: [] };
}

/**
 * @typedef {Object} MigrationReport
 * @property {boolean} migrated
 * @property {number | null} from
 * @property {number} keysMigrated
 * @property {string[]} warnings claves que no se pudieron migrar (se dejan intactas)
 * @property {string} [backupKey]
 */

/**
 * Migra el almacén ENTERO de la versión anterior a la vigente.
 *
 * Copia, no mueve: las claves viejas se quedan donde están. Ocupan sitio (y el
 * presupuesto de cuota las cuenta bajo `tl.`), pero son la red si algo sale mal;
 * limpiarlas es una decisión posterior y consciente, no un efecto colateral de
 * arrancar la aplicación.
 *
 * @param {{ nowISO: string }} context
 * @returns {{ ok: true, value: MigrationReport } | { ok: false, error: string }}
 */
export function migrateStore(context) {
    if (!context || typeof context.nowISO !== 'string') {
        return { ok: false, error: 'migrations.contextInvalid' };
    }
    const pending = needsMigration();
    if (!pending.pending || pending.from === null) {
        return { ok: true, value: { migrated: false, from: null, keysMigrated: 0, warnings: [] } };
    }

    const from = pending.from;
    const oldPrefix = rootPrefix(from);
    const newPrefix = rootPrefix();

    // 1. COPIA DE SEGURIDAD ANTES DE TOCAR NADA. Si esto falla, se aborta: no se
    //    transforma un almacén del que no se ha podido guardar copia.
    /** @type {Record<string, string>} */ const snapshot = {};
    for (const key of pending.keys) {
        const raw = storage.getRaw(key);
        if (raw.ok && raw.value !== null) snapshot[key] = raw.value;
    }
    const backupKey = `${BACKUP_KEY_PREFIX}${from}`;
    const backupWritten = storage.setRaw(backupKey, JSON.stringify({
        migratedAtISO: context.nowISO,
        fromVersion: from,
        toVersion: SCHEMA_VERSION,
        keys: snapshot
    }));
    if (!backupWritten.ok) return { ok: false, error: 'migrations.backupFailed' };

    // 2. Transformar y escribir bajo el prefijo nuevo.
    /** @type {string[]} */ const warnings = [];
    let keysMigrated = 0;
    for (const key of pending.keys) {
        const rest = key.slice(oldPrefix.length);       // `<perfil>.<colección>` o `profiles`
        const target = `${newPrefix}${rest}`;
        // Si ya existe en la versión nueva, NO se pisa: una migración a medias
        // que se repite no puede machacar lo que el usuario haya hecho después.
        const existing = storage.getRaw(target);
        if (existing.ok && existing.value !== null) continue;

        const raw = snapshot[key];
        if (raw === undefined) { warnings.push(key); continue; }

        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch {
            warnings.push(key);
            continue;
        }
        // El índice de perfiles (`tl.<v>.profiles`) no es una colección de
        // `COLLECTIONS`, pero SÍ lleva `schemaVersion` y `validateProfilesIndex`
        // lo exige igual. Copiarlo tal cual —que es lo que hacía la primera
        // versión de esto— dejaba `tl.6.profiles` con `schemaVersion: 5`, y
        // entonces `readIndex()` devolvía `profiles.indexCorrupt`, la aplicación
        // no encontraba ningún perfil y pintaba el estado de error. Todos los
        // datos migrados correctamente, y la app inservible. Solo se vio
        // abriéndola en el navegador; ningún test unitario lo tocaba.
        const collection = rest.includes('.') ? rest.slice(rest.indexOf('.') + 1) : null;
        let toWrite = raw;
        if (collection !== null) {
            const migrated = migrateValue(collection, parsed);
            if (!migrated.ok) { warnings.push(key); continue; }
            toWrite = JSON.stringify(migrated.value);
        } else if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            && typeof (/** @type {Record<string, unknown>} */ (parsed).schemaVersion) === 'number') {
            // El índice: no pasa por `STEPS` (no es una colección), pero su
            // número de versión sí tiene que subir.
            toWrite = JSON.stringify({ ...parsed, schemaVersion: SCHEMA_VERSION });
        }
        const written = storage.setRaw(target, toWrite);
        if (!written.ok) { warnings.push(key); continue; }
        keysMigrated += 1;
    }

    // Testigo, para que no se repita en cada arranque. Se escribe aunque haya
    // avisos: los que fallaron siguen intactos bajo el prefijo viejo y
    // reintentarlos en bucle no los arreglaría.
    storage.setRaw(`${DONE_KEY_PREFIX}${from}`, JSON.stringify({
        atISO: context.nowISO, toVersion: SCHEMA_VERSION, keysMigrated, warnings
    }));

    return { ok: true, value: { migrated: true, from, keysMigrated, warnings, backupKey } };
}

/**
 * Lee la copia de seguridad de una migración, para diagnóstico o rescate.
 * @param {number} fromVersion
 * @returns {unknown | null}
 */
export function readMigrationBackup(fromVersion) {
    const raw = storage.getRaw(`${BACKUP_KEY_PREFIX}${fromVersion}`);
    if (!raw.ok || raw.value === null) return null;
    try {
        return JSON.parse(raw.value);
    } catch {
        return null;
    }
}

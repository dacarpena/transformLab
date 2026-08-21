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
import { COLLECTIONS } from './schema.js';

/**
 * La migración de un valor vive en `migrate-value.js`, que es PURO. Se reexporta
 * desde aquí para que ningún llamante existente tenga que cambiar (M8-0).
 */
export { migrateValue } from './migrate-value.js';
// Y se importa además, porque `migrateStore` la usa.
import { migrateValue } from './migrate-value.js';
import { ensureTable, remapKeyRest, remapIndex, needsRemap, readTable } from './profile-remap.js';
import { relabel } from './photos-remap.js';


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
 * Testigo de migración **a medias por fallo de escritura**.
 *
 * Se escribe en vez del de «completada» cuando alguna clave no se pudo escribir
 * —cuota, almacén bloqueado—. Sin esta distinción, el testigo de completada se
 * escribía igual y esas claves no se reintentaban NUNCA: los datos se quedaban
 * bajo el prefijo viejo, invisibles, y `main.js` solo lo contaba en un
 * `console.info`.
 */
export const PENDING_KEY_PREFIX = 'tl.migrationPending.v';

/** Testigo de que las fotos ya llevan el id nuevo. */
export const PHOTOS_DONE_KEY = 'tl.migrationPhotosDone.v7';

/**
 * Los ids de perfil a remapear: la UNIÓN de los que aparecen en las claves y los
 * que menciona el índice.
 *
 * Hacen falta las dos fuentes, y cada una cubre un agujero de la otra:
 *
 * - **Solo las claves** dejaría fuera a un perfil inscrito en el índice pero sin
 *   ninguna clave —un `create()` interrumpido, un `clearProfile` a medias—.
 *   `remapIndex` lo dejaría con su `pN` y el índice acabaría mezclando ids
 *   opacos y `pN`: válido para el esquema, así que nadie se entera.
 * - **Solo el índice** dejaría fuera a un perfil cuyas claves existen pero que
 *   el índice no menciona, porque se corrompió. Sus datos se quedarían bajo un
 *   id que la versión nueva ya no mira.
 *
 * El índice se lee CRUDO: `validateProfilesIndex` lo rechazaría por tener la
 * `schemaVersion` vieja, que es justamente el estado en el que está.
 *
 * @param {readonly string[]} keys claves completas, con prefijo
 * @param {string} prefix
 * @returns {string[]}
 */
function perfilesDe(keys, prefix) {
    /** @type {Set<string>} */ const out = new Set();
    for (const key of keys) {
        const rest = key.slice(prefix.length);
        const punto = rest.indexOf('.');
        if (punto > 0) out.add(rest.slice(0, punto));
    }

    const indice = storage.getRaw(`${prefix}profiles`);
    if (indice.ok && indice.value !== null) {
        try {
            const parsed = JSON.parse(indice.value);
            if (parsed && typeof parsed === 'object') {
                if (Array.isArray(parsed.profiles)) {
                    for (const p of parsed.profiles) {
                        if (p && typeof p === 'object' && typeof p.id === 'string' && p.id !== '') out.add(p.id);
                    }
                }
                if (typeof parsed.activeProfileId === 'string' && parsed.activeProfileId !== '') {
                    out.add(parsed.activeProfileId);
                }
            }
        } catch {
            // Índice ilegible: los perfiles que salgan de las claves bastan, y
            // no se aborta por esto — el índice corrupto ya tiene su camino en
            // `readIndex`, que lo reporta sin sobrescribirlo.
        }
    }
    return [...out].sort();
}

/**
 * Cuánto va a ocupar lo copiado, aproximadamente.
 *
 * Es el tamaño de los valores otra vez, más un margen por clave para el prefijo
 * nuevo —que con ids opacos es MÁS LARGO que `p1`, unos 20 caracteres de más—.
 *
 * @param {Record<string, string>} snapshot
 * @returns {number}
 */
function estimarDestino(snapshot) {
    let total = 0;
    for (const [key, value] of Object.entries(snapshot)) {
        total += (key.length + 24 + value.length) * 2;
    }
    return total;
}

/**
 * ¿Hay datos de una versión anterior esperando a migrarse?
 * @returns {{ pending: boolean, from: number | null, keys: string[] }}
 */
export function needsMigration() {
    // DESCENDENTE: de la más nueva a la más vieja.
    //
    // Ascendente parece lo natural —«migra primero lo más viejo»— y pierde datos
    // en un caso concreto: un almacén con una migración 5→6 interrumpida (copia
    // hecha, testigo no) sobre el que además se siguió usando la v6. Ascendente
    // elige `from = 5`, copia `tl.5.` sobre unos destinos v7 vacíos, y **los
    // datos v6, que son los buenos, quedan huérfanos**: en el arranque siguiente
    // `from = 6` encuentra todo ocupado y lo salta. Descendente coge siempre los
    // datos más recientes, y converge igual para quien solo tiene `tl.5.`.
    for (const version of [...MIGRATABLE_FROM].sort((a, b) => b - a)) {
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
 * @property {string[]} warnings claves cuyo VALOR no se pudo interpretar; se
 *   dejan intactas y reintentarlas no las arreglaría
 * @property {string[]} [retryable] claves que no se pudieron ESCRIBIR (cuota):
 *   se reintentan en el arranque siguiente
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
 * ## El remapeo de ids (hacia la v7)
 *
 * El salto a la v7 no cambia ninguna forma de dato: cambia el **nombre** de las
 * claves, porque el id de perfil va dentro (`tl.6.p1.checkins` →
 * `tl.7.<opaco>.checkins`). La tabla que dice qué id va a cuál se persiste
 * ANTES de copiar la primera clave —los ids nuevos son aleatorios y no se
 * pueden recalcular— y la re-entrada la reutiliza. Ver `profile-remap.js`.
 *
 * La regla de si toca remapear la decide `needsRemap(from)`: por debajo de la v7
 * los ids son `pN`, de la v7 en adelante ya son opacos. Un salto futuro v7→v8 no
 * remapea, que sería regenerar ids que ya estaban bien.
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
    const serializado = JSON.stringify({
        migratedAtISO: context.nowISO,
        fromVersion: from,
        toVersion: SCHEMA_VERSION,
        keys: snapshot
    });

    // 1a. ¿CABE? Antes se escribía a ciegas y se descubría a mitad.
    //
    // Durante la migración conviven TRES copias —`tl.<from>.*`, la copia de
    // seguridad y `tl.<to>.*`— y el techo son ~5 MB. Si no cabe, se aborta
    // **sin haber escrito nada**, que es un estado del que se sale recargando;
    // quedarse sin sitio a media copia no lo es (ver el paso 3).
    //
    // Se mide con `usageBytes()` sin argumento, que suma todo lo que empieza por
    // `tl.`. El margen es generoso a propósito: `localStorage` cuenta caracteres
    // UTF-16 y ningún navegador dice cuánto le queda de verdad.
    const usado = storage.usageBytes();
    if (usado.ok) {
        const necesario = usado.value + (backupKey.length + serializado.length) * 2 + estimarDestino(snapshot);
        if (necesario > storage.QUOTA_LIMIT_BYTES * 0.95) {
            return { ok: false, error: 'migrations.quotaInsufficient' };
        }
    }

    // 1b. ESCRITURA ÚNICA. La copia de seguridad que vale es la del día en que
    //     los datos estaban enteros; reescribirla en cada re-entrada machacaría
    //     justo la que uno querría si algo hubiera salido mal.
    const backupPrevio = storage.getRaw(backupKey);
    if (!(backupPrevio.ok && backupPrevio.value !== null)) {
        const backupWritten = storage.setRaw(backupKey, serializado);
        if (!backupWritten.ok) return { ok: false, error: 'migrations.backupFailed' };
    }

    // 2. LA TABLA DE REMAPEO, antes de copiar una sola clave.
    //
    //    Va después de la copia de seguridad y antes de todo lo demás. Los ids
    //    nuevos son aleatorios: si el proceso muriera a mitad de la copia sin
    //    haberlos guardado, la re-entrada generaría otros y la mitad de las
    //    claves quedaría bajo un id que no usa nadie — los datos ahí, huérfanos
    //    e invisibles.
    /** @type {Record<string, string>} */ let remap = {};
    if (needsRemap(from)) {
        const perfiles = perfilesDe(pending.keys, oldPrefix);
        const tabla = ensureTable({ oldProfileIds: perfiles, nowISO: context.nowISO, from });
        // Si la tabla no se puede escribir o releer, se aborta SIN tocar nada:
        // copiar con destinos que no se han podido confirmar es exactamente cómo
        // se pierden datos.
        if (!tabla.ok) return { ok: false, error: tabla.error };
        remap = tabla.value.map;
    }

    // 3. Transformar y escribir bajo el prefijo nuevo.
    /** Datos que no se pudieron interpretar: reintentarlos no los arreglaría. */
    /** @type {string[]} */ const warnings = [];
    /** Fallos de ESCRITURA: se reintentan en el arranque siguiente. */
    /** @type {string[]} */ const transitorios = [];
    let keysMigrated = 0;
    for (const key of pending.keys) {
        const rest = key.slice(oldPrefix.length);       // `<perfil>.<colección>` o `profiles`
        const target = `${newPrefix}${remapKeyRest(rest, remap)}`;
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
        if (collection !== null && Object.hasOwn(COLLECTIONS, collection)) {
            const migrated = migrateValue(collection, parsed);
            if (!migrated.ok) { warnings.push(key); continue; }
            toWrite = JSON.stringify(migrated.value);
        } else if (collection !== null) {
            // UNA COLECCIÓN DESCONOCIDA SE COPIA TAL CUAL, y esto arregla un
            // defecto que llevaba desde el salto 5→6 perdiendo datos de TODOS
            // los usuarios en silencio.
            //
            // Las claves de interfaz llevan más de un punto —`p1.ui.activeView`—
            // así que `collection` sale valiendo `'ui.activeView'`, que no está
            // en `COLLECTIONS`. `migrateValue` recibía entonces la cadena
            // `"progress"`, devolvía `migrations.notAnObject` y la clave se
            // DESCARTABA. Reproducido antes de escribir esto: migrar con
            // `ui.activeView` y `ui.recalDeclinedFingerprint` presentes daba
            // `keysMigrated: 2` y las dos en `warnings`.
            //
            // Efecto para el usuario: la oferta de recalibrar que había
            // rechazado le volvía a saltar, y desde M8-5d perdía también
            // `ui.accountSeen` —o sea, la aplicación le ofrecía crear una cuenta
            // que ya tenía—.
            //
            // «Colección desconocida» y «valor corrupto» no pueden acabar igual.
            // Estas claves no llevan `schemaVersion` y no hay nada que migrar en
            // ellas: copiarlas verbatim es exactamente lo correcto.
            toWrite = raw;
        } else if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
            && typeof (/** @type {Record<string, unknown>} */ (parsed).schemaVersion) === 'number') {
            // El índice: no pasa por `STEPS` (no es una colección), pero su
            // número de versión sí tiene que subir — y desde la v7, también los
            // ids que lleva dentro.
            //
            // Reescribir las CLAVES sin tocar el índice es el fallo que se
            // olvida: los datos quedarían perfectamente copiados y la aplicación
            // no encontraría ningún perfil. Es literalmente lo que ya pasó con
            // `schemaVersion` en la migración 5→6, y solo se vio abriendo el
            // navegador.
            const conIds = remapIndex(parsed, remap);
            toWrite = JSON.stringify({ .../** @type {Record<string, unknown>} */ (conIds), schemaVersion: SCHEMA_VERSION });
        }
        const written = storage.setRaw(target, toWrite);
        if (!written.ok) {
            // TRANSITORIO, y hay que distinguirlo: `setRaw` falla por cuota o
            // por un almacén bloqueado, no porque el dato esté mal. Si esto se
            // mezclara con los avisos permanentes, el testigo se escribiría
            // igual y la clave **no se reintentaría jamás** — pérdida definitiva
            // y muda de una colección entera.
            transitorios.push(key);
            continue;
        }
        keysMigrated += 1;
    }

    // 4. ¿LLEGÓ EL ÍNDICE? Es la clave de la que depende todo lo demás.
    //
    // Sin ella, `readIndex()` devuelve un índice VACÍO —no un error— y `main.js`
    // crea un perfil nuevo y lanza el onboarding **sobre los datos intactos e
    // invisibles del usuario**. Es el peor desenlace posible de esta función, y
    // no se puede dejar que lo decida un `warnings` que nadie mira.
    const indiceDestino = storage.getRaw(`${newPrefix}profiles`);
    const habiaIndice = pending.keys.some((k) => k === `${oldPrefix}profiles`);
    if (habiaIndice && !(indiceDestino.ok && indiceDestino.value !== null)) {
        return { ok: false, error: 'migrations.indexMissing' };
    }

    // 5. Testigo. Se escribe con los avisos PERMANENTES —esos datos no se
    // arreglan reintentando— pero NO si quedaron fallos de escritura: ésos
    // vuelven a intentarse en el arranque siguiente, y el candado de «no pisar
    // un destino existente» hace que sea seguro.
    if (transitorios.length > 0) {
        storage.setRaw(`${PENDING_KEY_PREFIX}${from}`, JSON.stringify({
            atISO: context.nowISO, toVersion: SCHEMA_VERSION, keys: transitorios
        }));
    } else {
        storage.removeRaw(`${PENDING_KEY_PREFIX}${from}`);
        storage.setRaw(`${DONE_KEY_PREFIX}${from}`, JSON.stringify({
            atISO: context.nowISO,
            toVersion: SCHEMA_VERSION,
            keysMigrated,
            warnings,
            // Las claves de origen, para poder comparar más tarde: si aparecen
            // claves nuevas bajo el prefijo viejo, es que una pestaña abierta
            // desde antes de la migración sigue escribiendo ahí.
            sourceKeys: pending.keys
        }));
    }

    return {
        ok: true,
        value: { migrated: true, from, keysMigrated, warnings, retryable: transitorios, backupKey }
    };
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


/**
 * La migración COMPLETA: claves y fotos, en el orden seguro (M9-1).
 *
 * Es lo que llama el arranque. `migrateStore` sigue existiendo y sigue siendo
 * síncrona —es la parte de `localStorage`— pero por sí sola deja las fotos
 * atrás, y las fotos están en IndexedDB, que es asíncrono.
 *
 * ## El orden, y por qué es ése
 *
 * ```
 *   1. copia de seguridad     (dentro de migrateStore, escritura única)
 *   2. tabla de remapeo       (dentro de migrateStore, y se REUTILIZA)
 *   3. FOTOS                  ← antes que las claves
 *   4. claves + testigo       (el resto de migrateStore)
 * ```
 *
 * Las fotos van **antes**. Si fueran después y fallaran, la aplicación ya
 * habría arrancado en la versión nueva con los metadatos migrados y los blobs
 * bajo el id viejo: la galería se acortaría sin decir nada. Yendo antes, un
 * fallo deja al usuario en la versión anterior, con todo a la vista, y el
 * arranque siguiente vuelve a intentarlo.
 *
 * Para poder mover las fotos hace falta la tabla, y para escribir la tabla hace
 * falta saber de qué versión se viene: por eso el paso 3 va en medio y no al
 * principio. `ensureTable` es idempotente y `migrateStore` la reutiliza, así que
 * la primera llamada solo prepara y la segunda copia.
 *
 * @param {{ nowISO: string }} context
 * @returns {Promise<{ ok: true, value: MigrationReport & { photos: * } } | { ok: false, error: string }>}
 */
export async function run(context) {
    const pending = needsMigration();

    // Sin nada que migrar, todavía puede quedar la fase de fotos a medias de un
    // arranque anterior que se cortó. Es idempotente y barata: se comprueba.
    if (!pending.pending || pending.from === null) {
        const fotos = await migrarFotosSiHaceFalta(context.nowISO);
        return { ok: true, value: { migrated: false, from: null, keysMigrated: 0, warnings: [], photos: fotos } };
    }

    // 1 y 2 · copia de seguridad y tabla. Se hace con una pasada de
    // `migrateStore` sobre un almacén que ya tiene todos los destinos ocupados?
    // No: se llama a `ensureTable` directamente para no copiar nada todavía.
    const preparada = prepararTabla(pending, context);
    if (!preparada.ok) return preparada;

    // 3 · fotos, con la tabla ya fijada.
    const fotos = await migrarFotosSiHaceFalta(context.nowISO);

    // 4 · claves y testigo.
    const migrado = migrateStore(context);
    if (!migrado.ok) return migrado;

    return { ok: true, value: { ...migrado.value, photos: fotos } };
}

/**
 * Escribe la tabla de remapeo sin copiar ninguna clave, para que la fase de
 * fotos pueda correr antes que la de claves.
 *
 * @param {{ from: number | null, keys: string[] }} pending
 * @param {{ nowISO: string }} context
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function prepararTabla(pending, context) {
    if (pending.from === null || !needsRemap(pending.from)) return { ok: true };
    const perfiles = perfilesDe(pending.keys, rootPrefix(pending.from));
    const tabla = ensureTable({ oldProfileIds: perfiles, nowISO: context.nowISO, from: pending.from });
    if (!tabla.ok) return { ok: false, error: tabla.error };
    return { ok: true };
}

/**
 * La fase de fotos, idempotente y con su propio testigo.
 *
 * Testigo propio y no el de la migración porque son dos almacenes distintos que
 * pueden fallar por separado: las claves pueden estar migradas y las fotos no.
 *
 * El instante se INYECTA, como en todo `src/data/`: la capa de datos no lee el
 * reloj, para que sea comprobable.
 *
 * @param {string} nowISO
 * @returns {Promise<{ done: boolean, moved: number, skipped: boolean, errors: string[] }>}
 */
async function migrarFotosSiHaceFalta(nowISO) {
    const hecho = storage.getRaw(PHOTOS_DONE_KEY);
    if (hecho.ok && hecho.value !== null) {
        return { done: true, moved: 0, skipped: false, errors: [] };
    }
    const tabla = readTable();
    if (!tabla) return { done: true, moved: 0, skipped: false, errors: [] };

    const report = await relabel(tabla.map);
    // El testigo solo si NO queda ninguna foto con el id viejo. Escribirlo con
    // fotos pendientes las condenaría: nadie volvería a por ellas.
    if (report.done) {
        storage.setRaw(PHOTOS_DONE_KEY, JSON.stringify({
            atISO: nowISO,
            moved: report.moved,
            skipped: report.skipped
        }));
    }
    return { done: report.done, moved: report.moved, skipped: report.skipped, errors: report.errors };
}

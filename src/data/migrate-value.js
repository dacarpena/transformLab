// @ts-check

/**
 * La migración PURA de un valor de colección (M8-0).
 *
 * Extraído de `migrations.js` para romper una cadena de imports concreta:
 * `schema.js` importa `migrateValue`, `migrations.js` importa `storage.js`, y
 * `storage.js` tiene `let activeProfileId` y `let revisionCounter` a nivel de
 * MÓDULO. Eso no molesta en el navegador —hay un solo usuario por pestaña—, pero
 * el servidor va a reutilizar `schema.js` para validar lo que llega, y en un
 * Worker el estado de módulo se comparte entre peticiones del mismo aislado. Un
 * `activeProfileId` compartido entre dos usuarios es la clase de fuga que no se
 * ve venir.
 *
 * Aquí no hay más dependencia que `version.js`, que son dos constantes. El
 * módulo es importable desde Node, desde el navegador y desde un Worker sin
 * arrastrar nada.
 *
 * `migrations.js` lo reexporta, así que ningún llamante existente cambia.
 */

import { SCHEMA_VERSION, MIGRATABLE_FROM } from './version.js';

/**
 * @typedef {(value: Record<string, unknown>) => Record<string, unknown>} StepFn
 */

/**
 * Transformaciones por versión de origen y colección.
 *
 * `STEPS[5].checkins` es «cómo se convierte una colección `checkins` de la v5 en
 * una de la v6». Lo que no aparece usa el paso por defecto (identidad + subir el
 * número), que es el caso de TODO el salto 5→6: la v2 no cambia la forma de
 * ninguna colección existente, solo añade colecciones nuevas que en la v5 no
 * existían. La maquinaria está aquí para el día que sí cambie una forma — y ese
 * día no habrá que inventarla con los datos de alguien en juego.
 * @type {Record<number, Record<string, StepFn>>}
 */
const STEPS = {
    5: {
        // Sin cambios de forma en el salto 5→6.
    }
};

/**
 * Migra un valor de una colección hasta la versión vigente. PURA.
 *
 * @param {string} collection
 * @param {unknown} value
 * @returns {{ ok: true, value: Record<string, unknown>, from: number, migrated: boolean }
 *          | { ok: false, error: string }}
 */
export function migrateValue(collection, value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return { ok: false, error: 'migrations.notAnObject' };
    }
    const record = /** @type {Record<string, unknown>} */ ({ ...value });
    const found = record.schemaVersion;
    if (typeof found !== 'number' || !Number.isInteger(found)) {
        return { ok: false, error: 'migrations.versionMissing' };
    }
    if (found === SCHEMA_VERSION) {
        return { ok: true, value: record, from: found, migrated: false };
    }
    if (found > SCHEMA_VERSION) {
        // Datos de una versión FUTURA: los escribió una versión más nueva de la
        // aplicación (otra pestaña actualizada, un backup de mañana). Migrar
        // hacia atrás es adivinar, así que se rechaza en vez de destruir.
        return { ok: false, error: 'migrations.fromTheFuture' };
    }
    if (!MIGRATABLE_FROM.includes(found)) {
        return { ok: false, error: 'migrations.versionUnsupported' };
    }

    let current = record;
    let version = found;
    while (version < SCHEMA_VERSION) {
        const step = STEPS[version]?.[collection];
        current = step ? { ...step(current) } : current;
        version += 1;
        current.schemaVersion = version;
    }
    return { ok: true, value: current, from: found, migrated: true };
}

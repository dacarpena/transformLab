// @ts-check

/**
 * La versión del esquema, en UN solo sitio (V2-M0).
 *
 * Antes vivía duplicada en `schema.js:19` y `storage.js:17`. Dos constantes que
 * significan lo mismo y que nadie ata es una bomba de relojería: el día que una
 * suba y la otra no, `storage` escribe en `tl.6.…` mientras `schema` valida
 * contra 5, o al revés. `test/data-migrations.test.js` comprueba que no vuelven
 * a existir dos definiciones.
 *
 * POR QUÉ LA VERSIÓN ESTÁ EN LA CLAVE, y qué cuesta. El namespace del almacén
 * es `tl.<schemaVersion>.<profileId>.<colección>` (CLAUDE.md §3), así que subir
 * la versión **orfana todas las claves existentes**: la aplicación empieza a
 * mirar `tl.6.p1.checkins` y los datos del usuario siguen en `tl.5.p1.checkins`,
 * intactos e invisibles. Eso no es un detalle: reproducido antes de escribir
 * esto, el perfil dejaba de validar, arrancaba el onboarding y al completarlo
 * SOBRESCRIBÍA el perfil del usuario. Un año de check-ins convertido en bytes
 * huérfanos.
 *
 * Por eso existe `migrations.js`: mover las claves de una versión a la
 * siguiente, con copia de seguridad previa, es obligatorio en cada bump. El
 * esquema de clave se mantiene (decisión del plan de la v2, §6) a cambio de que
 * el migrador sea maquinaria de primera clase y no un apaño por versión.
 */

/** Versión de esquema vigente. La única. */
export const SCHEMA_VERSION = 6;

/**
 * Versiones anteriores desde las que sabemos migrar, de la más vieja a la más
 * nueva. No incluye la vigente.
 * @type {readonly number[]}
 */
export const MIGRATABLE_FROM = Object.freeze([5]);

/**
 * Prefijo de las claves de una versión dada.
 * @param {number} [version]
 * @returns {string}
 */
export function rootPrefix(version = SCHEMA_VERSION) {
    return `tl.${version}.`;
}

// @ts-check

/**
 * Duplicados que crea iCloud al sincronizar `~/Documents`: «nombre 2.js»,
 * «tokens 3.css»… El `.gitignore` los ignora (regla `*\ [0-9].*`), pero los
 * tests que recorren el ÁRBOL DE FICHEROS con `readdirSync` —no el índice de
 * git— los ven igual, y un fichero fantasma pone la suite en rojo con un fallo
 * que no existe. Lo verificó la sonda de readiness de la v2, y ya me había
 * mordido antes (está en la memoria del proyecto). Este predicado es la aduana.
 *
 * @param {string} name nombre de fichero (sin ruta)
 * @returns {boolean}
 */
export function isICloudDuplicate(name) {
    // « 2.js», « 10.css»: espacio + dígitos + extensión al final.
    return / \d+\.[A-Za-z0-9]+$/.test(name);
}

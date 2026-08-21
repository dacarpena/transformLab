// @ts-check

/**
 * Silencia el aviso de que `node:sqlite` es experimental — ése y solo ése.
 *
 * Tiene que ser un MÓDULO APARTE, y ésa es toda la gracia: Node emite el aviso
 * al **cargar** `node:sqlite`, y en ESM los imports se evalúan antes que el
 * cuerpo del módulo que los declara. Poner este filtro dentro de `d1-fake.js`
 * llega tarde por construcción; importarlo en la línea de encima de
 * `node:sqlite` llega a tiempo.
 *
 * Se filtra por texto exacto y se delega todo lo demás. La alternativa,
 * `--no-warnings` en el script de test, apagaría también los avisos de obsolescencia
 * y los de fugas de manejadores, que sí hay que ver.
 */

const original = process.emitWarning;

/** @type {*} */ (process).emitWarning = (/** @type {*} */ aviso, /** @type {*[]} */ ...resto) => {
    if (String(aviso).includes('SQLite is an experimental feature')) return;
    return original.call(process, aviso, ...resto);
};

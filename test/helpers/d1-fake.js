// @ts-check

/**
 * Un D1 de mentira sobre `node:sqlite`, para probar el servidor sin nube (M8-2).
 *
 * ## Qué es y qué no
 *
 * **Aplica el `migrations/0001_init.sql` DE VERDAD y ejecuta las cadenas SQL DE
 * VERDAD.** No hay un esquema paralelo escrito para los tests, que es la forma
 * habitual de que una suite entera pase mientras producción falla: aquí un
 * `NOT NULL` que falte en la migración se ve en el test, y una columna
 * renombrada rompe las consultas que la nombran.
 *
 * Lo que no cubre: el aislamiento y la latencia reales de D1, y el
 * comportamiento de `batch` bajo concurrencia. Eso solo lo dice el servicio, y
 * se comprueba a mano.
 *
 * ## Es MÁS ESTRICTO que D1, nunca más laxo
 *
 * Es la única regla que importa en un doble de pruebas. Un doble permisivo deja
 * pasar código que producción rechaza, y el fallo aparece con usuarios delante.
 * Aquí:
 *
 * - `undefined` en un `bind` **lanza**, como en D1. Es el error más frecuente al
 *   escribir consultas —un campo opcional que nadie normalizó a `null`— y en un
 *   doble permisivo se convertiría en un `NULL` silencioso.
 * - Las claves foráneas se **aplican** (`node:sqlite` las trae activadas), así
 *   que el `ON DELETE CASCADE` del borrado de cuenta se prueba de verdad.
 * - Los `BLOB` solo aceptan bytes: pasar una cadena donde va un hash lanza en
 *   vez de guardarse como texto. `STRICT` en el DDL lo hace por nosotros.
 * - Las filas se normalizan a objetos NORMALES. `node:sqlite` las devuelve con
 *   prototipo nulo, y eso hace que `deepEqual` pase con objetos que en
 *   producción no se comportarían igual.
 */

import './quiet-sqlite.js';
// Import DINÁMICO, y no por capricho: en ESM el grafo se enlaza entero —los
// built-ins incluidos— antes de que se ejecute el cuerpo de ningún módulo, así
// que un `import` estático de `node:sqlite` emite su aviso de «experimental»
// antes de que `quiet-sqlite.js` haya podido instalar el filtro. Con `await
// import` la carga ocurre después, que es cuando el filtro ya está puesto.
const { DatabaseSync } = await import('node:sqlite');
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const MIGRATIONS = fileURLToPath(new URL('../../migrations/', import.meta.url));

/**
 * Crea una base en memoria con TODAS las migraciones del repositorio aplicadas
 * en orden.
 *
 * Se leen del directorio en vez de nombrarlas: así una migración nueva entra en
 * los tests sola, y no hay forma de añadir una y olvidarse de aplicarla aquí
 * —que es exactamente el fallo que este helper existe para hacer imposible—.
 *
 * @returns {{ db: *, sqlite: DatabaseSync, close: () => void, migraciones: string[] }}
 *   `db` cumple la interfaz de `D1Database`.
 */
export function createD1() {
    const sqlite = new DatabaseSync(':memory:');
    const migraciones = readdirSync(MIGRATIONS).filter((n) => n.endsWith('.sql')).sort();
    if (migraciones.length === 0) throw new Error('no hay migraciones en migrations/');
    for (const nombre of migraciones) {
        sqlite.exec(readFileSync(join(MIGRATIONS, nombre), 'utf8'));
    }
    return { db: wrap(sqlite), sqlite, close: () => sqlite.close(), migraciones };
}

/**
 * Envuelve una base de `node:sqlite` con la interfaz de D1.
 * @param {*} sqlite
 */
function wrap(sqlite) {
    return {
        /** @param {string} query */
        prepare(query) {
            return statement(sqlite, query, []);
        },
        /** @param {*[]} statements */
        async batch(statements) {
            // D1 corre un `batch` en una transacción: o entran todas o ninguna.
            // Sin esto, un test podría dejar la base a medias y el siguiente
            // fallaría por una razón que no es la suya.
            sqlite.exec('BEGIN');
            try {
                const out = [];
                for (const s of statements) out.push(await s.all());
                sqlite.exec('COMMIT');
                return out;
            } catch (error) {
                sqlite.exec('ROLLBACK');
                throw error;
            }
        }
    };
}

/**
 * @param {*} sqlite
 * @param {string} query
 * @param {unknown[]} valores
 */
function statement(sqlite, query, valores) {
    const preparar = () => {
        const s = sqlite.prepare(query);
        return { s, args: valores.map(aSqlite) };
    };

    return {
        /** @param {unknown[]} nuevos */
        bind(...nuevos) {
            // D1 devuelve una sentencia NUEVA: `bind` no muta. Copiarlo importa,
            // porque el código que reusa una sentencia preparada con distintos
            // valores se comporta distinto si muta.
            return statement(sqlite, query, nuevos);
        },

        /** @param {string} [colName] */
        async first(colName) {
            const { s, args } = preparar();
            const fila = /** @type {*} */ (s.get(.../** @type {*} */ (args)));
            if (fila === undefined) return null;
            const normal = normalizar(fila);
            if (colName === undefined) return normal;
            // D1 devuelve `null` —no `undefined`— si la columna no está.
            return normal[colName] ?? null;
        },

        async run() {
            const { s, args } = preparar();
            const r = s.run(.../** @type {*} */ (args));
            return {
                results: [],
                success: true,
                meta: {
                    changes: r.changes,
                    last_row_id: Number(r.lastInsertRowid),
                    // D1 los informa de verdad; aquí no hay forma de saberlos y
                    // se declaran a cero en vez de inventarlos. Ningún test debe
                    // afirmar sobre ellos, y por eso son -1 en `all()` también.
                    rows_read: 0,
                    rows_written: r.changes
                }
            };
        },

        async all() {
            const { s, args } = preparar();
            // `all` sobre un INSERT/UPDATE también funciona en D1 y devuelve
            // `results: []`. `node:sqlite` hace lo mismo con `.all()`.
            const filas = /** @type {*[]} */ (s.all(.../** @type {*} */ (args)));
            return {
                results: filas.map(normalizar),
                success: true,
                meta: { changes: 0, last_row_id: 0, rows_read: filas.length, rows_written: 0 }
            };
        }
    };
}

/**
 * Traduce un valor de JavaScript a lo que `node:sqlite` acepta.
 *
 * @param {unknown} v
 * @param {number} i
 */
function aSqlite(v, i) {
    if (v === undefined) {
        // D1 lanza igual. Es el error más frecuente al escribir una consulta —un
        // campo opcional que nadie normalizó a `null`— y dejarlo pasar como NULL
        // silencioso es lo peor que puede hacer un doble de pruebas.
        throw new TypeError(`D1: el parámetro ${i + 1} es undefined; usa null si el valor puede faltar`);
    }
    // D1 acepta `ArrayBuffer` para los BLOB; `node:sqlite` quiere una vista.
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    if (typeof v === 'boolean') {
        // SQLite no tiene booleanos y D1 tampoco los acepta: mejor un error aquí
        // que un `1` que nadie sabe leer tres meses después.
        throw new TypeError(`D1: el parámetro ${i + 1} es un booleano; guarda 0 o 1 explícitamente`);
    }
    return /** @type {*} */ (v);
}

/**
 * Fila con prototipo normal. `node:sqlite` las devuelve con prototipo nulo, y
 * entonces `{...fila}`, `deepEqual` y `instanceof` no se comportan como con lo
 * que devuelve D1.
 *
 * @param {Record<string, unknown>} fila
 */
function normalizar(fila) {
    return Object.assign({}, fila);
}

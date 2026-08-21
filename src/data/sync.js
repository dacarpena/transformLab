// @ts-check

/**
 * La sincronización, desde el cliente (M9-3 el pull, M9-4 el push).
 *
 * ## La regla que lo gobierna todo: una edición local nunca se pierde en silencio
 *
 * M9-3 la cumplía de la forma más burda posible —no pisar nada jamás—, y eso
 * dejaba la sincronía a medias: el borrado de un dispositivo no llegaba al otro
 * y las dos copias divergían para siempre. Aquí se cumple de verdad, y hace
 * falta una pieza más para conseguirlo: **la sombra**.
 *
 * La sombra guarda, por fila, la huella de cómo estaba la última vez que este
 * dispositivo habló con el servidor. Con eso se distinguen las dos cosas que
 * antes se confundían:
 *
 * - **La fila local no ha cambiado desde entonces** → lo que llega es más nuevo
 *   y entra, borrado incluido. No se pierde nada: lo local era una copia vieja.
 * - **La fila local SÍ ha cambiado** → los dos han editado sin verse. Se fusiona
 *   con `mergeRow`, y si lo que llega es una lápida, **gana la edición viva**:
 *   el push siguiente resucita la fila. Resucitar un dato es un fallo que se ve
 *   y se corrige; perderlo, no.
 *
 * La convergencia sale de guardar en la sombra la huella de **la fila remota**,
 * no la de la fusión. Así lo local difiere de la sombra, el push sube la fusión,
 * y el otro dispositivo —que no ha tocado nada desde que subió— la acepta por la
 * primera regla. Dos vueltas y los dos tienen lo mismo.
 *
 * ## Qué gana un conflicto en el servidor, y qué pasa con el perdedor
 *
 * Gana quien escribe, con el reloj del SERVIDOR: es el único que las dos partes
 * comparten. Pero el perdedor **se archiva** en `record_conflicts` antes de que
 * lo pisen, así que una versión que pierde sigue estando y se puede enseñar.
 *
 * ## El cursor y la sombra son de ESTE dispositivo
 *
 * Los dos viven fuera del namespace de perfil, con el id de cuenta dentro: el
 * pull trae filas de todos los perfiles a la vez, así que un cursor por perfil
 * no significaría nada. Y no se sincronizan: son la memoria de esta máquina
 * sobre lo que ya ha visto.
 *
 * ## Lo que este módulo NO hace
 *
 * Fotos (M9-5) ni decidir cuándo sincronizar: eso lo lleva quien llame. Y no
 * toca `storage.js` más que por sus funciones públicas — la capa de datos sigue
 * siendo síncrona y ninguno de sus 125 llamantes se entera de que hay una red.
 */

import { request } from './api.js';
import * as storage from './storage.js';
import * as profiles from './profiles.js';
import * as keysDb from './keys-db.js';
import { decryptBytes, encryptBytes, itemTag } from './crypto.js';
import { isReservedProfileId } from './ids.js';
import { validateCollection, COLLECTIONS } from './schema.js';
import {
    split, join, mergeRow, collections as syncCollections, scopeOf
} from './sync-policy.js';

/* == Donde vive la memoria de este dispositivo ============================== */

/**
 * El cursor: hasta qué `seq` se ha leído.
 * @param {string} userId
 */
export const cursorKey = (userId) => `tl.sync.cursor.${userId}`;

/**
 * La sombra: cómo estaba cada fila la última vez que se habló con el servidor.
 * @param {string} userId
 */
export const shadowKey = (userId) => `tl.sync.shadow.${userId}`;

/**
 * La marca de «aquí había una lápida» en la sombra.
 *
 * No puede confundirse con una huella: las huellas son once caracteres de
 * base64url y esto es uno solo, que además no está en ese alfabeto.
 */
const TOMB = '~';

/**
 * @typedef {{ v: number, e: Record<string, [string, number]> }} Shadow
 *   `e` va de la clave de sombra a `[huella, revisión]`.
 */

/**
 * El separador de la clave de sombra: el carácter de control 0x1F.
 *
 * Imposible dentro de sus tres partes —dos son base64url y la otra un nombre de
 * colección—, y ese es todo el requisito: un separador que pudiera aparecer
 * dentro haría que dos filas distintas compartieran entrada, y la sombra es
 * quien decide qué se borra.
 */
const SEP = String.fromCharCode(0x1f);

/** @returns {string} */
const claveSombra = (/** @type {string} */ profileId, /** @type {string} */ collection,
                     /** @type {string} */ tag) => `${profileId}${SEP}${collection}${SEP}${tag}`;

/**
 * La sombra guardada, o una vacía.
 *
 * Una sombra corrupta se trata como vacía, y eso es seguro por construcción: sin
 * sombra, el pull no pisa nada —no puede afirmar que lo local esté sin tocar— y
 * el push no emite ninguna lápida, porque no recuerda que existiera nada.
 * Degradar hacia «no destruyas» es la única degradación aceptable aquí.
 *
 * @param {string} userId
 * @returns {Shadow}
 */
export function readShadow(userId) {
    const raw = storage.getRaw(shadowKey(userId));
    if (!raw.ok || raw.value === null) return { v: 1, e: {} };
    try {
        const v = JSON.parse(raw.value);
        if (v === null || typeof v !== 'object' || v.v !== 1
            || v.e === null || typeof v.e !== 'object') {
            return { v: 1, e: {} };
        }
        return { v: 1, e: v.e };
    } catch {
        return { v: 1, e: {} };
    }
}

/**
 * @param {string} userId
 * @param {Shadow} sombra
 * @returns {boolean} `false` si no se pudo guardar
 */
function writeShadow(userId, sombra) {
    return storage.setRaw(shadowKey(userId), JSON.stringify(sombra)).ok;
}

/**
 * El cursor guardado, o 0.
 * @param {string} userId
 * @returns {number}
 */
export function readCursor(userId) {
    const raw = storage.getRaw(cursorKey(userId));
    if (!raw.ok || raw.value === null) return 0;
    const n = Number(raw.value);
    // Un cursor corrupto se trata como 0: volver a bajarlo todo es lento, pero
    // saltarse filas es perder datos.
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

/* == La huella de una fila ================================================== */

/**
 * Ocho bytes de SHA-256 sobre la fila, en base64url.
 *
 * Ocho y no treinta y dos porque la sombra se guarda en `localStorage` y hay que
 * pagarla: con dos mil check-ins son 84 KB en vez de 250. Y bastan, porque la
 * pregunta no es «de dos mil filas, ¿colisiona alguna pareja?» sino «¿esta fila
 * concreta cambió y dio los mismos 64 bits?».
 *
 * El JSON se genera con las claves ORDENADAS. Sin eso, dos dispositivos que
 * construyeran el mismo objeto en distinto orden darían huellas distintas y se
 * mandarían la fila el uno al otro para siempre.
 *
 * @param {string[]} keyPath
 * @param {unknown} value
 * @returns {Promise<string>}
 */
async function huella(keyPath, value) {
    const texto = estable([keyPath, value]);
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto)));
    return aB64u(d.subarray(0, 8));
}

/**
 * `JSON.stringify` con las claves de todo objeto en orden.
 * @param {unknown} v
 * @returns {string}
 */
function estable(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
    if (Array.isArray(v)) return `[${v.map(estable).join(',')}]`;
    const claves = Object.keys(v).sort();
    return `{${claves.map((k) => `${JSON.stringify(k)}:${estable(/** @type {*} */ (v)[k])}`).join(',')}}`;
}

/* == El pull ================================================================ */

/**
 * @typedef {Object} PullReport
 * @property {boolean} ok
 * @property {string} [error]
 * @property {number} fetched filas traídas
 * @property {number} applied filas nuevas o actualizadas desde el servidor
 * @property {number} removed filas borradas aquí por una lápida ajena
 * @property {number} merged filas editadas en los dos sitios y fusionadas
 * @property {number} kept filas locales que ganaron a una lápida ajena
 * @property {number} undecryptable filas que no se pudieron abrir
 * @property {number} adopted perfiles que este dispositivo no conocía y ha
 *   inscrito en su índice
 * @property {number} cursor el cursor tras el pull
 * @property {boolean} hasMore si el servidor tiene más
 */

/** Páginas por llamada. Un tope, para que un pull no se eternice en un móvil. */
const MAX_PAGES = 25;

/**
 * Se trae lo que haya cambiado y lo aplica en local.
 *
 * @param {string} userId
 * @returns {Promise<PullReport>}
 */
export async function pull(userId) {
    /** @type {PullReport} */
    const report = {
        ok: false, fetched: 0, applied: 0, removed: 0, merged: 0, kept: 0,
        undecryptable: 0, adopted: 0, cursor: readCursor(userId), hasMore: false
    };

    const llaves = await abrirLlaves(userId);
    // Sin las claves no se puede abrir nada. No es un error: es el estado de un
    // dispositivo que ha iniciado sesión y todavía no ha desbloqueado.
    if (!llaves) return { ...report, error: 'sync.locked' };

    const sombra = readShadow(userId);

    for (let pagina = 0; pagina < MAX_PAGES; pagina++) {
        const r = await request(`/api/sync?since=${report.cursor}`);
        if (!r.ok) return { ...report, error: r.error };

        const datos = /** @type {*} */ (r.value);
        const filas = Array.isArray(datos?.rows) ? datos.rows : [];
        report.fetched += filas.length;
        report.hasMore = Boolean(datos?.hasMore);

        let falloAlEscribir = false;
        if (filas.length > 0) {
            const aplicado = await aplicar(llaves, filas, sombra);
            report.applied += aplicado.applied;
            report.removed += aplicado.removed;
            report.merged += aplicado.merged;
            report.kept += aplicado.kept;
            report.undecryptable += aplicado.undecryptable;
            falloAlEscribir = aplicado.failed > 0;

            // Los perfiles que han llegado se inscriben en el índice local. Sin
            // esto, un dispositivo nuevo se descarga la cuenta entera y no
            // enseña nada: los datos están y ninguna vista sabe que existen.
            report.adopted += inscribirPerfiles(aplicado.perfiles);
        }

        // La sombra se guarda ANTES que el cursor, y no al revés. Si se pierde
        // la sombra, el pull siguiente se vuelve conservador —no pisa nada— y el
        // push no borra nada; si se pierde el cursor, se repite la página, que
        // es idempotente. Las dos degradaciones son inofensivas. Al revés
        // quedaría un cursor por delante de una sombra que no sabe qué entró, y
        // esa sí destruye: el push leería lápidas donde hay datos.
        if (!writeShadow(userId, sombra)) falloAlEscribir = true;

        // EL CURSOR SOLO AVANZA SI TODO SE ESCRIBIÓ.
        //
        // No basta con guardarlo «después»: la primera versión de esto lo movía
        // igual cuando la escritura fallaba por cuota, y esas filas no se
        // volvían a pedir NUNCA — pérdida definitiva y muda. Lo cazó el test que
        // llena el almacén a mitad del pull.
        if (falloAlEscribir) return { ...report, ok: false, error: 'sync.writeFailed' };

        const siguiente = Number(datos?.nextSince);
        if (Number.isSafeInteger(siguiente) && siguiente > report.cursor) {
            report.cursor = siguiente;
            storage.setRaw(cursorKey(userId), String(siguiente));
        }

        if (!report.hasMore) break;
    }

    return { ...report, ok: true };
}

/**
 * Aplica un lote de filas remotas, resolviendo con la sombra.
 *
 * Muta `sombra` a medida que decide; quien llama la persiste.
 *
 * @param {Llaves} llaves
 * @param {readonly *[]} filas
 * @param {Shadow} sombra
 */
async function aplicar(llaves, filas, sombra) {
    let applied = 0, removed = 0, merged = 0, kept = 0, undecryptable = 0, failed = 0;
    /** @type {Set<string>} */ const perfiles = new Set();

    // Se agrupa por (perfil, colección) porque `join` recompone una colección
    // entera: aplicar fila a fila obligaría a leer y escribir el almacén una vez
    // por item.
    /** @type {Map<string, *[]>} */ const grupos = new Map();
    for (const fila of filas) {
        if (!esFilaUsable(fila)) continue;
        const clave = `${fila.profileId} ${fila.collection}`;
        const lista = grupos.get(clave);
        if (lista) lista.push(fila); else grupos.set(clave, [fila]);
    }

    for (const [clave, delGrupo] of grupos) {
        const [profileId, collection] = clave.split(' ');

        const actual = storage.getForProfile(profileId, collection);
        // Un almacén ilegible NO es una colección vacía. Tratarlo como vacía
        // metería todo lo remoto como nuevo encima de datos que sí están ahí y
        // que solo no se pudieron leer.
        if (!actual.ok) { failed += delGrupo.length; continue; }

        const partidoLocal = actual.value !== null ? split(collection, actual.value) : null;
        if (partidoLocal !== null && !partidoLocal.ok) { failed += delGrupo.length; continue; }
        const filasLocales = partidoLocal !== null ? partidoLocal.rows : partesLocalesPorDefecto(collection);

        // El orden se conserva: `join` reconstruye por ordinal, y reordenar aquí
        // movería de sitio listas que el usuario ya ha visto.
        /** @type {string[]} */ const orden = [];
        /** @type {Map<string, *>} */ const porClave = new Map();
        /** @type {Map<string, string>} */ const clavePorTag = new Map();
        for (const f of filasLocales) {
            const k = JSON.stringify(f.keyPath);
            orden.push(k);
            porClave.set(k, f);
            if (f.scope === 'sync') {
                clavePorTag.set(aB64u(await itemTag(llaves.index, collection, f.keyPath)), k);
            }
        }

        let cambios = 0;
        for (const remota of delGrupo) {
            const claveS = claveSombra(profileId, collection, remota.itemTag);
            const previa = sombra.e[claveS];
            const claveLocal = clavePorTag.get(remota.itemTag);

            if (remota.deleted) {
                if (claveLocal === undefined) {
                    // No está aquí: nada que borrar. Se quita de la sombra para
                    // que el push no la resucite con una lápida propia.
                    delete sombra.e[claveS];
                    continue;
                }
                const local = porClave.get(claveLocal);
                const hLocal = await huella(local.keyPath, local.value);
                if (previa && previa[0] === hLocal) {
                    // Sin tocar desde la última sincronía: el borrado manda.
                    porClave.delete(claveLocal);
                    delete sombra.e[claveS];
                    removed += 1; cambios += 1;
                } else {
                    // Editada aquí. UNA EDICIÓN VIVA GANA A UN BORRADO. El push
                    // siguiente la resucita, y resucitar se ve; perder, no.
                    sombra.e[claveS] = [TOMB, remota.rev];
                    kept += 1;
                }
                continue;
            }

            const abierta = await abrir(llaves, collection, remota);
            if (!abierta) { undecryptable += 1; continue; }

            const hRemota = await huella(abierta.keyPath, abierta.value);

            if (claveLocal === undefined) {
                const k = JSON.stringify(abierta.keyPath);
                if (porClave.has(k)) {
                    // La clave está aquí pero con OTRA etiqueta, lo que con la
                    // misma clave de índice es imposible. Se rechaza en vez de
                    // decidir a ciegas cuál de las dos filas es la buena.
                    undecryptable += 1;
                    continue;
                }
                orden.push(k);
                porClave.set(k, {
                    collection, keyPath: abierta.keyPath, ordinal: 0,
                    scope: 'sync', value: abierta.value
                });
                sombra.e[claveS] = [hRemota, remota.rev];
                applied += 1; cambios += 1;
                continue;
            }

            const local = porClave.get(claveLocal);
            const hLocal = await huella(local.keyPath, local.value);

            if (hLocal === hRemota) {
                // Idénticas. Solo se anota la revisión, para que el push no la
                // vuelva a subir con una base vieja.
                sombra.e[claveS] = [hRemota, remota.rev];
                continue;
            }

            if (previa && previa[0] === hLocal) {
                // Sin tocar aquí desde la última sincronía: la suya es más nueva.
                porClave.set(claveLocal, { ...local, value: abierta.value });
                sombra.e[claveS] = [hRemota, remota.rev];
                applied += 1; cambios += 1;
                continue;
            }

            // Los dos han editado sin verse.
            porClave.set(claveLocal, {
                ...local, value: mergeRow(collection, local.value, abierta.value)
            });
            // LA HUELLA QUE SE GUARDA ES LA DE LA FILA REMOTA, no la de la
            // fusión. Es lo que hace que el push vea que lo local difiere y suba
            // la fusión; guardando la de la fusión, la fusión se quedaría aquí y
            // los dos dispositivos no convergerían nunca.
            sombra.e[claveS] = [hRemota, remota.rev];
            merged += 1; cambios += 1;
        }

        if (cambios === 0) continue;

        const finales = orden
            .filter((k) => porClave.has(k))
            .map((k, i) => ({ ...porClave.get(k), ordinal: i }));

        const juntado = join(collection, finales);
        // `join` nunca devuelve un valor que el esquema rechace; si no puede
        // producir uno, no se escribe NADA. Es la regla que impide que una
        // fusión mala degrade la colección a su valor de fábrica y que el
        // siguiente gesto del usuario lo persista.
        if (!juntado.ok) { failed += 1; continue; }

        const escrito = storage.setForProfile(profileId, collection, juntado.value);
        // Fallo TRANSITORIO —cuota, almacén bloqueado—: el cursor no puede
        // avanzar sobre esto, porque la sombra que se acaba de mutar describe un
        // estado que no llegó a escribirse. Repetir la página lo rehace.
        if (!escrito.ok) failed += 1;
        else perfiles.add(profileId);
    }

    return { applied, removed, merged, kept, undecryptable, failed, perfiles };
}

/**
 * Las partes que NO viajan de una colección, con su valor de fábrica.
 *
 * Hacen falta cuando aquí no existe todavía esa colección, y es el recorrido del
 * teléfono nuevo. `settings` es mixta: los ajustes de módulos viajan y el
 * recordatorio no, porque es de este aparato. Recomponerla solo con lo que llega
 * del servidor produce un valor incompleto que el esquema rechaza —y `join`
 * hace bien en no devolverlo—, así que el pull entero se declaraba fallido y no
 * escribía nada. Con esto, lo que no viaja arranca de fábrica y lo que viaja
 * viene del servidor, que es exactamente lo que significa «esta parte es de este
 * dispositivo».
 *
 * Solo las locales: si se sembraran también las que viajan, la fila remota
 * encontraría una local con su misma clave y se resolvería como una edición
 * concurrente contra un valor de fábrica que nadie escribió nunca.
 *
 * @param {string} collection
 * @returns {*[]}
 */
function partesLocalesPorDefecto(collection) {
    const fabrica = COLLECTIONS[collection];
    if (!fabrica) return [];
    const partido = split(collection, fabrica.makeDefault());
    if (!partido.ok) return [];
    return partido.rows.filter((f) => f.scope === 'local');
}

/**
 * Inscribe en el índice local los perfiles que ha traído el pull.
 *
 * **El nombre sale del propio perfil descargado**, nunca de uno inventado aquí:
 * un «Perfil 2» de relleno sería un literal visible fuera de i18n y, peor, una
 * etiqueta que nadie reconocería. Si la colección `profile` de ese id todavía no
 * ha llegado —el pull pagina, y el orden dentro de una página no está
 * garantizado—, se deja para la vuelta siguiente en vez de bautizarlo mal.
 *
 * @param {Set<string>} ids
 * @returns {number} cuántos se inscribieron
 */
function inscribirPerfiles(ids) {
    let n = 0;
    for (const id of ids) {
        if (isReservedProfileId(id)) continue;
        const guardado = storage.getForProfile(id, 'profile');
        if (!guardado.ok || guardado.value === null) continue;
        const perfil = /** @type {*} */ (guardado.value);
        if (typeof perfil.name !== 'string' || perfil.name.trim() === '') continue;

        const r = profiles.adopt({
            id, name: perfil.name,
            // La fecha sale del propio dato descargado. La capa de datos no lee
            // el reloj —es la regla del proyecto—, y aquí ni siquiera hace
            // falta: lo único que se muestra de ella es el orden.
            createdAtISO: typeof perfil.createdAtISO === 'string'
                ? perfil.createdAtISO
                : '1970-01-01T00:00:00.000Z'
        });
        if (r.ok) n += 1;
    }
    return n;
}

/* == El push ================================================================ */

/**
 * @typedef {Object} PushReport
 * @property {boolean} ok
 * @property {string} [error]
 * @property {number} pushed filas subidas
 * @property {number} tombstones lápidas subidas
 * @property {number} conflicts filas que pisaron una versión que este
 *   dispositivo no había visto; el servidor guardó la perdedora
 * @property {number} unreadable colecciones locales que no se pudieron leer
 */

/** Filas por petición. El servidor rechaza más de cincuenta. */
const BATCH = 50;

/**
 * Cuántas lápidas se mandan sin preguntar.
 *
 * Un almacén que se vacía —modo privado que expira, un `clearProfile` mal
 * dirigido, un índice de perfiles que se recrea— es indistinguible de «he
 * borrado todo a propósito» si solo se mira lo que falta. Y la diferencia
 * importa mucho: un push de dos mil lápidas destruye los datos en todos los
 * dispositivos a la vez, que es la catástrofe clásica de las sincronizaciones.
 *
 * Así que un push que borre más de lo que conserva, y más de este número, se
 * PARA y lo dice. Borrar un perfil entero de verdad sigue siendo posible: hay
 * que confirmarlo.
 */
const MAX_LAPIDAS_AUTO = 20;

/**
 * Sube lo que haya cambiado aquí desde la última vez.
 *
 * @param {string} userId
 * @param {{ allowMassDelete?: boolean }} [opciones]
 * @returns {Promise<PushReport>}
 */
export async function push(userId, opciones = {}) {
    /** @type {PushReport} */
    const report = { ok: false, pushed: 0, tombstones: 0, conflicts: 0, unreadable: 0 };

    const llaves = await abrirLlaves(userId);
    if (!llaves) return { ...report, error: 'sync.locked' };

    const sombra = readShadow(userId);

    const indice = profiles.readIndex();
    // Sin índice de perfiles no se sabe qué hay, y «no se sabe» no puede
    // significar «no hay nada»: eso emitiría una lápida por cada fila conocida.
    if (!indice.ok) return { ...report, error: 'sync.noProfiles' };

    const ids = indice.value.profiles
        .map((p) => p.id)
        .filter((id) => !isReservedProfileId(id));

    /** @type {Set<string>} */ const vistas = new Set();
    /** @type {{ claveS: string, huella: string | null, fila: * }[]} */ const lote = [];

    for (const profileId of ids) {
        for (const collection of coleccionesSync()) {
            const r = storage.getForProfile(profileId, collection);
            const partido = r.ok && r.value !== null ? split(collection, r.value) : null;

            // Ilegible o irrepartible: sus filas de la sombra se marcan como
            // vistas para que NO se conviertan en lápidas. No poder leer algo no
            // es haberlo borrado, y aquí esa confusión cuesta los datos.
            if (!r.ok || (partido !== null && !partido.ok)) {
                report.unreadable += 1;
                const prefijo = claveSombra(profileId, collection, '');
                for (const k of Object.keys(sombra.e)) if (k.startsWith(prefijo)) vistas.add(k);
                continue;
            }
            if (partido === null) continue;

            for (const fila of partido.rows) {
                if (fila.scope !== 'sync') continue;
                const tag = aB64u(await itemTag(llaves.index, collection, fila.keyPath));
                const claveS = claveSombra(profileId, collection, tag);
                vistas.add(claveS);

                const h = await huella(fila.keyPath, fila.value);
                const previa = sombra.e[claveS];
                if (previa && previa[0] === h) continue;

                const sobre = await cifrar(llaves.data, collection, tag, fila.keyPath, fila.value);
                lote.push({
                    claveS, huella: h,
                    fila: {
                        profileId, collection, itemTag: tag,
                        ciphertext: aB64u(sobre), deleted: false,
                        baseRev: previa ? previa[1] : 0
                    }
                });
            }
        }
    }

    /** @type {typeof lote} */ const lapidas = [];
    for (const claveS of Object.keys(sombra.e)) {
        if (vistas.has(claveS)) continue;
        const partes = claveS.split(SEP);
        if (partes.length !== 3) { delete sombra.e[claveS]; continue; }
        lapidas.push({
            claveS, huella: null,
            fila: {
                profileId: partes[0], collection: partes[1], itemTag: partes[2],
                ciphertext: null, deleted: true, baseRev: sombra.e[claveS][1]
            }
        });
    }

    if (!opciones.allowMassDelete
        && lapidas.length > MAX_LAPIDAS_AUTO && lapidas.length > vistas.size) {
        return { ...report, error: 'sync.massDelete', tombstones: lapidas.length };
    }
    lote.push(...lapidas);

    if (lote.length === 0) return { ...report, ok: true };

    for (let i = 0; i < lote.length; i += BATCH) {
        const trozo = lote.slice(i, i + BATCH);
        const r = await request('/api/sync', {
            method: 'POST', body: { rows: trozo.map((x) => x.fila) }
        });
        if (!r.ok) return { ...report, error: r.error };

        const resultados = /** @type {*} */ (r.value)?.results;
        if (!Array.isArray(resultados) || resultados.length !== trozo.length) {
            return { ...report, error: 'sync.badResponse' };
        }

        trozo.forEach((entrada, j) => {
            const res = resultados[j];
            if (!Number.isSafeInteger(res?.rev)) return;
            if (res.conflict) report.conflicts += 1;
            if (entrada.huella === null) {
                delete sombra.e[entrada.claveS];
                report.tombstones += 1;
            } else {
                sombra.e[entrada.claveS] = [entrada.huella, res.rev];
                report.pushed += 1;
            }
        });

        // Tras CADA lote, no al final: si la conexión se cae en el tercero, lo
        // que subieron los dos primeros ya está anotado y no se vuelve a subir.
        if (!writeShadow(userId, sombra)) return { ...report, error: 'sync.writeFailed' };
    }

    return { ...report, ok: true };
}

/**
 * Baja y luego sube.
 *
 * El orden importa: bajar primero hace que lo que se suba lleve ya resueltos los
 * conflictos que hubiera, y así el push no pisa versiones que este dispositivo
 * aún no había visto.
 *
 * @param {string} userId
 * @param {{ allowMassDelete?: boolean }} [opciones]
 * @returns {Promise<{ ok: boolean, error?: string, pull: PullReport, push: PushReport | null }>}
 */
export async function sync(userId, opciones = {}) {
    const bajada = await pull(userId);
    if (!bajada.ok) return { ok: false, error: bajada.error, pull: bajada, push: null };
    const subida = await push(userId, opciones);
    return { ok: subida.ok, error: subida.error, pull: bajada, push: subida };
}

/* == Criptografía de una fila =============================================== */

/** @typedef {{ data: CryptoKey, index: CryptoKey }} Llaves */

/**
 * Las dos claves de este dispositivo, o `null` si no está desbloqueado.
 *
 * La de índice se guarda aparte porque no se puede derivar de la de datos: la
 * guardada es no extraíble a propósito. Que falte no es corrupción, es un
 * dispositivo que guardó su clave antes de que existiera la sincronía; la salida
 * es volver a desbloquear.
 *
 * @param {string} userId
 * @returns {Promise<Llaves | null>}
 */
async function abrirLlaves(userId) {
    const data = await keysDb.get(userId);
    if (!data) return null;
    const index = await keysDb.getIndexKey(userId);
    if (!index) return null;
    return { data, index };
}

/**
 * Cifra una fila, con relleno.
 *
 * El relleno a múltiplos de 256 bytes oculta el TAMAÑO. Sin él, el servidor
 * distingue un check-in con notas de uno sin notas, y una receta de veinte
 * ingredientes de una de tres, sin descifrar nada. Se rellena con espacios
 * detrás del JSON, que `JSON.parse` ignora: así no hace falta ni un formato
 * nuevo ni un campo de longitud que pudiera mentir.
 *
 * @param {CryptoKey} dk
 * @param {string} collection
 * @param {string} tag
 * @param {string[]} keyPath
 * @param {unknown} value
 * @returns {Promise<Uint8Array>}
 */
async function cifrar(dk, collection, tag, keyPath, value) {
    const bytes = new TextEncoder().encode(JSON.stringify({ keyPath, value }));
    const relleno = (256 - (bytes.length % 256)) % 256;
    const claro = new Uint8Array(bytes.length + relleno);
    claro.set(bytes);
    claro.fill(0x20, bytes.length);
    return encryptBytes(dk, claro, `${collection}/${tag}`);
}

/**
 * Descifra una fila y devuelve su `keyPath` y su valor.
 *
 * El `additionalData` ata el criptograma a SU fila: una fila movida a otra
 * colección o a otra etiqueta no descifra. Sin eso, quien pudiera escribir en el
 * servidor barajaría filas —poner el peso de enero en la de marzo— sin romper
 * ningún tag.
 *
 * Y además se COMPRUEBA que la etiqueta de la fila es la que corresponde a la
 * clave que venía dentro. El `aad` ya lo hace imposible desde el servidor, pero
 * esto caza también un fallo propio: una etiqueta calculada mal aquí escribiría
 * el dato en el sitio equivocado en vez de fallar.
 *
 * @param {Llaves} llaves
 * @param {string} collection
 * @param {*} fila
 * @returns {Promise<{ keyPath: string[], value: unknown } | null>}
 */
async function abrir(llaves, collection, fila) {
    const bytes = deB64u(fila.ciphertext);
    if (!bytes) return null;

    const claro = await decryptBytes(llaves.data, bytes, `${collection}/${fila.itemTag}`);
    if (!claro) return null;

    let carga;
    try {
        carga = JSON.parse(new TextDecoder().decode(claro));
    } catch {
        return null;
    }
    if (carga === null || typeof carga !== 'object' || !Array.isArray(carga.keyPath)) return null;
    if (!carga.keyPath.every((/** @type {*} */ s) => typeof s === 'string')) return null;

    const esperada = aB64u(await itemTag(llaves.index, collection, carga.keyPath));
    if (esperada !== fila.itemTag) return null;

    return { keyPath: carga.keyPath, value: carga.value };
}

/* == Utilidades ============================================================= */

/** Las colecciones cuyas filas viajan. */
const coleccionesSync = () => syncCollections().filter((c) => scopeOf(c) === 'sync');

/**
 * ¿Esta fila tiene la forma mínima para intentar aplicarla?
 *
 * Se filtra ANTES de descifrar: una colección que no está en la política, o un
 * perfil con forma imposible, no puede acabar escribiendo en el almacén aunque
 * su criptograma sea válido. El servidor es un tercero, y lo que manda se
 * comprueba aquí igual que se comprobaría un backup.
 *
 * @param {*} fila
 * @returns {boolean}
 */
function esFilaUsable(fila) {
    if (fila === null || typeof fila !== 'object') return false;
    if (typeof fila.profileId !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(fila.profileId)) return false;
    if (typeof fila.collection !== 'string' || !syncCollections().includes(fila.collection)) return false;
    // Una colección marcada como local no debería estar en el servidor. Si
    // aparece, se ignora: el ámbito lo decide este dispositivo, no lo que llegue.
    if (scopeOf(fila.collection) !== 'sync') return false;
    // 22 caracteres son exactamente 16 bytes en base64url, que es lo que mide un
    // `itemTag`. Aceptar cualquier longitud dejaría entrar etiquetas que no
    // pueden haber salido de aquí.
    if (typeof fila.itemTag !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(fila.itemTag)) return false;
    if (!Number.isSafeInteger(fila.rev) || fila.rev < 1) return false;
    if (!fila.deleted && typeof fila.ciphertext !== 'string') return false;
    return true;
}

/** bytes → base64url. */
function aB64u(/** @type {Uint8Array} */ bytes) {
    let binario = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binario += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → bytes. Lo que llega aquí lo emitió nuestro propio servidor. */
function deB64u(/** @type {unknown} */ texto) {
    if (typeof texto !== 'string' || !/^[A-Za-z0-9_-]*$/.test(texto)) return null;
    const relleno = texto.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - texto.length % 4) % 4);
    try {
        const binario = atob(relleno);
        const out = new Uint8Array(binario.length);
        for (let i = 0; i < binario.length; i++) out[i] = binario.charCodeAt(i);
        return out;
    } catch {
        return null;
    }
}

/**
 * Comprueba que una colección escrita por el pull sigue valiendo.
 *
 * Se expone para los tests y para el diagnóstico: `join` ya garantiza que lo que
 * devuelve valida, pero afirmarlo desde fuera es lo que convierte esa garantía
 * en algo que se puede comprobar.
 *
 * @param {string} profileId
 * @param {string} collection
 * @returns {boolean}
 */
export function localIsValid(profileId, collection) {
    const r = storage.getForProfile(profileId, collection);
    if (!r.ok || r.value === null) return true;
    return validateCollection(collection, r.value).ok;
}

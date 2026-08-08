// @ts-check

/**
 * Colección de check-ins: alta, edición y borrado sobre `storage.js`.
 *
 * Todo pasa por el validador de `schema.js` antes de escribirse, de modo que
 * la colección persistida siempre es válida aunque la vista tenga un fallo.
 * El id se deriva de la fecha, así que dos check-ins del mismo día se
 * reemplazan en vez de duplicarse: pesarse dos veces un martes no crea dos
 * registros que luego se contradigan.
 */

import * as storage from './storage.js';
import { SCHEMA_VERSION, validateCollection, sanitizeText, MEASURE_KEYS, SUBJECTIVE_KEYS } from './schema.js';

/**
 * @typedef {import('./schema.js').SchemaIssue} SchemaIssue
 * @typedef {Object} CheckinInput
 * @property {string} dateISO
 * @property {number} weightKg
 * @property {number | null} [fatPct]
 * @property {number | null} [scaleMuscleKg] músculo tal cual lo da la báscula (E11)
 * @property {number | null} [boneKg] masa ósea tal cual la da la báscula (E11)
 * @property {Record<string, number>} [measuresCm]
 * @property {Record<string, number>} [subjective]
 * @property {string} [notes]
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, error: string, issues?: SchemaIssue[] }} CheckinResult
 */

const KEY = 'checkins';

/**
 * Id determinista a partir de la fecha: un check-in por día.
 * @param {string} dateISO
 * @returns {string}
 */
function idFor(dateISO) {
    return `ci_${dateISO}`;
}

/** @returns {CheckinResult<{ schemaVersion: number, items: any[] }>} */
export function readAll() {
    const stored = storage.get(KEY);
    if (!stored.ok) return { ok: false, error: stored.error };
    if (stored.value === null) return { ok: true, value: { schemaVersion: SCHEMA_VERSION, items: [] } };

    const parsed = validateCollection(KEY, stored.value);
    if (!parsed.ok) return { ok: false, error: 'checkins.corrupt', issues: parsed.errors };
    return { ok: true, value: parsed.value };
}

/**
 * Caché de la lista ordenada y su índice por fecha (M7-5).
 *
 * EL PROBLEMA QUE RESUELVE, MEDIDO. `list()` no es barata: lee de
 * `localStorage`, hace `JSON.parse` y **revalida el array ENTERO** contra el
 * esquema. Y `findByDate()` la llamaba en cada invocación, mientras las vistas
 * la metían dentro de un `.map()` sobre las evaluaciones — un N+1 clásico, con
 * el agravante de que cada «1» cuesta validar N elementos. O sea, cuadrático:
 *
 *      52 check-ins (un año semanal)  →     38 ms
 *     365 check-ins (un año diario)   →  1 510 ms
 *     730 check-ins (dos años)        →  6 775 ms
 *
 * El esquema admite hasta 2 000 (`schema.js`), así que el techo se alcanza. Y
 * no ocurría una vez por pantalla: la vista de Proyección rehace ese trabajo en
 * CADA cambio de métrica, granularidad, ventana o fluctuación.
 *
 * Hoy no se nota porque los check-ins son semanales. Se notaría el día que
 * alguien lleve tres años, o importe datos diarios de una báscula — es decir,
 * justo cuando la aplicación esté funcionando bien.
 *
 * QUÉ LA INVALIDA. Dos cosas, y ninguna es «llamarla desde `save()`»:
 *
 * - **El perfil activo.** Las claves llevan el perfil en el namespace, así que
 *   una caché que no lo comprobara serviría los check-ins de otra persona.
 * - **`storage.revision()`**, que sube con cualquier escritura del almacén.
 *   Esta clave no la escribe solo este módulo: también `backup.js` al importar,
 *   `migrate.js` al convertir de la v4 y `profiles.js` al sembrar un perfil.
 *   Invalidar solo desde `save()`/`remove()` dejaría al usuario restaurando un
 *   backup y viendo todavía los datos de antes.
 * @type {{ profileId: string, revision: number, list: any[], byDate: Map<string, any> } | null}
 */
let cache = null;

/** @returns {any[]} lista ordenada por fecha, vacía si algo falla */
export function list() {
    const profileId = storage.getActiveProfile();
    const revision = storage.revision();
    if (cache && cache.profileId === profileId && cache.revision === revision) return cache.list;

    const all = readAll();
    // Un fallo NO se cachea: si el almacén está corrupto, el usuario puede
    // arreglarlo (importar un backup) y la próxima lectura debe verlo.
    //
    // Y la caché ANTERIOR se tira, que es la parte que faltaba y costó una
    // fuga entre perfiles (ataque adversarial de M7): dejándola, `findByDate`
    // seguía sirviendo su índice viejo mientras `list()` devolvía vacío. Con
    // el perfil B ilegible, eso significaba servir los check-ins del perfil A
    // — lo peor que puede hacer una aplicación de datos personales.
    if (!all.ok) {
        cache = null;
        return [];
    }

    const sorted = [...all.value.items].sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    const byDate = new Map(sorted.map((item) => [item.dateISO, item]));
    cache = { profileId, revision, list: sorted, byDate };
    return sorted;
}

/**
 * Filtra un mapa parcial dejando solo claves conocidas y números finitos.
 * @param {Record<string, unknown> | undefined} input
 * @param {readonly string[]} allowed
 * @returns {Record<string, number>}
 */
function cleanMap(input, allowed) {
    /** @type {Record<string, number>} */ const out = {};
    if (!input || typeof input !== 'object') return out;
    for (const key of allowed) {
        const value = Object.hasOwn(input, key) ? input[key] : undefined;
        if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    }
    return out;
}

/**
 * Resuelve un campo numérico opcional distinguiendo «vacío» de «no preguntado».
 * @param {unknown} incoming `undefined` = el formulario no lo mostraba
 * @param {unknown} previous lo que ya había guardado
 * @returns {number | null}
 */
function keepOptional(incoming, previous) {
    if (incoming === undefined) {
        return typeof previous === 'number' && Number.isFinite(previous) ? previous : null;
    }
    return typeof incoming === 'number' && Number.isFinite(incoming) ? incoming : null;
}

/**
 * Guarda un check-in (alta o edición del mismo día).
 * @param {CheckinInput} input
 * @param {{ nowISO: string }} context
 * @returns {CheckinResult<any>}
 */
export function save(input, context) {
    if (!context || typeof context !== 'object' || typeof context.nowISO !== 'string') {
        return { ok: false, error: 'checkins.contextInvalid' };
    }
    const all = readAll();
    if (!all.ok) return all;

    const id = idFor(input?.dateISO ?? '');
    const existing = all.value.items.find((item) => item.id === id);

    const record = {
        id,
        dateISO: input?.dateISO ?? '',
        weightKg: input?.weightKg,
        fatPct: typeof input?.fatPct === 'number' && Number.isFinite(input.fatPct) ? input.fatPct : null,
        // Cifras de báscula del día, tal cual las dio la báscula (E11). No se
        // traducen aquí: guardar lo medido y traducir al mostrarlo es lo que
        // permite que un cambio futuro en la conversión no reescriba el
        // historial del usuario.
        //
        // `undefined` significa «no me han preguntado por esto», y entonces se
        // conserva lo que ya hubiera: un formulario que no muestra un campo no
        // puede borrarlo. `null` sí borra, porque es el usuario vaciándolo.
        scaleMuscleKg: keepOptional(input?.scaleMuscleKg, existing?.scaleMuscleKg),
        boneKg: keepOptional(input?.boneKg, existing?.boneKg),
        measuresCm: cleanMap(input?.measuresCm, MEASURE_KEYS),
        subjective: cleanMap(input?.subjective, SUBJECTIVE_KEYS),
        notes: sanitizeText(input?.notes ?? ''),
        createdAtISO: existing?.createdAtISO ?? context.nowISO,
        editedAtISO: existing ? context.nowISO : null
    };

    const items = existing
        ? all.value.items.map((item) => (item.id === id ? record : item))
        : [...all.value.items, record];

    const next = { schemaVersion: SCHEMA_VERSION, items };
    // se valida la colección ENTERA antes de escribir: un registro raro no
    // puede dejar la colección en un estado que la app no sepa releer
    const checked = validateCollection(KEY, next);
    if (!checked.ok) return { ok: false, error: 'checkins.invalid', issues: checked.errors };

    const written = storage.set(KEY, checked.value);
    if (!written.ok) return { ok: false, error: written.error };
    return { ok: true, value: record };
}

/**
 * Borra un check-in por id.
 * @param {string} id
 * @returns {CheckinResult<number>} cuántos quedan
 */
export function remove(id) {
    const all = readAll();
    if (!all.ok) return all;
    const items = all.value.items.filter((item) => item.id !== id);
    if (items.length === all.value.items.length) return { ok: false, error: 'checkins.notFound' };

    const written = storage.set(KEY, { schemaVersion: SCHEMA_VERSION, items });
    if (!written.ok) return { ok: false, error: written.error };
    return { ok: true, value: items.length };
}

/** @param {string} dateISO @returns {any | null} */
export function findByDate(dateISO) {
    list();  // revalida la caché (y su índice) para el perfil activo
    // `list()` deja `cache` en null si no pudo leer, así que aquí o hay un
    // índice del perfil correcto o no hay ninguno. Nunca uno de otro.
    return cache?.byDate.get(dateISO) ?? null;
}


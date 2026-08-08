// @ts-check

/**
 * Esquema v5: forma de todo lo que se persiste, y validadores de forma.
 *
 * Contrato (CLAUDE.md §3, decisión C1):
 * - `schemaVersion: 5` en todo objeto raíz.
 * - Los validadores NUNCA lanzan: devuelven `{ok:true, value}` con una COPIA
 *   saneada, o `{ok:false, errors}` con códigos i18n-ready.
 * - El valor devuelto contiene SOLO claves conocidas. Las desconocidas se
 *   descartan en silencio: el import de backups es el vector real de datos
 *   hostiles y una copia por claves conocidas neutraliza de raíz la
 *   contaminación de prototipo y el contrabando de campos.
 * - Los campos de texto pasan por `sanitizeText`. El ESCAPADO de HTML no se
 *   hace aquí: es responsabilidad de la capa de render (`ui/dom.js`, F6).
 *   Aquí el texto se guarda como texto literal.
 */

export { SCHEMA_VERSION } from './version.js';
import { SCHEMA_VERSION } from './version.js';
import { migrateValue } from './migrations.js';

/**
 * @typedef {{ code: string, path: string, params?: Record<string, string | number> }} SchemaIssue
 */

/**
 * @template T
 * @typedef {{ ok: true, value: T } | { ok: false, errors: SchemaIssue[] }} SchemaResult
 */

/** Longitud máxima por defecto de un campo de texto persistido. */
const MAX_TEXT_LENGTH = 2000;

/** Medidas corporales admitidas (decisión E2: set configurable). */
export const MEASURE_KEYS = Object.freeze(['waist', 'hip', 'arm', 'thigh', 'neck', 'chest']);

/** Métricas subjetivas del check-in, escala 1–10 (decisión A2: datos reales). */
export const SUBJECTIVE_KEYS = Object.freeze(['energy', 'sleep', 'adherence', 'motivation']);

/** Idiomas soportados por la interfaz (A6). */
const LOCALES = Object.freeze(['es', 'en']);

const SEXES = Object.freeze(['male', 'female']);
const ACTIVITY_LEVELS = Object.freeze(['sedentary', 'light', 'moderate', 'active', 'veryActive']);
const TRAINING_STATUSES = Object.freeze(['beginner', 'intermediate', 'advanced']);
const INTENSITIES = Object.freeze(['conservative', 'moderate', 'aggressive']);
/**
 * Origen del dato de músculo (invariante A3).
 *
 * `derived` es el tercero, y lo añadió el caso real de una Xiaomi: esas
 * básculas llaman «masa muscular» a `peso − grasa − hueso`, que NO es músculo
 * esquelético. Cuando el usuario da músculo Y hueso, `core/scale.js` interpreta
 * la lectura y DERIVA el músculo esquelético. No es medido —el usuario nunca
 * midió su músculo esquelético— ni estimado a ciegas: se llama por su nombre.
 */
const MUSCLE_SOURCES = Object.freeze(['measured', 'estimated', 'derived']);
const PHASE_TYPES = Object.freeze(['adaptation', 'recomposition', 'cut', 'bulk', 'transition', 'maintenance']);

/**
 * Sanea un texto para persistirlo: elimina caracteres de control (salvo el
 * salto de línea), normaliza espacios en los extremos y acota la longitud.
 * NO escapa HTML a propósito: el texto se guarda literal y se escapa al
 * pintarlo (F6). Entradas no-string degradan a cadena vacía, sin lanzar.
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {string}
 */
export function sanitizeText(value, maxLength = MAX_TEXT_LENGTH) {
    if (typeof value !== 'string') return '';
    // eslint-disable-next-line no-control-regex
    const withoutControls = value.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '');
    return withoutControls.trim().slice(0, maxLength);
}

// ============================================================
// Combinadores de validación (internos)
// ============================================================

/**
 * @typedef {(value: unknown, path: string, errors: SchemaIssue[]) => unknown} FieldValidator
 */

/** @param {unknown} v @returns {v is Record<string, unknown>} */
function isRecord(v) {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Lee una propiedad PROPIA. Ignora la cadena de prototipos, de modo que
 * `toString` o `constructor` nunca se leen como si fueran datos.
 * @param {Record<string, unknown>} obj
 * @param {string} key
 * @returns {unknown}
 */
function own(obj, key) {
    return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/** @param {SchemaIssue[]} errors @param {string} code @param {string} path @param {Record<string, string|number>} [params] */
function fail(errors, code, path, params) {
    errors.push(params ? { code, path, params } : { code, path });
    return undefined;
}

/** @type {(opts?: {min?: number, max?: number, integer?: boolean}) => FieldValidator} */
const num = (opts = {}) => (value, path, errors) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fail(errors, 'field.notFiniteNumber', path);
    if (opts.integer && !Number.isInteger(value)) return fail(errors, 'field.notInteger', path);
    if (opts.min !== undefined && value < opts.min) return fail(errors, 'field.belowMin', path, { min: opts.min });
    if (opts.max !== undefined && value > opts.max) return fail(errors, 'field.aboveMax', path, { max: opts.max });
    return value;
};

/** @type {(opts?: {maxLength?: number, allowEmpty?: boolean, pattern?: RegExp}) => FieldValidator} */
const str = (opts = {}) => (value, path, errors) => {
    if (typeof value !== 'string') return fail(errors, 'field.notString', path);
    const clean = sanitizeText(value, opts.maxLength);
    if (!opts.allowEmpty && clean === '') return fail(errors, 'field.empty', path);
    if (opts.pattern && !opts.pattern.test(clean)) return fail(errors, 'field.patternMismatch', path);
    return clean;
};

/** @type {(allowed: readonly string[]) => FieldValidator} */
const enumOf = (allowed) => (value, path, errors) => {
    if (typeof value !== 'string' || !allowed.includes(value)) {
        return fail(errors, 'field.notInEnum', path, { allowed: allowed.join('|') });
    }
    return value;
};

/** @type {FieldValidator} */
const bool = (value, path, errors) => {
    if (typeof value !== 'boolean') return fail(errors, 'field.notBoolean', path);
    return value;
};

/** Fecha civil 'YYYY-MM-DD' que existe de verdad en el calendario (UTC). */
/** @type {FieldValidator} */
const isoDate = (value, path, errors) => {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return fail(errors, 'field.notIsoDate', path);
    const [y, m, d] = value.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
        return fail(errors, 'field.notIsoDate', path);
    }
    return value;
};

/** Instante ISO completo ('...Z'). */
/** @type {FieldValidator} */
const isoInstant = (value, path, errors) => {
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || !/\d{4}-\d{2}-\d{2}T/.test(value)) {
        return fail(errors, 'field.notIsoInstant', path);
    }
    return value;
};

/** Marca un campo como opcional: `undefined` y `null` pasan como `null`. */
/** @type {(inner: FieldValidator) => FieldValidator & {optional: true}} */
const opt = (inner) => Object.assign(
    /** @type {FieldValidator} */ ((value, path, errors) => (value === undefined || value === null ? null : inner(value, path, errors))),
    /** @type {{optional: true}} */ ({ optional: true })
);

/** @type {(inner: FieldValidator, opts?: {maxItems?: number}) => FieldValidator} */
const arrayOf = (inner, opts = {}) => (value, path, errors) => {
    if (!Array.isArray(value)) return fail(errors, 'field.notArray', path);
    const max = opts.maxItems ?? 10000;
    if (value.length > max) return fail(errors, 'field.tooManyItems', path, { max });
    /** @type {unknown[]} */ const out = [];
    value.forEach((item, i) => {
        const before = errors.length;
        const v = inner(item, `${path}[${i}]`, errors);
        if (errors.length === before) out.push(v);
    });
    return out;
};

/**
 * Objeto de forma fija: copia SOLO las claves declaradas (propias), de modo
 * que lo desconocido se descarta y el resultado nunca hereda de otro prototipo.
 * @type {(shape: Record<string, FieldValidator>) => FieldValidator}
 */
const objectOf = (shape) => (value, path, errors) => {
    if (!isRecord(value)) return fail(errors, 'field.notObject', path);
    /** @type {Record<string, unknown>} */ const out = Object.create(null);
    for (const [key, validator] of Object.entries(shape)) {
        const raw = own(value, key);
        const childPath = path ? `${path}.${key}` : key;
        if (raw === undefined && /** @type {*} */ (validator).optional) {
            out[key] = null;
            continue;
        }
        if (raw === undefined) {
            fail(errors, 'field.required', childPath);
            continue;
        }
        const before = errors.length;
        const v = validator(raw, childPath, errors);
        if (errors.length === before) out[key] = v;
    }
    return Object.assign({}, out); // prototipo Object.prototype limpio
};

/**
 * Mapa de claves conocidas con valores opcionales (medidas, subjetivas).
 * @type {(keys: readonly string[], inner: FieldValidator) => FieldValidator}
 */
const partialMap = (keys, inner) => (value, path, errors) => {
    if (!isRecord(value)) return fail(errors, 'field.notObject', path);
    /** @type {Record<string, unknown>} */ const out = {};
    for (const key of keys) {
        const raw = own(value, key);
        if (raw === undefined || raw === null) continue;
        const before = errors.length;
        const v = inner(raw, `${path}.${key}`, errors);
        if (errors.length === before) out[key] = v;
    }
    return out;
};

/**
 * Construye un validador de colección raíz: exige `schemaVersion` y aplica la
 * forma declarada.
 * @template T
 * @param {Record<string, FieldValidator>} shape
 * @returns {(value: unknown) => SchemaResult<T>}
 */
function rootValidator(shape) {
    const body = objectOf(shape);
    return (value) => {
        /** @type {SchemaIssue[]} */ const errors = [];
        if (!isRecord(value)) {
            return { ok: false, errors: [{ code: 'schema.notObject', path: '' }] };
        }
        const version = own(value, 'schemaVersion');
        if (version === undefined) return { ok: false, errors: [{ code: 'schema.versionMissing', path: 'schemaVersion' }] };
        if (version !== SCHEMA_VERSION) {
            return { ok: false, errors: [{ code: 'schema.versionUnsupported', path: 'schemaVersion', params: { found: String(version), expected: SCHEMA_VERSION } }] };
        }
        const parsed = body(value, '', errors);
        if (errors.length > 0) return { ok: false, errors };
        return { ok: true, value: /** @type {T} */ ({ schemaVersion: SCHEMA_VERSION, ...(/** @type {object} */ (parsed)) }) };
    };
}

// ============================================================
// Formas de las colecciones
// ============================================================

/** Identificador de perfil: sin puntos, para no romper el namespace `tl.5.<pid>.` */
const profileId = str({ maxLength: 40, pattern: /^[A-Za-z0-9_-]{1,40}$/ });

/** Id del perfil activo; la cadena vacía significa «ningún perfil todavía». */
const activeProfileIdField = str({ maxLength: 40, allowEmpty: true, pattern: /^([A-Za-z0-9_-]{1,40})?$/ });

const userShape = objectOf({
    sex: enumOf(SEXES),
    age: num({ min: 14, max: 90, integer: true }),
    heightCm: num({ min: 120, max: 230 }),
    activityLevel: enumOf(ACTIVITY_LEVELS),
    trainingStatus: enumOf(TRAINING_STATUSES)
});

const phaseShape = objectOf({
    type: enumOf(PHASE_TYPES),
    days: num({ min: 1, max: 1095, integer: true }),
    expected: objectOf({ fatDeltaKg: num(), muscleDeltaKg: num() }),
    nominalKcal: objectOf({
        targetKcal: num({ min: 0, max: 20000 }),
        deficitKcal: num({ min: -20000, max: 20000 }),
        tdeeKcal: num({ min: 0, max: 20000 }),
        flooredBySafety: bool
    })
});

const planShape = objectOf({
    phases: arrayOf(phaseShape, { maxItems: 40 }),
    totalDays: num({ min: 1, max: 1095, integer: true }),
    summary: objectOf({ targetWeightKg: num({ min: 20, max: 400 }), fatDeltaKg: num(), muscleDeltaKg: num() }),
    warnings: arrayOf(objectOf({ code: str({ maxLength: 60 }) }), { maxItems: 50 })
});

const paramsShape = objectOf({
    startDateISO: isoDate,
    seed: num({ integer: true, min: 0, max: 4294967295 }),
    fluctuation: bool
});

const validateProfilesIndexBase = rootValidator({
    activeProfileId: activeProfileIdField,
    profiles: arrayOf(objectOf({
        id: profileId,
        name: str({ maxLength: 60 }),
        createdAtISO: isoInstant
    }), { maxItems: 50 })
});

/**
 * Índice global de perfiles (clave `tl.5.profiles`). Además de la forma,
 * comprueba dos reglas de integridad: ids únicos y perfil activo existente.
 * @param {unknown} value
 * @returns {SchemaResult<{schemaVersion: number, activeProfileId: string, profiles: Array<{id: string, name: string, createdAtISO: string}>}>}
 */
export function validateProfilesIndex(value) {
    const base = validateProfilesIndexBase(value);
    if (!base.ok) return base;
    const idx = /** @type {*} */ (base.value);
    const ids = idx.profiles.map((/** @type {*} */ p) => p.id);
    if (new Set(ids).size !== ids.length) {
        return { ok: false, errors: [{ code: 'profiles.duplicateId', path: 'profiles' }] };
    }
    // Coherencia entre los dos campos: sin perfiles no puede haber activo, y
    // con perfiles el activo tiene que existir. Un índice que apunte a un
    // perfil fantasma es corrupto, no «casi válido».
    if (idx.profiles.length === 0) {
        if (idx.activeProfileId !== '') {
            return { ok: false, errors: [{ code: 'profiles.activeNotFound', path: 'activeProfileId' }] };
        }
    } else if (!ids.includes(idx.activeProfileId)) {
        return { ok: false, errors: [{ code: 'profiles.activeNotFound', path: 'activeProfileId' }] };
    }
    return base;
}

/** Perfil del usuario (clave `<ns>.profile`). */
export const validateProfile = rootValidator({
    name: str({ maxLength: 60 }),
    createdAtISO: isoInstant,
    user: userShape,
    initial: objectOf({
        weightKg: num({ min: 20, max: 400 }),
        fatPct: num({ min: 0, max: 100 }),
        muscleKg: opt(num({ min: 1, max: 200 })),
        muscleSource: enumOf(MUSCLE_SOURCES),
        // Lo que dio la báscula, guardado tal cual para poder volver a
        // interpretarlo y para que el usuario vea sus propias cifras.
        scaleMuscleKg: opt(num({ min: 1, max: 200 })),
        boneKg: opt(num({ min: 0.5, max: 10 }))
    }),
    target: objectOf({
        fatPct: num({ min: 0, max: 100 }),
        // Siempre músculo ESQUELÉTICO: es lo que consume el motor.
        muscleKg: num({ min: 1, max: 200 }),
        // La misma meta, en la unidad que el usuario escribió si venía de una
        // báscula (E11). `muscleKg` se DERIVA de ésta, no al revés: así una
        // recalibración que mueva la estimación interna no desplaza sola la
        // cifra que el usuario se fijó.
        scaleMuscleKg: opt(num({ min: 1, max: 200 }))
    }),
    startDateISO: isoDate,
    intensity: enumOf(INTENSITIES)
});

/**
 * Plan vigente + historial de recalibraciones (E1). La PROYECCIÓN no se
 * persiste: el generador es determinista y se regenera al arrancar.
 */
export const validatePlan = rootValidator({
    current: opt(planShape),
    params: opt(paramsShape),
    history: arrayOf(objectOf({
        plan: opt(planShape),
        params: opt(paramsShape),
        archivedAtISO: isoInstant,
        reason: str({ maxLength: 60 })
    }), { maxItems: 100 })
});

/** Check-ins reales del usuario (A2, E2). */
export const validateCheckins = rootValidator({
    items: arrayOf(objectOf({
        id: str({ maxLength: 60 }),
        dateISO: isoDate,
        weightKg: num({ min: 20, max: 400 }),
        fatPct: opt(num({ min: 0, max: 100 })),
        // Lo que marcó la báscula esa semana, tal cual (E11). Opcionales por
        // necesidad, no por comodidad: un campo requerido nuevo haría que todo
        // backup anterior fallara la validación y perdiera la colección
        // ENTERA en silencio (`backup.js`). Se guarda la cifra de la báscula
        // sin traducir; la traducción a esquelético vive en la UI.
        scaleMuscleKg: opt(num({ min: 1, max: 200 })),
        boneKg: opt(num({ min: 0.5, max: 10 })),
        measuresCm: partialMap(MEASURE_KEYS, num({ min: 10, max: 300 })),
        subjective: partialMap(SUBJECTIVE_KEYS, num({ min: 1, max: 10, integer: true })),
        notes: opt(str({ maxLength: MAX_TEXT_LENGTH, allowEmpty: true })),
        createdAtISO: isoInstant,
        editedAtISO: opt(isoInstant)
    }), { maxItems: 2000 })
});

/**
 * Identificadores internos: solo caracteres seguros.
 *
 * Un id llega del import de un backup, que es hostil por definición. Con
 * comillas dentro rompía los selectores CSS de la vista de entrenamiento, y
 * la sesión se perdía sin aviso. Aquí se corta de raíz, igual que ya se hacía
 * con `profileId`.
 */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Rutina y sesiones de entrenamiento (E5; se llena en M5). */
export const validateTraining = rootValidator({
    routine: opt(objectOf({
        days: arrayOf(objectOf({
            name: str({ maxLength: 60 }),
            exercises: arrayOf(objectOf({
                id: str({ maxLength: 60, pattern: SAFE_ID }),
                name: str({ maxLength: 80 }),
                sets: num({ min: 1, max: 20, integer: true }),
                reps: num({ min: 1, max: 100, integer: true }),
                loadKg: opt(num({ min: 0, max: 500 })),
                // Enlace al catálogo de ejercicios (V2-M6), OPCIONAL. Sin él la
                // rutina sigue funcionando —el usuario puede escribir el
                // nombre que quiera— pero sus series no se pueden atribuir a
                // ningún grupo muscular, y la vista lo DICE en vez de contarlas
                // como cero en silencio.
                catalogId: opt(str({ maxLength: 60, pattern: SAFE_ID }))
            }), { maxItems: 40 })
        }), { maxItems: 14 })
    })),
    sessions: arrayOf(objectOf({
        id: str({ maxLength: 60, pattern: SAFE_ID }),
        dateISO: isoDate,
        entries: arrayOf(objectOf({
            exerciseId: str({ maxLength: 60, pattern: SAFE_ID }),
            sets: arrayOf(objectOf({
                reps: num({ min: 0, max: 200, integer: true }),
                loadKg: num({ min: 0, max: 500 })
            }), { maxItems: 30 })
        }), { maxItems: 40 })
    }), { maxItems: 2000 })
});

/** Plantillas de comida propias (E4; se llena en M5). */
export const validateNutrition = rootValidator({
    mealTemplates: arrayOf(objectOf({
        id: str({ maxLength: 60 }),
        name: str({ maxLength: 80 }),
        macros: objectOf({
            kcal: num({ min: 0, max: 10000 }),
            proteinG: num({ min: 0, max: 1000 }),
            carbsG: num({ min: 0, max: 1000 }),
            fatG: num({ min: 0, max: 1000 })
        }),
        notes: opt(str({ maxLength: MAX_TEXT_LENGTH, allowEmpty: true }))
    }), { maxItems: 500 })
});

/** Metadatos de fotos (los blobs viven en IndexedDB, tensión 1 del plan). */
export const validatePhotos = rootValidator({
    items: arrayOf(objectOf({
        id: str({ maxLength: 60 }),
        dateISO: isoDate,
        note: opt(str({ maxLength: 300, allowEmpty: true }))
    }), { maxItems: 2000 })
});

/** Logros desbloqueados (E9). */
export const validateAchievements = rootValidator({
    unlocked: arrayOf(objectOf({
        id: str({ maxLength: 60 }),
        atISO: isoInstant
    }), { maxItems: 500 })
});

/** Ajustes de la aplicación por perfil. */
export const validateSettings = rootValidator({
    locale: enumOf(LOCALES),
    activeMeasures: arrayOf(enumOf(MEASURE_KEYS), { maxItems: MEASURE_KEYS.length }),
    fluctuationVisible: bool,
    reminder: opt(objectOf({
        weekday: num({ min: 0, max: 6, integer: true }),
        hour: num({ min: 0, max: 23, integer: true })
    })),
    // Estado de la vista Analizar (E13). `opt()` obligatorio: hay `settings`
    // guardados desde M3 y exigir esta clave los tumbaría todos.
    //
    // La ventana NO admite 'custom' aunque el zoom lo produzca: un zoom son dos
    // índices de día que solo significan algo dentro de un plan concreto, y
    // restaurarlos sobre un plan recalibrado señalaría un tramo que ya no existe.
    // Al recargar se vuelve al plan entero, que es un sitio del que se sabe salir.
    analysis: opt(objectOf({
        seriesIds: arrayOf(str({ maxLength: 40, pattern: SAFE_ID }), { maxItems: 8 }),
        window: enumOf(['all', 'phase', '90', '30']),
        grain: enumOf(['day', 'week', 'month']),
        normalize: enumOf(['raw', 'delta'])
    }))
});

// ============================================================
// Colecciones de la v2 (registradas en V2-M0, pobladas por su milestone)
// ============================================================
//
// Se registran VACÍAS y desde el primer día por una razón concreta: en cuanto
// una colección está en `COLLECTIONS`, queda cubierta SOLA por la siembra de
// perfil (`profiles.js`), el export/import de backups (que itera las claves de
// COLLECTIONS), el presupuesto de cuota y el namespace del almacén. Registrarlas
// después obligaría a otra migración; registrarlas ahora es gratis.
//
// Cada milestone AMPLÍA la suya con los campos que necesite: añadir campos
// `opt()` es compatible hacia atrás y no exige subir el esquema.

/** Ingesta diaria registrada; alimenta el gasto adaptativo (V2-M1). */
export const validateIntakeLog = rootValidator({
    items: arrayOf(objectOf({
        dateISO: isoDate,
        kcal: num({ min: 0, max: 20000 }),
        proteinG: opt(num({ min: 0, max: 2000 })),
        carbsG: opt(num({ min: 0, max: 2000 })),
        fatG: opt(num({ min: 0, max: 2000 }))
    }), { maxItems: 3000 })
});

/** Preferencias del onboarding profundo: dieta, restricciones, equipo (V2-M10). */
export const validatePreferences = rootValidator({
    // Restricciones DURAS (alergias) frente a BLANDAS (desagrados): la
    // distinción es lo que permite que el solver del menú tenga solución.
    hardExclusions: arrayOf(str({ maxLength: 60 }), { maxItems: 100 }),
    softExclusions: arrayOf(str({ maxLength: 60 }), { maxItems: 200 }),
    dietType: opt(str({ maxLength: 40 })),
    mealsPerDay: opt(num({ min: 1, max: 10, integer: true })),
    householdSize: opt(num({ min: 1, max: 20, integer: true })),
    controlLevel: opt(str({ maxLength: 20 })),
    // Módulos que el usuario ha activado (V2-M10).
    //
    // `opt()` NO es cosmética, y este comentario ya decía «opcional» mientras el
    // código lo exigía. Consecuencia medida: un registro de `preferences` escrito
    // ANTES de V2-M10 fallaba la validación ENTERA por esta clave ausente,
    // `get()` degradaba a vacío y el siguiente `save()` escribía encima. El
    // usuario perdía su tipo de dieta y sus exclusiones duras, que son ALERGIAS.
    //
    // La regla general, que vale para cualquier campo que se añada a una
    // colección ya poblada: si no estaba, va con `opt()`. Sin excepciones.
    activeModules: opt(arrayOf(str({ maxLength: 40 }), { maxItems: 20 }))
});

/** Lo que ya hay en casa; se descuenta de la lista de la compra (V2-M4). */
export const validatePantry = rootValidator({
    items: arrayOf(objectOf({
        id: str({ maxLength: 80 }),
        name: str({ maxLength: 120 }),
        quantity: num({ min: 0, max: 100000 }),
        unit: str({ maxLength: 20 }),
        // Enlace al alimento, opcional. Lo pone la lista de la compra al marcar
        // algo como comprado (V2-M4), y es lo que hace que la siguiente lista lo
        // descuente sin depender de cómo esté escrito el nombre.
        foodId: opt(str({ maxLength: 80 })),
        expiresISO: opt(isoDate)
    }), { maxItems: 500 })
});

/** Recetas propias del usuario (V2-M2). */
export const validateRecipes = rootValidator({
    items: arrayOf(objectOf({
        id: str({ maxLength: 80 }),
        name: str({ maxLength: 120 }),
        servings: num({ min: 1, max: 50 }),
        ingredients: arrayOf(objectOf({
            name: str({ maxLength: 120 }),
            quantity: num({ min: 0, max: 100000 }),
            unit: str({ maxLength: 20 }),
            // Enlace a la base de alimentos, OPCIONAL a propósito: una receta
            // con «un chorrito de aceite» sigue siendo una receta válida. Sin
            // `foodId` no hay macros, y la interfaz lo dice en vez de inventarlas.
            foodId: opt(str({ maxLength: 80 }))
        }), { maxItems: 60 }),
        notes: opt(str({ maxLength: 2000 }))
    }), { maxItems: 300 })
});

/** Elecciones del usuario sobre suplementos; el stack se deriva (V2-M5). */
export const validateSupplementsPlan = rootValidator({
    excluded: arrayOf(str({ maxLength: 60 }), { maxItems: 100 }),
    chosen: arrayOf(str({ maxLength: 60 }), { maxItems: 100 })
});

/** Volumen semanal por grupo muscular, medido (V2-M6). */
export const validateVolumeLog = rootValidator({
    items: arrayOf(objectOf({
        weekStartISO: isoDate,
        muscleGroup: str({ maxLength: 40 }),
        sets: num({ min: 0, max: 200 })
    }), { maxItems: 3000 })
});

/** Pasos diarios; covariable del gasto medido (V2-M7). */
export const validateSteps = rootValidator({
    items: arrayOf(objectOf({
        dateISO: isoDate,
        steps: num({ min: 0, max: 200000, integer: true })
    }), { maxItems: 3000 })
});

// ============================================================
// Registro de colecciones y valores por defecto
// ============================================================

/**
 * Colecciones por perfil: nombre de clave corta → validador + factoría de
 * valor inicial. `storage.js` les añade el namespace `tl.5.<pid>.`.
 * @type {Readonly<Record<string, { validate: (v: unknown) => SchemaResult<*>, makeDefault: () => * }>>}
 */
export const COLLECTIONS = Object.freeze({
    profile: Object.freeze({
        validate: validateProfile,
        makeDefault: () => ({
            schemaVersion: SCHEMA_VERSION,
            name: 'Perfil',
            createdAtISO: '1970-01-01T00:00:00.000Z',
            user: { sex: 'male', age: 30, heightCm: 175, activityLevel: 'moderate', trainingStatus: 'beginner' },
            initial: { weightKg: 70, fatPct: 20, muscleKg: null, muscleSource: 'estimated' },
            target: { fatPct: 18, muscleKg: 28 },
            startDateISO: '1970-01-01',
            intensity: 'moderate'
        })
    }),
    plan: Object.freeze({
        validate: validatePlan,
        makeDefault: () => ({ schemaVersion: SCHEMA_VERSION, current: null, params: null, history: [] })
    }),
    checkins: Object.freeze({
        validate: validateCheckins,
        makeDefault: () => ({ schemaVersion: SCHEMA_VERSION, items: [] })
    }),
    training: Object.freeze({
        validate: validateTraining,
        makeDefault: () => ({ schemaVersion: SCHEMA_VERSION, routine: null, sessions: [] })
    }),
    nutrition: Object.freeze({
        validate: validateNutrition,
        makeDefault: () => ({ schemaVersion: SCHEMA_VERSION, mealTemplates: [] })
    }),
    photos: Object.freeze({
        validate: validatePhotos,
        makeDefault: () => ({ schemaVersion: SCHEMA_VERSION, items: [] })
    }),
    achievements: Object.freeze({
        validate: validateAchievements,
        makeDefault: () => ({ schemaVersion: SCHEMA_VERSION, unlocked: [] })
    }),
    settings: Object.freeze({
        validate: validateSettings,
        makeDefault: () => ({
            schemaVersion: SCHEMA_VERSION,
            locale: 'es',
            activeMeasures: ['waist'],
            fluctuationVisible: false,
            reminder: null
        })
    }),

    // --- Colecciones de la v2 (V2-M0) ---
    intakeLog: Object.freeze({
        validate: validateIntakeLog,
        makeDefault: () => ({ schemaVersion: SCHEMA_VERSION, items: [] })
    }),
    preferences: Object.freeze({
        validate: validatePreferences,
        makeDefault: () => ({
            schemaVersion: SCHEMA_VERSION,
            hardExclusions: [],
            softExclusions: [],
            dietType: null,
            mealsPerDay: null,
            householdSize: null,
            controlLevel: null,
            activeModules: []
        })
    }),
    pantry: Object.freeze({
        validate: validatePantry,
        makeDefault: () => ({ schemaVersion: SCHEMA_VERSION, items: [] })
    }),
    recipes: Object.freeze({
        validate: validateRecipes,
        makeDefault: () => ({ schemaVersion: SCHEMA_VERSION, items: [] })
    }),
    supplementsPlan: Object.freeze({
        validate: validateSupplementsPlan,
        makeDefault: () => ({ schemaVersion: SCHEMA_VERSION, excluded: [], chosen: [] })
    }),
    volumeLog: Object.freeze({
        validate: validateVolumeLog,
        makeDefault: () => ({ schemaVersion: SCHEMA_VERSION, items: [] })
    }),
    steps: Object.freeze({
        validate: validateSteps,
        makeDefault: () => ({ schemaVersion: SCHEMA_VERSION, items: [] })
    })
});

/**
 * Valor inicial válido de una colección.
 * @param {keyof typeof COLLECTIONS | string} collection
 * @returns {*}
 */
export function makeDefault(collection) {
    const spec = Object.hasOwn(COLLECTIONS, String(collection)) ? COLLECTIONS[String(collection)] : undefined;
    if (!spec) return null;
    return spec.makeDefault();
}

/**
 * Valida un valor contra la colección indicada.
 * @param {string} collection
 * @param {unknown} value
 * @returns {SchemaResult<*>}
 */
export function validateCollection(collection, value) {
    const spec = Object.hasOwn(COLLECTIONS, String(collection)) ? COLLECTIONS[String(collection)] : undefined;
    if (!spec) return { ok: false, errors: [{ code: 'schema.unknownCollection', path: String(collection) }] };

    // RED DE SEGURIDAD DE VERSIÓN (V2-M0). Un valor de una versión anterior se
    // migra EN MEMORIA antes de validarse, así que cualquier lectura funciona
    // desde el primer instante — incluso antes de que `migrations.migrateStore`
    // haya corrido, o si nunca corre. Sin esto, `rootValidator` rechazaba por
    // `schemaVersion !== 5` y la colección degradaba a vacía: pérdida
    // silenciosa, reproducida antes de escribir esto.
    //
    // Si la migración no es aplicable (no es objeto, falta la versión, viene
    // del futuro) se pasa el valor ORIGINAL al validador, para que produzca sus
    // códigos de error precisos en vez de uno genérico de migración.
    const upgraded = migrateValue(String(collection), value);
    if (upgraded.ok) return spec.validate(upgraded.value);
    return spec.validate(value);
}

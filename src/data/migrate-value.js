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
import { newItemId } from './ids.js';

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
    },
    6: {
        // Sin cambios de forma en el salto 6→7 tampoco: v7 cambia el NOMBRE de
        // las claves —el id de perfil va dentro— y no el contenido de ninguna
        // colección. La entrada tiene que existir igualmente: `migrateValue`
        // recorre `STEPS` desde la versión de origen hasta la vigente, y un
        // hueco en la cadena haría que un valor de la v6 se rechazara en vez de
        // subir de versión.
    },

    /**
     * 7 → 8 · LOS IDS DE ITEM PASAN A SER OPACOS.
     *
     * Los generadores construían `<prefijo>_<longitud+1>_<slug>`, deterministas
     * a propósito para no depender del reloj ni del azar. Dentro de un
     * dispositivo eso está bien; entre dos es una **certeza de colisión**, y con
     * nombres que un usuario escribe de verdad: «Press de banca con barra» y
     * «Press de banca con mancuernas» comparten los doce primeros caracteres
     * alfanuméricos, así que los dos salían `ex_1_Pressdeban`.
     *
     * En `training` eso no sería pérdida de datos sino algo peor: dos ejercicios
     * distintos con pesos musculares distintos bajo el mismo id, y las series de
     * uno atribuidas al grupo del otro. Un dato falso presentado como verdadero.
     */
    7: {
        pantry: (v) => rekeyLista(v, 'items', 'pantry'),
        recipes: (v) => rekeyLista(v, 'items', 'recipe'),
        nutrition: (v) => rekeyLista(v, 'mealTemplates', 'meal'),
        training: rekeyTraining,
        settings: limpiarSeriesHuerfanas
    }
};

/**
 * Reasigna los ids de una lista, conservando todo lo demás.
 *
 * Nada fuera de la propia colección referencia estos ids —lo verifica un
 * barrido— así que basta con cambiarlos en su sitio.
 *
 * @param {Record<string, unknown>} v
 * @param {string} campo
 * @param {string} prefijo
 * @returns {Record<string, unknown>}
 */
function rekeyLista(v, campo, prefijo) {
    const lista = v[campo];
    if (!Array.isArray(lista)) return v;
    return {
        ...v,
        [campo]: lista.map((item) => (item !== null && typeof item === 'object' && !Array.isArray(item)
            ? { ...item, id: newItemId(prefijo) }
            : item))
    };
}

/**
 * Reasigna los ids de los ejercicios **y las referencias de las sesiones**.
 *
 * Es la única transformación con una referencia interna: cada entrada de sesión
 * lleva un `exerciseId` que apunta a un ejercicio de la rutina. Se puede hacer
 * aquí porque las dos mitades viven en el MISMO valor de colección; si
 * estuvieran en colecciones distintas, `migrateValue` —que trabaja colección a
 * colección— no podría mantenerlas coherentes.
 *
 * Un `exerciseId` que no apunte a ningún ejercicio de la rutina se deja **tal
 * cual**: puede venir de una rutina que el usuario borró y cuyo historial
 * conserva. Inventarle un id nuevo lo desconectaría igual y encima borraría la
 * pista de a qué apuntaba.
 *
 * @param {Record<string, unknown>} v
 * @returns {Record<string, unknown>}
 */
function rekeyTraining(v) {
    /** @type {Record<string, string>} */ const mapa = {};

    const rutina = v.routine;
    let nuevaRutina = rutina;
    if (rutina !== null && typeof rutina === 'object' && !Array.isArray(rutina)
        && Array.isArray(/** @type {*} */ (rutina).days)) {
        nuevaRutina = {
            .../** @type {Record<string, unknown>} */ (rutina),
            days: /** @type {*[]} */ (/** @type {*} */ (rutina).days).map((dia) => {
                if (dia === null || typeof dia !== 'object' || !Array.isArray(dia.exercises)) return dia;
                return {
                    ...dia,
                    exercises: dia.exercises.map((/** @type {*} */ ex) => {
                        if (ex === null || typeof ex !== 'object' || typeof ex.id !== 'string') return ex;
                        const nuevo = newItemId('ex');
                        mapa[ex.id] = nuevo;
                        return { ...ex, id: nuevo };
                    })
                };
            })
        };
    }

    const sesiones = Array.isArray(v.sessions) ? v.sessions : [];
    const nuevasSesiones = sesiones.map((s) => {
        if (s === null || typeof s !== 'object' || !Array.isArray(s.entries)) return s;
        return {
            ...s,
            entries: s.entries.map((/** @type {*} */ e) => (e !== null && typeof e === 'object'
                && typeof e.exerciseId === 'string' && Object.hasOwn(mapa, e.exerciseId)
                ? { ...e, exerciseId: mapa[e.exerciseId] }
                : e))
        };
    });

    return { ...v, routine: nuevaRutina, sessions: nuevasSesiones };
}

/**
 * Quita de la vista Analizar las series que quedan colgando tras el rekey.
 *
 * `settings.analysis.seriesIds` guarda ids compuestos como
 * `est_e1rm__<exerciseId>`, y ese `exerciseId` acaba de cambiar. Son la ÚNICA
 * referencia a un id de item que vive fuera de su colección, y `migrateValue`
 * no puede resolverla —trabaja colección a colección—.
 *
 * Se quitan en vez de dejarlas: una serie seleccionada que ya no puede
 * corresponder con nada no falla, simplemente no aparece nunca. Quitarla es
 * explícito y le cuesta al usuario un clic; dejarla es una referencia muerta que
 * nadie va a limpiar.
 *
 * @param {Record<string, unknown>} v
 * @returns {Record<string, unknown>}
 */
function limpiarSeriesHuerfanas(v) {
    const analysis = v.analysis;
    if (analysis === null || typeof analysis !== 'object' || Array.isArray(analysis)) return v;
    const ids = /** @type {*} */ (analysis).seriesIds;
    if (!Array.isArray(ids)) return v;

    // Las parametrizadas llevan el separador `__`; las demás son series fijas y
    // no dependen de ningún id de item.
    const limpias = ids.filter((id) => typeof id === 'string' && !id.includes('__'));
    if (limpias.length === ids.length) return v;
    return { ...v, analysis: { .../** @type {Record<string, unknown>} */ (analysis), seriesIds: limpias } };
}

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

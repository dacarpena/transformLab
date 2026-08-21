// @ts-check

/**
 * Valores VÁLIDOS de cada colección, para probar la política de sincronización
 * (M9-2).
 *
 * ## Por qué no basta `makeDefault()`
 *
 * `makeDefault()` devuelve la colección VACÍA, y una lista vacía se parte y se
 * junta correctamente con cualquier implementación, incluida una rota. Un
 * invariante de ida y vuelta probado solo sobre listas vacías no prueba nada.
 *
 * Por eso cada colección tiene aquí varias formas, elegidas para pisar los
 * bordes donde `split`/`join` se rompe de verdad:
 *
 * - **vacía** — el caso degenerado, que también tiene que funcionar;
 * - **uno** — el caso mínimo con contenido;
 * - **varios** — donde se ve si el orden se conserva y si las claves colisionan;
 * - **sinOpcionales** — todos los campos `opt()` ausentes: es donde una copia
 *   descuidada los materializa como `undefined` y el validador los rechaza a la
 *   vuelta;
 * - **conOpcionales** — todos presentes;
 * - **bordes** — los máximos y mínimos del validador, y texto con caracteres que
 *   rompen cosas (comillas, acentos graves, emoji, saltos de línea).
 *
 * Todos los valores de aquí **pasan `validateCollection`**, y hay un test que lo
 * comprueba: un fixture inválido convertiría un fallo del invariante en una
 * discusión sobre el fixture.
 */

import { SCHEMA_VERSION } from '../../src/data/version.js';

/** Texto que rompe cosas: comillas, acento grave, emoji, salto de línea. */
const RARO = 'Ana «O\'Brien» `raro` 🥑\nsegunda línea';

const AT = '2026-05-01T08:30:00.000Z';
const d = (/** @type {number} */ n) => `2026-05-${String(n).padStart(2, '0')}`;

/** Un objeto de colección con su versión. */
const col = (/** @type {Record<string, unknown>} */ campos) => ({ schemaVersion: SCHEMA_VERSION, ...campos });

/** Un check-in completo. */
const checkin = (/** @type {number} */ n, /** @type {boolean} */ completo = true) => ({
    id: `ci_${d(n)}`,
    dateISO: d(n),
    weightKg: 90 - n * 0.1,
    fatPct: completo ? 24 - n * 0.05 : null,
    scaleMuscleKg: completo ? 40 + n * 0.02 : null,
    boneKg: completo ? 3.4 : null,
    measuresCm: completo ? { waist: 92 - n * 0.1, chest: 104 } : {},
    subjective: completo ? { energy: 7, sleep: 8, hunger: 4, mood: 7 } : {},
    notes: completo ? RARO : '',
    createdAtISO: AT,
    editedAtISO: completo ? '2026-05-02T09:00:00.000Z' : null
});

/**
 * Las formas de prueba de cada colección.
 *
 * @type {Record<string, Record<string, unknown>>}
 */
export const FIXTURES = {
    checkins: {
        vacia: col({ items: [] }),
        uno: col({ items: [checkin(1)] }),
        varios: col({ items: [1, 8, 15, 22].map((n) => checkin(n)) }),
        sinOpcionales: col({ items: [checkin(3, false)] }),
        bordes: col({
            items: [{
                ...checkin(9),
                weightKg: 20, fatPct: 0, notes: 'x'.repeat(500),
                measuresCm: {}, subjective: {}
            }]
        })
    },

    steps: {
        vacia: col({ items: [] }),
        uno: col({ items: [{ dateISO: d(1), steps: 8412 }] }),
        varios: col({ items: [1, 2, 3, 4, 5].map((n) => ({ dateISO: d(n), steps: 5000 + n * 137 })) }),
        bordes: col({ items: [{ dateISO: d(6), steps: 0 }, { dateISO: d(7), steps: 200000 }] })
    },

    intakeLog: {
        vacia: col({ items: [] }),
        uno: col({ items: [{ dateISO: d(1), kcal: 2400, proteinG: 180, carbsG: 240, fatG: 80 }] }),
        varios: col({ items: [1, 2, 3].map((n) => ({ dateISO: d(n), kcal: 2200 + n * 50, proteinG: 175, carbsG: 220, fatG: 75 })) }),
        // Los macros son opcionales: se puede apuntar solo las calorías.
        sinOpcionales: col({ items: [{ dateISO: d(4), kcal: 1980, proteinG: null, carbsG: null, fatG: null }] }),
        bordes: col({ items: [{ dateISO: d(5), kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }] })
    },

    volumeLog: {
        vacia: col({ items: [] }),
        uno: col({ items: [{ weekStartISO: d(4), muscleGroup: 'pecho', sets: 12 }] }),
        // La clave es COMPUESTA: la misma semana con grupos distintos, y el
        // mismo grupo en semanas distintas. Si `split` usara solo uno de los dos
        // campos, este caso perdería filas.
        varios: col({
            items: [
                { weekStartISO: d(4), muscleGroup: 'pecho', sets: 12 },
                { weekStartISO: d(4), muscleGroup: 'espalda', sets: 14 },
                { weekStartISO: d(11), muscleGroup: 'pecho', sets: 10 },
                { weekStartISO: d(11), muscleGroup: 'espalda', sets: 16 }
            ]
        }),
        bordes: col({ items: [{ weekStartISO: d(18), muscleGroup: 'x'.repeat(40), sets: 0 }] })
    },

    photos: {
        vacia: col({ items: [] }),
        uno: col({ items: [{ id: 'ph_1', dateISO: d(1), note: 'frontal' }] }),
        varios: col({ items: [1, 2, 3].map((n) => ({ id: `ph_${n}`, dateISO: d(n), note: `lado ${n}` })) }),
        sinOpcionales: col({ items: [{ id: 'ph_9', dateISO: d(9), note: null }] }),
        bordes: col({ items: [{ id: 'ph_x', dateISO: d(10), note: RARO }] })
    },

    pantry: {
        vacia: col({ items: [] }),
        uno: col({ items: [{ id: 'pa_1', name: 'Arroz', quantity: 1000, unit: 'g', foodId: 'usda_20450', expiresISO: d(30) }] }),
        varios: col({
            items: [1, 2, 3].map((n) => ({
                id: `pa_${n}`, name: `Alimento ${n}`, quantity: n * 100, unit: 'g',
                foodId: `usda_${n}`, expiresISO: d(20 + n)
            }))
        }),
        sinOpcionales: col({ items: [{ id: 'pa_9', name: RARO, quantity: 0, unit: 'ud', foodId: null, expiresISO: null }] }),
        bordes: col({ items: [{ id: 'pa_b', name: 'x'.repeat(120), quantity: 100000, unit: 'x'.repeat(20), foodId: null, expiresISO: null }] })
    },

    recipes: {
        vacia: col({ items: [] }),
        uno: col({
            items: [{
                id: 're_1', name: 'Tortilla', servings: 2,
                ingredients: [
                    { name: 'Huevo', quantity: 4, unit: 'ud', foodId: 'usda_1123' },
                    { name: 'Aceite', quantity: 10, unit: 'ml', foodId: null }
                ],
                notes: RARO
            }]
        }),
        varios: col({
            items: [1, 2].map((n) => ({
                id: `re_${n}`, name: `Receta ${n}`, servings: n,
                ingredients: [{ name: `Ing ${n}`, quantity: n, unit: 'g', foodId: null }],
                notes: null
            }))
        }),
        sinOpcionales: col({
            items: [{ id: 're_9', name: 'Simple', servings: 1, ingredients: [], notes: null }]
        })
    },

    nutrition: {
        vacia: col({ mealTemplates: [] }),
        uno: col({
            mealTemplates: [{
                id: 'mt_1', name: 'Desayuno',
                macros: { kcal: 520, proteinG: 35, carbsG: 55, fatG: 15 },
                notes: 'con avena'
            }]
        }),
        varios: col({
            mealTemplates: [1, 2, 3].map((n) => ({
                id: `mt_${n}`, name: `Comida ${n}`,
                macros: { kcal: 400 + n * 50, proteinG: 30, carbsG: 40, fatG: 12 },
                notes: null
            }))
        }),
        sinOpcionales: col({
            mealTemplates: [{ id: 'mt_9', name: RARO, macros: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0 }, notes: null }]
        })
    },

    training: {
        vacia: col({ routine: null, sessions: [] }),
        // Solo rutina, sin sesiones: es el estado justo después de crearla.
        soloRutina: col({
            routine: {
                days: [{
                    name: 'Empuje',
                    exercises: [
                        { id: 'ex_press', name: 'Press banca', sets: 4, reps: 8, loadKg: 60, catalogId: 'bench_press' },
                        { id: 'ex_fondos', name: 'Fondos', sets: 3, reps: 10, loadKg: null, catalogId: null }
                    ]
                }]
            },
            sessions: []
        }),
        // Sesiones sin rutina: pasa si el usuario borra la rutina y conserva su
        // historial. La política no puede dar por hecho que existan las dos.
        soloSesiones: col({
            routine: null,
            sessions: [{
                id: 'se_1', dateISO: d(2),
                entries: [{ exerciseId: 'ex_press', sets: [{ reps: 8, loadKg: 60 }, { reps: 7, loadKg: 60 }] }]
            }]
        }),
        completa: col({
            routine: {
                days: [
                    {
                        name: 'Empuje',
                        exercises: [{ id: 'ex_press', name: 'Press banca', sets: 4, reps: 8, loadKg: 60, catalogId: 'bench_press' }]
                    },
                    {
                        name: 'Tirón',
                        exercises: [{ id: 'ex_remo', name: 'Remo', sets: 4, reps: 10, loadKg: 50, catalogId: null }]
                    }
                ]
            },
            sessions: [1, 2, 3].map((n) => ({
                id: `se_${n}`, dateISO: d(n),
                entries: [{ exerciseId: n % 2 ? 'ex_press' : 'ex_remo', sets: [{ reps: 8, loadKg: 60 }] }]
            }))
        })
    },

    plan: {
        vacio: col({ current: null, params: null, history: [] }),
        // `history` con dos entradas archivadas por motivos distintos: es lo que
        // produce una recalibración.
        conHistorial: col({
            current: null,
            params: null,
            history: [
                { plan: null, params: null, archivedAtISO: '2026-05-01T10:00:00.000Z', reason: 'weightDeviation' },
                { plan: null, params: null, archivedAtISO: '2026-06-01T10:00:00.000Z', reason: 'expenditure' }
            ]
        })
    },

    achievements: {
        vacio: col({ unlocked: [] }),
        uno: col({ unlocked: [{ id: 'first_checkin', atISO: AT }] }),
        varios: col({
            unlocked: [
                { id: 'first_checkin', atISO: '2026-05-01T08:00:00.000Z' },
                { id: 'streak_4', atISO: '2026-05-22T08:00:00.000Z' },
                { id: 'first_kg', atISO: '2026-05-15T08:00:00.000Z' }
            ]
        })
    },

    profile: {
        base: col({
            name: 'Dani',
            createdAtISO: AT,
            user: { sex: 'male', age: 30, heightCm: 178, activityLevel: 'moderate', trainingStatus: 'intermediate' },
            initial: { weightKg: 90, fatPct: 24, muscleKg: null, muscleSource: 'estimated', scaleMuscleKg: null, boneKg: null },
            target: { fatPct: 15, muscleKg: 36, scaleMuscleKg: null },
            startDateISO: d(1),
            intensity: 'moderate'
        }),
        conMedido: col({
            name: RARO,
            createdAtISO: AT,
            user: { sex: 'female', age: 45, heightCm: 162, activityLevel: 'active', trainingStatus: 'advanced' },
            initial: { weightKg: 62, fatPct: 28, muscleKg: 24, muscleSource: 'measured', scaleMuscleKg: 25.3, boneKg: 2.4 },
            target: { fatPct: 22, muscleKg: 25, scaleMuscleKg: 26.3 },
            startDateISO: d(1),
            intensity: 'conservative'
        })
    },

    settings: {
        base: col({ locale: 'es', activeMeasures: ['waist'], fluctuationVisible: false, reminder: null }),
        conRecordatorio: col({
            locale: 'en', activeMeasures: ['waist', 'chest'], fluctuationVisible: true,
            reminder: { weekday: 1, hour: 8 }
        })
    },

    preferences: {
        base: col({
            hardExclusions: [], softExclusions: [], dietType: null, mealsPerDay: null,
            householdSize: null, controlLevel: null, activeModules: []
        }),
        // Las ALERGIAS: perder una es el peor fallo posible de esta colección.
        conAlergias: col({
            hardExclusions: ['gluten', 'frutos secos', 'marisco'],
            softExclusions: ['brócoli', RARO],
            dietType: 'mediterranea', mealsPerDay: 4, householdSize: 2,
            controlLevel: 'medio', activeModules: ['nutrition', 'training']
        })
    },

    supplementsPlan: {
        vacio: col({ excluded: [], chosen: [] }),
        conElecciones: col({ excluded: ['cafeina'], chosen: ['creatina', 'vitamina_d'] })
    }
};

/**
 * Todas las formas de una colección, como pares `[nombre, valor]`.
 * @param {string} collection
 * @returns {Array<[string, unknown]>}
 */
export function formasDe(collection) {
    return Object.entries(FIXTURES[collection] ?? {});
}

/**
 * Todas las formas de todas las colecciones, como tríos
 * `[colección, nombreDeLaForma, valor]`.
 * @returns {Array<[string, string, unknown]>}
 */
export function todasLasFormas() {
    /** @type {Array<[string, string, unknown]>} */ const out = [];
    for (const [coleccion, formas] of Object.entries(FIXTURES)) {
        for (const [nombre, valor] of Object.entries(formas)) out.push([coleccion, nombre, valor]);
    }
    return out;
}

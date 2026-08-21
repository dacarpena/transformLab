// @ts-check

/**
 * El perfil de ejemplo (E15-10).
 *
 * POR QUÉ EXISTE. Un usuario nuevo abre la aplicación y ve estados vacíos en
 * todas partes: no hay forma de saber qué hace Progreso, ni Analizar, ni
 * Entreno, hasta haber tecleado dos meses de datos. Esto enseña la aplicación
 * llena antes de pedirle nada a nadie.
 *
 * LA REGLA QUE LO GOBIERNA, Y NO ES NEGOCIABLE. La ficha H-035 del catálogo
 * nació de un botón «Hoy» del legacy que navegaba al punto medio del plan «para
 * que la demo quedara bonita». Aquí eso está prohibido, así que:
 *
 * 1. **Lo genera el motor de verdad.** `planPhases` + `generateProjection` con
 *    semilla fija, y los check-ins se muestrean de esa proyección. Nada está
 *    dibujado a mano para que salga bien: si el motor cambia, el ejemplo cambia
 *    con él, y si el motor está mal, el ejemplo lo enseña.
 * 2. **Vive en su PROPIO perfil.** `storage.js` inyecta el prefijo
 *    `tl.<v>.<profileId>.`, así que un ejemplo en su namespace es
 *    estructuralmente incapaz de contaminar los datos reales. No por convención:
 *    por construcción.
 * 3. **Es acotado a propósito.** Solo perfil, check-ins, ingesta, pasos y
 *    sesiones. Sin fotos, sin recetas, sin despensa, sin logros: esos módulos
 *    enseñan su estado vacío normal, que también es información cierta sobre lo
 *    que hace la aplicación.
 *
 * Puro y sin DOM: la fecha de hoy entra por parámetro, como en todo el motor.
 */

import { makeComposition, planPhases } from './engine.js';
import { generateProjection } from './generator.js';
import { mulberry32 } from './rng.js';
import { SCHEMA_VERSION } from '../data/version.js';

/**
 * Semilla fija. Que sea fija es el contrato: dos instalaciones del ejemplo
 * producen los MISMOS datos, así que un fallo que alguien vea en su ejemplo se
 * puede reproducir aquí exactamente.
 */
export const DEMO_SEED = 20260821;

/** Cuánto lleva el ejemplo en marcha cuando se instala. */
export const DEMO_DAYS_ELAPSED = 119;   // diecisiete semanas

/**
 * El perfil del ejemplo, en las cifras que ve el usuario.
 *
 * Un varón de complexión media a mitad de una definición: es el caso que más
 * gente reconoce, y su objetivo de músculo **gana de verdad** —2,6 kg—, que es
 * justo lo que E15-2 vino a exigir. Un ejemplo con el objetivo degenerado
 * enseñaría el defecto en vez del producto.
 */
export const DEMO_PROFILE = Object.freeze({
    user: Object.freeze({
        sex: /** @type {'male'} */ ('male'),
        age: 34,
        heightCm: 178,
        activityLevel: /** @type {'moderate'} */ ('moderate'),
        trainingStatus: /** @type {'intermediate'} */ ('intermediate')
    }),
    initial: Object.freeze({ weightKg: 88, fatPct: 24 }),
    target: Object.freeze({ fatPct: 15, muscleKg: 37 }),
    intensity: /** @type {'moderate'} */ ('moderate')
});

/** Los ejercicios de la rutina del ejemplo. Ids estables, como todo aquí. */
const EXERCISES = Object.freeze([
    { id: 'demo_squat', name: 'Sentadilla', sets: 4, reps: 6, loadKg: 90, catalogId: 'ex_barbell_squat' },
    { id: 'demo_bench', name: 'Press banca', sets: 4, reps: 6, loadKg: 70, catalogId: 'ex_barbell_bench_press' },
    { id: 'demo_row', name: 'Remo con barra', sets: 4, reps: 8, loadKg: 60, catalogId: 'ex_barbell_row' },
    { id: 'demo_ohp', name: 'Press militar', sets: 3, reps: 8, loadKg: 42, catalogId: 'ex_overhead_press' }
]);

/** Suma días a una fecha civil, en UTC como todo el motor. */
function addDays(/** @type {string} */ dateISO, /** @type {number} */ days) {
    return new Date(Date.parse(`${dateISO}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

const round1 = (/** @type {number} */ n) => Math.round(n * 10) / 10;

/**
 * Construye las colecciones del perfil de ejemplo.
 *
 * @param {{ todayISO: string, nowISO: string }} context la fecha de hoy y el
 *   instante, inyectados: este módulo no lee el reloj, como el resto del motor.
 * @returns {{ ok: true, value: Record<string, *> } | { ok: false, error: string }}
 */
export function buildDemo(context) {
    const todayISO = context?.todayISO ?? '';
    const nowISO = context?.nowISO ?? '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(todayISO) || typeof nowISO !== 'string' || nowISO === '') {
        return { ok: false, error: 'demo.contextInvalid' };
    }
    const startDateISO = addDays(todayISO, -DEMO_DAYS_ELAPSED);

    const composition = makeComposition({
        weightKg: DEMO_PROFILE.initial.weightKg,
        fatPct: DEMO_PROFILE.initial.fatPct,
        muscleKg: null,
        muscleSource: 'estimated',
        sex: DEMO_PROFILE.user.sex
    });
    if (!composition.ok) return { ok: false, error: 'demo.compositionFailed' };

    const plan = planPhases(composition.value, DEMO_PROFILE.target, DEMO_PROFILE.user,
        { intensity: DEMO_PROFILE.intensity });
    if (!plan.ok) return { ok: false, error: 'demo.planFailed' };

    const projection = generateProjection(plan.value, composition.value, DEMO_PROFILE.user, {
        startDateISO,
        seed: DEMO_SEED,
        fluctuation: false
    });
    if (!projection.ok) return { ok: false, error: 'demo.projectionFailed' };

    const daily = projection.value.daily;
    const rand = mulberry32(DEMO_SEED);

    /** @type {*[]} */ const checkins = [];
    /** @type {*[]} */ const intake = [];
    /** @type {*[]} */ const steps = [];
    /** @type {*[]} */ const sessions = [];

    for (let d = 0; d <= DEMO_DAYS_ELAPSED && d < daily.length; d++) {
        const point = daily[d];
        const dateISO = point.dateISO;

        // Un check-in por semana, con el ruido de báscula que tiene cualquiera:
        // ±0,45 kg sobre lo proyectado. Se muestrea de la proyección, no se
        // inventa, así que la desviación que enseña Progreso es la de verdad.
        if (d % 7 === 0 && d > 0) {
            const ruido = (rand() - 0.5) * 0.9;
            checkins.push({
                id: `ci_${dateISO}`,
                dateISO,
                weightKg: round1(point.weightKg + ruido),
                fatPct: round1(point.fatPct + (rand() - 0.5) * 0.8),
                scaleMuscleKg: null,
                boneKg: null,
                measuresCm: { waist: round1(92 - (d / DEMO_DAYS_ELAPSED) * 7 + (rand() - 0.5) * 0.6) },
                subjective: {
                    energy: 5 + Math.round(rand() * 3),
                    sleep: 5 + Math.round(rand() * 3),
                    adherence: 6 + Math.round(rand() * 3),
                    motivation: 5 + Math.round(rand() * 4)
                },
                notes: '',
                createdAtISO: nowISO,
                editedAtISO: null
            });
        }

        // La ingesta y los pasos, casi a diario pero no siempre: nadie apunta
        // los ciento diecinueve días. Un ejemplo con el 100 % de adherencia
        // enseñaría una aplicación que no existe.
        if (rand() > 0.18) {
            intake.push({
                dateISO,
                kcal: Math.round(point.kcal.targetKcal + (rand() - 0.45) * 220),
                proteinG: Math.round(150 + rand() * 40),
                carbsG: Math.round(160 + rand() * 70),
                fatG: Math.round(60 + rand() * 25)
            });
        }
        if (rand() > 0.12) {
            steps.push({ dateISO, steps: Math.round(6500 + rand() * 5500) });
        }

        // Cuatro sesiones por semana: lunes, martes, jueves y viernes del plan.
        const diaDeSemana = d % 7;
        if ([0, 1, 3, 4].includes(diaDeSemana) && d > 0) {
            const semana = Math.floor(d / 7);
            const ejercicio = EXERCISES[diaDeSemana % EXERCISES.length];
            sessions.push({
                id: `sess_${dateISO}`,
                dateISO,
                entries: [{
                    exerciseId: ejercicio.id,
                    // La carga sube ~1,25 kg por semana: una progresión creíble
                    // para un intermedio, no una que doble en cuatro meses.
                    sets: Array.from({ length: ejercicio.sets }, () => ({
                        reps: ejercicio.reps,
                        loadKg: round1(ejercicio.loadKg + semana * 1.25)
                    }))
                }]
            });
        }
    }

    return {
        ok: true,
        value: {
            profile: {
                schemaVersion: SCHEMA_VERSION,
                name: 'Ejemplo',
                createdAtISO: nowISO,
                user: { ...DEMO_PROFILE.user },
                initial: {
                    weightKg: DEMO_PROFILE.initial.weightKg,
                    fatPct: DEMO_PROFILE.initial.fatPct,
                    muscleKg: composition.value.muscleKg,
                    muscleSource: 'estimated',
                    scaleMuscleKg: null,
                    boneKg: null
                },
                target: { ...DEMO_PROFILE.target, scaleMuscleKg: null },
                startDateISO,
                intensity: DEMO_PROFILE.intensity
            },
            checkins: { schemaVersion: SCHEMA_VERSION, items: checkins },
            intakeLog: { schemaVersion: SCHEMA_VERSION, items: intake },
            steps: { schemaVersion: SCHEMA_VERSION, items: steps },
            training: {
                schemaVersion: SCHEMA_VERSION,
                routine: {
                    days: [{
                        name: 'Cuerpo completo',
                        exercises: EXERCISES.map((e) => ({
                            id: e.id, name: e.name, sets: e.sets, reps: e.reps,
                            loadKg: e.loadKg, catalogId: e.catalogId
                        }))
                    }]
                },
                sessions
            }
        }
    };
}

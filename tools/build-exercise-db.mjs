#!/usr/bin/env node
// @ts-check

/**
 * Cura el banco de ejercicios para empaquetarlo en la app (V2-M6).
 *
 * FUENTE: `yuhonas/free-exercise-db`, **Unlicense** (dominio público) —
 * comprobado descargando su `LICENSE.md`, que queda junto a los datos en
 * `vendor/data/exercises.LICENSE.md`. 873 ejercicios, todos con exactamente un
 * músculo primario y un vocabulario cerrado de 17 grupos.
 *
 * POR QUÉ SE CURA Y NO SE EMPAQUETA TAL CUAL:
 *
 * 1. **Peso.** El JSON crudo son 978 KB, y el 79 % de eso son las
 *    `instructions`. Los metadatos que necesita el motor —músculos, equipo,
 *    mecánica, nivel— caben en una fracción. Las 94 MB de imágenes se quedan
 *    fuera sin discusión: esto va precacheado en el móvil de alguien.
 * 2. **Procedencia.** La Unlicense está declarada sin ambigüedad, pero el estilo
 *    de los textos largos apunta a que el material se originó en un catálogo
 *    comercial. Los metadatos son hechos no protegibles; los textos largos y las
 *    fotos son donde estaría el riesgo. Empaquetar solo los hechos es a la vez
 *    lo ligero y lo prudente.
 * 3. **Vocabulario.** El dataset usa 17 grupos de la taxonomía de culturismo;
 *    el motor razona en 10 landmarks de volumen. La traducción vive aquí.
 *
 * Uso: node tools/build-exercise-db.mjs <entrada.json>
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * Traducción del vocabulario del dataset (17 grupos de culturismo) a los
 * landmarks de volumen del motor (10 grupos gruesos, los que tienen MEV/MAV
 * publicados).
 *
 * `null` = el grupo se descarta: no hay landmarks de volumen para cuello ni
 * antebrazo, y proyectar ganancia sobre un músculo del que no sabemos su dosis
 * mínima efectiva sería inventarse la cifra.
 * @type {Record<string, string | null>}
 */
const A_LANDMARK = {
    chest: 'chest',
    lats: 'back',
    'middle back': 'back',
    'lower back': 'back',
    traps: 'back',
    quadriceps: 'quads',
    hamstrings: 'hamstrings',
    glutes: 'glutes',
    shoulders: 'shoulders',
    biceps: 'biceps',
    triceps: 'triceps',
    abdominals: 'core',
    calves: 'calves',
    adductors: null,
    abductors: null,
    forearms: null,
    neck: null
};

/**
 * Overrides del músculo primario, y esta es la parte importante.
 *
 * EL PROBLEMA, MEDIDO. La taxonomía del dataset asigna UN primario por
 * ejercicio, con criterio de culturismo, y en la cadena posterior es
 * sencillamente errónea para proyectar volumen:
 *
 *   Barbell Deadlift  → primario «lower back»; glúteo e isquios, secundarios.
 *   Barbell Squat     → primario «quadriceps»; glúteo, secundario.
 *   Sumo Deadlift     → primario «hamstrings»; glúteo, secundario.
 *
 * De los 581 ejercicios de fuerza, **solo 11 tienen glúteo como primario**. Con
 * la regla «solo cuentan los sets del motor primario», alguien que sentadillea y
 * hace peso muerto tres veces por semana acumularía casi cero estímulo de
 * glúteo, y la proyección diría que no crece. El defecto que temíamos era doblar
 * el volumen indirecto; el real es el contrario, ANULARLO.
 *
 * LA SOLUCIÓN NO ES UNA TABLA DE EXCEPCIONES, ES UN PESO. Un músculo secundario
 * no recibe cero estímulo: recibe menos. Se cuenta con `SECONDARY_WEIGHT` en vez
 * de descartarse, que es a la vez más fiel a la fisiología y no exige mantener a
 * mano una lista de cientos de ejercicios.
 */
export const SECONDARY_WEIGHT = 0.4;

/** Peso del músculo primario. Referencia: un set completo. */
export const PRIMARY_WEIGHT = 1;

/** @param {string} name @returns {string} id estable y seguro para un selector */
function idOf(name) {
    return String(name).trim().toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * @param {Array<Record<string, *>>} raw
 * @returns {{ exercises: Array<Record<string, *>>, stats: Record<string, *> }}
 */
export function curate(raw) {
    /** @type {Array<Record<string, *>>} */ const out = [];
    /** @type {Set<string>} */ const seen = new Set();
    let sinLandmark = 0;

    for (const e of raw) {
        // Solo fuerza: estiramientos y cardio no acumulan volumen de hipertrofia
        // y solo añadirían peso al fichero.
        if (e.category !== 'strength') continue;

        /** @type {Record<string, number>} */ const muscles = {};
        for (const m of e.primaryMuscles ?? []) {
            const g = A_LANDMARK[m];
            if (g) muscles[g] = Math.max(muscles[g] ?? 0, PRIMARY_WEIGHT);
            else sinLandmark += 1;
        }
        for (const m of e.secondaryMuscles ?? []) {
            const g = A_LANDMARK[m];
            // `max`: si un grupo ya entró como primario (dos músculos finos del
            // mismo landmark, p. ej. lats + middle back), no lo degrada.
            if (g) muscles[g] = Math.max(muscles[g] ?? 0, SECONDARY_WEIGHT);
        }
        if (Object.keys(muscles).length === 0) continue;

        const id = idOf(e.id ?? e.name);
        if (seen.has(id)) continue;
        seen.add(id);

        out.push({
            id,
            name: String(e.name),
            muscles,
            equipment: e.equipment ?? 'other',
            mechanic: e.mechanic ?? null,
            force: e.force ?? null,
            level: e.level ?? 'intermediate'
        });
    }

    out.sort((a, b) => a.id.localeCompare(b.id));
    /** @type {Record<string, number>} */ const porGrupo = {};
    for (const e of out) {
        for (const [g, w] of Object.entries(e.muscles)) {
            if (w === PRIMARY_WEIGHT) porGrupo[g] = (porGrupo[g] ?? 0) + 1;
        }
    }
    return {
        exercises: out,
        stats: { total: out.length, primariosPorGrupo: porGrupo, descartadosSinLandmark: sinLandmark }
    };
}

const entrada = process.argv[2];
if (entrada) {
    const raw = JSON.parse(readFileSync(entrada, 'utf8'));
    const { exercises, stats } = curate(raw);
    const destino = join(ROOT, 'vendor/data/exercises.json');
    const payload = { source: 'yuhonas/free-exercise-db', license: 'Unlicense', exercises };
    writeFileSync(destino, JSON.stringify(payload));
    const bytes = readFileSync(destino).length;
    console.log(`${exercises.length} ejercicios · ${Math.round(bytes / 1024)} KB → ${destino}`);
    console.log('primarios por grupo:', stats.primariosPorGrupo);
}

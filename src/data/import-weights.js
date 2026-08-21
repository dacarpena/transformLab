// @ts-check

/**
 * Importar un histórico de pesos desde un CSV (E15-9).
 *
 * POR QUÉ EXISTE. La aplicación estaba vacía —cero check-ins— y todas las vistas
 * que «no funcionaban» son consumidoras de esos datos. E15-8 abarató apuntar el
 * peso de HOY; esto trae el pasado. Y la forma honesta de llenar un almacén vacío
 * no es inventarse datos: son los datos reales del usuario, que casi siempre ya
 * están en la aplicación de su báscula.
 *
 * TRES DECISIONES QUE NO SON DE FORMATO:
 *
 * **1. No se adivina el orden de las columnas: se reconoce el CONTENIDO.** Cada
 * báscula exporta lo suyo y en el orden que le parece. De cada fila se toma el
 * primer campo que sea una fecha y el primer número plausible como peso. Así da
 * igual que el fichero traiga tres columnas o doce, y que la fecha vaya primera o
 * última.
 *
 * **2. Nunca se sobrescribe un check-in existente.** Una fecha que ya tiene
 * registro se descarta y se CUENTA. El usuario puede haber medido perímetros ese
 * día, y un import no puede borrárselos: es la misma regla que `backup.apply`,
 * que crea perfiles nuevos y no pisa jamás.
 *
 * **3. Esta función NO escribe.** Devuelve lo que ha leído y lo que ha
 * descartado, con el motivo de cada descarte, para que la interfaz lo enseñe y
 * el usuario confirme. Es el contrato de dos pasos que `backup.js` estableció:
 * `inspect` mira, `apply` escribe, y entre los dos hay una persona.
 *
 * Puro y sin DOM: se prueba entero desde Node. NUNCA lanza — un CSV es un fichero
 * ajeno, y el vector hostil del producto son justamente los ficheros ajenos.
 */

import { LIMITS } from '../core/ranges.js';

/**
 * @typedef {{ dateISO: string, weightKg: number, line: number }} WeightRow
 * @typedef {{ line: number, reason: string, raw: string }} SkippedRow
 */

/**
 * Tope de tamaño. Diez años de pesos diarios son ~3 650 filas de unos 20 bytes:
 * 2 MiB dejan margen de sobra y cierran la puerta a que un fichero enorme
 * congele la pestaña mientras se parsea.
 */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** Cuántas filas se enseñan en la vista previa. */
export const PREVIEW_ROWS = 5;

/** Días del mes, con año bisiesto de verdad. */
function daysInMonth(/** @type {number} */ year, /** @type {number} */ month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Interpreta un campo como fecha civil, o `null`.
 *
 * Admite ISO (`AAAA-MM-DD`), europeo (`DD/MM/AAAA`, `DD-MM-AAAA`, `DD.MM.AAAA`)
 * y con hora pegada detrás, que es lo que sueltan varias aplicaciones de báscula
 * (`2026-01-05 07:31`). **No admite el orden americano**: `03/04/2026` es
 * ambiguo y adivinar es peor que rechazar — se documenta y se descarta la fila.
 * @param {string} raw
 * @returns {string | null}
 */
export function parseDate(raw) {
    const s = String(raw ?? '').trim().replace(/^["']|["']$/g, '');
    if (s === '') return null;
    // Se recorta cualquier hora pegada detrás.
    const solo = s.split(/[T\s]/)[0];

    let y; let m; let d;
    const iso = solo.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    const eur = solo.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
    if (iso) { [, y, m, d] = iso.map(Number); }
    else if (eur) { [, d, m, y] = eur.map(Number); }
    else return null;

    if (!(y >= 1900 && y <= 2999)) return null;
    if (!(m >= 1 && m <= 12)) return null;
    if (!(d >= 1 && d <= daysInMonth(y, m))) return null;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Interpreta un campo como número, con coma o punto decimal.
 * @param {string} raw
 * @returns {number | null}
 */
export function parseNumber(raw) {
    const s = String(raw ?? '').trim().replace(/^["']|["']$/g, '');
    if (s === '') return null;
    // Se quita la unidad si viene pegada («74,2 kg»).
    const limpio = s.replace(/\s*(kg|kgs|lb|lbs)\s*$/i, '').trim();
    if (!/^[+-]?\d+([.,]\d+)?$/.test(limpio)) return null;
    const n = Number(limpio.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
}

/**
 * El separador de columnas del fichero.
 *
 * `;` primero, y luego el tabulador: los dos son inequívocos. La coma va la
 * última porque en un fichero español es el separador DECIMAL, y elegirla cuando
 * hay punto y coma convertiría «74,2» en dos columnas.
 * @param {string[]} lines
 * @returns {string}
 */
export function detectSeparator(lines) {
    const muestra = lines.slice(0, 20).join('\n');
    if (muestra.includes(';')) return ';';
    if (muestra.includes('\t')) return '\t';
    return ',';
}

/**
 * Parte una línea en campos, respetando las comillas.
 * @param {string} line
 * @param {string} sep
 * @returns {string[]}
 */
function splitLine(line, sep) {
    /** @type {string[]} */ const out = [];
    let actual = '';
    let entreComillas = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (entreComillas && line[i + 1] === '"') { actual += '"'; i++; }
            else entreComillas = !entreComillas;
            continue;
        }
        if (ch === sep && !entreComillas) { out.push(actual); actual = ''; continue; }
        actual += ch;
    }
    out.push(actual);
    return out;
}

/** Índice de día de una fecha civil respecto a otra, en UTC. */
function dayIndexOf(/** @type {string} */ dateISO, /** @type {string} */ startISO) {
    const a = Date.parse(`${dateISO}T00:00:00Z`);
    const b = Date.parse(`${startISO}T00:00:00Z`);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    return Math.round((a - b) / 86400000);
}

/**
 * Lee el fichero y dice qué ha entendido y qué ha descartado. NO escribe nada.
 *
 * @param {string} text contenido del CSV
 * @param {{ existingDates?: string[], plan?: { startDateISO: string, totalDays: number } | null }} [options]
 * @returns {{ ok: true, value: { rows: WeightRow[], skipped: SkippedRow[], firstISO: string|null, lastISO: string|null } }
 *         | { ok: false, error: string }}
 */
export function inspect(text, options = {}) {
    if (typeof text !== 'string') return { ok: false, error: 'importWeights.notText' };
    if (text.length * 2 > MAX_IMPORT_BYTES) return { ok: false, error: 'importWeights.tooLarge' };

    // BOM fuera (Excel lo escribe siempre) y CRLF normalizado.
    const limpio = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const lines = limpio.split('\n');
    const sep = detectSeparator(lines);

    const existing = new Set(options.existingDates ?? []);
    const plan = options.plan ?? null;
    const { min: pesoMin, max: pesoMax } = LIMITS.weightKg;

    /** @type {WeightRow[]} */ const rows = [];
    /** @type {SkippedRow[]} */ const skipped = [];
    /** @type {Set<string>} */ const vistas = new Set();

    lines.forEach((line, i) => {
        const numero = i + 1;
        if (line.trim() === '') return;                 // línea vacía: ni fila ni descarte
        const campos = splitLine(line, sep);

        // El CONTENIDO manda, no la posición: la primera fecha y el primer número
        // plausible. Así la cabecera se descarta sola —sus campos no son ni
        // fecha ni número— sin tener que reconocer sus nombres en dos idiomas.
        const dateISO = campos.map(parseDate).find((v) => v !== null) ?? null;
        if (dateISO === null) {
            // Solo se cuenta como descarte si la línea parecía traer datos.
            if (campos.some((c) => parseNumber(c) !== null)) {
                skipped.push({ line: numero, reason: 'importWeights.noDate', raw: line.slice(0, 80) });
            }
            return;
        }

        const numeros = campos.map(parseNumber).filter((/** @type {number|null} */ v) => v !== null);
        const weightKg = numeros.find((n) => n >= pesoMin && n <= pesoMax) ?? null;
        if (weightKg === null) {
            skipped.push({
                line: numero,
                reason: numeros.length === 0 ? 'importWeights.noWeight' : 'importWeights.weightOutOfRange',
                raw: line.slice(0, 80)
            });
            return;
        }

        if (vistas.has(dateISO)) {
            skipped.push({ line: numero, reason: 'importWeights.duplicateInFile', raw: line.slice(0, 80) });
            return;
        }
        if (existing.has(dateISO)) {
            // Nunca se pisa: ese día puede llevar perímetros, notas o escalas.
            skipped.push({ line: numero, reason: 'importWeights.alreadyExists', raw: line.slice(0, 80) });
            return;
        }
        if (plan) {
            const idx = dayIndexOf(dateISO, plan.startDateISO);
            if (idx === null || idx < 0 || idx > plan.totalDays) {
                skipped.push({ line: numero, reason: 'importWeights.outOfPlan', raw: line.slice(0, 80) });
                return;
            }
        }

        vistas.add(dateISO);
        rows.push({ dateISO, weightKg, line: numero });
    });

    if (rows.length === 0) {
        return { ok: false, error: skipped.length > 0 ? 'importWeights.allSkipped' : 'importWeights.noRows' };
    }

    rows.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    return {
        ok: true,
        value: { rows, skipped, firstISO: rows[0].dateISO, lastISO: rows[rows.length - 1].dateISO }
    };
}

/**
 * Escribe las filas que `inspect` aprobó.
 *
 * `save` se INYECTA en vez de importar `checkins.js`: así este módulo sigue sin
 * tocar el almacén y se prueba entero desde Node, que es la misma costura que ya
 * usan `foods-db.js` con `fetchImpl` y `profiles.js` con los ids.
 *
 * Se para en el primer fallo y DEVUELVE lo escrito: un import a medias que
 * miente sobre cuánto entró es peor que uno que se para y lo dice.
 *
 * @param {WeightRow[]} rows
 * @param {{ save: (input: *, ctx: { nowISO: string }) => { ok: boolean, error?: string }, nowISO: string }} deps
 * @returns {{ ok: true, imported: number } | { ok: false, imported: number, error: string, dateISO: string }}
 */
export function applyRows(rows, deps) {
    let imported = 0;
    for (const row of rows ?? []) {
        const saved = deps.save({ dateISO: row.dateISO, weightKg: row.weightKg }, { nowISO: deps.nowISO });
        if (!saved.ok) {
            return { ok: false, imported, error: saved.error ?? 'error.generic', dateISO: row.dateISO };
        }
        imported++;
    }
    return { ok: true, imported };
}

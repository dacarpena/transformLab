// @ts-check

/**
 * Exportación a CSV de las series comparadas (E13-6).
 *
 * TRES DECISIONES QUE NO SON DE FORMATO, SON DE PRODUCTO:
 *
 * **1. La PROCEDENCIA viaja en la cabecera.** `Peso previsto (kg · Prevista)`.
 * Una hoja de cálculo es exactamente donde la v4.0 hizo su daño: cifras
 * estimadas mezcladas con medidas, sin nada que las distinga, tratadas después
 * como si todas fueran datos. Si la app lo sabe y la exportación lo calla, el
 * fichero es un arma cargada.
 *
 * **2. Las fechas van en ISO, siempre.** `AAAA-MM-DD` es inequívoco, ordena
 * bien como texto y lo parsea cualquier hoja de cálculo. Las fechas legibles son
 * para la pantalla; un CSV lo lee una máquina antes que una persona.
 *
 * **3. El separador y los decimales siguen el idioma.** En español, `;` y coma
 * decimal — que es lo que espera un Excel configurado en español, y abrir un CSV
 * con puntos decimales ahí convierte «74,2» en la fecha 74 de febrero. Es la
 * misma razón por la que existe `format.js`.
 *
 * Y una guarda de seguridad que no se ve: los campos que empiezan por `=`, `+`,
 * `-` o `@` se prefijan con un apóstrofo. Sin eso, un texto controlado por quien
 * escribió un backup se convierte en una FÓRMULA en cuanto alguien abre el
 * fichero. Aquí no viaja texto del usuario a propósito, pero la guarda va igual:
 * el día que alguien añada una columna de notas, ya estará cerrada.
 */

import { getLocale } from '../i18n/i18n.js';

/** Los idiomas que usan coma decimal y, por tanto, punto y coma como separador. */
const COMMA_DECIMAL_LOCALES = Object.freeze(['es']);

/** Caracteres que una hoja de cálculo interpreta como principio de fórmula. */
const FORMULA_PREFIXES = Object.freeze(['=', '+', '-', '@', '\t', '\r']);

/**
 * El separador de columnas del idioma activo.
 * @returns {string}
 */
export function separator() {
    return COMMA_DECIMAL_LOCALES.includes(getLocale()) ? ';' : ',';
}

/**
 * Escapa un campo para CSV, cerrando de paso la inyección de fórmulas.
 * @param {string|number|null|undefined} value
 * @returns {string}
 */
export function escapeField(value) {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (FORMULA_PREFIXES.some((p) => text.startsWith(p))) text = `'${text}`;
    // Comillas, separadores y saltos obligan a entrecomillar; las comillas
    // internas se duplican, que es lo que dice RFC 4180.
    if (/["\n\r]/.test(text) || text.includes(separator())) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

/**
 * Formatea un número para la hoja de cálculo.
 *
 * NO usa `Intl`: los separadores de MILES romperían el campo (un «13.000» con
 * punto de millar es otro número, o dos columnas). Solo cambia el separador
 * decimal, que es lo único que la hoja necesita para interpretarlo bien.
 * @param {number|null|undefined} value
 * @param {number} digits
 * @returns {string}
 */
export function formatNumber(value, digits) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '';
    const text = value.toFixed(digits);
    return COMMA_DECIMAL_LOCALES.includes(getLocale()) ? text.replace('.', ',') : text;
}

/**
 * Construye el CSV completo.
 *
 * @param {{ headers: string[], rows: Array<Array<string|number|null>> }} table
 * @returns {string} con BOM UTF-8 al principio
 */
export function toCsv(table) {
    const sep = separator();
    const lines = [table.headers.map(escapeField).join(sep)];
    for (const row of table.rows) lines.push(row.map(escapeField).join(sep));
    // BOM: sin él, Excel abre el fichero en Latin-1 y destroza los acentos —
    // «Cintura» sobrevive, «Adherencia · Estimada» no.
    return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * Un `Blob` listo para descargar.
 * @param {string} csv
 * @returns {Blob}
 */
export function toBlob(csv) {
    return new Blob([csv], { type: 'text/csv;charset=utf-8' });
}

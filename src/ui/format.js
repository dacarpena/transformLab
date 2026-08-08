// @ts-check

/**
 * Formateo de cifras para la interfaz (decisión M7).
 *
 * POR QUÉ EXISTE. Este helper vivía copiado en siete ficheros: cinco copias
 * literales de `num()`, una renombrada a `num1()` en `muscle-units.js`, y una
 * séptima **que se llama igual y hace otra cosa** — la de `nutrition.js`
 * redondeaba a entero. Copiar esa vista como plantilla para una nueva te
 * llevaba el redondeo sin avisar, y esa es exactamente la clase de accidente
 * que este módulo evita.
 *
 * La divergencia ya había cobrado su precio con los bytes: `photos.js` no
 * tenía la rama de bytes que sí tenía `settings.js`, así que una foto de 500 B
 * se leía **«0 KB» en Fotos y «500 B» en Ajustes**. El mismo dato, dos
 * respuestas, en la misma aplicación.
 *
 * Regla: aquí van las cifras; las fechas viven en `dates.js`. Ninguna de las
 * dos cosas se vuelve a escribir a mano en una vista.
 *
 * El guion largo `—` para lo que no es un número finito no es decorativo: es
 * lo que impide que un `NaN` o un `undefined` se cuelen en la pantalla como
 * «NaN» o «undefined», que es lo que hacía el legacy.
 */

/** Lo que se muestra cuando no hay una cifra que mostrar. */
const NO_VALUE = '—';

/**
 * Cifra con decimales fijos. El formato por defecto de casi toda la app.
 * @param {unknown} value
 * @param {number} [digits] decimales, 1 por defecto
 * @returns {string}
 */
export function num(value, digits = 1) {
    return typeof value === 'number' && Number.isFinite(value)
        ? value.toFixed(digits)
        : NO_VALUE;
}

/**
 * Cifra redondeada a entero. Es la que usa Nutrición: los gramos y las
 * kilocalorías no tienen decimales que signifiquen nada.
 * @param {unknown} value
 * @returns {string}
 */
export function int(value) {
    return typeof value === 'number' && Number.isFinite(value)
        ? String(Math.round(value))
        : NO_VALUE;
}

/**
 * Cifra con su signo delante, para deltas. Un «+0,4 kg» dice algo que «0,4 kg»
 * no dice.
 * @param {unknown} value
 * @param {number} [digits]
 * @returns {string}
 */
export function signed(value, digits = 1) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return NO_VALUE;
    return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

/**
 * Tamaño en bytes, legible.
 *
 * La rama de bytes importa: sin ella, todo lo que pese menos de 1 KB se lee
 * «0 KB», que para una foto diminuta o una cuota casi vacía es sencillamente
 * falso.
 * @param {unknown} bytes
 * @returns {string}
 */
export function bytes(bytes) {
    if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return NO_VALUE;
    if (bytes < 1024) return `${Math.round(bytes)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

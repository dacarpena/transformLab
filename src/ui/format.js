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
 * SE FORMATEA EN EL IDIOMA DEL USUARIO, y esto llegó tarde y a propósito. Hasta
 * la v2 todo el módulo usaba `toFixed`, que **siempre** escribe punto decimal:
 * la app entera decía «82.8 kg» a un usuario español, donde se escribe
 * «82,8 kg». No era un descuido de una vista, era transversal a las doce, y por
 * eso se arregla aquí y solo aquí. `Intl.NumberFormat` con el idioma activo
 * pone además el separador de millares correcto —«2.437 kcal» en español,
 * «2,437 kcal» en inglés— que `String(Math.round(v))` tampoco ponía.
 *
 * Regla: aquí van las cifras; las fechas viven en `dates.js`. Ninguna de las
 * dos cosas se vuelve a escribir a mano en una vista. **`toFixed` no se usa en
 * `src/ui/` fuera de este fichero**, y hay un test que lo impone; la única
 * excepción es la geometría de un SVG, que no es texto que nadie lea.
 *
 * El guion largo `—` para lo que no es un número finito no es decorativo: es
 * lo que impide que un `NaN` o un `undefined` se cuelen en la pantalla como
 * «NaN» o «undefined», que es lo que hacía el legacy.
 */

import { getLocale } from '../i18n/i18n.js';

/** Lo que se muestra cuando no hay una cifra que mostrar. */
const NO_VALUE = '—';

/**
 * Formateadores ya construidos, por idioma y número de decimales.
 *
 * Construir un `Intl.NumberFormat` no es gratis y estas funciones se llaman
 * dentro de bucles —diez grupos musculares, veinticinco resultados de búsqueda,
 * doscientos puntos de una serie—. La caché se indexa por idioma porque el
 * usuario puede cambiarlo en caliente desde Ajustes: guardar un solo formateador
 * dejaría la app en el idioma con el que arrancó.
 * @type {Map<string, Intl.NumberFormat>}
 */
const formatters = new Map();

/** @param {number} digits @returns {Intl.NumberFormat} */
function formatterFor(digits) {
    const locale = getLocale();
    const key = `${locale}:${digits}`;
    let formatter = formatters.get(key);
    if (!formatter) {
        formatter = new Intl.NumberFormat(locale, {
            minimumFractionDigits: digits,
            maximumFractionDigits: digits
        });
        formatters.set(key, formatter);
    }
    return formatter;
}

/**
 * Cifra con decimales fijos, en el idioma del usuario.
 * @param {unknown} value
 * @param {number} [digits] decimales, 1 por defecto
 * @returns {string}
 */
export function num(value, digits = 1) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return NO_VALUE;
    return formatterFor(digits).format(value);
}

/**
 * Cifra redondeada a entero. Es la que usa Nutrición: los gramos y las
 * kilocalorías no tienen decimales que signifiquen nada.
 * @param {unknown} value
 * @returns {string}
 */
export function int(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return NO_VALUE;
    return formatterFor(0).format(Math.round(value));
}

/**
 * Cifra con su signo delante, para deltas. Un «+0,4 kg» dice algo que «0,4 kg»
 * no dice.
 *
 * El signo se pone a mano y no con `signDisplay: 'always'` de `Intl` por una
 * razón concreta: `signDisplay` escribe el menos tipográfico `−` (U+2212) en
 * algunos idiomas, y el resto de la app usa el guion normal. Dos menos distintos
 * en la misma pantalla se ven.
 * @param {unknown} value
 * @param {number} [digits]
 * @returns {string}
 */
export function signed(value, digits = 1) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return NO_VALUE;
    return `${value >= 0 ? '+' : ''}${num(value, digits)}`;
}

/**
 * Tamaño en bytes, legible.
 *
 * La rama de bytes importa: sin ella, todo lo que pese menos de 1 KB se lee
 * «0 KB», que para una foto diminuta o una cuota casi vacía es sencillamente
 * falso.
 * @param {unknown} value
 * @returns {string}
 */
export function bytes(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return NO_VALUE;
    if (value < 1024) return `${int(value)} B`;
    if (value < 1024 * 1024) return `${num(value / 1024, 0)} KB`;
    return `${num(value / (1024 * 1024), 1)} MB`;
}

/** Olvida los formateadores cacheados. Solo para los tests. */
export function resetFormatters() {
    formatters.clear();
}

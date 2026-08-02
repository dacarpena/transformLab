// @ts-check

/**
 * PRNG determinista con semilla (decisión B8): misma semilla → misma secuencia.
 * `Math.random` está prohibido en src/ (hay un test que lo garantiza).
 */

/**
 * mulberry32 — PRNG de 32 bits, rápido y con buena distribución para
 * simulación ligera (no criptográfico).
 * @param {number} seed entero de 32 bits
 * @returns {() => number} generador de números en [0, 1)
 */
export function mulberry32(seed) {
    let state = seed >>> 0;
    return function next() {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Deriva una semilla de 32 bits a partir del perfil y la fecha de inicio
 * (hash FNV-1a). Determinista: mismas entradas → misma semilla.
 * @param {string} profileId
 * @param {string} startDateISO 'YYYY-MM-DD'
 * @returns {number}
 */
export function seedFrom(profileId, startDateISO) {
    const input = `${profileId}|${startDateISO}`;
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

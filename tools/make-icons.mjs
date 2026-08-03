// @ts-check

/**
 * Genera los iconos PNG de la PWA (M6-1) sin dependencias.
 *
 * El proyecto no admite dependencias de runtime y tampoco quiere una de build
 * solo para pintar seis cuadrados (CLAUDE.md §5), así que el PNG se escribe a
 * mano: cabecera, IHDR, IDAT comprimido con `zlib` (que viene con Node) e
 * IEND. Es determinista: mismo código, mismos bytes.
 *
 * La marca es el producto: una banda de escenarios y, dentro, la trayectoria
 * esperada. No es un logotipo bonito porque sí; es lo que la app dibuja.
 *
 * Uso: node tools/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Colores, copiados de `css/tokens.css`. Si allí cambian, aquí también. */
const BG = [0x0a, 0x0a, 0x0f];
const ACCENT = [0x4c, 0xc9, 0xf0];
const BAND = [0x1e, 0x1e, 0x2b];

const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        table[n] = c;
    }
    return table;
})();

/** @param {Buffer} buf */
function crc32(buf) {
    let c = -1;
    for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
}

/** @param {string} type @param {Buffer} data */
function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
}

/**
 * @param {number} size
 * @param {(x: number, y: number) => [number, number, number]} pixel
 * @returns {Buffer} PNG RGB de 8 bits
 */
function png(size, pixel) {
    // scanlines con byte de filtro 0 (ninguno) al inicio de cada fila
    const raw = Buffer.alloc(size * (size * 3 + 1));
    let p = 0;
    for (let y = 0; y < size; y += 1) {
        raw[p] = 0;
        p += 1;
        for (let x = 0; x < size; x += 1) {
            const [r, g, b] = pixel(x, y);
            raw[p] = r; raw[p + 1] = g; raw[p + 2] = b;
            p += 3;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8] = 8;   // profundidad
    ihdr[9] = 2;   // color RGB
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

/** @param {number[]} a @param {number[]} b @param {number} t */
function mix(a, b, t) {
    const k = Math.min(1, Math.max(0, t));
    return /** @type {[number, number, number]} */ ([
        Math.round(a[0] + (b[0] - a[0]) * k),
        Math.round(a[1] + (b[1] - a[1]) * k),
        Math.round(a[2] + (b[2] - a[2]) * k)
    ]);
}

/**
 * La marca. `inset` deja margen para la zona segura de los iconos maskable:
 * Android recorta hasta un 20 % por cada lado, así que el dibujo se encoge
 * al 60 % central y el resto queda de fondo liso.
 * @param {number} size
 * @param {number} inset fracción del lado que ocupa el margen (0 = a sangre)
 */
function mark(size, inset) {
    const pad = size * inset;
    const inner = size - pad * 2;

    /** Trayectoria esperada: baja de izquierda a derecha (se pierde grasa). */
    const curve = (u) => 0.30 + 0.42 * Math.pow(u, 1.7);
    /** Semiancho de la banda de escenarios: se abre con el tiempo. */
    const spread = (u) => 0.035 + 0.115 * u;

    return (/** @type {number} */ x, /** @type {number} */ y) => {
        const u = (x - pad) / inner;
        const v = (y - pad) / inner;
        if (u < 0 || u > 1 || v < 0 || v > 1) return /** @type {[number,number,number]} */ (BG);

        const center = curve(u);
        const dist = Math.abs(v - center);
        const half = spread(u);
        const stroke = 0.055;

        // antialias barato: se difumina el borde en una franja de 1,5 px
        const soft = 1.5 / inner;
        /** @type {[number, number, number]} */ let color = BG;
        if (dist < stroke) color = mix(ACCENT, BG, Math.max(0, (dist - (stroke - soft)) / soft));
        else if (dist < half) color = mix(BAND, BG, Math.max(0, (dist - (half - soft)) / soft));
        else return /** @type {[number,number,number]} */ (BG);

        // Los extremos se apagan en lugar de cortarse en seco: si no, el
        // dibujo parece recortado por el borde del icono en vez de acabado.
        const fade = Math.min(1, Math.min(u, 1 - u) / 0.06);
        return mix(BG, color, fade * fade * (3 - 2 * fade));
    };
}

mkdirSync(join(ROOT, 'icons'), { recursive: true });

const OUTPUTS = [
    { file: 'icon-192.png', size: 192, inset: 0.10 },
    { file: 'icon-512.png', size: 512, inset: 0.10 },
    { file: 'icon-maskable-192.png', size: 192, inset: 0.20 },
    { file: 'icon-maskable-512.png', size: 512, inset: 0.20 },
    { file: 'apple-touch-icon.png', size: 180, inset: 0.12 },
    { file: 'og-image.png', size: 512, inset: 0.10 }
];

for (const out of OUTPUTS) {
    const buffer = png(out.size, mark(out.size, out.inset));
    writeFileSync(join(ROOT, 'icons', out.file), buffer);
    console.log(`${out.file.padEnd(26)} ${out.size}×${out.size}  ${buffer.length} bytes`);
}

// @ts-check

/**
 * Comprimir una foto antes de guardarla (M9-5).
 *
 * `node:test` no tiene `createImageBitmap` ni lienzos, así que lo que se prueba
 * aquí es lo que de verdad decide el resultado y sí es puro: **la aritmética del
 * escalado** y **cómo degrada cuando el navegador no puede**.
 *
 * Esa segunda parte importa más de lo que parece. Una foto que no se puede
 * comprimir tiene que guardarse igualmente: perderla porque el navegador no
 * tiene `OffscreenCanvas` sería cambiar un problema de tamaño por uno de datos.
 * Y como todos los caminos de fallo devuelven el original, es fácil que uno se
 * rompa sin que nadie lo note — de ahí que se recorran uno a uno.
 *
 * El recorrido de verdad, con una imagen real y un navegador real, va en
 * `test/e2e/photos.spec.js`.
 */

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { compress, escalar, MAX_SIDE, QUALITY } from '../src/ui/image-compress.js';

/** @type {*} */ const original = {
    createImageBitmap: /** @type {*} */ (globalThis).createImageBitmap,
    OffscreenCanvas: /** @type {*} */ (globalThis).OffscreenCanvas
};

afterEach(() => {
    for (const [k, v] of Object.entries(original)) {
        if (v === undefined) delete /** @type {*} */ (globalThis)[k];
        else /** @type {*} */ (globalThis)[k] = v;
    }
});

/* ── El escalado ─────────────────────────────────────────────────────────── */

test('una imagen que ya cabe NO se agranda', () => {
    // Agrandar no añade información: solo pesa más y se ve peor.
    assert.deepEqual(escalar(800, 600, MAX_SIDE), { width: 800, height: 600 });
    assert.deepEqual(escalar(MAX_SIDE, 900, MAX_SIDE), { width: MAX_SIDE, height: 900 });
});

test('el lado mayor manda, y la proporción se conserva', () => {
    // Horizontal.
    assert.deepEqual(escalar(4000, 3000, 1600), { width: 1600, height: 1200 });
    // Vertical, que es como se hacen las fotos de progreso.
    assert.deepEqual(escalar(3000, 4000, 1600), { width: 1200, height: 1600 });
    // Cuadrada.
    assert.deepEqual(escalar(4000, 4000, 1600), { width: 1600, height: 1600 });
});

test('una panorámica extrema no acaba con un lado de cero', () => {
    // Un lienzo de altura cero lanza al dibujar, y la foto se perdería por un
    // redondeo.
    const r = escalar(20000, 30, 1600);
    assert.equal(r.width, 1600);
    assert.ok(r.height >= 1, `altura ${r.height}: un lienzo así no se puede dibujar`);
});

test('dimensiones imposibles no revientan la cuenta', () => {
    for (const [w, h] of [[0, 0], [-4, 10], [NaN, 100], [Infinity, 10]]) {
        const r = escalar(w, h, 1600);
        assert.ok(Number.isFinite(r.width) && r.width >= 1, `ancho ${r.width} para ${w}×${h}`);
        assert.ok(Number.isFinite(r.height) && r.height >= 1, `alto ${r.height} para ${w}×${h}`);
    }
});

/* ── La degradación ──────────────────────────────────────────────────────── */

const foto = () => new Blob([new Uint8Array(50_000).fill(7)], { type: 'image/jpeg' });

/** Comprueba que se devolvió el original, intacto y marcado como tal. */
async function esElOriginal(/** @type {*} */ r, /** @type {Blob} */ entrada) {
    assert.equal(r.compressed, false, 'dijo que había comprimido');
    assert.equal(r.blob, entrada, 'no devolvió el MISMO blob');
    assert.equal(r.contentType, 'image/jpeg');
}

test('sin `createImageBitmap`, la foto se guarda como vino', async () => {
    delete /** @type {*} */ (globalThis).createImageBitmap;
    const entrada = foto();
    await esElOriginal(await compress(entrada), entrada);
});

test('si `createImageBitmap` LANZA, la foto se guarda como vino', async () => {
    // Un fichero que no es una imagen, o un formato que el navegador no
    // descodifica. Perder la foto por eso sería cambiar un problema de tamaño
    // por uno de datos.
    /** @type {*} */ (globalThis).createImageBitmap = async () => { throw new Error('no es una imagen'); };
    const entrada = foto();
    await esElOriginal(await compress(entrada), entrada);
});

test('sin lienzo de ninguna clase, la foto se guarda como vino', async () => {
    /** @type {*} */ (globalThis).createImageBitmap = async () => ({ width: 4000, height: 3000, close() {} });
    delete /** @type {*} */ (globalThis).OffscreenCanvas;
    // Sin `document` tampoco hay lienzo del DOM: es el entorno de `node:test`.
    const entrada = foto();
    await esElOriginal(await compress(entrada), entrada);
});

test('si el codificador devuelve OTRO tipo, no se acepta', async () => {
    // Un navegador que no sabe codificar WebP devuelve PNG en vez de fallar, y
    // un PNG de una foto pesa MÁS que el original. Se comprueba lo que salió, no
    // lo que se pidió.
    /** @type {*} */ (globalThis).createImageBitmap = async () => ({ width: 4000, height: 3000, close() {} });
    /** @type {*} */ (globalThis).OffscreenCanvas = class {
        constructor(w, h) { this.width = w; this.height = h; }
        getContext() { return { drawImage() {} }; }
        async convertToBlob() { return new Blob([new Uint8Array(9_000_000)], { type: 'image/png' }); }
    };
    const entrada = foto();
    await esElOriginal(await compress(entrada), entrada);
});

test('cuando SÍ puede, comprime y lo dice', async () => {
    let pedido = null;
    /** @type {*} */ (globalThis).createImageBitmap = async () => ({ width: 4000, height: 3000, close() {} });
    /** @type {*} */ (globalThis).OffscreenCanvas = class {
        constructor(w, h) { this.width = w; this.height = h; }
        getContext() { return { drawImage() {} }; }
        async convertToBlob(opciones) {
            pedido = opciones;
            return new Blob([new Uint8Array(180_000)], { type: opciones.type });
        }
    };

    const r = await compress(foto());
    assert.equal(r.compressed, true);
    assert.equal(r.contentType, 'image/webp', 'no se intentó WebP primero');
    assert.equal(r.width, 1600);
    assert.equal(r.height, 1200);
    assert.deepEqual(pedido, { type: 'image/webp', quality: QUALITY });
});

test('la orientación del EXIF se pide, o las verticales salen tumbadas', async () => {
    // Pasar por un lienzo tira el EXIF entero —que es lo que se busca: ahí van
    // las coordenadas GPS—, pero con él se iría también la rotación. Hay que
    // aplicarla a los píxeles ANTES de perderla.
    let opciones = null;
    /** @type {*} */ (globalThis).createImageBitmap = async (_b, o) => {
        opciones = o;
        return { width: 100, height: 100, close() {} };
    };
    await compress(foto());
    assert.deepEqual(opciones, { imageOrientation: 'from-image' });
});

test('si comprimir no ahorra nada y no hubo que escalar, se queda el original', async () => {
    // Una imagen pequeña y ya optimizada: recodificarla por recodificar solo
    // pierde calidad.
    /** @type {*} */ (globalThis).createImageBitmap = async () => ({ width: 400, height: 300, close() {} });
    /** @type {*} */ (globalThis).OffscreenCanvas = class {
        constructor(w, h) { this.width = w; this.height = h; }
        getContext() { return { drawImage() {} }; }
        async convertToBlob(o) { return new Blob([new Uint8Array(60_000)], { type: o.type }); }
    };
    const entrada = foto();
    await esElOriginal(await compress(entrada), entrada);
});

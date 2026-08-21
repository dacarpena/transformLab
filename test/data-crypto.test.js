// @ts-check

/**
 * El llavero del cifrado extremo a extremo (M8-5).
 *
 * Lo que aquí se fija no es «que la criptografía funciona» —eso lo hace
 * `crypto.subtle`—, sino las decisiones de FORMATO y de degradación que son
 * nuestras y que, si se rompen, rompen los datos de alguien de forma
 * irreversible:
 *
 * - que el sobre lleva su versión dentro y viaja solo;
 * - que un sobre manipulado, de otra clave o de otra fila devuelve `null` en vez
 *   de datos plausibles;
 * - que el kit de recuperación se puede teclear desde papel, con las erratas
 *   humanas previstas y ninguna más;
 * - que la ida y vuelta completa —generar, envolver, tirar la clave, recuperar
 *   con el kit— devuelve exactamente los mismos bytes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    generateDataKey, importDataKey, wrapDataKey, unwrapDataKey,
    deriveDeviceKek, deriveRecoveryKek, encryptBytes, decryptBytes,
    generateRecoveryCode, formatRecoveryCode, decodeRecoveryCode, verifyRecoveryCode,
    RECOVERY_BYTES, RECOVERY_SALT_BYTES, PBKDF2_ITERATIONS
} from '../src/data/crypto.js';

const texto = (/** @type {string} */ s) => new TextEncoder().encode(s);
const leer = (/** @type {Uint8Array | null} */ b) => b && new TextDecoder().decode(b);

/* ── La DK ───────────────────────────────────────────────────────────────── */

test('la DK importada NO es extraíble: un XSS puede usarla, no llevársela', async () => {
    // Es la mejor propiedad que un navegador puede dar. La diferencia entre
    // «descifran lo que haya en pantalla mientras dure el ataque» y «se llevan
    // la clave y descifran todo para siempre».
    const dk = await importDataKey(new Uint8Array(32).fill(7));
    assert.equal(dk.extractable, false);
    await assert.rejects(() => crypto.subtle.exportKey('raw', dk));
});

test('una DK que no mide 32 bytes se rechaza en vez de rellenarse', async () => {
    for (const n of [0, 16, 31, 33]) {
        await assert.rejects(() => importDataKey(new Uint8Array(n)), /32 bytes/);
    }
});

/* ── El sobre ────────────────────────────────────────────────────────────── */

test('envolver y abrir devuelve la MISMA clave', async () => {
    const dk = await generateDataKey();
    const kek = await deriveDeviceKek(new Uint8Array(32).fill(3));
    const sobre = await wrapDataKey(kek, dk);
    const vuelta = await unwrapDataKey(kek, sobre);
    assert.ok(vuelta);

    // «La misma» se comprueba por lo único que importa: que descifra lo que la
    // original cifró. Comparar los bytes sería imposible, y con razón.
    const cifrado = await encryptBytes(dk, texto('setenta y cinco kilos'));
    assert.equal(leer(await decryptBytes(vuelta, cifrado)), 'setenta y cinco kilos');
});

test('con OTRA KEK el sobre no se abre, y devuelve null en vez de lanzar', async () => {
    const dk = await generateDataKey();
    const sobre = await wrapDataKey(await deriveDeviceKek(new Uint8Array(32).fill(1)), dk);
    assert.equal(await unwrapDataKey(await deriveDeviceKek(new Uint8Array(32).fill(2)), sobre), null);
});

test('un sobre MANIPULADO no se abre: AES-GCM lo detecta', async () => {
    // Es lo que hace que un servidor hostil no pueda envenenar al cliente.
    const dk = await generateDataKey();
    const kek = await deriveDeviceKek(new Uint8Array(32).fill(3));
    const sobre = await wrapDataKey(kek, dk);

    for (const i of [1, 13, sobre.length - 1]) {
        const tocado = Uint8Array.from(sobre);
        tocado[i] ^= 0xff;
        assert.equal(await unwrapDataKey(kek, tocado), null, `el byte ${i} no estaba protegido`);
    }
});

test('el sobre lleva su VERSIÓN dentro, para poder viajar solo', async () => {
    const dk = await generateDataKey();
    const kek = await deriveDeviceKek(new Uint8Array(32).fill(3));
    const sobre = await wrapDataKey(kek, dk);
    assert.equal(sobre[0], 1);

    // Una versión desconocida se rechaza en vez de interpretarse como la actual:
    // leer un formato futuro adivinando es cómo se corrompen datos.
    const futuro = Uint8Array.from(sobre);
    futuro[0] = 99;
    assert.equal(await unwrapDataKey(kek, futuro), null);
});

test('un sobre truncado o vacío no revienta nada', async () => {
    const kek = await deriveDeviceKek(new Uint8Array(32));
    for (const n of [0, 1, 12, 13]) {
        assert.equal(await unwrapDataKey(kek, new Uint8Array(n)), null);
    }
});

/* ── Cifrar datos, y el AAD ──────────────────────────────────────────────── */

test('el mismo texto cifrado dos veces da criptogramas DISTINTOS', async () => {
    // El IV es aleatorio en cada llamada. Si no lo fuera, el servidor vería que
    // dos filas tienen el mismo contenido sin poder leerlo — que ya es filtrar.
    const dk = await generateDataKey();
    const a = await encryptBytes(dk, texto('75.4'));
    const b = await encryptBytes(dk, texto('75.4'));
    assert.notDeepEqual([...a], [...b]);
    assert.equal(leer(await decryptBytes(dk, a)), '75.4');
    assert.equal(leer(await decryptBytes(dk, b)), '75.4');
});

test('el AAD ata el criptograma a su fila: movido, no descifra', async () => {
    // Sin esto, quien pudiera escribir en el servidor barajaría filas —poner el
    // peso de enero en la de marzo— sin romper ningún tag y sin que el cliente
    // se enterase.
    const dk = await generateDataKey();
    const sobre = await encryptBytes(dk, texto('75.4'), 'checkins/2026-01-05');
    assert.equal(leer(await decryptBytes(dk, sobre, 'checkins/2026-01-05')), '75.4');
    assert.equal(await decryptBytes(dk, sobre, 'checkins/2026-03-05'), null, 'el sobre se movió de fila y coló');
    assert.equal(await decryptBytes(dk, sobre), null, 'sin AAD también tiene que fallar');
});

test('con la DK de otra cuenta no se descifra nada', async () => {
    const a = await generateDataKey();
    const b = await generateDataKey();
    assert.equal(await decryptBytes(b, await encryptBytes(a, texto('x'))), null);
});

/* ── El kit de recuperación ──────────────────────────────────────────────── */

test('el kit tiene la forma que se puede copiar a mano', async () => {
    const { code, bytes } = await generateRecoveryCode();
    assert.equal(bytes.length, RECOVERY_BYTES, '160 bits');
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){8}$/,
        'nueve grupos de cuatro, alfabeto de Crockford');
    // Sin I, L, O ni U: son los caracteres que se confunden al copiar de papel.
    assert.doesNotMatch(code, /[ILOU]/);
});

test('dos kits seguidos son distintos', async () => {
    const a = await generateRecoveryCode();
    const b = await generateRecoveryCode();
    assert.notEqual(a.code, b.code);
});

test('se perdonan las erratas humanas previstas, y ninguna más', async () => {
    const { code, bytes } = await generateRecoveryCode();
    const esperado = [...bytes];

    for (const variante of [
        code,
        code.toLowerCase(),
        code.replace(/-/g, ''),
        code.replace(/-/g, ' '),
        `  ${code}  `,
        code.replace(/-/g, '--')
    ]) {
        assert.deepEqual([...(decodeRecoveryCode(variante) ?? [])], esperado,
            `no se perdonó: «${variante.slice(0, 20)}…»`);
        assert.equal(await verifyRecoveryCode(variante), true);
    }
});

test('las cuatro letras excluidas se traducen a su dígito', async () => {
    // Quien copia de papel escribe «O» donde hay un cero y «l» donde hay un uno.
    // Como el alfabeto no las contiene, traducirlas no puede chocar con nada.
    const bytes = new Uint8Array(RECOVERY_BYTES).fill(0);
    const code = await formatRecoveryCode(bytes);
    assert.ok(code.startsWith('0000'));
    const conOes = code.replace(/0/g, 'O');
    assert.deepEqual([...(decodeRecoveryCode(conOes) ?? [])], [...bytes]);
    assert.equal(await verifyRecoveryCode(conOes), true);
});

test('un carácter cambiado NO cuela: para eso está la comprobación', async () => {
    // Sin ella, una errata se llevaría por delante un segundo de PBKDF2 para
    // acabar diciendo «no» sin explicar por qué.
    const { code } = await generateRecoveryCode();
    let cambiado = false;
    for (let i = 0; i < code.length && !cambiado; i++) {
        if (code[i] === '-') continue;
        const otro = code[i] === '2' ? '3' : '2';
        const roto = code.slice(0, i) + otro + code.slice(i + 1);
        if (roto === code) continue;
        assert.equal(await verifyRecoveryCode(roto), false, `pasó una errata en la posición ${i}`);
        cambiado = true;
    }
    assert.ok(cambiado);
});

test('un código de otra longitud, o con basura, se rechaza', async () => {
    for (const malo of ['', 'hola', '1234-5678', 'A'.repeat(40), '¿?!!-1234-1234-1234-1234-1234-1234-1234-1234']) {
        assert.equal(decodeRecoveryCode(malo), null, `pasó «${malo.slice(0, 16)}»`);
        assert.equal(await verifyRecoveryCode(malo), false);
    }
    assert.equal(decodeRecoveryCode(/** @type {*} */ (null)), null);
    assert.equal(decodeRecoveryCode(/** @type {*} */ (42)), null);
});

test('PBKDF2 usa las iteraciones declaradas, y la sal es de 16 bytes', () => {
    // Bajarlas sin querer no rompería ningún test funcional: el sobre se abriría
    // igual. Por eso la cifra se afirma aquí.
    assert.equal(PBKDF2_ITERATIONS, 600_000);
    assert.equal(RECOVERY_SALT_BYTES, 16);
});

/* ── La ida y vuelta completa ────────────────────────────────────────────── */

test('perder el dispositivo y recuperar con el kit devuelve los MISMOS datos', async () => {
    // Es el recorrido que justifica todo el módulo, y el único que prueba que
    // las piezas encajan: si el kit no abriera el sobre, el usuario perdería sus
    // datos de forma irreversible y no habría a quién pedírselos.
    const dk = await generateDataKey();
    const { code } = await generateRecoveryCode();
    const salt = crypto.getRandomValues(new Uint8Array(RECOVERY_SALT_BYTES));

    const kekR = await deriveRecoveryKek(code, salt);
    assert.ok(kekR);
    const sobreRecuperacion = await wrapDataKey(kekR, dk);
    const datos = await encryptBytes(dk, texto('{"weightKg":75.4}'), 'checkins/x');

    // — se pierde todo: el dispositivo, la DK, la sesión —

    const kekR2 = await deriveRecoveryKek(code, salt);
    assert.ok(kekR2);
    const dk2 = await unwrapDataKey(kekR2, sobreRecuperacion);
    assert.ok(dk2, 'el kit no abrió el sobre: los datos serían irrecuperables');
    assert.equal(leer(await decryptBytes(dk2, datos, 'checkins/x')), '{"weightKg":75.4}');
});

test('con OTRO kit no se recupera nada', async () => {
    const dk = await generateDataKey();
    const salt = crypto.getRandomValues(new Uint8Array(RECOVERY_SALT_BYTES));
    const bueno = await generateRecoveryCode();
    const otro = await generateRecoveryCode();

    const sobre = await wrapDataKey(
        /** @type {CryptoKey} */ (await deriveRecoveryKek(bueno.code, salt)), dk);
    const kekMalo = await deriveRecoveryKek(otro.code, salt);
    assert.ok(kekMalo);
    assert.equal(await unwrapDataKey(kekMalo, sobre), null);
});

test('la MISMA sal y el MISMO código dan la misma clave; otra sal, no', async () => {
    const dk = await generateDataKey();
    const { code } = await generateRecoveryCode();
    const salt = crypto.getRandomValues(new Uint8Array(RECOVERY_SALT_BYTES));
    const otraSal = crypto.getRandomValues(new Uint8Array(RECOVERY_SALT_BYTES));

    const sobre = await wrapDataKey(/** @type {CryptoKey} */ (await deriveRecoveryKek(code, salt)), dk);
    assert.ok(await unwrapDataKey(/** @type {CryptoKey} */ (await deriveRecoveryKek(code, salt)), sobre));
    assert.equal(await unwrapDataKey(/** @type {CryptoKey} */ (await deriveRecoveryKek(code, otraSal)), sobre), null,
        'la sal no estaba entrando en la derivación');
});

test('deriveRecoveryKek devuelve null ante un código imposible, sin quemar un segundo', async () => {
    const t = Date.now();
    assert.equal(await deriveRecoveryKek('esto no es un kit', new Uint8Array(16)), null);
    assert.ok(Date.now() - t < 200, 'derivó antes de mirar si el código tenía forma');
});

test('el PRF de dos autenticadores da KEK distintas', async () => {
    const dk = await generateDataKey();
    const sobre = await wrapDataKey(await deriveDeviceKek(new Uint8Array(32).fill(1)), dk);
    assert.equal(await unwrapDataKey(await deriveDeviceKek(new Uint8Array(32).fill(2)), sobre), null);
    assert.ok(await unwrapDataKey(await deriveDeviceKek(new Uint8Array(32).fill(1)), sobre));
});

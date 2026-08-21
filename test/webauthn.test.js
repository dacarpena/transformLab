// @ts-check

/**
 * La verificación de WebAuthn, contra bytes que emitió Chrome (M8-3).
 *
 * **Los vectores no están fabricados.** `test/fixtures/webauthn-vectors.json`
 * lo generó el autenticador virtual de Chrome —la implementación real de CTAP2
 * del navegador— manejado por el protocolo de depuración, y está congelado.
 * La distinción es la que sostiene todo este fichero: si los bytes los hubiera
 * construido quien escribió el verificador, un malentendido del formato estaría
 * en las dos mitades a la vez y el test pasaría con un código que ningún
 * navegador puede satisfacer. El fallo aparecería el día del lanzamiento, en el
 * login.
 *
 * Regenerar: `npm run vectors:webauthn`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    parseAuthenticatorData, checkClientData, derToRaw, verifySignature,
    verifyRegistration, verifyAssertion, sha256, ALG_ES256
} from '../functions/_lib/webauthn.js';
import { decode, encode } from '../functions/_lib/base64url.js';

const V = JSON.parse(readFileSync(new URL('./fixtures/webauthn-vectors.json', import.meta.url), 'utf8'));

const b = (/** @type {string} */ s) => /** @type {Uint8Array} */ (decode(s));
const RETO_REGISTRO = new Uint8Array(V.challenges.register);
const RETO_LOGIN = new Uint8Array(V.challenges.login);
const RP_ID_HASH = await sha256(V.rpId);

const REGISTRO = {
    clientDataJSON: b(V.registro.clientDataJSON),
    authenticatorData: b(V.registro.authenticatorData),
    publicKeySpki: b(V.registro.publicKeySpki),
    algorithm: V.registro.algorithm
};
const LOGIN = {
    clientDataJSON: b(V.login.clientDataJSON),
    authenticatorData: b(V.login.authenticatorData),
    signature: b(V.login.signature)
};
const ESPERADO_REG = { challenge: RETO_REGISTRO, origin: V.origin, rpIdHash: RP_ID_HASH };
const ESPERADO_LOG = { challenge: RETO_LOGIN, origin: V.origin, rpIdHash: RP_ID_HASH };
const CREDENCIAL = { publicKeySpki: REGISTRO.publicKeySpki, storedSignCount: 0 };

/** Copia con un byte cambiado, para probar que la firma cubre esa parte. */
function tocar(/** @type {Uint8Array} */ bytes, /** @type {number} */ i) {
    const c = Uint8Array.from(bytes);
    c[i] ^= 0xff;
    return c;
}

/* ── Los dos flujos, con los bytes de Chrome ─────────────────────────────── */

test('un registro real de Chrome se acepta', async () => {
    const r = await verifyRegistration(REGISTRO, ESPERADO_REG);
    assert.equal(r.ok, true, r.ok ? '' : r.error);
});

test('un login real de Chrome VERIFICA contra la clave del registro', async () => {
    // Es el test que justifica el fichero entero: firma auténtica, clave
    // auténtica, y la conversión de DER a crudo por medio.
    const r = await verifyAssertion(LOGIN, CREDENCIAL, ESPERADO_LOG);
    assert.equal(r.ok, true, r.ok ? '' : r.error);
});

test('la clave pública es SPKI y entra directa en importKey: por eso no hace falta CBOR', async () => {
    const key = await crypto.subtle.importKey('spki', REGISTRO.publicKeySpki.slice().buffer,
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    assert.equal(key.algorithm.name, 'ECDSA');
    assert.equal(REGISTRO.algorithm, ALG_ES256);
});

/* ── Que la firma cubre lo que creemos que cubre ─────────────────────────── */

test('cambiar UN byte de authenticatorData tumba la firma', async () => {
    // Lo firmado es `authenticatorData ‖ SHA-256(clientDataJSON)`. Si esto
    // pasara, la firma no estaría atando el contador ni las banderas.
    for (const i of [0, 32, 36]) {
        const r = await verifySignature({ ...LOGIN, publicKeySpki: CREDENCIAL.publicKeySpki, authenticatorData: tocar(LOGIN.authenticatorData, i) });
        assert.equal(r, false, `el byte ${i} de authData no está firmado`);
    }
});

test('cambiar UN byte de clientDataJSON tumba la firma', async () => {
    // Aquí viven el origen y el reto: si no estuvieran firmados, el phishing
    // funcionaría.
    const r = await verifySignature({ ...LOGIN, publicKeySpki: CREDENCIAL.publicKeySpki, clientDataJSON: tocar(LOGIN.clientDataJSON, 30) });
    assert.equal(r, false);
});

test('la firma de OTRA credencial no vale', async () => {
    // Con una clave pública distinta —generada aquí, con la misma curva— la
    // misma firma tiene que fallar.
    const otro = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const spki = new Uint8Array(await crypto.subtle.exportKey('spki', otro.publicKey));
    const r = await verifyAssertion(LOGIN, { publicKeySpki: spki, storedSignCount: 0 }, ESPERADO_LOG);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'webauthn.badSignature');
});

/* ── Lo que cierra el phishing y la reproducción ─────────────────────────── */

test('otro ORIGEN se rechaza, aunque la firma sea buena', async () => {
    // El navegador escribe el origen y el autenticador lo firma sin preguntar:
    // una copia de la aplicación en otro dominio firma SU origen.
    const r = await verifyAssertion(LOGIN, CREDENCIAL, { ...ESPERADO_LOG, origin: 'https://motifyer.com.malo.example' });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'clientData.wrongOrigin');
});

test('otro RETO se rechaza: sin esto, una respuesta capturada valdría siempre', async () => {
    const r = await verifyAssertion(LOGIN, CREDENCIAL, { ...ESPERADO_LOG, challenge: new Uint8Array(32) });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'clientData.wrongChallenge');
});

test('otro rpIdHash se rechaza', async () => {
    const r = await verifyAssertion(LOGIN, CREDENCIAL, { ...ESPERADO_LOG, rpIdHash: await sha256('malo.example') });
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'webauthn.rpIdHash');
});

test('una respuesta de REGISTRO no vale como login, ni al revés', async () => {
    // `type` separa los dos flujos. Sin comprobarlo, una firma obtenida en un
    // `create` podría presentarse como un `get`.
    const comoLogin = await verifyAssertion(
        { ...LOGIN, clientDataJSON: REGISTRO.clientDataJSON }, CREDENCIAL, ESPERADO_LOG);
    assert.equal(comoLogin.ok === false && comoLogin.error, 'clientData.wrongType');

    const comoRegistro = await verifyRegistration(
        { ...REGISTRO, clientDataJSON: LOGIN.clientDataJSON }, ESPERADO_REG);
    assert.equal(comoRegistro.ok === false && comoRegistro.error, 'clientData.wrongType');
});

test('sin la bandera de «usuario presente» no se entra', async () => {
    const sinUP = Uint8Array.from(LOGIN.authenticatorData);
    sinUP[32] &= ~0x01;
    const r = await verifyAssertion({ ...LOGIN, authenticatorData: sinUP }, CREDENCIAL, ESPERADO_LOG);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'webauthn.userNotPresent');
});

test('un contador que no avanza es una credencial clonada', async () => {
    const auth = parseAuthenticatorData(LOGIN.authenticatorData);
    assert.ok(auth.ok);
    // Se finge que ya habíamos visto un contador mayor.
    const r = await verifyAssertion(LOGIN, { ...CREDENCIAL, storedSignCount: auth.value.signCount + 1 }, ESPERADO_LOG);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'webauthn.signCountReplay');
});

test('pero un contador que SIEMPRE es cero PASA la puerta: es lo que hacen los pases sincronizados', async () => {
    // Apple y Google dejan el contador en cero a propósito, porque la credencial
    // vive en varios dispositivos por diseño. Exigirles monotonía dejaría fuera
    // a la mayoría de los usuarios reales.
    //
    // El autenticador virtual de Chrome SÍ incrementa (el vector grabado va de 1
    // a 2), así que este caso no puede salir del fixture: hay que poner el
    // contador a cero a mano, y entonces la firma ya no cuadra. Lo que se afirma
    // es exactamente lo comprobable —que la puerta del contador lo dejó pasar—,
    // y no se disfraza de más: el error tiene que ser el de la firma, NO el de
    // reproducción.
    const aCero = Uint8Array.from(LOGIN.authenticatorData);
    aCero.set([0, 0, 0, 0], 33);
    const r = await verifyAssertion({ ...LOGIN, authenticatorData: aCero }, { ...CREDENCIAL, storedSignCount: 0 }, ESPERADO_LOG);
    assert.equal(r.ok, false);
    assert.equal(r.ok === false && r.error, 'webauthn.badSignature',
        'el contador a cero con guardado a cero no puede rechazarse por reproducción');
});

test('el vector grabado tiene el contador que este fichero supone', () => {
    // Si Chrome cambiara de comportamiento y dejara de incrementar, varios tests
    // de arriba dejarían de probar lo que dicen probar sin ponerse en rojo. Esto
    // los ata al fixture.
    const reg = parseAuthenticatorData(REGISTRO.authenticatorData);
    const log = parseAuthenticatorData(LOGIN.authenticatorData);
    assert.ok(reg.ok && log.ok);
    assert.equal(reg.value.signCount, 1);
    assert.equal(log.value.signCount, 2, 'el autenticador virtual dejó de incrementar: revisa los tests del contador');
});

test('un algoritmo que no es ES256 se rechaza en el REGISTRO, no en el login', async () => {
    // Rechazarlo tarde dejaría una credencial guardada con la que es imposible
    // entrar, y el usuario ya no estaría en la pantalla que sabe rehacerla.
    const r = await verifyRegistration({ ...REGISTRO, algorithm: -257 }, ESPERADO_REG);
    assert.equal(r.ok === false && r.error, 'webauthn.algorithm');
});

/* ── El troceo, y la trampa del DER ──────────────────────────────────────── */

test('authenticatorData se trocea como dice el estándar', async () => {
    const r = parseAuthenticatorData(REGISTRO.authenticatorData);
    assert.ok(r.ok);
    assert.deepEqual([...r.value.rpIdHash], [...RP_ID_HASH], 'los 32 primeros bytes son el hash del rpId');
    assert.equal(r.value.up, true);
    assert.equal(r.value.uv, true, 'el autenticador virtual verifica al usuario');
    assert.equal(r.value.at, true, 'el registro trae datos de credencial adjuntos');
    // El login NO los trae: es la diferencia estructural entre los dos.
    const login = parseAuthenticatorData(LOGIN.authenticatorData);
    assert.ok(login.ok);
    assert.equal(login.value.at, false);
});

test('authenticatorData demasiado corto se rechaza en vez de leer basura', () => {
    for (const n of [0, 1, 36]) {
        const r = parseAuthenticatorData(new Uint8Array(n));
        assert.equal(r.ok, false, `${n} bytes pasaron`);
    }
    assert.equal(parseAuthenticatorData(new Uint8Array(37)).ok, true);
});

test('el contador de 32 bits no se desborda a negativo', () => {
    // Con desplazamientos a mano, un contador por encima de 2^31 sale negativo y
    // la comprobación de monotonía se rompe justo en el caso raro.
    const a = new Uint8Array(37);
    a.set([0xff, 0xff, 0xff, 0xff], 33);
    const r = parseAuthenticatorData(a);
    assert.ok(r.ok);
    assert.equal(r.value.signCount, 4294967295);
});

test('derToRaw convierte la firma REAL de Chrome a 64 bytes', () => {
    const raw = derToRaw(LOGIN.signature);
    assert.ok(raw, 'la firma real no se pudo convertir');
    assert.equal(raw.length, 64);
});

test('derToRaw aguanta los dos casos de borde que muerden', async () => {
    // Se generan firmas de verdad hasta encontrar cada caso, en vez de escribir
    // un DER a mano: los casos raros son raros, y uno escrito a mano prueba lo
    // que quien lo escribió creía.
    const par = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    let conCeroDelante = false;   // r con el bit alto puesto → DER mete un 0x00
    let corto = false;            // r con byte de cabecera cero → DER lo quita

    for (let i = 0; i < 400 && !(conCeroDelante && corto); i++) {
        const firma = new Uint8Array(await crypto.subtle.sign(
            { name: 'ECDSA', hash: 'SHA-256' }, par.privateKey, new TextEncoder().encode(`m${i}`)));
        // `sign` devuelve r‖s crudo; se convierte a DER para poder probar la
        // vuelta, que es lo que hace el navegador.
        const der = rawToDer(firma);
        const vuelta = derToRaw(der);
        assert.ok(vuelta, `no se pudo convertir la firma ${i}`);
        assert.deepEqual([...vuelta], [...firma], `la firma ${i} no sobrevivió a la ida y vuelta`);
        if (firma[0] >= 0x80) conCeroDelante = true;
        if (firma[0] === 0x00) corto = true;
    }
    assert.ok(conCeroDelante, 'no salió ninguna firma con el bit alto puesto en 400 intentos');
    // Un `r` con byte de cabecera cero sale ~1 vez de cada 256; con 400
    // intentos es casi seguro, pero si no sale no se falla por azar.
    if (!corto) console.warn('  (no salió el caso de r corto en esta tanda)');
});

test('derToRaw dice que no ante un DER inválido, en vez de devolver algo', () => {
    for (const malo of [
        new Uint8Array(0),
        new Uint8Array([0x30, 0x02, 0x02, 0x00]),                 // INTEGER de longitud 0
        new Uint8Array([0x31, 0x06, 0x02, 0x01, 0x01, 0x02, 0x01, 0x01]), // no es SEQUENCE
        Uint8Array.from([...LOGIN.signature, 0x00])               // bytes de sobra al final
    ]) {
        assert.equal(derToRaw(malo), null, `pasó: ${[...malo].slice(0, 6)}`);
    }
});

/* ── clientData ──────────────────────────────────────────────────────────── */

test('un clientData que no es JSON, o no es un objeto, se rechaza', () => {
    const esperado = { type: /** @type {const} */ ('webauthn.get'), challenge: RETO_LOGIN, origin: V.origin };
    for (const [texto, error] of [
        ['no soy json', 'clientData.notJson'],
        ['null', 'clientData.notObject'],
        ['"cadena"', 'clientData.notObject'],
        ['42', 'clientData.notObject']
    ]) {
        const r = checkClientData(new TextEncoder().encode(texto), esperado);
        assert.equal(r.ok, false);
        assert.equal(r.ok === false && r.error, error, `con «${texto}»`);
    }
});

test('crossOrigin true se rechaza: la respuesta viene de un iframe', () => {
    const datos = JSON.parse(new TextDecoder().decode(LOGIN.clientDataJSON));
    const r = checkClientData(
        new TextEncoder().encode(JSON.stringify({ ...datos, crossOrigin: true })),
        { type: 'webauthn.get', challenge: RETO_LOGIN, origin: V.origin });
    assert.equal(r.ok === false && r.error, 'clientData.crossOrigin');
});

test('el reto se compara en TEXTO, no decodificado', () => {
    // Si se decodificara primero, dos codificaciones distintas del mismo reto
    // pasarían y el reto dejaría de ser de un solo uso.
    const datos = JSON.parse(new TextDecoder().decode(LOGIN.clientDataJSON));
    assert.equal(datos.challenge, encode(RETO_LOGIN));
    assert.doesNotMatch(datos.challenge, /[+/=]/, 'el navegador escribe base64url sin relleno');
});

/** r‖s → DER, para poder probar la conversión inversa con firmas de verdad. */
function rawToDer(/** @type {Uint8Array} */ raw) {
    const ent = (/** @type {Uint8Array} */ v) => {
        let i = 0;
        while (i < v.length - 1 && v[i] === 0) i++;
        const cuerpo = v.subarray(i);
        const conSigno = cuerpo[0] >= 0x80 ? Uint8Array.from([0, ...cuerpo]) : cuerpo;
        return Uint8Array.from([0x02, conSigno.length, ...conSigno]);
    };
    const r = ent(raw.subarray(0, 32));
    const s = ent(raw.subarray(32));
    return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

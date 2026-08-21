// @ts-check

/**
 * Graba vectores de WebAuthn REALES, de Chrome (M8-3).
 *
 * ## Por qué no se fabrican
 *
 * La tentación era generar un par de claves con `crypto.subtle`, montar a mano
 * los bytes de `authenticatorData` según el estándar y firmar. Eso NO PRUEBA
 * NADA: si el que escribe el verificador entendió mal el formato, entiende mal
 * las dos mitades igual, y el test pasa con un código que ningún navegador puede
 * satisfacer. El fallo aparecería el día del lanzamiento, en el login.
 *
 * Aquí los bytes los produce el **autenticador virtual de Chrome**, que es la
 * implementación real de CTAP2 del navegador, manejada por el protocolo de
 * depuración. Son bytes que un navegador de verdad emitió: si el verificador los
 * acepta, acepta lo que va a llegar en producción.
 *
 * ## Cuándo hay que reejecutarlo
 *
 * Casi nunca: los vectores están congelados en `test/fixtures/` y se versionan.
 * Solo si cambia el flujo (otro algoritmo, otro `rpId`, otra extensión). No se
 * ejecuta en CI —depende de un navegador— y por eso no es un test.
 *
 *   npm run vectors:webauthn
 */

import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'http://localhost:41234';
const RP_ID = 'localhost';
const SALIDA = fileURLToPath(new URL('../test/fixtures/webauthn-vectors.json', import.meta.url));

// Retos FIJOS, no aleatorios: un fixture tiene que ser reproducible, y además el
// test compara el reto que verifica contra el que se firmó.
const RETO_REGISTRO = Array.from({ length: 32 }, (_, i) => (i * 7 + 3) % 256);
const RETO_LOGIN = Array.from({ length: 32 }, (_, i) => (i * 11 + 5) % 256);

const navegador = await chromium.launch();
const contexto = await navegador.newContext();
const pagina = await contexto.newPage();

// Una página mínima servida en el origen que hace falta. WebAuthn exige contexto
// seguro, y `localhost` cuenta como tal sin certificado.
await pagina.route(`${ORIGIN}/`, (ruta) =>
    ruta.fulfill({ contentType: 'text/html', body: '<!doctype html><title>v</title>' }));
await pagina.goto(`${ORIGIN}/`);

const cdp = await contexto.newCDPSession(pagina);
await cdp.send('WebAuthn.enable');
const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,          // credenciales descubribles: sin ellas no
        hasUserVerification: true,     // hay login sin campo «usuario»
        isUserVerified: true,
        automaticPresenceSimulation: true
    }
});

const vectores = await pagina.evaluate(async ({ rpId, retoRegistro, retoLogin }) => {
    const b64u = (/** @type {ArrayBuffer} */ b) =>
        btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const cred = /** @type {*} */ (await navigator.credentials.create({
        publicKey: {
            challenge: new Uint8Array(retoRegistro),
            rp: { id: rpId, name: 'TransformLab' },
            user: { id: new Uint8Array([1, 2, 3, 4]), name: 'u', displayName: 'u' },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
            attestation: 'none'
        }
    }));

    const registro = {
        id: cred.id,
        clientDataJSON: b64u(cred.response.clientDataJSON),
        authenticatorData: b64u(cred.response.getAuthenticatorData()),
        publicKeySpki: b64u(cred.response.getPublicKey()),
        algorithm: cred.response.getPublicKeyAlgorithm()
    };

    // Sin `allowCredentials`: es el login descubrible de verdad, el que no tiene
    // nada que enumerar.
    const aserto = /** @type {*} */ (await navigator.credentials.get({
        publicKey: {
            challenge: new Uint8Array(retoLogin),
            rpId,
            userVerification: 'required'
        }
    }));

    return {
        registro,
        login: {
            id: aserto.id,
            clientDataJSON: b64u(aserto.response.clientDataJSON),
            authenticatorData: b64u(aserto.response.authenticatorData),
            signature: b64u(aserto.response.signature),
            userHandle: aserto.response.userHandle ? b64u(aserto.response.userHandle) : null
        }
    };
}, { rpId: RP_ID, retoRegistro: RETO_REGISTRO, retoLogin: RETO_LOGIN });

await cdp.send('WebAuthn.removeVirtualAuthenticator', { authenticatorId });
await navegador.close();

writeFileSync(SALIDA, JSON.stringify({
    _comentario: 'Generado por tools/record-webauthn-vectors.mjs con el autenticador virtual de Chrome. NO editar a mano.',
    origin: ORIGIN,
    rpId: RP_ID,
    challenges: { register: RETO_REGISTRO, login: RETO_LOGIN },
    ...vectores
}, null, 2) + '\n');

console.log('grabado en', SALIDA);
console.log('  id credencial :', vectores.registro.id);
console.log('  alg           :', vectores.registro.algorithm);
console.log('  spki bytes    :', atob(vectores.registro.publicKeySpki.replace(/-/g, '+').replace(/_/g, '/')).length);
console.log('  firma bytes   :', atob(vectores.login.signature.replace(/-/g, '+').replace(/_/g, '/')).length);

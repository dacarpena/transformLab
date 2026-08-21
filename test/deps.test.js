// @ts-check

/**
 * El inventario de dependencias, que §5 de `CLAUDE.md` fija y hasta ahora no
 * vigilaba nadie (M8-1).
 *
 * La regla —cero dependencias de runtime, tres devDeps— se ha cumplido durante
 * todo el proyecto por disciplina. Se le pone guardián justo ahora porque acaba
 * de entrar la primera devDep nueva en año y medio (`wrangler`), y porque el
 * servidor es el sitio donde la tentación de instalar es mayor: hay una librería
 * de WebAuthn, una de CBOR y una de JWT para cada gusto.
 *
 * **Ninguna hace falta.** `crypto.subtle` verifica ECDSA P-256, deriva con HKDF
 * y cifra con AES-GCM; `response.getPublicKey()` devuelve SPKI DER, que entra
 * directo en `importKey`, así que no hay que descodificar COSE ni CBOR. Y los
 * tipos de plataforma se declaran a mano en `functions/env.d.ts`, que además
 * sirve de inventario de la superficie de Cloudflare que se toca.
 *
 * Cada dependencia de runtime en un servidor que maneja datos cifrados de
 * personas es superficie de cadena de suministro que no se puede auditar. Este
 * test no impide añadir una: impide añadirla **sin decirlo**.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const PKG = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

/**
 * Las devDeps permitidas, con el porqué de cada una. Añadir aquí es una decisión
 * consciente que deja rastro en el diff; instalar sin tocar esto pone la suite
 * en rojo.
 */
const PERMITIDAS = Object.freeze({
    typescript: 'el typecheck de `// @ts-check` + JSDoc, que sustituye a un paso de compilación',
    '@playwright/test': 'los E2E; es lo que comprueba lo que ningún test unitario ve',
    wrangler: 'el emulador y el desplegador de Pages Functions (M8-1); sin él la parte de servidor no se ejecuta ni se despliega'
});

test('CERO dependencias de runtime: Chart.js está vendorizado, no instalado', () => {
    // Vendorizarlo no es manía: `vendor/chart.umd.min.js` se sirve desde el
    // propio origen, así que `default-src 'self'` puede seguir siendo absoluto y
    // el modo sin conexión funciona sin depender de ningún CDN.
    assert.deepEqual(PKG.dependencies ?? {}, {});
});

test('las devDeps son exactamente las declaradas, y cada una tiene su porqué', () => {
    const instaladas = Object.keys(PKG.devDependencies ?? {}).sort();
    const esperadas = Object.keys(PERMITIDAS).sort();
    assert.deepEqual(instaladas, esperadas,
        'si una dependencia nueva es la decisión correcta, escríbela en PERMITIDAS con su razón ' +
        'y justifícala en la bitácora, como pide §5 de CLAUDE.md');
});

test('CLAUDE.md §5 nombra las mismas devDeps que package.json', () => {
    // La regla y el hecho tienen que decir lo mismo. Es lo que se lee al abrir
    // sesión, y una regla desfasada es peor que ninguna: manda desinstalar algo
    // que hace falta, o calla algo que ya está.
    const claude = readFileSync(new URL('../CLAUDE.md', import.meta.url), 'utf8');
    const linea = claude.split('\n').find((l) => l.startsWith('- **Dependencias:**'));
    assert.ok(linea, '§5 ya no tiene la línea de Dependencias: ¿se reescribió?');
    for (const nombre of Object.keys(PERMITIDAS)) {
        assert.ok(linea.includes(nombre), `CLAUDE.md §5 no nombra \`${nombre}\``);
    }
});

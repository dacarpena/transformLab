// @ts-check

/**
 * El panel de Cuenta: lo que se puede fijar sin navegador (M8-5d).
 *
 * Los cinco estados y los diálogos se ejercitan en `test/e2e/account.spec.js`
 * con el autenticador virtual de Chrome. Aquí va lo que un E2E no ve bien y que
 * duele mucho cuando falla: **que ningún error deje la pantalla muda**.
 *
 * Es un cruce entre tres capas —el servidor emite códigos, el panel decide
 * cuáles sabe explicar, y los diccionarios tienen que tener el texto— y las tres
 * se editan por separado. Sin un test que las ate, el fallo aparece justo en el
 * peor momento: cuando algo ya ha salido mal.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isICloudDuplicate } from './helpers/tree.js';
import { ERROR_KEYS, renderSection } from '../src/ui/account-panel.js';
import { es } from '../src/i18n/es.js';
import { en } from '../src/i18n/en.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/* ── Ningún error mudo ───────────────────────────────────────────────────── */

test('cada código previsto tiene texto en los DOS diccionarios', () => {
    assert.ok(ERROR_KEYS.length > 10, '¿se vació la lista?');
    for (const codigo of ERROR_KEYS) {
        const clave = `account.error.${codigo}`;
        assert.ok(es[clave], `falta en español: ${clave}`);
        assert.ok(en[clave], `falta en inglés: ${clave}`);
    }
    assert.ok(es['account.error.generic'] && en['account.error.generic']);
});

test('TODO código que el servidor emite lo sabe explicar el panel', () => {
    // El cruce que importa: `functions/` emite códigos con `fail(status, 'x')`,
    // y si el panel no conoce uno, el usuario ve el genérico en el momento en
    // que algo ha salido mal. Peor: un código nuevo pasa desapercibido porque
    // «algo sale», solo que sin decir qué.
    //
    // Se excluyen los que no llegan nunca a una persona: los que solo puede
    // provocar un cliente mal escrito o un atacante.
    const NO_VISIBLES = new Set([
        'method.notAllowed', 'origin.mismatch', 'contentType.required',
        'route.notFound', 'internal', 'body.notJson', 'body.unreadable',
        'body.notObject', 'body.empty', 'account.gone',
        'challenge.noPendingUser',
        // Los de `webauthn.*` y `clientData.*` los devuelve el registro y son
        // fallos del protocolo: el panel enseña el genérico a propósito, porque
        // ninguno tiene una acción distinta para el usuario.
    ]);

    /** @type {Set<string>} */ const emitidos = new Set();
    const walk = (/** @type {string} */ dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (isICloudDuplicate(e.name)) continue;
            const full = join(dir, e.name);
            if (e.isDirectory()) { walk(full); continue; }
            if (!e.name.endsWith('.js')) continue;
            const code = readFileSync(full, 'utf8');
            for (const m of code.matchAll(/fail\(\s*\d{3}\s*,\s*'([^']+)'/g)) emitidos.add(m[1]);
        }
    };
    walk(join(ROOT, 'functions'));

    assert.ok(emitidos.size > 5, `solo ${emitidos.size} códigos: ¿cambió la forma de `+
        `emitirlos? Este test dejaría de probar nada`);

    const sinTexto = [...emitidos]
        .filter((c) => !NO_VISIBLES.has(c) && !c.startsWith('webauthn.') && !c.startsWith('clientData.'))
        .filter((c) => !ERROR_KEYS.includes(c))
        .sort();
    assert.deepEqual(sinTexto, [],
        `el servidor emite códigos que el panel no sabe explicar: ${sinTexto.join(', ')}`);
});

test('los códigos del cliente también están cubiertos', () => {
    // `api.js` y `account.js` inventan sus propios códigos —`api.offline`,
    // `account.cancelled`— y son los que más va a ver un usuario real.
    /** @type {Set<string>} */ const emitidos = new Set();
    for (const ruta of ['src/data/api.js', 'src/data/account.js']) {
        const code = readFileSync(join(ROOT, ruta), 'utf8');
        for (const m of code.matchAll(/err\('([^']+)'\)|error:\s*'((?:api|account)\.[^']+)'/g)) {
            const c = m[1] ?? m[2];
            if (c) emitidos.add(c);
        }
    }
    assert.ok(emitidos.size >= 5, `solo ${emitidos.size} códigos del cliente`);
    const sinTexto = [...emitidos].filter((c) => !ERROR_KEYS.includes(c)).sort();
    assert.deepEqual(sinTexto, [], `el cliente emite códigos sin texto: ${sinTexto.join(', ')}`);
});

/* ── El marcado ──────────────────────────────────────────────────────────── */

test('la sección trae su encabezado accesible y el hueco del cuerpo', () => {
    const marcado = String(renderSection());
    assert.match(marcado, /aria-labelledby="set-account"/);
    assert.match(marcado, /id="set-account"/);
    assert.match(marcado, /data-account-body/, 'sin el hueco, el panel no puede repintarse solo');
    assert.match(marcado, /data-account-panel/);
});

test('el panel no lleva ni un literal visible fuera de i18n', () => {
    // La misma regla que el resto de `src/ui/`, comprobada sobre el marcado que
    // se genera: `renderSection` pinta antes de que haya datos, así que es donde
    // un literal se colaría más fácil.
    const marcado = String(renderSection());
    // Lo único que queda como texto es lo que `t()` devolvió, y `t()` devuelve
    // la clave cuando falta: si alguna faltara, se vería aquí.
    assert.doesNotMatch(marcado, /account\.[a-zA-Z.]+</,
        'hay una clave sin traducir pintada como texto');
});

test('ningún manejador inline: los pone `on()` por delegación', () => {
    const fuente = readFileSync(join(ROOT, 'src/ui/account-panel.js'), 'utf8');
    assert.doesNotMatch(fuente, /\son[a-z]+=["']/, 'hay un manejador inline en una plantilla');
});

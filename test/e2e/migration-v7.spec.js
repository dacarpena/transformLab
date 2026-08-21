// @ts-check

/**
 * La migración a ids opacos, en un navegador de verdad (M9-1).
 *
 * Es la única operación irreversible sobre datos que ya existen, y hay dos cosas
 * que **ningún test unitario puede demostrar**:
 *
 * 1. Que IndexedDB **de verdad** mueve las fotos: el doble de `node:test` imita
 *    la forma, no la durabilidad de una transacción.
 * 2. Que la aplicación **arranca** después. La migración 5→6 ya dejó una vez
 *    todos los datos perfectamente copiados y la app inservible, y solo se vio
 *    abriéndola.
 *
 * Se siembra un almacén v6 completo —con dos perfiles, sus claves de interfaz y
 * fotos reales en IndexedDB— y se recarga.
 */

import { test, expect } from '@playwright/test';

/**
 * Espera a que la aplicación esté montada.
 *
 * NO se espera `#today-title`: el fixture siembra `ui.activeView: "progress"`, y
 * como M9-1 arregló el descarte de las claves de interfaz, la aplicación restaura
 * **Progreso**. Que arranque ahí es precisamente la prueba de que esa clave
 * sobrevivió, así que se afirma eso.
 */
async function esperarApp(page) {
    await expect(page.locator('[data-nav]')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('.view[data-view-id]').first()).toBeVisible({ timeout: 20000 });
}

const V6 = 'tl.6.';
const V7 = 'tl.7.';

/** Siembra un almacén v6 con dos perfiles, sus claves y sus fotos. */
async function sembrarV6(page, { fotos = 3 } = {}) {
    await page.goto('/');
    await page.evaluate(() => localStorage.clear());
    await page.evaluate(() => new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('tl-photos');
        req.onsuccess = req.onerror = req.onblocked = () => resolve(null);
    }));

    await page.evaluate(async ({ V6, fotos }) => {
        const AT = '2026-01-01T00:00:00.000Z';
        localStorage.setItem(`${V6}profiles`, JSON.stringify({
            schemaVersion: 6, activeProfileId: 'p1',
            profiles: [
                { id: 'p1', name: 'Dani', createdAtISO: AT },
                { id: 'p2', name: 'Ana', createdAtISO: AT }
            ]
        }));
        for (const [id, peso] of [['p1', 90], ['p2', 62]]) {
            localStorage.setItem(`${V6}${id}.profile`, JSON.stringify({
                schemaVersion: 6, name: id === 'p1' ? 'Dani' : 'Ana', createdAtISO: AT,
                user: { sex: id === 'p1' ? 'male' : 'female', age: 30, heightCm: 175, activityLevel: 'moderate', trainingStatus: 'intermediate' },
                initial: { weightKg: peso, fatPct: 24, muscleKg: null, muscleSource: 'estimated' },
                target: { fatPct: 18, muscleKg: id === 'p1' ? 36 : 24 },
                startDateISO: '2026-05-01', intensity: 'moderate'
            }));
            localStorage.setItem(`${V6}${id}.checkins`, JSON.stringify({
                schemaVersion: 6,
                items: [0, 7, 14].map((n) => ({
                    id: `ci_2026-05-${String(1 + n).padStart(2, '0')}`,
                    dateISO: `2026-05-${String(1 + n).padStart(2, '0')}`,
                    weightKg: peso - n * 0.1, fatPct: 24, scaleMuscleKg: null, boneKg: null,
                    measuresCm: {}, subjective: {}, notes: '', createdAtISO: AT, editedAtISO: null
                }))
            }));
            localStorage.setItem(`${V6}${id}.settings`, JSON.stringify({
                schemaVersion: 6, locale: 'es', activeMeasures: ['waist'], fluctuationVisible: false, reminder: null
            }));
            // Las claves de INTERFAZ: las que la migración descartaba en
            // silencio hasta M9-1.
            localStorage.setItem(`${V6}${id}.ui.activeView`, '"progress"');
            localStorage.setItem(`${V6}${id}.ui.recalDeclinedFingerprint`, '"huella-que-no-quiero-ver"');
        }

        // Fotos REALES en IndexedDB, con el esquema que usa `photos-db.js`.
        await new Promise((resolve, reject) => {
            const req = indexedDB.open('tl-photos', 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('photos')) {
                    const store = db.createObjectStore('photos', { keyPath: 'id' });
                    store.createIndex('byProfile', 'profileId', { unique: false });
                }
            };
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction('photos', 'readwrite');
                const store = tx.objectStore('photos');
                for (let i = 1; i <= fotos; i++) {
                    const bytes = new Uint8Array(1024).fill(i);
                    store.put({
                        id: `p1:ph_${i}`, profileId: 'p1',
                        dateISO: `2026-05-0${i}`, note: `nota ${i}`,
                        blob: new Blob([bytes], { type: 'image/webp' }), bytes: 1024
                    });
                }
                tx.oncomplete = () => { db.close(); resolve(null); };
                tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
        });
    }, { V6, fotos });
}

/** El estado del almacén tras migrar. */
async function leerEstado(page) {
    return page.evaluate(async ({ V6, V7 }) => {
        const claves = (p) => Object.keys(localStorage).filter((k) => k.startsWith(p)).sort();
        const indice = JSON.parse(localStorage.getItem(`${V7}profiles`) ?? 'null');
        const tabla = JSON.parse(localStorage.getItem('tl.profileRemap.opaqueV7') ?? 'null');

        const fotos = await new Promise((resolve) => {
            const req = indexedDB.open('tl-photos', 1);
            req.onsuccess = () => {
                const db = req.result;
                const store = db.transaction('photos', 'readonly').objectStore('photos');
                const all = store.getAll();
                all.onsuccess = () => {
                    db.close();
                    resolve(all.result.map((r) => ({ id: r.id, profileId: r.profileId, bytes: r.bytes, note: r.note })));
                };
                all.onerror = () => { db.close(); resolve([]); };
            };
            req.onerror = () => resolve([]);
        });

        return { v6: claves(V6), v7: claves(V7), indice, tabla, fotos };
    }, { V6, V7 });
}

test('un almacén v6 completo migra a ids opacos sin perder NADA', async ({ page }) => {
    await sembrarV6(page);
    await page.reload();
    await esperarApp(page);

    const e = await leerEstado(page);

    // La tabla existe y los ids son opacos.
    expect(e.tabla, 'no se persistió la tabla de remapeo').toBeTruthy();
    const p1 = e.tabla.map.p1;
    const p2 = e.tabla.map.p2;
    expect(p1).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(p2).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(p1).not.toBe(p2);

    // Cada clave v6 tiene su gemela v7 bajo el id nuevo.
    for (const vieja of e.v6) {
        const rest = vieja.slice(V6.length);
        const punto = rest.indexOf('.');
        const esperada = punto === -1
            ? `${V7}${rest}`
            : `${V7}${e.tabla.map[rest.slice(0, punto)] ?? rest.slice(0, punto)}${rest.slice(punto)}`;
        expect(e.v7, `no llegó a destino: ${vieja}`).toContain(esperada);
    }

    // Las claves de INTERFAZ también: es el defecto preexistente que M9-1 cerró.
    expect(e.v7).toContain(`${V7}${p1}.ui.activeView`);
    expect(e.v7).toContain(`${V7}${p1}.ui.recalDeclinedFingerprint`);

    // El índice, coherente y sin un solo `pN`.
    expect(e.indice.schemaVersion).toBe(7);
    expect(e.indice.profiles.map((p) => p.id).sort()).toEqual([p1, p2].sort());
    expect(e.indice.activeProfileId).toBe(p1);

    // NADA se ha borrado: los originales de la v6 siguen ahí como red.
    expect(e.v6.length).toBeGreaterThan(10);
});

test('las FOTOS llegan con sus dos vínculos cambiados y su contenido intacto', async ({ page }) => {
    await sembrarV6(page, { fotos: 4 });
    await page.reload();
    await esperarApp(page);

    // La fase de fotos es asíncrona: se espera a su testigo.
    await expect.poll(
        () => page.evaluate(() => localStorage.getItem('tl.migrationPhotosDone.v7')),
        { timeout: 20000, message: 'la fase de fotos no terminó' }
    ).toBeTruthy();

    const e = await leerEstado(page);
    const p1 = e.tabla.map.p1;

    expect(e.fotos.length, 'se perdió alguna foto').toBe(4);
    for (const f of e.fotos) {
        expect(f.profileId, 'el campo profileId no se movió').toBe(p1);
        expect(f.id, 'la clave primaria no se movió').toMatch(new RegExp(`^${p1}:ph_\\d$`));
        expect(f.bytes, 'se perdió el contenido').toBe(1024);
        expect(f.note).toMatch(/^nota \d$/);
    }
});

test('la aplicación ARRANCA con los datos del usuario, no en el onboarding', async ({ page }) => {
    // La migración 5→6 ya dejó una vez todos los datos copiados y la aplicación
    // inservible: el índice se quedaba en la versión vieja, `readIndex()` decía
    // «corrupto» y el usuario veía un estado de error. Solo se vio en un
    // navegador.
    const errores = [];
    page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });

    await sembrarV6(page);
    await page.reload();

    await esperarApp(page);
    await expect(page.locator('[data-field="name"]'), 'arrancó el onboarding sobre datos existentes')
        .toHaveCount(0);
    // Y arranca donde el usuario lo dejó: `ui.activeView` sobrevivió a la
    // migración, que es el defecto preexistente que M9-1 cerró.
    await expect(page.locator('.view[data-view-id="progress"]'),
        'no se restauró la vista donde el usuario lo dejó').toBeVisible();
    expect(errores.filter((t) => /migra|profile|index/i.test(t))).toEqual([]);
});

test('los DATOS son los del usuario: sus check-ins, su idioma, su perfil', async ({ page }) => {
    await sembrarV6(page);
    await page.reload();
    await esperarApp(page);

    const datos = await page.evaluate(() => {
        const tabla = JSON.parse(localStorage.getItem('tl.profileRemap.opaqueV7') ?? '{}');
        const ns = `tl.7.${tabla.map.p1}`;
        return {
            checkins: JSON.parse(localStorage.getItem(`${ns}.checkins`) ?? 'null'),
            perfil: JSON.parse(localStorage.getItem(`${ns}.profile`) ?? 'null'),
            settings: JSON.parse(localStorage.getItem(`${ns}.settings`) ?? 'null'),
            declinada: localStorage.getItem(`${ns}.ui.recalDeclinedFingerprint`)
        };
    });

    expect(datos.checkins.items).toHaveLength(3);
    expect(datos.checkins.items[0].weightKg).toBe(90);
    expect(datos.checkins.schemaVersion).toBe(7);
    expect(datos.perfil.name).toBe('Dani');
    expect(datos.perfil.initial.weightKg).toBe(90);
    expect(datos.settings.locale).toBe('es');
    // La huella de la oferta rechazada: sin ella, la recalibración que el
    // usuario descartó le volvería a saltar.
    expect(datos.declinada).toBe('"huella-que-no-quiero-ver"');
});

test('migrar dos veces no duplica nada: la segunda carga es un no-op', async ({ page }) => {
    await sembrarV6(page);
    await page.reload();
    await esperarApp(page);
    const primera = await leerEstado(page);

    await page.reload();
    await esperarApp(page);
    const segunda = await leerEstado(page);

    expect(segunda.tabla.map, 'la segunda carga regeneró los ids').toEqual(primera.tabla.map);
    expect(segunda.v7.sort(), 'aparecieron claves nuevas').toEqual(primera.v7.sort());
    expect(segunda.fotos.length).toBe(primera.fotos.length);
});

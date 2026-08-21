// @ts-check

/**
 * Cómo se parte cada colección en filas sincronizables, y cómo se vuelve a
 * juntar (M9-2).
 *
 * Módulo **puro**: sin red, sin reloj, sin DOM, sin `localStorage`. Se prueba
 * entero desde Node.
 *
 * ## Por qué por filas y no por colección
 *
 * Con un bloque por colección y «gana el último que escribe», dos dispositivos
 * que apuntan check-ins de días distintos sin red pierden uno entero. Ése es el
 * camino más frecuente de esta aplicación, así que no es aceptable. Con una fila
 * por item son filas distintas y no hay conflicto que resolver.
 *
 * ## La forma de una fila
 *
 * ```js
 * { collection: 'checkins',
 *   keyPath:    ['items', '2026-05-01'],   // NUNCA una cadena concatenada
 *   ordinal:    3,                          // su posición original
 *   scope:      'sync' | 'local',
 *   value:      { … },
 *   deleted?:   true }
 * ```
 *
 * **`keyPath` es un array, no una cadena.** Casi ningún `id` de este esquema
 * tiene `pattern`: `pantry.id` puede ser `a.b:c/d` y `photos.id` puede llevar
 * espacios y dos puntos. Concatenar con un separador es el defecto que
 * `photos-remap.js` ya documenta haber sufrido con `<perfil>:<foto>`. Si el
 * transporte necesita una cadena, `JSON.stringify(keyPath)` es inyectivo.
 *
 * **`ordinal` guarda la posición original.** `join` reconstruye por él, no
 * ordenando por clave. Ordenar «porque converge mejor» destruye el orden de
 * inserción del que dependen la vista de entrenamiento y la de fotos, y es el
 * defecto que una implementación perezosa comete de verdad.
 *
 * **Lo que no se sincroniza se MARCA, no se omite.** Una fila `scope: 'local'`
 * sale igual del `split`. Así el reparto sigue siendo total —y por tanto
 * comprobable— y la decisión de qué se publica vive en un solo sitio legible en
 * vez de repartirse en omisiones silenciosas.
 *
 * ## El invariante
 *
 * ```
 *   join(split(v)) ≡ validateCollection(nombre, v).value      (v canónico)
 *   join(split(x)) ≡ x                       para x = join(split(v))  (siempre)
 * ```
 *
 * El lado derecho es el valor **validado**, no el crudo: `objectOf` materializa
 * los `opt()` ausentes como `null`, así que `validateCollection` devuelve un
 * objeto con MÁS claves que el que se le pasó. Comparar contra el crudo daría
 * rojo por una diferencia que no es un fallo.
 *
 * Para un `v` con claves repetidas —dos check-ins del mismo día— la primera
 * forma no puede cumplirse: el reparto colapsa por clave a propósito. Por eso la
 * segunda, la **idempotencia**, se cumple siempre y es la que se prueba sobre
 * todo el corpus.
 *
 * ## Lo que este módulo NO decide
 *
 * - **Quién gana un conflicto.** Eso es M9-4, con el reloj del SERVIDOR. Aquí no
 *   se lee `editedAtISO` ni `createdAtISO` para decidir nada: son relojes de
 *   cliente, `editedAtISO` se bumpea aunque no cambie nada
 *   (`checkins.js:180`), y `steps` e `intakeLog` no tienen ninguna marca.
 * - **Las lápidas.** `split` solo ve el estado actual: no puede saber qué se
 *   borró. La fila con `deleted` la emite M9-3 comparando dos repartos. Aquí se
 *   define su forma y `join` la consume. Hasta entonces, todo es «gana añadir»:
 *   borrar un check-in en un dispositivo no lo borra en el otro.
 * - **Los blobs de las fotos.** La fila de `photos` es un puntero; el blob vive
 *   en IndexedDB y va en M9-5.
 */

import { validateCollection, COLLECTIONS } from './schema.js';

/**
 * @typedef {Object} SyncRow
 * @property {string} collection
 * @property {string[]} keyPath
 * @property {number} ordinal
 * @property {'sync' | 'local'} scope
 * @property {unknown} [value]
 * @property {true} [deleted]
 */

/* ══ La tabla ═══════════════════════════════════════════════════════════════
 *
 * Cada colección declara sus PARTES, en orden. Tres clases:
 *
 *   doc     la colección entera es una fila.        keyPath: []
 *   scalar  un campo suelto es una fila.            keyPath: [campo]
 *   list    cada elemento es una fila.              keyPath: [campo, ...clave]
 *   members cada miembro de una lista de CADENAS.   keyPath: [campo, literal]
 *
 * `scope: 'local'` significa que la fila no sale del dispositivo. Se emite
 * igual, para que el reparto siga siendo total.
 */

/**
 * @typedef {{ kind: 'doc', scope: 'sync'|'local' }
 *         | { kind: 'scalar', field: string, scope: 'sync'|'local' }
 *         | { kind: 'list', field: string, key: (item: *) => string[],
 *             scope: 'sync'|'local', overflow?: 'keepFirst'|'keepNewest', newest?: (item: *) => string }
 *         | { kind: 'members', field: string, scope: 'sync'|'local' }} Part
 */

/** @type {Record<string, { parts: Part[], note: string }>} */
const POLICY = {
    /* ── Por item: el caso bueno ─────────────────────────────────────────── */

    checkins: {
        note: 'Clave `dateISO`, no `id`. `id` es `str({maxLength:60})` SIN patrón '
            + 'ni unicidad y es de facto la fecha con prefijo; con él, dos filas del '
            + 'mismo día sobreviven y la aplicación se contradice: `findByDate` '
            + 'devuelve la última y `evaluateSeries` evalúa las dos, así que la '
            + 'gráfica pinta dos puntos ese día. El `id` viaja como carga útil.',
        parts: [{ kind: 'list', field: 'items', scope: 'sync', key: (it) => [String(it.dateISO)] }]
    },

    steps: {
        note: 'El caso ideal: dos campos, los dos obligatorios, ningún invariante '
            + 'entre filas y ningún consumidor del orden.',
        parts: [{ kind: 'list', field: 'items', scope: 'sync', key: (it) => [String(it.dateISO)] }]
    },

    intakeLog: {
        note: 'Filas independientes con clave garantizada por el validador. Ante dos '
            + 'registros del mismo día gana el ÚLTIMO, siguiendo al motor '
            + '(`expenditure.js`): «dos registros del mismo día son una corrección, '
            + 'no dos comidas». `findByDate` se queda hoy con el primero — al BACKLOG.',
        parts: [{ kind: 'list', field: 'items', scope: 'sync', key: (it) => [String(it.dateISO)] }]
    },

    achievements: {
        note: 'Catálogo cerrado de constantes: la clave más estable de las quince. '
            + 'Un logro desbloqueado no se re-bloquea, así que la fusión es unión por '
            + 'id conservando el `atISO` MÁS ANTIGUO — se desbloqueó entonces.',
        parts: [{ kind: 'list', field: 'unlocked', scope: 'sync', key: (it) => [String(it.id)] }]
    },

    /* ── Por item, pero todavía sin viajar ───────────────────────────────── */

    nutrition: {
        note: 'Lista autocontenida y sin invariantes entre filas. Viaja desde la v8, '
            + 'cuando los ids dejaron de generarse con `<n>_<slug>` — que colisionaba '
            + 'entre dispositivos por construcción.',
        parts: [{ kind: 'list', field: 'mealTemplates', scope: 'sync', key: (it) => [String(it.id)] }]
    },

    recipes: {
        note: 'Cada receta es atómica; `ingredients` no se parte. Viaja desde la v8, '
            + 'con los ids ya opacos. Ojo: aquí `notes` NO admite cadena vacía, a '
            + 'diferencia de `nutrition.notes` y `photos.note`, así que una receta con '
            + 'la nota vacía va a cuarentena en vez de tumbar la colección.',
        parts: [{ kind: 'list', field: 'items', scope: 'sync', key: (it) => [String(it.id)] }]
    },

    photos: {
        note: 'La fila es un PUNTERO, no el dato: el blob vive en IndexedDB. Una fila '
            + 'sin blob desaparece de la galería con un `continue`, que es lo que §D9 '
            + 'prohíbe. Se ata a M9-5, donde el blob se paga una sola vez.',
        parts: [{ kind: 'list', field: 'items', scope: 'local', key: (it) => [String(it.id)] }]
    },

    training: {
        note: 'La única MIXTA: `routine` es un documento y cada sesión es una fila. '
            + 'Viaja desde la v8. Antes no podía: `exercise.id` era `ex_<n>_<slug>` y '
            + 'dos dispositivos generaban el MISMO id para ejercicios distintos —«Press '
            + 'de banca con barra» y «… con mancuernas» comparten los doce primeros '
            + 'caracteres—, así que las series de uno se habrían atribuido al grupo '
            + 'muscular del otro. Eso no es pérdida: es un dato falso presentado como '
            + 'verdadero, el defecto que hundió la v4.0. La rutina va como documento '
            + 'porque las sesiones cuelgan de sus ids: partirla por ejercicio dejaría '
            + 'sesiones apuntando a ejercicios que la fusión no trajo.',
        parts: [
            { kind: 'scalar', field: 'routine', scope: 'sync' },
            { kind: 'list', field: 'sessions', scope: 'sync', key: (it) => [String(it.id)] }
        ]
    },

    /* ── Documento ───────────────────────────────────────────────────────── */

    profile: {
        note: 'Documento entero. `initial`, `target` y `startDateISO` son un bloque '
            + 'que `ranges.js` verifica ENTRE SÍ: una fusión por campo produce un '
            + 'perfil que valida y es físicamente falso.',
        parts: [{ kind: 'doc', scope: 'sync' }]
    },

    pantry: {
        note: 'Documento, y duele. `quantity` es un ACUMULADOR '
            + '(`recipes.js`: `it.quantity + quantity`), no un atributo: dos '
            + 'dispositivos que añaden 500 g cada uno sobre 1000 dan 1500 con «gana el '
            + 'último», un estado que no existió en ninguna máquina. Por item sería '
            + 'peor —los ids colisionan entre dispositivos—. Un documento entrega al '
            + 'menos un estado que una máquina tuvo de verdad. Deltas → BACKLOG.',
        parts: [{ kind: 'doc', scope: 'sync' }]
    },

    volumeLog: {
        note: 'LOCAL: es la caché de una derivación. No tiene NI UN consumidor en todo '
            + '`src/` fuera del esquema —ni escritor ni lector— así que sincronizarla '
            + 'sería mover bytes que nadie mira.',
        parts: [{ kind: 'doc', scope: 'local' }]
    },

    /* ── Por campo ───────────────────────────────────────────────────────── */

    settings: {
        note: 'Por campo, no como documento. `patch()` es `{...read(), ...changes}` y '
            + 'el escritor más frecuente de la aplicación guarda estado de la vista '
            + 'Analizar: como documento, mover el zoom de una gráfica en el portátil '
            + 'le cambiaría el IDIOMA al móvil. `reminder` es del DISPOSITIVO —depende '
            + 'de `Notification.permission` de ese navegador y de su hora local— y '
            + '`analysis` es estado de vista.',
        parts: [
            { kind: 'scalar', field: 'locale', scope: 'local' },
            { kind: 'scalar', field: 'activeMeasures', scope: 'sync' },
            { kind: 'scalar', field: 'fluctuationVisible', scope: 'sync' },
            { kind: 'scalar', field: 'checkinDetailOpen', scope: 'sync' },
            { kind: 'scalar', field: 'reminder', scope: 'local' },
            { kind: 'scalar', field: 'analysis', scope: 'local' }
        ]
    },

    preferences: {
        note: 'Las listas de restricción se parten POR MIEMBRO. `hardExclusions` son '
            + 'ALERGIAS y el daño es asimétrico: una de más recorta el menú, una de '
            + 'menos sirve un alérgeno. Como documento, cambiar «cuántas comidas al '
            + 'día» en el móvil publicaría el `hardExclusions` del móvil sobre el del '
            + 'portátil — y no hay NINGUNA vista que las liste, así que la pérdida '
            + 'sería invisible. Por miembro y sin lápidas, gana añadir, que es la '
            + 'dirección segura. La clave es la cadena LITERAL: colapsar «Leche» y '
            + '«leche» sería una corrección silenciosa sobre un dato de salud (§4).',
        parts: [
            { kind: 'members', field: 'hardExclusions', scope: 'sync' },
            { kind: 'members', field: 'softExclusions', scope: 'sync' },
            { kind: 'members', field: 'activeModules', scope: 'sync' },
            { kind: 'scalar', field: 'dietType', scope: 'sync' },
            { kind: 'scalar', field: 'mealsPerDay', scope: 'sync' },
            { kind: 'scalar', field: 'householdSize', scope: 'sync' },
            { kind: 'scalar', field: 'controlLevel', scope: 'sync' }
        ]
    },

    supplementsPlan: {
        note: '`excluded` mezcla descartes por gusto con declaraciones médicas '
            + '(`safety:*`), que el motor usa como cribado duro: por miembro, gana '
            + 'añadir. `chosen` se guarda y no lo consulta nadie, pero viaja igual — '
            + 'es del usuario.',
        parts: [
            { kind: 'members', field: 'excluded', scope: 'sync' },
            { kind: 'members', field: 'chosen', scope: 'sync' }
        ]
    },

    /* ── Merge declarado ─────────────────────────────────────────────────── */

    plan: {
        note: '`current` y `params` son DERIVADOS: `plan-state.js` regenera la '
            + 'proyección en cada arranque desde el perfil. `history` es lo único que '
            + 'el usuario ve y lo único irreconstruible, así que es lo único que '
            + 'viaja. Clave: el instante de archivado normalizado.',
        parts: [
            { kind: 'scalar', field: 'current', scope: 'local' },
            { kind: 'scalar', field: 'params', scope: 'local' },
            {
                kind: 'list', field: 'history', scope: 'sync',
                key: (h) => [instante(h?.archivedAtISO)],
                // El esquema admite 100 entradas. Al desbordar se conservan las
                // MÁS RECIENTES: un historial viejo no le sirve a nadie, y podar
                // por posición dependería del orden de llegada.
                overflow: 'keepNewest',
                newest: (h) => instante(h?.archivedAtISO)
            }
        ]
    }
};

/* ══ Reparto ════════════════════════════════════════════════════════════════ */

/**
 * Parte una colección en filas.
 *
 * Se parte el valor **validado**, no el crudo: el validador materializa los
 * `opt()` ausentes como `null`, y sin ese paso el reparto perdería esas claves y
 * la vuelta no cuadraría.
 *
 * @param {string} collection
 * @param {unknown} value
 * @returns {{ ok: true, rows: SyncRow[] } | { ok: false, error: string }}
 */
export function split(collection, value) {
    const politica = POLICY[collection];
    if (!politica) return { ok: false, error: 'sync.unknownCollection' };

    const validado = validateCollection(collection, value);
    if (!validado.ok) return { ok: false, error: 'sync.invalidValue' };
    const v = /** @type {Record<string, *>} */ (validado.value);

    /** @type {SyncRow[]} */ const rows = [];
    let ordinal = 0;

    for (const parte of politica.parts) {
        if (parte.kind === 'doc') {
            rows.push({ collection, keyPath: [], ordinal: ordinal++, scope: parte.scope, value: v });
            continue;
        }
        if (parte.kind === 'scalar') {
            rows.push({
                collection, keyPath: [parte.field], ordinal: ordinal++, scope: parte.scope,
                // `?? null` y no `v[campo]` a secas: una clave ausente y una clave a
                // `null` tienen que llegar iguales al otro lado.
                value: v[parte.field] ?? null
            });
            continue;
        }
        if (parte.kind === 'members') {
            const lista = Array.isArray(v[parte.field]) ? v[parte.field] : [];
            for (const miembro of lista) {
                rows.push({
                    collection, keyPath: [parte.field, String(miembro)],
                    ordinal: ordinal++, scope: parte.scope, value: miembro
                });
            }
            continue;
        }
        const lista = Array.isArray(v[parte.field]) ? v[parte.field] : [];
        for (const item of lista) {
            rows.push({
                collection, keyPath: [parte.field, ...parte.key(item)],
                ordinal: ordinal++, scope: parte.scope, value: item
            });
        }
    }

    return { ok: true, rows };
}

/* ══ Recomposición ══════════════════════════════════════════════════════════ */

/**
 * Vuelve a juntar una colección a partir de sus filas.
 *
 * **Nunca devuelve un valor que `validateCollection` rechace**, y ésa es la
 * regla más importante del módulo. Las cuatro colecciones documento degradan a
 * un valor de fábrica cuando la validación falla —`preferences.get()` a
 * `empty()`, `settings.read()` a `defaults()`— y **el siguiente gesto normal del
 * usuario persiste ese vacío**, porque los escritores son leer-mutar-escribir.
 * Un fallo de fusión se convertiría así en pérdida definitiva de alergias, de
 * banderas médicas o del perfil entero. Si no se puede producir un valor válido,
 * se falla hacia arriba y no se escribe nada.
 *
 * Las filas que no valen se ponen en CUARENTENA y se informan, en vez de tumbar
 * la colección entera: una receta con una nota vacía no puede llevarse por
 * delante las otras doscientas.
 *
 * @param {string} collection
 * @param {readonly SyncRow[]} rows
 * @returns {{ ok: true, value: unknown, quarantined: SyncRow[] } | { ok: false, error: string }}
 */
export function join(collection, rows) {
    const politica = POLICY[collection];
    if (!politica) return { ok: false, error: 'sync.unknownCollection' };

    const vivas = agrupar(collection, rows);
    /** @type {SyncRow[]} */ const cuarentena = [];
    /** @type {Record<string, *>} */ const out = { schemaVersion: COLLECTIONS[collection] ? versionDe(collection) : 0 };

    for (const parte of politica.parts) {
        if (parte.kind === 'doc') {
            const fila = vivas.get('[]');
            if (fila && fila.value !== null && typeof fila.value === 'object') {
                Object.assign(out, fila.value);
            }
            continue;
        }
        if (parte.kind === 'scalar') {
            const fila = vivas.get(JSON.stringify([parte.field]));
            out[parte.field] = fila ? (fila.value ?? null) : null;
            continue;
        }
        // `members` y `list` comparten la recomposición: se recogen las filas de
        // ese campo, se ordenan por `ordinal` —NO por clave— y se filtran las
        // que no valen por su cuenta.
        const suyas = [...vivas.values()]
            .filter((f) => f.keyPath.length >= 2 && f.keyPath[0] === parte.field)
            .sort((a, b) => a.ordinal - b.ordinal);

        /** @type {*[]} */ const items = [];
        for (const fila of suyas) {
            if (!valeSola(collection, parte.field, fila.value)) { cuarentena.push(fila); continue; }
            items.push(fila.value);
        }
        out[parte.field] = recortar(collection, parte, items, cuarentena, suyas);
    }

    const validado = validateCollection(collection, out);
    if (!validado.ok) return { ok: false, error: 'sync.joinInvalid' };
    return { ok: true, value: validado.value, quarantined: cuarentena };
}

/**
 * Agrupa las filas por clave, resolviendo repeticiones de forma **conmutativa**:
 * el resultado no depende del orden en que lleguen.
 *
 * Gana el `ordinal` menor; a igualdad, el valor menor por comparación de su
 * forma serializada. Sin esa segunda regla, unir A con B y unir B con A darían
 * resultados distintos, y la sincronía no convergería.
 *
 * Una lápida borra la clave y no se puede deshacer con una fila viva: si no,
 * bastaría con que el dispositivo que no vio el borrado hablara el último.
 *
 * @param {string} collection
 * @param {readonly SyncRow[]} rows
 * @returns {Map<string, SyncRow>}
 */
function agrupar(collection, rows) {
    /** @type {Map<string, SyncRow>} */ const vivas = new Map();
    /** @type {Set<string>} */ const borradas = new Set();

    for (const fila of rows) {
        if (!fila || fila.collection !== collection || !Array.isArray(fila.keyPath)) continue;
        const clave = JSON.stringify(fila.keyPath);
        if (fila.deleted) { borradas.add(clave); vivas.delete(clave); continue; }
        if (borradas.has(clave)) continue;

        const previa = vivas.get(clave);
        if (!previa) { vivas.set(clave, fila); continue; }
        if (fila.ordinal < previa.ordinal) { vivas.set(clave, fila); continue; }
        if (fila.ordinal === previa.ordinal
            && JSON.stringify(fila.value) < JSON.stringify(previa.value)) {
            vivas.set(clave, fila);
        }
    }
    return vivas;
}

/**
 * ¿Este elemento vale por sí solo?
 *
 * Se valida una colección que contiene SOLO ese elemento. Aísla el problema: sin
 * esto, una receta con una nota vacía —que es inválida aquí y válida en
 * `nutrition`— tumbaría la colección entera y los lectores degradarían a lista
 * vacía.
 *
 * @param {string} collection
 * @param {string} field
 * @param {unknown} item
 * @returns {boolean}
 */
function valeSola(collection, field, item) {
    const prueba = { schemaVersion: versionDe(collection), ...vacioDe(collection), [field]: [item] };
    return validateCollection(collection, prueba).ok;
}

/**
 * Recorta una lista al tope del esquema, de forma DETERMINISTA.
 *
 * Desbordar no es teórico: dos dispositivos con sesenta exclusiones duras cada
 * uno dan ciento veinte, `arrayOf` tumba la colección y `preferences.get()`
 * degrada a vacío — o sea, se pierden las alergias. Recortar en silencio también
 * es malo, así que lo recortado se informa en la cuarentena y quien llame decide
 * qué enseñar (§4, B9).
 *
 * @param {string} collection
 * @param {*} parte
 * @param {*[]} items
 * @param {SyncRow[]} cuarentena
 * @param {readonly SyncRow[]} filas
 * @returns {*[]}
 */
function recortar(collection, parte, items, cuarentena, filas) {
    if (items.length === 0) return items;

    // El tope se descubre probando, no se teclea: así no puede desincronizarse
    // del validador.
    let tope = items.length;
    while (tope > 0 && !validateCollection(collection,
        { schemaVersion: versionDe(collection), ...vacioDe(collection), [parte.field]: items.slice(0, tope) }).ok) {
        tope -= 1;
    }
    if (tope >= items.length) return items;

    const sobran = parte.overflow === 'keepNewest' && typeof parte.newest === 'function'
        // Las más recientes: un historial viejo no le sirve a nadie.
        ? [...items].sort((a, b) => String(parte.newest(b)).localeCompare(String(parte.newest(a)))).slice(tope)
        : items.slice(tope);

    for (const item of sobran) {
        const fila = filas.find((f) => f.value === item);
        if (fila) cuarentena.push(fila);
    }
    return items.filter((it) => !sobran.includes(it));
}

/* ══ Canonicalización ═══════════════════════════════════════════════════════ */

/**
 * La forma canónica de una colección: `join(split(v))`.
 *
 * Colapsa las claves repetidas —dos check-ins del mismo día pasan a ser uno— y
 * materializa los opcionales ausentes. Es **idempotente**: aplicarla dos veces
 * da lo mismo que aplicarla una, y eso es lo que se prueba sobre todo el corpus.
 *
 * @param {string} collection
 * @param {unknown} value
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
export function canonicalize(collection, value) {
    const partido = split(collection, value);
    if (!partido.ok) return partido;
    const juntado = join(collection, partido.rows);
    if (!juntado.ok) return juntado;
    return { ok: true, value: juntado.value };
}

/* ══ Fusión dentro de una fila ══════════════════════════════════════════════ */

/**
 * Fusiona dos versiones de la MISMA fila.
 *
 * Solo `checkins` la necesita, y por una razón concreta: los dos escritores de
 * un check-in producen filas asimétricas. El peso rápido de «Hoy» escribe la
 * fila entera; el formulario completo también. Entre dispositivos, «gana el
 * último» hace que apuntar el peso por la mañana en el móvil borre la cintura,
 * las escalas y las notas del check-in de la tarde — y las dos filas son
 * válidas, así que no hay conflicto que detectar.
 *
 * Reglas, en este orden:
 *
 * 1. `measuresCm` y `subjective` se **unen por clave**.
 * 2. En `fatPct`, `scaleMuscleKg`, `boneKg` y `notes`, **un valor no nulo nunca
 *    lo pisa un nulo o un vacío**.
 * 3. Lo demás —`weightKg` incluido— lo decide quien llame, con el reloj del
 *    servidor (M9-4). Aquí `a` es el que gana por convenio.
 *
 * **Lo que se sacrifica:** si el usuario borra a propósito una medida, el otro
 * dispositivo la resucita. Es preferible a perder un check-in entero.
 *
 * @param {string} collection
 * @param {*} a el que gana los empates
 * @param {*} b
 * @returns {*}
 */
export function mergeRow(collection, a, b) {
    if (collection !== 'checkins') return a;
    if (a === null || typeof a !== 'object') return b;
    if (b === null || typeof b !== 'object') return a;

    /** Un valor «con contenido»: ni nulo, ni indefinido, ni cadena vacía. */
    const tiene = (/** @type {*} */ x) => x !== null && x !== undefined && x !== '';

    return {
        ...b,
        ...a,
        measuresCm: { ...(b.measuresCm ?? {}), ...(a.measuresCm ?? {}) },
        subjective: { ...(b.subjective ?? {}), ...(a.subjective ?? {}) },
        fatPct: tiene(a.fatPct) ? a.fatPct : (b.fatPct ?? null),
        scaleMuscleKg: tiene(a.scaleMuscleKg) ? a.scaleMuscleKg : (b.scaleMuscleKg ?? null),
        boneKg: tiene(a.boneKg) ? a.boneKg : (b.boneKg ?? null),
        notes: tiene(a.notes) ? a.notes : (b.notes ?? '')
    };
}

/**
 * Fusiona dos colecciones enteras: parte las dos, junta las filas y recompone.
 *
 * Para `achievements` aplica además la regla declarada: un logro desbloqueado no
 * se re-bloquea, y su `atISO` es el **más antiguo** de los dos —se desbloqueó
 * entonces, no cuando el otro dispositivo se enteró—.
 *
 * @param {string} collection
 * @param {unknown} mia
 * @param {unknown} suya
 * @returns {{ ok: true, value: unknown, quarantined: SyncRow[] } | { ok: false, error: string }}
 */
export function merge(collection, mia, suya) {
    const a = split(collection, mia);
    if (!a.ok) return a;
    const b = split(collection, suya);
    if (!b.ok) return b;

    /** @type {Map<string, SyncRow>} */ const porClave = new Map();
    for (const fila of [...a.rows, ...b.rows]) {
        const clave = JSON.stringify(fila.keyPath);
        const previa = porClave.get(clave);
        if (!previa) { porClave.set(clave, fila); continue; }
        porClave.set(clave, { ...previa, value: fusionarValor(collection, previa, fila) });
    }

    // ORDEN CANÓNICO, y solo aquí.
    //
    // `join` conserva el orden de inserción a propósito: es lo que hace que
    // rellenar una fecha pasada —el caso normal— no reordene la lista de nadie.
    // Pero al fusionar DOS dispositivos ese orden no existe: cada lado trae sus
    // propios ordinales, empiezan los dos en cero, y el resultado dependería de
    // quién hablara primero. Dos máquinas acabarían con estados distintos y se
    // los mandarían la una a la otra para siempre.
    //
    // La convergencia es propiedad del MERGE, no del reparto. Se reasignan los
    // ordinales por clave, que es determinista y conmutativa — y que además
    // coincide con lo que los escritores ya hacen: `checkins`, `steps` e
    // `intakeLog` se guardan ordenados por fecha.
    const canonicas = [...porClave.values()]
        .sort((x, y) => JSON.stringify(x.keyPath).localeCompare(JSON.stringify(y.keyPath)))
        .map((fila, i) => ({ ...fila, ordinal: i }));

    return join(collection, canonicas);
}

/**
 * @param {string} collection
 * @param {SyncRow} a
 * @param {SyncRow} b
 * @returns {*}
 */
function fusionarValor(collection, a, b) {
    if (collection === 'achievements') {
        const ia = instante(/** @type {*} */ (a.value)?.atISO);
        const ib = instante(/** @type {*} */ (b.value)?.atISO);
        return ia <= ib ? a.value : b.value;
    }
    if (collection === 'checkins') return mergeRow('checkins', a.value, b.value);
    return a.value;
}

/* ══ Consulta ═══════════════════════════════════════════════════════════════ */

/** Las colecciones que este módulo sabe repartir. @returns {string[]} */
export const collections = () => Object.keys(POLICY).sort();

/**
 * El ámbito de una colección: `sync` si alguna de sus partes viaja.
 * @param {string} collection
 * @returns {'sync' | 'local' | null}
 */
export function scopeOf(collection) {
    const politica = POLICY[collection];
    if (!politica) return null;
    return politica.parts.some((p) => p.scope === 'sync') ? 'sync' : 'local';
}

/**
 * Por qué cada colección se reparte como se reparte. Se expone para que un test
 * pueda exigir que ninguna se quede sin explicación.
 * @param {string} collection
 * @returns {string}
 */
export const noteOf = (collection) => POLICY[collection]?.note ?? '';

/** Las partes declaradas de una colección, para inspección y tests. */
export const partsOf = (/** @type {string} */ collection) =>
    (POLICY[collection]?.parts ?? []).map((p) => ({ ...p }));

/* ══ Utilidades ═════════════════════════════════════════════════════════════ */

/** La versión de esquema que lleva el valor por defecto de una colección. */
function versionDe(/** @type {string} */ collection) {
    return /** @type {*} */ (COLLECTIONS[collection]?.makeDefault())?.schemaVersion ?? 0;
}

/** El valor por defecto sin su versión: sirve de relleno al validar una parte. */
function vacioDe(/** @type {string} */ collection) {
    const { schemaVersion, ...resto } = /** @type {*} */ (COLLECTIONS[collection]?.makeDefault() ?? {});
    return resto;
}

/**
 * Un instante normalizado, para usar como clave.
 *
 * Dos dispositivos pueden escribir el mismo instante con distinto formato
 * (`+00:00` frente a `Z`, o con más decimales). Normalizar en la CLAVE y dejar
 * el dato literal en la carga útil es lo que hace que la fusión encuentre las
 * dos filas sin tocar lo que el usuario tiene guardado.
 *
 * @param {unknown} iso
 * @returns {string}
 */
function instante(iso) {
    if (typeof iso !== 'string') return '';
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toISOString() : iso;
}

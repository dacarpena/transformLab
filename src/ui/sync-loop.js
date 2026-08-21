// @ts-check

/**
 * Cuándo se sincroniza (M9-4b).
 *
 * `src/data/sync.js` sabe CÓMO; este módulo decide CUÁNDO, y esa decisión es
 * casi toda de producto:
 *
 * - **Solo con la pestaña a la vista.** Un móvil con la aplicación en segundo
 *   plano no tiene por qué gastar batería ni datos, y el techo de peticiones del
 *   plan es compartido con todo lo demás. Al ocultarse se para; al volver, lo
 *   primero que hace es mirar.
 * - **Solo con red.** Sin conexión no se intenta: se anota que hay algo
 *   pendiente y se sincroniza al volver, que es lo que el navegador ya avisa.
 * - **Con espera de cinco segundos, que se REINICIA con cada cambio.** Teclear
 *   un check-in son diez escrituras seguidas en el almacén; sin reiniciarla
 *   serían cuatro sincronías en vez de una. Y con un tope de treinta segundos,
 *   porque una espera que se reinicia sin tope no llega a cumplirse nunca
 *   mientras alguien siga escribiendo.
 * - **Sin solaparse.** Una sincronía en curso no lanza otra: la segunda pediría
 *   las mismas filas y las escribiría dos veces.
 *
 * ## Cómo se entera de que algo cambió
 *
 * Por `storage.revision()`, el contador que ya sube con cualquier escritura,
 * incluidas las de otra pestaña. Se consulta cada pocos segundos y es comparar
 * dos enteros: no hay que tocar ninguno de los 125 llamantes de `storage.js`, y
 * la capa de datos sigue sin enterarse de que existe una red.
 *
 * ## Reintentar sin castigar al servidor
 *
 * Un fallo no se reintenta a los cinco segundos: la espera se dobla —treinta
 * segundos, un minuto, dos— hasta un tope de cinco minutos, y se reinicia con
 * la primera sincronía buena. Sin eso, un servidor caído recibiría una petición
 * cada cinco segundos de cada pestaña abierta, que es precisamente lo que no
 * necesita mientras está caído.
 *
 * ## La única parada dura
 *
 * Si el push responde `sync.massDelete` —iba a borrar más de lo que conserva—,
 * el bucle **se planta** y no vuelve a subir hasta que alguien lo confirme. Es
 * el caso del almacén que se vacía solo, y reintentarlo cada cinco segundos
 * convertiría un susto en una pérdida.
 */

import * as storage from '../data/storage.js';
import * as sync from '../data/sync.js';

/** Espera tras el último cambio local, antes de subir. Se reinicia con cada uno. */
const DEBOUNCE_MS = 5_000;

/** Y el tope: pase lo que pase, no se espera más que esto desde el primer cambio. */
const MAX_ESPERA_MS = 30_000;

/** Cada cuánto se mira si el contador local se ha movido. */
const TICK_MS = 3_000;

/** Cada cuánto se baja sin que aquí haya cambiado nada. */
const PULL_EVERY_MS = 60_000;

/** La primera espera tras un fallo, y el tope al que se dobla. */
const BACKOFF_MIN_MS = 30_000;
const BACKOFF_MAX_MS = 300_000;

/**
 * @typedef {'off' | 'idle' | 'syncing' | 'pending' | 'offline' | 'error' | 'blocked'} EstadoSync
 */

/**
 * @typedef {Object} Estado
 * @property {EstadoSync} state
 * @property {number | null} lastAt cuándo terminó bien la última, en epoch ms
 * @property {string | null} error el código del último fallo
 * @property {number} adoptedTotal perfiles nuevos inscritos desde que arrancó
 *   el bucle. Es un ACUMULADOR, no un booleano, y por eso: quien lo consume
 *   compara contra el último que ya atendió, y así una señal que solo debe
 *   dispararse una vez no se dispara con cada cambio de estado.
 * @property {{ applied: number, removed: number, merged: number, kept: number,
 *              adopted: number, pushed: number, tombstones: number,
 *              conflicts: number } | null} last
 */

/** @type {string | null} */ let userId = null;
/** @type {*} */ let latido = null;
/** @type {*} */ let espera = null;
let corriendo = false;
let revisionVista = -1;
let ultimoPull = 0;
let espera_fallo = 0;
let noAntesDe = 0;
let primerCambio = 0;
let revisionUltimoLatido = -1;
/** @type {(() => void) | null} */ let alCambiar = null;

/**
 * Qué se ejecuta en cada pasada.
 *
 * Es un parámetro y no una llamada fija a `sync.sync` porque lo que este módulo
 * decide es CUÁNDO, no qué: lo que se programa es un argumento del problema. En
 * la aplicación siempre es `sync.sync`; en los tests es una función que cuenta
 * llamadas, que es la única forma de medir un calendario sin esperarlo en tiempo
 * real.
 *
 * @type {(userId: string, opciones: { allowMassDelete?: boolean }) => Promise<*>}
 */
let ejecutarPasada = (id, opciones) => sync.sync(id, opciones);

/** @type {Estado} */
let estado = { state: 'off', lastAt: null, error: null, adoptedTotal: 0, last: null };

/** El estado actual, para que el panel lo pinte. @returns {Estado} */
export const status = () => ({ ...estado });

/** @param {(() => void) | null} fn */
export function onChange(fn) { alCambiar = fn; }

/** @param {Partial<Estado>} parche */
function cambiar(parche) {
    estado = { ...estado, ...parche };
    alCambiar?.();
}

/**
 * Empieza a sincronizar esta cuenta. Es idempotente: llamarlo dos veces con el
 * mismo usuario no monta dos bucles.
 *
 * @param {string} id
 * @param {{ run?: (userId: string, opciones: { allowMassDelete?: boolean }) => Promise<*> }} [deps]
 */
export function start(id, deps = {}) {
    if (userId === id && latido !== null) return;
    stop();
    if (deps.run) ejecutarPasada = deps.run;
    userId = id;
    revisionVista = storage.revision();
    revisionUltimoLatido = revisionVista;
    ultimoPull = 0;
    espera_fallo = 0;
    noAntesDe = 0;
    primerCambio = 0;
    cambiar({ state: 'idle', error: null });
    escuchar();
    arrancar();
    void ejecutar();
}

/** Para el bucle y olvida la cuenta. Se llama al salir. */
export function stop() {
    dejarDeEscuchar();
    parar();
    if (espera !== null) { clearTimeout(espera); espera = null; }
    userId = null;
    cambiar({ state: 'off', error: null, last: null });
}

/**
 * Sincroniza AHORA, saltándose la espera. Es lo que hace el botón.
 *
 * @param {{ allowMassDelete?: boolean }} [opciones]
 * @returns {Promise<Estado>}
 */
export async function syncNow(opciones = {}) {
    if (espera !== null) { clearTimeout(espera); espera = null; }
    // Confirmar el borrado masivo levanta la parada: es la única forma de
    // salir de `blocked`, y tiene que ser un gesto explícito.
    if (opciones.allowMassDelete && estado.state === 'blocked') cambiar({ state: 'idle' });
    // Pulsar el botón se salta el retroceso: quien lo pulsa ya sabe que falló.
    noAntesDe = 0;
    await ejecutar(opciones);
    return status();
}

/* ── El bucle ────────────────────────────────────────────────────────────── */

function arrancar() {
    parar();
    if (typeof setInterval !== 'function') return;
    latido = setInterval(tick, TICK_MS);
}

function parar() {
    if (latido !== null) { clearInterval(latido); latido = null; }
}

function visible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

function conRed() {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
}

function tick() {
    if (userId === null || !visible()) return;

    const revision = storage.revision();
    // DOS preguntas distintas, y confundirlas es un fallo real que estuvo aquí:
    // «¿queda algo por subir?» es cierto hasta que una sincronía lo suba, y
    // «¿ha cambiado algo desde el latido anterior?» solo lo es cuando alguien
    // acaba de escribir. Reiniciando la espera con la primera, cada latido la
    // empujaba tres segundos más allá y la subida no llegaba NUNCA.
    const hayCambios = revision !== revisionVista;
    const cambioNuevo = revision !== revisionUltimoLatido;
    revisionUltimoLatido = revision;

    if (!conRed()) {
        if (hayCambios && estado.state !== 'blocked') cambiar({ state: 'offline' });
        return;
    }

    if (hayCambios) {
        if (estado.state !== 'blocked' && estado.state !== 'syncing') cambiar({ state: 'pending' });
        // Solo se reprograma si acaba de escribirse algo, o si no había nada
        // programado —el caso de volver la red, que deja cambios sin cita—.
        if (cambioNuevo || espera === null) programar();
        return;
    }

    if (Date.now() < noAntesDe) return;

    // Nada ha cambiado aquí, pero otro dispositivo puede haber escrito. Es la
    // única razón por la que este bucle habla con el servidor sin motivo local,
    // y por eso su periodo es un minuto y no tres segundos.
    if (Date.now() - ultimoPull >= PULL_EVERY_MS) void ejecutar();
}

/**
 * Programa la subida, reiniciando la espera si ya había una.
 *
 * Tres cosas se combinan aquí, y las tres importan: la espera se reinicia con
 * cada cambio —o teclear un check-in serían cuatro sincronías—, no se pasa del
 * tope desde el primer cambio —o escribir sin parar la aplazaría para siempre—,
 * y nunca cae antes de `noAntesDe`, que es el retroceso tras un fallo.
 */
function programar() {
    const ahora = Date.now();
    if (primerCambio === 0) primerCambio = ahora;

    const objetivo = Math.max(
        Math.min(ahora + DEBOUNCE_MS, primerCambio + MAX_ESPERA_MS),
        noAntesDe
    );
    if (espera !== null) clearTimeout(espera);
    espera = setTimeout(() => { espera = null; void ejecutar(); }, Math.max(0, objetivo - ahora));
}

/**
 * Una pasada. No se solapa consigo misma.
 * @param {{ allowMassDelete?: boolean }} [opciones]
 */
async function ejecutar(opciones = {}) {
    if (userId === null || corriendo) return;
    if (estado.state === 'blocked' && !opciones.allowMassDelete) return;
    if (!conRed()) return cambiar({ state: 'offline' });

    corriendo = true;
    primerCambio = 0;
    cambiar({ state: 'syncing' });

    try {
        const r = await ejecutarPasada(userId, opciones);
        ultimoPull = Date.now();

        const resumen = {
            applied: r.pull.applied, removed: r.pull.removed,
            merged: r.pull.merged, kept: r.pull.kept, adopted: r.pull.adopted,
            pushed: r.push?.pushed ?? 0, tombstones: r.push?.tombstones ?? 0,
            conflicts: r.push?.conflicts ?? 0
        };

        if (r.ok) {
            // La revisión se toma AL TERMINAR, y a propósito: el pull acaba de
            // escribir en el almacén y esas escrituras también suben el
            // contador. Tomándola al empezar, cada sincronía que trajera algo
            // dejaría el contador «cambiado» y provocaría la siguiente, en
            // bucle.
            //
            // Lo que se paga: una escritura del usuario que caiga justo mientras
            // la petición viaja no dispara la sincronía inmediata. No se pierde
            // —el push la encuentra igual, porque quien decide qué sube es la
            // sombra y no el contador—, solo espera al pull del minuto.
            espera_fallo = 0;
            noAntesDe = 0;
            const adoptedTotal = estado.adoptedTotal + resumen.adopted;
            cambiar({
                state: 'idle', lastAt: Date.now(), error: null,
                adoptedTotal, last: resumen
            });
            // DESPUÉS de avisar, no antes. Quien escucha puede repintar la
            // aplicación entera —es justo lo que hay que hacer cuando aparece un
            // perfil nuevo—, y repintar escribe en el almacén. Tomando la
            // revisión antes, esas escrituras quedarían como «cambios sin subir»
            // y el bucle no pararía nunca de sincronizar.
            revisionVista = storage.revision();
        } else if (r.error === 'sync.massDelete') {
            // Parada dura. Ver la cabecera: reintentarlo solo lo empeoraría.
            cambiar({ state: 'blocked', error: r.error, last: resumen });
        } else {
            retroceder();
            cambiar({ state: 'error', error: r.error ?? 'api.unknown', last: resumen });
        }
    } catch {
        // `sync.js` no lanza —está escrito para no hacerlo—, pero si algún día
        // lo hiciera, un bucle que muere en silencio es peor que uno que lo dice.
        retroceder();
        cambiar({ state: 'error', error: 'api.unknown' });
    } finally {
        corriendo = false;
    }
}

/** Dobla la espera tras un fallo, hasta el tope. */
function retroceder() {
    espera_fallo = espera_fallo === 0
        ? BACKOFF_MIN_MS
        : Math.min(espera_fallo * 2, BACKOFF_MAX_MS);
    noAntesDe = Date.now() + espera_fallo;
}

/* ── Señales del navegador ───────────────────────────────────────────────── */

const alCambiarVisibilidad = () => {
    if (!visible()) { parar(); return; }
    arrancar();
    // Volver a la aplicación es el momento en que más falta hace mirar: puede
    // haber horas de cambios de otro dispositivo.
    tick();
    if (userId !== null && Date.now() - ultimoPull >= TICK_MS) void ejecutar();
};

const alIrseLaRed = () => { if (userId !== null) cambiar({ state: 'offline' }); };

const alVolverLaRed = () => {
    if (userId === null) return;
    if (estado.state === 'offline') cambiar({ state: 'pending' });
    void ejecutar();
};

function escuchar() {
    if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', alCambiarVisibilidad);
    }
    if (typeof globalThis.addEventListener === 'function') {
        globalThis.addEventListener('online', alVolverLaRed);
        globalThis.addEventListener('offline', alIrseLaRed);
    }
}

function dejarDeEscuchar() {
    if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', alCambiarVisibilidad);
    }
    if (typeof globalThis.removeEventListener === 'function') {
        globalThis.removeEventListener('online', alVolverLaRed);
        globalThis.removeEventListener('offline', alIrseLaRed);
    }
}

/** Para los tests: devuelve el bucle a su estado de fábrica. */
export function resetForTests() {
    stop();
    estado = { state: 'off', lastAt: null, error: null, adoptedTotal: 0, last: null };
    alCambiar = null;
    corriendo = false;
    revisionVista = -1;
    ultimoPull = 0;
    espera_fallo = 0;
    noAntesDe = 0;
    primerCambio = 0;
    revisionUltimoLatido = -1;
    ejecutarPasada = (id, opciones) => sync.sync(id, opciones);
}

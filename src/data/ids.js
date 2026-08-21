// @ts-check

/**
 * Los identificadores de perfil, y las constantes que los acompañan (M9-1).
 *
 * **Este módulo NO IMPORTA NADA**, y eso es su razón de ser. Las constantes que
 * hay aquí las necesitan `storage.js` (el namespace de aparcamiento),
 * `profiles.js` (el generador), `profile-remap.js` (los reservados) y
 * `demo-profile.js` (su propio id). Si vivieran en cualquiera de ellos habría un
 * ciclo, y los ciclos de módulos ES no fallan al compilar: fallan al ARRANCAR,
 * con un `ReferenceError: Cannot access '…' before initialization` que aparece o
 * no según qué módulo se cargue primero.
 *
 * Eso pasó de verdad al escribir M9-1: `profiles.js → profile-remap.js →
 * demo-profile.js → profiles.js`. El typecheck estaba limpio y tres tests en
 * rojo; en el navegador habría sido una pantalla en blanco. Un módulo hoja lo
 * hace imposible.
 */

/**
 * Bytes de entropía de un id de perfil. Dieciséis: 128 bits, que es donde la
 * probabilidad de colisión deja de merecer una comprobación.
 *
 * Comprobar contra el índice antes de crear no serviría de todos modos: el caso
 * que importa es la colisión entre DISPOSITIVOS distintos, donde no hay índice
 * común que mirar. Ésa es justamente la razón de que los ids dejen de ser `pN`.
 */
const ID_BYTES = 16;

/**
 * Genera un id de perfil **opaco**.
 *
 * `crypto.getRandomValues` y no `Math.random`, que está prohibido en `src/` y
 * vigilado por `test/security.test.js`. El alfabeto es base64url, que
 * `schema.js` ya acepta (`/^[A-Za-z0-9_-]{1,40}$/`) y que **no contiene el
 * punto**: el punto es el separador de las claves del almacén, y
 * `storage.setActiveProfile` lo rechaza precisamente para que el segmento de
 * perfil se pueda trocear sin ambigüedad.
 *
 * @returns {string}
 */
export function newProfileId() {
    const bytes = crypto.getRandomValues(new Uint8Array(ID_BYTES));
    let binario = '';
    for (const b of bytes) binario += String.fromCharCode(b);
    return btoa(binario).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Un id de ITEM opaco, con su prefijo para que siga siendo legible en un volcado.
 *
 * Los cuatro generadores que había —`freshId`, `freshExerciseId`,
 * `freshTemplateId`— construían `<prefijo>_<longitud+1>_<slug>`: deterministas a
 * propósito, para no depender del reloj ni del azar. Eso está bien dentro de un
 * dispositivo y es **una certeza de colisión entre dos**.
 *
 * Reproducido, y con nombres que un usuario escribe de verdad: «Press de banca
 * con barra» y «Press de banca con mancuernas» comparten los doce primeros
 * caracteres alfanuméricos, así que los dos salen `ex_1_Pressdeban`. Son dos
 * ejercicios DISTINTOS con pesos musculares distintos: al sincronizar, las
 * series de uno se atribuirían al grupo muscular del otro. Eso no es pérdida de
 * datos, es **un dato falso presentado como verdadero** — la clase de defecto
 * que hundió la v4.0.
 *
 * El prefijo se conserva porque cuesta cero y hace legible un volcado del
 * almacén; la unicidad la aportan los 128 bits de detrás.
 *
 * @param {string} prefix
 * @returns {string}
 */
export function newItemId(prefix) {
    return `${prefix}_${newProfileId()}`;
}

/**
 * El id del perfil de ejemplo.
 *
 * Es fijo a propósito: el ejemplo se instala, se usa y se borra entero, y toda
 * la garantía de que no contamina los datos reales es de NAMESPACE. Vive aquí y
 * no en `demo-profile.js` para que `profile-remap.js` pueda consultarlo sin
 * arrastrar el motor entero a la ruta de arranque — `demo-profile.js` importa
 * `core/demo.js`, que importa el motor.
 */
export const DEMO_PROFILE_ID = 'demo';

/**
 * Namespace de aparcamiento cuando no hay ningún perfil activo.
 *
 * Las escrituras accidentales caen en un cajón identificable en vez de
 * contaminar el perfil de alguien. No colisiona con ningún id real: los opacos
 * son 22 caracteres de base64url, y los `pN` de antes tampoco eran `none`.
 */
export const NO_PROFILE = 'none';

/**
 * Ids que **no se remapean** al subir de esquema.
 *
 * Solo el del ejemplo: no se sincroniza, así que no hay nada que colisionar, y
 * remapearlo rompería en silencio `isInstalled()`, `isDemo()` y `uninstall()` —
 * dejando un perfil que el usuario no puede borrar ocupando uno de los diez
 * huecos de `MAX_PROFILES`.
 *
 * Que la lista esté aquí y no repartida es lo que permitirá a `sync-policy.js`
 * (M9-2) excluir lo mismo sin volver a decidirlo.
 */
export const RESERVED_PROFILE_IDS = Object.freeze([DEMO_PROFILE_ID]);

/**
 * ¿Este id se queda como está?
 * @param {string} id
 * @returns {boolean}
 */
export function isReservedProfileId(id) {
    return RESERVED_PROFILE_IDS.includes(id);
}

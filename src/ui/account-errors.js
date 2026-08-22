// @ts-check

/**
 * El vocabulario de errores del servidor, y su traducción (M9-5).
 *
 * Vive en su propio módulo, y no dentro del panel de Cuenta, porque lo consultan
 * dos vistas que no tienen nada que ver la una con la otra: Ajustes y Fotos.
 * Importar el panel entero —con su modal, su bucle de sincronía y su
 * criptografía— para averiguar qué texto lleva un código sería arrastrar media
 * aplicación a una vista que solo quiere enseñar una frase.
 *
 * Es una lista EXPLÍCITA y no una consulta al diccionario: `t()` devuelve la
 * clave cuando falta, pero además avisa por consola, así que usarlo para
 * preguntar «¿existe esta clave?» llenaría la consola de ruido cada vez que el
 * servidor devuelve un código nuevo.
 *
 * Y hay un test que exige que cada código de aquí tenga su entrada en los DOS
 * diccionarios: un error sin texto es una pantalla muda en el peor momento.
 */

/** Los códigos que la interfaz sabe explicar. */
export const ERROR_KEYS = Object.freeze([
    'account.unsupported', 'account.cancelled', 'account.authenticatorFailed',
    'account.badRecoveryKit', 'account.noRecoveryKit', 'account.needsSecondPasskey',
    'account.locked',
    'api.offline', 'api.timeout', 'api.badResponse', 'api.badPath', 'api.unknown',
    'credential.last', 'credential.notFound', 'auth.required', 'auth.failed',
    'auth.tooMany',
    'challenge.invalid', 'body.tooLarge', 'body.malformed',
    // La sincronía (M9-4). `sync.massDelete` no es un fallo: es la guarda que
    // se planta cuando un push iba a borrar más de lo que conserva, y su texto
    // tiene que decir exactamente eso o la persona no sabrá qué confirmar.
    'sync.locked', 'sync.writeFailed', 'sync.massDelete', 'sync.noProfiles',
    'sync.badResponse', 'sync.badBody', 'sync.badRow', 'sync.tooManyRows',
    'sync.noAccount', 'sync.badCursor',
    // Las fotos (M9-5).
    'photos.quota', 'photos.tooLarge', 'photos.notFound', 'photos.storeFailed',
    'photos.badKey', 'photos.empty', 'photos.unreadable', 'photos.undecryptable',
    'account.photosNotDeleted',
    // Entrar con Google (M10).
    'google.notConfigured', 'google.badRequest', 'google.badState', 'google.unreachable',
    'google.exchangeFailed', 'google.badResponse', 'google.noIdToken', 'google.badIdToken',
    'google.badIssuer', 'google.badAudience', 'google.badNonce', 'google.expired',
    'google.noSubject'
]);

/**
 * Traduce un código de error a su clave de i18n.
 *
 * Lo que no esté previsto cae en un genérico, nunca en el código crudo: enseñar
 * `body.malformed` a una persona es un literal visible fuera de i18n y encima no
 * le dice nada.
 *
 * @param {string} codigo
 * @returns {string}
 */
export function claveDeError(codigo) {
    return ERROR_KEYS.includes(codigo) ? `account.error.${codigo}` : 'account.error.generic';
}

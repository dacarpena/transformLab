-- TransformLab · identidad y llaves (M8-2)
--
-- LO QUE ESTE ESQUEMA NO TIENE, que es lo primero que hay que mirar:
-- ni correo, ni nombre de usuario, ni contraseña, ni hash de contraseña, ni
-- nada que identifique a una persona. La identidad es una passkey, y una
-- passkey es una clave pública. Un volcado completo de esta base no dice quién
-- es nadie.
--
-- CONVENCIONES
--
--   · Los identificadores son OPACOS: 16 bytes de `crypto.getRandomValues` en
--     base64url. Nada de autoincrementos —un `id=1` cuenta cuántas cuentas hay y
--     cuándo se creó cada una— y nada derivado de datos del usuario.
--   · Las marcas de tiempo son INTEGER en milisegundos desde epoch y las pone
--     SIEMPRE el servidor. Los relojes de los móviles están mal, y la capa de
--     datos del cliente ya nunca lee el reloj (`nowISO` se inyecta).
--   · Los secretos se guardan HASHEADOS (`sha256`), nunca en claro, y se
--     comparan en tiempo constante. No hay KDF lento: un KDF existe para
--     comprarle tiempo a un secreto de ~30 bits que eligió una persona, y aquí
--     todos los secretos son de 128 o 160 bits de `getRandomValues`.
--   · `ON DELETE CASCADE` en todo lo que cuelga de `users`: el borrado de cuenta
--     (RGPD art. 17) tiene que ser una sola sentencia que no pueda dejar restos.
--     El código además borra explícitamente, porque depender de que la
--     integridad referencial esté activada es depender de una configuración.

-- ── Cuentas ──────────────────────────────────────────────────────────────────
CREATE TABLE users (
    id                   TEXT    PRIMARY KEY,
    created_at           INTEGER NOT NULL,

    -- El envoltorio de recuperación: la clave de datos (DK) cifrada con una
    -- clave derivada del kit imprimible de 160 bits. Es la ÚNICA vía de vuelta
    -- si se pierden todos los dispositivos, y el servidor no puede abrirla: solo
    -- guarda bytes y la sal.
    --
    -- Nulos hasta que el usuario genera el kit. Ver `protected_at`.
    wrapped_dk_recovery  BLOB,
    recovery_salt        BLOB,

    -- LA REGLA DURA, escrita en el esquema y no solo en el código.
    --
    -- Una cuenta no está protegida hasta que hay vía de vuelta: el kit guardado,
    -- o una segunda passkey dada de alta. Mientras esto sea NULL **no se sube ni
    -- un byte de datos**, porque con cifrado extremo a extremo subir sin vía de
    -- vuelta es fabricar una pérdida irreversible: el día que se rompa el
    -- teléfono, los datos del servidor son ruido para todo el mundo, incluidos
    -- nosotros.
    protected_at         INTEGER,

    -- Cuota de fotos en R2, en bytes. Se lleva aquí y no contando objetos:
    -- `list()` sobre un prefijo con miles de fotos cuesta varias peticiones.
    photo_bytes          INTEGER NOT NULL DEFAULT 0
) STRICT;

-- ── Passkeys ─────────────────────────────────────────────────────────────────
CREATE TABLE credentials (
    -- El id de la credencial que devuelve el autenticador, en base64url. Es
    -- único globalmente por definición de WebAuthn.
    id            TEXT    PRIMARY KEY,
    user_id       TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- La clave pública en SPKI DER, tal y como la devuelve `getPublicKey()`.
    -- Entra directa en `crypto.subtle.importKey('spki', …)`: por eso este
    -- proyecto no necesita ni un descodificador de CBOR ni uno de COSE.
    public_key    BLOB    NOT NULL,
    algorithm     INTEGER NOT NULL,           -- -7 = ES256. Se guarda para poder
                                              -- rechazar lo que no se soporta en
                                              -- vez de fallar al verificar.

    -- Contador de firmas del autenticador. Tiene que ser MONÓTONO: si una firma
    -- llega con un contador que ya se vio, la credencial está clonada y la
    -- sesión no se abre. Muchos autenticadores modernos lo dejan siempre en 0;
    -- en ese caso la comprobación se salta, y eso también hay que saberlo.
    sign_count    INTEGER NOT NULL DEFAULT 0,

    -- El envoltorio de la DK para ESTE dispositivo, cifrado con una clave
    -- derivada de la extensión PRF del autenticador. Nulo si el autenticador no
    -- da PRF: entonces la DK vive en IndexedDB como `CryptoKey` no extraíble.
    wrapped_dk    BLOB,
    prf_salt      BLOB,

    -- La etiqueta que el usuario le pone («el iPhone»), CIFRADA con la DK. Es
    -- dato del usuario, y el servidor no lee datos del usuario. Se descifra al
    -- listar los dispositivos, que es después de iniciar sesión y por tanto con
    -- la DK ya disponible.
    label_ct      BLOB,

    created_at    INTEGER NOT NULL,
    last_used_at  INTEGER
) STRICT;

CREATE INDEX credentials_by_user ON credentials(user_id);

-- ── Retos de WebAuthn ────────────────────────────────────────────────────────
--
-- Un reto es de un solo uso y caduca en minutos. Se guarda su HASH, no el reto:
-- así una lectura de esta tabla no permite responder a un reto en vuelo.
--
-- `user_id` es nulo en el login: las credenciales son descubribles, así que
-- cuando se emite el reto todavía no se sabe quién va a responderlo. Ése es
-- justo el efecto que se busca —no hay campo «usuario» que enumerar—, y por eso
-- la columna no puede ser NOT NULL.
CREATE TABLE challenges (
    hash             BLOB    PRIMARY KEY,
    purpose          TEXT    NOT NULL,       -- 'register' | 'login' | 'add-credential'

    -- La cuenta a la que pertenece el reto, cuando ya existe: solo en
    -- 'add-credential'. Nulo en 'login' —ver arriba— y también en 'register'.
    user_id          TEXT    REFERENCES users(id) ON DELETE CASCADE,

    -- El id que TENDRÁ la cuenta si el registro llega a término. Se genera al
    -- emitir el reto porque WebAuthn hornea el `user.id` DENTRO de la
    -- credencial, y es lo que el autenticador devuelve como `userHandle` en el
    -- login descubrible: tiene que decidirlo el servidor, y antes de firmar.
    --
    -- Sin clave foránea, y no es un descuido: en este momento la cuenta todavía
    -- no existe. Crear la fila de `users` al emitir el reto sí permitiría la FK,
    -- pero dejaría una cuenta huérfana por cada registro abandonado —y los
    -- registros se abandonan— con su tarea de limpieza detrás. Un reto caduca en
    -- cinco minutos y se borra solo.
    pending_user_id  TEXT,

    created_at       INTEGER NOT NULL,
    expires_at       INTEGER NOT NULL
) STRICT;

CREATE INDEX challenges_by_expiry ON challenges(expires_at);

-- ── Sesiones ─────────────────────────────────────────────────────────────────
--
-- EN D1 Y NO EN KV, a propósito: KV propaga hasta 60 segundos, y eso convertiría
-- «cerrar sesión en todos los dispositivos» en una mentira durante un minuto.
-- Justo el minuto que importa.
CREATE TABLE sessions (
    token_hash       BLOB    PRIMARY KEY,     -- sha256 del token de la cookie
    user_id          TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_id    TEXT    REFERENCES credentials(id) ON DELETE SET NULL,

    -- La FAMILIA de la sesión: sobrevive a las rotaciones. Si un token ya rotado
    -- se presenta fuera de la ventana de gracia, alguien tiene una copia — y se
    -- revoca la familia ENTERA, no solo ese token. Sin familia solo se podría
    -- revocar el token robado, que es el que el atacante ya usó.
    family_id        TEXT    NOT NULL,
    prev_token_hash  BLOB,
    rotated_at       INTEGER,

    created_at       INTEGER NOT NULL,        -- vida absoluta: 30 días
    last_seen_at     INTEGER NOT NULL,        -- inactividad: 14 días deslizantes
    expires_at       INTEGER NOT NULL,

    -- Truncada a /24 (IPv4) o /48 (IPv6). Sirve para que el usuario reconozca
    -- una sesión que no es suya; la IP completa sería un dato de localización
    -- que esta aplicación no necesita guardar.
    ip_trunc         TEXT
) STRICT;

CREATE INDEX sessions_by_user   ON sessions(user_id);
CREATE INDEX sessions_by_family ON sessions(family_id);
CREATE INDEX sessions_by_expiry ON sessions(expires_at);
CREATE INDEX sessions_by_prev   ON sessions(prev_token_hash);

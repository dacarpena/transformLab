-- TransformLab · las filas cifradas de la sincronización (M9-3)
--
-- LO PRIMERO QUE HAY QUE ENTENDER DE ESTA TABLA: el servidor no puede leer ni
-- una de sus filas. Guarda `ciphertext`, y la clave que lo abre nunca sale del
-- dispositivo. Un volcado completo de esta base son bytes.
--
-- ## Una fila por ITEM, no por colección
--
-- Con un bloque por colección y «gana el último que escribe», dos dispositivos
-- que apuntan check-ins de días distintos sin red pierden uno entero — y ése es
-- el camino más frecuente de esta aplicación. Con una fila por item son filas
-- distintas y no hay conflicto que resolver.
--
-- ## Qué es `item_tag`, y por qué no es el `dateISO`
--
-- ```
--   K_idx    = HKDF-SHA256(DK, info='tl.idx.v1')
--   item_tag = HMAC-SHA256(K_idx, collection ‖ keyPath) truncado a 16 bytes
-- ```
--
-- **Determinista**, así que los dos dispositivos calculan la misma etiqueta para
-- la misma fila y la fusión las encuentra. **Opaco**, así que el servidor nunca
-- aprende de qué día es un check-in ni cómo se llama una receta. Y truncado a 16
-- bytes porque 128 bits ya hacen despreciable la colisión dentro de un usuario.
--
-- Guardar el `dateISO` en claro habría sido mucho más cómodo y habría convertido
-- esta tabla en un diario de cuándo se pesa cada persona.
--
-- ## Lo que el servidor SÍ aprende, y se documenta porque no se puede evitar
--
-- Que usas la aplicación y cuándo. Tu IP truncada. Cuántos perfiles tienes.
-- Qué colecciones usas y **cuántos items tiene cada una** — eso se filtra por
-- construcción al usar una fila por item, y es el precio de no perder datos. El
-- tamaño individual sí se oculta: el cliente rellena a múltiplos de 256 bytes
-- antes de cifrar.

CREATE TABLE records (
    user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- El id opaco del perfil, tal y como lo generó el cliente (esquema v7). No
    -- se valida contra ninguna tabla: el servidor no sabe qué perfiles hay ni
    -- tiene por qué. Solo son namespaces dentro de la cuenta.
    profile_id  TEXT    NOT NULL,

    -- El nombre de la colección, en claro. Es lo único de la fila que no está
    -- cifrado, y es deliberado: el servidor lo necesita para poder validar que
    -- pertenece al catálogo y para servir un pull por colección. Revela QUÉ
    -- módulos usa la persona, no qué hay dentro.
    collection  TEXT    NOT NULL,

    item_tag    BLOB    NOT NULL,

    -- NULO en una lápida, y la restricción de abajo lo EXIGE.
    --
    -- La primera versión tenía `NOT NULL` y guardaba cero bytes para las
    -- lápidas. No funciona: SQLite guarda un blob de longitud cero como NULL, y
    -- la restricción saltaba. El arreglo no es rellenar con un byte de mentira,
    -- es que el esquema diga lo que pasa: una fila borrada **no tiene**
    -- criptograma, no tiene uno vacío.
    ciphertext  BLOB,

    -- Revisión de ESTA fila, monótona. La fija el cliente y el servidor la
    -- comprueba: sirve para detectar una escritura sobre una versión que ya no
    -- es la última (M9-4).
    rev         INTEGER NOT NULL DEFAULT 1,

    -- Orden global dentro de la CUENTA. Es lo que hace posible un pull
    -- incremental (`?since=`) sin depender de ningún reloj: el cliente guarda el
    -- último `seq` que vio y pide lo que haya después.
    --
    -- Por cuenta y no por perfil: así un dispositivo con un solo cursor recoge
    -- los cambios de todos sus perfiles en una pasada.
    seq         INTEGER NOT NULL,

    -- Reloj del SERVIDOR, en milisegundos. Nunca el del cliente: los relojes de
    -- los móviles están mal, y quien resuelve un conflicto tiene que hacerlo con
    -- una referencia que las dos partes compartan.
    updated_at  INTEGER NOT NULL,

    -- LÁPIDA. Un borrado no quita la fila: la marca. Sin esto, borrar un
    -- check-in en un dispositivo sería invisible para el otro, que lo tiene y lo
    -- volvería a subir — el borrado se desharía solo.
    --
    -- Una lápida no lleva `ciphertext`: no hay nada que decir de una fila
    -- borrada. La restricción de abajo lo exige en los dos sentidos.
    deleted     INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (user_id, profile_id, collection, item_tag),

    -- Las dos mitades de una fila tienen que contarse lo mismo. Sin esto caben
    -- dos estados imposibles y los dos son silenciosos: una fila viva sin
    -- criptograma —que el cliente descifra a nada y descarta sin decir por qué—
    -- y una lápida con cuerpo, que gasta ancho de banda para transportar algo
    -- que nadie va a leer.
    CHECK ((deleted = 0 AND ciphertext IS NOT NULL)
        OR (deleted = 1 AND ciphertext IS NULL)),
    CHECK (deleted IN (0, 1))
) STRICT;

-- El índice del pull incremental. Es la consulta caliente y la única que se hace
-- en el camino de sincronizar: `WHERE user_id = ?1 AND seq > ?2 ORDER BY seq`.
CREATE INDEX records_by_seq ON records(user_id, seq);

-- El contador de `seq` de cada cuenta.
--
-- Vive en `users` y no en un `AUTOINCREMENT` global por dos razones: un
-- autoincremento compartido revelaría a cada cuenta cuánto escriben las demás, y
-- además haría que el `?since=` de un usuario avanzara por culpa del tráfico de
-- otro, obligándole a paginar por filas que no son suyas.
ALTER TABLE users ADD COLUMN last_seq INTEGER NOT NULL DEFAULT 0;

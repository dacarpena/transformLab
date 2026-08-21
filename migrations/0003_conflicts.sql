-- TransformLab · el perdedor de un conflicto NO se tira (M9-4)
--
-- Cuando dos dispositivos editan la misma fila sin verse, alguien tiene que
-- ganar. Lo normal en una sincronización es que el perdedor desaparezca sin
-- dejar rastro, y eso es exactamente lo que no puede pasar aquí: la fila que
-- pierde puede ser el único sitio donde estaba la cintura de un check-in.
--
-- Así que el perdedor se COPIA aquí antes de que lo sobrescriban. Sigue cifrado
-- —el servidor no lo puede leer, igual que no puede leer el ganador— y el
-- cliente puede pedirlo y enseñárselo a su dueño.
--
-- ## Cómo se detecta un conflicto, sin relojes
--
-- Cada fila lleva su `rev`. El cliente manda con qué `rev` creía estar
-- trabajando (`baseRev`); si lo guardado va por delante, es que alguien escribió
-- entremedias y el cliente no lo había visto. Eso es un conflicto, y no depende
-- de la hora de ningún teléfono.
--
-- ## Por qué no hay clave foránea a `records`
--
-- Un conflicto sobrevive a su fila. Si el usuario borra después ese check-in, la
-- versión que perdió sigue siendo suya y sigue pudiendo pedirla. La cascada va
-- por `users`, que es la única que debe llevárselo todo (RGPD art. 17).

CREATE TABLE record_conflicts (
    user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_id  TEXT    NOT NULL,
    collection  TEXT    NOT NULL,
    item_tag    BLOB    NOT NULL,

    -- El cuerpo que perdió. NULO si lo que perdió fue una lápida: perder un
    -- borrado también se registra, porque significa que un dato que alguien
    -- quiso quitar volvió, y eso hay que poder explicarlo.
    ciphertext  BLOB,

    rev         INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    deleted     INTEGER NOT NULL DEFAULT 0,

    -- Cuándo se detectó, con el reloj del SERVIDOR. `updated_at` es de cuando se
    -- escribió la versión perdedora; los dos hacen falta para contar la historia.
    detected_at INTEGER NOT NULL,

    -- Por `rev`, no por fila: si la misma fila pierde tres veces, se guardan las
    -- tres versiones. Y la repetición exacta del mismo `rev` no duplica, que es
    -- lo que permite reintentar un push sin ensuciar.
    PRIMARY KEY (user_id, profile_id, collection, item_tag, rev),

    CHECK (deleted IN (0, 1))
) STRICT;

CREATE INDEX record_conflicts_by_user ON record_conflicts(user_id, detected_at);

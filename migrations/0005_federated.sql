-- TransformLab · entrar con Google, junto a las passkeys (M10)
--
-- ## Por qué una tabla aparte y no una fila en `credentials`
--
-- `credentials` guarda passkeys: clave pública, algoritmo, contador de firmas y
-- el sobre de la DK. Una identidad de Google no tiene nada de eso —no firma
-- nada, no envuelve ninguna clave— y meterla ahí obligaría a que la mitad de las
-- columnas fueran nulas y a que todo el código que las lee supiera distinguir
-- dos cosas que no se parecen. Son dos formas de demostrar quién eres, y solo
-- una de ellas participa en la criptografía.
--
-- ## `provider` existe aunque hoy solo haya uno
--
-- La clave primaria es (proveedor, sujeto) y no solo el sujeto. Sin el
-- proveedor, el día que entre un segundo el identificador `12345` de uno podría
-- colisionar con el `12345` del otro y una persona entraría en la cuenta de
-- otra. Es una columna que hoy siempre vale lo mismo y que evita exactamente ese
-- fallo.
--
-- ## Lo que Google nos dice, y lo que NO le pedimos
--
-- Solo el permiso `openid`. Ni correo, ni nombre, ni foto: Google responde «este
-- es el sujeto 1234» y nada más. Aquí se guarda ese identificador opaco y ya.
-- Pedir el correo habría sido gratis y habría metido un dato personal en una
-- base que hoy no tiene ninguno.
--
-- ## Y lo que Google NO puede hacer
--
-- Descifrar. La clave de datos se genera en el dispositivo y no sale de él, así
-- que una cuenta creada con Google sigue necesitando su clave de recuperación
-- para leerse en un dispositivo nuevo. Google sustituye a la passkey, no al kit.

CREATE TABLE federated_identities (
    provider    TEXT    NOT NULL,       -- 'google'
    subject     TEXT    NOT NULL,       -- el `sub` del proveedor, opaco
    user_id     TEXT    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,

    PRIMARY KEY (provider, subject)
) STRICT;

-- Para poder listar las identidades de una cuenta y para que el borrado en
-- cascada no tenga que recorrer la tabla entera.
CREATE INDEX federated_by_user ON federated_identities(user_id);

-- El verificador de PKCE y el `nonce` del reto de OAuth.
--
-- Van en `challenges` porque es exactamente lo que es: un secreto de un solo uso
-- que caduca en minutos y que ya tiene su barrido. Una tabla nueva para esto
-- sería otra cosa que limpiar.
ALTER TABLE challenges ADD COLUMN payload TEXT;

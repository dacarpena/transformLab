-- TransformLab · un techo por IP en las rutas de autenticación (M9-7)
--
-- Sin esto, `POST /api/auth/register/start` es una escritura sin autenticar y
-- sin límite: cualquiera puede pedir retos en bucle hasta llenar la base. No es
-- un ataque sofisticado —es un `while true; do curl; done`— y el plan gratuito
-- de D1 tiene un tope de almacenamiento que se alcanza sin esfuerzo.
--
-- ## Por qué se cuentan los RETOS VIVOS y no las peticiones
--
-- Un contador de peticiones por ventana exige una escritura por petición, que es
-- justo lo que se quiere limitar: el limitador pagaría el coste del ataque.
--
-- Aquí se cuenta lo que ya existe. Cada reto emitido es una fila que caduca sola
-- en cinco minutos, así que «cuántos retos vivos tiene esta IP» ES la tasa, y
-- medirla es un `SELECT COUNT(*)` sobre un índice. El ataque queda acotado por
-- construcción: como mucho, N filas por IP en todo momento.
--
-- ## La IP se guarda TRUNCADA
--
-- /24 en IPv4 y /48 en IPv6, igual que en `sessions`. Es suficiente para
-- limitar y deja de ser un identificador de una persona concreta. Y `NULL`
-- cuando no la hay —no todos los despliegues la mandan—, en cuyo caso no se
-- limita por IP: preferible a inventar una clave que agrupe a todo el mundo y
-- deje a los usuarios legítimos fuera unos a otros.

ALTER TABLE challenges ADD COLUMN ip_trunc TEXT;

CREATE INDEX challenges_by_ip ON challenges(ip_trunc, expires_at);

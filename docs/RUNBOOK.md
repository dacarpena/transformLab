# Runbook — el servidor de TransformLab

Qué mirar y qué hacer cuando algo va mal en producción. Está escrito para leerse
con prisa: cada apartado empieza por el síntoma.

Antes de nada, dos cosas que conviene tener presentes porque cambian lo que se
puede hacer:

1. **El servidor no puede leer los datos de nadie.** Todo lo de `records` y todo
   lo de R2 está cifrado con una clave que solo existe en los dispositivos del
   usuario. No hay ningún procedimiento que empiece por «abre su check-in y mira»,
   porque no se puede. Si alguien escribe pidiendo que le recuperemos sus datos y
   ha perdido sus dispositivos **y** su clave de recuperación, la respuesta
   honesta es que no hay forma. Está así a propósito.
2. **La aplicación funciona entera sin cuenta.** Una caída del servidor no deja a
   nadie sin sus datos: deja de sincronizarse, y el cliente lo dice y reintenta
   con retroceso exponencial. No es una emergencia; es una molestia.

---

## Ver qué está pasando

```bash
npx wrangler pages deployment tail --project-name=transformlab
```

Cada petición deja **una línea JSON**. Los campos son estos y no hay más:

| Campo | Qué es |
|---|---|
| `evt` | `req` en una petición; el nombre del incidente en lo demás |
| `route` | el **patrón** de la ruta (`/api/photos/:id`), nunca la ruta concreta |
| `method`, `status` | los de HTTP |
| `ms` | duración, **redondeada a 10 ms** |
| `error` | el código que se le devolvió al cliente |
| `detail`, `at` | el nombre de la excepción y su primer marco de pila |

**Lo que nunca aparece, y es deliberado:** rutas concretas, identificadores de
perfil, foto o cuenta, tokens, IPs —ni truncadas—, criptogramas y el mensaje de
las excepciones. La razón está escrita en `functions/_lib/log.js`, y la corta es
que un id de foto es `ph_<fecha>`: registrarlo sería registrar en qué días
alguien se hace fotos de progreso. Un registro no se puede des-escribir.

Consecuencia práctica: **no se puede diagnosticar «lo que le pasa a este
usuario»** desde los registros. Se diagnostica el sistema. Si hace falta más,
se reproduce en local con `npm run serve:api`.

Eventos que no son `req` y qué significan:

| `evt` | Qué pasó |
|---|---|
| `session.reuse` | se presentó un token de sesión ya rotado: la familia entera queda revocada. Uno suelto es una pestaña vieja; muchos, un token copiado |
| `handler.threw` | excepción dentro de un manejador; el cliente recibió un 500 |
| `middleware.threw` | excepción fuera del enrutador; peor señal que la anterior |
| `sweep.failed` | el barrido de retos y sesiones caducados falló. No urge: se reintenta en el siguiente login |
| `photos.putFailed` | R2 rechazó una subida. La cuota reservada ya se devolvió |
| `photos.sweepFailed` | no se pudieron borrar las fotos al cerrar una cuenta. **La cuenta NO se cerró**, y el usuario tendrá que reintentarlo |

---

## Síntomas

### «No puedo entrar» / los logins fallan

Mirar en `tail` el `status` de `/api/auth/login/finish`.

- **429 `auth.tooMany`** — el techo de retos por IP. Quince retos vivos por IP
  truncada, y caducan en cinco minutos. Una oficina o una red móvil grande
  comparten IP; si esto se repite con usuarios legítimos, el número está en
  `MAX_CHALLENGES_PER_IP` (`functions/_lib/db.js`).
- **401 `auth.failed`** — la firma no verifica. Casi siempre es una passkey de
  otra cuenta o un `rpId` que no coincide, o sea un dominio distinto.
- **400 `challenge.invalid`** — el reto caducó (cinco minutos) o se gastó. Un
  diálogo del sistema que se queda abierto mucho rato acaba así.

Comprobar cuántos retos vivos hay:

```bash
npx wrangler d1 execute transformlab --remote --command "SELECT purpose, COUNT(*) AS n FROM challenges WHERE expires_at > unixepoch()*1000 GROUP BY purpose"
```

### «La sincronización no funciona»

El cliente enseña el estado en Ajustes → Cuenta. Los códigos y sus textos están
en `src/ui/account-errors.js`; los que llegan del servidor:

- **`sync.tooManyRows` (413)** — más de cincuenta filas en un push. El cliente
  trocea de cincuenta en cincuenta, así que esto solo pasa si alguien llama a
  mano a la API.
- **`sync.badRow` (400)** — una fila mal formada tumba el lote **entero**, a
  propósito: un push a medias dejaría la sombra del cliente apuntando a filas que
  no están.
- **`sync.noAccount` (404)** — la cuenta se borró mientras el push viajaba.

Cuánto ocupa una cuenta:

```bash
npx wrangler d1 execute transformlab --remote --command "SELECT COUNT(*) AS filas, SUM(LENGTH(ciphertext)) AS bytes FROM records WHERE user_id = '<userId>'"
```

### «Las fotos no suben»

- **413 `photos.quota`** — la cuenta llegó a los 100 MB (`MAX_ACCOUNT_BYTES` en
  `functions/_handlers/photos.js`). El contador vive en `users.photo_bytes` y se
  actualiza atómicamente con cada subida y cada borrado.
- **413 `photos.tooLarge`** — más de 8 MB en un objeto. El cliente comprime a
  1600 px antes de cifrar, así que un objeto así no ha pasado por ese camino.
- **502 `photos.storeFailed`** — R2 falló. La reserva de cuota se devolvió sola;
  no hay que tocar nada.

Si el contador de cuota se desviara de lo que hay de verdad en el bucket —solo
podría pasar por un fallo a medias que no llegara a devolver la reserva—, hay que
saber que **`wrangler` no sabe listar objetos**: solo tiene `r2 object get`, `put`
y `delete`. El inventario se mira de dos formas:

- Desde la propia aplicación: `GET /api/photos` con la sesión de esa persona
  devuelve sus objetos con su tamaño, y es lo que usa el barrido de huérfanos.
- Desde el panel de Cloudflare, en el bucket `transformlab-photos` (jurisdicción
  **EU**: con jurisdicción, el bucket vive en un espacio de nombres aparte y no
  aparece en el listado por defecto).

El contador se corrige a mano con un `UPDATE users SET photo_bytes = …`.

### La base se está llenando

El plan gratuito de D1 tiene un tope de almacenamiento. Lo único que crece sin
que nadie tenga cuenta son los retos, y están acotados por el techo por IP; lo
que crece con el uso son `records` y `record_conflicts`.

```bash
npx wrangler d1 execute transformlab --remote --command "SELECT 'records' AS t, COUNT(*) AS n FROM records UNION ALL SELECT 'conflicts', COUNT(*) FROM record_conflicts UNION ALL SELECT 'sessions', COUNT(*) FROM sessions UNION ALL SELECT 'challenges', COUNT(*) FROM challenges"
```

Los retos y las sesiones caducadas se barren solos en cada `login/start`
(`sweepExpired`). Si `sweep.failed` aparece con frecuencia, ese barrido no está
corriendo y hay que mirarlo: es lo único que impide que esas dos tablas crezcan
para siempre.

`record_conflicts` **no se barre**, y es deliberado: son las versiones que
perdieron un conflicto, y son de su dueño. Si algún día hay que acotarlas, la
decisión es de producto, no de operación.

### «He recibido una petición de borrado (RGPD art. 17)»

No hace falta hacer nada a mano: la persona lo hace desde Ajustes → Cuenta →
Cerrar la cuenta, con confirmación tecleada. Borra `users` y, en cascada,
credenciales, retos, sesiones, filas y conflictos; y **barre R2 antes de tocar
D1**, de modo que si el barrido falla la cuenta no se da por cerrada.

Lo que **no** borra son los datos del dispositivo de esa persona, y eso hay que
saber explicarlo: aquí la copia local es la buena y la del servidor existe para
que pueda haber más de un dispositivo.

Si hubiera que hacerlo desde fuera, el orden importa —R2 primero, porque las
claves se localizan por el prefijo del usuario y borrar la cuenta antes deja los
objetos sin nada que diga que existieron—. Las claves son
`u/<userId>/p/<perfilId>/<fotoId>`, se sacan del panel de Cloudflare (`wrangler`
no lista objetos) y se borran una a una:

```bash
npx wrangler r2 object delete transformlab-photos/u/<userId>/p/<perfilId>/<fotoId> --jurisdiction eu
npx wrangler d1 execute transformlab --remote --command "DELETE FROM users WHERE id = '<userId>'"
```

---

## Desplegar y volver atrás

`main` despliega solo a Cloudflare Pages. Para volver a una versión anterior:

```bash
npx wrangler pages deployment list --project-name=transformlab
```

y promocionar el despliegue anterior desde el panel de Cloudflare.

**Cuidado con el orden cuando hay migración.** Una migración de D1 se aplica a
mano y **antes** del despliegue que la necesita:

```bash
npx wrangler d1 migrations list transformlab --remote
npx wrangler d1 migrations apply transformlab --remote
```

Desplegar código que espera una tabla que no existe deja la API devolviendo 500
en todo lo que la toque. Y al revés —migrar antes de desplegar— es inofensivo:
las migraciones de este proyecto solo añaden.

**Y cuidado con `--remote` al desarrollar.** `npm run serve:api` levanta el
servidor contra una base LOCAL, que es lo que se quiere. Añadir `--remote` para
«probar de verdad» escribe en la base de producción, con los datos de gente real
dentro.

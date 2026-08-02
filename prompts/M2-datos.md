# Arranque M2 · Capa de datos

Pega esto en Claude Code al abrir la milestone M2 (con M1 cerrada):

---

Abrimos **M2 · Capa de datos**. Lee `CLAUDE.md` §3 y §5, y la sección M2 de `PLAN-V5.md`. Especificación de partida:

1. `docs/MODELO-DE-DATOS.md` — el esquema v4 completo (§2), sus invariantes y dónde se rompen (§5), y el estado real de localStorage (§4). Es lo que el migrador tiene que saber leer.
2. Decisiones C1–C6 y las tensiones 1 y 3 del registro de decisiones en `PLAN-V5.md` §0 (fotos → IndexedDB; sin bundler).

Contexto que condiciona el diseño:

- El esquema v5 **no es** el v4 con retoques: añade `muscleSource`, escenarios en el plan, check-ins con métricas subjetivas reales (las que en v4 eran sintéticas — decisión A2), set configurable de medidas, plantillas de comida, rutinas editables, logros y metadatos de fotos. `schema.js` (M2-1) lo define todo de una vez con typedefs JSDoc, reutilizando los del core donde ya existan. Los validadores devuelven `{ok, errors[]}`, nunca lanzan.
- Multiperfil (C4b) significa que **ninguna** clave se escribe sin el namespace `tl.5.<pid>.`. `storage.js` ya inyecta el prefijo desde M0; `profiles.js` gestiona el índice y el perfil activo. Borrar un perfil exige confirmación tipeando su nombre.
- El migrador (M2-3) corre una sola vez, al detectar claves `transformlab_*`. Secuencia obligatoria: (1) export automático de seguridad de las claves v4 tal cual, descargado o guardado bajo `tl.legacy.backup`; (2) transformación a v5 como primer perfil, con `muscleSource: 'estimated'` — en v4 el músculo salía siempre del ratio 0,48, así que jamás lo marques como medido; (3) renombrar las claves v4 a `tl.legacy.*` (no borrarlas). Los datos generados v4 NO se migran: el plan se regenera con el motor v2, porque la proyección legacy es precisamente el dato defectuoso.
- `backup.js` (M2-4) es el punto de entrada de datos hostiles del producto: el import valida esquema, **sanea todos los campos de texto** y muestra resumen antes de confirmar. Escribe el test con un fixture que incluya `<img src=x onerror=alert(1)>` en el nombre del perfil y verifica que sobrevive como texto plano.
- `photos-db.js` (M2-5) es el único módulo con IndexedDB. API async `add/get/list/remove(pid, …)` con blobs; sin UI en esta milestone.

Método: test primero también aquí. Necesitas un fixture v4 realista: constrúyelo desde `docs/MODELO-DE-DATOS.md` §3 (ejemplos reales) y guárdalo en `test/fixtures/v4-profile.json`.

Orden: M2-1 → M2-2 → M2-3 → M2-4 → M2-5 → M2-6. Empieza proponiéndome el typedef del esquema v5 completo en un mensaje (compacto, por colección); cuando lo confirme, ejecuta.

Fuera de alcance: UI de cualquier tipo, tocar el core salvo importar sus typedefs. Cierre: criterios de `PLAN-V5.md` M2 en la bitácora.

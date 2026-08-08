# TransformLab v5 — memoria de proyecto

Lee este fichero completo al inicio de cada sesión. Es la fuente de verdad sobre cómo se trabaja aquí. El plan de trabajo y su estado están en `PLAN-V5.md`. Si algo de este fichero contradice una petición puntual, señálalo antes de ejecutar.

## 1. Qué es este proyecto

TransformLab es una plataforma de **seguimiento de transformación corporal con proyección recalibrable**: el usuario define un objetivo, la app genera un plan por fases (definición / recomposición / volumen / mantenimiento) con proyección diaria y banda de escenarios, y los check-ins semanales reales se comparan contra esa proyección; cuando divergen, la app **ofrece** recalibrar (nunca lo hace en silencio). Todo vive en el navegador: cero llamadas de red con datos del usuario, cero backend.

Estrategia elegida: **reconstrucción dirigida (v5) en este mismo repo**. No es un greenfield libre ni una remediación incremental de la v4.0:

- La v4.0 queda congelada en `legacy/` como **referencia de solo lectura**. No se corrige, no se ejecuta, no se importa desde `src/`.
- Todo lo que se porta desde `legacy/` se porta **leyendo en paralelo su ficha en `docs/CATALOGO-DE-HALLAZGOS.md`**, para no arrastrar sus 130 defectos catalogados.
- Las fórmulas verificadas como correctas por la auditoría (Mifflin-St Jeor, multiplicadores de actividad, tasas de pérdida de grasa) se portan tal cual y se cubren con tests. El modelo de composición corporal NO se porta: se reimplementa según §4.
- `legacy/` se elimina al cerrar M5, cuando el port esté completo.

## 2. Fuentes de verdad, en orden

1. `CLAUDE.md` (este fichero) — convenciones e invariantes.
2. `PLAN-V5.md` — plan y bitácora de la v1 (M0–M7, cerrada). Para la **v2**, el plan activo es `docs/v2/PLAN-V2.md`, y los prompts de construcción de cada milestone están en `docs/v2/prompts/`.
3. `docs/` — la auditoría de la v4.0/v3.1: `CATALOGO-DE-HALLAZGOS.md` (fichas por ID), `METODOLOGIA-CIENTIFICA.md` (modelo y §8 "qué haría falta"), `MODELO-DE-DATOS.md`, `AUDITORIA.md`, `DEUDA-TECNICA.md`. Describen el legacy, no la v5, pero son el mapa de minas para el port y la especificación de partida del motor.
4. `legacy/` — el código v4.0. Solo lectura.

## 3. Arquitectura v5

Vanilla JS con **módulos ES nativos, sin bundler, sin framework** (decisión F4/F2). Consecuencia aceptada: el desarrollo requiere servidor local (`npm run serve`); el doble clic sobre `index.html` ya no funciona.

```
index.html                  carga css/tokens.css, css/app.css y src/main.js (type="module")
vendor/chart.umd.min.js     Chart.js fijado y servido en local (CSP 'self' + PWA offline)
css/tokens.css              ÚNICA fuente de color/espaciado/tipografía/radios (D8)
css/app.css                 estilos, solo consumiendo tokens; tema oscuro único (D7)
src/
  main.js                   arranque: storage → i18n → perfil → router
  core/                     motor puro, sin DOM, importable desde Node
    constants.js            tasas y multiplicadores, cada uno con su fuente citada en JSDoc
    engine.js               BMR, TDEE semanal + adaptación, kcal, composición, fases, validación
    generator.js            series diarias/semanales/mensuales + banda de escenarios + hitos
    ranges.js               fuente única de rangos y límites (motor Y onboarding beben de aquí)
    rng.js                  PRNG determinista con semilla (mulberry32 o similar)
  data/
    storage.js              wrapper localStorage: try/catch, namespace por perfil, degradación
    schema.js               schemaVersion, validadores de forma de cada objeto persistido
    migrate.js              migrador v4 → v5 (una sola vez, con export previo automático)
    profiles.js             multiperfil: creación, selección, borrado, namespace de claves
    photos-db.js            IndexedDB SOLO para fotos de progreso (blobs)
    backup.js               export/import JSON con validación de esquema y saneado de texto
  i18n/
    i18n.js                 t(clave, params); idioma persistido; fallback a 'es'
    es.js / en.js           diccionarios; NINGÚN string visible vive fuera de ellos
  ui/
    dom.js                  escapeHtml, tagged template html``, delegación de eventos, focus-trap
    dates.js                fechas legibles con Intl; SIEMPRE timeZone:'UTC' (las del motor son UTC)
    muscle-units.js         aduana de unidad de músculo (E11): traduce en la frontera, no en el core
    router.js               vistas + navegación; tabs inferiores en móvil, sidebar en escritorio
    views/_manifest.js      FUENTE ÚNICA de qué vistas hay: main.js y los specs beben de aquí
    components/             tarjetas, modal accesible, estados vacíos/error, toasts
    views/                  dashboard, onboarding, checkin, progress, projection, nutrition,
                            training, body, milestones, settings
  (core/timeline.js         fusiona fases/hitos/check-ins en una línea de tiempo; ventana de escenarios)
test/
  *.test.js                 node:test — el motor se prueba desde Node, sin navegador
  e2e/smoke.spec.js         Playwright — recorrido de humo
```

Claves de almacenamiento: `tl.<schemaVersion>.<profileId>.<colección>` (p. ej. `tl.5.p1.checkins`). Índice de perfiles en `tl.5.profiles`. Nunca una clave plana nueva fuera de este esquema.

## 4. Invariantes del motor (no negociables)

El defecto crítico del legacy nació de dos definiciones incompatibles de "músculo" (ver `docs/AUDITORIA.md` §1). En v5:

- Todo dato de músculo lleva **`muscleSource: 'measured' | 'estimated' | 'derived'`** (decisión A3; `derived` lo añadió E10 para las básculas de bioimpedancia) y las tres rutas de cálculo son explícitas. Prohibido cualquier clamp absoluto en kg sobre tejido magro; los límites son **relativos a la masa magra** y generan **aviso al usuario**, nunca corrección silenciosa (B9).
- **El motor solo habla de músculo esquelético** (E11). La «masa muscular» de una báscula doméstica es otra cantidad —la magra menos el hueso, ~95 % de la magra—, y confundirlas es el defecto que hundió la v4.0. La traducción vive en un único sitio, `src/ui/muscle-units.js`, en la frontera de la interfaz: nada convertido cruza hacia `src/core/`. Se traducen NIVELES absolutos; los INCREMENTOS son iguales en ambas unidades y no se tocan.
- Suelo calórico: `max(BMR, 1200 mujeres / 1500 hombres)`; si el suelo recorta el déficit, la duración de la fase se alarga proporcionalmente (B2).
- Calorías y composición están conectadas por equivalencia energética explícita (~7 700 kcal/kg de grasa): el déficit de cada fase se deriva de su pérdida esperada (B3).
- TDEE se recalcula semanalmente sobre el peso proyectado, con factor de adaptación metabólica documentado (B4, referencia Trexler).
- Tasas de ganancia muscular relativas al peso corporal, factor por sexo con fuente (B6). La fase de recomposición existe de verdad: déficit ligero y duración derivada (B7).
- Fluctuación diaria determinista con semilla del perfil; interruptor de visualización en la gráfica (B8).
- La proyección emite tres escenarios (pesimista / esperado / optimista) coherentes entre sí (B5).

Estos invariantes viven como **tests con nombre** en `test/` y deben estar en verde antes de cualquier commit que toque `src/core/`:

`identidad` (pedir la composición actual devuelve el peso actual ±1 kg, incluidos los 4 perfiles de la tabla de `docs/AUDITORIA.md` §1.2) · `conservacion` (peso = grasa + magro cada día) · `limites` (grasa, escalas 0–10 y kcal dentro de rango siempre) · `determinismo` (misma semilla → serie idéntica; el último día aterriza en el objetivo) · `cierre_de_plan` (las expectativas por fase suman exactamente el objetivo; los días de las fases suman el total) · `coherencia_energetica` (déficit acumulado ↔ Δ grasa dentro de tolerancia) · `escenarios` (pesimista ≤ esperado ≤ optimista en progreso, los tres cierran el plan).

## 5. Convenciones innegociables

- **Seguridad de render (F6):** ningún dato dinámico entra al DOM sin pasar por `escapeHtml`/`html\`\`` de `src/ui/dom.js`. Prohibido `onclick=` y cualquier manejador inline en cadenas HTML: siempre `addEventListener` o delegación. El vector real es el import de backups y el multiperfil: se sanea TODO.
- **i18n (A6):** ningún literal visible al usuario en `src/ui/`. Todo pasa por `t('clave')`. Añadir una clave = añadirla en `es.js` Y `en.js` en el mismo commit; hay un test que compara los dos diccionarios.
- **Tipos (F3):** `// @ts-check` + JSDoc en `src/core/` y `src/data/` como mínimo. `npm run typecheck` limpio antes de commit.
- **Tokens (D8):** cero valores hex/px "mágicos" en `app.css` o en JS; todo color, espaciado y radio sale de `tokens.css`.
- **Accesibilidad (F7, objetivo AA):** todo control alcanzable con teclado y con `:focus-visible`; modales con focus-trap + `Escape` + devolución de foco; contraste ≥ 4,5:1; `prefers-reduced-motion` respetado en toda animación; sin desbordes a 320 px.
- **Errores (D9):** cada vista define su estado vacío y su estado de error con salida clara. **Nunca** una acción destructiva como respuesta por defecto a un fallo (el legacy ofrecía borrar todos los datos si Chart.js no cargaba: H-013; eso no se repite).
- **Persistencia:** solo a través de `src/data/storage.js`. Prohibido `localStorage.` directo fuera de ese módulo. Fotos solo en IndexedDB vía `photos-db.js`.
- **Dependencias:** cero dependencias de runtime salvo Chart.js vendorizado. DevDeps permitidas: `typescript`, `@playwright/test`. Cualquier otra requiere justificarla en la bitácora antes de instalarla.
- Código en inglés (identificadores, claves), UI en `es`/`en` vía i18n, documentación del repo en español.

## 6. Comandos

```bash
npm run serve       # servidor local (python3 -m http.server 8080)
npm test            # node --test test/  (motor y datos)
npm run typecheck   # tsc --noEmit (checkJs sobre src/core y src/data)
npm run e2e         # Playwright smoke (requiere serve en marcha o webServer configurado)
npm run sw:bump     # sube CACHE_VERSION y sella sw.lock.json (tras tocar algo precacheado)
```

`sw.js` sirve lo precacheado primero y **sin revalidar**: si cambias un fichero
de `PRECACHE` y no subes `CACHE_VERSION`, quien ya tenga la app instalada
seguirá ejecutando el módulo viejo junto a los nuevos que sí pidió de red. Eso
lo impone `test/views-manifest.test.js` contra `sw.lock.json`; cuando falle,
`npm run sw:bump` es la respuesta.

**Trabajo en paralelo (worktrees):** desde E13-11, `CACHE_VERSION` se **deriva del
`precacheHash`** (`tl-<12 hex>`): mismo árbol → misma versión, y dos ramas ya no pueden
colisionar en un número compartido. La regla sigue siendo la misma y ahora es inocua:
**tras cualquier merge que toque `PRECACHE`, reejecuta `npm run sw:bump`** — es
idempotente, y el test del candado exige además que la versión sea exactamente la derivada
del contenido, así que escribirla a mano no compila en verde.

CI (GitHub Actions): typecheck + test en cada push/PR. Despliegue continuo: Cloudflare Pages sobre `main` (staging desde M0; dominio propio y lanzamiento público en M6).

## 7. Flujo de trabajo y control de alcance

- Se trabaja **una milestone a la vez**, en orden (M0 → M6), y dentro de ella tarea a tarea según `PLAN-V5.md`. La milestone activa es la primera con tareas sin marcar.
- Al abrir sesión: leer este fichero, leer la milestone activa en `PLAN-V5.md`, anunciar en una línea qué tarea se va a hacer. Si la tarea implica una decisión de diseño no cerrada en el plan, plantearla ANTES de programar, con opciones y una recomendación.
- **Regla anti-alcance:** cualquier idea que no esté en la milestone activa se anota en la sección BACKLOG de `PLAN-V5.md` y NO se implementa. Sin excepciones, tampoco si es pequeña.
- Al cerrar cada tarea: `npm test` y `npm run typecheck` en verde, marcar el checkbox en `PLAN-V5.md`, commit pequeño con mensaje convencional (`feat(core): …`, `fix(ui): …`, `test: …`, `chore: …`).
- Al cerrar sesión: 2–4 líneas en la bitácora de la milestone (qué se hizo, qué quedó a medias, cuál es el siguiente paso concreto).
- Una milestone se cierra solo cuando TODOS sus criterios de cierre (sección propia en `PLAN-V5.md`) se han ejecutado y pasan. El cierre se registra en la bitácora con fecha.
- No se refactoriza el trabajo de milestones cerradas salvo que un test lo exija o el plan lo pida.

## 8. Definición de "hecho" (toda tarea)

1. Tests e invariantes en verde; typecheck limpio.
2. Sin literales visibles fuera de i18n; sin hex fuera de tokens; sin `innerHTML` con datos sin escapar; sin `localStorage` directo.
3. Funciona con teclado y a 320 px si toca UI.
4. Si se tocó algo de `PRECACHE`, `npm run sw:bump` ejecutado.
5. Checkbox marcado en `PLAN-V5.md` y commit hecho.

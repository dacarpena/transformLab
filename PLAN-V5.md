# TransformLab v5 — Plan de reconstrucción

> Estado: **M0 sin iniciar** · Estrategia: reconstrucción dirigida en el mismo repo, legacy congelado en `legacy/` · Convenciones e invariantes: `CLAUDE.md`

Este documento es el estado vivo del proyecto: registro de decisiones, milestones con tareas (checkboxes), criterios de cierre verificables, backlog y bitácora. Claude Code lo lee al inicio de cada sesión y lo actualiza al cerrar cada tarea.

---

## 0. Registro de decisiones (cuestionario de 50, 2026-08-02)

Condensado por bloque. El detalle de cada pregunta está en el cuestionario original; aquí queda lo operativo.

**A · Producto.** Plataforma de seguimiento con proyección recalibrable (A1b). Las métricas sintéticas desaparecen: energía/sueño/motivación/adherencia pasan a ser datos reales del check-in (A2b). Músculo medido O estimado con `muscleSource` marcado (A3c). Producto público con vocación de usuarios reales (A4c). Publicada con dominio propio en **Cloudflare Pages** (A5b + nota). UI en español e inglés con i18n desde el día 0 (A6b). Los 5 módulos v4.0 se auditan al portarlos, catálogo en mano (A7a). La honestidad científica no se prioriza como mensaje de marca en este ciclo (A8c) — pero B5/B9/C6 la implementan de facto.

**B · Motor.** F1-2 + F1-3 del plan de deuda como base (B1a). Suelo calórico max(BMR, 1200♀/1500♂) con ajuste de duración (B2a). Equivalencia energética explícita kcal↔kg (B3a). TDEE semanal + factor de adaptación con fuente (B4a). Banda de escenarios pesimista/esperado/optimista (B5a). Tasas musculares relativas al peso, factor por sexo documentado (B6a). Recomposición real: déficit ligero y duración derivada (B7a). Fluctuación determinista con semilla + interruptor (B8a). Fuente única de rangos, avisos en vez de correcciones silenciosas (B9a).

**C · Datos.** schemaVersion en todo + migrador v4→v5 (C1a). Wrapper único de storage con try/catch y degradación (C2a). Export/import con validación y saneado (C3a). **Multiperfil con namespace** (C4b). localStorage con presupuesto y aviso de cuota para datos estructurados (C5a). Aviso de privacidad + «tus datos no salen del navegador» (C6a).

**D · UX/UI.** El dashboard abre con el estado real de HOY (D1a). Día real + línea HOY en la gráfica (D2a). Gráfica: bandas de fase, check-ins superpuestos, zoom/brush, hitos clicables, export a imagen (D3 a–e). Vista propia de progreso/desviación (D4a). Tabs inferiores en móvil, sidebar en escritorio (D5a). Onboarding rediseñado con preview en vivo (D6a). Solo tema oscuro, pulido (D7a). Tokens únicos + purga de CSS muerto (D8a). Cada estado vacío/error diseñado, nunca acción destructiva por defecto (D9a). Microinteracciones sobrias + reduced-motion, fuera el cursor-glow (D10a).

**E · Funcionalidades.** Recalibración ofrecida, nunca silenciosa, conservando historial de planes (E1a). Set configurable de medidas corporales (E2a). Fotos locales con comparador (E3a → IndexedDB, ver tensiones). Nutrición: macros corregidas + plantillas de comidas propias (E4a). Entrenamiento: editor de rutina + PRs + progresión sugerida (E5a). Silueta mejorada alimentada por medidas (E6a). PWA completa (E7a). Recordatorio local configurable (E8a). Racha + calendario de adherencia + tarjeta compartible + logros (E9 a–d).

**F · Ingeniería.** node:test + smoke E2E Playwright (F1a). 13 módulos → ESM nativo (F2a). @ts-check + JSDoc en core y data (F3a). Vanilla sin bundler (F4a). GitHub Actions: typecheck + tests + deploy automático (F5a). Paquete completo de seguridad: escapado, sin onclick inline, CSP, dependencia fijada (F6a). Accesibilidad AA verificable (F7a). Despliegue con checklist de release (F8a, hosting según A5: Cloudflare Pages).

### Tensiones detectadas y resueltas

1. **E3 (fotos) vs C5 (localStorage).** Fotos en localStorage revientan la cuota de ~5 MB con dos capturas. Resolución: datos estructurados en localStorage (C5a se mantiene); **fotos exclusivamente en IndexedDB** vía `photos-db.js`, con metadatos (id, fecha, perfil) en localStorage.
2. **F8a (GitHub Pages) vs nota de A5 (cloudflare).** La nota es más específica: **Cloudflare Pages** con dominio propio. La checklist de release de F8 se mantiene íntegra. GitHub Actions sigue siendo la CI; el deploy lo hace la integración Git de Cloudflare Pages sobre `main`.
3. **F4 (sin bundler) vs F2/A6/E7 (ESM, i18n, PWA).** Compatibles: ESM nativo, diccionarios como módulos JS y service worker escrito a mano. Coste aceptado: servidor local en desarrollo. Chart.js se **vendoriza** (fichero UMD fijado en `vendor/`) para cumplir CSP `'self'` y funcionar offline — sustituye al CDN+SRI del plan original.
4. **A8c (no priorizar honestidad como marca) vs B5/B9/C6.** No hay contradicción: los mecanismos se construyen porque son correctos; lo que se aplaza es convertirlos en narrativa de marketing dentro de la UI.

### Escala honesta

Con las 50 respuestas al máximo, esto son **~30–45 jornadas efectivas** de trabajo con Claude Code, no un sprint. El plan lo absorbe con 7 milestones, cada una desplegada y usable al cerrarse: si el ciclo se corta en M4, hay producto núcleo completo en producción; M5–M6 amplían y lanzan. Se trabaja a ritmo sostenible: cerrar milestones, no acumular frentes.

---

## Mapa de milestones

| M | Nombre | Resultado desplegable al cierre | Jornadas |
|---|---|---|---:|
| M0 | Fundaciones | Esqueleto v5 en Cloudflare Pages, CI en verde, legacy congelado | 1–2 |
| M1 | Motor científico v2 | Motor completo probado desde Node (sin UI aún) | 6–8 |
| M2 | Capa de datos | Multiperfil, migrador v4→v5, backup, fotos-db | 3–4 |
| M3 | Shell + Onboarding + Dashboard | App usable: alta de perfil → plan → panel HOY con gráfica | 6–8 |
| M4 | Ciclo de seguimiento | Check-in → desviación → recalibración; producto núcleo completo | 5–7 |
| M5 | Módulos satélite | Nutrición, entrenamiento, silueta, fotos, hitos, constancia | 8–12 |
| M6 | Producción | PWA, seguridad, AA, dominio, checklist de release ejecutada | 3–5 |

---

## M0 · Fundaciones

**Objetivo:** repo reconciliado y congelado; esqueleto v5 con todas las decisiones transversales materializadas (ESM, tokens, i18n, storage, tests, CI, deploy) para que nada se retrofite después.

### Tareas

- [ ] M0-1 · Reconciliar el repo: `git checkout -- .DS_Store` → `git fetch --all --prune` → `git pull --ff-only` (el local no tiene commits propios; queda en `d0afa49`, v4.0). Retirar el worktree obsoleto: `git worktree remove .claude/worktrees/silly-yonath` si existe.
- [ ] M0-2 · Higiene: `.gitignore` (`.DS_Store`, `.claude/`, `node_modules/`, `test-results/`, `*.log`), `git rm --cached .DS_Store`, `LICENSE` (elegir: MIT recomendada para producto público), `.editorconfig`.
- [ ] M0-3 · Congelar el legacy: mover `index.html`, `js/`, `css/`, `styles_new.css`, `test-calculation.js`, `aesthetic_milestones_complete.json`, `robots.txt` a `legacy/`. `docs/` se queda en la raíz. Commit propio: `chore: freeze v4.0 as legacy reference`.
- [ ] M0-4 · Esqueleto v5: árbol de `CLAUDE.md` §3 con ficheros mínimos funcionales — `index.html` (shell vacío + `<script type="module" src="src/main.js">`), `css/tokens.css` (paleta oscura inicial, tipografía, espaciados), `css/app.css`, `src/main.js`, `src/ui/dom.js` (`escapeHtml`, `html``, `on()` delegación), `src/i18n/` (t(), es, en con ~10 claves de arranque), `src/data/storage.js` (get/set/remove con try/catch, namespace, aviso de cuota).
- [ ] M0-5 · Vendorizar Chart.js: descargar la versión UMD actual fijada a `vendor/chart.umd.min.js`, anotar versión y hash en la bitácora.
- [ ] M0-6 · Tooling: `package.json` (scripts serve/test/typecheck/e2e; devDeps `typescript`, `@playwright/test`), `tsconfig.json` (`allowJs`, `checkJs`, `noEmit`, include `src/core`, `src/data`), primer test trivial de `storage.js` con `node:test`.
- [ ] M0-7 · CI: `.github/workflows/ci.yml` — checkout, node 22, `npm ci`, `npm run typecheck`, `npm test` en cada push/PR.
- [ ] M0-8 · Deploy: conectar el repo a Cloudflare Pages (build command vacío, output `/`). Verificar que la URL de staging sirve el shell v5.

### Criterios de cierre

- `git status -sb` limpio, sin `behind/ahead`; `git check-ignore .DS_Store` devuelve 0.
- `npm test` y `npm run typecheck` en verde, en local y en Actions.
- La URL de Cloudflare Pages sirve el shell v5 (aunque esté casi vacío).
- `legacy/` contiene la v4.0 completa y nada de `src/` la importa.

### Bitácora M0

_(vacía)_

---

## M1 · Motor científico v2

**Objetivo:** `src/core/` completo, puro (sin DOM), importable desde Node, con los invariantes de `CLAUDE.md` §4 en verde. Especificación de partida: `docs/METODOLOGIA-CIENTIFICA.md` (§3–§5 para lo que existe, §8 como lista de obligaciones) + decisiones B1–B9.

### Tareas

- [ ] M1-1 · `constants.js`: portar de `legacy/js/calculations.js` los valores verificados (multiplicadores de actividad, tasas de pérdida de grasa 0,5/0,75/1 % PC/sem, grasa esencial/mínima/máxima) con su fuente en JSDoc. Convertir tasas musculares a **relativas al peso** con fuente y factor por sexo documentado (B6). Añadir equivalencia energética (~7 700 kcal/kg) y factor de adaptación metabólica (B3, B4) con referencias.
- [ ] M1-2 · `rng.js`: PRNG determinista (mulberry32) sembrado desde `profileId + startDate`. Test: misma semilla → misma secuencia.
- [ ] M1-3 · `ranges.js`: fuente única de rangos (edad, peso, altura, %grasa por sexo, músculo relativo a masa magra 35–65 %). API que distingue `error` (imposible) de `warning` (improbable: se avisa, no se corrige). Cubre MOT-06, MOT-11, MOT-12, GEN-13.
- [ ] M1-4 · `engine.js` — composición: modelo con `muscleSource`. Ruta `estimated`: proporcional, sin clamp absoluto. Ruta `measured`: tejido magro no muscular conservado, validado en relativo con aviso. Test `identidad` con los 4 perfiles de `docs/AUDITORIA.md` §1.2 (80/20♂, 60/28♀, 95/30♂, 70/12♂) → peso actual ±1 kg. Cubre C-1..C-5.
- [ ] M1-5 · `engine.js` — energía: BMR (Mifflin-St Jeor, redondeado en origen), TDEE **semanal** sobre peso proyectado + adaptación (B4), objetivo calórico con suelo max(BMR, 1200♀/1500♂) y ajuste de duración cuando el suelo recorta (B2). La recomposición recibe su déficit ligero real (B7; mata la rama muerta MOT-04).
- [ ] M1-6 · `engine.js` — fases: planificador donde las expectativas por fase **suman exactamente** el objetivo (fuera restas mágicas de 2 kg/0,5 kg — MOT-08), duración de definición integrando la tasa sobre peso decreciente (MOT-16), duración de recomposición derivada (MOT-18), ramas explícitas para «ya estás en el objetivo» y «perder músculo» (MOT-10), guarda ante entradas no finitas (C-5/H-005).
- [ ] M1-7 · `generator.js`: serie diaria por interpolación + fluctuación determinista opcional (B8) que conserva masa; el último día aterriza en el objetivo; agregados semanales/mensuales coherentes (semana parcial marcada, meses de calendario, fase correcta en fronteras — GEN-07/11/12/15). Fechas en **UTC puro** de punta a punta (GEN-02/10). El generador NO muta el perfil (GEN-06): trabaja sobre copia y devuelve avisos.
- [ ] M1-8 · `generator.js` — escenarios: tres trayectorias (pesimista/esperado/optimista) desde los rangos de las tasas (B5), las tres cierran el plan. Hitos derivados del **cruce real de la serie** (GEN-03/04), con categorías declaradas en un solo sitio.
- [ ] M1-9 · Suite completa de invariantes: `identidad`, `conservacion`, `limites`, `determinismo`, `cierre_de_plan`, `coherencia_energetica`, `escenarios` + tests de `ranges` y casos degenerados. `// @ts-check` + JSDoc en todo `src/core/`.

### Criterios de cierre

- `npm test` en verde con los 7 invariantes nombrados presentes y no triviales.
- `npm run typecheck` limpio sobre `src/core/`.
- Ejecutar el test de identidad imprime los 4 perfiles del legacy con desvío ≤ 1 kg (frente a los −17/−35 kg del legacy).
- Cero referencias a DOM/`window` dentro de `src/core/`.

### Bitácora M1

_(vacía)_

---

## M2 · Capa de datos

**Objetivo:** persistencia multiperfil versionada, con migración desde v4, copia de seguridad y almacén de fotos. Especificación de partida: `docs/MODELO-DE-DATOS.md` (esquema legacy) + decisiones C1–C6 + A2/E2 (el esquema v5 añade check-ins con métricas reales y set de medidas).

### Tareas

- [ ] M2-1 · `schema.js`: definir el esquema v5 con JSDoc typedefs — perfil (con `muscleSource`), plan generado (con escenarios), check-ins (peso, %grasa, medidas configurables, energía/sueño/adherencia/motivación 1–10, notas), rutina/registro de entrenamiento, plantillas de comida, hitos, logros, metadatos de fotos, ajustes. `schemaVersion: 5` en todo objeto raíz. Validadores de forma.
- [ ] M2-2 · `profiles.js`: índice `tl.5.profiles`, perfil activo, crear/renombrar/borrar (borrar exige confirmación tipeada), namespace `tl.5.<pid>.*` aplicado por `storage.js`.
- [ ] M2-3 · `migrate.js`: detectar claves v4 (`transformlab_*`), volcar un export automático de seguridad, transformar a esquema v5 como primer perfil (marcando `muscleSource: 'estimated'` — el dato v4 venía del ratio 0,48), archivar las claves viejas con prefijo `tl.legacy.`. Test con fixture real copiado de un perfil v4.
- [ ] M2-4 · `backup.js`: export JSON de un perfil o de todos; import con validación de esquema, saneado de todos los campos de texto y resumen previo («este fichero contiene: perfil X, 12 check-ins…») antes de confirmar. Test de ida y vuelta byte-equivalente en datos estructurados.
- [ ] M2-5 · `photos-db.js`: IndexedDB `tl-photos`, store por perfil, API `add/get/list/remove` con blobs; presupuesto y recuento expuestos. Sin UI todavía.
- [ ] M2-6 · Presupuesto de cuota en `storage.js`: medir bytes usados por perfil, umbral de aviso (~60 % de 5 MB) que la UI consumirá en M3.

### Criterios de cierre

- `npm test` en verde incluyendo: migración de fixture v4 → v5 válida, ida y vuelta de backup, validadores rechazando 3 fixtures corruptos sin lanzar excepción no controlada.
- Simulación de cuota llena (mock de `setItem` que lanza) degrada con error tipado, no con crash.
- `npm run typecheck` limpio sobre `src/data/`.

### Bitácora M2

_(vacía)_

---

## M3 · Shell, onboarding y dashboard

**Objetivo:** la app existe para un usuario: alta de perfil con preview en vivo, panel HOY-first con la gráfica completa de proyección. Al cierre, la URL de staging es una app de proyección usable de punta a punta.

### Tareas

- [ ] M3-1 · `router.js` + shell: vistas registradas, tabs inferiores en móvil / sidebar en escritorio (D5), vista activa persistida, evento de cambio de vista. Estados de carga accesibles.
- [ ] M3-2 · Sistema visual: `tokens.css` definitivo (paleta oscura única D7, contraste AA verificado en los pares reales), componentes base (tarjeta, botón, modal con focus-trap, toast, empty-state). `color-scheme: dark`.
- [ ] M3-3 · Onboarding rediseñado (D6): pasos con validación inline desde `ranges.js` (avisos ≠ errores), **preview del plan actualizándose en vivo** en cada paso, bioimpedancia claramente opcional con explicación de `muscleSource`, fecha de inicio validada, selector de idioma. Cubre C-4, EST-*, H-093/094/099 por diseño.
- [ ] M3-4 · Dashboard HOY-first (D1/D2): cabecera con día real del plan, fase actual, estado «según plan» (sin check-ins aún, muestra proyectado y invita al primer check-in), tarjetas de composición con deltas correctos (sin `--`, `NaN` ni `↓ kg` — H-009/010/027 por diseño).
- [ ] M3-5 · Gráfica (D3): Chart.js vendorizado — línea de proyección + **banda de escenarios** (B5), **bandas de fase de fondo**, **línea vertical HOY**, hitos clicables con ficha modal, zoom/brush de rango, exportar PNG. Interruptor «fluctuación realista» (B8). Alternativa textual accesible del punto activo (F7).
- [ ] M3-6 · Ajustes: perfil (editar re-genera con aviso), idioma, multiperfil (cambiar/crear/borrar), export/import (M2-4 con UI), aviso de privacidad C6, zona de peligro separada.
- [ ] M3-7 · Estados vacíos y de error de todas las vistas de esta milestone (D9), incluido fallo de carga de Chart.js con recarga — nunca borrado de datos.
- [ ] M3-8 · E2E smoke (Playwright): onboarding completo con el perfil canónico de `docs/VERIFICACION-MANUAL.md` §3 → dashboard renderiza → cambiar de vista → recargar conserva estado.

### Criterios de cierre

- Smoke E2E en verde en CI.
- Recorrido de teclado completo del onboarding y el dashboard; `Escape` cierra modales devolviendo el foco.
- 320 px sin desborde horizontal (sin `overflow-x: hidden` como parche).
- Staging desplegado y usable; los diccionarios `es`/`en` pasan el test de paridad de claves.

### Bitácora M3

_(vacía)_

---

## M4 · Ciclo de seguimiento

**Objetivo:** el corazón del producto según A1: registrar la realidad, verla contra el plan, recalibrar. Al cierre, TransformLab es un producto de seguimiento completo.

### Tareas

- [ ] M4-1 · Check-in v2: peso obligatorio; %grasa, set de medidas configurable (E2) y las 4 métricas subjetivas (energía, sueño, adherencia, motivación — que **sustituyen** a las sintéticas, A2); notas. Editable/borrable. Port auditado de `legacy/js/checkin.js` con catálogo en mano (A7).
- [ ] M4-2 · Desviación: comparar cada check-in con el escenario esperado y la banda; señal clara de «dentro de banda / fuera de banda».
- [ ] M4-3 · Vista Progreso (D4): historial de check-ins, gráficas de cada medida, desviación acumulada, y las métricas subjetivas como serie real.
- [ ] M4-4 · Check-ins superpuestos en la gráfica principal (D3-b): puntos reales sobre la proyección.
- [ ] M4-5 · Recalibración (E1): cuando la desviación supera umbral definido, la app **ofrece** regenerar el plan desde el estado real; el plan anterior se archiva en un historial de planes consultable; nunca automático, nunca silencioso.
- [ ] M4-6 · Constancia (E9 a-b): racha de check-ins semanales y calendario de adherencia (heatmap) en la vista Progreso.
- [ ] M4-7 · Recordatorio in-app: al entrar con check-in pendiente de la semana, aviso no intrusivo (la notificación de sistema llega con la PWA en M6).
- [ ] M4-8 · E2E: registrar 3 check-ins (uno fuera de banda) → aparece oferta de recalibrar → recalibrar → el historial conserva el plan anterior → la gráfica muestra el nuevo plan con los puntos reales.

### Criterios de cierre

- E2E de M4-8 en verde en CI.
- Tests de unidad de desviación y de recalibración (el plan nuevo parte del último estado real y cierra en el objetivo; invariantes M1 siguen en verde sobre él).
- El dashboard HOY muestra estado real vs plan cuando existen check-ins.

### Bitácora M4

_(vacía)_

---

## M5 · Módulos satélite

**Objetivo:** portar y elevar los módulos v4.0 restantes, catálogo en mano, y completar las funcionalidades E. Al cierre, `legacy/` se elimina.

### Tareas

- [ ] M5-1 · Nutrición (E4): macros por fase derivadas del motor v2 (coherentes con B3), constantes con fuente (la proteína 2,2 g/kg del legacy no tenía cita — resolver con fuente o ajustar), variantes de refeed, **plantillas de comidas propias** (CRUD) ajustadas a las macros del día, copiar plan. Port auditado de `legacy/js/nutrition.js`.
- [ ] M5-2 · Entrenamiento (E5): rutina por fase/nivel como **plantilla editable** (CRUD de ejercicios/series), registro de sesión, detección de PRs, progresión sugerida desde el histórico. Port auditado de `legacy/js/training.js`.
- [ ] M5-3 · Silueta (E6): port auditado de `legacy/js/body-visualizer.js`; morfología alimentada también por medidas reales (E2) cuando existen; comparador inicio/actual/objetivo con transición (reduced-motion respetado).
- [ ] M5-4 · Fotos (E3): captura/carga a `photos-db.js`, galería por fecha, comparador antes/después de dos fechas, borrado. Aviso de privacidad específico (dispositivo compartido).
- [ ] M5-5 · Hitos: generados por el motor (cruce real de la serie), vista de hitos portada con auditoría de los 9 defectos internos de `legacy/js/milestones.js` (HIT-*), ficha clicable desde la gráfica (D3-d). Decidir en sesión el rescate editorial de las 102 descripciones de `legacy/aesthetic_milestones_complete.json` despersonalizándolas (F4-3 del plan legacy) — si aporta, portarlas como catálogo por umbral de composición.
- [ ] M5-6 · Logros y tarjeta (E9 c-d): sistema de logros local (hitos alcanzados, rachas, PRs) y tarjeta-resumen exportable como imagen sin datos sensibles.
- [ ] M5-7 · i18n al día en todos los módulos nuevos; estados vacíos/error de cada vista.
- [ ] M5-8 · **Eliminar `legacy/`** (el port está completo; git conserva la historia). Commit ceremonial: `chore: remove legacy — v5 port complete`.

### Criterios de cierre

- Las 8+ vistas funcionan con teclado, i18n en paridad, tests de la lógica no trivial (macros, progresión, logros) en verde.
- `grep -rn "legacy/" src/ index.html` devuelve 0 y `legacy/` no existe.
- Staging desplegado con el producto completo.

### Bitácora M5

_(vacía)_

---

## M6 · Producción

**Objetivo:** lanzamiento público real: PWA, seguridad, accesibilidad AA y dominio, con la checklist de release ejecutada y archivada.

### Tareas

- [ ] M6-1 · PWA (E7): `manifest.webmanifest` + iconos, `sw.js` a mano (precache del shell + vendor, estrategia de actualización con aviso «nueva versión disponible»), instalable en móvil y escritorio.
- [ ] M6-2 · Recordatorio local (E8): día/hora configurables con Notification API bajo permiso explícito; degradación limpia si se deniega (queda el aviso in-app de M4-7).
- [ ] M6-3 · Seguridad (F6): revisión final de escapado (test que greppea interpolaciones fuera de `html``), CSP estricta vía `_headers` de Cloudflare (`default-src 'self'`; sin `unsafe-inline` — las fuentes se sirven en local si hace falta), cabeceras `X-Content-Type-Options`, `Referrer-Policy`.
- [ ] M6-4 · Accesibilidad AA (F7): pasada completa con lista — foco visible en todo, focus-trap en todos los modales, contraste ≥ 4,5:1 medido en pares reales, `prefers-reduced-motion` cubriendo toda animación, canvas con alternativa, zoom 200 %, 320 px. Registrar resultados.
- [ ] M6-5 · Rendimiento: Lighthouse ≥ 90 en las cuatro categorías sobre staging; corregir lo que baje de ahí.
- [ ] M6-6 · Legales y meta: aviso de privacidad visible (C6), disclaimer «no es consejo médico», Open Graph completo, `robots.txt` real, título/descripciones i18n.
- [ ] M6-7 · Dominio propio en Cloudflare Pages + HTTPS; redirecciones limpias.
- [ ] M6-8 · **Checklist de release** (F8) ejecutada y pegada en la bitácora con fecha: CI verde · typecheck limpio · E2E verde · Lighthouse ≥90×4 · guion de humo manual pasado (adaptación del de `docs/VERIFICACION-MANUAL.md` a v5) · migración v4 probada con datos reales · backup/restore probado · dominio y PWA instalable verificados en un móvil real.

### Criterios de cierre

- La checklist M6-8 completa, con evidencias, en la bitácora.
- URL pública con dominio propio operativa. Esto es «producción».

### Bitácora M6

_(vacía)_

---

## BACKLOG (ideas fuera de alcance — se anotan, no se hacen)

- i18n a más idiomas · modo claro · sincronización entre dispositivos · exportación PDF del plan · integración con básculas/wearables · comparativas entre perfiles

## Bitácora general

_(decisiones transversales tomadas en sesión, con fecha y una línea de motivo)_

# TransformLab v5 — Plan de reconstrucción

> Estado: **M3 cerrada (2026-08-02) · M4 activa** · Estrategia: reconstrucción dirigida en el mismo repo, legacy congelado en `legacy/` · Convenciones e invariantes: `CLAUDE.md` · Staging: https://transformlab.pages.dev

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

- [x] M0-1 · Reconciliar el repo: `git checkout -- .DS_Store` → `git fetch --all --prune` → `git pull --ff-only` (el local no tiene commits propios; queda en `d0afa49`, v4.0). Retirar el worktree obsoleto: `git worktree remove .claude/worktrees/silly-yonath` si existe.
- [x] M0-2 · Higiene: `.gitignore` (`.DS_Store`, `.claude/`, `node_modules/`, `test-results/`, `*.log`), `git rm --cached .DS_Store`, `LICENSE` (elegir: MIT recomendada para producto público), `.editorconfig`.
- [x] M0-3 · Congelar el legacy: mover `index.html`, `js/`, `css/`, `styles_new.css`, `test-calculation.js`, `aesthetic_milestones_complete.json`, `robots.txt` a `legacy/`. `docs/` se queda en la raíz. Commit propio: `chore: freeze v4.0 as legacy reference`.
- [x] M0-4 · Esqueleto v5: árbol de `CLAUDE.md` §3 con ficheros mínimos funcionales — `index.html` (shell vacío + `<script type="module" src="src/main.js">`), `css/tokens.css` (paleta oscura inicial, tipografía, espaciados), `css/app.css`, `src/main.js`, `src/ui/dom.js` (`escapeHtml`, `html``, `on()` delegación), `src/i18n/` (t(), es, en con ~10 claves de arranque), `src/data/storage.js` (get/set/remove con try/catch, namespace, aviso de cuota).
- [x] M0-5 · Vendorizar Chart.js: descargar la versión UMD actual fijada a `vendor/chart.umd.min.js`, anotar versión y hash en la bitácora.
- [x] M0-6 · Tooling: `package.json` (scripts serve/test/typecheck/e2e; devDeps `typescript`, `@playwright/test`), `tsconfig.json` (`allowJs`, `checkJs`, `noEmit`, include `src/core`, `src/data`), primer test trivial de `storage.js` con `node:test`.
- [x] M0-7 · CI: `.github/workflows/ci.yml` — checkout, node 22, `npm ci`, `npm run typecheck`, `npm test` en cada push/PR.
- [x] M0-8 · Deploy: conectar el repo a Cloudflare Pages (build command vacío, output `/`). Verificar que la URL de staging sirve el shell v5.

### Criterios de cierre

- `git status -sb` limpio, sin `behind/ahead`; `git check-ignore .DS_Store` devuelve 0.
- `npm test` y `npm run typecheck` en verde, en local y en Actions.
- La URL de Cloudflare Pages sirve el shell v5 (aunque esté casi vacío).
- `legacy/` contiene la v4.0 completa y nada de `src/` la importa.

### Bitácora M0

**2026-08-02 · Sesión 1 (M0-1 → M0-7 cerradas; M0-8 a falta del panel).**

- Pre-M0: la carpeta se renombró `procesoFisico` → `transformLab`; el worktree `.claude/worktrees/silly-yonath` quedó roto (registrado en la ruta vieja). Se reparó con `git worktree repair` y se retiró (`--force`: rama ya fusionada y pusheada). Rama local `claude/silly-yonath` eliminada tras el pull. Corregidas 5 referencias a la ruta vieja en `README.md` y `docs/HISTORIAL-Y-RAMAS.md`.
- M0-1: `pull --ff-only` limpio a `d0afa49` (v4.0, 13 módulos). Kit v5 + docs de auditoría commiteados (`6103e7d`, 22 ficheros, 7.954 líneas).
- M0-5: Chart.js **4.5.1** UMD → `vendor/chart.umd.min.js` · sha256 `48444a82d4edcb5bec0f1965faacdde18d9c17db3063d042abada2f705c9f54a`.
- M0-6: script `test` ajustado a `node --test` sin argumento (Node ≥23 ya no acepta un directorio como entrada; el descubrimiento automático cubre `test/`). 20 tests en verde (storage: roundtrip, namespace por perfil, JSON corrupto, cuota llena simulada, sin backend; i18n: paridad es/en, interpolación segura, fallback). `storage.js` usa perfil activo `p1` por defecto hasta que `profiles.js` (M2) gestione la selección real.
- M0-7: CI en verde en el primer run (`30749952807`, 12 s) tras push `d0afa49..ebce1b6`.
- Shell verificado en navegador: módulos ES cargan sin errores de consola, i18n renderiza, contador de arranques persiste entre recargas.
- Criterios de cierre ejecutados: `git status -sb` → `## main...origin/main` (limpio) · `git check-ignore .DS_Store` → exit 0 · tests 20/20 + typecheck limpio (local y Actions) · `legacy/` completo y `grep -rn "legacy/" src/ index.html` → 0.
- **Queda a medias:** M0-8 — pasos manuales del panel de Cloudflare Pages (abajo). **Siguiente paso:** verificar la URL de staging cuando el panel esté conectado y cerrar M0; después, prompt `prompts/M1-motor.md`.

**2026-08-02 · Cierre de M0.** El usuario conectó el panel; **staging operativo en `https://transformlab.pages.dev`**: sirve el shell v5, módulos ES cargan sin errores de consola y el almacenamiento funciona en el dominio real (verificado en navegador). Los 4 criterios de cierre restantes ya se habían ejecutado en la sesión 1 (status limpio, `.DS_Store` ignorado, 20/20 tests + typecheck en local y Actions, `legacy/` completo sin imports). **M0 CERRADA.** Siguiente: M1 · Motor científico v2 (`prompts/M1-motor.md`).

---

## M1 · Motor científico v2

**Objetivo:** `src/core/` completo, puro (sin DOM), importable desde Node, con los invariantes de `CLAUDE.md` §4 en verde. Especificación de partida: `docs/METODOLOGIA-CIENTIFICA.md` (§3–§5 para lo que existe, §8 como lista de obligaciones) + decisiones B1–B9.

### Tareas

- [x] M1-1 · `constants.js`: portar de `legacy/js/calculations.js` los valores verificados (multiplicadores de actividad, tasas de pérdida de grasa 0,5/0,75/1 % PC/sem, grasa esencial/mínima/máxima) con su fuente en JSDoc. Convertir tasas musculares a **relativas al peso** con fuente y factor por sexo documentado (B6). Añadir equivalencia energética (~7 700 kcal/kg) y factor de adaptación metabólica (B3, B4) con referencias.
- [x] M1-2 · `rng.js`: PRNG determinista (mulberry32) sembrado desde `profileId + startDate`. Test: misma semilla → misma secuencia.
- [x] M1-3 · `ranges.js`: fuente única de rangos (edad, peso, altura, %grasa por sexo, músculo relativo a masa magra 35–65 %). API que distingue `error` (imposible) de `warning` (improbable: se avisa, no se corrige). Cubre MOT-06, MOT-11, MOT-12, GEN-13.
- [x] M1-4 · `engine.js` — composición: modelo con `muscleSource`. Ruta `estimated`: proporcional, sin clamp absoluto. Ruta `measured`: tejido magro no muscular conservado, validado en relativo con aviso. Test `identidad` con los 4 perfiles de `docs/AUDITORIA.md` §1.2 (80/20♂, 60/28♀, 95/30♂, 70/12♂) → peso actual ±1 kg. Cubre C-1..C-5.
- [x] M1-5 · `engine.js` — energía: BMR (Mifflin-St Jeor, redondeado en origen), TDEE **semanal** sobre peso proyectado + adaptación (B4), objetivo calórico con suelo max(BMR, 1200♀/1500♂) y ajuste de duración cuando el suelo recorta (B2). La recomposición recibe su déficit ligero real (B7; mata la rama muerta MOT-04).
- [x] M1-6 · `engine.js` — fases: planificador donde las expectativas por fase **suman exactamente** el objetivo (fuera restas mágicas de 2 kg/0,5 kg — MOT-08), duración de definición integrando la tasa sobre peso decreciente (MOT-16), duración de recomposición derivada (MOT-18), ramas explícitas para «ya estás en el objetivo» y «perder músculo» (MOT-10), guarda ante entradas no finitas (C-5/H-005).
- [x] M1-7 · `generator.js`: serie diaria por interpolación + fluctuación determinista opcional (B8) que conserva masa; el último día aterriza en el objetivo; agregados semanales/mensuales coherentes (semana parcial marcada, meses de calendario, fase correcta en fronteras — GEN-07/11/12/15). Fechas en **UTC puro** de punta a punta (GEN-02/10). El generador NO muta el perfil (GEN-06): trabaja sobre copia y devuelve avisos.
- [x] M1-8 · `generator.js` — escenarios: tres trayectorias (pesimista/esperado/optimista) desde los rangos de las tasas (B5), las tres cierran el plan. Hitos derivados del **cruce real de la serie** (GEN-03/04), con categorías declaradas en un solo sitio.
- [x] M1-9 · Suite completa de invariantes: `identidad`, `conservacion`, `limites`, `determinismo`, `cierre_de_plan`, `coherencia_energetica`, `escenarios` + tests de `ranges` y casos degenerados. `// @ts-check` + JSDoc en todo `src/core/`.

### Criterios de cierre

- `npm test` en verde con los 7 invariantes nombrados presentes y no triviales.
- `npm run typecheck` limpio sobre `src/core/`.
- Ejecutar el test de identidad imprime los 4 perfiles del legacy con desvío ≤ 1 kg (frente a los −17/−35 kg del legacy).
- Cero referencias a DOM/`window` dentro de `src/core/`.

### Bitácora M1

**2026-08-02 · Sesión 1 — M1 completa (M1-1 → M1-9) en 6 commits.**

- API pública y typedefs propuestos y confirmados por el usuario antes de programar (checkpoint del prompt M1). Decisiones de diseño: Issues como códigos i18n-ready (core sin literales), banda de escenarios dentro de cada `DailyPoint`, unidades en el nombre de campo.
- Método test-first cumplido: `identidad` se escribió en rojo (44.º test fallando por módulo ausente) antes de `engine.js`.
- Dos correcciones de diseño surgidas de los propios tests: (1) **premisa física unificada** — ambas rutas de `muscleSource` conservan el tejido magro no muscular; la identidad es exacta y plan↔serie cuadran al miligramo; (2) **banda de escenarios como retraso/adelanto sobre la trayectoria esperada** (la banda por-fase rompía el orden global); (3) **adaptación metabólica proporcional a la severidad del déficit** (el modelo plano −10 % declaraba inviable a la mujer pequeña sedentaria) — compartida por planificador y generador vía `adaptationStep`.
- **Verificación adversarial** (workflow de 8 agentes): 71.412 casos de ataque en 4 estrategias (fuzz de dominio, fronteras, tipos hostiles, propiedades cruzadas); 30 roturas confirmadas y TODAS cerradas en `b895966`. La crítica: el planificador de ramas únicas fallaba con `closureFailed` en el caso central (perder >10 kg de grasa manteniendo músculo) — sustituido por bucle de convergencia sobre lo restante. Añadidos: validación de `intensity`, validación profunda de perfil/plan en el generador (anti NaN-con-ok:true, anti RangeError, anti bucle de heap), `Object.hasOwn` en todos los lookups de enums (anti claves de prototipo), objetivo de grasa >60 % como error, tope de peso objetivo [30,300] y de duración (1095 días), verificación de trayectoria por fases, guardas null/undefined en 10 funciones, suelo calórico jamás omitido en silencio, `muscleSource` validado.
- Criterios de cierre ejecutados: 99/99 tests (7 invariantes con nombre no triviales sobre matriz de 8 casos + regresión adversarial + mini-fuzz sembrado de 200) · typecheck limpio · test de identidad: los 4 perfiles con desvío **0,00 kg** (legacy: −29,1 / −17,4 / −35,1 / −25,0) · cero referencias DOM/window/localStorage en `src/core/` (test automático). **M1 CERRADA.**
- Siguiente paso: `prompts/M2-datos.md` — capa de datos (schema v5, multiperfil, migrador v4→v5, backup, photos-db).

---

## M2 · Capa de datos

**Objetivo:** persistencia multiperfil versionada, con migración desde v4, copia de seguridad y almacén de fotos. Especificación de partida: `docs/MODELO-DE-DATOS.md` (esquema legacy) + decisiones C1–C6 + A2/E2 (el esquema v5 añade check-ins con métricas reales y set de medidas).

### Tareas

- [x] M2-1 · `schema.js`: definir el esquema v5 con JSDoc typedefs — perfil (con `muscleSource`), plan generado (con escenarios), check-ins (peso, %grasa, medidas configurables, energía/sueño/adherencia/motivación 1–10, notas), rutina/registro de entrenamiento, plantillas de comida, hitos, logros, metadatos de fotos, ajustes. `schemaVersion: 5` en todo objeto raíz. Validadores de forma.
- [x] M2-2 · `profiles.js`: índice `tl.5.profiles`, perfil activo, crear/renombrar/borrar (borrar exige confirmación tipeada), namespace `tl.5.<pid>.*` aplicado por `storage.js`.
- [x] M2-3 · `migrate.js`: detectar claves v4 (`transformlab_*`), volcar un export automático de seguridad, transformar a esquema v5 como primer perfil (marcando `muscleSource: 'estimated'` — el dato v4 venía del ratio 0,48), archivar las claves viejas con prefijo `tl.legacy.`. Test con fixture real copiado de un perfil v4.
- [x] M2-4 · `backup.js`: export JSON de un perfil o de todos; import con validación de esquema, saneado de todos los campos de texto y resumen previo («este fichero contiene: perfil X, 12 check-ins…») antes de confirmar. Test de ida y vuelta byte-equivalente en datos estructurados.
- [x] M2-5 · `photos-db.js`: IndexedDB `tl-photos`, store por perfil, API `add/get/list/remove` con blobs; presupuesto y recuento expuestos. Sin UI todavía.
- [x] M2-6 · Presupuesto de cuota en `storage.js`: medir bytes usados por perfil, umbral de aviso (~60 % de 5 MB) que la UI consumirá en M3.

### Criterios de cierre

- `npm test` en verde incluyendo: migración de fixture v4 → v5 válida, ida y vuelta de backup, validadores rechazando 3 fixtures corruptos sin lanzar excepción no controlada.
- Simulación de cuota llena (mock de `setItem` que lanza) degrada con error tipado, no con crash.
- `npm run typecheck` limpio sobre `src/data/`.

### Bitácora M2

**2026-08-02 · Sesión 1 — M2 completa (M2-1 → M2-6) en 8 commits.**

- Esquema v5 propuesto y confirmado antes de programar. Tres decisiones dentro de la propuesta: (1) **la proyección NO se persiste** — el generador es determinista (B8) y se regenera al arrancar, lo que ahorra ~300 KB de cuota y mata de raíz la clase de bug de caché del legacy; (2) las métricas subjetivas viven solo en check-ins como datos reales (A2); (3) unidades en el nombre de campo (`weightKg`, `deficitKcal`), heredadas de los typedefs del core.
- Decisión de diseño clave en `schema.js`: los validadores devuelven una **copia solo con claves conocidas**. Eso neutraliza de raíz la contaminación de prototipo y el contrabando de campos por el import, sin necesidad de listas negras.
- Formas v4 extraídas del legacy para el fixture: `legacy/js/onboarding.js:845-866` (userProfile), `legacy/js/checkin.js:266-282` (check-ins), `legacy/js/app.js:479-490` (prefs), `legacy/js/router.js:65` (activeView).
- Doble de IndexedDB escrito a mano (`test/helpers/indexed-db-mock.js`) en lugar de añadir `fake-indexeddb`: CLAUDE.md §5 restringe dependencias y la superficie usada es pequeña. El doble de localStorage gana `maxChars`, que replica el comportamiento real del navegador (solo fallan las escrituras que hacen crecer el almacén).
- **Fallo encontrado a mano** antes del ataque: probando el migrador en 11 puntos de fallo, un corte por cuota dejaba un perfil huérfano y **el reintento moría con `nameTaken` para siempre** — datos v4 intactos pero inalcanzables. Cerrado con desambiguación de nombre + rollback + copiar todo el archivado antes de borrar nada.
- **Verificación adversarial**: 61.661 casos en 4 estrategias, 35 hallazgos reportados. Los 4 verificadores del workflow murieron con error 401, así que verifiqué a mano las 13 críticas/altas ejecutando sus reproducciones: **12 confirmadas y cerradas** en `c690f1d`. Las dos críticas: fuga de datos personales entre perfiles al borrar el último (el siguiente perfil heredaba el registro del anterior), y el migrador escribiendo datos que el propio esquema rechaza, reportando éxito y archivando los originales. Entre las altas: la adherencia v4 es un porcentaje y la heurística convertía la peor semana del usuario en la mejor; una clave `transformlab_backup` podía pisar la copia de seguridad; `storage.set(undefined)` dejaba claves ilegibles con acuse positivo; `apply()` fabricaba un perfil corporal de 70 kg que nadie introdujo.
- Criterios de cierre ejecutados: 188/188 tests · migración de fixture v4 válida, ida y vuelta de backup, validadores rechazando fixtures corruptos sin excepción · cuota llena degrada con error tipado en `set`, `create` y `setGlobal`, sin crash · typecheck limpio. **M2 CERRADA.**
- Los 22 hallazgos de gravedad media/baja del ataque quedan anotados en BACKLOG para revisarlos al abrir M3 (varios son de la superficie de UI que aún no existe).
- Siguiente paso: `prompts/M3-shell-dashboard.md` — shell, onboarding con preview en vivo y dashboard HOY-first.

---

## M3 · Shell, onboarding y dashboard

**Objetivo:** la app existe para un usuario: alta de perfil con preview en vivo, panel HOY-first con la gráfica completa de proyección. Al cierre, la URL de staging es una app de proyección usable de punta a punta.

### Tareas

- [x] M3-1 · `router.js` + shell: vistas registradas, tabs inferiores en móvil / sidebar en escritorio (D5), vista activa persistida, evento de cambio de vista. Estados de carga accesibles.
- [x] M3-2 · Sistema visual: `tokens.css` definitivo (paleta oscura única D7, contraste AA verificado en los pares reales), componentes base (tarjeta, botón, modal con focus-trap, toast, empty-state). `color-scheme: dark`.
- [x] M3-3 · Onboarding rediseñado (D6): pasos con validación inline desde `ranges.js` (avisos ≠ errores), **preview del plan actualizándose en vivo** en cada paso, bioimpedancia claramente opcional con explicación de `muscleSource`, fecha de inicio validada, selector de idioma. Cubre C-4, EST-*, H-093/094/099 por diseño.
- [x] M3-4 · Dashboard HOY-first (D1/D2): cabecera con día real del plan, fase actual, estado «según plan» (sin check-ins aún, muestra proyectado y invita al primer check-in), tarjetas de composición con deltas correctos (sin `--`, `NaN` ni `↓ kg` — H-009/010/027 por diseño).
- [x] M3-5 · Gráfica (D3): Chart.js vendorizado — línea de proyección + **banda de escenarios** (B5), **bandas de fase de fondo**, **línea vertical HOY**, hitos clicables con ficha modal, zoom/brush de rango, exportar PNG. Interruptor «fluctuación realista» (B8). Alternativa textual accesible del punto activo (F7).
- [x] M3-6 · Ajustes: perfil (editar re-genera con aviso), idioma, multiperfil (cambiar/crear/borrar), export/import (M2-4 con UI), aviso de privacidad C6, zona de peligro separada.
- [x] M3-7 · Estados vacíos y de error de todas las vistas de esta milestone (D9), incluido fallo de carga de Chart.js con recarga — nunca borrado de datos.
- [x] M3-8 · E2E smoke (Playwright): onboarding completo con el perfil canónico de `docs/VERIFICACION-MANUAL.md` §3 → dashboard renderiza → cambiar de vista → recargar conserva estado.

### Criterios de cierre

- Smoke E2E en verde en CI.
- Recorrido de teclado completo del onboarding y el dashboard; `Escape` cierra modales devolviendo el foco.
- 320 px sin desborde horizontal (sin `overflow-x: hidden` como parche).
- Staging desplegado y usable; los diccionarios `es`/`en` pasan el test de paridad de claves.

### Bitácora M3

**2026-08-02 · Sesión 1 — M3 completa (M3-1 → M3-8) en 3 commits.**

- Checkpoint cumplido antes de programar: paleta propuesta con ratios **medidos** y boceto del dashboard, ambos confirmados. Medir encontró dos fallos en la propia propuesta: el hover del botón primario invertía el contraste, y un único token de borde no podía servir a la vez a tarjetas (decorativo) y a campos de formulario (3:1 por WCAG 1.4.11) — ahora son dos tokens. `test/tokens-contrast.test.js` lee el `tokens.css` real y verifica los 8 grupos de pares: la degradación de H-047 (3,78:1) ya no puede repetirse sin romper la CI.
- El hook de diseño señaló cinco puntos y los cinco se corrigieron: cuatro franjas de color laterales (tic reconocible de UI generada) sustituidas por etiqueta e icono, y la barra de progreso pasa a animar `transform` en vez de `width`, que forzaba layout en cada frame.
- Onboarding: el formulario NUNCA se reconstruye al teclear — solo se refrescan preview y mensajes, así el foco y el cursor se conservan (hay E2E que lo comprueba). C-4 del legacy es imposible por construcción: no hay mínimo absoluto en kg para el músculo objetivo.
- Dashboard HOY-first con el día REAL (no el punto medio de H-035) y las cifras etiquetadas explícitamente como PROYECCIÓN. `plan-state.js` regenera la proyección al arrancar en vez de leerla del almacén: al ser el generador determinista, no puede haber datos cacheados que sobrevivan a un cambio del motor.
- Gráfica con banda de escenarios, bandas de fase, línea HOY, hitos clicables y export PNG. El canvas es opaco para un lector de pantalla, así que la serie se recorre con el teclado y cada punto se anuncia por `aria-live`. Si Chart.js falla: mensaje y recarga, jamás borrado (H-013).
- **El E2E encontró dos fallos estructurales que los tests unitarios no podían ver:** los listeners delegados se acumulaban porque el router reutilizaba el mismo contenedor entre vistas (una vista visitada dos veces respondía dos veces a cada clic) — ahora cada vista recibe un elemento propio que muere con ella; y cambiar de idioma re-enrutaba la aplicación entera, lo que remontaba el asistente y descartaba el propio cambio.
- Criterios de cierre ejecutados: **13/13 E2E** (teclado, focus-trap, Escape con devolución de foco, 320 px sin desborde, idioma persistido, cero errores de consola) · **196/196 unitarios** con paridad es/en · typecheck limpio · sin `overflow-x: hidden` de parche · cero `onclick`, cero `innerHTML` fuera de `dom.js`, cero `localStorage` fuera de `storage.js`, cero hex fuera de `tokens.css`. El E2E entra en CI. **M3 CERRADA.**
- Verificado en navegador con el perfil canónico: objetivo **68,9 kg** donde el legacy daba **45,5 kg**.
- Siguiente paso: `prompts/M4-seguimiento.md` — check-ins, desviación y recalibración. Su checkpoint pide proponer los umbrales de recalibración y el typedef final del check-in antes de programar.

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
- **Hallazgos media/baja del ataque a M2 (2026-08-02), pendientes de revisar en M3:** `sanitizeText` parte pares sustitutos al recortar y no elimina los controles C1 de Unicode; un perfil cuyo nombre son solo caracteres invisibles no se puede borrar; `readIndex` normaliza sin marcarlo; los validadores no se protegen de getters que lanzan; `photos-db` no valida que el id no contenga `:` ni que `blob.size` sea finito y positivo; los campos de kilos del plan no tienen cota superior; `migrate` no valida `nowISO`; `transformlab_startDate` nunca se lee.

## Bitácora general

_(decisiones transversales tomadas en sesión, con fecha y una línea de motivo)_

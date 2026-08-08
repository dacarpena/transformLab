# TransformLab v5 — Plan de reconstrucción

> Estado: **M4 cerrada (2026-08-02) · producto núcleo COMPLETO · M5 activa** · Estrategia: reconstrucción dirigida en el mismo repo, legacy congelado en `legacy/` · Convenciones e invariantes: `CLAUDE.md` · Staging: https://transformlab.pages.dev

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

- [x] M4-1 · Check-in v2: peso obligatorio; %grasa, set de medidas configurable (E2) y las 4 métricas subjetivas (energía, sueño, adherencia, motivación — que **sustituyen** a las sintéticas, A2); notas. Editable/borrable. Port auditado de `legacy/js/checkin.js` con catálogo en mano (A7).
- [x] M4-2 · Desviación: comparar cada check-in con el escenario esperado y la banda; señal clara de «dentro de banda / fuera de banda».
- [x] M4-3 · Vista Progreso (D4): historial de check-ins, gráficas de cada medida, desviación acumulada, y las métricas subjetivas como serie real.
- [x] M4-4 · Check-ins superpuestos en la gráfica principal (D3-b): puntos reales sobre la proyección.
- [x] M4-5 · Recalibración (E1): cuando la desviación supera umbral definido, la app **ofrece** regenerar el plan desde el estado real; el plan anterior se archiva en un historial de planes consultable; nunca automático, nunca silencioso.
- [x] M4-6 · Constancia (E9 a-b): racha de check-ins semanales y calendario de adherencia (heatmap) en la vista Progreso.
- [x] M4-7 · Recordatorio in-app: al entrar con check-in pendiente de la semana, aviso no intrusivo (la notificación de sistema llega con la PWA en M6).
- [x] M4-8 · E2E: registrar 3 check-ins (uno fuera de banda) → aparece oferta de recalibrar → recalibrar → el historial conserva el plan anterior → la gráfica muestra el nuevo plan con los puntos reales.

### Criterios de cierre

- E2E de M4-8 en verde en CI.
- Tests de unidad de desviación y de recalibración (el plan nuevo parte del último estado real y cierra en el objetivo; invariantes M1 siguen en verde sobre él).
- El dashboard HOY muestra estado real vs plan cuando existen check-ins.

### Bitácora M4

**2026-08-02 · Sesión 1 — M4 completa (M4-1 → M4-8) en 4 commits. Producto núcleo completo.**

- **El checkpoint cambió el diseño antes de escribir una línea.** Medir la banda de escenarios sobre un plan real demostró que NO puede ser el criterio de desviación por los dos extremos: en la semana 1 mide ±0,17 kg (más estrecha que la variación real de agua y glucógeno, ±0,5–1,5 kg) y al final vale exactamente cero, porque el invariante `escenarios` de M1 exige que los tres cierren en el objetivo. Usarla literalmente habría gritado «fuera de plan» todo el primer mes por ruido puro, y siempre en el tramo final. La banda es lo que se DIBUJA; lo que se JUZGA es la banda ensanchada con un suelo de ruido del 1,3 % del peso (Bhutani 2017).
- Umbrales (E1a): mínimo 3 check-ins; A) persistencia, B) magnitud; ambos exigiendo el mismo lado. La adherencia baja se señala como contexto, **nunca bloquea**: un plan no está mal por no haberse ejecutado.
- **Probar la recalibración en el navegador destapó un error propio:** al regenerar el plan se tomaba el `%grasa` PROYECTADO, lo que suponía que un usuario estancado había perdido grasa que no había perdido — y desplazaba su peso objetivo 1,2 kg sin que él hubiera cambiado su meta. Corregido con `inferFatPct`, ahora en `core/` y con test: el músculo cambia despacio y lo dirige el entrenamiento, así que se conserva el proyectado; la desviación de peso se atribuye a la GRASA. Deriva del objetivo: 1,2 kg → 0,3 kg (residuo legítimo, el músculo sí creció).
- **Verificación adversarial: 871.063 casos, 24 roturas confirmadas.** El hallazgo que obligó a rediseñar los umbrales: mi test usaba ruido ALTERNANTE, el caso fácil. El ruido real de una báscula es CORRELACIONADO (la retención de agua persiste días) y producía rachas del mismo lado. Medido: **37 % de falsos positivos** con AR(1) φ=0,75 y **58 % con pesaje diario**. Tres correcciones: (1) la racha debe abarcar 14 días REALES, no N check-ins; (2) **la brecha debe CRECER** — es el discriminador central, porque el agua desplaza el peso un escalón y ahí se queda (residuos planos) mientras un estancamiento real ensancha la brecha cada semana; (3) techo en la tolerancia, que sin él llegaba a 18 kg en planes largos y volvía invisible medio año de deriva justo a quien más peso tenía que perder.
- Falsos positivos medidos, antes → después: pesaje diario 58 % → **0,00 %** · AR(1) 37,2 % → **1,53 %** · iid σ=0,8 7,1 % → **0,00 %** · pico de hidratación 6,5 % → **0,00 %**. Detección de deriva real: estancamiento en **7 semanas** de media.
- Otras roturas cerradas: la memoria del rechazo pasa a ser una huella del CONTENIDO (con el id bastaba editar el check-in de hoy para heredar el silencio, o borrarlo para reabrir la oferta con menos información); fechas imposibles rechazadas en el core; la racha se acota al presente; el migrador deriva los ids de la fecha; la vista enseña el campo y el límite exactos; perfil antes que plan al recalibrar.
- **Limitación conocida y aceptada:** una deriva sostenida justo por debajo del umbral (0,99 × tolerancia) es invisible por construcción — una regla de umbral no puede detectar lo que nunca lo cruza. Anotado en BACKLOG: una prueba de tendencia acumulada lo cubriría, a costa de más falsos positivos. Igualmente, en planes de recomposición o de cambio neto pequeño la detección es más lenta, porque hay menos progreso esperado contra el que contrastar.
- Criterios de cierre ejecutados: **22/22 E2E** (incluido el guion del producto entero: onboarding → 3 check-ins → oferta → recalibrar → el historial conserva el plan anterior → la gráfica muestra el nuevo con los puntos reales) · **236/236 unitarios**, con los 7 invariantes de M1 en verde sobre los planes recalibrados · typecheck limpio · cero onclick, innerHTML fuera de dom.js, localStorage fuera de storage.js, Math.random o hex fuera de tokens. **M4 CERRADA: el producto núcleo está completo.**
- Siguiente paso: `prompts/M5-satelites.md` — nutrición, entrenamiento, silueta, fotos, hitos y logros; se cierra eliminando `legacy/`.

---

## M5 · Módulos satélite

**Objetivo:** portar y elevar los módulos v4.0 restantes, catálogo en mano, y completar las funcionalidades E. Al cierre, `legacy/` se elimina.

### Tareas

- [x] M5-1 · Nutrición (E4): macros por fase derivadas del motor v2 (coherentes con B3), constantes con fuente (la proteína 2,2 g/kg del legacy no tenía cita — resolver con fuente o ajustar), variantes de refeed, **plantillas de comidas propias** (CRUD) ajustadas a las macros del día, copiar plan. Port auditado de `legacy/js/nutrition.js`.
- [x] M5-2 · Entrenamiento (E5): rutina por fase/nivel como **plantilla editable** (CRUD de ejercicios/series), registro de sesión, detección de PRs, progresión sugerida desde el histórico. Port auditado de `legacy/js/training.js`.
- [x] M5-3 · Silueta (E6): port auditado de `legacy/js/body-visualizer.js`; morfología alimentada también por medidas reales (E2) cuando existen; comparador inicio/actual/objetivo con transición (reduced-motion respetado).
- [x] M5-4 · Fotos (E3): captura/carga a `photos-db.js`, galería por fecha, comparador antes/después de dos fechas, borrado. Aviso de privacidad específico (dispositivo compartido).
- [x] M5-5 · Hitos: generados por el motor (cruce real de la serie), vista de hitos portada con auditoría de los 9 defectos internos de `legacy/js/milestones.js` (HIT-*), ficha clicable desde la gráfica (D3-d). Decidir en sesión el rescate editorial de las 102 descripciones de `legacy/aesthetic_milestones_complete.json` despersonalizándolas (F4-3 del plan legacy) — si aporta, portarlas como catálogo por umbral de composición.
- [x] M5-6 · Logros y tarjeta (E9 c-d): sistema de logros local (hitos alcanzados, rachas, PRs) y tarjeta-resumen exportable como imagen sin datos sensibles.
- [x] M5-7 · i18n al día en todos los módulos nuevos; estados vacíos/error de cada vista.
- [x] M5-8 · **Eliminar `legacy/`** (el port está completo; git conserva la historia). Commit ceremonial: `chore: remove legacy — v5 port complete`.

### Criterios de cierre

- Las 8+ vistas funcionan con teclado, i18n en paridad, tests de la lógica no trivial (macros, progresión, logros) en verde.
- `grep -rn "legacy/" src/ index.html` devuelve 0 y `legacy/` no existe.
- Staging desplegado con el producto completo.

### Bitácora M5

**2026-08-03 · M5 cerrada.** Portadas las cinco vistas satélite que faltaban
(entrenamiento, silueta, hitos, fotos, logros) sobre los cores ya cerrados, y
eliminado `legacy/` tras verificar `rg -n "legacy/" src/ index.html` → 0. Las
citas a rutas del legacy que quedaban en comentarios se reescribieron para
citar la v4.0 sin la ruta: una referencia a un directorio que ya no existe es
una pista muerta.

Decisión tomada en sesión: el rescate editorial del catálogo de hitos SÍ
aporta (97 fichas anatómicas frente a ~15 plantillas del generador) y se portó
despersonalizado e indexado por umbral de composición.

Diez vistas no caben en una barra inferior a 320 px con objetivos táctiles
decentes (saldrían de 32 px), así que el router pliega las no primarias tras
un botón «más» con hoja desplegable, `aria-expanded`, cierre con Escape y
devolución de foco. En la barra lateral de escritorio siguen todas visibles.

**Verificación adversarial (5 atacantes + 1 refutador independiente por
hallazgo, 32 agentes, ~2,7 M tokens).** 27 hallazgos, 12 refutados por
reproducción fallida o por ser comportamiento deliberado, **15 confirmados**
—deduplicados, 11 defectos reales, todos introducidos en M5 y todos
corregidos en `82f8340`:

1. *(alta)* La vista de nutrición afirmaba del refeed «no rompe el plan: la
   proyección ya lo absorbe». El motor no modela refeeds: la serie aplica el
   déficit los siete días. Un refeed semanal costaba 2,29 kg en el plan
   canónico (14,8 % del objetivo) y terminaba disparando una oferta de
   recalibración por una desviación que la propia app había causado. Es
   exactamente la clase de defecto que la v5 existe para erradicar —una
   afirmación cuantitativa sin respaldo en el motor, mostrada como certeza—
   y se coló igual. Ahora `refeedMacros` devuelve el coste y la vista lo dice.
2. *(alta)* El catálogo estaba a medio despersonalizar: `muscleGainKgAbove`
   guardaba la masa ABSOLUTA del usuario de la v4.0 (56,8–64,8 kg) y se
   comparaba contra la ganancia → 58 de 97 hitos inalcanzables, categorías
   enteras invisibles. Recuperado el fichero original de git (su masa inicial
   era 56,55 kg), los umbrales son ganancias de 0,25 a 8,25 kg.
3. *(alta)* Los hitos ya cumplidos el día 0 se marcaban `reached` y
   desbloqueaban logros sin que el usuario hubiera hecho nada, contra la
   decisión E9c. Ahora son `fromStart` y no cuentan: un perfil nuevo pasa de
   2/9 logros a 0/9.
4. *(alta)* La tarjeta compartible imprimía el peso y el %grasa PROYECTADOS
   con el mismo formato que una medición.
5. *(alta)* Las medidas reales multiplicaban la estimación y solo se aplicaban
   a la figura de «hoy»: las tres siluetas del comparador no eran comparables.
6. *(alta)* El generador de ids de ejercicio colisionaba con cuatro clics
   normales, y a partir de ahí se guardaban los datos del ejercicio erróneo.
7. *(alta)* `newRecordsIn` no deduplicaba por ejercicio.
8-11. *(media)* Consentimiento heredado entre perfiles · empates de 1RM rotos
   por coma flotante · inyección en selector CSS vía import de backup que
   perdía la sesión sin avisar · textos del catálogo solo en español.

Los tests que cierran cada uno llevan escrito el fallo que evitan.

---

## M6 · Producción

**Objetivo:** lanzamiento público real: PWA, seguridad, accesibilidad AA y dominio, con la checklist de release ejecutada y archivada.

### Tareas

- [x] M6-1 · PWA (E7): `manifest.webmanifest` + iconos, `sw.js` a mano (precache del shell + vendor, estrategia de actualización con aviso «nueva versión disponible»), instalable en móvil y escritorio.
- [x] M6-2 · Recordatorio local (E8): día/hora configurables con Notification API bajo permiso explícito; degradación limpia si se deniega (queda el aviso in-app de M4-7).
- [x] M6-3 · Seguridad (F6): revisión final de escapado (test que greppea interpolaciones fuera de `html``), CSP estricta vía `_headers` de Cloudflare (`default-src 'self'`; sin `unsafe-inline` — las fuentes se sirven en local si hace falta), cabeceras `X-Content-Type-Options`, `Referrer-Policy`.
- [x] M6-4 · Accesibilidad AA (F7): pasada completa con lista — foco visible en todo, focus-trap en todos los modales, contraste ≥ 4,5:1 medido en pares reales, `prefers-reduced-motion` cubriendo toda animación, canvas con alternativa, zoom 200 %, 320 px. Registrar resultados.
- [x] M6-5 · Rendimiento: Lighthouse ≥ 90 en las cuatro categorías sobre staging; corregir lo que baje de ahí.
- [x] M6-6 · Legales y meta: aviso de privacidad visible (C6), disclaimer «no es consejo médico», Open Graph completo, `robots.txt` real, título/descripciones i18n.
- [x] M6-7 · Dominio propio en Cloudflare Pages + HTTPS; redirecciones limpias.
- [x] M6-8 · **Checklist de release** (F8) ejecutada y pegada en la bitácora con fecha: CI verde · typecheck limpio · E2E verde · Lighthouse ≥90×4 · guion de humo manual pasado (adaptación del de `docs/VERIFICACION-MANUAL.md` a v5) · migración v4 probada con datos reales · backup/restore probado · dominio y PWA instalable verificados en un móvil real.

### Criterios de cierre

- La checklist M6-8 completa, con evidencias, en la bitácora.
- URL pública con dominio propio operativa. Esto es «producción».

### Bitácora M6

**M6-8 CERRADA (2026-08-08), y con las renuncias dichas por su nombre.**
La casilla llevaba abierta desde el 7 de agosto porque exigía cosas que solo
puede hacer el usuario. Preguntado, respondió literalmente: «No me importan mis
datos, estamos en fase de desarrollo. No me importa ninguna de las acciones que
tengo que hacer yo.» Así que las tres se marcan como **renunciadas**, no como
pendientes: dejarlas sin marcar sugeriría que alguien las hará, y no va a pasar.

```
[x] CI verde en main (typecheck + 453 unit + 82 e2e)   ← run 31255569186
[x] Test de identidad: 4 perfiles, desviación 0,000000 kg
[x] Lighthouse sobre https://motifyer.com, medido tras desplegar M7 Y los
    arreglos del ataque adversarial (`tl-v5-0031`):
      escritorio  100 / 100 / 100 / 100   (LCP 0,4 s · TBT 0 ms · CLS 0)
      móvil        99 / 99 / 100 / 93 / 99  de rendimiento en 5 pasadas
                   (accesibilidad, buenas prácticas y SEO: 100 en todas)
                   LCP 1,74–2,89 s · TBT 0–36 ms · CLS 0
    Se midió cinco veces y no una porque había dos motivos para sospechar: M7
    metió dos módulos en el camino crítico (`_manifest.js`, `plan-chart.js`) y
    el arreglo del XSS hace que `escapeHtml` produzca un 57 % más de bytes de
    texto. La sospecha NO se confirma: los bytes de más son de DOM, no de red
    (el escapado ocurre al pintar, no se transfiere nada distinto — 186 KB en
    39 peticiones), y la pasada de 93 tenía TBT de 5 ms y CLS 0, o sea que su
    LCP de 2,9 s fue entrega, no ejecución. La mediana sigue en 99.
[x] PWA: precache de 64 entradas, modo avión REAL — abre, las once vistas
    cargan, la gráfica dibuja
[x] Migración v4→v5 con fixture de formas reales: no hereda el objetivo roto,
    conserva los check-ins, archiva los datos v4, idempotente
[x] Backup → borrar perfil → restore, y un backup hostil que no ejecuta nada
[x] CSP activa sin violaciones — y AHORA DE VERDAD: hasta M7-7 esta casilla
    se apoyaba en un servidor huérfano que nadie levantaba (ver bitácora M7)
[x] Dominio propio + HTTPS operativos: https://motifyer.com
[~] Migración con los datos REALES del dispositivo   ← RENUNCIADA por el usuario
[~] PWA instalada y sin red en un móvil real         ← RENUNCIADA por el usuario
[~] Guion de humo manual en el móvil                 ← RENUNCIADA por el usuario
```

**Lo que esas tres renuncias dejan sin cubrir, para que conste.** No es nada:
el peor fallo de M6 fue justo de esa familia —el precache fallaba entero en
producción por una redirección que en local no existe— y lo que lo destapó fue
un navegador real contra el dominio. Eso sí está cubierto ahora
(`pwa.spec.js`, modo avión automatizado). Lo que queda fuera es **Safari en
iOS**: otro motor, otra gestión de memoria y la app instalada en vez de una
pestaña. Si algo se rompe solo ahí, esta suite no lo verá. El guion, por si un
día se quiere ejecutar, sigue en `docs/RELEASE-V5.md`.

**2026-08-03 · M6-1 a M6-6 hechas; queda el dominio (M6-7) y la checklist
(M6-8), que dependen del panel de Cloudflare.**

**PWA.** `sw.js` a mano con precache del shell entero (55 recursos: sin bundler
cada módulo es una petición y si falta uno la app no abre sin red). Nunca
recarga sola: el SW nuevo espera, la página avisa y decide el usuario —
recargar por sorpresa a alguien a mitad de un check-in es perder su trabajo.
`test/pwa.test.js` compara PRECACHE contra el árbol real y encontró su primer
módulo ausente en su primera ejecución. Iconos generados sin dependencias
(`tools/make-icons.mjs` escribe el PNG con zlib).

**Seguridad.** CSP `default-src 'self'` sin `unsafe-inline` en ninguna
directiva. Para que `style-src 'self'` fuera real hubo que sustituir los nueve
`style="…"` con datos por `applyCssVars`, que fija las propiedades
personalizadas por CSSOM (que la CSP no cubre) y solo acepta números finitos.
Verificado con la CSP REAL (`tools/serve-csp.mjs`): las diez vistas montan con
0 violaciones. `test/security.test.js` duplica la defensa en estático.

**Accesibilidad.** `test/e2e/accessibility.spec.js` automatiza lo comprobable
sobre el DOM real de las diez vistas: nombre accesible, alternativas
textuales, jerarquía de encabezados, 320 px, 320 px con el tipo al doble
(zoom 200 %), teclado, focus-trap, `:focus-visible` no anulado, `aria-live`
sin robar foco, y `prefers-reduced-motion` sin transiciones > 50 ms. Encontró
un desborde real: al encoger la ventana (rotar el móvil), Chart.js dejaba el
canvas con el ancho viejo y arrastraba el documento a 847 px en una pantalla
de 320.

**Rendimiento.** Lighthouse móvil salía 72. Dos hipótesis descartadas POR
MEDICIÓN: `modulepreload` de los 43 módulos empeoró (82 → 76, compite con el
CSS), y medir sobre `python3 -m http.server` mentía porque HTTP/1.1 serializa
~50 peticiones en 6 conexiones (`tools/serve-h2.mjs` sirve HTTP/2 con las
cabeceras reales, como Cloudflare: 72 → 82). Lo que sí funcionó: vistas
diferidas con `import()` en el router (82 → 89; el arranque ya no arrastra
seis vistas y el catálogo de 34 KB para pintar una pantalla que no los usa) y
Chart.js bajo demanda (89 → 96; sus 208 KB no pintan nada del primer paint).
**Resultado sobre HTTP/2 con la CSP real: móvil 96/100/100/100, escritorio
100/100/100/100.** La medición vinculante sigue siendo la de staging.

**Legales.** El aviso de privacidad y el disclaimer no-médico estaban en
ajustes; lo que faltaba era el momento. Ahora salen también en el último paso
del onboarding, antes de que el usuario escriba su peso y su grasa corporal.

**Verificación adversarial de M6 (2026-08-07).** 5 atacantes, 25 hallazgos, un
refutador independiente por hallazgo. 12 confirmados, 11 refutados, 2 sin
veredicto porque su refutador agotó la cuota (los cerré yo). Corregidos:

1. *(alta)* **La PWA desplegada no tenía offline en absoluto.** Cloudflare
   Pages responde 308 a `/index.html` y `cache.addAll` es todo-o-nada: esa
   sola entrada hacía fallar el precache entero, así que el service worker no
   llegaba a instalarse nunca. Reproducido imitando el 308 en local: caché
   creada con **0 entradas**. Y era invisible, porque la aplicación cargaba de
   red igual; solo el modo avión lo delataba. `test/pwa.test.js` no podía
   verlo porque solo lee el fuente — por eso ahora hay `test/e2e/pwa.spec.js`,
   que activa el modo avión de verdad.
2. *(alta)* El botón «Recargar» del aviso de versión nueva no recibía clics ni
   toques: `.toast-region` desactiva `pointer-events` y nadie se los devolvía
   al botón. En un móvil, sin teclado, era un banner permanente e inútil que
   además activaba el control que quedara debajo.
3. *(alta)* En escritorio con la ventana baja, «Ajustes» era inalcanzable:
   diez secciones no caben y la barra lateral no se podía desplazar.
4. *(alta)* El recordatorio se quedaba armado en el perfil anterior al cambiar
   de perfil, y `fire()` no releía el horario antes de notificar.
5. *(alta)* Con dos pestañas, la que no aplicó la actualización se quedaba
   ejecutando dos versiones a la vez y su «Recargar» era un no-op silencioso.
6. *(media)* El cambio de hora mandaba el aviso al día equivocado: en
   Groenlandia las 23:00 del sábado no existen y se normalizaban al domingo.
   Barrido de 100 800 casos × 10 husos: 0 fallos (antes 48).
7. *(media)* Un clic en zona vacía de la gráfica abría la ficha de un hito que
   no estaba ahí.
8. *(media)* El PNG de la gráfica salía transparente: ilegible sobre blanco.
9. *(media)* El botón «Recargar» de los errores de ARRANQUE era inerte, porque
   se pintan antes de que el router cablee el suyo.
10. *(baja)* La vista de Logros no dejaba ningún `h1` en el documento.

Lección: los dos peores —el precache y el botón muerto— eran invisibles desde
dentro. El primero porque la aplicación funcionaba igual con red; el segundo
porque con teclado sí funcionaba. Ninguno de los 318 tests unitarios podía
verlos; hicieron falta un navegador real, el modo avión y un dedo simulado.

**Checklist de release, lo verificado contra el despliegue real (2026-08-07).**

```
[x] CI verde en main (typecheck + 318 unit + 55 e2e)
[x] Test de identidad: 4 perfiles, desviación 0,000000 kg
    (la v4.0 publicada devolvía 50,9 kg para el primero)
[x] Lighthouse sobre https://transformlab.pages.dev
      móvil       94 / 100 / 100 / 100  (+ Agentic Browsing 100)
      escritorio  96 / 100 / 100 / 100  (+ Agentic Browsing 100)
[x] PWA: precache de 54 entradas, modo avión REAL contra el dominio —
    abre, las nueve secciones cargan, la gráfica dibuja (2 748 px pintados)
[x] Migración v4→v5 con el fixture de formas reales: no hereda el objetivo
    roto, conserva los check-ins, archiva los datos v4, idempotente
[x] Backup → borrar perfil → restore, y un backup hostil que no ejecuta nada
[x] CSP activa sin violaciones en las diez vistas
[x] Dominio propio + HTTPS operativos: https://motifyer.com
[ ] Migración con los datos REALES del dispositivo principal   ← usuario
[ ] PWA instalada y abierta sin red en un móvil real           ← usuario
[ ] Guion de humo manual en el móvil                           ← usuario
```

**M6-7 cerrada (2026-08-07).** El dominio ya estaba conectado al proyecto de
Pages; lo que faltaba era verificarlo. Sobre `https://motifyer.com`:

```
HTTPS 200 · http → 301 → https · CSP y las seis cabeceras de seguridad
sw.js, manifest, robots.txt, llms.txt, iconos, vendor y src: 200
/index.html → 308 → /  (la redirección que tumbaba el precache; ya no le afecta)

Lighthouse   móvil       99 / 100 / 100 / 100  (+ Agentic Browsing 100)
             escritorio 100 / 100 / 100 / 100  (+ Agentic Browsing 100)

Modo avión sobre el dominio: precache de 54 entradas, abre, las nueve
secciones cargan, la gráfica dibuja y un check-in guardado sin red persiste.
```

Dos cosas que salieron al verificar:

- `og:image` era una ruta relativa. Open Graph exige URL absoluta y los
  rastreadores de WhatsApp, LinkedIn y Facebook no la resuelven: el enlace se
  compartía sin imagen. Corregido junto con `og:url`, con test que lo fija.
- **`www.motifyer.com` no resuelve.** No lo he creado: es un registro DNS en
  la cuenta del usuario y una decisión suya (hay quien prefiere el dominio
  desnudo). Si lo quiere, es un CNAME `www` → `motifyer.com` en Cloudflare DNS.
- El dominio se llama `motifyer.com` y la aplicación TransformLab. Puede ser
  deliberado (un dominio que ya tenía) o un descuido; no lo doy por supuesto.
  Si el nombre definitivo es otro, lo único que hay que tocar en el código son
  las dos etiquetas Open Graph de `index.html`.

El rendimiento móvil sobre el dominio salió primero en **64**, no en los 96 de
local: el service worker precacheaba las 55 piezas dentro de la ventana de
medición y bloqueaba el hilo principal 3 410 ms — la aplicación se veía en
1,3 s pero no respondía al dedo. Con el registro aplazado a que la página esté
quieta: **99**, TBT 60 ms. Es la tercera vez en M6 que un fallo solo aparece
midiendo contra el despliegue real.

**Pendiente y bloqueado en el usuario:** M6-7 (dominio en Cloudflare Pages) y
las cuatro casillas de arriba que exigen su móvil y sus datos. Los pasos
exactos están en `docs/RELEASE-V5.md`; el resto de la checklist está
automatizado en `test/e2e/release.spec.js` y `test/e2e/pwa.spec.js`.

---

## E10 · Lectura de báscula de bioimpedancia (2026-08-07)

Fuera de las milestones: lo pidió el usuario con un caso real suyo y bloqueaba
el uso de la aplicación.

**El problema.** Su Xiaomi miScale dio 81,20 kg, 26,5 % de grasa y 56,56 kg de
«masa muscular». La app lo rechazaba con «Ese músculo es el 95 % de tu masa
magra: revisa el dato» — y el dato estaba bien. Lo que no coincidía era la
DEFINICIÓN: una báscula de bioimpedancia descompone el peso en
`grasa + músculo + hueso`, así que su «masa muscular» es la magra menos el
hueso (~95 % de la magra). El motor usa músculo esquelético (Janssen 2000,
~49 % de la magra): para él, 29,24 kg. La diferencia de 3,12 kg es justo lo que
la app de Xiaomi llama «masa ósea».

Es la misma clase de defecto que hundió la v4.0 —dos definiciones de «músculo»
conviviendo— con la diferencia de que aquí el validador SÍ lo paró. Lo que
faltaba era una salida.

**Decisión del usuario:** pedir también la masa ósea y usar `magra = músculo +
hueso` como comprobación cruzada del %grasa.

**Cómo quedó.** `src/core/scale.js` interpreta la lectura; el asistente pide
masa ósea junto al músculo y, **si está rellena, entiende que son cifras de
báscula** (solo esas dan el hueso, así que no hace falta ningún selector).
De ahí:

- se comprueba que `peso = grasa + músculo + hueso` con 0,5 kg de tolerancia,
  que deja pasar el redondeo y caza un dedo torpe con un mensaje que dice QUÉ
  no cuadra, no un genérico «revisa el dato»;
- se recalcula el %grasa desde músculo + hueso, que traen más decimales;
- se DERIVA el músculo esquelético, con un tercer origen `muscleSource:
  'derived'` — ni medido ni estimado a ciegas;
- las cifras del usuario se guardan tal cual (`scaleMuscleKg`, `boneKg`).

**Contrapartida honesta, fijada por un test:** la composición derivada es
idéntica a la estimada. La «masa muscular» de una báscula doméstica es casi
toda la magra, así que no aporta información independiente sobre el músculo
esquelético. Lo que sí aporta es la comprobación cruzada y un %grasa más fino.
Si algún día ese test dejara de pasar, sería que alguien metió el número de la
báscula en el motor.

---

## E11 · El músculo, en la unidad de tu báscula, en toda la app (2026-08-07)

**El problema.** E10 arregló la ENTRADA del estado actual y se quedó ahí. Al
fijar el objetivo, el usuario escribió `60` —el número natural viniendo de
56,56 en su báscula— y la app contestó **«Ganar 30,8 kg de músculo no es
alcanzable»**: ese campo se leía como músculo esquelético, y el suyo es 29,24.
El mismo defecto una capa más arriba, y en más sitios: la gráfica, la tarjeta
del plan y los hitos seguían hablando en esquelético. Peor, `scaleMuscleKg` y
`boneKg` se guardaban desde E10 y **no los leía nadie**.

**Decisiones del usuario:** (1) la cifra principal en la unidad de su báscula,
con la esquelética estimada al lado; (2) el check-in semanal pide músculo y
hueso; (3) tiene que servir a cualquiera y ser realista, no un apaño para
Xiaomi.

**El modelo.** `musculoBáscula = musculoEsquelético + (otraMagra − hueso)`. Ese
paréntesis —órganos, piel, sangre, agua— vale 27,32 kg para él y es
**constante**, porque el motor conserva `otherLeanKg` (invariante
`conservacion`) y el hueso de un adulto no se mueve en unos meses. Verificado
con un test: no varía ni un gramo a lo largo de la proyección entera.
Consecuencia que simplifica todo: **los incrementos son iguales en ambas
unidades; solo hay que traducir niveles.** Por eso los hitos del catálogo, las
tasas de ganancia y los mensajes «ganar X kg» no se tocaron.

**Cómo quedó.**

- El offset se calcula como `initial.scaleMuscleKg − initial.muscleKg`, dos
  cifras que ya viven juntas en el mismo registro. **No hay campo de offset**:
  un valor guardado aparte podría desincronizarse; una resta no.
- Un perfil está «en unidad de báscula» si y solo si `initial.scaleMuscleKg` es
  finito. Sin selector, coherente con E10.
- `src/ui/muscle-units.js` es la única aduana, y vive en la UI a propósito:
  **el motor no se tocó**, así que los siete invariantes con nombre siguen
  valiendo por construcción.
- `target.scaleMuscleKg` guarda la meta tal y como el usuario la escribió (60).
  Sin eso, una recalibración movería el offset y su objetivo se desplazaría
  solo a 59,78. El objetivo del usuario no puede moverse porque cambie una
  estimación interna nuestra.
- Al recalibrar se conserva el OFFSET, no la cifra, y se reescribe también
  `initial.muscleKg`: sin eso quedaba a null y el par del que sale el offset se
  rompía, devolviendo al usuario a una unidad que no es la suya.
- El check-in acepta `scaleMuscleKg` y `boneKg`, **opcionales por obligación**:
  un campo requerido nuevo haría que todo backup anterior perdiera la colección
  en silencio. Se guarda lo medido sin traducir; traducir al mostrar es lo que
  permite que un cambio futuro en la conversión no reescriba el historial.
- **El offset NO se recalcula desde los check-ins**, y está documentado en el
  código: hacerlo movería el objetivo del usuario bajo sus pies cada semana.

**Honestidad, escrita en la interfaz.** Junto a cada cifra de báscula aparece
el esquelético estimado. Lo medido es la magra y el hueso; el reparto entre
músculo esquelético y «todo lo demás» usa una proporción de población
(Janssen 2000), no una medición. Ninguna báscula doméstica mide músculo
esquelético, y la app no finge que sí.

**Cuatro defectos corregidos por el camino:** el asistente no resembraba
`boneKg`/`scaleMuscleKg` al reeditar el perfil (fallo introducido en E10: un
perfil `derived` volvía etiquetado como `measured` y su músculo se desplomaba
de 56,56 a 29,24 delante de él); el umbral del 40 % que produjo el mensaje
bloqueante estaba incrustado sin nombre ni fuente y ahora es
`TARGET_MUSCLE_GAIN_LIMITS` en `constants.js`, con su justificación y sin
cambiar el valor; `CLAUDE.md` §4 seguía diciendo `'measured' | 'estimated'`;
y el título de un test del esquema no cubría `derived`.

**Verificación adversarial (el mismo día).** El ataque devolvió 9 hallazgos y
**los 9 resultaron reales** — un porcentaje muy peor que el de M5 (15 de 27) o
M6 (14 de 25), y la razón es instructiva: casi todos colgaban de UNA cosa que
diseñé mal, no de nueve descuidos independientes. La pregunta «¿está este perfil
en unidades de báscula?» estaba respondida en tres sitios con tres predicados
distintos, y el objetivo se guardaba como un número sin su unidad.

El peor, y el que más me costó ver porque era mi propia premisa:

- **Recalibrar tiraba el músculo ganado y rompía el offset.** `recalibrate.js`
  dejaba `muscleKg` a null, así que la composición se re-estimaba con la
  proporción de POBLACIÓN (0,49 × magra). Esa proporción es transversal —sirve
  para adivinar el músculo de alguien en un instante—, mientras que el motor usa
  el modelo LONGITUDINAL contrario: lo que ganas se suma a la magra y
  `otherLeanKg` se conserva. Mezclarlos tenía tres efectos, los tres medidos: en
  el día 300 se tiraban **1,67 kg** de la ganancia que el propio plan decía haber
  conseguido; el offset saltaba de 27,32 a 28,99, moviendo el objetivo del
  usuario sin que él tocara nada; y el registro resultante **ya no cuadraba
  consigo mismo** (1,69 kg de desajuste sobre una tolerancia de 0,5), de modo que
  al reeditar el perfil la app rechazaba sus propios datos y le pedía revisar
  cifras que nunca había tecleado. Mi «conservar el offset» era el instinto
  correcto con la fórmula equivocada: lo que hay que conservar es `otherLeanKg`
  —exactamente lo que ya decía hacer la inferencia de `inferFatPct`— y entonces
  `scaleMuscleKg = magra − hueso`, que es lo que de verdad marcaría su báscula.
  Con eso el offset queda constante por construcción.

Los otros ocho, todos con test propio: el predicado de «unidad de báscula» ahora
vive en un solo sitio (`isScaleProfile`), y exige las tres cifras; el objetivo
viaja con el offset que estaba en vigor cuando se tecleó, así que cambiar de
unidad conserva la CANTIDAD y no el número; Progreso ya no compara kilos de
báscula contra esqueléticos; el dashboard solo se fía de `target.scaleMuscleKg`
si cuadra con lo que persigue el motor; `muscleOffsetKg` rechaza proporciones
imposibles, que es el cortafuegos contra backups importados; el cruce del
check-in ya no se desactiva al vaciar el hueso; editar un check-in ya no borra
campos que el formulario no llegó a mostrar; y `muscleUnits.explain` dejó de ser
una clave muerta.

**Lección para la próxima:** el ataque encontró en una tarde tres cosas que mis
siete invariantes no podían ver, porque los tres viven en las costuras — entre
el motor y la interfaz, entre una sesión y la siguiente, entre un formulario y
el registro que escribe. Los invariantes cubren el motor, que era donde dolía en
la v4.0; las costuras necesitan ataque.

**Verificado:** 349 tests unitarios y 64 E2E en verde, typecheck limpio, y en
navegador con sus cifras reales — objetivo 60 aceptado, plan de 377 días,
dashboard 56,6 → 60,0 con «≈ 29,2 kg de músculo esquelético» debajo, eje de la
gráfica y lectura accesible en la misma unidad, sin desbordes a 320 px, y una
recalibración real aceptada desde el modal que deja el offset intacto (27,3168
antes y después), el objetivo en 60,0 y el asistente reabriéndose sin un solo
error.

---

## E12 · La proyección: legible, navegable y con la historia de tu proceso (2026-08-08)

**El problema.** La proyección recalibrable es lo que define este producto, y
vivía apretada al final de Hoy. Como pieza visual estaba sin terminar: eje
rotulando números de día crudos sobre planes de 377 días, `legend: false` con
cuatro cosas distintas en el lienzo, botones de métrica que comunicaban el
estado activo solo con color (cero `aria-pressed` en todo el repo), y cinco
bloques de texto gris apilados debajo. Como producto estaba a medio pagar: el
motor calculaba desde M1 los agregados `weekly`/`monthly`, el TDEE adaptado día
a día, el déficit y el suelo de seguridad — y la interfaz no usaba nada de eso
en ningún sitio.

**Petición del usuario:** vista propia con Hoy conservando una gráfica compacta;
las cuatro áreas (día/semana/mes, escenarios con fechas, calorías/TDEE, eje en
fechas y zoom); y, con sus palabras, «ubicar los cambios en todos los aspectos
durante el proceso a modo de hitos».

**La corrección que hubo que hacer antes de diseñar.** Enseñé un mockup con
tres fechas de final distintas y era falso: los tres escenarios deforman el
TIEMPO, no el valor, así que terminan el mismo día. Pero esa deformación es
invertible —`d = T·(d/T)^(1/k)`—, y eso da a cada hito una ventana honesta:
«bajas del 22 % entre el 16 sep y el 12 nov». Un test de propiedad la ata a la
banda que dibuja el motor: si divergen, salta.

**Cómo quedó, en ocho etapas cada una en verde:**

- **E12-0** — primera cobertura unitaria de `chart.js`, que tenía cero, ANTES
  de reformarlo. Escribirla hizo visibles dos endurecimientos: `draw()` dibujaba
  sobre lienzos ya desconectados, y el cursor se heredaba entre vistas.
- **E12-1** — `src/core/timeline.js`, puro, con la ventana de fechas y la fusión
  de eventos. No importa el catálogo de 34 KB; las recalibraciones caen fuera
  del plan por construcción y van a su propio grupo.
- **E12-2** — la ventana deja de ser un `slice` y pasa a ser dos números de la
  escala (por eso el deslizador viejo solo movía un extremo). Recorte
  obligatorio de los dos plugins, que pintaban `fillRect` sin `clip()` — con la
  ventana clavada en 0 nunca se vio. Eje en fechas con `Intl` y `timeZone: 'UTC'`
  (sin él, UTC-5 vería «13 feb» donde pone 2027-02-14; probado con tres `TZ`).
- **E12-3** — la vista, con detalle día/semana/mes leyendo por fin los
  agregados. Dos defectos que solo salieron al ejecutar: rótulos del eje
  congelados con el ancho anterior, y granularidad mensual dejando la gráfica
  vacía en ventanas estrechas.
- **E12-4** — calorías y TDEE, con el déficit como el hueco sombreado entre las
  dos líneas; leyenda en DOM, no en el lienzo.
- **E12-5** — la historia del proceso, agrupada por fase, con cada fila
  llevando la gráfica a su día y el recorrido con teclado marcando la fila más
  cercana sin scroll.
- **E12-6** — Hoy adelgaza: cinco bloques grises → cero, gráfica compacta y un
  botón. Conserva el rango completo y `[data-canvas]`, que son contrato de
  `smoke.spec.js` y de los tests de píxeles.
- **E12-7** — `test/e2e/projection.spec.js` cubriendo por primera vez el recorte
  de los plugins (píxeles en el margen), el clic en hito y el no-clic en vacío,
  el PNG, la fluctuación y que 20 cambios de ventana conservan la instancia.

**Dos trampas del entorno, ya conocidas, que volvieron a morder:** el service
worker sirviendo módulos precacheados viejos mientras yo depuraba (se resuelve
verificando el fuente servido antes de sacar conclusiones), y la caché HTTP del
navegador sirviendo un `dashboard.js` viejo junto a un `main.js` nuevo — la
mezcla de versiones que el todo-o-nada del SW existe para evitar. Y una tercera
copia de iCloud (`chart 2.js`) se coló en un commit; ya hay regla en
`.gitignore` y quedó anotada.

**Verificado:** 383 tests unitarios y 72 E2E en verde, typecheck limpio. En
navegador con las cifras reales: las cinco secciones, granularidad y ventana,
la métrica de calorías con su lectura accesible, la historia enfocando la
gráfica al pulsar un momento, y **cero desbordes a 320 px con la tipografía al
200 %** pese a todos los controles nuevos.

---

## M7 · Cerrar la v1 y dejar el código listo para crecer (2026-08-08)

**Petición del usuario:** «dejarlo todo listo para que la v1 esté terminada y
podamos ponernos con la v2», con el código «completamente optimizado y listo
para crecer», renunciando explícitamente a las verificaciones que exigían su
móvil físico y sus datos reales. Y, preguntado por la dirección de la v2, eligió
**«más funcionalidad, misma app»** — lo que fija la prioridad de esta milestone:
hoy **añadir una vista obliga a tocar siete sitios** y ninguno avisa si olvidas
los otros.

### Tareas

- [x] M7-1 · Defectos reales y promesas incumplidas: `formatBytes` unificado (una foto de 500 B se leía «0 KB» en Fotos y «500 B» en Ajustes), el historial de planes que `recal.explain` prometía y no se podía abrir, los `role="alert"` sin salida de `nutrition` y `body`, y la fuga de URLs de objeto de `photos.js`.
- [x] M7-2 · `src/ui/` entra en el comprobador de tipos. Los 24 ficheros declaraban `// @ts-check` sin estar incluidos en `tsconfig.json`: 7 053 líneas, la mitad del código, escribiendo JSDoc sin cobrar el beneficio. Aparecieron 10 errores reales, casi todos en la frontera core↔UI con el patrón `Result<T>`.
- [x] M7-3 · Manifiesto único de vistas (`main.js` y los tres specs beben de él) y test que ate `CACHE_VERSION` al contenido de `PRECACHE`.
- [x] M7-4 · Helpers compartidos (`redraw` de la gráfica, `dates.js` en todas las vistas) y `src/data/nutrition.js` + `src/data/training.js`, hoy sin un solo test porque su persistencia vive dentro de la vista.
- [x] M7-5 · El N+1 cuadrático de check-ins.
- [x] M7-6 · `dom.js` con test de comportamiento: es la única frontera de seguridad y solo estaba cubierta por análisis estático con regex.
- [x] M7-7 · Los E2E corren bajo la CSP real (`tools/serve-csp.mjs` está huérfano; `playwright.config.js` levanta `python3 -m http.server`, que no manda cabeceras).
- [x] M7-8 · Barrido de código muerto: 15 claves i18n, 8 exports, 5 reglas CSS y 6 tokens sin consumidor.
- [x] M7-9 · Documentación honesta: marcar la auditoría de la v3.1/v4.0 como histórica (describe 165 rutas `js/…` que no existen), contabilidad al día y cierre de M6-8 con las evidencias de hoy y las renuncias del usuario anotadas como tales.

### Bitácora M7

**ATAQUE ADVERSARIAL A M7 (2026-08-08): 16 hallazgos, 16 reales.** Tres
revisores independientes contra las nueve etapas, con la regla de siempre:
nada se reporta sin reproducirlo ejecutando. Verifiqué yo cada uno antes de
tocar nada. Los dos peores los introduje en esta misma milestone.

**Los dos graves, ambos reproducidos:**

1. **Fuga de check-ins entre perfiles.** `findByDate` leía `cache.byDate` sin
   revalidar, y `list()` decidía —a propósito— no cachear un fallo… pero dejaba
   viva la caché ANTERIOR. Con el perfil B ilegible, `list()` devolvía vacío
   mientras `findByDate` seguía sirviendo el índice del perfil A. Es lo peor que
   puede hacer una aplicación de datos personales, y lo escribí yo en M7-5. El
   test «la caché NO cruza perfiles» no lo veía porque solo probaba el camino
   feliz. Arreglado tirando la caché también en la rama de fallo.

2. **XSS real en atributo sin comillas.** `<div class=pre${valor}>` con
   `valor = 'x onmouseover=alert(1) id=v'` **ejecutaba** en Chromium, por el
   camino sancionado y sin usar ninguno de los cinco caracteres que `escapeHtml`
   escapaba. El vigilante por regex de M7-6 se saltaba con un prefijo, con un
   espacio antes del `=` o con un salto de línea, y su comentario decía «esto es
   lo que impide que lo haya mañana». No lo impedía.

   El arreglo no es un lint mejor: `escapeHtml` **escapa ahora también el
   espacio en blanco**. Comprobado en navegador que `&#32;` se queda DENTRO del
   valor del atributo (el analizador decodifica la referencia sin terminar el
   token) y que en texto se decodifica sin que el usuario note nada. El
   vigilante sigue, pero como segunda capa.

**Los otros catorce, por familia:**

- **`safeUrl` tenía dos agujeros.** `//evil.com` pasaba —protocol-relative, un
  redirect abierto en la función escrita para impedirlo— y recortar los espacios
  de TODA la cadena **fabricaba el ataque**: `/ /evil.com`, del propio origen,
  se convertía en `//evil.com`, que no lo es. Reescrita: decide `new URL`, el
  mismo analizador que va a resolverla, y solo se quitan los tres caracteres que
  el navegador ignora de verdad.
- **El candado de `CACHE_VERSION` moría a la primera.** Comparaba «la versión de
  ahora ≠ la que anoté», así que en cuanto alguien subía la versión a mano —lo
  que ordena `sw.js:19`— la condición se cumplía sola para siempre. Reproducido:
  dos módulos del arranque cambiados y el test en verde. Ahora compara el HASH,
  y el único camino para ponerlo verde es `npm run sw:bump`.
- **Una vista con `load: null` montaba Hoy en silencio.** `main.js` casaba por
  «¿tiene load?» en vez de por id: cualquier olvido daba una pestaña navegable
  que pintaba la vista equivocada, con los 445 tests en verde. Y el cableado de
  `wiringFor` no se contrastaba con los ids: renombrar uno dejaba un botón
  muerto sin un solo error. Dos tests nuevos.
- **`addExercise` reventaba con una rutina `days: []`,** que el esquema acepta y
  el importador de backups traga sin un aviso: TypeError dentro del listener,
  modal abierto, ejercicio perdido y botón inservible para siempre.
- **`test/security.test.js` tenía un punto ciego de 3 358 bytes.** Su
  `stripComments` emparejaba `/*` con el siguiente `*/` sin mirar si estaban
  dentro de una cadena, y el `accept="image/*"` de `photos.js` abría un
  comentario falso que ocultaba un tercio del fichero —con sus
  `<img src="${…}">` dentro— a TODOS los tests de seguridad. Lo destapó el
  guardián de imports muertos, que solo daba falsos positivos ahí. Reescrito
  recorriendo el fuente.
- **Fechas.** Los dos modales de borrado irreversible eran los últimos que
  imprimían el ISO crudo — justo donde más importa. Y `shortDate` no lleva año:
  dos fotos separadas un año exacto se leían las dos «8 ago» en el selector
  Antes/Después, en la función cuyo sentido entero es comparar. Nuevo
  `listDate` con año para las listas; `shortDate` se queda en los ejes, que es
  para lo que se escribió.
- **`tools/sw-version.mjs` usaba `.pathname`:** un espacio en la ruta del
  checkout rompía cinco tests y el propio `sw:bump`, con un mensaje que además
  te mandaba al comando que también reventaba.
- **`tools/serve-csp.mjs`, que ahora sostiene los 81 E2E:** un `%` mal formado
  (`/%zz`, `/%C0%AF` — lo que manda un escáner de traversal) **mataba el
  proceso** y con él el resto de la suite; y solo aplicaba la sección `/*` de
  `_headers`, omitiendo el `Cache-Control: no-cache` de `/sw.js`, que es
  exactamente la regla crítica.
- **El barrido de M7-8 creó código muerto nuevo** (un import huérfano, el
  registro de oyentes del router sin escritor, un re-export sin importadores) y
  dejó cinco imports sin usar en otros ficheros. Hay guardián permanente.

**Lo que los revisores comprobaron y estaba LIMPIO,** para que conste: la
unificación de `redraw` no introdujo ninguna regresión (comparación campo a
campo con las dos copias viejas); los repositorios no mutan objetos compartidos
ni pierden datos; la caché no se corrompe por referencia (comprobado congelando
el array y recorriendo las once vistas); el listener `storage` no dispara en la
pestaña que escribe ni acumula; las 12 claves i18n y las 4 reglas CSS borradas
no tenían un solo consumidor; y ningún vector de URL llegó a ejecutar JavaScript
—incluido `data:image/svg+xml`, que en un `<img>` va con scripting desactivado.


**M7-9 y CIERRE DE M7 (2026-08-08).** Los seis documentos de la auditoría
—`DEUDA-TECNICA`, `AUDITORIA`, `CATALOGO-DE-HALLAZGOS`, `VERIFICACION-MANUAL`,
`METODOLOGIA-CIENTIFICA`, `MODELO-DE-DATOS`— describían un árbol que no existe
(165 rutas `js/…`) y se presentaban como «vigente» y «remediación no iniciada».
Es lo primero que lee alguien nuevo, y daba un mapa falso: la remediación fue la
reconstrucción v5, no una corrección in situ. Cada uno abre ahora con un aviso
que dice qué es, para qué SIGUE sirviendo —es el mapa de minas del port, y
`CLAUDE.md` §1 lo exige— y qué no hay que hacer con él. No se borran.

**Estado de la v1 al cerrar M7:**

```
453 tests unitarios · 82 E2E · typecheck limpio sobre TODO src/
55 módulos · 64 entradas de precache · 11 vistas
CI verde en main · desplegado en https://motifyer.com (tl-v5-0031)
Lighthouse escritorio 100/100/100/100 · móvil 99 de mediana en 5 pasadas
```

**Lo que M7 cambia de verdad, más allá de las cifras.** Al empezar, la v1 estaba
«a una casilla de 55», pero esa casilla arrastraba tres afirmaciones que no se
sostenían al comprobarlas: que los E2E corrían bajo la CSP (el servidor estaba
huérfano), que `src/ui/` estaba comprobado por tipos (24 ficheros declaraban
`@ts-check` sin estar incluidos), y que `dom.js` estaba cubierto (solo por
regex, sin ejecutar). Las tres eran verdad en la documentación y mentira en el
código. Ahora coinciden.

Y para la v2 —«más funcionalidad, misma app»— quedan tres cosas que antes no
estaban: añadir una vista cuesta **un** sitio en vez de siete, la capa de datos
tiene repositorios probados en vez de persistencia dentro de las vistas, y
`CACHE_VERSION` es una regla que se impone sola en vez de un comentario que se
olvidaba.

**Y una lección de método, porque es la tercera vez que pasa.** Las tres cosas
que M7 abrió (la CSP sin respaldo, el `@ts-check` sin comprobar, `dom.js`
cubierto solo por regex) eran afirmaciones ciertas en la documentación y falsas
en el código. El ataque adversarial encontró tres más **del mismo tipo, y en lo
que acababa de escribir yo**: un vigilante de XSS cuyo comentario decía «esto es
lo que impide que lo haya mañana» y se saltaba con un prefijo; un candado de
`CACHE_VERSION` «comprobado que tiene dientes» que los tenía una sola vez; y un
test llamado «la caché NO cruza perfiles» que solo probaba el camino feliz.

El patrón no es escribir mal los tests: es que **un test que pasa no dice qué
NO cubre**. Lo único que lo dice es intentar romperlo a propósito. Por eso el
ataque adversarial con refutador es parte del cierre de cada milestone y no un
extra, y por eso ahora hay controles positivos donde importa (el E2E de
seguridad comprueba PRIMERO que el vector funciona en ese navegador; sin eso, un
cero no probaría nada).

**Lo que M7 decidió NO hacer, con el diagnóstico escrito en BACKLOG:** el
singleton de `chart.js` (dos gráficas a la vez fallan en silencio), el escapado
sensible al contexto para atributos sin comillas, diferir el arranque, y los
diccionarios i18n bajo demanda.


**M7-8 (2026-08-08) · barrido, con dos discrepancias respecto al informe.**
12 claves i18n, 7 funciones exportadas que no llamaba nadie
(`isWeekPending`, `isOpen`, `resetDateCache`, `onChange`, `navLabel`,
`todayTolerance`, `bestEstimatedOneRepMax`), 8 exports reducidos a privados,
4 reglas CSS y el fallback inalcanzable de `checkin.js`, que llamaba a `t()`
tres veces para elegir siempre la misma rama.

Dos cosas que el informe daba por hechas y no lo eran:

- **De las 150 claves i18n que salen en un barrido ingenuo, 138 son falsos
  positivos**: se construyen con plantilla (`t(\`phase.${tipo}\`)`,
  `t(\`ranges.${codigo}\`)`). Borrarlas habría dejado la mitad de la interfaz
  diciendo el nombre de la clave. El barrido bueno detecta los prefijos
  dinámicos primero.
- **Los 5 tokens «sin uso» se quedan**, y con una nota en `tokens.css` para que
  la próxima auditoría no vuelva a proponerlo. Cuatro son PELDAÑOS de escalas
  completas —tres familias, tres pesos, ocho espacios, tres sombras— y una
  escala con un hueco es una invitación a que el siguiente que lo necesite se
  invente un valor mágico, que es justo lo que prohíbe D8. El quinto,
  `--breakpoint-desktop`, documenta el único punto de corte; las media queries
  no aceptan propiedades personalizadas, así que no puede leerlo, pero sí
  señalarlo.

También se comprobó que `resetDateCache` no escondía un fallo: el cache lleva el
idioma en la clave, así que un cambio de idioma ya está cubierto por
construcción y su JSDoc («lo llama el cambio de idioma») era falso por partida
doble.

**M7-7 (2026-08-08) · la CSP deja de ser una afirmación.** `tools/serve-csp.mjs`
existía desde M6-3 y estaba huérfano: `playwright.config.js` levantaba `python3
-m http.server`, que no manda una sola cabecera, mientras `docs/RELEASE-V5.md`
afirmaba que los E2E corrían bajo la política real citándolo. **Ningún E2E se
había ejecutado nunca bajo la CSP.**

Ahora Playwright levanta dos servidores y toda la suite va contra el de la
política, que lee las cabeceras de `_headers` en vez de copiarlas — así lo que
se prueba es literalmente lo que despliega Cloudflare Pages. El segundo, sin
cabeceras, es donde vive `dom-security.spec.js`: bajo `script-src 'self'` el
navegador ya bloquea los `javascript:` y los handlers inline, así que ahí un
resultado limpio probaría que la CSP funciona, no que `escapeHtml` escape. Cada
capa se verifica sola. `csp.spec.js` cubre lo complementario: que la política
llega, que la aplicación arranca entera bajo ella (gráfica incluida, que es la
que más podría romperse), y que apaga lo que `dom.js` ya apagaba.

Comprobado con dientes: apuntando la configuración al servidor sin cabeceras,
`csp.spec.js` cae con «falta la directiva default-src 'self'».

**M7-6 (2026-08-08) · la frontera de seguridad se ejecuta, no se lee.**
`dom.js` es el único sitio por el que entran datos al DOM, y no tenía un solo
test que lo ejecutara: `security.test.js` comprueba con regex que nadie
*escriba* `innerHTML` fuera de ahí, pero no que `escapeHtml` **escape**. Si
alguien hubiera roto la función, el proyecto entero seguía en verde.

La parte pura va en `test/ui-dom.test.js`; `render`, `applyCssVars` y `on` van
en `test/e2e/dom-security.spec.js`, contra un navegador real — para esto, lo que
decide si `<img src=x onerror=…>` ejecuta algo es el analizador del navegador,
no una biblioteca que lo imita.

Y de paso se cierra uno de los dos huecos anotados en el BACKLOG, verificado
ejecutándolo: `escapeHtml` no protege el contexto URL, porque
`javascript:alert(1)` no contiene ninguno de los cinco caracteres que escapa y
dentro de un `href` se ejecuta tal cual. Hoy la única URL dinámica son los
`blob:` de las fotos, así que no había agujero — pero «hoy no hay ninguna» es la
clase de garantía que se rompe sola en cuanto una URL venga de un backup o de la
v2. `safeUrl()` la filtra, y dos tests vigilan que ninguna plantilla se salte el
filtro ni interpole en un atributo sin comillas (el otro hueco del BACKLOG, que
sigue abierto por construcción pero ya no es alcanzable). El E2E lleva **control
positivo**: primero prueba que el vector SÍ funciona en ese navegador, y luego
que con el filtro no. Sin eso, un cero no probaría nada.

**M7-4 (2026-08-08) · lo compartido deja de estar copiado.** `redraw` estaba
duplicado casi línea a línea entre Hoy y Proyección, y ya llevaba DOS
divergencias que nadie había decidido: Hoy no reenviaba `scaleMuscleKg` (latente
solo porque su métrica es fija) y formateaba la fecha del hito en ISO crudo.
Ahora `src/ui/plan-chart.js` lo hace una vez y las vistas solo pasan lo que
cambia: métrica, granularidad y ventana.

`src/data/nutrition.js` y `src/data/training.js` sacan la persistencia de dentro
de las vistas, que era la razón de que esas dos no tuvieran **ni un test** desde
M5: no había nada importable desde Node que probar. Y lo que había ahí dentro no
era pintar, era integridad de datos — el generador de ids que no colisionan tras
un borrado, la sesión que reemplaza en vez de duplicar, la validación previa a
escribir. 22 tests nuevos.

`dates.js` pasa de una vista a siete. La misma fecha se leía «14 de febrero de
2027» en Proyección y «2027-02-14» en Check-in, Progreso, Hitos, Fotos y
Entreno. **Y en la lectura accesible de la gráfica**, que es la que oye un lector
de pantalla: eso solo apareció mirándolo en el navegador, no en los tests, y es
donde más molestaba.

**M7-3 (2026-08-08) · añadir una vista cuesta un sitio.** `src/ui/views/_manifest.js`
declara qué vistas hay, cómo se llaman, en qué orden salen y cuáles caben en la
barra inferior; de él beben `main.js` y los tres specs que llevaban su propia
copia de la lista. El cableado que necesita el contexto del arranque (los
`setOnX`) se queda en `main.js`, que es donde tiene sentido. Los `load` viven en
el manifiesto y no en `main.js` porque un `import('./checkin.js')` se resuelve
relativo al fichero donde está escrito: puestos ahí, los especificadores siguen
siendo literales y apuntan a su propia carpeta.

Y `CACHE_VERSION` deja de ser un comentario. `sw.js` sirve lo precacheado
primero y sin revalidar, así que cambiar un fichero sin subir la versión deja a
quien tenga la app instalada con módulos viejos mezclados con los nuevos que sí
pidió de red — el estado imposible que el todo-o-nada del service worker existe
para prevenir, colándose por la puerta de atrás. La regla estaba escrita en
`sw.js:19` y nada la imponía: la versión iba por la 0019 tras muchas más
ediciones. Ahora `sw.lock.json` guarda versión y hash del contenido precacheado,
`npm run sw:bump` los actualiza y el test falla si se despliega sin hacerlo.
Comprobado con dientes: añadir una línea a `chart.js` sin bumpear rompe el test.

**M7-5 (2026-08-08) · el hallazgo que más iba a doler, y la trampa que escondía.**
`findByDate()` llamaba a `list()` en cada invocación, y `list()` reparsea y
**revalida la colección entera**. Las vistas lo metían dentro de un `.map()`
(`dashboard.js:252`, `projection.js:644`, `progress.js:110`), o sea cuadrático:
medido, 52 check-ins → 38 ms, 365 → 1 510 ms, 730 → 6 775 ms, con el esquema
permitiendo 2 000. Y `projection.js` lo rehacía en **cada** cambio de métrica,
granularidad, ventana o fluctuación.

Al escribir el test apareció el problema de verdad: **esta clave no la escribe
solo `checkins.js`**. La escriben `backup.js` al importar, `migrate.js` al
convertir de la v4 y `profiles.js` al sembrar un perfil. Una caché invalidada
desde `save()`/`remove()` —que era el plan— habría sobrevivido a un import de
backup: el usuario restaura sus datos y sigue viendo los de antes. Eso no es un
problema de rendimiento, es pérdida de datos aparente.

Así que la invalidación no vive en la colección sino en `storage.js`, como un
contador de revisión que sube con **cualquier** escritura, incluida la de otra
pestaña vía el evento `storage`. Ningún camino puede olvidarse de avisar, ni
ahora ni cuando la v2 añada colecciones. La caché guarda `{profileId, revision}`
y se descarta si cambia cualquiera de los dos; un almacén corrupto no se cachea,
para que repararlo se vea sin recargar.

**Verificado:** 397 unitarios (8 nuevos) y typecheck limpio. El test de
rendimiento tiene dientes comprobados: desactivando la caché tarda **16 325 ms**
frente a los 11 ms de ahora, contra un umbral de 500.

---

## BACKLOG (ideas fuera de alcance — se anotan, no se hacen)

- **`chart.js` es un SINGLETON y dos gráficas simultáneas fallan en silencio (visto en M7).** `draw()` destruye la instancia previa, así que si una vista pintara dos lienzos a la vez el primero desaparecería sin error ni aviso. Hoy no ocurre —Hoy y Proyección son vistas distintas— y convertirlo en factoría son ~600 líneas de refactor, así que no se hizo. Queda escrito para que el día que la v2 quiera dos gráficas en una pantalla no haya que redescubrir por qué la primera se borra.
- **`escapeHtml` no cubre atributos SIN comillas** (verificado en M7-6: `class=${'a onmouseover=alert(1) b'}` produce un XSS funcionando). Hoy no hay ninguna plantilla así y `test/ui-dom.test.js` lo vigila con un test, pero la función sigue sin ser segura en ese contexto: si alguien la usa fuera de `html``, el hueco está. Cerrarlo de verdad exige un escapado sensible al contexto.
- **Diferir `onboarding.js` y `migrate.js` del arranque** (13,6 KB). Real pero marginal con Lighthouse en 99–100; medido en M7-9.
- **Diccionarios i18n bajo demanda.** Medido: se cambian 10 KB por un RTT extra en el camino crítico. Solo compensa a partir del tercer idioma.
- **URLs y `pushState` en el router.** No hay deep-linking ni compartir vistas; se descartó en M7 por no elegido, no por difícil.

- **Detección de deriva sub-umbral (M4):** una desviación sostenida justo por debajo de la tolerancia es invisible por construcción. Una prueba de tendencia acumulada (media móvil de residuos o regresión sobre la serie) la cubriría; se descartó en M4 por el coste en falsos positivos, que es el fallo más caro para la credibilidad del producto.
- **Hallazgos de M5 refutados pero que siguen siendo endurecimiento razonable:** `escapeHtml` no cubre atributos sin comillas ni esquemas de URL (hoy no hay ningún sitio que los use, pero un `raw()` futuro podría); `splitIntoMeals` no tiene suelo en 0 aunque hoy ninguna entrada real lo alcanza; `suggestProgression` y `refeedMacros` lanzan con objetos corruptos que el almacén nunca produce; `unmount()` de fotos no revoca las URLs de un `draw()` en vuelo.
- **Hallazgos de M6 refutados o de bajo impacto, anotados por si vuelven:** el registro del service worker espera al módulo de la vista inicial (retrasa el precache, no el pintado); `cache.addAll` todo-o-nada es deliberado pero deja la app sin offline si un recurso falla; la marca de «una notificación al día» se guarda por perfil, así que dos perfiles podrían dar dos avisos el mismo día si se cambia de perfil entre medias; `test/security.test.js` no cubre vías de inyección equivalentes que hoy no existen en el código.
- **Recalibrar tira el músculo proyectado también en los perfiles SIN báscula (visto en E11):** `recalibrate.js` re-estima la composición con la proporción de población, así que un perfil `estimated` pierde la ganancia acumulada en cada recalibración igual que le pasaba a uno de báscula (1,67 kg en el día 300 del caso real). En E11 se arregló solo para los perfiles de báscula, donde el usuario compara con una cifra concreta cada semana y la incoherencia es visible. Extenderlo a todos cambiaría la duración de los planes ya creados, así que es una decisión de producto, no un arreglo: hay que decidirla antes de tocarlo.
- i18n a más idiomas · modo claro · sincronización entre dispositivos · exportación PDF del plan · integración con básculas/wearables · comparativas entre perfiles
- **Hallazgos media/baja del ataque a M2 (2026-08-02), pendientes de revisar en M3:** `sanitizeText` parte pares sustitutos al recortar y no elimina los controles C1 de Unicode; un perfil cuyo nombre son solo caracteres invisibles no se puede borrar; `readIndex` normaliza sin marcarlo; los validadores no se protegen de getters que lanzan; `photos-db` no valida que el id no contenga `:` ni que `blob.size` sea finito y positivo; los campos de kilos del plan no tienen cota superior; `migrate` no valida `nowISO`; `transformlab_startDate` nunca se lee.

## Bitácora general

_(decisiones transversales tomadas en sesión, con fecha y una línea de motivo)_

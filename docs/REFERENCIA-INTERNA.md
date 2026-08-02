# Referencia interna

Inventarios de consulta para trabajar sobre el código: mapa de la hoja de estilos, contenedores del DOM y quién escribe en cada uno, catálogo de funciones globales, mapa de interacción y suelo real de compatibilidad de navegadores.

> **Estado:** material de referencia, generado leyendo el código · **Última revisión:** 2 de agosto de 2026 · **Versión auditada:** v3.1, commit `264c1db`

Documentos relacionados: [README](../README.md) · [Arquitectura](./ARQUITECTURA.md) · [Modelo de datos](./MODELO-DE-DATOS.md) · [Metodología científica](./METODOLOGIA-CIENTIFICA.md) · [Auditoría](./AUDITORIA.md) · [Catálogo de hallazgos](./CATALOGO-DE-HALLAZGOS.md) · [Deuda técnica](./DEUDA-TECNICA.md) · [Guía de desarrollo](./GUIA-DE-DESARROLLO.md)

> ### ⚠️ Alcance de este documento
>
> Todos los inventarios de estas páginas describen el **árbol de trabajo local, `main` @ `264c1db` (v3.1)**: los ficheros que hay en disco, leídos uno a uno.
>
> **Ese árbol no es la versión publicada.** `git status -sb` informa de `## main...origin/main [behind 3]`. `origin/main` está en `d0afa49` e incorpora `a701308` (*Upgrade TransformLab v3.1 → v4.0*), `72e8e13` (*fix: router timing, milestone normalization, SVG gradient IDs*) y el merge del PR #1. La rama `claude/silly-yonath` **está fusionada y publicada**.
>
> En consecuencia, **ninguna referencia `fichero:línea` de este documento es válida para la v4.0**, y varios inventarios cambian de raíz allí: la v4.0 carga trece scripts en lugar de siete, incorpora `js/router.js`, `js/checkin.js`, `js/nutrition.js`, `js/training.js` y `js/body-visualizer.js`, y **`js/milestones.js`, `css/milestones.css` y `aesthetic_milestones_complete.json` están vivos en el producto publicado**: sólo son código muerto en este snapshot v3.1. Antes de dar por buena cualquier afirmación sobre la v4.0, verifíquela con `git show origin/main:<fichero>`.
>
> Lo que sí está comprobado que sobrevive en `origin/main` es el defecto crítico del peso objetivo y la rama muerta de `calculateCaloricTarget`. La prioridad número uno del plan de remediación no cambia.

---

## 1. Mapa de `styles_new.css`

2.704 líneas, un único fichero, sin preprocesador ni capas (`@layer`). Es el fichero que concentra casi toda la [Fase 3 del plan de remediación](./DEUDA-TECNICA.md#fase-3--accesibilidad-responsive-y-sistema-de-diseño); esta sección existe para poder orientarse dentro de él sin leerlo entero.

### 1.1. Índice de secciones

Los rangos se derivan de los comentarios de separación del propio fichero. Una sección va desde su comentario de cabecera hasta la línea anterior al siguiente comentario del mismo nivel.

| Líneas | Sección | Contenido |
|---|---|---|
| 1–5 | Cabecera del fichero | Comentario de título. Declara «Estilos v2.0», dos versiones por detrás del nombre del producto |
| 6–213 | `START DATE PICKER OVERLAY` | Overlay modal a pantalla completa (`.start-date-overlay`, `.start-date-card`), `@keyframes float` (56–59) |
| 214–292 | Variaciones de modo ajustes | `.start-date-overlay.settings-mode`, `.warning-box`, `.cancel-btn`, `.settings-footer` |
| 293–360 | Selector de modo | `.mode-selector`, `.mode-btn` |
| 361–410 | **Variables CSS** | Bloque `:root` (362–409). Ver §1.2 |
| 411–431 | Reset y base | `*, *::before, *::after`, `body`, `html` |
| 432–443 | Cursor glow | `.cursor-glow` |
| 444–474 | Loading overlay | `.loading-overlay`, `.loading-spinner`, `@keyframes spin` (466–468) |
| 475–483 | App container | `.app-container` |
| 484–551 | `HEADER` | `.app-header`, `.header-brand`, `.brand-title`, `.header-info`, `.phase-badge` |
| 552–565 | `NAVIGATION BAR` | `.nav-bar` |
| 566–597 | Granularity selector | `.granularity-selector`, `.granularity-btn`, `.granularity-btn.active` (593) |
| 598–651 | Timeline | `.timeline-container`, `.timeline-bar`, `.timeline-progress`, `.timeline-position`, `.phase-markers`, `.phase-marker` |
| 652–710 | Navigation controls | `.nav-controls`, `.nav-btn`, `.nav-label`, `.nav-btn-today` |
| 711–719 | `MAIN CONTENT` | `.main-content` |
| 720–732 | `DASHBOARD ROW - METRIC CARDS` | `.dashboard-row` (grid, 724–731) |
| 733–886 | Nomad Card | Pese al título, contiene los estilos reales de las tarjetas: `.metric-card` (790), `.card-header`, `.metric-grid`, `.metric-item`, `.metric-change` (869–871). El bloque `.nomad-*` que le da nombre ocupa 729–788 y no lo usa nadie |
| 887–895 | `PHASE & GOALS ROW` | `.phase-goals-row` (grid, 891–892) |
| 896–971 | Phase indicator card | `.phase-indicator-card`, `.phase-icon`, `.phase-progress-bar`, `.phase-changes` |
| 972–1001 | Phase stats row | `.phase-stats-row`, `.phase-stat` |
| 1002–1041 | Phase extras / tags | `.phase-extras`, `.phase-tag` |
| 1042–1130 | Goal progress card | `.goal-progress-card`, `.goals-grid`, `.goal-item`, `.goal-bar`, `.goal-fill` |
| 1131–1186 | `CHART SECTION` | `.chart-section`, `.chart-card`, `.chart-header`, `.metric-toggles`, `.metric-toggle` |
| 1187–1262 | Hover panel | `.hover-panel`, `.hover-content`, `.hover-metric`, `.hover-value` |
| 1263–1268 | Chart wrapper | `.chart-wrapper` |
| 1269–1277 | `MILESTONES ROW` | `.milestones-row` (grid 1273–1274) |
| 1278–1350 | `INSIGHTS & ALERTS` | `.insights-row`, `.insights-panel`, `.insight-item` y sus variantes (1314, 1318, 1322) |
| 1351–1394 | Alerts panel | `.alerts-panel`, `.alert-item`, `.alert-action` |
| 1395–1406 | `FOOTER` | `.app-footer` |
| 1407–1427 | `ERROR STATE` | `.error-state`, `.error-icon`, `.reset-btn` |
| 1428–1521 | `RESPONSIVE` (bloque 1) | Tres media queries: 1200 / 768 / 480 px. Ver §1.4 |
| 1522–1587 | `ONBOARDING WIZARD STYLES` | `.onboarding-overlay`, `.onboarding-container` |
| 1588–1645 | Progress steps | `.progress-step`, `.progress-line`, `.step-number`, `.step-label` |
| 1646–1662 | Step content | `.step-content`, `.step-description` |
| 1663–1725 | Input grid | `.input-grid`, `.input-group`, `.input-with-unit` |
| 1726–1771 | Radio groups | `.radio-group`, `.radio-option` |
| 1772–1834 | Composition preview | `.composition-preview`, `.composition-bars`, `.comp-bar` |
| 1835–1869 | Validation panel | `.validation-panel`, `.validation-item` |
| 1870–1902 | Timeline preview | `.timeline-preview` |
| 1903–1943 | Confirm grid | `.confirm-grid`, `.confirm-card`, `.confirm-details` |
| 1944–1985 | Phases preview | `.phases-preview`, `.phase-preview-item` (usa `--phase-color`, 1968) |
| 1986–2006 | Warnings panel | `.warnings-panel` |
| 2007–2015 | Methodology note | `.methodology-note` |
| 2016–2057 | Onboarding footer | `.onboarding-footer`, `.onboarding-btn` |
| 2058–2078 | Error toast | `.error-toast` |
| 2079–2152 | Fat guide modal | `.fat-guide-modal`, `.fat-guide-grid`, `.fat-example` |
| 2153–2208 | Settings sections | `.settings-section`, `.settings-info`, `.settings-action-btn` |
| 2209–2222 | Header goal | `.header-goal`, `.goal-label` |
| 2223–2258 | Error state (2.ª declaración) | Duplica parcialmente 1407–1427 |
| 2259–2286 | Header actions | `.header-actions`, `.header-export-btn`, `.header-settings-btn` |
| 2287–2310 | Metabolic card | `.metric-card.metabolic` (2288), `.metabolic-info` |
| 2311–2345 | `RESPONSIVE DESIGN - TABLET` | Media 900 px (2315–2344) |
| 2346–2614 | `RESPONSIVE DESIGN - MOBILE` | Media 680 px (2349–2613), el bloque más grande del fichero |
| 2615–2662 | `RESPONSIVE DESIGN - SMALL MOBILE` | Media 480 px (2618–2661) |
| 2663–2687 | `TOUCH-FRIENDLY ENHANCEMENTS` | Media `(hover: none) and (pointer: coarse)` (2666–2686) |
| 2688–2704 | `LANDSCAPE MOBILE` | Media 680 px + `orientation: landscape` (2691–2704) |

**Observación estructural.** El fichero contiene **dos sistemas responsive independientes**: el bloque 1428–1521 (1200 / 768 / 480 px) y el bloque 2311–2704 (900 / 680 / 480 px + táctil + apaisado). Ambos declaran un breakpoint de 480 px, y el segundo gana por orden de cascada en las propiedades que colisionan. Cualquier trabajo de la Fase 3 debe decidir primero cuál de los dos conjuntos sobrevive; tocar uno solo produce resultados que se contradicen entre sí.

### 1.2. Custom properties de `:root`

Bloque `:root` en `styles_new.css:362-409`. Treinta y una propiedades. La columna «usos» cuenta las apariciones `var(--nombre)` en cada fichero.

| Propiedad | Línea | Valor | Usos en `styles_new.css` | Usos en `css/milestones.css` | Notas |
|---|---|---|---|---|---|
| `--bg-dark` | 364 | `#0a0a0f` | 2 | 4 | Coincide con `<meta name="theme-color">` (`index.html:20`) |
| `--bg-card` | 365 | `rgba(15, 15, 25, 0.8)` | 7 | 6 | |
| `--bg-card-hover` | 366 | `rgba(25, 25, 40, 0.9)` | **0** | 0 | Declarada y nunca usada |
| `--glass-border` | 369 | `rgba(255, 255, 255, 0.08)` | 19 | 26 | 45 usos combinados; define el borde de todas las superficies de cristal |
| `--glass-border-hover` | 370 | `rgba(255, 255, 255, 0.15)` | 1 | 0 | |
| `--text-primary` | 373 | `#ffffff` | 9 | 1 | |
| `--text-secondary` | 374 | `#c0c0d0` | 27 | 12 | |
| `--text-muted` | 375 | `#6b6b7b` | 38 | 32 | Contraste **3.78:1** sobre `--bg-dark`: por debajo del 4.5:1 que exige WCAG AA para texto normal. Es el color con más usos combinados de todo el conjunto (70) |
| `--accent-cyan` | 378 | `#00d4ff` | 42 | 13 | Color de marca y la más usada dentro de `styles_new.css`. Duplicada como literal en `METRIC_COLORS.weight` (`js/app.js:56`) y en `--toggle-color` del botón «Peso» (`index.html:116`) |
| `--accent-green` | 379 | `#48bb78` | 6 | 7 | Duplicado en `METRIC_COLORS.muscleKg` (`js/app.js:59`) |
| `--accent-coral` | 380 | `#ff6b6b` | 2 | 6 | Duplicado en `METRIC_COLORS.fatPct` (`js/app.js:57`) |
| `--accent-orange` | 381 | `#ff9f43` | 2 | 0 | Duplicado en `METRIC_COLORS.fatKg` (`js/app.js:58`) |
| `--accent-purple` | 382 | `#9f7aea` | 2 | 1 | Duplicado en `METRIC_COLORS.selfEsteem` (`js/app.js:71`) |
| `--accent-pink` | 383 | `#ed64a6` | **0** | 0 | Sin usar en CSS, pero es el valor literal de `METRIC_COLORS.aesthetics` (`js/app.js:68`) |
| `--accent-yellow` | 384 | `#faf089` | **0** | 3 | Sólo la usa la hoja de hitos |
| `--accent-teal` | 385 | `#4fd1c5` | **0** | 0 | Declarada y nunca usada en CSS; literal en `METRIC_COLORS.agility` (`js/app.js:64`) |
| `--accent-indigo` | 386 | `#667eea` | **0** | 0 | Declarada y nunca usada en CSS; literal en `METRIC_COLORS.sleepQuality` (`js/app.js:72`) |
| `--phase-adaptation` | 389 | `#9b59b6` | **0** | 0 | Ver nota más abajo |
| `--phase-recomposition` | 390 | `#3498db` | **0** | 0 | |
| `--phase-cut` | 391 | `#e74c3c` | **0** | 0 | |
| `--phase-bulk` | 392 | `#27ae60` | **0** | 0 | |
| `--phase-maintenance` | 393 | `#95a5a6` | **0** | 0 | **Diverge del JS**: `PHASE_COLORS.maintenance` es `#1abc9c` (`js/app.js:84`) |
| `--font-main` | 396 | `'Outfit', sans-serif` | 14 | 7 | La familia se carga desde Google Fonts (`index.html:25`) |
| `--radius-sm` | 399 | `8px` | 5 | 9 | |
| `--radius-md` | 400 | `12px` | 3 | 7 | |
| `--radius-lg` | 401 | `16px` | 7 | 4 | |
| `--radius-xl` | 402 | `24px` | **0** | 3 | |
| `--shadow-sm` | 405 | `0 2px 8px rgba(0,0,0,0.3)` | **0** | 0 | Declarada y nunca usada |
| `--shadow-md` | 406 | `0 4px 20px rgba(0,0,0,0.4)` | **0** | 0 | Declarada y nunca usada |
| `--shadow-lg` | 407 | `0 8px 40px rgba(0,0,0,0.5)` | **0** | 1 | |
| `--shadow-glow` | 408 | `0 0 30px rgba(0,212,255,0.15)` | 1 | 0 | |

**Los cinco `--phase-*` no se usan en ninguna hoja de estilos.** Los colores de fase se aplican desde JavaScript, escribiendo el hexadecimal directamente en un atributo `style` inline: `PHASE_COLORS` (`js/app.js:79-86`) alimenta `js/dashboard.js:53` (badge de cabecera), `js/dashboard.js:307` (marcadores de fase), `js/dashboard.js:524` (indicador de fase) y `js/charts.js:269` (fondos del gráfico). El resultado es una duplicación de la paleta de fases entre `styles_new.css:389-393` y `js/app.js:80-85`, ya divergente en `maintenance`, y una entrada JS —`transition: '#f39c12'` (`js/app.js:85`)— que no tiene contrapartida en CSS.

**Nueve de las treinta y una propiedades (29 %) no se usan en `styles_new.css`.** Cinco de ellas tampoco en `css/milestones.css`: `--bg-card-hover`, `--accent-pink`, `--accent-teal`, `--accent-indigo`, `--shadow-sm`, `--shadow-md`.

#### Custom properties de ámbito local

Cuatro propiedades no se declaran en `:root`, sino en el atributo `style` del elemento que las necesita, y se leen desde CSS con un valor de respaldo.

| Propiedad | Se declara en | Se consume en | Respaldo |
|---|---|---|---|
| `--toggle-color` | `index.html:116-121` (uno por botón de métrica) | `styles_new.css:1177,1178,1182,1184` | `var(--accent-cyan)` |
| `--phase-color` | `js/dashboard.js:53`, `js/onboarding.js:447` | `styles_new.css:543,1233,1968` | `var(--accent-purple)` en 543 y 1233; **sin respaldo** en 1968 |
| `--milestone-color` | `js/milestones.js:175` | `css/milestones.css:100,108,121` | `#666` |
| `--card-color` / `--detail-color` | `js/milestones.js:671` / `js/milestones.js:724` | `css/milestones.css:726,733,766` / `884,928` | `#666` |

### 1.3. Convención de nombres

La hoja no sigue BEM ni ninguna metodología con separadores explícitos. El patrón real es:

1. **Clases planas en `kebab-case`**, sin `__` ni `--`. La jerarquía se expresa por prefijo compartido: `.metric-card`, `.card-header`, `.card-icon`, `.card-title`, `.metric-grid`, `.metric-item`, `.metric-value`, `.metric-change`.
2. **Prefijo por región de la interfaz**, no por componente reutilizable: `.header-*`, `.nav-*`, `.timeline-*`, `.phase-*`, `.goal-*`, `.chart-*`, `.hover-*`, `.insight-*`, `.alert-*`, `.onboarding-*`, `.step-*`, `.settings-*`, `.start-date-*`, `.fat-*`.
3. **Estados como segunda clase en el mismo elemento**, encadenada en el selector: `.granularity-btn.active` (593), `.metric-toggle.active` (1181), `.progress-step.active` (1609), `.start-date-overlay.visible` (22), `.onboarding-overlay.visible` (1540), `.hover-panel.active` (1198), `.goal-item.complete` (1067).
4. **Variantes semánticas como segunda clase interpolada desde JavaScript**: `.metric-change.positive|.negative|.neutral` (869–871) desde `getChangeClass()` (`js/app.js:546`); `.insight-item.success|.warning|.info` (1314, 1318, 1322) desde `insight.type` (`js/insights.js:30`); `.phase-change.positive|.negative` (1039–1040).
5. **Sin prefijos de utilidad ni escala de espaciado.** Todos los `padding`, `margin` y `gap` son literales en `rem`; no hay tokens de espaciado en `:root`.
6. **Sin selectores de atributo salvo uno**: `.mode-btn.active[data-mode="nomad"]` (328). Los `data-*` que sí usa el JavaScript (`data-granularity`, `data-metric`, `data-step`, `data-milestone-id`) se leen desde el DOM, no se estilan.

De las 249 clases distintas que declara `styles_new.css`, **45 no tienen ningún productor** en el `index.html` ni en el JavaScript de la v3.1. Descontando las que se generan por interpolación de plantilla (`positive`, `negative`, `neutral`, `success`, `warning`, `info`, `complete`), quedan 38 clases repartidas en siete bloques sin ningún marcado que los active:

| Bloque huérfano | Líneas | Clases |
|---|---|---|
| Modo «nomad» | 729–788 | `.dashboard-row.nomad-dashboard` (729), `.metric-card.nomad` (734), `.nomad-stats` (744), `.nomad-stat` (750), `.nomad-stat.main` (756), `.stat-icon` (767) |
| Selector de modo | 295–331 | `.mode-selector` (295), `.mode-btn` (304) y sus tres variantes (317, 322, 328) |
| Selección rápida de fecha y avisos del modal | 122–264 | `.date-hint` (122), `.quick-dates-label` (136), `.quick-date-btn` (143), `.btn-arrow` (199), `.date-note` (208), `.current-date-info` (219), `.current-label` (230), `.current-value` (237), `.warning-box` (243), `.warning-icon` (254). Más `.onboarding-card`, en la sección de onboarding |
| Panel de alertas | 1352–1394 | `.alerts-panel` (1352), `.alert-header`, `.alert-title`, `.alert-item`, `.alert-message`, `.alert-action` |
| Fila de hitos | 1272 (+ 1444 en el media de 1200 px) y 2539–2550 | `.milestones-row` (1272, 1444); `.milestones-timeline-section` (2539), `.next-milestone-panel` y `.milestone-stats-panel` (2543–2544), `.category-progress-section` (2548). Las cuatro últimas **sólo existen dentro del media de 680 px**: no tienen regla en escritorio |
| Estadísticas y etiquetas de fase | 973–1041 | `.phase-stats-row` (973), `.phase-stat` (con `.stat-label` en 989 y `.stat-value` en 996), `.phase-extras` (1003), `.phase-tag` (1009) |
| Cabecera del panel hover | 1212–1234 | `.hover-header` (1212), `.hover-date` (1219), `.hover-period` (1225), `.hover-phase` (1230) — `updateHoverPanel()` genera `.hover-content`, `.hover-title`, `.hover-metrics`, `.hover-metric`, `.hover-label`, `.hover-value` (`js/charts.js:367-384`), no éstas |

El bloque de hitos es el caso que **cambia en la versión publicada**: en `origin/main`, `js/milestones.js` sí está cargado y esas clases sí tienen productor. Los otros cinco no se han verificado contra la v4.0.

### 1.4. Breakpoints declarados

Diez bloques `@media` y `@keyframes` de nivel superior, con sus rangos exactos:

| Líneas | Condición | Qué ajusta |
|---|---|---|
| 56–59 | `@keyframes float` | Animación del icono del selector de fecha |
| 466–468 | `@keyframes spin` | Spinner de carga |
| **1431–1447** | `max-width: 1200px` | `.dashboard-row` y `.metric-grid.small` a 2 columnas, `.insights-row` y `.milestones-row` a 1 columna |
| **1449–1497** | `max-width: 768px` | Cabecera en columna, `.nav-bar` apilada, `.dashboard-row` a 1 columna, `.metric-toggles` con `flex-wrap` |
| **1499–1520** | `max-width: 480px` | Padding del contenedor, tamaño de `.brand-title`, `.granularity-btn`, `.metric-value`, altura de `.chart-wrapper` |
| **2315–2344** | `screen and (max-width: 900px)` | Ajuste de tablet, descrito en el propio fichero como «less aggressive changes to preserve desktop feel» |
| **2349–2613** | `screen and (max-width: 680px)` | Reescritura completa para móvil: navegación, tarjetas, fases, gráfico, hitos, insights, modales, onboarding, pie y tarjeta metabólica |
| **2618–2661** | `screen and (max-width: 480px)` | Segunda pasada de móvil pequeño; **colisiona con 1499–1520** y gana por orden |
| **2666–2686** | `(hover: none) and (pointer: coarse)` | Áreas táctiles y supresión de efectos `:hover` |
| **2691–2704** | `screen and (max-width: 680px) and (orientation: landscape)` | Alturas reducidas en apaisado |

No hay ningún `@media (prefers-reduced-motion)` ni `@media (prefers-color-scheme)` en el fichero, pese a que la interfaz usa animaciones continuas (`.cursor-glow` con `requestAnimationFrame` en bucle, `js/app.js:729-736`; `@keyframes float`; `@keyframes spin`). Tampoco hay `@supports` en ninguna de las dos hojas.

### 1.5. Nota sobre `css/milestones.css`

1.381 líneas. **`index.html` no la enlaza** (`index.html:27` sólo carga `styles_new.css`), igual que `index.html:156-162` no carga `js/milestones.js`. En el snapshot v3.1 esta hoja es inerte; **en `origin/main` no lo es**.

Su relación con la hoja principal:

- **Depende de ella y no puede funcionar sola.** Consume `--bg-dark`, `--bg-card`, `--glass-border`, `--text-*`, `--accent-*`, `--font-main`, `--radius-*` y `--shadow-lg`, que sólo se declaran en `styles_new.css:362-409`. Si se cargara sin la principal, todos esos `var()` caerían a su valor inicial.
- **Declara su propio `:root`** en `css/milestones.css:6-19`: trece propiedades `--milestone-<categoría>` (`general`, `torso`, `espalda`, `hombros`, `brazos`, `antebrazos`, `core`, `piernas`, `vascularidad`, `proporciones`, `postura`, `cuello`, `special`) con paleta Tailwind. Sólo tres de los trece se consumen mediante `var()`; el resto de los colores de categoría se resuelven en JavaScript a través de `MILESTONE_COLORS` (`js/milestones.js:7`), otra paleta duplicada entre CSS y JS.
- **Apenas colisiona con la principal.** Declara 138 clases, de las que 11 aparecen también en `styles_new.css`. Diez de esas once están acotadas por un ancestro en al menos una de las dos hojas (`.stat-box .stat-value` frente a `.nomad-stat .stat-value`, `.metrics-grid .metric-value` frente a `.metric-value`, …). **La única colisión real sin acotar es `.card-title`**: `styles_new.css:816` frente a `css/milestones.css:775`, con la hoja de hitos ganando por orden de carga. Otras cuatro —`.category-progress-section`, `.milestone-stats-panel`, `.milestones-timeline-section`, `.next-milestone-panel`— coinciden a propósito: son los contenedores del subsistema de hitos, que la hoja principal sólo ajusta dentro de su media de 680 px (`styles_new.css:2539-2550`).
- **Estructura interna**: cabecera (1–21), timeline de hitos (22–254), panel de próximo hito (255–417), estadísticas (418–502), tabla de progreso por categoría (503–574), modal de galería (575–706), tarjetas de hito (707–856), modal de detalle (857–1094), popup sobre el gráfico (1095–1328), responsive (1329–1381). Un único breakpoint: `@media (max-width: 768px)` en 1332–1381, que no coincide con ninguno de los dos sistemas de la hoja principal.

---

## 2. Contenedores del DOM

`index.html` declara **21 elementos con `id`**. Ninguno se estila por `id`: los identificadores existen exclusivamente para que el JavaScript los localice con `getElementById`.

### 2.1. Contenedores declarados en `index.html`

| `id` | Declarado en | Escritor | Función | Qué escribe |
|---|---|---|---|---|
| `cursorGlow` | `index.html:31` | `js/app.js:725` | `setupVisualEffects()` (`js/app.js:723`) | `style.left` / `style.top` en cada fotograma, siguiendo el ratón con interpolación 0.04 |
| `loadingOverlay` | `index.html:34` | `js/app.js:374` | `showLoadingState(loading)` (`js/app.js:373`) | `style.display` a `flex` u `none` |
| `headerInfo` | `index.html:48` | `js/dashboard.js:36` | `renderHeader()` (`js/dashboard.js:9`) | `innerHTML`: periodo y fechas, badge de fase con `--phase-color` inline, objetivo peso→peso, botones de exportar y ajustes |
| `timelineBar` | `index.html:64` | — (sólo lector) | `setupEventListeners()` (`js/app.js:648`) | No se escribe; recibe el `click` que dispara `handleTimelineClick` |
| `phaseMarkers` | `index.html:65` | `js/dashboard.js:292` | `renderPhaseMarkers()` (`js/dashboard.js:291`) | `innerHTML`: un `.phase-marker` por fase, con `left`, `width` y `background` calculados sobre el total de días |
| `timelineProgress` | `index.html:66` | `js/dashboard.js:234` | `renderNavigation()` (`js/dashboard.js:229`) | `style.width` = `getProgressPercent()` |
| `timelinePosition` | `index.html:67` | `js/dashboard.js:240` | `renderNavigation()` | `style.left` = `getProgressPercent()` |
| `navPrev` | `index.html:73` | `js/dashboard.js:267` | `renderNavigation()` | Propiedad `disabled` según si se está en el primer índice. Listener en `js/app.js:635` |
| `navLabel` | `index.html:74` | `js/dashboard.js:246` | `renderNavigation()` | `textContent`: fecha + fase (diario), «Semana N · fase» (semanal) o nombre de mes |
| `navNext` | `index.html:75` | `js/dashboard.js:268` | `renderNavigation()` | Propiedad `disabled` según si se está en el último índice. Listener en `js/app.js:636` |
| `navToday` | `index.html:76` | — (sólo lector) | `setupEventListeners()` (`js/app.js:637`) | No se escribe; dispara `navigateToToday` |
| `mainContent` | `index.html:81` | `js/app.js:381` | `showError(message)` (`js/app.js:380`) | `innerHTML` con `.error-state`. **Destruye todo el contenido del panel**, incluidos los contenedores anidados |
| `physicalCard` | `index.html:86` | `js/dashboard.js:361` | `renderMetricCards()` (`js/dashboard.js:332`) | `innerHTML`: peso, músculo, % grasa y grasa kg con su cambio respecto al periodo anterior |
| `performanceCard` | `index.html:89` | `js/dashboard.js:394` | `renderMetricCards()` | `innerHTML`: fuerza y agilidad |
| `wellbeingCard` | `index.html:92` | `js/dashboard.js:421` | `renderMetricCards()` | `innerHTML`: estética, recuperación mental, ánimo, autoestima |
| `metabolicCard` | `index.html:95` | `js/dashboard.js:450` | `renderMetricCards()` | `innerHTML`: BMR, TDEE y nivel de actividad, desde `AppState.data.metadata.metabolicData` |
| `phaseIndicator` | `index.html:102` | `js/dashboard.js:500` | `renderPhaseIndicator()` (`js/dashboard.js:499`) | `innerHTML`: icono y nombre de fase, barra de progreso dentro de la fase, descripción, rango de fechas y cambios esperados |
| `goalProgress` | `index.html:105` | `js/dashboard.js:577` | `renderGoalProgress()` (`js/dashboard.js:576`) | `innerHTML`: una `.goal-item` por objetivo con barra de avance inicial→actual→objetivo |
| `hoverPanel` | `index.html:126` | `js/charts.js:344` y `js/charts.js:389` | `updateHoverPanel(index, granularity)` (`js/charts.js:343`) y `resetHoverPanel()` (`js/charts.js:388`) | `innerHTML`: fase y tres métricas coloreadas al pasar el ratón; el placeholder al salir |
| `mainChart` | `index.html:134` | `js/charts.js:10` | `renderMainChart()` (`js/charts.js:9`) | Obtiene el contexto 2D y construye una instancia de Chart.js sobre él; destruye la anterior si existe (`js/charts.js:16-18`) |
| `insightsPanel` | `index.html:141` | `js/insights.js:10` | `renderInsights()` (`js/insights.js:9`) | `innerHTML`: cabecera y hasta cinco `.insight-item` de `generateInsights()` |

**Escritores por módulo:** `js/dashboard.js` escribe en 12 contenedores, `js/charts.js` en 2, `js/insights.js` en 1, `js/app.js` en 3 (más dos como lector de eventos). El resto de la interfaz —onboarding, modal de ajustes, guía de grasa, toast de error— no vive en `index.html`: se crea con `document.createElement` y se cuelga de `document.body`.

### 2.2. `id` que el JavaScript busca y que no existen en `index.html`

Veintisiete identificadores. Se dividen en tres grupos con implicaciones muy distintas.

**Grupo A — Creados dinámicamente por el propio código (comportamiento correcto).** El elemento se inyecta en `document.body` antes de buscarlo.

| `id` | Lo crea | Lo busca | Módulo |
|---|---|---|---|
| `onboardingOverlay` | `js/onboarding.js` (`show()`) | `js/onboarding.js:89`, `js/onboarding.js:877` | Onboarding |
| `onboardingContent` | `js/onboarding.js:127` | `js/onboarding.js:158` | Onboarding |
| `onboardingPrev` | `js/onboarding.js:132` | `js/onboarding.js:150`, `:159` | Onboarding |
| `onboardingNext` | `js/onboarding.js:135` | `js/onboarding.js:151`, `:160` | Onboarding |
| `profileAge` | `js/onboarding.js:202` | `js/onboarding.js:496` | Onboarding, paso 1 |
| `profileHeight` | `js/onboarding.js:208` | `js/onboarding.js:501` | Onboarding, paso 1 |
| `activityLevel` | `js/onboarding.js:249` | `js/onboarding.js:506` | Onboarding, paso 1 |
| `initialWeight` | `js/onboarding.js:280` | `js/onboarding.js:512` | Onboarding, paso 2 |
| `initialFat` | `js/onboarding.js:287` | `js/onboarding.js:513` | Onboarding, paso 2 |
| `initialMuscle` | `js/onboarding.js:295` | `js/onboarding.js:514` | Onboarding, paso 2 |
| `muscleAutoHint` | `js/onboarding.js:298` | `js/onboarding.js:522` | Onboarding, paso 2 |
| `compositionPreview` | `js/onboarding.js:304` | `js/onboarding.js:611` | Onboarding, paso 2 |
| `targetFat` | `js/onboarding.js:328` | `js/onboarding.js:550` | Onboarding, paso 3 |
| `targetMuscle` | `js/onboarding.js:335` | `js/onboarding.js:551` | Onboarding, paso 3 |
| `targetWeight` | `js/onboarding.js:342` | `js/onboarding.js:552` | Onboarding, paso 3 |
| `startDate` | `js/onboarding.js:349` | `js/onboarding.js:553` | Onboarding, paso 3 |
| `validationPanel` | `js/onboarding.js:358` | `js/onboarding.js:667` | Onboarding, paso 3 |
| `timelinePreview` | `js/onboarding.js:362` | `js/onboarding.js:668` | Onboarding, paso 3 |
| `settingsOverlay` | `js/app.js:262` | `js/app.js:366` | Modal de ajustes |
| `newStartDateInput` | `js/app.js:297` | `js/app.js:324` | Modal de ajustes |
| `saveSettings` | `js/app.js:313` | `js/app.js:325` | Modal de ajustes |

**Grupo B — Creados por `js/milestones.js`, que no está cargado.** Existen en el código del módulo pero, al no enlazarse el script, nunca llegan al documento en la v3.1.

| `id` | Lo crea | Lo busca |
|---|---|---|
| `milestonesModal` | `js/milestones.js:573` (`createMilestonesModal()`) | `js/milestones.js:558`, `:564`, `:568` |
| `milestoneDetailModal` | `js/milestones.js:717` (`openMilestoneDetail()`) | `js/milestones.js:714`, `:811` |
| `milestonePreview` | `js/milestones.js:221` | `js/milestones.js:245`, `:275` |
| `milestoneFilterCategory` | `js/milestones.js:190` | `js/milestones.js:237`, `:280` |
| `milestoneFilterVisibility` | `js/milestones.js:196` | `js/milestones.js:238`, `:281` |
| `galleryFilterState` / `galleryFilterCategory` / `galleryFilterVisibility` / `gallerySearch` / `galleryContent` | `js/milestones.js:585`, `:593`, `:602`, `:610`, `:613` | `js/milestones.js:624`, `:625`, `:626`, `:627`, `:620` |

**Grupo C — Nunca los crea nadie.** Cuatro contenedores que `js/milestones.js` da por existentes en el documento y que no aparecen ni en `index.html` ni en ninguna plantilla del JavaScript.

| `id` | Lo busca | Función | Consecuencia en v3.1 |
|---|---|---|---|
| `milestonesTimeline` | `js/milestones.js:160` | `renderMilestonesTimeline()` (`js/milestones.js:159`) | `if (!container) return` — salida silenciosa |
| `nextMilestonePanel` | `js/milestones.js:299` | `renderNextMilestone()` (`js/milestones.js:298`) | Salida silenciosa |
| `milestoneStats` | `js/milestones.js:394` | `renderMilestoneStats()` (`js/milestones.js:393`) | Salida silenciosa |
| `categoryProgressTable` | `js/milestones.js:482` | `renderCategoryProgressTable()` (`js/milestones.js:481`) | Salida silenciosa |

Los cuatro contenedores del grupo C se corresponden exactamente con las cuatro clases huérfanas de hitos descritas en §1.3 —`.milestones-timeline-section` (`styles_new.css:2539`), `.next-milestone-panel` y `.milestone-stats-panel` (`styles_new.css:2543-2544`), `.category-progress-section` (`styles_new.css:2548`)—, todas ellas declaradas únicamente dentro del media de 680 px. Marcado, estilos y lógica de los hitos existen los tres, pero desconectados entre sí en el snapshot v3.1. **En `origin/main` el subsistema está cargado**; no se ha verificado allí si estos cuatro contenedores tienen ya productor.

---

## 3. Funciones globales

**Cien funciones de nivel superior** en los cinco módulos de presentación y coordinación:

| Módulo | Funciones | Líneas del fichero |
|---|---|---|
| `js/app.js` | 41 | 742 |
| `js/charts.js` | 16 | 607 |
| `js/dashboard.js` | 9 | 686 |
| `js/insights.js` | 3 | 194 |
| `js/milestones.js` | 31 | 895 |
| **Total** | **100** | 3.124 |

Todas son declaraciones `function` en el ámbito global. Ninguna se exporta ni se encapsula: se llaman entre módulos por nombre, apoyándose en el orden de los `<script>` de `index.html:156-162`. `js/milestones.js`, además, republica nueve de las suyas en `window` (`js/milestones.js:887-895`), lo cual es redundante en un script clásico.

La columna «espera de `AppState`» indica qué debe estar poblado **antes** de llamar a la función; si no lo está, el comportamiento aparece en la última columna.

### 3.1. `js/app.js` — Estado y arranque

`js/app.js:8` declara `AppState`, `js/app.js:54` `METRIC_COLORS` y `js/app.js:79` `PHASE_COLORS`. Son los tres objetos globales de los que depende todo lo demás.

| Función | Línea | Parámetros | Devuelve | Espera de `AppState` | Efecto |
|---|---|---|---|---|---|
| `loadAllData()` | 91 | — | `Promise<void>` | Nada. Es el punto de entrada, registrado en `DOMContentLoaded` (`js/app.js:742`) | Lee `localStorage`; si no hay perfil, abre el onboarding; si lo hay, puebla `AppState.userProfile`, `startDate` y `data`, y llama a `initializeApp()` |
| `regenerateData()` | 149 | — | `void` | `userProfile` poblado; sale sin hacer nada si es `null` | Reconstruye `AppState.data` con `DataGenerator` y lo persiste en `transformlab_generatedData`. Sin DOM |
| `calculateCurrentPosition()` | 180 | — | `void` | `startDate` y `data.daily`; sale si falta cualquiera | Fija `navigation.currentDay/currentWeek/currentMonth` a partir de la diferencia con hoy, acotada al rango de datos |
| `initializeWithGeneratedData(data, userProfile)` | 199 | `data`, `userProfile` | `void` | Nada; es quien lo puebla | Puente desde el onboarding: puebla `AppState` completo y encadena `calculateCurrentPosition()` + `initializeApp()` |
| `initializeApp()` | 396 | — | `void` | `data` y `navigation` poblados | Orquestador de arranque: `loadPreferences`, siete funciones de render, `setupEventListeners`, `setupVisualEffects` |

### 3.2. `js/app.js` — Persistencia y perfil

| Función | Línea | Parámetros | Devuelve | Espera de `AppState` | Efecto |
|---|---|---|---|---|---|
| `loadPreferences()` | 418 | — | `void` | Nada | Lee `transformlab_prefs` y `transformlab_startDate`; escribe `navigation.granularity`, `ui.visibleMetrics` y `startDate`. El `try/catch` (`js/app.js:421-427`) rodea sólo el `JSON.parse`, no el acceso a `localStorage` |
| `savePreferences()` | 437 | — | `void` | `navigation.granularity`, `ui.visibleMetrics` | Escribe `transformlab_prefs` (`js/app.js:442`). Sin protección frente a excepción de cuota o acceso denegado |
| `saveStartDate(date)` | 445 | `date: Date` | `void` | — | Fija `AppState.startDate` y escribe `transformlab_startDate` (`js/app.js:447`) |
| `resetProfile()` | 216 | — | `void` | — | `confirm()` nativo; si se acepta, borra las tres claves de `localStorage` y recarga la página |
| `editProfile()` | 226 | — | `void` | — | Reabre el onboarding sobre la sesión actual |

### 3.3. `js/app.js` — Lectura de datos

Todas leen de `AppState.data` y **ninguna comprueba que exista**: si `data.daily` es `null`, lanzan `TypeError`.

| Función | Línea | Parámetros | Devuelve |
|---|---|---|---|
| `getCurrentData()` | 453 | — | El registro del índice actual según `navigation.granularity` |
| `getDataForRange(startIndex, endIndex, granularity)` | 468 | `granularity` por defecto `AppState.navigation.granularity` | Porción del array de la granularidad indicada |
| `getDayData(dayNumber)` | 475 | `dayNumber` 1-based | `AppState.data.daily[dayNumber - 1]` |
| `getWeekData(weekNumber)` | 479 | 1-based | `AppState.data.weekly[weekNumber - 1]` |
| `getMonthData(monthNumber)` | 483 | 1-based | `AppState.data.monthly[monthNumber - 1]` |
| `getPhaseData(phaseName)` | 487 | Nombre de fase | La fase con ese `name`, o `undefined` |
| `getTotalDays()` | 491 | — | `AppState.data.daily.length` |
| `getTotalWeeks()` | 495 | — | `AppState.data.weekly.length` |
| `getTotalMonths()` | 499 | — | `AppState.data.monthly.length` |
| `getProgressPercent()` | 503 | — | Porcentaje 0–100 de avance en la granularidad activa |

### 3.4. `js/app.js` — Formato

Puras, sin estado ni DOM. Devuelven siempre `string` salvo donde se indique.

| Función | Línea | Parámetros | Devuelve | Valor para nulo |
|---|---|---|---|---|
| `formatDate(dateStr, style)` | 520 | `style`: `'short'` (por defecto) o cualquier otro valor para el formato largo | Fecha localizada `es-ES` | `'--'` |
| `formatNumber(num, decimals)` | 529 | `decimals` por defecto `1` | `Number(num).toFixed(decimals)` | `'--'` |
| `formatChange(value, decimals)` | 534 | `decimals` por defecto `2` | Valor con signo `+` explícito si es positivo | `'--'` |
| `formatPercent(value, decimals)` | 541 | `decimals` por defecto `1` | Valor con `%` | `'--'` |
| `getChangeClass(value, invertColors)` | 546 | `invertColors` invierte la semántica (para peso y grasa) | `'positive'`, `'negative'` o `'neutral'` | `'neutral'` |
| `getChangeIcon(value)` | 552 | — | `'↑'`, `'↓'` o `'→'` con umbral ±0.01 | `'→'` |
| `getDateForDay(dayNumber)` | 233 | `dayNumber` 1-based | `Date` desplazada desde `AppState.startDate`, o `null` si no hay fecha de inicio | `null` |
| `formatDateForDay(dayNumber, format)` | 240 | `format`: `'short'`, `'full'` u otro | Fecha localizada | `` `Día ${dayNumber}` `` |

### 3.5. `js/app.js` — Navegación y eventos

| Función | Línea | Parámetros | Devuelve | Espera de `AppState` | Efecto |
|---|---|---|---|---|---|
| `setGranularity(granularity)` | 561 | `'daily'` \| `'weekly'` \| `'monthly'` | `void` | `data` completo | Fija `navigation.granularity`, marca `.active` en `.granularity-btn` (565), y lanza `renderDashboard`, `renderMainChart`, `renderNavigation`, `savePreferences` |
| `navigateTo(index)` | 576 | Índice 1-based en la granularidad activa | `void` | `data` completo | Acota el índice, sincroniza semana en modo diario, y lanza `renderDashboard`, `renderNavigation`, `updateChartHighlight` |
| `navigateRelative(delta)` | 599 | `+1` / `-1` | `void` | — | Delega en `navigateTo` con el índice de la granularidad activa |
| `navigateToToday()` | 615 | — | `void` | `data.daily` | **No navega a hoy**: calcula el punto medio del plan (`Math.floor(getTotalDays() / 2)`), fuerza granularidad diaria y navega ahí |
| `setupEventListeners()` | 628 | — | `void` | — | Registra: `.granularity-btn` (630), `navPrev`/`navNext`/`navToday` (635–637), `.metric-toggle` (640), `keydown` en `document` (645), `click` en `timelineBar` (648) |
| `handleKeyboard(e)` | 651 | `KeyboardEvent` | `void` | — | Ver §4.1. Ignora el evento si `e.target.tagName === 'INPUT'` |
| `handleTimelineClick(e)` | 679 | `MouseEvent` | `void` | `data` completo | Convierte la posición X relativa en índice y llama a `navigateTo` |
| `toggleMetric(metric)` | 702 | Clave de métrica | `void` | `ui.visibleMetrics` | Añade o quita la métrica (nunca deja menos de una), sincroniza `.active` en los toggles (712) y lanza `renderMainChart` + `savePreferences` |
| `setupVisualEffects()` | 723 | — | `void` | — | Arranca un bucle `requestAnimationFrame` **perpetuo** que mueve `#cursorGlow` (`js/app.js:729-735`) |

### 3.6. `js/app.js` — Interfaz auxiliar

| Función | Línea | Parámetros | Devuelve | Efecto en el DOM |
|---|---|---|---|---|
| `showSettingsModal()` | 257 | — | `void` | Crea `#settingsOverlay` en `document.body` con perfil, objetivos, `<input type="date">` y cuatro botones. Sale sin hacer nada si `AppState.userProfile` es `null` |
| `closeSettingsOverlay()` | 365 | — | `void` | Quita `.visible` y elimina el nodo tras 400 ms |
| `showLoadingState(loading)` | 373 | `boolean` | `void` | `#loadingOverlay.style.display` |
| `showError(message)` | 380 | `string` | `void` | Sustituye todo el `innerHTML` de `#mainContent` por `.error-state`. Es destructivo: los contenedores de tarjetas, gráfico e insights dejan de existir |

### 3.7. `js/dashboard.js` — Render de la interfaz principal

| Función | Línea | Parámetros | Devuelve | Espera de `AppState` | Efecto en el DOM |
|---|---|---|---|---|---|
| `renderDashboard()` | 325 | — | `void` | `data`, `navigation` | Orquestador: encadena `renderHeader`, `renderMetricCards`, `renderPhaseIndicator`, `renderGoalProgress`. **No llama a `renderInsights`** |
| `renderHeader()` | 9 | — | `void` | `data.metadata`, `navigation`, `startDate`, `userProfile` | `#headerInfo` |
| `renderMetricCards()` | 332 | — | `void` | `data`, `navigation.granularity`, `data.metadata.metabolicData` | `#physicalCard`, `#performanceCard`, `#wellbeingCard`, `#metabolicCard` |
| `renderPhaseIndicator()` | 499 | — | `void` | `data.phases`, `navigation.currentDay` | `#phaseIndicator` |
| `renderGoalProgress()` | 576 | — | `void` | `data.metadata.initialComposition` y `.targetComposition` | `#goalProgress` |
| `renderNavigation()` | 229 | — | `void` | `data`, `navigation` | `#timelineProgress`, `#timelinePosition`, `#navLabel`, `disabled` de `#navPrev`/`#navNext`; encadena `renderPhaseMarkers()` |
| `renderPhaseMarkers()` | 291 | — | `void` | `data.phases`, `data.daily` | `#phaseMarkers` |
| `getPhaseIcon(phaseType)` | 561 | Tipo de fase | Emoji (`'📊'` por defecto) | — | Ninguno. Función pura |
| `exportProjectData()` | 76 | — | `void` | `userProfile`, `data`, `startDate` | Construye un informe Markdown, lo envuelve en un `Blob` y fuerza la descarga con un `<a download>` temporal (`js/dashboard.js:213-221`). Muestra `alert()` si falta el perfil o los datos |

### 3.8. `js/charts.js` — Gráfico principal

| Función | Línea | Parámetros | Devuelve | Espera de `AppState` | Efecto |
|---|---|---|---|---|---|
| `renderMainChart()` | 9 | — | `void` | `navigation.granularity`, `ui.visibleMetrics`, `data` de la granularidad activa | Destruye `AppState.charts.main` si existe y crea una instancia nueva de Chart.js sobre `#mainChart`. Registra `onClick` (83) y `onHover` (87) en la configuración, y `mouseleave` sobre el canvas (169) |
| `updateChartHighlight()` | 429 | — | `void` | `charts.main`, `navigation` | Reescribe `pointRadius` y `pointBorderWidth` de todos los datasets para destacar el índice actual y llama a `chart.update('none')` |
| `handleChartClick(event, chart, granularity)` | 402 | Evento, instancia, granularidad | `void` | — | Si hay un punto bajo el cursor, mueve `navigation` a ese índice y lanza `renderDashboard` + `renderNavigation`. **No llama a `updateChartHighlight`** |
| `updateHoverPanel(index, granularity)` | 343 | Índice de dato, granularidad | `void` | `data` de la granularidad | `innerHTML` de `#hoverPanel` con fase y tres métricas |
| `resetHoverPanel()` | 388 | — | `void` | — | Restaura el placeholder de `#hoverPanel` |
| `getMetricData(sourceData, metric, granularity)` | 172 | Array de datos, clave de métrica, granularidad | `Array` de valores (con huecos `undefined` si la métrica no existe) | — | Ninguno |
| `getMetricLabel(metric)` | 204 | Clave | Etiqueta legible; la propia clave si no está en el diccionario | — | Ninguno |
| `getAxisForMetric(metric)` | 222 | Clave | `'y'` para magnitudes en kg, `'y1'` para el resto | — | Ninguno |
| `createPhaseBackgrounds(sourceData, granularity)` | 232 | Array, granularidad | Objeto plugin de Chart.js (`beforeDraw`) | `data.phases` en tiempo de dibujado | Pinta bandas de color de fase bajo las series |
| `drawPhaseBackground(ctx, chartArea, xScale, startIdx, endIdx, phaseName, phases)` | 265 | Contexto 2D y geometría | `void` | — | Rellena un rectángulo con `PHASE_COLORS[phase.type] + '15'` (alfa ~8 %) |
| `formatTooltipTitle(index, granularity)` | 283 | Índice, granularidad | `string` | `data` de la granularidad | Ninguno |
| `formatTooltipLabel(ctx)` | 297 | Contexto de tooltip de Chart.js | `string` | — | Ninguno |
| `formatTooltipAfter(index, granularity)` | 309 | Índice, granularidad | `Array<string>`, o `''` si no hay dato | `data` de la granularidad | Ninguno. Añade la lista de hitos del punto |
| `calculateMilestonePositions(sourceData, granularity)` | 463 | Array, granularidad | Array de hitos con `dataIndex` añadido; `[]` si no hay hitos o datos | `data.milestones` | Ninguno. **Recorre todos los hitos × todos los puntos en cada llamada** |
| `createMilestoneMarkers(sourceData, granularity)` | 535 | Array, granularidad | Objeto plugin de Chart.js (`afterDatasetsDraw`) | `data.milestones` | Dibuja los marcadores de hito sobre el área del gráfico |
| `getMilestoneAtIndex(index, granularity)` | 600 | Índice, granularidad | Array de hitos en ese índice | `data` | Ninguno. Recalcula `calculateMilestonePositions` entera para filtrar por un índice |

### 3.9. `js/insights.js` — Motor de insights

| Función | Línea | Parámetros | Devuelve | Espera de `AppState` | Efecto |
|---|---|---|---|---|---|
| `renderInsights()` | 9 | — | `void` | `data`, `navigation` | `innerHTML` de `#insightsPanel`; estado vacío si no hay insights. **Sólo se invoca desde `initializeApp()` (`js/app.js:407`)**: no se vuelve a llamar al navegar ni al cambiar de granularidad, así que el panel queda congelado en la posición de arranque (ver §4.2) |
| `generateInsights()` | 42 | — | `Array<{type, icon, text, detail?}>`, máximo 5 (`js/insights.js:181`) | `data.daily` como mínimo; devuelve `[]` si está vacío | Ninguno |
| `getPhaseInsightIcon(phaseType)` | 184 | Tipo de fase | Emoji (`'📊'` por defecto) | — | Ninguno. Duplica literalmente `getPhaseIcon()` de `js/dashboard.js:561` |

### 3.10. `js/milestones.js` — Subsistema de hitos

**No cargado en la v3.1** (`index.html:156-162`). Sí cargado en `origin/main`. Las 31 funciones se listan aquí porque el módulo existe en el árbol y porque es la referencia que hará falta al actualizar.

**Carga**

| Función | Línea | Parámetros | Devuelve | Espera de `AppState` | Efecto |
|---|---|---|---|---|---|
| `loadMilestones()` | 43 | — | `Promise<void>` | `data.milestones` ya generado; sale con aviso en consola si está vacío | Reescribe cada hito con `calculatedDate`, `dateFormatted` y `fullDateFormatted`, duplica el array en `data.aestheticMilestones`, y encadena los cuatro renders + `renderMainChart` |

**Consulta** (todas devuelven `[]` si `AppState.data.milestones` es nulo; ninguna toca el DOM)

| Función | Línea | Parámetros | Devuelve |
|---|---|---|---|
| `getMilestonesByDay(day)` | 85 | `day` | Hitos con ese `day` |
| `getMilestonesByWeek(week)` | 90 | `week` | Hitos con esa `week` |
| `getMilestonesByPhase(phaseName)` | 95 | Nombre de fase | Hitos de esa fase |
| `getMilestonesByCategory(category)` | 100 | Categoría | Hitos de esa categoría |
| `getAchievedMilestones(currentDay)` | 105 | Día actual | Hitos con `day <= currentDay` |
| `getPendingMilestones(currentDay)` | 110 | Día actual | Hitos con `day > currentDay` |
| `getNextMilestone(currentDay)` | 115 | Día actual | El primer pendiente, o `null` |
| `getMilestoneState(milestone, currentDay)` | 120 | Hito, día | `'achieved'`, `'current'`, `'next'` o `'pending'` |
| `getCurrentDay()` | 130 | — | `navigation.currentDay` en modo diario; `currentWeek * 7` en el resto. **No contempla la granularidad mensual** |
| `getCurrentMetric(metric)` | 376 | Clave física | Valor de la métrica en la posición actual, o `0` |

**Formato** (puras)

| Función | Línea | Parámetros | Devuelve |
|---|---|---|---|
| `getVisibilityLevel(visibility)` | 137 | `'sutil'`/`'notable'`/`'muy_notable'` | `1`, `2` o `3` (`1` por defecto) |
| `getVisibilityDots(visibility)` | 142 | Igual | Cadena de `●` y `○` de longitud 3 |
| `getVisibilityLabel(visibility)` | 147 | Igual | Etiqueta legible; el valor de entrada si no se reconoce |

**Render** (todas salen en silencio si su contenedor no existe)

| Función | Línea | Contenedor | Efecto |
|---|---|---|---|
| `renderMilestonesTimeline()` | 159 | `#milestonesTimeline` (grupo C) | Línea de tiempo con filtros; encadena `setupMilestoneTimelineEvents()` |
| `renderNextMilestone()` | 298 | `#nextMilestonePanel` (grupo C) | Tarjeta del próximo hito con progreso hacia su umbral |
| `renderMilestoneStats()` | 393 | `#milestoneStats` (grupo C) | Contadores de alcanzados / pendientes / total |
| `renderCategoryProgressTable()` | 481 | `#categoryProgressTable` (grupo C) | Tabla de avance por categoría |
| `renderMilestonesGallery()` | 619 | `#galleryContent` | Rejilla filtrada de tarjetas |
| `renderMilestoneCard(milestone, currentDay)` | 665 | — | Devuelve el HTML de una tarjeta (con `--card-color` inline) |

**Interacción**

| Función | Línea | Parámetros | Efecto |
|---|---|---|---|
| `setupMilestoneTimelineEvents()` | 228 | — | `mouseenter`/`mouseleave`/`click` sobre `.timeline-milestone` y `change` sobre los dos filtros |
| `showMilestonePreview(event, milestoneId)` | 241 | Evento, id | Rellena y posiciona `#milestonePreview` sobre el elemento |
| `hideMilestonePreview()` | 274 | — | Añade `.hidden` a `#milestonePreview` |
| `filterMilestonesTimeline()` | 279 | — | Aplica `style.display` a cada `.timeline-milestone` según categoría y visibilidad |
| `openMilestonesGallery()` | 557 | — | Crea el modal si falta, lo rellena y le añade `.open` |
| `closeMilestonesGallery()` | 567 | — | Quita `.open` de `#milestonesModal` |
| `createMilestonesModal()` | 571 | — | Inserta `#milestonesModal` en el documento con sus cuatro controles de filtro |
| `openMilestoneDetail(milestoneId)` | 704 | id | Crea o reutiliza `#milestoneDetailModal`, lo rellena con `--detail-color` inline y le añade `.open` |
| `closeMilestoneDetail()` | 810 | — | Quita `.open` de `#milestoneDetailModal` |
| `navigateToMilestoneDay(day)` | 814 | Día | Cierra el detalle, fuerza granularidad diaria y llama a `navigateTo(day)`. **Depende de `js/app.js`** |

**Integración con el gráfico**

| Función | Línea | Devuelve | Efecto |
|---|---|---|---|
| `getMilestonesChartPlugin()` | 823 | Objeto plugin de Chart.js con `id: 'milestoneMarkers'` y gancho `afterDraw` | Dibuja los hitos sobre el gráfico. **Colisión de identificador**: `createMilestoneMarkers()` (`js/charts.js:535`) declara un plugin con el mismo `id` y gancho distinto (`afterDatasetsDraw`) |

---

## 4. Mapa de interacción

### 4.1. Atajos de teclado

Registrados en `handleKeyboard` (`js/app.js:651-677`), sobre `document` (`js/app.js:645`). El manejador **descarta el evento si el foco está en un `<input>`** (`js/app.js:652`), lo que protege el modal de ajustes y los campos del onboarding.

| Tecla | Acción | Implementación |
|---|---|---|
| `←` | Retroceder una unidad de la granularidad activa | `navigateRelative(-1)` (`js/app.js:655`) |
| `→` | Avanzar una unidad | `navigateRelative(1)` (`js/app.js:658`) |
| `Home` | Ir al primer índice | `navigateTo(1)` (`js/app.js:661`) |
| `End` | Ir al último índice | `navigateTo(getTotalDays())` (`js/app.js:664`). **Usa siempre el total de días**, incluso en granularidad semanal o mensual, donde `navigateTo` lo acota al máximo de la granularidad |
| `1` | Granularidad diaria | `setGranularity('daily')` (`js/app.js:667`) |
| `2` | Granularidad semanal | `setGranularity('weekly')` (`js/app.js:670`) |
| `3` | Granularidad mensual | `setGranularity('monthly')` (`js/app.js:673`) |

No hay ningún indicador visible de estos atajos en la interfaz, ni `Escape` para cerrar el modal de ajustes, el onboarding, la guía de grasa o los modales de hito: sólo se cierran con su botón o pulsando el fondo (`js/app.js:359-363`).

### 4.2. Controles de la interfaz

| Control | Marcado | Evento | Qué dispara | Renders resultantes |
|---|---|---|---|---|
| Botón «Día» | `index.html:57`, `data-granularity="daily"` | `click` (`js/app.js:630-632`) | `setGranularity('daily')` | `renderDashboard` + `renderMainChart` + `renderNavigation` + `savePreferences` |
| Botón «Semana» (activo al cargar) | `index.html:58` | Igual | `setGranularity('weekly')` | Igual |
| Botón «Mes» | `index.html:59` | Igual | `setGranularity('monthly')` | Igual |
| Toggle «Peso» (activo) | `index.html:116`, `data-metric="weight"` | `click` (`js/app.js:640-642`) | `toggleMetric('weight')` | `renderMainChart` + `savePreferences` |
| Toggle «Músculo» (activo) | `index.html:117`, `muscleKg` | Igual | `toggleMetric('muscleKg')` | Igual |
| Toggle «% Grasa» | `index.html:118`, `fatPct` | Igual | `toggleMetric('fatPct')` | Igual |
| Toggle «Grasa kg» | `index.html:119`, `fatKg` | Igual | `toggleMetric('fatKg')` | Igual |
| Toggle «Fuerza» | `index.html:120`, `strength` | Igual | `toggleMetric('strength')` | Igual |
| Toggle «Estética» | `index.html:121`, `aesthetics` | Igual | `toggleMetric('aesthetics')` | Igual |
| Botón `‹` | `index.html:73` | `click` (`js/app.js:635`) | `navigateRelative(-1)` | `renderDashboard` + `renderNavigation` + `updateChartHighlight` |
| Botón `›` | `index.html:75` | `click` (`js/app.js:636`) | `navigateRelative(1)` | Igual |
| Botón «Hoy» | `index.html:76` | `click` (`js/app.js:637`) | `navigateToToday()` | Fuerza granularidad diaria y navega al **punto medio del plan**, no a la fecha actual (`js/app.js:615-626`) |
| Barra de línea de tiempo | `index.html:64` | `click` (`js/app.js:648`) | `handleTimelineClick(e)` | Convierte la X relativa en índice y llama a `navigateTo`. Es un `<div>`: no recibe foco ni responde al teclado |
| Punto del gráfico | `<canvas id="mainChart">`, `index.html:134` | `onClick` de Chart.js (`js/charts.js:83-85`) | `handleChartClick` | `renderDashboard` + `renderNavigation`. **No actualiza el resalte del punto** |
| Zona del gráfico | Igual | `onHover` de Chart.js (`js/charts.js:87-92`) | `updateHoverPanel` | `#hoverPanel` |
| Salida del gráfico | Igual | `mouseleave` sobre el canvas (`js/charts.js:169`) | `resetHoverPanel` | `#hoverPanel` vuelve al placeholder |
| Botón 📄 exportar | `js/dashboard.js:61`, `onclick` inline | `click` | `exportProjectData()` | Descarga `TransformLab_Informe_<fecha>.md` |
| Botón ⚙️ ajustes | `js/dashboard.js:64`, `onclick` inline | `click` | `showSettingsModal()` | Inserta `#settingsOverlay` |
| Ajustes → «Guardar cambios» | `js/app.js:313` | `click` (`js/app.js:327`) | Valida la fecha, la persiste, `regenerateData()`, `calculateCurrentPosition()`, cierra el modal y **re-renderiza seis veces** (`js/app.js:349-354`) | Todo salvo los insights |
| Ajustes → «Editar perfil completo» | `js/app.js:302`, `onclick` inline | `click` | `editProfile()` → reabre el onboarding | — |
| Ajustes → «Reiniciar todo» | `js/app.js:305`, `onclick` inline | `click` | `resetProfile()` → `confirm()`, borrado de `localStorage` y recarga | — |
| Ajustes → «Cerrar» | `js/app.js:312`, `onclick` inline | `click` | `closeSettingsOverlay()` | — |
| Ajustes → fondo | `js/app.js:358-362` | `click` en el overlay | `closeSettingsOverlay()` si el objetivo es el propio overlay | — |

**Cinco de los diez controles de interfaz están cableados con `onclick` inline en cadenas de plantilla** (`js/dashboard.js:61,64`, `js/app.js:302,305,312,387`), lo que obliga a que las funciones sean globales y las expone a inyección si algún dato de perfil llegara a interpolarse en un atributo.

**Qué no se re-renderiza nunca tras el arranque:** `renderInsights()` no aparece en `setGranularity` (`js/app.js:561-574`), ni en `navigateTo` (`js/app.js:576-597`), ni en `handleChartClick` (`js/charts.js:402-427`), ni en el guardado de ajustes (`js/app.js:349-354`). El panel de insights refleja siempre la posición que tenía la aplicación al ejecutar `initializeApp()`.

### 4.3. Pantallas

La v3.1 tiene **dos pantallas**, sin enrutador ni URL propia: la segunda sustituye a la primera cuando el overlay se retira.

**Onboarding, cuatro pasos.** Se muestra si `localStorage` no contiene `transformlab_userProfile` (`js/onboarding.js:37-40`, invocado desde `js/app.js:94`). Es un overlay a pantalla completa insertado en `document.body`, con un indicador de progreso de cuatro pasos, un contenedor de contenido y un pie con «← Anterior» y «Siguiente →». El botón anterior está oculto por `visibility` en el paso 1 (`js/onboarding.js:169`) y el siguiente cambia su texto a «🚀 Comenzar» en el último (`js/onboarding.js:172`). Cada avance valida el paso antes de permitirlo (`js/onboarding.js:744`).

| Paso | Etiqueta | Función | Qué pide |
|---|---|---|---|
| 1 | Perfil | `renderProfileStep()` (`js/onboarding.js:193`) | Edad, sexo, altura, nivel de entrenamiento y nivel de actividad |
| 2 | Estado actual | `renderInitialStep()` (`js/onboarding.js:267`) | Peso, % de grasa y masa muscular, con vista previa de composición y una guía visual de % de grasa |
| 3 | Objetivos | `renderTargetStep()` (`js/onboarding.js:317`) | % de grasa objetivo, músculo objetivo, peso objetivo y fecha de inicio, con panel de validación y vista previa de la línea temporal |
| 4 | Confirmar | `renderConfirmStep()` (`js/onboarding.js:375`) | Resumen, fases previstas, avisos y nota metodológica |

Al confirmar, `complete()` (`js/onboarding.js:845`) persiste el perfil (`js/onboarding.js:855`), genera los datos con `DataGenerator` (`js/onboarding.js:859`), los persiste (`js/onboarding.js:866`), retira el overlay con animación y entrega el control a la pantalla principal.

**Panel principal.** Es el `index.html` estático, poblado por `initializeApp()` (`js/app.js:396`). De arriba abajo: cabecera con marca y `#headerInfo`; barra de navegación con selector de granularidad, línea de tiempo con marcadores de fase y controles anterior/etiqueta/siguiente/hoy; cuatro tarjetas de métricas; indicador de fase y progreso hacia el objetivo; sección de gráfico con los seis toggles de métrica, el panel de hover y el `<canvas>`; panel de insights; y pie de página. Los modales de ajustes, guía de grasa y toast de error se superponen sobre ella creándose bajo demanda.

En `origin/main` esto ya no es cierto: la v4.0 incorpora `js/router.js` y pantallas adicionales (`js/checkin.js`, `js/nutrition.js`, `js/training.js`, `js/body-visualizer.js`) que no se han auditado.

---

## 5. Compatibilidad de navegadores

No hay build, ni transpilación, ni polyfills, ni `browserslist`. El código se ejecuta tal cual, así que el suelo de compatibilidad lo fija la característica más reciente que se usa sin alternativa.

### 5.1. Características que fijan el suelo

| Característica | Dónde | Chrome / Edge | Firefox | Safari |
|---|---|---|---|---|
| **`gap` en contenedores flex** | 42 reglas `display: flex` con `gap` en `styles_new.css` (p. ej. `.warning-box` 243–246, `.settings-footer` 266–269) | 84 | 63 | **14.1** |
| **Propiedad lógica `inset`** | `styles_new.css:11, 447, 615, 1527, 2082` | **87** | **66** | 14.1 |
| Encadenamiento opcional `?.` | 95 apariciones en 7 de los 8 ficheros JS (`js/dashboard.js` 49, `js/milestones.js` 14, `js/charts.js` 13, `js/onboarding.js` 9, `js/app.js` 4, `js/insights.js` 3, `js/dynamic-data-generator.js` 3) | 80 | 74 | 13.1 |
| Propagación en literales de objeto (`{...x}`) | `js/app.js:167`, `js/milestones.js:54`, `js/charts.js`, `js/dynamic-data-generator.js` | 60 | 55 | 11.1 |
| `Object.entries` | `js/milestones.js` (3 usos) | 54 | 47 | 10.1 |
| `async` / `await` | `js/app.js:91`, `js/milestones.js:43` | 55 | 52 | 10.1 |
| CSS Grid | 10 declaraciones `display: grid` (`.dashboard-row` 724, `.phase-goals-row` 891, `.goals-grid` 1056, …) | 57 | 52 | 10.1 |
| Custom properties de CSS | `styles_new.css:362-409` y ~200 usos `var()` | 49 | 31 | 9.1 |
| `<input type="date">` | `js/app.js:297`, `js/onboarding.js:349` | 20 | 57 | 14.1 |
| `classList.toggle(clase, force)` | `js/app.js:566, 713`, `js/onboarding.js:164-165, 480, 490` | 24 | 24 | 10 |
| `Blob` + `URL.createObjectURL` + `<a download>` | `js/dashboard.js:213-221` | 20 | 20 | 10.1 |
| `scroll-behavior: smooth` | `styles_new.css:420` | 61 | 36 | 15.4 (degrada a salto instantáneo) |
| `backdrop-filter` **sin prefijo** | `styles_new.css:13, 1529`, `css/milestones.css:593` | 76 | 103 | 18 (degrada a fondo opaco sin desenfoque) |

**No se usan** ni fusión nula (`??`), ni asignación lógica (`??=`, `||=`), ni `String.replaceAll`, ni `Array.prototype.at`, ni `structuredClone`, ni módulos ES, ni `@supports`, ni `@layer`, ni consultas de contenedor: ninguna de esas eleva el suelo.

### 5.2. Versión mínima resultante

| Navegador | Versión mínima | La impone | Fecha de esa versión |
|---|---|---|---|
| **Chrome** | **87** | `inset` | noviembre de 2020 |
| **Edge** | **87** | `inset` | noviembre de 2020 |
| **Firefox** | **66** | `inset` | marzo de 2019 |
| **Safari (macOS / iOS)** | **14.1** | `gap` en flex, `inset`, `<input type="date">` | abril de 2021 |
| **Opera** | **73** | `inset` (equivale a Chromium 87) | diciembre de 2020 |

Internet Explorer no es compatible en ninguna versión: fallan las propiedades personalizadas, `?.`, `async/await` y la implementación moderna de Grid.

**Degradaciones aceptables por debajo del suelo estricto.** Dos características fallan sin romper la aplicación: `backdrop-filter` (los overlays quedan con fondo opaco, que ya es sólido por el `rgba(5,5,10,0.95)` de `styles_new.css:12`) y `scroll-behavior: smooth` (el desplazamiento salta en lugar de animarse). Ninguna de las dos lleva prefijo `-webkit-` en el fichero, de modo que en Safari anteriores a la 18 el desenfoque simplemente se ignora.

### 5.3. Dependencias externas en tiempo de ejecución

Independientes de la versión de navegador, pero condicionan igualmente que la aplicación funcione:

| Recurso | Declarado en | Consecuencia si no carga |
|---|---|---|
| Chart.js (`cdn.jsdelivr.net`, sin versión fijada) | `index.html:26` | `renderMainChart()` lanza `ReferenceError: Chart is not defined` y el resto del arranque se interrumpe |
| Tipografía Outfit (Google Fonts) | `index.html:23-25` | `--font-main` cae a `sans-serif`; la maquetación se desplaza pero funciona |

### 5.4. `localStorage`: el punto de fallo realista

La aplicación **no puede arrancar sin `localStorage`**: el perfil (`transformlab_userProfile`), los datos generados (`transformlab_generatedData`), las preferencias (`transformlab_prefs`) y la fecha de inicio (`transformlab_startDate`) viven ahí y no hay ninguna alternativa en memoria. Hay 16 accesos a `localStorage` repartidos por `js/app.js` y `js/onboarding.js`.

De esos accesos, **ninguna escritura está protegida con `try/catch`**: `js/onboarding.js:57` (`saveUserProfile`), `js/onboarding.js:866` (datos generados al completar el onboarding), `js/app.js:166` (`regenerateData`), `js/app.js:442` (`savePreferences`) y `js/app.js:447` (`saveStartDate`). Las lecturas tampoco: `js/onboarding.js:38` y `js/onboarding.js:46` acceden directamente, y el único `try/catch` del módulo de arranque —`js/app.js:421-427`— envuelve el `JSON.parse`, no el `getItem`.

El disparador más probable no es un navegador antiguo, sino **Safari en navegación privada**. En ese modo Safari ofrece la API de `localStorage` pero rechaza las escrituras lanzando `QuotaExceededError` con cuota cero. El recorrido concreto del fallo es:

1. El usuario abre la aplicación en una ventana privada de Safari. No hay perfil guardado, así que se muestra el onboarding (`js/app.js:93-96`).
2. Rellena los cuatro pasos y pulsa «🚀 Comenzar».
3. `complete()` llama a `saveUserProfile()` (`js/onboarding.js:855`), que ejecuta `localStorage.setItem` sin protección (`js/onboarding.js:57`).
4. La excepción se propaga fuera de `complete()`. **Nunca se llega a `DataGenerator.generateTransformationData`** (`js/onboarding.js:859`), ni a la retirada del overlay, ni a `initializeWithGeneratedData`.
5. El resultado visible: el overlay del onboarding se queda congelado en el paso 4, sin mensaje de error y sin ninguna indicación de la causa. El único rastro está en la consola.

El mismo mecanismo se dispara con la cuota agotada, con almacenamiento de terceros bloqueado por política del navegador o con el sitio abierto desde `file://` en algunas configuraciones. La estrategia de arranque no distingue entre esos casos porque no captura ninguno.

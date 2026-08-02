# Arranque M5 · Módulos satélite

Pega esto en Claude Code al abrir la milestone M5 (con M4 cerrada):

---

Abrimos **M5 · Módulos satélite**: el port auditado de los módulos v4.0 restantes y las funcionalidades E pendientes. Es la milestone más larga; se cierra con un acto simbólico real: **borrar `legacy/`**. Lee la sección M5 de `PLAN-V5.md`. Referencias por tarea:

- M5-1 Nutrición → `legacy/js/nutrition.js` (sin auditar) + la advertencia de `docs/METODOLOGIA-CIENTIFICA.md` §7.6: la proteína 2,2 g/kg y el NEAT del legacy no tienen fuente. En v5, o entran con cita en `constants.js` o se sustituyen por valores citables. Las macros salen del motor v2 (coherentes con la equivalencia energética B3, no de un cálculo paralelo).
- M5-2 Entrenamiento → `legacy/js/training.js` (sin auditar). La rutina generada por fase/nivel pasa a ser **plantilla editable** (CRUD); el registro de sesión detecta PRs; la progresión sugerida sale del histórico, con su lógica en core y testeada.
- M5-3 Silueta → `legacy/js/body-visualizer.js` (sin auditar). Se conserva la idea (SVG paramétrico, comparador inicio/actual/objetivo); se añade que las medidas reales de E2, cuando existen, modulan la morfología. Transiciones bajo `prefers-reduced-motion`.
- M5-5 Hitos → `legacy/js/milestones.js` con sus 9 defectos internos catalogados (fichas HIT-* — léelas TODAS antes de portar una línea) y `legacy/aesthetic_milestones_complete.json`: es la instancia de un plan personal (fechas fijas, 485 días), no un catálogo, pero sus 102 descripciones anatómicas tienen valor editorial frente a las ~15 plantillas del generador. Tarea con decisión en sesión: proponme rescatarlas despersonalizadas (indexadas por umbral de composición, sin fechas ni días absolutos) o descartarlas, con una muestra de cómo quedarían.
- M5-4 Fotos y M5-6 Logros/tarjeta: sin referencia legacy; diseño desde el plan (E3, E9 c-d). La tarjeta compartible se genera a canvas/PNG y **no incluye** peso ni %grasa absolutos salvo opt-in explícito: por defecto muestra progreso relativo, racha y fase.

Reglas del port (las mismas de A7a, aquí en su máxima expresión):

- Ningún fichero legacy se copia. Se lee, se contrasta con sus fichas del catálogo, y se reescribe sobre los cimientos v5 (i18n, tokens, `html``, storage, core).
- Toda lógica no trivial (macros, refeed, progresión de cargas, detección de PRs, condiciones de logros) nace en `src/core/` o en un módulo puro testeable, con test primero.
- Cada vista nueva llega con sus estados vacío/error (D9) y paridad i18n en el mismo commit.

Orden sugerido: M5-1 → M5-2 → M5-3 → M5-5 → M5-4 → M5-6 → M5-7 → M5-8. Son porciones independientes: si una sesión se queda corta, se cierra la tarea en curso y se anota en bitácora, nunca dos a medias.

M5-8, el cierre: verifica `grep -rn "legacy/" src/ index.html` → 0, elimina `legacy/`, commit `chore: remove legacy — v5 port complete`. La historia queda en git; el presente queda limpio.

Fuera de alcance: PWA, notificaciones, CSP, dominio (todo M6). Cierre: criterios de `PLAN-V5.md` M5 en la bitácora.

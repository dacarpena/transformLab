# Arranque M1 · Motor científico v2

Pega esto en Claude Code al abrir la milestone M1 (con M0 cerrada):

---

Abrimos **M1 · Motor científico v2**. Lee `CLAUDE.md` (especialmente §4, invariantes) y la sección M1 de `PLAN-V5.md`. Antes de la primera línea de código, lee estos tres documentos en este orden, porque son la especificación:

1. `docs/METODOLOGIA-CIENTIFICA.md` — §3 (constantes y dónde están en legacy), §4 (cada cálculo y su estado), §5 (la anatomía exacta del defecto de composición) y sobre todo **§8, que es la lista de obligaciones del motor v5** (sus 10 puntos están repartidos entre las tareas M1-1..M1-9).
2. `docs/AUDITORIA.md` §1 y §4 — los 5 críticos y la tabla de perfiles del test de identidad, que son tus fixtures.
3. `docs/CATALOGO-DE-HALLAZGOS.md`, secciones MOT-* y GEN-* — cada tarea de M1 cita los IDs que cierra; al implementar, comprueba contra la ficha que el defecto no puede reproducirse en tu diseño.

La regla de oro de esta milestone: **esto no es un port del motor legacy, es una reimplementación con el legacy como contraejemplo**. De `legacy/js/calculations.js` solo se copian literalmente las constantes y fórmulas que la auditoría verificó como correctas (Mifflin-St Jeor, multiplicadores 1.2–1.9, tasas 0,5/0,75/1 % PC/sem, umbrales de grasa) — M1-1 las lista. Todo lo demás se escribe de cero contra los invariantes.

Decisiones ya cerradas que condicionan el diseño (no las reabras):

- Composición con `muscleSource: 'measured' | 'estimated'` y dos rutas explícitas (A3c). Nada de clamps absolutos en kg; límites relativos a masa magra con `warning`, no corrección (B1a, B9a).
- El planificador de fases cierra el balance exacto: nada de `- 2` ni `- 0.5` mágicos; usa un acumulador de lo conseguido en fases previas y verifica el cierre (MOT-08).
- Energía y composición conectadas: el déficit de cada fase se **deriva** de su Δgrasa esperada vía ~7 700 kcal/kg, con suelo max(BMR, 1200♀/1500♂) que alarga la fase si recorta (B2a, B3a). TDEE semanal sobre peso proyectado + adaptación (B4a).
- Fechas: UTC puro en todo el core. Ni un `new Date(y, m, d)` local (GEN-02/10).
- Aleatoriedad: solo `rng.js` sembrado. `Math.random` está prohibido en `src/` (añade un test/grep que lo garantice).

Método de trabajo en M1, estricto:

- **Test primero en cada tarea.** El invariante o caso se escribe rojo, luego se implementa. Para M1-4, el primer test que escribes es `identidad` con los 4 perfiles (80 kg/20 %♂ → 80±1, no 50,9; 60/28♀ → 60±1; 95/30♂ → 95±1; 70/12♂ → 70±1).
- El core es puro: sin `window`, sin `document`, sin `console.log` residual. Todo importable desde `node:test`.
- JSDoc con `@ts-check`: typedefs de `Profile`, `Composition`, `PhasePlan`, `DailyPoint`, `Scenario` definidos una vez y reutilizados (los nombres de campos, coherentes con lo que `schema.js` formalizará en M2 — déjalos anotados).
- Cada constante en `constants.js` lleva en JSDoc su fuente (autor, año). Si una constante del legacy no tenía fuente (proteína 2,2 g/kg, NEAT), no entra en M1: se resuelve en M5-1 con cita o se sustituye.

Orden: M1-1 → M1-2 → M1-3 → M1-4 (bloque con M1-5 y M1-6: son el mismo modelo visto de tres sitios, valida junto) → M1-7 → M1-8 → M1-9. Empieza proponiéndome la estructura de typedefs y la firma pública de `engine.js` y `generator.js` en un mensaje corto; cuando la confirme, ejecuta sin volver a preguntar salvo decisión de diseño real.

Fuera de alcance: cualquier UI, cualquier persistencia, tocar `legacy/`. Cierre: criterios de `PLAN-V5.md` M1 ejecutados y pegados en la bitácora, con la salida del test de identidad como evidencia.

# Arranque M4 · Ciclo de seguimiento

Pega esto en Claude Code al abrir la milestone M4 (con M3 cerrada):

---

Abrimos **M4 · Ciclo de seguimiento** — la milestone que convierte TransformLab en lo que decidimos que es (A1b): registrar la realidad, verla contra el plan, recalibrar. Al cerrarla, el producto núcleo está completo. Lee la sección M4 de `PLAN-V5.md`. Referencias:

- `legacy/js/checkin.js` — port auditado (A7a): tiene el formulario y un `_analyseDeviation` embrionario; está **sin auditar**, así que léelo con más escepticismo aún que el resto del legacy. Qué conservar: la elección de campos. Qué no: cualquier cálculo sin test.
- Decisiones A2 (las métricas subjetivas del check-in sustituyen a las sintéticas — en v5 no existe ninguna métrica sintética que emular), E1 (recalibrar se ofrece, nunca se impone), E2 (set de medidas configurable), E9 a-b (racha y calendario).

Diseño ya cerrado:

- **Check-in (M4-1):** peso obligatorio; %grasa opcional; medidas según el set que el usuario haya configurado en ajustes (por defecto: cintura; ampliable a cadera, brazo, pierna, cuello); energía/sueño/adherencia/motivación en escala 1–10; notas. Editable y borrable. Guardado vía `schema.js`/`storage.js`, nunca directo.
- **Desviación (M4-2):** cada check-in se compara contra el escenario esperado Y contra la banda. La señal es ternaria: dentro de banda / fuera por arriba / fuera por abajo. La lógica vive en `src/core/` (pura, testeada), la UI solo la pinta.
- **Recalibración (M4-5):** umbral de oferta = N check-ins consecutivos fuera de banda o desviación acumulada > X (propón valores concretos con justificación antes de implementar). Al aceptar: el plan vigente se archiva con fecha y motivo en un historial consultable; el motor regenera desde el último estado real; los invariantes M1 se ejecutan sobre el plan nuevo. Al rechazar: no se vuelve a ofrecer hasta que el umbral se cruce de nuevo con datos nuevos. Nada automático, nada silencioso — es la materialización de B9 a escala de producto.
- **Vista Progreso (M4-3):** historial de check-ins, una gráfica por medida activa, las 4 subjetivas como serie temporal real, desviación acumulada, racha y calendario de adherencia (M4-6). Estados vacíos: "aún no hay check-ins" con acción directa.
- **Gráfica principal (M4-4):** los puntos reales se superponen a la proyección con estilo propio; el tooltip de un punto real muestra proyectado vs medido.

Método: la lógica nueva (desviación, umbrales, recalibración, racha) nace en `src/core/` con tests antes de tener UI. El E2E de cierre (M4-8) es el guion del producto entero: onboarding → 3 check-ins (el tercero fuera de banda) → oferta → recalibrar → historial conserva el plan anterior → gráfica muestra plan nuevo + puntos reales.

Orden: M4-1 → M4-2 → M4-3 → M4-4 → M4-5 → M4-6 → M4-7 → M4-8. Empieza proponiéndome los umbrales de recalibración y el typedef del check-in final; cuando confirme, ejecuta.

Fuera de alcance: nutrición, entrenamiento, silueta, fotos, logros (M5); notificaciones de sistema (M6). Cierre: criterios de `PLAN-V5.md` M4 en la bitácora.

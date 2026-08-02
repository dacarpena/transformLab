# Arranque M0 · Fundaciones

Pega esto en Claude Code, dentro del repo de TransformLab, para abrir la milestone M0:

---

Arrancamos TransformLab v5, milestone **M0 · Fundaciones**. Lee `CLAUDE.md` entero y la sección M0 de `PLAN-V5.md`. Contexto que necesitas tener claro antes de tocar nada:

- El árbol local está en `264c1db` (v3.1), **tres commits por detrás** de `origin/main` (`d0afa49`, v4.0). La primera tarea es la reconciliación (M0-1) y va antes que absolutamente todo. `git status` puede decir "up to date": miente hasta que hagas `fetch`. Detalles en `docs/HISTORIAL-Y-RAMAS.md` §6 y `docs/GUIA-DE-DESARROLLO.md` §6.
- Hay un `.DS_Store` modificado que bloquea el pull limpio: `git checkout -- .DS_Store` primero.
- Después de reconciliar, la v4.0 completa se **congela** en `legacy/` (M0-3). A partir de ese commit, `legacy/` es solo lectura y ningún fichero de `src/` la importa jamás.
- El esqueleto v5 (M0-4) materializa las decisiones transversales del proyecto: ESM nativo, tokens, i18n, wrapper de storage con namespace, escapado. Hazlo mínimo pero real — cada módulo con su API definitiva y un comportamiento trivial, no ficheros vacíos. La razón: todo lo que aquí quede bien cimentado es un retrofit que nunca ocurrirá.

Orden de ejecución: M0-1 → M0-2 → M0-3 (commit propio) → M0-4 → M0-5 → M0-6 → M0-7 → M0-8. Confírmame el resultado de M0-1 (salida de `git status -sb` y `git log --oneline -3`) antes de seguir con el resto.

Detalles de implementación que no están en el plan:

- `src/ui/dom.js`: exporta `escapeHtml(str)`, un tagged template `html` que escapa toda interpolación por defecto (con `raw()` explícito para HTML confiable), y `on(root, event, selector, handler)` para delegación.
- `src/data/storage.js`: `get/set/remove(key)` con try/catch devolviendo resultado tipado `{ok, value?, error?}`; prefijo de clave `tl.5.<profileId>.` inyectado desde un `setActiveProfile(pid)`; función `usageBytes()` para el presupuesto de cuota.
- `src/i18n/`: `t(key, params?)` con interpolación segura y fallback a `es` + `console.warn` en clave ausente; test de paridad de claves entre `es.js` y `en.js` desde el primer día.
- `tokens.css`: define ya la escala completa (colores base del tema oscuro, 3 tipografías lógicas, espaciados 4/8/12/16/24/32, radios, sombras) aunque los valores se refinen en M3.
- `ci.yml`: node 22, `npm ci`, typecheck, test. Nada más — el E2E entra en CI en M3.
- Para Cloudflare Pages (M0-8) dame las instrucciones de los pasos manuales del panel y verifica tú lo verificable (que el repo esté listo: build command vacío, output `/`).

Fuera de alcance en M0: cualquier lógica del motor, cualquier vista real, cualquier port desde legacy más allá de mover ficheros. Si te tienta, BACKLOG.

Criterios de cierre: los de `PLAN-V5.md` M0, ejecutados y pegados en la bitácora.

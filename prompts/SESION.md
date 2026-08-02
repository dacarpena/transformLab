# Prompt de sesión (el de todos los días)

Pega esto al abrir cualquier sesión de Claude Code que no sea el arranque de una milestone:

---

Continuamos TransformLab v5. Antes de escribir código:

1. Lee `CLAUDE.md` y, en `PLAN-V5.md`, localiza la milestone activa (la primera con tareas sin marcar) y su bitácora.
2. Dime en 2–3 líneas: milestone activa, última entrada de bitácora, y la tarea concreta que propones hacer ahora (la primera sin marcar, salvo que la bitácora diga otra cosa).
3. Si la tarea implica una decisión de diseño que el plan no cierra, plantéamela con opciones y tu recomendación ANTES de programar. Si no, ejecuta directamente.

Reglas de la sesión (además de las de CLAUDE.md):

- Una tarea cada vez. Al terminarla: `npm test` + `npm run typecheck` en verde, checkbox marcado en `PLAN-V5.md`, commit pequeño con mensaje convencional.
- Toda idea fuera de la milestone activa va al BACKLOG de `PLAN-V5.md`, no al código. Aunque sea pequeña. Aunque sea buena.
- Si tocas `src/core/`, los 7 invariantes se ejecutan antes del commit, sin excepción.
- Si algo del port necesita mirar el legacy, abre a la vez su ficha en `docs/CATALOGO-DE-HALLAZGOS.md` y di qué defectos de esa zona estás evitando.
- Antes de cerrar la sesión: añade 2–4 líneas a la bitácora de la milestone (qué se hizo, qué quedó a medias, siguiente paso concreto) y déjalo commiteado.

Empieza por el punto 1.

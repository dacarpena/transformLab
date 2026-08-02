# Kit TransformLab v5 — cómo usarlo

Contenido:

```
CLAUDE.md                    → raíz del repo (Claude Code lo carga solo en cada sesión)
PLAN-V5.md                   → raíz del repo (estado vivo: decisiones, tareas, bitácora)
prompts/SESION.md            → el prompt de todos los días
prompts/M0-fundaciones.md    → prompt de arranque de cada milestone (M0…M6)
prompts/M1-motor.md
prompts/M2-datos.md
prompts/M3-shell-dashboard.md
prompts/M4-seguimiento.md
prompts/M5-satelites.md
prompts/M6-produccion.md
```

## Puesta en marcha (una vez)

1. Copia `CLAUDE.md`, `PLAN-V5.md` y la carpeta `prompts/` a la **raíz del repo** de TransformLab (junto a `docs/`). Commit: `docs: add v5 rebuild plan and prompts`.
2. Abre Claude Code en el repo y pega el contenido de `prompts/M0-fundaciones.md`. La primera tarea (M0-1) reconcilia el árbol local con `origin/main` — va antes que todo y el prompt lo sabe.

## Ritmo de trabajo

- **Arranque de milestone:** pega el prompt `Mx-*.md` correspondiente. Solo la primera sesión de cada milestone.
- **Resto de sesiones:** pega `prompts/SESION.md`. Claude Code lee `CLAUDE.md` + `PLAN-V5.md`, localiza dónde quedó todo por la bitácora y los checkboxes, y sigue.
- **Cierre de milestone:** los criterios de cierre de `PLAN-V5.md` se ejecutan y se pegan en la bitácora. Hasta entonces, la milestone no está cerrada, esté lo que esté "casi".

## Tres reglas que sostienen todo

1. Una milestone a la vez, una tarea a la vez. Lo que no toca va al BACKLOG de `PLAN-V5.md`.
2. Los 7 invariantes del motor (`CLAUDE.md` §4) en verde antes de cualquier commit que toque `src/core/`.
3. Cada milestone termina desplegada en el staging de Cloudflare Pages. Si no está desplegada, no está terminada.

El cuestionario de 50 respuestas está condensado en `PLAN-V5.md` §0 como registro de decisiones; si más adelante quieres cambiar una decisión, se cambia ahí primero (con fecha y motivo en la bitácora general) y después en el código.

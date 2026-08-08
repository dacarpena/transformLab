# Prompts de construcción de la v2

Un prompt por milestone de `docs/v2/PLAN-V2.md`, confeccionado sobre el código que ya
existe. Cada uno es autónomo: se pega en una sesión de Claude Code y arranca esa
milestone. Construir **en orden** (las dependencias están en el plan).

## Cómo usarlos

1. Abre una sesión de Claude Code en la raíz del repo.
2. Pega el contenido del prompt de la milestone activa (`V2-M0.md`, luego `V2-M1.md`…).
3. El prompt ya le dice a Claude Code que lea `CLAUDE.md` y `docs/v2/PLAN-V2.md` primero.

## Preámbulo común (vale para TODOS los prompts)

Todos los prompts asumen estas reglas de la casa. Están en `CLAUDE.md`; se repiten aquí
porque son la diferencia entre código que crece y código que se pudre:

- **Motor puro en `src/core/`**: sin DOM, importable desde Node, con **invariantes con
  nombre** como tests (mira `test/invariants.test.js` de la v1 como molde). Cada constante
  con su fuente citada en JSDoc.
- **i18n**: ningún literal visible fuera de `src/i18n/`. Toda clave nueva va en `es.js`
  **y** `en.js` en el mismo commit. Hay test que compara los dos diccionarios.
- **Tokens**: cero hex/px mágicos fuera de `css/tokens.css`.
- **Persistencia**: solo por `src/data/storage.js` (localStorage) o un módulo IndexedDB
  calcado de `src/data/photos-db.js`. Nunca `localStorage.` directo fuera de `storage.js`.
- **Render seguro**: nada al DOM sin `escapeHtml`/`` html`` `` de `src/ui/dom.js`; URLs por
  `safeUrl`. Sin `onclick=` inline. Sin `innerHTML` fuera de `dom.js`.
- **Tipos**: `// @ts-check` + JSDoc; `npm run typecheck` limpio (incluye `src/ui/` desde M7).
- **Nunca una acción destructiva como respuesta por defecto a un fallo** (ficha H-013).
- **Nunca corrección silenciosa**: cuando algo diverge, se **ofrece** recalibrar (B9).
- **Vistas nuevas**: se declaran en `src/ui/views/_manifest.js` (fuente única) — un sitio,
  no siete. `test/views-manifest.test.js` lo vigila. Si tocas `PRECACHE`, `npm run sw:bump`.
- **Músculo**: el motor solo habla de músculo **esquelético** (E11). La conversión a la
  unidad de báscula del usuario vive en `src/ui/muscle-units.js`, en la frontera. Nada
  convertido cruza a `src/core/`.
- **Cierre de milestone**: tests + typecheck en verde, `npm run e2e` en verde, y **ataque
  adversarial con refutador por hallazgo** antes de dar por cerrada la milestone.

## Definición de «hecho» (toda tarea, de `CLAUDE.md` §8)

1. Tests e invariantes en verde; typecheck limpio.
2. Sin literales fuera de i18n; sin hex fuera de tokens; sin `innerHTML`/`localStorage`
   sueltos.
3. Funciona con teclado y a 320 px si toca UI.
4. `npm run sw:bump` si se tocó algo de `PRECACHE`.
5. Checkbox marcado en `PLAN-V2.md` y commit convencional pequeño.

## Orden

`V2-M0` → `V2-M1` → `V2-M2` → `V2-M3` → `V2-M4` · `V2-M5` · `V2-M6` · `V2-M7` (estos
cuatro son independientes entre sí tras M0/M1) → `V2-M8` → `V2-M9` → `V2-M10` (integración
final).

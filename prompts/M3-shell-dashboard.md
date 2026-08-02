# Arranque M3 · Shell, onboarding y dashboard

Pega esto en Claude Code al abrir la milestone M3 (con M2 cerrada):

---

Abrimos **M3 · Shell, onboarding y dashboard** — la milestone donde la app empieza a existir para un usuario. Lee `CLAUDE.md` §5 (convenciones de UI: escapado, i18n, tokens, a11y) y la sección M3 de `PLAN-V5.md`. Referencias:

- `legacy/index.html` + `legacy/js/router.js` + `legacy/js/dashboard.js` + `legacy/js/charts.js` + `legacy/js/onboarding.js` — como referencia de producto (qué había), nunca como código a copiar. Sus defectos: fichas REN-*, EST-* y FRO-* del catálogo.
- `docs/REFERENCIA-INTERNA.md` §1 — el mapa del CSS legacy: qué convenciones había y las ~265 líneas muertas que NO viajan a v5.
- `docs/VERIFICACION-MANUAL.md` §3 — el perfil canónico (úsalo en el E2E) y §5 (las comprobaciones de accesibilidad, que aquí son criterio de cierre, no sugerencia).

Decisiones de diseño ya cerradas (no reabrir):

- **HOY manda** (D1a): la cabecera del dashboard responde «¿dónde estoy hoy respecto al plan?» — día real calculado desde la fecha de inicio (nada de "punto medio para demo", H-035), fase actual, y estado según plan. Sin check-ins aún (los check-ins llegan en M4), muestra el valor proyectado de hoy e invita al primer registro. La proyección completa vive un scroll más abajo.
- Navegación (D5a): tabs inferiores ≤ 768 px, sidebar en escritorio. Vista activa persistida vía `storage.js`.
- Tema oscuro único (D7a) con contraste AA **medido** sobre los pares reales de `tokens.css` — el `--text-muted` del legacy estaba en 3,67:1 (H-047): aquí ningún texto baja de 4,5:1. `color-scheme: dark`.
- Onboarding (D6a): la pieza central es la **preview del plan en vivo** — cada cambio de campo re-ejecuta el motor (es barato y puro) y actualiza un resumen lateral/inferior (peso objetivo, duración, fases). Validación inline desde `ranges.js` distinguiendo aviso de error; bioimpedancia claramente opcional explicando qué cambia (`muscleSource`); la fecha de inicio se valida. El error bloqueante del legacy (C-4) es imposible por construcción: verifícalo con el perfil de complexión pequeña de la ficha MOT-02.
- Gráfica (M3-5): Chart.js desde `vendor/`. Capas: banda de escenarios (relleno entre pesimista y optimista), línea esperada, bandas de fase de fondo, línea vertical HOY, hitos clicables (ficha en modal), brush de rango, export PNG, interruptor de fluctuación. Alternativa textual: región `aria-live` con los valores del punto activo. Si Chart.js no carga: mensaje + botón de recarga. **Jamás** una acción destructiva como salida de un error (H-013).

Método:

- Componentes base primero (M3-2): tarjeta, botón, modal con focus-trap reutilizable, toast, empty-state. Todo lo demás los consume.
- Cada vista se construye con `html`` de `dom.js` y eventos delegados. Ni un `onclick=` en cadenas. Ni un literal fuera de `t()`.
- El render es por vista (el router monta/desmonta), y dentro de la vista, granular donde importe (la preview del onboarding no reconstruye el formulario — el foco del usuario no se pierde nunca al teclear).
- E2E (M3-8) con Playwright configurado con `webServer` para que corra en CI.

Orden: M3-1 → M3-2 → M3-3 → M3-4 → M3-5 → M3-6 → M3-7 → M3-8. En M3-2, antes de programar, proponme en un mensaje la paleta definitiva de `tokens.css` (con los ratios de contraste calculados) y un boceto en texto de la estructura del dashboard; cuando confirme, ejecuta.

Fuera de alcance: check-ins y desviación (M4), módulos satélite (M5), PWA (M6). Cierre: criterios de `PLAN-V5.md` M3 en la bitácora, incluido el smoke E2E verde en CI y el staging usable.

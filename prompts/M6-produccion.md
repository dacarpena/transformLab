# Arranque M6 · Producción

Pega esto en Claude Code al abrir la milestone M6 (con M5 cerrada):

---

Abrimos **M6 · Producción**, la última: PWA, seguridad, accesibilidad AA, dominio y la checklist de release. Aquí no se añade producto; se convierte lo que hay en algo publicable y se demuestra con evidencias. Lee la sección M6 de `PLAN-V5.md`.

Diseño ya cerrado:

- **PWA (M6-1):** `manifest.webmanifest` (nombre, iconos maskable, tema oscuro, standalone), `sw.js` escrito a mano — precache del shell + `vendor/` + css + src con versión de caché derivada del release; estrategia cache-first para estáticos propios; al detectar SW nuevo, toast «nueva versión disponible → recargar», nunca recarga forzada. La app debe abrir 100 % offline tras la primera visita.
- **Recordatorio (M6-2):** día/hora en ajustes; Notification API solo tras gesto explícito del usuario (nada de pedir permiso al cargar); si se deniega o no hay soporte, queda el aviso in-app de M4-7 y el ajuste lo dice claramente.
- **Seguridad (M6-3):** fichero `_headers` de Cloudflare Pages con CSP estricta — objetivo `default-src 'self'; img-src 'self' data: blob:; style-src 'self'; script-src 'self'` (sin `unsafe-inline`: si las fuentes web lo impiden, se auto-alojan en `vendor/fonts/`), más `X-Content-Type-Options: nosniff` y `Referrer-Policy: strict-origin-when-cross-origin`. Añade un test estático que falle si aparece `onclick=` en `src/` o interpolación fuera de `html``/`raw()`.
- **Accesibilidad (M6-4):** pasada AA completa con registro: recorrido de teclado de las 8+ vistas, focus-trap y `Escape` en todos los modales, contraste medido de cada par de tokens en uso, `prefers-reduced-motion` cubriendo todas las animaciones, alternativa del canvas, zoom 200 %, 375 px y 320 px. Los resultados se pegan en la bitácora, comprobación a comprobación — el guion base es `docs/VERIFICACION-MANUAL.md` §5, ampliado a las vistas v5.
- **Rendimiento (M6-5):** Lighthouse sobre el staging real (no localhost) ≥ 90 en las cuatro categorías. Si algo baja, se corrige lo concreto; no se "optimiza" nada que ya pase.
- **Meta y legales (M6-6):** aviso de privacidad («tus datos no salen del navegador; se guardan sin cifrar en este dispositivo») accesible desde ajustes y onboarding; disclaimer no-médico; Open Graph e iconos completos; `robots.txt` real; título/descripción vía i18n.
- **Dominio (M6-7):** dame los pasos del panel de Cloudflare para el dominio y verifica lo verificable (redirecciones, HTTPS, que la PWA instala desde el dominio final).

El cierre (M6-8) es ejecutar la checklist de release completa y pegarla con evidencias en la bitácora:

```
[ ] CI verde en main (typecheck + unit + e2e)
[ ] Test de identidad: 4 perfiles ±1 kg (salida pegada)
[ ] Lighthouse ≥ 90 × 4 sobre el dominio (capturas o JSON)
[ ] Guion de humo manual v5 pasado (adaptado de docs/VERIFICACION-MANUAL.md)
[ ] Migración v4→v5 probada con los datos reales del dispositivo principal
[ ] Backup → borrar perfil → restore probado
[ ] PWA instalada y abierta offline en un móvil real
[ ] CSP activa sin errores en consola en las 8+ vistas
[ ] Dominio + HTTPS operativos
```

Cuando la checklist esté completa, el proyecto está **en producción**. Última entrada de bitácora con fecha, y se acabó el ciclo: cualquier idea nueva es BACKLOG para un ciclo futuro, no una extensión de este.

Orden: M6-1 → M6-2 → M6-3 → M6-4 → M6-5 → M6-6 → M6-7 → M6-8.

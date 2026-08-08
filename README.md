# TransformLab

Seguimiento de transformación corporal **con proyección recalibrable**. Defines un objetivo, la aplicación genera
un plan por fases (adaptación, recomposición, definición, volumen, transición, mantenimiento) con proyección diaria
y una banda de escenarios, y tus check-ins semanales reales se comparan contra esa proyección. Cuando divergen, la
aplicación **te ofrece** recalibrar — nunca lo hace en silencio.

Todo vive en tu navegador: sin backend, sin cuentas, sin build y **sin una sola petición de red con tus datos**.

**En marcha:** <https://motifyer.com>

> **Estado:** v1 completa (M0–M7 cerradas) · **Última revisión:** 8 de agosto de 2026 · Proyecto personal.
> Las proyecciones se basan en tasas medias de la literatura científica: no son consejo médico ni nutricional.

---

## Cómo ejecutarlo

Necesita un servidor local: la aplicación usa **módulos ES nativos**, y el doble clic sobre `index.html` no
funciona (el navegador bloquea los módulos sobre `file://`).

```bash
npm run serve        # http://localhost:8080
```

Sin dependencias de runtime que instalar: Chart.js va vendorizado en `vendor/`. Las devDependencies
(`typescript`, `@playwright/test`) solo hacen falta para los tests.

```bash
npm test             # 445 tests unitarios (node:test) — motor y datos, sin navegador
npm run typecheck    # tsc --noEmit sobre TODO src/
npm run e2e          # 81 tests Playwright, bajo la CSP de producción
npm run sw:bump      # sube CACHE_VERSION tras tocar algo precacheado
```

## Qué hay dentro

```
index.html                  carga css/ y src/main.js (type="module")
sw.js                       service worker: precache de 64 entradas, la app abre sin red
vendor/chart.umd.min.js     Chart.js fijado y servido en local (CSP 'self' + offline)
css/tokens.css              ÚNICA fuente de color, espaciado, tipografía y radios
src/core/                   el motor: puro, sin DOM, importable desde Node
src/data/                   almacén, esquema, migración v4→v5, backups, multiperfil, fotos
src/i18n/                   es / en; ningún literal visible vive fuera de aquí
src/ui/                     router, componentes y las once vistas
src/ui/views/_manifest.js   fuente única de qué vistas hay: main.js y los tests beben de aquí
test/                       unitarios (node:test) + e2e (Playwright)
docs/                       auditoría HISTÓRICA de la v3.1/v4.0 — no describe este código
legacy/                     la v4.0 congelada, solo lectura
```

## Cómo funciona, en una página

1. **Onboarding en cuatro pasos** recoge perfil, composición actual y objetivo, con vista previa del plan en vivo.
   Si el objetivo es inalcanzable, lo dice antes de crear nada.
2. **El motor** (`src/core/`) calcula BMR (Mifflin-St Jeor), TDEE semanal con adaptación metabólica, y reparte el
   camino en fases cuya duración se deriva de la pérdida esperada y la equivalencia energética (~7 700 kcal/kg de
   grasa). Cada constante lleva su fuente citada en el JSDoc.
3. **La proyección** emite tres escenarios coherentes (pesimista ≤ esperado ≤ optimista) que cierran el mismo día:
   lo que deforman es el TIEMPO, no el destino. De ahí salen las ventanas de fecha de cada hito.
4. **Los check-ins** se comparan contra la proyección del día. Si la desviación sostenida supera la tolerancia, la
   aplicación ofrece recalibrar y guarda el plan anterior en el historial.

**El músculo se mide en la unidad de tu báscula.** Si tu báscula de bioimpedancia te da «masa muscular», eso no es
músculo esquelético: es la magra menos el hueso, un ~5 % más. Confundir las dos cantidades fue el defecto que
hundió la v4.0. El motor habla solo de músculo esquelético y la traducción vive en un único sitio
(`src/ui/muscle-units.js`), en la frontera de la interfaz.

## Datos y privacidad

- Todo se guarda en **`localStorage`** de tu navegador (las fotos, en **IndexedDB**), con namespace por perfil.
- **Cero peticiones de red con tus datos.** No hay API, ni analítica, ni fuentes remotas. La CSP es
  `default-src 'self'` sin `unsafe-inline`, y toda la suite E2E corre bajo ella.
- Se guarda **sin cifrar**: evita usar la aplicación en un ordenador compartido.
- **Exporta e importa** tus datos en JSON desde Ajustes. El import valida el esquema y sanea todo el texto.
- Borrar los datos del sitio en el navegador los borra para siempre; no hay copia en ningún servidor.

## Estado del código

| | |
|---|---|
| Tests | **445** unitarios + **81** E2E, en CI a cada push |
| Tipos | `// @ts-check` + JSDoc, `tsc --noEmit` limpio sobre **todo** `src/` |
| Motor | 7 invariantes con nombre (identidad, conservación, límites, determinismo, cierre de plan, coherencia energética, escenarios) |
| Accesibilidad | AA como objetivo; teclado, focus-trap, contraste y reflujo a 320 px verificados en navegador |
| Lighthouse | escritorio **100/100/100/100** · móvil **99–100/100/100/100** |
| Offline | PWA instalable; abre y se recorre entera en modo avión |

Lo que **no** está cubierto y conviene saber: la verificación en un móvil físico con Safari en iOS. La suite
comprueba el modo avión con un navegador automatizado, pero otro motor y la app instalada son otra cosa.

## Documentación

- **`CLAUDE.md`** — convenciones e invariantes del proyecto. Es la fuente de verdad de cómo se trabaja aquí.
- **`PLAN-V5.md`** — milestones, decisiones cerradas, bitácora y BACKLOG.
- **`docs/RELEASE-V5.md`** — checklist de release y guion de humo manual.
- **`docs/`** (el resto) — **auditoría histórica de la v3.1/v4.0**. No describe este código: sus rutas `js/…` no
  existen. Sigue siendo el mapa de minas del port, y por eso no se borra.

## Stack

Vanilla JS con módulos ES nativos. **Sin framework y sin bundler**, a propósito: el coste es necesitar un servidor
local para desarrollar; la ganancia es que lo que se lee en `src/` es exactamente lo que ejecuta el navegador.

Runtime: Chart.js 4.5.1 (vendorizado). DevDeps: `typescript`, `@playwright/test`. Nada más.

## Licencia

MIT — ver [LICENSE](LICENSE).

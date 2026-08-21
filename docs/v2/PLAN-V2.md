# TransformLab v2 — el planificador integral

> **Estado:** planificación (8 de agosto de 2026) · **Base:** v1 cerrada (M0–M7),
> desplegada en https://motifyer.com · **Este documento sustituye a `PLAN-V5.md`
> como plan de trabajo activo para la v2.** `PLAN-V5.md` queda como bitácora de la v1.

Este plan lo produjo una investigación con evidencia: cuatro agentes peinando a los
competidores por dominio (MacroFactor, Cronometer, Carbon, Eat This Much, Mealime,
Paprika, RP Hypertrophy, Fitbod, JEFIT, Examine, Whoop/Oura…) y tres mapeando qué del
código de la v1 se reutiliza, confluyendo en un diseño modular. Las decisiones y los
prompts de construcción están en `docs/v2/prompts/`.

---

## 1. Qué es la v2, en una frase

Introduces tus datos y tu objetivo, la app te hace **todas** las preguntas necesarias
para configurarlo bien, y traza el plan **más optimizado y más integral posible** —
nutrición, lista de la compra, recetas, suplementación efectiva, entrenamiento y
descanso, pasos— reflejándolo de forma unificada. La gráfica muestra el avance
día/semana/mes en lo general (peso, % grasa, masa muscular) **y músculo a músculo**,
según el planteamiento de entrenamiento óptimo y los checks reales de peso × repeticiones.

Arquitectura: **modular, cada módulo con la máxima profundidad**, componiéndose en un
solo plan.

## 2. El veredicto honesto (qué se puede prometer y qué no)

Un motor **local, sin backend y sin IA de red** puede sostener honestamente todo lo que
pide la visión —pero como **heurística determinista y documentada, nunca como "IA"**. Es
la misma disciplina de la v1: fórmulas con fuente citada, ofrecer recalibrar en vez de
corregir en silencio, y separar lo medido de lo estimado.

**Lo que SÍ se sostiene, cada pieza con fuente:**

- **Gasto energético dinámico** estilo MacroFactor, pero *más honesto que MacroFactor*:
  su filtro es propietario y no lo publican; el nuestro enseña la fórmula —balance
  energético invertido, `TDEE ≈ ingesta_media − Δtendencia_peso · 7700 kcal/kg` sobre
  ventana móvil— y **ofrece** recalibrar (B9), nunca en silencio.
- **Macros como bandas** (proteína por kg de magra, grasa como suelo %, carbo el resto):
  ya vive en `src/core/nutrition.js`.
- **Generador de menú** por optimización combinatoria (bin-packing contra las bandas;
  duras = alergias/suelos, blandas = preferencias/coste), determinista con la semilla del
  perfil. Es un *solver*, no un modelo.
- **Volumen por músculo** con landmarks MV/MEV/MAV/MRV (Israetel/RP) como parámetros con
  fuente, dosis-respuesta logarítmica y deload por reglas.
- **Suplementación** con nivel de evidencia honesto (Examine/ISSN), selector por reglas y
  cribado de seguridad.
- **Pasos → kcal** como palanca, sin doble conteo con el multiplicador de actividad.
- **Techo de volumen por recuperación** derivado de las preguntas de sueño/estrés que el
  check-in **ya** recoge.
- **Base de alimentos** de dominio público (USDA FoodData Central / NCCDB), empaquetada y
  servida en local (CSP `'self'`, PWA offline).

**Los límites, dichos por su nombre:**

- **Nada de "IA".** No hay modelo; venderlo así sería la caja negra que el propio estudio
  de competidores manda evitar.
- La **proyección músculo a músculo es una ESTIMACIÓN con banda** —una desagregación del
  presupuesto global de músculo repartido por estímulo—, **no una medición**. Comunicarla
  como certeza repetiría a escala fina el defecto de las dos definiciones de músculo que
  hundió la v4.0. El invariante `suma_por_grupo = global` es el cortafuegos.
- **Micronutrientes** solo hasta donde llegue la base empaquetada, con su cobertura
  visible. Sin consultas de red.
- **Recuperación** sin wearable se infiere de preguntas (más grueso que HRV). El wearable
  es opcional, nunca obligatorio, y choca con «cero red / sin cuenta».
- Ninguna recomendación **médica**. Y jamás confundir la «masa muscular» de una báscula
  con músculo esquelético: la aduana E11 (`src/ui/muscle-units.js`) se extiende a cada
  superficie nueva, también a la de grupo muscular.

## 3. Por qué esto y no otra app (la diferenciación, con evidencia)

- **Nadie une gasto adaptativo + músculo a músculo + composición corporal en un plan
  único.** MacroFactor es solo nutrición; Fitbod solo entreno; Examine solo informa.
  TransformLab ya tiene el motor de fases y de composición: puede componerlos.
- **Sin cuenta ni red.** El onboarding puede pedir peso, fotos y % graso sin la fricción
  del registro ni la desconfianza de subirlos a un servidor. Argumento de venta directo
  frente a las siete apps de referencia, todas SaaS con login.
- **Recalibración honesta y explicable.** En vez de «ajustamos en silencio», se muestra
  real vs esperado con banda de escenarios y se **ofrece** recalibrar. Ninguna referencia
  enseña así la incertidumbre.
- **Determinismo con semilla del perfil.** El mismo perfil da el mismo menú/lista/plan,
  reproducible y testeable — y transmite al usuario que el plan no cambia solo.
- **Sin conflicto comercial.** No se vende nada, así que la app puede decir «esto no
  funciona» de un suplemento sin perder margen.

## 4. Los módulos (cada uno, núcleo puro + vista)

Cada módulo tiene su **núcleo puro** en `src/core/` (sin DOM, testeable desde Node, con
invariantes con nombre) y su **vista**. El detalle de construcción de cada uno está en su
prompt (`docs/v2/prompts/`).

| Módulo | Núcleo nuevo | Reutiliza de la v1 |
|---|---|---|
| **Gasto adaptativo** (TDEE dinámico) | `src/core/expenditure.js` | `engine.bmr/tdee/adaptationStep`, `tracking.js`, la métrica kcal de `chart.js`, `KCAL_PER_KG_FAT` |
| **Menús que cuadran macros** | `src/core/menu.js` (solver) | `nutrition.macrosFor/refeedMacros/splitIntoMeals`, colección `nutrition`, `rng.js` |
| **Alimentos, recetas y despensa** | `src/core/foods.js` + `src/data/foods-db.js` | `photos-db.js` como molde exacto de IndexedDB, combinadores de `schema.js` |
| **Lista de la compra** | `src/core/shopping.js` (puro) | `dom.js`, patrón export de `backup.js`, `dates.js` (caducidades) |
| **Suplementación** | `src/core/supplements.js` (catálogo + selector) | patrón catálogo-JSON i18n de `milestones.js`, `PhaseType` |
| **Entreno por músculo + recuperación** | `src/core/training-plan.js` | `training.js` íntegro, `src/data/training.js` (22 tests), métricas subjetivas del check-in |
| **Pasos / NEAT** | `src/core/steps.js` | `KCAL_PER_KG_FAT`, la métrica kcal, `expenditure.js` |
| **Proyección músculo a músculo** | `src/core/muscle-groups.js` | `generator.js` (`muscleKg`, band, `SCENARIO_PROGRESS_EXPONENTS`), `muscle-units.js`, `timeline.js` |

**Invariante estrella de la proyección músculo a músculo** (`test 'reparto'`, análogo a
`conservacion`): la suma de las series por grupo reconstituye **exactamente** el
`muscleKg` global de cada día. Es una desagregación, no un segundo cálculo — el eje
agregado sigue siendo la única fuente de verdad.

## 5. El onboarding profundo (configurarlo todo sin abrumar)

Graduado por **una** pregunta de «cuánto control quieres» (Coached / Collaborative /
Manual, estilo MacroFactor) que decide cuánta profundidad se muestra, sin bifurcar en
apps distintas: el motor ya tiene defaults sensatos en `ranges.js` y `constants.js`, así
que un principiante contesta ~5 preguntas y un experto refina 20+, **sobre el mismo
engine**.

- **Valor antes de pedirlo todo:** reutiliza el preview en vivo de M3 (el formulario nunca
  se reconstruye al teclear; solo se refrescan preview y mensajes), extendido a
  plan/menú/volumen.
- **El TDEE arranca de la fórmula como semilla** y el módulo de Gasto lo **sustituye** por
  el medido cuando hay ~14 días de registros — nunca se fija una sola vez (el pecado de
  MyFitnessPal).
- **Por bloques de módulo**, plegables, solo los que el usuario active; el bloque núcleo
  (antropometría + objetivo + actividad, ya existe) es obligatorio. Cada bloque enmarcado
  con su **por qué**. Barra de progreso visible.
- Jerarquía de restricciones: alergias/suelos **duros**, preferencias/coste/micros
  **blandos**, para que el solver del menú tenga siempre solución.
- Nunca un default destructivo ante error (H-013/D9). La pregunta de músculo deja claro
  **qué** mide (esquelético vs báscula), con la aduana E11 en la frontera.

## 6. Modelo de datos: lo PRIMERO, el versionado

**Antes de añadir una sola colección**, cerrar el precipicio de versionado (es el riesgo
más grave de la v2):

- `SCHEMA_VERSION` está **duplicado** en `schema.js:19` y `storage.js:17` → fuente única.
- `rootValidator` (`schema.js:237`) **rechaza** todo objeto con `schemaVersion != 5`, y
  `backup.js:130` rechaza backups `!= 5`. El día que la v2 suba a 6, **todas** las
  colecciones persistidas fallan validación y degradan a `makeDefault` → **pérdida
  silenciosa de los datos del usuario.** Hace falta un **migrador por-colección v5→v6**
  que corra al leer una versión anterior, con la disciplina export-antes-de-transformar
  que ya usa `migrate.js`, y compatibilidad hacia atrás en el import de backup.

Después, lo demás es barato porque la v1 lo dejó preparado:

- Colecciones nuevas **estructuradas** → una entrada en `COLLECTIONS` (`schema.js:480`)
  con `{validate, makeDefault}` usando los combinadores existentes; quedan cubiertas
  **solas** por la siembra de perfil, export/import, presupuesto de cuota y namespace.
  Cada repositorio nuevo es hermano de `checkins.js`/`training.js`.
- Lo **voluminoso/binario** → IndexedDB calcado de `photos-db.js`: la base de alimentos
  (compartida entre perfiles, la única cosa no-namespaced) e imágenes de recetas.
- **Cuota:** 5 MB compartidos por ≤10 perfiles no aguantan un plan integral para una
  familia. La base de alimentos va **fuera** del presupuesto por perfil (IndexedDB
  compartida); los logs pesados a IndexedDB; el **menú generado se regenera, no se
  persiste** (misma disciplina que la proyección).

## 7. Milestones (orden de construcción)

Cada uno es entregable y verificable por sí mismo. Ritmo v1: una milestone a la vez,
tests + typecheck en verde antes de cada commit, **ataque adversarial con refutador al
cierre de cada una** (encontró 9/9 bugs reales en E11, 2/2 en E12, 16/16 en M7 —
siempre en las costuras que los invariantes no ven).

| # | Título | Entrega | Depende de |
|---|---|---|---|
| **V2-M0** ✅ | Datos y versionado | Fuente única de `SCHEMA_VERSION`, migrador por-colección v5→v6, compat. en backup, andamiaje de IndexedDB. **Cero pérdida de datos al subir a v6.** | — |
| **V2-M1** ✅ | Gasto adaptativo + registro de ingesta | `expenditure.js`, colección `intakeLog`, oferta de recalibrar calorías desde el gasto medido | M0 |
| **V2-M2** | Alimentos y recetas (BD local) | `foods-db.js` (IndexedDB), `foods.js` (buscador puro), CRUD de recetas y despensa | M0 |
| **V2-M3** | Menú que cuadra macros | `menu.js` (solver determinista contra bandas, duras/blandas) | M2 (+M1) |
| **V2-M4** | Lista de la compra + despensa | `shopping.js` (consolidación pura por pasillo, descuenta despensa) | M3 |
| **V2-M5** | Suplementación | `supplements.js` (catálogo con evidencia + selector + cribado) | M0 |
| **V2-M6** | Entreno por músculo + recuperación | `training-plan.js` (landmarks por grupo, volumen, deload, techo por recuperación) | M0 |
| **V2-M7** | Pasos / NEAT | `steps.js` (pasos→kcal sin doble conteo) | M1 |
| **V2-M8** ✅ | `chart.js`: singleton → factoría | `createChart(canvas)` con estado por instancia; dos gráficas conviven | — (tras M0) |
| **V2-M9** | Proyección músculo a músculo | `muscle-groups.js` (invariante suma=global) + rejilla de small multiples con banda | M6 + M8 |
| **V2-M10** | Onboarding profundo + plan integral | asistente graduado por bloques con preview; vista integral por capas y por «hoy» | M1…M9 |

## 8. Riesgos (los que hay que vigilar de cerca)

1. **Versionado** — subir a v6 sin migrador pierde todo en silencio. V2-M0 lo blinda.
2. **Cuota** — 5 MB no aguantan un plan integral familiar. IndexedDB para lo pesado.
3. **Singleton de `chart.js`** — dos gráficas fallan en silencio; la rejilla es imposible
   hasta la factoría (~150–250 líneas, red de seguridad E12-0 re-apuntada).
4. **Honestidad músculo a músculo** — estimación con banda, nunca medición. Invariante
   suma=global. Trampa: mapear grupos finos del catálogo estético (braquiorradial…) a los
   gruesos de los landmarks (espalda, pecho…).
5. **Solver sin solución** — demasiadas restricciones duras a la vez dejan el menú sin
   solución factible. Jerarquizar duras vs blandas.
6. **Recalibración descoordinada** — calorías, volumen y gasto pueden ofrecer recalibrar a
   la vez. Necesita una superficie única (extender `tracking.js`), siempre ofrecida.
7. **El pendiente decidido de la v1** — «recalibrar conserva el músculo también en
   perfiles `estimated`» (decidido el 8 ago) **cambia la duración de los planes ya
   creados**; aterrizarlo junto al módulo de músculo (V2-M6/M9) y avisar del cambio.

## 9. Decisiones de producto abiertas (para el dueño, antes de programar cada bloque)

Están en el prompt de cada milestone que las toca. Las de fondo:

- **Onboarding:** ¿graduación Coached/Collaborative/Manual? ¿Qué módulos vienen activos
  por defecto vs opt-in?
- **Registro de ingesta:** el gasto dinámico lo exige. Sin red no hay código de barras
  online → búsqueda en base local o entrada manual. ¿Cuánta fricción es aceptable?
- **Base de alimentos:** ¿USDA FoodData Central o NCCDB? ¿Qué tamaño de subconjunto?
  ¿Micronutrientes estilo Cronometer en la v2 o después?
- **Grupos musculares:** ¿8 o 12 en la rejilla? ¿Cómo se mapea el catálogo fino sobre los
  landmarks gruesos?
- **A11y de la rejilla:** ¿una región `aria-live` por gráfica (ruidoso), una «gráfica
  enfocada» con un solo readout, o una tabla de datos alternativa?
- **Pasos:** ¿solo manual, o lectura de Apple Health/dispositivo (choca con «cero red /
  sin cuenta»)?
- **Bump de esquema:** ¿salto duro v5→v6 con migrador (recomendado, por disciplina), o
  añadir colecciones sin subir versión?
- **Persistir el menú** o regenerarlo de forma determinista (recomendado: regenerar, por
  cuota).
- **Marca/dominio:** ¿la v2 continúa en `motifyer.com` con la marca TransformLab?

## 9.bis. Fricción medida (una sonda implementó 4 features de v2 de verdad)

Antes de escribir este plan, cuatro agentes implementaron **de verdad**, cada uno en su
worktree, cuatro funcionalidades plausibles de v2 —perímetros corporales, comparar dos
perfiles, tema claro, y deep-links en la URL— y se midió dónde dolía. Las cuatro salieron
en verde (unitarios, typecheck y E2E bajo la CSP). **El dato más elocuente: nadie tocó un
solo módulo de `src/core/`.** Toda la fricción estuvo en `src/ui/` y en la fontanería.
Veredicto: **el código está listo para crecer.** Lo que la sonda destapó, verificado
ejecutando, y ya repartido por los milestones:

- **`chart.js` singleton — el único bloqueo de verdad (→ V2-M8).** Dos agentes chocaron; uno
  lo resolvió indexando el estado por `HTMLCanvasElement` en un `Map`, el otro lo esquivó
  duplicando 108 líneas. Con dos lienzos, el primero quedaba en 300×150 px y **cero píxeles
  opacos**, `draw()` devolvía `true` las dos veces, sin un error de consola, y la región
  `aria-live` describía una gráfica que ya no existía.
- **`storage.get()` solo habla del perfil ACTIVO (→ nota en V2-M0).** Comparar perfiles, o
  cualquier lectura cruzada, necesita una primitiva `getForProfile(pid, key)` que lea otro
  namespace **sin** cambiar el activo (hoy hay que hacer malabares con `setActiveProfile`,
  justo lo que abrió la fuga entre perfiles de M7). Añadirla en V2-M0.
- **`plans.load()` hace dos cosas (carga Y fija el activo), así que no se puede llamar dos
  veces (→ nota en V2-M0).** Separar «cargar el plan de un perfil» de «fijarlo como activo».
- **`chart.js` solo sabe dibujar un `Projection` (→ relevante a V2-M9 y a la vista de
  Medidas).** No hay forma de trazar una serie medida arbitraria; la sonda añadió una
  primitiva `chart.drawSeries`. La factoría de V2-M8 debe exponerla.
- **`sw.js` + `sw.lock.json` colisionan en el 100 % de las ramas paralelas.** Los cuatro
  agentes ejecutaron `npm run sw:bump` y los cuatro obtuvieron `tl-v5-0033` (el bump es un
  contador sobre el lock de partida). Fusionar dos ramas da conflicto irresoluble eligiendo
  un lado, porque `precacheHash` depende del contenido combinado. **Opción buena** (una
  tarde): derivar `CACHE_VERSION` del `precacheHash` en vez de de un contador, y el valor
  deja de depender del orden. **Mínimo:** reejecutar `sw:bump` tras cada merge que toque
  `PRECACHE` — anotado en `CLAUDE.md` §6.
- **`playwright.config.js` fija los puertos 8081/8082** (y `dom-security.spec.js` cablea el
  8082), así que no se pueden correr los E2E de dos worktrees a la vez. Leer los puertos de
  variable de entorno con esos valores por defecto devuelve el paralelismo. Pendiente.
- **`_manifest.js` y los diccionarios i18n son puntos de anexión compartidos.** No es un
  defecto —es el precio correcto de tener fuente única— pero garantiza conflictos de texto
  triviales al trabajar en paralelo: **ordena las fusiones de la v2, no las hagas
  simultáneas.**

Ya arreglado de la lista: el duplicado de iCloud que ponía `npm test` en rojo
(`test/helpers/tree.js`, filtro en los seis recorridos del árbol).

## Bitácora de la v2

**V2-M8 cerrada (2026-08-08).** `chart.js` deja de ser un singleton:
`createChart()` devuelve una gráfica con SU estado (instancia, cursor, unidad de
músculo, métrica de anuncio). Sigue compartido lo que debe serlo — el cargador
del vendor, que pide Chart.js una vez aunque haya doce gráficas, el caché de
tokens y las funciones puras. `plan-chart.js` guarda una instancia por lienzo en
un `WeakMap` (no un `Map`: al descartar el router el elemento de la vista, la
instancia se recolecta sola) y la devuelve para que la vista mueva el cursor,
la ventana o pida el PNG.

**La evidencia, reproducida antes de tocar nada:** tras dibujar la segunda
gráfica, el primer lienzo quedaba en **0 píxeles pintados y ancho 300** —
Chart.js lo había reseteado— mientras el segundo tenía 57 508. Y las DOS
llamadas a `draw()` devolvieron `true`, sin un error de consola. La región
`aria-live` del primero seguía describiendo una gráfica que ya no existía.

La red de seguridad E12-0 (`test/ui-chart.test.js`, 16 tests) se re-apuntó a la
factoría con una instancia fresca por test, y `test/e2e/chart-factory.spec.js`
añade lo que el singleton hacía imposible: dos gráficas conviviendo con sus
píxeles, cursores independientes, y las vistas de la v1 dibujando igual.

**497 unitarios · 85 E2E · typecheck limpio.**

**V2-M1 cerrada (2026-08-08).** `src/core/expenditure.js` reconstruye el gasto
real del balance energético invertido, sobre la TENDENCIA del peso (media móvil
de 7 días) y no sobre pesadas sueltas. La vista «Gasto» enseña **la cuenta
entera**, no un número: ingesta media, cambio de tendencia, días y equivalencia
energética, de modo que el usuario pueda rehacerla con una calculadora. Cuando
el gasto medido diverge más de 150 kcal/día del de fórmula, se OFRECE recalibrar
(B9). Colección `intakeLog` con su repositorio, hermano de `checkins.js`.

**Un sesgo real que cazaron los tests**: los primeros puntos de la media móvil
tienen la ventana incompleta, así que su valor representa un centro distinto y
el Δ de tendencia abarcaba menos días que el divisor — 2 523 kcal donde la
aritmética a mano da 2 550. Se descartan los puntos de ventana parcial.

**Y un defecto en `storage.js` que salió por la puerta de al lado**: sustituir el
almacén entero no subía la revisión, así que una caché de colección seguía
sirviendo los datos del almacén anterior. Es la fuga entre perfiles de M7 por
otro camino. La comprobación va ahora en `revision()`, no solo en `backend()`,
porque los llamantes leen la revisión ANTES de pedir el dato.

Verificado en navegador con 35 días de datos: 2 200 kcal/día de ingesta y −2 kg
de tendencia en 28 días dan 2 750 kcal/día, la cuenta exacta.

**V2-M0 cerrada (2026-08-08).** El esquema sube a 6 con cero pérdida de datos.
`SCHEMA_VERSION` vive ahora en `src/data/version.js`, en un solo sitio, con test
que lo vigila. `src/data/migrations.js` migra en dos capas: en memoria
(`migrateValue`, pura, la llama `validateCollection` para que cualquier lectura
funcione aunque el almacén no se haya migrado) y en el almacén (`migrateStore`,
una vez al arrancar, con copia de seguridad previa y **sin borrar nunca** el
origen). Registradas las siete colecciones de la v2, `getForProfile` para leer
otro perfil sin cambiar el activo, `foods-db.js` andamiado, y los backups de v5
ya se importan en vez de rechazarse.

**Dos defectos que solo aparecieron al abrirlo en el navegador**, con todos los
tests en verde:

1. **El índice de perfiles se quedaba en la versión vieja.** No es una colección
   de `COLLECTIONS`, así que lo copiaba tal cual — pero sí lleva `schemaVersion`
   y `validateProfilesIndex` lo exige. Resultado: todos los datos migrados
   correctamente, `readIndex()` devolviendo `profiles.indexCorrupt`, y la
   aplicación pintando un estado de error. Ningún test unitario lo tocaba porque
   el fixture del índice no llevaba `schemaVersion`.
2. **La migración se repetía en cada arranque.** Como no borra el origen,
   `needsMigration()` decía «sí» siempre: cada carga rehacía el bucle y
   **reescribía la copia de seguridad**, machacando la del día de la migración
   real. Cerrado con un testigo `tl.migrationDone.v5`.

Los tests de la v1 que fijaban el `5` a mano se reescribieron contra
`rootPrefix()` y `SCHEMA_VERSION`, así que el próximo bump no volverá a
romperlos. **473 unitarios · 82 E2E · typecheck limpio.** Verificado en
navegador con un usuario v1 completo: aterriza en su dashboard («Día 99 de 208»)
con sus cuatro check-ins y sus ajustes intactos.

## 10. Cómo se trabaja la v2

Igual que la v1 (CLAUDE.md §7): una milestone a la vez y en orden; cualquier idea fuera de
la milestone activa va al BACKLOG y **no** se implementa; tests e invariantes en verde y
typecheck limpio antes de cada commit; `npm run sw:bump` si se toca algo precacheado;
ataque adversarial con refutador al cierre; bitácora de 2–4 líneas por sesión. La
definición de «hecho» de CLAUDE.md §8 aplica sin cambios.

## 11. Bitácora de la v2

### V2-M2 · Alimentos, recetas y despensa — cerrada el 2026-08-08

Base de alimentos construida y empaquetada: **2 000 alimentos, 338 KB crudos /
56 KB gzip**. Dos capas con procedencia explícita en el campo `src`, análogo a
`muscleSource` (A3): **56 genéricos** de USDA FoodData Central (CC0), con nombre
español escrito a mano, que cubren el fresco; y **1 944 productos Hacendado** de
Open Food Facts (ODbL), obtenidos con `tools/build-food-db.mjs`.

Lo que la investigación dejó cerrado, y sostiene el diseño:

- **La API de Mercadona no publica macronutrientes.** No es que sean difíciles
  de extraer: el dato no existe en el origen, lo que invalida de paso todos los
  «datasets de Mercadona» que circulan. La vía honesta es cruzar por marca con
  Open Food Facts.
- **BEDCA está descartada por licencia**, no por estar caída: exige autorización
  escrita y prohíbe modificar los datos — normalizar a JSON ya es modificarlos.
- **La API de OFF tiene techo duro de 1 000 resultados por consulta.** Los
  11 581 Hacendado no caben en una; se trocea por categoría, y cada rodaja tiene
  su propio techo. Su 503 es intermitente y llega como HTML, así que hay que
  mirar estado Y content-type, y reintentar.
- **Es un saneador, no un importador.** La criba (rango de kcal + Atwater ±35 % +
  nombre no vacío + macros completos) descartó el **10 %** de lo descargado:
  93 con macros incompletos, 75 sin nombre, 74 incoherentes con Atwater, 9 con
  kcal imposibles.

Obligación ODbL cumplida en dos sitios: `vendor/data/foods.LICENSE.md` y el array
`sources` **dentro del propio `foods.json`**, para que la atribución viaje con
los datos. El código MIT no queda contagiado (*Produced Work*, ODbL §4.5b). No se
empaquetan imágenes de OFF: son CC BY-SA y esas sí contagiarían.

Invariantes con nombre, todos en verde: `solo_verificado` (únicamente `usda` y
`off` alimentan cálculos; lo del usuario se registra y se declara, no se suma),
`saneado` (comprobado de forma **independiente** en el test, rehaciendo Atwater a
mano y no llamando a la misma función que construyó el fichero — si no, el test
solo diría que el constructor se aplicó a sí mismo), `agregacion_conserva` (la
cantidad total por alimento y unidad no cambia al fusionar; unidades distintas
NO se fusionan, porque 200 g y 2 unidades de tomate no se pueden sumar) y
`cobertura_declarada`.

Tres defectos propios encontrados y cerrados durante la etapa:

1. **`foods-db.js` no tenía `close()`**, y la conexión a IndexedDB está cacheada
   en el módulo: dos tests seguidos compartían la base del anterior y el segundo
   pasaba por lo que había dejado el primero. `photos-db.js` ya tenía ese
   `close()` por la misma razón.
2. **El mock de IndexedDB mentía en tres puntos**: `keyPath` cableado a `'id'`
   (los registros del almacén de metadatos se guardaban todos bajo `undefined`),
   sin `oncomplete` de transacción (un `putAll` no habría resuelto nunca), y sin
   rama de subida de versión (el salto 1→2 no se ejercitaba).
3. **`src/data/foods-db.js` estaba dos veces en `PRECACHE`** tras la edición.

Un test mío estaba equivocado, no el código: daba por hecho que el almacén
saneaba el markup. No lo hace ni debe: escapar es trabajo de `escapeHtml` en el
render (F6), y sanear también en el almacén daría falsa seguridad.

**553 unitarios · 94 E2E · typecheck limpio.** Verificado en navegador a 320 px:
la base se siembra, la búsqueda no roba el foco al escribir, la procedencia se ve
en cada fila y no hay desbordamiento horizontal.

## 12. BACKLOG de la v2

Ideas surgidas fuera de la milestone activa. **No se implementan** hasta que les
toque (CLAUDE.md §7).

- **Proyección sigue sin enseñar los hitos estéticos ni los de salud.** E14-3 los
  llevó al lienzo de Analizar, no al de Proyección. Ahí los hitos del motor ya se
  dibujan como PUNTOS SOBRE LA LÍNEA, con su propio camino de clic y tres
  contratos de test posicionales colgando de él (`clickDatasetIndex`, «los hitos
  son el último dataset», `pointStyle === 'rectRot'`). Añadir el carril encima
  dejaría **dos mecanismos de hito en una misma vista**, que es justo el patrón
  que este proyecto persigue; y sustituir los puntos por el carril rompe los tres
  contratos a la vez. La salida limpia es unificar en el carril y reescribir esos
  contratos, y eso es una tarea propia, no una nota al pie de otra.

- ~~**`num()` formatea con punto decimal en español.**~~ **HECHO** el
  2026-08-08, ver §13.
- ~~**`CACHE_VERSION` debería derivarse de `precacheHash`**~~ **HECHO** el
  2026-08-09 (E13-11): la versión es `tl-<12 hex del hash>`, `sw:bump` es
  idempotente, y el test del candado exige que la versión sea exactamente la
  derivada — escribirla a mano no compila en verde.
- ~~**Nombres basura en el catálogo de OFF.**~~ **HECHO** el 2026-08-09
  (E13-13). Se confirmó midiendo lo que el propio punto sospechaba: no hay
  regla que valga. Lista de bloqueo por id, cinco fichas, cada una con su
  motivo escrito.

- ~~**El peso esperado SALE de su propia banda de escenarios, y el invariante que
  debía impedirlo no lo comprueba.**~~ **HECHO** el 2026-08-09 (E13-8, ver su
  bitácora). Encontrado al escribir los tests de E13-1. Era del motor (M1), y el
  usuario lo VEÍA: la banda se dibuja en Proyección.

  Reproducción exacta (varón, 80 kg, 20 % → 15 % y +2 kg de músculo, semilla 1):

  ```
  días con el esperado FUERA de su banda, por fase:
     adaptation       0/15
     recomposition    8/88
     bulk            14/25     <-- más de la mitad de la fase
     cut              3/4
     transition       0/14
     maintenance      0/30
  ```

  Día 120, en volumen: esperado 77,7050 · optimista 77,6935 · pesimista 77,2572.
  El escenario **optimista gana menos peso que el esperado**, que es
  contradictorio en una fase cuyo objetivo es ganar. Apunta a que la banda se
  deriva de una tasa de pérdida de GRASA aplicada al peso, correcta en déficit e
  invertida cuando el motor del cambio es la ganancia de músculo.

  **Y el vigilante tiene un agujero:** el invariante se llama `escenarios —
  pesimista ≤ esperado ≤ optimista en posición de plan` pero su cuerpo
  (`test/invariants.test.js:178`) solo comprueba que los tres cierran el plan y
  que los números son finitos. **Nunca comprueba el orden que promete su
  nombre.** Es la misma familia que los tres defectos de E13-0: un nombre que
  afirma más que su código. Arreglar el motor sin arreglar antes el invariante
  dejaría el mismo hueco abierto.

### V2-M3 · Menú que cuadra macros — cerrada el 2026-08-08

`src/core/menu.js`: un **solver combinatorio**, no un modelo ni «IA». Recibe las
macros que ya fijó el motor y busca alimentos y gramajes que caigan dentro de sus
bandas. **Nunca recalcula las kcal** (B3): si el plan dice 2 100, el menú rellena
2 100. Jerarquía de restricciones en dos niveles —duras (alergias, dieta, suelo
de proteína) y blandas (lo que no gusta, que penaliza pero no prohíbe)— porque
meterlo todo como duro deja el problema sin solución factible.

Determinista por semilla de perfil + día. El menú **no se persiste**: se
regenera, igual que la proyección. «Otra opción» cambia UNA comida y solo la
acepta si el DÍA sigue dentro de banda y el suelo de proteína se mantiene;
sustituir a ciegas convertiría ese botón en la forma más rápida de romper el plan
sin enterarse.

**Cuatro defectos reales encontrados ejecutando el solver contra la base entera**,
y ninguno se habría visto con cuatro alimentos de juguete:

1. **La grasa se pasaba un 30 %** con las otras tres macros cuadrando al 1 %: el
   aceite se añadía siempre, aunque un salmón o un queso ya cubrieran la grasa.
   Ahora, si no hay hueco, no se añade.
2. **Un solo intento no es un solver.** Con búsqueda local (24 tiradas, se queda
   con la de menor penalización y para en cuanto una cuadra) encuentra
   combinaciones que una sola tirada no ve, y sigue siendo determinista.
3. **`cat` hacía dos trabajos y por eso un vegano recibía gambas.** El pasillo
   contesta «dónde está en la tienda»; la dieta necesita «de qué viene», y unas
   gambas peladas están en CONGELADOS. Es exactamente el patrón que hundió la
   v4.0 con la palabra «músculo». Se separó en un campo `diet`
   (`meat|fish|dairy|egg|plant`), derivado de los alérgenos —campo regulado—
   antes que de las categorías, que las teclea la comunidad. Sin origen conocido,
   una dieta restrictiva excluye.
4. **Menú aritméticamente impecable y gastronómicamente absurdo**: miel de flores
   de fuente de hidratos, postre gelificado de guarnición y caldo cocido de
   verdura. Tres causas y tres arreglos: ordenar por pureza de macro premia a los
   alimentos extremos (→ los genéricos van primero, porque los 56 SON los
   básicos de una cocina); cualquier pasillo valía para cualquier papel (→
   `ROLE_AISLES`); y el sorteo era uniforme sobre 40 candidatos (→ sesgo
   cuadrático hacia la cabeza). Verificado en navegador: «langostino + arroz +
   sandía + aceite de oliva», «ternera + patata + calabacín + almendras».

Y un quinto, de clasificación: la rúcula —26 kcal, 4,3 g de proteína— caía en el
grupo de fuentes proteicas y el solver la ofrecía de plato principal. La verdura
se define ahora por densidad y solo por densidad.

**580 unitarios · 101 E2E · typecheck limpio.**

### V2-M4 · Lista de la compra + despensa — cerrada el 2026-08-08

`src/core/shopping.js`, puro: consolida los ingredientes de siete días de menú,
resta la despensa y agrupa por el pasillo por el que se camina en el súper —no
alfabéticamente, que obliga a ir y volver.

**El invariante `conservacion_de_la_compra` es hermano del `conservacion` del
motor**: para cada alimento, `neededG = pantryUsedG + toBuyG` exactamente, y la
lista contiene los alimentos del menú, ni uno más ni uno menos. Se prueba sobre
un menú generado por el solver real contra los 2 058 alimentos: una lista que
cuadra con dos ingredientes de juguete y se descuadra con cuarenta no vale.

Decisiones que costaron trabajo y valen la pena:

- **El redondeo al alza vive aparte** (`buyRoundedG`). Comprar «237 g de arroz»
  es absurdo y «240» es lo natural, pero redondear sobre el número bueno rompe
  la conservación. Se enseña lo redondeado y se cuadra con lo exacto.
- **El consumo de despensa se lleva por CANTIDAD, no por «bote usado»**. Un bote
  de 500 g del que se gastan 150 conserva 350 para la siguiente línea. La
  primera versión consumía la entrada entera y hacía comprar de más; se
  descubrió con una mutación deliberada del código.
- **Lo que no se puede restar se DICE.** Un artículo apuntado en «unidades» no
  se resta de 250 g sin saber lo que pesa una unidad, y ese dato no lo tenemos:
  va a `unmatchedPantry` y la vista lo explica. A ojo saldría una compra corta.
- **`sortLines` es una función aparte** y no un parámetro de
  `buildShoppingList`: separarlas hace imposible que un criterio de ordenación
  toque las cantidades.

Dos defectos reales encontrados al verificar en navegador:

1. **La lista podía no corresponder al menú que el usuario ve.** Nutrición tenía
   su deslizador de comidas en una variable de módulo y Compra leía
   `preferences`. Ahora el número de comidas se persiste, y ambas construyen el
   mismo menú con la misma semilla.
2. **«Comprar 1 160 g de patata cocida»**, que no se puede hacer. Los genéricos
   cocidos sirven para el diario —uno pesa el arroz hecho— pero no para un menú
   del que sale una compra. Llevan `prep: 'cooked'` y el solver los excluye;
   verificado: cero cocidos en la lista.

Marcar como comprado mete la línea en la despensa **con su `foodId`**, que es lo
que cierra el bucle menú → compra → despensa sin depender de cómo se escriba el
nombre.

**603 unitarios · 108 E2E · typecheck limpio.**

### V2-M5 · Suplementación basada en evidencia — cerrada el 2026-08-08

Catálogo editorial de 12 suplementos (`src/core/data/supplements-catalog.json`,
molde de `aesthetic-catalog.json`) y selector puro en `src/core/supplements.js`.

**La honestidad es la función, no un adorno.** Esta app no vende nada, así que
puede escribir «los BCAA no te hacen falta» y «los quemagrasas son cafeína cara»
— algo que ninguna web que rankee suplementos Y regente la tienda puede
permitirse. Por eso hay tres bloques a la vista y ninguno escondido: lo que
sirve, lo retirado por seguridad, y **lo que se vende mucho y no funciona**.
Ocultar el tercero deja al usuario comprándolo en otro sitio sin saber por qué
no estaba.

**El cribado de seguridad es una restricción DURA**, del mismo rango que la
alergia en el menú: un estimulante contraindicado no se propone atenuado ni «con
precaución», se retira y se dice por qué. La app no sabe nada de la historia
clínica de nadie, así que el único comportamiento defendible es el conservador.
La yohimbina lleva `neverRecommend` y aparece solo para explicar por qué no se
recomienda. `disclaimerKey` viaja **con el resultado del selector**, no en la
plantilla, para que ninguna vista pueda olvidarse de decir que esto no es consejo
médico.

Las dos decisiones que el prompt dejaba abiertas, resueltas: **cribado máximo**
en estimulantes, y **coste en rangos marca-neutrales** con aviso antidopaje
(Informed Sport / NSF) en los dos productos con casos documentados de
contaminación.

Timing de cafeína: 3–6 mg/kg, 60 min antes de entrenar, con corte 8 h antes de
dormir. La aritmética es **modular sobre el reloj**: quien se acuesta a las 02:00
corta a las 18:00 del día anterior, y una resta a secas daba una hora imposible.
Se AVISA del choque; no se cambia nada por el usuario (B9).

Tres defectos propios, los tres encontrados por un test:

1. **El filtro de pertinencia estaba en OR**, así que un criterio no
   especificado daba pase libre y anulaba el otro: pedir la fase de volumen sin
   declarar objetivos colaba el HMB, que es de definición.
2. **El stack salía VACÍO en la fase de adaptación** —la primera de todo plan, y
   la que más gente ve— porque ningún ítem la listaba. La creatina, la proteína o
   la vitamina D no dependen de la fase: limitarlas a tres era un error de
   catálogo, no una decisión.
3. Un bloque JSDoc con `@param`/`@returns` colgaba de una constante en vez de la
   función; y un `import` de `empty` que ya no se usaba (lo pilló el test de
   código muerto de M7-8).

Invariantes: `cribado_duro` (probado bandera a bandera, las diez), 
`evidencia_visible` (todo ítem lleva nivel, fuente, dosis, coste y salvedades en
los dos idiomas) y `selector_determinista`.

**631 unitarios · 117 E2E · typecheck limpio.**

### V2-M6 · Entrenamiento por músculo + recuperación — cerrada el 2026-08-08

`src/core/training-plan.js` (prescripción, progresión y deload) sobre el
`muscle-volume.js` y el catálogo de 556 ejercicios que ya existían. Vista
integrada en Entreno: no una sección nueva de navegación, sino la misma pantalla
contestando qué toca hacer.

**El prompt pedía «solo cuentan los sets del motor primario» y eso está
DELIBERADAMENTE no implementado**, porque sobre el catálogo real produce un
absurdo medible: el peso muerto tiene «lower back» como primario y solo 11 de
556 ejercicios tienen glúteo como primario, así que alguien que sentadillea tres
veces por semana acumularía CERO estímulo de glúteo. El defecto que se temía era
doblar el volumen indirecto; el real es ANULARLO. Se cuenta con pesos —1 el
primario, 0,4 el secundario— y verificado en navegador: una rutina de sentadilla
+ press da **4,8 series efectivas de glúteo**, que con la regla original habrían
sido 0.

Las tres decisiones que sostienen el módulo:

- **Los landmarks no son globales.** Escalan por experiencia y por recuperación
  DECLARADA. La recuperación baja solo el TECHO: el mínimo efectivo no baja
  porque uno duerma mal, porque por debajo de él no hay estímulo y fingir que sí
  lo hay sería mentir en la dirección cómoda.
- **La frecuencia REPARTE el volumen, no lo crea.** Entrenar pecho tres días da
  las mismas series repartidas mejor. Modelarlo al revés hace que la app
  recomiende entrenar más días «para ganar más», que es falso.
- **El deload se dispara por SEÑALES**, nunca por calendario: recuperación baja,
  algún grupo por encima del MRV, o marcas estancadas. Y el silencio del usuario
  no cuenta como señal — quien no rellena las métricas no recibe una descarga
  por callarse. Se OFRECE, no se aplica (B9).

Dos defectos propios, encontrados en navegador con una rutina real:

1. **Prescribía «5,8 series»**, que nadie hace. El volumen MEDIDO es
   fraccionario por diseño; el PRESCRITO no. Se redondea antes de sumar, no
   después, o el decimal se arrastraría semana tras semana.
2. Los textos decían «1 semanas» y «1 repeticiones». Reescritos para no depender
   de concordancia de plural, en vez de montar maquinaria de pluralización.

Y uno ajeno: el E2E de la rutina usaba `.profile-item` sin acotar y pasó a
resolver once elementos al añadirse los diez grupos musculares.

Los invariantes se verificaron con **mutación deliberada del código**: hacer que
la frecuencia multiplique el volumen rompe 3 tests, que el silencio dispare el
deload rompe 1, y que la recuperación baje el MEV rompe 1.

**662 unitarios · 124 E2E · typecheck limpio.**

### V2-M7 · Pasos / NEAT — cerrada el 2026-08-08

`src/core/steps.js` y `src/data/steps.js`, con la tarjeta en la vista de Gasto —
que es donde corresponde, porque los pasos son una **covariable** del gasto
medido, no una pantalla aparte.

**La trampa de este módulo es aritmética y se llama doble conteo.** El
multiplicador de actividad del onboarding YA incluye andar; sumar encima las
kilocalorías de los pasos cuenta lo mismo dos veces e infla el gasto del que
cuelga todo el plan. La solución es `BASELINE_STEPS`: cada nivel de actividad
lleva asociados los pasos que ese estilo de vida ya supone (franjas de
Tudor-Locke), y lo que aporta el podómetro es la DIFERENCIA. Andar exactamente
los pasos de tu nivel aporta cero, y eso es lo que comprueba el invariante
`sin_doble_conteo` — verificado además con **mutación deliberada**: sumar el
bruto en vez del delta rompe 5 tests, y hacer que un nivel desconocido caiga a
cero pasos de referencia rompe 1.

El delta **puede ser negativo, y eso es una función**: quien se declaró activo y
lleva una semana en el sofá está gastando menos de lo que el plan supone, y
saberlo es justo lo que explica que la báscula no baje.

Dos decisiones más:

- **Entrada manual**, y la razón no es pereza: Apple Health y Google Fit no son
  accesibles desde una aplicación web, y cualquier integración por nube exigiría
  cuenta y llamadas de red con datos del usuario. Es la recomendación que el
  propio plan traía.
- **El objetivo diario sale del nivel declarado, no de un 10 000 universal**.
  Esa cifra salió de una campaña de marketing japonesa de 1965, no de un
  estudio, y ponerla de meta a alguien sedentario es fijarle algo que no va a
  cumplir.

La constante (0,04 kcal/paso a 70 kg) se contrastó con la vía MET: 10 000 pasos
≈ 8 km ≈ 96 min a 3,5 MET dan 411 kcal frente a las 400 de la constante. Que dos
caminos independientes coincidan al 3 % es lo que la hace usable; hay un test
que lo comprueba.

Y por tercera vez en la v2, un texto decía «Media de 1 días». Reescrito.

**681 unitarios · 132 E2E · typecheck limpio.**

### V2-M9 · Proyección músculo a músculo — cerrada el 2026-08-08

`src/core/muscle-groups.js` (desagregación pura) y `src/ui/muscle-grid.js` (la
rejilla), integrados en la vista de Proyección.

**ES UNA DESAGREGACIÓN, NO UN SEGUNDO CÁLCULO**, y esa distinción es toda la
milestone. El eje agregado sigue siendo la única fuente de verdad sobre cuánto
músculo se gana; aquí se reparte ese presupuesto ya proyectado entre los diez
grupos en proporción al estímulo que recibe cada uno. **El cortafuegos es el
invariante `reparto`**: la suma de las series por grupo reconstituye EXACTAMENTE
el `muscleKg` global de cada día. Verificado con mutación deliberada: repartir
por porcentajes sin cerrar el residuo rompe 6 tests.

`distributeExactly` cierra el reparto en el último grupo, igual que
`splitIntoMeals` con las comidas. Repartir por porcentajes y redondear cada uno
deja unos gramos de diferencia que, sobre 200 días, se convierten en una
discrepancia visible entre la gráfica global y la suma de las pequeñas.

**El punto de partida se reparte por ANATOMÍA y solo la GANANCIA por estímulo**:
el músculo que ya tienes lo tienes, y no depende de lo que entrenes esta
temporada. Consecuencia directa del cortafuegos y probada: entrenar más pecho no
da más músculo TOTAL, da más pecho y menos de lo demás.

Un defecto propio, encontrado porque un test no cuadraba: **la banda se
calculaba escalando la ganancia final por `t^exp`**, lo que da por hecho que el
músculo se gana de forma lineal en el tiempo. El motor lo modela con fases, así
que la banda salía desplazada justo en el tramo que el usuario mira. Se rehizo
como en `generator.js`: interpolando la propia serie en una posición desplazada.
Y de paso quedó fijado un invariante mejor —**un escenario no puede inventar un
valor que el plan nunca alcanza**— que es lo que garantiza recorrer la misma
serie a otro ritmo.

También hubo que reenunciar `escenarios_por_grupo`: el orden es **en posición de
plan, no en magnitud**, igual que el invariante `escenarios` de la v1. Un plan
con fase de definición hace que el músculo baje en algún tramo, y ahí ir más
adelantado significa tener menos.

Tres decisiones de presentación:

- **SVG en línea, no diez instancias de Chart.js.** Un *small multiple* no
  necesita ejes, tooltips ni cursor de teclado propio, y diez regiones
  `aria-live` competirían entre ellas. La accesibilidad se resuelve donde debe:
  con una **tabla de datos** de verdad, que es lo que un lector sabe recorrer.
- **Unidad: músculo esquelético, NO unidad de báscula**, y es una desviación
  deliberada del prompt. Una báscula mide el cuerpo entero; trasladar su desfase
  a un bíceps concreto le atribuiría a ese músculo el agua y el hueso de todo el
  cuerpo. No convertir es más honesto que convertir mal.
- **Cada serie viaja marcada como estimación** (`estimated: true`) y la rejilla
  lo dice con todas las letras. Nadie mide el músculo de su bíceps en casa.

Y aterriza aquí el **pendiente decidido de la v1**: recalibrar ahora conserva el
músculo también en perfiles `estimated`. E11 lo arregló solo para quien da
cifras de báscula; para todos los demás `muscleKg` se iba a `null` y se
re-estimaba con la proporción de POBLACIÓN, tirando parte de la ganancia que el
propio plan decía haber conseguido. Consecuencia aceptada, como se acordó: los
planes ya creados cambian de duración al recalibrar. El E2E que lo cubre falla
si se quita el arreglo.

Dos defectos de accesibilidad encontrados por los tests, los dos de reflow
(WCAG 1.4.10) a 320 px con el texto al 200 %: la rejilla no encogía por debajo
de su pista mínima (`minmax(min(118px, 100%), 1fr)`) y la insignia «estimación»
heredaba el `nowrap` de `.badge`.

**702 unitarios · 140 E2E · typecheck limpio.**

### V2-M10 · Onboarding graduado + plan integral — cerrada el 2026-08-08

La milestone que convierte siete pantallas en un producto. Tres módulos puros
—`modules.js`, `integrated-plan.js`, `recalibration.js`— y dos piezas de vista
—el bloque de módulos en el alta y `plan-summary.js` en «Hoy».

**Las dos decisiones que el prompt dejaba abiertas, tomadas:**

- **Nutrición y Entreno activos de fábrica; Compra, Suplementos, Pasos y
  Descanso opt-in.** Los dos primeros son lo que usa todo el que se crea un plan
  y ya existían en la v1; los otros añaden preguntas para una minoría. Aparecen
  igualmente como casilla marcada: quien no quiere que le planifiquen la comida
  debe poder decirlo, no encontrarse la sección de todas formas.
- **«Hoy» compacto + vistas por módulo**, como quedó Proyección en E12. Meter el
  menú, la compra, el stack y la rejilla de volumen en la pantalla de inicio la
  devolvería a ser el muro que E12-6 desmontó. Cada módulo aporta UNA línea con
  su estado y su siguiente acción; la profundidad vive en su vista.

**El bloque de módulos vive en el paso de CONFIRMAR**, no en un quinto paso. Así
el usuario los activa con la preview del plan delante y el asistente sigue
teniendo cuatro pasos — un paso más por configurar lo opcional es exactamente
como un alta de cinco preguntas se convierte en una de veinte. Verificado en
navegador: 13 preguntas anunciadas con tres módulos activados en nivel
colaborativo.

**Bajar el nivel de control DESACTIVA los módulos que ese nivel no muestra.**
Dejarlos activos pero invisibles configuraría el producto a espaldas del
usuario, que es justo lo que el nivel de control existe para evitar.

**La recalibración coordinada** es nueva de la v2 y resuelve un problema que la
v1 no tenía: ahora tres fuentes pueden pedir recalibrar. Sueltas producen
bombardeo —tres avisos el mismo día y el usuario aprende a cerrarlos sin
leerlos— y contradicción —«baja calorías» frente a «súbelas», sobre los mismos
datos. La regla de desempate es **de evidencia**: cuando dos fuentes tocan la
misma palanca gana la que se apoya en más datos, así que el gasto medido
(ingesta + peso) desplaza a la desviación (solo peso). Y lo desplazado se
DEVUELVE, no se tira: la interfaz puede decir por qué no salió.

Invariantes: `plan_funcional_con_defaults` (saltarse todo lo opcional da un plan
válido, y ningún defecto es destructivo — en particular **ninguna bandera de
seguridad viene marcada**, porque marcar lo que el usuario no ha declarado le
retiraría suplementos por una suposición nuestra), `recalibracion_unica` (nunca
dos ofertas vivas sobre la misma palanca) y `preview_no_reconstruye` (E2E: se
teclea tecla a tecla y el foco y el cursor sobreviven).

Un defecto propio: un comentario de mi E2E afirmaba que Nutrición y Entreno no
aparecían como casilla. Aparecen, marcadas, y es lo correcto — el test pasaba
porque no comprobaba lo que el comentario decía.

Y otra vez la trampa recurrente de la sesión: el navegador sirvió el
`onboarding.js` viejo desde la caché HTTP y el bloque de módulos no salía. La
lección, ya conocida: **verificar el fuente servido antes de concluir nada**.

**731 unitarios · 150 E2E · typecheck limpio.**

---

## La v2 está terminada

Diez milestones (V2-M0…M10), **731 tests unitarios y 150 E2E**, typecheck
limpio. Todo verificado en navegador a 320 px y desplegado desde `main`.

## 13. Las cifras, en el idioma del usuario (2026-08-08)

Cerrado el punto del BACKLOG. Toda la aplicación escribía «82.8 kg» a un usuario
español, donde se escribe «82,8 kg». No era el descuido de una vista: era
transversal a las doce, y venía de la v1.

**El arreglo tiene DOS sitios, y descubrir el segundo fue el trabajo de verdad.**

1. `src/ui/format.js` pasa de `toFixed` a `Intl.NumberFormat` con el idioma
   activo, cacheando un formateador por (idioma, decimales) —estas funciones se
   llaman dentro de bucles de doscientos puntos— e indexando por idioma porque
   el usuario lo cambia en caliente desde Ajustes.
2. **`i18n.t()` formatea sus parámetros numéricos.** Arreglar solo `format.js`
   NO bastaba: media docena de vistas pasaban el número CRUDO como parámetro
   —`t('volume.sets', { sets: 4.8 })`— y `String()` lo escribía con punto,
   saltándose el formateador sin que nadie lo notara. Se vio en un E2E que
   seguía fallando después del «arreglo». Por `t()` pasa TODO el texto visible
   de la aplicación, así que ahí es imposible saltárselo, y cualquier vista
   futura queda cubierta sin acordarse de nada.

`maximumFractionDigits: 3` y ningún mínimo en la interpolación: no se inventan
decimales que el número no traía —12 sigue siendo «12»— y solo cambia el
separador. Para decimales FIJOS está `format.js`, que es otra decisión y se toma
en la vista.

Se migraron los 20 `toFixed` que quedaban en `src/ui/` y **hay un test que
prohíbe volver a usarlo** fuera de `format.js`. Única excepción, declarada: la
geometría de un SVG, donde el punto decimal es obligatorio —una coma partiría el
camino en dos coordenadas— y que además no es texto que nadie lea.

Un detalle que salió al escribir los tests: **el español NO agrupa los números
de cuatro cifras** (2437, pero 13.000). Es la norma de la RAE y es lo que hace
`Intl`; mis expectativas estaban mal, no el código. Se agradece: «2437 kcal» se
lee mejor que «2.437 kcal».

**737 unitarios · 150 E2E · typecheck limpio.**

---

# E13 · La gráfica se vuelve un instrumento de análisis

La v2 cerró con siete módulos produciendo datos y una gráfica que solo sabe
dibujar **una métrica cada vez**, elegida entre cuatro botones. Hay ~50 series
plotables en el producto y la aplicación deja ver cuatro. El objetivo: superponer
**hasta cuatro series cualesquiera**, con la procedencia de cada una a la vista,
sin que la superposición pueda mentir.

Diez mejoras, en ocho etapas. Decisiones cerradas con el usuario: tope de 4
series · vista propia «Analizar» · los grupos musculares entran como series
etiquetadas de estimación · legibilidad primero.

- [x] **E13-0 · Los tres defectos de datos**
- [x] **E13-1 · Catálogo de series puro + las 3 funciones que faltan**
- [x] **E13-2 · `drawSeries` por extracción + invariante de hitos + precálculo de fases**
- [x] **E13-3 · `drawMulti` + manifiesto + ejes + estilos + paleta**
- [x] **E13-4 · Modo «cambio desde el inicio» + rebase en `setWindow`**
- [x] **E13-5 · Vista «Analizar»: selector, leyenda y procedencia**
- [x] **E13-6 · Lectura accesible con N series, tabla y CSV**
- [x] **E13-7 · Gestos y preset «custom»**
- [x] **E13-8 · La banda de escenarios contiene al esperado (motor)**

## Bitácora

### E13-0 — tres defectos que el usuario sufría, todos de la misma familia

Planificar la gráfica destapó tres defectos reales, y los tres eran **dos sitios
calculando el mismo hecho**. Se arreglan antes de construir nada encima, porque
la etapa entera va a añadir campos a `settings` y el primero de ellos es
exactamente el error de hacerlo mal.

**1. Pérdida de alergias, y es mía.** En V2-M10 añadí `activeModules` a
`preferences` **sin `opt()`**. El comentario que escribí al lado decía
«Opcional: un perfil de la v1 no los tiene» mientras el código lo exigía.
Consecuencia, comprobada ejecutándolo: un registro escrito antes de V2-M10 falla
la validación ENTERA, `get()` degrada a vacío y el siguiente `save()` escribe
encima. El usuario perdía su tipo de dieta y **sus exclusiones duras, que son
alergias**. La regla queda escrita en el esquema: *campo añadido a colección ya
poblada, `opt()` sin excepciones*. Lo vigila `preferencias_antiguas_validan`,
verificado con mutación deliberada (revertir el `opt()` lo pone en rojo).

**2. El interruptor de fluctuación no se guardaba.** `main.js` lo LEE al
arrancar y `onboarding.js` lo escribe a `false`, pero **ningún camino de la
interfaz lo escribía a `true`**: `plan-state.setFluctuation()` solo tocaba
memoria. Se marcaba, se recargaba y volvía apagado. No había dónde escribirlo sin
repetir por cuarta vez el patrón «leer → validar → fundir → validar → escribir»,
que estaba abierto en canal en `reminder.js` con el objeto por defecto **copiado
literalmente en tres sitios**. De ahí sale `src/data/settings.js`: una sola
definición del valor de fábrica y un `patch()` que funde. Ahora se persiste
**después** de regenerar y **solo si** salió bien —guardar un estado que la
gráfica no muestra sería la misma divergencia por el otro lado—, y si la
escritura falla se avisa pero **no se revierte el interruptor**: el usuario lo
pidió y lo está viendo.

**3. La leyenda prometía check-ins que el lienzo no dibujaba.**
`plan-chart.js` devolvía `checkinCount: evaluations.length` mientras el lienzo
filtraba por métrica, y su JSDoc prometía «cuántos entraron en el lienzo». Con
métrica «grasa» y check-ins sin porcentaje, la leyenda listaba «Check-in» y no
había ni un punto. Ahora hay un predicado único, `chart.checkinAppliesTo`, que
usan el lienzo Y el contador. La leyenda además tenía **media condición copiada a
mano** (solo la de báscula): se ha quitado, porque dos copias de una regla es
justo como volvió a divergir.

**744 unitarios · 152 E2E · typecheck limpio.**

### E13-1 — 44 series, y las trampas de unidad convertidas en estructura

`src/core/series-catalog.js` es la fuente única de qué se puede dibujar. Cuarenta
y cuatro specs en ocho grupos, cada uno declarando **una función productora, no
puntos resueltos**: el catálogo tiene que ser enumerable sin datos —el selector
lista las 44 antes de que exista ninguna proyección— y resolver 44 × 1096 puntos
por dibujado sería absurdo cuando se pintan cuatro.

**Lo que de verdad hace este fichero es hacer imposible la confusión que hundió
la v4.0.** El músculo aparece en tres unidades DISTINTAS, y no por pedantería:

| unidad | qué es | rango |
|---|---|---|
| `kgMuscleSkeletal` | lo que produce el motor | 25–45 |
| `kgMuscleScale` | lo que marca una báscula doméstica (magra menos hueso) | 50–70 |
| `kgMuscleGroup` | un grupo suelto | 1,8–7 |

Con un solo id compartirían eje: los diez grupos aplastados contra el suelo, y
lo medido y lo proyectado comparados sin pasar por la aduana. Con tres ids, el
planificador de ejes lo impide solo y **un test puede fijarlo**. Hay uno por
trampa, y los tres se comprobaron con mutación deliberada: cambiar la unidad de
la báscula a esquelética, o la del grupo a global, o el agregado del tonelaje de
suma a endpoint, pone su trampa en rojo.

`provenance` reutiliza el vocabulario de `muscleSource` (`measured`/`estimated`/
`derived`, A3 y E10) más `projected`. No se inventa un eje nuevo, se extiende el
que ya existe. Y los ids usan `_` en vez de `.` para caber en el `SAFE_ID` del
esquema, que es lo que los hace persistibles sin superficie de validación nueva.

Tres funciones que el producto necesitaba y no tenía, cada una en su casa y no
en el catálogo: **`training.e1rmSeries`** (el mejor 1RM de cada DÍA;
`personalRecord` colapsa el histórico entero a un solo esfuerzo, que sirve para
anunciar un récord y no para dibujar una progresión), **`training.tonnageSeries`**
(por FECHA: dos sesiones el martes son un día de entrenamiento) y
**`nutrition.macroSeries`** (criterio único: el día que no resuelve **no produce
punto** — un cero ahí diría «ese día no comes nada», que es una afirmación, no un
hueco).

**Un renombrado que parece cosmético y no lo es.** La banda de escenarios se
llama `pessimist`/`optimist`, no `lower`/`upper`: en una fase de pérdida el
escenario pesimista pesa MÁS que el esperado, así que el «inferior» es el mayor.
Con los nombres numéricos, una leyenda que dijera «entre X e Y» los imprimiría al
revés durante todo el déficit.

**Y un defecto del MOTOR encontrado por el camino, anotado en el BACKLOG y no
tocado aquí** (§7, regla anti-alcance): el peso esperado **sale de su propia
banda** 25 días de 176, concentrados en volumen (14 de 25). Peor: el invariante
que debía impedirlo se llama `escenarios — pesimista ≤ esperado ≤ optimista` y su
cuerpo **nunca comprueba ese orden**. Misma familia que los tres defectos de
E13-0: un nombre que afirma más que su código.

**765 unitarios · typecheck limpio.**

### E13-2 — extracción, no reescritura, y el diff se demuestra

`drawSeries` pasa a ser el **único sitio del módulo que llama a `new Chart(...)`**.
Nace por EXTRACCIÓN: los datasets se los pasa el llamador ya construidos, y el
cuerpo de `draw()` no se toca. La alternativa —reimplementar `draw` sobre una
tubería genérica— era apostar a que produce el mismo array, y tres contratos de
test son POSICIONALES: los hitos son el último dataset, la serie principal se
localiza por `borderWidth === 2`, el check-in por `pointStyle === 'rectRot'`.

**La extracción se verificó, no se supuso.** Un spec temporal volcó datasets,
escalas, `yAxisID`, plugins e interacción en las 12 combinaciones de métrica ×
grano, antes y después. Salida: **9 215 bytes idénticos**. Ni un campo cambió.

**La regla de los hitos deja de ser disciplina y pasa a ser código.** Si la capa
pulsable no es la última, `drawSeries` devuelve `false` en vez de dibujar. Antes
lo vigilaba solo un test, y un test protege lo que alguien se acordó de escribir.

**`destroy()` se parte en dos, y esto sí era un defecto a punto de entrar.**
`drawSeries` tiene que matar la gráfica anterior, pero para entonces `draw()` ya
fijó `announceMetric`. Con una sola función, esa segunda llamada la devolvía a
`'weight'` y el lector de pantalla habría recitado kilos sobre un eje de
calorías — justo lo que ese estado existe para evitar. Ahora `destroyInstance()`
mata el lienzo y `destroy()` además resetea el cursor y la métrica.

**Rendimiento:** `phaseBandsPlugin` recorría `projection.daily` **en cada
fotograma** —~16 000 iteraciones por dibujado para pintar seis rectángulos—.
Ahora los tramos se precalculan una vez con `phaseSpansOf`, que se exporta para
poder probarlo desde Node: contigüidad, cobertura total y equivalencia día a día
con recorrer la serie.

**Y un vigilante intermitente arreglado.** `chart-factory.spec.js` («las vistas
de la v1 siguen dibujando igual») leía píxeles justo tras `toBeVisible()`, con
250 ms de animación por delante: «visible» no es «pintado». Falló una vez en la
suite completa y pasó tres aislado, que es la firma de una carrera. Ahora usa
`expect.poll`, el patrón que ya usaba `projection.spec.js`. Un test intermitente
es peor que ninguno: enseña a ignorarlo, y este es el que vigila esta etapa.

**767 unitarios · 156 E2E · typecheck limpio.**

### E13-3/4 — cuatro series, y dos correcciones de diseño que hicieron los tests

`drawMulti` dibuja hasta cuatro series del catálogo y **devuelve un manifiesto de
lo que ha pintado de verdad**, no un booleano: `{ id, slot, pointCount, axis,
unit, provenance, reason }`. Ahí está el arreglo estructural de la leyenda
mentirosa — toda leyenda se renderiza desde ese array, así que no puede anunciar
una serie que el lienzo no dibujó. Con un booleano, la vista tendría que volver a
decidir qué se dibujó, y eso es literalmente el segundo sitio calculando el mismo
hecho.

**Ejes.** Una unidad → un eje y **cero `yAxisID`**, la configuración exacta que
produce hoy el camino de una métrica. Dos → izquierda y derecha, mandando la
unidad del hueco 0 (reordenar la selección cambia el lado: determinista y
controlable). Tres o más → **no se dibuja**, y se dice por qué: meterlas en dos
ejes obliga a elegir cuál miente sobre su escala.

**Corrección de diseño 1, encontrada por un test que escribí para otra cosa.** El
modo «cambio desde el inicio» iba a ser un delta ABSOLUTO, y eso no resuelve
nada: −5 kg y −300 kcal en el mismo eje siguen sin ser comparables, y las kcal
aplastan al resto por dos órdenes de magnitud. El modo es **porcentual**, y así
sí desbloquea comparar cuatro series cualesquiera en un solo eje. Las series que
YA son un delta —fluctuación, déficit, desviación— quedan fuera **con motivo**:
un déficit que pasa de −5 a −300 kcal no es «un aumento del 5 900 %».

El origen es el primer día de la ventana VISIBLE, no el día 0 — comparar formas
en los últimos 30 días con la referencia de hace ocho meses compara acumulados,
no formas. Y `setWindow` rebasa al mover la ventana **sin reconstruir la
instancia**, así que «la misma gráfica tras veinte cambios» sigue en pie.

**Corrección de diseño 2:** la banda de escenarios pasó a llamarse
`pessimist`/`optimist` en E13-1 y aquí se cobró: la aduana traduce las dos ramas
y recalcula el `extent`, porque con las cifras viejas el eje se dimensionaría mal
y la línea se saldría del área.

**La paleta se midió, no se eligió.** La primera propuesta —cuatro colores de
buen gusto— medía **ΔE 25,0 bajo deuteranopía**: dos de las cuatro series,
indistinguibles para el 6 % de los hombres. Una búsqueda con tres restricciones
simultáneas (contraste ≥ 4,5 sobre las tres superficies · ΔE ≥ 40 entre pares
bajo visión normal y las tres dicromacias · ΔE ≥ 32 frente a los cinco tokens que
ya significan algo · separación de tono ≥ 60°) da `#6788e9 #a6e64c #e6a8d1
#c7916b`, con **ΔE 40,1** en el peor par.

Hallazgo honesto del barrido: **32 es el máximo alcanzable frente a los
semánticos**, y por encima de 34 no existe ningún cuarteto. La paleta semántica
ya ocupa casi todo el círculo de tono usable sobre fondo oscuro. Por eso el color
**nunca carga con el significado** aquí: la procedencia va en el patrón de trazo
(cuatro distintos) y el color solo desempata entre huecos. `tokens-contrast.test.js`
vigila las tres cifras, con simulación de dicromacias incluida.

**Un defecto mío que atrapó un test:** `markerEvery` usaba `ceil` donde iba
`floor`, así que con siete puntos salían cuatro marcadores en vez de seis. El
error solo aparece justo por encima del umbral, que es donde nadie mira.

**786 unitarios · 166 E2E · typecheck limpio.**

### E13-5 — la vista, y tres defectos que solo aparecen en un navegador

La vista propia existe por la misma razón que E12 separó Hoy de Proyección: cada
pantalla, un trabajo. Proyección cuenta EL PLAN con una métrica cada vez;
comparar cuatro series es otra cosa, y meterlo ahí habría convertido una pantalla
que se lee en una que se opera.

**La leyenda ES la interfaz de selección**, y se genera desde el MANIFIESTO de
`drawMulti`, nunca desde el estado de selección. No hay una fila de chips además
de la leyenda: sería un tercer sitio donde la misma verdad puede divergir. Una
serie que resolvió a cero puntos no desaparece — se queda con «sin datos en este
periodo» y un botón para ampliar el periodo—, porque desaparecer sería la otra
mitad de la mentira.

**Lo que se guarda es lo PEDIDO; lo que se dibuja es lo EFECTIVO; y el control
muestra lo efectivo.** A 320 px con «Día» pulsado se dibuja por semana,
`aria-pressed` marca **Semana** y una línea explica por qué. Reflejar lo pedido
habría sido la leyenda mentirosa reencarnada en otro control. Verificado en el
navegador: `analysis.grain` guardado = `"day"`, botón pulsado = Semana, 24 puntos
en vez de 157, cero desbordes.

**El tope de cuatro se anuncia antes de chocar.** Si se insiste, la casilla no se
marca, se nombra la serie rechazada y **no se quita nada solo**: destruir la
intención del usuario sin permiso es peor que negarse.

**Tres defectos que ningún test unitario habría visto:**

1. **La nota de procedencia no salía nunca en la primera visita.** Se calculaba
   del manifiesto al construir el marcado, y en ese momento el manifiesto es
   todavía el del dibujado anterior —`null` la primera vez—. El aviso del origen
   del cambio tenía el mismo fallo. Ahora hay UN solo sitio dueño de los tres
   avisos, `renderHints`, que corre después de dibujar.
2. **El selector repintaba las cincuenta filas en cada casilla marcada**, así que
   destruía el nodo bajo el dedo del usuario y devolvía la lista al principio.
   Ahora solo se repinta la bandeja. Lo delató un test que no conseguía marcar
   cuatro casillas seguidas.
3. **`wire(container)` se volvía a llamar en cada cambio**, duplicando
   manejadores: `on()` los registra DELEGADOS en el contenedor, así que
   sobreviven al repintado de sus hijos. Cada clic acababa disparando una vez por
   cada cambio anterior.

**Y dos tests míos que estaban mal, no el código.** `check()` de Playwright
afirma que la casilla acaba marcada, y la quinta serie no debe acabar marcada:
va con `click()`. Y bloquear la red no simula «Chart.js no está»: **el service
worker lo sirve desde su precaché**, saltándose la intercepción — el mismo
mecanismo que sirve módulos viejos al desarrollar. El test desregistra el SW
primero.

**786 unitarios · 178 E2E · typecheck limpio.**

### E13-6 — la alternativa textual, y el CSV que no miente

**La tabla sale de las series RESUELTAS, no del lienzo**, y por eso sigue entera
cuando Chart.js no carga. Un fallo de la librería de gráficos no puede llevarse
también los números, que son a lo que el usuario vino. Se pinta FUERA de
`redraw`, porque `redraw` sale antes de tiempo justo en ese caso.

Cabeceras con unidad y procedencia; celdas solo numéricas; **sin dato = `—`**,
nunca un cero — un cero es una afirmación sobre el cuerpo del usuario y un hueco
no lo es. A 320 px cinco columnas no caben, así que la tabla vive en su propia
zona desplazable, **alcanzable con teclado** (WCAG 2.1.1) y sin contaminar el
`scrollWidth` del documento.

**El CSV lleva la procedencia al fichero.** `Peso previsto (kg, Prevista)`. Una
hoja de cálculo es exactamente donde la v4.0 hizo su daño: cifras estimadas
mezcladas con medidas y tratadas después como si todas fueran datos. Si la app lo
sabe y la exportación lo calla, el fichero es un arma cargada. Fechas siempre
ISO, BOM UTF-8, separador y decimales según idioma —y **sin separador de
millares**, porque un «13.000» con punto de millar es otro número o dos
columnas—. Guarda contra inyección de fórmulas (`=`, `+`, `-`, `@`): hoy no viaja
texto del usuario, y por eso el test importa — una guarda que nadie ejercita se
borra en el primer refactor por parecer código muerto.

**Lectura con N series, sin paragrafadas.** ←→ mueven la fecha, **↑↓ cambian de
serie**. La región `aria-live` recita SOLO la serie activa; recitar cuatro en
cada pulsación son dos docenas de palabras por tecla. Las otras tres viven en la
leyenda, que es texto normal del DOM y un lector la recorre cuando quiere. Al
cambiar de serie se anuncia su identidad completa. Sin dato ese día se dice, no
se inventa un cero.

**Un defecto de texto y un test intermitente.** La cabecera salía como «Grasa
prevista (%) (%, Prevista)»: la unidad vivía en el NOMBRE y la cabecera la
repetía. Unidad y procedencia son campos aparte, y ahora hay un test que lo
vigila. Y el test de «sin Chart.js» pasaba unas veces y fallaba otras: al
recargar, `pwa.js` **vuelve a registrar el service worker**, que entraba en
carrera para servir el vendor de su caché. Ahora se bloquea también `sw.js` y se
espera a que `controller` sea null — cuatro pasadas seguidas en verde.

**795 unitarios · 185 E2E · typecheck limpio.**

### E13-7 — gestos sin dependencias, y una mentira que se coló por el caso de fallo

Rueda, arrastre, pellizco y doble clic, **sin `chartjs-plugin-zoom`**: todo pasa
por `setWindow`, que ya movía la ventana sin reconstruir la gráfica. Tres
decisiones que no son de implementación:

- **La rueda solo hace zoom con `Ctrl`/`⌘` o con el lienzo enfocado.** Una rueda
  que siempre llama a `preventDefault` deja al usuario atrapado en una gráfica de
  460 px de alto. Hay test de que sin modificador la ventana no se mueve.
- **Un movimiento por fotograma**, coalescido con `requestAnimationFrame`: un
  trackpad dispara decenas de eventos por gesto y sin esto el zoom se vuelve
  pegajoso justo cuando debería ir fluido.
- **Menos de cuatro píxeles no es un arrastre, es un clic.** Sin ese umbral, el
  temblor de un dedo convertiría cada toque en un paneo minúsculo.

**`preset: 'custom'` es lo que hace que el zoom SOBREVIVA.** La ventana se
derivaba del preset en cada redibujado, así que cualquier cosa que redibujara
—marcar una serie, cambiar de escala— se comía el zoom al instante: los gestos
habrían funcionado y se habrían deshecho solos. Y al hacer zoom **ningún botón de
periodo queda pulsado**: dejar «Todo» encendido mientras se mira un tramo de
treinta días sería un control afirmando lo que la gráfica contradice. El zoom NO
se persiste — dos índices de día solo significan algo dentro de ESTE plan.

`spark.js` recoge la geometría de sparkline que vivía en `muscle-grid.js`; la
excepción de `toFixed` se mudó con el código, que es donde tenía que estar.

**Un test intermitente que resultó ser un defecto real.** El de «sin Chart.js»
pasaba unas veces y fallaba otras. Tras descartar tiempos, la causa era que
**`page.route` NO intercepta lo que sirve un service worker**: el SW ya tenía el
vendor en su precaché antes de que el test pudiera bloquear nada. La solución es
`test.use({ serviceWorkers: 'block' })` — impedir que exista, en vez de pelearse
con él.

Y al mirar de cerca apareció lo importante: **cuando el dibujado fallaba,
`drawMulti` devolvía el manifiesto con «24 puntos» de series que nunca se
pintaron**. La leyenda mentirosa que esta etapa entera existe para hacer
imposible, colada por la puerta de atrás del caso de fallo. Ahora el manifiesto
de un fallo reporta cero puntos con motivo, y hay un test que lo vigila.

**802 unitarios · 191 E2E · typecheck limpio.**

### E13-8 — la banda deja de mentir, y dos tests que defendían la fórmula defectuosa

**El defecto.** La banda muestreaba el peso esperado en las DOS posiciones
extremas del plan (retrasado `t^1.3`, adelantado `t^0.78`). En una trayectoria
monótona eso funciona; en la costura entre volumen y corte, «retrasado» cae antes
del pico y «adelantado» después, los dos escenarios quedan al mismo lado del
esperado y **la superficie rellena entre ellos no lo contiene** — 25 días de 176
en la auditoría-1, visibles en Proyección desde M3. Los dos números eran
correctos uno a uno; el área que se dibujaba entre ellos afirmaba algo falso.

**El arreglo.** La banda del día `d` es ahora la **envolvente** del peso sobre el
intervalo de posiciones entre los dos escenarios: «si tu progreso va entre
retrasado y adelantado, tu peso está en este rango». Como la posición esperada
`d` siempre cae dentro del intervalo, el esperado queda dentro **por
construcción**. Cada campo conserva el lado de su escenario (en pérdida el
pesimista sigue siendo el valor mayor): solo se ensancha, nunca se reordena.
Sobre una trayectoria lineal a trozos, los extremos solo pueden estar en los
bordes del intervalo o en los días enteros interiores — no hace falta muestrear
más fino.

**Verificado en tres frentes:**

- **Regresión cero en planes monótonos**, medida y no supuesta: en un plan de
  definición pura, la banda nueva coincide con la fórmula vieja con diferencia
  máxima `0.00e+0`.
- **Barrido adversarial**: 128 planes (2 sexos × 4 pesos × 4 grasas × 5
  objetivos), 28 193 días comprobados, **cero fuera**.
- **Mutación**: quitar el bucle de la envolvente pone el invariante en rojo.

**El invariante `escenarios` por fin muerde.** Llevaba desde M1 prometiendo en su
nombre «pesimista ≤ esperado ≤ optimista» mientras su cuerpo solo comprobaba
finitud y cierre. Y de paso el nombre afirmaba un orden que ni es cierto ni debe
serlo —en pérdida el pesimista pesa MÁS—; ahora se llama por lo que garantiza:
**la banda CONTIENE al esperado cada día**, con la envolvente como aserción.

**Y dos tests más que había que corregir, no apaciguar.**
`core-generator.test.js` y `core-timeline.test.js` REIMPLEMENTABAN la fórmula de
los dos extremos como oráculo — un test que duplica la fórmula defiende la
fórmula, no la propiedad, y aquí defendían justo la defectuosa. El primero ahora
recalcula la envolvente por su cuenta y exige igualdad exacta más contención y
conservación de lados; el segundo pasa de «la banda VALE la muestra del extremo»
a «la banda CONTIENE el esperado del día equivalente», que es lo que `windowFor`
significa de verdad.

**802 unitarios · 191 E2E · typecheck limpio.**

### E13-9 — el puente que faltaba, encontrado por la primera prueba real

La primera prueba real de E13 terminó con «no siento que se haya aplicado ningún
cambio; ni siquiera se pueden seleccionar varias variables en la gráfica». Dos
causas, una por lado:

1. **La versión instalada sigue mandando hasta pulsar «Recargar».** Verificado de
   punta a punta reproduciendo la situación exacta (SW viejo controlando, nuevo
   esperando): el aviso aparece, el botón funciona, y tras pulsarlo la caché
   vieja desaparece y Analizar está en el menú. El mecanismo es correcto; lo que
   no es razonable es esperar que el usuario lo conozca.
2. **La multi-selección vivía a una vista de distancia sin ningún camino desde la
   gráfica.** Quien mira la gráfica de Proyección es exactamente quien va a
   querer superponer series, y desde ahí no había forma de descubrir que la
   función existía. Ahora la tarjeta de la curva lleva «Comparar varias
   series…», que navega a Analizar — el mismo patrón del «Ver la proyección
   completa» de Hoy. Con E2E que lo fija.

**802 unitarios · 192 E2E · typecheck limpio.**

### E13-9b — la vista se convierte en el instrumento que se pidió

El veredicto de la segunda prueba real: «no has hecho la gráfica más útil; ahora
es más confusa». Tenía razón en tres cosas concretas, y las tres se han hecho:

**1. La gráfica manda.** Una sola tarjeta —fuera la antesala de «Series» y el
párrafo de introducción—, el contenido suelta el corsé de lectura de 56rem
(`--content-max-wide`, 96rem, vía `:has`) y el lienzo mide
`clamp(360px, 66vh, 900px)`: más del 60 % del alto de la ventana, fijado por
test a 1440×900.

**2. Su pregunta tiene botón.** «Músculo vs. grasa» —músculo previsto en kg al
eje izquierdo, porcentaje de grasa previsto y medido al derecho— es la primera
comparación rápida. Era LA pregunta del producto y no estaba. Y el detalle por
defecto pasa de semana a **día**: «todo el detalle posible», literal.

**3. El tope sube de 4 a 8.** Decisión del dueño del producto; el precio se
midió y se pagó a la vista: la paleta de 8 baja la ΔE mínima de 40,1 a 30,2
—sigue distinguible bajo las tres dicromacias— y se rehizo la búsqueda entera en
vez de añadir cuatro colores a los desplegados, porque conservar esos cuatro
dejaba el mínimo en 22,8. Ganó la medición sobre la continuidad. Ocho marcadores
(el rombo se queda en el hueco 4: es el contrato del check-in), esquema a
`maxItems: 8`, y E2E de ocho series con ocho colores y ocho marcadores.

**802 unitarios · 195 E2E · typecheck limpio.**

### E13-10/11 — la promesa incumplible y el contador que colisionaba

**E13-10 · El 1RM por ejercicio se vuelve elegible.** `est_e1rm` necesitaba un
ejercicio como parámetro y ninguna interfaz podía dárselo: aparecía en el
selector como «sin datos todavía» PARA SIEMPRE — una promesa incumplible colada
en E13-1. Ahora la plantilla se expande en la interfaz a **una fila por
ejercicio de la rutina**, con su nombre («1RM estimado · Sentadilla trasera»),
id compuesto persistible (`est_e1rm__<exerciseId>`, doble guion bajo porque el
punto rompería `SAFE_ID`), y la fila abstracta desaparece. El catálogo del motor
no se toca: la expansión depende de la rutina del perfil, y eso es de la
interfaz. Un ejercicio sin sesiones dice «sin datos todavía»; sin rutina no hay
filas de 1RM, que es la verdad. La etiqueta viaja COMPUESTA por el manifiesto
hasta la leyenda, el lienzo, la tabla y el CSV — y como es texto del usuario, la
guarda anti-fórmulas del CSV pasa de preventiva a activa.

De paso, una lección de método: dos parches de esta etapa **no se aplicaron y el
`replace` sin `assert` se lo tragó en silencio** — el selector siguió ejecutando
el código viejo y solo lo delató el E2E. Todos los parches por sustitución
llevan ahora `assert` de que la cadena existe.

**E13-11 · `CACHE_VERSION` derivada del hash (BACKLOG §9.bis).** La versión pasa
de contador (`tl-v5-0089`) a derivada del contenido (`tl-<12 hex>`): mismo árbol
→ misma versión, dos ramas ya no pueden colisionar en un número compartido al
fusionar, y `sw:bump` es idempotente. El test del candado gana dos aserciones:
la versión debe ser EXACTAMENTE la derivada (escribirla a mano → rojo,
verificado con mutación) y `sw.js` no puede entrar en su propio PRECACHE (la
derivación dejaría de ser estable). La limpieza de `activate()` borra por
prefijo `tl-`, así que las cachés contadas viejas caen solas.

**802 unitarios · 197 E2E · typecheck limpio.**

### E13-12/13/14 — el BACKLOG, cerrado

Tres puntos, y ninguno era una idea nueva: los tres estaban señalados y sin
hacer. De paso, una corrección de registro — dos de ellos los había mencionado
al usuario como «están en el BACKLOG» y nunca los escribí allí. Lo que no está
anotado no existe.

**E13-12 · El PNG dice qué es cada línea.** Un PNG de tres series no decía cuál
era cuál: la leyenda vivía en el DOM y se quedaba fuera del fichero. Ahora
`toPng` **hace crecer el lienzo** y pinta la leyenda debajo, **leyéndola de los
propios datasets** (`legendEntriesOf`) — fuente única, así que el fichero no
puede describir una gráfica distinta de la que enseña. Reproduce el TRAZO de
cada serie y no un cuadrito de color, porque un PNG se mira en gris, se imprime
y se reenvía sin la app al lado. Descarta el relleno de la banda (dos datasets
sin línea) y los rótulos repetidos. Analizar gana su botón de PNG, que no tenía.

Un detalle que solo se vio mirando el fichero: con tres series en un lienzo
ancho se repartían cinco columnas y los rótulos salían cortados —«Porcentaje de
grasa previ…»— teniendo sitio de sobra. Las columnas se acotan ahora al número
de series.

**E13-13 · Nombres basura de OFF.** El punto del BACKLOG proponía «lista de
bloqueo por id, no una heurística», y **medir lo confirmó**: nueve heurísticas
sobre las 2 002 fichas de OFF marcan 71, de las que ~65 son legítimas —
«10 tortillas integrales» es el número de unidades del envase, y «Hot dog» cae
por no tener ninguna palabra de cuatro letras. Tumbar 71 para limpiar 5 no es
una criba. Van por id, con motivo escrito y auditable: dos «hacendado» (nombre =
marca, no identifican producto), «No», «Untapan de» (truncado) y «x4». La lista
se aplica en el constructor y al catálogo ya publicado, y un test comprueba las
dos mitades — una reconstrucción que la olvidara devolvería la basura.

**E13-14 · Tira de contexto.** La mitad del zoom que faltaba: con la gráfica
acercada, ves treinta días sin saber si son los primeros o los últimos. Una tira
SVG bajo el lienzo dibuja el plan ENTERO en miniatura con la ventana enmarcada
(enmarcada, no tapada: un relleno opaco escondería justo lo que se mira), y
aparece SOLO con zoom — con el plan completo a la vista, un rectángulo que lo
cubre todo no informa de nada. SVG y no otra instancia de Chart.js, mismo
criterio que ya cerró `muscle-grid.js`. Se repinta CON el gesto, no al final: si
esperara al siguiente dibujado completo, señalaría un tramo que ya no es el
visible.

**Y el vigilante de `toFixed` hizo su trabajo por tercera vez.** La geometría del
rectángulo lo necesitaba, y la respuesta correcta no era añadir la vista a la
lista de excepciones —esa vista también escribe cifras que el usuario lee— sino
mover la geometría a `spark.js`, donde la excepción ya está justificada porque
no escribe ni un número legible. La excepción se mantiene estrecha.

**810 unitarios · 200 E2E · typecheck limpio.**

### E14 — auditoría de estimaciones y proyecciones

Petición: «audita el sistema de estimaciones y proyecciones; nada funciona en la
gráfica; deben poder verse los hitos estéticos, de energía y de salud». La
auditoría encontró una causa raíz común a las tres quejas, y no está en la
gráfica: **el plan que se genera no proyecta ganancia muscular**, así que las
series y los hitos que dependen de ella no tienen nada que dibujar.

- [x] **E14-1 · El objetivo de músculo por defecto era «no ganar nada».**
  `effectiveTargetMuscle()` devolvía, a falta de cifra tecleada, **el músculo
  actual**. Como casi nadie sabe cuántos kilos de músculo tiene, casi nadie
  rellena ese campo: el objetivo salía igual al punto de partida y el plan
  proyectaba +0,013 kg en cinco meses mientras el motor sabía que un principiante
  de 85 kg puede ganar entre 5,2 y 8,0. El plan no prometía de más — no prometía
  nada. Cascada: cero hitos de `muscleKg`, y de los 97 hitos estéticos solo 31
  alcanzables, todos en el día 0.

  El arreglo pone en la interfaz lo que el motor ya sabía. `engine.js` gana
  `plausibleMuscleGainKg(peso, nivel, sexo, días)`, que integra
  `monthlyMuscleGainKg` (Helms 2014 / McDonald 2008, factor 0,625 para mujeres)
  sobre un horizonte; el onboarding propone `músculo actual + ganancia media` a
  seis meses y **escribe el rango bajo el campo**: «con tu nivel, ganar entre X e
  Y kg en 6 meses es realista». Si el usuario teclea un objetivo que no gana nada
  (< 200 g, dentro del error de cualquier método), se le **avisa** — no se le
  corrige: es su plan (B9).

  El horizonte de propuesta es fijo y no el del plan, a propósito: el del plan
  depende del objetivo, que es lo que se está proponiendo. Seis meses porque con
  menos la cifra vuelve a parecer «no ganes nada» y con más se propone algo que
  tarda años.

- [x] **E14-2 · Hitos de salud, con la fuente pegada.**
  `src/core/health-milestones.js`. Franjas de IMC (OMS, *Technical Report Series
  894*), franjas de porcentaje de grasa (American Council on Exercise) y
  perímetro de cintura (consulta de expertos de la OMS, 2008, con los cortes del
  NIH). Cada umbral trae su `sourceKey` y esa frase llega hasta la pantalla: es
  la diferencia entre «la app dice» y «la OMS dice».

  Tres decisiones que el módulo toma una vez y valen para todo: el **IMC solo
  cuenta hacia abajo** —no distingue músculo de grasa, así que subir de 24,9 a
  25,1 en un volumen no es un evento de salud—; la **cintura no se proyecta** y
  sale de los check-ins o no existe, porque estimarla con un modelo de población
  y anunciarla como umbral de riesgo es la clase de promesa que hundió la v4.0;
  y **entrar en grasa esencial es un hito marcado como RIESGO**, no como logro,
  porque un producto que solo sabe felicitar acaba felicitando a quien se está
  haciendo daño.

- [x] **E14-3 · Los hitos se ven EN la gráfica.**
  Las tres familias —motor, catálogo estético y salud— se juntan en
  `src/ui/marks.js` y llegan al lienzo. Se dibujan como **marcas de regla en un
  carril superior, no como puntos sobre una línea**: con dos unidades a la vez,
  anclar un punto a un eje es elegir a cuál de las dos se le miente sobre la
  altura. Una columna no afirma ninguna altura; afirma un DÍA, que es lo único
  que el hito sabe de verdad.

  La primera versión cruzaba el lienzo entero y con treinta hitos el plan quedaba
  detrás de una empalizada: los marcadores tapaban justo las series que venían a
  anotar. Se quedó en una marca corta.

  Los del mismo día se agrupan (el catálogo tiene 97 fichas sobre dos umbrales:
  cinco triángulos en la misma columna de píxeles no dibujan cinco cosas, dibujan
  una mancha), los que no caben se descartan **por prioridad** —un aviso de salud
  nunca lo tapa el hito estético número 54— y **se dice cuántos quedaron fuera**.
  El adelgazamiento se recalcula por fotograma con el área y la ventana reales,
  así que al acercar el zoom caben más de verdad y el recuento no se queda rancio.

- [x] **E14-4 · La barra de la vista, rehecha.**
  Eran trece botones seguidos en dos filas indistinguibles. Los cuatro atajos de
  comparación se veían igual que los controles de estado de al lado y no marcaban
  nunca cuál estaba aplicado; los tres grupos excluyentes corrían juntos sin
  ningún rótulo a la vista —solo `aria-label`—, así que había que pulsarlos para
  averiguar qué preguntaban.

  Ahora cada grupo lleva su rótulo visible y lo usa con `aria-labelledby`: **el
  nombre accesible y el visible son el mismo nodo**, y no pueden divergir. Los
  atajos se separan como acción principal y marcan el que coincide con la
  selección. Los filtros de hito son interruptores sueltos, no un grupo de radio
  disfrazado.

  Y a 320 px todo eso ocupaba pantalla y media con la gráfica debajo del pliegue:
  los controles se pliegan tras «Ajustes de la vista», que en escritorio viene
  desplegado y con el resorte oculto por CSS. Un solo camino, plegado o no.

  **El cajón nació roto y lo cazaron los E2E.** El atributo `open` se ponía por
  interpolación en la plantilla —`${'`'}${'$'}{isNarrow() ? '' : ' open'}${'`'}`— y `html${'`'}${'`'}`
  hace exactamente lo que promete: escapó el espacio, así que salía
  `class="..."&#32;open` y `open` acabó siendo TEXTO. El cajón nacía cerrado para
  todo el mundo y, como en escritorio el resorte está oculto por CSS, los
  controles quedaban **inalcanzables**: trece tests de `analysis.spec.js` en rojo
  a la vez, todos con «element is not visible».

  El arreglo invierte el sentido: el marcado nace ABIERTO y `collapseDrawer()` lo
  pliega desde JS solo si la pantalla es estrecha. Si un día ese JS no llega a
  correr, lo que queda es todo a la vista, que es el fallo bueno. Y la regla
  queda fijada en las dos direcciones por un test propio.

### E15 — saneamiento: lo que el usuario ve roto, y por qué

Petición: «identifica por qué no está funcionando, por qué la gráfica no funciona
y por qué las funcionalidades adicionales no están acabadas». El diagnóstico,
medido en producción contra la instancia viva de Chart.js y contra el árbol,
contradice la premisa en su parte técnica y la confirma en la de producto:

- **El código no está roto.** 833 tests en verde, typecheck limpio, cero
  `TODO`/`FIXME`, cero imports rotos, cero vistas stub, paridad i18n exacta.
- **La gráfica funciona.** Chart.js 4.5.1, una sola instancia, canvas conectado,
  ejes correctos, ticks monótonos. Lo que se ve roto son los datos: un perfil que
  pide ganar **13 gramos** de músculo en 155 días, con el eje Y autoescalado a
  `[32,10–32,50]`, convierte el ruido de báscula en un desplome catastrófico.
- **La causa raíz es que la app está vacía**: cero check-ins, cero ingesta, cero
  pasos, cero sesiones. Todas las «funcionalidades adicionales» son consumidoras
  de datos que hay que teclear a diario, y la única puerta de entrada es un
  formulario de dieciséis bloques.
- Y trece defectos concretos verificados uno a uno, encabezados por tres botones
  primarios muertos en el estado vacío y una clave i18n que no existe.

- [x] **E15-0 · El service worker dejaba de servir código y pasaba a servir fósiles.**
  `pwa.js` registraba en cualquier `isSecureContext` —y `localhost` lo es—, y
  `sw.js` es cache-first **sin revalidar** y **sin `skipWaiting()`**, las dos cosas
  a propósito y las dos correctas en producción. En `npm run serve` significaban
  que editabas un módulo, recargabas, y el navegador seguía ejecutando el de antes
  indefinidamente. No es una molestia: es la capacidad de verificar cualquier cosa
  en local, perdida y en silencio. Va antes que todo lo demás porque arreglar el
  resto sin poder comprobarlo es trabajo tirado.

  `swPolicy({hostname, port, isSecureContext})` es ahora la decisión entera, pura
  y exportada, probada como tabla de verdad sin navegador. En cualquier host de
  bucle local **desinstala** el service worker y tira las cachés `tl-*`; el único
  origen local que sigue registrando es `127.0.0.1:8081` (`tools/serve-csp.mjs`),
  porque ahí corre `pwa.spec.js` y es donde el modo sin conexión se prueba de
  verdad. Ese puerto queda atado a `playwright.config.js` por un test, el mismo
  candado que `sw.lock.json` pone sobre `CACHE_VERSION`.

  **Y la verificación en un navegador real destapó un defecto mayor que el que
  venía a arreglar.** Con dos cachés conviviendo —`tl-cd1c3ad85fe2` fósil y
  `tl-5149ca521304` actual— el service worker servía el módulo VIEJO teniendo el
  nuevo cacheado a un palmo. La causa: `caches.match()` a secas recorre **todas**
  las cachés y devuelve la primera por orden de **creación**, así que la vieja
  gana. Eso vacía de sentido a `CACHE_VERSION`, que existe justo para que no se
  mezclen versiones de módulos. Y no es un caso raro: entre `install` y `activate`
  las dos cachés coexisten SIEMPRE, durante todo el tiempo que el usuario tarde en
  aceptar el aviso de versión nueva, porque no hay `skipWaiting`. Las dos
  búsquedas pasan a hacerse contra `caches.open(CACHE_VERSION)`, y un test estático
  —que descarta comentarios antes de mirar, porque la explicación contiene la
  cadena— impide que la global vuelva.

- [x] **E15-1 · Cuatro botones primarios que no hacían nada.**
  `components/state.js` pinta las acciones como `<button data-action="<id>">`, y
  quien las declara y quien las escucha son ficheros distintos. Nada ataba las
  dos mitades, así que un `action:` sin su `on(...)` compilaba, pasaba el
  typecheck, pasaba los 833 tests y llegaba a producción como un botón principal
  inerte. La ficha H-013 dice que un estado vacío nunca puede ser un callejón sin
  salida; había cuatro.

  - `go-onboarding` en **Gasto** y en **Compra**, con la etiqueta `today.createPlan`
    que **no existía en ninguno de los dos diccionarios**: el botón mostraba la
    clave cruda.
  - `add-intake` en **Gasto**. No necesitaba navegar a ningún sitio: el formulario
    de ingesta ya está en pantalla debajo del propio estado vacío. Faltaba llevar
    el foco.
  - `openPicker` en **Analizar**, que no sabíamos que estaba roto: **lo encontró
    el test nuevo**. El único oyente escuchaba `[data-open-picker]`, otro atributo
    distinto. Deseleccionabas todas las series y el único camino de vuelta no
    hacía nada. Era además el único identificador en camelCase de todo el
    proyecto: no es casualidad, un identificador que no sigue la convención es uno
    que se escribió sin mirar los demás.

  En Compra el oyente se registra **antes** del `await foodsDb.load()`, no con los
  demás: si esa carga falla, `mount` sale antes y el estado vacío se quedaría otra
  vez sin salida, justo en el caso de fallo.

  **El test que debía cazar todo esto existía y mentía.** `shopping.spec.js:117`
  se llamaba «sin plan, la compra ofrece crear uno en vez de fallar» y **nunca
  navegaba a Compra**: vaciaba `localStorage`, recargaba, y comprobaba
  `.onboarding !== null || innerText.includes('plan')`. Sin almacén, `route()`
  manda al asistente antes de montar ninguna vista, así que la primera rama se
  cumple siempre y el test pasaba sin haber pintado jamás lo que decía comprobar.
  Reescrito: entra en Compra CON plan, le quita el plan a la vista, y afirma que
  la etiqueta no es la clave cruda y que pulsar el botón abre el asistente.
  Comprobado que falla al reintroducir cada defecto.

  Y la guarda para que no vuelva: `test/ui-state-actions.test.js` cruza toda
  `action:` declarada dentro de un `actions: [...]` contra los `[data-action]`
  escuchados, **por fichero**. Lo de «por fichero» no es un detalle: `on()`
  delega acotado al contenedor de SU vista, así que un oyente en Compra no
  atiende al botón de Gasto — y la primera versión de este test, que solo miraba
  un conjunto global, daba por bueno exactamente ese fallo.

#### Bitácora E15

**2026-08-21 · E15-0.** Cerrada. `swPolicy` + `cleanup()` en `pwa.js`, `caches.match`
acotado a `CACHE_VERSION` en `sw.js`, cuatro tests nuevos en `test/pwa.test.js`
(tabla de verdad de doce casos, candado del puerto de paridad, filtro `tl-` de la
limpieza, y la prohibición de la búsqueda global). 837/837 en verde, typecheck
limpio, `sw:bump` ejecutado. Verificado en navegador real sobre `localhost:8080`:
se reprodujo el estado infectado registrando el SW a mano, se confirmó que servía
el `pwa.js` viejo, y tras el arreglo el origen queda con cero registros, cero
cachés y el fuente NUEVO servido de red, con la app arrancando igual.

**2026-08-21 · E15-1.** Cerrada. Cuatro botones cableados (uno de ellos,
`openPicker` en Analizar, descubierto por el test nuevo), `today.createPlan` en
los dos diccionarios, `test/e2e/shopping.spec.js` reescrito, y
`test/ui-state-actions.test.js` como guarda. 841/841 en verde, typecheck limpio,
43 E2E de shopping+analysis en verde. Verificado en navegador real: el foco cae
en el campo de kcal y el selector de series abre desde el estado vacío.

**Y verificar E15-1 destapó dos cosas más, las dos anotadas abajo.** La primera
se arregla ya porque es de la misma familia —una interfaz que dice algo falso— y
cuesta una línea de CSS; la segunda va al BACKLOG.

**2026-08-21 · E15-1b.** Cerrada. `[hidden] { display: none !important }` en
`css/app.css` + `test/css-hidden.test.js`. 843/843 en verde, typecheck limpio,
`sw:bump` ejecutado.

Siguiente paso concreto: **E15-2**, el objetivo de músculo degenerado —
`core/ranges.js#checkTarget` gana `target.muscleNoGain` para `0 ≤ Δ < 0,2 kg`, el
aviso viaja por `plan.warnings` (que `dashboard.js` ya pinta y traduce, así que
todo perfil ya guardado lo verá al siguiente arranque) y su botón lleva al
asistente. Nunca corrección silenciosa (B9).

#### Hallazgos de la verificación de E15-1

- [x] **`hidden` no ocultaba nada en esta aplicación** (E15-1b, cerrado). No existe **ninguna** regla
  `[hidden]` en `css/`, y 88 reglas de clase fijan `display`. La hoja del
  navegador trae `[hidden] { display: none }`, pero un selector de clase le gana.
  Efecto medido en el selector de series con cero series elegidas: el aviso
  `.notice[data-picker-limit]` —que SÍ tiene el atributo `hidden` puesto— se
  pinta y dice «Ya tienes 8 series. Quita una para añadir otra.» tres líneas
  encima de «0 de 8 series · Todavía no has elegido ninguna serie». Afecta
  además a `data-effective-hint`, `data-marks-note`, `data-context-strip` y
  `data-mixed-notice`, los cuatro en `analysis.js`.

  Arreglado con `[hidden] { display: none !important; }` en `css/app.css`. El
  `!important` está justificado y no es un parche: `hidden` es una declaración de
  intención del MARCADO, y ninguna regla de presentación debería poder
  contradecirla. El marcado ya lo hacía bien; era el CSS el que no cumplía su
  parte. `test/css-hidden.test.js` lo blinda —descartando comentarios antes de
  mirar, porque el que explica la regla la cita literalmente—. Verificado en
  navegador: el diálogo ya solo dice «0 de 8 series · Todavía no has elegido
  ninguna serie».

- **El caché HTTP fosiliza los módulos igual que el service worker.** E15-0
  cerró una de las dos puertas; ésta es la otra. Medido: con el SW ya
  desinstalado, tras editar `expenditure.js` y recargar, `import()` seguía
  devolviendo el módulo anterior —sin `setOnCreatePlan` entre sus exports— porque
  `python3 -m http.server` no manda `Cache-Control` y el navegador aplica caché
  heurística. `npm run serve` pasa a ser `node tools/serve-csp.mjs 8080`, que
  sirve el `no-cache` de `_headers` y nunca responde 304. Bonus: la CSP de
  producción queda activa también en desarrollo, así que una violación se ve el
  día que se escribe. Ya hecho, dentro de E15-1.

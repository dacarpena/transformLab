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

- **`num()` formatea con punto decimal en español.** `src/ui/format.js` usa
  `toFixed`, que siempre pone `.`, así que toda la aplicación escribe «82.8 kg»
  donde en español va «82,8 kg». Es un defecto **preexistente** y transversal
  (afecta a todas las vistas de la v1), detectado al revisar V2-M2 en navegador.
  El arreglo es `Intl.NumberFormat` con el locale activo, y toca hacerlo de una
  vez para toda la app, con su test.
- **`CACHE_VERSION` debería derivarse de `precacheHash`** en vez de ser un
  contador: dos ramas que lo suban obtienen el mismo número y colisionan al
  fusionar (ver §9.bis).
- **Nombres basura en el catálogo de OFF.** Quedan fichas con nombres truncados
  o sin sentido («esa Plátano»). La criba actual no los detecta y no hay una
  regla obvia que los separe de un nombre corto legítimo. La insignia «marca
  (comunidad)» ya avisa de la garantía; si molesta, la vía es una lista de
  bloqueo por id, no una heurística.

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

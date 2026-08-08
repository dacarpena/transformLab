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
| **V2-M8** | `chart.js`: singleton → factoría | `createChart(canvas)` con estado por instancia; dos gráficas conviven | — (tras M0) |
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

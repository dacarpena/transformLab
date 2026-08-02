# Verificación manual

Guion reproducible para comprobar a mano el estado de TransformLab. No es una lista de comprobación: cada paso tiene una acción concreta, un resultado esperado que se puede leer en pantalla o en la consola, y el veredicto conocido a día de hoy. Dos personas que lo ejecuten sobre el mismo commit deben obtener el mismo registro.

> **Estado:** guion de referencia sobre el árbol auditado · **Última revisión:** 2 de agosto de 2026 · **Versión verificada:** v3.1, commit `264c1db`

> **Alcance.** Este guion describe el **árbol de trabajo local**, `main` @ `264c1db` (v3.1). **No** describe la v4.0 publicada en `origin/main` (`d0afa49`), que no se ha auditado: el local está **tres commits por detrás** (`git status -sb` → `## main...origin/main [behind 3]`). Las cifras de la columna «Estado actual» proceden de ejecutar el motor de este snapshot. La v4.0 carga trece scripts en lugar de siete y añade cinco módulos (`js/router.js`, `js/checkin.js`, `js/nutrition.js`, `js/training.js`, `js/body-visualizer.js`), así que el recorrido de pantallas es distinto y este guion **no** es válido allí tal cual. Lo que sí se ha reverificado contra `origin/main` es el defecto crítico: el recorte `Math.max(2, Math.min(10, calculatedOtherLean))` sigue presente y la prueba de identidad devuelve los mismos valores. Ver [`ING-01`](./CATALOGO-DE-HALLAZGOS.md#ing-01--el-main-local-está-desincronizado-del-main-publicado-en-github).

Documentos relacionados: [README](../README.md) · [Guía de desarrollo](./GUIA-DE-DESARROLLO.md) · [Auditoría](./AUDITORIA.md) · [Catálogo de hallazgos](./CATALOGO-DE-HALLAZGOS.md) · [Deuda técnica](./DEUDA-TECNICA.md)

---

## 1. Cómo usar este guion

### Cuándo ejecutarlo

| Momento | Alcance | Para qué |
|---|---|---|
| **Antes** de tocar código, una vez por sesión | Guion completo (§4) más §5 y §6 | Fijar la línea base. Sin ella no se puede afirmar que un arreglo ha arreglado algo |
| **Después** de cada arreglo | Los pasos que el arreglo debía cambiar, más §6 completo | Confirmar el cambio de veredicto y detectar regresiones en los pasos vecinos |
| Antes de cerrar una fase del plan de remediación | Guion completo, §5 y §6 | Cerrar la fase con un registro comparable al de la línea base |
| Tras `git pull` o cambio de rama | §6 primero; si el número de fallos cambia, guion completo | §6 tarda un segundo y detecta cambios de comportamiento del motor |

### Cuánto lleva

- §4, guion de humo completo, 30 pasos: **35-45 minutos** la primera vez, 20-25 una vez familiarizado.
- §5, accesibilidad mínima, 4 comprobaciones: **10-15 minutos**.
- §6, motor en Node: **menos de un segundo** de ejecución; el tiempo se va en leer la salida.

Subconjunto mínimo cuando sólo hace falta saber si el defecto crítico sigue vivo: pasos **8**, **12**, **13**, **16** y **19**, más §6. Diez minutos.

### Cómo registrar el resultado

Cada paso admite exactamente uno de tres veredictos, y no hay un cuarto:

- **PASA** — el resultado observado coincide con el resultado esperado.
- **FALLA** — no coincide. Se anota el identificador del hallazgo del [catálogo](./CATALOGO-DE-HALLAZGOS.md) si el guion ya lo atribuye, y el valor observado si es un número.
- **BLOQUEADO** — el paso no se ha podido ejecutar porque un paso anterior lo impide. Se anota cuál.

Se rellena la tabla de §7 y se guarda junto al commit verificado. Un registro sin el hash del commit no sirve para comparar.

La columna **«Estado actual»** de §4 y §5 es lo que hace útil este documento: dice si el paso pasa o falla **hoy**, sobre `264c1db`. Un paso marcado FALLA que empieza a pasar es un arreglo verificado; un paso marcado PASA que empieza a fallar es una regresión.

---

## 2. Preparación

### 2.1 Situarse en el commit correcto

```bash
cd /ruta/a/transformLab
git fetch --all --prune
git log --oneline -1            # debe decir 264c1db
git status -sb                  # dirá: ## main...origin/main [behind 3]
```

Si el árbol ya está en `origin/main` (v4.0), este guion no aplica: crea un worktree aparte sin tocar el clon principal.

```bash
git worktree add ../transformLab-v3.1 264c1db
```

### 2.2 Servir la aplicación

La aplicación no hace ni una sola llamada de red propia y todas sus rutas son relativas, así que funcionaría abriendo `index.html` directamente. **No lo hagas para este guion**: el esquema `file://` tiene un origen opaco y el comportamiento de `localStorage` varía entre navegadores. Sirve por HTTP:

```bash
python3 -m http.server 8000     # http://localhost:8000
```

Requisito adicional: **conexión a internet**. `index.html:26` carga Chart.js desde `cdn.jsdelivr.net` sin versión fijada y sin copia local; sin red no hay gráfico y varios pasos quedan BLOQUEADOS (ver [`FRO-01`](./CATALOGO-DE-HALLAZGOS.md#fro-01--chartjs-se-carga-desde-un-cdn-sin-versión-fijada-sin-sri-y-bloqueando-el-render) y [`EST-04`](./CATALOGO-DE-HALLAZGOS.md#est-04--si-chartjs-no-carga-el-usuario-recibe-reconfigura-tu-perfil-y-un-botón-que-borra-sus-datos)).

### 2.3 Abrir la consola y desactivar la caché

`F12` (Windows/Linux) o `Cmd`+`Option`+`I` (macOS) → pestaña **Console**. Dentro de las herramientas, pestaña **Network** → marcar **Disable cache**, y dejar las herramientas abiertas durante todo el guion: los ficheros JS y CSS se sirven sin huella de contenido en el nombre y el navegador los cachea con agresividad.

La consola no es opcional. Varios pasos sólo se pueden verificar leyendo lo que la aplicación escribe allí: las 20 llamadas a `console.*` de los siete ficheros cargados se emiten siempre, sin interruptor de depuración.

### 2.4 Dejar el estado limpio

El proyecto usa cuatro claves de `localStorage`. El botón «🗑️ Reiniciar todo» de la interfaz **no** las borra todas: `resetProfile()` (`js/app.js:216-223`) deja `transformlab_startDate` intacta. Para partir de cero hay que usar la consola:

```js
['transformlab_userProfile',
 'transformlab_generatedData',
 'transformlab_prefs',
 'transformlab_startDate'
].forEach(k => localStorage.removeItem(k));
location.reload();
```

Tras ejecutarlo, `Onboarding.hasCompletedOnboarding()` devuelve `false` (`js/onboarding.js:37-40`) y la aplicación arranca mostrando el asistente. **Este snippet es el punto de partida obligatorio del paso 1.**

### 2.5 Ventana horaria

Los botones de fecha rápida del asistente y el valor por defecto de la fecha de inicio usan `new Date().toISOString().split('T')[0]`, que convierte a UTC (`js/onboarding.js:77` y `:599`). En husos con desplazamiento positivo (Europa) eso devuelve **el día anterior** durante las primeras horas de la madrugada; en husos negativos (América) devuelve **el día siguiente** al final de la tarde. Es el defecto [`EST-11`](./CATALOGO-DE-HALLAZGOS.md#est-11--las-fechas-yyyy-mm-dd-se-parsean-como-utc-y-se-muestran-en-horario-local).

Para que el guion sea reproducible, **ejecútalo en horario central del día local** (entre las 09:00 y las 18:00). Si necesitas ejecutarlo fuera de esa ventana, anótalo en el registro: las fechas mostradas irán desplazadas un día y los pasos 10, 11 y 13 lo reflejarán.

---

## 3. Perfil canónico

Un único perfil para todo el guion. Cambiar cualquier campo invalida todas las cifras de la columna «Estado actual».

### Por qué este y no otro

- **Deja el músculo vacío**, que es la ruta por defecto: el 100 % de los usuarios sin báscula de bioimpedancia pasa por ella. El asistente autorrellena `muscleKg` con `estimateMuscleFromComposition` (`js/calculations.js:222-225`), el 48 % de la masa magra, y es exactamente esa combinación —músculo estimado alimentando un cálculo que espera músculo medido— la que dispara el defecto crítico. Un perfil con músculo introducido a mano toma la otra rama y **no** reproduce el fallo.
- **Hombre**: `MIN_SAFE_FAT.male` es 8 (`js/calculations.js:54-57`), lo que deja margen para fijar un 12 % objetivo sin chocar con el mínimo.
- **75 kg / 20 %**: es el ejemplo de referencia que ya usa la [auditoría](./AUDITORIA.md) y el [catálogo](./CATALOGO-DE-HALLAZGOS.md), de modo que las cifras son directamente contrastables con esos documentos.
- **30 kg de músculo objetivo**: es el mínimo que admite `validateStep(3)` (`js/onboarding.js:802`) y a la vez una ganancia plausible de +1,2 kg sobre los 28,8 estimados, así que atraviesa la validación sin errores ni avisos. Un objetivo más ambicioso enmascararía el defecto detrás de un error de validación.
- **Actividad moderada y experiencia intermedia**: multiplicador 1,55 y tasas de ganancia intermedias, los valores centrales de sus respectivas tablas.

### Valores a introducir

| Paso | Campo | Valor | Nota |
|---|---|---|---|
| **1. Perfil** | Edad | `30` | Por defecto ya es 30 |
| | Altura | `175` | Por defecto ya es 175 |
| | Sexo biológico | Masculino | Por defecto |
| | Experiencia | 💪 Intermedio | **Hay que cambiarlo**: por defecto es Principiante |
| | Nivel de actividad | Moderado (ejercicio 3-5 días/semana) | Por defecto |
| **2. Estado actual** | Peso actual | `75` | |
| | % Grasa corporal | `20` | |
| | Masa muscular (opcional) | **dejar vacío** | Imprescindible. Se autoestima en 28,8 kg |
| **3. Objetivos** | % Grasa objetivo | `12` | El mínimo permitido es 8 % |
| | Masa muscular objetivo | `30` | |
| | Peso objetivo (calculado) | *sólo lectura* | Lo rellena la aplicación. Es el paso 8 |
| | Fecha de inicio | pulsar «Hoy» | Fija el día 1 en la fecha de hoy |
| **4. Confirmar** | — | — | Sólo se revisa y se pulsa «🚀 Comenzar» |

### Magnitudes derivadas del perfil canónico

Todas verificadas ejecutando `js/calculations.js` y `js/dynamic-data-generator.js` en Node con el script de §6.

| Magnitud | Valor | Origen |
|---|---|---|
| Masa grasa inicial | 15,0 kg | `75 × 0,20` |
| Masa magra inicial | 60,0 kg | `75 × 0,80` |
| Músculo autoestimado | **28,8 kg** | `60 × 0,48` |
| Resto magro real | 31,2 kg | `60 − 28,8` |
| Resto magro tras el recorte | **10,0 kg** | `Math.max(2, Math.min(10, 31.2))`, `js/calculations.js:191` |
| BMR | 1.698,75 kcal | Mifflin-St Jeor, sin redondear (`js/calculations.js:80`) |
| TDEE | 2.633 kcal | `1698,75 × 1,55`, redondeado |
| Peso objetivo que muestra la app | **45,5 kg** | `(30 + 10) / 0,88` |
| Peso objetivo coherente con el modelo | **71,0 kg** | `30 / 0,48 / 0,88` |
| Duración del plan | 306 días · 44 semanas · 11 meses naturales | `calculatePhaseDurations` |
| Fases | Adaptación 14 · Recomposición 90 · Definición 98 · Volumen 60 · Transición 14 · Mantenimiento 30 | |
| Hitos generados | 17, de los cuales 8 sin día estimado | `generateMilestones` |

### Qué es reproducible y qué no

`addDailyFluctuation` (`js/calculations.js:647-652`) suma a cada peso diario un término `(Math.random() - 0.5) * 0.4`, es decir, **±0,2 kg no reproducibles**. Consecuencias, verificadas ejecutando la generación 40 veces con el mismo perfil:

| Campo | ¿Reproducible? |
|---|---|
| `physical.fatPct`, `physical.muscleKg` | **Sí**, exactos |
| `performance.*`, `wellbeing.*` | **Sí**, exactos |
| `phase`, `phaseType`, fechas, `nutrition.targetCalories` | **Sí**, exactos |
| Composición de las fases (`startComposition` / `endComposition`) | **Sí**, exactos |
| `physical.weight`, `fatKg`, `leanMassKg` | **No**: varían ±0,2 kg entre ejecuciones |
| `dailyChange.weight`, `weeklyChange.weight`, `weeklyChange.fatKg` | **No**: al ser diferencias de dos valores ruidosos, varían hasta ±0,4 kg |
| `nutrition.targetProtein` | **No**: `peso × 2,2` redondeado, varía ±1 g |

Por eso, en §4 **todo valor de peso se expresa como rango** y los puntos de comprobación finos se apoyan en `%` de grasa, músculo, fuerza y bienestar, que sí son deterministas. Donde el ruido es la única explicación posible de una discrepancia, el paso lo dice.

---

## 4. Guion de prueba de humo

Formato de cada paso: **Acción** (qué hacer), **Resultado esperado** (qué debería verse si el producto fuera correcto) y **Estado actual** (qué se ve hoy sobre `264c1db`, con el identificador del hallazgo cuando falla).

### Bloque A — Asistente de onboarding

**1. Arranque sin perfil**

- *Acción.* Ejecutar el snippet de §2.4 en la consola. Esperar la recarga.
- *Resultado esperado.* El overlay del asistente ocupa la pantalla, cabecera «TransformLab», los cuatro indicadores de progreso (Perfil · Estado actual · Objetivos · Confirmar) con el primero marcado, y el paso 1 «👤 Tu perfil» visible. El botón «← Anterior» está oculto y el de la derecha dice «Siguiente →».
- *Estado actual.* **PASA.**

**2. Paso 1 — validación de los campos obligatorios**

- *Acción.* Borrar el contenido del campo «Edad» y pulsar «Siguiente →». Después restaurar `30`, borrar «Altura» y pulsar «Siguiente →» otra vez.
- *Resultado esperado.* En ambos casos aparece un aviso emergente en la parte inferior: primero «Introduce una edad válida (16-80 años)», después «Introduce una altura válida (140-220 cm)». El asistente no avanza de paso.
- *Estado actual.* **PASA.** El aviso desaparece solo a los 3 segundos (`js/onboarding.js:824-838`).

**3. Paso 1 — introducir el perfil canónico**

- *Acción.* Edad `30`, Altura `175`, Sexo Masculino, Experiencia **💪 Intermedio**, Actividad **Moderado**. Pulsar «Siguiente →».
- *Resultado esperado.* La tarjeta de experiencia seleccionada se resalta al pulsarla y el asistente pasa al paso 2, «📊 Tu estado actual».
- *Estado actual.* **PASA.**

**4. Paso 2 — peso, grasa y el campo de músculo**

- *Acción.* Escribir `75` en «Peso actual» y `20` en «% Grasa corporal». **No tocar el campo «Masa muscular (opcional)».** Observarlo.
- *Resultado esperado.* El texto de ayuda bajo el campo de músculo pasa de «Se calculará automáticamente» a «Estimación basada en tu composición: ~28.8kg», y el campo se rellena con `28.8` para que el usuario vea el valor con el que se va a trabajar.
- *Estado actual.* **FALLA parcialmente.** El texto de ayuda sí cambia a «Estimación basada en tu composición: ~28.8kg», pero **el campo sigue vacío** mostrando el marcador «Auto-calculada»: `updateMuscleEstimate` (`js/onboarding.js:516-530`) escribe el valor en `userData.initial.muscleKg` y en el texto de ayuda, nunca en `muscleInput.value`. El dato con el que se calcula todo el plan no se muestra en su propio campo. Relacionado con [`EST-03`](./CATALOGO-DE-HALLAZGOS.md#est-03--retroceder-al-paso-2-no-recalcula-ni-el-músculo-estimado-ni-el-peso-objetivo).

**5. Paso 2 — vista previa de composición**

- *Acción.* Leer el bloque de barras que aparece bajo los campos.
- *Resultado esperado.* Tres barras: Grasa `15.0 kg (20%)`, Músculo `28.8 kg`, Masa magra `60.0 kg`. Debajo: «🔥 Metabolismo basal: **1699** kcal/día» y «⚡ Gasto total estimado: **2633** kcal/día».
- *Estado actual.* **FALLA.** Los tres valores de las barras son correctos, pero el metabolismo basal se muestra como **`1698.75`**: `calculateBMR` no redondea (`js/calculations.js:80`) y `updateCompositionPreview` lo interpola crudo (`js/onboarding.js:655`), junto a un TDEE que sí está redondeado. [`EST-14`](./CATALOGO-DE-HALLAZGOS.md#est-14--la-previsualización-de-composición-muestra-el-bmr-sin-redondear-y-con-barras-sin-limitar), [`MOT-19`](./CATALOGO-DE-HALLAZGOS.md#mot-19--bmr-se-devuelve-sin-redondear-y-se-pinta-con-decimales-en-la-interfaz).

**6. Paso 2 — congelación del músculo al retroceder**

- *Acción.* Pulsar «Siguiente →» para ir al paso 3, y volver inmediatamente con «← Anterior». Ya en el paso 2, cambiar el peso de `75` a `95`. Leer el campo de músculo y su texto de ayuda.
- *Resultado esperado.* El texto de ayuda dice «~36.5kg» y el campo de músculo se actualiza al mismo valor, porque el usuario nunca lo ha tecleado.
- *Estado actual.* **FALLA.** El texto de ayuda dice «Estimación basada en tu composición: ~36.5kg» pero el campo muestra `28.8` y `userData.initial.muscleKg` sigue valiendo 28,8: al volver, `renderInitialStep` (`js/onboarding.js:296`) pinta el valor almacenado, con lo que la guarda `if (!muscleInput.value)` deja de cumplirse y el músculo ya no se recalcula nunca más. [`EST-03`](./CATALOGO-DE-HALLAZGOS.md#est-03--retroceder-al-paso-2-no-recalcula-ni-el-músculo-estimado-ni-el-peso-objetivo).
- *Antes de seguir.* Devolver el peso a `75` y **borrar a mano** el campo de músculo, para que el resto del guion parta de la estimación limpia de 28,8 kg. Comprobar en la consola: `Onboarding.userData.initial` debe devolver `{weight: 75, fatPct: 20, muscleKg: 28.8}`.

**7. Paso 3 — límites del % de grasa objetivo**

- *Acción.* Avanzar al paso 3. Leer el texto de ayuda bajo «% Grasa objetivo». Escribir `5` y pulsar «Siguiente →».
- *Resultado esperado.* El texto dice «% (mín: 8%)» y al intentar avanzar aparece «Introduce un % de grasa objetivo válido (8-40%)».
- *Estado actual.* **PASA.** El mínimo procede de `MIN_SAFE_FAT.male = 8` (`js/calculations.js:54-57`).

**8. Paso 3 — peso objetivo calculado ← paso crítico**

- *Acción.* Escribir `12` en «% Grasa objetivo» y `30` en «Masa muscular objetivo». Leer el campo de sólo lectura «Peso objetivo (calculado)».
- *Resultado esperado.* **71,0 kg**, que es el valor coherente con el propio modelo de la aplicación: `30 / 0,48 / 0,88`. Es decir, una pérdida de 4 kg respecto a los 75 de partida para bajar de un 20 % a un 12 % de grasa ganando 1,2 kg de músculo.
- *Estado actual.* **FALLA. Este es el defecto crítico del producto.** El campo muestra **45,5 kg**. La cadena es: masa magra 60 kg, resto magro `60 − 28,8 = 31,2` kg, recortado a **10 kg** por `Math.max(2, Math.min(10, calculatedOtherLean))` (`js/calculations.js:191`), y de ahí `(30 + 10) / 0,88 = 45,5`. Se descartan 21,2 kg de masa magra. El resultado es un IMC de 14,9 para 175 cm. [`EST-01`](./CATALOGO-DE-HALLAZGOS.md#est-01--el-peso-objetivo-mostrado-y-persistido-es-absurdamente-bajo), [`MOT-01`](./CATALOGO-DE-HALLAZGOS.md#mot-01--calculatetargetweight-produce-pesos-objetivo-absurdos-en-la-ruta-por-defecto).
- *Comprobación complementaria en la consola.* Debe aparecer, una vez por cada pulsación de tecla en los dos campos: `⚠️ Other lean tissue adjusted from 31.20 to 10 kg (data may be inconsistent)`. El aviso existe pero sólo va a la consola: el usuario nunca lo ve.

**9. Paso 3 — panel de validación y resumen del plan**

- *Acción.* Leer el panel que aparece bajo los campos y el bloque «📅 Resumen del plan».
- *Resultado esperado.* Un aviso visible advirtiendo de que el peso objetivo se desvía un 39 % del actual, y un resumen coherente con él.
- *Estado actual.* **FALLA.** El panel muestra «✅ Objetivos válidos y alcanzables» **sin un solo aviso**: `validateInputs` devuelve `isValid: true`, `errors: []`, `warnings: []` para un objetivo de 45,5 kg, porque su única comprobación de rango del peso es inalcanzable por construcción. El resumen dice `306` días · `10.2` meses · `-9.5` kg grasa · `+1.2` kg músculo; los tres primeros están dimensionados contra el peso irreal. [`MOT-11`](./CATALOGO-DE-HALLAZGOS.md#mot-11--validateinputs-no-puede-detectar-un-peso-objetivo-fuera-de-rango-y-muestra-el-texto-nullkg).

**10. Paso 3 — fecha de inicio**

- *Acción.* Observar los tres botones «Hoy», «En 1 semana» y «En 2 semanas». Pulsar **«Hoy»**.
- *Resultado esperado.* Los tres botones son píldoras con borde redondeado, fondo translúcido y la tipografía Outfit, coherentes con el resto del modal. Al pulsar «Hoy», el campo de fecha queda con la fecha de hoy.
- *Estado actual.* **FALLA en el estilo, PASA en la función.** Los botones se pintan con el estilo por defecto del navegador —fondo gris claro, texto negro, esquinas cuadradas— sobre el modal casi negro: `styles_new.css:143-165` estila `.quick-date-btn` mientras `js/onboarding.js:351-353` genera `class="quick-date"`. La fecha sí se fija correctamente si se cumple la ventana horaria de §2.5. [`FRO-04`](./CATALOGO-DE-HALLAZGOS.md#fro-04--los-botones-de-fecha-rápida-del-onboarding-no-reciben-ningún-estilo).

**11. Paso 4 — pantalla de confirmación**

- *Acción.* Pulsar «Siguiente →» y leer las cuatro tarjetas y la lista de fases.
- *Resultado esperado.* Perfil: «30 años, Masculino», «175 cm», «Nivel: Intermedio». Estado inicial: **75** kg, **20** % grasa, **28.8** kg músculo. Objetivos: **71** kg, **12** % grasa, **30** kg músculo. Timeline: inicio hoy, duración **306 días (~10 meses)**. Seis fases: Adaptación 14 · Recomposición 90 · Definición 98 · Volumen 60 · Transición 14 · Mantenimiento 30.
- *Estado actual.* **FALLA en un valor.** Todo coincide salvo el peso objetivo, que se confirma como **45.5 kg**: es el mismo defecto del paso 8, ya persistido en el objeto que se va a guardar. Observación adicional, **no catalogada**: «Fin estimado» se calcula como `startDate + totalDays` (`js/onboarding.js:397-398`) mientras el último día de la serie generada es `startDate + totalDays − 1`, así que la fecha mostrada aquí va **un día por delante** de `metadata.timeline.endDate`. Con inicio el 3 de agosto de 2026, la pantalla dice 5/6/2027 y la metadata guarda `2027-06-04`.

**12. «🚀 Comenzar» — generación de los datos**

- *Acción.* Pulsar «🚀 Comenzar» con la consola visible.
- *Resultado esperado.* El overlay se cierra y aparece el panel. En la consola, la traza de generación sin ninguna advertencia de valores fuera de rango.
- *Estado actual.* **FALLA.** El panel sí aparece, pero la consola emite, en este orden:

  ```text
  🧮 Generando datos de transformación...
  📊 Initial composition analysis: {weight: 75, fatPct: 20, muscleKg: 28.8,
      leanMass: 60, otherLeanTissue: 10, adjusted: true}
  ⚠️ Other lean tissue adjusted from 31.20 to 10 kg (data may be inconsistent)
  ⚠️ Phase Definición: Calculated endWeight (38.7kg) out of range, capping
  ⚠️ Phase Definición: Calculated endFatPct (-3.2%) out of range, capping
  ✅ Generated 17 dynamic milestones
  ✅ Datos generados: {days: 306, weeks: 44, months: 11, phases: 6, milestones: 17}
  ```

  Las dos advertencias de la definición son el guardarraíl silencioso: el plan calcula un peso de 38,7 kg y un **−3,2 % de grasa corporal**, valores físicamente imposibles, los capa a 40 kg y 5 % y continúa sin decirle nada al usuario. [`GEN-01`](./CATALOGO-DE-HALLAZGOS.md#gen-01--el-clamp-de-otherleantissue-a-2-10-kg-hunde-toda-la-proyección), [`GEN-13`](./CATALOGO-DE-HALLAZGOS.md#gen-13--los-guardarraíles-capan-valores-imposibles-en-silencio-y-el-mantenimiento-fuerza-el-objetivo-de-golpe).

### Bloque B — Panel principal

**13. Arranque del panel y recarga**

- *Acción.* Recargar la página con `Cmd`/`Ctrl`+`Shift`+`R` y leer la cabecera y la consola.
- *Resultado esperado.* Cabecera: «Semana 1 de 44», el rango de fechas de la primera semana, insignia de fase «Adaptación» y el objetivo «🎯 75kg → 71kg». En la consola, la traza de carga sin datos personales.
- *Estado actual.* **FALLA en dos puntos.** La estructura es correcta —«Semana 1 de 44», insignia «Adaptación», granularidad «Semana» activa— pero el objetivo se lee **«🎯 75kg → 45.5kg»**. Y la consola escribe el peso y el objetivo en claro:

  ```text
  ✅ Datos cargados: 306 días, 44 semanas
  📅 Fecha de inicio: <fecha de hoy>
  👤 Perfil: intermediate, 75kg → 45.5kg
  📊 Posición actual: Día 1 de 306
  🚀 TransformLab inicializado
  ```

  La línea del perfil es [`ING-12`](./CATALOGO-DE-HALLAZGOS.md#ing-12--el-perfil-del-usuario-se-escribe-en-la-consola-del-navegador): datos de salud volcados sin necesidad a un canal que se comparte con frecuencia.

**14. Tarjeta Físico**

- *Acción.* Leer los cuatro valores y sus cuatro indicadores de cambio.
- *Resultado esperado.* Peso entre `74.3` y `74.7 kg` (rango por el ruido diario), Músculo `28.9 kg`, % Grasa `19.9%`, Grasa `14.7` o `14.8 kg`. Los cuatro indicadores de cambio muestran icono, número y unidad.
- *Estado actual.* **FALLA en dos indicadores de cuatro.** Los valores son correctos. Los cambios de Peso y Músculo se muestran bien (`→ 0.00 kg` en la semana 1, porque el generador emite `{0,0,0}` para la primera semana). Pero:
  - **% Grasa** muestra siempre **`→ --%`**, en cualquier semana y cualquier granularidad: `renderMetricCards` lee `changes.fatPct` (`js/dashboard.js:382`) y el generador nunca produce esa clave. [`REN-05`](./CATALOGO-DE-HALLAZGOS.md#ren-05--el-delta-de--grasa-siempre-se-muestra-como---).
  - **Grasa** muestra **`→ kg`**, sin número: falta la llamada a `formatChange` (`js/dashboard.js:387`). El dato existe y se está calculando. [`REN-04`](./CATALOGO-DE-HALLAZGOS.md#ren-04--la-tarjeta-físico-muestra-el-cambio-de-grasa-sin-número).
  - *Confirmación.* Pulsar `›` una vez (semana 2) y volver a mirar: % Grasa sigue en `--%` aunque el valor baje de 19,9 a 19,7, y Grasa pasa a `↓ kg`, con icono pero sin cifra.

**15. Tarjetas Rendimiento y Bienestar**

- *Acción.* Volver a la semana 1 con `‹` y leer las dos tarjetas.
- *Resultado esperado y estado actual.* **PASA.** Rendimiento: Fuerza `31/100` con la barra al 31 %, Agilidad `4.1/10` con la barra al 41 %. Bienestar: Energía `6.5`, Estética `5.1`, Autoestima `5.1`, Ánimo `6.5`. Los seis valores son deterministas: si no coinciden exactamente, el perfil introducido no es el canónico.

**16. Tarjeta Metabolismo y rejilla del panel**

- *Acción.* Leer los cuatro valores de la tarjeta y observar cómo se distribuyen las cuatro tarjetas en una ventana de al menos 1.300 px de ancho.
- *Resultado esperado.* TMB Actual `1699 kcal`, TDEE Actual `2633 kcal`, TMB Objetivo y TDEE Objetivo calculados sobre un peso objetivo plausible. Las cuatro tarjetas ocupan una sola fila.
- *Estado actual.* **FALLA en ambos aspectos.**
  - TMB Actual `1699` y TDEE Actual `2633` son correctos. **TMB Objetivo `1404 kcal`** y **TDEE Objetivo `2176 kcal`** son la propagación del defecto crítico: son el metabolismo de una persona de 45,5 kg. Es la manifestación más silenciosa del fallo, porque los números parecen razonables por sí solos.
  - Las tarjetas Físico, Rendimiento y Bienestar ocupan la primera fila y **Metabolismo aparece sola en una segunda**, con dos tercios de ancho en blanco a su derecha: `.dashboard-row` declara `repeat(3, 1fr)` (`styles_new.css:725`) y el HTML pinta cuatro hijos. Sólo visible por encima de 1.200 px. [`FRO-02`](./CATALOGO-DE-HALLAZGOS.md#fro-02--la-rejilla-del-dashboard-tiene-3-columnas-pero-el-html-pinta-4-tarjetas).

**17. Indicador de fase**

- *Acción.* En la semana 1, leer la tarjeta del indicador de fase.
- *Resultado esperado.* Título «Adaptación» en tamaño grande y peso 700, «Semana 1 de 2», barra al 7 %, descripción «Adaptación al nuevo régimen de entrenamiento», fechas de la fase, y los dos cambios esperados: Músculo `+0.20 kg`, Grasa `-0.30 kg`.
- *Estado actual.* **PASA en los datos, FALLA en la tipografía.** Todos los valores son correctos. El nombre de la fase se renderiza a 14,4 px con peso 500 —más pequeño que el título de las tarjetas contiguas— en lugar de a 19,2 px con peso 700: `.phase-name` está definido dos veces con la misma especificidad (`styles_new.css:925` y `:1972`) y gana la segunda, que estaba pensada para la lista de fases del asistente. [`FRO-03`](./CATALOGO-DE-HALLAZGOS.md#fro-03--phase-name-está-duplicado-y-la-segunda-definición-degrada-el-título-del-indicador-de-fase).

**18. Progreso hacia objetivos**

- *Acción.* Leer las cuatro barras de la tarjeta «🎯 Progreso hacia Objetivos».
- *Resultado esperado.* Músculo `28.9kg / 30.0kg` al 8 %, Grasa `19.9% / 12.0%` al 2 %, y Fuerza y Estética partiendo de sus valores reales del día 1, es decir, cerca del 0 %.
- *Estado actual.* **FALLA en dos barras de cuatro.** Músculo (8 %) y Grasa (2 %) son correctos. Pero **Fuerza marca ya un 18 %** (`31.0 / 80.0`) y **Estética un 42 %** (`5.1 / 8.0`) en la primera semana, sin haber entrenado un solo día: los extremos de esas dos barras están escritos a mano en la metadata como `strength: 20 → 80` y `aesthetics: 3 → 8` (`js/dynamic-data-generator.js:532`), mientras la serie real arranca en 31 y 5,1. [`GEN-08`](./CATALOGO-DE-HALLAZGOS.md#gen-08--initialcomposition-y-targetcomposition-llevan-strength-y-aesthetics-hardcodeados).

**19. Gráfico — series visibles y forma de la curva**

- *Acción.* Observar la leyenda del gráfico, las seis píldoras de métrica de la cabecera del gráfico, y la forma de la línea de Peso a lo largo de las 44 semanas.
- *Resultado esperado.* Las píldoras activas y las series dibujadas coinciden. La línea de Peso baja de 75 kg a un valor cercano al objetivo de forma gradual, sin desplomes.
- *Estado actual.* **FALLA en ambos aspectos.**
  - Se dibujan **tres** series —Peso, Músculo y % Grasa, porque `AppState.ui.visibleMetrics` arranca con las tres (`js/app.js:37`)— mientras sólo **dos** píldoras aparecen activas: `index.html:116-121` marca `active` en «Peso» y «Músculo» pero no en «% Grasa». La leyenda del gráfico y la fila de píldoras se contradicen desde el primer arranque. Observación **no catalogada**; es puro desajuste entre el estado por defecto del JS y el marcado inicial.
  - La línea de Peso **se desploma de ~72,9 kg en la semana 3 a ~45,6 kg en la semana 15**, es decir, 27 kg en doce semanas de una fase llamada «Recomposición», y sigue bajando hasta un mínimo de ~39,6 kg en la semana 29 antes de remontar. `phases[1].totalChange.weight` vale **−28,3 kg**. Es el defecto crítico dibujado. [`GEN-01`](./CATALOGO-DE-HALLAZGOS.md#gen-01--el-clamp-de-otherleantissue-a-2-10-kg-hunde-toda-la-proyección).

**20. Gráfico — hover**

- *Acción.* Pasar el ratón lentamente sobre el gráfico, de izquierda a derecha, y observar el panel que hay sobre él.
- *Resultado esperado.* El panel sustituye el texto «👆 Pasa el ratón sobre el gráfico para ver detalles» por el nombre de la fase presentado como píldora de color, y los tres valores Peso, Músculo y Grasa. El panel recibe un borde de estado activo mientras el puntero está encima.
- *Estado actual.* **FALLA parcialmente.** Los cuatro datos aparecen y son correctos, pero el nombre de la fase se muestra **como texto plano heredado del `body`**, sin la píldora de color: `updateHoverPanel` emite `.hover-content` y `.hover-title` (`js/charts.js:367-369`), clases que `styles_new.css` no define; la hoja estila en cambio `.hover-header`/`.hover-phase`, que ningún JS produce. Además la regla `.hover-panel.active` (`styles_new.css:1198`) nunca se activa porque nadie añade esa clase. [`REN-18`](./CATALOGO-DE-HALLAZGOS.md#ren-18--el-panel-de-hover-emite-un-marcado-que-la-hoja-de-estilos-no-contempla).

**21. Gráfico — clic (granularidad semanal)**

- *Acción.* En granularidad «Semana», hacer clic sobre el punto de la semana 20 de la serie de Peso.
- *Resultado esperado.* El panel navega a la semana 20: cabecera «Semana 20 de 44», tarjetas actualizadas y el indicador de fase reflejando la posición dentro de «Definición».
- *Estado actual.* **PASA con reserva.** El clic sí navega: cabecera «Semana 20 de 44», Físico con Músculo `29.7 kg` y % Grasa `10.5%`, Rendimiento Fuerza `48/100`. El indicador de fase **sí se mueve** en esta ruta, porque `handleChartClick` escribe también `currentDay` (`js/charts.js:414`), a diferencia de los botones `‹`/`›` (ver paso 22). La reserva: no se actualizan ni `currentMonth` ni el punto de resalte del gráfico, así que si a continuación se pulsa «Mes» se muestra un mes sin relación con lo seleccionado. [`REN-12`](./CATALOGO-DE-HALLAZGOS.md#ren-12--handlechartclick-deja-el-estado-de-navegación-parcialmente-sincronizado).

**22. Navegación con `‹` y `›`**

- *Acción.* Volver a la semana 1 (recargar la página es lo más rápido). Comprobar que `‹` está deshabilitado. Pulsar `›` veintiocho veces hasta llegar a la semana 29, observando el indicador de fase en las semanas 2, 3 y 20.
- *Resultado esperado.* `‹` deshabilitado en la semana 1. Al pasar a la semana 3, el indicador cambia a «Recomposición» y la barra empieza a avanzar; en la semana 20, ya en «Definición», la barra marca en torno al 40 %.
- *Estado actual.* **FALLA.** El nombre de la fase y las fechas sí cambian correctamente (Adaptación en S1-S2, Recomposición en S3-S15, Definición en S16-S29), pero **la barra de progreso y el contador de semanas se quedan clavados**: en la semana 3 muestra «Semana 1 de 13» al 1 %, y en la semana 20 sigue mostrando «Semana 1 de 14» al 1 %. Causa: los objetos de `weekly[]` no tienen `dayInPhase` y `navigateTo` en granularidad semanal no actualiza `currentDay`, que sigue valiendo 1 desde el arranque (`js/dashboard.js:515-520`). [`REN-02`](./CATALOGO-DE-HALLAZGOS.md#ren-02--el-indicador-de-fase-no-avanza-al-navegar-en-granularidad-semanal-o-mensual).

**23. Botón «Hoy»**

- *Acción.* Pulsar «Hoy». La fecha de inicio del plan es hoy, así que el día actual es el día 1.
- *Resultado esperado.* El panel vuelve a la posición real de hoy: día 1 de 306, en la fase «Adaptación», respetando la granularidad activa.
- *Estado actual.* **FALLA.** El panel salta al **día 153 de 306** —fase «Definición», % Grasa `9.3%`, objetivo calórico `1750 kcal`— y además fuerza la granularidad a «Día». `navigateToToday` conserva código de demostración: `Math.floor(getTotalDays()/2)` (`js/app.js:615-623`), ignorando `calculateCurrentPosition()`, que ya sabe calcular el día real. [`EST-06`](./CATALOGO-DE-HALLAZGOS.md#est-06--el-botón-hoy-navega-al-punto-medio-del-plan).

**24. Granularidad «Día»**

- *Acción.* Con la granularidad ya en «Día» tras el paso anterior, pulsar `Home` para ir al día 1. Leer la cabecera. Después intentar navegar haciendo clic directamente sobre el gráfico, en varios puntos distintos.
- *Resultado esperado.* Cabecera «Día 1 de 306» con la fecha y el día de la semana. El clic sobre el gráfico navega al día correspondiente, igual que en granularidad semanal.
- *Estado actual.* **FALLA en el clic.** La cabecera es correcta y el tooltip responde en toda la columna al pasar el ratón, pero **el clic no navega**: `handleChartClick` usa `getElementsAtEventForMode` con `intersect: true` (`js/charts.js:403`) mientras los datasets diarios se crean con `pointRadius: 0` (`js/charts.js:59`), de modo que el área de impacto efectiva es de ~1 px. Nota: tras haber navegado alguna vez con el teclado o las flechas, `updateChartHighlight` reescribe el radio a 2 y algunos clics empiezan a acertar. [`REN-07`](./CATALOGO-DE-HALLAZGOS.md#ren-07--el-clic-sobre-el-gráfico-no-navega-en-granularidad-diaria), [`REN-16`](./CATALOGO-DE-HALLAZGOS.md#ren-16--updatecharthighlight-anula-la-optimización-de-pointradius-0-y-no-restaura-el-estilo-original).

**25. Granularidad «Mes»**

- *Acción.* Pulsar «Mes». Leer la cabecera: el texto de la insignia de fase y **su color de fondo**.
- *Resultado esperado.* «Mes 1 de 11» y una insignia cuyo texto y color describan la misma fase.
- *Estado actual.* **FALLA.** La cabecera dice «Mes 1 de 11» (el número total depende del mes de inicio: 11 con inicio el 3 de agosto de 2026) y la insignia dice **«Recomposición»** pintada con el **morado de «Adaptación»** (`#9b59b6`): en los datos mensuales, `phase` se calcula como la fase dominante por número de días mientras `phaseType` se toma del primer día del mes (`js/dynamic-data-generator.js:446` y `:461`), y el mes 1 contiene ambas. La cabecera usa `phaseType` para el color y `phase` para el texto. [`GEN-07`](./CATALOGO-DE-HALLAZGOS.md#gen-07--en-los-datos-mensuales-phase-y-phasetype-pueden-referirse-a-fases-distintas).
- *Nota.* El `TypeError` de [`REN-03`](./CATALOGO-DE-HALLAZGOS.md#ren-03--typeerror-en-rendernavigation-al-entrar-en-vista-mensual-cerca-del-final-del-plan) **no** se reproduce con este perfil partiendo del día 1: exige `currentDay > 30 × nº de meses`, es decir, los últimos días del plan. Para provocarlo hay que fijar la fecha de inicio 300 días atrás.

**26. Panel de insights**

- *Acción.* Volver a granularidad «Semana» y a la semana 1. Leer el panel «💡 Insights». Después navegar con `›` hasta la semana 20 y volver a leerlo.
- *Resultado esperado.* En la semana 1, un único ítem: «Estás en la fase "Adaptación"». Al llegar a la semana 20, el panel cambia y muestra los insights de «Definición».
- *Estado actual.* **FALLA.** En la semana 1 el contenido es correcto —exactamente un ítem, porque los cambios de la primera semana son cero y ningún umbral de bienestar se cruza— pero **el panel no se actualiza nunca**: sigue diciendo «Estás en la fase "Adaptación"» en la semana 20, en la 30 y en la 44. `renderInsights()` se invoca en un único punto de todo el código cargado, `js/app.js:407`, dentro de `initializeApp()`; ni `navigateTo`, ni `setGranularity`, ni `handleChartClick` la vuelven a llamar. [`REN-01`](./CATALOGO-DE-HALLAZGOS.md#ren-01--los-insights-se-congelan-renderinsights-sólo-se-llama-una-vez), [`EST-13`](./CATALOGO-DE-HALLAZGOS.md#est-13--guardar-una-nueva-fecha-de-inicio-no-re-renderiza-el-panel-de-insights).

**27. Toggles de métrica del gráfico**

- *Acción.* Pulsar «Peso» y después «Músculo» para desactivarlos, dejando visible sólo «% Grasa». Observar los ejes verticales del gráfico. Después reactivar «Peso». Por último, desactivar todas las métricas una a una.
- *Resultado esperado.* Con una sola métrica de escala porcentual, un eje a la derecha correctamente rotulado. Nunca se puede quedar el gráfico sin ninguna serie.
- *Estado actual.* **FALLA en los ejes, PASA en la guarda.** El gráfico redibuja correctamente y `toggleMetric` (`js/app.js:702-710`) impide desactivar la última métrica. Pero al dejar sólo métricas del grupo `y1` aparecen **dos ejes a la izquierda** —uno vacío y sin título, y otro autogenerado por Chart.js sin estilo— y ninguno a la derecha: `getAxisForMetric` devuelve `'y1'` incondicionalmente mientras la declaración del eje `y1` está condicionada a que convivan métricas de los dos grupos (`js/charts.js:226`, frente a la declaración condicional de `:67` y `:138`). [`REN-10`](./CATALOGO-DE-HALLAZGOS.md#ren-10--el-eje-y1-sólo-se-declara-si-conviven-métricas-de-los-dos-grupos).

**28. Modal de ajustes**

- *Acción.* Pulsar el botón «⚙️ Inicio: …» de la cabecera. Leer el contenido. Pulsar `Escape`. Cerrar con «Cerrar». Volver a pulsar el botón de ajustes **dos veces seguidas y rápido**.
- *Resultado esperado.* El modal muestra el perfil y el rango de objetivos; `Escape` lo cierra; abrirlo dos veces no apila dos modales.
- *Estado actual.* **FALLA en dos de tres.** El contenido es correcto en estructura y refleja el defecto crítico: «Peso: 75kg → 45.5kg», «Grasa: 20% → 12%», «Músculo: 28.8kg → 30kg».
  - **`Escape` no cierra nada.** Ningún overlay del proyecto registra un manejador de `Escape`, ninguno lleva `role="dialog"` y no existe una sola llamada a `.focus()` en todo el árbol. [`FRO-06`](./CATALOGO-DE-HALLAZGOS.md#fro-06--los-overlays-modales-no-capturan-el-foco-no-se-cierran-con-escape-y-no-lo-devuelven).
  - **Dos clics rápidos apilan dos modales** con los mismos identificadores; al pulsar «Cerrar» desaparece el primero y queda el segundo visible con el botón «Guardar cambios» inerte, porque su listener se registró sobre el nodo del primero. Se sale haciendo clic en el fondo. [`EST-10`](./CATALOGO-DE-HALLAZGOS.md#est-10--abrir-dos-veces-el-modal-de-ajustes-genera-ids-duplicados).

**29. Exportación de datos**

- *Acción.* Cerrar el modal. Pulsar el botón «📄» de la cabecera. Abrir el fichero descargado.
- *Resultado esperado.* Se descarga `TransformLab_Informe_AAAA-MM-DD.md` con el informe en español y todos los campos legibles.
- *Estado actual.* **FALLA en tres campos.** El fichero se descarga y su estructura es correcta. Pero:
  - «Nivel de actividad» se exporta como **`moderate`** y «Experiencia» como **`intermediate`**, con las claves internas en inglés, pese a que la tarjeta metabólica sí las traduce (`js/dashboard.js:455-461`).
  - En la tabla «🏆 Hitos del Proceso», **8 de los 17 hitos tienen «-» en la columna «Día Est.»**: los de categorías `abs`, `vascularity`, `face` y `arms` se generan sin `progressRequired`, con lo que su `estimatedDay` sale `NaN` y el export lo enmascara con `|| '-'`. [`GEN-03`](./CATALOGO-DE-HALLAZGOS.md#gen-03--los-hitos-estéticos-se-generan-con-estimatedday--nan), [`REN-17`](./CATALOGO-DE-HALLAZGOS.md#ren-17--exportprojectdata-informa-femenino-por-defecto-y-vuelca-claves-internas-sin-traducir).
  - El informe contiene datos de salud y se descarga **sin ninguna confirmación previa** ni aviso de qué se va a guardar.

**30. Reinicio de perfil**

- *Acción.* Abrir el modal de ajustes, pulsar «🗑️ Reiniciar todo» y aceptar. Cuando la página recargue, ejecutar en la consola: `Object.keys(localStorage).filter(k => k.startsWith('transformlab_'))`.
- *Resultado esperado.* Reaparece el asistente y el array devuelto está vacío.
- *Estado actual.* **PASA con reserva.** El asistente reaparece y las tres claves que borra `resetProfile` (`js/app.js:216-223`) desaparecen. La reserva: **`transformlab_startDate` no se borra nunca**. Hoy no hay efecto observable porque `saveStartDate` (`js/app.js:445-448`) no se invoca desde ningún punto del árbol y la clave no llega a existir; si existiera de una sesión anterior, `loadPreferences` la releería y pisaría la fecha de inicio de la nueva proyección (`js/app.js:431-434`). Por eso §2.4 borra las cuatro a mano.

---

## 5. Comprobaciones de accesibilidad mínimas

Cuatro comprobaciones ejecutables sin lector de pantalla, sin extensiones y sin auditor automático. No sustituyen una auditoría WCAG; detectan lo que hoy está roto de forma más evidente.

### A1 — Recorrido completo con el tabulador

- *Acción.* Con el panel cargado, hacer clic en la barra de direcciones y pulsar `Tab` repetidamente, anotando en qué elemento cae el foco y si se ve dónde está. Recorrer el ciclo entero hasta volver al navegador.
- *Resultado esperado.* Catorce paradas dentro de la página, en este orden: exportar `📄`, ajustes `⚙️`, `Día`, `Semana`, `Mes`, la barra de línea de tiempo, `‹`, `›`, `Hoy`, y las seis píldoras de métrica. En todas, un indicador de foco claramente visible sobre el fondo oscuro.
- *Estado actual.* **FALLA en dos puntos.**
  - **La barra de línea de tiempo se omite**: el foco salta de `Mes` directamente a `‹`. `#timelineBar` es un `<div>` con un listener de `click` (`index.html:64`, `js/app.js:648`) sin `role`, sin `tabindex` y sin manejador de teclado. Un `grep -rn "tabindex\|role=\|aria-" index.html js/` devuelve **0 coincidencias en todo el proyecto**. [`FRO-05`](./CATALOGO-DE-HALLAZGOS.md#fro-05--la-barra-de-línea-de-tiempo-es-un-div-clicable-sin-rol-sin-tabindex-y-sin-teclado), [`FRO-18`](./CATALOGO-DE-HALLAZGOS.md#fro-18--botones-sin-nombre-accesible-y-toggles-sin-estado-expuesto).
  - **No existe ningún estilo de foco propio.** `grep -n "focus-visible" styles_new.css` devuelve 0 resultados y las cuatro apariciones de `outline` son `outline: none`. Sobre los botones el anillo por defecto del navegador es apenas perceptible contra `#0a0a0f`, y sobre las píldoras de métrica activas —fondo saturado— se pierde por completo. [`FRO-19`](./CATALOGO-DE-HALLAZGOS.md#fro-19--no-existe-ningún-estilo-de-foco-de-teclado-y-se-anula-el-outline-nativo).
- *Cómo anotarlo.* Registrar el número de paradas observadas (hoy: 13 de 14) y en cuántas el foco es identificable a simple vista.

### A2 — Modal abierto: foco y `Escape`

- *Acción.* Abrir el modal de ajustes con el ratón. Pulsar `Tab` seis veces seguidas observando dónde va el foco. Pulsar `Escape`. Con el modal aún abierto y sin foco en ningún campo, pulsar la tecla `2` y luego la flecha `→`. Cerrar con «Cerrar» y pulsar `Tab` una vez.
- *Resultado esperado.* El foco entra en el modal al abrirlo, queda atrapado en sus cinco controles, `Escape` lo cierra, las teclas de la aplicación de fondo no responden, y al cerrar el foco vuelve al botón que lo abrió.
- *Estado actual.* **FALLA en los cuatro aspectos.**
  - El foco **no entra** en el modal al abrirlo: sigue donde estaba.
  - Tras recorrer los controles del modal, el foco **se escapa** a los botones `Día`/`Semana`/`Mes` y a las píldoras de métrica que están detrás del overlay opaco. No hay `inert` ni `aria-hidden` sobre `.app-container`.
  - **`Escape` no hace nada.**
  - **`2` y `→` operan sobre el panel oculto**: `2` ejecuta `setGranularity('weekly')` y `→` avanza de periodo, escribiendo además en `transformlab_prefs`. `handleKeyboard` sólo se abstiene si `e.target.tagName === 'INPUT'` (`js/app.js:652`) y no comprueba si hay un modal abierto. Al cerrar, el usuario descubre que ha cambiado de semana.
  - Al cerrar, el foco vuelve a `<body>` y el siguiente `Tab` reinicia el recorrido desde el principio de la página.
  - [`FRO-06`](./CATALOGO-DE-HALLAZGOS.md#fro-06--los-overlays-modales-no-capturan-el-foco-no-se-cierran-con-escape-y-no-lo-devuelven), [`FRO-07`](./CATALOGO-DE-HALLAZGOS.md#fro-07--los-atajos-de-teclado-globales-siguen-activos-con-un-modal-abierto), [`EST-16`](./CATALOGO-DE-HALLAZGOS.md#est-16--los-atajos-de-teclado-sólo-se-desactivan-sobre-input).

### A3 — Zoom al 200 %

- *Acción.* Ventana maximizada en una pantalla de al menos 1.280 px. Pulsar `Cmd`/`Ctrl`+`+` hasta llegar al 200 % (el indicador del navegador lo muestra). Recorrer la página entera. Después, ejecutar en la consola:

  ```js
  // Desbordamiento horizontal real, que `overflow-x: hidden` oculta
  document.documentElement.scrollWidth - document.documentElement.clientWidth
  ```

  ```js
  // Qué elementos se salen por la derecha (ignorar .cursor-glow: es un halo fijo de 400 px)
  [...document.querySelectorAll('body *')]
    .filter(e => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
    .map(e => `${e.tagName}.${e.className}`)
  ```

- *Resultado esperado.* WCAG 2.1 SC 1.4.10 exige que al 200 % no haya que desplazarse en dos direcciones. La primera expresión debe devolver `0` y la segunda un array vacío (salvo `.cursor-glow`).
- *Estado actual.* **Requiere medición; no se puede juzgar a ojo.** `body { overflow-x: hidden }` (`styles_new.css:429`) suprime la barra de desplazamiento horizontal, de modo que cualquier desborde se **recorta en silencio** en vez de manifestarse. Por eso la comprobación visual no vale y hay que usar las dos expresiones de arriba. Los candidatos conocidos son `.comp-bar` con 160 px de columnas fijas (`styles_new.css:1788`), `.nav-label` con `min-width: 120px` y el propio `.cursor-glow`. [`FRO-24`](./CATALOGO-DE-HALLAZGOS.md#fro-24--body--overflow-x-hidden--enmascara-desbordes-horizontales).
- *Cómo anotarlo.* Registrar el número devuelto por la primera expresión y la lista completa de la segunda.

### A4 — Ancho de 375 px

- *Acción.* Herramientas de desarrollo → modo dispositivo → anchura `375` px. Recorrer el panel. Después ejecutar el snippet de §2.4 para volver al asistente y recorrer sus cuatro pasos, prestando atención al paso 2 y a su vista previa de composición. En cada pantalla, ejecutar la segunda expresión de A3.
- *Resultado esperado.* Ningún elemento se sale del viewport y las tres barras de composición del paso 2 se leen enteras: etiqueta, barra y valor.
- *Estado actual.* **FALLA en el asistente.** `.onboarding-overlay` conserva `padding: 2rem` en todos los anchos (`styles_new.css:1537`): ninguno de los bloques móviles lo reduce, y los dos intentos de ajuste de `styles_new.css:2576` y `:2700` apuntan a `.onboarding-card`, un selector que no existe —el elemento real es `.onboarding-container`—, con lo que el `max-height: 85vh; overflow-y: auto` previsto para móvil tampoco se aplica. `.comp-bar` mantiene `grid-template-columns: 80px 1fr 80px` más gaps, es decir, 160 px fijos más el espacio de la barra, dentro de un contenedor ya recortado por tres niveles de padding. [`FRO-23`](./CATALOGO-DE-HALLAZGOS.md#fro-23--el-overlay-del-onboarding-conserva-2rem-de-padding-en-móvil-pequeño).
- *Complemento.* Activar «Reducir movimiento» en el sistema operativo y recargar: el spinner de carga sigue girando y el halo del cursor sigue persiguiendo el puntero. `grep -rn "prefers-reduced-motion" styles_new.css css/ js/` devuelve **0 resultados**. [`FRO-12`](./CATALOGO-DE-HALLAZGOS.md#fro-12--no-existe-ninguna-media-query-prefers-reduced-motion).

---

## 6. Comprobación del motor en Node

Este script no toca el navegador ni `localStorage`: carga `js/calculations.js` y `js/dynamic-data-generator.js` con un shim de `window` y comprueba invariantes que hoy no se cumplen. Es la parte reproducible y automatizable del guion, y la única que se puede ejecutar en un segundo tras cada cambio en el motor.

Guardar como `verificacion.js` en la raíz del repositorio y ejecutar `node verificacion.js`. No requiere instalar nada.

```js
// verificacion.js - Comprobación del motor de TransformLab fuera del navegador.
// Uso: node verificacion.js   (desde la raíz del repositorio)
// No modifica nada: sólo carga js/calculations.js y js/dynamic-data-generator.js
// con un shim de `window` y comprueba invariantes.

const fs = require('node:fs');
const path = require('node:path');

const raiz = process.cwd();
for (const f of ['js/calculations.js', 'js/dynamic-data-generator.js']) {
  if (!fs.existsSync(path.join(raiz, f))) {
    console.error(`No encuentro ${f}. Ejecuta este script desde la raíz del repositorio.`);
    process.exit(1);
  }
}

global.window = global;
const silencio = { log: console.log, warn: console.warn };
const callar = () => { console.log = () => {}; console.warn = () => {}; };
const hablar = () => { console.log = silencio.log; console.warn = silencio.warn; };

callar();
eval(fs.readFileSync(path.join(raiz, 'js/calculations.js'), 'utf8'));
eval(fs.readFileSync(path.join(raiz, 'js/dynamic-data-generator.js'), 'utf8'));
hablar();

const C = global.Calculations;
const G = global.DataGenerator;

let fallos = 0;
const comprobar = (etiqueta, obtenido, esperado) => {
  const ok = String(obtenido) === String(esperado);
  if (!ok) fallos++;
  console.log(`  ${ok ? 'OK  ' : 'FALLA'}  ${etiqueta}: ${obtenido}${ok ? '' : `  (esperado ${esperado})`}`);
};

// ---------------------------------------------------------------------------
console.log('\n[1] Prueba de identidad de calculateTargetWeight');
console.log('    Pedir como objetivo la composicion ACTUAL debe devolver el peso ACTUAL.');
const casos = [
  { w: 80, f: 20 },
  { w: 60, f: 28 },
  { w: 95, f: 30 },
  { w: 70, f: 12 },
];
callar();
const identidad = casos.map(({ w, f }) => {
  const m = C.estimateMuscleFromComposition(w, f);
  const obj = C.calculateTargetWeight(m, f, { weight: w, fatPct: f, muscleKg: m });
  return { w, f, m, obj, desvio: Math.round((obj - w) * 10) / 10 };
});
hablar();
for (const r of identidad) {
  console.log(`    ${r.w} kg / ${r.f} % (musculo estimado ${r.m}) -> ${r.obj} kg  desvio ${r.desvio > 0 ? '+' : ''}${r.desvio}`);
}
comprobar('80/20 devuelve 80', identidad[0].obj, 80);
comprobar('60/28 devuelve 60', identidad[1].obj, 60);
comprobar('95/30 devuelve 95', identidad[2].obj, 95);
comprobar('70/12 devuelve 70', identidad[3].obj, 70);

// ---------------------------------------------------------------------------
console.log('\n[2] La misma funcion con musculo MEDIDO si es correcta');
callar();
const medido = C.calculateTargetWeight(60.5, 20, { weight: 80, fatPct: 20, muscleKg: 60.5 });
hablar();
comprobar('80 kg / 20 % con musculo medido 60.5 kg', medido, 80);

// ---------------------------------------------------------------------------
console.log('\n[3] Rama muerta de calculateCaloricTarget');
callar();
const conRecomp = C.calculateCaloricTarget(2759, 'recomp');
const conRecomposition = C.calculateCaloricTarget(2759, 'recomposition');
hablar();
console.log(`    'recomp'        -> ${JSON.stringify(conRecomp)}`);
console.log(`    'recomposition' -> ${JSON.stringify(conRecomposition)}   <- la clave que usa el generador`);
comprobar("'recomposition' aplica deficit", conRecomposition.deficit, conRecomp.deficit);

// ---------------------------------------------------------------------------
console.log('\n[4] Perfil canonico: hombre 30 anos, 175 cm, 75 kg, 20 % grasa');
const perfil = { age: 30, sex: 'male', height: 175, trainingStatus: 'intermediate', activityLevel: 'moderate' };
const musculoInicial = C.estimateMuscleFromComposition(75, 20);
const inicial = { weight: 75, fatPct: 20, muscleKg: musculoInicial };
callar();
const pesoObjetivo = C.calculateTargetWeight(30, 12, inicial);
const coherente = Math.round((30 / 0.48 / 0.88) * 10) / 10;
const bmr = C.calculateBMR(75, 175, 30, 'male');
const validacion = C.validateInputs(inicial, { weight: pesoObjetivo, fatPct: 12, muscleKg: 30 }, perfil);
hablar();
console.log(`    musculo autoestimado           = ${musculoInicial} kg  (48 % de 60 kg de masa magra)`);
console.log(`    peso objetivo que muestra la UI = ${pesoObjetivo} kg`);
console.log(`    peso coherente con el modelo    = ${coherente} kg  (30 / 0.48 / 0.88)`);
console.log(`    BMR sin redondear               = ${bmr}`);
console.log(`    validateInputs                  = isValid ${validacion.isValid}, ${validacion.errors.length} errores, ${validacion.warnings.length} avisos`);
comprobar('el peso objetivo no cae por debajo del 85 % del inicial', pesoObjetivo >= 75 * 0.85, true);
comprobar('BMR viene redondeado', Number.isInteger(bmr), true);
comprobar('validateInputs avisa de un objetivo absurdo', validacion.warnings.length > 0, true);

// ---------------------------------------------------------------------------
console.log('\n[5] Generacion completa con el perfil canonico');
const userProfile = {
  initial: { ...inicial },
  target: { weight: pesoObjetivo, fatPct: 12, muscleKg: 30 },
  profile: perfil,
  startDate: '2026-08-03',
};
callar();
const datos = G.generateTransformationData(userProfile);
hablar();
console.log(`    dias ${datos.daily.length} · semanas ${datos.weekly.length} · meses ${datos.monthly.length} · fases ${datos.phases.length}`);
console.log('    fase                 dias   peso inicio -> fin      % grasa inicio -> fin   kcal/dia');
for (const f of datos.phases) {
  console.log(
    `    ${f.name.padEnd(18)} ${String(f.days).padStart(4)}   ` +
    `${String(f.startComposition.weight).padStart(5)} -> ${String(f.endComposition.weight).padEnd(6)}    ` +
    `${String(f.startComposition.fatPct).padStart(5)} -> ${String(f.endComposition.fatPct).padEnd(6)}  ` +
    `${String(f.dailyCalories).padStart(6)}`
  );
}
const recomp = datos.phases.find(f => f.type === 'recomposition');
const definicion = datos.phases.find(f => f.type === 'cut');
comprobar('la recomposicion no pierde mas de 3 kg', Math.abs(recomp.totalChange.weight) <= 3, true);
comprobar('la definicion no toca el suelo del 5 % de grasa', definicion.endComposition.fatPct > 5, true);
callar();
const tdeeRecomp = C.calculateTDEE(C.calculateBMR(recomp.startComposition.weight, perfil.height, perfil.age, perfil.sex), perfil.activityLevel);
hablar();
console.log(`    TDEE al inicio de la recomposicion = ${tdeeRecomp} kcal; la fase asigna ${recomp.dailyCalories} kcal`);
comprobar('la recomposicion no come a mantenimiento', recomp.dailyCalories < tdeeRecomp, true);

// ---------------------------------------------------------------------------
console.log('\n[6] Hitos');
callar();
const hitos = datos.milestones || G.generateMilestones(userProfile, datos.phases);
hablar();
const sinDia = hitos.filter(h => !Number.isFinite(h.estimatedDay));
console.log(`    ${hitos.length} hitos generados, ${sinDia.length} sin dia estimado (NaN)`);
if (sinDia.length) console.log(`    categorias afectadas: ${[...new Set(sinDia.map(h => h.category))].join(', ')}`);
comprobar('todos los hitos tienen dia estimado', sinDia.length, 0);

// ---------------------------------------------------------------------------
console.log('\n[7] Determinismo de la generacion');
callar();
const a = G.generateTransformationData({ ...userProfile, initial: { ...inicial }, target: { weight: pesoObjetivo, fatPct: 12, muscleKg: 30 } });
const b = G.generateTransformationData({ ...userProfile, initial: { ...inicial }, target: { weight: pesoObjetivo, fatPct: 12, muscleKg: 30 } });
hablar();
const iguales = JSON.stringify(a.daily.map(d => d.physical.weight)) === JSON.stringify(b.daily.map(d => d.physical.weight));
console.log(`    peso del dia 1 en dos ejecuciones: ${a.daily[0].physical.weight} y ${b.daily[0].physical.weight}`);
comprobar('dos generaciones del mismo perfil coinciden', iguales, true);

// ---------------------------------------------------------------------------
console.log(`\n=== ${fallos} comprobaciones fallan. ===`);
console.log('Cada FALLA corresponde a un hallazgo abierto del catalogo. El script no falla el proceso:');
console.log('cuando el plan de remediacion avance, el numero debe bajar hasta 0.\n');
```

### Salida esperada hoy, sobre `264c1db`

Todas las líneas son deterministas **salvo las dos cifras del bloque `[7]`**, que cambian en cada ejecución: eso es precisamente lo que ese bloque demuestra.

```text
[1] Prueba de identidad de calculateTargetWeight
    Pedir como objetivo la composicion ACTUAL debe devolver el peso ACTUAL.
    80 kg / 20 % (musculo estimado 30.7) -> 50.9 kg  desvio -29.1
    60 kg / 28 % (musculo estimado 20.7) -> 42.6 kg  desvio -17.4
    95 kg / 30 % (musculo estimado 31.9) -> 59.9 kg  desvio -35.1
    70 kg / 12 % (musculo estimado 29.6) -> 45 kg  desvio -25
  FALLA  80/20 devuelve 80: 50.9  (esperado 80)
  FALLA  60/28 devuelve 60: 42.6  (esperado 60)
  FALLA  95/30 devuelve 95: 59.9  (esperado 95)
  FALLA  70/12 devuelve 70: 45  (esperado 70)

[2] La misma funcion con musculo MEDIDO si es correcta
  OK    80 kg / 20 % con musculo medido 60.5 kg: 80

[3] Rama muerta de calculateCaloricTarget
    'recomp'        -> {"target":2621,"deficit":138,"tdee":2759}
    'recomposition' -> {"target":2759,"deficit":0,"tdee":2759}   <- la clave que usa el generador
  FALLA  'recomposition' aplica deficit: 0  (esperado 138)

[4] Perfil canonico: hombre 30 anos, 175 cm, 75 kg, 20 % grasa
    musculo autoestimado           = 28.8 kg  (48 % de 60 kg de masa magra)
    peso objetivo que muestra la UI = 45.5 kg
    peso coherente con el modelo    = 71 kg  (30 / 0.48 / 0.88)
    BMR sin redondear               = 1698.75
    validateInputs                  = isValid true, 0 errores, 0 avisos
  FALLA  el peso objetivo no cae por debajo del 85 % del inicial: false  (esperado true)
  FALLA  BMR viene redondeado: false  (esperado true)
  FALLA  validateInputs avisa de un objetivo absurdo: false  (esperado true)

[5] Generacion completa con el perfil canonico
    dias 306 · semanas 44 · meses 11 · fases 6
    fase                 dias   peso inicio -> fin      % grasa inicio -> fin   kcal/dia
    Adaptación           14      75 -> 74.5         20 -> 19.7      2633
    Recomposición        90    74.5 -> 46.2       19.7 -> 13.7      2625
    Definición           98    46.2 -> 40         13.7 -> 5         1750
    Volumen              60      40 -> 42.2          5 -> 5.2       2405
    Transición           14    42.2 -> 43.9        5.2 -> 8.6       2125
    Mantenimiento        30    43.9 -> 45.5        8.6 -> 12        2150
  FALLA  la recomposicion no pierde mas de 3 kg: false  (esperado true)
  FALLA  la definicion no toca el suelo del 5 % de grasa: false  (esperado true)
    TDEE al inicio de la recomposicion = 2625 kcal; la fase asigna 2625 kcal
  FALLA  la recomposicion no come a mantenimiento: false  (esperado true)

[6] Hitos
    17 hitos generados, 8 sin dia estimado (NaN)
    categorias afectadas: abs, vascularity, face, arms
  FALLA  todos los hitos tienen dia estimado: 8  (esperado 0)

[7] Determinismo de la generacion
    peso del dia 1 en dos ejecuciones: 75.63 y 75.45
  FALLA  dos generaciones del mismo perfil coinciden: false  (esperado true)

=== 13 comprobaciones fallan. ===
```

### Qué hallazgo hay detrás de cada FALLA

| Bloque | Comprobación | Hallazgo |
|---|---|---|
| `[1]` | Los cuatro casos de la prueba de identidad | [`MOT-01`](./CATALOGO-DE-HALLAZGOS.md#mot-01--calculatetargetweight-produce-pesos-objetivo-absurdos-en-la-ruta-por-defecto), [`GEN-01`](./CATALOGO-DE-HALLAZGOS.md#gen-01--el-clamp-de-otherleantissue-a-2-10-kg-hunde-toda-la-proyección), [`EST-01`](./CATALOGO-DE-HALLAZGOS.md#est-01--el-peso-objetivo-mostrado-y-persistido-es-absurdamente-bajo) |
| `[3]` | `'recomposition'` no aplica déficit | [`MOT-04`](./CATALOGO-DE-HALLAZGOS.md#mot-04--la-fase-de-recomposición-recibe-calorías-de-mantenimiento-el-case-recomp-nunca-se-ejecuta) |
| `[4]` | Peso objetivo por debajo del 85 % | `MOT-01` / `EST-01` |
| `[4]` | BMR sin redondear | [`MOT-19`](./CATALOGO-DE-HALLAZGOS.md#mot-19--bmr-se-devuelve-sin-redondear-y-se-pinta-con-decimales-en-la-interfaz), [`EST-14`](./CATALOGO-DE-HALLAZGOS.md#est-14--la-previsualización-de-composición-muestra-el-bmr-sin-redondear-y-con-barras-sin-limitar) |
| `[4]` | `validateInputs` no avisa | [`MOT-11`](./CATALOGO-DE-HALLAZGOS.md#mot-11--validateinputs-no-puede-detectar-un-peso-objetivo-fuera-de-rango-y-muestra-el-texto-nullkg) |
| `[5]` | La recomposición pierde 28,3 kg | `GEN-01` |
| `[5]` | La definición toca el suelo del 5 % | [`GEN-13`](./CATALOGO-DE-HALLAZGOS.md#gen-13--los-guardarraíles-capan-valores-imposibles-en-silencio-y-el-mantenimiento-fuerza-el-objetivo-de-golpe) |
| `[5]` | La recomposición come a mantenimiento | `MOT-04` |
| `[6]` | 8 hitos con `estimatedDay = NaN` | [`GEN-03`](./CATALOGO-DE-HALLAZGOS.md#gen-03--los-hitos-estéticos-se-generan-con-estimatedday--nan) |
| `[7]` | La generación no es determinista | [`GEN-09`](./CATALOGO-DE-HALLAZGOS.md#gen-09--mathrandom-en-la-fluctuación-diaria-hace-la-generación-no-determinista), [`MOT-09`](./CATALOGO-DE-HALLAZGOS.md#mot-09--adddailyfluctuation-no-es-determinista-y-rompe-la-conservación-de-masa-diaria) |

**Criterio de finalización.** El bloque `[1]` en verde es la condición mínima para dar por corregido el defecto crítico: cuatro perfiles distintos, en la ruta por defecto, devuelven su propio peso al pedir su propia composición. Mientras `[1]` tenga una sola FALLA, ningún otro arreglo del motor cambia la prioridad del plan de remediación.

---

## 7. Plantilla de registro

Copiar esta plantilla en el registro de la sesión, rellenarla y guardarla junto al hash del commit. Un registro sin commit no es comparable con ningún otro.

```text
Fecha:          ____-__-__          Hora local: __:__
Ejecutor:       ______________________________
Commit:         ____________  (git log --oneline -1)
Rama / estado:  ____________  (git status -sb)
Navegador:      ______________________  Versión: __________
Sistema:        ______________________  Resolución: __________
Servido con:    [ ] python3 -m http.server 8000   [ ] otro: __________
Perfil usado:   [ ] canónico de §3   [ ] otro (invalida las cifras): __________
Node:           versión __________   Fallos de §6: ____ / 13
```

### §4 — Guion de humo

| # | Paso | PASA | FALLA | BLOQUEADO | Hallazgo / valor observado |
|---|---|---|---|---|---|
| 1 | Arranque sin perfil | | | | |
| 2 | Paso 1 — validación | | | | |
| 3 | Paso 1 — perfil canónico | | | | |
| 4 | Paso 2 — campo de músculo | | | | |
| 5 | Paso 2 — vista previa | | | | |
| 6 | Paso 2 — congelación al retroceder | | | | |
| 7 | Paso 3 — límites de grasa objetivo | | | | |
| 8 | **Paso 3 — peso objetivo (crítico)** | | | | |
| 9 | Paso 3 — validación y resumen | | | | |
| 10 | Paso 3 — fecha de inicio | | | | |
| 11 | Paso 4 — confirmación | | | | |
| 12 | «Comenzar» — generación | | | | |
| 13 | Arranque del panel y recarga | | | | |
| 14 | Tarjeta Físico | | | | |
| 15 | Tarjetas Rendimiento y Bienestar | | | | |
| 16 | Tarjeta Metabolismo y rejilla | | | | |
| 17 | Indicador de fase | | | | |
| 18 | Progreso hacia objetivos | | | | |
| 19 | Gráfico — series y curva | | | | |
| 20 | Gráfico — hover | | | | |
| 21 | Gráfico — clic (semanal) | | | | |
| 22 | Navegación `‹` / `›` | | | | |
| 23 | Botón «Hoy» | | | | |
| 24 | Granularidad «Día» | | | | |
| 25 | Granularidad «Mes» | | | | |
| 26 | Panel de insights | | | | |
| 27 | Toggles de métrica | | | | |
| 28 | Modal de ajustes | | | | |
| 29 | Exportación de datos | | | | |
| 30 | Reinicio de perfil | | | | |

**Totales §4:** PASA ____ · FALLA ____ · BLOQUEADO ____ (de 30)
*Línea base sobre `264c1db`: **7 PASA** (pasos 1, 2, 3, 7, 15, 21 y 30; los dos últimos con reserva anotada), **23 FALLA** (varios de ellos parciales), **0 BLOQUEADO**.*

### §5 — Accesibilidad mínima

| # | Comprobación | Resultado | Medición / observación |
|---|---|---|---|
| A1 | Recorrido con tabulador | | Paradas observadas: ____ / 14 |
| A2 | Modal: foco y `Escape` | | |
| A3 | Zoom al 200 % | | `scrollWidth − clientWidth` = ____ ; elementos desbordados: |
| A4 | Ancho de 375 px | | Elementos desbordados: |

### §6 — Motor en Node

| Bloque | Comprobaciones | Fallan hoy | Fallan ahora |
|---|---|---|---|
| `[1]` Prueba de identidad | 4 | 4 | |
| `[2]` Músculo medido | 1 | 0 | |
| `[3]` Objetivo calórico | 1 | 1 | |
| `[4]` Perfil canónico | 3 | 3 | |
| `[5]` Generación completa | 3 | 3 | |
| `[6]` Hitos | 1 | 1 | |
| `[7]` Determinismo | 1 | 1 | |
| **Total** | **14** | **13** | |

### Observaciones

```text
Desviaciones respecto a las cifras esperadas de §3 y §4:


Comportamientos nuevos no descritos en este guion:


Pasos cuyo veredicto ha cambiado respecto al registro anterior:


```

---

## Documentos relacionados

- [README](../README.md) — qué es el proyecto y cómo se ejecuta.
- [Guía de desarrollo](./GUIA-DE-DESARROLLO.md) — puesta en marcha, depuración y trampas conocidas.
- [Auditoría](./AUDITORIA.md) — el análisis del que salen los hallazgos que este guion comprueba.
- [Catálogo de hallazgos](./CATALOGO-DE-HALLAZGOS.md) — la ficha completa de cada identificador citado aquí.
- [Deuda técnica](./DEUDA-TECNICA.md) — el plan de remediación cuyos criterios de finalización operativiza este guion.

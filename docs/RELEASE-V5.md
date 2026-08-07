# Checklist de release v5 (M6-8)

Este fichero es la parte de la checklist de release que **no se puede
automatizar**: lo que exige un dominio real, un móvil real o tus datos reales.
Todo lo demás vive en tests y corre en cada push (ver §1).

Cuando completes §2 y §3, pega los resultados en la bitácora M6 de
`PLAN-V5.md` con la fecha. Ese es el acto que cierra el proyecto.

---

## 1. Lo que ya está verificado y se re-verifica solo

Estos puntos de la checklist están cubiertos por tests que corren en CI en
cada push. No hay que ejecutarlos a mano; hay que mirar que CI esté en verde.

| Punto de la checklist | Dónde se verifica |
|---|---|
| CI verde (typecheck + unit + e2e) | `.github/workflows/ci.yml` |
| Test de identidad, 4 perfiles ±1 kg | `test/invariants.test.js` — desviación real: **0,000000 kg** |
| Backup → borrar perfil → restore | `test/e2e/release.spec.js` |
| Un backup hostil no ejecuta nada | `test/e2e/release.spec.js` |
| Migración v4 → v5 conserva los datos | `test/e2e/release.spec.js`, con el fixture de formas reales del legacy |
| La migración NO hereda el objetivo roto de la v4.0 | `test/e2e/release.spec.js` |
| Migrar dos veces no duplica nada | `test/e2e/release.spec.js` |
| Recorrido de humo sin errores de consola | `test/e2e/release.spec.js` |
| CSP activa sin violaciones en las diez vistas | `test/security.test.js` + `tools/serve-csp.mjs` |
| Precache completo (la app abre sin red) | `test/pwa.test.js` |
| Accesibilidad AA automatizable | `test/e2e/accessibility.spec.js` |
| Reflow a 320 px con el texto al 200 % | `test/e2e/accessibility.spec.js` |
| **La app abre y se recorre entera SIN RED** | `test/e2e/pwa.spec.js` (modo avión real) |
| Un check-in guardado offline sobrevive | `test/e2e/pwa.spec.js` |
| El aviso de versión nueva se puede pulsar con el dedo | `test/e2e/pwa.spec.js` |
| Todas las secciones alcanzables en ventana baja | `test/e2e/accessibility.spec.js` |
| El recordatorio no se equivoca de día en el cambio de hora | `test/reminder.test.js` |

Salida del test de identidad, para el registro:

```
  A · varón 80 kg / 20 %     pedido 80.0 kg  →  80.0000 kg   Δ 0.000000 kg  OK
  B · varón 75 kg / 20 %     pedido 75.0 kg  →  75.0000 kg   Δ 0.000000 kg  OK
  C · mujer 65 kg / 30 %     pedido 65.0 kg  →  65.0000 kg   Δ 0.000000 kg  OK
  D · mujer 90 kg / 40 %     pedido 90.0 kg  →  90.0000 kg   Δ 0.000000 kg  OK
```

Para el mismo perfil A, la v4.0 publicada devolvía **50,9 kg** (IMC 15,7).

---

## 2. Dominio (M6-7)

**Pasos en el panel de Cloudflare.** El repositorio no necesita ningún cambio:
ya trae `_headers` con la CSP y las cabeceras de seguridad, y Cloudflare Pages
lo aplica solo.

1. Cloudflare Dashboard → **Workers & Pages** → tu proyecto `transformlab`.
2. Pestaña **Custom domains** → *Set up a domain*.
3. Escribe el dominio (o subdominio). Si el DNS ya está en Cloudflare, el
   registro se crea solo; si no, te dará el CNAME que hay que añadir donde
   tengas el DNS.
4. Espera al certificado (suele ser minutos; el estado pasa a *Active*).
5. Comprueba, y anota el resultado:

   ```bash
   curl -sI https://TU-DOMINIO/ | grep -iE 'content-security-policy|x-content-type|referrer-policy|strict-transport'
   ```

   - [ ] Responde 200 por HTTPS
   - [ ] `Content-Security-Policy` presente y con `default-src 'self'`
   - [ ] `X-Content-Type-Options: nosniff`
   - [ ] `Referrer-Policy: strict-origin-when-cross-origin`
   - [ ] `http://TU-DOMINIO` redirige a `https://`
   - [ ] `https://transformlab.pages.dev` sigue funcionando o redirige

   > Si la CSP **no** aparece, el `_headers` se está ignorando entero. En ese
   > caso la aplicación se estaría sirviendo sin ninguna cabecera de
   > seguridad: no sigas, avísame y lo arreglo.

---

## 3. Lo que exige un móvil y tus datos (M6-8)

### 3.1 Lighthouse sobre el dominio real

```bash
npx --yes lighthouse https://TU-DOMINIO --view
```

- [ ] Rendimiento ≥ 90
- [ ] Accesibilidad ≥ 90
- [ ] Buenas prácticas ≥ 90
- [ ] SEO ≥ 90

Ya medido sobre el staging real (`https://transformlab.pages.dev`, 2026-08-07):
**móvil 94 / 100 / 100 / 100** · **escritorio 96 / 100 / 100 / 100**, más
Agentic Browsing 100 en ambos. Sobre tu dominio debería salir igual: es el
mismo despliegue. Si baja de 90 en algo, pega el JSON y lo corrijo.

> Ojo con esta medición: la primera vez salió **64** en móvil, no 96 como en
> local. El service worker precacheaba las 55 piezas dentro de la ventana de
> medición y bloqueaba el hilo principal 3,4 s. Ya está corregido, pero es un
> recordatorio de que el número que vale es el del dominio, no el de casa.

### 3.2 Migración con tus datos reales

Esto es lo único que no puedo probar por ti: tus datos son los únicos que
importan aquí, y no los tengo.

1. En el dispositivo donde usabas la v4.0, **antes de nada**: abre la consola
   y guarda una copia de seguridad manual, por si acaso.

   ```js
   copy(JSON.stringify(Object.fromEntries(Object.entries(localStorage))))
   ```

   Pégalo en un fichero de texto y guárdalo fuera del navegador.

2. Abre la aplicación nueva en ese mismo navegador. La migración corre sola,
   una sola vez.

3. Comprueba:
   - [ ] Arranca en «Hoy», sin pedirte el asistente
   - [ ] Tu peso y tu grasa de partida son los tuyos
   - [ ] **El peso objetivo es plausible** (no el 50,9 kg de la v4.0)
   - [ ] En Progreso están todos tus check-ins, con sus fechas
   - [ ] Ajustes → Exportar produce un JSON que se descarga
   - [ ] En la consola: `Object.keys(localStorage).filter(k => k.startsWith('tl.legacy'))`
         devuelve tus datos v4 archivados (no borrados)

### 3.3 PWA en un móvil real

En el teléfono, sobre el dominio con HTTPS:

- [ ] El navegador ofrece instalarla (Android: «Añadir a pantalla de inicio»;
      iOS Safari: Compartir → «Añadir a pantalla de inicio»)
- [ ] Instalada, abre **sin barra de navegador** (standalone)
- [ ] El icono se ve bien en la pantalla de inicio (no recortado ni con marco
      blanco): es lo que comprueba el icono *maskable*
- [ ] **Con el modo avión activado**, la app abre y se puede navegar por las
      diez secciones
- [ ] Offline, la gráfica de «Hoy» dibuja (Chart.js va precacheado)
- [ ] Offline, se puede guardar un check-in y sigue ahí al recuperar la red

> El modo avión **ya está comprobado contra el staging real** con un navegador
> automatizado: precache de 54 entradas, las nueve secciones cargan y la
> gráfica dibuja. Lo que falta aquí es el móvil de verdad, que es otra cosa:
> otro motor (Safari en iOS), otra gestión de memoria y la app instalada en
> lugar de una pestaña.
>
> Merece la pena hacerlo con cuidado porque el fallo más grave de M6 fue justo
> este: el precache fallaba entero en producción por una redirección que en
> local no existe, y la aplicación parecía funcionar perfectamente. Si no abre
> en modo avión, avísame antes de seguir.

### 3.4 Guion de humo manual, en el móvil

Recorrido corto; el largo está automatizado. Toca hacerlo con el dedo porque
lo que se comprueba aquí es que se pueda **usar**, no que funcione.

1. **Asistente**: crea un perfil de prueba. ¿Se ve el plan en vivo mientras
   escribes? ¿Los campos numéricos abren el teclado numérico?
2. **Hoy**: ¿se lee de un vistazo lo que toca hoy? ¿La gráfica se puede
   recorrer con el dedo?
3. **Barra inferior**: pulsa «Más». ¿Se abren las seis secciones restantes?
   ¿Los botones son cómodos de pulsar sin apuntar?
4. **Check-in**: registra un peso. ¿Sale el aviso de guardado? ¿Aparece en
   Progreso?
5. **Fotos**: haz una foto con la cámara del móvil. ¿Se guarda? ¿El comparador
   antes/después muestra las dos?
6. **Rotación**: gira el móvil a horizontal y vuelve a vertical en la vista de
   «Hoy». ¿La gráfica se reajusta sin dejar barra de scroll horizontal?
7. **Ajustes → Recordatorio**: actívalo. ¿Pide permiso solo al pulsar? Si lo
   deniegas, ¿lo explica sin insistir?
8. **Tamaño de letra del sistema al máximo** (Ajustes del móvil → Pantalla):
   recorre las diez vistas. ¿Se lee todo? ¿Nada se sale por el lado?
9. **Borra el perfil de prueba** desde la zona de peligro.

### 3.5 Cierre

- [ ] Todo lo anterior en verde
- [ ] Resultados pegados en la bitácora M6 de `PLAN-V5.md`, con fecha

Cuando esto esté, TransformLab v5 está **en producción**. A partir de ahí,
cualquier idea nueva es BACKLOG para un ciclo futuro, no una extensión de
este (CLAUDE.md §7).

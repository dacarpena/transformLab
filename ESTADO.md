---
tipo: estado
proyecto: transformLab
etapa: saneamiento
siguiente:
  texto: "E15-8: un check-in son un peso y un botón"
  destino: transformLab
---
# Estado — transformLab

Aplicación de seguimiento de transformación corporal con proyección
recalibrable. **En producción** en https://motifyer.com (Cloudflare Pages sobre
`main`, despliegue continuo). ~27 000 líneas en `src/`, dieciséis vistas, cero
dependencias de runtime salvo Chart.js vendorizado.

**Hecho:** v1 (M0–M7) y v2 (V2-M0…M10) cerradas, más las épicas E10 y E11
(básculas de bioimpedancia), E12 (Proyección), E13 (Analizar: 44 series, gestos,
PNG y CSV) y E14 (hitos de salud).

**En curso: E15, saneamiento.** Nació de «identifica por qué no funciona». El
diagnóstico contradijo la premisa: el código no estaba roto y la gráfica
dibujaba bien. Lo que fallaba eran los DATOS —un objetivo que pedía ganar trece
gramos de músculo, con el eje autoescalado sobre el ruido de la báscula— y, sobre
todo, que **la aplicación está vacía**: cero check-ins, cero ingesta, cero pasos.
Todo lo demás son consumidores de esos datos.

Cerradas E15-0 a E15-6. Lo siguiente es el bloque que ataca la causa raíz:
check-in de un solo campo, importar el histórico de pesos por CSV, y un perfil de
ejemplo generado por el motor.

**Después:** backend con cuentas — sincronía *opt-in*, passkeys, cifrado extremo
a extremo, D1 para los datos y R2 para las fotos. Planificado, sin empezar.

**Cabos sueltos:** un test E2E intermitente (`analysis.spec.js`, «pulsar un
marcador abre su ficha») que solo falla en modo serie. Y tres casillas de
lanzamiento bloqueadas en el usuario, con sus pasos en `docs/RELEASE-V5.md`.

El estado detallado, con bitácora por etapa, está en `docs/v2/PLAN-V2.md`.

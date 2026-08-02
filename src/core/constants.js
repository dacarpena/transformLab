// @ts-check

/**
 * Constantes del motor científico v2.
 *
 * Regla del proyecto (CLAUDE.md §3): cada constante lleva su fuente en JSDoc.
 * Las marcadas como «decisión de producto» no pretenden base bibliográfica y
 * están registradas en PLAN-V5.md. Las marcadas «aprox.» son aproximaciones
 * documentadas de la literatura citada, no valores medidos.
 *
 * Los valores heredados del legacy son únicamente los verificados como
 * correctos por la auditoría (docs/METODOLOGIA-CIENTIFICA.md §3):
 * multiplicadores de actividad, tasas de pérdida de grasa y umbrales de grasa.
 */

/**
 * Multiplicadores de actividad sobre el BMR para obtener el TDEE.
 * Fuente: escala clásica de factores de actividad usada con Mifflin-St Jeor
 * (Mifflin et al. 1990; escala de factores estándar de la práctica dietética).
 * Verificados por la auditoría como los valores estándar.
 * @type {Readonly<Record<'sedentary'|'light'|'moderate'|'active'|'veryActive', number>>}
 */
export const ACTIVITY_MULTIPLIERS = Object.freeze({
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
    veryActive: 1.9
});

/**
 * Tasas seguras de pérdida de grasa, como fracción del peso corporal por semana.
 * Fuente: Aragon et al. 2017 (ISSN position stand): 0,5–1 % del peso corporal
 * por semana preserva mejor la masa magra. Verificadas por la auditoría.
 * @type {Readonly<Record<'conservative'|'moderate'|'aggressive', number>>}
 */
export const FAT_LOSS_RATES_PCT_BW_WEEK = Object.freeze({
    conservative: 0.005,
    moderate: 0.0075,
    aggressive: 0.01
});

/**
 * Tasas de ganancia muscular RELATIVAS al peso corporal (fracción del peso
 * por mes), por estado de entrenamiento (decisión B6: relativas, no absolutas).
 *
 * Fuente: McDonald 2008 y Helms 2014 publican tasas absolutas
 * (novato 0,9–1,4 · intermedio 0,45–0,9 · avanzado 0,2–0,45 kg/mes) para un
 * varón de referencia de ~75 kg. Aquí se expresan divididas por ese peso de
 * referencia, de modo que a 75 kg reproducen exactamente las tasas absolutas
 * de la fuente y escalan de forma proporcional con el peso del usuario.
 * @type {Readonly<Record<'beginner'|'intermediate'|'advanced', Readonly<{min: number, avg: number, max: number}>>>}
 */
export const MUSCLE_GAIN_RATES_PCT_BW_MONTH = Object.freeze({
    beginner: Object.freeze({ min: 0.012, avg: 0.0153, max: 0.0187 }),
    intermediate: Object.freeze({ min: 0.006, avg: 0.009, max: 0.012 }),
    advanced: Object.freeze({ min: 0.0027, avg: 0.0043, max: 0.006 })
});

/**
 * Factor multiplicativo de las tasas musculares (en %PC) para sexo femenino.
 * Fuente: Helms 2014 estima la tasa absoluta femenina en ~la mitad de la
 * masculina; con pesos de referencia de ~75 kg (♂) y ~60 kg (♀), en términos
 * relativos al peso el factor equivale a 0,5 / (60/75) = 0,625 (aprox.).
 * @type {number}
 */
export const FEMALE_MUSCLE_GAIN_FACTOR = 0.625;

/**
 * Grasa corporal esencial (%): por debajo es fisiológicamente inviable.
 * Fuente: valores convencionales de fisiología (ACSM).
 * @type {Readonly<Record<'male'|'female', number>>}
 */
export const ESSENTIAL_FAT_PCT = Object.freeze({ male: 3, female: 12 });

/**
 * Mínimo de grasa sostenible en el tiempo (%): por debajo, aviso serio.
 * Fuente: mínimos convencionales para no atletas (ACSM / Aragon 2017).
 * @type {Readonly<Record<'male'|'female', number>>}
 */
export const MIN_SAFE_FAT_PCT = Object.freeze({ male: 8, female: 16 });

/**
 * Techo de grasa aceptado por el modelo (%): por encima, las tasas citadas
 * dejan de ser aplicables. Fuente: techo convencional (verificado en auditoría).
 * @type {Readonly<Record<'male'|'female', number>>}
 */
export const MAX_FAT_PCT = Object.freeze({ male: 40, female: 45 });

/**
 * Fracción de la masa magra que es músculo esquelético, por sexo.
 * Se usa SOLO en la ruta `muscleSource: 'estimated'`.
 * Fuente: Janssen et al. 2000 (J Appl Physiol, MRI en 468 adultos): el músculo
 * esquelético supone ≈49 % de la masa libre de grasa en varones y ≈44 % en
 * mujeres (aprox.). El legacy usaba 0,48 plano para ambos sexos.
 * @type {Readonly<Record<'male'|'female', number>>}
 */
export const SMM_OF_LEAN_RATIO = Object.freeze({ male: 0.49, female: 0.44 });

/**
 * Equivalencia energética de la grasa corporal: kcal por kg de tejido adiposo.
 * Fuente: Wishnofsky 1958 (3 500 kcal/lb ≈ 7 700 kcal/kg); revisión crítica en
 * Hall 2008. Base de la conexión calorías↔composición (decisión B3).
 * @type {number}
 */
export const KCAL_PER_KG_FAT = 7700;

/**
 * Coste energético aproximado de sintetizar 1 kg de tejido magro (kcal/kg).
 * Fuente: aprox. derivada de las recomendaciones de superávit para ganancia
 * magra (Slater et al. 2019; Iraki et al. 2019: ~360–480 kcal/día para
 * 0,25–0,5 kg/semana ⇒ ~2 000–2 700 kcal/kg).
 * @type {number}
 */
export const KCAL_PER_KG_MUSCLE = 2500;

/**
 * Suelo calórico de seguridad por sexo (kcal/día). El objetivo diario nunca
 * baja de max(BMR, este suelo); si el suelo recorta el déficit, la fase se
 * alarga (decisión B2). Fuente: mínimos convencionales de la práctica clínica
 * (guías dietéticas; p. ej. NIH) — convención, no medición.
 * @type {Readonly<Record<'male'|'female', number>>}
 */
export const CALORIC_FLOOR_KCAL = Object.freeze({ male: 1500, female: 1200 });

/**
 * Adaptación metabólica durante déficit sostenido (decisión B4).
 * Fuente: Trexler et al. 2014 (revisión): la termogénesis adaptativa reduce el
 * gasto ~5–15 % más de lo que predice la pérdida de peso, de forma progresiva.
 * Modelo aquí (aprox. documentada): reducción del TDEE del 2 %/semana en
 * déficit hasta un máximo del 10 %; recuperación del 5 %/semana fuera de déficit.
 * @type {Readonly<{onsetPerWeek: number, maxReduction: number, recoveryPerWeek: number}>}
 */
export const METABOLIC_ADAPTATION = Object.freeze({
    onsetPerWeek: 0.02,
    maxReduction: 0.10,
    recoveryPerWeek: 0.05
});

/**
 * Parámetros de la fase de recomposición (decisión B7: fase real, no nominal).
 * Fuente: Barakat et al. 2020 (revisión de recomposición): factible sobre todo
 * en rangos de grasa medios; progreso simultáneo más lento que en fases puras.
 * Factores y ventana: aprox. documentada sobre esa revisión. Ventana femenina
 * desplazada +8 puntos (equivalencia convencional de distribución de grasa).
 * @type {Readonly<{fatLossFactor: number, muscleGainFactor: number, maxDays: number, fatPctWindow: Readonly<Record<'male'|'female', Readonly<[number, number]>>>}>}
 */
export const RECOMP = Object.freeze({
    fatLossFactor: 0.5,
    muscleGainFactor: 0.6,
    maxDays: 120,
    fatPctWindow: Object.freeze({
        male: Object.freeze(/** @type {[number, number]} */ ([15, 25])),
        female: Object.freeze(/** @type {[number, number]} */ ([23, 33]))
    })
});

/**
 * Pérdida muscular esperada por kg de grasa perdida en definición, con
 * entrenamiento de fuerza y proteína adecuada.
 * Fuente: aprox. conservadora derivada de Helms 2014 (la pérdida magra es
 * minoritaria con déficits moderados y entrenamiento).
 * @type {number}
 */
export const CUT_MUSCLE_LOSS_PER_KG_FAT = 0.05;

/**
 * Grasa ganada por kg de músculo en volumen con superávit controlado.
 * Fuente: aprox. de Garthe 2013 / Iraki 2019 (superávits moderados: reparto
 * magro:graso en torno a 2:1).
 * @type {number}
 */
export const BULK_FAT_PER_KG_MUSCLE = 0.5;

/**
 * Duraciones fijas de las fases no dirigidas por tasas (días).
 * Decisión de producto (PLAN-V5.md, mapa de fases del legacy conservado).
 * @type {Readonly<{adaptationDays: number, transitionDays: number, maintenanceDays: number}>}
 */
export const PHASE_DURATIONS = Object.freeze({
    adaptationDays: 14,
    transitionDays: 14,
    maintenanceDays: 30
});

/**
 * Amplitud máxima de la fluctuación diaria de peso (fracción del peso corporal)
 * por agua/glucógeno. Fuente: la variación intra-semanal típica ronda el ±0,5–1 %
 * del peso (p. ej. Bhutani 2017) — aprox.
 * @type {number}
 */
export const FLUCTUATION_AMPLITUDE_PCT_BW = 0.005;

/**
 * Categorías de hitos derivables de la serie, declaradas en UN solo sitio
 * (cierra GEN-16: categorías divergentes entre generador y render).
 * Los umbrales son pasos de cruce sobre la serie esperada.
 * Decisión de producto.
 * @type {Readonly<{fatPct: {step: number}, muscleKg: {step: number}, weightKg: {step: number}, phase: true}>}
 */
export const MILESTONE_CATEGORIES = Object.freeze({
    fatPct: Object.freeze({ step: 1 }),
    muscleKg: Object.freeze({ step: 1 }),
    weightKg: Object.freeze({ step: 5 }),
    phase: /** @type {true} */ (true)
});

/** Techo duro de %grasa admitido como entrada (medición) antes de error. */
export const ABSOLUTE_MAX_FAT_PCT = 60;

/** Escenarios de la proyección (decisión B5). Exponentes de progreso:
 * <1 adelanta (optimista), >1 retrasa (pesimista); 1 = esperado. Los tres
 * cierran el plan por construcción (el progreso llega a 1 en el último día).
 * Derivados de la anchura min/avg/max de las tasas citadas (aprox.).
 * @type {Readonly<Record<'pessimist'|'expected'|'optimist', number>>}
 */
export const SCENARIO_PROGRESS_EXPONENTS = Object.freeze({
    pessimist: 1.3,
    expected: 1,
    optimist: 0.78
});

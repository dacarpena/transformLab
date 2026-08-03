// @ts-check

/** M5-3/5/6 · Silueta, hitos estéticos y logros. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeComposition, planPhases } from '../src/core/engine.js';
import { generateProjection } from '../src/core/generator.js';
import { shapeFor, waistToShoulderRatio, calibrationFrom } from '../src/core/silhouette.js';
import { aestheticMilestonesFor, nextAesthetic, byCategory, AESTHETIC_CATALOG, VISIBILITY_LEVELS } from '../src/core/milestones.js';
import { evaluate, shareCard, ACHIEVEMENT_RULES } from '../src/core/achievements.js';

const PROFILE = { sex: /** @type {const} */ ('male'), age: 30, heightCm: 175, activityLevel: /** @type {const} */ ('moderate'), trainingStatus: /** @type {const} */ ('intermediate') };

function canonical() {
    const comp = makeComposition({ weightKg: 75, fatPct: 20, sex: 'male' });
    assert.ok(comp.ok);
    const plan = planPhases(comp.value, { fatPct: 12, muscleKg: 30 }, PROFILE);
    assert.ok(plan.ok);
    const proj = generateProjection(plan.value, comp.value, PROFILE, { startDateISO: '2026-08-03', seed: 1, fluctuation: false });
    assert.ok(proj.ok);
    return { comp: comp.value, projection: proj.value };
}

// ---- Silueta ----

test('menos grasa estrecha la cintura más que los hombros', () => {
    const fat = shapeFor({ weightKg: 90, fatPct: 30, muscleKg: 33, sex: 'male' });
    const lean = shapeFor({ weightKg: 78, fatPct: 14, muscleKg: 33, sex: 'male' });
    assert.ok(fat && lean);
    const waistChange = (fat.waist - lean.waist) / fat.waist;
    const shoulderChange = Math.abs(fat.shoulders - lean.shoulders) / fat.shoulders;
    assert.ok(waistChange > shoulderChange, 'la grasa debe notarse más en la cintura');
    assert.ok(waistToShoulderRatio(lean) < waistToShoulderRatio(fat));
});

test('más músculo ensancha hombros y brazo', () => {
    const base = shapeFor({ weightKg: 80, fatPct: 18, muscleKg: 30, sex: 'male' });
    const strong = shapeFor({ weightKg: 80, fatPct: 18, muscleKg: 36, sex: 'male' });
    assert.ok(base && strong);
    assert.ok(strong.shoulders > base.shoulders);
    assert.ok(strong.arm > base.arm);
});

test('las medidas REALES calibran la silueta y quedan señaladas', () => {
    const comp = { weightKg: 80, fatPct: 18, muscleKg: 31, sex: /** @type {const} */ ('male') };
    const estimated = shapeFor(comp);
    const measured = shapeFor(comp, calibrationFrom('male', { waist: 72 }));
    assert.ok(estimated && measured);
    assert.equal(estimated.fromMeasures, false);
    assert.equal(measured.fromMeasures, true);
    assert.ok(measured.waist < estimated.waist, 'una cintura medida más estrecha debe reflejarse');
});

test('calibrationFrom devuelve null si no hay ninguna medida útil', () => {
    assert.equal(calibrationFrom('male', undefined), null);
    assert.equal(calibrationFrom('male', {}), null);
    assert.equal(calibrationFrom('male', { waist: 0 }), null);
    assert.equal(calibrationFrom('male', { waist: NaN }), null);
    assert.equal(calibrationFrom('male', /** @type {*} */ ('x')), null);
});

test('la MISMA calibración aplicada a dos composiciones las deja comparables', () => {
    // El fallo que esto cierra: la calibración se aplicaba solo a la figura
    // de «hoy», así que el día 0 —misma composición en inicio y hoy— las dos
    // siluetas salían distintas y el usuario veía «progreso» sin haber hecho
    // nada. Con la misma calibración, misma entrada → misma salida.
    const comp = { weightKg: 80, fatPct: 18, muscleKg: 31, sex: /** @type {const} */ ('male') };
    const cal = calibrationFrom('male', { waist: 95, hip: 104, arm: 36 });
    const a = shapeFor(comp, cal);
    const b = shapeFor(comp, cal);
    assert.deepEqual(a, b);

    // Y adelgazar nunca puede dibujar una cintura MÁS ancha que la de partida
    const thinner = shapeFor({ ...comp, weightKg: 69, fatPct: 12 }, cal);
    assert.ok(a && thinner);
    assert.ok(thinner.waist < a.waist, `${thinner.waist} debería ser menor que ${a.waist}`);
});

test('ninguna silueta se vuelve imposible, por extremos que sean los datos', () => {
    for (const comp of [
        { weightKg: 200, fatPct: 55, muscleKg: 40, sex: /** @type {const} */ ('male') },
        { weightKg: 45, fatPct: 8, muscleKg: 25, sex: /** @type {const} */ ('female') },
        { weightKg: 60, fatPct: 45, muscleKg: 15, sex: /** @type {const} */ ('female') }
    ]) {
        const shape = shapeFor(comp);
        assert.ok(shape);
        for (const [key, value] of Object.entries(shape)) {
            if (typeof value !== 'number') continue;
            assert.ok(Number.isFinite(value) && value > 0, `${key} = ${value}`);
        }
        assert.ok(shape.waist < shape.shoulders * 2, 'proporción imposible');
    }
});

test('shapeFor degrada con basura sin lanzar', () => {
    for (const bad of [null, undefined, {}, 'x', 42, { weightKg: NaN, fatPct: 20, muscleKg: 30, sex: 'male' }]) {
        assert.equal(shapeFor(/** @type {*} */ (bad)), null);
    }
    assert.equal(waistToShoulderRatio(null), 0);
});

// ---- Hitos estéticos ----

test('el catálogo está despersonalizado: sin fechas, días ni semanas del plan ajeno', () => {
    assert.ok(AESTHETIC_CATALOG.length > 50);
    for (const item of AESTHETIC_CATALOG) {
        for (const forbidden of ['day', 'date', 'dateFormatted', 'week', 'dayOfWeek', 'phase', 'metricsAtMilestone']) {
            assert.ok(!(forbidden in item), `«${item.title.es}» aún arrastra ${forbidden}`);
        }
        // y cada uno tiene al menos un umbral de composición: si no, no sería
        // aplicable a otro usuario
        assert.ok(item.fatPctBelow !== null || item.muscleGainKgAbove !== null, `«${item.title.es}» sin umbral`);
        assert.ok(VISIBILITY_LEVELS.includes(item.visibility), `visibilidad desconocida: ${item.visibility}`);
    }
});

test('los umbrales de músculo son GANANCIA alcanzable, no la masa de otra persona', () => {
    // El fallo que esto cierra: el catálogo guardaba la masa muscular ABSOLUTA
    // del usuario único de la v4.0 (56,8–64,8 kg) y el código la comparaba
    // contra la ganancia, así que 58 de los 97 hitos —categorías enteras como
    // brazos, antebrazos y proporciones— eran inalcanzables para cualquiera.
    const gains = AESTHETIC_CATALOG
        .map((i) => i.muscleGainKgAbove)
        .filter((g) => g !== null && g !== undefined);
    assert.ok(gains.length > 40, 'esperábamos umbrales de músculo en el catálogo');
    for (const g of gains) {
        assert.ok(g > 0 && g <= 15, `umbral de ganancia implausible: ${g} kg`);
    }
});

test('el catálogo trae los dos idiomas en todas sus fichas', () => {
    // Los textos son datos, no cadenas de interfaz, pero el usuario los ve:
    // la regla de i18n (A6) manda igual. Con la app en inglés se leían en
    // español porque el JSON solo traía una lengua.
    for (const item of AESTHETIC_CATALOG) {
        for (const field of /** @type {const} */ (['title', 'description'])) {
            const value = item[field];
            assert.equal(typeof value, 'object', `${item.id}.${field} no es bilingüe`);
            for (const locale of ['es', 'en']) {
                assert.equal(typeof value[locale], 'string', `${item.id}.${field}.${locale} ausente`);
                assert.ok(value[locale].trim().length > 0, `${item.id}.${field}.${locale} vacío`);
            }
        }
    }
});

test('ninguna ficha arrastra ya las cifras del plan de aquella persona', () => {
    // Quedaban textos con «56.4 kg iniciales», «485 días», «De 81.2kg/26.6%»
    // y los nombres de SUS fases («Corte 1», «Bulking 1»).
    const forbidden = [/485\s*d[ií]as/i, /56\.4/, /81\.2/, /77\.8/, /\+8\.4/, /60 kg de masa/i,
        /corte 1/i, /bulking 1/i, /mini-?corte/i, /newbie gains/i];
    for (const item of AESTHETIC_CATALOG) {
        for (const locale of /** @type {const} */ (['es', 'en'])) {
            const text = `${item.title[locale]} ${item.description[locale]}`;
            for (const rx of forbidden) {
                assert.ok(!rx.test(text), `«${text}» aún cita el plan de la v4.0 (${rx})`);
            }
        }
    }
});

test('los hitos se sitúan en el día del cruce REAL de la serie', () => {
    const { comp, projection } = canonical();
    const milestones = aestheticMilestonesFor(projection, { startMuscleKg: comp.muscleKg }, 60);
    assert.ok(milestones.length > 0);

    for (const m of milestones) {
        assert.ok(Number.isInteger(m.dayIndex) && m.dayIndex >= 0);
        assert.equal(m.dateISO, projection.daily[m.dayIndex].dateISO);
        if (m.fatPctBelow !== null) {
            assert.ok(projection.daily[m.dayIndex].fatPct <= m.fatPctBelow + 1e-9,
                `«${m.title}» situado donde la grasa aún es ${projection.daily[m.dayIndex].fatPct}`);
        }
    }
    // ordenados por día
    for (let i = 1; i < milestones.length; i++) {
        assert.ok(milestones[i].dayIndex >= milestones[i - 1].dayIndex);
    }
});

test('no se promete un hito que el plan NO alcanza', () => {
    const { comp, projection } = canonical();
    const milestones = aestheticMilestonesFor(projection, { startMuscleKg: comp.muscleKg }, 0);
    // este plan gana poco músculo, así que muchos hitos del catálogo no salen
    assert.ok(milestones.length < AESTHETIC_CATALOG.length,
        'se prometieron hitos que la proyección no alcanza');
    const finalFat = projection.daily[projection.daily.length - 1].fatPct;
    for (const m of milestones) {
        if (m.fatPctBelow !== null) assert.ok(m.fatPctBelow >= finalFat - 1e-9);
    }
});

test('reached distingue lo alcanzado de lo pendiente, y next es el primero pendiente', () => {
    const { comp, projection } = canonical();
    const milestones = aestheticMilestonesFor(projection, { startMuscleKg: comp.muscleKg }, 60);
    assert.ok(milestones.every((m) => m.reached === (!m.fromStart && m.dayIndex <= 60)));

    const next = nextAesthetic(milestones);
    assert.ok(next);
    assert.equal(next.reached, false);
    assert.ok(next.dayIndex > 60);
});

test('lo que ya se cumplía el día 0 es punto de partida, no un logro', () => {
    // El fallo que esto cierra: quien se apunta ya por debajo de un umbral
    // veía decenas de ✓ nada más terminar el asistente, y esos ticks
    // desbloqueaban logros sin que hubiera hecho absolutamente nada (E9c).
    const { comp, projection } = canonical();
    const day0 = aestheticMilestonesFor(projection, { startMuscleKg: comp.muscleKg }, 0);
    assert.ok(day0.length > 0);
    assert.equal(day0.filter((m) => m.reached).length, 0, 'algo se marcó alcanzado el día 0');

    const fromStart = day0.filter((m) => m.fromStart);
    assert.ok(fromStart.length > 0, 'este perfil debería traer hitos ya cumplidos');
    assert.ok(fromStart.every((m) => m.dayIndex === 0));

    // Y siguen sin contar más adelante: no es que «aún no toque», es que no
    // son suyos.
    const later = aestheticMilestonesFor(projection, { startMuscleKg: comp.muscleKg }, 999);
    assert.ok(later.filter((m) => m.fromStart).every((m) => !m.reached));

    // El siguiente hito tampoco puede ser uno de partida
    const next = nextAesthetic(day0);
    if (next) assert.equal(next.fromStart, false);
});

test('byCategory cuenta bien y no inventa categorías', () => {
    const { comp, projection } = canonical();
    const milestones = aestheticMilestonesFor(projection, { startMuscleKg: comp.muscleKg }, 60);
    const groups = byCategory(milestones);
    const total = groups.reduce((s, g) => s + g.total, 0);
    // los de partida no entran en el recuento: ni suman ni restan
    assert.equal(total, milestones.filter((m) => !m.fromStart).length);
    for (const g of groups) assert.ok(g.reached <= g.total);
});

test('los hitos degradan con proyecciones basura sin lanzar', () => {
    for (const bad of [null, undefined, {}, { daily: [] }, { daily: [null] }, { daily: [{}] }]) {
        assert.deepEqual(aestheticMilestonesFor(/** @type {*} */ (bad), { startMuscleKg: 30 }, 0), []);
    }
    assert.equal(nextAesthetic(/** @type {*} */ (null)), null);
    assert.deepEqual(byCategory(/** @type {*} */ (null)), []);
});

// ---- Logros ----

test('los logros se desbloquean por lo que el usuario HIZO', () => {
    const none = evaluate({});
    assert.ok(none.every((a) => !a.unlocked), 'algo se desbloqueó sin hacer nada');

    const some = evaluate({ checkins: 12, longestStreak: 5, aestheticReached: 6, personalRecords: 2 });
    assert.ok(some.find((a) => a.id === 'checkins10')?.unlocked);
    assert.ok(!some.find((a) => a.id === 'checkins25')?.unlocked);
    assert.ok(some.find((a) => a.id === 'streak4')?.unlocked);
    assert.ok(!some.find((a) => a.id === 'streak12')?.unlocked);
    assert.ok(some.find((a) => a.id === 'firstPr')?.unlocked);
});

test('el progreso de cada logro está entre 0 y 1', () => {
    for (const stats of [{}, { checkins: 3 }, { checkins: 1000, longestStreak: 500 }]) {
        for (const a of evaluate(stats)) {
            assert.ok(a.progress >= 0 && a.progress <= 1, `${a.id} → ${a.progress}`);
        }
    }
});

test('evaluate degrada con basura', () => {
    for (const bad of [null, undefined, 'x', 42, { checkins: NaN }, { checkins: -5 }]) {
        const list = evaluate(/** @type {*} */ (bad));
        assert.equal(list.length, ACHIEVEMENT_RULES.length);
        assert.ok(list.every((a) => Number.isFinite(a.progress)));
    }
});

test('la tarjeta compartible NO lleva peso ni %grasa por defecto', () => {
    const card = shareCard({ percentComplete: 45, phaseKey: 'cut', streakWeeks: 6, achievementsUnlocked: 3, weightKg: 74.2, fatPct: 17.1 });
    assert.equal(card.weightKg, null, 'el peso se filtró sin que el usuario lo pidiera');
    assert.equal(card.fatPct, null);
    assert.equal(card.percentComplete, 45);
    assert.equal(card.streakWeeks, 6);
});

test('los absolutos solo salen con opt-in explícito', () => {
    const card = shareCard({ percentComplete: 45, phaseKey: 'cut', streakWeeks: 6, achievementsUnlocked: 3, weightKg: 74.2, fatPct: 17.1 },
        { includeAbsolutes: true });
    assert.equal(card.weightKg, 74.2);
    assert.equal(card.fatPct, 17.1);
});

test('shareCard degrada con basura y acota el porcentaje', () => {
    for (const bad of [null, undefined, 'x', { percentComplete: 500 }, { percentComplete: -20 }]) {
        const card = shareCard(/** @type {*} */ (bad));
        assert.ok(card.percentComplete >= 0 && card.percentComplete <= 100);
        assert.equal(card.weightKg, null);
    }
});

test('la puerta de datos absolutos solo se abre con includeAbsolutes === true', () => {
    // Son datos de salud: la puerta se abre con un true explícito y con nada
    // más. Cualquier otro valor —incluido uno «verdadero» como 1 o 'yes'— es
    // un no.
    const input = { percentComplete: 40, phaseKey: 'cut', streakWeeks: 3, achievementsUnlocked: 2, weightKg: 81.6, fatPct: 19.2 };
    for (const options of [undefined, {}, null, { includeAbsolutes: false },
        { includeAbsolutes: 1 }, { includeAbsolutes: 'yes' }, { includeAbsolutes: 'true' },
        { includeAbsolutes: {} }, { includeAbsolutes: [] }]) {
        const card = shareCard(input, /** @type {*} */ (options));
        assert.equal(card.weightKg, null, `se filtró el peso con ${JSON.stringify(options)}`);
        assert.equal(card.fatPct, null, `se filtró la grasa con ${JSON.stringify(options)}`);
    }
    const open = shareCard(input, { includeAbsolutes: true });
    assert.equal(open.weightKg, 81.6);
    assert.equal(open.fatPct, 19.2);
});

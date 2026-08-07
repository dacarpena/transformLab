// @ts-check

/**
 * Aritmética del recordatorio (M6-2).
 *
 * `msUntil` es la única parte del recordatorio que se puede equivocar en
 * silencio: si calcula mal, el aviso llega el día que no toca o no llega, y
 * nadie se entera hasta que pasa una semana. El resto (permisos, Notification)
 * es del navegador y se comprueba a mano.
 *
 * Trabaja en hora LOCAL a propósito: el usuario dice «los lunes a las 9» y eso
 * significa las 9 de su reloj, no las 9 UTC. Es la excepción consciente a la
 * regla de fechas en UTC del motor.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { msUntil } from '../src/ui/reminder.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;

/** Fecha local, para que el test diga lo mismo en cualquier huso. */
const at = (/** @type {number} */ y, /** @type {number} */ m, /** @type {number} */ d,
    /** @type {number} */ h, /** @type {number} */ min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

test('mismo día, más tarde: espera solo las horas que faltan', () => {
    // lunes 3 de agosto de 2026, 07:00 → lunes a las 09:00
    const now = at(2026, 8, 3, 7);
    assert.equal(now.getDay(), 1, 'el 3/8/2026 es lunes');
    assert.equal(msUntil({ weekday: 1, hour: 9 }, now), 2 * HOUR);
});

test('mismo día pero la hora ya pasó: se va a la semana siguiente', () => {
    // Es la trampa: a las 10 de un lunes, «lunes a las 9» NO es dentro de un
    // minuto ni hace una hora; es dentro de siete días.
    const now = at(2026, 8, 3, 10);
    assert.equal(msUntil({ weekday: 1, hour: 9 }, now), 7 * DAY - HOUR);
});

test('justo a la hora en punto salta a la semana siguiente, no a ahora mismo', () => {
    // Si devolviese 0, `setTimeout` dispararía en bucle.
    const now = at(2026, 8, 3, 9);
    assert.equal(msUntil({ weekday: 1, hour: 9 }, now), 7 * DAY);
});

test('día posterior de la misma semana', () => {
    // lunes 07:00 → viernes 20:00
    const now = at(2026, 8, 3, 7);
    assert.equal(msUntil({ weekday: 5, hour: 20 }, now), 4 * DAY + 13 * HOUR);
});

test('día anterior de la semana: da la vuelta correctamente', () => {
    // viernes 07:00 → lunes 09:00 (el lunes que viene, 3 días y 2 horas)
    const now = at(2026, 8, 7, 7);
    assert.equal(now.getDay(), 5, 'el 7/8/2026 es viernes');
    assert.equal(msUntil({ weekday: 1, hour: 9 }, now), 3 * DAY + 2 * HOUR);
});

test('domingo (weekday 0) no se confunde con «sin día»', () => {
    // domingo 2 de agosto de 2026, 08:00 → domingo a las 21:00
    const now = at(2026, 8, 2, 8);
    assert.equal(now.getDay(), 0);
    assert.equal(msUntil({ weekday: 0, hour: 21 }, now), 13 * HOUR);
});

test('el resultado siempre es positivo y nunca pasa de una semana', () => {
    for (let weekday = 0; weekday < 7; weekday += 1) {
        for (let hour = 0; hour < 24; hour += 1) {
            for (let offset = 0; offset < 7 * 24; offset += 1) {
                const now = new Date(at(2026, 8, 2, 0).getTime() + offset * HOUR);
                const ms = msUntil({ weekday, hour }, now);
                assert.ok(ms > 0, `no positivo: día ${weekday} hora ${hour} offset ${offset} → ${ms}`);
                assert.ok(ms <= 7 * DAY, `más de una semana: día ${weekday} hora ${hour} → ${ms}`);
            }
        }
    }
});

test('el instante que devuelve cae de verdad en el día y la hora pedidos', () => {
    for (let weekday = 0; weekday < 7; weekday += 1) {
        for (let hour = 0; hour < 24; hour += 1) {
            const now = at(2026, 8, 3, 13, 37);
            const target = new Date(now.getTime() + msUntil({ weekday, hour }, now));
            assert.equal(target.getDay(), weekday);
            assert.equal(target.getHours(), hour);
            assert.equal(target.getMinutes(), 0);
        }
    }
});

test('el cambio de hora no manda el aviso al día equivocado', () => {
    // Groenlandia adelanta el reloj a las 22:00 del sábado, así que las 23:00
    // de ese sábado NO EXISTEN. `setHours(23)` las normalizaba a las 00:00 del
    // domingo y el aviso llegaba un día tarde. Avisar una hora antes es un
    // desajuste; avisar otro día es un fallo.
    //
    // El test solo puede ejecutarse con la zona horaria puesta, así que se
    // comprueba la PROPIEDAD que lo cierra en cualquier huso: el instante
    // devuelto cae siempre en el día pedido.
    const SEMANAS_DE_CAMBIO = [
        '2026-03-25', '2026-03-27', '2026-03-29', '2026-03-31',
        '2026-10-22', '2026-10-24', '2026-10-26',
        '2027-03-12', '2027-03-14', '2027-03-16',
        '2026-11-01', '2026-11-03', '2026-04-22', '2026-04-24'
    ];
    let casos = 0;
    for (const dia of SEMANAS_DE_CAMBIO) {
        for (let h = 0; h < 24; h += 1) {
            const ahora = new Date(`${dia}T${String(h).padStart(2, '0')}:37:00`);
            if (Number.isNaN(ahora.getTime())) continue; // hora inexistente por el salto
            for (let weekday = 0; weekday < 7; weekday += 1) {
                for (const hour of [0, 3, 9, 23]) {
                    const ms = msUntil({ weekday, hour }, ahora);
                    const objetivo = new Date(ahora.getTime() + ms);
                    casos += 1;
                    assert.ok(ms > 0, `no positivo: ${dia} ${h}h → día ${weekday} ${hour}h`);
                    assert.ok(ms <= 8 * DAY, `más de 8 días: ${dia} ${h}h → día ${weekday} ${hour}h`);
                    assert.equal(objetivo.getDay(), weekday,
                        `día equivocado: el ${dia} a las ${h}h, «día ${weekday} a las ${hour}h» cayó en ${objetivo.toString().slice(0, 21)}`);
                    // La hora puede desplazarse una por el salto, nunca más
                    const desvio = Math.abs(objetivo.getHours() - hour);
                    assert.ok(desvio <= 1 || desvio === 23,
                        `hora desviada ${desvio} h: ${dia} ${h}h → día ${weekday} ${hour}h dio ${objetivo.getHours()}h`);
                }
            }
        }
    }
    assert.ok(casos > 8000, `se esperaban miles de casos, se probaron ${casos}`);
});

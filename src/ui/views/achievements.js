// @ts-check

/**
 * Logros y tarjeta compartible (M5-6, decisiones E9c/E9d).
 *
 * Los logros se DERIVAN del estado real en cada render: no hay banderas
 * guardadas que puedan quedarse mintiendo si el usuario borra check-ins.
 *
 * La tarjeta se dibuja a canvas y se descarga como PNG. Omite peso y %grasa
 * salvo que el usuario los active a propósito: compartir datos de salud es
 * una decisión suya, no la opción por omisión. El PNG se genera y se descarga
 * en el dispositivo; no hay red de por medio en ningún punto.
 */

import { html, render, on } from '../dom.js';
import { t } from '../../i18n/i18n.js';
import * as plans from '../plan-state.js';
import * as checkins from '../../data/checkins.js';
import { streakOf } from '../../core/tracking.js';
import { aestheticMilestonesFor } from '../../core/milestones.js';
import { evaluate, shareCard } from '../../core/achievements.js';
import { recordCount } from './training.js';
import * as toast from '../components/toast.js';

/** Estado local de la casilla de datos absolutos: arranca SIEMPRE apagada. */
let includeAbsolutes = false;

const CARD_W = 960;
const CARD_H = 540;

/**
 * Lee un token de color resuelto. Los colores siguen viviendo solo en
 * `tokens.css` (D8): aquí se consultan, no se declaran.
 * @param {string} name
 * @returns {string}
 */
function token(name) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value === '' ? '#000' : value;
}

/** Reúne el estado real del que se derivan los logros. */
function collectStats() {
    const data = plans.get();
    const list = checkins.list();
    const todayISO = plans.todayISO();

    let aestheticReached = 0;
    let percentComplete = 0;
    let phaseKey = 'maintenance';
    let streak = { current: 0, longest: 0, weeks: /** @type {number[]} */ ([]) };
    /** @type {number | null} */ let weightKg = null;
    /** @type {number | null} */ let fatPct = null;

    if (data) {
        const today = plans.todayIndex(data, todayISO);
        const milestones = aestheticMilestonesFor(
            data.projection,
            { startMuscleKg: data.composition.muscleKg },
            today.dayIndex
        );
        aestheticReached = milestones.filter((m) => m.reached).length;

        const total = data.projection.daily.length - 1;
        percentComplete = total > 0 ? Math.round((today.dayIndex / total) * 100) : 0;

        // La fase la lleva el punto de la serie, no `todayIndex` (que solo
        // devuelve índice y estado): leerla de otro sitio dejaba la tarjeta
        // anunciando «mantenimiento» a alguien en plena definición.
        const point = data.projection.daily[today.dayIndex];
        phaseKey = point?.phaseType ?? 'maintenance';

        streak = streakOf(list, todayISO, data.startDateISO);

        const last = list.at(-1);
        weightKg = last ? last.weightKg : point?.weightKg ?? null;
        fatPct = last?.fatPct ?? point?.fatPct ?? null;
    }

    return {
        checkins: list.length,
        longestStreak: streak.longest,
        aestheticReached,
        personalRecords: recordCount(),
        percentComplete,
        phaseKey,
        streakWeeks: streak.current,
        weightKg,
        fatPct
    };
}

/**
 * @param {ReturnType<typeof collectStats>} stats
 * @param {import('../../core/achievements.js').Achievement[]} achievements
 */
function cardData(stats, achievements) {
    return shareCard({
        percentComplete: stats.percentComplete,
        phaseKey: stats.phaseKey,
        streakWeeks: stats.streakWeeks,
        achievementsUnlocked: achievements.filter((a) => a.unlocked).length,
        weightKg: stats.weightKg ?? undefined,
        fatPct: stats.fatPct ?? undefined
    }, { includeAbsolutes });
}

/**
 * Dibuja la tarjeta. Todo el texto sale de i18n y todo el color de tokens.
 * @param {HTMLCanvasElement} canvas
 * @param {ReturnType<typeof cardData>} card
 */
function paintCard(canvas, card) {
    canvas.width = CARD_W;
    canvas.height = CARD_H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bg = token('--color-surface-2');
    const fg = token('--color-text');
    const muted = token('--color-text-muted');
    const accent = token('--color-accent');

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, CARD_W, CARD_H);

    ctx.fillStyle = accent;
    ctx.fillRect(0, 0, CARD_W, 8);

    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = muted;
    ctx.font = '600 28px system-ui, sans-serif';
    ctx.fillText(t('app.title'), 64, 92);

    ctx.fillStyle = fg;
    ctx.font = '700 120px system-ui, sans-serif';
    ctx.fillText(`${card.percentComplete}%`, 64, 220);

    ctx.fillStyle = muted;
    ctx.font = '400 32px system-ui, sans-serif';
    ctx.fillText(t('achievements.cardProgress', { percent: card.percentComplete }), 64, 268);

    // barra de progreso
    const barY = 300, barW = CARD_W - 128, barH = 18;
    ctx.fillStyle = token('--color-surface');
    ctx.fillRect(64, barY, barW, barH);
    ctx.fillStyle = accent;
    ctx.fillRect(64, barY, (barW * card.percentComplete) / 100, barH);

    const lines = [
        t('achievements.cardPhase', { phase: t(`phase.${card.phaseKey}`) }),
        t('achievements.cardStreak', { weeks: card.streakWeeks }),
        t('achievements.cardUnlocked', { count: card.achievementsUnlocked })
    ];
    if (card.weightKg !== null) lines.push(t('achievements.cardWeight', { kg: card.weightKg.toFixed(1) }));
    if (card.fatPct !== null) lines.push(t('achievements.cardFat', { pct: card.fatPct.toFixed(1) }));

    ctx.fillStyle = fg;
    ctx.font = '400 30px system-ui, sans-serif';
    lines.forEach((line, i) => ctx.fillText(line, 64, 380 + i * 44));
}

/**
 * Texto equivalente de la tarjeta: el canvas es una imagen y necesita
 * alternativa textual (F7, 1.1.1).
 * @param {ReturnType<typeof cardData>} card
 */
function cardAltText(card) {
    const parts = [
        t('achievements.cardProgress', { percent: card.percentComplete }),
        t('achievements.cardPhase', { phase: t(`phase.${card.phaseKey}`) }),
        t('achievements.cardStreak', { weeks: card.streakWeeks }),
        t('achievements.cardUnlocked', { count: card.achievementsUnlocked })
    ];
    if (card.weightKg !== null) parts.push(t('achievements.cardWeight', { kg: card.weightKg.toFixed(1) }));
    if (card.fatPct !== null) parts.push(t('achievements.cardFat', { pct: card.fatPct.toFixed(1) }));
    return parts.join('. ');
}

/** @param {HTMLElement} container */
function draw(container) {
    const stats = collectStats();
    const achievements = evaluate(stats);
    const unlocked = achievements.filter((a) => a.unlocked).length;
    const card = cardData(stats, achievements);

    render(container, html`
        <section class="card" aria-labelledby="ach-title">
            <div class="card__header">
                <h2 id="ach-title" class="card__title">${t('achievements.title')}</h2>
                <span class="muted numeric">${t('achievements.unlockedCount', { unlocked, total: achievements.length })}</span>
            </div>
            <ul class="achievement-grid">
                ${achievements.map((a) => html`
                    <li class="achievement ${a.unlocked ? 'achievement--unlocked' : ''}">
                        <span class="achievement__icon" aria-hidden="true">${a.unlocked ? '★' : '☆'}</span>
                        <span class="achievement__name">${t(`achievements.${a.id}`)}</span>
                        <span class="muted numeric">${Math.round(a.progress * 100)}%</span>
                        <div class="progress"
                             role="progressbar" aria-valuenow="${Math.round(a.progress * 100)}"
                             aria-valuemin="0" aria-valuemax="100"
                             aria-label="${t(`achievements.${a.id}`)}">
                            <div class="progress__fill" style="--progress: ${a.progress}"></div>
                        </div>
                    </li>
                `)}
            </ul>
        </section>

        <section class="card" aria-labelledby="share-title">
            <h2 id="share-title" class="card__title">${t('achievements.share')}</h2>
            <p class="muted">${t('achievements.shareHint')}</p>
            <label class="switch">
                <input type="checkbox" data-absolutes ${includeAbsolutes ? 'checked' : ''}>
                <span>${t('achievements.shareIncludeAbsolutes')}</span>
            </label>
            <canvas class="share-card" data-card role="img" aria-label="${cardAltText(card)}"></canvas>
            <div class="btn-row">
                <button type="button" class="btn btn--primary" data-download>${t('achievements.downloadCard')}</button>
            </div>
        </section>
    `);

    const canvas = /** @type {HTMLCanvasElement | null} */ (container.querySelector('[data-card]'));
    if (canvas) paintCard(canvas, card);
}

/** @param {HTMLElement} container */
export function mount(container) {
    draw(container);

    on(container, 'change', '[data-absolutes]', (event) => {
        includeAbsolutes = /** @type {HTMLInputElement} */ (event.target).checked;
        draw(container);
    });

    on(container, 'click', '[data-download]', () => {
        const canvas = /** @type {HTMLCanvasElement | null} */ (container.querySelector('[data-card]'));
        if (!canvas) return;
        canvas.toBlob((blob) => {
            if (!blob) {
                toast.error('achievements.downloadFailed');
                return;
            }
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `transformlab-${plans.todayISO()}.png`;
            link.click();
            URL.revokeObjectURL(url);
            toast.success('achievements.downloaded');
        }, 'image/png');
    });
}

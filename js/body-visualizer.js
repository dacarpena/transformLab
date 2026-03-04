// ============================================
// TRANSFORMLAB - Body Visualizer v4.0
// SVG body silhouette with dynamic composition
// ============================================

const BodyVisualizer = {

    /**
     * Generate a simplified SVG body silhouette.
     * Fat layer opacity and muscle group saturation are adjusted
     * based on fatPct and muscleKg relative to initial values.
     *
     * @param {number} fatPct         - Current body fat %
     * @param {number} muscleProgress - 0-1, muscle gain relative to target
     * @param {string} sex            - 'male' or 'female'
     * @returns {string} SVG markup
     */
    buildSilhouetteSVG(fatPct, muscleProgress, sex = 'male') {
        // Fat opacity scales 0→0.7 as fatPct goes from 8→40
        const fatOpacity = Math.max(0, Math.min(0.7, (fatPct - 8) / 35));
        // Muscle saturation 0.2→1.0
        const muscleSat  = 0.2 + muscleProgress * 0.8;

        const baseColor  = sex === 'female' ? '#c97b9a' : '#5a8fd6';
        const fatColor   = '#e8c48a';
        const muscleColor = `hsl(${sex === 'female' ? 340 : 200}, ${Math.round(muscleSat * 70)}%, ${Math.round(30 + muscleSat * 20)}%)`;

        return `
<svg viewBox="0 0 120 300" xmlns="http://www.w3.org/2000/svg" class="body-svg" aria-hidden="true">
    <defs>
        <radialGradient id="fatGrad" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="${fatColor}" stop-opacity="${fatOpacity}"/>
            <stop offset="100%" stop-color="${fatColor}" stop-opacity="0"/>
        </radialGradient>
    </defs>

    <!-- Head -->
    <ellipse cx="60" cy="22" rx="18" ry="20" fill="${baseColor}" opacity="0.9"/>

    <!-- Neck -->
    <rect x="54" y="40" width="12" height="14" rx="4" fill="${baseColor}" opacity="0.85"/>

    <!-- Torso -->
    <rect id="muscle-chest" x="30" y="54" width="60" height="55" rx="10"
          fill="${muscleColor}" opacity="0.85"/>
    <!-- Abs -->
    <rect id="muscle-abs" x="38" y="109" width="44" height="48" rx="8"
          fill="${muscleColor}" opacity="0.8"/>

    <!-- Arms -->
    <rect id="muscle-arm-l" x="12" y="54" width="16" height="60" rx="8"
          fill="${muscleColor}" opacity="0.8"/>
    <rect id="muscle-arm-r" x="92" y="54" width="16" height="60" rx="8"
          fill="${muscleColor}" opacity="0.8"/>
    <!-- Forearms -->
    <rect x="9"  y="114" width="14" height="40" rx="7" fill="${muscleColor}" opacity="0.7"/>
    <rect x="97" y="114" width="14" height="40" rx="7" fill="${muscleColor}" opacity="0.7"/>

    <!-- Hips -->
    <ellipse cx="60" cy="160" rx="30" ry="10" fill="${baseColor}" opacity="0.7"/>

    <!-- Legs -->
    <rect id="muscle-leg-l" x="32" y="158" width="22" height="80" rx="11"
          fill="${muscleColor}" opacity="0.8"/>
    <rect id="muscle-leg-r" x="66" y="158" width="22" height="80" rx="11"
          fill="${muscleColor}" opacity="0.8"/>
    <!-- Calves -->
    <rect x="33" y="238" width="20" height="42" rx="10" fill="${muscleColor}" opacity="0.7"/>
    <rect x="67" y="238" width="20" height="42" rx="10" fill="${muscleColor}" opacity="0.7"/>

    <!-- Fat overlay layer -->
    <ellipse cx="60" cy="135" rx="44" ry="60" fill="url(#fatGrad)" class="fat-layer"/>
    <ellipse cx="60" cy="165" rx="36" ry="40" fill="${fatColor}" opacity="${(fatOpacity * 0.6).toFixed(2)}" class="fat-layer"/>
    <ellipse cx="35" cy="80"  rx="10" ry="18" fill="${fatColor}" opacity="${(fatOpacity * 0.4).toFixed(2)}" class="fat-layer"/>
    <ellipse cx="85" cy="80"  rx="10" ry="18" fill="${fatColor}" opacity="${(fatOpacity * 0.4).toFixed(2)}" class="fat-layer"/>
</svg>`;
    },

    /**
     * Build a stats comparison panel.
     */
    _buildStatsPanel(label, physical, initial, target, color) {
        const weightDiff  = (physical.weight  - initial.weight).toFixed(1);
        const muscleDiff  = (physical.muscleKg - initial.muscleKg).toFixed(1);
        const fatDiff     = (physical.fatPct   - initial.fatPct).toFixed(1);

        const signWeight  = weightDiff  > 0 ? '+' : '';
        const signMuscle  = muscleDiff  > 0 ? '+' : '';
        const signFat     = fatDiff     > 0 ? '+' : '';

        return `
            <div class="body-stats-panel" style="border-color: ${color}20">
                <h4 style="color:${color}">${label}</h4>
                <div class="body-stat"><span>Peso</span><strong>${physical.weight} kg <span class="diff">${signWeight}${weightDiff}</span></strong></div>
                <div class="body-stat"><span>Músculo</span><strong>${physical.muscleKg} kg <span class="diff muscle">${signMuscle}${muscleDiff}</span></strong></div>
                <div class="body-stat"><span>% Grasa</span><strong>${physical.fatPct}% <span class="diff fat">${signFat}${fatDiff}</span></strong></div>
            </div>
        `;
    },

    render() {
        const container = document.getElementById('bodyContent');
        if (!container) return;

        if (!AppState.userProfile || !AppState.data?.daily) {
            container.innerHTML = '<p class="text-muted">Completa el onboarding para ver el visualizador.</p>';
            return;
        }

        const { profile } = AppState.userProfile;
        const sex = profile.sex || 'male';

        const firstDay   = AppState.data.daily[0];
        const currentIdx = AppState.navigation.currentDay - 1;
        const currentDay = AppState.data.daily[currentIdx];
        const lastDay    = AppState.data.daily[AppState.data.daily.length - 1];

        const initial = AppState.userProfile.initial;
        const target  = AppState.userProfile.target;

        // Muscle progress 0-1
        const muscleRange   = Math.max(0.01, target.muscleKg - initial.muscleKg);
        const muscleGained  = currentDay.physical.muscleKg - initial.muscleKg;
        const muscleProgress = Math.max(0, Math.min(1, muscleGained / muscleRange));

        // Initial silhouette
        const initMuscleProgress = 0;
        const initSVG    = this.buildSilhouetteSVG(initial.fatPct, initMuscleProgress, sex);
        const currentSVG = this.buildSilhouetteSVG(currentDay.physical.fatPct, muscleProgress, sex);
        const targetSVG  = this.buildSilhouetteSVG(target.fatPct,
            1, // full muscle target
            sex
        );

        container.innerHTML = `
            <div class="body-visualizer-layout">

                <div class="body-comparison">

                    <div class="body-column">
                        <div class="body-label">Inicio</div>
                        ${initSVG}
                        ${this._buildStatsPanel('Inicio', firstDay.physical, initial, target, '#9b59b6')}
                    </div>

                    <div class="body-column current">
                        <div class="body-label">Ahora</div>
                        ${currentSVG}
                        ${this._buildStatsPanel('Actual', currentDay.physical, initial, target, '#00d4ff')}
                        <div class="body-day-badge">Día ${currentDay.day}</div>
                    </div>

                    <div class="body-column">
                        <div class="body-label">Objetivo</div>
                        ${targetSVG}
                        ${this._buildStatsPanel('Objetivo', { weight: target.weight, muscleKg: target.muscleKg, fatPct: target.fatPct }, initial, target, '#48bb78')}
                    </div>

                </div>

                <div class="body-progress-summary card-glass">
                    <h3>📊 Progreso acumulado</h3>
                    <div class="progress-items">
                        ${this._progressItem('Grasa perdida', initial.fatPct - currentDay.physical.fatPct, '%', '#ff6b6b', true)}
                        ${this._progressItem('Músculo ganado', currentDay.physical.muscleKg - initial.muscleKg, 'kg', '#48bb78', false)}
                        ${this._progressItem('Cambio de peso', currentDay.physical.weight - initial.weight, 'kg', '#00d4ff', null)}
                    </div>
                </div>

            </div>
        `;
    },

    _progressItem(label, value, unit, color, lowerIsBetter) {
        const rounded = Math.round(value * 10) / 10;
        const sign    = rounded > 0 ? '+' : '';
        const isGood  = lowerIsBetter === null ? true :
                        (lowerIsBetter ? rounded < 0 : rounded > 0);
        const goodClass = isGood ? 'good' : 'neutral';

        return `
            <div class="progress-item">
                <span class="progress-label">${label}</span>
                <span class="progress-value ${goodClass}" style="color:${color}">
                    ${sign}${rounded}${unit}
                </span>
            </div>
        `;
    }
};

if (typeof window !== 'undefined') {
    window.BodyVisualizer = BodyVisualizer;
}

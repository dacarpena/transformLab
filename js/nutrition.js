// ============================================
// TRANSFORMLAB - Nutrition Module v4.0
// Daily macro plan based on current phase
// ============================================

const NutritionModule = {

    /**
     * Calculate macro targets for the current day/phase.
     *
     * @param {number} weight    - Current weight in kg
     * @param {string} phaseType - Current phase type
     * @param {object} profile   - User profile
     * @returns {object} { calories, protein, carbs, fats }
     */
    calculateMacros(weight, phaseType, profile) {
        const bmr  = Calculations.calculateBMR(weight, profile.height, profile.age, profile.sex);
        const tdee = Calculations.calculateTDEE(bmr, profile.activityLevel || 'moderate');
        const goal = Calculations.calculateCaloricTarget(tdee, phaseType);

        const calories = goal.target;

        // Protein: 2.2 g/kg during cut, 1.8 g/kg otherwise
        const proteinG = Math.round(weight * (phaseType === 'cut' ? 2.2 : 1.8));
        const proteinCal = proteinG * 4;

        // Fats: 22% of total calories
        const fatsCal = Math.round(calories * 0.22);
        const fatsG   = Math.round(fatsCal / 9);

        // Carbs: remainder
        const carbsCal = calories - proteinCal - fatsCal;
        const carbsG   = Math.max(0, Math.round(carbsCal / 4));

        return { calories, protein: proteinG, carbs: carbsG, fats: fatsG };
    },

    /**
     * Adjust macros for a refeed / diet-break day.
     */
    refeedMacros(baseMacros, refeedType) {
        const mult = refeedType === 'diet_break' ? 1.0 : 1.2;
        const calories = Math.round(baseMacros.calories * mult);
        // On refeed: extra calories → mostly carbs
        const extraCal = calories - baseMacros.calories;
        const extraCarbsG = Math.round(extraCal / 4);
        return {
            calories,
            protein: baseMacros.protein,
            carbs: baseMacros.carbs + extraCarbsG,
            fats: baseMacros.fats
        };
    },

    /** Meal distribution templates (fraction of daily calories) */
    MEAL_TEMPLATES: {
        cut: [
            { name: 'Desayuno',     fraction: 0.25, suggestions: ['Claras de huevo + avena', 'Yogur griego + fruta', 'Batido proteico + plátano'] },
            { name: 'Pre-entreno',  fraction: 0.15, suggestions: ['Arroz + pavo', 'Plátano + whey', 'Pan integral + jamón de pavo'] },
            { name: 'Comida',       fraction: 0.30, suggestions: ['Pollo + arroz + verduras', 'Merluza + patata + ensalada', 'Lentejas + pechuga'] },
            { name: 'Post-entreno', fraction: 0.15, suggestions: ['Whey + plátano', 'Requesón + fruta', 'Arroz con leche desnatado'] },
            { name: 'Cena',         fraction: 0.15, suggestions: ['Salmón + verduras al vapor', 'Tortilla de claras + ensalada', 'Pollo a la plancha + brócoli'] }
        ],
        bulk: [
            { name: 'Desayuno',     fraction: 0.20, suggestions: ['Avena + leche + huevos', 'Pan integral + mantequilla de cacahuete + batido', 'Gachas de avena + frutos secos'] },
            { name: 'Media mañana', fraction: 0.10, suggestions: ['Frutos secos + fruta', 'Batido de masa', 'Pan + atún'] },
            { name: 'Comida',       fraction: 0.30, suggestions: ['Pasta + carne magra + aceite', 'Arroz + salmón + aguacate', 'Patata + ternera + verduras'] },
            { name: 'Pre-entreno',  fraction: 0.15, suggestions: ['Arroz + pollo', 'Plátanos + whey', 'Macarrones + pavo'] },
            { name: 'Post-entreno', fraction: 0.15, suggestions: ['Whey + zumo de uva', 'Arroz + claras', 'Batido gainer casero'] },
            { name: 'Cena',         fraction: 0.10, suggestions: ['Requesón + fruta', 'Pollo + verduras', 'Huevos revueltos + tostadas'] }
        ],
        default: [
            { name: 'Desayuno',  fraction: 0.25, suggestions: ['Avena + proteína + fruta', 'Huevos revueltos + tostada integral'] },
            { name: 'Comida',    fraction: 0.35, suggestions: ['Proteína magra + arroz o patata + verduras'] },
            { name: 'Merienda',  fraction: 0.15, suggestions: ['Yogur + fruta + frutos secos'] },
            { name: 'Cena',      fraction: 0.25, suggestions: ['Proteína + verduras + grasas saludables'] }
        ]
    },

    // ── SVG Donut Chart ───────────────────────

    /**
     * Build a simple SVG donut chart for macro distribution.
     */
    buildDonutSVG(macros) {
        const total = macros.protein * 4 + macros.carbs * 4 + macros.fats * 9;
        if (total <= 0) return '';

        const proteinPct = (macros.protein * 4 / total) * 100;
        const carbsPct   = (macros.carbs   * 4 / total) * 100;
        const fatsPct    = (macros.fats    * 9 / total) * 100;

        const cx = 60, cy = 60, r = 44, stroke = 22;
        const circumference = 2 * Math.PI * r;

        const segments = [
            { pct: proteinPct, color: '#48bb78', label: 'Proteína' },
            { pct: carbsPct,   color: '#00d4ff', label: 'Carbos' },
            { pct: fatsPct,    color: '#fbbf24', label: 'Grasas' }
        ];

        let offset = 0;
        const arcs = segments.map(seg => {
            const dash    = (seg.pct / 100) * circumference;
            const gap     = circumference - dash;
            const rotDeg  = (offset / 100) * 360 - 90;
            offset += seg.pct;
            return `<circle cx="${cx}" cy="${cy}" r="${r}"
                        fill="none"
                        stroke="${seg.color}"
                        stroke-width="${stroke}"
                        stroke-dasharray="${dash.toFixed(2)} ${gap.toFixed(2)}"
                        transform="rotate(${rotDeg.toFixed(2)} ${cx} ${cy})"
                        opacity="0.85"/>`;
        }).join('');

        return `<svg viewBox="0 0 120 120" class="macro-donut" aria-hidden="true">
            <circle cx="${cx}" cy="${cy}" r="${r}" fill="none"
                stroke="rgba(255,255,255,0.06)" stroke-width="${stroke}"/>
            ${arcs}
            <text x="${cx}" y="${cy - 6}" text-anchor="middle"
                  font-size="13" fill="#fff" font-weight="600">${macros.calories}</text>
            <text x="${cx}" y="${cy + 10}" text-anchor="middle"
                  font-size="8" fill="rgba(255,255,255,0.5)">kcal</text>
        </svg>`;
    },

    // ── Render ────────────────────────────────

    render() {
        const container = document.getElementById('nutritionContent');
        if (!container) return;

        if (!AppState.userProfile || !AppState.data?.daily) {
            container.innerHTML = '<p class="text-muted">Completa el onboarding para ver tu plan nutricional.</p>';
            return;
        }

        const { profile }   = AppState.userProfile;
        const currentDayIdx = AppState.navigation.currentDay - 1;
        const dayData       = AppState.data.daily[currentDayIdx];

        if (!dayData) { container.innerHTML = '<p class="text-muted">Sin datos para este día.</p>'; return; }

        const weight    = dayData.physical.weight;
        const phaseType = dayData.phaseType;
        let macros      = this.calculateMacros(weight, phaseType, profile);

        // Adjust for refeed day
        if (dayData.isRefeedDay) {
            macros = this.refeedMacros(macros, dayData.refeedType);
        }

        const meals = this.MEAL_TEMPLATES[phaseType] || this.MEAL_TEMPLATES.default;
        const mealsHTML = meals.map(meal => {
            const mealCal = Math.round(macros.calories * meal.fraction);
            const suggestion = meal.suggestions[Math.floor(Math.random() * meal.suggestions.length)];
            return `
                <div class="nutrition-meal">
                    <div class="meal-header">
                        <span class="meal-name">${meal.name}</span>
                        <span class="meal-kcal">${mealCal} kcal</span>
                    </div>
                    <p class="meal-suggestion">${suggestion}</p>
                </div>
            `;
        }).join('');

        const phaseLabel = {
            cut: 'Definición', bulk: 'Volumen',
            recomposition: 'Recomposición', adaptation: 'Adaptación',
            transition: 'Transición', maintenance: 'Mantenimiento'
        }[phaseType] || phaseType;

        container.innerHTML = `
            <div class="nutrition-layout">

                <!-- Macro overview -->
                <div class="nutrition-overview card-glass">
                    <div class="macro-donut-wrapper">
                        ${this.buildDonutSVG(macros)}
                    </div>
                    <div class="macro-targets">
                        <h3>${macros.calories} kcal/día</h3>
                        <p class="text-muted">Fase: ${phaseLabel}${dayData.isRefeedDay ? ' · <strong>Día de recarga</strong>' : ''}</p>
                        <div class="macro-bars">
                            ${this._macroBar('Proteína', macros.protein, 'g', '#48bb78')}
                            ${this._macroBar('Carbos',   macros.carbs,   'g', '#00d4ff')}
                            ${this._macroBar('Grasas',   macros.fats,    'g', '#fbbf24')}
                        </div>
                    </div>
                </div>

                <!-- Meal plan -->
                <div class="nutrition-meals card-glass">
                    <div class="meals-header">
                        <h3>🍽️ Distribución de comidas</h3>
                        <button class="btn-ghost" onclick="NutritionModule.copyToClipboard()" title="Copiar plan">📋 Copiar</button>
                    </div>
                    ${mealsHTML}
                </div>

                <!-- Tips -->
                <div class="nutrition-tips card-glass">
                    <h3>💡 Consejos para esta fase</h3>
                    ${this._phaseTips(phaseType)}
                </div>

            </div>
        `;
    },

    _macroBar(label, grams, unit, color) {
        return `
            <div class="macro-bar-row">
                <span class="macro-label">${label}</span>
                <span class="macro-grams" style="color:${color}">${grams}${unit}</span>
            </div>
        `;
    },

    _phaseTips(phaseType) {
        const tips = {
            cut: ['Distribuye proteína en 4-5 comidas para reducir catabolismo.', 'Hidrátate bien — reduce retención y apetito.', 'Las fibras vegetales ayudan a sentirte lleno con menos calorías.'],
            bulk: ['Añade carbohidratos en comidas peri-entreno para mejorar el rendimiento.', 'No te preocupes por subir ligeramente la grasa — es esperado.', 'Proteína mínima 1.8g/kg para soporte muscular.'],
            recomposition: ['Come cerca del TDEE — pequeño déficit (~5%) es suficiente.', 'Prioriza proteína alta para síntesis muscular máxima.', 'Los carbohidratos post-entreno son especialmente importantes.'],
            default: ['Come en horarios regulares para controlar el apetito.', 'Hidratación es clave para el rendimiento.', 'Prioriza alimentos integrales sobre procesados.']
        };
        const list = tips[phaseType] || tips.default;
        return `<ul class="tips-list">${list.map(t => `<li>${t}</li>`).join('')}</ul>`;
    },

    copyToClipboard() {
        if (!AppState.userProfile) return;
        const { profile } = AppState.userProfile;
        const dayData = AppState.data.daily[AppState.navigation.currentDay - 1];
        if (!dayData) return;
        const macros = this.calculateMacros(dayData.physical.weight, dayData.phaseType, profile);
        const text = `TransformLab — Plan nutricional\n` +
            `Calorías: ${macros.calories} kcal\n` +
            `Proteína: ${macros.protein}g | Carbos: ${macros.carbs}g | Grasas: ${macros.fats}g`;
        navigator.clipboard?.writeText(text).then(() => {
            alert('Plan copiado al portapapeles ✓');
        }).catch(() => {});
    }
};

if (typeof window !== 'undefined') {
    window.NutritionModule = NutritionModule;
}

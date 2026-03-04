// ============================================
// TRANSFORMLAB - Check-in Module v4.0
// Weekly real-data registration and plan adjustment
// ============================================

const CheckinModule = {

    STORAGE_KEY: 'transformlab_checkins',

    // ── Data ──────────────────────────────────

    /** Load all saved check-ins from localStorage */
    loadAll() {
        try {
            return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '[]');
        } catch {
            return [];
        }
    },

    /** Save the full check-ins array */
    saveAll(checkins) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(checkins));
        AppState.realCheckins = checkins;
    },

    /** Return the most recent check-in, or null */
    getLatest() {
        const all = this.loadAll();
        return all.length > 0 ? all[all.length - 1] : null;
    },

    /** Return how many days since the last check-in (null → never) */
    daysSinceLastCheckin() {
        const latest = this.getLatest();
        if (!latest) return null;
        const diff = Date.now() - new Date(latest.date).getTime();
        return Math.floor(diff / (1000 * 60 * 60 * 24));
    },

    /**
     * Save a new check-in, compare against projected data, and
     * optionally adjust the plan if deviation is too large.
     *
     * @param {object} data - Form data from _collectFormData()
     */
    save(data) {
        const all = this.loadAll();
        all.push(data);
        this.saveAll(all);
        console.log('📋 Check-in saved:', data);

        // Analyse deviation vs projected
        const adjustment = this._analyseDeviation(data);
        return adjustment; // { recommendation, severity }
    },

    /**
     * Compare real weight with projected weight for that week.
     */
    _analyseDeviation(checkin) {
        if (!AppState.data?.weekly) return null;

        const weekIdx = checkin.week - 1;
        const projected = AppState.data.weekly[weekIdx];
        if (!projected) return null;

        const projectedWeight = projected.weeklyAverages?.physical?.weight
            || projected.endOfWeek?.physical?.weight;
        if (!projectedWeight) return null;

        const diff = checkin.measurements.weight - projectedWeight;
        const adherence = checkin.selfReport.adherence / 100;

        let recommendation = null;
        let severity = 'ok';

        if (diff > 1.5) {
            // Losing weight slower than expected
            if (adherence < 0.80) {
                recommendation = 'Tu adherencia es menor del 80%. Enfócate en la consistencia antes de ajustar calorías.';
                severity = 'warning';
            } else {
                recommendation = 'Considera reducir 100–150 kcal o añadir 10–15 min de cardio esta semana.';
                severity = 'warning';
            }
        } else if (diff < -1.5) {
            // Losing too fast → muscle risk
            recommendation = 'Estás perdiendo peso muy rápido. Aumenta 100–200 kcal para preservar músculo.';
            severity = 'alert';
        }

        return { recommendation, severity, diff: Math.round(diff * 100) / 100, projectedWeight };
    },

    // ── Render ────────────────────────────────

    /** Main render — called by router on viewchange */
    render() {
        const container = document.getElementById('checkinContent');
        if (!container) return;

        const all          = this.loadAll();
        const latest       = all[all.length - 1] || null;
        const daysSince    = this.daysSinceLastCheckin();
        const currentWeek  = AppState.navigation?.currentWeek || 1;
        const alreadyThisWeek = latest && latest.week === currentWeek;

        container.innerHTML = `
            <div class="checkin-layout">
                <!-- Summary panel -->
                <div class="checkin-summary">
                    <h3>Tu historial</h3>
                    ${all.length === 0
                        ? '<p class="text-muted">Aún no tienes check-ins registrados.</p>'
                        : this._renderHistoryList(all)
                    }
                </div>

                <!-- Form panel -->
                <div class="checkin-form-panel">
                    ${alreadyThisWeek
                        ? `<div class="checkin-done-banner">
                                <span>✅ Ya registraste la semana ${currentWeek}</span>
                                <button class="btn-secondary" onclick="CheckinModule._showForm(${currentWeek}, true)">Editar</button>
                           </div>`
                        : ''
                    }

                    ${daysSince !== null && daysSince >= 7 && !alreadyThisWeek
                        ? `<div class="checkin-reminder">
                                ⏰ Han pasado ${daysSince} días desde tu último check-in.
                           </div>`
                        : ''
                    }

                    <div id="checkinFormWrapper">
                        ${alreadyThisWeek ? '' : this._renderForm(currentWeek)}
                    </div>

                    <div id="checkinFeedback"></div>
                </div>
            </div>

            <!-- Real data on chart notice -->
            ${all.length > 0
                ? `<p class="checkin-chart-notice">
                    💡 Los puntos reales se muestran en el gráfico principal (vista semanal).
                  </p>`
                : ''
            }
        `;

        // Attach submit handler
        const form = document.getElementById('checkinForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                this._handleSubmit(currentWeek);
            });
        }

        // Sliders live-update labels
        container.querySelectorAll('input[type="range"]').forEach(slider => {
            this._attachSliderLabel(slider);
        });
    },

    _renderForm(week) {
        return `
            <form id="checkinForm" class="checkin-form">
                <h3>Check-in — Semana ${week}</h3>

                <fieldset class="checkin-fieldset">
                    <legend>📏 Medidas (peso obligatorio)</legend>

                    <div class="checkin-field required">
                        <label>Peso actual (kg)</label>
                        <input type="number" id="ci-weight" name="weight"
                               step="0.1" min="30" max="250" required
                               placeholder="Ej: 82.5">
                    </div>

                    <div class="checkin-field">
                        <label>% Grasa corporal <span class="optional">(opcional)</span></label>
                        <input type="number" id="ci-fatPct" name="fatPct"
                               step="0.5" min="3" max="60"
                               placeholder="Si tienes báscula de impedancia">
                    </div>

                    <div class="checkin-field">
                        <label>Cintura (cm) <span class="optional">(opcional)</span></label>
                        <input type="number" id="ci-waist" name="waist"
                               step="0.5" min="40" max="180">
                    </div>
                </fieldset>

                <fieldset class="checkin-fieldset">
                    <legend>🧠 Auto-evaluación</legend>

                    ${this._renderSlider('ci-energy',    'energy',    'Nivel de energía',    1, 10, 7)}
                    ${this._renderSlider('ci-sleep',     'sleep',     'Calidad del sueño',   1, 10, 7)}
                    ${this._renderSlider('ci-adherence', 'adherence', 'Adherencia al plan (%)', 0, 100, 80, 5)}
                    ${this._renderSlider('ci-motivation','motivation','Motivación',           1, 10, 7)}
                </fieldset>

                <div class="checkin-field">
                    <label>📝 Notas (opcional)</label>
                    <textarea id="ci-notes" name="notes" rows="3"
                              placeholder="¿Cómo fue la semana? Lesiones, viajes, estrés..."></textarea>
                </div>

                <button type="submit" class="btn-primary checkin-submit">
                    Guardar check-in ✓
                </button>
            </form>
        `;
    },

    _renderSlider(id, name, label, min, max, defaultVal, step = 1) {
        return `
            <div class="checkin-slider-row">
                <label for="${id}">${label}</label>
                <div class="slider-with-value">
                    <input type="range" id="${id}" name="${name}"
                           min="${min}" max="${max}" value="${defaultVal}" step="${step}">
                    <span class="slider-value-label" data-for="${id}">${defaultVal}</span>
                </div>
            </div>
        `;
    },

    _attachSliderLabel(slider) {
        const label = document.querySelector(`.slider-value-label[data-for="${slider.id}"]`);
        if (label) {
            slider.addEventListener('input', () => { label.textContent = slider.value; });
        }
    },

    _renderHistoryList(checkins) {
        return `<ul class="checkin-history-list">
            ${[...checkins].reverse().slice(0, 8).map(c => {
                const projected = AppState.data?.weekly?.[c.week - 1];
                const projW = projected?.weeklyAverages?.physical?.weight;
                const diff = projW ? (c.measurements.weight - projW).toFixed(1) : null;
                const diffClass = diff === null ? '' : (diff > 0 ? 'diff-high' : 'diff-low');
                return `
                    <li class="checkin-history-item">
                        <span class="ci-week">S${c.week}</span>
                        <span class="ci-weight">${c.measurements.weight} kg</span>
                        ${diff !== null ? `<span class="ci-diff ${diffClass}">${diff > 0 ? '+' : ''}${diff} vs plan</span>` : ''}
                        <span class="ci-date">${new Date(c.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</span>
                    </li>
                `;
            }).join('')}
        </ul>`;
    },

    _handleSubmit(week) {
        const weight = parseFloat(document.getElementById('ci-weight')?.value);
        if (!weight || weight < 30 || weight > 250) {
            this._showFeedback('Por favor ingresa un peso válido.', 'error');
            return;
        }

        const checkin = {
            id: `checkin_${Date.now()}`,
            week,
            date: new Date().toISOString().split('T')[0],
            measurements: {
                weight,
                fatPct:  parseFloat(document.getElementById('ci-fatPct')?.value)  || null,
                waist:   parseFloat(document.getElementById('ci-waist')?.value)   || null,
            },
            selfReport: {
                energy:     parseInt(document.getElementById('ci-energy')?.value     || 7),
                sleepQuality: parseInt(document.getElementById('ci-sleep')?.value    || 7),
                adherence:  parseInt(document.getElementById('ci-adherence')?.value  || 80),
                motivation: parseInt(document.getElementById('ci-motivation')?.value || 7),
                notes:      document.getElementById('ci-notes')?.value?.trim() || ''
            }
        };

        const adjustment = this.save(checkin);

        // Re-render the chart if it's visible
        if (typeof renderMainChart === 'function') renderMainChart();

        // Show result
        let feedbackHtml = `<div class="checkin-success">
            ✅ <strong>Check-in guardado.</strong> Peso registrado: ${weight} kg
        </div>`;

        if (adjustment?.recommendation) {
            const icon = adjustment.severity === 'alert' ? '🚨' : '⚠️';
            feedbackHtml += `<div class="checkin-adjustment ${adjustment.severity}">
                ${icon} ${adjustment.recommendation}
            </div>`;
        }

        document.getElementById('checkinFeedback').innerHTML = feedbackHtml;
        document.getElementById('checkinFormWrapper').innerHTML = `
            <p class="text-muted" style="margin-top:1rem;">
                Vuelve la próxima semana para tu siguiente check-in.
            </p>
        `;
    },

    _showFeedback(msg, type = 'info') {
        const fb = document.getElementById('checkinFeedback');
        if (fb) fb.innerHTML = `<div class="checkin-feedback-${type}">${msg}</div>`;
    },

    _showForm(week, override = false) {
        const wrapper = document.getElementById('checkinFormWrapper');
        if (wrapper) wrapper.innerHTML = this._renderForm(week);
        const form = document.getElementById('checkinForm');
        if (form) form.addEventListener('submit', (e) => { e.preventDefault(); this._handleSubmit(week); });
        document.querySelectorAll('input[type="range"]').forEach(s => this._attachSliderLabel(s));
    }
};

if (typeof window !== 'undefined') {
    window.CheckinModule = CheckinModule;
}

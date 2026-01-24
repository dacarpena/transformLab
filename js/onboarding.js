// ============================================
// TRANSFORMLAB - Onboarding System
// User input collection, validation, and profile management
// ============================================

const Onboarding = {
    
    // Current step in onboarding wizard
    currentStep: 1,
    totalSteps: 4,
    
    // Collected data
    userData: {
        profile: {
            age: null,
            sex: 'male',
            height: null,
            trainingStatus: 'beginner',
            activityLevel: 'moderate'
        },
        initial: {
            weight: null,
            fatPct: null,
            muscleKg: null
        },
        target: {
            weight: null,
            fatPct: null,
            muscleKg: null
        },
        startDate: null
    },
    
    /**
     * Check if user has completed onboarding
     */
    hasCompletedOnboarding() {
        const saved = localStorage.getItem('transformlab_userProfile');
        return saved !== null;
    },
    
    /**
     * Load saved user profile
     */
    loadUserProfile() {
        const saved = localStorage.getItem('transformlab_userProfile');
        if (saved) {
            return JSON.parse(saved);
        }
        return null;
    },
    
    /**
     * Save user profile to localStorage
     */
    saveUserProfile(profile) {
        localStorage.setItem('transformlab_userProfile', JSON.stringify(profile));
    },
    
    /**
     * Clear user profile (for reset)
     */
    clearUserProfile() {
        localStorage.removeItem('transformlab_userProfile');
        localStorage.removeItem('transformlab_generatedData');
    },
    
    /**
     * Show onboarding wizard
     */
    show() {
        this.currentStep = 1;
        this.userData = {
            profile: { age: 30, sex: 'male', height: 175, trainingStatus: 'beginner', activityLevel: 'moderate' },
            initial: { weight: null, fatPct: null, muscleKg: null },
            target: { weight: null, fatPct: null, muscleKg: null },
            startDate: new Date().toISOString().split('T')[0]
        };
        
        this.renderOverlay();
        this.renderStep(1);
    },
    
    /**
     * Render the onboarding overlay container
     */
    renderOverlay() {
        // Remove existing overlay if any
        const existing = document.getElementById('onboardingOverlay');
        if (existing) existing.remove();
        
        const overlay = document.createElement('div');
        overlay.id = 'onboardingOverlay';
        overlay.className = 'onboarding-overlay';
        overlay.innerHTML = `
            <div class="onboarding-container">
                <div class="onboarding-header">
                    <div class="onboarding-logo">🏋️</div>
                    <h1>TransformLab</h1>
                    <p class="onboarding-subtitle">Configura tu plan de transformación personalizado</p>
                </div>
                
                <div class="onboarding-progress">
                    <div class="progress-steps">
                        <div class="progress-step active" data-step="1">
                            <span class="step-number">1</span>
                            <span class="step-label">Perfil</span>
                        </div>
                        <div class="progress-line"></div>
                        <div class="progress-step" data-step="2">
                            <span class="step-number">2</span>
                            <span class="step-label">Estado actual</span>
                        </div>
                        <div class="progress-line"></div>
                        <div class="progress-step" data-step="3">
                            <span class="step-number">3</span>
                            <span class="step-label">Objetivos</span>
                        </div>
                        <div class="progress-line"></div>
                        <div class="progress-step" data-step="4">
                            <span class="step-number">4</span>
                            <span class="step-label">Confirmar</span>
                        </div>
                    </div>
                </div>
                
                <div class="onboarding-content" id="onboardingContent">
                    <!-- Dynamic content -->
                </div>
                
                <div class="onboarding-footer">
                    <button id="onboardingPrev" class="onboarding-btn secondary" style="visibility: hidden;">
                        ← Anterior
                    </button>
                    <button id="onboardingNext" class="onboarding-btn primary">
                        Siguiente →
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(overlay);
        
        // Animate in
        requestAnimationFrame(() => {
            overlay.classList.add('visible');
        });
        
        // Setup navigation buttons
        document.getElementById('onboardingPrev').addEventListener('click', () => this.prevStep());
        document.getElementById('onboardingNext').addEventListener('click', () => this.nextStep());
    },
    
    /**
     * Render specific step content
     */
    renderStep(step) {
        const content = document.getElementById('onboardingContent');
        const prevBtn = document.getElementById('onboardingPrev');
        const nextBtn = document.getElementById('onboardingNext');
        
        // Update progress indicators
        document.querySelectorAll('.progress-step').forEach((el, i) => {
            el.classList.toggle('active', i + 1 <= step);
            el.classList.toggle('current', i + 1 === step);
        });
        
        // Show/hide prev button
        prevBtn.style.visibility = step > 1 ? 'visible' : 'hidden';
        
        // Update next button text
        nextBtn.textContent = step === this.totalSteps ? '🚀 Comenzar' : 'Siguiente →';
        
        switch (step) {
            case 1:
                this.renderProfileStep(content);
                break;
            case 2:
                this.renderInitialStep(content);
                break;
            case 3:
                this.renderTargetStep(content);
                break;
            case 4:
                this.renderConfirmStep(content);
                break;
        }
    },
    
    /**
     * Step 1: User Profile
     */
    renderProfileStep(container) {
        container.innerHTML = `
            <div class="step-content">
                <h2>👤 Tu perfil</h2>
                <p class="step-description">Esta información nos ayuda a calcular tu metabolismo y expectativas realistas.</p>
                
                <div class="input-grid">
                    <div class="input-group">
                        <label for="profileAge">Edad</label>
                        <input type="number" id="profileAge" min="16" max="80" value="${this.userData.profile.age || 30}" placeholder="30">
                        <span class="input-hint">años</span>
                    </div>
                    
                    <div class="input-group">
                        <label for="profileHeight">Altura</label>
                        <input type="number" id="profileHeight" min="140" max="220" value="${this.userData.profile.height || 175}" placeholder="175">
                        <span class="input-hint">cm</span>
                    </div>
                    
                    <div class="input-group full-width">
                        <label>Sexo biológico</label>
                        <div class="radio-group">
                            <label class="radio-option ${this.userData.profile.sex === 'male' ? 'selected' : ''}">
                                <input type="radio" name="profileSex" value="male" ${this.userData.profile.sex === 'male' ? 'checked' : ''}>
                                <span class="radio-label">♂️ Masculino</span>
                            </label>
                            <label class="radio-option ${this.userData.profile.sex === 'female' ? 'selected' : ''}">
                                <input type="radio" name="profileSex" value="female" ${this.userData.profile.sex === 'female' ? 'checked' : ''}>
                                <span class="radio-label">♀️ Femenino</span>
                            </label>
                        </div>
                    </div>
                    
                    <div class="input-group full-width">
                        <label>Experiencia en entrenamiento</label>
                        <div class="radio-group vertical">
                            <label class="radio-option ${this.userData.profile.trainingStatus === 'beginner' ? 'selected' : ''}">
                                <input type="radio" name="trainingStatus" value="beginner" ${this.userData.profile.trainingStatus === 'beginner' ? 'checked' : ''}>
                                <span class="radio-label">🌱 Principiante</span>
                                <span class="radio-desc">Menos de 1 año de entrenamiento consistente</span>
                            </label>
                            <label class="radio-option ${this.userData.profile.trainingStatus === 'intermediate' ? 'selected' : ''}">
                                <input type="radio" name="trainingStatus" value="intermediate" ${this.userData.profile.trainingStatus === 'intermediate' ? 'checked' : ''}>
                                <span class="radio-label">💪 Intermedio</span>
                                <span class="radio-desc">1-3 años de entrenamiento consistente</span>
                            </label>
                            <label class="radio-option ${this.userData.profile.trainingStatus === 'advanced' ? 'selected' : ''}">
                                <input type="radio" name="trainingStatus" value="advanced" ${this.userData.profile.trainingStatus === 'advanced' ? 'checked' : ''}>
                                <span class="radio-label">🏆 Avanzado</span>
                                <span class="radio-desc">Más de 3 años de entrenamiento consistente</span>
                            </label>
                        </div>
                    </div>
                    
                    <div class="input-group full-width">
                        <label>Nivel de actividad diaria</label>
                        <select id="activityLevel">
                            <option value="sedentary" ${this.userData.profile.activityLevel === 'sedentary' ? 'selected' : ''}>Sedentario (trabajo de oficina)</option>
                            <option value="light" ${this.userData.profile.activityLevel === 'light' ? 'selected' : ''}>Ligero (ejercicio 1-3 días/semana)</option>
                            <option value="moderate" ${this.userData.profile.activityLevel === 'moderate' ? 'selected' : ''}>Moderado (ejercicio 3-5 días/semana)</option>
                            <option value="active" ${this.userData.profile.activityLevel === 'active' ? 'selected' : ''}>Activo (ejercicio 6-7 días/semana)</option>
                            <option value="veryActive" ${this.userData.profile.activityLevel === 'veryActive' ? 'selected' : ''}>Muy activo (trabajo físico + ejercicio)</option>
                        </select>
                    </div>
                </div>
            </div>
        `;
        
        this.setupProfileListeners();
    },
    
    /**
     * Step 2: Initial Composition
     */
    renderInitialStep(container) {
        const estimated = this.userData.initial.muscleKg || 
            (this.userData.initial.weight && this.userData.initial.fatPct ? 
                Calculations.estimateMuscleFromComposition(this.userData.initial.weight, this.userData.initial.fatPct) : null);
        
        container.innerHTML = `
            <div class="step-content">
                <h2>📊 Tu estado actual</h2>
                <p class="step-description">Introduce tus medidas actuales. Si no tienes datos exactos, puedes usar estimaciones.</p>
                
                <div class="input-grid">
                    <div class="input-group">
                        <label for="initialWeight">Peso actual</label>
                        <input type="number" id="initialWeight" min="40" max="200" step="0.1" 
                            value="${this.userData.initial.weight || ''}" placeholder="75">
                        <span class="input-hint">kg</span>
                    </div>
                    
                    <div class="input-group">
                        <label for="initialFat">% Grasa corporal</label>
                        <input type="number" id="initialFat" min="5" max="50" step="0.1" 
                            value="${this.userData.initial.fatPct || ''}" placeholder="20">
                        <span class="input-hint">%</span>
                        <button class="help-btn" onclick="Onboarding.showFatGuide()">¿Cómo estimarlo?</button>
                    </div>
                    
                    <div class="input-group full-width">
                        <label for="initialMuscle">Masa muscular (opcional)</label>
                        <input type="number" id="initialMuscle" min="20" max="100" step="0.1" 
                            value="${estimated || ''}" placeholder="Auto-calculada">
                        <span class="input-hint">kg</span>
                        <span class="auto-calc-hint" id="muscleAutoHint">
                            ${estimated ? `Estimación basada en tu composición: ~${estimated}kg` : 'Se calculará automáticamente'}
                        </span>
                    </div>
                </div>
                
                <div class="composition-preview" id="compositionPreview">
                    <!-- Will be populated dynamically -->
                </div>
            </div>
        `;
        
        this.setupInitialListeners();
        this.updateCompositionPreview();
    },
    
    /**
     * Step 3: Target Goals
     */
    renderTargetStep(container) {
        const minFat = Calculations.MIN_SAFE_FAT[this.userData.profile.sex];
        
        container.innerHTML = `
            <div class="step-content">
                <h2>🎯 Tus objetivos</h2>
                <p class="step-description">Define tus metas. Te ayudaremos a establecer objetivos realistas y seguros.</p>
                
                <div class="input-grid">
                    <div class="input-group">
                        <label for="targetFat">% Grasa objetivo</label>
                        <input type="number" id="targetFat" min="${minFat}" max="40" step="0.5" 
                            value="${this.userData.target.fatPct || ''}" placeholder="12">
                        <span class="input-hint">% (mín: ${minFat}%)</span>
                    </div>
                    
                    <div class="input-group">
                        <label for="targetMuscle">Masa muscular objetivo</label>
                        <input type="number" id="targetMuscle" min="30" max="100" step="0.5" 
                            value="${this.userData.target.muscleKg || ''}" placeholder="65">
                        <span class="input-hint">kg</span>
                    </div>
                    
                    <div class="input-group full-width">
                        <label for="targetWeight">Peso objetivo (calculado)</label>
                        <input type="number" id="targetWeight" min="40" max="150" step="0.1" 
                            value="${this.userData.target.weight || ''}" placeholder="Auto" readonly>
                        <span class="input-hint">kg (basado en composición objetivo)</span>
                    </div>
                    
                    <div class="input-group full-width">
                        <label for="startDate">Fecha de inicio</label>
                        <input type="date" id="startDate" value="${this.userData.startDate}">
                        <div class="quick-dates">
                            <button class="quick-date" data-days="0">Hoy</button>
                            <button class="quick-date" data-days="-7">En 1 semana</button>
                            <button class="quick-date" data-days="-14">En 2 semanas</button>
                        </div>
                    </div>
                </div>
                
                <div class="validation-panel" id="validationPanel">
                    <!-- Validation results will appear here -->
                </div>
                
                <div class="timeline-preview" id="timelinePreview">
                    <!-- Timeline preview will appear here -->
                </div>
            </div>
        `;
        
        this.setupTargetListeners();
        this.updateTargetValidation();
    },
    
    /**
     * Step 4: Confirmation
     */
    renderConfirmStep(container) {
        const validation = this.validateAll();
        
        if (!validation.isValid) {
            container.innerHTML = `
                <div class="step-content error-state">
                    <h2>⚠️ Revisa los datos</h2>
                    <p class="step-description">Hay algunos problemas que necesitan corrección:</p>
                    
                    <div class="error-list">
                        ${validation.errors.map(e => `<div class="error-item">❌ ${e}</div>`).join('')}
                    </div>
                    
                    <p class="error-action">Por favor, vuelve a los pasos anteriores para corregir estos problemas.</p>
                </div>
            `;
            return;
        }
        
        const { profile, initial, target, startDate } = this.userData;
        const phases = Calculations.calculatePhaseDurations(initial, target, profile);
        
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + phases.totalDays);
        
        container.innerHTML = `
            <div class="step-content">
                <h2>✅ Confirma tu plan</h2>
                <p class="step-description">Revisa los detalles de tu transformación personalizada.</p>
                
                <div class="confirm-grid">
                    <div class="confirm-card">
                        <h3>👤 Tu perfil</h3>
                        <div class="confirm-details">
                            <span>${profile.age} años, ${profile.sex === 'male' ? 'Masculino' : 'Femenino'}</span>
                            <span>${profile.height} cm</span>
                            <span>Nivel: ${this.getTrainingStatusLabel(profile.trainingStatus)}</span>
                        </div>
                    </div>
                    
                    <div class="confirm-card">
                        <h3>📊 Estado inicial</h3>
                        <div class="confirm-details">
                            <span><strong>${initial.weight}</strong> kg peso</span>
                            <span><strong>${initial.fatPct}</strong>% grasa</span>
                            <span><strong>${initial.muscleKg}</strong> kg músculo</span>
                        </div>
                    </div>
                    
                    <div class="confirm-card highlight">
                        <h3>🎯 Objetivos</h3>
                        <div class="confirm-details">
                            <span><strong>${target.weight}</strong> kg peso</span>
                            <span><strong>${target.fatPct}</strong>% grasa</span>
                            <span><strong>${target.muscleKg}</strong> kg músculo</span>
                        </div>
                    </div>
                    
                    <div class="confirm-card timeline">
                        <h3>📅 Timeline</h3>
                        <div class="confirm-details">
                            <span>Inicio: <strong>${new Date(startDate).toLocaleDateString('es-ES')}</strong></span>
                            <span>Fin estimado: <strong>${endDate.toLocaleDateString('es-ES')}</strong></span>
                            <span>Duración: <strong>${phases.totalDays} días</strong> (~${Math.round(phases.totalDays / 30)} meses)</span>
                        </div>
                    </div>
                </div>
                
                <div class="phases-preview">
                    <h3>📋 Fases del plan</h3>
                    <div class="phases-list">
                        ${phases.phases.map((phase, i) => `
                            <div class="phase-item" style="--phase-color: ${this.getPhaseColor(phase.type)}">
                                <span class="phase-name">${phase.name}</span>
                                <span class="phase-duration">${phase.days} días</span>
                                <span class="phase-desc">${phase.description}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                ${validation.warnings.length > 0 ? `
                    <div class="warnings-panel">
                        <h4>⚠️ Notas importantes:</h4>
                        ${validation.warnings.map(w => `<p>• ${w}</p>`).join('')}
                    </div>
                ` : ''}
                
                <div class="methodology-note">
                    <p>📚 Plan basado en: Mifflin-St Jeor (BMR), Aragon 2017 (pérdida grasa), McDonald/Helms (ganancia muscular)</p>
                </div>
            </div>
        `;
    },
    
    // ============================================
    // EVENT LISTENERS
    // ============================================
    
    setupProfileListeners() {
        // Radio buttons for sex
        document.querySelectorAll('input[name="profileSex"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.userData.profile.sex = e.target.value;
                document.querySelectorAll('.radio-option').forEach(opt => {
                    opt.classList.toggle('selected', opt.querySelector('input').checked);
                });
            });
        });
        
        // Radio buttons for training status
        document.querySelectorAll('input[name="trainingStatus"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.userData.profile.trainingStatus = e.target.value;
                document.querySelectorAll('.radio-option').forEach(opt => {
                    opt.classList.toggle('selected', opt.querySelector('input').checked);
                });
            });
        });
        
        // Age input
        document.getElementById('profileAge')?.addEventListener('input', (e) => {
            this.userData.profile.age = parseInt(e.target.value) || null;
        });
        
        // Height input
        document.getElementById('profileHeight')?.addEventListener('input', (e) => {
            this.userData.profile.height = parseInt(e.target.value) || null;
        });
        
        // Activity level
        document.getElementById('activityLevel')?.addEventListener('change', (e) => {
            this.userData.profile.activityLevel = e.target.value;
        });
    },
    
    setupInitialListeners() {
        const weightInput = document.getElementById('initialWeight');
        const fatInput = document.getElementById('initialFat');
        const muscleInput = document.getElementById('initialMuscle');
        
        const updateMuscleEstimate = () => {
            const weight = parseFloat(weightInput.value);
            const fat = parseFloat(fatInput.value);
            
            if (weight && fat) {
                const estimated = Calculations.estimateMuscleFromComposition(weight, fat);
                document.getElementById('muscleAutoHint').textContent = 
                    `Estimación basada en tu composición: ~${estimated}kg`;
                
                if (!muscleInput.value) {
                    this.userData.initial.muscleKg = estimated;
                }
            }
            
            this.updateCompositionPreview();
        };
        
        weightInput?.addEventListener('input', (e) => {
            this.userData.initial.weight = parseFloat(e.target.value) || null;
            updateMuscleEstimate();
        });
        
        fatInput?.addEventListener('input', (e) => {
            this.userData.initial.fatPct = parseFloat(e.target.value) || null;
            updateMuscleEstimate();
        });
        
        muscleInput?.addEventListener('input', (e) => {
            this.userData.initial.muscleKg = parseFloat(e.target.value) || null;
            this.updateCompositionPreview();
        });
    },
    
    setupTargetListeners() {
        const fatInput = document.getElementById('targetFat');
        const muscleInput = document.getElementById('targetMuscle');
        const weightInput = document.getElementById('targetWeight');
        const dateInput = document.getElementById('startDate');
        
        const updateTargetWeight = () => {
            const fat = parseFloat(fatInput.value);
            const muscle = parseFloat(muscleInput.value);
            
            if (fat && muscle && fat >= 5 && muscle >= 20) {
                // FIXED: Pass initial composition to correctly calculate target weight
                // when user provides measured muscle mass (DEXA/bioimpedance)
                const weight = Calculations.calculateTargetWeight(muscle, fat, this.userData.initial);
                if (weight && weight > 40) {
                    weightInput.value = weight;
                    this.userData.target.weight = weight;
                } else {
                    weightInput.value = '';
                    this.userData.target.weight = null;
                }
            } else {
                weightInput.value = '';
                this.userData.target.weight = null;
            }
            
            this.updateTargetValidation();
        };
        
        fatInput?.addEventListener('input', (e) => {
            this.userData.target.fatPct = parseFloat(e.target.value) || null;
            updateTargetWeight();
        });
        
        muscleInput?.addEventListener('input', (e) => {
            this.userData.target.muscleKg = parseFloat(e.target.value) || null;
            updateTargetWeight();
        });
        
        dateInput?.addEventListener('change', (e) => {
            this.userData.startDate = e.target.value;
            this.updateTargetValidation();
        });
        
        // Quick date buttons
        document.querySelectorAll('.quick-date').forEach(btn => {
            btn.addEventListener('click', () => {
                const days = parseInt(btn.dataset.days);
                const date = new Date();
                date.setDate(date.getDate() - days);
                dateInput.value = date.toISOString().split('T')[0];
                this.userData.startDate = dateInput.value;
                this.updateTargetValidation();
            });
        });
    },
    
    // ============================================
    // UI UPDATES
    // ============================================
    
    updateCompositionPreview() {
        const preview = document.getElementById('compositionPreview');
        if (!preview) return;
        
        const { weight, fatPct, muscleKg } = this.userData.initial;
        
        if (!weight || !fatPct) {
            preview.innerHTML = '<p class="preview-placeholder">Introduce peso y % grasa para ver tu composición</p>';
            return;
        }
        
        const fatKg = weight * (fatPct / 100);
        const leanMass = weight - fatKg;
        const muscle = muscleKg || Calculations.estimateMuscleFromComposition(weight, fatPct);
        
        // Calculate BMR
        const { age, sex, height } = this.userData.profile;
        const bmr = Calculations.calculateBMR(weight, height || 175, age || 30, sex);
        const tdee = Calculations.calculateTDEE(bmr, this.userData.profile.activityLevel);
        
        preview.innerHTML = `
            <div class="composition-bars">
                <div class="comp-bar">
                    <div class="bar-label">Grasa</div>
                    <div class="bar-track">
                        <div class="bar-fill fat" style="width: ${fatPct}%"></div>
                    </div>
                    <div class="bar-value">${fatKg.toFixed(1)} kg (${fatPct}%)</div>
                </div>
                <div class="comp-bar">
                    <div class="bar-label">Músculo</div>
                    <div class="bar-track">
                        <div class="bar-fill muscle" style="width: ${(muscle / weight * 100)}%"></div>
                    </div>
                    <div class="bar-value">${muscle.toFixed(1)} kg</div>
                </div>
                <div class="comp-bar">
                    <div class="bar-label">Masa magra</div>
                    <div class="bar-track">
                        <div class="bar-fill lean" style="width: ${(leanMass / weight * 100)}%"></div>
                    </div>
                    <div class="bar-value">${leanMass.toFixed(1)} kg</div>
                </div>
            </div>
            <div class="metabolism-info">
                <span>🔥 Metabolismo basal: <strong>${bmr}</strong> kcal/día</span>
                <span>⚡ Gasto total estimado: <strong>${tdee}</strong> kcal/día</span>
            </div>
        `;
        
        // Update muscle estimate in userData if not manually set
        if (!this.userData.initial.muscleKg) {
            this.userData.initial.muscleKg = muscle;
        }
    },
    
    updateTargetValidation() {
        const panel = document.getElementById('validationPanel');
        const timelinePreview = document.getElementById('timelinePreview');
        if (!panel) return;
        
        const { initial, target, profile } = this.userData;
        
        if (!target.fatPct || !target.muscleKg) {
            panel.innerHTML = '';
            timelinePreview.innerHTML = '';
            return;
        }
        
        // Ensure initial muscle is set
        if (!initial.muscleKg && initial.weight && initial.fatPct) {
            initial.muscleKg = Calculations.estimateMuscleFromComposition(initial.weight, initial.fatPct);
        }
        
        const validation = Calculations.validateInputs(initial, target, profile);
        
        if (validation.errors.length > 0) {
            panel.innerHTML = `
                <div class="validation-errors">
                    ${validation.errors.map(e => `<div class="val-error">❌ ${e}</div>`).join('')}
                </div>
            `;
            timelinePreview.innerHTML = '';
            return;
        }
        
        // Show warnings if any
        let warningsHtml = '';
        if (validation.warnings.length > 0) {
            warningsHtml = `
                <div class="validation-warnings">
                    ${validation.warnings.map(w => `<div class="val-warning">⚠️ ${w}</div>`).join('')}
                </div>
            `;
        }
        
        panel.innerHTML = `
            <div class="validation-success">✅ Objetivos válidos y alcanzables</div>
            ${warningsHtml}
        `;
        
        // Show timeline preview
        const phases = validation.phases;
        timelinePreview.innerHTML = `
            <div class="timeline-summary">
                <h4>📅 Resumen del plan</h4>
                <div class="summary-stats">
                    <div class="stat">
                        <span class="stat-value">${phases.totalDays}</span>
                        <span class="stat-label">días</span>
                    </div>
                    <div class="stat">
                        <span class="stat-value">${phases.summary.estimatedMonths}</span>
                        <span class="stat-label">meses</span>
                    </div>
                    <div class="stat">
                        <span class="stat-value">${phases.summary.fatToLose > 0 ? '-' + phases.summary.fatToLose : '0'}</span>
                        <span class="stat-label">kg grasa</span>
                    </div>
                    <div class="stat">
                        <span class="stat-value">+${phases.summary.muscleToGain}</span>
                        <span class="stat-label">kg músculo</span>
                    </div>
                </div>
            </div>
        `;
    },
    
    // ============================================
    // NAVIGATION
    // ============================================
    
    nextStep() {
        // Validate current step
        if (!this.validateStep(this.currentStep)) {
            return;
        }
        
        if (this.currentStep < this.totalSteps) {
            this.currentStep++;
            this.renderStep(this.currentStep);
        } else {
            // Complete onboarding
            this.complete();
        }
    },
    
    prevStep() {
        if (this.currentStep > 1) {
            this.currentStep--;
            this.renderStep(this.currentStep);
        }
    },
    
    validateStep(step) {
        switch (step) {
            case 1:
                const { age, height } = this.userData.profile;
                if (!age || age < 16 || age > 80) {
                    this.showError('Introduce una edad válida (16-80 años)');
                    return false;
                }
                if (!height || height < 140 || height > 220) {
                    this.showError('Introduce una altura válida (140-220 cm)');
                    return false;
                }
                return true;
                
            case 2:
                const { weight, fatPct } = this.userData.initial;
                if (!weight || weight < 40 || weight > 200) {
                    this.showError('Introduce un peso válido (40-200 kg)');
                    return false;
                }
                if (!fatPct || fatPct < 5 || fatPct > 50) {
                    this.showError('Introduce un % de grasa válido (5-50%)');
                    return false;
                }
                // Auto-calculate muscle if not set
                if (!this.userData.initial.muscleKg) {
                    this.userData.initial.muscleKg = Calculations.estimateMuscleFromComposition(weight, fatPct);
                }
                return true;
                
            case 3:
                const { fatPct: targetFat, muscleKg: targetMuscle } = this.userData.target;
                const minFat = Calculations.MIN_SAFE_FAT[this.userData.profile.sex];
                
                if (!targetFat || targetFat < minFat || targetFat > 40) {
                    this.showError(`Introduce un % de grasa objetivo válido (${minFat}-40%)`);
                    return false;
                }
                if (!targetMuscle || targetMuscle < 30 || targetMuscle > 100) {
                    this.showError('Introduce una masa muscular objetivo válida (30-100 kg)');
                    return false;
                }
                // Calculate target weight
                // FIXED: Pass initial composition to correctly calculate target weight
                if (!this.userData.target.weight) {
                    this.userData.target.weight = Calculations.calculateTargetWeight(targetMuscle, targetFat, this.userData.initial);
                }
                return true;
                
            case 4:
                return this.validateAll().isValid;
        }
        return true;
    },
    
    validateAll() {
        const { initial, target, profile } = this.userData;
        return Calculations.validateInputs(initial, target, profile);
    },
    
    showError(message) {
        // Show temporary error toast
        const toast = document.createElement('div');
        toast.className = 'error-toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('visible');
        }, 10);
        
        setTimeout(() => {
            toast.classList.remove('visible');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },
    
    // ============================================
    // COMPLETION
    // ============================================
    
    complete() {
        // Generate full user profile
        const userProfile = {
            initial: this.userData.initial,
            target: this.userData.target,
            profile: this.userData.profile,
            startDate: this.userData.startDate
        };
        
        // Save to localStorage
        this.saveUserProfile(userProfile);
        
        // Generate transformation data
        console.log('🧮 Generando datos de transformación...');
        const transformationData = DataGenerator.generateTransformationData(userProfile);
        
        // Generate milestones
        const milestones = DataGenerator.generateMilestones(userProfile, transformationData.phases);
        transformationData.milestones = milestones;
        
        // Save generated data
        localStorage.setItem('transformlab_generatedData', JSON.stringify(transformationData));
        
        console.log('✅ Datos generados:', {
            days: transformationData.daily.length,
            weeks: transformationData.weekly.length,
            months: transformationData.monthly.length,
            phases: transformationData.phases.length,
            milestones: milestones.length
        });
        
        // Close overlay with animation
        const overlay = document.getElementById('onboardingOverlay');
        overlay.classList.remove('visible');
        
        setTimeout(() => {
            overlay.remove();
            // Initialize the app with generated data
            if (typeof initializeWithGeneratedData === 'function') {
                initializeWithGeneratedData(transformationData, userProfile);
            } else {
                window.location.reload();
            }
        }, 300);
    },
    
    // ============================================
    // HELPERS
    // ============================================
    
    showFatGuide() {
        const modal = document.createElement('div');
        modal.className = 'fat-guide-modal';
        modal.innerHTML = `
            <div class="fat-guide-content">
                <button class="close-guide" onclick="this.parentElement.parentElement.remove()">✕</button>
                <h3>📏 Guía de % Grasa Corporal</h3>
                
                <div class="fat-guide-grid">
                    <div class="fat-example">
                        <span class="fat-range">25-30%</span>
                        <span class="fat-desc">Sobrepeso: Grasa visible, sin definición muscular</span>
                    </div>
                    <div class="fat-example">
                        <span class="fat-range">20-25%</span>
                        <span class="fat-desc">Normal: Algo de grasa abdominal, poca definición</span>
                    </div>
                    <div class="fat-example">
                        <span class="fat-range">15-20%</span>
                        <span class="fat-desc">Fitness: Abdominales visibles parcialmente</span>
                    </div>
                    <div class="fat-example">
                        <span class="fat-range">12-15%</span>
                        <span class="fat-desc">Atlético: Six-pack visible, vascularidad</span>
                    </div>
                    <div class="fat-example">
                        <span class="fat-range">8-12%</span>
                        <span class="fat-desc">Definido: Definición muscular clara</span>
                    </div>
                </div>
                
                <p class="fat-note">* Los valores son orientativos para hombres. Mujeres: añadir +8-10%</p>
            </div>
        `;
        document.body.appendChild(modal);
        
        setTimeout(() => modal.classList.add('visible'), 10);
        
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    },
    
    getTrainingStatusLabel(status) {
        const labels = {
            beginner: 'Principiante',
            intermediate: 'Intermedio',
            advanced: 'Avanzado'
        };
        return labels[status] || status;
    },
    
    getPhaseColor(type) {
        const colors = {
            adaptation: '#9b59b6',
            recomposition: '#3498db',
            cut: '#e74c3c',
            bulk: '#27ae60',
            transition: '#f39c12',
            maintenance: '#1abc9c'
        };
        return colors[type] || '#666';
    }
};

// Export
if (typeof window !== 'undefined') {
    window.Onboarding = Onboarding;
}

// ============================================
// TRANSFORMLAB - App Principal v3.0
// Sistema adaptativo de transformación física
// Basado en ciencia: Mifflin-St Jeor, Aragon 2017, McDonald/Helms
// ============================================

// Estado global de la aplicación
const AppState = {
    // Perfil de usuario (desde onboarding)
    userProfile: null,
    
    // Fecha de inicio del proceso
    startDate: null,
    
    // Datos generados dinámicamente
    data: {
        daily: null,
        weekly: null,
        monthly: null,
        phases: null,
        metadata: null,
        milestones: null
    },
    
    // Estado de navegación
    navigation: {
        granularity: 'weekly',
        currentDay: 1,
        currentWeek: 1,
        currentMonth: 1,
        currentPhase: 0,
        currentIndex: 0
    },
    
    // Estado de UI
    ui: {
        visibleMetrics: ['weight', 'muscleKg', 'fatPct'],
        chartType: 'line',
        theme: 'dark',
        sidebarOpen: true
    },
    
    // Charts
    charts: {},
    
    // Configuración
    config: {
        animationDuration: 300,
        dateFormat: 'es-ES'
    }
};

// Colores por métrica
const METRIC_COLORS = {
    // Físicas
    weight: '#00d4ff',
    fatPct: '#ff6b6b',
    fatKg: '#ff9f43',
    muscleKg: '#48bb78',
    leanMassKg: '#a855f7',
    
    // Rendimiento
    strength: '#f6ad55',
    agility: '#4fd1c5',
    mobility: '#14b8a6',
    
    // Bienestar
    aesthetics: '#ed64a6',
    mentalRecovery: '#faf089',
    generalFeeling: '#faf089',
    selfEsteem: '#9f7aea',
    sleepQuality: '#667eea',
    energy: '#fbbf24',
    mentalClarity: '#a78bfa',
    bodyInflammation: '#f43f5e'
};

// Colores por fase
const PHASE_COLORS = {
    adaptation: '#9b59b6',
    recomposition: '#3498db',
    cut: '#e74c3c',
    bulk: '#27ae60',
    maintenance: '#1abc9c',
    transition: '#f39c12'
};

// ============================================
// CARGA DE DATOS Y ONBOARDING
// ============================================
async function loadAllData() {
    showLoadingState(true);
    
    try {
        // Verificar si el usuario ha completado el onboarding
        if (!Onboarding.hasCompletedOnboarding()) {
            showLoadingState(false);
            Onboarding.show();
            return;
        }
        
        // Cargar perfil de usuario guardado
        const userProfile = Onboarding.loadUserProfile();
        if (!userProfile) {
            showLoadingState(false);
            Onboarding.show();
            return;
        }
        
        AppState.userProfile = userProfile;
        AppState.startDate = new Date(userProfile.startDate);
        
        // Intentar cargar datos generados previamente
        const savedData = localStorage.getItem('transformlab_generatedData');
        if (savedData) {
            const data = JSON.parse(savedData);
            AppState.data = {
                daily: data.daily,
                weekly: data.weekly,
                monthly: data.monthly,
                phases: data.phases,
                metadata: data.metadata,
                milestones: data.milestones || []
            };
        } else {
            // Regenerar datos
            regenerateData();
        }
        
        console.log(`✅ Datos cargados: ${AppState.data.daily.length} días, ${AppState.data.weekly.length} semanas`);
        console.log(`📅 Fecha de inicio: ${AppState.startDate.toLocaleDateString('es-ES')}`);
        console.log(`👤 Perfil: ${userProfile.profile.trainingStatus}, ${userProfile.initial.weight}kg → ${userProfile.target.weight}kg`);
        
        // Recalcular posición actual
        calculateCurrentPosition();
        
        // Inicializar aplicación
        initializeApp();
        
    } catch (error) {
        console.error('Error cargando datos:', error);
        showError('Error cargando datos. Por favor, reconfigura tu perfil.');
    } finally {
        showLoadingState(false);
    }
}

// Regenerar datos de transformación
function regenerateData() {
    if (!AppState.userProfile) return;
    
    console.log('🧮 Generando datos de transformación...');
    const data = DataGenerator.generateTransformationData(AppState.userProfile);
    const milestones = DataGenerator.generateMilestones(AppState.userProfile, data.phases);
    
    AppState.data = {
        daily: data.daily,
        weekly: data.weekly,
        monthly: data.monthly,
        phases: data.phases,
        metadata: data.metadata,
        milestones: milestones
    };
    
    // Guardar datos generados
    localStorage.setItem('transformlab_generatedData', JSON.stringify({
        ...data,
        milestones
    }));
    
    console.log('✅ Datos regenerados:', {
        days: data.daily.length,
        weeks: data.weekly.length,
        phases: data.phases.length,
        milestones: milestones.length
    });
}

// Calcular posición actual en el timeline
function calculateCurrentPosition() {
    if (!AppState.startDate || !AppState.data.daily) return;
    
    const today = new Date();
    const diffTime = today - AppState.startDate;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    // Limitar al rango de datos disponibles
    const maxDay = AppState.data.daily.length;
    const currentDay = Math.max(1, Math.min(diffDays + 1, maxDay));
    
    AppState.navigation.currentDay = currentDay;
    AppState.navigation.currentWeek = Math.ceil(currentDay / 7);
    AppState.navigation.currentMonth = Math.ceil(currentDay / 30);
    
    console.log(`📊 Posición actual: Día ${currentDay} de ${maxDay}`);
}

// Inicializar con datos generados (llamado desde onboarding)
function initializeWithGeneratedData(data, userProfile) {
    AppState.userProfile = userProfile;
    AppState.startDate = new Date(userProfile.startDate);
    AppState.data = {
        daily: data.daily,
        weekly: data.weekly,
        monthly: data.monthly,
        phases: data.phases,
        metadata: data.metadata,
        milestones: data.milestones || []
    };
    
    calculateCurrentPosition();
    initializeApp();
}

// Reiniciar perfil (para cambiar objetivos)
function resetProfile() {
    if (confirm('¿Estás seguro de que quieres reiniciar tu perfil? Se perderán todos los datos.')) {
        Onboarding.clearUserProfile();
        localStorage.removeItem('transformlab_generatedData');
        localStorage.removeItem('transformlab_prefs');
        window.location.reload();
    }
}

// Editar perfil (abrir onboarding con datos actuales)
function editProfile() {
    Onboarding.show();
}

// ============================================
// HELPERS DE FECHA
// ============================================
function getDateForDay(dayNumber) {
    if (!AppState.startDate) return null;
    const date = new Date(AppState.startDate);
    date.setDate(date.getDate() + dayNumber - 1);
    return date;
}

function formatDateForDay(dayNumber, format = 'short') {
    const date = getDateForDay(dayNumber);
    if (!date) return `Día ${dayNumber}`;
    
    if (format === 'short') {
        return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    } else if (format === 'full') {
        return date.toLocaleDateString('es-ES', { 
            weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' 
        });
    }
    return date.toLocaleDateString('es-ES');
}

// ============================================
// MODAL DE CONFIGURACIÓN
// ============================================
function showSettingsModal() {
    const { userProfile } = AppState;
    if (!userProfile) return;
    
    const overlay = document.createElement('div');
    overlay.id = 'settingsOverlay';
    overlay.className = 'start-date-overlay settings-mode';
    
    const startDateStr = AppState.startDate.toISOString().split('T')[0];
    const { initial, target, profile } = userProfile;
    
    overlay.innerHTML = `
        <div class="start-date-card settings-card">
            <div class="start-date-header">
                <div class="start-date-icon">⚙️</div>
                <h2>Configuración</h2>
                <p>Gestiona tu perfil y plan de transformación</p>
            </div>
            
            <div class="start-date-content">
                <div class="settings-section">
                    <h3>👤 Tu perfil</h3>
                    <div class="settings-info">
                        <span>${profile.age} años, ${profile.sex === 'male' ? 'Masculino' : 'Femenino'}, ${profile.height}cm</span>
                        <span>Nivel: ${profile.trainingStatus === 'beginner' ? 'Principiante' : profile.trainingStatus === 'intermediate' ? 'Intermedio' : 'Avanzado'}</span>
                    </div>
                </div>
                
                <div class="settings-section">
                    <h3>📊 Estado actual → Objetivo</h3>
                    <div class="settings-info">
                        <span>Peso: ${initial.weight}kg → ${target.weight}kg</span>
                        <span>Grasa: ${initial.fatPct}% → ${target.fatPct}%</span>
                        <span>Músculo: ${initial.muscleKg}kg → ${target.muscleKg}kg</span>
                    </div>
                </div>
                
                <div class="settings-section">
                    <h3>📅 Fecha de inicio</h3>
                    <div class="date-input-group">
                        <input type="date" id="newStartDateInput" value="${startDateStr}">
                    </div>
                </div>
                
                <div class="settings-actions">
                    <button class="settings-action-btn" onclick="editProfile()">
                        ✏️ Editar perfil completo
                    </button>
                    <button class="settings-action-btn danger" onclick="resetProfile()">
                        🗑️ Reiniciar todo
                    </button>
                </div>
            </div>
            
            <div class="start-date-footer settings-footer">
                <button class="cancel-btn" onclick="closeSettingsOverlay()">Cerrar</button>
                <button id="saveSettings" class="confirm-date-btn">
                    <span>Guardar cambios</span>
                </button>
            </div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));
    
    // Event listeners
    const dateInput = document.getElementById('newStartDateInput');
    const saveBtn = document.getElementById('saveSettings');
    
    saveBtn.addEventListener('click', () => {
        const newDate = new Date(dateInput.value);
        if (isNaN(newDate.getTime())) {
            alert('Por favor selecciona una fecha válida');
            return;
        }
        
        // Actualizar fecha en perfil
        AppState.userProfile.startDate = dateInput.value;
        AppState.startDate = newDate;
        
        // Guardar perfil actualizado
        Onboarding.saveUserProfile(AppState.userProfile);
        
        // Regenerar datos con nueva fecha
        regenerateData();
        calculateCurrentPosition();
        
        // Cerrar modal
        closeSettingsOverlay();
        
        // Re-renderizar todo
        renderHeader();
        renderNavigation();
        renderDashboard();
        renderMainChart();
        renderPhaseIndicator();
        renderGoalProgress();
    });
    
    // Cerrar al hacer clic en backdrop
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            closeSettingsOverlay();
        }
    });
}

function closeSettingsOverlay() {
    const overlay = document.getElementById('settingsOverlay');
    if (overlay) {
        overlay.classList.remove('visible');
        setTimeout(() => overlay.remove(), 400);
    }
}

function showLoadingState(loading) {
    const loader = document.getElementById('loadingOverlay');
    if (loader) {
        loader.style.display = loading ? 'flex' : 'none';
    }
}

function showError(message) {
    const container = document.getElementById('mainContent');
    if (container) {
        container.innerHTML = `
            <div class="error-state">
                <span class="error-icon">⚠️</span>
                <p>${message}</p>
                <button class="reset-btn" onclick="resetProfile()">Reiniciar configuración</button>
            </div>
        `;
    }
}

// ============================================
// INICIALIZACIÓN
// ============================================
function initializeApp() {
    // Cargar preferencias guardadas
    loadPreferences();
    
    // Renderizar componentes
    renderHeader();
    renderNavigation();
    renderDashboard();
    renderMainChart();
    renderPhaseIndicator();
    renderGoalProgress();
    renderInsights();
    
    // Configurar eventos
    setupEventListeners();
    
    // Efectos visuales
    setupVisualEffects();
    
    console.log('🚀 TransformLab inicializado');
}

function loadPreferences() {
    const saved = localStorage.getItem('transformlab_prefs');
    if (saved) {
        try {
            const prefs = JSON.parse(saved);
            AppState.navigation.granularity = prefs.granularity || 'weekly';
            AppState.ui.visibleMetrics = prefs.visibleMetrics || ['weight', 'muscleKg', 'fatPct'];
        } catch (e) {
            console.warn('Error cargando preferencias:', e);
        }
    }
    
    // Cargar fecha de inicio
    const savedStartDate = localStorage.getItem('transformlab_startDate');
    if (savedStartDate) {
        AppState.startDate = new Date(savedStartDate);
    }
}

function savePreferences() {
    const prefs = {
        granularity: AppState.navigation.granularity,
        visibleMetrics: AppState.ui.visibleMetrics
    };
    localStorage.setItem('transformlab_prefs', JSON.stringify(prefs));
}

function saveStartDate(date) {
    AppState.startDate = date;
    localStorage.setItem('transformlab_startDate', date.toISOString());
}

// ============================================
// HELPERS DE DATOS
// ============================================
function getCurrentData() {
    const { granularity, currentDay, currentWeek, currentMonth } = AppState.navigation;
    
    switch (granularity) {
        case 'daily':
            return AppState.data.daily[currentDay - 1];
        case 'weekly':
            return AppState.data.weekly[currentWeek - 1];
        case 'monthly':
            return AppState.data.monthly[currentMonth - 1];
        default:
            return AppState.data.weekly[currentWeek - 1];
    }
}

function getDataForRange(startIndex, endIndex, granularity = AppState.navigation.granularity) {
    const dataSource = granularity === 'daily' ? AppState.data.daily :
                       granularity === 'weekly' ? AppState.data.weekly :
                       AppState.data.monthly;
    return dataSource.slice(startIndex, endIndex);
}

function getDayData(dayNumber) {
    return AppState.data.daily[dayNumber - 1];
}

function getWeekData(weekNumber) {
    return AppState.data.weekly[weekNumber - 1];
}

function getMonthData(monthNumber) {
    return AppState.data.monthly[monthNumber - 1];
}

function getPhaseData(phaseName) {
    return AppState.data.phases.find(p => p.name === phaseName);
}

function getTotalDays() {
    return AppState.data.daily.length;
}

function getTotalWeeks() {
    return AppState.data.weekly.length;
}

function getTotalMonths() {
    return AppState.data.monthly.length;
}

function getProgressPercent() {
    const { granularity, currentDay, currentWeek, currentMonth } = AppState.navigation;
    switch (granularity) {
        case 'daily':
            return (currentDay / getTotalDays()) * 100;
        case 'weekly':
            return (currentWeek / getTotalWeeks()) * 100;
        case 'monthly':
            return (currentMonth / getTotalMonths()) * 100;
        default:
            return (currentWeek / getTotalWeeks()) * 100;
    }
}

// ============================================
// FORMATEO
// ============================================
function formatDate(dateStr, style = 'short') {
    if (!dateStr) return '--';
    const date = new Date(dateStr);
    const options = style === 'short' 
        ? { day: 'numeric', month: 'short' }
        : { day: 'numeric', month: 'long', year: 'numeric' };
    return date.toLocaleDateString('es-ES', options);
}

function formatNumber(num, decimals = 1) {
    if (num === null || num === undefined) return '--';
    return Number(num).toFixed(decimals);
}

function formatChange(value, decimals = 2) {
    if (value === null || value === undefined) return '--';
    const num = Number(value);
    const sign = num > 0 ? '+' : '';
    return `${sign}${num.toFixed(decimals)}`;
}

function formatPercent(value, decimals = 1) {
    if (value === null || value === undefined) return '--';
    return `${Number(value).toFixed(decimals)}%`;
}

function getChangeClass(value, invertColors = false) {
    if (value > 0) return invertColors ? 'negative' : 'positive';
    if (value < 0) return invertColors ? 'positive' : 'negative';
    return 'neutral';
}

function getChangeIcon(value) {
    if (value > 0.01) return '↑';
    if (value < -0.01) return '↓';
    return '→';
}

// ============================================
// NAVEGACIÓN
// ============================================
function setGranularity(granularity) {
    AppState.navigation.granularity = granularity;
    
    // Actualizar botones
    document.querySelectorAll('.granularity-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.granularity === granularity);
    });
    
    // Re-renderizar
    renderDashboard();
    renderMainChart();
    renderNavigation();
    savePreferences();
}

function navigateTo(index) {
    const { granularity } = AppState.navigation;
    
    switch (granularity) {
        case 'daily':
            AppState.navigation.currentDay = Math.max(1, Math.min(index, getTotalDays()));
            // Sincronizar semana y mes
            const dayData = getDayData(AppState.navigation.currentDay);
            AppState.navigation.currentWeek = dayData.week;
            break;
        case 'weekly':
            AppState.navigation.currentWeek = Math.max(1, Math.min(index, getTotalWeeks()));
            break;
        case 'monthly':
            AppState.navigation.currentMonth = Math.max(1, Math.min(index, getTotalMonths()));
            break;
    }
    
    renderDashboard();
    renderNavigation();
    updateChartHighlight();
}

function navigateRelative(delta) {
    const { granularity, currentDay, currentWeek, currentMonth } = AppState.navigation;
    
    switch (granularity) {
        case 'daily':
            navigateTo(currentDay + delta);
            break;
        case 'weekly':
            navigateTo(currentWeek + delta);
            break;
        case 'monthly':
            navigateTo(currentMonth + delta);
            break;
    }
}

function navigateToToday() {
    // Simular día actual (mitad del proceso para demo)
    const midPoint = Math.floor(getTotalDays() / 2);
    AppState.navigation.currentDay = midPoint;
    AppState.navigation.currentWeek = getDayData(midPoint).week;
    
    setGranularity('daily');
    navigateTo(midPoint);
}

// ============================================
// EVENTOS
// ============================================
function setupEventListeners() {
    // Granularidad
    document.querySelectorAll('.granularity-btn').forEach(btn => {
        btn.addEventListener('click', () => setGranularity(btn.dataset.granularity));
    });
    
    // Navegación
    document.getElementById('navPrev')?.addEventListener('click', () => navigateRelative(-1));
    document.getElementById('navNext')?.addEventListener('click', () => navigateRelative(1));
    document.getElementById('navToday')?.addEventListener('click', navigateToToday);
    
    // Métricas toggle
    document.querySelectorAll('.metric-toggle').forEach(toggle => {
        toggle.addEventListener('click', () => toggleMetric(toggle.dataset.metric));
    });
    
    // Atajos de teclado
    document.addEventListener('keydown', handleKeyboard);
    
    // Timeline click
    document.getElementById('timelineBar')?.addEventListener('click', handleTimelineClick);
}

function handleKeyboard(e) {
    if (e.target.tagName === 'INPUT') return;
    
    switch (e.key) {
        case 'ArrowLeft':
            navigateRelative(-1);
            break;
        case 'ArrowRight':
            navigateRelative(1);
            break;
        case 'Home':
            navigateTo(1);
            break;
        case 'End':
            navigateTo(getTotalDays());
            break;
        case '1':
            setGranularity('daily');
            break;
        case '2':
            setGranularity('weekly');
            break;
        case '3':
            setGranularity('monthly');
            break;
    }
}

function handleTimelineClick(e) {
    const timeline = e.currentTarget;
    const rect = timeline.getBoundingClientRect();
    const percent = (e.clientX - rect.left) / rect.width;
    
    const { granularity } = AppState.navigation;
    let targetIndex;
    
    switch (granularity) {
        case 'daily':
            targetIndex = Math.round(percent * getTotalDays());
            break;
        case 'weekly':
            targetIndex = Math.round(percent * getTotalWeeks());
            break;
        case 'monthly':
            targetIndex = Math.round(percent * getTotalMonths());
            break;
    }
    
    navigateTo(Math.max(1, targetIndex));
}

function toggleMetric(metric) {
    const idx = AppState.ui.visibleMetrics.indexOf(metric);
    if (idx > -1) {
        if (AppState.ui.visibleMetrics.length > 1) {
            AppState.ui.visibleMetrics.splice(idx, 1);
        }
    } else {
        AppState.ui.visibleMetrics.push(metric);
    }
    
    document.querySelectorAll('.metric-toggle').forEach(toggle => {
        toggle.classList.toggle('active', AppState.ui.visibleMetrics.includes(toggle.dataset.metric));
    });
    
    renderMainChart();
    savePreferences();
}

// ============================================
// EFECTOS VISUALES
// ============================================
function setupVisualEffects() {
    // Cursor glow
    const glow = document.getElementById('cursorGlow');
    if (glow) {
        let mx = 0, my = 0, gx = 0, gy = 0;
        document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
        (function loop() {
            gx += (mx - gx) * 0.04;
            gy += (my - gy) * 0.04;
            glow.style.left = gx + 'px';
            glow.style.top = gy + 'px';
            requestAnimationFrame(loop);
        })();
    }
}

// ============================================
// INICIAR APLICACIÓN
// ============================================
document.addEventListener('DOMContentLoaded', loadAllData);

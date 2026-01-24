// ============================================
// TRANSFORMLAB - Dashboard Module v3.0
// Renderizado de métricas personalizadas
// ============================================

// ============================================
// HEADER
// ============================================
function renderHeader() {
    const { metadata } = AppState.data;
    const current = getCurrentData();
    if (!current) return;
    
    const { granularity, currentDay, currentWeek, currentMonth } = AppState.navigation;
    
    let periodLabel, dateLabel;
    
    switch (granularity) {
        case 'daily':
            const dayData = getDayData(currentDay);
            periodLabel = `Día ${currentDay} de ${getTotalDays()}`;
            dateLabel = dayData ? `${dayData.dateFormatted} · ${dayData.dayOfWeek}` : '';
            break;
        case 'weekly':
            const weekData = getWeekData(currentWeek);
            periodLabel = `Semana ${currentWeek} de ${getTotalWeeks()}`;
            dateLabel = weekData ? `${weekData.startDateFormatted} - ${weekData.endDateFormatted}` : '';
            break;
        case 'monthly':
            const monthData = getMonthData(currentMonth);
            periodLabel = `Mes ${currentMonth} de ${getTotalMonths()}`;
            dateLabel = monthData?.monthName || '';
            break;
    }
    
    const headerEl = document.getElementById('headerInfo');
    if (headerEl) {
        const startDateFormatted = AppState.startDate ? 
            AppState.startDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' }) : 
            'No configurada';
        
        // Get user profile info
        const profile = AppState.userProfile;
        const targetInfo = profile ? 
            `${profile.initial.weight}kg → ${profile.target.weight}kg` : '';
        
        headerEl.innerHTML = `
            <div class="header-period">
                <span class="period-label">${periodLabel}</span>
                <span class="period-date">${dateLabel}</span>
            </div>
            <div class="header-phase">
                <span class="phase-badge" style="--phase-color: ${PHASE_COLORS[current.phaseType] || '#666'}">
                    ${current.phase}
                </span>
            </div>
            <div class="header-goal">
                <span class="goal-label">🎯 ${targetInfo}</span>
            </div>
            <div class="header-actions">
                <button class="header-export-btn" onclick="exportProjectData()" title="Exportar datos">
                    <span>📄</span>
                </button>
                <button class="header-settings-btn" onclick="showSettingsModal()" title="Configuración">
                    <span class="settings-icon">⚙️</span>
                    <span class="start-date-label">Inicio: ${startDateFormatted}</span>
                </button>
            </div>
        `;
    }
}

// ============================================
// EXPORT DATA TO MARKDOWN
// ============================================
function exportProjectData() {
    const { userProfile, data, startDate } = AppState;
    if (!userProfile || !data) {
        alert('No hay datos para exportar');
        return;
    }
    
    const metadata = data.metadata || {};
    const phases = data.phases || [];
    const milestones = data.milestones || [];
    
    // Format date
    const formatDate = (date) => {
        if (!date) return 'N/A';
        const d = new Date(date);
        return d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    };
    
    // Build markdown content
    let md = `# TransformLab - Informe de Transformación\n\n`;
    md += `**Generado:** ${formatDate(new Date())}\n\n`;
    md += `---\n\n`;
    
    // User Profile
    md += `## 👤 Perfil del Usuario\n\n`;
    md += `| Campo | Valor |\n`;
    md += `|-------|-------|\n`;
    md += `| Edad | ${metadata.userProfile?.age || userProfile.profile?.age || '-'} años |\n`;
    md += `| Sexo | ${metadata.userProfile?.sex === 'male' ? 'Masculino' : 'Femenino'} |\n`;
    md += `| Altura | ${metadata.userProfile?.height || userProfile.profile?.height || '-'} cm |\n`;
    md += `| Nivel de actividad | ${metadata.userProfile?.activityLevel || 'moderate'} |\n`;
    md += `| Experiencia | ${userProfile.profile?.trainingStatus || 'intermediate'} |\n\n`;
    
    // Initial Composition
    md += `## 📊 Composición Inicial\n\n`;
    md += `| Métrica | Valor |\n`;
    md += `|---------|-------|\n`;
    md += `| Peso | ${userProfile.initial?.weight || '-'} kg |\n`;
    md += `| % Grasa | ${userProfile.initial?.fatPct || '-'}% |\n`;
    md += `| Masa grasa | ${metadata.initialComposition?.fatKg || '-'} kg |\n`;
    md += `| Masa muscular | ${userProfile.initial?.muscleKg || '-'} kg |\n`;
    md += `| Masa magra | ${metadata.initialComposition?.leanMassKg || '-'} kg |\n\n`;
    
    // Target Composition
    md += `## 🎯 Composición Objetivo\n\n`;
    md += `| Métrica | Valor |\n`;
    md += `|---------|-------|\n`;
    md += `| Peso | ${userProfile.target?.weight || '-'} kg |\n`;
    md += `| % Grasa | ${userProfile.target?.fatPct || '-'}% |\n`;
    md += `| Masa grasa | ${metadata.targetComposition?.fatKg || '-'} kg |\n`;
    md += `| Masa muscular | ${userProfile.target?.muscleKg || '-'} kg |\n`;
    md += `| Masa magra | ${metadata.targetComposition?.leanMassKg || '-'} kg |\n\n`;
    
    // Changes
    const weightChange = (userProfile.target?.weight || 0) - (userProfile.initial?.weight || 0);
    const fatChange = (userProfile.target?.fatPct || 0) - (userProfile.initial?.fatPct || 0);
    const muscleChange = (userProfile.target?.muscleKg || 0) - (userProfile.initial?.muscleKg || 0);
    
    md += `## 📈 Cambios Esperados\n\n`;
    md += `| Métrica | Cambio |\n`;
    md += `|---------|--------|\n`;
    md += `| Peso | ${weightChange >= 0 ? '+' : ''}${weightChange.toFixed(1)} kg |\n`;
    md += `| % Grasa | ${fatChange >= 0 ? '+' : ''}${fatChange.toFixed(1)}% |\n`;
    md += `| Masa muscular | ${muscleChange >= 0 ? '+' : ''}${muscleChange.toFixed(1)} kg |\n\n`;
    
    // Metabolic Data
    if (metadata.metabolicData) {
        md += `## 🔥 Datos Metabólicos\n\n`;
        md += `| Métrica | Inicial | Objetivo |\n`;
        md += `|---------|---------|----------|\n`;
        md += `| TMB | ${metadata.metabolicData.initialBMR} kcal | ${metadata.metabolicData.targetBMR} kcal |\n`;
        md += `| TDEE | ${metadata.metabolicData.initialTDEE} kcal | ${metadata.metabolicData.targetTDEE} kcal |\n\n`;
        md += `**Potencial de ganancia muscular:** ${metadata.metabolicData.muscleGainPotential?.avgKg || '-'} kg/mes\n\n`;
    }
    
    // Timeline
    md += `## 📅 Línea Temporal\n\n`;
    md += `| Campo | Valor |\n`;
    md += `|-------|-------|\n`;
    md += `| Fecha inicio | ${formatDate(startDate || userProfile.startDate)} |\n`;
    md += `| Fecha fin | ${formatDate(metadata.timeline?.endDate)} |\n`;
    md += `| Duración total | ${metadata.timeline?.totalDays || '-'} días |\n`;
    md += `| Semanas | ${metadata.timeline?.totalWeeks || '-'} |\n`;
    md += `| Meses | ${metadata.timeline?.totalMonths || '-'} |\n\n`;
    
    // Phases
    md += `## 🔄 Fases del Proceso\n\n`;
    md += `| # | Fase | Tipo | Días | Fecha inicio | Fecha fin |\n`;
    md += `|---|------|------|------|--------------|----------|\n`;
    phases.forEach((phase, i) => {
        md += `| ${i + 1} | ${phase.name} | ${phase.type} | ${phase.days || phase.totalDays || '-'} | ${formatDate(phase.startDate)} | ${formatDate(phase.endDate)} |\n`;
    });
    md += `\n`;
    
    // Phase Details
    md += `### Detalles por Fase\n\n`;
    phases.forEach((phase, i) => {
        md += `#### ${i + 1}. ${phase.name}\n\n`;
        md += `- **Tipo:** ${phase.type}\n`;
        md += `- **Duración:** ${phase.days || phase.totalDays || '-'} días\n`;
        if (phase.description) md += `- **Descripción:** ${phase.description}\n`;
        if (phase.endWeight) md += `- **Peso al final:** ${phase.endWeight.toFixed(1)} kg\n`;
        if (phase.endFatPct) md += `- **% Grasa al final:** ${phase.endFatPct.toFixed(1)}%\n`;
        if (phase.endMuscleKg) md += `- **Músculo al final:** ${phase.endMuscleKg.toFixed(1)} kg\n`;
        md += `\n`;
    });
    
    // Milestones
    if (milestones.length > 0) {
        md += `## 🏆 Hitos del Proceso\n\n`;
        md += `| # | Hito | Categoría | Día Est. | Visibilidad |\n`;
        md += `|---|------|-----------|----------|-------------|\n`;
        milestones.forEach((m, i) => {
            md += `| ${i + 1} | ${m.name} | ${m.category} | ${m.estimatedDay || '-'} | ${m.visibility || '-'} |\n`;
        });
        md += `\n`;
    }
    
    // Methodology
    md += `## 📚 Metodología\n\n`;
    if (metadata.methodology) {
        metadata.methodology.forEach(m => {
            md += `- ${m}\n`;
        });
    } else {
        md += `- Mifflin-St Jeor para cálculo de metabolismo basal\n`;
        md += `- Modelo Aragon 2017 para pérdida de grasa\n`;
        md += `- Modelo McDonald 2008 / Helms 2014 para ganancia muscular\n`;
        md += `- Periodización por fases adaptativa\n`;
    }
    md += `\n`;
    
    // Footer
    md += `---\n\n`;
    md += `*Generado por TransformLab v${metadata.version || '3.2'}*\n`;
    
    // Create and download file
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TransformLab_Informe_${new Date().toISOString().split('T')[0]}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('✅ Informe exportado correctamente');
}

// ============================================
// NAVEGACIÓN Y TIMELINE
// ============================================
function renderNavigation() {
    const { granularity, currentDay, currentWeek, currentMonth } = AppState.navigation;
    const progress = getProgressPercent();
    
    // Actualizar barra de progreso
    const progressBar = document.getElementById('timelineProgress');
    if (progressBar) {
        progressBar.style.width = `${progress}%`;
    }
    
    // Actualizar indicador de posición
    const positionIndicator = document.getElementById('timelinePosition');
    if (positionIndicator) {
        positionIndicator.style.left = `${progress}%`;
    }
    
    // Actualizar texto de navegación
    const navLabel = document.getElementById('navLabel');
    if (navLabel) {
        let label;
        switch (granularity) {
            case 'daily':
                const dayData = getDayData(currentDay);
                label = `${dayData.dateFormatted} · ${dayData.phase}`;
                break;
            case 'weekly':
                const weekData = getWeekData(currentWeek);
                label = `Semana ${currentWeek} · ${weekData.phase}`;
                break;
            case 'monthly':
                const monthData = getMonthData(currentMonth);
                label = `${monthData.monthName}`;
                break;
        }
        navLabel.textContent = label;
    }
    
    // Actualizar estado de botones prev/next
    const prevBtn = document.getElementById('navPrev');
    const nextBtn = document.getElementById('navNext');
    
    if (prevBtn && nextBtn) {
        switch (granularity) {
            case 'daily':
                prevBtn.disabled = currentDay <= 1;
                nextBtn.disabled = currentDay >= getTotalDays();
                break;
            case 'weekly':
                prevBtn.disabled = currentWeek <= 1;
                nextBtn.disabled = currentWeek >= getTotalWeeks();
                break;
            case 'monthly':
                prevBtn.disabled = currentMonth <= 1;
                nextBtn.disabled = currentMonth >= getTotalMonths();
                break;
        }
    }
    
    // Renderizar marcadores de fase en timeline
    renderPhaseMarkers();
}

function renderPhaseMarkers() {
    const container = document.getElementById('phaseMarkers');
    if (!container) return;
    
    const phases = AppState.data.phases;
    const totalDays = getTotalDays();
    
    let html = '';
    let accumulatedDays = 0;
    
    phases.forEach(phase => {
        const phaseDays = phase.days || phase.totalDays || 30;
        const startPct = (accumulatedDays / totalDays) * 100;
        const widthPct = (phaseDays / totalDays) * 100;
        
        // Usar color de fase
        const phaseColor = PHASE_COLORS[phase.type] || '#666';
        
        html += `
            <div class="phase-marker" 
                 style="left: ${startPct}%; width: ${widthPct}%; background: ${phaseColor}"
                 title="${phase.name}: ${phaseDays} días">
            </div>
        `;
        
        accumulatedDays += phaseDays;
    });
    
    container.innerHTML = html;
}

// ============================================
// DASHBOARD - TARJETAS DE MÉTRICAS
// ============================================
function renderDashboard() {
    renderHeader();
    renderMetricCards();
    renderPhaseIndicator();
    renderGoalProgress();
}

function renderMetricCards() {
    const current = getCurrentData();
    if (!current) return;
    
    const { granularity } = AppState.navigation;
    
    // Obtener datos según granularidad (estructura del DataGenerator)
    let physical, performance, wellbeing, changes;
    
    if (granularity === 'daily') {
        physical = current.physical;
        performance = current.performance;
        wellbeing = current.wellbeing;
        changes = current.dailyChange || {};
    } else if (granularity === 'weekly') {
        physical = current.endOfWeek?.physical || current.weeklyAverages?.physical;
        performance = current.endOfWeek?.performance;
        wellbeing = current.endOfWeek?.wellbeing;
        changes = current.weeklyChange || {};
    } else {
        physical = current.endOfMonth?.physical || current.monthlyAverages?.physical;
        performance = current.endOfMonth?.performance;
        wellbeing = current.endOfMonth?.wellbeing;
        changes = current.monthlyChange || {};
    }
    
    if (!physical) return;
    
    // Tarjeta Físico
    const physicalCard = document.getElementById('physicalCard');
    if (physicalCard && physical) {
        physicalCard.innerHTML = `
            <div class="card-header">
                <span class="card-icon">📊</span>
                <span class="card-title">Físico</span>
            </div>
            <div class="metric-grid">
                <div class="metric-item">
                    <span class="metric-label">Peso</span>
                    <span class="metric-value" style="color: ${METRIC_COLORS.weight}">${formatNumber(physical.weight)} kg</span>
                    <span class="metric-change ${getChangeClass(changes.weight, true)}">${getChangeIcon(changes.weight)} ${formatChange(changes.weight)} kg</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Músculo</span>
                    <span class="metric-value" style="color: ${METRIC_COLORS.muscleKg}">${formatNumber(physical.muscleKg)} kg</span>
                    <span class="metric-change ${getChangeClass(changes.muscleKg)}">${getChangeIcon(changes.muscleKg)} ${formatChange(changes.muscleKg)} kg</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">% Grasa</span>
                    <span class="metric-value" style="color: ${METRIC_COLORS.fatPct}">${formatNumber(physical.fatPct)}%</span>
                    <span class="metric-change ${getChangeClass(changes.fatPct, true)}">${getChangeIcon(changes.fatPct)} ${formatChange(changes.fatPct)}%</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">Grasa</span>
                    <span class="metric-value" style="color: ${METRIC_COLORS.fatKg}">${formatNumber(physical.fatKg)} kg</span>
                    <span class="metric-change ${getChangeClass(changes.fatKg, true)}">${getChangeIcon(changes.fatKg)} kg</span>
                </div>
            </div>
        `;
    }
    
    // Tarjeta Rendimiento
    const performanceCard = document.getElementById('performanceCard');
    if (performanceCard && performance) {
        performanceCard.innerHTML = `
            <div class="card-header">
                <span class="card-icon">💪</span>
                <span class="card-title">Rendimiento</span>
            </div>
            <div class="metric-grid">
                <div class="metric-item wide">
                    <span class="metric-label">Fuerza</span>
                    <div class="metric-bar-container">
                        <div class="metric-bar" style="width: ${performance.strength || 0}%; background: ${METRIC_COLORS.strength}"></div>
                    </div>
                    <span class="metric-value">${formatNumber(performance.strength || 0, 0)}/100</span>
                </div>
                <div class="metric-item wide">
                    <span class="metric-label">Agilidad</span>
                    <div class="metric-bar-container">
                        <div class="metric-bar" style="width: ${(performance.agility || 0) * 10}%; background: ${METRIC_COLORS.agility}"></div>
                    </div>
                    <span class="metric-value">${formatNumber(performance.agility || 0)}/10</span>
                </div>
            </div>
        `;
    }
    
    // Tarjeta Bienestar
    const wellbeingCard = document.getElementById('wellbeingCard');
    if (wellbeingCard && wellbeing) {
        wellbeingCard.innerHTML = `
            <div class="card-header">
                <span class="card-icon">🧠</span>
                <span class="card-title">Bienestar</span>
            </div>
            <div class="metric-grid small">
                <div class="metric-item mini">
                    <span class="metric-label">Energía</span>
                    <span class="metric-value" style="color: ${METRIC_COLORS.energy}">${formatNumber(wellbeing.energy || 0)}</span>
                </div>
                <div class="metric-item mini">
                    <span class="metric-label">Estética</span>
                    <span class="metric-value" style="color: ${METRIC_COLORS.aesthetics}">${formatNumber(wellbeing.aesthetics || 0)}</span>
                </div>
                <div class="metric-item mini">
                    <span class="metric-label">Autoestima</span>
                    <span class="metric-value" style="color: ${METRIC_COLORS.selfEsteem}">${formatNumber(wellbeing.selfEsteem || 0)}</span>
                </div>
                <div class="metric-item mini">
                    <span class="metric-label">Ánimo</span>
                    <span class="metric-value" style="color: ${METRIC_COLORS.generalFeeling}">${formatNumber(wellbeing.generalFeeling || 0)}</span>
                </div>
            </div>
        `;
    }
    
    // Tarjeta Metabólica (BMR/TDEE)
    const metabolicCard = document.getElementById('metabolicCard');
    const metabolicData = AppState.data.metadata?.metabolicData;
    const userProfile = AppState.data.metadata?.userProfile;
    
    if (metabolicCard && metabolicData) {
        const activityLabels = {
            sedentary: 'Sedentario',
            light: 'Ligero',
            moderate: 'Moderado',
            active: 'Activo',
            veryActive: 'Muy activo'
        };
        
        metabolicCard.innerHTML = `
            <div class="card-header">
                <span class="card-icon">🔥</span>
                <span class="card-title">Metabolismo</span>
            </div>
            <div class="metric-grid small">
                <div class="metric-item">
                    <span class="metric-label">TMB Actual</span>
                    <span class="metric-value" style="color: #f6ad55">${metabolicData.initialBMR} kcal</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">TDEE Actual</span>
                    <span class="metric-value" style="color: #48bb78">${metabolicData.initialTDEE} kcal</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">TMB Objetivo</span>
                    <span class="metric-value" style="color: #a0aec0">${metabolicData.targetBMR} kcal</span>
                </div>
                <div class="metric-item">
                    <span class="metric-label">TDEE Objetivo</span>
                    <span class="metric-value" style="color: #a0aec0">${metabolicData.targetTDEE} kcal</span>
                </div>
            </div>
            <div class="metabolic-info">
                <span class="info-badge">${userProfile?.age || '-'} años</span>
                <span class="info-badge">${userProfile?.height || '-'} cm</span>
                <span class="info-badge">${activityLabels[userProfile?.activityLevel] || 'Moderado'}</span>
                <span class="info-badge">+${metabolicData.muscleGainPotential?.avgKg || 0} kg/mes</span>
            </div>
        `;
    }
}

// ============================================
// INDICADOR DE FASE
// ============================================
function renderPhaseIndicator() {
    const container = document.getElementById('phaseIndicator');
    if (!container) return;
    
    const current = getCurrentData();
    if (!current) return;
    
    const phase = AppState.data.phases?.find(p => p.name === current.phase);
    if (!phase) return;
    
    // Calcular progreso dentro de la fase
    const { currentDay } = AppState.navigation;
    const daysInPhase = phase.days || 30;
    const totalWeeksInPhase = phase.totalWeeks || Math.ceil(daysInPhase / 7);
    
    // Calcular día actual en la fase
    let currentDayInPhase = 1;
    if (current.dayInPhase) {
        currentDayInPhase = current.dayInPhase;
    } else if (phase.startDay && currentDay) {
        currentDayInPhase = Math.max(1, currentDay - phase.startDay + 1);
    }
    
    const phaseProgress = Math.min(100, (currentDayInPhase / daysInPhase) * 100);
    const weeksInPhase = Math.ceil(currentDayInPhase / 7);
    const phaseColor = PHASE_COLORS[phase.type] || '#666';
    
    container.innerHTML = `
        <div class="phase-indicator-header">
            <div class="phase-icon" style="background: ${phaseColor}">
                ${getPhaseIcon(phase.type)}
            </div>
            <div class="phase-info">
                <h3 class="phase-name">${phase.name}</h3>
                <span class="phase-timing">Semana ${weeksInPhase} de ${totalWeeksInPhase}</span>
            </div>
        </div>
        
        <div class="phase-progress-bar">
            <div class="phase-progress-fill" style="width: ${phaseProgress}%; background: ${phaseColor}"></div>
            <span class="phase-progress-text">${Math.round(phaseProgress)}%</span>
        </div>
        
        <p class="phase-description">${phase.description || ''}</p>
        
        <div class="phase-dates">
            <span>📅 ${formatDate(phase.startDate)} → ${formatDate(phase.endDate)}</span>
        </div>
        
        <div class="phase-changes">
            <div class="phase-change ${getChangeClass(phase.totalChange?.muscleKg)}">
                <span class="change-label">Músculo esperado</span>
                <span class="change-value">${formatChange(phase.totalChange?.muscleKg || phase.expectedMuscleGain)} kg</span>
            </div>
            <div class="phase-change ${getChangeClass(phase.totalChange?.fatKg || -phase.expectedFatLoss, true)}">
                <span class="change-label">Grasa esperada</span>
                <span class="change-value">${formatChange(phase.totalChange?.fatKg || -phase.expectedFatLoss)} kg</span>
            </div>
        </div>
    `;
}

function getPhaseIcon(phaseType) {
    const icons = {
        adaptation: '🎯',
        recomposition: '🔄',
        cut: '🔥',
        bulk: '💪',
        maintenance: '✅',
        transition: '🔀'
    };
    return icons[phaseType] || '📊';
}

// ============================================
// PROGRESO HACIA OBJETIVO
// ============================================
function renderGoalProgress() {
    const container = document.getElementById('goalProgress');
    if (!container) return;
    
    const { metadata } = AppState.data;
    const current = getCurrentData();
    const { granularity } = AppState.navigation;
    
    if (!current || !metadata) return;
    
    const initial = metadata.initialComposition;
    const target = metadata.targetComposition;
    
    // Obtener datos según granularidad
    let physical, performance, wellbeing;
    if (granularity === 'daily') {
        physical = current.physical;
        performance = current.performance;
        wellbeing = current.wellbeing;
    } else if (granularity === 'weekly') {
        physical = current.endOfWeek?.physical || current.weeklyAverages?.physical;
        performance = current.endOfWeek?.performance;
        wellbeing = current.endOfWeek?.wellbeing;
    } else {
        physical = current.endOfMonth?.physical || current.monthlyAverages?.physical;
        performance = current.endOfMonth?.performance;
        wellbeing = current.endOfMonth?.wellbeing;
    }
    
    if (!physical) return;
    
    const goals = [
        {
            name: 'Músculo',
            icon: '💪',
            current: physical.muscleKg,
            initial: initial.muscleKg,
            target: target.muscleKg,
            unit: 'kg',
            color: METRIC_COLORS.muscleKg
        },
        {
            name: 'Grasa',
            icon: '🔥',
            current: physical.fatPct,
            initial: initial.fatPct,
            target: target.fatPct,
            unit: '%',
            color: METRIC_COLORS.fatPct,
            inverted: true
        },
        {
            name: 'Fuerza',
            icon: '⚡',
            current: performance?.strength || 0,
            initial: initial.strength || 20,
            target: target.strength || 80,
            unit: '',
            color: METRIC_COLORS.strength
        },
        {
            name: 'Estética',
            icon: '✨',
            current: wellbeing?.aesthetics || 0,
            initial: initial.aesthetics || 3,
            target: target.aesthetics || 8,
            unit: '',
            color: METRIC_COLORS.aesthetics
        }
    ];
    
    const goalsHTML = goals.map(goal => {
        let progress;
        if (goal.inverted) {
            // Para grasa: inicial alto, objetivo bajo
            progress = ((goal.initial - goal.current) / (goal.initial - goal.target)) * 100;
        } else {
            progress = ((goal.current - goal.initial) / (goal.target - goal.initial)) * 100;
        }
        progress = Math.max(0, Math.min(100, progress));
        
        const isComplete = progress >= 100;
        
        return `
            <div class="goal-item ${isComplete ? 'complete' : ''}">
                <div class="goal-header">
                    <span class="goal-icon">${goal.icon}</span>
                    <span class="goal-name">${goal.name}</span>
                    ${isComplete ? '<span class="goal-check">✓</span>' : ''}
                </div>
                <div class="goal-bar">
                    <div class="goal-fill" style="width: ${progress}%; background: ${goal.color}"></div>
                </div>
                <div class="goal-values">
                    <span class="goal-current">${formatNumber(goal.current)}${goal.unit}</span>
                    <span class="goal-target">/ ${formatNumber(goal.target)}${goal.unit}</span>
                    <span class="goal-percent">${Math.round(progress)}%</span>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = `
        <div class="goals-header">
            <h3>🎯 Progreso hacia Objetivos</h3>
        </div>
        <div class="goals-grid">
            ${goalsHTML}
        </div>
    `;
}

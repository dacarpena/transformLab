// ============================================
// TRANSFORMLAB - Charts Module v3.0
// Gráficos con Chart.js
// ============================================

// ============================================
// GRÁFICO PRINCIPAL
// ============================================
function renderMainChart() {
    const canvas = document.getElementById('mainChart');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    
    // Destruir gráfico anterior si existe
    if (AppState.charts.main) {
        AppState.charts.main.destroy();
    }
    
    const { granularity } = AppState.navigation;
    const { visibleMetrics } = AppState.ui;
    
    // Obtener datos según granularidad
    let sourceData, labels;
    
    switch (granularity) {
        case 'daily':
            sourceData = AppState.data.daily;
            labels = sourceData.map(d => d.dateFormatted);
            break;
        case 'weekly':
            sourceData = AppState.data.weekly;
            labels = sourceData.map(d => `S${d.week}`);
            break;
        case 'monthly':
            sourceData = AppState.data.monthly;
            labels = sourceData.map(d => d.monthName.split(' ')[0].substring(0, 3));
            break;
    }
    
    if (!sourceData || sourceData.length === 0) {
        console.warn('No hay datos para renderizar el gráfico');
        return;
    }
    
    // Crear datasets para métricas visibles
    const datasets = visibleMetrics.map((metric, idx) => {
        const data = getMetricData(sourceData, metric, granularity);
        const color = METRIC_COLORS[metric] || '#ffffff';

        // Mark refeed days as hollow points on the weight line
        const pointStyles = granularity === 'daily' && metric === 'weight'
            ? (AppState.data.daily || []).map(d => d.isRefeedDay ? 'circle' : false)
            : undefined;
        const pointRadii = granularity === 'daily' && metric === 'weight'
            ? (AppState.data.daily || []).map(d => d.isRefeedDay ? 5 : 0)
            : undefined;

        return {
            label: getMetricLabel(metric),
            data: data,
            borderColor: color,
            backgroundColor: idx === 0 ? color + '20' : 'transparent',
            fill: idx === 0,
            tension: 0.3,
            borderWidth: granularity === 'daily' ? 1.5 : 2.5,
            pointRadius: pointRadii || (granularity === 'daily' ? 0 : (granularity === 'weekly' ? 4 : 6)),
            pointHoverRadius: 8,
            pointBackgroundColor: 'transparent',
            pointBorderColor: color,
            pointStyle: pointStyles || 'circle',
            yAxisID: getAxisForMetric(metric)
        };
    });

    // Overlay real check-in weight data (weekly/monthly views only)
    const checkins = AppState.realCheckins || [];
    if (checkins.length > 0 && granularity !== 'daily') {
        const nullArray = new Array(sourceData.length).fill(null);
        const realWeightData = [...nullArray];

        checkins.forEach(c => {
            const idx = granularity === 'weekly' ? c.week - 1 : Math.floor((c.week - 1) / 4);
            if (idx >= 0 && idx < realWeightData.length) {
                realWeightData[idx] = c.measurements.weight;
            }
        });

        datasets.push({
            label: 'Peso Real',
            type: 'scatter',
            data: realWeightData,
            borderColor: '#fbbf24',
            backgroundColor: '#fbbf24',
            pointRadius: 8,
            pointHoverRadius: 10,
            pointStyle: 'star',
            showLine: false,
            yAxisID: 'y'
        });
    }
    
    // Determinar si necesitamos eje secundario
    const needsSecondAxis = visibleMetrics.some(m => ['fatPct', 'strength', 'aesthetics', 'selfEsteem', 'sleepQuality', 'agility'].includes(m)) &&
                           visibleMetrics.some(m => ['weight', 'muscleKg', 'fatKg', 'leanMassKg'].includes(m));
    
    // Añadir áreas de fases como plugin
    const phaseBackgrounds = createPhaseBackgrounds(sourceData, granularity);
    const milestoneMarkers = createMilestoneMarkers(sourceData, granularity);
    
    AppState.charts.main = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: AppState.config.animationDuration },
            interaction: { intersect: false, mode: 'index' },
            
            onClick: (event, elements, chart) => {
                handleChartClick(event, chart, granularity);
            },
            
            onHover: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    updateHoverPanel(index, granularity);
                }
            },
            
            plugins: {
                legend: {
                    display: visibleMetrics.length > 1,
                    position: 'top',
                    labels: { 
                        color: '#a0a0b0', 
                        font: { size: 11, family: 'Outfit' }, 
                        usePointStyle: true, 
                        padding: 20 
                    }
                },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(10, 10, 15, 0.95)',
                    titleColor: '#fff',
                    bodyColor: '#a0a0b0',
                    borderColor: 'rgba(0, 212, 255, 0.3)',
                    borderWidth: 1,
                    padding: 16,
                    cornerRadius: 12,
                    displayColors: true,
                    titleFont: { size: 13, weight: 'bold', family: 'Outfit' },
                    bodyFont: { size: 12, family: 'Outfit' },
                    callbacks: {
                        title: (items) => formatTooltipTitle(items[0].dataIndex, granularity),
                        label: (ctx) => formatTooltipLabel(ctx),
                        afterBody: (items) => formatTooltipAfter(items[0].dataIndex, granularity)
                    }
                }
            },
            
            scales: {
                y: {
                    position: 'left',
                    grid: { color: 'rgba(255,255,255,0.04)' },
                    ticks: { color: '#6b6b7b', font: { family: 'Outfit' } },
                    border: { display: false },
                    title: { 
                        display: needsSecondAxis, 
                        text: 'kg', 
                        color: '#6b6b7b',
                        font: { family: 'Outfit' }
                    }
                },
                ...(needsSecondAxis && {
                    y1: {
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: { color: '#ff9f43', font: { family: 'Outfit' } },
                        border: { display: false },
                        title: { 
                            display: true, 
                            text: '% / Escala', 
                            color: '#ff9f43',
                            font: { family: 'Outfit' }
                        }
                    }
                }),
                x: {
                    grid: { display: false },
                    ticks: { 
                        color: '#6b6b7b', 
                        font: { family: 'Outfit' },
                        maxRotation: granularity === 'daily' ? 45 : 0, 
                        autoSkip: true,
                        maxTicksLimit: granularity === 'daily' ? 20 : (granularity === 'weekly' ? 17 : 12)
                    },
                    border: { display: false }
                }
            }
        },
        plugins: [phaseBackgrounds, milestoneMarkers]
    });
    
    // Evento para limpiar hover panel cuando el ratón sale
    canvas.addEventListener('mouseleave', resetHoverPanel);
}

function getMetricData(sourceData, metric, granularity) {
    return sourceData.map(d => {
        if (granularity === 'daily') {
            if (['weight', 'fatPct', 'fatKg', 'muscleKg', 'leanMassKg'].includes(metric)) {
                return d.physical?.[metric];
            } else if (['strength', 'agility'].includes(metric)) {
                return d.performance?.[metric];
            } else {
                return d.wellbeing?.[metric];
            }
        } else if (granularity === 'weekly') {
            const endData = d.endOfWeek || d.weeklyAverages;
            if (['weight', 'fatPct', 'fatKg', 'muscleKg', 'leanMassKg'].includes(metric)) {
                return endData?.physical?.[metric];
            } else if (['strength', 'agility'].includes(metric)) {
                return endData?.performance?.[metric];
            } else {
                return endData?.wellbeing?.[metric];
            }
        } else {
            const endData = d.endOfMonth || d.monthlyAverages;
            if (['weight', 'fatPct', 'fatKg', 'muscleKg', 'leanMassKg'].includes(metric)) {
                return endData?.physical?.[metric];
            } else if (['strength', 'agility'].includes(metric)) {
                return endData?.performance?.[metric];
            } else {
                return endData?.wellbeing?.[metric];
            }
        }
    });
}

function getMetricLabel(metric) {
    const labels = {
        weight: 'Peso (kg)',
        fatPct: '% Grasa',
        fatKg: 'Grasa (kg)',
        muscleKg: 'Músculo (kg)',
        leanMassKg: 'Masa Magra (kg)',
        strength: 'Fuerza',
        agility: 'Agilidad',
        aesthetics: 'Estética',
        mentalRecovery: 'Recuperación',
        generalFeeling: 'Ánimo',
        selfEsteem: 'Autoestima',
        sleepQuality: 'Sueño'
    };
    return labels[metric] || metric;
}

function getAxisForMetric(metric) {
    if (['weight', 'fatKg', 'muscleKg', 'leanMassKg'].includes(metric)) {
        return 'y';
    }
    return 'y1';
}

// ============================================
// FONDOS DE FASES
// ============================================
function createPhaseBackgrounds(sourceData, granularity) {
    return {
        id: 'phaseBackgrounds',
        beforeDraw: (chart) => {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea) return;
            
            const phases = AppState.data.phases;
            if (!phases || phases.length === 0) return;
            
            let currentPhase = null;
            let phaseStart = 0;
            
            sourceData.forEach((d, i) => {
                const phaseName = d.phase;
                
                if (phaseName !== currentPhase) {
                    if (currentPhase !== null) {
                        drawPhaseBackground(ctx, chartArea, scales.x, phaseStart, i - 1, currentPhase, phases);
                    }
                    currentPhase = phaseName;
                    phaseStart = i;
                }
            });
            
            // Dibujar última fase
            if (currentPhase !== null) {
                drawPhaseBackground(ctx, chartArea, scales.x, phaseStart, sourceData.length - 1, currentPhase, phases);
            }
        }
    };
}

function drawPhaseBackground(ctx, chartArea, xScale, startIdx, endIdx, phaseName, phases) {
    const phase = phases.find(p => p.name === phaseName);
    if (!phase) return;
    
    const color = PHASE_COLORS[phase.type] || '#666666';
    
    const x1 = xScale.getPixelForValue(startIdx);
    const x2 = xScale.getPixelForValue(endIdx);
    
    ctx.save();
    ctx.fillStyle = color + '15';
    ctx.fillRect(x1, chartArea.top, x2 - x1, chartArea.bottom - chartArea.top);
    ctx.restore();
}

// ============================================
// TOOLTIP FORMATTING
// ============================================
function formatTooltipTitle(index, granularity) {
    switch (granularity) {
        case 'daily':
            const dayData = AppState.data.daily[index];
            return dayData ? `${dayData.dateFormatted} - ${dayData.dayOfWeek}` : `Día ${index + 1}`;
        case 'weekly':
            const weekData = AppState.data.weekly[index];
            return weekData ? `Semana ${weekData.week}: ${weekData.startDateFormatted} - ${weekData.endDateFormatted}` : `Semana ${index + 1}`;
        case 'monthly':
            const monthData = AppState.data.monthly[index];
            return monthData?.monthName || `Mes ${index + 1}`;
    }
}

function formatTooltipLabel(ctx) {
    const value = ctx.parsed.y;
    const label = ctx.dataset.label;
    
    if (label.includes('kg')) {
        return `${label}: ${value.toFixed(2)} kg`;
    } else if (label.includes('%')) {
        return `${label}: ${value.toFixed(1)}%`;
    }
    return `${label}: ${value.toFixed(1)}`;
}

function formatTooltipAfter(index, granularity) {
    let data;
    switch (granularity) {
        case 'daily':
            data = AppState.data.daily[index];
            break;
        case 'weekly':
            data = AppState.data.weekly[index];
            break;
        case 'monthly':
            data = AppState.data.monthly[index];
            break;
    }
    
    if (!data) return '';
    
    const lines = [`Fase: ${data.phase}`];
    
    // Add milestones at this index
    const milestones = getMilestoneAtIndex(index, granularity);
    if (milestones.length > 0) {
        lines.push('');
        lines.push('🏆 Hitos:');
        milestones.forEach(m => {
            lines.push(`  • ${m.name}`);
        });
    }
    
    return lines;
}

// ============================================
// HOVER PANEL
// ============================================
function updateHoverPanel(index, granularity) {
    const panel = document.getElementById('hoverPanel');
    if (!panel) return;
    
    let data;
    switch (granularity) {
        case 'daily':
            data = AppState.data.daily[index];
            break;
        case 'weekly':
            data = AppState.data.weekly[index];
            break;
        case 'monthly':
            data = AppState.data.monthly[index];
            break;
    }
    
    if (!data) return;
    
    const physical = granularity === 'daily' ? data.physical : 
                    (data.endOfWeek?.physical || data.weeklyAverages?.physical || data.endOfMonth?.physical);
    
    if (!physical) return;
    
    panel.innerHTML = `
        <div class="hover-content">
            <div class="hover-title">${data.phase}</div>
            <div class="hover-metrics">
                <span class="hover-metric">
                    <span class="hover-label">Peso</span>
                    <span class="hover-value" style="color: ${METRIC_COLORS.weight}">${formatNumber(physical.weight)} kg</span>
                </span>
                <span class="hover-metric">
                    <span class="hover-label">Músculo</span>
                    <span class="hover-value" style="color: ${METRIC_COLORS.muscleKg}">${formatNumber(physical.muscleKg)} kg</span>
                </span>
                <span class="hover-metric">
                    <span class="hover-label">Grasa</span>
                    <span class="hover-value" style="color: ${METRIC_COLORS.fatPct}">${formatNumber(physical.fatPct)}%</span>
                </span>
            </div>
        </div>
    `;
}

function resetHoverPanel() {
    const panel = document.getElementById('hoverPanel');
    if (panel) {
        panel.innerHTML = `
            <div class="hover-placeholder">
                <span>👆 Pasa el ratón sobre el gráfico para ver detalles</span>
            </div>
        `;
    }
}

// ============================================
// CHART CLICK HANDLER
// ============================================
function handleChartClick(event, chart, granularity) {
    const points = chart.getElementsAtEventForMode(event, 'nearest', { intersect: true }, false);
    
    if (points.length > 0) {
        const index = points[0].index;
        
        switch (granularity) {
            case 'daily':
                AppState.navigation.currentDay = index + 1;
                break;
            case 'weekly':
                AppState.navigation.currentWeek = index + 1;
                AppState.navigation.currentDay = (index * 7) + 1;
                break;
            case 'monthly':
                AppState.navigation.currentMonth = index + 1;
                break;
        }
        
        renderDashboard();
        renderNavigation();
    }
}

// ============================================
// CHART HIGHLIGHT - Highlight current position
// ============================================
function updateChartHighlight() {
    const chart = AppState.charts.main;
    if (!chart) return;
    
    const { granularity, currentDay, currentWeek, currentMonth } = AppState.navigation;
    
    // Determine current index based on granularity
    let currentIndex;
    switch (granularity) {
        case 'daily':
            currentIndex = currentDay - 1;
            break;
        case 'weekly':
            currentIndex = currentWeek - 1;
            break;
        case 'monthly':
            currentIndex = currentMonth - 1;
            break;
    }
    
    // Update point styles to highlight current position
    chart.data.datasets.forEach(dataset => {
        const pointRadius = dataset.data.map((_, i) => i === currentIndex ? 6 : 2);
        const pointBorderWidth = dataset.data.map((_, i) => i === currentIndex ? 3 : 1);
        dataset.pointRadius = pointRadius;
        dataset.pointBorderWidth = pointBorderWidth;
    });
    
    chart.update('none'); // Update without animation
}

// ============================================
// MILESTONE MARKERS ON CHART
// ============================================
function calculateMilestonePositions(sourceData, granularity) {
    const milestones = AppState.data.milestones || [];
    if (!milestones.length || !sourceData.length) return [];
    
    const triggeredMilestones = [];
    
    milestones.forEach(milestone => {
        let triggerIndex = -1;
        
        // Find the first data point where milestone is triggered
        for (let i = 0; i < sourceData.length; i++) {
            const d = sourceData[i];
            let physical;
            
            if (granularity === 'daily') {
                physical = d.physical;
            } else if (granularity === 'weekly') {
                physical = d.endOfWeek?.physical || d.weeklyAverages?.physical;
            } else {
                physical = d.endOfMonth?.physical || d.monthlyAverages?.physical;
            }
            
            if (!physical) continue;
            
            let triggered = false;
            
            switch (milestone.triggerType) {
                case 'fatPct':
                    // Trigger when fat % drops below threshold
                    if (physical.fatPct <= milestone.triggerValue) {
                        triggered = true;
                    }
                    break;
                case 'muscleKg':
                    // Trigger when muscle exceeds threshold
                    if (physical.muscleKg >= milestone.triggerValue) {
                        triggered = true;
                    }
                    break;
                case 'day':
                    // Trigger on specific day
                    const dayNum = granularity === 'daily' ? d.day : 
                                   granularity === 'weekly' ? d.endDay :
                                   d.endDay;
                    if (dayNum >= milestone.triggerValue) {
                        triggered = true;
                    }
                    break;
                case 'weight':
                    if (physical.weight <= milestone.triggerValue) {
                        triggered = true;
                    }
                    break;
            }
            
            if (triggered) {
                triggerIndex = i;
                break;
            }
        }
        
        if (triggerIndex >= 0) {
            triggeredMilestones.push({
                ...milestone,
                dataIndex: triggerIndex
            });
        }
    });
    
    return triggeredMilestones;
}

function createMilestoneMarkers(sourceData, granularity) {
    return {
        id: 'milestoneMarkers',
        afterDatasetsDraw: (chart) => {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea) return;
            
            const milestones = calculateMilestonePositions(sourceData, granularity);
            if (!milestones.length) return;
            
            // Category colors
            const categoryColors = {
                definition: '#ff6b6b',
                size: '#48bb78',
                phase: '#00d4ff',
                aesthetic: '#ed64a6',
                strength: '#f6ad55'
            };
            
            // Draw milestone markers
            milestones.forEach(milestone => {
                const x = scales.x.getPixelForValue(milestone.dataIndex);
                const yTop = chartArea.top;
                const yBottom = chartArea.bottom;
                
                const color = categoryColors[milestone.category] || '#888';
                
                // Draw subtle vertical line
                ctx.save();
                ctx.strokeStyle = color + '40';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(x, yTop);
                ctx.lineTo(x, yBottom);
                ctx.stroke();
                ctx.setLineDash([]);
                
                // Draw small marker at top
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.arc(x, yTop + 8, 4, 0, Math.PI * 2);
                ctx.fill();
                
                // Draw milestone icon/emoji based on category
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                
                const icons = {
                    definition: '🎯',
                    size: '💪',
                    phase: '🏁',
                    aesthetic: '✨',
                    strength: '🔥'
                };
                ctx.fillText(icons[milestone.category] || '•', x, yTop + 14);
                
                ctx.restore();
            });
        }
    };
}

// Store triggered milestones for tooltip display
function getMilestoneAtIndex(index, granularity) {
    const sourceData = granularity === 'daily' ? AppState.data.daily :
                       granularity === 'weekly' ? AppState.data.weekly :
                       AppState.data.monthly;
    
    const milestones = calculateMilestonePositions(sourceData, granularity);
    return milestones.filter(m => m.dataIndex === index);
}

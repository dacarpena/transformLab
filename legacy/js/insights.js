// ============================================
// TRANSFORMLAB - Insights Module v3.0
// Motor de insights e inteligencia
// ============================================

// ============================================
// GENERADOR DE INSIGHTS
// ============================================
function renderInsights() {
    const container = document.getElementById('insightsPanel');
    if (!container) return;
    
    const insights = generateInsights();
    
    if (insights.length === 0) {
        container.innerHTML = `
            <div class="insights-empty">
                <span>📊 No hay insights disponibles para este período</span>
            </div>
        `;
        return;
    }
    
    container.innerHTML = `
        <div class="insights-header">
            <h3>💡 Insights</h3>
        </div>
        <div class="insights-list">
            ${insights.map(insight => `
                <div class="insight-item ${insight.type}">
                    <span class="insight-icon">${insight.icon}</span>
                    <div class="insight-content">
                        <p class="insight-text">${insight.text}</p>
                        ${insight.detail ? `<span class="insight-detail">${insight.detail}</span>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function generateInsights() {
    const insights = [];
    const { granularity, currentDay, currentWeek, currentMonth } = AppState.navigation;
    
    if (!AppState.data.daily || AppState.data.daily.length === 0) {
        return insights;
    }
    
    // Obtener datos actuales y anteriores
    let current, previous, currentIdx;
    
    switch (granularity) {
        case 'daily':
            currentIdx = currentDay - 1;
            current = AppState.data.daily[currentIdx];
            previous = currentIdx > 0 ? AppState.data.daily[currentIdx - 1] : null;
            break;
        case 'weekly':
            currentIdx = currentWeek - 1;
            current = AppState.data.weekly[currentIdx];
            previous = currentIdx > 0 ? AppState.data.weekly[currentIdx - 1] : null;
            break;
        case 'monthly':
            currentIdx = currentMonth - 1;
            current = AppState.data.monthly[currentIdx];
            previous = currentIdx > 0 ? AppState.data.monthly[currentIdx - 1] : null;
            break;
    }
    
    if (!current) return insights;
    
    // 1. Insight de progreso de fase
    const phase = AppState.data.phases?.find(p => p.name === current.phase);
    if (phase) {
        insights.push({
            type: 'info',
            icon: getPhaseInsightIcon(phase.type),
            text: `Estás en la fase "${phase.name}"`,
            detail: phase.description
        });
    }
    
    // 2. Insights de cambios significativos
    if (granularity === 'weekly' && current.weeklyChange) {
        const muscleChange = current.weeklyChange.muscleKg;
        const fatChange = current.weeklyChange.fatKg;
        
        if (muscleChange > 0.2) {
            insights.push({
                type: 'success',
                icon: '💪',
                text: `¡Excelente! Ganaste ${formatNumber(muscleChange, 2)} kg de músculo esta semana`,
                detail: 'Por encima del promedio esperado'
            });
        }
        
        if (fatChange < -0.5) {
            insights.push({
                type: 'success',
                icon: '🔥',
                text: `Perdiste ${formatNumber(Math.abs(fatChange), 2)} kg de grasa esta semana`,
                detail: 'Buen ritmo de pérdida'
            });
        }
        
        if (muscleChange < -0.1) {
            insights.push({
                type: 'warning',
                icon: '⚠️',
                text: `Perdiste ${formatNumber(Math.abs(muscleChange), 2)} kg de músculo`,
                detail: 'Considera aumentar proteína o reducir déficit'
            });
        }
    }
    
    // 3. Insights de bienestar
    const wellbeing = granularity === 'daily' ? current.wellbeing : 
                     (current.endOfWeek?.wellbeing || current.weeklyAverages?.wellbeing);
    
    if (wellbeing) {
        if (wellbeing.energy < 5) {
            insights.push({
                type: 'warning',
                icon: '🔋',
                text: 'Tu energía está baja',
                detail: 'Considera descansar más o revisar tu nutrición'
            });
        }
        
        if (wellbeing.sleepQuality && wellbeing.sleepQuality < 5) {
            insights.push({
                type: 'warning',
                icon: '😴',
                text: 'Calidad de sueño mejorable',
                detail: 'El sueño es crucial para la recuperación muscular'
            });
        }
        
        if (wellbeing.aesthetics >= 7) {
            insights.push({
                type: 'success',
                icon: '✨',
                text: '¡Tu percepción estética está mejorando!',
                detail: 'Los cambios se están volviendo visibles'
            });
        }
    }
    
    // 4. Insights de progreso general
    const metadata = AppState.data.metadata;
    if (metadata && metadata.initialComposition) {
        const physical = granularity === 'daily' ? current.physical :
                        (current.endOfWeek?.physical || current.weeklyAverages?.physical);
        
        if (physical) {
            const totalMuscleGain = physical.muscleKg - metadata.initialComposition.muscleKg;
            const totalFatLoss = metadata.initialComposition.fatKg - physical.fatKg;
            
            if (totalMuscleGain > 1) {
                insights.push({
                    type: 'success',
                    icon: '📈',
                    text: `Has ganado ${formatNumber(totalMuscleGain, 1)} kg de músculo en total`,
                    detail: 'Progreso acumulado desde el inicio'
                });
            }
            
            if (totalFatLoss > 2) {
                insights.push({
                    type: 'success',
                    icon: '📉',
                    text: `Has perdido ${formatNumber(totalFatLoss, 1)} kg de grasa en total`,
                    detail: 'Progreso acumulado desde el inicio'
                });
            }
        }
    }
    
    // 5. Plateau insight (daily view)
    if (granularity === 'daily') {
        const dayData = AppState.data.daily?.[currentIdx];
        if (dayData?.isPlateauDay) {
            insights.unshift({
                type: 'warning',
                icon: '📊',
                text: 'Estás en una meseta de adaptación',
                detail: 'El cuerpo retiene agua temporalmente. Es normal — la pérdida de grasa continúa. Un día de recarga puede ayudar.'
            });
        }
        if (dayData?.isRefeedDay) {
            insights.unshift({
                type: 'info',
                icon: '⚡',
                text: dayData.refeedType === 'diet_break'
                    ? 'Semana de recarga — come a mantenimiento'
                    : 'Día de recarga — aumenta carbohidratos',
                detail: 'La recarga restaura la leptina y previene la adaptación metabólica.'
            });
        }
    }

    // 6. Menstrual cycle insight (females only, daily view)
    if (granularity === 'daily' && AppState.userProfile?.profile?.sex === 'female') {
        const CYCLE = 28;
        const dayData = AppState.data.daily?.[currentIdx];
        if (dayData) {
            const cycleDay = ((dayData.day - 1) % CYCLE) + 1;
            if (cycleDay >= 20 && cycleDay <= 28) {
                insights.push({
                    type: 'info',
                    icon: '🌙',
                    text: 'Fase lútea — retención de agua normal',
                    detail: 'El aumento de peso que ves es agua hormonal, no grasa. Continúa con tu plan.'
                });
            }
        }
    }

    // Limitar a 5 insights máximo
    return insights.slice(0, 5);
}

function getPhaseInsightIcon(phaseType) {
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

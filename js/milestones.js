// ============================================
// TRANSFORMLAB - Milestones Module
// Sistema de hitos estéticos
// ============================================

// Colores por categoría de hito
const MILESTONE_COLORS = {
    general: '#94a3b8',
    torso: '#f97316',
    espalda: '#8b5cf6',
    hombros: '#06b6d4',
    brazos: '#ef4444',
    antebrazos: '#f43f5e',
    core: '#22c55e',
    piernas: '#3b82f6',
    vascularidad: '#ec4899',
    proporciones: '#eab308',
    postura: '#14b8a6',
    cuello: '#6366f1',
    milestone: '#fbbf24'
};

// Iconos por categoría
const MILESTONE_ICONS = {
    general: '🎯',
    torso: '💪',
    espalda: '🔙',
    hombros: '🦾',
    brazos: '💪',
    antebrazos: '🤜',
    core: '🎯',
    piernas: '🦵',
    vascularidad: '🔴',
    proporciones: '📐',
    postura: '🧘',
    cuello: '🦒',
    milestone: '🏆'
};

// ============================================
// CARGA DE DATOS DE HITOS
// ============================================
async function loadMilestones() {
    try {
        // Use milestones from AppState (generated dynamically)
        let milestones = AppState.data.milestones || [];
        
        if (milestones.length === 0) {
            console.log('⚠️ No hay hitos generados todavía');
            return;
        }
        
        // Recalculate dates based on start date
        milestones = milestones.map(m => ({
            ...m,
            calculatedDate: getDateForDay(m.day),
            dateFormatted: formatDateForDay(m.day, 'short'),
            fullDateFormatted: formatDateForDay(m.day, 'full')
        }));
        
        AppState.data.milestones = milestones;
        AppState.data.aestheticMilestones = milestones;
        
        console.log(`✅ Hitos cargados: ${milestones.length} hitos dinámicos`);
        
        // Render milestone components
        renderMilestonesTimeline();
        renderNextMilestone();
        renderMilestoneStats();
        renderCategoryProgressTable();
        
        // Re-render chart to show milestone markers
        if (typeof renderMainChart === 'function') {
            renderMainChart();
        }
        
    } catch (error) {
        console.error('Error procesando hitos:', error);
    }
}

// ============================================
// HELPERS DE HITOS
// ============================================
function getMilestonesByDay(day) {
    if (!AppState.data.milestones) return [];
    return AppState.data.milestones.filter(m => m.day === day);
}

function getMilestonesByWeek(week) {
    if (!AppState.data.milestones) return [];
    return AppState.data.milestones.filter(m => m.week === week);
}

function getMilestonesByPhase(phaseName) {
    if (!AppState.data.milestones) return [];
    return AppState.data.milestones.filter(m => m.phase === phaseName);
}

function getMilestonesByCategory(category) {
    if (!AppState.data.milestones) return [];
    return AppState.data.milestones.filter(m => m.category === category);
}

function getAchievedMilestones(currentDay) {
    if (!AppState.data.milestones) return [];
    return AppState.data.milestones.filter(m => m.day <= currentDay);
}

function getPendingMilestones(currentDay) {
    if (!AppState.data.milestones) return [];
    return AppState.data.milestones.filter(m => m.day > currentDay);
}

function getNextMilestone(currentDay) {
    const pending = getPendingMilestones(currentDay);
    return pending.length > 0 ? pending[0] : null;
}

function getMilestoneState(milestone, currentDay) {
    if (milestone.day < currentDay) return 'achieved';
    if (milestone.day === currentDay) return 'current';
    
    const nextMilestone = getNextMilestone(currentDay);
    if (nextMilestone && nextMilestone.id === milestone.id) return 'next';
    
    return 'pending';
}

function getCurrentDay() {
    const { granularity, currentDay, currentWeek } = AppState.navigation;
    if (granularity === 'daily') return currentDay;
    // Para semanas, calcular día aproximado
    return currentWeek * 7;
}

function getVisibilityLevel(visibility) {
    const levels = { 'sutil': 1, 'notable': 2, 'muy_notable': 3 };
    return levels[visibility] || 1;
}

function getVisibilityDots(visibility) {
    const level = getVisibilityLevel(visibility);
    return '●'.repeat(level) + '○'.repeat(3 - level);
}

function getVisibilityLabel(visibility) {
    const labels = {
        'sutil': 'Sutil',
        'notable': 'Notable',
        'muy_notable': 'Muy notable'
    };
    return labels[visibility] || visibility;
}

// ============================================
// TIMELINE DE HITOS
// ============================================
function renderMilestonesTimeline() {
    const container = document.getElementById('milestonesTimeline');
    if (!container || !AppState.data.milestones) return;
    
    const milestones = AppState.data.milestones;
    const currentDay = getCurrentDay();
    const totalDays = AppState.data.metadata?.period?.totalDays || 485;
    
    // Calcular posiciones de hitos
    const milestonesHTML = milestones.map(m => {
        const position = (m.day / totalDays) * 100;
        const state = getMilestoneState(m, currentDay);
        const color = MILESTONE_COLORS[m.category] || '#666';
        
        return `
            <div class="timeline-milestone ${state}" 
                 style="left: ${position}%; --milestone-color: ${color}"
                 data-milestone-id="${m.id}"
                 title="${m.title} (Día ${m.day})">
                <div class="milestone-dot"></div>
            </div>
        `;
    }).join('');
    
    // Indicador de posición actual
    const currentPosition = (currentDay / totalDays) * 100;
    
    container.innerHTML = `
        <div class="milestones-timeline-header">
            <h3>📍 Timeline de Hitos Estéticos</h3>
            <div class="milestones-timeline-filters">
                <select id="milestoneFilterCategory" class="milestone-filter">
                    <option value="all">Todas las categorías</option>
                    ${Object.entries(MILESTONE_ICONS).map(([cat, icon]) => 
                        `<option value="${cat}">${icon} ${cat.charAt(0).toUpperCase() + cat.slice(1)}</option>`
                    ).join('')}
                </select>
                <select id="milestoneFilterVisibility" class="milestone-filter">
                    <option value="all">Toda visibilidad</option>
                    <option value="sutil">Sutil</option>
                    <option value="notable">Notable</option>
                    <option value="muy_notable">Muy notable</option>
                </select>
            </div>
        </div>
        
        <div class="milestones-timeline-track">
            <div class="timeline-phases-bg"></div>
            <div class="timeline-milestones">
                ${milestonesHTML}
            </div>
            <div class="timeline-current-marker" style="left: ${currentPosition}%"></div>
        </div>
        
        <div class="milestones-timeline-labels">
            <span>Día 1</span>
            <span>Día ${Math.round(totalDays / 4)}</span>
            <span>Día ${Math.round(totalDays / 2)}</span>
            <span>Día ${Math.round(totalDays * 3 / 4)}</span>
            <span>Día ${totalDays}</span>
        </div>
        
        <div id="milestonePreview" class="milestone-preview hidden"></div>
    `;
    
    // Añadir eventos
    setupMilestoneTimelineEvents();
}

function setupMilestoneTimelineEvents() {
    // Hover en hitos
    document.querySelectorAll('.timeline-milestone').forEach(el => {
        el.addEventListener('mouseenter', (e) => showMilestonePreview(e, el.dataset.milestoneId));
        el.addEventListener('mouseleave', hideMilestonePreview);
        el.addEventListener('click', () => openMilestoneDetail(el.dataset.milestoneId));
    });
    
    // Filtros
    document.getElementById('milestoneFilterCategory')?.addEventListener('change', filterMilestonesTimeline);
    document.getElementById('milestoneFilterVisibility')?.addEventListener('change', filterMilestonesTimeline);
}

function showMilestonePreview(event, milestoneId) {
    const milestone = AppState.data.milestones.find(m => m.id == milestoneId);
    if (!milestone) return;
    
    const preview = document.getElementById('milestonePreview');
    if (!preview) return;
    
    const state = getMilestoneState(milestone, getCurrentDay());
    const color = MILESTONE_COLORS[milestone.category];
    const icon = MILESTONE_ICONS[milestone.category];
    
    preview.innerHTML = `
        <div class="preview-header" style="border-color: ${color}">
            <span class="preview-icon">${icon}</span>
            <span class="preview-category">${milestone.category}</span>
            <span class="preview-day">Día ${milestone.day}</span>
        </div>
        <h4 class="preview-title">${milestone.title}</h4>
        <p class="preview-desc">${milestone.description}</p>
        <div class="preview-visibility">
            <span class="visibility-dots">${getVisibilityDots(milestone.visibility)}</span>
            <span class="visibility-label">${getVisibilityLabel(milestone.visibility)}</span>
        </div>
        <span class="preview-state ${state}">${state === 'achieved' ? '✓ Alcanzado' : state === 'next' ? '⏳ Próximo' : '○ Pendiente'}</span>
    `;
    
    // Posicionar preview
    const rect = event.target.getBoundingClientRect();
    preview.style.left = `${rect.left}px`;
    preview.style.top = `${rect.bottom + 10}px`;
    preview.classList.remove('hidden');
}

function hideMilestonePreview() {
    const preview = document.getElementById('milestonePreview');
    if (preview) preview.classList.add('hidden');
}

function filterMilestonesTimeline() {
    const categoryFilter = document.getElementById('milestoneFilterCategory')?.value || 'all';
    const visibilityFilter = document.getElementById('milestoneFilterVisibility')?.value || 'all';
    
    document.querySelectorAll('.timeline-milestone').forEach(el => {
        const milestoneId = el.dataset.milestoneId;
        const milestone = AppState.data.milestones.find(m => m.id == milestoneId);
        
        let visible = true;
        if (categoryFilter !== 'all' && milestone.category !== categoryFilter) visible = false;
        if (visibilityFilter !== 'all' && milestone.visibility !== visibilityFilter) visible = false;
        
        el.style.display = visible ? 'block' : 'none';
    });
}

// ============================================
// PANEL DE PRÓXIMO HITO
// ============================================
function renderNextMilestone() {
    const container = document.getElementById('nextMilestonePanel');
    if (!container || !AppState.data.milestones) return;
    
    const currentDay = getCurrentDay();
    const nextMilestone = getNextMilestone(currentDay);
    
    if (!nextMilestone) {
        container.innerHTML = `
            <div class="next-milestone-complete">
                <span class="complete-icon">🎉</span>
                <h3>¡Todos los hitos completados!</h3>
                <p>Has alcanzado los 102 hitos estéticos</p>
            </div>
        `;
        return;
    }
    
    const daysUntil = nextMilestone.day - currentDay;
    const progress = (currentDay / nextMilestone.day) * 100;
    const color = MILESTONE_COLORS[nextMilestone.category];
    const icon = MILESTONE_ICONS[nextMilestone.category];
    
    // Info de trigger
    let triggerInfo = '';
    if (nextMilestone.fatPct_trigger) {
        const currentFat = getCurrentMetric('fatPct');
        triggerInfo = `📊 Trigger: ${nextMilestone.fatPct_trigger}% grasa (actualmente ${formatNumber(currentFat)}%)`;
    } else if (nextMilestone.muscle_trigger) {
        const currentMuscle = getCurrentMetric('muscleKg');
        triggerInfo = `📊 Trigger: ${nextMilestone.muscle_trigger} kg músculo (actualmente ${formatNumber(currentMuscle)} kg)`;
    }
    
    container.innerHTML = `
        <div class="next-milestone-header">
            <span class="next-icon" style="background: ${color}">${icon}</span>
            <div class="next-title-wrap">
                <span class="next-label">🎯 PRÓXIMO HITO ESTÉTICO</span>
                <h3 class="next-title">${nextMilestone.title}</h3>
            </div>
        </div>
        
        <p class="next-description">${nextMilestone.description}</p>
        
        <div class="next-progress">
            <div class="next-progress-bar">
                <div class="next-progress-fill" style="width: ${Math.min(progress, 100)}%; background: ${color}"></div>
            </div>
            <span class="next-progress-text">${Math.round(progress)}%</span>
        </div>
        
        <div class="next-details">
            <div class="next-detail">
                <span class="detail-icon">📅</span>
                <span class="detail-text">Esperado: ${nextMilestone.dateFormatted}</span>
            </div>
            <div class="next-detail">
                <span class="detail-icon">⏳</span>
                <span class="detail-text">Faltan: ${daysUntil} días</span>
            </div>
            ${triggerInfo ? `
            <div class="next-detail trigger">
                <span class="detail-text">${triggerInfo}</span>
            </div>
            ` : ''}
        </div>
        
        <div class="next-meta">
            <span class="meta-phase" style="background: ${PHASE_COLORS[nextMilestone.phaseType] || '#666'}">${nextMilestone.phase}</span>
            <span class="meta-visibility">${getVisibilityDots(nextMilestone.visibility)} ${getVisibilityLabel(nextMilestone.visibility)}</span>
        </div>
        
        <button class="next-view-all" onclick="openMilestonesGallery()">
            Ver todos los hitos pendientes →
        </button>
    `;
}

function getCurrentMetric(metric) {
    const current = getCurrentData();
    if (!current) return 0;
    
    const { granularity } = AppState.navigation;
    if (granularity === 'daily') {
        return current.physical?.[metric] || 0;
    } else if (granularity === 'weekly') {
        return current.endOfWeek?.physical?.[metric] || current.weeklyAverages?.physical?.[metric] || 0;
    } else {
        return current.endOfMonth?.physical?.[metric] || 0;
    }
}

// ============================================
// ESTADÍSTICAS DE HITOS
// ============================================
function renderMilestoneStats() {
    const container = document.getElementById('milestoneStats');
    if (!container || !AppState.data.milestones) return;
    
    const currentDay = getCurrentDay();
    const achieved = getAchievedMilestones(currentDay);
    const pending = getPendingMilestones(currentDay);
    const total = AppState.data.milestones.length;
    const progressPct = Math.round((achieved.length / total) * 100);
    
    // Calcular progreso por categoría
    const categoryStats = {};
    AppState.data.milestones.forEach(m => {
        if (!categoryStats[m.category]) {
            categoryStats[m.category] = { total: 0, achieved: 0 };
        }
        categoryStats[m.category].total++;
        if (m.day <= currentDay) {
            categoryStats[m.category].achieved++;
        }
    });
    
    // Encontrar mejor y peor categoría
    let bestCategory = null, worstCategory = null;
    let bestPct = -1, worstPct = 101;
    
    Object.entries(categoryStats).forEach(([cat, stats]) => {
        const pct = (stats.achieved / stats.total) * 100;
        if (pct > bestPct) { bestPct = pct; bestCategory = cat; }
        if (pct < worstPct) { worstPct = pct; worstCategory = cat; }
    });
    
    // Hitos esta semana
    const currentWeek = AppState.navigation.currentWeek || Math.ceil(currentDay / 7);
    const milestonesThisWeek = AppState.data.milestones.filter(m => m.week === currentWeek).length;
    
    // Próximo hito
    const nextMilestone = getNextMilestone(currentDay);
    const daysToNext = nextMilestone ? nextMilestone.day - currentDay : 0;
    
    container.innerHTML = `
        <div class="stats-header">
            <h3>📊 Resumen de Hitos Estéticos</h3>
        </div>
        
        <div class="stats-summary">
            <div class="stat-box achieved">
                <span class="stat-value">${achieved.length}</span>
                <span class="stat-label">Alcanzados</span>
            </div>
            <div class="stat-box pending">
                <span class="stat-value">${pending.length}</span>
                <span class="stat-label">Pendientes</span>
            </div>
            <div class="stat-box progress">
                <span class="stat-value">${progressPct}%</span>
                <span class="stat-label">Progreso</span>
            </div>
        </div>
        
        <div class="stats-details">
            <div class="stat-detail">
                <span class="detail-label">Próximo hito en:</span>
                <span class="detail-value">${daysToNext} días</span>
            </div>
            <div class="stat-detail">
                <span class="detail-label">Hitos esta semana:</span>
                <span class="detail-value">${milestonesThisWeek}</span>
            </div>
            <div class="stat-detail">
                <span class="detail-label">Categoría más avanzada:</span>
                <span class="detail-value">${MILESTONE_ICONS[bestCategory] || ''} ${bestCategory} (${Math.round(bestPct)}%)</span>
            </div>
            <div class="stat-detail">
                <span class="detail-label">Categoría más rezagada:</span>
                <span class="detail-value">${MILESTONE_ICONS[worstCategory] || ''} ${worstCategory} (${Math.round(worstPct)}%)</span>
            </div>
        </div>
        
        <button class="view-gallery-btn" onclick="openMilestonesGallery()">
            Ver galería completa →
        </button>
    `;
}

// ============================================
// TABLA DE PROGRESO POR CATEGORÍA
// ============================================
function renderCategoryProgressTable() {
    const container = document.getElementById('categoryProgressTable');
    if (!container || !AppState.data.milestones) return;
    
    const currentDay = getCurrentDay();
    
    // Calcular stats por categoría
    const categories = {};
    AppState.data.milestones.forEach(m => {
        if (!categories[m.category]) {
            categories[m.category] = {
                total: 0,
                achieved: 0,
                pending: [],
                icon: MILESTONE_ICONS[m.category],
                color: MILESTONE_COLORS[m.category]
            };
        }
        categories[m.category].total++;
        if (m.day <= currentDay) {
            categories[m.category].achieved++;
        } else {
            categories[m.category].pending.push(m);
        }
    });
    
    // Ordenar por progreso
    const sortedCategories = Object.entries(categories)
        .map(([name, data]) => ({
            name,
            ...data,
            pct: (data.achieved / data.total) * 100,
            next: data.pending[0]
        }))
        .sort((a, b) => b.pct - a.pct);
    
    const rows = sortedCategories.map(cat => `
        <tr class="category-row" data-category="${cat.name}">
            <td class="cat-name">
                <span class="cat-icon">${cat.icon}</span>
                <span>${cat.name.charAt(0).toUpperCase() + cat.name.slice(1)}</span>
            </td>
            <td class="cat-total">${cat.total}</td>
            <td class="cat-achieved">${cat.achieved} (${Math.round(cat.pct)}%)</td>
            <td class="cat-pending">${cat.total - cat.achieved}</td>
            <td class="cat-next">${cat.next ? `Día ${cat.next.day} - ${cat.next.title.substring(0, 25)}...` : '-'}</td>
            <td class="cat-progress">
                <div class="mini-progress-bar">
                    <div class="mini-progress-fill" style="width: ${cat.pct}%; background: ${cat.color}"></div>
                </div>
            </td>
        </tr>
    `).join('');
    
    container.innerHTML = `
        <table class="category-table">
            <thead>
                <tr>
                    <th>Categoría</th>
                    <th>Total</th>
                    <th>Alcanzados</th>
                    <th>Pendientes</th>
                    <th>Próximo</th>
                    <th>Progreso</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
            </tbody>
        </table>
    `;
}

// ============================================
// GALERÍA DE HITOS
// ============================================
function openMilestonesGallery() {
    const modal = document.getElementById('milestonesModal');
    if (!modal) {
        createMilestonesModal();
    }
    
    renderMilestonesGallery();
    document.getElementById('milestonesModal').classList.add('open');
}

function closeMilestonesGallery() {
    document.getElementById('milestonesModal')?.classList.remove('open');
}

function createMilestonesModal() {
    const modal = document.createElement('div');
    modal.id = 'milestonesModal';
    modal.className = 'milestones-modal';
    modal.innerHTML = `
        <div class="modal-backdrop" onclick="closeMilestonesGallery()"></div>
        <div class="modal-content">
            <div class="modal-header">
                <h2>🏆 Galería de Hitos Estéticos</h2>
                <button class="modal-close" onclick="closeMilestonesGallery()">✕</button>
            </div>
            <div class="modal-filters">
                <div class="filter-group">
                    <label>Estado:</label>
                    <select id="galleryFilterState" onchange="renderMilestonesGallery()">
                        <option value="all">Todos</option>
                        <option value="achieved">Alcanzados</option>
                        <option value="pending">Pendientes</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>Categoría:</label>
                    <select id="galleryFilterCategory" onchange="renderMilestonesGallery()">
                        <option value="all">Todas</option>
                        ${Object.keys(MILESTONE_ICONS).map(cat => 
                            `<option value="${cat}">${MILESTONE_ICONS[cat]} ${cat}</option>`
                        ).join('')}
                    </select>
                </div>
                <div class="filter-group">
                    <label>Visibilidad:</label>
                    <select id="galleryFilterVisibility" onchange="renderMilestonesGallery()">
                        <option value="all">Todas</option>
                        <option value="sutil">Sutil</option>
                        <option value="notable">Notable</option>
                        <option value="muy_notable">Muy notable</option>
                    </select>
                </div>
                <div class="filter-group">
                    <input type="text" id="gallerySearch" placeholder="Buscar..." oninput="renderMilestonesGallery()">
                </div>
            </div>
            <div id="galleryContent" class="gallery-content"></div>
        </div>
    `;
    document.body.appendChild(modal);
}

function renderMilestonesGallery() {
    const container = document.getElementById('galleryContent');
    if (!container) return;
    
    const currentDay = getCurrentDay();
    const stateFilter = document.getElementById('galleryFilterState')?.value || 'all';
    const categoryFilter = document.getElementById('galleryFilterCategory')?.value || 'all';
    const visibilityFilter = document.getElementById('galleryFilterVisibility')?.value || 'all';
    const searchQuery = document.getElementById('gallerySearch')?.value?.toLowerCase() || '';
    
    let milestones = [...AppState.data.milestones];
    
    // Aplicar filtros
    if (stateFilter === 'achieved') {
        milestones = milestones.filter(m => m.day <= currentDay);
    } else if (stateFilter === 'pending') {
        milestones = milestones.filter(m => m.day > currentDay);
    }
    
    if (categoryFilter !== 'all') {
        milestones = milestones.filter(m => m.category === categoryFilter);
    }
    
    if (visibilityFilter !== 'all') {
        milestones = milestones.filter(m => m.visibility === visibilityFilter);
    }
    
    if (searchQuery) {
        milestones = milestones.filter(m => 
            m.title.toLowerCase().includes(searchQuery) ||
            m.description.toLowerCase().includes(searchQuery)
        );
    }
    
    const cardsHTML = milestones.map(m => renderMilestoneCard(m, currentDay)).join('');
    
    container.innerHTML = `
        <div class="gallery-summary">
            Mostrando ${milestones.length} hitos
        </div>
        <div class="gallery-grid">
            ${cardsHTML || '<p class="no-results">No se encontraron hitos</p>'}
        </div>
    `;
}

function renderMilestoneCard(milestone, currentDay) {
    const state = getMilestoneState(milestone, currentDay);
    const color = MILESTONE_COLORS[milestone.category];
    const icon = MILESTONE_ICONS[milestone.category];
    
    return `
        <div class="milestone-card ${state}" style="--card-color: ${color}">
            <div class="card-header-row">
                <span class="card-category">${icon} ${milestone.category.toUpperCase()}</span>
                <span class="card-day">Día ${milestone.day}</span>
            </div>
            
            <h4 class="card-title">${milestone.title}</h4>
            
            <p class="card-description">${milestone.description}</p>
            
            <div class="card-meta">
                <span class="card-date">📅 ${milestone.dateFormatted} (${milestone.dayOfWeek})</span>
                <span class="card-week">Semana ${milestone.week}</span>
                <span class="card-phase" style="background: ${PHASE_COLORS[milestone.phaseType] || '#666'}">${milestone.phase}</span>
            </div>
            
            <div class="card-metrics">
                <span>Peso: ${milestone.metricsAtMilestone.weight} kg</span>
                <span>Grasa: ${milestone.metricsAtMilestone.fatPct}%</span>
                <span>Músculo: ${milestone.metricsAtMilestone.muscleKg} kg</span>
            </div>
            
            <div class="card-footer">
                <span class="card-visibility">${getVisibilityDots(milestone.visibility)} ${getVisibilityLabel(milestone.visibility)}</span>
                <span class="card-state ${state}">${state === 'achieved' ? '✓ Alcanzado' : state === 'next' ? '⏳ Próximo' : '○ Pendiente'}</span>
            </div>
        </div>
    `;
}

// ============================================
// DETALLE DE HITO INDIVIDUAL
// ============================================
function openMilestoneDetail(milestoneId) {
    const milestone = AppState.data.milestones.find(m => m.id == milestoneId);
    if (!milestone) return;
    
    const currentDay = getCurrentDay();
    const state = getMilestoneState(milestone, currentDay);
    const color = MILESTONE_COLORS[milestone.category];
    const icon = MILESTONE_ICONS[milestone.category];
    
    // Crear modal si no existe
    let modal = document.getElementById('milestoneDetailModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'milestoneDetailModal';
        modal.className = 'milestone-detail-modal';
        document.body.appendChild(modal);
    }
    
    modal.innerHTML = `
        <div class="modal-backdrop" onclick="closeMilestoneDetail()"></div>
        <div class="detail-content" style="--detail-color: ${color}">
            <button class="detail-close" onclick="closeMilestoneDetail()">✕</button>
            
            <div class="detail-header">
                <span class="detail-icon">${icon}</span>
                <div class="detail-info">
                    <span class="detail-category">${milestone.category.toUpperCase()}</span>
                    <h2>${milestone.title}</h2>
                </div>
                <span class="detail-state ${state}">${state === 'achieved' ? '✓ Alcanzado' : '○ Pendiente'}</span>
            </div>
            
            <p class="detail-description">${milestone.description}</p>
            
            <div class="detail-timing">
                <div class="timing-item">
                    <span class="timing-label">Fecha</span>
                    <span class="timing-value">${milestone.dateFormatted} (${milestone.dayOfWeek})</span>
                </div>
                <div class="timing-item">
                    <span class="timing-label">Día</span>
                    <span class="timing-value">${milestone.day}</span>
                </div>
                <div class="timing-item">
                    <span class="timing-label">Semana</span>
                    <span class="timing-value">${milestone.week}</span>
                </div>
                <div class="timing-item">
                    <span class="timing-label">Fase</span>
                    <span class="timing-value phase" style="background: ${PHASE_COLORS[milestone.phaseType]}">${milestone.phase}</span>
                </div>
            </div>
            
            <div class="detail-metrics">
                <h4>Métricas al alcanzar:</h4>
                <div class="metrics-grid">
                    <div class="metric">
                        <span class="metric-label">Peso</span>
                        <span class="metric-value">${milestone.metricsAtMilestone.weight} kg</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Grasa</span>
                        <span class="metric-value">${milestone.metricsAtMilestone.fatPct}%</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Músculo</span>
                        <span class="metric-value">${milestone.metricsAtMilestone.muscleKg} kg</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Fuerza</span>
                        <span class="metric-value">${milestone.metricsAtMilestone.strength}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Estética</span>
                        <span class="metric-value">${milestone.metricsAtMilestone.aesthetics}</span>
                    </div>
                    <div class="metric">
                        <span class="metric-label">Autoestima</span>
                        <span class="metric-value">${milestone.metricsAtMilestone.selfEsteem}</span>
                    </div>
                </div>
            </div>
            
            ${milestone.fatPct_trigger || milestone.muscle_trigger ? `
            <div class="detail-triggers">
                <h4>Triggers:</h4>
                ${milestone.fatPct_trigger ? `<p>📉 % Grasa: ${milestone.fatPct_trigger}%</p>` : ''}
                ${milestone.muscle_trigger ? `<p>💪 Músculo: ${milestone.muscle_trigger} kg</p>` : ''}
            </div>
            ` : ''}
            
            <div class="detail-visibility">
                <span class="visibility-label">Visibilidad:</span>
                <span class="visibility-dots">${getVisibilityDots(milestone.visibility)}</span>
                <span class="visibility-text">${getVisibilityLabel(milestone.visibility)}</span>
            </div>
            
            <div class="detail-actions">
                <button onclick="navigateToMilestoneDay(${milestone.day})">Ver en timeline</button>
            </div>
        </div>
    `;
    
    modal.classList.add('open');
}

function closeMilestoneDetail() {
    document.getElementById('milestoneDetailModal')?.classList.remove('open');
}

function navigateToMilestoneDay(day) {
    closeMilestoneDetail();
    setGranularity('daily');
    navigateTo(day);
}

// ============================================
// INTEGRACIÓN CON GRÁFICO PRINCIPAL
// ============================================
function getMilestonesChartPlugin() {
    return {
        id: 'milestoneMarkers',
        afterDraw: (chart) => {
            if (!AppState.data.milestones) return;
            
            const { granularity } = AppState.navigation;
            const ctx = chart.ctx;
            const chartArea = chart.chartArea;
            const xScale = chart.scales.x;
            
            // Obtener hitos visibles según granularidad
            let visibleMilestones;
            if (granularity === 'daily') {
                visibleMilestones = AppState.data.milestones;
            } else if (granularity === 'weekly') {
                // Agrupar por semana, mostrar solo principales
                visibleMilestones = AppState.data.milestones.filter(m => 
                    m.category === 'milestone' || m.visibility === 'muy_notable'
                );
            } else {
                visibleMilestones = AppState.data.milestones.filter(m => m.category === 'milestone');
            }
            
            const currentDay = getCurrentDay();
            
            visibleMilestones.forEach(m => {
                let xIndex;
                if (granularity === 'daily') {
                    xIndex = m.day - 1;
                } else if (granularity === 'weekly') {
                    xIndex = m.week - 1;
                } else {
                    xIndex = Math.floor(m.day / 30);
                }
                
                if (xIndex < 0 || xIndex >= xScale.ticks.length) return;
                
                const x = xScale.getPixelForValue(xIndex);
                const color = MILESTONE_COLORS[m.category];
                const achieved = m.day <= currentDay;
                
                // Dibujar línea vertical punteada
                ctx.save();
                ctx.strokeStyle = color + '40';
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.stroke();
                
                // Dibujar icono pequeño arriba
                ctx.fillStyle = achieved ? color : '#666';
                ctx.font = '10px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText(achieved ? '★' : '☆', x, chartArea.top - 5);
                
                ctx.restore();
            });
        }
    };
}

// Exportar para uso global
window.loadMilestones = loadMilestones;
window.renderMilestonesTimeline = renderMilestonesTimeline;
window.renderNextMilestone = renderNextMilestone;
window.renderMilestoneStats = renderMilestoneStats;
window.openMilestonesGallery = openMilestonesGallery;
window.closeMilestonesGallery = closeMilestonesGallery;
window.openMilestoneDetail = openMilestoneDetail;
window.closeMilestoneDetail = closeMilestoneDetail;
window.getMilestonesChartPlugin = getMilestonesChartPlugin;

// ============================================
// MÓDULO PARA VISTA DE HITOS (view-milestones)
// ============================================
const MilestonesModule = {
    render() {
        const container = document.getElementById('milestonesContent');
        if (!container) return;

        if (!AppState.data?.milestones) {
            container.innerHTML = '<p class="text-muted">Completa el onboarding para ver los hitos.</p>';
            return;
        }

        container.innerHTML = `
            <div class="milestones-layout">
                <div class="milestones-top-row">
                    <div id="milestoneStats" class="milestones-stats-panel card-glass"></div>
                    <div id="nextMilestonePanel" class="next-milestone-panel card-glass"></div>
                </div>
                <div id="milestonesTimeline" class="milestones-timeline-panel card-glass"></div>
                <div id="categoryProgressTable" class="milestones-categories-panel card-glass"></div>
            </div>
        `;

        renderMilestoneStats();
        renderNextMilestone();
        renderMilestonesTimeline();
        renderCategoryProgressTable();
    }
};

if (typeof window !== 'undefined') {
    window.MilestonesModule = MilestonesModule;
}

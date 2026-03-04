// ============================================
// TRANSFORMLAB - Training Module v4.0
// Phase-adaptive workout program generator
// ============================================

const TrainingModule = {

    STORAGE_KEY: 'transformlab_trainingLog',

    // ── Programs ─────────────────────────────

    PROGRAMS: {
        beginner: {
            cut:           { daysPerWeek: 3, split: 'Full Body', focus: 'Mantener fuerza y músculo' },
            bulk:          { daysPerWeek: 3, split: 'Full Body', focus: 'Construir base de fuerza' },
            recomposition: { daysPerWeek: 3, split: 'Full Body', focus: 'Adaptación y técnica' },
            default:       { daysPerWeek: 3, split: 'Full Body', focus: 'Salud general y hábito' }
        },
        intermediate: {
            cut:           { daysPerWeek: 4, split: 'Upper/Lower', focus: 'Preservar músculo en déficit' },
            bulk:          { daysPerWeek: 4, split: 'Upper/Lower', focus: 'Hipertrofia y fuerza' },
            recomposition: { daysPerWeek: 4, split: 'Upper/Lower', focus: 'Recomposición progresiva' },
            default:       { daysPerWeek: 4, split: 'Upper/Lower', focus: 'Progresión continua' }
        },
        advanced: {
            cut:           { daysPerWeek: 5, split: 'PPL', focus: 'Máxima retención muscular' },
            bulk:          { daysPerWeek: 5, split: 'PPL', focus: 'Volumen de entrenamiento alto' },
            recomposition: { daysPerWeek: 5, split: 'PPL', focus: 'Especialización' },
            default:       { daysPerWeek: 5, split: 'PPL', focus: 'Periódización avanzada' }
        }
    },

    EXERCISE_LIBRARY: {
        'Full Body': [
            { name: 'Sentadilla',        category: 'piernas',  sets: 3, reps: '8-10',  progression: 2.5 },
            { name: 'Press de banca',    category: 'pecho',    sets: 3, reps: '8-10',  progression: 2.5 },
            { name: 'Peso muerto',       category: 'espalda',  sets: 3, reps: '6-8',   progression: 5.0 },
            { name: 'Press militar',     category: 'hombros',  sets: 3, reps: '8-12',  progression: 1.25 },
            { name: 'Remo en barra',     category: 'espalda',  sets: 3, reps: '8-10',  progression: 2.5 },
            { name: 'Curl de bíceps',    category: 'brazos',   sets: 2, reps: '10-12', progression: 1.25 },
            { name: 'Press tríceps',     category: 'brazos',   sets: 2, reps: '10-12', progression: 1.25 }
        ],
        'Upper': [
            { name: 'Press de banca',    category: 'pecho',    sets: 4, reps: '6-10',  progression: 2.5  },
            { name: 'Remo en barra',     category: 'espalda',  sets: 4, reps: '6-10',  progression: 2.5  },
            { name: 'Press militar',     category: 'hombros',  sets: 3, reps: '8-12',  progression: 1.25 },
            { name: 'Dominadas/lat pulldown', category: 'espalda', sets: 3, reps: '8-12', progression: 2.5 },
            { name: 'Fondos en paralelas', category: 'pecho',  sets: 3, reps: '8-12',  progression: 2.5  },
            { name: 'Curl martillo',     category: 'brazos',   sets: 2, reps: '10-15', progression: 1.25 },
            { name: 'Extensión tríceps', category: 'brazos',   sets: 2, reps: '10-15', progression: 1.25 }
        ],
        'Lower': [
            { name: 'Sentadilla',        category: 'piernas',  sets: 4, reps: '6-10',  progression: 2.5  },
            { name: 'Peso muerto rumano', category: 'piernas', sets: 3, reps: '8-12',  progression: 2.5  },
            { name: 'Prensa de pierna',  category: 'piernas',  sets: 3, reps: '10-15', progression: 5.0  },
            { name: 'Zancadas',          category: 'piernas',  sets: 3, reps: '10-12', progression: 1.25 },
            { name: 'Elevaciones de gemelo', category: 'piernas', sets: 4, reps: '15-20', progression: 2.5 },
            { name: 'Hip thrust',        category: 'glúteos',  sets: 3, reps: '10-15', progression: 2.5  }
        ],
        'Push': [
            { name: 'Press de banca',    category: 'pecho',    sets: 4, reps: '6-10',  progression: 2.5  },
            { name: 'Press inclinado',   category: 'pecho',    sets: 3, reps: '8-12',  progression: 2.5  },
            { name: 'Press militar',     category: 'hombros',  sets: 4, reps: '6-10',  progression: 2.5  },
            { name: 'Elevaciones laterales', category: 'hombros', sets: 3, reps: '12-15', progression: 0.5 },
            { name: 'Fondos',            category: 'tríceps',  sets: 3, reps: '8-12',  progression: 2.5  },
            { name: 'Extensión tríceps en polea', category: 'tríceps', sets: 3, reps: '12-15', progression: 1.25 }
        ],
        'Pull': [
            { name: 'Dominadas',         category: 'espalda',  sets: 4, reps: '5-8',   progression: 2.5  },
            { name: 'Remo en barra',     category: 'espalda',  sets: 4, reps: '6-10',  progression: 2.5  },
            { name: 'Remo en polea baja', category: 'espalda', sets: 3, reps: '10-12', progression: 2.5  },
            { name: 'Face pull',         category: 'hombros',  sets: 3, reps: '15-20', progression: 0.5  },
            { name: 'Curl en barra',     category: 'bíceps',   sets: 3, reps: '8-12',  progression: 1.25 },
            { name: 'Curl predicador',   category: 'bíceps',   sets: 2, reps: '10-15', progression: 1.25 }
        ],
        'Legs': [
            { name: 'Sentadilla trasera', category: 'piernas', sets: 5, reps: '4-8',   progression: 2.5  },
            { name: 'Peso muerto convencional', category: 'piernas', sets: 4, reps: '4-6', progression: 5.0 },
            { name: 'Prensa 45°',        category: 'piernas',  sets: 4, reps: '10-15', progression: 5.0  },
            { name: 'Extensión cuádriceps', category: 'piernas', sets: 3, reps: '12-15', progression: 2.5 },
            { name: 'Curl de isquios',   category: 'piernas',  sets: 3, reps: '10-15', progression: 2.5  },
            { name: 'Hip thrust',        category: 'glúteos',  sets: 4, reps: '10-15', progression: 5.0  }
        ]
    },

    // Weekly schedule by split
    WEEKLY_SCHEDULES: {
        'Full Body':    ['Full Body', 'Descanso', 'Full Body', 'Descanso', 'Full Body', 'Descanso', 'Descanso'],
        'Upper/Lower':  ['Upper', 'Lower', 'Descanso', 'Upper', 'Lower', 'Descanso', 'Descanso'],
        'PPL':          ['Push', 'Pull', 'Legs', 'Descanso', 'Push', 'Pull', 'Legs']
    },

    // ── Log ───────────────────────────────────

    loadLog() {
        try { return JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}'); }
        catch { return {}; }
    },

    saveLog(log) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(log));
    },

    /**
     * Calculate suggested working weight for a given exercise
     * using the current week number as progression driver.
     */
    suggestWeight(exercise, currentWeek) {
        const log = this.loadLog();
        const key = exercise.name;
        if (log[key]?.lastWeight) {
            return log[key].lastWeight + (exercise.progression * Math.floor((currentWeek - log[key].lastWeek) / 1));
        }
        // Starting weight estimate (placeholder)
        return null;
    },

    // ── Render ────────────────────────────────

    render() {
        const container = document.getElementById('trainingContent');
        if (!container) return;

        if (!AppState.userProfile) {
            container.innerHTML = '<p class="text-muted">Completa el onboarding para ver tu plan de entrenamiento.</p>';
            return;
        }

        const { profile }   = AppState.userProfile;
        const level         = profile.trainingStatus || 'intermediate';
        const currentDayIdx = AppState.navigation.currentDay - 1;
        const dayData       = AppState.data.daily?.[currentDayIdx];
        const phaseType     = dayData?.phaseType || 'default';
        const currentWeek   = AppState.navigation.currentWeek || 1;

        const program = this.PROGRAMS[level]?.[phaseType] || this.PROGRAMS[level]?.default;
        const schedule = this.WEEKLY_SCHEDULES[program.split] || this.WEEKLY_SCHEDULES['Full Body'];

        // Determine today's training
        const today = new Date();
        const dayOfWeek  = today.getDay(); // 0=Sun…6=Sat
        // Map Sun=6, Mon=0 for our schedule (Mon-first)
        const scheduleIdx = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const todaySession = schedule[scheduleIdx];
        const isRestDay    = todaySession === 'Descanso';

        const scheduleHTML = schedule.map((session, i) => {
            const days = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
            const isToday = i === scheduleIdx;
            return `<div class="schedule-day ${isToday ? 'today' : ''} ${session === 'Descanso' ? 'rest' : 'training'}">
                <span class="day-name">${days[i]}</span>
                <span class="day-session">${session}</span>
            </div>`;
        }).join('');

        let sessionHTML = '';
        if (!isRestDay && this.EXERCISE_LIBRARY[todaySession]) {
            const exercises = this.EXERCISE_LIBRARY[todaySession];
            sessionHTML = `
                <div class="training-session card-glass">
                    <h3>💪 Sesión de hoy: ${todaySession}</h3>
                    <table class="exercise-table">
                        <thead>
                            <tr>
                                <th>Ejercicio</th>
                                <th>Series × Reps</th>
                                <th>Progresión</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${exercises.map(ex => {
                                const suggested = this.suggestWeight(ex, currentWeek);
                                return `
                                    <tr>
                                        <td>
                                            <strong>${ex.name}</strong>
                                            <span class="exercise-category">${ex.category}</span>
                                        </td>
                                        <td>${ex.sets} × ${ex.reps}</td>
                                        <td>
                                            ${suggested
                                                ? `<span class="suggested-weight">~${suggested} kg</span>`
                                                : `<span class="progression-note">+${ex.progression} kg/semana</span>`
                                            }
                                        </td>
                                    </tr>
                                `;
                            }).join('')}
                        </tbody>
                    </table>
                    <p class="training-note">
                        💡 Aumenta el peso cuando completes todas las series con buena técnica.
                    </p>
                </div>
            `;
        } else {
            sessionHTML = `<div class="training-rest card-glass">
                <span class="rest-icon">😴</span>
                <h3>Día de descanso</h3>
                <p>El descanso es parte del entrenamiento. Tu músculo crece cuando recuperas.</p>
                <p class="text-muted">Actividad ligera opciona: caminar 30 min, movilidad, stretching.</p>
            </div>`;
        }

        container.innerHTML = `
            <div class="training-layout">

                <div class="training-overview card-glass">
                    <div class="program-info">
                        <h3>Programa: ${program.split}</h3>
                        <p class="text-muted">${program.daysPerWeek} días/semana · ${program.focus}</p>
                        <p class="text-muted">Nivel: ${level} · Fase: ${phaseType}</p>
                    </div>
                    <div class="weekly-schedule">${scheduleHTML}</div>
                </div>

                ${sessionHTML}

                <div class="training-tips card-glass">
                    <h3>📋 Principios de esta semana</h3>
                    ${this._phasePrinciples(phaseType)}
                </div>

            </div>
        `;
    },

    _phasePrinciples(phaseType) {
        const principles = {
            cut: [
                'Mantén la intensidad pero reduce el volumen si te sientes fatigado.',
                'Prioriza los movimientos compuestos para estimular más músculo.',
                'El cardio moderado (LISS 20-30 min) después del entreno puede ayudar al déficit.',
                'Si la fuerza baja >10%, revisa tu ingesta calórica.'
            ],
            bulk: [
                'Busca progresión de carga semanalmente (sobrecarga progresiva).',
                'El volumen alto es clave en esta fase — no te quedes corto en series.',
                'Entrena cerca del fallo pero no hasta el fallo en todos los sets.',
                'Descansa lo suficiente (2-3 min) en ejercicios compuestos.'
            ],
            default: [
                'Consistencia > intensidad. Entrena regularmente.',
                'Registra tus pesos para hacer seguimiento de la progresión.',
                'El calentamiento reduce lesiones y mejora el rendimiento.',
                'Escucha a tu cuerpo — si algo duele, consulta un profesional.'
            ]
        };
        const list = principles[phaseType] || principles.default;
        return `<ul class="tips-list">${list.map(t => `<li>${t}</li>`).join('')}</ul>`;
    }
};

if (typeof window !== 'undefined') {
    window.TrainingModule = TrainingModule;
}

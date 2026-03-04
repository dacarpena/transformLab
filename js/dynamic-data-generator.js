// ============================================
// TRANSFORMLAB - Dynamic Data Generator
// Generates complete transformation data at runtime
// v4.0 - Non-linear curves, plateau model, refeed days
// ============================================

const DataGenerator = {
    
    /**
     * Generate complete transformation data for a user
     * 
     * @param {object} userProfile - Complete user profile from onboarding
     * @returns {object} Complete data structure {daily, weekly, monthly, phases, metadata}
     */
    generateTransformationData(userProfile) {
        const { initial, target, profile, startDate } = userProfile;
        
        // Calculate "other lean tissue" from initial measured composition
        // This is preserved throughout the transformation (bones, organs, water, etc.)
        const initialLeanMass = initial.weight * (1 - initial.fatPct / 100);
        const calculatedOtherLean = initialLeanMass - initial.muscleKg;
        
        // Clamp to physiologically reasonable range (2-10 kg)
        const otherLeanTissue = Math.max(2, Math.min(10, calculatedOtherLean));
        
        console.log('📊 Initial composition analysis:', {
            weight: initial.weight,
            fatPct: initial.fatPct,
            muscleKg: initial.muscleKg,
            leanMass: Math.round(initialLeanMass * 100) / 100,
            otherLeanTissue: Math.round(otherLeanTissue * 100) / 100,
            adjusted: Math.abs(calculatedOtherLean - otherLeanTissue) > 0.5
        });
        
        // Store for use in phase calculations
        this._otherLeanTissue = otherLeanTissue;
        
        // Recalculate target weight with correct formula
        const correctTargetWeight = Calculations.calculateTargetWeight(
            target.muscleKg, 
            target.fatPct, 
            initial
        );
        
        // Update target weight if recalculation is valid and different
        if (correctTargetWeight && Math.abs(correctTargetWeight - target.weight) > 0.5) {
            console.log('📐 Target weight recalculated:', {
                original: target.weight,
                corrected: correctTargetWeight
            });
            target.weight = correctTargetWeight;
        }
        
        // Calculate phase plan
        const phasePlan = Calculations.calculatePhaseDurations(initial, target, profile);

        // Generate phases with dates
        const phases = this.generatePhases(phasePlan, startDate, initial, target, profile, otherLeanTissue);

        // Build refeed schedule (cut phases only)
        const refeedSchedule = Calculations.getRefeedSchedule(phases);
        console.log(`🔄 Generated ${refeedSchedule.length} refeed/diet-break days`);

        // Generate daily data
        const dailyData = this.generateDailyData(phases, initial, target, profile, startDate, refeedSchedule);
        
        // Generate weekly aggregations
        const weeklyData = this.generateWeeklyData(dailyData, phases);
        
        // Generate monthly aggregations
        const monthlyData = this.generateMonthlyData(dailyData, phases);
        
        // Create metadata
        const metadata = this.generateMetadata(userProfile, phasePlan, phases);
        metadata.version = '4.0'; // Mark version so app.js can detect stale data

        // Generate dynamic milestones based on user profile and phases
        const milestones = this.generateMilestones(userProfile, phases);

        console.log(`✅ Generated ${milestones.length} dynamic milestones`);

        return {
            daily: dailyData,
            weekly: weeklyData,
            monthly: monthlyData,
            phases,
            metadata,
            milestones,
            refeedSchedule
        };
    },
    
    /**
     * Generate phase definitions with calculated dates and targets
     * FIXED: Uses otherLeanTissue instead of incorrect 0.48 ratio
     */
    generatePhases(phasePlan, startDate, initial, target, profile, otherLeanTissue) {
        const phases = [];
        let currentDate = new Date(startDate);
        let dayCounter = 1;
        
        // Calculate progressive targets for each phase
        let currentWeight = initial.weight;
        let currentFatPct = initial.fatPct;
        let currentMuscleKg = initial.muscleKg;
        
        const totalFatToLose = (initial.weight * initial.fatPct / 100) - (target.weight * target.fatPct / 100);
        const totalMuscleToGain = target.muscleKg - initial.muscleKg;
        
        phasePlan.phases.forEach((phase, index) => {
            const phaseStartDate = new Date(currentDate);
            const phaseEndDate = new Date(currentDate);
            phaseEndDate.setDate(phaseEndDate.getDate() + phase.days - 1);
            
            // Calculate end-of-phase targets
            let endWeight, endFatPct, endMuscleKg;
            
            switch (phase.type) {
                case 'adaptation':
                    // Minimal changes during adaptation
                    endWeight = currentWeight - 0.5;
                    endFatPct = currentFatPct - 0.3;
                    endMuscleKg = currentMuscleKg + phase.expectedMuscleGain;
                    break;
                    
                case 'recomposition':
                    endFatPct = currentFatPct - (phase.expectedFatLoss / currentWeight * 100);
                    endMuscleKg = currentMuscleKg + phase.expectedMuscleGain;
                    // FIXED: Use otherLeanTissue instead of dividing by 0.48
                    const recompLeanMass = endMuscleKg + otherLeanTissue;
                    endWeight = recompLeanMass / (1 - endFatPct / 100);
                    break;
                    
                case 'cut':
                    const fatLossKg = phase.expectedFatLoss;
                    endWeight = currentWeight - fatLossKg;
                    endFatPct = ((currentWeight * currentFatPct / 100 - fatLossKg) / endWeight) * 100;
                    endMuscleKg = currentMuscleKg * 0.98; // Small muscle loss during cut
                    break;
                    
                case 'bulk':
                    endMuscleKg = currentMuscleKg + phase.expectedMuscleGain;
                    const fatGain = phase.expectedMuscleGain * 0.3; // Some fat gain with muscle
                    // FIXED: Calculate weight using otherLeanTissue
                    const bulkLeanMass = endMuscleKg + otherLeanTissue;
                    const currentFatKg = currentWeight * currentFatPct / 100;
                    const endFatKg = currentFatKg + fatGain;
                    endWeight = bulkLeanMass + endFatKg;
                    endFatPct = (endFatKg / endWeight) * 100;
                    break;
                    
                case 'transition':
                    // Transition towards target
                    const transitionProgress = 0.5;
                    endWeight = currentWeight + (target.weight - currentWeight) * transitionProgress;
                    endFatPct = currentFatPct + (target.fatPct - currentFatPct) * transitionProgress;
                    endMuscleKg = currentMuscleKg + (target.muscleKg - currentMuscleKg) * transitionProgress;
                    break;
                    
                case 'maintenance':
                    // ALWAYS end at exact target values
                    endWeight = target.weight;
                    endFatPct = target.fatPct;
                    endMuscleKg = target.muscleKg;
                    break;
                    
                default:
                    endWeight = currentWeight;
                    endFatPct = currentFatPct;
                    endMuscleKg = currentMuscleKg;
            }
            
            // Validate calculated values
            if (endWeight < 40 || endWeight > 200) {
                console.warn(`⚠️ Phase ${phase.name}: Calculated endWeight (${endWeight.toFixed(1)}kg) out of range, capping`);
                endWeight = Math.max(40, Math.min(200, endWeight));
            }
            
            if (endFatPct < 5 || endFatPct > 50) {
                console.warn(`⚠️ Phase ${phase.name}: Calculated endFatPct (${endFatPct.toFixed(1)}%) out of range, capping`);
                endFatPct = Math.max(5, Math.min(50, endFatPct));
            }
            
            // Calculate calories for this phase
            const bmr = Calculations.calculateBMR(currentWeight, profile.height, profile.age, profile.sex);
            const tdee = Calculations.calculateTDEE(bmr, profile.activityLevel || 'moderate');
            const caloricTarget = Calculations.calculateCaloricTarget(tdee, phase.type);
            
            phases.push({
                id: index + 1,
                name: phase.name,
                type: phase.type,
                description: phase.description,
                startDay: dayCounter,
                endDay: dayCounter + phase.days - 1,
                days: phase.days,
                totalWeeks: Math.ceil(phase.days / 7),
                startDate: phaseStartDate.toISOString().split('T')[0],
                endDate: phaseEndDate.toISOString().split('T')[0],
                startComposition: {
                    weight: Math.round(currentWeight * 10) / 10,
                    fatPct: Math.round(currentFatPct * 10) / 10,
                    muscleKg: Math.round(currentMuscleKg * 10) / 10
                },
                endComposition: {
                    weight: Math.round(endWeight * 10) / 10,
                    fatPct: Math.round(endFatPct * 10) / 10,
                    muscleKg: Math.round(endMuscleKg * 10) / 10
                },
                totalChange: {
                    weight: Math.round((endWeight - currentWeight) * 10) / 10,
                    fatKg: Math.round((endWeight * endFatPct / 100 - currentWeight * currentFatPct / 100) * 10) / 10,
                    muscleKg: Math.round((endMuscleKg - currentMuscleKg) * 10) / 10
                },
                dailyCalories: caloricTarget.target,
                neatTarget: phase.type === 'cut' ? 10000 : 8000,
                expectedFatLoss: phase.expectedFatLoss,
                expectedMuscleGain: phase.expectedMuscleGain
            });
            
            // Update for next phase
            currentDate.setDate(currentDate.getDate() + phase.days);
            dayCounter += phase.days;
            currentWeight = endWeight;
            currentFatPct = endFatPct;
            currentMuscleKg = endMuscleKg;
        });
        
        return phases;
    },
    
    /**
     * Generate daily data points for the entire transformation.
     *
     * v4.0 changes:
     * - Non-linear interpolation curves per phase type
     * - Plateau water-retention model during cut phases
     * - Refeed / diet-break caloric and water adjustments
     * - Menstrual cycle offset (via Calculations.addDailyFluctuation sex param)
     *
     * @param {Array}  phases          - Phase definitions
     * @param {object} initial         - Initial composition
     * @param {object} target          - Target composition
     * @param {object} profile         - User profile (including sex)
     * @param {string} startDate       - ISO date string
     * @param {Array}  refeedSchedule  - Output of Calculations.getRefeedSchedule
     */
    generateDailyData(phases, initial, target, profile, startDate, refeedSchedule = []) {
        const dailyData = [];
        const start = new Date(startDate);
        const sex = profile.sex || 'male';

        // Build a quick lookup map: globalDay → refeed entry
        const refeedMap = {};
        refeedSchedule.forEach(r => { refeedMap[r.day] = r; });

        phases.forEach(phase => {
            const daysInPhase = phase.days;

            // Choose interpolation curves per phase type
            const weightCurve  = (phase.type === 'cut' || phase.type === 'recomposition') ? 'logarithmic' : 'easeInOut';
            const muscleCurve  = phase.type === 'bulk' ? 'sigmoid' : 'easeInOut';
            const fatPctCurve  = (phase.type === 'cut') ? 'logarithmic' : 'easeInOut';

            for (let dayInPhase = 1; dayInPhase <= daysInPhase; dayInPhase++) {
                const globalDay = phase.startDay + dayInPhase - 1;
                const currentDate = new Date(start);
                currentDate.setDate(currentDate.getDate() + globalDay - 1);

                // Progress within phase [0, 1] — avoid 0 exactly on first day
                const phaseProgress = dayInPhase / daysInPhase;

                // Overall progress [0, 100]
                const overallProgress = (globalDay / phases[phases.length - 1].endDay) * 100;

                // --- Non-linear interpolation ---
                const weight   = Calculations.interpolateCurved(
                    phase.startComposition.weight,
                    phase.endComposition.weight,
                    phaseProgress,
                    weightCurve
                );
                const fatPct   = Calculations.interpolateCurved(
                    phase.startComposition.fatPct,
                    phase.endComposition.fatPct,
                    phaseProgress,
                    fatPctCurve
                );
                const muscleKg = Calculations.interpolateCurved(
                    phase.startComposition.muscleKg,
                    phase.endComposition.muscleKg,
                    phaseProgress,
                    muscleCurve
                );

                // --- Plateau water offset ---
                const plateau = Calculations.calculatePlateauEffect(dayInPhase, phase.type);

                // --- Refeed / diet-break ---
                const refeed = refeedMap[globalDay];
                const refeedWater   = refeed ? refeed.waterGainKg : 0;
                const refeedCalMult = refeed ? refeed.calorieMultiplier : 1.0;

                // --- Daily fluctuation (deterministic, sex-aware) ---
                const displayWeight = Calculations.addDailyFluctuation(
                    weight + plateau.waterOffset + refeedWater,
                    globalDay,
                    sex
                );

                const fatKg     = displayWeight * (fatPct / 100);
                const leanMassKg = displayWeight - fatKg;

                // --- Performance metrics ---
                const performance = Calculations.calculatePerformanceMetrics(
                    globalDay,
                    { muscleKg, fatPct },
                    phase.type,
                    initial
                );

                // --- Wellbeing metrics ---
                const weekInPhase = Math.ceil(dayInPhase / 7);
                const wellbeing   = Calculations.calculateWellbeingMetrics(
                    globalDay,
                    phase.type,
                    overallProgress,
                    weekInPhase
                );

                // Boost energy/mood on refeed days
                if (refeed) {
                    wellbeing.energy        = Math.min(10, wellbeing.energy + 1.2);
                    wellbeing.generalFeeling = Math.min(10, wellbeing.generalFeeling + 0.8);
                }

                const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
                const dayOfWeek = dayNames[currentDate.getDay()];
                const prevDay   = dailyData[dailyData.length - 1];

                // Adjusted calories for refeed days
                const targetCalories = Math.round(phase.dailyCalories * refeedCalMult);

                dailyData.push({
                    day: globalDay,
                    date: currentDate.toISOString().split('T')[0],
                    dateFormatted: currentDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }),
                    dayOfWeek,
                    phase: phase.name,
                    phaseType: phase.type,
                    dayInPhase,
                    weekInPhase,
                    week: Math.ceil(globalDay / 7),
                    // Refeed metadata
                    isRefeedDay:  !!refeed,
                    refeedType:   refeed ? refeed.type : null,
                    refeedLabel:  refeed ? refeed.label : null,
                    // Plateau metadata
                    isPlateauDay: plateau.active,
                    physical: {
                        weight:     Math.round(displayWeight * 100) / 100,
                        fatPct:     Math.round(fatPct  * 100) / 100,
                        fatKg:      Math.round(fatKg   * 100) / 100,
                        muscleKg:   Math.round(muscleKg * 100) / 100,
                        leanMassKg: Math.round(leanMassKg * 100) / 100
                    },
                    performance,
                    wellbeing,
                    dailyChange: prevDay ? {
                        weight:   Math.round((displayWeight - prevDay.physical.weight) * 100) / 100,
                        fatKg:    Math.round((fatKg - prevDay.physical.fatKg) * 100) / 100,
                        muscleKg: Math.round((muscleKg - prevDay.physical.muscleKg) * 100) / 100
                    } : { weight: 0, fatKg: 0, muscleKg: 0 },
                    cumulativeChange: {
                        weight:   Math.round((displayWeight - initial.weight) * 100) / 100,
                        fatKg:    Math.round((fatKg - initial.weight * initial.fatPct / 100) * 100) / 100,
                        muscleKg: Math.round((muscleKg - initial.muscleKg) * 100) / 100
                    },
                    nutrition: {
                        targetCalories,
                        targetProtein: Math.round(displayWeight * (phase.type === 'cut' ? 2.2 : 1.8))
                    }
                });
            }
        });

        return dailyData;
    },
    
    /**
     * Generate weekly aggregated data
     */
    generateWeeklyData(dailyData, phases) {
        const weeklyData = [];
        const totalWeeks = Math.ceil(dailyData.length / 7);
        
        for (let week = 1; week <= totalWeeks; week++) {
            const weekStart = (week - 1) * 7;
            const weekEnd = Math.min(week * 7, dailyData.length);
            const weekDays = dailyData.slice(weekStart, weekEnd);
            
            if (weekDays.length === 0) continue;
            
            const firstDay = weekDays[0];
            const lastDay = weekDays[weekDays.length - 1];
            
            // Calculate averages
            const avgWeight = weekDays.reduce((sum, d) => sum + d.physical.weight, 0) / weekDays.length;
            const avgFatPct = weekDays.reduce((sum, d) => sum + d.physical.fatPct, 0) / weekDays.length;
            const avgMuscleKg = weekDays.reduce((sum, d) => sum + d.physical.muscleKg, 0) / weekDays.length;
            
            const avgStrength = weekDays.reduce((sum, d) => sum + d.performance.strength, 0) / weekDays.length;
            const avgEnergy = weekDays.reduce((sum, d) => sum + d.wellbeing.energy, 0) / weekDays.length;
            
            // Get phase info
            const phase = phases.find(p => firstDay.day >= p.startDay && firstDay.day <= p.endDay);
            
            // Previous week for change calculation
            const prevWeek = weeklyData[weeklyData.length - 1];
            
            weeklyData.push({
                week,
                startDay: firstDay.day,
                endDay: lastDay.day,
                startDate: firstDay.date,
                endDate: lastDay.date,
                startDateFormatted: firstDay.dateFormatted,
                endDateFormatted: lastDay.dateFormatted,
                phase: phase?.name || firstDay.phase,
                phaseType: phase?.type || firstDay.phaseType,
                weeklyAverages: {
                    physical: {
                        weight: Math.round(avgWeight * 100) / 100,
                        fatPct: Math.round(avgFatPct * 100) / 100,
                        muscleKg: Math.round(avgMuscleKg * 100) / 100
                    },
                    performance: {
                        strength: Math.round(avgStrength)
                    },
                    wellbeing: {
                        energy: Math.round(avgEnergy * 10) / 10
                    }
                },
                endOfWeek: {
                    physical: lastDay.physical,
                    performance: lastDay.performance,
                    wellbeing: lastDay.wellbeing
                },
                weeklyChange: prevWeek ? {
                    weight: Math.round((lastDay.physical.weight - prevWeek.endOfWeek.physical.weight) * 100) / 100,
                    fatKg: Math.round((lastDay.physical.fatKg - prevWeek.endOfWeek.physical.fatKg) * 100) / 100,
                    muscleKg: Math.round((lastDay.physical.muscleKg - prevWeek.endOfWeek.physical.muscleKg) * 100) / 100
                } : { weight: 0, fatKg: 0, muscleKg: 0 },
                range: {
                    weightMin: Math.min(...weekDays.map(d => d.physical.weight)),
                    weightMax: Math.max(...weekDays.map(d => d.physical.weight))
                }
            });
        }
        
        return weeklyData;
    },
    
    /**
     * Generate monthly aggregated data
     */
    generateMonthlyData(dailyData, phases) {
        const monthlyData = [];
        
        // Group by calendar month
        const monthGroups = {};
        dailyData.forEach(day => {
            const monthKey = day.date.substring(0, 7); // YYYY-MM
            if (!monthGroups[monthKey]) {
                monthGroups[monthKey] = [];
            }
            monthGroups[monthKey].push(day);
        });
        
        let monthNum = 1;
        Object.keys(monthGroups).sort().forEach(monthKey => {
            const monthDays = monthGroups[monthKey];
            const firstDay = monthDays[0];
            const lastDay = monthDays[monthDays.length - 1];
            
            // Calculate averages
            const avgWeight = monthDays.reduce((sum, d) => sum + d.physical.weight, 0) / monthDays.length;
            const avgFatPct = monthDays.reduce((sum, d) => sum + d.physical.fatPct, 0) / monthDays.length;
            const avgMuscleKg = monthDays.reduce((sum, d) => sum + d.physical.muscleKg, 0) / monthDays.length;
            
            // Get month name
            const monthDate = new Date(firstDay.date);
            const monthName = monthDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
            
            // Get dominant phase
            const phaseCount = {};
            monthDays.forEach(d => {
                phaseCount[d.phase] = (phaseCount[d.phase] || 0) + 1;
            });
            const dominantPhase = Object.keys(phaseCount).reduce((a, b) => 
                phaseCount[a] > phaseCount[b] ? a : b
            );
            
            // Previous month for change
            const prevMonth = monthlyData[monthlyData.length - 1];
            
            monthlyData.push({
                month: monthNum++,
                monthKey,
                monthName: monthName.charAt(0).toUpperCase() + monthName.slice(1),
                startDate: firstDay.date,
                endDate: lastDay.date,
                daysInMonth: monthDays.length,
                phase: dominantPhase,
                phaseType: firstDay.phaseType,
                monthlyAverages: {
                    physical: {
                        weight: Math.round(avgWeight * 100) / 100,
                        fatPct: Math.round(avgFatPct * 100) / 100,
                        muscleKg: Math.round(avgMuscleKg * 100) / 100
                    }
                },
                endOfMonth: {
                    physical: lastDay.physical,
                    performance: lastDay.performance,
                    wellbeing: lastDay.wellbeing
                },
                monthlyChange: prevMonth ? {
                    weight: Math.round((lastDay.physical.weight - prevMonth.endOfMonth.physical.weight) * 100) / 100,
                    fatKg: Math.round((lastDay.physical.fatKg - prevMonth.endOfMonth.physical.fatKg) * 100) / 100,
                    muscleKg: Math.round((lastDay.physical.muscleKg - prevMonth.endOfMonth.physical.muscleKg) * 100) / 100
                } : { weight: 0, fatKg: 0, muscleKg: 0 }
            });
        });
        
        return monthlyData;
    },
    
    /**
     * Generate metadata for the transformation
     * Includes BMR/TDEE calculations using all profile data
     */
    generateMetadata(userProfile, phasePlan, phases) {
        const { initial, target, profile, startDate } = userProfile;
        
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + phasePlan.totalDays - 1);
        
        // Calculate metabolic data using profile (age, sex, height)
        const initialBMR = Calculations.calculateBMR(initial.weight, profile.height, profile.age, profile.sex);
        const targetBMR = Calculations.calculateBMR(target.weight, profile.height, profile.age, profile.sex);
        const activityLevel = profile.activityLevel || 'moderate';
        const initialTDEE = Calculations.calculateTDEE(initialBMR, activityLevel);
        const targetTDEE = Calculations.calculateTDEE(targetBMR, activityLevel);
        
        // Calculate muscle gain potential based on training status and sex
        const muscleGainRates = Calculations.calculateMonthlyMuscleGain(profile.trainingStatus, profile.sex);
        
        // Age-adjusted recovery factor (recovery slows with age)
        const ageRecoveryFactor = profile.age < 30 ? 1.0 : profile.age < 40 ? 0.95 : profile.age < 50 ? 0.85 : 0.75;
        
        return {
            version: '3.2',
            generatedAt: new Date().toISOString(),
            userProfile: {
                age: profile.age,
                sex: profile.sex,
                height: profile.height,
                trainingStatus: profile.trainingStatus,
                activityLevel: activityLevel,
                ageRecoveryFactor: ageRecoveryFactor
            },
            metabolicData: {
                initialBMR: Math.round(initialBMR),
                targetBMR: Math.round(targetBMR),
                initialTDEE: initialTDEE,
                targetTDEE: targetTDEE,
                muscleGainPotential: muscleGainRates
            },
            initialComposition: {
                weight: initial.weight,
                fatPct: initial.fatPct,
                fatKg: Math.round(initial.weight * initial.fatPct / 100 * 10) / 10,
                muscleKg: initial.muscleKg,
                leanMassKg: Math.round((initial.weight - initial.weight * initial.fatPct / 100) * 10) / 10,
                strength: 20,
                aesthetics: 3
            },
            targetComposition: {
                weight: target.weight,
                fatPct: target.fatPct,
                fatKg: Math.round(target.weight * target.fatPct / 100 * 10) / 10,
                muscleKg: target.muscleKg,
                leanMassKg: Math.round((target.weight - target.weight * target.fatPct / 100) * 10) / 10,
                strength: 80,
                aesthetics: 8
            },
            timeline: {
                startDate: startDate,
                endDate: endDate.toISOString().split('T')[0],
                totalDays: phasePlan.totalDays,
                totalWeeks: Math.ceil(phasePlan.totalDays / 7),
                totalMonths: Math.round(phasePlan.totalDays / 30 * 10) / 10
            },
            summary: phasePlan.summary,
            methodology: [
                'Mifflin-St Jeor para cálculo de metabolismo basal',
                'Modelo Aragon 2017 para pérdida de grasa',
                'Modelo McDonald 2008 / Helms 2014 para ganancia muscular',
                'Periodización por fases adaptativa',
                'Preservación de tejido magro constante (huesos, órganos)'
            ]
        };
    },
    
    /**
     * Linear interpolation helper
     */
    interpolate(start, end, progress) {
        return start + (end - start) * progress;
    },
    
    /**
     * Generate dynamic milestones based on user's journey
     * Uses profile data (age, sex, training status) for realistic expectations
     */
    generateMilestones(userProfile, phases) {
        const { initial, target, profile } = userProfile;
        const milestones = [];
        let milestoneId = 1;
        
        // Age-adjusted expectations (older = slower visible changes)
        const ageVisibilityFactor = profile.age < 30 ? 1.0 : profile.age < 40 ? 0.9 : profile.age < 50 ? 0.8 : 0.7;
        
        // Sex-adjusted fat visibility thresholds (women show definition at higher %)
        const fatVisibilityOffset = profile.sex === 'female' ? 6 : 0;
        
        // Fat loss milestones (every 2-3% reduction)
        const fatToLose = initial.fatPct - target.fatPct;
        if (fatToLose > 0) {
            const fatMilestoneCount = Math.floor(fatToLose / 2);
            for (let i = 1; i <= fatMilestoneCount; i++) {
                const triggerFatPct = initial.fatPct - (i * 2);
                const progressPct = (i * 2) / fatToLose * 100;
                
                milestones.push({
                    id: milestoneId++,
                    category: 'definition',
                    name: `${Math.round(triggerFatPct)}% grasa corporal`,
                    description: this.getFatMilestoneDescription(triggerFatPct),
                    triggerType: 'fatPct',
                    triggerValue: triggerFatPct,
                    progressRequired: progressPct,
                    visibility: progressPct < 30 ? 'subtle' : progressPct < 60 ? 'notable' : 'very_notable'
                });
            }
        }
        
        // Muscle gain milestones (every 1-2kg gain)
        const muscleToGain = target.muscleKg - initial.muscleKg;
        if (muscleToGain > 0) {
            const muscleMilestoneCount = Math.floor(muscleToGain / 1.5);
            for (let i = 1; i <= muscleMilestoneCount; i++) {
                const triggerMuscleKg = initial.muscleKg + (i * 1.5);
                const progressPct = (i * 1.5) / muscleToGain * 100;
                
                milestones.push({
                    id: milestoneId++,
                    category: 'size',
                    name: `${Math.round(triggerMuscleKg * 10) / 10}kg masa muscular`,
                    description: this.getMuscleMilestoneDescription(triggerMuscleKg, initial.muscleKg),
                    triggerType: 'muscleKg',
                    triggerValue: triggerMuscleKg,
                    progressRequired: progressPct,
                    visibility: progressPct < 30 ? 'subtle' : progressPct < 60 ? 'notable' : 'very_notable'
                });
            }
        }
        
        // Phase completion milestones
        phases.forEach((phase, index) => {
            if (phase.type !== 'maintenance') {
                milestones.push({
                    id: milestoneId++,
                    category: 'phase',
                    name: `Fase completada: ${phase.name}`,
                    description: `Has completado la fase de ${phase.name.toLowerCase()} exitosamente`,
                    triggerType: 'day',
                    triggerValue: phase.endDay,
                    progressRequired: (phase.endDay / phases[phases.length - 1].endDay) * 100,
                    visibility: 'notable'
                });
            }
        });
        
        // Aesthetic milestones based on body part categories
        // Thresholds adjusted for sex (women show definition at higher fat %)
        const aestheticCategories = [
            { id: 'abs', name: 'Abdominales', fatThresholds: [20, 15, 12, 10].map(t => t + fatVisibilityOffset) },
            { id: 'vascularity', name: 'Vascularidad', fatThresholds: [18, 14, 11].map(t => t + fatVisibilityOffset) },
            { id: 'face', name: 'Definición facial', fatThresholds: [22, 18, 14].map(t => t + fatVisibilityOffset) },
            { id: 'arms', name: 'Definición brazos', fatThresholds: [20, 16, 12].map(t => t + fatVisibilityOffset) }
        ];
        
        aestheticCategories.forEach(cat => {
            cat.fatThresholds.forEach((threshold, i) => {
                if (initial.fatPct > threshold && target.fatPct <= threshold) {
                    milestones.push({
                        id: milestoneId++,
                        category: cat.id,
                        name: this.getAestheticMilestoneName(cat.name, i, profile.sex),
                        description: this.getAestheticDescription(cat.id, threshold - fatVisibilityOffset, profile.sex),
                        triggerType: 'fatPct',
                        triggerValue: threshold,
                        visibility: i === 0 ? 'subtle' : i === 1 ? 'notable' : 'very_notable',
                        sexAdjusted: profile.sex === 'female'
                    });
                }
            });
        });
        
        // Sort by progress required
        milestones.sort((a, b) => (a.progressRequired || 0) - (b.progressRequired || 0));
        
        // Assign estimated days
        const totalDays = phases[phases.length - 1].endDay;
        milestones.forEach(m => {
            if (m.triggerType === 'fatPct' || m.triggerType === 'muscleKg') {
                m.estimatedDay = Math.round((m.progressRequired / 100) * totalDays);
            } else if (m.triggerType === 'day') {
                m.estimatedDay = m.triggerValue;
            }
        });
        
        return milestones;
    },
    
    getFatMilestoneDescription(fatPct) {
        if (fatPct >= 20) return 'Inicio de definición visible en el torso';
        if (fatPct >= 15) return 'Abdominales superiores visibles, definición notable';
        if (fatPct >= 12) return 'Six-pack visible, vascularidad en brazos';
        if (fatPct >= 10) return 'Definición atlética completa, separación muscular clara';
        return 'Definición de competición, vascularidad extrema';
    },
    
    getMuscleMilestoneDescription(currentKg, initialKg) {
        const gained = currentKg - initialKg;
        if (gained < 2) return 'Primeras ganancias musculares perceptibles';
        if (gained < 4) return 'Incremento notable en tamaño y fuerza';
        if (gained < 6) return 'Desarrollo muscular significativo';
        return 'Transformación muscular avanzada';
    },
    
    getAestheticMilestoneName(category, level, sex = 'male') {
        const levels = ['Inicial', 'Notable', 'Avanzado', 'Elite'];
        return `${category}: ${levels[level]}`;
    },
    
    getAestheticDescription(category, fatPct, sex = 'male') {
        const descriptions = {
            abs: {
                20: sex === 'female' ? 'Contorno abdominal visible, cintura definida' : 'Contorno abdominal visible',
                15: sex === 'female' ? 'Línea vertical abdominal, oblicuos marcados' : 'Línea alba y abdominales superiores definidos',
                12: sex === 'female' ? 'Abdominales definidos, core atlético' : 'Six-pack completo con separación',
                10: sex === 'female' ? 'Definición abdominal de fitness' : 'Abdominales detallados y vascularizados'
            },
            vascularity: {
                18: 'Venas visibles en antebrazos',
                14: sex === 'female' ? 'Venas sutiles en brazos' : 'Vascularidad en bíceps y deltoides',
                11: sex === 'female' ? 'Vascularidad atlética visible' : 'Red venosa completa en brazos y hombros'
            },
            face: {
                22: 'Mandíbula más definida',
                18: 'Pómulos y estructura ósea visibles',
                14: 'Definición facial completa'
            },
            arms: {
                20: sex === 'female' ? 'Tonificación visible en brazos' : 'Separación bíceps/tríceps visible',
                16: sex === 'female' ? 'Definición muscular en brazos' : 'Estriaciones en tríceps',
                12: sex === 'female' ? 'Brazos tonificados y definidos' : 'Definición completa con vascularidad'
            }
        };
        
        return descriptions[category]?.[fatPct] || 'Progreso estético notable';
    }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.DataGenerator = DataGenerator;
}

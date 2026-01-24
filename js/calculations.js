// ============================================
// TRANSFORMLAB - Scientific Calculations Engine
// Based on peer-reviewed research
// v3.1 - Fixed target weight calculation bug
// ============================================

/**
 * Scientific calculation engine for body composition tracking
 * 
 * References:
 * - Mifflin-St Jeor (1990): BMR calculation
 * - Aragon (2017): Safe fat loss rates
 * - McDonald (2008): Muscle gain expectations
 * - Helms (2014): Advanced trainee muscle gain
 * - Trexler (2014): Energy availability and hormonal effects
 */

const Calculations = {
    
    // ============================================
    // CONSTANTS
    // ============================================
    
    // Activity multipliers for TDEE
    ACTIVITY_MULTIPLIERS: {
        sedentary: 1.2,      // Little/no exercise
        light: 1.375,        // Light exercise 1-3 days/week
        moderate: 1.55,      // Moderate exercise 3-5 days/week
        active: 1.725,       // Hard exercise 6-7 days/week
        veryActive: 1.9      // Very hard exercise, physical job
    },
    
    // Muscle gain rates by training status (kg/month) - McDonald 2008, Helms 2014
    MUSCLE_GAIN_RATES: {
        beginner: { min: 0.9, max: 1.4, avg: 1.15 },      // Year 1
        intermediate: { min: 0.45, max: 0.9, avg: 0.675 }, // Year 2-3
        advanced: { min: 0.2, max: 0.45, avg: 0.325 }      // Year 4+
    },
    
    // Safe fat loss rates (% of body weight per week) - Aragon 2017
    FAT_LOSS_RATES: {
        conservative: 0.005,  // 0.5% BW/week - optimal for muscle preservation
        moderate: 0.0075,     // 0.75% BW/week - balanced approach
        aggressive: 0.01      // 1% BW/week - faster but higher muscle loss risk
    },
    
    // Essential body fat percentages
    ESSENTIAL_FAT: {
        male: 3,
        female: 12
    },
    
    // Safe minimum body fat percentages (for sustained periods)
    MIN_SAFE_FAT: {
        male: 8,
        female: 16
    },
    
    // Maximum safe body fat percentages
    MAX_FAT: {
        male: 40,
        female: 45
    },
    
    // ============================================
    // BMR CALCULATION (Mifflin-St Jeor)
    // ============================================
    
    /**
     * Calculate Basal Metabolic Rate using Mifflin-St Jeor equation
     * Most accurate for normal to overweight individuals
     * 
     * @param {number} weight - Body weight in kg
     * @param {number} height - Height in cm
     * @param {number} age - Age in years
     * @param {string} sex - 'male' or 'female'
     * @returns {number} BMR in kcal/day
     */
    calculateBMR(weight, height, age, sex) {
        const base = (10 * weight) + (6.25 * height) - (5 * age);
        return sex === 'male' ? base + 5 : base - 161;
    },
    
    /**
     * Calculate Total Daily Energy Expenditure
     * 
     * @param {number} bmr - Basal Metabolic Rate
     * @param {string} activityLevel - Activity level key
     * @returns {number} TDEE in kcal/day
     */
    calculateTDEE(bmr, activityLevel = 'moderate') {
        const multiplier = this.ACTIVITY_MULTIPLIERS[activityLevel] || 1.55;
        return Math.round(bmr * multiplier);
    },
    
    /**
     * Calculate caloric target based on goal
     * 
     * @param {number} tdee - Total Daily Energy Expenditure
     * @param {string} goal - 'cut', 'bulk', 'recomp', 'maintain'
     * @param {number} deficitPercent - Deficit/surplus percentage (0-25)
     * @returns {object} Caloric target and deficit/surplus
     */
    calculateCaloricTarget(tdee, goal, deficitPercent = 20) {
        let target, deficit;
        
        switch (goal) {
            case 'cut':
                deficit = Math.round(tdee * (deficitPercent / 100));
                deficit = Math.min(deficit, 1000); // Max 1000 kcal deficit for safety
                target = tdee - deficit;
                break;
            case 'bulk':
                deficit = -Math.round(tdee * (Math.min(deficitPercent, 15) / 100));
                target = tdee - deficit;
                break;
            case 'recomp':
                deficit = Math.round(tdee * 0.05); // Small deficit for recomposition
                target = tdee - deficit;
                break;
            default: // maintain
                deficit = 0;
                target = tdee;
        }
        
        return { target, deficit, tdee };
    },
    
    // ============================================
    // BODY COMPOSITION CALCULATIONS
    // ============================================
    
    /**
     * Calculate body composition metrics
     * 
     * @param {number} weight - Body weight in kg
     * @param {number} fatPct - Body fat percentage
     * @param {number} [measuredMuscleKg] - Optional: measured muscle mass (DEXA/bioimpedance)
     * @returns {object} Composition breakdown
     */
    calculateComposition(weight, fatPct, measuredMuscleKg = null) {
        const fatKg = weight * (fatPct / 100);
        const leanMassKg = weight - fatKg;
        
        // Use measured muscle if provided, otherwise estimate as ~48% of lean mass
        const muscleKg = measuredMuscleKg !== null 
            ? measuredMuscleKg 
            : leanMassKg * 0.48;
        
        // Calculate "other lean tissue" (bones, organs, water, etc.)
        const otherLeanTissueKg = leanMassKg - muscleKg;
        
        return {
            weight,
            fatPct,
            fatKg: Math.round(fatKg * 100) / 100,
            leanMassKg: Math.round(leanMassKg * 100) / 100,
            muscleKg: Math.round(muscleKg * 100) / 100,
            otherLeanTissueKg: Math.round(otherLeanTissueKg * 100) / 100
        };
    },
    
    /**
     * Calculate target weight from composition goals
     * 
     * FIXED: Now correctly handles measured muscle mass by preserving
     * the "other lean tissue" (bones, organs, water) from current composition.
     * 
     * @param {number} targetMuscleKg - Target muscle mass
     * @param {number} targetFatPct - Target body fat percentage
     * @param {object} [currentComposition] - Current composition with measured muscle
     * @returns {number} Estimated target weight
     */
    calculateTargetWeight(targetMuscleKg, targetFatPct, currentComposition = null) {
        // Validate inputs
        if (!targetMuscleKg || targetMuscleKg < 20 || !targetFatPct || targetFatPct < 5) {
            return null; // Return null for incomplete data
        }
        
        let targetLeanMass;
        let otherLeanTissue = 5; // Default: typical value for bones, organs, etc.
        
        // If we have current composition with measured muscle, preserve other lean tissue
        if (currentComposition && currentComposition.muscleKg && currentComposition.weight && currentComposition.fatPct) {
            const currentLeanMass = currentComposition.weight * (1 - currentComposition.fatPct / 100);
            const calculatedOtherLean = currentLeanMass - currentComposition.muscleKg;
            
            // Clamp otherLeanTissue to physiologically reasonable range (2-10 kg)
            // Bones alone are 3-5 kg, organs add another 3-5 kg
            // If calculated value is outside this range, user's data may be inconsistent
            otherLeanTissue = Math.max(2, Math.min(10, calculatedOtherLean));
            
            if (Math.abs(calculatedOtherLean - otherLeanTissue) > 1) {
                console.warn('⚠️ Other lean tissue adjusted from', calculatedOtherLean.toFixed(2), 'to', otherLeanTissue, 'kg (data may be inconsistent)');
            }
            
            targetLeanMass = targetMuscleKg + otherLeanTissue;
        } else {
            // Fallback: estimate using typical ratio (muscle ≈ 48% of lean mass)
            targetLeanMass = targetMuscleKg / 0.48;
        }
        
        // Calculate target weight: weight = lean mass / (1 - fatPct/100)
        const targetWeight = targetLeanMass / (1 - targetFatPct / 100);
        
        // Validate result is reasonable (40-150 kg)
        if (targetWeight < 40 || targetWeight > 150) {
            console.warn('⚠️ Target weight outside reasonable range:', targetWeight);
            return null;
        }
        
        return Math.round(targetWeight * 10) / 10;
    },
    
    /**
     * Calculate muscle mass from weight and fat percentage (estimation)
     * 
     * @param {number} weight - Body weight in kg
     * @param {number} fatPct - Body fat percentage
     * @returns {number} Estimated muscle mass in kg
     */
    estimateMuscleFromComposition(weight, fatPct) {
        const leanMass = weight * (1 - fatPct / 100);
        return Math.round(leanMass * 0.48 * 10) / 10;
    },
    
    /**
     * Calculate weight for a given muscle and fat target, preserving other lean tissue
     * Helper function for phase calculations
     * 
     * @param {number} muscleKg - Target muscle mass
     * @param {number} fatPct - Target body fat percentage  
     * @param {number} otherLeanTissue - Constant other lean tissue (bones, organs, etc.)
     * @returns {number} Calculated weight
     */
    calculateWeightFromComposition(muscleKg, fatPct, otherLeanTissue) {
        const leanMass = muscleKg + otherLeanTissue;
        return leanMass / (1 - fatPct / 100);
    },
    
    // ============================================
    // RATE CALCULATIONS
    // ============================================
    
    /**
     * Calculate safe weekly fat loss rate
     * 
     * @param {number} currentWeight - Current body weight in kg
     * @param {string} intensity - 'conservative', 'moderate', 'aggressive'
     * @returns {object} Weekly loss rates
     */
    calculateWeeklyFatLoss(currentWeight, intensity = 'moderate') {
        const rate = this.FAT_LOSS_RATES[intensity];
        const weeklyLossKg = currentWeight * rate;
        
        return {
            weeklyKg: Math.round(weeklyLossKg * 100) / 100,
            dailyKg: Math.round((weeklyLossKg / 7) * 1000) / 1000,
            weeklyPctBW: rate * 100
        };
    },
    
    /**
     * Calculate expected monthly muscle gain
     * 
     * @param {string} trainingStatus - 'beginner', 'intermediate', 'advanced'
     * @param {string} sex - 'male' or 'female'
     * @returns {object} Monthly gain rates
     */
    calculateMonthlyMuscleGain(trainingStatus = 'intermediate', sex = 'male') {
        const rates = this.MUSCLE_GAIN_RATES[trainingStatus] || this.MUSCLE_GAIN_RATES.intermediate;
        const sexMultiplier = sex === 'female' ? 0.5 : 1;
        
        return {
            minKg: Math.round(rates.min * sexMultiplier * 100) / 100,
            maxKg: Math.round(rates.max * sexMultiplier * 100) / 100,
            avgKg: Math.round(rates.avg * sexMultiplier * 100) / 100
        };
    },
    
    // ============================================
    // PHASE CALCULATIONS
    // ============================================
    
    /**
     * Calculate phase durations and sequence
     * 
     * @param {object} initial - Initial composition {weight, fatPct, muscleKg}
     * @param {object} target - Target composition {fatPct, muscleKg}
     * @param {object} profile - User profile {trainingStatus, sex, age}
     * @returns {object} Phase plan with durations and expectations
     */
    calculatePhaseDurations(initial, target, profile) {
        const { trainingStatus = 'intermediate', sex = 'male' } = profile;
        
        // Calculate what needs to change
        const fatToLose = (initial.weight * initial.fatPct / 100) - (target.weight * target.fatPct / 100);
        const muscleToGain = target.muscleKg - initial.muscleKg;
        
        const phases = [];
        let totalDays = 0;
        
        // Phase 1: Adaptation (always)
        phases.push({
            name: 'Adaptación',
            type: 'adaptation',
            days: 14,
            description: 'Adaptación al nuevo régimen de entrenamiento',
            expectedFatLoss: 0.3,
            expectedMuscleGain: 0.2
        });
        totalDays += 14;
        
        // Determine primary goal
        const needsCut = initial.fatPct > target.fatPct + 2;
        const needsBulk = target.muscleKg > initial.muscleKg + 1;
        
        if (needsCut && needsBulk) {
            // Recomposition phase if starting fat is moderate (15-25%)
            if (initial.fatPct >= 15 && initial.fatPct <= 25) {
                const recompDays = Math.min(90, Math.ceil(muscleToGain / 0.3) * 30);
                phases.push({
                    name: 'Recomposición',
                    type: 'recomposition',
                    days: recompDays,
                    description: 'Ganancia muscular con pérdida de grasa simultánea',
                    expectedFatLoss: recompDays / 30 * 1.5,
                    expectedMuscleGain: recompDays / 30 * 0.3
                });
                totalDays += recompDays;
            }
            
            // Cut phase
            const remainingFatToLose = Math.max(0, fatToLose - 2);
            if (remainingFatToLose > 0) {
                const fatLossRate = this.calculateWeeklyFatLoss(initial.weight, 'moderate');
                const cutWeeks = Math.ceil(remainingFatToLose / fatLossRate.weeklyKg);
                const cutDays = cutWeeks * 7;
                
                phases.push({
                    name: 'Definición',
                    type: 'cut',
                    days: cutDays,
                    description: 'Pérdida de grasa preservando masa muscular',
                    expectedFatLoss: remainingFatToLose,
                    expectedMuscleGain: -0.5 // Small muscle loss during cut
                });
                totalDays += cutDays;
            }
            
            // Bulk phase if muscle goal not met
            const muscleGainRates = this.calculateMonthlyMuscleGain(trainingStatus, sex);
            const remainingMuscleToGain = Math.max(0, muscleToGain - 0.5);
            if (remainingMuscleToGain > 0) {
                const bulkMonths = Math.ceil(remainingMuscleToGain / muscleGainRates.avgKg);
                const bulkDays = bulkMonths * 30;
                
                phases.push({
                    name: 'Volumen',
                    type: 'bulk',
                    days: bulkDays,
                    description: 'Ganancia de masa muscular con superávit controlado',
                    expectedFatLoss: -(bulkDays / 30 * 0.4), // Some fat gain
                    expectedMuscleGain: remainingMuscleToGain
                });
                totalDays += bulkDays;
            }
            
        } else if (needsCut) {
            // Pure cut
            const fatLossRate = this.calculateWeeklyFatLoss(initial.weight, 'moderate');
            const cutWeeks = Math.ceil(fatToLose / fatLossRate.weeklyKg);
            const cutDays = cutWeeks * 7;
            
            phases.push({
                name: 'Definición',
                type: 'cut',
                days: cutDays,
                description: 'Pérdida de grasa preservando masa muscular',
                expectedFatLoss: fatToLose,
                expectedMuscleGain: -(cutDays / 30 * 0.2)
            });
            totalDays += cutDays;
            
        } else if (needsBulk) {
            // Pure bulk
            const muscleGainRates = this.calculateMonthlyMuscleGain(trainingStatus, sex);
            const bulkMonths = Math.ceil(muscleToGain / muscleGainRates.avgKg);
            const bulkDays = bulkMonths * 30;
            
            phases.push({
                name: 'Volumen',
                type: 'bulk',
                days: bulkDays,
                description: 'Ganancia de masa muscular con superávit controlado',
                expectedFatLoss: -(bulkDays / 30 * 0.3),
                expectedMuscleGain: muscleToGain
            });
            totalDays += bulkDays;
        }
        
        // Transition phase
        phases.push({
            name: 'Transición',
            type: 'transition',
            days: 14,
            description: 'Estabilización y adaptación al nuevo estado',
            expectedFatLoss: 0,
            expectedMuscleGain: 0.1
        });
        totalDays += 14;
        
        // Maintenance phase
        phases.push({
            name: 'Mantenimiento',
            type: 'maintenance',
            days: 30,
            description: 'Consolidación de resultados',
            expectedFatLoss: 0,
            expectedMuscleGain: 0.1
        });
        totalDays += 30;
        
        return {
            phases,
            totalDays,
            summary: {
                fatToLose: Math.round(fatToLose * 10) / 10,
                muscleToGain: Math.round(muscleToGain * 10) / 10,
                estimatedWeeks: Math.ceil(totalDays / 7),
                estimatedMonths: Math.round(totalDays / 30 * 10) / 10
            }
        };
    },
    
    // ============================================
    // VALIDATION
    // ============================================
    
    /**
     * Validate user inputs for safety and feasibility
     * 
     * @param {object} initial - Initial composition
     * @param {object} target - Target composition
     * @param {object} profile - User profile
     * @returns {object} Validation result with errors/warnings
     */
    validateInputs(initial, target, profile) {
        const errors = [];
        const warnings = [];
        const { sex, age } = profile;
        
        // Body fat validation
        const minFat = this.MIN_SAFE_FAT[sex];
        const maxFat = this.MAX_FAT[sex];
        
        if (initial.fatPct < minFat || initial.fatPct > maxFat) {
            errors.push(`El % de grasa inicial debe estar entre ${minFat}% y ${maxFat}%`);
        }
        
        if (target.fatPct < minFat) {
            errors.push(`El % de grasa objetivo (${target.fatPct}%) es demasiado bajo. Mínimo seguro: ${minFat}%`);
        }
        
        if (target.fatPct > maxFat) {
            warnings.push(`El % de grasa objetivo (${target.fatPct}%) es muy alto`);
        }
        
        // Weight validation
        if (initial.weight < 40 || initial.weight > 200) {
            errors.push('El peso debe estar entre 40 y 200 kg');
        }
        
        // MUSCLE MASS VALIDATION - FIXED
        // Use the actual measured muscle as reference, not an estimate from weight
        const muscleGainNeeded = target.muscleKg - initial.muscleKg;
        
        // Calculate target weight first (needed for validation)
        const targetWeight = this.calculateTargetWeight(target.muscleKg, target.fatPct, initial);
        
        // Warn if losing significant muscle (might be unintentional)
        if (muscleGainNeeded < -5) {
            warnings.push(`Perder ${Math.abs(muscleGainNeeded).toFixed(1)}kg de músculo es significativo. ¿Es intencional?`);
        }
        
        // Warn if muscle gain is very ambitious (>15kg total is rare for naturals)
        if (muscleGainNeeded > 15) {
            warnings.push(`Ganar ${muscleGainNeeded.toFixed(1)}kg de músculo es muy ambicioso. Considera objetivos intermedios.`);
        }
        
        // Only error if muscle is physiologically impossible for TARGET weight
        // AND the increase is extreme (>30% more than current measured muscle)
        const maxMuscleForTargetWeight = targetWeight * 0.55;
        const muscleIncreasePercent = initial.muscleKg > 0 ? (target.muscleKg / initial.muscleKg - 1) * 100 : 0;
        
        if (target.muscleKg > maxMuscleForTargetWeight && muscleIncreasePercent > 30) {
            errors.push(`La masa muscular objetivo (${target.muscleKg}kg) es fisiológicamente improbable para un peso de ${targetWeight}kg`);
        } else if (muscleIncreasePercent > 20 && muscleGainNeeded > 3) {
            warnings.push(`Ganar ${muscleGainNeeded.toFixed(1)}kg de músculo (+${muscleIncreasePercent.toFixed(0)}%) requerirá tiempo y dedicación`);
        }
        if (targetWeight < 40 || targetWeight > 150) {
            warnings.push(`El peso objetivo calculado (${targetWeight}kg) parece inusual. Verifica tus datos.`);
        }
        
        // Timeline validation
        const phases = this.calculatePhaseDurations(initial, target, profile);
        if (phases.totalDays > 730) { // 2 years
            warnings.push('El plan supera 2 años. Considera objetivos intermedios más realistas.');
        }
        
        // Age-based warnings
        if (age > 50) {
            warnings.push('Las tasas de ganancia muscular pueden ser menores debido a la edad');
        }
        
        // Rate validation
        const fatLossNeeded = (initial.weight * initial.fatPct / 100) - (targetWeight * target.fatPct / 100);
        if (fatLossNeeded > 0) {
            const minWeeks = fatLossNeeded / (initial.weight * 0.01);
            if (phases.totalDays / 7 < minWeeks * 0.8) {
                errors.push('El timeline es demasiado agresivo para una pérdida de grasa segura');
            }
        }
        
        return {
            isValid: errors.length === 0,
            errors,
            warnings,
            phases,
            calculatedTargetWeight: targetWeight
        };
    },
    
    // ============================================
    // DAILY METRICS CALCULATIONS
    // ============================================
    
    /**
     * Calculate performance metrics based on composition and phase
     * 
     * @param {number} day - Current day number
     * @param {object} composition - Current body composition
     * @param {string} phaseType - Current phase type
     * @param {object} initial - Initial composition for reference
     * @returns {object} Performance metrics
     */
    calculatePerformanceMetrics(day, composition, phaseType, initial) {
        // Base strength increases with muscle mass and training adaptation
        const muscleGainPct = ((composition.muscleKg - initial.muscleKg) / initial.muscleKg) * 100;
        const adaptationBonus = Math.min(20, day * 0.1); // Neural adaptation
        
        let strengthModifier = 1;
        if (phaseType === 'cut') {
            strengthModifier = 0.95; // Slight strength loss during cut
        } else if (phaseType === 'bulk') {
            strengthModifier = 1.1; // Strength gains during bulk
        }
        
        const strength = Math.min(100, Math.round(
            (30 + adaptationBonus + muscleGainPct * 2) * strengthModifier
        ));
        
        // Agility improves with fat loss
        const fatLossPct = ((initial.fatPct - composition.fatPct) / initial.fatPct) * 100;
        const agility = Math.min(10, Math.round((4 + fatLossPct * 0.08) * 10) / 10);
        
        // Mobility improves gradually with training
        const mobility = Math.min(10, Math.round((4 + day * 0.01) * 10) / 10);
        
        return { strength, agility, mobility };
    },
    
    /**
     * Calculate wellbeing metrics based on phase and progress
     * 
     * @param {number} day - Current day number
     * @param {string} phaseType - Current phase type
     * @param {number} progressPct - Overall progress percentage
     * @param {number} weekInPhase - Week number within current phase
     * @returns {object} Wellbeing metrics
     */
    calculateWellbeingMetrics(day, phaseType, progressPct, weekInPhase) {
        let energy, mentalClarity, selfEsteem, sleepQuality, aesthetics, generalFeeling;
        
        // Base values that improve with progress
        const progressBonus = progressPct * 0.03;
        
        switch (phaseType) {
            case 'cut':
                // Energy dips during cut, especially weeks 2-4
                const cutFatigue = weekInPhase >= 2 && weekInPhase <= 4 ? -1.5 : -0.5;
                energy = Math.max(3, Math.min(10, 6 + cutFatigue + progressBonus));
                mentalClarity = Math.max(4, Math.min(10, 5 + progressBonus));
                selfEsteem = Math.min(10, 5 + progressBonus * 1.5); // Improves with visible results
                sleepQuality = Math.max(5, Math.min(10, 6 + progressBonus));
                aesthetics = Math.min(10, 4 + progressPct * 0.06); // Visible improvement
                generalFeeling = Math.max(4, Math.min(10, 5.5 + progressBonus));
                break;
                
            case 'bulk':
                energy = Math.min(10, 7 + progressBonus); // More energy with surplus
                mentalClarity = Math.min(10, 6 + progressBonus);
                selfEsteem = Math.min(10, 5 + progressBonus);
                sleepQuality = Math.min(10, 7 + progressBonus);
                aesthetics = Math.min(10, 5 + progressPct * 0.03); // Slower aesthetic gains
                generalFeeling = Math.min(10, 7 + progressBonus);
                break;
                
            case 'recomposition':
                energy = Math.min(10, 6 + progressBonus);
                mentalClarity = Math.min(10, 6 + progressBonus);
                selfEsteem = Math.min(10, 5 + progressBonus * 1.2);
                sleepQuality = Math.min(10, 6.5 + progressBonus);
                aesthetics = Math.min(10, 4.5 + progressPct * 0.05);
                generalFeeling = Math.min(10, 6 + progressBonus);
                break;
                
            default: // adaptation, maintenance, transition
                energy = Math.min(10, 6.5 + progressBonus);
                mentalClarity = Math.min(10, 6 + progressBonus);
                selfEsteem = Math.min(10, 5 + progressBonus);
                sleepQuality = Math.min(10, 7 + progressBonus);
                aesthetics = Math.min(10, 5 + progressPct * 0.04);
                generalFeeling = Math.min(10, 6.5 + progressBonus);
        }
        
        // Add small daily variation
        const variation = (Math.sin(day * 0.5) * 0.3);
        
        return {
            energy: Math.round((energy + variation) * 10) / 10,
            mentalClarity: Math.round((mentalClarity + variation * 0.5) * 10) / 10,
            selfEsteem: Math.round(selfEsteem * 10) / 10,
            sleepQuality: Math.round((sleepQuality + variation * 0.3) * 10) / 10,
            aesthetics: Math.round(aesthetics * 10) / 10,
            generalFeeling: Math.round((generalFeeling + variation * 0.4) * 10) / 10
        };
    },
    
    /**
     * Add realistic daily weight fluctuations
     * 
     * @param {number} baseWeight - Calculated base weight for the day
     * @param {number} day - Day number
     * @returns {number} Weight with natural fluctuation
     */
    addDailyFluctuation(baseWeight, day) {
        // Water retention varies by ~0.5-1.5kg day to day
        const fluctuation = Math.sin(day * 0.7) * 0.4 + 
                           Math.sin(day * 1.3) * 0.3 +
                           (Math.random() - 0.5) * 0.4;
        return Math.round((baseWeight + fluctuation) * 100) / 100;
    }
};

// Export for use in other modules
if (typeof window !== 'undefined') {
    window.Calculations = Calculations;
}

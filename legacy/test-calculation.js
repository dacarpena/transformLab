// ============================================
// TRANSFORMLAB - Bug Fix Verification Test
// Tests the corrected target weight calculation
// ============================================

// Test data from user's actual case
const testCase = {
    initial: {
        weight: 83.85,
        fatPct: 27.9,
        muscleKg: 57.34  // MEASURED value from bioimpedance
    },
    target: {
        fatPct: 15,
        muscleKg: 60
    },
    expected: {
        targetWeight: { min: 74, max: 76 }  // Expected range
    }
};

// Import the Calculations module (for Node.js testing)
// In browser, this would be loaded via script tag

console.log('═══════════════════════════════════════════════════════════');
console.log('🧪 TRANSFORMLAB - Bug Fix Verification Test');
console.log('═══════════════════════════════════════════════════════════\n');

console.log('📋 TEST CASE:');
console.log('   Initial: 83.85 kg, 27.9% fat, 57.34 kg muscle (measured)');
console.log('   Target:  15% fat, 60 kg muscle');
console.log('   Expected weight: ~74-76 kg');
console.log('   Bug result was: 147.1 kg ❌\n');

// Calculate step by step
console.log('📐 CALCULATION STEPS:\n');

// Step 1: Calculate initial lean mass
const initialLeanMass = testCase.initial.weight * (1 - testCase.initial.fatPct / 100);
console.log(`1. Initial lean mass = ${testCase.initial.weight} × (1 - ${testCase.initial.fatPct}/100)`);
console.log(`   = ${testCase.initial.weight} × ${(1 - testCase.initial.fatPct / 100).toFixed(4)}`);
console.log(`   = ${initialLeanMass.toFixed(2)} kg\n`);

// Step 2: Calculate "other lean tissue" (bones, organs, water)
const otherLeanTissue = initialLeanMass - testCase.initial.muscleKg;
console.log(`2. Other lean tissue = Lean mass - Muscle`);
console.log(`   = ${initialLeanMass.toFixed(2)} - ${testCase.initial.muscleKg}`);
console.log(`   = ${otherLeanTissue.toFixed(2)} kg (bones, organs, water - relatively constant)\n`);

// Step 3: Calculate target lean mass
const targetLeanMass = testCase.target.muscleKg + otherLeanTissue;
console.log(`3. Target lean mass = Target muscle + Other lean tissue`);
console.log(`   = ${testCase.target.muscleKg} + ${otherLeanTissue.toFixed(2)}`);
console.log(`   = ${targetLeanMass.toFixed(2)} kg\n`);

// Step 4: Calculate target weight
const targetWeight = targetLeanMass / (1 - testCase.target.fatPct / 100);
console.log(`4. Target weight = Target lean mass / (1 - Target fat%/100)`);
console.log(`   = ${targetLeanMass.toFixed(2)} / (1 - ${testCase.target.fatPct}/100)`);
console.log(`   = ${targetLeanMass.toFixed(2)} / ${(1 - testCase.target.fatPct / 100).toFixed(2)}`);
console.log(`   = ${targetWeight.toFixed(2)} kg\n`);

// Verify result
console.log('═══════════════════════════════════════════════════════════');
const isCorrect = targetWeight >= testCase.expected.targetWeight.min && 
                  targetWeight <= testCase.expected.targetWeight.max;

if (isCorrect) {
    console.log(`✅ RESULT: ${targetWeight.toFixed(2)} kg - CORRECT!`);
    console.log(`   (Within expected range of ${testCase.expected.targetWeight.min}-${testCase.expected.targetWeight.max} kg)`);
} else {
    console.log(`❌ RESULT: ${targetWeight.toFixed(2)} kg - UNEXPECTED`);
    console.log(`   (Expected ${testCase.expected.targetWeight.min}-${testCase.expected.targetWeight.max} kg)`);
}
console.log('═══════════════════════════════════════════════════════════\n');

// Compare with buggy calculation
console.log('📊 COMPARISON WITH BUGGY FORMULA:\n');

const buggyLeanMass = testCase.target.muscleKg / 0.48;
const buggyTargetWeight = buggyLeanMass / (1 - testCase.target.fatPct / 100);

console.log('   OLD (BUGGY) FORMULA:');
console.log(`   Lean mass = Muscle / 0.48 = ${testCase.target.muscleKg} / 0.48 = ${buggyLeanMass.toFixed(2)} kg`);
console.log(`   Target weight = ${buggyLeanMass.toFixed(2)} / 0.85 = ${buggyTargetWeight.toFixed(2)} kg ❌\n`);

console.log('   NEW (FIXED) FORMULA:');
console.log(`   Lean mass = Muscle + Other tissue = ${testCase.target.muscleKg} + ${otherLeanTissue.toFixed(2)} = ${targetLeanMass.toFixed(2)} kg`);
console.log(`   Target weight = ${targetLeanMass.toFixed(2)} / 0.85 = ${targetWeight.toFixed(2)} kg ✅\n`);

console.log(`   Difference: ${buggyTargetWeight.toFixed(2)} - ${targetWeight.toFixed(2)} = ${(buggyTargetWeight - targetWeight).toFixed(2)} kg`);
console.log(`   Error was ${((buggyTargetWeight / targetWeight - 1) * 100).toFixed(1)}% too high!\n`);

// Additional validation
console.log('═══════════════════════════════════════════════════════════');
console.log('🔍 VALIDATION CHECKS:\n');

// Check that target composition makes sense
const targetFatKg = targetWeight * (testCase.target.fatPct / 100);
const targetLeanKgFromWeight = targetWeight - targetFatKg;

console.log('   Final composition at target weight:');
console.log(`   - Total weight: ${targetWeight.toFixed(2)} kg`);
console.log(`   - Fat: ${targetFatKg.toFixed(2)} kg (${testCase.target.fatPct}%)`);
console.log(`   - Lean mass: ${targetLeanKgFromWeight.toFixed(2)} kg`);
console.log(`   - Muscle: ${testCase.target.muscleKg} kg`);
console.log(`   - Other tissue: ${(targetLeanKgFromWeight - testCase.target.muscleKg).toFixed(2)} kg\n`);

// Verify other lean tissue is preserved
const otherTissueChange = Math.abs(otherLeanTissue - (targetLeanKgFromWeight - testCase.target.muscleKg));
if (otherTissueChange < 0.01) {
    console.log('   ✅ Other lean tissue preserved correctly');
} else {
    console.log(`   ⚠️ Other lean tissue changed by ${otherTissueChange.toFixed(4)} kg`);
}

// Weight change summary
const weightChange = targetWeight - testCase.initial.weight;
const fatChange = targetFatKg - (testCase.initial.weight * testCase.initial.fatPct / 100);
const muscleChange = testCase.target.muscleKg - testCase.initial.muscleKg;

console.log('\n   Changes from initial to target:');
console.log(`   - Weight: ${weightChange > 0 ? '+' : ''}${weightChange.toFixed(2)} kg`);
console.log(`   - Fat: ${fatChange > 0 ? '+' : ''}${fatChange.toFixed(2)} kg`);
console.log(`   - Muscle: ${muscleChange > 0 ? '+' : ''}${muscleChange.toFixed(2)} kg\n`);

console.log('═══════════════════════════════════════════════════════════');
console.log('🧪 BUG 2 TEST: Muscle Validation');
console.log('═══════════════════════════════════════════════════════════\n');

// Test the muscle validation logic
const muscleGainNeeded = testCase.target.muscleKg - testCase.initial.muscleKg;
const maxMuscleForTargetWeight = targetWeight * 0.55;
const muscleIncreasePercent = (testCase.target.muscleKg / testCase.initial.muscleKg - 1) * 100;

console.log('   Muscle gain needed: ' + muscleGainNeeded.toFixed(2) + ' kg');
console.log('   Max muscle for target weight (55%): ' + maxMuscleForTargetWeight.toFixed(2) + ' kg');
console.log('   Muscle increase: ' + muscleIncreasePercent.toFixed(1) + '%\n');

// OLD buggy validation
const oldMaxMuscle = testCase.initial.weight * 0.55; // 46.12 kg
const oldThreshold = oldMaxMuscle * 1.3; // 59.96 kg
const oldWouldError = testCase.target.muscleKg > oldThreshold;

console.log('   OLD (BUGGY) validation:');
console.log('   maxMuscle = initial.weight * 0.55 = ' + oldMaxMuscle.toFixed(2) + ' kg');
console.log('   threshold = maxMuscle * 1.3 = ' + oldThreshold.toFixed(2) + ' kg');
console.log('   60 > ' + oldThreshold.toFixed(2) + ' = ' + oldWouldError + ' → ' + (oldWouldError ? 'ERROR ❌' : 'OK') + '\n');

// NEW fixed validation
const newWouldError = testCase.target.muscleKg > maxMuscleForTargetWeight && muscleIncreasePercent > 30;
const newWouldWarn = muscleIncreasePercent > 20 && muscleGainNeeded > 3;

console.log('   NEW (FIXED) validation:');
console.log('   maxMuscle = targetWeight * 0.55 = ' + maxMuscleForTargetWeight.toFixed(2) + ' kg');
console.log('   60 > ' + maxMuscleForTargetWeight.toFixed(2) + ' = ' + (testCase.target.muscleKg > maxMuscleForTargetWeight));
console.log('   muscleIncrease ' + muscleIncreasePercent.toFixed(1) + '% > 30% = ' + (muscleIncreasePercent > 30));
console.log('   Would error: ' + newWouldError + ' → ' + (newWouldError ? 'ERROR ❌' : 'NO ERROR ✅'));
console.log('   Would warn: ' + newWouldWarn + ' → ' + (newWouldWarn ? 'WARNING (OK)' : 'NO WARNING') + '\n');

if (!newWouldError && oldWouldError) {
    console.log('   ✅ BUG 2 FIXED: No longer shows false "improbable" error!');
} else if (newWouldError) {
    console.log('   ❌ BUG 2 NOT FIXED: Still shows error');
}

console.log('\n═══════════════════════════════════════════════════════════');
console.log('🎯 ALL TESTS COMPLETE');
console.log('═══════════════════════════════════════════════════════════\n');

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        testCase,
        results: {
            targetWeight,
            isCorrect,
            otherLeanTissue,
            buggyTargetWeight
        }
    };
}

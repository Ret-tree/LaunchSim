/**
 * Multi-Stage Rockets Tests
 * =========================
 */

import {
  MultiStageRocket,
  Stage,
  StageMotor,
  MultiStageState,
  STAGE_TYPES,
  SEPARATION_TRIGGERS,
  IGNITION_TRIGGERS,
  PRESET_CONFIGS
} from '../src/staging/multistage.js';

// Test Results
const TestResults = {
  passed: 0,
  failed: 0,
  results: []
};

function test(name, fn) {
  try {
    fn();
    TestResults.passed++;
    TestResults.results.push({ name, status: 'PASS' });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    TestResults.failed++;
    TestResults.results.push({ name, status: 'FAIL', error: error.message });
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${expected}, got ${actual}`);
  }
}

function assertApprox(actual, expected, tolerance, message = '') {
  if (Math.abs(actual - expected) > tolerance) {
    throw new Error(`${message} Expected ${expected} ± ${tolerance}, got ${actual}`);
  }
}

function assertTrue(condition, message = 'Assertion failed') {
  if (!condition) throw new Error(message);
}

function assertDefined(value, message = 'Value is undefined') {
  if (value === undefined || value === null) throw new Error(message);
}

// ============================================
// STAGE TESTS
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('STAGE TESTS');
console.log('═══════════════════════════════════════\n');

test('Stage creates with defaults', () => {
  const stage = new Stage({});
  
  assertDefined(stage.id);
  assertEqual(stage.type, STAGE_TYPES.SUSTAINER);
  assertTrue(stage.length > 0);
  assertTrue(stage.dryMass > 0);
  assertTrue(stage.active);
  assertTrue(!stage.separated);
});

test('Stage creates with full config', () => {
  const stage = new Stage({
    name: 'Booster',
    type: STAGE_TYPES.BOOSTER,
    length: 0.4,
    bodyDiameter: 0.054,
    dryMass: 0.5,
    hasFins: true,
    finCount: 4
  });
  
  assertEqual(stage.name, 'Booster');
  assertEqual(stage.type, STAGE_TYPES.BOOSTER);
  assertApprox(stage.length, 0.4, 0.001);
  assertApprox(stage.bodyDiameter, 0.054, 0.001);
  assertEqual(stage.finCount, 4);
});

test('Stage calculates total mass', () => {
  const stage = new Stage({
    dryMass: 0.5,
    motorMass: 0.3,
    propellantMass: 0.2
  });
  
  const mass = stage.getTotalMass();
  assertApprox(mass, 0.8, 0.01); // dryMass + motorMass - propMass + currentProp
});

test('Stage updates propellant during burn', () => {
  const motor = new StageMotor({
    totalImpulse: 100,
    burnTime: 2,
    propellantMass: 0.1
  });
  
  const stage = new Stage({
    motor,
    propellantMass: 0.1
  });
  
  stage.ignited = true;
  stage.ignitionTime = 0;
  
  // Simulate 1 second of burn
  stage.updatePropellant(1.0, 1.0);
  
  assertTrue(stage.currentPropellant < 0.1, 'Propellant should decrease');
  assertTrue(!stage.burnedOut, 'Should not be burned out yet');
});

test('Stage clones correctly', () => {
  const stage = new Stage({
    name: 'Original',
    dryMass: 0.5,
    propellantMass: 0.2
  });
  
  stage.ignited = true;
  stage.currentPropellant = 0.1;
  
  const clone = stage.clone();
  
  assertEqual(clone.name, 'Original');
  assertApprox(clone.dryMass, 0.5, 0.001);
  assertTrue(clone.ignited);
  assertApprox(clone.currentPropellant, 0.1, 0.001);
});

// ============================================
// STAGE MOTOR TESTS
// ============================================

console.log('\nSTAGE MOTOR TESTS');
console.log('───────────────────────────────────────\n');

test('StageMotor creates with config', () => {
  const motor = new StageMotor({
    designation: 'J350W',
    totalImpulse: 658,
    averageThrust: 350,
    burnTime: 1.9
  });
  
  assertEqual(motor.designation, 'J350W');
  assertApprox(motor.totalImpulse, 658, 1);
  assertApprox(motor.averageThrust, 350, 1);
  assertApprox(motor.burnTime, 1.9, 0.1);
});

test('StageMotor generates thrust curve', () => {
  const motor = new StageMotor({
    averageThrust: 100,
    burnTime: 2.0
  });
  
  assertTrue(motor.thrustCurve.length > 0, 'Should have thrust curve');
  
  // Check thrust at mid-burn
  const midThrust = motor.getThrustAtTime(1.0);
  assertTrue(midThrust > 50 && midThrust < 150, `Mid thrust ${midThrust} should be reasonable`);
});

test('StageMotor returns zero thrust after burnout', () => {
  const motor = new StageMotor({
    burnTime: 2.0
  });
  
  const thrust = motor.getThrustAtTime(3.0);
  assertEqual(thrust, 0, 'Thrust after burnout');
});

test('StageMotor calculates mass flow rate', () => {
  const motor = new StageMotor({
    propellantMass: 0.2,
    burnTime: 2.0
  });
  
  const flowRate = motor.getMassFlowRate(1.0);
  assertApprox(flowRate, 0.1, 0.01); // 0.2kg / 2s = 0.1 kg/s
});

// ============================================
// MULTI-STAGE ROCKET TESTS
// ============================================

console.log('\nMULTI-STAGE ROCKET TESTS');
console.log('───────────────────────────────────────\n');

test('MultiStageRocket creates empty', () => {
  const rocket = new MultiStageRocket({ name: 'Test Rocket' });
  
  assertEqual(rocket.name, 'Test Rocket');
  assertEqual(rocket.stages.length, 0);
});

test('MultiStageRocket adds stages', () => {
  const rocket = new MultiStageRocket();
  
  rocket.addStage({ name: 'Booster', length: 0.3 });
  rocket.addStage({ name: 'Sustainer', length: 0.4 });
  
  assertEqual(rocket.stages.length, 2);
  assertEqual(rocket.stages[0].stageNumber, 1);
  assertEqual(rocket.stages[1].stageNumber, 2);
});

test('MultiStageRocket calculates total length', () => {
  const rocket = new MultiStageRocket();
  
  rocket.addStage({ length: 0.3, hasNoseCone: false });
  rocket.addStage({ length: 0.4, hasNoseCone: true, noseLength: 0.1 });
  
  const length = rocket.getTotalLength();
  assertApprox(length, 0.8, 0.01); // 0.3 + 0.4 + 0.1 nose
});

test('MultiStageRocket calculates total mass', () => {
  const rocket = new MultiStageRocket();
  
  rocket.addStage({ dryMass: 0.5, motorMass: 0.3, propellantMass: 0.2 });
  rocket.addStage({ dryMass: 0.4, motorMass: 0.2, propellantMass: 0.1 });
  
  const mass = rocket.getTotalMass();
  assertTrue(mass > 1.0, `Total mass ${mass} should be > 1kg`);
});

test('MultiStageRocket adds strap-on boosters', () => {
  const rocket = new MultiStageRocket();
  
  rocket.addStage({ name: 'Core' });
  rocket.addStrapon({ name: 'Left Booster' });
  rocket.addStrapon({ name: 'Right Booster' });
  
  assertEqual(rocket.strapons.length, 2);
  assertEqual(rocket.strapons[0].type, STAGE_TYPES.STRAPON);
});

test('MultiStageRocket calculates stability margin', () => {
  const rocket = new MultiStageRocket();
  
  rocket.addStage({
    length: 0.4,
    bodyDiameter: 0.05,
    dryMass: 0.5,
    hasFins: true,
    finRootChord: 0.08,
    finSpan: 0.06
  });
  
  const stability = rocket.getStabilityMargin();
  
  assertDefined(stability);
  console.log(`    → Stability margin: ${stability.toFixed(2)} cal`);
});

// ============================================
// STAGING TESTS
// ============================================

console.log('\nSTAGING TESTS');
console.log('───────────────────────────────────────\n');

test('Staging triggers on burnout', () => {
  const rocket = new MultiStageRocket();
  
  const motor = new StageMotor({ burnTime: 1.0, propellantMass: 0.1 });
  
  rocket.addStage({
    name: 'Booster',
    motor,
    motorMass: 0.2,
    propellantMass: 0.1,
    separationTrigger: SEPARATION_TRIGGERS.BURNOUT
  });
  
  rocket.addStage({
    name: 'Sustainer',
    ignitionTrigger: IGNITION_TRIGGERS.SEPARATION
  });
  
  // Mark stage as burned out
  rocket.stages[0].ignited = true;
  rocket.stages[0].burnedOut = true;
  rocket.stages[0].ignitionTime = 0;
  
  const state = new MultiStageState();
  state.time = 1.5;
  state.y = 500;
  
  const events = rocket.processStaging(state, 0.01);
  
  assertTrue(events.length > 0, 'Should have staging events');
  assertTrue(rocket.stages[0].separated, 'Booster should be separated');
});

test('Staging triggers ignition on separation', () => {
  const rocket = new MultiStageRocket();
  
  rocket.addStage({
    name: 'Booster',
    separationTrigger: SEPARATION_TRIGGERS.BURNOUT
  });
  
  rocket.addStage({
    name: 'Sustainer',
    ignitionTrigger: IGNITION_TRIGGERS.SEPARATION,
    ignitionDelay: 0.1
  });
  
  // Simulate separation
  rocket.stages[0].separated = true;
  rocket.stages[0].separationTime = 2.0;
  
  const state = new MultiStageState();
  state.time = 2.15; // 0.15s after separation
  
  const events = rocket.processStaging(state, 0.01);
  
  assertTrue(rocket.stages[1].ignited, 'Sustainer should be ignited');
});

// ============================================
// SIMULATION TESTS
// ============================================

console.log('\nSIMULATION TESTS');
console.log('───────────────────────────────────────\n');

test('Simulation runs for two-stage rocket', () => {
  const rocket = PRESET_CONFIGS.twoStageMinDia();
  
  const result = rocket.simulate({ maxTime: 60 });
  
  assertTrue(result.success, 'Simulation should succeed');
  assertTrue(result.maxAltitude > 100, `Max altitude ${result.maxAltitude.toFixed(0)}m should be > 100m`);
  assertTrue(result.events.length > 0, 'Should have events');
  
  console.log(`    → Max altitude: ${result.maxAltitude.toFixed(0)}m`);
  console.log(`    → Max velocity: ${result.maxVelocity.toFixed(1)} m/s`);
  console.log(`    → Events: ${result.events.length}`);
});

test('Simulation tracks staging events', () => {
  const rocket = PRESET_CONFIGS.twoStageMinDia();
  
  const result = rocket.simulate({ maxTime: 60 });
  
  // Should have liftoff, ignition(s), separation, apogee, landing
  const eventTypes = result.events.map(e => e.type);
  
  assertTrue(eventTypes.includes('LIFTOFF'), 'Should have liftoff');
  assertTrue(eventTypes.includes('SEPARATION'), 'Should have separation');
  assertTrue(eventTypes.includes('APOGEE'), 'Should have apogee');
  
  console.log(`    → Event sequence: ${eventTypes.join(' → ')}`);
});

test('Simulation records trajectory', () => {
  const rocket = PRESET_CONFIGS.twoStageMinDia();
  
  const result = rocket.simulate({ maxTime: 60 });
  
  assertTrue(result.trajectory.length > 10, 'Should have trajectory points');
  
  // Check trajectory has required fields
  const point = result.trajectory[Math.floor(result.trajectory.length / 2)];
  assertDefined(point.time);
  assertDefined(point.altitude);
  assertDefined(point.velocity);
  assertDefined(point.thrust);
  assertDefined(point.phase);
});

test('Simulation tracks separated stage', () => {
  const rocket = PRESET_CONFIGS.twoStageMinDia();
  
  const result = rocket.simulate({ maxTime: 60 });
  
  assertTrue(result.stageTrajectories.length >= 1, 'Should track separated stages');
  
  const boosterTrajectory = result.stageTrajectories[0];
  assertDefined(boosterTrajectory.separationAltitude);
  assertDefined(boosterTrajectory.landingTime);
  
  console.log(`    → Booster separated at: ${boosterTrajectory.separationAltitude.toFixed(0)}m`);
});

// ============================================
// PRESET CONFIGURATION TESTS
// ============================================

console.log('\nPRESET CONFIGURATION TESTS');
console.log('───────────────────────────────────────\n');

test('Two-stage min dia preset', () => {
  const rocket = PRESET_CONFIGS.twoStageMinDia();
  
  assertEqual(rocket.stages.length, 2);
  assertEqual(rocket.stages[0].name, 'Booster');
  assertEqual(rocket.stages[1].name, 'Sustainer');
  assertTrue(rocket.stages[0].hasFins);
  assertTrue(rocket.stages[1].hasNoseCone);
});

test('Two-stage HPR preset', () => {
  const rocket = PRESET_CONFIGS.twoStageHPR();
  
  assertEqual(rocket.stages.length, 2);
  assertTrue(rocket.stages[0].motor.totalImpulse > 500, 'Should have J motor');
  assertTrue(rocket.stages[1].motor.totalImpulse > 500, 'Sustainer should have J motor');
});

test('Three-stage preset', () => {
  const rocket = PRESET_CONFIGS.threeStage();
  
  assertEqual(rocket.stages.length, 3);
  assertEqual(rocket.stages[0].type, STAGE_TYPES.BOOSTER);
  assertEqual(rocket.stages[1].type, STAGE_TYPES.SUSTAINER);
  assertEqual(rocket.stages[2].type, STAGE_TYPES.UPPER);
});

test('Parallel staging preset', () => {
  const rocket = PRESET_CONFIGS.parallelStaging();
  
  assertEqual(rocket.stages.length, 1); // Core only
  assertEqual(rocket.strapons.length, 2); // Two boosters
  assertTrue(rocket.strapons[0].type === STAGE_TYPES.STRAPON);
});

// ============================================
// PERFORMANCE ESTIMATE TESTS
// ============================================

console.log('\nPERFORMANCE ESTIMATE TESTS');
console.log('───────────────────────────────────────\n');

test('Performance estimate calculates delta-V', () => {
  const rocket = PRESET_CONFIGS.twoStageHPR();
  
  const estimate = rocket.estimatePerformance();
  
  assertTrue(estimate.totalImpulse > 1000, 'Should have significant impulse');
  assertTrue(estimate.deltaV > 100, 'Should have significant delta-V');
  assertTrue(estimate.massRatio > 1, 'Mass ratio should be > 1');
  
  console.log(`    → Total impulse: ${estimate.totalImpulse.toFixed(0)} Ns`);
  console.log(`    → Delta-V: ${estimate.deltaV.toFixed(0)} m/s`);
  console.log(`    → Mass ratio: ${estimate.massRatio.toFixed(2)}`);
});

// ============================================
// VALIDATION TESTS
// ============================================

console.log('\nVALIDATION TESTS');
console.log('───────────────────────────────────────\n');

test('Validation catches missing stages', () => {
  const rocket = new MultiStageRocket();
  
  const result = rocket.validate();
  
  assertTrue(!result.valid, 'Should be invalid');
  assertTrue(result.issues.length > 0, 'Should have issues');
});

test('Validation warns about missing motors', () => {
  const rocket = new MultiStageRocket();
  
  rocket.addStage({ name: 'Booster', motor: null });
  rocket.addStage({ name: 'Sustainer', motor: null });
  
  const result = rocket.validate();
  
  assertTrue(result.warnings.length > 0, 'Should have warnings about motors');
});

test('Validation checks stability', () => {
  const rocket = new MultiStageRocket();
  
  // Create unstable rocket (no fins)
  rocket.addStage({
    length: 0.4,
    bodyDiameter: 0.05,
    dryMass: 0.5,
    hasFins: false
  });
  
  const result = rocket.validate();
  
  // Should warn about stability
  const hasStabilityWarning = result.warnings.some(w => 
    w.toLowerCase().includes('stability') || w.toLowerCase().includes('fins')
  );
  assertTrue(hasStabilityWarning || result.warnings.length > 0, 'Should warn about stability');
});

// ============================================
// IMPORT/EXPORT TESTS
// ============================================

console.log('\nIMPORT/EXPORT TESTS');
console.log('───────────────────────────────────────\n');

test('Export to JSON', () => {
  const rocket = PRESET_CONFIGS.twoStageMinDia();
  
  const json = rocket.toJSON();
  
  assertEqual(json.stages.length, 2);
  assertEqual(json.stages[0].name, 'Booster');
  assertDefined(json.stages[0].motor);
});

test('Import from JSON', () => {
  const original = PRESET_CONFIGS.twoStageMinDia();
  const json = original.toJSON();
  
  const imported = MultiStageRocket.fromJSON(json);
  
  assertEqual(imported.stages.length, 2);
  assertEqual(imported.stages[0].name, 'Booster');
});

// ============================================
// INTEGRATION TESTS
// ============================================

console.log('\nINTEGRATION TESTS');
console.log('───────────────────────────────────────\n');

test('Full two-stage flight simulation', () => {
  const rocket = PRESET_CONFIGS.twoStageHPR();
  
  const result = rocket.simulate({ maxTime: 120 });
  
  assertTrue(result.success, 'Should succeed');
  
  // Check staging occurred
  const separations = result.events.filter(e => e.type === 'SEPARATION');
  assertTrue(separations.length >= 1, 'Should have at least one separation');
  
  // Check both stages burned
  assertTrue(result.stages[0].burnedOut, 'Booster should burn out');
  assertTrue(result.stages[0].separated, 'Booster should separate');
  assertTrue(result.stages[1].ignited, 'Sustainer should ignite');
  
  console.log(`    → Max altitude: ${result.maxAltitude.toFixed(0)}m`);
  console.log(`    → Separation at: ${separations[0].altitude.toFixed(0)}m`);
  console.log(`    → Flight time: ${result.flightTime.toFixed(1)}s`);
});

test('Full three-stage flight simulation', () => {
  const rocket = PRESET_CONFIGS.threeStage();
  
  const result = rocket.simulate({ maxTime: 180 });
  
  assertTrue(result.success, 'Should succeed');
  
  // Check all separations
  const separations = result.events.filter(e => e.type === 'SEPARATION');
  assertTrue(separations.length >= 2, `Should have 2+ separations, got ${separations.length}`);
  
  console.log(`    → Max altitude: ${result.maxAltitude.toFixed(0)}m`);
  console.log(`    → Separations: ${separations.length}`);
  console.log(`    → Max Mach: ${result.maxMach.toFixed(2)}`);
});

test('Parallel staging simulation', () => {
  const rocket = PRESET_CONFIGS.parallelStaging();
  
  const result = rocket.simulate({ maxTime: 120 });
  
  assertTrue(result.success, 'Should succeed');
  
  // Both strapons should separate
  assertTrue(result.strapons[0].separated || result.strapons[0].burnedOut, 
    'Left booster should complete');
  assertTrue(result.strapons[1].separated || result.strapons[1].burnedOut, 
    'Right booster should complete');
  
  console.log(`    → Max altitude: ${result.maxAltitude.toFixed(0)}m`);
  console.log(`    → Total impulse used: ${rocket.strapons.length * 658 + 3500} Ns`);
});

test('Compare single vs two-stage performance', () => {
  // Single stage
  const single = new MultiStageRocket({ name: 'Single Stage' });
  single.addStage({
    name: 'Sustainer',
    length: 0.6,
    bodyDiameter: 0.054,
    dryMass: 0.5,
    hasNoseCone: true,
    noseLength: 0.15,
    motor: new StageMotor({
      designation: 'J350W',
      totalImpulse: 658,
      averageThrust: 350,
      burnTime: 1.9,
      propellantMass: 0.32,
      totalMass: 0.48
    }),
    motorMass: 0.48,
    propellantMass: 0.32,
    hasFins: true
  });
  
  const singleResult = single.simulate({ maxTime: 60 });
  
  // Two stage with same total impulse
  const twoStage = PRESET_CONFIGS.twoStageMinDia();
  const twoStageResult = twoStage.simulate({ maxTime: 60 });
  
  console.log(`    → Single stage: ${singleResult.maxAltitude.toFixed(0)}m`);
  console.log(`    → Two stage: ${twoStageResult.maxAltitude.toFixed(0)}m`);
  
  // Two stage should generally achieve higher altitude per impulse
  // but for this test, just verify both work
  assertTrue(singleResult.maxAltitude > 100, 'Single should reach altitude');
  assertTrue(twoStageResult.maxAltitude > 100, 'Two-stage should reach altitude');
});

// ============================================
// Summary
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('TEST SUMMARY');
console.log('═══════════════════════════════════════');
console.log(`Passed:  ${TestResults.passed}`);
console.log(`Failed:  ${TestResults.failed}`);
console.log(`Total:   ${TestResults.passed + TestResults.failed}`);
console.log('═══════════════════════════════════════\n');

if (TestResults.failed > 0) {
  console.log('FAILED TESTS:');
  TestResults.results
    .filter(r => r.status === 'FAIL')
    .forEach(r => console.log(`  ✗ ${r.name}: ${r.error}`));
  process.exit(1);
} else {
  console.log('✓ ALL MULTI-STAGE ROCKET TESTS PASSED!\n');
  process.exit(0);
}

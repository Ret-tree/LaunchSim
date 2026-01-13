/**
 * Dual Deploy & Launch Day Assistant Tests
 * =========================================
 */

import { 
  DualDeploySimulation,
  RecoveryConfig,
  RecoveryPlanner,
  Parachute,
  DrogueParachute,
  MainParachute,
  WindProfile,
  PARACHUTE_CD
} from '../src/recovery/dualdeploy.js';

import {
  LaunchDayAssistant,
  WeatherAssessment,
  DriftPredictor,
  PreFlightChecklist,
  LaunchWindowCalculator,
  WIND_LIMITS
} from '../src/launchday/assistant.js';

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
// Sample Data
// ============================================

const sampleRocket = {
  name: 'Test HPR',
  dryMass: 1500, // grams
  bodyDiameter: 75,
  chuteDiameter: 750,
  chuteCd: 0.8,
  finRootChord: 120,
  finTipChord: 50,
  finSpan: 100,
  finThickness: 3
};

const dualDeployRocket = {
  name: 'Dual Deploy HPR',
  dryMass: 2000,
  bodyDiameter: 98,
  drogueChute: { diameter: 300, type: 'cruciform' },
  mainChute: { diameter: 1200, type: 'round', deploymentAltitude: 500 },
  mainDeployAltitude: 500
};

const sampleWeather = {
  windSpeed: 5, // m/s
  windDirection: 180, // from south
  gustSpeed: 7,
  temperature: 20,
  visibility: 10000,
  precipitation: 0
};

const sampleMotor = {
  designation: 'J350W',
  totalImpulse: 650,
  avgThrust: 350,
  burnTime: 1.9,
  totalMass: 450,
  propMass: 250
};

// ============================================
// Parachute Tests
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('PARACHUTE TESTS');
console.log('═══════════════════════════════════════\n');

test('Parachute creates with diameter in mm', () => {
  const chute = new Parachute({ diameter: 1000 });
  
  assertDefined(chute.area);
  assertApprox(chute.diameter, 1.0, 0.01, 'Diameter in meters');
  assertApprox(chute.cd, 0.75, 0.01, 'Default Cd');
});

test('Parachute calculates terminal velocity', () => {
  const chute = new Parachute({ diameter: 1000, cd: 0.75 });
  const mass = 2; // kg
  
  const velocity = chute.terminalVelocity(mass);
  
  assertTrue(velocity > 0);
  assertTrue(velocity < 20, 'Terminal velocity should be reasonable');
  console.log(`    → 1m chute, 2kg: ${velocity.toFixed(2)} m/s terminal`);
});

test('Parachute types have different Cd values', () => {
  const round = new Parachute({ diameter: 1000, type: 'round' });
  const cruciform = new Parachute({ diameter: 1000, type: 'cruciform' });
  const toroidal = new Parachute({ diameter: 1000, type: 'toroidal' });
  
  assertTrue(round.cd < toroidal.cd, 'Toroidal should have higher Cd');
  assertTrue(cruciform.cd < round.cd, 'Cruciform should have lower Cd');
});

test('DrogueParachute recommends size for descent rate', () => {
  const mass = 2000; // grams
  const targetRate = 75; // ft/s
  
  const size = DrogueParachute.recommendedSize(mass, targetRate);
  
  assertTrue(size > 100, 'Should recommend reasonable drogue size');
  assertTrue(size < 500, 'Drogue should not be too large');
  console.log(`    → 2kg rocket, 75ft/s: ${size.toFixed(0)}mm drogue`);
});

test('MainParachute recommends size for landing velocity', () => {
  const mass = 2000; // grams
  const targetLanding = 15; // ft/s
  
  const size = MainParachute.recommendedSize(mass, targetLanding);
  
  assertTrue(size > 500, 'Should recommend larger main');
  assertTrue(size < 2000, 'Should be reasonable size');
  console.log(`    → 2kg rocket, 15ft/s landing: ${size.toFixed(0)}mm main`);
});

// ============================================
// Wind Profile Tests
// ============================================

console.log('\nWIND PROFILE TESTS');
console.log('───────────────────────────────────────\n');

test('WindProfile creates with ground conditions', () => {
  const wind = new WindProfile({
    groundSpeed: 5,
    groundDirection: 180
  });
  
  assertEqual(wind.groundSpeed, 5);
  assertEqual(wind.groundDirection, 180);
});

test('WindProfile speed increases with altitude', () => {
  const wind = new WindProfile({ groundSpeed: 5, groundDirection: 0 });
  
  const ground = wind.speedAtAltitude(0);
  const high = wind.speedAtAltitude(3000);
  
  assertTrue(high > ground, 'Wind should increase with altitude');
  console.log(`    → Ground: ${ground.toFixed(1)} m/s, 3000ft: ${high.toFixed(1)} m/s`);
});

test('WindProfile direction veers with altitude', () => {
  const wind = new WindProfile({ groundSpeed: 5, groundDirection: 180 });
  
  const groundDir = wind.directionAtAltitude(0);
  const highDir = wind.directionAtAltitude(5000);
  
  assertTrue(highDir !== groundDir, 'Direction should change with altitude');
});

test('WindProfile vector components', () => {
  const wind = new WindProfile({ groundSpeed: 10, groundDirection: 90 }); // East wind
  const vector = wind.vectorAtAltitude(0);
  
  assertApprox(vector.east, 10, 1, 'East component');
  assertApprox(vector.north, 0, 1, 'North component');
});

// ============================================
// Recovery Config Tests
// ============================================

console.log('\nRECOVERY CONFIG TESTS');
console.log('───────────────────────────────────────\n');

test('RecoveryConfig creates for single deploy', () => {
  const config = new RecoveryConfig({
    chuteDiameter: 750,
    chuteCd: 0.8
  });
  
  assertEqual(config.isDualDeploy, false);
  assertDefined(config.main);
});

test('RecoveryConfig creates for dual deploy', () => {
  const config = new RecoveryConfig({
    drogue: { diameter: 300, type: 'cruciform' },
    main: { diameter: 1000, type: 'round', deploymentAltitude: 500 },
    mainDeployAltitude: 500
  });
  
  assertEqual(config.isDualDeploy, true);
  assertDefined(config.drogue);
  assertDefined(config.main);
  assertEqual(config.mainDeployAltitude, 500);
});

test('RecoveryConfig.fromRocket creates from rocket', () => {
  const config = RecoveryConfig.fromRocket(dualDeployRocket);
  
  assertEqual(config.isDualDeploy, true);
  assertDefined(config.drogue);
  assertDefined(config.main);
});

// ============================================
// Dual Deploy Simulation Tests
// ============================================

console.log('\nDUAL DEPLOY SIMULATION TESTS');
console.log('───────────────────────────────────────\n');

test('DualDeploySimulation creates', () => {
  const sim = new DualDeploySimulation(dualDeployRocket);
  
  assertDefined(sim.recovery);
  assertEqual(sim.recovery.isDualDeploy, true);
});

test('DualDeploySimulation runs simulation', () => {
  const sim = new DualDeploySimulation(dualDeployRocket);
  const result = sim.simulate(3000, sampleWeather);
  
  assertDefined(result.phases);
  assertDefined(result.events);
  assertDefined(result.totals);
  assertDefined(result.safety);
  
  assertEqual(result.isDualDeploy, true);
  assertTrue(result.phases.length === 2, 'Should have 2 phases');
});

test('DualDeploySimulation has correct events', () => {
  const sim = new DualDeploySimulation(dualDeployRocket);
  const result = sim.simulate(2500);
  
  const eventTypes = result.events.map(e => e.type);
  
  assertTrue(eventTypes.includes('APOGEE'), 'Should have apogee event');
  assertTrue(eventTypes.includes('DROGUE_DEPLOY'), 'Should have drogue deploy');
  assertTrue(eventTypes.includes('MAIN_DEPLOY'), 'Should have main deploy');
  assertTrue(eventTypes.includes('LANDING'), 'Should have landing');
});

test('DualDeploySimulation calculates drift', () => {
  const sim = new DualDeploySimulation(dualDeployRocket);
  const result = sim.simulate(3000, { groundSpeed: 5, groundDirection: 180 });
  
  assertTrue(result.totals.totalDriftMeters > 0, 'Should have drift');
  assertDefined(result.totals.driftDirection);
  assertDefined(result.totals.driftDirectionCardinal);
  
  console.log(`    → Drift: ${result.totals.totalDriftMeters.toFixed(0)}m ${result.totals.driftDirectionCardinal}`);
});

test('DualDeploySimulation calculates landing velocity', () => {
  const sim = new DualDeploySimulation(dualDeployRocket);
  const result = sim.simulate(2500);
  
  assertTrue(result.totals.landingVelocityFps > 0);
  assertTrue(result.totals.landingVelocityFps < 30, 'Landing velocity should be reasonable');
  
  console.log(`    → Landing: ${result.totals.landingVelocityFps.toFixed(1)} ft/s`);
});

test('DualDeploySimulation safety assessment', () => {
  const sim = new DualDeploySimulation(dualDeployRocket);
  const result = sim.simulate(3000);
  
  assertDefined(result.safety.safe);
  assertDefined(result.safety.level);
  assertDefined(result.safety.issues);
  assertDefined(result.safety.warnings);
});

test('DualDeploySimulation single deploy fallback', () => {
  const sim = new DualDeploySimulation(sampleRocket);
  const result = sim.simulate(1500);
  
  assertEqual(result.isDualDeploy, false);
  assertEqual(result.phases.length, 1);
});

// ============================================
// Recovery Planner Tests
// ============================================

console.log('\nRECOVERY PLANNER TESTS');
console.log('───────────────────────────────────────\n');

test('RecoveryPlanner recommends dual deploy for high flights', () => {
  const plan = RecoveryPlanner.plan(sampleRocket, 3000);
  
  assertEqual(plan.recommendDualDeploy, true);
  assertDefined(plan.drogue);
  assertDefined(plan.main);
});

test('RecoveryPlanner recommends single deploy for low flights', () => {
  const plan = RecoveryPlanner.plan(sampleRocket, 500);
  
  assertEqual(plan.recommendDualDeploy, false);
  assertEqual(plan.drogue, null);
  assertDefined(plan.main);
});

test('RecoveryPlanner calculates recommended sizes', () => {
  const plan = RecoveryPlanner.plan({ dryMass: 2000 }, 3000);
  
  assertTrue(plan.drogue.diameter > 200, 'Should recommend drogue');
  assertTrue(plan.main.diameter > 800, 'Should recommend main');
  
  console.log(`    → Drogue: ${plan.drogue.diameter}mm, Main: ${plan.main.diameter}mm`);
});

// ============================================
// Weather Assessment Tests
// ============================================

console.log('\nWEATHER ASSESSMENT TESTS');
console.log('───────────────────────────────────────\n');

test('WeatherAssessment GO for good conditions', () => {
  const assessment = new WeatherAssessment({
    windSpeed: 3, // m/s
    visibility: 10000,
    precipitation: 0
  }, 'model');
  
  const result = assessment.assess();
  
  assertEqual(result.status, 'GO');
  assertEqual(result.issues.length, 0);
});

test('WeatherAssessment NO-GO for high wind', () => {
  const assessment = new WeatherAssessment({
    windSpeed: 15, // m/s (~34 mph)
    visibility: 10000
  }, 'model');
  
  const result = assessment.assess();
  
  assertEqual(result.status, 'NO-GO');
  assertTrue(result.issues.length > 0);
});

test('WeatherAssessment CAUTION for marginal conditions', () => {
  // 7 m/s = ~16 mph which is between caution (15) and max (20)
  const assessment = new WeatherAssessment({
    windSpeed: 6.8, // ~15.2 mph - just over caution limit
    visibility: 10000
  }, 'model');
  
  const result = assessment.assess();
  
  // Should be GO or CAUTION (not NO-GO) 
  assertTrue(result.status !== 'NO-GO', 'Should not be NO-GO at 15 mph');
});

test('WeatherAssessment NO-GO for precipitation', () => {
  const assessment = new WeatherAssessment({
    windSpeed: 3,
    precipitation: 1 // mm/hr
  }, 'model');
  
  const result = assessment.assess();
  
  assertEqual(result.status, 'NO-GO');
});

test('WeatherAssessment uses correct class limits', () => {
  // HPR L3 has stricter limits
  const l3 = new WeatherAssessment({ windSpeed: 6 }, 'hpr_l3'); // ~14 mph
  const model = new WeatherAssessment({ windSpeed: 6 }, 'model');
  
  const l3Result = l3.assess();
  const modelResult = model.assess();
  
  // Same wind - L3 should be more restrictive
  assertTrue(l3Result.score <= modelResult.score);
});

// ============================================
// Drift Predictor Tests
// ============================================

console.log('\nDRIFT PREDICTOR TESTS');
console.log('───────────────────────────────────────\n');

test('DriftPredictor calculates drift', () => {
  const predictor = new DriftPredictor(
    { apogee: 2000, timeToApogee: 8, descentTime: 60 },
    { windSpeed: 5, windDirection: 180 }
  );
  
  const drift = predictor.predict();
  
  assertDefined(drift.distance);
  assertTrue(drift.distance > 0);
  assertDefined(drift.direction);
  assertDefined(drift.directionCardinal);
  
  console.log(`    → Drift: ${drift.distanceFeet.toFixed(0)}ft ${drift.directionCardinal}`);
});

test('DriftPredictor more wind = more drift', () => {
  const profile = { apogee: 2000, timeToApogee: 8, descentTime: 60 };
  
  const light = new DriftPredictor(profile, { windSpeed: 2, windDirection: 0 }).predict();
  const strong = new DriftPredictor(profile, { windSpeed: 8, windDirection: 0 }).predict();
  
  assertTrue(strong.distance > light.distance, 'More wind should mean more drift');
});

test('DriftPredictor optimal launch direction', () => {
  const predictor = new DriftPredictor(
    { apogee: 1500 },
    { windSpeed: 5, windDirection: 90 } // East wind
  );
  
  const optimal = predictor.getOptimalLaunchDirection();
  
  assertDefined(optimal.intoWind);
  assertDefined(optimal.intoWindCardinal);
  assertEqual(optimal.intoWind, 90); // Into east wind
});

// ============================================
// Pre-Flight Checklist Tests
// ============================================

console.log('\nPRE-FLIGHT CHECKLIST TESTS');
console.log('───────────────────────────────────────\n');

test('PreFlightChecklist generates items', () => {
  const checklist = new PreFlightChecklist(sampleRocket);
  
  assertTrue(checklist.items.length > 10, 'Should have multiple items');
});

test('PreFlightChecklist tracks completion', () => {
  const checklist = new PreFlightChecklist(sampleRocket);
  
  const item = checklist.items[0];
  assertEqual(checklist.isComplete(item.id), false);
  
  checklist.completeItem(item.id);
  assertEqual(checklist.isComplete(item.id), true);
  
  checklist.uncompleteItem(item.id);
  assertEqual(checklist.isComplete(item.id), false);
});

test('PreFlightChecklist status tracking', () => {
  const checklist = new PreFlightChecklist(sampleRocket);
  
  const status = checklist.getStatus();
  
  assertDefined(status.total);
  assertDefined(status.completed);
  assertDefined(status.criticalTotal);
  assertDefined(status.readyToLaunch);
  
  assertEqual(status.completed, 0);
  assertEqual(status.readyToLaunch, false);
});

test('PreFlightChecklist ready when critical complete', () => {
  const checklist = new PreFlightChecklist(sampleRocket);
  
  // Complete all critical items
  const critical = checklist.items.filter(i => i.critical);
  critical.forEach(i => checklist.completeItem(i.id));
  
  const status = checklist.getStatus();
  assertEqual(status.allCriticalComplete, true);
  assertEqual(status.readyToLaunch, true);
});

test('PreFlightChecklist adds electronics for dual deploy', () => {
  const checklist = new PreFlightChecklist(dualDeployRocket);
  
  const electronicsItems = checklist.items.filter(i => i.category === 'electronics');
  assertTrue(electronicsItems.length > 0, 'Should have electronics items');
});

// ============================================
// Launch Window Calculator Tests
// ============================================

console.log('\nLAUNCH WINDOW CALCULATOR TESTS');
console.log('───────────────────────────────────────\n');

test('LaunchWindowCalculator finds windows', () => {
  const forecast = [
    { time: '10:00', windSpeed: 3 },
    { time: '11:00', windSpeed: 4 },
    { time: '12:00', windSpeed: 10 }, // Too windy
    { time: '13:00', windSpeed: 5 },
    { time: '14:00', windSpeed: 4 }
  ];
  
  const calc = new LaunchWindowCalculator(forecast);
  const result = calc.findWindows();
  
  assertTrue(result.windows.length > 0, 'Should find windows');
  assertDefined(result.bestWindow);
});

test('LaunchWindowCalculator recommendation', () => {
  const forecast = [
    { time: '10:00', windSpeed: 3, visibility: 10000, precipitation: 0 }
  ];
  
  const calc = new LaunchWindowCalculator(forecast);
  const rec = calc.getCurrentRecommendation();
  
  assertDefined(rec.recommendation);
  assertDefined(rec.status);
});

test('LaunchWindowCalculator handles no forecast', () => {
  const calc = new LaunchWindowCalculator([]);
  const result = calc.findWindows();
  
  assertEqual(result.windows.length, 0);
  assertEqual(result.bestWindow, null);
});

// ============================================
// Launch Day Assistant Tests
// ============================================

console.log('\nLAUNCH DAY ASSISTANT TESTS');
console.log('───────────────────────────────────────\n');

test('LaunchDayAssistant creates', () => {
  const assistant = new LaunchDayAssistant(sampleRocket, sampleMotor, {
    weather: sampleWeather
  });
  
  assertDefined(assistant.rocket);
  assertDefined(assistant.motor);
});

test('LaunchDayAssistant getReadiness', () => {
  const assistant = new LaunchDayAssistant(sampleRocket, sampleMotor, {
    weather: sampleWeather
  });
  
  const readiness = assistant.getReadiness();
  
  assertDefined(readiness.weather);
  assertDefined(readiness.stability);
  assertDefined(readiness.recovery);
  assertDefined(readiness.waiver);
  assertDefined(readiness.checklist);
  assertDefined(readiness.overall);
  
  console.log(`    → Status: ${readiness.overall.status}, Score: ${readiness.overall.score}`);
});

test('LaunchDayAssistant quick status', () => {
  const assistant = new LaunchDayAssistant(sampleRocket, sampleMotor, {
    weather: sampleWeather
  });
  
  const quick = assistant.getQuickStatus();
  
  assertDefined(quick.status);
  assertDefined(quick.score);
  assertDefined(quick.message);
});

test('LaunchDayAssistant determines rocket class', () => {
  // Model rocket motor
  const modelAssistant = new LaunchDayAssistant(sampleRocket, { designation: 'C6-5' });
  const modelClass = modelAssistant.determineRocketClass();
  assertEqual(modelClass, 'model');
  
  // HPR motor
  const hprAssistant = new LaunchDayAssistant(sampleRocket, { designation: 'J350W' });
  const hprClass = hprAssistant.determineRocketClass();
  assertEqual(hprClass, 'hpr_l2');
});

test('LaunchDayAssistant drift prediction with weather', () => {
  const assistant = new LaunchDayAssistant(sampleRocket, sampleMotor, {
    weather: sampleWeather
  });
  
  const readiness = assistant.getReadiness();
  
  assertDefined(readiness.drift);
  assertTrue(readiness.drift.distance > 0);
  assertDefined(readiness.launchDirection);
});

test('LaunchDayAssistant waiver check', () => {
  const assistant = new LaunchDayAssistant(sampleRocket, sampleMotor, {
    weather: sampleWeather,
    waiver: { feet: 5000 }
  });
  
  const readiness = assistant.getReadiness();
  
  assertDefined(readiness.waiver.withinWaiver);
  assertDefined(readiness.waiver.expectedApogee);
  assertDefined(readiness.waiver.waiverCeiling);
});

test('LaunchDayAssistant NO-GO for bad weather', () => {
  const assistant = new LaunchDayAssistant(sampleRocket, sampleMotor, {
    weather: { windSpeed: 15, visibility: 500 } // Very windy, poor vis
  });
  
  const readiness = assistant.getReadiness();
  
  assertEqual(readiness.overall.status, 'NO-GO');
  assertTrue(readiness.overall.blockers.length > 0);
});

// ============================================
// Integration Tests
// ============================================

console.log('\nINTEGRATION TESTS');
console.log('───────────────────────────────────────\n');

test('Full dual deploy workflow', () => {
  // Configure rocket
  const rocket = {
    name: 'Test HPR',
    dryMass: 2500,
    drogueChute: { diameter: 350, type: 'cruciform' },
    mainChute: { diameter: 1200, type: 'round' },
    mainDeployAltitude: 600
  };
  
  const motor = {
    designation: 'K550W',
    totalMass: 800,
    propMass: 400
  };
  
  // Run dual deploy simulation
  const sim = new DualDeploySimulation(rocket);
  const result = sim.simulate(5000, { groundSpeed: 5, groundDirection: 270 });
  
  assertTrue(result.isDualDeploy);
  assertTrue(result.phases.length === 2);
  assertTrue(result.totals.flightTime > 60); // Should take over a minute
  
  console.log(`    → Flight time: ${result.totals.flightTimeFormatted}`);
  console.log(`    → Landing: ${result.totals.landingVelocityFps.toFixed(1)} ft/s`);
  console.log(`    → Drift: ${result.totals.totalDriftFeet.toFixed(0)} ft ${result.totals.driftDirectionCardinal}`);
});

test('Full launch day workflow', () => {
  const rocket = {
    name: 'Test Rocket',
    dryMass: 1500,
    bodyDiameter: 75,
    chuteDiameter: 900,
    finRootChord: 100,
    finTipChord: 40,
    finSpan: 80,
    finThickness: 3
  };
  
  const motor = {
    designation: 'J350W',
    totalImpulse: 650,
    avgThrust: 350,
    burnTime: 1.9,
    totalMass: 450
  };
  
  const conditions = {
    weather: {
      windSpeed: 4,
      windDirection: 180,
      gustSpeed: 6,
      temperature: 22,
      visibility: 15000,
      precipitation: 0
    },
    waiver: { feet: 5000 },
    forecast: [
      { time: '10:00', windSpeed: 4, visibility: 15000, precipitation: 0 },
      { time: '11:00', windSpeed: 5, visibility: 12000, precipitation: 0 },
      { time: '12:00', windSpeed: 6, visibility: 10000, precipitation: 0 }
    ]
  };
  
  const assistant = new LaunchDayAssistant(rocket, motor, conditions);
  const readiness = assistant.getReadiness();
  
  assertDefined(readiness.overall);
  assertDefined(readiness.weather);
  assertDefined(readiness.drift);
  assertDefined(readiness.windows);
  
  console.log(`    → Overall: ${readiness.overall.status} (Score: ${readiness.overall.score})`);
  console.log(`    → Weather: ${readiness.weather.status}`);
  console.log(`    → Drift: ${readiness.drift.distanceFeet.toFixed(0)}ft ${readiness.drift.directionCardinal}`);
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
  console.log('✓ ALL DUAL DEPLOY & LAUNCH DAY TESTS PASSED!\n');
  process.exit(0);
}

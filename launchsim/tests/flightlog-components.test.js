/**
 * Flight Log & Component Database Tests
 * ======================================
 */

import { 
  FlightLog,
  FlightRecord,
  PredictionAnalyzer,
  FLIGHT_OUTCOMES
} from '../src/logging/flightlog.js';

import {
  ComponentDatabase,
  BodyTube,
  NoseCone,
  FinSet,
  Parachute,
  MotorMount,
  MANUFACTURERS,
  COMPONENT_TYPES,
  MATERIALS
} from '../src/database/components.js';

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
// FLIGHT LOG TESTS
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('FLIGHT RECORD TESTS');
console.log('═══════════════════════════════════════\n');

test('FlightRecord creates with defaults', () => {
  const record = new FlightRecord({});
  
  assertDefined(record.id);
  assertDefined(record.date);
  assertEqual(record.outcome, FLIGHT_OUTCOMES.UNKNOWN);
});

test('FlightRecord creates with full data', () => {
  const record = new FlightRecord({
    rocketName: 'Test Rocket',
    motorDesignation: 'J350W',
    location: 'Test Field',
    predicted: { apogee: 1000 },
    actual: { apogee: 980 }
  });
  
  assertEqual(record.rocketName, 'Test Rocket');
  assertEqual(record.motorDesignation, 'J350W');
  assertEqual(record.predicted.apogee, 1000);
  assertEqual(record.actual.apogee, 980);
});

test('FlightRecord calculates accuracy', () => {
  const record = new FlightRecord({
    predicted: { apogee: 1000, maxVelocity: 200 },
    actual: { apogee: 1050, maxVelocity: 195 }
  });
  
  const accuracy = record.getAccuracy();
  
  assertDefined(accuracy.apogee);
  assertApprox(accuracy.apogee.errorPercent, 5, 0.1, 'Apogee error');
  assertEqual(accuracy.apogee.rating, 'EXCELLENT');
  
  assertDefined(accuracy.maxVelocity);
  assertApprox(accuracy.maxVelocity.errorPercent, -2.5, 0.1, 'Velocity error');
});

test('FlightRecord hasAccuracyData', () => {
  const withData = new FlightRecord({
    predicted: { apogee: 1000 },
    actual: { apogee: 980 }
  });
  
  const noData = new FlightRecord({
    rocketName: 'Test'
  });
  
  assertTrue(withData.hasAccuracyData());
  assertTrue(!noData.hasAccuracyData());
});

test('FlightRecord toJSON', () => {
  const record = new FlightRecord({
    rocketName: 'Test',
    motorDesignation: 'F44'
  });
  
  const json = record.toJSON();
  
  assertEqual(json.rocketName, 'Test');
  assertEqual(json.motorDesignation, 'F44');
  assertDefined(json.id);
});

// ============================================
// FLIGHT LOG TESTS
// ============================================

console.log('\nFLIGHT LOG TESTS');
console.log('───────────────────────────────────────\n');

test('FlightLog creates empty', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  assertEqual(log.flights.length, 0);
});

test('FlightLog logs flight', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  const record = log.logFlight({
    rocketName: 'Test Rocket',
    motorDesignation: 'G80'
  });
  
  assertDefined(record.id);
  assertEqual(log.flights.length, 1);
  assertEqual(log.flights[0].rocketName, 'Test Rocket');
});

test('FlightLog gets flight by ID', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  const record = log.logFlight({ rocketName: 'Test' });
  const found = log.getFlight(record.id);
  
  assertEqual(found.id, record.id);
});

test('FlightLog updates flight', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  const record = log.logFlight({ rocketName: 'Test' });
  log.updateFlight(record.id, { 
    location: 'Updated Field',
    actual: { apogee: 500 }
  });
  
  const updated = log.getFlight(record.id);
  assertEqual(updated.location, 'Updated Field');
  assertEqual(updated.actual.apogee, 500);
});

test('FlightLog deletes flight', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  const record = log.logFlight({ rocketName: 'ToDelete' });
  log.deleteFlight(record.id);
  
  assertEqual(log.flights.length, 0);
});

test('FlightLog gets flights by rocket', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  log.logFlight({ rocketName: 'Alpha' });
  log.logFlight({ rocketName: 'Beta' });
  log.logFlight({ rocketName: 'Alpha' });
  
  const alphaFlights = log.getFlightsByRocket('Alpha');
  assertEqual(alphaFlights.length, 2);
});

test('FlightLog gets flights by motor', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  log.logFlight({ motorDesignation: 'F44' });
  log.logFlight({ motorDesignation: 'G80' });
  log.logFlight({ motorDesignation: 'F44' });
  
  const f44Flights = log.getFlightsByMotor('F44');
  assertEqual(f44Flights.length, 2);
});

test('FlightLog gets recent flights', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  for (let i = 0; i < 15; i++) {
    log.logFlight({ rocketName: `Flight ${i}` });
  }
  
  const recent = log.getRecentFlights(5);
  assertEqual(recent.length, 5);
});

// ============================================
// ACCURACY METRICS TESTS
// ============================================

console.log('\nACCURACY METRICS TESTS');
console.log('───────────────────────────────────────\n');

test('FlightLog calculates accuracy metrics', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  // Add flights with prediction data
  log.logFlight({
    predicted: { apogee: 1000 },
    actual: { apogee: 1050 }
  });
  log.logFlight({
    predicted: { apogee: 800 },
    actual: { apogee: 780 }
  });
  log.logFlight({
    predicted: { apogee: 1200 },
    actual: { apogee: 1260 }
  });
  
  const metrics = log.getAccuracyMetrics();
  
  assertEqual(metrics.flightCount, 3);
  assertDefined(metrics.apogee);
  assertDefined(metrics.apogee.meanError);
  assertDefined(metrics.apogee.stdDev);
  
  console.log(`    → Mean error: ${metrics.apogee.meanError.toFixed(1)}%`);
});

test('FlightLog calculates calibration factors', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  // Simulate consistent underprediction
  for (let i = 0; i < 5; i++) {
    log.logFlight({
      predicted: { apogee: 1000 },
      actual: { apogee: 1100 } // 10% underprediction
    });
  }
  
  const calibration = log.getCalibrationFactors();
  
  assertTrue(calibration.available);
  assertDefined(calibration.apogee);
  assertApprox(calibration.apogee.factor, 1.1, 0.02, 'Calibration factor');
  
  console.log(`    → Calibration factor: ${calibration.apogee.factor.toFixed(3)}`);
});

test('FlightLog statistics', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  log.logFlight({ rocketName: 'Alpha', motorDesignation: 'F44', outcome: FLIGHT_OUTCOMES.SUCCESS });
  log.logFlight({ rocketName: 'Beta', motorDesignation: 'G80', outcome: FLIGHT_OUTCOMES.SUCCESS });
  log.logFlight({ rocketName: 'Alpha', motorDesignation: 'H128', outcome: FLIGHT_OUTCOMES.PARTIAL });
  
  const stats = log.getStatistics();
  
  assertEqual(stats.flightCount, 3);
  assertEqual(stats.rockets.count, 2);
  assertEqual(stats.motors.count, 3);
  assertApprox(stats.successRate, 66.7, 1);
});

// ============================================
// EXPORT/IMPORT TESTS
// ============================================

console.log('\nEXPORT/IMPORT TESTS');
console.log('───────────────────────────────────────\n');

test('FlightLog exports to JSON', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  log.logFlight({ rocketName: 'Export Test' });
  
  const json = log.exportJSON();
  const parsed = JSON.parse(json);
  
  assertEqual(parsed.flightCount, 1);
  assertEqual(parsed.flights[0].rocketName, 'Export Test');
});

test('FlightLog imports from JSON', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  const json = JSON.stringify({
    flights: [
      { id: 'import1', rocketName: 'Imported 1' },
      { id: 'import2', rocketName: 'Imported 2' }
    ]
  });
  
  const result = log.importJSON(json);
  
  assertEqual(result.imported, 2);
  assertEqual(log.flights.length, 2);
});

test('FlightLog exports to CSV', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  log.logFlight({
    rocketName: 'CSV Test',
    motorDesignation: 'F44',
    predicted: { apogee: 500 },
    actual: { apogee: 520 }
  });
  
  const csv = log.exportCSV();
  
  assertTrue(csv.includes('CSV Test'));
  assertTrue(csv.includes('F44'));
  assertTrue(csv.includes('500'));
});

// ============================================
// PREDICTION ANALYZER TESTS
// ============================================

console.log('\nPREDICTION ANALYZER TESTS');
console.log('───────────────────────────────────────\n');

test('PredictionAnalyzer creates', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  const analyzer = new PredictionAnalyzer(log);
  
  assertDefined(analyzer);
});

test('PredictionAnalyzer identifies errors', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  // Add flights with systematic bias
  for (let i = 0; i < 5; i++) {
    log.logFlight({
      predicted: { apogee: 1000 },
      actual: { apogee: 1150 } // 15% underprediction
    });
  }
  
  const analyzer = new PredictionAnalyzer(log);
  const errors = analyzer.identifyErrors();
  
  assertTrue(errors.issues.length > 0);
  assertTrue(errors.suggestions.length > 0);
  
  console.log(`    → Issues: ${errors.issues[0]}`);
});

test('PredictionAnalyzer generates report', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  for (let i = 0; i < 5; i++) {
    log.logFlight({
      rocketName: 'Test',
      predicted: { apogee: 1000 + i * 100 },
      actual: { apogee: 1000 + i * 100 + 50 },
      outcome: FLIGHT_OUTCOMES.SUCCESS
    });
  }
  
  const analyzer = new PredictionAnalyzer(log);
  const report = analyzer.generateReport();
  
  assertDefined(report.summary);
  assertDefined(report.metrics);
  assertDefined(report.calibration);
  assertDefined(report.recommendations);
  
  console.log(`    → Overall accuracy: ${report.summary.overallAccuracy}`);
});

// ============================================
// COMPONENT DATABASE TESTS
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('COMPONENT DATABASE TESTS');
console.log('═══════════════════════════════════════\n');

test('ComponentDatabase creates with built-in components', () => {
  const db = new ComponentDatabase();
  const counts = db.getCounts();
  
  assertTrue(counts.bodyTubes > 50, 'Should have many body tubes');
  assertTrue(counts.noseCones > 10, 'Should have nose cones');
  assertTrue(counts.parachutes > 20, 'Should have parachutes');
  
  console.log(`    → Total components: ${counts.total}`);
});

test('ComponentDatabase gets body tubes by diameter', () => {
  const db = new ComponentDatabase();
  
  const tubes54 = db.getBodyTubes({ diameter: 54 });
  
  assertTrue(tubes54.length > 0);
  tubes54.forEach(t => {
    assertTrue(Math.abs(t.outerDiameter - 54) < 5);
  });
  
  console.log(`    → Found ${tubes54.length} tubes near 54mm`);
});

test('ComponentDatabase gets body tubes by manufacturer', () => {
  const db = new ComponentDatabase();
  
  const locTubes = db.getBodyTubes({ manufacturer: MANUFACTURERS.LOC });
  
  assertTrue(locTubes.length > 0);
  locTubes.forEach(t => {
    assertEqual(t.manufacturer, MANUFACTURERS.LOC);
  });
});

test('ComponentDatabase gets nose cones by diameter', () => {
  const db = new ComponentDatabase();
  
  const cones = db.getNoseCones({ diameter: 76 });
  
  assertTrue(cones.length > 0);
  console.log(`    → Found ${cones.length} nose cones for 76mm`);
});

test('ComponentDatabase gets nose cones by shape', () => {
  const db = new ComponentDatabase();
  
  const vonKarman = db.getNoseCones({ shape: 'vonKarman' });
  
  assertTrue(vonKarman.length > 0);
  vonKarman.forEach(nc => {
    assertEqual(nc.shape, 'vonKarman');
  });
});

test('ComponentDatabase gets fin sets', () => {
  const db = new ComponentDatabase();
  
  const fins = db.getFinSets({ forBodyDiameter: 76 });
  
  assertTrue(fins.length > 0);
  console.log(`    → Found ${fins.length} fin sets for 76mm body`);
});

test('ComponentDatabase gets parachutes by size', () => {
  const db = new ComponentDatabase();
  
  const chutes = db.getParachutes({ minDiameter: 600, maxDiameter: 1000 });
  
  assertTrue(chutes.length > 0);
  chutes.forEach(p => {
    assertTrue(p.diameter >= 600 && p.diameter <= 1000);
  });
  
  console.log(`    → Found ${chutes.length} parachutes 600-1000mm`);
});

test('ComponentDatabase recommends parachute for mass', () => {
  const db = new ComponentDatabase();
  
  const rec = db.recommendParachute(2000); // 2kg rocket
  
  assertTrue(rec.found);
  assertDefined(rec.recommended);
  assertTrue(rec.descentRate < 20, 'Descent rate should be under 20 fps');
  
  console.log(`    → Recommended: ${rec.recommended.name}`);
  console.log(`    → Descent rate: ${rec.descentRate.toFixed(1)} fps`);
});

test('ComponentDatabase gets parachutes for mass', () => {
  const db = new ComponentDatabase();
  
  const suitable = db.getParachutes({ forMassGrams: 1500 });
  
  assertTrue(suitable.length > 0);
  suitable.forEach(p => {
    const check = p.isSuitableFor(1500);
    assertTrue(check.suitable);
  });
});

test('ComponentDatabase search', () => {
  const db = new ComponentDatabase();
  
  const results = db.search('LOC');
  
  assertTrue(results.length > 0);
  results.forEach(r => {
    assertTrue(
      r.name.toLowerCase().includes('loc') ||
      r.manufacturer?.toLowerCase().includes('loc')
    );
  });
});

// ============================================
// COMPONENT CLASSES TESTS
// ============================================

console.log('\nCOMPONENT CLASSES TESTS');
console.log('───────────────────────────────────────\n');

test('BodyTube calculates mass', () => {
  const tube = new BodyTube({
    name: 'Test Tube',
    outerDiameter: 54,
    innerDiameter: 52,
    length: 300,
    material: MATERIALS.KRAFT_PAPER
  });
  
  assertTrue(tube.mass > 0);
  console.log(`    → Calculated mass: ${tube.mass.toFixed(1)}g`);
});

test('BodyTube gets compatible motor mounts', () => {
  const tube = new BodyTube({
    outerDiameter: 76,
    innerDiameter: 74,
    length: 300
  });
  
  const mounts = tube.getCompatibleMotorMounts();
  
  assertTrue(mounts.includes(29));
  assertTrue(mounts.includes(38));
  assertTrue(mounts.includes(54));
  assertTrue(!mounts.includes(75)); // Too big
});

test('NoseCone fits body tube', () => {
  const tube = new BodyTube({
    outerDiameter: 76,
    innerDiameter: 74,
    length: 300
  });
  
  const cone = new NoseCone({
    diameter: 76,
    length: 150,
    shoulderDiameter: 73.5
  });
  
  assertTrue(cone.fitsBodyTube(tube));
});

test('FinSet calculates area and aspect ratio', () => {
  const fins = new FinSet({
    count: 3,
    rootChord: 100,
    tipChord: 50,
    span: 75,
    thickness: 3
  });
  
  const area = fins.getArea();
  const ar = fins.getAspectRatio();
  
  assertApprox(area, 5625, 1, 'Fin area');
  assertApprox(ar, 1.0, 0.1, 'Aspect ratio');
});

test('Parachute calculates descent rate', () => {
  const chute = new Parachute({
    name: 'Test Chute',
    diameter: 914, // 36"
    parachuteType: 'round',
    cd: 0.75
  });
  
  const rate = chute.getDescentRate(2); // 2 kg
  
  assertTrue(rate > 3 && rate < 10, 'Descent rate should be reasonable');
  console.log(`    → 2kg descent rate: ${rate.toFixed(2)} m/s`);
});

test('Parachute checks suitability', () => {
  const chute = new Parachute({
    diameter: 1500, // Larger chute for slower descent
    parachuteType: 'round',
    cd: 0.75,
    maxLoadKg: 5
  });
  
  const check1 = chute.isSuitableFor(1500); // 1.5kg - should be fine
  const check2 = chute.isSuitableFor(8000); // 8kg - over load limit
  
  assertTrue(check1.suitable, `Descent rate ${check1.descentRateFps.toFixed(1)} fps should be under 20`);
  assertTrue(check1.withinLoadLimit, '1.5kg should be within 5kg limit');
  assertTrue(!check2.withinLoadLimit, '8kg should exceed 5kg limit');
});

// ============================================
// INTEGRATION TESTS
// ============================================

console.log('\nINTEGRATION TESTS');
console.log('───────────────────────────────────────\n');

test('Build rocket from components', () => {
  const db = new ComponentDatabase();
  
  // Find 76mm components
  const tubes = db.getBodyTubes({ diameter: 76 });
  const noses = db.getNoseCones({ diameter: 76 });
  const fins = db.getFinSets({ forBodyDiameter: 76 });
  
  assertTrue(tubes.length > 0, 'Should find tubes');
  assertTrue(noses.length > 0, 'Should find nose cones');
  assertTrue(fins.length > 0, 'Should find fins');
  
  // Calculate total mass
  const tube = tubes.find(t => t.length >= 400);
  const nose = noses[0];
  const finSet = fins[0];
  
  const dryMass = tube.mass + nose.mass + finSet.mass;
  
  // Find suitable parachute
  const rec = db.recommendParachute(dryMass + 200); // Add motor mass
  
  assertTrue(rec.found);
  
  console.log(`    → Tube: ${tube.name} (${tube.mass.toFixed(0)}g)`);
  console.log(`    → Nose: ${nose.name} (${nose.mass}g)`);
  console.log(`    → Fins: ${finSet.name} (${finSet.mass.toFixed(0)}g)`);
  console.log(`    → Chute: ${rec.recommended.name}`);
  console.log(`    → Total dry mass: ${dryMass.toFixed(0)}g`);
});

test('Full flight logging workflow', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  const db = new ComponentDatabase();
  
  // Log a flight
  const flight = log.logFlight({
    rocketName: 'Integration Test',
    motorDesignation: 'J350W',
    location: 'Test Field',
    outcome: FLIGHT_OUTCOMES.SUCCESS,
    predicted: { apogee: 1500, maxVelocity: 250 },
    actual: { apogee: 1480, maxVelocity: 245 },
    weather: { windSpeed: 5, temperature: 20 },
    recovery: { type: 'single', successfulDeploy: true }
  });
  
  // Check accuracy
  const accuracy = flight.getAccuracy();
  
  assertTrue(accuracy.overall.rating === 'EXCELLENT' || accuracy.overall.rating === 'GOOD');
  
  // Get stats
  const stats = log.getStatistics();
  
  assertEqual(stats.flightCount, 1);
  assertEqual(stats.successRate, 100);
  
  console.log(`    → Accuracy: ${accuracy.overall.rating}`);
  console.log(`    → Error: ${accuracy.overall.avgErrorPercent.toFixed(1)}%`);
});

test('Multi-flight accuracy analysis', () => {
  const log = new FlightLog({ autoLoad: false, autoSave: false });
  
  // Log multiple flights with varying accuracy
  const flights = [
    { predicted: 1000, actual: 1020 },  // 2% error
    { predicted: 1200, actual: 1260 },  // 5% error
    { predicted: 800, actual: 760 },    // -5% error
    { predicted: 1500, actual: 1575 },  // 5% error
    { predicted: 900, actual: 945 }     // 5% error
  ];
  
  flights.forEach((f, i) => {
    log.logFlight({
      rocketName: `Test ${i}`,
      predicted: { apogee: f.predicted },
      actual: { apogee: f.actual },
      outcome: FLIGHT_OUTCOMES.SUCCESS
    });
  });
  
  const metrics = log.getAccuracyMetrics();
  const calibration = log.getCalibrationFactors();
  
  assertEqual(metrics.flightCount, 5);
  assertTrue(calibration.available);
  
  const analyzer = new PredictionAnalyzer(log);
  const report = analyzer.generateReport();
  
  assertDefined(report.summary);
  
  console.log(`    → 5 flights analyzed`);
  console.log(`    → Avg error: ${metrics.apogee.meanAbsError.toFixed(1)}%`);
  console.log(`    → Bias: ${metrics.apogee.bias > 0 ? 'underpredicts' : 'overpredicts'} by ${Math.abs(metrics.apogee.bias).toFixed(1)}%`);
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
  console.log('✓ ALL FLIGHT LOG & COMPONENT DATABASE TESTS PASSED!\n');
  process.exit(0);
}

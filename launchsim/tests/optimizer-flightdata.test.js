/**
 * Optimization Tools and Flight Data Import Tests
 * ================================================
 */

import { 
  FlightOptimizer, 
  MotorFilter, 
  QuickSim,
  IMPULSE_CLASSES,
  STANDARD_DELAYS
} from '../src/analysis/optimizer.js';

import {
  FlightDataImporter,
  FlightDataParser,
  FlightComparison
} from '../src/analysis/flightdata.js';

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

async function asyncTest(name, fn) {
  try {
    await fn();
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

const sampleMotors = [
  {
    designation: 'F44W',
    manufacturer: 'Aerotech',
    diameter: 29,
    totalImpulse: 49.7,
    avgThrust: 44,
    burnTime: 1.13,
    totalMass: 92,
    propMass: 28
  },
  {
    designation: 'G80T',
    manufacturer: 'Aerotech',
    diameter: 29,
    totalImpulse: 120,
    avgThrust: 80,
    burnTime: 1.5,
    totalMass: 125,
    propMass: 62.5
  },
  {
    designation: 'H128W',
    manufacturer: 'Aerotech',
    diameter: 29,
    totalImpulse: 219,
    avgThrust: 128,
    burnTime: 1.71,
    totalMass: 198,
    propMass: 109
  },
  {
    designation: 'E12',
    manufacturer: 'Estes',
    diameter: 24,
    totalImpulse: 28.5,
    avgThrust: 12,
    burnTime: 2.1,
    totalMass: 44,
    propMass: 20
  },
  {
    designation: 'D12',
    manufacturer: 'Estes',
    diameter: 24,
    totalImpulse: 16.8,
    avgThrust: 12,
    burnTime: 1.6,
    totalMass: 44,
    propMass: 20
  }
];

const sampleRocket = {
  name: 'Test Rocket',
  mass: 150, // grams
  diameter: 41, // mm
  cd: 0.5,
  chuteDiameter: 450, // mm
  chuteCd: 0.8,
  motorDiameter: 29
};

const sampleFlightCSV = `Time,Altitude,Velocity
0.00,0,0
0.10,5,80
0.20,18,95
0.50,85,110
1.00,220,85
1.50,350,50
2.00,420,20
2.50,455,5
3.00,460,0
3.50,445,-15
4.00,420,-18
5.00,350,-20
6.00,280,-20
8.00,140,-20
10.00,0,-20`;

const samplePerfectFliteCSV = `# PerfectFlite StratoLogger Data
# Flight: Test Flight 1
Time(s),Altitude(ft),Velocity(ft/s)
0.00,0,0
0.10,15,260
0.50,280,360
1.00,720,280
1.50,1150,165
2.00,1380,60
2.50,1490,15
3.00,1510,0
3.50,1460,-50
4.00,1400,-60
6.00,1050,-65
8.00,700,-65
10.00,350,-65
12.00,0,-65`;

// ============================================
// QuickSim Tests
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('QUICK SIMULATION TESTS');
console.log('═══════════════════════════════════════\n');

test('QuickSim estimates apogee', () => {
  const rocket = {
    mass: 0.15, // kg
    diameter: 0.041, // m
    cd: 0.5
  };
  
  const motor = {
    totalMass: 92,
    propMass: 28,
    avgThrust: 44,
    burnTime: 1.13
  };
  
  const result = QuickSim.estimateApogee(rocket, motor);
  
  assertDefined(result.apogee);
  assertDefined(result.burnoutVelocity);
  assertDefined(result.timeToApogee);
  assertTrue(result.apogee > 0, 'Apogee should be positive');
  assertTrue(result.burnoutVelocity > 0, 'Burnout velocity should be positive');
  console.log(`    → Estimated apogee: ${result.apogee.toFixed(1)}m`);
});

test('QuickSim estimates optimal delay', () => {
  const rocket = { mass: 0.15, diameter: 0.041, cd: 0.5 };
  const motor = { totalMass: 92, propMass: 28, avgThrust: 44, burnTime: 1.13 };
  
  const result = QuickSim.estimateOptimalDelay(rocket, motor);
  
  assertDefined(result.optimal);
  assertDefined(result.recommended);
  assertTrue(result.optimal > 0, 'Delay should be positive');
  assertTrue(STANDARD_DELAYS.includes(result.recommended), 'Should be standard delay');
  console.log(`    → Optimal delay: ${result.optimal.toFixed(1)}s, Recommended: ${result.recommended}s`);
});

test('QuickSim higher impulse = higher apogee', () => {
  const rocket = { mass: 0.15, diameter: 0.041, cd: 0.5 };
  
  const lowMotor = { totalMass: 44, propMass: 20, avgThrust: 12, burnTime: 1.6 };
  const highMotor = { totalMass: 92, propMass: 28, avgThrust: 44, burnTime: 1.13 };
  
  const lowResult = QuickSim.estimateApogee(rocket, lowMotor);
  const highResult = QuickSim.estimateApogee(rocket, highMotor);
  
  assertTrue(highResult.apogee > lowResult.apogee, 
    `Higher impulse should give higher apogee: ${highResult.apogee} vs ${lowResult.apogee}`);
});

// ============================================
// Motor Filter Tests
// ============================================

console.log('\nMOTOR FILTER TESTS');
console.log('───────────────────────────────────────\n');

test('MotorFilter by diameter', () => {
  const filter = new MotorFilter(sampleMotors);
  const result = filter.filter({ diameter: 24 });
  
  assertEqual(result.length, 2, 'Should find 2 24mm motors');
  assertTrue(result.every(m => m.diameter === 24));
});

test('MotorFilter by max diameter', () => {
  const filter = new MotorFilter(sampleMotors);
  const result = filter.filter({ maxDiameter: 24 });
  
  assertEqual(result.length, 2);
  assertTrue(result.every(m => m.diameter <= 24));
});

test('MotorFilter by impulse class', () => {
  const filter = new MotorFilter(sampleMotors);
  const result = filter.filter({ impulseClass: 'G' });
  
  assertEqual(result.length, 1);
  assertEqual(result[0].designation, 'G80T');
});

test('MotorFilter by max impulse class', () => {
  const filter = new MotorFilter(sampleMotors);
  const result = filter.filter({ maxImpulseClass: 'F' });
  
  assertTrue(result.length >= 3, 'Should find D, E, and F motors');
  assertTrue(result.every(m => m.totalImpulse < 80));
});

test('MotorFilter by manufacturer', () => {
  const filter = new MotorFilter(sampleMotors);
  const result = filter.filter({ manufacturer: 'Estes' });
  
  assertEqual(result.length, 2);
  assertTrue(result.every(m => m.manufacturer === 'Estes'));
});

test('MotorFilter combined constraints', () => {
  const filter = new MotorFilter(sampleMotors);
  const result = filter.filter({
    maxDiameter: 29,
    maxImpulseClass: 'G'
  });
  
  assertTrue(result.length >= 3);
  assertTrue(result.every(m => m.diameter <= 29 && m.totalImpulse < 160));
});

test('MotorFilter get impulse class', () => {
  const filter = new MotorFilter([]);
  
  assertEqual(filter.getImpulseClass(1), '1/2A');
  assertEqual(filter.getImpulseClass(2), 'A');    // 1.26-2.5 is A
  assertEqual(filter.getImpulseClass(15), 'D');   // 10-20 is D
  assertEqual(filter.getImpulseClass(100), 'G');  // 80-160 is G
  assertEqual(filter.getImpulseClass(300), 'H');  // 160-320 is H
});

// ============================================
// FlightOptimizer Tests
// ============================================

console.log('\nFLIGHT OPTIMIZER TESTS');
console.log('───────────────────────────────────────\n');

test('FlightOptimizer initialization', () => {
  const optimizer = new FlightOptimizer(sampleRocket, sampleMotors);
  assertDefined(optimizer);
  assertDefined(optimizer.rocket);
  assertDefined(optimizer.motors);
});

await asyncTest('FlightOptimizer optimize for altitude', async () => {
  const optimizer = new FlightOptimizer(sampleRocket, sampleMotors);
  const result = await optimizer.optimizeForAltitude(300, { units: 'meters' });
  
  assertTrue(result.success, 'Optimization should succeed');
  assertDefined(result.recommendations);
  assertTrue(result.recommendations.length > 0, 'Should have recommendations');
  
  const best = result.bestMatch;
  assertDefined(best.motor);
  assertDefined(best.prediction);
  assertDefined(best.delay);
  assertDefined(best.accuracy);
  
  console.log(`    → Best: ${best.motor.designation}, Apogee: ${best.prediction.apogee.toFixed(1)}m`);
});

await asyncTest('FlightOptimizer optimize for feet', async () => {
  const optimizer = new FlightOptimizer(sampleRocket, sampleMotors);
  const result = await optimizer.optimizeForAltitude(1000, { units: 'feet' });
  
  assertTrue(result.success);
  assertEqual(result.target.units, 'feet');
  assertApprox(result.target.altitudeMeters, 304.8, 1, 'Should convert feet to meters');
});

await asyncTest('FlightOptimizer TARC mode', async () => {
  const optimizer = new FlightOptimizer(sampleRocket, sampleMotors);
  const result = await optimizer.optimizeForTARC();
  
  assertTrue(result.success);
  assertEqual(result.mode, 'TARC');
  assertEqual(result.target.altitude, 825);
  
  const best = result.bestMatch;
  assertDefined(best.tarcScoring);
  assertDefined(best.prediction.flightTime);
  
  console.log(`    → TARC Best: ${best.motor.designation}, Score: ${best.tarcScoring.tarcScore.toFixed(1)}`);
});

await asyncTest('FlightOptimizer minimum drift mode', async () => {
  const optimizer = new FlightOptimizer(sampleRocket, sampleMotors);
  const result = await optimizer.optimizeForMinimumDrift(200, { units: 'meters' });
  
  assertTrue(result.success);
  assertEqual(result.mode, 'minimumDrift');
  
  // All results should exceed minimum altitude
  for (const rec of result.recommendations) {
    assertTrue(rec.prediction.apogee >= 200, 'Should exceed minimum');
  }
});

test('FlightOptimizer delay optimization', () => {
  const optimizer = new FlightOptimizer(sampleRocket, sampleMotors);
  const motor = sampleMotors[0]; // F44W
  
  const result = optimizer.optimizeDelay(motor);
  
  assertDefined(result.recommendations);
  assertTrue(result.recommendations.length > 0);
  assertDefined(result.best);
  assertTrue(result.best.quality === 'good' || result.best.quality === 'acceptable');
});

// ============================================
// Flight Data Parser Tests
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('FLIGHT DATA PARSER TESTS');
console.log('═══════════════════════════════════════\n');

test('FlightDataParser detects delimiter', () => {
  const csvComma = 'a,b,c\n1,2,3';
  const csvTab = 'a\tb\tc\n1\t2\t3';
  const csvSemi = 'a;b;c\n1;2;3';
  
  assertEqual(FlightDataParser.detectDelimiter(csvComma), ',');
  assertEqual(FlightDataParser.detectDelimiter(csvTab), '\t');
  assertEqual(FlightDataParser.detectDelimiter(csvSemi), ';');
});

test('FlightDataParser normalizes column names', () => {
  assertEqual(FlightDataParser.normalizeColumnName('Time(s)'), 'time');
  assertEqual(FlightDataParser.normalizeColumnName('Altitude(ft)'), 'altitude');
  assertEqual(FlightDataParser.normalizeColumnName('Velocity'), 'velocity');
  assertEqual(FlightDataParser.normalizeColumnName('Baro Alt'), 'altitude');
  assertEqual(FlightDataParser.normalizeColumnName('Accel'), 'acceleration');
});

test('FlightDataParser detects format', () => {
  assertEqual(FlightDataParser.detectFormat('# PerfectFlite data'), 'perfectflite');
  assertEqual(FlightDataParser.detectFormat('Eggtimer log file'), 'eggtimer');
  assertEqual(FlightDataParser.detectFormat('time,altitude,velocity'), 'generic');
});

test('FlightDataParser parses basic CSV', () => {
  const result = FlightDataParser.parseCSV(sampleFlightCSV);
  
  assertDefined(result.headers);
  assertDefined(result.data);
  assertTrue(result.data.length > 10, 'Should parse multiple rows');
  
  // Check first data point
  assertEqual(result.data[0].time, 0);
  assertEqual(result.data[0].altitude, 0);
  
  // Check a middle point
  const midPoint = result.data.find(d => d.time === 3.0);
  assertDefined(midPoint);
  assertEqual(midPoint.altitude, 460);
});

test('FlightDataParser handles PerfectFlite format', () => {
  const result = FlightDataParser.parseCSV(samplePerfectFliteCSV);
  
  assertTrue(result.data.length > 10);
  
  // Should skip comment lines
  const firstPoint = result.data[0];
  assertEqual(firstPoint.time, 0);
});

// ============================================
// Flight Data Importer Tests
// ============================================

console.log('\nFLIGHT DATA IMPORTER TESTS');
console.log('───────────────────────────────────────\n');

test('FlightDataImporter parses content', () => {
  const importer = new FlightDataImporter();
  const result = importer.parseContent(sampleFlightCSV, 'test.csv');
  
  assertDefined(result.filename);
  assertDefined(result.trajectory);
  assertDefined(result.analysis);
  
  assertEqual(result.filename, 'test.csv');
  assertTrue(result.trajectory.length > 10);
});

test('FlightDataImporter analyzes flight data', () => {
  const importer = new FlightDataImporter();
  const result = importer.parseContent(sampleFlightCSV, 'test.csv');
  
  const a = result.analysis;
  
  assertDefined(a.apogee);
  assertDefined(a.apogeeTime);
  assertDefined(a.flightTime);
  
  // Apogee should be at t=3.0 with alt=460
  assertApprox(a.apogee, 460, 1, 'Apogee');
  assertApprox(a.apogeeTime, 3.0, 0.1, 'Apogee time');
  assertEqual(a.flightTime, 10.0);
  
  console.log(`    → Apogee: ${a.apogee.toFixed(1)}m at ${a.apogeeTime}s`);
});

test('FlightDataImporter converts feet to meters', () => {
  const importer = new FlightDataImporter();
  const result = importer.parseContent(samplePerfectFliteCSV, 'test.csv');
  
  // PerfectFlite data is in feet, should be converted
  const maxAlt = Math.max(...result.trajectory.map(t => t.altitude));
  
  // 1510 feet ≈ 460 meters
  assertApprox(maxAlt, 460, 10, 'Should convert feet to meters');
});

// ============================================
// Flight Comparison Tests
// ============================================

console.log('\nFLIGHT COMPARISON TESTS');
console.log('───────────────────────────────────────\n');

test('FlightComparison compares trajectories', () => {
  const importer = new FlightDataImporter();
  const flightData = importer.parseContent(sampleFlightCSV, 'test.csv');
  
  // Create mock simulation data (similar to actual)
  const simData = {
    trajectory: [
      { time: 0, altitude: 0 },
      { time: 1, altitude: 200 },
      { time: 2, altitude: 400 },
      { time: 3, altitude: 470 },  // Slight difference
      { time: 4, altitude: 420 },
      { time: 6, altitude: 280 },
      { time: 8, altitude: 140 },
      { time: 10, altitude: 0 }
    ]
  };
  
  const comparison = FlightComparison.compare(simData, flightData);
  
  assertDefined(comparison.simulation);
  assertDefined(comparison.actual);
  assertDefined(comparison.metrics);
  assertDefined(comparison.errors);
  assertDefined(comparison.accuracyScore);
  
  // Check metrics
  assertDefined(comparison.metrics.apogee.error);
  assertDefined(comparison.metrics.apogee.errorPercent);
  
  console.log(`    → Apogee error: ${comparison.metrics.apogee.error.toFixed(1)}m`);
  console.log(`    → RMSE: ${comparison.errors.rmse.toFixed(1)}m`);
  console.log(`    → Accuracy score: ${comparison.accuracyScore}`);
});

test('FlightComparison interpolates altitude', () => {
  const trajectory = [
    { time: 0, altitude: 0 },
    { time: 1, altitude: 100 },
    { time: 2, altitude: 200 }
  ];
  
  // Exact points
  assertEqual(FlightComparison.interpolateAltitude(trajectory, 0), 0);
  assertEqual(FlightComparison.interpolateAltitude(trajectory, 1), 100);
  
  // Interpolated point
  assertApprox(FlightComparison.interpolateAltitude(trajectory, 0.5), 50, 0.1);
  assertApprox(FlightComparison.interpolateAltitude(trajectory, 1.5), 150, 0.1);
});

test('FlightComparison computes errors', () => {
  const simTraj = [
    { time: 0, altitude: 0 },
    { time: 1, altitude: 105 },  // +5 error
    { time: 2, altitude: 190 }   // -10 error
  ];
  
  const actualTraj = [
    { time: 0, altitude: 0 },
    { time: 1, altitude: 100 },
    { time: 2, altitude: 200 }
  ];
  
  const errors = FlightComparison.computeErrors(simTraj, actualTraj);
  
  assertDefined(errors.rmse);
  assertDefined(errors.maxError);
  assertTrue(errors.rmse > 0, 'RMSE should be positive');
  assertTrue(errors.maxError >= 5, 'Max error should be at least 5');
});

test('FlightComparison accuracy score', () => {
  const perfectMetrics = {
    apogee: { errorPercent: 0 },
    apogeeTime: { error: 0 },
    maxVelocity: { errorPercent: 0 }
  };
  const perfectErrors = { rmse: 0 };
  
  const score = FlightComparison.computeAccuracyScore(perfectMetrics, perfectErrors);
  assertEqual(score, 100);
  
  // With some error
  const errorMetrics = {
    apogee: { errorPercent: 10 },
    apogeeTime: { error: 1 },
    maxVelocity: { errorPercent: 5 }
  };
  const errors = { rmse: 20 };
  
  const errorScore = FlightComparison.computeAccuracyScore(errorMetrics, errors);
  assertTrue(errorScore < 100, 'Should penalize errors');
  assertTrue(errorScore > 50, 'Should still be reasonable');
});

// ============================================
// Constants Tests
// ============================================

console.log('\nCONSTANTS TESTS');
console.log('───────────────────────────────────────\n');

test('IMPULSE_CLASSES defined correctly', () => {
  assertDefined(IMPULSE_CLASSES.A);
  assertDefined(IMPULSE_CLASSES.G);
  assertDefined(IMPULSE_CLASSES.O);
  
  assertEqual(IMPULSE_CLASSES.A.min, 1.26);
  assertEqual(IMPULSE_CLASSES.A.max, 2.5);
  assertEqual(IMPULSE_CLASSES.G.min, 80);
  assertEqual(IMPULSE_CLASSES.G.max, 160);
});

test('STANDARD_DELAYS defined', () => {
  assertTrue(STANDARD_DELAYS.length >= 5);
  assertTrue(STANDARD_DELAYS.includes(5));
  assertTrue(STANDARD_DELAYS.includes(7));
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
  console.log('✓ ALL OPTIMIZER & FLIGHT DATA TESTS PASSED!\n');
  process.exit(0);
}

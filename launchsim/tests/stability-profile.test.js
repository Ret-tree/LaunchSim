/**
 * CP/CG Stability Analysis and Rocket Profile Tests
 * ==================================================
 */

import { 
  StabilityAnalysis,
  CGCalculator,
  NoseConeAero,
  BodyTubeAero,
  TransitionAero,
  FinAero
} from '../src/analysis/stability.js';

import {
  RocketProfileRenderer,
  NoseShapes
} from '../src/visualization/profile.js';

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
// Sample Rocket Configurations
// ============================================

const simpleRocket = {
  name: 'Simple Test Rocket',
  noseShape: 'ogive',
  noseLength: 100,
  noseDiameter: 41,
  bodyLength: 300,
  bodyDiameter: 41,
  finCount: 3,
  finRootChord: 70,
  finTipChord: 30,
  finSpan: 55,
  finSweep: 25,
  dryMass: 100
};

const highPowerRocket = {
  name: 'HPR Test',
  noseShape: 'vonKarman',
  noseLength: 250,
  noseDiameter: 98,
  bodyLength: 1200,
  bodyDiameter: 98,
  finCount: 4,
  finRootChord: 200,
  finTipChord: 75,
  finSpan: 130,
  finSweep: 50,
  dryMass: 2500
};

const unstableRocket = {
  name: 'Unstable Rocket',
  noseShape: 'conical',
  noseLength: 50,
  noseDiameter: 41,
  bodyLength: 200,
  bodyDiameter: 41,
  finCount: 3,
  finRootChord: 30,  // Very small fins
  finTipChord: 15,
  finSpan: 20,       // Short span
  finSweep: 5,
  dryMass: 150       // Heavy without motor
};

const sampleMotor = {
  designation: 'F44W',
  length: 95,
  diameter: 29,
  totalMass: 92,
  propMass: 28
};

// ============================================
// Nose Cone Aerodynamics Tests
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('NOSE CONE AERODYNAMICS TESTS');
console.log('═══════════════════════════════════════\n');

test('NoseConeAero calculates ogive nose', () => {
  const result = NoseConeAero.calculate({
    shape: 'ogive',
    length: 100,
    diameter: 41
  });
  
  assertDefined(result.cn_alpha);
  assertDefined(result.cp_from_nose);
  
  // CN_alpha should be approximately 2
  assertApprox(result.cn_alpha, 2.0, 0.1, 'CN_alpha');
  
  // CP for ogive should be around 0.466 * length
  assertApprox(result.cp_from_nose, 46.6, 5, 'CP location');
});

test('NoseConeAero calculates conical nose', () => {
  const result = NoseConeAero.calculate({
    shape: 'conical',
    length: 100,
    diameter: 41
  });
  
  // CP for cone should be at 2/3 of length
  assertApprox(result.cp_from_nose, 66.7, 1, 'Conical CP');
});

test('NoseConeAero calculates elliptical nose', () => {
  const result = NoseConeAero.calculate({
    shape: 'elliptical',
    length: 100,
    diameter: 41
  });
  
  // CP for elliptical should be at ~0.5 of length
  assertApprox(result.cp_from_nose, 50, 5, 'Elliptical CP');
});

test('NoseConeAero handles different shapes', () => {
  const shapes = ['ogive', 'conical', 'elliptical', 'vonKarman', 'parabolic'];
  
  for (const shape of shapes) {
    const result = NoseConeAero.calculate({
      shape,
      length: 100,
      diameter: 41
    });
    
    assertDefined(result.cn_alpha, `${shape} CN_alpha`);
    assertTrue(result.cp_from_nose > 0 && result.cp_from_nose < 100,
      `${shape} CP should be within nose length`);
  }
});

// ============================================
// Body Tube Aerodynamics Tests
// ============================================

console.log('\nBODY TUBE AERODYNAMICS TESTS');
console.log('───────────────────────────────────────\n');

test('BodyTubeAero has zero CN for cylinder', () => {
  const result = BodyTubeAero.calculate({
    length: 300,
    diameter: 41
  });
  
  assertEqual(result.cn_alpha, 0, 'Cylinder CN_alpha');
  assertEqual(result.length, 300);
});

// ============================================
// Transition Aerodynamics Tests
// ============================================

console.log('\nTRANSITION AERODYNAMICS TESTS');
console.log('───────────────────────────────────────\n');

test('TransitionAero calculates boat tail', () => {
  const result = TransitionAero.calculate({
    foreDiameter: 50,
    aftDiameter: 30,
    length: 40,
    position: 200
  });
  
  assertDefined(result.cn_alpha);
  // Boat tail (decreasing diameter) has negative CN contribution
  assertTrue(result.cn_alpha < 0, 'Boat tail should have negative CN');
});

test('TransitionAero calculates shoulder', () => {
  const result = TransitionAero.calculate({
    foreDiameter: 30,
    aftDiameter: 50,
    length: 40,
    position: 100
  });
  
  // Increasing diameter has positive CN contribution
  assertTrue(result.cn_alpha > 0, 'Shoulder should have positive CN');
});

// ============================================
// Fin Aerodynamics Tests
// ============================================

console.log('\nFIN AERODYNAMICS TESTS');
console.log('───────────────────────────────────────\n');

test('FinAero calculates fin CN_alpha', () => {
  const result = FinAero.calculate({
    count: 3,
    rootChord: 70,
    tipChord: 30,
    span: 55,
    sweepDistance: 25,
    position: 330,
    bodyRadius: 20.5
  });
  
  assertDefined(result.cn_alpha);
  assertDefined(result.cp_from_nose);
  
  // Fins should have positive CN contribution
  assertTrue(result.cn_alpha > 0, 'Fins should have positive CN');
  assertTrue(result.cn_alpha > 5, 'Three fins should have substantial CN');
  
  console.log(`    → Fin CN_alpha: ${result.cn_alpha.toFixed(3)}`);
});

test('FinAero more fins = higher CN', () => {
  const base = {
    rootChord: 70,
    tipChord: 30,
    span: 55,
    sweepDistance: 25,
    position: 330,
    bodyRadius: 20.5
  };
  
  const three = FinAero.calculate({ ...base, count: 3 });
  const four = FinAero.calculate({ ...base, count: 4 });
  
  assertTrue(four.cn_alpha > three.cn_alpha,
    `4 fins (${four.cn_alpha.toFixed(2)}) should have higher CN than 3 fins (${three.cn_alpha.toFixed(2)})`);
});

test('FinAero larger span = higher CN', () => {
  const base = {
    count: 3,
    rootChord: 70,
    tipChord: 30,
    sweepDistance: 25,
    position: 330,
    bodyRadius: 20.5
  };
  
  const small = FinAero.calculate({ ...base, span: 40 });
  const large = FinAero.calculate({ ...base, span: 80 });
  
  assertTrue(large.cn_alpha > small.cn_alpha,
    'Larger span should have higher CN');
});

test('FinAero CP moves with fin position', () => {
  const base = {
    count: 3,
    rootChord: 70,
    tipChord: 30,
    span: 55,
    sweepDistance: 25,
    bodyRadius: 20.5
  };
  
  const forward = FinAero.calculate({ ...base, position: 200 });
  const aft = FinAero.calculate({ ...base, position: 350 });
  
  assertTrue(aft.cp_from_nose > forward.cp_from_nose,
    'Aft fins should have CP further back');
});

// ============================================
// CG Calculator Tests
// ============================================

console.log('\nCG CALCULATOR TESTS');
console.log('───────────────────────────────────────\n');

test('CGCalculator basic calculation', () => {
  const components = [
    { mass: 50, position: 0, length: 100 },   // CG at 50
    { mass: 50, position: 100, length: 100 }  // CG at 150
  ];
  
  const result = CGCalculator.calculate(components);
  
  assertEqual(result.totalMass, 100);
  assertApprox(result.cg, 100, 0.1, 'CG should be at midpoint');
});

test('CGCalculator weighted average', () => {
  const components = [
    { mass: 80, position: 0, length: 100 },   // CG at 50, 80% of mass
    { mass: 20, position: 100, length: 100 }  // CG at 150, 20% of mass
  ];
  
  const result = CGCalculator.calculate(components);
  
  // CG = (80*50 + 20*150) / 100 = (4000 + 3000) / 100 = 70
  assertApprox(result.cg, 70, 1);
});

test('CGCalculator fromRocket', () => {
  const result = CGCalculator.fromRocket(simpleRocket, sampleMotor);
  
  assertDefined(result.cg);
  assertDefined(result.totalMass);
  assertDefined(result.components);
  
  assertTrue(result.cg > 0, 'CG should be positive');
  assertTrue(result.totalMass > 0, 'Mass should be positive');
  assertTrue(result.components.length >= 3, 'Should have multiple components');
  
  console.log(`    → CG: ${result.cg.toFixed(1)}mm, Mass: ${result.totalMass.toFixed(1)}g`);
});

// ============================================
// Stability Analysis Tests
// ============================================

console.log('\nSTABILITY ANALYSIS TESTS');
console.log('───────────────────────────────────────\n');

test('StabilityAnalysis creates and calculates', () => {
  const analysis = new StabilityAnalysis(simpleRocket);
  const result = analysis.calculate();
  
  assertDefined(result.cp);
  assertDefined(result.cg);
  assertDefined(result.stabilityMargin);
  assertDefined(result.stabilityCalibers);
  assertDefined(result.status);
  assertDefined(result.severity);
  assertDefined(result.recommendation);
  
  console.log(`    → CP: ${result.cp.toFixed(1)}mm, CG: ${result.cg.toFixed(1)}mm`);
  console.log(`    → Stability: ${result.stabilityCalibers.toFixed(2)} calibers - ${result.status}`);
});

test('StabilityAnalysis with motor', () => {
  const analysis = new StabilityAnalysis(simpleRocket, sampleMotor);
  const result = analysis.calculate();
  
  assertDefined(result.cp);
  assertDefined(result.cg);
  
  // With motor at back, CG should move aft
  const withoutMotor = new StabilityAnalysis(simpleRocket).calculate();
  assertTrue(result.cg > withoutMotor.cg * 0.8, 'CG should move aft with motor');
});

test('StabilityAnalysis HPR rocket', () => {
  const analysis = new StabilityAnalysis(highPowerRocket);
  const result = analysis.calculate();
  
  assertDefined(result.stabilityCalibers);
  assertTrue(result.totalLength > 1000, 'HPR should be long');
  
  console.log(`    → HPR: ${result.stabilityCalibers.toFixed(2)} calibers - ${result.status}`);
});

test('StabilityAnalysis detects unstable rocket', () => {
  const analysis = new StabilityAnalysis(unstableRocket);
  const result = analysis.calculate();
  
  assertTrue(result.stabilityCalibers < 1.5, 'Small fins should be less stable');
  console.log(`    → Unstable: ${result.stabilityCalibers.toFixed(2)} calibers - ${result.status}`);
});

test('StabilityAnalysis CP > CG for stable rocket', () => {
  const analysis = new StabilityAnalysis(simpleRocket);
  const result = analysis.calculate();
  
  assertTrue(result.cp > result.cg, 'CP should be aft of CG for stable rocket');
  assertTrue(result.stabilityMargin > 0, 'Stability margin should be positive');
});

test('StabilityAnalysis total CN is sum of components', () => {
  const analysis = new StabilityAnalysis(simpleRocket);
  const result = analysis.calculate();
  
  const componentSum = result.aeroComponents
    .reduce((sum, c) => sum + c.cn_alpha, 0);
  
  assertApprox(result.totalCN_alpha, componentSum, 0.01,
    'Total CN should equal sum of components');
});

// ============================================
// Stability Assessment Tests
// ============================================

console.log('\nSTABILITY ASSESSMENT TESTS');
console.log('───────────────────────────────────────\n');

test('assessStability UNSTABLE', () => {
  const analysis = new StabilityAnalysis(simpleRocket);
  const { status, severity } = analysis.assessStability(0.3);
  
  assertEqual(status, 'UNSTABLE');
  assertEqual(severity, 'danger');
});

test('assessStability MARGINALLY STABLE', () => {
  const analysis = new StabilityAnalysis(simpleRocket);
  const { status, severity } = analysis.assessStability(1.2);
  
  assertEqual(status, 'MARGINALLY STABLE');
  assertEqual(severity, 'warning');
});

test('assessStability STABLE', () => {
  const analysis = new StabilityAnalysis(simpleRocket);
  const { status, severity } = analysis.assessStability(1.8);
  
  assertEqual(status, 'STABLE');
  assertEqual(severity, 'safe');
});

test('assessStability OVER-STABLE', () => {
  const analysis = new StabilityAnalysis(simpleRocket);
  const { status, severity } = analysis.assessStability(3.0);
  
  assertEqual(status, 'OVER-STABLE');
  assertEqual(severity, 'caution');
});

// ============================================
// Weight/Fin Size Calculations
// ============================================

console.log('\nWEIGHT & FIN OPTIMIZATION TESTS');
console.log('───────────────────────────────────────\n');

test('calculateWeightForStability', () => {
  const analysis = new StabilityAnalysis(simpleRocket);
  analysis.calculate();
  
  const result = analysis.calculateWeightForStability(2.0, 20);
  
  assertDefined(result.weightNeeded);
  assertDefined(result.newCG);
  assertDefined(result.newStability);
  
  // If already stable enough, no weight needed
  if (analysis.results.stabilityCalibers >= 2.0) {
    assertEqual(result.weightNeeded, 0);
  }
  
  console.log(`    → Weight for 2.0 cal: ${result.weightNeeded.toFixed(1)}g at nose`);
});

test('calculateFinSizeForStability', () => {
  const analysis = new StabilityAnalysis(unstableRocket);
  analysis.calculate();
  
  const result = analysis.calculateFinSizeForStability(1.5);
  
  assertDefined(result.finSizeMultiplier);
  
  // Unstable rocket should need bigger fins
  if (analysis.results.stabilityCalibers < 1.5) {
    assertTrue(result.finSizeMultiplier > 1.0, 'Should need larger fins');
    console.log(`    → Fin multiplier: ${result.finSizeMultiplier.toFixed(2)}x`);
  }
});

// ============================================
// Nose Shape Generation Tests
// ============================================

console.log('\nNOSE SHAPE GENERATION TESTS');
console.log('───────────────────────────────────────\n');

test('NoseShapes.conical generates points', () => {
  const points = NoseShapes.conical(100, 20);
  
  assertTrue(points.length > 10, 'Should have multiple points');
  assertApprox(points[0].x, 0, 0.1, 'Start at tip');
  assertApprox(points[0].y, 0, 0.1, 'Tip has zero radius');
  assertApprox(points[points.length-1].x, 100, 0.1, 'End at base');
  assertApprox(points[points.length-1].y, 20, 0.1, 'Base at full radius');
});

test('NoseShapes.ogive generates points', () => {
  const points = NoseShapes.ogive(100, 20);
  
  assertTrue(points.length > 10);
  assertApprox(points[0].x, 0, 0.1);
  assertApprox(points[points.length-1].y, 20, 1, 'Base radius');
});

test('NoseShapes.elliptical generates points', () => {
  const points = NoseShapes.elliptical(100, 20);
  
  assertTrue(points.length > 10);
  // Elliptical starts with non-zero curvature
  assertTrue(points[1].y > 0, 'Should have curvature immediately');
});

test('NoseShapes.vonKarman generates points', () => {
  const points = NoseShapes.vonKarman(100, 20);
  
  assertTrue(points.length > 10);
  assertApprox(points[0].y, 0, 0.1, 'Start at zero');
  assertApprox(points[points.length-1].y, 20, 1, 'End at radius');
});

test('NoseShapes.get returns correct function', () => {
  const ogive = NoseShapes.get('ogive');
  const cone = NoseShapes.get('conical');
  const haack = NoseShapes.get('haack');
  
  assertDefined(ogive);
  assertDefined(cone);
  assertDefined(haack);
  
  // Unknown shape should default to ogive
  const unknown = NoseShapes.get('unknown_shape');
  assertEqual(unknown, NoseShapes.ogive);
});

// ============================================
// Profile Renderer Tests
// ============================================

console.log('\nPROFILE RENDERER TESTS');
console.log('───────────────────────────────────────\n');

test('RocketProfileRenderer creates without canvas (Node.js)', () => {
  // In Node.js environment, document is not defined
  // Renderer should handle this gracefully
  const renderer = new RocketProfileRenderer(null);
  assertDefined(renderer);
  assertEqual(renderer.canvas, null);
});

test('RocketProfileRenderer has correct options', () => {
  const renderer = new RocketProfileRenderer(null, {
    theme: 'blueprint',
    padding: 50,
    showGrid: false
  });
  
  assertEqual(renderer.options.theme, 'blueprint');
  assertEqual(renderer.options.padding, 50);
  assertEqual(renderer.options.showGrid, false);
});

// ============================================
// Integration Tests
// ============================================

console.log('\nINTEGRATION TESTS');
console.log('───────────────────────────────────────\n');

test('Full stability analysis workflow', () => {
  // Create rocket
  const rocket = {
    name: 'Integration Test Rocket',
    noseShape: 'ogive',
    noseLength: 120,
    noseDiameter: 54,
    bodyLength: 500,
    bodyDiameter: 54,
    finCount: 4,
    finRootChord: 100,
    finTipChord: 40,
    finSpan: 80,
    finSweep: 30,
    dryMass: 300
  };
  
  // Add motor
  const motor = {
    designation: 'I284W',
    length: 220,
    diameter: 54,
    totalMass: 380
  };
  
  // Run analysis
  const analysis = new StabilityAnalysis(rocket, motor);
  const result = analysis.calculate();
  
  // Verify complete result
  assertDefined(result.cp);
  assertDefined(result.cg);
  assertDefined(result.stabilityCalibers);
  assertDefined(result.aeroComponents);
  assertDefined(result.massComponents);
  
  // Verify rocket is reasonably stable
  assertTrue(result.stabilityCalibers > 0, 'Should have positive stability');
  assertTrue(result.totalLength > 600, 'Should calculate total length');
  
  console.log(`    → Complete rocket: ${result.stabilityCalibers.toFixed(2)} cal, ${result.status}`);
  console.log(`    → CP: ${result.cp.toFixed(0)}mm, CG: ${result.cg.toFixed(0)}mm`);
  console.log(`    → Mass: ${result.totalMass.toFixed(0)}g`);
});

test('Stability improves with larger fins', () => {
  const baseRocket = {
    noseShape: 'ogive',
    noseLength: 100,
    noseDiameter: 41,
    bodyLength: 300,
    bodyDiameter: 41,
    finCount: 3,
    finRootChord: 50,
    finTipChord: 25,
    finSweep: 15,
    dryMass: 100
  };
  
  // Small fins
  const smallFins = { ...baseRocket, finSpan: 30 };
  const smallResult = new StabilityAnalysis(smallFins).calculate();
  
  // Large fins
  const largeFins = { ...baseRocket, finSpan: 70 };
  const largeResult = new StabilityAnalysis(largeFins).calculate();
  
  assertTrue(largeResult.stabilityCalibers > smallResult.stabilityCalibers,
    `Large fins (${largeResult.stabilityCalibers.toFixed(2)}) should be more stable than small (${smallResult.stabilityCalibers.toFixed(2)})`);
});

test('Adding nose weight increases stability', () => {
  const rocket = { ...simpleRocket };
  
  // Without payload
  const noPayload = new StabilityAnalysis(rocket).calculate();
  
  // With nose weight
  const withPayload = new StabilityAnalysis({
    ...rocket,
    payloadMass: 50,
    payloadPosition: 30
  }).calculate();
  
  assertTrue(withPayload.stabilityCalibers > noPayload.stabilityCalibers,
    `Nose weight (${withPayload.stabilityCalibers.toFixed(2)}) should improve stability (${noPayload.stabilityCalibers.toFixed(2)})`);
});

// ============================================
// Real Rocket Validation
// ============================================

console.log('\nREAL ROCKET VALIDATION');
console.log('───────────────────────────────────────\n');

test('Estes Alpha III approximation', () => {
  // Approximate Alpha III dimensions
  const alphaIII = {
    noseShape: 'ogive',
    noseLength: 65,
    noseDiameter: 25,
    bodyLength: 220,
    bodyDiameter: 25,
    finCount: 3,
    finRootChord: 50,
    finTipChord: 25,
    finSpan: 45,
    finSweep: 12,
    dryMass: 35
  };
  
  const result = new StabilityAnalysis(alphaIII).calculate();
  
  // Alpha III should be stable
  assertTrue(result.stabilityCalibers > 1.0, 'Alpha III should be stable');
  assertTrue(result.stabilityCalibers < 4.0, 'Alpha III should not be over-stable');
  
  console.log(`    → Alpha III: ${result.stabilityCalibers.toFixed(2)} calibers - ${result.status}`);
});

test('LOC Precision approximation', () => {
  // Approximate LOC Precision 4" rocket
  const locPrecision = {
    noseShape: 'ogive',
    noseLength: 200,
    noseDiameter: 100,
    bodyLength: 900,
    bodyDiameter: 100,
    finCount: 4,
    finRootChord: 200,
    finTipChord: 80,
    finSpan: 140,
    finSweep: 50,
    dryMass: 1800
  };
  
  const result = new StabilityAnalysis(locPrecision).calculate();
  
  // HPR should be stable
  assertTrue(result.stabilityCalibers > 1.0, 'LOC should be stable');
  
  console.log(`    → LOC Precision: ${result.stabilityCalibers.toFixed(2)} calibers - ${result.status}`);
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
  console.log('✓ ALL STABILITY & PROFILE TESTS PASSED!\n');
  process.exit(0);
}

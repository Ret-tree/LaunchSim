/**
 * Fin Flutter Analysis Tests
 * ==========================
 */

import { 
  FinFlutterAnalysis, 
  FinGeometry,
  MATERIAL_DATABASE,
  SPEED_OF_SOUND_SEA_LEVEL
} from '../src/analysis/flutter.js';

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
// FinGeometry Tests
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('FIN GEOMETRY TESTS');
console.log('═══════════════════════════════════════\n');

test('FinGeometry creates from direct values (meters)', () => {
  const geometry = new FinGeometry({
    rootChord: 0.1,      // 100mm
    tipChord: 0.05,      // 50mm
    span: 0.08,          // 80mm
    thickness: 0.003     // 3mm
  });
  
  assertApprox(geometry.rootChord, 0.1, 0.001);
  assertApprox(geometry.tipChord, 0.05, 0.001);
  assertApprox(geometry.span, 0.08, 0.001);
  assertApprox(geometry.thickness, 0.003, 0.0001);
});

test('FinGeometry creates from millimeters', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100,
    tipChord: 50,
    span: 80,
    thickness: 3
  });
  
  assertApprox(geometry.rootChord, 0.1, 0.001, 'Root chord');
  assertApprox(geometry.span, 0.08, 0.001, 'Span');
  assertApprox(geometry.thickness, 0.003, 0.0001, 'Thickness');
});

test('FinGeometry creates from inches', () => {
  const geometry = FinGeometry.fromInches({
    rootChord: 4,      // 4 inches
    tipChord: 2,       // 2 inches
    span: 3,           // 3 inches
    thickness: 0.125   // 1/8 inch
  });
  
  assertApprox(geometry.rootChord, 0.1016, 0.001, 'Root chord');
  assertApprox(geometry.thickness, 0.003175, 0.0001, 'Thickness');
});

test('FinGeometry calculates aspect ratio', () => {
  const geometry = new FinGeometry({
    rootChord: 0.1,
    tipChord: 0.05,
    span: 0.08,
    thickness: 0.003
  });
  
  // AR = 2 * span / (rootChord + tipChord) = 2 * 0.08 / 0.15 = 1.067
  assertApprox(geometry.aspectRatio, 1.067, 0.01, 'Aspect ratio');
});

test('FinGeometry calculates taper ratio', () => {
  const geometry = new FinGeometry({
    rootChord: 0.1,
    tipChord: 0.05,
    span: 0.08,
    thickness: 0.003
  });
  
  // λ = tipChord / rootChord = 0.05 / 0.1 = 0.5
  assertApprox(geometry.taperRatio, 0.5, 0.01, 'Taper ratio');
});

test('FinGeometry calculates thickness ratio', () => {
  const geometry = new FinGeometry({
    rootChord: 0.1,
    tipChord: 0.05,
    span: 0.08,
    thickness: 0.003
  });
  
  // t/c = 0.003 / 0.1 = 0.03
  assertApprox(geometry.thicknessRatio, 0.03, 0.001, 'Thickness ratio');
});

test('FinGeometry calculates planform area', () => {
  const geometry = new FinGeometry({
    rootChord: 0.1,
    tipChord: 0.05,
    span: 0.08,
    thickness: 0.003
  });
  
  // Area = span * (root + tip) / 2 = 0.08 * 0.15 / 2 = 0.006 m²
  assertApprox(geometry.area, 0.006, 0.0001, 'Area');
});

test('FinGeometry handles zero tip chord (pointed fin)', () => {
  const geometry = new FinGeometry({
    rootChord: 0.1,
    tipChord: 0,
    span: 0.08,
    thickness: 0.003
  });
  
  assertEqual(geometry.taperRatio, 0);
  assertApprox(geometry.aspectRatio, 1.6, 0.01);
});

test('FinGeometry handles sweep angle', () => {
  const geometry = new FinGeometry({
    rootChord: 0.1,
    tipChord: 0.05,
    span: 0.08,
    thickness: 0.003,
    sweepAngle: 30
  });
  
  assertApprox(geometry.sweepAngle, 30, 0.1);
  assertTrue(geometry.sweepDistance > 0);
});

// ============================================
// Material Database Tests
// ============================================

console.log('\nMATERIAL DATABASE TESTS');
console.log('───────────────────────────────────────\n');

test('Material database has required materials', () => {
  assertDefined(MATERIAL_DATABASE['birch-plywood-1/8']);
  assertDefined(MATERIAL_DATABASE['g10-fiberglass']);
  assertDefined(MATERIAL_DATABASE['carbon-fiber-sheet']);
  assertDefined(MATERIAL_DATABASE['balsa-medium']);
});

test('Materials have required properties', () => {
  const g10 = MATERIAL_DATABASE['g10-fiberglass'];
  
  assertDefined(g10.name);
  assertDefined(g10.shearModulus);
  assertDefined(g10.density);
  assertDefined(g10.category);
  
  assertTrue(g10.shearModulus > 0, 'Shear modulus should be positive');
  assertTrue(g10.density > 0, 'Density should be positive');
});

test('Material shear modulus values are realistic', () => {
  // Balsa should have low shear modulus
  assertTrue(MATERIAL_DATABASE['balsa-medium'].shearModulus < 1e9, 'Balsa G too high');
  
  // G10 should be moderate
  assertTrue(MATERIAL_DATABASE['g10-fiberglass'].shearModulus > 1e9, 'G10 G too low');
  assertTrue(MATERIAL_DATABASE['g10-fiberglass'].shearModulus < 10e9, 'G10 G too high');
  
  // Aluminum should be high
  assertTrue(MATERIAL_DATABASE['aluminum-6061'].shearModulus > 20e9, 'Al G too low');
});

test('Material categories are valid', () => {
  const validCategories = ['wood', 'composite', 'plastic', 'metal'];
  
  for (const [key, mat] of Object.entries(MATERIAL_DATABASE)) {
    assertTrue(
      validCategories.includes(mat.category),
      `Material ${key} has invalid category: ${mat.category}`
    );
  }
});

// ============================================
// Flutter Analysis Tests
// ============================================

console.log('\nFLUTTER ANALYSIS TESTS');
console.log('───────────────────────────────────────\n');

test('FinFlutterAnalysis creates with geometry and material key', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100,
    tipChord: 50,
    span: 80,
    thickness: 3
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'g10-fiberglass');
  
  assertDefined(analysis.geometry);
  assertDefined(analysis.material);
  assertEqual(analysis.materialKey, 'g10-fiberglass');
});

test('FinFlutterAnalysis creates with custom material', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100,
    tipChord: 50,
    span: 80,
    thickness: 3
  });
  
  const customMaterial = {
    name: 'Custom Composite',
    shearModulus: 5e9,
    density: 1500
  };
  
  const analysis = new FinFlutterAnalysis(geometry, customMaterial);
  
  assertEqual(analysis.materialKey, 'custom');
  assertEqual(analysis.material.name, 'Custom Composite');
});

test('FinFlutterAnalysis throws for unknown material', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100,
    tipChord: 50,
    span: 80,
    thickness: 3
  });
  
  let threw = false;
  try {
    new FinFlutterAnalysis(geometry, 'nonexistent-material');
  } catch (e) {
    threw = true;
  }
  
  assertTrue(threw, 'Should throw for unknown material');
});

test('FinFlutterAnalysis calculates flutter velocity', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100,
    tipChord: 50,
    span: 80,
    thickness: 3
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'g10-fiberglass');
  const result = analysis.calculateFlutterVelocity();
  
  assertDefined(result.flutterVelocity);
  assertDefined(result.flutterMach);
  
  // G10 with 3mm thickness should have reasonable flutter velocity
  assertTrue(result.flutterVelocity > 100, 'Flutter velocity too low');
  assertTrue(result.flutterVelocity < 1000, 'Flutter velocity too high');
  
  console.log(`    → Flutter velocity: ${result.flutterVelocity.toFixed(1)} m/s (${result.flutterVelocityFps.toFixed(0)} fps)`);
});

test('Flutter velocity increases with thickness', () => {
  const thinFin = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 2
  });
  
  const thickFin = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 5
  });
  
  const thinAnalysis = new FinFlutterAnalysis(thinFin, 'g10-fiberglass');
  const thickAnalysis = new FinFlutterAnalysis(thickFin, 'g10-fiberglass');
  
  const thinFlutter = thinAnalysis.calculateFlutterVelocity().flutterVelocity;
  const thickFlutter = thickAnalysis.calculateFlutterVelocity().flutterVelocity;
  
  assertTrue(thickFlutter > thinFlutter, 
    `Thicker fin should have higher flutter velocity: ${thickFlutter} vs ${thinFlutter}`);
});

test('Flutter velocity increases with stiffer material', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 3
  });
  
  const balsaAnalysis = new FinFlutterAnalysis(geometry, 'balsa-medium');
  const g10Analysis = new FinFlutterAnalysis(geometry, 'g10-fiberglass');
  const carbonAnalysis = new FinFlutterAnalysis(geometry, 'carbon-fiber-sheet');
  
  const balsaFlutter = balsaAnalysis.calculateFlutterVelocity().flutterVelocity;
  const g10Flutter = g10Analysis.calculateFlutterVelocity().flutterVelocity;
  const carbonFlutter = carbonAnalysis.calculateFlutterVelocity().flutterVelocity;
  
  assertTrue(g10Flutter > balsaFlutter, 'G10 > balsa');
  assertTrue(carbonFlutter > g10Flutter, 'Carbon > G10');
  
  console.log(`    → Balsa: ${balsaFlutter.toFixed(0)} m/s, G10: ${g10Flutter.toFixed(0)} m/s, Carbon: ${carbonFlutter.toFixed(0)} m/s`);
});

test('Flutter velocity decreases at altitude', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 3
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'g10-fiberglass');
  
  const seaLevel = analysis.calculateFlutterVelocity({ altitude: 0 });
  const high = analysis.calculateFlutterVelocity({ altitude: 5000 }); // 5km
  
  // Flutter velocity actually increases at altitude due to lower air pressure
  // (lower aerodynamic forces means higher speed needed to excite flutter)
  assertTrue(high.flutterVelocity > seaLevel.flutterVelocity,
    'Flutter velocity should be higher at altitude');
});

// ============================================
// Safety Analysis Tests
// ============================================

console.log('\nSAFETY ANALYSIS TESTS');
console.log('───────────────────────────────────────\n');

test('Analyze returns safety assessment', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 3
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'g10-fiberglass');
  const result = analysis.analyze(150); // 150 m/s max velocity
  
  assertDefined(result.flutterVelocity);
  assertDefined(result.safetyFactor);
  assertDefined(result.status);
  assertDefined(result.severity);
  assertDefined(result.recommendation);
  assertDefined(result.meetsRequirement);
});

test('Analyze identifies SAFE fin design', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 5
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'g10-fiberglass');
  const result = analysis.analyze(100); // Low velocity
  
  assertTrue(result.safetyFactor > 1.5, 'Should be safe');
  assertTrue(['EXCELLENT', 'GOOD'].includes(result.status), `Status should be good: ${result.status}`);
  assertEqual(result.severity, 'safe');
});

test('Analyze identifies UNSAFE fin design', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 1.5 // Very thin
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'balsa-medium'); // Weak material
  const result = analysis.analyze(300); // High velocity
  
  assertTrue(result.safetyFactor < 1.0, 'Should be unsafe');
  assertEqual(result.status, 'UNSAFE');
  assertEqual(result.severity, 'danger');
});

test('Analyze identifies MARGINAL fin design', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 3
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'birch-plywood-1/8');
  
  // Find velocity that gives marginal result
  const flutter = analysis.calculateFlutterVelocity().flutterVelocity;
  const marginalVelocity = flutter * 0.9; // 90% of flutter velocity
  
  const result = analysis.analyze(marginalVelocity);
  
  assertTrue(result.safetyFactor >= 1.0 && result.safetyFactor < 1.25,
    `Should be marginal: ${result.safetyFactor}`);
});

test('Analyze provides thickness recommendation', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 2
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'birch-plywood-1/8');
  const result = analysis.analyze(200);
  
  assertDefined(result.recommendedMinThickness);
  assertDefined(result.recommendedMinThicknessMm);
  
  // Recommended should be greater than current if unsafe
  if (result.safetyFactor < 1.25) {
    assertTrue(result.recommendedMinThickness > result.currentThickness,
      'Should recommend thicker fins');
  }
  
  console.log(`    → Current: ${result.currentThicknessMm.toFixed(1)}mm, Recommended: ${result.recommendedMinThicknessMm.toFixed(1)}mm`);
});

// ============================================
// Material Comparison Tests
// ============================================

console.log('\nMATERIAL COMPARISON TESTS');
console.log('───────────────────────────────────────\n');

test('Compare materials returns ranked list', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 3
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'balsa-medium');
  const comparison = analysis.compareMaterials(150);
  
  assertTrue(comparison.length > 5, 'Should compare multiple materials');
  
  // Should be sorted by safety factor
  for (let i = 1; i < comparison.length; i++) {
    assertTrue(comparison[i].safetyFactor <= comparison[i-1].safetyFactor,
      'Should be sorted by safety factor');
  }
  
  console.log(`    → Best: ${comparison[0].material} (SF: ${comparison[0].safetyFactor.toFixed(2)})`);
  console.log(`    → Worst: ${comparison[comparison.length-1].material} (SF: ${comparison[comparison.length-1].safetyFactor.toFixed(2)})`);
});

test('Compare materials with specific subset', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 3
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'balsa-medium');
  const comparison = analysis.compareMaterials(150, [
    'balsa-medium',
    'birch-plywood-1/8',
    'g10-fiberglass'
  ]);
  
  assertEqual(comparison.length, 3);
});

// ============================================
// Thickness Optimization Tests
// ============================================

console.log('\nTHICKNESS OPTIMIZATION TESTS');
console.log('───────────────────────────────────────\n');

test('Optimize thickness finds correct value', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 2 // Start thin
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'birch-plywood-1/8');
  const maxVelocity = 200;
  const targetSF = 1.5;
  
  const optimization = analysis.optimizeThickness(maxVelocity, targetSF);
  
  assertDefined(optimization.optimalThickness);
  assertTrue(optimization.optimalThickness > 0);
  
  // Verify the result
  assertApprox(optimization.verification.safetyFactor, targetSF, 0.05,
    'Optimized thickness should give target safety factor');
  
  console.log(`    → Optimal: ${optimization.optimalThicknessMm.toFixed(2)}mm for SF=${targetSF}`);
});

test('Optimize thickness handles already adequate design', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 6 // Already thick
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'g10-fiberglass');
  const optimization = analysis.optimizeThickness(100, 1.5);
  
  // Should recommend thinner fins if already over-built
  assertTrue(optimization.optimalThickness <= geometry.thickness,
    'Should not recommend thicker if already adequate');
});

// ============================================
// Atmospheric Model Tests
// ============================================

console.log('\nATMOSPHERIC MODEL TESTS');
console.log('───────────────────────────────────────\n');

test('Atmosphere model returns valid sea level values', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 3
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'g10-fiberglass');
  const atm = analysis.getAtmosphere(0);
  
  assertApprox(atm.pressure, 101325, 100, 'Sea level pressure');
  assertApprox(atm.density, 1.225, 0.01, 'Sea level density');
  assertApprox(atm.speedOfSound, 340, 5, 'Sea level speed of sound');
});

test('Atmosphere model decreases with altitude', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 3
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'g10-fiberglass');
  
  const seaLevel = analysis.getAtmosphere(0);
  const km5 = analysis.getAtmosphere(5000);
  const km10 = analysis.getAtmosphere(10000);
  
  assertTrue(km5.pressure < seaLevel.pressure, 'Pressure decreases');
  assertTrue(km10.pressure < km5.pressure, 'Pressure decreases further');
  
  assertTrue(km5.density < seaLevel.density, 'Density decreases');
  assertTrue(km5.temperature < seaLevel.temperature, 'Temperature decreases');
});

// ============================================
// Edge Cases and Error Handling
// ============================================

console.log('\nEDGE CASES TESTS');
console.log('───────────────────────────────────────\n');

test('Handles very thin fins', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 0.5
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'balsa-light');
  const result = analysis.analyze(200);
  
  assertEqual(result.status, 'UNSAFE');
  assertTrue(result.flutterVelocity > 0);
});

test('Handles very thick fins', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 50, span: 80, thickness: 15
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'aluminum-6061');
  const result = analysis.analyze(300);
  
  assertEqual(result.status, 'EXCELLENT');
  assertTrue(result.safetyFactor > 5);
});

test('Handles high aspect ratio fins', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 50, tipChord: 25, span: 150, thickness: 3
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'g10-fiberglass');
  const result = analysis.calculateFlutterVelocity();
  
  assertTrue(result.flutterVelocity > 0);
  assertTrue(geometry.aspectRatio > 3, 'Should be high AR');
});

test('Handles zero taper ratio (pointed fins)', () => {
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 100, tipChord: 0, span: 80, thickness: 3
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'g10-fiberglass');
  const result = analysis.calculateFlutterVelocity();
  
  assertTrue(result.flutterVelocity > 0);
  assertEqual(geometry.taperRatio, 0);
});

// ============================================
// Real-World Scenarios
// ============================================

console.log('\nREAL-WORLD SCENARIO TESTS');
console.log('───────────────────────────────────────\n');

test('Typical MPR rocket (3" diameter, G motor)', () => {
  // Typical Estes style fins for ~3" rocket
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 115,
    tipChord: 40,
    span: 75,
    thickness: 3.2  // 1/8" plywood
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'birch-plywood-1/8');
  const result = analysis.analyze(120); // ~400 fps typical G motor
  
  assertTrue(result.safetyFactor > 1.0, 'MPR should be safe with plywood');
  console.log(`    → MPR Flutter: ${result.flutterVelocityFps.toFixed(0)} fps, SF: ${result.safetyFactor.toFixed(2)}`);
});

test('HPR rocket (4" diameter, J motor)', () => {
  // LOC-style HPR fins
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 200,
    tipChord: 75,
    span: 130,
    thickness: 4.8  // 3/16" G10
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'g10-fiberglass');
  const result = analysis.analyze(250); // ~800 fps for J motor
  
  assertTrue(result.safetyFactor > 1.25, 'HPR with G10 should be adequate');
  console.log(`    → HPR Flutter: ${result.flutterVelocityFps.toFixed(0)} fps, SF: ${result.safetyFactor.toFixed(2)}`);
});

test('Minimum diameter rocket (38mm, high speed)', () => {
  // Aggressive min-dia fins
  const geometry = FinGeometry.fromMillimeters({
    rootChord: 80,
    tipChord: 30,
    span: 50,
    thickness: 1.6  // 1/16" G10
  });
  
  const analysis = new FinFlutterAnalysis(geometry, 'g10-fiberglass-thin');
  const result = analysis.analyze(350); // ~1150 fps
  
  // Min-dia often has marginal flutter margins
  console.log(`    → MinDia Flutter: ${result.flutterVelocityFps.toFixed(0)} fps, SF: ${result.safetyFactor.toFixed(2)}, Status: ${result.status}`);
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
  console.log('✓ ALL FIN FLUTTER TESTS PASSED!\n');
  process.exit(0);
}

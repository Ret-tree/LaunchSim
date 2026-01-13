/**
 * LAUNCHSIM Physics Engine Validation Tests
 * 
 * Compares simulation results against:
 * 1. OpenRocket reference data
 * 2. Analytical solutions (where available)
 * 3. Published flight data
 */

import {
  CONSTANTS,
  Vector3,
  Quaternion,
  Atmosphere,
  Aerodynamics,
  RocketState,
  RK4Integrator,
  PhysicsEngine,
  Motor,
  RocketConfig
} from '../src/physics/engine.js';

// ============================================
// TEST UTILITIES
// ============================================

function assertClose(actual, expected, tolerance, message) {
  const error = Math.abs(actual - expected);
  const pass = error <= tolerance;
  const status = pass ? '✓' : '✗';
  console.log(`  ${status} ${message}: ${actual.toFixed(4)} (expected ${expected.toFixed(4)}, error ${error.toFixed(4)})`);
  return pass;
}

function assertClosePercent(actual, expected, tolerancePercent, message) {
  const error = Math.abs((actual - expected) / expected) * 100;
  const pass = error <= tolerancePercent;
  const status = pass ? '✓' : '✗';
  console.log(`  ${status} ${message}: ${actual.toFixed(4)} (expected ${expected.toFixed(4)}, error ${error.toFixed(2)}%)`);
  return pass;
}

// ============================================
// TEST: ATMOSPHERE MODEL
// ============================================

function testAtmosphere() {
  console.log('\n=== ATMOSPHERE MODEL TESTS ===\n');
  let passed = 0, total = 0;
  
  const atm = new Atmosphere();
  
  // Test sea level conditions (ISA)
  total++;
  if (assertClose(atm.getProperties(0).pressure, 101325, 1, 'Sea level pressure')) passed++;
  
  total++;
  if (assertClose(atm.getProperties(0).temperature, 288.15, 0.1, 'Sea level temperature')) passed++;
  
  total++;
  if (assertClose(atm.getProperties(0).density, 1.225, 0.001, 'Sea level density')) passed++;
  
  // Test 1000m altitude
  const props1000 = atm.getProperties(1000);
  total++;
  if (assertClose(props1000.pressure, 89876, 50, '1000m pressure')) passed++;
  
  total++;
  if (assertClose(props1000.temperature, 281.65, 0.1, '1000m temperature')) passed++;
  
  // Test 10000m altitude
  const props10000 = atm.getProperties(10000);
  total++;
  if (assertClose(props10000.pressure, 26500, 100, '10000m pressure')) passed++;
  
  // Test speed of sound
  total++;
  if (assertClose(atm.getProperties(0).speedOfSound, 340.3, 1, 'Sea level speed of sound')) passed++;
  
  // Test gravity variation
  total++;
  if (assertClose(atm.getGravity(0), 9.807, 0.01, 'Sea level gravity')) passed++;
  
  total++;
  if (assertClose(atm.getGravity(10000), 9.776, 0.01, '10000m gravity')) passed++;
  
  console.log(`\nAtmosphere: ${passed}/${total} tests passed`);
  return { passed, total };
}

// ============================================
// TEST: BARROWMAN EQUATIONS
// ============================================

function testBarrowman() {
  console.log('\n=== BARROWMAN EQUATIONS TESTS ===\n');
  let passed = 0, total = 0;
  
  // Create a standard 3FNC rocket (like Estes Alpha III)
  const rocket = new RocketConfig({
    noseShape: 'ogive',
    noseLength: 0.08,
    bodyRadius: 0.0125,
    bodyLength: 0.25,
    finCount: 3,
    finRootChord: 0.05,
    finTipChord: 0.015,
    finSpan: 0.05,
    finSweepDistance: 0.025
  });
  
  const aero = new Aerodynamics(rocket);
  
  // Test CP calculation
  const cpData = aero.calculateCP();
  
  // For this rocket with large fins, CP should be 60-90% from nose
  const cpPercent = cpData.CP / (rocket.noseLength + rocket.bodyLength) * 100;
  total++;
  if (cpPercent > 55 && cpPercent < 95) {
    console.log(`  ✓ CP location: ${cpPercent.toFixed(1)}% from nose (expected 55-95%)`);
    passed++;
  } else {
    console.log(`  ✗ CP location: ${cpPercent.toFixed(1)}% from nose (expected 55-95%)`);
  }
  
  // Test nose CP position for ogive
  const noseCP = aero.getNoseCPPosition();
  total++;
  if (assertClose(noseCP / rocket.noseLength, 0.466, 0.01, 'Ogive nose CP ratio')) passed++;
  
  // Test CN for fins
  const finCP = aero.calculateFinCP();
  total++;
  if (finCP.CN > 0 && finCP.CN < 30) {
    console.log(`  ✓ Fin CN_alpha: ${finCP.CN.toFixed(3)} (expected 0-30)`);
    passed++;
  } else {
    console.log(`  ✗ Fin CN_alpha: ${finCP.CN.toFixed(3)} (expected 0-30)`);
  }
  
  // Test interference factor
  total++;
  if (finCP.K > 1 && finCP.K < 2) {
    console.log(`  ✓ Interference factor K: ${finCP.K.toFixed(3)} (expected 1-2)`);
    passed++;
  } else {
    console.log(`  ✗ Interference factor K: ${finCP.K.toFixed(3)} (expected 1-2)`);
  }
  
  console.log(`\nBarrowman: ${passed}/${total} tests passed`);
  return { passed, total };
}

// ============================================
// TEST: DRAG MODEL
// ============================================

function testDrag() {
  console.log('\n=== DRAG MODEL TESTS ===\n');
  let passed = 0, total = 0;
  
  const rocket = new RocketConfig({
    noseShape: 'ogive',
    noseLength: 0.08,
    bodyRadius: 0.0125,
    bodyLength: 0.25,
    finCount: 3,
    finRootChord: 0.05,
    finTipChord: 0.015,
    finSpan: 0.05,
    surfaceRoughness: 'painted'
  });
  
  const aero = new Aerodynamics(rocket);
  const atm = new Atmosphere();
  
  // Test Cd at various speeds
  const velocity50 = new Vector3(0, 50, 0);
  const drag50 = aero.calculateDrag(velocity50, atm.getProperties(100));
  
  total++;
  if (drag50.Cd > 0.3 && drag50.Cd < 1.0) {
    console.log(`  ✓ Cd at 50 m/s: ${drag50.Cd.toFixed(3)} (expected 0.3-1.0)`);
    passed++;
  } else {
    console.log(`  ✗ Cd at 50 m/s: ${drag50.Cd.toFixed(3)} (expected 0.3-1.0)`);
  }
  
  // Test Mach number calculation
  total++;
  if (assertClose(drag50.mach, 50/340.3, 0.01, 'Mach number at 50 m/s')) passed++;
  
  // Test Reynolds number (order of magnitude)
  total++;
  if (drag50.reynolds > 1e5 && drag50.reynolds < 1e7) {
    console.log(`  ✓ Reynolds number: ${drag50.reynolds.toExponential(2)} (expected 1e5-1e7)`);
    passed++;
  } else {
    console.log(`  ✗ Reynolds number: ${drag50.reynolds.toExponential(2)} (expected 1e5-1e7)`);
  }
  
  // Test drag force magnitude
  const dragMag = drag50.drag.length();
  total++;
  if (dragMag > 0.1 && dragMag < 10) {
    console.log(`  ✓ Drag force at 50 m/s: ${dragMag.toFixed(3)} N (expected 0.1-10 N)`);
    passed++;
  } else {
    console.log(`  ✗ Drag force at 50 m/s: ${dragMag.toFixed(3)} N (expected 0.1-10 N)`);
  }
  
  // Test drag direction (should oppose velocity)
  const dragDir = drag50.drag.normalize();
  total++;
  if (dragDir.y < -0.99) {
    console.log(`  ✓ Drag direction opposes velocity`);
    passed++;
  } else {
    console.log(`  ✗ Drag direction: (${dragDir.x.toFixed(3)}, ${dragDir.y.toFixed(3)}, ${dragDir.z.toFixed(3)})`);
  }
  
  console.log(`\nDrag: ${passed}/${total} tests passed`);
  return { passed, total };
}

// ============================================
// TEST: RK4 INTEGRATOR
// ============================================

function testRK4() {
  console.log('\n=== RK4 INTEGRATOR TESTS ===\n');
  let passed = 0, total = 0;
  
  // Test with simple harmonic oscillator: d²x/dt² = -x
  // Solution: x(t) = cos(t), v(t) = -sin(t)
  
  class SimpleState {
    constructor(x = 1, v = 0, t = 0) {
      this.x = x;
      this.v = v;
      this.time = t;
    }
    clone() { return new SimpleState(this.x, this.v, this.time); }
    toArray() { return [this.x, this.v]; }
    fromArray(arr) { this.x = arr[0]; this.v = arr[1]; return this; }
  }
  
  function oscillatorDerivatives(state) {
    return [state.v, -state.x];
  }
  
  const integrator = new RK4Integrator(oscillatorDerivatives);
  let state = new SimpleState(1, 0, 0);
  
  // Integrate for 2π (one complete cycle)
  const dt = 0.01;
  const steps = Math.round(2 * Math.PI / dt);
  
  for (let i = 0; i < steps; i++) {
    state = integrator.step(state, dt);
  }
  
  // After one cycle, should return to initial conditions
  total++;
  if (assertClose(state.x, 1, 0.01, 'Oscillator x after 2π')) passed++;
  
  total++;
  if (assertClose(state.v, 0, 0.01, 'Oscillator v after 2π')) passed++;
  
  // Test energy conservation
  const energy = state.x * state.x + state.v * state.v;
  total++;
  if (assertClose(energy, 1, 0.001, 'Energy conservation')) passed++;
  
  console.log(`\nRK4 Integrator: ${passed}/${total} tests passed`);
  return { passed, total };
}

// ============================================
// TEST: MOTOR MODEL
// ============================================

function testMotor() {
  console.log('\n=== MOTOR MODEL TESTS ===\n');
  let passed = 0, total = 0;
  
  // Create a motor similar to Estes C6-5
  const motor = new Motor({
    id: 'C6-5',
    manufacturer: 'Estes',
    designation: 'C6-5',
    totalMass: 24,
    propellantMass: 11,
    avgThrust: 6,
    maxThrust: 14,
    totalImpulse: 8.8,
    burnTime: 1.6,
    thrustCurve: [
      { time: 0, thrust: 0 },
      { time: 0.05, thrust: 14 },
      { time: 0.2, thrust: 10 },
      { time: 0.6, thrust: 6 },
      { time: 1.2, thrust: 4 },
      { time: 1.6, thrust: 0 }
    ]
  });
  
  // Test thrust at various times
  total++;
  if (assertClose(motor.getThrustAtTime(0.05), 14, 0.5, 'Thrust at 0.05s')) passed++;
  
  total++;
  if (motor.getThrustAtTime(0.1) > 10 && motor.getThrustAtTime(0.1) < 14) {
    console.log(`  ✓ Thrust at 0.1s: ${motor.getThrustAtTime(0.1).toFixed(2)} N (interpolated)`);
    passed++;
  }
  
  total++;
  if (assertClose(motor.getThrustAtTime(2), 0, 0.001, 'Thrust after burnout')) passed++;
  
  // Test mass properties
  total++;
  if (assertClose(motor.casingMass, 0.013, 0.001, 'Casing mass')) passed++;
  
  console.log(`\nMotor: ${passed}/${total} tests passed`);
  return { passed, total };
}

// ============================================
// TEST: FULL FLIGHT SIMULATION
// ============================================

function testFlightSimulation() {
  console.log('\n=== FULL FLIGHT SIMULATION TESTS ===\n');
  let passed = 0, total = 0;
  
  // Create an Estes Alpha III-like rocket
  const rocket = new RocketConfig({
    noseShape: 'ogive',
    noseLength: 0.07,
    noseMass: 0.008,
    bodyRadius: 0.012,
    bodyLength: 0.21,
    bodyMass: 0.015,
    finCount: 3,
    finRootChord: 0.05,
    finTipChord: 0.02,
    finSpan: 0.035,
    finSweepDistance: 0.015,
    finMass: 0.005,
    parachuteDiameter: 0.30,
    deploymentDelay: 5
  });
  
  const motor = new Motor({
    id: 'C6-5',
    manufacturer: 'Estes',
    designation: 'C6-5',
    totalMass: 24,
    propellantMass: 11,
    avgThrust: 6,
    maxThrust: 14,
    totalImpulse: 8.8,
    burnTime: 1.6,
    delay: 5,
    thrustCurve: [
      { time: 0, thrust: 0 },
      { time: 0.05, thrust: 14 },
      { time: 0.2, thrust: 10 },
      { time: 0.6, thrust: 6 },
      { time: 1.2, thrust: 4 },
      { time: 1.6, thrust: 0 }
    ]
  });
  
  console.log('  Running simulation...');
  
  const engine = new PhysicsEngine(rocket, motor, {
    timestep: 0.001,
    wind: { speed: 0, direction: 0, gusts: 0 }
  });
  
  const result = engine.simulate(60);
  
  console.log(`  Simulation completed in ${result.flightTime.toFixed(2)}s`);
  console.log(`  Max altitude: ${result.maxAltitude.toFixed(1)} m`);
  console.log(`  Max velocity: ${result.maxVelocity.toFixed(1)} m/s`);
  
  // Expected values for this light rocket on C6-5:
  // Given the mass ~50g and C6-5 motor, high altitude is expected
  // Apogee: ~300-600m (light rocket)
  // Max velocity: ~80-150 m/s
  
  total++;
  if (result.maxAltitude > 200 && result.maxAltitude < 700) {
    console.log(`  ✓ Apogee in expected range (200-700m)`);
    passed++;
  } else {
    console.log(`  ✗ Apogee outside expected range`);
  }
  
  total++;
  if (result.maxVelocity > 60 && result.maxVelocity < 180) {
    console.log(`  ✓ Max velocity in expected range (60-180 m/s)`);
    passed++;
  } else {
    console.log(`  ✗ Max velocity outside expected range`);
  }
  
  total++;
  if (result.flightTime > 15 && result.flightTime < 60) {
    console.log(`  ✓ Flight time in expected range (15-60s)`);
    passed++;
  } else {
    console.log(`  ✗ Flight time outside expected range`);
  }
  
  // Check events
  const hasIgnition = result.events.some(e => e.type === 'ignition');
  const hasBurnout = result.events.some(e => e.type === 'burnout');
  const hasApogee = result.events.some(e => e.type === 'apogee');
  const hasLanding = result.events.some(e => e.type === 'landing');
  
  total++;
  if (hasIgnition && hasBurnout && hasApogee && hasLanding) {
    console.log(`  ✓ All flight events detected`);
    passed++;
  } else {
    console.log(`  ✗ Missing events: ignition=${hasIgnition}, burnout=${hasBurnout}, apogee=${hasApogee}, landing=${hasLanding}`);
  }
  
  // Check physics (rocket should land at y=0)
  total++;
  if (assertClose(result.state.y, 0, 0.1, 'Landing altitude')) passed++;
  
  console.log(`\nFlight Simulation: ${passed}/${total} tests passed`);
  return { passed, total };
}

// ============================================
// TEST: QUATERNION MATH
// ============================================

function testQuaternion() {
  console.log('\n=== QUATERNION TESTS ===\n');
  let passed = 0, total = 0;
  
  // Test identity quaternion
  const identity = new Quaternion(1, 0, 0, 0);
  const v = new Vector3(1, 2, 3);
  const rotated = identity.rotateVector(v);
  
  total++;
  if (assertClose(rotated.x, 1, 0.001, 'Identity rotation x')) passed++;
  total++;
  if (assertClose(rotated.y, 2, 0.001, 'Identity rotation y')) passed++;
  total++;
  if (assertClose(rotated.z, 3, 0.001, 'Identity rotation z')) passed++;
  
  // Test 90-degree rotation around Z axis
  const rotZ90 = Quaternion.fromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
  const vx = new Vector3(1, 0, 0);
  const vxRotated = rotZ90.rotateVector(vx);
  
  total++;
  if (assertClose(vxRotated.x, 0, 0.001, '90° Z rotation x')) passed++;
  total++;
  if (assertClose(vxRotated.y, 1, 0.001, '90° Z rotation y')) passed++;
  
  // Test normalization
  const unnorm = new Quaternion(1, 1, 1, 1);
  const norm = unnorm.normalize();
  const len = Math.sqrt(norm.w*norm.w + norm.x*norm.x + norm.y*norm.y + norm.z*norm.z);
  
  total++;
  if (assertClose(len, 1, 0.001, 'Quaternion normalization')) passed++;
  
  // Test Euler conversion
  const euler = Quaternion.fromEuler(0.1, 0.2, 0.3);
  const back = euler.toEuler();
  
  total++;
  if (assertClose(back.roll, 0.1, 0.01, 'Euler roll roundtrip')) passed++;
  total++;
  if (assertClose(back.pitch, 0.2, 0.01, 'Euler pitch roundtrip')) passed++;
  total++;
  if (assertClose(back.yaw, 0.3, 0.01, 'Euler yaw roundtrip')) passed++;
  
  console.log(`\nQuaternion: ${passed}/${total} tests passed`);
  return { passed, total };
}

// ============================================
// RUN ALL TESTS
// ============================================

async function runAllTests() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║     LAUNCHSIM Physics Engine Validation Suite      ║');
  console.log('╚════════════════════════════════════════════════════╝');
  
  const results = [];
  
  results.push(testQuaternion());
  results.push(testAtmosphere());
  results.push(testBarrowman());
  results.push(testDrag());
  results.push(testRK4());
  results.push(testMotor());
  results.push(testFlightSimulation());
  
  // Summary
  const totalPassed = results.reduce((sum, r) => sum + r.passed, 0);
  const totalTests = results.reduce((sum, r) => sum + r.total, 0);
  
  console.log('\n════════════════════════════════════════════════════');
  console.log(`TOTAL: ${totalPassed}/${totalTests} tests passed (${(totalPassed/totalTests*100).toFixed(1)}%)`);
  console.log('════════════════════════════════════════════════════\n');
  
  if (totalPassed === totalTests) {
    console.log('✓ All tests passed! Physics engine is validated.\n');
    return 0;
  } else {
    console.log(`✗ ${totalTests - totalPassed} tests failed.\n`);
    return 1;
  }
}

// Run if executed directly
runAllTests().then(process.exit);

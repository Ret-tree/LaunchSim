/**
 * LAUNCHSIM Comprehensive Verification Suite
 * ==========================================
 * 
 * Tests all major components:
 * - Physics Engine (6-DOF, RK4, Barrowman)
 * - ThrustCurve.org API
 * - Monte Carlo Analysis
 * - HIL Interface
 * - RocketPy Backend Client
 */

// ============================================
// Test Utilities
// ============================================

const TestResults = {
  passed: 0,
  failed: 0,
  skipped: 0,
  results: []
};

function test(name, fn) {
  try {
    const result = fn();
    if (result === 'skip') {
      TestResults.skipped++;
      TestResults.results.push({ name, status: 'SKIP', message: 'Skipped' });
      console.log(`  ⊘ ${name}: SKIPPED`);
    } else {
      TestResults.passed++;
      TestResults.results.push({ name, status: 'PASS' });
      console.log(`  ✓ ${name}`);
    }
  } catch (error) {
    TestResults.failed++;
    TestResults.results.push({ name, status: 'FAIL', error: error.message });
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    const result = await fn();
    if (result === 'skip') {
      TestResults.skipped++;
      TestResults.results.push({ name, status: 'SKIP', message: 'Skipped' });
      console.log(`  ⊘ ${name}: SKIPPED`);
    } else {
      TestResults.passed++;
      TestResults.results.push({ name, status: 'PASS' });
      console.log(`  ✓ ${name}`);
    }
  } catch (error) {
    TestResults.failed++;
    TestResults.results.push({ name, status: 'FAIL', error: error.message });
    console.log(`  ✗ ${name}: ${error.message}`);
  }
}

function assertEqual(actual, expected, tolerance = 0) {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`Expected ${expected} ± ${tolerance}, got ${actual}`);
    }
  } else if (actual !== expected) {
    throw new Error(`Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition, message = 'Assertion failed') {
  if (!condition) throw new Error(message);
}

function assertInRange(value, min, max, message = '') {
  if (value < min || value > max) {
    throw new Error(`${message} Value ${value} not in range [${min}, ${max}]`);
  }
}

// ============================================
// Physics Engine Tests
// ============================================

async function testPhysicsEngine() {
  console.log('\n═══════════════════════════════════════');
  console.log('PHYSICS ENGINE TESTS');
  console.log('═══════════════════════════════════════\n');

  // Import physics module
  const physics = await import('../src/physics/engine.js');
  const { Vector3, Quaternion, Atmosphere, Aerodynamics, 
          RocketConfig, Motor, PhysicsEngine, RK4Integrator } = physics;

  // Vector3 Tests
  console.log('Vector3 Operations:');
  test('Vector3 addition', () => {
    const v1 = new Vector3(1, 2, 3);
    const v2 = new Vector3(4, 5, 6);
    const sum = v1.add(v2);
    assertEqual(sum.x, 5);
    assertEqual(sum.y, 7);
    assertEqual(sum.z, 9);
  });

  test('Vector3 cross product', () => {
    const v1 = new Vector3(1, 0, 0);
    const v2 = new Vector3(0, 1, 0);
    const cross = v1.cross(v2);
    assertEqual(cross.z, 1);
  });

  test('Vector3 normalization', () => {
    const v = new Vector3(3, 4, 0);
    const n = v.normalize();
    assertEqual(n.length(), 1, 0.0001);
  });

  // Quaternion Tests
  console.log('\nQuaternion Operations:');
  test('Quaternion identity rotation', () => {
    const q = new Quaternion(1, 0, 0, 0);
    const v = new Vector3(1, 2, 3);
    const rotated = q.rotateVector(v);
    assertEqual(rotated.x, 1, 0.001);
    assertEqual(rotated.y, 2, 0.001);
    assertEqual(rotated.z, 3, 0.001);
  });

  test('Quaternion 90° rotation', () => {
    const q = Quaternion.fromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
    const v = new Vector3(1, 0, 0);
    const rotated = q.rotateVector(v);
    assertEqual(rotated.x, 0, 0.001);
    assertEqual(rotated.y, 1, 0.001);
  });

  test('Quaternion Euler roundtrip', () => {
    const q = Quaternion.fromEuler(0.1, 0.2, 0.3);
    const euler = q.toEuler();
    assertEqual(euler.roll, 0.1, 0.01);
    assertEqual(euler.pitch, 0.2, 0.01);
    assertEqual(euler.yaw, 0.3, 0.01);
  });

  // Atmosphere Tests
  console.log('\nAtmosphere Model:');
  test('Sea level pressure', () => {
    const atm = new Atmosphere();
    const props = atm.getProperties(0);
    assertEqual(props.pressure, 101325, 1);
  });

  test('Sea level temperature', () => {
    const atm = new Atmosphere();
    const props = atm.getProperties(0);
    assertEqual(props.temperature, 288.15, 0.1);
  });

  test('Pressure decreases with altitude', () => {
    const atm = new Atmosphere();
    const p0 = atm.getProperties(0).pressure;
    const p1000 = atm.getProperties(1000).pressure;
    const p5000 = atm.getProperties(5000).pressure;
    assertTrue(p1000 < p0, 'Pressure should decrease at 1000m');
    assertTrue(p5000 < p1000, 'Pressure should decrease at 5000m');
  });

  test('Speed of sound calculation', () => {
    const atm = new Atmosphere();
    const props = atm.getProperties(0);
    assertEqual(props.speedOfSound, 340.3, 1);
  });

  // Barrowman Tests
  console.log('\nBarrowman Equations:');
  test('CP location for standard rocket', () => {
    const rocket = new RocketConfig({
      noseShape: 'ogive',
      noseLength: 0.1,
      bodyRadius: 0.02,
      bodyLength: 0.3,
      finCount: 3,
      finRootChord: 0.06,
      finTipChord: 0.02,
      finSpan: 0.05,
      finSweepDistance: 0.03
    });
    const aero = new Aerodynamics(rocket);
    const cp = aero.calculateCP();
    
    assertTrue(cp.CP > 0, 'CP should be positive');
    assertTrue(cp.CP < rocket.noseLength + rocket.bodyLength, 'CP should be within rocket');
    assertTrue(cp.CN > 0, 'CN should be positive');
  });

  test('Ogive nose CP position', () => {
    const rocket = new RocketConfig({ noseShape: 'ogive', noseLength: 0.1 });
    const aero = new Aerodynamics(rocket);
    const noseCP = aero.getNoseCPPosition();
    assertEqual(noseCP / rocket.noseLength, 0.466, 0.01);
  });

  // Motor Tests
  console.log('\nMotor Model:');
  test('Motor thrust interpolation', () => {
    const motor = new Motor({
      id: 'test',
      manufacturer: 'Test',
      designation: 'T100',
      totalMass: 50,
      propellantMass: 30,
      avgThrust: 10,
      maxThrust: 15,
      totalImpulse: 20,
      burnTime: 2.0,
      thrustCurve: [[0, 0], [0.1, 15], [1.0, 10], [2.0, 0]]
    });
    
    assertEqual(motor.getThrustAtTime(0.1), 15, 0.1);
    assertEqual(motor.getThrustAtTime(1.0), 10, 0.1);
    assertEqual(motor.getThrustAtTime(3.0), 0, 0.1);
  });

  // RK4 Integrator Tests
  console.log('\nRK4 Integrator:');
  test('RK4 harmonic oscillator', () => {
    class SimpleState {
      constructor(x = 1, v = 0, t = 0) {
        this.x = x; this.v = v; this.time = t;
      }
      clone() { return new SimpleState(this.x, this.v, this.time); }
      toArray() { return [this.x, this.v]; }
      fromArray(arr) { this.x = arr[0]; this.v = arr[1]; return this; }
    }

    const integrator = new RK4Integrator(state => [state.v, -state.x]);
    let state = new SimpleState(1, 0, 0);
    
    // Integrate for 2π (one cycle)
    const dt = 0.01;
    for (let i = 0; i < Math.round(2 * Math.PI / dt); i++) {
      state = integrator.step(state, dt);
    }
    
    assertEqual(state.x, 1, 0.02);
    assertEqual(state.v, 0, 0.02);
  });

  // Full Simulation Test
  console.log('\nFull Flight Simulation:');
  test('Complete flight simulation', () => {
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
      finMass: 0.005
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
      thrustCurve: [[0, 0], [0.05, 14], [0.2, 10], [0.6, 6], [1.2, 4], [1.6, 0]]
    });

    const engine = new PhysicsEngine(rocket, motor, {
      timestep: 0.001,
      wind: { speed: 0, direction: 0, gusts: 0 }
    });

    const result = engine.simulate(60);
    
    assertTrue(result.maxAltitude > 100, `Apogee too low: ${result.maxAltitude}`);
    assertTrue(result.maxAltitude < 1000, `Apogee too high: ${result.maxAltitude}`);
    assertTrue(result.maxVelocity > 30, `Max velocity too low: ${result.maxVelocity}`);
    assertTrue(result.flightTime > 5, `Flight time too short: ${result.flightTime}`);
    assertTrue(result.events.some(e => e.type === 'apogee'), 'Should have apogee event');
    assertTrue(result.events.some(e => e.type === 'burnout'), 'Should have burnout event');
  });
}

// ============================================
// ThrustCurve API Tests
// ============================================

async function testThrustCurveAPI() {
  console.log('\n═══════════════════════════════════════');
  console.log('THRUSTCURVE.ORG API TESTS');
  console.log('═══════════════════════════════════════\n');

  const { ThrustCurveAPI, MotorDatabaseManager } = await import('../src/api/thrustcurve.js');

  const api = new ThrustCurveAPI({ timeout: 10000 });

  console.log('API Initialization:');
  test('ThrustCurveAPI instantiation', () => {
    assertTrue(api.baseUrl.includes('thrustcurve.org'));
  });

  console.log('\nOffline Database:');
  await testAsync('Load offline database from CDN', async () => {
    try {
      const db = await api.loadOfflineDatabase();
      assertTrue(Array.isArray(db), 'Database should be array');
      assertTrue(db.length > 500, `Database should have 500+ motors, got ${db.length}`);
      console.log(`    → Loaded ${db.length} motors`);
    } catch (e) {
      if (e.message.includes('fetch')) return 'skip';
      throw e;
    }
  });

  await testAsync('Search offline database', async () => {
    if (!api.offlineDB) return 'skip';
    
    const results = api.searchOffline({ impulseClass: 'G', manufacturer: 'Aerotech' });
    assertTrue(results.length > 0, 'Should find Aerotech G motors');
    assertTrue(results.every(m => m.impulseClass === 'G'), 'All should be G class');
    console.log(`    → Found ${results.length} Aerotech G motors`);
  });

  await testAsync('Search by name', async () => {
    if (!api.offlineDB) return 'skip';
    
    const results = api.searchOffline({ commonName: 'H128' });
    assertTrue(results.length > 0, 'Should find H128');
    console.log(`    → Found ${results.length} H128 variants`);
  });

  console.log('\nData Conversion:');
  test('Convert to LAUNCHSIM format', () => {
    const tcMotor = {
      motorId: 'test123',
      manufacturer: 'Aerotech',
      commonName: 'G80',
      impulseClass: 'G',
      diameter: 29,
      length: 124,
      totWeightG: 125,
      propWeightG: 62.5,
      avgThrustN: 80,
      maxThrustN: 115,
      burnTimeS: 1.5,
      totImpulseNs: 120,
      samples: [[0, 0], [0.1, 115], [0.5, 90], [1.0, 70], [1.5, 0]]
    };

    const converted = api.tolaunchsimFormat(tcMotor);
    
    assertEqual(converted.id, 'test123');
    assertEqual(converted.manufacturer, 'Aerotech');
    assertEqual(converted.commonName, 'G80');
    assertEqual(converted.avgThrust, 80);
    assertTrue(converted.thrustCurve.length > 0, 'Should have thrust curve');
  });

  console.log('\nMotor Database Manager:');
  test('Manager instantiation', () => {
    const manager = new MotorDatabaseManager();
    assertTrue(manager.api instanceof ThrustCurveAPI);
  });

  test('Favorites functionality', () => {
    const manager = new MotorDatabaseManager();
    manager.addFavorite('motor123');
    assertTrue(manager.isFavorite('motor123'));
    manager.removeFavorite('motor123');
    assertTrue(!manager.isFavorite('motor123'));
  });

  test('Recent motors tracking', () => {
    const manager = new MotorDatabaseManager();
    manager.addToRecent({ id: 'motor1', commonName: 'G80' });
    manager.addToRecent({ id: 'motor2', commonName: 'H128' });
    
    const recent = manager.getRecent();
    assertEqual(recent.length, 2);
    assertEqual(recent[0].id, 'motor2');  // Most recent first
  });
}

// ============================================
// Monte Carlo Tests
// ============================================

async function testMonteCarlo() {
  console.log('\n═══════════════════════════════════════');
  console.log('MONTE CARLO ANALYSIS TESTS');
  console.log('═══════════════════════════════════════\n');

  const { RandomGenerators, ParameterVariation, MonteCarloEngine, TARCScoring } = 
    await import('../src/analysis/montecarlo.js');

  console.log('Random Generators:');
  test('Gaussian distribution mean', () => {
    const samples = Array(10000).fill(0).map(() => RandomGenerators.gaussian(100, 10));
    const mean = samples.reduce((a, b) => a + b) / samples.length;
    assertInRange(mean, 98, 102, 'Gaussian mean');
  });

  test('Gaussian distribution stdDev', () => {
    const samples = Array(10000).fill(0).map(() => RandomGenerators.gaussian(0, 10));
    const mean = samples.reduce((a, b) => a + b) / samples.length;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;
    const stdDev = Math.sqrt(variance);
    assertInRange(stdDev, 9, 11, 'Gaussian stdDev');
  });

  test('Uniform distribution', () => {
    const samples = Array(10000).fill(0).map(() => RandomGenerators.uniform(0, 100));
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    assertTrue(min >= 0, 'Uniform min');
    assertTrue(max <= 100, 'Uniform max');
  });

  test('Bernoulli trials', () => {
    const samples = Array(10000).fill(0).map(() => RandomGenerators.bernoulli(0.3));
    const successRate = samples.filter(s => s).length / samples.length;
    assertInRange(successRate, 0.27, 0.33, 'Bernoulli rate');
  });

  console.log('\nParameter Variation:');
  test('ParameterVariation instantiation', () => {
    const pv = new ParameterVariation();
    assertTrue(pv.mass.distribution === 'gaussian');
    assertTrue(pv.thrust.stdDev > 0);
  });

  test('Config randomization', () => {
    const pv = new ParameterVariation({ massStdDev: 0.01 });
    const baseConfig = {
      rocket: { mass: 0.5, motor: { avg_thrust: 10, burn_time: 1.5 } },
      flight: { inclination: 85, heading: 0 },
      environment: { wind_speed: 5, wind_direction: 90 }
    };
    
    const randomized = pv.randomizeConfig(baseConfig);
    
    assertTrue(randomized.rocket.mass !== baseConfig.rocket.mass || 
               randomized.flight.inclination !== baseConfig.flight.inclination,
               'Should randomize some values');
  });

  console.log('\nMonte Carlo Engine:');
  test('MonteCarloEngine instantiation', () => {
    const mockSimulator = async (config) => ({
      success: true,
      apogee: 200 + RandomGenerators.gaussian(0, 20),
      flightTime: 15 + RandomGenerators.gaussian(0, 2),
      landingPosition: [RandomGenerators.gaussian(0, 30), RandomGenerators.gaussian(0, 30)],
      landingVelocity: 5
    });
    
    const mc = new MonteCarloEngine(mockSimulator, { numSimulations: 10 });
    assertTrue(mc.options.numSimulations === 10);
  });

  await testAsync('Run Monte Carlo analysis', async () => {
    const mockSimulator = async (config) => ({
      success: true,
      apogee: 200 + RandomGenerators.gaussian(0, 20),
      flightTime: 15 + RandomGenerators.gaussian(0, 2),
      landingPosition: [RandomGenerators.gaussian(0, 30), RandomGenerators.gaussian(0, 30)],
      landingVelocity: 5 + RandomGenerators.gaussian(0, 1)
    });

    const mc = new MonteCarloEngine(mockSimulator, { numSimulations: 50, parallelism: 10 });
    
    const results = await mc.run({
      rocket: { mass: 0.5 },
      flight: { inclination: 85 }
    });

    assertTrue(results.success, 'MC should succeed');
    assertEqual(results.numSimulations, 50);
    assertTrue(results.apogee.mean > 0, 'Should have apogee mean');
    assertTrue(results.apogee.stdDev > 0, 'Should have apogee stdDev');
    assertTrue(results.landing.positions.length > 0, 'Should have landing positions');
    
    console.log(`    → Apogee: ${results.apogee.mean.toFixed(1)} ± ${results.apogee.stdDev.toFixed(1)} m`);
    console.log(`    → Landing dispersion 95%: ${results.landing.dispersion95.toFixed(1)} m`);
  });

  console.log('\nTARC Scoring:');
  test('TARC score calculation', () => {
    const tarc = new TARCScoring(2025);
    
    // Perfect score
    const perfect = tarc.calculateScore(251.46, 43);  // 825 feet = 251.46m
    assertEqual(perfect.score, 0, 1);
    assertTrue(perfect.qualified.qualified, 'Perfect flight should qualify');
    
    // Off-target
    const offTarget = tarc.calculateScore(200, 40);  // 656 feet, 40s
    assertTrue(offTarget.score > 0, 'Off-target should have positive score');
    assertTrue(offTarget.altitudeError > 100, 'Should have altitude error');
  });

  test('TARC qualification check', () => {
    const tarc = new TARCScoring(2025);
    
    // Too low
    const tooLow = tarc.checkQualification(150, 43);  // ~492 feet
    assertTrue(!tooLow.qualified, 'Too low should not qualify');
    
    // Too high
    const tooHigh = tarc.checkQualification(350, 43);  // ~1148 feet
    assertTrue(!tooHigh.qualified, 'Too high should not qualify');
    
    // Good
    const good = tarc.checkQualification(250, 43);  // ~820 feet
    assertTrue(good.qualified, 'Good flight should qualify');
  });
}

// ============================================
// HIL Interface Tests
// ============================================

async function testHIL() {
  console.log('\n═══════════════════════════════════════');
  console.log('HARDWARE-IN-LOOP INTERFACE TESTS');
  console.log('═══════════════════════════════════════\n');

  const { SensorSimulator, BinaryProtocol, ASCIIProtocol, FlightComputerEmulator } = 
    await import('../src/hil/interface.js');

  console.log('Sensor Simulator:');
  test('SensorSimulator instantiation', () => {
    const sim = new SensorSimulator();
    assertTrue(sim.config.accelNoise > 0);
    assertTrue(sim.config.gyroNoise > 0);
  });

  test('Accelerometer simulation with noise', () => {
    const sim = new SensorSimulator({ accelNoise: 0.1 });
    const readings = [];
    
    for (let i = 0; i < 100; i++) {
      const accel = sim.simulateAccelerometer([0, 9.81, 0], 0.001);
      readings.push(accel.y);
    }
    
    const mean = readings.reduce((a, b) => a + b) / readings.length;
    assertInRange(mean, 9.5, 10.1, 'Accelerometer mean');
  });

  test('Gyroscope drift', () => {
    const sim = new SensorSimulator({ gyroDrift: 0.001 });
    
    // Simulate over time
    for (let i = 0; i < 1000; i++) {
      sim.simulateGyroscope([0, 0, 0], 0.001);
    }
    
    // Bias should have accumulated
    const biasNorm = Math.sqrt(
      sim.gyroBiasAccum[0]**2 + 
      sim.gyroBiasAccum[1]**2 + 
      sim.gyroBiasAccum[2]**2
    );
    assertTrue(biasNorm > 0, 'Gyro should have accumulated drift');
  });

  test('Barometer simulation', () => {
    const sim = new SensorSimulator({ baroNoise: 10 });
    const readings = [];
    
    for (let i = 0; i < 100; i++) {
      const baro = sim.simulateBarometer(101325, 293.15, 0.001);
      readings.push(baro.pressure);
    }
    
    const mean = readings.reduce((a, b) => a + b) / readings.length;
    assertInRange(mean, 101000, 101700, 'Barometer mean');
  });

  console.log('\nProtocol Handlers:');
  test('Binary protocol encoding', () => {
    const proto = new BinaryProtocol();
    const sensors = {
      timestamp: 1234,
      accel: { x: 0.1, y: 9.81, z: 0.05 },
      gyro: { x: 0.001, y: 0.002, z: 0.003 },
      baro: { pressure: 101325, temperature: 293.15 },
      mag: { x: 20, y: 0, z: 45 },
      gps: null
    };
    
    const packet = proto.encodeSensorPacket(sensors);
    assertTrue(packet instanceof Uint8Array, 'Should return Uint8Array');
    assertTrue(packet[0] === 0xAA, 'Should have sync byte');
    assertTrue(packet.length > 20, 'Packet should have data');
  });

  test('ASCII protocol encoding', () => {
    const proto = new ASCIIProtocol();
    const sensors = {
      timestamp: 1234,
      accel: { x: 0.1, y: 9.81, z: 0.05 },
      gyro: { x: 0.001, y: 0.002, z: 0.003 },
      baro: { pressure: 101325, temperature: 293.15 },
      mag: { x: 20, y: 0, z: 45 },
      gps: { valid: true, latitude: 32.99, longitude: -106.97, altitude: 1400 }
    };
    
    const packet = proto.encodeSensorPacket(sensors);
    const text = new TextDecoder().decode(packet);
    assertTrue(text.startsWith('SENS'), 'Should start with SENS');
    assertTrue(text.includes(','), 'Should be comma separated');
  });

  console.log('\nFlight Computer Emulator:');
  test('Emulator PID controller', () => {
    const emulator = new FlightComputerEmulator({ kP: 2.0, kI: 0.1, kD: 0.5 });
    emulator.arm();
    
    // Simulate tilted rocket
    emulator.estimatedPitch = 0.1;  // 5.7 degrees
    
    const command = emulator.runPIDController(0.01);
    assertTrue(command.type === 'gimbal', 'Should output gimbal command');
    assertTrue(Math.abs(command.x) > 0, 'Should have pitch correction');
  });
}

// ============================================
// RocketPy Backend Client Tests
// ============================================

async function testRocketPyClient() {
  console.log('\n═══════════════════════════════════════');
  console.log('ROCKETPY BACKEND CLIENT TESTS');
  console.log('═══════════════════════════════════════\n');

  const { RocketPyClient, ResultFormatter, LaunchSimIntegration } = 
    await import('../src/client/rocketpy-client.js');

  console.log('Client Instantiation:');
  test('RocketPyClient creation', () => {
    const client = new RocketPyClient('http://localhost:8000');
    assertEqual(client.baseUrl, 'http://localhost:8000');
    assertTrue(client.timeout > 0);
  });

  test('Build simulation config', () => {
    const client = new RocketPyClient();
    
    const rocketConfig = {
      noseShape: 'ogive',
      noseLength: 80,
      bodyDiameter: 41,
      bodyLength: 300,
      finCount: 3,
      finRoot: 70,
      finTip: 25,
      finSpan: 55,
      finSweep: 30,
      chuteSize: 18
    };

    const motorConfig = {
      id: 'C6-5',
      burnTime: 1.6,
      avgThrust: 6,
      propMass: 10.8,
      totalMass: 24.0
    };

    const simConfig = client.buildSimulationConfig(rocketConfig, motorConfig, {
      windSpeed: 5,
      inclination: 85
    });

    assertTrue(simConfig.rocket !== undefined, 'Should have rocket config');
    assertTrue(simConfig.flight !== undefined, 'Should have flight config');
    assertTrue(simConfig.environment !== undefined, 'Should have environment config');
    assertEqual(simConfig.flight.inclination, 85);
  });

  console.log('\nResult Formatter:');
  test('Format summary', () => {
    const result = {
      success: true,
      apogee: 250.5,
      apogee_time: 5.2,
      max_velocity: 85.3,
      max_mach: 0.25,
      max_acceleration: 50,
      flight_time: 18.5,
      landing_velocity: 5.2,
      stability_margin_initial: 2.1,
      stability_margin_burnout: 2.5,
      out_of_rail_velocity: 15.0
    };

    const summary = ResultFormatter.formatSummary(result);
    assertTrue(summary.includes('250.5'), 'Should include apogee');
    assertTrue(summary.includes('SIMULATION RESULTS'), 'Should have header');
  });

  test('Format events', () => {
    const events = [
      { name: 'liftoff', time: 0, altitude: 0 },
      { name: 'burnout', time: 1.6 },
      { name: 'apogee', time: 5.2, altitude: 250.5 }
    ];

    const formatted = ResultFormatter.formatEvents(events);
    assertTrue(formatted.includes('liftoff'), 'Should include liftoff');
    assertTrue(formatted.includes('apogee'), 'Should include apogee');
  });

  console.log('\nIntegration Helper:');
  test('LaunchSimIntegration creation', () => {
    const integration = new LaunchSimIntegration({
      serverUrl: 'http://localhost:8000'
    });
    assertTrue(integration.client instanceof RocketPyClient);
    assertTrue(!integration.useBackend);  // Not initialized yet
  });
}

// ============================================
// Run All Tests
// ============================================

async function runAllTests() {
  console.log('╔═══════════════════════════════════════════════════════╗');
  console.log('║    LAUNCHSIM COMPREHENSIVE VERIFICATION SUITE         ║');
  console.log('╚═══════════════════════════════════════════════════════╝');

  const startTime = Date.now();

  try {
    await testPhysicsEngine();
  } catch (e) {
    console.error('Physics Engine tests crashed:', e);
  }

  try {
    await testThrustCurveAPI();
  } catch (e) {
    console.error('ThrustCurve API tests crashed:', e);
  }

  try {
    await testMonteCarlo();
  } catch (e) {
    console.error('Monte Carlo tests crashed:', e);
  }

  try {
    await testHIL();
  } catch (e) {
    console.error('HIL tests crashed:', e);
  }

  try {
    await testRocketPyClient();
  } catch (e) {
    console.error('RocketPy Client tests crashed:', e);
  }

  const duration = (Date.now() - startTime) / 1000;

  // Summary
  console.log('\n═══════════════════════════════════════');
  console.log('TEST SUMMARY');
  console.log('═══════════════════════════════════════');
  console.log(`Duration: ${duration.toFixed(2)}s`);
  console.log(`Passed:   ${TestResults.passed}`);
  console.log(`Failed:   ${TestResults.failed}`);
  console.log(`Skipped:  ${TestResults.skipped}`);
  console.log(`Total:    ${TestResults.passed + TestResults.failed + TestResults.skipped}`);
  console.log('═══════════════════════════════════════\n');

  if (TestResults.failed > 0) {
    console.log('FAILED TESTS:');
    TestResults.results
      .filter(r => r.status === 'FAIL')
      .forEach(r => console.log(`  ✗ ${r.name}: ${r.error}`));
    console.log('');
  }

  const successRate = TestResults.passed / (TestResults.passed + TestResults.failed) * 100;
  if (successRate === 100) {
    console.log('✓ ALL TESTS PASSED!\n');
    return 0;
  } else {
    console.log(`✗ ${TestResults.failed} tests failed (${successRate.toFixed(1)}% pass rate)\n`);
    return 1;
  }
}

// Run tests
runAllTests().then(process.exit);

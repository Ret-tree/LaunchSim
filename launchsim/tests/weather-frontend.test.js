/**
 * Weather API and Frontend Integration Tests
 * ==========================================
 */

import { WeatherAPI, WEATHER_CODES } from '../src/api/weather.js';
import { LaunchSimApp, AppState } from '../src/frontend/app.js';

// Test Results
const TestResults = {
  passed: 0,
  failed: 0,
  skipped: 0,
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

function skip(name, reason) {
  TestResults.skipped++;
  TestResults.results.push({ name, status: 'SKIP', reason });
  console.log(`  ⊘ ${name} (skipped: ${reason})`);
}

async function asyncTest(name, fn) {
  try {
    await fn();
    TestResults.passed++;
    TestResults.results.push({ name, status: 'PASS' });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    if (error.message.includes('fetch') || error.message.includes('network') || 
        error.message.includes('timed out') || error.message.includes('ENOTFOUND')) {
      TestResults.skipped++;
      TestResults.results.push({ name, status: 'SKIP', reason: 'Network unavailable' });
      console.log(`  ⊘ ${name} (skipped: network unavailable)`);
    } else {
      TestResults.failed++;
      TestResults.results.push({ name, status: 'FAIL', error: error.message });
      console.log(`  ✗ ${name}: ${error.message}`);
    }
  }
}

function assertEqual(actual, expected, tolerance = 0) {
  if (typeof actual === 'number' && typeof expected === 'number') {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`Expected ${expected} ± ${tolerance}, got ${actual}`);
    }
  } else if (actual !== expected) {
    throw new Error(`Expected "${expected}", got "${actual}"`);
  }
}

function assertTrue(condition, message = 'Assertion failed') {
  if (!condition) throw new Error(message);
}

function assertDefined(value, message = 'Value is undefined') {
  if (value === undefined || value === null) throw new Error(message);
}

// ============================================
// Weather API Tests
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('WEATHER API TESTS');
console.log('═══════════════════════════════════════\n');

console.log('Weather Codes:');

test('Weather codes defined', () => {
  assertTrue(Object.keys(WEATHER_CODES).length > 20, 'Should have many weather codes');
  assertEqual(WEATHER_CODES[0], 'Clear sky');
  assertEqual(WEATHER_CODES[95], 'Thunderstorm');
});

test('All WMO codes have descriptions', () => {
  const expectedCodes = [0, 1, 2, 3, 45, 48, 51, 53, 55, 61, 63, 65, 71, 73, 75, 80, 81, 82, 95, 96, 99];
  expectedCodes.forEach(code => {
    assertTrue(WEATHER_CODES[code] !== undefined, `Code ${code} should have description`);
  });
});

console.log('\nWeatherAPI Class:');

test('WeatherAPI instantiation', () => {
  const api = new WeatherAPI();
  assertDefined(api);
  assertEqual(api.baseUrl, 'https://api.open-meteo.com/v1');
  assertEqual(api.timeout, 10000);
});

test('WeatherAPI with custom options', () => {
  const api = new WeatherAPI({
    timeout: 5000,
    cacheExpiry: 300000
  });
  assertEqual(api.timeout, 5000);
  assertEqual(api.cacheExpiry, 300000);
});

test('Launch sites defined', () => {
  const sites = WeatherAPI.LAUNCH_SITES;
  assertDefined(sites);
  assertTrue(Object.keys(sites).length >= 6, 'Should have multiple launch sites');
  
  // Check Spaceport America
  assertDefined(sites.spaceportAmerica);
  assertEqual(sites.spaceportAmerica.name, 'Spaceport America');
  assertTrue(Math.abs(sites.spaceportAmerica.latitude - 32.99) < 0.1);
});

test('Cache key generation', () => {
  const api = new WeatherAPI();
  const key = api.getCacheKey('test', { lat: 32.99, lon: -106.97 });
  assertTrue(key.includes('test'));
  assertTrue(key.includes('32.99'));
});

test('Cache set and get', () => {
  const api = new WeatherAPI();
  const testData = { temperature: 25, windSpeed: 5 };
  
  api.setCache('test-key', testData);
  const cached = api.getFromCache('test-key');
  
  assertDefined(cached);
  assertEqual(cached.temperature, 25);
  assertEqual(cached.windSpeed, 5);
});

test('Cache expiry', () => {
  const api = new WeatherAPI({ cacheExpiry: 1 }); // 1ms expiry
  api.setCache('expire-test', { value: 1 });
  
  // Wait for expiry
  const start = Date.now();
  while (Date.now() - start < 5) {} // Busy wait 5ms
  
  const cached = api.getFromCache('expire-test');
  assertTrue(cached === null, 'Cache should have expired');
});

test('Cache stats', () => {
  const api = new WeatherAPI();
  api.setCache('key1', { a: 1 });
  api.setCache('key2', { b: 2 });
  
  const stats = api.getCacheStats();
  assertEqual(stats.size, 2);
  assertTrue(stats.keys.includes('key1'));
  assertTrue(stats.keys.includes('key2'));
});

test('Clear cache', () => {
  const api = new WeatherAPI();
  api.setCache('key1', { a: 1 });
  api.clearCache();
  
  const stats = api.getCacheStats();
  assertEqual(stats.size, 0);
});

console.log('\nLaunch Safety Calculation:');

test('Perfect conditions - high safety score', () => {
  const api = new WeatherAPI();
  const current = {
    windSpeed: 2,
    windGusts: 3,
    precipitation: 0,
    cloudCover: 20,
    weatherCode: 0
  };
  const windProfile = [
    { altitude: 100, speed: 3 },
    { altitude: 500, speed: 5 },
    { altitude: 1000, speed: 8 }
  ];
  
  const score = api.calculateLaunchSafety(current, windProfile);
  assertTrue(score >= 80, `Score should be high for good conditions, got ${score}`);
});

test('High wind - reduced safety', () => {
  const api = new WeatherAPI();
  const current = {
    windSpeed: 12,
    windGusts: 18,
    precipitation: 0,
    cloudCover: 20,
    weatherCode: 0
  };
  const windProfile = [{ altitude: 100, speed: 15 }];
  
  const score = api.calculateLaunchSafety(current, windProfile);
  assertTrue(score <= 50, `Score should be reduced for high wind, got ${score}`);
});

test('Precipitation - low safety', () => {
  const api = new WeatherAPI();
  const current = {
    windSpeed: 3,
    windGusts: 5,
    precipitation: 2,
    cloudCover: 90,
    weatherCode: 61
  };
  const windProfile = [{ altitude: 100, speed: 5 }];
  
  const score = api.calculateLaunchSafety(current, windProfile);
  assertTrue(score <= 40, `Score should be low with precipitation, got ${score}`);
});

test('Thunderstorm - zero safety', () => {
  const api = new WeatherAPI();
  const current = {
    windSpeed: 5,
    windGusts: 15,
    precipitation: 5,
    cloudCover: 100,
    weatherCode: 95 // Thunderstorm
  };
  const windProfile = [{ altitude: 100, speed: 20 }];
  
  const score = api.calculateLaunchSafety(current, windProfile);
  assertEqual(score, 0);
});

console.log('\nLaunch Recommendations:');

test('Wind recommendation generated', () => {
  const api = new WeatherAPI();
  const current = {
    windSpeed: 8,
    windGusts: 10,
    precipitation: 0,
    weatherCode: 0,
    windDirection: 90
  };
  const windProfile = [{ altitude: 100, speed: 10 }];
  
  const recs = api.getLaunchRecommendations(current, windProfile);
  assertTrue(recs.length > 0, 'Should have recommendations');
  
  // Should have wind caution
  const windRec = recs.find(r => r.message.includes('wind') || r.message.includes('Wind'));
  assertDefined(windRec, 'Should have wind-related recommendation');
});

test('Into-wind heading recommendation', () => {
  const api = new WeatherAPI();
  const current = {
    windSpeed: 5,
    windGusts: 6,
    precipitation: 0,
    weatherCode: 0,
    windDirection: 90 // East wind
  };
  const windProfile = [{ altitude: 100, speed: 5 }];
  
  const recs = api.getLaunchRecommendations(current, windProfile);
  const headingRec = recs.find(r => r.message.includes('heading'));
  
  assertDefined(headingRec, 'Should recommend heading');
  assertTrue(headingRec.message.includes('270'), 'Should recommend heading into wind (270°)');
});

console.log('\nWind Profile Interpolation:');

test('Wind at surface level', () => {
  const api = new WeatherAPI();
  const layers = [
    { altitude: 100, speed: 5, direction: 90 },
    { altitude: 500, speed: 10, direction: 100 },
    { altitude: 1000, speed: 15, direction: 110 }
  ];
  
  const wind = api.getWindAtAltitude(layers, 50); // Below lowest
  assertEqual(wind.speed, 5);
  assertEqual(wind.direction, 90);
});

test('Wind at high altitude', () => {
  const api = new WeatherAPI();
  const layers = [
    { altitude: 100, speed: 5, direction: 90 },
    { altitude: 500, speed: 10, direction: 100 },
    { altitude: 1000, speed: 15, direction: 110 }
  ];
  
  const wind = api.getWindAtAltitude(layers, 2000); // Above highest
  assertEqual(wind.speed, 15);
  assertEqual(wind.direction, 110);
});

test('Wind interpolation between layers', () => {
  const api = new WeatherAPI();
  const layers = [
    { altitude: 0, speed: 0, direction: 0 },
    { altitude: 1000, speed: 10, direction: 90 }
  ];
  
  const wind = api.getWindAtAltitude(layers, 500); // Midpoint
  assertTrue(Math.abs(wind.speed - 5) < 0.1, `Speed should be ~5, got ${wind.speed}`);
  assertTrue(Math.abs(wind.direction - 45) < 1, `Direction should be ~45, got ${wind.direction}`);
});

console.log('\nSimulation Config Generation:');

test('Convert weather to simulation config', () => {
  const api = new WeatherAPI();
  const weatherData = {
    location: { latitude: 32.99, longitude: -106.97 },
    current: {
      temperature: 25,
      humidity: 40,
      surfacePressure: 850,
      windSpeed: 5,
      windDirection: 90,
      windGusts: 7,
      elevation: 1400
    },
    windProfile: [
      { altitude: 100, speed: 5, direction: 90, temperature: 24 },
      { altitude: 500, speed: 8, direction: 95, temperature: 20 }
    ],
    safetyScore: 85
  };
  
  const config = api.toSimulationConfig(weatherData);
  
  assertDefined(config.environment);
  assertEqual(config.environment.temperature, 298.15, 0.1); // 25°C in K
  assertEqual(config.environment.pressure, 85000, 100); // 850 hPa in Pa
  assertEqual(config.environment.wind_speed, 5);
  assertEqual(config.windLayers.length, 2);
  assertEqual(config.weatherSource, 'Open-Meteo');
});

// ============================================
// Network-dependent Tests
// ============================================

console.log('\nNetwork-Dependent Tests:');

await asyncTest('Fetch current weather (network)', async () => {
  const api = new WeatherAPI({ timeout: 5000 });
  const weather = await api.getCurrentWeather(32.99, -106.97);
  
  assertDefined(weather);
  assertDefined(weather.temperature);
  assertDefined(weather.windSpeed);
  assertDefined(weather.pressure);
  assertTrue(weather.temperature > -50 && weather.temperature < 60, 'Temperature in valid range');
  assertTrue(weather.windSpeed >= 0 && weather.windSpeed < 100, 'Wind speed in valid range');
});

await asyncTest('Fetch hourly forecast (network)', async () => {
  const api = new WeatherAPI({ timeout: 5000 });
  const forecast = await api.getHourlyForecast(32.99, -106.97, 1);
  
  assertDefined(forecast);
  assertTrue(forecast.length >= 24, 'Should have at least 24 hours');
  assertDefined(forecast[0].temperature);
  assertDefined(forecast[0].windSpeed);
});

await asyncTest('Fetch wind profile (network)', async () => {
  const api = new WeatherAPI({ timeout: 5000 });
  const profile = await api.getWindProfile(32.99, -106.97);
  
  assertDefined(profile);
  assertTrue(profile.length >= 5, 'Should have multiple altitude levels');
  assertTrue(profile[0].altitude < profile[profile.length - 1].altitude, 'Should be sorted by altitude');
});

await asyncTest('Full launch site weather (network)', async () => {
  const api = new WeatherAPI({ timeout: 10000 });
  const weather = await api.getLaunchSiteWeather(32.99, -106.97);
  
  assertDefined(weather);
  assertDefined(weather.current);
  assertDefined(weather.hourlyForecast);
  assertDefined(weather.windProfile);
  assertDefined(weather.safetyScore);
  assertDefined(weather.recommendations);
  assertTrue(weather.safetyScore >= 0 && weather.safetyScore <= 100);
});

await asyncTest('Preset site weather (network)', async () => {
  const api = new WeatherAPI({ timeout: 10000 });
  const weather = await api.getPresetSiteWeather('spaceportAmerica');
  
  assertDefined(weather);
  assertEqual(weather.location.name, 'Spaceport America');
});

// ============================================
// AppState Tests
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('APP STATE TESTS');
console.log('═══════════════════════════════════════\n');

test('AppState initialization', () => {
  const state = new AppState();
  assertEqual(state.rocket, null);
  assertEqual(state.motor, null);
  assertEqual(state.weather, null);
});

test('AppState set and get', () => {
  const state = new AppState();
  const rocket = { name: 'Test Rocket', mass: 100 };
  
  state.set('rocket', rocket);
  assertEqual(state.get('rocket').name, 'Test Rocket');
});

test('AppState subscription', () => {
  const state = new AppState();
  let notifiedValue = null;
  
  state.subscribe('rocket', (value) => {
    notifiedValue = value;
  });
  
  state.set('rocket', { name: 'Notified Rocket' });
  assertEqual(notifiedValue.name, 'Notified Rocket');
});

test('AppState unsubscribe', () => {
  const state = new AppState();
  let callCount = 0;
  
  const unsubscribe = state.subscribe('motor', () => {
    callCount++;
  });
  
  state.set('motor', { name: 'Motor 1' });
  unsubscribe();
  state.set('motor', { name: 'Motor 2' });
  
  assertEqual(callCount, 1);
});

test('AppState toJSON', () => {
  const state = new AppState();
  state.set('rocket', { name: 'JSON Rocket' });
  state.set('motor', { designation: 'G80' });
  
  const json = state.toJSON();
  assertEqual(json.rocket.name, 'JSON Rocket');
  assertEqual(json.motor.designation, 'G80');
});

test('AppState loadFromJSON', () => {
  const state = new AppState();
  state.loadFromJSON({
    rocket: { name: 'Loaded Rocket' },
    motor: { designation: 'H128' }
  });
  
  assertEqual(state.get('rocket').name, 'Loaded Rocket');
  assertEqual(state.get('motor').designation, 'H128');
});

// ============================================
// LaunchSimApp Tests
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('LAUNCHSIM APP TESTS');
console.log('═══════════════════════════════════════\n');

test('LaunchSimApp instantiation', () => {
  const app = new LaunchSimApp('test-container');
  assertDefined(app);
  assertEqual(app.containerId, 'test-container');
  assertDefined(app.state);
  assertDefined(app.modules);
});

test('LaunchSimApp with options', () => {
  const app = new LaunchSimApp('test-container', {
    theme: 'dark',
    defaultLocation: { latitude: 40.0, longitude: -100.0 }
  });
  
  assertEqual(app.options.theme, 'dark');
  assertEqual(app.options.defaultLocation.latitude, 40.0);
});

test('Build simulation config', () => {
  const app = new LaunchSimApp('test-container');
  
  const rocket = {
    name: 'Test Rocket',
    dryMass: 100,
    bodyDiameter: 41,
    bodyLength: 300,
    noseLength: 100,
    noseShape: 'ogive',
    finCount: 3,
    finSpan: 55,
    finRootChord: 70,
    finTipChord: 30,
    chuteDiameter: 450,
    chuteCd: 0.8
  };
  
  const motor = {
    totalMass: 50,
    propMass: 20,
    avgThrust: 15,
    burnTime: 1.5
  };
  
  const config = app.buildSimulationConfig(rocket, motor, {
    rodLength: 1.0,
    launchAngle: 5,
    launchHeading: 270
  });
  
  assertDefined(config.rocket);
  assertDefined(config.motor);
  assertDefined(config.environment);
  assertDefined(config.launch);
  
  assertEqual(config.rocket.mass, 0.1); // 100g in kg
  assertEqual(config.rocket.finCount, 3);
  assertEqual(config.motor.avgThrust, 15);
  assertEqual(config.launch.angle, 5);
});

test('Apply variations to config', () => {
  const app = new LaunchSimApp('test-container');
  
  const baseConfig = {
    rocket: { mass: 0.1 },
    motor: { avgThrust: 10 },
    environment: { windSpeed: 5, windDirection: 90 },
    launch: { angle: 5 }
  };
  
  // Run multiple variations and check they differ
  const varied1 = app.applyVariations(baseConfig);
  const varied2 = app.applyVariations(baseConfig);
  
  // Should be different (with high probability)
  const allSame = varied1.rocket.mass === varied2.rocket.mass &&
                  varied1.motor.avgThrust === varied2.motor.avgThrust &&
                  varied1.environment.windSpeed === varied2.environment.windSpeed;
  
  assertTrue(!allSame || Math.random() < 0.001, 'Variations should differ');
  
  // Values should be within expected ranges
  assertTrue(varied1.rocket.mass > 0.09 && varied1.rocket.mass < 0.11, 'Mass within ±5%');
  assertTrue(varied1.motor.avgThrust > 9.5 && varied1.motor.avgThrust < 10.5, 'Thrust within ±3%');
});

test('Mock simulation produces valid results', () => {
  const app = new LaunchSimApp('test-container');
  
  const config = {
    rocket: {
      mass: 0.1,
      chuteDiameter: 0.45,
      chuteCd: 0.8
    },
    motor: {
      totalMass: 0.05,
      avgThrust: 15,
      burnTime: 1.5
    },
    environment: {
      windSpeed: 3,
      windDirection: 90
    }
  };
  
  const result = app.mockSimulation(config);
  
  assertDefined(result.apogee);
  assertDefined(result.maxVelocity);
  assertDefined(result.flightTime);
  assertDefined(result.trajectory);
  assertDefined(result.events);
  
  assertTrue(result.apogee > 0, 'Apogee should be positive');
  assertTrue(result.flightTime > 0, 'Flight time should be positive');
  assertTrue(result.trajectory.length > 10, 'Should have trajectory points');
  assertTrue(result.events.length >= 4, 'Should have flight events');
  
  // Check events
  const eventNames = result.events.map(e => e.event);
  assertTrue(eventNames.includes('Liftoff'));
  assertTrue(eventNames.includes('Burnout'));
  assertTrue(eventNames.includes('Apogee'));
  assertTrue(eventNames.includes('Landing'));
  
  console.log(`    → Simulated apogee: ${result.apogee.toFixed(1)}m`);
  console.log(`    → Flight time: ${result.flightTime.toFixed(1)}s`);
});

test('Monte Carlo analysis', () => {
  const app = new LaunchSimApp('test-container');
  
  // Create mock results
  const results = [];
  for (let i = 0; i < 20; i++) {
    results.push({
      apogee: 200 + Math.random() * 40 - 20,
      flightTime: 15 + Math.random() * 2 - 1,
      landingX: Math.random() * 50 - 25,
      landingY: Math.random() * 50 - 25,
      landingDistance: Math.random() * 40
    });
  }
  
  const analysis = app.analyzeMonteCarloResults(results);
  
  assertEqual(analysis.count, 20);
  assertDefined(analysis.apogee.mean);
  assertDefined(analysis.apogee.stdDev);
  assertDefined(analysis.apogee.min);
  assertDefined(analysis.apogee.max);
  assertDefined(analysis.landing.positions);
  assertEqual(analysis.landing.positions.length, 20);
  
  console.log(`    → Apogee: ${analysis.apogee.mean.toFixed(1)} ± ${analysis.apogee.stdDev.toFixed(1)}m`);
});

// ============================================
// Summary
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('TEST SUMMARY');
console.log('═══════════════════════════════════════');
console.log(`Passed:  ${TestResults.passed}`);
console.log(`Failed:  ${TestResults.failed}`);
console.log(`Skipped: ${TestResults.skipped}`);
console.log(`Total:   ${TestResults.passed + TestResults.failed + TestResults.skipped}`);
console.log('═══════════════════════════════════════\n');

if (TestResults.failed > 0) {
  console.log('FAILED TESTS:');
  TestResults.results
    .filter(r => r.status === 'FAIL')
    .forEach(r => console.log(`  ✗ ${r.name}: ${r.error}`));
  process.exit(1);
} else {
  console.log('✓ ALL WEATHER & FRONTEND TESTS PASSED!\n');
  process.exit(0);
}

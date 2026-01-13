/**
 * 3D Viewer Tests
 */

import { 
  Rocket3DViewer, 
  ColorUtils, 
  SmokeTrailSystem, 
  ParachuteSystem, 
  StageSeparationSystem,
  TerrainSystem,
  WindVisualizationSystem,
  TrajectoryInspector,
  TelemetryHUD,
  ForceVectorSystem,
  MachConeEffect,
  MultiTrajectorySystem,
  SafeZoneOverlay,
  AttitudeIndicatorWidget,
  HeatingIndicator,
  KMLExporter,
  WeatherEffectsSystem,
  SkyboxSystem,
  FirstPersonCamera
} from '../src/visualization/3d-viewer.js';

// Simple test framework
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`✗ ${name}: ${e.message}`);
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) {
    throw new Error(msg || 'Assertion failed');
  }
}

console.log('\n3D Viewer Module Tests\n' + '='.repeat(50));

// Test ColorUtils
test('ColorUtils exists', () => {
  assertTrue(ColorUtils !== undefined);
});

test('ColorUtils.velocityToColor is a function', () => {
  assertTrue(typeof ColorUtils.velocityToColor === 'function');
});

test('ColorUtils.altitudeToColor is a function', () => {
  assertTrue(typeof ColorUtils.altitudeToColor === 'function');
});

test('ColorUtils.phaseColors has powered phase', () => {
  assertTrue(ColorUtils.phaseColors.powered !== undefined);
});

test('ColorUtils.phaseColors has coasting phase', () => {
  assertTrue(ColorUtils.phaseColors.coasting !== undefined);
});

test('ColorUtils.phaseColors has descent phase', () => {
  assertTrue(ColorUtils.phaseColors.descent !== undefined);
});

test('ColorUtils.phaseColors has drogue phase', () => {
  assertTrue(ColorUtils.phaseColors.drogue !== undefined);
});

test('ColorUtils.phaseColors has main phase', () => {
  assertTrue(ColorUtils.phaseColors.main !== undefined);
});

test('ColorUtils.phaseColors has landed phase', () => {
  assertTrue(ColorUtils.phaseColors.landed !== undefined);
});

// Test Rocket3DViewer class exists
test('Rocket3DViewer class exists', () => {
  assertTrue(Rocket3DViewer !== undefined);
});

test('Rocket3DViewer is a function (constructor)', () => {
  assertTrue(typeof Rocket3DViewer === 'function');
});

// Test SmokeTrailSystem
test('SmokeTrailSystem class exists', () => {
  assertTrue(SmokeTrailSystem !== undefined);
});

test('SmokeTrailSystem is a function (constructor)', () => {
  assertTrue(typeof SmokeTrailSystem === 'function');
});

// Test ParachuteSystem
test('ParachuteSystem class exists', () => {
  assertTrue(ParachuteSystem !== undefined);
});

test('ParachuteSystem is a function (constructor)', () => {
  assertTrue(typeof ParachuteSystem === 'function');
});

// Test StageSeparationSystem
test('StageSeparationSystem class exists', () => {
  assertTrue(StageSeparationSystem !== undefined);
});

test('StageSeparationSystem is a function (constructor)', () => {
  assertTrue(typeof StageSeparationSystem === 'function');
});

// Test TerrainSystem
test('TerrainSystem class exists', () => {
  assertTrue(TerrainSystem !== undefined);
});

test('TerrainSystem is a function (constructor)', () => {
  assertTrue(typeof TerrainSystem === 'function');
});

// Test WindVisualizationSystem
test('WindVisualizationSystem class exists', () => {
  assertTrue(WindVisualizationSystem !== undefined);
});

test('WindVisualizationSystem is a function (constructor)', () => {
  assertTrue(typeof WindVisualizationSystem === 'function');
});

// Test TrajectoryInspector
test('TrajectoryInspector class exists', () => {
  assertTrue(TrajectoryInspector !== undefined);
});

test('TrajectoryInspector is a function (constructor)', () => {
  assertTrue(typeof TrajectoryInspector === 'function');
});

// Test TelemetryHUD
test('TelemetryHUD class exists', () => {
  assertTrue(TelemetryHUD !== undefined);
});

test('TelemetryHUD is a function (constructor)', () => {
  assertTrue(typeof TelemetryHUD === 'function');
});

// Test ForceVectorSystem
test('ForceVectorSystem class exists', () => {
  assertTrue(ForceVectorSystem !== undefined);
});

test('ForceVectorSystem is a function (constructor)', () => {
  assertTrue(typeof ForceVectorSystem === 'function');
});

// Test MachConeEffect
test('MachConeEffect class exists', () => {
  assertTrue(MachConeEffect !== undefined);
});

test('MachConeEffect is a function (constructor)', () => {
  assertTrue(typeof MachConeEffect === 'function');
});

// Test MultiTrajectorySystem
test('MultiTrajectorySystem class exists', () => {
  assertTrue(MultiTrajectorySystem !== undefined);
});

test('MultiTrajectorySystem is a function (constructor)', () => {
  assertTrue(typeof MultiTrajectorySystem === 'function');
});

// Test SafeZoneOverlay
test('SafeZoneOverlay class exists', () => {
  assertTrue(SafeZoneOverlay !== undefined);
});

test('SafeZoneOverlay is a function (constructor)', () => {
  assertTrue(typeof SafeZoneOverlay === 'function');
});

// Test AttitudeIndicatorWidget
test('AttitudeIndicatorWidget class exists', () => {
  assertTrue(AttitudeIndicatorWidget !== undefined);
});

test('AttitudeIndicatorWidget is a function (constructor)', () => {
  assertTrue(typeof AttitudeIndicatorWidget === 'function');
});

// Test HeatingIndicator
test('HeatingIndicator class exists', () => {
  assertTrue(HeatingIndicator !== undefined);
});

test('HeatingIndicator is a function (constructor)', () => {
  assertTrue(typeof HeatingIndicator === 'function');
});

// Test KMLExporter
test('KMLExporter class exists', () => {
  assertTrue(KMLExporter !== undefined);
});

test('KMLExporter is a function (constructor)', () => {
  assertTrue(typeof KMLExporter === 'function');
});

// Test WeatherEffectsSystem
test('WeatherEffectsSystem class exists', () => {
  assertTrue(WeatherEffectsSystem !== undefined);
});

test('WeatherEffectsSystem is a function (constructor)', () => {
  assertTrue(typeof WeatherEffectsSystem === 'function');
});

// Test SkyboxSystem
test('SkyboxSystem class exists', () => {
  assertTrue(SkyboxSystem !== undefined);
});

test('SkyboxSystem is a function (constructor)', () => {
  assertTrue(typeof SkyboxSystem === 'function');
});

// Test FirstPersonCamera
test('FirstPersonCamera class exists', () => {
  assertTrue(FirstPersonCamera !== undefined);
});

test('FirstPersonCamera is a function (constructor)', () => {
  assertTrue(typeof FirstPersonCamera === 'function');
});

// Note: Can't fully test 3D viewer without browser/THREE.js environment
// But we can verify the module structure is correct

console.log('\n' + '='.repeat(50));
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);

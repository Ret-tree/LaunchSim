/**
 * ORK Importer Test Suite
 * =======================
 */

import { ORKImporter, XMLParser, ComponentParser, NOSE_SHAPE_MAP } from '../src/import/ork-importer.js';

// Sample OpenRocket XML for testing
const SAMPLE_ORK_XML = `<?xml version="1.0" encoding="UTF-8"?>
<openrocket version="1.9" creator="OpenRocket 23.09">
  <rocket>
    <name>Test Rocket Alpha</name>
    <designer>LAUNCHSIM Test</designer>
    <revision>1.0</revision>
    <comment>A test rocket for the ORK importer</comment>
    
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <subcomponents>
          
          <nosecone>
            <name>Ogive Nose</name>
            <shape>ogive</shape>
            <length>0.10</length>
            <aftradius>0.0205</aftradius>
            <thickness>0.002</thickness>
            <mass>0.015</mass>
            <massoverride>false</massoverride>
            <material>plastic</material>
            <filled>false</filled>
            <shapeparameter>1.0</shapeparameter>
            <aftshoulderlength>0.025</aftshoulderlength>
            <aftshoulderradius>0.019</aftshoulderradius>
            <appearance>
              <paint>
                <red>255</red>
                <green>100</green>
                <blue>50</blue>
                <alpha>255</alpha>
              </paint>
            </appearance>
          </nosecone>
          
          <bodytube>
            <name>Main Body</name>
            <length>0.30</length>
            <radius>0.0205</radius>
            <thickness>0.0005</thickness>
            <mass>0.025</mass>
            <massoverride>false</massoverride>
            <material>cardboard</material>
            <motormount>false</motormount>
            
            <subcomponents>
              <trapezoidfinset>
                <name>Trapezoidal Fins</name>
                <fincount>3</fincount>
                <rootchord>0.070</rootchord>
                <tipchord>0.030</tipchord>
                <height>0.055</height>
                <sweeplength>0.025</sweeplength>
                <thickness>0.003</thickness>
                <crosssection>rounded</crosssection>
                <mass>0.010</mass>
                <massoverride>false</massoverride>
                <material>balsa</material>
                <tabheight>0.005</tabheight>
                <tablength>0.040</tablength>
                <axialoffset>0.02</axialoffset>
                <axialmethod>BOTTOM</axialmethod>
              </trapezoidfinset>
              
              <innertube>
                <name>Motor Mount Tube</name>
                <length>0.070</length>
                <outerradius>0.0095</outerradius>
                <innerradius>0.009</innerradius>
                <thickness>0.0005</thickness>
                <mass>0.003</mass>
                <motormount>true</motormount>
                <motoroverhang>0.005</motoroverhang>
                <axialoffset>0.01</axialoffset>
                <axialmethod>BOTTOM</axialmethod>
                
                <subcomponents>
                  <engineblock>
                    <name>Engine Block</name>
                    <length>0.005</length>
                    <outerradius>0.009</outerradius>
                    <innerradius>0.003</innerradius>
                    <mass>0.002</mass>
                    <material>cardboard</material>
                    <axialoffset>0</axialoffset>
                    <axialmethod>TOP</axialmethod>
                  </engineblock>
                </subcomponents>
              </innertube>
              
              <centeringring>
                <name>Centering Ring Front</name>
                <length>0.003</length>
                <outerradius>0.019</outerradius>
                <innerradius>0.0095</innerradius>
                <mass>0.002</mass>
                <material>plywood</material>
                <axialoffset>0.05</axialoffset>
                <axialmethod>BOTTOM</axialmethod>
              </centeringring>
              
              <centeringring>
                <name>Centering Ring Rear</name>
                <length>0.003</length>
                <outerradius>0.019</outerradius>
                <innerradius>0.0095</innerradius>
                <mass>0.002</mass>
                <material>plywood</material>
                <axialoffset>0.01</axialoffset>
                <axialmethod>BOTTOM</axialmethod>
              </centeringring>
              
              <launchlug>
                <name>Launch Lug</name>
                <length>0.040</length>
                <radius>0.003</radius>
                <thickness>0.0005</thickness>
                <mass>0.002</mass>
                <material>cardboard</material>
                <radialposition>0</radialposition>
                <instancecount>1</instancecount>
                <axialoffset>0.10</axialoffset>
                <axialmethod>MIDDLE</axialmethod>
              </launchlug>
              
              <parachute>
                <name>Main Parachute</name>
                <diameter>0.45</diameter>
                <cd>0.8</cd>
                <linecount>8</linecount>
                <linelength>0.35</linelength>
                <linematerial>nylon</linematerial>
                <material>ripstopnylon</material>
                <mass>0.015</mass>
                <deployevent>apogee</deployevent>
                <deployaltitude>0</deployaltitude>
                <deploydelay>0</deploydelay>
                <packedlength>0.05</packedlength>
                <packedradius>0.015</packedradius>
                <axialoffset>0.05</axialoffset>
                <axialmethod>TOP</axialmethod>
              </parachute>
              
              <shockcord>
                <name>Shock Cord</name>
                <cordlength>0.60</cordlength>
                <material>elastic</material>
                <mass>0.005</mass>
                <axialoffset>0.06</axialoffset>
                <axialmethod>TOP</axialmethod>
              </shockcord>
              
            </subcomponents>
          </bodytube>
          
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
  
  <simulations>
    <simulation configid="default">
      <name>Test Flight</name>
      <conditions>
        <launchrodlength>1.0</launchrodlength>
        <launchrodangle>0.0873</launchrodangle>
        <launchroddirection>0</launchroddirection>
        <windaverage>3.0</windaverage>
        <winddirection>1.5708</winddirection>
        <windturbulence>0.1</windturbulence>
        <launchaltitude>0</launchaltitude>
        <launchlatitude>32.99</launchlatitude>
        <launchlongitude>-106.97</launchlongitude>
        <atmosphere>isa</atmosphere>
        <basetemperature>293.15</basetemperature>
        <basepressure>101325</basepressure>
      </conditions>
      <flightdata>
        <maxaltitude>245.8</maxaltitude>
        <maxvelocity>78.5</maxvelocity>
        <maxacceleration>85.2</maxacceleration>
        <maxmach>0.23</maxmach>
        <timetoapogee>4.8</timetoapogee>
        <flighttime>18.5</flighttime>
        <groundhitvelocity>5.2</groundhitvelocity>
      </flightdata>
    </simulation>
  </simulations>
  
  <motorconfiguration configid="default">
    <motor>
      <designation>C6-5</designation>
      <manufacturer>Estes</manufacturer>
      <diameter>0.018</diameter>
      <length>0.070</length>
      <delay>5</delay>
      <ignitionevent>AUTOMATIC</ignitionevent>
      <ignitiondelay>0</ignitiondelay>
    </motor>
  </motorconfiguration>
</openrocket>`;

// Test suite
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

// ============================================
// XMLParser Tests
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('XML PARSER TESTS');
console.log('═══════════════════════════════════════\n');

test('Parse valid XML', () => {
  const doc = XMLParser.parse('<root><child>value</child></root>');
  assertTrue(doc !== null, 'Should parse valid XML');
  assertEqual(doc.documentElement.tagName, 'root');
});

test('Get text content', () => {
  const doc = XMLParser.parse('<root><name>Test Rocket</name></root>');
  const text = XMLParser.getText(doc.documentElement, 'name');
  assertEqual(text, 'Test Rocket');
});

test('Get number value', () => {
  const doc = XMLParser.parse('<root><length>0.123</length></root>');
  const num = XMLParser.getNumber(doc.documentElement, 'length');
  assertEqual(num, 0.123, 0.001);
});

test('Get boolean value', () => {
  const doc = XMLParser.parse('<root><flag>true</flag><other>false</other></root>');
  assertTrue(XMLParser.getBool(doc.documentElement, 'flag'));
  assertTrue(!XMLParser.getBool(doc.documentElement, 'other'));
});

test('Get default for missing element', () => {
  const doc = XMLParser.parse('<root></root>');
  assertEqual(XMLParser.getText(doc.documentElement, 'missing', 'default'), 'default');
  assertEqual(XMLParser.getNumber(doc.documentElement, 'missing', 42), 42);
});

// ============================================
// Component Parser Tests
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('COMPONENT PARSER TESTS');
console.log('═══════════════════════════════════════\n');

const parser = new ComponentParser();

test('Parse nose cone', () => {
  const doc = XMLParser.parse(`
    <nosecone>
      <name>Test Nose</name>
      <shape>ogive</shape>
      <length>0.10</length>
      <aftradius>0.02</aftradius>
      <thickness>0.002</thickness>
      <mass>0.015</mass>
    </nosecone>
  `);
  const nose = parser.parseNoseCone(doc.documentElement);
  
  assertEqual(nose.type, 'nosecone');
  assertEqual(nose.name, 'Test Nose');
  assertEqual(nose.shape, 'ogive');
  assertEqual(nose.length, 100, 0.1);  // m to mm
  assertEqual(nose.diameter, 40, 0.1);  // radius m to diameter mm
  assertEqual(nose.mass, 15, 0.1);  // kg to g
});

test('Parse body tube', () => {
  const doc = XMLParser.parse(`
    <bodytube>
      <name>Main Body</name>
      <length>0.30</length>
      <radius>0.02</radius>
      <thickness>0.001</thickness>
      <mass>0.025</mass>
      <motormount>false</motormount>
    </bodytube>
  `);
  const tube = parser.parseBodyTube(doc.documentElement);
  
  assertEqual(tube.type, 'bodytube');
  assertEqual(tube.name, 'Main Body');
  assertEqual(tube.length, 300, 0.1);
  assertEqual(tube.outerDiameter, 40, 0.1);
  assertTrue(!tube.motorMount);
});

test('Parse trapezoidal fins', () => {
  const doc = XMLParser.parse(`
    <trapezoidfinset>
      <name>Test Fins</name>
      <fincount>4</fincount>
      <rootchord>0.08</rootchord>
      <tipchord>0.03</tipchord>
      <height>0.06</height>
      <sweeplength>0.02</sweeplength>
      <thickness>0.003</thickness>
      <crosssection>rounded</crosssection>
      <mass>0.012</mass>
    </trapezoidfinset>
  `);
  const fins = parser.parseTrapezoidFinSet(doc.documentElement);
  
  assertEqual(fins.type, 'trapezoidfinset');
  assertEqual(fins.finCount, 4);
  assertEqual(fins.rootChord, 80, 0.1);
  assertEqual(fins.tipChord, 30, 0.1);
  assertEqual(fins.span, 60, 0.1);
  assertEqual(fins.sweepLength, 20, 0.1);
  assertEqual(fins.crossSection, 'rounded');
});

test('Parse parachute', () => {
  const doc = XMLParser.parse(`
    <parachute>
      <name>Main Chute</name>
      <diameter>0.50</diameter>
      <cd>0.85</cd>
      <linecount>8</linecount>
      <linelength>0.40</linelength>
      <deployevent>apogee</deployevent>
      <deploydelay>1.5</deploydelay>
      <mass>0.020</mass>
    </parachute>
  `);
  const chute = parser.parseParachute(doc.documentElement);
  
  assertEqual(chute.type, 'parachute');
  assertEqual(chute.diameter, 500, 0.1);
  assertEqual(chute.cd, 0.85, 0.01);
  assertEqual(chute.lineCount, 8);
  assertEqual(chute.deployEvent, 'apogee');
  assertEqual(chute.deployDelay, 1.5, 0.01);
});

test('Parse inner tube (motor mount)', () => {
  const doc = XMLParser.parse(`
    <innertube>
      <name>Motor Mount</name>
      <length>0.070</length>
      <outerradius>0.0095</outerradius>
      <innerradius>0.009</innerradius>
      <motormount>true</motormount>
      <motoroverhang>0.005</motoroverhang>
    </innertube>
  `);
  const tube = parser.parseInnerTube(doc.documentElement);
  
  assertEqual(tube.type, 'innertube');
  assertEqual(tube.length, 70, 0.1);
  assertEqual(tube.innerDiameter, 18, 0.1);
  assertTrue(tube.motorMount);
  assertEqual(tube.motorOverhang, 5, 0.1);
});

test('Parse color/appearance', () => {
  const doc = XMLParser.parse(`
    <component>
      <appearance>
        <paint>
          <red>255</red>
          <green>128</green>
          <blue>64</blue>
          <alpha>200</alpha>
        </paint>
      </appearance>
    </component>
  `);
  const color = parser.parseColor(doc.documentElement);
  
  assertTrue(color !== null, 'Color should be parsed');
  assertEqual(color.red, 255);
  assertEqual(color.green, 128);
  assertEqual(color.blue, 64);
  assertEqual(color.alpha, 200);
});

// ============================================
// Full Import Tests
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('FULL IMPORT TESTS');
console.log('═══════════════════════════════════════\n');

const importer = new ORKImporter();

test('Import complete ORK file', () => {
  const result = importer.importFromXML(SAMPLE_ORK_XML, 'test.ork');
  
  assertTrue(result !== null, 'Result should not be null');
  assertEqual(result.rocket.name, 'Test Rocket Alpha');
  assertEqual(result.rocket.designer, 'LAUNCHSIM Test');
  assertTrue(result.rocket.stages.length > 0, 'Should have at least one stage');
});

test('Parse stages correctly', () => {
  const result = importer.importFromXML(SAMPLE_ORK_XML);
  
  assertEqual(result.rocket.stages.length, 1);
  assertEqual(result.rocket.stages[0].name, 'Sustainer');
  assertTrue(result.rocket.stages[0].components.length > 0);
});

test('Parse all component types', () => {
  const result = importer.importFromXML(SAMPLE_ORK_XML);
  const components = result.launchsim.components;
  
  const types = new Set(components.map(c => c.type));
  
  assertTrue(types.has('nosecone'), 'Should have nose cone');
  assertTrue(types.has('bodytube'), 'Should have body tube');
  assertTrue(types.has('trapezoidfinset'), 'Should have fins');
  assertTrue(types.has('innertube'), 'Should have inner tube');
  assertTrue(types.has('parachute'), 'Should have parachute');
  assertTrue(types.has('launchlug'), 'Should have launch lug');
  assertTrue(types.has('centeringring'), 'Should have centering ring');
  assertTrue(types.has('shockcord'), 'Should have shock cord');
});

test('Convert to LAUNCHSIM format', () => {
  const result = importer.importFromXML(SAMPLE_ORK_XML);
  const ls = result.launchsim;
  
  assertTrue(ls.name === 'Test Rocket Alpha');
  assertTrue(ls.bodyDiameter > 0, 'Body diameter should be set');
  assertTrue(ls.bodyLength > 0, 'Body length should be set');
  assertTrue(ls.noseLength > 0, 'Nose length should be set');
  assertTrue(ls.finCount > 0, 'Fin count should be set');
  assertTrue(ls.finRootChord > 0, 'Fin root chord should be set');
  assertTrue(ls.chuteDiameter > 0, 'Chute diameter should be set');
  assertTrue(ls.motorDiameter > 0, 'Motor diameter should be set');
  
  console.log(`    → Body: ${ls.bodyDiameter.toFixed(1)}mm × ${ls.bodyLength.toFixed(1)}mm`);
  console.log(`    → Nose: ${ls.noseShape}, ${ls.noseLength.toFixed(1)}mm`);
  console.log(`    → Fins: ${ls.finCount}× ${ls.finRootChord.toFixed(1)}/${ls.finTipChord.toFixed(1)}mm`);
  console.log(`    → Chute: ${ls.chuteDiameter.toFixed(1)}mm`);
  console.log(`    → Motor: ${ls.motorDiameter.toFixed(1)}mm`);
});

test('Parse simulation data', () => {
  const result = importer.importFromXML(SAMPLE_ORK_XML);
  
  assertTrue(result.simulations.length > 0, 'Should have simulations');
  
  const sim = result.simulations[0];
  assertEqual(sim.name, 'Test Flight');
  assertTrue(sim.conditions !== null, 'Should have conditions');
  assertTrue(sim.flightData !== null, 'Should have flight data');
  
  assertEqual(sim.flightData.maxAltitude, 245.8, 0.1);
  assertEqual(sim.flightData.maxVelocity, 78.5, 0.1);
  
  console.log(`    → Apogee: ${sim.flightData.maxAltitude}m`);
  console.log(`    → Max velocity: ${sim.flightData.maxVelocity}m/s`);
});

test('Parse motor configuration', () => {
  const result = importer.importFromXML(SAMPLE_ORK_XML);
  
  assertTrue(result.motorConfigurations.length > 0, 'Should have motor configs');
  
  const config = result.motorConfigurations[0];
  assertTrue(config.motors.length > 0, 'Should have motors');
  
  const motor = config.motors[0];
  assertEqual(motor.designation, 'C6-5');
  assertEqual(motor.manufacturer, 'Estes');
  assertEqual(motor.diameter, 18, 0.1);
  assertEqual(motor.delay, 5);
  
  console.log(`    → Motor: ${motor.manufacturer} ${motor.designation}`);
});

test('Calculate total mass', () => {
  const result = importer.importFromXML(SAMPLE_ORK_XML);
  
  assertTrue(result.launchsim.totalMass > 0, 'Total mass should be calculated');
  console.log(`    → Total mass: ${result.launchsim.totalMass.toFixed(1)}g`);
});

test('Handle missing optional elements', () => {
  const minimalXML = `<?xml version="1.0"?>
    <openrocket version="1.0">
      <rocket>
        <name>Minimal Rocket</name>
        <subcomponents>
          <stage>
            <name>Stage 1</name>
            <subcomponents>
              <nosecone>
                <length>0.05</length>
                <aftradius>0.01</aftradius>
              </nosecone>
              <bodytube>
                <length>0.10</length>
                <radius>0.01</radius>
              </bodytube>
            </subcomponents>
          </stage>
        </subcomponents>
      </rocket>
    </openrocket>`;
  
  const result = importer.importFromXML(minimalXML);
  assertTrue(result.rocket.name === 'Minimal Rocket');
  assertTrue(result.launchsim.components.length >= 2);
});

test('Preserve original ORK data', () => {
  const result = importer.importFromXML(SAMPLE_ORK_XML);
  
  assertTrue(result.launchsim._orkData !== undefined, 'Should preserve ORK data');
  assertEqual(result.launchsim._orkData.name, 'Test Rocket Alpha');
});

// ============================================
// Shape Mapping Tests
// ============================================

console.log('\n═══════════════════════════════════════');
console.log('SHAPE MAPPING TESTS');
console.log('═══════════════════════════════════════\n');

test('Map nose cone shapes', () => {
  assertEqual(NOSE_SHAPE_MAP['conical'], 'conical');
  assertEqual(NOSE_SHAPE_MAP['ogive'], 'ogive');
  assertEqual(NOSE_SHAPE_MAP['ellipsoid'], 'elliptical');
  assertEqual(NOSE_SHAPE_MAP['haack'], 'vonKarman');
  assertEqual(NOSE_SHAPE_MAP['parabolic'], 'parabolic');
});

test('Parse different nose shapes', () => {
  const shapes = ['conical', 'ogive', 'ellipsoid', 'power', 'parabolic', 'haack'];
  
  shapes.forEach(shape => {
    const doc = XMLParser.parse(`
      <nosecone>
        <shape>${shape}</shape>
        <length>0.1</length>
        <aftradius>0.02</aftradius>
      </nosecone>
    `);
    const nose = parser.parseNoseCone(doc.documentElement);
    assertTrue(nose.shape !== undefined, `Shape ${shape} should be mapped`);
  });
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
  console.log('✓ ALL ORK IMPORTER TESTS PASSED!\n');
  process.exit(0);
}

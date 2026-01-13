/**
 * LAUNCHSIM Fin Flutter Analysis
 * ===============================
 * 
 * Calculates fin flutter velocity to ensure structural safety at high speeds.
 * Uses the NARTS (National Association of Rocketry Technical Services) method
 * based on the Barrowman equations.
 * 
 * Flutter occurs when aerodynamic forces couple with fin structural modes,
 * causing oscillation that can lead to fin failure. This analysis determines
 * the maximum safe airspeed for a given fin design.
 * 
 * References:
 * - NARTS Technical Report: "Fin Flutter"
 * - Barrowman, J.S. "The Practical Calculation of the Aerodynamic Characteristics of Slender Finned Vehicles"
 * - Apogee Components Technical Publication #12
 * 
 * Usage:
 *   const flutter = new FinFlutterAnalysis(finGeometry, material);
 *   const result = flutter.analyze(expectedMaxVelocity);
 */

// Debug mode
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[Flutter]', ...args),
  warn: (...args) => console.warn('[Flutter]', ...args),
  error: (...args) => console.error('[Flutter]', ...args)
};

// ============================================
// Constants
// ============================================

// Speed of sound at sea level (m/s)
const SPEED_OF_SOUND_SEA_LEVEL = 343;

// Air density at sea level (kg/m³)
const AIR_DENSITY_SEA_LEVEL = 1.225;

// Standard gravity (m/s²)
const GRAVITY = 9.81;

// Unit conversions
const PSI_TO_PASCAL = 6894.76;
const MPA_TO_PASCAL = 1e6;
const GPA_TO_PASCAL = 1e9;
const LB_FT3_TO_KG_M3 = 16.0185;
const INCH_TO_METER = 0.0254;
const MM_TO_METER = 0.001;
const FPS_TO_MPS = 0.3048;
const MPS_TO_FPS = 3.28084;
const MPS_TO_MPH = 2.23694;
const MPS_TO_MACH = 1 / SPEED_OF_SOUND_SEA_LEVEL;

// ============================================
// Material Database
// ============================================

/**
 * Material properties for common fin materials
 * 
 * Properties:
 * - shearModulus: G (Pa) - resistance to shear deformation
 * - elasticModulus: E (Pa) - Young's modulus
 * - density: ρ (kg/m³)
 * - poissonRatio: ν - ratio of transverse to axial strain
 * - description: Human-readable description
 * 
 * Shear modulus G = E / (2 * (1 + ν)) for isotropic materials
 */
const MATERIAL_DATABASE = {
  // ============================================
  // Wood Materials
  // ============================================
  
  'balsa-light': {
    name: 'Balsa (Light, 6-8 lb/ft³)',
    shearModulus: 0.2e9,      // ~0.2 GPa
    elasticModulus: 3.0e9,    // ~3 GPa along grain
    density: 110,             // ~7 lb/ft³
    poissonRatio: 0.3,
    category: 'wood',
    description: 'Contest-grade light balsa, good for low-power rockets'
  },
  
  'balsa-medium': {
    name: 'Balsa (Medium, 8-12 lb/ft³)',
    shearModulus: 0.35e9,
    elasticModulus: 4.0e9,
    density: 160,             // ~10 lb/ft³
    poissonRatio: 0.3,
    category: 'wood',
    description: 'Standard balsa, most common for sport rocketry'
  },
  
  'balsa-heavy': {
    name: 'Balsa (Heavy, 12-16 lb/ft³)',
    shearModulus: 0.5e9,
    elasticModulus: 5.5e9,
    density: 220,             // ~14 lb/ft³
    poissonRatio: 0.3,
    category: 'wood',
    description: 'Dense balsa, better flutter resistance'
  },
  
  'basswood': {
    name: 'Basswood',
    shearModulus: 0.62e9,
    elasticModulus: 10.0e9,
    density: 420,
    poissonRatio: 0.35,
    category: 'wood',
    description: 'Stronger than balsa, good for mid-power'
  },
  
  'birch-plywood-1/8': {
    name: 'Birch Plywood (1/8" / 3mm)',
    shearModulus: 0.8e9,
    elasticModulus: 12.5e9,
    density: 680,
    poissonRatio: 0.33,
    category: 'wood',
    description: 'Aircraft-grade birch plywood, excellent strength-to-weight'
  },
  
  'birch-plywood-3/16': {
    name: 'Birch Plywood (3/16" / 5mm)',
    shearModulus: 0.85e9,
    elasticModulus: 13.0e9,
    density: 700,
    poissonRatio: 0.33,
    category: 'wood',
    description: 'Thicker plywood for high-power applications'
  },
  
  'birch-plywood-1/4': {
    name: 'Birch Plywood (1/4" / 6mm)',
    shearModulus: 0.9e9,
    elasticModulus: 13.5e9,
    density: 720,
    poissonRatio: 0.33,
    category: 'wood',
    description: 'Heavy-duty plywood for Level 2+ rockets'
  },
  
  'poplar-plywood': {
    name: 'Poplar Plywood',
    shearModulus: 0.6e9,
    elasticModulus: 9.5e9,
    density: 540,
    poissonRatio: 0.35,
    category: 'wood',
    description: 'Lighter alternative to birch plywood'
  },
  
  'lite-plywood': {
    name: 'Lite-Ply (Aircraft Plywood)',
    shearModulus: 0.75e9,
    elasticModulus: 11.0e9,
    density: 450,
    poissonRatio: 0.33,
    category: 'wood',
    description: 'Lightweight aircraft plywood for competition rockets'
  },
  
  // ============================================
  // Composite Materials
  // ============================================
  
  'g10-fiberglass': {
    name: 'G10 Fiberglass',
    shearModulus: 4.0e9,
    elasticModulus: 18.0e9,
    density: 1800,
    poissonRatio: 0.12,
    category: 'composite',
    description: 'Standard high-power fin material, excellent flutter resistance'
  },
  
  'g10-fiberglass-thin': {
    name: 'G10 Fiberglass (1/16" / 1.5mm)',
    shearModulus: 3.8e9,
    elasticModulus: 17.0e9,
    density: 1750,
    poissonRatio: 0.12,
    category: 'composite',
    description: 'Thin G10 for minimum-diameter rockets'
  },
  
  'carbon-fiber-sheet': {
    name: 'Carbon Fiber Sheet',
    shearModulus: 5.0e9,
    elasticModulus: 70.0e9,
    density: 1550,
    poissonRatio: 0.1,
    category: 'composite',
    description: 'High-performance carbon fiber, very high flutter velocity'
  },
  
  'carbon-fiber-sandwich': {
    name: 'Carbon Fiber Sandwich (Nomex Core)',
    shearModulus: 3.5e9,
    elasticModulus: 45.0e9,
    density: 800,
    poissonRatio: 0.15,
    category: 'composite',
    description: 'Lightweight sandwich construction with carbon face sheets'
  },
  
  'fiberglass-cloth': {
    name: 'Fiberglass Cloth (Wet Layup)',
    shearModulus: 3.0e9,
    elasticModulus: 15.0e9,
    density: 1600,
    poissonRatio: 0.2,
    category: 'composite',
    description: 'Hand-laminated fiberglass, properties vary with layup'
  },
  
  // ============================================
  // Plastic Materials
  // ============================================
  
  'abs': {
    name: 'ABS Plastic',
    shearModulus: 0.8e9,
    elasticModulus: 2.3e9,
    density: 1050,
    poissonRatio: 0.35,
    category: 'plastic',
    description: 'Common 3D printing plastic, moderate flutter resistance'
  },
  
  'pla': {
    name: 'PLA Plastic',
    shearModulus: 1.0e9,
    elasticModulus: 3.5e9,
    density: 1250,
    poissonRatio: 0.36,
    category: 'plastic',
    description: '3D printing plastic, stiffer but more brittle than ABS'
  },
  
  'petg': {
    name: 'PETG Plastic',
    shearModulus: 0.75e9,
    elasticModulus: 2.1e9,
    density: 1270,
    poissonRatio: 0.4,
    category: 'plastic',
    description: '3D printing plastic, good impact resistance'
  },
  
  'acrylic': {
    name: 'Acrylic (Plexiglass)',
    shearModulus: 1.1e9,
    elasticModulus: 3.2e9,
    density: 1180,
    poissonRatio: 0.37,
    category: 'plastic',
    description: 'Clear plastic, brittle at high speeds'
  },
  
  'polycarbonate': {
    name: 'Polycarbonate (Lexan)',
    shearModulus: 0.85e9,
    elasticModulus: 2.4e9,
    density: 1200,
    poissonRatio: 0.37,
    category: 'plastic',
    description: 'Impact-resistant, but lower flutter speed than composites'
  },
  
  'hdpe': {
    name: 'HDPE (High-Density Polyethylene)',
    shearModulus: 0.3e9,
    elasticModulus: 1.0e9,
    density: 950,
    poissonRatio: 0.46,
    category: 'plastic',
    description: 'Flexible, not recommended for high-speed flight'
  },
  
  // ============================================
  // Metal Materials
  // ============================================
  
  'aluminum-6061': {
    name: 'Aluminum 6061-T6',
    shearModulus: 26.0e9,
    elasticModulus: 69.0e9,
    density: 2700,
    poissonRatio: 0.33,
    category: 'metal',
    description: 'Aerospace aluminum, excellent for extreme performance'
  },
  
  'aluminum-2024': {
    name: 'Aluminum 2024-T3',
    shearModulus: 28.0e9,
    elasticModulus: 73.0e9,
    density: 2780,
    poissonRatio: 0.33,
    category: 'metal',
    description: 'High-strength aircraft aluminum'
  },
  
  'titanium': {
    name: 'Titanium (Grade 5)',
    shearModulus: 44.0e9,
    elasticModulus: 114.0e9,
    density: 4430,
    poissonRatio: 0.34,
    category: 'metal',
    description: 'Aerospace titanium, very high flutter speed'
  },
  
  'steel-mild': {
    name: 'Steel (Mild)',
    shearModulus: 80.0e9,
    elasticModulus: 200.0e9,
    density: 7850,
    poissonRatio: 0.29,
    category: 'metal',
    description: 'Heavy but extremely high flutter resistance'
  }
};

// ============================================
// Fin Geometry Calculator
// ============================================

class FinGeometry {
  /**
   * Create fin geometry from measurements
   * 
   * @param {Object} params - Fin dimensions
   * @param {number} params.rootChord - Root chord length (m)
   * @param {number} params.tipChord - Tip chord length (m)
   * @param {number} params.span - Semi-span from root to tip (m)
   * @param {number} params.thickness - Fin thickness (m)
   * @param {number} [params.sweepAngle] - Leading edge sweep angle (degrees)
   * @param {number} [params.sweepDistance] - Leading edge sweep distance (m)
   */
  constructor(params) {
    this.rootChord = params.rootChord;
    this.tipChord = params.tipChord;
    this.span = params.span;
    this.thickness = params.thickness;
    
    // Calculate sweep from angle or distance
    if (params.sweepDistance !== undefined) {
      this.sweepDistance = params.sweepDistance;
      this.sweepAngle = Math.atan(params.sweepDistance / this.span) * 180 / Math.PI;
    } else if (params.sweepAngle !== undefined) {
      this.sweepAngle = params.sweepAngle;
      this.sweepDistance = this.span * Math.tan(params.sweepAngle * Math.PI / 180);
    } else {
      this.sweepDistance = 0;
      this.sweepAngle = 0;
    }
  }
  
  /**
   * Calculate aspect ratio (AR)
   * AR = span² / area = 2 * span / (rootChord + tipChord)
   */
  get aspectRatio() {
    return (2 * this.span) / (this.rootChord + this.tipChord);
  }
  
  /**
   * Calculate taper ratio (λ)
   * λ = tipChord / rootChord
   */
  get taperRatio() {
    return this.tipChord / this.rootChord;
  }
  
  /**
   * Calculate mean aerodynamic chord (MAC)
   */
  get meanChord() {
    return (this.rootChord + this.tipChord) / 2;
  }
  
  /**
   * Calculate planform area (one fin)
   */
  get area() {
    return this.span * (this.rootChord + this.tipChord) / 2;
  }
  
  /**
   * Calculate thickness-to-chord ratio at root
   */
  get thicknessRatio() {
    return this.thickness / this.rootChord;
  }
  
  /**
   * Create from common unit inputs (mm)
   */
  static fromMillimeters(params) {
    return new FinGeometry({
      rootChord: params.rootChord * MM_TO_METER,
      tipChord: params.tipChord * MM_TO_METER,
      span: params.span * MM_TO_METER,
      thickness: params.thickness * MM_TO_METER,
      sweepDistance: params.sweepDistance ? params.sweepDistance * MM_TO_METER : undefined,
      sweepAngle: params.sweepAngle
    });
  }
  
  /**
   * Create from inches
   */
  static fromInches(params) {
    return new FinGeometry({
      rootChord: params.rootChord * INCH_TO_METER,
      tipChord: params.tipChord * INCH_TO_METER,
      span: params.span * INCH_TO_METER,
      thickness: params.thickness * INCH_TO_METER,
      sweepDistance: params.sweepDistance ? params.sweepDistance * INCH_TO_METER : undefined,
      sweepAngle: params.sweepAngle
    });
  }
}

// ============================================
// Flutter Analysis Engine
// ============================================

class FinFlutterAnalysis {
  /**
   * Create flutter analysis for a fin
   * 
   * @param {FinGeometry|Object} geometry - Fin geometry
   * @param {string|Object} material - Material key or custom properties
   */
  constructor(geometry, material) {
    // Handle geometry input
    if (geometry instanceof FinGeometry) {
      this.geometry = geometry;
    } else {
      this.geometry = new FinGeometry(geometry);
    }
    
    // Handle material input
    if (typeof material === 'string') {
      if (!MATERIAL_DATABASE[material]) {
        throw new Error(`Unknown material: ${material}`);
      }
      this.material = MATERIAL_DATABASE[material];
      this.materialKey = material;
    } else {
      this.material = material;
      this.materialKey = 'custom';
    }
  }
  
  /**
   * Calculate flutter velocity using NARTS method
   * 
   * V_flutter = a × √(G / ((AR³ × (λ+1)) / (2 × (AR+2)) × (t/c)³ × P))
   * 
   * Simplified form (sea level):
   * V_flutter = a × √(G × (t/c)³ × (AR+2) / (1.337 × AR³ × P × (λ+1)))
   * 
   * Where:
   *   a = speed of sound
   *   G = shear modulus (Pa)
   *   AR = aspect ratio
   *   λ = taper ratio
   *   t/c = thickness/chord ratio
   *   P = air pressure (Pa)
   * 
   * @param {Object} [conditions] - Atmospheric conditions
   * @param {number} [conditions.altitude=0] - Altitude in meters
   * @param {number} [conditions.temperature=288.15] - Temperature in Kelvin
   * @returns {Object} Flutter analysis results
   */
  calculateFlutterVelocity(conditions = {}) {
    const altitude = conditions.altitude || 0;
    const temperature = conditions.temperature || 288.15; // 15°C
    
    // Atmospheric model (simplified ISA)
    const { pressure, density, speedOfSound } = this.getAtmosphere(altitude, temperature);
    
    // Fin geometry parameters
    const AR = this.geometry.aspectRatio;
    const lambda = this.geometry.taperRatio;
    const tc = this.geometry.thicknessRatio;
    const G = this.material.shearModulus;
    
    // NARTS flutter velocity formula
    // V_f = a × √(G / (((1.337 × AR³ × P) / (AR + 2)) × ((λ + 1) / 2) × (1/tc)³))
    
    const numerator = G;
    const denominator = (1.337 * Math.pow(AR, 3) * pressure / (AR + 2)) * 
                        ((lambda + 1) / 2) * 
                        Math.pow(1 / tc, 3);
    
    const flutterVelocity = speedOfSound * Math.sqrt(numerator / denominator);
    
    // Calculate Mach number at flutter
    const flutterMach = flutterVelocity / speedOfSound;
    
    return {
      flutterVelocity,                              // m/s
      flutterVelocityFps: flutterVelocity * MPS_TO_FPS,
      flutterVelocityMph: flutterVelocity * MPS_TO_MPH,
      flutterMach,
      
      // Atmospheric conditions used
      conditions: {
        altitude,
        temperature,
        pressure,
        density,
        speedOfSound
      },
      
      // Geometry factors
      geometry: {
        aspectRatio: AR,
        taperRatio: lambda,
        thicknessRatio: tc,
        span: this.geometry.span,
        rootChord: this.geometry.rootChord,
        tipChord: this.geometry.tipChord,
        thickness: this.geometry.thickness
      },
      
      // Material
      material: {
        name: this.material.name,
        shearModulus: G,
        density: this.material.density
      }
    };
  }
  
  /**
   * Analyze flutter safety for expected flight profile
   * 
   * @param {number} maxExpectedVelocity - Maximum expected velocity (m/s)
   * @param {Object} [options] - Analysis options
   * @param {number} [options.safetyFactor=1.25] - Required safety factor
   * @param {number} [options.altitude=0] - Altitude at max velocity
   * @returns {Object} Safety analysis results
   */
  analyze(maxExpectedVelocity, options = {}) {
    const safetyFactor = options.safetyFactor || 1.25;
    const altitude = options.altitude || 0;
    
    // Calculate flutter velocity
    const flutter = this.calculateFlutterVelocity({ altitude });
    
    // Calculate safety margin
    const actualSafetyFactor = flutter.flutterVelocity / maxExpectedVelocity;
    const safetyMargin = (actualSafetyFactor - 1) * 100;
    const meetsRequirement = actualSafetyFactor >= safetyFactor;
    
    // Determine status
    let status, severity, recommendation;
    
    if (actualSafetyFactor >= 2.0) {
      status = 'EXCELLENT';
      severity = 'safe';
      recommendation = 'Fins have excellent flutter margin. Safe for flight.';
    } else if (actualSafetyFactor >= 1.5) {
      status = 'GOOD';
      severity = 'safe';
      recommendation = 'Fins have good flutter margin. Safe for flight.';
    } else if (actualSafetyFactor >= 1.25) {
      status = 'ADEQUATE';
      severity = 'caution';
      recommendation = 'Fins meet minimum safety margin. Consider thicker fins for added safety.';
    } else if (actualSafetyFactor >= 1.0) {
      status = 'MARGINAL';
      severity = 'warning';
      recommendation = 'Flutter velocity is close to max velocity. Strongly recommend thicker fins or different material.';
    } else {
      status = 'UNSAFE';
      severity = 'danger';
      recommendation = 'DANGER: Expected velocity exceeds flutter velocity. Fin failure likely. Use thicker fins or stronger material.';
    }
    
    // Calculate recommended minimum thickness
    const recommendedThickness = this.calculateMinimumThickness(
      maxExpectedVelocity * safetyFactor,
      altitude
    );
    
    return {
      // Core results
      flutterVelocity: flutter.flutterVelocity,
      flutterVelocityFps: flutter.flutterVelocityFps,
      flutterMach: flutter.flutterMach,
      
      maxExpectedVelocity,
      maxExpectedVelocityFps: maxExpectedVelocity * MPS_TO_FPS,
      
      // Safety assessment
      safetyFactor: actualSafetyFactor,
      requiredSafetyFactor: safetyFactor,
      safetyMargin,
      meetsRequirement,
      
      // Status
      status,
      severity,
      recommendation,
      
      // Current design
      currentThickness: this.geometry.thickness,
      currentThicknessMm: this.geometry.thickness / MM_TO_METER,
      currentThicknessIn: this.geometry.thickness / INCH_TO_METER,
      
      // Recommendations
      recommendedMinThickness: recommendedThickness,
      recommendedMinThicknessMm: recommendedThickness / MM_TO_METER,
      recommendedMinThicknessIn: recommendedThickness / INCH_TO_METER,
      
      // Detailed flutter data
      flutter,
      
      // Input summary
      input: {
        maxExpectedVelocity,
        safetyFactor,
        altitude,
        material: this.material.name,
        geometry: this.geometry
      }
    };
  }
  
  /**
   * Calculate minimum thickness needed for target flutter velocity
   * 
   * Solving the flutter equation for thickness:
   * t = c × ∛(1.337 × AR³ × P × (λ+1) × V_f² / (2 × G × a² × (AR+2)))
   */
  calculateMinimumThickness(targetFlutterVelocity, altitude = 0) {
    const { pressure, speedOfSound } = this.getAtmosphere(altitude);
    
    const AR = this.geometry.aspectRatio;
    const lambda = this.geometry.taperRatio;
    const G = this.material.shearModulus;
    const c = this.geometry.rootChord;
    const Vf = targetFlutterVelocity;
    const a = speedOfSound;
    
    const tcCubed = (1.337 * Math.pow(AR, 3) * pressure * (lambda + 1) * Math.pow(Vf / a, 2)) /
                   (2 * G * (AR + 2));
    
    const tc = Math.pow(tcCubed, 1/3);
    const thickness = tc * c;
    
    return thickness;
  }
  
  /**
   * Get atmospheric properties at altitude (simplified ISA model)
   */
  getAtmosphere(altitude, baseTemperature = 288.15) {
    // Troposphere lapse rate: -6.5°C per 1000m
    const lapseRate = 0.0065;
    const seaLevelPressure = 101325; // Pa
    
    // Temperature at altitude
    const temperature = baseTemperature - lapseRate * altitude;
    
    // Pressure at altitude (barometric formula)
    const pressure = seaLevelPressure * Math.pow(
      temperature / baseTemperature,
      GRAVITY / (lapseRate * 287.05)
    );
    
    // Density from ideal gas law
    const density = pressure / (287.05 * temperature);
    
    // Speed of sound
    const gamma = 1.4; // Ratio of specific heats for air
    const R = 287.05;  // Gas constant for air
    const speedOfSound = Math.sqrt(gamma * R * temperature);
    
    return { pressure, density, temperature, speedOfSound };
  }
  
  /**
   * Compare multiple materials for this fin geometry
   */
  compareMaterials(maxExpectedVelocity, materialKeys = null) {
    const keys = materialKeys || Object.keys(MATERIAL_DATABASE);
    const results = [];
    
    for (const key of keys) {
      const material = MATERIAL_DATABASE[key];
      if (!material) continue;
      
      const analysis = new FinFlutterAnalysis(this.geometry, material);
      const result = analysis.analyze(maxExpectedVelocity);
      
      results.push({
        materialKey: key,
        material: material.name,
        category: material.category,
        flutterVelocity: result.flutterVelocity,
        flutterVelocityFps: result.flutterVelocityFps,
        safetyFactor: result.safetyFactor,
        status: result.status,
        severity: result.severity
      });
    }
    
    // Sort by safety factor (highest first)
    results.sort((a, b) => b.safetyFactor - a.safetyFactor);
    
    return results;
  }
  
  /**
   * Find optimal thickness for target safety factor
   */
  optimizeThickness(maxExpectedVelocity, targetSafetyFactor = 1.5, altitude = 0) {
    const targetFlutterVelocity = maxExpectedVelocity * targetSafetyFactor;
    const optimalThickness = this.calculateMinimumThickness(targetFlutterVelocity, altitude);
    
    // Verify result
    const verifyGeometry = new FinGeometry({
      ...this.geometry,
      thickness: optimalThickness
    });
    const verifyAnalysis = new FinFlutterAnalysis(verifyGeometry, this.material);
    const verification = verifyAnalysis.analyze(maxExpectedVelocity, { safetyFactor: targetSafetyFactor, altitude });
    
    return {
      optimalThickness,
      optimalThicknessMm: optimalThickness / MM_TO_METER,
      optimalThicknessIn: optimalThickness / INCH_TO_METER,
      currentThickness: this.geometry.thickness,
      currentThicknessMm: this.geometry.thickness / MM_TO_METER,
      thicknessIncrease: optimalThickness - this.geometry.thickness,
      thicknessIncreaseMm: (optimalThickness - this.geometry.thickness) / MM_TO_METER,
      percentIncrease: ((optimalThickness / this.geometry.thickness) - 1) * 100,
      verification
    };
  }
}

// ============================================
// Flutter Analysis UI Component
// ============================================

class FlutterAnalysisUI {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = null;
    this.analysis = null;
    this.result = null;
    this.onAnalysis = options.onAnalysis || (() => {});
  }
  
  initialize() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      log.error(`Container ${this.containerId} not found`);
      return;
    }
    
    this.render();
    this.setupEventListeners();
  }
  
  render() {
    const materialOptions = Object.entries(MATERIAL_DATABASE)
      .map(([key, mat]) => `<option value="${key}">${mat.name}</option>`)
      .join('');
    
    this.container.innerHTML = `
      <div class="flutter-analysis-ui">
        <div class="flutter-form">
          <div class="form-row">
            <div class="form-group">
              <label>Root Chord</label>
              <div class="input-unit">
                <input type="number" id="flutter-root-chord" value="100" min="10" step="1">
                <span>mm</span>
              </div>
            </div>
            <div class="form-group">
              <label>Tip Chord</label>
              <div class="input-unit">
                <input type="number" id="flutter-tip-chord" value="50" min="0" step="1">
                <span>mm</span>
              </div>
            </div>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label>Span</label>
              <div class="input-unit">
                <input type="number" id="flutter-span" value="80" min="10" step="1">
                <span>mm</span>
              </div>
            </div>
            <div class="form-group">
              <label>Thickness</label>
              <div class="input-unit">
                <input type="number" id="flutter-thickness" value="3.2" min="0.5" step="0.1">
                <span>mm</span>
              </div>
            </div>
          </div>
          
          <div class="form-row">
            <div class="form-group">
              <label>Material</label>
              <select id="flutter-material">
                ${materialOptions}
              </select>
            </div>
            <div class="form-group">
              <label>Max Velocity</label>
              <div class="input-unit">
                <input type="number" id="flutter-max-velocity" value="200" min="10" step="10">
                <span>m/s</span>
              </div>
            </div>
          </div>
          
          <button class="btn btn-primary" id="btn-analyze-flutter">
            📐 Analyze Flutter
          </button>
        </div>
        
        <div class="flutter-results" id="flutter-results"></div>
      </div>
    `;
  }
  
  setupEventListeners() {
    const analyzeBtn = this.container.querySelector('#btn-analyze-flutter');
    analyzeBtn?.addEventListener('click', () => this.runAnalysis());
    
    // Auto-analyze on input change
    const inputs = this.container.querySelectorAll('input, select');
    inputs.forEach(input => {
      input.addEventListener('change', () => this.runAnalysis());
    });
  }
  
  runAnalysis() {
    const rootChord = parseFloat(this.container.querySelector('#flutter-root-chord').value);
    const tipChord = parseFloat(this.container.querySelector('#flutter-tip-chord').value);
    const span = parseFloat(this.container.querySelector('#flutter-span').value);
    const thickness = parseFloat(this.container.querySelector('#flutter-thickness').value);
    const material = this.container.querySelector('#flutter-material').value;
    const maxVelocity = parseFloat(this.container.querySelector('#flutter-max-velocity').value);
    
    try {
      const geometry = FinGeometry.fromMillimeters({
        rootChord,
        tipChord,
        span,
        thickness
      });
      
      this.analysis = new FinFlutterAnalysis(geometry, material);
      this.result = this.analysis.analyze(maxVelocity);
      
      this.renderResults();
      this.onAnalysis(this.result);
      
    } catch (error) {
      log.error('Flutter analysis failed:', error);
      const resultsEl = this.container.querySelector('#flutter-results');
      if (resultsEl) {
        resultsEl.innerHTML = `<p class="error">Analysis failed: ${error.message}</p>`;
      }
    }
  }
  
  renderResults() {
    const resultsEl = this.container.querySelector('#flutter-results');
    if (!resultsEl || !this.result) return;
    
    const r = this.result;
    const severityClass = r.severity;
    
    resultsEl.innerHTML = `
      <div class="flutter-status ${severityClass}">
        <span class="status-icon">${this.getStatusIcon(r.status)}</span>
        <span class="status-text">${r.status}</span>
      </div>
      
      <div class="flutter-stats">
        <div class="flutter-stat">
          <span class="stat-value">${r.flutterVelocityFps.toFixed(0)}</span>
          <span class="stat-unit">ft/s</span>
          <span class="stat-label">Flutter Velocity</span>
        </div>
        <div class="flutter-stat">
          <span class="stat-value">${r.maxExpectedVelocityFps.toFixed(0)}</span>
          <span class="stat-unit">ft/s</span>
          <span class="stat-label">Max Expected</span>
        </div>
        <div class="flutter-stat highlight">
          <span class="stat-value">${r.safetyFactor.toFixed(2)}x</span>
          <span class="stat-label">Safety Factor</span>
        </div>
        <div class="flutter-stat">
          <span class="stat-value">${r.flutterMach.toFixed(2)}</span>
          <span class="stat-label">Flutter Mach</span>
        </div>
      </div>
      
      <div class="flutter-recommendation ${severityClass}">
        <p>${r.recommendation}</p>
      </div>
      
      ${r.safetyFactor < 1.5 ? `
        <div class="flutter-suggestion">
          <p><strong>Suggestion:</strong> Increase thickness to at least 
            <strong>${r.recommendedMinThicknessMm.toFixed(1)} mm</strong> 
            (${r.recommendedMinThicknessIn.toFixed(3)}") for adequate safety margin.</p>
        </div>
      ` : ''}
      
      <div class="flutter-details">
        <p><strong>Material:</strong> ${r.flutter.material.name}</p>
        <p><strong>Aspect Ratio:</strong> ${r.flutter.geometry.aspectRatio.toFixed(2)}</p>
        <p><strong>Taper Ratio:</strong> ${r.flutter.geometry.taperRatio.toFixed(2)}</p>
        <p><strong>t/c Ratio:</strong> ${(r.flutter.geometry.thicknessRatio * 100).toFixed(1)}%</p>
      </div>
    `;
  }
  
  getStatusIcon(status) {
    const icons = {
      'EXCELLENT': '✅',
      'GOOD': '✅',
      'ADEQUATE': '⚠️',
      'MARGINAL': '⚠️',
      'UNSAFE': '🛑'
    };
    return icons[status] || '❓';
  }
  
  /**
   * Set fin geometry from external source (e.g., rocket design)
   */
  setFinGeometry(fin) {
    if (!fin) return;
    
    const rootChord = this.container.querySelector('#flutter-root-chord');
    const tipChord = this.container.querySelector('#flutter-tip-chord');
    const span = this.container.querySelector('#flutter-span');
    
    if (rootChord && fin.rootChord) rootChord.value = fin.rootChord;
    if (tipChord && fin.tipChord) tipChord.value = fin.tipChord;
    if (span && fin.span) span.value = fin.span;
    
    this.runAnalysis();
  }
  
  /**
   * Set max velocity from simulation
   */
  setMaxVelocity(velocity) {
    const input = this.container.querySelector('#flutter-max-velocity');
    if (input) {
      input.value = velocity.toFixed(0);
      this.runAnalysis();
    }
  }
}

// ============================================
// Exports
// ============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FinFlutterAnalysis,
    FinGeometry,
    FlutterAnalysisUI,
    MATERIAL_DATABASE,
    SPEED_OF_SOUND_SEA_LEVEL
  };
}

if (typeof window !== 'undefined') {
  window.FinFlutterAnalysis = FinFlutterAnalysis;
  window.FinGeometry = FinGeometry;
  window.FlutterAnalysisUI = FlutterAnalysisUI;
  window.MATERIAL_DATABASE = MATERIAL_DATABASE;
}

export { 
  FinFlutterAnalysis, 
  FinGeometry, 
  FlutterAnalysisUI,
  MATERIAL_DATABASE,
  SPEED_OF_SOUND_SEA_LEVEL
};

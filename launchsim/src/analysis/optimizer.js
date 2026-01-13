/**
 * LAUNCHSIM Optimization Tools
 * ============================
 * 
 * Auto-tune rocket configuration to achieve target altitude.
 * Searches motor database and optimizes delay timing.
 * 
 * Features:
 * - Target altitude optimization
 * - Motor selection with constraints
 * - Delay optimization
 * - Multi-objective optimization (altitude + drift)
 * - TARC-specific optimization mode
 * 
 * Usage:
 *   const optimizer = new FlightOptimizer(rocketConfig, motorDatabase);
 *   const results = await optimizer.optimizeForAltitude(850, { units: 'feet' });
 */

// Debug mode
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[Optimizer]', ...args),
  warn: (...args) => console.warn('[Optimizer]', ...args),
  error: (...args) => console.error('[Optimizer]', ...args)
};

// ============================================
// Constants
// ============================================

const FEET_TO_METERS = 0.3048;
const METERS_TO_FEET = 3.28084;

// Standard delay increments available
const STANDARD_DELAYS = [3, 4, 5, 6, 7, 8, 10, 12, 14];

// Impulse class ranges (Ns)
const IMPULSE_CLASSES = {
  'A': { min: 1.26, max: 2.5 },
  'B': { min: 2.5, max: 5 },
  'C': { min: 5, max: 10 },
  'D': { min: 10, max: 20 },
  'E': { min: 20, max: 40 },
  'F': { min: 40, max: 80 },
  'G': { min: 80, max: 160 },
  'H': { min: 160, max: 320 },
  'I': { min: 320, max: 640 },
  'J': { min: 640, max: 1280 },
  'K': { min: 1280, max: 2560 },
  'L': { min: 2560, max: 5120 },
  'M': { min: 5120, max: 10240 },
  'N': { min: 10240, max: 20480 },
  'O': { min: 20480, max: 40960 }
};

// ============================================
// Quick Simulation (Simplified Physics)
// ============================================

class QuickSim {
  /**
   * Fast analytical approximation for motor screening
   * Much faster than full 6-DOF simulation
   */
  static estimateApogee(rocket, motor, environment = {}) {
    const g = 9.81;
    const rho = environment.airDensity || 1.225;
    
    // Rocket parameters
    const dryMass = rocket.mass || 0.1; // kg
    const diameter = rocket.diameter || 0.041; // m
    const cd = rocket.cd || 0.5;
    const area = Math.PI * Math.pow(diameter / 2, 2);
    
    // Motor parameters
    const propMass = (motor.propMass || motor.propellantMass || 20) / 1000; // kg
    const totalMotorMass = (motor.totalMass || motor.totalWeight || 50) / 1000; // kg
    const avgThrust = motor.avgThrust || motor.averageThrust || 10; // N
    const burnTime = motor.burnTime || 1.5; // s
    const totalImpulse = motor.totalImpulse || (avgThrust * burnTime);
    
    // Average mass during burn
    const m0 = dryMass + totalMotorMass; // Initial mass
    const mf = dryMass + (totalMotorMass - propMass); // Final mass (burnout)
    const avgMass = (m0 + mf) / 2;
    
    // Simplified drag coefficient during boost
    const k = 0.5 * rho * cd * area;
    
    // Terminal velocity (approximate)
    const vt = Math.sqrt((avgMass * g) / k);
    
    // Boost phase (simplified - ignores drag for estimation)
    const netThrust = avgThrust - avgMass * g;
    const boostAccel = netThrust / avgMass;
    
    // Burnout velocity (with simple drag approximation)
    let burnoutVelocity;
    if (boostAccel > 0) {
      // Account for drag during boost (approximate)
      const dragFactor = 1 - (avgThrust / (3 * avgMass * g));
      burnoutVelocity = boostAccel * burnTime * Math.max(0.5, dragFactor);
    } else {
      burnoutVelocity = 0;
    }
    
    // Burnout altitude
    const burnoutAlt = 0.5 * boostAccel * burnTime * burnTime;
    
    // Coast phase - use energy method with drag
    const coastMass = mf;
    const kCoast = 0.5 * rho * cd * area;
    
    // Coast altitude (with drag)
    let coastAlt;
    if (burnoutVelocity > 0) {
      const vtCoast = Math.sqrt((coastMass * g) / kCoast);
      coastAlt = (vtCoast * vtCoast / g) * Math.log(1 + Math.pow(burnoutVelocity / vtCoast, 2)) / 2;
    } else {
      coastAlt = 0;
    }
    
    // Time to apogee (approximate)
    const timeToApogee = burnTime + (burnoutVelocity / g) * 0.8; // 0.8 factor for drag
    
    const apogee = Math.max(0, burnoutAlt + coastAlt);
    
    return {
      apogee,
      burnoutVelocity,
      burnoutAltitude: burnoutAlt,
      coastAltitude: coastAlt,
      timeToApogee,
      thrustToWeight: avgThrust / (m0 * g),
      burnoutMass: mf
    };
  }
  
  /**
   * Estimate optimal delay for a motor
   */
  static estimateOptimalDelay(rocket, motor, environment = {}) {
    const sim = this.estimateApogee(rocket, motor, environment);
    const coastTime = sim.timeToApogee - (motor.burnTime || 1.5);
    
    // Add 0.5-1 second margin for safety
    const optimalDelay = Math.max(3, coastTime + 0.5);
    
    // Find nearest standard delay
    const nearestDelay = STANDARD_DELAYS.reduce((prev, curr) => 
      Math.abs(curr - optimalDelay) < Math.abs(prev - optimalDelay) ? curr : prev
    );
    
    return {
      optimal: optimalDelay,
      recommended: nearestDelay,
      coastTime,
      availableDelays: STANDARD_DELAYS.filter(d => Math.abs(d - optimalDelay) <= 3)
    };
  }
}

// ============================================
// Motor Filter
// ============================================

class MotorFilter {
  constructor(motors) {
    this.motors = motors || [];
  }
  
  /**
   * Filter motors by constraints
   */
  filter(constraints = {}) {
    let filtered = [...this.motors];
    
    // Filter by diameter
    if (constraints.diameter) {
      const tolerance = constraints.diameterTolerance || 0.5;
      filtered = filtered.filter(m => {
        const d = m.diameter || 18;
        return Math.abs(d - constraints.diameter) <= tolerance;
      });
    }
    
    // Filter by max diameter
    if (constraints.maxDiameter) {
      filtered = filtered.filter(m => (m.diameter || 18) <= constraints.maxDiameter);
    }
    
    // Filter by impulse class
    if (constraints.impulseClass) {
      const classes = Array.isArray(constraints.impulseClass) 
        ? constraints.impulseClass 
        : [constraints.impulseClass];
      filtered = filtered.filter(m => {
        const motorClass = this.getImpulseClass(m.totalImpulse);
        return classes.includes(motorClass);
      });
    }
    
    // Filter by max impulse class
    if (constraints.maxImpulseClass) {
      const maxClassIndex = Object.keys(IMPULSE_CLASSES).indexOf(constraints.maxImpulseClass);
      filtered = filtered.filter(m => {
        const motorClass = this.getImpulseClass(m.totalImpulse);
        const classIndex = Object.keys(IMPULSE_CLASSES).indexOf(motorClass);
        return classIndex <= maxClassIndex;
      });
    }
    
    // Filter by min impulse class
    if (constraints.minImpulseClass) {
      const minClassIndex = Object.keys(IMPULSE_CLASSES).indexOf(constraints.minImpulseClass);
      filtered = filtered.filter(m => {
        const motorClass = this.getImpulseClass(m.totalImpulse);
        const classIndex = Object.keys(IMPULSE_CLASSES).indexOf(motorClass);
        return classIndex >= minClassIndex;
      });
    }
    
    // Filter by manufacturer
    if (constraints.manufacturer) {
      const mfrs = Array.isArray(constraints.manufacturer)
        ? constraints.manufacturer.map(s => s.toLowerCase())
        : [constraints.manufacturer.toLowerCase()];
      filtered = filtered.filter(m => {
        const mfr = (m.manufacturer || '').toLowerCase();
        return mfrs.some(f => mfr.includes(f));
      });
    }
    
    // Filter by certification level
    if (constraints.certLevel) {
      // L1 = up to H, L2 = up to J, L3 = K and above
      const levelMap = {
        'L1': ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
        'L2': ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
        'L3': Object.keys(IMPULSE_CLASSES)
      };
      const allowedClasses = levelMap[constraints.certLevel] || levelMap['L1'];
      filtered = filtered.filter(m => {
        const motorClass = this.getImpulseClass(m.totalImpulse);
        return allowedClasses.includes(motorClass);
      });
    }
    
    // Filter by propellant type
    if (constraints.propellantType) {
      const types = Array.isArray(constraints.propellantType)
        ? constraints.propellantType.map(s => s.toLowerCase())
        : [constraints.propellantType.toLowerCase()];
      filtered = filtered.filter(m => {
        const prop = (m.propellantType || m.propellant || '').toLowerCase();
        return types.some(t => prop.includes(t));
      });
    }
    
    // Filter by availability
    if (constraints.availableOnly) {
      filtered = filtered.filter(m => m.available !== false);
    }
    
    // Filter by thrust-to-weight ratio
    if (constraints.minThrustToWeight && constraints.rocketMass) {
      const minTW = constraints.minThrustToWeight;
      const rocketMass = constraints.rocketMass;
      filtered = filtered.filter(m => {
        const totalMass = rocketMass + ((m.totalMass || 50) / 1000);
        const tw = (m.avgThrust || 10) / (totalMass * 9.81);
        return tw >= minTW;
      });
    }
    
    return filtered;
  }
  
  /**
   * Get impulse class letter from total impulse
   */
  getImpulseClass(totalImpulse) {
    for (const [letter, range] of Object.entries(IMPULSE_CLASSES)) {
      if (totalImpulse >= range.min && totalImpulse < range.max) {
        return letter;
      }
    }
    return totalImpulse < 1.26 ? '1/2A' : 'O+';
  }
}

// ============================================
// Flight Optimizer
// ============================================

class FlightOptimizer {
  constructor(rocket, motors, options = {}) {
    this.rocket = this.normalizeRocket(rocket);
    this.motors = motors || [];
    this.motorFilter = new MotorFilter(this.motors);
    this.options = {
      maxResults: options.maxResults || 10,
      simulationsPerMotor: options.simulationsPerMotor || 5,
      ...options
    };
  }
  
  normalizeRocket(rocket) {
    return {
      name: rocket.name || 'Rocket',
      mass: (rocket.mass || rocket.dryMass || 100) / 1000, // Convert to kg if in grams
      diameter: (rocket.diameter || rocket.bodyDiameter || 41) / 1000, // Convert to m if in mm
      cd: rocket.cd || 0.5,
      chuteArea: rocket.chuteArea || Math.PI * Math.pow((rocket.chuteDiameter || 450) / 2000, 2),
      chuteCd: rocket.chuteCd || 0.8,
      motorDiameter: rocket.motorDiameter || 29
    };
  }
  
  /**
   * Optimize for target altitude
   * @param {number} targetAltitude - Target altitude
   * @param {Object} options - Optimization options
   * @returns {Array} Ranked motor recommendations
   */
  async optimizeForAltitude(targetAltitude, options = {}) {
    const units = options.units || 'meters';
    const targetMeters = units === 'feet' ? targetAltitude * FEET_TO_METERS : targetAltitude;
    
    // Motor constraints
    const constraints = {
      maxDiameter: this.rocket.motorDiameter + 1,
      minThrustToWeight: options.minThrustToWeight || 5,
      rocketMass: this.rocket.mass,
      ...options.constraints
    };
    
    // Filter motors
    const candidateMotors = this.motorFilter.filter(constraints);
    log.debug(`Evaluating ${candidateMotors.length} candidate motors`);
    
    if (candidateMotors.length === 0) {
      return {
        success: false,
        error: 'No motors match the specified constraints',
        constraints
      };
    }
    
    // Evaluate each motor
    const results = [];
    
    for (const motor of candidateMotors) {
      const sim = QuickSim.estimateApogee(this.rocket, motor);
      const delay = QuickSim.estimateOptimalDelay(this.rocket, motor);
      
      const error = sim.apogee - targetMeters;
      const errorPercent = (error / targetMeters) * 100;
      
      // Score based on how close to target (0 = perfect)
      const score = 100 - Math.min(100, Math.abs(errorPercent));
      
      results.push({
        motor: {
          designation: motor.designation || motor.commonName,
          manufacturer: motor.manufacturer,
          diameter: motor.diameter,
          totalImpulse: motor.totalImpulse,
          avgThrust: motor.avgThrust,
          burnTime: motor.burnTime,
          propellantType: motor.propellantType
        },
        prediction: {
          apogee: sim.apogee,
          apogeeFeet: sim.apogee * METERS_TO_FEET,
          burnoutVelocity: sim.burnoutVelocity,
          timeToApogee: sim.timeToApogee,
          thrustToWeight: sim.thrustToWeight
        },
        delay: {
          optimal: delay.optimal,
          recommended: delay.recommended,
          available: delay.availableDelays
        },
        accuracy: {
          error,
          errorFeet: error * METERS_TO_FEET,
          errorPercent,
          score
        }
      });
    }
    
    // Sort by score (highest first)
    results.sort((a, b) => b.accuracy.score - a.accuracy.score);
    
    // Take top results
    const topResults = results.slice(0, this.options.maxResults);
    
    return {
      success: true,
      target: {
        altitude: targetAltitude,
        altitudeMeters: targetMeters,
        units
      },
      constraints,
      totalCandidates: candidateMotors.length,
      recommendations: topResults,
      bestMatch: topResults[0] || null
    };
  }
  
  /**
   * TARC optimization mode
   * Target: 825 feet altitude, 41-44 second flight time
   */
  async optimizeForTARC(options = {}) {
    const targetAltitude = options.targetAltitude || 825; // feet
    const targetTime = options.targetTime || 42.5; // seconds (middle of 41-44 range)
    const altitudeWeight = options.altitudeWeight || 0.5;
    const timeWeight = options.timeWeight || 0.5;
    
    const targetMeters = targetAltitude * FEET_TO_METERS;
    
    // TARC motor constraints (typically F and under for TARC)
    const constraints = {
      maxDiameter: this.rocket.motorDiameter + 1,
      maxImpulseClass: options.maxImpulseClass || 'G',
      minThrustToWeight: 5,
      rocketMass: this.rocket.mass,
      ...options.constraints
    };
    
    const candidateMotors = this.motorFilter.filter(constraints);
    
    if (candidateMotors.length === 0) {
      return {
        success: false,
        error: 'No motors match TARC constraints'
      };
    }
    
    const results = [];
    
    for (const motor of candidateMotors) {
      const sim = QuickSim.estimateApogee(this.rocket, motor);
      const delay = QuickSim.estimateOptimalDelay(this.rocket, motor);
      
      // Estimate total flight time
      const descentRate = Math.sqrt(
        (2 * sim.burnoutMass * 9.81) / 
        (1.225 * this.rocket.chuteCd * this.rocket.chuteArea)
      );
      const descentTime = sim.apogee / descentRate;
      const totalTime = sim.timeToApogee + descentTime;
      
      // TARC scoring
      const altitudeError = Math.abs(sim.apogee - targetMeters);
      const altitudeErrorFeet = altitudeError * METERS_TO_FEET;
      const timeError = Math.abs(totalTime - targetTime);
      
      // TARC score (lower is better): altitude error (ft) + time error (s)
      const tarcScore = altitudeErrorFeet + timeError;
      
      // Normalized score (higher is better, 0-100)
      const normalizedScore = Math.max(0, 100 - tarcScore);
      
      results.push({
        motor: {
          designation: motor.designation || motor.commonName,
          manufacturer: motor.manufacturer,
          diameter: motor.diameter,
          totalImpulse: motor.totalImpulse,
          avgThrust: motor.avgThrust,
          burnTime: motor.burnTime
        },
        prediction: {
          apogee: sim.apogee,
          apogeeFeet: sim.apogee * METERS_TO_FEET,
          flightTime: totalTime,
          descentRate,
          timeToApogee: sim.timeToApogee,
          descentTime
        },
        delay: {
          optimal: delay.optimal,
          recommended: delay.recommended
        },
        tarcScoring: {
          altitudeError: altitudeErrorFeet,
          timeError,
          tarcScore,
          normalizedScore
        }
      });
    }
    
    // Sort by TARC score (lowest first)
    results.sort((a, b) => a.tarcScoring.tarcScore - b.tarcScoring.tarcScore);
    
    const topResults = results.slice(0, this.options.maxResults);
    
    return {
      success: true,
      mode: 'TARC',
      target: {
        altitude: targetAltitude,
        altitudeMeters: targetMeters,
        flightTime: targetTime,
        timeWindow: '41-44 seconds'
      },
      constraints,
      totalCandidates: candidateMotors.length,
      recommendations: topResults,
      bestMatch: topResults[0] || null
    };
  }
  
  /**
   * Find motor for minimum drift (lowest apogee that still clears target)
   */
  async optimizeForMinimumDrift(minAltitude, options = {}) {
    const units = options.units || 'meters';
    const minMeters = units === 'feet' ? minAltitude * FEET_TO_METERS : minAltitude;
    
    // First get all motors that can reach minimum altitude
    const altitudeResults = await this.optimizeForAltitude(minAltitude * 1.2, {
      units,
      constraints: options.constraints
    });
    
    if (!altitudeResults.success) {
      return altitudeResults;
    }
    
    // Filter to only those that exceed minimum and sort by lowest apogee
    const validResults = altitudeResults.recommendations
      .filter(r => r.prediction.apogee >= minMeters)
      .sort((a, b) => a.prediction.apogee - b.prediction.apogee);
    
    return {
      success: true,
      mode: 'minimumDrift',
      target: {
        minimumAltitude: minAltitude,
        minimumAltitudeMeters: minMeters,
        units
      },
      recommendations: validResults.slice(0, this.options.maxResults),
      bestMatch: validResults[0] || null
    };
  }
  
  /**
   * Grid search for optimal delay
   */
  optimizeDelay(motor, options = {}) {
    const delays = options.delays || STANDARD_DELAYS;
    const results = [];
    
    for (const delay of delays) {
      const sim = QuickSim.estimateApogee(this.rocket, motor);
      const optDelay = QuickSim.estimateOptimalDelay(this.rocket, motor);
      
      // Evaluate delay quality
      const delayError = Math.abs(delay - optDelay.optimal);
      const isEarly = delay < optDelay.optimal;
      const isLate = delay > optDelay.optimal;
      
      let quality = 'good';
      let warning = null;
      
      if (isEarly && delayError > 2) {
        quality = 'early';
        warning = 'Ejection before apogee - higher descent speed';
      } else if (isLate && delayError > 2) {
        quality = 'late';
        warning = 'Ejection after apogee - rocket descending at ejection';
      } else if (delayError > 1) {
        quality = 'acceptable';
      }
      
      results.push({
        delay,
        optimalDelay: optDelay.optimal,
        error: delayError,
        quality,
        warning,
        apogee: sim.apogee,
        coastTime: optDelay.coastTime
      });
    }
    
    return {
      motor: motor.designation || motor.commonName,
      recommendations: results.sort((a, b) => a.error - b.error),
      best: results.sort((a, b) => a.error - b.error)[0]
    };
  }
}

// ============================================
// Optimizer UI Component
// ============================================

class OptimizerUI {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = null;
    this.optimizer = null;
    this.onResult = options.onResult || (() => {});
  }
  
  initialize(rocket, motors) {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      log.error(`Container ${this.containerId} not found`);
      return;
    }
    
    this.optimizer = new FlightOptimizer(rocket, motors);
    this.render();
    this.setupEventListeners();
  }
  
  render() {
    this.container.innerHTML = `
      <div class="optimizer-ui">
        <div class="optimizer-header">
          <h3>🎯 Flight Optimizer</h3>
          <p>Find the optimal motor for your target altitude</p>
        </div>
        
        <div class="optimizer-form">
          <div class="form-group">
            <label>Optimization Mode</label>
            <select id="opt-mode">
              <option value="altitude">Target Altitude</option>
              <option value="tarc">TARC Competition</option>
              <option value="minDrift">Minimum Drift</option>
            </select>
          </div>
          
          <div class="form-group" id="altitude-input">
            <label>Target Altitude</label>
            <div class="input-with-unit">
              <input type="number" id="opt-altitude" value="850" min="100" max="50000">
              <select id="opt-units">
                <option value="feet">feet</option>
                <option value="meters">meters</option>
              </select>
            </div>
          </div>
          
          <div class="form-group">
            <label>Motor Constraints</label>
            <div class="constraint-row">
              <label>Max Diameter</label>
              <select id="opt-diameter">
                <option value="18">18mm</option>
                <option value="24">24mm</option>
                <option value="29" selected>29mm</option>
                <option value="38">38mm</option>
                <option value="54">54mm</option>
                <option value="75">75mm</option>
              </select>
            </div>
            <div class="constraint-row">
              <label>Max Impulse Class</label>
              <select id="opt-impulse">
                <option value="D">D (10-20 Ns)</option>
                <option value="E">E (20-40 Ns)</option>
                <option value="F">F (40-80 Ns)</option>
                <option value="G" selected>G (80-160 Ns)</option>
                <option value="H">H (160-320 Ns)</option>
                <option value="I">I (320-640 Ns)</option>
                <option value="J">J (640-1280 Ns)</option>
              </select>
            </div>
          </div>
          
          <button class="btn btn-primary" id="btn-optimize">
            🔍 Find Optimal Motors
          </button>
        </div>
        
        <div class="optimizer-results" id="opt-results">
          <p class="placeholder">Configure settings and click "Find Optimal Motors"</p>
        </div>
      </div>
    `;
  }
  
  setupEventListeners() {
    const optimizeBtn = this.container.querySelector('#btn-optimize');
    optimizeBtn?.addEventListener('click', () => this.runOptimization());
    
    const modeSelect = this.container.querySelector('#opt-mode');
    modeSelect?.addEventListener('change', (e) => {
      const altInput = this.container.querySelector('#altitude-input');
      if (e.target.value === 'tarc') {
        altInput.style.display = 'none';
      } else {
        altInput.style.display = 'block';
      }
    });
  }
  
  async runOptimization() {
    if (!this.optimizer) {
      log.error('Optimizer not initialized');
      return;
    }
    
    const mode = this.container.querySelector('#opt-mode').value;
    const altitude = parseFloat(this.container.querySelector('#opt-altitude').value);
    const units = this.container.querySelector('#opt-units').value;
    const maxDiameter = parseFloat(this.container.querySelector('#opt-diameter').value);
    const maxImpulse = this.container.querySelector('#opt-impulse').value;
    
    const resultsEl = this.container.querySelector('#opt-results');
    resultsEl.innerHTML = '<p class="loading">Analyzing motors...</p>';
    
    try {
      let results;
      
      if (mode === 'tarc') {
        results = await this.optimizer.optimizeForTARC({
          maxImpulseClass: maxImpulse,
          constraints: { maxDiameter }
        });
      } else if (mode === 'minDrift') {
        results = await this.optimizer.optimizeForMinimumDrift(altitude, {
          units,
          constraints: { maxDiameter, maxImpulseClass: maxImpulse }
        });
      } else {
        results = await this.optimizer.optimizeForAltitude(altitude, {
          units,
          constraints: { maxDiameter, maxImpulseClass: maxImpulse }
        });
      }
      
      this.renderResults(results);
      this.onResult(results);
      
    } catch (error) {
      log.error('Optimization failed:', error);
      resultsEl.innerHTML = `<p class="error">Optimization failed: ${error.message}</p>`;
    }
  }
  
  renderResults(results) {
    const resultsEl = this.container.querySelector('#opt-results');
    
    if (!results.success) {
      resultsEl.innerHTML = `<p class="error">${results.error}</p>`;
      return;
    }
    
    const recs = results.recommendations;
    
    if (recs.length === 0) {
      resultsEl.innerHTML = '<p class="error">No suitable motors found</p>';
      return;
    }
    
    const isTARC = results.mode === 'TARC';
    
    resultsEl.innerHTML = `
      <div class="results-header">
        <h4>Top ${recs.length} Recommendations</h4>
        <p>Target: ${isTARC ? '825 ft, 41-44s' : results.target.altitude + ' ' + (results.target.units || 'meters')}</p>
      </div>
      
      <div class="results-list">
        ${recs.map((r, i) => `
          <div class="result-card ${i === 0 ? 'best-match' : ''}">
            <div class="result-rank">#${i + 1}</div>
            <div class="result-motor">
              <span class="motor-name">${r.motor.manufacturer || ''} ${r.motor.designation}</span>
              <span class="motor-specs">${r.motor.diameter}mm | ${r.motor.totalImpulse?.toFixed(1) || '?'} Ns</span>
            </div>
            <div class="result-prediction">
              <span class="pred-apogee">${r.prediction.apogeeFeet.toFixed(0)} ft</span>
              <span class="pred-delay">Delay: ${r.delay.recommended}s</span>
            </div>
            <div class="result-score">
              ${isTARC 
                ? `<span class="tarc-score">TARC: ${r.tarcScoring.tarcScore.toFixed(1)}</span>`
                : `<span class="accuracy">${r.accuracy.errorPercent >= 0 ? '+' : ''}${r.accuracy.errorPercent.toFixed(1)}%</span>`
              }
            </div>
          </div>
        `).join('')}
      </div>
      
      ${results.bestMatch ? `
        <div class="best-match-summary">
          <h4>✅ Best Match: ${results.bestMatch.motor.manufacturer || ''} ${results.bestMatch.motor.designation}</h4>
          <ul>
            <li>Predicted Apogee: ${results.bestMatch.prediction.apogeeFeet.toFixed(0)} ft (${results.bestMatch.prediction.apogee.toFixed(1)} m)</li>
            <li>Recommended Delay: ${results.bestMatch.delay.recommended} seconds</li>
            <li>Thrust-to-Weight: ${results.bestMatch.prediction.thrustToWeight?.toFixed(1) || '?'}:1</li>
            ${isTARC ? `<li>Flight Time: ~${results.bestMatch.prediction.flightTime?.toFixed(1) || '?'} seconds</li>` : ''}
          </ul>
        </div>
      ` : ''}
    `;
  }
}

// ============================================
// Exports
// ============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FlightOptimizer,
    MotorFilter,
    QuickSim,
    OptimizerUI,
    IMPULSE_CLASSES,
    STANDARD_DELAYS
  };
}

if (typeof window !== 'undefined') {
  window.FlightOptimizer = FlightOptimizer;
  window.MotorFilter = MotorFilter;
  window.QuickSim = QuickSim;
  window.OptimizerUI = OptimizerUI;
}

export { 
  FlightOptimizer, 
  MotorFilter, 
  QuickSim, 
  OptimizerUI,
  IMPULSE_CLASSES,
  STANDARD_DELAYS
};

/**
 * LAUNCHSIM Dual Deploy Recovery Simulation
 * ==========================================
 * 
 * Simulates dual deployment recovery systems used in high-power rocketry.
 * Models drogue deployment at apogee and main deployment at a set altitude.
 * 
 * Features:
 * - Drogue descent phase modeling
 * - Main parachute deployment at configurable altitude
 * - Descent rate calculations for each phase
 * - Drift prediction accounting for wind at different altitudes
 * - Landing velocity and kinetic energy
 * - Deployment event timeline
 * - Altimeter configuration recommendations
 * 
 * Usage:
 *   const recovery = new DualDeploySimulation(rocket, config);
 *   const result = recovery.simulate(apogee, wind);
 */

// Debug mode
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[DualDeploy]', ...args),
  warn: (...args) => console.warn('[DualDeploy]', ...args),
  error: (...args) => console.error('[DualDeploy]', ...args)
};

// ============================================
// Constants
// ============================================

const GRAVITY = 9.81;           // m/s²
const AIR_DENSITY_SEA_LEVEL = 1.225;  // kg/m³
const MM_TO_M = 0.001;
const M_TO_FT = 3.28084;
const FT_TO_M = 0.3048;
const MPS_TO_FPS = 3.28084;
const MPH_TO_MPS = 0.44704;

// Standard deployment altitudes
const STANDARD_MAIN_ALTITUDES = [300, 400, 500, 600, 700, 800, 1000]; // feet
const DEFAULT_MAIN_ALTITUDE_FT = 500;

// Parachute drag coefficients
const PARACHUTE_CD = {
  'round': 0.75,
  'cruciform': 0.60,
  'elliptical': 0.85,
  'toroidal': 0.90,
  'hemisphere': 0.62,
  'parasheet': 0.70,
  'streamer': 0.40
};

// ============================================
// Parachute Model
// ============================================

class Parachute {
  /**
   * Create a parachute model
   * 
   * @param {Object} config
   * @param {number} config.diameter - Diameter in mm
   * @param {string} [config.type='round'] - Parachute type
   * @param {number} [config.cd] - Custom drag coefficient
   * @param {number} [config.spillHoleDiameter=0] - Spill hole diameter in mm
   */
  constructor(config) {
    this.diameter = config.diameter * MM_TO_M; // Convert to meters
    this.type = config.type || 'round';
    this.cd = config.cd || PARACHUTE_CD[this.type] || 0.75;
    this.spillHoleDiameter = (config.spillHoleDiameter || 0) * MM_TO_M;
    
    // Calculate effective area (accounting for spill hole)
    const totalArea = Math.PI * Math.pow(this.diameter / 2, 2);
    const spillArea = Math.PI * Math.pow(this.spillHoleDiameter / 2, 2);
    this.area = totalArea - spillArea;
  }
  
  /**
   * Calculate drag force at given velocity
   * F_drag = 0.5 * ρ * v² * Cd * A
   */
  dragForce(velocity, airDensity = AIR_DENSITY_SEA_LEVEL) {
    return 0.5 * airDensity * velocity * velocity * this.cd * this.area;
  }
  
  /**
   * Calculate terminal velocity for given mass
   * v_terminal = sqrt(2 * m * g / (ρ * Cd * A))
   */
  terminalVelocity(mass, airDensity = AIR_DENSITY_SEA_LEVEL) {
    return Math.sqrt((2 * mass * GRAVITY) / (airDensity * this.cd * this.area));
  }
  
  /**
   * Get descent rate in ft/s
   */
  descentRateFps(mass, airDensity = AIR_DENSITY_SEA_LEVEL) {
    return this.terminalVelocity(mass, airDensity) * MPS_TO_FPS;
  }
}

// ============================================
// Drogue Parachute (small stabilizing chute)
// ============================================

class DrogueParachute extends Parachute {
  constructor(config) {
    super({
      ...config,
      type: config.type || 'cruciform' // Drogues often cruciform
    });
    
    // Drogues typically have higher descent rates
    this.targetDescentRate = config.targetDescentRate || 75; // ft/s typical
  }
  
  /**
   * Calculate recommended drogue size for target descent rate
   * 
   * @param {number} mass - Rocket mass in grams
   * @param {number} targetRate - Target descent rate in ft/s
   * @returns {number} Recommended diameter in mm
   */
  static recommendedSize(mass, targetRate = 75) {
    const massKg = mass / 1000;
    const velocityMps = targetRate * FT_TO_M;
    const cd = PARACHUTE_CD['cruciform'];
    
    // Solve for area: A = 2 * m * g / (ρ * Cd * v²)
    const area = (2 * massKg * GRAVITY) / (AIR_DENSITY_SEA_LEVEL * cd * velocityMps * velocityMps);
    const diameter = 2 * Math.sqrt(area / Math.PI);
    
    return diameter / MM_TO_M; // Return in mm
  }
}

// ============================================
// Main Parachute
// ============================================

class MainParachute extends Parachute {
  constructor(config) {
    super({
      ...config,
      type: config.type || 'round'
    });
    
    this.deploymentAltitude = config.deploymentAltitude || DEFAULT_MAIN_ALTITUDE_FT;
  }
  
  /**
   * Calculate recommended main size for target landing velocity
   * 
   * @param {number} mass - Rocket mass in grams
   * @param {number} targetLandingVelocity - Target in ft/s (typically 15-20)
   * @returns {number} Recommended diameter in mm
   */
  static recommendedSize(mass, targetLandingVelocity = 15) {
    const massKg = mass / 1000;
    const velocityMps = targetLandingVelocity * FT_TO_M;
    const cd = PARACHUTE_CD['round'];
    
    const area = (2 * massKg * GRAVITY) / (AIR_DENSITY_SEA_LEVEL * cd * velocityMps * velocityMps);
    const diameter = 2 * Math.sqrt(area / Math.PI);
    
    return diameter / MM_TO_M;
  }
}

// ============================================
// Recovery Configuration
// ============================================

class RecoveryConfig {
  /**
   * Create recovery system configuration
   * 
   * @param {Object} config
   */
  constructor(config = {}) {
    // Drogue configuration
    this.drogue = config.drogue ? new DrogueParachute(config.drogue) : null;
    
    // Main parachute
    this.main = config.main ? new MainParachute(config.main) : null;
    
    // Single deploy fallback
    if (!this.drogue && !this.main && config.chuteDiameter) {
      this.main = new MainParachute({
        diameter: config.chuteDiameter,
        type: 'round',
        cd: config.chuteCd || 0.75,
        deploymentAltitude: 0 // Apogee deployment
      });
    }
    
    // Deployment settings
    this.mainDeployAltitude = config.mainDeployAltitude || DEFAULT_MAIN_ALTITUDE_FT;
    this.drogueDelay = config.drogueDelay || 0; // Seconds after apogee
    
    // Safety settings
    this.backupMainAltitude = config.backupMainAltitude || 300; // Backup deploy
  }
  
  /**
   * Check if dual deploy is configured
   */
  get isDualDeploy() {
    return this.drogue !== null && this.main !== null;
  }
  
  /**
   * Create from rocket configuration
   */
  static fromRocket(rocket) {
    if (rocket.drogueChute && rocket.mainChute) {
      return new RecoveryConfig({
        drogue: {
          diameter: rocket.drogueChute.diameter || rocket.drogueDiameter,
          type: rocket.drogueChute.type || 'cruciform',
          cd: rocket.drogueChute.cd
        },
        main: {
          diameter: rocket.mainChute.diameter || rocket.mainDiameter || rocket.chuteDiameter,
          type: rocket.mainChute.type || 'round',
          cd: rocket.mainChute.cd || rocket.chuteCd,
          deploymentAltitude: rocket.mainDeployAltitude || DEFAULT_MAIN_ALTITUDE_FT
        },
        mainDeployAltitude: rocket.mainDeployAltitude || DEFAULT_MAIN_ALTITUDE_FT
      });
    }
    
    // Single deploy fallback
    return new RecoveryConfig({
      chuteDiameter: rocket.chuteDiameter || 450,
      chuteCd: rocket.chuteCd || 0.75
    });
  }
}

// ============================================
// Wind Profile Model
// ============================================

class WindProfile {
  /**
   * Create wind profile for descent simulation
   * 
   * @param {Object} config
   * @param {number} config.groundSpeed - Surface wind speed (m/s)
   * @param {number} config.groundDirection - Surface wind direction (degrees from north)
   * @param {number} [config.gustFactor=1.3] - Gust factor multiplier
   */
  constructor(config = {}) {
    this.groundSpeed = config.groundSpeed || 0;
    this.groundDirection = config.groundDirection || 0;
    this.gustFactor = config.gustFactor || 1.3;
  }
  
  /**
   * Get wind speed at altitude using power law profile
   * Wind typically increases with altitude
   * 
   * @param {number} altitude - Altitude in feet
   * @returns {number} Wind speed in m/s
   */
  speedAtAltitude(altitude) {
    if (altitude <= 0) return this.groundSpeed;
    
    // Power law: v(z) = v_ref * (z/z_ref)^α
    // α ≈ 0.143 for open terrain
    const alpha = 0.143;
    const refHeight = 10; // 10m reference height
    const heightM = altitude * FT_TO_M;
    
    return this.groundSpeed * Math.pow(heightM / refHeight, alpha);
  }
  
  /**
   * Get wind direction at altitude
   * Wind direction typically veers (clockwise) with altitude
   */
  directionAtAltitude(altitude) {
    // Ekman spiral: ~15-20° rotation per 1000m
    const rotationRate = 15; // degrees per 1000m
    const heightM = altitude * FT_TO_M;
    const rotation = (heightM / 1000) * rotationRate;
    
    return (this.groundDirection + rotation) % 360;
  }
  
  /**
   * Get wind vector components at altitude
   * @returns {Object} { east, north } in m/s
   */
  vectorAtAltitude(altitude) {
    const speed = this.speedAtAltitude(altitude);
    const direction = this.directionAtAltitude(altitude);
    const dirRad = direction * Math.PI / 180;
    
    return {
      east: speed * Math.sin(dirRad),
      north: speed * Math.cos(dirRad)
    };
  }
  
  /**
   * Create from weather data
   */
  static fromWeather(weather) {
    return new WindProfile({
      groundSpeed: weather.windSpeed || 0,
      groundDirection: weather.windDirection || 0,
      gustFactor: weather.gustSpeed ? weather.gustSpeed / weather.windSpeed : 1.3
    });
  }
}

// ============================================
// Dual Deploy Simulation Engine
// ============================================

class DualDeploySimulation {
  /**
   * Create dual deploy simulation
   * 
   * @param {Object} rocket - Rocket configuration
   * @param {RecoveryConfig|Object} recovery - Recovery configuration
   */
  constructor(rocket, recovery = null) {
    this.rocket = rocket;
    this.recovery = recovery instanceof RecoveryConfig 
      ? recovery 
      : RecoveryConfig.fromRocket(recovery || rocket);
    
    // Calculate mass
    this.massGrams = rocket.dryMass || rocket.totalMass || 500;
    if (rocket.motor) {
      // After burnout, motor is mostly empty
      this.massGrams += (rocket.motor.totalMass || 0) - (rocket.motor.propMass || 0);
    }
    this.massKg = this.massGrams / 1000;
  }
  
  /**
   * Run full descent simulation
   * 
   * @param {number} apogee - Apogee altitude in feet
   * @param {WindProfile|Object} wind - Wind configuration
   * @param {Object} [options] - Simulation options
   * @returns {Object} Simulation results
   */
  simulate(apogee, wind = null, options = {}) {
    const windProfile = wind instanceof WindProfile 
      ? wind 
      : new WindProfile(wind || {});
    
    const timeStep = options.timeStep || 0.1; // seconds
    const maxTime = options.maxTime || 600; // 10 minutes max
    
    const results = {
      apogee,
      apogeeFeet: apogee,
      apogeeMeters: apogee * FT_TO_M,
      recovery: this.recovery,
      isDualDeploy: this.recovery.isDualDeploy,
      phases: [],
      events: [],
      trajectory: [],
      totals: {}
    };
    
    let altitude = apogee;
    let time = 0;
    let velocity = 0;
    let driftEast = 0;
    let driftNorth = 0;
    
    // Event: Apogee
    results.events.push({
      type: 'APOGEE',
      time: 0,
      altitude: apogee,
      description: 'Rocket reaches apogee'
    });
    
    // Phase 1: Drogue descent (or freefall if no drogue)
    if (this.recovery.isDualDeploy) {
      // Drogue deployment
      const drogueDelay = this.recovery.drogueDelay || 0;
      
      if (drogueDelay > 0) {
        results.events.push({
          type: 'DROGUE_DELAY',
          time: 0,
          altitude: apogee,
          description: `Drogue delay: ${drogueDelay}s`
        });
      }
      
      results.events.push({
        type: 'DROGUE_DEPLOY',
        time: drogueDelay,
        altitude: apogee, // Simplified - actually slightly lower
        description: 'Drogue parachute deploys'
      });
      
      // Simulate drogue descent
      const droguePhase = this.simulatePhase(
        altitude,
        this.recovery.mainDeployAltitude,
        this.recovery.drogue,
        windProfile,
        timeStep
      );
      
      results.phases.push({
        name: 'Drogue Descent',
        startAltitude: altitude,
        endAltitude: this.recovery.mainDeployAltitude,
        duration: droguePhase.duration,
        descentRate: droguePhase.avgDescentRate,
        driftDistance: droguePhase.totalDrift,
        driftDirection: droguePhase.driftDirection,
        trajectory: droguePhase.trajectory
      });
      
      altitude = this.recovery.mainDeployAltitude;
      time += droguePhase.duration;
      driftEast += droguePhase.driftEast;
      driftNorth += droguePhase.driftNorth;
      results.trajectory.push(...droguePhase.trajectory);
      
      // Main deployment
      results.events.push({
        type: 'MAIN_DEPLOY',
        time: time,
        altitude: altitude,
        description: `Main parachute deploys at ${altitude} ft`
      });
    } else {
      // Single deploy at apogee
      results.events.push({
        type: 'MAIN_DEPLOY',
        time: 0,
        altitude: apogee,
        description: 'Main parachute deploys at apogee'
      });
    }
    
    // Phase 2: Main descent
    const mainPhase = this.simulatePhase(
      altitude,
      0,
      this.recovery.main,
      windProfile,
      timeStep
    );
    
    results.phases.push({
      name: 'Main Descent',
      startAltitude: altitude,
      endAltitude: 0,
      duration: mainPhase.duration,
      descentRate: mainPhase.avgDescentRate,
      driftDistance: mainPhase.totalDrift,
      driftDirection: mainPhase.driftDirection,
      trajectory: mainPhase.trajectory
    });
    
    time += mainPhase.duration;
    driftEast += mainPhase.driftEast;
    driftNorth += mainPhase.driftNorth;
    results.trajectory.push(...mainPhase.trajectory);
    
    // Landing event
    results.events.push({
      type: 'LANDING',
      time: time,
      altitude: 0,
      description: 'Rocket lands'
    });
    
    // Calculate totals
    const totalDrift = Math.sqrt(driftEast * driftEast + driftNorth * driftNorth);
    const driftDirection = Math.atan2(driftEast, driftNorth) * 180 / Math.PI;
    
    results.totals = {
      flightTime: time,
      totalDescentTime: time,  // Alias for compatibility
      flightTimeFormatted: this.formatTime(time),
      totalDriftMeters: totalDrift,
      totalDriftFeet: totalDrift * M_TO_FT,
      driftDirection: (driftDirection + 360) % 360,
      driftDirectionCardinal: this.degreesToCardinal(driftDirection),
      driftEast,
      driftNorth,
      landingVelocityMps: mainPhase.finalVelocity,
      landingVelocityFps: mainPhase.finalVelocity * MPS_TO_FPS,
      kineticEnergyJoules: 0.5 * this.massKg * mainPhase.finalVelocity * mainPhase.finalVelocity
    };
    
    // Safety assessment
    results.safety = this.assessSafety(results);
    
    return results;
  }
  
  /**
   * Simulate a single descent phase
   */
  simulatePhase(startAltitude, endAltitude, parachute, windProfile, timeStep) {
    const trajectory = [];
    let altitude = startAltitude;
    let velocity = 0;
    let time = 0;
    let driftEast = 0;
    let driftNorth = 0;
    
    while (altitude > endAltitude && time < 600) {
      // Get air density at altitude (simplified)
      const altitudeM = altitude * FT_TO_M;
      const airDensity = AIR_DENSITY_SEA_LEVEL * Math.exp(-altitudeM / 8500);
      
      // Calculate terminal velocity
      const terminalVelocity = parachute.terminalVelocity(this.massKg, airDensity);
      
      // Approach terminal velocity (simplified)
      velocity = velocity + (terminalVelocity - velocity) * 0.3;
      
      // Update altitude
      const altitudeChange = velocity * timeStep;
      altitude -= altitudeChange * M_TO_FT;
      
      // Calculate drift
      const wind = windProfile.vectorAtAltitude(altitude);
      driftEast += wind.east * timeStep;
      driftNorth += wind.north * timeStep;
      
      // Record trajectory point
      if (Math.floor(time) !== Math.floor(time - timeStep)) {
        trajectory.push({
          time: time,
          altitude: Math.max(0, altitude),
          altitudeMeters: Math.max(0, altitude) * FT_TO_M,
          velocity: velocity,
          velocityFps: velocity * MPS_TO_FPS,
          driftEast,
          driftNorth,
          driftTotal: Math.sqrt(driftEast * driftEast + driftNorth * driftNorth)
        });
      }
      
      time += timeStep;
    }
    
    const totalDrift = Math.sqrt(driftEast * driftEast + driftNorth * driftNorth);
    
    return {
      duration: time,
      finalVelocity: velocity,
      avgDescentRate: (startAltitude - endAltitude) / time * FT_TO_M,
      totalDrift,
      driftEast,
      driftNorth,
      driftDirection: Math.atan2(driftEast, driftNorth) * 180 / Math.PI,
      trajectory
    };
  }
  
  /**
   * Assess safety of recovery configuration
   */
  assessSafety(results) {
    const issues = [];
    const warnings = [];
    const status = { safe: true, level: 'safe' };
    
    // Check landing velocity
    const landingFps = results.totals.landingVelocityFps;
    if (landingFps > 25) {
      issues.push(`Landing velocity ${landingFps.toFixed(1)} ft/s exceeds safe limit (25 ft/s). Rocket may be damaged.`);
      status.safe = false;
      status.level = 'danger';
    } else if (landingFps > 20) {
      warnings.push(`Landing velocity ${landingFps.toFixed(1)} ft/s is borderline. Consider larger main chute.`);
      status.level = 'warning';
    }
    
    // Check kinetic energy (NAR/TRA limits)
    const ke = results.totals.kineticEnergyJoules;
    if (ke > 75) {
      issues.push(`Kinetic energy ${ke.toFixed(1)} J exceeds NAR limit (75 J). Use larger main parachute.`);
      status.safe = false;
      status.level = 'danger';
    }
    
    // Check drogue descent rate (if dual deploy)
    if (results.isDualDeploy && results.phases.length > 1) {
      const drogueRate = results.phases[0].descentRate * MPS_TO_FPS;
      if (drogueRate > 100) {
        warnings.push(`Drogue descent rate ${drogueRate.toFixed(0)} ft/s is very fast. Consider larger drogue.`);
      } else if (drogueRate < 40) {
        warnings.push(`Drogue descent rate ${drogueRate.toFixed(0)} ft/s is slow. Increased drift during drogue phase.`);
      }
    }
    
    // Check main deployment altitude
    if (this.recovery.isDualDeploy) {
      if (this.recovery.mainDeployAltitude < 300) {
        issues.push('Main deployment altitude below 300 ft may not allow full inflation.');
        status.safe = false;
        status.level = 'danger';
      } else if (this.recovery.mainDeployAltitude < 400) {
        warnings.push('Main deployment altitude is low. Consider 500+ ft for safety margin.');
      }
    }
    
    return {
      ...status,
      issues,
      warnings,
      recommendations: this.generateRecommendations(results)
    };
  }
  
  /**
   * Generate recommendations
   */
  generateRecommendations(results) {
    const recs = [];
    
    // Main chute sizing
    const targetLanding = 15; // ft/s
    const recommendedMain = MainParachute.recommendedSize(this.massGrams, targetLanding);
    const currentMain = this.recovery.main ? this.recovery.main.diameter / MM_TO_M : 0;
    
    if (currentMain < recommendedMain * 0.9) {
      recs.push({
        type: 'MAIN_SIZE',
        message: `Consider ${Math.round(recommendedMain)}mm main chute for 15 ft/s landing`,
        current: Math.round(currentMain),
        recommended: Math.round(recommendedMain)
      });
    }
    
    // Drogue sizing
    if (this.recovery.isDualDeploy) {
      const targetDrogueRate = 75;
      const recommendedDrogue = DrogueParachute.recommendedSize(this.massGrams, targetDrogueRate);
      const currentDrogue = this.recovery.drogue.diameter / MM_TO_M;
      
      if (Math.abs(currentDrogue - recommendedDrogue) > recommendedDrogue * 0.2) {
        recs.push({
          type: 'DROGUE_SIZE',
          message: `Consider ${Math.round(recommendedDrogue)}mm drogue for 75 ft/s descent`,
          current: Math.round(currentDrogue),
          recommended: Math.round(recommendedDrogue)
        });
      }
    }
    
    return recs;
  }
  
  /**
   * Calculate recommended altimeter settings
   */
  getAltimeterSettings() {
    if (!this.recovery.isDualDeploy) {
      return {
        type: 'SINGLE_DEPLOY',
        primaryEvent: 'APOGEE',
        primaryDelay: 0,
        message: 'Single deploy at apogee'
      };
    }
    
    return {
      type: 'DUAL_DEPLOY',
      droguePrimaryEvent: 'APOGEE',
      drogueDelay: this.recovery.drogueDelay || 0,
      mainPrimaryEvent: 'ALTITUDE',
      mainAltitude: this.recovery.mainDeployAltitude,
      backupMainAltitude: this.recovery.backupMainAltitude || 300,
      message: `Drogue at apogee, main at ${this.recovery.mainDeployAltitude} ft`
    };
  }
  
  /**
   * Format time as MM:SS
   */
  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  
  /**
   * Convert degrees to cardinal direction
   */
  degreesToCardinal(degrees) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(((degrees + 360) % 360) / 22.5) % 16;
    return dirs[index];
  }
}

// ============================================
// Recovery Planner (Optimization)
// ============================================

class RecoveryPlanner {
  /**
   * Plan optimal recovery configuration
   * 
   * @param {Object} rocket - Rocket configuration
   * @param {number} expectedApogee - Expected apogee in feet
   * @param {Object} constraints - Planning constraints
   */
  static plan(rocket, expectedApogee, constraints = {}) {
    const massGrams = rocket.dryMass || rocket.totalMass || 500;
    
    // Target descent rates
    const targetDrogueRate = constraints.targetDrogueRate || 75; // ft/s
    const targetLandingVelocity = constraints.targetLandingVelocity || 15; // ft/s
    
    // Calculate sizes
    const drogueSize = DrogueParachute.recommendedSize(massGrams, targetDrogueRate);
    const mainSize = MainParachute.recommendedSize(massGrams, targetLandingVelocity);
    
    // Determine if dual deploy is needed
    const needsDualDeploy = expectedApogee > 1000; // Generally above 1000 ft
    
    // Main deployment altitude
    let mainDeployAltitude = 500; // Default
    if (expectedApogee > 3000) {
      mainDeployAltitude = 700;
    } else if (expectedApogee > 5000) {
      mainDeployAltitude = 800;
    }
    
    // Override with constraints
    if (constraints.mainDeployAltitude) {
      mainDeployAltitude = constraints.mainDeployAltitude;
    }
    
    return {
      recommendDualDeploy: needsDualDeploy,
      drogue: needsDualDeploy ? {
        diameter: Math.round(drogueSize),
        type: 'cruciform',
        expectedDescentRate: targetDrogueRate
      } : null,
      main: {
        diameter: Math.round(mainSize),
        type: 'round',
        expectedLandingVelocity: targetLandingVelocity
      },
      mainDeployAltitude,
      estimatedDriftAtApogee: this.estimateDrift(expectedApogee, targetDrogueRate, mainDeployAltitude, targetLandingVelocity),
      notes: this.generateNotes(needsDualDeploy, expectedApogee, massGrams)
    };
  }
  
  /**
   * Estimate total drift
   */
  static estimateDrift(apogee, drogueRate, mainAlt, landingVelocity) {
    // Very rough estimate assuming 10 mph average wind
    const avgWindMps = 10 * MPH_TO_MPS;
    
    // Time under drogue
    const drogueTime = (apogee - mainAlt) / (drogueRate * FT_TO_M);
    const drogueDrift = drogueTime * avgWindMps;
    
    // Time under main
    const mainTime = mainAlt / (landingVelocity * FT_TO_M);
    const mainDrift = mainTime * avgWindMps;
    
    return {
      drogueDriftMeters: drogueDrift,
      mainDriftMeters: mainDrift,
      totalDriftMeters: drogueDrift + mainDrift,
      totalDriftFeet: (drogueDrift + mainDrift) * M_TO_FT
    };
  }
  
  /**
   * Generate planning notes
   */
  static generateNotes(needsDualDeploy, apogee, mass) {
    const notes = [];
    
    if (needsDualDeploy) {
      notes.push('Dual deploy recommended for flights above 1000 ft');
      notes.push('Use redundant altimeters for HPR flights');
    } else {
      notes.push('Single deploy at apogee is sufficient for this altitude');
    }
    
    if (mass > 1000) {
      notes.push('Heavy rocket - verify parachute is rated for this weight');
    }
    
    if (apogee > 3000) {
      notes.push('Consider motor ejection as backup');
    }
    
    return notes;
  }
}

// ============================================
// Exports
// ============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DualDeploySimulation,
    RecoveryConfig,
    RecoveryPlanner,
    Parachute,
    DrogueParachute,
    MainParachute,
    WindProfile,
    PARACHUTE_CD,
    STANDARD_MAIN_ALTITUDES
  };
}

if (typeof window !== 'undefined') {
  window.DualDeploySimulation = DualDeploySimulation;
  window.RecoveryConfig = RecoveryConfig;
  window.RecoveryPlanner = RecoveryPlanner;
  window.Parachute = Parachute;
  window.DrogueParachute = DrogueParachute;
  window.MainParachute = MainParachute;
  window.WindProfile = WindProfile;
  window.PARACHUTE_CD = PARACHUTE_CD;
}

export {
  DualDeploySimulation,
  RecoveryConfig,
  RecoveryPlanner,
  Parachute,
  DrogueParachute,
  MainParachute,
  WindProfile,
  PARACHUTE_CD,
  STANDARD_MAIN_ALTITUDES
};

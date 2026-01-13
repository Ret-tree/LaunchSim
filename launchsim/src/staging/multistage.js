/**
 * LAUNCHSIM Multi-Stage Rockets
 * ==============================
 * 
 * Complete multi-stage rocket simulation including:
 * - Stage definition and configuration
 * - Staging events (burnout, timer, altitude, command)
 * - Stage separation physics
 * - Mass and CG tracking across stages
 * - Independent aerodynamics per stage
 * - Booster/sustainer/upper stage configurations
 * - Parallel staging (strap-on boosters)
 * 
 * Supports configurations:
 * - 2-stage: Booster + Sustainer
 * - 3-stage: Booster + Sustainer + Upper
 * - Parallel: Core + Strap-on Boosters
 * - Air-start: Delayed ignition upper stages
 * 
 * Usage:
 *   const multistage = new MultiStageRocket();
 *   multistage.addStage(boosterConfig);
 *   multistage.addStage(sustainerConfig);
 *   const results = multistage.simulate();
 */

// ============================================
// Constants
// ============================================

const G0 = 9.80665;
const RHO0 = 1.225;

const STAGE_TYPES = {
  BOOSTER: 'booster',       // First stage, dropped after burnout
  SUSTAINER: 'sustainer',   // Main stage, continues to apogee
  UPPER: 'upper',           // Upper stage for high altitude
  STRAPON: 'strapon'        // Parallel strap-on booster
};

const SEPARATION_TRIGGERS = {
  BURNOUT: 'burnout',       // Separate when motor burns out
  TIMER: 'timer',           // Separate after delay
  ALTITUDE: 'altitude',     // Separate at specific altitude
  VELOCITY: 'velocity',     // Separate at specific velocity
  COMMAND: 'command'        // Manual/electronic command
};

const IGNITION_TRIGGERS = {
  LIFTOFF: 'liftoff',       // Ignite at launch (parallel)
  SEPARATION: 'separation', // Ignite on separation
  DELAY: 'delay',           // Ignite after delay from separation
  ALTITUDE: 'altitude',     // Ignite at altitude (air-start)
  APOGEE: 'apogee'          // Ignite at apogee (kick stage)
};

// ============================================
// Stage Class
// ============================================

class Stage {
  /**
   * Create a stage configuration
   * 
   * @param {Object} config - Stage configuration
   */
  constructor(config = {}) {
    // Identity
    this.id = config.id || `stage_${Date.now()}`;
    this.name = config.name || 'Stage';
    this.type = config.type || STAGE_TYPES.SUSTAINER;
    this.stageNumber = config.stageNumber || 1;
    
    // Geometry
    this.length = config.length || 0.5;           // m
    this.bodyDiameter = config.bodyDiameter || 0.1; // m
    this.bodyRadius = this.bodyDiameter / 2;
    
    // Nose cone (only for uppermost stage)
    this.hasNoseCone = config.hasNoseCone || false;
    this.noseLength = config.noseLength || 0.15;
    this.noseShape = config.noseShape || 'ogive';
    
    // Fins (typically on booster)
    this.hasFins = config.hasFins !== false;
    this.finCount = config.finCount || 4;
    this.finRootChord = config.finRootChord || 0.08;
    this.finTipChord = config.finTipChord || 0.04;
    this.finSpan = config.finSpan || 0.06;
    this.finSweep = config.finSweep || 0.02;
    this.finThickness = config.finThickness || 0.003;
    
    // Mass
    this.dryMass = config.dryMass || 0.5;         // kg
    this.structuralMass = config.structuralMass || this.dryMass * 0.3; // kg (casing, interstage)
    
    // Motor
    this.motor = config.motor || null;
    this.motorMass = config.motorMass || 0;       // kg (loaded motor)
    this.propellantMass = config.propellantMass || 0; // kg
    
    // Staging
    this.separationTrigger = config.separationTrigger || SEPARATION_TRIGGERS.BURNOUT;
    this.separationDelay = config.separationDelay || 0; // seconds after trigger
    this.separationAltitude = config.separationAltitude || 0; // m (if altitude trigger)
    this.separationVelocity = config.separationVelocity || 0; // m/s (if velocity trigger)
    
    // Ignition
    this.ignitionTrigger = config.ignitionTrigger || IGNITION_TRIGGERS.LIFTOFF;
    this.ignitionDelay = config.ignitionDelay || 0; // seconds after trigger
    this.ignitionAltitude = config.ignitionAltitude || 0; // m (if altitude trigger)
    
    // Position in stack (from bottom)
    this.stackPosition = config.stackPosition || 0; // m from base of rocket
    
    // Interstage
    this.hasInterstage = config.hasInterstage || false;
    this.interstageLength = config.interstageLength || 0.05; // m
    this.interstageMass = config.interstageMass || 0.02; // kg
    
    // State tracking
    this.active = true;       // Still attached to rocket
    this.ignited = false;     // Motor has fired
    this.burnedOut = false;   // Motor is expended
    this.separated = false;   // Detached from rocket
    this.ignitionTime = null; // When motor ignited
    this.separationTime = null; // When stage separated
    
    // Current propellant (changes during burn)
    this.currentPropellant = this.propellantMass;
  }
  
  /**
   * Get total mass of stage
   */
  getTotalMass() {
    if (this.separated) return 0;
    
    return this.dryMass + 
           this.motorMass - this.propellantMass + this.currentPropellant +
           (this.hasInterstage ? this.interstageMass : 0);
  }
  
  /**
   * Get current thrust
   */
  getThrust(time) {
    if (!this.ignited || this.burnedOut || !this.motor) return 0;
    
    const burnTime = time - this.ignitionTime;
    if (burnTime < 0) return 0;
    
    return this.motor.getThrustAtTime(burnTime);
  }
  
  /**
   * Get mass flow rate
   */
  getMassFlowRate(time) {
    if (!this.ignited || this.burnedOut || !this.motor) return 0;
    
    const burnTime = time - this.ignitionTime;
    if (burnTime < 0) return 0;
    
    return this.motor.getMassFlowRate(burnTime);
  }
  
  /**
   * Update propellant mass
   */
  updatePropellant(dt, time) {
    if (!this.ignited || this.burnedOut) return;
    
    // Calculate burn time (time since ignition)
    const burnTime = time - this.ignitionTime;
    
    // Check if motor burn is complete
    if (this.motor && burnTime >= this.motor.burnTime) {
      this.currentPropellant = 0;
      this.burnedOut = true;
      return;
    }
    
    const flowRate = this.motor ? this.motor.getMassFlowRate(burnTime) : 0;
    this.currentPropellant -= flowRate * dt;
    
    if (this.currentPropellant <= 0) {
      this.currentPropellant = 0;
      this.burnedOut = true;
    }
  }
  
  /**
   * Calculate CG position from stage base
   */
  getCG() {
    // Simplified CG calculation
    const totalMass = this.getTotalMass();
    if (totalMass === 0) return 0;
    
    // Motor at bottom
    const motorCG = 0.2 * this.length;
    const motorMassContrib = (this.motorMass - this.propellantMass + this.currentPropellant);
    
    // Structure distributed
    const structureCG = 0.5 * this.length;
    
    // Propellant shifts CG as it burns (simplified)
    const propCG = 0.15 * this.length;
    
    const cg = (motorCG * motorMassContrib + 
                structureCG * (this.dryMass - this.structuralMass) +
                propCG * this.currentPropellant) / totalMass;
    
    return cg;
  }
  
  /**
   * Calculate CP position from stage base (Barrowman simplified)
   */
  getCP() {
    if (!this.hasFins) {
      // No fins - CP at geometric center
      return this.length * 0.5;
    }
    
    // Barrowman fin CP calculation
    const Cr = this.finRootChord;
    const Ct = this.finTipChord;
    const s = this.finSpan;
    const Xf = this.length - this.finRootChord - 0.02; // Position from base
    
    // MAC (mean aerodynamic chord)
    const MAC = (2/3) * Cr * (1 + Ct/(Cr + 0.001) + (Ct/(Cr + 0.001))**2) / (1 + Ct/(Cr + 0.001));
    
    // CP of fins from fin leading edge
    const Xcp_fins = Xf + (1/6) * (Cr + Ct - Cr*Ct/(Cr + Ct + 0.001));
    
    return Xcp_fins;
  }
  
  /**
   * Get aerodynamic reference area
   */
  getReferenceArea() {
    return Math.PI * this.bodyRadius * this.bodyRadius;
  }
  
  /**
   * Clone stage
   */
  clone() {
    const s = new Stage({
      id: this.id,
      name: this.name,
      type: this.type,
      stageNumber: this.stageNumber,
      length: this.length,
      bodyDiameter: this.bodyDiameter,
      hasNoseCone: this.hasNoseCone,
      noseLength: this.noseLength,
      noseShape: this.noseShape,
      hasFins: this.hasFins,
      finCount: this.finCount,
      finRootChord: this.finRootChord,
      finTipChord: this.finTipChord,
      finSpan: this.finSpan,
      finSweep: this.finSweep,
      finThickness: this.finThickness,
      dryMass: this.dryMass,
      structuralMass: this.structuralMass,
      motor: this.motor,
      motorMass: this.motorMass,
      propellantMass: this.propellantMass,
      separationTrigger: this.separationTrigger,
      separationDelay: this.separationDelay,
      ignitionTrigger: this.ignitionTrigger,
      ignitionDelay: this.ignitionDelay,
      stackPosition: this.stackPosition
    });
    
    s.active = this.active;
    s.ignited = this.ignited;
    s.burnedOut = this.burnedOut;
    s.separated = this.separated;
    s.currentPropellant = this.currentPropellant;
    s.ignitionTime = this.ignitionTime;
    s.separationTime = this.separationTime;
    
    return s;
  }
}

// ============================================
// Simple Motor Model
// ============================================

class StageMotor {
  /**
   * Create a motor for staging simulation
   */
  constructor(config = {}) {
    this.designation = config.designation || 'Motor';
    this.manufacturer = config.manufacturer || '';
    this.totalImpulse = config.totalImpulse || 100; // Ns
    this.averageThrust = config.averageThrust || 50; // N
    this.burnTime = config.burnTime || this.totalImpulse / this.averageThrust;
    this.propellantMass = config.propellantMass || this.totalImpulse / 2000; // kg (estimated)
    this.totalMass = config.totalMass || this.propellantMass * 1.5; // kg
    this.diameter = config.diameter || 29; // mm
    
    // Thrust curve (simplified as array of [time, thrust] pairs)
    this.thrustCurve = config.thrustCurve || this.generateDefaultCurve();
  }
  
  generateDefaultCurve() {
    // Generate a typical regressive curve
    const points = [];
    const dt = this.burnTime / 20;
    
    for (let t = 0; t <= this.burnTime; t += dt) {
      const progress = t / this.burnTime;
      // Typical regressive profile
      let thrust = this.averageThrust * 1.2 * (1 - 0.3 * progress);
      if (progress < 0.1) {
        thrust *= progress / 0.1; // Ramp up
      }
      if (progress > 0.9) {
        thrust *= (1 - progress) / 0.1; // Tail off
      }
      points.push([t, thrust]);
    }
    
    return points;
  }
  
  getThrustAtTime(t) {
    if (t < 0 || t > this.burnTime) return 0;
    
    // Interpolate thrust curve
    for (let i = 0; i < this.thrustCurve.length - 1; i++) {
      const [t1, f1] = this.thrustCurve[i];
      const [t2, f2] = this.thrustCurve[i + 1];
      
      if (t >= t1 && t <= t2) {
        const frac = (t - t1) / (t2 - t1);
        return f1 + frac * (f2 - f1);
      }
    }
    
    return 0;
  }
  
  getMassFlowRate(t) {
    if (t < 0 || t > this.burnTime) return 0;
    return this.propellantMass / this.burnTime;
  }
  
  /**
   * Create motor from ThrustCurve data
   */
  static fromThrustCurveData(data) {
    return new StageMotor({
      designation: data.designation,
      manufacturer: data.manufacturer,
      totalImpulse: data.totalImpulse,
      averageThrust: data.averageThrust,
      burnTime: data.burnTime,
      propellantMass: data.propellantMass,
      totalMass: data.totalMass,
      diameter: data.diameter,
      thrustCurve: data.thrustCurve || data.data
    });
  }
}

// ============================================
// Multi-Stage State
// ============================================

class MultiStageState {
  constructor() {
    // Position (world frame)
    this.x = 0;
    this.y = 0;  // altitude
    this.z = 0;
    
    // Velocity (world frame)
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    
    // Mass
    this.mass = 0;
    this.cg = 0;
    
    // Time
    this.time = 0;
    
    // Phase
    this.phase = 'pre-launch';
    
    // Active stage number
    this.activeStage = 1;
    
    // Events
    this.events = [];
  }
  
  clone() {
    const s = new MultiStageState();
    s.x = this.x;
    s.y = this.y;
    s.z = this.z;
    s.vx = this.vx;
    s.vy = this.vy;
    s.vz = this.vz;
    s.mass = this.mass;
    s.cg = this.cg;
    s.time = this.time;
    s.phase = this.phase;
    s.activeStage = this.activeStage;
    s.events = [...this.events];
    return s;
  }
  
  getAltitude() {
    return this.y;
  }
  
  getVelocity() {
    return Math.sqrt(this.vx * this.vx + this.vy * this.vy + this.vz * this.vz);
  }
}

// ============================================
// Multi-Stage Rocket
// ============================================

class MultiStageRocket {
  /**
   * Create a multi-stage rocket
   */
  constructor(config = {}) {
    this.name = config.name || 'Multi-Stage Rocket';
    this.stages = [];
    this.strapons = []; // Parallel strap-on boosters
    
    // Launch configuration
    this.launchRailLength = config.launchRailLength || 1.5; // m
    this.launchAngle = config.launchAngle || 5; // degrees from vertical
    
    // Environment
    this.baseAltitude = config.baseAltitude || 0; // m
    this.windSpeed = config.windSpeed || 0; // m/s
    this.windDirection = config.windDirection || 0; // degrees
    
    // Simulation parameters
    this.timeStep = config.timeStep || 0.01; // s
    this.maxTime = config.maxTime || 300; // s
    
    // Results
    this.trajectory = [];
    this.stageTrajectories = []; // Track separated stages
    this.events = [];
  }
  
  /**
   * Add a stage to the rocket
   */
  addStage(stageConfig) {
    const stage = stageConfig instanceof Stage ? stageConfig : new Stage(stageConfig);
    stage.stageNumber = this.stages.length + 1;
    
    // Calculate stack position
    if (this.stages.length > 0) {
      const prevStage = this.stages[this.stages.length - 1];
      stage.stackPosition = prevStage.stackPosition + prevStage.length;
    }
    
    this.stages.push(stage);
    return stage;
  }
  
  /**
   * Add strap-on booster
   */
  addStrapon(boosterConfig) {
    const booster = boosterConfig instanceof Stage ? boosterConfig : new Stage(boosterConfig);
    booster.type = STAGE_TYPES.STRAPON;
    booster.ignitionTrigger = IGNITION_TRIGGERS.LIFTOFF;
    this.strapons.push(booster);
    return booster;
  }
  
  /**
   * Get total rocket length
   */
  getTotalLength() {
    if (this.stages.length === 0) return 0;
    
    let length = 0;
    this.stages.forEach(s => {
      if (!s.separated) {
        length += s.length + (s.hasInterstage ? s.interstageLength : 0);
      }
    });
    
    // Add nose cone
    const topStage = this.stages[this.stages.length - 1];
    if (topStage.hasNoseCone) {
      length += topStage.noseLength;
    }
    
    return length;
  }
  
  /**
   * Get total mass of remaining rocket
   */
  getTotalMass() {
    let mass = 0;
    
    this.stages.forEach(s => {
      if (!s.separated) {
        mass += s.getTotalMass();
      }
    });
    
    this.strapons.forEach(b => {
      if (!b.separated) {
        mass += b.getTotalMass();
      }
    });
    
    return mass;
  }
  
  /**
   * Get current CG from nose tip
   */
  getCG() {
    let totalMass = 0;
    let moment = 0;
    const length = this.getTotalLength();
    
    this.stages.forEach(s => {
      if (!s.separated) {
        const stageMass = s.getTotalMass();
        // CG position from nose tip
        const stageCGFromBase = s.getCG();
        const stageCGFromNose = length - s.stackPosition - stageCGFromBase;
        
        moment += stageMass * stageCGFromNose;
        totalMass += stageMass;
      }
    });
    
    // Strap-ons (at bottom)
    this.strapons.forEach(b => {
      if (!b.separated) {
        const boosterMass = b.getTotalMass();
        const boosterCG = length - b.getCG(); // Approximate at rocket base
        moment += boosterMass * boosterCG;
        totalMass += boosterMass;
      }
    });
    
    return totalMass > 0 ? moment / totalMass : 0;
  }
  
  /**
   * Get current CP from nose tip
   */
  getCP() {
    // Simplified: CP dominated by lowest stage with fins
    const length = this.getTotalLength();
    
    for (const stage of this.stages) {
      if (!stage.separated && stage.hasFins) {
        const stageCP = stage.getCP();
        return length - stage.stackPosition - stageCP;
      }
    }
    
    // No fins - unstable
    return length * 0.3;
  }
  
  /**
   * Get stability margin in calibers
   */
  getStabilityMargin() {
    const cp = this.getCP();
    const cg = this.getCG();
    const diameter = this.stages[0]?.bodyDiameter || 0.1;
    
    return (cp - cg) / diameter;
  }
  
  /**
   * Get current thrust from all active motors
   */
  getThrust(time) {
    let thrust = 0;
    
    this.stages.forEach(s => {
      if (!s.separated) {
        thrust += s.getThrust(time);
      }
    });
    
    this.strapons.forEach(b => {
      if (!b.separated) {
        thrust += b.getThrust(time);
      }
    });
    
    return thrust;
  }
  
  /**
   * Get drag coefficient (simplified)
   */
  getCd(mach) {
    let Cd = 0.5; // Base Cd
    
    // Transonic drag rise
    if (mach > 0.8 && mach < 1.2) {
      Cd += 0.3 * Math.sin(Math.PI * (mach - 0.8) / 0.4);
    } else if (mach >= 1.2) {
      Cd += 0.2 / Math.sqrt(mach * mach - 1);
    }
    
    return Cd;
  }
  
  /**
   * Get reference area
   */
  getReferenceArea() {
    const topStage = this.stages.find(s => !s.separated);
    if (!topStage) return 0.01;
    return topStage.getReferenceArea();
  }
  
  /**
   * Check and process staging events
   */
  processStaging(state, dt) {
    const events = [];
    
    // Check ignition triggers
    [...this.stages, ...this.strapons].forEach(stage => {
      if (!stage.ignited && !stage.separated) {
        let shouldIgnite = false;
        
        switch (stage.ignitionTrigger) {
          case IGNITION_TRIGGERS.LIFTOFF:
            shouldIgnite = state.time >= stage.ignitionDelay;
            break;
            
          case IGNITION_TRIGGERS.SEPARATION:
            // Check if previous stage separated
            const prevStage = this.stages.find(s => s.stageNumber === stage.stageNumber - 1);
            if (prevStage && prevStage.separated) {
              const timeSinceSep = state.time - prevStage.separationTime;
              shouldIgnite = timeSinceSep >= stage.ignitionDelay;
            }
            break;
            
          case IGNITION_TRIGGERS.ALTITUDE:
            shouldIgnite = state.y >= stage.ignitionAltitude;
            break;
            
          case IGNITION_TRIGGERS.APOGEE:
            shouldIgnite = state.vy <= 0 && state.y > 100;
            break;
        }
        
        if (shouldIgnite) {
          stage.ignited = true;
          stage.ignitionTime = state.time;
          events.push({
            time: state.time,
            type: 'IGNITION',
            stage: stage.name,
            stageNumber: stage.stageNumber,
            altitude: state.y,
            velocity: state.getVelocity()
          });
        }
      }
    });
    
    // Check separation triggers for serial stages
    this.stages.forEach((stage, index) => {
      if (!stage.separated && index < this.stages.length - 1) {
        let shouldSeparate = false;
        
        switch (stage.separationTrigger) {
          case SEPARATION_TRIGGERS.BURNOUT:
            if (stage.burnedOut) {
              const motorBurnTime = stage.motor?.burnTime || 0;
              const timeSinceBurnout = state.time - (stage.ignitionTime + motorBurnTime);
              shouldSeparate = timeSinceBurnout >= stage.separationDelay;
            }
            break;
            
          case SEPARATION_TRIGGERS.TIMER:
            shouldSeparate = stage.ignited && 
              (state.time - stage.ignitionTime) >= stage.separationDelay;
            break;
            
          case SEPARATION_TRIGGERS.ALTITUDE:
            shouldSeparate = state.y >= stage.separationAltitude;
            break;
            
          case SEPARATION_TRIGGERS.VELOCITY:
            shouldSeparate = state.getVelocity() >= stage.separationVelocity;
            break;
        }
        
        if (shouldSeparate) {
          stage.separated = true;
          stage.separationTime = state.time;
          state.activeStage = stage.stageNumber + 1;
          
          events.push({
            time: state.time,
            type: 'SEPARATION',
            stage: stage.name,
            stageNumber: stage.stageNumber,
            altitude: state.y,
            velocity: state.getVelocity(),
            massDropped: stage.getTotalMass()
          });
          
          // Start tracking separated stage
          this.trackSeparatedStage(stage, state);
        }
      }
    });
    
    // Check separation triggers for strap-on boosters
    this.strapons.forEach(booster => {
      if (!booster.separated) {
        let shouldSeparate = false;
        
        switch (booster.separationTrigger) {
          case SEPARATION_TRIGGERS.BURNOUT:
            if (booster.burnedOut) {
              const motorBurnTime = booster.motor?.burnTime || 0;
              const timeSinceBurnout = state.time - (booster.ignitionTime + motorBurnTime);
              shouldSeparate = timeSinceBurnout >= booster.separationDelay;
            }
            break;
            
          case SEPARATION_TRIGGERS.TIMER:
            shouldSeparate = booster.ignited && 
              (state.time - booster.ignitionTime) >= booster.separationDelay;
            break;
        }
        
        if (shouldSeparate) {
          booster.separated = true;
          booster.separationTime = state.time;
          
          events.push({
            time: state.time,
            type: 'BOOSTER_SEPARATION',
            stage: booster.name,
            altitude: state.y,
            velocity: state.getVelocity(),
            massDropped: booster.getTotalMass()
          });
          
          // Track separated booster
          this.trackSeparatedStage(booster, state);
        }
      }
    });
    
    return events;
  }
  
  /**
   * Track separated stage trajectory (simplified ballistic)
   */
  trackSeparatedStage(stage, state) {
    const stageTrajectory = {
      stage: stage.name,
      stageNumber: stage.stageNumber,
      separationTime: state.time,
      separationAltitude: state.y,
      separationVelocity: state.getVelocity(),
      points: []
    };
    
    // Simulate ballistic trajectory of separated stage
    let t = 0;
    let y = state.y;
    let vy = state.vy * 0.95; // Slight velocity loss from separation
    const mass = stage.getTotalMass();
    const Cd = 1.0; // Tumbling Cd
    const area = stage.getReferenceArea() * 2; // Larger due to tumbling
    
    while (y > 0 && t < 300) {
      // Simple 1D simulation
      const rho = RHO0 * Math.exp(-y / 8500);
      const drag = 0.5 * rho * vy * Math.abs(vy) * Cd * area;
      const accel = -G0 - (drag / mass) * Math.sign(vy);
      
      vy += accel * 0.1;
      y += vy * 0.1;
      t += 0.1;
      
      if (t % 1 < 0.1) {
        stageTrajectory.points.push({
          time: state.time + t,
          altitude: Math.max(0, y),
          velocity: vy
        });
      }
    }
    
    stageTrajectory.landingTime = state.time + t;
    stageTrajectory.impactVelocity = Math.abs(vy);
    
    this.stageTrajectories.push(stageTrajectory);
  }
  
  /**
   * Get atmosphere properties at altitude
   */
  getAtmosphere(altitude) {
    const h = altitude + this.baseAltitude;
    const T = 288.15 - 0.0065 * Math.min(h, 11000);
    const P = 101325 * Math.pow(T / 288.15, 5.256);
    const rho = P / (287.058 * T);
    const speedOfSound = Math.sqrt(1.4 * 287.058 * T);
    
    return { T, P, rho, speedOfSound };
  }
  
  /**
   * Run simulation
   */
  simulate(options = {}) {
    const dt = options.timeStep || this.timeStep;
    const maxTime = options.maxTime || this.maxTime;
    
    // Initialize state
    const state = new MultiStageState();
    state.mass = this.getTotalMass();
    state.cg = this.getCG();
    
    // Launch angle (convert to radians)
    const launchAngleRad = this.launchAngle * Math.PI / 180;
    
    // Track max values
    let maxAltitude = 0;
    let maxVelocity = 0;
    let maxAcceleration = 0;
    let maxMach = 0;
    
    // Reset stages
    this.stages.forEach(s => {
      s.separated = false;
      s.ignited = false;
      s.burnedOut = false;
      s.currentPropellant = s.propellantMass;
      s.ignitionTime = null;
      s.separationTime = null;
    });
    
    this.strapons.forEach(b => {
      b.separated = false;
      b.ignited = false;
      b.burnedOut = false;
      b.currentPropellant = b.propellantMass;
    });
    
    this.trajectory = [];
    this.stageTrajectories = [];
    this.events = [];
    
    // Main simulation loop
    while (state.time < maxTime) {
      // Get current conditions
      const atm = this.getAtmosphere(state.y);
      const velocity = state.getVelocity();
      const mach = velocity / atm.speedOfSound;
      
      // Update mass properties
      state.mass = this.getTotalMass();
      state.cg = this.getCG();
      
      // Get forces
      const thrust = this.getThrust(state.time);
      const Cd = this.getCd(mach);
      const area = this.getReferenceArea();
      const drag = 0.5 * atm.rho * velocity * velocity * Cd * area;
      
      // Gravity
      const gravity = G0 * state.mass;
      
      // Net force (simplified 2D - vertical)
      let netForce;
      if (state.y < this.launchRailLength / Math.cos(launchAngleRad)) {
        // On launch rail - constrained motion
        netForce = thrust - drag - gravity * Math.cos(launchAngleRad);
        state.vx = 0;
      } else {
        // Free flight
        netForce = thrust - drag * (state.vy > 0 ? 1 : -1) - gravity;
      }
      
      // Acceleration
      const accel = state.mass > 0 ? netForce / state.mass : 0;
      
      // Update state (simple Euler integration)
      state.vy += accel * dt;
      state.y += state.vy * dt;
      
      // Wind effect (simplified)
      if (this.windSpeed > 0) {
        const windAccel = 0.5 * atm.rho * this.windSpeed * this.windSpeed * Cd * area / state.mass;
        state.vx += windAccel * dt * 0.1;
        state.x += state.vx * dt;
      }
      
      // Update propellant in all active stages
      [...this.stages, ...this.strapons].forEach(s => {
        if (!s.separated) {
          s.updatePropellant(dt, state.time);
        }
      });
      
      // Process staging events
      const stagingEvents = this.processStaging(state, dt);
      stagingEvents.forEach(e => {
        state.events.push(e);
        this.events.push(e);
      });
      
      // Update phase
      if (state.time === 0) {
        state.phase = 'powered';
        state.events.push({ time: 0, type: 'LIFTOFF', altitude: 0, velocity: 0 });
        this.events.push({ time: 0, type: 'LIFTOFF', altitude: 0, velocity: 0 });
      } else if (thrust > 0) {
        state.phase = 'powered';
      } else if (state.vy > 0) {
        state.phase = 'coasting';
      } else if (state.phase !== 'descent') {
        // Transition to descent - record apogee
        if (state.y > 10) {
          state.events.push({
            time: state.time,
            type: 'APOGEE',
            altitude: state.y,
            velocity: velocity
          });
          this.events.push({
            time: state.time,
            type: 'APOGEE',
            altitude: state.y,
            velocity: velocity
          });
        }
        state.phase = 'descent';
      }
      
      // Track maximums
      if (state.y > maxAltitude) maxAltitude = state.y;
      if (velocity > maxVelocity) maxVelocity = velocity;
      if (Math.abs(accel) > maxAcceleration) maxAcceleration = Math.abs(accel);
      if (mach > maxMach) maxMach = mach;
      
      // Record trajectory point
      if (Math.floor(state.time / 0.1) !== Math.floor((state.time - dt) / 0.1)) {
        this.trajectory.push({
          time: state.time,
          altitude: state.y,
          velocity: velocity,
          acceleration: accel,
          mach: mach,
          thrust: thrust,
          mass: state.mass,
          drag: drag,
          phase: state.phase,
          activeStage: state.activeStage
        });
      }
      
      // Check landing
      if (state.y <= 0 && state.time > 1) {
        state.y = 0;
        state.events.push({
          time: state.time,
          type: 'LANDING',
          altitude: 0,
          velocity: Math.abs(state.vy)
        });
        this.events.push({
          time: state.time,
          type: 'LANDING',
          altitude: 0,
          velocity: Math.abs(state.vy)
        });
        break;
      }
      
      state.time += dt;
    }
    
    // Compile results
    return {
      success: true,
      maxAltitude,
      maxVelocity,
      maxAcceleration,
      maxMach,
      flightTime: state.time,
      apogeeTime: this.events.find(e => e.type === 'APOGEE')?.time || 0,
      stages: this.stages.map(s => ({
        name: s.name,
        number: s.stageNumber,
        ignited: s.ignited,
        ignitionTime: s.ignitionTime,
        separationTime: s.separationTime,
        burnedOut: s.burnedOut,
        separated: s.separated
      })),
      strapons: this.strapons.map(b => ({
        name: b.name,
        ignited: b.ignited,
        ignitionTime: b.ignitionTime,
        separationTime: b.separationTime,
        burnedOut: b.burnedOut,
        separated: b.separated
      })),
      events: this.events,
      trajectory: this.trajectory,
      stageTrajectories: this.stageTrajectories,
      finalState: state.clone()
    };
  }
  
  /**
   * Quick performance estimate without full simulation
   */
  estimatePerformance() {
    // Calculate total impulse
    let totalImpulse = 0;
    this.stages.forEach(s => {
      if (s.motor) {
        totalImpulse += s.motor.totalImpulse;
      }
    });
    this.strapons.forEach(b => {
      if (b.motor) {
        totalImpulse += b.motor.totalImpulse;
      }
    });
    
    // Masses
    const initialMass = this.getTotalMass();
    let finalMass = 0;
    this.stages.forEach(s => {
      finalMass += s.dryMass + (s.motorMass - s.propellantMass);
    });
    
    // Simplified Tsiolkovsky for each stage
    let deltaV = 0;
    let currentMass = initialMass;
    
    this.stages.forEach(s => {
      if (s.motor) {
        const Isp = s.motor.totalImpulse / (s.motor.propellantMass * G0);
        const stageInitialMass = currentMass;
        const stageFinalMass = currentMass - s.propellantMass - (s.separated ? s.dryMass : 0);
        
        deltaV += Isp * G0 * Math.log(stageInitialMass / stageFinalMass);
        currentMass = stageFinalMass;
      }
    });
    
    // Estimate apogee (very rough)
    const avgVelocity = deltaV * 0.5; // Average over flight
    const flightTime = 2 * deltaV / G0; // Up and down
    const estApogee = avgVelocity * flightTime / 4;
    
    return {
      totalImpulse,
      initialMass,
      finalMass,
      massRatio: initialMass / finalMass,
      deltaV,
      estimatedApogee: estApogee,
      stages: this.stages.length,
      strapons: this.strapons.length
    };
  }
  
  /**
   * Validate configuration
   */
  validate() {
    const issues = [];
    const warnings = [];
    
    if (this.stages.length === 0) {
      issues.push('No stages defined');
    }
    
    // Check each stage
    this.stages.forEach((stage, i) => {
      if (!stage.motor) {
        warnings.push(`Stage ${i + 1} has no motor defined`);
      }
      
      if (stage.dryMass <= 0) {
        issues.push(`Stage ${i + 1} has invalid dry mass`);
      }
      
      if (i < this.stages.length - 1 && !stage.hasFins && this.stages[i + 1].hasFins === false) {
        warnings.push('No fins on any stage - rocket will be unstable');
      }
    });
    
    // Check staging sequence
    for (let i = 0; i < this.stages.length - 1; i++) {
      const stage = this.stages[i];
      const nextStage = this.stages[i + 1];
      
      if (nextStage.ignitionTrigger === IGNITION_TRIGGERS.SEPARATION &&
          stage.separationTrigger !== SEPARATION_TRIGGERS.BURNOUT) {
        warnings.push(`Stage ${i + 2} set for separation ignition but stage ${i + 1} may not separate on burnout`);
      }
    }
    
    // Check stability
    const stability = this.getStabilityMargin();
    if (stability < 1) {
      warnings.push(`Stability margin is ${stability.toFixed(2)} calibers (recommended > 1.5)`);
    } else if (stability < 1.5) {
      warnings.push(`Stability margin is ${stability.toFixed(2)} calibers - marginally stable`);
    }
    
    return {
      valid: issues.length === 0,
      issues,
      warnings
    };
  }
  
  /**
   * Export configuration
   */
  toJSON() {
    return {
      name: this.name,
      stages: this.stages.map(s => ({
        name: s.name,
        type: s.type,
        length: s.length,
        bodyDiameter: s.bodyDiameter,
        dryMass: s.dryMass,
        motor: s.motor ? {
          designation: s.motor.designation,
          totalImpulse: s.motor.totalImpulse,
          burnTime: s.motor.burnTime
        } : null,
        hasFins: s.hasFins,
        finCount: s.finCount,
        separationTrigger: s.separationTrigger,
        ignitionTrigger: s.ignitionTrigger
      })),
      strapons: this.strapons.map(b => ({
        name: b.name,
        motor: b.motor ? b.motor.designation : null
      })),
      launchAngle: this.launchAngle
    };
  }
  
  /**
   * Import configuration
   */
  static fromJSON(json) {
    const rocket = new MultiStageRocket({ name: json.name });
    rocket.launchAngle = json.launchAngle || 5;
    
    json.stages?.forEach(s => {
      const motor = s.motor ? new StageMotor({
        designation: s.motor.designation,
        totalImpulse: s.motor.totalImpulse,
        burnTime: s.motor.burnTime
      }) : null;
      
      rocket.addStage({
        name: s.name,
        type: s.type,
        length: s.length,
        bodyDiameter: s.bodyDiameter,
        dryMass: s.dryMass,
        motor,
        motorMass: motor?.totalMass || 0,
        propellantMass: motor?.propellantMass || 0,
        hasFins: s.hasFins,
        finCount: s.finCount,
        separationTrigger: s.separationTrigger,
        ignitionTrigger: s.ignitionTrigger
      });
    });
    
    return rocket;
  }
}

// ============================================
// Preset Configurations
// ============================================

const PRESET_CONFIGS = {
  /**
   * Classic 2-stage minimum diameter
   */
  twoStageMinDia: () => {
    const rocket = new MultiStageRocket({ name: 'Two-Stage Min Dia' });
    
    // Booster
    rocket.addStage({
      name: 'Booster',
      type: STAGE_TYPES.BOOSTER,
      length: 0.3,
      bodyDiameter: 0.029,
      dryMass: 0.08,
      motor: new StageMotor({
        designation: 'D12-0',
        totalImpulse: 16.8,
        averageThrust: 12,
        burnTime: 1.4,
        propellantMass: 0.012,
        totalMass: 0.024
      }),
      motorMass: 0.024,
      propellantMass: 0.012,
      hasFins: true,
      finCount: 3,
      separationTrigger: SEPARATION_TRIGGERS.BURNOUT,
      ignitionTrigger: IGNITION_TRIGGERS.LIFTOFF
    });
    
    // Sustainer
    rocket.addStage({
      name: 'Sustainer',
      type: STAGE_TYPES.SUSTAINER,
      length: 0.35,
      bodyDiameter: 0.029,
      dryMass: 0.06,
      hasNoseCone: true,
      noseLength: 0.08,
      motor: new StageMotor({
        designation: 'D12-5',
        totalImpulse: 16.8,
        averageThrust: 12,
        burnTime: 1.4,
        propellantMass: 0.012,
        totalMass: 0.024
      }),
      motorMass: 0.024,
      propellantMass: 0.012,
      hasFins: false,
      ignitionTrigger: IGNITION_TRIGGERS.SEPARATION,
      ignitionDelay: 0
    });
    
    return rocket;
  },
  
  /**
   * High-power 2-stage
   */
  twoStageHPR: () => {
    const rocket = new MultiStageRocket({ name: 'Two-Stage HPR' });
    
    // Booster
    rocket.addStage({
      name: 'Booster',
      type: STAGE_TYPES.BOOSTER,
      length: 0.6,
      bodyDiameter: 0.054,
      dryMass: 0.4,
      motor: new StageMotor({
        designation: 'J350W',
        totalImpulse: 658,
        averageThrust: 350,
        burnTime: 1.9,
        propellantMass: 0.32,
        totalMass: 0.48
      }),
      motorMass: 0.48,
      propellantMass: 0.32,
      hasFins: true,
      finCount: 4,
      finRootChord: 0.1,
      finTipChord: 0.05,
      finSpan: 0.07,
      separationTrigger: SEPARATION_TRIGGERS.BURNOUT,
      separationDelay: 0.5
    });
    
    // Sustainer
    rocket.addStage({
      name: 'Sustainer',
      type: STAGE_TYPES.SUSTAINER,
      length: 0.8,
      bodyDiameter: 0.054,
      dryMass: 0.35,
      hasNoseCone: true,
      noseLength: 0.2,
      motor: new StageMotor({
        designation: 'J420R',
        totalImpulse: 615,
        averageThrust: 420,
        burnTime: 1.5,
        propellantMass: 0.3,
        totalMass: 0.45
      }),
      motorMass: 0.45,
      propellantMass: 0.3,
      hasFins: true,
      finCount: 3,
      finRootChord: 0.08,
      finTipChord: 0.04,
      finSpan: 0.05,
      ignitionTrigger: IGNITION_TRIGGERS.SEPARATION,
      ignitionDelay: 0.2
    });
    
    return rocket;
  },
  
  /**
   * Three-stage sounding rocket
   */
  threeStage: () => {
    const rocket = new MultiStageRocket({ name: 'Three-Stage Sounding' });
    
    // First stage (booster)
    rocket.addStage({
      name: 'First Stage',
      type: STAGE_TYPES.BOOSTER,
      length: 0.5,
      bodyDiameter: 0.076,
      dryMass: 0.6,
      motor: new StageMotor({
        designation: 'K660',
        totalImpulse: 1400,
        averageThrust: 660,
        burnTime: 2.1,
        propellantMass: 0.7,
        totalMass: 1.0
      }),
      motorMass: 1.0,
      propellantMass: 0.7,
      hasFins: true,
      finCount: 4,
      separationTrigger: SEPARATION_TRIGGERS.BURNOUT,
      separationDelay: 0.3
    });
    
    // Second stage (sustainer)
    rocket.addStage({
      name: 'Second Stage',
      type: STAGE_TYPES.SUSTAINER,
      length: 0.45,
      bodyDiameter: 0.054,
      dryMass: 0.4,
      motor: new StageMotor({
        designation: 'J350W',
        totalImpulse: 658,
        averageThrust: 350,
        burnTime: 1.9,
        propellantMass: 0.32,
        totalMass: 0.48
      }),
      motorMass: 0.48,
      propellantMass: 0.32,
      hasFins: true,
      finCount: 3,
      ignitionTrigger: IGNITION_TRIGGERS.SEPARATION,
      ignitionDelay: 0.5,
      separationTrigger: SEPARATION_TRIGGERS.BURNOUT,
      separationDelay: 0.3
    });
    
    // Third stage (upper)
    rocket.addStage({
      name: 'Third Stage',
      type: STAGE_TYPES.UPPER,
      length: 0.35,
      bodyDiameter: 0.038,
      dryMass: 0.2,
      hasNoseCone: true,
      noseLength: 0.15,
      motor: new StageMotor({
        designation: 'H128W',
        totalImpulse: 186,
        averageThrust: 128,
        burnTime: 1.5,
        propellantMass: 0.09,
        totalMass: 0.14
      }),
      motorMass: 0.14,
      propellantMass: 0.09,
      hasFins: false,
      ignitionTrigger: IGNITION_TRIGGERS.SEPARATION,
      ignitionDelay: 1.0
    });
    
    return rocket;
  },
  
  /**
   * Parallel staging (core + boosters)
   */
  parallelStaging: () => {
    const rocket = new MultiStageRocket({ name: 'Parallel Staging' });
    
    // Core stage
    rocket.addStage({
      name: 'Core',
      type: STAGE_TYPES.SUSTAINER,
      length: 1.0,
      bodyDiameter: 0.076,
      dryMass: 0.8,
      hasNoseCone: true,
      noseLength: 0.25,
      motor: new StageMotor({
        designation: 'L1150',
        totalImpulse: 3500,
        averageThrust: 1150,
        burnTime: 3.0,
        propellantMass: 1.7,
        totalMass: 2.5
      }),
      motorMass: 2.5,
      propellantMass: 1.7,
      hasFins: true,
      finCount: 4,
      ignitionTrigger: IGNITION_TRIGGERS.LIFTOFF
    });
    
    // Strap-on boosters
    const booster1 = new Stage({
      name: 'Booster Left',
      type: STAGE_TYPES.STRAPON,
      length: 0.5,
      bodyDiameter: 0.054,
      dryMass: 0.3,
      motor: new StageMotor({
        designation: 'J350W',
        totalImpulse: 658,
        averageThrust: 350,
        burnTime: 1.9,
        propellantMass: 0.32,
        totalMass: 0.48
      }),
      motorMass: 0.48,
      propellantMass: 0.32,
      separationTrigger: SEPARATION_TRIGGERS.BURNOUT,
      separationDelay: 0.2
    });
    
    const booster2 = new Stage({
      name: 'Booster Right',
      type: STAGE_TYPES.STRAPON,
      length: 0.5,
      bodyDiameter: 0.054,
      dryMass: 0.3,
      motor: new StageMotor({
        designation: 'J350W',
        totalImpulse: 658,
        averageThrust: 350,
        burnTime: 1.9,
        propellantMass: 0.32,
        totalMass: 0.48
      }),
      motorMass: 0.48,
      propellantMass: 0.32,
      separationTrigger: SEPARATION_TRIGGERS.BURNOUT,
      separationDelay: 0.2
    });
    
    rocket.addStrapon(booster1);
    rocket.addStrapon(booster2);
    
    return rocket;
  }
};

// ============================================
// Exports
// ============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MultiStageRocket,
    Stage,
    StageMotor,
    MultiStageState,
    STAGE_TYPES,
    SEPARATION_TRIGGERS,
    IGNITION_TRIGGERS,
    PRESET_CONFIGS
  };
}

if (typeof window !== 'undefined') {
  window.MultiStageRocket = MultiStageRocket;
  window.Stage = Stage;
  window.StageMotor = StageMotor;
  window.MultiStageState = MultiStageState;
  window.STAGE_TYPES = STAGE_TYPES;
  window.SEPARATION_TRIGGERS = SEPARATION_TRIGGERS;
  window.IGNITION_TRIGGERS = IGNITION_TRIGGERS;
  window.PRESET_CONFIGS = PRESET_CONFIGS;
}

export {
  MultiStageRocket,
  Stage,
  StageMotor,
  MultiStageState,
  STAGE_TYPES,
  SEPARATION_TRIGGERS,
  IGNITION_TRIGGERS,
  PRESET_CONFIGS
};

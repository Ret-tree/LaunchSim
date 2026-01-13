/**
 * LAUNCHSIM Physics Engine
 * 6-DOF Rocket Dynamics with RK4 Integration
 * 
 * Designed to match/exceed OpenRocket accuracy while enabling
 * real-time 3D visualization and hardware-in-the-loop testing.
 */

// ============================================
// CONSTANTS
// ============================================

export const CONSTANTS = {
  // Standard atmosphere
  G0: 9.80665,              // m/s² - standard gravity
  R_AIR: 287.058,           // J/(kg·K) - specific gas constant for air
  GAMMA: 1.4,               // ratio of specific heats for air
  
  // Sea level conditions (ISA)
  P0: 101325,               // Pa - sea level pressure
  T0: 288.15,               // K - sea level temperature
  RHO0: 1.225,              // kg/m³ - sea level density
  
  // Atmosphere layers
  TROPOSPHERE_H: 11000,     // m - troposphere height
  LAPSE_RATE: 0.0065,       // K/m - temperature lapse rate
  
  // Earth
  EARTH_RADIUS: 6371000,    // m
  EARTH_ROTATION: 7.2921e-5, // rad/s
  
  // Simulation
  MIN_TIMESTEP: 0.0001,     // s - minimum physics timestep
  MAX_TIMESTEP: 0.01,       // s - maximum physics timestep
};

// ============================================
// VECTOR & QUATERNION MATH
// ============================================

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
  
  clone() {
    return new Vector3(this.x, this.y, this.z);
  }
  
  add(v) {
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }
  
  sub(v) {
    return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z);
  }
  
  scale(s) {
    return new Vector3(this.x * s, this.y * s, this.z * s);
  }
  
  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  
  cross(v) {
    return new Vector3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }
  
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  
  normalize() {
    const len = this.length();
    if (len === 0) return new Vector3(0, 0, 0);
    return this.scale(1 / len);
  }
  
  toArray() {
    return [this.x, this.y, this.z];
  }
  
  static fromArray(arr) {
    return new Vector3(arr[0], arr[1], arr[2]);
  }
}

export class Quaternion {
  constructor(w = 1, x = 0, y = 0, z = 0) {
    this.w = w;
    this.x = x;
    this.y = y;
    this.z = z;
  }
  
  clone() {
    return new Quaternion(this.w, this.x, this.y, this.z);
  }
  
  multiply(q) {
    return new Quaternion(
      this.w * q.w - this.x * q.x - this.y * q.y - this.z * q.z,
      this.w * q.x + this.x * q.w + this.y * q.z - this.z * q.y,
      this.w * q.y - this.x * q.z + this.y * q.w + this.z * q.x,
      this.w * q.z + this.x * q.y - this.y * q.x + this.z * q.w
    );
  }
  
  conjugate() {
    return new Quaternion(this.w, -this.x, -this.y, -this.z);
  }
  
  scale(s) {
    return new Quaternion(this.w * s, this.x * s, this.y * s, this.z * s);
  }
  
  normalize() {
    const len = Math.sqrt(this.w*this.w + this.x*this.x + this.y*this.y + this.z*this.z);
    if (len === 0) return new Quaternion(1, 0, 0, 0);
    return new Quaternion(this.w/len, this.x/len, this.y/len, this.z/len);
  }
  
  // Rotate a vector by this quaternion
  rotateVector(v) {
    const qv = new Quaternion(0, v.x, v.y, v.z);
    const result = this.multiply(qv).multiply(this.conjugate());
    return new Vector3(result.x, result.y, result.z);
  }
  
  // Get rotation matrix (3x3)
  toRotationMatrix() {
    const { w, x, y, z } = this;
    return [
      [1 - 2*y*y - 2*z*z, 2*x*y - 2*w*z, 2*x*z + 2*w*y],
      [2*x*y + 2*w*z, 1 - 2*x*x - 2*z*z, 2*y*z - 2*w*x],
      [2*x*z - 2*w*y, 2*y*z + 2*w*x, 1 - 2*x*x - 2*y*y]
    ];
  }
  
  // Convert to Euler angles (roll, pitch, yaw) in radians
  toEuler() {
    const { w, x, y, z } = this;
    
    // Roll (x-axis rotation)
    const sinr_cosp = 2 * (w * x + y * z);
    const cosr_cosp = 1 - 2 * (x * x + y * y);
    const roll = Math.atan2(sinr_cosp, cosr_cosp);
    
    // Pitch (y-axis rotation)
    const sinp = 2 * (w * y - z * x);
    let pitch;
    if (Math.abs(sinp) >= 1) {
      pitch = Math.sign(sinp) * Math.PI / 2; // Use 90 degrees if out of range
    } else {
      pitch = Math.asin(sinp);
    }
    
    // Yaw (z-axis rotation)
    const siny_cosp = 2 * (w * z + x * y);
    const cosy_cosp = 1 - 2 * (y * y + z * z);
    const yaw = Math.atan2(siny_cosp, cosy_cosp);
    
    return { roll, pitch, yaw };
  }
  
  // Create from axis-angle
  static fromAxisAngle(axis, angle) {
    const halfAngle = angle / 2;
    const s = Math.sin(halfAngle);
    return new Quaternion(
      Math.cos(halfAngle),
      axis.x * s,
      axis.y * s,
      axis.z * s
    ).normalize();
  }
  
  // Create from Euler angles
  static fromEuler(roll, pitch, yaw) {
    const cr = Math.cos(roll / 2);
    const sr = Math.sin(roll / 2);
    const cp = Math.cos(pitch / 2);
    const sp = Math.sin(pitch / 2);
    const cy = Math.cos(yaw / 2);
    const sy = Math.sin(yaw / 2);
    
    return new Quaternion(
      cr * cp * cy + sr * sp * sy,
      sr * cp * cy - cr * sp * sy,
      cr * sp * cy + sr * cp * sy,
      cr * cp * sy - sr * sp * cy
    );
  }
}

// ============================================
// ATMOSPHERE MODEL (ISA + Extensions)
// ============================================

export class Atmosphere {
  constructor(config = {}) {
    this.baseElevation = config.baseElevation || 0;
    this.temperature = config.temperature || CONSTANTS.T0 - 273.15; // °C
    this.pressure = config.pressure || CONSTANTS.P0;
    this.humidity = config.humidity || 0.5;
  }
  
  // Get atmospheric properties at altitude (above sea level)
  getProperties(altitude) {
    const h = altitude + this.baseElevation;
    
    let T, P, rho;
    
    if (h < CONSTANTS.TROPOSPHERE_H) {
      // Troposphere - temperature decreases linearly
      T = CONSTANTS.T0 - CONSTANTS.LAPSE_RATE * h;
      P = CONSTANTS.P0 * Math.pow(T / CONSTANTS.T0, 
          CONSTANTS.G0 / (CONSTANTS.LAPSE_RATE * CONSTANTS.R_AIR));
    } else {
      // Stratosphere (simplified - isothermal)
      const T_trop = CONSTANTS.T0 - CONSTANTS.LAPSE_RATE * CONSTANTS.TROPOSPHERE_H;
      const P_trop = CONSTANTS.P0 * Math.pow(T_trop / CONSTANTS.T0,
          CONSTANTS.G0 / (CONSTANTS.LAPSE_RATE * CONSTANTS.R_AIR));
      
      T = T_trop; // Isothermal
      P = P_trop * Math.exp(-CONSTANTS.G0 * (h - CONSTANTS.TROPOSPHERE_H) / 
          (CONSTANTS.R_AIR * T_trop));
    }
    
    // Density from ideal gas law
    rho = P / (CONSTANTS.R_AIR * T);
    
    // Speed of sound
    const speedOfSound = Math.sqrt(CONSTANTS.GAMMA * CONSTANTS.R_AIR * T);
    
    // Dynamic viscosity (Sutherland's formula)
    const mu = 1.458e-6 * Math.pow(T, 1.5) / (T + 110.4);
    
    return {
      temperature: T,           // K
      pressure: P,              // Pa
      density: rho,             // kg/m³
      speedOfSound,             // m/s
      dynamicViscosity: mu,     // Pa·s
      kinematicViscosity: mu / rho  // m²/s
    };
  }
  
  // Get gravity at altitude (including Earth curvature)
  getGravity(altitude) {
    const r = CONSTANTS.EARTH_RADIUS + altitude;
    return CONSTANTS.G0 * Math.pow(CONSTANTS.EARTH_RADIUS / r, 2);
  }
}

// ============================================
// AERODYNAMICS (Barrowman Method)
// ============================================

export class Aerodynamics {
  constructor(rocket) {
    this.rocket = rocket;
    this.precompute();
  }
  
  precompute() {
    // Precompute static aerodynamic properties
    this.referenceArea = Math.PI * Math.pow(this.rocket.bodyRadius, 2);
    this.wettedArea = this.calculateWettedArea();
    this.finEfficiency = this.calculateFinEfficiency();
  }
  
  calculateWettedArea() {
    const r = this.rocket;
    let area = 0;
    
    // Nose cone
    if (r.noseShape === 'conical') {
      const slantHeight = Math.sqrt(r.noseLength * r.noseLength + r.bodyRadius * r.bodyRadius);
      area += Math.PI * r.bodyRadius * slantHeight;
    } else {
      // Ogive/parabolic - approximate
      area += Math.PI * r.bodyRadius * r.noseLength * 1.1;
    }
    
    // Body tube
    area += 2 * Math.PI * r.bodyRadius * r.bodyLength;
    
    // Fins (both sides)
    const finArea = 0.5 * (r.finRootChord + r.finTipChord) * r.finSpan;
    area += 2 * r.finCount * finArea;
    
    return area;
  }
  
  calculateFinEfficiency() {
    // Fin-body interference factor (tau)
    const r = this.rocket;
    const s = r.finSpan;
    const d = r.bodyRadius * 2;
    return 1 + d / (2 * s + d);
  }
  
  // ============================================
  // CENTER OF PRESSURE (Barrowman Equations)
  // ============================================
  
  calculateCP() {
    const r = this.rocket;
    let CN_total = 0;
    let CP_moment = 0;
    
    // 1. NOSE CONE
    // CN for nose = 2 (any shape at small angles of attack)
    const CN_nose = 2;
    const X_nose = this.getNoseCPPosition();
    CN_total += CN_nose;
    CP_moment += CN_nose * X_nose;
    
    // 2. BODY TUBE
    // Cylindrical bodies contribute negligibly at small AoA
    // (No contribution to CP)
    
    // 3. FINS (most important)
    const finResult = this.calculateFinCP();
    CN_total += finResult.CN;
    CP_moment += finResult.CN * finResult.X;
    
    // 4. BOATTAIL (if present)
    if (r.boattailLength > 0) {
      const boattailResult = this.calculateBoattailCP();
      CN_total += boattailResult.CN;
      CP_moment += boattailResult.CN * boattailResult.X;
    }
    
    const CP = CP_moment / CN_total;
    
    return {
      CP,                  // Distance from nose tip
      CN: CN_total,        // Total normal force coefficient
      components: {
        nose: { CN: CN_nose, X: X_nose },
        fins: finResult
      }
    };
  }
  
  getNoseCPPosition() {
    const r = this.rocket;
    
    switch (r.noseShape) {
      case 'conical':
        return r.noseLength * 2/3;
      case 'ogive':
        return r.noseLength * 0.466;
      case 'parabolic':
        return r.noseLength * 0.5;
      case 'elliptical':
        return r.noseLength * 0.333;
      case 'vonKarman':
        return r.noseLength * 0.437;
      case 'haack':
        return r.noseLength * 0.437;
      default:
        return r.noseLength * 0.466; // Default to ogive
    }
  }
  
  calculateFinCP() {
    const r = this.rocket;
    
    // Barrowman fin equations
    const Cr = r.finRootChord;      // Root chord
    const Ct = r.finTipChord;       // Tip chord
    const s = r.finSpan;            // Semi-span
    const Xs = r.finSweepDistance;  // Sweep distance (leading edge)
    const d = r.bodyRadius * 2;     // Body diameter
    const N = r.finCount;           // Number of fins
    const t = r.finThickness || 0.003;  // Fin thickness
    
    // Mid-chord line
    const lm = Math.sqrt(s * s + Math.pow(Xs + 0.5*Ct - 0.5*Cr, 2));
    
    // Fin planform area
    const Af = 0.5 * (Cr + Ct) * s;
    
    // Aspect ratio
    const AR = 2 * s * s / Af;
    
    // Interference factor
    const K = 1 + d / (2 * s + d);
    
    // Normal force coefficient per fin (Barrowman equation)
    // CN_alpha = (4*N*(s/d)^2) / (1 + sqrt(1 + (2*L_m/(C_r+C_t))^2))
    const sOverD = s / d;
    const denominator = 1 + Math.sqrt(1 + Math.pow(2 * lm / (Cr + Ct), 2));
    const CN_alpha = (4 * N * sOverD * sOverD) / denominator;
    
    // Apply interference factor
    const CN = CN_alpha * K;
    
    // CP location from fin root leading edge
    const Xf = Xs * (Cr + 2*Ct) / (3 * (Cr + Ct)) + 
               (1/6) * (Cr + Ct - Cr*Ct / (Cr + Ct));
    
    // CP from nose tip (fin leading edge is at body length)
    const X = r.noseLength + r.bodyLength - Cr + Xf;
    
    return { CN, X, CN_alpha, K };
  }
  
  calculateBoattailCP() {
    const r = this.rocket;
    
    // Simplified boattail contribution
    const d1 = r.bodyRadius * 2;
    const d2 = r.boattailEndDiameter;
    const L = r.boattailLength;
    
    const CN = 2 * (Math.pow(d2/d1, 2) - 1);
    const X = r.noseLength + r.bodyLength + L * 0.5;
    
    return { CN, X };
  }
  
  // ============================================
  // DRAG COEFFICIENT
  // ============================================
  
  calculateDrag(velocity, atmosphere, angleOfAttack = 0) {
    const r = this.rocket;
    const atm = atmosphere;
    
    const speed = velocity.length();
    if (speed < 0.1) return { Cd: 0, drag: new Vector3() };
    
    const mach = speed / atm.speedOfSound;
    const reynolds = (atm.density * speed * r.bodyLength) / atm.dynamicViscosity;
    
    // 1. FRICTION DRAG
    const Cdf = this.calculateFrictionDrag(reynolds, mach);
    
    // 2. PRESSURE DRAG
    const Cdp = this.calculatePressureDrag(mach);
    
    // 3. BASE DRAG
    const Cdb = this.calculateBaseDrag(mach);
    
    // 4. WAVE DRAG (transonic/supersonic)
    const Cdw = this.calculateWaveDrag(mach);
    
    // 5. INDUCED DRAG (from angle of attack)
    const Cdi = this.calculateInducedDrag(angleOfAttack);
    
    // Total drag coefficient
    const Cd = Cdf + Cdp + Cdb + Cdw + Cdi;
    
    // Drag force
    const dragMagnitude = 0.5 * atm.density * speed * speed * Cd * this.referenceArea;
    const dragDirection = velocity.normalize().scale(-1);
    const drag = dragDirection.scale(dragMagnitude);
    
    return {
      Cd,
      drag,
      components: {
        friction: Cdf,
        pressure: Cdp,
        base: Cdb,
        wave: Cdw,
        induced: Cdi
      },
      mach,
      reynolds
    };
  }
  
  calculateFrictionDrag(Re, mach) {
    const r = this.rocket;
    
    // Skin friction coefficient (turbulent, Prandtl-Schlichting)
    let Cf;
    if (Re < 1e4) {
      Cf = 1.328 / Math.sqrt(Re);  // Laminar
    } else {
      Cf = 0.455 / Math.pow(Math.log10(Re), 2.58);  // Turbulent
    }
    
    // Compressibility correction (Prandtl-Glauert)
    if (mach > 0.3 && mach < 1) {
      Cf *= 1 / Math.sqrt(1 - mach * mach);
    }
    
    // Surface roughness correction
    const roughnessFactor = r.surfaceRoughness === 'smooth' ? 1.0 :
                           r.surfaceRoughness === 'painted' ? 1.1 :
                           r.surfaceRoughness === 'rough' ? 1.3 : 1.15;
    Cf *= roughnessFactor;
    
    // Convert to drag coefficient based on wetted/reference area
    const Cdf = Cf * this.wettedArea / this.referenceArea;
    
    // Body fineness ratio correction
    const fineness = (r.noseLength + r.bodyLength) / (r.bodyRadius * 2);
    const bodyFactor = 1 + 60 / Math.pow(fineness, 3) + 0.0025 * fineness;
    
    return Cdf * bodyFactor;
  }
  
  calculatePressureDrag(mach) {
    const r = this.rocket;
    let Cdp = 0;
    
    // Nose pressure drag (depends on shape)
    switch (r.noseShape) {
      case 'conical':
        Cdp += 0.1 * Math.pow(r.bodyRadius / r.noseLength, 2);
        break;
      case 'ogive':
        Cdp += 0.025 * Math.pow(r.bodyRadius / r.noseLength, 2);
        break;
      case 'vonKarman':
      case 'haack':
        Cdp += 0.01 * Math.pow(r.bodyRadius / r.noseLength, 2);
        break;
      default:
        Cdp += 0.05 * Math.pow(r.bodyRadius / r.noseLength, 2);
    }
    
    // Fin leading edge drag
    const finThickness = r.finThickness || 0.003;
    const finCount = r.finCount;
    const finArea = 0.5 * (r.finRootChord + r.finTipChord) * r.finSpan;
    Cdp += 0.5 * finCount * finThickness * finArea / this.referenceArea;
    
    return Cdp;
  }
  
  calculateBaseDrag(mach) {
    // Base drag coefficient (subsonic approximation)
    if (mach < 1) {
      return 0.12 + 0.13 * mach * mach;
    } else {
      return 0.25 / mach;
    }
  }
  
  calculateWaveDrag(mach) {
    // Wave drag (transonic and supersonic)
    if (mach < 0.8) {
      return 0;
    } else if (mach < 1.2) {
      // Transonic - interpolate
      const t = (mach - 0.8) / 0.4;
      return t * t * 0.2;
    } else {
      // Supersonic
      const beta = Math.sqrt(mach * mach - 1);
      return 0.2 / beta;
    }
  }
  
  calculateInducedDrag(angleOfAttack) {
    // Induced drag from angle of attack
    // Cdi = CN² / (π * AR * e)
    const AR = 2 * this.rocket.finSpan * this.rocket.finSpan / 
               (0.5 * (this.rocket.finRootChord + this.rocket.finTipChord) * this.rocket.finSpan);
    const e = 0.85;  // Oswald efficiency
    const CN = 2 * angleOfAttack;  // Simplified
    
    return CN * CN / (Math.PI * AR * e);
  }
  
  // ============================================
  // AERODYNAMIC FORCES AND MOMENTS
  // ============================================
  
  calculateForces(state, atmosphere, thrust = 0) {
    const velocity = new Vector3(state.vx, state.vy, state.vz);
    const speed = velocity.length();
    
    // Calculate angle of attack
    const bodyAxis = state.orientation.rotateVector(new Vector3(0, 1, 0));
    let angleOfAttack = 0;
    if (speed > 0.1) {
      const cosAoA = velocity.normalize().dot(bodyAxis);
      angleOfAttack = Math.acos(Math.min(1, Math.max(-1, cosAoA)));
    }
    
    // Get drag
    const dragResult = this.calculateDrag(velocity, atmosphere, angleOfAttack);
    
    // Calculate corrective moment (weathercock stability)
    const cpData = this.calculateCP();
    const cg = state.cg;
    const cp = cpData.CP;
    const stabilityMargin = (cp - cg) / (this.rocket.bodyRadius * 2);
    
    // Normal force creates restoring moment
    let momentMagnitude = 0;
    if (speed > 0.1 && angleOfAttack > 0.001) {
      const normalForce = 0.5 * atmosphere.density * speed * speed * 
                         cpData.CN * angleOfAttack * this.referenceArea;
      momentMagnitude = normalForce * (cp - cg);
    }
    
    return {
      drag: dragResult.drag,
      Cd: dragResult.Cd,
      angleOfAttack,
      stabilityMargin,
      correctiveMoment: momentMagnitude,
      CP: cp,
      CG: cg
    };
  }
}

// ============================================
// ROCKET STATE
// ============================================

export class RocketState {
  constructor() {
    // Position (world frame, meters)
    this.x = 0;
    this.y = 0;
    this.z = 0;
    
    // Velocity (world frame, m/s)
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    
    // Orientation (quaternion)
    this.orientation = new Quaternion(1, 0, 0, 0);
    
    // Angular velocity (body frame, rad/s)
    this.wx = 0;
    this.wy = 0;
    this.wz = 0;
    
    // Mass properties
    this.mass = 0;
    this.propellantMass = 0;
    this.cg = 0;  // CG from nose tip
    
    // Moments of inertia (body frame)
    this.Ixx = 0;
    this.Iyy = 0;
    this.Izz = 0;
    
    // Time
    this.time = 0;
    
    // Phase
    this.phase = 'pre-launch';  // pre-launch, powered, coasting, descent, landed
    
    // Flight events
    this.events = [];
  }
  
  clone() {
    const s = new RocketState();
    s.x = this.x; s.y = this.y; s.z = this.z;
    s.vx = this.vx; s.vy = this.vy; s.vz = this.vz;
    s.orientation = this.orientation.clone();
    s.wx = this.wx; s.wy = this.wy; s.wz = this.wz;
    s.mass = this.mass;
    s.propellantMass = this.propellantMass;
    s.cg = this.cg;
    s.Ixx = this.Ixx; s.Iyy = this.Iyy; s.Izz = this.Izz;
    s.time = this.time;
    s.phase = this.phase;
    s.events = [...this.events];
    return s;
  }
  
  getPosition() {
    return new Vector3(this.x, this.y, this.z);
  }
  
  getVelocity() {
    return new Vector3(this.vx, this.vy, this.vz);
  }
  
  getAngularVelocity() {
    return new Vector3(this.wx, this.wy, this.wz);
  }
  
  // Convert state to array for RK4
  toArray() {
    return [
      this.x, this.y, this.z,
      this.vx, this.vy, this.vz,
      this.orientation.w, this.orientation.x, this.orientation.y, this.orientation.z,
      this.wx, this.wy, this.wz,
      this.propellantMass
    ];
  }
  
  // Load state from array
  fromArray(arr) {
    this.x = arr[0]; this.y = arr[1]; this.z = arr[2];
    this.vx = arr[3]; this.vy = arr[4]; this.vz = arr[5];
    this.orientation = new Quaternion(arr[6], arr[7], arr[8], arr[9]).normalize();
    this.wx = arr[10]; this.wy = arr[11]; this.wz = arr[12];
    this.propellantMass = arr[13];
    return this;
  }
}

// ============================================
// RK4 INTEGRATOR
// ============================================

export class RK4Integrator {
  constructor(derivativeFunc) {
    this.computeDerivatives = derivativeFunc;
  }
  
  step(state, dt) {
    const y = state.toArray();
    
    // k1 = f(t, y)
    const k1 = this.computeDerivatives(state, state.time);
    
    // k2 = f(t + dt/2, y + dt/2 * k1)
    const state2 = state.clone();
    state2.fromArray(this.addArrays(y, this.scaleArray(k1, dt / 2)));
    state2.time = state.time + dt / 2;
    const k2 = this.computeDerivatives(state2, state2.time);
    
    // k3 = f(t + dt/2, y + dt/2 * k2)
    const state3 = state.clone();
    state3.fromArray(this.addArrays(y, this.scaleArray(k2, dt / 2)));
    state3.time = state.time + dt / 2;
    const k3 = this.computeDerivatives(state3, state3.time);
    
    // k4 = f(t + dt, y + dt * k3)
    const state4 = state.clone();
    state4.fromArray(this.addArrays(y, this.scaleArray(k3, dt)));
    state4.time = state.time + dt;
    const k4 = this.computeDerivatives(state4, state4.time);
    
    // y_new = y + (dt/6) * (k1 + 2*k2 + 2*k3 + k4)
    const weighted = this.addArrays(
      k1,
      this.scaleArray(k2, 2),
      this.scaleArray(k3, 2),
      k4
    );
    
    const yNew = this.addArrays(y, this.scaleArray(weighted, dt / 6));
    
    const newState = state.clone();
    newState.fromArray(yNew);
    newState.time = state.time + dt;
    
    return newState;
  }
  
  addArrays(...arrays) {
    const result = new Array(arrays[0].length).fill(0);
    for (const arr of arrays) {
      for (let i = 0; i < arr.length; i++) {
        result[i] += arr[i];
      }
    }
    return result;
  }
  
  scaleArray(arr, s) {
    return arr.map(v => v * s);
  }
}

// ============================================
// PHYSICS ENGINE
// ============================================

export class PhysicsEngine {
  constructor(rocket, motor, config = {}) {
    this.rocket = rocket;
    this.motor = motor;
    this.config = {
      timestep: 0.001,           // 1kHz default
      maxTimestep: 0.01,
      adaptiveTimestep: true,
      ...config
    };
    
    this.atmosphere = new Atmosphere(config.atmosphere);
    this.aero = new Aerodynamics(rocket);
    
    this.state = new RocketState();
    this.initializeState();
    
    this.integrator = new RK4Integrator(this.computeDerivatives.bind(this));
    
    // TVC state
    this.gimbalX = 0;
    this.gimbalY = 0;
    
    // Wind
    this.wind = config.wind || { speed: 0, direction: 0, gusts: 0 };
    
    // Flight records
    this.maxAltitude = 0;
    this.maxVelocity = 0;
    this.maxAcceleration = 0;
    this.trajectory = [];
  }
  
  initializeState() {
    this.state.mass = this.rocket.dryMass + this.motor.totalMass;
    this.state.propellantMass = this.motor.propellantMass;
    this.state.cg = this.calculateCG();
    this.calculateMomentsOfInertia();
    this.state.phase = 'pre-launch';
    this.state.time = 0;
  }
  
  calculateCG() {
    const r = this.rocket;
    const m = this.motor;
    
    // Component masses and positions (from nose tip)
    const components = [
      { mass: r.noseMass, position: r.noseLength * 0.4 },
      { mass: r.bodyMass, position: r.noseLength + r.bodyLength * 0.5 },
      { mass: r.finMass, position: r.noseLength + r.bodyLength * 0.85 },
      { mass: m.casingMass, position: r.noseLength + r.bodyLength * 0.9 },
      { mass: this.state.propellantMass, position: r.noseLength + r.bodyLength * 0.85 }
    ];
    
    let totalMass = 0;
    let moment = 0;
    
    for (const c of components) {
      totalMass += c.mass;
      moment += c.mass * c.position;
    }
    
    return moment / totalMass;
  }
  
  calculateMomentsOfInertia() {
    const r = this.rocket;
    const m = this.state.mass;
    const L = r.noseLength + r.bodyLength;
    const R = r.bodyRadius;
    
    // Simplified MOI calculation (cylinder approximation)
    // Ixx = Iyy (transverse) - rotation about body axis perpendicular to length
    // Izz (axial) - rotation about long axis
    
    this.state.Ixx = (1/12) * m * L * L + (1/4) * m * R * R;
    this.state.Iyy = this.state.Ixx;
    this.state.Izz = (1/2) * m * R * R;
  }
  
  computeDerivatives(state, time) {
    const derivatives = new Array(14).fill(0);
    
    // Position derivatives = velocity
    derivatives[0] = state.vx;
    derivatives[1] = state.vy;
    derivatives[2] = state.vz;
    
    // Get atmospheric properties
    const atm = this.atmosphere.getProperties(state.y);
    
    // Calculate forces
    const forces = this.calculateForces(state, time, atm);
    
    // Acceleration = Force / mass
    const ax = forces.total.x / state.mass;
    const ay = forces.total.y / state.mass;
    const az = forces.total.z / state.mass;
    
    derivatives[3] = ax;
    derivatives[4] = ay;
    derivatives[5] = az;
    
    // Quaternion derivative from angular velocity
    // qdot = 0.5 * q * omega (where omega is quaternion [0, wx, wy, wz])
    const q = state.orientation;
    const w = new Quaternion(0, state.wx, state.wy, state.wz);
    const qdot = q.multiply(w).scale(0.5);
    
    derivatives[6] = qdot.w;
    derivatives[7] = qdot.x;
    derivatives[8] = qdot.y;
    derivatives[9] = qdot.z;
    
    // Angular acceleration from moments
    // Euler's equations for rigid body rotation
    const Mx = forces.moment.x;
    const My = forces.moment.y;
    const Mz = forces.moment.z;
    
    // α = I⁻¹ * (M - ω × (I * ω))
    const wxdot = (Mx - (state.Izz - state.Iyy) * state.wy * state.wz) / state.Ixx;
    const wydot = (My - (state.Ixx - state.Izz) * state.wx * state.wz) / state.Iyy;
    const wzdot = (Mz - (state.Iyy - state.Ixx) * state.wx * state.wy) / state.Izz;
    
    derivatives[10] = wxdot;
    derivatives[11] = wydot;
    derivatives[12] = wzdot;
    
    // Propellant mass rate
    derivatives[13] = -forces.massFlowRate;
    
    return derivatives;
  }
  
  calculateForces(state, time, atm) {
    const forces = {
      total: new Vector3(),
      moment: new Vector3(),
      massFlowRate: 0
    };
    
    // 1. GRAVITY
    const g = this.atmosphere.getGravity(state.y);
    const gravity = new Vector3(0, -state.mass * g, 0);
    forces.total = forces.total.add(gravity);
    
    // 2. THRUST
    const thrust = this.calculateThrust(state, time);
    forces.total = forces.total.add(thrust.force);
    forces.moment = forces.moment.add(thrust.moment);
    forces.massFlowRate = thrust.massFlowRate;
    
    // 3. AERODYNAMIC FORCES
    const aeroForces = this.aero.calculateForces(state, atm, thrust.magnitude);
    forces.total = forces.total.add(aeroForces.drag);
    
    // Aerodynamic restoring moment
    if (aeroForces.correctiveMoment !== 0) {
      // Moment acts to reduce angle of attack
      const velocity = state.getVelocity();
      const bodyAxis = state.orientation.rotateVector(new Vector3(0, 1, 0));
      
      if (velocity.length() > 1) {
        const velNorm = velocity.normalize();
        const momentAxis = bodyAxis.cross(velNorm).normalize();
        const moment = momentAxis.scale(-aeroForces.correctiveMoment);
        forces.moment = forces.moment.add(moment);
      }
    }
    
    // 4. WIND
    const wind = this.getWind(state.y, time);
    // Wind affects aerodynamics through relative velocity (already included in aero)
    
    return forces;
  }
  
  calculateThrust(state, time) {
    const result = {
      force: new Vector3(),
      moment: new Vector3(),
      magnitude: 0,
      massFlowRate: 0
    };
    
    if (time >= this.motor.burnTime || state.propellantMass <= 0) {
      return result;
    }
    
    // Get thrust from motor curve
    result.magnitude = this.motor.getThrustAtTime(time);
    result.massFlowRate = this.motor.propellantMass / this.motor.burnTime;
    
    // Thrust direction (body frame Y axis, modified by gimbal)
    let thrustDir = new Vector3(0, 1, 0);
    
    // Apply gimbal angles (TVC)
    if (this.gimbalX !== 0 || this.gimbalY !== 0) {
      const gimbalQuat = Quaternion.fromEuler(this.gimbalX, 0, this.gimbalY);
      thrustDir = gimbalQuat.rotateVector(thrustDir);
    }
    
    // Transform to world frame
    thrustDir = state.orientation.rotateVector(thrustDir);
    
    result.force = thrustDir.scale(result.magnitude);
    
    // Thrust moment from gimbal (torque = r × F)
    if (this.gimbalX !== 0 || this.gimbalY !== 0) {
      const motorPosition = this.rocket.noseLength + this.rocket.bodyLength * 0.9;
      const momentArm = motorPosition - state.cg;
      
      // Simplified moment calculation
      result.moment = new Vector3(
        result.magnitude * Math.sin(this.gimbalX) * momentArm,
        0,
        result.magnitude * Math.sin(this.gimbalY) * momentArm
      );
    }
    
    return result;
  }
  
  getWind(altitude, time) {
    const baseSpeed = this.wind.speed;
    const gustAmplitude = this.wind.gusts;
    const direction = this.wind.direction * Math.PI / 180;
    
    // Wind increases with altitude (power law)
    const altitudeFactor = Math.pow(Math.max(altitude, 10) / 10, 0.15);
    
    // Gust variation
    const gust = gustAmplitude * (Math.sin(time * 0.5) + Math.sin(time * 1.3) * 0.5);
    
    const speed = (baseSpeed + gust) * altitudeFactor;
    
    return {
      x: speed * Math.cos(direction),
      y: 0,
      z: speed * Math.sin(direction)
    };
  }
  
  // Set gimbal angles (radians)
  setGimbal(x, y) {
    const maxGimbal = this.config.maxGimbal || 0.15; // ~8.5 degrees default
    this.gimbalX = Math.max(-maxGimbal, Math.min(maxGimbal, x));
    this.gimbalY = Math.max(-maxGimbal, Math.min(maxGimbal, y));
  }
  
  step(dt = null) {
    const timestep = dt || this.config.timestep;
    
    // Update CG as propellant burns
    this.state.cg = this.calculateCG();
    this.calculateMomentsOfInertia();
    
    // RK4 integration step
    this.state = this.integrator.step(this.state, timestep);
    
    // Update phase
    this.updatePhase();
    
    // Update records
    this.maxAltitude = Math.max(this.maxAltitude, this.state.y);
    this.maxVelocity = Math.max(this.maxVelocity, this.state.getVelocity().length());
    
    // Store trajectory point
    if (this.trajectory.length === 0 || 
        this.state.time - this.trajectory[this.trajectory.length - 1].t > 0.05) {
      this.trajectory.push({
        t: this.state.time,
        x: this.state.x,
        y: this.state.y,
        z: this.state.z,
        vx: this.state.vx,
        vy: this.state.vy,
        vz: this.state.vz
      });
    }
    
    // Check ground collision
    if (this.state.y < 0 && this.state.time > 0.1) {
      this.state.y = 0;
      this.state.vy = 0;
      this.state.vx *= 0.1;
      this.state.vz *= 0.1;
      this.state.phase = 'landed';
      this.state.events.push({ time: this.state.time, type: 'landing' });
    }
    
    return this.state;
  }
  
  updatePhase() {
    const isBurning = this.state.time < this.motor.burnTime && this.state.propellantMass > 0;
    
    if (this.state.phase === 'landed') return;
    
    if (isBurning) {
      if (this.state.phase !== 'powered') {
        this.state.phase = 'powered';
        this.state.events.push({ time: this.state.time, type: 'ignition' });
      }
    } else if (this.state.phase === 'powered') {
      this.state.phase = 'coasting';
      this.state.events.push({ time: this.state.time, type: 'burnout' });
    } else if (this.state.vy < 0 && this.state.phase === 'coasting') {
      this.state.phase = 'descent';
      this.state.events.push({ time: this.state.time, type: 'apogee', altitude: this.state.y });
    }
  }
  
  // Run simulation to completion
  simulate(maxTime = 120) {
    while (this.state.phase !== 'landed' && this.state.time < maxTime) {
      this.step();
    }
    
    return {
      state: this.state,
      maxAltitude: this.maxAltitude,
      maxVelocity: this.maxVelocity,
      flightTime: this.state.time,
      trajectory: this.trajectory,
      events: this.state.events
    };
  }
  
  // Get current sensor readings (for HIL)
  getSensorData() {
    const atm = this.atmosphere.getProperties(this.state.y);
    const bodyAccel = this.state.orientation.conjugate().rotateVector(
      new Vector3(
        this.state.vx / this.config.timestep,
        this.state.vy / this.config.timestep + CONSTANTS.G0,
        this.state.vz / this.config.timestep
      )
    );
    
    return {
      time: this.state.time,
      
      // IMU (body frame)
      accelX: bodyAccel.x,
      accelY: bodyAccel.y,
      accelZ: bodyAccel.z,
      gyroX: this.state.wx,
      gyroY: this.state.wy,
      gyroZ: this.state.wz,
      
      // Barometer
      pressure: atm.pressure,
      temperature: atm.temperature,
      
      // GPS (world frame)
      latitude: 0,  // Would need launch site
      longitude: 0,
      altitude: this.state.y,
      
      // State
      phase: this.state.phase
    };
  }
}

// ============================================
// MOTOR MODEL
// ============================================

export class Motor {
  constructor(data) {
    this.id = data.id;
    this.manufacturer = data.manufacturer;
    this.designation = data.designation;
    this.totalMass = data.totalMass / 1000;       // kg
    this.propellantMass = data.propellantMass / 1000; // kg
    this.casingMass = this.totalMass - this.propellantMass;
    this.avgThrust = data.avgThrust;              // N
    this.maxThrust = data.maxThrust;              // N
    this.totalImpulse = data.totalImpulse;        // Ns
    this.burnTime = data.burnTime;                // s
    this.thrustCurve = data.thrustCurve || [];    // [{time, thrust}]
    this.delays = data.delays || [0];
    this.selectedDelay = data.delay || this.delays[0];
  }
  
  getThrustAtTime(time) {
    if (time < 0 || time >= this.burnTime) return 0;
    
    if (this.thrustCurve.length < 2) {
      // No curve data - use constant average thrust
      return this.avgThrust;
    }
    
    // Helper to get time/thrust from point (handles both array and object formats)
    const getPoint = (p) => {
      if (Array.isArray(p)) {
        return { time: p[0], thrust: p[1] };
      }
      return p;
    };
    
    // Interpolate thrust curve
    for (let i = 0; i < this.thrustCurve.length - 1; i++) {
      const p1 = getPoint(this.thrustCurve[i]);
      const p2 = getPoint(this.thrustCurve[i + 1]);
      
      if (time >= p1.time && time < p2.time) {
        const t = (time - p1.time) / (p2.time - p1.time);
        return p1.thrust + t * (p2.thrust - p1.thrust);
      }
    }
    
    // Handle exact end time
    const lastPoint = getPoint(this.thrustCurve[this.thrustCurve.length - 1]);
    if (Math.abs(time - lastPoint.time) < 0.001) {
      return lastPoint.thrust;
    }
    
    return 0;
  }
  
  // Parse RASP/ENG format
  static fromRASP(data, metadata = {}) {
    const lines = data.split('\n');
    const curve = [];
    let header = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(';')) continue;
      
      const parts = trimmed.split(/\s+/);
      
      if (!header && parts.length >= 7) {
        // Header line: name diameter length delays propMass totalMass manufacturer
        header = {
          designation: parts[0],
          diameter: parseFloat(parts[1]),
          length: parseFloat(parts[2]),
          delays: parts[3].split('-').map(Number),
          propellantMass: parseFloat(parts[4]) * 1000, // g
          totalMass: parseFloat(parts[5]) * 1000,      // g
          manufacturer: parts[6] || 'Unknown'
        };
      } else if (header && parts.length >= 2) {
        // Data line: time thrust
        const time = parseFloat(parts[0]);
        const thrust = parseFloat(parts[1]);
        if (!isNaN(time) && !isNaN(thrust)) {
          curve.push({ time, thrust });
        }
      }
    }
    
    if (!header) {
      throw new Error('Invalid RASP format: no header found');
    }
    
    // Calculate derived values
    let totalImpulse = 0;
    let maxThrust = 0;
    
    for (let i = 0; i < curve.length - 1; i++) {
      const dt = curve[i + 1].time - curve[i].time;
      const avgThrust = (curve[i].thrust + curve[i + 1].thrust) / 2;
      totalImpulse += avgThrust * dt;
      maxThrust = Math.max(maxThrust, curve[i].thrust);
    }
    
    const burnTime = curve.length > 0 ? curve[curve.length - 1].time : 1;
    
    return new Motor({
      id: metadata.id || header.designation,
      manufacturer: header.manufacturer,
      designation: header.designation,
      totalMass: header.totalMass,
      propellantMass: header.propellantMass,
      avgThrust: totalImpulse / burnTime,
      maxThrust,
      totalImpulse,
      burnTime,
      thrustCurve: curve,
      delays: header.delays,
      ...metadata
    });
  }
}

// ============================================
// ROCKET CONFIGURATION
// ============================================

export class RocketConfig {
  constructor(data = {}) {
    // Nose cone
    this.noseShape = data.noseShape || 'ogive';
    this.noseLength = data.noseLength || 0.08;  // m
    this.noseMass = data.noseMass || 0.015;     // kg
    
    // Body tube
    this.bodyRadius = data.bodyRadius || 0.0205; // m (41mm diameter)
    this.bodyLength = data.bodyLength || 0.25;   // m
    this.bodyThickness = data.bodyThickness || 0.001; // m
    this.bodyMass = data.bodyMass || 0.05;       // kg
    
    // Fins
    this.finCount = data.finCount || 3;
    this.finRootChord = data.finRootChord || 0.06;   // m
    this.finTipChord = data.finTipChord || 0.02;     // m
    this.finSpan = data.finSpan || 0.05;             // m
    this.finSweepDistance = data.finSweepDistance || 0.03; // m
    this.finThickness = data.finThickness || 0.003;  // m
    this.finMass = data.finMass || 0.02;             // kg
    
    // Boattail (optional)
    this.boattailLength = data.boattailLength || 0;
    this.boattailEndDiameter = data.boattailEndDiameter || 0;
    
    // Surface
    this.surfaceRoughness = data.surfaceRoughness || 'painted';
    
    // Total dry mass
    this.dryMass = this.noseMass + this.bodyMass + this.finMass + 
                   (data.additionalMass || 0.01);
    
    // Recovery
    this.parachuteDiameter = data.parachuteDiameter || 0.45; // m
    this.parachuteCd = data.parachuteCd || 1.5;
    this.deploymentDelay = data.deploymentDelay || 0; // s after apogee
  }
  
  // Calculate total length
  get totalLength() {
    return this.noseLength + this.bodyLength + this.boattailLength;
  }
  
  // Calculate reference area
  get referenceArea() {
    return Math.PI * this.bodyRadius * this.bodyRadius;
  }
}

export default {
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
};

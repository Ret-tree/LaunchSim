/**
 * LAUNCHSIM CP/CG Stability Analysis
 * ===================================
 * 
 * Calculates Center of Pressure (CP) and Center of Gravity (CG) for rocket stability analysis.
 * Uses the Barrowman equations for subsonic CP estimation.
 * 
 * Stability margin is expressed in calibers (body diameters):
 * - < 1.0 calibers: Unstable (will tumble)
 * - 1.0 - 1.5 calibers: Marginally stable
 * - 1.5 - 2.5 calibers: Ideal stability
 * - > 2.5 calibers: Over-stable (weathercocks)
 * 
 * References:
 * - Barrowman, J.S. "The Practical Calculation of the Aerodynamic Characteristics 
 *   of Slender Finned Vehicles" (1967)
 * - Stine, G.H. "Handbook of Model Rocketry"
 * - OpenRocket Technical Documentation
 * 
 * Usage:
 *   const analysis = new StabilityAnalysis(rocketConfig);
 *   const result = analysis.calculate();
 */

// Debug mode
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[Stability]', ...args),
  warn: (...args) => console.warn('[Stability]', ...args),
  error: (...args) => console.error('[Stability]', ...args)
};

// ============================================
// Constants
// ============================================

const MM_TO_M = 0.001;
const M_TO_MM = 1000;
const INCH_TO_MM = 25.4;
const MM_TO_INCH = 1 / 25.4;

// Nose cone CN (normal force coefficient) for subsonic flow
// These are approximations; actual values depend on Mach number
const NOSE_CN_ALPHA = 2.0; // Per radian, for all nose shapes at subsonic speeds

// ============================================
// Nose Cone Aerodynamics (Barrowman)
// ============================================

class NoseConeAero {
  /**
   * Calculate nose cone aerodynamic properties
   * 
   * @param {Object} nose - Nose cone parameters
   * @param {string} nose.shape - Shape type (ogive, conical, elliptical, vonKarman, etc.)
   * @param {number} nose.length - Length in mm
   * @param {number} nose.diameter - Base diameter in mm
   * @returns {Object} { cn_alpha, cp_from_nose }
   */
  static calculate(nose) {
    const L = nose.length;
    const d = nose.diameter;
    
    // CN_alpha is approximately 2 for all nose shapes at subsonic speeds
    const cn_alpha = NOSE_CN_ALPHA;
    
    // CP location depends on shape
    // Expressed as fraction of nose length from tip
    let cpFraction;
    
    switch (nose.shape?.toLowerCase()) {
      case 'conical':
      case 'cone':
        // CP at 2/3 of length from tip
        cpFraction = 2/3;
        break;
        
      case 'ogive':
      case 'tangent_ogive':
        // CP at approximately 0.466 of length from tip
        cpFraction = 0.466;
        break;
        
      case 'elliptical':
      case 'ellipsoid':
        // CP at approximately 0.5 of length from tip
        cpFraction = 0.5;
        break;
        
      case 'vonkarman':
      case 'von_karman':
      case 'haack':
        // CP at approximately 0.5 of length from tip
        cpFraction = 0.5;
        break;
        
      case 'parabolic':
        // CP at approximately 0.5 of length from tip
        cpFraction = 0.5;
        break;
        
      case 'power':
      case 'power_series':
        // Depends on power coefficient, use 0.5 as default
        cpFraction = 0.5;
        break;
        
      case 'blunted':
      case 'spherical':
        // CP at approximately 0.4 of length from tip
        cpFraction = 0.4;
        break;
        
      default:
        // Default to ogive approximation
        cpFraction = 0.466;
    }
    
    const cp_from_nose = L * cpFraction;
    
    return {
      cn_alpha,
      cp_from_nose,
      reference_area: Math.PI * Math.pow(d / 2, 2), // mm²
      shape: nose.shape,
      length: L,
      diameter: d
    };
  }
}

// ============================================
// Body Tube Aerodynamics
// ============================================

class BodyTubeAero {
  /**
   * Calculate body tube aerodynamic contribution
   * 
   * For a cylindrical body tube with no diameter change,
   * the normal force coefficient contribution is zero in subsonic flow.
   * The body tube primarily contributes to reference area and drag.
   * 
   * @param {Object} tube - Body tube parameters
   * @returns {Object} { cn_alpha, cp_from_front }
   */
  static calculate(tube) {
    // Cylindrical body tubes have CN_alpha ≈ 0 in subsonic flow
    // (no lift generation from constant-diameter cylinder)
    return {
      cn_alpha: 0,
      cp_from_front: tube.length / 2, // Doesn't matter since CN is 0
      length: tube.length,
      diameter: tube.diameter
    };
  }
}

// ============================================
// Transition/Boat Tail Aerodynamics
// ============================================

class TransitionAero {
  /**
   * Calculate transition (shoulder/boat tail) aerodynamic properties
   * 
   * Barrowman equation for transition:
   * CN_alpha = 2 * [(d2/d1)² - 1]
   * 
   * @param {Object} trans - Transition parameters
   * @param {number} trans.foreDiameter - Forward diameter (mm)
   * @param {number} trans.aftDiameter - Aft diameter (mm)
   * @param {number} trans.length - Transition length (mm)
   * @param {number} trans.position - Position from nose (mm)
   * @returns {Object} { cn_alpha, cp_from_nose }
   */
  static calculate(trans) {
    const d1 = trans.foreDiameter;
    const d2 = trans.aftDiameter;
    const L = trans.length;
    const pos = trans.position;
    
    // CN_alpha for transition
    const cn_alpha = 2 * (Math.pow(d2 / d1, 2) - 1);
    
    // CP location for transition (from front of transition)
    // CP is at centroid of the frustum
    const cpFromFront = L * (1/3) * (1 + (d2/d1) + Math.pow(d2/d1, 2)) / 
                        (1 + (d2/d1));
    
    const cp_from_nose = pos + cpFromFront;
    
    return {
      cn_alpha,
      cp_from_nose,
      cp_from_front: cpFromFront,
      foreDiameter: d1,
      aftDiameter: d2,
      length: L,
      position: pos
    };
  }
}

// ============================================
// Fin Aerodynamics (Barrowman)
// ============================================

class FinAero {
  /**
   * Calculate fin set aerodynamic properties using Barrowman equations
   * 
   * Barrowman fin CN_alpha equation:
   * CN_alpha = (4*n*(S/Sref)*(K)) / (1 + sqrt(1 + (2*L_f/(Cr+Ct))²))
   * 
   * Where K is the interference factor ≈ 1 + R/(S + R)
   * 
   * @param {Object} fins - Fin parameters
   * @param {number} fins.count - Number of fins (3, 4, 6)
   * @param {number} fins.rootChord - Root chord (mm)
   * @param {number} fins.tipChord - Tip chord (mm)
   * @param {number} fins.span - Semi-span from body (mm)
   * @param {number} fins.sweepDistance - Leading edge sweep distance (mm)
   * @param {number} fins.position - Position of fin root leading edge from nose (mm)
   * @param {number} fins.bodyRadius - Body tube radius at fin location (mm)
   * @returns {Object} { cn_alpha, cp_from_nose }
   */
  static calculate(fins) {
    const n = fins.count;
    const Cr = fins.rootChord;
    const Ct = fins.tipChord;
    const S = fins.span; // Semi-span
    const sweep = fins.sweepDistance || 0;
    const pos = fins.position;
    const R = fins.bodyRadius;
    
    // Reference area (body cross-section at fin location)
    const Sref = Math.PI * R * R;
    
    // Fin planform area (one fin)
    const Sfin = (Cr + Ct) * S / 2;
    
    // Mid-chord sweep length
    const Lf = Math.sqrt(Math.pow(S, 2) + Math.pow(sweep + (Ct - Cr) / 2, 2));
    
    // Aspect ratio
    const AR = (2 * S * S) / Sfin;
    
    // Interference factor (fin-body interference)
    // K = 1 + R/(S + R) for subsonic flow
    const K = 1 + R / (S + R);
    
    // Barrowman CN_alpha for fin set
    const denominator = 1 + Math.sqrt(1 + Math.pow((2 * Lf) / (Cr + Ct), 2));
    const cn_alpha = (4 * n * (Sfin / Sref) * K) / denominator;
    
    // CP location for fins (from fin root leading edge)
    // Using Barrowman's fin CP equation
    const m = (Cr - Ct) / (2 * S); // Taper gradient
    const X_f = (sweep / 3) * (Cr + 2*Ct) / (Cr + Ct) + 
                (1/6) * (Cr + Ct - (Cr * Ct) / (Cr + Ct));
    
    // Simplified CP calculation
    const cpFromRoot = (sweep * (Cr + 2*Ct) / (3 * (Cr + Ct))) + 
                       ((Cr + Ct) / 2) * (1/3) * (1 + Ct/(Cr + Ct));
    
    const cp_from_nose = pos + cpFromRoot;
    
    return {
      cn_alpha,
      cp_from_nose,
      cp_from_root: cpFromRoot,
      count: n,
      rootChord: Cr,
      tipChord: Ct,
      span: S,
      sweepDistance: sweep,
      position: pos,
      aspectRatio: AR,
      interferenceK: K,
      finArea: Sfin
    };
  }
}

// ============================================
// CG Calculation
// ============================================

class CGCalculator {
  /**
   * Calculate center of gravity from component masses and positions
   * 
   * @param {Array} components - Array of { mass, position, length }
   * @returns {Object} { cg, totalMass }
   */
  static calculate(components) {
    let totalMass = 0;
    let momentSum = 0;
    
    for (const comp of components) {
      const mass = comp.mass || 0;
      // CG of component (position + half length if length given)
      const compCG = comp.position + (comp.length || 0) / 2;
      
      totalMass += mass;
      momentSum += mass * compCG;
    }
    
    if (totalMass === 0) {
      return { cg: 0, totalMass: 0 };
    }
    
    return {
      cg: momentSum / totalMass,
      totalMass
    };
  }
  
  /**
   * Calculate CG from rocket configuration
   * 
   * @param {Object} rocket - Rocket configuration
   * @param {Object} motor - Motor configuration (optional)
   * @returns {Object} { cg, totalMass, components }
   */
  static fromRocket(rocket, motor = null) {
    const components = [];
    let position = 0;
    
    // Nose cone
    if (rocket.noseLength && rocket.noseDiameter) {
      // Estimate nose mass (if not provided)
      const noseVolume = (1/3) * Math.PI * Math.pow(rocket.noseDiameter/2, 2) * rocket.noseLength;
      const noseDensity = rocket.noseDensity || 0.0012; // g/mm³ (light plastic)
      const noseMass = rocket.noseMass || (noseVolume * noseDensity);
      
      components.push({
        name: 'Nose Cone',
        mass: noseMass,
        position: 0,
        length: rocket.noseLength,
        cg: rocket.noseLength * 0.4 // Approximate CG at 40% from tip
      });
      
      position = rocket.noseLength;
    }
    
    // Shoulder (if present)
    if (rocket.shoulderLength) {
      components.push({
        name: 'Shoulder',
        mass: rocket.shoulderMass || 5,
        position: position,
        length: rocket.shoulderLength,
        cg: position + rocket.shoulderLength / 2
      });
      position += rocket.shoulderLength;
    }
    
    // Body tube
    if (rocket.bodyLength && rocket.bodyDiameter) {
      // Estimate body tube mass
      const wallThickness = rocket.bodyWallThickness || 1; // mm
      const outerRadius = rocket.bodyDiameter / 2;
      const innerRadius = outerRadius - wallThickness;
      const tubeVolume = Math.PI * (Math.pow(outerRadius, 2) - Math.pow(innerRadius, 2)) * rocket.bodyLength;
      const tubeDensity = rocket.bodyDensity || 0.0013; // g/mm³ (kraft paper tube)
      const tubeMass = rocket.bodyMass || (tubeVolume * tubeDensity);
      
      components.push({
        name: 'Body Tube',
        mass: tubeMass,
        position: position,
        length: rocket.bodyLength,
        cg: position + rocket.bodyLength / 2
      });
    }
    
    // Fins
    if (rocket.finCount && rocket.finRootChord && rocket.finSpan) {
      // Estimate fin mass
      const finThickness = rocket.finThickness || 3; // mm
      const finArea = (rocket.finRootChord + (rocket.finTipChord || 0)) * rocket.finSpan / 2;
      const finVolume = finArea * finThickness;
      const finDensity = rocket.finDensity || 0.0007; // g/mm³ (balsa/plywood)
      const finMass = rocket.finMass || (finVolume * finDensity * rocket.finCount);
      
      // Fin position (from rocket config or calculate)
      const finPosition = rocket.finPosition || 
        (position + rocket.bodyLength - rocket.finRootChord - 10);
      
      // Fin CG (approximate)
      const finCG = finPosition + rocket.finRootChord * 0.4;
      
      components.push({
        name: 'Fins',
        mass: finMass,
        position: finPosition,
        length: rocket.finRootChord,
        cg: finCG
      });
    }
    
    // Recovery system (parachute, shock cord, etc.)
    const recoveryMass = rocket.recoveryMass || rocket.dryMass * 0.1 || 10;
    const recoveryPosition = rocket.recoveryPosition || 
      (rocket.noseLength || 0) + ((rocket.bodyLength || 0) * 0.3);
    
    components.push({
      name: 'Recovery',
      mass: recoveryMass,
      position: recoveryPosition,
      length: 50,
      cg: recoveryPosition + 25
    });
    
    // Motor (if provided)
    if (motor) {
      const motorPosition = rocket.motorPosition || 
        (position + rocket.bodyLength - (motor.length || 100));
      const motorMass = motor.totalMass || motor.mass || 50;
      
      components.push({
        name: 'Motor',
        mass: motorMass,
        position: motorPosition,
        length: motor.length || 100,
        cg: motorPosition + (motor.length || 100) / 2
      });
    }
    
    // Additional mass (payload, electronics, etc.)
    if (rocket.payloadMass) {
      const payloadPosition = rocket.payloadPosition || (rocket.noseLength || 0) + 20;
      components.push({
        name: 'Payload',
        mass: rocket.payloadMass,
        position: payloadPosition,
        length: 30,
        cg: payloadPosition + 15
      });
    }
    
    // If dry mass is provided, use it to scale/adjust
    if (rocket.dryMass) {
      const calculatedDryMass = components
        .filter(c => c.name !== 'Motor')
        .reduce((sum, c) => sum + c.mass, 0);
      
      if (calculatedDryMass > 0) {
        const scaleFactor = rocket.dryMass / calculatedDryMass;
        components.forEach(c => {
          if (c.name !== 'Motor') {
            c.mass *= scaleFactor;
          }
        });
      }
    }
    
    // Calculate total CG
    let totalMass = 0;
    let momentSum = 0;
    
    for (const comp of components) {
      totalMass += comp.mass;
      momentSum += comp.mass * comp.cg;
    }
    
    return {
      cg: totalMass > 0 ? momentSum / totalMass : 0,
      totalMass,
      components
    };
  }
}

// ============================================
// Main Stability Analysis Class
// ============================================

class StabilityAnalysis {
  /**
   * Create stability analysis for a rocket
   * 
   * @param {Object} rocket - Rocket configuration
   * @param {Object} [motor] - Motor configuration
   */
  constructor(rocket, motor = null) {
    this.rocket = rocket;
    this.motor = motor;
    this.results = null;
  }
  
  /**
   * Calculate CP, CG, and stability margin
   * 
   * @returns {Object} Complete stability analysis results
   */
  calculate() {
    const rocket = this.rocket;
    
    // Reference diameter (body diameter)
    const refDiameter = rocket.bodyDiameter || rocket.noseDiameter || 41;
    const refArea = Math.PI * Math.pow(refDiameter / 2, 2);
    
    // Calculate aerodynamic contributions
    const aeroComponents = [];
    let totalCN = 0;
    let cpMomentSum = 0;
    let position = 0;
    
    // 1. Nose cone
    if (rocket.noseLength && rocket.noseDiameter) {
      const noseAero = NoseConeAero.calculate({
        shape: rocket.noseShape || 'ogive',
        length: rocket.noseLength,
        diameter: rocket.noseDiameter
      });
      
      aeroComponents.push({
        name: 'Nose Cone',
        type: 'nose',
        cn_alpha: noseAero.cn_alpha,
        cp: noseAero.cp_from_nose,
        ...noseAero
      });
      
      totalCN += noseAero.cn_alpha;
      cpMomentSum += noseAero.cn_alpha * noseAero.cp_from_nose;
      
      position = rocket.noseLength;
    }
    
    // 2. Body tube (CN ≈ 0, but track position)
    if (rocket.bodyLength) {
      const bodyAero = BodyTubeAero.calculate({
        length: rocket.bodyLength,
        diameter: rocket.bodyDiameter || refDiameter
      });
      
      aeroComponents.push({
        name: 'Body Tube',
        type: 'body',
        cn_alpha: 0,
        cp: position + bodyAero.cp_from_front,
        position: position,
        ...bodyAero
      });
      
      // Body tube doesn't contribute to CP calculation
    }
    
    // 3. Transitions (if any)
    if (rocket.transitions && rocket.transitions.length > 0) {
      for (const trans of rocket.transitions) {
        const transAero = TransitionAero.calculate(trans);
        
        aeroComponents.push({
          name: 'Transition',
          type: 'transition',
          cn_alpha: transAero.cn_alpha,
          cp: transAero.cp_from_nose,
          ...transAero
        });
        
        totalCN += transAero.cn_alpha;
        cpMomentSum += transAero.cn_alpha * transAero.cp_from_nose;
      }
    }
    
    // 4. Fins
    if (rocket.finCount && rocket.finRootChord && rocket.finSpan) {
      // Calculate fin position if not provided
      const totalLength = (rocket.noseLength || 0) + (rocket.bodyLength || 0);
      const finPosition = rocket.finPosition || 
        (totalLength - rocket.finRootChord - 10);
      
      const finAero = FinAero.calculate({
        count: rocket.finCount,
        rootChord: rocket.finRootChord,
        tipChord: rocket.finTipChord || 0,
        span: rocket.finSpan,
        sweepDistance: rocket.finSweep || 0,
        position: finPosition,
        bodyRadius: (rocket.bodyDiameter || refDiameter) / 2
      });
      
      aeroComponents.push({
        name: 'Fins',
        type: 'fins',
        cn_alpha: finAero.cn_alpha,
        cp: finAero.cp_from_nose,
        ...finAero
      });
      
      totalCN += finAero.cn_alpha;
      cpMomentSum += finAero.cn_alpha * finAero.cp_from_nose;
    }
    
    // Calculate total CP
    const cp = totalCN > 0 ? cpMomentSum / totalCN : 0;
    
    // Calculate CG
    const cgResult = CGCalculator.fromRocket(rocket, this.motor);
    const cg = cgResult.cg;
    const totalMass = cgResult.totalMass;
    
    // Calculate stability margin
    const stabilityMargin = cp - cg; // mm (positive = stable)
    const stabilityCalibers = stabilityMargin / refDiameter;
    
    // Determine stability status
    const { status, severity, recommendation } = this.assessStability(stabilityCalibers);
    
    // Total rocket length
    const totalLength = (rocket.noseLength || 0) + (rocket.bodyLength || 0);
    
    this.results = {
      // Primary results
      cp,
      cg,
      stabilityMargin,
      stabilityCalibers,
      
      // Status
      status,
      severity,
      recommendation,
      
      // Detailed data
      totalCN_alpha: totalCN,
      refDiameter,
      refArea,
      totalLength,
      totalMass,
      
      // Components
      aeroComponents,
      massComponents: cgResult.components,
      
      // Formatted values
      cpFromNose: cp,
      cgFromNose: cg,
      cpPercent: (cp / totalLength) * 100,
      cgPercent: (cg / totalLength) * 100
    };
    
    return this.results;
  }
  
  /**
   * Assess stability and provide recommendations
   */
  assessStability(calibers) {
    if (calibers < 0.5) {
      return {
        status: 'UNSTABLE',
        severity: 'danger',
        recommendation: 'DANGER: Rocket is unstable and will tumble. Move CG forward (add nose weight) or move CP back (larger/more swept fins).'
      };
    } else if (calibers < 1.0) {
      return {
        status: 'MARGINALLY UNSTABLE',
        severity: 'danger',
        recommendation: 'Rocket is marginally unstable. Add nose weight or increase fin size. Do not fly in current configuration.'
      };
    } else if (calibers < 1.5) {
      return {
        status: 'MARGINALLY STABLE',
        severity: 'warning',
        recommendation: 'Rocket is marginally stable. Consider adding nose weight for improved stability margin, especially for windy conditions.'
      };
    } else if (calibers < 2.0) {
      return {
        status: 'STABLE',
        severity: 'safe',
        recommendation: 'Good stability margin. Rocket should fly straight and true.'
      };
    } else if (calibers < 2.5) {
      return {
        status: 'VERY STABLE',
        severity: 'safe',
        recommendation: 'Excellent stability margin. Ideal for most flying conditions.'
      };
    } else if (calibers < 3.5) {
      return {
        status: 'OVER-STABLE',
        severity: 'caution',
        recommendation: 'Rocket may weathercock (turn into wind) excessively. Consider reducing fin size or moving CG back for better wind performance.'
      };
    } else {
      return {
        status: 'SEVERELY OVER-STABLE',
        severity: 'warning',
        recommendation: 'Rocket will weathercock significantly. Reduce stability margin for better flight performance.'
      };
    }
  }
  
  /**
   * Calculate weight needed to achieve target stability
   * 
   * @param {number} targetCalibers - Target stability in calibers
   * @param {number} weightPosition - Position to add weight (mm from nose)
   * @returns {Object} { weightNeeded, newCG, newStability }
   */
  calculateWeightForStability(targetCalibers, weightPosition = 20) {
    if (!this.results) {
      this.calculate();
    }
    
    const { cp, cg, refDiameter, totalMass } = this.results;
    const targetMargin = targetCalibers * refDiameter;
    const targetCG = cp - targetMargin;
    
    // If CG already meets or exceeds target, no weight needed
    if (cg <= targetCG) {
      return {
        weightNeeded: 0,
        newCG: cg,
        newStability: this.results.stabilityCalibers,
        message: 'No additional weight needed'
      };
    }
    
    // Calculate weight needed at given position
    // New CG = (totalMass * cg + addedMass * weightPosition) / (totalMass + addedMass)
    // Solve for addedMass:
    // targetCG * (totalMass + addedMass) = totalMass * cg + addedMass * weightPosition
    // targetCG * totalMass + targetCG * addedMass = totalMass * cg + addedMass * weightPosition
    // targetCG * addedMass - addedMass * weightPosition = totalMass * cg - targetCG * totalMass
    // addedMass * (targetCG - weightPosition) = totalMass * (cg - targetCG)
    // addedMass = totalMass * (cg - targetCG) / (targetCG - weightPosition)
    
    const weightNeeded = totalMass * (cg - targetCG) / (targetCG - weightPosition);
    
    if (weightNeeded < 0 || !isFinite(weightNeeded)) {
      return {
        weightNeeded: 0,
        newCG: cg,
        newStability: this.results.stabilityCalibers,
        message: 'Cannot achieve target stability at this weight position'
      };
    }
    
    const newTotalMass = totalMass + weightNeeded;
    const newCG = (totalMass * cg + weightNeeded * weightPosition) / newTotalMass;
    const newStability = (cp - newCG) / refDiameter;
    
    return {
      weightNeeded,
      newCG,
      newStability,
      newTotalMass,
      weightPosition,
      message: `Add ${weightNeeded.toFixed(1)}g at ${weightPosition}mm from nose`
    };
  }
  
  /**
   * Calculate fin size needed for target stability
   * 
   * @param {number} targetCalibers - Target stability in calibers
   * @returns {Object} { finSizeMultiplier, newSpan, newCP }
   */
  calculateFinSizeForStability(targetCalibers) {
    if (!this.results) {
      this.calculate();
    }
    
    // This is a simplified calculation
    // In reality, fin size affects CP non-linearly
    
    const { cg, refDiameter, stabilityCalibers, aeroComponents } = this.results;
    const finComp = aeroComponents.find(c => c.type === 'fins');
    
    if (!finComp) {
      return {
        message: 'No fins defined'
      };
    }
    
    const currentCalibers = stabilityCalibers;
    const calibersNeeded = targetCalibers - currentCalibers;
    
    if (calibersNeeded <= 0) {
      return {
        finSizeMultiplier: 1.0,
        newSpan: finComp.span,
        message: 'Current fin size is adequate'
      };
    }
    
    // Rough approximation: 20% more span ≈ 0.3 calibers more stability
    const spanMultiplier = 1 + (calibersNeeded / 0.3) * 0.2;
    const newSpan = finComp.span * spanMultiplier;
    
    return {
      finSizeMultiplier: spanMultiplier,
      newSpan,
      currentSpan: finComp.span,
      message: `Increase fin span to ${newSpan.toFixed(1)}mm (${((spanMultiplier-1)*100).toFixed(0)}% larger)`
    };
  }
}

// ============================================
// Stability Analysis UI Component
// ============================================

class StabilityAnalysisUI {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = null;
    this.analysis = null;
    this.results = null;
    this.onAnalysis = options.onAnalysis || (() => {});
  }
  
  initialize() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      log.error(`Container ${this.containerId} not found`);
      return;
    }
    this.render();
  }
  
  render() {
    this.container.innerHTML = `
      <div class="stability-ui">
        <div class="stability-results" id="stability-results">
          <p class="placeholder">Design a rocket to see stability analysis</p>
        </div>
      </div>
    `;
  }
  
  /**
   * Update stability display with rocket configuration
   */
  update(rocket, motor = null) {
    if (!rocket) {
      this.showPlaceholder();
      return;
    }
    
    try {
      this.analysis = new StabilityAnalysis(rocket, motor);
      this.results = this.analysis.calculate();
      this.renderResults();
      this.onAnalysis(this.results);
    } catch (error) {
      log.error('Stability analysis failed:', error);
      this.showError(error.message);
    }
  }
  
  showPlaceholder() {
    const resultsEl = this.container?.querySelector('#stability-results');
    if (resultsEl) {
      resultsEl.innerHTML = '<p class="placeholder">Design a rocket to see stability analysis</p>';
    }
  }
  
  showError(message) {
    const resultsEl = this.container?.querySelector('#stability-results');
    if (resultsEl) {
      resultsEl.innerHTML = `<p class="error">Analysis error: ${message}</p>`;
    }
  }
  
  renderResults() {
    const resultsEl = this.container?.querySelector('#stability-results');
    if (!resultsEl || !this.results) return;
    
    const r = this.results;
    const statusIcon = this.getStatusIcon(r.status);
    
    resultsEl.innerHTML = `
      <div class="stability-status ${r.severity}">
        <span class="status-icon">${statusIcon}</span>
        <span class="status-text">${r.status}</span>
        <span class="status-calibers">${r.stabilityCalibers.toFixed(2)} calibers</span>
      </div>
      
      <div class="stability-diagram">
        <div class="stability-bar">
          <div class="stability-cg-marker" style="left: ${r.cgPercent}%;" title="CG: ${r.cg.toFixed(1)}mm">
            <span class="marker-label">CG</span>
          </div>
          <div class="stability-cp-marker" style="left: ${r.cpPercent}%;" title="CP: ${r.cp.toFixed(1)}mm">
            <span class="marker-label">CP</span>
          </div>
        </div>
        <div class="stability-scale">
          <span>Nose</span>
          <span>Tail</span>
        </div>
      </div>
      
      <div class="stability-values">
        <div class="stability-value">
          <span class="value-label">CG from Nose</span>
          <span class="value-number">${r.cg.toFixed(1)} mm</span>
        </div>
        <div class="stability-value">
          <span class="value-label">CP from Nose</span>
          <span class="value-number">${r.cp.toFixed(1)} mm</span>
        </div>
        <div class="stability-value">
          <span class="value-label">Margin</span>
          <span class="value-number">${r.stabilityMargin.toFixed(1)} mm</span>
        </div>
        <div class="stability-value highlight">
          <span class="value-label">Stability</span>
          <span class="value-number">${r.stabilityCalibers.toFixed(2)} cal</span>
        </div>
      </div>
      
      <div class="stability-recommendation ${r.severity}">
        ${r.recommendation}
      </div>
    `;
  }
  
  getStatusIcon(status) {
    const icons = {
      'UNSTABLE': '🛑',
      'MARGINALLY UNSTABLE': '🛑',
      'MARGINALLY STABLE': '⚠️',
      'STABLE': '✅',
      'VERY STABLE': '✅',
      'OVER-STABLE': '⚠️',
      'SEVERELY OVER-STABLE': '⚠️'
    };
    return icons[status] || '❓';
  }
}

// ============================================
// Exports
// ============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    StabilityAnalysis,
    StabilityAnalysisUI,
    CGCalculator,
    NoseConeAero,
    BodyTubeAero,
    TransitionAero,
    FinAero
  };
}

if (typeof window !== 'undefined') {
  window.StabilityAnalysis = StabilityAnalysis;
  window.StabilityAnalysisUI = StabilityAnalysisUI;
  window.CGCalculator = CGCalculator;
  window.NoseConeAero = NoseConeAero;
  window.BodyTubeAero = BodyTubeAero;
  window.TransitionAero = TransitionAero;
  window.FinAero = FinAero;
}

export { 
  StabilityAnalysis, 
  StabilityAnalysisUI,
  CGCalculator,
  NoseConeAero,
  BodyTubeAero,
  TransitionAero,
  FinAero
};

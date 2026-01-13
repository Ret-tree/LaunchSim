/**
 * LAUNCHSIM Launch Day Assistant
 * ===============================
 * 
 * Comprehensive launch day tools for field use:
 * - Go/No-Go dashboard combining all analyses
 * - Optimal launch window prediction
 * - Drift prediction and landing zone estimation
 * - Pre-flight safety checklist
 * - Waiver/altitude compliance
 * - Weather monitoring
 * 
 * This is LAUNCHSIM's key differentiator - no other simulator provides
 * integrated launch day intelligence.
 * 
 * Usage:
 *   const assistant = new LaunchDayAssistant(rocket, motor, conditions);
 *   const readiness = assistant.getReadiness();
 */

// Debug mode
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[LaunchDay]', ...args),
  warn: (...args) => console.warn('[LaunchDay]', ...args),
  error: (...args) => console.error('[LaunchDay]', ...args)
};

// ============================================
// Constants
// ============================================

const M_TO_FT = 3.28084;
const FT_TO_M = 0.3048;
const MPS_TO_MPH = 2.23694;
const MPH_TO_MPS = 0.44704;
const MPS_TO_KTS = 1.94384;

// NAR/TRA wind limits
const WIND_LIMITS = {
  model: { maxMph: 20, cautionMph: 15 },    // Model rockets
  hpr_l1: { maxMph: 20, cautionMph: 15 },   // Level 1 HPR
  hpr_l2: { maxMph: 15, cautionMph: 10 },   // Level 2 HPR  
  hpr_l3: { maxMph: 10, cautionMph: 8 }     // Level 3 HPR
};

// Standard waiver altitudes
const STANDARD_WAIVERS = {
  nar_section: { feet: 5000, agl: true },
  tra_regional: { feet: 10000, agl: true },
  faa_class_1: { feet: 3500, agl: true },
  faa_class_2: { feet: 7500, agl: true },
  faa_class_3: { feet: 12500, agl: true }
};

// Checklist categories
const CHECKLIST_CATEGORIES = {
  PRE_FLIGHT: 'pre_flight',
  ROCKET: 'rocket',
  MOTOR: 'motor',
  RECOVERY: 'recovery',
  ELECTRONICS: 'electronics',
  PAD: 'pad',
  FINAL: 'final'
};

// ============================================
// Weather Assessment
// ============================================

class WeatherAssessment {
  /**
   * Assess weather conditions for launch
   * 
   * @param {Object} weather - Weather data
   * @param {string} [rocketClass='model'] - Rocket class for limits
   */
  constructor(weather, rocketClass = 'model') {
    this.weather = weather || {};
    this.rocketClass = rocketClass;
    this.limits = WIND_LIMITS[rocketClass] || WIND_LIMITS.model;
  }
  
  /**
   * Get overall weather assessment
   */
  assess() {
    const issues = [];
    const warnings = [];
    let status = 'GO';
    let score = 100;
    
    const windMph = (this.weather.windSpeed || 0) * MPS_TO_MPH;
    const gustMph = this.weather.gustSpeed 
      ? this.weather.gustSpeed * MPS_TO_MPH 
      : windMph; // Fallback to wind speed if no gust data
    const visibility = this.weather.visibility || 10000;
    const cloudBase = this.weather.cloudBase || 10000;
    const precipitation = this.weather.precipitation || 0;
    
    // Wind check
    if (windMph > this.limits.maxMph) {
      issues.push(`Wind ${windMph.toFixed(0)} mph exceeds limit (${this.limits.maxMph} mph)`);
      status = 'NO-GO';
      score -= 40;
    } else if (windMph > this.limits.cautionMph) {
      warnings.push(`Wind ${windMph.toFixed(0)} mph approaching limit`);
      status = status === 'GO' ? 'CAUTION' : status;
      score -= 15;
    }
    
    // Gust check
    if (gustMph > this.limits.maxMph * 1.2) {
      issues.push(`Gusts ${gustMph.toFixed(0)} mph too strong`);
      status = 'NO-GO';
      score -= 25;
    } else if (gustMph > windMph * 1.5) {
      warnings.push(`Gusty conditions - ${gustMph.toFixed(0)} mph gusts`);
      score -= 10;
    }
    
    // Visibility
    if (visibility < 1000) {
      issues.push('Visibility below 1km - cannot track rocket');
      status = 'NO-GO';
      score -= 30;
    } else if (visibility < 3000) {
      warnings.push('Reduced visibility may affect tracking');
      score -= 10;
    }
    
    // Cloud base
    if (cloudBase < 500) {
      issues.push('Cloud ceiling too low');
      status = 'NO-GO';
      score -= 30;
    } else if (cloudBase < 1000) {
      warnings.push('Low clouds may obscure flight');
      score -= 15;
    }
    
    // Precipitation
    if (precipitation > 0.5) {
      issues.push('Active precipitation - no launches');
      status = 'NO-GO';
      score -= 40;
    } else if (precipitation > 0) {
      warnings.push('Light precipitation may affect recovery');
      score -= 10;
    }
    
    // Temperature extremes
    const temp = this.weather.temperature;
    if (temp !== undefined) {
      if (temp < 0) {
        warnings.push(`Cold temperature (${temp}°C) may affect motor performance`);
        score -= 5;
      } else if (temp > 35) {
        warnings.push(`Hot temperature (${temp}°C) - keep motors shaded`);
        score -= 5;
      }
    }
    
    return {
      status,
      score: Math.max(0, score),
      issues,
      warnings,
      conditions: {
        wind: { value: windMph, unit: 'mph', limit: this.limits.maxMph },
        gusts: { value: gustMph, unit: 'mph' },
        visibility: { value: visibility, unit: 'm' },
        cloudBase: { value: cloudBase, unit: 'ft' },
        temperature: { value: temp, unit: '°C' },
        precipitation: { value: precipitation, unit: 'mm/hr' }
      }
    };
  }
}

// ============================================
// Drift Predictor
// ============================================

class DriftPredictor {
  /**
   * Predict landing zone based on wind and flight profile
   * 
   * @param {Object} flightProfile - Expected flight characteristics
   * @param {Object} weather - Weather conditions
   */
  constructor(flightProfile, weather) {
    this.profile = flightProfile;
    this.weather = weather || {};
  }
  
  /**
   * Predict drift distance and direction
   * 
   * @returns {Object} Drift prediction
   */
  predict() {
    const apogee = this.profile.apogee || 1000; // feet
    const timeToApogee = this.profile.timeToApogee || 5; // seconds
    const descentTime = this.profile.descentTime || 30; // seconds
    
    const windSpeed = this.weather.windSpeed || 0; // m/s
    const windDirection = this.weather.windDirection || 0; // degrees
    
    // Boost phase drift (minimal - rocket is moving fast)
    const boostDrift = windSpeed * timeToApogee * 0.2; // 20% wind effect during boost
    
    // Coast phase drift (more effect as rocket slows)
    const coastTime = this.profile.coastTime || 2;
    const coastDrift = windSpeed * coastTime * 0.5;
    
    // Descent phase drift (full wind effect)
    // Wind typically increases with altitude, use 1.5x factor
    const avgDescentWind = windSpeed * 1.3;
    const descentDrift = avgDescentWind * descentTime;
    
    // Total drift
    const totalDrift = boostDrift + coastDrift + descentDrift;
    
    // Convert to direction
    const dirRad = windDirection * Math.PI / 180;
    const driftEast = totalDrift * Math.sin(dirRad);
    const driftNorth = totalDrift * Math.cos(dirRad);
    
    // Landing zone (from launch pad)
    return {
      distance: totalDrift,
      distanceFeet: totalDrift * M_TO_FT,
      direction: windDirection, // Rocket lands downwind
      directionCardinal: this.degreesToCardinal(windDirection),
      driftEast,
      driftNorth,
      
      // Breakdown
      boostDrift,
      coastDrift,
      descentDrift,
      
      // Confidence
      confidence: this.calculateConfidence(),
      
      // Recommended walk direction
      walkDirection: windDirection,
      walkDirectionCardinal: this.degreesToCardinal(windDirection)
    };
  }
  
  /**
   * Calculate confidence in prediction
   */
  calculateConfidence() {
    // Lower confidence with variable winds
    const gustFactor = this.weather.gustSpeed 
      ? this.weather.gustSpeed / Math.max(0.1, this.weather.windSpeed)
      : 1;
    
    let confidence = 90;
    
    if (gustFactor > 2) confidence -= 30;
    else if (gustFactor > 1.5) confidence -= 15;
    
    // Lower confidence for high altitude flights
    if (this.profile.apogee > 3000) confidence -= 10;
    if (this.profile.apogee > 5000) confidence -= 10;
    
    return Math.max(40, confidence);
  }
  
  degreesToCardinal(degrees) {
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(((degrees + 360) % 360) / 22.5) % 16;
    return dirs[index];
  }
  
  /**
   * Get optimal launch direction (into wind for max altitude, crosswind for drift)
   */
  getOptimalLaunchDirection() {
    const windDir = this.weather.windDirection || 0;
    
    return {
      // Launch into wind for max altitude (weathercocking is helpful here)
      intoWind: windDir,
      intoWindCardinal: this.degreesToCardinal(windDir),
      
      // Launch angle to reduce drift (typically 5-10° into wind)
      recommendedAngle: 5, // degrees from vertical
      
      // Cross-wind launch direction (perpendicular to wind)
      crossWind: (windDir + 90) % 360,
      crossWindCardinal: this.degreesToCardinal((windDir + 90) % 360)
    };
  }
}

// ============================================
// Pre-Flight Checklist
// ============================================

class PreFlightChecklist {
  /**
   * Create pre-flight checklist
   * 
   * @param {Object} rocket - Rocket configuration
   * @param {Object} [options] - Checklist options
   */
  constructor(rocket, options = {}) {
    this.rocket = rocket;
    this.options = options;
    this.items = this.generateChecklist();
    this.completedItems = new Set();
  }
  
  /**
   * Generate checklist items based on rocket configuration
   */
  generateChecklist() {
    const items = [];
    const isHPR = this.rocket.certification && this.rocket.certification !== 'NAR';
    const hasDualDeploy = this.rocket.drogueChute || this.rocket.drogueDiameter;
    const hasElectronics = this.rocket.altimeter || hasDualDeploy;
    
    // Pre-flight inspection
    items.push({
      id: 'pf_visual',
      category: CHECKLIST_CATEGORIES.PRE_FLIGHT,
      text: 'Visual inspection - no damage or cracks',
      critical: true
    });
    
    items.push({
      id: 'pf_fins',
      category: CHECKLIST_CATEGORIES.PRE_FLIGHT,
      text: 'Fins secure and aligned',
      critical: true
    });
    
    // Rocket checks
    items.push({
      id: 'rkt_cg',
      category: CHECKLIST_CATEGORIES.ROCKET,
      text: 'CG verified - stability margin OK',
      critical: true
    });
    
    items.push({
      id: 'rkt_rail',
      category: CHECKLIST_CATEGORIES.ROCKET,
      text: 'Rail buttons/launch lugs clear',
      critical: true
    });
    
    // Motor checks
    items.push({
      id: 'mtr_correct',
      category: CHECKLIST_CATEGORIES.MOTOR,
      text: 'Correct motor installed',
      critical: true
    });
    
    items.push({
      id: 'mtr_retention',
      category: CHECKLIST_CATEGORIES.MOTOR,
      text: 'Motor retention secure',
      critical: true
    });
    
    items.push({
      id: 'mtr_igniter',
      category: CHECKLIST_CATEGORIES.MOTOR,
      text: 'Igniter NOT installed yet',
      critical: true
    });
    
    // Recovery checks
    items.push({
      id: 'rec_chute',
      category: CHECKLIST_CATEGORIES.RECOVERY,
      text: 'Parachute packed and shock cord attached',
      critical: true
    });
    
    items.push({
      id: 'rec_protector',
      category: CHECKLIST_CATEGORIES.RECOVERY,
      text: 'Wadding/protector in place',
      critical: true
    });
    
    if (hasDualDeploy) {
      items.push({
        id: 'rec_drogue',
        category: CHECKLIST_CATEGORIES.RECOVERY,
        text: 'Drogue parachute packed correctly',
        critical: true
      });
      
      items.push({
        id: 'rec_main',
        category: CHECKLIST_CATEGORIES.RECOVERY,
        text: 'Main parachute packed correctly',
        critical: true
      });
      
      items.push({
        id: 'rec_shear',
        category: CHECKLIST_CATEGORIES.RECOVERY,
        text: 'Shear pins installed (if used)',
        critical: true
      });
    }
    
    // Electronics checks
    if (hasElectronics) {
      items.push({
        id: 'elec_battery',
        category: CHECKLIST_CATEGORIES.ELECTRONICS,
        text: 'Altimeter battery fresh/charged',
        critical: true
      });
      
      items.push({
        id: 'elec_armed',
        category: CHECKLIST_CATEGORIES.ELECTRONICS,
        text: 'Altimeter armed and beeping',
        critical: true
      });
      
      items.push({
        id: 'elec_charges',
        category: CHECKLIST_CATEGORIES.ELECTRONICS,
        text: 'Ejection charges installed',
        critical: true
      });
      
      if (isHPR) {
        items.push({
          id: 'elec_backup',
          category: CHECKLIST_CATEGORIES.ELECTRONICS,
          text: 'Backup altimeter armed',
          critical: false
        });
      }
    }
    
    // Pad checks
    items.push({
      id: 'pad_stable',
      category: CHECKLIST_CATEGORIES.PAD,
      text: 'Launch pad stable and level',
      critical: true
    });
    
    items.push({
      id: 'pad_rod',
      category: CHECKLIST_CATEGORIES.PAD,
      text: 'Launch rod/rail secure and angled correctly',
      critical: true
    });
    
    items.push({
      id: 'pad_deflector',
      category: CHECKLIST_CATEGORIES.PAD,
      text: 'Blast deflector in place',
      critical: false
    });
    
    // Final checks
    items.push({
      id: 'fin_range',
      category: CHECKLIST_CATEGORIES.FINAL,
      text: 'Range is clear and safe',
      critical: true
    });
    
    items.push({
      id: 'fin_sky',
      category: CHECKLIST_CATEGORIES.FINAL,
      text: 'Sky is clear (no aircraft)',
      critical: true
    });
    
    items.push({
      id: 'fin_igniter',
      category: CHECKLIST_CATEGORIES.FINAL,
      text: 'Igniter installed and connected',
      critical: true
    });
    
    items.push({
      id: 'fin_continuity',
      category: CHECKLIST_CATEGORIES.FINAL,
      text: 'Launch controller shows continuity',
      critical: true
    });
    
    return items;
  }
  
  /**
   * Mark item as complete
   */
  completeItem(id) {
    this.completedItems.add(id);
  }
  
  /**
   * Mark item as incomplete
   */
  uncompleteItem(id) {
    this.completedItems.delete(id);
  }
  
  /**
   * Check if item is complete
   */
  isComplete(id) {
    return this.completedItems.has(id);
  }
  
  /**
   * Get completion status
   */
  getStatus() {
    const total = this.items.length;
    const completed = this.completedItems.size;
    const critical = this.items.filter(i => i.critical);
    const criticalComplete = critical.filter(i => this.completedItems.has(i.id)).length;
    
    const allCriticalComplete = criticalComplete === critical.length;
    const allComplete = completed === total;
    
    return {
      total,
      completed,
      remaining: total - completed,
      percentComplete: Math.round((completed / total) * 100),
      criticalTotal: critical.length,
      criticalComplete,
      allCriticalComplete,
      allComplete,
      readyToLaunch: allCriticalComplete,
      status: allComplete ? 'COMPLETE' : (allCriticalComplete ? 'READY' : 'INCOMPLETE')
    };
  }
  
  /**
   * Get items by category
   */
  getByCategory(category) {
    return this.items.filter(i => i.category === category);
  }
  
  /**
   * Get incomplete critical items
   */
  getIncompleteCritical() {
    return this.items.filter(i => i.critical && !this.completedItems.has(i.id));
  }
  
  /**
   * Reset checklist
   */
  reset() {
    this.completedItems.clear();
  }
  
  /**
   * Export checklist state
   */
  export() {
    return {
      items: this.items,
      completed: Array.from(this.completedItems),
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Import checklist state
   */
  import(state) {
    if (state.completed) {
      this.completedItems = new Set(state.completed);
    }
  }
}

// ============================================
// Launch Window Calculator
// ============================================

class LaunchWindowCalculator {
  /**
   * Calculate optimal launch windows
   * 
   * @param {Array} forecast - Hourly weather forecast
   * @param {Object} requirements - Launch requirements
   */
  constructor(forecast, requirements = {}) {
    this.forecast = forecast || [];
    this.requirements = {
      maxWind: requirements.maxWind || 15, // mph
      minVisibility: requirements.minVisibility || 3000, // meters
      noPrecipitation: requirements.noPrecipitation !== false,
      ...requirements
    };
  }
  
  /**
   * Find optimal launch windows
   */
  findWindows() {
    if (this.forecast.length === 0) {
      return { windows: [], bestWindow: null };
    }
    
    const windows = [];
    let currentWindow = null;
    
    for (let i = 0; i < this.forecast.length; i++) {
      const hour = this.forecast[i];
      const isGood = this.evaluateHour(hour);
      
      if (isGood.suitable) {
        if (!currentWindow) {
          currentWindow = {
            start: hour.time || hour.datetime,
            end: null,
            hours: [],
            avgScore: 0,
            minScore: 100
          };
        }
        currentWindow.hours.push({ ...hour, score: isGood.score });
        currentWindow.minScore = Math.min(currentWindow.minScore, isGood.score);
      } else {
        if (currentWindow) {
          currentWindow.end = hour.time || hour.datetime;
          currentWindow.avgScore = currentWindow.hours.reduce((s, h) => s + h.score, 0) / currentWindow.hours.length;
          currentWindow.duration = currentWindow.hours.length;
          windows.push(currentWindow);
          currentWindow = null;
        }
      }
    }
    
    // Close final window if still open
    if (currentWindow) {
      const lastHour = this.forecast[this.forecast.length - 1];
      currentWindow.end = lastHour.time || lastHour.datetime;
      currentWindow.avgScore = currentWindow.hours.reduce((s, h) => s + h.score, 0) / currentWindow.hours.length;
      currentWindow.duration = currentWindow.hours.length;
      windows.push(currentWindow);
    }
    
    // Sort by score and find best
    windows.sort((a, b) => b.avgScore - a.avgScore);
    
    return {
      windows,
      bestWindow: windows[0] || null,
      totalSuitableHours: windows.reduce((sum, w) => sum + w.duration, 0)
    };
  }
  
  /**
   * Evaluate a single hour
   */
  evaluateHour(hour) {
    let score = 100;
    let suitable = true;
    const issues = [];
    
    // Wind check
    const windMph = (hour.windSpeed || 0) * MPS_TO_MPH;
    if (windMph > this.requirements.maxWind) {
      suitable = false;
      issues.push('Wind too strong');
      score -= 40;
    } else if (windMph > this.requirements.maxWind * 0.7) {
      score -= 15;
    }
    
    // Visibility
    const vis = hour.visibility || 10000;
    if (vis < this.requirements.minVisibility) {
      suitable = false;
      issues.push('Poor visibility');
      score -= 30;
    }
    
    // Precipitation
    if (this.requirements.noPrecipitation && hour.precipitation > 0) {
      suitable = false;
      issues.push('Precipitation');
      score -= 30;
    }
    
    // Cloud cover bonus
    if (hour.cloudCover !== undefined && hour.cloudCover < 30) {
      score += 5; // Bonus for clear skies
    }
    
    return { suitable, score: Math.max(0, Math.min(100, score)), issues };
  }
  
  /**
   * Get recommendation for current conditions
   */
  getCurrentRecommendation() {
    if (this.forecast.length === 0) {
      return { recommendation: 'No forecast data available' };
    }
    
    const current = this.forecast[0];
    const evaluation = this.evaluateHour(current);
    
    if (evaluation.suitable && evaluation.score >= 80) {
      return {
        recommendation: 'Excellent conditions - launch now!',
        status: 'EXCELLENT',
        score: evaluation.score
      };
    } else if (evaluation.suitable) {
      return {
        recommendation: 'Acceptable conditions - proceed with caution',
        status: 'GOOD',
        score: evaluation.score
      };
    } else {
      const windows = this.findWindows();
      if (windows.bestWindow) {
        return {
          recommendation: `Wait for better conditions at ${windows.bestWindow.start}`,
          status: 'WAIT',
          nextWindow: windows.bestWindow
        };
      }
      return {
        recommendation: 'No suitable launch windows in forecast',
        status: 'NO-GO'
      };
    }
  }
}

// ============================================
// Main Launch Day Assistant
// ============================================

class LaunchDayAssistant {
  /**
   * Create launch day assistant
   * 
   * @param {Object} rocket - Rocket configuration
   * @param {Object} motor - Motor configuration
   * @param {Object} conditions - Current conditions
   */
  constructor(rocket, motor = null, conditions = {}) {
    this.rocket = rocket;
    this.motor = motor;
    this.conditions = conditions;
    
    // Initialize sub-systems
    this.weather = new WeatherAssessment(
      conditions.weather,
      this.determineRocketClass()
    );
    
    this.checklist = new PreFlightChecklist(rocket, conditions);
    
    if (conditions.forecast) {
      this.windowCalculator = new LaunchWindowCalculator(conditions.forecast);
    }
  }
  
  /**
   * Determine rocket class for limits
   */
  determineRocketClass() {
    if (!this.motor) return 'model';
    
    const impulseClass = this.motor.impulseClass || this.motor.designation?.[0];
    
    if (['A', 'B', 'C', 'D'].includes(impulseClass)) return 'model';
    if (['E', 'F', 'G'].includes(impulseClass)) return 'hpr_l1';
    if (['H', 'I', 'J'].includes(impulseClass)) return 'hpr_l2';
    return 'hpr_l3';
  }
  
  /**
   * Get comprehensive launch readiness assessment
   */
  getReadiness() {
    const results = {
      timestamp: new Date().toISOString(),
      rocket: this.rocket?.name || 'Unknown',
      motor: this.motor?.designation || 'None selected'
    };
    
    // Weather assessment
    results.weather = this.weather.assess();
    
    // Stability check
    results.stability = this.checkStability();
    
    // Flutter check
    results.flutter = this.checkFlutter();
    
    // Recovery check
    results.recovery = this.checkRecovery();
    
    // Waiver compliance
    results.waiver = this.checkWaiverCompliance();
    
    // Checklist status
    results.checklist = this.checklist.getStatus();
    
    // Drift prediction
    if (this.conditions.weather) {
      const profile = this.getFlightProfile();
      const predictor = new DriftPredictor(profile, this.conditions.weather);
      results.drift = predictor.predict();
      results.launchDirection = predictor.getOptimalLaunchDirection();
    }
    
    // Launch windows
    if (this.windowCalculator) {
      results.windows = this.windowCalculator.findWindows();
      results.windowRecommendation = this.windowCalculator.getCurrentRecommendation();
    }
    
    // Overall status
    results.overall = this.calculateOverallStatus(results);
    
    return results;
  }
  
  /**
   * Check stability status
   */
  checkStability() {
    if (!this.rocket) {
      return { status: 'UNKNOWN', message: 'No rocket configured' };
    }
    
    // Use global StabilityAnalysis if available
    if (typeof StabilityAnalysis !== 'undefined') {
      try {
        const analysis = new StabilityAnalysis(this.rocket, this.motor);
        const result = analysis.calculate();
        
        return {
          status: result.status,
          severity: result.severity,
          calibers: result.stabilityCalibers,
          message: result.recommendation,
          cp: result.cp,
          cg: result.cg
        };
      } catch (e) {
        log.error('Stability check failed:', e);
      }
    }
    
    // Fallback - check if stability data is in rocket config
    if (this.rocket.stabilityCalibers) {
      const cal = this.rocket.stabilityCalibers;
      return {
        status: cal >= 1.5 ? 'STABLE' : (cal >= 1.0 ? 'MARGINAL' : 'UNSTABLE'),
        calibers: cal,
        message: cal >= 1.5 ? 'Stability OK' : 'Check stability'
      };
    }
    
    return { status: 'UNKNOWN', message: 'Unable to verify stability' };
  }
  
  /**
   * Check flutter status
   */
  checkFlutter() {
    if (!this.rocket || !this.rocket.finRootChord) {
      return { status: 'UNKNOWN', message: 'No fin data' };
    }
    
    // Use global FinFlutterAnalysis if available
    if (typeof FinFlutterAnalysis !== 'undefined' && typeof FinGeometry !== 'undefined') {
      try {
        const geometry = FinGeometry.fromMillimeters({
          rootChord: this.rocket.finRootChord,
          tipChord: this.rocket.finTipChord || 0,
          span: this.rocket.finSpan,
          thickness: this.rocket.finThickness || 3
        });
        
        const material = this.rocket.finMaterial || 'birch-plywood-1/8';
        const analysis = new FinFlutterAnalysis(geometry, material);
        
        // Estimate max velocity (rough)
        const maxVelocity = this.estimateMaxVelocity();
        const result = analysis.analyze(maxVelocity);
        
        return {
          status: result.status,
          severity: result.severity,
          safetyFactor: result.safetyFactor,
          flutterVelocity: result.flutterVelocity,
          message: result.safetyFactor >= 1.25 ? 'Flutter margin OK' : 'Check fin flutter'
        };
      } catch (e) {
        log.error('Flutter check failed:', e);
      }
    }
    
    return { status: 'UNKNOWN', message: 'Unable to verify flutter' };
  }
  
  /**
   * Check recovery system
   */
  checkRecovery() {
    if (!this.rocket) {
      return { status: 'UNKNOWN', message: 'No rocket configured' };
    }
    
    const issues = [];
    const warnings = [];
    let status = 'OK';
    
    // Check if recovery is configured
    if (!this.rocket.chuteDiameter && !this.rocket.mainChute) {
      issues.push('No parachute configured');
      status = 'FAIL';
    }
    
    // Check chute size vs mass
    const mass = this.rocket.dryMass || 500;
    const chuteDia = this.rocket.chuteDiameter || this.rocket.mainChute?.diameter;
    
    if (chuteDia) {
      // Rough check: chute should be ~10x sqrt(mass in grams) mm
      const minChute = Math.sqrt(mass) * 10;
      if (chuteDia < minChute * 0.7) {
        warnings.push(`Parachute may be undersized for ${mass}g rocket`);
        status = status === 'OK' ? 'WARNING' : status;
      }
    }
    
    // Check dual deploy configuration
    if (this.rocket.drogueChute || this.rocket.drogueDiameter) {
      if (!this.rocket.mainDeployAltitude) {
        warnings.push('Main deployment altitude not set');
      }
    }
    
    return {
      status,
      issues,
      warnings,
      message: status === 'OK' ? 'Recovery system OK' : 
               (issues.length > 0 ? issues[0] : warnings[0])
    };
  }
  
  /**
   * Check waiver compliance
   */
  checkWaiverCompliance() {
    const expectedApogee = this.getExpectedApogee();
    const waiver = this.conditions.waiver || STANDARD_WAIVERS.nar_section;
    
    const waiverFeet = waiver.feet || 5000;
    const withinWaiver = expectedApogee <= waiverFeet;
    
    return {
      expectedApogee,
      waiverCeiling: waiverFeet,
      withinWaiver,
      margin: waiverFeet - expectedApogee,
      status: withinWaiver ? 'OK' : 'EXCEEDS',
      message: withinWaiver 
        ? `Expected ${expectedApogee}ft within ${waiverFeet}ft waiver`
        : `Expected ${expectedApogee}ft EXCEEDS ${waiverFeet}ft waiver!`
    };
  }
  
  /**
   * Get expected apogee
   */
  getExpectedApogee() {
    // Check if simulation result exists
    if (this.conditions.simulation?.apogee) {
      return this.conditions.simulation.apogee * M_TO_FT;
    }
    
    // Rough estimate from motor
    if (this.motor) {
      const impulse = this.motor.totalImpulse || 100;
      const mass = (this.rocket?.dryMass || 500) + (this.motor.totalMass || 50);
      
      // Very rough: apogee ≈ impulse * 10 / sqrt(mass) (in feet)
      return Math.round(impulse * 10 / Math.sqrt(mass / 1000) * 3);
    }
    
    return 1000; // Default estimate
  }
  
  /**
   * Estimate max velocity
   */
  estimateMaxVelocity() {
    if (this.motor) {
      // Rough estimate based on motor
      const thrust = this.motor.avgThrust || this.motor.totalImpulse / (this.motor.burnTime || 1);
      const mass = ((this.rocket?.dryMass || 500) + (this.motor.totalMass || 50)) / 1000;
      
      // v ≈ sqrt(2 * T/m * burnTime) - very approximate
      return Math.sqrt(2 * (thrust / mass) * (this.motor.burnTime || 1)) * 0.7;
    }
    
    return 150; // Default estimate m/s
  }
  
  /**
   * Get flight profile for predictions
   */
  getFlightProfile() {
    const apogee = this.getExpectedApogee();
    
    return {
      apogee,
      timeToApogee: Math.sqrt(apogee / 16) * 0.8, // Rough estimate
      coastTime: 2,
      descentTime: apogee / 15, // ~15 ft/s descent
      maxVelocity: this.estimateMaxVelocity()
    };
  }
  
  /**
   * Calculate overall status
   */
  calculateOverallStatus(results) {
    let status = 'GO';
    let score = 100;
    const blockers = [];
    const warnings = [];
    
    // Weather
    if (results.weather.status === 'NO-GO') {
      status = 'NO-GO';
      blockers.push('Weather conditions');
      score -= 40;
    } else if (results.weather.status === 'CAUTION') {
      warnings.push('Weather marginal');
      score -= 15;
    }
    
    // Stability
    if (results.stability.severity === 'danger') {
      status = 'NO-GO';
      blockers.push('Rocket unstable');
      score -= 30;
    } else if (results.stability.severity === 'warning') {
      warnings.push('Stability marginal');
      score -= 10;
    }
    
    // Flutter
    if (results.flutter.severity === 'danger') {
      status = 'NO-GO';
      blockers.push('Fin flutter risk');
      score -= 25;
    } else if (results.flutter.severity === 'warning') {
      warnings.push('Flutter margin low');
      score -= 10;
    }
    
    // Recovery
    if (results.recovery.status === 'FAIL') {
      status = 'NO-GO';
      blockers.push('Recovery system issue');
      score -= 30;
    }
    
    // Waiver
    if (!results.waiver.withinWaiver) {
      status = 'NO-GO';
      blockers.push('Exceeds waiver');
      score -= 20;
    }
    
    // Checklist
    if (!results.checklist.allCriticalComplete) {
      if (status === 'GO') status = 'HOLD';
      warnings.push(`${results.checklist.criticalTotal - results.checklist.criticalComplete} critical items incomplete`);
    }
    
    return {
      status,
      score: Math.max(0, score),
      blockers,
      warnings,
      message: status === 'GO' 
        ? 'All systems GO for launch!' 
        : (status === 'HOLD' 
          ? 'Complete checklist before launch'
          : `NO-GO: ${blockers.join(', ')}`)
    };
  }
  
  /**
   * Get quick status summary
   */
  getQuickStatus() {
    const readiness = this.getReadiness();
    
    return {
      status: readiness.overall.status,
      score: readiness.overall.score,
      weather: readiness.weather.status,
      stability: readiness.stability.status,
      checklist: readiness.checklist.status,
      message: readiness.overall.message
    };
  }
}

// ============================================
// Exports
// ============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    LaunchDayAssistant,
    WeatherAssessment,
    DriftPredictor,
    PreFlightChecklist,
    LaunchWindowCalculator,
    WIND_LIMITS,
    STANDARD_WAIVERS,
    CHECKLIST_CATEGORIES
  };
}

if (typeof window !== 'undefined') {
  window.LaunchDayAssistant = LaunchDayAssistant;
  window.WeatherAssessment = WeatherAssessment;
  window.DriftPredictor = DriftPredictor;
  window.PreFlightChecklist = PreFlightChecklist;
  window.LaunchWindowCalculator = LaunchWindowCalculator;
  window.WIND_LIMITS = WIND_LIMITS;
  window.STANDARD_WAIVERS = STANDARD_WAIVERS;
}

export {
  LaunchDayAssistant,
  WeatherAssessment,
  DriftPredictor,
  PreFlightChecklist,
  LaunchWindowCalculator,
  WIND_LIMITS,
  STANDARD_WAIVERS,
  CHECKLIST_CATEGORIES
};

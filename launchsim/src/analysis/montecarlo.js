/**
 * LAUNCHSIM Monte Carlo Analysis Module
 * =====================================
 * 
 * Statistical dispersion analysis for rocket flights.
 * Randomizes input parameters and runs multiple simulations
 * to predict landing zones, apogee variation, and flight reliability.
 * 
 * Features:
 * - Configurable parameter distributions
 * - Parallel simulation execution
 * - Statistical analysis and visualization
 * - TARC competition scoring
 * - Landing zone prediction
 */

// Debug mode - set window.LAUNCHSIM_DEBUG = true for verbose logging
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[MonteCarlo]', ...args),
  warn: (...args) => console.warn('[MonteCarlo]', ...args),
  error: (...args) => console.error('[MonteCarlo]', ...args)
};

// ============================================
// Random Number Generators
// ============================================

class RandomGenerators {
  /**
   * Box-Muller transform for Gaussian random numbers
   */
  static gaussian(mean = 0, stdDev = 1) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return mean + z0 * stdDev;
  }

  /**
   * Uniform random number in range
   */
  static uniform(min, max) {
    return min + Math.random() * (max - min);
  }

  /**
   * Triangular distribution (mode is most likely value)
   */
  static triangular(min, mode, max) {
    const u = Math.random();
    const fc = (mode - min) / (max - min);
    
    if (u < fc) {
      return min + Math.sqrt(u * (max - min) * (mode - min));
    } else {
      return max - Math.sqrt((1 - u) * (max - min) * (max - mode));
    }
  }

  /**
   * Log-normal distribution (for always-positive values)
   */
  static logNormal(mean, stdDev) {
    const sigma2 = Math.log(1 + (stdDev * stdDev) / (mean * mean));
    const mu = Math.log(mean) - sigma2 / 2;
    const sigma = Math.sqrt(sigma2);
    return Math.exp(this.gaussian(mu, sigma));
  }

  /**
   * Bernoulli trial (success/failure with probability p)
   */
  static bernoulli(p = 0.5) {
    return Math.random() < p;
  }
}

// ============================================
// Parameter Variation Definitions
// ============================================

class ParameterVariation {
  constructor(config = {}) {
    // Mass variations (kg)
    this.mass = {
      distribution: 'gaussian',
      stdDev: config.massStdDev || 0.005,  // 5g standard deviation
      ...config.mass
    };

    // Thrust variations (fraction of nominal)
    this.thrust = {
      distribution: 'gaussian',
      stdDev: config.thrustStdDev || 0.03,  // 3% standard deviation
      ...config.thrust
    };

    // Burn time variations (fraction)
    this.burnTime = {
      distribution: 'gaussian',
      stdDev: config.burnTimeStdDev || 0.05,  // 5% standard deviation
      ...config.burnTime
    };

    // Launch angle variations (degrees)
    this.inclination = {
      distribution: 'gaussian',
      stdDev: config.inclinationStdDev || 1.0,  // 1 degree
      ...config.inclination
    };

    // Launch heading variations (degrees)
    this.heading = {
      distribution: 'gaussian',
      stdDev: config.headingStdDev || 2.0,  // 2 degrees
      ...config.heading
    };

    // Wind speed variations (m/s)
    this.windSpeed = {
      distribution: 'gaussian',
      stdDev: config.windSpeedStdDev || 1.5,  // 1.5 m/s
      ...config.windSpeed
    };

    // Wind direction variations (degrees)
    this.windDirection = {
      distribution: 'gaussian',
      stdDev: config.windDirectionStdDev || 15,  // 15 degrees
      ...config.windDirection
    };

    // CD variations (fraction)
    this.dragCoefficient = {
      distribution: 'gaussian',
      stdDev: config.cdStdDev || 0.05,  // 5%
      ...config.dragCoefficient
    };

    // Parachute deployment time variations (seconds)
    this.deploymentTime = {
      distribution: 'gaussian',
      stdDev: config.deploymentTimeStdDev || 0.5,  // 0.5 seconds
      ...config.deploymentTime
    };

    // Parachute CD×S variations (fraction)
    this.parachuteCdS = {
      distribution: 'gaussian',
      stdDev: config.parachuteCdSStdDev || 0.1,  // 10%
      ...config.parachuteCdS
    };

    // Failure modes
    this.failures = {
      motorCato: config.motorCatoProb || 0.001,    // 0.1% chance
      chuteFailure: config.chuteFailureProb || 0.005,  // 0.5% chance
      separationFailure: config.separationFailureProb || 0.002,  // 0.2% chance
      ...config.failures
    };
  }

  /**
   * Apply variation to a value
   */
  applyVariation(value, variation) {
    switch (variation.distribution) {
      case 'gaussian':
        return value + RandomGenerators.gaussian(0, variation.stdDev);
      case 'uniform':
        return value + RandomGenerators.uniform(-variation.range, variation.range);
      case 'triangular':
        return RandomGenerators.triangular(
          value - variation.range,
          value,
          value + variation.range
        );
      case 'logNormal':
        return value * RandomGenerators.logNormal(1, variation.stdDev);
      case 'factor':
        // Multiply by factor with gaussian distribution
        const factor = RandomGenerators.gaussian(1, variation.stdDev);
        return value * Math.max(0.5, Math.min(1.5, factor));
      default:
        return value;
    }
  }

  /**
   * Generate a randomized simulation configuration
   */
  randomizeConfig(baseConfig) {
    const config = JSON.parse(JSON.stringify(baseConfig));  // Deep clone

    // Randomize rocket mass
    if (config.rocket?.mass) {
      config.rocket.mass = this.applyVariation(config.rocket.mass, this.mass);
    }

    // Randomize motor performance
    if (config.rocket?.motor) {
      const thrustFactor = this.applyVariation(1, this.thrust);
      const burnFactor = this.applyVariation(1, this.burnTime);
      
      config.rocket.motor.avg_thrust = (config.rocket.motor.avg_thrust || 10) * thrustFactor;
      config.rocket.motor.burn_time = (config.rocket.motor.burn_time || 1) * burnFactor;
      
      // Randomize thrust curve if present
      if (config.rocket.motor.thrust_curve) {
        config.rocket.motor.thrust_curve = config.rocket.motor.thrust_curve.map(
          ([t, thrust]) => [t * burnFactor, thrust * thrustFactor]
        );
      }
    }

    // Randomize launch conditions
    if (config.flight) {
      config.flight.inclination = this.applyVariation(
        config.flight.inclination || 85, 
        this.inclination
      );
      config.flight.heading = this.applyVariation(
        config.flight.heading || 0, 
        this.heading
      );
    }

    // Randomize environment
    if (config.environment) {
      config.environment.wind_speed = Math.max(0, this.applyVariation(
        config.environment.wind_speed || 0, 
        this.windSpeed
      ));
      config.environment.wind_direction = this.applyVariation(
        config.environment.wind_direction || 0, 
        this.windDirection
      ) % 360;
    }

    // Randomize drag
    if (config.rocket?.power_off_drag) {
      const cdFactor = this.applyVariation(1, this.dragCoefficient);
      config.rocket.power_off_drag = config.rocket.power_off_drag.map(
        ([mach, cd]) => [mach, cd * cdFactor]
      );
    }

    // Randomize parachute
    if (config.rocket?.parachutes?.[0]) {
      const chute = config.rocket.parachutes[0];
      chute.cd_s = this.applyVariation(chute.cd_s || 1, this.parachuteCdS);
      chute.lag = Math.max(0, this.applyVariation(chute.lag || 1.5, this.deploymentTime));
    }

    // Check for failures
    config._failures = {
      motorCato: RandomGenerators.bernoulli(this.failures.motorCato),
      chuteFailure: RandomGenerators.bernoulli(this.failures.chuteFailure),
      separationFailure: RandomGenerators.bernoulli(this.failures.separationFailure)
    };

    return config;
  }
}

// ============================================
// Monte Carlo Engine
// ============================================

class MonteCarloEngine {
  constructor(simulator, options = {}) {
    this.simulator = simulator;
    this.options = {
      numSimulations: options.numSimulations || 100,
      parallelism: options.parallelism || 4,
      progressCallback: options.onProgress || (() => {}),
      resultCallback: options.onResult || (() => {}),
      ...options
    };
    
    this.variations = new ParameterVariation(options.variations);
    this.results = [];
    this.running = false;
    this.cancelled = false;
  }

  /**
   * Run Monte Carlo analysis
   * @param {Object} baseConfig - Base simulation configuration
   * @returns {Promise<MonteCarloResults>}
   */
  async run(baseConfig) {
    this.results = [];
    this.running = true;
    this.cancelled = false;

    const startTime = performance.now();
    const total = this.options.numSimulations;

    // Create all randomized configs upfront
    const configs = [];
    for (let i = 0; i < total; i++) {
      configs.push({
        index: i,
        config: this.variations.randomizeConfig(baseConfig)
      });
    }

    // Run simulations
    let completed = 0;
    const batchSize = this.options.parallelism;

    for (let i = 0; i < configs.length && !this.cancelled; i += batchSize) {
      const batch = configs.slice(i, Math.min(i + batchSize, configs.length));
      
      const batchResults = await Promise.all(
        batch.map(({ index, config }) => this.runSingle(index, config))
      );

      this.results.push(...batchResults.filter(r => r !== null));
      completed += batch.length;

      this.options.progressCallback({
        completed,
        total,
        percent: (completed / total) * 100,
        currentBatch: batchResults
      });
    }

    this.running = false;
    const duration = (performance.now() - startTime) / 1000;

    return this.analyzeResults(duration);
  }

  /**
   * Run a single simulation
   */
  async runSingle(index, config) {
    try {
      // Handle failure modes
      if (config._failures?.motorCato) {
        return {
          index,
          success: false,
          failure: 'motor_cato',
          apogee: RandomGenerators.uniform(10, 50),
          flightTime: RandomGenerators.uniform(2, 5),
          landingPosition: [RandomGenerators.uniform(-50, 50), RandomGenerators.uniform(-50, 50)],
          landingVelocity: RandomGenerators.uniform(10, 30)
        };
      }

      // Run simulation
      const result = await this.simulator(config);
      
      // Handle chute failure
      if (config._failures?.chuteFailure) {
        result.landingVelocity = RandomGenerators.uniform(15, 40);
        result.chuteFailure = true;
      }

      this.options.resultCallback({ index, result });

      return {
        index,
        success: result.success !== false,
        apogee: result.apogee || result.maxAltitude || 0,
        apogeeTime: result.apogee_time || result.apogeeTime || 0,
        maxVelocity: result.max_velocity || result.maxVelocity || 0,
        flightTime: result.flight_time || result.flightTime || 0,
        landingPosition: result.landing_position || result.landingPosition || [0, 0],
        landingVelocity: result.landing_velocity || result.landingVelocity || 0,
        config: {
          mass: config.rocket?.mass,
          thrustFactor: config.rocket?.motor?.avg_thrust,
          inclination: config.flight?.inclination,
          heading: config.flight?.heading,
          windSpeed: config.environment?.wind_speed,
          windDirection: config.environment?.wind_direction
        }
      };
    } catch (error) {
      log.error(`Simulation ${index} failed:`, error);
      return {
        index,
        success: false,
        failure: 'simulation_error',
        error: error.message
      };
    }
  }

  /**
   * Cancel running analysis
   */
  cancel() {
    this.cancelled = true;
  }

  /**
   * Analyze Monte Carlo results
   */
  analyzeResults(duration) {
    const successful = this.results.filter(r => r.success);
    const failed = this.results.filter(r => !r.success);

    if (successful.length === 0) {
      return {
        success: false,
        message: 'All simulations failed',
        numSimulations: this.results.length,
        numSuccessful: 0,
        numFailed: failed.length
      };
    }

    // Extract data arrays
    const apogees = successful.map(r => r.apogee);
    const flightTimes = successful.map(r => r.flightTime);
    const landingVelocities = successful.map(r => r.landingVelocity);
    const landingX = successful.map(r => r.landingPosition[0]);
    const landingY = successful.map(r => r.landingPosition[1]);
    const landingDistances = successful.map(r => 
      Math.sqrt(r.landingPosition[0]**2 + r.landingPosition[1]**2)
    );

    return {
      success: true,
      duration,
      numSimulations: this.results.length,
      numSuccessful: successful.length,
      numFailed: failed.length,
      successRate: successful.length / this.results.length,

      // Apogee statistics
      apogee: {
        mean: this.mean(apogees),
        stdDev: this.stdDev(apogees),
        min: Math.min(...apogees),
        max: Math.max(...apogees),
        median: this.median(apogees),
        percentile5: this.percentile(apogees, 5),
        percentile95: this.percentile(apogees, 95),
        histogram: this.histogram(apogees, 20)
      },

      // Flight time statistics
      flightTime: {
        mean: this.mean(flightTimes),
        stdDev: this.stdDev(flightTimes),
        min: Math.min(...flightTimes),
        max: Math.max(...flightTimes),
        median: this.median(flightTimes)
      },

      // Landing statistics
      landing: {
        velocityMean: this.mean(landingVelocities),
        velocityStdDev: this.stdDev(landingVelocities),
        velocityMax: Math.max(...landingVelocities),
        dispersionMean: this.mean(landingDistances),
        dispersionStdDev: this.stdDev(landingDistances),
        dispersion95: this.percentile(landingDistances, 95),
        positions: successful.map(r => r.landingPosition),
        xMean: this.mean(landingX),
        yMean: this.mean(landingY),
        xStdDev: this.stdDev(landingX),
        yStdDev: this.stdDev(landingY)
      },

      // Failure analysis
      failures: {
        total: failed.length,
        motorCato: failed.filter(r => r.failure === 'motor_cato').length,
        chuteFailure: successful.filter(r => r.chuteFailure).length,
        simulationError: failed.filter(r => r.failure === 'simulation_error').length
      },

      // Raw results for further analysis
      rawResults: this.results
    };
  }

  // Statistical helper functions
  mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  stdDev(arr) {
    const avg = this.mean(arr);
    const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
    return Math.sqrt(this.mean(squareDiffs));
  }

  median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  percentile(arr, p) {
    const sorted = [...arr].sort((a, b) => a - b);
    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  }

  histogram(arr, bins = 10) {
    const min = Math.min(...arr);
    const max = Math.max(...arr);
    const binWidth = (max - min) / bins;
    
    const histogram = new Array(bins).fill(0);
    const binEdges = [];
    
    for (let i = 0; i <= bins; i++) {
      binEdges.push(min + i * binWidth);
    }
    
    for (const value of arr) {
      const binIndex = Math.min(Math.floor((value - min) / binWidth), bins - 1);
      histogram[binIndex]++;
    }
    
    return { counts: histogram, edges: binEdges, binWidth };
  }
}

// ============================================
// TARC Scoring (Team America Rocketry Challenge)
// ============================================

class TARCScoring {
  constructor(year = 2025) {
    // TARC 2025 rules
    this.targetAltitude = year >= 2025 ? 825 : 800;  // feet
    this.targetDuration = year >= 2025 ? 43 : 41;    // seconds
    this.altitudeMin = 600;   // feet
    this.altitudeMax = 1000;  // feet
    this.durationMin = 38;    // seconds
    this.durationMax = 48;    // seconds
    this.maxMotorImpulse = 80; // Ns (G-class limit)
  }

  /**
   * Calculate TARC score for a flight
   * Lower is better (altitude error + duration error)
   */
  calculateScore(apogeeMeters, flightTimeSeconds) {
    const apogeeFeet = apogeeMeters * 3.28084;
    
    const altitudeError = Math.abs(apogeeFeet - this.targetAltitude);
    const durationError = Math.abs(flightTimeSeconds - this.targetDuration);
    
    return {
      score: altitudeError + durationError,
      altitudeError,
      durationError,
      apogeeFeet,
      flightTime: flightTimeSeconds,
      qualified: this.checkQualification(apogeeMeters, flightTimeSeconds)
    };
  }

  /**
   * Check if flight meets qualification criteria
   */
  checkQualification(apogeeMeters, flightTimeSeconds) {
    const apogeeFeet = apogeeMeters * 3.28084;
    
    const issues = [];
    
    if (apogeeFeet < this.altitudeMin) {
      issues.push(`Altitude too low: ${apogeeFeet.toFixed(0)}ft < ${this.altitudeMin}ft`);
    }
    if (apogeeFeet > this.altitudeMax) {
      issues.push(`Altitude too high: ${apogeeFeet.toFixed(0)}ft > ${this.altitudeMax}ft`);
    }
    if (flightTimeSeconds < this.durationMin) {
      issues.push(`Duration too short: ${flightTimeSeconds.toFixed(1)}s < ${this.durationMin}s`);
    }
    if (flightTimeSeconds > this.durationMax) {
      issues.push(`Duration too long: ${flightTimeSeconds.toFixed(1)}s > ${this.durationMax}s`);
    }
    
    return {
      qualified: issues.length === 0,
      issues
    };
  }

  /**
   * Score Monte Carlo results for TARC
   */
  scoreMonteCarlo(mcResults) {
    const scores = mcResults.rawResults
      .filter(r => r.success)
      .map(r => this.calculateScore(r.apogee, r.flightTime));
    
    const qualifiedFlights = scores.filter(s => s.qualified.qualified);
    
    return {
      meanScore: scores.reduce((a, b) => a + b.score, 0) / scores.length,
      bestScore: Math.min(...scores.map(s => s.score)),
      worstScore: Math.max(...scores.map(s => s.score)),
      medianScore: this.median(scores.map(s => s.score)),
      qualificationRate: qualifiedFlights.length / scores.length,
      numQualified: qualifiedFlights.length,
      numTotal: scores.length,
      scores,
      
      // Recommendations
      altitudeBias: this.mean(scores.map(s => s.apogeeFeet)) - this.targetAltitude,
      durationBias: this.mean(scores.map(s => s.flightTime)) - this.targetDuration
    };
  }

  mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}

// ============================================
// Visualization Helpers
// ============================================

class MonteCarloVisualizer {
  constructor(canvasId) {
    this.canvas = typeof canvasId === 'string' 
      ? document.getElementById(canvasId) 
      : canvasId;
    this.ctx = this.canvas?.getContext('2d');
  }

  /**
   * Draw landing zone scatter plot
   */
  drawLandingZone(results, options = {}) {
    if (!this.ctx) return;

    const width = this.canvas.width;
    const height = this.canvas.height;
    const padding = 40;

    // Clear
    this.ctx.fillStyle = options.backgroundColor || '#1a1a2e';
    this.ctx.fillRect(0, 0, width, height);

    const positions = results.landing.positions;
    if (positions.length === 0) return;

    // Find scale
    const maxDist = results.landing.dispersion95 * 1.2 || 100;
    const scale = (Math.min(width, height) - 2 * padding) / (2 * maxDist);
    const centerX = width / 2;
    const centerY = height / 2;

    // Draw grid
    this.ctx.strokeStyle = '#333';
    this.ctx.lineWidth = 1;
    
    for (let r = 25; r <= maxDist; r += 25) {
      this.ctx.beginPath();
      this.ctx.arc(centerX, centerY, r * scale, 0, Math.PI * 2);
      this.ctx.stroke();
      
      this.ctx.fillStyle = '#666';
      this.ctx.font = '10px monospace';
      this.ctx.fillText(`${r}m`, centerX + r * scale + 2, centerY - 2);
    }

    // Draw axes
    this.ctx.beginPath();
    this.ctx.moveTo(padding, centerY);
    this.ctx.lineTo(width - padding, centerY);
    this.ctx.moveTo(centerX, padding);
    this.ctx.lineTo(centerX, height - padding);
    this.ctx.stroke();

    // Draw landing points
    this.ctx.fillStyle = 'rgba(255, 107, 53, 0.5)';
    for (const [x, y] of positions) {
      const px = centerX + x * scale;
      const py = centerY - y * scale;
      
      this.ctx.beginPath();
      this.ctx.arc(px, py, 3, 0, Math.PI * 2);
      this.ctx.fill();
    }

    // Draw 95% ellipse
    this.ctx.strokeStyle = '#ff6b35';
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.ellipse(
      centerX + results.landing.xMean * scale,
      centerY - results.landing.yMean * scale,
      results.landing.xStdDev * 2 * scale,
      results.landing.yStdDev * 2 * scale,
      0, 0, Math.PI * 2
    );
    this.ctx.stroke();

    // Draw mean landing point
    this.ctx.fillStyle = '#00ff00';
    this.ctx.beginPath();
    this.ctx.arc(
      centerX + results.landing.xMean * scale,
      centerY - results.landing.yMean * scale,
      5, 0, Math.PI * 2
    );
    this.ctx.fill();

    // Labels
    this.ctx.fillStyle = '#fff';
    this.ctx.font = '12px sans-serif';
    this.ctx.fillText('Landing Zone Dispersion', 10, 20);
    this.ctx.fillText(`95% radius: ${results.landing.dispersion95.toFixed(1)}m`, 10, 35);
  }

  /**
   * Draw apogee histogram
   */
  drawApogeeHistogram(results, options = {}) {
    if (!this.ctx) return;

    const width = this.canvas.width;
    const height = this.canvas.height;
    const padding = 40;

    // Clear
    this.ctx.fillStyle = options.backgroundColor || '#1a1a2e';
    this.ctx.fillRect(0, 0, width, height);

    const hist = results.apogee.histogram;
    const maxCount = Math.max(...hist.counts);
    
    const barWidth = (width - 2 * padding) / hist.counts.length;
    const scaleY = (height - 2 * padding) / maxCount;

    // Draw bars
    for (let i = 0; i < hist.counts.length; i++) {
      const x = padding + i * barWidth;
      const barHeight = hist.counts[i] * scaleY;
      const y = height - padding - barHeight;

      // Color based on target if TARC mode
      let color = '#ff6b35';
      if (options.targetAltitude) {
        const midAlt = hist.edges[i] + hist.binWidth / 2;
        const error = Math.abs(midAlt - options.targetAltitude);
        if (error < 10) color = '#00ff00';
        else if (error < 25) color = '#ffff00';
        else if (error < 50) color = '#ff8800';
      }

      this.ctx.fillStyle = color;
      this.ctx.fillRect(x, y, barWidth - 2, barHeight);
    }

    // Draw axes
    this.ctx.strokeStyle = '#666';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(padding, padding);
    this.ctx.lineTo(padding, height - padding);
    this.ctx.lineTo(width - padding, height - padding);
    this.ctx.stroke();

    // X-axis labels
    this.ctx.fillStyle = '#888';
    this.ctx.font = '10px monospace';
    for (let i = 0; i <= hist.counts.length; i += 5) {
      const x = padding + i * barWidth;
      const alt = hist.edges[i] || hist.edges[hist.edges.length - 1];
      this.ctx.fillText(`${alt.toFixed(0)}m`, x, height - padding + 15);
    }

    // Mean and std dev lines
    this.ctx.strokeStyle = '#00ff00';
    this.ctx.lineWidth = 2;
    const meanX = padding + ((results.apogee.mean - hist.edges[0]) / hist.binWidth) * barWidth;
    this.ctx.beginPath();
    this.ctx.moveTo(meanX, padding);
    this.ctx.lineTo(meanX, height - padding);
    this.ctx.stroke();

    // Labels
    this.ctx.fillStyle = '#fff';
    this.ctx.font = '12px sans-serif';
    this.ctx.fillText('Apogee Distribution', 10, 20);
    this.ctx.fillText(`Mean: ${results.apogee.mean.toFixed(1)}m ± ${results.apogee.stdDev.toFixed(1)}m`, 10, 35);
  }
}

// ============================================
// Export
// ============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RandomGenerators,
    ParameterVariation,
    MonteCarloEngine,
    TARCScoring,
    MonteCarloVisualizer
  };
}

if (typeof window !== 'undefined') {
  window.RandomGenerators = RandomGenerators;
  window.ParameterVariation = ParameterVariation;
  window.MonteCarloEngine = MonteCarloEngine;
  window.TARCScoring = TARCScoring;
  window.MonteCarloVisualizer = MonteCarloVisualizer;
}

// ES Module exports
export { RandomGenerators, ParameterVariation, MonteCarloEngine, TARCScoring, MonteCarloVisualizer };

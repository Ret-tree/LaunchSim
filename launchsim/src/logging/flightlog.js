/**
 * LAUNCHSIM Flight Log & Prediction Accuracy
 * ===========================================
 * 
 * Track flight history, compare predictions vs actual results,
 * and calibrate simulations for improved accuracy.
 * 
 * Features:
 * - Flight logging with comprehensive data
 * - Prediction vs actual comparison
 * - Accuracy metrics and trends
 * - Calibration factors based on history
 * - Flight statistics and analytics
 * - Export/import flight history
 * 
 * Usage:
 *   const flightLog = new FlightLog();
 *   flightLog.logFlight(flightData);
 *   const accuracy = flightLog.getAccuracyMetrics();
 */

// Debug mode
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[FlightLog]', ...args),
  warn: (...args) => console.warn('[FlightLog]', ...args),
  error: (...args) => console.error('[FlightLog]', ...args)
};

// ============================================
// Constants
// ============================================

const M_TO_FT = 3.28084;
const FT_TO_M = 0.3048;
const MPS_TO_FPS = 3.28084;

const STORAGE_KEY = 'launchsim_flight_log';

// Flight outcome categories
const FLIGHT_OUTCOMES = {
  SUCCESS: 'success',
  PARTIAL: 'partial',
  FAILURE: 'failure',
  UNKNOWN: 'unknown'
};

// Accuracy rating thresholds
const ACCURACY_THRESHOLDS = {
  EXCELLENT: 5,   // Within 5%
  GOOD: 10,       // Within 10%
  FAIR: 20,       // Within 20%
  POOR: 30        // Within 30%
};

// ============================================
// Flight Record
// ============================================

class FlightRecord {
  /**
   * Create a flight record
   * 
   * @param {Object} data - Flight data
   */
  constructor(data = {}) {
    // Metadata
    this.id = data.id || this.generateId();
    this.date = data.date || new Date().toISOString();
    this.location = data.location || '';
    this.notes = data.notes || '';
    this.outcome = data.outcome || FLIGHT_OUTCOMES.UNKNOWN;
    
    // Rocket info
    this.rocketName = data.rocketName || data.rocket?.name || 'Unknown';
    this.rocketId = data.rocketId || null;
    this.rocketConfig = data.rocketConfig || data.rocket || null;
    
    // Motor info
    this.motorDesignation = data.motorDesignation || data.motor?.designation || '';
    this.motorManufacturer = data.motorManufacturer || data.motor?.manufacturer || '';
    
    // Predicted values (from simulation)
    this.predicted = {
      apogee: data.predicted?.apogee || data.predictedApogee || null,
      maxVelocity: data.predicted?.maxVelocity || data.predictedMaxVelocity || null,
      flightTime: data.predicted?.flightTime || data.predictedFlightTime || null,
      maxAcceleration: data.predicted?.maxAcceleration || null,
      coastTime: data.predicted?.coastTime || null,
      ejectionAltitude: data.predicted?.ejectionAltitude || null
    };
    
    // Actual values (from flight)
    this.actual = {
      apogee: data.actual?.apogee || data.actualApogee || null,
      maxVelocity: data.actual?.maxVelocity || data.actualMaxVelocity || null,
      flightTime: data.actual?.flightTime || data.actualFlightTime || null,
      maxAcceleration: data.actual?.maxAcceleration || null,
      ejectionAltitude: data.actual?.ejectionAltitude || null,
      landingDistance: data.actual?.landingDistance || null,
      landingDirection: data.actual?.landingDirection || null
    };
    
    // Weather conditions
    this.weather = {
      temperature: data.weather?.temperature || null,
      windSpeed: data.weather?.windSpeed || null,
      windDirection: data.weather?.windDirection || null,
      pressure: data.weather?.pressure || null,
      humidity: data.weather?.humidity || null
    };
    
    // Recovery
    this.recovery = {
      type: data.recovery?.type || 'single', // single, dual
      mainDeployAltitude: data.recovery?.mainDeployAltitude || null,
      successfulDeploy: data.recovery?.successfulDeploy !== false
    };
    
    // Data source
    this.dataSource = data.dataSource || 'manual'; // manual, altimeter, video, gps
    this.altimeterType = data.altimeterType || null;
    
    // Flight data file reference
    this.flightDataFile = data.flightDataFile || null;
  }
  
  generateId() {
    return `flight_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  /**
   * Calculate accuracy metrics for this flight
   */
  getAccuracy() {
    const metrics = {};
    
    // Apogee accuracy
    if (this.predicted.apogee && this.actual.apogee) {
      const error = this.actual.apogee - this.predicted.apogee;
      const errorPercent = (error / this.predicted.apogee) * 100;
      metrics.apogee = {
        predicted: this.predicted.apogee,
        actual: this.actual.apogee,
        error,
        errorPercent,
        rating: this.getAccuracyRating(Math.abs(errorPercent))
      };
    }
    
    // Max velocity accuracy
    if (this.predicted.maxVelocity && this.actual.maxVelocity) {
      const error = this.actual.maxVelocity - this.predicted.maxVelocity;
      const errorPercent = (error / this.predicted.maxVelocity) * 100;
      metrics.maxVelocity = {
        predicted: this.predicted.maxVelocity,
        actual: this.actual.maxVelocity,
        error,
        errorPercent,
        rating: this.getAccuracyRating(Math.abs(errorPercent))
      };
    }
    
    // Flight time accuracy
    if (this.predicted.flightTime && this.actual.flightTime) {
      const error = this.actual.flightTime - this.predicted.flightTime;
      const errorPercent = (error / this.predicted.flightTime) * 100;
      metrics.flightTime = {
        predicted: this.predicted.flightTime,
        actual: this.actual.flightTime,
        error,
        errorPercent,
        rating: this.getAccuracyRating(Math.abs(errorPercent))
      };
    }
    
    // Overall accuracy score
    const validMetrics = Object.values(metrics).filter(m => m.errorPercent !== undefined);
    if (validMetrics.length > 0) {
      const avgAbsError = validMetrics.reduce((sum, m) => sum + Math.abs(m.errorPercent), 0) / validMetrics.length;
      metrics.overall = {
        avgErrorPercent: avgAbsError,
        rating: this.getAccuracyRating(avgAbsError),
        metricsCount: validMetrics.length
      };
    }
    
    return metrics;
  }
  
  getAccuracyRating(absErrorPercent) {
    if (absErrorPercent <= ACCURACY_THRESHOLDS.EXCELLENT) return 'EXCELLENT';
    if (absErrorPercent <= ACCURACY_THRESHOLDS.GOOD) return 'GOOD';
    if (absErrorPercent <= ACCURACY_THRESHOLDS.FAIR) return 'FAIR';
    if (absErrorPercent <= ACCURACY_THRESHOLDS.POOR) return 'POOR';
    return 'VERY_POOR';
  }
  
  /**
   * Check if flight has enough data for accuracy analysis
   */
  hasAccuracyData() {
    return (this.predicted.apogee && this.actual.apogee) ||
           (this.predicted.maxVelocity && this.actual.maxVelocity) ||
           (this.predicted.flightTime && this.actual.flightTime);
  }
  
  /**
   * Export to plain object
   */
  toJSON() {
    return {
      id: this.id,
      date: this.date,
      location: this.location,
      notes: this.notes,
      outcome: this.outcome,
      rocketName: this.rocketName,
      rocketId: this.rocketId,
      rocketConfig: this.rocketConfig,
      motorDesignation: this.motorDesignation,
      motorManufacturer: this.motorManufacturer,
      predicted: this.predicted,
      actual: this.actual,
      weather: this.weather,
      recovery: this.recovery,
      dataSource: this.dataSource,
      altimeterType: this.altimeterType,
      flightDataFile: this.flightDataFile
    };
  }
}

// ============================================
// Flight Log
// ============================================

class FlightLog {
  /**
   * Create a flight log
   * 
   * @param {Object} [options] - Configuration options
   */
  constructor(options = {}) {
    this.flights = [];
    this.options = {
      autoSave: options.autoSave !== false,
      storageKey: options.storageKey || STORAGE_KEY,
      ...options
    };
    
    // Load from storage if available
    if (options.autoLoad !== false) {
      this.load();
    }
  }
  
  /**
   * Log a new flight
   * 
   * @param {Object|FlightRecord} flightData - Flight data
   * @returns {FlightRecord} The logged flight record
   */
  logFlight(flightData) {
    const record = flightData instanceof FlightRecord 
      ? flightData 
      : new FlightRecord(flightData);
    
    this.flights.push(record);
    
    if (this.options.autoSave) {
      this.save();
    }
    
    log.debug('Flight logged:', record.id);
    return record;
  }
  
  /**
   * Update an existing flight
   * 
   * @param {string} id - Flight ID
   * @param {Object} updates - Data to update
   */
  updateFlight(id, updates) {
    const index = this.flights.findIndex(f => f.id === id);
    if (index === -1) {
      throw new Error(`Flight not found: ${id}`);
    }
    
    const flight = this.flights[index];
    Object.assign(flight, updates);
    
    // Update nested objects
    if (updates.predicted) Object.assign(flight.predicted, updates.predicted);
    if (updates.actual) Object.assign(flight.actual, updates.actual);
    if (updates.weather) Object.assign(flight.weather, updates.weather);
    if (updates.recovery) Object.assign(flight.recovery, updates.recovery);
    
    if (this.options.autoSave) {
      this.save();
    }
    
    return flight;
  }
  
  /**
   * Delete a flight
   * 
   * @param {string} id - Flight ID
   */
  deleteFlight(id) {
    const index = this.flights.findIndex(f => f.id === id);
    if (index === -1) {
      throw new Error(`Flight not found: ${id}`);
    }
    
    this.flights.splice(index, 1);
    
    if (this.options.autoSave) {
      this.save();
    }
  }
  
  /**
   * Get a flight by ID
   */
  getFlight(id) {
    return this.flights.find(f => f.id === id);
  }
  
  /**
   * Get all flights
   */
  getAllFlights() {
    return [...this.flights];
  }
  
  /**
   * Get flights for a specific rocket
   */
  getFlightsByRocket(rocketName) {
    return this.flights.filter(f => 
      f.rocketName.toLowerCase() === rocketName.toLowerCase()
    );
  }
  
  /**
   * Get flights with a specific motor
   */
  getFlightsByMotor(motorDesignation) {
    return this.flights.filter(f => 
      f.motorDesignation.toLowerCase() === motorDesignation.toLowerCase()
    );
  }
  
  /**
   * Get flights in a date range
   */
  getFlightsByDateRange(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    return this.flights.filter(f => {
      const date = new Date(f.date);
      return date >= start && date <= end;
    });
  }
  
  /**
   * Get recent flights
   */
  getRecentFlights(count = 10) {
    return [...this.flights]
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, count);
  }
  
  /**
   * Get overall accuracy metrics across all flights
   */
  getAccuracyMetrics() {
    const flightsWithData = this.flights.filter(f => f.hasAccuracyData());
    
    if (flightsWithData.length === 0) {
      return {
        flightCount: 0,
        message: 'No flights with prediction data'
      };
    }
    
    const apogeeErrors = [];
    const velocityErrors = [];
    const timeErrors = [];
    
    flightsWithData.forEach(flight => {
      const accuracy = flight.getAccuracy();
      
      if (accuracy.apogee) {
        apogeeErrors.push(accuracy.apogee.errorPercent);
      }
      if (accuracy.maxVelocity) {
        velocityErrors.push(accuracy.maxVelocity.errorPercent);
      }
      if (accuracy.flightTime) {
        timeErrors.push(accuracy.flightTime.errorPercent);
      }
    });
    
    return {
      flightCount: flightsWithData.length,
      apogee: this.calculateErrorStats(apogeeErrors),
      maxVelocity: this.calculateErrorStats(velocityErrors),
      flightTime: this.calculateErrorStats(timeErrors),
      overall: this.calculateOverallStats(flightsWithData)
    };
  }
  
  calculateErrorStats(errors) {
    if (errors.length === 0) return null;
    
    const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
    const absMean = errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length;
    const variance = errors.reduce((sum, e) => sum + Math.pow(e - mean, 2), 0) / errors.length;
    const stdDev = Math.sqrt(variance);
    
    // Bias: positive means sim underpredicts, negative means overpredicts
    const bias = mean;
    
    return {
      count: errors.length,
      meanError: mean,
      meanAbsError: absMean,
      stdDev,
      bias,
      biasDirection: bias > 0 ? 'underpredicts' : 'overpredicts',
      min: Math.min(...errors),
      max: Math.max(...errors)
    };
  }
  
  calculateOverallStats(flights) {
    const allErrors = [];
    
    flights.forEach(f => {
      const acc = f.getAccuracy();
      if (acc.apogee) allErrors.push(Math.abs(acc.apogee.errorPercent));
      if (acc.maxVelocity) allErrors.push(Math.abs(acc.maxVelocity.errorPercent));
      if (acc.flightTime) allErrors.push(Math.abs(acc.flightTime.errorPercent));
    });
    
    if (allErrors.length === 0) return null;
    
    const avgError = allErrors.reduce((a, b) => a + b, 0) / allErrors.length;
    
    return {
      avgAbsError: avgError,
      rating: this.getOverallRating(avgError),
      dataPoints: allErrors.length
    };
  }
  
  getOverallRating(avgError) {
    if (avgError <= 5) return 'EXCELLENT';
    if (avgError <= 10) return 'GOOD';
    if (avgError <= 15) return 'FAIR';
    if (avgError <= 25) return 'POOR';
    return 'NEEDS_CALIBRATION';
  }
  
  /**
   * Calculate calibration factors based on flight history
   */
  getCalibrationFactors() {
    const metrics = this.getAccuracyMetrics();
    
    if (!metrics.apogee || metrics.flightCount < 3) {
      return {
        available: false,
        message: 'Need at least 3 flights with data for calibration',
        flightCount: metrics.flightCount
      };
    }
    
    // Calculate correction factors
    // If sim underpredicts by 5%, factor = 1.05
    const factors = {
      available: true,
      flightCount: metrics.flightCount,
      apogee: null,
      velocity: null,
      confidence: 'low'
    };
    
    if (metrics.apogee && metrics.apogee.count >= 3) {
      // Correction factor: multiply prediction by this to get closer to actual
      factors.apogee = {
        factor: 1 + (metrics.apogee.bias / 100),
        bias: metrics.apogee.bias,
        basedOn: metrics.apogee.count
      };
    }
    
    if (metrics.maxVelocity && metrics.maxVelocity.count >= 3) {
      factors.velocity = {
        factor: 1 + (metrics.maxVelocity.bias / 100),
        bias: metrics.maxVelocity.bias,
        basedOn: metrics.maxVelocity.count
      };
    }
    
    // Confidence based on sample size
    const totalSamples = (metrics.apogee?.count || 0) + (metrics.maxVelocity?.count || 0);
    if (totalSamples >= 10) factors.confidence = 'high';
    else if (totalSamples >= 5) factors.confidence = 'medium';
    
    return factors;
  }
  
  /**
   * Get flight statistics
   */
  getStatistics() {
    if (this.flights.length === 0) {
      return { flightCount: 0, message: 'No flights logged' };
    }
    
    const successCount = this.flights.filter(f => f.outcome === FLIGHT_OUTCOMES.SUCCESS).length;
    const actualApogees = this.flights
      .filter(f => f.actual.apogee)
      .map(f => f.actual.apogee);
    
    const rockets = [...new Set(this.flights.map(f => f.rocketName))];
    const motors = [...new Set(this.flights.map(f => f.motorDesignation).filter(m => m))];
    const locations = [...new Set(this.flights.map(f => f.location).filter(l => l))];
    
    const stats = {
      flightCount: this.flights.length,
      successRate: (successCount / this.flights.length) * 100,
      
      rockets: {
        count: rockets.length,
        list: rockets
      },
      
      motors: {
        count: motors.length,
        list: motors
      },
      
      locations: {
        count: locations.length,
        list: locations
      },
      
      dateRange: {
        first: this.flights.length > 0 
          ? this.flights.reduce((min, f) => f.date < min ? f.date : min, this.flights[0].date)
          : null,
        last: this.flights.length > 0
          ? this.flights.reduce((max, f) => f.date > max ? f.date : max, this.flights[0].date)
          : null
      }
    };
    
    if (actualApogees.length > 0) {
      stats.apogee = {
        count: actualApogees.length,
        min: Math.min(...actualApogees),
        max: Math.max(...actualApogees),
        avg: actualApogees.reduce((a, b) => a + b, 0) / actualApogees.length
      };
    }
    
    return stats;
  }
  
  /**
   * Save flight log to storage
   */
  save() {
    if (typeof localStorage === 'undefined') {
      log.debug('localStorage not available');
      return false;
    }
    
    try {
      const data = JSON.stringify(this.flights.map(f => f.toJSON()));
      localStorage.setItem(this.options.storageKey, data);
      log.debug('Flight log saved:', this.flights.length, 'flights');
      return true;
    } catch (e) {
      log.error('Failed to save flight log:', e);
      return false;
    }
  }
  
  /**
   * Load flight log from storage
   */
  load() {
    if (typeof localStorage === 'undefined') {
      log.debug('localStorage not available');
      return false;
    }
    
    try {
      const data = localStorage.getItem(this.options.storageKey);
      if (data) {
        const parsed = JSON.parse(data);
        this.flights = parsed.map(f => new FlightRecord(f));
        log.debug('Flight log loaded:', this.flights.length, 'flights');
        return true;
      }
    } catch (e) {
      log.error('Failed to load flight log:', e);
    }
    
    return false;
  }
  
  /**
   * Export flight log to JSON
   */
  exportJSON() {
    return JSON.stringify({
      version: '1.0',
      exportDate: new Date().toISOString(),
      flightCount: this.flights.length,
      flights: this.flights.map(f => f.toJSON())
    }, null, 2);
  }
  
  /**
   * Import flights from JSON
   */
  importJSON(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      const flights = data.flights || data;
      
      let imported = 0;
      flights.forEach(f => {
        // Check for duplicates
        if (!this.flights.find(existing => existing.id === f.id)) {
          this.flights.push(new FlightRecord(f));
          imported++;
        }
      });
      
      if (this.options.autoSave) {
        this.save();
      }
      
      return { imported, total: flights.length };
    } catch (e) {
      throw new Error(`Import failed: ${e.message}`);
    }
  }
  
  /**
   * Export to CSV format
   */
  exportCSV() {
    const headers = [
      'Date', 'Rocket', 'Motor', 'Location', 'Outcome',
      'Predicted Apogee (m)', 'Actual Apogee (m)', 'Apogee Error %',
      'Predicted Max Velocity (m/s)', 'Actual Max Velocity (m/s)',
      'Wind Speed (m/s)', 'Temperature (C)', 'Notes'
    ];
    
    const rows = this.flights.map(f => {
      const acc = f.getAccuracy();
      return [
        f.date,
        f.rocketName,
        f.motorDesignation,
        f.location,
        f.outcome,
        f.predicted.apogee || '',
        f.actual.apogee || '',
        acc.apogee ? acc.apogee.errorPercent.toFixed(1) : '',
        f.predicted.maxVelocity || '',
        f.actual.maxVelocity || '',
        f.weather.windSpeed || '',
        f.weather.temperature || '',
        f.notes.replace(/"/g, '""')
      ].map(v => `"${v}"`).join(',');
    });
    
    return [headers.join(','), ...rows].join('\n');
  }
  
  /**
   * Clear all flights
   */
  clear() {
    this.flights = [];
    if (this.options.autoSave) {
      this.save();
    }
  }
}

// ============================================
// Prediction Analyzer
// ============================================

class PredictionAnalyzer {
  /**
   * Analyze prediction accuracy and provide insights
   * 
   * @param {FlightLog} flightLog - Flight log instance
   */
  constructor(flightLog) {
    this.flightLog = flightLog;
  }
  
  /**
   * Analyze prediction trends
   */
  analyzeTrends() {
    const flights = this.flightLog.getAllFlights()
      .filter(f => f.hasAccuracyData())
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    
    if (flights.length < 3) {
      return { available: false, message: 'Need at least 3 flights for trend analysis' };
    }
    
    // Calculate rolling accuracy
    const windowSize = Math.min(5, Math.floor(flights.length / 2));
    const rollingAccuracy = [];
    
    for (let i = windowSize - 1; i < flights.length; i++) {
      const window = flights.slice(i - windowSize + 1, i + 1);
      const errors = window
        .map(f => f.getAccuracy().apogee?.errorPercent)
        .filter(e => e !== undefined);
      
      if (errors.length > 0) {
        rollingAccuracy.push({
          date: flights[i].date,
          avgError: errors.reduce((a, b) => a + b, 0) / errors.length,
          absError: errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length
        });
      }
    }
    
    // Determine if accuracy is improving
    let trend = 'stable';
    if (rollingAccuracy.length >= 2) {
      const first = rollingAccuracy[0].absError;
      const last = rollingAccuracy[rollingAccuracy.length - 1].absError;
      
      if (last < first * 0.8) trend = 'improving';
      else if (last > first * 1.2) trend = 'declining';
    }
    
    return {
      available: true,
      flightCount: flights.length,
      windowSize,
      rollingAccuracy,
      trend,
      trendMessage: this.getTrendMessage(trend)
    };
  }
  
  getTrendMessage(trend) {
    switch (trend) {
      case 'improving': return 'Your predictions are getting more accurate!';
      case 'declining': return 'Prediction accuracy has decreased. Check calibration.';
      default: return 'Prediction accuracy is stable.';
    }
  }
  
  /**
   * Identify systematic errors
   */
  identifyErrors() {
    const metrics = this.flightLog.getAccuracyMetrics();
    const issues = [];
    const suggestions = [];
    
    if (!metrics.apogee) {
      return { issues: [], suggestions: ['Log more flights with prediction data'] };
    }
    
    // Check for systematic bias
    if (metrics.apogee.bias > 10) {
      issues.push(`Simulations consistently underpredict apogee by ${metrics.apogee.bias.toFixed(1)}%`);
      suggestions.push('Consider increasing drag coefficient (Cd) in simulation');
      suggestions.push('Check if rocket mass is accurate');
    } else if (metrics.apogee.bias < -10) {
      issues.push(`Simulations consistently overpredict apogee by ${Math.abs(metrics.apogee.bias).toFixed(1)}%`);
      suggestions.push('Consider decreasing drag coefficient (Cd)');
      suggestions.push('Verify motor performance matches specifications');
    }
    
    // Check for high variance
    if (metrics.apogee.stdDev > 15) {
      issues.push('High variance in prediction accuracy');
      suggestions.push('Ensure consistent launch conditions');
      suggestions.push('Verify altimeter data quality');
    }
    
    // Weather correlation check
    const windyFlights = this.flightLog.getAllFlights()
      .filter(f => f.hasAccuracyData() && f.weather.windSpeed > 5);
    
    if (windyFlights.length >= 3) {
      const windyErrors = windyFlights
        .map(f => f.getAccuracy().apogee?.errorPercent)
        .filter(e => e !== undefined);
      
      if (windyErrors.length > 0) {
        const avgWindyError = windyErrors.reduce((a, b) => a + Math.abs(b), 0) / windyErrors.length;
        
        if (avgWindyError > metrics.apogee.meanAbsError * 1.5) {
          issues.push('Predictions less accurate in windy conditions');
          suggestions.push('Account for wind effects on trajectory');
        }
      }
    }
    
    return { issues, suggestions };
  }
  
  /**
   * Generate accuracy report
   */
  generateReport() {
    const stats = this.flightLog.getStatistics();
    const metrics = this.flightLog.getAccuracyMetrics();
    const calibration = this.flightLog.getCalibrationFactors();
    const trends = this.analyzeTrends();
    const errors = this.identifyErrors();
    
    return {
      summary: {
        totalFlights: stats.flightCount,
        successRate: stats.successRate,
        overallAccuracy: metrics.overall?.rating || 'N/A',
        avgError: metrics.overall?.avgAbsError?.toFixed(1) || 'N/A'
      },
      metrics,
      calibration,
      trends,
      errors,
      recommendations: this.generateRecommendations(metrics, calibration, errors)
    };
  }
  
  generateRecommendations(metrics, calibration, errors) {
    const recs = [];
    
    if (calibration.available && calibration.apogee) {
      if (Math.abs(calibration.apogee.bias) > 5) {
        recs.push({
          priority: 'high',
          text: `Apply ${calibration.apogee.factor.toFixed(3)}x correction to apogee predictions`,
          detail: `Based on ${calibration.apogee.basedOn} flights`
        });
      }
    }
    
    if (errors.suggestions.length > 0) {
      errors.suggestions.forEach(s => {
        recs.push({ priority: 'medium', text: s });
      });
    }
    
    if (!calibration.available) {
      recs.push({
        priority: 'info',
        text: 'Log more flights with altimeter data to enable calibration'
      });
    }
    
    return recs;
  }
}

// ============================================
// Exports
// ============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FlightLog,
    FlightRecord,
    PredictionAnalyzer,
    FLIGHT_OUTCOMES,
    ACCURACY_THRESHOLDS
  };
}

if (typeof window !== 'undefined') {
  window.FlightLog = FlightLog;
  window.FlightRecord = FlightRecord;
  window.PredictionAnalyzer = PredictionAnalyzer;
  window.FLIGHT_OUTCOMES = FLIGHT_OUTCOMES;
}

export {
  FlightLog,
  FlightRecord,
  PredictionAnalyzer,
  FLIGHT_OUTCOMES,
  ACCURACY_THRESHOLDS
};

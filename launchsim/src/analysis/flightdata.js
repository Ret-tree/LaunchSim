/**
 * LAUNCHSIM Flight Data Import
 * ============================
 * 
 * Import and compare actual flight data with simulations.
 * Supports multiple altimeter file formats.
 * 
 * Supported Formats:
 * - CSV (generic altitude vs time)
 * - PerfectFlite (.pf)
 * - Eggtimer (.csv)
 * - Featherweight (.csv)
 * - AltimeterTwo (.csv)
 * - OpenRocket export (.csv)
 * 
 * Usage:
 *   const importer = new FlightDataImporter();
 *   const flightData = await importer.importFile(file);
 *   const comparison = FlightComparison.compare(simData, flightData);
 */

// Debug mode
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[FlightData]', ...args),
  warn: (...args) => console.warn('[FlightData]', ...args),
  error: (...args) => console.error('[FlightData]', ...args)
};

// ============================================
// Constants
// ============================================

const FEET_TO_METERS = 0.3048;
const METERS_TO_FEET = 3.28084;

// Known altimeter formats with their signatures
const FORMAT_SIGNATURES = {
  perfectflite: {
    headerPatterns: ['PerfectFlite', 'StratoLogger', 'miniAlt'],
    columnPatterns: ['Time', 'Altitude', 'Velocity']
  },
  eggtimer: {
    headerPatterns: ['Eggtimer', 'EggFinder'],
    columnPatterns: ['time', 'altitude', 'velocity', 'temperature']
  },
  featherweight: {
    headerPatterns: ['Featherweight', 'Raven'],
    columnPatterns: ['Time(s)', 'Alt(ft)', 'Vel(ft/s)']
  },
  altimetertwo: {
    headerPatterns: ['AltimeterTwo', 'Alt2'],
    columnPatterns: ['Time', 'Baro Alt', 'Accel']
  },
  openrocket: {
    headerPatterns: ['# OpenRocket', '# Time'],
    columnPatterns: ['Time', 'Altitude', 'Vertical velocity']
  }
};

// ============================================
// Flight Data Parser
// ============================================

class FlightDataParser {
  /**
   * Parse CSV content into flight data
   */
  static parseCSV(content, options = {}) {
    const lines = content.trim().split('\n');
    const delimiter = options.delimiter || this.detectDelimiter(content);
    
    // Find header row and data start
    let headerIndex = 0;
    let headers = [];
    
    for (let i = 0; i < Math.min(lines.length, 20); i++) {
      const line = lines[i].trim();
      
      // Skip comment lines
      if (line.startsWith('#') || line.startsWith('//')) {
        headerIndex = i + 1;
        continue;
      }
      
      // Check if this looks like a header row
      const parts = line.split(delimiter).map(s => s.trim());
      if (parts.some(p => /^[a-zA-Z]/.test(p) && !/^\d/.test(p))) {
        headers = parts;
        headerIndex = i;
        break;
      }
    }
    
    // If no headers found, use default
    if (headers.length === 0) {
      headers = ['time', 'altitude', 'velocity'];
      headerIndex = -1;
    }
    
    // Normalize header names
    const normalizedHeaders = headers.map(h => this.normalizeColumnName(h));
    
    // Parse data rows
    const data = [];
    const startRow = headerIndex + 1;
    
    for (let i = startRow; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line || line.startsWith('#')) continue;
      
      const parts = line.split(delimiter).map(s => s.trim());
      if (parts.length < 2) continue;
      
      const row = {};
      for (let j = 0; j < normalizedHeaders.length && j < parts.length; j++) {
        const value = parseFloat(parts[j]);
        if (!isNaN(value)) {
          row[normalizedHeaders[j]] = value;
        }
      }
      
      // Must have at least time and altitude
      if (row.time !== undefined && row.altitude !== undefined) {
        data.push(row);
      }
    }
    
    return {
      headers: normalizedHeaders,
      data,
      rowCount: data.length
    };
  }
  
  /**
   * Detect CSV delimiter
   */
  static detectDelimiter(content) {
    const firstLines = content.split('\n').slice(0, 5).join('\n');
    const commas = (firstLines.match(/,/g) || []).length;
    const tabs = (firstLines.match(/\t/g) || []).length;
    const semicolons = (firstLines.match(/;/g) || []).length;
    
    if (tabs > commas && tabs > semicolons) return '\t';
    if (semicolons > commas) return ';';
    return ',';
  }
  
  /**
   * Normalize column names to standard format
   */
  static normalizeColumnName(name) {
    const lower = name.toLowerCase().trim();
    
    // Time columns
    if (/^t$|time|^t\(|sec|tiempo/.test(lower)) return 'time';
    
    // Altitude columns
    if (/alt|height|elevation|altura|baro/.test(lower)) return 'altitude';
    
    // Velocity columns
    if (/vel|speed|rate|velocidad/.test(lower)) return 'velocity';
    
    // Acceleration columns
    if (/acc|accel|^a$|^g$/.test(lower)) return 'acceleration';
    
    // Temperature columns
    if (/temp|temperature/.test(lower)) return 'temperature';
    
    // Pressure columns
    if (/press|pressure|baro/.test(lower) && !/alt/.test(lower)) return 'pressure';
    
    return lower.replace(/[^a-z0-9]/g, '_');
  }
  
  /**
   * Detect file format from content
   */
  static detectFormat(content) {
    const upperContent = content.toUpperCase();
    const firstLines = content.split('\n').slice(0, 10).join('\n');
    
    for (const [format, sig] of Object.entries(FORMAT_SIGNATURES)) {
      // Check header patterns
      for (const pattern of sig.headerPatterns) {
        if (upperContent.includes(pattern.toUpperCase())) {
          return format;
        }
      }
    }
    
    return 'generic';
  }
  
  /**
   * Detect altitude units from content
   */
  static detectUnits(content, headers) {
    const lower = content.toLowerCase();
    
    // Check headers for unit hints
    for (const h of headers) {
      if (/\(ft\)|feet|ft\/s/.test(h.toLowerCase())) return 'feet';
      if (/\(m\)|meter|m\/s/.test(h.toLowerCase())) return 'meters';
    }
    
    // Check content
    if (/feet|ft[\s\)]/i.test(lower)) return 'feet';
    if (/meters|m[\s\)]/i.test(lower)) return 'meters';
    
    // Default based on typical values (if max altitude > 1000, probably feet)
    return 'unknown';
  }
}

// ============================================
// Flight Data Importer
// ============================================

class FlightDataImporter {
  constructor(options = {}) {
    this.options = {
      defaultUnits: options.defaultUnits || 'feet',
      autoDetectUnits: options.autoDetectUnits !== false,
      ...options
    };
  }
  
  /**
   * Import flight data from File object
   */
  async importFile(file) {
    const content = await this.readFile(file);
    return this.parseContent(content, file.name);
  }
  
  /**
   * Import flight data from URL
   */
  async importFromURL(url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }
    const content = await response.text();
    const filename = url.split('/').pop() || 'flight.csv';
    return this.parseContent(content, filename);
  }
  
  /**
   * Import flight data from string content
   */
  parseContent(content, filename = 'flight.csv') {
    // Detect format
    const format = FlightDataParser.detectFormat(content);
    log.debug(`Detected format: ${format}`);
    
    // Parse CSV
    const parsed = FlightDataParser.parseCSV(content);
    
    if (parsed.data.length === 0) {
      throw new Error('No valid data rows found');
    }
    
    // Detect units
    let units = FlightDataParser.detectUnits(content, parsed.headers);
    if (units === 'unknown') {
      // Guess based on max altitude
      const maxAlt = Math.max(...parsed.data.map(d => d.altitude));
      units = maxAlt > 500 ? 'feet' : 'meters'; // Rough heuristic
    }
    
    // Convert to standard format (meters)
    const conversionFactor = units === 'feet' ? FEET_TO_METERS : 1;
    
    const trajectory = parsed.data.map(row => ({
      time: row.time,
      altitude: row.altitude * conversionFactor,
      altitudeFeet: row.altitude * (units === 'feet' ? 1 : METERS_TO_FEET),
      velocity: row.velocity ? row.velocity * conversionFactor : null,
      acceleration: row.acceleration || null,
      temperature: row.temperature || null
    }));
    
    // Calculate derived values
    const analysis = this.analyzeFlightData(trajectory);
    
    return {
      filename,
      format,
      originalUnits: units,
      headers: parsed.headers,
      rowCount: trajectory.length,
      trajectory,
      analysis,
      raw: parsed.data
    };
  }
  
  /**
   * Read file content
   */
  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }
  
  /**
   * Analyze flight data to extract key metrics
   */
  analyzeFlightData(trajectory) {
    if (trajectory.length === 0) {
      return null;
    }
    
    // Find apogee
    let maxAltitude = 0;
    let apogeeIndex = 0;
    let apogeeTime = 0;
    
    for (let i = 0; i < trajectory.length; i++) {
      if (trajectory[i].altitude > maxAltitude) {
        maxAltitude = trajectory[i].altitude;
        apogeeIndex = i;
        apogeeTime = trajectory[i].time;
      }
    }
    
    // Find max velocity
    let maxVelocity = 0;
    let maxVelocityTime = 0;
    
    for (const point of trajectory) {
      if (point.velocity && Math.abs(point.velocity) > maxVelocity) {
        maxVelocity = Math.abs(point.velocity);
        maxVelocityTime = point.time;
      }
    }
    
    // Estimate burnout (velocity peak or inflection)
    let burnoutTime = 0;
    let burnoutAltitude = 0;
    let burnoutVelocity = 0;
    
    for (let i = 1; i < trajectory.length - 1; i++) {
      const prev = trajectory[i - 1].velocity || 0;
      const curr = trajectory[i].velocity || 0;
      const next = trajectory[i + 1].velocity || 0;
      
      // Look for velocity peak
      if (curr > prev && curr > next) {
        burnoutTime = trajectory[i].time;
        burnoutAltitude = trajectory[i].altitude;
        burnoutVelocity = curr;
        break;
      }
    }
    
    // If no velocity data, estimate from altitude
    if (!burnoutTime && trajectory.length > 3) {
      // Find point where altitude rate starts decreasing
      for (let i = 2; i < Math.min(trajectory.length, apogeeIndex); i++) {
        const dt1 = trajectory[i].time - trajectory[i - 1].time;
        const dt2 = trajectory[i + 1].time - trajectory[i].time;
        if (dt1 === 0 || dt2 === 0) continue;
        
        const rate1 = (trajectory[i].altitude - trajectory[i - 1].altitude) / dt1;
        const rate2 = (trajectory[i + 1].altitude - trajectory[i].altitude) / dt2;
        
        if (rate2 < rate1 && trajectory[i].time > 0.5) {
          burnoutTime = trajectory[i].time;
          burnoutAltitude = trajectory[i].altitude;
          burnoutVelocity = rate1;
          break;
        }
      }
    }
    
    // Flight duration
    const flightTime = trajectory[trajectory.length - 1].time;
    
    // Descent rate (average in last 30% of flight)
    const descentStart = Math.floor(trajectory.length * 0.7);
    let descentRates = [];
    for (let i = descentStart; i < trajectory.length - 1; i++) {
      const dt = trajectory[i + 1].time - trajectory[i].time;
      if (dt > 0) {
        const rate = (trajectory[i].altitude - trajectory[i + 1].altitude) / dt;
        if (rate > 0) descentRates.push(rate);
      }
    }
    const avgDescentRate = descentRates.length > 0
      ? descentRates.reduce((a, b) => a + b, 0) / descentRates.length
      : 0;
    
    return {
      apogee: maxAltitude,
      apogeeFeet: maxAltitude * METERS_TO_FEET,
      apogeeTime,
      apogeeIndex,
      
      burnout: {
        time: burnoutTime,
        altitude: burnoutAltitude,
        velocity: burnoutVelocity
      },
      
      maxVelocity,
      maxVelocityTime,
      
      flightTime,
      ascentTime: apogeeTime,
      descentTime: flightTime - apogeeTime,
      
      avgDescentRate,
      avgDescentRateFps: avgDescentRate * METERS_TO_FEET,
      
      dataPoints: trajectory.length,
      sampleRate: trajectory.length / flightTime
    };
  }
}

// ============================================
// Flight Comparison
// ============================================

class FlightComparison {
  /**
   * Compare simulation results to actual flight data
   */
  static compare(simData, flightData) {
    // Normalize inputs
    const simTrajectory = this.normalizeSimTrajectory(simData);
    const actualTrajectory = flightData.trajectory;
    const actualAnalysis = flightData.analysis;
    
    // Get simulation analysis
    const simAnalysis = this.analyzeSimulation(simTrajectory);
    
    // Compute point-by-point errors
    const errors = this.computeErrors(simTrajectory, actualTrajectory);
    
    // Compute key metric differences
    const metricDiffs = {
      apogee: {
        sim: simAnalysis.apogee,
        actual: actualAnalysis.apogee,
        error: simAnalysis.apogee - actualAnalysis.apogee,
        errorPercent: ((simAnalysis.apogee - actualAnalysis.apogee) / actualAnalysis.apogee) * 100
      },
      apogeeTime: {
        sim: simAnalysis.apogeeTime,
        actual: actualAnalysis.apogeeTime,
        error: simAnalysis.apogeeTime - actualAnalysis.apogeeTime
      },
      flightTime: {
        sim: simAnalysis.flightTime,
        actual: actualAnalysis.flightTime,
        error: simAnalysis.flightTime - actualAnalysis.flightTime
      },
      maxVelocity: {
        sim: simAnalysis.maxVelocity,
        actual: actualAnalysis.maxVelocity,
        error: simAnalysis.maxVelocity - actualAnalysis.maxVelocity,
        errorPercent: actualAnalysis.maxVelocity ? 
          ((simAnalysis.maxVelocity - actualAnalysis.maxVelocity) / actualAnalysis.maxVelocity) * 100 : null
      }
    };
    
    // Overall accuracy score
    const accuracyScore = this.computeAccuracyScore(metricDiffs, errors);
    
    return {
      simulation: simAnalysis,
      actual: actualAnalysis,
      metrics: metricDiffs,
      errors,
      accuracyScore,
      
      // Interpolated trajectories for plotting
      alignedData: this.alignTrajectories(simTrajectory, actualTrajectory)
    };
  }
  
  /**
   * Normalize simulation trajectory format
   */
  static normalizeSimTrajectory(simData) {
    // Handle different simulation output formats
    if (Array.isArray(simData)) {
      return simData;
    }
    
    if (simData.trajectory) {
      return simData.trajectory;
    }
    
    // Convert from object format
    if (simData.time && simData.altitude) {
      const result = [];
      for (let i = 0; i < simData.time.length; i++) {
        result.push({
          time: simData.time[i],
          altitude: simData.altitude[i],
          velocity: simData.velocity ? simData.velocity[i] : null
        });
      }
      return result;
    }
    
    return [];
  }
  
  /**
   * Analyze simulation trajectory
   */
  static analyzeSimulation(trajectory) {
    if (trajectory.length === 0) {
      return { apogee: 0, apogeeTime: 0, flightTime: 0, maxVelocity: 0 };
    }
    
    let apogee = 0;
    let apogeeTime = 0;
    let maxVelocity = 0;
    
    for (const point of trajectory) {
      const alt = point.altitude || point.z || 0;
      if (alt > apogee) {
        apogee = alt;
        apogeeTime = point.time || point.t || 0;
      }
      
      const vel = point.velocity || point.vz || 0;
      if (Math.abs(vel) > maxVelocity) {
        maxVelocity = Math.abs(vel);
      }
    }
    
    const lastPoint = trajectory[trajectory.length - 1];
    const flightTime = lastPoint.time || lastPoint.t || 0;
    
    return { apogee, apogeeTime, flightTime, maxVelocity };
  }
  
  /**
   * Compute errors between trajectories
   */
  static computeErrors(simTraj, actualTraj) {
    if (simTraj.length === 0 || actualTraj.length === 0) {
      return { rmse: 0, maxError: 0, meanError: 0 };
    }
    
    // Interpolate simulation to actual time points
    const errors = [];
    
    for (const actual of actualTraj) {
      const t = actual.time;
      const actualAlt = actual.altitude;
      
      // Find bracketing sim points
      let simAlt = this.interpolateAltitude(simTraj, t);
      
      if (simAlt !== null) {
        const error = simAlt - actualAlt;
        errors.push({
          time: t,
          simAltitude: simAlt,
          actualAltitude: actualAlt,
          error,
          errorPercent: actualAlt !== 0 ? (error / actualAlt) * 100 : 0
        });
      }
    }
    
    if (errors.length === 0) {
      return { rmse: 0, maxError: 0, meanError: 0, points: [] };
    }
    
    // Calculate statistics
    const absErrors = errors.map(e => Math.abs(e.error));
    const squaredErrors = errors.map(e => e.error * e.error);
    
    const meanError = errors.reduce((sum, e) => sum + e.error, 0) / errors.length;
    const meanAbsError = absErrors.reduce((a, b) => a + b, 0) / absErrors.length;
    const maxError = Math.max(...absErrors);
    const rmse = Math.sqrt(squaredErrors.reduce((a, b) => a + b, 0) / squaredErrors.length);
    
    return {
      rmse,
      rmseFeet: rmse * METERS_TO_FEET,
      maxError,
      maxErrorFeet: maxError * METERS_TO_FEET,
      meanError,
      meanAbsError,
      points: errors
    };
  }
  
  /**
   * Interpolate altitude at given time
   */
  static interpolateAltitude(trajectory, time) {
    if (trajectory.length === 0) return null;
    
    // Find bracketing points
    let before = null;
    let after = null;
    
    for (let i = 0; i < trajectory.length; i++) {
      const t = trajectory[i].time || trajectory[i].t || 0;
      if (t <= time) before = trajectory[i];
      if (t >= time && !after) after = trajectory[i];
    }
    
    if (!before && !after) return null;
    if (!before) return after.altitude || after.z || 0;
    if (!after) return before.altitude || before.z || 0;
    
    const t0 = before.time || before.t || 0;
    const t1 = after.time || after.t || 0;
    const a0 = before.altitude || before.z || 0;
    const a1 = after.altitude || after.z || 0;
    
    if (t1 === t0) return a0;
    
    const fraction = (time - t0) / (t1 - t0);
    return a0 + fraction * (a1 - a0);
  }
  
  /**
   * Align trajectories for plotting
   */
  static alignTrajectories(simTraj, actualTraj) {
    // Create common time base
    const simTimes = simTraj.map(p => p.time || p.t || 0);
    const actualTimes = actualTraj.map(p => p.time);
    
    const minTime = 0;
    const maxTime = Math.max(
      simTimes[simTimes.length - 1] || 0,
      actualTimes[actualTimes.length - 1] || 0
    );
    
    const numPoints = 100;
    const dt = maxTime / numPoints;
    
    const aligned = [];
    for (let i = 0; i <= numPoints; i++) {
      const t = i * dt;
      aligned.push({
        time: t,
        simAltitude: this.interpolateAltitude(simTraj, t),
        actualAltitude: this.interpolateAltitude(actualTraj, t)
      });
    }
    
    return aligned;
  }
  
  /**
   * Compute overall accuracy score (0-100)
   */
  static computeAccuracyScore(metrics, errors) {
    let score = 100;
    
    // Penalize apogee error (most important)
    const apogeeErrorPercent = Math.abs(metrics.apogee.errorPercent || 0);
    score -= Math.min(40, apogeeErrorPercent * 2);
    
    // Penalize time errors
    const timeError = Math.abs(metrics.apogeeTime.error || 0);
    score -= Math.min(20, timeError * 5);
    
    // Penalize RMSE
    const rmseMeters = errors.rmse || 0;
    score -= Math.min(20, rmseMeters / 5);
    
    // Penalize velocity error
    const velErrorPercent = Math.abs(metrics.maxVelocity.errorPercent || 0);
    score -= Math.min(20, velErrorPercent);
    
    return Math.max(0, Math.round(score));
  }
}

// ============================================
// Flight Data UI Component
// ============================================

class FlightDataUI {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = null;
    this.importer = new FlightDataImporter();
    this.flightData = null;
    this.comparison = null;
    this.onImport = options.onImport || (() => {});
    this.simulationData = options.simulationData || null;
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
  
  setSimulationData(data) {
    this.simulationData = data;
    if (this.flightData) {
      this.runComparison();
    }
  }
  
  render() {
    this.container.innerHTML = `
      <div class="flight-data-ui">
        <div class="fd-header">
          <h3>📊 Flight Data Import</h3>
          <p>Compare simulation with actual flight data</p>
        </div>
        
        <div class="fd-import">
          <div class="fd-dropzone" id="fd-dropzone">
            <span class="fd-icon">📈</span>
            <span class="fd-text">Drop flight data file or click to import</span>
            <span class="fd-formats">CSV, PerfectFlite, Eggtimer, Featherweight</span>
            <input type="file" id="fd-file-input" accept=".csv,.txt,.pf" hidden>
          </div>
        </div>
        
        <div class="fd-analysis" id="fd-analysis" style="display: none;">
          <h4>Flight Analysis</h4>
          <div id="fd-stats"></div>
        </div>
        
        <div class="fd-comparison" id="fd-comparison" style="display: none;">
          <h4>Simulation Comparison</h4>
          <div id="fd-comparison-results"></div>
          <canvas id="fd-comparison-chart" width="600" height="300"></canvas>
        </div>
      </div>
    `;
  }
  
  setupEventListeners() {
    const dropzone = this.container.querySelector('#fd-dropzone');
    const fileInput = this.container.querySelector('#fd-file-input');
    
    dropzone?.addEventListener('click', () => fileInput?.click());
    
    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    
    dropzone?.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });
    
    dropzone?.addEventListener('drop', async (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        await this.handleFileImport(e.dataTransfer.files[0]);
      }
    });
    
    fileInput?.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        await this.handleFileImport(e.target.files[0]);
      }
    });
  }
  
  async handleFileImport(file) {
    try {
      this.flightData = await this.importer.importFile(file);
      this.renderAnalysis();
      this.onImport(this.flightData);
      
      if (this.simulationData) {
        this.runComparison();
      }
    } catch (error) {
      log.error('Import failed:', error);
      alert(`Failed to import flight data: ${error.message}`);
    }
  }
  
  renderAnalysis() {
    const section = this.container.querySelector('#fd-analysis');
    const statsEl = this.container.querySelector('#fd-stats');
    
    if (!section || !statsEl || !this.flightData) return;
    
    const a = this.flightData.analysis;
    
    statsEl.innerHTML = `
      <div class="fd-stats-grid">
        <div class="fd-stat">
          <span class="fd-stat-value">${a.apogeeFeet.toFixed(0)} ft</span>
          <span class="fd-stat-label">Apogee</span>
        </div>
        <div class="fd-stat">
          <span class="fd-stat-value">${a.apogeeTime.toFixed(2)} s</span>
          <span class="fd-stat-label">Time to Apogee</span>
        </div>
        <div class="fd-stat">
          <span class="fd-stat-value">${a.flightTime.toFixed(1)} s</span>
          <span class="fd-stat-label">Flight Time</span>
        </div>
        <div class="fd-stat">
          <span class="fd-stat-value">${a.avgDescentRateFps.toFixed(1)} ft/s</span>
          <span class="fd-stat-label">Descent Rate</span>
        </div>
      </div>
      
      <div class="fd-details">
        <p><strong>File:</strong> ${this.flightData.filename}</p>
        <p><strong>Format:</strong> ${this.flightData.format}</p>
        <p><strong>Data Points:</strong> ${this.flightData.rowCount}</p>
        <p><strong>Original Units:</strong> ${this.flightData.originalUnits}</p>
        ${a.burnout.time ? `<p><strong>Est. Burnout:</strong> ${a.burnout.time.toFixed(2)}s at ${(a.burnout.altitude * METERS_TO_FEET).toFixed(0)} ft</p>` : ''}
      </div>
    `;
    
    section.style.display = 'block';
  }
  
  runComparison() {
    if (!this.flightData || !this.simulationData) return;
    
    this.comparison = FlightComparison.compare(this.simulationData, this.flightData);
    this.renderComparison();
    this.renderComparisonChart();
  }
  
  renderComparison() {
    const section = this.container.querySelector('#fd-comparison');
    const resultsEl = this.container.querySelector('#fd-comparison-results');
    
    if (!section || !resultsEl || !this.comparison) return;
    
    const c = this.comparison;
    const scoreClass = c.accuracyScore >= 80 ? 'good' : c.accuracyScore >= 60 ? 'fair' : 'poor';
    
    resultsEl.innerHTML = `
      <div class="fd-score ${scoreClass}">
        <span class="score-value">${c.accuracyScore}</span>
        <span class="score-label">Accuracy Score</span>
      </div>
      
      <table class="fd-metrics-table">
        <tr>
          <th>Metric</th>
          <th>Simulation</th>
          <th>Actual</th>
          <th>Error</th>
        </tr>
        <tr>
          <td>Apogee</td>
          <td>${(c.simulation.apogee * METERS_TO_FEET).toFixed(0)} ft</td>
          <td>${(c.actual.apogee * METERS_TO_FEET).toFixed(0)} ft</td>
          <td class="${Math.abs(c.metrics.apogee.errorPercent) < 5 ? 'good' : 'warn'}">
            ${c.metrics.apogee.errorPercent >= 0 ? '+' : ''}${c.metrics.apogee.errorPercent.toFixed(1)}%
          </td>
        </tr>
        <tr>
          <td>Time to Apogee</td>
          <td>${c.simulation.apogeeTime.toFixed(2)} s</td>
          <td>${c.actual.apogeeTime.toFixed(2)} s</td>
          <td>${c.metrics.apogeeTime.error >= 0 ? '+' : ''}${c.metrics.apogeeTime.error.toFixed(2)} s</td>
        </tr>
        <tr>
          <td>Flight Time</td>
          <td>${c.simulation.flightTime.toFixed(1)} s</td>
          <td>${c.actual.flightTime.toFixed(1)} s</td>
          <td>${c.metrics.flightTime.error >= 0 ? '+' : ''}${c.metrics.flightTime.error.toFixed(1)} s</td>
        </tr>
        <tr>
          <td>RMSE</td>
          <td colspan="2" style="text-align: center;">—</td>
          <td>${c.errors.rmseFeet.toFixed(1)} ft</td>
        </tr>
      </table>
    `;
    
    section.style.display = 'block';
  }
  
  renderComparisonChart() {
    const canvas = this.container.querySelector('#fd-comparison-chart');
    if (!canvas || !this.comparison) return;
    
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const padding = 50;
    
    // Clear
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, w, h);
    
    const data = this.comparison.alignedData;
    
    // Find scales
    const maxTime = Math.max(...data.map(d => d.time));
    const maxAlt = Math.max(
      ...data.map(d => Math.max(d.simAltitude || 0, d.actualAltitude || 0))
    ) * 1.1;
    
    // Draw grid
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 5; i++) {
      const y = padding + (i / 5) * (h - 2 * padding);
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(w - padding, y);
      ctx.stroke();
    }
    
    // Draw simulation line
    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((d, i) => {
      if (d.simAltitude === null) return;
      const x = padding + (d.time / maxTime) * (w - 2 * padding);
      const y = h - padding - (d.simAltitude / maxAlt) * (h - 2 * padding);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    
    // Draw actual flight line
    ctx.strokeStyle = '#ff6b35';
    ctx.lineWidth = 2;
    ctx.beginPath();
    data.forEach((d, i) => {
      if (d.actualAltitude === null) return;
      const x = padding + (d.time / maxTime) * (w - 2 * padding);
      const y = h - padding - (d.actualAltitude / maxAlt) * (h - 2 * padding);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    
    // Legend
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#2196f3';
    ctx.fillRect(w - 120, 10, 15, 3);
    ctx.fillStyle = '#333';
    ctx.fillText('Simulation', w - 100, 15);
    
    ctx.fillStyle = '#ff6b35';
    ctx.fillRect(w - 120, 25, 15, 3);
    ctx.fillStyle = '#333';
    ctx.fillText('Actual', w - 100, 30);
    
    // Axes labels
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.fillText('Time (s)', w / 2, h - 10);
    
    ctx.save();
    ctx.translate(15, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Altitude (m)', 0, 0);
    ctx.restore();
  }
}

// ============================================
// Exports
// ============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FlightDataImporter,
    FlightDataParser,
    FlightComparison,
    FlightDataUI
  };
}

if (typeof window !== 'undefined') {
  window.FlightDataImporter = FlightDataImporter;
  window.FlightDataParser = FlightDataParser;
  window.FlightComparison = FlightComparison;
  window.FlightDataUI = FlightDataUI;
}

export { 
  FlightDataImporter, 
  FlightDataParser, 
  FlightComparison, 
  FlightDataUI 
};

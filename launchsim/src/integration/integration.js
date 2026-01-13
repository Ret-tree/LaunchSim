/**
 * LaunchSim Integration Module
 * ============================
 * 
 * Provides integration with external devices and services:
 * - Altimeter data import (StratoLogger, Eggtimer, PerfectFlite, Jolly Logic, etc.)
 * - GPS tracking integration
 * - Club/competition sharing
 * 
 * @module integration
 */

const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[Integration]', ...args),
  info: (...args) => console.log('[Integration]', ...args),
  warn: (...args) => console.warn('[Integration]', ...args),
  error: (...args) => console.error('[Integration]', ...args)
};

// ============================================
// Altimeter Data Formats
// ============================================

const ALTIMETER_FORMATS = {
  STRATOLOGGER: {
    name: 'PerfectFlite StratoLogger',
    extensions: ['.csv', '.txt'],
    delimiter: ',',
    columns: ['time', 'altitude', 'velocity', 'temperature'],
    timeUnit: 's',
    altitudeUnit: 'ft',
    velocityUnit: 'fps',
    headerLines: 1
  },
  STRATOLOGGER_CF: {
    name: 'PerfectFlite StratoLoggerCF',
    extensions: ['.csv', '.txt'],
    delimiter: ',',
    columns: ['time', 'altitude', 'velocity', 'acceleration'],
    timeUnit: 's',
    altitudeUnit: 'ft',
    velocityUnit: 'fps',
    accelerationUnit: 'g',
    headerLines: 1
  },
  EGGTIMER: {
    name: 'Eggtimer Rocketry',
    extensions: ['.csv', '.txt', '.log'],
    delimiter: ',',
    columns: ['time', 'altitude', 'velocity', 'state'],
    timeUnit: 'ms',
    altitudeUnit: 'ft',
    velocityUnit: 'fps',
    headerLines: 2
  },
  EGGTIMER_QUARK: {
    name: 'Eggtimer Quark',
    extensions: ['.csv'],
    delimiter: ',',
    columns: ['time', 'altitude', 'velocity', 'continuity1', 'continuity2', 'battery', 'state'],
    timeUnit: 'ms',
    altitudeUnit: 'ft',
    velocityUnit: 'fps',
    headerLines: 1
  },
  PERFECTFLITE: {
    name: 'PerfectFlite Pnut/miniAlt',
    extensions: ['.csv', '.txt'],
    delimiter: ',',
    columns: ['time', 'altitude'],
    timeUnit: 's',
    altitudeUnit: 'ft',
    headerLines: 1
  },
  JOLLY_LOGIC: {
    name: 'Jolly Logic AltimeterOne/Two/Three',
    extensions: ['.csv'],
    delimiter: ',',
    columns: ['time', 'altitude', 'velocity', 'acceleration'],
    timeUnit: 's',
    altitudeUnit: 'ft',
    velocityUnit: 'fps',
    accelerationUnit: 'g',
    headerLines: 1
  },
  ALTUS_METRUM: {
    name: 'Altus Metrum (TeleMega/TeleMetrum)',
    extensions: ['.csv', '.eeprom'],
    delimiter: ',',
    columns: ['time', 'altitude', 'velocity', 'acceleration', 'pressure', 'temperature', 'battery', 'state'],
    timeUnit: 's',
    altitudeUnit: 'm',
    velocityUnit: 'm/s',
    accelerationUnit: 'm/s²',
    headerLines: 1
  },
  FEATHERWEIGHT: {
    name: 'Featherweight Raven',
    extensions: ['.csv', '.txt'],
    delimiter: '\t',
    columns: ['time', 'altitude', 'velocity', 'ax', 'ay', 'az'],
    timeUnit: 's',
    altitudeUnit: 'ft',
    velocityUnit: 'fps',
    headerLines: 3
  },
  ENTACORE: {
    name: 'Entacore AIM/ARTS',
    extensions: ['.csv', '.txt'],
    delimiter: ',',
    columns: ['time', 'altitude', 'velocity'],
    timeUnit: 's',
    altitudeUnit: 'ft',
    velocityUnit: 'fps',
    headerLines: 1
  },
  MISSILEWORKS: {
    name: 'MissileWorks RRC3',
    extensions: ['.csv', '.txt'],
    delimiter: ',',
    columns: ['sample', 'altitude', 'velocity', 'state'],
    timeUnit: 'sample',
    sampleRate: 20,
    altitudeUnit: 'ft',
    velocityUnit: 'fps',
    headerLines: 0
  },
  GENERIC_CSV: {
    name: 'Generic CSV (Time, Altitude)',
    extensions: ['.csv', '.txt'],
    delimiter: ',',
    columns: ['time', 'altitude'],
    timeUnit: 's',
    altitudeUnit: 'm',
    headerLines: 1
  }
};

// ============================================
// Altimeter Data Importer
// ============================================

class AltimeterDataImporter {
  constructor(options = {}) {
    this.options = {
      autoDetect: true,
      defaultFormat: 'GENERIC_CSV',
      interpolateGaps: true,
      smoothData: true,
      smoothingWindow: 5,
      ...options
    };

    log.debug('AltimeterDataImporter initialized');
  }

  /**
   * Import altimeter data from file
   * @param {File|Blob} file - The file to import
   * @param {string} formatHint - Optional format hint
   * @returns {Promise<Object>} Parsed flight data
   */
  async importFile(file, formatHint = null) {
    const text = await this.readFile(file);
    const format = formatHint || this.detectFormat(text, file.name);
    
    log.debug(`Importing ${file.name} as ${format}`);
    
    const data = this.parseData(text, format);
    const analyzed = this.analyzeFlightData(data);
    
    return {
      source: 'altimeter',
      filename: file.name,
      format: format,
      formatName: ALTIMETER_FORMATS[format]?.name || 'Unknown',
      importedAt: new Date().toISOString(),
      rawData: data,
      trajectory: this.buildTrajectory(data),
      analysis: analyzed,
      events: this.detectEvents(data, analyzed)
    };
  }

  /**
   * Import from raw text
   */
  importText(text, format = null) {
    const detectedFormat = format || this.detectFormat(text, '');
    const data = this.parseData(text, detectedFormat);
    const analyzed = this.analyzeFlightData(data);
    
    return {
      source: 'altimeter',
      format: detectedFormat,
      formatName: ALTIMETER_FORMATS[detectedFormat]?.name || 'Unknown',
      importedAt: new Date().toISOString(),
      rawData: data,
      trajectory: this.buildTrajectory(data),
      analysis: analyzed,
      events: this.detectEvents(data, analyzed)
    };
  }

  readFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }

  /**
   * Auto-detect altimeter format from file content
   */
  detectFormat(text, filename = '') {
    const lines = text.trim().split('\n').slice(0, 10);
    const firstLine = lines[0]?.toLowerCase() || '';
    const ext = filename.toLowerCase().split('.').pop();

    // Check for specific format signatures
    if (firstLine.includes('stratologgercf') || firstLine.includes('slcf')) {
      return 'STRATOLOGGER_CF';
    }
    if (firstLine.includes('stratologger') || firstLine.includes('perfectflite')) {
      return 'STRATOLOGGER';
    }
    if (firstLine.includes('eggtimer') && firstLine.includes('quark')) {
      return 'EGGTIMER_QUARK';
    }
    if (firstLine.includes('eggtimer') || text.includes('EggTimer')) {
      return 'EGGTIMER';
    }
    if (firstLine.includes('jolly logic') || firstLine.includes('altimeter')) {
      return 'JOLLY_LOGIC';
    }
    if (firstLine.includes('telemega') || firstLine.includes('telemetrum') || firstLine.includes('altus')) {
      return 'ALTUS_METRUM';
    }
    if (firstLine.includes('featherweight') || firstLine.includes('raven')) {
      return 'FEATHERWEIGHT';
    }
    if (firstLine.includes('entacore') || firstLine.includes('arts')) {
      return 'ENTACORE';
    }
    if (firstLine.includes('missileworks') || firstLine.includes('rrc')) {
      return 'MISSILEWORKS';
    }

    // Check column count and delimiter
    const delimiter = text.includes('\t') ? '\t' : ',';
    const sampleLine = lines.find(l => !l.startsWith('#') && l.trim().length > 0);
    if (sampleLine) {
      const cols = sampleLine.split(delimiter).length;
      
      // StratoLoggerCF typically has 4 columns with acceleration
      if (cols >= 4 && delimiter === ',') {
        return 'STRATOLOGGER_CF';
      }
    }

    // Default to generic CSV
    return 'GENERIC_CSV';
  }

  /**
   * Parse data according to format specification
   */
  parseData(text, formatKey) {
    const format = ALTIMETER_FORMATS[formatKey] || ALTIMETER_FORMATS.GENERIC_CSV;
    const lines = text.trim().split('\n');
    const delimiter = format.delimiter || ',';
    const data = [];

    // Skip header lines
    const startLine = format.headerLines || 0;

    for (let i = startLine; i < lines.length; i++) {
      const line = lines[i].trim();
      
      // Skip empty lines and comments
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;
      
      const parts = line.split(delimiter).map(p => p.trim());
      if (parts.length < 2) continue;

      const point = this.parseLine(parts, format);
      if (point && !isNaN(point.time) && !isNaN(point.altitude)) {
        data.push(point);
      }
    }

    // Sort by time
    data.sort((a, b) => a.time - b.time);

    // Convert units to metric
    return this.convertToMetric(data, format);
  }

  parseLine(parts, format) {
    const point = {};
    const columns = format.columns || ['time', 'altitude'];

    columns.forEach((col, idx) => {
      if (idx < parts.length) {
        const value = parseFloat(parts[idx]);
        if (!isNaN(value)) {
          point[col] = value;
        } else if (col === 'state') {
          point[col] = parts[idx];
        }
      }
    });

    // Handle sample-based time
    if (format.timeUnit === 'sample' && point.sample !== undefined) {
      point.time = point.sample / (format.sampleRate || 20);
    }

    // Convert ms to seconds
    if (format.timeUnit === 'ms' && point.time !== undefined) {
      point.time = point.time / 1000;
    }

    return point;
  }

  convertToMetric(data, format) {
    const altFactor = this.getConversionFactor(format.altitudeUnit, 'm');
    const velFactor = this.getConversionFactor(format.velocityUnit, 'm/s');
    const accFactor = format.accelerationUnit === 'g' ? 9.80665 : 1;

    return data.map(point => ({
      time: point.time,
      altitude: point.altitude * altFactor,
      velocity: point.velocity !== undefined ? point.velocity * velFactor : undefined,
      acceleration: point.acceleration !== undefined ? point.acceleration * accFactor : undefined,
      temperature: point.temperature,
      pressure: point.pressure,
      state: point.state
    }));
  }

  getConversionFactor(from, to) {
    const conversions = {
      'ft_m': 0.3048,
      'm_m': 1,
      'fps_m/s': 0.3048,
      'm/s_m/s': 1,
      'mph_m/s': 0.44704,
      'kph_m/s': 0.27778
    };

    if (!from || from === to) return 1;
    return conversions[`${from}_${to}`] || 1;
  }

  /**
   * Build trajectory array for visualization
   */
  buildTrajectory(data) {
    return data.map((point, idx) => {
      // Estimate x position based on time (simple drift model)
      const driftRate = 2; // m/s horizontal drift estimate
      const x = point.time * driftRate;
      
      return {
        time: point.time,
        altitude: point.altitude,
        x: x,
        y: 0,
        velocity: point.velocity || this.estimateVelocity(data, idx),
        acceleration: point.acceleration
      };
    });
  }

  estimateVelocity(data, idx) {
    if (idx === 0 || idx >= data.length - 1) return 0;
    
    const dt = data[idx + 1].time - data[idx - 1].time;
    if (dt <= 0) return 0;
    
    const dAlt = data[idx + 1].altitude - data[idx - 1].altitude;
    return dAlt / dt;
  }

  /**
   * Analyze flight data to extract key metrics
   */
  analyzeFlightData(data) {
    if (!data || data.length === 0) {
      return { apogee: 0, maxVelocity: 0, flightTime: 0 };
    }

    let maxAltitude = 0;
    let maxAltitudeTime = 0;
    let maxVelocity = 0;
    let maxAcceleration = 0;

    data.forEach(point => {
      if (point.altitude > maxAltitude) {
        maxAltitude = point.altitude;
        maxAltitudeTime = point.time;
      }
      if (point.velocity !== undefined && Math.abs(point.velocity) > maxVelocity) {
        maxVelocity = Math.abs(point.velocity);
      }
      if (point.acceleration !== undefined && point.acceleration > maxAcceleration) {
        maxAcceleration = point.acceleration;
      }
    });

    const flightTime = data[data.length - 1]?.time || 0;
    
    // Estimate max velocity if not in data
    if (maxVelocity === 0 && data.length > 1) {
      for (let i = 1; i < data.length; i++) {
        const vel = Math.abs(this.estimateVelocity(data, i));
        if (vel > maxVelocity) maxVelocity = vel;
      }
    }

    return {
      apogee: maxAltitude,
      apogeeTime: maxAltitudeTime,
      maxVelocity: maxVelocity,
      maxAcceleration: maxAcceleration,
      flightTime: flightTime,
      dataPoints: data.length,
      sampleRate: data.length > 1 ? (data.length - 1) / flightTime : 0
    };
  }

  /**
   * Detect flight events from data
   */
  detectEvents(data, analysis) {
    const events = [];
    
    if (!data || data.length < 2) return events;

    // Detect launch (first significant altitude change)
    for (let i = 1; i < data.length; i++) {
      if (data[i].altitude > 5) {
        events.push({
          event: 'Launch',
          time: data[i].time,
          altitude: data[i].altitude
        });
        break;
      }
    }

    // Detect motor burnout (max velocity or max acceleration point)
    let burnoutIdx = 0;
    let maxVel = 0;
    for (let i = 0; i < data.length; i++) {
      const vel = data[i].velocity || this.estimateVelocity(data, i);
      if (vel > maxVel) {
        maxVel = vel;
        burnoutIdx = i;
      }
    }
    if (burnoutIdx > 0) {
      events.push({
        event: 'Motor Burnout',
        time: data[burnoutIdx].time,
        altitude: data[burnoutIdx].altitude
      });
    }

    // Detect apogee
    events.push({
      event: 'Apogee',
      time: analysis.apogeeTime,
      altitude: analysis.apogee
    });

    // Detect deployment events from state changes or velocity changes
    let foundDrogue = false;
    let foundMain = false;
    
    for (let i = 1; i < data.length; i++) {
      // Check for state changes
      if (data[i].state && data[i - 1].state && data[i].state !== data[i - 1].state) {
        const state = data[i].state.toLowerCase();
        if (state.includes('drogue') && !foundDrogue) {
          events.push({
            event: 'Drogue Deploy',
            time: data[i].time,
            altitude: data[i].altitude
          });
          foundDrogue = true;
        }
        if (state.includes('main') && !foundMain) {
          events.push({
            event: 'Main Deploy',
            time: data[i].time,
            altitude: data[i].altitude
          });
          foundMain = true;
        }
      }

      // Detect sudden velocity decrease (deployment)
      const vel = data[i].velocity || this.estimateVelocity(data, i);
      const prevVel = data[i - 1].velocity || this.estimateVelocity(data, i - 1);
      
      if (data[i].time > analysis.apogeeTime) {
        // After apogee, look for velocity changes
        if (prevVel < -30 && vel > -15 && !foundDrogue && data[i].altitude > 200) {
          events.push({
            event: 'Drogue Deploy',
            time: data[i].time,
            altitude: data[i].altitude
          });
          foundDrogue = true;
        }
        if (prevVel < -10 && vel > -5 && !foundMain && data[i].altitude < 200) {
          events.push({
            event: 'Main Deploy',
            time: data[i].time,
            altitude: data[i].altitude
          });
          foundMain = true;
        }
      }
    }

    // Detect landing
    const lastPoint = data[data.length - 1];
    if (lastPoint.altitude < 10) {
      events.push({
        event: 'Landing',
        time: lastPoint.time,
        altitude: lastPoint.altitude
      });
    }

    // Sort events by time
    events.sort((a, b) => a.time - b.time);
    
    return events;
  }

  /**
   * Get list of supported formats
   */
  getSupportedFormats() {
    return Object.entries(ALTIMETER_FORMATS).map(([key, format]) => ({
      id: key,
      name: format.name,
      extensions: format.extensions
    }));
  }
}

// ============================================
// GPS Tracker Integration
// ============================================

class GPSTracker {
  constructor(options = {}) {
    this.options = {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 10000,
      updateInterval: 1000,
      trackingMode: 'realtime', // realtime, playback
      ...options
    };

    this.isTracking = false;
    this.watchId = null;
    this.trackPoints = [];
    this.currentPosition = null;
    this.launchSite = null;
    this.listeners = new Set();
    this.lastUpdate = null;

    // Check for geolocation support
    this.isSupported = typeof navigator !== 'undefined' && 'geolocation' in navigator;

    log.debug('GPSTracker initialized, supported:', this.isSupported);
  }

  /**
   * Check if GPS is available
   */
  checkAvailability() {
    return new Promise((resolve) => {
      if (!this.isSupported) {
        resolve({ available: false, reason: 'Geolocation not supported' });
        return;
      }

      navigator.permissions?.query({ name: 'geolocation' })
        .then(result => {
          resolve({
            available: result.state !== 'denied',
            permission: result.state,
            reason: result.state === 'denied' ? 'Permission denied' : null
          });
        })
        .catch(() => {
          // Fallback for browsers without permissions API
          resolve({ available: true, permission: 'unknown' });
        });
    });
  }

  /**
   * Get current position once
   */
  getCurrentPosition() {
    return new Promise((resolve, reject) => {
      if (!this.isSupported) {
        reject(new Error('Geolocation not supported'));
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const pos = this.parsePosition(position);
          this.currentPosition = pos;
          resolve(pos);
        },
        (error) => {
          reject(this.parseError(error));
        },
        {
          enableHighAccuracy: this.options.enableHighAccuracy,
          maximumAge: this.options.maximumAge,
          timeout: this.options.timeout
        }
      );
    });
  }

  /**
   * Set launch site (reference point for distance calculations)
   */
  setLaunchSite(lat, lon, alt = 0) {
    this.launchSite = { lat, lon, alt };
    log.debug('Launch site set:', this.launchSite);
  }

  /**
   * Start real-time tracking
   */
  startTracking() {
    if (!this.isSupported) {
      throw new Error('Geolocation not supported');
    }

    if (this.isTracking) {
      log.warn('Already tracking');
      return;
    }

    this.isTracking = true;
    this.trackPoints = [];
    this.lastUpdate = Date.now();

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        const pos = this.parsePosition(position);
        this.currentPosition = pos;
        this.trackPoints.push(pos);
        this.lastUpdate = Date.now();
        this.notifyListeners('position', pos);
      },
      (error) => {
        this.notifyListeners('error', this.parseError(error));
      },
      {
        enableHighAccuracy: this.options.enableHighAccuracy,
        maximumAge: this.options.maximumAge,
        timeout: this.options.timeout
      }
    );

    log.debug('GPS tracking started');
    this.notifyListeners('start', { timestamp: Date.now() });
  }

  /**
   * Stop tracking
   */
  stopTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    this.isTracking = false;
    log.debug('GPS tracking stopped, points collected:', this.trackPoints.length);
    
    this.notifyListeners('stop', {
      timestamp: Date.now(),
      pointCount: this.trackPoints.length
    });

    return this.trackPoints;
  }

  /**
   * Parse native position object
   */
  parsePosition(position) {
    const coords = position.coords;
    const pos = {
      lat: coords.latitude,
      lon: coords.longitude,
      alt: coords.altitude || 0,
      accuracy: coords.accuracy,
      altitudeAccuracy: coords.altitudeAccuracy,
      heading: coords.heading,
      speed: coords.speed,
      timestamp: position.timestamp
    };

    // Calculate distance from launch site if set
    if (this.launchSite) {
      pos.distanceFromLaunch = this.calculateDistance(
        this.launchSite.lat, this.launchSite.lon,
        pos.lat, pos.lon
      );
      pos.bearing = this.calculateBearing(
        this.launchSite.lat, this.launchSite.lon,
        pos.lat, pos.lon
      );
    }

    return pos;
  }

  /**
   * Calculate distance between two points (Haversine formula)
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }

  /**
   * Calculate bearing between two points
   */
  calculateBearing(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) -
              Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    
    const θ = Math.atan2(y, x);
    return (θ * 180 / Math.PI + 360) % 360;
  }

  /**
   * Parse geolocation error
   */
  parseError(error) {
    const messages = {
      1: 'Permission denied',
      2: 'Position unavailable',
      3: 'Timeout'
    };
    return new Error(messages[error.code] || 'Unknown error');
  }

  /**
   * Add event listener
   */
  addListener(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /**
   * Notify all listeners
   */
  notifyListeners(event, data) {
    this.listeners.forEach(callback => {
      try {
        callback(event, data);
      } catch (e) {
        log.error('Listener error:', e);
      }
    });
  }

  /**
   * Get track summary
   */
  getTrackSummary() {
    if (this.trackPoints.length === 0) {
      return null;
    }

    let totalDistance = 0;
    let maxAltitude = 0;
    let maxSpeed = 0;

    for (let i = 1; i < this.trackPoints.length; i++) {
      const prev = this.trackPoints[i - 1];
      const curr = this.trackPoints[i];

      totalDistance += this.calculateDistance(prev.lat, prev.lon, curr.lat, curr.lon);
      maxAltitude = Math.max(maxAltitude, curr.alt);
      maxSpeed = Math.max(maxSpeed, curr.speed || 0);
    }

    const startPoint = this.trackPoints[0];
    const endPoint = this.trackPoints[this.trackPoints.length - 1];

    return {
      pointCount: this.trackPoints.length,
      totalDistance: totalDistance,
      maxAltitude: maxAltitude,
      maxSpeed: maxSpeed,
      startTime: startPoint.timestamp,
      endTime: endPoint.timestamp,
      duration: endPoint.timestamp - startPoint.timestamp,
      startPosition: { lat: startPoint.lat, lon: startPoint.lon },
      endPosition: { lat: endPoint.lat, lon: endPoint.lon },
      distanceFromStart: this.calculateDistance(
        startPoint.lat, startPoint.lon,
        endPoint.lat, endPoint.lon
      )
    };
  }

  /**
   * Export track as GPX
   */
  exportGPX(name = 'LaunchSim Track') {
    if (this.trackPoints.length === 0) {
      return null;
    }

    const points = this.trackPoints.map(p => `
      <trkpt lat="${p.lat}" lon="${p.lon}">
        <ele>${p.alt}</ele>
        <time>${new Date(p.timestamp).toISOString()}</time>
        ${p.speed ? `<speed>${p.speed}</speed>` : ''}
      </trkpt>`).join('');

    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="LaunchSim"
  xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
      ${points}
    </trkseg>
  </trk>
</gpx>`;
  }

  /**
   * Import track from GPX
   */
  importGPX(gpxText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(gpxText, 'text/xml');
    const trackPoints = doc.querySelectorAll('trkpt');
    
    this.trackPoints = Array.from(trackPoints).map(pt => ({
      lat: parseFloat(pt.getAttribute('lat')),
      lon: parseFloat(pt.getAttribute('lon')),
      alt: parseFloat(pt.querySelector('ele')?.textContent) || 0,
      timestamp: new Date(pt.querySelector('time')?.textContent).getTime() || Date.now(),
      speed: parseFloat(pt.querySelector('speed')?.textContent) || null
    }));

    return this.trackPoints;
  }

  /**
   * Get current state
   */
  getState() {
    return {
      isSupported: this.isSupported,
      isTracking: this.isTracking,
      currentPosition: this.currentPosition,
      launchSite: this.launchSite,
      pointCount: this.trackPoints.length,
      lastUpdate: this.lastUpdate
    };
  }

  dispose() {
    this.stopTracking();
    this.listeners.clear();
  }
}

// ============================================
// Club/Competition Sharing
// ============================================

class ClubSharing {
  constructor(options = {}) {
    this.options = {
      storagePrefix: 'launchsim_club_',
      maxSharedFlights: 100,
      ...options
    };

    this.clubs = [];
    this.sharedFlights = [];
    this.currentClub = null;

    this.loadClubs();
    log.debug('ClubSharing initialized');
  }

  // ============================================
  // Club Management
  // ============================================

  /**
   * Create a new club
   */
  createClub(clubData) {
    const club = {
      id: this.generateId('club'),
      createdAt: new Date().toISOString(),
      ...clubData,
      members: clubData.members || [],
      flights: [],
      competitions: [],
      settings: {
        allowPublicView: false,
        requireApproval: true,
        ...clubData.settings
      }
    };

    this.clubs.push(club);
    this.saveClubs();

    log.debug('Club created:', club.id);
    return club;
  }

  /**
   * Get club by ID
   */
  getClub(clubId) {
    return this.clubs.find(c => c.id === clubId);
  }

  /**
   * Update club
   */
  updateClub(clubId, updates) {
    const club = this.getClub(clubId);
    if (!club) return null;

    Object.assign(club, updates, { updatedAt: new Date().toISOString() });
    this.saveClubs();
    return club;
  }

  /**
   * Delete club
   */
  deleteClub(clubId) {
    const idx = this.clubs.findIndex(c => c.id === clubId);
    if (idx === -1) return false;

    this.clubs.splice(idx, 1);
    this.saveClubs();
    return true;
  }

  /**
   * Add member to club
   */
  addMember(clubId, member) {
    const club = this.getClub(clubId);
    if (!club) return null;

    const newMember = {
      id: this.generateId('member'),
      joinedAt: new Date().toISOString(),
      role: 'member',
      ...member
    };

    club.members.push(newMember);
    this.saveClubs();
    return newMember;
  }

  /**
   * Remove member from club
   */
  removeMember(clubId, memberId) {
    const club = this.getClub(clubId);
    if (!club) return false;

    const idx = club.members.findIndex(m => m.id === memberId);
    if (idx === -1) return false;

    club.members.splice(idx, 1);
    this.saveClubs();
    return true;
  }

  // ============================================
  // Flight Sharing
  // ============================================

  /**
   * Share a flight with club
   */
  shareFlightWithClub(clubId, flightData, metadata = {}) {
    const club = this.getClub(clubId);
    if (!club) throw new Error('Club not found');

    const sharedFlight = {
      id: this.generateId('flight'),
      clubId: clubId,
      sharedAt: new Date().toISOString(),
      sharedBy: metadata.userId || 'anonymous',
      metadata: {
        rocketName: metadata.rocketName || 'Unknown',
        motorName: metadata.motorName || 'Unknown',
        launchDate: metadata.launchDate || new Date().toISOString(),
        location: metadata.location || null,
        notes: metadata.notes || '',
        tags: metadata.tags || [],
        ...metadata
      },
      summary: {
        apogee: flightData.apogee || flightData.analysis?.apogee || 0,
        maxVelocity: flightData.maxVelocity || flightData.analysis?.maxVelocity || 0,
        flightTime: flightData.flightTime || flightData.analysis?.flightTime || 0
      },
      // Store sampled trajectory to reduce size
      trajectory: this.sampleTrajectory(flightData.trajectory, 100),
      events: flightData.events || []
    };

    club.flights.push(sharedFlight);
    this.saveClubs();

    log.debug('Flight shared with club:', clubId);
    return sharedFlight;
  }

  /**
   * Get club flights
   */
  getClubFlights(clubId, options = {}) {
    const club = this.getClub(clubId);
    if (!club) return [];

    let flights = [...club.flights];

    // Apply filters
    if (options.rocketName) {
      flights = flights.filter(f => 
        f.metadata.rocketName.toLowerCase().includes(options.rocketName.toLowerCase())
      );
    }
    if (options.motorName) {
      flights = flights.filter(f =>
        f.metadata.motorName.toLowerCase().includes(options.motorName.toLowerCase())
      );
    }
    if (options.startDate) {
      flights = flights.filter(f => new Date(f.metadata.launchDate) >= new Date(options.startDate));
    }
    if (options.endDate) {
      flights = flights.filter(f => new Date(f.metadata.launchDate) <= new Date(options.endDate));
    }
    if (options.userId) {
      flights = flights.filter(f => f.sharedBy === options.userId);
    }

    // Sort
    const sortField = options.sortBy || 'sharedAt';
    const sortOrder = options.sortOrder || 'desc';
    flights.sort((a, b) => {
      const aVal = a[sortField] || a.metadata[sortField] || a.summary[sortField];
      const bVal = b[sortField] || b.metadata[sortField] || b.summary[sortField];
      return sortOrder === 'desc' ? (bVal > aVal ? 1 : -1) : (aVal > bVal ? 1 : -1);
    });

    return flights;
  }

  /**
   * Remove shared flight
   */
  removeSharedFlight(clubId, flightId) {
    const club = this.getClub(clubId);
    if (!club) return false;

    const idx = club.flights.findIndex(f => f.id === flightId);
    if (idx === -1) return false;

    club.flights.splice(idx, 1);
    this.saveClubs();
    return true;
  }

  // ============================================
  // Competition Management
  // ============================================

  /**
   * Create a competition
   */
  createCompetition(clubId, competitionData) {
    const club = this.getClub(clubId);
    if (!club) throw new Error('Club not found');

    const competition = {
      id: this.generateId('comp'),
      clubId: clubId,
      createdAt: new Date().toISOString(),
      status: 'upcoming', // upcoming, active, completed
      entries: [],
      ...competitionData,
      rules: {
        targetAltitude: competitionData.targetAltitude || null,
        maxMotorClass: competitionData.maxMotorClass || null,
        scoringMethod: competitionData.scoringMethod || 'closest', // closest, highest, duration
        allowMultipleEntries: competitionData.allowMultipleEntries || false,
        ...competitionData.rules
      }
    };

    club.competitions.push(competition);
    this.saveClubs();

    log.debug('Competition created:', competition.id);
    return competition;
  }

  /**
   * Get competition
   */
  getCompetition(clubId, competitionId) {
    const club = this.getClub(clubId);
    if (!club) return null;
    return club.competitions.find(c => c.id === competitionId);
  }

  /**
   * Submit entry to competition
   */
  submitCompetitionEntry(clubId, competitionId, entryData) {
    const club = this.getClub(clubId);
    if (!club) throw new Error('Club not found');

    const competition = club.competitions.find(c => c.id === competitionId);
    if (!competition) throw new Error('Competition not found');

    if (competition.status !== 'active') {
      throw new Error('Competition is not active');
    }

    const entry = {
      id: this.generateId('entry'),
      submittedAt: new Date().toISOString(),
      userId: entryData.userId || 'anonymous',
      userName: entryData.userName || 'Anonymous',
      rocketName: entryData.rocketName,
      motorName: entryData.motorName,
      flightData: {
        apogee: entryData.apogee,
        maxVelocity: entryData.maxVelocity,
        flightTime: entryData.flightTime,
        landingDistance: entryData.landingDistance
      },
      score: this.calculateScore(competition, entryData),
      verified: false,
      notes: entryData.notes || ''
    };

    competition.entries.push(entry);
    this.saveClubs();

    return entry;
  }

  /**
   * Calculate competition score
   */
  calculateScore(competition, entryData) {
    const rules = competition.rules;
    
    switch (rules.scoringMethod) {
      case 'closest':
        // Score based on how close to target altitude
        if (!rules.targetAltitude) return entryData.apogee;
        const diff = Math.abs(entryData.apogee - rules.targetAltitude);
        return Math.max(0, 100 - diff);

      case 'highest':
        return entryData.apogee;

      case 'duration':
        return entryData.flightTime || 0;

      case 'tarc':
        // TARC-style scoring (48 + 52 points)
        const altTarget = rules.targetAltitude || 256; // meters (840 ft default)
        const timeTarget = rules.targetDuration || 43; // seconds
        
        const altError = Math.abs(entryData.apogee - altTarget);
        const timeError = Math.abs((entryData.flightTime || 0) - timeTarget);
        
        return altError + timeError; // Lower is better

      default:
        return entryData.apogee;
    }
  }

  /**
   * Get competition leaderboard
   */
  getLeaderboard(clubId, competitionId) {
    const competition = this.getCompetition(clubId, competitionId);
    if (!competition) return [];

    const entries = [...competition.entries];
    const isLowerBetter = competition.rules.scoringMethod === 'tarc';

    entries.sort((a, b) => isLowerBetter ? a.score - b.score : b.score - a.score);

    return entries.map((entry, idx) => ({
      rank: idx + 1,
      ...entry
    }));
  }

  /**
   * Update competition status
   */
  updateCompetitionStatus(clubId, competitionId, status) {
    const club = this.getClub(clubId);
    if (!club) return null;

    const competition = club.competitions.find(c => c.id === competitionId);
    if (!competition) return null;

    competition.status = status;
    competition.updatedAt = new Date().toISOString();
    
    if (status === 'completed') {
      competition.completedAt = new Date().toISOString();
      // Calculate final standings
      competition.finalStandings = this.getLeaderboard(clubId, competitionId);
    }

    this.saveClubs();
    return competition;
  }

  // ============================================
  // Export/Import
  // ============================================

  /**
   * Export club data for sharing
   */
  exportClub(clubId) {
    const club = this.getClub(clubId);
    if (!club) return null;

    return {
      exportVersion: '1.0',
      exportedAt: new Date().toISOString(),
      club: {
        name: club.name,
        description: club.description,
        location: club.location,
        createdAt: club.createdAt
      },
      flights: club.flights,
      competitions: club.competitions.map(c => ({
        ...c,
        entries: c.entries
      })),
      statistics: this.getClubStatistics(clubId)
    };
  }

  /**
   * Import club data
   */
  importClub(data) {
    if (!data.club) throw new Error('Invalid club data');

    const club = this.createClub(data.club);

    if (data.flights) {
      club.flights = data.flights;
    }

    if (data.competitions) {
      club.competitions = data.competitions;
    }

    this.saveClubs();
    return club;
  }

  /**
   * Generate shareable link (returns data as encoded string)
   */
  generateShareLink(clubId, flightId = null) {
    const club = this.getClub(clubId);
    if (!club) return null;

    let data;
    if (flightId) {
      const flight = club.flights.find(f => f.id === flightId);
      if (!flight) return null;
      data = { type: 'flight', flight };
    } else {
      data = { type: 'club', club: this.exportClub(clubId) };
    }

    const encoded = btoa(JSON.stringify(data));
    return `launchsim://share/${encoded}`;
  }

  /**
   * Parse share link
   */
  parseShareLink(link) {
    try {
      const encoded = link.replace('launchsim://share/', '');
      return JSON.parse(atob(encoded));
    } catch (e) {
      log.error('Failed to parse share link:', e);
      return null;
    }
  }

  // ============================================
  // Statistics
  // ============================================

  /**
   * Get club statistics
   */
  getClubStatistics(clubId) {
    const club = this.getClub(clubId);
    if (!club) return null;

    const flights = club.flights;
    
    if (flights.length === 0) {
      return {
        totalFlights: 0,
        memberCount: club.members.length,
        competitionCount: club.competitions.length
      };
    }

    const apogees = flights.map(f => f.summary.apogee).filter(a => a > 0);
    const velocities = flights.map(f => f.summary.maxVelocity).filter(v => v > 0);

    return {
      totalFlights: flights.length,
      memberCount: club.members.length,
      competitionCount: club.competitions.length,
      activeCompetitions: club.competitions.filter(c => c.status === 'active').length,
      averageApogee: apogees.length > 0 ? apogees.reduce((a, b) => a + b, 0) / apogees.length : 0,
      maxApogee: Math.max(...apogees, 0),
      averageVelocity: velocities.length > 0 ? velocities.reduce((a, b) => a + b, 0) / velocities.length : 0,
      maxVelocity: Math.max(...velocities, 0),
      flightsByMonth: this.getFlightsByMonth(flights),
      topRockets: this.getTopRockets(flights),
      topMotors: this.getTopMotors(flights)
    };
  }

  getFlightsByMonth(flights) {
    const months = {};
    flights.forEach(f => {
      const date = new Date(f.metadata.launchDate || f.sharedAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      months[key] = (months[key] || 0) + 1;
    });
    return months;
  }

  getTopRockets(flights) {
    const counts = {};
    flights.forEach(f => {
      const name = f.metadata.rocketName;
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  }

  getTopMotors(flights) {
    const counts = {};
    flights.forEach(f => {
      const name = f.metadata.motorName;
      counts[name] = (counts[name] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));
  }

  // ============================================
  // Storage
  // ============================================

  saveClubs() {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(this.options.storagePrefix + 'clubs', JSON.stringify(this.clubs));
    } catch (e) {
      log.error('Failed to save clubs:', e);
    }
  }

  loadClubs() {
    if (typeof localStorage === 'undefined') return;
    try {
      const data = localStorage.getItem(this.options.storagePrefix + 'clubs');
      this.clubs = data ? JSON.parse(data) : [];
    } catch (e) {
      log.error('Failed to load clubs:', e);
      this.clubs = [];
    }
  }

  sampleTrajectory(trajectory, maxPoints = 100) {
    if (!trajectory || trajectory.length <= maxPoints) return trajectory;
    
    const step = Math.ceil(trajectory.length / maxPoints);
    const sampled = [];
    
    for (let i = 0; i < trajectory.length; i += step) {
      sampled.push(trajectory[i]);
    }
    
    if (sampled[sampled.length - 1] !== trajectory[trajectory.length - 1]) {
      sampled.push(trajectory[trajectory.length - 1]);
    }
    
    return sampled;
  }

  generateId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get all clubs
   */
  getAllClubs() {
    return this.clubs;
  }

  dispose() {
    // Save any pending changes
    this.saveClubs();
  }
}

// ============================================
// Exports
// ============================================

export {
  AltimeterDataImporter,
  GPSTracker,
  ClubSharing,
  ALTIMETER_FORMATS
};

// CommonJS and browser globals
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    AltimeterDataImporter,
    GPSTracker,
    ClubSharing,
    ALTIMETER_FORMATS
  };
} else if (typeof window !== 'undefined') {
  window.AltimeterDataImporter = AltimeterDataImporter;
  window.GPSTracker = GPSTracker;
  window.ClubSharing = ClubSharing;
  window.ALTIMETER_FORMATS = ALTIMETER_FORMATS;
}

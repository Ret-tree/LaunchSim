/**
 * LAUNCHSIM RocketPy Client
 * =========================
 * 
 * JavaScript client for communicating with the RocketPy backend server.
 * Provides a clean API for running simulations, fetching motors, etc.
 * 
 * Usage:
 *   const client = new RocketPyClient('http://localhost:8000');
 *   const result = await client.simulate(rocketConfig);
 */

// Debug mode - set window.LAUNCHSIM_DEBUG = true for verbose logging
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[RocketPyClient]', ...args),
  warn: (...args) => console.warn('[RocketPyClient]', ...args),
  error: (...args) => console.error('[RocketPyClient]', ...args)
};

class RocketPyClient {
  constructor(baseUrl = 'http://localhost:8000') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeout = 60000; // 60 second timeout for simulations
  }

  // ============================================
  // HTTP Helpers
  // ============================================

  async fetch(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(error.detail || `HTTP ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    }
  }

  async get(endpoint) {
    return this.fetch(endpoint, { method: 'GET' });
  }

  async post(endpoint, data) {
    return this.fetch(endpoint, {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  // ============================================
  // API Methods
  // ============================================

  /**
   * Check server health and status
   */
  async getStatus() {
    return this.get('/api/status');
  }

  /**
   * Check if server is reachable
   */
  async ping() {
    try {
      await this.get('/');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get list of available motors
   * @param {Object} filters - Optional filters { impulseClass, manufacturer }
   */
  async getMotors(filters = {}) {
    let endpoint = '/api/motors';
    const params = new URLSearchParams();
    
    if (filters.impulseClass) {
      params.append('impulse_class', filters.impulseClass);
    }
    if (filters.manufacturer) {
      params.append('manufacturer', filters.manufacturer);
    }

    const queryString = params.toString();
    if (queryString) {
      endpoint += `?${queryString}`;
    }

    return this.get(endpoint);
  }

  /**
   * Get details for a specific motor
   * @param {string} motorId - Motor ID (e.g., 'Estes_C6')
   */
  async getMotor(motorId) {
    return this.get(`/api/motors/${motorId}`);
  }

  /**
   * Get atmospheric properties at altitude
   * @param {number} altitude - Altitude in meters
   */
  async getAtmosphere(altitude = 0) {
    return this.get(`/api/atmosphere?altitude=${altitude}`);
  }

  /**
   * Calculate static stability margin
   * @param {Object} rocketConfig - Rocket configuration
   */
  async calculateStability(rocketConfig) {
    return this.post('/api/stability', rocketConfig);
  }

  /**
   * Run a flight simulation
   * @param {Object} config - Full simulation configuration
   * @returns {Object} Simulation result with trajectory, events, etc.
   */
  async simulate(config) {
    return this.post('/api/simulate', config);
  }

  /**
   * Run Monte Carlo dispersion analysis
   * @param {Object} config - Monte Carlo configuration
   */
  async monteCarlo(config) {
    return this.post('/api/montecarlo', config);
  }

  // ============================================
  // Convenience Methods
  // ============================================

  /**
   * Create a simulation config from LAUNCHSIM rocket/motor configuration
   * @param {Object} rocketConfig - LAUNCHSIM rocket config
   * @param {Object} motorConfig - LAUNCHSIM motor config
   * @param {Object} options - Additional options
   */
  buildSimulationConfig(rocketConfig, motorConfig, options = {}) {
    // Convert LAUNCHSIM units (mm) to RocketPy units (m)
    const mmToM = v => v / 1000;

    // Build motor config
    const motor = {
      motor_type: 'solid',
      thrust_source: motorConfig.id,
      burn_time: motorConfig.burnTime,
      total_impulse: motorConfig.impulse || motorConfig.totalImpulse,
      avg_thrust: motorConfig.avgThrust,
      propellant_mass: mmToM(motorConfig.propMass || 20), // g to kg
      dry_mass: mmToM((motorConfig.totalMass || 40) - (motorConfig.propMass || 20)),
      nozzle_radius: 0.015,
      throat_radius: 0.005,
      grain_outer_radius: mmToM(rocketConfig.bodyDiameter / 2 - 2),
      grain_initial_inner_radius: mmToM(rocketConfig.bodyDiameter / 4),
      grain_initial_height: 0.05,
      grain_number: 1,
      grain_separation: 0.002,
      grain_density: 1700,
      thrust_curve: motorConfig.thrustCurve || null
    };

    // Build rocket config
    const rocket = {
      mass: 0.1, // Estimate from components
      radius: mmToM(rocketConfig.bodyDiameter / 2),
      inertia_i: 0.01,
      inertia_z: 0.001,
      center_of_mass: mmToM(rocketConfig.noseLength + rocketConfig.bodyLength * 0.4),
      nose: {
        length: mmToM(rocketConfig.noseLength),
        kind: rocketConfig.noseShape || 'ogive'
      },
      fins: {
        n: rocketConfig.finCount || 3,
        root_chord: mmToM(rocketConfig.finRoot),
        tip_chord: mmToM(rocketConfig.finTip),
        span: mmToM(rocketConfig.finSpan),
        sweep_length: mmToM(rocketConfig.finSweep),
        cant_angle: 0,
        position: -mmToM(rocketConfig.bodyLength * 0.1)
      },
      motor: motor,
      parachutes: [{
        name: 'Main',
        cd_s: Math.PI * Math.pow(rocketConfig.chuteSize * 0.0254 / 2, 2) * 1.5, // inches to m², Cd=1.5
        trigger: 'apogee',
        sampling_rate: 100,
        lag: rocketConfig.deployDelay || 1,
        noise: [0, 8.3, 0.5]
      }]
    };

    // Build environment config
    const environment = {
      latitude: options.latitude || 32.990254,
      longitude: options.longitude || -106.974998,
      elevation: options.elevation || 0,
      atmosphere_type: 'standard_atmosphere',
      wind_speed: options.windSpeed || 0,
      wind_direction: options.windDirection || 0
    };

    // Build flight config
    const flight = {
      rail_length: options.railLength || 1.5,
      inclination: options.inclination || 85,
      heading: options.heading || 0,
      max_time: options.maxTime || 300,
      max_time_step: 0.01,
      terminate_on_apogee: false
    };

    return {
      environment,
      rocket,
      flight,
      output_sampling_rate: options.sampleRate || 60
    };
  }

  /**
   * Run a quick simulation with LAUNCHSIM config format
   */
  async simulateQuick(rocketConfig, motorConfig, options = {}) {
    const config = this.buildSimulationConfig(rocketConfig, motorConfig, options);
    return this.simulate(config);
  }
}

// ============================================
// Trajectory Renderer
// ============================================

/**
 * Renders RocketPy trajectory data to a Three.js scene
 */
class TrajectoryRenderer {
  constructor(scene) {
    this.scene = scene;
    this.trajectoryLine = null;
    this.eventMarkers = [];
  }

  /**
   * Render trajectory from simulation result
   * @param {Object} result - SimulationResult from RocketPy backend
   */
  render(result) {
    this.clear();

    if (!result.trajectory || result.trajectory.length === 0) {
      log.warn('No trajectory data to render');
      return;
    }

    // Create trajectory line
    const points = result.trajectory.map(p => 
      new THREE.Vector3(p.x, p.z, p.y) // Note: z is up in LAUNCHSIM
    );

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    
    // Color by velocity
    const colors = [];
    const maxVel = Math.max(...result.trajectory.map(p => 
      Math.sqrt(p.vx*p.vx + p.vy*p.vy + p.vz*p.vz)
    ));

    for (const p of result.trajectory) {
      const vel = Math.sqrt(p.vx*p.vx + p.vy*p.vy + p.vz*p.vz);
      const t = vel / maxVel;
      // Blue -> Green -> Yellow -> Red
      if (t < 0.33) {
        colors.push(0, t * 3, 1);
      } else if (t < 0.66) {
        colors.push((t - 0.33) * 3, 1, 1 - (t - 0.33) * 3);
      } else {
        colors.push(1, 1 - (t - 0.66) * 3, 0);
      }
    }

    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    const material = new THREE.LineBasicMaterial({ 
      vertexColors: true,
      linewidth: 2 
    });

    this.trajectoryLine = new THREE.Line(geometry, material);
    this.scene.add(this.trajectoryLine);

    // Add event markers
    for (const event of result.events) {
      const point = result.trajectory.find(p => 
        Math.abs(p.time - event.time) < 0.1
      );

      if (point) {
        const markerGeom = new THREE.SphereGeometry(2, 8, 8);
        const markerMat = new THREE.MeshBasicMaterial({ 
          color: this.getEventColor(event.name) 
        });
        const marker = new THREE.Mesh(markerGeom, markerMat);
        marker.position.set(point.x, point.z, point.y);
        marker.userData = { event: event.name, time: event.time };
        this.scene.add(marker);
        this.eventMarkers.push(marker);
      }
    }
  }

  getEventColor(eventName) {
    const colors = {
      liftoff: 0x00ff00,
      rail_departure: 0x00ffff,
      burnout: 0xff8800,
      apogee: 0xff0000,
      landing: 0x0088ff
    };
    return colors[eventName] || 0xffffff;
  }

  clear() {
    if (this.trajectoryLine) {
      this.scene.remove(this.trajectoryLine);
      this.trajectoryLine.geometry.dispose();
      this.trajectoryLine.material.dispose();
      this.trajectoryLine = null;
    }

    for (const marker of this.eventMarkers) {
      this.scene.remove(marker);
      marker.geometry.dispose();
      marker.material.dispose();
    }
    this.eventMarkers = [];
  }
}

// ============================================
// Result Display
// ============================================

/**
 * Formats simulation results for display
 */
class ResultFormatter {
  static formatSummary(result) {
    if (!result.success) {
      return `Simulation Failed: ${result.message}`;
    }

    return `
╔══════════════════════════════════════════════╗
║           SIMULATION RESULTS                  ║
╠══════════════════════════════════════════════╣
║  Apogee:            ${result.apogee.toFixed(1).padStart(8)} m              ║
║  Apogee Time:       ${result.apogee_time.toFixed(2).padStart(8)} s              ║
║  Max Velocity:      ${result.max_velocity.toFixed(1).padStart(8)} m/s            ║
║  Max Mach:          ${result.max_mach.toFixed(3).padStart(8)}                ║
║  Max Acceleration:  ${result.max_acceleration.toFixed(1).padStart(8)} m/s²           ║
║  Flight Time:       ${result.flight_time.toFixed(2).padStart(8)} s              ║
║  Landing Velocity:  ${result.landing_velocity.toFixed(1).padStart(8)} m/s            ║
╠══════════════════════════════════════════════╣
║  STABILITY                                    ║
║  Initial Margin:    ${result.stability_margin_initial.toFixed(2).padStart(8)} cal            ║
║  Burnout Margin:    ${result.stability_margin_burnout.toFixed(2).padStart(8)} cal            ║
║  Rail Exit Velocity:${result.out_of_rail_velocity.toFixed(1).padStart(8)} m/s            ║
╚══════════════════════════════════════════════╝
    `.trim();
  }

  static formatEvents(events) {
    return events.map(e => {
      let desc = `${e.time.toFixed(2)}s: ${e.name}`;
      if (e.altitude !== undefined && e.altitude !== null) {
        desc += ` at ${e.altitude.toFixed(1)}m`;
      }
      if (e.velocity !== undefined && e.velocity !== null) {
        desc += ` (${e.velocity.toFixed(1)} m/s)`;
      }
      return desc;
    }).join('\n');
  }

  static formatForCSV(result) {
    const headers = ['time', 'x', 'y', 'z', 'vx', 'vy', 'vz', 'mach', 'aoa'];
    const rows = result.trajectory.map(p => 
      [p.time, p.x, p.y, p.z, p.vx, p.vy, p.vz, p.mach, p.angle_of_attack].join(',')
    );
    return [headers.join(','), ...rows].join('\n');
  }

  static downloadCSV(result, filename = 'trajectory.csv') {
    const csv = this.formatForCSV(result);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

// ============================================
// Integration Helper
// ============================================

/**
 * Integrates RocketPy backend with LAUNCHSIM UI
 */
class LaunchSimIntegration {
  constructor(options = {}) {
    this.client = new RocketPyClient(options.serverUrl || 'http://localhost:8000');
    this.useBackend = false;
    this.statusEl = options.statusElement;
    this.onStatusChange = options.onStatusChange || (() => {});
  }

  async init() {
    // Check if backend is available
    try {
      const status = await this.client.getStatus();
      this.useBackend = true;
      this.onStatusChange({ 
        available: true, 
        rocketpy: status.rocketpy_installed,
        message: status.rocketpy_installed 
          ? 'RocketPy backend connected' 
          : 'Backend connected (mock mode)'
      });
      return true;
    } catch (error) {
      this.useBackend = false;
      this.onStatusChange({ 
        available: false, 
        message: 'Backend not available - using JS physics'
      });
      return false;
    }
  }

  async simulate(rocketConfig, motorConfig, options = {}) {
    if (!this.useBackend) {
      throw new Error('Backend not available');
    }

    return this.client.simulateQuick(rocketConfig, motorConfig, options);
  }

  async getMotors(filters = {}) {
    if (!this.useBackend) {
      return [];
    }
    return this.client.getMotors(filters);
  }

  isAvailable() {
    return this.useBackend;
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RocketPyClient,
    TrajectoryRenderer,
    ResultFormatter,
    LaunchSimIntegration
  };
}

// Also expose globally for HTML usage
if (typeof window !== 'undefined') {
  window.RocketPyClient = RocketPyClient;
  window.TrajectoryRenderer = TrajectoryRenderer;
  window.ResultFormatter = ResultFormatter;
  window.LaunchSimIntegration = LaunchSimIntegration;
}

// ES Module exports
export { RocketPyClient, TrajectoryRenderer, ResultFormatter, LaunchSimIntegration };

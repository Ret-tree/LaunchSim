/**
 * LAUNCHSIM Frontend Integration
 * ===============================
 * 
 * Complete frontend application integrating all LAUNCHSIM modules:
 * - Rocket Designer (ORK import, component editing)
 * - Motor Selection (ThrustCurve.org database)
 * - Weather Integration (Open-Meteo real-time data)
 * - Simulation Engine (6-DOF physics, Monte Carlo)
 * - Results Visualization (trajectory, landing zones)
 * 
 * Usage:
 *   const app = new LaunchSimApp('app-container');
 *   await app.initialize();
 */

// Debug mode - set window.LAUNCHSIM_DEBUG = true for verbose logging
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[LaunchSim]', ...args),
  warn: (...args) => console.warn('[LaunchSim]', ...args),
  error: (...args) => console.error('[LaunchSim]', ...args)
};

// ============================================
// Application State Management
// ============================================

class AppState {
  constructor() {
    this.rocket = null;
    this.motor = null;
    this.weather = null;
    this.simulation = null;
    this.monteCarloResults = null;
    this.listeners = new Map();
  }

  set(key, value) {
    this[key] = value;
    this.notify(key, value);
  }

  get(key) {
    return this[key];
  }

  subscribe(key, callback) {
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key).push(callback);
    return () => {
      const callbacks = this.listeners.get(key);
      const index = callbacks.indexOf(callback);
      if (index > -1) callbacks.splice(index, 1);
    };
  }

  notify(key, value) {
    const callbacks = this.listeners.get(key) || [];
    callbacks.forEach(cb => cb(value));
  }

  toJSON() {
    return {
      rocket: this.rocket,
      motor: this.motor,
      weather: this.weather ? {
        location: this.weather.location,
        current: this.weather.current,
        safetyScore: this.weather.safetyScore
      } : null
    };
  }

  loadFromJSON(data) {
    if (data.rocket) this.set('rocket', data.rocket);
    if (data.motor) this.set('motor', data.motor);
  }
}

// ============================================
// Data Persistence System
// ============================================

class DataPersistence {
  constructor(options = {}) {
    this.options = {
      storagePrefix: 'launchsim_',
      autoSaveInterval: 30000,      // 30 seconds
      maxSimulationHistory: 50,     // Keep last 50 simulations
      maxStorageSize: 5 * 1024 * 1024, // 5MB limit
      enableAutoSave: true,
      enableSessionRecovery: true,
      ...options
    };

    this.autoSaveTimer = null;
    this.pendingChanges = false;
    this.listeners = [];

    // Initialize on construction
    this.checkStorageAvailability();
  }

  // ============================================
  // Storage Utilities
  // ============================================

  checkStorageAvailability() {
    try {
      const test = '__storage_test__';
      localStorage.setItem(test, test);
      localStorage.removeItem(test);
      this.storageAvailable = true;
    } catch (e) {
      this.storageAvailable = false;
      log.warn('LocalStorage not available:', e.message);
    }
    return this.storageAvailable;
  }

  getKey(name) {
    return this.options.storagePrefix + name;
  }

  getStorageUsage() {
    if (!this.storageAvailable) return { used: 0, total: 0, percent: 0 };
    
    let totalSize = 0;
    for (let key in localStorage) {
      if (localStorage.hasOwnProperty(key) && key.startsWith(this.options.storagePrefix)) {
        totalSize += localStorage[key].length * 2; // UTF-16 encoding
      }
    }
    
    return {
      used: totalSize,
      total: this.options.maxStorageSize,
      percent: Math.round((totalSize / this.options.maxStorageSize) * 100),
      usedMB: (totalSize / (1024 * 1024)).toFixed(2),
      totalMB: (this.options.maxStorageSize / (1024 * 1024)).toFixed(2)
    };
  }

  // ============================================
  // Settings Persistence
  // ============================================

  saveSettings(settings) {
    if (!this.storageAvailable) return false;
    try {
      localStorage.setItem(this.getKey('settings'), JSON.stringify({
        ...settings,
        savedAt: new Date().toISOString()
      }));
      return true;
    } catch (e) {
      log.error('Failed to save settings:', e);
      return false;
    }
  }

  loadSettings() {
    if (!this.storageAvailable) return null;
    try {
      const data = localStorage.getItem(this.getKey('settings'));
      return data ? JSON.parse(data) : null;
    } catch (e) {
      log.error('Failed to load settings:', e);
      return null;
    }
  }

  // ============================================
  // Session Recovery
  // ============================================

  saveSession(appState, additionalData = {}) {
    if (!this.storageAvailable || !this.options.enableSessionRecovery) return false;
    
    try {
      const session = {
        state: appState.toJSON(),
        additionalData,
        activeTab: document.querySelector('.nav-btn.active')?.dataset?.tab || 'design',
        timestamp: Date.now(),
        savedAt: new Date().toISOString()
      };
      
      localStorage.setItem(this.getKey('session'), JSON.stringify(session));
      log.debug('Session saved');
      return true;
    } catch (e) {
      log.error('Failed to save session:', e);
      return false;
    }
  }

  loadSession() {
    if (!this.storageAvailable) return null;
    try {
      const data = localStorage.getItem(this.getKey('session'));
      if (!data) return null;
      
      const session = JSON.parse(data);
      
      // Check if session is recent (within 24 hours)
      const age = Date.now() - session.timestamp;
      if (age > 24 * 60 * 60 * 1000) {
        log.debug('Session too old, discarding');
        this.clearSession();
        return null;
      }
      
      return session;
    } catch (e) {
      log.error('Failed to load session:', e);
      return null;
    }
  }

  clearSession() {
    if (this.storageAvailable) {
      localStorage.removeItem(this.getKey('session'));
    }
  }

  hasSession() {
    return this.loadSession() !== null;
  }

  // ============================================
  // Simulation History
  // ============================================

  saveSimulationResult(result, metadata = {}) {
    if (!this.storageAvailable) return false;
    
    try {
      const history = this.getSimulationHistory();
      
      // Create compact simulation record
      const record = {
        id: `sim_${Date.now()}`,
        timestamp: Date.now(),
        savedAt: new Date().toISOString(),
        metadata: {
          rocketName: metadata.rocketName || 'Unknown',
          motorName: metadata.motorName || 'Unknown',
          ...metadata
        },
        summary: {
          apogee: result.apogee,
          maxVelocity: result.maxVelocity,
          maxMach: result.maxMach,
          flightTime: result.flightTime,
          maxAcceleration: result.maxAcceleration,
          landingDistance: this.calculateLandingDistance(result),
          success: !result.crashed
        },
        // Store trajectory points (sampled to reduce size)
        trajectory: this.sampleTrajectory(result.trajectory, 100),
        events: result.events || []
      };
      
      // Add to history
      history.unshift(record);
      
      // Trim to max size
      while (history.length > this.options.maxSimulationHistory) {
        history.pop();
      }
      
      localStorage.setItem(this.getKey('simulation_history'), JSON.stringify(history));
      log.debug('Simulation saved to history');
      return record.id;
    } catch (e) {
      log.error('Failed to save simulation:', e);
      return false;
    }
  }

  getSimulationHistory() {
    if (!this.storageAvailable) return [];
    try {
      const data = localStorage.getItem(this.getKey('simulation_history'));
      return data ? JSON.parse(data) : [];
    } catch (e) {
      log.error('Failed to load simulation history:', e);
      return [];
    }
  }

  getSimulationById(id) {
    const history = this.getSimulationHistory();
    return history.find(sim => sim.id === id);
  }

  deleteSimulation(id) {
    if (!this.storageAvailable) return false;
    try {
      let history = this.getSimulationHistory();
      history = history.filter(sim => sim.id !== id);
      localStorage.setItem(this.getKey('simulation_history'), JSON.stringify(history));
      return true;
    } catch (e) {
      log.error('Failed to delete simulation:', e);
      return false;
    }
  }

  clearSimulationHistory() {
    if (this.storageAvailable) {
      localStorage.removeItem(this.getKey('simulation_history'));
    }
  }

  sampleTrajectory(trajectory, maxPoints = 100) {
    if (!trajectory || trajectory.length <= maxPoints) return trajectory;
    
    const step = Math.ceil(trajectory.length / maxPoints);
    const sampled = [];
    
    for (let i = 0; i < trajectory.length; i += step) {
      sampled.push(trajectory[i]);
    }
    
    // Always include last point
    if (sampled[sampled.length - 1] !== trajectory[trajectory.length - 1]) {
      sampled.push(trajectory[trajectory.length - 1]);
    }
    
    return sampled;
  }

  calculateLandingDistance(result) {
    if (!result.trajectory || result.trajectory.length === 0) return 0;
    const last = result.trajectory[result.trajectory.length - 1];
    return Math.sqrt((last.x || 0) ** 2 + (last.y || 0) ** 2);
  }

  // ============================================
  // Auto-Save
  // ============================================

  startAutoSave(getDataCallback) {
    if (!this.options.enableAutoSave) return;
    
    this.stopAutoSave();
    this.getDataCallback = getDataCallback;
    
    this.autoSaveTimer = setInterval(() => {
      if (this.pendingChanges && this.getDataCallback) {
        const data = this.getDataCallback();
        this.saveSession(data.state, data.additional);
        this.pendingChanges = false;
        log.debug('Auto-saved');
      }
    }, this.options.autoSaveInterval);
    
    log.debug('Auto-save started');
  }

  stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  markChanged() {
    this.pendingChanges = true;
  }

  // ============================================
  // Project Management (Enhanced)
  // ============================================

  getProjectsIndex() {
    if (!this.storageAvailable) return [];
    try {
      const data = localStorage.getItem(this.getKey('projects_index'));
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  saveProjectsIndex(index) {
    if (!this.storageAvailable) return false;
    try {
      localStorage.setItem(this.getKey('projects_index'), JSON.stringify(index));
      return true;
    } catch (e) {
      return false;
    }
  }

  // ============================================
  // Export/Import
  // ============================================

  exportAllData() {
    const data = {
      exportVersion: '2.0',
      exportDate: new Date().toISOString(),
      settings: this.loadSettings(),
      projects: this.getAllProjects(),
      simulationHistory: this.getSimulationHistory()
    };
    
    return JSON.stringify(data, null, 2);
  }

  getAllProjects() {
    const index = this.getProjectsIndex();
    const projects = [];
    
    for (const entry of index) {
      try {
        const data = localStorage.getItem(entry.key);
        if (data) {
          projects.push({
            ...entry,
            data: JSON.parse(data)
          });
        }
      } catch (e) {
        log.warn('Failed to load project:', entry.key);
      }
    }
    
    return projects;
  }

  importAllData(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      
      if (data.settings) {
        this.saveSettings(data.settings);
      }
      
      if (data.projects && Array.isArray(data.projects)) {
        const index = this.getProjectsIndex();
        for (const project of data.projects) {
          if (project.data) {
            const key = `launchsim_project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            localStorage.setItem(key, JSON.stringify(project.data));
            index.push({
              key,
              name: project.name || project.data.projectName || 'Imported Project',
              savedAt: new Date().toISOString()
            });
          }
        }
        this.saveProjectsIndex(index);
      }
      
      if (data.simulationHistory && Array.isArray(data.simulationHistory)) {
        const existingHistory = this.getSimulationHistory();
        const combined = [...data.simulationHistory, ...existingHistory];
        // Remove duplicates by ID
        const unique = combined.filter((item, index, self) => 
          index === self.findIndex(t => t.id === item.id)
        );
        // Trim to max
        while (unique.length > this.options.maxSimulationHistory) {
          unique.pop();
        }
        localStorage.setItem(this.getKey('simulation_history'), JSON.stringify(unique));
      }
      
      return { success: true };
    } catch (e) {
      log.error('Failed to import data:', e);
      return { success: false, error: e.message };
    }
  }

  // ============================================
  // Cleanup
  // ============================================

  clearAllData() {
    if (!this.storageAvailable) return;
    
    const keysToRemove = [];
    for (let key in localStorage) {
      if (key.startsWith(this.options.storagePrefix)) {
        keysToRemove.push(key);
      }
    }
    
    keysToRemove.forEach(key => localStorage.removeItem(key));
    log.debug('All data cleared');
  }

  dispose() {
    this.stopAutoSave();
  }
}

// ============================================
// Main Application
// ============================================

class LaunchSimApp {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = null;
    this.options = {
      theme: options.theme || 'light',
      defaultLocation: options.defaultLocation || {
        latitude: 32.99,
        longitude: -106.97,
        name: 'Spaceport America'
      },
      enableAutoSave: true,
      enableSessionRecovery: true,
      ...options
    };

    // State
    this.state = new AppState();
    
    // Data Persistence
    this.persistence = new DataPersistence({
      enableAutoSave: this.options.enableAutoSave,
      enableSessionRecovery: this.options.enableSessionRecovery
    });

    // Module instances (lazy loaded)
    this.modules = {
      orkImporter: null,
      thrustCurveAPI: null,
      weatherAPI: null,
      physicsEngine: null,
      monteCarloEngine: null
    };

    // UI Components
    this.components = {};

    // Bind methods
    this.handleRocketUpdate = this.handleRocketUpdate.bind(this);
    this.handleMotorSelect = this.handleMotorSelect.bind(this);
    this.handleWeatherUpdate = this.handleWeatherUpdate.bind(this);
    this.runSimulation = this.runSimulation.bind(this);
    this.runMonteCarlo = this.runMonteCarlo.bind(this);
  }

  // ============================================
  // Initialization
  // ============================================

  async initialize() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      throw new Error(`Container '${this.containerId}' not found`);
    }

    // Render main layout
    this.renderLayout();

    // Initialize modules
    await this.initializeModules();

    // Setup event listeners
    this.setupEventListeners();

    // Load default weather
    await this.loadWeather(
      this.options.defaultLocation.latitude,
      this.options.defaultLocation.longitude
    );

    // Check for auto-saved session
    this.checkAutoSaveRecovery();

    // Start auto-save (if checkbox is checked)
    const autoSaveEnabled = this.container.querySelector('#opt-auto-save')?.checked !== false;
    if (autoSaveEnabled) {
      this.startAutoSave();
    }

    log.debug('LAUNCHSIM initialized successfully');
    return this;
  }

  checkAutoSaveRecovery() {
    try {
      const autoSave = localStorage.getItem('launchsim_autosave');
      if (autoSave) {
        const data = JSON.parse(autoSave);
        const age = Date.now() - (data.savedAt ? new Date(data.savedAt).getTime() : 0);
        
        // Only offer recovery if less than 24 hours old
        if (age < 24 * 60 * 60 * 1000 && data.rocket) {
          const timeAgo = this.formatTimeAgo(age);
          if (confirm(`Found auto-saved project "${data.projectName || 'Untitled'}" from ${timeAgo}. Would you like to restore it?`)) {
            this.applyProjectData(data);
            this.showNotification('📂 Auto-saved project restored');
          }
        }
      }
    } catch (e) {
      log.warn('Could not check auto-save recovery:', e);
    }
  }

  formatTimeAgo(ms) {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else if (minutes > 0) {
      return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else {
      return 'just now';
    }
  }

  async initializeModules() {
    // These will be initialized when their respective modules are loaded
    // For now, we check if they're available globally

    if (typeof ORKImporter !== 'undefined') {
      this.modules.orkImporter = new ORKImporter();
    }

    if (typeof ThrustCurveAPI !== 'undefined') {
      this.modules.thrustCurveAPI = new ThrustCurveAPI();
      try {
        await this.modules.thrustCurveAPI.loadOfflineDatabase();
      } catch (e) {
        log.warn('Could not load offline motor database:', e.message);
      }
    }

    if (typeof WeatherAPI !== 'undefined') {
      this.modules.weatherAPI = new WeatherAPI();
    }

    if (typeof PhysicsEngine !== 'undefined') {
      this.modules.physicsEngine = PhysicsEngine;
    }

    if (typeof MonteCarloEngine !== 'undefined') {
      this.modules.monteCarloEngine = MonteCarloEngine;
    }

    // Initialize integration modules
    if (typeof AltimeterDataImporter !== 'undefined') {
      this.modules.altimeterImporter = new AltimeterDataImporter();
    }

    if (typeof GPSTracker !== 'undefined') {
      this.modules.gpsTracker = new GPSTracker();
      // Set up GPS event listener
      this.modules.gpsTracker.addListener((event, data) => {
        this.handleGPSEvent(event, data);
      });
    }

    if (typeof ClubSharing !== 'undefined') {
      this.modules.clubSharing = new ClubSharing();
      // Update club UI
      this.updateClubList();
    }
  }

  // ============================================
  // Layout Rendering
  // ============================================

  renderLayout() {
    this.container.innerHTML = `
      <div class="launchsim-app ${this.options.theme}">
        <header class="app-header">
          <div class="logo">
            <span class="logo-icon">●</span>
            <span class="logo-text">LaunchSim</span>
          </div>
          <nav class="main-nav">
            <button class="nav-btn active" data-tab="design">Design</button>
            <button class="nav-btn" data-tab="motor">Motor</button>
            <button class="nav-btn" data-tab="optimize">Optimize</button>
            <button class="nav-btn" data-tab="weather">Weather</button>
            <button class="nav-btn" data-tab="simulate">Simulate</button>
            <button class="nav-btn" data-tab="results">Results</button>
            <button class="nav-btn" data-tab="3dview">3D View</button>
            <button class="nav-btn" data-tab="launchday">Launch Day</button>
            <button class="nav-btn" data-tab="multistage">Multi-Stage</button>
            <button class="nav-btn" data-tab="recovery">Recovery</button>
            <button class="nav-btn" data-tab="flightlog">Flight Log</button>
            <button class="nav-btn" data-tab="compare">Compare</button>
            <button class="nav-btn" data-tab="integration">Integration</button>
            <button class="nav-btn" data-tab="advanced">Advanced</button>
          </nav>
          <div class="header-actions">
            <div class="unit-toggle" id="unit-toggle">
              <span class="unit-label">Units:</span>
              <button class="unit-btn active" data-unit="metric">Metric</button>
              <button class="unit-btn" data-unit="imperial">Imperial</button>
            </div>
            <div class="header-divider"></div>
            <button class="btn-icon" id="btn-save" title="Save Project">💾</button>
            <button class="btn-icon" id="btn-load" title="Load Project">📂</button>
            <button class="btn-icon" id="btn-settings" title="Settings">⚙️</button>
            <button class="btn-icon" id="btn-advanced-settings" title="Advanced Settings">🔧</button>
          </div>
        </header>

        <main class="app-main">
          <div class="tab-content active" id="tab-design">
            ${this.renderDesignTab()}
          </div>
          <div class="tab-content" id="tab-motor">
            ${this.renderMotorTab()}
          </div>
          <div class="tab-content" id="tab-optimize">
            ${this.renderOptimizeTab()}
          </div>
          <div class="tab-content" id="tab-weather">
            ${this.renderWeatherTab()}
          </div>
          <div class="tab-content" id="tab-simulate">
            ${this.renderSimulateTab()}
          </div>
          <div class="tab-content" id="tab-results">
            ${this.renderResultsTab()}
          </div>
          <div class="tab-content" id="tab-3dview">
            ${this.render3DViewTab()}
          </div>
          <div class="tab-content" id="tab-launchday">
            ${this.renderLaunchDayTab()}
          </div>
          <div class="tab-content" id="tab-multistage">
            ${this.renderMultiStageTab()}
          </div>
          <div class="tab-content" id="tab-recovery">
            ${this.renderRecoveryTab()}
          </div>
          <div class="tab-content" id="tab-flightlog">
            ${this.renderFlightLogTab()}
          </div>
          <div class="tab-content" id="tab-compare">
            ${this.renderCompareTab()}
          </div>
          <div class="tab-content" id="tab-integration">
            ${this.renderIntegrationTab()}
          </div>
          <div class="tab-content" id="tab-advanced">
            ${this.renderAdvancedTab()}
          </div>
        </main>

        <footer class="app-footer">
          <div class="status-bar">
            <span class="status-item" id="status-rocket">No rocket loaded</span>
            <span class="status-item" id="status-motor">No motor selected</span>
            <span class="status-item" id="status-weather">Weather: --</span>
          </div>
        </footer>
      </div>
    `;

    // Inject styles
    this.injectStyles();
  }

  renderDesignTab() {
    return `
      <div class="design-panel">
        <div class="panel-section">
          <h3>📂 Import Design</h3>
          <div class="import-area">
            <div class="dropzone" id="ork-dropzone">
              <span class="dropzone-icon">🚀</span>
              <span class="dropzone-text">Drop .ork file or click to import</span>
              <input type="file" id="ork-file-input" accept=".ork,.ork.gz" hidden>
            </div>
          </div>
        </div>

        <div class="panel-section" id="rocket-preview-section" style="display: none;">
          <h3>🔧 Rocket Configuration</h3>
          <div id="rocket-preview"></div>
        </div>

        <div class="panel-section">
          <h3>✏️ Quick Design</h3>
          <form id="quick-design-form" class="design-form">
            <div class="form-row">
              <label>Rocket Name</label>
              <input type="text" name="name" value="My Rocket" required>
            </div>
            <div class="form-group">
              <h4>Nose Cone</h4>
              <div class="form-row">
                <label>Shape</label>
                <select name="noseShape">
                  <option value="ogive">Ogive</option>
                  <option value="conical">Conical</option>
                  <option value="elliptical">Elliptical</option>
                  <option value="vonKarman">Von Karman</option>
                </select>
              </div>
              <div class="form-row">
                <label>Length (mm)</label>
                <input type="number" name="noseLength" value="100" min="10" max="500">
              </div>
              <div class="form-row">
                <label>Diameter (mm)</label>
                <input type="number" name="noseDiameter" value="41" min="10" max="200">
              </div>
            </div>
            <div class="form-group">
              <h4>Body Tube</h4>
              <div class="form-row">
                <label>Length (mm)</label>
                <input type="number" name="bodyLength" value="300" min="50" max="2000">
              </div>
              <div class="form-row">
                <label>Diameter (mm)</label>
                <input type="number" name="bodyDiameter" value="41" min="10" max="200">
              </div>
            </div>
            <div class="form-group">
              <h4>Fins</h4>
              <div class="form-row">
                <label>Count</label>
                <select name="finCount">
                  <option value="3">3</option>
                  <option value="4">4</option>
                  <option value="6">6</option>
                </select>
              </div>
              <div class="form-row">
                <label>Root Chord (mm)</label>
                <input type="number" name="finRootChord" value="70" min="10" max="300">
              </div>
              <div class="form-row">
                <label>Tip Chord (mm)</label>
                <input type="number" name="finTipChord" value="30" min="0" max="200">
              </div>
              <div class="form-row">
                <label>Span (mm)</label>
                <input type="number" name="finSpan" value="55" min="10" max="200">
              </div>
              <div class="form-row">
                <label>Sweep (mm)</label>
                <input type="number" name="finSweep" value="25" min="0" max="100">
              </div>
            </div>
            <div class="form-group">
              <h4>Recovery</h4>
              <div class="form-row">
                <label>Chute Diameter (mm)</label>
                <input type="number" name="chuteDiameter" value="450" min="100" max="2000">
              </div>
              <div class="form-row">
                <label>Chute Cd</label>
                <input type="number" name="chuteCd" value="0.8" min="0.3" max="1.5" step="0.1">
              </div>
            </div>
            <div class="form-group">
              <h4>Mass</h4>
              <div class="form-row">
                <label>Dry Mass (g)</label>
                <input type="number" name="dryMass" value="100" min="10" max="10000">
              </div>
            </div>
            <button type="submit" class="btn btn-primary">Apply Design</button>
          </form>
        </div>

        <div class="panel-section">
          <h3>📐 Fin Flutter Analysis</h3>
          <p class="section-desc">Check if fins are safe at expected flight speeds</p>
          <div class="flutter-analysis-section">
            <div class="flutter-inputs">
              <div class="flutter-form-row">
                <div class="form-group">
                  <label>Fin Root Chord (mm)</label>
                  <input type="number" id="flutter-root" value="70" min="10" max="500">
                </div>
                <div class="form-group">
                  <label>Fin Tip Chord (mm)</label>
                  <input type="number" id="flutter-tip" value="30" min="0" max="300">
                </div>
              </div>
              <div class="flutter-form-row">
                <div class="form-group">
                  <label>Fin Span (mm)</label>
                  <input type="number" id="flutter-span" value="55" min="10" max="300">
                </div>
                <div class="form-group">
                  <label>Fin Thickness (mm)</label>
                  <input type="number" id="flutter-thickness" value="3.2" min="0.5" max="20" step="0.1">
                </div>
              </div>
              <div class="flutter-form-row">
                <div class="form-group">
                  <label>Fin Material</label>
                  <select id="flutter-material">
                    <optgroup label="Wood">
                      <option value="balsa-light">Balsa (Light)</option>
                      <option value="balsa-medium">Balsa (Medium)</option>
                      <option value="balsa-heavy">Balsa (Heavy)</option>
                      <option value="basswood">Basswood</option>
                      <option value="birch-plywood-1/8" selected>Birch Plywood 1/8"</option>
                      <option value="birch-plywood-3/16">Birch Plywood 3/16"</option>
                      <option value="birch-plywood-1/4">Birch Plywood 1/4"</option>
                      <option value="lite-plywood">Lite-Ply (Aircraft)</option>
                    </optgroup>
                    <optgroup label="Composite">
                      <option value="g10-fiberglass">G10 Fiberglass</option>
                      <option value="g10-fiberglass-thin">G10 Fiberglass (Thin)</option>
                      <option value="carbon-fiber-sheet">Carbon Fiber Sheet</option>
                      <option value="carbon-fiber-sandwich">Carbon Fiber Sandwich</option>
                      <option value="fiberglass-cloth">Fiberglass Wet Layup</option>
                    </optgroup>
                    <optgroup label="Plastic">
                      <option value="abs">ABS (3D Print)</option>
                      <option value="pla">PLA (3D Print)</option>
                      <option value="petg">PETG (3D Print)</option>
                      <option value="polycarbonate">Polycarbonate</option>
                    </optgroup>
                    <optgroup label="Metal">
                      <option value="aluminum-6061">Aluminum 6061</option>
                      <option value="titanium">Titanium</option>
                    </optgroup>
                  </select>
                </div>
                <div class="form-group">
                  <label>Expected Max Velocity (m/s)</label>
                  <input type="number" id="flutter-velocity" value="150" min="10" max="1000">
                </div>
              </div>
              <button class="btn btn-secondary" id="btn-analyze-flutter">📐 Analyze Flutter</button>
            </div>
            <div class="flutter-results" id="flutter-results">
              <p class="placeholder">Enter fin dimensions and click Analyze</p>
            </div>
          </div>
        </div>

        <div class="panel-section">
          <h3>📊 Stability Analysis</h3>
          <div class="stability-section">
            <div class="stability-display" id="stability-display">
              <p class="placeholder">Apply a design to see stability analysis</p>
            </div>
          </div>
        </div>

        <div class="panel-section">
          <h3>🚀 Rocket Profile</h3>
          <div class="profile-section">
            <canvas id="rocket-profile-canvas" width="700" height="280"></canvas>
          </div>
        </div>

        <div class="panel-section">
          <h3>🗃️ Component Database</h3>
          <p class="section-desc">Browse pre-built components from major manufacturers</p>
          <div class="component-browser">
            <div class="component-filters">
              <select id="component-type-filter" class="form-control">
                <option value="bodyTubes">Body Tubes</option>
                <option value="noseCones">Nose Cones</option>
                <option value="finSets">Fin Sets</option>
                <option value="parachutes">Parachutes</option>
              </select>
              <select id="component-mfr-filter" class="form-control">
                <option value="">All Manufacturers</option>
              </select>
              <input type="text" id="component-search" placeholder="Search..." class="form-control">
              <button class="btn btn-secondary" id="btn-search-components">🔍 Search</button>
            </div>
            <div class="component-results" id="component-results">
              <p class="placeholder">Select a component type and search</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderMotorTab() {
    return `
      <div class="motor-panel">
        <div class="panel-section">
          <h3>🔍 Search Motors</h3>
          <div class="motor-search">
            <div class="search-filters">
              <div class="filter-row">
                <label>Impulse Class</label>
                <select id="motor-class-filter">
                  <option value="">All Classes</option>
                  <option value="A">A (1.26-2.5 Ns)</option>
                  <option value="B">B (2.5-5 Ns)</option>
                  <option value="C">C (5-10 Ns)</option>
                  <option value="D">D (10-20 Ns)</option>
                  <option value="E">E (20-40 Ns)</option>
                  <option value="F">F (40-80 Ns)</option>
                  <option value="G">G (80-160 Ns)</option>
                  <option value="H">H (160-320 Ns)</option>
                  <option value="I">I (320-640 Ns)</option>
                  <option value="J">J (640-1280 Ns)</option>
                  <option value="K">K (1280-2560 Ns)</option>
                  <option value="L">L (2560-5120 Ns)</option>
                  <option value="M">M (5120-10240 Ns)</option>
                </select>
              </div>
              <div class="filter-row">
                <label>Manufacturer</label>
                <select id="motor-mfr-filter">
                  <option value="">All Manufacturers</option>
                  <option value="Aerotech">Aerotech</option>
                  <option value="Cesaroni">Cesaroni</option>
                  <option value="Estes">Estes</option>
                  <option value="Loki">Loki Research</option>
                  <option value="Apogee">Apogee</option>
                </select>
              </div>
              <div class="filter-row">
                <label>Diameter (mm)</label>
                <select id="motor-diameter-filter">
                  <option value="">All Diameters</option>
                  <option value="18">18mm</option>
                  <option value="24">24mm</option>
                  <option value="29">29mm</option>
                  <option value="38">38mm</option>
                  <option value="54">54mm</option>
                  <option value="75">75mm</option>
                  <option value="98">98mm</option>
                </select>
              </div>
              <button class="btn btn-primary" id="motor-search-btn">Search</button>
            </div>
          </div>
        </div>

        <div class="panel-section">
          <h3>📋 Results</h3>
          <div id="motor-results" class="motor-results">
            <p class="placeholder">Use the filters above to search for motors</p>
          </div>
        </div>

        <div class="panel-section" id="motor-detail-section" style="display: none;">
          <h3>📊 Selected Motor</h3>
          <div id="motor-detail"></div>
          <canvas id="thrust-curve-canvas" width="400" height="200"></canvas>
        </div>
      </div>
    `;
  }

  renderWeatherTab() {
    return `
      <div class="weather-panel">
        <div class="panel-section">
          <h3>📍 Launch Site</h3>
          <div class="site-selector">
            <select id="launch-site-select">
              <option value="spaceportAmerica">Spaceport America, NM</option>
              <option value="blackRock">Black Rock Desert, NV</option>
              <option value="mojave">Mojave Desert, CA</option>
              <option value="lucerne">Lucerne Dry Lake, CA</option>
              <option value="tripoli">Tripoli Central, KS</option>
              <option value="whitakers">Whitakers, NC</option>
              <option value="custom">Custom Location...</option>
            </select>
            <div id="custom-location" style="display: none;">
              <div class="form-row">
                <label>Latitude</label>
                <input type="number" id="custom-lat" step="0.001" value="32.99">
              </div>
              <div class="form-row">
                <label>Longitude</label>
                <input type="number" id="custom-lon" step="0.001" value="-106.97">
              </div>
            </div>
            <button class="btn btn-primary" id="load-weather-btn">Load Weather</button>
          </div>
        </div>

        <div class="panel-section">
          <h3>🌤️ Current Conditions</h3>
          <div id="weather-display">
            <p class="placeholder">Select a launch site to load weather data</p>
          </div>
        </div>

        <div class="panel-section">
          <h3>📈 Hourly Forecast</h3>
          <div id="hourly-forecast">
            <canvas id="forecast-chart" width="600" height="200"></canvas>
          </div>
        </div>
      </div>
    `;
  }

  renderSimulateTab() {
    return `
      <div class="simulate-panel">
        <div class="panel-section">
          <h3>⚙️ Simulation Settings</h3>
          <form id="sim-settings-form" class="settings-form">
            <div class="form-group">
              <h4>Launch Configuration</h4>
              <div class="form-row">
                <label>Launch Rod Length (m)</label>
                <input type="number" name="rodLength" value="1.0" min="0.5" max="5" step="0.1">
              </div>
              <div class="form-row">
                <label>Launch Angle (°)</label>
                <input type="number" name="launchAngle" value="5" min="0" max="30">
              </div>
              <div class="form-row">
                <label>Launch Heading (°)</label>
                <input type="number" name="launchHeading" value="0" min="0" max="360">
                <button type="button" class="btn-small" id="btn-into-wind">Into Wind</button>
              </div>
            </div>

            <div class="form-group">
              <h4>Simulation Options</h4>
              <div class="form-row">
                <label>Time Step (s)</label>
                <input type="number" name="timeStep" value="0.01" min="0.001" max="0.1" step="0.001">
              </div>
              <div class="form-row">
                <label>Max Duration (s)</label>
                <input type="number" name="maxDuration" value="120" min="10" max="600">
              </div>
              <div class="form-row checkbox">
                <input type="checkbox" name="useWeather" id="use-weather" checked>
                <label for="use-weather">Use Real Weather Data</label>
              </div>
              <div class="form-row checkbox">
                <input type="checkbox" name="enableTVC" id="enable-tvc">
                <label for="enable-tvc">Enable TVC Simulation</label>
              </div>
            </div>
          </form>
        </div>

        <div class="panel-section">
          <h3>▶️ Run Simulation</h3>
          <div class="sim-actions">
            <button class="btn btn-primary btn-large" id="btn-run-sim">
              🚀 Run Single Simulation
            </button>
            <button class="btn btn-secondary btn-large" id="btn-run-monte-carlo">
              📊 Run Monte Carlo (100 sims)
            </button>
          </div>
          <div id="sim-progress" class="progress-container" style="display: none;">
            <div class="progress-bar">
              <div class="progress-fill" style="width: 0%"></div>
            </div>
            <span class="progress-text">0%</span>
          </div>
        </div>

        <div class="panel-section" id="quick-results" style="display: none;">
          <h3>📋 Quick Results</h3>
          <div id="quick-results-content"></div>
        </div>
      </div>
    `;
  }

  renderResultsTab() {
    return `
      <div class="results-panel">
        <div class="panel-section">
          <h3>📊 Flight Summary</h3>
          <div id="flight-summary">
            <p class="placeholder">Run a simulation to see results</p>
          </div>
        </div>

        <div class="panel-section">
          <h3>📈 Trajectory</h3>
          <div class="trajectory-view">
            <canvas id="trajectory-canvas" width="600" height="400"></canvas>
          </div>
        </div>

        <div class="panel-section" id="monte-carlo-section" style="display: none;">
          <h3>🎯 Monte Carlo Analysis</h3>
          <div class="monte-carlo-view">
            <div class="mc-stats" id="mc-stats"></div>
            <div class="mc-charts">
              <canvas id="landing-zone-canvas" width="400" height="400"></canvas>
              <canvas id="apogee-histogram-canvas" width="400" height="300"></canvas>
            </div>
          </div>
        </div>

        <div class="panel-section">
          <h3>📥 Export</h3>
          <div class="export-actions">
            <button class="btn btn-secondary" id="btn-export-csv">Export CSV</button>
            <button class="btn btn-secondary" id="btn-export-kml">Export KML</button>
            <button class="btn btn-secondary" id="btn-export-pdf">Export Report</button>
          </div>
        </div>
      </div>
    `;
  }

  render3DViewTab() {
    return `
      <div class="view3d-panel">
        <div class="view3d-header">
          <h2>🎮 3D Visualization</h2>
          <p class="section-desc">Interactive 3D rocket model and flight replay</p>
        </div>

        <div class="view3d-main">
          <!-- 3D Viewport -->
          <div class="view3d-viewport">
            <div class="viewport-container" id="viewport-3d">
              <div class="viewport-placeholder" id="viewport-placeholder">
                <div class="placeholder-content">
                  <span class="placeholder-icon">🚀</span>
                  <p>3D Viewer</p>
                  <p class="placeholder-hint">Design a rocket and run a simulation to see it in 3D</p>
                  <button class="btn btn-primary" id="btn-init-3d">Initialize 3D View</button>
                </div>
              </div>
            </div>

            <!-- Viewport Overlay Controls -->
            <div class="viewport-overlay" id="viewport-overlay" style="display: none;">
              <div class="overlay-top-left">
                <div class="viewport-stats" id="viewport-stats">
                  <div class="stat-item">
                    <span class="stat-label">Time:</span>
                    <span class="stat-value" id="stat-time">0.0s</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Altitude:</span>
                    <span class="stat-value" id="stat-altitude">0 m</span>
                  </div>
                  <div class="stat-item">
                    <span class="stat-label">Velocity:</span>
                    <span class="stat-value" id="stat-velocity">0 m/s</span>
                  </div>
                </div>
              </div>
              <div class="overlay-top-right">
                <div class="camera-controls">
                  <label>Camera:</label>
                  <select id="camera-mode-select">
                    <option value="orbit">Orbit</option>
                    <option value="follow">Follow</option>
                    <option value="chase">Chase</option>
                    <option value="side">Side</option>
                    <option value="ground">Ground</option>
                    <option value="fpv">First Person (FPV)</option>
                  </select>
                </div>
              </div>
              <div class="overlay-bottom">
                <div class="velocity-legend">
                  <span class="legend-label">Velocity:</span>
                  <div class="legend-gradient"></div>
                  <span class="legend-min">0</span>
                  <span class="legend-max" id="legend-max-vel">100 m/s</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Control Sidebar -->
          <div class="view3d-sidebar">
            <!-- Playback Controls -->
            <div class="sidebar-section">
              <h4>▶️ Playback</h4>
              <div class="playback-controls">
                <div class="playback-buttons">
                  <button class="btn btn-icon" id="btn-3d-reset" title="Reset">⏮️</button>
                  <button class="btn btn-icon btn-primary" id="btn-3d-play" title="Play">▶️</button>
                  <button class="btn btn-icon" id="btn-3d-pause" title="Pause" style="display:none;">⏸️</button>
                  <button class="btn btn-icon" id="btn-3d-stop" title="Stop">⏹️</button>
                </div>
                <div class="playback-timeline">
                  <input type="range" id="playback-slider" min="0" max="100" value="0">
                  <div class="timeline-labels">
                    <span id="time-current">0:00</span>
                    <span id="time-total">0:00</span>
                  </div>
                </div>
                <div class="playback-speed">
                  <label>Speed:</label>
                  <select id="playback-speed-select">
                    <option value="0.25">0.25x</option>
                    <option value="0.5">0.5x</option>
                    <option value="1" selected>1x</option>
                    <option value="2">2x</option>
                    <option value="5">5x</option>
                    <option value="10">10x</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- View Options -->
            <div class="sidebar-section">
              <h4>👁️ View Options</h4>
              <div class="view-options">
                <div class="option-row">
                  <input type="checkbox" id="opt-show-grid" checked>
                  <label for="opt-show-grid">Show Grid</label>
                </div>
                <div class="option-row">
                  <input type="checkbox" id="opt-show-trajectory" checked>
                  <label for="opt-show-trajectory">Show Trajectory</label>
                </div>
                <div class="option-row">
                  <input type="checkbox" id="opt-show-events" checked>
                  <label for="opt-show-events">Show Event Markers</label>
                </div>
                <div class="option-row">
                  <input type="checkbox" id="opt-show-stability" checked>
                  <label for="opt-show-stability">Show CG/CP Markers</label>
                </div>
                <div class="option-row">
                  <input type="checkbox" id="opt-show-landing">
                  <label for="opt-show-landing">Show Landing Zone</label>
                </div>
                <div class="option-row">
                  <input type="checkbox" id="opt-enable-inspector" checked>
                  <label for="opt-enable-inspector">🔍 Click-to-Inspect</label>
                </div>
              </div>
              <p class="inspector-hint" style="font-size: 11px; color: #888; margin-top: 8px;">
                💡 Click any point on the trajectory to view flight data at that moment
              </p>
            </div>

            <!-- Terrain Options -->
            <div class="sidebar-section">
              <h4>🏔️ Terrain</h4>
              <div class="terrain-options">
                <button class="btn btn-small btn-primary" id="btn-generate-terrain">Generate Terrain</button>
                <div class="option-row" style="margin-top: 10px;">
                  <input type="checkbox" id="opt-show-terrain" checked>
                  <label for="opt-show-terrain">Show Terrain</label>
                </div>
                <div class="option-row">
                  <input type="checkbox" id="opt-show-trees" checked>
                  <label for="opt-show-trees">Show Trees</label>
                </div>
                <div class="option-row">
                  <input type="checkbox" id="opt-show-buildings" checked>
                  <label for="opt-show-buildings">Show Buildings</label>
                </div>
                <div class="terrain-controls">
                  <div class="control-row">
                    <label>Max Elevation:</label>
                    <input type="range" id="terrain-elevation" min="20" max="200" value="80">
                    <span id="terrain-elevation-val">80m</span>
                  </div>
                  <div class="control-row">
                    <label>Tree Density:</label>
                    <input type="range" id="terrain-trees" min="0" max="300" value="150">
                    <span id="terrain-trees-val">150</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Wind Visualization -->
            <div class="sidebar-section">
              <h4>💨 Wind Visualization</h4>
              <div class="wind-options">
                <button class="btn btn-small btn-primary" id="btn-generate-wind">Show Wind</button>
                <div class="option-row" style="margin-top: 10px;">
                  <input type="checkbox" id="opt-show-wind-arrows" checked>
                  <label for="opt-show-wind-arrows">Wind Arrows</label>
                </div>
                <div class="option-row">
                  <input type="checkbox" id="opt-show-wind-particles" checked>
                  <label for="opt-show-wind-particles">Wind Streamlines</label>
                </div>
                <div class="wind-info" id="wind-info" style="font-size: 12px; color: #666; margin-top: 10px;">
                  <p>Surface: -- m/s from --°</p>
                </div>
              </div>
            </div>

            <!-- Telemetry HUD -->
            <div class="sidebar-section">
              <h4>📡 Telemetry HUD</h4>
              <div class="hud-options">
                <div class="option-row">
                  <input type="checkbox" id="opt-show-hud" checked>
                  <label for="opt-show-hud">Show Live Telemetry</label>
                </div>
                <div class="option-row">
                  <label style="width: 80px;">Position:</label>
                  <select id="hud-position" style="flex: 1;">
                    <option value="top-left" selected>Top Left</option>
                    <option value="top-right">Top Right</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="bottom-right">Bottom Right</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Force Vectors -->
            <div class="sidebar-section">
              <h4>🎯 Force Vectors</h4>
              <div class="force-options">
                <div class="option-row">
                  <input type="checkbox" id="opt-show-forces">
                  <label for="opt-show-forces">Show Force Arrows</label>
                </div>
                <div class="force-toggles" style="margin-left: 20px; margin-top: 5px;">
                  <div class="option-row">
                    <input type="checkbox" id="opt-force-thrust" checked>
                    <label for="opt-force-thrust" style="color: #ff6600;">Thrust</label>
                  </div>
                  <div class="option-row">
                    <input type="checkbox" id="opt-force-drag" checked>
                    <label for="opt-force-drag" style="color: #ff0000;">Drag</label>
                  </div>
                  <div class="option-row">
                    <input type="checkbox" id="opt-force-gravity" checked>
                    <label for="opt-force-gravity" style="color: #9900ff;">Gravity</label>
                  </div>
                  <div class="option-row">
                    <input type="checkbox" id="opt-force-velocity" checked>
                    <label for="opt-force-velocity" style="color: #00ffff;">Velocity</label>
                  </div>
                </div>
              </div>
            </div>

            <!-- Mach Cone -->
            <div class="sidebar-section">
              <h4>💥 Supersonic Effects</h4>
              <div class="mach-options">
                <div class="option-row">
                  <input type="checkbox" id="opt-show-mach-cone" checked>
                  <label for="opt-show-mach-cone">Mach Cone / Shock Wave</label>
                </div>
                <div class="mach-status" id="mach-status" style="font-size: 12px; color: #888; margin-top: 8px;">
                  Status: SUBSONIC
                </div>
              </div>
            </div>

            <!-- Multi-Trajectory -->
            <div class="sidebar-section">
              <h4>📊 Multi-Trajectory</h4>
              <div class="multi-traj-options">
                <button class="btn btn-small" id="btn-add-trajectory">+ Add Current</button>
                <button class="btn btn-small" id="btn-clear-trajectories">Clear All</button>
                <div class="traj-count" id="traj-count" style="font-size: 12px; color: #888; margin-top: 8px;">
                  Trajectories: 0
                </div>
                <p style="font-size: 11px; color: #666; margin-top: 5px;">
                  Run multiple simulations to compare trajectories
                </p>
              </div>
            </div>

            <!-- Safe Zone Overlay -->
            <div class="sidebar-section">
              <h4>🎯 Safe Zone Overlay</h4>
              <div class="safezone-options">
                <div class="option-row">
                  <input type="checkbox" id="opt-show-safezone" checked>
                  <label for="opt-show-safezone">Show Safety Zones</label>
                </div>
                <div class="option-row">
                  <input type="checkbox" id="opt-show-landing-ellipse">
                  <label for="opt-show-landing-ellipse">Landing Prediction</label>
                </div>
                <button class="btn btn-small" id="btn-set-landing-zone" style="margin-top: 8px;">Set Landing Prediction</button>
                <div class="safezone-info" style="font-size: 11px; color: #666; margin-top: 5px;">
                  🔴 Danger (30m) • 🟡 Warning (100m)
                </div>
              </div>
            </div>

            <!-- Attitude Indicator -->
            <div class="sidebar-section">
              <h4>🧭 Attitude Indicator</h4>
              <div class="attitude-options">
                <div class="option-row">
                  <input type="checkbox" id="opt-show-attitude">
                  <label for="opt-show-attitude">Show Attitude Display</label>
                </div>
                <div class="option-row">
                  <label style="width: 80px;">Position:</label>
                  <select id="attitude-position" style="flex: 1;">
                    <option value="bottom-right" selected>Bottom Right</option>
                    <option value="bottom-left">Bottom Left</option>
                    <option value="top-left">Top Left</option>
                    <option value="top-right">Top Right</option>
                  </select>
                </div>
              </div>
            </div>

            <!-- Heating Indicator -->
            <div class="sidebar-section">
              <h4>🔥 Thermal Stress</h4>
              <div class="heating-options">
                <div class="option-row">
                  <input type="checkbox" id="opt-show-heating">
                  <label for="opt-show-heating">Show Heating</label>
                </div>
                <div class="heating-status" id="heating-status" style="font-size: 12px; margin-top: 8px;">
                  <span style="color: #888;">Status: </span>
                  <span id="heating-status-text" style="color: #00ff00;">NOMINAL</span>
                </div>
                <div class="heating-temp" id="heating-temp" style="font-size: 11px; color: #666; margin-top: 4px;">
                  Surface Temp: -- °C
                </div>
              </div>
            </div>

            <!-- Weather Effects -->
            <div class="sidebar-section">
              <h4>🌦️ Weather Effects</h4>
              <div class="weather-effects-options">
                <div class="option-row">
                  <label style="width: 90px;">Cloud Cover:</label>
                  <input type="range" id="weather-clouds" min="0" max="100" value="50" style="flex: 1;">
                  <span id="weather-clouds-val" style="width: 35px; text-align: right;">50%</span>
                </div>
                <div class="option-row">
                  <label style="width: 90px;">Visibility:</label>
                  <select id="weather-visibility" style="flex: 1;">
                    <option value="10000">Clear (10km)</option>
                    <option value="5000">Hazy (5km)</option>
                    <option value="2000">Foggy (2km)</option>
                    <option value="500">Dense Fog</option>
                  </select>
                </div>
                <div class="option-row">
                  <label style="width: 90px;">Precipitation:</label>
                  <select id="weather-precip" style="flex: 1;">
                    <option value="none">None</option>
                    <option value="rain">Rain</option>
                    <option value="snow">Snow</option>
                  </select>
                </div>
                <button class="btn btn-small btn-primary" id="btn-apply-weather" style="margin-top: 8px;">Apply Weather</button>
                <button class="btn btn-small" id="btn-clear-weather">Clear</button>
              </div>
            </div>

            <!-- Skybox / Time of Day -->
            <div class="sidebar-section">
              <h4>🌅 Sky & Lighting</h4>
              <div class="skybox-options">
                <div class="option-row">
                  <input type="checkbox" id="opt-show-skybox" checked>
                  <label for="opt-show-skybox">Realistic Sky</label>
                </div>
                <div class="option-row">
                  <label style="width: 80px;">Time:</label>
                  <input type="range" id="skybox-time" min="0" max="24" step="0.5" value="12" style="flex: 1;">
                  <span id="skybox-time-val" style="width: 45px; text-align: right;">12:00</span>
                </div>
                <div class="time-presets" style="margin-top: 8px;">
                  <button class="btn btn-tiny" id="btn-time-sunrise" title="Sunrise">🌅</button>
                  <button class="btn btn-tiny" id="btn-time-noon" title="Noon">☀️</button>
                  <button class="btn btn-tiny" id="btn-time-sunset" title="Sunset">🌇</button>
                  <button class="btn btn-tiny" id="btn-time-night" title="Night">🌙</button>
                </div>
              </div>
            </div>

            <!-- First Person View -->
            <div class="sidebar-section">
              <h4>👁️ First Person View</h4>
              <div class="fpv-options">
                <button class="btn btn-small" id="btn-toggle-fpv">Enter FPV</button>
                <div class="fpv-info" style="font-size: 11px; color: #666; margin-top: 8px;">
                  <p>🚀 View from rocket's perspective</p>
                  <p>Right-click + drag to look around</p>
                </div>
                <div class="option-row" style="margin-top: 8px;">
                  <label style="width: 50px;">FOV:</label>
                  <input type="range" id="fpv-fov" min="60" max="120" value="90" style="flex: 1;">
                  <span id="fpv-fov-val" style="width: 35px; text-align: right;">90°</span>
                </div>
              </div>
            </div>

            <!-- KML Export -->
            <div class="sidebar-section">
              <h4>🌍 KML Export</h4>
              <div class="kml-options">
                <p style="font-size: 11px; color: #666; margin-bottom: 8px;">
                  Export trajectory for Google Earth
                </p>
                <div class="option-row" style="margin-bottom: 5px;">
                  <label style="width: 70px;">Latitude:</label>
                  <input type="number" id="kml-lat" value="28.5729" step="0.0001" style="flex: 1; width: 80px;">
                </div>
                <div class="option-row" style="margin-bottom: 5px;">
                  <label style="width: 70px;">Longitude:</label>
                  <input type="number" id="kml-lon" value="-80.6490" step="0.0001" style="flex: 1; width: 80px;">
                </div>
                <button class="btn btn-small btn-primary" id="btn-export-kml">📥 Export KML</button>
              </div>
            </div>

            <!-- Camera Presets -->
            <div class="sidebar-section">
              <h4>📷 Camera Presets</h4>
              <div class="camera-presets">
                <button class="btn btn-small" id="btn-cam-default">Default</button>
                <button class="btn btn-small" id="btn-cam-top">Top Down</button>
                <button class="btn btn-small" id="btn-cam-side">Side View</button>
                <button class="btn btn-small" id="btn-cam-apogee">Focus Apogee</button>
              </div>
            </div>

            <!-- Rocket Appearance -->
            <div class="sidebar-section">
              <h4>🎨 Rocket Colors</h4>
              <div class="color-options">
                <div class="color-row">
                  <label>Body:</label>
                  <input type="color" id="color-body" value="#ff4444">
                </div>
                <div class="color-row">
                  <label>Nose:</label>
                  <input type="color" id="color-nose" value="#ffffff">
                </div>
                <div class="color-row">
                  <label>Fins:</label>
                  <input type="color" id="color-fins" value="#333333">
                </div>
                <button class="btn btn-small" id="btn-apply-colors">Apply Colors</button>
              </div>
            </div>

            <!-- Info Panel -->
            <div class="sidebar-section">
              <h4>ℹ️ Controls</h4>
              <div class="controls-help">
                <p><strong>Mouse:</strong> Left-drag to rotate, scroll to zoom</p>
                <p><strong>Camera Modes:</strong></p>
                <ul>
                  <li><em>Orbit:</em> Free rotation around scene</li>
                  <li><em>Follow:</em> Camera tracks rocket position</li>
                  <li><em>Chase:</em> Camera follows behind rocket</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <!-- No Simulation Warning -->
        <div class="view3d-warning" id="view3d-no-sim" style="display: none;">
          <div class="warning-content">
            <span class="warning-icon">⚠️</span>
            <p>No simulation data available. Run a simulation first to see the flight replay.</p>
            <button class="btn btn-secondary" id="btn-goto-simulate">Go to Simulate Tab</button>
          </div>
        </div>
      </div>
    `;
  }

  renderOptimizeTab() {
    return `
      <div class="optimize-panel">
        <div class="panel-section">
          <h3>🎯 Flight Optimizer</h3>
          <p class="section-desc">Find the optimal motor to achieve your target altitude</p>
          
          <div class="optimizer-form">
            <div class="form-group">
              <label>Optimization Mode</label>
              <select id="opt-mode">
                <option value="altitude">Target Altitude</option>
                <option value="tarc">TARC Competition (825 ft, 41-44s)</option>
                <option value="minDrift">Minimum Drift</option>
              </select>
            </div>
            
            <div class="form-group" id="opt-altitude-group">
              <label>Target Altitude</label>
              <div class="input-row">
                <input type="number" id="opt-altitude" value="850" min="100" max="50000">
                <select id="opt-units">
                  <option value="feet">feet</option>
                  <option value="meters">meters</option>
                </select>
              </div>
            </div>
            
            <div class="form-group">
              <label>Motor Constraints</label>
              <div class="constraint-grid">
                <div class="constraint-item">
                  <label>Max Diameter</label>
                  <select id="opt-max-diameter">
                    <option value="18">18mm</option>
                    <option value="24">24mm</option>
                    <option value="29" selected>29mm</option>
                    <option value="38">38mm</option>
                    <option value="54">54mm</option>
                    <option value="75">75mm</option>
                    <option value="98">98mm</option>
                  </select>
                </div>
                <div class="constraint-item">
                  <label>Max Impulse</label>
                  <select id="opt-max-impulse">
                    <option value="D">D (20 Ns)</option>
                    <option value="E">E (40 Ns)</option>
                    <option value="F">F (80 Ns)</option>
                    <option value="G" selected>G (160 Ns)</option>
                    <option value="H">H (320 Ns)</option>
                    <option value="I">I (640 Ns)</option>
                    <option value="J">J (1280 Ns)</option>
                    <option value="K">K (2560 Ns)</option>
                  </select>
                </div>
              </div>
            </div>
            
            <button class="btn btn-primary btn-large" id="btn-run-optimizer">
              🔍 Find Optimal Motors
            </button>
          </div>
        </div>

        <div class="panel-section" id="opt-results-section" style="display: none;">
          <h3>📋 Optimization Results</h3>
          <div id="opt-results"></div>
        </div>
      </div>
    `;
  }

  renderLaunchDayTab() {
    return `
      <div class="launchday-panel">
        <div class="panel-section launchday-header">
          <h2>🎯 Launch Day Assistant</h2>
          <p class="section-desc">Your comprehensive launch readiness dashboard</p>
          <button class="btn btn-primary btn-large" id="btn-check-readiness">
            🔄 Check Launch Readiness
          </button>
        </div>

        <div class="launchday-grid">
          <div class="panel-section launchday-status" id="launchday-status">
            <h3>📊 Overall Status</h3>
            <div class="status-placeholder">
              <span class="status-icon">❓</span>
              <span class="status-text">Click "Check Launch Readiness" to analyze</span>
            </div>
          </div>

          <div class="panel-section launchday-weather" id="launchday-weather">
            <h3>🌤️ Weather Assessment</h3>
            <div class="weather-placeholder">Awaiting weather data...</div>
          </div>

          <div class="panel-section launchday-drift" id="launchday-drift">
            <h3>🎯 Drift Prediction</h3>
            <div class="drift-placeholder">Run simulation for drift prediction</div>
          </div>

          <div class="panel-section launchday-systems" id="launchday-systems">
            <h3>✅ System Checks</h3>
            <div class="systems-list">
              <div class="system-check" data-system="stability">
                <span class="check-icon">⏳</span>
                <span class="check-label">Stability</span>
                <span class="check-status">Pending</span>
              </div>
              <div class="system-check" data-system="flutter">
                <span class="check-icon">⏳</span>
                <span class="check-label">Fin Flutter</span>
                <span class="check-status">Pending</span>
              </div>
              <div class="system-check" data-system="recovery">
                <span class="check-icon">⏳</span>
                <span class="check-label">Recovery</span>
                <span class="check-status">Pending</span>
              </div>
              <div class="system-check" data-system="waiver">
                <span class="check-icon">⏳</span>
                <span class="check-label">Waiver</span>
                <span class="check-status">Pending</span>
              </div>
            </div>
          </div>
        </div>

        <div class="panel-section launchday-checklist">
          <h3>📋 Pre-Flight Checklist</h3>
          <div class="checklist-controls">
            <button class="btn btn-secondary btn-small" id="btn-reset-checklist">Reset</button>
            <span class="checklist-progress">0 / 0 items</span>
          </div>
          <div class="checklist-items" id="checklist-items">
            <p class="placeholder">Configure rocket to generate checklist</p>
          </div>
        </div>

        <div class="panel-section launchday-recovery">
          <h3>🪂 Recovery Planning</h3>
          <div class="recovery-config">
            <div class="form-row">
              <label>Recovery Type</label>
              <select id="recovery-type">
                <option value="single">Single Deploy (Apogee)</option>
                <option value="dual">Dual Deploy</option>
              </select>
            </div>
            <div id="dual-deploy-config" style="display: none;">
              <div class="form-row">
                <label>Drogue Diameter (mm)</label>
                <input type="number" id="drogue-diameter" value="350" min="100" max="1000">
              </div>
              <div class="form-row">
                <label>Main Diameter (mm)</label>
                <input type="number" id="main-diameter" value="1200" min="300" max="3000">
              </div>
              <div class="form-row">
                <label>Main Deploy Altitude (ft)</label>
                <select id="main-deploy-alt">
                  <option value="300">300 ft</option>
                  <option value="400">400 ft</option>
                  <option value="500" selected>500 ft</option>
                  <option value="600">600 ft</option>
                  <option value="700">700 ft</option>
                  <option value="800">800 ft</option>
                  <option value="1000">1000 ft</option>
                </select>
              </div>
            </div>
            <button class="btn btn-secondary" id="btn-simulate-recovery">
              🪂 Simulate Recovery
            </button>
          </div>
          <div class="recovery-results" id="recovery-results">
            <p class="placeholder">Configure recovery and click simulate</p>
          </div>
        </div>

        <div class="panel-section launchday-recommend">
          <h3>💡 Launch Recommendations</h3>
          <div class="recommendations" id="launchday-recommendations">
            <p class="placeholder">Recommendations will appear after readiness check</p>
          </div>
        </div>
      </div>
    `;
  }

  renderFlightLogTab() {
    return `
      <div class="flightlog-panel">
        <div class="panel-section flightlog-header">
          <h2>📓 Flight Log</h2>
          <p class="section-desc">Track flights, compare predictions vs actual, and calibrate simulations</p>
          <div class="header-buttons">
            <button class="btn btn-primary" id="btn-log-flight">➕ Log New Flight</button>
            <button class="btn btn-secondary" id="btn-export-log">📤 Export</button>
            <button class="btn btn-secondary" id="btn-import-log">📥 Import</button>
          </div>
        </div>

        <div class="flightlog-grid">
          <div class="panel-section flightlog-stats" id="flightlog-stats">
            <h3>📊 Statistics</h3>
            <div class="stats-placeholder">
              <p>No flights logged yet</p>
            </div>
          </div>

          <div class="panel-section flightlog-accuracy" id="flightlog-accuracy">
            <h3>🎯 Prediction Accuracy</h3>
            <div class="accuracy-placeholder">
              <p>Log flights with prediction data to see accuracy metrics</p>
            </div>
          </div>
        </div>

        <div class="panel-section flightlog-calibration" id="flightlog-calibration">
          <h3>🔧 Calibration Factors</h3>
          <div class="calibration-placeholder">
            <p>Need at least 3 flights with data for calibration recommendations</p>
          </div>
        </div>

        <div class="panel-section flightlog-list">
          <h3>📋 Flight History</h3>
          <div class="flight-filters">
            <input type="text" id="flight-search" placeholder="Search flights..." class="form-control">
            <select id="flight-filter-rocket" class="form-control">
              <option value="">All Rockets</option>
            </select>
          </div>
          <div class="flights-list" id="flights-list">
            <p class="placeholder">No flights logged yet. Click "Log New Flight" to add your first flight.</p>
          </div>
        </div>

        <!-- Log Flight Modal -->
        <div class="modal" id="log-flight-modal" style="display: none;">
          <div class="modal-content">
            <div class="modal-header">
              <h3>📓 Log New Flight</h3>
              <button class="btn-close" id="close-log-modal">&times;</button>
            </div>
            <div class="modal-body">
              <form id="log-flight-form">
                <div class="form-section">
                  <h4>Flight Info</h4>
                  <div class="form-row">
                    <label>Date</label>
                    <input type="date" name="date" required>
                  </div>
                  <div class="form-row">
                    <label>Rocket Name</label>
                    <input type="text" name="rocketName" placeholder="My Rocket" required>
                  </div>
                  <div class="form-row">
                    <label>Motor</label>
                    <input type="text" name="motorDesignation" placeholder="e.g., J350W">
                  </div>
                  <div class="form-row">
                    <label>Location</label>
                    <input type="text" name="location" placeholder="Launch site">
                  </div>
                  <div class="form-row">
                    <label>Outcome</label>
                    <select name="outcome">
                      <option value="success">✅ Success</option>
                      <option value="partial">⚠️ Partial Success</option>
                      <option value="failure">❌ Failure</option>
                      <option value="unknown">❓ Unknown</option>
                    </select>
                  </div>
                </div>

                <div class="form-section">
                  <h4>Predicted Values (from simulation)</h4>
                  <div class="form-row-grid">
                    <div class="form-row">
                      <label>Apogee (m)</label>
                      <input type="number" name="predictedApogee" step="0.1">
                    </div>
                    <div class="form-row">
                      <label>Max Velocity (m/s)</label>
                      <input type="number" name="predictedMaxVelocity" step="0.1">
                    </div>
                  </div>
                  <button type="button" class="btn btn-small btn-secondary" id="btn-use-sim-data">
                    📊 Use Current Simulation
                  </button>
                </div>

                <div class="form-section">
                  <h4>Actual Results (from altimeter)</h4>
                  <div class="form-row-grid">
                    <div class="form-row">
                      <label>Apogee (m)</label>
                      <input type="number" name="actualApogee" step="0.1">
                    </div>
                    <div class="form-row">
                      <label>Max Velocity (m/s)</label>
                      <input type="number" name="actualMaxVelocity" step="0.1">
                    </div>
                  </div>
                  <div class="form-row">
                    <label>Data Source</label>
                    <select name="dataSource">
                      <option value="altimeter">Altimeter</option>
                      <option value="gps">GPS</option>
                      <option value="video">Video Analysis</option>
                      <option value="manual">Manual Estimate</option>
                    </select>
                  </div>
                </div>

                <div class="form-section">
                  <h4>Weather Conditions</h4>
                  <div class="form-row-grid">
                    <div class="form-row">
                      <label>Wind Speed (m/s)</label>
                      <input type="number" name="windSpeed" step="0.1">
                    </div>
                    <div class="form-row">
                      <label>Temperature (°C)</label>
                      <input type="number" name="temperature" step="1">
                    </div>
                  </div>
                  <button type="button" class="btn btn-small btn-secondary" id="btn-use-weather-data">
                    🌤️ Use Current Weather
                  </button>
                </div>

                <div class="form-section">
                  <h4>Notes</h4>
                  <textarea name="notes" rows="3" placeholder="Any observations, issues, or notes..."></textarea>
                </div>

                <div class="form-actions">
                  <button type="submit" class="btn btn-primary">💾 Save Flight</button>
                  <button type="button" class="btn btn-secondary" id="btn-cancel-log">Cancel</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderMultiStageTab() {
    return `
      <div class="multistage-panel">
        <div class="panel-section multistage-header">
          <h2>🚀 Multi-Stage Rocket Simulator</h2>
          <p class="section-desc">Design and simulate multi-stage rockets with serial and parallel staging</p>
          <div class="header-buttons">
            <button class="btn btn-primary" id="btn-add-stage">➕ Add Stage</button>
            <button class="btn btn-secondary" id="btn-add-strapon">➕ Add Strap-on</button>
            <select id="multistage-preset" class="form-control">
              <option value="">Load Preset...</option>
              <option value="twoStageMinDia">Two-Stage Min Dia (D12)</option>
              <option value="twoStageHPR">Two-Stage HPR (J motors)</option>
              <option value="threeStage">Three-Stage Sounding</option>
              <option value="parallelStaging">Parallel Staging (Core + Boosters)</option>
            </select>
          </div>
        </div>

        <div class="multistage-workspace">
          <div class="panel-section stage-builder">
            <h3>📐 Stage Configuration</h3>
            <div class="rocket-name-row">
              <label>Rocket Name:</label>
              <input type="text" id="multistage-name" value="Multi-Stage Rocket" class="form-control">
            </div>
            <div class="stages-container" id="stages-container">
              <p class="placeholder">No stages added. Click "Add Stage" or load a preset to begin.</p>
            </div>
          </div>

          <div class="panel-section stage-visual">
            <h3>🎨 Stage Stack</h3>
            <div class="stage-stack-visual" id="stage-stack-visual">
              <p class="placeholder">Add stages to see visual representation</p>
            </div>
            <div class="stage-stats" id="stage-stats">
              <div class="stat-row">
                <span class="stat-label">Total Length:</span>
                <span class="stat-value" id="total-length">--</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Total Mass:</span>
                <span class="stat-value" id="total-mass">--</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">Stability:</span>
                <span class="stat-value" id="stability-margin">--</span>
              </div>
            </div>
          </div>
        </div>

        <div class="panel-section simulation-controls">
          <h3>⚡ Simulation</h3>
          <div class="sim-params">
            <div class="form-row">
              <label>Launch Angle (°)</label>
              <input type="number" id="ms-launch-angle" value="5" min="0" max="30" step="1">
            </div>
            <div class="form-row">
              <label>Max Time (s)</label>
              <input type="number" id="ms-max-time" value="120" min="30" max="600" step="10">
            </div>
            <button class="btn btn-primary btn-large" id="btn-run-multistage-sim">
              🚀 Run Simulation
            </button>
          </div>
        </div>

        <div class="panel-section simulation-results" id="multistage-results" style="display: none;">
          <h3>📊 Simulation Results</h3>
          
          <div class="results-summary" id="ms-results-summary">
            <!-- Filled by JavaScript -->
          </div>

          <div class="results-events">
            <h4>📋 Event Timeline</h4>
            <div class="event-timeline" id="ms-event-timeline">
              <!-- Filled by JavaScript -->
            </div>
          </div>

          <div class="results-chart">
            <h4>📈 Altitude Profile</h4>
            <canvas id="ms-trajectory-canvas" width="700" height="300"></canvas>
          </div>

          <div class="stage-trajectories" id="ms-stage-trajectories">
            <!-- Separated stage info -->
          </div>
        </div>
      </div>

      <!-- Add Stage Modal -->
      <div class="modal" id="add-stage-modal" style="display: none;">
        <div class="modal-content modal-large">
          <div class="modal-header">
            <h3>➕ Add Stage</h3>
            <button class="btn-close" id="close-stage-modal">&times;</button>
          </div>
          <div class="modal-body">
            <form id="add-stage-form">
              <div class="form-grid-2col">
                <div class="form-section">
                  <h4>Stage Info</h4>
                  <div class="form-row">
                    <label>Stage Name</label>
                    <input type="text" name="stageName" value="Stage" required>
                  </div>
                  <div class="form-row">
                    <label>Stage Type</label>
                    <select name="stageType">
                      <option value="booster">Booster (First Stage)</option>
                      <option value="sustainer">Sustainer (Main Stage)</option>
                      <option value="upper">Upper Stage</option>
                    </select>
                  </div>
                </div>

                <div class="form-section">
                  <h4>Geometry</h4>
                  <div class="form-row">
                    <label>Length (m)</label>
                    <input type="number" name="length" value="0.4" step="0.01" min="0.1" max="3">
                  </div>
                  <div class="form-row">
                    <label>Body Diameter (mm)</label>
                    <input type="number" name="bodyDiameter" value="54" step="1" min="18" max="200">
                  </div>
                  <div class="form-row">
                    <label>Dry Mass (kg)</label>
                    <input type="number" name="dryMass" value="0.4" step="0.01" min="0.01" max="20">
                  </div>
                </div>

                <div class="form-section">
                  <h4>Motor</h4>
                  <div class="form-row">
                    <label>Motor Designation</label>
                    <input type="text" name="motorDesignation" value="J350W" placeholder="e.g., J350W">
                  </div>
                  <div class="form-row">
                    <label>Total Impulse (Ns)</label>
                    <input type="number" name="totalImpulse" value="658" step="1" min="1">
                  </div>
                  <div class="form-row">
                    <label>Burn Time (s)</label>
                    <input type="number" name="burnTime" value="1.9" step="0.1" min="0.1">
                  </div>
                  <div class="form-row">
                    <label>Propellant Mass (kg)</label>
                    <input type="number" name="propellantMass" value="0.32" step="0.01" min="0.01">
                  </div>
                  <div class="form-row">
                    <label>Motor Total Mass (kg)</label>
                    <input type="number" name="motorMass" value="0.48" step="0.01" min="0.01">
                  </div>
                </div>

                <div class="form-section">
                  <h4>Features</h4>
                  <div class="form-row checkbox-row">
                    <input type="checkbox" name="hasFins" id="stage-has-fins" checked>
                    <label for="stage-has-fins">Has Fins</label>
                  </div>
                  <div class="form-row checkbox-row">
                    <input type="checkbox" name="hasNoseCone" id="stage-has-nose">
                    <label for="stage-has-nose">Has Nose Cone</label>
                  </div>
                  <div class="form-row">
                    <label>Fin Count</label>
                    <input type="number" name="finCount" value="4" min="3" max="8">
                  </div>
                </div>

                <div class="form-section">
                  <h4>Separation</h4>
                  <div class="form-row">
                    <label>Separation Trigger</label>
                    <select name="separationTrigger">
                      <option value="burnout">Motor Burnout</option>
                      <option value="timer">Timer</option>
                      <option value="altitude">Altitude</option>
                    </select>
                  </div>
                  <div class="form-row">
                    <label>Separation Delay (s)</label>
                    <input type="number" name="separationDelay" value="0.5" step="0.1" min="0">
                  </div>
                </div>

                <div class="form-section">
                  <h4>Ignition</h4>
                  <div class="form-row">
                    <label>Ignition Trigger</label>
                    <select name="ignitionTrigger">
                      <option value="liftoff">At Liftoff</option>
                      <option value="separation">On Separation</option>
                      <option value="delay">Delayed</option>
                    </select>
                  </div>
                  <div class="form-row">
                    <label>Ignition Delay (s)</label>
                    <input type="number" name="ignitionDelay" value="0" step="0.1" min="0">
                  </div>
                </div>
              </div>

              <div class="form-actions">
                <button type="submit" class="btn btn-primary">➕ Add Stage</button>
                <button type="button" class="btn btn-secondary" id="btn-cancel-stage">Cancel</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
  }

  renderRecoveryTab() {
    return `
      <div class="recovery-panel">
        <div class="panel-section recovery-header">
          <h2>🪂 Recovery System Planner</h2>
          <p class="section-desc">Plan, simulate and optimize your recovery system with dual deploy support</p>
        </div>

        <div class="recovery-grid">
          <!-- Recovery Planner Section -->
          <div class="panel-section recovery-planner">
            <h3>📐 Recovery Planner</h3>
            <p class="helper-text">Calculate optimal parachute sizes for safe landing</p>
            
            <div class="planner-inputs">
              <div class="form-row">
                <label>Rocket Mass (g)</label>
                <input type="number" id="recovery-mass" value="1500" min="100" max="50000" step="50">
              </div>
              <div class="form-row">
                <label>Expected Apogee (ft)</label>
                <input type="number" id="recovery-apogee" value="2500" min="100" max="50000" step="100">
              </div>
              <div class="form-row">
                <label>Target Landing Velocity (ft/s)</label>
                <input type="number" id="recovery-landing-vel" value="15" min="10" max="25" step="1">
              </div>
              <div class="form-row">
                <label>Target Drogue Descent (ft/s)</label>
                <input type="number" id="recovery-drogue-vel" value="75" min="40" max="120" step="5">
              </div>
              <div class="form-row">
                <label>Main Deploy Altitude (ft)</label>
                <select id="recovery-main-alt">
                  <option value="300">300 ft</option>
                  <option value="400">400 ft</option>
                  <option value="500" selected>500 ft</option>
                  <option value="600">600 ft</option>
                  <option value="700">700 ft</option>
                  <option value="800">800 ft</option>
                  <option value="1000">1000 ft</option>
                </select>
              </div>
              <button class="btn btn-primary" id="btn-calc-recovery">
                🧮 Calculate Recommendations
              </button>
            </div>

            <div class="planner-results" id="planner-results" style="display: none;">
              <h4>📋 Recommendations</h4>
              <div class="recommendation-cards" id="recommendation-cards">
                <!-- Filled by JavaScript -->
              </div>
              <div class="planner-notes" id="planner-notes">
                <!-- Filled by JavaScript -->
              </div>
            </div>
          </div>

          <!-- Wind Profile Editor -->
          <div class="panel-section wind-profile-editor">
            <h3>💨 Wind Profile</h3>
            <p class="helper-text">Configure wind at different altitudes</p>
            
            <div class="wind-inputs">
              <div class="form-row">
                <label>Ground Wind Speed (m/s)</label>
                <input type="number" id="wind-ground-speed" value="5" min="0" max="30" step="0.5">
              </div>
              <div class="form-row">
                <label>Ground Wind Direction (°)</label>
                <input type="number" id="wind-ground-dir" value="270" min="0" max="359" step="5">
                <span class="dir-indicator" id="wind-dir-indicator">W</span>
              </div>
              <div class="form-row">
                <label>Gust Factor</label>
                <input type="number" id="wind-gust-factor" value="1.3" min="1.0" max="2.0" step="0.1">
              </div>
            </div>

            <div class="wind-layers">
              <h4>🌬️ Custom Wind Layers</h4>
              <div class="wind-layer-list" id="wind-layer-list">
                <div class="wind-layer-info">
                  <span>Using power law profile (wind increases with altitude)</span>
                </div>
              </div>
              <button class="btn btn-small btn-secondary" id="btn-add-wind-layer">➕ Add Custom Layer</button>
            </div>

            <div class="wind-profile-chart">
              <h4>📊 Wind vs Altitude</h4>
              <canvas id="wind-profile-canvas" width="280" height="200"></canvas>
            </div>
          </div>
        </div>

        <!-- Dual Deploy Configuration -->
        <div class="panel-section dual-deploy-config">
          <h3>⚙️ Dual Deploy Configuration</h3>
          
          <div class="deploy-config-grid">
            <div class="deploy-section drogue-config">
              <h4>🔴 Drogue Parachute</h4>
              <div class="form-row">
                <label>Diameter (mm)</label>
                <input type="number" id="dd-drogue-dia" value="450" min="100" max="2000" step="10">
              </div>
              <div class="form-row">
                <label>Type</label>
                <select id="dd-drogue-type">
                  <option value="cruciform" selected>Cruciform</option>
                  <option value="round">Round</option>
                  <option value="elliptical">Elliptical</option>
                </select>
              </div>
              <div class="form-row">
                <label>Deploy Event</label>
                <select id="dd-drogue-event">
                  <option value="apogee" selected>At Apogee</option>
                  <option value="delay">Apogee + Delay</option>
                </select>
              </div>
              <div class="form-row" id="drogue-delay-row" style="display: none;">
                <label>Delay (s)</label>
                <input type="number" id="dd-drogue-delay" value="1" min="0" max="5" step="0.5">
              </div>
            </div>

            <div class="deploy-section main-config">
              <h4>🟢 Main Parachute</h4>
              <div class="form-row">
                <label>Diameter (mm)</label>
                <input type="number" id="dd-main-dia" value="1200" min="300" max="5000" step="50">
              </div>
              <div class="form-row">
                <label>Type</label>
                <select id="dd-main-type">
                  <option value="round" selected>Round</option>
                  <option value="elliptical">Elliptical</option>
                  <option value="toroidal">Toroidal</option>
                </select>
              </div>
              <div class="form-row">
                <label>Deploy Altitude (ft)</label>
                <select id="dd-main-deploy-alt">
                  <option value="300">300 ft</option>
                  <option value="400">400 ft</option>
                  <option value="500" selected>500 ft</option>
                  <option value="600">600 ft</option>
                  <option value="700">700 ft</option>
                  <option value="800">800 ft</option>
                  <option value="1000">1000 ft</option>
                </select>
              </div>
              <div class="form-row">
                <label>Backup Altitude (ft)</label>
                <input type="number" id="dd-backup-alt" value="300" min="200" max="500" step="50">
              </div>
            </div>

            <div class="deploy-section rocket-config">
              <h4>🚀 Rocket Settings</h4>
              <div class="form-row">
                <label>Dry Mass (g)</label>
                <input type="number" id="dd-rocket-mass" value="1500" min="100" max="50000" step="50">
              </div>
              <div class="form-row">
                <label>Apogee Altitude (ft)</label>
                <input type="number" id="dd-apogee" value="3000" min="500" max="50000" step="100">
              </div>
              <button class="btn btn-primary btn-large" id="btn-run-dual-deploy">
                🪂 Simulate Recovery
              </button>
            </div>
          </div>
        </div>

        <!-- Dual Deploy Results -->
        <div class="panel-section dual-deploy-results" id="dual-deploy-results" style="display: none;">
          <h3>📊 Recovery Simulation Results</h3>
          
          <div class="dd-results-summary" id="dd-results-summary">
            <!-- Filled by JavaScript -->
          </div>

          <div class="dd-results-grid">
            <div class="dd-timeline">
              <h4>⏱️ Event Timeline</h4>
              <div class="recovery-timeline" id="recovery-timeline">
                <!-- Filled by JavaScript -->
              </div>
            </div>

            <div class="dd-phases">
              <h4>📋 Descent Phases</h4>
              <div class="phase-cards" id="phase-cards">
                <!-- Filled by JavaScript -->
              </div>
            </div>
          </div>

          <div class="dd-safety" id="dd-safety">
            <!-- Safety assessment -->
          </div>

          <div class="dd-chart">
            <h4>📈 Descent Profile</h4>
            <canvas id="descent-profile-canvas" width="700" height="300"></canvas>
          </div>

          <div class="dd-drift">
            <h4>🎯 Landing Zone Prediction</h4>
            <canvas id="drift-map-canvas" width="400" height="400"></canvas>
            <div class="drift-stats" id="drift-stats">
              <!-- Filled by JavaScript -->
            </div>
          </div>

          <div class="dd-altimeter">
            <h4>⚙️ Altimeter Settings</h4>
            <div class="altimeter-settings" id="altimeter-settings">
              <!-- Filled by JavaScript -->
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderCompareTab() {
    return `
      <div class="compare-panel">
        <div class="panel-section">
          <h3>📊 Flight Data Import</h3>
          <p class="section-desc">Import actual flight data to compare with simulation</p>
          
          <div class="import-dropzone" id="flight-data-dropzone">
            <span class="dropzone-icon">📈</span>
            <span class="dropzone-text">Drop flight data file or click to import</span>
            <span class="dropzone-formats">Supports: CSV, PerfectFlite, Eggtimer, Featherweight, AltimeterTwo</span>
            <input type="file" id="flight-data-input" accept=".csv,.txt,.pf" hidden>
          </div>
        </div>

        <div class="panel-section" id="flight-analysis-section" style="display: none;">
          <h3>📈 Flight Analysis</h3>
          <div id="flight-analysis-stats"></div>
        </div>

        <div class="panel-section" id="comparison-section" style="display: none;">
          <h3>🔄 Simulation vs Actual</h3>
          <div id="comparison-results"></div>
          <div class="comparison-chart-container">
            <canvas id="comparison-chart" width="700" height="350"></canvas>
          </div>
        </div>
      </div>
    `;
  }

  renderIntegrationTab() {
    return `
      <div class="integration-panel">
        <div class="panel-section integration-header">
          <h2>🔗 Integration & Sharing</h2>
          <p class="section-desc">Import flight data from altimeters, track with GPS, and share with your club</p>
        </div>

        <div class="integration-grid">
          <!-- Altimeter Data Import Section -->
          <div class="panel-section altimeter-section">
            <h3>📊 Altimeter Data Import</h3>
            <p class="helper-text">Import actual flight data from popular altimeters</p>
            
            <div class="altimeter-dropzone" id="altimeter-dropzone">
              <span class="dropzone-icon">📈</span>
              <span class="dropzone-text">Drop altimeter data file or click to import</span>
              <span class="dropzone-formats">StratoLogger, Eggtimer, Jolly Logic, Altus Metrum, Featherweight, and more</span>
              <input type="file" id="altimeter-file-input" accept=".csv,.txt,.log,.eeprom" hidden>
            </div>

            <div class="form-row" style="margin-top: 15px;">
              <label>Format Override</label>
              <select id="altimeter-format-select">
                <option value="auto">Auto-detect</option>
                <option value="STRATOLOGGER">PerfectFlite StratoLogger</option>
                <option value="STRATOLOGGER_CF">PerfectFlite StratoLoggerCF</option>
                <option value="EGGTIMER">Eggtimer Rocketry</option>
                <option value="EGGTIMER_QUARK">Eggtimer Quark</option>
                <option value="PERFECTFLITE">PerfectFlite Pnut/miniAlt</option>
                <option value="JOLLY_LOGIC">Jolly Logic AltimeterOne/Two/Three</option>
                <option value="ALTUS_METRUM">Altus Metrum (TeleMega/TeleMetrum)</option>
                <option value="FEATHERWEIGHT">Featherweight Raven</option>
                <option value="ENTACORE">Entacore AIM/ARTS</option>
                <option value="MISSILEWORKS">MissileWorks RRC3</option>
                <option value="GENERIC_CSV">Generic CSV (Time, Altitude)</option>
              </select>
            </div>

            <div id="altimeter-results" class="altimeter-results" style="display: none;">
              <h4>Imported Flight Data</h4>
              <div id="altimeter-summary"></div>
              <div class="altimeter-actions">
                <button class="btn btn-primary" id="btn-view-altimeter-3d">🎮 View in 3D</button>
                <button class="btn btn-secondary" id="btn-compare-with-sim">📊 Compare with Simulation</button>
                <button class="btn btn-secondary" id="btn-export-altimeter-csv">💾 Export as CSV</button>
                <button class="btn btn-secondary" id="btn-save-to-flight-log">📓 Save to Flight Log</button>
              </div>
            </div>
          </div>

          <!-- GPS Tracking Section -->
          <div class="panel-section gps-section">
            <h3>📍 GPS Tracking</h3>
            <p class="helper-text">Real-time GPS tracking for rocket recovery</p>
            
            <div class="gps-status" id="gps-status">
              <div class="gps-indicator">
                <span class="gps-dot" id="gps-dot">●</span>
                <span id="gps-status-text">GPS Not Active</span>
              </div>
              <div class="gps-accuracy" id="gps-accuracy" style="display: none;">
                Accuracy: <span id="gps-accuracy-value">--</span>m
              </div>
            </div>

            <div class="form-section">
              <h4>Launch Site</h4>
              <div class="form-row">
                <label>Latitude</label>
                <input type="number" id="launch-lat" step="0.000001" placeholder="e.g., 35.3472">
              </div>
              <div class="form-row">
                <label>Longitude</label>
                <input type="number" id="launch-lon" step="0.000001" placeholder="e.g., -117.8085">
              </div>
              <button class="btn btn-small" id="btn-use-current-location">📍 Use Current Location</button>
              <button class="btn btn-small" id="btn-set-launch-site">✓ Set as Launch Site</button>
            </div>

            <div class="gps-controls">
              <button class="btn btn-primary" id="btn-start-gps">▶️ Start Tracking</button>
              <button class="btn btn-secondary" id="btn-stop-gps" disabled>⏹️ Stop Tracking</button>
            </div>

            <div id="gps-tracking-panel" class="gps-tracking-panel" style="display: none;">
              <h4>Live Position</h4>
              <div class="gps-live-data">
                <div class="gps-data-row">
                  <span class="gps-label">Position:</span>
                  <span id="gps-position">--</span>
                </div>
                <div class="gps-data-row">
                  <span class="gps-label">Altitude:</span>
                  <span id="gps-altitude">--</span>
                </div>
                <div class="gps-data-row">
                  <span class="gps-label">Speed:</span>
                  <span id="gps-speed">--</span>
                </div>
                <div class="gps-data-row">
                  <span class="gps-label">Distance from Launch:</span>
                  <span id="gps-distance">--</span>
                </div>
                <div class="gps-data-row">
                  <span class="gps-label">Bearing:</span>
                  <span id="gps-bearing">--</span>
                </div>
                <div class="gps-data-row">
                  <span class="gps-label">Track Points:</span>
                  <span id="gps-track-points">0</span>
                </div>
              </div>
              <div class="gps-track-actions">
                <button class="btn btn-small" id="btn-export-gpx">📁 Export GPX</button>
                <button class="btn btn-small" id="btn-view-track-3d">🎮 View Track</button>
                <button class="btn btn-small" id="btn-open-in-maps">🗺️ Open in Maps</button>
              </div>
            </div>

            <div class="form-section" style="margin-top: 15px;">
              <h4>Import GPS Track</h4>
              <div class="import-row">
                <input type="file" id="gpx-file-input" accept=".gpx" hidden>
                <button class="btn btn-small" id="btn-import-gpx">📥 Import GPX File</button>
              </div>
            </div>
          </div>

          <!-- Club Sharing Section -->
          <div class="panel-section club-section">
            <h3>👥 Club & Competition</h3>
            <p class="helper-text">Share flights and compete with your club</p>
            
            <div class="club-tabs">
              <button class="club-tab active" data-club-tab="my-clubs">My Clubs</button>
              <button class="club-tab" data-club-tab="flights">Shared Flights</button>
              <button class="club-tab" data-club-tab="competitions">Competitions</button>
            </div>

            <div class="club-tab-content" id="club-tab-my-clubs">
              <div class="club-list" id="club-list">
                <div class="no-clubs">
                  <p>No clubs yet. Create or join a club to share flights!</p>
                </div>
              </div>
              <div class="club-actions">
                <button class="btn btn-primary" id="btn-create-club">➕ Create Club</button>
                <button class="btn btn-secondary" id="btn-import-club">📥 Import Club Data</button>
              </div>
            </div>

            <div class="club-tab-content" id="club-tab-flights" style="display: none;">
              <div class="shared-flights-header">
                <select id="club-filter-select">
                  <option value="">All Clubs</option>
                </select>
                <button class="btn btn-small btn-primary" id="btn-share-current-flight">📤 Share Current Flight</button>
              </div>
              <div class="shared-flights-list" id="shared-flights-list">
                <div class="no-flights">
                  <p>No shared flights yet.</p>
                </div>
              </div>
            </div>

            <div class="club-tab-content" id="club-tab-competitions" style="display: none;">
              <div class="competitions-list" id="competitions-list">
                <div class="no-competitions">
                  <p>No active competitions.</p>
                </div>
              </div>
              <div class="competition-actions">
                <button class="btn btn-primary" id="btn-create-competition">🏆 Create Competition</button>
              </div>
            </div>
          </div>

          <!-- Statistics Section -->
          <div class="panel-section stats-section">
            <h3>📈 Club Statistics</h3>
            <div id="club-statistics">
              <p class="no-data">Select a club to view statistics</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  renderAdvancedTab() {
    return `
      <div class="advanced-panel">
        <div class="panel-section advanced-header">
          <h2>⚙️ Advanced Configuration</h2>
          <p class="section-desc">Hardware-in-the-Loop testing and Thrust Vector Control configuration</p>
        </div>

        <div class="advanced-grid">
          <!-- TVC Configuration Section -->
          <div class="panel-section tvc-config">
            <h3>🎯 Thrust Vector Control (TVC)</h3>
            <p class="helper-text">Configure active guidance and gimbal parameters</p>
            
            <div class="tvc-enable-row">
              <input type="checkbox" id="tvc-enabled" class="toggle-switch">
              <label for="tvc-enabled">Enable TVC Simulation</label>
            </div>

            <div class="tvc-settings" id="tvc-settings">
              <div class="form-section">
                <h4>Gimbal Limits</h4>
                <div class="form-row">
                  <label>Max Gimbal Angle (°)</label>
                  <input type="number" id="tvc-max-angle" value="5" min="1" max="15" step="0.5">
                </div>
                <div class="form-row">
                  <label>Gimbal Rate (°/s)</label>
                  <input type="number" id="tvc-gimbal-rate" value="60" min="10" max="200" step="5">
                </div>
                <div class="form-row">
                  <label>Servo Update Rate (Hz)</label>
                  <input type="number" id="tvc-servo-rate" value="50" min="20" max="400" step="10">
                </div>
              </div>

              <div class="form-section">
                <h4>Control Mode</h4>
                <div class="form-row">
                  <label>Control Algorithm</label>
                  <select id="tvc-control-mode">
                    <option value="pid">PID Control</option>
                    <option value="lqr">LQR Control</option>
                    <option value="manual">Manual/External</option>
                  </select>
                </div>
              </div>

              <div class="form-section pid-gains" id="pid-gains-section">
                <h4>PID Gains (Pitch/Yaw)</h4>
                <div class="pid-grid">
                  <div class="form-row">
                    <label>Kp (Proportional)</label>
                    <input type="number" id="tvc-kp" value="2.0" min="0" max="10" step="0.1">
                  </div>
                  <div class="form-row">
                    <label>Ki (Integral)</label>
                    <input type="number" id="tvc-ki" value="0.1" min="0" max="5" step="0.01">
                  </div>
                  <div class="form-row">
                    <label>Kd (Derivative)</label>
                    <input type="number" id="tvc-kd" value="0.5" min="0" max="5" step="0.05">
                  </div>
                </div>
              </div>

              <div class="form-section">
                <h4>Target</h4>
                <div class="form-row">
                  <label>Target Pitch (°)</label>
                  <input type="number" id="tvc-target-pitch" value="0" min="-45" max="45" step="1">
                </div>
                <div class="form-row">
                  <label>Target Yaw (°)</label>
                  <input type="number" id="tvc-target-yaw" value="0" min="-45" max="45" step="1">
                </div>
              </div>

              <div class="tvc-visual">
                <h4>Gimbal Position</h4>
                <canvas id="tvc-gimbal-canvas" width="200" height="200"></canvas>
                <div class="gimbal-readout">
                  <span>X: <span id="gimbal-x-value">0.0</span>°</span>
                  <span>Y: <span id="gimbal-y-value">0.0</span>°</span>
                </div>
              </div>

              <button class="btn btn-primary" id="btn-test-tvc">🧪 Test TVC Response</button>
            </div>
          </div>

          <!-- HIL Interface Section -->
          <div class="panel-section hil-interface">
            <h3>🔌 Hardware-in-the-Loop (HIL)</h3>
            <p class="helper-text">Connect to flight computers for real-time testing</p>
            
            <div class="hil-status" id="hil-status">
              <div class="status-indicator disconnected">
                <span class="status-dot"></span>
                <span class="status-text">Disconnected</span>
              </div>
            </div>

            <div class="form-section">
              <h4>Connection Settings</h4>
              <div class="form-row">
                <label>Baud Rate</label>
                <select id="hil-baud-rate">
                  <option value="9600">9600</option>
                  <option value="19200">19200</option>
                  <option value="38400">38400</option>
                  <option value="57600">57600</option>
                  <option value="115200" selected>115200</option>
                  <option value="230400">230400</option>
                  <option value="460800">460800</option>
                  <option value="921600">921600</option>
                </select>
              </div>
              <div class="form-row">
                <label>Protocol</label>
                <select id="hil-protocol">
                  <option value="binary">Binary (Efficient)</option>
                  <option value="ascii">ASCII (Debug)</option>
                </select>
              </div>
              <div class="form-row">
                <label>Data Bits</label>
                <select id="hil-data-bits">
                  <option value="7">7</option>
                  <option value="8" selected>8</option>
                </select>
              </div>
              <div class="form-row">
                <label>Parity</label>
                <select id="hil-parity">
                  <option value="none" selected>None</option>
                  <option value="even">Even</option>
                  <option value="odd">Odd</option>
                </select>
              </div>

              <div class="hil-buttons">
                <button class="btn btn-primary" id="btn-hil-connect">🔌 Connect</button>
                <button class="btn btn-secondary" id="btn-hil-disconnect" disabled>⏏️ Disconnect</button>
              </div>
            </div>

            <div class="form-section">
              <h4>Sensor Simulation</h4>
              <div class="sensor-noise-settings">
                <div class="form-row">
                  <label>Accelerometer Noise (m/s²)</label>
                  <input type="number" id="hil-accel-noise" value="0.02" min="0" max="1" step="0.01">
                </div>
                <div class="form-row">
                  <label>Gyro Noise (rad/s)</label>
                  <input type="number" id="hil-gyro-noise" value="0.001" min="0" max="0.1" step="0.001">
                </div>
                <div class="form-row">
                  <label>Baro Noise (Pa)</label>
                  <input type="number" id="hil-baro-noise" value="2" min="0" max="20" step="0.5">
                </div>
                <div class="form-row">
                  <label>GPS Accuracy (m)</label>
                  <input type="number" id="hil-gps-accuracy" value="2.5" min="0.5" max="20" step="0.5">
                </div>
              </div>
            </div>

            <div class="form-section hil-monitor" id="hil-monitor" style="display: none;">
              <h4>📡 Live Data</h4>
              <div class="sensor-readouts">
                <div class="sensor-group">
                  <h5>Accelerometer (m/s²)</h5>
                  <div class="sensor-values">
                    <span>X: <span id="hil-accel-x">0.00</span></span>
                    <span>Y: <span id="hil-accel-y">0.00</span></span>
                    <span>Z: <span id="hil-accel-z">-9.81</span></span>
                  </div>
                </div>
                <div class="sensor-group">
                  <h5>Gyroscope (°/s)</h5>
                  <div class="sensor-values">
                    <span>X: <span id="hil-gyro-x">0.00</span></span>
                    <span>Y: <span id="hil-gyro-y">0.00</span></span>
                    <span>Z: <span id="hil-gyro-z">0.00</span></span>
                  </div>
                </div>
                <div class="sensor-group">
                  <h5>Barometer</h5>
                  <div class="sensor-values">
                    <span>Pressure: <span id="hil-baro-pressure">101325</span> Pa</span>
                    <span>Altitude: <span id="hil-baro-alt">0</span> m</span>
                  </div>
                </div>
                <div class="sensor-group">
                  <h5>GPS</h5>
                  <div class="sensor-values">
                    <span>Lat: <span id="hil-gps-lat">0.000000</span>°</span>
                    <span>Lon: <span id="hil-gps-lon">0.000000</span>°</span>
                    <span>Alt: <span id="hil-gps-alt">0</span> m</span>
                  </div>
                </div>
              </div>

              <div class="hil-stats">
                <h5>📊 Statistics</h5>
                <div class="stat-row">
                  <span>Packets Sent:</span>
                  <span id="hil-packets-sent">0</span>
                </div>
                <div class="stat-row">
                  <span>Packets Received:</span>
                  <span id="hil-packets-recv">0</span>
                </div>
                <div class="stat-row">
                  <span>Errors:</span>
                  <span id="hil-errors">0</span>
                </div>
                <div class="stat-row">
                  <span>Latency:</span>
                  <span id="hil-latency">0</span> ms
                </div>
              </div>

              <div class="hil-actuators">
                <h5>🎮 Actuator Commands (from FC)</h5>
                <div class="actuator-display">
                  <div class="actuator-item">
                    <span class="actuator-label">Gimbal X:</span>
                    <span class="actuator-value" id="hil-act-gimbal-x">0.0°</span>
                  </div>
                  <div class="actuator-item">
                    <span class="actuator-label">Gimbal Y:</span>
                    <span class="actuator-value" id="hil-act-gimbal-y">0.0°</span>
                  </div>
                  <div class="actuator-item">
                    <span class="actuator-label">Parachute:</span>
                    <span class="actuator-value" id="hil-act-chute">SAFE</span>
                  </div>
                  <div class="actuator-item">
                    <span class="actuator-label">Ignition:</span>
                    <span class="actuator-value" id="hil-act-ignition">DISARMED</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="form-section">
              <h4>HIL Test Controls</h4>
              <div class="hil-test-buttons">
                <button class="btn btn-secondary" id="btn-hil-start-sim" disabled>▶️ Start HIL Sim</button>
                <button class="btn btn-secondary" id="btn-hil-stop-sim" disabled>⏹️ Stop</button>
                <button class="btn btn-secondary" id="btn-hil-inject-fault" disabled>⚠️ Inject Fault</button>
              </div>
            </div>
          </div>

          <!-- RocketPy Server Integration -->
          <div class="panel-section rocketpy-server">
            <h3>🐍 RocketPy Server</h3>
            <p class="helper-text">Connect to a RocketPy backend for advanced simulation capabilities</p>
            
            <div class="rocketpy-enable-row">
              <input type="checkbox" id="rocketpy-enabled" class="toggle-switch">
              <label for="rocketpy-enabled">Enable RocketPy Integration</label>
            </div>

            <div class="rocketpy-settings" id="rocketpy-settings">
              <div class="form-section">
                <h4>Server Connection</h4>
                <div class="form-row">
                  <label>Server URL</label>
                  <input type="text" id="rocketpy-url" value="http://localhost:8000" placeholder="http://localhost:8000">
                </div>
                <div class="rocketpy-status" id="rocketpy-status">
                  <div class="status-indicator disconnected">
                    <span class="status-dot"></span>
                    <span class="status-text">Not Connected</span>
                  </div>
                </div>
                <div class="rocketpy-actions">
                  <button class="btn btn-secondary" id="btn-rocketpy-connect">🔗 Test Connection</button>
                  <button class="btn btn-secondary" id="btn-rocketpy-disconnect" disabled>❌ Disconnect</button>
                </div>
              </div>

              <div class="form-section rocketpy-capabilities" id="rocketpy-capabilities" style="display: none;">
                <h4>Server Capabilities</h4>
                <div class="capabilities-grid">
                  <div class="capability-item" id="cap-simulation">
                    <span class="cap-icon">🚀</span>
                    <span class="cap-name">6-DOF Simulation</span>
                    <span class="cap-status">—</span>
                  </div>
                  <div class="capability-item" id="cap-montecarlo">
                    <span class="cap-icon">🎲</span>
                    <span class="cap-name">Monte Carlo</span>
                    <span class="cap-status">—</span>
                  </div>
                  <div class="capability-item" id="cap-atmosphere">
                    <span class="cap-icon">🌡️</span>
                    <span class="cap-name">Atmosphere Model</span>
                    <span class="cap-status">—</span>
                  </div>
                  <div class="capability-item" id="cap-motors">
                    <span class="cap-icon">🔥</span>
                    <span class="cap-name">Motor Database</span>
                    <span class="cap-status">—</span>
                  </div>
                </div>
                <div class="server-info" id="rocketpy-server-info"></div>
              </div>

              <div class="form-section">
                <h4>Simulation Options</h4>
                <div class="rocketpy-options">
                  <div class="option-row">
                    <input type="checkbox" id="rocketpy-use-for-sim" checked>
                    <label for="rocketpy-use-for-sim">Use RocketPy for flight simulations (when connected)</label>
                  </div>
                  <div class="option-row">
                    <input type="checkbox" id="rocketpy-use-for-mc" checked>
                    <label for="rocketpy-use-for-mc">Use RocketPy for Monte Carlo analysis</label>
                  </div>
                  <div class="option-row">
                    <input type="checkbox" id="rocketpy-auto-reconnect">
                    <label for="rocketpy-auto-reconnect">Auto-reconnect on startup</label>
                  </div>
                </div>
              </div>

              <div class="form-section">
                <h4>Quick Actions</h4>
                <div class="rocketpy-quick-actions">
                  <button class="btn btn-secondary" id="btn-rocketpy-run-sim" disabled>
                    🚀 Run Simulation via RocketPy
                  </button>
                  <button class="btn btn-secondary" id="btn-rocketpy-stability" disabled>
                    📐 Calculate Stability
                  </button>
                  <button class="btn btn-secondary" id="btn-rocketpy-atmosphere" disabled>
                    🌡️ Get Atmosphere Data
                  </button>
                </div>
              </div>

              <div class="rocketpy-setup-guide">
                <h4>📚 Setup Guide</h4>
                <div class="setup-steps">
                  <p>To use RocketPy server integration:</p>
                  <ol>
                    <li>Install RocketPy: <code>pip install rocketpy</code></li>
                    <li>Install FastAPI server: <code>pip install fastapi uvicorn</code></li>
                    <li>Run the backend: <code>python backend/server.py</code></li>
                    <li>Enter the server URL above and click "Test Connection"</li>
                  </ol>
                  <p class="helper-text">RocketPy provides high-fidelity 6-DOF simulation with advanced atmosphere models, 
                  wind effects, and Monte Carlo dispersion analysis.</p>
                </div>
              </div>
            </div>
          </div>

          <!-- Data Management Section -->
          <div class="panel-section data-management">
            <h3>💾 Data Management</h3>
            <p class="helper-text">Manage saved projects, simulation history, and application data</p>
            
            <div class="data-management-grid">
              <!-- Storage Usage -->
              <div class="form-section storage-usage">
                <h4>📊 Storage Usage</h4>
                <div class="storage-bar-container">
                  <div class="storage-bar">
                    <div class="storage-bar-fill" id="storage-bar-fill" style="width: 0%"></div>
                  </div>
                  <div class="storage-info">
                    <span id="storage-used">0 MB</span> / <span id="storage-total">5 MB</span>
                    (<span id="storage-percent">0</span>%)
                  </div>
                </div>
                <button class="btn btn-small" id="btn-refresh-storage">🔄 Refresh</button>
              </div>

              <!-- Auto-Save Settings -->
              <div class="form-section auto-save-settings">
                <h4>⚡ Auto-Save</h4>
                <div class="option-row">
                  <input type="checkbox" id="opt-auto-save" checked>
                  <label for="opt-auto-save">Enable auto-save</label>
                </div>
                <div class="form-row">
                  <label>Interval (seconds)</label>
                  <select id="auto-save-interval">
                    <option value="30">30 seconds</option>
                    <option value="60" selected>1 minute</option>
                    <option value="120">2 minutes</option>
                    <option value="300">5 minutes</option>
                  </select>
                </div>
                <div class="auto-save-status" id="auto-save-status">
                  <span class="status-text">Last saved: Never</span>
                </div>
              </div>
            </div>

            <!-- Simulation History -->
            <div class="form-section simulation-history">
              <h4>📈 Simulation History</h4>
              <p class="helper-text">View and manage your past simulation results</p>
              <div class="sim-history-controls">
                <button class="btn btn-small" id="btn-view-sim-history">📋 View History</button>
                <button class="btn btn-small btn-warning" id="btn-clear-sim-history">🗑️ Clear History</button>
              </div>
              <div class="sim-history-stats" id="sim-history-stats">
                <span>Saved simulations: <strong id="sim-history-count">0</strong></span>
              </div>
            </div>

            <!-- Export/Import -->
            <div class="form-section export-import">
              <h4>📤 Export / Import</h4>
              <p class="helper-text">Backup all your data or import from another device</p>
              <div class="export-import-buttons">
                <button class="btn btn-primary" id="btn-export-all-data">📥 Export All Data</button>
                <button class="btn btn-secondary" id="btn-import-all-data">📤 Import Data</button>
                <input type="file" id="import-data-input" accept=".json" hidden>
              </div>
              <div class="export-options">
                <div class="option-row">
                  <input type="checkbox" id="export-include-settings" checked>
                  <label for="export-include-settings">Include settings</label>
                </div>
                <div class="option-row">
                  <input type="checkbox" id="export-include-history" checked>
                  <label for="export-include-history">Include simulation history</label>
                </div>
                <div class="option-row">
                  <input type="checkbox" id="export-include-projects" checked>
                  <label for="export-include-projects">Include all projects</label>
                </div>
              </div>
            </div>

            <!-- Danger Zone -->
            <div class="form-section danger-zone">
              <h4>⚠️ Danger Zone</h4>
              <div class="danger-buttons">
                <button class="btn btn-warning" id="btn-clear-all-projects">🗑️ Clear All Projects</button>
                <button class="btn btn-danger" id="btn-reset-all-data">🔥 Reset All Data</button>
              </div>
              <p class="helper-text warning-text">Warning: These actions cannot be undone!</p>
            </div>
          </div>
        </div>

        <!-- Browser Compatibility Notice -->
        <div class="panel-section browser-notice" id="hil-browser-notice" style="display: none;">
          <div class="notice-content warning">
            <span class="notice-icon">⚠️</span>
            <div class="notice-text">
              <strong>Web Serial API Not Supported</strong>
              <p>HIL requires Chrome, Edge, or Opera browser with Web Serial API support. 
              Firefox and Safari do not currently support this feature.</p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ============================================
  // Event Handling
  // ============================================

  setupEventListeners() {
    // Tab navigation
    this.container.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });

    // ORK Import
    const dropzone = this.container.querySelector('#ork-dropzone');
    const fileInput = this.container.querySelector('#ork-file-input');
    
    dropzone?.addEventListener('click', () => fileInput?.click());
    dropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        this.importORKFile(e.dataTransfer.files[0]);
      }
    });
    fileInput?.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.importORKFile(e.target.files[0]);
      }
    });

    // Quick Design Form
    const designForm = this.container.querySelector('#quick-design-form');
    designForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.applyQuickDesign(new FormData(designForm));
    });

    // Motor Search
    const motorSearchBtn = this.container.querySelector('#motor-search-btn');
    motorSearchBtn?.addEventListener('click', () => this.searchMotors());

    // Launch Site Selection
    const siteSelect = this.container.querySelector('#launch-site-select');
    siteSelect?.addEventListener('change', (e) => {
      const customLoc = this.container.querySelector('#custom-location');
      if (customLoc) {
        customLoc.style.display = e.target.value === 'custom' ? 'block' : 'none';
      }
    });

    const loadWeatherBtn = this.container.querySelector('#load-weather-btn');
    loadWeatherBtn?.addEventListener('click', () => this.loadSelectedSiteWeather());

    // Simulation
    const runSimBtn = this.container.querySelector('#btn-run-sim');
    runSimBtn?.addEventListener('click', () => this.runSimulation());

    const runMCBtn = this.container.querySelector('#btn-run-monte-carlo');
    runMCBtn?.addEventListener('click', () => this.runMonteCarlo());

    const intoWindBtn = this.container.querySelector('#btn-into-wind');
    intoWindBtn?.addEventListener('click', () => this.setLaunchIntoWind());

    // Export buttons
    this.container.querySelector('#btn-export-csv')?.addEventListener('click', () => this.exportCSV());
    this.container.querySelector('#btn-export-kml')?.addEventListener('click', () => this.exportKML());
    this.container.querySelector('#btn-export-pdf')?.addEventListener('click', () => this.exportReport());

    // Save/Load
    this.container.querySelector('#btn-save')?.addEventListener('click', () => this.saveProject());
    this.container.querySelector('#btn-load')?.addEventListener('click', () => this.loadProject());
    
    // Settings buttons
    this.container.querySelector('#btn-settings')?.addEventListener('click', () => this.showSettingsModal());
    this.container.querySelector('#btn-advanced-settings')?.addEventListener('click', () => this.switchTab('advanced'));

    // Data Management event handlers
    this.container.querySelector('#btn-refresh-storage')?.addEventListener('click', () => this.updateStorageDisplay());
    this.container.querySelector('#btn-view-sim-history')?.addEventListener('click', () => this.showSimulationHistoryModal());
    this.container.querySelector('#btn-clear-sim-history')?.addEventListener('click', () => this.clearSimulationHistory());
    this.container.querySelector('#btn-export-all-data')?.addEventListener('click', () => this.exportAllData());
    this.container.querySelector('#btn-import-all-data')?.addEventListener('click', () => {
      this.container.querySelector('#import-data-input')?.click();
    });
    this.container.querySelector('#import-data-input')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.importAllData(file);
    });
    this.container.querySelector('#btn-clear-all-projects')?.addEventListener('click', () => this.clearAllProjects());
    this.container.querySelector('#btn-reset-all-data')?.addEventListener('click', () => this.resetAllData());
    this.container.querySelector('#opt-auto-save')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        this.startAutoSave();
      } else {
        this.stopAutoSave();
      }
    });
    this.container.querySelector('#auto-save-interval')?.addEventListener('change', (e) => {
      this.autoSaveInterval = parseInt(e.target.value) * 1000;
      if (this.autoSaveTimer) {
        this.stopAutoSave();
        this.startAutoSave();
      }
    });

    // Initialize storage display
    this.updateStorageDisplay();
    this.updateSimHistoryCount();

    // Optimizer
    const optimizerBtn = this.container.querySelector('#btn-run-optimizer');
    optimizerBtn?.addEventListener('click', () => this.runOptimizer());

    const optModeSelect = this.container.querySelector('#opt-mode');
    optModeSelect?.addEventListener('change', (e) => {
      const altGroup = this.container.querySelector('#opt-altitude-group');
      if (altGroup) {
        altGroup.style.display = e.target.value === 'tarc' ? 'none' : 'block';
      }
    });

    // Flight Data Import
    const fdDropzone = this.container.querySelector('#flight-data-dropzone');
    const fdInput = this.container.querySelector('#flight-data-input');
    
    fdDropzone?.addEventListener('click', () => fdInput?.click());
    fdDropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      fdDropzone.classList.add('dragover');
    });
    fdDropzone?.addEventListener('dragleave', () => {
      fdDropzone.classList.remove('dragover');
    });
    fdDropzone?.addEventListener('drop', async (e) => {
      e.preventDefault();
      fdDropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        await this.importFlightData(e.dataTransfer.files[0]);
      }
    });
    fdInput?.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        await this.importFlightData(e.target.files[0]);
      }
    });

    // Flutter Analysis
    const flutterBtn = this.container.querySelector('#btn-analyze-flutter');
    flutterBtn?.addEventListener('click', () => this.analyzeFlutter());

    // Sync flutter inputs with quick design form
    const quickDesignForm = this.container.querySelector('#quick-design-form');
    if (quickDesignForm) {
      const syncFlutterInputs = () => {
        const rootChord = quickDesignForm.querySelector('input[name="finRootChord"]')?.value;
        const tipChord = quickDesignForm.querySelector('input[name="finTipChord"]')?.value;
        const span = quickDesignForm.querySelector('input[name="finSpan"]')?.value;
        
        const flutterRoot = this.container.querySelector('#flutter-root');
        const flutterTip = this.container.querySelector('#flutter-tip');
        const flutterSpan = this.container.querySelector('#flutter-span');
        
        if (flutterRoot && rootChord) flutterRoot.value = rootChord;
        if (flutterTip && tipChord) flutterTip.value = tipChord;
        if (flutterSpan && span) flutterSpan.value = span;
      };
      
      quickDesignForm.querySelectorAll('input[name^="fin"]').forEach(input => {
        input.addEventListener('change', syncFlutterInputs);
      });
    }

    // Launch Day Assistant
    const readinessBtn = this.container.querySelector('#btn-check-readiness');
    readinessBtn?.addEventListener('click', () => this.checkLaunchReadiness());

    const resetChecklistBtn = this.container.querySelector('#btn-reset-checklist');
    resetChecklistBtn?.addEventListener('click', () => this.resetChecklist());

    const recoveryTypeSelect = this.container.querySelector('#recovery-type');
    recoveryTypeSelect?.addEventListener('change', (e) => {
      const dualConfig = this.container.querySelector('#dual-deploy-config');
      if (dualConfig) {
        dualConfig.style.display = e.target.value === 'dual' ? 'block' : 'none';
      }
    });

    const simRecoveryBtn = this.container.querySelector('#btn-simulate-recovery');
    simRecoveryBtn?.addEventListener('click', () => this.simulateRecovery());

    // Flight Log
    const logFlightBtn = this.container.querySelector('#btn-log-flight');
    logFlightBtn?.addEventListener('click', () => this.showLogFlightModal());

    const closeLogModal = this.container.querySelector('#close-log-modal');
    closeLogModal?.addEventListener('click', () => this.hideLogFlightModal());

    const cancelLogBtn = this.container.querySelector('#btn-cancel-log');
    cancelLogBtn?.addEventListener('click', () => this.hideLogFlightModal());

    const logFlightForm = this.container.querySelector('#log-flight-form');
    logFlightForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.saveFlightLog(e.target);
    });

    const useSimDataBtn = this.container.querySelector('#btn-use-sim-data');
    useSimDataBtn?.addEventListener('click', () => this.fillSimulationData());

    const useWeatherBtn = this.container.querySelector('#btn-use-weather-data');
    useWeatherBtn?.addEventListener('click', () => this.fillWeatherData());

    const exportLogBtn = this.container.querySelector('#btn-export-log');
    exportLogBtn?.addEventListener('click', () => this.exportFlightLog());

    // Component Database
    const searchComponentsBtn = this.container.querySelector('#btn-search-components');
    searchComponentsBtn?.addEventListener('click', () => this.searchComponents());

    const componentTypeFilter = this.container.querySelector('#component-type-filter');
    componentTypeFilter?.addEventListener('change', () => this.updateComponentManufacturers());

    // Multi-Stage Rockets
    const addStageBtn = this.container.querySelector('#btn-add-stage');
    addStageBtn?.addEventListener('click', () => this.showAddStageModal());

    const addStraponBtn = this.container.querySelector('#btn-add-strapon');
    addStraponBtn?.addEventListener('click', () => this.showAddStageModal(true));

    const closeStageModal = this.container.querySelector('#close-stage-modal');
    closeStageModal?.addEventListener('click', () => this.hideAddStageModal());

    const cancelStageBtn = this.container.querySelector('#btn-cancel-stage');
    cancelStageBtn?.addEventListener('click', () => this.hideAddStageModal());

    const addStageForm = this.container.querySelector('#add-stage-form');
    addStageForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      this.addStageFromForm(e.target);
    });

    const presetSelect = this.container.querySelector('#multistage-preset');
    presetSelect?.addEventListener('change', (e) => {
      if (e.target.value) {
        this.loadMultiStagePreset(e.target.value);
        e.target.value = '';
      }
    });

    const runMsSimBtn = this.container.querySelector('#btn-run-multistage-sim');
    runMsSimBtn?.addEventListener('click', () => this.runMultiStageSimulation());

    // Initialize Component Database
    this.initializeComponentDatabase();
    this.initializeFlightLog();
    this.initializeMultiStage();
    this.initializeRecoveryTab();
    this.initializeUnitSystem();
    this.initializeAdvancedTab();
    this.initialize3DViewTab();
    this.initializeIntegrationTab();
  }

  initializeIntegrationTab() {
    // Altimeter Data Import
    const altDropzone = this.container.querySelector('#altimeter-dropzone');
    const altInput = this.container.querySelector('#altimeter-file-input');
    
    altDropzone?.addEventListener('click', () => altInput?.click());
    altDropzone?.addEventListener('dragover', (e) => {
      e.preventDefault();
      altDropzone.classList.add('dragover');
    });
    altDropzone?.addEventListener('dragleave', () => {
      altDropzone.classList.remove('dragover');
    });
    altDropzone?.addEventListener('drop', async (e) => {
      e.preventDefault();
      altDropzone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        await this.importAltimeterData(e.dataTransfer.files[0]);
      }
    });
    altInput?.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        await this.importAltimeterData(e.target.files[0]);
      }
    });

    // Altimeter actions
    this.container.querySelector('#btn-view-altimeter-3d')?.addEventListener('click', () => this.viewAltimeterIn3D());
    this.container.querySelector('#btn-compare-with-sim')?.addEventListener('click', () => this.compareAltimeterWithSim());
    this.container.querySelector('#btn-export-altimeter-csv')?.addEventListener('click', () => this.exportAltimeterCSV());
    this.container.querySelector('#btn-save-to-flight-log')?.addEventListener('click', () => this.saveAltimeterToFlightLog());

    // GPS Tracking
    this.container.querySelector('#btn-use-current-location')?.addEventListener('click', () => this.useCurrentLocation());
    this.container.querySelector('#btn-set-launch-site')?.addEventListener('click', () => this.setGPSLaunchSite());
    this.container.querySelector('#btn-start-gps')?.addEventListener('click', () => this.startGPSTracking());
    this.container.querySelector('#btn-stop-gps')?.addEventListener('click', () => this.stopGPSTracking());
    this.container.querySelector('#btn-export-gpx')?.addEventListener('click', () => this.exportGPX());
    this.container.querySelector('#btn-view-track-3d')?.addEventListener('click', () => this.viewGPSTrackIn3D());
    this.container.querySelector('#btn-open-in-maps')?.addEventListener('click', () => this.openTrackInMaps());
    this.container.querySelector('#btn-import-gpx')?.addEventListener('click', () => {
      this.container.querySelector('#gpx-file-input')?.click();
    });
    this.container.querySelector('#gpx-file-input')?.addEventListener('change', async (e) => {
      if (e.target.files.length > 0) {
        await this.importGPXFile(e.target.files[0]);
      }
    });

    // Club tabs
    this.container.querySelectorAll('.club-tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabId = e.target.dataset.clubTab;
        this.switchClubTab(tabId);
      });
    });

    // Club actions
    this.container.querySelector('#btn-create-club')?.addEventListener('click', () => this.showCreateClubModal());
    this.container.querySelector('#btn-import-club')?.addEventListener('click', () => this.importClubData());
    this.container.querySelector('#btn-share-current-flight')?.addEventListener('click', () => this.shareCurrentFlight());
    this.container.querySelector('#btn-create-competition')?.addEventListener('click', () => this.showCreateCompetitionModal());

    // Club filter
    this.container.querySelector('#club-filter-select')?.addEventListener('change', (e) => {
      this.filterSharedFlights(e.target.value);
    });

    // Check GPS availability
    this.checkGPSAvailability();
  }

  switchTab(tabId) {
    // Update nav buttons
    this.container.querySelectorAll('.nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Update tab content
    this.container.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.toggle('active', tab.id === `tab-${tabId}`);
    });
  }

  // ============================================
  // Rocket Design
  // ============================================

  async importORKFile(file) {
    if (!this.modules.orkImporter) {
      alert('ORK Importer module not loaded');
      return;
    }

    try {
      const result = await this.modules.orkImporter.importFile(file);
      this.handleRocketUpdate(result.launchsim);
      this.showRocketPreview(result);
      this.updateStatus('rocket', `${result.rocket.name} loaded`);
    } catch (error) {
      alert(`Import failed: ${error.message}`);
      log.error('ORK import failed:', error);
    }
  }

  applyQuickDesign(formData) {
    const rocket = {
      name: formData.get('name'),
      noseShape: formData.get('noseShape'),
      noseLength: parseFloat(formData.get('noseLength')),
      noseDiameter: parseFloat(formData.get('noseDiameter')),
      bodyLength: parseFloat(formData.get('bodyLength')),
      bodyDiameter: parseFloat(formData.get('bodyDiameter')),
      finCount: parseInt(formData.get('finCount')),
      finRootChord: parseFloat(formData.get('finRootChord')),
      finTipChord: parseFloat(formData.get('finTipChord')),
      finSpan: parseFloat(formData.get('finSpan')),
      finSweep: parseFloat(formData.get('finSweep')),
      chuteDiameter: parseFloat(formData.get('chuteDiameter')),
      chuteCd: parseFloat(formData.get('chuteCd')),
      dryMass: parseFloat(formData.get('dryMass'))
    };

    this.handleRocketUpdate(rocket);
    this.updateStatus('rocket', rocket.name);
  }

  handleRocketUpdate(rocket) {
    this.state.set('rocket', rocket);
    log.debug('Rocket updated:', rocket);
    
    // Update stability analysis and rocket profile
    this.updateStabilityAnalysis();
    this.updateRocketProfile();
  }

  updateStabilityAnalysis() {
    const rocket = this.state.get('rocket');
    const motor = this.state.get('motor');
    const displayEl = this.container.querySelector('#stability-display');
    
    if (!displayEl) return;
    
    if (!rocket) {
      displayEl.innerHTML = '<p class="placeholder">Apply a design to see stability analysis</p>';
      return;
    }
    
    try {
      if (typeof StabilityAnalysis === 'undefined') {
        displayEl.innerHTML = '<p class="error">Stability analysis module not loaded</p>';
        return;
      }
      
      const analysis = new StabilityAnalysis(rocket, motor);
      const result = analysis.calculate();
      
      this.state.set('stability', result);
      this.renderStabilityDisplay(result);
      
    } catch (error) {
      log.error('Stability analysis failed:', error);
      displayEl.innerHTML = `<p class="error">Analysis failed: ${error.message}</p>`;
    }
  }

  renderStabilityDisplay(result) {
    const displayEl = this.container.querySelector('#stability-display');
    if (!displayEl || !result) return;
    
    const statusIcon = {
      'UNSTABLE': '🛑',
      'MARGINALLY UNSTABLE': '🛑',
      'MARGINALLY STABLE': '⚠️',
      'STABLE': '✅',
      'VERY STABLE': '✅',
      'OVER-STABLE': '⚠️',
      'SEVERELY OVER-STABLE': '⚠️'
    }[result.status] || '❓';
    
    displayEl.innerHTML = `
      <div class="stability-result-status ${result.severity}">
        <span class="status-icon">${statusIcon}</span>
        <span class="status-text">${result.status}</span>
        <span class="status-calibers">${result.stabilityCalibers.toFixed(2)} calibers</span>
      </div>
      
      <div class="stability-bar-container">
        <div class="stability-bar">
          <div class="stability-marker cg-marker" style="left: ${Math.min(95, Math.max(5, result.cgPercent))}%;">
            <span class="marker-dot"></span>
            <span class="marker-label">CG</span>
          </div>
          <div class="stability-marker cp-marker" style="left: ${Math.min(95, Math.max(5, result.cpPercent))}%;">
            <span class="marker-dot"></span>
            <span class="marker-label">CP</span>
          </div>
          <div class="stability-margin-line" style="left: ${Math.min(95, Math.max(5, result.cgPercent))}%; width: ${Math.abs(result.cpPercent - result.cgPercent)}%;"></div>
        </div>
        <div class="stability-bar-labels">
          <span>Nose</span>
          <span>Tail</span>
        </div>
      </div>
      
      <div class="stability-values-grid">
        <div class="stability-value">
          <span class="value-number">${result.cg.toFixed(1)}</span>
          <span class="value-unit">mm</span>
          <span class="value-label">CG from Nose</span>
        </div>
        <div class="stability-value">
          <span class="value-number">${result.cp.toFixed(1)}</span>
          <span class="value-unit">mm</span>
          <span class="value-label">CP from Nose</span>
        </div>
        <div class="stability-value">
          <span class="value-number">${result.stabilityMargin.toFixed(1)}</span>
          <span class="value-unit">mm</span>
          <span class="value-label">Margin</span>
        </div>
        <div class="stability-value highlight">
          <span class="value-number">${result.stabilityCalibers.toFixed(2)}</span>
          <span class="value-unit">cal</span>
          <span class="value-label">Stability</span>
        </div>
      </div>
      
      <div class="stability-recommendation ${result.severity}">
        ${result.recommendation}
      </div>
      
      <details class="stability-details">
        <summary>Component Details</summary>
        <table class="stability-component-table">
          <tr><th>Component</th><th>CN α</th><th>CP (mm)</th></tr>
          ${result.aeroComponents.map(c => `
            <tr>
              <td>${c.name}</td>
              <td>${c.cn_alpha.toFixed(3)}</td>
              <td>${c.cp?.toFixed(1) || '-'}</td>
            </tr>
          `).join('')}
          <tr class="total-row">
            <td><strong>Total</strong></td>
            <td><strong>${result.totalCN_alpha.toFixed(3)}</strong></td>
            <td><strong>${result.cp.toFixed(1)}</strong></td>
          </tr>
        </table>
      </details>
    `;
  }

  updateRocketProfile() {
    const rocket = this.state.get('rocket');
    const stability = this.state.get('stability');
    const canvas = this.container.querySelector('#rocket-profile-canvas');
    
    if (!canvas) return;
    
    try {
      if (typeof RocketProfileRenderer === 'undefined') {
        log.warn('RocketProfileRenderer not loaded');
        return;
      }
      
      const renderer = new RocketProfileRenderer(canvas);
      
      if (rocket) {
        renderer.render(rocket, stability);
      } else {
        renderer.clear();
      }
      
    } catch (error) {
      log.error('Profile render failed:', error);
    }
  }

  showRocketPreview(orkResult) {
    const section = this.container.querySelector('#rocket-preview-section');
    const preview = this.container.querySelector('#rocket-preview');
    
    if (!section || !preview) return;

    const ls = orkResult.launchsim;
    preview.innerHTML = `
      <table class="preview-table">
        <tr><th>Name</th><td>${orkResult.rocket.name}</td></tr>
        <tr><th>Body</th><td>${ls.bodyDiameter.toFixed(1)}mm × ${ls.bodyLength.toFixed(1)}mm</td></tr>
        <tr><th>Nose</th><td>${ls.noseShape}, ${ls.noseLength.toFixed(1)}mm</td></tr>
        <tr><th>Fins</th><td>${ls.finCount}× ${ls.finRootChord.toFixed(1)}mm root</td></tr>
        <tr><th>Recovery</th><td>${ls.chuteDiameter.toFixed(1)}mm chute</td></tr>
        <tr><th>Motor Mount</th><td>${ls.motorDiameter.toFixed(1)}mm</td></tr>
        <tr><th>Mass</th><td>${ls.totalMass.toFixed(1)}g</td></tr>
        <tr><th>Components</th><td>${ls.components.length}</td></tr>
      </table>
    `;
    section.style.display = 'block';
  }

  // ============================================
  // Fin Flutter Analysis
  // ============================================

  analyzeFlutter() {
    const rootChord = parseFloat(this.container.querySelector('#flutter-root')?.value || 70);
    const tipChord = parseFloat(this.container.querySelector('#flutter-tip')?.value || 30);
    const span = parseFloat(this.container.querySelector('#flutter-span')?.value || 55);
    const thickness = parseFloat(this.container.querySelector('#flutter-thickness')?.value || 3.2);
    const material = this.container.querySelector('#flutter-material')?.value || 'birch-plywood-1/8';
    const maxVelocity = parseFloat(this.container.querySelector('#flutter-velocity')?.value || 150);

    const resultsEl = this.container.querySelector('#flutter-results');
    if (!resultsEl) return;

    try {
      // Check if FinFlutterAnalysis is available
      if (typeof FinFlutterAnalysis === 'undefined' || typeof FinGeometry === 'undefined') {
        resultsEl.innerHTML = '<p class="error">Flutter analysis module not loaded</p>';
        return;
      }

      // Create geometry from mm inputs
      const geometry = FinGeometry.fromMillimeters({
        rootChord,
        tipChord,
        span,
        thickness
      });

      // Run analysis
      const analysis = new FinFlutterAnalysis(geometry, material);
      const result = analysis.analyze(maxVelocity);

      // Render results
      this.renderFlutterResults(result);

    } catch (error) {
      log.error('Flutter analysis failed:', error);
      resultsEl.innerHTML = `<p class="error">Analysis failed: ${error.message}</p>`;
    }
  }

  renderFlutterResults(result) {
    const resultsEl = this.container.querySelector('#flutter-results');
    if (!resultsEl) return;

    const severityClass = result.severity;
    const statusIcon = {
      'EXCELLENT': '✅',
      'GOOD': '✅',
      'ADEQUATE': '⚠️',
      'MARGINAL': '⚠️',
      'UNSAFE': '🛑'
    }[result.status] || '❓';

    resultsEl.innerHTML = `
      <div class="flutter-result-status ${severityClass}">
        <span class="status-icon">${statusIcon}</span>
        <span class="status-text">${result.status}</span>
      </div>
      
      <div class="flutter-stats-row">
        <div class="flutter-stat">
          <span class="flutter-stat-value">${result.flutterVelocityFps.toFixed(0)}</span>
          <span class="flutter-stat-unit">ft/s</span>
          <span class="flutter-stat-label">Flutter Velocity</span>
        </div>
        <div class="flutter-stat">
          <span class="flutter-stat-value">${result.maxExpectedVelocityFps.toFixed(0)}</span>
          <span class="flutter-stat-unit">ft/s</span>
          <span class="flutter-stat-label">Max Expected</span>
        </div>
        <div class="flutter-stat highlight">
          <span class="flutter-stat-value">${result.safetyFactor.toFixed(2)}x</span>
          <span class="flutter-stat-label">Safety Factor</span>
        </div>
        <div class="flutter-stat">
          <span class="flutter-stat-value">${result.flutterMach.toFixed(2)}</span>
          <span class="flutter-stat-label">Mach @ Flutter</span>
        </div>
      </div>
      
      <div class="flutter-recommendation ${severityClass}">
        ${result.recommendation}
      </div>
      
      ${result.safetyFactor < 1.5 ? `
        <div class="flutter-suggestion">
          <strong>💡 Suggestion:</strong> Increase thickness to at least 
          <strong>${result.recommendedMinThicknessMm.toFixed(1)} mm</strong> 
          (${result.recommendedMinThicknessIn.toFixed(3)}") for adequate safety margin.
        </div>
      ` : ''}
      
      <details class="flutter-details">
        <summary>Technical Details</summary>
        <table class="flutter-detail-table">
          <tr><td>Aspect Ratio</td><td>${result.flutter.geometry.aspectRatio.toFixed(3)}</td></tr>
          <tr><td>Taper Ratio</td><td>${result.flutter.geometry.taperRatio.toFixed(3)}</td></tr>
          <tr><td>Thickness/Chord</td><td>${(result.flutter.geometry.thicknessRatio * 100).toFixed(2)}%</td></tr>
          <tr><td>Material</td><td>${result.flutter.material.name}</td></tr>
          <tr><td>Shear Modulus</td><td>${(result.flutter.material.shearModulus / 1e9).toFixed(2)} GPa</td></tr>
          <tr><td>Flutter Velocity</td><td>${result.flutterVelocity.toFixed(1)} m/s</td></tr>
        </table>
      </details>
    `;
  }

  // ============================================
  // Motor Selection
  // ============================================

  async searchMotors() {
    if (!this.modules.thrustCurveAPI) {
      this.showMotorResults([]);
      return;
    }

    const impulseClass = this.container.querySelector('#motor-class-filter')?.value;
    const manufacturer = this.container.querySelector('#motor-mfr-filter')?.value;
    const diameter = this.container.querySelector('#motor-diameter-filter')?.value;

    try {
      const results = await this.modules.thrustCurveAPI.searchOffline({
        impulseClass: impulseClass || undefined,
        manufacturer: manufacturer || undefined,
        diameter: diameter ? parseFloat(diameter) : undefined
      });

      this.showMotorResults(results.slice(0, 50)); // Limit to 50
    } catch (error) {
      log.error('Motor search failed:', error);
      this.showMotorResults([]);
    }
  }

  showMotorResults(motors) {
    const container = this.container.querySelector('#motor-results');
    if (!container) return;

    if (motors.length === 0) {
      container.innerHTML = '<p class="placeholder">No motors found. Try different filters.</p>';
      return;
    }

    container.innerHTML = `
      <div class="motor-list">
        ${motors.map(m => `
          <div class="motor-card" data-motor-id="${m.motorId || m.designation}">
            <div class="motor-name">${m.manufacturer || ''} ${m.designation || m.commonName}</div>
            <div class="motor-specs">
              <span>${m.diameter || 18}mm</span>
              <span>${(m.totalImpulse || 0).toFixed(1)} Ns</span>
              <span>${(m.avgThrust || 0).toFixed(1)} N avg</span>
            </div>
            <button class="btn btn-small btn-select-motor">Select</button>
          </div>
        `).join('')}
      </div>
    `;

    // Add click handlers
    container.querySelectorAll('.btn-select-motor').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const card = e.target.closest('.motor-card');
        const motorId = card?.dataset.motorId;
        const motor = motors.find(m => (m.motorId || m.designation) === motorId);
        if (motor) this.handleMotorSelect(motor);
      });
    });
  }

  handleMotorSelect(motor) {
    this.state.set('motor', motor);
    this.showMotorDetail(motor);
    this.updateStatus('motor', motor.designation || motor.commonName);
    
    // Re-run stability analysis with new motor
    this.updateStabilityAnalysis();
    this.updateRocketProfile();
  }

  showMotorDetail(motor) {
    const section = this.container.querySelector('#motor-detail-section');
    const detail = this.container.querySelector('#motor-detail');
    
    if (!section || !detail) return;

    detail.innerHTML = `
      <table class="detail-table">
        <tr><th>Designation</th><td>${motor.designation || motor.commonName}</td></tr>
        <tr><th>Manufacturer</th><td>${motor.manufacturer || '-'}</td></tr>
        <tr><th>Diameter</th><td>${motor.diameter || 18} mm</td></tr>
        <tr><th>Length</th><td>${motor.length || '-'} mm</td></tr>
        <tr><th>Total Mass</th><td>${(motor.totalMass || 0).toFixed(1)} g</td></tr>
        <tr><th>Propellant Mass</th><td>${(motor.propMass || 0).toFixed(1)} g</td></tr>
        <tr><th>Total Impulse</th><td>${(motor.totalImpulse || 0).toFixed(1)} Ns</td></tr>
        <tr><th>Average Thrust</th><td>${(motor.avgThrust || 0).toFixed(1)} N</td></tr>
        <tr><th>Max Thrust</th><td>${(motor.maxThrust || 0).toFixed(1)} N</td></tr>
        <tr><th>Burn Time</th><td>${(motor.burnTime || 0).toFixed(2)} s</td></tr>
      </table>
    `;
    section.style.display = 'block';

    // Draw thrust curve
    this.drawThrustCurve(motor);
  }

  drawThrustCurve(motor) {
    const canvas = this.container.querySelector('#thrust-curve-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const padding = 40;

    // Clear
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, w, h);

    // Get thrust curve data
    let curveData = motor.thrustCurve || motor.samples || [];
    if (curveData.length === 0 && motor.burnTime && motor.avgThrust) {
      // Generate simple curve
      curveData = [
        { time: 0, thrust: motor.avgThrust * 1.5 },
        { time: motor.burnTime * 0.1, thrust: motor.maxThrust || motor.avgThrust * 1.2 },
        { time: motor.burnTime * 0.9, thrust: motor.avgThrust },
        { time: motor.burnTime, thrust: 0 }
      ];
    }

    if (curveData.length === 0) return;

    // Normalize data format
    const points = curveData.map(p => {
      if (Array.isArray(p)) return { time: p[0], thrust: p[1] };
      return p;
    });

    const maxTime = Math.max(...points.map(p => p.time));
    const maxThrust = Math.max(...points.map(p => p.thrust));

    // Draw axes
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding, padding);
    ctx.lineTo(padding, h - padding);
    ctx.lineTo(w - padding, h - padding);
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Time (s)', w / 2, h - 5);
    ctx.save();
    ctx.translate(12, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Thrust (N)', 0, 0);
    ctx.restore();

    // Draw curve
    ctx.strokeStyle = '#ff6b35';
    ctx.lineWidth = 2;
    ctx.beginPath();

    points.forEach((p, i) => {
      const x = padding + (p.time / maxTime) * (w - 2 * padding);
      const y = h - padding - (p.thrust / maxThrust) * (h - 2 * padding);
      
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();

    // Fill under curve
    ctx.fillStyle = 'rgba(255, 107, 53, 0.2)';
    ctx.lineTo(w - padding, h - padding);
    ctx.lineTo(padding, h - padding);
    ctx.closePath();
    ctx.fill();
  }

  // ============================================
  // Weather
  // ============================================

  async loadSelectedSiteWeather() {
    const siteSelect = this.container.querySelector('#launch-site-select');
    const siteKey = siteSelect?.value;

    if (siteKey === 'custom') {
      const lat = parseFloat(this.container.querySelector('#custom-lat')?.value || 32.99);
      const lon = parseFloat(this.container.querySelector('#custom-lon')?.value || -106.97);
      await this.loadWeather(lat, lon);
    } else if (this.modules.weatherAPI) {
      const site = WeatherAPI.LAUNCH_SITES[siteKey];
      if (site) {
        await this.loadWeather(site.latitude, site.longitude);
      }
    }
  }

  async loadWeather(latitude, longitude) {
    if (!this.modules.weatherAPI) {
      log.warn('Weather API not loaded');
      return;
    }

    const display = this.container.querySelector('#weather-display');
    if (display) {
      display.innerHTML = '<p class="loading">Loading weather data...</p>';
    }

    try {
      const weather = await this.modules.weatherAPI.getLaunchSiteWeather(latitude, longitude);
      this.handleWeatherUpdate(weather);
      this.renderWeatherDisplay(weather);
      this.renderForecastChart(weather.hourlyForecast);
    } catch (error) {
      log.error('Weather load failed:', error);
      if (display) {
        display.innerHTML = `<p class="error">Failed to load weather: ${error.message}</p>`;
      }
    }
  }

  handleWeatherUpdate(weather) {
    this.state.set('weather', weather);
    
    // Store for unit conversion system
    this.currentWeather = {
      temperature: weather.current.temperature,
      windSpeed: weather.current.windSpeed,
      windGusts: weather.current.windGusts,
      windDirection: weather.current.windDirection,
      pressure: weather.current.pressure,
      humidity: weather.current.humidity,
      visibility: weather.current.visibility,
      conditions: weather.current.conditions
    };
    
    const score = weather.safetyScore;
    const scoreText = score >= 70 ? 'Good' : score >= 40 ? 'Moderate' : 'Poor';
    
    // Update status bar with current units
    const temp = this.convertFromMetric(weather.current.temperature, '°C');
    const tempUnit = this.getUnitLabel('°C');
    this.updateStatus('weather', `${temp.toFixed(0)}${tempUnit}, ${scoreText} (${score})`);
  }

  renderWeatherDisplay(weather) {
    const display = this.container.querySelector('#weather-display');
    if (!display) return;

    const current = weather.current;
    const score = weather.safetyScore;
    const scoreClass = score >= 70 ? 'good' : score >= 40 ? 'moderate' : 'poor';

    // Convert values based on current unit system
    const temp = this.convertFromMetric(current.temperature, '°C');
    const tempUnit = this.getUnitLabel('°C');
    const wind = this.convertFromMetric(current.windSpeed, 'm/s');
    const windUnit = this.getUnitLabel('m/s');
    const gusts = this.convertFromMetric(current.windGusts, 'm/s');
    const pressure = this.convertFromMetric(current.pressure, 'hPa');
    const pressureUnit = this.getUnitLabel('hPa');
    const pressureDecimals = this.units === 'metric' ? 0 : 2;

    display.innerHTML = `
      <div class="weather-current">
        <div class="weather-main">
          <span class="temperature" id="weather-temp" data-metric-value="${current.temperature}" data-metric-unit="°C">${temp.toFixed(1)}${tempUnit}</span>
          <span class="conditions">${current.conditions}</span>
          <div class="safety-badge ${scoreClass}">Safety: ${score}</div>
        </div>
        
        <div class="weather-grid">
          <div class="weather-item">
            <span class="label">Wind</span>
            <span class="value" id="weather-wind" data-metric-value="${current.windSpeed}" data-metric-unit="m/s">${wind.toFixed(1)} ${windUnit}</span>
            <span class="detail">from ${current.windDirection.toFixed(0)}°</span>
          </div>
          <div class="weather-item">
            <span class="label">Gusts</span>
            <span class="value" data-metric-value="${current.windGusts}" data-metric-unit="m/s">${gusts.toFixed(1)} ${windUnit}</span>
          </div>
          <div class="weather-item">
            <span class="label">Pressure</span>
            <span class="value" id="weather-pressure" data-metric-value="${current.pressure}" data-metric-unit="hPa">${pressure.toFixed(pressureDecimals)} ${pressureUnit}</span>
          </div>
          <div class="weather-item">
            <span class="label">Humidity</span>
            <span class="value">${current.humidity}%</span>
          </div>
        </div>

        <div class="recommendations">
          ${weather.recommendations.map(r => `
            <div class="rec rec-${r.type}">
              <span>${r.icon}</span> ${r.message}
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  renderForecastChart(hourlyForecast) {
    const canvas = this.container.querySelector('#forecast-chart');
    if (!canvas || !hourlyForecast) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const padding = 40;

    // Clear
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, w, h);

    // Use next 24 hours
    const data = hourlyForecast.slice(0, 24);
    const maxWind = Math.max(...data.map(d => d.windSpeed), 10);

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

    // Draw wind line
    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth = 2;
    ctx.beginPath();

    data.forEach((d, i) => {
      const x = padding + (i / (data.length - 1)) * (w - 2 * padding);
      const y = h - padding - (d.windSpeed / maxWind) * (h - 2 * padding);
      
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Labels - use current unit system
    const windUnit = this.getUnitLabel('m/s');
    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Wind Speed (${windUnit}) - Next 24 Hours`, w / 2, h - 5);

    // Y-axis labels
    const windConv = this.units === 'metric' ? 1 : 2.237; // m/s to mph
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const y = padding + (i / 5) * (h - 2 * padding);
      const val = (maxWind - (i / 5) * maxWind) * windConv;
      ctx.fillText(val.toFixed(0), padding - 5, y + 4);
    }
  }

  setLaunchIntoWind() {
    const weather = this.state.get('weather');
    if (weather) {
      const heading = (weather.current.windDirection + 180) % 360;
      const input = this.container.querySelector('input[name="launchHeading"]');
      if (input) {
        input.value = heading.toFixed(0);
      }
    }
  }

  // ============================================
  // Simulation
  // ============================================

  async runSimulation() {
    const rocket = this.state.get('rocket');
    const motor = this.state.get('motor');

    if (!rocket) {
      alert('Please design or import a rocket first');
      return;
    }
    if (!motor) {
      alert('Please select a motor first');
      return;
    }

    // Get settings
    const form = this.container.querySelector('#sim-settings-form');
    const settings = form ? Object.fromEntries(new FormData(form)) : {};

    // Build simulation config
    const config = this.buildSimulationConfig(rocket, motor, settings);

    // Show progress
    this.showProgress(true);

    try {
      // Run simulation (mock if engine not loaded)
      let result;
      if (this.modules.physicsEngine) {
        result = await this.runPhysicsSimulation(config);
      } else {
        result = this.mockSimulation(config);
      }

      // Store for unit conversion system
      this.lastSimResult = result;
      
      this.state.set('simulation', result);
      this.showQuickResults(result);
      this.renderTrajectory(result);
      this.showProgress(false);

      // Save to simulation history
      this.saveSimulationToHistory(result);

      // Switch to results tab
      this.switchTab('results');
      this.renderFlightSummary(result);

    } catch (error) {
      log.error('Simulation failed:', error);
      alert(`Simulation failed: ${error.message}`);
      this.showProgress(false);
    }
  }

  async runMonteCarlo() {
    const rocket = this.state.get('rocket');
    const motor = this.state.get('motor');

    if (!rocket || !motor) {
      alert('Please set up rocket and motor first');
      return;
    }

    const numSims = 100;
    this.showProgress(true, 0);

    try {
      const results = [];
      const config = this.buildSimulationConfig(rocket, motor, {});

      for (let i = 0; i < numSims; i++) {
        // Add random variations
        const variedConfig = this.applyVariations(config);
        
        // Run simulation
        const result = this.modules.physicsEngine 
          ? await this.runPhysicsSimulation(variedConfig)
          : this.mockSimulation(variedConfig);
        
        results.push(result);
        this.showProgress(true, ((i + 1) / numSims) * 100);
      }

      // Analyze results
      const analysis = this.analyzeMonteCarloResults(results);
      this.state.set('monteCarloResults', analysis);

      this.showProgress(false);
      this.switchTab('results');
      this.renderMonteCarloResults(analysis);

    } catch (error) {
      log.error('Monte Carlo failed:', error);
      alert(`Monte Carlo analysis failed: ${error.message}`);
      this.showProgress(false);
    }
  }

  buildSimulationConfig(rocket, motor, settings) {
    const weather = this.state.get('weather');
    const useWeather = settings.useWeather !== 'false' && weather;

    return {
      rocket: {
        name: rocket.name,
        mass: (rocket.dryMass || rocket.totalMass || 100) / 1000, // kg
        diameter: (rocket.bodyDiameter || rocket.noseDiameter || 41) / 1000, // m
        length: ((rocket.bodyLength || 300) + (rocket.noseLength || 100)) / 1000, // m
        noseLength: (rocket.noseLength || 100) / 1000,
        noseShape: rocket.noseShape || 'ogive',
        finCount: rocket.finCount || 3,
        finSpan: (rocket.finSpan || 55) / 1000,
        finRootChord: (rocket.finRootChord || 70) / 1000,
        finTipChord: (rocket.finTipChord || 30) / 1000,
        chuteDiameter: (rocket.chuteDiameter || 450) / 1000,
        chuteCd: rocket.chuteCd || 0.8
      },
      motor: {
        totalMass: (motor.totalMass || 50) / 1000,
        propMass: (motor.propMass || 20) / 1000,
        avgThrust: motor.avgThrust || 10,
        maxThrust: motor.maxThrust || motor.avgThrust * 1.5,
        burnTime: motor.burnTime || 1.5,
        thrustCurve: motor.thrustCurve || motor.samples || []
      },
      environment: useWeather ? {
        temperature: weather.current.temperature + 273.15,
        pressure: weather.current.surfacePressure * 100,
        windSpeed: weather.current.windSpeed,
        windDirection: weather.current.windDirection,
        elevation: weather.current.elevation || 0
      } : {
        temperature: 288.15,
        pressure: 101325,
        windSpeed: 0,
        windDirection: 0,
        elevation: 0
      },
      launch: {
        rodLength: parseFloat(settings.rodLength) || 1.0,
        angle: parseFloat(settings.launchAngle) || 5,
        heading: parseFloat(settings.launchHeading) || 0
      },
      simulation: {
        timeStep: parseFloat(settings.timeStep) || 0.01,
        maxDuration: parseFloat(settings.maxDuration) || 120
      }
    };
  }

  applyVariations(config) {
    const varied = JSON.parse(JSON.stringify(config));
    
    // Mass variation ±5%
    varied.rocket.mass *= 1 + (Math.random() - 0.5) * 0.1;
    
    // Thrust variation ±3%
    varied.motor.avgThrust *= 1 + (Math.random() - 0.5) * 0.06;
    
    // Wind variation ±1.5 m/s
    varied.environment.windSpeed += (Math.random() - 0.5) * 3;
    varied.environment.windSpeed = Math.max(0, varied.environment.windSpeed);
    
    // Wind direction variation ±15°
    varied.environment.windDirection += (Math.random() - 0.5) * 30;
    
    // Launch angle variation ±1°
    varied.launch.angle += (Math.random() - 0.5) * 2;

    return varied;
  }

  async runPhysicsSimulation(config) {
    // This would use the actual physics engine
    // For now, return mock data
    return this.mockSimulation(config);
  }

  mockSimulation(config) {
    // Simple physics model for demonstration
    const g = 9.81;
    const mass = config.rocket.mass + config.motor.totalMass;
    const thrust = config.motor.avgThrust;
    const burnTime = config.motor.burnTime;
    
    // Rough apogee calculation
    const acceleration = (thrust / mass) - g;
    const burnoutVelocity = acceleration * burnTime;
    const burnoutAltitude = 0.5 * acceleration * burnTime * burnTime;
    const coastAltitude = (burnoutVelocity * burnoutVelocity) / (2 * g);
    const apogee = burnoutAltitude + coastAltitude;
    
    // Time to apogee
    const timeToApogee = burnTime + burnoutVelocity / g;
    
    // Descent rate
    const chuteArea = Math.PI * Math.pow(config.rocket.chuteDiameter / 2, 2);
    const terminalVelocity = Math.sqrt((2 * mass * g) / (1.225 * config.rocket.chuteCd * chuteArea));
    
    // Flight time
    const descentTime = apogee / terminalVelocity;
    const totalTime = timeToApogee + descentTime;
    
    // Landing position (with wind drift)
    const windDrift = config.environment.windSpeed * descentTime;
    const windRad = config.environment.windDirection * Math.PI / 180;
    
    // Generate trajectory points
    const trajectory = [];
    const dt = 0.1;
    
    for (let t = 0; t <= totalTime; t += dt) {
      let altitude, velocity;
      
      if (t <= burnTime) {
        // Powered ascent
        velocity = acceleration * t;
        altitude = 0.5 * acceleration * t * t;
      } else if (t <= timeToApogee) {
        // Coast
        const coastTime = t - burnTime;
        velocity = burnoutVelocity - g * coastTime;
        altitude = burnoutAltitude + burnoutVelocity * coastTime - 0.5 * g * coastTime * coastTime;
      } else {
        // Descent
        const descentProgress = (t - timeToApogee) / descentTime;
        velocity = -terminalVelocity;
        altitude = apogee * (1 - descentProgress);
      }
      
      const windProgress = Math.max(0, (t - timeToApogee) / descentTime);
      const x = windDrift * windProgress * Math.sin(windRad);
      const y = windDrift * windProgress * Math.cos(windRad);
      
      trajectory.push({
        time: t,
        altitude: Math.max(0, altitude),
        velocity: velocity,
        x: x,
        y: y
      });
    }

    return {
      apogee: apogee,
      maxVelocity: burnoutVelocity,
      maxAcceleration: acceleration,
      timeToApogee: timeToApogee,
      flightTime: totalTime,
      landingVelocity: terminalVelocity,
      landingX: windDrift * Math.sin(windRad),
      landingY: windDrift * Math.cos(windRad),
      landingDistance: windDrift,
      trajectory: trajectory,
      events: [
        { time: 0, event: 'Liftoff', altitude: 0 },
        { time: burnTime, event: 'Burnout', altitude: burnoutAltitude },
        { time: timeToApogee, event: 'Apogee', altitude: apogee },
        { time: timeToApogee + 0.5, event: 'Chute Deploy', altitude: apogee - terminalVelocity * 0.5 },
        { time: totalTime, event: 'Landing', altitude: 0 }
      ]
    };
  }

  analyzeMonteCarloResults(results) {
    const apogees = results.map(r => r.apogee);
    const flightTimes = results.map(r => r.flightTime);
    const landingX = results.map(r => r.landingX);
    const landingY = results.map(r => r.landingY);
    const landingDist = results.map(r => r.landingDistance);

    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    const stdDev = arr => {
      const m = mean(arr);
      return Math.sqrt(arr.reduce((sum, x) => sum + Math.pow(x - m, 2), 0) / arr.length);
    };
    const percentile = (arr, p) => {
      const sorted = [...arr].sort((a, b) => a - b);
      const idx = Math.floor(sorted.length * p / 100);
      return sorted[idx];
    };

    return {
      count: results.length,
      apogee: {
        mean: mean(apogees),
        stdDev: stdDev(apogees),
        min: Math.min(...apogees),
        max: Math.max(...apogees),
        p5: percentile(apogees, 5),
        p95: percentile(apogees, 95)
      },
      flightTime: {
        mean: mean(flightTimes),
        stdDev: stdDev(flightTimes)
      },
      landing: {
        xMean: mean(landingX),
        yMean: mean(landingY),
        xStdDev: stdDev(landingX),
        yStdDev: stdDev(landingY),
        distMean: mean(landingDist),
        dist95: percentile(landingDist, 95),
        positions: results.map(r => ({ x: r.landingX, y: r.landingY }))
      }
    };
  }

  // ============================================
  // Optimization Tools
  // ============================================

  async runOptimizer() {
    const rocket = this.state.get('rocket');
    
    if (!rocket) {
      alert('Please design or import a rocket first');
      return;
    }

    // Get motors from ThrustCurve database
    let motors = [];
    if (this.modules.thrustCurveAPI && this.modules.thrustCurveAPI.offlineDB) {
      motors = this.modules.thrustCurveAPI.offlineDB;
    } else {
      alert('Motor database not loaded. Please wait for it to load or check your connection.');
      return;
    }

    // Get optimization settings
    const mode = this.container.querySelector('#opt-mode')?.value || 'altitude';
    const altitude = parseFloat(this.container.querySelector('#opt-altitude')?.value || 850);
    const units = this.container.querySelector('#opt-units')?.value || 'feet';
    const maxDiameter = parseFloat(this.container.querySelector('#opt-max-diameter')?.value || 29);
    const maxImpulse = this.container.querySelector('#opt-max-impulse')?.value || 'G';

    const resultsSection = this.container.querySelector('#opt-results-section');
    const resultsEl = this.container.querySelector('#opt-results');
    
    if (resultsEl) {
      resultsEl.innerHTML = '<p class="loading">Analyzing motors...</p>';
    }
    if (resultsSection) {
      resultsSection.style.display = 'block';
    }

    try {
      // Create optimizer with FlightOptimizer class if available
      const optimizer = typeof FlightOptimizer !== 'undefined' 
        ? new FlightOptimizer(rocket, motors)
        : this.createSimpleOptimizer(rocket, motors);

      let results;
      
      if (mode === 'tarc') {
        results = await optimizer.optimizeForTARC({
          constraints: { maxDiameter, maxImpulseClass: maxImpulse }
        });
      } else if (mode === 'minDrift') {
        results = await optimizer.optimizeForMinimumDrift(altitude, {
          units,
          constraints: { maxDiameter, maxImpulseClass: maxImpulse }
        });
      } else {
        results = await optimizer.optimizeForAltitude(altitude, {
          units,
          constraints: { maxDiameter, maxImpulseClass: maxImpulse }
        });
      }

      this.renderOptimizationResults(results);
      
    } catch (error) {
      log.error('Optimization failed:', error);
      if (resultsEl) {
        resultsEl.innerHTML = `<p class="error">Optimization failed: ${error.message}</p>`;
      }
    }
  }

  createSimpleOptimizer(rocket, motors) {
    // Fallback simple optimizer if FlightOptimizer not loaded
    return {
      optimizeForAltitude: async (target, options) => {
        const filtered = motors.filter(m => 
          (m.diameter || 18) <= (options.constraints?.maxDiameter || 100)
        ).slice(0, 20);
        
        return {
          success: true,
          recommendations: filtered.map(m => ({
            motor: { designation: m.designation || m.commonName, manufacturer: m.manufacturer },
            prediction: { apogee: 200, apogeeFeet: 656 },
            delay: { recommended: 7 },
            accuracy: { errorPercent: 0, score: 80 }
          })),
          bestMatch: filtered[0] ? {
            motor: { designation: filtered[0].designation || filtered[0].commonName },
            prediction: { apogee: 200, apogeeFeet: 656 },
            delay: { recommended: 7 }
          } : null
        };
      },
      optimizeForTARC: async () => this.optimizeForAltitude(251.46, { units: 'meters' }),
      optimizeForMinimumDrift: async (alt, opts) => this.optimizeForAltitude(alt, opts)
    };
  }

  renderOptimizationResults(results) {
    const resultsEl = this.container.querySelector('#opt-results');
    if (!resultsEl) return;

    if (!results.success) {
      resultsEl.innerHTML = `<p class="error">${results.error || 'Optimization failed'}</p>`;
      return;
    }

    const recs = results.recommendations || [];
    if (recs.length === 0) {
      resultsEl.innerHTML = '<p class="error">No suitable motors found for your constraints</p>';
      return;
    }

    const isTARC = results.mode === 'TARC';

    resultsEl.innerHTML = `
      <div class="opt-results-header">
        <p><strong>Found ${recs.length} candidates</strong></p>
      </div>
      
      <div class="opt-results-list">
        ${recs.slice(0, 10).map((r, i) => `
          <div class="opt-result-card ${i === 0 ? 'best-match' : ''}">
            <div class="opt-rank">${i === 0 ? '🏆' : '#' + (i + 1)}</div>
            <div class="opt-motor-info">
              <span class="opt-motor-name">${r.motor.manufacturer || ''} ${r.motor.designation}</span>
              <span class="opt-motor-detail">${r.motor.diameter || '?'}mm</span>
            </div>
            <div class="opt-prediction">
              <span class="opt-apogee">${r.prediction.apogeeFeet?.toFixed(0) || '?'} ft</span>
              <span class="opt-delay">Delay: ${r.delay.recommended}s</span>
            </div>
            <div class="opt-score">
              ${isTARC 
                ? `Score: ${r.tarcScoring?.tarcScore?.toFixed(1) || '?'}`
                : `${r.accuracy.errorPercent >= 0 ? '+' : ''}${r.accuracy.errorPercent?.toFixed(1) || 0}%`
              }
            </div>
            <button class="btn btn-small btn-select-opt-motor" data-index="${i}">Select</button>
          </div>
        `).join('')}
      </div>
      
      ${results.bestMatch ? `
        <div class="opt-best-summary">
          <h4>✅ Recommended: ${results.bestMatch.motor.manufacturer || ''} ${results.bestMatch.motor.designation}</h4>
          <p>Predicted apogee: <strong>${results.bestMatch.prediction.apogeeFeet?.toFixed(0) || '?'} ft</strong>
             (${results.bestMatch.prediction.apogee?.toFixed(1) || '?'} m)</p>
          <p>Use delay: <strong>${results.bestMatch.delay.recommended} seconds</strong></p>
        </div>
      ` : ''}
    `;

    // Add click handlers for select buttons
    resultsEl.querySelectorAll('.btn-select-opt-motor').forEach(btn => {
      btn.addEventListener('click', () => {
        const index = parseInt(btn.dataset.index);
        const rec = recs[index];
        if (rec && rec.motor) {
          // Find the full motor object from database
          const motors = this.modules.thrustCurveAPI?.offlineDB || [];
          const fullMotor = motors.find(m => 
            (m.designation || m.commonName) === rec.motor.designation
          ) || rec.motor;
          
          this.handleMotorSelect(fullMotor);
          this.switchTab('simulate');
        }
      });
    });
  }

  // ============================================
  // Flight Data Import & Comparison
  // ============================================

  async importFlightData(file) {
    try {
      const importer = typeof FlightDataImporter !== 'undefined'
        ? new FlightDataImporter()
        : this.createSimpleImporter();

      const flightData = await importer.importFile(file);
      this.state.set('flightData', flightData);
      
      this.renderFlightAnalysis(flightData);
      
      // If we have simulation data, run comparison
      const simData = this.state.get('simulation');
      if (simData) {
        this.runFlightComparison(simData, flightData);
      }
      
    } catch (error) {
      log.error('Flight data import failed:', error);
      alert(`Failed to import flight data: ${error.message}`);
    }
  }

  createSimpleImporter() {
    // Fallback simple importer
    return {
      importFile: async (file) => {
        const text = await file.text();
        const lines = text.trim().split('\n');
        const trajectory = [];
        
        for (let i = 1; i < lines.length; i++) {
          const parts = lines[i].split(',').map(s => parseFloat(s.trim()));
          if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
            trajectory.push({
              time: parts[0],
              altitude: parts[1] * 0.3048, // Assume feet, convert to meters
              altitudeFeet: parts[1]
            });
          }
        }
        
        const maxAlt = Math.max(...trajectory.map(t => t.altitude));
        const apogeePoint = trajectory.find(t => t.altitude === maxAlt);
        
        return {
          filename: file.name,
          format: 'generic',
          trajectory,
          analysis: {
            apogee: maxAlt,
            apogeeFeet: maxAlt * 3.28084,
            apogeeTime: apogeePoint?.time || 0,
            flightTime: trajectory[trajectory.length - 1]?.time || 0
          }
        };
      }
    };
  }

  renderFlightAnalysis(flightData) {
    const section = this.container.querySelector('#flight-analysis-section');
    const statsEl = this.container.querySelector('#flight-analysis-stats');
    
    if (!section || !statsEl) return;

    const a = flightData.analysis;

    statsEl.innerHTML = `
      <div class="fd-stats-grid">
        <div class="fd-stat">
          <span class="fd-stat-value">${a.apogeeFeet?.toFixed(0) || a.apogee?.toFixed(0)} ft</span>
          <span class="fd-stat-label">Apogee</span>
        </div>
        <div class="fd-stat">
          <span class="fd-stat-value">${a.apogeeTime?.toFixed(2) || '?'} s</span>
          <span class="fd-stat-label">Time to Apogee</span>
        </div>
        <div class="fd-stat">
          <span class="fd-stat-value">${a.flightTime?.toFixed(1) || '?'} s</span>
          <span class="fd-stat-label">Flight Time</span>
        </div>
        <div class="fd-stat">
          <span class="fd-stat-value">${flightData.trajectory?.length || 0}</span>
          <span class="fd-stat-label">Data Points</span>
        </div>
      </div>
      <p class="fd-file-info">
        <strong>File:</strong> ${flightData.filename} | 
        <strong>Format:</strong> ${flightData.format}
      </p>
    `;
    
    section.style.display = 'block';
  }

  runFlightComparison(simData, flightData) {
    let comparison;
    
    if (typeof FlightComparison !== 'undefined') {
      comparison = FlightComparison.compare(simData, flightData);
    } else {
      // Simple comparison fallback
      const simApogee = simData.apogee || 0;
      const actualApogee = flightData.analysis.apogee || 0;
      comparison = {
        simulation: { apogee: simApogee },
        actual: { apogee: actualApogee },
        metrics: {
          apogee: {
            sim: simApogee,
            actual: actualApogee,
            error: simApogee - actualApogee,
            errorPercent: ((simApogee - actualApogee) / actualApogee) * 100
          }
        },
        errors: { rmse: Math.abs(simApogee - actualApogee) * 0.5, rmseFeet: Math.abs(simApogee - actualApogee) * 0.5 * 3.28084 },
        accuracyScore: Math.max(0, 100 - Math.abs((simApogee - actualApogee) / actualApogee) * 100),
        alignedData: []
      };
    }
    
    this.renderComparisonResults(comparison, simData, flightData);
  }

  renderComparisonResults(comparison, simData, flightData) {
    const section = this.container.querySelector('#comparison-section');
    const resultsEl = this.container.querySelector('#comparison-results');
    
    if (!section || !resultsEl) return;

    const c = comparison;
    const scoreClass = c.accuracyScore >= 80 ? 'good' : c.accuracyScore >= 60 ? 'fair' : 'poor';

    resultsEl.innerHTML = `
      <div class="comparison-score ${scoreClass}">
        <span class="score-value">${c.accuracyScore?.toFixed(0) || '?'}</span>
        <span class="score-label">Accuracy Score</span>
      </div>
      
      <table class="comparison-table">
        <tr>
          <th>Metric</th>
          <th>Simulation</th>
          <th>Actual</th>
          <th>Error</th>
        </tr>
        <tr>
          <td>Apogee</td>
          <td>${((c.simulation?.apogee || 0) * 3.28084).toFixed(0)} ft</td>
          <td>${((c.actual?.apogee || 0) * 3.28084).toFixed(0)} ft</td>
          <td class="${Math.abs(c.metrics?.apogee?.errorPercent || 0) < 10 ? 'good' : 'warn'}">
            ${(c.metrics?.apogee?.errorPercent || 0) >= 0 ? '+' : ''}${(c.metrics?.apogee?.errorPercent || 0).toFixed(1)}%
          </td>
        </tr>
        <tr>
          <td>RMSE</td>
          <td colspan="2" style="text-align:center">—</td>
          <td>${(c.errors?.rmseFeet || 0).toFixed(1)} ft</td>
        </tr>
      </table>
      
      <div class="comparison-actions" style="margin-top: 15px; display: flex; gap: 10px;">
        <button class="btn btn-small btn-primary" id="btn-compare-3d">🚀 Compare in 3D</button>
      </div>
    `;
    
    // Store comparison data for 3D view
    this.lastComparisonData = { simData, flightData, comparison: c };
    
    // Add event listener for 3D comparison button
    this.container.querySelector('#btn-compare-3d')?.addEventListener('click', () => {
      this.compareIn3D();
    });
    
    section.style.display = 'block';
    
    // Draw comparison chart
    this.renderComparisonChart(simData, flightData);
  }

  renderComparisonChart(simData, flightData) {
    const canvas = this.container.querySelector('#comparison-chart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const padding = 50;

    // Clear
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, w, h);

    const simTraj = simData.trajectory || [];
    const actualTraj = flightData.trajectory || [];

    if (simTraj.length === 0 && actualTraj.length === 0) return;

    // Find scales
    const allTimes = [...simTraj.map(p => p.time), ...actualTraj.map(p => p.time)];
    const allAlts = [...simTraj.map(p => p.altitude), ...actualTraj.map(p => p.altitude)];
    const maxTime = Math.max(...allTimes, 1);
    const maxAlt = Math.max(...allAlts, 1) * 1.1;

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

    // Draw simulation trajectory
    if (simTraj.length > 0) {
      ctx.strokeStyle = '#2196f3';
      ctx.lineWidth = 2;
      ctx.beginPath();
      simTraj.forEach((p, i) => {
        const x = padding + (p.time / maxTime) * (w - 2 * padding);
        const y = h - padding - (p.altitude / maxAlt) * (h - 2 * padding);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Draw actual trajectory
    if (actualTraj.length > 0) {
      ctx.strokeStyle = '#ff6b35';
      ctx.lineWidth = 2;
      ctx.beginPath();
      actualTraj.forEach((p, i) => {
        const x = padding + (p.time / maxTime) * (w - 2 * padding);
        const y = h - padding - (p.altitude / maxAlt) * (h - 2 * padding);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // Legend
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#2196f3';
    ctx.fillRect(w - 130, 15, 20, 3);
    ctx.fillStyle = '#333';
    ctx.fillText('Simulation', w - 105, 20);
    
    ctx.fillStyle = '#ff6b35';
    ctx.fillRect(w - 130, 30, 20, 3);
    ctx.fillStyle = '#333';
    ctx.fillText('Actual Flight', w - 105, 35);

    // Axes
    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';
    ctx.fillText('Time (s)', w / 2, h - 10);
    
    ctx.save();
    ctx.translate(15, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Altitude (m)', 0, 0);
    ctx.restore();
  }

  compareIn3D() {
    if (!this.lastComparisonData) {
      this.showNotification('⚠️ No comparison data available', 'warning');
      return;
    }

    const { simData, flightData } = this.lastComparisonData;

    // Switch to 3D view tab
    this.switchTab('view3d');

    // Initialize 3D viewer if needed
    setTimeout(() => {
      if (!this.viewer3D) {
        this.init3DViewer();
      }

      if (!this.viewer3D) {
        this.showNotification('⚠️ Could not initialize 3D viewer', 'error');
        return;
      }

      // Clear existing trajectories
      this.viewer3D.clearAllTrajectories();

      // Add simulation trajectory
      if (simData && simData.trajectory && simData.trajectory.length > 0) {
        this.viewer3D.addTrajectory(simData, {
          id: 'sim-' + Date.now(),
          name: 'Simulation',
          color: '#2196f3'  // Blue
        });
      }

      // Add actual flight trajectory
      if (flightData && flightData.trajectory && flightData.trajectory.length > 0) {
        this.viewer3D.addTrajectory({
          trajectory: flightData.trajectory,
          apogee: flightData.analysis?.apogee || 0,
          flightTime: flightData.trajectory[flightData.trajectory.length - 1]?.time || 0
        }, {
          id: 'actual-' + Date.now(),
          name: 'Actual Flight',
          color: '#ff6b35'  // Orange
        });
      }

      this.updateTrajectoryCount();
      this.showNotification('📊 Trajectories loaded for 3D comparison');
    }, 100);
  }

  // ============================================
  // Results Display
  // ============================================

  showProgress(show, percent = 0) {
    const container = this.container.querySelector('#sim-progress');
    if (!container) return;

    container.style.display = show ? 'block' : 'none';
    if (show) {
      container.querySelector('.progress-fill').style.width = `${percent}%`;
      container.querySelector('.progress-text').textContent = `${percent.toFixed(0)}%`;
    }
  }

  showQuickResults(result) {
    const section = this.container.querySelector('#quick-results');
    const content = this.container.querySelector('#quick-results-content');
    if (!section || !content) return;

    content.innerHTML = `
      <div class="quick-stats">
        <div class="stat">
          <span class="stat-value">${result.apogee.toFixed(1)}m</span>
          <span class="stat-label">Apogee</span>
        </div>
        <div class="stat">
          <span class="stat-value">${result.maxVelocity.toFixed(1)}m/s</span>
          <span class="stat-label">Max Velocity</span>
        </div>
        <div class="stat">
          <span class="stat-value">${result.flightTime.toFixed(1)}s</span>
          <span class="stat-label">Flight Time</span>
        </div>
        <div class="stat">
          <span class="stat-value">${result.landingVelocity.toFixed(1)}m/s</span>
          <span class="stat-label">Landing Speed</span>
        </div>
      </div>
    `;
    section.style.display = 'block';
  }

  renderFlightSummary(result) {
    const container = this.container.querySelector('#flight-summary');
    if (!container) return;

    // Convert values based on current unit system
    const apogee = this.convertFromMetric(result.apogee, 'm');
    const apogeeUnit = this.getUnitLabel('m');
    const maxVel = this.convertFromMetric(result.maxVelocity, 'm/s');
    const velUnit = this.getUnitLabel('m/s');
    const landingVel = this.convertFromMetric(result.landingVelocity, 'm/s');
    const landingDist = this.convertFromMetric(result.landingDistance, 'm');
    const distUnit = this.getUnitLabel('m');
    
    // Mach number doesn't need conversion
    const mach = (result.maxVelocity / 343).toFixed(2);
    const maxG = (result.maxAcceleration / 9.81).toFixed(1);

    container.innerHTML = `
      <table class="summary-table">
        <tr>
          <th>Apogee</th>
          <td>
            <span class="unit-value" data-metric-value="${result.apogee}" data-metric-unit="m" data-decimals="1">
              ${apogee.toFixed(1)} ${apogeeUnit}
            </span>
          </td>
        </tr>
        <tr>
          <th>Max Velocity</th>
          <td>
            <span class="unit-value" data-metric-value="${result.maxVelocity}" data-metric-unit="m/s" data-decimals="1">
              ${maxVel.toFixed(1)} ${velUnit}
            </span>
            (Mach ${mach})
          </td>
        </tr>
        <tr>
          <th>Max Acceleration</th>
          <td>${result.maxAcceleration.toFixed(1)} m/s² (${maxG} G)</td>
        </tr>
        <tr>
          <th>Time to Apogee</th>
          <td>${result.timeToApogee.toFixed(2)} s</td>
        </tr>
        <tr>
          <th>Total Flight Time</th>
          <td>${result.flightTime.toFixed(1)} s</td>
        </tr>
        <tr>
          <th>Landing Velocity</th>
          <td>
            <span class="unit-value" data-metric-value="${result.landingVelocity}" data-metric-unit="m/s" data-decimals="1">
              ${landingVel.toFixed(1)} ${velUnit}
            </span>
          </td>
        </tr>
        <tr>
          <th>Landing Distance</th>
          <td>
            <span class="unit-value" data-metric-value="${result.landingDistance}" data-metric-unit="m" data-decimals="0">
              ${landingDist.toFixed(0)} ${distUnit}
            </span>
            downwind
          </td>
        </tr>
      </table>
      
      <h4>Flight Events</h4>
      <table class="events-table">
        <tr><th>Time</th><th>Event</th><th>Altitude</th></tr>
        ${result.events.map(e => {
          const alt = this.convertFromMetric(e.altitude, 'm');
          return `
            <tr>
              <td>${e.time.toFixed(2)}s</td>
              <td>${e.event}</td>
              <td>
                <span class="unit-value" data-metric-value="${e.altitude}" data-metric-unit="m" data-decimals="1">
                  ${alt.toFixed(1)} ${apogeeUnit}
                </span>
              </td>
            </tr>
          `;
        }).join('')}
      </table>
    `;
  }

  renderTrajectory(result) {
    const canvas = this.container.querySelector('#trajectory-canvas');
    if (!canvas || !result.trajectory) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const padding = 50;

    // Clear
    ctx.fillStyle = '#f0f4f8';
    ctx.fillRect(0, 0, w, h);

    const trajectory = result.trajectory;
    const maxAlt = Math.max(...trajectory.map(p => p.altitude)) * 1.1;
    const maxTime = Math.max(...trajectory.map(p => p.time));

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

    // Draw altitude curve
    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth = 3;
    ctx.beginPath();

    trajectory.forEach((p, i) => {
      const x = padding + (p.time / maxTime) * (w - 2 * padding);
      const y = h - padding - (p.altitude / maxAlt) * (h - 2 * padding);
      
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw events
    result.events.forEach(e => {
      const x = padding + (e.time / maxTime) * (w - 2 * padding);
      const y = h - padding - (e.altitude / maxAlt) * (h - 2 * padding);
      
      ctx.fillStyle = '#ff6b35';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = '#333';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(e.event, x, y - 10);
    });

    // Axes labels
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Time (s)', w / 2, h - 10);
    
    const altUnit = this.getUnitLabel('m');
    ctx.save();
    ctx.translate(15, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`Altitude (${altUnit})`, 0, 0);
    ctx.restore();

    // Y-axis values
    ctx.textAlign = 'right';
    for (let i = 0; i <= 5; i++) {
      const y = padding + (i / 5) * (h - 2 * padding);
      const val = maxAlt - (i / 5) * maxAlt;
      ctx.fillText(val.toFixed(0), padding - 5, y + 4);
    }
  }

  renderMonteCarloResults(analysis) {
    const section = this.container.querySelector('#monte-carlo-section');
    const statsDiv = this.container.querySelector('#mc-stats');
    
    if (!section || !statsDiv) return;

    section.style.display = 'block';

    statsDiv.innerHTML = `
      <h4>Monte Carlo Analysis (${analysis.count} simulations)</h4>
      <table class="mc-table">
        <tr><th>Metric</th><th>Mean</th><th>Std Dev</th><th>Range</th></tr>
        <tr>
          <td>Apogee</td>
          <td>${analysis.apogee.mean.toFixed(1)} m</td>
          <td>±${analysis.apogee.stdDev.toFixed(1)} m</td>
          <td>${analysis.apogee.min.toFixed(1)} - ${analysis.apogee.max.toFixed(1)} m</td>
        </tr>
        <tr>
          <td>Flight Time</td>
          <td>${analysis.flightTime.mean.toFixed(1)} s</td>
          <td>±${analysis.flightTime.stdDev.toFixed(1)} s</td>
          <td>-</td>
        </tr>
        <tr>
          <td>Landing Dist</td>
          <td>${analysis.landing.distMean.toFixed(1)} m</td>
          <td>-</td>
          <td>95%: ${analysis.landing.dist95.toFixed(1)} m</td>
        </tr>
      </table>
    `;

    // Draw landing zone
    this.renderLandingZone(analysis);
    
    // Draw apogee histogram
    this.renderApogeeHistogram(analysis);
  }

  renderLandingZone(analysis) {
    const canvas = this.container.querySelector('#landing-zone-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;

    // Clear
    ctx.fillStyle = '#e8f5e9';
    ctx.fillRect(0, 0, w, h);

    // Scale
    const maxDist = analysis.landing.dist95 * 1.5 || 100;
    const scale = (Math.min(w, h) - 80) / (2 * maxDist);

    // Draw grid
    ctx.strokeStyle = '#c8e6c9';
    ctx.lineWidth = 1;
    const gridStep = maxDist / 4;
    for (let r = gridStep; r <= maxDist; r += gridStep) {
      ctx.beginPath();
      ctx.arc(cx, cy, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Draw axes
    ctx.strokeStyle = '#81c784';
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, h);
    ctx.stroke();

    // Draw 95% ellipse
    ctx.strokeStyle = '#ff9800';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(
      cx + analysis.landing.xMean * scale,
      cy - analysis.landing.yMean * scale,
      analysis.landing.xStdDev * 2 * scale,
      analysis.landing.yStdDev * 2 * scale,
      0, 0, Math.PI * 2
    );
    ctx.stroke();

    // Draw landing points
    ctx.fillStyle = 'rgba(33, 150, 243, 0.5)';
    analysis.landing.positions.forEach(p => {
      ctx.beginPath();
      ctx.arc(cx + p.x * scale, cy - p.y * scale, 3, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw launch point
    ctx.fillStyle = '#f44336';
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();

    // Labels
    ctx.fillStyle = '#333';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Landing Zone (N↑)', cx, 15);
    ctx.fillText(`Grid: ${gridStep.toFixed(0)}m`, cx, h - 5);
  }

  renderApogeeHistogram(analysis) {
    const canvas = this.container.querySelector('#apogee-histogram-canvas');
    if (!canvas) return;

    // Simple histogram placeholder
    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.fillStyle = '#fff3e0';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#333';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Apogee Distribution', w / 2, 20);
    ctx.fillText(`${analysis.apogee.mean.toFixed(1)} ± ${analysis.apogee.stdDev.toFixed(1)} m`, w / 2, h / 2);
  }

  // ============================================
  // Launch Day Assistant
  // ============================================

  checkLaunchReadiness() {
    const rocket = this.state.get('rocket');
    const motor = this.state.get('motor');
    const weather = this.state.get('weather');
    const simulation = this.state.get('simulation');

    if (!rocket) {
      alert('Please configure a rocket first');
      return;
    }

    try {
      if (typeof LaunchDayAssistant === 'undefined') {
        this.showLaunchDayError('Launch Day Assistant module not loaded');
        return;
      }

      const conditions = {
        weather: weather || {},
        simulation: simulation,
        waiver: { feet: 5000 } // Default waiver
      };

      const assistant = new LaunchDayAssistant(rocket, motor, conditions);
      const readiness = assistant.getReadiness();

      this.state.set('launchReadiness', readiness);
      this.state.set('checklist', assistant.checklist);

      this.renderLaunchDayStatus(readiness);
      this.renderSystemChecks(readiness);
      this.renderDriftPrediction(readiness);
      this.renderChecklist(assistant.checklist);
      this.renderLaunchRecommendations(readiness);

    } catch (error) {
      log.error('Launch readiness check failed:', error);
      this.showLaunchDayError(error.message);
    }
  }

  renderLaunchDayStatus(readiness) {
    const container = this.container.querySelector('#launchday-status');
    if (!container) return;

    const overall = readiness.overall;
    const statusColors = {
      'GO': 'go',
      'HOLD': 'hold',
      'NO-GO': 'nogo'
    };

    container.innerHTML = `
      <h3>📊 Overall Status</h3>
      <div class="status-display ${statusColors[overall.status] || 'unknown'}">
        <span class="big-status">${overall.status}</span>
        <span class="status-score">Score: ${overall.score}/100</span>
      </div>
      <p class="status-message">${overall.message}</p>
      ${overall.blockers.length > 0 ? `
        <div class="status-blockers">
          <strong>Blockers:</strong>
          <ul>${overall.blockers.map(b => `<li>🚫 ${b}</li>`).join('')}</ul>
        </div>
      ` : ''}
      ${overall.warnings.length > 0 ? `
        <div class="status-warnings">
          <strong>Warnings:</strong>
          <ul>${overall.warnings.map(w => `<li>⚠️ ${w}</li>`).join('')}</ul>
        </div>
      ` : ''}
    `;
  }

  renderSystemChecks(readiness) {
    const checks = [
      { system: 'stability', data: readiness.stability },
      { system: 'flutter', data: readiness.flutter },
      { system: 'recovery', data: readiness.recovery },
      { system: 'waiver', data: readiness.waiver }
    ];

    checks.forEach(({ system, data }) => {
      const el = this.container.querySelector(`.system-check[data-system="${system}"]`);
      if (!el || !data) return;

      const icon = data.severity === 'danger' ? '🛑' :
                   data.severity === 'warning' ? '⚠️' :
                   data.status === 'OK' || data.status === 'STABLE' || data.withinWaiver ? '✅' : '❓';

      el.querySelector('.check-icon').textContent = icon;
      el.querySelector('.check-status').textContent = data.status || data.message || 'Unknown';
    });
  }

  renderDriftPrediction(readiness) {
    const container = this.container.querySelector('#launchday-drift');
    if (!container) return;

    const drift = readiness.drift;
    const launch = readiness.launchDirection;

    if (!drift) {
      container.innerHTML = `
        <h3>🎯 Drift Prediction</h3>
        <div class="drift-placeholder">Get weather data for drift prediction</div>
      `;
      return;
    }

    container.innerHTML = `
      <h3>🎯 Drift Prediction</h3>
      <div class="drift-display">
        <div class="drift-stat">
          <span class="drift-value">${drift.distanceFeet.toFixed(0)}</span>
          <span class="drift-unit">ft</span>
          <span class="drift-label">Estimated Drift</span>
        </div>
        <div class="drift-stat">
          <span class="drift-value">${drift.directionCardinal}</span>
          <span class="drift-label">Direction</span>
        </div>
        <div class="drift-stat">
          <span class="drift-value">${drift.confidence}%</span>
          <span class="drift-label">Confidence</span>
        </div>
      </div>
      ${launch ? `
        <div class="launch-direction">
          <p><strong>🧭 Launch Direction:</strong> Aim into wind (${launch.intoWindCardinal}) at ${launch.recommendedAngle}° tilt</p>
          <p><strong>🚶 Walk Direction:</strong> Head ${drift.walkDirectionCardinal} to recover</p>
        </div>
      ` : ''}
    `;
  }

  renderChecklist(checklist) {
    const container = this.container.querySelector('#checklist-items');
    const progress = this.container.querySelector('.checklist-progress');
    if (!container || !checklist) return;

    const status = checklist.getStatus();
    if (progress) {
      progress.textContent = `${status.completed} / ${status.total} items`;
    }

    const categories = ['pre_flight', 'rocket', 'motor', 'recovery', 'electronics', 'pad', 'final'];
    const categoryNames = {
      'pre_flight': '📋 Pre-Flight',
      'rocket': '🚀 Rocket',
      'motor': '🔥 Motor',
      'recovery': '🪂 Recovery',
      'electronics': '📡 Electronics',
      'pad': '🎯 Launch Pad',
      'final': '✅ Final Checks'
    };

    let html = '';
    categories.forEach(cat => {
      const items = checklist.getByCategory(cat);
      if (items.length === 0) return;

      html += `<div class="checklist-category">
        <h4>${categoryNames[cat] || cat}</h4>
        <ul class="checklist-list">`;

      items.forEach(item => {
        const checked = checklist.isComplete(item.id);
        html += `
          <li class="checklist-item ${checked ? 'checked' : ''} ${item.critical ? 'critical' : ''}">
            <label>
              <input type="checkbox" data-item-id="${item.id}" ${checked ? 'checked' : ''}>
              <span class="item-text">${item.text}</span>
              ${item.critical ? '<span class="critical-badge">Required</span>' : ''}
            </label>
          </li>
        `;
      });

      html += '</ul></div>';
    });

    container.innerHTML = html;

    // Add event listeners for checkboxes
    container.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const itemId = e.target.dataset.itemId;
        if (e.target.checked) {
          checklist.completeItem(itemId);
        } else {
          checklist.uncompleteItem(itemId);
        }
        this.updateChecklistProgress();
      });
    });
  }

  updateChecklistProgress() {
    const checklist = this.state.get('checklist');
    const progress = this.container.querySelector('.checklist-progress');
    if (!checklist || !progress) return;

    const status = checklist.getStatus();
    progress.textContent = `${status.completed} / ${status.total} items`;
  }

  resetChecklist() {
    const checklist = this.state.get('checklist');
    if (checklist) {
      checklist.reset();
      this.renderChecklist(checklist);
    }
  }

  renderLaunchRecommendations(readiness) {
    const container = this.container.querySelector('#launchday-recommendations');
    if (!container) return;

    const recs = [];

    // Weather recommendation
    if (readiness.weather.status === 'GO') {
      recs.push({ type: 'good', text: '✅ Weather conditions are favorable for launch' });
    } else if (readiness.weather.status === 'CAUTION') {
      recs.push({ type: 'warning', text: '⚠️ Weather is marginal - launch with caution' });
    } else {
      recs.push({ type: 'bad', text: '🛑 Wait for better weather conditions' });
    }

    // Stability recommendation
    if (readiness.stability.severity === 'safe') {
      recs.push({ type: 'good', text: `✅ Stability margin is ${readiness.stability.calibers?.toFixed(2) || 'good'} calibers` });
    } else if (readiness.stability.severity === 'warning') {
      recs.push({ type: 'warning', text: '⚠️ Consider adding nose weight for better stability' });
    }

    // Flutter recommendation
    if (readiness.flutter.safetyFactor >= 1.5) {
      recs.push({ type: 'good', text: '✅ Fins have adequate flutter margin' });
    } else if (readiness.flutter.safetyFactor >= 1.0) {
      recs.push({ type: 'warning', text: '⚠️ Flutter margin is low - consider thicker fins' });
    }

    // Waiver recommendation
    if (readiness.waiver.withinWaiver) {
      recs.push({ type: 'good', text: `✅ Expected altitude within ${readiness.waiver.waiverCeiling}ft waiver` });
    } else {
      recs.push({ type: 'bad', text: '🛑 Expected altitude exceeds waiver - reduce motor or get higher waiver' });
    }

    // Drift recommendation
    if (readiness.drift) {
      if (readiness.drift.distanceFeet < 500) {
        recs.push({ type: 'good', text: '✅ Minimal drift expected - easy recovery' });
      } else if (readiness.drift.distanceFeet < 1500) {
        recs.push({ type: 'info', text: `📍 Expect ~${Math.round(readiness.drift.distanceFeet)}ft drift ${readiness.drift.directionCardinal}` });
      } else {
        recs.push({ type: 'warning', text: `⚠️ Significant drift expected: ${Math.round(readiness.drift.distanceFeet)}ft - ensure field is large enough` });
      }
    }

    container.innerHTML = `
      <ul class="recommendations-list">
        ${recs.map(r => `<li class="rec-${r.type}">${r.text}</li>`).join('')}
      </ul>
    `;
  }

  simulateRecovery() {
    const rocket = this.state.get('rocket');
    const simulation = this.state.get('simulation');
    const weather = this.state.get('weather');

    if (!rocket) {
      alert('Please configure a rocket first');
      return;
    }

    const resultsContainer = this.container.querySelector('#recovery-results');
    if (!resultsContainer) return;

    try {
      if (typeof DualDeploySimulation === 'undefined') {
        resultsContainer.innerHTML = '<p class="error">Recovery simulation module not loaded</p>';
        return;
      }

      const recoveryType = this.container.querySelector('#recovery-type')?.value;
      const apogee = simulation?.apogee ? simulation.apogee * 3.28084 : 2000;

      let recoveryRocket = { ...rocket };

      if (recoveryType === 'dual') {
        const drogueDia = parseFloat(this.container.querySelector('#drogue-diameter')?.value || 350);
        const mainDia = parseFloat(this.container.querySelector('#main-diameter')?.value || 1200);
        const mainAlt = parseInt(this.container.querySelector('#main-deploy-alt')?.value || 500);

        recoveryRocket.drogueChute = { diameter: drogueDia, type: 'cruciform' };
        recoveryRocket.mainChute = { diameter: mainDia, type: 'round' };
        recoveryRocket.mainDeployAltitude = mainAlt;
      }

      const sim = new DualDeploySimulation(recoveryRocket);
      const windConfig = weather ? {
        groundSpeed: weather.windSpeed || 0,
        groundDirection: weather.windDirection || 0
      } : { groundSpeed: 3, groundDirection: 180 };

      const result = sim.simulate(apogee, windConfig);

      this.renderRecoveryResults(result);

    } catch (error) {
      log.error('Recovery simulation failed:', error);
      resultsContainer.innerHTML = `<p class="error">Simulation failed: ${error.message}</p>`;
    }
  }

  renderRecoveryResults(result) {
    const container = this.container.querySelector('#recovery-results');
    if (!container) return;

    const safety = result.safety;
    const safetyClass = safety.safe ? 'safe' : (safety.level === 'warning' ? 'warning' : 'danger');

    container.innerHTML = `
      <div class="recovery-summary ${safetyClass}">
        <h4>${result.isDualDeploy ? '🪂🪂 Dual Deploy' : '🪂 Single Deploy'} Recovery</h4>
        
        <div class="recovery-stats">
          <div class="recovery-stat">
            <span class="stat-value">${result.totals.flightTimeFormatted}</span>
            <span class="stat-label">Descent Time</span>
          </div>
          <div class="recovery-stat">
            <span class="stat-value">${result.totals.landingVelocityFps.toFixed(1)}</span>
            <span class="stat-unit">ft/s</span>
            <span class="stat-label">Landing Velocity</span>
          </div>
          <div class="recovery-stat">
            <span class="stat-value">${result.totals.totalDriftFeet.toFixed(0)}</span>
            <span class="stat-unit">ft</span>
            <span class="stat-label">Total Drift</span>
          </div>
          <div class="recovery-stat">
            <span class="stat-value">${result.totals.driftDirectionCardinal}</span>
            <span class="stat-label">Drift Direction</span>
          </div>
        </div>

        ${result.phases.length > 1 ? `
          <div class="recovery-phases">
            <h5>Descent Phases</h5>
            <table class="phases-table">
              <tr>
                <th>Phase</th>
                <th>Duration</th>
                <th>Descent Rate</th>
                <th>Drift</th>
              </tr>
              ${result.phases.map(p => `
                <tr>
                  <td>${p.name}</td>
                  <td>${Math.round(p.duration)}s</td>
                  <td>${(p.descentRate * 3.28).toFixed(0)} ft/s</td>
                  <td>${p.driftDistance.toFixed(0)}m</td>
                </tr>
              `).join('')}
            </table>
          </div>
        ` : ''}

        ${safety.issues.length > 0 ? `
          <div class="recovery-issues">
            <strong>⚠️ Issues:</strong>
            <ul>${safety.issues.map(i => `<li>${i}</li>`).join('')}</ul>
          </div>
        ` : ''}

        ${safety.warnings.length > 0 ? `
          <div class="recovery-warnings">
            <strong>💡 Suggestions:</strong>
            <ul>${safety.warnings.map(w => `<li>${w}</li>`).join('')}</ul>
          </div>
        ` : ''}
      </div>
    `;
  }

  showLaunchDayError(message) {
    const container = this.container.querySelector('#launchday-status');
    if (container) {
      container.innerHTML = `
        <h3>📊 Overall Status</h3>
        <div class="status-error">
          <span class="status-icon">❌</span>
          <span class="status-text">Error: ${message}</span>
        </div>
      `;
    }
  }

  // ============================================
  // Flight Log
  // ============================================

  initializeFlightLog() {
    if (typeof FlightLog !== 'undefined') {
      this.flightLog = new FlightLog({ autoLoad: true, autoSave: true });
      this.updateFlightLogDisplay();
    }
  }

  showLogFlightModal() {
    const modal = this.container.querySelector('#log-flight-modal');
    if (modal) {
      modal.style.display = 'flex';
      
      // Set default date to today
      const dateInput = modal.querySelector('input[name="date"]');
      if (dateInput) {
        dateInput.value = new Date().toISOString().split('T')[0];
      }
      
      // Pre-fill rocket name if available
      const rocket = this.state.get('rocket');
      if (rocket?.name) {
        const nameInput = modal.querySelector('input[name="rocketName"]');
        if (nameInput) nameInput.value = rocket.name;
      }
      
      // Pre-fill motor if available
      const motor = this.state.get('motor');
      if (motor?.designation) {
        const motorInput = modal.querySelector('input[name="motorDesignation"]');
        if (motorInput) motorInput.value = motor.designation;
      }
    }
  }

  hideLogFlightModal() {
    const modal = this.container.querySelector('#log-flight-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  fillSimulationData() {
    const simulation = this.state.get('simulation');
    if (!simulation) {
      alert('No simulation data available. Run a simulation first.');
      return;
    }
    
    const form = this.container.querySelector('#log-flight-form');
    if (!form) return;
    
    if (simulation.apogee) {
      form.querySelector('input[name="predictedApogee"]').value = simulation.apogee.toFixed(1);
    }
    if (simulation.maxVelocity) {
      form.querySelector('input[name="predictedMaxVelocity"]').value = simulation.maxVelocity.toFixed(1);
    }
  }

  fillWeatherData() {
    const weather = this.state.get('weather');
    if (!weather) {
      alert('No weather data available. Get weather first.');
      return;
    }
    
    const form = this.container.querySelector('#log-flight-form');
    if (!form) return;
    
    if (weather.windSpeed !== undefined) {
      form.querySelector('input[name="windSpeed"]').value = weather.windSpeed.toFixed(1);
    }
    if (weather.temperature !== undefined) {
      form.querySelector('input[name="temperature"]').value = Math.round(weather.temperature);
    }
  }

  saveFlightLog(form) {
    if (!this.flightLog) {
      alert('Flight Log not initialized');
      return;
    }
    
    const formData = new FormData(form);
    
    const flightData = {
      date: formData.get('date'),
      rocketName: formData.get('rocketName'),
      motorDesignation: formData.get('motorDesignation'),
      location: formData.get('location'),
      outcome: formData.get('outcome'),
      notes: formData.get('notes'),
      dataSource: formData.get('dataSource'),
      predicted: {
        apogee: parseFloat(formData.get('predictedApogee')) || null,
        maxVelocity: parseFloat(formData.get('predictedMaxVelocity')) || null
      },
      actual: {
        apogee: parseFloat(formData.get('actualApogee')) || null,
        maxVelocity: parseFloat(formData.get('actualMaxVelocity')) || null
      },
      weather: {
        windSpeed: parseFloat(formData.get('windSpeed')) || null,
        temperature: parseFloat(formData.get('temperature')) || null
      }
    };
    
    this.flightLog.logFlight(flightData);
    this.hideLogFlightModal();
    this.updateFlightLogDisplay();
    
    form.reset();
    alert('Flight logged successfully!');
  }

  updateFlightLogDisplay() {
    if (!this.flightLog) return;
    
    this.renderFlightStats();
    this.renderFlightAccuracy();
    this.renderFlightCalibration();
    this.renderFlightsList();
  }

  renderFlightStats() {
    const container = this.container.querySelector('#flightlog-stats');
    if (!container) return;
    
    const stats = this.flightLog.getStatistics();
    
    if (stats.flightCount === 0) {
      container.innerHTML = `
        <h3>📊 Statistics</h3>
        <div class="stats-placeholder"><p>No flights logged yet</p></div>
      `;
      return;
    }
    
    container.innerHTML = `
      <h3>📊 Statistics</h3>
      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-value">${stats.flightCount}</span>
          <span class="stat-label">Total Flights</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${stats.successRate.toFixed(0)}%</span>
          <span class="stat-label">Success Rate</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${stats.rockets.count}</span>
          <span class="stat-label">Rockets</span>
        </div>
        <div class="stat-card">
          <span class="stat-value">${stats.motors.count}</span>
          <span class="stat-label">Motors Used</span>
        </div>
      </div>
      ${stats.apogee ? `
        <div class="apogee-stats">
          <p><strong>Apogee Range:</strong> ${stats.apogee.min.toFixed(0)}m - ${stats.apogee.max.toFixed(0)}m (avg: ${stats.apogee.avg.toFixed(0)}m)</p>
        </div>
      ` : ''}
    `;
  }

  renderFlightAccuracy() {
    const container = this.container.querySelector('#flightlog-accuracy');
    if (!container) return;
    
    const metrics = this.flightLog.getAccuracyMetrics();
    
    if (metrics.flightCount === 0 || !metrics.apogee) {
      container.innerHTML = `
        <h3>🎯 Prediction Accuracy</h3>
        <div class="accuracy-placeholder">
          <p>Log flights with prediction data to see accuracy metrics</p>
        </div>
      `;
      return;
    }
    
    const rating = metrics.overall?.rating || 'N/A';
    const ratingClass = rating === 'EXCELLENT' ? 'excellent' : 
                       rating === 'GOOD' ? 'good' :
                       rating === 'FAIR' ? 'fair' : 'poor';
    
    container.innerHTML = `
      <h3>🎯 Prediction Accuracy</h3>
      <div class="accuracy-rating ${ratingClass}">
        <span class="rating-badge">${rating}</span>
        <span class="rating-detail">${metrics.overall?.avgAbsError.toFixed(1)}% avg error</span>
      </div>
      <div class="accuracy-details">
        ${metrics.apogee ? `
          <div class="accuracy-metric">
            <span class="metric-label">Apogee</span>
            <span class="metric-value">${metrics.apogee.meanAbsError.toFixed(1)}% error</span>
            <span class="metric-bias">${metrics.apogee.bias > 0 ? '↑' : '↓'} ${metrics.apogee.biasDirection}</span>
          </div>
        ` : ''}
        ${metrics.maxVelocity ? `
          <div class="accuracy-metric">
            <span class="metric-label">Max Velocity</span>
            <span class="metric-value">${metrics.maxVelocity.meanAbsError.toFixed(1)}% error</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  renderFlightCalibration() {
    const container = this.container.querySelector('#flightlog-calibration');
    if (!container) return;
    
    const calibration = this.flightLog.getCalibrationFactors();
    
    if (!calibration.available) {
      container.innerHTML = `
        <h3>🔧 Calibration Factors</h3>
        <div class="calibration-placeholder">
          <p>${calibration.message}</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = `
      <h3>🔧 Calibration Factors</h3>
      <div class="calibration-info">
        <p class="confidence">Confidence: <strong>${calibration.confidence}</strong> (${calibration.flightCount} flights)</p>
        ${calibration.apogee ? `
          <div class="calibration-factor">
            <span class="factor-label">Apogee Correction</span>
            <span class="factor-value">${calibration.apogee.factor.toFixed(3)}x</span>
            <span class="factor-detail">Multiply predictions by this factor</span>
          </div>
        ` : ''}
        ${calibration.velocity ? `
          <div class="calibration-factor">
            <span class="factor-label">Velocity Correction</span>
            <span class="factor-value">${calibration.velocity.factor.toFixed(3)}x</span>
          </div>
        ` : ''}
      </div>
    `;
  }

  renderFlightsList() {
    const container = this.container.querySelector('#flights-list');
    if (!container) return;
    
    const flights = this.flightLog.getRecentFlights(20);
    
    if (flights.length === 0) {
      container.innerHTML = '<p class="placeholder">No flights logged yet.</p>';
      return;
    }
    
    const outcomeIcons = {
      'success': '✅',
      'partial': '⚠️',
      'failure': '❌',
      'unknown': '❓'
    };
    
    container.innerHTML = flights.map(f => {
      const acc = f.getAccuracy();
      return `
        <div class="flight-card" data-flight-id="${f.id}">
          <div class="flight-header">
            <span class="flight-outcome">${outcomeIcons[f.outcome] || '❓'}</span>
            <span class="flight-rocket">${f.rocketName}</span>
            <span class="flight-date">${new Date(f.date).toLocaleDateString()}</span>
          </div>
          <div class="flight-details">
            <span class="flight-motor">${f.motorDesignation || 'No motor'}</span>
            ${f.actual.apogee ? `<span class="flight-apogee">${f.actual.apogee.toFixed(0)}m</span>` : ''}
            ${acc.apogee ? `<span class="flight-error ${Math.abs(acc.apogee.errorPercent) < 10 ? 'good' : 'poor'}">${acc.apogee.errorPercent > 0 ? '+' : ''}${acc.apogee.errorPercent.toFixed(1)}%</span>` : ''}
          </div>
          ${f.notes ? `<div class="flight-notes">${f.notes}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  exportFlightLog() {
    if (!this.flightLog) return;
    
    const json = this.flightLog.exportJSON();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `launchsim-flights-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
  }

  // ============================================
  // Component Database
  // ============================================

  initializeComponentDatabase() {
    if (typeof ComponentDatabase !== 'undefined') {
      this.componentDB = new ComponentDatabase();
      this.updateComponentManufacturers();
      
      const counts = this.componentDB.getCounts();
      log.debug('Component database loaded:', counts.total, 'components');
    }
  }

  updateComponentManufacturers() {
    const typeFilter = this.container.querySelector('#component-type-filter');
    const mfrFilter = this.container.querySelector('#component-mfr-filter');
    
    if (!typeFilter || !mfrFilter || !this.componentDB) return;
    
    const componentType = typeFilter.value;
    const components = this.componentDB.components[componentType] || [];
    
    // Get unique manufacturers
    const manufacturers = [...new Set(components.map(c => c.manufacturer).filter(m => m))];
    
    mfrFilter.innerHTML = '<option value="">All Manufacturers</option>' +
      manufacturers.map(m => `<option value="${m}">${m}</option>`).join('');
  }

  searchComponents() {
    if (!this.componentDB) {
      alert('Component Database not loaded');
      return;
    }
    
    const typeFilter = this.container.querySelector('#component-type-filter');
    const mfrFilter = this.container.querySelector('#component-mfr-filter');
    const searchInput = this.container.querySelector('#component-search');
    const resultsContainer = this.container.querySelector('#component-results');
    
    if (!resultsContainer) return;
    
    const componentType = typeFilter?.value || 'bodyTubes';
    const manufacturer = mfrFilter?.value || '';
    const searchTerm = searchInput?.value?.toLowerCase() || '';
    
    let results = this.componentDB.components[componentType] || [];
    
    if (manufacturer) {
      results = results.filter(c => c.manufacturer === manufacturer);
    }
    
    if (searchTerm) {
      results = results.filter(c => 
        c.name.toLowerCase().includes(searchTerm) ||
        c.partNumber?.toLowerCase().includes(searchTerm)
      );
    }
    
    // Limit results
    results = results.slice(0, 50);
    
    if (results.length === 0) {
      resultsContainer.innerHTML = '<p class="placeholder">No components found matching your criteria</p>';
      return;
    }
    
    resultsContainer.innerHTML = `
      <div class="component-count">${results.length} components found</div>
      <div class="component-grid">
        ${results.map(c => this.renderComponentCard(c, componentType)).join('')}
      </div>
    `;
  }

  renderComponentCard(component, type) {
    let details = '';
    
    switch (type) {
      case 'bodyTubes':
        details = `
          <span class="comp-spec">OD: ${component.outerDiameter.toFixed(1)}mm</span>
          <span class="comp-spec">ID: ${component.innerDiameter.toFixed(1)}mm</span>
          <span class="comp-spec">Length: ${component.length.toFixed(0)}mm</span>
          ${component.mass ? `<span class="comp-spec">Mass: ${component.mass.toFixed(0)}g</span>` : ''}
        `;
        break;
      case 'noseCones':
        details = `
          <span class="comp-spec">Dia: ${component.diameter.toFixed(1)}mm</span>
          <span class="comp-spec">Length: ${component.length}mm</span>
          <span class="comp-spec">Shape: ${component.shape}</span>
          ${component.mass ? `<span class="comp-spec">Mass: ${component.mass}g</span>` : ''}
        `;
        break;
      case 'finSets':
        details = `
          <span class="comp-spec">${component.count} fins</span>
          <span class="comp-spec">Root: ${component.rootChord}mm</span>
          <span class="comp-spec">Span: ${component.span}mm</span>
          <span class="comp-spec">For: ${component.forBodyDiameter}mm body</span>
        `;
        break;
      case 'parachutes':
        details = `
          <span class="comp-spec">Dia: ${component.diameter}mm (${(component.diameter/25.4).toFixed(0)}")</span>
          <span class="comp-spec">Type: ${component.type}</span>
          <span class="comp-spec">Cd: ${component.cd}</span>
          ${component.maxLoadLb ? `<span class="comp-spec">Max: ${component.maxLoadLb}lb</span>` : ''}
        `;
        break;
    }
    
    return `
      <div class="component-card" data-component-id="${component.id}">
        <div class="comp-name">${component.name}</div>
        <div class="comp-mfr">${component.manufacturer || 'Generic'}</div>
        <div class="comp-details">${details}</div>
        <button class="btn btn-small btn-secondary btn-use-component" data-type="${type}" data-id="${component.id}">
          Use Component
        </button>
      </div>
    `;
  }

  // ============================================
  // Multi-Stage Rockets
  // ============================================

  initializeMultiStage() {
    if (typeof MultiStageRocket !== 'undefined') {
      this.multiStageRocket = null;
      this.multiStageResult = null;
      log.debug('Multi-Stage module initialized');
    }
  }

  showAddStageModal(isStrapon = false) {
    const modal = this.container.querySelector('#add-stage-modal');
    if (modal) {
      modal.style.display = 'flex';
      modal.dataset.isStrapon = isStrapon;
      
      // Update title
      const title = modal.querySelector('.modal-header h3');
      if (title) {
        title.textContent = isStrapon ? '➕ Add Strap-on Booster' : '➕ Add Stage';
      }
      
      // Pre-fill stage number
      const nameInput = modal.querySelector('input[name="stageName"]');
      if (nameInput && this.multiStageRocket) {
        const num = isStrapon ? 
          this.multiStageRocket.strapons.length + 1 :
          this.multiStageRocket.stages.length + 1;
        nameInput.value = isStrapon ? `Booster ${num}` : `Stage ${num}`;
      }
      
      // Default type based on stage number
      const typeSelect = modal.querySelector('select[name="stageType"]');
      if (typeSelect && !isStrapon && this.multiStageRocket) {
        if (this.multiStageRocket.stages.length === 0) {
          typeSelect.value = 'booster';
        } else {
          typeSelect.value = 'sustainer';
        }
      }
    }
  }

  hideAddStageModal() {
    const modal = this.container.querySelector('#add-stage-modal');
    if (modal) {
      modal.style.display = 'none';
    }
  }

  addStageFromForm(form) {
    if (typeof MultiStageRocket === 'undefined' || typeof Stage === 'undefined') {
      alert('Multi-Stage module not loaded');
      return;
    }
    
    // Create rocket if needed
    if (!this.multiStageRocket) {
      const nameInput = this.container.querySelector('#multistage-name');
      this.multiStageRocket = new MultiStageRocket({ 
        name: nameInput?.value || 'Multi-Stage Rocket' 
      });
    }
    
    const formData = new FormData(form);
    const isStrapon = this.container.querySelector('#add-stage-modal')?.dataset.isStrapon === 'true';
    
    // Create motor
    const motor = new StageMotor({
      designation: formData.get('motorDesignation'),
      totalImpulse: parseFloat(formData.get('totalImpulse')),
      burnTime: parseFloat(formData.get('burnTime')),
      propellantMass: parseFloat(formData.get('propellantMass')),
      totalMass: parseFloat(formData.get('motorMass'))
    });
    
    const stageConfig = {
      name: formData.get('stageName'),
      type: formData.get('stageType'),
      length: parseFloat(formData.get('length')),
      bodyDiameter: parseFloat(formData.get('bodyDiameter')) / 1000, // Convert mm to m
      dryMass: parseFloat(formData.get('dryMass')),
      motor,
      motorMass: parseFloat(formData.get('motorMass')),
      propellantMass: parseFloat(formData.get('propellantMass')),
      hasFins: form.querySelector('input[name="hasFins"]')?.checked || false,
      hasNoseCone: form.querySelector('input[name="hasNoseCone"]')?.checked || false,
      finCount: parseInt(formData.get('finCount')) || 4,
      separationTrigger: formData.get('separationTrigger'),
      separationDelay: parseFloat(formData.get('separationDelay')) || 0,
      ignitionTrigger: formData.get('ignitionTrigger'),
      ignitionDelay: parseFloat(formData.get('ignitionDelay')) || 0
    };
    
    if (isStrapon) {
      this.multiStageRocket.addStrapon(stageConfig);
    } else {
      this.multiStageRocket.addStage(stageConfig);
    }
    
    this.hideAddStageModal();
    this.updateMultiStageDisplay();
    
    // Reset form for next stage
    form.reset();
  }

  loadMultiStagePreset(presetName) {
    if (typeof PRESET_CONFIGS === 'undefined' || !PRESET_CONFIGS[presetName]) {
      alert('Preset not found');
      return;
    }
    
    this.multiStageRocket = PRESET_CONFIGS[presetName]();
    
    // Update name input
    const nameInput = this.container.querySelector('#multistage-name');
    if (nameInput) {
      nameInput.value = this.multiStageRocket.name;
    }
    
    this.updateMultiStageDisplay();
  }

  updateMultiStageDisplay() {
    this.renderStagesContainer();
    this.renderStageStackVisual();
    this.updateStageStats();
  }

  renderStagesContainer() {
    const container = this.container.querySelector('#stages-container');
    if (!container || !this.multiStageRocket) return;
    
    if (this.multiStageRocket.stages.length === 0 && this.multiStageRocket.strapons.length === 0) {
      container.innerHTML = '<p class="placeholder">No stages added. Click "Add Stage" or load a preset to begin.</p>';
      return;
    }
    
    let html = '';
    
    // Render stages (bottom to top for display)
    [...this.multiStageRocket.stages].reverse().forEach((stage, idx) => {
      const realIdx = this.multiStageRocket.stages.length - 1 - idx;
      html += this.renderStageCard(stage, realIdx, false);
    });
    
    // Render strap-ons
    if (this.multiStageRocket.strapons.length > 0) {
      html += '<div class="strapon-section"><h4>🔗 Strap-on Boosters</h4>';
      this.multiStageRocket.strapons.forEach((booster, idx) => {
        html += this.renderStageCard(booster, idx, true);
      });
      html += '</div>';
    }
    
    container.innerHTML = html;
    
    // Add remove button listeners
    container.querySelectorAll('.btn-remove-stage').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.index);
        const isStrapon = e.target.dataset.strapon === 'true';
        this.removeStage(idx, isStrapon);
      });
    });
  }

  renderStageCard(stage, index, isStrapon) {
    const typeIcons = {
      'booster': '🔥',
      'sustainer': '🚀',
      'upper': '⬆️',
      'strapon': '🔗'
    };
    
    const icon = typeIcons[stage.type] || '📦';
    
    return `
      <div class="stage-card ${isStrapon ? 'strapon' : ''}" data-stage-index="${index}">
        <div class="stage-card-header">
          <span class="stage-icon">${icon}</span>
          <span class="stage-name">${stage.name}</span>
          <span class="stage-type">${stage.type}</span>
          <button class="btn btn-small btn-danger btn-remove-stage" data-index="${index}" data-strapon="${isStrapon}">✕</button>
        </div>
        <div class="stage-card-body">
          <div class="stage-specs">
            <span class="spec">📏 ${(stage.length * 100).toFixed(0)}cm</span>
            <span class="spec">⚖️ ${stage.dryMass.toFixed(2)}kg</span>
            <span class="spec">🔧 ${stage.motor?.designation || 'No motor'}</span>
          </div>
          <div class="stage-triggers">
            <span class="trigger">🔥 ${stage.ignitionTrigger}</span>
            ${!isStrapon && index < this.multiStageRocket.stages.length - 1 ? 
              `<span class="trigger">✂️ ${stage.separationTrigger}` + 
              (stage.separationDelay > 0 ? ` +${stage.separationDelay}s` : '') + '</span>' : ''}
          </div>
        </div>
      </div>
    `;
  }

  removeStage(index, isStrapon) {
    if (!this.multiStageRocket) return;
    
    if (isStrapon) {
      this.multiStageRocket.strapons.splice(index, 1);
    } else {
      this.multiStageRocket.stages.splice(index, 1);
      // Renumber remaining stages
      this.multiStageRocket.stages.forEach((s, i) => {
        s.stageNumber = i + 1;
      });
    }
    
    this.updateMultiStageDisplay();
  }

  renderStageStackVisual() {
    const container = this.container.querySelector('#stage-stack-visual');
    if (!container || !this.multiStageRocket) return;
    
    if (this.multiStageRocket.stages.length === 0) {
      container.innerHTML = '<p class="placeholder">Add stages to see visual representation</p>';
      return;
    }
    
    const totalLength = this.multiStageRocket.getTotalLength();
    const maxWidth = 200;
    const scale = 400 / Math.max(totalLength, 1);
    
    let html = '<div class="stage-stack">';
    
    // Render from top (sustainer) to bottom (booster)
    const stages = [...this.multiStageRocket.stages].reverse();
    
    stages.forEach((stage, idx) => {
      const height = stage.length * scale;
      const width = (stage.bodyDiameter / 0.1) * 40; // Scale diameter
      
      const isTop = idx === 0;
      const isBottom = idx === stages.length - 1;
      
      html += `
        <div class="visual-stage" style="height: ${height}px; width: ${Math.min(width, maxWidth)}px;">
          ${isTop && stage.hasNoseCone ? '<div class="nose-cone"></div>' : ''}
          <div class="stage-body ${isBottom && stage.hasFins ? 'with-fins' : ''}">
            <span class="stage-label">${stage.name}</span>
          </div>
        </div>
      `;
    });
    
    // Render strap-ons
    if (this.multiStageRocket.strapons.length > 0) {
      html += '<div class="strapons-visual">';
      this.multiStageRocket.strapons.forEach(b => {
        const height = b.length * scale;
        html += `<div class="visual-strapon" style="height: ${height}px;"></div>`;
      });
      html += '</div>';
    }
    
    html += '</div>';
    container.innerHTML = html;
  }

  updateStageStats() {
    if (!this.multiStageRocket) return;
    
    const lengthEl = this.container.querySelector('#total-length');
    const massEl = this.container.querySelector('#total-mass');
    const stabilityEl = this.container.querySelector('#stability-margin');
    
    if (lengthEl) {
      lengthEl.textContent = `${(this.multiStageRocket.getTotalLength() * 100).toFixed(1)} cm`;
    }
    
    if (massEl) {
      massEl.textContent = `${this.multiStageRocket.getTotalMass().toFixed(2)} kg`;
    }
    
    if (stabilityEl) {
      const margin = this.multiStageRocket.getStabilityMargin();
      const status = margin >= 1.5 ? '✅' : margin >= 1 ? '⚠️' : '❌';
      stabilityEl.textContent = `${status} ${margin.toFixed(2)} cal`;
    }
  }

  runMultiStageSimulation() {
    if (!this.multiStageRocket || this.multiStageRocket.stages.length === 0) {
      alert('Please add at least one stage before running simulation');
      return;
    }
    
    // Get simulation parameters
    const launchAngle = parseFloat(this.container.querySelector('#ms-launch-angle')?.value || '5');
    const maxTime = parseFloat(this.container.querySelector('#ms-max-time')?.value || '120');
    
    this.multiStageRocket.launchAngle = launchAngle;
    
    // Run simulation
    try {
      this.multiStageResult = this.multiStageRocket.simulate({ maxTime });
      this.displayMultiStageResults();
    } catch (error) {
      alert(`Simulation error: ${error.message}`);
      console.error(error);
    }
  }

  displayMultiStageResults() {
    const resultsSection = this.container.querySelector('#multistage-results');
    if (!resultsSection || !this.multiStageResult) return;
    
    resultsSection.style.display = 'block';
    
    // Get unit labels
    const altUnit = this.getUnitLabel('m');
    const velUnit = this.getUnitLabel('m/s');
    
    // Summary
    const summaryEl = this.container.querySelector('#ms-results-summary');
    if (summaryEl) {
      const r = this.multiStageResult;
      const maxAlt = this.convertFromMetric(r.maxAltitude, 'm');
      const maxVel = this.convertFromMetric(r.maxVelocity, 'm/s');
      
      summaryEl.innerHTML = `
        <div class="results-grid">
          <div class="result-card" data-metric-value="${r.maxAltitude}" data-metric-unit="m" data-decimals="0">
            <span class="result-value">${maxAlt.toFixed(0)}</span>
            <span class="result-label">Max Altitude (${altUnit})</span>
          </div>
          <div class="result-card" data-metric-value="${r.maxVelocity}" data-metric-unit="m/s" data-decimals="1">
            <span class="result-value">${maxVel.toFixed(1)}</span>
            <span class="result-label">Max Velocity (${velUnit})</span>
          </div>
          <div class="result-card">
            <span class="result-value">${r.maxMach.toFixed(2)}</span>
            <span class="result-label">Max Mach</span>
          </div>
          <div class="result-card">
            <span class="result-value">${r.flightTime.toFixed(1)}</span>
            <span class="result-label">Flight Time (s)</span>
          </div>
          <div class="result-card">
            <span class="result-value">${(r.maxAcceleration / 9.81).toFixed(1)}</span>
            <span class="result-label">Max Accel (G)</span>
          </div>
          <div class="result-card">
            <span class="result-value">${r.apogeeTime.toFixed(1)}</span>
            <span class="result-label">Apogee Time (s)</span>
          </div>
        </div>
      `;
    }
    
    // Event timeline
    const timelineEl = this.container.querySelector('#ms-event-timeline');
    if (timelineEl) {
      const eventIcons = {
        'LIFTOFF': '🚀',
        'IGNITION': '🔥',
        'SEPARATION': '✂️',
        'BOOSTER_SEPARATION': '🔗',
        'APOGEE': '🎯',
        'LANDING': '🪂'
      };
      
      timelineEl.innerHTML = this.multiStageResult.events.map(e => {
        const alt = this.convertFromMetric(e.altitude, 'm');
        return `
          <div class="timeline-event ${e.type.toLowerCase()}">
            <span class="event-icon">${eventIcons[e.type] || '📌'}</span>
            <span class="event-time">${e.time.toFixed(2)}s</span>
            <span class="event-type">${e.type}</span>
            ${e.stage ? `<span class="event-stage">${e.stage}</span>` : ''}
            <span class="event-altitude">${alt.toFixed(0)} ${altUnit}</span>
          </div>
        `;
      }).join('');
    }
    
    // Draw trajectory chart
    this.drawMultiStageTrajectory();
    
    // Stage trajectories (separated stages)
    const stageTrajectories = this.container.querySelector('#ms-stage-trajectories');
    if (stageTrajectories && this.multiStageResult.stageTrajectories.length > 0) {
      stageTrajectories.innerHTML = `
        <h4>🔄 Separated Stage Trajectories</h4>
        ${this.multiStageResult.stageTrajectories.map(st => {
          const sepAlt = this.convertFromMetric(st.separationAltitude, 'm');
          const impactVel = this.convertFromMetric(st.impactVelocity, 'm/s');
          return `
            <div class="separated-stage-info">
              <strong>${st.stage}</strong>: 
              Separated at ${sepAlt.toFixed(0)} ${altUnit}, 
              Landing at ${st.landingTime.toFixed(1)}s
              (Impact: ${impactVel.toFixed(1)} ${velUnit})
            </div>
          `;
        }).join('')}
      `;
    }
  }

  drawMultiStageTrajectory() {
    const canvas = this.container.querySelector('#ms-trajectory-canvas');
    if (!canvas || !this.multiStageResult) return;
    
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = 50;
    
    // Unit conversion
    const altUnit = this.getUnitLabel('m');
    const altConv = this.units === 'metric' ? 1 : 3.28084;
    
    // Clear
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, width, height);
    
    const trajectory = this.multiStageResult.trajectory;
    if (trajectory.length === 0) return;
    
    const maxAlt = this.multiStageResult.maxAltitude * 1.1;
    const maxTime = trajectory[trajectory.length - 1].time;
    
    const xScale = (width - padding * 2) / maxTime;
    const yScale = (height - padding * 2) / maxAlt;
    
    // Draw grid
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    
    for (let i = 0; i <= 5; i++) {
      const y = padding + (height - padding * 2) * i / 5;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();
      
      ctx.fillStyle = '#666';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      const altValue = ((5 - i) * maxAlt / 5) * altConv;
      ctx.fillText(`${altValue.toFixed(0)}${altUnit}`, padding - 5, y + 3);
    }
    
    // Draw staging events
    this.multiStageResult.events.forEach(e => {
      if (e.type === 'SEPARATION' || e.type === 'IGNITION') {
        const x = padding + e.time * xScale;
        ctx.strokeStyle = e.type === 'SEPARATION' ? '#f44336' : '#ff9800';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, padding);
        ctx.lineTo(x, height - padding);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Label
        ctx.fillStyle = e.type === 'SEPARATION' ? '#f44336' : '#ff9800';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(e.type === 'SEPARATION' ? 'SEP' : 'IGN', x, padding - 5);
      }
    });
    
    // Draw trajectory by phase
    const phaseColors = {
      'powered': '#4caf50',
      'coasting': '#2196f3',
      'descent': '#9c27b0'
    };
    
    let currentPhase = null;
    ctx.lineWidth = 2;
    
    trajectory.forEach((point, i) => {
      const x = padding + point.time * xScale;
      const y = height - padding - point.altitude * yScale;
      
      if (point.phase !== currentPhase) {
        if (currentPhase !== null) {
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.strokeStyle = phaseColors[point.phase] || '#333';
        ctx.moveTo(x, y);
        currentPhase = point.phase;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    
    // Draw apogee marker
    const apogee = this.multiStageResult.events.find(e => e.type === 'APOGEE');
    if (apogee) {
      const x = padding + apogee.time * xScale;
      const y = height - padding - apogee.altitude * yScale;
      
      ctx.fillStyle = '#f44336';
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.fillStyle = '#333';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      const apogeeAlt = apogee.altitude * altConv;
      ctx.fillText(`${apogeeAlt.toFixed(0)}${altUnit}`, x, y - 10);
    }
    
    // Axes labels
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Time (s)', width / 2, height - 10);
    
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`Altitude (${altUnit})`, 0, 0);
    ctx.restore();
    
    // Legend
    ctx.font = '10px sans-serif';
    const legendY = height - 15;
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(padding, legendY, 15, 10);
    ctx.fillStyle = '#333';
    ctx.fillText('Powered', padding + 20, legendY + 8);
    
    ctx.fillStyle = '#2196f3';
    ctx.fillRect(padding + 70, legendY, 15, 10);
    ctx.fillStyle = '#333';
    ctx.fillText('Coast', padding + 90, legendY + 8);
    
    ctx.fillStyle = '#9c27b0';
    ctx.fillRect(padding + 130, legendY, 15, 10);
    ctx.fillStyle = '#333';
    ctx.fillText('Descent', padding + 150, legendY + 8);
  }

  // ============================================
  // Recovery Tab
  // ============================================

  initializeRecoveryTab() {
    // Recovery Planner
    const calcRecoveryBtn = this.container.querySelector('#btn-calc-recovery');
    calcRecoveryBtn?.addEventListener('click', () => this.calculateRecoveryPlan());

    // Wind Profile
    const windDirInput = this.container.querySelector('#wind-ground-dir');
    windDirInput?.addEventListener('input', () => this.updateWindDirectionIndicator());
    
    const windSpeedInput = this.container.querySelector('#wind-ground-speed');
    windSpeedInput?.addEventListener('input', () => this.drawWindProfile());
    
    const addWindLayerBtn = this.container.querySelector('#btn-add-wind-layer');
    addWindLayerBtn?.addEventListener('click', () => this.addWindLayer());

    // Drogue delay toggle
    const drogueEventSelect = this.container.querySelector('#dd-drogue-event');
    drogueEventSelect?.addEventListener('change', (e) => {
      const delayRow = this.container.querySelector('#drogue-delay-row');
      if (delayRow) {
        delayRow.style.display = e.target.value === 'delay' ? 'flex' : 'none';
      }
    });

    // Dual Deploy Simulation
    const runDualDeployBtn = this.container.querySelector('#btn-run-dual-deploy');
    runDualDeployBtn?.addEventListener('click', () => this.runDualDeploySimulation());

    // Initialize wind profile
    this.windLayers = [];
    this.drawWindProfile();
    this.updateWindDirectionIndicator();
    
    log.debug('Recovery tab initialized');
  }

  calculateRecoveryPlan() {
    if (typeof RecoveryPlanner === 'undefined') {
      alert('Recovery Planner module not loaded');
      return;
    }

    const mass = parseFloat(this.container.querySelector('#recovery-mass')?.value || 1500);
    const apogee = parseFloat(this.container.querySelector('#recovery-apogee')?.value || 2500);
    const targetLanding = parseFloat(this.container.querySelector('#recovery-landing-vel')?.value || 15);
    const targetDrogue = parseFloat(this.container.querySelector('#recovery-drogue-vel')?.value || 75);
    const mainAlt = parseFloat(this.container.querySelector('#recovery-main-alt')?.value || 500);

    const plan = RecoveryPlanner.plan(
      { dryMass: mass },
      apogee,
      {
        targetDrogueRate: targetDrogue,
        targetLandingVelocity: targetLanding,
        mainDeployAltitude: mainAlt
      }
    );

    this.displayRecoveryPlan(plan);
  }

  displayRecoveryPlan(plan) {
    const resultsDiv = this.container.querySelector('#planner-results');
    const cardsDiv = this.container.querySelector('#recommendation-cards');
    const notesDiv = this.container.querySelector('#planner-notes');

    if (!resultsDiv || !cardsDiv || !notesDiv) return;

    resultsDiv.style.display = 'block';

    // Recommendation cards
    let cardsHtml = '';

    if (plan.recommendDualDeploy && plan.drogue) {
      cardsHtml += `
        <div class="rec-card drogue-rec">
          <div class="rec-icon">🔴</div>
          <div class="rec-title">Drogue Parachute</div>
          <div class="rec-value">${plan.drogue.diameter} mm</div>
          <div class="rec-detail">${plan.drogue.type} - ${plan.drogue.expectedDescentRate} ft/s</div>
        </div>
      `;
    }

    cardsHtml += `
      <div class="rec-card main-rec">
        <div class="rec-icon">🟢</div>
        <div class="rec-title">Main Parachute</div>
        <div class="rec-value">${plan.main.diameter} mm</div>
        <div class="rec-detail">${plan.main.type} - ${plan.main.expectedLandingVelocity} ft/s landing</div>
      </div>
    `;

    cardsHtml += `
      <div class="rec-card deploy-rec">
        <div class="rec-icon">📍</div>
        <div class="rec-title">Main Deploy</div>
        <div class="rec-value">${plan.mainDeployAltitude} ft</div>
        <div class="rec-detail">${plan.recommendDualDeploy ? 'Dual Deploy Recommended' : 'Single Deploy OK'}</div>
      </div>
    `;

    if (plan.estimatedDriftAtApogee) {
      cardsHtml += `
        <div class="rec-card drift-rec">
          <div class="rec-icon">🎯</div>
          <div class="rec-title">Est. Total Drift</div>
          <div class="rec-value">${Math.round(plan.estimatedDriftAtApogee.totalDriftFeet)} ft</div>
          <div class="rec-detail">${Math.round(plan.estimatedDriftAtApogee.totalDriftMeters)} m @ 10mph wind</div>
        </div>
      `;
    }

    cardsDiv.innerHTML = cardsHtml;

    // Notes
    let notesHtml = '<ul class="planner-notes-list">';
    plan.notes.forEach(note => {
      notesHtml += `<li>${note}</li>`;
    });
    notesHtml += '</ul>';

    // Auto-fill dual deploy config
    notesHtml += `
      <button class="btn btn-secondary btn-small" id="btn-apply-plan">
        ✅ Apply to Dual Deploy Config
      </button>
    `;

    notesDiv.innerHTML = notesHtml;

    // Add apply button listener
    const applyBtn = this.container.querySelector('#btn-apply-plan');
    applyBtn?.addEventListener('click', () => {
      if (plan.drogue) {
        const drogueInput = this.container.querySelector('#dd-drogue-dia');
        if (drogueInput) drogueInput.value = plan.drogue.diameter;
      }
      const mainInput = this.container.querySelector('#dd-main-dia');
      if (mainInput) mainInput.value = plan.main.diameter;
      
      const mainAltSelect = this.container.querySelector('#dd-main-deploy-alt');
      if (mainAltSelect) mainAltSelect.value = plan.mainDeployAltitude;
      
      const massInput = this.container.querySelector('#dd-rocket-mass');
      const recoveryMass = this.container.querySelector('#recovery-mass');
      if (massInput && recoveryMass) massInput.value = recoveryMass.value;
      
      const apogeeInput = this.container.querySelector('#dd-apogee');
      const recoveryApogee = this.container.querySelector('#recovery-apogee');
      if (apogeeInput && recoveryApogee) apogeeInput.value = recoveryApogee.value;
    });
  }

  updateWindDirectionIndicator() {
    const dirInput = this.container.querySelector('#wind-ground-dir');
    const indicator = this.container.querySelector('#wind-dir-indicator');
    
    if (!dirInput || !indicator) return;
    
    const degrees = parseInt(dirInput.value) || 0;
    const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    const index = Math.round(((degrees + 360) % 360) / 22.5) % 16;
    indicator.textContent = dirs[index];
    
    this.drawWindProfile();
  }

  addWindLayer() {
    const layerList = this.container.querySelector('#wind-layer-list');
    if (!layerList) return;

    const layerId = this.windLayers.length;
    
    const layerHtml = `
      <div class="wind-layer" data-layer-id="${layerId}">
        <div class="form-row">
          <label>Altitude (ft)</label>
          <input type="number" class="layer-altitude" value="${(layerId + 1) * 1000}" min="0" max="50000" step="100">
        </div>
        <div class="form-row">
          <label>Speed (m/s)</label>
          <input type="number" class="layer-speed" value="${5 + layerId * 2}" min="0" max="50" step="0.5">
        </div>
        <div class="form-row">
          <label>Dir (°)</label>
          <input type="number" class="layer-dir" value="270" min="0" max="359" step="5">
        </div>
        <button class="btn btn-small btn-danger btn-remove-layer">✕</button>
      </div>
    `;

    // Replace info message if present
    const infoDiv = layerList.querySelector('.wind-layer-info');
    if (infoDiv) infoDiv.remove();

    layerList.insertAdjacentHTML('beforeend', layerHtml);

    // Add remove listener
    const newLayer = layerList.querySelector(`[data-layer-id="${layerId}"]`);
    const removeBtn = newLayer?.querySelector('.btn-remove-layer');
    removeBtn?.addEventListener('click', () => {
      newLayer.remove();
      this.drawWindProfile();
    });

    // Add change listeners
    newLayer?.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', () => this.drawWindProfile());
    });

    this.windLayers.push({ id: layerId });
    this.drawWindProfile();
  }

  getWindProfile() {
    const groundSpeed = parseFloat(this.container.querySelector('#wind-ground-speed')?.value || 5);
    const groundDir = parseFloat(this.container.querySelector('#wind-ground-dir')?.value || 270);
    const gustFactor = parseFloat(this.container.querySelector('#wind-gust-factor')?.value || 1.3);

    // Check for custom layers
    const layerElements = this.container.querySelectorAll('.wind-layer');
    const customLayers = [];

    layerElements.forEach(el => {
      const altitude = parseFloat(el.querySelector('.layer-altitude')?.value || 0);
      const speed = parseFloat(el.querySelector('.layer-speed')?.value || 0);
      const dir = parseFloat(el.querySelector('.layer-dir')?.value || 0);
      customLayers.push({ altitude, speed, direction: dir });
    });

    if (typeof WindProfile !== 'undefined') {
      const profile = new WindProfile({
        groundSpeed,
        groundDirection: groundDir,
        gustFactor
      });
      profile.customLayers = customLayers;
      return profile;
    }

    return { groundSpeed, groundDirection: groundDir, gustFactor, customLayers };
  }

  drawWindProfile() {
    const canvas = this.container.querySelector('#wind-profile-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = 40;

    // Unit conversions
    const altUnit = this.units === 'metric' ? 'm' : 'ft';
    const windUnit = this.getUnitLabel('m/s');
    const altConv = this.units === 'metric' ? 0.3048 : 1; // Convert internal ft to display unit

    // Clear
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, width, height);

    const groundSpeed = parseFloat(this.container.querySelector('#wind-ground-speed')?.value || 5);
    const maxAltFt = 5000; // Internal altitude in ft
    const maxSpeed = Math.max(groundSpeed * 2, 15);

    const xScale = (width - padding * 2) / maxSpeed;
    const yScale = (height - padding * 2) / maxAltFt;

    // Draw grid
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 5; i++) {
      const altFt = i * maxAltFt / 5;
      const y = height - padding - altFt * yScale;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();

      ctx.fillStyle = '#666';
      ctx.font = '9px sans-serif';
      ctx.textAlign = 'right';
      const displayAlt = (altFt * altConv).toFixed(0);
      ctx.fillText(`${displayAlt}${altUnit}`, padding - 3, y + 3);
    }

    // Draw wind profile (power law)
    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth = 2;
    ctx.beginPath();

    for (let alt = 0; alt <= maxAltFt; alt += 100) {
      const speed = groundSpeed * Math.pow((alt * 0.3048 + 10) / 10, 0.143);
      const x = padding + speed * xScale;
      const y = height - padding - alt * yScale;

      if (alt === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Draw custom layers
    const layerElements = this.container.querySelectorAll('.wind-layer');
    if (layerElements.length > 0) {
      ctx.strokeStyle = '#ff9800';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 3]);
      ctx.beginPath();

      let firstPoint = true;
      const sortedLayers = [];
      
      layerElements.forEach(el => {
        const alt = parseFloat(el.querySelector('.layer-altitude')?.value || 0);
        const speed = parseFloat(el.querySelector('.layer-speed')?.value || 0);
        sortedLayers.push({ alt, speed });
      });
      
      sortedLayers.sort((a, b) => a.alt - b.alt);
      sortedLayers.unshift({ alt: 0, speed: groundSpeed });

      sortedLayers.forEach(layer => {
        const x = padding + layer.speed * xScale;
        const y = height - padding - layer.alt * yScale;
        
        if (firstPoint) {
          ctx.moveTo(x, y);
          firstPoint = false;
        } else {
          ctx.lineTo(x, y);
        }
      });

      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Labels - use current unit system
    
    ctx.fillStyle = '#333';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Wind Speed (${windUnit})`, width / 2, height - 5);

    ctx.save();
    ctx.translate(10, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`Altitude (${altUnit})`, 0, 0);
    ctx.restore();
  }

  runDualDeploySimulation() {
    if (typeof DualDeploySimulation === 'undefined' || typeof RecoveryConfig === 'undefined') {
      alert('Dual Deploy module not loaded');
      return;
    }

    // Get configuration
    const drogeDia = parseFloat(this.container.querySelector('#dd-drogue-dia')?.value || 450);
    const drogueType = this.container.querySelector('#dd-drogue-type')?.value || 'cruciform';
    const mainDia = parseFloat(this.container.querySelector('#dd-main-dia')?.value || 1200);
    const mainType = this.container.querySelector('#dd-main-type')?.value || 'round';
    const mainDeployAlt = parseFloat(this.container.querySelector('#dd-main-deploy-alt')?.value || 500);
    const backupAlt = parseFloat(this.container.querySelector('#dd-backup-alt')?.value || 300);
    const rocketMass = parseFloat(this.container.querySelector('#dd-rocket-mass')?.value || 1500);
    const apogee = parseFloat(this.container.querySelector('#dd-apogee')?.value || 3000);

    const drogueEvent = this.container.querySelector('#dd-drogue-event')?.value || 'apogee';
    const drogueDelay = drogueEvent === 'delay' ? 
      parseFloat(this.container.querySelector('#dd-drogue-delay')?.value || 0) : 0;

    // Create recovery config
    const recovery = new RecoveryConfig({
      drogue: {
        diameter: drogeDia,
        type: drogueType
      },
      main: {
        diameter: mainDia,
        type: mainType,
        deploymentAltitude: mainDeployAlt
      },
      mainDeployAltitude: mainDeployAlt,
      drogueDelay: drogueDelay,
      backupMainAltitude: backupAlt
    });

    // Create rocket config
    const rocket = {
      dryMass: rocketMass,
      drogueChute: { diameter: drogeDia, type: drogueType },
      mainChute: { diameter: mainDia, type: mainType }
    };

    // Get wind profile
    const windProfile = this.getWindProfile();

    // Run simulation
    const sim = new DualDeploySimulation(rocket, recovery);
    
    try {
      const results = sim.simulate(apogee, windProfile);
      // Store results for unit updates
      this.lastDualDeployResult = results;
      this.lastDualDeploySim = sim;
      this.displayDualDeployResults(results, sim);
    } catch (error) {
      console.error('Dual deploy simulation error:', error);
      alert(`Simulation error: ${error.message}`);
    }
  }

  displayDualDeployResults(results, sim) {
    const resultsSection = this.container.querySelector('#dual-deploy-results');
    if (!resultsSection) return;

    resultsSection.style.display = 'block';

    // Get unit labels - recovery typically uses ft in US, but respect user preference
    const altUnit = this.units === 'metric' ? 'm' : 'ft';
    const velUnit = this.units === 'metric' ? 'm/s' : 'ft/s';
    const distUnit = this.units === 'metric' ? 'm' : 'ft';
    
    // Conversion factors (recovery data is in ft/fps internally)
    const altConv = this.units === 'metric' ? 0.3048 : 1;  // ft to m or keep ft
    const velConv = this.units === 'metric' ? 0.3048 : 1;  // fps to mps or keep fps
    const distConv = this.units === 'metric' ? 1 : 3.28084; // m to ft or keep m

    // Summary
    const summaryDiv = this.container.querySelector('#dd-results-summary');
    if (summaryDiv) {
      const landingVel = results.totals.landingVelocityFps * velConv;
      const drift = results.totals.totalDriftMeters * distConv;
      
      summaryDiv.innerHTML = `
        <div class="dd-summary-grid">
          <div class="dd-summary-card">
            <span class="dd-value">${results.totals.totalDescentTime.toFixed(1)}</span>
            <span class="dd-label">Total Time (s)</span>
          </div>
          <div class="dd-summary-card">
            <span class="dd-value">${landingVel.toFixed(1)}</span>
            <span class="dd-label">Landing (${velUnit})</span>
          </div>
          <div class="dd-summary-card">
            <span class="dd-value">${results.totals.kineticEnergyJoules.toFixed(1)}</span>
            <span class="dd-label">KE (Joules)</span>
          </div>
          <div class="dd-summary-card">
            <span class="dd-value">${drift.toFixed(0)}</span>
            <span class="dd-label">Drift (${distUnit})</span>
          </div>
        </div>
      `;
    }

    // Timeline
    const timelineDiv = this.container.querySelector('#recovery-timeline');
    if (timelineDiv) {
      let timelineHtml = '';
      
      results.events.forEach(event => {
        const icons = {
          'APOGEE': '🎯',
          'DROGUE_DEPLOY': '🔴',
          'MAIN_DEPLOY': '🟢',
          'LANDING': '🏁'
        };
        
        const eventAlt = event.altitude * altConv;
        const eventVel = event.velocity ? event.velocity * velConv : null;
        
        timelineHtml += `
          <div class="timeline-item ${event.type.toLowerCase()}">
            <span class="timeline-icon">${icons[event.type] || '📌'}</span>
            <span class="timeline-time">${event.time.toFixed(1)}s</span>
            <span class="timeline-type">${event.type.replace('_', ' ')}</span>
            <span class="timeline-altitude">${eventAlt.toFixed(0)} ${altUnit}</span>
            ${eventVel !== null ? `<span class="timeline-velocity">${eventVel.toFixed(1)} ${velUnit}</span>` : ''}
          </div>
        `;
      });
      
      timelineDiv.innerHTML = timelineHtml;
    }

    // Phase cards
    const phasesDiv = this.container.querySelector('#phase-cards');
    if (phasesDiv && results.phases) {
      let phasesHtml = '';
      
      results.phases.forEach(phase => {
        const isDrogue = phase.name.toLowerCase().includes('drogue');
        const icon = isDrogue ? '🔴' : '🟢';
        const descentRate = phase.descentRate * velConv;
        const startAlt = phase.startAltitude * altConv;
        const endAlt = phase.endAltitude * altConv;
        const drift = (phase.driftDistance || 0) * distConv;
        
        phasesHtml += `
          <div class="phase-card ${isDrogue ? 'drogue' : 'main'}">
            <div class="phase-header">
              <span class="phase-icon">${icon}</span>
              <span class="phase-name">${phase.name}</span>
            </div>
            <div class="phase-stats">
              <div class="phase-stat">
                <span class="label">Duration:</span>
                <span class="value">${phase.duration.toFixed(1)}s</span>
              </div>
              <div class="phase-stat">
                <span class="label">Descent Rate:</span>
                <span class="value">${descentRate.toFixed(1)} ${velUnit}</span>
              </div>
              <div class="phase-stat">
                <span class="label">Altitude:</span>
                <span class="value">${startAlt.toFixed(0)} → ${endAlt.toFixed(0)} ${altUnit}</span>
              </div>
              <div class="phase-stat">
                <span class="label">Drift:</span>
                <span class="value">${drift.toFixed(0)} ${distUnit}</span>
              </div>
            </div>
          </div>
        `;
      });
      
      phasesDiv.innerHTML = phasesHtml;
    }

    // Safety assessment
    const safetyDiv = this.container.querySelector('#dd-safety');
    if (safetyDiv) {
      const safety = sim.assessSafety(results);
      
      const statusColors = {
        'safe': '#4caf50',
        'warning': '#ff9800',
        'danger': '#f44336'
      };
      
      let safetyHtml = `
        <div class="safety-banner" style="background: ${statusColors[safety.level]}; color: white; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
          <h4 style="margin: 0 0 10px;">
            ${safety.safe ? '✅ Recovery Configuration OK' : '⚠️ Safety Issues Detected'}
          </h4>
      `;
      
      if (safety.issues.length > 0) {
        safetyHtml += '<ul style="margin: 0; padding-left: 20px;">';
        safety.issues.forEach(issue => {
          safetyHtml += `<li>${issue}</li>`;
        });
        safetyHtml += '</ul>';
      }
      
      safetyHtml += '</div>';
      
      if (safety.warnings.length > 0) {
        safetyHtml += '<div class="safety-warnings" style="background: #fff3e0; padding: 10px; border-radius: 8px; margin-bottom: 15px;">';
        safetyHtml += '<h5 style="margin: 0 0 8px;">⚠️ Warnings</h5><ul style="margin: 0; padding-left: 20px;">';
        safety.warnings.forEach(warn => {
          safetyHtml += `<li>${warn}</li>`;
        });
        safetyHtml += '</ul></div>';
      }
      
      if (safety.recommendations.length > 0) {
        safetyHtml += '<div class="safety-recs" style="background: #e3f2fd; padding: 10px; border-radius: 8px;">';
        safetyHtml += '<h5 style="margin: 0 0 8px;">💡 Recommendations</h5><ul style="margin: 0; padding-left: 20px;">';
        safety.recommendations.forEach(rec => {
          safetyHtml += `<li>${rec.message}</li>`;
        });
        safetyHtml += '</ul></div>';
      }
      
      safetyDiv.innerHTML = safetyHtml;
    }

    // Draw descent profile
    this.drawDescentProfile(results);

    // Draw drift map
    this.drawDriftMap(results);

    // Altimeter settings
    const altimeterDiv = this.container.querySelector('#altimeter-settings');
    if (altimeterDiv) {
      const settings = sim.getAltimeterSettings();
      
      let altHtml = `
        <div class="altimeter-config">
          <h5>${settings.type === 'DUAL_DEPLOY' ? '⚙️ Dual Deploy Settings' : '⚙️ Single Deploy Settings'}</h5>
      `;
      
      if (settings.type === 'DUAL_DEPLOY') {
        altHtml += `
          <div class="alt-setting">
            <span class="alt-label">Drogue:</span>
            <span class="alt-value">${settings.droguePrimaryEvent}${settings.drogueDelay > 0 ? ` + ${settings.drogueDelay}s delay` : ''}</span>
          </div>
          <div class="alt-setting">
            <span class="alt-label">Main:</span>
            <span class="alt-value">${settings.mainAltitude} ft</span>
          </div>
          <div class="alt-setting">
            <span class="alt-label">Backup:</span>
            <span class="alt-value">${settings.backupMainAltitude} ft</span>
          </div>
        `;
      } else {
        altHtml += `
          <div class="alt-setting">
            <span class="alt-label">Deploy:</span>
            <span class="alt-value">At Apogee</span>
          </div>
        `;
      }
      
      altHtml += '</div>';
      altimeterDiv.innerHTML = altHtml;
    }
  }

  drawDescentProfile(results) {
    const canvas = this.container.querySelector('#descent-profile-canvas');
    if (!canvas || !results.phases) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = 50;

    // Clear
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, 0, width, height);

    // Get all trajectory points
    let allPoints = [];
    results.phases.forEach(phase => {
      if (phase.trajectory) {
        allPoints = allPoints.concat(phase.trajectory);
      }
    });

    if (allPoints.length === 0) return;

    const maxTime = allPoints[allPoints.length - 1]?.time || 100;
    const maxAlt = results.phases[0]?.startAltitude || 3000;

    const xScale = (width - padding * 2) / maxTime;
    const yScale = (height - padding * 2) / maxAlt;

    // Draw grid
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;

    for (let i = 0; i <= 5; i++) {
      const y = padding + (height - padding * 2) * i / 5;
      ctx.beginPath();
      ctx.moveTo(padding, y);
      ctx.lineTo(width - padding, y);
      ctx.stroke();

      ctx.fillStyle = '#666';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText(`${Math.round((5 - i) * maxAlt / 5)} ft`, padding - 5, y + 3);
    }

    // Draw main deploy altitude line
    if (results.phases.length > 1) {
      const mainAlt = results.phases[1]?.startAltitude || 500;
      const mainY = height - padding - mainAlt * yScale;
      
      ctx.strokeStyle = '#4caf50';
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(padding, mainY);
      ctx.lineTo(width - padding, mainY);
      ctx.stroke();
      ctx.setLineDash([]);
      
      ctx.fillStyle = '#4caf50';
      ctx.font = '10px sans-serif';
      ctx.fillText('Main Deploy', width - padding - 50, mainY - 5);
    }

    // Draw trajectory
    let currentPhase = -1;
    const phaseColors = ['#f44336', '#4caf50']; // Drogue = red, Main = green

    allPoints.forEach((point, i) => {
      const x = padding + point.time * xScale;
      const y = height - padding - point.altitude * yScale;

      // Determine phase
      const phaseIdx = results.phases.findIndex(p => 
        point.altitude <= p.startAltitude && point.altitude >= p.endAltitude
      );

      if (phaseIdx !== currentPhase) {
        if (currentPhase >= 0) ctx.stroke();
        ctx.beginPath();
        ctx.strokeStyle = phaseColors[phaseIdx] || '#333';
        ctx.lineWidth = 2;
        ctx.moveTo(x, y);
        currentPhase = phaseIdx;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    // Labels
    ctx.fillStyle = '#333';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Time (s)', width / 2, height - 10);

    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Altitude (ft)', 0, 0);
    ctx.restore();

    // Legend
    ctx.font = '10px sans-serif';
    ctx.fillStyle = '#f44336';
    ctx.fillRect(padding, height - 20, 15, 10);
    ctx.fillStyle = '#333';
    ctx.fillText('Drogue', padding + 40, height - 12);

    ctx.fillStyle = '#4caf50';
    ctx.fillRect(padding + 70, height - 20, 15, 10);
    ctx.fillStyle = '#333';
    ctx.fillText('Main', padding + 100, height - 12);
  }

  drawDriftMap(results) {
    const canvas = this.container.querySelector('#drift-map-canvas');
    const statsDiv = this.container.querySelector('#drift-stats');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const center = size / 2;

    // Clear
    ctx.fillStyle = '#e8f5e9';
    ctx.fillRect(0, 0, size, size);

    // Draw grid
    ctx.strokeStyle = '#c8e6c9';
    ctx.lineWidth = 1;

    const gridSize = 50; // pixels
    for (let i = 0; i <= size; i += gridSize) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(size, i);
      ctx.stroke();
    }

    // Draw compass
    ctx.fillStyle = '#666';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', center, 15);
    ctx.fillText('S', center, size - 5);
    ctx.fillText('E', size - 10, center + 4);
    ctx.fillText('W', 10, center + 4);

    // Draw launch point
    ctx.fillStyle = '#4caf50';
    ctx.beginPath();
    ctx.arc(center, center, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('L', center, center + 3);

    // Calculate scale (fit drift in canvas)
    const totalDrift = results.totals.totalDriftMeters || 100;
    const scale = (size / 2 - 30) / Math.max(totalDrift, 50);

    // Draw drift trajectory
    if (results.phases) {
      let cumEast = 0;
      let cumNorth = 0;

      results.phases.forEach((phase, phaseIdx) => {
        if (phase.trajectory) {
          ctx.strokeStyle = phaseIdx === 0 ? '#f44336' : '#2196f3';
          ctx.lineWidth = 2;
          ctx.beginPath();

          phase.trajectory.forEach((point, i) => {
            const x = center + point.driftEast * scale;
            const y = center - point.driftNorth * scale; // Y is inverted

            if (i === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }

            cumEast = point.driftEast;
            cumNorth = point.driftNorth;
          });

          ctx.stroke();
        }
      });

      // Landing point
      const landX = center + results.totals.driftEast * scale;
      const landY = center - results.totals.driftNorth * scale;

      ctx.fillStyle = '#f44336';
      ctx.beginPath();
      ctx.arc(landX, landY, 6, 0, Math.PI * 2);
      ctx.fill();

      // Landing distance line
      ctx.strokeStyle = '#666';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(center, center);
      ctx.lineTo(landX, landY);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Scale indicator
    const scaleLength = 50;
    const scaleMeters = scaleLength / scale;
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, size - 20);
    ctx.lineTo(10 + scaleLength, size - 20);
    ctx.stroke();

    ctx.fillStyle = '#333';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`${scaleMeters.toFixed(0)}m`, 10, size - 25);

    // Stats
    if (statsDiv) {
      const dir = results.totals.driftDirection || 0;
      const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
      const dirIndex = Math.round(((dir + 360) % 360) / 22.5) % 16;

      statsDiv.innerHTML = `
        <div class="drift-stat">
          <span class="drift-label">Total Drift:</span>
          <span class="drift-value">${results.totals.totalDriftMeters.toFixed(0)} m (${(results.totals.totalDriftMeters * 3.28084).toFixed(0)} ft)</span>
        </div>
        <div class="drift-stat">
          <span class="drift-label">Direction:</span>
          <span class="drift-value">${dir.toFixed(0)}° (${dirs[dirIndex]})</span>
        </div>
        <div class="drift-stat">
          <span class="drift-label">East/West:</span>
          <span class="drift-value">${results.totals.driftEast.toFixed(0)} m ${results.totals.driftEast > 0 ? 'E' : 'W'}</span>
        </div>
        <div class="drift-stat">
          <span class="drift-label">North/South:</span>
          <span class="drift-value">${Math.abs(results.totals.driftNorth).toFixed(0)} m ${results.totals.driftNorth > 0 ? 'N' : 'S'}</span>
        </div>
      `;
    }
  }

  // ============================================
  // Unit System (Metric/Imperial)
  // ============================================

  initializeUnitSystem() {
    // Default to metric, or load from localStorage
    try {
      this.units = localStorage.getItem('launchsim_units') || 'metric';
    } catch (e) {
      this.units = 'metric';
    }
    
    // Set initial active button
    const unitBtns = this.container.querySelectorAll('.unit-btn');
    unitBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.unit === this.units);
      btn.addEventListener('click', () => {
        unitBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.setUnitSystem(btn.dataset.unit);
      });
    });
    
    // Store conversion factors
    this.unitConversions = {
      // Length
      m_to_ft: 3.28084,
      ft_to_m: 0.3048,
      mm_to_in: 0.0393701,
      in_to_mm: 25.4,
      cm_to_in: 0.393701,
      in_to_cm: 2.54,
      km_to_mi: 0.621371,
      mi_to_km: 1.60934,
      
      // Mass
      kg_to_lb: 2.20462,
      lb_to_kg: 0.453592,
      g_to_oz: 0.035274,
      oz_to_g: 28.3495,
      
      // Speed
      mps_to_fps: 3.28084,
      fps_to_mps: 0.3048,
      mps_to_mph: 2.23694,
      mph_to_mps: 0.44704,
      
      // Temperature
      c_to_f: (c) => c * 9/5 + 32,
      f_to_c: (f) => (f - 32) * 5/9,
      
      // Pressure
      pa_to_psi: 0.000145038,
      psi_to_pa: 6894.76,
      pa_to_inhg: 0.0002953,
      inhg_to_pa: 3386.39,
      hpa_to_inhg: 0.02953,
      
      // Force
      n_to_lbf: 0.224809,
      lbf_to_n: 4.44822,
      
      // Impulse
      ns_to_lbfs: 0.224809
    };
    
    // Unit labels mapping
    this.unitLabels = {
      metric: {
        length: 'm', lengthSmall: 'mm', lengthMedium: 'cm',
        mass: 'kg', massSmall: 'g',
        speed: 'm/s', speedAlt: 'km/h',
        temp: '°C', pressure: 'hPa', pressurePa: 'Pa',
        force: 'N', impulse: 'Ns',
        altitude: 'm', altitudeFt: 'm'
      },
      imperial: {
        length: 'ft', lengthSmall: 'in', lengthMedium: 'in',
        mass: 'lb', massSmall: 'oz',
        speed: 'ft/s', speedAlt: 'mph',
        temp: '°F', pressure: 'inHg', pressurePa: 'psi',
        force: 'lbf', impulse: 'lbf·s',
        altitude: 'ft', altitudeFt: 'ft'
      }
    };
    
    // Apply initial units to any existing elements
    this.updateAllUnits();
    
    log.debug('Unit system initialized:', this.units);
  }

  setUnitSystem(system) {
    if (this.units === system) return;
    
    this.units = system;
    log.debug('Unit system changed to:', system);
    
    // Store preference
    try {
      localStorage.setItem('launchsim_units', system);
    } catch (e) {
      // localStorage not available
    }
    
    // Update all displayed values
    this.updateAllUnits();
  }

  // Convert value from metric to current unit system
  convertFromMetric(value, unitType) {
    if (this.units === 'metric' || value === null || value === undefined) return value;
    
    const conversions = {
      // Length
      'm': value * this.unitConversions.m_to_ft,
      'mm': value * this.unitConversions.mm_to_in,
      'cm': value * this.unitConversions.cm_to_in,
      'km': value * this.unitConversions.km_to_mi,
      
      // Mass
      'kg': value * this.unitConversions.kg_to_lb,
      'g': value * this.unitConversions.g_to_oz,
      
      // Speed
      'm/s': value * this.unitConversions.mps_to_fps,
      'mps': value * this.unitConversions.mps_to_fps,
      'km/h': value * this.unitConversions.mps_to_mph / 3.6,
      
      // Temperature
      'C': this.unitConversions.c_to_f(value),
      '°C': this.unitConversions.c_to_f(value),
      
      // Pressure
      'Pa': value * this.unitConversions.pa_to_psi,
      'hPa': value * this.unitConversions.hpa_to_inhg,
      
      // Force & Impulse
      'N': value * this.unitConversions.n_to_lbf,
      'Ns': value * this.unitConversions.ns_to_lbfs
    };
    
    return conversions[unitType] ?? value;
  }

  // Convert value from imperial to metric (for input)
  convertToMetric(value, unitType) {
    if (this.units === 'metric' || value === null || value === undefined) return value;
    
    const conversions = {
      // Length
      'm': value * this.unitConversions.ft_to_m,
      'mm': value * this.unitConversions.in_to_mm,
      'cm': value * this.unitConversions.in_to_cm,
      'km': value * this.unitConversions.mi_to_km,
      
      // Mass
      'kg': value * this.unitConversions.lb_to_kg,
      'g': value * this.unitConversions.oz_to_g,
      
      // Speed
      'm/s': value * this.unitConversions.fps_to_mps,
      'mps': value * this.unitConversions.fps_to_mps,
      
      // Temperature
      'C': this.unitConversions.f_to_c(value),
      '°C': this.unitConversions.f_to_c(value),
      
      // Pressure
      'Pa': value * this.unitConversions.psi_to_pa,
      'hPa': value * this.unitConversions.inhg_to_pa / 100,
      
      // Force & Impulse
      'N': value * this.unitConversions.lbf_to_n,
      'Ns': value * this.unitConversions.lbf_to_n
    };
    
    return conversions[unitType] ?? value;
  }

  // Get unit label for current system
  getUnitLabel(metricUnit) {
    if (this.units === 'metric') return metricUnit;
    
    const imperialUnits = {
      'm': 'ft',
      'mm': 'in',
      'cm': 'in',
      'km': 'mi',
      'kg': 'lb',
      'g': 'oz',
      'm/s': 'ft/s',
      'mps': 'fps',
      'km/h': 'mph',
      'C': '°F',
      '°C': '°F',
      'Pa': 'psi',
      'hPa': 'inHg',
      'N': 'lbf',
      'Ns': 'lbf·s',
      'ft': 'ft',  // Already imperial
      'ft/s': 'ft/s'
    };
    
    return imperialUnits[metricUnit] ?? metricUnit;
  }

  // Format value with unit - creates span with data attributes for later updates
  formatWithUnit(value, metricUnit, decimals = 1, addDataAttr = false) {
    const converted = this.convertFromMetric(value, metricUnit);
    const unit = this.getUnitLabel(metricUnit);
    const formatted = `${converted.toFixed(decimals)} ${unit}`;
    
    if (addDataAttr) {
      return `<span class="unit-value" data-metric-value="${value}" data-metric-unit="${metricUnit}" data-decimals="${decimals}">${formatted}</span>`;
    }
    return formatted;
  }

  // Create a unit-aware value span
  createUnitSpan(value, metricUnit, decimals = 1) {
    const converted = this.convertFromMetric(value, metricUnit);
    const unit = this.getUnitLabel(metricUnit);
    return `<span class="unit-value" data-metric-value="${value}" data-metric-unit="${metricUnit}" data-decimals="${decimals}">${converted.toFixed(decimals)} ${unit}</span>`;
  }

  updateAllUnits() {
    // Unit label mapping (metric → imperial)
    const unitMap = {
      'mm': 'in', 'cm': 'in', 'm': 'ft', 'km': 'mi',
      'g': 'oz', 'kg': 'lb',
      'm/s': 'ft/s', 'mps': 'fps', 'km/h': 'mph',
      '°C': '°F', 'C': 'F',
      'hPa': 'inHg', 'Pa': 'psi',
      'N': 'lbf', 'Ns': 'lbf·s',
      'ft': 'ft', 'ft/s': 'ft/s', 'in': 'in', 'lb': 'lb', 'oz': 'oz'
    };

    // Helper to update an element's unit label
    const updateElementUnit = (el, textProp = 'textContent') => {
      const text = el[textProp];
      const match = text.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
      
      if (match) {
        const baseText = match[1].trim();
        const currentUnit = match[2].trim();
        
        // Store original metric unit if not already stored
        if (!el.dataset.metricUnit) {
          // Determine if current unit is metric or imperial
          if (unitMap[currentUnit]) {
            el.dataset.metricUnit = currentUnit;
          } else {
            // Current unit is imperial, find its metric equivalent
            for (const [metric, imperial] of Object.entries(unitMap)) {
              if (imperial === currentUnit) {
                el.dataset.metricUnit = metric;
                break;
              }
            }
          }
          el.dataset.baseText = baseText;
        }
        
        // Get the correct unit based on current system
        const metricUnit = el.dataset.metricUnit;
        if (metricUnit) {
          const displayUnit = this.units === 'metric' ? metricUnit : (unitMap[metricUnit] || metricUnit);
          const storedBaseText = el.dataset.baseText || baseText;
          el[textProp] = `${storedBaseText} (${displayUnit})`;
        }
      }
    };

    // 1. Update ALL labels with units in parentheses
    this.container.querySelectorAll('label').forEach(label => updateElementUnit(label));

    // 2. Update all elements with unit-value class (dynamic values)
    this.container.querySelectorAll('.unit-value').forEach(el => {
      const metricValue = parseFloat(el.dataset.metricValue);
      const metricUnit = el.dataset.metricUnit;
      const decimals = parseInt(el.dataset.decimals) || 1;
      
      if (!isNaN(metricValue) && metricUnit) {
        const converted = this.convertFromMetric(metricValue, metricUnit);
        const unit = this.getUnitLabel(metricUnit);
        el.textContent = `${converted.toFixed(decimals)} ${unit}`;
      }
    });
    
    // 3. Update all unit labels (spans/text showing just the unit)
    this.container.querySelectorAll('.unit-label-dynamic').forEach(el => {
      const metricUnit = el.dataset.metricUnit;
      if (metricUnit) {
        el.textContent = this.getUnitLabel(metricUnit);
      }
    });

    // 4. Update table headers with units
    this.container.querySelectorAll('th').forEach(th => updateElementUnit(th));

    // 5. Update select option texts with units
    this.container.querySelectorAll('option').forEach(opt => updateElementUnit(opt));

    // 6. Update result labels/cards with units
    this.container.querySelectorAll('.result-label, .data-label, .stat-label, .dd-label').forEach(el => {
      updateElementUnit(el);
    });

    // 7. Update span elements that might contain units
    this.container.querySelectorAll('span').forEach(span => {
      if (span.textContent.match(/\([^)]+\)\s*$/) && !span.classList.contains('unit-value')) {
        updateElementUnit(span);
      }
    });

    // 8. Update helper text and other elements
    this.container.querySelectorAll('.helper-text, .section-desc, p').forEach(el => {
      // Only process if it has a unit pattern and hasn't been processed
      if (el.textContent.match(/\([^)]+\)/) && !el.dataset.processed) {
        const text = el.textContent;
        let newText = text;
        
        for (const [metric, imperial] of Object.entries(unitMap)) {
          const displayUnit = this.units === 'metric' ? metric : imperial;
          const otherUnit = this.units === 'metric' ? imperial : metric;
          
          // Replace (otherUnit) with (displayUnit)
          const regex = new RegExp(`\\(${otherUnit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'g');
          newText = newText.replace(regex, `(${displayUnit})`);
        }
        
        if (newText !== text) {
          el.textContent = newText;
        }
      }
    });
    
    // 9. Update weather display
    this.updateWeatherDisplay();
    
    // 10. Update simulation results if present
    this.updateSimulationResultsDisplay();
    
    // 11. Update design tab rocket info
    this.updateDesignTabUnits();
    
    // 12. Update recovery tab
    this.updateRecoveryTabUnits();
    
    // 13. Update multi-stage tab
    this.updateMultiStageTabUnits();
    
    // 14. Update launch day tab
    this.updateLaunchDayTabUnits();

    // 15. Re-render any active charts with new axis labels
    this.updateChartAxisLabels();
    
    // 16. Update flight summary if results exist
    if (this.lastSimResult) {
      this.renderFlightSummary(this.lastSimResult);
    }

    // 17. Update multi-stage results if they exist
    if (this.multiStageResult) {
      this.displayMultiStageResults();
    }

    // 18. Update dual deploy results if they exist
    if (this.lastDualDeployResult && this.lastDualDeploySim) {
      this.displayDualDeployResults(this.lastDualDeployResult, this.lastDualDeploySim);
    }

    // 19. Dispatch event for custom handlers
    this.container.dispatchEvent(new CustomEvent('unitschanged', { 
      detail: { units: this.units } 
    }));
  }

  updateChartAxisLabels() {
    // Re-draw trajectory chart if it exists and has data
    const trajCanvas = this.container.querySelector('#trajectory-canvas');
    if (trajCanvas && this.lastSimResult) {
      this.renderTrajectory(this.lastSimResult);
    }

    // Re-draw multi-stage trajectory
    const msCanvas = this.container.querySelector('#ms-trajectory-canvas');
    if (msCanvas && this.multiStageResult) {
      this.drawMultiStageTrajectory();
    }

    // Re-draw wind profile (reads from form fields, no stored data needed)
    const windCanvas = this.container.querySelector('#wind-profile-canvas');
    if (windCanvas) {
      this.drawWindProfile();
    }

    // Re-draw descent profile
    const descentCanvas = this.container.querySelector('#descent-profile-chart');
    if (descentCanvas && this.lastDualDeployResult) {
      this.drawDescentProfile(this.lastDualDeployResult);
    }

    // Re-draw forecast chart
    const forecastCanvas = this.container.querySelector('#forecast-chart');
    const weather = this.state?.get('weather');
    if (forecastCanvas && weather?.hourlyForecast) {
      this.renderForecastChart(weather.hourlyForecast);
    }
  }

  updateWeatherDisplay() {
    if (!this.currentWeather) return;
    
    // Temperature
    const tempEl = this.container.querySelector('#weather-temp');
    if (tempEl) {
      const temp = this.convertFromMetric(this.currentWeather.temperature, '°C');
      const unit = this.getUnitLabel('°C');
      tempEl.textContent = `${temp.toFixed(1)}${unit}`;
    }
    
    // Wind speed
    const windEl = this.container.querySelector('#weather-wind');
    if (windEl) {
      const wind = this.convertFromMetric(this.currentWeather.windSpeed, 'm/s');
      const unit = this.getUnitLabel('m/s');
      windEl.textContent = `${wind.toFixed(1)} ${unit}`;
    }
    
    // Pressure
    const pressureEl = this.container.querySelector('#weather-pressure');
    if (pressureEl) {
      const pressure = this.convertFromMetric(this.currentWeather.pressure, 'hPa');
      const unit = this.getUnitLabel('hPa');
      pressureEl.textContent = `${pressure.toFixed(this.units === 'metric' ? 0 : 2)} ${unit}`;
    }
    
    // Visibility
    const visEl = this.container.querySelector('#weather-visibility');
    if (visEl && this.currentWeather.visibility) {
      const vis = this.convertFromMetric(this.currentWeather.visibility / 1000, 'km');
      const unit = this.units === 'metric' ? 'km' : 'mi';
      visEl.textContent = `${vis.toFixed(1)} ${unit}`;
    }
    
    // Status bar weather
    const statusWeather = this.container.querySelector('#status-weather');
    if (statusWeather && this.currentWeather) {
      const temp = this.convertFromMetric(this.currentWeather.temperature, '°C');
      const tempUnit = this.getUnitLabel('°C');
      const wind = this.convertFromMetric(this.currentWeather.windSpeed, 'm/s');
      const windUnit = this.getUnitLabel('m/s');
      statusWeather.textContent = `Weather: ${temp.toFixed(0)}${tempUnit}, Wind ${wind.toFixed(0)} ${windUnit}`;
    }
  }

  updateSimulationResultsDisplay() {
    if (!this.lastSimResult) return;
    
    const result = this.lastSimResult;
    
    // Apogee
    const apogeeEl = this.container.querySelector('#result-apogee');
    if (apogeeEl) {
      apogeeEl.textContent = this.formatWithUnit(result.apogee, 'm', 0);
    }
    
    // Max velocity
    const maxVelEl = this.container.querySelector('#result-max-velocity');
    if (maxVelEl) {
      maxVelEl.textContent = this.formatWithUnit(result.maxVelocity, 'm/s', 1);
    }
    
    // Max acceleration
    const maxAccelEl = this.container.querySelector('#result-max-accel');
    if (maxAccelEl && result.maxAcceleration) {
      // Acceleration in G's doesn't need conversion
      maxAccelEl.textContent = `${result.maxAcceleration.toFixed(1)} G`;
    }
    
    // Update results summary cards if visible
    const resultCards = this.container.querySelectorAll('.result-card');
    resultCards.forEach(card => {
      const valueEl = card.querySelector('.result-value');
      const metricValue = parseFloat(card.dataset.metricValue);
      const metricUnit = card.dataset.metricUnit;
      const decimals = parseInt(card.dataset.decimals) || 1;
      
      if (valueEl && !isNaN(metricValue) && metricUnit) {
        const converted = this.convertFromMetric(metricValue, metricUnit);
        const unit = this.getUnitLabel(metricUnit);
        valueEl.textContent = `${converted.toFixed(decimals)} ${unit}`;
      }
    });
  }

  updateDesignTabUnits() {
    // Update rocket info display
    if (this.currentRocket) {
      const lengthEl = this.container.querySelector('#rocket-length');
      if (lengthEl) {
        const length = this.convertFromMetric(this.currentRocket.length, 'm');
        const unit = this.getUnitLabel('m');
        lengthEl.textContent = `${length.toFixed(2)} ${unit}`;
      }
      
      const diameterEl = this.container.querySelector('#rocket-diameter');
      if (diameterEl) {
        const dia = this.convertFromMetric(this.currentRocket.bodyDiameter, 'mm');
        const unit = this.getUnitLabel('mm');
        diameterEl.textContent = `${dia.toFixed(1)} ${unit}`;
      }
      
      const massEl = this.container.querySelector('#rocket-mass');
      if (massEl) {
        const mass = this.convertFromMetric(this.currentRocket.totalMass / 1000, 'kg');
        const unit = this.getUnitLabel('kg');
        massEl.textContent = `${mass.toFixed(2)} ${unit}`;
      }
    }
    
    // Update input labels with units
    this.updateInputLabels('#tab-design');
  }

  updateRecoveryTabUnits() {
    // Recovery uses ft internally for altitude, so handle appropriately
    // Convert inputs/outputs based on current unit setting
    this.updateInputLabels('#tab-recovery');
    
    // Update any displayed results
    const driftEl = this.container.querySelector('#drift-total');
    if (driftEl && driftEl.dataset.metricValue) {
      const drift = this.convertFromMetric(parseFloat(driftEl.dataset.metricValue), 'm');
      const unit = this.getUnitLabel('m');
      driftEl.textContent = `${drift.toFixed(0)} ${unit}`;
    }
  }

  updateMultiStageTabUnits() {
    // Update total length
    const lengthEl = this.container.querySelector('#total-length');
    if (lengthEl && lengthEl.dataset.metricValue) {
      const length = parseFloat(lengthEl.dataset.metricValue);
      // Length is stored in cm, convert to user's unit
      if (this.units === 'metric') {
        lengthEl.textContent = `${length.toFixed(1)} cm`;
      } else {
        lengthEl.textContent = `${(length * 0.393701).toFixed(1)} in`;
      }
    }
    
    // Update total mass
    const massEl = this.container.querySelector('#total-mass');
    if (massEl && massEl.dataset.metricValue) {
      const mass = parseFloat(massEl.dataset.metricValue);
      if (this.units === 'metric') {
        massEl.textContent = `${mass.toFixed(2)} kg`;
      } else {
        massEl.textContent = `${(mass * 2.20462).toFixed(2)} lb`;
      }
    }
    
    this.updateInputLabels('#tab-multistage');
  }

  updateLaunchDayTabUnits() {
    // Update any weather-related displays in launch day tab
    this.updateInputLabels('#tab-launchday');
    
    // Update go/no-go panel values
    const panels = this.container.querySelectorAll('#tab-launchday .check-value');
    panels.forEach(el => {
      if (el.dataset.metricValue && el.dataset.metricUnit) {
        const value = parseFloat(el.dataset.metricValue);
        const unit = el.dataset.metricUnit;
        const decimals = parseInt(el.dataset.decimals) || 1;
        const converted = this.convertFromMetric(value, unit);
        const unitLabel = this.getUnitLabel(unit);
        el.textContent = `${converted.toFixed(decimals)} ${unitLabel}`;
      }
    });
  }

  updateInputLabels(tabSelector) {
    // Find all labels that should show units and update them
    const tab = this.container.querySelector(tabSelector);
    if (!tab) return;
    
    // Common patterns: "Label (unit)" format
    const unitPatterns = [
      { pattern: /\(m\)$/i, metric: 'm', imperial: 'ft' },
      { pattern: /\(mm\)$/i, metric: 'mm', imperial: 'in' },
      { pattern: /\(cm\)$/i, metric: 'cm', imperial: 'in' },
      { pattern: /\(km\)$/i, metric: 'km', imperial: 'mi' },
      { pattern: /\(kg\)$/i, metric: 'kg', imperial: 'lb' },
      { pattern: /\(g\)$/i, metric: 'g', imperial: 'oz' },
      { pattern: /\(m\/s\)$/i, metric: 'm/s', imperial: 'ft/s' },
      { pattern: /\(°C\)$/i, metric: '°C', imperial: '°F' },
      { pattern: /\(hPa\)$/i, metric: 'hPa', imperial: 'inHg' },
      { pattern: /\(Pa\)$/i, metric: 'Pa', imperial: 'psi' },
      { pattern: /\(N\)$/i, metric: 'N', imperial: 'lbf' },
      { pattern: /\(Ns\)$/i, metric: 'Ns', imperial: 'lbf·s' }
    ];
    
    tab.querySelectorAll('label').forEach(label => {
      const text = label.textContent;
      for (const { pattern, metric, imperial } of unitPatterns) {
        if (pattern.test(text)) {
          const baseText = text.replace(pattern, '').trim();
          const unit = this.units === 'metric' ? metric : imperial;
          label.textContent = `${baseText} (${unit})`;
          break;
        }
      }
    });
  }

  // ============================================
  // Advanced Tab (TVC & HIL)
  // ============================================

  initializeAdvancedTab() {
    // TVC Configuration
    const tvcEnabled = this.container.querySelector('#tvc-enabled');
    const tvcSettings = this.container.querySelector('#tvc-settings');
    
    tvcEnabled?.addEventListener('change', (e) => {
      if (tvcSettings) {
        tvcSettings.style.opacity = e.target.checked ? '1' : '0.5';
        tvcSettings.style.pointerEvents = e.target.checked ? 'auto' : 'none';
      }
      this.tvcEnabled = e.target.checked;
    });

    const controlModeSelect = this.container.querySelector('#tvc-control-mode');
    controlModeSelect?.addEventListener('change', (e) => {
      const pidSection = this.container.querySelector('#pid-gains-section');
      if (pidSection) {
        pidSection.style.display = e.target.value === 'pid' ? 'block' : 'none';
      }
    });

    const testTvcBtn = this.container.querySelector('#btn-test-tvc');
    testTvcBtn?.addEventListener('click', () => this.testTVCResponse());

    // Initialize gimbal canvas
    this.drawGimbalPosition(0, 0);

    // HIL Interface
    this.initializeHIL();

    // RocketPy Server Integration
    this.initializeRocketPy();
    
    log.debug('Advanced tab initialized');
  }

  // ============================================
  // RocketPy Server Integration
  // ============================================

  initializeRocketPy() {
    // Toggle enable/disable
    const rocketpyEnabled = this.container.querySelector('#rocketpy-enabled');
    const rocketpySettings = this.container.querySelector('#rocketpy-settings');
    
    rocketpyEnabled?.addEventListener('change', (e) => {
      if (rocketpySettings) {
        rocketpySettings.style.opacity = e.target.checked ? '1' : '0.5';
        rocketpySettings.style.pointerEvents = e.target.checked ? 'auto' : 'none';
      }
      this.rocketpyEnabled = e.target.checked;
      
      // Save preference
      try {
        localStorage.setItem('launchsim_rocketpy_enabled', e.target.checked);
      } catch (err) { /* ignore */ }
    });

    // Connection buttons
    const connectBtn = this.container.querySelector('#btn-rocketpy-connect');
    const disconnectBtn = this.container.querySelector('#btn-rocketpy-disconnect');
    
    connectBtn?.addEventListener('click', () => this.connectRocketPy());
    disconnectBtn?.addEventListener('click', () => this.disconnectRocketPy());

    // Quick action buttons
    const runSimBtn = this.container.querySelector('#btn-rocketpy-run-sim');
    const stabilityBtn = this.container.querySelector('#btn-rocketpy-stability');
    const atmosphereBtn = this.container.querySelector('#btn-rocketpy-atmosphere');
    
    runSimBtn?.addEventListener('click', () => this.runRocketPySimulation());
    stabilityBtn?.addEventListener('click', () => this.calculateRocketPyStability());
    atmosphereBtn?.addEventListener('click', () => this.getRocketPyAtmosphere());

    // Auto-reconnect on startup if enabled
    const autoReconnect = this.container.querySelector('#rocketpy-auto-reconnect');
    try {
      const savedAutoReconnect = localStorage.getItem('launchsim_rocketpy_auto_reconnect') === 'true';
      const savedEnabled = localStorage.getItem('launchsim_rocketpy_enabled') === 'true';
      const savedUrl = localStorage.getItem('launchsim_rocketpy_url');
      
      if (autoReconnect) autoReconnect.checked = savedAutoReconnect;
      if (rocketpyEnabled) rocketpyEnabled.checked = savedEnabled;
      if (savedUrl) {
        const urlInput = this.container.querySelector('#rocketpy-url');
        if (urlInput) urlInput.value = savedUrl;
      }
      
      // Apply initial state
      if (rocketpySettings && rocketpyEnabled) {
        rocketpySettings.style.opacity = rocketpyEnabled.checked ? '1' : '0.5';
        rocketpySettings.style.pointerEvents = rocketpyEnabled.checked ? 'auto' : 'none';
      }
      
      // Auto-connect if enabled
      if (savedAutoReconnect && savedEnabled) {
        setTimeout(() => this.connectRocketPy(), 1000);
      }
    } catch (err) { /* ignore */ }

    // Save auto-reconnect preference
    autoReconnect?.addEventListener('change', (e) => {
      try {
        localStorage.setItem('launchsim_rocketpy_auto_reconnect', e.target.checked);
      } catch (err) { /* ignore */ }
    });

    // Initialize RocketPy client reference
    this.rocketpyClient = null;
    this.rocketpyConnected = false;
    
    log.debug('RocketPy integration initialized');
  }

  async connectRocketPy() {
    const urlInput = this.container.querySelector('#rocketpy-url');
    const url = urlInput?.value?.trim() || 'http://localhost:8000';
    
    // Update status to connecting
    this.updateRocketPyStatus('connecting', 'Connecting...');
    
    try {
      // Check if RocketPyClient class is available
      if (typeof RocketPyClient === 'undefined') {
        throw new Error('RocketPy client module not loaded');
      }
      
      // Create client instance
      this.rocketpyClient = new RocketPyClient(url);
      
      // Test connection
      const isConnected = await this.rocketpyClient.ping();
      
      if (!isConnected) {
        throw new Error('Server not responding');
      }
      
      // Get server status and capabilities
      let serverInfo = null;
      try {
        serverInfo = await this.rocketpyClient.getStatus();
      } catch (err) {
        // Status endpoint may not be available, but ping worked
        serverInfo = { version: 'unknown', capabilities: [] };
      }
      
      // Update state
      this.rocketpyConnected = true;
      
      // Save URL
      try {
        localStorage.setItem('launchsim_rocketpy_url', url);
      } catch (err) { /* ignore */ }
      
      // Update UI
      this.updateRocketPyStatus('connected', `Connected to ${url}`);
      this.showRocketPyCapabilities(serverInfo);
      this.enableRocketPyActions(true);
      
      // Update buttons
      const connectBtn = this.container.querySelector('#btn-rocketpy-connect');
      const disconnectBtn = this.container.querySelector('#btn-rocketpy-disconnect');
      if (connectBtn) connectBtn.disabled = true;
      if (disconnectBtn) disconnectBtn.disabled = false;
      
      this.showNotification('✅ Connected to RocketPy server');
      log.debug('RocketPy connected:', url);
      
    } catch (error) {
      this.rocketpyConnected = false;
      this.rocketpyClient = null;
      
      this.updateRocketPyStatus('error', `Connection failed: ${error.message}`);
      this.enableRocketPyActions(false);
      
      // Reset buttons
      const connectBtn = this.container.querySelector('#btn-rocketpy-connect');
      const disconnectBtn = this.container.querySelector('#btn-rocketpy-disconnect');
      if (connectBtn) connectBtn.disabled = false;
      if (disconnectBtn) disconnectBtn.disabled = true;
      
      log.error('RocketPy connection failed:', error);
    }
  }

  disconnectRocketPy() {
    this.rocketpyClient = null;
    this.rocketpyConnected = false;
    
    this.updateRocketPyStatus('disconnected', 'Not Connected');
    this.enableRocketPyActions(false);
    
    // Hide capabilities
    const capSection = this.container.querySelector('#rocketpy-capabilities');
    if (capSection) capSection.style.display = 'none';
    
    // Update buttons
    const connectBtn = this.container.querySelector('#btn-rocketpy-connect');
    const disconnectBtn = this.container.querySelector('#btn-rocketpy-disconnect');
    if (connectBtn) connectBtn.disabled = false;
    if (disconnectBtn) disconnectBtn.disabled = true;
    
    this.showNotification('🔌 Disconnected from RocketPy server');
    log.debug('RocketPy disconnected');
  }

  updateRocketPyStatus(status, text) {
    const statusDiv = this.container.querySelector('#rocketpy-status .status-indicator');
    if (!statusDiv) return;
    
    statusDiv.className = `status-indicator ${status}`;
    const statusText = statusDiv.querySelector('.status-text');
    if (statusText) statusText.textContent = text;
  }

  showRocketPyCapabilities(serverInfo) {
    const capSection = this.container.querySelector('#rocketpy-capabilities');
    if (!capSection) return;
    
    capSection.style.display = 'block';
    
    // Update capability indicators
    const capabilities = serverInfo?.capabilities || ['simulation', 'montecarlo', 'atmosphere', 'motors'];
    
    const capItems = {
      'cap-simulation': capabilities.includes('simulation') || true,
      'cap-montecarlo': capabilities.includes('montecarlo') || true,
      'cap-atmosphere': capabilities.includes('atmosphere') || true,
      'cap-motors': capabilities.includes('motors') || true
    };
    
    Object.entries(capItems).forEach(([id, available]) => {
      const item = this.container.querySelector(`#${id} .cap-status`);
      if (item) {
        item.textContent = available ? '✅' : '❌';
        item.className = `cap-status ${available ? 'available' : 'unavailable'}`;
      }
    });
    
    // Show server info
    const infoDiv = this.container.querySelector('#rocketpy-server-info');
    if (infoDiv && serverInfo) {
      infoDiv.innerHTML = `
        <div class="server-info-item">
          <span class="info-label">Version:</span>
          <span class="info-value">${serverInfo.version || 'Unknown'}</span>
        </div>
        ${serverInfo.rocketpy_version ? `
        <div class="server-info-item">
          <span class="info-label">RocketPy:</span>
          <span class="info-value">${serverInfo.rocketpy_version}</span>
        </div>
        ` : ''}
      `;
    }
  }

  enableRocketPyActions(enabled) {
    const buttons = [
      '#btn-rocketpy-run-sim',
      '#btn-rocketpy-stability',
      '#btn-rocketpy-atmosphere'
    ];
    
    buttons.forEach(selector => {
      const btn = this.container.querySelector(selector);
      if (btn) btn.disabled = !enabled;
    });
  }

  async runRocketPySimulation() {
    if (!this.rocketpyConnected || !this.rocketpyClient) {
      alert('Not connected to RocketPy server');
      return;
    }
    
    const rocket = this.state.get('rocket');
    const motor = this.state.get('motor');
    
    if (!rocket || !motor) {
      alert('Please configure a rocket and motor first');
      return;
    }
    
    // Show loading state
    const btn = this.container.querySelector('#btn-rocketpy-run-sim');
    const originalText = btn?.textContent;
    if (btn) btn.textContent = '⏳ Running...';
    
    try {
      // Build simulation config
      const config = this.rocketpyClient.buildSimulationConfig(rocket, motor, {
        launchRodLength: 1.0,
        inclination: 85,
        heading: 0
      });
      
      // Run simulation
      const result = await this.rocketpyClient.simulate(config);
      
      // Convert result to LAUNCHSIM format
      const simResult = this.convertRocketPyResult(result);
      
      // Store and display
      this.state.set('simulation', simResult);
      this.lastSimResult = simResult;
      
      // Switch to results tab
      this.switchTab('results');
      this.renderFlightSummary(simResult);
      this.renderTrajectory(simResult);
      
      this.showNotification('✅ RocketPy simulation complete');
      log.debug('RocketPy simulation result:', result);
      
    } catch (error) {
      alert(`Simulation failed: ${error.message}`);
      log.error('RocketPy simulation error:', error);
    } finally {
      if (btn) btn.textContent = originalText;
    }
  }

  convertRocketPyResult(rpResult) {
    // Convert RocketPy result format to LAUNCHSIM format
    return {
      apogee: rpResult.apogee || rpResult.max_altitude || 0,
      maxVelocity: rpResult.max_velocity || rpResult.max_speed || 0,
      maxAcceleration: rpResult.max_acceleration || 0,
      timeToApogee: rpResult.time_to_apogee || rpResult.apogee_time || 0,
      flightTime: rpResult.flight_time || rpResult.total_time || 0,
      landingVelocity: rpResult.landing_velocity || rpResult.impact_velocity || 0,
      landingDistance: rpResult.landing_distance || rpResult.drift || 0,
      landingX: rpResult.landing_x || rpResult.x_impact || 0,
      landingY: rpResult.landing_y || rpResult.y_impact || 0,
      trajectory: (rpResult.trajectory || []).map(p => ({
        time: p.time || p.t || 0,
        altitude: p.altitude || p.z || p.height || 0,
        velocity: p.velocity || p.speed || 0,
        x: p.x || 0,
        y: p.y || 0
      })),
      events: (rpResult.events || []).map(e => ({
        time: e.time || e.t || 0,
        event: e.name || e.event || e.type || 'Unknown',
        altitude: e.altitude || e.z || 0,
        velocity: e.velocity || 0
      })),
      source: 'rocketpy'
    };
  }

  async calculateRocketPyStability() {
    if (!this.rocketpyConnected || !this.rocketpyClient) {
      alert('Not connected to RocketPy server');
      return;
    }
    
    const rocket = this.state.get('rocket');
    if (!rocket) {
      alert('Please configure a rocket first');
      return;
    }
    
    const btn = this.container.querySelector('#btn-rocketpy-stability');
    const originalText = btn?.textContent;
    if (btn) btn.textContent = '⏳ Calculating...';
    
    try {
      const result = await this.rocketpyClient.calculateStability(rocket);
      
      // Display result
      const message = `
RocketPy Stability Analysis:
━━━━━━━━━━━━━━━━━━━━━━━━━
Center of Pressure: ${result.cp?.toFixed(1) || 'N/A'} mm
Center of Gravity: ${result.cg?.toFixed(1) || 'N/A'} mm  
Stability Margin: ${result.stability_margin?.toFixed(2) || 'N/A'} cal
Static Margin: ${result.static_margin?.toFixed(2) || 'N/A'}%
      `.trim();
      
      alert(message);
      this.showNotification('✅ Stability calculated via RocketPy');
      
    } catch (error) {
      alert(`Stability calculation failed: ${error.message}`);
      log.error('RocketPy stability error:', error);
    } finally {
      if (btn) btn.textContent = originalText;
    }
  }

  async getRocketPyAtmosphere() {
    if (!this.rocketpyConnected || !this.rocketpyClient) {
      alert('Not connected to RocketPy server');
      return;
    }
    
    const btn = this.container.querySelector('#btn-rocketpy-atmosphere');
    const originalText = btn?.textContent;
    if (btn) btn.textContent = '⏳ Fetching...';
    
    try {
      // Get atmosphere at multiple altitudes
      const altitudes = [0, 500, 1000, 2000, 3000, 5000];
      const atmosphereData = [];
      
      for (const alt of altitudes) {
        const data = await this.rocketpyClient.getAtmosphere(alt);
        atmosphereData.push({ altitude: alt, ...data });
      }
      
      // Display result
      let message = 'RocketPy Atmosphere Model:\n━━━━━━━━━━━━━━━━━━━━━━━━━\n';
      message += 'Alt(m)  | Temp(K) | Press(Pa) | Density\n';
      message += '--------|---------|-----------|--------\n';
      
      atmosphereData.forEach(d => {
        message += `${String(d.altitude).padStart(6)} | ${(d.temperature || 0).toFixed(1).padStart(7)} | ${(d.pressure || 0).toFixed(0).padStart(9)} | ${(d.density || 0).toFixed(4)}\n`;
      });
      
      alert(message);
      this.showNotification('✅ Atmosphere data retrieved');
      
    } catch (error) {
      alert(`Failed to get atmosphere data: ${error.message}`);
      log.error('RocketPy atmosphere error:', error);
    } finally {
      if (btn) btn.textContent = originalText;
    }
  }

  // Check if RocketPy should be used for simulation
  shouldUseRocketPy() {
    if (!this.rocketpyConnected || !this.rocketpyClient) return false;
    
    const useForSim = this.container.querySelector('#rocketpy-use-for-sim');
    return useForSim?.checked ?? false;
  }

  // ============================================
  // 3D Visualization Tab
  // ============================================

  initialize3DViewTab() {
    // Store 3D viewer instance
    this.viewer3D = null;
    this.viewer3DInitialized = false;

    // Initialize 3D View button
    const initBtn = this.container.querySelector('#btn-init-3d');
    initBtn?.addEventListener('click', () => this.init3DViewer());

    // Playback controls
    const playBtn = this.container.querySelector('#btn-3d-play');
    const pauseBtn = this.container.querySelector('#btn-3d-pause');
    const stopBtn = this.container.querySelector('#btn-3d-stop');
    const resetBtn = this.container.querySelector('#btn-3d-reset');

    playBtn?.addEventListener('click', () => this.play3DFlight());
    pauseBtn?.addEventListener('click', () => this.pause3DFlight());
    stopBtn?.addEventListener('click', () => this.stop3DFlight());
    resetBtn?.addEventListener('click', () => this.reset3DFlight());

    // Playback slider
    const slider = this.container.querySelector('#playback-slider');
    slider?.addEventListener('input', (e) => {
      if (this.viewer3D && this.lastSimResult) {
        const maxTime = this.lastSimResult.flightTime || 30;
        const time = (e.target.value / 100) * maxTime;
        this.viewer3D.seekTo(time);
      }
    });

    // Speed control
    const speedSelect = this.container.querySelector('#playback-speed-select');
    speedSelect?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setPlaybackSpeed(parseFloat(e.target.value));
      }
    });

    // Camera mode
    const cameraModeSelect = this.container.querySelector('#camera-mode-select');
    cameraModeSelect?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setCameraMode(e.target.value);
        
        // Sync FPV button with dropdown
        const btn = this.container.querySelector('#btn-toggle-fpv');
        if (btn) {
          btn.textContent = e.target.value === 'fpv' ? 'Exit FPV' : 'Enter FPV';
        }
      }
    });

    // Camera presets
    this.container.querySelector('#btn-cam-default')?.addEventListener('click', () => {
      if (this.viewer3D) {
        this.viewer3D.resetCamera();
      }
    });

    this.container.querySelector('#btn-cam-top')?.addEventListener('click', () => {
      if (this.viewer3D) {
        this.viewer3D.camera.position.set(0, 500, 0);
        this.viewer3D.camera.lookAt(0, 0, 0);
      }
    });

    this.container.querySelector('#btn-cam-side')?.addEventListener('click', () => {
      if (this.viewer3D) {
        this.viewer3D.camera.position.set(200, 100, 0);
        this.viewer3D.camera.lookAt(0, 100, 0);
      }
    });

    this.container.querySelector('#btn-cam-apogee')?.addEventListener('click', () => {
      if (this.viewer3D) {
        this.viewer3D.focusOnApogee();
      }
    });

    // View options
    this.container.querySelector('#opt-show-grid')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.toggleGrid(e.target.checked);
      }
    });

    this.container.querySelector('#opt-show-trajectory')?.addEventListener('change', (e) => {
      if (this.viewer3D?.trajectoryLine) {
        this.viewer3D.trajectoryLine.visible = e.target.checked;
      }
    });

    this.container.querySelector('#opt-show-events')?.addEventListener('change', (e) => {
      if (this.viewer3D?.eventMarkers) {
        this.viewer3D.eventMarkers.forEach(m => m.visible = e.target.checked);
      }
    });

    this.container.querySelector('#opt-show-stability')?.addEventListener('change', (e) => {
      if (this.viewer3D?.cgMarker) this.viewer3D.cgMarker.visible = e.target.checked;
      if (this.viewer3D?.cpMarker) this.viewer3D.cpMarker.visible = e.target.checked;
    });

    this.container.querySelector('#opt-show-landing')?.addEventListener('change', (e) => {
      if (this.viewer3D?.landingMarker) {
        this.viewer3D.landingMarker.visible = e.target.checked;
      }
    });

    // Click-to-Inspect toggle
    this.container.querySelector('#opt-enable-inspector')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setInspectorEnabled(e.target.checked);
        this.viewer3D.setInspectorMarkersVisible(e.target.checked);
      }
    });

    // Terrain controls
    this.container.querySelector('#btn-generate-terrain')?.addEventListener('click', () => {
      this.generateTerrain3D();
    });

    this.container.querySelector('#opt-show-terrain')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setTerrainVisible(e.target.checked);
      }
    });

    this.container.querySelector('#opt-show-trees')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setTreesVisible(e.target.checked);
      }
    });

    this.container.querySelector('#opt-show-buildings')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setBuildingsVisible(e.target.checked);
      }
    });

    this.container.querySelector('#terrain-elevation')?.addEventListener('input', (e) => {
      const val = e.target.value;
      const label = this.container.querySelector('#terrain-elevation-val');
      if (label) label.textContent = `${val}m`;
    });

    this.container.querySelector('#terrain-trees')?.addEventListener('input', (e) => {
      const val = e.target.value;
      const label = this.container.querySelector('#terrain-trees-val');
      if (label) label.textContent = val;
    });

    // Wind controls
    this.container.querySelector('#btn-generate-wind')?.addEventListener('click', () => {
      this.generateWind3D();
    });

    this.container.querySelector('#opt-show-wind-arrows')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setWindArrowsVisible(e.target.checked);
      }
    });

    this.container.querySelector('#opt-show-wind-particles')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setWindStreamlinesVisible(e.target.checked);
      }
    });

    // Telemetry HUD controls
    this.container.querySelector('#opt-show-hud')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setHUDVisible(e.target.checked);
      }
    });

    this.container.querySelector('#hud-position')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setHUDPosition(e.target.value);
      }
    });

    // Force Vector controls
    this.container.querySelector('#opt-show-forces')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setForceVectorsVisible(e.target.checked);
      }
    });

    this.container.querySelector('#opt-force-thrust')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setForceVisible('thrust', e.target.checked);
      }
    });

    this.container.querySelector('#opt-force-drag')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setForceVisible('drag', e.target.checked);
      }
    });

    this.container.querySelector('#opt-force-gravity')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setForceVisible('gravity', e.target.checked);
      }
    });

    this.container.querySelector('#opt-force-velocity')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setForceVisible('velocity', e.target.checked);
      }
    });

    // Mach cone controls
    this.container.querySelector('#opt-show-mach-cone')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setMachConeVisible(e.target.checked);
      }
    });

    // Multi-trajectory controls
    this.container.querySelector('#btn-add-trajectory')?.addEventListener('click', () => {
      this.addCurrentTrajectory();
    });

    this.container.querySelector('#btn-clear-trajectories')?.addEventListener('click', () => {
      if (this.viewer3D) {
        this.viewer3D.clearAllTrajectories();
        this.updateTrajectoryCount();
        this.showNotification('📊 All trajectories cleared');
      }
    });

    // Safe Zone controls
    this.container.querySelector('#opt-show-safezone')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setSafeZoneVisible(e.target.checked);
      }
    });

    this.container.querySelector('#opt-show-landing-ellipse')?.addEventListener('change', (e) => {
      if (this.viewer3D && this.viewer3D.safeZone) {
        this.viewer3D.safeZone.setLandingEllipseVisible(e.target.checked);
      }
    });

    this.container.querySelector('#btn-set-landing-zone')?.addEventListener('click', () => {
      this.setLandingPrediction();
    });

    // Attitude Indicator controls
    this.container.querySelector('#opt-show-attitude')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setAttitudeIndicatorVisible(e.target.checked);
      }
    });

    this.container.querySelector('#attitude-position')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setAttitudeIndicatorPosition(e.target.value);
      }
    });

    // Heating Indicator controls
    this.container.querySelector('#opt-show-heating')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setHeatingEnabled(e.target.checked);
        if (e.target.checked) {
          this.startHeatingStatusUpdates();
        } else {
          this.stopHeatingStatusUpdates();
        }
      }
    });

    // Weather Effects controls
    this.container.querySelector('#weather-clouds')?.addEventListener('input', (e) => {
      const val = e.target.value;
      this.container.querySelector('#weather-clouds-val').textContent = val + '%';
    });

    this.container.querySelector('#btn-apply-weather')?.addEventListener('click', () => {
      this.applyWeatherEffects();
    });

    this.container.querySelector('#btn-clear-weather')?.addEventListener('click', () => {
      if (this.viewer3D) {
        this.viewer3D.clearWeather();
        this.showNotification('🌤️ Weather cleared');
      }
    });

    // Skybox controls
    this.container.querySelector('#opt-show-skybox')?.addEventListener('change', (e) => {
      if (this.viewer3D) {
        this.viewer3D.setSkyboxVisible(e.target.checked);
      }
    });

    this.container.querySelector('#skybox-time')?.addEventListener('input', (e) => {
      const hour = parseFloat(e.target.value);
      const hourStr = Math.floor(hour).toString().padStart(2, '0');
      const minStr = Math.round((hour % 1) * 60).toString().padStart(2, '0');
      this.container.querySelector('#skybox-time-val').textContent = `${hourStr}:${minStr}`;
      if (this.viewer3D) {
        this.viewer3D.setTimeOfDay(hour);
      }
    });

    this.container.querySelector('#btn-time-sunrise')?.addEventListener('click', () => {
      this.setTimeOfDay(6);
    });
    this.container.querySelector('#btn-time-noon')?.addEventListener('click', () => {
      this.setTimeOfDay(12);
    });
    this.container.querySelector('#btn-time-sunset')?.addEventListener('click', () => {
      this.setTimeOfDay(18);
    });
    this.container.querySelector('#btn-time-night')?.addEventListener('click', () => {
      this.setTimeOfDay(22);
    });

    // First Person View controls
    this.container.querySelector('#btn-toggle-fpv')?.addEventListener('click', () => {
      this.toggleFirstPersonView();
    });

    this.container.querySelector('#fpv-fov')?.addEventListener('input', (e) => {
      const fov = parseInt(e.target.value);
      this.container.querySelector('#fpv-fov-val').textContent = fov + '°';
      if (this.viewer3D) {
        this.viewer3D.setFirstPersonFOV(fov);
      }
    });

    // KML Export
    this.container.querySelector('#btn-export-kml')?.addEventListener('click', () => {
      this.exportKML();
    });

    // Color options
    this.container.querySelector('#btn-apply-colors')?.addEventListener('click', () => {
      this.applyRocketColors();
    });

    // Go to simulate tab button
    this.container.querySelector('#btn-goto-simulate')?.addEventListener('click', () => {
      this.switchTab('simulate');
    });

    log.debug('3D View tab initialized');
  }

  generateTerrain3D() {
    if (!this.viewer3D) {
      this.init3DViewer();
    }
    if (!this.viewer3D) return;

    const elevation = parseInt(this.container.querySelector('#terrain-elevation')?.value || 80);
    const treeCount = parseInt(this.container.querySelector('#terrain-trees')?.value || 150);

    this.viewer3D.generateTerrain({
      maxElevation: elevation,
      treeCount: treeCount,
      buildingCount: 12,
      seed: Math.random() * 10000
    });

    this.showNotification('🏔️ Terrain generated');
  }

  generateWind3D() {
    if (!this.viewer3D) {
      this.init3DViewer();
    }
    if (!this.viewer3D) return;

    // Get weather data if available
    let windData = null;
    const weatherData = this.state.get('weather');
    
    if (weatherData) {
      windData = {
        speed: weatherData.windSpeed || 5,
        direction: weatherData.windDirection || 45,
        gustSpeed: weatherData.windGust || 0
      };
    } else {
      // Default wind
      windData = {
        speed: 8,
        direction: 45,
        gustSpeed: 3
      };
    }

    this.viewer3D.generateWind(windData);

    // Update wind info display
    const windInfo = this.container.querySelector('#wind-info');
    if (windInfo) {
      windInfo.innerHTML = `
        <p>Surface: ${windData.speed.toFixed(1)} m/s from ${windData.direction}°</p>
        ${windData.gustSpeed > 0 ? `<p>Gusts: ${windData.gustSpeed.toFixed(1)} m/s</p>` : ''}
      `;
    }

    this.showNotification('💨 Wind visualization enabled');
  }

  addCurrentTrajectory() {
    if (!this.viewer3D) {
      this.showNotification('⚠️ Initialize 3D Viewer first', 'warning');
      return;
    }

    if (!this.lastSimResult || !this.lastSimResult.trajectory) {
      this.showNotification('⚠️ No trajectory available. Run a simulation first.', 'warning');
      return;
    }

    // Generate a name based on motor and apogee
    const motor = this.state.get('motor');
    const motorName = motor?.name || 'Unknown';
    const apogee = this.lastSimResult.apogee?.toFixed(0) || '?';
    const name = `${motorName} (${apogee}m)`;

    // Generate a random color
    const colors = [0xff4444, 0x44ff44, 0x4444ff, 0xffff44, 0xff44ff, 0x44ffff, 0xff8844, 0x8844ff];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const id = this.viewer3D.addTrajectory(this.lastSimResult, {
      name: name,
      color: color
    });

    if (id) {
      this.updateTrajectoryCount();
      this.showNotification(`📊 Added trajectory: ${name}`);
    }
  }

  updateTrajectoryCount() {
    const countEl = this.container.querySelector('#traj-count');
    if (countEl && this.viewer3D) {
      const count = this.viewer3D.getState().trajectoryCount || 0;
      countEl.textContent = `Trajectories: ${count}`;
    }
  }

  updateMachStatus() {
    const statusEl = this.container.querySelector('#mach-status');
    if (statusEl && this.viewer3D) {
      const status = this.viewer3D.getMachStatus();
      statusEl.textContent = `Status: ${status}`;
      
      // Color code the status
      if (status === 'SUPERSONIC') {
        statusEl.style.color = '#ff4444';
      } else if (status === 'TRANSONIC') {
        statusEl.style.color = '#ffaa00';
      } else {
        statusEl.style.color = '#888';
      }
    }
  }

  setLandingPrediction() {
    if (!this.viewer3D) {
      this.showNotification('⚠️ Initialize 3D Viewer first', 'warning');
      return;
    }

    if (!this.lastSimResult) {
      this.showNotification('⚠️ Run a simulation first', 'warning');
      return;
    }

    // Calculate landing zone from simulation result
    const landingX = this.lastSimResult.landingX || this.lastSimResult.landingDistance || 100;
    const landingZ = this.lastSimResult.landingY || 0;
    
    // Use Monte Carlo data if available, otherwise estimate
    let radiusX = 50;  // Default 50m radius
    let radiusZ = 50;
    
    if (this.lastSimResult.monteCarloResults) {
      // Calculate standard deviation from Monte Carlo
      const apogees = this.lastSimResult.monteCarloResults.map(r => r.apogee);
      const landingDists = this.lastSimResult.monteCarloResults.map(r => r.landingDistance || 0);
      
      const avgLanding = landingDists.reduce((a, b) => a + b, 0) / landingDists.length;
      const variance = landingDists.reduce((a, b) => a + Math.pow(b - avgLanding, 2), 0) / landingDists.length;
      radiusX = Math.sqrt(variance) || 50;
      radiusZ = radiusX * 0.8; // Assume slightly tighter crossrange
    }

    this.viewer3D.setLandingPrediction({
      centerX: landingX,
      centerZ: landingZ,
      radiusX: radiusX,
      radiusZ: radiusZ,
      confidence: 0.95
    });

    // Enable the ellipse checkbox
    const checkbox = this.container.querySelector('#opt-show-landing-ellipse');
    if (checkbox) checkbox.checked = true;

    this.showNotification(`🎯 Landing zone set: ${landingX.toFixed(0)}m downrange`);
  }

  startHeatingStatusUpdates() {
    if (this.heatingUpdateInterval) return;
    
    this.heatingUpdateInterval = setInterval(() => {
      this.updateHeatingStatus();
    }, 200);
  }

  stopHeatingStatusUpdates() {
    if (this.heatingUpdateInterval) {
      clearInterval(this.heatingUpdateInterval);
      this.heatingUpdateInterval = null;
    }
  }

  updateHeatingStatus() {
    if (!this.viewer3D) return;

    const statusTextEl = this.container.querySelector('#heating-status-text');
    const tempEl = this.container.querySelector('#heating-temp');
    
    if (statusTextEl) {
      const status = this.viewer3D.getTemperatureStatus();
      statusTextEl.textContent = status.status;
      statusTextEl.style.color = status.color;
    }
    
    if (tempEl) {
      const temp = this.viewer3D.getCurrentTemperature();
      tempEl.textContent = `Surface Temp: ${temp.toFixed(0)} °C`;
    }
  }

  applyWeatherEffects() {
    if (!this.viewer3D) {
      this.showNotification('⚠️ Initialize 3D Viewer first', 'warning');
      return;
    }

    const cloudCover = parseInt(this.container.querySelector('#weather-clouds')?.value || 50) / 100;
    const visibility = parseInt(this.container.querySelector('#weather-visibility')?.value || 10000);
    const precipitation = this.container.querySelector('#weather-precip')?.value || 'none';

    // Get wind speed from weather data if available
    const weatherData = this.state.get('weather');
    const windSpeed = weatherData?.wind?.speed || 5;

    this.viewer3D.generateWeather({
      cloudCover: cloudCover,
      visibility: visibility,
      precipitation: precipitation,
      windSpeed: windSpeed
    });

    let msg = `🌦️ Weather: ${Math.round(cloudCover * 100)}% clouds`;
    if (precipitation !== 'none') {
      msg += `, ${precipitation}`;
    }
    if (visibility < 10000) {
      msg += `, ${visibility < 2000 ? 'foggy' : 'hazy'}`;
    }
    this.showNotification(msg);
  }

  setTimeOfDay(hour) {
    if (this.viewer3D) {
      this.viewer3D.setTimeOfDay(hour);
      
      // Update slider
      const slider = this.container.querySelector('#skybox-time');
      const label = this.container.querySelector('#skybox-time-val');
      if (slider) slider.value = hour;
      if (label) {
        const hourStr = Math.floor(hour).toString().padStart(2, '0');
        const minStr = Math.round((hour % 1) * 60).toString().padStart(2, '0');
        label.textContent = `${hourStr}:${minStr}`;
      }

      const timeNames = { 6: '🌅 Sunrise', 12: '☀️ Noon', 18: '🌇 Sunset', 22: '🌙 Night' };
      this.showNotification(timeNames[hour] || `🕐 ${hour}:00`);
    }
  }

  toggleFirstPersonView() {
    if (!this.viewer3D) {
      this.showNotification('⚠️ Initialize 3D Viewer first', 'warning');
      return;
    }

    const btn = this.container.querySelector('#btn-toggle-fpv');
    const dropdown = this.container.querySelector('#camera-mode-select');
    
    if (this.viewer3D.isFirstPersonActive()) {
      this.viewer3D.deactivateFirstPerson();
      this.viewer3D.cameraMode = 'orbit';
      if (btn) btn.textContent = 'Enter FPV';
      if (dropdown) dropdown.value = 'orbit';
      this.showNotification('👁️ Exited first-person view');
    } else {
      if (!this.viewer3D.rocketMesh) {
        this.showNotification('⚠️ Load a rocket first', 'warning');
        return;
      }
      this.viewer3D.activateFirstPerson();
      if (btn) btn.textContent = 'Exit FPV';
      if (dropdown) dropdown.value = 'fpv';
      this.showNotification('🚀 First-person view activated');
    }
  }

  exportKML() {
    if (!this.viewer3D) {
      this.showNotification('⚠️ Initialize 3D Viewer first', 'warning');
      return;
    }

    if (!this.lastSimResult) {
      this.showNotification('⚠️ Run a simulation first', 'warning');
      return;
    }

    const lat = parseFloat(this.container.querySelector('#kml-lat')?.value || 28.5729);
    const lon = parseFloat(this.container.querySelector('#kml-lon')?.value || -80.6490);

    const rocket = this.state.get('rocket') || {};
    const motor = this.state.get('motor') || {};

    const success = this.viewer3D.exportKML({
      name: `${rocket.name || 'Rocket'} Flight`,
      description: `Simulated flight with ${motor.name || 'motor'}`,
      launchSite: { lat, lon, alt: 0 },
      rocket: rocket,
      motor: motor,
      apogee: this.lastSimResult.apogee || 0
    }, `${(rocket.name || 'flight').replace(/\s+/g, '_')}.kml`);

    if (success) {
      this.showNotification('🌍 KML exported successfully');
    } else {
      this.showNotification('❌ KML export failed', 'error');
    }
  }

  init3DViewer() {
    // Check if Three.js is available
    if (typeof THREE === 'undefined') {
      alert('Three.js library is required for 3D visualization. Please ensure it is loaded.');
      return;
    }

    // Check if Rocket3DViewer class is available
    if (typeof Rocket3DViewer === 'undefined') {
      alert('3D Viewer module not loaded');
      return;
    }

    const container = this.container.querySelector('#viewport-3d');
    const placeholder = this.container.querySelector('#viewport-placeholder');
    const overlay = this.container.querySelector('#viewport-overlay');

    if (!container) return;

    // Hide placeholder, show overlay
    if (placeholder) placeholder.style.display = 'none';
    if (overlay) overlay.style.display = 'block';

    // Create 3D viewer
    try {
      this.viewer3D = new Rocket3DViewer(container, {
        backgroundColor: 0x87ceeb,
        showGrid: true
      });

      this.viewer3DInitialized = true;

      // Listen for time updates
      container.addEventListener('timeupdate', (e) => {
        this.update3DStats(e.detail);
      });

      container.addEventListener('flightend', () => {
        this.on3DFlightEnd();
      });

      // Load rocket if available
      const rocket = this.state.get('rocket');
      if (rocket) {
        this.update3DRocket();
      }

      // Load trajectory if available
      if (this.lastSimResult) {
        this.update3DTrajectory();
      }

      this.showNotification('✅ 3D Viewer initialized');
      log.debug('3D Viewer created');

    } catch (error) {
      log.error('Failed to create 3D viewer:', error);
      alert('Failed to initialize 3D viewer: ' + error.message);
    }
  }

  update3DRocket() {
    if (!this.viewer3D) return;

    const rocket = this.state.get('rocket');
    if (!rocket) return;

    // Get stability data if available
    let stabilityData = null;
    if (this.currentStability) {
      stabilityData = {
        cg: this.currentStability.cg,
        cp: this.currentStability.cp
      };
    }

    // Get colors from UI
    const bodyColor = this.container.querySelector('#color-body')?.value || '#ff4444';
    const noseColor = this.container.querySelector('#color-nose')?.value || '#ffffff';
    const finColor = this.container.querySelector('#color-fins')?.value || '#333333';

    const rocketWithColors = {
      ...rocket,
      color: parseInt(bodyColor.replace('#', ''), 16),
      noseColor: parseInt(noseColor.replace('#', ''), 16),
      finColor: parseInt(finColor.replace('#', ''), 16)
    };

    this.viewer3D.setRocket(rocketWithColors, stabilityData);
  }

  update3DTrajectory() {
    if (!this.viewer3D || !this.lastSimResult) return;

    this.viewer3D.setTrajectory(this.lastSimResult);

    // Update max velocity legend
    const maxVelEl = this.container.querySelector('#legend-max-vel');
    if (maxVelEl && this.lastSimResult.maxVelocity) {
      const vel = this.lastSimResult.maxVelocity;
      const unit = this.units === 'metric' ? 'm/s' : 'ft/s';
      const conv = this.units === 'metric' ? 1 : 3.28084;
      maxVelEl.textContent = `${(vel * conv).toFixed(0)} ${unit}`;
    }
  }

  play3DFlight() {
    if (!this.viewer3D) {
      this.init3DViewer();
      return;
    }

    if (!this.lastSimResult) {
      const warning = this.container.querySelector('#view3d-no-sim');
      if (warning) warning.style.display = 'block';
      return;
    }

    // Update trajectory if not already set
    if (!this.viewer3D.trajectory) {
      this.update3DTrajectory();
    }

    // Update rocket
    this.update3DRocket();

    // Start playback
    this.viewer3D.playFlight();

    // Update UI
    const playBtn = this.container.querySelector('#btn-3d-play');
    const pauseBtn = this.container.querySelector('#btn-3d-pause');
    if (playBtn) playBtn.style.display = 'none';
    if (pauseBtn) pauseBtn.style.display = 'inline-flex';
  }

  pause3DFlight() {
    if (!this.viewer3D) return;

    this.viewer3D.pauseFlight();

    // Update UI
    const playBtn = this.container.querySelector('#btn-3d-play');
    const pauseBtn = this.container.querySelector('#btn-3d-pause');
    if (playBtn) playBtn.style.display = 'inline-flex';
    if (pauseBtn) pauseBtn.style.display = 'none';
  }

  stop3DFlight() {
    if (!this.viewer3D) return;

    this.viewer3D.stopFlight();

    // Update UI
    const playBtn = this.container.querySelector('#btn-3d-play');
    const pauseBtn = this.container.querySelector('#btn-3d-pause');
    const slider = this.container.querySelector('#playback-slider');
    
    if (playBtn) playBtn.style.display = 'inline-flex';
    if (pauseBtn) pauseBtn.style.display = 'none';
    if (slider) slider.value = 0;

    this.update3DStats({ time: 0, maxTime: this.lastSimResult?.flightTime || 0 });
  }

  reset3DFlight() {
    this.stop3DFlight();
    if (this.viewer3D) {
      this.viewer3D.resetRocketPosition();
      this.viewer3D.resetCamera();
    }
  }

  on3DFlightEnd() {
    // Update UI
    const playBtn = this.container.querySelector('#btn-3d-play');
    const pauseBtn = this.container.querySelector('#btn-3d-pause');
    if (playBtn) playBtn.style.display = 'inline-flex';
    if (pauseBtn) pauseBtn.style.display = 'none';
  }

  update3DStats(detail) {
    const { time, maxTime } = detail;

    // Update time display
    const timeEl = this.container.querySelector('#stat-time');
    if (timeEl) timeEl.textContent = `${time.toFixed(1)}s`;

    // Update slider
    const slider = this.container.querySelector('#playback-slider');
    if (slider && maxTime > 0) {
      slider.value = (time / maxTime) * 100;
    }

    // Update time labels
    const currentTimeEl = this.container.querySelector('#time-current');
    const totalTimeEl = this.container.querySelector('#time-total');
    if (currentTimeEl) currentTimeEl.textContent = this.formatTime(time);
    if (totalTimeEl) totalTimeEl.textContent = this.formatTime(maxTime);

    // Update altitude and velocity from trajectory
    if (this.lastSimResult?.trajectory) {
      const point = this.lastSimResult.trajectory.find(p => 
        Math.abs(p.time - time) < 0.1
      ) || this.lastSimResult.trajectory[0];

      if (point) {
        const altEl = this.container.querySelector('#stat-altitude');
        const velEl = this.container.querySelector('#stat-velocity');
        
        if (altEl) {
          const alt = point.altitude || 0;
          const unit = this.units === 'metric' ? 'm' : 'ft';
          const conv = this.units === 'metric' ? 1 : 3.28084;
          altEl.textContent = `${(alt * conv).toFixed(0)} ${unit}`;
        }
        
        if (velEl) {
          const vel = point.velocity || 0;
          const unit = this.units === 'metric' ? 'm/s' : 'ft/s';
          const conv = this.units === 'metric' ? 1 : 3.28084;
          velEl.textContent = `${(vel * conv).toFixed(1)} ${unit}`;
        }
      }
    }
  }

  formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }

  applyRocketColors() {
    if (!this.viewer3D) return;
    this.update3DRocket();
    this.showNotification('🎨 Rocket colors updated');
  }

  testTVCResponse() {
    const maxAngle = parseFloat(this.container.querySelector('#tvc-max-angle')?.value || 5);
    const gimbalRate = parseFloat(this.container.querySelector('#tvc-gimbal-rate')?.value || 60);
    
    // Animate gimbal test pattern
    let phase = 0;
    const duration = 3000; // 3 seconds
    const startTime = Date.now();
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      if (elapsed > duration) {
        this.drawGimbalPosition(0, 0);
        this.updateGimbalReadout(0, 0);
        return;
      }
      
      phase = (elapsed / duration) * Math.PI * 4; // Two full cycles
      const x = Math.sin(phase) * maxAngle;
      const y = Math.cos(phase) * maxAngle;
      
      this.drawGimbalPosition(x, y);
      this.updateGimbalReadout(x, y);
      
      requestAnimationFrame(animate);
    };
    
    animate();
  }

  drawGimbalPosition(x, y) {
    const canvas = this.container.querySelector('#tvc-gimbal-canvas');
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const center = size / 2;
    const maxAngle = parseFloat(this.container.querySelector('#tvc-max-angle')?.value || 5);
    const scale = (size / 2 - 20) / maxAngle;
    
    // Clear
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(0, 0, size, size);
    
    // Draw grid
    ctx.strokeStyle = '#e0e0e0';
    ctx.lineWidth = 1;
    
    // Concentric circles
    for (let r = 1; r <= maxAngle; r++) {
      ctx.beginPath();
      ctx.arc(center, center, r * scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    
    // Crosshairs
    ctx.beginPath();
    ctx.moveTo(center, 10);
    ctx.lineTo(center, size - 10);
    ctx.moveTo(10, center);
    ctx.lineTo(size - 10, center);
    ctx.stroke();
    
    // Labels
    ctx.fillStyle = '#666';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Pitch', center, 15);
    ctx.fillText('Yaw', size - 15, center + 3);
    
    // Max angle labels
    ctx.fillText(`+${maxAngle}°`, center, 25);
    ctx.fillText(`-${maxAngle}°`, center, size - 10);
    
    // Draw gimbal position
    const posX = center + y * scale; // Y gimbal = horizontal
    const posY = center - x * scale; // X gimbal = vertical (inverted for screen)
    
    // Outer ring
    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(posX, posY, 12, 0, Math.PI * 2);
    ctx.stroke();
    
    // Inner dot
    ctx.fillStyle = '#2196f3';
    ctx.beginPath();
    ctx.arc(posX, posY, 6, 0, Math.PI * 2);
    ctx.fill();
    
    // Line from center
    ctx.strokeStyle = '#2196f3';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.lineTo(posX, posY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  updateGimbalReadout(x, y) {
    const xEl = this.container.querySelector('#gimbal-x-value');
    const yEl = this.container.querySelector('#gimbal-y-value');
    
    if (xEl) xEl.textContent = x.toFixed(1);
    if (yEl) yEl.textContent = y.toFixed(1);
  }

  getTVCConfig() {
    return {
      enabled: this.container.querySelector('#tvc-enabled')?.checked || false,
      maxAngle: parseFloat(this.container.querySelector('#tvc-max-angle')?.value || 5) * Math.PI / 180,
      gimbalRate: parseFloat(this.container.querySelector('#tvc-gimbal-rate')?.value || 60) * Math.PI / 180,
      servoRate: parseFloat(this.container.querySelector('#tvc-servo-rate')?.value || 50),
      controlMode: this.container.querySelector('#tvc-control-mode')?.value || 'pid',
      pid: {
        kp: parseFloat(this.container.querySelector('#tvc-kp')?.value || 2.0),
        ki: parseFloat(this.container.querySelector('#tvc-ki')?.value || 0.1),
        kd: parseFloat(this.container.querySelector('#tvc-kd')?.value || 0.5)
      },
      target: {
        pitch: parseFloat(this.container.querySelector('#tvc-target-pitch')?.value || 0) * Math.PI / 180,
        yaw: parseFloat(this.container.querySelector('#tvc-target-yaw')?.value || 0) * Math.PI / 180
      }
    };
  }

  // ============================================
  // HIL Interface
  // ============================================

  initializeHIL() {
    // Check browser support
    const isSupported = typeof navigator !== 'undefined' && 'serial' in navigator;
    
    const browserNotice = this.container.querySelector('#hil-browser-notice');
    if (browserNotice) {
      browserNotice.style.display = isSupported ? 'none' : 'block';
    }
    
    // Disable HIL buttons if not supported
    if (!isSupported) {
      this.container.querySelectorAll('.hil-interface button').forEach(btn => {
        btn.disabled = true;
      });
      return;
    }
    
    // Connect button
    const connectBtn = this.container.querySelector('#btn-hil-connect');
    const disconnectBtn = this.container.querySelector('#btn-hil-disconnect');
    
    connectBtn?.addEventListener('click', () => this.connectHIL());
    disconnectBtn?.addEventListener('click', () => this.disconnectHIL());
    
    // Simulation controls
    const startSimBtn = this.container.querySelector('#btn-hil-start-sim');
    const stopSimBtn = this.container.querySelector('#btn-hil-stop-sim');
    const injectFaultBtn = this.container.querySelector('#btn-hil-inject-fault');
    
    startSimBtn?.addEventListener('click', () => this.startHILSimulation());
    stopSimBtn?.addEventListener('click', () => this.stopHILSimulation());
    injectFaultBtn?.addEventListener('click', () => this.injectHILFault());
    
    // Initialize state
    this.hilConnected = false;
    this.hilRunning = false;
    this.hilInterface = null;
    this.sensorSimulator = null;
    
    log.debug('HIL interface initialized');
  }

  async connectHIL() {
    if (typeof HILInterface === 'undefined') {
      alert('HIL module not loaded');
      return;
    }
    
    try {
      const baudRate = parseInt(this.container.querySelector('#hil-baud-rate')?.value || 115200);
      const protocol = this.container.querySelector('#hil-protocol')?.value || 'binary';
      const dataBits = parseInt(this.container.querySelector('#hil-data-bits')?.value || 8);
      const parity = this.container.querySelector('#hil-parity')?.value || 'none';
      
      this.hilInterface = new HILInterface({
        baudRate,
        protocol,
        dataBits,
        parity
      });
      
      // Set up callbacks
      this.hilInterface.onStatusUpdate = (status) => this.updateHILStatus(status);
      this.hilInterface.onActuatorCommand = (cmd) => this.handleActuatorCommand(cmd);
      this.hilInterface.onError = (err) => this.handleHILError(err);
      
      await this.hilInterface.connect();
      
      this.hilConnected = true;
      this.updateHILUI(true);
      
      // Initialize sensor simulator
      this.sensorSimulator = new SensorSimulator({
        accelNoise: parseFloat(this.container.querySelector('#hil-accel-noise')?.value || 0.02),
        gyroNoise: parseFloat(this.container.querySelector('#hil-gyro-noise')?.value || 0.001),
        baroNoise: parseFloat(this.container.querySelector('#hil-baro-noise')?.value || 2),
        gpsHorizontalAcc: parseFloat(this.container.querySelector('#hil-gps-accuracy')?.value || 2.5)
      });
      
    } catch (error) {
      console.error('HIL connect error:', error);
      alert(`Failed to connect: ${error.message}`);
    }
  }

  async disconnectHIL() {
    if (this.hilInterface) {
      await this.hilInterface.disconnect();
      this.hilInterface = null;
    }
    
    this.hilConnected = false;
    this.stopHILSimulation();
    this.updateHILUI(false);
  }

  updateHILStatus(status) {
    const statusEl = this.container.querySelector('#hil-status');
    if (!statusEl) return;
    
    const indicator = statusEl.querySelector('.status-indicator');
    const text = statusEl.querySelector('.status-text');
    
    if (status.connected) {
      indicator?.classList.remove('disconnected');
      indicator?.classList.add('connected');
      if (text) text.textContent = 'Connected';
    } else {
      indicator?.classList.remove('connected');
      indicator?.classList.add('disconnected');
      if (text) text.textContent = 'Disconnected';
    }
  }

  updateHILUI(connected) {
    const connectBtn = this.container.querySelector('#btn-hil-connect');
    const disconnectBtn = this.container.querySelector('#btn-hil-disconnect');
    const startSimBtn = this.container.querySelector('#btn-hil-start-sim');
    const stopSimBtn = this.container.querySelector('#btn-hil-stop-sim');
    const injectFaultBtn = this.container.querySelector('#btn-hil-inject-fault');
    const monitor = this.container.querySelector('#hil-monitor');
    
    if (connectBtn) connectBtn.disabled = connected;
    if (disconnectBtn) disconnectBtn.disabled = !connected;
    if (startSimBtn) startSimBtn.disabled = !connected;
    if (stopSimBtn) stopSimBtn.disabled = !connected || !this.hilRunning;
    if (injectFaultBtn) injectFaultBtn.disabled = !connected || !this.hilRunning;
    if (monitor) monitor.style.display = connected ? 'block' : 'none';
  }

  startHILSimulation() {
    if (!this.hilConnected || !this.hilInterface) return;
    
    this.hilRunning = true;
    this.hilSimTime = 0;
    
    // Initialize simulation state
    this.hilSimState = {
      position: [0, 0, 0],
      velocity: [0, 0, 0],
      attitude: [0, 0, 0, 1], // Quaternion
      angularVelocity: [0, 0, 0],
      altitude: 0,
      phase: 'pad'
    };
    
    // Start simulation loop
    this.hilLastTime = performance.now();
    this.hilLoopId = requestAnimationFrame(() => this.hilSimulationLoop());
    
    // Update UI
    const startBtn = this.container.querySelector('#btn-hil-start-sim');
    const stopBtn = this.container.querySelector('#btn-hil-stop-sim');
    const injectBtn = this.container.querySelector('#btn-hil-inject-fault');
    
    if (startBtn) startBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = false;
    if (injectBtn) injectBtn.disabled = false;
    
    log.debug('HIL simulation started');
  }

  stopHILSimulation() {
    this.hilRunning = false;
    
    if (this.hilLoopId) {
      cancelAnimationFrame(this.hilLoopId);
      this.hilLoopId = null;
    }
    
    // Update UI
    const startBtn = this.container.querySelector('#btn-hil-start-sim');
    const stopBtn = this.container.querySelector('#btn-hil-stop-sim');
    const injectBtn = this.container.querySelector('#btn-hil-inject-fault');
    
    if (startBtn) startBtn.disabled = !this.hilConnected;
    if (stopBtn) stopBtn.disabled = true;
    if (injectBtn) injectBtn.disabled = true;
    
    log.debug('HIL simulation stopped');
  }

  hilSimulationLoop() {
    if (!this.hilRunning) return;
    
    const now = performance.now();
    const dt = (now - this.hilLastTime) / 1000;
    this.hilLastTime = now;
    this.hilSimTime += dt;
    
    // Simple flight simulation for HIL testing
    // In a real implementation, this would use the full physics engine
    const g = 9.81;
    const state = this.hilSimState;
    
    // Simple vertical flight model
    if (state.phase === 'pad' && this.hilSimTime > 1) {
      state.phase = 'boost';
    }
    
    if (state.phase === 'boost') {
      // Simulated thrust
      const thrust = 500; // N
      const mass = 5; // kg
      const accel = thrust / mass - g;
      
      state.velocity[2] += accel * dt;
      state.altitude += state.velocity[2] * dt;
      
      if (this.hilSimTime > 4) {
        state.phase = 'coast';
      }
    } else if (state.phase === 'coast') {
      state.velocity[2] -= g * dt;
      state.altitude += state.velocity[2] * dt;
      
      if (state.velocity[2] < 0 && state.altitude < 10) {
        state.phase = 'landed';
        state.altitude = 0;
        state.velocity = [0, 0, 0];
      }
    }
    
    // Generate sensor data
    if (this.sensorSimulator && this.hilInterface) {
      const accel = this.sensorSimulator.simulateAccelerometer(
        [0, 0, state.phase === 'boost' ? 100 : -g],
        dt
      );
      
      const gyro = this.sensorSimulator.simulateGyroscope([0, 0, 0], dt);
      
      const pressure = 101325 * Math.exp(-state.altitude / 8500);
      const baro = this.sensorSimulator.simulateBarometer(pressure, 293, dt);
      
      const gps = this.sensorSimulator.simulateGPS(
        { latitude: 35.0, longitude: -106.0, altitude: state.altitude },
        { vn: 0, ve: 0, vd: -state.velocity[2] },
        this.hilSimTime
      );
      
      // Update display
      this.updateHILSensorDisplay(accel, gyro, baro, gps, state.altitude);
      
      // Send to flight computer
      const sensorPacket = {
        timestamp: this.hilSimTime * 1000,
        accel,
        gyro,
        baro,
        gps
      };
      
      this.hilInterface.sendSensorData(sensorPacket);
    }
    
    // Update stats
    if (this.hilInterface) {
      this.updateHILStats(this.hilInterface.stats);
    }
    
    // Continue loop
    this.hilLoopId = requestAnimationFrame(() => this.hilSimulationLoop());
  }

  updateHILSensorDisplay(accel, gyro, baro, gps, altitude) {
    // Accelerometer
    const accelX = this.container.querySelector('#hil-accel-x');
    const accelY = this.container.querySelector('#hil-accel-y');
    const accelZ = this.container.querySelector('#hil-accel-z');
    if (accelX) accelX.textContent = accel.x.toFixed(2);
    if (accelY) accelY.textContent = accel.y.toFixed(2);
    if (accelZ) accelZ.textContent = accel.z.toFixed(2);
    
    // Gyroscope (convert to deg/s)
    const gyroX = this.container.querySelector('#hil-gyro-x');
    const gyroY = this.container.querySelector('#hil-gyro-y');
    const gyroZ = this.container.querySelector('#hil-gyro-z');
    if (gyroX) gyroX.textContent = (gyro.x * 57.3).toFixed(2);
    if (gyroY) gyroY.textContent = (gyro.y * 57.3).toFixed(2);
    if (gyroZ) gyroZ.textContent = (gyro.z * 57.3).toFixed(2);
    
    // Barometer
    const baroPressure = this.container.querySelector('#hil-baro-pressure');
    const baroAlt = this.container.querySelector('#hil-baro-alt');
    if (baroPressure) baroPressure.textContent = baro.pressure.toFixed(0);
    if (baroAlt) baroAlt.textContent = altitude.toFixed(1);
    
    // GPS
    if (gps && gps.valid !== false) {
      const gpsLat = this.container.querySelector('#hil-gps-lat');
      const gpsLon = this.container.querySelector('#hil-gps-lon');
      const gpsAltEl = this.container.querySelector('#hil-gps-alt');
      if (gpsLat) gpsLat.textContent = gps.latitude?.toFixed(6) || '0.000000';
      if (gpsLon) gpsLon.textContent = gps.longitude?.toFixed(6) || '0.000000';
      if (gpsAltEl) gpsAltEl.textContent = gps.altitude?.toFixed(1) || '0';
    }
  }

  updateHILStats(stats) {
    const sentEl = this.container.querySelector('#hil-packets-sent');
    const recvEl = this.container.querySelector('#hil-packets-recv');
    const errorsEl = this.container.querySelector('#hil-errors');
    const latencyEl = this.container.querySelector('#hil-latency');
    
    if (sentEl) sentEl.textContent = stats.packetsSent;
    if (recvEl) recvEl.textContent = stats.packetsReceived;
    if (errorsEl) errorsEl.textContent = stats.errors;
    if (latencyEl) latencyEl.textContent = stats.lastLatency.toFixed(1);
  }

  handleActuatorCommand(cmd) {
    if (!cmd) return;
    
    switch (cmd.type) {
      case 'gimbal':
        const gimbalX = this.container.querySelector('#hil-act-gimbal-x');
        const gimbalY = this.container.querySelector('#hil-act-gimbal-y');
        if (gimbalX) gimbalX.textContent = `${(cmd.x * 57.3).toFixed(1)}°`;
        if (gimbalY) gimbalY.textContent = `${(cmd.y * 57.3).toFixed(1)}°`;
        
        // Update TVC display too
        this.drawGimbalPosition(cmd.x * 57.3, cmd.y * 57.3);
        this.updateGimbalReadout(cmd.x * 57.3, cmd.y * 57.3);
        break;
        
      case 'parachute':
        const chuteEl = this.container.querySelector('#hil-act-chute');
        if (chuteEl) chuteEl.textContent = cmd.deploy ? 'DEPLOYED' : 'SAFE';
        if (chuteEl) chuteEl.style.color = cmd.deploy ? '#f44336' : '#4caf50';
        break;
        
      case 'ignition':
        const ignEl = this.container.querySelector('#hil-act-ignition');
        if (ignEl) ignEl.textContent = cmd.arm ? 'ARMED' : 'DISARMED';
        if (ignEl) ignEl.style.color = cmd.arm ? '#ff9800' : '#4caf50';
        break;
    }
  }

  handleHILError(error) {
    console.error('HIL Error:', error);
    
    const errorsEl = this.container.querySelector('#hil-errors');
    if (errorsEl) {
      errorsEl.textContent = parseInt(errorsEl.textContent || 0) + 1;
    }
  }

  injectHILFault() {
    if (!this.hilRunning) return;
    
    const faultTypes = ['gps_dropout', 'baro_spike', 'gyro_drift', 'accel_bias'];
    const fault = faultTypes[Math.floor(Math.random() * faultTypes.length)];
    
    if (this.sensorSimulator) {
      switch (fault) {
        case 'gps_dropout':
          this.sensorSimulator.config.gpsDropoutProb = 0.5;
          setTimeout(() => {
            this.sensorSimulator.config.gpsDropoutProb = 0.01;
          }, 3000);
          break;
          
        case 'baro_spike':
          this.sensorSimulator.baroDrift += 500;
          break;
          
        case 'gyro_drift':
          this.sensorSimulator.gyroBiasAccum = [0.1, 0.1, 0.1];
          break;
          
        case 'accel_bias':
          this.sensorSimulator.config.accelBias = [2, 2, 2];
          setTimeout(() => {
            this.sensorSimulator.config.accelBias = [0.01, 0.01, 0.01];
          }, 3000);
          break;
      }
      
      log.debug('Injected fault:', fault);
      alert(`Injected fault: ${fault}`);
    }
  }

  // ============================================
  // Export Functions
  // ============================================

  exportCSV() {
    const sim = this.state.get('simulation');
    if (!sim || !sim.trajectory) {
      alert('No simulation data to export');
      return;
    }

    // Use current unit system for export
    const altUnit = this.getUnitLabel('m');
    const velUnit = this.getUnitLabel('m/s');
    const altConv = this.units === 'metric' ? 1 : 3.28084;
    const velConv = this.units === 'metric' ? 1 : 3.28084;

    let csv = `Time (s),Altitude (${altUnit}),Velocity (${velUnit}),X (${altUnit}),Y (${altUnit})\n`;
    sim.trajectory.forEach(p => {
      csv += `${p.time.toFixed(3)},${(p.altitude * altConv).toFixed(2)},${(p.velocity * velConv).toFixed(2)},${(p.x * altConv).toFixed(2)},${(p.y * altConv).toFixed(2)}\n`;
    });

    this.downloadFile('trajectory.csv', csv, 'text/csv');
  }

  exportKML() {
    const sim = this.state.get('simulation');
    const weather = this.state.get('weather');
    
    if (!sim) {
      alert('No simulation data to export');
      return;
    }

    const lat = weather?.location?.latitude || 32.99;
    const lon = weather?.location?.longitude || -106.97;

    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>LAUNCHSIM Flight</name>
    <Placemark>
      <name>Launch Site</name>
      <Point>
        <coordinates>${lon},${lat},0</coordinates>
      </Point>
    </Placemark>
    <Placemark>
      <name>Landing Zone</name>
      <Point>
        <coordinates>${lon + sim.landingX/111000},${lat + sim.landingY/111000},0</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>`;

    this.downloadFile('flight.kml', kml, 'application/vnd.google-earth.kml+xml');
  }

  exportReport() {
    const sim = this.state.get('simulation');
    const rocket = this.state.get('rocket');
    const motor = this.state.get('motor');
    const weather = this.state.get('weather');
    
    if (!sim) {
      alert('No simulation data to export. Run a simulation first.');
      return;
    }

    // Generate comprehensive flight card
    const reportHtml = this.generateFlightCardHTML(sim, rocket, motor, weather);
    
    // Open in new window for printing
    const printWindow = window.open('', '_blank');
    printWindow.document.write(reportHtml);
    printWindow.document.close();
    
    // Auto-trigger print dialog after load
    printWindow.onload = () => {
      setTimeout(() => {
        printWindow.print();
      }, 500);
    };
  }

  generateFlightCardHTML(sim, rocket, motor, weather) {
    const date = new Date().toLocaleDateString();
    const time = new Date().toLocaleTimeString();
    
    // Unit conversions
    const altUnit = this.getUnitLabel('m');
    const velUnit = this.getUnitLabel('m/s');
    const massUnit = this.getUnitLabel('kg');
    const tempUnit = this.getUnitLabel('°C');
    const pressureUnit = this.getUnitLabel('hPa');
    
    const apogee = this.convertFromMetric(sim.apogee, 'm');
    const maxVel = this.convertFromMetric(sim.maxVelocity, 'm/s');
    const landingVel = this.convertFromMetric(sim.landingVelocity, 'm/s');
    const landingDist = this.convertFromMetric(sim.landingDistance, 'm');
    
    const rocketMass = rocket ? this.convertFromMetric(rocket.totalMass / 1000, 'kg') : 'N/A';
    const rocketLength = rocket ? this.convertFromMetric(rocket.length, 'm') : 'N/A';
    
    const temp = weather ? this.convertFromMetric(weather.current.temperature, '°C') : 'N/A';
    const wind = weather ? this.convertFromMetric(weather.current.windSpeed, 'm/s') : 'N/A';
    const pressure = weather ? this.convertFromMetric(weather.current.pressure, 'hPa') : 'N/A';

    return `<!DOCTYPE html>
<html>
<head>
  <title>LaunchSim Flight Card - ${rocket?.name || 'Flight Report'}</title>
  <style>
    @media print {
      body { margin: 0; }
      .no-print { display: none; }
      .page-break { page-break-after: always; }
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      margin: 0; padding: 20px; background: white; color: #333; font-size: 12px;
    }
    .flight-card {
      max-width: 800px; margin: 0 auto; border: 2px solid #000;
      border-radius: 8px; overflow: hidden;
    }
    .card-header {
      background: #000; color: white;
      padding: 20px; display: flex; justify-content: space-between; align-items: center;
    }
    .card-title { margin: 0; font-size: 24px; display: flex; align-items: center; gap: 10px; }
    .card-subtitle { margin: 5px 0 0; font-size: 14px; opacity: 0.9; }
    .card-date { text-align: right; font-size: 12px; }
    .card-body { padding: 20px; }
    .section { margin-bottom: 20px; }
    .section-title {
      font-size: 14px; font-weight: 700; color: #000;
      border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10px;
      display: flex; align-items: center; gap: 8px;
    }
    .data-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; }
    .data-item { background: #f5f5f5; padding: 12px; border-radius: 6px; text-align: center; }
    .data-label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 0.5px; }
    .data-value { font-size: 18px; font-weight: 700; color: #000; margin-top: 4px; }
    .data-unit { font-size: 11px; color: #666; font-weight: normal; }
    .highlight { background: #f0f0f0; border: 1px solid #ccc; }
    .events-table { width: 100%; border-collapse: collapse; font-size: 11px; }
    .events-table th, .events-table td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e0e0e0; }
    .events-table th { background: #f5f5f5; font-weight: 600; color: #666; }
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
    .safety-box { padding: 15px; border-radius: 6px; margin-top: 10px; }
    .safety-good { background: #e8f5e9; border: 1px solid #a5d6a7; color: #2e7d32; }
    .safety-warning { background: #fff3e0; border: 1px solid #ffcc80; color: #e65100; }
    .safety-danger { background: #ffebee; border: 1px solid #ef9a9a; color: #c62828; }
    .checklist { list-style: none; padding: 0; margin: 10px 0; }
    .checklist li { padding: 6px 0; border-bottom: 1px dashed #e0e0e0; display: flex; align-items: center; gap: 8px; }
    .checkbox { width: 16px; height: 16px; border: 2px solid #000; border-radius: 3px; display: inline-block; }
    .card-footer { background: #f5f5f5; padding: 15px 20px; display: flex; justify-content: space-between; font-size: 11px; color: #666; }
    .signature-line { border-top: 1px solid #999; width: 200px; margin-top: 20px; padding-top: 5px; text-align: center; }
    .print-btn { background: #000; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; font-size: 14px; margin: 20px auto; display: block; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">🖨️ Print Flight Card</button>
  <div class="flight-card">
    <div class="card-header">
      <div>
        <h1 class="card-title">🚀 ${rocket?.name || 'Rocket Flight'}</h1>
        <p class="card-subtitle">LaunchSim Flight Card</p>
      </div>
      <div class="card-date"><div><strong>Date:</strong> ${date}</div><div><strong>Time:</strong> ${time}</div></div>
    </div>
    <div class="card-body">
      <div class="section">
        <div class="section-title">📊 Flight Summary</div>
        <div class="data-grid">
          <div class="data-item highlight"><div class="data-label">Apogee</div><div class="data-value">${apogee.toFixed(0)} <span class="data-unit">${altUnit}</span></div></div>
          <div class="data-item highlight"><div class="data-label">Max Velocity</div><div class="data-value">${maxVel.toFixed(1)} <span class="data-unit">${velUnit}</span></div></div>
          <div class="data-item"><div class="data-label">Max Mach</div><div class="data-value">${(sim.maxVelocity / 343).toFixed(2)}</div></div>
          <div class="data-item"><div class="data-label">Max G-Force</div><div class="data-value">${(sim.maxAcceleration / 9.81).toFixed(1)} <span class="data-unit">G</span></div></div>
          <div class="data-item"><div class="data-label">Time to Apogee</div><div class="data-value">${sim.timeToApogee.toFixed(1)} <span class="data-unit">s</span></div></div>
          <div class="data-item"><div class="data-label">Total Flight Time</div><div class="data-value">${sim.flightTime.toFixed(1)} <span class="data-unit">s</span></div></div>
          <div class="data-item"><div class="data-label">Landing Velocity</div><div class="data-value">${landingVel.toFixed(1)} <span class="data-unit">${velUnit}</span></div></div>
          <div class="data-item"><div class="data-label">Drift Distance</div><div class="data-value">${landingDist.toFixed(0)} <span class="data-unit">${altUnit}</span></div></div>
        </div>
      </div>
      <div class="two-col">
        <div class="section">
          <div class="section-title">🔧 Rocket Configuration</div>
          <table class="events-table">
            <tr><th>Parameter</th><th>Value</th></tr>
            <tr><td>Name</td><td><strong>${rocket?.name || 'N/A'}</strong></td></tr>
            <tr><td>Total Mass</td><td>${typeof rocketMass === 'number' ? rocketMass.toFixed(2) : rocketMass} ${massUnit}</td></tr>
            <tr><td>Length</td><td>${typeof rocketLength === 'number' ? rocketLength.toFixed(2) : rocketLength} ${altUnit}</td></tr>
            <tr><td>Diameter</td><td>${rocket?.bodyDiameter ? (this.units === 'metric' ? rocket.bodyDiameter.toFixed(1) + ' mm' : (rocket.bodyDiameter * 0.0394).toFixed(2) + ' in') : 'N/A'}</td></tr>
            <tr><td>Fin Count</td><td>${rocket?.finCount || 'N/A'}</td></tr>
          </table>
        </div>
        <div class="section">
          <div class="section-title">🔥 Motor Information</div>
          <table class="events-table">
            <tr><th>Parameter</th><th>Value</th></tr>
            <tr><td>Designation</td><td><strong>${motor?.designation || 'N/A'}</strong></td></tr>
            <tr><td>Manufacturer</td><td>${motor?.manufacturer || 'N/A'}</td></tr>
            <tr><td>Total Impulse</td><td>${motor?.totalImpulse ? motor.totalImpulse.toFixed(1) + ' Ns' : 'N/A'}</td></tr>
            <tr><td>Average Thrust</td><td>${motor?.avgThrust ? motor.avgThrust.toFixed(1) + ' N' : 'N/A'}</td></tr>
            <tr><td>Burn Time</td><td>${motor?.burnTime ? motor.burnTime.toFixed(2) + ' s' : 'N/A'}</td></tr>
          </table>
        </div>
      </div>
      <div class="section">
        <div class="section-title">📋 Flight Events</div>
        <table class="events-table">
          <tr><th>Time</th><th>Event</th><th>Altitude</th><th>Velocity</th></tr>
          ${sim.events.map(e => {
            const alt = this.convertFromMetric(e.altitude, 'm');
            const vel = e.velocity ? this.convertFromMetric(e.velocity, 'm/s') : null;
            return `<tr><td>${e.time.toFixed(2)} s</td><td><strong>${e.event}</strong></td><td>${alt.toFixed(0)} ${altUnit}</td><td>${vel ? vel.toFixed(1) + ' ' + velUnit : '-'}</td></tr>`;
          }).join('')}
        </table>
      </div>
      ${weather ? `
      <div class="section">
        <div class="section-title">🌤️ Weather Conditions</div>
        <div class="data-grid">
          <div class="data-item"><div class="data-label">Temperature</div><div class="data-value">${typeof temp === 'number' ? temp.toFixed(1) : temp} <span class="data-unit">${tempUnit}</span></div></div>
          <div class="data-item"><div class="data-label">Wind Speed</div><div class="data-value">${typeof wind === 'number' ? wind.toFixed(1) : wind} <span class="data-unit">${this.getUnitLabel('m/s')}</span></div></div>
          <div class="data-item"><div class="data-label">Wind Direction</div><div class="data-value">${weather.current.windDirection.toFixed(0)}°</div></div>
          <div class="data-item"><div class="data-label">Pressure</div><div class="data-value">${typeof pressure === 'number' ? pressure.toFixed(this.units === 'metric' ? 0 : 2) : pressure} <span class="data-unit">${pressureUnit}</span></div></div>
        </div>
      </div>` : ''}
      <div class="section">
        <div class="section-title">✅ Pre-Flight Checklist</div>
        <div class="two-col">
          <ul class="checklist">
            <li><span class="checkbox"></span> Motor installed correctly</li>
            <li><span class="checkbox"></span> Igniter inserted and secured</li>
            <li><span class="checkbox"></span> Recovery system packed</li>
            <li><span class="checkbox"></span> Fins aligned and secure</li>
            <li><span class="checkbox"></span> Launch lug/rail button clear</li>
          </ul>
          <ul class="checklist">
            <li><span class="checkbox"></span> Nosecone secured</li>
            <li><span class="checkbox"></span> CG/CP verified stable</li>
            <li><span class="checkbox"></span> Altimeter armed (if applicable)</li>
            <li><span class="checkbox"></span> Sky is clear</li>
            <li><span class="checkbox"></span> Range safety confirmed</li>
          </ul>
        </div>
        <div class="safety-box ${sim.landingVelocity < 7 ? 'safety-good' : sim.landingVelocity < 10 ? 'safety-warning' : 'safety-danger'}">
          <strong>Landing Velocity Assessment:</strong> 
          ${sim.landingVelocity < 7 ? '✅ Safe landing velocity' : sim.landingVelocity < 10 ? '⚠️ Moderate - verify recovery' : '❌ High - check recovery system'}
        </div>
      </div>
      <div class="section">
        <div class="section-title">📝 Flight Notes</div>
        <div style="border: 1px solid #e0e0e0; min-height: 80px; border-radius: 4px; padding: 10px;">&nbsp;</div>
      </div>
    </div>
    <div class="card-footer">
      <div>Generated by LaunchSim</div>
      <div class="signature-line">RSO/Observer Signature</div>
    </div>
  </div>
  <button class="print-btn no-print" onclick="window.print()">🖨️ Print Flight Card</button>
</body>
</html>`;
  }

  downloadFile(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ============================================
  // Settings Modal
  // ============================================

  showSettingsModal() {
    const existingModal = this.container.querySelector('#settings-modal');
    if (existingModal) existingModal.remove();
    
    const currentUnits = this.state.get('units') || 'metric';
    const currentTheme = this.state.get('theme') || 'light';
    
    const modal = document.createElement('div');
    modal.id = 'settings-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content settings-dialog">
        <div class="modal-header">
          <h3>⚙️ Settings</h3>
          <button class="modal-close" id="settings-modal-close">×</button>
        </div>
        <div class="modal-body">
          <div class="settings-sections">
            
            <div class="settings-section">
              <h4>📐 Units</h4>
              <div class="settings-option">
                <label>Default Unit System</label>
                <select id="setting-units">
                  <option value="metric" ${currentUnits === 'metric' ? 'selected' : ''}>Metric (m, kg, m/s)</option>
                  <option value="imperial" ${currentUnits === 'imperial' ? 'selected' : ''}>Imperial (ft, lb, mph)</option>
                </select>
              </div>
            </div>
            
            <div class="settings-section">
              <h4>🎨 Display</h4>
              <div class="settings-option">
                <label>Theme</label>
                <select id="setting-theme">
                  <option value="light" ${currentTheme === 'light' ? 'selected' : ''}>Light</option>
                  <option value="dark" ${currentTheme === 'dark' ? 'selected' : ''}>Dark (Coming Soon)</option>
                </select>
              </div>
              <div class="settings-option">
                <label>
                  <input type="checkbox" id="setting-animations" checked>
                  Enable animations
                </label>
              </div>
            </div>
            
            <div class="settings-section">
              <h4>🔧 Simulation</h4>
              <div class="settings-option">
                <label>Default Time Step</label>
                <select id="setting-timestep">
                  <option value="0.001">0.001s (High Precision)</option>
                  <option value="0.005" selected>0.005s (Balanced)</option>
                  <option value="0.01">0.01s (Fast)</option>
                </select>
              </div>
              <div class="settings-option">
                <label>Default Atmosphere Model</label>
                <select id="setting-atmosphere">
                  <option value="isa" selected>ISA Standard</option>
                  <option value="ussa76">US Standard 1976</option>
                </select>
              </div>
            </div>
            
            <div class="settings-section">
              <h4>💾 Data</h4>
              <div class="settings-option">
                <label>
                  <input type="checkbox" id="setting-autosave" checked>
                  Auto-save projects
                </label>
              </div>
              <div class="settings-option">
                <button class="btn btn-small btn-warning" id="btn-clear-storage">🗑️ Clear All Saved Data</button>
              </div>
            </div>
            
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn" id="btn-settings-cancel">Cancel</button>
          <button class="btn btn-primary" id="btn-settings-save">Save Settings</button>
        </div>
      </div>
    `;
    
    this.container.appendChild(modal);
    
    // Close handlers
    modal.querySelector('#settings-modal-close')?.addEventListener('click', () => modal.remove());
    modal.querySelector('#btn-settings-cancel')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.remove();
    });
    
    // Save handler
    modal.querySelector('#btn-settings-save')?.addEventListener('click', () => {
      const units = modal.querySelector('#setting-units')?.value || 'metric';
      const theme = modal.querySelector('#setting-theme')?.value || 'light';
      
      this.state.set('units', units);
      this.state.set('theme', theme);
      
      // Update unit toggle in header
      const unitBtns = this.container.querySelectorAll('.unit-btn');
      unitBtns.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.unit === units);
      });
      
      this.showNotification('⚙️ Settings saved');
      modal.remove();
    });
    
    // Clear storage handler
    modal.querySelector('#btn-clear-storage')?.addEventListener('click', () => {
      if (confirm('Are you sure? This will delete all saved projects and settings.')) {
        localStorage.clear();
        this.showNotification('🗑️ All saved data cleared');
        modal.remove();
      }
    });
  }

  // ============================================
  // Data Management
  // ============================================

  updateStorageDisplay() {
    const usage = this.persistence.getStorageUsage();
    
    const fillEl = this.container.querySelector('#storage-bar-fill');
    const usedEl = this.container.querySelector('#storage-used');
    const totalEl = this.container.querySelector('#storage-total');
    const percentEl = this.container.querySelector('#storage-percent');
    
    if (fillEl) fillEl.style.width = `${Math.min(usage.percent, 100)}%`;
    if (usedEl) usedEl.textContent = `${usage.usedMB} MB`;
    if (totalEl) totalEl.textContent = `${usage.totalMB} MB`;
    if (percentEl) percentEl.textContent = usage.percent;
    
    // Color code the bar
    if (fillEl) {
      if (usage.percent > 90) {
        fillEl.style.background = '#f44336';
      } else if (usage.percent > 70) {
        fillEl.style.background = '#ff9800';
      } else {
        fillEl.style.background = '#4caf50';
      }
    }
  }

  updateSimHistoryCount() {
    const history = this.persistence.getSimulationHistory();
    const countEl = this.container.querySelector('#sim-history-count');
    if (countEl) countEl.textContent = history.length;
  }

  showSimulationHistoryModal() {
    const existingModal = this.container.querySelector('#sim-history-modal');
    if (existingModal) existingModal.remove();
    
    const history = this.persistence.getSimulationHistory();
    
    const modal = document.createElement('div');
    modal.id = 'sim-history-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content sim-history-dialog">
        <div class="modal-header">
          <h3>📈 Simulation History</h3>
          <button class="modal-close" id="sim-history-close">×</button>
        </div>
        <div class="modal-body">
          ${history.length > 0 ? `
            <div class="sim-history-list">
              <table class="sim-history-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Rocket</th>
                    <th>Motor</th>
                    <th>Apogee</th>
                    <th>Max Vel</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  ${history.map(sim => `
                    <tr data-id="${sim.id}">
                      <td>${new Date(sim.timestamp).toLocaleString()}</td>
                      <td>${sim.metadata?.rocketName || 'Unknown'}</td>
                      <td>${sim.metadata?.motorName || 'Unknown'}</td>
                      <td>${(sim.summary?.apogee || 0).toFixed(1)} m</td>
                      <td>${(sim.summary?.maxVelocity || 0).toFixed(1)} m/s</td>
                      <td>
                        <button class="btn btn-tiny btn-load-sim" data-id="${sim.id}" title="Load">📂</button>
                        <button class="btn btn-tiny btn-view-sim" data-id="${sim.id}" title="View in 3D">🎮</button>
                        <button class="btn btn-tiny btn-delete-sim" data-id="${sim.id}" title="Delete">🗑️</button>
                      </td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          ` : `
            <div class="no-history">
              <p>📭 No simulation history yet.</p>
              <p class="helper-text">Run a simulation to start building your history.</p>
            </div>
          `}
        </div>
        <div class="modal-footer">
          <span class="history-count">${history.length} simulation(s)</span>
          <button class="btn" id="btn-close-history">Close</button>
        </div>
      </div>
    `;
    
    this.container.appendChild(modal);
    
    // Close handlers
    modal.querySelector('#sim-history-close')?.addEventListener('click', () => modal.remove());
    modal.querySelector('#btn-close-history')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    
    // Load simulation
    modal.querySelectorAll('.btn-load-sim').forEach(btn => {
      btn.addEventListener('click', () => {
        const sim = this.persistence.getSimulationById(btn.dataset.id);
        if (sim) {
          this.lastSimResult = {
            ...sim.summary,
            trajectory: sim.trajectory,
            events: sim.events
          };
          this.showNotification(`📂 Loaded simulation from ${new Date(sim.timestamp).toLocaleDateString()}`);
          modal.remove();
          this.switchTab('results');
        }
      });
    });
    
    // View in 3D
    modal.querySelectorAll('.btn-view-sim').forEach(btn => {
      btn.addEventListener('click', () => {
        const sim = this.persistence.getSimulationById(btn.dataset.id);
        if (sim && sim.trajectory) {
          this.lastSimResult = {
            ...sim.summary,
            trajectory: sim.trajectory,
            events: sim.events
          };
          modal.remove();
          this.switchTab('3dview');
          setTimeout(() => {
            if (this.viewer3D) {
              this.viewer3D.setTrajectory(this.lastSimResult);
              this.showNotification('🎮 Trajectory loaded in 3D view');
            }
          }, 100);
        }
      });
    });
    
    // Delete simulation
    modal.querySelectorAll('.btn-delete-sim').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Delete this simulation?')) {
          this.persistence.deleteSimulation(btn.dataset.id);
          btn.closest('tr')?.remove();
          this.updateSimHistoryCount();
          
          // Check if list is now empty
          const tbody = modal.querySelector('tbody');
          if (tbody && tbody.children.length === 0) {
            modal.querySelector('.modal-body').innerHTML = `
              <div class="no-history">
                <p>📭 No simulation history.</p>
              </div>
            `;
          }
          modal.querySelector('.history-count').textContent = 
            `${this.persistence.getSimulationHistory().length} simulation(s)`;
        }
      });
    });
  }

  clearSimulationHistory() {
    if (!confirm('Clear all simulation history? This cannot be undone.')) return;
    
    this.persistence.clearSimulationHistory();
    this.updateSimHistoryCount();
    this.showNotification('🗑️ Simulation history cleared');
  }

  exportAllData() {
    const includeSettings = this.container.querySelector('#export-include-settings')?.checked !== false;
    const includeHistory = this.container.querySelector('#export-include-history')?.checked !== false;
    const includeProjects = this.container.querySelector('#export-include-projects')?.checked !== false;
    
    const data = {
      exportVersion: '2.0',
      exportDate: new Date().toISOString(),
      appVersion: 'LaunchSim 1.0'
    };
    
    if (includeSettings) {
      data.settings = this.persistence.loadSettings();
      data.currentState = {
        units: this.state.get('units'),
        theme: this.state.get('theme')
      };
    }
    
    if (includeHistory) {
      data.simulationHistory = this.persistence.getSimulationHistory();
    }
    
    if (includeProjects) {
      data.projects = this.persistence.getAllProjects();
    }
    
    // Include current rocket/motor if loaded
    const rocket = this.state.get('rocket');
    const motor = this.state.get('motor');
    if (rocket || motor) {
      data.currentProject = {
        rocket: rocket,
        motor: motor,
        simulation: this.lastSimResult
      };
    }
    
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const date = new Date().toISOString().split('T')[0];
    const filename = `launchsim-backup-${date}.json`;
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    this.showNotification(`📥 Data exported to ${filename}`);
  }

  async importAllData(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      
      if (!data.exportVersion) {
        throw new Error('Invalid backup file format');
      }
      
      let imported = { settings: 0, projects: 0, simulations: 0 };
      
      // Import settings
      if (data.settings) {
        this.persistence.saveSettings(data.settings);
        imported.settings = 1;
      }
      
      // Import current state
      if (data.currentState) {
        if (data.currentState.units) this.state.set('units', data.currentState.units);
        if (data.currentState.theme) this.state.set('theme', data.currentState.theme);
      }
      
      // Import projects
      if (data.projects && Array.isArray(data.projects)) {
        const index = this.persistence.getProjectsIndex();
        for (const project of data.projects) {
          const key = `launchsim_project_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          localStorage.setItem(key, JSON.stringify(project.data));
          index.push({
            key,
            name: project.name || 'Imported Project',
            savedAt: new Date().toISOString()
          });
          imported.projects++;
        }
        this.persistence.saveProjectsIndex(index);
      }
      
      // Import simulation history
      if (data.simulationHistory && Array.isArray(data.simulationHistory)) {
        const existing = this.persistence.getSimulationHistory();
        const combined = [...data.simulationHistory, ...existing];
        const unique = combined.filter((item, idx, self) => 
          idx === self.findIndex(t => t.id === item.id)
        );
        localStorage.setItem(this.persistence.getKey('simulation_history'), JSON.stringify(unique));
        imported.simulations = data.simulationHistory.length;
      }
      
      // Load current project if present
      if (data.currentProject?.rocket) {
        this.applyProjectData(data.currentProject);
      }
      
      this.updateStorageDisplay();
      this.updateSimHistoryCount();
      
      this.showNotification(`📤 Imported: ${imported.projects} projects, ${imported.simulations} simulations`);
    } catch (error) {
      console.error('Import failed:', error);
      alert(`Import failed: ${error.message}`);
    }
  }

  clearAllProjects() {
    if (!confirm('Delete ALL saved projects? This cannot be undone!')) return;
    
    const index = this.persistence.getProjectsIndex();
    for (const project of index) {
      localStorage.removeItem(project.key);
    }
    this.persistence.saveProjectsIndex([]);
    
    this.updateStorageDisplay();
    this.showNotification('🗑️ All projects deleted');
  }

  resetAllData() {
    if (!confirm('⚠️ This will delete ALL data including projects, settings, and history. Are you sure?')) return;
    if (!confirm('⚠️ FINAL WARNING: This action is irreversible. Continue?')) return;
    
    this.persistence.clearAllData();
    this.updateStorageDisplay();
    this.updateSimHistoryCount();
    
    this.showNotification('🔥 All data has been reset');
    
    // Reload the page to reset state
    setTimeout(() => window.location.reload(), 1000);
  }

  startAutoSave() {
    if (this.autoSaveTimer) return;
    
    const interval = this.autoSaveInterval || 60000;
    
    this.autoSaveTimer = setInterval(() => {
      this.autoSaveProject();
    }, interval);
    
    log.debug(`Auto-save started (every ${interval / 1000}s)`);
  }

  stopAutoSave() {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
      log.debug('Auto-save stopped');
    }
  }

  autoSaveProject() {
    const rocket = this.state.get('rocket');
    if (!rocket) return;
    
    const data = this.gatherProjectData();
    const key = 'launchsim_autosave';
    
    try {
      localStorage.setItem(key, JSON.stringify(data));
      
      const statusEl = this.container.querySelector('#auto-save-status .status-text');
      if (statusEl) {
        statusEl.textContent = `Last saved: ${new Date().toLocaleTimeString()}`;
      }
      
      log.debug('Auto-save completed');
    } catch (e) {
      log.error('Auto-save failed:', e);
    }
  }

  // Enhanced: Save simulation to history after each run
  saveSimulationToHistory(result) {
    const rocket = this.state.get('rocket');
    const motor = this.state.get('motor');
    
    this.persistence.saveSimulationResult(result, {
      rocketName: rocket?.name || 'Unknown',
      motorName: motor?.designation || motor?.name || 'Unknown',
      mass: rocket?.totalMass,
      diameter: rocket?.diameter,
      length: rocket?.length
    });
    
    this.updateSimHistoryCount();
  }

  // ============================================
  // Save/Load Project (Enhanced)
  // ============================================

  saveProject() {
    this.showSaveDialog();
  }

  showSaveDialog() {
    const existingModal = this.container.querySelector('#save-modal');
    if (existingModal) existingModal.remove();
    
    const rocket = this.state.get('rocket');
    const defaultName = rocket?.name || 'My Rocket Project';
    const savedProjects = this.getSavedProjectsList();
    
    const modal = document.createElement('div');
    modal.id = 'save-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content save-dialog">
        <div class="modal-header">
          <h3>💾 Save Project</h3>
          <button class="modal-close" id="save-modal-close">×</button>
        </div>
        <div class="modal-body">
          <div class="save-options">
            <div class="save-section">
              <h4>Save to Browser Storage</h4>
              <p class="helper-text">Quick save - persists between sessions</p>
              <div class="form-row">
                <label>Project Name</label>
                <input type="text" id="save-project-name" value="${defaultName}" placeholder="Enter project name">
              </div>
              <button class="btn btn-primary" id="btn-save-local">💾 Save to Browser</button>
            </div>
            <div class="save-divider"><span>OR</span></div>
            <div class="save-section">
              <h4>Download as File</h4>
              <p class="helper-text">Save to your computer for backup or sharing</p>
              <button class="btn btn-secondary" id="btn-save-file">📥 Download .json File</button>
            </div>
          </div>
          ${savedProjects.length > 0 ? `
          <div class="saved-projects-section">
            <h4>📁 Saved Projects (${savedProjects.length})</h4>
            <div class="saved-projects-list">
              ${savedProjects.map(p => `
                <div class="saved-project-item" data-key="${p.key}">
                  <div class="project-info">
                    <span class="project-name">${p.name}</span>
                    <span class="project-date">${new Date(p.savedAt).toLocaleDateString()}</span>
                  </div>
                  <div class="project-actions">
                    <button class="btn-small btn-load-project" data-key="${p.key}" title="Load">📂</button>
                    <button class="btn-small btn-delete-project" data-key="${p.key}" title="Delete">🗑️</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          ` : ''}
        </div>
      </div>
    `;
    
    this.container.appendChild(modal);
    modal.querySelector('#save-project-name')?.focus();
    
    modal.querySelector('#save-modal-close')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    
    modal.querySelector('#btn-save-local')?.addEventListener('click', () => {
      const name = modal.querySelector('#save-project-name')?.value.trim() || defaultName;
      this.saveToLocalStorage(name);
      modal.remove();
    });
    
    modal.querySelector('#btn-save-file')?.addEventListener('click', () => {
      this.saveToFile();
      modal.remove();
    });
    
    modal.querySelectorAll('.btn-load-project').forEach(btn => {
      btn.addEventListener('click', () => {
        this.loadFromLocalStorage(btn.dataset.key);
        modal.remove();
      });
    });
    
    modal.querySelectorAll('.btn-delete-project').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Delete this saved project?')) {
          this.deleteFromLocalStorage(btn.dataset.key);
          btn.closest('.saved-project-item')?.remove();
        }
      });
    });
  }

  saveToLocalStorage(name) {
    try {
      const data = this.getProjectData();
      data.projectName = name;
      data.savedAt = new Date().toISOString();
      
      const key = `launchsim_project_${Date.now()}`;
      localStorage.setItem(key, JSON.stringify(data));
      
      const index = JSON.parse(localStorage.getItem('launchsim_projects_index') || '[]');
      index.push({ key, name, savedAt: data.savedAt });
      localStorage.setItem('launchsim_projects_index', JSON.stringify(index));
      
      this.showNotification(`✅ Project "${name}" saved to browser storage`);
    } catch (error) {
      if (error.name === 'QuotaExceededError') {
        alert('Storage is full. Please delete some saved projects or download as file.');
      } else {
        alert(`Failed to save: ${error.message}`);
      }
    }
  }

  saveToFile() {
    const data = this.getProjectData();
    data.savedAt = new Date().toISOString();
    const json = JSON.stringify(data, null, 2);
    const filename = `${data.rocket?.name || 'launchsim-project'}.lsp.json`;
    this.downloadFile(filename, json, 'application/json');
    this.showNotification(`✅ Project downloaded as ${filename}`);
  }

  getProjectData() {
    return {
      version: '2.0',
      rocket: this.state.get('rocket'),
      motor: this.state.get('motor'),
      simulation: this.state.get('simulation'),
      weather: this.state.get('weather'),
      multiStage: this.multiStageConfig || null,
      recoveryConfig: this.getRecoveryConfig(),
      tvcConfig: this.getTVCConfig(),
      units: this.units
    };
  }

  getRecoveryConfig() {
    return {
      drogueDiameter: this.container.querySelector('#drogue-diameter')?.value,
      drogueType: this.container.querySelector('#drogue-type')?.value,
      mainDiameter: this.container.querySelector('#main-diameter')?.value,
      mainType: this.container.querySelector('#main-type')?.value,
      mainDeployAltitude: this.container.querySelector('#main-deploy-altitude')?.value,
      groundWindSpeed: this.container.querySelector('#ground-wind-speed')?.value,
      groundWindDirection: this.container.querySelector('#ground-wind-direction')?.value
    };
  }

  getSavedProjectsList() {
    try {
      const index = JSON.parse(localStorage.getItem('launchsim_projects_index') || '[]');
      return index.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));
    } catch { return []; }
  }

  loadProject() {
    this.showLoadDialog();
  }

  showLoadDialog() {
    const existingModal = this.container.querySelector('#load-modal');
    if (existingModal) existingModal.remove();
    
    const savedProjects = this.getSavedProjectsList();
    
    const modal = document.createElement('div');
    modal.id = 'load-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-content load-dialog">
        <div class="modal-header">
          <h3>📂 Load Project</h3>
          <button class="modal-close" id="load-modal-close">×</button>
        </div>
        <div class="modal-body">
          <div class="load-options">
            <div class="load-section">
              <h4>Load from File</h4>
              <p class="helper-text">Load a previously saved .json or .lsp.json file</p>
              <button class="btn btn-primary" id="btn-load-file">📁 Choose File</button>
              <input type="file" id="load-file-input" accept=".json,.lsp.json" hidden>
            </div>
          </div>
          ${savedProjects.length > 0 ? `
          <div class="saved-projects-section">
            <h4>📁 Browser Storage (${savedProjects.length} projects)</h4>
            <div class="saved-projects-list">
              ${savedProjects.map(p => `
                <div class="saved-project-item" data-key="${p.key}">
                  <div class="project-info">
                    <span class="project-name">${p.name}</span>
                    <span class="project-date">${new Date(p.savedAt).toLocaleDateString()} ${new Date(p.savedAt).toLocaleTimeString()}</span>
                  </div>
                  <div class="project-actions">
                    <button class="btn btn-small btn-primary btn-load-project" data-key="${p.key}">Load</button>
                    <button class="btn-small btn-delete-project" data-key="${p.key}" title="Delete">🗑️</button>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          ` : `
          <div class="no-projects">
            <p>No saved projects in browser storage.</p>
            <p class="helper-text">Save a project or load from file to get started.</p>
          </div>
          `}
        </div>
      </div>
    `;
    
    this.container.appendChild(modal);
    
    modal.querySelector('#load-modal-close')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    
    const fileInput = modal.querySelector('#load-file-input');
    modal.querySelector('#btn-load-file')?.addEventListener('click', () => fileInput?.click());
    
    fileInput?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        await this.loadFromFile(file);
        modal.remove();
      }
    });
    
    modal.querySelectorAll('.btn-load-project').forEach(btn => {
      btn.addEventListener('click', () => {
        this.loadFromLocalStorage(btn.dataset.key);
        modal.remove();
      });
    });
    
    modal.querySelectorAll('.btn-delete-project').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Delete this saved project?')) {
          this.deleteFromLocalStorage(btn.dataset.key);
          btn.closest('.saved-project-item')?.remove();
        }
      });
    });
  }

  async loadFromFile(file) {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      this.applyProjectData(data);
      this.showNotification(`✅ Project loaded from ${file.name}`);
    } catch (error) {
      alert(`Failed to load project: ${error.message}`);
    }
  }

  loadFromLocalStorage(key) {
    try {
      const data = JSON.parse(localStorage.getItem(key));
      if (!data) { alert('Project not found'); return; }
      this.applyProjectData(data);
      this.showNotification(`✅ Project "${data.projectName || 'Unnamed'}" loaded`);
    } catch (error) {
      alert(`Failed to load project: ${error.message}`);
    }
  }

  deleteFromLocalStorage(key) {
    try {
      localStorage.removeItem(key);
      let index = JSON.parse(localStorage.getItem('launchsim_projects_index') || '[]');
      index = index.filter(p => p.key !== key);
      localStorage.setItem('launchsim_projects_index', JSON.stringify(index));
      this.showNotification('🗑️ Project deleted');
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  }

  applyProjectData(data) {
    if (data.rocket) {
      this.state.set('rocket', data.rocket);
      this.currentRocket = data.rocket;
      this.updateStatus('rocket', data.rocket.name);
    }
    if (data.motor) {
      this.state.set('motor', data.motor);
      this.updateStatus('motor', data.motor.designation);
    }
    if (data.simulation) {
      this.state.set('simulation', data.simulation);
      this.lastSimResult = data.simulation;
    }
    if (data.weather) {
      this.state.set('weather', data.weather);
      this.currentWeather = data.weather.current;
    }
    if (data.multiStage) {
      this.multiStageConfig = data.multiStage;
    }
    if (data.units) {
      this.setUnitSystem(data.units);
      this.container.querySelectorAll('.unit-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.unit === data.units);
      });
    }
    if (data.recoveryConfig) {
      this.applyRecoveryConfig(data.recoveryConfig);
    }
    this.updateAllUnits();
    if (data.simulation) {
      this.renderFlightSummary(data.simulation);
      this.renderTrajectory(data.simulation);
    }
  }

  applyRecoveryConfig(config) {
    const fields = ['drogue-diameter', 'drogue-type', 'main-diameter', 'main-type', 
                    'main-deploy-altitude', 'ground-wind-speed', 'ground-wind-direction'];
    const configKeys = ['drogueDiameter', 'drogueType', 'mainDiameter', 'mainType',
                        'mainDeployAltitude', 'groundWindSpeed', 'groundWindDirection'];
    fields.forEach((field, i) => {
      if (config[configKeys[i]]) {
        const el = this.container.querySelector(`#${field}`);
        if (el) el.value = config[configKeys[i]];
      }
    });
  }

  showNotification(message, duration = 3000) {
    const existing = this.container.querySelector('.notification-toast');
    if (existing) existing.remove();
    
    const toast = document.createElement('div');
    toast.className = 'notification-toast';
    toast.textContent = message;
    this.container.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // ============================================
  // Utility
  // ============================================

  updateStatus(key, value) {
    const el = this.container.querySelector(`#status-${key}`);
    if (el) {
      const labels = {
        rocket: '🚀',
        motor: '🔥',
        weather: '🌤️'
      };
      el.textContent = `${labels[key] || ''} ${value}`;
    }
  }

  // ============================================
  // Integration - Altimeter Data Import
  // ============================================

  async importAltimeterData(file) {
    if (!this.modules.altimeterImporter) {
      this.showNotification('⚠️ Altimeter importer not available', 3000);
      return;
    }

    try {
      const formatSelect = this.container.querySelector('#altimeter-format-select');
      const formatHint = formatSelect?.value !== 'auto' ? formatSelect.value : null;

      const data = await this.modules.altimeterImporter.importFile(file, formatHint);
      this.lastAltimeterData = data;

      // Show results
      const resultsSection = this.container.querySelector('#altimeter-results');
      const summaryDiv = this.container.querySelector('#altimeter-summary');

      if (resultsSection && summaryDiv) {
        resultsSection.style.display = 'block';

        const analysis = data.analysis;
        const isMetric = this.options.units === 'metric';

        summaryDiv.innerHTML = `
          <div class="altimeter-summary-grid">
            <div class="summary-item">
              <span class="summary-label">Format:</span>
              <span class="summary-value">${data.formatName}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">File:</span>
              <span class="summary-value">${data.filename}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Data Points:</span>
              <span class="summary-value">${analysis.dataPoints.toLocaleString()}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Sample Rate:</span>
              <span class="summary-value">${analysis.sampleRate.toFixed(1)} Hz</span>
            </div>
            <div class="summary-item highlight">
              <span class="summary-label">Apogee:</span>
              <span class="summary-value">${isMetric ? analysis.apogee.toFixed(1) + ' m' : (analysis.apogee * 3.281).toFixed(0) + ' ft'}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Apogee Time:</span>
              <span class="summary-value">${analysis.apogeeTime.toFixed(2)} s</span>
            </div>
            <div class="summary-item highlight">
              <span class="summary-label">Max Velocity:</span>
              <span class="summary-value">${isMetric ? analysis.maxVelocity.toFixed(1) + ' m/s' : (analysis.maxVelocity * 3.281).toFixed(0) + ' fps'}</span>
            </div>
            <div class="summary-item">
              <span class="summary-label">Flight Time:</span>
              <span class="summary-value">${analysis.flightTime.toFixed(2)} s</span>
            </div>
          </div>
          <div class="detected-events">
            <h5>Detected Events</h5>
            <div class="events-list">
              ${data.events.map(evt => `
                <div class="event-item">
                  <span class="event-name">${evt.event}</span>
                  <span class="event-time">T+${evt.time.toFixed(2)}s</span>
                  <span class="event-alt">${isMetric ? evt.altitude.toFixed(1) + ' m' : (evt.altitude * 3.281).toFixed(0) + ' ft'}</span>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      }

      this.showNotification(`📊 Imported ${analysis.dataPoints} data points from ${data.formatName}`);

    } catch (error) {
      this.showNotification(`⚠️ Import failed: ${error.message}`, 4000);
      console.error('Altimeter import failed:', error);
    }
  }

  viewAltimeterIn3D() {
    if (!this.lastAltimeterData) {
      this.showNotification('⚠️ No altimeter data loaded');
      return;
    }

    // Switch to 3D view tab
    this.switchTab('3dview');

    // Load trajectory into 3D viewer
    setTimeout(() => {
      if (this.rocket3DViewer) {
        // Convert altimeter data to trajectory format
        const trajectory = this.lastAltimeterData.trajectory.map(point => ({
          time: point.time,
          position: { x: point.x || 0, y: point.altitude, z: point.y || 0 },
          velocity: { x: 0, y: point.velocity || 0, z: 0 }
        }));

        this.rocket3DViewer.loadTrajectory(trajectory, this.lastAltimeterData.events);
        this.showNotification('📊 Altimeter trajectory loaded in 3D viewer');
      }
    }, 100);
  }

  compareAltimeterWithSim() {
    if (!this.lastAltimeterData) {
      this.showNotification('⚠️ No altimeter data loaded');
      return;
    }

    if (!this.lastSimResult) {
      this.showNotification('⚠️ Run a simulation first to compare');
      return;
    }

    // Switch to Compare tab and populate comparison
    this.switchTab('compare');

    // Build comparison data
    const altData = this.lastAltimeterData.analysis;
    const simData = this.lastSimResult;

    const compSection = this.container.querySelector('#comparison-section');
    const compResults = this.container.querySelector('#comparison-results');

    if (compSection && compResults) {
      compSection.style.display = 'block';

      const apogeeDiff = ((simData.apogee - altData.apogee) / altData.apogee * 100);
      const velDiff = ((simData.maxVelocity - altData.maxVelocity) / altData.maxVelocity * 100);
      const timeDiff = simData.flightTime - altData.flightTime;

      compResults.innerHTML = `
        <div class="comparison-grid">
          <div class="comparison-header">
            <span></span>
            <span>Simulation</span>
            <span>Altimeter</span>
            <span>Difference</span>
          </div>
          <div class="comparison-row">
            <span>Apogee</span>
            <span>${simData.apogee.toFixed(1)} m</span>
            <span>${altData.apogee.toFixed(1)} m</span>
            <span class="${Math.abs(apogeeDiff) < 5 ? 'good' : Math.abs(apogeeDiff) < 10 ? 'warn' : 'bad'}">${apogeeDiff > 0 ? '+' : ''}${apogeeDiff.toFixed(1)}%</span>
          </div>
          <div class="comparison-row">
            <span>Max Velocity</span>
            <span>${simData.maxVelocity.toFixed(1)} m/s</span>
            <span>${altData.maxVelocity.toFixed(1)} m/s</span>
            <span class="${Math.abs(velDiff) < 5 ? 'good' : Math.abs(velDiff) < 10 ? 'warn' : 'bad'}">${velDiff > 0 ? '+' : ''}${velDiff.toFixed(1)}%</span>
          </div>
          <div class="comparison-row">
            <span>Flight Time</span>
            <span>${simData.flightTime.toFixed(2)} s</span>
            <span>${altData.flightTime.toFixed(2)} s</span>
            <span>${timeDiff > 0 ? '+' : ''}${timeDiff.toFixed(2)} s</span>
          </div>
        </div>
      `;

      // Draw comparison chart
      this.drawComparisonChart();
    }
  }

  drawComparisonChart() {
    const canvas = this.container.querySelector('#comparison-chart');
    if (!canvas || !this.lastAltimeterData || !this.lastSimResult) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    // Get data
    const altTraj = this.lastAltimeterData.rawData;
    const simTraj = this.lastSimResult.trajectory || [];

    if (altTraj.length === 0) return;

    // Find scales
    const maxTime = Math.max(
      altTraj[altTraj.length - 1]?.time || 0,
      simTraj[simTraj.length - 1]?.time || 0
    );
    const maxAlt = Math.max(
      ...altTraj.map(p => p.altitude),
      ...simTraj.map(p => p.position?.y || p.altitude || 0)
    );

    const padding = { left: 60, right: 20, top: 20, bottom: 40 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;

    // Draw axes
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padding.left, padding.top);
    ctx.lineTo(padding.left, height - padding.bottom);
    ctx.lineTo(width - padding.right, height - padding.bottom);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = '#666';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Time (s)', width / 2, height - 5);
    ctx.save();
    ctx.translate(15, height / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Altitude (m)', 0, 0);
    ctx.restore();

    // Draw altimeter data
    ctx.strokeStyle = '#2196F3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    altTraj.forEach((point, i) => {
      const x = padding.left + (point.time / maxTime) * chartW;
      const y = height - padding.bottom - (point.altitude / maxAlt) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw simulation data
    if (simTraj.length > 0) {
      ctx.strokeStyle = '#FF5722';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      simTraj.forEach((point, i) => {
        const t = point.time;
        const alt = point.position?.y || point.altitude || 0;
        const x = padding.left + (t / maxTime) * chartW;
        const y = height - padding.bottom - (alt / maxAlt) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Legend
    ctx.font = '11px sans-serif';
    ctx.fillStyle = '#2196F3';
    ctx.fillRect(width - 120, 10, 15, 3);
    ctx.fillText('Altimeter', width - 60, 14);
    ctx.fillStyle = '#FF5722';
    ctx.fillRect(width - 120, 25, 15, 3);
    ctx.fillText('Simulation', width - 60, 29);
  }

  exportAltimeterCSV() {
    if (!this.lastAltimeterData) {
      this.showNotification('⚠️ No altimeter data loaded');
      return;
    }

    const data = this.lastAltimeterData.rawData;
    let csv = 'Time (s),Altitude (m),Velocity (m/s),Acceleration (m/s²)\n';

    data.forEach(point => {
      csv += `${point.time.toFixed(3)},${point.altitude.toFixed(2)},${(point.velocity || 0).toFixed(2)},${(point.acceleration || 0).toFixed(2)}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `altimeter-data-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    this.showNotification('💾 Altimeter data exported as CSV');
  }

  saveAltimeterToFlightLog() {
    if (!this.lastAltimeterData) {
      this.showNotification('⚠️ No altimeter data loaded');
      return;
    }

    const analysis = this.lastAltimeterData.analysis;

    // Create flight record
    const record = {
      id: `flight_${Date.now()}`,
      date: new Date().toISOString(),
      rocketName: this.currentRocket?.name || 'Unknown',
      motorName: this.currentMotor?.name || 'Unknown',
      apogee: analysis.apogee,
      maxVelocity: analysis.maxVelocity,
      flightTime: analysis.flightTime,
      source: 'altimeter',
      altimeterFormat: this.lastAltimeterData.formatName,
      notes: `Imported from ${this.lastAltimeterData.filename}`,
      trajectory: this.modules.altimeterImporter?.sampleTrajectory?.(this.lastAltimeterData.rawData, 100) || this.lastAltimeterData.rawData.slice(0, 100),
      events: this.lastAltimeterData.events
    };

    // Add to flight log
    if (this.flightLog) {
      this.flightLog.records = this.flightLog.records || [];
      this.flightLog.records.push(record);
      this.saveFlightLogToStorage();
      this.updateFlightLogDisplay();
    }

    this.showNotification('📓 Flight saved to Flight Log');
  }

  // ============================================
  // Integration - GPS Tracking
  // ============================================

  async checkGPSAvailability() {
    if (!this.modules.gpsTracker) return;

    const status = await this.modules.gpsTracker.checkAvailability();
    const statusText = this.container.querySelector('#gps-status-text');
    const gpsDot = this.container.querySelector('#gps-dot');

    if (statusText) {
      if (!status.available) {
        statusText.textContent = 'GPS Unavailable';
        if (gpsDot) gpsDot.style.color = '#f44336';
      } else if (status.permission === 'granted') {
        statusText.textContent = 'GPS Ready';
        if (gpsDot) gpsDot.style.color = '#4CAF50';
      } else {
        statusText.textContent = 'GPS Available (permission needed)';
        if (gpsDot) gpsDot.style.color = '#FF9800';
      }
    }
  }

  async useCurrentLocation() {
    if (!this.modules.gpsTracker) {
      this.showNotification('⚠️ GPS not available');
      return;
    }

    try {
      const pos = await this.modules.gpsTracker.getCurrentPosition();

      const latInput = this.container.querySelector('#launch-lat');
      const lonInput = this.container.querySelector('#launch-lon');

      if (latInput) latInput.value = pos.lat.toFixed(6);
      if (lonInput) lonInput.value = pos.lon.toFixed(6);

      this.showNotification(`📍 Location: ${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}`);
    } catch (error) {
      this.showNotification(`⚠️ ${error.message}`, 3000);
    }
  }

  setGPSLaunchSite() {
    if (!this.modules.gpsTracker) return;

    const lat = parseFloat(this.container.querySelector('#launch-lat')?.value);
    const lon = parseFloat(this.container.querySelector('#launch-lon')?.value);

    if (isNaN(lat) || isNaN(lon)) {
      this.showNotification('⚠️ Enter valid coordinates');
      return;
    }

    this.modules.gpsTracker.setLaunchSite(lat, lon);
    this.showNotification(`📍 Launch site set: ${lat.toFixed(4)}, ${lon.toFixed(4)}`);
  }

  startGPSTracking() {
    if (!this.modules.gpsTracker) {
      this.showNotification('⚠️ GPS not available');
      return;
    }

    try {
      this.modules.gpsTracker.startTracking();

      // Update UI
      this.container.querySelector('#btn-start-gps')?.setAttribute('disabled', 'true');
      this.container.querySelector('#btn-stop-gps')?.removeAttribute('disabled');
      this.container.querySelector('#gps-tracking-panel').style.display = 'block';

      const statusText = this.container.querySelector('#gps-status-text');
      const gpsDot = this.container.querySelector('#gps-dot');
      if (statusText) statusText.textContent = 'Tracking...';
      if (gpsDot) gpsDot.style.color = '#4CAF50';

      this.showNotification('📍 GPS tracking started');
    } catch (error) {
      this.showNotification(`⚠️ ${error.message}`, 3000);
    }
  }

  stopGPSTracking() {
    if (!this.modules.gpsTracker) return;

    const trackPoints = this.modules.gpsTracker.stopTracking();

    // Update UI
    this.container.querySelector('#btn-start-gps')?.removeAttribute('disabled');
    this.container.querySelector('#btn-stop-gps')?.setAttribute('disabled', 'true');

    const statusText = this.container.querySelector('#gps-status-text');
    if (statusText) statusText.textContent = `Stopped (${trackPoints.length} points)`;

    this.showNotification(`📍 GPS tracking stopped - ${trackPoints.length} points recorded`);
  }

  handleGPSEvent(event, data) {
    switch (event) {
      case 'position':
        this.updateGPSDisplay(data);
        break;
      case 'error':
        this.showNotification(`⚠️ GPS Error: ${data.message}`, 3000);
        break;
    }
  }

  updateGPSDisplay(pos) {
    const posEl = this.container.querySelector('#gps-position');
    const altEl = this.container.querySelector('#gps-altitude');
    const speedEl = this.container.querySelector('#gps-speed');
    const distEl = this.container.querySelector('#gps-distance');
    const bearingEl = this.container.querySelector('#gps-bearing');
    const pointsEl = this.container.querySelector('#gps-track-points');
    const accEl = this.container.querySelector('#gps-accuracy-value');
    const accDiv = this.container.querySelector('#gps-accuracy');

    if (posEl) posEl.textContent = `${pos.lat.toFixed(6)}, ${pos.lon.toFixed(6)}`;
    if (altEl) altEl.textContent = `${pos.alt?.toFixed(1) || '--'} m`;
    if (speedEl) speedEl.textContent = pos.speed ? `${(pos.speed * 3.6).toFixed(1)} km/h` : '--';
    if (distEl && pos.distanceFromLaunch !== undefined) {
      distEl.textContent = `${pos.distanceFromLaunch.toFixed(0)} m`;
    }
    if (bearingEl && pos.bearing !== undefined) {
      bearingEl.textContent = `${pos.bearing.toFixed(0)}° ${this.getBearingDirection(pos.bearing)}`;
    }
    if (pointsEl && this.modules.gpsTracker) {
      pointsEl.textContent = this.modules.gpsTracker.trackPoints.length;
    }
    if (accEl && pos.accuracy) {
      accEl.textContent = pos.accuracy.toFixed(0);
      if (accDiv) accDiv.style.display = 'block';
    }
  }

  getBearingDirection(bearing) {
    const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
  }

  exportGPX() {
    if (!this.modules.gpsTracker) return;

    const gpx = this.modules.gpsTracker.exportGPX('LaunchSim Recovery Track');
    if (!gpx) {
      this.showNotification('⚠️ No track data to export');
      return;
    }

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `launchsim-track-${new Date().toISOString().split('T')[0]}.gpx`;
    a.click();
    URL.revokeObjectURL(url);

    this.showNotification('📁 GPX file exported');
  }

  viewGPSTrackIn3D() {
    if (!this.modules.gpsTracker || this.modules.gpsTracker.trackPoints.length === 0) {
      this.showNotification('⚠️ No GPS track data');
      return;
    }

    const trackPoints = this.modules.gpsTracker.trackPoints;
    const launchSite = this.modules.gpsTracker.launchSite;

    // Convert to trajectory format
    const startTime = trackPoints[0].timestamp;
    const trajectory = trackPoints.map(point => {
      // Convert lat/lon to meters from launch site
      let x = 0, z = 0;
      if (launchSite) {
        const dist = this.modules.gpsTracker.calculateDistance(
          launchSite.lat, launchSite.lon, point.lat, point.lon
        );
        const bearing = this.modules.gpsTracker.calculateBearing(
          launchSite.lat, launchSite.lon, point.lat, point.lon
        );
        x = dist * Math.sin(bearing * Math.PI / 180);
        z = dist * Math.cos(bearing * Math.PI / 180);
      }

      return {
        time: (point.timestamp - startTime) / 1000,
        position: { x, y: point.alt || 0, z },
        velocity: { x: 0, y: 0, z: point.speed || 0 }
      };
    });

    // Switch to 3D view and load
    this.switchTab('3dview');
    setTimeout(() => {
      if (this.rocket3DViewer) {
        this.rocket3DViewer.loadTrajectory(trajectory, []);
        this.showNotification('📍 GPS track loaded in 3D viewer');
      }
    }, 100);
  }

  openTrackInMaps() {
    if (!this.modules.gpsTracker) return;

    const pos = this.modules.gpsTracker.currentPosition;
    if (!pos) {
      this.showNotification('⚠️ No position data');
      return;
    }

    // Open in Google Maps
    const url = `https://www.google.com/maps?q=${pos.lat},${pos.lon}`;
    window.open(url, '_blank');
  }

  async importGPXFile(file) {
    if (!this.modules.gpsTracker) return;

    try {
      const text = await file.text();
      const trackPoints = this.modules.gpsTracker.importGPX(text);
      
      const summary = this.modules.gpsTracker.getTrackSummary();
      this.showNotification(`📥 Imported ${trackPoints.length} points (${(summary.totalDistance / 1000).toFixed(2)} km)`);

      // Update display
      this.container.querySelector('#gps-tracking-panel').style.display = 'block';
      this.container.querySelector('#gps-track-points').textContent = trackPoints.length;

    } catch (error) {
      this.showNotification(`⚠️ GPX import failed: ${error.message}`, 3000);
    }
  }

  // ============================================
  // Integration - Club Sharing
  // ============================================

  switchClubTab(tabId) {
    this.container.querySelectorAll('.club-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.clubTab === tabId);
    });

    this.container.querySelectorAll('.club-tab-content').forEach(content => {
      content.style.display = content.id === `club-tab-${tabId}` ? 'block' : 'none';
    });
  }

  updateClubList() {
    if (!this.modules.clubSharing) return;

    const clubs = this.modules.clubSharing.getAllClubs();
    const listEl = this.container.querySelector('#club-list');
    const filterSelect = this.container.querySelector('#club-filter-select');

    if (listEl) {
      if (clubs.length === 0) {
        listEl.innerHTML = `
          <div class="no-clubs">
            <p>No clubs yet. Create or join a club to share flights!</p>
          </div>
        `;
      } else {
        listEl.innerHTML = clubs.map(club => `
          <div class="club-card" data-club-id="${club.id}">
            <div class="club-info">
              <h4>${club.name}</h4>
              <p>${club.description || ''}</p>
              <div class="club-meta">
                <span>👥 ${club.members.length} members</span>
                <span>🚀 ${club.flights.length} flights</span>
                <span>🏆 ${club.competitions.length} competitions</span>
              </div>
            </div>
            <div class="club-actions">
              <button class="btn btn-small" onclick="app.viewClub('${club.id}')">View</button>
              <button class="btn btn-small" onclick="app.showClubStats('${club.id}')">📊 Stats</button>
              <button class="btn btn-small btn-danger" onclick="app.deleteClub('${club.id}')">🗑️</button>
            </div>
          </div>
        `).join('');
      }
    }

    // Update filter dropdown
    if (filterSelect) {
      filterSelect.innerHTML = `
        <option value="">All Clubs</option>
        ${clubs.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
      `;
    }
  }

  showCreateClubModal() {
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'create-club-modal';
    modal.innerHTML = `
      <div class="modal-dialog" style="max-width: 500px;">
        <div class="modal-header">
          <h3>➕ Create New Club</h3>
          <button class="modal-close" onclick="document.getElementById('create-club-modal').remove()">×</button>
        </div>
        <div class="modal-body">
          <form id="create-club-form">
            <div class="form-row">
              <label>Club Name *</label>
              <input type="text" name="name" required placeholder="e.g., Bay Area Rocketry Club">
            </div>
            <div class="form-row">
              <label>Description</label>
              <textarea name="description" rows="3" placeholder="Tell others about your club..."></textarea>
            </div>
            <div class="form-row">
              <label>Location</label>
              <input type="text" name="location" placeholder="e.g., San Francisco, CA">
            </div>
            <div class="form-row">
              <label>Your Name</label>
              <input type="text" name="userName" placeholder="Your display name">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" onclick="document.getElementById('create-club-modal').remove()">Cancel</button>
              <button type="submit" class="btn btn-primary">Create Club</button>
            </div>
          </form>
        </div>
      </div>
    `;

    this.container.appendChild(modal);

    document.getElementById('create-club-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      this.createClub({
        name: formData.get('name'),
        description: formData.get('description'),
        location: formData.get('location'),
        members: [{
          name: formData.get('userName') || 'Club Creator',
          role: 'admin'
        }]
      });
      modal.remove();
    });
  }

  createClub(clubData) {
    if (!this.modules.clubSharing) return;

    const club = this.modules.clubSharing.createClub(clubData);
    this.updateClubList();
    this.showNotification(`👥 Club "${club.name}" created!`);
  }

  viewClub(clubId) {
    const club = this.modules.clubSharing?.getClub(clubId);
    if (!club) return;

    this.currentClubId = clubId;
    this.switchClubTab('flights');
    this.updateSharedFlightsList(clubId);
    this.updateCompetitionsList(clubId);
  }

  deleteClub(clubId) {
    if (!confirm('Are you sure you want to delete this club? This cannot be undone.')) return;

    this.modules.clubSharing?.deleteClub(clubId);
    this.updateClubList();
    this.showNotification('🗑️ Club deleted');
  }

  showClubStats(clubId) {
    const stats = this.modules.clubSharing?.getClubStatistics(clubId);
    if (!stats) return;

    const statsEl = this.container.querySelector('#club-statistics');
    if (statsEl) {
      statsEl.innerHTML = `
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-value">${stats.totalFlights}</span>
            <span class="stat-label">Total Flights</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${stats.memberCount}</span>
            <span class="stat-label">Members</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${stats.activeCompetitions}</span>
            <span class="stat-label">Active Competitions</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${stats.maxApogee.toFixed(0)} m</span>
            <span class="stat-label">Highest Apogee</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${stats.averageApogee.toFixed(0)} m</span>
            <span class="stat-label">Avg Apogee</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${stats.maxVelocity.toFixed(0)} m/s</span>
            <span class="stat-label">Max Velocity</span>
          </div>
        </div>
        ${stats.topRockets.length > 0 ? `
        <div class="top-rockets">
          <h5>🚀 Top Rockets</h5>
          ${stats.topRockets.map((r, i) => `<span>${i + 1}. ${r.name} (${r.count})</span>`).join('<br>')}
        </div>
        ` : ''}
      `;
    }
  }

  shareCurrentFlight() {
    if (!this.lastSimResult) {
      this.showNotification('⚠️ Run a simulation first');
      return;
    }

    const clubs = this.modules.clubSharing?.getAllClubs() || [];
    if (clubs.length === 0) {
      this.showNotification('⚠️ Create a club first');
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'share-flight-modal';
    modal.innerHTML = `
      <div class="modal-dialog" style="max-width: 450px;">
        <div class="modal-header">
          <h3>📤 Share Flight</h3>
          <button class="modal-close" onclick="document.getElementById('share-flight-modal').remove()">×</button>
        </div>
        <div class="modal-body">
          <form id="share-flight-form">
            <div class="form-row">
              <label>Select Club *</label>
              <select name="clubId" required>
                ${clubs.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
              </select>
            </div>
            <div class="flight-preview">
              <p><strong>Rocket:</strong> ${this.currentRocket?.name || 'Unknown'}</p>
              <p><strong>Motor:</strong> ${this.currentMotor?.name || 'Unknown'}</p>
              <p><strong>Apogee:</strong> ${this.lastSimResult.apogee.toFixed(1)} m</p>
              <p><strong>Max Velocity:</strong> ${this.lastSimResult.maxVelocity.toFixed(1)} m/s</p>
            </div>
            <div class="form-row">
              <label>Notes</label>
              <textarea name="notes" rows="2" placeholder="Add notes about this flight..."></textarea>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" onclick="document.getElementById('share-flight-modal').remove()">Cancel</button>
              <button type="submit" class="btn btn-primary">Share Flight</button>
            </div>
          </form>
        </div>
      </div>
    `;

    this.container.appendChild(modal);

    document.getElementById('share-flight-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      
      this.modules.clubSharing.shareFlightWithClub(
        formData.get('clubId'),
        this.lastSimResult,
        {
          rocketName: this.currentRocket?.name || 'Unknown',
          motorName: this.currentMotor?.name || 'Unknown',
          notes: formData.get('notes'),
          launchDate: new Date().toISOString()
        }
      );

      modal.remove();
      this.updateClubList();
      this.showNotification('📤 Flight shared with club!');
    });
  }

  updateSharedFlightsList(clubId) {
    const flights = this.modules.clubSharing?.getClubFlights(clubId || this.currentClubId) || [];
    const listEl = this.container.querySelector('#shared-flights-list');

    if (listEl) {
      if (flights.length === 0) {
        listEl.innerHTML = '<div class="no-flights"><p>No shared flights yet.</p></div>';
      } else {
        listEl.innerHTML = flights.map(flight => `
          <div class="shared-flight-card">
            <div class="flight-info">
              <span class="flight-rocket">${flight.metadata.rocketName}</span>
              <span class="flight-motor">${flight.metadata.motorName}</span>
              <span class="flight-date">${new Date(flight.sharedAt).toLocaleDateString()}</span>
            </div>
            <div class="flight-stats">
              <span>🎯 ${flight.summary.apogee.toFixed(0)} m</span>
              <span>⚡ ${flight.summary.maxVelocity.toFixed(0)} m/s</span>
            </div>
            <div class="flight-actions">
              <button class="btn btn-tiny" onclick="app.loadSharedFlight('${clubId}', '${flight.id}')">📂 Load</button>
              <button class="btn btn-tiny" onclick="app.viewSharedFlightIn3D('${clubId}', '${flight.id}')">🎮 3D</button>
            </div>
          </div>
        `).join('');
      }
    }
  }

  filterSharedFlights(clubId) {
    this.currentClubId = clubId || null;
    this.updateSharedFlightsList(clubId);
  }

  loadSharedFlight(clubId, flightId) {
    const club = this.modules.clubSharing?.getClub(clubId);
    if (!club) return;

    const flight = club.flights.find(f => f.id === flightId);
    if (!flight) return;

    // Set as last sim result for comparison
    this.lastSimResult = {
      apogee: flight.summary.apogee,
      maxVelocity: flight.summary.maxVelocity,
      flightTime: flight.summary.flightTime,
      trajectory: flight.trajectory,
      events: flight.events
    };

    this.switchTab('results');
    this.showNotification(`📂 Loaded flight: ${flight.metadata.rocketName}`);
  }

  viewSharedFlightIn3D(clubId, flightId) {
    const club = this.modules.clubSharing?.getClub(clubId);
    if (!club) return;

    const flight = club.flights.find(f => f.id === flightId);
    if (!flight || !flight.trajectory) return;

    this.switchTab('3dview');
    setTimeout(() => {
      if (this.rocket3DViewer) {
        this.rocket3DViewer.loadTrajectory(flight.trajectory, flight.events || []);
        this.showNotification(`🎮 Viewing: ${flight.metadata.rocketName}`);
      }
    }, 100);
  }

  showCreateCompetitionModal() {
    const clubs = this.modules.clubSharing?.getAllClubs() || [];
    if (clubs.length === 0) {
      this.showNotification('⚠️ Create a club first');
      return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'create-comp-modal';
    modal.innerHTML = `
      <div class="modal-dialog" style="max-width: 500px;">
        <div class="modal-header">
          <h3>🏆 Create Competition</h3>
          <button class="modal-close" onclick="document.getElementById('create-comp-modal').remove()">×</button>
        </div>
        <div class="modal-body">
          <form id="create-comp-form">
            <div class="form-row">
              <label>Club *</label>
              <select name="clubId" required>
                ${clubs.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
              </select>
            </div>
            <div class="form-row">
              <label>Competition Name *</label>
              <input type="text" name="name" required placeholder="e.g., Spring Altitude Challenge">
            </div>
            <div class="form-row">
              <label>Scoring Method</label>
              <select name="scoringMethod">
                <option value="highest">Highest Altitude Wins</option>
                <option value="closest">Closest to Target Altitude</option>
                <option value="duration">Longest Flight Duration</option>
                <option value="tarc">TARC-Style (Altitude + Duration)</option>
              </select>
            </div>
            <div class="form-row" id="target-alt-row">
              <label>Target Altitude (m)</label>
              <input type="number" name="targetAltitude" value="256" min="50" max="3000">
            </div>
            <div class="form-row">
              <label>Max Motor Class</label>
              <select name="maxMotorClass">
                <option value="">No Limit</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D</option>
                <option value="E">E</option>
                <option value="F">F</option>
                <option value="G">G</option>
              </select>
            </div>
            <div class="form-row">
              <label>End Date</label>
              <input type="date" name="endDate">
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-secondary" onclick="document.getElementById('create-comp-modal').remove()">Cancel</button>
              <button type="submit" class="btn btn-primary">Create Competition</button>
            </div>
          </form>
        </div>
      </div>
    `;

    this.container.appendChild(modal);

    // Toggle target altitude based on scoring method
    document.querySelector('#create-comp-form select[name="scoringMethod"]').addEventListener('change', (e) => {
      document.getElementById('target-alt-row').style.display = 
        ['closest', 'tarc'].includes(e.target.value) ? 'flex' : 'none';
    });

    document.getElementById('create-comp-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      
      this.modules.clubSharing.createCompetition(formData.get('clubId'), {
        name: formData.get('name'),
        scoringMethod: formData.get('scoringMethod'),
        targetAltitude: parseFloat(formData.get('targetAltitude')) || null,
        maxMotorClass: formData.get('maxMotorClass') || null,
        endDate: formData.get('endDate') || null,
        status: 'active'
      });

      modal.remove();
      this.updateCompetitionsList();
      this.showNotification('🏆 Competition created!');
    });
  }

  updateCompetitionsList(clubId) {
    const clubs = this.modules.clubSharing?.getAllClubs() || [];
    const listEl = this.container.querySelector('#competitions-list');

    if (!listEl) return;

    const allComps = [];
    clubs.forEach(club => {
      if (!clubId || club.id === clubId) {
        club.competitions.forEach(comp => {
          allComps.push({ ...comp, clubName: club.name });
        });
      }
    });

    if (allComps.length === 0) {
      listEl.innerHTML = '<div class="no-competitions"><p>No active competitions.</p></div>';
    } else {
      listEl.innerHTML = allComps.map(comp => `
        <div class="competition-card ${comp.status}">
          <div class="comp-header">
            <h4>${comp.name}</h4>
            <span class="comp-status">${comp.status}</span>
          </div>
          <div class="comp-details">
            <span>👥 ${comp.clubName}</span>
            <span>🎯 ${comp.rules.scoringMethod === 'highest' ? 'Highest Altitude' : 
                      comp.rules.scoringMethod === 'closest' ? `Target: ${comp.rules.targetAltitude}m` :
                      comp.rules.scoringMethod === 'duration' ? 'Longest Duration' : 'TARC Style'}</span>
            <span>📋 ${comp.entries.length} entries</span>
          </div>
          <div class="comp-actions">
            ${comp.status === 'active' ? `
              <button class="btn btn-small btn-primary" onclick="app.submitToCompetition('${comp.clubId}', '${comp.id}')">Submit Entry</button>
            ` : ''}
            <button class="btn btn-small" onclick="app.showLeaderboard('${comp.clubId}', '${comp.id}')">📊 Leaderboard</button>
          </div>
        </div>
      `).join('');
    }
  }

  submitToCompetition(clubId, compId) {
    if (!this.lastSimResult) {
      this.showNotification('⚠️ Run a simulation first');
      return;
    }

    const userName = prompt('Enter your name for the leaderboard:');
    if (!userName) return;

    try {
      const entry = this.modules.clubSharing.submitCompetitionEntry(clubId, compId, {
        userName,
        rocketName: this.currentRocket?.name || 'Unknown',
        motorName: this.currentMotor?.name || 'Unknown',
        apogee: this.lastSimResult.apogee,
        maxVelocity: this.lastSimResult.maxVelocity,
        flightTime: this.lastSimResult.flightTime
      });

      this.showNotification(`🏆 Entry submitted! Score: ${entry.score.toFixed(1)}`);
      this.updateCompetitionsList();
    } catch (error) {
      this.showNotification(`⚠️ ${error.message}`, 3000);
    }
  }

  showLeaderboard(clubId, compId) {
    const leaderboard = this.modules.clubSharing?.getLeaderboard(clubId, compId) || [];
    const competition = this.modules.clubSharing?.getCompetition(clubId, compId);

    if (!competition) return;

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.id = 'leaderboard-modal';
    modal.innerHTML = `
      <div class="modal-dialog" style="max-width: 600px;">
        <div class="modal-header">
          <h3>📊 ${competition.name} - Leaderboard</h3>
          <button class="modal-close" onclick="document.getElementById('leaderboard-modal').remove()">×</button>
        </div>
        <div class="modal-body">
          ${leaderboard.length === 0 ? '<p class="no-data">No entries yet.</p>' : `
          <table class="leaderboard-table">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Name</th>
                <th>Rocket</th>
                <th>Score</th>
                <th>Apogee</th>
              </tr>
            </thead>
            <tbody>
              ${leaderboard.map(entry => `
                <tr class="${entry.rank <= 3 ? 'top-' + entry.rank : ''}">
                  <td>${entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : entry.rank}</td>
                  <td>${entry.userName}</td>
                  <td>${entry.rocketName}</td>
                  <td><strong>${entry.score.toFixed(1)}</strong></td>
                  <td>${entry.flightData.apogee.toFixed(1)} m</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          `}
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="document.getElementById('leaderboard-modal').remove()">Close</button>
        </div>
      </div>
    `;

    this.container.appendChild(modal);
  }

  importClubData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      if (e.target.files.length > 0) {
        try {
          const text = await e.target.files[0].text();
          const data = JSON.parse(text);
          this.modules.clubSharing.importClub(data);
          this.updateClubList();
          this.showNotification('📥 Club data imported!');
        } catch (error) {
          this.showNotification(`⚠️ Import failed: ${error.message}`, 3000);
        }
      }
    };
    input.click();
  }

  // ============================================
  // Styles
  // ============================================

  injectStyles() {
    if (document.getElementById('launchsim-styles')) return;

    const style = document.createElement('style');
    style.id = 'launchsim-styles';
    style.textContent = `
      .launchsim-app {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        display: flex;
        flex-direction: column;
        height: 100vh;
        background: #f5f5f5;
      }

      .app-header {
        display: flex;
        align-items: center;
        padding: 10px 20px;
        background: #000000;
        color: white;
        box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        min-height: 60px;
        flex-wrap: wrap;
        gap: 10px;
      }

      .logo {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-right: 20px;
        flex-shrink: 0;
      }

      .logo-icon { font-size: 28px; }
      .logo-text { font-size: 22px; font-weight: 700; letter-spacing: -0.5px; }
      .logo-version { 
        font-size: 10px; 
        background: rgba(255,255,255,0.15); 
        padding: 2px 8px; 
        border-radius: 10px;
        font-weight: 500;
        border: 1px solid rgba(255,255,255,0.2);
      }

      .main-nav {
        display: flex;
        gap: 5px;
        flex: 1;
        flex-wrap: wrap;
        min-width: 0;
      }

      .nav-btn {
        background: transparent;
        border: none;
        color: rgba(255,255,255,0.7);
        padding: 8px 12px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        border-radius: 6px;
        transition: all 0.2s;
        white-space: nowrap;
      }

      .nav-btn:hover { background: rgba(255,255,255,0.15); color: white; }
      .nav-btn.active { background: rgba(255,255,255,0.25); color: white; }

      .header-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        margin-left: auto;
      }

      .header-divider {
        width: 1px;
        height: 24px;
        background: rgba(255,255,255,0.3);
        margin: 0 4px;
      }

      .btn-icon {
        background: transparent;
        border: none;
        font-size: 20px;
        cursor: pointer;
        padding: 8px;
        border-radius: 6px;
        transition: background 0.2s;
        flex-shrink: 0;
      }

      .btn-icon:hover { background: rgba(255,255,255,0.1); }

      .app-main {
        flex: 1;
        overflow: auto;
        padding: 20px;
      }

      .tab-content {
        display: none;
        animation: fadeIn 0.3s;
      }

      .tab-content.active { display: block; }

      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      .panel-section {
        background: white;
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 20px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.08);
      }

      .panel-section h3 {
        margin: 0 0 15px 0;
        font-size: 16px;
        color: #333;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .dropzone {
        border: 2px dashed #ccc;
        border-radius: 12px;
        padding: 40px;
        text-align: center;
        cursor: pointer;
        transition: all 0.2s;
        background: #fafafa;
      }

      .dropzone:hover, .dropzone.dragover {
        border-color: #000;
        background: #f5f5f5;
      }

      .dropzone-icon { font-size: 48px; display: block; margin-bottom: 10px; }
      .dropzone-text { color: #666; }

      .form-group { margin-bottom: 20px; }
      .form-group h4 { 
        margin: 0 0 10px 0; 
        font-size: 14px; 
        color: #666;
        border-bottom: 1px solid #eee;
        padding-bottom: 5px;
      }

      .form-row {
        display: flex;
        align-items: center;
        margin-bottom: 10px;
        gap: 10px;
      }

      .form-row label {
        min-width: 140px;
        font-size: 13px;
        color: #555;
      }

      .form-row input, .form-row select {
        flex: 1;
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 6px;
        font-size: 14px;
      }

      .form-row input:focus, .form-row select:focus {
        outline: none;
        border-color: #000;
        box-shadow: 0 0 0 3px rgba(0,0,0,0.1);
      }

      .form-row.checkbox {
        gap: 8px;
      }

      .form-row.checkbox label {
        min-width: auto;
      }

      .btn {
        padding: 10px 20px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .btn-primary {
        background: #000;
        color: white;
      }

      .btn-primary:hover { background: #333; }

      .btn-secondary {
        background: #e0e0e0;
        color: #333;
      }

      .btn-secondary:hover { background: #d0d0d0; }

      .btn-large {
        padding: 15px 30px;
        font-size: 16px;
      }

      .btn-small {
        padding: 5px 10px;
        font-size: 12px;
      }

      .sim-actions {
        display: flex;
        gap: 15px;
        margin-bottom: 20px;
      }

      .progress-container {
        margin-top: 15px;
      }

      .progress-bar {
        height: 8px;
        background: #e0e0e0;
        border-radius: 4px;
        overflow: hidden;
      }

      .progress-fill {
        height: 100%;
        background: #4caf50;
        transition: width 0.3s;
      }

      .progress-text {
        font-size: 12px;
        color: #666;
        margin-top: 5px;
        display: block;
      }

      .motor-list {
        display: grid;
        gap: 10px;
        max-height: 400px;
        overflow-y: auto;
      }

      .motor-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 15px;
        background: #f8f9fa;
        border-radius: 8px;
        border: 1px solid #eee;
      }

      .motor-card:hover { border-color: #000; }

      .motor-name { font-weight: 600; color: #333; }
      .motor-specs { 
        display: flex; 
        gap: 15px; 
        font-size: 13px; 
        color: #666; 
      }

      .weather-current { padding: 10px 0; }
      
      .weather-main {
        display: flex;
        align-items: center;
        gap: 20px;
        margin-bottom: 20px;
      }

      .temperature { font-size: 36px; font-weight: 700; color: #333; }
      .conditions { font-size: 18px; color: #666; }

      .safety-badge {
        padding: 5px 12px;
        border-radius: 20px;
        font-weight: 600;
        font-size: 13px;
      }

      .safety-badge.good { background: #c8e6c9; color: #2e7d32; }
      .safety-badge.moderate { background: #fff3e0; color: #ef6c00; }
      .safety-badge.poor { background: #ffcdd2; color: #c62828; }

      .weather-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 15px;
      }

      .weather-item {
        text-align: center;
        padding: 10px;
        background: #f8f9fa;
        border-radius: 8px;
      }

      .weather-item .label { display: block; font-size: 12px; color: #999; }
      .weather-item .value { display: block; font-size: 18px; font-weight: 600; color: #333; }
      .weather-item .detail { display: block; font-size: 11px; color: #666; }

      .recommendations {
        margin-top: 20px;
      }

      .rec {
        padding: 8px 12px;
        margin-bottom: 8px;
        border-radius: 6px;
        font-size: 13px;
      }

      .rec-success { background: #e8f5e9; color: #2e7d32; }
      .rec-info { background: #e3f2fd; color: #1565c0; }
      .rec-caution { background: #fff3e0; color: #ef6c00; }
      .rec-warning { background: #fff8e1; color: #f9a825; }
      .rec-danger { background: #ffebee; color: #c62828; }

      .quick-stats {
        display: flex;
        gap: 20px;
        flex-wrap: wrap;
      }

      .stat {
        text-align: center;
        padding: 15px 25px;
        background: #e3f2fd;
        border-radius: 10px;
      }

      .stat-value { display: block; font-size: 24px; font-weight: 700; color: #1565c0; }
      .stat-label { display: block; font-size: 12px; color: #666; margin-top: 5px; }

      .summary-table, .events-table, .preview-table, .detail-table, .mc-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }

      .summary-table th, .events-table th, .preview-table th, 
      .detail-table th, .mc-table th {
        text-align: left;
        padding: 8px 12px;
        background: #f5f5f5;
        color: #666;
        font-weight: 500;
      }

      .summary-table td, .events-table td, .preview-table td,
      .detail-table td, .mc-table td {
        padding: 8px 12px;
        border-bottom: 1px solid #eee;
      }

      .trajectory-view, .mc-charts {
        display: flex;
        gap: 20px;
        flex-wrap: wrap;
        justify-content: center;
      }

      .export-actions {
        display: flex;
        gap: 10px;
      }

      .app-footer {
        padding: 10px 20px;
        background: #fff;
        border-top: 1px solid #eee;
      }

      .status-bar {
        display: flex;
        gap: 30px;
        font-size: 13px;
        color: #666;
      }

      .placeholder {
        color: #999;
        font-style: italic;
        text-align: center;
        padding: 20px;
      }

      .loading { color: #1565c0; }
      .error { color: #c62828; }

      canvas {
        border-radius: 8px;
        background: #fff;
      }

      /* Optimizer Styles */
      .section-desc {
        color: #666;
        margin-bottom: 20px;
      }

      .optimizer-form {
        max-width: 500px;
      }

      .input-row {
        display: flex;
        gap: 10px;
      }

      .input-row input {
        flex: 2;
      }

      .input-row select {
        flex: 1;
      }

      .constraint-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 15px;
      }

      .constraint-item label {
        display: block;
        font-size: 12px;
        color: #666;
        margin-bottom: 5px;
      }

      .opt-results-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin: 15px 0;
      }

      .opt-result-card {
        display: flex;
        align-items: center;
        gap: 15px;
        padding: 12px 15px;
        background: #f8f9fa;
        border-radius: 8px;
        border: 2px solid transparent;
      }

      .opt-result-card.best-match {
        border-color: #4caf50;
        background: #e8f5e9;
      }

      .opt-rank {
        font-size: 18px;
        font-weight: 700;
        color: #666;
        min-width: 40px;
      }

      .opt-motor-info {
        flex: 2;
      }

      .opt-motor-name {
        display: block;
        font-weight: 600;
        color: #333;
      }

      .opt-motor-detail {
        font-size: 12px;
        color: #666;
      }

      .opt-prediction {
        flex: 1;
        text-align: center;
      }

      .opt-apogee {
        display: block;
        font-size: 18px;
        font-weight: 700;
        color: #1565c0;
      }

      .opt-delay {
        font-size: 12px;
        color: #666;
      }

      .opt-score {
        min-width: 80px;
        text-align: center;
        font-weight: 500;
      }

      .opt-best-summary {
        background: #e8f5e9;
        padding: 15px 20px;
        border-radius: 10px;
        border-left: 4px solid #4caf50;
      }

      .opt-best-summary h4 {
        margin: 0 0 10px 0;
        color: #2e7d32;
      }

      .opt-best-summary p {
        margin: 5px 0;
        color: #333;
      }

      /* Flight Data Styles */
      .import-dropzone {
        border: 2px dashed #ccc;
        border-radius: 12px;
        padding: 40px;
        text-align: center;
        cursor: pointer;
        transition: all 0.2s;
        background: #fafafa;
      }

      .import-dropzone:hover,
      .import-dropzone.dragover {
        border-color: #000;
        background: #f5f5f5;
      }

      .dropzone-formats {
        display: block;
        font-size: 12px;
        color: #999;
        margin-top: 10px;
      }

      .fd-stats-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 15px;
        margin-bottom: 15px;
      }

      .fd-stat {
        text-align: center;
        padding: 15px;
        background: #fff3e0;
        border-radius: 8px;
      }

      .fd-stat-value {
        display: block;
        font-size: 20px;
        font-weight: 700;
        color: #e65100;
      }

      .fd-stat-label {
        display: block;
        font-size: 11px;
        color: #666;
        margin-top: 5px;
      }

      .fd-file-info {
        font-size: 13px;
        color: #666;
      }

      .comparison-score {
        text-align: center;
        padding: 20px;
        border-radius: 12px;
        margin-bottom: 20px;
      }

      .comparison-score.good {
        background: #e8f5e9;
      }

      .comparison-score.fair {
        background: #fff3e0;
      }

      .comparison-score.poor {
        background: #ffebee;
      }

      .comparison-score .score-value {
        display: block;
        font-size: 48px;
        font-weight: 700;
      }

      .comparison-score.good .score-value { color: #2e7d32; }
      .comparison-score.fair .score-value { color: #ef6c00; }
      .comparison-score.poor .score-value { color: #c62828; }

      .comparison-score .score-label {
        font-size: 14px;
        color: #666;
      }

      .comparison-table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 20px;
      }

      .comparison-table th,
      .comparison-table td {
        padding: 10px 15px;
        text-align: left;
        border-bottom: 1px solid #eee;
      }

      .comparison-table th {
        background: #f5f5f5;
        font-weight: 500;
        color: #666;
      }

      .comparison-table td.good {
        color: #2e7d32;
        font-weight: 500;
      }

      .comparison-table td.warn {
        color: #ef6c00;
        font-weight: 500;
      }

      .comparison-chart-container {
        margin-top: 20px;
      }

      /* Flutter Analysis Styles */
      .flutter-analysis-section {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
      }

      @media (max-width: 900px) {
        .flutter-analysis-section {
          grid-template-columns: 1fr;
        }
      }

      .flutter-form-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 15px;
        margin-bottom: 15px;
      }

      .flutter-results {
        background: #f8f9fa;
        border-radius: 10px;
        padding: 20px;
      }

      .flutter-result-status {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        border-radius: 8px;
        margin-bottom: 15px;
        font-weight: 600;
        font-size: 18px;
      }

      .flutter-result-status.safe {
        background: #e8f5e9;
        color: #2e7d32;
      }

      .flutter-result-status.caution {
        background: #fff3e0;
        color: #e65100;
      }

      .flutter-result-status.warning {
        background: #fff8e1;
        color: #f57f17;
      }

      .flutter-result-status.danger {
        background: #ffebee;
        color: #c62828;
      }

      .flutter-result-status .status-icon {
        font-size: 24px;
      }

      .flutter-stats-row {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
        margin-bottom: 15px;
      }

      @media (max-width: 600px) {
        .flutter-stats-row {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      .flutter-stat {
        text-align: center;
        padding: 12px 8px;
        background: white;
        border-radius: 8px;
        border: 1px solid #e0e0e0;
      }

      .flutter-stat.highlight {
        border-color: #1565c0;
        background: #e3f2fd;
      }

      .flutter-stat-value {
        display: block;
        font-size: 22px;
        font-weight: 700;
        color: #333;
      }

      .flutter-stat.highlight .flutter-stat-value {
        color: #1565c0;
      }

      .flutter-stat-unit {
        font-size: 12px;
        color: #666;
      }

      .flutter-stat-label {
        display: block;
        font-size: 11px;
        color: #666;
        margin-top: 4px;
      }

      .flutter-recommendation {
        padding: 12px 16px;
        border-radius: 8px;
        font-size: 14px;
        margin-bottom: 15px;
      }

      .flutter-recommendation.safe {
        background: #e8f5e9;
        color: #2e7d32;
        border-left: 4px solid #4caf50;
      }

      .flutter-recommendation.caution {
        background: #fff3e0;
        color: #e65100;
        border-left: 4px solid #ff9800;
      }

      .flutter-recommendation.warning {
        background: #fff8e1;
        color: #f57f17;
        border-left: 4px solid #ffc107;
      }

      .flutter-recommendation.danger {
        background: #ffebee;
        color: #c62828;
        border-left: 4px solid #f44336;
      }

      .flutter-suggestion {
        padding: 12px 16px;
        background: #e3f2fd;
        border-radius: 8px;
        font-size: 13px;
        color: #1565c0;
        margin-bottom: 15px;
      }

      .flutter-details {
        font-size: 13px;
      }

      .flutter-details summary {
        cursor: pointer;
        color: #666;
        padding: 8px 0;
      }

      .flutter-detail-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
      }

      .flutter-detail-table td {
        padding: 6px 10px;
        border-bottom: 1px solid #eee;
      }

      .flutter-detail-table td:first-child {
        color: #666;
        width: 50%;
      }

      .flutter-detail-table td:last-child {
        font-weight: 500;
      }

      /* Stability Analysis Styles */
      .stability-section {
        background: #f8f9fa;
        border-radius: 10px;
        padding: 20px;
      }

      .stability-result-status {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 18px;
        border-radius: 10px;
        margin-bottom: 20px;
        font-size: 16px;
      }

      .stability-result-status.safe {
        background: linear-gradient(135deg, #e8f5e9, #c8e6c9);
        color: #2e7d32;
      }

      .stability-result-status.caution {
        background: linear-gradient(135deg, #fff3e0, #ffe0b2);
        color: #e65100;
      }

      .stability-result-status.warning {
        background: linear-gradient(135deg, #fff8e1, #ffecb3);
        color: #f57f17;
      }

      .stability-result-status.danger {
        background: linear-gradient(135deg, #ffebee, #ffcdd2);
        color: #c62828;
      }

      .stability-result-status .status-icon {
        font-size: 28px;
      }

      .stability-result-status .status-text {
        font-weight: 700;
        flex: 1;
      }

      .stability-result-status .status-calibers {
        font-size: 20px;
        font-weight: 700;
      }

      .stability-bar-container {
        margin: 20px 0;
      }

      .stability-bar {
        position: relative;
        height: 24px;
        background: linear-gradient(90deg, #e3f2fd 0%, #fff 30%, #fff 70%, #ffebee 100%);
        border-radius: 12px;
        border: 2px solid #ddd;
      }

      .stability-marker {
        position: absolute;
        top: -8px;
        transform: translateX(-50%);
        text-align: center;
      }

      .stability-marker .marker-dot {
        display: block;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        margin: 0 auto 4px;
        border: 2px solid #fff;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }

      .stability-marker.cg-marker .marker-dot {
        background: #e53935;
      }

      .stability-marker.cp-marker .marker-dot {
        background: #1e88e5;
      }

      .stability-marker .marker-label {
        display: block;
        font-size: 11px;
        font-weight: 700;
        margin-top: 24px;
      }

      .stability-marker.cg-marker .marker-label {
        color: #c62828;
      }

      .stability-marker.cp-marker .marker-label {
        color: #1565c0;
      }

      .stability-margin-line {
        position: absolute;
        top: 50%;
        height: 4px;
        background: #9e9e9e;
        transform: translateY(-50%);
      }

      .stability-bar-labels {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: #666;
        margin-top: 25px;
      }

      .stability-values-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin: 20px 0;
      }

      @media (max-width: 600px) {
        .stability-values-grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      .stability-value {
        text-align: center;
        padding: 12px;
        background: white;
        border-radius: 8px;
        border: 1px solid #e0e0e0;
      }

      .stability-value.highlight {
        border-color: #1565c0;
        background: #e3f2fd;
      }

      .stability-value .value-number {
        font-size: 22px;
        font-weight: 700;
        color: #333;
      }

      .stability-value.highlight .value-number {
        color: #1565c0;
      }

      .stability-value .value-unit {
        font-size: 12px;
        color: #666;
        margin-left: 2px;
      }

      .stability-value .value-label {
        display: block;
        font-size: 11px;
        color: #666;
        margin-top: 4px;
      }

      .stability-recommendation {
        padding: 12px 16px;
        border-radius: 8px;
        font-size: 14px;
        margin: 15px 0;
      }

      .stability-recommendation.safe {
        background: #e8f5e9;
        color: #2e7d32;
        border-left: 4px solid #4caf50;
      }

      .stability-recommendation.caution {
        background: #fff3e0;
        color: #e65100;
        border-left: 4px solid #ff9800;
      }

      .stability-recommendation.warning {
        background: #fff8e1;
        color: #f57f17;
        border-left: 4px solid #ffc107;
      }

      .stability-recommendation.danger {
        background: #ffebee;
        color: #c62828;
        border-left: 4px solid #f44336;
      }

      .stability-details {
        font-size: 13px;
        margin-top: 15px;
      }

      .stability-details summary {
        cursor: pointer;
        color: #666;
        padding: 8px 0;
      }

      .stability-component-table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 10px;
        font-size: 12px;
      }

      .stability-component-table th,
      .stability-component-table td {
        padding: 6px 10px;
        text-align: left;
        border-bottom: 1px solid #eee;
      }

      .stability-component-table th {
        background: #f5f5f5;
        font-weight: 500;
      }

      .stability-component-table .total-row {
        background: #e3f2fd;
      }

      /* Rocket Profile Styles */
      .profile-section {
        background: #f8f9fa;
        border-radius: 10px;
        padding: 15px;
        text-align: center;
      }

      .profile-section canvas {
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }

      /* Launch Day Assistant Styles */
      .launchday-panel {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .launchday-header {
        text-align: center;
        background: #000;
        color: white;
        padding: 30px;
        border-radius: 12px;
      }

      .launchday-header h2 {
        margin: 0 0 10px;
        font-size: 28px;
      }

      .launchday-header .section-desc {
        opacity: 0.9;
        margin-bottom: 20px;
      }

      .btn-large {
        padding: 15px 40px;
        font-size: 18px;
        border-radius: 30px;
      }

      .launchday-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 20px;
      }

      @media (max-width: 900px) {
        .launchday-grid {
          grid-template-columns: 1fr;
        }
      }

      .launchday-status .status-display {
        padding: 25px;
        border-radius: 12px;
        text-align: center;
        margin: 15px 0;
      }

      .launchday-status .status-display.go {
        background: linear-gradient(135deg, #43a047, #66bb6a);
        color: white;
      }

      .launchday-status .status-display.hold {
        background: linear-gradient(135deg, #f57c00, #ffb74d);
        color: white;
      }

      .launchday-status .status-display.nogo {
        background: linear-gradient(135deg, #d32f2f, #ef5350);
        color: white;
      }

      .launchday-status .big-status {
        display: block;
        font-size: 48px;
        font-weight: 800;
        letter-spacing: 4px;
      }

      .launchday-status .status-score {
        display: block;
        font-size: 18px;
        opacity: 0.9;
        margin-top: 8px;
      }

      .launchday-status .status-message {
        font-size: 16px;
        color: #333;
        margin: 15px 0;
      }

      .status-blockers, .status-warnings {
        background: #fff;
        padding: 12px;
        border-radius: 8px;
        margin-top: 10px;
        text-align: left;
      }

      .status-blockers {
        border-left: 4px solid #d32f2f;
      }

      .status-warnings {
        border-left: 4px solid #f57c00;
      }

      .status-blockers ul, .status-warnings ul {
        margin: 8px 0 0 20px;
        padding: 0;
      }

      .systems-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .system-check {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px 15px;
        background: #f5f5f5;
        border-radius: 8px;
      }

      .system-check .check-icon {
        font-size: 20px;
      }

      .system-check .check-label {
        flex: 1;
        font-weight: 500;
      }

      .system-check .check-status {
        font-size: 13px;
        color: #666;
      }

      .drift-display {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 15px;
        margin: 15px 0;
      }

      .drift-stat {
        text-align: center;
        padding: 15px;
        background: #e3f2fd;
        border-radius: 10px;
      }

      .drift-stat .drift-value {
        display: block;
        font-size: 28px;
        font-weight: 700;
        color: #1565c0;
      }

      .drift-stat .drift-unit {
        font-size: 14px;
        color: #666;
      }

      .drift-stat .drift-label {
        display: block;
        font-size: 12px;
        color: #666;
        margin-top: 5px;
      }

      .launch-direction {
        background: #f5f5f5;
        padding: 15px;
        border-radius: 8px;
        font-size: 14px;
      }

      .launch-direction p {
        margin: 8px 0;
      }

      .launchday-checklist {
        max-height: 500px;
        overflow-y: auto;
      }

      .checklist-controls {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
      }

      .checklist-progress {
        font-weight: 600;
        color: #1565c0;
      }

      .checklist-category {
        margin-bottom: 20px;
      }

      .checklist-category h4 {
        margin: 0 0 10px;
        font-size: 14px;
        color: #333;
        border-bottom: 1px solid #e0e0e0;
        padding-bottom: 5px;
      }

      .checklist-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .checklist-item {
        padding: 10px 12px;
        border-radius: 6px;
        margin-bottom: 5px;
        background: #f8f9fa;
        transition: background 0.2s;
      }

      .checklist-item:hover {
        background: #e8f5e9;
      }

      .checklist-item.checked {
        background: #c8e6c9;
      }

      .checklist-item.checked .item-text {
        text-decoration: line-through;
        opacity: 0.7;
      }

      .checklist-item label {
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
      }

      .checklist-item input[type="checkbox"] {
        width: 18px;
        height: 18px;
      }

      .critical-badge {
        background: #ffcdd2;
        color: #c62828;
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 3px;
        font-weight: 600;
        margin-left: auto;
      }

      .recovery-config {
        background: #f5f5f5;
        padding: 20px;
        border-radius: 10px;
        margin-bottom: 15px;
      }

      .recovery-config .form-row {
        margin-bottom: 12px;
      }

      .recovery-results {
        background: #f8f9fa;
        border-radius: 10px;
        padding: 15px;
      }

      .recovery-summary {
        padding: 20px;
        border-radius: 10px;
      }

      .recovery-summary.safe {
        background: linear-gradient(135deg, #e8f5e9, #c8e6c9);
        border-left: 4px solid #4caf50;
      }

      .recovery-summary.warning {
        background: linear-gradient(135deg, #fff8e1, #ffecb3);
        border-left: 4px solid #ff9800;
      }

      .recovery-summary.danger {
        background: linear-gradient(135deg, #ffebee, #ffcdd2);
        border-left: 4px solid #f44336;
      }

      .recovery-summary h4 {
        margin: 0 0 15px;
        font-size: 18px;
      }

      .recovery-stats {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 12px;
        margin-bottom: 15px;
      }

      @media (max-width: 600px) {
        .recovery-stats {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      .recovery-stat {
        text-align: center;
        background: rgba(255,255,255,0.8);
        padding: 12px;
        border-radius: 8px;
      }

      .recovery-stat .stat-value {
        display: block;
        font-size: 24px;
        font-weight: 700;
        color: #333;
      }

      .recovery-stat .stat-unit {
        font-size: 12px;
        color: #666;
      }

      .recovery-stat .stat-label {
        display: block;
        font-size: 11px;
        color: #666;
        margin-top: 4px;
      }

      .recovery-phases {
        margin: 15px 0;
      }

      .phases-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
        background: white;
        border-radius: 8px;
        overflow: hidden;
      }

      .phases-table th, .phases-table td {
        padding: 10px 12px;
        text-align: left;
        border-bottom: 1px solid #eee;
      }

      .phases-table th {
        background: #f5f5f5;
        font-weight: 500;
      }

      .recovery-issues, .recovery-warnings {
        background: rgba(255,255,255,0.8);
        padding: 12px;
        border-radius: 8px;
        margin-top: 10px;
      }

      .recovery-issues ul, .recovery-warnings ul {
        margin: 8px 0 0 20px;
        padding: 0;
      }

      .recommendations-list {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      .recommendations-list li {
        padding: 12px 15px;
        margin-bottom: 8px;
        border-radius: 8px;
        font-size: 14px;
      }

      .recommendations-list .rec-good {
        background: #e8f5e9;
        color: #2e7d32;
      }

      .recommendations-list .rec-warning {
        background: #fff3e0;
        color: #e65100;
      }

      .recommendations-list .rec-bad {
        background: #ffebee;
        color: #c62828;
      }

      .recommendations-list .rec-info {
        background: #e3f2fd;
        color: #1565c0;
      }

      .status-error {
        background: #ffebee;
        padding: 20px;
        border-radius: 10px;
        display: flex;
        align-items: center;
        gap: 15px;
        color: #c62828;
      }

      .status-error .status-icon {
        font-size: 32px;
      }

      /* Flight Log Styles */
      .flightlog-panel {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .flightlog-header {
        text-align: center;
        background: linear-gradient(135deg, #2e7d32, #66bb6a);
        color: white;
        padding: 30px;
        border-radius: 12px;
      }

      .flightlog-header h2 {
        margin: 0 0 10px;
      }

      .header-buttons {
        display: flex;
        gap: 10px;
        justify-content: center;
        margin-top: 15px;
      }

      .flightlog-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
      }

      @media (max-width: 800px) {
        .flightlog-grid {
          grid-template-columns: 1fr;
        }
      }

      .stats-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
        margin-top: 15px;
      }

      @media (max-width: 600px) {
        .stats-grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }

      .stat-card {
        background: linear-gradient(135deg, #e3f2fd, #bbdefb);
        padding: 15px;
        border-radius: 10px;
        text-align: center;
      }

      .stat-card .stat-value {
        display: block;
        font-size: 28px;
        font-weight: 700;
        color: #1565c0;
      }

      .stat-card .stat-label {
        display: block;
        font-size: 12px;
        color: #666;
        margin-top: 5px;
      }

      .accuracy-rating {
        display: flex;
        align-items: center;
        gap: 15px;
        padding: 15px;
        border-radius: 10px;
        margin: 15px 0;
      }

      .accuracy-rating.excellent {
        background: linear-gradient(135deg, #e8f5e9, #c8e6c9);
      }

      .accuracy-rating.good {
        background: linear-gradient(135deg, #e3f2fd, #bbdefb);
      }

      .accuracy-rating.fair {
        background: linear-gradient(135deg, #fff8e1, #ffecb3);
      }

      .accuracy-rating.poor {
        background: linear-gradient(135deg, #ffebee, #ffcdd2);
      }

      .rating-badge {
        font-size: 18px;
        font-weight: 700;
        padding: 8px 16px;
        background: white;
        border-radius: 20px;
      }

      .accuracy-metric {
        display: flex;
        justify-content: space-between;
        padding: 10px;
        background: #f5f5f5;
        border-radius: 6px;
        margin-bottom: 8px;
      }

      .calibration-factor {
        background: #e3f2fd;
        padding: 15px;
        border-radius: 8px;
        margin-top: 10px;
      }

      .calibration-factor .factor-value {
        display: block;
        font-size: 24px;
        font-weight: 700;
        color: #1565c0;
      }

      .flight-filters {
        display: flex;
        gap: 10px;
        margin-bottom: 15px;
      }

      .flight-filters input,
      .flight-filters select {
        flex: 1;
      }

      .flight-card {
        background: #f8f9fa;
        border-radius: 10px;
        padding: 15px;
        margin-bottom: 10px;
        border-left: 4px solid #1976d2;
      }

      .flight-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 8px;
      }

      .flight-outcome {
        font-size: 18px;
      }

      .flight-rocket {
        font-weight: 600;
        flex: 1;
      }

      .flight-date {
        color: #666;
        font-size: 13px;
      }

      .flight-details {
        display: flex;
        gap: 15px;
        font-size: 14px;
        color: #666;
      }

      .flight-error.good {
        color: #2e7d32;
      }

      .flight-error.poor {
        color: #c62828;
      }

      .flight-notes {
        font-size: 13px;
        color: #888;
        margin-top: 8px;
        font-style: italic;
      }

      /* Component Database Styles */
      .component-browser {
        margin-top: 15px;
      }

      .component-filters {
        display: flex;
        gap: 10px;
        margin-bottom: 15px;
        flex-wrap: wrap;
      }

      .component-filters select,
      .component-filters input {
        flex: 1;
        min-width: 150px;
      }

      .component-count {
        color: #666;
        margin-bottom: 10px;
        font-size: 14px;
      }

      .component-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: 15px;
        max-height: 400px;
        overflow-y: auto;
      }

      .component-card {
        background: #f8f9fa;
        border-radius: 10px;
        padding: 15px;
        border: 1px solid #e0e0e0;
        transition: transform 0.2s, box-shadow 0.2s;
      }

      .component-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
      }

      .comp-name {
        font-weight: 600;
        font-size: 14px;
        margin-bottom: 5px;
      }

      .comp-mfr {
        color: #1976d2;
        font-size: 12px;
        margin-bottom: 10px;
      }

      .comp-details {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 10px;
      }

      .comp-spec {
        background: #e3f2fd;
        padding: 3px 8px;
        border-radius: 4px;
        font-size: 11px;
        color: #1565c0;
      }

      .btn-use-component {
        width: 100%;
        margin-top: 5px;
      }

      /* Multi-Stage Styles */
      .multistage-panel {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .multistage-header {
        text-align: center;
        background: linear-gradient(135deg, #673ab7, #9c27b0);
        color: white;
        padding: 30px;
        border-radius: 12px;
      }

      .multistage-header h2 {
        margin: 0 0 10px;
      }

      .multistage-header .header-buttons {
        display: flex;
        gap: 10px;
        justify-content: center;
        margin-top: 15px;
        flex-wrap: wrap;
      }

      .multistage-workspace {
        display: grid;
        grid-template-columns: 1fr 300px;
        gap: 20px;
      }

      @media (max-width: 900px) {
        .multistage-workspace {
          grid-template-columns: 1fr;
        }
      }

      .stage-builder {
        min-height: 300px;
      }

      .rocket-name-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 15px;
      }

      .rocket-name-row label {
        font-weight: 600;
      }

      .rocket-name-row input {
        flex: 1;
      }

      .stages-container {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .stage-card {
        background: #f8f9fa;
        border-radius: 10px;
        padding: 15px;
        border-left: 4px solid #673ab7;
      }

      .stage-card.strapon {
        border-left-color: #ff9800;
      }

      .stage-card-header {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 10px;
      }

      .stage-icon {
        font-size: 20px;
      }

      .stage-name {
        font-weight: 600;
        flex: 1;
      }

      .stage-type {
        font-size: 12px;
        color: #666;
        background: #e0e0e0;
        padding: 2px 8px;
        border-radius: 10px;
      }

      .stage-card-body {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .stage-specs {
        display: flex;
        gap: 15px;
        flex-wrap: wrap;
      }

      .stage-specs .spec {
        font-size: 13px;
        color: #555;
      }

      .stage-triggers {
        display: flex;
        gap: 15px;
        font-size: 12px;
        color: #888;
      }

      .strapon-section {
        margin-top: 15px;
        padding-top: 15px;
        border-top: 2px dashed #e0e0e0;
      }

      .strapon-section h4 {
        margin: 0 0 10px;
        color: #ff9800;
      }

      /* Stage Visual */
      .stage-visual {
        background: #f0f0f0;
        border-radius: 12px;
        padding: 20px;
      }

      .stage-stack-visual {
        min-height: 300px;
        display: flex;
        justify-content: center;
        align-items: flex-end;
        padding: 20px;
        background: linear-gradient(180deg, #e3f2fd 0%, #bbdefb 100%);
        border-radius: 10px;
      }

      .stage-stack {
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .visual-stage {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
      }

      .nose-cone {
        width: 0;
        height: 0;
        border-left: 20px solid transparent;
        border-right: 20px solid transparent;
        border-bottom: 40px solid #673ab7;
        margin-bottom: -1px;
      }

      .stage-body {
        background: linear-gradient(90deg, #7c4dff, #673ab7);
        border-radius: 3px;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 10px;
        text-align: center;
        min-height: 30px;
      }

      .stage-body.with-fins::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 50%;
        transform: translateX(-50%);
        width: 150%;
        height: 20px;
        background: linear-gradient(90deg, transparent 0%, #ff5722 20%, #ff5722 40%, transparent 50%, #ff5722 60%, #ff5722 80%, transparent 100%);
        clip-path: polygon(0% 0%, 15% 100%, 35% 100%, 45% 0%, 55% 0%, 65% 100%, 85% 100%, 100% 0%);
      }

      .stage-label {
        padding: 2px 5px;
        background: rgba(0,0,0,0.3);
        border-radius: 3px;
      }

      .strapons-visual {
        position: absolute;
        bottom: 0;
        display: flex;
        gap: 80px;
      }

      .visual-strapon {
        width: 15px;
        background: linear-gradient(90deg, #ffa726, #ff9800);
        border-radius: 3px 3px 0 0;
      }

      .stage-stats {
        margin-top: 20px;
        padding: 15px;
        background: white;
        border-radius: 8px;
      }

      .stat-row {
        display: flex;
        justify-content: space-between;
        padding: 5px 0;
        border-bottom: 1px solid #eee;
      }

      .stat-row:last-child {
        border-bottom: none;
      }

      .stat-label {
        color: #666;
      }

      .stat-value {
        font-weight: 600;
      }

      /* Simulation Controls */
      .simulation-controls {
        background: #f5f5f5;
      }

      .sim-params {
        display: flex;
        gap: 20px;
        align-items: flex-end;
        flex-wrap: wrap;
      }

      .sim-params .form-row {
        flex: 1;
        min-width: 120px;
      }

      .btn-large {
        padding: 15px 30px;
        font-size: 16px;
      }

      /* Results */
      .results-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 15px;
        margin-bottom: 20px;
      }

      .result-card {
        background: linear-gradient(135deg, #e8eaf6, #c5cae9);
        padding: 20px;
        border-radius: 12px;
        text-align: center;
      }

      .result-value {
        display: block;
        font-size: 28px;
        font-weight: 700;
        color: #3f51b5;
      }

      .result-label {
        display: block;
        font-size: 12px;
        color: #666;
        margin-top: 5px;
      }

      .event-timeline {
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 250px;
        overflow-y: auto;
      }

      .timeline-event {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 15px;
        background: #f8f9fa;
        border-radius: 8px;
        border-left: 4px solid #9e9e9e;
      }

      .timeline-event.liftoff { border-left-color: #4caf50; }
      .timeline-event.ignition { border-left-color: #ff9800; }
      .timeline-event.separation { border-left-color: #f44336; }
      .timeline-event.booster_separation { border-left-color: #ff5722; }
      .timeline-event.apogee { border-left-color: #2196f3; }
      .timeline-event.landing { border-left-color: #9c27b0; }

      .event-icon {
        font-size: 18px;
      }

      .event-time {
        font-weight: 600;
        min-width: 60px;
      }

      .event-type {
        font-weight: 500;
        min-width: 100px;
      }

      .event-stage {
        color: #666;
        font-size: 13px;
      }

      .event-altitude {
        margin-left: auto;
        color: #888;
      }

      .separated-stage-info {
        padding: 10px 15px;
        background: #fff3e0;
        border-radius: 8px;
        margin-top: 10px;
        border-left: 4px solid #ff9800;
      }

      /* Modal Large */
      .modal-large {
        max-width: 800px;
      }

      .form-grid-2col {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
      }

      @media (max-width: 700px) {
        .form-grid-2col {
          grid-template-columns: 1fr;
        }
      }

      .checkbox-row {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .checkbox-row input[type="checkbox"] {
        width: auto;
      }

      .btn-danger {
        background: #f44336;
        color: white;
      }

      .btn-danger:hover {
        background: #d32f2f;
      }

      /* Recovery Tab Styles */
      .recovery-panel {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .recovery-header {
        text-align: center;
        background: linear-gradient(135deg, #00897b, #26a69a);
        color: white;
        padding: 30px;
        border-radius: 12px;
      }

      .recovery-header h2 {
        margin: 0 0 10px;
      }

      .recovery-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
      }

      @media (max-width: 900px) {
        .recovery-grid {
          grid-template-columns: 1fr;
        }
      }

      .recovery-planner,
      .wind-profile-editor {
        min-height: 350px;
      }

      .helper-text {
        font-size: 13px;
        color: #666;
        margin-bottom: 15px;
      }

      .planner-inputs,
      .wind-inputs {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 15px;
      }

      .planner-results {
        background: #e8f5e9;
        padding: 15px;
        border-radius: 10px;
        margin-top: 15px;
      }

      .recommendation-cards {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
        gap: 12px;
        margin-bottom: 15px;
      }

      .rec-card {
        background: white;
        padding: 15px;
        border-radius: 10px;
        text-align: center;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .rec-icon {
        font-size: 24px;
        margin-bottom: 5px;
      }

      .rec-title {
        font-size: 12px;
        color: #666;
        margin-bottom: 5px;
      }

      .rec-value {
        font-size: 22px;
        font-weight: 700;
        color: #333;
      }

      .rec-detail {
        font-size: 11px;
        color: #888;
        margin-top: 5px;
      }

      .planner-notes-list {
        font-size: 13px;
        color: #555;
        margin: 0 0 15px 20px;
        padding: 0;
      }

      .planner-notes-list li {
        margin-bottom: 5px;
      }

      /* Wind Profile */
      .wind-layers {
        margin-top: 15px;
        padding-top: 15px;
        border-top: 1px solid #e0e0e0;
      }

      .wind-layer-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-bottom: 10px;
      }

      .wind-layer-info {
        font-size: 12px;
        color: #888;
        font-style: italic;
      }

      .wind-layer {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr auto;
        gap: 8px;
        align-items: end;
        padding: 10px;
        background: #f5f5f5;
        border-radius: 8px;
      }

      .wind-layer .form-row {
        margin: 0;
      }

      .wind-layer label {
        font-size: 10px;
      }

      .wind-layer input {
        padding: 5px;
        font-size: 12px;
      }

      .dir-indicator {
        display: inline-block;
        padding: 3px 8px;
        background: #2196f3;
        color: white;
        border-radius: 4px;
        font-weight: 600;
        margin-left: 8px;
      }

      .wind-profile-chart {
        margin-top: 15px;
      }

      /* Dual Deploy Config */
      .dual-deploy-config {
        background: #fafafa;
      }

      .deploy-config-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 20px;
      }

      @media (max-width: 900px) {
        .deploy-config-grid {
          grid-template-columns: 1fr;
        }
      }

      .deploy-section {
        background: white;
        padding: 15px;
        border-radius: 10px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.05);
      }

      .deploy-section h4 {
        margin: 0 0 15px;
        padding-bottom: 10px;
        border-bottom: 2px solid #e0e0e0;
      }

      .drogue-config h4 {
        border-color: #f44336;
      }

      .main-config h4 {
        border-color: #4caf50;
      }

      .rocket-config h4 {
        border-color: #2196f3;
      }

      /* Dual Deploy Results */
      .dual-deploy-results {
        background: #f5f5f5;
      }

      .dd-summary-grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
        gap: 15px;
        margin-bottom: 20px;
      }

      .dd-summary-card {
        background: white;
        padding: 20px;
        border-radius: 10px;
        text-align: center;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .dd-value {
        display: block;
        font-size: 28px;
        font-weight: 700;
        color: #00897b;
      }

      .dd-label {
        display: block;
        font-size: 12px;
        color: #666;
        margin-top: 5px;
      }

      .dd-results-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        margin-bottom: 20px;
      }

      @media (max-width: 800px) {
        .dd-results-grid {
          grid-template-columns: 1fr;
        }
      }

      .recovery-timeline {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .timeline-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 15px;
        background: white;
        border-radius: 8px;
        border-left: 4px solid #ccc;
      }

      .timeline-item.apogee { border-left-color: #2196f3; }
      .timeline-item.drogue_deploy { border-left-color: #f44336; }
      .timeline-item.main_deploy { border-left-color: #4caf50; }
      .timeline-item.landing { border-left-color: #9c27b0; }

      .timeline-icon {
        font-size: 18px;
      }

      .timeline-time {
        font-weight: 600;
        min-width: 50px;
      }

      .timeline-type {
        flex: 1;
        font-weight: 500;
      }

      .timeline-altitude {
        color: #666;
      }

      .timeline-velocity {
        color: #888;
        font-size: 12px;
      }

      .phase-cards {
        display: flex;
        flex-direction: column;
        gap: 15px;
      }

      .phase-card {
        background: white;
        border-radius: 10px;
        overflow: hidden;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .phase-header {
        padding: 12px 15px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 600;
      }

      .phase-card.drogue .phase-header {
        background: #ffebee;
        color: #c62828;
      }

      .phase-card.main .phase-header {
        background: #e8f5e9;
        color: #2e7d32;
      }

      .phase-stats {
        padding: 15px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .phase-stat {
        display: flex;
        flex-direction: column;
      }

      .phase-stat .label {
        font-size: 11px;
        color: #888;
      }

      .phase-stat .value {
        font-weight: 600;
        color: #333;
      }

      .dd-drift {
        display: flex;
        gap: 20px;
        align-items: flex-start;
        flex-wrap: wrap;
      }

      .drift-stats {
        flex: 1;
        min-width: 200px;
      }

      .drift-stat {
        display: flex;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid #e0e0e0;
      }

      .drift-label {
        color: #666;
      }

      .drift-value {
        font-weight: 600;
      }

      .altimeter-config {
        background: white;
        padding: 15px;
        border-radius: 10px;
      }

      .altimeter-config h5 {
        margin: 0 0 15px;
      }

      .alt-setting {
        display: flex;
        justify-content: space-between;
        padding: 8px 0;
        border-bottom: 1px solid #eee;
      }

      .alt-label {
        color: #666;
      }

      .alt-value {
        font-weight: 600;
        color: #00897b;
      }

      /* Unit Toggle */
      .unit-toggle {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-right: 15px;
        padding: 5px 10px;
        background: rgba(255,255,255,0.1);
        border-radius: 20px;
      }

      .unit-label {
        font-size: 12px;
        color: rgba(255,255,255,0.8);
      }

      .unit-btn {
        padding: 4px 12px;
        border: none;
        background: transparent;
        color: rgba(255,255,255,0.6);
        border-radius: 12px;
        cursor: pointer;
        font-size: 12px;
        transition: all 0.2s;
      }

      .unit-btn:hover {
        background: rgba(255,255,255,0.1);
        color: white;
      }

      .unit-btn.active {
        background: white;
        color: #333;
        font-weight: 600;
      }

      /* Advanced Tab Styles */
      .advanced-panel {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .advanced-header {
        text-align: center;
        background: linear-gradient(135deg, #455a64, #607d8b);
        color: white;
        padding: 30px;
        border-radius: 12px;
      }

      .advanced-header h2 {
        margin: 0 0 10px;
      }

      .advanced-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
      }

      @media (max-width: 1000px) {
        .advanced-grid {
          grid-template-columns: 1fr;
        }
      }

      /* TVC Configuration */
      .tvc-config {
        background: #fafafa;
      }

      .tvc-enable-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 20px;
        padding: 15px;
        background: #e3f2fd;
        border-radius: 8px;
      }

      .toggle-switch {
        width: 50px;
        height: 26px;
        appearance: none;
        background: #ccc;
        border-radius: 13px;
        position: relative;
        cursor: pointer;
        transition: background 0.3s;
      }

      .toggle-switch:checked {
        background: #4caf50;
      }

      .toggle-switch::before {
        content: '';
        position: absolute;
        width: 22px;
        height: 22px;
        background: white;
        border-radius: 50%;
        top: 2px;
        left: 2px;
        transition: left 0.3s;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      }

      .toggle-switch:checked::before {
        left: 26px;
      }

      .tvc-settings {
        transition: opacity 0.3s;
        opacity: 0.5;
        pointer-events: none;
      }

      .pid-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 10px;
      }

      .tvc-visual {
        text-align: center;
        margin: 20px 0;
        padding: 15px;
        background: white;
        border-radius: 10px;
      }

      .tvc-visual h4 {
        margin: 0 0 10px;
      }

      #tvc-gimbal-canvas {
        border: 1px solid #e0e0e0;
        border-radius: 8px;
      }

      .gimbal-readout {
        display: flex;
        justify-content: center;
        gap: 30px;
        margin-top: 10px;
        font-family: monospace;
        font-size: 14px;
      }

      /* HIL Interface */
      .hil-interface {
        background: #fafafa;
      }

      .hil-status {
        margin-bottom: 20px;
      }

      .status-indicator {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 20px;
        border-radius: 8px;
        font-weight: 600;
      }

      .status-indicator.disconnected {
        background: #ffebee;
        color: #c62828;
      }

      .status-indicator.connected {
        background: #e8f5e9;
        color: #2e7d32;
      }

      .status-dot {
        width: 12px;
        height: 12px;
        border-radius: 50%;
        background: currentColor;
        animation: pulse 2s infinite;
      }

      .status-indicator.connected .status-dot {
        animation: none;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.4; }
      }

      .hil-buttons {
        display: flex;
        gap: 10px;
        margin-top: 15px;
      }

      .sensor-noise-settings {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }

      .hil-monitor {
        background: #e8eaf6;
        border-radius: 10px;
        padding: 15px;
        margin-top: 15px;
      }

      .sensor-readouts {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 15px;
      }

      .sensor-group {
        background: white;
        padding: 12px;
        border-radius: 8px;
      }

      .sensor-group h5 {
        margin: 0 0 8px;
        font-size: 12px;
        color: #666;
      }

      .sensor-values {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-family: monospace;
        font-size: 12px;
      }

      .hil-stats {
        margin-top: 15px;
        padding: 10px;
        background: white;
        border-radius: 8px;
      }

      .hil-stats h5 {
        margin: 0 0 10px;
      }

      .hil-stats .stat-row {
        display: flex;
        justify-content: space-between;
        padding: 4px 0;
        font-size: 13px;
      }

      .hil-actuators {
        margin-top: 15px;
        padding: 10px;
        background: white;
        border-radius: 8px;
      }

      .hil-actuators h5 {
        margin: 0 0 10px;
      }

      .actuator-display {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .actuator-item {
        display: flex;
        justify-content: space-between;
        padding: 6px 10px;
        background: #f5f5f5;
        border-radius: 4px;
        font-size: 12px;
      }

      .actuator-label {
        color: #666;
      }

      .actuator-value {
        font-weight: 600;
        font-family: monospace;
      }

      .hil-test-buttons {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      /* RocketPy Server Styles */
      .rocketpy-server {
        background: linear-gradient(135deg, #e8f5e9, #f1f8e9);
      }

      .rocketpy-enable-row {
        display: flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 15px;
        padding: 10px;
        background: white;
        border-radius: 8px;
      }

      .rocketpy-settings {
        transition: opacity 0.3s;
      }

      .rocketpy-status {
        margin: 15px 0;
      }

      .rocketpy-status .status-indicator.connecting .status-dot {
        background: #ff9800;
        animation: pulse 1s infinite;
      }

      .rocketpy-status .status-indicator.connected {
        color: #2e7d32;
      }

      .rocketpy-status .status-indicator.connected .status-dot {
        background: #4caf50;
      }

      .rocketpy-status .status-indicator.error {
        color: #c62828;
      }

      .rocketpy-status .status-indicator.error .status-dot {
        background: #f44336;
      }

      .rocketpy-actions {
        display: flex;
        gap: 10px;
        margin-top: 10px;
      }

      .rocketpy-capabilities {
        margin-top: 20px;
        padding: 15px;
        background: white;
        border-radius: 8px;
      }

      .capabilities-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
        margin-top: 10px;
      }

      .capability-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px;
        background: #f5f5f5;
        border-radius: 6px;
        font-size: 13px;
      }

      .cap-icon {
        font-size: 18px;
      }

      .cap-name {
        flex: 1;
      }

      .cap-status {
        font-weight: 600;
      }

      .cap-status.available {
        color: #2e7d32;
      }

      .cap-status.unavailable {
        color: #c62828;
      }

      .server-info {
        margin-top: 15px;
        padding-top: 15px;
        border-top: 1px solid #e0e0e0;
      }

      .server-info-item {
        display: flex;
        justify-content: space-between;
        padding: 5px 0;
        font-size: 13px;
      }

      .info-label {
        color: #666;
      }

      .info-value {
        font-weight: 600;
        font-family: monospace;
      }

      .rocketpy-options {
        margin-top: 10px;
      }

      .option-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 0;
      }

      .option-row label {
        font-size: 13px;
        cursor: pointer;
      }

      .rocketpy-quick-actions {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin-top: 10px;
      }

      .rocketpy-setup-guide {
        margin-top: 20px;
        padding: 15px;
        background: #fff8e1;
        border-radius: 8px;
        border: 1px solid #ffcc02;
      }

      .rocketpy-setup-guide h4 {
        margin: 0 0 10px;
        color: #f57c00;
      }

      .setup-steps {
        font-size: 13px;
      }

      .setup-steps ol {
        margin: 10px 0;
        padding-left: 20px;
      }

      .setup-steps li {
        margin: 8px 0;
      }

      .setup-steps code {
        background: #fff;
        padding: 2px 6px;
        border-radius: 4px;
        font-family: 'Consolas', 'Monaco', monospace;
        font-size: 12px;
        border: 1px solid #e0e0e0;
      }

      /* ============================================
         3D View Tab Styles
         ============================================ */

      .view3d-panel {
        display: flex;
        flex-direction: column;
        height: calc(100vh - 180px);
        min-height: 500px;
      }

      .view3d-header {
        padding: 15px 20px;
        background: linear-gradient(135deg, #1a1a2e, #16213e);
        color: white;
        border-radius: 12px;
        margin-bottom: 15px;
      }

      .view3d-header h2 {
        margin: 0 0 5px;
      }

      .view3d-header .section-desc {
        margin: 0;
        opacity: 0.8;
      }

      .view3d-main {
        display: flex;
        gap: 15px;
        flex: 1;
        min-height: 0;
      }

      .view3d-viewport {
        flex: 1;
        position: relative;
        background: #1a1a2e;
        border-radius: 12px;
        overflow: hidden;
      }

      .viewport-container {
        width: 100%;
        height: 100%;
        position: relative;
      }

      .viewport-container canvas {
        display: block;
      }

      .viewport-placeholder {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
      }

      .placeholder-content {
        text-align: center;
        color: white;
      }

      .placeholder-icon {
        font-size: 64px;
        display: block;
        margin-bottom: 15px;
        animation: float 3s ease-in-out infinite;
      }

      @keyframes float {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
      }

      .placeholder-content p {
        margin: 5px 0;
        font-size: 18px;
      }

      .placeholder-hint {
        opacity: 0.7;
        font-size: 14px !important;
        margin-bottom: 20px !important;
      }

      .viewport-overlay {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        pointer-events: none;
        padding: 15px;
      }

      .overlay-top-left {
        position: absolute;
        top: 15px;
        left: 15px;
      }

      .viewport-stats {
        background: rgba(0, 0, 0, 0.7);
        padding: 12px 15px;
        border-radius: 8px;
        color: white;
        font-family: 'Consolas', monospace;
      }

      .stat-item {
        display: flex;
        justify-content: space-between;
        gap: 20px;
        padding: 3px 0;
        font-size: 13px;
      }

      .stat-label {
        opacity: 0.7;
      }

      .stat-value {
        font-weight: 600;
        color: #4ecdc4;
      }

      .overlay-top-right {
        position: absolute;
        top: 15px;
        right: 15px;
        pointer-events: auto;
      }

      .camera-controls {
        background: rgba(0, 0, 0, 0.7);
        padding: 10px 15px;
        border-radius: 8px;
        color: white;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
      }

      .camera-controls select {
        background: #333;
        color: white;
        border: 1px solid #555;
        padding: 5px 10px;
        border-radius: 4px;
        cursor: pointer;
      }

      .overlay-bottom {
        position: absolute;
        bottom: 15px;
        left: 15px;
        right: 15px;
      }

      .velocity-legend {
        background: rgba(0, 0, 0, 0.7);
        padding: 10px 15px;
        border-radius: 8px;
        color: white;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 12px;
        max-width: 300px;
      }

      .legend-gradient {
        flex: 1;
        height: 10px;
        border-radius: 5px;
        background: linear-gradient(to right, 
          #0066ff, #00ffff, #00ff00, #ffff00, #ff0000);
      }

      .view3d-sidebar {
        width: 280px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        overflow-y: auto;
      }

      .sidebar-section {
        background: white;
        border-radius: 10px;
        padding: 15px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }

      .sidebar-section h4 {
        margin: 0 0 12px;
        font-size: 14px;
        color: #333;
        border-bottom: 1px solid #eee;
        padding-bottom: 8px;
      }

      .playback-controls {
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .playback-buttons {
        display: flex;
        justify-content: center;
        gap: 8px;
      }

      .playback-buttons .btn-icon {
        width: 40px;
        height: 40px;
        font-size: 18px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 50%;
        border: none;
        cursor: pointer;
        transition: all 0.2s;
      }

      .playback-buttons .btn-icon:hover {
        transform: scale(1.1);
      }

      .playback-buttons .btn-primary {
        background: #4caf50;
        color: white;
      }

      .playback-timeline {
        display: flex;
        flex-direction: column;
        gap: 5px;
      }

      .playback-timeline input[type="range"] {
        width: 100%;
        height: 6px;
        border-radius: 3px;
        background: #e0e0e0;
        cursor: pointer;
      }

      .playback-timeline input[type="range"]::-webkit-slider-thumb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #2196f3;
        cursor: pointer;
        -webkit-appearance: none;
      }

      .timeline-labels {
        display: flex;
        justify-content: space-between;
        font-size: 11px;
        color: #666;
        font-family: monospace;
      }

      .playback-speed {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        font-size: 13px;
      }

      .playback-speed select {
        padding: 5px 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
      }

      .view-options {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .view-options .option-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
      }

      .view-options label {
        cursor: pointer;
      }

      .camera-presets {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .camera-presets .btn-small {
        padding: 8px;
        font-size: 12px;
      }

      .color-options {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }

      .color-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 13px;
      }

      .color-row input[type="color"] {
        width: 40px;
        height: 30px;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        padding: 2px;
      }

      /* Terrain Options */
      .terrain-options {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .terrain-controls {
        margin-top: 10px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .terrain-controls .control-row {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 12px;
      }

      .terrain-controls label {
        width: 90px;
        flex-shrink: 0;
      }

      .terrain-controls input[type="range"] {
        flex: 1;
        height: 4px;
      }

      .terrain-controls span {
        width: 40px;
        text-align: right;
        font-family: monospace;
      }

      /* Wind Options */
      .wind-options {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .wind-info {
        background: #f5f5f5;
        padding: 8px;
        border-radius: 4px;
        font-family: monospace;
      }

      .wind-info p {
        margin: 0;
        line-height: 1.4;
      }

      .controls-help {
        font-size: 12px;
        color: #666;
        line-height: 1.5;
      }

      .controls-help p {
        margin: 0 0 8px;
      }

      .controls-help ul {
        margin: 0;
        padding-left: 20px;
      }

      .controls-help li {
        margin: 4px 0;
      }

      .controls-help em {
        color: #333;
        font-style: normal;
        font-weight: 500;
      }

      .view3d-warning {
        position: absolute;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 100;
      }

      .warning-content {
        background: #fff3e0;
        border: 1px solid #ffb74d;
        border-radius: 10px;
        padding: 20px 30px;
        display: flex;
        align-items: center;
        gap: 15px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      }

      .warning-icon {
        font-size: 24px;
      }

      .warning-content p {
        margin: 0;
        color: #e65100;
      }

      /* Responsive 3D View */
      @media (max-width: 900px) {
        .view3d-main {
          flex-direction: column;
        }

        .view3d-viewport {
          min-height: 400px;
        }

        .view3d-sidebar {
          width: 100%;
          flex-direction: row;
          flex-wrap: wrap;
        }

        .sidebar-section {
          flex: 1;
          min-width: 200px;
        }
      }

      .browser-notice {
        margin-top: 20px;
      }

      .notice-content {
        display: flex;
        align-items: flex-start;
        gap: 15px;
        padding: 20px;
        border-radius: 10px;
      }

      .notice-content.warning {
        background: #fff3e0;
        border: 1px solid #ffb74d;
      }

      .notice-icon {
        font-size: 24px;
      }

      .notice-text strong {
        display: block;
        margin-bottom: 5px;
        color: #e65100;
      }

      .notice-text p {
        margin: 0;
        font-size: 14px;
        color: #666;
      }

      /* Modal Styles */
      .modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
      }

      .modal-content {
        background: white;
        border-radius: 12px;
        max-width: 600px;
        width: 90%;
        max-height: 90vh;
        overflow-y: auto;
      }

      .modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px;
        border-bottom: 1px solid #e0e0e0;
      }

      .modal-header h3 {
        margin: 0;
      }

      .btn-close {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        color: #666;
      }

      .modal-body {
        padding: 20px;
      }

      .form-section {
        margin-bottom: 20px;
      }

      .form-section h4 {
        margin: 0 0 15px;
        padding-bottom: 8px;
        border-bottom: 1px solid #e0e0e0;
        color: #333;
      }

      .form-row-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 15px;
      }

      .form-actions {
        display: flex;
        gap: 10px;
        justify-content: flex-end;
        margin-top: 20px;
        padding-top: 20px;
        border-top: 1px solid #e0e0e0;
      }

      /* Save/Load Dialog Styles */
      .modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
        animation: fadeIn 0.2s ease;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .save-dialog, .load-dialog {
        max-width: 550px;
      }

      .settings-dialog {
        max-width: 500px;
      }

      .settings-sections {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      .settings-section {
        padding: 15px;
        background: #f8f9fa;
        border-radius: 8px;
      }

      .settings-section h4 {
        margin: 0 0 12px;
        font-size: 14px;
        color: #333;
      }

      .settings-option {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }

      .settings-option:last-child {
        margin-bottom: 0;
      }

      .settings-option label {
        font-size: 13px;
        color: #555;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .settings-option select {
        padding: 6px 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 13px;
        min-width: 160px;
      }

      .modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        padding-top: 15px;
        border-top: 1px solid #eee;
        margin-top: 15px;
      }

      .modal-close {
        background: none;
        border: none;
        font-size: 28px;
        cursor: pointer;
        color: #999;
        line-height: 1;
        padding: 0;
      }

      .modal-close:hover {
        color: #333;
      }

      .save-options, .load-options {
        margin-bottom: 20px;
      }

      .save-section, .load-section {
        padding: 20px;
        background: #f8f9fa;
        border-radius: 8px;
        margin-bottom: 15px;
      }

      .save-section h4, .load-section h4 {
        margin: 0 0 8px;
        font-size: 16px;
      }

      .save-divider {
        text-align: center;
        margin: 15px 0;
        color: #999;
        position: relative;
      }

      .save-divider span {
        background: white;
        padding: 0 15px;
        position: relative;
        z-index: 1;
      }

      .save-divider::before {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        top: 50%;
        height: 1px;
        background: #e0e0e0;
      }

      .saved-projects-section {
        border-top: 1px solid #e0e0e0;
        padding-top: 20px;
        margin-top: 10px;
      }

      .saved-projects-section h4 {
        margin: 0 0 15px;
        font-size: 14px;
        color: #666;
      }

      .saved-projects-list {
        max-height: 250px;
        overflow-y: auto;
      }

      .saved-project-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 15px;
        background: #f5f5f5;
        border-radius: 6px;
        margin-bottom: 8px;
        transition: background 0.2s;
      }

      .saved-project-item:hover {
        background: #e8eaf6;
      }

      .project-info {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .project-name {
        font-weight: 600;
        color: #333;
      }

      .project-date {
        font-size: 12px;
        color: #888;
      }

      .project-actions {
        display: flex;
        gap: 8px;
      }

      .btn-small {
        padding: 6px 12px;
        font-size: 12px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        background: #e0e0e0;
        transition: background 0.2s;
      }

      .btn-small:hover {
        background: #d0d0d0;
      }

      .no-projects {
        text-align: center;
        padding: 30px 20px;
        color: #666;
      }

      .no-projects p {
        margin: 5px 0;
      }

      /* Data Management Styles */
      .data-management-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 20px;
        margin-bottom: 20px;
      }

      .storage-bar-container {
        margin-bottom: 10px;
      }

      .storage-bar {
        height: 20px;
        background: #e0e0e0;
        border-radius: 10px;
        overflow: hidden;
        margin-bottom: 8px;
      }

      .storage-bar-fill {
        height: 100%;
        background: #4caf50;
        border-radius: 10px;
        transition: width 0.3s, background 0.3s;
      }

      .storage-info {
        font-size: 12px;
        color: #666;
        text-align: center;
      }

      .auto-save-status {
        margin-top: 10px;
        padding: 8px;
        background: #f5f5f5;
        border-radius: 4px;
        font-size: 12px;
        color: #666;
      }

      .sim-history-controls {
        display: flex;
        gap: 10px;
        margin-bottom: 10px;
      }

      .sim-history-stats {
        font-size: 12px;
        color: #666;
      }

      .export-import-buttons {
        display: flex;
        gap: 10px;
        margin-bottom: 15px;
      }

      .export-options {
        padding: 10px;
        background: #f8f9fa;
        border-radius: 6px;
      }

      .danger-zone {
        border: 2px solid #ffcdd2;
        background: #ffebee;
      }

      .danger-zone h4 {
        color: #c62828;
      }

      .danger-buttons {
        display: flex;
        gap: 10px;
        margin-bottom: 10px;
      }

      .warning-text {
        color: #c62828;
        font-weight: 500;
      }

      /* Simulation History Modal */
      .sim-history-dialog {
        max-width: 800px;
        width: 90%;
      }

      .sim-history-list {
        max-height: 400px;
        overflow-y: auto;
      }

      .sim-history-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 13px;
      }

      .sim-history-table th,
      .sim-history-table td {
        padding: 10px 12px;
        text-align: left;
        border-bottom: 1px solid #e0e0e0;
      }

      .sim-history-table th {
        background: #f5f5f5;
        font-weight: 600;
        color: #555;
        position: sticky;
        top: 0;
      }

      .sim-history-table tr:hover {
        background: #f8f9fa;
      }

      .btn-tiny {
        padding: 4px 8px;
        font-size: 12px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        background: transparent;
      }

      .btn-tiny:hover {
        background: #e0e0e0;
      }

      .no-history {
        text-align: center;
        padding: 40px 20px;
        color: #666;
      }

      .history-count {
        font-size: 13px;
        color: #666;
      }

      /* Notification Toast */
      .notification-toast {
        position: fixed;
        bottom: 30px;
        left: 50%;
        transform: translateX(-50%);
        background: #323232;
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        z-index: 3000;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        animation: slideUp 0.3s ease;
      }

      @keyframes slideUp {
        from {
          opacity: 0;
          transform: translateX(-50%) translateY(20px);
        }
        to {
          opacity: 1;
          transform: translateX(-50%) translateY(0);
        }
      }

      .notification-toast.fade-out {
        animation: fadeOut 0.3s ease forwards;
      }

      @keyframes fadeOut {
        from { opacity: 1; }
        to { opacity: 0; }
      }

      /* Integration Tab Styles */
      .integration-panel {
        padding: 20px;
        max-width: 1400px;
        margin: 0 auto;
      }

      .integration-header {
        text-align: center;
        margin-bottom: 20px;
      }

      .integration-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 20px;
      }

      @media (max-width: 1200px) {
        .integration-grid {
          grid-template-columns: 1fr;
        }
      }

      /* Altimeter Section */
      .altimeter-dropzone {
        border: 2px dashed #ccc;
        border-radius: 10px;
        padding: 30px 20px;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s;
        background: #fafafa;
      }

      .altimeter-dropzone:hover {
        border-color: #2196F3;
        background: #e3f2fd;
      }

      .altimeter-dropzone.dragover {
        border-color: #4CAF50;
        background: #e8f5e9;
      }

      .altimeter-dropzone .dropzone-icon {
        font-size: 40px;
        display: block;
        margin-bottom: 10px;
      }

      .altimeter-dropzone .dropzone-formats {
        display: block;
        font-size: 12px;
        color: #666;
        margin-top: 10px;
      }

      .altimeter-results {
        margin-top: 20px;
        padding: 15px;
        background: #f8f9fa;
        border-radius: 8px;
      }

      .altimeter-summary-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
        margin-bottom: 15px;
      }

      .summary-item {
        display: flex;
        justify-content: space-between;
        padding: 8px 12px;
        background: white;
        border-radius: 6px;
      }

      .summary-item.highlight {
        background: #e3f2fd;
        font-weight: 600;
      }

      .summary-label {
        color: #666;
      }

      .detected-events {
        margin-top: 15px;
        padding-top: 15px;
        border-top: 1px solid #e0e0e0;
      }

      .detected-events h5 {
        margin: 0 0 10px 0;
        color: #555;
      }

      .events-list {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .event-item {
        background: white;
        padding: 6px 12px;
        border-radius: 20px;
        font-size: 12px;
        display: flex;
        gap: 8px;
        align-items: center;
      }

      .event-name {
        font-weight: 600;
        color: #333;
      }

      .event-time, .event-alt {
        color: #666;
      }

      .altimeter-actions {
        display: flex;
        gap: 10px;
        margin-top: 15px;
        flex-wrap: wrap;
      }

      /* GPS Section */
      .gps-status {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 15px;
        background: #f5f5f5;
        border-radius: 8px;
        margin-bottom: 15px;
      }

      .gps-indicator {
        display: flex;
        align-items: center;
        gap: 10px;
      }

      .gps-dot {
        font-size: 20px;
        color: #999;
      }

      .gps-controls {
        display: flex;
        gap: 10px;
        margin-top: 15px;
      }

      .gps-tracking-panel {
        margin-top: 15px;
        padding: 15px;
        background: #e8f5e9;
        border-radius: 8px;
      }

      .gps-tracking-panel h4 {
        margin: 0 0 15px 0;
        color: #2e7d32;
      }

      .gps-live-data {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 10px;
      }

      .gps-data-row {
        display: flex;
        justify-content: space-between;
        padding: 8px 10px;
        background: white;
        border-radius: 4px;
      }

      .gps-label {
        font-size: 12px;
        color: #666;
      }

      .gps-track-actions {
        display: flex;
        gap: 10px;
        margin-top: 15px;
      }

      .import-row {
        display: flex;
        gap: 10px;
        align-items: center;
      }

      /* Club Section */
      .club-tabs {
        display: flex;
        gap: 5px;
        margin-bottom: 15px;
        background: #f0f0f0;
        padding: 5px;
        border-radius: 8px;
      }

      .club-tab {
        flex: 1;
        padding: 10px 15px;
        border: none;
        background: transparent;
        cursor: pointer;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
      }

      .club-tab:hover {
        background: rgba(255,255,255,0.5);
      }

      .club-tab.active {
        background: white;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
      }

      .club-list {
        max-height: 300px;
        overflow-y: auto;
      }

      .club-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 15px;
        background: #f8f9fa;
        border-radius: 8px;
        margin-bottom: 10px;
      }

      .club-card h4 {
        margin: 0 0 5px 0;
      }

      .club-card p {
        margin: 0;
        font-size: 13px;
        color: #666;
      }

      .club-meta {
        display: flex;
        gap: 15px;
        margin-top: 8px;
        font-size: 12px;
        color: #888;
      }

      .club-actions {
        display: flex;
        gap: 8px;
        margin-top: 15px;
      }

      .no-clubs, .no-flights, .no-competitions, .no-data {
        text-align: center;
        padding: 30px 20px;
        color: #666;
        background: #f5f5f5;
        border-radius: 8px;
      }

      .shared-flights-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 15px;
      }

      .shared-flights-list {
        max-height: 350px;
        overflow-y: auto;
      }

      .shared-flight-card {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 15px;
        background: #f8f9fa;
        border-radius: 8px;
        margin-bottom: 8px;
      }

      .flight-info {
        display: flex;
        flex-direction: column;
        gap: 3px;
      }

      .flight-rocket {
        font-weight: 600;
      }

      .flight-motor, .flight-date {
        font-size: 12px;
        color: #666;
      }

      .flight-stats {
        display: flex;
        gap: 15px;
        font-size: 13px;
      }

      .flight-actions {
        display: flex;
        gap: 5px;
      }

      .competition-card {
        padding: 15px;
        background: #f8f9fa;
        border-radius: 8px;
        margin-bottom: 10px;
      }

      .competition-card.active {
        border-left: 4px solid #4CAF50;
      }

      .competition-card.completed {
        border-left: 4px solid #9e9e9e;
        opacity: 0.8;
      }

      .comp-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }

      .comp-header h4 {
        margin: 0;
      }

      .comp-status {
        font-size: 11px;
        padding: 3px 8px;
        background: #e3f2fd;
        border-radius: 10px;
        text-transform: uppercase;
      }

      .comp-details {
        display: flex;
        gap: 15px;
        font-size: 12px;
        color: #666;
        margin-bottom: 10px;
      }

      .comp-actions {
        display: flex;
        gap: 10px;
      }

      .competition-actions {
        margin-top: 15px;
      }

      /* Statistics */
      .stats-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 15px;
        margin-bottom: 15px;
      }

      .stat-item {
        text-align: center;
        padding: 15px;
        background: #f8f9fa;
        border-radius: 8px;
      }

      .stat-value {
        display: block;
        font-size: 24px;
        font-weight: 700;
        color: #000;
      }

      .stat-label {
        font-size: 12px;
        color: #666;
      }

      .top-rockets {
        padding: 15px;
        background: #f5f5f5;
        border-radius: 8px;
      }

      .top-rockets h5 {
        margin: 0 0 10px 0;
      }

      /* Comparison styles */
      .comparison-grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr 1fr;
        gap: 1px;
        background: #e0e0e0;
        border-radius: 8px;
        overflow: hidden;
        margin-bottom: 20px;
      }

      .comparison-header, .comparison-row {
        display: contents;
      }

      .comparison-header span {
        padding: 12px;
        background: #f5f5f5;
        font-weight: 600;
        text-align: center;
      }

      .comparison-row span {
        padding: 12px;
        background: white;
        text-align: center;
      }

      .comparison-row span.good {
        color: #4CAF50;
        font-weight: 600;
      }

      .comparison-row span.warn {
        color: #FF9800;
        font-weight: 600;
      }

      .comparison-row span.bad {
        color: #f44336;
        font-weight: 600;
      }

      /* Leaderboard */
      .leaderboard-table {
        width: 100%;
        border-collapse: collapse;
      }

      .leaderboard-table th, .leaderboard-table td {
        padding: 12px;
        text-align: left;
        border-bottom: 1px solid #e0e0e0;
      }

      .leaderboard-table th {
        background: #f5f5f5;
        font-weight: 600;
      }

      .leaderboard-table tr.top-1 {
        background: #fff8e1;
      }

      .leaderboard-table tr.top-2 {
        background: #f5f5f5;
      }

      .leaderboard-table tr.top-3 {
        background: #fff3e0;
      }

      .flight-preview {
        padding: 15px;
        background: #f5f5f5;
        border-radius: 8px;
        margin-bottom: 15px;
      }

      .flight-preview p {
        margin: 5px 0;
      }
    `;

    document.head.appendChild(style);
  }
}

// ============================================
// Export
// ============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { LaunchSimApp, AppState };
}

if (typeof window !== 'undefined') {
  window.LaunchSimApp = LaunchSimApp;
  window.AppState = AppState;
}

export { LaunchSimApp, AppState };

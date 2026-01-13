/**
 * ThrustCurve.org API Client
 * ==========================
 * 
 * Live integration with ThrustCurve.org motor database.
 * Provides search, download, and caching functionality.
 * 
 * API Documentation: https://www.thrustcurve.org/info/api.html
 * 
 * Usage:
 *   const tc = new ThrustCurveAPI();
 *   const motors = await tc.search({ impulseClass: 'G', manufacturer: 'Aerotech' });
 *   const thrustData = await tc.downloadThrustCurve(motorId);
 */

// Debug mode - set to true for verbose logging
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[ThrustCurve]', ...args),
  warn: (...args) => console.warn('[ThrustCurve]', ...args),
  error: (...args) => console.error('[ThrustCurve]', ...args)
};

class ThrustCurveAPI {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'https://www.thrustcurve.org/api/v1';
    this.cdnUrl = options.cdnUrl || 'https://cdn.jsdelivr.net/npm/thrustcurve-db@latest/thrustcurve-db.json';
    this.timeout = options.timeout || 15000;
    this.cache = new Map();
    this.cacheExpiry = options.cacheExpiry || 3600000; // 1 hour
    this.useOfflineDB = options.useOfflineDB || false;
    this.offlineDB = null;
    
    // Rate limiting
    this.lastRequest = 0;
    this.minRequestInterval = 100; // ms between requests
  }

  // ============================================
  // HTTP Helpers
  // ============================================

  async fetch(url, options = {}) {
    // Rate limiting
    const now = Date.now();
    const elapsed = now - this.lastRequest;
    if (elapsed < this.minRequestInterval) {
      await this.delay(this.minRequestInterval - elapsed);
    }
    this.lastRequest = Date.now();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          ...options.headers
        }
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getCacheKey(endpoint, params) {
    return `${endpoint}:${JSON.stringify(params)}`;
  }

  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  // ============================================
  // Offline Database (CDN)
  // ============================================

  /**
   * Load the complete motor database from CDN for offline use
   * Contains ~1100+ motors with thrust curves
   */
  async loadOfflineDatabase() {
    if (this.offlineDB) {
      return this.offlineDB;
    }

    try {
      log.debug('Loading ThrustCurve offline database...');
      const data = await this.fetch(this.cdnUrl);
      this.offlineDB = data;
      log.debug(`Loaded ${data.length} motors from offline database`);
      return data;
    } catch (error) {
      log.error('Failed to load offline database:', error);
      throw error;
    }
  }

  /**
   * Search offline database
   */
  searchOffline(criteria = {}) {
    if (!this.offlineDB) {
      throw new Error('Offline database not loaded. Call loadOfflineDatabase() first.');
    }

    let results = [...this.offlineDB];

    // Filter by criteria
    if (criteria.manufacturer) {
      const mfr = criteria.manufacturer.toLowerCase();
      results = results.filter(m => 
        m.manufacturer?.toLowerCase().includes(mfr) ||
        m.manufacturerAbbrev?.toLowerCase().includes(mfr)
      );
    }

    if (criteria.impulseClass) {
      results = results.filter(m => 
        m.impulseClass === criteria.impulseClass.toUpperCase()
      );
    }

    if (criteria.diameter) {
      const dia = parseFloat(criteria.diameter);
      results = results.filter(m => 
        Math.abs(m.diameter - dia) < 1
      );
    }

    if (criteria.type) {
      results = results.filter(m => m.type === criteria.type);
    }

    if (criteria.availability) {
      results = results.filter(m => m.availability === criteria.availability);
    }

    if (criteria.commonName) {
      const name = criteria.commonName.toLowerCase();
      results = results.filter(m => 
        m.commonName?.toLowerCase().includes(name) ||
        m.designation?.toLowerCase().includes(name)
      );
    }

    if (criteria.minImpulse) {
      results = results.filter(m => m.totImpulseNs >= criteria.minImpulse);
    }

    if (criteria.maxImpulse) {
      results = results.filter(m => m.totImpulseNs <= criteria.maxImpulse);
    }

    // Sort by total impulse
    results.sort((a, b) => (a.totImpulseNs || 0) - (b.totImpulseNs || 0));

    return results;
  }

  // ============================================
  // Live API Methods
  // ============================================

  /**
   * Get metadata about available motors
   * @param {Object} criteria - Optional filter criteria
   */
  async getMetadata(criteria = {}) {
    const cacheKey = this.getCacheKey('metadata', criteria);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(criteria)) {
      if (value !== undefined && value !== null) {
        params.append(this.toApiParam(key), value);
      }
    }

    const url = `${this.baseUrl}/metadata.json?${params.toString()}`;
    const data = await this.fetch(url);
    
    this.setCache(cacheKey, data);
    return data;
  }

  /**
   * Search for motors matching criteria
   * @param {Object} criteria - Search criteria
   * @returns {Array} Array of matching motors
   */
  async search(criteria = {}) {
    // Try offline database first if enabled
    if (this.useOfflineDB && this.offlineDB) {
      return this.searchOffline(criteria);
    }

    const cacheKey = this.getCacheKey('search', criteria);
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams();
    
    // Map criteria to API parameters
    const paramMap = {
      manufacturer: 'manufacturer',
      impulseClass: 'impulse-class',
      diameter: 'diameter',
      type: 'type',
      certOrg: 'cert-org',
      availability: 'availability',
      commonName: 'common-name',
      designation: 'designation',
      brandName: 'brand-name',
      maxResults: 'max-results'
    };

    for (const [key, value] of Object.entries(criteria)) {
      if (value !== undefined && value !== null) {
        const apiParam = paramMap[key] || key;
        params.append(apiParam, value);
      }
    }

    try {
      const url = `${this.baseUrl}/search.json?${params.toString()}`;
      const data = await this.fetch(url);
      
      const results = data.results || [];
      this.setCache(cacheKey, results);
      return results;
    } catch (error) {
      log.warn('Live search failed, trying offline database:', error.message);
      
      // Fallback to offline database
      if (!this.offlineDB) {
        await this.loadOfflineDatabase();
      }
      return this.searchOffline(criteria);
    }
  }

  /**
   * Download thrust curve data for a motor
   * @param {string} motorId - Motor ID from search results
   * @param {string} format - Format: 'RASP', 'RockSim', 'samples'
   * @returns {Object} Motor data with thrust curve
   */
  async downloadThrustCurve(motorId, format = 'samples') {
    const cacheKey = this.getCacheKey('download', { motorId, format });
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    // Check offline database first
    if (this.offlineDB) {
      const motor = this.offlineDB.find(m => m.motorId === motorId);
      if (motor && motor.samples) {
        this.setCache(cacheKey, motor);
        return motor;
      }
    }

    const params = new URLSearchParams({
      'motorId': motorId,
      'data': format,
      'format': format === 'samples' ? 'JSON' : format
    });

    try {
      const url = `${this.baseUrl}/download.json?${params.toString()}`;
      const data = await this.fetch(url);
      
      this.setCache(cacheKey, data);
      return data;
    } catch (error) {
      log.error('Failed to download thrust curve:', error);
      throw error;
    }
  }

  /**
   * Get motor recommendations for a rocket
   * @param {Object} rocket - Rocket specifications
   */
  async getMotorGuide(rocket) {
    const params = new URLSearchParams({
      'diameter': rocket.mmtDiameter || 29,
      'length': rocket.mmtLength || 100,
      'weight': rocket.weight || 500
    });

    const url = `${this.baseUrl}/motorguide.json?${params.toString()}`;
    return await this.fetch(url);
  }

  // ============================================
  // Convenience Methods
  // ============================================

  /**
   * Get all motors for a specific impulse class
   * @param {string} impulseClass - e.g., 'A', 'B', 'C', ... 'O'
   */
  async getMotorsByClass(impulseClass) {
    return this.search({ 
      impulseClass: impulseClass.toUpperCase(),
      availability: 'regular',
      maxResults: 100
    });
  }

  /**
   * Get motors from a specific manufacturer
   * @param {string} manufacturer - e.g., 'Aerotech', 'Cesaroni', 'Estes'
   */
  async getMotorsByManufacturer(manufacturer) {
    return this.search({ 
      manufacturer,
      availability: 'regular',
      maxResults: 100
    });
  }

  /**
   * Get motors that fit a specific motor mount
   * @param {number} diameter - Mount diameter in mm
   * @param {number} maxLength - Maximum motor length in mm
   */
  async getMotorsForMount(diameter, maxLength = 1000) {
    const results = await this.search({
      diameter,
      availability: 'regular',
      maxResults: 100
    });

    return results.filter(m => !m.length || m.length <= maxLength);
  }

  /**
   * Search by common name (e.g., "G80", "H128")
   * @param {string} name - Motor common name
   */
  async searchByName(name) {
    // Try offline first for speed
    if (this.offlineDB) {
      const results = this.offlineDB.filter(m => 
        m.commonName?.toLowerCase().includes(name.toLowerCase()) ||
        m.designation?.toLowerCase().includes(name.toLowerCase())
      );
      if (results.length > 0) return results;
    }

    return this.search({ commonName: name, maxResults: 20 });
  }

  /**
   * Get complete motor info with thrust curve
   * @param {string} motorIdOrName - Motor ID or common name
   */
  async getMotorComplete(motorIdOrName) {
    let motor;

    // Check if it's an ID or name
    if (motorIdOrName.length === 24) {
      // Likely a MongoDB ObjectId
      motor = await this.downloadThrustCurve(motorIdOrName, 'samples');
    } else {
      // Search by name
      const results = await this.searchByName(motorIdOrName);
      if (results.length === 0) {
        throw new Error(`Motor "${motorIdOrName}" not found`);
      }
      motor = results[0];
      
      // Get thrust curve if not already present
      if (!motor.samples && motor.motorId) {
        const fullData = await this.downloadThrustCurve(motor.motorId, 'samples');
        motor = { ...motor, ...fullData };
      }
    }

    return motor;
  }

  /**
   * Convert motor data to LAUNCHSIM format
   * @param {Object} tcMotor - ThrustCurve motor object
   */
  tolaunchsimFormat(tcMotor) {
    // Convert samples to thrust curve array
    let thrustCurve = [];
    if (tcMotor.samples) {
      thrustCurve = tcMotor.samples.map(s => [s[0], s[1]]);
    } else if (tcMotor.data && Array.isArray(tcMotor.data)) {
      thrustCurve = tcMotor.data;
    }

    return {
      id: tcMotor.motorId || tcMotor.commonName,
      manufacturer: tcMotor.manufacturer || tcMotor.manufacturerAbbrev,
      designation: tcMotor.designation || tcMotor.commonName,
      commonName: tcMotor.commonName,
      impulseClass: tcMotor.impulseClass,
      diameter: tcMotor.diameter,
      length: tcMotor.length,
      totalMass: tcMotor.totWeightG || tcMotor.totalWeight,
      propMass: tcMotor.propWeightG || tcMotor.propellantWeight,
      avgThrust: tcMotor.avgThrustN || tcMotor.avgThrust,
      maxThrust: tcMotor.maxThrustN || tcMotor.maxThrust,
      burnTime: tcMotor.burnTimeS || tcMotor.burnTime,
      totalImpulse: tcMotor.totImpulseNs || tcMotor.totalImpulse,
      isp: tcMotor.isp || (tcMotor.totImpulseNs / ((tcMotor.propWeightG || 100) * 0.00981)),
      delays: tcMotor.delays || [],
      propellantType: tcMotor.propInfo,
      caseInfo: tcMotor.caseInfo,
      availability: tcMotor.availability,
      certOrg: tcMotor.certOrg,
      thrustCurve,
      // Original ThrustCurve data
      _tcData: tcMotor
    };
  }

  /**
   * Get list of all manufacturers
   */
  async getManufacturers() {
    const metadata = await this.getMetadata();
    return metadata.manufacturers || [];
  }

  /**
   * Get list of all impulse classes with counts
   */
  async getImpulseClasses() {
    const metadata = await this.getMetadata();
    return metadata.impulseClasses || [];
  }

  /**
   * Get list of certification organizations
   */
  async getCertOrgs() {
    const metadata = await this.getMetadata();
    return metadata.certOrgs || [];
  }

  // Helper to convert camelCase to kebab-case
  toApiParam(str) {
    return str.replace(/([A-Z])/g, '-$1').toLowerCase();
  }

  // ============================================
  // Statistics
  // ============================================

  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  clearCache() {
    this.cache.clear();
  }
}

// ============================================
// Motor Database Manager
// ============================================

class MotorDatabaseManager {
  constructor(options = {}) {
    this.api = new ThrustCurveAPI(options);
    this.favorites = new Set();
    this.recentlyUsed = [];
    this.maxRecent = options.maxRecent || 10;
    
    // Load from localStorage if available
    this.loadState();
  }

  loadState() {
    if (typeof localStorage === 'undefined') return;
    
    try {
      const favorites = localStorage.getItem('launchsim_favorite_motors');
      if (favorites) {
        this.favorites = new Set(JSON.parse(favorites));
      }
      
      const recent = localStorage.getItem('launchsim_recent_motors');
      if (recent) {
        this.recentlyUsed = JSON.parse(recent);
      }
    } catch (e) {
      log.warn('Failed to load motor state:', e);
    }
  }

  saveState() {
    if (typeof localStorage === 'undefined') return;
    
    try {
      localStorage.setItem('launchsim_favorite_motors', 
        JSON.stringify([...this.favorites]));
      localStorage.setItem('launchsim_recent_motors',
        JSON.stringify(this.recentlyUsed));
    } catch (e) {
      log.warn('Failed to save motor state:', e);
    }
  }

  addFavorite(motorId) {
    this.favorites.add(motorId);
    this.saveState();
  }

  removeFavorite(motorId) {
    this.favorites.delete(motorId);
    this.saveState();
  }

  isFavorite(motorId) {
    return this.favorites.has(motorId);
  }

  addToRecent(motor) {
    // Remove if already in list
    this.recentlyUsed = this.recentlyUsed.filter(m => m.id !== motor.id);
    
    // Add to front
    this.recentlyUsed.unshift({
      id: motor.id,
      name: motor.commonName || motor.designation,
      manufacturer: motor.manufacturer,
      impulseClass: motor.impulseClass
    });
    
    // Trim to max
    if (this.recentlyUsed.length > this.maxRecent) {
      this.recentlyUsed = this.recentlyUsed.slice(0, this.maxRecent);
    }
    
    this.saveState();
  }

  getRecent() {
    return this.recentlyUsed;
  }

  async search(criteria) {
    const results = await this.api.search(criteria);
    return results.map(m => this.api.tolaunchsimFormat(m));
  }

  async getMotor(idOrName) {
    const motor = await this.api.getMotorComplete(idOrName);
    const formatted = this.api.tolaunchsimFormat(motor);
    this.addToRecent(formatted);
    return formatted;
  }

  async initialize() {
    // Pre-load offline database for fast searches
    await this.api.loadOfflineDatabase();
    this.api.useOfflineDB = true;
  }
}

// ============================================
// UI Components
// ============================================

class MotorSearchUI {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.manager = new MotorDatabaseManager(options);
    this.onSelect = options.onSelect || (() => {});
    this.selectedMotor = null;
    
    this.init();
  }

  async init() {
    this.render();
    await this.manager.initialize();
    this.updateRecentList();
  }

  render() {
    this.container.innerHTML = `
      <div class="motor-search">
        <div class="search-header">
          <h3>🔍 ThrustCurve.org Motor Search</h3>
        </div>
        
        <div class="search-filters">
          <div class="filter-row">
            <input type="text" id="motor-name-search" placeholder="Search by name (e.g., G80, H128)...">
            <button id="motor-search-btn" class="btn-primary">Search</button>
          </div>
          
          <div class="filter-row">
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
            
            <select id="motor-mfr-filter">
              <option value="">All Manufacturers</option>
              <option value="Aerotech">Aerotech</option>
              <option value="Cesaroni">Cesaroni</option>
              <option value="Estes">Estes</option>
              <option value="Loki">Loki Research</option>
              <option value="Contrail">Contrail</option>
              <option value="AMW">Animal Motor Works</option>
            </select>
            
            <select id="motor-dia-filter">
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
        </div>
        
        <div class="search-results" id="motor-search-results">
          <div class="loading-placeholder">
            Enter search criteria and click Search, or select from recent motors below
          </div>
        </div>
        
        <div class="recent-motors" id="recent-motors">
          <h4>Recently Used</h4>
          <div class="recent-list" id="recent-motors-list"></div>
        </div>
        
        <div class="selected-motor" id="selected-motor-info" style="display: none;">
          <h4>Selected Motor</h4>
          <div class="motor-details" id="motor-details"></div>
          <canvas id="thrust-curve-preview" width="300" height="150"></canvas>
        </div>
      </div>
    `;

    // Bind events
    this.container.querySelector('#motor-search-btn').addEventListener('click', () => this.doSearch());
    this.container.querySelector('#motor-name-search').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.doSearch();
    });
    
    // Filter change triggers search
    ['motor-class-filter', 'motor-mfr-filter', 'motor-dia-filter'].forEach(id => {
      this.container.querySelector(`#${id}`).addEventListener('change', () => this.doSearch());
    });
  }

  async doSearch() {
    const nameSearch = this.container.querySelector('#motor-name-search').value.trim();
    const impulseClass = this.container.querySelector('#motor-class-filter').value;
    const manufacturer = this.container.querySelector('#motor-mfr-filter').value;
    const diameter = this.container.querySelector('#motor-dia-filter').value;

    const criteria = {};
    if (nameSearch) criteria.commonName = nameSearch;
    if (impulseClass) criteria.impulseClass = impulseClass;
    if (manufacturer) criteria.manufacturer = manufacturer;
    if (diameter) criteria.diameter = parseInt(diameter);

    const resultsEl = this.container.querySelector('#motor-search-results');
    resultsEl.innerHTML = '<div class="loading">Searching ThrustCurve.org...</div>';

    try {
      const results = await this.manager.search(criteria);
      this.displayResults(results.slice(0, 50));
    } catch (error) {
      resultsEl.innerHTML = `<div class="error">Search failed: ${error.message}</div>`;
    }
  }

  displayResults(motors) {
    const resultsEl = this.container.querySelector('#motor-search-results');
    
    if (motors.length === 0) {
      resultsEl.innerHTML = '<div class="no-results">No motors found matching criteria</div>';
      return;
    }

    resultsEl.innerHTML = `
      <div class="results-count">${motors.length} motors found</div>
      <div class="motor-list">
        ${motors.map(m => this.renderMotorCard(m)).join('')}
      </div>
    `;

    // Bind click events
    resultsEl.querySelectorAll('.motor-card').forEach(card => {
      card.addEventListener('click', () => {
        const motorId = card.dataset.motorId;
        const motor = motors.find(m => m.id === motorId);
        if (motor) this.selectMotor(motor);
      });
    });
  }

  renderMotorCard(motor) {
    const isFav = this.manager.isFavorite(motor.id);
    return `
      <div class="motor-card" data-motor-id="${motor.id}">
        <div class="motor-header">
          <span class="motor-name">${motor.commonName || motor.designation}</span>
          <span class="impulse-class class-${motor.impulseClass}">${motor.impulseClass}</span>
        </div>
        <div class="motor-info">
          <span class="manufacturer">${motor.manufacturer}</span>
          <span class="specs">${motor.diameter}mm × ${motor.length || '?'}mm</span>
        </div>
        <div class="motor-stats">
          <span>Impulse: ${motor.totalImpulse?.toFixed(1) || '?'} Ns</span>
          <span>Thrust: ${motor.avgThrust?.toFixed(1) || '?'} N avg</span>
          <span>Burn: ${motor.burnTime?.toFixed(2) || '?'} s</span>
        </div>
        <button class="fav-btn ${isFav ? 'active' : ''}" data-motor-id="${motor.id}">
          ${isFav ? '★' : '☆'}
        </button>
      </div>
    `;
  }

  async selectMotor(motor) {
    this.selectedMotor = motor;
    
    // Get full data with thrust curve
    try {
      const fullMotor = await this.manager.getMotor(motor.id);
      this.selectedMotor = fullMotor;
      this.displaySelectedMotor(fullMotor);
      this.onSelect(fullMotor);
    } catch (e) {
      this.displaySelectedMotor(motor);
      this.onSelect(motor);
    }
  }

  displaySelectedMotor(motor) {
    const infoEl = this.container.querySelector('#selected-motor-info');
    const detailsEl = this.container.querySelector('#motor-details');
    
    infoEl.style.display = 'block';
    detailsEl.innerHTML = `
      <div class="detail-row"><strong>${motor.commonName || motor.designation}</strong></div>
      <div class="detail-row">Manufacturer: ${motor.manufacturer}</div>
      <div class="detail-row">Class: ${motor.impulseClass} | ${motor.diameter}mm</div>
      <div class="detail-row">Total Impulse: ${motor.totalImpulse?.toFixed(1)} Ns</div>
      <div class="detail-row">Avg Thrust: ${motor.avgThrust?.toFixed(1)} N</div>
      <div class="detail-row">Max Thrust: ${motor.maxThrust?.toFixed(1)} N</div>
      <div class="detail-row">Burn Time: ${motor.burnTime?.toFixed(2)} s</div>
      <div class="detail-row">Propellant: ${motor.propMass?.toFixed(1) || '?'}g</div>
      <div class="detail-row">Total Mass: ${motor.totalMass?.toFixed(1) || '?'}g</div>
    `;

    // Draw thrust curve
    if (motor.thrustCurve && motor.thrustCurve.length > 0) {
      this.drawThrustCurve(motor.thrustCurve);
    }
  }

  drawThrustCurve(curve) {
    const canvas = this.container.querySelector('#thrust-curve-preview');
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = 20;

    // Clear
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    if (curve.length < 2) return;

    // Find max values
    const maxTime = curve[curve.length - 1][0];
    const maxThrust = Math.max(...curve.map(p => p[1]));

    // Scale
    const scaleX = (width - 2 * padding) / maxTime;
    const scaleY = (height - 2 * padding) / maxThrust;

    // Draw curve
    ctx.beginPath();
    ctx.strokeStyle = '#ff6b35';
    ctx.lineWidth = 2;

    curve.forEach((point, i) => {
      const x = padding + point[0] * scaleX;
      const y = height - padding - point[1] * scaleY;
      
      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });

    ctx.stroke();

    // Fill under curve
    ctx.lineTo(padding + maxTime * scaleX, height - padding);
    ctx.lineTo(padding, height - padding);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 107, 53, 0.2)';
    ctx.fill();

    // Axes labels
    ctx.fillStyle = '#888';
    ctx.font = '10px monospace';
    ctx.fillText('0', padding - 10, height - padding + 12);
    ctx.fillText(`${maxTime.toFixed(1)}s`, width - padding - 15, height - padding + 12);
    ctx.fillText(`${maxThrust.toFixed(0)}N`, padding - 5, padding + 5);
  }

  updateRecentList() {
    const listEl = this.container.querySelector('#recent-motors-list');
    const recent = this.manager.getRecent();
    
    if (recent.length === 0) {
      listEl.innerHTML = '<div class="no-recent">No recently used motors</div>';
      return;
    }

    listEl.innerHTML = recent.map(m => `
      <div class="recent-motor" data-motor-id="${m.id}">
        <span class="recent-name">${m.name}</span>
        <span class="recent-class class-${m.impulseClass}">${m.impulseClass}</span>
      </div>
    `).join('');

    listEl.querySelectorAll('.recent-motor').forEach(el => {
      el.addEventListener('click', async () => {
        try {
          const motor = await this.manager.getMotor(el.dataset.motorId);
          this.selectMotor(motor);
        } catch (error) {
          log.error('Failed to load motor:', error.message);
        }
      });
    });
  }

  getSelectedMotor() {
    return this.selectedMotor;
  }
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ThrustCurveAPI,
    MotorDatabaseManager,
    MotorSearchUI
  };
}

// Expose globally for HTML usage
if (typeof window !== 'undefined') {
  window.ThrustCurveAPI = ThrustCurveAPI;
  window.MotorDatabaseManager = MotorDatabaseManager;
  window.MotorSearchUI = MotorSearchUI;
}

// ES Module exports
export { ThrustCurveAPI, MotorDatabaseManager, MotorSearchUI };

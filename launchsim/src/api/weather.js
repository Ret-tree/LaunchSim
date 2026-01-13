/**
 * LAUNCHSIM Weather API Client
 * ============================
 * 
 * Real-time weather data integration for accurate flight simulation.
 * Uses Open-Meteo free API (no API key required).
 * 
 * Features:
 * - Current conditions (wind, temperature, pressure)
 * - Hourly forecasts (up to 16 days)
 * - Multi-altitude wind profiles
 * - Weather model selection (GFS, HRRR, ECMWF)
 * - Caching and rate limiting
 * 
 * API: https://open-meteo.com/en/docs
 */

// ============================================
// Weather Data Structures
// ============================================

/**
 * @typedef {Object} CurrentWeather
 * @property {number} temperature - Temperature in Celsius
 * @property {number} humidity - Relative humidity %
 * @property {number} pressure - Sea level pressure in hPa
 * @property {number} windSpeed - Wind speed in m/s
 * @property {number} windDirection - Wind direction in degrees (0=N, 90=E)
 * @property {number} windGusts - Wind gusts in m/s
 * @property {number} cloudCover - Cloud cover %
 * @property {number} visibility - Visibility in meters
 * @property {string} conditions - Weather condition description
 * @property {number} weatherCode - WMO weather code
 */

/**
 * @typedef {Object} WindLayer
 * @property {number} altitude - Altitude in meters AGL
 * @property {number} speed - Wind speed in m/s
 * @property {number} direction - Wind direction in degrees
 * @property {number} temperature - Temperature at altitude in Celsius
 */

/**
 * @typedef {Object} HourlyForecast
 * @property {Date} time
 * @property {number} temperature
 * @property {number} humidity
 * @property {number} windSpeed
 * @property {number} windDirection
 * @property {number} windGusts
 * @property {number} pressure
 * @property {number} precipitation
 * @property {number} cloudCover
 * @property {number} weatherCode
 */

// WMO Weather Codes to descriptions
const WEATHER_CODES = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  56: 'Light freezing drizzle',
  57: 'Dense freezing drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Heavy freezing rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail'
};

// ============================================
// Weather API Client
// ============================================

class WeatherAPI {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || 'https://api.open-meteo.com/v1';
    this.timeout = options.timeout || 10000;
    this.cache = new Map();
    this.cacheExpiry = options.cacheExpiry || 600000; // 10 minutes
    
    // Rate limiting
    this.lastRequest = 0;
    this.minRequestInterval = 100;
    
    // Default location (Spaceport America, NM)
    this.defaultLocation = options.defaultLocation || {
      latitude: 32.99,
      longitude: -106.97,
      name: 'Spaceport America'
    };
  }

  // ============================================
  // HTTP Helpers
  // ============================================

  async fetch(url) {
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
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error('Weather API request timed out');
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
  // Current Weather
  // ============================================

  /**
   * Get current weather conditions
   * @param {number} latitude
   * @param {number} longitude
   * @returns {Promise<CurrentWeather>}
   */
  async getCurrentWeather(latitude, longitude) {
    const cacheKey = this.getCacheKey('current', { latitude, longitude });
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      latitude: latitude.toFixed(4),
      longitude: longitude.toFixed(4),
      current: [
        'temperature_2m',
        'relative_humidity_2m',
        'apparent_temperature',
        'precipitation',
        'weather_code',
        'cloud_cover',
        'pressure_msl',
        'surface_pressure',
        'wind_speed_10m',
        'wind_direction_10m',
        'wind_gusts_10m'
      ].join(','),
      wind_speed_unit: 'ms',
      timezone: 'auto'
    });

    const url = `${this.baseUrl}/forecast?${params}`;
    const data = await this.fetch(url);

    const current = data.current;
    const result = {
      latitude: data.latitude,
      longitude: data.longitude,
      elevation: data.elevation,
      timezone: data.timezone,
      time: new Date(current.time),
      temperature: current.temperature_2m,
      humidity: current.relative_humidity_2m,
      apparentTemperature: current.apparent_temperature,
      precipitation: current.precipitation,
      pressure: current.pressure_msl,
      surfacePressure: current.surface_pressure,
      windSpeed: current.wind_speed_10m,
      windDirection: current.wind_direction_10m,
      windGusts: current.wind_gusts_10m,
      cloudCover: current.cloud_cover,
      weatherCode: current.weather_code,
      conditions: WEATHER_CODES[current.weather_code] || 'Unknown'
    };

    this.setCache(cacheKey, result);
    return result;
  }

  // ============================================
  // Hourly Forecast
  // ============================================

  /**
   * Get hourly forecast
   * @param {number} latitude
   * @param {number} longitude
   * @param {number} days - Number of forecast days (1-16)
   * @returns {Promise<HourlyForecast[]>}
   */
  async getHourlyForecast(latitude, longitude, days = 3) {
    const cacheKey = this.getCacheKey('hourly', { latitude, longitude, days });
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({
      latitude: latitude.toFixed(4),
      longitude: longitude.toFixed(4),
      hourly: [
        'temperature_2m',
        'relative_humidity_2m',
        'precipitation_probability',
        'precipitation',
        'weather_code',
        'cloud_cover',
        'visibility',
        'wind_speed_10m',
        'wind_direction_10m',
        'wind_gusts_10m',
        'pressure_msl'
      ].join(','),
      wind_speed_unit: 'ms',
      forecast_days: Math.min(days, 16),
      timezone: 'auto'
    });

    const url = `${this.baseUrl}/forecast?${params}`;
    const data = await this.fetch(url);

    const hourly = data.hourly;
    const result = hourly.time.map((time, i) => ({
      time: new Date(time),
      temperature: hourly.temperature_2m[i],
      humidity: hourly.relative_humidity_2m[i],
      precipitationProbability: hourly.precipitation_probability[i],
      precipitation: hourly.precipitation[i],
      windSpeed: hourly.wind_speed_10m[i],
      windDirection: hourly.wind_direction_10m[i],
      windGusts: hourly.wind_gusts_10m[i],
      pressure: hourly.pressure_msl[i],
      cloudCover: hourly.cloud_cover[i],
      visibility: hourly.visibility?.[i],
      weatherCode: hourly.weather_code[i],
      conditions: WEATHER_CODES[hourly.weather_code[i]] || 'Unknown'
    }));

    this.setCache(cacheKey, result);
    return result;
  }

  // ============================================
  // Wind Profile (Multiple Altitudes)
  // ============================================

  /**
   * Get wind data at multiple altitudes using pressure levels
   * Essential for accurate rocket trajectory simulation
   * @param {number} latitude
   * @param {number} longitude
   * @returns {Promise<WindLayer[]>}
   */
  async getWindProfile(latitude, longitude) {
    const cacheKey = this.getCacheKey('wind_profile', { latitude, longitude });
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    // Pressure levels and approximate altitudes (meters AGL)
    const pressureLevels = [
      { level: 1000, altitude: 100 },
      { level: 950, altitude: 500 },
      { level: 925, altitude: 750 },
      { level: 900, altitude: 1000 },
      { level: 850, altitude: 1500 },
      { level: 800, altitude: 2000 },
      { level: 700, altitude: 3000 },
      { level: 600, altitude: 4500 },
      { level: 500, altitude: 5500 }
    ];

    const hourlyVars = pressureLevels.flatMap(p => [
      `wind_speed_${p.level}hPa`,
      `wind_direction_${p.level}hPa`,
      `temperature_${p.level}hPa`
    ]);

    const params = new URLSearchParams({
      latitude: latitude.toFixed(4),
      longitude: longitude.toFixed(4),
      hourly: hourlyVars.join(','),
      wind_speed_unit: 'ms',
      forecast_days: 1,
      timezone: 'auto'
    });

    const url = `${this.baseUrl}/forecast?${params}`;
    const data = await this.fetch(url);

    // Get current hour index
    const now = new Date();
    const currentHour = now.getHours();

    const hourly = data.hourly;
    const result = pressureLevels.map(p => ({
      altitude: p.altitude,
      pressureLevel: p.level,
      speed: hourly[`wind_speed_${p.level}hPa`]?.[currentHour] || 0,
      direction: hourly[`wind_direction_${p.level}hPa`]?.[currentHour] || 0,
      temperature: hourly[`temperature_${p.level}hPa`]?.[currentHour] || 15
    }));

    this.setCache(cacheKey, result);
    return result;
  }

  // ============================================
  // Launch Site Weather
  // ============================================

  /**
   * Get comprehensive weather data for a launch site
   * @param {number} latitude
   * @param {number} longitude
   * @returns {Promise<Object>}
   */
  async getLaunchSiteWeather(latitude, longitude) {
    const [current, hourly, windProfile] = await Promise.all([
      this.getCurrentWeather(latitude, longitude),
      this.getHourlyForecast(latitude, longitude, 2),
      this.getWindProfile(latitude, longitude)
    ]);

    // Find best launch window (lowest wind) in next 24 hours
    const next24Hours = hourly.slice(0, 24);
    const bestWindow = next24Hours.reduce((best, hour) => 
      hour.windSpeed < best.windSpeed ? hour : best
    , next24Hours[0]);

    // Calculate launch safety score (0-100)
    const safetyScore = this.calculateLaunchSafety(current, windProfile);

    return {
      location: {
        latitude,
        longitude,
        elevation: current.elevation
      },
      current,
      hourlyForecast: hourly,
      windProfile,
      bestLaunchWindow: bestWindow,
      safetyScore,
      recommendations: this.getLaunchRecommendations(current, windProfile)
    };
  }

  /**
   * Calculate launch safety score
   */
  calculateLaunchSafety(current, windProfile) {
    let score = 100;

    // Wind speed penalties
    if (current.windSpeed > 10) score -= 40;
    else if (current.windSpeed > 7) score -= 25;
    else if (current.windSpeed > 5) score -= 10;

    // Wind gusts penalty
    if (current.windGusts > 15) score -= 30;
    else if (current.windGusts > 10) score -= 15;

    // Precipitation penalty
    if (current.precipitation > 0) score -= 50;

    // Cloud cover penalty (affects tracking)
    if (current.cloudCover > 90) score -= 15;
    else if (current.cloudCover > 70) score -= 5;

    // Weather code penalties
    const severeWeather = [95, 96, 99, 65, 67, 75, 82, 86];
    const moderateWeather = [51, 53, 55, 61, 63, 71, 73, 80, 81, 85];
    
    if (severeWeather.includes(current.weatherCode)) score -= 100;
    else if (moderateWeather.includes(current.weatherCode)) score -= 30;

    // High altitude wind penalty
    const maxAltWind = Math.max(...windProfile.map(l => l.speed));
    if (maxAltWind > 20) score -= 20;
    else if (maxAltWind > 15) score -= 10;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get launch recommendations based on weather
   */
  getLaunchRecommendations(current, windProfile) {
    const recommendations = [];

    // Wind recommendations
    if (current.windSpeed > 10) {
      recommendations.push({
        type: 'warning',
        message: `Surface wind ${current.windSpeed.toFixed(1)} m/s - Consider postponing launch`,
        icon: '💨'
      });
    } else if (current.windSpeed > 5) {
      recommendations.push({
        type: 'caution',
        message: `Moderate wind ${current.windSpeed.toFixed(1)} m/s - Use sturdy launch rod`,
        icon: '🌬️'
      });
    }

    // Gust warnings
    if (current.windGusts > current.windSpeed * 1.5) {
      recommendations.push({
        type: 'warning',
        message: `Strong gusts up to ${current.windGusts.toFixed(1)} m/s expected`,
        icon: '⚠️'
      });
    }

    // Precipitation
    if (current.precipitation > 0) {
      recommendations.push({
        type: 'danger',
        message: 'Active precipitation - Do not launch',
        icon: '🌧️'
      });
    }

    // Thunderstorm
    if ([95, 96, 99].includes(current.weatherCode)) {
      recommendations.push({
        type: 'danger',
        message: 'Thunderstorm activity - Do not launch',
        icon: '⛈️'
      });
    }

    // High altitude winds
    const maxAltWind = Math.max(...windProfile.map(l => l.speed));
    const maxAltLayer = windProfile.find(l => l.speed === maxAltWind);
    if (maxAltWind > 15) {
      recommendations.push({
        type: 'caution',
        message: `Strong winds aloft: ${maxAltWind.toFixed(1)} m/s at ${maxAltLayer.altitude}m`,
        icon: '🎐'
      });
    }

    // Launch heading recommendation
    const launchHeading = (current.windDirection + 180) % 360;
    recommendations.push({
      type: 'info',
      message: `Recommended launch heading: ${launchHeading.toFixed(0)}° (into wind)`,
      icon: '🧭'
    });

    // Good conditions
    if (current.windSpeed < 5 && current.precipitation === 0 && 
        ![95, 96, 99].includes(current.weatherCode)) {
      recommendations.push({
        type: 'success',
        message: 'Weather conditions are favorable for launch',
        icon: '✅'
      });
    }

    return recommendations;
  }

  // ============================================
  // LAUNCHSIM Integration
  // ============================================

  /**
   * Convert weather data to LAUNCHSIM simulation config
   */
  toSimulationConfig(weatherData) {
    const current = weatherData.current;
    const profile = weatherData.windProfile;

    return {
      environment: {
        // Surface conditions
        temperature: current.temperature + 273.15, // Kelvin
        pressure: current.surfacePressure * 100, // Pa
        humidity: current.humidity,
        
        // Wind at surface
        wind_speed: current.windSpeed,
        wind_direction: current.windDirection,
        wind_gusts: current.windGusts,
        
        // Site info
        elevation: current.elevation,
        latitude: weatherData.location.latitude,
        longitude: weatherData.location.longitude
      },
      
      // Multi-layer wind model
      windLayers: profile.map(layer => ({
        altitude: layer.altitude,
        speed: layer.speed,
        direction: layer.direction,
        temperature: layer.temperature + 273.15
      })),

      // Metadata
      weatherSource: 'Open-Meteo',
      fetchTime: new Date().toISOString(),
      conditions: current.conditions,
      safetyScore: weatherData.safetyScore
    };
  }

  /**
   * Get wind vector at a given altitude (interpolated)
   */
  getWindAtAltitude(windLayers, altitude) {
    if (!windLayers || windLayers.length === 0) {
      return { speed: 0, direction: 0 };
    }

    // Find surrounding layers
    const sorted = [...windLayers].sort((a, b) => a.altitude - b.altitude);
    
    if (altitude <= sorted[0].altitude) {
      return { speed: sorted[0].speed, direction: sorted[0].direction };
    }
    
    if (altitude >= sorted[sorted.length - 1].altitude) {
      const last = sorted[sorted.length - 1];
      return { speed: last.speed, direction: last.direction };
    }

    // Interpolate between layers
    for (let i = 0; i < sorted.length - 1; i++) {
      if (altitude >= sorted[i].altitude && altitude < sorted[i + 1].altitude) {
        const lower = sorted[i];
        const upper = sorted[i + 1];
        const t = (altitude - lower.altitude) / (upper.altitude - lower.altitude);
        
        // Interpolate speed
        const speed = lower.speed + t * (upper.speed - lower.speed);
        
        // Interpolate direction (handle wrap-around)
        let dirDiff = upper.direction - lower.direction;
        if (dirDiff > 180) dirDiff -= 360;
        if (dirDiff < -180) dirDiff += 360;
        let direction = lower.direction + t * dirDiff;
        if (direction < 0) direction += 360;
        if (direction >= 360) direction -= 360;
        
        return { speed, direction };
      }
    }

    return { speed: 0, direction: 0 };
  }

  // ============================================
  // Preset Launch Sites
  // ============================================

  static LAUNCH_SITES = {
    spaceportAmerica: {
      name: 'Spaceport America',
      latitude: 32.99,
      longitude: -106.97,
      elevation: 1401,
      state: 'NM'
    },
    blackRock: {
      name: 'Black Rock Desert',
      latitude: 40.87,
      longitude: -119.06,
      elevation: 1190,
      state: 'NV'
    },
    mojave: {
      name: 'Mojave Desert',
      latitude: 35.05,
      longitude: -118.15,
      elevation: 853,
      state: 'CA'
    },
    lucerne: {
      name: 'Lucerne Dry Lake',
      latitude: 34.48,
      longitude: -116.95,
      elevation: 880,
      state: 'CA'
    },
    tripoli: {
      name: 'Tripoli Central',
      latitude: 39.03,
      longitude: -95.69,
      elevation: 285,
      state: 'KS'
    },
    whitakers: {
      name: 'Whitakers',
      latitude: 36.10,
      longitude: -77.72,
      elevation: 30,
      state: 'NC'
    }
  };

  /**
   * Get weather for a preset launch site
   */
  async getPresetSiteWeather(siteKey) {
    const site = WeatherAPI.LAUNCH_SITES[siteKey];
    if (!site) {
      throw new Error(`Unknown launch site: ${siteKey}`);
    }
    
    const weather = await this.getLaunchSiteWeather(site.latitude, site.longitude);
    weather.location.name = site.name;
    weather.location.state = site.state;
    return weather;
  }

  // ============================================
  // Cache Management
  // ============================================

  clearCache() {
    this.cache.clear();
  }

  getCacheStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }
}

// ============================================
// Weather Display Component
// ============================================

class WeatherDisplay {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.api = new WeatherAPI(options);
    this.currentData = null;
    this.onUpdate = options.onUpdate || (() => {});
  }

  async loadWeather(latitude, longitude) {
    this.showLoading();
    
    try {
      this.currentData = await this.api.getLaunchSiteWeather(latitude, longitude);
      this.render();
      this.onUpdate(this.currentData);
      return this.currentData;
    } catch (error) {
      this.showError(error.message);
      throw error;
    }
  }

  async loadPresetSite(siteKey) {
    const site = WeatherAPI.LAUNCH_SITES[siteKey];
    if (site) {
      return this.loadWeather(site.latitude, site.longitude);
    }
  }

  showLoading() {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="weather-loading">
        <span class="loading-spinner">🌀</span>
        <span>Loading weather data...</span>
      </div>
    `;
  }

  showError(message) {
    if (!this.container) return;
    this.container.innerHTML = `
      <div class="weather-error">
        <span class="error-icon">⚠️</span>
        <span>${message}</span>
        <button onclick="this.parentElement.parentElement.querySelector('.weather-retry')?.click()">Retry</button>
      </div>
    `;
  }

  render() {
    if (!this.container || !this.currentData) return;

    const data = this.currentData;
    const current = data.current;
    const score = data.safetyScore;

    const scoreClass = score >= 70 ? 'good' : score >= 40 ? 'moderate' : 'poor';
    const windArrow = this.getWindArrow(current.windDirection);

    this.container.innerHTML = `
      <div class="weather-display">
        <div class="weather-header">
          <h3>🌤️ Launch Weather</h3>
          <div class="safety-score ${scoreClass}">
            <span class="score-value">${score}</span>
            <span class="score-label">Safety</span>
          </div>
        </div>
        
        <div class="weather-current">
          <div class="weather-main">
            <span class="temperature">${current.temperature.toFixed(1)}°C</span>
            <span class="conditions">${current.conditions}</span>
          </div>
          
          <div class="weather-grid">
            <div class="weather-item">
              <span class="label">Wind</span>
              <span class="value">${windArrow} ${current.windSpeed.toFixed(1)} m/s</span>
              <span class="detail">from ${current.windDirection.toFixed(0)}°</span>
            </div>
            <div class="weather-item">
              <span class="label">Gusts</span>
              <span class="value">${current.windGusts.toFixed(1)} m/s</span>
            </div>
            <div class="weather-item">
              <span class="label">Pressure</span>
              <span class="value">${current.pressure.toFixed(0)} hPa</span>
            </div>
            <div class="weather-item">
              <span class="label">Humidity</span>
              <span class="value">${current.humidity}%</span>
            </div>
            <div class="weather-item">
              <span class="label">Clouds</span>
              <span class="value">${current.cloudCover}%</span>
            </div>
            <div class="weather-item">
              <span class="label">Elevation</span>
              <span class="value">${current.elevation} m</span>
            </div>
          </div>
        </div>

        <div class="weather-recommendations">
          <h4>Recommendations</h4>
          <ul>
            ${data.recommendations.map(r => `
              <li class="rec-${r.type}">
                <span class="rec-icon">${r.icon}</span>
                <span class="rec-message">${r.message}</span>
              </li>
            `).join('')}
          </ul>
        </div>

        <div class="wind-profile">
          <h4>Wind Profile</h4>
          <div class="wind-layers">
            ${data.windProfile.slice().reverse().map(layer => `
              <div class="wind-layer">
                <span class="alt">${layer.altitude}m</span>
                <div class="wind-bar" style="width: ${Math.min(layer.speed * 5, 100)}%"></div>
                <span class="speed">${layer.speed.toFixed(1)} m/s</span>
                <span class="dir">${this.getWindArrow(layer.direction)}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="weather-footer">
          <span class="update-time">Updated: ${current.time.toLocaleTimeString()}</span>
          <button class="refresh-btn" onclick="window.weatherDisplay?.loadWeather(${data.location.latitude}, ${data.location.longitude})">
            🔄 Refresh
          </button>
        </div>
      </div>
    `;
  }

  getWindArrow(direction) {
    const arrows = ['↓', '↙', '←', '↖', '↑', '↗', '→', '↘'];
    const index = Math.round(direction / 45) % 8;
    return arrows[index];
  }

  getSimulationConfig() {
    if (!this.currentData) return null;
    return this.api.toSimulationConfig(this.currentData);
  }
}

// ============================================
// Export
// ============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WeatherAPI,
    WeatherDisplay,
    WEATHER_CODES
  };
}

if (typeof window !== 'undefined') {
  window.WeatherAPI = WeatherAPI;
  window.WeatherDisplay = WeatherDisplay;
  window.WEATHER_CODES = WEATHER_CODES;
}

export { WeatherAPI, WeatherDisplay, WEATHER_CODES };

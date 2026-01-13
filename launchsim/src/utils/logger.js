/**
 * LAUNCHSIM Logger Utility
 * ========================
 * 
 * Centralized logging with DEBUG flag control.
 * Set window.LAUNCHSIM_DEBUG = true to enable debug output.
 * 
 * Logging Levels:
 * - debug: Only shown when DEBUG is enabled
 * - info:  Only shown when DEBUG is enabled  
 * - warn:  Always shown (indicates potential issues)
 * - error: Always shown (indicates failures)
 */

// Check for debug mode
const isDebugMode = () => {
  // Browser environment
  if (typeof window !== 'undefined') {
    return window.LAUNCHSIM_DEBUG === true;
  }
  // Node.js environment
  if (typeof process !== 'undefined' && process.env) {
    return process.env.LAUNCHSIM_DEBUG === 'true' || process.env.NODE_ENV === 'development';
  }
  return false;
};

/**
 * Logger with conditional output based on DEBUG flag
 */
const Logger = {
  /**
   * Debug level - only shows when DEBUG enabled
   */
  debug(...args) {
    if (isDebugMode()) {
      console.log('[LAUNCHSIM]', ...args);
    }
  },

  /**
   * Info level - only shows when DEBUG enabled
   */
  info(...args) {
    if (isDebugMode()) {
      console.log('[LAUNCHSIM]', ...args);
    }
  },

  /**
   * Warning level - always shown
   */
  warn(...args) {
    console.warn('[LAUNCHSIM]', ...args);
  },

  /**
   * Error level - always shown
   */
  error(...args) {
    console.error('[LAUNCHSIM]', ...args);
  },

  /**
   * Enable debug mode
   */
  enableDebug() {
    if (typeof window !== 'undefined') {
      window.LAUNCHSIM_DEBUG = true;
    }
    if (typeof process !== 'undefined' && process.env) {
      process.env.LAUNCHSIM_DEBUG = 'true';
    }
    console.log('[LAUNCHSIM] Debug mode enabled');
  },

  /**
   * Disable debug mode
   */
  disableDebug() {
    if (typeof window !== 'undefined') {
      window.LAUNCHSIM_DEBUG = false;
    }
    if (typeof process !== 'undefined' && process.env) {
      process.env.LAUNCHSIM_DEBUG = 'false';
    }
  },

  /**
   * Check if debug mode is enabled
   */
  isDebug() {
    return isDebugMode();
  }
};

// Export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Logger, isDebugMode };
}

if (typeof window !== 'undefined') {
  window.LaunchSimLogger = Logger;
}

export { Logger, isDebugMode };

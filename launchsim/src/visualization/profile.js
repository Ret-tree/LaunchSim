/**
 * LAUNCHSIM Visual Rocket Profile
 * ================================
 * 
 * Renders a 2D side-view profile of the rocket with CP/CG markers.
 * Provides visual feedback for stability analysis.
 * 
 * Features:
 * - Accurate proportional rendering
 * - Nose cone shape visualization
 * - Body tube and transitions
 * - Fin profile with sweep
 * - Motor mount indication
 * - CP and CG markers with labels
 * - Stability margin visualization
 * - Color-coded status
 * 
 * Usage:
 *   const profile = new RocketProfileRenderer('canvas-id');
 *   profile.render(rocketConfig, stabilityResults);
 */

// Debug mode
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[Profile]', ...args),
  warn: (...args) => console.warn('[Profile]', ...args),
  error: (...args) => console.error('[Profile]', ...args)
};

// ============================================
// Color Themes
// ============================================

const THEMES = {
  default: {
    background: '#f8f9fa',
    body: '#4a90a4',
    bodyStroke: '#2d5a6b',
    nose: '#5ba4b8',
    noseStroke: '#2d5a6b',
    fins: '#3d7a8c',
    finStroke: '#2d5a6b',
    motor: '#666',
    motorStroke: '#333',
    cgMarker: '#e53935',
    cgLabel: '#c62828',
    cpMarker: '#1e88e5',
    cpLabel: '#1565c0',
    marginLine: '#9e9e9e',
    text: '#333',
    grid: '#e0e0e0',
    safe: '#4caf50',
    warning: '#ff9800',
    danger: '#f44336'
  },
  blueprint: {
    background: '#1a237e',
    body: '#42a5f5',
    bodyStroke: '#90caf9',
    nose: '#42a5f5',
    noseStroke: '#90caf9',
    fins: '#42a5f5',
    finStroke: '#90caf9',
    motor: '#78909c',
    motorStroke: '#90caf9',
    cgMarker: '#ff5252',
    cgLabel: '#ff8a80',
    cpMarker: '#69f0ae',
    cpLabel: '#b9f6ca',
    marginLine: '#90caf9',
    text: '#e3f2fd',
    grid: '#283593',
    safe: '#69f0ae',
    warning: '#ffd740',
    danger: '#ff5252'
  }
};

// ============================================
// Nose Cone Shape Functions
// ============================================

const NoseShapes = {
  /**
   * Generate points for a conical nose cone
   */
  conical(length, radius, numPoints = 20) {
    const points = [];
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const x = t * length;
      const y = t * radius;
      points.push({ x, y });
    }
    return points;
  },
  
  /**
   * Generate points for an ogive nose cone
   */
  ogive(length, radius, numPoints = 30) {
    const points = [];
    // Tangent ogive: circular arc tangent to body
    const rho = (radius * radius + length * length) / (2 * radius);
    
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const x = t * length;
      const y = Math.sqrt(rho * rho - Math.pow(length - x, 2)) - (rho - radius);
      points.push({ x, y: Math.max(0, y) });
    }
    return points;
  },
  
  /**
   * Generate points for an elliptical nose cone
   */
  elliptical(length, radius, numPoints = 30) {
    const points = [];
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const x = t * length;
      // Ellipse equation: y = radius * sqrt(1 - (x/length - 1)²)
      const y = radius * Math.sqrt(1 - Math.pow(x / length - 1, 2));
      points.push({ x, y });
    }
    return points;
  },
  
  /**
   * Generate points for a Von Karman (Haack series) nose cone
   */
  vonKarman(length, radius, numPoints = 30) {
    const points = [];
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const x = t * length;
      // Von Karman: theta = acos(1 - 2*x/L)
      // y = R * sqrt(theta - sin(2*theta)/2) / sqrt(pi)
      const theta = Math.acos(1 - 2 * x / length);
      const y = (radius / Math.sqrt(Math.PI)) * Math.sqrt(theta - Math.sin(2 * theta) / 2);
      points.push({ x, y: isNaN(y) ? 0 : y });
    }
    return points;
  },
  
  /**
   * Generate points for a parabolic nose cone
   */
  parabolic(length, radius, numPoints = 30) {
    const points = [];
    for (let i = 0; i <= numPoints; i++) {
      const t = i / numPoints;
      const x = t * length;
      // Parabolic: y = R * sqrt(x/L)
      const y = radius * Math.sqrt(x / length);
      points.push({ x, y });
    }
    return points;
  },
  
  /**
   * Get shape generator function by name
   */
  get(shapeName) {
    const shapes = {
      'conical': this.conical,
      'cone': this.conical,
      'ogive': this.ogive,
      'tangent_ogive': this.ogive,
      'elliptical': this.elliptical,
      'ellipsoid': this.elliptical,
      'vonkarman': this.vonKarman,
      'von_karman': this.vonKarman,
      'haack': this.vonKarman,
      'parabolic': this.parabolic
    };
    return shapes[shapeName?.toLowerCase()] || this.ogive;
  }
};

// ============================================
// Rocket Profile Renderer
// ============================================

class RocketProfileRenderer {
  /**
   * Create a rocket profile renderer
   * 
   * @param {string|HTMLCanvasElement} canvas - Canvas ID or element
   * @param {Object} [options] - Rendering options
   */
  constructor(canvas, options = {}) {
    if (typeof canvas === 'string') {
      // Handle browser and Node.js environments
      if (typeof document !== 'undefined') {
        this.canvas = document.getElementById(canvas);
      } else {
        this.canvas = null;
      }
    } else {
      this.canvas = canvas;
    }
    
    this.options = {
      theme: options.theme || 'default',
      padding: options.padding || 40,
      showGrid: options.showGrid !== false,
      showDimensions: options.showDimensions !== false,
      showMotor: options.showMotor !== false,
      markerSize: options.markerSize || 12,
      ...options
    };
    
    this.theme = THEMES[this.options.theme] || THEMES.default;
  }
  
  /**
   * Render the rocket profile
   * 
   * @param {Object} rocket - Rocket configuration
   * @param {Object} [stability] - Stability analysis results
   */
  render(rocket, stability = null) {
    if (!this.canvas) {
      log.error('Canvas not found');
      return;
    }
    
    const ctx = this.canvas.getContext('2d');
    const width = this.canvas.width;
    const height = this.canvas.height;
    const padding = this.options.padding;
    
    // Clear canvas
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, width, height);
    
    // Calculate rocket dimensions
    const rocketLength = (rocket.noseLength || 0) + (rocket.bodyLength || 0);
    const rocketRadius = (rocket.bodyDiameter || rocket.noseDiameter || 41) / 2;
    const finSpan = rocket.finSpan || 0;
    const totalHeight = rocketRadius * 2 + finSpan * 2;
    
    // Calculate scale to fit canvas
    const availableWidth = width - 2 * padding;
    const availableHeight = height - 2 * padding - 60; // Extra space for labels
    
    const scaleX = availableWidth / rocketLength;
    const scaleY = availableHeight / totalHeight;
    const scale = Math.min(scaleX, scaleY);
    
    // Center the rocket
    const offsetX = padding + (availableWidth - rocketLength * scale) / 2;
    const offsetY = padding + 30 + (availableHeight - totalHeight * scale) / 2 + finSpan * scale;
    
    // Draw grid if enabled
    if (this.options.showGrid) {
      this.drawGrid(ctx, offsetX, offsetY, rocketLength, rocketRadius, scale);
    }
    
    // Transform context for rocket drawing
    ctx.save();
    
    // Draw rocket components
    this.drawNoseCone(ctx, rocket, offsetX, offsetY, scale);
    this.drawBodyTube(ctx, rocket, offsetX, offsetY, scale);
    this.drawFins(ctx, rocket, offsetX, offsetY, scale);
    
    if (this.options.showMotor && rocket.motorDiameter) {
      this.drawMotor(ctx, rocket, offsetX, offsetY, scale);
    }
    
    ctx.restore();
    
    // Draw stability markers
    if (stability) {
      this.drawStabilityMarkers(ctx, rocket, stability, offsetX, offsetY, scale);
    }
    
    // Draw dimensions
    if (this.options.showDimensions) {
      this.drawDimensions(ctx, rocket, offsetX, offsetY, scale);
    }
    
    // Draw title/status
    if (stability) {
      this.drawStatus(ctx, stability, width);
    }
  }
  
  /**
   * Draw background grid
   */
  drawGrid(ctx, offsetX, offsetY, length, radius, scale) {
    const gridSize = 50; // mm
    const scaledGrid = gridSize * scale;
    
    ctx.strokeStyle = this.theme.grid;
    ctx.lineWidth = 0.5;
    
    // Vertical lines
    for (let x = 0; x <= length; x += gridSize) {
      const px = offsetX + x * scale;
      ctx.beginPath();
      ctx.moveTo(px, offsetY - radius * scale - 50);
      ctx.lineTo(px, offsetY + radius * scale + 50);
      ctx.stroke();
    }
    
    // Horizontal lines (center line emphasized)
    ctx.beginPath();
    ctx.moveTo(offsetX - 20, offsetY);
    ctx.lineTo(offsetX + length * scale + 20, offsetY);
    ctx.strokeStyle = this.theme.marginLine;
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  
  /**
   * Draw nose cone
   */
  drawNoseCone(ctx, rocket, offsetX, offsetY, scale) {
    if (!rocket.noseLength || !rocket.noseDiameter) return;
    
    const length = rocket.noseLength;
    const radius = rocket.noseDiameter / 2;
    const shape = rocket.noseShape || 'ogive';
    
    // Get nose profile points
    const shapeFunc = NoseShapes.get(shape);
    const points = shapeFunc(length, radius);
    
    // Draw nose cone (both sides for symmetry)
    ctx.fillStyle = this.theme.nose;
    ctx.strokeStyle = this.theme.noseStroke;
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    // Top half
    ctx.moveTo(offsetX, offsetY);
    for (const p of points) {
      ctx.lineTo(offsetX + p.x * scale, offsetY - p.y * scale);
    }
    // Bottom half (reverse)
    for (let i = points.length - 1; i >= 0; i--) {
      ctx.lineTo(offsetX + points[i].x * scale, offsetY + points[i].y * scale);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  
  /**
   * Draw body tube
   */
  drawBodyTube(ctx, rocket, offsetX, offsetY, scale) {
    if (!rocket.bodyLength || !rocket.bodyDiameter) return;
    
    const noseLength = rocket.noseLength || 0;
    const bodyLength = rocket.bodyLength;
    const radius = rocket.bodyDiameter / 2;
    
    const x = offsetX + noseLength * scale;
    const y = offsetY - radius * scale;
    const w = bodyLength * scale;
    const h = radius * 2 * scale;
    
    ctx.fillStyle = this.theme.body;
    ctx.strokeStyle = this.theme.bodyStroke;
    ctx.lineWidth = 2;
    
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
  }
  
  /**
   * Draw fins
   */
  drawFins(ctx, rocket, offsetX, offsetY, scale) {
    if (!rocket.finCount || !rocket.finRootChord || !rocket.finSpan) return;
    
    const noseLength = rocket.noseLength || 0;
    const bodyLength = rocket.bodyLength || 0;
    const bodyRadius = (rocket.bodyDiameter || 41) / 2;
    
    const rootChord = rocket.finRootChord;
    const tipChord = rocket.finTipChord || 0;
    const span = rocket.finSpan;
    const sweep = rocket.finSweep || 0;
    
    // Fin position (from nose tip)
    const finPosition = rocket.finPosition || 
      (noseLength + bodyLength - rootChord - 10);
    
    ctx.fillStyle = this.theme.fins;
    ctx.strokeStyle = this.theme.finStroke;
    ctx.lineWidth = 2;
    
    // Draw fin on both sides
    for (const side of [1, -1]) {
      ctx.beginPath();
      
      // Fin root leading edge
      const x1 = offsetX + finPosition * scale;
      const y1 = offsetY + side * bodyRadius * scale;
      
      // Fin tip leading edge
      const x2 = x1 + sweep * scale;
      const y2 = offsetY + side * (bodyRadius + span) * scale;
      
      // Fin tip trailing edge
      const x3 = x2 + tipChord * scale;
      const y3 = y2;
      
      // Fin root trailing edge
      const x4 = x1 + rootChord * scale;
      const y4 = y1;
      
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.lineTo(x4, y4);
      ctx.closePath();
      
      ctx.fill();
      ctx.stroke();
    }
  }
  
  /**
   * Draw motor mount indication
   */
  drawMotor(ctx, rocket, offsetX, offsetY, scale) {
    const noseLength = rocket.noseLength || 0;
    const bodyLength = rocket.bodyLength || 0;
    const motorDiameter = rocket.motorDiameter || 18;
    const motorLength = rocket.motorLength || 70;
    
    const motorRadius = motorDiameter / 2;
    const x = offsetX + (noseLength + bodyLength - motorLength) * scale;
    const y = offsetY - motorRadius * scale;
    const w = motorLength * scale;
    const h = motorRadius * 2 * scale;
    
    ctx.fillStyle = this.theme.motor;
    ctx.strokeStyle = this.theme.motorStroke;
    ctx.lineWidth = 1;
    
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
    
    // Nozzle
    const nozzleWidth = 8 * scale;
    const nozzleHeight = motorRadius * 1.5 * scale;
    
    ctx.beginPath();
    ctx.moveTo(x + w, y + h/2 - motorRadius * 0.6 * scale);
    ctx.lineTo(x + w + nozzleWidth, y + h/2 - nozzleHeight/2);
    ctx.lineTo(x + w + nozzleWidth, y + h/2 + nozzleHeight/2);
    ctx.lineTo(x + w, y + h/2 + motorRadius * 0.6 * scale);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  
  /**
   * Draw CP and CG markers
   */
  drawStabilityMarkers(ctx, rocket, stability, offsetX, offsetY, scale) {
    const bodyRadius = (rocket.bodyDiameter || 41) / 2;
    const markerSize = this.options.markerSize;
    
    const cg = stability.cg || stability.cgFromNose || 0;
    const cp = stability.cp || stability.cpFromNose || 0;
    
    // CG marker (red circle)
    const cgX = offsetX + cg * scale;
    const cgY = offsetY;
    
    ctx.fillStyle = this.theme.cgMarker;
    ctx.strokeStyle = this.theme.cgMarker;
    ctx.lineWidth = 2;
    
    // CG symbol (circle with cross)
    ctx.beginPath();
    ctx.arc(cgX, cgY, markerSize, 0, Math.PI * 2);
    ctx.fill();
    
    // Cross inside
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cgX - markerSize * 0.6, cgY);
    ctx.lineTo(cgX + markerSize * 0.6, cgY);
    ctx.moveTo(cgX, cgY - markerSize * 0.6);
    ctx.lineTo(cgX, cgY + markerSize * 0.6);
    ctx.stroke();
    
    // CG label
    ctx.fillStyle = this.theme.cgLabel;
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CG', cgX, cgY - markerSize - 5);
    
    // CP marker (blue diamond)
    const cpX = offsetX + cp * scale;
    const cpY = offsetY;
    
    ctx.fillStyle = this.theme.cpMarker;
    
    // Diamond shape
    ctx.beginPath();
    ctx.moveTo(cpX, cpY - markerSize);
    ctx.lineTo(cpX + markerSize * 0.7, cpY);
    ctx.lineTo(cpX, cpY + markerSize);
    ctx.lineTo(cpX - markerSize * 0.7, cpY);
    ctx.closePath();
    ctx.fill();
    
    // CP label
    ctx.fillStyle = this.theme.cpLabel;
    ctx.fillText('CP', cpX, cpY + markerSize + 15);
    
    // Draw margin line between CG and CP
    ctx.strokeStyle = this.theme.marginLine;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    
    const marginY = offsetY - bodyRadius * scale - 25;
    
    ctx.beginPath();
    ctx.moveTo(cgX, marginY);
    ctx.lineTo(cpX, marginY);
    ctx.stroke();
    
    // Arrow heads
    ctx.setLineDash([]);
    const arrowSize = 6;
    
    // Left arrow (at CG)
    ctx.beginPath();
    ctx.moveTo(cgX, marginY);
    ctx.lineTo(cgX + arrowSize, marginY - arrowSize);
    ctx.lineTo(cgX + arrowSize, marginY + arrowSize);
    ctx.closePath();
    ctx.fillStyle = this.theme.marginLine;
    ctx.fill();
    
    // Right arrow (at CP)
    ctx.beginPath();
    ctx.moveTo(cpX, marginY);
    ctx.lineTo(cpX - arrowSize, marginY - arrowSize);
    ctx.lineTo(cpX - arrowSize, marginY + arrowSize);
    ctx.closePath();
    ctx.fill();
    
    // Margin value
    const margin = stability.stabilityCalibers || 
      ((cp - cg) / (rocket.bodyDiameter || 41));
    
    ctx.fillStyle = this.theme.text;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${margin.toFixed(2)} cal`, (cgX + cpX) / 2, marginY - 8);
  }
  
  /**
   * Draw dimension annotations
   */
  drawDimensions(ctx, rocket, offsetX, offsetY, scale) {
    const bodyRadius = (rocket.bodyDiameter || 41) / 2;
    const totalLength = (rocket.noseLength || 0) + (rocket.bodyLength || 0);
    
    ctx.fillStyle = this.theme.text;
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    
    // Total length
    const dimY = offsetY + bodyRadius * scale + (rocket.finSpan || 0) * scale + 30;
    
    ctx.strokeStyle = this.theme.text;
    ctx.lineWidth = 1;
    
    // Dimension line
    ctx.beginPath();
    ctx.moveTo(offsetX, dimY);
    ctx.lineTo(offsetX + totalLength * scale, dimY);
    ctx.stroke();
    
    // End ticks
    ctx.beginPath();
    ctx.moveTo(offsetX, dimY - 5);
    ctx.lineTo(offsetX, dimY + 5);
    ctx.moveTo(offsetX + totalLength * scale, dimY - 5);
    ctx.lineTo(offsetX + totalLength * scale, dimY + 5);
    ctx.stroke();
    
    // Dimension text
    ctx.fillText(`${totalLength.toFixed(0)} mm`, offsetX + totalLength * scale / 2, dimY + 15);
    
    // Body diameter
    if (rocket.bodyDiameter) {
      const diamX = offsetX + (rocket.noseLength || 0) * scale + 20;
      ctx.textAlign = 'left';
      ctx.fillText(`⌀${rocket.bodyDiameter.toFixed(0)}mm`, diamX, offsetY - bodyRadius * scale - 5);
    }
  }
  
  /**
   * Draw status bar at top
   */
  drawStatus(ctx, stability, canvasWidth) {
    const status = stability.status || 'UNKNOWN';
    const calibers = stability.stabilityCalibers || 0;
    const severity = stability.severity || 'safe';
    
    // Status background
    const statusColors = {
      safe: this.theme.safe,
      caution: this.theme.warning,
      warning: this.theme.warning,
      danger: this.theme.danger
    };
    
    ctx.fillStyle = statusColors[severity] || this.theme.safe;
    ctx.fillRect(0, 0, canvasWidth, 25);
    
    // Status text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${status} - ${calibers.toFixed(2)} calibers`, canvasWidth / 2, 17);
  }
  
  /**
   * Set rendering theme
   */
  setTheme(themeName) {
    this.theme = THEMES[themeName] || THEMES.default;
    this.options.theme = themeName;
  }
  
  /**
   * Clear the canvas
   */
  clear() {
    if (!this.canvas) return;
    const ctx = this.canvas.getContext('2d');
    ctx.fillStyle = this.theme.background;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }
}

// ============================================
// Rocket Profile Component (with Stability Integration)
// ============================================

class RocketProfileComponent {
  /**
   * Create a complete rocket profile component with canvas and analysis
   * 
   * @param {string} containerId - Container element ID
   * @param {Object} [options] - Component options
   */
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.container = null;
    this.canvas = null;
    this.renderer = null;
    this.rocket = null;
    this.stability = null;
    this.options = {
      width: options.width || 600,
      height: options.height || 300,
      ...options
    };
  }
  
  /**
   * Initialize the component
   */
  initialize() {
    // Handle browser vs Node.js environments
    if (typeof document === 'undefined') {
      log.warn('Document not available (Node.js environment)');
      return;
    }
    
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      log.error(`Container ${this.containerId} not found`);
      return;
    }
    
    this.render();
    this.renderer = new RocketProfileRenderer(this.canvas, this.options);
  }
  
  /**
   * Render component HTML
   */
  render() {
    this.container.innerHTML = `
      <div class="rocket-profile-component">
        <canvas id="${this.containerId}-canvas" 
                width="${this.options.width}" 
                height="${this.options.height}">
        </canvas>
      </div>
    `;
    
    this.canvas = this.container.querySelector(`#${this.containerId}-canvas`);
  }
  
  /**
   * Update the rocket display
   * 
   * @param {Object} rocket - Rocket configuration
   * @param {Object} [stability] - Stability analysis results
   */
  update(rocket, stability = null) {
    this.rocket = rocket;
    this.stability = stability;
    
    if (this.renderer && rocket) {
      this.renderer.render(rocket, stability);
    } else if (this.renderer) {
      this.renderer.clear();
    }
  }
  
  /**
   * Set canvas size
   */
  setSize(width, height) {
    if (this.canvas) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.options.width = width;
      this.options.height = height;
      
      if (this.rocket) {
        this.update(this.rocket, this.stability);
      }
    }
  }
  
  /**
   * Export canvas as image
   */
  toDataURL(format = 'image/png') {
    return this.canvas?.toDataURL(format);
  }
}

// ============================================
// Exports
// ============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    RocketProfileRenderer,
    RocketProfileComponent,
    NoseShapes,
    THEMES
  };
}

if (typeof window !== 'undefined') {
  window.RocketProfileRenderer = RocketProfileRenderer;
  window.RocketProfileComponent = RocketProfileComponent;
  window.NoseShapes = NoseShapes;
  window.PROFILE_THEMES = THEMES;
}

export { 
  RocketProfileRenderer, 
  RocketProfileComponent,
  NoseShapes,
  THEMES
};

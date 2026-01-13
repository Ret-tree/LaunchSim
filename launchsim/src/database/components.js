/**
 * LAUNCHSIM Component Database
 * ============================
 * 
 * Pre-built database of rocket components from major manufacturers.
 * Allows quick selection of real parts with accurate specifications.
 * 
 * Supported component types:
 * - Body tubes (LOC, Aerotech, Estes, Public Missiles, Madcow)
 * - Nose cones (various shapes and materials)
 * - Fin sets (pre-cut and custom)
 * - Parachutes (Fruity Chutes, Top Flight, Rocketman, SkyAngle)
 * - Motor mounts and retention
 * - Couplers and bulkheads
 * - Recovery hardware
 * 
 * Usage:
 *   const db = new ComponentDatabase();
 *   const tubes = db.getBodyTubes({ diameter: 54 });
 *   const chutes = db.getParachutes({ minDiameter: 36 });
 */

// Debug mode
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[ComponentDB]', ...args),
  warn: (...args) => console.warn('[ComponentDB]', ...args),
  error: (...args) => console.error('[ComponentDB]', ...args)
};

// ============================================
// Constants
// ============================================

const INCH_TO_MM = 25.4;
const MM_TO_INCH = 1 / 25.4;
const OZ_TO_G = 28.3495;
const G_TO_OZ = 1 / 28.3495;

const MANUFACTURERS = {
  LOC: 'LOC Precision',
  AEROTECH: 'Aerotech',
  ESTES: 'Estes',
  PUBLIC_MISSILES: 'Public Missiles Ltd',
  MADCOW: 'Madcow Rocketry',
  APOGEE: 'Apogee Components',
  GIANT_LEAP: 'Giant Leap Rocketry',
  FRUITY_CHUTES: 'Fruity Chutes',
  TOP_FLIGHT: 'Top Flight Recovery',
  ROCKETMAN: 'Rocketman Enterprises',
  SKYANGLE: 'SkyAngle',
  ALWAYS_READY: 'Always Ready Rocketry',
  WILDMAN: 'Wildman Rocketry',
  BINDER: 'Binder Design'
};

const COMPONENT_TYPES = {
  BODY_TUBE: 'body_tube',
  NOSE_CONE: 'nose_cone',
  FIN_SET: 'fin_set',
  PARACHUTE: 'parachute',
  MOTOR_MOUNT: 'motor_mount',
  COUPLER: 'coupler',
  BULKHEAD: 'bulkhead',
  CENTERING_RING: 'centering_ring',
  LAUNCH_LUG: 'launch_lug',
  RAIL_BUTTON: 'rail_button',
  SHOCK_CORD: 'shock_cord',
  RECOVERY_HARNESS: 'recovery_harness'
};

const MATERIALS = {
  KRAFT_PAPER: 'kraft_paper',
  PHENOLIC: 'phenolic',
  FIBERGLASS: 'fiberglass',
  CARBON_FIBER: 'carbon_fiber',
  BLUE_TUBE: 'blue_tube',
  QUANTUM_TUBE: 'quantum_tube',
  PLASTIC: 'plastic',
  BALSA: 'balsa',
  PLYWOOD: 'plywood',
  G10: 'g10_fiberglass',
  ALUMINUM: 'aluminum',
  NYLON: 'nylon',
  RIPSTOP: 'ripstop_nylon'
};

// Material densities (g/mm³)
const MATERIAL_DENSITIES = {
  [MATERIALS.KRAFT_PAPER]: 0.00065,
  [MATERIALS.PHENOLIC]: 0.00135,
  [MATERIALS.FIBERGLASS]: 0.0018,
  [MATERIALS.CARBON_FIBER]: 0.0016,
  [MATERIALS.BLUE_TUBE]: 0.00072,
  [MATERIALS.QUANTUM_TUBE]: 0.00085,
  [MATERIALS.PLASTIC]: 0.00105,
  [MATERIALS.BALSA]: 0.00016,
  [MATERIALS.PLYWOOD]: 0.00065,
  [MATERIALS.G10]: 0.0019,
  [MATERIALS.ALUMINUM]: 0.0027,
  [MATERIALS.NYLON]: 0.00114
};

// ============================================
// Component Classes
// ============================================

class Component {
  constructor(data) {
    this.id = data.id || this.generateId();
    this.type = data.type;
    this.name = data.name;
    this.manufacturer = data.manufacturer;
    this.partNumber = data.partNumber || '';
    this.material = data.material;
    this.mass = data.mass; // grams
    this.description = data.description || '';
    this.url = data.url || '';
    this.price = data.price || null;
  }
  
  generateId() {
    return `comp_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  }
  
  toJSON() {
    return { ...this };
  }
}

class BodyTube extends Component {
  constructor(data) {
    super({ ...data, type: COMPONENT_TYPES.BODY_TUBE });
    
    this.outerDiameter = data.outerDiameter; // mm
    this.innerDiameter = data.innerDiameter; // mm
    this.length = data.length; // mm
    this.wallThickness = data.wallThickness || (this.outerDiameter - this.innerDiameter) / 2;
    
    // Calculate mass if not provided
    if (!this.mass && this.material) {
      this.mass = this.calculateMass();
    }
  }
  
  calculateMass() {
    const density = MATERIAL_DENSITIES[this.material] || 0.001;
    const outerArea = Math.PI * Math.pow(this.outerDiameter / 2, 2);
    const innerArea = Math.PI * Math.pow(this.innerDiameter / 2, 2);
    const volume = (outerArea - innerArea) * this.length;
    return volume * density;
  }
  
  // Get compatible motor mount diameters
  getCompatibleMotorMounts() {
    const id = this.innerDiameter;
    const mounts = [];
    
    if (id >= 20) mounts.push(18);
    if (id >= 26) mounts.push(24);
    if (id >= 32) mounts.push(29);
    if (id >= 40) mounts.push(38);
    if (id >= 56) mounts.push(54);
    if (id >= 77) mounts.push(75);
    if (id >= 100) mounts.push(98);
    
    return mounts;
  }
}

class NoseCone extends Component {
  constructor(data) {
    super({ ...data, type: COMPONENT_TYPES.NOSE_CONE });
    
    this.shape = data.shape || 'ogive'; // ogive, conical, elliptical, vonKarman
    this.length = data.length; // mm
    this.diameter = data.diameter; // mm (base diameter)
    this.shoulderLength = data.shoulderLength || 0; // mm
    this.shoulderDiameter = data.shoulderDiameter || this.diameter - 2;
    this.hollow = data.hollow !== false;
    this.wallThickness = data.wallThickness || 2; // mm
  }
  
  // Match to body tube
  fitsBodyTube(tube) {
    return Math.abs(this.shoulderDiameter - tube.innerDiameter) < 1;
  }
}

class FinSet extends Component {
  constructor(data) {
    super({ ...data, type: COMPONENT_TYPES.FIN_SET });
    
    this.count = data.count || 3;
    this.rootChord = data.rootChord; // mm
    this.tipChord = data.tipChord; // mm
    this.span = data.span; // mm (semi-span from body)
    this.sweepDistance = data.sweepDistance || 0; // mm
    this.thickness = data.thickness; // mm
    
    // For TTW (through-the-wall) fins
    this.ttw = data.ttw || false;
    this.ttwDepth = data.ttwDepth || 0;
    
    // Body tube compatibility
    this.forBodyDiameter = data.forBodyDiameter; // mm
  }
  
  getArea() {
    // Trapezoidal fin area (one fin)
    return (this.rootChord + this.tipChord) * this.span / 2;
  }
  
  getAspectRatio() {
    return (2 * this.span) / (this.rootChord + this.tipChord);
  }
}

class Parachute extends Component {
  constructor(data) {
    super({ ...data, type: COMPONENT_TYPES.PARACHUTE });
    
    this.diameter = data.diameter; // mm (or inches converted)
    this.type = data.parachuteType || 'round'; // round, cruciform, elliptical, toroidal
    this.cd = data.cd || this.getDefaultCd();
    this.spillHole = data.spillHole || false;
    this.spillHoleDiameter = data.spillHoleDiameter || 0;
    
    // Lines
    this.lineCount = data.lineCount || 8;
    this.lineLength = data.lineLength || this.diameter * 1.5;
    this.lineMaterial = data.lineMaterial || 'nylon';
    
    // Ratings
    this.maxLoadLb = data.maxLoadLb || null;
    this.maxLoadKg = data.maxLoadKg || (data.maxLoadLb ? data.maxLoadLb * 0.453592 : null);
    
    // Packing
    this.packedDiameter = data.packedDiameter || null;
    this.packedLength = data.packedLength || null;
  }
  
  getDefaultCd() {
    const cdValues = {
      'round': 0.75,
      'cruciform': 0.60,
      'elliptical': 0.85,
      'toroidal': 0.90,
      'hemisphere': 0.62
    };
    return cdValues[this.type] || 0.75;
  }
  
  /**
   * Calculate descent rate for given mass
   */
  getDescentRate(massKg) {
    const area = Math.PI * Math.pow(this.diameter / 2 / 1000, 2); // m²
    const rho = 1.225; // kg/m³ sea level
    const g = 9.81;
    
    return Math.sqrt((2 * massKg * g) / (rho * this.cd * area));
  }
  
  /**
   * Check if parachute is suitable for rocket mass
   */
  isSuitableFor(massGrams, maxDescentFps = 20) {
    const massKg = massGrams / 1000;
    const descentMps = this.getDescentRate(massKg);
    const descentFps = descentMps * 3.28084;
    
    return {
      suitable: descentFps <= maxDescentFps,
      descentRateMps: descentMps,
      descentRateFps: descentFps,
      withinLoadLimit: !this.maxLoadKg || massKg <= this.maxLoadKg
    };
  }
}

class MotorMount extends Component {
  constructor(data) {
    super({ ...data, type: COMPONENT_TYPES.MOTOR_MOUNT });
    
    this.motorDiameter = data.motorDiameter; // mm (18, 24, 29, 38, 54, 75, 98)
    this.length = data.length; // mm
    this.forBodyDiameter = data.forBodyDiameter; // mm
    
    // Retention type
    this.retentionType = data.retentionType || 'friction'; // friction, clip, screw
    this.hasRetainer = data.hasRetainer || false;
  }
}

// ============================================
// Component Database
// ============================================

class ComponentDatabase {
  constructor() {
    this.components = {
      bodyTubes: [],
      noseCones: [],
      finSets: [],
      parachutes: [],
      motorMounts: [],
      couplers: [],
      misc: []
    };
    
    // Load built-in components
    this.loadBuiltInComponents();
  }
  
  /**
   * Load built-in component database
   */
  loadBuiltInComponents() {
    this.loadBodyTubes();
    this.loadNoseCones();
    this.loadFinSets();
    this.loadParachutes();
    this.loadMotorMounts();
  }
  
  // ==========================================
  // Body Tubes Database
  // ==========================================
  
  loadBodyTubes() {
    // LOC Precision tubes
    const locTubes = [
      { name: 'LOC 2.14" Tube', od: 54.4, id: 52.4, manufacturer: MANUFACTURERS.LOC, material: MATERIALS.KRAFT_PAPER },
      { name: 'LOC 2.56" Tube', od: 65.0, id: 63.0, manufacturer: MANUFACTURERS.LOC, material: MATERIALS.KRAFT_PAPER },
      { name: 'LOC 3.00" Tube', od: 76.2, id: 74.2, manufacturer: MANUFACTURERS.LOC, material: MATERIALS.KRAFT_PAPER },
      { name: 'LOC 3.90" Tube', od: 99.0, id: 97.0, manufacturer: MANUFACTURERS.LOC, material: MATERIALS.KRAFT_PAPER },
      { name: 'LOC 5.38" Tube', od: 136.6, id: 134.6, manufacturer: MANUFACTURERS.LOC, material: MATERIALS.KRAFT_PAPER },
      { name: 'LOC 7.51" Tube', od: 190.8, id: 188.8, manufacturer: MANUFACTURERS.LOC, material: MATERIALS.KRAFT_PAPER }
    ];
    
    // Aerotech tubes
    const aerotechTubes = [
      { name: 'Aerotech 29mm Tube', od: 32.0, id: 29.0, manufacturer: MANUFACTURERS.AEROTECH, material: MATERIALS.PHENOLIC },
      { name: 'Aerotech 38mm Tube', od: 41.0, id: 38.0, manufacturer: MANUFACTURERS.AEROTECH, material: MATERIALS.PHENOLIC },
      { name: 'Aerotech 54mm Tube', od: 57.0, id: 54.0, manufacturer: MANUFACTURERS.AEROTECH, material: MATERIALS.PHENOLIC },
      { name: 'Aerotech 75mm Tube', od: 78.0, id: 75.0, manufacturer: MANUFACTURERS.AEROTECH, material: MATERIALS.PHENOLIC },
      { name: 'Aerotech 98mm Tube', od: 101.0, id: 98.0, manufacturer: MANUFACTURERS.AEROTECH, material: MATERIALS.PHENOLIC }
    ];
    
    // Estes tubes (BT series)
    const estesTubes = [
      { name: 'Estes BT-5', od: 13.8, id: 13.0, manufacturer: MANUFACTURERS.ESTES, material: MATERIALS.KRAFT_PAPER },
      { name: 'Estes BT-20', od: 18.7, id: 18.0, manufacturer: MANUFACTURERS.ESTES, material: MATERIALS.KRAFT_PAPER },
      { name: 'Estes BT-50', od: 24.8, id: 24.1, manufacturer: MANUFACTURERS.ESTES, material: MATERIALS.KRAFT_PAPER },
      { name: 'Estes BT-55', od: 33.7, id: 32.6, manufacturer: MANUFACTURERS.ESTES, material: MATERIALS.KRAFT_PAPER },
      { name: 'Estes BT-60', od: 41.4, id: 40.5, manufacturer: MANUFACTURERS.ESTES, material: MATERIALS.KRAFT_PAPER },
      { name: 'Estes BT-70', od: 56.4, id: 55.2, manufacturer: MANUFACTURERS.ESTES, material: MATERIALS.KRAFT_PAPER },
      { name: 'Estes BT-80', od: 66.0, id: 65.0, manufacturer: MANUFACTURERS.ESTES, material: MATERIALS.KRAFT_PAPER }
    ];
    
    // Blue Tube (Always Ready Rocketry)
    const blueTubes = [
      { name: 'Blue Tube 2.0 29mm', od: 32.0, id: 29.2, manufacturer: MANUFACTURERS.ALWAYS_READY, material: MATERIALS.BLUE_TUBE },
      { name: 'Blue Tube 2.0 38mm', od: 41.1, id: 38.4, manufacturer: MANUFACTURERS.ALWAYS_READY, material: MATERIALS.BLUE_TUBE },
      { name: 'Blue Tube 2.0 54mm', od: 57.4, id: 54.5, manufacturer: MANUFACTURERS.ALWAYS_READY, material: MATERIALS.BLUE_TUBE },
      { name: 'Blue Tube 2.0 75mm', od: 78.5, id: 75.4, manufacturer: MANUFACTURERS.ALWAYS_READY, material: MATERIALS.BLUE_TUBE },
      { name: 'Blue Tube 2.0 98mm', od: 101.6, id: 98.4, manufacturer: MANUFACTURERS.ALWAYS_READY, material: MATERIALS.BLUE_TUBE }
    ];
    
    // Add standard lengths
    const standardLengths = [152.4, 304.8, 457.2, 609.6, 914.4]; // 6", 12", 18", 24", 36"
    
    [...locTubes, ...aerotechTubes, ...estesTubes, ...blueTubes].forEach(tube => {
      standardLengths.forEach(len => {
        this.components.bodyTubes.push(new BodyTube({
          name: `${tube.name} ${Math.round(len/25.4)}"`,
          outerDiameter: tube.od,
          innerDiameter: tube.id,
          length: len,
          manufacturer: tube.manufacturer,
          material: tube.material,
          partNumber: `${tube.name.replace(/\s+/g, '-')}-${Math.round(len/25.4)}`
        }));
      });
    });
  }
  
  // ==========================================
  // Nose Cones Database
  // ==========================================
  
  loadNoseCones() {
    const noseCones = [
      // LOC nose cones
      { name: 'LOC 2.14" Ogive', diameter: 54.4, length: 140, shape: 'ogive', manufacturer: MANUFACTURERS.LOC, material: MATERIALS.PLASTIC },
      { name: 'LOC 2.56" Ogive', diameter: 65.0, length: 165, shape: 'ogive', manufacturer: MANUFACTURERS.LOC, material: MATERIALS.PLASTIC },
      { name: 'LOC 3.00" Ogive', diameter: 76.2, length: 200, shape: 'ogive', manufacturer: MANUFACTURERS.LOC, material: MATERIALS.PLASTIC },
      { name: 'LOC 3.90" Ogive', diameter: 99.0, length: 260, shape: 'ogive', manufacturer: MANUFACTURERS.LOC, material: MATERIALS.PLASTIC },
      
      // Madcow fiberglass
      { name: 'Madcow 2.6" FG Ogive', diameter: 66.0, length: 178, shape: 'ogive', manufacturer: MANUFACTURERS.MADCOW, material: MATERIALS.FIBERGLASS, mass: 85 },
      { name: 'Madcow 3.0" FG Ogive', diameter: 76.2, length: 203, shape: 'ogive', manufacturer: MANUFACTURERS.MADCOW, material: MATERIALS.FIBERGLASS, mass: 120 },
      { name: 'Madcow 4.0" FG Ogive', diameter: 101.6, length: 279, shape: 'ogive', manufacturer: MANUFACTURERS.MADCOW, material: MATERIALS.FIBERGLASS, mass: 200 },
      { name: 'Madcow 5.5" FG Ogive', diameter: 139.7, length: 381, shape: 'ogive', manufacturer: MANUFACTURERS.MADCOW, material: MATERIALS.FIBERGLASS, mass: 350 },
      
      // Estes
      { name: 'Estes PNC-50', diameter: 24.8, length: 65, shape: 'ogive', manufacturer: MANUFACTURERS.ESTES, material: MATERIALS.PLASTIC, mass: 6 },
      { name: 'Estes PNC-55', diameter: 33.7, length: 85, shape: 'ogive', manufacturer: MANUFACTURERS.ESTES, material: MATERIALS.PLASTIC, mass: 10 },
      { name: 'Estes PNC-60', diameter: 41.4, length: 100, shape: 'ogive', manufacturer: MANUFACTURERS.ESTES, material: MATERIALS.PLASTIC, mass: 14 },
      
      // Giant Leap fiberglass
      { name: 'Giant Leap 2.56" Von Karman', diameter: 65.0, length: 203, shape: 'vonKarman', manufacturer: MANUFACTURERS.GIANT_LEAP, material: MATERIALS.FIBERGLASS, mass: 100 },
      { name: 'Giant Leap 3.00" Von Karman', diameter: 76.2, length: 229, shape: 'vonKarman', manufacturer: MANUFACTURERS.GIANT_LEAP, material: MATERIALS.FIBERGLASS, mass: 140 },
      { name: 'Giant Leap 3.90" Von Karman', diameter: 99.0, length: 305, shape: 'vonKarman', manufacturer: MANUFACTURERS.GIANT_LEAP, material: MATERIALS.FIBERGLASS, mass: 220 },
      { name: 'Giant Leap 5.38" Von Karman', diameter: 136.7, length: 406, shape: 'vonKarman', manufacturer: MANUFACTURERS.GIANT_LEAP, material: MATERIALS.FIBERGLASS, mass: 400 }
    ];
    
    noseCones.forEach(nc => {
      this.components.noseCones.push(new NoseCone({
        ...nc,
        shoulderLength: nc.diameter * 1.5,
        shoulderDiameter: nc.diameter - 2.5,
        wallThickness: nc.material === MATERIALS.FIBERGLASS ? 3 : 2
      }));
    });
  }
  
  // ==========================================
  // Fin Sets Database
  // ==========================================
  
  loadFinSets() {
    // Pre-cut fin sets from various manufacturers
    const finSets = [
      // LOC
      { name: 'LOC 2.14" Fins 3-pack', count: 3, rootChord: 100, tipChord: 50, span: 65, thickness: 3.2, forBodyDiameter: 54, manufacturer: MANUFACTURERS.LOC, material: MATERIALS.PLYWOOD },
      { name: 'LOC 3.00" Fins 3-pack', count: 3, rootChord: 140, tipChord: 70, span: 90, thickness: 3.2, forBodyDiameter: 76, manufacturer: MANUFACTURERS.LOC, material: MATERIALS.PLYWOOD },
      { name: 'LOC 3.90" Fins 4-pack', count: 4, rootChord: 180, tipChord: 90, span: 115, thickness: 4.8, forBodyDiameter: 99, manufacturer: MANUFACTURERS.LOC, material: MATERIALS.PLYWOOD },
      
      // Madcow G10
      { name: 'Madcow 3.0" G10 Fins', count: 3, rootChord: 140, tipChord: 60, span: 95, thickness: 2.4, forBodyDiameter: 76, manufacturer: MANUFACTURERS.MADCOW, material: MATERIALS.G10 },
      { name: 'Madcow 4.0" G10 Fins', count: 4, rootChord: 180, tipChord: 80, span: 130, thickness: 3.2, forBodyDiameter: 102, manufacturer: MANUFACTURERS.MADCOW, material: MATERIALS.G10 },
      
      // Apogee laser-cut
      { name: 'Apogee 1/8" Ply Fins 3-pack', count: 3, rootChord: 75, tipChord: 35, span: 55, thickness: 3.2, forBodyDiameter: 41, manufacturer: MANUFACTURERS.APOGEE, material: MATERIALS.PLYWOOD },
      { name: 'Apogee 3/16" Ply Fins 3-pack', count: 3, rootChord: 90, tipChord: 45, span: 70, thickness: 4.8, forBodyDiameter: 54, manufacturer: MANUFACTURERS.APOGEE, material: MATERIALS.PLYWOOD }
    ];
    
    finSets.forEach(fs => {
      this.components.finSets.push(new FinSet({
        ...fs,
        sweepDistance: fs.rootChord * 0.3,
        mass: this.calculateFinMass(fs)
      }));
    });
  }
  
  calculateFinMass(finData) {
    const density = MATERIAL_DENSITIES[finData.material] || 0.0007;
    const area = (finData.rootChord + finData.tipChord) * finData.span / 2;
    const volume = area * finData.thickness;
    return volume * density * finData.count;
  }
  
  // ==========================================
  // Parachutes Database
  // ==========================================
  
  loadParachutes() {
    // Fruity Chutes
    const fruityChutes = [
      { name: 'Fruity Chutes 12" Classic', diameter: 305, type: 'elliptical', cd: 0.85, mass: 14, maxLoadLb: 2, manufacturer: MANUFACTURERS.FRUITY_CHUTES },
      { name: 'Fruity Chutes 18" Classic', diameter: 457, type: 'elliptical', cd: 0.85, mass: 23, maxLoadLb: 5, manufacturer: MANUFACTURERS.FRUITY_CHUTES },
      { name: 'Fruity Chutes 24" Classic', diameter: 610, type: 'elliptical', cd: 0.85, mass: 34, maxLoadLb: 10, manufacturer: MANUFACTURERS.FRUITY_CHUTES },
      { name: 'Fruity Chutes 36" Classic', diameter: 914, type: 'elliptical', cd: 0.85, mass: 57, maxLoadLb: 20, manufacturer: MANUFACTURERS.FRUITY_CHUTES },
      { name: 'Fruity Chutes 48" Classic', diameter: 1219, type: 'elliptical', cd: 0.85, mass: 91, maxLoadLb: 35, manufacturer: MANUFACTURERS.FRUITY_CHUTES },
      { name: 'Fruity Chutes 60" Classic', diameter: 1524, type: 'elliptical', cd: 0.85, mass: 142, maxLoadLb: 50, manufacturer: MANUFACTURERS.FRUITY_CHUTES },
      // Iris Ultra drogues
      { name: 'Fruity Chutes 12" Iris Ultra Drogue', diameter: 305, type: 'cruciform', cd: 0.55, mass: 20, maxLoadLb: 15, manufacturer: MANUFACTURERS.FRUITY_CHUTES },
      { name: 'Fruity Chutes 18" Iris Ultra Drogue', diameter: 457, type: 'cruciform', cd: 0.55, mass: 35, maxLoadLb: 30, manufacturer: MANUFACTURERS.FRUITY_CHUTES },
      { name: 'Fruity Chutes 24" Iris Ultra Drogue', diameter: 610, type: 'cruciform', cd: 0.55, mass: 55, maxLoadLb: 50, manufacturer: MANUFACTURERS.FRUITY_CHUTES }
    ];
    
    // Top Flight Recovery
    const topFlight = [
      { name: 'Top Flight 15" Thin-Mil', diameter: 381, type: 'round', cd: 0.75, mass: 11, manufacturer: MANUFACTURERS.TOP_FLIGHT },
      { name: 'Top Flight 18" Thin-Mil', diameter: 457, type: 'round', cd: 0.75, mass: 14, manufacturer: MANUFACTURERS.TOP_FLIGHT },
      { name: 'Top Flight 24" Thin-Mil', diameter: 610, type: 'round', cd: 0.75, mass: 20, manufacturer: MANUFACTURERS.TOP_FLIGHT },
      { name: 'Top Flight 30" Thin-Mil', diameter: 762, type: 'round', cd: 0.75, mass: 28, manufacturer: MANUFACTURERS.TOP_FLIGHT },
      { name: 'Top Flight 36" Thin-Mil', diameter: 914, type: 'round', cd: 0.75, mass: 40, manufacturer: MANUFACTURERS.TOP_FLIGHT },
      { name: 'Top Flight 45" Thin-Mil', diameter: 1143, type: 'round', cd: 0.75, mass: 57, manufacturer: MANUFACTURERS.TOP_FLIGHT },
      { name: 'Top Flight 58" Thin-Mil', diameter: 1473, type: 'round', cd: 0.75, mass: 85, manufacturer: MANUFACTURERS.TOP_FLIGHT }
    ];
    
    // Rocketman
    const rocketman = [
      { name: 'Rocketman R3C', diameter: 305, type: 'round', cd: 0.78, mass: 15, maxLoadLb: 2, manufacturer: MANUFACTURERS.ROCKETMAN },
      { name: 'Rocketman R5C', diameter: 457, type: 'round', cd: 0.78, mass: 25, maxLoadLb: 5, manufacturer: MANUFACTURERS.ROCKETMAN },
      { name: 'Rocketman R7C', diameter: 610, type: 'round', cd: 0.78, mass: 40, maxLoadLb: 10, manufacturer: MANUFACTURERS.ROCKETMAN },
      { name: 'Rocketman R9C', diameter: 762, type: 'round', cd: 0.78, mass: 60, maxLoadLb: 15, manufacturer: MANUFACTURERS.ROCKETMAN },
      { name: 'Rocketman R12C', diameter: 914, type: 'round', cd: 0.78, mass: 85, maxLoadLb: 25, manufacturer: MANUFACTURERS.ROCKETMAN }
    ];
    
    // SkyAngle drogues
    const skyAngle = [
      { name: 'SkyAngle Cert-3 12"', diameter: 305, type: 'cruciform', cd: 0.60, mass: 18, maxLoadLb: 8, manufacturer: MANUFACTURERS.SKYANGLE },
      { name: 'SkyAngle Cert-3 15"', diameter: 381, type: 'cruciform', cd: 0.60, mass: 25, maxLoadLb: 12, manufacturer: MANUFACTURERS.SKYANGLE },
      { name: 'SkyAngle Cert-3 18"', diameter: 457, type: 'cruciform', cd: 0.60, mass: 35, maxLoadLb: 20, manufacturer: MANUFACTURERS.SKYANGLE },
      { name: 'SkyAngle Cert-3 24"', diameter: 610, type: 'cruciform', cd: 0.60, mass: 50, maxLoadLb: 35, manufacturer: MANUFACTURERS.SKYANGLE }
    ];
    
    [...fruityChutes, ...topFlight, ...rocketman, ...skyAngle].forEach(p => {
      this.components.parachutes.push(new Parachute({
        ...p,
        parachuteType: p.type,
        material: MATERIALS.RIPSTOP
      }));
    });
  }
  
  // ==========================================
  // Motor Mounts Database
  // ==========================================
  
  loadMotorMounts() {
    const standardDiameters = [18, 24, 29, 38, 54, 75, 98];
    const standardLengths = [76, 127, 178, 254, 381]; // 3", 5", 7", 10", 15"
    
    standardDiameters.forEach(d => {
      standardLengths.forEach(len => {
        if (d <= 29 && len > 178) return; // Skip long tubes for small motors
        if (d >= 75 && len < 178) return; // Skip short tubes for large motors
        
        this.components.motorMounts.push(new MotorMount({
          name: `${d}mm Motor Mount Tube ${Math.round(len/25.4)}"`,
          motorDiameter: d,
          length: len,
          manufacturer: 'Generic',
          material: MATERIALS.KRAFT_PAPER
        }));
      });
    });
  }
  
  // ==========================================
  // Query Methods
  // ==========================================
  
  /**
   * Get body tubes matching criteria
   */
  getBodyTubes(filter = {}) {
    let results = [...this.components.bodyTubes];
    
    if (filter.diameter) {
      results = results.filter(t => Math.abs(t.outerDiameter - filter.diameter) < 3);
    }
    if (filter.innerDiameter) {
      results = results.filter(t => Math.abs(t.innerDiameter - filter.innerDiameter) < 3);
    }
    if (filter.minLength) {
      results = results.filter(t => t.length >= filter.minLength);
    }
    if (filter.maxLength) {
      results = results.filter(t => t.length <= filter.maxLength);
    }
    if (filter.manufacturer) {
      results = results.filter(t => t.manufacturer === filter.manufacturer);
    }
    if (filter.material) {
      results = results.filter(t => t.material === filter.material);
    }
    
    return results;
  }
  
  /**
   * Get nose cones matching criteria
   */
  getNoseCones(filter = {}) {
    let results = [...this.components.noseCones];
    
    if (filter.diameter) {
      results = results.filter(nc => Math.abs(nc.diameter - filter.diameter) < 3);
    }
    if (filter.shape) {
      results = results.filter(nc => nc.shape === filter.shape);
    }
    if (filter.manufacturer) {
      results = results.filter(nc => nc.manufacturer === filter.manufacturer);
    }
    if (filter.material) {
      results = results.filter(nc => nc.material === filter.material);
    }
    
    return results;
  }
  
  /**
   * Get fin sets matching criteria
   */
  getFinSets(filter = {}) {
    let results = [...this.components.finSets];
    
    if (filter.forBodyDiameter) {
      results = results.filter(fs => Math.abs(fs.forBodyDiameter - filter.forBodyDiameter) < 5);
    }
    if (filter.count) {
      results = results.filter(fs => fs.count === filter.count);
    }
    if (filter.material) {
      results = results.filter(fs => fs.material === filter.material);
    }
    
    return results;
  }
  
  /**
   * Get parachutes matching criteria
   */
  getParachutes(filter = {}) {
    let results = [...this.components.parachutes];
    
    if (filter.minDiameter) {
      results = results.filter(p => p.diameter >= filter.minDiameter);
    }
    if (filter.maxDiameter) {
      results = results.filter(p => p.diameter <= filter.maxDiameter);
    }
    if (filter.type) {
      results = results.filter(p => p.type === filter.type);
    }
    if (filter.manufacturer) {
      results = results.filter(p => p.manufacturer === filter.manufacturer);
    }
    if (filter.forMassGrams) {
      // Filter chutes suitable for this mass
      results = results.filter(p => {
        const check = p.isSuitableFor(filter.forMassGrams, filter.maxDescentFps || 20);
        return check.suitable && check.withinLoadLimit;
      });
    }
    
    return results;
  }
  
  /**
   * Get matching components for a body tube
   */
  getMatchingComponents(bodyTube) {
    return {
      noseCones: this.getNoseCones({ diameter: bodyTube.outerDiameter }),
      finSets: this.getFinSets({ forBodyDiameter: bodyTube.outerDiameter }),
      couplers: this.components.couplers.filter(c => 
        Math.abs(c.outerDiameter - bodyTube.innerDiameter) < 2
      )
    };
  }
  
  /**
   * Recommend parachute for rocket mass
   */
  recommendParachute(massGrams, options = {}) {
    const maxDescent = options.maxDescentFps || 15;
    const suitable = this.getParachutes({
      forMassGrams: massGrams,
      maxDescentFps: maxDescent,
      type: options.type
    });
    
    if (suitable.length === 0) {
      return { found: false, message: 'No suitable parachutes in database' };
    }
    
    // Sort by descent rate closeness to target
    const target = options.targetDescentFps || 15;
    suitable.sort((a, b) => {
      const aRate = a.isSuitableFor(massGrams).descentRateFps;
      const bRate = b.isSuitableFor(massGrams).descentRateFps;
      return Math.abs(aRate - target) - Math.abs(bRate - target);
    });
    
    return {
      found: true,
      recommended: suitable[0],
      alternatives: suitable.slice(1, 4),
      descentRate: suitable[0].isSuitableFor(massGrams).descentRateFps
    };
  }
  
  /**
   * Get all manufacturers
   */
  getManufacturers() {
    return Object.values(MANUFACTURERS);
  }
  
  /**
   * Search all components
   */
  search(query) {
    const q = query.toLowerCase();
    const results = [];
    
    Object.values(this.components).flat().forEach(comp => {
      if (comp.name.toLowerCase().includes(q) ||
          comp.manufacturer?.toLowerCase().includes(q) ||
          comp.partNumber?.toLowerCase().includes(q)) {
        results.push(comp);
      }
    });
    
    return results;
  }
  
  /**
   * Add custom component
   */
  addComponent(component) {
    const type = component.type;
    const category = {
      [COMPONENT_TYPES.BODY_TUBE]: 'bodyTubes',
      [COMPONENT_TYPES.NOSE_CONE]: 'noseCones',
      [COMPONENT_TYPES.FIN_SET]: 'finSets',
      [COMPONENT_TYPES.PARACHUTE]: 'parachutes',
      [COMPONENT_TYPES.MOTOR_MOUNT]: 'motorMounts'
    }[type] || 'misc';
    
    this.components[category].push(component);
    return component;
  }
  
  /**
   * Get component counts
   */
  getCounts() {
    return {
      bodyTubes: this.components.bodyTubes.length,
      noseCones: this.components.noseCones.length,
      finSets: this.components.finSets.length,
      parachutes: this.components.parachutes.length,
      motorMounts: this.components.motorMounts.length,
      total: Object.values(this.components).reduce((sum, arr) => sum + arr.length, 0)
    };
  }
}

// ============================================
// Exports
// ============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ComponentDatabase,
    Component,
    BodyTube,
    NoseCone,
    FinSet,
    Parachute,
    MotorMount,
    MANUFACTURERS,
    COMPONENT_TYPES,
    MATERIALS,
    MATERIAL_DENSITIES
  };
}

if (typeof window !== 'undefined') {
  window.ComponentDatabase = ComponentDatabase;
  window.BodyTube = BodyTube;
  window.NoseCone = NoseCone;
  window.FinSet = FinSet;
  window.Parachute = Parachute;
  window.MotorMount = MotorMount;
  window.MANUFACTURERS = MANUFACTURERS;
  window.COMPONENT_TYPES = COMPONENT_TYPES;
  window.MATERIALS = MATERIALS;
}

export {
  ComponentDatabase,
  Component,
  BodyTube,
  NoseCone,
  FinSet,
  Parachute,
  MotorMount,
  MANUFACTURERS,
  COMPONENT_TYPES,
  MATERIALS,
  MATERIAL_DENSITIES
};

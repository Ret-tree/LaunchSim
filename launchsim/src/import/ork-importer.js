/**
 * LAUNCHSIM OpenRocket .ork File Importer
 * ========================================
 * 
 * Parses OpenRocket design files and converts them to LAUNCHSIM format.
 * 
 * .ork files are ZIP archives containing:
 * - rocket.ork (XML with rocket design)
 * - Optional: decal images, custom data
 * 
 * Supported components:
 * - NoseCone (ogive, conical, elliptical, power, parabolic, haack)
 * - BodyTube
 * - Transition (shoulder, boattail)
 * - TrapezoidFinSet, EllipticalFinSet, FreeformFinSet
 * - InnerTube (motor mount)
 * - CenteringRing, Bulkhead
 * - Parachute, Streamer, ShockCord
 * - MassComponent, MassObject
 * - LaunchLug, RailButton
 * - EngineBlock, TubeCoupler
 * 
 * Usage:
 *   const importer = new ORKImporter();
 *   const rocket = await importer.importFile(file);
 *   // or
 *   const rocket = await importer.importFromURL(url);
 */

// Debug mode - set window.LAUNCHSIM_DEBUG = true for verbose logging
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[ORKImporter]', ...args),
  warn: (...args) => console.warn('[ORKImporter]', ...args),
  error: (...args) => console.error('[ORKImporter]', ...args)
};

// ============================================
// Constants and Mappings
// ============================================

const NOSE_SHAPE_MAP = {
  'conical': 'conical',
  'ogive': 'ogive',
  'ellipsoid': 'elliptical',
  'power': 'power',
  'parabolic': 'parabolic',
  'haack': 'vonKarman',
  'vonkarman': 'vonKarman',
  'lvhaack': 'lvHaack'
};

const FIN_CROSS_SECTION_MAP = {
  'square': 'square',
  'rounded': 'rounded',
  'airfoil': 'airfoil',
  'doublewedge': 'doubleWedge'
};

const MATERIAL_DENSITY = {
  // Paper/Cardboard (kg/m³)
  'cardboard': 680,
  'paper': 820,
  'posterboard': 680,
  
  // Wood
  'balsa': 130,
  'basswood': 420,
  'birch': 680,
  'plywood': 630,
  'spruce': 450,
  
  // Plastic
  'abs': 1050,
  'acrylic': 1180,
  'delrin': 1410,
  'fiberglass': 1850,
  'hdpe': 950,
  'lexan': 1200,
  'mylar': 1390,
  'nylon': 1150,
  'pla': 1250,
  'polycarbonate': 1200,
  'polystyrene': 1050,
  'pvc': 1400,
  
  // Metal
  'aluminum': 2700,
  'brass': 8500,
  'steel': 7850,
  'titanium': 4500,
  
  // Fabric
  'ripstopnylon': 40,
  'nylonfabric': 70,
  'kevlar': 80,
  
  // Composite
  'carbonfiber': 1600,
  'fiberglass_g10': 1800,
  
  // Default
  'default': 1000
};

// ============================================
// XML Parser Utilities
// ============================================

/**
 * Minimal XML parser for Node.js environments
 * Parses XML into a DOM-like structure
 */
function parseXMLString(xml) {
  const doc = {
    documentElement: null,
    querySelector: function(selector) {
      return queryElement(this.documentElement, selector);
    },
    querySelectorAll: function(selector) {
      return queryElements(this.documentElement, selector);
    }
  };

  // Simple XML tokenizer
  const tagRegex = /<([\/]?)([a-zA-Z0-9_:-]+)([^>]*)>/g;
  const stack = [];
  let currentElement = null;
  let lastIndex = 0;
  let match;

  while ((match = tagRegex.exec(xml)) !== null) {
    const [fullMatch, isClosing, tagName, attributes] = match;
    const textBefore = xml.substring(lastIndex, match.index).trim();
    
    if (textBefore && currentElement) {
      currentElement.textContent = (currentElement.textContent || '') + textBefore;
    }

    if (isClosing) {
      // Closing tag
      if (stack.length > 0) {
        currentElement = stack.pop();
      }
    } else if (attributes.endsWith('/')) {
      // Self-closing tag
      const element = createXMLElement(tagName.toLowerCase(), attributes.slice(0, -1));
      if (currentElement) {
        currentElement.children.push(element);
        element.parentNode = currentElement;
      } else {
        doc.documentElement = element;
      }
    } else {
      // Opening tag
      const element = createXMLElement(tagName.toLowerCase(), attributes);
      
      if (currentElement) {
        currentElement.children.push(element);
        element.parentNode = currentElement;
        stack.push(currentElement);
      } else {
        doc.documentElement = element;
      }
      currentElement = element;
    }
    
    lastIndex = tagRegex.lastIndex;
  }

  return doc;
}

function createXMLElement(tagName, attributesStr) {
  const element = {
    tagName: tagName,
    children: [],
    textContent: '',
    parentNode: null,
    attributes: {},
    
    getAttribute: function(name) {
      return this.attributes[name] || null;
    },
    
    querySelector: function(selector) {
      return queryElement(this, selector);
    },
    
    querySelectorAll: function(selector) {
      return queryElements(this, selector);
    }
  };

  // Parse attributes
  const attrRegex = /([a-zA-Z0-9_:-]+)=["']([^"']*)["']/g;
  let attrMatch;
  while ((attrMatch = attrRegex.exec(attributesStr)) !== null) {
    element.attributes[attrMatch[1]] = attrMatch[2];
  }

  return element;
}

function queryElement(root, selector) {
  if (!root) return null;
  
  // Handle :scope prefix
  selector = selector.replace(':scope > ', '').replace(':scope ', '');
  
  // Simple selector support - split on spaces but handle > as separator
  const parts = selector.split(/[\s>]+/).filter(p => p);
  
  function findInTree(el, targetTag) {
    if (el.tagName === targetTag) {
      return el;
    }
    for (const child of (el.children || [])) {
      const found = findInTree(child, targetTag);
      if (found) return found;
    }
    return null;
  }
  
  // For simple single-tag selector
  if (parts.length === 1) {
    return findInTree(root, parts[0]);
  }
  
  // For nested selectors like "subcomponents > stage"
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    const found = findInTree(current, parts[i]);
    if (!found) return null;
    current = found;
  }
  
  return current;
}

function queryElements(root, selector) {
  if (!root) return [];
  
  selector = selector.replace(':scope > ', '').replace(':scope ', '');
  const results = [];
  const parts = selector.split(/[\s>]+/).filter(p => p);
  const targetTag = parts[parts.length - 1];
  
  function traverse(el, depth = 0) {
    if (el.tagName === targetTag) {
      results.push(el);
    }
    for (const child of (el.children || [])) {
      traverse(child, depth + 1);
    }
  }
  
  traverse(root);
  return results;
}

class XMLParser {
  /**
   * Parse XML string to DOM
   */
  static parse(xmlString) {
    // Use browser DOMParser if available
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlString, 'text/xml');
      
      // Check for parse errors
      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        throw new Error(`XML Parse Error: ${parseError.textContent}`);
      }
      
      return doc;
    }
    
    // Use minimal parser for Node.js
    return parseXMLString(xmlString);
  }

  /**
   * Get text content of first matching element
   * Also handles OpenRocket's 'n' shorthand for 'name'
   */
  static getText(element, selector, defaultValue = '') {
    // Handle name/n special case
    if (selector === 'name') {
      // Try 'name' first, then 'n'
      let el = element.querySelector('name');
      if (!el) el = element.querySelector('n');
      return el ? el.textContent.trim() : defaultValue;
    }
    
    const el = element.querySelector(selector);
    return el ? el.textContent.trim() : defaultValue;
  }

  /**
   * Get numeric value from element
   */
  static getNumber(element, selector, defaultValue = 0) {
    const text = this.getText(element, selector, null);
    if (text === null) return defaultValue;
    const num = parseFloat(text);
    return isNaN(num) ? defaultValue : num;
  }

  /**
   * Get boolean value from element
   */
  static getBool(element, selector, defaultValue = false) {
    const text = this.getText(element, selector, '').toLowerCase();
    if (text === 'true' || text === '1') return true;
    if (text === 'false' || text === '0') return false;
    return defaultValue;
  }

  /**
   * Get all child elements with tag name
   */
  static getChildren(element, tagName) {
    return Array.from(element.children).filter(
      child => child.tagName.toLowerCase() === tagName.toLowerCase()
    );
  }

  /**
   * Get attribute value
   */
  static getAttr(element, attrName, defaultValue = '') {
    return element.getAttribute(attrName) || defaultValue;
  }
}

// ============================================
// Component Parsers
// ============================================

class ComponentParser {
  constructor() {
    this.warnings = [];
  }

  warn(message) {
    this.warnings.push(message);
    log.warn(message);
  }

  /**
   * Parse a nose cone element
   */
  parseNoseCone(element) {
    const shapeType = XMLParser.getText(element, 'shape', 'ogive').toLowerCase();
    
    return {
      type: 'nosecone',
      name: XMLParser.getText(element, 'name', 'Nose Cone'),
      shape: NOSE_SHAPE_MAP[shapeType] || 'ogive',
      length: XMLParser.getNumber(element, 'length') * 1000, // m to mm
      diameter: XMLParser.getNumber(element, 'aftradius') * 2000, // radius m to diameter mm
      thickness: XMLParser.getNumber(element, 'thickness') * 1000,
      mass: XMLParser.getNumber(element, 'mass') * 1000, // kg to g
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      material: XMLParser.getText(element, 'material', 'plastic'),
      shoulderLength: XMLParser.getNumber(element, 'aftshoulderradius') > 0 
        ? XMLParser.getNumber(element, 'aftshoulderlength') * 1000 : 0,
      shoulderDiameter: XMLParser.getNumber(element, 'aftshoulderradius') * 2000,
      filled: XMLParser.getBool(element, 'filled'),
      shapeParameter: XMLParser.getNumber(element, 'shapeparameter', 0.5),
      finish: XMLParser.getText(element, 'finish', 'normal'),
      color: this.parseColor(element),
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'ABSOLUTE')
    };
  }

  /**
   * Parse a body tube element
   */
  parseBodyTube(element) {
    return {
      type: 'bodytube',
      name: XMLParser.getText(element, 'name', 'Body Tube'),
      length: XMLParser.getNumber(element, 'length') * 1000,
      outerDiameter: XMLParser.getNumber(element, 'radius') * 2000,
      innerDiameter: (XMLParser.getNumber(element, 'radius') - 
                      XMLParser.getNumber(element, 'thickness')) * 2000,
      thickness: XMLParser.getNumber(element, 'thickness') * 1000,
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      material: XMLParser.getText(element, 'material', 'cardboard'),
      motorMount: XMLParser.getBool(element, 'motormount'),
      finish: XMLParser.getText(element, 'finish', 'normal'),
      color: this.parseColor(element),
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'ABSOLUTE'),
      subcomponents: this.parseSubcomponents(element)
    };
  }

  /**
   * Parse a transition (boattail/shoulder) element
   */
  parseTransition(element) {
    return {
      type: 'transition',
      name: XMLParser.getText(element, 'name', 'Transition'),
      shape: XMLParser.getText(element, 'shape', 'conical').toLowerCase(),
      length: XMLParser.getNumber(element, 'length') * 1000,
      foreDiameter: XMLParser.getNumber(element, 'foreradius') * 2000,
      aftDiameter: XMLParser.getNumber(element, 'aftradius') * 2000,
      thickness: XMLParser.getNumber(element, 'thickness') * 1000,
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      material: XMLParser.getText(element, 'material', 'plastic'),
      foreShoulderLength: XMLParser.getNumber(element, 'foreshoulderlength') * 1000,
      foreShoulderDiameter: XMLParser.getNumber(element, 'foreshoulderradius') * 2000,
      aftShoulderLength: XMLParser.getNumber(element, 'aftshoulderlength') * 1000,
      aftShoulderDiameter: XMLParser.getNumber(element, 'aftshoulderradius') * 2000,
      filled: XMLParser.getBool(element, 'filled'),
      color: this.parseColor(element),
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'ABSOLUTE')
    };
  }

  /**
   * Parse a trapezoidal fin set
   */
  parseTrapezoidFinSet(element) {
    return {
      type: 'trapezoidfinset',
      name: XMLParser.getText(element, 'name', 'Fin Set'),
      finCount: XMLParser.getNumber(element, 'fincount', 3),
      rootChord: XMLParser.getNumber(element, 'rootchord') * 1000,
      tipChord: XMLParser.getNumber(element, 'tipchord') * 1000,
      span: XMLParser.getNumber(element, 'height') * 1000, // OpenRocket calls it 'height'
      sweepLength: XMLParser.getNumber(element, 'sweeplength') * 1000,
      sweepAngle: XMLParser.getNumber(element, 'sweepangle') * (180 / Math.PI), // rad to deg
      thickness: XMLParser.getNumber(element, 'thickness') * 1000,
      crossSection: FIN_CROSS_SECTION_MAP[
        XMLParser.getText(element, 'crosssection', 'square').toLowerCase()
      ] || 'square',
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      material: XMLParser.getText(element, 'material', 'balsa'),
      tabLength: XMLParser.getNumber(element, 'tablength') * 1000,
      tabHeight: XMLParser.getNumber(element, 'tabheight') * 1000,
      tabOffset: XMLParser.getNumber(element, 'taboffset') * 1000,
      cantAngle: XMLParser.getNumber(element, 'cant') * (180 / Math.PI),
      filletRadius: XMLParser.getNumber(element, 'filletradius') * 1000,
      color: this.parseColor(element),
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'BOTTOM')
    };
  }

  /**
   * Parse an elliptical fin set
   */
  parseEllipticalFinSet(element) {
    return {
      type: 'ellipticalfinset',
      name: XMLParser.getText(element, 'name', 'Elliptical Fins'),
      finCount: XMLParser.getNumber(element, 'fincount', 3),
      rootChord: XMLParser.getNumber(element, 'rootchord') * 1000,
      span: XMLParser.getNumber(element, 'height') * 1000,
      thickness: XMLParser.getNumber(element, 'thickness') * 1000,
      crossSection: FIN_CROSS_SECTION_MAP[
        XMLParser.getText(element, 'crosssection', 'square').toLowerCase()
      ] || 'square',
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      material: XMLParser.getText(element, 'material', 'balsa'),
      cantAngle: XMLParser.getNumber(element, 'cant') * (180 / Math.PI),
      color: this.parseColor(element),
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'BOTTOM')
    };
  }

  /**
   * Parse a freeform fin set
   */
  parseFreeformFinSet(element) {
    const pointsEl = element.querySelector('finpoints');
    const points = [];
    
    if (pointsEl) {
      const pointEls = pointsEl.querySelectorAll('point');
      pointEls.forEach(pt => {
        points.push({
          x: XMLParser.getNumber(pt, 'x') * 1000,
          y: XMLParser.getNumber(pt, 'y') * 1000
        });
      });
    }

    return {
      type: 'freeformfinset',
      name: XMLParser.getText(element, 'name', 'Freeform Fins'),
      finCount: XMLParser.getNumber(element, 'fincount', 3),
      points: points,
      thickness: XMLParser.getNumber(element, 'thickness') * 1000,
      crossSection: FIN_CROSS_SECTION_MAP[
        XMLParser.getText(element, 'crosssection', 'square').toLowerCase()
      ] || 'square',
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      material: XMLParser.getText(element, 'material', 'balsa'),
      cantAngle: XMLParser.getNumber(element, 'cant') * (180 / Math.PI),
      color: this.parseColor(element),
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'BOTTOM')
    };
  }

  /**
   * Parse an inner tube (motor mount)
   */
  parseInnerTube(element) {
    return {
      type: 'innertube',
      name: XMLParser.getText(element, 'name', 'Inner Tube'),
      length: XMLParser.getNumber(element, 'length') * 1000,
      outerDiameter: XMLParser.getNumber(element, 'outerradius') * 2000,
      innerDiameter: XMLParser.getNumber(element, 'innerradius') * 2000,
      thickness: XMLParser.getNumber(element, 'thickness') * 1000,
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      material: XMLParser.getText(element, 'material', 'cardboard'),
      motorMount: XMLParser.getBool(element, 'motormount'),
      motorOverhang: XMLParser.getNumber(element, 'motoroverhang') * 1000,
      clusterConfiguration: XMLParser.getText(element, 'clusterconfiguration', 'single'),
      clusterScale: XMLParser.getNumber(element, 'clusterscale', 1),
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'BOTTOM'),
      subcomponents: this.parseSubcomponents(element)
    };
  }

  /**
   * Parse a centering ring
   */
  parseCenteringRing(element) {
    return {
      type: 'centeringring',
      name: XMLParser.getText(element, 'name', 'Centering Ring'),
      length: XMLParser.getNumber(element, 'length') * 1000,
      outerDiameter: XMLParser.getNumber(element, 'outerradius') * 2000,
      innerDiameter: XMLParser.getNumber(element, 'innerradius') * 2000,
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      material: XMLParser.getText(element, 'material', 'plywood'),
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'BOTTOM')
    };
  }

  /**
   * Parse a bulkhead
   */
  parseBulkhead(element) {
    return {
      type: 'bulkhead',
      name: XMLParser.getText(element, 'name', 'Bulkhead'),
      length: XMLParser.getNumber(element, 'length') * 1000,
      outerDiameter: XMLParser.getNumber(element, 'outerradius') * 2000,
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      material: XMLParser.getText(element, 'material', 'plywood'),
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'TOP')
    };
  }

  /**
   * Parse a parachute
   */
  parseParachute(element) {
    return {
      type: 'parachute',
      name: XMLParser.getText(element, 'name', 'Parachute'),
      diameter: XMLParser.getNumber(element, 'diameter') * 1000,
      cd: XMLParser.getNumber(element, 'cd', 0.8),
      lineCount: XMLParser.getNumber(element, 'linecount', 6),
      lineLength: XMLParser.getNumber(element, 'linelength') * 1000,
      lineMaterial: XMLParser.getText(element, 'linematerial', 'nylon'),
      material: XMLParser.getText(element, 'material', 'ripstopnylon'),
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      deployEvent: XMLParser.getText(element, 'deployevent', 'apogee'),
      deployAltitude: XMLParser.getNumber(element, 'deployaltitude'),
      deployDelay: XMLParser.getNumber(element, 'deploydelay', 0),
      packedLength: XMLParser.getNumber(element, 'packedlength') * 1000,
      packedDiameter: XMLParser.getNumber(element, 'packedradius') * 2000,
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'TOP')
    };
  }

  /**
   * Parse a streamer
   */
  parseStreamer(element) {
    return {
      type: 'streamer',
      name: XMLParser.getText(element, 'name', 'Streamer'),
      length: XMLParser.getNumber(element, 'striplength') * 1000,
      width: XMLParser.getNumber(element, 'stripwidth') * 1000,
      thickness: XMLParser.getNumber(element, 'thickness') * 1000,
      cd: XMLParser.getNumber(element, 'cd', 0.6),
      material: XMLParser.getText(element, 'material', 'mylar'),
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      deployEvent: XMLParser.getText(element, 'deployevent', 'apogee'),
      deployAltitude: XMLParser.getNumber(element, 'deployaltitude'),
      deployDelay: XMLParser.getNumber(element, 'deploydelay', 0),
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'TOP')
    };
  }

  /**
   * Parse a shock cord
   */
  parseShockCord(element) {
    return {
      type: 'shockcord',
      name: XMLParser.getText(element, 'name', 'Shock Cord'),
      length: XMLParser.getNumber(element, 'cordlength') * 1000,
      material: XMLParser.getText(element, 'material', 'elastic'),
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'TOP')
    };
  }

  /**
   * Parse a launch lug
   */
  parseLaunchLug(element) {
    return {
      type: 'launchlug',
      name: XMLParser.getText(element, 'name', 'Launch Lug'),
      length: XMLParser.getNumber(element, 'length') * 1000,
      outerDiameter: XMLParser.getNumber(element, 'radius') * 2000,
      innerDiameter: (XMLParser.getNumber(element, 'radius') - 
                      XMLParser.getNumber(element, 'thickness')) * 2000,
      thickness: XMLParser.getNumber(element, 'thickness') * 1000,
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      material: XMLParser.getText(element, 'material', 'cardboard'),
      radialPosition: XMLParser.getNumber(element, 'radialposition') * (180 / Math.PI),
      instanceCount: XMLParser.getNumber(element, 'instancecount', 1),
      instanceSeparation: XMLParser.getNumber(element, 'instanceseparation') * 1000,
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'MIDDLE')
    };
  }

  /**
   * Parse rail buttons
   */
  parseRailButton(element) {
    return {
      type: 'railbutton',
      name: XMLParser.getText(element, 'name', 'Rail Button'),
      outerDiameter: XMLParser.getNumber(element, 'outerdiameter') * 1000,
      innerDiameter: XMLParser.getNumber(element, 'innerdiameter') * 1000,
      height: XMLParser.getNumber(element, 'height') * 1000,
      baseHeight: XMLParser.getNumber(element, 'baseheight') * 1000,
      flangeHeight: XMLParser.getNumber(element, 'flangeheight') * 1000,
      screwHeight: XMLParser.getNumber(element, 'screwheight') * 1000,
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      material: XMLParser.getText(element, 'material', 'delrin'),
      instanceCount: XMLParser.getNumber(element, 'instancecount', 2),
      instanceSeparation: XMLParser.getNumber(element, 'instanceseparation') * 1000,
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'MIDDLE')
    };
  }

  /**
   * Parse an engine block
   */
  parseEngineBlock(element) {
    return {
      type: 'engineblock',
      name: XMLParser.getText(element, 'name', 'Engine Block'),
      length: XMLParser.getNumber(element, 'length') * 1000,
      outerDiameter: XMLParser.getNumber(element, 'outerradius') * 2000,
      innerDiameter: XMLParser.getNumber(element, 'innerradius') * 2000,
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      material: XMLParser.getText(element, 'material', 'cardboard'),
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'BOTTOM')
    };
  }

  /**
   * Parse a mass component (generic mass)
   */
  parseMassComponent(element) {
    return {
      type: 'masscomponent',
      name: XMLParser.getText(element, 'name', 'Mass Component'),
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massComponentType: XMLParser.getText(element, 'masscomponenttype', 'MASSCOMPONENT'),
      length: XMLParser.getNumber(element, 'length') * 1000,
      diameter: XMLParser.getNumber(element, 'radius') * 2000,
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'TOP')
    };
  }

  /**
   * Parse a tube coupler
   */
  parseTubeCoupler(element) {
    return {
      type: 'tubecoupler',
      name: XMLParser.getText(element, 'name', 'Tube Coupler'),
      length: XMLParser.getNumber(element, 'length') * 1000,
      outerDiameter: XMLParser.getNumber(element, 'outerradius') * 2000,
      innerDiameter: XMLParser.getNumber(element, 'innerradius') * 2000,
      thickness: XMLParser.getNumber(element, 'thickness') * 1000,
      mass: XMLParser.getNumber(element, 'mass') * 1000,
      massOverridden: XMLParser.getBool(element, 'massoverride'),
      material: XMLParser.getText(element, 'material', 'cardboard'),
      position: XMLParser.getNumber(element, 'axialoffset') * 1000,
      positionReference: XMLParser.getText(element, 'axialmethod', 'MIDDLE'),
      subcomponents: this.parseSubcomponents(element)
    };
  }

  /**
   * Parse color/appearance
   */
  parseColor(element) {
    const appearance = element.querySelector('appearance');
    if (!appearance) return null;

    const paint = appearance.querySelector('paint');
    if (!paint) return null;

    return {
      red: XMLParser.getNumber(paint, 'red', 200),
      green: XMLParser.getNumber(paint, 'green', 200),
      blue: XMLParser.getNumber(paint, 'blue', 200),
      alpha: XMLParser.getNumber(paint, 'alpha', 255)
    };
  }

  /**
   * Parse motor configuration
   */
  parseMotorConfiguration(element) {
    const config = {
      id: XMLParser.getAttr(element, 'configid', ''),
      motors: []
    };

    const motorEls = element.querySelectorAll('motor');
    motorEls.forEach(motorEl => {
      config.motors.push({
        designation: XMLParser.getText(motorEl, 'designation', ''),
        manufacturer: XMLParser.getText(motorEl, 'manufacturer', ''),
        digest: XMLParser.getText(motorEl, 'digest', ''),
        diameter: XMLParser.getNumber(motorEl, 'diameter') * 1000,
        length: XMLParser.getNumber(motorEl, 'length') * 1000,
        delay: XMLParser.getNumber(motorEl, 'delay', -1), // -1 = plugged
        ignitionEvent: XMLParser.getText(motorEl, 'ignitionevent', 'AUTOMATIC'),
        ignitionDelay: XMLParser.getNumber(motorEl, 'ignitiondelay', 0)
      });
    });

    return config;
  }

  /**
   * Parse simulation data
   */
  parseSimulation(element) {
    const conditions = element.querySelector('conditions');
    const flightData = element.querySelector('flightdata');

    return {
      name: XMLParser.getText(element, 'name', 'Simulation'),
      configId: XMLParser.getAttr(element, 'configid', ''),
      conditions: conditions ? {
        launchRodLength: XMLParser.getNumber(conditions, 'launchrodlength') * 1000,
        launchRodAngle: XMLParser.getNumber(conditions, 'launchrodangle') * (180 / Math.PI),
        launchRodDirection: XMLParser.getNumber(conditions, 'launchroddirection') * (180 / Math.PI),
        windSpeed: XMLParser.getNumber(conditions, 'windaverage'),
        windDirection: XMLParser.getNumber(conditions, 'winddirection') * (180 / Math.PI),
        windTurbulence: XMLParser.getNumber(conditions, 'windturbulence'),
        launchAltitude: XMLParser.getNumber(conditions, 'launchaltitude'),
        launchLatitude: XMLParser.getNumber(conditions, 'launchlatitude'),
        launchLongitude: XMLParser.getNumber(conditions, 'launchlongitude'),
        atmosphereModel: XMLParser.getText(conditions, 'atmosphere', 'isa'),
        temperature: XMLParser.getNumber(conditions, 'basetemperature', 288.15) - 273.15,
        pressure: XMLParser.getNumber(conditions, 'basepressure', 101325)
      } : null,
      flightData: flightData ? {
        maxAltitude: XMLParser.getNumber(flightData, 'maxaltitude'),
        maxVelocity: XMLParser.getNumber(flightData, 'maxvelocity'),
        maxAcceleration: XMLParser.getNumber(flightData, 'maxacceleration'),
        maxMach: XMLParser.getNumber(flightData, 'maxmach'),
        timeToApogee: XMLParser.getNumber(flightData, 'timetoapogee'),
        flightTime: XMLParser.getNumber(flightData, 'flighttime'),
        groundHitVelocity: XMLParser.getNumber(flightData, 'groundhitvelocity')
      } : null
    };
  }

  /**
   * Parse subcomponents recursively
   */
  parseSubcomponents(element) {
    const subcomponents = [];
    
    const subcompEl = element.querySelector('subcomponents');
    if (!subcompEl) return subcomponents;

    Array.from(subcompEl.children).forEach(child => {
      const component = this.parseComponent(child);
      if (component) {
        subcomponents.push(component);
      }
    });

    return subcomponents;
  }

  /**
   * Parse any component by tag name
   */
  parseComponent(element) {
    const tagName = element.tagName.toLowerCase();
    
    const parsers = {
      'nosecone': () => this.parseNoseCone(element),
      'bodytube': () => this.parseBodyTube(element),
      'transition': () => this.parseTransition(element),
      'trapezoidfinset': () => this.parseTrapezoidFinSet(element),
      'ellipticalfinset': () => this.parseEllipticalFinSet(element),
      'freeformfinset': () => this.parseFreeformFinSet(element),
      'innertube': () => this.parseInnerTube(element),
      'centeringring': () => this.parseCenteringRing(element),
      'bulkhead': () => this.parseBulkhead(element),
      'parachute': () => this.parseParachute(element),
      'streamer': () => this.parseStreamer(element),
      'shockcord': () => this.parseShockCord(element),
      'launchlug': () => this.parseLaunchLug(element),
      'railbutton': () => this.parseRailButton(element),
      'engineblock': () => this.parseEngineBlock(element),
      'masscomponent': () => this.parseMassComponent(element),
      'tubecoupler': () => this.parseTubeCoupler(element),
      'stage': () => this.parseStage(element),
      'boosterset': () => this.parseBoosterSet(element),
      'parallelstage': () => this.parseParallelStage(element),
      'podset': () => this.parsePodSet(element)
    };

    if (parsers[tagName]) {
      return parsers[tagName]();
    } else {
      this.warn(`Unknown component type: ${tagName}`);
      return null;
    }
  }

  /**
   * Parse a stage
   */
  parseStage(element) {
    return {
      type: 'stage',
      name: XMLParser.getText(element, 'name', 'Stage'),
      subcomponents: this.parseSubcomponents(element)
    };
  }

  /**
   * Parse booster set
   */
  parseBoosterSet(element) {
    return {
      type: 'boosterset',
      name: XMLParser.getText(element, 'name', 'Booster Set'),
      instanceCount: XMLParser.getNumber(element, 'instancecount', 2),
      radialOffset: XMLParser.getNumber(element, 'radiusoffset') * 1000,
      angularOffset: XMLParser.getNumber(element, 'angleoffset') * (180 / Math.PI),
      subcomponents: this.parseSubcomponents(element)
    };
  }

  /**
   * Parse parallel stage
   */
  parseParallelStage(element) {
    return {
      type: 'parallelstage',
      name: XMLParser.getText(element, 'name', 'Parallel Stage'),
      instanceCount: XMLParser.getNumber(element, 'instancecount', 2),
      radialOffset: XMLParser.getNumber(element, 'radiusoffset') * 1000,
      angularOffset: XMLParser.getNumber(element, 'angleoffset') * (180 / Math.PI),
      subcomponents: this.parseSubcomponents(element)
    };
  }

  /**
   * Parse pod set
   */
  parsePodSet(element) {
    return {
      type: 'podset',
      name: XMLParser.getText(element, 'name', 'Pod Set'),
      instanceCount: XMLParser.getNumber(element, 'instancecount', 1),
      radialOffset: XMLParser.getNumber(element, 'radiusoffset') * 1000,
      angularOffset: XMLParser.getNumber(element, 'angleoffset') * (180 / Math.PI),
      subcomponents: this.parseSubcomponents(element)
    };
  }
}

// ============================================
// Main ORK Importer
// ============================================

class ORKImporter {
  constructor() {
    this.componentParser = new ComponentParser();
    this.warnings = [];
  }

  /**
   * Import from File object (browser)
   */
  async importFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    return this.importFromArrayBuffer(arrayBuffer, file.name);
  }

  /**
   * Import from URL
   */
  async importFromURL(url) {
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const filename = url.split('/').pop();
    return this.importFromArrayBuffer(arrayBuffer, filename);
  }

  /**
   * Import from ArrayBuffer
   */
  async importFromArrayBuffer(arrayBuffer, filename = 'rocket.ork') {
    let xmlString;

    // Try to detect if it's a ZIP file (starts with PK)
    const header = new Uint8Array(arrayBuffer.slice(0, 4));
    const isZip = header[0] === 0x50 && header[1] === 0x4B;
    const isGzip = header[0] === 0x1F && header[1] === 0x8B;

    if (isZip) {
      // Use JSZip if available, otherwise try pako for gzip
      if (typeof JSZip !== 'undefined') {
        const zip = await JSZip.loadAsync(arrayBuffer);
        const orkFile = zip.file('rocket.ork') || zip.file(/\.ork$/i)[0];
        if (orkFile) {
          xmlString = await orkFile.async('string');
        } else {
          throw new Error('No rocket.ork found in ZIP archive');
        }
      } else {
        throw new Error('JSZip library required to read .ork ZIP files. Include JSZip in your page.');
      }
    } else if (isGzip) {
      // Decompress with pako if available
      if (typeof pako !== 'undefined') {
        const decompressed = pako.inflate(new Uint8Array(arrayBuffer));
        xmlString = new TextDecoder().decode(decompressed);
      } else {
        throw new Error('Pako library required to read GZIP .ork files.');
      }
    } else {
      // Assume plain XML
      xmlString = new TextDecoder().decode(arrayBuffer);
    }

    return this.parseXML(xmlString, filename);
  }

  /**
   * Import from XML string
   */
  importFromXML(xmlString, filename = 'rocket.ork') {
    return this.parseXML(xmlString, filename);
  }

  /**
   * Parse the XML content
   */
  parseXML(xmlString, filename) {
    this.warnings = [];
    this.componentParser.warnings = [];

    const doc = XMLParser.parse(xmlString);
    const root = doc.documentElement;

    if (root.tagName !== 'openrocket') {
      throw new Error('Invalid OpenRocket file: missing <openrocket> root element');
    }

    // Get file version
    const version = XMLParser.getAttr(root, 'version', '1.0');
    const creator = XMLParser.getAttr(root, 'creator', 'unknown');

    // Parse rocket
    const rocketEl = root.querySelector('rocket');
    if (!rocketEl) {
      throw new Error('Invalid OpenRocket file: missing <rocket> element');
    }

    const rocket = this.parseRocket(rocketEl);

    // Parse simulations
    const simulations = [];
    const simulationEls = root.querySelectorAll('simulations > simulation');
    simulationEls.forEach(simEl => {
      simulations.push(this.componentParser.parseSimulation(simEl));
    });

    // Parse motor configurations
    const motorConfigs = [];
    const motorConfigEls = root.querySelectorAll('motorconfiguration');
    motorConfigEls.forEach(configEl => {
      motorConfigs.push(this.componentParser.parseMotorConfiguration(configEl));
    });

    // Combine warnings
    this.warnings = [...this.warnings, ...this.componentParser.warnings];

    return {
      filename,
      version,
      creator,
      rocket,
      motorConfigurations: motorConfigs,
      simulations,
      warnings: this.warnings,
      
      // Converted LAUNCHSIM format
      launchsim: this.convertToLAUNCHSIM(rocket)
    };
  }

  /**
   * Parse the rocket element
   */
  parseRocket(rocketEl) {
    const rocket = {
      name: XMLParser.getText(rocketEl, 'name', 'Unnamed Rocket'),
      designer: XMLParser.getText(rocketEl, 'designer', ''),
      revision: XMLParser.getText(rocketEl, 'revision', ''),
      comment: XMLParser.getText(rocketEl, 'comment', ''),
      stages: []
    };

    // Parse stages (sustainer + boosters)
    const stageEls = rocketEl.querySelectorAll(':scope > subcomponents > stage');
    stageEls.forEach((stageEl, index) => {
      const stage = {
        name: XMLParser.getText(stageEl, 'name', `Stage ${index + 1}`),
        components: []
      };

      // Parse stage subcomponents
      const subcompEl = stageEl.querySelector('subcomponents');
      if (subcompEl) {
        Array.from(subcompEl.children).forEach(child => {
          const component = this.componentParser.parseComponent(child);
          if (component) {
            stage.components.push(component);
          }
        });
      }

      rocket.stages.push(stage);
    });

    return rocket;
  }

  /**
   * Convert to LAUNCHSIM format for simulation
   */
  convertToLAUNCHSIM(rocket) {
    const config = {
      name: rocket.name,
      designer: rocket.designer,
      
      // Nose cone
      noseShape: 'ogive',
      noseLength: 0,
      noseDiameter: 0,
      noseMass: 0,
      
      // Body
      bodyDiameter: 0,
      bodyLength: 0,
      bodyMass: 0,
      
      // Fins
      finCount: 3,
      finRootChord: 0,
      finTipChord: 0,
      finSpan: 0,
      finSweep: 0,
      finThickness: 0,
      finMass: 0,
      
      // Recovery
      chuteCount: 0,
      chuteDiameter: 0,
      chuteCd: 0.8,
      deployEvent: 'apogee',
      deployDelay: 0,
      
      // Motor mount
      motorDiameter: 0,
      motorLength: 0,
      
      // Calculated
      totalMass: 0,
      components: [],
      
      // Original data
      _orkData: rocket
    };

    // Flatten all components
    const allComponents = [];
    rocket.stages.forEach(stage => {
      this.flattenComponents(stage.components, allComponents);
    });

    config.components = allComponents;

    // Extract key dimensions from components
    allComponents.forEach(comp => {
      switch (comp.type) {
        case 'nosecone':
          config.noseShape = comp.shape;
          config.noseLength = comp.length;
          config.noseDiameter = comp.diameter;
          config.noseMass = comp.mass;
          if (config.bodyDiameter === 0) {
            config.bodyDiameter = comp.diameter;
          }
          break;

        case 'bodytube':
          config.bodyLength += comp.length;
          if (comp.outerDiameter > config.bodyDiameter) {
            config.bodyDiameter = comp.outerDiameter;
          }
          config.bodyMass += comp.mass;
          break;

        case 'transition':
          config.bodyLength += comp.length;
          break;

        case 'trapezoidfinset':
        case 'ellipticalfinset':
        case 'freeformfinset':
          config.finCount = comp.finCount;
          config.finRootChord = comp.rootChord;
          config.finTipChord = comp.tipChord || 0;
          config.finSpan = comp.span;
          config.finSweep = comp.sweepLength || 0;
          config.finThickness = comp.thickness;
          config.finMass = comp.mass;
          break;

        case 'parachute':
          config.chuteCount++;
          config.chuteDiameter = Math.max(config.chuteDiameter, comp.diameter);
          config.chuteCd = comp.cd;
          config.deployEvent = comp.deployEvent;
          config.deployDelay = comp.deployDelay;
          break;

        case 'innertube':
          if (comp.motorMount) {
            config.motorDiameter = comp.innerDiameter;
            config.motorLength = comp.length;
          }
          break;
      }

      // Sum up mass
      if (comp.mass && comp.mass > 0) {
        config.totalMass += comp.mass;
      }
    });

    // Convert units for LAUNCHSIM (mm)
    // Already in mm from parser
    
    return config;
  }

  /**
   * Recursively flatten component tree
   */
  flattenComponents(components, output, depth = 0) {
    components.forEach(comp => {
      comp._depth = depth;
      output.push(comp);
      
      if (comp.subcomponents) {
        this.flattenComponents(comp.subcomponents, output, depth + 1);
      }
    });
  }

  /**
   * Get warnings from import
   */
  getWarnings() {
    return this.warnings;
  }
}

// ============================================
// UI Component for File Import
// ============================================

class ORKImportUI {
  constructor(options = {}) {
    this.onImport = options.onImport || (() => {});
    this.onError = options.onError || ((e) => log.error('Import error:', e));
    this.importer = new ORKImporter();
    this.lastImport = null;
  }

  /**
   * Create file input and handle import
   */
  createFileInput(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      log.error(`Container ${containerId} not found`);
      return;
    }

    container.innerHTML = `
      <div class="ork-import-ui">
        <div class="import-header">
          <h3>📂 Import OpenRocket Design</h3>
          <p>Upload a .ork file to import your rocket design</p>
        </div>
        
        <div class="import-dropzone" id="ork-dropzone">
          <div class="dropzone-content">
            <span class="dropzone-icon">🚀</span>
            <span class="dropzone-text">Drop .ork file here or click to browse</span>
            <input type="file" id="ork-file-input" accept=".ork,.ork.gz" style="display: none;">
          </div>
        </div>
        
        <div class="import-status" id="ork-import-status" style="display: none;">
          <div class="status-content"></div>
        </div>
        
        <div class="import-preview" id="ork-preview" style="display: none;">
          <h4>Imported Rocket</h4>
          <div class="preview-content" id="ork-preview-content"></div>
          <div class="preview-actions">
            <button class="btn btn-primary" id="ork-apply-btn">Apply to Designer</button>
            <button class="btn btn-secondary" id="ork-details-btn">Show Details</button>
          </div>
        </div>
        
        <div class="import-details" id="ork-details" style="display: none;">
          <h4>Component Details</h4>
          <div class="details-tree" id="ork-component-tree"></div>
          <div class="details-warnings" id="ork-warnings"></div>
        </div>
      </div>
    `;

    // Setup event listeners
    this.setupEventListeners();
  }

  setupEventListeners() {
    const dropzone = document.getElementById('ork-dropzone');
    const fileInput = document.getElementById('ork-file-input');
    const applyBtn = document.getElementById('ork-apply-btn');
    const detailsBtn = document.getElementById('ork-details-btn');

    // Click to browse
    dropzone.addEventListener('click', () => fileInput.click());

    // File input change
    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.handleFile(e.target.files[0]);
      }
    });

    // Drag and drop
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });

    dropzone.addEventListener('dragleave', () => {
      dropzone.classList.remove('dragover');
    });

    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
      
      if (e.dataTransfer.files.length > 0) {
        this.handleFile(e.dataTransfer.files[0]);
      }
    });

    // Apply button
    applyBtn.addEventListener('click', () => {
      if (this.lastImport) {
        this.onImport(this.lastImport);
      }
    });

    // Details toggle
    detailsBtn.addEventListener('click', () => {
      const details = document.getElementById('ork-details');
      details.style.display = details.style.display === 'none' ? 'block' : 'none';
      detailsBtn.textContent = details.style.display === 'none' ? 'Show Details' : 'Hide Details';
    });
  }

  async handleFile(file) {
    const statusEl = document.getElementById('ork-import-status');
    const previewEl = document.getElementById('ork-preview');
    const detailsEl = document.getElementById('ork-details');

    // Show loading
    statusEl.style.display = 'block';
    statusEl.querySelector('.status-content').innerHTML = `
      <span class="loading">⏳ Importing ${file.name}...</span>
    `;
    previewEl.style.display = 'none';
    detailsEl.style.display = 'none';

    try {
      const result = await this.importer.importFile(file);
      this.lastImport = result;

      // Show success
      statusEl.querySelector('.status-content').innerHTML = `
        <span class="success">✅ Successfully imported "${result.rocket.name}"</span>
      `;

      // Show preview
      this.showPreview(result);
      this.showDetails(result);
      previewEl.style.display = 'block';

    } catch (error) {
      statusEl.querySelector('.status-content').innerHTML = `
        <span class="error">❌ Import failed: ${error.message}</span>
      `;
      this.onError(error);
    }
  }

  showPreview(result) {
    const content = document.getElementById('ork-preview-content');
    const ls = result.launchsim;

    content.innerHTML = `
      <table class="preview-table">
        <tr><th>Name</th><td>${result.rocket.name}</td></tr>
        <tr><th>Designer</th><td>${result.rocket.designer || '-'}</td></tr>
        <tr><th>Stages</th><td>${result.rocket.stages.length}</td></tr>
        <tr><th>Components</th><td>${ls.components.length}</td></tr>
        <tr><th colspan="2" class="section-header">Dimensions</th></tr>
        <tr><th>Body Diameter</th><td>${ls.bodyDiameter.toFixed(1)} mm</td></tr>
        <tr><th>Body Length</th><td>${ls.bodyLength.toFixed(1)} mm</td></tr>
        <tr><th>Nose Length</th><td>${ls.noseLength.toFixed(1)} mm</td></tr>
        <tr><th>Total Length</th><td>${(ls.bodyLength + ls.noseLength).toFixed(1)} mm</td></tr>
        <tr><th colspan="2" class="section-header">Fins</th></tr>
        <tr><th>Fin Count</th><td>${ls.finCount}</td></tr>
        <tr><th>Root Chord</th><td>${ls.finRootChord.toFixed(1)} mm</td></tr>
        <tr><th>Tip Chord</th><td>${ls.finTipChord.toFixed(1)} mm</td></tr>
        <tr><th>Span</th><td>${ls.finSpan.toFixed(1)} mm</td></tr>
        <tr><th colspan="2" class="section-header">Recovery</th></tr>
        <tr><th>Parachutes</th><td>${ls.chuteCount}</td></tr>
        <tr><th>Chute Diameter</th><td>${ls.chuteDiameter.toFixed(1)} mm</td></tr>
        <tr><th>Deploy Event</th><td>${ls.deployEvent}</td></tr>
        <tr><th colspan="2" class="section-header">Motor Mount</th></tr>
        <tr><th>Motor Diameter</th><td>${ls.motorDiameter.toFixed(1)} mm</td></tr>
        <tr><th>Motor Length</th><td>${ls.motorLength.toFixed(1)} mm</td></tr>
        <tr><th colspan="2" class="section-header">Mass</th></tr>
        <tr><th>Total Mass</th><td>${ls.totalMass.toFixed(1)} g</td></tr>
      </table>
    `;
  }

  showDetails(result) {
    const treeEl = document.getElementById('ork-component-tree');
    const warningsEl = document.getElementById('ork-warnings');

    // Build component tree
    let treeHTML = '<ul class="component-tree">';
    result.rocket.stages.forEach((stage, si) => {
      treeHTML += `<li class="stage"><span class="stage-name">📦 ${stage.name}</span><ul>`;
      stage.components.forEach(comp => {
        treeHTML += this.renderComponentTreeItem(comp);
      });
      treeHTML += '</ul></li>';
    });
    treeHTML += '</ul>';
    treeEl.innerHTML = treeHTML;

    // Show warnings
    if (result.warnings.length > 0) {
      warningsEl.innerHTML = `
        <h5>⚠️ Import Warnings</h5>
        <ul>
          ${result.warnings.map(w => `<li>${w}</li>`).join('')}
        </ul>
      `;
      warningsEl.style.display = 'block';
    } else {
      warningsEl.style.display = 'none';
    }
  }

  renderComponentTreeItem(comp) {
    const icon = this.getComponentIcon(comp.type);
    let html = `<li class="component component-${comp.type}">
      <span class="component-name">${icon} ${comp.name || comp.type}</span>`;
    
    if (comp.subcomponents && comp.subcomponents.length > 0) {
      html += '<ul>';
      comp.subcomponents.forEach(sub => {
        html += this.renderComponentTreeItem(sub);
      });
      html += '</ul>';
    }
    
    html += '</li>';
    return html;
  }

  getComponentIcon(type) {
    const icons = {
      nosecone: '🔺',
      bodytube: '📏',
      transition: '🔻',
      trapezoidfinset: '◢',
      ellipticalfinset: '◗',
      freeformfinset: '◢',
      innertube: '⊙',
      centeringring: '◎',
      bulkhead: '▬',
      parachute: '🪂',
      streamer: '🎗️',
      shockcord: '〰️',
      launchlug: '⊢',
      railbutton: '⊡',
      engineblock: '▣',
      masscomponent: '⚖️',
      tubecoupler: '⊜',
      stage: '📦',
      boosterset: '🚀',
      parallelstage: '🔀',
      podset: '🛸'
    };
    return icons[type] || '•';
  }
}

// ============================================
// CSS Styles
// ============================================

const ORK_IMPORT_STYLES = `
<style>
.ork-import-ui {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  max-width: 600px;
  margin: 0 auto;
}

.import-header {
  text-align: center;
  margin-bottom: 20px;
}

.import-header h3 {
  margin: 0 0 5px 0;
  color: #333;
}

.import-header p {
  margin: 0;
  color: #666;
  font-size: 14px;
}

.import-dropzone {
  border: 2px dashed #ccc;
  border-radius: 8px;
  padding: 40px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: #f9f9f9;
}

.import-dropzone:hover,
.import-dropzone.dragover {
  border-color: #ff6b35;
  background: #fff5f0;
}

.dropzone-icon {
  font-size: 48px;
  display: block;
  margin-bottom: 10px;
}

.dropzone-text {
  color: #666;
}

.import-status {
  margin-top: 15px;
  padding: 10px 15px;
  border-radius: 6px;
  background: #f0f0f0;
}

.import-status .success { color: #2e7d32; }
.import-status .error { color: #c62828; }
.import-status .loading { color: #1565c0; }

.import-preview {
  margin-top: 20px;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 15px;
  background: #fff;
}

.import-preview h4 {
  margin: 0 0 15px 0;
  color: #333;
}

.preview-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.preview-table th,
.preview-table td {
  padding: 6px 10px;
  text-align: left;
  border-bottom: 1px solid #eee;
}

.preview-table th {
  color: #666;
  font-weight: 500;
  width: 40%;
}

.preview-table .section-header {
  background: #f5f5f5;
  color: #333;
  font-weight: 600;
  padding-top: 10px;
}

.preview-actions {
  margin-top: 15px;
  display: flex;
  gap: 10px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.btn-primary {
  background: #ff6b35;
  color: white;
}

.btn-primary:hover {
  background: #e55a25;
}

.btn-secondary {
  background: #e0e0e0;
  color: #333;
}

.btn-secondary:hover {
  background: #d0d0d0;
}

.import-details {
  margin-top: 15px;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 15px;
  background: #fff;
}

.component-tree {
  list-style: none;
  padding-left: 0;
  font-size: 13px;
}

.component-tree ul {
  list-style: none;
  padding-left: 20px;
  margin: 5px 0;
}

.component-tree li {
  padding: 3px 0;
}

.stage-name {
  font-weight: 600;
  color: #333;
}

.component-name {
  color: #555;
}

.details-warnings {
  margin-top: 15px;
  padding: 10px;
  background: #fff8e1;
  border-radius: 6px;
  font-size: 13px;
}

.details-warnings h5 {
  margin: 0 0 10px 0;
  color: #f57c00;
}

.details-warnings ul {
  margin: 0;
  padding-left: 20px;
}
</style>
`;

// Inject styles
if (typeof document !== 'undefined') {
  const styleEl = document.createElement('div');
  styleEl.innerHTML = ORK_IMPORT_STYLES;
  document.head.appendChild(styleEl.firstChild);
}

// ============================================
// Export
// ============================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ORKImporter,
    ORKImportUI,
    XMLParser,
    ComponentParser,
    NOSE_SHAPE_MAP,
    MATERIAL_DENSITY
  };
}

if (typeof window !== 'undefined') {
  window.ORKImporter = ORKImporter;
  window.ORKImportUI = ORKImportUI;
  window.XMLParser = XMLParser;
  window.ComponentParser = ComponentParser;
}

// ES Module export
export { ORKImporter, ORKImportUI, XMLParser, ComponentParser, NOSE_SHAPE_MAP, MATERIAL_DENSITY };

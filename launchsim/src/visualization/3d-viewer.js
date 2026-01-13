/**
 * LAUNCHSIM 3D Visualization Module
 * ==================================
 * 
 * Provides 3D rocket model viewing, trajectory visualization, and flight replay.
 * Uses Three.js for WebGL rendering.
 * 
 * Features:
 * - 3D rocket model generated from design parameters
 * - CG/CP markers visualization
 * - 3D trajectory path with velocity coloring
 * - Flight replay animation with multiple camera modes
 * - Ground plane with grid and launch pad
 * - Smoke/exhaust trail particle system
 * - Parachute deployment animation
 * - Multi-stage separation visualization
 * 
 * Usage:
 *   const viewer = new Rocket3DViewer(containerElement);
 *   viewer.setRocket(rocketConfig);
 *   viewer.setTrajectory(simulationResult);
 *   viewer.playFlight();
 */

// Check for Three.js availability
const THREE_AVAILABLE = typeof THREE !== 'undefined';

const log = {
  debug: (...args) => console.log('[3DViewer]', ...args),
  warn: (...args) => console.warn('[3DViewer]', ...args),
  error: (...args) => console.error('[3DViewer]', ...args)
};

/**
 * Color utilities for visualization
 */
const ColorUtils = {
  // Velocity to color gradient (blue -> green -> yellow -> red)
  velocityToColor(velocity, maxVelocity) {
    const ratio = Math.min(velocity / maxVelocity, 1);
    
    if (ratio < 0.25) {
      // Blue to Cyan
      return new THREE.Color(0, ratio * 4, 1);
    } else if (ratio < 0.5) {
      // Cyan to Green
      return new THREE.Color(0, 1, 1 - (ratio - 0.25) * 4);
    } else if (ratio < 0.75) {
      // Green to Yellow
      return new THREE.Color((ratio - 0.5) * 4, 1, 0);
    } else {
      // Yellow to Red
      return new THREE.Color(1, 1 - (ratio - 0.75) * 4, 0);
    }
  },

  // Altitude to color gradient
  altitudeToColor(altitude, maxAltitude) {
    const ratio = Math.min(altitude / maxAltitude, 1);
    return new THREE.Color().setHSL(0.6 - ratio * 0.6, 0.8, 0.5);
  },

  // Phase colors
  phaseColors: {
    'powered': 0xff6600,
    'coasting': 0x00aaff,
    'descent': 0x9900ff,
    'drogue': 0xff9900,
    'main': 0x00ff00,
    'landed': 0x666666
  }
};

/**
 * Smoke Trail Particle System
 * Creates a persistent smoke trail behind the rocket
 */
class SmokeTrailSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = {
      maxParticles: 500,
      particleLifetime: 8,        // seconds
      emissionRate: 30,           // particles per second
      initialSize: 0.8,
      finalSize: 4,
      initialOpacity: 0.7,
      smokeColor: 0xcccccc,
      exhaustColor: 0xff6600,
      ...options
    };

    this.particles = [];
    this.lastEmitTime = 0;
    this.isActive = false;
    
    // Create particle geometry and material
    this.particleGeometry = new THREE.SphereGeometry(1, 8, 6);
    
    // Smoke material (gray, fades out)
    this.smokeMaterial = new THREE.MeshBasicMaterial({
      color: this.options.smokeColor,
      transparent: true,
      opacity: this.options.initialOpacity,
      depthWrite: false
    });

    // Exhaust material (orange/yellow, bright)
    this.exhaustMaterial = new THREE.MeshBasicMaterial({
      color: this.options.exhaustColor,
      transparent: true,
      opacity: 0.9,
      depthWrite: false
    });

    // Group to hold all particles
    this.particleGroup = new THREE.Group();
    this.scene.add(this.particleGroup);
  }

  start() {
    this.isActive = true;
    this.lastEmitTime = performance.now();
  }

  stop() {
    this.isActive = false;
  }

  clear() {
    // Remove all particles
    this.particles.forEach(p => {
      this.particleGroup.remove(p.mesh);
      p.mesh.geometry.dispose();
    });
    this.particles = [];
  }

  emit(position, velocity, isPowered = true) {
    if (!this.isActive) return;

    const now = performance.now();
    const elapsed = (now - this.lastEmitTime) / 1000;
    const particlesToEmit = Math.floor(elapsed * this.options.emissionRate);

    if (particlesToEmit < 1) return;
    this.lastEmitTime = now;

    for (let i = 0; i < Math.min(particlesToEmit, 5); i++) {
      if (this.particles.length >= this.options.maxParticles) {
        // Remove oldest particle
        const oldest = this.particles.shift();
        this.particleGroup.remove(oldest.mesh);
        oldest.mesh.geometry.dispose();
      }

      // Create new particle
      const material = isPowered ? 
        this.exhaustMaterial.clone() : 
        this.smokeMaterial.clone();
      
      const mesh = new THREE.Mesh(this.particleGeometry, material);
      
      // Add some randomness to position
      mesh.position.set(
        position.x + (Math.random() - 0.5) * 0.5,
        position.y + (Math.random() - 0.5) * 0.5,
        position.z + (Math.random() - 0.5) * 0.5
      );

      // Initial scale
      const size = this.options.initialSize * (0.8 + Math.random() * 0.4);
      mesh.scale.setScalar(size);

      // Store particle data
      const particle = {
        mesh,
        createdAt: now,
        lifetime: this.options.particleLifetime * (0.8 + Math.random() * 0.4),
        initialSize: size,
        velocity: {
          x: (Math.random() - 0.5) * 2 - velocity.x * 0.02,
          y: (Math.random() - 0.5) * 2 + 1, // Slight upward drift
          z: (Math.random() - 0.5) * 2 - velocity.z * 0.02
        },
        isPowered
      };

      this.particles.push(particle);
      this.particleGroup.add(mesh);
    }
  }

  update(deltaTime) {
    const now = performance.now();
    const toRemove = [];

    this.particles.forEach((particle, index) => {
      const age = (now - particle.createdAt) / 1000;
      const lifeRatio = age / particle.lifetime;

      if (lifeRatio >= 1) {
        toRemove.push(index);
        return;
      }

      // Update position (drift upward and outward)
      particle.mesh.position.x += particle.velocity.x * deltaTime;
      particle.mesh.position.y += particle.velocity.y * deltaTime;
      particle.mesh.position.z += particle.velocity.z * deltaTime;

      // Slow down velocity over time
      particle.velocity.x *= 0.99;
      particle.velocity.y *= 0.995;
      particle.velocity.z *= 0.99;

      // Grow and fade
      const sizeFactor = 1 + lifeRatio * (this.options.finalSize / this.options.initialSize - 1);
      particle.mesh.scale.setScalar(particle.initialSize * sizeFactor);

      // Fade out
      const opacity = this.options.initialOpacity * (1 - lifeRatio * lifeRatio);
      particle.mesh.material.opacity = opacity;

      // Color transition for exhaust particles (orange -> gray)
      if (particle.isPowered && lifeRatio > 0.2) {
        const colorRatio = (lifeRatio - 0.2) / 0.8;
        const r = 1 - colorRatio * 0.2;
        const g = 0.4 + colorRatio * 0.4;
        const b = colorRatio * 0.8;
        particle.mesh.material.color.setRGB(r, g, b);
      }
    });

    // Remove dead particles (in reverse order to maintain indices)
    toRemove.reverse().forEach(index => {
      const particle = this.particles[index];
      this.particleGroup.remove(particle.mesh);
      particle.mesh.material.dispose();
      this.particles.splice(index, 1);
    });
  }

  dispose() {
    this.clear();
    this.scene.remove(this.particleGroup);
    this.particleGeometry.dispose();
    this.smokeMaterial.dispose();
    this.exhaustMaterial.dispose();
  }
}

/**
 * Parachute System
 * Creates animated parachutes for recovery events
 */
class ParachuteSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = {
      drogueColor: 0xff6600,      // Orange
      mainColor: 0xff0000,        // Red
      drogueSize: 3,              // meters (visual scale)
      mainSize: 8,
      deployDuration: 1.5,        // seconds to fully open
      ...options
    };

    this.parachutes = [];
  }

  createParachute(type = 'main', size = null) {
    const isMain = type === 'main';
    const color = isMain ? this.options.mainColor : this.options.drogueColor;
    const baseSize = size || (isMain ? this.options.mainSize : this.options.drogueSize);

    const group = new THREE.Group();

    // Canopy (hemisphere)
    const canopyGeometry = new THREE.SphereGeometry(
      baseSize, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2
    );
    const canopyMaterial = new THREE.MeshPhongMaterial({
      color: color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.85,
      shininess: 30
    });
    const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
    canopy.rotation.x = Math.PI;
    group.add(canopy);

    // Suspension lines
    const lineCount = 8;
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0x333333 });
    
    for (let i = 0; i < lineCount; i++) {
      const angle = (i / lineCount) * Math.PI * 2;
      const lineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(
          Math.cos(angle) * baseSize * 0.9,
          0,
          Math.sin(angle) * baseSize * 0.9
        ),
        new THREE.Vector3(0, baseSize * 1.5, 0)
      ]);
      const line = new THREE.Line(lineGeometry, lineMaterial);
      group.add(line);
    }

    // Vent hole at top
    const ventGeometry = new THREE.CircleGeometry(baseSize * 0.15, 16);
    const ventMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide
    });
    const vent = new THREE.Mesh(ventGeometry, ventMaterial);
    vent.rotation.x = Math.PI / 2;
    vent.position.y = -baseSize * 0.05;
    group.add(vent);

    // Gore lines (segments)
    const goreCount = 8;
    const goreMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 });
    
    for (let i = 0; i < goreCount; i++) {
      const angle = (i / goreCount) * Math.PI * 2;
      const points = [];
      
      for (let j = 0; j <= 12; j++) {
        const t = j / 12;
        const r = baseSize * Math.sin(t * Math.PI / 2);
        const y = -baseSize * Math.cos(t * Math.PI / 2);
        points.push(new THREE.Vector3(
          Math.cos(angle) * r,
          y,
          Math.sin(angle) * r
        ));
      }
      
      const goreGeometry = new THREE.BufferGeometry().setFromPoints(points);
      const gore = new THREE.Line(goreGeometry, goreMaterial);
      group.add(gore);
    }

    // Store metadata
    group.userData = {
      type,
      baseSize,
      deployProgress: 0,
      isDeploying: false,
      isDeployed: false,
      deployStartTime: 0
    };

    // Initially collapsed
    group.scale.set(0.1, 0.1, 0.1);
    group.visible = false;

    return group;
  }

  deploy(parachuteMesh, position, rocketMesh) {
    parachuteMesh.position.copy(position);
    parachuteMesh.visible = true;
    parachuteMesh.userData.isDeploying = true;
    parachuteMesh.userData.deployStartTime = performance.now();
    
    // Add to scene if not already
    if (!parachuteMesh.parent) {
      this.scene.add(parachuteMesh);
    }

    this.parachutes.push({
      mesh: parachuteMesh,
      attachedTo: rocketMesh,
      offset: new THREE.Vector3(0, parachuteMesh.userData.baseSize * 1.5, 0)
    });
  }

  update(deltaTime) {
    const now = performance.now();

    this.parachutes.forEach(chute => {
      const mesh = chute.mesh;
      const userData = mesh.userData;

      // Update deployment animation
      if (userData.isDeploying && !userData.isDeployed) {
        const elapsed = (now - userData.deployStartTime) / 1000;
        const progress = Math.min(elapsed / this.options.deployDuration, 1);
        
        // Eased opening
        const eased = 1 - Math.pow(1 - progress, 3);
        mesh.scale.setScalar(0.1 + eased * 0.9);

        if (progress >= 1) {
          userData.isDeployed = true;
          userData.isDeploying = false;
        }
      }

      // Follow attached rocket
      if (chute.attachedTo && chute.attachedTo.visible) {
        mesh.position.copy(chute.attachedTo.position).add(chute.offset);
        
        // Gentle swaying animation
        const time = now / 1000;
        mesh.rotation.x = Math.sin(time * 2) * 0.1;
        mesh.rotation.z = Math.cos(time * 1.5) * 0.1;
      }
    });
  }

  reset() {
    this.parachutes.forEach(chute => {
      chute.mesh.visible = false;
      chute.mesh.scale.set(0.1, 0.1, 0.1);
      chute.mesh.userData.isDeploying = false;
      chute.mesh.userData.isDeployed = false;
    });
    this.parachutes = [];
  }

  dispose() {
    this.parachutes.forEach(chute => {
      this.scene.remove(chute.mesh);
      chute.mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    });
    this.parachutes = [];
  }
}

/**
 * Stage Separation System
 * Handles multi-stage rocket visualization with separating boosters
 */
class StageSeparationSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = {
      separationVelocity: 5,    // m/s push apart
      tumbleRate: 2,            // radians/second
      dragCoefficient: 0.5,
      ...options
    };

    this.separatedStages = [];
    this.stageConfigs = [];
  }

  setStageConfigurations(stages) {
    // Store stage configurations for later separation
    this.stageConfigs = stages || [];
  }

  createStageMesh(stageConfig, scale = 0.01) {
    const group = new THREE.Group();
    
    const bodyRadius = (stageConfig.diameter || 50) * scale / 2;
    const bodyLength = (stageConfig.length || 200) * scale;
    
    // Stage body
    const bodyMaterial = new THREE.MeshPhongMaterial({
      color: stageConfig.color || 0x888888,
      shininess: 40
    });
    
    const bodyGeometry = new THREE.CylinderGeometry(
      bodyRadius, bodyRadius, bodyLength, 16
    );
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = bodyLength / 2;
    body.castShadow = true;
    group.add(body);

    // Motor nozzle at bottom
    const nozzleGeometry = new THREE.ConeGeometry(bodyRadius * 0.7, bodyLength * 0.15, 12);
    const nozzleMaterial = new THREE.MeshPhongMaterial({ color: 0x222222 });
    const nozzle = new THREE.Mesh(nozzleGeometry, nozzleMaterial);
    nozzle.rotation.x = Math.PI;
    nozzle.position.y = -bodyLength * 0.075;
    group.add(nozzle);

    // Fins for booster stages
    if (stageConfig.hasFins !== false) {
      const finMaterial = new THREE.MeshPhongMaterial({ color: 0x333333 });
      const finCount = stageConfig.finCount || 4;
      
      for (let i = 0; i < finCount; i++) {
        const finShape = new THREE.Shape();
        const finRoot = bodyLength * 0.3;
        const finSpan = bodyRadius * 2;
        
        finShape.moveTo(0, 0);
        finShape.lineTo(finRoot, 0);
        finShape.lineTo(finRoot * 0.3, finSpan);
        finShape.lineTo(0, 0);

        const finGeometry = new THREE.ExtrudeGeometry(finShape, {
          steps: 1,
          depth: 0.02,
          bevelEnabled: false
        });
        
        const fin = new THREE.Mesh(finGeometry, finMaterial);
        const angle = (i / finCount) * Math.PI * 2;
        fin.position.x = Math.cos(angle) * bodyRadius;
        fin.position.z = Math.sin(angle) * bodyRadius;
        fin.position.y = finRoot / 2;
        fin.rotation.y = -angle + Math.PI / 2;
        fin.rotation.x = Math.PI / 2;
        group.add(fin);
      }
    }

    // Store metadata
    group.userData = {
      stageNumber: stageConfig.stageNumber || 0,
      length: bodyLength,
      radius: bodyRadius,
      mass: stageConfig.mass || 1
    };

    return group;
  }

  separate(stageNumber, position, velocity, rocketQuaternion) {
    // Find stage config
    const stageConfig = this.stageConfigs.find(s => s.stageNumber === stageNumber);
    if (!stageConfig) return;

    // Create stage mesh
    const stageMesh = this.createStageMesh(stageConfig);
    stageMesh.position.copy(position);
    stageMesh.quaternion.copy(rocketQuaternion);
    
    this.scene.add(stageMesh);

    // Calculate separation velocity (push downward and outward)
    const sepVelocity = new THREE.Vector3(
      (Math.random() - 0.5) * 2,
      -this.options.separationVelocity,
      (Math.random() - 0.5) * 2
    );
    sepVelocity.applyQuaternion(rocketQuaternion);

    // Random tumble axis
    const tumbleAxis = new THREE.Vector3(
      Math.random() - 0.5,
      Math.random() - 0.5,
      Math.random() - 0.5
    ).normalize();

    this.separatedStages.push({
      mesh: stageMesh,
      velocity: {
        x: velocity.x + sepVelocity.x,
        y: velocity.y + sepVelocity.y,
        z: velocity.z + sepVelocity.z
      },
      tumbleAxis,
      tumbleRate: this.options.tumbleRate * (0.5 + Math.random()),
      separatedAt: performance.now()
    });

    log.debug(`Stage ${stageNumber} separated at`, position);
  }

  update(deltaTime, gravity = -9.81) {
    const toRemove = [];

    this.separatedStages.forEach((stage, index) => {
      // Apply gravity
      stage.velocity.y += gravity * deltaTime;

      // Apply drag (simplified)
      const speed = Math.sqrt(
        stage.velocity.x ** 2 + 
        stage.velocity.y ** 2 + 
        stage.velocity.z ** 2
      );
      const dragForce = this.options.dragCoefficient * speed * 0.01;
      
      if (speed > 0) {
        stage.velocity.x -= (stage.velocity.x / speed) * dragForce * deltaTime;
        stage.velocity.y -= (stage.velocity.y / speed) * dragForce * deltaTime;
        stage.velocity.z -= (stage.velocity.z / speed) * dragForce * deltaTime;
      }

      // Update position
      stage.mesh.position.x += stage.velocity.x * deltaTime;
      stage.mesh.position.y += stage.velocity.y * deltaTime;
      stage.mesh.position.z += stage.velocity.z * deltaTime;

      // Apply tumbling rotation
      const tumbleAngle = stage.tumbleRate * deltaTime;
      stage.mesh.rotateOnAxis(stage.tumbleAxis, tumbleAngle);

      // Check if hit ground
      if (stage.mesh.position.y <= 0) {
        stage.mesh.position.y = 0;
        stage.velocity = { x: 0, y: 0, z: 0 };
        stage.tumbleRate = 0;
        
        // Lay flat on ground
        stage.mesh.rotation.x = Math.PI / 2;
        
        // Remove after some time on ground
        const timeOnGround = (performance.now() - stage.separatedAt) / 1000;
        if (timeOnGround > 30) {
          toRemove.push(index);
        }
      }
    });

    // Remove old stages
    toRemove.reverse().forEach(index => {
      const stage = this.separatedStages[index];
      this.scene.remove(stage.mesh);
      stage.mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this.separatedStages.splice(index, 1);
    });
  }

  reset() {
    this.separatedStages.forEach(stage => {
      this.scene.remove(stage.mesh);
      stage.mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    });
    this.separatedStages = [];
  }

  dispose() {
    this.reset();
  }
}

/**
 * Terrain System
 * Generates realistic terrain with elevation, vegetation, and structures
 */
class TerrainSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = {
      size: 2000,                    // Terrain size in meters
      resolution: 64,                // Grid resolution
      maxElevation: 100,             // Maximum height variation
      baseElevation: 0,              // Base ground level
      seed: Math.random() * 10000,   // Random seed for terrain
      enableTrees: true,
      enableBuildings: true,
      treeCount: 200,
      buildingCount: 15,
      launchSiteClearRadius: 100,    // Clear area around launch pad
      ...options
    };

    this.terrainMesh = null;
    this.vegetationGroup = null;
    this.buildingsGroup = null;
    this.heightMap = null;
    
    // Biome colors
    this.biomeColors = {
      water: new THREE.Color(0x3498db),
      sand: new THREE.Color(0xf4d03f),
      grass: new THREE.Color(0x27ae60),
      forest: new THREE.Color(0x1e8449),
      rock: new THREE.Color(0x7f8c8d),
      snow: new THREE.Color(0xecf0f1)
    };
  }

  // Simplex-like noise function
  noise(x, y) {
    const seed = this.options.seed;
    const dot = x * 12.9898 + y * 78.233 + seed;
    const sin = Math.sin(dot) * 43758.5453;
    return sin - Math.floor(sin);
  }

  // Smooth noise with interpolation
  smoothNoise(x, y) {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = x0 + 1;
    const y1 = y0 + 1;
    
    const sx = x - x0;
    const sy = y - y0;
    
    const n00 = this.noise(x0, y0);
    const n10 = this.noise(x1, y0);
    const n01 = this.noise(x0, y1);
    const n11 = this.noise(x1, y1);
    
    const nx0 = n00 * (1 - sx) + n10 * sx;
    const nx1 = n01 * (1 - sx) + n11 * sx;
    
    return nx0 * (1 - sy) + nx1 * sy;
  }

  // Fractal Brownian Motion for natural-looking terrain
  fbm(x, y, octaves = 4) {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;
    
    for (let i = 0; i < octaves; i++) {
      value += amplitude * this.smoothNoise(x * frequency, y * frequency);
      maxValue += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    
    return value / maxValue;
  }

  generate() {
    this.generateHeightMap();
    this.createTerrainMesh();
    
    if (this.options.enableTrees) {
      this.generateVegetation();
    }
    
    if (this.options.enableBuildings) {
      this.generateBuildings();
    }

    log.debug('Terrain generated');
  }

  generateHeightMap() {
    const { size, resolution, maxElevation, baseElevation, launchSiteClearRadius } = this.options;
    
    this.heightMap = new Float32Array((resolution + 1) * (resolution + 1));
    
    // Launch site will be a flat plateau at a small elevation
    const launchPadElevation = 2; // 2 meters above base - visible but small
    
    for (let y = 0; y <= resolution; y++) {
      for (let x = 0; x <= resolution; x++) {
        const worldX = (x / resolution - 0.5) * size;
        const worldZ = (y / resolution - 0.5) * size;
        
        // Distance from center (launch site)
        const distFromCenter = Math.sqrt(worldX * worldX + worldZ * worldZ);
        
        // Base terrain elevation using FBM (already 0-1 range)
        const noise1 = this.fbm(x * 0.05, y * 0.05, 5);
        const noise2 = this.fbm(x * 0.01, y * 0.01, 3);
        let elevation = noise1 * maxElevation + noise2 * maxElevation * 0.5;
        
        // Create a flat plateau around launch site
        if (distFromCenter < launchSiteClearRadius) {
          // Inner area is flat at launch pad elevation
          const innerRadius = launchSiteClearRadius * 0.5;
          if (distFromCenter < innerRadius) {
            elevation = launchPadElevation;
          } else {
            // Smooth transition zone
            const t = (distFromCenter - innerRadius) / (launchSiteClearRadius - innerRadius);
            const smoothT = t * t * (3 - 2 * t); // smoothstep
            elevation = launchPadElevation + (elevation - launchPadElevation) * smoothT;
          }
        }
        
        // Ensure minimum elevation at edges (prevent floating edges)
        const edgeDist = Math.min(
          x, y, resolution - x, resolution - y
        ) / resolution;
        if (edgeDist < 0.1) {
          const edgeFactor = edgeDist / 0.1;
          elevation = elevation * edgeFactor;
        }
        
        this.heightMap[y * (resolution + 1) + x] = baseElevation + Math.max(0, elevation);
      }
    }
  }

  getHeightAt(worldX, worldZ) {
    if (!this.heightMap) return 0;
    
    const { size, resolution } = this.options;
    
    // Convert world coordinates to heightmap indices
    const u = (worldX / size + 0.5) * resolution;
    const v = (worldZ / size + 0.5) * resolution;
    
    const x0 = Math.floor(u);
    const z0 = Math.floor(v);
    const x1 = Math.min(x0 + 1, resolution);
    const z1 = Math.min(z0 + 1, resolution);
    
    const fx = u - x0;
    const fz = v - z0;
    
    const h00 = this.heightMap[z0 * (resolution + 1) + x0] || 0;
    const h10 = this.heightMap[z0 * (resolution + 1) + x1] || 0;
    const h01 = this.heightMap[z1 * (resolution + 1) + x0] || 0;
    const h11 = this.heightMap[z1 * (resolution + 1) + x1] || 0;
    
    // Bilinear interpolation
    const h0 = h00 * (1 - fx) + h10 * fx;
    const h1 = h01 * (1 - fx) + h11 * fx;
    
    return h0 * (1 - fz) + h1 * fz;
  }

  createTerrainMesh() {
    const { size, resolution, maxElevation } = this.options;
    
    // Create geometry
    const geometry = new THREE.PlaneGeometry(size, size, resolution, resolution);
    geometry.rotateX(-Math.PI / 2);
    
    // Apply height map to vertices
    const positions = geometry.attributes.position.array;
    const colors = [];
    
    for (let i = 0; i < positions.length; i += 3) {
      const x = Math.round((positions[i] / size + 0.5) * resolution);
      const z = Math.round((positions[i + 2] / size + 0.5) * resolution);
      const height = this.heightMap[z * (resolution + 1) + x] || 0;
      
      positions[i + 1] = height;
      
      // Calculate color based on elevation and slope
      const color = this.getTerrainColor(height, maxElevation);
      colors.push(color.r, color.g, color.b);
    }
    
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    
    // Create material with vertex colors
    const material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      side: THREE.DoubleSide
    });
    
    this.terrainMesh = new THREE.Mesh(geometry, material);
    this.terrainMesh.receiveShadow = true;
    this.scene.add(this.terrainMesh);
  }

  getTerrainColor(height, maxHeight) {
    const ratio = height / maxHeight;
    
    if (ratio < 0.1) {
      // Low areas - grass
      return this.biomeColors.grass.clone();
    } else if (ratio < 0.3) {
      // Mid-low - mix grass and forest
      return this.biomeColors.grass.clone().lerp(this.biomeColors.forest, (ratio - 0.1) / 0.2);
    } else if (ratio < 0.6) {
      // Mid - forest
      return this.biomeColors.forest.clone();
    } else if (ratio < 0.8) {
      // High - rock
      return this.biomeColors.forest.clone().lerp(this.biomeColors.rock, (ratio - 0.6) / 0.2);
    } else {
      // Very high - rock to snow
      return this.biomeColors.rock.clone().lerp(this.biomeColors.snow, (ratio - 0.8) / 0.2);
    }
  }

  generateVegetation() {
    const { size, treeCount, launchSiteClearRadius } = this.options;
    
    this.vegetationGroup = new THREE.Group();
    
    // Tree types
    const treeTypes = [
      { trunkHeight: 8, trunkRadius: 0.4, canopyRadius: 3, canopyHeight: 6, color: 0x228B22 },
      { trunkHeight: 12, trunkRadius: 0.5, canopyRadius: 2, canopyHeight: 8, color: 0x006400 },
      { trunkHeight: 6, trunkRadius: 0.3, canopyRadius: 4, canopyHeight: 4, color: 0x32CD32 }
    ];
    
    for (let i = 0; i < treeCount; i++) {
      // Random position
      const x = (Math.random() - 0.5) * size * 0.9;
      const z = (Math.random() - 0.5) * size * 0.9;
      
      // Skip if too close to launch site
      const distFromCenter = Math.sqrt(x * x + z * z);
      if (distFromCenter < launchSiteClearRadius * 1.5) continue;
      
      // Get terrain height at position
      const y = this.getHeightAt(x, z);
      
      // Don't place trees on very high terrain
      if (y > this.options.maxElevation * 0.7) continue;
      
      // Select random tree type
      const treeType = treeTypes[Math.floor(Math.random() * treeTypes.length)];
      const tree = this.createTree(treeType);
      
      // Random scale variation
      const scale = 0.7 + Math.random() * 0.6;
      tree.scale.setScalar(scale);
      
      tree.position.set(x, y, z);
      tree.rotation.y = Math.random() * Math.PI * 2;
      
      this.vegetationGroup.add(tree);
    }
    
    this.scene.add(this.vegetationGroup);
  }

  createTree(config) {
    const group = new THREE.Group();
    
    // Trunk
    const trunkGeometry = new THREE.CylinderGeometry(
      config.trunkRadius * 0.7,
      config.trunkRadius,
      config.trunkHeight,
      8
    );
    const trunkMaterial = new THREE.MeshLambertMaterial({ color: 0x8B4513 });
    const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunk.position.y = config.trunkHeight / 2;
    trunk.castShadow = true;
    group.add(trunk);
    
    // Canopy (cone shape for conifer, sphere for deciduous)
    const isConifer = Math.random() > 0.5;
    
    if (isConifer) {
      const canopyGeometry = new THREE.ConeGeometry(
        config.canopyRadius,
        config.canopyHeight,
        8
      );
      const canopyMaterial = new THREE.MeshLambertMaterial({ color: config.color });
      const canopy = new THREE.Mesh(canopyGeometry, canopyMaterial);
      canopy.position.y = config.trunkHeight + config.canopyHeight / 2 - 1;
      canopy.castShadow = true;
      group.add(canopy);
    } else {
      // Deciduous - multiple spheres for fuller canopy
      const canopyMaterial = new THREE.MeshLambertMaterial({ color: config.color });
      
      for (let i = 0; i < 5; i++) {
        const sphereRadius = config.canopyRadius * (0.6 + Math.random() * 0.4);
        const sphereGeometry = new THREE.SphereGeometry(sphereRadius, 8, 6);
        const sphere = new THREE.Mesh(sphereGeometry, canopyMaterial);
        sphere.position.set(
          (Math.random() - 0.5) * config.canopyRadius,
          config.trunkHeight + config.canopyHeight / 2 + (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * config.canopyRadius
        );
        sphere.castShadow = true;
        group.add(sphere);
      }
    }
    
    return group;
  }

  generateBuildings() {
    const { size, buildingCount, launchSiteClearRadius } = this.options;
    
    this.buildingsGroup = new THREE.Group();
    
    // Building configurations
    const buildingTypes = [
      { width: 20, depth: 15, height: 8, color: 0x808080, roofColor: 0x606060 },   // Small shed
      { width: 30, depth: 20, height: 12, color: 0x909090, roofColor: 0x505050 },  // Medium building
      { width: 15, depth: 15, height: 25, color: 0xa0a0a0, roofColor: 0x707070 },  // Tall building
      { width: 40, depth: 25, height: 6, color: 0x888888, roofColor: 0x444444 }    // Large low building
    ];
    
    // Place buildings in clusters
    const clusterCenters = [
      { x: size * 0.3, z: size * 0.2 },
      { x: -size * 0.25, z: size * 0.3 },
      { x: size * 0.2, z: -size * 0.35 }
    ];
    
    let placed = 0;
    
    for (const cluster of clusterCenters) {
      const buildingsInCluster = Math.floor(buildingCount / clusterCenters.length);
      
      for (let i = 0; i < buildingsInCluster && placed < buildingCount; i++) {
        const x = cluster.x + (Math.random() - 0.5) * 150;
        const z = cluster.z + (Math.random() - 0.5) * 150;
        
        // Skip if too close to launch site
        const distFromCenter = Math.sqrt(x * x + z * z);
        if (distFromCenter < launchSiteClearRadius * 2) continue;
        
        const y = this.getHeightAt(x, z);
        
        // Select building type
        const buildingType = buildingTypes[Math.floor(Math.random() * buildingTypes.length)];
        const building = this.createBuilding(buildingType);
        
        building.position.set(x, y, z);
        building.rotation.y = Math.random() * Math.PI * 2;
        
        this.buildingsGroup.add(building);
        placed++;
      }
    }
    
    this.scene.add(this.buildingsGroup);
  }

  createBuilding(config) {
    const group = new THREE.Group();
    
    // Main structure
    const bodyGeometry = new THREE.BoxGeometry(config.width, config.height, config.depth);
    const bodyMaterial = new THREE.MeshLambertMaterial({ color: config.color });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = config.height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    
    // Roof (slightly larger, darker)
    const roofGeometry = new THREE.BoxGeometry(
      config.width + 1,
      config.height * 0.1,
      config.depth + 1
    );
    const roofMaterial = new THREE.MeshLambertMaterial({ color: config.roofColor });
    const roof = new THREE.Mesh(roofGeometry, roofMaterial);
    roof.position.y = config.height + config.height * 0.05;
    roof.castShadow = true;
    group.add(roof);
    
    // Windows (simple dark rectangles on sides)
    const windowMaterial = new THREE.MeshBasicMaterial({ color: 0x333344 });
    const windowsPerSide = Math.floor(config.width / 8);
    const windowsVertical = Math.floor(config.height / 5);
    
    for (let wx = 0; wx < windowsPerSide; wx++) {
      for (let wy = 0; wy < windowsVertical; wy++) {
        const windowGeometry = new THREE.PlaneGeometry(2, 2.5);
        
        // Front windows
        const windowFront = new THREE.Mesh(windowGeometry, windowMaterial);
        windowFront.position.set(
          (wx - windowsPerSide / 2 + 0.5) * 6,
          3 + wy * 4,
          config.depth / 2 + 0.1
        );
        group.add(windowFront);
        
        // Back windows
        const windowBack = windowFront.clone();
        windowBack.position.z = -config.depth / 2 - 0.1;
        windowBack.rotation.y = Math.PI;
        group.add(windowBack);
      }
    }
    
    return group;
  }

  setVisible(visible) {
    if (this.terrainMesh) this.terrainMesh.visible = visible;
    if (this.vegetationGroup) this.vegetationGroup.visible = visible;
    if (this.buildingsGroup) this.buildingsGroup.visible = visible;
  }

  setTreesVisible(visible) {
    if (this.vegetationGroup) this.vegetationGroup.visible = visible;
  }

  setBuildingsVisible(visible) {
    if (this.buildingsGroup) this.buildingsGroup.visible = visible;
  }

  dispose() {
    if (this.terrainMesh) {
      this.scene.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
      this.terrainMesh.material.dispose();
    }
    
    if (this.vegetationGroup) {
      this.scene.remove(this.vegetationGroup);
      this.vegetationGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    
    if (this.buildingsGroup) {
      this.scene.remove(this.buildingsGroup);
      this.buildingsGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
  }
}

/**
 * Wind Visualization System
 * Displays animated wind vectors and streamlines
 */
class WindVisualizationSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = {
      gridSize: 1000,              // Area to cover
      gridResolution: 10,          // Number of arrows per side
      arrowSize: 15,               // Base arrow size
      maxAltitude: 500,            // Max height for wind visualization
      altitudeLayers: 5,           // Number of vertical layers
      animationSpeed: 1,           // Wind animation speed
      showStreamlines: true,
      showArrows: true,
      particleCount: 100,          // Wind particles for streamlines
      ...options
    };

    this.windData = null;
    this.arrowsGroup = null;
    this.streamlinesGroup = null;
    this.particles = [];
    this.isAnimating = false;
    
    // Default wind profile (will be updated with real data)
    this.windProfile = [
      { altitude: 0, speed: 5, direction: 45 },
      { altitude: 100, speed: 8, direction: 50 },
      { altitude: 200, speed: 12, direction: 55 },
      { altitude: 300, speed: 15, direction: 60 },
      { altitude: 500, speed: 20, direction: 65 }
    ];
  }

  setWindProfile(profile) {
    this.windProfile = profile || this.windProfile;
    this.updateVisualization();
  }

  setWindData(windData) {
    // Convert wind data to profile format
    if (windData) {
      this.windData = windData;
      
      if (windData.speed !== undefined && windData.direction !== undefined) {
        // Simple wind data - create profile with wind shear
        this.windProfile = this.generateWindProfile(
          windData.speed,
          windData.direction,
          windData.gustSpeed
        );
      } else if (Array.isArray(windData)) {
        this.windProfile = windData;
      }
    }
    
    this.updateVisualization();
  }

  generateWindProfile(surfaceSpeed, surfaceDirection, gustSpeed = 0) {
    // Generate realistic wind profile with altitude
    // Wind typically increases with altitude (wind shear)
    const profile = [];
    const altitudes = [0, 50, 100, 200, 300, 500, 750, 1000];
    
    altitudes.forEach(alt => {
      // Wind speed increases with altitude (power law)
      const speedMultiplier = Math.pow((alt + 10) / 10, 0.2);
      const speed = surfaceSpeed * speedMultiplier + (gustSpeed * Math.random() * 0.3);
      
      // Direction can veer with altitude (Ekman spiral effect)
      const directionShift = alt * 0.02; // ~20 degrees per 1000m
      const direction = (surfaceDirection + directionShift) % 360;
      
      profile.push({ altitude: alt, speed, direction });
    });
    
    return profile;
  }

  getWindAtAltitude(altitude) {
    if (!this.windProfile || this.windProfile.length === 0) {
      return { speed: 0, direction: 0 };
    }
    
    // Find surrounding altitude levels
    let lower = this.windProfile[0];
    let upper = this.windProfile[this.windProfile.length - 1];
    
    for (let i = 0; i < this.windProfile.length - 1; i++) {
      if (this.windProfile[i].altitude <= altitude && 
          this.windProfile[i + 1].altitude >= altitude) {
        lower = this.windProfile[i];
        upper = this.windProfile[i + 1];
        break;
      }
    }
    
    // Interpolate
    const range = upper.altitude - lower.altitude;
    const t = range > 0 ? (altitude - lower.altitude) / range : 0;
    
    return {
      speed: lower.speed + (upper.speed - lower.speed) * t,
      direction: lower.direction + (upper.direction - lower.direction) * t
    };
  }

  generate() {
    this.createArrows();
    this.createStreamlineParticles();
    log.debug('Wind visualization generated');
  }

  updateVisualization() {
    // Update arrow directions and sizes
    if (this.arrowsGroup) {
      this.arrowsGroup.children.forEach(arrow => {
        const altitude = arrow.userData.altitude || 0;
        const wind = this.getWindAtAltitude(altitude);
        
        // Update rotation to match wind direction
        arrow.rotation.y = -wind.direction * Math.PI / 180 + Math.PI / 2;
        
        // Scale by wind speed
        const scale = 0.5 + (wind.speed / 20) * 1.5;
        arrow.scale.setScalar(scale);
        
        // Color by speed (blue = light, red = strong)
        if (arrow.children[0]?.material) {
          const speedRatio = Math.min(wind.speed / 25, 1);
          const color = new THREE.Color().setHSL(0.6 - speedRatio * 0.6, 0.8, 0.5);
          arrow.children[0].material.color = color;
        }
      });
    }
  }

  createArrows() {
    const { gridSize, gridResolution, arrowSize, maxAltitude, altitudeLayers } = this.options;
    
    this.arrowsGroup = new THREE.Group();
    
    const spacing = gridSize / gridResolution;
    const halfGrid = gridSize / 2;
    
    for (let layer = 0; layer < altitudeLayers; layer++) {
      const altitude = (layer / (altitudeLayers - 1)) * maxAltitude;
      const wind = this.getWindAtAltitude(altitude);
      
      // Reduce density at higher altitudes
      const layerResolution = Math.max(3, gridResolution - layer * 2);
      const layerSpacing = gridSize / layerResolution;
      
      for (let x = 0; x < layerResolution; x++) {
        for (let z = 0; z < layerResolution; z++) {
          const worldX = (x - layerResolution / 2 + 0.5) * layerSpacing;
          const worldZ = (z - layerResolution / 2 + 0.5) * layerSpacing;
          
          // Skip arrows near center at ground level (launch site)
          const distFromCenter = Math.sqrt(worldX * worldX + worldZ * worldZ);
          if (layer === 0 && distFromCenter < 100) continue;
          
          const arrow = this.createWindArrow(arrowSize, wind);
          arrow.position.set(worldX, altitude, worldZ);
          arrow.userData.altitude = altitude;
          arrow.userData.basePosition = { x: worldX, z: worldZ };
          
          this.arrowsGroup.add(arrow);
        }
      }
    }
    
    this.scene.add(this.arrowsGroup);
  }

  createWindArrow(size, wind) {
    const group = new THREE.Group();
    
    // Arrow shaft
    const shaftLength = size * 0.7;
    const shaftGeometry = new THREE.CylinderGeometry(0.3, 0.3, shaftLength, 6);
    const speedRatio = Math.min(wind.speed / 25, 1);
    const color = new THREE.Color().setHSL(0.6 - speedRatio * 0.6, 0.8, 0.5);
    const material = new THREE.MeshBasicMaterial({ 
      color: color,
      transparent: true,
      opacity: 0.6
    });
    const shaft = new THREE.Mesh(shaftGeometry, material);
    shaft.rotation.z = Math.PI / 2;
    shaft.position.x = shaftLength / 2;
    group.add(shaft);
    
    // Arrow head
    const headGeometry = new THREE.ConeGeometry(1, size * 0.3, 6);
    const head = new THREE.Mesh(headGeometry, material.clone());
    head.rotation.z = -Math.PI / 2;
    head.position.x = shaftLength + size * 0.15;
    group.add(head);
    
    // Rotate to match wind direction (wind direction is where wind comes FROM)
    // So arrows point in direction of flow
    group.rotation.y = -wind.direction * Math.PI / 180 + Math.PI / 2;
    
    return group;
  }

  createStreamlineParticles() {
    const { gridSize, maxAltitude, particleCount } = this.options;
    
    this.streamlinesGroup = new THREE.Group();
    this.particles = [];
    
    // Particle geometry and material
    const particleGeometry = new THREE.SphereGeometry(1, 6, 4);
    const particleMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.4
    });
    
    // Create particles distributed in 3D space
    for (let i = 0; i < particleCount; i++) {
      const mesh = new THREE.Mesh(particleGeometry, particleMaterial.clone());
      
      // Random starting position
      mesh.position.set(
        (Math.random() - 0.5) * gridSize,
        Math.random() * maxAltitude,
        (Math.random() - 0.5) * gridSize
      );
      
      // Store particle data
      const particle = {
        mesh,
        trail: [],
        maxTrailLength: 20,
        age: Math.random() * 100 // Stagger particle ages
      };
      
      this.particles.push(particle);
      this.streamlinesGroup.add(mesh);
      
      // Create trail line
      const trailGeometry = new THREE.BufferGeometry();
      const trailMaterial = new THREE.LineBasicMaterial({
        color: 0x87ceeb,
        transparent: true,
        opacity: 0.3
      });
      particle.trailLine = new THREE.Line(trailGeometry, trailMaterial);
      this.streamlinesGroup.add(particle.trailLine);
    }
    
    this.scene.add(this.streamlinesGroup);
  }

  startAnimation() {
    this.isAnimating = true;
  }

  stopAnimation() {
    this.isAnimating = false;
  }

  update(deltaTime) {
    if (!this.isAnimating) return;
    
    const { gridSize, maxAltitude, animationSpeed } = this.options;
    const halfGrid = gridSize / 2;
    
    // Update particles
    this.particles.forEach(particle => {
      const pos = particle.mesh.position;
      const wind = this.getWindAtAltitude(pos.y);
      
      // Convert wind direction to velocity components
      const windRad = (wind.direction - 90) * Math.PI / 180;
      const vx = Math.cos(windRad) * wind.speed * animationSpeed * deltaTime;
      const vz = Math.sin(windRad) * wind.speed * animationSpeed * deltaTime;
      
      // Move particle
      pos.x += vx;
      pos.z += vz;
      
      // Add slight vertical oscillation
      pos.y += Math.sin(particle.age * 0.1) * 0.2 * deltaTime;
      
      // Update trail
      particle.trail.push({ x: pos.x, y: pos.y, z: pos.z });
      if (particle.trail.length > particle.maxTrailLength) {
        particle.trail.shift();
      }
      
      // Update trail line
      if (particle.trail.length > 1 && particle.trailLine) {
        const points = particle.trail.map(p => new THREE.Vector3(p.x, p.y, p.z));
        particle.trailLine.geometry.setFromPoints(points);
      }
      
      // Wrap particles at boundaries
      if (pos.x > halfGrid) pos.x = -halfGrid;
      if (pos.x < -halfGrid) pos.x = halfGrid;
      if (pos.z > halfGrid) pos.z = -halfGrid;
      if (pos.z < -halfGrid) pos.z = halfGrid;
      if (pos.y > maxAltitude) pos.y = 10;
      if (pos.y < 10) pos.y = maxAltitude;
      
      // Update particle size based on altitude
      const scale = 0.5 + (pos.y / maxAltitude) * 1;
      particle.mesh.scale.setScalar(scale);
      
      // Update particle color based on wind speed
      const speedRatio = Math.min(wind.speed / 25, 1);
      const color = new THREE.Color().setHSL(0.6 - speedRatio * 0.6, 0.9, 0.7);
      particle.mesh.material.color = color;
      particle.mesh.material.opacity = 0.3 + speedRatio * 0.4;
      
      particle.age += deltaTime;
    });
    
    // Subtle arrow animation (pulsing)
    if (this.arrowsGroup) {
      const time = performance.now() / 1000;
      this.arrowsGroup.children.forEach((arrow, i) => {
        const pulse = 0.9 + Math.sin(time * 2 + i * 0.1) * 0.1;
        const baseScale = arrow.userData.baseScale || arrow.scale.x;
        if (!arrow.userData.baseScale) arrow.userData.baseScale = baseScale;
        arrow.scale.setScalar(baseScale * pulse);
      });
    }
  }

  setArrowsVisible(visible) {
    if (this.arrowsGroup) this.arrowsGroup.visible = visible;
  }

  setStreamlinesVisible(visible) {
    if (this.streamlinesGroup) this.streamlinesGroup.visible = visible;
  }

  setVisible(visible) {
    this.setArrowsVisible(visible);
    this.setStreamlinesVisible(visible);
  }

  dispose() {
    if (this.arrowsGroup) {
      this.scene.remove(this.arrowsGroup);
      this.arrowsGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    
    if (this.streamlinesGroup) {
      this.scene.remove(this.streamlinesGroup);
      this.streamlinesGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    
    this.particles = [];
  }
}

/**
 * Telemetry HUD System
 * Displays live flight data overlay during replay
 */
class TelemetryHUD {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      position: 'top-left',       // top-left, top-right, bottom-left, bottom-right
      showAltitude: true,
      showVelocity: true,
      showAcceleration: true,
      showMach: true,
      showGForce: true,
      showAttitude: true,
      showTime: true,
      showPhase: true,
      showMaxQ: true,
      ...options
    };

    this.hudElement = null;
    this.isVisible = true;
    this.currentData = {};
    this.maxQ = 0;
    this.maxG = 0;
    this.maxVelocity = 0;
    this.maxAltitude = 0;

    this.createHUD();
    this.addStyles();

    log.debug('Telemetry HUD initialized');
  }

  createHUD() {
    this.hudElement = document.createElement('div');
    this.hudElement.className = 'telemetry-hud';
    this.hudElement.innerHTML = `
      <div class="hud-header">
        <span class="hud-title">📡 TELEMETRY</span>
        <span class="hud-status" id="hud-status">STANDBY</span>
      </div>
      <div class="hud-content">
        <div class="hud-section hud-time">
          <div class="hud-row">
            <span class="hud-label">T+</span>
            <span class="hud-value hud-large" id="hud-time">00:00.00</span>
          </div>
          <div class="hud-row">
            <span class="hud-label">Phase</span>
            <span class="hud-value" id="hud-phase">--</span>
          </div>
        </div>
        
        <div class="hud-section hud-primary">
          <div class="hud-row">
            <span class="hud-label">ALT</span>
            <span class="hud-value" id="hud-altitude">0</span>
            <span class="hud-unit">m</span>
          </div>
          <div class="hud-row">
            <span class="hud-label">VEL</span>
            <span class="hud-value" id="hud-velocity">0</span>
            <span class="hud-unit">m/s</span>
          </div>
          <div class="hud-row">
            <span class="hud-label">MACH</span>
            <span class="hud-value" id="hud-mach">0.000</span>
          </div>
        </div>

        <div class="hud-section hud-secondary">
          <div class="hud-row">
            <span class="hud-label">ACC</span>
            <span class="hud-value" id="hud-acceleration">0</span>
            <span class="hud-unit">m/s²</span>
          </div>
          <div class="hud-row">
            <span class="hud-label">G</span>
            <span class="hud-value" id="hud-gforce">0.0</span>
            <span class="hud-unit">g</span>
          </div>
          <div class="hud-row">
            <span class="hud-label">Q</span>
            <span class="hud-value" id="hud-dynpressure">0</span>
            <span class="hud-unit">Pa</span>
          </div>
        </div>

        <div class="hud-section hud-attitude">
          <div class="hud-attitude-display">
            <div class="attitude-indicator" id="attitude-indicator">
              <div class="attitude-horizon" id="attitude-horizon"></div>
              <div class="attitude-center"></div>
              <div class="attitude-wings"></div>
            </div>
          </div>
          <div class="hud-row">
            <span class="hud-label">PITCH</span>
            <span class="hud-value" id="hud-pitch">0°</span>
          </div>
        </div>

        <div class="hud-section hud-maxima">
          <div class="hud-row hud-max">
            <span class="hud-label">MAX ALT</span>
            <span class="hud-value" id="hud-max-alt">0</span>
            <span class="hud-unit">m</span>
          </div>
          <div class="hud-row hud-max">
            <span class="hud-label">MAX VEL</span>
            <span class="hud-value" id="hud-max-vel">0</span>
            <span class="hud-unit">m/s</span>
          </div>
          <div class="hud-row hud-max">
            <span class="hud-label">MAX G</span>
            <span class="hud-value" id="hud-max-g">0.0</span>
            <span class="hud-unit">g</span>
          </div>
        </div>
      </div>
    `;

    // Position based on option
    const positions = {
      'top-left': { top: '20px', left: '20px' },
      'top-right': { top: '20px', right: '20px' },
      'bottom-left': { bottom: '80px', left: '20px' },
      'bottom-right': { bottom: '80px', right: '20px' }
    };
    const pos = positions[this.options.position] || positions['top-left'];
    Object.assign(this.hudElement.style, pos);

    this.container.appendChild(this.hudElement);
  }

  addStyles() {
    if (document.getElementById('telemetry-hud-styles')) return;

    const style = document.createElement('style');
    style.id = 'telemetry-hud-styles';
    style.textContent = `
      .telemetry-hud {
        position: absolute;
        width: 200px;
        background: rgba(10, 15, 25, 0.9);
        border: 1px solid rgba(0, 200, 255, 0.4);
        border-radius: 8px;
        font-family: 'SF Mono', 'Consolas', 'Monaco', monospace;
        font-size: 12px;
        color: #00ff88;
        z-index: 1000;
        backdrop-filter: blur(10px);
        box-shadow: 0 0 20px rgba(0, 200, 255, 0.2);
        overflow: hidden;
      }

      .hud-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: rgba(0, 200, 255, 0.15);
        border-bottom: 1px solid rgba(0, 200, 255, 0.3);
      }

      .hud-title {
        font-weight: 600;
        font-size: 11px;
        letter-spacing: 1px;
        color: #00ccff;
      }

      .hud-status {
        font-size: 10px;
        padding: 2px 6px;
        border-radius: 3px;
        background: rgba(255, 255, 0, 0.2);
        color: #ffff00;
      }

      .hud-status.active {
        background: rgba(0, 255, 100, 0.2);
        color: #00ff64;
        animation: pulse 1s ease-in-out infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.6; }
      }

      .hud-content {
        padding: 10px 12px;
      }

      .hud-section {
        margin-bottom: 10px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(0, 200, 255, 0.15);
      }

      .hud-section:last-child {
        margin-bottom: 0;
        padding-bottom: 0;
        border-bottom: none;
      }

      .hud-row {
        display: flex;
        align-items: baseline;
        margin: 4px 0;
      }

      .hud-label {
        width: 55px;
        color: #888;
        font-size: 10px;
        letter-spacing: 0.5px;
      }

      .hud-value {
        flex: 1;
        text-align: right;
        font-size: 14px;
        font-weight: 600;
        color: #00ff88;
      }

      .hud-value.hud-large {
        font-size: 20px;
        color: #00ffcc;
      }

      .hud-unit {
        width: 30px;
        text-align: right;
        color: #666;
        font-size: 10px;
      }

      .hud-max .hud-value {
        color: #ffcc00;
        font-size: 12px;
      }

      /* Attitude Indicator */
      .hud-attitude-display {
        display: flex;
        justify-content: center;
        margin-bottom: 8px;
      }

      .attitude-indicator {
        width: 80px;
        height: 80px;
        border-radius: 50%;
        border: 2px solid #00ccff;
        background: linear-gradient(to bottom, #1a3a5c 0%, #1a3a5c 50%, #4a3020 50%, #4a3020 100%);
        position: relative;
        overflow: hidden;
      }

      .attitude-horizon {
        position: absolute;
        width: 100%;
        height: 100%;
        background: linear-gradient(to bottom, #4a90c2 0%, #4a90c2 50%, #8b6914 50%, #8b6914 100%);
        transition: transform 0.1s ease-out;
      }

      .attitude-center {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 8px;
        height: 8px;
        margin: -4px 0 0 -4px;
        background: #ff6600;
        border-radius: 50%;
        z-index: 10;
      }

      .attitude-wings {
        position: absolute;
        top: 50%;
        left: 10px;
        right: 10px;
        height: 2px;
        margin-top: -1px;
        background: #ff6600;
        z-index: 10;
      }

      .attitude-wings::before,
      .attitude-wings::after {
        content: '';
        position: absolute;
        top: -4px;
        width: 15px;
        height: 10px;
        border: 2px solid #ff6600;
        border-top: none;
      }

      .attitude-wings::before { left: 0; }
      .attitude-wings::after { right: 0; }

      /* Phase colors */
      .hud-phase-powered { color: #ff6600 !important; }
      .hud-phase-coasting { color: #00aaff !important; }
      .hud-phase-apogee { color: #ffff00 !important; }
      .hud-phase-descent { color: #9900ff !important; }
      .hud-phase-drogue { color: #ff9900 !important; }
      .hud-phase-main { color: #00ff00 !important; }
      .hud-phase-landed { color: #888888 !important; }

      /* Warning states */
      .hud-value.warning { color: #ffcc00 !important; }
      .hud-value.critical { color: #ff3300 !important; animation: blink 0.5s linear infinite; }

      @keyframes blink {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.3; }
      }
    `;
    document.head.appendChild(style);
  }

  update(data) {
    if (!this.isVisible || !this.hudElement) return;

    this.currentData = data;

    // Update status
    const statusEl = this.hudElement.querySelector('#hud-status');
    if (data.isPlaying) {
      statusEl.textContent = 'LIVE';
      statusEl.classList.add('active');
    } else {
      statusEl.textContent = 'PAUSED';
      statusEl.classList.remove('active');
    }

    // Time
    const time = data.time || 0;
    const mins = Math.floor(time / 60);
    const secs = (time % 60).toFixed(2).padStart(5, '0');
    this.hudElement.querySelector('#hud-time').textContent = `${mins.toString().padStart(2, '0')}:${secs}`;

    // Phase
    const phaseEl = this.hudElement.querySelector('#hud-phase');
    const phase = data.phase || 'STANDBY';
    phaseEl.textContent = phase.toUpperCase();
    phaseEl.className = 'hud-value hud-phase-' + phase.toLowerCase();

    // Primary values
    const altitude = data.altitude || 0;
    const velocity = data.velocity || 0;
    const mach = data.mach || (velocity / 343);

    this.hudElement.querySelector('#hud-altitude').textContent = altitude.toFixed(0);
    this.hudElement.querySelector('#hud-velocity').textContent = velocity.toFixed(1);
    this.hudElement.querySelector('#hud-mach').textContent = mach.toFixed(3);

    // Secondary values
    const acceleration = data.acceleration || 0;
    const gForce = Math.abs(acceleration) / 9.81;
    const dynamicPressure = data.dynamicPressure || (0.5 * 1.225 * velocity * velocity);

    this.hudElement.querySelector('#hud-acceleration').textContent = acceleration.toFixed(1);
    this.hudElement.querySelector('#hud-gforce').textContent = gForce.toFixed(1);
    this.hudElement.querySelector('#hud-dynpressure').textContent = dynamicPressure.toFixed(0);

    // G-Force warning colors
    const gEl = this.hudElement.querySelector('#hud-gforce');
    gEl.classList.remove('warning', 'critical');
    if (gForce > 15) gEl.classList.add('critical');
    else if (gForce > 10) gEl.classList.add('warning');

    // Attitude indicator
    const pitch = data.pitch || 0;
    const horizon = this.hudElement.querySelector('#attitude-horizon');
    if (horizon) {
      // Pitch moves horizon up/down, 90° = full displacement
      const displacement = (pitch / 90) * 40;
      horizon.style.transform = `translateY(${displacement}px)`;
    }
    this.hudElement.querySelector('#hud-pitch').textContent = `${pitch.toFixed(0)}°`;

    // Update maxima
    if (altitude > this.maxAltitude) this.maxAltitude = altitude;
    if (velocity > this.maxVelocity) this.maxVelocity = velocity;
    if (gForce > this.maxG) this.maxG = gForce;

    this.hudElement.querySelector('#hud-max-alt').textContent = this.maxAltitude.toFixed(0);
    this.hudElement.querySelector('#hud-max-vel').textContent = this.maxVelocity.toFixed(0);
    this.hudElement.querySelector('#hud-max-g').textContent = this.maxG.toFixed(1);
  }

  reset() {
    this.maxAltitude = 0;
    this.maxVelocity = 0;
    this.maxG = 0;
    this.maxQ = 0;
    this.update({ time: 0, isPlaying: false });
  }

  setVisible(visible) {
    this.isVisible = visible;
    if (this.hudElement) {
      this.hudElement.style.display = visible ? 'block' : 'none';
    }
  }

  setPosition(position) {
    this.options.position = position;
    const positions = {
      'top-left': { top: '20px', left: '20px', right: 'auto', bottom: 'auto' },
      'top-right': { top: '20px', right: '20px', left: 'auto', bottom: 'auto' },
      'bottom-left': { bottom: '80px', left: '20px', top: 'auto', right: 'auto' },
      'bottom-right': { bottom: '80px', right: '20px', top: 'auto', left: 'auto' }
    };
    const pos = positions[position] || positions['top-left'];
    Object.assign(this.hudElement.style, pos);
  }

  dispose() {
    if (this.hudElement && this.hudElement.parentNode) {
      this.hudElement.parentNode.removeChild(this.hudElement);
    }
  }
}

/**
 * Force Vector Visualization System
 * Shows thrust, drag, gravity, and velocity arrows on the rocket
 */
class ForceVectorSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = {
      showThrust: true,
      showDrag: true,
      showGravity: true,
      showVelocity: true,
      showNetForce: false,
      arrowScale: 0.05,        // Scale factor for force magnitude to arrow length
      velocityScale: 0.1,      // Scale factor for velocity arrow
      maxArrowLength: 30,      // Maximum arrow length in meters
      ...options
    };

    this.vectorGroup = null;
    this.thrustArrow = null;
    this.dragArrow = null;
    this.gravityArrow = null;
    this.velocityArrow = null;
    this.netForceArrow = null;
    this.labels = [];
    this.isVisible = true;

    this.createVectors();
    log.debug('Force Vector System initialized');
  }

  createVectors() {
    this.vectorGroup = new THREE.Group();
    this.vectorGroup.name = 'forceVectors';

    // Create arrow helpers for each force
    // Thrust - Orange pointing up
    this.thrustArrow = this.createArrow(0xff6600, 'THRUST');
    this.vectorGroup.add(this.thrustArrow.group);

    // Drag - Red pointing down (opposite velocity)
    this.dragArrow = this.createArrow(0xff0000, 'DRAG');
    this.vectorGroup.add(this.dragArrow.group);

    // Gravity - Purple pointing down
    this.gravityArrow = this.createArrow(0x9900ff, 'WEIGHT');
    this.vectorGroup.add(this.gravityArrow.group);

    // Velocity - Cyan pointing in direction of travel
    this.velocityArrow = this.createArrow(0x00ffff, 'VEL');
    this.vectorGroup.add(this.velocityArrow.group);

    // Net Force - White
    this.netForceArrow = this.createArrow(0xffffff, 'NET');
    this.netForceArrow.group.visible = this.options.showNetForce;
    this.vectorGroup.add(this.netForceArrow.group);

    this.scene.add(this.vectorGroup);
  }

  createArrow(color, label) {
    const group = new THREE.Group();

    // Arrow shaft
    const shaftGeometry = new THREE.CylinderGeometry(0.15, 0.15, 1, 8);
    const shaftMaterial = new THREE.MeshBasicMaterial({ 
      color: color,
      transparent: true,
      opacity: 0.8
    });
    const shaft = new THREE.Mesh(shaftGeometry, shaftMaterial);
    shaft.position.y = 0.5;
    group.add(shaft);

    // Arrow head
    const headGeometry = new THREE.ConeGeometry(0.4, 1, 8);
    const headMaterial = new THREE.MeshBasicMaterial({ color: color });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.position.y = 1;
    group.add(head);

    // Label sprite
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(label, 64, 40);

    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({ 
      map: texture,
      transparent: true
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(4, 2, 1);
    sprite.position.y = 2;
    group.add(sprite);

    return { group, shaft, head, sprite, color };
  }

  update(rocketPosition, data) {
    if (!this.isVisible || !this.vectorGroup) return;

    const { thrust, drag, mass, velocity, velocityVector, pitch } = data;
    const gravity = (mass || 1) * 9.81;

    // Position all vectors at rocket location
    this.vectorGroup.position.copy(rocketPosition);

    // Calculate arrow lengths (clamped)
    const thrustLength = Math.min(
      (thrust || 0) * this.options.arrowScale,
      this.options.maxArrowLength
    );
    const dragLength = Math.min(
      (drag || 0) * this.options.arrowScale,
      this.options.maxArrowLength
    );
    const gravityLength = Math.min(
      gravity * this.options.arrowScale,
      this.options.maxArrowLength
    );
    const velocityLength = Math.min(
      (velocity || 0) * this.options.velocityScale,
      this.options.maxArrowLength
    );

    // Thrust arrow - points in rocket's up direction
    if (this.options.showThrust && thrust > 0) {
      this.updateArrowLength(this.thrustArrow, thrustLength);
      this.thrustArrow.group.visible = true;
      // Rotate to match rocket pitch
      const pitchRad = ((pitch || 90) - 90) * Math.PI / 180;
      this.thrustArrow.group.rotation.z = -pitchRad;
    } else {
      this.thrustArrow.group.visible = false;
    }

    // Drag arrow - opposite to velocity direction
    if (this.options.showDrag && drag > 0 && velocity > 1) {
      this.updateArrowLength(this.dragArrow, dragLength);
      this.dragArrow.group.visible = true;
      // Point opposite to velocity
      if (velocityVector) {
        const dir = new THREE.Vector3(velocityVector.x, velocityVector.y, velocityVector.z || 0).normalize();
        this.dragArrow.group.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.negate()
        );
      } else {
        // Assume vertical
        const vy = data.verticalVelocity || velocity;
        this.dragArrow.group.rotation.z = vy >= 0 ? Math.PI : 0;
      }
    } else {
      this.dragArrow.group.visible = false;
    }

    // Gravity arrow - always points down
    if (this.options.showGravity) {
      this.updateArrowLength(this.gravityArrow, gravityLength);
      this.gravityArrow.group.visible = true;
      this.gravityArrow.group.rotation.z = Math.PI; // Point down
    } else {
      this.gravityArrow.group.visible = false;
    }

    // Velocity arrow - points in direction of travel
    if (this.options.showVelocity && velocity > 1) {
      this.updateArrowLength(this.velocityArrow, velocityLength);
      this.velocityArrow.group.visible = true;
      if (velocityVector) {
        const dir = new THREE.Vector3(velocityVector.x, velocityVector.y, velocityVector.z || 0).normalize();
        this.velocityArrow.group.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir
        );
      }
    } else {
      this.velocityArrow.group.visible = false;
    }

    // Net force (optional)
    if (this.options.showNetForce) {
      const netForce = (thrust || 0) - (drag || 0) - gravity;
      const netLength = Math.min(
        Math.abs(netForce) * this.options.arrowScale,
        this.options.maxArrowLength
      );
      this.updateArrowLength(this.netForceArrow, netLength);
      this.netForceArrow.group.rotation.z = netForce >= 0 ? 0 : Math.PI;
      this.netForceArrow.group.visible = true;
    }
  }

  updateArrowLength(arrow, length) {
    if (length < 0.5) {
      arrow.group.visible = false;
      return;
    }

    // Scale shaft
    arrow.shaft.scale.y = length;
    arrow.shaft.position.y = length / 2;

    // Position head at end of shaft
    arrow.head.position.y = length;

    // Position label above head
    arrow.sprite.position.y = length + 1.5;
  }

  setVisible(visible) {
    this.isVisible = visible;
    if (this.vectorGroup) {
      this.vectorGroup.visible = visible;
    }
  }

  setForceVisible(force, visible) {
    switch (force) {
      case 'thrust':
        this.options.showThrust = visible;
        break;
      case 'drag':
        this.options.showDrag = visible;
        break;
      case 'gravity':
        this.options.showGravity = visible;
        break;
      case 'velocity':
        this.options.showVelocity = visible;
        break;
      case 'net':
        this.options.showNetForce = visible;
        if (this.netForceArrow) this.netForceArrow.group.visible = visible;
        break;
    }
  }

  dispose() {
    if (this.vectorGroup) {
      this.scene.remove(this.vectorGroup);
      this.vectorGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
    }
  }
}

/**
 * Mach Cone Effect System
 * Displays shock wave visualization when rocket goes supersonic
 */
class MachConeEffect {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = {
      minMach: 0.95,           // Start showing at Mach 0.95 (transonic)
      maxOpacity: 0.4,
      coneLength: 15,
      coneRadius: 8,
      pulseSpeed: 2,
      ...options
    };

    this.coneGroup = null;
    this.shockCone = null;
    this.shockRings = [];
    this.isActive = false;
    this.currentMach = 0;

    this.createEffect();
    log.debug('Mach Cone Effect initialized');
  }

  createEffect() {
    this.coneGroup = new THREE.Group();
    this.coneGroup.name = 'machConeEffect';

    // Main shock cone
    const coneGeometry = new THREE.ConeGeometry(
      this.options.coneRadius,
      this.options.coneLength,
      32,
      1,
      true
    );
    const coneMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    this.shockCone = new THREE.Mesh(coneGeometry, coneMaterial);
    this.shockCone.rotation.x = Math.PI; // Point backward
    this.shockCone.position.y = -this.options.coneLength / 2;
    this.coneGroup.add(this.shockCone);

    // Shock wave rings
    for (let i = 0; i < 5; i++) {
      const ringGeometry = new THREE.RingGeometry(
        2 + i * 1.5,
        2.5 + i * 1.5,
        32
      );
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: 0x88ccff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -i * 3;
      ring.userData.baseY = -i * 3;
      ring.userData.phase = i * 0.5;
      this.shockRings.push(ring);
      this.coneGroup.add(ring);
    }

    // Bow shock wave (compression wave ahead of rocket)
    const bowGeometry = new THREE.SphereGeometry(3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const bowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });
    this.bowShock = new THREE.Mesh(bowGeometry, bowMaterial);
    this.bowShock.position.y = 2;
    this.coneGroup.add(this.bowShock);

    this.coneGroup.visible = false;
    this.scene.add(this.coneGroup);
  }

  update(rocketPosition, mach, deltaTime) {
    this.currentMach = mach;

    // Check if supersonic
    if (mach >= this.options.minMach) {
      if (!this.isActive) {
        this.isActive = true;
        this.coneGroup.visible = true;
      }

      // Position at rocket
      this.coneGroup.position.copy(rocketPosition);

      // Calculate effect intensity based on Mach number
      const intensity = Math.min((mach - this.options.minMach) / 0.5, 1);
      const opacity = intensity * this.options.maxOpacity;

      // Mach cone angle: sin(θ) = 1/M
      // At Mach 1, cone is 90° (perpendicular)
      // At Mach 2, cone is 30°
      const coneAngle = mach > 1 ? Math.asin(1 / mach) : Math.PI / 2;
      
      // Update cone shape based on Mach number
      this.shockCone.material.opacity = opacity;
      const coneScale = 1 + (mach - 1) * 0.5;
      this.shockCone.scale.set(
        Math.tan(coneAngle) * 2,
        1 + (mach - 1) * 0.3,
        Math.tan(coneAngle) * 2
      );

      // Animate shock rings
      const time = performance.now() / 1000;
      this.shockRings.forEach((ring, i) => {
        const phase = time * this.options.pulseSpeed + ring.userData.phase;
        const pulse = (Math.sin(phase) + 1) / 2;
        
        ring.material.opacity = opacity * (1 - i * 0.15) * pulse;
        ring.scale.setScalar(1 + pulse * 0.3);
        ring.position.y = ring.userData.baseY - pulse * 2;
      });

      // Bow shock effect (stronger at higher Mach)
      if (mach > 1.2) {
        const bowIntensity = Math.min((mach - 1.2) / 0.8, 1);
        this.bowShock.material.opacity = bowIntensity * 0.3;
        this.bowShock.scale.setScalar(1 + Math.sin(time * 3) * 0.1);
      } else {
        this.bowShock.material.opacity = 0;
      }

    } else {
      if (this.isActive) {
        this.isActive = false;
        this.coneGroup.visible = false;
      }
    }
  }

  setVisible(visible) {
    if (!visible) {
      this.coneGroup.visible = false;
      this.isActive = false;
    }
    // If visible, it will be shown when update() detects supersonic
  }

  getMachStatus() {
    if (this.currentMach >= 1.0) return 'SUPERSONIC';
    if (this.currentMach >= 0.8) return 'TRANSONIC';
    return 'SUBSONIC';
  }

  dispose() {
    if (this.coneGroup) {
      this.scene.remove(this.coneGroup);
      this.coneGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
  }
}

/**
 * Multiple Trajectory System
 * Allows displaying and comparing multiple flight trajectories
 */
class MultiTrajectorySystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = {
      maxTrajectories: 10,
      defaultColors: [
        0xff4444, // Red
        0x44ff44, // Green
        0x4444ff, // Blue
        0xffff44, // Yellow
        0xff44ff, // Magenta
        0x44ffff, // Cyan
        0xff8844, // Orange
        0x8844ff, // Purple
        0x44ff88, // Spring green
        0xff4488  // Pink
      ],
      lineWidth: 2,
      opacity: 0.8,
      showLabels: true,
      ...options
    };

    this.trajectories = new Map(); // id -> trajectory data
    this.trajectoryMeshes = new Map(); // id -> THREE objects
    this.legendElement = null;
    this.container = null;

    log.debug('Multi-Trajectory System initialized');
  }

  setContainer(container) {
    this.container = container;
    this.createLegend();
  }

  createLegend() {
    if (!this.container || this.legendElement) return;

    this.legendElement = document.createElement('div');
    this.legendElement.className = 'trajectory-legend';
    this.legendElement.innerHTML = `
      <div class="legend-header">
        <span>📊 Trajectories</span>
        <button class="legend-clear-btn" title="Clear all">×</button>
      </div>
      <div class="legend-content"></div>
    `;
    this.legendElement.style.cssText = `
      position: absolute;
      bottom: 80px;
      right: 20px;
      background: rgba(20, 25, 35, 0.9);
      border: 1px solid rgba(100, 150, 255, 0.3);
      border-radius: 8px;
      font-family: -apple-system, sans-serif;
      font-size: 12px;
      color: #fff;
      z-index: 1000;
      min-width: 180px;
      display: none;
    `;

    // Add styles
    this.addStyles();

    this.container.appendChild(this.legendElement);

    // Clear button handler
    this.legendElement.querySelector('.legend-clear-btn').addEventListener('click', () => {
      this.clearAll();
    });
  }

  addStyles() {
    if (document.getElementById('multi-trajectory-styles')) return;

    const style = document.createElement('style');
    style.id = 'multi-trajectory-styles';
    style.textContent = `
      .trajectory-legend .legend-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background: rgba(100, 150, 255, 0.15);
        border-bottom: 1px solid rgba(100, 150, 255, 0.2);
        font-weight: 600;
      }

      .legend-clear-btn {
        background: none;
        border: none;
        color: #888;
        font-size: 16px;
        cursor: pointer;
        padding: 0 4px;
      }

      .legend-clear-btn:hover { color: #ff6666; }

      .trajectory-legend .legend-content {
        padding: 8px;
        max-height: 200px;
        overflow-y: auto;
      }

      .legend-item {
        display: flex;
        align-items: center;
        padding: 6px 4px;
        border-radius: 4px;
        cursor: pointer;
      }

      .legend-item:hover { background: rgba(255, 255, 255, 0.1); }

      .legend-color {
        width: 12px;
        height: 12px;
        border-radius: 2px;
        margin-right: 8px;
        flex-shrink: 0;
      }

      .legend-name {
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .legend-stats {
        font-size: 10px;
        color: #888;
        margin-left: 8px;
      }

      .legend-remove {
        background: none;
        border: none;
        color: #666;
        font-size: 14px;
        cursor: pointer;
        padding: 0 4px;
        margin-left: 4px;
      }

      .legend-remove:hover { color: #ff4444; }

      .legend-item.hidden { opacity: 0.4; }
    `;
    document.head.appendChild(style);
  }

  addTrajectory(id, trajectoryData, options = {}) {
    if (this.trajectories.size >= this.options.maxTrajectories) {
      // Remove oldest
      const firstKey = this.trajectories.keys().next().value;
      this.removeTrajectory(firstKey);
    }

    const color = options.color || this.options.defaultColors[this.trajectories.size % this.options.defaultColors.length];
    const name = options.name || `Trajectory ${this.trajectories.size + 1}`;

    // Store trajectory data
    this.trajectories.set(id, {
      data: trajectoryData,
      color: color,
      name: name,
      visible: true,
      apogee: trajectoryData.apogee || 0,
      maxVelocity: trajectoryData.maxVelocity || 0
    });

    // Create 3D visualization
    this.createTrajectoryMesh(id, trajectoryData, color);

    // Update legend
    this.updateLegend();

    log.debug('Added trajectory:', id, name);
    return id;
  }

  createTrajectoryMesh(id, trajectoryData, color) {
    const group = new THREE.Group();
    group.name = `trajectory_${id}`;

    if (!trajectoryData.trajectory || trajectoryData.trajectory.length < 2) {
      return;
    }

    // Create points
    const points = trajectoryData.trajectory.map(point => {
      return new THREE.Vector3(
        point.x || 0,
        point.altitude || 0,
        point.y || 0
      );
    });

    // Line
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const lineMaterial = new THREE.LineBasicMaterial({
      color: color,
      transparent: true,
      opacity: this.options.opacity,
      linewidth: this.options.lineWidth
    });
    const line = new THREE.Line(lineGeometry, lineMaterial);
    group.add(line);

    // Tube for better visibility
    if (points.length > 2) {
      try {
        const curve = new THREE.CatmullRomCurve3(points);
        const tubeGeometry = new THREE.TubeGeometry(curve, points.length, 0.3, 8, false);
        const tubeMaterial = new THREE.MeshBasicMaterial({
          color: color,
          transparent: true,
          opacity: this.options.opacity * 0.5
        });
        const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
        group.add(tube);
      } catch (e) {
        // Curve creation can fail with certain point configurations
      }
    }

    // Apogee marker
    if (trajectoryData.apogee && trajectoryData.apogeeTime) {
      const apogeePoint = trajectoryData.trajectory.find(p => 
        Math.abs(p.altitude - trajectoryData.apogee) < 1
      );
      if (apogeePoint) {
        const markerGeometry = new THREE.SphereGeometry(2, 16, 12);
        const markerMaterial = new THREE.MeshBasicMaterial({ color: color });
        const marker = new THREE.Mesh(markerGeometry, markerMaterial);
        marker.position.set(apogeePoint.x || 0, trajectoryData.apogee, apogeePoint.y || 0);
        group.add(marker);
      }
    }

    // Landing marker
    const lastPoint = trajectoryData.trajectory[trajectoryData.trajectory.length - 1];
    if (lastPoint) {
      const landingGeometry = new THREE.RingGeometry(1, 2, 16);
      const landingMaterial = new THREE.MeshBasicMaterial({
        color: color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.6
      });
      const landing = new THREE.Mesh(landingGeometry, landingMaterial);
      landing.rotation.x = -Math.PI / 2;
      landing.position.set(lastPoint.x || 0, 0.1, lastPoint.y || 0);
      group.add(landing);
    }

    this.scene.add(group);
    this.trajectoryMeshes.set(id, group);
  }

  removeTrajectory(id) {
    // Remove from scene
    const mesh = this.trajectoryMeshes.get(id);
    if (mesh) {
      this.scene.remove(mesh);
      mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
      this.trajectoryMeshes.delete(id);
    }

    // Remove from data
    this.trajectories.delete(id);

    // Update legend
    this.updateLegend();
  }

  setTrajectoryVisible(id, visible) {
    const traj = this.trajectories.get(id);
    if (traj) {
      traj.visible = visible;
    }

    const mesh = this.trajectoryMeshes.get(id);
    if (mesh) {
      mesh.visible = visible;
    }

    this.updateLegend();
  }

  toggleTrajectory(id) {
    const traj = this.trajectories.get(id);
    if (traj) {
      this.setTrajectoryVisible(id, !traj.visible);
    }
  }

  updateLegend() {
    if (!this.legendElement) return;

    const content = this.legendElement.querySelector('.legend-content');
    content.innerHTML = '';

    if (this.trajectories.size === 0) {
      this.legendElement.style.display = 'none';
      return;
    }

    this.legendElement.style.display = 'block';

    this.trajectories.forEach((traj, id) => {
      const item = document.createElement('div');
      item.className = `legend-item ${traj.visible ? '' : 'hidden'}`;
      item.innerHTML = `
        <div class="legend-color" style="background: #${traj.color.toString(16).padStart(6, '0')}"></div>
        <span class="legend-name">${traj.name}</span>
        <span class="legend-stats">${traj.apogee.toFixed(0)}m</span>
        <button class="legend-remove" title="Remove">×</button>
      `;

      // Click to toggle visibility
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('legend-remove')) {
          this.toggleTrajectory(id);
        }
      });

      // Remove button
      item.querySelector('.legend-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeTrajectory(id);
      });

      content.appendChild(item);
    });
  }

  clearAll() {
    this.trajectories.forEach((_, id) => {
      this.removeTrajectory(id);
    });
  }

  getTrajectoryCount() {
    return this.trajectories.size;
  }

  setAllVisible(visible) {
    this.trajectories.forEach((_, id) => {
      this.setTrajectoryVisible(id, visible);
    });
  }

  dispose() {
    this.clearAll();
    if (this.legendElement && this.legendElement.parentNode) {
      this.legendElement.parentNode.removeChild(this.legendElement);
    }
  }
}

/**
 * Safe Zone Overlay System
 * Shows predicted landing zones, keep-out boundaries, and safety radii
 */
class SafeZoneOverlay {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = {
      launchRadius: 30,           // Minimum safe distance from pad (meters)
      warningRadius: 100,         // Warning zone radius
      keepOutZones: [],           // Array of { x, z, radius, label }
      showLandingEllipse: true,
      showSafetyCircles: true,
      showKeepOutZones: true,
      landingColor: 0x00ff00,
      warningColor: 0xffff00,
      dangerColor: 0xff0000,
      ...options
    };

    this.overlayGroup = null;
    this.launchSafetyCircle = null;
    this.warningCircle = null;
    this.landingEllipse = null;
    this.keepOutMarkers = [];
    this.boundaryLine = null;
    this.isVisible = true;

    this.create();
    log.debug('Safe Zone Overlay initialized');
  }

  create() {
    this.overlayGroup = new THREE.Group();
    this.overlayGroup.name = 'safeZoneOverlay';

    // Create launch site safety circles
    if (this.options.showSafetyCircles) {
      this.createSafetyCircles();
    }

    this.scene.add(this.overlayGroup);
  }

  createSafetyCircles() {
    // Inner danger zone (launch radius)
    const dangerGeometry = new THREE.RingGeometry(0, this.options.launchRadius, 32);
    const dangerMaterial = new THREE.MeshBasicMaterial({
      color: this.options.dangerColor,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide
    });
    const dangerZone = new THREE.Mesh(dangerGeometry, dangerMaterial);
    dangerZone.rotation.x = -Math.PI / 2;
    dangerZone.position.y = 0.1;
    this.overlayGroup.add(dangerZone);

    // Danger zone border
    const dangerRingGeometry = new THREE.RingGeometry(
      this.options.launchRadius - 0.5,
      this.options.launchRadius + 0.5,
      64
    );
    const dangerRingMaterial = new THREE.MeshBasicMaterial({
      color: this.options.dangerColor,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    const dangerRing = new THREE.Mesh(dangerRingGeometry, dangerRingMaterial);
    dangerRing.rotation.x = -Math.PI / 2;
    dangerRing.position.y = 0.15;
    this.overlayGroup.add(dangerRing);

    // Warning zone ring
    const warningGeometry = new THREE.RingGeometry(
      this.options.launchRadius,
      this.options.warningRadius,
      64
    );
    const warningMaterial = new THREE.MeshBasicMaterial({
      color: this.options.warningColor,
      transparent: true,
      opacity: 0.08,
      side: THREE.DoubleSide
    });
    const warningZone = new THREE.Mesh(warningGeometry, warningMaterial);
    warningZone.rotation.x = -Math.PI / 2;
    warningZone.position.y = 0.05;
    this.overlayGroup.add(warningZone);

    // Warning zone outer border
    const warningRingGeometry = new THREE.RingGeometry(
      this.options.warningRadius - 0.3,
      this.options.warningRadius + 0.3,
      64
    );
    const warningRingMaterial = new THREE.MeshBasicMaterial({
      color: this.options.warningColor,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    });
    const warningRing = new THREE.Mesh(warningRingGeometry, warningRingMaterial);
    warningRing.rotation.x = -Math.PI / 2;
    warningRing.position.y = 0.1;
    this.overlayGroup.add(warningRing);

    // Add dashed radial lines
    this.addRadialLines();
  }

  addRadialLines() {
    const numLines = 8;
    const lineGeometry = new THREE.BufferGeometry();
    const positions = [];

    for (let i = 0; i < numLines; i++) {
      const angle = (i / numLines) * Math.PI * 2;
      const x1 = Math.cos(angle) * this.options.launchRadius;
      const z1 = Math.sin(angle) * this.options.launchRadius;
      const x2 = Math.cos(angle) * this.options.warningRadius;
      const z2 = Math.sin(angle) * this.options.warningRadius;
      
      positions.push(x1, 0.2, z1, x2, 0.2, z2);
    }

    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    
    const lineMaterial = new THREE.LineDashedMaterial({
      color: this.options.warningColor,
      dashSize: 3,
      gapSize: 2,
      transparent: true,
      opacity: 0.5
    });

    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    lines.computeLineDistances();
    this.overlayGroup.add(lines);
  }

  setLandingPrediction(data) {
    // Remove existing landing ellipse
    if (this.landingEllipse) {
      this.overlayGroup.remove(this.landingEllipse);
      this.landingEllipse.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }

    if (!this.options.showLandingEllipse || !data) return;

    const { centerX, centerZ, radiusX, radiusZ, confidence } = data;

    // Create landing prediction ellipse
    this.landingEllipse = new THREE.Group();

    // Confidence-based ellipse (1-sigma, 2-sigma, 3-sigma)
    const sigmaLevels = [
      { sigma: 1, opacity: 0.3, label: '68%' },
      { sigma: 2, opacity: 0.15, label: '95%' },
      { sigma: 3, opacity: 0.08, label: '99%' }
    ];

    sigmaLevels.forEach(level => {
      const ellipseCurve = new THREE.EllipseCurve(
        0, 0,
        radiusX * level.sigma,
        radiusZ * level.sigma,
        0, 2 * Math.PI,
        false, 0
      );

      const points = ellipseCurve.getPoints(64);
      const points3D = points.map(p => new THREE.Vector3(p.x, 0, p.y));
      
      // Filled ellipse
      const shape = new THREE.Shape();
      points.forEach((p, i) => {
        if (i === 0) shape.moveTo(p.x, p.y);
        else shape.lineTo(p.x, p.y);
      });
      shape.closePath();

      const shapeGeometry = new THREE.ShapeGeometry(shape);
      const shapeMaterial = new THREE.MeshBasicMaterial({
        color: this.options.landingColor,
        transparent: true,
        opacity: level.opacity,
        side: THREE.DoubleSide
      });
      const ellipseMesh = new THREE.Mesh(shapeGeometry, shapeMaterial);
      ellipseMesh.rotation.x = -Math.PI / 2;
      ellipseMesh.position.y = 0.1;
      this.landingEllipse.add(ellipseMesh);

      // Ellipse outline
      const outlineGeometry = new THREE.BufferGeometry().setFromPoints(points3D);
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: this.options.landingColor,
        transparent: true,
        opacity: 0.8 - level.sigma * 0.2
      });
      const outline = new THREE.LineLoop(outlineGeometry, outlineMaterial);
      outline.position.y = 0.15;
      this.landingEllipse.add(outline);
    });

    // Center marker (X marks the spot)
    const crossSize = Math.min(radiusX, radiusZ) * 0.2;
    const crossGeometry = new THREE.BufferGeometry();
    crossGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      -crossSize, 0.2, -crossSize, crossSize, 0.2, crossSize,
      -crossSize, 0.2, crossSize, crossSize, 0.2, -crossSize
    ], 3));
    const crossMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
    const cross = new THREE.LineSegments(crossGeometry, crossMaterial);
    this.landingEllipse.add(cross);

    // Position at landing center
    this.landingEllipse.position.set(centerX || 0, 0, centerZ || 0);
    this.overlayGroup.add(this.landingEllipse);
  }

  addKeepOutZone(zone) {
    const { x, z, radius, label, type } = zone;

    const keepOutGroup = new THREE.Group();

    // Determine color based on type
    let color = this.options.dangerColor;
    if (type === 'spectators') color = 0xff8800;
    else if (type === 'parking') color = 0x0088ff;
    else if (type === 'buildings') color = 0xff00ff;

    // Keep out circle
    const circleGeometry = new THREE.RingGeometry(radius - 1, radius, 32);
    const circleMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide
    });
    const circle = new THREE.Mesh(circleGeometry, circleMaterial);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = 0.2;
    keepOutGroup.add(circle);

    // Fill
    const fillGeometry = new THREE.CircleGeometry(radius - 1, 32);
    const fillMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide
    });
    const fill = new THREE.Mesh(fillGeometry, fillMaterial);
    fill.rotation.x = -Math.PI / 2;
    fill.position.y = 0.15;
    keepOutGroup.add(fill);

    // Warning stripes (diagonal lines)
    const stripeCount = 8;
    for (let i = 0; i < stripeCount; i++) {
      const angle = (i / stripeCount) * Math.PI * 2;
      const stripeGeometry = new THREE.BufferGeometry();
      stripeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
        0, 0.25, 0,
        Math.cos(angle) * radius, 0.25, Math.sin(angle) * radius
      ], 3));
      const stripeMaterial = new THREE.LineDashedMaterial({
        color: color,
        dashSize: 2,
        gapSize: 2,
        transparent: true,
        opacity: 0.4
      });
      const stripe = new THREE.Line(stripeGeometry, stripeMaterial);
      stripe.computeLineDistances();
      keepOutGroup.add(stripe);
    }

    // Label sprite
    if (label) {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 64;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
      ctx.font = 'bold 28px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(label.toUpperCase(), 128, 40);

      const texture = new THREE.CanvasTexture(canvas);
      const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const sprite = new THREE.Sprite(spriteMaterial);
      sprite.scale.set(radius * 0.8, radius * 0.2, 1);
      sprite.position.y = 5;
      keepOutGroup.add(sprite);
    }

    keepOutGroup.position.set(x, 0, z);
    keepOutGroup.userData = { zone };
    this.keepOutMarkers.push(keepOutGroup);
    this.overlayGroup.add(keepOutGroup);
  }

  clearKeepOutZones() {
    this.keepOutMarkers.forEach(marker => {
      this.overlayGroup.remove(marker);
      marker.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
    });
    this.keepOutMarkers = [];
  }

  setFieldBoundary(points) {
    // Remove existing boundary
    if (this.boundaryLine) {
      this.overlayGroup.remove(this.boundaryLine);
      this.boundaryLine.geometry.dispose();
      this.boundaryLine.material.dispose();
    }

    if (!points || points.length < 3) return;

    // Create boundary polygon
    const points3D = points.map(p => new THREE.Vector3(p.x, 0.3, p.z));
    points3D.push(points3D[0]); // Close the loop

    const boundaryGeometry = new THREE.BufferGeometry().setFromPoints(points3D);
    const boundaryMaterial = new THREE.LineDashedMaterial({
      color: 0xff0000,
      dashSize: 5,
      gapSize: 3,
      linewidth: 2
    });

    this.boundaryLine = new THREE.Line(boundaryGeometry, boundaryMaterial);
    this.boundaryLine.computeLineDistances();
    this.overlayGroup.add(this.boundaryLine);
  }

  setVisible(visible) {
    this.isVisible = visible;
    if (this.overlayGroup) {
      this.overlayGroup.visible = visible;
    }
  }

  setSafetyCirclesVisible(visible) {
    // Toggle safety circles visibility
    this.overlayGroup.children.forEach(child => {
      if (child !== this.landingEllipse && !this.keepOutMarkers.includes(child)) {
        child.visible = visible;
      }
    });
  }

  setLandingEllipseVisible(visible) {
    if (this.landingEllipse) {
      this.landingEllipse.visible = visible;
    }
  }

  dispose() {
    if (this.overlayGroup) {
      this.scene.remove(this.overlayGroup);
      this.overlayGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
    }
    this.keepOutMarkers = [];
  }
}

/**
 * Attitude Indicator Widget
 * Aviation-style artificial horizon display
 */
class AttitudeIndicatorWidget {
  constructor(container, options = {}) {
    this.container = container;
    this.options = {
      size: 120,
      position: 'bottom-right',
      showPitchLadder: true,
      showRollIndicator: true,
      showHeading: true,
      ...options
    };

    this.element = null;
    this.canvas = null;
    this.ctx = null;
    this.pitch = 0;  // degrees, positive = nose up
    this.roll = 0;   // degrees, positive = right roll
    this.heading = 0; // degrees, 0 = north
    this.isVisible = true;

    this.create();
    log.debug('Attitude Indicator Widget initialized');
  }

  create() {
    this.element = document.createElement('div');
    this.element.className = 'attitude-indicator-widget';
    
    // Position
    const positions = {
      'top-left': { top: '20px', left: '240px' },
      'top-right': { top: '20px', right: '20px' },
      'bottom-left': { bottom: '80px', left: '20px' },
      'bottom-right': { bottom: '80px', right: '20px' }
    };
    const pos = positions[this.options.position] || positions['bottom-right'];

    this.element.style.cssText = `
      position: absolute;
      ${Object.entries(pos).map(([k, v]) => `${k}: ${v}`).join('; ')};
      width: ${this.options.size}px;
      height: ${this.options.size + 30}px;
      background: rgba(10, 15, 25, 0.9);
      border: 2px solid rgba(0, 200, 255, 0.4);
      border-radius: 8px;
      z-index: 999;
      overflow: hidden;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      padding: 4px 8px;
      background: rgba(0, 200, 255, 0.15);
      color: #00ccff;
      font-family: 'SF Mono', monospace;
      font-size: 10px;
      font-weight: 600;
      text-align: center;
      letter-spacing: 1px;
    `;
    header.textContent = '🎯 ATTITUDE';
    this.element.appendChild(header);

    // Canvas for attitude indicator
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.options.size;
    this.canvas.height = this.options.size;
    this.canvas.style.cssText = 'display: block; margin: 0 auto;';
    this.element.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this.container.appendChild(this.element);
    this.render();
  }

  update(pitch, roll, heading = 0) {
    this.pitch = pitch || 0;
    this.roll = roll || 0;
    this.heading = heading || 0;
    this.render();
  }

  render() {
    if (!this.ctx || !this.isVisible) return;

    const ctx = this.ctx;
    const size = this.options.size;
    const cx = size / 2;
    const cy = size / 2;
    const radius = size / 2 - 5;

    // Clear
    ctx.clearRect(0, 0, size, size);

    // Save context for clipping
    ctx.save();

    // Circular clip
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.clip();

    // Draw sky/ground with pitch and roll
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-this.roll * Math.PI / 180);

    // Calculate horizon offset based on pitch
    // 90 degrees pitch = full radius offset
    const pitchOffset = (this.pitch / 90) * radius;

    // Sky
    ctx.fillStyle = '#4a90c2';
    ctx.fillRect(-radius * 2, -radius * 2, radius * 4, radius * 2 + pitchOffset);

    // Ground
    ctx.fillStyle = '#8b6914';
    ctx.fillRect(-radius * 2, pitchOffset, radius * 4, radius * 2);

    // Horizon line
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-radius, pitchOffset);
    ctx.lineTo(radius, pitchOffset);
    ctx.stroke();

    // Pitch ladder
    if (this.options.showPitchLadder) {
      ctx.strokeStyle = '#ffffff';
      ctx.fillStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.font = '10px Arial';
      ctx.textAlign = 'center';

      const pitchMarks = [-60, -45, -30, -20, -10, 10, 20, 30, 45, 60];
      pitchMarks.forEach(mark => {
        const y = pitchOffset - (mark / 90) * radius;
        if (Math.abs(y) < radius * 0.9) {
          const halfWidth = mark % 30 === 0 ? 25 : (mark % 15 === 0 ? 18 : 12);
          
          ctx.beginPath();
          ctx.moveTo(-halfWidth, y);
          ctx.lineTo(halfWidth, y);
          ctx.stroke();

          if (Math.abs(mark) >= 20) {
            ctx.fillText(Math.abs(mark).toString(), halfWidth + 12, y + 3);
            ctx.fillText(Math.abs(mark).toString(), -halfWidth - 12, y + 3);
          }
        }
      });
    }

    ctx.restore();

    // Roll indicator arc (at top, outside rotation)
    if (this.options.showRollIndicator) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 5, -Math.PI * 5/6, -Math.PI / 6);
      ctx.stroke();

      // Roll marks
      const rollMarks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];
      rollMarks.forEach(mark => {
        const angle = (-90 + mark) * Math.PI / 180;
        const innerR = radius - 10;
        const outerR = mark % 30 === 0 ? radius - 2 : (mark % 15 === 0 ? radius - 5 : radius - 8);
        
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
        ctx.lineTo(cx + Math.cos(angle) * outerR, cy + Math.sin(angle) * outerR);
        ctx.stroke();
      });

      // Roll pointer (triangle)
      const rollAngle = (-90 + this.roll) * Math.PI / 180;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rollAngle + Math.PI / 2);
      ctx.fillStyle = '#ff6600';
      ctx.beginPath();
      ctx.moveTo(0, -radius + 2);
      ctx.lineTo(-5, -radius + 12);
      ctx.lineTo(5, -radius + 12);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    ctx.restore();

    // Fixed aircraft symbol (center)
    ctx.strokeStyle = '#ff6600';
    ctx.fillStyle = '#ff6600';
    ctx.lineWidth = 3;

    // Center dot
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();

    // Wings
    ctx.beginPath();
    ctx.moveTo(cx - 30, cy);
    ctx.lineTo(cx - 10, cy);
    ctx.moveTo(cx + 10, cy);
    ctx.lineTo(cx + 30, cy);
    ctx.stroke();

    // Tail
    ctx.beginPath();
    ctx.moveTo(cx, cy + 10);
    ctx.lineTo(cx, cy + 20);
    ctx.stroke();

    // Border
    ctx.strokeStyle = '#00ccff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Heading indicator at bottom
    if (this.options.showHeading) {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
      ctx.fillRect(cx - 25, size - 18, 50, 16);
      ctx.fillStyle = '#00ff88';
      ctx.font = 'bold 11px SF Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`${Math.round(this.heading)}°`, cx, size - 6);
    }
  }

  setVisible(visible) {
    this.isVisible = visible;
    if (this.element) {
      this.element.style.display = visible ? 'block' : 'none';
    }
    if (visible) this.render();
  }

  setPosition(position) {
    this.options.position = position;
    const positions = {
      'top-left': { top: '20px', left: '240px', bottom: 'auto', right: 'auto' },
      'top-right': { top: '20px', right: '20px', bottom: 'auto', left: 'auto' },
      'bottom-left': { bottom: '80px', left: '20px', top: 'auto', right: 'auto' },
      'bottom-right': { bottom: '80px', right: '20px', top: 'auto', left: 'auto' }
    };
    const pos = positions[position] || positions['bottom-right'];
    Object.assign(this.element.style, pos);
  }

  dispose() {
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
  }
}

/**
 * Heating Indicator System
 * Shows thermal stress visualization on rocket components
 */
class HeatingIndicator {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = {
      enabled: true,
      maxTemp: 500,              // Max temperature for full red (Celsius)
      stagnationFactor: 1.0,    // Multiplier for nose tip heating
      finLeadingEdgeFactor: 0.8, // Multiplier for fin leading edges
      bodyFactor: 0.3,          // Multiplier for body tube
      showHeatShield: true,
      ...options
    };

    this.heatMaterials = new Map();  // Original material -> heated material
    this.rocketMesh = null;
    this.currentTemp = 0;
    this.isEnabled = true;
    this.heatOverlay = null;

    log.debug('Heating Indicator initialized');
  }

  setRocket(rocketMesh) {
    this.rocketMesh = rocketMesh;
    this.createHeatMaterials();
  }

  createHeatMaterials() {
    if (!this.rocketMesh) return;

    // Clear previous materials
    this.heatMaterials.clear();

    // Create heat-sensitive shader material
    this.rocketMesh.traverse(child => {
      if (child.isMesh && child.material) {
        // Store original material
        const originalMaterial = child.material;
        
        // Create a material that can show heat
        const heatMaterial = originalMaterial.clone();
        heatMaterial.userData.originalColor = originalMaterial.color ? 
          originalMaterial.color.clone() : new THREE.Color(0x888888);
        heatMaterial.userData.heatFactor = this.getHeatFactor(child);
        
        this.heatMaterials.set(child, {
          original: originalMaterial,
          heated: heatMaterial
        });
      }
    });
  }

  getHeatFactor(mesh) {
    // Determine heat factor based on component type/position
    const name = (mesh.name || '').toLowerCase();
    const position = mesh.position.y;

    if (name.includes('nose') || name.includes('tip')) {
      return this.options.stagnationFactor;
    } else if (name.includes('fin') || name.includes('canard')) {
      return this.options.finLeadingEdgeFactor;
    } else if (name.includes('body') || name.includes('tube')) {
      return this.options.bodyFactor;
    }

    // Default based on position (higher = more heat during ascent)
    const normalizedPos = Math.max(0, Math.min(1, position / 10));
    return 0.2 + normalizedPos * 0.6;
  }

  update(flightData) {
    if (!this.isEnabled || !this.rocketMesh) return;

    const { velocity, altitude, mach } = flightData;

    // Calculate aerodynamic heating
    // Q_dot ≈ ρ * v³ (simplified stagnation heating)
    // Temperature rise depends on material properties
    
    // Simplified atmospheric density model
    const seaLevelDensity = 1.225; // kg/m³
    const scaleHeight = 8500; // meters
    const density = seaLevelDensity * Math.exp(-(altitude || 0) / scaleHeight);

    // Stagnation temperature (simplified)
    // T_stag = T_ambient * (1 + (γ-1)/2 * M²) where γ = 1.4 for air
    const ambientTemp = 288 - 0.0065 * (altitude || 0); // Temperature lapse
    const machNum = mach || (velocity / 343);
    const stagnationTemp = ambientTemp * (1 + 0.2 * machNum * machNum);

    // Heating rate based on velocity cubed
    const heatRate = density * Math.pow(velocity || 0, 3) * 0.00001;
    
    // Update current temp (with some thermal mass/lag)
    const targetTemp = Math.max(0, stagnationTemp - 288 + heatRate * 10);
    this.currentTemp = this.currentTemp * 0.95 + targetTemp * 0.05;

    // Apply heat visualization to components
    this.applyHeatVisualization();

    return {
      stagnationTemp: stagnationTemp,
      surfaceTemp: this.currentTemp + 20, // Add ambient
      heatRate: heatRate
    };
  }

  applyHeatVisualization() {
    if (!this.rocketMesh) return;

    const maxTemp = this.options.maxTemp;

    this.heatMaterials.forEach((materials, mesh) => {
      const heatFactor = materials.heated.userData.heatFactor;
      const localTemp = this.currentTemp * heatFactor;
      const heatRatio = Math.min(1, localTemp / maxTemp);

      // Interpolate color from original to red/orange/white based on temperature
      const originalColor = materials.heated.userData.originalColor;
      const heatColor = this.temperatureToColor(heatRatio);

      // Blend original color with heat color
      const blendedColor = new THREE.Color();
      blendedColor.r = originalColor.r * (1 - heatRatio) + heatColor.r * heatRatio;
      blendedColor.g = originalColor.g * (1 - heatRatio * 0.8) + heatColor.g * heatRatio;
      blendedColor.b = originalColor.b * (1 - heatRatio) + heatColor.b * heatRatio;

      // Apply to mesh
      if (mesh.material) {
        mesh.material.color.copy(blendedColor);
        
        // Add emissive glow at high temperatures
        if (mesh.material.emissive && heatRatio > 0.5) {
          mesh.material.emissive.setRGB(
            heatColor.r * (heatRatio - 0.5) * 2,
            heatColor.g * (heatRatio - 0.5) * 0.5,
            0
          );
          mesh.material.emissiveIntensity = (heatRatio - 0.5) * 2;
        }
      }
    });
  }

  temperatureToColor(ratio) {
    // Temperature color gradient: normal -> yellow -> orange -> red -> white
    let r, g, b;

    if (ratio < 0.25) {
      // Normal to yellow
      const t = ratio * 4;
      r = t;
      g = t * 0.8;
      b = 0;
    } else if (ratio < 0.5) {
      // Yellow to orange
      const t = (ratio - 0.25) * 4;
      r = 1;
      g = 0.8 - t * 0.5;
      b = 0;
    } else if (ratio < 0.75) {
      // Orange to red
      const t = (ratio - 0.5) * 4;
      r = 1;
      g = 0.3 - t * 0.3;
      b = 0;
    } else {
      // Red to white-hot
      const t = (ratio - 0.75) * 4;
      r = 1;
      g = t * 0.6;
      b = t * 0.4;
    }

    return new THREE.Color(r, g, b);
  }

  reset() {
    this.currentTemp = 0;
    
    // Reset all materials to original colors
    this.heatMaterials.forEach((materials, mesh) => {
      if (mesh.material && materials.heated.userData.originalColor) {
        mesh.material.color.copy(materials.heated.userData.originalColor);
        if (mesh.material.emissive) {
          mesh.material.emissive.setRGB(0, 0, 0);
          mesh.material.emissiveIntensity = 0;
        }
      }
    });
  }

  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (!enabled) {
      this.reset();
    }
  }

  getCurrentTemperature() {
    return this.currentTemp;
  }

  getTemperatureStatus() {
    if (this.currentTemp < 50) return { status: 'NOMINAL', color: '#00ff00' };
    if (this.currentTemp < 150) return { status: 'WARM', color: '#88ff00' };
    if (this.currentTemp < 300) return { status: 'HOT', color: '#ffaa00' };
    if (this.currentTemp < 450) return { status: 'CRITICAL', color: '#ff4400' };
    return { status: 'DANGER', color: '#ff0000' };
  }

  dispose() {
    this.reset();
    this.heatMaterials.clear();
  }
}

/**
 * KML Exporter
 * Exports trajectory data to KML format for Google Earth
 */
class KMLExporter {
  constructor(options = {}) {
    this.options = {
      lineColor: 'ff0000ff',      // AABBGGRR format (red)
      lineWidth: 3,
      altitudeMode: 'absolute',   // absolute, relativeToGround, clampToGround
      extrude: true,
      tessellate: true,
      includeMarkers: true,
      markerScale: 1.0,
      ...options
    };

    log.debug('KML Exporter initialized');
  }

  export(trajectoryData, metadata = {}) {
    if (!trajectoryData || !trajectoryData.trajectory) {
      throw new Error('Invalid trajectory data');
    }

    const {
      name = 'Rocket Flight',
      description = '',
      launchSite = { lat: 0, lon: 0, alt: 0 },
      rocket = {},
      motor = {}
    } = metadata;

    const trajectory = trajectoryData.trajectory;
    const events = trajectoryData.events || [];

    // Build KML document
    let kml = this.buildKMLHeader(name, description, metadata);
    
    // Add flight path
    kml += this.buildFlightPath(trajectory, launchSite);
    
    // Add event markers
    if (this.options.includeMarkers) {
      kml += this.buildEventMarkers(trajectory, events, launchSite, trajectoryData);
    }
    
    // Add launch site marker
    kml += this.buildLaunchSiteMarker(launchSite, name);
    
    // Add landing marker
    kml += this.buildLandingMarker(trajectory, launchSite);
    
    kml += this.buildKMLFooter();

    return kml;
  }

  buildKMLHeader(name, description, metadata) {
    const rocket = metadata.rocket || {};
    const motor = metadata.motor || {};
    const apogee = metadata.apogee || 0;
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"
     xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
  <name>${this.escapeXml(name)}</name>
  <description><![CDATA[
    <h3>${this.escapeXml(name)}</h3>
    ${description ? `<p>${this.escapeXml(description)}</p>` : ''}
    <table>
      <tr><td><b>Rocket:</b></td><td>${this.escapeXml(rocket.name || 'Unknown')}</td></tr>
      <tr><td><b>Motor:</b></td><td>${this.escapeXml(motor.name || 'Unknown')}</td></tr>
      <tr><td><b>Apogee:</b></td><td>${apogee.toFixed(1)} m</td></tr>
      <tr><td><b>Generated:</b></td><td>${new Date().toISOString()}</td></tr>
    </table>
    <p><i>Generated by LAUNCHSIM Pro</i></p>
  ]]></description>
  
  <!-- Styles -->
  <Style id="flightPath">
    <LineStyle>
      <color>${this.options.lineColor}</color>
      <width>${this.options.lineWidth}</width>
    </LineStyle>
    <PolyStyle>
      <color>7f0000ff</color>
    </PolyStyle>
  </Style>
  
  <Style id="launchSite">
    <IconStyle>
      <scale>1.2</scale>
      <Icon><href>http://maps.google.com/mapfiles/kml/shapes/triangle.png</href></Icon>
      <color>ff00ff00</color>
    </IconStyle>
    <LabelStyle><scale>0.8</scale></LabelStyle>
  </Style>
  
  <Style id="landingSite">
    <IconStyle>
      <scale>1.0</scale>
      <Icon><href>http://maps.google.com/mapfiles/kml/shapes/target.png</href></Icon>
      <color>ff0000ff</color>
    </IconStyle>
    <LabelStyle><scale>0.8</scale></LabelStyle>
  </Style>
  
  <Style id="apogee">
    <IconStyle>
      <scale>1.0</scale>
      <Icon><href>http://maps.google.com/mapfiles/kml/shapes/star.png</href></Icon>
      <color>ff00ffff</color>
    </IconStyle>
    <LabelStyle><scale>0.8</scale></LabelStyle>
  </Style>
  
  <Style id="event">
    <IconStyle>
      <scale>0.8</scale>
      <Icon><href>http://maps.google.com/mapfiles/kml/shapes/placemark_circle.png</href></Icon>
      <color>ffff8800</color>
    </IconStyle>
    <LabelStyle><scale>0.7</scale></LabelStyle>
  </Style>

  <Folder>
    <name>Flight Data</name>
`;
  }

  buildFlightPath(trajectory, launchSite) {
    const coordinates = trajectory.map(point => {
      const { lat, lon, alt } = this.projectToLatLon(point, launchSite);
      return `${lon},${lat},${alt}`;
    }).join('\n        ');

    return `
    <Placemark>
      <name>Flight Trajectory</name>
      <description>Complete flight path from launch to landing</description>
      <styleUrl>#flightPath</styleUrl>
      <LineString>
        <extrude>${this.options.extrude ? 1 : 0}</extrude>
        <tessellate>${this.options.tessellate ? 1 : 0}</tessellate>
        <altitudeMode>${this.options.altitudeMode}</altitudeMode>
        <coordinates>
        ${coordinates}
        </coordinates>
      </LineString>
    </Placemark>
`;
  }

  buildEventMarkers(trajectory, events, launchSite, trajectoryData) {
    let markers = '\n    <Folder>\n      <name>Flight Events</name>\n';

    // Add apogee marker
    const apogeePoint = trajectory.find(p => 
      Math.abs(p.altitude - (trajectoryData.apogee || 0)) < 1
    ) || trajectory.reduce((max, p) => p.altitude > max.altitude ? p : max, trajectory[0]);

    if (apogeePoint) {
      const { lat, lon, alt } = this.projectToLatLon(apogeePoint, launchSite);
      markers += `
      <Placemark>
        <name>Apogee</name>
        <description>Maximum altitude: ${apogeePoint.altitude.toFixed(1)} m at T+${apogeePoint.time.toFixed(2)}s</description>
        <styleUrl>#apogee</styleUrl>
        <Point>
          <altitudeMode>${this.options.altitudeMode}</altitudeMode>
          <coordinates>${lon},${lat},${alt}</coordinates>
        </Point>
      </Placemark>
`;
    }

    // Add other events
    events.forEach(event => {
      const point = trajectory.find(p => Math.abs(p.time - event.time) < 0.1);
      if (point) {
        const { lat, lon, alt } = this.projectToLatLon(point, launchSite);
        markers += `
      <Placemark>
        <name>${this.escapeXml(event.event)}</name>
        <description>T+${event.time.toFixed(2)}s, Alt: ${point.altitude.toFixed(1)}m</description>
        <styleUrl>#event</styleUrl>
        <Point>
          <altitudeMode>${this.options.altitudeMode}</altitudeMode>
          <coordinates>${lon},${lat},${alt}</coordinates>
        </Point>
      </Placemark>
`;
      }
    });

    markers += '    </Folder>\n';
    return markers;
  }

  buildLaunchSiteMarker(launchSite, name) {
    return `
    <Placemark>
      <name>Launch Site</name>
      <description>${this.escapeXml(name)} - Launch Pad</description>
      <styleUrl>#launchSite</styleUrl>
      <Point>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>${launchSite.lon},${launchSite.lat},0</coordinates>
      </Point>
    </Placemark>
`;
  }

  buildLandingMarker(trajectory, launchSite) {
    const lastPoint = trajectory[trajectory.length - 1];
    if (!lastPoint) return '';

    const { lat, lon } = this.projectToLatLon(lastPoint, launchSite);
    const distance = Math.sqrt(lastPoint.x * lastPoint.x + (lastPoint.y || 0) * (lastPoint.y || 0));

    return `
    <Placemark>
      <name>Landing Site</name>
      <description>Distance from pad: ${distance.toFixed(1)}m</description>
      <styleUrl>#landingSite</styleUrl>
      <Point>
        <altitudeMode>clampToGround</altitudeMode>
        <coordinates>${lon},${lat},0</coordinates>
      </Point>
    </Placemark>
`;
  }

  buildKMLFooter() {
    return `
  </Folder>
</Document>
</kml>`;
  }

  projectToLatLon(point, launchSite) {
    // Convert local X/Y coordinates to lat/lon
    // Approximate: 1 degree latitude ≈ 111,320 meters
    // 1 degree longitude ≈ 111,320 * cos(lat) meters
    
    const latMetersPerDegree = 111320;
    const lonMetersPerDegree = 111320 * Math.cos(launchSite.lat * Math.PI / 180);

    const lat = launchSite.lat + (point.x || 0) / latMetersPerDegree;
    const lon = launchSite.lon + (point.y || 0) / lonMetersPerDegree;
    const alt = (launchSite.alt || 0) + (point.altitude || 0);

    return { lat, lon, alt };
  }

  escapeXml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  download(trajectoryData, metadata = {}, filename = 'flight.kml') {
    const kml = this.export(trajectoryData, metadata);
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return true;
  }
}

/**
 * Weather Effects System
 * Creates atmospheric weather visualization (clouds, fog, rain)
 */
class WeatherEffectsSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = {
      enableClouds: true,
      enableFog: true,
      enableRain: false,
      enableSnow: false,
      cloudCount: 30,
      cloudAltitude: 800,
      cloudSpread: 2000,
      fogDensity: 0.0005,
      fogColor: 0xcce0ff,
      rainIntensity: 500,
      ...options
    };

    this.weatherGroup = null;
    this.clouds = [];
    this.rainSystem = null;
    this.snowSystem = null;
    this.isActive = false;

    this.create();
    log.debug('Weather Effects System initialized');
  }

  create() {
    this.weatherGroup = new THREE.Group();
    this.weatherGroup.name = 'weatherEffects';
    this.scene.add(this.weatherGroup);
  }

  generateWeather(conditions = {}) {
    this.clear();

    const {
      cloudCover = 0.5,        // 0-1, percentage
      visibility = 10000,      // meters
      precipitation = 'none',  // none, rain, snow
      windSpeed = 5,
      temperature = 20
    } = conditions;

    this.isActive = true;

    // Generate clouds based on cloud cover
    if (this.options.enableClouds && cloudCover > 0.1) {
      this.generateClouds(cloudCover);
    }

    // Set fog based on visibility
    if (this.options.enableFog && visibility < 10000) {
      this.setFog(visibility);
    }

    // Add precipitation
    if (precipitation === 'rain' && this.options.enableRain) {
      this.generateRain(windSpeed);
    } else if (precipitation === 'snow' && this.options.enableSnow) {
      this.generateSnow(windSpeed);
    }

    log.debug('Weather generated:', conditions);
  }

  generateClouds(cloudCover) {
    const cloudCount = Math.floor(this.options.cloudCount * cloudCover);
    
    for (let i = 0; i < cloudCount; i++) {
      const cloud = this.createCloud();
      
      // Position randomly in sky
      const angle = Math.random() * Math.PI * 2;
      const distance = Math.random() * this.options.cloudSpread;
      cloud.position.x = Math.cos(angle) * distance;
      cloud.position.z = Math.sin(angle) * distance;
      cloud.position.y = this.options.cloudAltitude + (Math.random() - 0.5) * 200;
      
      // Random rotation
      cloud.rotation.y = Math.random() * Math.PI * 2;
      
      // Random scale
      const scale = 0.5 + Math.random() * 1.5;
      cloud.scale.set(scale, scale * 0.4, scale);

      this.clouds.push(cloud);
      this.weatherGroup.add(cloud);
    }
  }

  createCloud() {
    const cloud = new THREE.Group();

    // Create fluffy cloud from multiple spheres
    const puffCount = 5 + Math.floor(Math.random() * 5);
    const cloudMaterial = new THREE.MeshPhongMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      flatShading: true
    });

    for (let i = 0; i < puffCount; i++) {
      const size = 30 + Math.random() * 50;
      const puffGeometry = new THREE.SphereGeometry(size, 8, 6);
      const puff = new THREE.Mesh(puffGeometry, cloudMaterial.clone());
      
      // Position puffs to form cloud shape
      puff.position.x = (Math.random() - 0.5) * 80;
      puff.position.y = (Math.random() - 0.5) * 30;
      puff.position.z = (Math.random() - 0.5) * 80;
      
      cloud.add(puff);
    }

    // Add darker bottom to clouds
    const bottomGeometry = new THREE.SphereGeometry(60, 8, 6);
    const bottomMaterial = new THREE.MeshPhongMaterial({
      color: 0xaabbcc,
      transparent: true,
      opacity: 0.6
    });
    const bottom = new THREE.Mesh(bottomGeometry, bottomMaterial);
    bottom.position.y = -20;
    bottom.scale.set(1.5, 0.3, 1.5);
    cloud.add(bottom);

    return cloud;
  }

  setFog(visibility) {
    // Exponential fog
    const density = 1 / visibility * 2;
    this.scene.fog = new THREE.FogExp2(this.options.fogColor, density);
  }

  clearFog() {
    this.scene.fog = null;
  }

  generateRain(windSpeed = 5) {
    const particleCount = this.options.rainIntensity;
    
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      // Random position in a large box
      positions[i * 3] = (Math.random() - 0.5) * 1000;
      positions[i * 3 + 1] = Math.random() * 500;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 1000;

      // Velocity (mostly down, some wind drift)
      velocities[i * 3] = windSpeed * 0.5;
      velocities[i * 3 + 1] = -50 - Math.random() * 20;
      velocities[i * 3 + 2] = windSpeed * 0.3;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const material = new THREE.PointsMaterial({
      color: 0x8899aa,
      size: 1,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true
    });

    this.rainSystem = new THREE.Points(geometry, material);
    this.rainSystem.userData.velocities = velocities;
    this.weatherGroup.add(this.rainSystem);
  }

  generateSnow(windSpeed = 5) {
    const particleCount = Math.floor(this.options.rainIntensity * 0.5);
    
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 1000;
      positions[i * 3 + 1] = Math.random() * 300;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 1000;

      // Slow falling, more drift
      velocities[i * 3] = (Math.random() - 0.5) * windSpeed;
      velocities[i * 3 + 1] = -5 - Math.random() * 3;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * windSpeed;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 3,
      transparent: true,
      opacity: 0.8,
      sizeAttenuation: true
    });

    this.snowSystem = new THREE.Points(geometry, material);
    this.snowSystem.userData.velocities = velocities;
    this.weatherGroup.add(this.snowSystem);
  }

  update(deltaTime) {
    if (!this.isActive) return;

    // Animate clouds (slow drift)
    this.clouds.forEach(cloud => {
      cloud.position.x += deltaTime * 2;
      if (cloud.position.x > this.options.cloudSpread) {
        cloud.position.x = -this.options.cloudSpread;
      }
    });

    // Animate rain
    if (this.rainSystem) {
      const positions = this.rainSystem.geometry.attributes.position.array;
      const velocities = this.rainSystem.userData.velocities;

      for (let i = 0; i < positions.length / 3; i++) {
        positions[i * 3] += velocities[i * 3] * deltaTime;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * deltaTime;
        positions[i * 3 + 2] += velocities[i * 3 + 2] * deltaTime;

        // Reset if below ground
        if (positions[i * 3 + 1] < 0) {
          positions[i * 3 + 1] = 500;
          positions[i * 3] = (Math.random() - 0.5) * 1000;
          positions[i * 3 + 2] = (Math.random() - 0.5) * 1000;
        }
      }

      this.rainSystem.geometry.attributes.position.needsUpdate = true;
    }

    // Animate snow
    if (this.snowSystem) {
      const positions = this.snowSystem.geometry.attributes.position.array;
      const velocities = this.snowSystem.userData.velocities;

      for (let i = 0; i < positions.length / 3; i++) {
        // Add some wandering motion
        positions[i * 3] += (velocities[i * 3] + Math.sin(Date.now() * 0.001 + i) * 2) * deltaTime;
        positions[i * 3 + 1] += velocities[i * 3 + 1] * deltaTime;
        positions[i * 3 + 2] += (velocities[i * 3 + 2] + Math.cos(Date.now() * 0.001 + i) * 2) * deltaTime;

        if (positions[i * 3 + 1] < 0) {
          positions[i * 3 + 1] = 300;
          positions[i * 3] = (Math.random() - 0.5) * 1000;
          positions[i * 3 + 2] = (Math.random() - 0.5) * 1000;
        }
      }

      this.snowSystem.geometry.attributes.position.needsUpdate = true;
    }
  }

  setCloudAltitude(altitude) {
    this.options.cloudAltitude = altitude;
    this.clouds.forEach(cloud => {
      cloud.position.y = altitude + (Math.random() - 0.5) * 200;
    });
  }

  setVisible(visible) {
    if (this.weatherGroup) {
      this.weatherGroup.visible = visible;
    }
  }

  clear() {
    // Remove all weather elements
    while (this.weatherGroup.children.length > 0) {
      const child = this.weatherGroup.children[0];
      this.weatherGroup.remove(child);
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }

    this.clouds = [];
    this.rainSystem = null;
    this.snowSystem = null;
    this.clearFog();
    this.isActive = false;
  }

  dispose() {
    this.clear();
    if (this.weatherGroup) {
      this.scene.remove(this.weatherGroup);
    }
  }
}

/**
 * Skybox System
 * Creates realistic sky dome with day/night cycle support
 */
class SkyboxSystem {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.options = {
      size: 5000,
      timeOfDay: 12,          // 0-24 hours
      sunIntensity: 1.0,
      enableStars: true,
      enableSun: true,
      enableMoon: false,
      ...options
    };

    this.skyDome = null;
    this.sunLight = null;
    this.sunMesh = null;
    this.moonMesh = null;
    this.stars = null;
    this.uniforms = null;

    this.create();
    log.debug('Skybox System initialized');
  }

  create() {
    this.createSkyDome();
    this.createSun();
    if (this.options.enableStars) {
      this.createStars();
    }
    this.setTimeOfDay(this.options.timeOfDay);
  }

  createSkyDome() {
    // Create gradient sky shader
    const vertexShader = `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const fragmentShader = `
      uniform vec3 topColor;
      uniform vec3 bottomColor;
      uniform vec3 horizonColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        float t = max(pow(max(h, 0.0), exponent), 0.0);
        
        vec3 color;
        if (h > 0.0) {
          color = mix(horizonColor, topColor, t);
        } else {
          color = mix(horizonColor, bottomColor, -h * 2.0);
        }
        
        gl_FragColor = vec4(color, 1.0);
      }
    `;

    this.uniforms = {
      topColor: { value: new THREE.Color(0x0077ff) },
      bottomColor: { value: new THREE.Color(0x89b2eb) },
      horizonColor: { value: new THREE.Color(0xffffff) },
      offset: { value: 33 },
      exponent: { value: 0.6 }
    };

    const skyGeometry = new THREE.SphereGeometry(this.options.size, 32, 15);
    const skyMaterial = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vertexShader,
      fragmentShader: fragmentShader,
      side: THREE.BackSide
    });

    this.skyDome = new THREE.Mesh(skyGeometry, skyMaterial);
    this.scene.add(this.skyDome);
  }

  createSun() {
    // Sun disc
    const sunGeometry = new THREE.SphereGeometry(50, 16, 16);
    const sunMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.9
    });
    this.sunMesh = new THREE.Mesh(sunGeometry, sunMaterial);
    this.scene.add(this.sunMesh);

    // Sun glow
    const glowGeometry = new THREE.SphereGeometry(80, 16, 16);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.3,
      side: THREE.BackSide
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    this.sunMesh.add(glow);

    // Directional light (sun light)
    this.sunLight = new THREE.DirectionalLight(0xffffff, this.options.sunIntensity);
    this.sunLight.castShadow = true;
    this.sunLight.shadow.mapSize.width = 2048;
    this.sunLight.shadow.mapSize.height = 2048;
    this.sunLight.shadow.camera.near = 0.5;
    this.sunLight.shadow.camera.far = 5000;
    this.sunLight.shadow.camera.left = -1000;
    this.sunLight.shadow.camera.right = 1000;
    this.sunLight.shadow.camera.top = 1000;
    this.sunLight.shadow.camera.bottom = -1000;
    this.scene.add(this.sunLight);
  }

  createStars() {
    const starCount = 2000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const colors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      // Random position on sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = this.options.size * 0.95;

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

      // Random star color (mostly white, some blue/yellow)
      const temp = Math.random();
      if (temp > 0.95) {
        colors[i * 3] = 0.8;
        colors[i * 3 + 1] = 0.8;
        colors[i * 3 + 2] = 1.0;
      } else if (temp > 0.9) {
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 1.0;
        colors[i * 3 + 2] = 0.7;
      } else {
        colors[i * 3] = 1.0;
        colors[i * 3 + 1] = 1.0;
        colors[i * 3 + 2] = 1.0;
      }
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
      size: 2,
      vertexColors: true,
      transparent: true,
      opacity: 0
    });

    this.stars = new THREE.Points(geometry, material);
    this.scene.add(this.stars);
  }

  setTimeOfDay(hour) {
    this.options.timeOfDay = hour;

    // Calculate sun position
    const sunAngle = ((hour - 6) / 12) * Math.PI; // 6am = horizon, 12pm = zenith
    const sunRadius = this.options.size * 0.8;
    const sunY = Math.sin(sunAngle) * sunRadius;
    const sunZ = -Math.cos(sunAngle) * sunRadius;

    if (this.sunMesh) {
      this.sunMesh.position.set(0, sunY, sunZ);
      this.sunMesh.visible = hour >= 5 && hour <= 19;
    }

    if (this.sunLight) {
      this.sunLight.position.set(0, sunY, sunZ);
      
      // Adjust light intensity based on sun angle
      const intensity = Math.max(0, Math.sin(sunAngle)) * this.options.sunIntensity;
      this.sunLight.intensity = intensity;
    }

    // Adjust sky colors based on time
    if (this.uniforms) {
      if (hour >= 6 && hour < 8) {
        // Sunrise
        const t = (hour - 6) / 2;
        this.uniforms.topColor.value.setHex(this.lerpColor(0x1a1a3a, 0x0077ff, t));
        this.uniforms.horizonColor.value.setHex(this.lerpColor(0xff6644, 0xffeedd, t));
        this.uniforms.bottomColor.value.setHex(this.lerpColor(0xff4422, 0x89b2eb, t));
      } else if (hour >= 8 && hour < 17) {
        // Day
        this.uniforms.topColor.value.setHex(0x0077ff);
        this.uniforms.horizonColor.value.setHex(0xffffff);
        this.uniforms.bottomColor.value.setHex(0x89b2eb);
      } else if (hour >= 17 && hour < 19) {
        // Sunset
        const t = (hour - 17) / 2;
        this.uniforms.topColor.value.setHex(this.lerpColor(0x0077ff, 0x1a1a3a, t));
        this.uniforms.horizonColor.value.setHex(this.lerpColor(0xffeedd, 0xff6644, t));
        this.uniforms.bottomColor.value.setHex(this.lerpColor(0x89b2eb, 0xff4422, t));
      } else {
        // Night
        this.uniforms.topColor.value.setHex(0x000011);
        this.uniforms.horizonColor.value.setHex(0x111122);
        this.uniforms.bottomColor.value.setHex(0x000000);
      }
    }

    // Show/hide stars
    if (this.stars) {
      const starOpacity = hour < 6 || hour > 19 ? 1.0 : 
                          hour < 7 ? 1.0 - (hour - 6) :
                          hour > 18 ? (hour - 18) : 0;
      this.stars.material.opacity = starOpacity;
    }
  }

  lerpColor(color1, color2, t) {
    const c1 = new THREE.Color(color1);
    const c2 = new THREE.Color(color2);
    c1.lerp(c2, t);
    return c1.getHex();
  }

  setVisible(visible) {
    if (this.skyDome) this.skyDome.visible = visible;
    if (this.sunMesh) this.sunMesh.visible = visible;
    if (this.stars) this.stars.visible = visible;
  }

  dispose() {
    if (this.skyDome) {
      this.scene.remove(this.skyDome);
      this.skyDome.geometry.dispose();
      this.skyDome.material.dispose();
    }
    if (this.sunMesh) {
      this.scene.remove(this.sunMesh);
      this.sunMesh.geometry.dispose();
      this.sunMesh.material.dispose();
    }
    if (this.sunLight) {
      this.scene.remove(this.sunLight);
    }
    if (this.stars) {
      this.scene.remove(this.stars);
      this.stars.geometry.dispose();
      this.stars.material.dispose();
    }
  }
}

/**
 * First Person Camera System
 * Provides POV view from rocket perspective
 */
class FirstPersonCamera {
  constructor(viewer, options = {}) {
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.originalCamera = viewer.camera;
    this.options = {
      fov: 90,
      nearClip: 0.1,
      farClip: 10000,
      offsetY: 0,              // Offset from rocket center
      lookAhead: true,         // Look in direction of travel
      enableFreeeLook: true,   // Allow mouse look around
      smoothing: 0.1,          // Camera rotation smoothing
      ...options
    };

    this.fpCamera = null;
    this.isActive = false;
    this.lookDirection = new THREE.Vector3(0, 1, 0);
    this.targetLookDirection = new THREE.Vector3(0, 1, 0);
    this.mouseX = 0;
    this.mouseY = 0;
    this.freeLookEnabled = false;

    this.boundMouseMove = this.onMouseMove.bind(this);
    this.boundMouseDown = this.onMouseDown.bind(this);
    this.boundMouseUp = this.onMouseUp.bind(this);

    this.create();
    log.debug('First Person Camera initialized');
  }

  create() {
    // Create dedicated FP camera
    const aspect = this.viewer.container.clientWidth / this.viewer.container.clientHeight;
    this.fpCamera = new THREE.PerspectiveCamera(
      this.options.fov,
      aspect,
      this.options.nearClip,
      this.options.farClip
    );
  }

  activate() {
    if (this.isActive) return;

    this.isActive = true;
    this.viewer.camera = this.fpCamera;

    // Add event listeners for free look
    if (this.options.enableFreeeLook) {
      this.viewer.container.addEventListener('mousemove', this.boundMouseMove);
      this.viewer.container.addEventListener('mousedown', this.boundMouseDown);
      this.viewer.container.addEventListener('mouseup', this.boundMouseUp);
    }

    // Disable orbit controls
    if (this.viewer.controls) {
      this.viewer.controls.enabled = false;
    }

    log.debug('First person camera activated');
  }

  deactivate() {
    if (!this.isActive) return;

    this.isActive = false;
    this.viewer.camera = this.originalCamera;
    this.freeLookEnabled = false;

    // Remove event listeners
    this.viewer.container.removeEventListener('mousemove', this.boundMouseMove);
    this.viewer.container.removeEventListener('mousedown', this.boundMouseDown);
    this.viewer.container.removeEventListener('mouseup', this.boundMouseUp);

    // Re-enable orbit controls
    if (this.viewer.controls) {
      this.viewer.controls.enabled = true;
    }

    log.debug('First person camera deactivated');
  }

  update(rocketMesh, velocity) {
    if (!this.isActive || !rocketMesh) return;

    // Position camera at rocket nose
    this.fpCamera.position.copy(rocketMesh.position);
    
    // Offset to be at the nose tip (assuming rocket is oriented along Y axis in local space)
    const noseOffset = new THREE.Vector3(0, 1, 0); // Up in local space
    noseOffset.applyQuaternion(rocketMesh.quaternion);
    // Scale by approximate rocket length (or use a reasonable default)
    noseOffset.multiplyScalar(2); // Small offset to be just ahead of nose
    this.fpCamera.position.add(noseOffset);

    if (this.options.lookAhead && velocity) {
      // Calculate look direction from velocity
      const vel = new THREE.Vector3(velocity.x, velocity.y, velocity.z);
      if (vel.length() > 0.1) {
        this.targetLookDirection.copy(vel.normalize());
      }
    } else {
      // Default: look along rocket's forward direction
      const forward = new THREE.Vector3(0, 1, 0);
      forward.applyQuaternion(rocketMesh.quaternion);
      this.targetLookDirection.copy(forward);
    }

    // Free look overrides
    if (this.freeLookEnabled) {
      // Modify look direction based on mouse
      const euler = new THREE.Euler(
        this.mouseY * 0.002,
        -this.mouseX * 0.002,
        0,
        'YXZ'
      );
      
      const baseLook = new THREE.Vector3(0, 1, 0);
      baseLook.applyQuaternion(rocketMesh.quaternion);
      baseLook.applyEuler(euler);
      this.targetLookDirection.copy(baseLook);
    }

    // Smooth camera rotation
    this.lookDirection.lerp(this.targetLookDirection, this.options.smoothing);
    this.lookDirection.normalize(); // Keep it unit length

    // Set camera to look in direction
    const lookAt = this.fpCamera.position.clone().add(this.lookDirection.clone().multiplyScalar(100));
    this.fpCamera.lookAt(lookAt);
  }

  onMouseMove(event) {
    if (!this.freeLookEnabled) return;

    const rect = this.viewer.container.getBoundingClientRect();
    this.mouseX = (event.clientX - rect.left - rect.width / 2);
    this.mouseY = (event.clientY - rect.top - rect.height / 2);
  }

  onMouseDown(event) {
    if (event.button === 2) { // Right click for free look
      this.freeLookEnabled = true;
      this.viewer.container.style.cursor = 'move';
    }
  }

  onMouseUp(event) {
    if (event.button === 2) {
      this.freeLookEnabled = false;
      this.mouseX = 0;
      this.mouseY = 0;
      this.viewer.container.style.cursor = 'default';
    }
  }

  setFOV(fov) {
    this.options.fov = fov;
    if (this.fpCamera) {
      this.fpCamera.fov = fov;
      this.fpCamera.updateProjectionMatrix();
    }
  }

  resize(width, height) {
    if (this.fpCamera) {
      this.fpCamera.aspect = width / height;
      this.fpCamera.updateProjectionMatrix();
    }
  }

  getState() {
    return {
      isActive: this.isActive,
      freeLookEnabled: this.freeLookEnabled,
      fov: this.options.fov
    };
  }

  dispose() {
    this.deactivate();
    this.fpCamera = null;
  }
}

/**
 * Trajectory Inspector System
 * Allows clicking on trajectory points to view flight data
 */
class TrajectoryInspector {
  constructor(viewer, options = {}) {
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.camera = viewer.camera;
    this.container = viewer.container;
    this.renderer = viewer.renderer;
    
    this.options = {
      markerSize: 1.5,
      markerColor: 0x00ff00,
      highlightColor: 0xffff00,
      markerSpacing: 5,           // Place marker every N trajectory points
      enableHover: true,
      ...options
    };

    this.markers = [];
    this.markersGroup = null;
    this.selectedMarker = null;
    this.hoveredMarker = null;
    this.trajectoryData = null;
    this.infoPanel = null;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.isEnabled = true;

    // Bind event handlers
    this.onMouseClick = this.onMouseClick.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);

    // Create info panel
    this.createInfoPanel();

    // Set up event listeners
    this.setupEventListeners();

    log.debug('Trajectory Inspector initialized');
  }

  createInfoPanel() {
    // Create the info panel DOM element
    this.infoPanel = document.createElement('div');
    this.infoPanel.className = 'trajectory-info-panel';
    this.infoPanel.innerHTML = `
      <div class="info-panel-header">
        <span class="info-panel-title">📍 Flight Data</span>
        <button class="info-panel-close">×</button>
      </div>
      <div class="info-panel-content">
        <div class="info-row">
          <span class="info-label">Time:</span>
          <span class="info-value" id="info-time">--</span>
        </div>
        <div class="info-row">
          <span class="info-label">Altitude:</span>
          <span class="info-value" id="info-altitude">--</span>
        </div>
        <div class="info-row">
          <span class="info-label">Velocity:</span>
          <span class="info-value" id="info-velocity">--</span>
        </div>
        <div class="info-row">
          <span class="info-label">Acceleration:</span>
          <span class="info-value" id="info-acceleration">--</span>
        </div>
        <div class="info-row">
          <span class="info-label">Mach:</span>
          <span class="info-value" id="info-mach">--</span>
        </div>
        <div class="info-row">
          <span class="info-label">Downrange:</span>
          <span class="info-value" id="info-downrange">--</span>
        </div>
        <div class="info-row">
          <span class="info-label">Phase:</span>
          <span class="info-value" id="info-phase">--</span>
        </div>
        <div class="info-row">
          <span class="info-label">Drag:</span>
          <span class="info-value" id="info-drag">--</span>
        </div>
      </div>
      <div class="info-panel-footer">
        <small>Click another point or press Esc to close</small>
      </div>
    `;
    
    this.infoPanel.style.display = 'none';
    this.container.appendChild(this.infoPanel);

    // Close button handler
    this.infoPanel.querySelector('.info-panel-close').addEventListener('click', () => {
      this.hideInfoPanel();
      this.clearSelection();
    });

    // Add styles
    this.addStyles();
  }

  addStyles() {
    // Check if styles already added
    if (document.getElementById('trajectory-inspector-styles')) return;

    const style = document.createElement('style');
    style.id = 'trajectory-inspector-styles';
    style.textContent = `
      .trajectory-info-panel {
        position: absolute;
        top: 20px;
        right: 20px;
        width: 220px;
        background: rgba(20, 25, 35, 0.95);
        border: 1px solid rgba(100, 150, 255, 0.3);
        border-radius: 8px;
        color: #fff;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        z-index: 1000;
        backdrop-filter: blur(10px);
        overflow: hidden;
      }

      .info-panel-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 12px;
        background: rgba(100, 150, 255, 0.15);
        border-bottom: 1px solid rgba(100, 150, 255, 0.2);
      }

      .info-panel-title {
        font-weight: 600;
        font-size: 14px;
      }

      .info-panel-close {
        background: none;
        border: none;
        color: #888;
        font-size: 18px;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
        transition: color 0.2s;
      }

      .info-panel-close:hover {
        color: #ff6666;
      }

      .info-panel-content {
        padding: 12px;
      }

      .info-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 6px 0;
        border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      }

      .info-row:last-child {
        border-bottom: none;
      }

      .info-label {
        color: #888;
        font-size: 12px;
      }

      .info-value {
        font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;
        font-size: 13px;
        font-weight: 500;
        color: #4fc3f7;
      }

      .info-panel-footer {
        padding: 8px 12px;
        background: rgba(0, 0, 0, 0.2);
        text-align: center;
        color: #666;
        font-size: 11px;
      }

      /* Phase-specific colors */
      .info-value.phase-powered { color: #ff6600; }
      .info-value.phase-coasting { color: #00aaff; }
      .info-value.phase-descent { color: #9900ff; }
      .info-value.phase-drogue { color: #ff9900; }
      .info-value.phase-main { color: #00ff00; }
      .info-value.phase-landed { color: #888888; }

      /* Hover tooltip */
      .trajectory-tooltip {
        position: absolute;
        background: rgba(0, 0, 0, 0.8);
        color: #fff;
        padding: 6px 10px;
        border-radius: 4px;
        font-size: 12px;
        pointer-events: none;
        white-space: nowrap;
        z-index: 1001;
        transform: translate(-50%, -100%);
        margin-top: -10px;
      }

      .trajectory-tooltip::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        margin-left: -5px;
        border-width: 5px;
        border-style: solid;
        border-color: rgba(0, 0, 0, 0.8) transparent transparent transparent;
      }
    `;
    document.head.appendChild(style);
  }

  setupEventListeners() {
    this.renderer.domElement.addEventListener('click', this.onMouseClick);
    
    if (this.options.enableHover) {
      this.renderer.domElement.addEventListener('mousemove', this.onMouseMove);
    }
    
    document.addEventListener('keydown', this.onKeyDown);
  }

  removeEventListeners() {
    this.renderer.domElement.removeEventListener('click', this.onMouseClick);
    this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('keydown', this.onKeyDown);
  }

  setTrajectory(trajectoryData) {
    this.trajectoryData = trajectoryData;
    this.createMarkers();
  }

  createMarkers() {
    // Remove existing markers
    this.clearMarkers();

    if (!this.trajectoryData?.trajectory || this.trajectoryData.trajectory.length < 2) {
      return;
    }

    this.markersGroup = new THREE.Group();
    this.markersGroup.name = 'trajectoryInspectorMarkers';

    const trajectory = this.trajectoryData.trajectory;
    const spacing = this.options.markerSpacing;
    const maxVelocity = this.trajectoryData.maxVelocity || 100;

    // Create marker geometry (reuse for all markers)
    const markerGeometry = new THREE.SphereGeometry(this.options.markerSize, 12, 8);

    for (let i = 0; i < trajectory.length; i += spacing) {
      const point = trajectory[i];
      
      // Color based on velocity
      const color = ColorUtils.velocityToColor(point.velocity || 0, maxVelocity);
      
      const markerMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.7
      });

      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.set(
        point.x || 0,
        point.altitude || 0,
        point.y || 0
      );

      // Store trajectory data index in userData
      marker.userData = {
        trajectoryIndex: i,
        pointData: point,
        originalColor: color.clone(),
        isInspectorMarker: true
      };

      this.markers.push(marker);
      this.markersGroup.add(marker);
    }

    // Add key event markers (apogee, burnout, deploy) with larger size
    this.addKeyEventMarkers(markerGeometry);

    this.scene.add(this.markersGroup);
    log.debug('Created', this.markers.length, 'trajectory inspection markers');
  }

  addKeyEventMarkers(baseGeometry) {
    if (!this.trajectoryData?.events) return;

    const keyEventGeometry = new THREE.SphereGeometry(this.options.markerSize * 1.5, 16, 12);
    
    this.trajectoryData.events.forEach(event => {
      // Find closest trajectory point to event time
      const trajectory = this.trajectoryData.trajectory;
      let closestPoint = trajectory[0];
      let closestIndex = 0;
      let minTimeDiff = Infinity;

      for (let i = 0; i < trajectory.length; i++) {
        const timeDiff = Math.abs(trajectory[i].time - event.time);
        if (timeDiff < minTimeDiff) {
          minTimeDiff = timeDiff;
          closestPoint = trajectory[i];
          closestIndex = i;
        }
      }

      // Determine color based on event type
      let eventColor;
      const eventName = (event.event || '').toLowerCase();
      if (eventName.includes('apogee')) {
        eventColor = new THREE.Color(0xffff00); // Yellow
      } else if (eventName.includes('burnout')) {
        eventColor = new THREE.Color(0xff6600); // Orange
      } else if (eventName.includes('drogue')) {
        eventColor = new THREE.Color(0xff9900); // Orange-yellow
      } else if (eventName.includes('main')) {
        eventColor = new THREE.Color(0x00ff00); // Green
      } else if (eventName.includes('landing') || eventName.includes('landed')) {
        eventColor = new THREE.Color(0xff0000); // Red
      } else {
        eventColor = new THREE.Color(0xffffff); // White
      }

      const markerMaterial = new THREE.MeshBasicMaterial({
        color: eventColor,
        transparent: true,
        opacity: 0.9
      });

      const marker = new THREE.Mesh(keyEventGeometry, markerMaterial);
      marker.position.set(
        closestPoint.x || 0,
        closestPoint.altitude || 0,
        closestPoint.y || 0
      );

      // Add ring around key events
      const ringGeometry = new THREE.RingGeometry(
        this.options.markerSize * 2, 
        this.options.markerSize * 2.5, 
        32
      );
      const ringMaterial = new THREE.MeshBasicMaterial({
        color: eventColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.5
      });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = Math.PI / 2;
      marker.add(ring);

      marker.userData = {
        trajectoryIndex: closestIndex,
        pointData: { ...closestPoint, event: event.event },
        originalColor: eventColor.clone(),
        isInspectorMarker: true,
        isKeyEvent: true,
        eventName: event.event
      };

      this.markers.push(marker);
      this.markersGroup.add(marker);
    });
  }

  clearMarkers() {
    if (this.markersGroup) {
      this.scene.remove(this.markersGroup);
      this.markersGroup.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    this.markers = [];
    this.selectedMarker = null;
    this.hoveredMarker = null;
  }

  onMouseClick(event) {
    if (!this.isEnabled || !this.markersGroup) return;

    const intersects = this.getIntersects(event);
    
    if (intersects.length > 0) {
      const marker = intersects[0].object;
      
      // Check if it's actually an inspector marker
      if (marker.userData.isInspectorMarker) {
        this.selectMarker(marker);
      }
    } else {
      // Clicked elsewhere - optionally close panel
      // this.hideInfoPanel();
      // this.clearSelection();
    }
  }

  onMouseMove(event) {
    if (!this.isEnabled || !this.markersGroup) return;

    const intersects = this.getIntersects(event);

    // Reset previous hover
    if (this.hoveredMarker && this.hoveredMarker !== this.selectedMarker) {
      this.hoveredMarker.material.opacity = 0.7;
      this.hoveredMarker.scale.setScalar(1);
    }

    if (intersects.length > 0) {
      const marker = intersects[0].object;
      
      if (marker.userData.isInspectorMarker && marker !== this.selectedMarker) {
        this.hoveredMarker = marker;
        marker.material.opacity = 1;
        marker.scale.setScalar(1.3);
        this.renderer.domElement.style.cursor = 'pointer';
        
        // Show tooltip
        this.showTooltip(event, marker.userData.pointData);
      }
    } else {
      this.hoveredMarker = null;
      this.renderer.domElement.style.cursor = 'default';
      this.hideTooltip();
    }
  }

  onKeyDown(event) {
    if (event.key === 'Escape') {
      this.hideInfoPanel();
      this.clearSelection();
    }
  }

  getIntersects(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    return this.raycaster.intersectObjects(this.markers, false);
  }

  selectMarker(marker) {
    // Clear previous selection
    if (this.selectedMarker) {
      this.selectedMarker.material.color.copy(this.selectedMarker.userData.originalColor);
      this.selectedMarker.material.opacity = 0.7;
      this.selectedMarker.scale.setScalar(1);
    }

    // Highlight new selection
    this.selectedMarker = marker;
    marker.material.color.setHex(this.options.highlightColor);
    marker.material.opacity = 1;
    marker.scale.setScalar(1.5);

    // Update and show info panel
    this.updateInfoPanel(marker.userData.pointData);
    this.showInfoPanel();

    // Dispatch custom event
    this.container.dispatchEvent(new CustomEvent('trajectoryPointSelected', {
      detail: {
        index: marker.userData.trajectoryIndex,
        data: marker.userData.pointData
      }
    }));
  }

  clearSelection() {
    if (this.selectedMarker) {
      this.selectedMarker.material.color.copy(this.selectedMarker.userData.originalColor);
      this.selectedMarker.material.opacity = 0.7;
      this.selectedMarker.scale.setScalar(1);
      this.selectedMarker = null;
    }
  }

  updateInfoPanel(pointData) {
    if (!this.infoPanel) return;

    const time = pointData.time || 0;
    const altitude = pointData.altitude || 0;
    const velocity = pointData.velocity || 0;
    const acceleration = pointData.acceleration || 0;
    const mach = pointData.mach || (velocity / 343);
    const downrange = Math.sqrt((pointData.x || 0) ** 2 + (pointData.y || 0) ** 2);
    const drag = pointData.drag || 0;

    // Determine flight phase
    let phase = 'Unknown';
    if (pointData.event) {
      phase = pointData.event;
    } else if (pointData.phase) {
      phase = pointData.phase;
    } else if (time < (this.trajectoryData?.burnTime || 3)) {
      phase = 'Powered';
    } else if (velocity > 0 && acceleration < -5) {
      phase = 'Coasting';
    } else if (velocity < 0 && altitude > 100) {
      phase = 'Descent';
    } else if (altitude < 10 && Math.abs(velocity) < 5) {
      phase = 'Landed';
    } else {
      phase = 'Coasting';
    }

    // Update values
    this.infoPanel.querySelector('#info-time').textContent = `T+${time.toFixed(2)}s`;
    this.infoPanel.querySelector('#info-altitude').textContent = `${altitude.toFixed(1)} m`;
    this.infoPanel.querySelector('#info-velocity').textContent = `${velocity.toFixed(1)} m/s`;
    this.infoPanel.querySelector('#info-acceleration').textContent = `${acceleration.toFixed(1)} m/s²`;
    this.infoPanel.querySelector('#info-mach').textContent = mach.toFixed(3);
    this.infoPanel.querySelector('#info-downrange').textContent = `${downrange.toFixed(1)} m`;
    this.infoPanel.querySelector('#info-drag').textContent = `${drag.toFixed(2)} N`;
    
    // Phase with color
    const phaseElement = this.infoPanel.querySelector('#info-phase');
    phaseElement.textContent = phase;
    phaseElement.className = 'info-value phase-' + phase.toLowerCase().replace(/\s+/g, '-');
  }

  showInfoPanel() {
    if (this.infoPanel) {
      this.infoPanel.style.display = 'block';
    }
  }

  hideInfoPanel() {
    if (this.infoPanel) {
      this.infoPanel.style.display = 'none';
    }
  }

  showTooltip(event, pointData) {
    if (!this.tooltip) {
      this.tooltip = document.createElement('div');
      this.tooltip.className = 'trajectory-tooltip';
      this.container.appendChild(this.tooltip);
    }

    const time = (pointData.time || 0).toFixed(1);
    const alt = (pointData.altitude || 0).toFixed(0);
    const vel = (pointData.velocity || 0).toFixed(0);
    const eventLabel = pointData.event ? ` • ${pointData.event}` : '';

    this.tooltip.innerHTML = `T+${time}s | ${alt}m | ${vel}m/s${eventLabel}`;
    this.tooltip.style.display = 'block';
    
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.tooltip.style.left = `${event.clientX - rect.left}px`;
    this.tooltip.style.top = `${event.clientY - rect.top}px`;
  }

  hideTooltip() {
    if (this.tooltip) {
      this.tooltip.style.display = 'none';
    }
  }

  setEnabled(enabled) {
    this.isEnabled = enabled;
    if (!enabled) {
      this.hideInfoPanel();
      this.hideTooltip();
      this.clearSelection();
    }
  }

  setMarkersVisible(visible) {
    if (this.markersGroup) {
      this.markersGroup.visible = visible;
    }
  }

  // Get point at specific time
  getPointAtTime(time) {
    if (!this.trajectoryData?.trajectory) return null;

    const trajectory = this.trajectoryData.trajectory;
    
    for (let i = 0; i < trajectory.length - 1; i++) {
      if (trajectory[i].time <= time && trajectory[i + 1].time >= time) {
        // Interpolate between points
        const t = (time - trajectory[i].time) / (trajectory[i + 1].time - trajectory[i].time);
        const p1 = trajectory[i];
        const p2 = trajectory[i + 1];
        
        return {
          time: time,
          altitude: p1.altitude + (p2.altitude - p1.altitude) * t,
          velocity: p1.velocity + (p2.velocity - p1.velocity) * t,
          acceleration: p1.acceleration + (p2.acceleration - p1.acceleration) * t,
          x: (p1.x || 0) + ((p2.x || 0) - (p1.x || 0)) * t,
          y: (p1.y || 0) + ((p2.y || 0) - (p1.y || 0)) * t
        };
      }
    }
    
    return trajectory[trajectory.length - 1];
  }

  // Select point closest to a given time
  selectPointAtTime(time) {
    if (!this.trajectoryData?.trajectory || this.markers.length === 0) return;

    let closestMarker = this.markers[0];
    let minTimeDiff = Infinity;

    this.markers.forEach(marker => {
      const timeDiff = Math.abs(marker.userData.pointData.time - time);
      if (timeDiff < minTimeDiff) {
        minTimeDiff = timeDiff;
        closestMarker = marker;
      }
    });

    this.selectMarker(closestMarker);
  }

  dispose() {
    this.removeEventListeners();
    this.clearMarkers();
    
    if (this.infoPanel && this.infoPanel.parentNode) {
      this.infoPanel.parentNode.removeChild(this.infoPanel);
    }
    
    if (this.tooltip && this.tooltip.parentNode) {
      this.tooltip.parentNode.removeChild(this.tooltip);
    }
  }
}

/**
 * Main 3D Viewer Class
 */
class Rocket3DViewer {
  constructor(container, options = {}) {
    if (!THREE_AVAILABLE) {
      throw new Error('Three.js is required for 3D visualization');
    }

    this.container = container;
    this.options = {
      backgroundColor: 0x87ceeb, // Sky blue
      groundColor: 0x3d5c3d,     // Dark green
      gridSize: 2000,            // meters
      gridDivisions: 40,
      showGrid: true,
      showAxes: false,
      showStats: false,
      antialias: true,
      enableSmoke: true,
      enableParachutes: true,
      enableStaging: true,
      enableTerrain: true,
      enableWind: true,
      enableInspector: true,
      enableHUD: true,
      enableForceVectors: true,
      enableMachCone: true,
      enableMultiTrajectory: true,
      enableSafeZone: true,
      enableAttitudeIndicator: true,
      enableHeating: true,
      enableWeatherEffects: true,
      enableSkybox: true,
      enableFirstPerson: true,
      enableKMLExport: true,
      ...options
    };

    // State
    this.rocket = null;
    this.trajectory = null;
    this.rocketMesh = null;
    this.trajectoryLine = null;
    this.cgMarker = null;
    this.cpMarker = null;
    this.isPlaying = false;
    this.playbackSpeed = 1;
    this.currentTime = 0;
    this.animationId = null;
    this.lastDeltaTime = 0;

    // Event tracking for parachutes and staging
    this.triggeredEvents = new Set();
    this.currentVelocity = { x: 0, y: 0, z: 0 };

    // Initialize Three.js
    this.initScene();
    this.initCamera();
    this.initRenderer();
    this.initLights();
    this.initGround();
    this.initControls();
    
    // Initialize effect systems
    this.initEffectSystems();
    
    // Start render loop
    this.animate();

    // Handle resize
    this.resizeHandler = () => this.onResize();
    window.addEventListener('resize', this.resizeHandler);

    log.debug('3D Viewer initialized');
  }

  // ============================================
  // Initialization
  // ============================================

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.options.backgroundColor);
    
    // Add fog for depth
    this.scene.fog = new THREE.Fog(this.options.backgroundColor, 1000, 5000);
  }

  initEffectSystems() {
    // Initialize smoke trail system
    if (this.options.enableSmoke) {
      this.smokeTrail = new SmokeTrailSystem(this.scene, {
        maxParticles: 500,
        particleLifetime: 8,
        emissionRate: 40
      });
    }

    // Initialize parachute system
    if (this.options.enableParachutes) {
      this.parachuteSystem = new ParachuteSystem(this.scene);
      
      // Pre-create parachute meshes
      this.drogueChute = this.parachuteSystem.createParachute('drogue');
      this.mainChute = this.parachuteSystem.createParachute('main');
      this.scene.add(this.drogueChute);
      this.scene.add(this.mainChute);
    }

    // Initialize stage separation system
    if (this.options.enableStaging) {
      this.stagingSystem = new StageSeparationSystem(this.scene);
    }

    // Initialize terrain system
    if (this.options.enableTerrain) {
      this.terrainSystem = new TerrainSystem(this.scene, {
        size: this.options.gridSize,
        resolution: 64,
        maxElevation: 80,
        enableTrees: true,
        enableBuildings: true,
        treeCount: 150,
        buildingCount: 12,
        launchSiteClearRadius: 100
      });
      // Terrain is generated on demand via generateTerrain()
    }

    // Initialize wind visualization system
    if (this.options.enableWind) {
      this.windSystem = new WindVisualizationSystem(this.scene, {
        gridSize: this.options.gridSize * 0.8,
        gridResolution: 8,
        arrowSize: 12,
        maxAltitude: 400,
        altitudeLayers: 4,
        particleCount: 80
      });
      // Wind is generated on demand via generateWind()
    }

    // Initialize trajectory inspector (click-to-inspect)
    if (this.options.enableInspector) {
      this.trajectoryInspector = new TrajectoryInspector(this, {
        markerSize: 1.5,
        markerSpacing: 5,
        enableHover: true
      });
    }

    // Initialize telemetry HUD
    if (this.options.enableHUD) {
      this.telemetryHUD = new TelemetryHUD(this.container, {
        position: 'top-left'
      });
    }

    // Initialize force vector visualization
    if (this.options.enableForceVectors) {
      this.forceVectors = new ForceVectorSystem(this.scene, {
        showThrust: true,
        showDrag: true,
        showGravity: true,
        showVelocity: true,
        showNetForce: false
      });
      this.forceVectors.setVisible(false); // Hidden until explicitly shown
    }

    // Initialize Mach cone effect
    if (this.options.enableMachCone) {
      this.machCone = new MachConeEffect(this.scene);
    }

    // Initialize multi-trajectory system
    if (this.options.enableMultiTrajectory) {
      this.multiTrajectory = new MultiTrajectorySystem(this.scene);
      this.multiTrajectory.setContainer(this.container);
    }

    // Initialize safe zone overlay
    if (this.options.enableSafeZone) {
      this.safeZone = new SafeZoneOverlay(this.scene, {
        launchRadius: 30,
        warningRadius: 100,
        showLandingEllipse: true,
        showSafetyCircles: true
      });
    }

    // Initialize attitude indicator widget
    if (this.options.enableAttitudeIndicator) {
      this.attitudeIndicator = new AttitudeIndicatorWidget(this.container, {
        size: 120,
        position: 'bottom-right'
      });
      this.attitudeIndicator.setVisible(false); // Hidden by default
    }

    // Initialize heating indicator
    if (this.options.enableHeating) {
      this.heatingIndicator = new HeatingIndicator(this.scene, {
        maxTemp: 500,
        enabled: false // Disabled by default
      });
    }

    // Initialize weather effects
    if (this.options.enableWeatherEffects) {
      this.weatherEffects = new WeatherEffectsSystem(this.scene, {
        enableClouds: true,
        enableFog: true,
        enableRain: true,
        enableSnow: true
      });
    }

    // Initialize skybox
    if (this.options.enableSkybox) {
      this.skybox = new SkyboxSystem(this.scene, {
        timeOfDay: 12,
        enableStars: true,
        enableSun: true
      });
    }

    // Initialize first person camera
    if (this.options.enableFirstPerson) {
      this.firstPersonCamera = new FirstPersonCamera(this, {
        fov: 90,
        lookAhead: true
      });
    }

    // Initialize KML exporter
    if (this.options.enableKMLExport) {
      this.kmlExporter = new KMLExporter({
        includeMarkers: true
      });
    }

    log.debug('Effect systems initialized');
  }

  initCamera() {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(60, aspect, 0.1, 10000);
    this.camera.position.set(50, 30, 50);
    this.camera.lookAt(0, 0, 0);

    // Store camera modes
    this.cameraMode = 'orbit'; // orbit, follow, chase, side
  }

  initRenderer() {
    this.renderer = new THREE.WebGLRenderer({ 
      antialias: this.options.antialias,
      alpha: true
    });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    this.container.appendChild(this.renderer.domElement);
  }

  initLights() {
    // Ambient light
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    // Main directional light (sun)
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(100, 200, 100);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 500;
    sun.shadow.camera.left = -100;
    sun.shadow.camera.right = 100;
    sun.shadow.camera.top = 100;
    sun.shadow.camera.bottom = -100;
    this.scene.add(sun);

    // Hemisphere light for sky/ground colors
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x3d5c3d, 0.3);
    this.scene.add(hemi);
  }

  initGround() {
    // Ground plane
    const groundGeometry = new THREE.PlaneGeometry(
      this.options.gridSize, 
      this.options.gridSize
    );
    const groundMaterial = new THREE.MeshLambertMaterial({ 
      color: this.options.groundColor,
      side: THREE.DoubleSide
    });
    this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    // Grid helper
    if (this.options.showGrid) {
      this.grid = new THREE.GridHelper(
        this.options.gridSize, 
        this.options.gridDivisions,
        0x444444,
        0x666666
      );
      this.grid.position.y = 0.1;
      this.scene.add(this.grid);
    }

    // Axes helper
    if (this.options.showAxes) {
      const axes = new THREE.AxesHelper(50);
      this.scene.add(axes);
    }

    // Launch pad
    this.createLaunchPad();
  }

  createLaunchPad() {
    const padGroup = new THREE.Group();
    
    // Pad base
    const padGeometry = new THREE.CylinderGeometry(3, 3, 0.3, 32);
    const padMaterial = new THREE.MeshLambertMaterial({ color: 0x888888 });
    const pad = new THREE.Mesh(padGeometry, padMaterial);
    pad.position.y = 0.15;
    pad.receiveShadow = true;
    padGroup.add(pad);

    // Launch rail
    const railGeometry = new THREE.BoxGeometry(0.1, 2, 0.1);
    const railMaterial = new THREE.MeshLambertMaterial({ color: 0x444444 });
    const rail = new THREE.Mesh(railGeometry, railMaterial);
    rail.position.y = 1.3;
    rail.castShadow = true;
    padGroup.add(rail);

    // Blast deflector
    const deflectorGeometry = new THREE.ConeGeometry(1.5, 0.5, 32, 1, true);
    const deflectorMaterial = new THREE.MeshLambertMaterial({ 
      color: 0x333333,
      side: THREE.DoubleSide
    });
    const deflector = new THREE.Mesh(deflectorGeometry, deflectorMaterial);
    deflector.position.y = 0.4;
    deflector.rotation.x = Math.PI;
    padGroup.add(deflector);

    this.launchPad = padGroup;
    this.scene.add(padGroup);
  }

  initControls() {
    // Check if OrbitControls is available
    if (typeof THREE.OrbitControls !== 'undefined') {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.maxPolarAngle = Math.PI / 2 - 0.1;
      this.controls.minDistance = 5;
      this.controls.maxDistance = 2000;
    } else {
      log.warn('OrbitControls not available, using basic controls');
      this.setupBasicControls();
    }
  }

  setupBasicControls() {
    // Basic mouse controls fallback
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    this.renderer.domElement.addEventListener('mousedown', (e) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    this.renderer.domElement.addEventListener('mousemove', (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - previousMousePosition.x;
      const deltaY = e.clientY - previousMousePosition.y;

      // Rotate camera around target
      const spherical = new THREE.Spherical();
      spherical.setFromVector3(this.camera.position);
      spherical.theta -= deltaX * 0.01;
      spherical.phi -= deltaY * 0.01;
      spherical.phi = Math.max(0.1, Math.min(Math.PI / 2 - 0.1, spherical.phi));

      this.camera.position.setFromSpherical(spherical);
      this.camera.lookAt(0, 0, 0);

      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    this.renderer.domElement.addEventListener('mouseup', () => {
      isDragging = false;
    });

    this.renderer.domElement.addEventListener('wheel', (e) => {
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      this.camera.position.multiplyScalar(factor);
    });
  }

  // ============================================
  // Rocket Model Creation
  // ============================================

  setRocket(rocketConfig, stabilityData = null) {
    this.rocket = rocketConfig;
    
    // Remove existing rocket
    if (this.rocketMesh) {
      this.scene.remove(this.rocketMesh);
    }

    // Create new rocket mesh
    this.rocketMesh = this.createRocketMesh(rocketConfig);
    this.scene.add(this.rocketMesh);

    // Add stability markers if available
    if (stabilityData) {
      this.addStabilityMarkers(stabilityData);
    }

    // Position rocket on launch pad
    this.resetRocketPosition();

    log.debug('Rocket model created');
  }

  createRocketMesh(config) {
    const group = new THREE.Group();
    
    // Scale factor: mm to meters, then scale for visibility
    const scale = 0.001 * 10; // 10x actual size for visibility
    
    const bodyRadius = (config.bodyDiameter || 50) * scale / 2;
    const bodyLength = (config.bodyLength || 300) * scale;
    const noseLength = (config.noseLength || 80) * scale;
    const finRoot = (config.finRoot || 60) * scale;
    const finTip = (config.finTip || 30) * scale;
    const finSpan = (config.finSpan || 50) * scale;
    const finSweep = (config.finSweep || 20) * scale;
    const finCount = config.finCount || 3;

    // Materials
    const bodyMaterial = new THREE.MeshPhongMaterial({ 
      color: config.color || 0xff4444,
      shininess: 60
    });
    const noseMaterial = new THREE.MeshPhongMaterial({ 
      color: config.noseColor || 0xffffff,
      shininess: 80
    });
    const finMaterial = new THREE.MeshPhongMaterial({ 
      color: config.finColor || 0x333333,
      shininess: 40,
      side: THREE.DoubleSide
    });

    // Body tube
    const bodyGeometry = new THREE.CylinderGeometry(
      bodyRadius, bodyRadius, bodyLength, 32
    );
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = bodyLength / 2;
    body.castShadow = true;
    group.add(body);

    // Nose cone
    const noseGeometry = this.createNoseConeGeometry(
      config.noseShape || 'ogive',
      bodyRadius,
      noseLength
    );
    const nose = new THREE.Mesh(noseGeometry, noseMaterial);
    nose.position.y = bodyLength + noseLength / 2;
    nose.castShadow = true;
    group.add(nose);

    // Fins
    for (let i = 0; i < finCount; i++) {
      const fin = this.createFinMesh(finRoot, finTip, finSpan, finSweep, finMaterial);
      const angle = (i / finCount) * Math.PI * 2;
      fin.position.y = finRoot / 2;
      fin.position.x = Math.cos(angle) * bodyRadius;
      fin.position.z = Math.sin(angle) * bodyRadius;
      fin.rotation.y = -angle + Math.PI / 2;
      fin.castShadow = true;
      group.add(fin);
    }

    // Motor mount (visible at bottom)
    const motorGeometry = new THREE.CylinderGeometry(
      bodyRadius * 0.6, bodyRadius * 0.5, bodyLength * 0.1, 16
    );
    const motorMaterial = new THREE.MeshPhongMaterial({ color: 0x222222 });
    const motor = new THREE.Mesh(motorGeometry, motorMaterial);
    motor.position.y = -bodyLength * 0.05;
    group.add(motor);

    // Nozzle
    const nozzleGeometry = new THREE.ConeGeometry(
      bodyRadius * 0.3, bodyLength * 0.05, 16
    );
    const nozzleMaterial = new THREE.MeshPhongMaterial({ color: 0x111111 });
    const nozzle = new THREE.Mesh(nozzleGeometry, nozzleMaterial);
    nozzle.position.y = -bodyLength * 0.05;
    nozzle.rotation.x = Math.PI;
    group.add(nozzle);

    // Store total length for reference
    group.userData.totalLength = bodyLength + noseLength;
    group.userData.bodyRadius = bodyRadius;

    return group;
  }

  createNoseConeGeometry(shape, radius, length) {
    const segments = 32;
    const points = [];

    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      let r;

      switch (shape) {
        case 'conical':
          r = radius * (1 - t);
          break;
        case 'ogive':
          // Tangent ogive
          const rho = (radius * radius + length * length) / (2 * radius);
          r = Math.sqrt(rho * rho - Math.pow(length * t - length, 2)) - (rho - radius);
          r = Math.max(0, r);
          break;
        case 'parabolic':
          r = radius * (1 - t * t);
          break;
        case 'elliptical':
          r = radius * Math.sqrt(1 - t * t);
          break;
        case 'haack':
          // Von Karman (LD-Haack)
          const theta = Math.acos(1 - 2 * t);
          r = radius * Math.sqrt((theta - Math.sin(2 * theta) / 2) / Math.PI);
          break;
        default:
          r = radius * (1 - t);
      }

      points.push(new THREE.Vector2(r, t * length - length / 2));
    }

    return new THREE.LatheGeometry(points, 32);
  }

  createFinMesh(root, tip, span, sweep, material) {
    // Create fin shape
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(root, 0);
    shape.lineTo(root - sweep + tip, span);
    shape.lineTo(root - sweep, span);
    shape.lineTo(0, 0);

    const extrudeSettings = {
      steps: 1,
      depth: 0.02, // Fin thickness
      bevelEnabled: true,
      bevelThickness: 0.005,
      bevelSize: 0.005,
      bevelSegments: 2
    };

    const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
    geometry.center();
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.rotation.z = Math.PI / 2;
    
    return mesh;
  }

  addStabilityMarkers(stabilityData) {
    // Remove existing markers
    if (this.cgMarker) this.rocketMesh.remove(this.cgMarker);
    if (this.cpMarker) this.rocketMesh.remove(this.cpMarker);

    const scale = 0.001 * 10;
    const bodyRadius = this.rocketMesh.userData.bodyRadius;

    // CG marker (blue sphere)
    if (stabilityData.cg !== undefined) {
      const cgGeometry = new THREE.SphereGeometry(bodyRadius * 0.5, 16, 16);
      const cgMaterial = new THREE.MeshBasicMaterial({ 
        color: 0x0066ff,
        transparent: true,
        opacity: 0.7
      });
      this.cgMarker = new THREE.Mesh(cgGeometry, cgMaterial);
      this.cgMarker.position.y = stabilityData.cg * scale;
      this.rocketMesh.add(this.cgMarker);

      // CG label line
      const cgLineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, stabilityData.cg * scale, 0),
        new THREE.Vector3(bodyRadius * 3, stabilityData.cg * scale, 0)
      ]);
      const cgLine = new THREE.Line(cgLineGeometry, new THREE.LineBasicMaterial({ color: 0x0066ff }));
      this.rocketMesh.add(cgLine);
    }

    // CP marker (red sphere)
    if (stabilityData.cp !== undefined) {
      const cpGeometry = new THREE.SphereGeometry(bodyRadius * 0.5, 16, 16);
      const cpMaterial = new THREE.MeshBasicMaterial({ 
        color: 0xff0066,
        transparent: true,
        opacity: 0.7
      });
      this.cpMarker = new THREE.Mesh(cpGeometry, cpMaterial);
      this.cpMarker.position.y = stabilityData.cp * scale;
      this.rocketMesh.add(this.cpMarker);

      // CP label line
      const cpLineGeometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, stabilityData.cp * scale, 0),
        new THREE.Vector3(-bodyRadius * 3, stabilityData.cp * scale, 0)
      ]);
      const cpLine = new THREE.Line(cpLineGeometry, new THREE.LineBasicMaterial({ color: 0xff0066 }));
      this.rocketMesh.add(cpLine);
    }
  }

  resetRocketPosition() {
    if (!this.rocketMesh) return;
    
    // Calculate base Y position (terrain height if available)
    let baseY = 0.5;
    if (this.terrainSystem && this.terrainSystem.heightMap) {
      const terrainHeight = this.terrainSystem.getHeightAt(0, 0) || 0;
      baseY = terrainHeight + (this.rocketLength || 0) / 2 + 0.5;
    }
    
    this.rocketMesh.position.set(0, baseY, 0);
    this.rocketMesh.rotation.set(0, 0, 0);
  }

  // ============================================
  // Trajectory Visualization
  // ============================================

  setTrajectory(simulationResult) {
    this.trajectory = simulationResult;
    
    // Remove existing trajectory
    if (this.trajectoryLine) {
      this.scene.remove(this.trajectoryLine);
    }
    if (this.landingMarker) {
      this.scene.remove(this.landingMarker);
    }

    if (!simulationResult || !simulationResult.trajectory || simulationResult.trajectory.length < 2) {
      log.warn('No valid trajectory data');
      return;
    }

    // Create trajectory line with velocity coloring
    this.trajectoryLine = this.createTrajectoryLine(simulationResult);
    this.scene.add(this.trajectoryLine);

    // Add landing marker
    this.addLandingMarker(simulationResult);

    // Add event markers
    this.addEventMarkers(simulationResult);

    // Update trajectory inspector with clickable markers
    if (this.trajectoryInspector) {
      this.trajectoryInspector.setTrajectory(simulationResult);
    }

    log.debug('Trajectory visualized:', simulationResult.trajectory.length, 'points');
  }

  createTrajectoryLine(simResult) {
    const trajectory = simResult.trajectory;
    const maxVelocity = simResult.maxVelocity || 100;
    
    // Get terrain offset
    let terrainOffset = 0;
    if (this.terrainSystem && this.terrainSystem.heightMap) {
      terrainOffset = this.terrainSystem.getHeightAt(0, 0) || 0;
    }

    // Create points and colors
    const points = [];
    const colors = [];

    trajectory.forEach(point => {
      // Convert coordinates: x=downrange, y=altitude, z=crossrange
      points.push(new THREE.Vector3(
        point.x || 0,
        (point.altitude || 0) + terrainOffset,
        point.y || 0
      ));

      // Color by velocity
      const color = ColorUtils.velocityToColor(point.velocity || 0, maxVelocity);
      colors.push(color.r, color.g, color.b);
    });

    // Create geometry
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    // Create material
    const material = new THREE.LineBasicMaterial({
      vertexColors: true,
      linewidth: 2
    });

    // Create line
    const line = new THREE.Line(geometry, material);
    
    // Also create a tube for better visibility
    if (points.length > 2) {
      const curve = new THREE.CatmullRomCurve3(points);
      const tubeGeometry = new THREE.TubeGeometry(curve, points.length, 0.5, 8, false);
      
      // Apply colors to tube
      const tubeColors = [];
      const tubePositions = tubeGeometry.attributes.position.array;
      for (let i = 0; i < tubePositions.length; i += 3) {
        const y = tubePositions[i + 1];
        const color = ColorUtils.altitudeToColor(y, simResult.apogee || 100);
        tubeColors.push(color.r, color.g, color.b);
      }
      tubeGeometry.setAttribute('color', new THREE.Float32BufferAttribute(tubeColors, 3));
      
      const tubeMaterial = new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.6
      });
      
      const tube = new THREE.Mesh(tubeGeometry, tubeMaterial);
      line.add(tube);
    }

    return line;
  }

  addLandingMarker(simResult) {
    const landingX = simResult.landingX || simResult.landingDistance || 0;
    const landingZ = simResult.landingY || 0;
    
    // Get terrain height at landing position
    let landingY = 0.2;
    if (this.terrainSystem && this.terrainSystem.heightMap) {
      landingY = (this.terrainSystem.getHeightAt(landingX, landingZ) || 0) + 0.2;
    }

    // Landing zone circle
    const ringGeometry = new THREE.RingGeometry(3, 5, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({ 
      color: 0xff0000,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.5
    });
    this.landingMarker = new THREE.Mesh(ringGeometry, ringMaterial);
    this.landingMarker.rotation.x = -Math.PI / 2;
    this.landingMarker.position.set(landingX, landingY, landingZ);
    this.scene.add(this.landingMarker);

    // Landing pin
    const pinGeometry = new THREE.ConeGeometry(1, 3, 8);
    const pinMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const pin = new THREE.Mesh(pinGeometry, pinMaterial);
    pin.position.y = 1.5;
    this.landingMarker.add(pin);
  }

  addEventMarkers(simResult) {
    if (!simResult.events) return;

    // Remove existing event markers
    if (this.eventMarkers) {
      this.eventMarkers.forEach(m => this.scene.remove(m));
    }
    this.eventMarkers = [];

    const trajectory = simResult.trajectory;

    simResult.events.forEach(event => {
      // Find trajectory point closest to event time
      const point = trajectory.find(p => Math.abs(p.time - event.time) < 0.1) || 
                    { x: 0, altitude: event.altitude || 0, y: 0 };

      // Create marker based on event type
      let markerColor = 0xffff00;
      let markerSize = 2;

      switch (event.event?.toLowerCase()) {
        case 'apogee':
          markerColor = 0xff0000;
          markerSize = 3;
          break;
        case 'burnout':
        case 'motor burnout':
          markerColor = 0xff6600;
          break;
        case 'drogue deploy':
        case 'drogue':
          markerColor = 0xff9900;
          break;
        case 'main deploy':
        case 'main':
          markerColor = 0x00ff00;
          break;
        case 'liftoff':
        case 'launch':
          markerColor = 0x00ffff;
          break;
      }

      const geometry = new THREE.SphereGeometry(markerSize, 16, 16);
      const material = new THREE.MeshBasicMaterial({ 
        color: markerColor,
        transparent: true,
        opacity: 0.8
      });
      const marker = new THREE.Mesh(geometry, material);
      marker.position.set(point.x || 0, point.altitude || event.altitude || 0, point.y || 0);
      
      this.scene.add(marker);
      this.eventMarkers.push(marker);
    });
  }

  // ============================================
  // Flight Replay Animation
  // ============================================

  playFlight() {
    if (!this.trajectory || !this.trajectory.trajectory) {
      log.warn('No trajectory to play');
      return;
    }

    this.isPlaying = true;
    this.currentTime = 0;
    this.lastFrameTime = performance.now();
    this.triggeredEvents = new Set();

    // Show exhaust
    this.createExhaust();

    // Start smoke trail
    if (this.smokeTrail) {
      this.smokeTrail.start();
    }

    // Reset parachutes
    if (this.parachuteSystem) {
      this.parachuteSystem.reset();
      if (this.drogueChute) {
        this.drogueChute.visible = false;
        this.drogueChute.scale.set(0.1, 0.1, 0.1);
      }
      if (this.mainChute) {
        this.mainChute.visible = false;
        this.mainChute.scale.set(0.1, 0.1, 0.1);
      }
    }

    // Reset staging
    if (this.stagingSystem) {
      this.stagingSystem.reset();
      
      // Configure stages if multi-stage data available
      if (this.trajectory.stages) {
        this.stagingSystem.setStageConfigurations(this.trajectory.stages);
      }
    }

    log.debug('Flight playback started');
  }

  pauseFlight() {
    this.isPlaying = false;
    
    // Pause smoke emission
    if (this.smokeTrail) {
      this.smokeTrail.stop();
    }
    
    log.debug('Flight playback paused');
  }

  stopFlight() {
    this.isPlaying = false;
    this.currentTime = 0;
    this.resetRocketPosition();
    this.triggeredEvents = new Set();
    
    // Remove exhaust
    if (this.exhaustParticles) {
      this.rocketMesh?.remove(this.exhaustParticles);
      this.exhaustParticles = null;
    }

    // Clear smoke trail
    if (this.smokeTrail) {
      this.smokeTrail.stop();
      this.smokeTrail.clear();
    }

    // Reset parachutes
    if (this.parachuteSystem) {
      this.parachuteSystem.reset();
    }
    if (this.drogueChute) {
      this.drogueChute.visible = false;
    }
    if (this.mainChute) {
      this.mainChute.visible = false;
    }

    // Reset separated stages
    if (this.stagingSystem) {
      this.stagingSystem.reset();
    }

    log.debug('Flight playback stopped');
  }

  setPlaybackSpeed(speed) {
    this.playbackSpeed = speed;
    log.debug('Playback speed:', speed);
  }

  seekTo(time) {
    this.currentTime = time;
    this.updateRocketFromTrajectory();
  }

  createExhaust() {
    if (!this.rocketMesh) return;

    // Enhanced exhaust with inner flame and outer glow
    const exhaustGroup = new THREE.Group();

    // Inner flame (bright yellow-white)
    const innerGeometry = new THREE.ConeGeometry(0.2, 1.5, 8);
    const innerMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      transparent: true,
      opacity: 0.9
    });
    const innerFlame = new THREE.Mesh(innerGeometry, innerMaterial);
    innerFlame.position.y = -0.75;
    innerFlame.rotation.x = Math.PI;
    exhaustGroup.add(innerFlame);

    // Outer flame (orange)
    const outerGeometry = new THREE.ConeGeometry(0.35, 2.5, 8);
    const outerMaterial = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.7
    });
    const outerFlame = new THREE.Mesh(outerGeometry, outerMaterial);
    outerFlame.position.y = -1.25;
    outerFlame.rotation.x = Math.PI;
    exhaustGroup.add(outerFlame);

    // Shock diamonds (bright spots in exhaust)
    for (let i = 0; i < 3; i++) {
      const diamondGeometry = new THREE.SphereGeometry(0.15 - i * 0.03, 8, 6);
      const diamondMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8 - i * 0.2
      });
      const diamond = new THREE.Mesh(diamondGeometry, diamondMaterial);
      diamond.position.y = -1.5 - i * 0.5;
      exhaustGroup.add(diamond);
    }

    exhaustGroup.position.y = -0.5;
    this.exhaustParticles = exhaustGroup;
    this.rocketMesh.add(exhaustGroup);
  }

  updateRocketFromTrajectory() {
    if (!this.rocketMesh || !this.trajectory?.trajectory) return;

    const trajectory = this.trajectory.trajectory;
    
    // Find current position by interpolating trajectory
    let point1 = trajectory[0];
    let point2 = trajectory[1];
    let pointIndex = 0;
    
    for (let i = 0; i < trajectory.length - 1; i++) {
      if (trajectory[i].time <= this.currentTime && trajectory[i + 1].time >= this.currentTime) {
        point1 = trajectory[i];
        point2 = trajectory[i + 1];
        pointIndex = i;
        break;
      }
    }

    // Interpolate
    const t = (this.currentTime - point1.time) / (point2.time - point1.time || 1);
    const x = point1.x + (point2.x - point1.x) * t || 0;
    let y = point1.altitude + (point2.altitude - point1.altitude) * t || 0;
    const z = (point1.y || 0) + ((point2.y || 0) - (point1.y || 0)) * t;

    // Add terrain offset if terrain is generated
    if (this.terrainSystem && this.terrainSystem.heightMap) {
      const terrainHeight = this.terrainSystem.getHeightAt(0, 0) || 0;
      y += terrainHeight;
    }

    // Update position
    this.rocketMesh.position.set(x, y, z);

    // Calculate velocity vector
    const dt = point2.time - point1.time || 1;
    const vx = (point2.x - point1.x) / dt || 0;
    const vy = (point2.altitude - point1.altitude) / dt || 0;
    const vz = ((point2.y || 0) - (point1.y || 0)) / dt || 0;

    // Store current velocity for effects
    this.currentVelocity = { x: vx, y: vy, z: vz };

    // Calculate current velocity magnitude
    const velocity = point1.velocity + (point2.velocity - point1.velocity) * t || 
                     Math.sqrt(vx * vx + vy * vy + vz * vz);
    const acceleration = point1.acceleration !== undefined && point2.acceleration !== undefined
                        ? point1.acceleration + (point2.acceleration - point1.acceleration) * t
                        : (point2.velocity - point1.velocity) / dt || 0;
    const mach = velocity / 343; // Speed of sound at sea level

    // Calculate pitch angle from velocity
    const pitch = Math.atan2(vy, Math.sqrt(vx * vx + vz * vz)) * 180 / Math.PI;

    if (vy !== 0 || vx !== 0 || vz !== 0) {
      const velocityVec = new THREE.Vector3(vx, vy, vz).normalize();
      const up = new THREE.Vector3(0, 1, 0);
      
      // Calculate rotation to align with velocity
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(up, velocityVec);
      this.rocketMesh.quaternion.copy(quaternion);
    }

    // Determine if powered flight
    const burnoutEvent = this.trajectory.events?.find(e => 
      e.event?.toLowerCase().includes('burnout') ||
      e.event?.toLowerCase().includes('motor burnout'));
    const burnTime = burnoutEvent?.time || 3;
    const isPowered = this.currentTime < burnTime;

    // Determine flight phase
    let phase = 'coasting';
    if (isPowered) phase = 'powered';
    else if (y === this.trajectory.apogee || (vy < 1 && vy > -1)) phase = 'apogee';
    else if (vy < 0 && y > 100) phase = 'descent';
    else if (y < 10) phase = 'landed';

    // Get thrust and drag from trajectory data if available
    const thrust = isPowered ? (point1.thrust || this.trajectory.maxThrust || 100) : 0;
    const drag = point1.drag || (0.5 * 1.225 * velocity * velocity * 0.01); // Estimate if not available
    const mass = this.trajectory.liftoffMass || this.rocket?.getTotalMass?.() || 1;

    // Update exhaust visibility
    if (this.exhaustParticles) {
      this.exhaustParticles.visible = isPowered;
      
      // Animate exhaust
      if (isPowered) {
        this.exhaustParticles.children.forEach((child, i) => {
          if (i < 2) {
            // Flames
            child.scale.y = 1 + Math.random() * 0.3;
            child.material.opacity = 0.6 + Math.random() * 0.3;
          } else {
            // Shock diamonds
            child.material.opacity = 0.5 + Math.random() * 0.4;
          }
        });
      }
    }

    // Emit smoke particles
    if (this.smokeTrail && this.isPlaying) {
      // Get exhaust position in world coordinates
      const exhaustPos = this.rocketMesh.position.clone();
      const exhaustOffset = new THREE.Vector3(0, -1, 0);
      exhaustOffset.applyQuaternion(this.rocketMesh.quaternion);
      exhaustPos.add(exhaustOffset);
      
      this.smokeTrail.emit(exhaustPos, this.currentVelocity, isPowered);
    }

    // Update Telemetry HUD
    if (this.telemetryHUD) {
      this.telemetryHUD.update({
        time: this.currentTime,
        altitude: y,
        velocity: velocity,
        acceleration: acceleration,
        mach: mach,
        phase: phase,
        pitch: pitch,
        isPlaying: this.isPlaying,
        dynamicPressure: 0.5 * 1.225 * velocity * velocity
      });
    }

    // Update Force Vectors
    if (this.forceVectors && this.forceVectors.isVisible) {
      this.forceVectors.update(this.rocketMesh.position, {
        thrust: thrust,
        drag: drag,
        mass: mass,
        velocity: velocity,
        velocityVector: { x: vx, y: vy, z: vz },
        pitch: 90 + pitch, // Convert to angle from horizontal
        verticalVelocity: vy
      });
    }

    // Update Mach Cone
    if (this.machCone) {
      this.machCone.update(this.rocketMesh.position, mach, this.lastDeltaTime);
    }

    // Update Attitude Indicator
    if (this.attitudeIndicator && this.attitudeIndicator.isVisible) {
      // Calculate roll from velocity cross-track
      const roll = Math.atan2(vz, vy) * 180 / Math.PI;
      // Calculate heading from velocity
      const heading = Math.atan2(vx, vz) * 180 / Math.PI;
      this.attitudeIndicator.update(pitch, roll, (heading + 360) % 360);
    }

    // Update Heating Indicator
    if (this.heatingIndicator && this.heatingIndicator.isEnabled) {
      const heatData = this.heatingIndicator.update({
        velocity: velocity,
        altitude: y,
        mach: mach
      });
      
      // Store for UI access
      this.currentHeatData = heatData;
    }

    // Update First Person Camera
    if (this.firstPersonCamera && this.firstPersonCamera.isActive) {
      this.firstPersonCamera.update(this.rocketMesh, this.currentVelocity);
      // Skip other camera updates when in FPV mode
    } else {
      // Update camera based on mode
      if (this.cameraMode === 'follow') {
        this.updateFollowCamera();
      } else if (this.cameraMode === 'chase') {
        this.updateChaseCamera();
      } else if (this.cameraMode === 'side') {
        this.updateSideCamera();
      } else if (this.cameraMode === 'ground') {
        this.updateGroundCamera();
      }
    }

    // Check for events (parachutes, staging)
    this.checkFlightEvents();
  }

  checkFlightEvents() {
    if (!this.trajectory?.events) return;

    this.trajectory.events.forEach(event => {
      const eventKey = `${event.event}-${event.time.toFixed(2)}`;
      
      // Skip already triggered events
      if (this.triggeredEvents.has(eventKey)) return;
      
      // Check if event should trigger now
      if (this.currentTime >= event.time) {
        this.triggeredEvents.add(eventKey);
        this.handleFlightEvent(event);
      }
    });
  }

  handleFlightEvent(event) {
    const eventName = (event.event || '').toLowerCase();
    
    log.debug(`Event triggered: ${event.event} at T+${event.time.toFixed(1)}s`);

    // Drogue deployment
    if (eventName.includes('drogue') || eventName.includes('apogee')) {
      if (this.drogueChute && this.parachuteSystem) {
        this.parachuteSystem.deploy(
          this.drogueChute,
          this.rocketMesh.position.clone(),
          this.rocketMesh
        );
        log.debug('Drogue chute deployed');
      }
    }

    // Main chute deployment
    if (eventName.includes('main') && !eventName.includes('main stage')) {
      if (this.mainChute && this.parachuteSystem) {
        this.parachuteSystem.deploy(
          this.mainChute,
          this.rocketMesh.position.clone(),
          this.rocketMesh
        );
        log.debug('Main chute deployed');
      }
    }

    // Stage separation
    if (eventName.includes('separation') || eventName.includes('staging')) {
      if (this.stagingSystem) {
        // Extract stage number from event if available
        const stageMatch = eventName.match(/stage\s*(\d+)/i);
        const stageNumber = stageMatch ? parseInt(stageMatch[1]) : 1;
        
        this.stagingSystem.separate(
          stageNumber,
          this.rocketMesh.position.clone(),
          this.currentVelocity,
          this.rocketMesh.quaternion.clone()
        );
        log.debug(`Stage ${stageNumber} separated`);
      }
    }

    // Booster separation (for multi-stage with strap-on boosters)
    if (eventName.includes('booster')) {
      if (this.stagingSystem) {
        this.stagingSystem.separate(
          0, // Booster stage number
          this.rocketMesh.position.clone(),
          this.currentVelocity,
          this.rocketMesh.quaternion.clone()
        );
        log.debug('Booster separated');
      }
    }
  }

  // ============================================
  // Camera Controls
  // ============================================

  setCameraMode(mode) {
    // Deactivate FPV if switching away from it
    if (this.cameraMode === 'fpv' && mode !== 'fpv') {
      if (this.firstPersonCamera && this.firstPersonCamera.isActive) {
        this.firstPersonCamera.deactivate();
      }
    }
    
    this.cameraMode = mode;
    
    switch (mode) {
      case 'orbit':
        if (this.controls) {
          this.controls.enabled = true;
        }
        break;
      case 'fpv':
        if (this.firstPersonCamera) {
          this.firstPersonCamera.activate();
        }
        if (this.controls) {
          this.controls.enabled = false;
        }
        break;
      case 'follow':
      case 'chase':
      case 'side':
      case 'ground':
        if (this.controls) {
          this.controls.enabled = false;
        }
        break;
    }

    log.debug('Camera mode:', mode);
  }

  updateFollowCamera() {
    if (!this.rocketMesh) return;
    
    const target = this.rocketMesh.position.clone();
    
    // Scale offset based on altitude - further away when higher
    const altitude = Math.max(target.y, 10);
    const scaleFactor = Math.max(1, altitude / 100);
    
    // Offset scales with altitude but keeps reasonable proportions
    const baseOffset = 50;
    const offset = new THREE.Vector3(
      baseOffset * scaleFactor,
      baseOffset * scaleFactor * 0.5,
      baseOffset * scaleFactor
    );
    
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
  }

  updateChaseCamera() {
    if (!this.rocketMesh) return;
    
    const target = this.rocketMesh.position.clone();
    
    // Get rocket's up direction (nose direction)
    const rocketUp = new THREE.Vector3(0, 1, 0);
    rocketUp.applyQuaternion(this.rocketMesh.quaternion);
    
    // Scale distance based on altitude
    const altitude = Math.max(target.y, 10);
    const distance = Math.max(30, altitude * 0.15);
    
    // Position camera behind and slightly below the rocket
    const offset = rocketUp.clone().multiplyScalar(-distance);
    offset.y = Math.max(offset.y, -distance * 0.5); // Don't go too far below
    
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
  }

  updateSideCamera() {
    if (!this.rocketMesh) return;
    
    const target = this.rocketMesh.position.clone();
    
    // Scale distance based on altitude
    const altitude = Math.max(target.y, 10);
    const horizontalDist = Math.max(80, altitude * 0.3);
    
    // Position camera to the side, slightly below rocket level for better view
    this.camera.position.set(
      target.x + horizontalDist,
      Math.max(target.y * 0.8, 10),
      target.z
    );
    this.camera.lookAt(target);
  }

  updateGroundCamera() {
    if (!this.rocketMesh) return;
    
    const target = this.rocketMesh.position.clone();
    
    // Fixed position on the ground, looking up at the rocket
    // Distance from launch pad scales with rocket altitude for better view
    const altitude = Math.max(target.y, 10);
    const groundDist = Math.min(100, 30 + altitude * 0.1);
    
    // Camera stays at eye level on the ground
    const eyeHeight = 1.7;
    
    this.camera.position.set(
      groundDist,
      eyeHeight,
      groundDist * 0.5
    );
    this.camera.lookAt(target);
  }

  resetCamera() {
    this.camera.position.set(50, 30, 50);
    this.camera.lookAt(0, 0, 0);
    
    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }

  focusOnApogee() {
    if (!this.trajectory) return;
    
    const apogee = this.trajectory.apogee || 100;
    const landingDist = this.trajectory.landingDistance || 50;
    
    this.camera.position.set(landingDist * 0.5, apogee * 0.8, landingDist * 0.5);
    this.camera.lookAt(landingDist * 0.3, apogee * 0.5, 0);
    
    if (this.controls) {
      this.controls.target.set(landingDist * 0.3, apogee * 0.5, 0);
      this.controls.update();
    }
  }

  // ============================================
  // Animation Loop
  // ============================================

  animate() {
    this.animationId = requestAnimationFrame(() => this.animate());

    const now = performance.now();
    const delta = this.lastFrameTime ? (now - this.lastFrameTime) / 1000 : 0.016;
    this.lastDeltaTime = delta;

    // Update playback
    if (this.isPlaying && this.trajectory) {
      this.lastFrameTime = now;

      this.currentTime += delta * this.playbackSpeed;

      // Check if flight ended
      const maxTime = this.trajectory.flightTime || 
                      this.trajectory.trajectory?.[this.trajectory.trajectory.length - 1]?.time || 30;
      
      if (this.currentTime >= maxTime) {
        this.isPlaying = false;
        this.currentTime = maxTime;
        
        // Stop smoke emission
        if (this.smokeTrail) {
          this.smokeTrail.stop();
        }
        
        // Dispatch event
        this.container.dispatchEvent(new CustomEvent('flightend'));
      }

      this.updateRocketFromTrajectory();

      // Dispatch time update
      this.container.dispatchEvent(new CustomEvent('timeupdate', { 
        detail: { time: this.currentTime, maxTime } 
      }));
    }

    // Always update effect systems (even when paused, for animations)
    
    // Update smoke trail particles
    if (this.smokeTrail) {
      this.smokeTrail.update(delta);
    }

    // Update parachutes
    if (this.parachuteSystem) {
      this.parachuteSystem.update(delta);
    }

    // Update separated stages
    if (this.stagingSystem) {
      this.stagingSystem.update(delta);
    }

    // Update wind visualization
    if (this.windSystem) {
      this.windSystem.update(delta);
    }

    // Update weather effects
    if (this.weatherEffects) {
      this.weatherEffects.update(delta);
    }

    // Update controls
    if (this.controls?.update) {
      this.controls.update();
    }

    // Render
    this.renderer.render(this.scene, this.camera);
  }

  // ============================================
  // Utilities
  // ============================================

  onResize() {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  setBackgroundColor(color) {
    this.scene.background = new THREE.Color(color);
    this.scene.fog.color = new THREE.Color(color);
  }

  toggleGrid(show) {
    if (this.grid) {
      this.grid.visible = show;
    }
  }

  dispose() {
    // Stop animation
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }

    // Remove event listeners
    window.removeEventListener('resize', this.resizeHandler);

    // Dispose effect systems
    if (this.smokeTrail) {
      this.smokeTrail.dispose();
    }
    if (this.parachuteSystem) {
      this.parachuteSystem.dispose();
    }
    if (this.stagingSystem) {
      this.stagingSystem.dispose();
    }
    if (this.terrainSystem) {
      this.terrainSystem.dispose();
    }
    if (this.windSystem) {
      this.windSystem.dispose();
    }
    if (this.trajectoryInspector) {
      this.trajectoryInspector.dispose();
    }
    if (this.telemetryHUD) {
      this.telemetryHUD.dispose();
    }
    if (this.forceVectors) {
      this.forceVectors.dispose();
    }
    if (this.machCone) {
      this.machCone.dispose();
    }
    if (this.multiTrajectory) {
      this.multiTrajectory.dispose();
    }
    if (this.safeZone) {
      this.safeZone.dispose();
    }
    if (this.attitudeIndicator) {
      this.attitudeIndicator.dispose();
    }
    if (this.heatingIndicator) {
      this.heatingIndicator.dispose();
    }
    if (this.weatherEffects) {
      this.weatherEffects.dispose();
    }
    if (this.skybox) {
      this.skybox.dispose();
    }
    if (this.firstPersonCamera) {
      this.firstPersonCamera.dispose();
    }

    // Dispose Three.js objects
    this.scene.traverse(object => {
      if (object.geometry) object.geometry.dispose();
      if (object.material) {
        if (Array.isArray(object.material)) {
          object.material.forEach(m => m.dispose());
        } else {
          object.material.dispose();
        }
      }
    });

    this.renderer.dispose();
    
    // Remove canvas
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }

    log.debug('3D Viewer disposed');
  }

  // Get current state for UI updates
  getState() {
    return {
      isPlaying: this.isPlaying,
      currentTime: this.currentTime,
      maxTime: this.trajectory?.flightTime || 0,
      playbackSpeed: this.playbackSpeed,
      cameraMode: this.cameraMode,
      hasRocket: !!this.rocketMesh,
      hasTrajectory: !!this.trajectoryLine,
      hasSmokeTrail: !!this.smokeTrail,
      hasParachutes: !!this.parachuteSystem,
      hasStaging: !!this.stagingSystem,
      hasTerrain: !!this.terrainSystem,
      hasWind: !!this.windSystem,
      hasInspector: !!this.trajectoryInspector,
      hasHUD: !!this.telemetryHUD,
      hasForceVectors: !!this.forceVectors,
      hasMachCone: !!this.machCone,
      hasMultiTrajectory: !!this.multiTrajectory,
      hasSafeZone: !!this.safeZone,
      hasAttitudeIndicator: !!this.attitudeIndicator,
      hasHeating: !!this.heatingIndicator,
      hasWeatherEffects: !!this.weatherEffects,
      hasSkybox: !!this.skybox,
      hasFirstPersonCamera: !!this.firstPersonCamera,
      hasKMLExport: !!this.kmlExporter,
      hasHeating: !!this.heatingIndicator,
      terrainGenerated: !!this.terrainSystem?.terrainMesh,
      windGenerated: !!this.windSystem?.arrowsGroup,
      trajectoryCount: this.multiTrajectory?.getTrajectoryCount() || 0,
      currentTemperature: this.heatingIndicator?.getCurrentTemperature() || 0
    };
  }

  // Configure multi-stage rocket
  setMultiStageConfig(stages) {
    if (this.stagingSystem && stages) {
      this.stagingSystem.setStageConfigurations(stages);
      log.debug('Multi-stage configuration set:', stages.length, 'stages');
    }
  }

  // Toggle effect systems
  setEffectsEnabled(options) {
    if (options.smoke !== undefined && this.smokeTrail) {
      if (options.smoke) {
        this.smokeTrail.start();
      } else {
        this.smokeTrail.stop();
      }
    }
  }

  // ============================================
  // Telemetry HUD Controls
  // ============================================

  setHUDVisible(visible) {
    if (this.telemetryHUD) {
      this.telemetryHUD.setVisible(visible);
    }
  }

  setHUDPosition(position) {
    if (this.telemetryHUD) {
      this.telemetryHUD.setPosition(position);
    }
  }

  resetHUD() {
    if (this.telemetryHUD) {
      this.telemetryHUD.reset();
    }
  }

  // ============================================
  // Force Vector Controls
  // ============================================

  setForceVectorsVisible(visible) {
    if (this.forceVectors) {
      this.forceVectors.setVisible(visible);
    }
  }

  setForceVisible(force, visible) {
    if (this.forceVectors) {
      this.forceVectors.setForceVisible(force, visible);
    }
  }

  // ============================================
  // Mach Cone Controls
  // ============================================

  setMachConeVisible(visible) {
    if (this.machCone) {
      this.machCone.setVisible(visible);
    }
  }

  getMachStatus() {
    if (this.machCone) {
      return this.machCone.getMachStatus();
    }
    return 'UNKNOWN';
  }

  // ============================================
  // Multi-Trajectory Controls
  // ============================================

  addTrajectory(trajectoryData, options = {}) {
    if (this.multiTrajectory) {
      const id = options.id || `traj_${Date.now()}`;
      return this.multiTrajectory.addTrajectory(id, trajectoryData, options);
    }
    return null;
  }

  removeTrajectory(id) {
    if (this.multiTrajectory) {
      this.multiTrajectory.removeTrajectory(id);
    }
  }

  clearAllTrajectories() {
    if (this.multiTrajectory) {
      this.multiTrajectory.clearAll();
    }
  }

  setTrajectoryVisible(id, visible) {
    if (this.multiTrajectory) {
      this.multiTrajectory.setTrajectoryVisible(id, visible);
    }
  }

  setAllTrajectoriesVisible(visible) {
    if (this.multiTrajectory) {
      this.multiTrajectory.setAllVisible(visible);
    }
  }

  // ============================================
  // Safe Zone Overlay Controls
  // ============================================

  setSafeZoneVisible(visible) {
    if (this.safeZone) {
      this.safeZone.setVisible(visible);
    }
  }

  setSafetyCirclesVisible(visible) {
    if (this.safeZone) {
      this.safeZone.setSafetyCirclesVisible(visible);
    }
  }

  setLandingPrediction(data) {
    if (this.safeZone) {
      this.safeZone.setLandingPrediction(data);
    }
  }

  addKeepOutZone(zone) {
    if (this.safeZone) {
      this.safeZone.addKeepOutZone(zone);
    }
  }

  clearKeepOutZones() {
    if (this.safeZone) {
      this.safeZone.clearKeepOutZones();
    }
  }

  setFieldBoundary(points) {
    if (this.safeZone) {
      this.safeZone.setFieldBoundary(points);
    }
  }

  // ============================================
  // Attitude Indicator Controls
  // ============================================

  setAttitudeIndicatorVisible(visible) {
    if (this.attitudeIndicator) {
      this.attitudeIndicator.setVisible(visible);
    }
  }

  setAttitudeIndicatorPosition(position) {
    if (this.attitudeIndicator) {
      this.attitudeIndicator.setPosition(position);
    }
  }

  updateAttitudeIndicator(pitch, roll, heading) {
    if (this.attitudeIndicator) {
      this.attitudeIndicator.update(pitch, roll, heading);
    }
  }

  // ============================================
  // Heating Indicator Controls
  // ============================================

  setHeatingEnabled(enabled) {
    if (this.heatingIndicator) {
      this.heatingIndicator.setEnabled(enabled);
      
      // Set rocket mesh for heating visualization
      if (enabled && this.rocketMesh && !this.heatingIndicator.rocketMesh) {
        this.heatingIndicator.setRocket(this.rocketMesh);
      }
    }
  }

  resetHeating() {
    if (this.heatingIndicator) {
      this.heatingIndicator.reset();
    }
  }

  getTemperatureStatus() {
    if (this.heatingIndicator) {
      return this.heatingIndicator.getTemperatureStatus();
    }
    return { status: 'UNKNOWN', color: '#888' };
  }

  getCurrentTemperature() {
    if (this.heatingIndicator) {
      return this.heatingIndicator.getCurrentTemperature();
    }
    return 0;
  }

  // ============================================
  // Weather Effects Controls
  // ============================================

  generateWeather(conditions = {}) {
    if (this.weatherEffects) {
      this.weatherEffects.generateWeather(conditions);
    }
  }

  clearWeather() {
    if (this.weatherEffects) {
      this.weatherEffects.clear();
    }
  }

  setWeatherVisible(visible) {
    if (this.weatherEffects) {
      this.weatherEffects.setVisible(visible);
    }
  }

  setCloudAltitude(altitude) {
    if (this.weatherEffects) {
      this.weatherEffects.setCloudAltitude(altitude);
    }
  }

  // ============================================
  // Skybox Controls
  // ============================================

  setTimeOfDay(hour) {
    if (this.skybox) {
      this.skybox.setTimeOfDay(hour);
    }
  }

  setSkyboxVisible(visible) {
    if (this.skybox) {
      this.skybox.setVisible(visible);
    }
  }

  // ============================================
  // First Person Camera Controls
  // ============================================

  activateFirstPerson() {
    if (this.firstPersonCamera) {
      this.firstPersonCamera.activate();
      this.cameraMode = 'firstPerson';
    }
  }

  deactivateFirstPerson() {
    if (this.firstPersonCamera) {
      this.firstPersonCamera.deactivate();
      this.cameraMode = 'orbit';
    }
  }

  isFirstPersonActive() {
    return this.firstPersonCamera?.isActive || false;
  }

  setFirstPersonFOV(fov) {
    if (this.firstPersonCamera) {
      this.firstPersonCamera.setFOV(fov);
    }
  }

  // ============================================
  // KML Export Controls
  // ============================================

  exportKML(metadata = {}, filename = 'flight.kml') {
    if (!this.kmlExporter) {
      log.warn('KML Exporter not available');
      return false;
    }
    if (!this.trajectory) {
      log.warn('No trajectory data to export');
      return false;
    }

    try {
      return this.kmlExporter.download(this.trajectory, {
        ...metadata,
        apogee: this.trajectory.apogee
      }, filename);
    } catch (e) {
      log.error('KML export failed:', e);
      return false;
    }
  }

  getKMLString(metadata = {}) {
    if (!this.kmlExporter || !this.trajectory) {
      return null;
    }
    return this.kmlExporter.export(this.trajectory, metadata);
  }

  // ============================================
  // Terrain Controls
  // ============================================

  generateTerrain(options = {}) {
    if (!this.terrainSystem) {
      this.terrainSystem = new TerrainSystem(this.scene, {
        size: this.options.gridSize,
        resolution: 64,
        ...options
      });
    }

    // Update options if provided
    if (options.seed !== undefined) {
      this.terrainSystem.options.seed = options.seed;
    }
    if (options.maxElevation !== undefined) {
      this.terrainSystem.options.maxElevation = options.maxElevation;
    }
    if (options.treeCount !== undefined) {
      this.terrainSystem.options.treeCount = options.treeCount;
    }
    if (options.buildingCount !== undefined) {
      this.terrainSystem.options.buildingCount = options.buildingCount;
    }

    // Hide default ground when terrain is generated
    if (this.ground) {
      this.ground.visible = false;
    }
    if (this.grid) {
      this.grid.visible = false;
    }

    this.terrainSystem.generate();
    
    // Adjust launch pad position to terrain height
    if (this.launchPad) {
      const terrainHeight = this.terrainSystem.getHeightAt(0, 0) || 0;
      this.launchPad.position.y = terrainHeight;
    }
    
    // Adjust rocket position if present
    if (this.rocketMesh && !this.isPlaying) {
      const terrainHeight = this.terrainSystem.getHeightAt(0, 0) || 0;
      this.rocketMesh.position.y = terrainHeight + this.rocketLength / 2 + 0.5;
    }
    
    log.debug('Terrain generated');
  }

  setTerrainVisible(visible) {
    if (this.terrainSystem) {
      this.terrainSystem.setVisible(visible);
    }
    // Show default ground if terrain hidden
    if (this.ground && !visible) {
      this.ground.visible = true;
    }
  }

  setTreesVisible(visible) {
    if (this.terrainSystem) {
      this.terrainSystem.setTreesVisible(visible);
    }
  }

  setBuildingsVisible(visible) {
    if (this.terrainSystem) {
      this.terrainSystem.setBuildingsVisible(visible);
    }
  }

  // ============================================
  // Wind Visualization Controls
  // ============================================

  generateWind(windData = null) {
    if (!this.windSystem) {
      this.windSystem = new WindVisualizationSystem(this.scene, {
        gridSize: this.options.gridSize * 0.8,
        gridResolution: 8
      });
    }

    // Set wind data if provided
    if (windData) {
      this.windSystem.setWindData(windData);
    }

    this.windSystem.generate();
    this.windSystem.startAnimation();
    log.debug('Wind visualization generated');
  }

  setWindData(windData) {
    if (this.windSystem) {
      this.windSystem.setWindData(windData);
    }
  }

  setWindVisible(visible) {
    if (this.windSystem) {
      this.windSystem.setVisible(visible);
      if (visible) {
        this.windSystem.startAnimation();
      } else {
        this.windSystem.stopAnimation();
      }
    }
  }

  setWindArrowsVisible(visible) {
    if (this.windSystem) {
      this.windSystem.setArrowsVisible(visible);
    }
  }

  setWindStreamlinesVisible(visible) {
    if (this.windSystem) {
      this.windSystem.setStreamlinesVisible(visible);
    }
  }

  // ============================================
  // Trajectory Inspector Controls
  // ============================================

  setInspectorEnabled(enabled) {
    if (this.trajectoryInspector) {
      this.trajectoryInspector.setEnabled(enabled);
    }
  }

  setInspectorMarkersVisible(visible) {
    if (this.trajectoryInspector) {
      this.trajectoryInspector.setMarkersVisible(visible);
    }
  }

  inspectPointAtTime(time) {
    if (this.trajectoryInspector) {
      this.trajectoryInspector.selectPointAtTime(time);
    }
  }

  getInspectorPointAtTime(time) {
    if (this.trajectoryInspector) {
      return this.trajectoryInspector.getPointAtTime(time);
    }
    return null;
  }

  hideInspectorPanel() {
    if (this.trajectoryInspector) {
      this.trajectoryInspector.hideInfoPanel();
      this.trajectoryInspector.clearSelection();
    }
  }
}

// ES Module exports
export { 
  Rocket3DViewer, 
  ColorUtils, 
  SmokeTrailSystem, 
  ParachuteSystem, 
  StageSeparationSystem,
  TerrainSystem,
  WindVisualizationSystem,
  TrajectoryInspector,
  TelemetryHUD,
  ForceVectorSystem,
  MachConeEffect,
  MultiTrajectorySystem,
  SafeZoneOverlay,
  AttitudeIndicatorWidget,
  HeatingIndicator,
  KMLExporter,
  WeatherEffectsSystem,
  SkyboxSystem,
  FirstPersonCamera
};

// Also support CommonJS and browser globals
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { 
    Rocket3DViewer, 
    ColorUtils, 
    SmokeTrailSystem, 
    ParachuteSystem, 
    StageSeparationSystem,
    TerrainSystem,
    WindVisualizationSystem,
    TrajectoryInspector,
    TelemetryHUD,
    ForceVectorSystem,
    MachConeEffect,
    MultiTrajectorySystem,
    SafeZoneOverlay,
    AttitudeIndicatorWidget,
    HeatingIndicator,
    KMLExporter,
    WeatherEffectsSystem,
    SkyboxSystem,
    FirstPersonCamera
  };
} else if (typeof window !== 'undefined') {
  window.Rocket3DViewer = Rocket3DViewer;
  window.ColorUtils3D = ColorUtils;
  window.SmokeTrailSystem = SmokeTrailSystem;
  window.ParachuteSystem = ParachuteSystem;
  window.StageSeparationSystem = StageSeparationSystem;
  window.TerrainSystem = TerrainSystem;
  window.WindVisualizationSystem = WindVisualizationSystem;
  window.TrajectoryInspector = TrajectoryInspector;
  window.TelemetryHUD = TelemetryHUD;
  window.ForceVectorSystem = ForceVectorSystem;
  window.MachConeEffect = MachConeEffect;
  window.MultiTrajectorySystem = MultiTrajectorySystem;
  window.SafeZoneOverlay = SafeZoneOverlay;
  window.AttitudeIndicatorWidget = AttitudeIndicatorWidget;
  window.HeatingIndicator = HeatingIndicator;
  window.KMLExporter = KMLExporter;
  window.WeatherEffectsSystem = WeatherEffectsSystem;
  window.SkyboxSystem = SkyboxSystem;
  window.FirstPersonCamera = FirstPersonCamera;
}

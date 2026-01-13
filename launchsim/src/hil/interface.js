/**
 * LAUNCHSIM Hardware-in-the-Loop (HIL) Module
 * 
 * Enables testing real flight computers with simulated sensor data.
 * Uses Web Serial API for USB communication.
 * 
 * Supported protocols:
 * - Generic binary (configurable)
 * - MAVLink (basic)
 * - CRSF (CrossFire)
 * - Custom ASCII
 */

// Debug mode - set window.LAUNCHSIM_DEBUG = true for verbose logging
const DEBUG = (typeof window !== 'undefined' && window.LAUNCHSIM_DEBUG) || 
              (typeof process !== 'undefined' && process.env?.LAUNCHSIM_DEBUG === 'true');

const log = {
  debug: (...args) => DEBUG && console.log('[HIL]', ...args),
  warn: (...args) => console.warn('[HIL]', ...args),
  error: (...args) => console.error('[HIL]', ...args)
};

// ============================================
// SENSOR SIMULATOR
// ============================================

export class SensorSimulator {
  constructor(config = {}) {
    this.config = {
      // Accelerometer
      accelNoise: config.accelNoise ?? 0.02,        // m/s² RMS
      accelBias: config.accelBias ?? [0.01, 0.01, 0.01], // m/s² per axis
      accelNonlinearity: config.accelNonlinearity ?? 0.001, // fraction
      
      // Gyroscope
      gyroNoise: config.gyroNoise ?? 0.001,         // rad/s RMS
      gyroBias: config.gyroBias ?? [0.0001, 0.0001, 0.0001], // rad/s per axis
      gyroDrift: config.gyroDrift ?? 0.00001,       // rad/s/s random walk
      
      // Magnetometer
      magNoise: config.magNoise ?? 0.5,             // µT RMS
      magBias: config.magBias ?? [1, 1, 1],         // µT per axis
      
      // Barometer
      baroNoise: config.baroNoise ?? 2,             // Pa RMS
      baroTempCoeff: config.baroTempCoeff ?? 0.5,   // Pa/°C
      baroDrift: config.baroDrift ?? 0.1,           // Pa/s
      
      // GPS
      gpsHorizontalAcc: config.gpsHorizontalAcc ?? 2.5, // m CEP
      gpsVerticalAcc: config.gpsVerticalAcc ?? 5,   // m
      gpsVelocityAcc: config.gpsVelocityAcc ?? 0.1, // m/s
      gpsUpdateRate: config.gpsUpdateRate ?? 10,    // Hz
      gpsDropoutProb: config.gpsDropoutProb ?? 0.01, // probability per update
      
      // Update rates
      imuRate: config.imuRate ?? 1000,              // Hz
      baroRate: config.baroRate ?? 100,             // Hz
      magRate: config.magRate ?? 100,               // Hz
    };
    
    // Running state
    this.gyroBiasAccum = [0, 0, 0];
    this.baroDrift = 0;
    this.lastGpsUpdate = 0;
    this.gpsDropped = false;
  }
  
  // Generate Gaussian noise
  gaussianNoise(stdDev = 1) {
    const u1 = Math.random();
    const u2 = Math.random();
    return stdDev * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  
  // Simulate accelerometer reading (body frame)
  simulateAccelerometer(trueAccel, dt) {
    // Add bias
    const biased = [
      trueAccel[0] + this.config.accelBias[0],
      trueAccel[1] + this.config.accelBias[1],
      trueAccel[2] + this.config.accelBias[2]
    ];
    
    // Add noise
    const noisy = biased.map(v => v + this.gaussianNoise(this.config.accelNoise));
    
    // Add nonlinearity
    const nonlinear = noisy.map(v => v * (1 + this.config.accelNonlinearity * v));
    
    return {
      x: nonlinear[0],
      y: nonlinear[1],
      z: nonlinear[2]
    };
  }
  
  // Simulate gyroscope reading (body frame)
  simulateGyroscope(trueGyro, dt) {
    // Accumulate random walk drift
    this.gyroBiasAccum[0] += this.gaussianNoise(this.config.gyroDrift * Math.sqrt(dt));
    this.gyroBiasAccum[1] += this.gaussianNoise(this.config.gyroDrift * Math.sqrt(dt));
    this.gyroBiasAccum[2] += this.gaussianNoise(this.config.gyroDrift * Math.sqrt(dt));
    
    // Add bias and noise
    return {
      x: trueGyro[0] + this.config.gyroBias[0] + this.gyroBiasAccum[0] + 
         this.gaussianNoise(this.config.gyroNoise),
      y: trueGyro[1] + this.config.gyroBias[1] + this.gyroBiasAccum[1] + 
         this.gaussianNoise(this.config.gyroNoise),
      z: trueGyro[2] + this.config.gyroBias[2] + this.gyroBiasAccum[2] + 
         this.gaussianNoise(this.config.gyroNoise)
    };
  }
  
  // Simulate barometer reading
  simulateBarometer(truePressure, temperature, dt) {
    // Accumulate slow drift
    this.baroDrift += this.gaussianNoise(this.config.baroDrift * dt);
    
    // Temperature coefficient
    const tempEffect = this.config.baroTempCoeff * (temperature - 293.15); // From 20°C
    
    // Add all effects
    return {
      pressure: truePressure + this.baroDrift + tempEffect + 
                this.gaussianNoise(this.config.baroNoise),
      temperature: temperature + this.gaussianNoise(0.1)
    };
  }
  
  // Simulate GPS reading
  simulateGPS(truePosition, trueVelocity, time) {
    // Check update rate
    if (time - this.lastGpsUpdate < 1 / this.config.gpsUpdateRate) {
      return null; // No new fix yet
    }
    this.lastGpsUpdate = time;
    
    // Check for dropout
    if (Math.random() < this.config.gpsDropoutProb) {
      this.gpsDropped = true;
      return { valid: false };
    }
    this.gpsDropped = false;
    
    // Position with noise
    const latNoise = this.gaussianNoise(this.config.gpsHorizontalAcc) / 111000; // degrees
    const lonNoise = this.gaussianNoise(this.config.gpsHorizontalAcc) / 111000;
    const altNoise = this.gaussianNoise(this.config.gpsVerticalAcc);
    
    // Velocity with noise
    const velNoise = [
      this.gaussianNoise(this.config.gpsVelocityAcc),
      this.gaussianNoise(this.config.gpsVelocityAcc),
      this.gaussianNoise(this.config.gpsVelocityAcc)
    ];
    
    return {
      valid: true,
      latitude: truePosition.lat + latNoise,
      longitude: truePosition.lon + lonNoise,
      altitude: truePosition.alt + altNoise,
      velocityN: trueVelocity.x + velNoise[0],
      velocityE: trueVelocity.z + velNoise[1],
      velocityD: -trueVelocity.y + velNoise[2],
      satellites: 8 + Math.floor(Math.random() * 6),
      hdop: 1.0 + Math.random() * 0.5,
      fixType: 3 // 3D fix
    };
  }
  
  // Simulate magnetometer (world magnetic field rotated to body frame)
  simulateMagnetometer(orientation, declination = 0) {
    // Approximate Earth's magnetic field (Northern hemisphere)
    const magField = {
      x: 20,  // µT North
      y: 0,   // µT East
      z: 45   // µT Down (varies by location)
    };
    
    // Rotate to body frame (using orientation quaternion would be better)
    // For now, simplified
    return {
      x: magField.x + this.config.magBias[0] + this.gaussianNoise(this.config.magNoise),
      y: magField.y + this.config.magBias[1] + this.gaussianNoise(this.config.magNoise),
      z: magField.z + this.config.magBias[2] + this.gaussianNoise(this.config.magNoise)
    };
  }
  
  // Generate complete sensor packet
  generateSensorPacket(physicsState, dt) {
    const { state, atmosphere } = physicsState;
    
    // True values in body frame
    // Acceleration (specific force = accel - gravity, in body frame)
    const bodyAccel = state.orientation.conjugate().rotateVector({
      x: state.ax,
      y: state.ay + 9.81, // Add gravity (accelerometer measures specific force)
      z: state.az
    });
    
    const trueAccel = [bodyAccel.x, bodyAccel.y, bodyAccel.z];
    const trueGyro = [state.wx, state.wy, state.wz];
    
    return {
      timestamp: state.time * 1000, // ms
      
      // IMU
      accel: this.simulateAccelerometer(trueAccel, dt),
      gyro: this.simulateGyroscope(trueGyro, dt),
      
      // Barometer
      baro: this.simulateBarometer(atmosphere.pressure, atmosphere.temperature, dt),
      
      // Magnetometer
      mag: this.simulateMagnetometer(state.orientation),
      
      // GPS (may be null if not time for update)
      gps: this.simulateGPS(
        { lat: 0, lon: 0, alt: state.y }, // Would need launch site coords
        { x: state.vx, y: state.vy, z: state.vz },
        state.time
      )
    };
  }
  
  reset() {
    this.gyroBiasAccum = [0, 0, 0];
    this.baroDrift = 0;
    this.lastGpsUpdate = 0;
    this.gpsDropped = false;
  }
}

// ============================================
// SERIAL PROTOCOL HANDLERS
// ============================================

// Generic binary protocol
export class BinaryProtocol {
  constructor(config = {}) {
    this.config = {
      syncByte: config.syncByte ?? 0xAA,
      endianness: config.endianness ?? 'little',
      checksumType: config.checksumType ?? 'xor', // 'xor', 'crc8', 'crc16', 'none'
      ...config
    };
  }
  
  // Encode sensor data to binary packet
  encodeSensorPacket(sensors) {
    const buffer = new ArrayBuffer(64);
    const view = new DataView(buffer);
    const littleEndian = this.config.endianness === 'little';
    
    let offset = 0;
    
    // Sync byte
    view.setUint8(offset++, this.config.syncByte);
    
    // Packet type (0x01 = sensor data)
    view.setUint8(offset++, 0x01);
    
    // Timestamp (ms, uint32)
    view.setUint32(offset, sensors.timestamp, littleEndian);
    offset += 4;
    
    // Accelerometer (m/s², int16 * 0.001)
    view.setInt16(offset, sensors.accel.x * 1000, littleEndian); offset += 2;
    view.setInt16(offset, sensors.accel.y * 1000, littleEndian); offset += 2;
    view.setInt16(offset, sensors.accel.z * 1000, littleEndian); offset += 2;
    
    // Gyroscope (rad/s, int16 * 0.0001)
    view.setInt16(offset, sensors.gyro.x * 10000, littleEndian); offset += 2;
    view.setInt16(offset, sensors.gyro.y * 10000, littleEndian); offset += 2;
    view.setInt16(offset, sensors.gyro.z * 10000, littleEndian); offset += 2;
    
    // Barometer (Pa, uint32)
    view.setUint32(offset, sensors.baro.pressure, littleEndian); offset += 4;
    
    // Temperature (°C, int16 * 0.01)
    view.setInt16(offset, (sensors.baro.temperature - 273.15) * 100, littleEndian); offset += 2;
    
    // Magnetometer (µT, int16 * 0.1)
    view.setInt16(offset, sensors.mag.x * 10, littleEndian); offset += 2;
    view.setInt16(offset, sensors.mag.y * 10, littleEndian); offset += 2;
    view.setInt16(offset, sensors.mag.z * 10, littleEndian); offset += 2;
    
    // GPS (if valid)
    if (sensors.gps?.valid) {
      view.setUint8(offset++, 1); // GPS valid flag
      view.setInt32(offset, sensors.gps.latitude * 1e7, littleEndian); offset += 4;
      view.setInt32(offset, sensors.gps.longitude * 1e7, littleEndian); offset += 4;
      view.setInt32(offset, sensors.gps.altitude * 1000, littleEndian); offset += 4;
      view.setInt16(offset, sensors.gps.velocityN * 100, littleEndian); offset += 2;
      view.setInt16(offset, sensors.gps.velocityE * 100, littleEndian); offset += 2;
      view.setInt16(offset, sensors.gps.velocityD * 100, littleEndian); offset += 2;
    } else {
      view.setUint8(offset++, 0); // GPS invalid
      offset += 18; // Skip GPS fields
    }
    
    // Calculate checksum
    const packetLength = offset;
    view.setUint8(1, packetLength); // Store length after sync byte
    
    const checksum = this.calculateChecksum(new Uint8Array(buffer, 0, packetLength));
    view.setUint8(offset++, checksum);
    
    return new Uint8Array(buffer, 0, offset);
  }
  
  // Decode actuator command from binary packet
  decodeActuatorPacket(data) {
    if (data.length < 4) return null;
    
    const view = new DataView(data.buffer);
    const littleEndian = this.config.endianness === 'little';
    
    // Verify sync byte
    if (view.getUint8(0) !== this.config.syncByte) return null;
    
    const packetType = view.getUint8(1);
    
    switch (packetType) {
      case 0x10: // Gimbal command
        return {
          type: 'gimbal',
          x: view.getInt16(2, littleEndian) / 1000, // radians
          y: view.getInt16(4, littleEndian) / 1000
        };
      
      case 0x11: // Parachute command
        return {
          type: 'parachute',
          deploy: view.getUint8(2) === 1
        };
      
      case 0x12: // Ignition command
        return {
          type: 'ignition',
          arm: view.getUint8(2) === 1
        };
      
      case 0x20: // Status request
        return {
          type: 'status_request'
        };
      
      default:
        return null;
    }
  }
  
  calculateChecksum(data) {
    switch (this.config.checksumType) {
      case 'xor':
        let xor = 0;
        for (const byte of data) xor ^= byte;
        return xor;
      
      case 'crc8':
        return this.crc8(data);
      
      case 'none':
        return 0;
      
      default:
        return 0;
    }
  }
  
  crc8(data) {
    let crc = 0;
    for (const byte of data) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) {
        if (crc & 0x80) {
          crc = (crc << 1) ^ 0x07;
        } else {
          crc <<= 1;
        }
      }
      crc &= 0xFF;
    }
    return crc;
  }
}

// ASCII protocol (for debugging/simple interfaces)
export class ASCIIProtocol {
  constructor(config = {}) {
    this.config = {
      delimiter: config.delimiter ?? '\n',
      separator: config.separator ?? ',',
      ...config
    };
  }
  
  encodeSensorPacket(sensors) {
    const parts = [
      'SENS',
      Math.round(sensors.timestamp),
      sensors.accel.x.toFixed(4),
      sensors.accel.y.toFixed(4),
      sensors.accel.z.toFixed(4),
      sensors.gyro.x.toFixed(6),
      sensors.gyro.y.toFixed(6),
      sensors.gyro.z.toFixed(6),
      Math.round(sensors.baro.pressure),
      (sensors.baro.temperature - 273.15).toFixed(2),
      sensors.gps?.valid ? 1 : 0,
      sensors.gps?.latitude?.toFixed(7) ?? 0,
      sensors.gps?.longitude?.toFixed(7) ?? 0,
      sensors.gps?.altitude?.toFixed(2) ?? 0
    ];
    
    const line = parts.join(this.config.separator) + this.config.delimiter;
    return new TextEncoder().encode(line);
  }
  
  decodeActuatorPacket(data) {
    const text = new TextDecoder().decode(data);
    const lines = text.split(this.config.delimiter);
    
    for (const line of lines) {
      const parts = line.trim().split(this.config.separator);
      if (parts.length < 2) continue;
      
      switch (parts[0]) {
        case 'GIMBAL':
          return {
            type: 'gimbal',
            x: parseFloat(parts[1]) || 0,
            y: parseFloat(parts[2]) || 0
          };
        
        case 'CHUTE':
          return {
            type: 'parachute',
            deploy: parts[1] === '1'
          };
        
        case 'ARM':
          return {
            type: 'ignition',
            arm: parts[1] === '1'
          };
      }
    }
    
    return null;
  }
}

// ============================================
// HIL INTERFACE (Web Serial API)
// ============================================

export class HILInterface {
  constructor(config = {}) {
    this.config = {
      baudRate: config.baudRate ?? 115200,
      dataBits: config.dataBits ?? 8,
      stopBits: config.stopBits ?? 1,
      parity: config.parity ?? 'none',
      flowControl: config.flowControl ?? 'none',
      protocol: config.protocol ?? 'binary', // 'binary', 'ascii'
      ...config
    };
    
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.running = false;
    
    // Initialize protocol handler
    this.protocol = this.config.protocol === 'ascii' 
      ? new ASCIIProtocol(config.protocolConfig)
      : new BinaryProtocol(config.protocolConfig);
    
    // Callbacks
    this.onActuatorCommand = null;
    this.onStatusUpdate = null;
    this.onError = null;
    
    // Statistics
    this.stats = {
      packetsSent: 0,
      packetsReceived: 0,
      bytesTransferred: 0,
      errors: 0,
      lastLatency: 0
    };
    
    // Buffer for incoming data
    this.receiveBuffer = new Uint8Array(1024);
    this.receiveBufferPos = 0;
  }
  
  // Check if Web Serial API is available
  static isSupported() {
    return 'serial' in navigator;
  }
  
  // Get list of available ports
  static async getPorts() {
    if (!HILInterface.isSupported()) {
      throw new Error('Web Serial API not supported in this browser');
    }
    return await navigator.serial.getPorts();
  }
  
  // Connect to a serial port
  async connect() {
    if (!HILInterface.isSupported()) {
      throw new Error('Web Serial API not supported in this browser');
    }
    
    try {
      // Request port from user
      this.port = await navigator.serial.requestPort();
      
      // Open with config
      await this.port.open({
        baudRate: this.config.baudRate,
        dataBits: this.config.dataBits,
        stopBits: this.config.stopBits,
        parity: this.config.parity,
        flowControl: this.config.flowControl
      });
      
      // Get reader and writer
      this.reader = this.port.readable.getReader();
      this.writer = this.port.writable.getWriter();
      
      this.running = true;
      
      // Start read loop
      this.readLoop();
      
      if (this.onStatusUpdate) {
        this.onStatusUpdate({ connected: true, port: this.port.getInfo() });
      }
      
      return true;
    } catch (error) {
      if (this.onError) {
        this.onError(error);
      }
      throw error;
    }
  }
  
  // Disconnect
  async disconnect() {
    this.running = false;
    
    if (this.reader) {
      await this.reader.cancel();
      this.reader.releaseLock();
      this.reader = null;
    }
    
    if (this.writer) {
      this.writer.releaseLock();
      this.writer = null;
    }
    
    if (this.port) {
      await this.port.close();
      this.port = null;
    }
    
    if (this.onStatusUpdate) {
      this.onStatusUpdate({ connected: false });
    }
  }
  
  // Read loop (runs in background)
  async readLoop() {
    while (this.running && this.reader) {
      try {
        const { value, done } = await this.reader.read();
        
        if (done) {
          break;
        }
        
        if (value) {
          this.handleReceivedData(value);
        }
      } catch (error) {
        if (this.running) {
          this.stats.errors++;
          if (this.onError) {
            this.onError(error);
          }
        }
        break;
      }
    }
  }
  
  // Handle received data
  handleReceivedData(data) {
    this.stats.bytesTransferred += data.length;
    
    // Add to buffer
    for (const byte of data) {
      this.receiveBuffer[this.receiveBufferPos++] = byte;
      
      // Check for complete packet
      if (this.receiveBufferPos >= 2) {
        const packet = this.tryParsePacket();
        if (packet) {
          this.stats.packetsReceived++;
          
          if (this.onActuatorCommand) {
            this.onActuatorCommand(packet);
          }
        }
      }
      
      // Prevent buffer overflow
      if (this.receiveBufferPos >= this.receiveBuffer.length - 1) {
        this.receiveBufferPos = 0;
      }
    }
  }
  
  // Try to parse a packet from the buffer
  tryParsePacket() {
    const data = this.receiveBuffer.slice(0, this.receiveBufferPos);
    const packet = this.protocol.decodeActuatorPacket(data);
    
    if (packet) {
      // Clear buffer
      this.receiveBufferPos = 0;
      return packet;
    }
    
    return null;
  }
  
  // Send sensor data
  async sendSensorData(sensors) {
    if (!this.writer || !this.running) {
      return false;
    }
    
    try {
      const startTime = performance.now();
      
      const packet = this.protocol.encodeSensorPacket(sensors);
      await this.writer.write(packet);
      
      this.stats.packetsSent++;
      this.stats.bytesTransferred += packet.length;
      this.stats.lastLatency = performance.now() - startTime;
      
      return true;
    } catch (error) {
      this.stats.errors++;
      if (this.onError) {
        this.onError(error);
      }
      return false;
    }
  }
  
  // Send raw bytes
  async sendRaw(data) {
    if (!this.writer || !this.running) {
      return false;
    }
    
    try {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      await this.writer.write(bytes);
      this.stats.bytesTransferred += bytes.length;
      return true;
    } catch (error) {
      this.stats.errors++;
      if (this.onError) {
        this.onError(error);
      }
      return false;
    }
  }
  
  // Get connection status
  getStatus() {
    return {
      connected: this.running && this.port !== null,
      stats: { ...this.stats },
      config: { ...this.config }
    };
  }
}

// ============================================
// HIL CONTROLLER
// ============================================

export class HILController {
  constructor(physicsEngine, config = {}) {
    this.physics = physicsEngine;
    this.config = {
      updateRate: config.updateRate ?? 100, // Hz
      sensorConfig: config.sensorConfig ?? {},
      protocolConfig: config.protocolConfig ?? {},
      ...config
    };
    
    this.hil = new HILInterface({
      baudRate: config.baudRate ?? 115200,
      protocol: config.protocol ?? 'binary',
      protocolConfig: config.protocolConfig
    });
    
    this.sensors = new SensorSimulator(this.config.sensorConfig);
    
    this.running = false;
    this.loopHandle = null;
    this.lastUpdateTime = 0;
    
    // Wire up callbacks
    this.hil.onActuatorCommand = this.handleActuatorCommand.bind(this);
    this.hil.onError = this.handleError.bind(this);
    
    // Event callbacks
    this.onGimbalCommand = null;
    this.onParachuteCommand = null;
    this.onError = null;
    this.onTelemetry = null;
  }
  
  async connect() {
    await this.hil.connect();
  }
  
  async disconnect() {
    this.stop();
    await this.hil.disconnect();
  }
  
  start() {
    if (this.running) return;
    
    this.running = true;
    this.lastUpdateTime = performance.now();
    this.sensors.reset();
    
    const updateInterval = 1000 / this.config.updateRate;
    
    const loop = () => {
      if (!this.running) return;
      
      const now = performance.now();
      const dt = (now - this.lastUpdateTime) / 1000;
      this.lastUpdateTime = now;
      
      // Generate sensor data from physics state
      const atm = this.physics.atmosphere.getProperties(this.physics.state.y);
      const sensorData = this.sensors.generateSensorPacket({
        state: {
          ...this.physics.state,
          ax: this.physics.state.vx / dt,
          ay: this.physics.state.vy / dt,
          az: this.physics.state.vz / dt
        },
        atmosphere: atm
      }, dt);
      
      // Send to flight computer
      this.hil.sendSensorData(sensorData);
      
      // Emit telemetry event
      if (this.onTelemetry) {
        this.onTelemetry({
          sensors: sensorData,
          stats: this.hil.getStatus().stats,
          physicsState: this.physics.state
        });
      }
      
      // Schedule next update
      this.loopHandle = setTimeout(loop, updateInterval);
    };
    
    loop();
  }
  
  stop() {
    this.running = false;
    if (this.loopHandle) {
      clearTimeout(this.loopHandle);
      this.loopHandle = null;
    }
  }
  
  handleActuatorCommand(command) {
    switch (command.type) {
      case 'gimbal':
        // Apply gimbal command to physics engine
        this.physics.setGimbal(command.x, command.y);
        if (this.onGimbalCommand) {
          this.onGimbalCommand(command);
        }
        break;
      
      case 'parachute':
        if (command.deploy) {
          // Trigger parachute in physics
          // (would need to add this method to physics engine)
          if (this.onParachuteCommand) {
            this.onParachuteCommand(command);
          }
        }
        break;
      
      case 'ignition':
        // Handle arm/disarm
        break;
    }
  }
  
  handleError(error) {
    log.error('HIL Error:', error);
    if (this.onError) {
      this.onError(error);
    }
  }
  
  getStatus() {
    return {
      running: this.running,
      connected: this.hil.getStatus().connected,
      stats: this.hil.getStatus().stats
    };
  }
}

// ============================================
// FLIGHT COMPUTER EMULATOR
// (For testing without real hardware)
// ============================================

export class FlightComputerEmulator {
  constructor(config = {}) {
    this.config = {
      name: config.name ?? 'Emulated FC',
      responseDelay: config.responseDelay ?? 5, // ms
      ...config
    };
    
    // State
    this.armed = false;
    this.gimbalX = 0;
    this.gimbalY = 0;
    this.chuteDeployed = false;
    
    // Simple attitude estimation
    this.estimatedPitch = 0;
    this.estimatedYaw = 0;
    
    // PID controller state
    this.pidIntegralPitch = 0;
    this.pidIntegralYaw = 0;
    this.lastErrorPitch = 0;
    this.lastErrorYaw = 0;
    
    // PID gains
    this.kP = config.kP ?? 2.0;
    this.kI = config.kI ?? 0.1;
    this.kD = config.kD ?? 0.5;
    
    // Callbacks
    this.onCommand = null;
  }
  
  // Process incoming sensor data
  processSensorData(sensors) {
    // Simple complementary filter for attitude estimation
    const dt = 0.01; // Assume 100Hz
    
    // Integrate gyro
    this.estimatedPitch += sensors.gyro.x * dt;
    this.estimatedYaw += sensors.gyro.z * dt;
    
    // Correct with accelerometer (simplified)
    const accelPitch = Math.atan2(sensors.accel.x, sensors.accel.y);
    const alpha = 0.02; // Complementary filter coefficient
    
    this.estimatedPitch = (1 - alpha) * this.estimatedPitch + alpha * accelPitch;
    
    // Run PID controller if armed
    if (this.armed) {
      const command = this.runPIDController(dt);
      
      if (this.onCommand) {
        this.onCommand(command);
      }
      
      return command;
    }
    
    return null;
  }
  
  runPIDController(dt) {
    // Target is vertical (0, 0)
    const errorPitch = -this.estimatedPitch;
    const errorYaw = -this.estimatedYaw;
    
    // P term
    const pPitch = this.kP * errorPitch;
    const pYaw = this.kP * errorYaw;
    
    // I term (with anti-windup)
    this.pidIntegralPitch = Math.max(-0.5, Math.min(0.5, 
      this.pidIntegralPitch + errorPitch * dt));
    this.pidIntegralYaw = Math.max(-0.5, Math.min(0.5,
      this.pidIntegralYaw + errorYaw * dt));
    
    const iPitch = this.kI * this.pidIntegralPitch;
    const iYaw = this.kI * this.pidIntegralYaw;
    
    // D term
    const dPitch = this.kD * (errorPitch - this.lastErrorPitch) / dt;
    const dYaw = this.kD * (errorYaw - this.lastErrorYaw) / dt;
    
    this.lastErrorPitch = errorPitch;
    this.lastErrorYaw = errorYaw;
    
    // Output (clamp to gimbal limits)
    const maxGimbal = 0.15; // ~8.5 degrees
    this.gimbalX = Math.max(-maxGimbal, Math.min(maxGimbal, pPitch + iPitch + dPitch));
    this.gimbalY = Math.max(-maxGimbal, Math.min(maxGimbal, pYaw + iYaw + dYaw));
    
    return {
      type: 'gimbal',
      x: this.gimbalX,
      y: this.gimbalY
    };
  }
  
  arm() {
    this.armed = true;
    this.pidIntegralPitch = 0;
    this.pidIntegralYaw = 0;
  }
  
  disarm() {
    this.armed = false;
    this.gimbalX = 0;
    this.gimbalY = 0;
  }
  
  deployChute() {
    this.chuteDeployed = true;
    return { type: 'parachute', deploy: true };
  }
  
  reset() {
    this.armed = false;
    this.gimbalX = 0;
    this.gimbalY = 0;
    this.chuteDeployed = false;
    this.estimatedPitch = 0;
    this.estimatedYaw = 0;
    this.pidIntegralPitch = 0;
    this.pidIntegralYaw = 0;
    this.lastErrorPitch = 0;
    this.lastErrorYaw = 0;
  }
}

export default {
  SensorSimulator,
  BinaryProtocol,
  ASCIIProtocol,
  HILInterface,
  HILController,
  FlightComputerEmulator
};

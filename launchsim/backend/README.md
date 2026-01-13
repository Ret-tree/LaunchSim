# LAUNCHSIM RocketPy Backend Integration

High-fidelity 6-DOF rocket trajectory simulation powered by [RocketPy](https://github.com/RocketPy-Team/RocketPy).

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         LAUNCHSIM                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────────┐          ┌──────────────────────────┐     │
│  │                  │          │                          │     │
│  │   Web Frontend   │◄────────►│   RocketPy Backend       │     │
│  │   (Three.js)     │   REST   │   (FastAPI + RocketPy)   │     │
│  │                  │   API    │                          │     │
│  └──────────────────┘          └──────────────────────────┘     │
│         │                                   │                    │
│         │ Real-time                         │ 6-DOF Physics      │
│         │ 3D Rendering                      │ RK4 Integration    │
│         │                                   │ Barrowman CP       │
│         │                                   │ Variable Mass      │
│         ▼                                   │ Wind Effects       │
│  ┌──────────────────┐                       │ Parachute Recovery │
│  │                  │                       ▼                    │
│  │   Browser        │          ┌──────────────────────────┐     │
│  │   Canvas/WebGL   │          │  Trajectory + Events     │     │
│  │                  │          │  Monte Carlo Results     │     │
│  └──────────────────┘          │  Stability Analysis      │     │
│                                └──────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Option 1: Docker (Recommended)

```bash
# Clone and run
cd launchsim-pro
docker-compose up -d

# Access
# Frontend: http://localhost:80
# Backend:  http://localhost:8000
# API Docs: http://localhost:8000/docs
```

### Option 2: Manual Setup

```bash
# Backend
cd backend
pip install -r requirements.txt
python server.py

# Or with uvicorn
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

## API Reference

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check |
| GET | `/api/status` | Server status and capabilities |
| GET | `/api/motors` | List available motors |
| GET | `/api/motors/{id}` | Get motor details |
| POST | `/api/simulate` | Run flight simulation |
| POST | `/api/montecarlo` | Monte Carlo dispersion analysis |
| POST | `/api/stability` | Calculate stability margin |
| GET | `/api/atmosphere` | Get atmospheric properties |

### Simulation Request

```json
{
  "environment": {
    "latitude": 32.990254,
    "longitude": -106.974998,
    "elevation": 1400,
    "atmosphere_type": "standard_atmosphere",
    "wind_speed": 5,
    "wind_direction": 90
  },
  "rocket": {
    "mass": 0.5,
    "radius": 0.025,
    "inertia_i": 0.01,
    "inertia_z": 0.001,
    "center_of_mass": 0.3,
    "nose": {
      "length": 0.1,
      "kind": "ogive"
    },
    "fins": {
      "n": 3,
      "root_chord": 0.08,
      "tip_chord": 0.03,
      "span": 0.06,
      "position": -0.1
    },
    "motor": {
      "motor_type": "solid",
      "burn_time": 1.6,
      "avg_thrust": 6,
      "propellant_mass": 0.0108,
      "dry_mass": 0.013,
      "grain_outer_radius": 0.009,
      "grain_initial_inner_radius": 0.004,
      "grain_initial_height": 0.06,
      "grain_number": 1,
      "nozzle_radius": 0.008,
      "throat_radius": 0.003,
      "thrust_curve": [[0,0],[0.04,14],[0.2,10],[0.5,7],[1.0,5],[1.6,0]]
    },
    "parachutes": [{
      "name": "Main",
      "cd_s": 1.0,
      "trigger": "apogee",
      "lag": 1.5
    }]
  },
  "flight": {
    "rail_length": 1.5,
    "inclination": 85,
    "heading": 0,
    "max_time": 300
  },
  "output_sampling_rate": 60
}
```

### Simulation Response

```json
{
  "success": true,
  "message": "Simulation completed successfully",
  "apogee": 245.7,
  "apogee_time": 5.23,
  "max_velocity": 78.4,
  "max_mach": 0.23,
  "flight_time": 18.56,
  "landing_velocity": 5.2,
  "stability_margin_initial": 2.1,
  "stability_margin_burnout": 2.8,
  "trajectory": [
    {"time": 0, "x": 0, "y": 0, "z": 0, "vx": 0, "vy": 0, "vz": 0, ...},
    {"time": 0.017, "x": 0.01, "y": 0.02, "z": 0.5, ...},
    ...
  ],
  "events": [
    {"name": "liftoff", "time": 0, "altitude": 0},
    {"name": "rail_departure", "time": 0.12, "velocity": 15.2},
    {"name": "burnout", "time": 1.6},
    {"name": "apogee", "time": 5.23, "altitude": 245.7},
    {"name": "landing", "time": 18.56, "velocity": 5.2}
  ]
}
```

## JavaScript Client

```javascript
// Initialize client
const client = new RocketPyClient('http://localhost:8000');

// Check connection
const status = await client.getStatus();
console.log('RocketPy available:', status.rocketpy_installed);

// Get motors
const motors = await client.getMotors({ impulseClass: 'C' });

// Run simulation with LAUNCHSIM config
const result = await client.simulateQuick(
  rocketConfig,  // From LAUNCHSIM builder
  motorConfig,   // Selected motor
  { 
    windSpeed: 5,
    inclination: 85 
  }
);

// Display results
console.log(ResultFormatter.formatSummary(result));

// Render trajectory in Three.js
const renderer = new TrajectoryRenderer(scene);
renderer.render(result);

// Download CSV
ResultFormatter.downloadCSV(result, 'my_flight.csv');
```

## Integration with LAUNCHSIM

```javascript
// In launchsim-pro.html
const integration = new LaunchSimIntegration({
  serverUrl: 'http://localhost:8000',
  onStatusChange: (status) => {
    if (status.available) {
      document.getElementById('backend-status').textContent = '🟢 RocketPy';
    } else {
      document.getElementById('backend-status').textContent = '🟡 JS Physics';
    }
  }
});

// Initialize on page load
await integration.init();

// Use for simulation
if (integration.isAvailable()) {
  // Use high-fidelity RocketPy backend
  const result = await integration.simulate(rocketConfig, selectedMotor, {
    elevation: selectedSite.elevation,
    windSpeed: weatherConfig.windSpeed,
    windDirection: weatherConfig.windDirection
  });
  
  // Update 3D view with trajectory
  updateTrajectory(result.trajectory);
  showFlightEvents(result.events);
  
} else {
  // Fall back to JS physics engine
  runLocalSimulation();
}
```

## Motor Database

Built-in motors (expandable via ThrustCurve.org API):

| Class | Motors |
|-------|--------|
| A | Estes A8 |
| B | Estes B6 |
| C | Estes C6 |
| D | Estes D12 |
| E | Estes E12 |
| F | Aerotech F50 |
| G | Aerotech G80 |
| H | Aerotech H128 |
| I | Aerotech I284 |
| M | Cesaroni M1670 |

## Features Comparison

| Feature | JS Engine | RocketPy Backend |
|---------|-----------|------------------|
| 6-DOF Physics | ✓ Basic | ✓ Full |
| RK4 Integration | ✓ | ✓ |
| Variable Mass | ✓ Simplified | ✓ Full |
| Barrowman CP | ✓ | ✓ |
| Wind Effects | ✓ | ✓ + Profiles |
| Parachute | ✓ Basic | ✓ Full |
| Monte Carlo | ✗ | ✓ |
| Real Weather | ✗ | ✓ GFS/ERA5 |
| Multi-stage | ✗ | ✓ |
| Hybrid/Liquid | ✗ | ✓ |
| Validated | ⚠️ | ✓ Published |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 8000 | Server port |
| `WORKERS` | 4 | Number of worker processes |
| `LOG_LEVEL` | info | Logging level |
| `CORS_ORIGINS` | * | Allowed CORS origins |

## Development

```bash
# Install dev dependencies
pip install -r requirements.txt
pip install pytest pytest-asyncio httpx

# Run tests
pytest tests/

# Run with auto-reload
uvicorn server:app --reload

# Format code
black server.py
isort server.py
```

## Performance

Typical simulation times:

| Rocket Type | Flight Time | Sim Time |
|-------------|-------------|----------|
| Estes C6 | 15s | ~0.1s |
| HPR H128 | 30s | ~0.3s |
| L3 M1670 | 60s | ~0.8s |
| Monte Carlo (100) | - | ~30s |

## Troubleshooting

### "RocketPy not installed"

```bash
pip install rocketpy --upgrade
```

### "CORS error"

Backend already has CORS enabled for all origins. If you see CORS errors, ensure you're accessing the correct port.

### "Simulation timeout"

Increase timeout in client:
```javascript
client.timeout = 120000; // 2 minutes
```

## License

MIT License - see [LICENSE](../LICENSE)

## Credits

- [RocketPy](https://github.com/RocketPy-Team/RocketPy) - 6-DOF physics engine
- [FastAPI](https://fastapi.tiangolo.com/) - API framework
- [Three.js](https://threejs.org/) - 3D rendering

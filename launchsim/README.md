# ● LaunchSim

**Free, open-source rocket flight simulator for model and high-power rocketry.**

LaunchSim provides accurate 6-DOF physics simulation, 3D visualization, and comprehensive analysis tools — all running in your browser with no installation required.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)

---

## ✨ Features

### 🚀 Rocket Design
- **OpenRocket Import** — Load `.ork` files directly
- **Quick Design Tool** — Build rockets from scratch with nose cones, body tubes, fins, and recovery systems
- **Component Database** — 180+ real components from major manufacturers (LOC, Estes, Madcow, Public Missiles)

### 🔥 Motor Selection
- **ThrustCurve.org Integration** — Search 1000+ certified motors
- **Offline Database** — Works without internet
- **Motor Optimization** — Find the best motor for your target altitude

### 📊 Physics & Analysis
- **6-DOF Simulation** — Full rotational dynamics with quaternion math
- **Barrowman Stability** — CP/CG calculation with stability margin
- **Fin Flutter Analysis** — Predict flutter velocity with material database
- **Monte Carlo Analysis** — Statistical dispersion with confidence ellipses
- **Dual Deploy Planning** — Optimize drogue/main altitudes and chute sizes

### 🎮 3D Visualization
- **Real-time Flight Replay** — Watch your rocket fly with smoke trails
- **Terrain & Weather Effects** — Procedural ground, clouds, rain
- **Trajectory Inspection** — Click any point for detailed telemetry
- **Force Vectors** — Visualize thrust, drag, gravity, lift
- **Multi-Trajectory Comparison** — Overlay multiple flights
- **First-Person Camera** — Ride along with your rocket
- **KML Export** — View trajectories in Google Earth

### 🎯 Launch Day Tools
- **Weather Integration** — Real-time conditions from Open-Meteo
- **GO/NO-GO Assessment** — Safety scoring based on wind, visibility, precipitation
- **Drift Prediction** — Landing zone estimation with wind profiles
- **Pre-Flight Checklist** — Customizable safety checklists

### 🔗 Integration
- **Altimeter Data Import** — StratoLogger, Eggtimer, Jolly Logic, Altus Metrum, and more
- **GPS Tracking** — Real-time position tracking for recovery
- **Club Sharing** — Share flights and run competitions with your club

### 💾 Data Management
- **Auto-Save** — Never lose your work
- **Simulation History** — Browse and reload past simulations
- **Export Options** — CSV, KML, PDF flight cards, full project backup

---

## 🚀 Quick Start

### Option 1: Use Online (Recommended)
In one terminal cd to /launchsim/backend. 
Create a virtual environment. "Python3 -m venv GUI"
Activate virtual environemt "source GUI/bin/activate"
"pip install -r requirements.txt"
Run "python server.py"

In a separate terminal cd /launchsim/
Then run "python3 -m http.server 8080"
Visit "localhost:8080" in your web browser to run

### Option 2: Run Locally

```bash
# Clone the repository
git clone https://github.com/Ret-tree/launchsim.git
cd launchsim

# Install dependencies
npm install

# Start development server
npm run dev
```

Open `http://localhost:5173` in your browser.

### Option 3: Open Directly
Just open `index.html` in any modern browser. Some features (like .ork import) require a local server.

---

## 📖 User Guide

### Importing a Rocket

1. Go to the **Design** tab
2. Either:
   - **Drop an .ork file** from OpenRocket onto the dropzone
   - **Use Quick Design** to build a rocket manually
3. Your rocket configuration appears in the preview

### Running a Simulation

1. Go to the **Motor** tab and select a motor
2. Go to the **Weather** tab and load conditions (or use defaults)
3. Go to the **Simulate** tab
4. Click **Run Simulation** for a single flight
5. Click **Monte Carlo** for statistical analysis (100+ runs)

### Viewing Results

- **Results tab** — Graphs, statistics, event timeline
- **3D View tab** — Interactive flight visualization
- **Export options** — CSV data, KML for Google Earth, PDF flight card

### Stability Analysis

1. Go to **Design** tab
2. View the stability section showing:
   - CP (Center of Pressure) location
   - CG (Center of Gravity) location  
   - Stability margin in calibers
3. Aim for **1.5-2.5 calibers** for optimal stability

### Dual Deploy Setup

1. Go to **Recovery** tab
2. Enter rocket mass and expected apogee
3. Get recommended drogue and main chute sizes
4. Set deployment altitudes
5. Run simulation to verify descent rates

### Importing Altimeter Data

1. Go to **Integration** tab
2. Drop your altimeter CSV/TXT file
3. Format is auto-detected (StratoLogger, Eggtimer, etc.)
4. View analysis, compare with simulation, or save to flight log

---

## ⌨️ Keyboard Shortcuts

### 3D Viewer
| Key | Action |
|-----|--------|
| `Space` | Play/Pause |
| `R` | Reset camera |
| `F` | Toggle first-person view |
| `G` | Toggle ground/terrain |
| `T` | Toggle smoke trail |
| `V` | Toggle force vectors |
| `H` | Toggle telemetry HUD |
| `←` `→` | Step through trajectory |
| `+` `-` | Adjust playback speed |

### General
| Key | Action |
|-----|--------|
| `Ctrl+S` | Save project |
| `Ctrl+O` | Open project |

---

## 🔧 Supported Formats

### Import
| Format | Extension | Notes |
|--------|-----------|-------|
| OpenRocket | `.ork` | Full rocket design with simulations |
| StratoLogger | `.csv`, `.txt` | PerfectFlite altimeters |
| Eggtimer | `.csv`, `.log` | Eggtimer Rocketry |
| Jolly Logic | `.csv` | AltimeterOne/Two/Three |
| Altus Metrum | `.csv`, `.eeprom` | TeleMega, TeleMetrum |
| Featherweight | `.csv`, `.txt` | Raven altimeters |
| GPX | `.gpx` | GPS tracks |

### Export
| Format | Description |
|--------|-------------|
| CSV | Time-series flight data |
| KML | Google Earth trajectory |
| GPX | GPS track format |
| PDF | Printable flight card |
| JSON | Full project backup |

---

## 🧪 Running Tests

```bash
# Run all tests
npm test

# Run physics validation
npm run physics-test
```

---

## 🏗️ Project Structure

```
launchsim/
├── index.html              # Main entry point
├── src/
│   ├── physics/            # 6-DOF physics engine
│   ├── analysis/           # Stability, flutter, optimization
│   ├── visualization/      # 3D viewer, charts
│   ├── recovery/           # Dual deploy, drift prediction
│   ├── launchday/          # Weather, checklists, GO/NO-GO
│   ├── integration/        # Altimeters, GPS, clubs
│   ├── import/             # ORK importer
│   ├── api/                # ThrustCurve, weather APIs
│   ├── database/           # Component database
│   ├── staging/            # Multi-stage rockets
│   ├── logging/            # Flight log
│   └── frontend/           # Main application UI
├── tests/                  # Test suites
└── package.json
```

---

## 🤝 Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Areas for Contribution
- Additional altimeter format support
- More component database entries
- Internationalization (i18n)
- Performance optimizations
- Documentation improvements
- Bug fixes

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

Free for personal and commercial use.

---

## 🙏 Acknowledgments

- **[ThrustCurve.org](https://thrustcurve.org)** — Motor database
- **[Open-Meteo](https://open-meteo.com)** — Weather API
- **[Three.js](https://threejs.org)** — 3D graphics
- **[OpenRocket](https://openrocket.info)** — Inspiration and .ork format

---

## 📬 Contact

- **Issues:** [GitHub Issues](https://github.com/Ret-tree/launchsim/issues)
- **Author:** BlackDot Tech

---

*Built with ☕ for the rocketry community*

---

## ⚖️ Legal

### Trademarks
Product and company names mentioned in the component database (Estes, LOC Precision, Madcow Rocketry, Aerotech, Cesaroni, Public Missiles, Fruity Chutes, etc.) are trademarks of their respective owners. LaunchSim is not affiliated with or endorsed by these companies.

### Data Sources
- Motor performance data sourced from [ThrustCurve.org](https://thrustcurve.org) — used with permission for non-commercial purposes
- Weather data from [Open-Meteo](https://open-meteo.com) — free open-source weather API

### Disclaimer
LaunchSim is provided for educational and planning purposes only. Always follow NAR/TRA safety codes and local regulations. Simulation results are estimates and should not be used as the sole basis for flight safety decisions. The authors are not liable for any damages resulting from use of this software.

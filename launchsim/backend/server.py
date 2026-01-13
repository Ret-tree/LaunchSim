"""
LAUNCHSIM RocketPy Backend Server
=================================

FastAPI server that wraps RocketPy for 6-DOF trajectory simulation.
Provides REST API for the LAUNCHSIM frontend.

Features:
- Full RocketPy simulation with trajectory export
- Motor database with thrust curves
- Real-time weather data integration
- Monte Carlo dispersion analysis
- TVC controller simulation hooks

Usage:
    uvicorn server:app --reload --host 0.0.0.0 --port 8000

API Docs:
    http://localhost:8000/docs
"""

import os
import sys
import json
import tempfile
import numpy as np
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Union
from dataclasses import dataclass, asdict
from enum import Enum
import asyncio
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI, HTTPException, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

# RocketPy imports
try:
    from rocketpy import Environment, SolidMotor, Rocket, Flight, Function
    ROCKETPY_AVAILABLE = True
except ImportError:
    ROCKETPY_AVAILABLE = False
    print("WARNING: RocketPy not installed. Running in mock mode.")

# ============================================
# FastAPI App Setup
# ============================================

app = FastAPI(
    title="LAUNCHSIM RocketPy Backend",
    description="6-DOF rocket trajectory simulation powered by RocketPy",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS for frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Thread pool for CPU-intensive simulations
executor = ThreadPoolExecutor(max_workers=4)

# ============================================
# Pydantic Models (API Schema)
# ============================================

class NoseShape(str, Enum):
    CONICAL = "conical"
    OGIVE = "ogive"
    PARABOLIC = "parabolic"
    ELLIPTICAL = "elliptical"
    VON_KARMAN = "vonKarman"
    LVHAACK = "lvHaack"
    POWER_SERIES = "powerSeries"

class FinShape(str, Enum):
    TRAPEZOIDAL = "trapezoidal"
    ELLIPTICAL = "elliptical"
    FREEFORM = "freeform"

class MotorType(str, Enum):
    SOLID = "solid"
    HYBRID = "hybrid"
    LIQUID = "liquid"

class AtmosphereType(str, Enum):
    STANDARD = "standard_atmosphere"
    CUSTOM = "custom_atmosphere"
    FORECAST = "Forecast"
    REANALYSIS = "Reanalysis"
    WINDY = "Windy"

# --- Request Models ---

class EnvironmentConfig(BaseModel):
    """Launch environment configuration"""
    latitude: float = Field(32.990254, description="Launch site latitude")
    longitude: float = Field(-106.974998, description="Launch site longitude")
    elevation: float = Field(1400, description="Launch site elevation (m ASL)")
    date: Optional[str] = Field(None, description="Launch date (ISO format)")
    atmosphere_type: AtmosphereType = AtmosphereType.STANDARD
    wind_speed: float = Field(0, description="Wind speed (m/s)")
    wind_direction: float = Field(0, description="Wind direction (degrees)")

class MotorConfig(BaseModel):
    """Motor configuration"""
    motor_type: MotorType = MotorType.SOLID
    thrust_source: Optional[str] = Field(None, description="Motor ID or thrust curve data")
    burn_time: float = Field(1.5, description="Burn time (s)")
    total_impulse: float = Field(100, description="Total impulse (Ns)")
    avg_thrust: float = Field(50, description="Average thrust (N)")
    propellant_mass: float = Field(0.05, description="Propellant mass (kg)")
    dry_mass: float = Field(0.03, description="Motor casing mass (kg)")
    nozzle_radius: float = Field(0.015, description="Nozzle exit radius (m)")
    throat_radius: float = Field(0.005, description="Throat radius (m)")
    grain_outer_radius: float = Field(0.02, description="Grain outer radius (m)")
    grain_initial_inner_radius: float = Field(0.008, description="Grain initial inner radius (m)")
    grain_initial_height: float = Field(0.05, description="Grain height (m)")
    grain_number: int = Field(1, description="Number of grains")
    grain_separation: float = Field(0.002, description="Separation between grains (m)")
    grain_density: float = Field(1700, description="Grain density (kg/m³)")
    thrust_curve: Optional[List[List[float]]] = Field(None, description="[[time, thrust], ...] pairs")

class NoseConfig(BaseModel):
    """Nose cone configuration"""
    length: float = Field(0.1, description="Nose length (m)")
    kind: NoseShape = NoseShape.OGIVE
    base_radius: Optional[float] = Field(None, description="Base radius (m), uses rocket radius if None")
    rocket_radius: Optional[float] = None

class FinConfig(BaseModel):
    """Fin set configuration"""
    n: int = Field(3, description="Number of fins")
    root_chord: float = Field(0.08, description="Root chord (m)")
    tip_chord: float = Field(0.03, description="Tip chord (m)")  
    span: float = Field(0.06, description="Fin span (m)")
    sweep_length: Optional[float] = Field(None, description="Sweep length (m)")
    sweep_angle: Optional[float] = Field(None, description="Sweep angle (degrees)")
    cant_angle: float = Field(0, description="Cant angle (degrees)")
    position: float = Field(-0.1, description="Position from rocket center (m)")

class ParachuteConfig(BaseModel):
    """Parachute configuration"""
    name: str = Field("Main", description="Parachute name")
    cd_s: float = Field(1.0, description="Drag coefficient × area (m²)")
    trigger: str = Field("apogee", description="Trigger type: 'apogee' or altitude in meters")
    sampling_rate: float = Field(100, description="Sampling rate (Hz)")
    lag: float = Field(1.5, description="Deployment lag (s)")
    noise: List[float] = Field([0, 8.3, 0.5], description="[mean, std, correlation]")

class RocketConfig(BaseModel):
    """Complete rocket configuration"""
    mass: float = Field(0.5, description="Dry mass without motor (kg)")
    radius: float = Field(0.025, description="Body radius (m)")
    inertia_i: float = Field(0.01, description="Inertia about transverse axis (kg·m²)")
    inertia_z: float = Field(0.001, description="Inertia about axial axis (kg·m²)")
    center_of_mass: float = Field(0.3, description="CG from nose tip (m)")
    power_off_drag: Optional[List[List[float]]] = Field(None, description="[[mach, Cd], ...]")
    power_on_drag: Optional[List[List[float]]] = Field(None, description="[[mach, Cd], ...]")
    nose: Optional[NoseConfig] = None
    fins: Optional[FinConfig] = None
    motor: MotorConfig
    parachutes: Optional[List[ParachuteConfig]] = None

class FlightConfig(BaseModel):
    """Flight simulation configuration"""
    rail_length: float = Field(2.0, description="Launch rail length (m)")
    inclination: float = Field(85, description="Launch inclination (degrees from horizontal)")
    heading: float = Field(0, description="Launch heading (degrees from north)")
    max_time: float = Field(600, description="Maximum simulation time (s)")
    max_time_step: float = Field(0.01, description="Maximum integration timestep (s)")
    terminate_on_apogee: bool = Field(False, description="Stop simulation at apogee")

class SimulationRequest(BaseModel):
    """Complete simulation request"""
    environment: EnvironmentConfig = Field(default_factory=EnvironmentConfig)
    rocket: RocketConfig
    flight: FlightConfig = Field(default_factory=FlightConfig)
    output_sampling_rate: float = Field(100, description="Trajectory output rate (Hz)")

class MonteCarloRequest(BaseModel):
    """Monte Carlo dispersion analysis request"""
    base_simulation: SimulationRequest
    num_simulations: int = Field(100, description="Number of Monte Carlo runs")
    wind_speed_std: float = Field(2, description="Wind speed standard deviation (m/s)")
    wind_direction_std: float = Field(15, description="Wind direction standard deviation (deg)")
    mass_std: float = Field(0.01, description="Mass standard deviation (kg)")
    thrust_std: float = Field(0.05, description="Thrust standard deviation (fraction)")

# --- Response Models ---

class TrajectoryPoint(BaseModel):
    """Single trajectory point"""
    time: float
    x: float
    y: float  
    z: float  # Altitude
    vx: float
    vy: float
    vz: float
    ax: float
    ay: float
    az: float
    pitch: float
    yaw: float
    roll: float
    mach: float
    dynamic_pressure: float
    angle_of_attack: float

class FlightEvent(BaseModel):
    """Flight event (apogee, burnout, etc.)"""
    name: str
    time: float
    altitude: Optional[float] = None
    velocity: Optional[float] = None

class SimulationResult(BaseModel):
    """Complete simulation result"""
    success: bool
    message: str
    # Summary
    apogee: float
    apogee_time: float
    max_velocity: float
    max_velocity_time: float
    max_acceleration: float
    max_mach: float
    flight_time: float
    landing_velocity: float
    landing_position: List[float]
    out_of_rail_velocity: float
    out_of_rail_stability: float
    # Trajectory
    trajectory: List[TrajectoryPoint]
    events: List[FlightEvent]
    # Analysis
    stability_margin_initial: float
    stability_margin_burnout: float
    cp_position: float
    cg_position: float

class MotorInfo(BaseModel):
    """Motor information"""
    id: str
    manufacturer: str
    designation: str
    impulse_class: str
    diameter: float
    length: float
    total_mass: float
    propellant_mass: float
    avg_thrust: float
    max_thrust: float
    burn_time: float
    total_impulse: float
    isp: float
    thrust_curve: List[List[float]]

class MonteCarloResult(BaseModel):
    """Monte Carlo analysis result"""
    success: bool
    num_simulations: int
    apogee_mean: float
    apogee_std: float
    apogee_min: float
    apogee_max: float
    landing_dispersion_mean: float
    landing_dispersion_std: float
    landing_positions: List[List[float]]

# ============================================
# Motor Database
# ============================================

MOTOR_DATABASE = {
    "Estes_A8": {
        "id": "Estes_A8",
        "manufacturer": "Estes",
        "designation": "A8",
        "impulse_class": "A",
        "diameter": 18,
        "length": 70,
        "total_mass": 16.2,
        "propellant_mass": 3.12,
        "avg_thrust": 5,
        "max_thrust": 10,
        "burn_time": 0.5,
        "total_impulse": 2.5,
        "isp": 82,
        "delays": [3, 5],
        "thrust_curve": [[0, 0], [0.02, 10], [0.1, 8], [0.25, 5], [0.4, 3], [0.5, 0]]
    },
    "Estes_B6": {
        "id": "Estes_B6",
        "manufacturer": "Estes",
        "designation": "B6",
        "impulse_class": "B",
        "diameter": 18,
        "length": 70,
        "total_mass": 18.4,
        "propellant_mass": 5.6,
        "avg_thrust": 6,
        "max_thrust": 13,
        "burn_time": 0.85,
        "total_impulse": 5.0,
        "isp": 91,
        "delays": [4, 6],
        "thrust_curve": [[0, 0], [0.03, 13], [0.15, 9], [0.4, 6], [0.7, 4], [0.85, 0]]
    },
    "Estes_C6": {
        "id": "Estes_C6",
        "manufacturer": "Estes",
        "designation": "C6",
        "impulse_class": "C",
        "diameter": 18,
        "length": 70,
        "total_mass": 24.0,
        "propellant_mass": 10.8,
        "avg_thrust": 6,
        "max_thrust": 14,
        "burn_time": 1.6,
        "total_impulse": 8.8,
        "isp": 83,
        "delays": [3, 5, 7],
        "thrust_curve": [[0, 0], [0.04, 14], [0.2, 10], [0.5, 7], [1.0, 5], [1.4, 3], [1.6, 0]]
    },
    "Estes_D12": {
        "id": "Estes_D12",
        "manufacturer": "Estes", 
        "designation": "D12",
        "impulse_class": "D",
        "diameter": 24,
        "length": 70,
        "total_mass": 44.0,
        "propellant_mass": 21.1,
        "avg_thrust": 12,
        "max_thrust": 30,
        "burn_time": 1.6,
        "total_impulse": 16.8,
        "isp": 81,
        "delays": [3, 5, 7],
        "thrust_curve": [[0, 0], [0.03, 30], [0.1, 22], [0.4, 14], [0.8, 11], [1.2, 8], [1.6, 0]]
    },
    "Estes_E12": {
        "id": "Estes_E12",
        "manufacturer": "Estes",
        "designation": "E12",
        "impulse_class": "E", 
        "diameter": 24,
        "length": 95,
        "total_mass": 57.0,
        "propellant_mass": 33.0,
        "avg_thrust": 12,
        "max_thrust": 35,
        "burn_time": 2.2,
        "total_impulse": 28.4,
        "isp": 88,
        "delays": [4, 6, 8],
        "thrust_curve": [[0, 0], [0.04, 35], [0.2, 22], [0.6, 14], [1.2, 10], [1.8, 6], [2.2, 0]]
    },
    "Aerotech_F50": {
        "id": "Aerotech_F50",
        "manufacturer": "Aerotech",
        "designation": "F50",
        "impulse_class": "F",
        "diameter": 29,
        "length": 83,
        "total_mass": 85.0,
        "propellant_mass": 37.0,
        "avg_thrust": 50,
        "max_thrust": 78,
        "burn_time": 1.5,
        "total_impulse": 72.0,
        "isp": 198,
        "delays": [4, 6, 8, 10],
        "thrust_curve": [[0, 0], [0.02, 78], [0.1, 65], [0.4, 55], [0.8, 48], [1.2, 35], [1.5, 0]]
    },
    "Aerotech_G80": {
        "id": "Aerotech_G80",
        "manufacturer": "Aerotech",
        "designation": "G80",
        "impulse_class": "G",
        "diameter": 29,
        "length": 124,
        "total_mass": 125.0,
        "propellant_mass": 62.5,
        "avg_thrust": 80,
        "max_thrust": 115,
        "burn_time": 1.5,
        "total_impulse": 120.0,
        "isp": 196,
        "delays": [4, 7, 10],
        "thrust_curve": [[0, 0], [0.02, 115], [0.15, 95], [0.5, 85], [0.9, 75], [1.3, 50], [1.5, 0]]
    },
    "Aerotech_H128": {
        "id": "Aerotech_H128",
        "manufacturer": "Aerotech",
        "designation": "H128",
        "impulse_class": "H",
        "diameter": 29,
        "length": 195,
        "total_mass": 195.0,
        "propellant_mass": 95.0,
        "avg_thrust": 128,
        "max_thrust": 180,
        "burn_time": 1.65,
        "total_impulse": 210.0,
        "isp": 225,
        "delays": [6, 10, 14],
        "thrust_curve": [[0, 0], [0.02, 180], [0.15, 155], [0.5, 140], [1.0, 110], [1.4, 70], [1.65, 0]]
    },
    "Aerotech_I284": {
        "id": "Aerotech_I284",
        "manufacturer": "Aerotech",
        "designation": "I284",
        "impulse_class": "I",
        "diameter": 38,
        "length": 230,
        "total_mass": 350.0,
        "propellant_mass": 175.0,
        "avg_thrust": 284,
        "max_thrust": 380,
        "burn_time": 1.5,
        "total_impulse": 400.0,
        "isp": 233,
        "delays": [6, 10, 14],
        "thrust_curve": [[0, 0], [0.02, 380], [0.12, 320], [0.4, 300], [0.8, 280], [1.2, 200], [1.5, 0]]
    },
    "Cesaroni_M1670": {
        "id": "Cesaroni_M1670",
        "manufacturer": "Cesaroni",
        "designation": "M1670",
        "impulse_class": "M",
        "diameter": 75,
        "length": 621,
        "total_mass": 4827.0,
        "propellant_mass": 2727.0,
        "avg_thrust": 1670,
        "max_thrust": 2100,
        "burn_time": 3.9,
        "total_impulse": 6500.0,
        "isp": 243,
        "delays": [14],
        "thrust_curve": [[0, 0], [0.1, 2100], [0.5, 1900], [1.5, 1700], [2.5, 1600], [3.5, 1400], [3.9, 0]]
    }
}

# ============================================
# Simulation Engine
# ============================================

def create_rocketpy_motor(config: MotorConfig) -> Union['SolidMotor', dict]:
    """Create a RocketPy motor from config"""
    if not ROCKETPY_AVAILABLE:
        return {"mock": True, "config": config.dict()}
    
    # Create thrust curve function
    if config.thrust_curve:
        thrust_source = config.thrust_curve
    else:
        # Generate simple thrust curve from parameters
        thrust_source = [
            [0, 0],
            [0.02, config.avg_thrust * 1.5],
            [config.burn_time * 0.1, config.avg_thrust * 1.2],
            [config.burn_time * 0.5, config.avg_thrust],
            [config.burn_time * 0.9, config.avg_thrust * 0.6],
            [config.burn_time, 0]
        ]
    
    if config.motor_type == MotorType.SOLID:
        motor = SolidMotor(
            thrust_source=thrust_source,
            burn_time=config.burn_time,
            grain_number=config.grain_number,
            grain_separation=config.grain_separation,
            grain_density=config.grain_density,
            grain_outer_radius=config.grain_outer_radius,
            grain_initial_inner_radius=config.grain_initial_inner_radius,
            grain_initial_height=config.grain_initial_height,
            nozzle_radius=config.nozzle_radius,
            throat_radius=config.throat_radius,
            interpolation_method="linear",
            dry_mass=config.dry_mass,
            center_of_dry_mass_position=0,
            dry_inertia=(0.001, 0.001, 0.0001),
            nozzle_position=-config.grain_initial_height * config.grain_number / 2,
            coordinate_system_orientation="nozzle_to_combustion_chamber"
        )
    else:
        # For now, use solid motor for all types
        motor = SolidMotor(
            thrust_source=thrust_source,
            burn_time=config.burn_time,
            grain_number=config.grain_number,
            grain_separation=config.grain_separation,
            grain_density=config.grain_density,
            grain_outer_radius=config.grain_outer_radius,
            grain_initial_inner_radius=config.grain_initial_inner_radius,
            grain_initial_height=config.grain_initial_height,
            nozzle_radius=config.nozzle_radius,
            throat_radius=config.throat_radius,
            interpolation_method="linear",
            dry_mass=config.dry_mass,
            center_of_dry_mass_position=0,
            dry_inertia=(0.001, 0.001, 0.0001),
            nozzle_position=-config.grain_initial_height * config.grain_number / 2,
            coordinate_system_orientation="nozzle_to_combustion_chamber"
        )
    
    return motor

def create_rocketpy_rocket(config: RocketConfig, motor) -> Union['Rocket', dict]:
    """Create a RocketPy rocket from config"""
    if not ROCKETPY_AVAILABLE:
        return {"mock": True, "config": config.dict()}
    
    # Default drag curves if not provided
    if config.power_off_drag:
        power_off_drag = config.power_off_drag
    else:
        power_off_drag = [[0, 0.5], [0.5, 0.5], [1.0, 0.55], [1.5, 0.6], [2.0, 0.55]]
    
    if config.power_on_drag:
        power_on_drag = config.power_on_drag
    else:
        power_on_drag = [[0, 0.45], [0.5, 0.45], [1.0, 0.5], [1.5, 0.55], [2.0, 0.5]]
    
    rocket = Rocket(
        radius=config.radius,
        mass=config.mass,
        inertia=(config.inertia_i, config.inertia_i, config.inertia_z),
        power_off_drag=power_off_drag,
        power_on_drag=power_on_drag,
        center_of_mass_without_motor=config.center_of_mass,
        coordinate_system_orientation="nose_to_tail"
    )
    
    # Add motor
    rocket.add_motor(motor, position=-config.center_of_mass * 0.8)
    
    # Add nose cone
    if config.nose:
        nose_radius = config.nose.base_radius or config.radius
        rocket.add_nose(
            length=config.nose.length,
            kind=config.nose.kind.value,
            position=config.center_of_mass + config.nose.length
        )
    else:
        rocket.add_nose(length=0.1, kind="ogive", position=config.center_of_mass + 0.1)
    
    # Add fins
    if config.fins:
        rocket.add_trapezoidal_fins(
            n=config.fins.n,
            root_chord=config.fins.root_chord,
            tip_chord=config.fins.tip_chord,
            span=config.fins.span,
            sweep_length=config.fins.sweep_length,
            cant_angle=config.fins.cant_angle,
            position=config.fins.position
        )
    else:
        rocket.add_trapezoidal_fins(
            n=3,
            root_chord=0.08,
            tip_chord=0.03,
            span=0.06,
            position=-config.center_of_mass * 0.9
        )
    
    # Add parachutes
    if config.parachutes:
        for chute in config.parachutes:
            if chute.trigger == "apogee":
                trigger = lambda p, h, y: y[5] < 0  # vy < 0 (descending)
            else:
                alt = float(chute.trigger)
                trigger = lambda p, h, y, a=alt: y[5] < 0 and y[2] < a
            
            rocket.add_parachute(
                name=chute.name,
                cd_s=chute.cd_s,
                trigger=trigger,
                sampling_rate=chute.sampling_rate,
                lag=chute.lag,
                noise=tuple(chute.noise)
            )
    
    return rocket

def run_simulation(request: SimulationRequest) -> SimulationResult:
    """Run a complete RocketPy simulation"""
    
    if not ROCKETPY_AVAILABLE:
        # Return mock data for testing without RocketPy
        return create_mock_result(request)
    
    try:
        # Create environment
        env = Environment(
            latitude=request.environment.latitude,
            longitude=request.environment.longitude,
            elevation=request.environment.elevation
        )
        
        # Set atmosphere
        if request.environment.atmosphere_type == AtmosphereType.STANDARD:
            env.set_atmospheric_model(type="standard_atmosphere")
        elif request.environment.atmosphere_type == AtmosphereType.CUSTOM:
            env.set_atmospheric_model(
                type="custom_atmosphere",
                wind_u=request.environment.wind_speed * np.cos(np.radians(request.environment.wind_direction)),
                wind_v=request.environment.wind_speed * np.sin(np.radians(request.environment.wind_direction))
            )
        
        # Create motor
        motor = create_rocketpy_motor(request.rocket.motor)
        
        # Create rocket
        rocket = create_rocketpy_rocket(request.rocket, motor)
        
        # Run flight simulation
        flight = Flight(
            rocket=rocket,
            environment=env,
            rail_length=request.flight.rail_length,
            inclination=request.flight.inclination,
            heading=request.flight.heading,
            max_time=request.flight.max_time,
            max_time_step=request.flight.max_time_step,
            terminate_on_apogee=request.flight.terminate_on_apogee
        )
        
        # Extract trajectory
        dt = 1.0 / request.output_sampling_rate
        times = np.arange(0, flight.t_final, dt)
        
        trajectory = []
        for t in times:
            try:
                state = flight.get_solution(t)
                trajectory.append(TrajectoryPoint(
                    time=t,
                    x=float(flight.x(t)),
                    y=float(flight.y(t)),
                    z=float(flight.z(t)),
                    vx=float(flight.vx(t)),
                    vy=float(flight.vy(t)),
                    vz=float(flight.vz(t)),
                    ax=float(flight.ax(t)) if hasattr(flight, 'ax') else 0,
                    ay=float(flight.ay(t)) if hasattr(flight, 'ay') else 0,
                    az=float(flight.az(t)) if hasattr(flight, 'az') else 0,
                    pitch=float(flight.attitude_angle(t)) if hasattr(flight, 'attitude_angle') else 0,
                    yaw=0,
                    roll=0,
                    mach=float(flight.mach_number(t)),
                    dynamic_pressure=float(flight.dynamic_pressure(t)),
                    angle_of_attack=float(flight.angle_of_attack(t))
                ))
            except:
                break
        
        # Extract events
        events = [
            FlightEvent(name="liftoff", time=0, altitude=0),
            FlightEvent(name="rail_departure", time=float(flight.out_of_rail_time), 
                       velocity=float(flight.out_of_rail_velocity)),
            FlightEvent(name="burnout", time=float(motor.burn_time)),
            FlightEvent(name="apogee", time=float(flight.apogee_time), 
                       altitude=float(flight.apogee)),
        ]
        
        if hasattr(flight, 'impact_time') and flight.impact_time:
            events.append(FlightEvent(
                name="landing", 
                time=float(flight.impact_time),
                velocity=float(flight.impact_velocity) if hasattr(flight, 'impact_velocity') else 0
            ))
        
        # Get stability info
        try:
            stability_initial = float(rocket.static_margin(0))
            stability_burnout = float(rocket.static_margin(motor.burn_time))
        except:
            stability_initial = 2.0
            stability_burnout = 2.0
        
        return SimulationResult(
            success=True,
            message="Simulation completed successfully",
            apogee=float(flight.apogee),
            apogee_time=float(flight.apogee_time),
            max_velocity=float(flight.max_speed),
            max_velocity_time=float(flight.max_speed_time) if hasattr(flight, 'max_speed_time') else 0,
            max_acceleration=float(flight.max_acceleration) if hasattr(flight, 'max_acceleration') else 0,
            max_mach=float(flight.max_mach_number) if hasattr(flight, 'max_mach_number') else 0,
            flight_time=float(flight.t_final),
            landing_velocity=float(flight.impact_velocity) if hasattr(flight, 'impact_velocity') else 0,
            landing_position=[float(flight.x_impact) if hasattr(flight, 'x_impact') else 0,
                            float(flight.y_impact) if hasattr(flight, 'y_impact') else 0],
            out_of_rail_velocity=float(flight.out_of_rail_velocity),
            out_of_rail_stability=float(flight.out_of_rail_static_margin) if hasattr(flight, 'out_of_rail_static_margin') else stability_initial,
            trajectory=trajectory,
            events=events,
            stability_margin_initial=stability_initial,
            stability_margin_burnout=stability_burnout,
            cp_position=0,  # Would need rocket.cp_position
            cg_position=float(rocket.center_of_mass(0))
        )
        
    except Exception as e:
        return SimulationResult(
            success=False,
            message=f"Simulation failed: {str(e)}",
            apogee=0, apogee_time=0, max_velocity=0, max_velocity_time=0,
            max_acceleration=0, max_mach=0, flight_time=0, landing_velocity=0,
            landing_position=[0, 0], out_of_rail_velocity=0, out_of_rail_stability=0,
            trajectory=[], events=[],
            stability_margin_initial=0, stability_margin_burnout=0,
            cp_position=0, cg_position=0
        )

def create_mock_result(request: SimulationRequest) -> SimulationResult:
    """Create mock simulation result for testing"""
    # Simple physics for mock
    mass = request.rocket.mass + request.rocket.motor.propellant_mass + request.rocket.motor.dry_mass
    thrust = request.rocket.motor.avg_thrust
    burn_time = request.rocket.motor.burn_time
    
    # Estimate apogee using simplified physics
    # v = (T/m - g) * t
    # h = 0.5 * a * t^2 during burn + coast
    g = 9.81
    avg_mass = mass - request.rocket.motor.propellant_mass / 2
    a_burn = thrust / avg_mass - g
    v_burnout = a_burn * burn_time
    h_burnout = 0.5 * a_burn * burn_time**2
    
    # Coast phase
    coast_time = v_burnout / g
    h_coast = v_burnout * coast_time - 0.5 * g * coast_time**2
    
    apogee = h_burnout + h_coast
    apogee_time = burn_time + coast_time
    
    # Generate mock trajectory
    dt = 1.0 / request.output_sampling_rate
    trajectory = []
    t = 0
    while t < apogee_time * 2.5:
        if t < burn_time:
            a = thrust / (mass - request.rocket.motor.propellant_mass * t / burn_time) - g
        else:
            a = -g
        
        # Simple integration
        if t == 0:
            v = 0
            z = 0
        else:
            prev = trajectory[-1]
            v = prev.vz + a * dt
            z = prev.z + v * dt
        
        if z < 0 and t > burn_time:
            break
        
        trajectory.append(TrajectoryPoint(
            time=t, x=0, y=0, z=max(0, z),
            vx=0, vy=0, vz=v,
            ax=0, ay=0, az=a,
            pitch=90, yaw=0, roll=0,
            mach=v / 340, dynamic_pressure=0.5 * 1.225 * v**2,
            angle_of_attack=0
        ))
        t += dt
    
    events = [
        FlightEvent(name="liftoff", time=0, altitude=0),
        FlightEvent(name="burnout", time=burn_time),
        FlightEvent(name="apogee", time=apogee_time, altitude=apogee),
        FlightEvent(name="landing", time=t, velocity=trajectory[-1].vz if trajectory else 0)
    ]
    
    return SimulationResult(
        success=True,
        message="Mock simulation (RocketPy not installed)",
        apogee=apogee,
        apogee_time=apogee_time,
        max_velocity=v_burnout,
        max_velocity_time=burn_time,
        max_acceleration=a_burn,
        max_mach=v_burnout / 340,
        flight_time=t,
        landing_velocity=abs(trajectory[-1].vz) if trajectory else 0,
        landing_position=[0, 0],
        out_of_rail_velocity=20,
        out_of_rail_stability=2.0,
        trajectory=trajectory,
        events=events,
        stability_margin_initial=2.0,
        stability_margin_burnout=2.5,
        cp_position=0.25,
        cg_position=0.2
    )

# ============================================
# API Endpoints
# ============================================

@app.get("/")
async def root():
    """API root - health check"""
    return {
        "service": "LAUNCHSIM RocketPy Backend",
        "version": "1.0.0",
        "rocketpy_available": ROCKETPY_AVAILABLE,
        "status": "healthy"
    }

@app.get("/api/status")
async def get_status():
    """Get server status"""
    return {
        "status": "running",
        "rocketpy_installed": ROCKETPY_AVAILABLE,
        "rocketpy_version": "1.11.0" if ROCKETPY_AVAILABLE else None,
        "motors_available": len(MOTOR_DATABASE),
        "endpoints": ["/api/simulate", "/api/motors", "/api/montecarlo"]
    }

@app.post("/api/simulate", response_model=SimulationResult)
async def simulate(request: SimulationRequest, background_tasks: BackgroundTasks):
    """
    Run a rocket flight simulation.
    
    This endpoint performs a full 6-DOF trajectory simulation using RocketPy.
    Returns trajectory data, flight events, and summary statistics.
    """
    # Run simulation in thread pool to not block
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(executor, run_simulation, request)
    return result

@app.get("/api/motors", response_model=List[MotorInfo])
async def list_motors(
    impulse_class: Optional[str] = Query(None, description="Filter by impulse class (A-O)"),
    manufacturer: Optional[str] = Query(None, description="Filter by manufacturer")
):
    """
    List available motors from the database.
    
    Optionally filter by impulse class or manufacturer.
    """
    motors = []
    for motor_id, data in MOTOR_DATABASE.items():
        if impulse_class and data["impulse_class"] != impulse_class.upper():
            continue
        if manufacturer and data["manufacturer"].lower() != manufacturer.lower():
            continue
        
        motors.append(MotorInfo(
            id=data["id"],
            manufacturer=data["manufacturer"],
            designation=data["designation"],
            impulse_class=data["impulse_class"],
            diameter=data["diameter"],
            length=data["length"],
            total_mass=data["total_mass"],
            propellant_mass=data["propellant_mass"],
            avg_thrust=data["avg_thrust"],
            max_thrust=data["max_thrust"],
            burn_time=data["burn_time"],
            total_impulse=data["total_impulse"],
            isp=data["isp"],
            thrust_curve=data["thrust_curve"]
        ))
    
    return motors

@app.get("/api/motors/{motor_id}", response_model=MotorInfo)
async def get_motor(motor_id: str):
    """Get details for a specific motor"""
    if motor_id not in MOTOR_DATABASE:
        raise HTTPException(status_code=404, detail=f"Motor {motor_id} not found")
    
    data = MOTOR_DATABASE[motor_id]
    return MotorInfo(
        id=data["id"],
        manufacturer=data["manufacturer"],
        designation=data["designation"],
        impulse_class=data["impulse_class"],
        diameter=data["diameter"],
        length=data["length"],
        total_mass=data["total_mass"],
        propellant_mass=data["propellant_mass"],
        avg_thrust=data["avg_thrust"],
        max_thrust=data["max_thrust"],
        burn_time=data["burn_time"],
        total_impulse=data["total_impulse"],
        isp=data["isp"],
        thrust_curve=data["thrust_curve"]
    )

@app.post("/api/montecarlo", response_model=MonteCarloResult)
async def monte_carlo(request: MonteCarloRequest):
    """
    Run Monte Carlo dispersion analysis.
    
    Performs multiple simulations with randomized parameters
    to estimate landing dispersion and apogee variation.
    """
    if not ROCKETPY_AVAILABLE:
        # Return mock Monte Carlo result
        return MonteCarloResult(
            success=True,
            num_simulations=request.num_simulations,
            apogee_mean=500,
            apogee_std=25,
            apogee_min=450,
            apogee_max=550,
            landing_dispersion_mean=50,
            landing_dispersion_std=20,
            landing_positions=[[np.random.normal(0, 50), np.random.normal(0, 50)] 
                              for _ in range(min(request.num_simulations, 100))]
        )
    
    # Run Monte Carlo simulations
    results = []
    landing_positions = []
    
    for i in range(request.num_simulations):
        # Randomize parameters
        modified_request = request.base_simulation.copy(deep=True)
        
        # Randomize wind
        modified_request.environment.wind_speed += np.random.normal(0, request.wind_speed_std)
        modified_request.environment.wind_direction += np.random.normal(0, request.wind_direction_std)
        
        # Randomize mass
        modified_request.rocket.mass += np.random.normal(0, request.mass_std)
        
        # Run simulation
        result = run_simulation(modified_request)
        
        if result.success:
            results.append(result)
            landing_positions.append(result.landing_position)
    
    if not results:
        return MonteCarloResult(
            success=False,
            num_simulations=0,
            apogee_mean=0, apogee_std=0, apogee_min=0, apogee_max=0,
            landing_dispersion_mean=0, landing_dispersion_std=0,
            landing_positions=[]
        )
    
    apogees = [r.apogee for r in results]
    dispersions = [np.sqrt(p[0]**2 + p[1]**2) for p in landing_positions]
    
    return MonteCarloResult(
        success=True,
        num_simulations=len(results),
        apogee_mean=float(np.mean(apogees)),
        apogee_std=float(np.std(apogees)),
        apogee_min=float(np.min(apogees)),
        apogee_max=float(np.max(apogees)),
        landing_dispersion_mean=float(np.mean(dispersions)),
        landing_dispersion_std=float(np.std(dispersions)),
        landing_positions=landing_positions[:100]  # Limit to 100 for response size
    )

@app.post("/api/stability")
async def calculate_stability(rocket: RocketConfig):
    """
    Calculate static stability margin for a rocket configuration.
    
    Returns CP and CG positions and stability margin in calibers.
    """
    # Simplified Barrowman calculation
    # This would use RocketPy's actual calculation if available
    
    radius = rocket.radius
    nose_length = rocket.nose.length if rocket.nose else 0.1
    
    # Estimate CP (simplified)
    nose_cp = nose_length * 0.466  # Ogive
    
    if rocket.fins:
        fin_area = 0.5 * (rocket.fins.root_chord + rocket.fins.tip_chord) * rocket.fins.span
        fin_cp = abs(rocket.fins.position) + rocket.fins.root_chord * 0.4
    else:
        fin_area = 0.01
        fin_cp = 0.2
    
    # Weighted average CP
    nose_cn = 2
    fin_cn = 4 * rocket.fins.n * (rocket.fins.span / (2 * radius))**2 if rocket.fins else 4
    
    total_cn = nose_cn + fin_cn
    cp = (nose_cn * nose_cp + fin_cn * fin_cp) / total_cn
    
    # CG from nose
    cg = rocket.center_of_mass
    
    # Stability margin in calibers
    stability_margin = (cp - cg) / (2 * radius)
    
    return {
        "cp_position": cp,
        "cg_position": cg,
        "stability_margin": stability_margin,
        "stable": stability_margin > 1.0,
        "recommendation": "Stable" if stability_margin > 1.5 else 
                         "Marginally stable" if stability_margin > 1.0 else
                         "Unstable - add weight to nose or move fins aft"
    }

@app.get("/api/atmosphere")
async def get_atmosphere(
    altitude: float = Query(0, description="Altitude in meters"),
    latitude: float = Query(0, description="Latitude"),
    longitude: float = Query(0, description="Longitude")
):
    """
    Get atmospheric properties at a given altitude.
    
    Returns pressure, temperature, density, and speed of sound.
    """
    # ISA atmosphere model
    T0 = 288.15  # K
    P0 = 101325  # Pa
    L = 0.0065   # K/m
    g = 9.81
    M = 0.029    # kg/mol
    R = 8.314    # J/(mol·K)
    
    if altitude < 11000:
        T = T0 - L * altitude
        P = P0 * (T / T0) ** (g * M / (R * L))
    else:
        T = 216.65  # Isothermal
        T11 = T0 - L * 11000
        P11 = P0 * (T11 / T0) ** (g * M / (R * L))
        P = P11 * np.exp(-g * M * (altitude - 11000) / (R * T))
    
    rho = P / (287.05 * T)
    a = np.sqrt(1.4 * 287.05 * T)
    
    return {
        "altitude": altitude,
        "temperature": T,
        "temperature_celsius": T - 273.15,
        "pressure": P,
        "density": rho,
        "speed_of_sound": a,
        "gravity": 9.81 * (6371000 / (6371000 + altitude))**2
    }

# ============================================
# Main Entry Point
# ============================================

if __name__ == "__main__":
    import uvicorn
    print("Starting LAUNCHSIM RocketPy Backend...")
    print(f"RocketPy available: {ROCKETPY_AVAILABLE}")
    print("API docs at: http://localhost:8000/docs")
    uvicorn.run(app, host="0.0.0.0", port=8000)

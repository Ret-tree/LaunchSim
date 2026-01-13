/**
 * LAUNCHSIM Integration Module Tests
 * ==================================
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';

// Mock browser APIs
const mockLocalStorage = (() => {
  let store = {};
  return {
    getItem: (key) => store[key] || null,
    setItem: (key, value) => { store[key] = value; },
    removeItem: (key) => { delete store[key]; },
    clear: () => { store = {}; }
  };
})();

Object.defineProperty(global, 'localStorage', { value: mockLocalStorage });

// Mock FileReader
class MockFileReader {
  constructor() {
    this.result = null;
    this.onload = null;
    this.onerror = null;
  }
  
  readAsText(blob) {
    setTimeout(() => {
      this.result = blob._content || '';
      if (this.onload) this.onload({ target: { result: this.result } });
    }, 0);
  }
}

global.FileReader = MockFileReader;

// Mock DOMParser
class MockDOMParser {
  parseFromString(str, type) {
    return {
      querySelectorAll: (selector) => []
    };
  }
}

global.DOMParser = MockDOMParser;

// Import modules
import { 
  AltimeterDataImporter, 
  GPSTracker, 
  ClubSharing, 
  ALTIMETER_FORMATS 
} from '../src/integration/integration.js';

// ============================================
// Altimeter Data Importer Tests
// ============================================

describe('AltimeterDataImporter', () => {
  let importer;

  beforeEach(() => {
    importer = new AltimeterDataImporter();
  });

  test('should initialize with default options', () => {
    expect(importer.options.autoDetect).toBe(true);
    expect(importer.options.defaultFormat).toBe('GENERIC_CSV');
    expect(importer.options.smoothData).toBe(true);
  });

  test('should have supported formats defined', () => {
    const formats = importer.getSupportedFormats();
    expect(formats.length).toBeGreaterThan(5);
    expect(formats.some(f => f.id === 'STRATOLOGGER')).toBe(true);
    expect(formats.some(f => f.id === 'EGGTIMER')).toBe(true);
    expect(formats.some(f => f.id === 'JOLLY_LOGIC')).toBe(true);
    expect(formats.some(f => f.id === 'ALTUS_METRUM')).toBe(true);
  });

  test('should detect StratoLogger format', () => {
    const text = 'StratoLogger CF Data\n0.0,0,0,0\n0.1,10,50,5';
    const format = importer.detectFormat(text, 'data.csv');
    // Either format is acceptable - both are StratoLogger variants
    expect(['STRATOLOGGER', 'STRATOLOGGER_CF']).toContain(format);
  });

  test('should detect Eggtimer format', () => {
    const text = 'EggTimer Rocketry\nDevice ID: 12345\n0,0,0,IDLE';
    const format = importer.detectFormat(text, 'data.log');
    expect(format).toBe('EGGTIMER');
  });

  test('should detect Jolly Logic format', () => {
    const text = 'Jolly Logic AltimeterTwo\n0.0,0,0,0';
    const format = importer.detectFormat(text, 'data.csv');
    expect(format).toBe('JOLLY_LOGIC');
  });

  test('should detect Altus Metrum format', () => {
    const text = 'TeleMega Data\n0.0,0,0,0,0,0,0,IDLE';
    const format = importer.detectFormat(text, 'data.csv');
    expect(format).toBe('ALTUS_METRUM');
  });

  test('should default to GENERIC_CSV for unknown formats', () => {
    const text = 'time,altitude\n0.0,0\n0.1,10';
    const format = importer.detectFormat(text, 'data.csv');
    expect(format).toBe('GENERIC_CSV');
  });

  test('should parse generic CSV data', () => {
    const text = 'time,altitude\n0.0,0\n0.5,50\n1.0,100\n1.5,150\n2.0,100\n2.5,50\n3.0,0';
    const result = importer.importText(text, 'GENERIC_CSV');
    
    expect(result.source).toBe('altimeter');
    expect(result.format).toBe('GENERIC_CSV');
    expect(result.rawData.length).toBeGreaterThan(0);
    expect(result.analysis.apogee).toBeGreaterThan(0);
    expect(result.trajectory).toBeDefined();
    expect(result.events).toBeDefined();
  });

  test('should convert feet to meters', () => {
    const text = 'time,altitude\n0.0,0\n1.0,328'; // 328 ft ≈ 100 m
    const result = importer.importText(text, 'STRATOLOGGER');
    
    expect(result.rawData[1].altitude).toBeCloseTo(100, 0);
  });

  test('should detect apogee event', () => {
    const text = 'time,altitude\n0.0,0\n0.5,50\n1.0,100\n1.5,150\n2.0,100\n2.5,50\n3.0,0';
    const result = importer.importText(text, 'GENERIC_CSV');
    
    const apogeeEvent = result.events.find(e => e.event === 'Apogee');
    expect(apogeeEvent).toBeDefined();
    expect(apogeeEvent.altitude).toBe(150);
  });

  test('should detect launch event', () => {
    const text = 'time,altitude\n0.0,0\n0.5,10\n1.0,50\n1.5,100';
    const result = importer.importText(text, 'GENERIC_CSV');
    
    const launchEvent = result.events.find(e => e.event === 'Launch');
    expect(launchEvent).toBeDefined();
  });

  test('should calculate analysis metrics', () => {
    const text = 'time,altitude,velocity\n0.0,0,0\n0.5,25,50\n1.0,75,100\n1.5,150,100\n2.0,200,50\n2.5,225,25\n3.0,200,-25\n4.0,100,-50\n5.0,0,-20';
    const result = importer.importText(text, 'GENERIC_CSV');
    
    expect(result.analysis.apogee).toBe(225);
    expect(result.analysis.flightTime).toBe(5);
    expect(result.analysis.dataPoints).toBe(9);
    expect(result.analysis.maxVelocity).toBeGreaterThan(0);
  });

  test('should build trajectory with x position', () => {
    const text = 'time,altitude\n0.0,0\n1.0,100\n2.0,200\n3.0,100\n4.0,0';
    const result = importer.importText(text, 'GENERIC_CSV');
    
    expect(result.trajectory.length).toBe(5);
    expect(result.trajectory[2].x).toBeGreaterThan(0);
    expect(result.trajectory[2].altitude).toBe(200);
  });
});

// ============================================
// GPS Tracker Tests
// ============================================

describe('GPSTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new GPSTracker();
  });

  test('should initialize with default options', () => {
    expect(tracker.options.enableHighAccuracy).toBe(true);
    expect(tracker.options.updateInterval).toBe(1000);
    expect(tracker.isTracking).toBe(false);
    expect(tracker.trackPoints).toEqual([]);
  });

  test('should set launch site', () => {
    tracker.setLaunchSite(35.3472, -117.8085, 700);
    
    expect(tracker.launchSite.lat).toBe(35.3472);
    expect(tracker.launchSite.lon).toBe(-117.8085);
    expect(tracker.launchSite.alt).toBe(700);
  });

  test('should calculate distance correctly', () => {
    // Distance from 0,0 to 0,1 should be approximately 111km
    const dist = tracker.calculateDistance(0, 0, 0, 1);
    expect(dist).toBeCloseTo(111195, -3); // Within 1km
  });

  test('should calculate bearing correctly', () => {
    // Bearing from equator going east should be 90°
    const bearing = tracker.calculateBearing(0, 0, 0, 1);
    expect(bearing).toBeCloseTo(90, 0);

    // Bearing from equator going north should be 0°
    const bearingNorth = tracker.calculateBearing(0, 0, 1, 0);
    expect(bearingNorth).toBeCloseTo(0, 0);
  });

  test('should add and remove listeners', () => {
    const callback = vi.fn();
    const removeListener = tracker.addListener(callback);
    
    expect(tracker.listeners.size).toBe(1);
    
    removeListener();
    expect(tracker.listeners.size).toBe(0);
  });

  test('should generate GPX from track points', () => {
    tracker.trackPoints = [
      { lat: 35.3472, lon: -117.8085, alt: 700, timestamp: Date.now(), speed: 0 },
      { lat: 35.3473, lon: -117.8084, alt: 710, timestamp: Date.now() + 1000, speed: 5 }
    ];

    const gpx = tracker.exportGPX('Test Track');
    
    expect(gpx).toContain('<?xml version="1.0"');
    expect(gpx).toContain('<gpx');
    expect(gpx).toContain('Test Track');
    expect(gpx).toContain('<trkpt lat="35.3472"');
    expect(gpx).toContain('<ele>700</ele>');
  });

  test('should return null GPX for empty track', () => {
    const gpx = tracker.exportGPX();
    expect(gpx).toBeNull();
  });

  test('should calculate track summary', () => {
    const now = Date.now();
    tracker.trackPoints = [
      { lat: 35.3472, lon: -117.8085, alt: 700, timestamp: now, speed: 0 },
      { lat: 35.3482, lon: -117.8085, alt: 800, timestamp: now + 10000, speed: 100 },
      { lat: 35.3492, lon: -117.8085, alt: 600, timestamp: now + 20000, speed: 50 }
    ];

    const summary = tracker.getTrackSummary();
    
    expect(summary.pointCount).toBe(3);
    expect(summary.maxAltitude).toBe(800);
    expect(summary.maxSpeed).toBe(100);
    expect(summary.duration).toBe(20000);
    expect(summary.totalDistance).toBeGreaterThan(0);
  });

  test('should get current state', () => {
    tracker.setLaunchSite(35.0, -117.0);
    tracker.currentPosition = { lat: 35.1, lon: -117.1 };

    const state = tracker.getState();
    
    expect(state.isTracking).toBe(false);
    expect(state.launchSite).toEqual({ lat: 35.0, lon: -117.0, alt: 0 });
    expect(state.currentPosition).toBeDefined();
    expect(state.pointCount).toBe(0);
  });

  test('should dispose correctly', () => {
    const callback = vi.fn();
    tracker.addListener(callback);
    
    tracker.dispose();
    
    expect(tracker.listeners.size).toBe(0);
    expect(tracker.isTracking).toBe(false);
  });
});

// ============================================
// Club Sharing Tests
// ============================================

describe('ClubSharing', () => {
  let clubSharing;

  beforeEach(() => {
    mockLocalStorage.clear();
    clubSharing = new ClubSharing();
  });

  test('should initialize empty', () => {
    expect(clubSharing.clubs).toEqual([]);
    expect(clubSharing.getAllClubs()).toEqual([]);
  });

  test('should create a club', () => {
    const club = clubSharing.createClub({
      name: 'Test Rocketry Club',
      description: 'A test club',
      location: 'Test City'
    });

    expect(club.id).toMatch(/^club_/);
    expect(club.name).toBe('Test Rocketry Club');
    expect(club.description).toBe('A test club');
    expect(club.flights).toEqual([]);
    expect(club.competitions).toEqual([]);
    expect(clubSharing.clubs.length).toBe(1);
  });

  test('should get club by ID', () => {
    const created = clubSharing.createClub({ name: 'Find Me Club' });
    const found = clubSharing.getClub(created.id);
    
    expect(found).toBeDefined();
    expect(found.name).toBe('Find Me Club');
  });

  test('should update club', () => {
    const club = clubSharing.createClub({ name: 'Old Name' });
    const updated = clubSharing.updateClub(club.id, { name: 'New Name' });
    
    expect(updated.name).toBe('New Name');
    expect(updated.updatedAt).toBeDefined();
  });

  test('should delete club', () => {
    const club = clubSharing.createClub({ name: 'Delete Me' });
    const result = clubSharing.deleteClub(club.id);
    
    expect(result).toBe(true);
    expect(clubSharing.clubs.length).toBe(0);
  });

  test('should add member to club', () => {
    const club = clubSharing.createClub({ name: 'Member Club' });
    const member = clubSharing.addMember(club.id, {
      name: 'John Doe',
      email: 'john@example.com'
    });

    expect(member.id).toMatch(/^member_/);
    expect(member.name).toBe('John Doe');
    expect(member.role).toBe('member');
    
    const updatedClub = clubSharing.getClub(club.id);
    expect(updatedClub.members.length).toBe(1);
  });

  test('should remove member from club', () => {
    const club = clubSharing.createClub({ name: 'Member Club' });
    const member = clubSharing.addMember(club.id, { name: 'John' });
    
    const result = clubSharing.removeMember(club.id, member.id);
    
    expect(result).toBe(true);
    expect(clubSharing.getClub(club.id).members.length).toBe(0);
  });

  test('should share flight with club', () => {
    const club = clubSharing.createClub({ name: 'Flight Club' });
    
    const flight = clubSharing.shareFlightWithClub(club.id, {
      apogee: 500,
      maxVelocity: 150,
      flightTime: 30,
      trajectory: [{ time: 0, altitude: 0 }, { time: 15, altitude: 500 }],
      events: [{ event: 'Apogee', time: 15, altitude: 500 }]
    }, {
      rocketName: 'Test Rocket',
      motorName: 'F52'
    });

    expect(flight.id).toMatch(/^flight_/);
    expect(flight.metadata.rocketName).toBe('Test Rocket');
    expect(flight.summary.apogee).toBe(500);
    expect(clubSharing.getClub(club.id).flights.length).toBe(1);
  });

  test('should get club flights with filters', () => {
    const club = clubSharing.createClub({ name: 'Flight Club' });
    
    clubSharing.shareFlightWithClub(club.id, { apogee: 300 }, { rocketName: 'Alpha' });
    clubSharing.shareFlightWithClub(club.id, { apogee: 500 }, { rocketName: 'Beta' });
    clubSharing.shareFlightWithClub(club.id, { apogee: 400 }, { rocketName: 'Alpha' });

    const allFlights = clubSharing.getClubFlights(club.id);
    expect(allFlights.length).toBe(3);

    const alphaFlights = clubSharing.getClubFlights(club.id, { rocketName: 'Alpha' });
    expect(alphaFlights.length).toBe(2);
  });

  test('should create competition', () => {
    const club = clubSharing.createClub({ name: 'Comp Club' });
    
    const comp = clubSharing.createCompetition(club.id, {
      name: 'Spring Challenge',
      scoringMethod: 'highest',
      maxMotorClass: 'G'
    });

    expect(comp.id).toMatch(/^comp_/);
    expect(comp.name).toBe('Spring Challenge');
    expect(comp.status).toBe('upcoming');
    expect(comp.entries).toEqual([]);
  });

  test('should submit competition entry', () => {
    const club = clubSharing.createClub({ name: 'Comp Club' });
    const comp = clubSharing.createCompetition(club.id, {
      name: 'Challenge',
      scoringMethod: 'highest'
    });
    
    // Activate competition
    clubSharing.updateCompetitionStatus(club.id, comp.id, 'active');

    const entry = clubSharing.submitCompetitionEntry(club.id, comp.id, {
      userName: 'John',
      rocketName: 'Alpha',
      apogee: 500,
      maxVelocity: 150,
      flightTime: 30
    });

    expect(entry.id).toMatch(/^entry_/);
    expect(entry.userName).toBe('John');
    expect(entry.score).toBe(500); // For 'highest', score = apogee
  });

  test('should calculate TARC-style score', () => {
    const club = clubSharing.createClub({ name: 'TARC Club' });
    const comp = clubSharing.createCompetition(club.id, {
      name: 'TARC',
      scoringMethod: 'tarc',
      targetAltitude: 256,
      targetDuration: 43
    });

    const score = clubSharing.calculateScore(comp, {
      apogee: 260,  // 4m off
      flightTime: 45 // 2s off
    });

    expect(score).toBe(6); // 4 + 2 = 6 (lower is better)
  });

  test('should calculate closest score', () => {
    const club = clubSharing.createClub({ name: 'Target Club' });
    const comp = clubSharing.createCompetition(club.id, {
      name: 'Target',
      scoringMethod: 'closest',
      targetAltitude: 300
    });

    const score = clubSharing.calculateScore(comp, { apogee: 290 });
    expect(score).toBe(90); // 100 - 10 = 90
  });

  test('should get leaderboard', () => {
    const club = clubSharing.createClub({ name: 'Leader Club' });
    const comp = clubSharing.createCompetition(club.id, {
      name: 'Race',
      scoringMethod: 'highest'
    });
    
    clubSharing.updateCompetitionStatus(club.id, comp.id, 'active');

    clubSharing.submitCompetitionEntry(club.id, comp.id, { userName: 'A', apogee: 300 });
    clubSharing.submitCompetitionEntry(club.id, comp.id, { userName: 'B', apogee: 500 });
    clubSharing.submitCompetitionEntry(club.id, comp.id, { userName: 'C', apogee: 400 });

    const leaderboard = clubSharing.getLeaderboard(club.id, comp.id);
    
    expect(leaderboard[0].rank).toBe(1);
    expect(leaderboard[0].userName).toBe('B');
    expect(leaderboard[1].rank).toBe(2);
    expect(leaderboard[1].userName).toBe('C');
  });

  test('should export club data', () => {
    const club = clubSharing.createClub({ name: 'Export Club', description: 'Test' });
    clubSharing.shareFlightWithClub(club.id, { apogee: 500 }, { rocketName: 'Alpha' });

    const exported = clubSharing.exportClub(club.id);
    
    expect(exported.exportVersion).toBe('1.0');
    expect(exported.club.name).toBe('Export Club');
    expect(exported.flights.length).toBe(1);
    expect(exported.statistics).toBeDefined();
  });

  test('should import club data', () => {
    const data = {
      club: { name: 'Imported Club', description: 'From import' },
      flights: [{ id: 'f1', summary: { apogee: 500 }, metadata: { rocketName: 'Beta' } }],
      competitions: []
    };

    const imported = clubSharing.importClub(data);
    
    expect(imported.name).toBe('Imported Club');
    expect(imported.flights.length).toBe(1);
  });

  test('should generate and parse share link', () => {
    const club = clubSharing.createClub({ name: 'Share Club' });
    
    const link = clubSharing.generateShareLink(club.id);
    expect(link).toMatch(/^launchsim:\/\/share\//);

    const parsed = clubSharing.parseShareLink(link);
    expect(parsed.type).toBe('club');
    expect(parsed.club).toBeDefined();
  });

  test('should get club statistics', () => {
    const club = clubSharing.createClub({ name: 'Stats Club' });
    clubSharing.addMember(club.id, { name: 'John' });
    clubSharing.addMember(club.id, { name: 'Jane' });
    clubSharing.shareFlightWithClub(club.id, { apogee: 300, maxVelocity: 100 }, { rocketName: 'A' });
    clubSharing.shareFlightWithClub(club.id, { apogee: 500, maxVelocity: 150 }, { rocketName: 'A' });
    clubSharing.shareFlightWithClub(club.id, { apogee: 400, maxVelocity: 120 }, { rocketName: 'B' });

    const stats = clubSharing.getClubStatistics(club.id);
    
    expect(stats.totalFlights).toBe(3);
    expect(stats.memberCount).toBe(2);
    expect(stats.maxApogee).toBe(500);
    expect(stats.averageApogee).toBe(400);
    expect(stats.topRockets.length).toBe(2);
    expect(stats.topRockets[0].name).toBe('A');
    expect(stats.topRockets[0].count).toBe(2);
  });

  test('should sample trajectory', () => {
    const trajectory = Array.from({ length: 200 }, (_, i) => ({ time: i, alt: i * 2 }));
    const sampled = clubSharing.sampleTrajectory(trajectory, 50);
    
    expect(sampled.length).toBeLessThanOrEqual(51);
    expect(sampled[0]).toEqual(trajectory[0]);
    expect(sampled[sampled.length - 1]).toEqual(trajectory[trajectory.length - 1]);
  });

  test('should persist clubs to localStorage', () => {
    clubSharing.createClub({ name: 'Persist Club' });
    
    // Create new instance to test loading
    const newInstance = new ClubSharing();
    expect(newInstance.clubs.length).toBe(1);
    expect(newInstance.clubs[0].name).toBe('Persist Club');
  });
});

// ============================================
// ALTIMETER_FORMATS Tests
// ============================================

describe('ALTIMETER_FORMATS', () => {
  test('should have required format properties', () => {
    const requiredProps = ['name', 'extensions', 'delimiter', 'columns', 'altitudeUnit', 'headerLines'];
    
    Object.values(ALTIMETER_FORMATS).forEach(format => {
      requiredProps.forEach(prop => {
        expect(format).toHaveProperty(prop);
      });
    });
  });

  test('should have StratoLogger format', () => {
    expect(ALTIMETER_FORMATS.STRATOLOGGER).toBeDefined();
    expect(ALTIMETER_FORMATS.STRATOLOGGER.name).toBe('PerfectFlite StratoLogger');
    expect(ALTIMETER_FORMATS.STRATOLOGGER.altitudeUnit).toBe('ft');
  });

  test('should have Altus Metrum format with metric units', () => {
    expect(ALTIMETER_FORMATS.ALTUS_METRUM).toBeDefined();
    expect(ALTIMETER_FORMATS.ALTUS_METRUM.altitudeUnit).toBe('m');
    expect(ALTIMETER_FORMATS.ALTUS_METRUM.velocityUnit).toBe('m/s');
  });
});

console.log('✅ Integration module tests loaded');

/*
 * Copyright (C) 2025 TomTom NV
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect } from 'vitest';
import {
  generateCirclePoints,
  calculateOptimalZoom,
  calculateEnhancedBounds,
  extractCoordinates,
  Point,
  MapMarker,
  MapPolygon
} from './geometryUtils';

describe('generateCirclePoints', () => {
  it('generates correct number of points', () => {
    const points = generateCirclePoints(0, 0, 1000, 32);
    expect(points).toHaveLength(32);
  });

  it('generates points roughly equidistant from center', () => {
    const center: Point = { lat: 52.3731663, lon: 4.8906596 };
    const radius = 1000; // 1km
    const points = generateCirclePoints(center.lat, center.lon, radius);
    
    // Check a few random points are roughly the same distance from center
    const distances = points.map(point => {
      const dLat = (point.lat - center.lat) * Math.PI / 180;
      const dLon = (point.lon - center.lon) * Math.PI / 180;
      const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                Math.cos(center.lat * Math.PI / 180) * Math.cos(point.lat * Math.PI / 180) * 
                Math.sin(dLon/2) * Math.sin(dLon/2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return 6371000 * c; // Earth's radius in meters
    });

    // All distances should be roughly equal to radius
    distances.forEach(d => {
      expect(d).toBeCloseTo(radius, -1); // Less precise comparison due to spherical math
    });
  });

  it('returns points within valid coordinate ranges', () => {
    const points = generateCirclePoints(0, 0, 10000, 32);
    points.forEach(point => {
      expect(point.lat).toBeGreaterThanOrEqual(-90);
      expect(point.lat).toBeLessThanOrEqual(90);
      expect(point.lon).toBeGreaterThanOrEqual(-180);
      expect(point.lon).toBeLessThanOrEqual(180);
    });
  });
});

describe('calculateOptimalZoom', () => {
  it('returns correct zoom for small area', () => {
    const bounds = {
      north: 52.38,
      south: 52.37,
      east: 4.90,
      west: 4.89
    };
    const zoom = calculateOptimalZoom(bounds, 800, 600);
    expect(zoom).toBeGreaterThan(12); // Should be zoomed in for small area
  });

  it('returns correct zoom for large area', () => {
    const bounds = {
      north: 55.0,
      south: 50.0,
      east: 10.0,
      west: 0.0
    };
    const zoom = calculateOptimalZoom(bounds, 800, 600);
    expect(zoom).toBeLessThan(8); // Should be zoomed out for large area
  });

  it('respects minimum and maximum zoom levels', () => {
    const bounds = {
      north: 90,
      south: -90,
      east: 180,
      west: -180
    };
    const zoom = calculateOptimalZoom(bounds, 800, 600);
    expect(zoom).toBeGreaterThanOrEqual(1);
    expect(zoom).toBeLessThanOrEqual(17);
  });
});

describe('calculateEnhancedBounds', () => {
  const amsterdamMarker: MapMarker = {
    lat: 52.3731663,
    lon: 4.8906596,
    label: 'Amsterdam'
  };

  const berlinMarker: MapMarker = {
    lat: 52.5234292,
    lon: 13.4114365,
    label: 'Berlin'
  };

  it('calculates bounds for single marker', () => {
    const result = calculateEnhancedBounds([amsterdamMarker], [], 800, 600);
    // For a single marker, bounds should include the marker and have padding
    expect(result.bounds.north).toBeGreaterThanOrEqual(amsterdamMarker.lat);
    expect(result.bounds.south).toBeLessThanOrEqual(amsterdamMarker.lat);
    expect(result.bounds.east).toBeGreaterThanOrEqual(amsterdamMarker.lon);
    expect(result.bounds.west).toBeLessThanOrEqual(amsterdamMarker.lon);
    
    // Verify padding exists
    const latPadding = result.bounds.north - result.bounds.south;
    const lonPadding = result.bounds.east - result.bounds.west;
    expect(latPadding).toBeGreaterThan(0);
    expect(lonPadding).toBeGreaterThan(0);
  });

  it('calculates bounds for multiple markers', () => {
    const result = calculateEnhancedBounds([amsterdamMarker, berlinMarker], [], 800, 600);
    expect(result.bounds.north).toBeGreaterThan(Math.max(amsterdamMarker.lat, berlinMarker.lat));
    expect(result.bounds.south).toBeLessThan(Math.min(amsterdamMarker.lat, berlinMarker.lat));
    expect(result.bounds.east).toBeGreaterThan(Math.max(amsterdamMarker.lon, berlinMarker.lon));
    expect(result.bounds.west).toBeLessThan(Math.min(amsterdamMarker.lon, berlinMarker.lon));
  });

  it('includes polygon coordinates in bounds calculation', () => {
    const polygon: MapPolygon = {
      type: 'polygon',
      coordinates: [
        [4.8906596, 52.3731663],
        [13.4114365, 52.5234292],
        [4.8906596, 52.3731663]
      ]
    };
    const result = calculateEnhancedBounds([], [], 800, 600, [polygon]);
    expect(result.bounds.north).toBeGreaterThan(52.3731663);
    expect(result.bounds.east).toBeGreaterThan(13.4114365);
  });

  it('includes circle points in bounds calculation', () => {
    const circle: MapPolygon = {
      type: 'circle',
      center: { lat: 52.3731663, lon: 4.8906596 },
      radius: 1000
    };
    const result = calculateEnhancedBounds([], [], 800, 600, [circle]);
    expect(result.bounds.north).toBeGreaterThan(52.3731663);
    expect(result.bounds.south).toBeLessThan(52.3731663);
  });

  it('adds appropriate padding for different scenarios', () => {
    // Single marker
    const singleResult = calculateEnhancedBounds([amsterdamMarker], [], 800, 600);
    const singleLatSpan = singleResult.bounds.north - singleResult.bounds.south;
    const singleLonSpan = singleResult.bounds.east - singleResult.bounds.west;

    // Multiple markers
    const multiResult = calculateEnhancedBounds([amsterdamMarker, berlinMarker], [], 800, 600);
    const multiLatSpan = multiResult.bounds.north - multiResult.bounds.south;
    const multiLonSpan = multiResult.bounds.east - multiResult.bounds.west;

    // Verify that both scenarios have appropriate padding
    expect(singleLatSpan).toBeGreaterThan(0);
    expect(singleLonSpan).toBeGreaterThan(0);
    expect(multiLatSpan).toBeGreaterThan(0);
    expect(multiLonSpan).toBeGreaterThan(0);
    
    // Check that padding is proportional to the area being mapped
    expect(multiLatSpan).toBeGreaterThan(singleLatSpan);
    expect(multiLonSpan).toBeGreaterThan(singleLonSpan);
  });
});

describe('extractCoordinates', () => {
  it('extracts coordinates from array format', () => {
    const coords = extractCoordinates([52.3731663, 4.8906596], 0);
    expect(coords).toEqual({ lat: 52.3731663, lon: 4.8906596 });
  });

  it('extracts coordinates from object format', () => {
    const coords = extractCoordinates({ lat: 52.3731663, lon: 4.8906596 }, 0);
    expect(coords).toEqual({ lat: 52.3731663, lon: 4.8906596 });
  });

  it('extracts coordinates from coordinates object', () => {
    const coords = extractCoordinates({ coordinates: [52.3731663, 4.8906596] }, 0);
    expect(coords).toEqual({ lat: 52.3731663, lon: 4.8906596 });
  });

  it('validates coordinate ranges', () => {
    const coords = extractCoordinates({ lat: 100, lon: 200 }, 0);
    expect(coords).toBeNull();
  });

  it('handles invalid input gracefully', () => {
    const coords = extractCoordinates({ latitude: 52, longitude: 4 }, 0);
    expect(coords).toBeNull();
  });
});
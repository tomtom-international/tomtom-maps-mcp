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

import { logger } from "../../utils/logger";

/**
 * Represents a geographic point with latitude and longitude
 */
export interface Point {
  /** Latitude in degrees (-90 to 90) */
  lat: number;
  /** Longitude in degrees (-180 to 180) */
  lon: number;
}

/**
 * Represents a marker on the map with optional styling
 */
export interface MapMarker extends Point {
  /** Optional label for the marker */
  label?: string;
  /** Color in hex or rgba format */
  color?: string;
  /** Display priority for label visibility */
  priority?: 'critical' | 'high' | 'normal' | 'low';
}

/**
 * Represents a polygon with styling options
 */
export interface MapPolygon {
  /** Type of shape */
  type: 'polygon' | 'circle';
  /** Optional label for the polygon */
  label?: string;
  /** Fill color in rgba format */
  fillColor?: string;
  /** Stroke color in hex format */
  strokeColor?: string;
  /** Stroke width in pixels */
  strokeWidth?: number;
  /** For type='polygon': Array of [longitude, latitude] coordinates */
  coordinates?: [number, number][];
  /** For type='circle': Center point */
  center?: Point;
  /** For type='circle': Radius in meters */
  radius?: number;
}

/**
 * Represents geographic bounds
 */
export interface Bounds {
  /** Northern latitude bound */
  north: number;
  /** Southern latitude bound */
  south: number;
  /** Eastern longitude bound */
  east: number;
  /** Western longitude bound */
  west: number;
}

/**
 * Result of bounds calculation including center and zoom
 */
export interface BoundsResult {
  /** Calculated bounds with padding */
  bounds: Bounds;
  /** Center point [longitude, latitude] */
  center: [number, number];
  /** Calculated optimal zoom level */
  zoom: number;
}

/**
 * Generate points to approximate a circle using great circle calculations
 */
export function generateCirclePoints(
  centerLat: number,
  centerLon: number,
  radiusMeters: number,
  numPoints: number = 64
): Point[] {
  const points: Point[] = [];
  const earthRadiusMeters = 6371000;
  
  // Convert radius from meters to radians
  const radiusRadians = radiusMeters / earthRadiusMeters;
  
  // Convert center to radians
  const centerLatRad = (centerLat * Math.PI) / 180;
  const centerLonRad = (centerLon * Math.PI) / 180;

  for (let i = 0; i < numPoints; i++) {
    const angle = (2 * Math.PI * i) / numPoints;
    
    // Calculate point on circle using great circle formula
    const latRad = Math.asin(
      Math.sin(centerLatRad) * Math.cos(radiusRadians) +
      Math.cos(centerLatRad) * Math.sin(radiusRadians) * Math.cos(angle)
    );
    
    const lonRad = centerLonRad + Math.atan2(
      Math.sin(angle) * Math.sin(radiusRadians) * Math.cos(centerLatRad),
      Math.cos(radiusRadians) - Math.sin(centerLatRad) * Math.sin(latRad)
    );

    // Convert back to degrees
    points.push({
      lat: (latRad * 180) / Math.PI,
      lon: (lonRad * 180) / Math.PI
    });
  }

  return points;
}

/**
 * Calculate optimal zoom level for the given bounds and map dimensions
 */
export function calculateOptimalZoom(
  bounds: Bounds,
  mapWidth: number,
  mapHeight: number,
  paddingPixels: number = 80
): number {
  const WORLD_PX_HEIGHT = 256; // Height of map in pixels at zoom level 0
  const WORLD_PX_WIDTH = 256;  // Width of map in pixels at zoom level 0
  
  // Calculate effective dimensions
  const effectiveWidth = mapWidth - paddingPixels * 2;
  const effectiveHeight = mapHeight - paddingPixels * 2;

  // Calculate spans
  const latSpan = bounds.north - bounds.south;
  const lngSpan = bounds.east - bounds.west;

  // Calculate zoom based on latitude
  const latZoom = Math.log2(
    (effectiveHeight * 360) / (latSpan * WORLD_PX_HEIGHT)
  );

  // Calculate zoom based on longitude
  const lngZoom = Math.log2(
    (effectiveWidth * 360) / (lngSpan * WORLD_PX_WIDTH)
  );

  // Use the more restrictive zoom
  const zoom = Math.min(latZoom, lngZoom);

  // Add additional zoom out factor for better view
  const zoomOutFactor = 0.5;  // Increased from 0.1 to 0.5 for better overview

  // Clamp to reasonable bounds after applying zoom out
  return Math.max(1, Math.min(17, zoom - zoomOutFactor));
}

/**
 * Calculate enhanced bounds with buffer for a set of points
 */
export function calculateEnhancedBounds(
  markers: any[],
  routes: any[],
  mapWidth: number,
  mapHeight: number,
  polygons: any[] = []
): BoundsResult {
  // Collect all points
  const points: Point[] = [];

  // Add marker points
  if (markers?.length > 0) {
    markers.forEach((marker, index) => {
      const coords = extractCoordinates(marker, index, "marker");
      if (coords) points.push(coords);
    });
  }

  // Add route points
  if (routes?.length > 0) {
    routes.forEach((route, routeIndex) => {
      if (Array.isArray(route)) {
        route.forEach((point, pointIndex) => {
          const coords = extractCoordinates(point, `${routeIndex}-${pointIndex}`, "route point");
          if (coords) points.push(coords);
        });
      } else if (route.points && Array.isArray(route.points)) {
        route.points.forEach((point: any, pointIndex: number) => {
          const coords = extractCoordinates(point, `${routeIndex}-${pointIndex}`, "route point");
          if (coords) points.push(coords);
        });
      }
    });
  }

  // Add polygon points and handle circles
  if (polygons?.length > 0) {
    polygons.forEach((polygon, polygonIndex) => {
      // Handle polygon coordinates
      if (polygon.coordinates && Array.isArray(polygon.coordinates)) {
        polygon.coordinates.forEach((coord: [number, number]) => {
          if (Array.isArray(coord) && coord.length >= 2) {
            points.push({ lat: coord[1], lon: coord[0] });
          }
        });
      }

      // Handle circles by converting to polygon points
      if (polygon.type === 'circle' && polygon.center && polygon.radius) {
        const circlePoints = generateCirclePoints(
          polygon.center.lat,
          polygon.center.lon,
          polygon.radius,
          64 // number of points to approximate circle
        );
        points.push(...circlePoints);
      }
    });
  }

  if (points.length === 0) {
    throw new Error("No valid coordinates found to calculate bounds");
  }

  // Calculate raw bounds
  const bounds: Bounds = {
    north: Math.max(...points.map(p => p.lat)),
    south: Math.min(...points.map(p => p.lat)),
    east: Math.max(...points.map(p => p.lon)),
    west: Math.min(...points.map(p => p.lon))
  };

  // Calculate spans
  const latSpan = bounds.north - bounds.south;
  const lngSpan = bounds.east - bounds.west;
  const maxSpan = Math.max(latSpan, lngSpan);
  const markerCount = markers ? markers.length : 0;

  // Calculate buffer with enhanced padding
  let bufferDegrees: number;
  
  // Base buffer calculation
  if (markerCount === 1) {
    // Single marker needs more padding for better visibility
    // For a single point (where spans are 0), use a default buffer of 0.1 degrees
    bufferDegrees = maxSpan === 0 ? 0.1 : maxSpan * 0.5;
  } else if (maxSpan < 0.001) {
    // Very small area needs significant padding
    bufferDegrees = 0.05;
  } else if (maxSpan < 0.01) {
    // Small area needs more relative padding
    bufferDegrees = maxSpan * 0.8;
  } else if (maxSpan < 0.1) {
    // Medium area needs moderate padding
    bufferDegrees = maxSpan * 0.6;
  } else {
    // Larger areas need proportional padding
    bufferDegrees = maxSpan * 0.4;
  }

  // Apply route-specific padding
  const hasRoutes = routes && routes.length > 0;
  if (hasRoutes) {
    if (markerCount > 1) {
      // Routes with multiple points need extra room for route visualization
      bufferDegrees *= 1.8;
    } else {
      // Routes with single marker still need some extra padding
      bufferDegrees *= 1.5;
    }
  }

  // Apply polygon-specific padding
  const hasPolygons = polygons && polygons.length > 0;
  if (hasPolygons) {
    bufferDegrees *= 1.3;  // Extra space for polygon visualization
  }

  // Scale based on marker density
  if (markerCount > 3) {
    bufferDegrees *= 1.4;  // More space for dense marker clusters
  }

  // Ensure minimum buffer for better visual appeal
  const minBuffer = maxSpan * 0.15;
  bufferDegrees = Math.max(bufferDegrees, minBuffer);

  // Apply buffer to bounds
  const bufferedBounds: Bounds = {
    north: Math.min(90, bounds.north + bufferDegrees),
    south: Math.max(-90, bounds.south - bufferDegrees),
    east: Math.min(180, bounds.east + bufferDegrees),
    west: Math.max(-180, bounds.west - bufferDegrees)
  };

  // Calculate center as [longitude, latitude]
  const center: [number, number] = [
    (bufferedBounds.west + bufferedBounds.east) / 2,
    (bufferedBounds.south + bufferedBounds.north) / 2
  ];

  // Calculate zoom
  const zoom = calculateOptimalZoom(bufferedBounds, mapWidth, mapHeight);

  return { bounds: bufferedBounds, center, zoom };
}

/**
 * Extract and validate coordinates from various formats
 */
export function extractCoordinates(
  item: any,
  index: number | string,
  type: string = "marker"
): Point | null {
  let lat: number | undefined, lon: number | undefined;

  if (Array.isArray(item)) {
    // Handle array format [lat, lon]
    if (item.length >= 2) {
      lat = item[0];
      lon = item[1];
    }
  } else if (item.coordinates && Array.isArray(item.coordinates)) {
    // Handle {coordinates: [lat, lon]} format
    if (item.coordinates.length >= 2) {
      lat = item.coordinates[0];
      lon = item.coordinates[1];
    }
  } else if (item.lat !== undefined && item.lon !== undefined) {
    // Handle {lat: x, lon: y} format (standard)
    lat = item.lat;
    lon = item.lon;
  }

  if (lat === undefined || lon === undefined) {
    logger.warn(`❌ Could not extract coordinates from ${type} ${index}`);
    return null;
  }

  try {
    const validLat = validateCoordinate(lat, "latitude");
    const validLon = validateCoordinate(lon, "longitude");
    return { lat: validLat, lon: validLon };
  } catch (error: any) {
    logger.warn(`❌ Invalid coordinates for ${type} ${index}: ${error.message}`);
    return null;
  }
}

/**
 * Validate and sanitize coordinate values
 */
function validateCoordinate(value: any, type: string): number {
  const num = parseFloat(value);
  if (isNaN(num)) {
    throw new Error(`Invalid ${type} coordinate: ${value}`);
  }

  if (type === "latitude" && (num < -90 || num > 90)) {
    throw new Error(`Latitude out of range [-90, 90]: ${num}`);
  }

  if (type === "longitude" && (num < -180 || num > 180)) {
    throw new Error(`Longitude out of range [-180, 180]: ${num}`);
  }

  return num;
}
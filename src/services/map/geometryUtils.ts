/*
 * Copyright (C) 2025 TomTom Navigation B.V.
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

import type { Position } from "geojson";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import type { MapPolygon } from "./dynamicMapTypes";

/**
 * Represents a geographic point with latitude and longitude
 */
export interface Point {
  /** Latitude in degrees (-90 to 90) */
  lat: number;
  /** Longitude in degrees (-180 to 180) */
  lon: number;
}

/** A shape is drawn as a circle when typed so, or when it has a centre and radius. */
export function isCircle(
  polygon: MapPolygon
): polygon is MapPolygon & { center: Point; radius: number } {
  return polygon.type === "circle" || (!!polygon.center && !!polygon.radius);
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

  const radiusRadians = radiusMeters / earthRadiusMeters;

  const centerLatRad = (centerLat * Math.PI) / 180;
  const centerLonRad = (centerLon * Math.PI) / 180;

  for (let i = 0; i < numPoints; i++) {
    const angle = (2 * Math.PI * i) / numPoints;

    // Calculate point on circle using great circle formula
    const latRad = Math.asin(
      Math.sin(centerLatRad) * Math.cos(radiusRadians) +
        Math.cos(centerLatRad) * Math.sin(radiusRadians) * Math.cos(angle)
    );

    const lonRad =
      centerLonRad +
      Math.atan2(
        Math.sin(angle) * Math.sin(radiusRadians) * Math.cos(centerLatRad),
        Math.cos(radiusRadians) - Math.sin(centerLatRad) * Math.sin(latRad)
      );

    points.push({
      lat: (latRad * 180) / Math.PI,
      lon: (lonRad * 180) / Math.PI,
    });
  }

  return points;
}

/**
 * Compute the centroid of a polygon from its exterior coordinate ring.
 * Uses the shoelace/Green's theorem formula for geometric accuracy —
 * a simple coordinate average can place the centroid outside irregular shapes.
 */
export function computePolygonCentroid(
  coordinates: Position[] // [lon, lat] exterior ring
): Point {
  if (coordinates.length === 0) {
    return { lon: 0, lat: 0 };
  }

  let signedArea = 0;
  let cx = 0;
  let cy = 0;

  const n = coordinates.length;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = coordinates[i];
    const [x1, y1] = coordinates[(i + 1) % n];
    const cross = x0 * y1 - x1 * y0;
    signedArea += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }

  // Degenerate polygon: fall back to simple average
  if (Math.abs(signedArea) < 1e-12) {
    const avgLon = coordinates.reduce((s, c) => s + c[0], 0) / n;
    const avgLat = coordinates.reduce((s, c) => s + c[1], 0) / n;
    return { lon: avgLon, lat: avgLat };
  }

  signedArea *= 0.5;
  cx /= 6 * signedArea;
  cy /= 6 * signedArea;

  return { lon: cx, lat: cy };
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
  const WORLD_PX_WIDTH = 256; // Width of map in pixels at zoom level 0

  const effectiveWidth = mapWidth - paddingPixels * 2;
  const effectiveHeight = mapHeight - paddingPixels * 2;

  const latSpan = bounds.north - bounds.south;
  const lngSpan = bounds.east - bounds.west;

  const latZoom = Math.log2((effectiveHeight * 360) / (latSpan * WORLD_PX_HEIGHT));

  const lngZoom = Math.log2((effectiveWidth * 360) / (lngSpan * WORLD_PX_WIDTH));

  // Use the more restrictive zoom
  const zoom = Math.min(latZoom, lngZoom);

  // Add additional zoom out factor for better view
  const zoomOutFactor = 0.5;

  // Clamp to reasonable bounds after applying zoom out
  return Math.max(1, Math.min(17, zoom - zoomOutFactor));
}

/**
 * Calculate enhanced bounds with buffer for a set of points
 */
export function calculateEnhancedBounds(
  markers: Point[],
  routes: Point[][],
  mapWidth: number,
  mapHeight: number,
  polygons: MapPolygon[] = []
): BoundsResult {
  const points: Point[] = [...markers, ...routes.flat()];

  for (const polygon of polygons) {
    if (isCircle(polygon)) {
      points.push(...generateCirclePoints(polygon.center.lat, polygon.center.lon, polygon.radius));
    } else {
      for (const [lon, lat] of polygon.coordinates ?? []) points.push({ lat, lon });
    }
  }

  if (points.length === 0) {
    throw new IncorrectError("No valid coordinates found to calculate bounds", {});
  }

  const bounds: Bounds = {
    north: Math.max(...points.map((p) => p.lat)),
    south: Math.min(...points.map((p) => p.lat)),
    east: Math.max(...points.map((p) => p.lon)),
    west: Math.min(...points.map((p) => p.lon)),
  };

  const latSpan = bounds.north - bounds.south;
  const lngSpan = bounds.east - bounds.west;
  const maxSpan = Math.max(latSpan, lngSpan);
  const markerCount = markers.length;

  let bufferDegrees: number;

  if (markerCount === 1) {
    // A lone point has zero span, so use 0.1°
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
  if (routes.length > 0) {
    if (markerCount > 1) {
      // Routes with multiple points need extra room for route visualization
      bufferDegrees *= 1.8;
    } else {
      // Routes with single marker still need some extra padding
      bufferDegrees *= 1.5;
    }
  }

  // Apply polygon-specific padding
  if (polygons.length > 0) {
    bufferDegrees *= 1.3; // Extra space for polygon visualization
  }

  // Scale based on marker density
  if (markerCount > 3) {
    bufferDegrees *= 1.4; // More space for dense marker clusters
  }

  // Ensure minimum buffer for better visual appeal
  const minBuffer = maxSpan * 0.15;
  bufferDegrees = Math.max(bufferDegrees, minBuffer);

  const bufferedBounds: Bounds = {
    north: Math.min(90, bounds.north + bufferDegrees),
    south: Math.max(-90, bounds.south - bufferDegrees),
    east: Math.min(180, bounds.east + bufferDegrees),
    west: Math.max(-180, bounds.west - bufferDegrees),
  };

  // [lon, lat]
  const center: [number, number] = [
    (bufferedBounds.west + bufferedBounds.east) / 2,
    (bufferedBounds.south + bufferedBounds.north) / 2,
  ];

  const zoom = calculateOptimalZoom(bufferedBounds, mapWidth, mapHeight);

  return { bounds: bufferedBounds, center, zoom };
}

/** Whether the point's latitude and longitude are in range; logs the point when not. */
export function isValidPoint(point: Point, index: number | string, type: string): boolean {
  const { lat, lon } = point;
  const valid = Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  if (!valid) logger.warn({ type, index, lat, lon }, "Invalid coordinates");
  return valid;
}

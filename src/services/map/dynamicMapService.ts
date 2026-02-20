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

import { tomtomClient, validateApiKey } from "../base/tomtomClient";
import { logger } from "../../utils/logger";
import { fetchCopyrightCaption } from "../../utils/copyrightUtils";
import {
  DynamicMapOptions,
  DynamicMapResponse,
  CachedMapState,
  LayerDefinition,
  GeoJSONFeatureCollection,
  RoutePlan,
} from "./dynamicMapTypes";
import { getRoute, getMultiWaypointRoute } from "../routing/routingService";
import { RouteOptions } from "../routing/types";
import { IncorrectError, FaultError } from "../../types/types";
import { resolveIconKey, extractSvgPaths, POI_ICON_SVGS, SvgPathData } from "./poiIconData";
import {
  calculateEnhancedBounds,
  generateCirclePoints,
  extractCoordinates,
  computePolygonCentroid,
} from "./geometryUtils";

// Conditionally import skia-canvas (lazy, no top-level await)
let SkiaCanvas: any;
let skiaLoadImage: any;
let SkiaPath2D: any;
let skiaAvailable = false;
let skiaLoadAttempted = false;

async function ensureSkiaLoaded(): Promise<boolean> {
  if (skiaLoadAttempted) return skiaAvailable;
  skiaLoadAttempted = true;

  try {
    const packageName = "skia-canvas";
    const skia = await import(packageName);
    SkiaCanvas = skia.Canvas;
    skiaLoadImage = skia.loadImage;
    SkiaPath2D = skia.Path2D;
    skiaAvailable = true;
    logger.info("✅ skia-canvas loaded successfully");
  } catch (error: any) {
    logger.warn(
      {
        error: error.message,
        code: error.code,
        nodeVersion: process.version,
        abi: process.versions.modules,
      },
      "⚠️ skia-canvas not available: dynamic maps will not function"
    );
  }
  return skiaAvailable;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TILE_SIZE = 256;

const DEFAULT_OPTIONS = {
  width: 600,
  height: 400,
  showLabels: false,
  routeInfoDetail: "basic" as const,
};

// ─── Route Color Palette ─────────────────────────────────────────────────────
// 6 visually distinct colors for distinguishing multiple route plans on the map.
const ROUTE_COLORS = ["#4285F4", "#EA4335", "#34A853", "#FBBC04", "#8E24AA", "#00ACC1"];

// ─── Category Color Palette ──────────────────────────────────────────────────
// 12 visually distinct colors for automatic category-based coloring.
// When markers have a `category` but no explicit `color`, all markers in
// the same category get the same color automatically.
const CATEGORY_COLORS = [
  "#E53935", // red
  "#1E88E5", // blue
  "#43A047", // green
  "#FB8C00", // orange
  "#8E24AA", // purple
  "#00ACC1", // cyan
  "#F4511E", // deep orange
  "#3949AB", // indigo
  "#C0CA33", // lime
  "#D81B60", // pink
  "#6D4C41", // brown
  "#00897B", // teal
];

function getCategoryColor(category: string, categoryMap: Map<string, string>): string {
  const key = category.toLowerCase();
  if (categoryMap.has(key)) return categoryMap.get(key)!;
  const color = CATEGORY_COLORS[categoryMap.size % CATEGORY_COLORS.length];
  categoryMap.set(key, color);
  return color;
}

// ─── Web Mercator Projection ─────────────────────────────────────────────────

function lonToGlobalPixelX(lon: number, zoom: number): number {
  const mapSize = TILE_SIZE * Math.pow(2, zoom);
  return ((lon + 180) / 360) * mapSize;
}

function latToGlobalPixelY(lat: number, zoom: number): number {
  const mapSize = TILE_SIZE * Math.pow(2, zoom);
  const latRad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * mapSize;
}

/**
 * Convert lat/lon to canvas pixel coordinates given the viewport
 */
function latLonToPixel(
  lat: number,
  lon: number,
  zoom: number,
  topLeftGlobalX: number,
  topLeftGlobalY: number
): { x: number; y: number } {
  return {
    x: lonToGlobalPixelX(lon, zoom) - topLeftGlobalX,
    y: latToGlobalPixelY(lat, zoom) - topLeftGlobalY,
  };
}

/**
 * Calculate the visible geographic bounds from center + zoom + dimensions
 */
function getVisibleBounds(
  centerLat: number,
  centerLon: number,
  zoom: number,
  width: number,
  height: number
): {
  north: number;
  south: number;
  east: number;
  west: number;
  topLeftGlobalX: number;
  topLeftGlobalY: number;
} {
  const centerGlobalX = lonToGlobalPixelX(centerLon, zoom);
  const centerGlobalY = latToGlobalPixelY(centerLat, zoom);

  const topLeftGlobalX = centerGlobalX - width / 2;
  const topLeftGlobalY = centerGlobalY - height / 2;
  const bottomRightGlobalX = centerGlobalX + width / 2;
  const bottomRightGlobalY = centerGlobalY + height / 2;

  const mapSize = TILE_SIZE * Math.pow(2, zoom);

  const west = (topLeftGlobalX / mapSize) * 360 - 180;
  const east = (bottomRightGlobalX / mapSize) * 360 - 180;
  const north =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * topLeftGlobalY) / mapSize))) * 180) / Math.PI;
  const south =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * bottomRightGlobalY) / mapSize))) * 180) / Math.PI;

  return { north, south, east, west, topLeftGlobalX, topLeftGlobalY };
}

// ─── Tile Fetching & Stitching ───────────────────────────────────────────────

interface TileInfo {
  x: number;
  y: number;
  z: number;
  canvasX: number;
  canvasY: number;
}

/**
 * Calculate which tiles are needed for the viewport
 */
function calculateRequiredTiles(
  zoom: number,
  topLeftGlobalX: number,
  topLeftGlobalY: number,
  width: number,
  height: number
): TileInfo[] {
  const maxTile = Math.pow(2, zoom) - 1;
  const startTileX = Math.max(0, Math.floor(topLeftGlobalX / TILE_SIZE));
  const startTileY = Math.max(0, Math.floor(topLeftGlobalY / TILE_SIZE));
  const endTileX = Math.min(maxTile, Math.floor((topLeftGlobalX + width) / TILE_SIZE));
  const endTileY = Math.min(maxTile, Math.floor((topLeftGlobalY + height) / TILE_SIZE));

  const tiles: TileInfo[] = [];
  for (let ty = startTileY; ty <= endTileY; ty++) {
    for (let tx = startTileX; tx <= endTileX; tx++) {
      tiles.push({
        x: tx,
        y: ty,
        z: zoom,
        canvasX: tx * TILE_SIZE - topLeftGlobalX,
        canvasY: ty * TILE_SIZE - topLeftGlobalY,
      });
    }
  }
  return tiles;
}

/**
 * Fetch a single raster tile from TomTom Maps.
 * Supports both Genesis and Orbis tile APIs.
 */
async function fetchTile(
  z: number,
  x: number,
  y: number,
  useOrbis: boolean,
  style?: string
): Promise<Buffer | null> {
  try {
    let url: string;
    let params: Record<string, any>;

    if (useOrbis) {
      // Orbis raster tile API
      url = `maps/orbis/map-display/tile/${z}/${x}/${y}.png`;
      params = { apiVersion: 1, style: style || "street-light", tileSize: TILE_SIZE };
    } else {
      // Genesis raster tile API
      url = `map/1/tile/basic/${style || "main"}/${z}/${x}/${y}.png`;
      params = { tileSize: TILE_SIZE };
    }

    const response = await tomtomClient.get(url, {
      params,
      responseType: "arraybuffer",
      timeout: 10000,
    });
    return Buffer.from(response.data);
  } catch (error: any) {
    logger.warn({ z, x, y, error: error.message }, "Failed to fetch tile, using blank");
    return null;
  }
}

/**
 * Fetch all tiles and stitch them onto a canvas
 */
async function fetchAndStitchTiles(
  ctx: any,
  tiles: TileInfo[],
  useOrbis: boolean,
  style: string
): Promise<void> {
  // Fetch all tiles in parallel (batched to avoid overwhelming the API)
  const BATCH_SIZE = 8;
  for (let i = 0; i < tiles.length; i += BATCH_SIZE) {
    const batch = tiles.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (tile) => {
        const buffer = await fetchTile(tile.z, tile.x, tile.y, useOrbis, style);
        return { tile, buffer };
      })
    );

    for (const { tile, buffer } of results) {
      if (buffer) {
        try {
          const img = await skiaLoadImage(buffer);
          ctx.drawImage(img, tile.canvasX, tile.canvasY, TILE_SIZE, TILE_SIZE);
        } catch (err: any) {
          logger.warn({ x: tile.x, y: tile.y, error: err.message }, "Failed to draw tile");
        }
      }
    }
  }
}

// ─── Overlay Drawing ─────────────────────────────────────────────────────────

/**
 * Draw polygons onto the canvas
 */
function drawPolygons(
  ctx: any,
  polygonFeatures: any[],
  zoom: number,
  topLeftGlobalX: number,
  topLeftGlobalY: number
): void {
  for (const feature of polygonFeatures) {
    const coords = feature.geometry.coordinates[0]; // exterior ring
    const props = feature.properties;

    if (!coords || coords.length < 3) continue;

    // Draw fill
    ctx.beginPath();
    for (let i = 0; i < coords.length; i++) {
      const [lon, lat] = coords[i];
      const { x, y } = latLonToPixel(lat, lon, zoom, topLeftGlobalX, topLeftGlobalY);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();

    ctx.fillStyle = props.fillColor || "rgba(0, 123, 255, 0.3)";
    ctx.globalAlpha = 0.6;
    ctx.fill();
    ctx.globalAlpha = 1.0;

    // Draw stroke
    ctx.strokeStyle = props.strokeColor || "#007bff";
    ctx.lineWidth = props.strokeWidth || 2;
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1.0;
  }
}

/**
 * Draw routes onto the canvas
 */
function drawRoutes(
  ctx: any,
  routeFeatures: any[],
  zoom: number,
  topLeftGlobalX: number,
  topLeftGlobalY: number
): void {
  for (const feature of routeFeatures) {
    const coords = feature.geometry.coordinates;
    const props = feature.properties;

    if (!coords || coords.length < 2) continue;

    const points = coords.map(([lon, lat]: [number, number]) =>
      latLonToPixel(lat, lon, zoom, topLeftGlobalX, topLeftGlobalY)
    );

    // Draw outline (white, thick)
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 8;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    ctx.globalAlpha = 1.0;

    // Draw main route (colored)
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.strokeStyle = props.trafficColor || "#007cbf";
    ctx.lineWidth = 6;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }
}

// Map pin SVG path (24x29 viewBox) — compact teardrop pin from search-poi-default-big.svg
const MAP_PIN_PATH =
  "M12 0.299805C18.6274 0.299805 24 5.67239 24 12.2998C24 16.3318 22.011 19.8976 18.9609 22.0724C16.6127 23.7469 14.1021 25.4307 12.79 27.999C12.4489 28.6666 11.5511 28.6666 11.21 27.999C9.89722 25.4306 7.38622 23.7468 5.03788 22.0718C1.98845 19.8968 0 16.3313 0 12.2998C0 5.67239 5.37258 0.299805 12 0.299805Z";
const MAP_PIN_WIDTH = 24;
const MAP_PIN_HEIGHT = 29;

/**
 * Draw a map pin marker at (x, y) on the canvas context.
 * Compact teardrop pin shape — tip at (x, y), body extends upward.
 */
function drawPinMarker(ctx: any, x: number, y: number): void {
  const markerHeight = 40;
  const scale = markerHeight / MAP_PIN_HEIGHT;

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  // Position so pin tip is at (x, y): translate to top-left, then scale
  ctx.translate(x - (MAP_PIN_WIDTH / 2) * scale, y - 28 * scale);
  ctx.scale(scale, scale);

  const path = new SkiaPath2D(MAP_PIN_PATH);
  ctx.fillStyle = "#1988CF";
  ctx.fill(path);

  // Dark border for depth
  ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
  ctx.lineWidth = 1;
  ctx.stroke(path);
  ctx.restore();
}

// ── POI Icon Cache ───────────────────────────────────────────────────────────

const iconPathCache = new Map<string, SvgPathData[]>();

function getIconPaths(iconKey: string): SvgPathData[] | null {
  if (iconPathCache.has(iconKey)) return iconPathCache.get(iconKey)!;
  const svg = POI_ICON_SVGS[iconKey];
  if (!svg) return null;
  const paths = extractSvgPaths(svg);
  iconPathCache.set(iconKey, paths);
  return paths;
}

/**
 * Draw a colored dot marker at (x, y) for POI categories.
 */
function drawDotMarker(ctx: any, x: number, y: number, color: string): void {
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.25)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

/**
 * Draw a POI icon marker: colored teardrop pin bubble with white SVG icon inside.
 * Pin tip is anchored at (x, y). The icon sits in the circular head of the pin.
 */
function drawIconMarker(ctx: any, x: number, y: number, color: string, paths: SvgPathData[]): void {
  // Reuse the same teardrop shape as the plain pin (24x29 viewBox), scaled up
  const markerHeight = 56;
  const pinScale = markerHeight / MAP_PIN_HEIGHT;
  const iconSize = 18; // icon drawn inside the circular head

  ctx.save();

  // Shadow
  ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
  ctx.shadowBlur = 6;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  // Position so pin tip is at (x, y)
  ctx.translate(x - (MAP_PIN_WIDTH / 2) * pinScale, y - 28 * pinScale);
  ctx.scale(pinScale, pinScale);

  // Colored teardrop background
  const pinPath = new SkiaPath2D(MAP_PIN_PATH);
  ctx.fillStyle = color;
  ctx.fill(pinPath);

  // Subtle dark border for depth
  ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
  ctx.lineWidth = 0.8;
  ctx.stroke(pinPath);

  // Reset shadow for icon rendering
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // White icon centered in the circular head (circle center ≈ 12, 12 in viewBox)
  const iconScale = iconSize / 24 / pinScale; // compensate for pinScale already applied
  const circleCenterX = MAP_PIN_WIDTH / 2; // 12
  const circleCenterY = 12; // circular head center in the 24x29 viewBox
  ctx.translate(circleCenterX - iconSize / pinScale / 2, circleCenterY - iconSize / pinScale / 2);
  ctx.scale(iconScale, iconScale);

  for (const p of paths) {
    const path = new SkiaPath2D(p.d);
    ctx.fillStyle = "#ffffff";
    ctx.fill(path, p.fillRule);
  }

  ctx.restore();
}

/**
 * Draw all markers: pins for locations, dots for POI categories, icons for matched categories.
 */
function drawMarkers(
  ctx: any,
  markerFeatures: any[],
  zoom: number,
  topLeftGlobalX: number,
  topLeftGlobalY: number
): void {
  for (const feature of markerFeatures) {
    const [lon, lat] = feature.geometry.coordinates;
    const { x, y } = latLonToPixel(lat, lon, zoom, topLeftGlobalX, topLeftGlobalY);
    const color = feature.properties.color || "#ff4444";
    const markerType = feature.properties.markerType;
    const iconKey = feature.properties.iconKey;

    if (markerType === "icon" && iconKey) {
      const paths = getIconPaths(iconKey);
      if (paths && paths.length > 0) {
        drawIconMarker(ctx, x, y, color, paths);
      } else {
        drawDotMarker(ctx, x, y, color);
      }
    } else if (markerType === "dot") {
      drawDotMarker(ctx, x, y, color);
    } else {
      drawPinMarker(ctx, x, y);
    }
  }
}

/**
 * Draw labels for markers
 */
function drawMarkerLabels(
  ctx: any,
  markerFeatures: any[],
  zoom: number,
  topLeftGlobalX: number,
  topLeftGlobalY: number
): void {
  for (const feature of markerFeatures) {
    const [lon, lat] = feature.geometry.coordinates;
    const { x, y } = latLonToPixel(lat, lon, zoom, topLeftGlobalX, topLeftGlobalY);
    const label = feature.properties.label || "";
    const priority = feature.properties.priority || "normal";

    if (!label) continue;

    const fontSize =
      priority === "critical" ? 15 : priority === "high" ? 14 : priority === "low" ? 12 : 13;
    const haloWidth = priority === "critical" ? 5 : priority === "high" ? 4.5 : 4;
    const textColor =
      priority === "critical" ? "#000000" : priority === "high" ? "#1a202c" : "#1a365d";

    ctx.font = `bold ${fontSize}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    const labelY = y + 22; // Below marker

    // Halo (stroke)
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = haloWidth;
    ctx.lineJoin = "round";
    ctx.strokeText(label, x, labelY);

    // Text
    ctx.fillStyle = textColor;
    ctx.fillText(label, x, labelY);
  }
}

/**
 * Draw a rounded rectangle path on the canvas context.
 */
function drawRoundedRect(
  ctx: any,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/**
 * Draw polygon labels as colored badge/chip elements on the canvas.
 * Each badge: a single white rounded pill containing a colored dot + label text.
 */
function drawPolygonLabels(
  ctx: any,
  polygonCenterFeatures: any[],
  zoom: number,
  topLeftGlobalX: number,
  topLeftGlobalY: number
): void {
  const fontSize = 12;
  const dotRadius = 5;
  const paddingH = 14;
  const paddingV = 8;
  const dotTextGap = 6;
  const cornerRadius = 999; // fully rounded pill ends

  ctx.font = `bold ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  for (const feature of polygonCenterFeatures) {
    const [lon, lat] = feature.geometry.coordinates;
    const { x: centerX, y: centerY } = latLonToPixel(
      lat,
      lon,
      zoom,
      topLeftGlobalX,
      topLeftGlobalY
    );
    const label = feature.properties.label || "";
    const dotColor = feature.properties.strokeColor || "#007bff";

    if (!label) continue;

    const textMetrics = ctx.measureText(label);
    const textWidth = textMetrics.width;

    // Pill encompasses dot + gap + text
    const innerWidth = dotRadius * 2 + dotTextGap + textWidth;
    const pillWidth = innerWidth + paddingH * 2;
    const pillHeight = fontSize + paddingV * 2;

    // Center pill at polygon centroid
    const pillLeft = centerX - pillWidth / 2;
    const pillTop = centerY - pillHeight / 2;

    // Draw white pill background with drop shadow
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.15)";
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;

    drawRoundedRect(ctx, pillLeft, pillTop, pillWidth, pillHeight, cornerRadius);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.restore();

    // Draw colored dot inside pill (left side)
    const dotCenterX = pillLeft + paddingH + dotRadius;
    ctx.beginPath();
    ctx.arc(dotCenterX, centerY, dotRadius, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    // Draw label text inside pill (right of dot)
    const textLeft = dotCenterX + dotRadius + dotTextGap;
    ctx.fillStyle = "#333333";
    ctx.fillText(label, textLeft, centerY);
  }
}

/**
 * Draw copyright overlay
 */
function drawCopyright(ctx: any, copyrightText: string, width: number, height: number): void {
  const displayText = copyrightText || "© TomTom";
  ctx.font = "bold 14px Arial";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";

  const textMetrics = ctx.measureText(displayText);
  const textWidth = Math.ceil(textMetrics.width);
  const textHeight = 16;
  const padding = 6;

  const bgWidth = textWidth + padding * 2;
  const bgHeight = textHeight + padding * 2;
  const bgX = width - bgWidth - 100;
  const bgY = height - bgHeight - 8;

  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.fillRect(bgX, bgY, bgWidth, bgHeight);

  ctx.fillStyle = "#000";
  ctx.fillText(displayText, width - padding - 100, height - padding - 8);
}

// ─── Helper Functions ────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  if (!seconds || seconds < 60) {
    return `${Math.round(seconds || 0)}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const remainingMinutes = Math.floor((seconds % 3600) / 60);
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
}

function formatDistance(meters: number): string {
  if (!meters || meters < 1000) {
    return `${Math.round(meters || 0)}m`;
  } else if (meters < 100000) {
    return `${(meters / 1000).toFixed(1)}km`;
  } else {
    return `${Math.round(meters / 1000)}km`;
  }
}

function getTrafficColor(travelTime: number, trafficDelay: number): string {
  if (!trafficDelay || trafficDelay <= 0) return "#22c55e";
  const delayPercentage = (trafficDelay / travelTime) * 100;
  if (delayPercentage < 10) return "#84cc16";
  if (delayPercentage < 25) return "#eab308";
  if (delayPercentage < 50) return "#f97316";
  return "#ef4444";
}

// ─── GeoJSON Feature Construction ────────────────────────────────────────────

function buildPolygonFeatures(polygons: any[]): any[] {
  return polygons
    .map((polygon: any, index: number) => {
      // Handle circle geometry
      if (polygon.type === "circle" || (polygon.center && polygon.radius)) {
        if (
          !polygon.center ||
          typeof polygon.center.lat !== "number" ||
          typeof polygon.center.lon !== "number"
        ) {
          logger.warn({ index }, "⚠️ Circle has invalid center coordinates");
          return null;
        }
        if (!polygon.radius || polygon.radius <= 0) {
          logger.warn({ index }, "⚠️ Circle has invalid radius");
          return null;
        }

        const circlePoints = generateCirclePoints(
          polygon.center.lat,
          polygon.center.lon,
          polygon.radius,
          64
        );
        const polygonCoordinates = circlePoints.map((point) => [point.lon, point.lat]);
        polygonCoordinates.push(polygonCoordinates[0]);

        return {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [polygonCoordinates] },
          properties: {
            id: index,
            label: polygon.label || polygon.name || `Circle ${index + 1}`,
            fillColor: polygon.fillColor || "rgba(255, 193, 7, 0.3)",
            strokeColor: polygon.strokeColor || "#ffc107",
            strokeWidth: polygon.strokeWidth || 2,
            name: polygon.name || `Circle ${index + 1}`,
          },
        };
      }

      // Handle polygon coordinates
      if (polygon.coordinates && Array.isArray(polygon.coordinates)) {
        if (polygon.coordinates.length < 3) {
          logger.warn({ index }, "⚠️ Polygon has invalid coordinates");
          return null;
        }

        const coords = [...polygon.coordinates];
        const firstPoint = coords[0];
        const lastPoint = coords[coords.length - 1];
        if (firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1]) {
          coords.push([firstPoint[0], firstPoint[1]]);
        }

        return {
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [coords] },
          properties: {
            id: index,
            label: polygon.label || polygon.name || `Area ${index + 1}`,
            fillColor: polygon.fillColor || "rgba(0, 123, 255, 0.3)",
            strokeColor: polygon.strokeColor || "#007bff",
            strokeWidth: polygon.strokeWidth || 2,
            name: polygon.name || `Polygon ${index + 1}`,
          },
        };
      }

      logger.warn({ index }, "⚠️ Polygon has neither valid coordinates nor circle definition");
      return null;
    })
    .filter(Boolean);
}

/**
 * Build Point features at the centroid of each polygon for badge label rendering.
 * Carries label text and stroke color for the colored dot.
 */
function buildPolygonCenterFeatures(polygonFeatures: any[], polygons: any[]): any[] {
  return polygonFeatures.map((feature: any) => {
    const coords = feature.geometry.coordinates[0]; // exterior ring

    let centroid: { lon: number; lat: number };

    // For circles, use the original center directly (more precise)
    const originalPolygon = polygons[feature.properties.id];
    if (originalPolygon && (originalPolygon.type === "circle" || originalPolygon.center)) {
      centroid = {
        lon: originalPolygon.center.lon,
        lat: originalPolygon.center.lat,
      };
    } else {
      centroid = computePolygonCentroid(coords);
    }

    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [centroid.lon, centroid.lat] },
      properties: {
        id: feature.properties.id,
        label: feature.properties.label || feature.properties.name,
        strokeColor: feature.properties.strokeColor || "#007bff",
        fillColor: feature.properties.fillColor || "rgba(0, 123, 255, 0.3)",
      },
    };
  });
}

function buildMarkerFeatures(markers: any[]): any[] {
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
  const sorted = [...markers].sort(
    (a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2)
  );

  // Auto-assign colors by category when no explicit color is provided
  const categoryColorMap = new Map<string, string>();

  return sorted
    .map((marker: any, index: number) => {
      const coords = extractCoordinates(marker, index, "marker");
      if (!coords) return null;

      // Color priority: explicit color > category-based color > default
      let color = marker.color;
      if (!color && marker.category) {
        color = getCategoryColor(marker.category, categoryColorMap);
      }
      color = color || "#ff4444";

      // Resolve POI icon: category → icon key (or null for fallback to dot)
      const iconKey = marker.category ? resolveIconKey(marker.category) : null;
      const markerType = marker.category ? (iconKey ? "icon" : "dot") : "pin";

      return {
        type: "Feature",
        geometry: { type: "Point", coordinates: [coords.lon, coords.lat] },
        properties: {
          id: index,
          label: marker.label || `Marker ${index + 1}`,
          color,
          markerType,
          priority: marker.priority || "normal",
          ...(iconKey && { iconKey }),
          ...(iconKey && { iconImageId: `icon-${iconKey}-${color.replace("#", "")}` }),
          ...(marker.category && { category: marker.category }),
          ...(marker.description && { description: marker.description }),
          ...(marker.address && { address: marker.address }),
          ...(marker.tags?.length && { tags: JSON.stringify(marker.tags) }),
        },
      };
    })
    .filter(Boolean);
}

function buildRouteFeatures(
  routes: Array<Array<{ lat: number; lon: number }>>,
  routeData: any[]
): any[] {
  return routes
    .map((route, routeIndex) => {
      const validCoords = route
        .map((point, pointIndex) =>
          extractCoordinates(point, `${routeIndex}-${pointIndex}`, "route point")
        )
        .filter((coord) => coord !== null)
        .map((coord) => [coord!.lon, coord!.lat]);

      if (validCoords.length < 2) return null;

      const currentRouteData = (routeData && routeData[routeIndex]) || {
        distance: "",
        travelTime: "",
        trafficDelay: "",
        trafficColor: "#007cbf",
        hasTrafficData: false,
        lengthInMeters: 0,
        travelTimeInSeconds: 0,
        trafficDelayInSeconds: 0,
        name: `Route ${routeIndex + 1}`,
      };

      let routeSummary = currentRouteData.name || `Route ${routeIndex + 1}`;
      if (currentRouteData.distance && currentRouteData.travelTime) {
        routeSummary += ` (${currentRouteData.distance}, ${currentRouteData.travelTime})`;
        if (currentRouteData.trafficDelayInSeconds > 0) {
          routeSummary += ` +${currentRouteData.trafficDelay} delay`;
        }
      }

      return {
        type: "Feature",
        geometry: { type: "LineString", coordinates: validCoords },
        properties: {
          id: routeIndex,
          label: routeSummary,
          routeName: currentRouteData.name || `Route ${routeIndex + 1}`,
          distance: currentRouteData.distance,
          travelTime: currentRouteData.travelTime,
          trafficDelay: currentRouteData.trafficDelay,
          trafficColor: currentRouteData.trafficColor,
          hasTrafficData: currentRouteData.hasTrafficData,
          lengthInMeters: currentRouteData.lengthInMeters,
          travelTimeInSeconds: currentRouteData.travelTimeInSeconds,
          trafficDelayInSeconds: currentRouteData.trafficDelayInSeconds,
        },
      };
    })
    .filter(Boolean);
}

function buildRouteLabelFeatures(routeFeatures: any[]): any[] {
  const labelFeatures: any[] = [];
  for (const routeFeature of routeFeatures) {
    const coords = routeFeature.geometry.coordinates;
    if (!coords || coords.length < 2) continue;

    const startPoint = coords[0];
    labelFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [startPoint[0], startPoint[1] + 0.0005] },
      properties: {
        label: `Start: ${routeFeature.properties.routeName}`,
        summary: `${routeFeature.properties.distance}, ${routeFeature.properties.travelTime}`,
        routeId: routeFeature.properties.id,
        type: "start",
      },
    });

    const endPoint = coords[coords.length - 1];
    labelFeatures.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [endPoint[0], endPoint[1] - 0.0005] },
      properties: {
        label: `End: ${routeFeature.properties.label}`,
        summary: routeFeature.properties.hasTrafficData
          ? `${routeFeature.properties.distance}, ${routeFeature.properties.travelTime} (+${routeFeature.properties.trafficDelay})`
          : `${routeFeature.properties.distance}, ${routeFeature.properties.travelTime}`,
        routeId: routeFeature.properties.id,
        type: "end",
      },
    });
  }
  return labelFeatures;
}

// ─── MapState Layer Definitions ──────────────────────────────────────────────

function buildMapStateLayers(
  hasPolygons: boolean,
  hasPolygonCenters: boolean,
  hasRoutes: boolean,
  hasRouteLabels: boolean,
  hasMarkers: boolean,
  showLabels: boolean
): LayerDefinition[] {
  const layers: LayerDefinition[] = [];

  // Polygon layers
  if (hasPolygons) {
    layers.push({
      id: "polygon-fill",
      type: "fill",
      source: "polygons",
      paint: { "fill-color": ["get", "fillColor"], "fill-opacity": 0.6 },
    });
    layers.push({
      id: "polygon-stroke",
      type: "line",
      source: "polygons",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ["get", "strokeColor"],
        "line-width": ["get", "strokeWidth"],
        "line-opacity": 0.8,
      },
    });
  }

  // Polygon center badge — unified pill with colored dot + text inside
  if (hasPolygonCenters && showLabels) {
    layers.push({
      id: "polygon-labels",
      type: "symbol",
      source: "polygonCenters",
      layout: {
        "text-field": [
          "format",
          "●",
          { "text-color": ["get", "strokeColor"], "font-scale": 0.9 },
          "  ",
          {},
          ["get", "label"],
          { "text-color": "#333333" },
        ],
        "text-font": ["Noto-Bold"],
        "text-size": 13,
        "text-anchor": "center",
        "icon-image": "label-pill",
        "icon-text-fit": "both",
        "icon-text-fit-padding": [8, 14, 8, 14],
        "icon-allow-overlap": true,
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": "#333333",
        "icon-opacity": 1,
      },
    });
  }

  // Route layers
  if (hasRoutes) {
    layers.push({
      id: "route-outline",
      type: "line",
      source: "routes",
      paint: { "line-width": 8, "line-color": "#ffffff", "line-opacity": 0.8 },
    });
    layers.push({
      id: "route-layer",
      type: "line",
      source: "routes",
      paint: { "line-width": 6, "line-color": ["get", "trafficColor"], "line-opacity": 1 },
    });
    if (showLabels && hasRouteLabels) {
      layers.push({
        id: "route-labels",
        type: "symbol",
        source: "route-labels",
        layout: {
          "text-field": ["get", "summary"],
          "text-font": ["Noto-Bold"],
          "symbol-placement": "point",
          "text-anchor": "center",
          "text-size": 11,
          "text-max-width": 18,
          "text-allow-overlap": false,
          "text-padding": 15,
          "text-line-height": 1.0,
          "text-justify": "center",
        },
        paint: {
          "text-color": "#1976d2",
          "text-halo-color": "#ffffff",
          "text-halo-width": 3,
          "text-halo-blur": 1,
        },
      });
    }
  }

  // Marker layers — icons for matched categories, dots for unmatched, pins for locations
  if (hasMarkers) {
    const dotFilter = ["==", ["get", "markerType"], "dot"];
    const pinFilter = ["==", ["get", "markerType"], "pin"];
    const iconFilter = ["==", ["get", "markerType"], "icon"];

    // Dot markers (POI categories) — colored circles
    layers.push({
      id: "marker-dot-shadow",
      type: "circle",
      source: "markers",
      filter: dotFilter,
      paint: {
        "circle-radius": 12,
        "circle-color": "rgba(0, 0, 0, 0.2)",
        "circle-blur": 0.8,
        "circle-translate": [1, 1],
      },
    });
    layers.push({
      id: "marker-dot",
      type: "circle",
      source: "markers",
      filter: dotFilter,
      paint: {
        "circle-radius": 10,
        "circle-color": ["get", "color"],
        "circle-stroke-width": 2.5,
        "circle-stroke-color": "#ffffff",
      },
    });

    // Icon markers (matched POI categories) — colored teardrop pin with white icon
    layers.push({
      id: "marker-icon",
      type: "symbol",
      source: "markers",
      filter: iconFilter,
      layout: {
        "icon-image": ["get", "iconImageId"],
        "icon-size": 1,
        "icon-allow-overlap": true,
        "icon-anchor": "bottom",
      },
    });

    // Pin markers (locations) — TomTom logo pin
    layers.push({
      id: "marker-pin",
      type: "symbol",
      source: "markers",
      filter: pinFilter,
      layout: {
        "icon-image": "pin-marker",
        "icon-size": 1,
        "icon-allow-overlap": true,
        "icon-anchor": "bottom",
      },
    });

    // Label layers
    if (showLabels) {
      const priorities = ["critical", "high", "normal", "low"];
      for (const priority of priorities) {
        layers.push({
          id: `marker-labels-${priority}`,
          type: "symbol",
          source: "markers",
          filter: ["==", ["get", "priority"], priority],
          layout: {
            "text-field": ["get", "label"],
            "text-font": ["Noto-Bold"],
            "text-offset": [0, 3.0],
            "text-anchor": "top",
            "text-size":
              priority === "critical"
                ? 15
                : priority === "high"
                  ? 14
                  : priority === "low"
                    ? 12
                    : 13,
            "text-max-width": 12,
            "text-allow-overlap": priority === "critical",
            "text-padding": priority === "critical" ? 2 : priority === "high" ? 3 : 5,
            "text-line-height": 1.1,
          },
          paint: {
            "text-color":
              priority === "critical" ? "#000000" : priority === "high" ? "#1a202c" : "#1a365d",
            "text-halo-color": "#ffffff",
            "text-halo-width": priority === "critical" ? 5 : priority === "high" ? 4.5 : 4,
            "text-halo-blur": 1,
          },
        });
      }
    }
  }

  return layers;
}

// ─── Image Compression ───────────────────────────────────────────────────────

/**
 * Compress a base64-encoded PNG image to fit within a target size using skia-canvas.
 */
export async function compressMapImage(
  base64Png: string,
  targetBytes: number = 400 * 1024
): Promise<{ base64: string; contentType: string }> {
  await ensureSkiaLoaded();
  if (!skiaAvailable) {
    throw new Error("skia-canvas not available for image compression");
  }

  const originalBuffer = Buffer.from(base64Png, "base64");
  if (originalBuffer.length <= targetBytes) {
    return { base64: base64Png, contentType: "image/png" };
  }

  logger.info(
    {
      original_kb: (originalBuffer.length / 1024).toFixed(2),
      target_kb: (targetBytes / 1024).toFixed(2),
    },
    "🗜️ Compressing map image"
  );

  const img = await skiaLoadImage(originalBuffer);
  const w = img.width;
  const h = img.height;

  // Try JPEG with decreasing quality at original resolution
  // Note: skia-canvas expects quality as 0.0–1.0 (not 0–100)
  for (const quality of [0.85, 0.7, 0.5, 0.3]) {
    const canvas = new SkiaCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const jpegBuffer = await canvas.toBuffer("jpg", { quality });

    if (jpegBuffer.length <= targetBytes) {
      logger.info(
        { compressed_kb: (jpegBuffer.length / 1024).toFixed(2), quality },
        "✅ Compressed with JPEG"
      );
      return { base64: jpegBuffer.toString("base64"), contentType: "image/jpeg" };
    }
  }

  // Scale down progressively
  let scale = 0.7;
  while (scale >= 0.2) {
    const sw = Math.floor(w * scale);
    const sh = Math.floor(h * scale);
    const canvas = new SkiaCanvas(sw, sh);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, sw, sh);
    const jpegBuffer = await canvas.toBuffer("jpg", { quality: 0.6 });

    if (jpegBuffer.length <= targetBytes) {
      logger.info(
        { compressed_kb: (jpegBuffer.length / 1024).toFixed(2), scale, width: sw, height: sh },
        "✅ Compressed with scaling"
      );
      return { base64: jpegBuffer.toString("base64"), contentType: "image/jpeg" };
    }
    scale -= 0.15;
  }

  // Last resort
  const minW = Math.floor(w * 0.2);
  const minH = Math.floor(h * 0.2);
  const canvas = new SkiaCanvas(minW, minH);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, minW, minH);
  const jpegBuffer = await canvas.toBuffer("jpg", { quality: 0.3 });

  logger.warn(
    { compressed_kb: (jpegBuffer.length / 1024).toFixed(2) },
    "⚠️ Compressed to minimum size"
  );
  return { base64: jpegBuffer.toString("base64"), contentType: "image/jpeg" };
}

// ─── Main Render Function ────────────────────────────────────────────────────

/**
 * Renders a dynamic map using raster tiles + skia-canvas overlays.
 * Supports both Genesis and Orbis backends via the use_orbis option.
 */
export async function renderDynamicMap(options: DynamicMapOptions): Promise<DynamicMapResponse> {
  validateApiKey();
  logger.info("🗺️ Processing dynamic map request (raster tiles + skia-canvas)");

  await ensureSkiaLoaded();
  if (!skiaAvailable) {
    throw new Error(
      `Dynamic map dependencies not available. Install skia-canvas to enable this feature. [node=${process.version}, abi=${process.versions.modules}, arch=${process.arch}, platform=${process.platform}]`
    );
  }

  try {
    const finalOptions = { ...DEFAULT_OPTIONS, ...options };
    // Cap dimensions to avoid oversized raster tile images that exceed the 1MB MCP response limit
    const MAX_WIDTH = 800;
    const MAX_HEIGHT = 600;
    const width = Math.min(finalOptions.width || DEFAULT_OPTIONS.width, MAX_WIDTH);
    const height = Math.min(finalOptions.height || DEFAULT_OPTIONS.height, MAX_HEIGHT);
    const showLabels = finalOptions.showLabels || false;

    // ── Prepare markers ──────────────────────────────────────────────────
    let markers: any[] = finalOptions.markers ? [...finalOptions.markers] : [];

    // Route planning mode — detected from routePlans array
    const routePlans: RoutePlan[] = finalOptions.routePlans || [];
    const isRoutePlanningMode = routePlans.length > 0;

    // Prepare polygons
    let polygons: any[] = finalOptions.polygons ? [...finalOptions.polygons] : [];

    // Validate content
    const hasMarkers = markers.length > 0;
    const hasPolygons = polygons.length > 0;
    const hasDirectRoutes = (finalOptions as any).routes && (finalOptions as any).routes.length > 0;
    const hasBbox =
      finalOptions.bbox && Array.isArray(finalOptions.bbox) && finalOptions.bbox.length === 4;

    if (!isRoutePlanningMode && !hasMarkers && !hasPolygons && !hasDirectRoutes && !hasBbox) {
      throw new IncorrectError("Map requires content to display", {});
    }

    // ── Calculate routes ─────────────────────────────────────────────────
    let routes: Array<Array<{ lat: number; lon: number }>> = [];
    const routeData: Array<{
      lengthInMeters: number;
      travelTimeInSeconds: number;
      trafficDelayInSeconds: number;
      distance: string;
      travelTime: string;
      trafficDelay: string;
      trafficColor: string;
      hasTrafficData: boolean;
      name: string;
    }> = [];

    // Handle direct routes (drawn lines, not road-following)
    if ((finalOptions as any).routes?.length && !isRoutePlanningMode) {
      routes = (finalOptions as any).routes
        .map((route: any, routeIndex: number) => {
          let routePoints = Array.isArray(route) ? route : route.points || [];
          if (routePoints.length < 2) return [];

          const validCoords = routePoints
            .map((point: any, pointIndex: number) =>
              extractCoordinates(point, `${routeIndex}-${pointIndex}`, "route point")
            )
            .filter((c: any) => c !== null)
            .map((c: any) => [c.lat, c.lon]);

          if (validCoords.length > 1) {
            routeData.push({
              lengthInMeters: 0,
              travelTimeInSeconds: 0,
              trafficDelayInSeconds: 0,
              distance: "",
              travelTime: "",
              trafficDelay: "",
              trafficColor: route.color || "#007cbf",
              hasTrafficData: false,
              name: route.name || `Route ${routeIndex + 1}`,
            });

            const start = validCoords[0];
            const end = validCoords[validCoords.length - 1];

            if (
              !markers.some(
                (m) => Math.abs(m.lat - start[0]) < 0.001 && Math.abs(m.lon - start[1]) < 0.001
              )
            ) {
              markers.push({
                lat: start[0],
                lon: start[1],
                label: route.name ? `${route.name} Start` : `Route ${routeIndex + 1} Start`,
                color: "#22c55e",
              });
            }
            if (
              !markers.some(
                (m) => Math.abs(m.lat - end[0]) < 0.001 && Math.abs(m.lon - end[1]) < 0.001
              )
            ) {
              markers.push({
                lat: end[0],
                lon: end[1],
                label: route.name ? `${route.name} End` : `Route ${routeIndex + 1} End`,
                color: "#ef4444",
              });
            }

            return validCoords.map((c: any) => ({ lat: c[0], lon: c[1] }));
          }
          return [];
        })
        .filter((r: any) => r.length > 0);
    }

    // Handle route plans (TomTom Routing API — multiple independent trips)
    if (isRoutePlanningMode) {
      for (let planIdx = 0; planIdx < routePlans.length; planIdx++) {
        const plan = routePlans[planIdx];
        const planColor = plan.color || ROUTE_COLORS[planIdx % ROUTE_COLORS.length];
        const planLabel = plan.label || `Route ${planIdx + 1}`;

        try {
          // Validate origin + destination
          const originCoords = extractCoordinates(plan.origin, planIdx, "origin");
          const destCoords = extractCoordinates(plan.destination, planIdx, "destination");

          if (!originCoords || !destCoords) {
            logger.warn(
              { planIdx },
              "⚠️ Invalid origin or destination coordinates in route plan, skipping"
            );
            continue;
          }

          // Add origin/waypoint/destination markers for this plan
          markers.push({
            lat: originCoords.lat,
            lon: originCoords.lon,
            label: plan.origin.label || `${planLabel} Start`,
            color: planColor,
          });

          if (plan.waypoints?.length) {
            plan.waypoints.forEach(
              (wp: { lat: number; lon: number; label?: string }, i: number) => {
                const wpCoords = extractCoordinates(wp, i, "waypoint");
                if (wpCoords) {
                  markers.push({
                    lat: wpCoords.lat,
                    lon: wpCoords.lon,
                    label: wp.label || `${planLabel} Waypoint ${i + 1}`,
                    color: "#f97316",
                  });
                }
              }
            );
          }

          markers.push({
            lat: destCoords.lat,
            lon: destCoords.lon,
            label: plan.destination.label || `${planLabel} End`,
            color: planColor,
          });

          // Build route options from plan-level overrides
          const routeOptions: RouteOptions = {
            routeType: plan.routeType || "fastest",
            travelMode: plan.travelMode || "car",
            avoid: plan.avoid,
            traffic: plan.traffic || false,
            instructionsType: "text",
            sectionType: [],
            computeTravelTimeFor: "all",
          };

          // Call routing API
          let routeResult;
          if (plan.waypoints?.length) {
            routeResult = await getMultiWaypointRoute(
              [plan.origin, ...plan.waypoints, plan.destination],
              routeOptions
            );
          } else {
            routeResult = await getRoute(plan.origin, plan.destination, routeOptions);
          }

          if (routeResult?.routes?.length) {
            for (const route of routeResult.routes) {
              const coordinates: Array<{ lat: number; lon: number }> = [];
              route.legs?.forEach((leg) => {
                leg.points?.forEach((point) => {
                  coordinates.push({ lat: point.latitude, lon: point.longitude });
                });
              });

              const lengthInMeters = route.summary?.lengthInMeters || 0;
              const travelTimeInSeconds = route.summary?.travelTimeInSeconds || 0;
              const trafficDelayInSeconds = route.summary?.trafficDelayInSeconds || 0;

              routeData.push({
                lengthInMeters,
                travelTimeInSeconds,
                trafficDelayInSeconds,
                distance: formatDistance(lengthInMeters),
                travelTime: formatTime(travelTimeInSeconds),
                trafficDelay: formatTime(trafficDelayInSeconds),
                trafficColor:
                  plan.color || getTrafficColor(travelTimeInSeconds, trafficDelayInSeconds),
                hasTrafficData: trafficDelayInSeconds > 0,
                name: planLabel,
              });

              routes.push(coordinates);
            }
          }
        } catch (routeError) {
          logger.warn(
            { planIdx, label: planLabel, error: String(routeError) },
            "Failed to calculate route plan, proceeding with remaining plans"
          );
        }
      }
    }

    // ── Calculate bounds/center/zoom ─────────────────────────────────────
    let center: [number, number];
    let zoom: number;
    let calculatedBounds: { north: number; south: number; east: number; west: number };

    if (finalOptions.bbox) {
      const [west, south, east, north] = finalOptions.bbox;
      calculatedBounds = { north, south, east, west };
      center = [(west + east) / 2, (south + north) / 2]; // [lon, lat]
      // Calculate zoom from bbox
      const result = calculateEnhancedBounds(markers, routes, width, height, polygons);
      zoom = finalOptions.zoom || result.zoom;
    } else if (finalOptions.center && finalOptions.zoom) {
      center = [finalOptions.center.lon, finalOptions.center.lat];
      zoom = finalOptions.zoom;
      const vb = getVisibleBounds(
        finalOptions.center.lat,
        finalOptions.center.lon,
        zoom,
        width,
        height
      );
      calculatedBounds = { north: vb.north, south: vb.south, east: vb.east, west: vb.west };
    } else {
      const result = calculateEnhancedBounds(markers, routes, width, height, polygons);
      calculatedBounds = result.bounds;
      center = result.center;
      zoom = result.zoom;
    }

    // Ensure zoom is an integer for tile fetching
    zoom = Math.round(zoom);
    zoom = Math.max(0, Math.min(22, zoom));

    // ── Calculate viewport geometry ──────────────────────────────────────
    const centerLat = center[1]; // center is [lon, lat]
    const centerLon = center[0];
    const viewBounds = getVisibleBounds(centerLat, centerLon, zoom, width, height);
    const { topLeftGlobalX, topLeftGlobalY } = viewBounds;

    // Update bounds to match actual viewport
    calculatedBounds = {
      north: viewBounds.north,
      south: viewBounds.south,
      east: viewBounds.east,
      west: viewBounds.west,
    };

    // ── Fetch and stitch tiles ───────────────────────────────────────────
    const tiles = calculateRequiredTiles(zoom, topLeftGlobalX, topLeftGlobalY, width, height);
    logger.info({ tile_count: tiles.length, zoom }, "Fetching Orbis raster tiles");

    const canvas = new SkiaCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Fill with a light gray background (fallback for missing tiles)
    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(0, 0, width, height);

    const useOrbis = !!finalOptions.use_orbis;
    const tileStyle = useOrbis ? "street-light" : "main";
    await fetchAndStitchTiles(ctx, tiles, useOrbis, tileStyle);

    // ── Build GeoJSON features ───────────────────────────────────────────
    const polygonFeatures = polygons.length > 0 ? buildPolygonFeatures(polygons) : [];
    const polygonCenterFeatures =
      polygonFeatures.length > 0 ? buildPolygonCenterFeatures(polygonFeatures, polygons) : [];
    const routeFeatures = routes.length > 0 ? buildRouteFeatures(routes, routeData) : [];
    const routeLabelFeatures =
      routeFeatures.length > 0 ? buildRouteLabelFeatures(routeFeatures) : [];

    // Filter out markers that sit at the center of a polygon (redundant)
    const filteredMarkers =
      polygons.length > 0
        ? markers.filter((m) => {
            const mc = extractCoordinates(m, 0, "marker");
            if (!mc) return false;
            return !polygons.some((p: any) => {
              const pc = p.center || computePolygonCentroid(p.coordinates || []);
              if (!pc) return false;
              const dlat = Math.abs(mc.lat - pc.lat);
              const dlon = Math.abs(mc.lon - pc.lon);
              return dlat < 0.001 && dlon < 0.001; // ~100m tolerance
            });
          })
        : markers;
    const markerFeatures = filteredMarkers.length > 0 ? buildMarkerFeatures(filteredMarkers) : [];

    // ── Draw overlays (order: polygons → routes → markers → polygon labels → marker labels) ─────
    if (polygonFeatures.length > 0) {
      drawPolygons(ctx, polygonFeatures, zoom, topLeftGlobalX, topLeftGlobalY);
    }
    if (routeFeatures.length > 0) {
      drawRoutes(ctx, routeFeatures, zoom, topLeftGlobalX, topLeftGlobalY);
    }
    if (markerFeatures.length > 0) {
      drawMarkers(ctx, markerFeatures, zoom, topLeftGlobalX, topLeftGlobalY);
    }
    if (showLabels && polygonCenterFeatures.length > 0) {
      drawPolygonLabels(ctx, polygonCenterFeatures, zoom, topLeftGlobalX, topLeftGlobalY);
    }
    if (showLabels && markerFeatures.length > 0) {
      drawMarkerLabels(ctx, markerFeatures, zoom, topLeftGlobalX, topLeftGlobalY);
    }

    // ── Copyright overlay ────────────────────────────────────────────────
    const copyrightText = await fetchCopyrightCaption(useOrbis);
    drawCopyright(ctx, copyrightText, width, height);

    // ── Export to PNG ────────────────────────────────────────────────────
    const pngBuffer = await canvas.toBuffer("png");

    // ── Build mapState (identical to original for interactive app) ───────
    const mapStateSources: CachedMapState["sources"] = {};

    if (polygonFeatures.length > 0) {
      mapStateSources.polygons = {
        type: "geojson",
        data: { type: "FeatureCollection", features: polygonFeatures } as GeoJSONFeatureCollection,
      };
    }
    if (routeFeatures.length > 0) {
      mapStateSources.routes = {
        type: "geojson",
        data: { type: "FeatureCollection", features: routeFeatures } as GeoJSONFeatureCollection,
      };
    }
    if (routeLabelFeatures.length > 0) {
      mapStateSources.routeLabels = {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: routeLabelFeatures,
        } as GeoJSONFeatureCollection,
      };
    }
    if (markerFeatures.length > 0) {
      mapStateSources.markers = {
        type: "geojson",
        data: { type: "FeatureCollection", features: markerFeatures } as GeoJSONFeatureCollection,
      };
    }
    if (polygonCenterFeatures.length > 0) {
      mapStateSources.polygonCenters = {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: polygonCenterFeatures,
        } as GeoJSONFeatureCollection,
      };
    }

    const styleUrl = useOrbis
      ? "maps/orbis/assets/styles/0.5.0-0/style.json"
      : "style/1/style/22.3.0-0";
    const styleParams: Record<string, string> = useOrbis
      ? { apiVersion: "1", map: "basic_street-light" }
      : { map: "basic_main" };

    const mapState: CachedMapState = {
      style: {
        endpoint: styleUrl,
        params: styleParams,
        useOrbis,
      },
      view: {
        center: center as [number, number],
        zoom,
        bounds: calculatedBounds,
      },
      sources: mapStateSources,
      layers: buildMapStateLayers(
        polygonFeatures.length > 0,
        polygonCenterFeatures.length > 0,
        routeFeatures.length > 0,
        routeLabelFeatures.length > 0,
        markerFeatures.length > 0,
        showLabels
      ),
      options: { width, height, showLabels },
    };

    // ── Return response ──────────────────────────────────────────────────
    const base64 = pngBuffer.toString("base64");
    const sizeKB = (pngBuffer.length / 1024).toFixed(2);
    logger.info({ size_kb: sizeKB, width, height }, "✅ Dynamic map rendered successfully");

    return {
      base64,
      contentType: "image/png",
      width,
      height,
      mapState,
    };
  } catch (error: any) {
    logger.error({ error: error.message }, "❌ Dynamic map generation failed");
    throw error;
  }
}

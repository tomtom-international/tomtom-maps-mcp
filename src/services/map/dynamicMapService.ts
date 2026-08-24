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

import type { Avoidable, TravelMode } from "@tomtom-org/maps-sdk/core";
import type { RouteType } from "@tomtom-org/maps-sdk/services";
import type { Position } from "geojson";
import { IncorrectError } from "../../types/types";
import { logger } from "../../utils/logger";
import { validateApiKey } from "../base/tomtomClient";
import { getRoute } from "../routing/routingService";
import type {
  CachedMapState,
  DynamicMapOptions,
  DynamicMapResponse,
  GeoJSONFeatureCollection,
  LayerDefinition,
  RoutePlan,
} from "./dynamicMapTypes";
import {
  calculateEnhancedBounds,
  computePolygonCentroid,
  extractCoordinates,
  generateCirclePoints,
} from "./geometryUtils";
import { resolveIconKey } from "./poiIconData";

/** Subset of routing options a single `routePlans[]` entry can override. */
type RoutePlanRouteOptions = {
  routeType: RouteType;
  travelMode: TravelMode;
  avoid?: Avoidable[];
  traffic?: "live";
};

// ─── Constants ───────────────────────────────────────────────────────────────

const TILE_SIZE = 256;
const DEFAULT_MAP_STYLE = "street-light";

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
  const mapSize = TILE_SIZE * 2 ** zoom;
  return ((lon + 180) / 360) * mapSize;
}

function latToGlobalPixelY(lat: number, zoom: number): number {
  const mapSize = TILE_SIZE * 2 ** zoom;
  const latRad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * mapSize;
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

  const mapSize = TILE_SIZE * 2 ** zoom;

  const west = (topLeftGlobalX / mapSize) * 360 - 180;
  const east = (bottomRightGlobalX / mapSize) * 360 - 180;
  const north =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * topLeftGlobalY) / mapSize))) * 180) / Math.PI;
  const south =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * bottomRightGlobalY) / mapSize))) * 180) / Math.PI;

  return { north, south, east, west, topLeftGlobalX, topLeftGlobalY };
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

// ─── Internal GeoJSON Feature Interfaces ─────────────────────────────────────

interface InternalPolygonFeature {
  type: "Feature";
  geometry: { type: "Polygon"; coordinates: Array<Array<[number, number]>> };
  properties: {
    id: number;
    label: string;
    fillColor: string;
    strokeColor: string;
    strokeWidth: number;
    name: string;
  };
}

interface InternalPointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: number;
    label: string;
    strokeColor: string;
    fillColor: string;
  };
}

interface InternalMarkerFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    id: number;
    label: string;
    color: string;
    markerType: string;
    priority: string;
    iconKey?: string;
    iconImageId?: string;
    category?: string;
    description?: string;
    address?: string;
    tags?: string;
  };
}

interface InternalRouteFeature {
  type: "Feature";
  geometry: { type: "LineString"; coordinates: Array<[number, number]> };
  properties: {
    id: number;
    label: string;
    routeName: string;
    distance: string;
    travelTime: string;
    trafficDelay: string;
    trafficColor: string;
    hasTrafficData: boolean;
    lengthInMeters: number;
    travelTimeInSeconds: number;
    trafficDelayInSeconds: number;
  };
}

interface InternalLabelFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: {
    label: string;
    summary: string;
    routeId: number;
    type: string;
  };
}

interface RouteSummary {
  name?: string;
  distance?: string;
  travelTime?: string;
  trafficDelay?: string;
  trafficColor?: string;
  hasTrafficData?: boolean;
  lengthInMeters?: number;
  travelTimeInSeconds?: number;
  trafficDelayInSeconds?: number;
}

// ─── GeoJSON Feature Construction ────────────────────────────────────────────

function buildPolygonFeatures(
  polygons: NonNullable<DynamicMapOptions["polygons"]>
): InternalPolygonFeature[] {
  return polygons
    .map((polygon, index: number) => {
      // Handle circle geometry
      if (polygon.type === "circle" || (polygon.center && polygon.radius)) {
        if (
          !polygon.center ||
          typeof polygon.center.lat !== "number" ||
          typeof polygon.center.lon !== "number"
        ) {
          logger.warn({ index }, "Circle has invalid center coordinates");
          return null;
        }
        if (!polygon.radius || polygon.radius <= 0) {
          logger.warn({ index }, "Circle has invalid radius");
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
          logger.warn({ index }, "Polygon has invalid coordinates");
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

      logger.warn({ index }, "Polygon has neither valid coordinates nor circle definition");
      return null;
    })
    .filter((f): f is InternalPolygonFeature => f !== null);
}

/**
 * Build Point features at the centroid of each polygon for badge label rendering.
 * Carries label text and stroke color for the colored dot.
 */
function buildPolygonCenterFeatures(
  polygonFeatures: InternalPolygonFeature[],
  polygons: NonNullable<DynamicMapOptions["polygons"]>
): InternalPointFeature[] {
  return polygonFeatures.map((feature) => {
    const coords = feature.geometry.coordinates[0]; // exterior ring

    let centroid: { lon: number; lat: number };

    // For circles, use the original center directly (more precise)
    const originalPolygon = polygons[feature.properties.id];
    if (originalPolygon && originalPolygon.center) {
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

function buildMarkerFeatures(
  markers: NonNullable<DynamicMapOptions["markers"]>
): InternalMarkerFeature[] {
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
  const sorted = [...markers].sort(
    (a, b) =>
      (priorityOrder[a.priority ?? "normal"] ?? 2) - (priorityOrder[b.priority ?? "normal"] ?? 2)
  );

  // Auto-assign colors by category when no explicit color is provided
  const categoryColorMap = new Map<string, string>();

  return sorted
    .map((marker, index: number) => {
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
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [coords.lon, coords.lat] as [number, number],
        },
        properties: {
          id: index,
          label: marker.label || `Marker ${index + 1}`,
          color,
          markerType,
          priority: (marker.priority || "normal") as string,
          ...(iconKey && { iconKey }),
          ...(iconKey && { iconImageId: `icon-${iconKey}-${color.replace("#", "")}` }),
          ...(marker.category && { category: marker.category }),
          ...(marker.description && { description: marker.description }),
          ...(marker.address && { address: marker.address }),
          ...(marker.tags?.length && { tags: JSON.stringify(marker.tags) }),
        },
      } satisfies InternalMarkerFeature;
    })
    .filter((f): f is InternalMarkerFeature => f !== null);
}

function buildRouteFeatures(
  routes: Array<Array<{ lat: number; lon: number }>>,
  routeData: RouteSummary[]
): InternalRouteFeature[] {
  return routes
    .map((route, routeIndex) => {
      const validCoords = route
        .map((point, pointIndex) =>
          extractCoordinates(point, `${routeIndex}-${pointIndex}`, "route point")
        )
        .filter((coord) => coord !== null)
        .map((coord) => [coord!.lon, coord!.lat] as [number, number]);

      if (validCoords.length < 2) return null;

      const currentRouteData: Required<RouteSummary> = {
        distance: "",
        travelTime: "",
        trafficDelay: "",
        trafficColor: "#007cbf",
        hasTrafficData: false,
        lengthInMeters: 0,
        travelTimeInSeconds: 0,
        trafficDelayInSeconds: 0,
        name: `Route ${routeIndex + 1}`,
        ...(routeData[routeIndex] || {}),
      };

      let routeSummary = currentRouteData.name || `Route ${routeIndex + 1}`;
      if (currentRouteData.distance && currentRouteData.travelTime) {
        routeSummary += ` (${currentRouteData.distance}, ${currentRouteData.travelTime})`;
        if (currentRouteData.trafficDelayInSeconds > 0) {
          routeSummary += ` +${currentRouteData.trafficDelay} delay`;
        }
      }

      return {
        type: "Feature" as const,
        geometry: { type: "LineString" as const, coordinates: validCoords },
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
    .filter((f): f is InternalRouteFeature => f !== null);
}

function buildRouteLabelFeatures(routeFeatures: InternalRouteFeature[]): InternalLabelFeature[] {
  const labelFeatures: InternalLabelFeature[] = [];
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

// ─── Main Render Function ────────────────────────────────────────────────────

/**
 * Builds the state an MCP app needs to render a dynamic map: the basemap style
 * to load, the viewport to open on, and the GeoJSON sources and layers for the
 * markers, routes and polygons the caller asked for.
 *
 * Nothing is rasterised here. The width and height are the viewport the state
 * is fitted to, which the app uses to reproduce the same framing.
 */
export async function renderDynamicMap(options: DynamicMapOptions): Promise<DynamicMapResponse> {
  validateApiKey();
  logger.info("Processing dynamic map request");

  try {
    const finalOptions = { ...DEFAULT_OPTIONS, ...options };
    const width = finalOptions.width || DEFAULT_OPTIONS.width;
    const height = finalOptions.height || DEFAULT_OPTIONS.height;
    const showLabels = finalOptions.showLabels || false;

    // ── Prepare markers ──────────────────────────────────────────────────
    const markers: NonNullable<DynamicMapOptions["markers"]> = finalOptions.markers
      ? [...finalOptions.markers]
      : [];

    // Route planning mode — detected from routePlans array
    const routePlans: RoutePlan[] = finalOptions.routePlans || [];
    const isRoutePlanningMode = routePlans.length > 0;

    // Prepare polygons
    const polygons: NonNullable<DynamicMapOptions["polygons"]> = finalOptions.polygons
      ? [...finalOptions.polygons]
      : [];

    // Validate content
    const hasMarkers = markers.length > 0;
    const hasPolygons = polygons.length > 0;
    const hasDirectRoutes = !!(finalOptions as { routes?: unknown[] }).routes?.length;
    const hasBbox =
      finalOptions.bbox && Array.isArray(finalOptions.bbox) && finalOptions.bbox.length === 4;

    if (!isRoutePlanningMode && !hasMarkers && !hasPolygons && !hasDirectRoutes && !hasBbox) {
      throw new IncorrectError("Map requires content to display", {});
    }

    // ── Calculate routes ─────────────────────────────────────────────────
    let routes: Array<Array<{ lat: number; lon: number }>> = [];
    const routeData: RouteSummary[] = [];

    // Handle direct routes (drawn lines, not road-following)
    type DirectRoutePoint = { lat?: number; lon?: number; latitude?: number; longitude?: number };
    type DirectRoute =
      | { points?: DirectRoutePoint[]; color?: string; name?: string }
      | DirectRoutePoint[];
    const directRoutes: DirectRoute[] | undefined = (finalOptions as { routes?: DirectRoute[] })
      .routes;
    if (directRoutes?.length && !isRoutePlanningMode) {
      routes = directRoutes
        .map((route, routeIndex: number) => {
          const routeObj = Array.isArray(route) ? null : route;
          const routePoints: DirectRoutePoint[] = Array.isArray(route) ? route : route.points || [];
          if (routePoints.length < 2) return [];

          const validCoords = routePoints
            .map((point, pointIndex: number) =>
              extractCoordinates(point, `${routeIndex}-${pointIndex}`, "route point")
            )
            .filter((c): c is { lat: number; lon: number } => c !== null)
            .map((c) => [c.lat, c.lon] as [number, number]);

          if (validCoords.length > 1) {
            routeData.push({
              lengthInMeters: 0,
              travelTimeInSeconds: 0,
              trafficDelayInSeconds: 0,
              distance: "",
              travelTime: "",
              trafficDelay: "",
              trafficColor: routeObj?.color || "#007cbf",
              hasTrafficData: false,
              name: routeObj?.name || `Route ${routeIndex + 1}`,
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
                label: routeObj?.name ? `${routeObj.name} Start` : `Route ${routeIndex + 1} Start`,
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
                label: routeObj?.name ? `${routeObj.name} End` : `Route ${routeIndex + 1} End`,
                color: "#ef4444",
              });
            }

            return validCoords.map((c) => ({ lat: c[0], lon: c[1] }));
          }
          return [];
        })
        .filter((r) => r.length > 0);
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
              "Invalid origin or destination coordinates in route plan, skipping"
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
          const routeOptions: RoutePlanRouteOptions = {
            routeType: plan.routeType || "fast",
            travelMode: plan.travelMode || "car",
            ...(plan.avoid?.length ? { avoid: plan.avoid as Avoidable[] } : {}),
            ...(plan.traffic ? { traffic: "live" as const } : {}),
          };

          // Call routing API — origin, optional waypoints and destination as [lon, lat]
          const locations: Position[] = [
            [originCoords.lon, originCoords.lat],
            ...(plan.waypoints ?? []).map(
              (wp: { lat: number; lon: number }): Position => [wp.lon, wp.lat]
            ),
            [destCoords.lon, destCoords.lat],
          ];
          const routeResult = await getRoute(locations, routeOptions);

          if (routeResult?.features?.length) {
            for (const route of routeResult.features) {
              const coordinates = (route.geometry?.coordinates ?? []).map(
                ([lon, lat]: Position) => ({ lat, lon })
              );

              const summary = route.properties?.summary;
              const lengthInMeters = summary?.lengthInMeters || 0;
              const travelTimeInSeconds = summary?.travelTimeInSeconds || 0;
              const trafficDelayInSeconds = summary?.trafficDelayInSeconds || 0;

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

    // Keep zoom whole so the app opens on a predictable, stable framing
    zoom = Math.round(zoom);
    zoom = Math.max(0, Math.min(22, zoom));

    // ── Calculate viewport geometry ──────────────────────────────────────
    const centerLat = center[1]; // center is [lon, lat]
    const centerLon = center[0];
    const viewBounds = getVisibleBounds(centerLat, centerLon, zoom, width, height);

    // Update bounds to match actual viewport
    calculatedBounds = {
      north: viewBounds.north,
      south: viewBounds.south,
      east: viewBounds.east,
      west: viewBounds.west,
    };

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
            return !polygons.some((p) => {
              const pc = p.center || computePolygonCentroid(p.coordinates || []);
              if (!pc) return false;
              const dlat = Math.abs(mc.lat - pc.lat);
              const dlon = Math.abs(mc.lon - pc.lon);
              return dlat < 0.001 && dlon < 0.001; // ~100m tolerance
            });
          })
        : markers;
    const markerFeatures = filteredMarkers.length > 0 ? buildMarkerFeatures(filteredMarkers) : [];

    // ── Build mapState for the interactive app ───────────────────────────
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

    const mapState: CachedMapState = {
      style: {
        endpoint: "maps/orbis/assets/styles/0.5.0-0/style.json",
        params: { apiVersion: "1", map: `basic_${DEFAULT_MAP_STYLE}` },
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
    logger.info(
      { width, height, zoom, sources: Object.keys(mapState.sources).length },
      "Dynamic map state built successfully"
    );

    return { width, height, mapState };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message }, "Dynamic map generation failed");
    throw error;
  }
}

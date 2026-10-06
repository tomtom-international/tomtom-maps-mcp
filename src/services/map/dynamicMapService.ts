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
import { requireApiKey } from "../base/tomtomClient";
import { getRoute, type RouteOptions } from "../routing/routingService";
import { toBBox } from "../shared/sdkInputs";
import type {
  CachedMapState,
  DynamicMapOptions,
  DynamicMapResponse,
  DynamicMapSummary,
  GeoJSONFeature,
  LayerDefinition,
  MapMarker,
  MapPolygon,
  MapSourceName,
} from "./dynamicMapTypes";
import {
  type Bounds,
  calculateEnhancedBounds,
  calculateOptimalZoom,
  computePolygonCentroid,
  generateCirclePoints,
  isCircle,
  isValidPoint,
  type Point,
} from "./geometryUtils";
import { resolveIconKey } from "./poiIconData";

const TILE_SIZE = 256;
const DEFAULT_MAP_STYLE = "street-light";
const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 400;

// 6 distinct colors, one per route plan
const ROUTE_COLORS = ["#4285F4", "#EA4335", "#34A853", "#FBBC04", "#8E24AA", "#00ACC1"];

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
 * Calculate the visible geographic bounds from center ([lon, lat]) + zoom + dimensions
 */
function getVisibleBounds(
  [centerLon, centerLat]: [number, number],
  zoom: number,
  width: number,
  height: number
): Bounds {
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

  return { north, south, east, west };
}

/** Within ~100 m of each other. */
function isNear(a: Point, b: Point): boolean {
  return Math.abs(a.lat - b.lat) < 0.001 && Math.abs(a.lon - b.lon) < 0.001;
}

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
  geometry: { type: "Polygon"; coordinates: Position[][] };
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

const POLYGON_STYLES = {
  circle: {
    name: "Circle",
    label: "Circle",
    fillColor: "rgba(255, 193, 7, 0.3)",
    strokeColor: "#ffc107",
  },
  polygon: {
    name: "Polygon",
    label: "Area",
    fillColor: "rgba(0, 123, 255, 0.3)",
    strokeColor: "#007bff",
  },
};

/** The closed exterior ring as [lon, lat] positions, or null when the shape has under three points. */
function polygonRing(polygon: MapPolygon): Position[] | null {
  const ring: Position[] = isCircle(polygon)
    ? generateCirclePoints(polygon.center.lat, polygon.center.lon, polygon.radius).map(
        ({ lat, lon }) => [lon, lat]
      )
    : [...(polygon.coordinates ?? [])];
  if (ring.length < 3) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  return ring;
}

function buildPolygonFeatures(polygons: MapPolygon[]): InternalPolygonFeature[] {
  return polygons.flatMap((polygon, index) => {
    const ring = polygonRing(polygon);
    if (!ring) {
      logger.warn({ index }, "Polygon has neither valid coordinates nor circle definition");
      return [];
    }
    const style = POLYGON_STYLES[isCircle(polygon) ? "circle" : "polygon"];
    return [
      {
        type: "Feature",
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          id: index,
          label: polygon.label || polygon.name || `${style.label} ${index + 1}`,
          fillColor: polygon.fillColor || style.fillColor,
          strokeColor: polygon.strokeColor || style.strokeColor,
          strokeWidth: polygon.strokeWidth ?? 2,
          name: polygon.name || `${style.name} ${index + 1}`,
        },
      },
    ];
  });
}

/**
 * Build Point features at the centroid of each polygon for badge label rendering.
 * Carries label text and stroke color for the colored dot.
 */
function buildPolygonCenterFeatures(
  polygonFeatures: InternalPolygonFeature[],
  polygons: MapPolygon[]
): InternalPointFeature[] {
  return polygonFeatures.map(({ geometry, properties }) => {
    // A circle's own center is more precise than the centroid of its ring
    const centroid =
      polygons[properties.id]?.center ?? computePolygonCentroid(geometry.coordinates[0]);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [centroid.lon, centroid.lat] },
      properties: {
        id: properties.id,
        label: properties.label,
        strokeColor: properties.strokeColor,
        fillColor: properties.fillColor,
      },
    };
  });
}

function buildMarkerFeatures(markers: MapMarker[]): InternalMarkerFeature[] {
  const priorityOrder: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
  const sorted = [...markers].sort(
    (a, b) =>
      (priorityOrder[a.priority ?? "normal"] ?? 2) - (priorityOrder[b.priority ?? "normal"] ?? 2)
  );

  const categoryColorMap = new Map<string, string>();

  return sorted.map((marker, index: number) => {
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
      geometry: { type: "Point", coordinates: [marker.lon, marker.lat] },
      properties: {
        id: index,
        label: marker.label || `Marker ${index + 1}`,
        color,
        markerType,
        priority: marker.priority ?? "normal",
        ...(iconKey && { iconKey }),
        ...(iconKey && { iconImageId: `icon-${iconKey}-${color.replace("#", "")}` }),
        ...(marker.category && { category: marker.category }),
        ...(marker.description && { description: marker.description }),
        ...(marker.address && { address: marker.address }),
        ...(marker.tags?.length && { tags: JSON.stringify(marker.tags) }),
      },
    };
  });
}

function buildRouteFeatures(routes: Point[][], routeData: RouteSummary[]): InternalRouteFeature[] {
  return routes
    .map((route, routeIndex) => {
      if (route.length < 2) return null;
      const coordinates = route.map(({ lat, lon }): [number, number] => [lon, lat]);

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
        geometry: { type: "LineString" as const, coordinates },
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

function summarizeMap(
  view: CachedMapState["view"],
  markerFeatures: InternalMarkerFeature[],
  routeFeatures: InternalRouteFeature[],
  polygonFeatures: InternalPolygonFeature[]
): DynamicMapSummary {
  return {
    view,
    ...(markerFeatures.length > 0 && {
      markers: markerFeatures.map(({ geometry, properties: p }) => ({
        label: p.label,
        position: geometry.coordinates,
        ...(p.category && { category: p.category }),
      })),
    }),
    ...(routeFeatures.length > 0 && {
      routes: routeFeatures.map(({ properties: p }) => ({
        name: p.routeName,
        ...(p.distance && {
          distance: p.distance,
          travelTime: p.travelTime,
          lengthInMeters: p.lengthInMeters,
          travelTimeInSeconds: p.travelTimeInSeconds,
        }),
        ...(p.hasTrafficData && {
          trafficDelay: p.trafficDelay,
          trafficDelayInSeconds: p.trafficDelayInSeconds,
        }),
      })),
    }),
    ...(polygonFeatures.length > 0 && {
      areas: polygonFeatures.map(({ properties: p }) => ({ label: p.label })),
    }),
  };
}

// ─── MapState Layer Definitions ──────────────────────────────────────────────

function buildMapStateLayers(
  sources: CachedMapState["sources"],
  showLabels: boolean
): LayerDefinition[] {
  const layers: LayerDefinition[] = [];

  if (sources.polygons) {
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
  if (sources.polygonCenters && showLabels) {
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

  if (sources.routes) {
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
    if (showLabels && sources.routeLabels) {
      layers.push({
        id: "route-labels",
        type: "symbol",
        source: "routeLabels",
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
  if (sources.markers) {
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

/**
 * Builds the state an MCP app needs to render a dynamic map: the basemap style
 * to load, the viewport to open on, and the GeoJSON sources and layers for the
 * markers, routes and polygons the caller asked for.
 *
 * Nothing is rasterised here. The width and height are the viewport the state
 * is fitted to, which the app uses to reproduce the same framing.
 */
export async function renderDynamicMap(options: DynamicMapOptions): Promise<DynamicMapResponse> {
  requireApiKey();

  const { width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, showLabels = false } = options;
  const markers = (options.markers ?? []).filter((m, i) => isValidPoint(m, i, "marker"));
  const polygons = options.polygons ?? [];
  const routePlans = options.routePlans ?? [];
  const directRoutes = options.routes ?? [];
  const bbox = toBBox(options.bbox);

  if (!routePlans.length && !markers.length && !polygons.length && !directRoutes.length && !bbox) {
    throw new IncorrectError("Map requires content to display", {});
  }

  // ── Calculate routes ─────────────────────────────────────────────────
  const routes: Point[][] = [];
  const routeData: RouteSummary[] = [];

  // Direct routes: drawn lines, not road-following
  directRoutes.forEach((route, routeIndex) => {
    const points = route.points.filter((point, pointIndex) =>
      isValidPoint(point, `${routeIndex}-${pointIndex}`, "route point")
    );
    if (points.length < 2) return;

    const name = route.name || `Route ${routeIndex + 1}`;
    routeData.push({ name, trafficColor: route.color || "#007cbf" });
    routes.push(points);

    const start = points[0];
    const end = points[points.length - 1];
    if (!markers.some((m) => isNear(m, start))) {
      markers.push({ lat: start.lat, lon: start.lon, label: `${name} Start`, color: "#22c55e" });
    }
    if (!markers.some((m) => isNear(m, end))) {
      markers.push({ lat: end.lat, lon: end.lon, label: `${name} End`, color: "#ef4444" });
    }
  });

  // Route plans (TomTom Routing API — multiple independent trips)
  for (const [planIdx, plan] of routePlans.entries()) {
    const planColor = plan.color || ROUTE_COLORS[planIdx % ROUTE_COLORS.length];
    const planLabel = plan.label || `Route ${planIdx + 1}`;

    if (
      !isValidPoint(plan.origin, planIdx, "origin") ||
      !isValidPoint(plan.destination, planIdx, "destination")
    ) {
      logger.warn({ planIdx }, "Invalid origin or destination coordinates in route plan, skipping");
      continue;
    }
    const waypoints = (plan.waypoints ?? []).filter((wp, i) => isValidPoint(wp, i, "waypoint"));

    markers.push(
      {
        lat: plan.origin.lat,
        lon: plan.origin.lon,
        label: plan.origin.label || `${planLabel} Start`,
        color: planColor,
      },
      ...waypoints.map((wp, i) => ({
        lat: wp.lat,
        lon: wp.lon,
        label: wp.label || `${planLabel} Waypoint ${i + 1}`,
        color: "#f97316",
      })),
      {
        lat: plan.destination.lat,
        lon: plan.destination.lon,
        label: plan.destination.label || `${planLabel} End`,
        color: planColor,
      }
    );

    const routeOptions: RouteOptions = {
      routeType: plan.routeType || "fast",
      travelMode: plan.travelMode || "car",
      ...(plan.avoid?.length ? { avoid: plan.avoid } : {}),
      traffic: plan.traffic ? "live" : "historical",
    };
    const locations: Position[] = [plan.origin, ...waypoints, plan.destination].map(
      ({ lat, lon }) => [lon, lat]
    );

    try {
      const routeResult = await getRoute(locations, routeOptions);
      for (const route of routeResult?.features ?? []) {
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
          trafficColor: plan.color || getTrafficColor(travelTimeInSeconds, trafficDelayInSeconds),
          hasTrafficData: trafficDelayInSeconds > 0,
          name: planLabel,
        });
        routes.push((route.geometry?.coordinates ?? []).map(([lon, lat]) => ({ lat, lon })));
      }
    } catch (routeError) {
      logger.warn(
        { planIdx, label: planLabel, error: String(routeError) },
        "Failed to calculate route plan, proceeding with remaining plans"
      );
    }
  }

  // ── Calculate center/zoom ────────────────────────────────────────────
  let center: [number, number]; // [lon, lat]
  let zoom: number;

  if (bbox) {
    const [west, south, east, north] = bbox;
    center = [(west + east) / 2, (south + north) / 2];
    zoom = options.zoom ?? calculateOptimalZoom({ north, south, east, west }, width, height);
  } else if (options.center && options.zoom !== undefined) {
    center = [options.center.lon, options.center.lat];
    zoom = options.zoom;
  } else {
    const fitted = calculateEnhancedBounds(markers, routes, width, height, polygons);
    center = options.center ? [options.center.lon, options.center.lat] : fitted.center;
    zoom = options.zoom ?? fitted.zoom;
  }

  // Keep zoom whole so the app opens on a predictable, stable framing
  zoom = Math.max(0, Math.min(22, Math.round(zoom)));

  // ── Build GeoJSON sources ────────────────────────────────────────────
  const polygonFeatures = buildPolygonFeatures(polygons);
  const routeFeatures = buildRouteFeatures(routes, routeData);

  // Markers sitting at the center of a polygon are redundant with its label
  const polygonCenters = polygons.map(
    (p) => p.center ?? computePolygonCentroid(p.coordinates ?? [])
  );
  const visibleMarkers = markers.filter((m) => !polygonCenters.some((c) => isNear(m, c)));
  const markerFeatures = buildMarkerFeatures(visibleMarkers);

  const featuresBySource: Record<MapSourceName, object[]> = {
    polygons: polygonFeatures,
    routes: routeFeatures,
    routeLabels: buildRouteLabelFeatures(routeFeatures),
    markers: markerFeatures,
    polygonCenters: buildPolygonCenterFeatures(polygonFeatures, polygons),
  };
  const sources: CachedMapState["sources"] = {};
  for (const [name, features] of Object.entries(featuresBySource) as Array<
    [MapSourceName, object[]]
  >) {
    if (features.length > 0) {
      sources[name] = {
        type: "geojson",
        data: { type: "FeatureCollection", features: features as GeoJSONFeature[] },
      };
    }
  }

  const mapState: CachedMapState = {
    style: {
      endpoint: "maps/orbis/assets/styles/0.5.0-0/style.json",
      params: { apiVersion: "1", map: `basic_${DEFAULT_MAP_STYLE}` },
    },
    view: { center, zoom, bounds: getVisibleBounds(center, zoom, width, height) },
    sources,
    layers: buildMapStateLayers(sources, showLabels),
    options: { width, height, showLabels },
  };

  logger.info(
    { width, height, zoom, sources: Object.keys(sources).length },
    "Dynamic map state built successfully"
  );

  return {
    summary: summarizeMap(mapState.view, markerFeatures, routeFeatures, polygonFeatures),
    mapState,
  };
}

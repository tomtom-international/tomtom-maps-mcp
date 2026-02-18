/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { TomTomMap } from "@tomtom-org/maps-sdk/map";
import { Popup } from "maplibre-gl";
import { createMapControls } from "../../shared/map-controls";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import { injectPoiPopupStyles, escapeHtml } from "../../shared/poi-popup";
import "./styles.css";

// Type definitions for cached map state
interface LayerDefinition {
  id: string;
  type: "circle" | "line" | "fill" | "symbol";
  source: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  filter?: unknown[];
}

interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown> | null;
  }>;
}

interface CachedMapState {
  style: {
    endpoint: string;
    params: Record<string, string>;
    useOrbis: boolean;
  };
  view: {
    center: [number, number];
    zoom: number;
    bounds: { north: number; south: number; east: number; west: number };
  };
  sources: {
    markers?: { type: "geojson"; data: GeoJSONFeatureCollection };
    routes?: { type: "geojson"; data: GeoJSONFeatureCollection };
    routeLabels?: { type: "geojson"; data: GeoJSONFeatureCollection };
    polygons?: { type: "geojson"; data: GeoJSONFeatureCollection };
  };
  layers: LayerDefinition[];
  options: { width: number; height: number; showLabels: boolean };
}

// State tracking
let map: TomTomMap | null = null;
let mapReady = false;
let pendingData: CachedMapState | null = null;
let activePopup: Popup | null = null;
let currentMapState: CachedMapState | null = null;

// ─── Predefined Shape Icon Generation ────────────────────────────────────────

const PREDEFINED_SHAPES = ["pin", "star", "square", "diamond", "triangle", "cross", "heart"];

/**
 * Generate a canvas-based icon image for a predefined shape.
 * Returns ImageData (48x48) for registration with map.addImage().
 */
function generateShapeImage(shapeName: string): ImageData {
  const size = 48;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;

  ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  ctx.beginPath();
  switch (shapeName) {
    case "pin":
      ctx.moveTo(cx, cy + r);
      ctx.bezierCurveTo(cx - r, cy, cx - r, cy - r, cx, cy - r);
      ctx.bezierCurveTo(cx + r, cy - r, cx + r, cy, cx, cy + r);
      break;
    case "star": {
      const outerR = r;
      const innerR = r * 0.4;
      for (let i = 0; i < 10; i++) {
        const angle = -Math.PI / 2 + (i * Math.PI) / 5;
        const rad = i % 2 === 0 ? outerR : innerR;
        const px = cx + Math.cos(angle) * rad;
        const py = cy + Math.sin(angle) * rad;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    }
    case "square":
      ctx.rect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6);
      break;
    case "diamond":
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r * 0.7, cy);
      ctx.lineTo(cx, cy + r);
      ctx.lineTo(cx - r * 0.7, cy);
      ctx.closePath();
      break;
    case "triangle":
      ctx.moveTo(cx, cy - r);
      ctx.lineTo(cx + r, cy + r * 0.7);
      ctx.lineTo(cx - r, cy + r * 0.7);
      ctx.closePath();
      break;
    case "cross": {
      const arm = r * 0.3;
      ctx.moveTo(cx - arm, cy - r);
      ctx.lineTo(cx + arm, cy - r);
      ctx.lineTo(cx + arm, cy - arm);
      ctx.lineTo(cx + r, cy - arm);
      ctx.lineTo(cx + r, cy + arm);
      ctx.lineTo(cx + arm, cy + arm);
      ctx.lineTo(cx + arm, cy + r);
      ctx.lineTo(cx - arm, cy + r);
      ctx.lineTo(cx - arm, cy + arm);
      ctx.lineTo(cx - r, cy + arm);
      ctx.lineTo(cx - r, cy - arm);
      ctx.lineTo(cx - arm, cy - arm);
      ctx.closePath();
      break;
    }
    case "heart":
      ctx.moveTo(cx, cy + r * 0.7);
      ctx.bezierCurveTo(cx - r * 1.2, cy - r * 0.2, cx - r * 0.6, cy - r, cx, cy - r * 0.4);
      ctx.bezierCurveTo(cx + r * 0.6, cy - r, cx + r * 1.2, cy - r * 0.2, cx, cy + r * 0.7);
      break;
    default:
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      break;
  }

  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#333333";
  ctx.lineWidth = 2;
  ctx.stroke();

  return ctx.getImageData(0, 0, size, size);
}

/**
 * Show a popup on the map, closing any existing popup first.
 */
function showPopup(
  lngLat: [number, number],
  html: string,
  offset: [number, number] = [0, -6]
): void {
  if (!map) return;

  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }

  activePopup = new Popup({
    closeButton: true,
    maxWidth: "360px",
    className: "poi-popup-container dynamic-map-popup-container",
    offset,
  })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map.mapLibreMap);

  activePopup.on("close", () => {
    activePopup = null;
  });
}

// App instance
const app = new App({ name: "TomTom Dynamic Map", version: "1.0.0" });

/**
 * Initialize the TomTom Map
 */
async function initializeMap(mapState: CachedMapState): Promise<void> {
  if (map) {
    // Map exists, just update it
    await updateMapState(mapState);
    return;
  }

  // Inject shared popup styles
  injectPoiPopupStyles();

  // Ensure TomTom SDK is configured with API key from server
  await ensureTomTomConfigured(app);

  // Create TomTom Map
  map = new TomTomMap({
    mapLibre: {
      container: "sdk-map",
      center: mapState.view.center,
      zoom: mapState.view.zoom,
    },
  });

  // Add map controls for theme and traffic
  await createMapControls(map, {
    position: "top-right",
    showTrafficToggle: true,
    showThemeToggle: true,
    onThemeChange: () => {
      if (currentMapState && map && mapReady) {
        addSourcesAndLayers(currentMapState);
        setupInteractivity(currentMapState);
      }
    },
  });

  // Wait for map to load
  return new Promise<void>((resolve) => {
    const onReady = () => {
      mapReady = true;
      currentMapState = mapState;
      addSourcesAndLayers(mapState);
      setupInteractivity(mapState);
      fitMapToBounds(mapState.view.bounds);

      if (pendingData) {
        updateMapState(pendingData);
        pendingData = null;
      }
      resolve();
    };

    if (map!.mapLibreMap.loaded()) {
      onReady();
    } else {
      map!.mapLibreMap.on("load", onReady);
    }
  });
}

/**
 * Add GeoJSON sources and layers to the map
 */
function addSourcesAndLayers(mapState: CachedMapState): void {
  if (!map) return;

  const mlMap = map.mapLibreMap;

  // Register predefined shape images for icon markers
  for (const shape of PREDEFINED_SHAPES) {
    const id = `shape-${shape}`;
    if (!mlMap.hasImage(id)) {
      mlMap.addImage(id, generateShapeImage(shape), { pixelRatio: 2 });
    }
  }

  // Add sources
  for (const [sourceName, sourceData] of Object.entries(mapState.sources)) {
    if (sourceData && !mlMap.getSource(sourceName)) {
      mlMap.addSource(sourceName, sourceData as any);
    }
  }

  // Add layers in order (they're already ordered: polygons -> routes -> markers)
  for (const layer of mapState.layers) {
    if (!mlMap.getLayer(layer.id)) {
      mlMap.addLayer(layer as any);
    }
  }
}

/**
 * Build popup HTML for a marker feature.
 */
function buildMarkerPopupHtml(props: Record<string, unknown>): string {
  const label = escapeHtml(String(props.label || "Marker"));
  const category = props.category as string | undefined;
  const description = props.description as string | undefined;
  const address = props.address as string | undefined;
  const priority = props.priority as string | undefined;

  // Parse tags — stored as JSON string in GeoJSON properties
  let tags: string[] = [];
  if (props.tags) {
    try {
      tags = JSON.parse(String(props.tags));
    } catch {
      /* not valid JSON */
    }
  }

  let html = `<div class="dm-popup">`;

  // Category line (small, muted — like poi-popup)
  if (category) {
    html += `<div class="dm-popup-category">${escapeHtml(category)}</div>`;
  }

  // Title
  html += `<h3 class="dm-popup-title">${label}</h3>`;

  // Description
  if (description) {
    html += `<div class="dm-popup-description">${escapeHtml(description)}</div>`;
  }

  // Address
  if (address) {
    html += `<div class="dm-popup-address">${escapeHtml(address)}</div>`;
  }

  // Tags as badges
  if (tags.length > 0) {
    html += `<div class="dm-popup-tags">`;
    for (const tag of tags) {
      html += `<span class="dm-popup-tag">${escapeHtml(tag)}</span>`;
    }
    html += `</div>`;
  }

  // Priority badge
  if (priority && priority !== "normal") {
    html += `<span class="dm-popup-badge dm-badge-${escapeHtml(priority)}">${escapeHtml(priority)}</span>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Build popup HTML for a route feature.
 */
function buildRoutePopupHtml(props: Record<string, unknown>): string {
  const name = escapeHtml(String(props.routeName || "Route"));
  let html = `<div class="dm-popup"><h3 class="dm-popup-title">${name}</h3>`;

  const stats: string[] = [];
  if (props.distance) stats.push(`Distance: ${escapeHtml(String(props.distance))}`);
  if (props.travelTime) stats.push(`Time: ${escapeHtml(String(props.travelTime))}`);
  if (props.trafficDelayInSeconds && Number(props.trafficDelayInSeconds) > 0) {
    stats.push(`<span class="dm-traffic-delay">+${escapeHtml(String(props.trafficDelay))} delay</span>`);
  }

  if (stats.length > 0) {
    html += `<div class="dm-popup-details">`;
    for (const stat of stats) {
      html += `<div class="dm-popup-row">${stat}</div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Build popup HTML for a polygon feature.
 */
function buildPolygonPopupHtml(props: Record<string, unknown>): string {
  const label = escapeHtml(String(props.label || props.name || "Area"));
  let html = `<div class="dm-popup"><h3 class="dm-popup-title">${label}</h3>`;

  const skipKeys = new Set(["label", "name", "color", "fillColor", "strokeColor"]);
  const entries = Object.entries(props).filter(([k]) => !skipKeys.has(k));
  if (entries.length > 0) {
    html += `<div class="dm-popup-details">`;
    for (const [key, value] of entries) {
      if (value == null || value === "") continue;
      html += `<div class="dm-popup-row"><span class="dm-popup-key">${escapeHtml(key)}</span><span class="dm-popup-value">${escapeHtml(String(value))}</span></div>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

/**
 * Setup click handlers for markers, routes, and polygons.
 * Uses a single activePopup to prevent multiple popups from appearing.
 */
function setupInteractivity(mapState: CachedMapState): void {
  if (!map) return;

  const mlMap = map.mapLibreMap;

  // Make markers clickable (use the main marker layer)
  const markerLayerId = "marker-layer";
  if (mapState.sources.markers && mlMap.getLayer(markerLayerId)) {
    mlMap.on("click", markerLayerId, (e) => {
      if (e.features && e.features.length > 0) {
        // Flag event as handled so polygon handler doesn't also fire
        (e.originalEvent as any)._handled = true;

        const feature = e.features[0];
        const coordinates = (
          feature.geometry as { type: "Point"; coordinates: number[] }
        ).coordinates.slice() as [number, number];
        const props = (feature.properties as Record<string, unknown>) || {};

        showPopup(coordinates, buildMarkerPopupHtml(props), [0, -10]);
      }
    });

    mlMap.on("mouseenter", markerLayerId, () => {
      mlMap.getCanvas().style.cursor = "pointer";
    });
    mlMap.on("mouseleave", markerLayerId, () => {
      mlMap.getCanvas().style.cursor = "";
    });
  }

  // Make shape icon markers clickable
  const shapeLayerId = "marker-icon-shapes";
  if (mapState.sources.markers && mlMap.getLayer(shapeLayerId)) {
    mlMap.on("click", shapeLayerId, (e) => {
      if (e.features && e.features.length > 0) {
        (e.originalEvent as any)._handled = true;
        const feature = e.features[0];
        const coordinates = (
          feature.geometry as { type: "Point"; coordinates: number[] }
        ).coordinates.slice() as [number, number];
        const props = (feature.properties as Record<string, unknown>) || {};
        showPopup(coordinates, buildMarkerPopupHtml(props), [0, -14]);
      }
    });
    mlMap.on("mouseenter", shapeLayerId, () => {
      mlMap.getCanvas().style.cursor = "pointer";
    });
    mlMap.on("mouseleave", shapeLayerId, () => {
      mlMap.getCanvas().style.cursor = "";
    });
  }

  // Make emoji icon markers clickable
  const emojiLayerId = "marker-icon-emoji";
  if (mapState.sources.markers && mlMap.getLayer(emojiLayerId)) {
    mlMap.on("click", emojiLayerId, (e) => {
      if (e.features && e.features.length > 0) {
        (e.originalEvent as any)._handled = true;
        const feature = e.features[0];
        const coordinates = (
          feature.geometry as { type: "Point"; coordinates: number[] }
        ).coordinates.slice() as [number, number];
        const props = (feature.properties as Record<string, unknown>) || {};
        showPopup(coordinates, buildMarkerPopupHtml(props), [0, -14]);
      }
    });
    mlMap.on("mouseenter", emojiLayerId, () => {
      mlMap.getCanvas().style.cursor = "pointer";
    });
    mlMap.on("mouseleave", emojiLayerId, () => {
      mlMap.getCanvas().style.cursor = "";
    });
  }

  // Make routes clickable
  const routeLayerId = "route-layer";
  if (mapState.sources.routes && mlMap.getLayer(routeLayerId)) {
    mlMap.on("click", routeLayerId, (e) => {
      if (e.features && e.features.length > 0) {
        (e.originalEvent as any)._handled = true;

        const props = (e.features[0].properties as Record<string, unknown>) || {};
        showPopup([e.lngLat.lng, e.lngLat.lat], buildRoutePopupHtml(props));
      }
    });

    mlMap.on("mouseenter", routeLayerId, () => {
      mlMap.getCanvas().style.cursor = "pointer";
    });
    mlMap.on("mouseleave", routeLayerId, () => {
      mlMap.getCanvas().style.cursor = "";
    });
  }

  // Make polygons clickable — skipped if a marker/route already handled this click
  const polygonLayerId = "polygon-fill";
  if (mapState.sources.polygons && mlMap.getLayer(polygonLayerId)) {
    mlMap.on("click", polygonLayerId, (e) => {
      if ((e.originalEvent as any)._handled) return;
      if (e.features && e.features.length > 0) {
        const props = (e.features[0].properties as Record<string, unknown>) || {};
        showPopup([e.lngLat.lng, e.lngLat.lat], buildPolygonPopupHtml(props));
      }
    });

    mlMap.on("mouseenter", polygonLayerId, () => {
      mlMap.getCanvas().style.cursor = "pointer";
    });
    mlMap.on("mouseleave", polygonLayerId, () => {
      mlMap.getCanvas().style.cursor = "";
    });
  }
}

/**
 * Fit map view to the specified bounds
 */
function fitMapToBounds(bounds: CachedMapState["view"]["bounds"]): void {
  if (!map) return;

  map.mapLibreMap.fitBounds(
    [
      [bounds.west, bounds.south],
      [bounds.east, bounds.north],
    ],
    { padding: 50, maxZoom: 17 }
  );
}

/**
 * Update map with new state (clear and re-add)
 */
async function updateMapState(mapState: CachedMapState): Promise<void> {
  if (!map || !mapReady) {
    pendingData = mapState;
    return;
  }

  // Clear existing custom layers and sources
  clearMap();

  // Add new sources and layers
  currentMapState = mapState;
  addSourcesAndLayers(mapState);
  setupInteractivity(mapState);
  fitMapToBounds(mapState.view.bounds);
}

/**
 * Clear custom layers and sources from the map
 */
function clearMap(): void {
  if (!map) return;

  // Close any open popup
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }

  const mlMap = map.mapLibreMap;

  // Remove all custom layers (identified by source name patterns)
  const customSources = ["markers", "routes", "routeLabels", "polygons", "route-labels"];
  const style = mlMap.getStyle();
  if (style?.layers) {
    for (const layer of style.layers) {
      const layerSource = (layer as { source?: string }).source;
      if (layerSource && customSources.includes(layerSource)) {
        try {
          mlMap.removeLayer(layer.id);
        } catch {
          /* layer may not exist */
        }
      }
    }
  }

  // Remove custom sources
  for (const src of customSources) {
    try {
      if (mlMap.getSource(src)) {
        mlMap.removeSource(src);
      }
    } catch {
      /* source may not exist */
    }
  }
}

/**
 * Process incoming map data
 */
async function processMapData(mapState: CachedMapState): Promise<void> {
  if (!mapReady) {
    pendingData = mapState;
    await initializeMap(mapState);
    return;
  }
  await updateMapState(mapState);
}

// Handle tool results - look for text content with _meta
app.ontoolresult = async (r) => {
  if (r.isError) {
    showErrorUI();
    return;
  }

  try {
    // Find the text content with _meta (may not be the first text block)
    let agentResponse: any = null;
    for (const c of r.content) {
      if (c.type !== "text") continue;
      try {
        const parsed = JSON.parse(c.text);
        if (parsed._meta) {
          agentResponse = parsed;
          break;
        }
      } catch {
        // Not JSON, skip
      }
    }
    if (!agentResponse) return;

    if (!shouldShowUI(agentResponse)) {
      hideMapUI();
      return;
    }

    showMapUI();

    // Extract full map state from cache
    const mapState = (await extractFullData(app, agentResponse)) as CachedMapState;
    if (mapState && mapState.sources) {
      await processMapData(mapState);
    }
  } catch (e) {
    console.error("Error processing dynamic map data:", e);
  }
};

app.onteardown = async () => {
  if (map) {
    clearMap();
  }
  return {};
};

app.connect();

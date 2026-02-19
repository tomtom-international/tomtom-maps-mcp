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

// ─── Map Pin Marker Image ────────────────────────────────────────────────────

// Map pin SVG path (24x29 viewBox) — compact teardrop pin from search-poi-default-big.svg
const MAP_PIN_PATH =
  "M12 0.299805C18.6274 0.299805 24 5.67239 24 12.2998C24 16.3318 22.011 19.8976 18.9609 22.0724C16.6127 23.7469 14.1021 25.4307 12.79 27.999C12.4489 28.6666 11.5511 28.6666 11.21 27.999C9.89722 25.4306 7.38622 23.7468 5.03788 22.0718C1.98845 19.8968 0 16.3313 0 12.2998C0 5.67239 5.37258 0.299805 12 0.299805Z";
const MAP_PIN_SVG_WIDTH = 24;
const MAP_PIN_SVG_HEIGHT = 29;

/**
 * Generate map pin image for MapLibre.
 * Returns ImageData — blue teardrop pin on transparent background.
 */
function generatePinImage(): ImageData {
  const w = 48;
  const h = 58;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const scale = h / MAP_PIN_SVG_HEIGHT;
  const offsetX = (w - MAP_PIN_SVG_WIDTH * scale) / 2;

  ctx.save();
  ctx.translate(offsetX, 0);
  ctx.scale(scale, scale);

  // eslint-disable-next-line no-undef
  const path = new Path2D(MAP_PIN_PATH);
  ctx.fillStyle = "#1988CF";
  ctx.fill(path);

  // Dark border for depth
  ctx.strokeStyle = "rgba(0, 0, 0, 0.3)";
  ctx.lineWidth = 1;
  ctx.stroke(path);
  ctx.restore();

  return ctx.getImageData(0, 0, w, h);
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

  // Register TomTom pin marker image (fixed red color, not SDF)
  if (!mlMap.hasImage("pin-marker")) {
    mlMap.addImage("pin-marker", generatePinImage(), { pixelRatio: 2 });
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
    stats.push(
      `<span class="dm-traffic-delay">+${escapeHtml(String(props.trafficDelay))} delay</span>`
    );
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

  // Make markers clickable (both dot and pin layers)
  const markerLayers = ["marker-dot", "marker-pin"];
  for (const layerId of markerLayers) {
    if (mapState.sources.markers && mlMap.getLayer(layerId)) {
      const popupOffset: [number, number] = layerId === "marker-pin" ? [0, -20] : [0, -10];
      mlMap.on("click", layerId, (e) => {
        if (e.features && e.features.length > 0) {
          (e.originalEvent as any)._handled = true;
          const feature = e.features[0];
          const coordinates = (
            feature.geometry as { type: "Point"; coordinates: number[] }
          ).coordinates.slice() as [number, number];
          const props = (feature.properties as Record<string, unknown>) || {};
          showPopup(coordinates, buildMarkerPopupHtml(props), popupOffset);
        }
      });
      mlMap.on("mouseenter", layerId, () => {
        mlMap.getCanvas().style.cursor = "pointer";
      });
      mlMap.on("mouseleave", layerId, () => {
        mlMap.getCanvas().style.cursor = "";
      });
    }
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

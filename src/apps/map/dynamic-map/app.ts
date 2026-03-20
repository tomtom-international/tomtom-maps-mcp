/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { TomTomMap, TrafficIncidentsModule } from "@tomtom-org/maps-sdk/map";
import { Popup, Marker } from "maplibre-gl";
import { createMapControls } from "../../shared/map-controls";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import { injectPoiPopupStyles, escapeHtml } from "../../shared/poi-popup";
import { POI_ICON_SVGS, extractSvgPaths } from "../../../services/map/poiIconData";
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
    polygonCenters?: { type: "geojson"; data: GeoJSONFeatureCollection };
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
let polygonLabelMarkers: Marker[] = [];
let trafficIncidentsModule: TrafficIncidentsModule | null = null;
let registeredIconImages = new Set<string>();

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
 * Generate an icon marker image for MapLibre: colored teardrop pin with white SVG icon.
 * Same shape as the blue pin-marker but filled with the category color and icon inside.
 * Returns ImageData at 2x resolution (68x82) for retina displays.
 */
function generateIconMarkerImage(svgContent: string, color: string): ImageData {
  const w = 68;
  const h = 82;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const pinScale = h / MAP_PIN_SVG_HEIGHT;
  const offsetX = (w - MAP_PIN_SVG_WIDTH * pinScale) / 2;

  ctx.save();
  ctx.translate(offsetX, 0);
  ctx.scale(pinScale, pinScale);

  // Colored teardrop background
  // eslint-disable-next-line no-undef
  const pinPath = new Path2D(MAP_PIN_PATH);
  ctx.fillStyle = color;
  ctx.fill(pinPath);

  // Subtle dark border for depth
  ctx.strokeStyle = "rgba(0, 0, 0, 0.2)";
  ctx.lineWidth = 0.4;
  ctx.stroke(pinPath);

  // White icon centered in the circular head (circle center ≈ 12, 12 in the 24x29 viewBox)
  const paths = extractSvgPaths(svgContent);
  const iconSize = 18; // icon size in viewBox units (scaled up)
  const iconScale = iconSize / 24; // SVGs are 24x24 viewBox
  const circleCenterX = MAP_PIN_SVG_WIDTH / 2; // 12
  const circleCenterY = 12; // center of circular head

  ctx.translate(circleCenterX - iconSize / 2, circleCenterY - iconSize / 2);
  ctx.scale(iconScale, iconScale);

  for (const p of paths) {
    // eslint-disable-next-line no-undef
    const path = new Path2D(p.d);
    ctx.fillStyle = "#ffffff";
    ctx.fill(path, p.fillRule);
  }

  ctx.restore();

  return ctx.getImageData(0, 0, w, h);
}

/**
 * Remove all polygon label HTML markers from the map.

 */
function clearPolygonLabelMarkers(): void {
  for (const marker of polygonLabelMarkers) {
    marker.remove();
  }
  polygonLabelMarkers = [];
}

/**
 * Add polygon label pills as HTML markers on the map.
 * Uses DOM elements with CSS border-radius for a guaranteed pill shape.
 */
function addPolygonLabelMarkers(mapState: CachedMapState): void {
  if (!map) return;

  clearPolygonLabelMarkers();

  const source = mapState.sources.polygonCenters;
  if (!source?.data?.features) return;

  for (const feature of source.data.features) {
    const coords = (feature.geometry as { coordinates: [number, number] }).coordinates;
    const props = feature.properties || {};
    const label = String(props.label || "");
    const color = String(props.strokeColor || "#333333");

    const el = document.createElement("div");
    el.className = "polygon-label-pill";

    const dot = document.createElement("span");
    dot.className = "polygon-label-dot";
    dot.style.backgroundColor = color;
    el.appendChild(dot);

    const text = document.createElement("span");
    text.className = "polygon-label-text";
    text.textContent = label;
    el.appendChild(text);

    const marker = new Marker({ element: el, anchor: "center" })
      .setLngLat(coords)
      .addTo(map.mapLibreMap);
    polygonLabelMarkers.push(marker);
  }
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

  // Initialize traffic incidents module (hidden by default, user toggles via button)
  trafficIncidentsModule = await TrafficIncidentsModule.get(map, { visible: false });

  // Set up incident click/hover handlers
  trafficIncidentsModule.events.on("click", (feature: any, lngLat: any) => {
    const props = feature.properties || {};
    showPopup([lngLat.lng, lngLat.lat], buildIncidentPopupHtml(props), [0, -12]);
  });
  trafficIncidentsModule.events.on("hover", () => {
    if (map) map.mapLibreMap.getCanvas().style.cursor = "pointer";
  });

  // Add map controls for theme, traffic flow, and traffic incidents
  await createMapControls(map, {
    position: "top-right",
    showTrafficToggle: true,
    showIncidentsToggle: true,
    showThemeToggle: true,
    externalIncidentsModule: trafficIncidentsModule,
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

  // Register icon marker images for each unique (iconKey, color) pair
  if (mapState.sources.markers) {
    for (const feature of (mapState.sources.markers as any).data.features) {
      const props = feature.properties;
      if (props?.markerType === "icon" && props?.iconKey && props?.color) {
        const imageId = props.iconImageId as string;
        if (imageId && !registeredIconImages.has(imageId) && !mlMap.hasImage(imageId)) {
          const svgContent = POI_ICON_SVGS[props.iconKey as string];
          if (svgContent) {
            const imageData = generateIconMarkerImage(svgContent, props.color as string);
            mlMap.addImage(imageId, imageData, { pixelRatio: 2 });
            registeredIconImages.add(imageId);
          }
        }
      }
    }
  }

  // Add sources
  for (const [sourceName, sourceData] of Object.entries(mapState.sources)) {
    if (sourceData && !mlMap.getSource(sourceName)) {
      mlMap.addSource(sourceName, sourceData as any);
    }
  }

  // Add layers in order (they're already ordered: polygons -> routes -> markers)
  // Skip polygon-labels symbol layer — we use HTML markers instead for pill shape
  for (const layer of mapState.layers) {
    if (layer.id === "polygon-labels") continue;
    if (!mlMap.getLayer(layer.id)) {
      mlMap.addLayer(layer as any);
    }
  }

  // Add polygon label pills as HTML markers (CSS border-radius guarantees pill shape)
  addPolygonLabelMarkers(mapState);
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
  const isCalculatedRoute = !!(props.distance && props.travelTime);

  let html = `<div class="dm-popup">`;

  if (!isCalculatedRoute) {
    html += `<div class="dm-popup-category">Custom path</div>`;
  }

  html += `<h3 class="dm-popup-title">${name}</h3>`;

  if (isCalculatedRoute) {
    const stats: string[] = [];
    stats.push(`Distance: ${escapeHtml(String(props.distance))}`);
    stats.push(`Time: ${escapeHtml(String(props.travelTime))}`);
    if (props.trafficDelayInSeconds && Number(props.trafficDelayInSeconds) > 0) {
      stats.push(
        `<span class="dm-traffic-delay">+${escapeHtml(String(props.trafficDelay))} delay</span>`
      );
    }

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

  const skipKeys = new Set([
    "id",
    "label",
    "name",
    "color",
    "fillColor",
    "strokeColor",
    "strokeWidth",
    "fillOpacity",
    "strokeOpacity",
  ]);
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

// ─── Traffic Incident Popup ──────────────────────────────────────────────────

const MAGNITUDE_STYLES: Record<number, { label: string; color: string }> = {
  0: { label: "Unknown", color: "#6b7280" },
  1: { label: "Minor", color: "#ca8a04" },
  2: { label: "Moderate", color: "#ea580c" },
  3: { label: "Major", color: "#dc2626" },
  4: { label: "Indefinite", color: "#991b1b" },
};

const ICON_WARNING = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;
const ICON_LOCATION = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>`;
const ICON_CLOCK = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;

function buildIncidentPopupHtml(props: Record<string, unknown>): string {
  const descriptions: string[] = [];
  for (let i = 0; ; i++) {
    const desc = props[`description_${i}`] as string | undefined;
    if (!desc) break;
    descriptions.push(desc);
  }

  const magnitude = Number(props.magnitude_of_delay ?? -1);
  const magnitudeStyle = MAGNITUDE_STYLES[magnitude];
  const delay = props.delay ? Number(props.delay) : 0;
  const roadCategory = (props.road_category as string) || "";
  const roadSubcategory = (props.road_subcategory as string) || "";

  const title = descriptions[0] || "Traffic Incident";
  const subtitle = descriptions.length > 1 ? descriptions.slice(1).join(", ") : "";

  let html = `<div class="incident-popup">`;

  html += `<div class="incident-popup-title">${escapeHtml(title)}</div>`;

  if (magnitudeStyle) {
    html += `<div class="incident-popup-row">`;
    html += `<span class="incident-popup-icon" style="color:${magnitudeStyle.color}">${ICON_WARNING}</span>`;
    html += `<span style="color:${magnitudeStyle.color};font-weight:600">${magnitudeStyle.label}</span>`;
    html += `</div>`;
  }

  const road = [roadCategory, roadSubcategory].filter(Boolean).join(" \u00b7 ");
  if (road) {
    html += `<div class="incident-popup-row">`;
    html += `<span class="incident-popup-icon">${ICON_LOCATION}</span>`;
    html += `<span>${escapeHtml(subtitle ? `${subtitle} \u00b7 ${road}` : road)}</span>`;
    html += `</div>`;
  } else if (subtitle) {
    html += `<div class="incident-popup-row">`;
    html += `<span class="incident-popup-icon">${ICON_LOCATION}</span>`;
    html += `<span>${escapeHtml(subtitle)}</span>`;
    html += `</div>`;
  }

  if (delay > 0) {
    const mins = Math.round(delay / 60);
    const delayText = mins > 0 ? `${mins} min delay` : `${delay}s delay`;
    html += `<div class="incident-popup-row">`;
    html += `<span class="incident-popup-icon">${ICON_CLOCK}</span>`;
    html += `<span>${escapeHtml(delayText)}</span>`;
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

  // Make markers clickable (dot, icon, and pin layers)
  const markerLayers = ["marker-dot", "marker-icon", "marker-pin"];
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

  // Remove polygon label HTML markers
  clearPolygonLabelMarkers();

  const mlMap = map.mapLibreMap;

  // Remove all custom layers (identified by source name patterns)
  const customSources = [
    "markers",
    "routes",
    "routeLabels",
    "polygons",
    "polygonCenters",
    "route-labels",
  ];
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

  // Remove registered icon marker images
  for (const imageId of registeredIconImages) {
    try {
      if (mlMap.hasImage(imageId)) mlMap.removeImage(imageId);
    } catch {
      /* image may not exist */
    }
  }
  registeredIconImages.clear();
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
  if (trafficIncidentsModule) {
    trafficIncidentsModule.events.off("click");
    trafficIncidentsModule.events.off("hover");
    trafficIncidentsModule.setVisible(false);
    trafficIncidentsModule = null;
  }
  if (map) {
    clearMap();
  }
  return {};
};

app.connect();

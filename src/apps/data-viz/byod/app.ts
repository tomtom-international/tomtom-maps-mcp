/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 *
 * BYOD Data Visualization App
 * Renders user-provided GeoJSON data on a TomTom basemap with support for:
 *   - markers (circle layer)
 *   - heatmap (heatmap layer)
 *   - clusters (clustered GeoJSON source)
 *   - line (line layer)
 *   - fill (fill + outline layer)
 *   - choropleth (data-driven fill + legend)
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { TomTomMap } from "@tomtom-org/maps-sdk/map";
import { reverseGeocode } from "@tomtom-org/maps-sdk/services";
import { Popup } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import type { BBox } from "@tomtom-org/maps-sdk/core";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  LayerSpecification,
  FilterSpecification,
} from "maplibre-gl";
import { createMapControls } from "../../shared/map-controls";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import { injectPoiPopupStyles } from "../../shared/poi-popup";
import "./styles.css";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LayerConfig {
  type: "markers" | "heatmap" | "clusters" | "line" | "fill" | "choropleth";
  color_property?: string;
  color_scale?: [string, string];
  size_property?: string;
  label_property?: string;
  popup_fields?: string[];
  cluster_radius?: number;
  heatmap_weight?: string;
  heatmap_intensity?: number;
  line_width?: number;
  fill_opacity?: number;
  filter_property?: string;
  filter_values?: (string | number)[];
}

interface VizData {
  geojson: FeatureCollection;
  layers: LayerConfig[];
  title?: string;
  bbox?: BBox | null;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let map: TomTomMap | null = null;
let mapReady = false;
let mapInitPromise: Promise<void> | null = null;
let activePopup: Popup | null = null;
let currentVizData: VizData | null = null;
const addedSources: string[] = [];
const addedLayers: string[] = [];

const app = new App({ name: "TomTom Data Viz", version: "1.0.0" });

// Reusable DOM element for HTML escaping
const _escapeDiv = document.createElement("div");
function escapeHtml(text: string): string {
  _escapeDiv.textContent = text;
  return _escapeDiv.innerHTML;
}

// ---------------------------------------------------------------------------
// Reverse geocode cache — keyed by "lng,lat" rounded to 5 decimals
// ---------------------------------------------------------------------------

const reverseGeocodeCache = new Map<string, string>();

function coordKey(lng: number, lat: number): string {
  return `${lng.toFixed(5)},${lat.toFixed(5)}`;
}

async function enrichPopupWithAddress(lngLat: [number, number], popup: Popup): Promise<void> {
  const key = coordKey(lngLat[0], lngLat[1]);

  // Already cached
  const cached = reverseGeocodeCache.get(key);
  if (cached) {
    appendAddressToPopup(popup, cached);
    return;
  }

  try {
    const result = await reverseGeocode({ position: lngLat });
    const address = (result as { properties?: { address?: { freeformAddress?: string } } })
      ?.properties?.address?.freeformAddress;
    if (address) {
      reverseGeocodeCache.set(key, address);
      appendAddressToPopup(popup, address);
    }
  } catch {
    // Silently fail — enrichment is best-effort
  }
}

function appendAddressToPopup(popup: Popup, address: string): void {
  const el = popup.getElement();
  if (!el) return;
  const placeholder = el.querySelector(".viz-address-placeholder");
  if (placeholder) {
    placeholder.innerHTML = `
      <div class="viz-popup-row viz-address-row">
        <span class="viz-popup-key">address</span>
        <span class="viz-popup-value">${escapeHtml(address)}</span>
      </div>`;
  }
}

// ---------------------------------------------------------------------------
// Map initialization
// ---------------------------------------------------------------------------

async function initializeMap(): Promise<void> {
  // Deduplicate: if already initializing, wait for the same promise
  if (mapInitPromise) return mapInitPromise;
  mapInitPromise = doInitializeMap();
  return mapInitPromise;
}

async function doInitializeMap(): Promise<void> {
  await ensureTomTomConfigured(app);
  injectPoiPopupStyles();

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [0, 20], zoom: 2 },
  });

  await createMapControls(map, {
    position: "top-right",
    showTrafficToggle: true,
    showThemeToggle: true,
    onThemeChange: () => {
      if (currentVizData && map && mapReady) {
        renderVisualization(currentVizData);
      }
    },
  });

  await new Promise<void>((resolve) => {
    if (map!.mapLibreMap.loaded()) {
      mapReady = true;
      resolve();
    } else {
      map!.mapLibreMap.on("load", () => {
        mapReady = true;
        resolve();
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

function clearLayers(): void {
  if (!map) return;
  const ml = map.mapLibreMap;

  // Remove layers first (reverse order)
  for (let i = addedLayers.length - 1; i >= 0; i--) {
    if (ml.getLayer(addedLayers[i])) {
      ml.removeLayer(addedLayers[i]);
    }
  }
  addedLayers.length = 0;

  // Remove sources
  for (const src of addedSources) {
    if (ml.getSource(src)) {
      ml.removeSource(src);
    }
  }
  addedSources.length = 0;

  // Remove overlays
  document.getElementById("viz-title-overlay")?.remove();
  document.getElementById("viz-legend")?.remove();

  // Close popup
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
}

// ---------------------------------------------------------------------------
// Feature filtering
// ---------------------------------------------------------------------------

function filterFeatures(fc: FeatureCollection, config: LayerConfig): FeatureCollection {
  if (!config.filter_property || !config.filter_values?.length) return fc;

  const prop = config.filter_property;
  const values = new Set(config.filter_values.map(String));

  return {
    type: "FeatureCollection",
    features: fc.features.filter((f) => {
      const val = f.properties?.[prop];
      return val !== undefined && values.has(String(val));
    }),
  };
}

// ---------------------------------------------------------------------------
// Property range computation (for data-driven styling)
// ---------------------------------------------------------------------------

function computePropertyRange(
  fc: FeatureCollection,
  prop: string
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  let found = false;

  for (const f of fc.features) {
    const val = f.properties?.[prop];
    if (typeof val === "number" && isFinite(val)) {
      found = true;
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }

  return found ? { min, max } : null;
}

// ---------------------------------------------------------------------------
// Popup builder
// ---------------------------------------------------------------------------

function buildPopupHtml(
  props: Record<string, unknown>,
  popupFields?: string[],
  labelProperty?: string
): string {
  const title = labelProperty && props[labelProperty] ? String(props[labelProperty]) : null;

  const fields = popupFields || Object.keys(props);

  let html = `<div class="viz-popup">`;

  if (title) {
    html += `<div class="viz-popup-title">${escapeHtml(title)}</div>`;
  }

  for (const key of fields) {
    if (key === labelProperty && title) continue; // Skip title field from rows
    const val = props[key];
    if (val === null || val === undefined) continue;

    const displayVal = typeof val === "object" ? JSON.stringify(val) : String(val);
    html += `<div class="viz-popup-row">`;
    html += `<span class="viz-popup-key">${escapeHtml(key)}</span>`;
    html += `<span class="viz-popup-value">${escapeHtml(displayVal)}</span>`;
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

function showPopup(
  ml: MapLibreMap,
  lngLat: [number, number],
  props: Record<string, unknown>,
  config: LayerConfig,
  geometryType?: string
): void {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }

  // Check if feature already has address-like properties
  const hasAddress =
    props.address ||
    props.freeformAddress ||
    props.street ||
    props.streetAddress ||
    props.full_address;

  // Add placeholder for reverse geocode enrichment on Point features
  const needsEnrichment =
    !hasAddress && (geometryType === "Point" || geometryType === "MultiPoint");

  let html = buildPopupHtml(props, config.popup_fields, config.label_property);

  if (needsEnrichment) {
    // Insert placeholder before closing </div> of .viz-popup
    const key = coordKey(lngLat[0], lngLat[1]);
    const cached = reverseGeocodeCache.get(key);
    if (cached) {
      html = html.replace(
        /<\/div>$/,
        `<div class="viz-popup-row viz-address-row">` +
          `<span class="viz-popup-key">address</span>` +
          `<span class="viz-popup-value">${escapeHtml(cached)}</span>` +
          `</div></div>`
      );
    } else {
      html = html.replace(
        /<\/div>$/,
        `<div class="viz-address-placeholder">` +
          `<div class="viz-popup-row viz-address-loading">` +
          `<span class="viz-popup-key">address</span>` +
          `<span class="viz-popup-value">loading...</span>` +
          `</div></div></div>`
      );
    }
  }

  activePopup = new Popup({
    closeButton: true,
    maxWidth: "360px",
    className: "poi-popup-container viz-popup-container",
    offset: [0, -10],
  })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(ml);

  activePopup.on("close", () => {
    activePopup = null;
  });

  // Trigger async enrichment if needed
  if (needsEnrichment && !reverseGeocodeCache.has(coordKey(lngLat[0], lngLat[1]))) {
    enrichPopupWithAddress(lngLat, activePopup);
  }
}

// ---------------------------------------------------------------------------
// Click handler setup
// ---------------------------------------------------------------------------

function setupClickHandler(ml: MapLibreMap, layerId: string, config: LayerConfig): void {
  ml.on("click", layerId, (e) => {
    if (!e.features?.length) return;
    const feature = e.features[0];
    const props = feature.properties || {};
    const lngLat: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    const geomType = feature.geometry?.type;
    showPopup(ml, lngLat, props, config, geomType);
  });

  ml.on("mouseenter", layerId, () => {
    ml.getCanvas().style.cursor = "pointer";
  });

  ml.on("mouseleave", layerId, () => {
    ml.getCanvas().style.cursor = "";
  });
}

// ---------------------------------------------------------------------------
// Layer renderers
// ---------------------------------------------------------------------------

let layerCounter = 0;

function nextId(prefix: string): string {
  return `${prefix}-${layerCounter++}`;
}

/**
 * Markers — circle layer with optional data-driven color and size
 */
function addMarkersLayer(ml: MapLibreMap, data: FeatureCollection, config: LayerConfig): void {
  const sourceId = nextId("viz-markers-src");
  const layerId = nextId("viz-markers");

  ml.addSource(sourceId, { type: "geojson", data });
  addedSources.push(sourceId);

  // Build paint expressions
  const paint: NonNullable<Extract<LayerSpecification, { type: "circle" }>["paint"]> = {
    "circle-radius": 6,
    "circle-color": "#3b82f6",
    "circle-stroke-width": 1,
    "circle-stroke-color": "#ffffff",
    "circle-opacity": 0.85,
  };

  if (config.color_property) {
    const range = computePropertyRange(data, config.color_property);
    const [minColor, maxColor] = config.color_scale || ["#2196F3", "#F44336"];
    if (range && range.min !== range.max) {
      paint["circle-color"] = [
        "interpolate",
        ["linear"],
        ["get", config.color_property],
        range.min,
        minColor,
        range.max,
        maxColor,
      ];
    }
  }

  if (config.size_property) {
    const range = computePropertyRange(data, config.size_property);
    if (range && range.min !== range.max) {
      paint["circle-radius"] = [
        "interpolate",
        ["linear"],
        ["get", config.size_property],
        range.min,
        4,
        range.max,
        20,
      ];
    }
  }

  ml.addLayer({
    id: layerId,
    type: "circle",
    source: sourceId,
    filter: ["any", ["==", ["geometry-type"], "Point"], ["==", ["geometry-type"], "MultiPoint"]],
    paint,
  });
  addedLayers.push(layerId);

  setupClickHandler(ml, layerId, config);
}

/**
 * Heatmap — density visualization for point data
 */
function addHeatmapLayer(ml: MapLibreMap, data: FeatureCollection, config: LayerConfig): void {
  const sourceId = nextId("viz-heat-src");
  const layerId = nextId("viz-heat");

  ml.addSource(sourceId, { type: "geojson", data });
  addedSources.push(sourceId);

  const intensity = config.heatmap_intensity ?? 1;

  const paint: NonNullable<Extract<LayerSpecification, { type: "heatmap" }>["paint"]> = {
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, intensity, 9, intensity * 3],
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 15, 5, 20, 15, 30],
    "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 9, 0.6, 15, 0.3],
  };
  paint["heatmap-color"] = [
    "interpolate",
    ["linear"],
    ["heatmap-density"],
    0,
    "rgba(0,0,255,0)",
    0.1,
    "royalblue",
    0.3,
    "cyan",
    0.5,
    "lime",
    0.7,
    "yellow",
    1,
    "red",
  ];

  if (config.heatmap_weight) {
    const range = computePropertyRange(data, config.heatmap_weight);
    if (range && range.min !== range.max) {
      paint["heatmap-weight"] = [
        "interpolate",
        ["linear"],
        ["get", config.heatmap_weight],
        range.min,
        0,
        range.max,
        1,
      ];
    }
  }

  ml.addLayer({
    id: layerId,
    type: "heatmap",
    source: sourceId,
    paint,
  });
  addedLayers.push(layerId);
}

/**
 * Clusters — aggregated point markers with click-to-zoom
 */
function addClustersLayer(ml: MapLibreMap, data: FeatureCollection, config: LayerConfig): void {
  const sourceId = nextId("viz-cluster-src");
  const clusterId = nextId("viz-cluster-circles");
  const countId = nextId("viz-cluster-count");
  const unclusteredId = nextId("viz-cluster-unclustered");

  ml.addSource(sourceId, {
    type: "geojson",
    data,
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: config.cluster_radius ?? 50,
  });
  addedSources.push(sourceId);

  // Cluster circles
  ml.addLayer({
    id: clusterId,
    type: "circle",
    source: sourceId,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "#51bbd6",
        10,
        "#f1f075",
        50,
        "#f28cb1",
        100,
        "#e55e5e",
      ],
      "circle-radius": ["step", ["get", "point_count"], 15, 10, 20, 50, 25, 100, 30],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
    },
  });
  addedLayers.push(clusterId);

  // Cluster count labels
  ml.addLayer({
    id: countId,
    type: "symbol",
    source: sourceId,
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-size": 12,
    },
    paint: {
      "text-color": "#333333",
    },
  });
  addedLayers.push(countId);

  // Unclustered individual points
  ml.addLayer({
    id: unclusteredId,
    type: "circle",
    source: sourceId,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": "#3b82f6",
      "circle-radius": 6,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
    },
  });
  addedLayers.push(unclusteredId);

  // Click on cluster → zoom in
  ml.on("click", clusterId, (e) => {
    const features = ml.queryRenderedFeatures(e.point, { layers: [clusterId] });
    if (!features.length) return;
    const clusteredId = features[0].properties?.cluster_id;
    const source = ml.getSource(sourceId) as GeoJSONSource;
    source
      .getClusterExpansionZoom(clusteredId)
      .then((zoom: number) => {
        const geom = features[0].geometry as { type: "Point"; coordinates: [number, number] };
        ml.easeTo({ center: geom.coordinates, zoom });
      })
      .catch(() => {
        /* ignore */
      });
  });

  // Click on unclustered point → popup
  setupClickHandler(ml, unclusteredId, config);

  // Cursors
  ml.on("mouseenter", clusterId, () => {
    ml.getCanvas().style.cursor = "pointer";
  });
  ml.on("mouseleave", clusterId, () => {
    ml.getCanvas().style.cursor = "";
  });
}

/**
 * Line — for LineString/MultiLineString geometries
 */
function addLineLayer(ml: MapLibreMap, data: FeatureCollection, config: LayerConfig): void {
  const sourceId = nextId("viz-line-src");
  const layerId = nextId("viz-line");

  ml.addSource(sourceId, { type: "geojson", data });
  addedSources.push(sourceId);

  const paint: NonNullable<Extract<LayerSpecification, { type: "line" }>["paint"]> = {
    "line-color": "#3b82f6",
    "line-width": config.line_width ?? 2,
    "line-opacity": 0.85,
  };

  if (config.color_property) {
    const range = computePropertyRange(data, config.color_property);
    const [minColor, maxColor] = config.color_scale || ["#2196F3", "#F44336"];
    if (range && range.min !== range.max) {
      paint["line-color"] = [
        "interpolate",
        ["linear"],
        ["get", config.color_property],
        range.min,
        minColor,
        range.max,
        maxColor,
      ];
    }
  }

  if (config.size_property) {
    const range = computePropertyRange(data, config.size_property);
    if (range && range.min !== range.max) {
      paint["line-width"] = [
        "interpolate",
        ["linear"],
        ["get", config.size_property],
        range.min,
        1,
        range.max,
        8,
      ];
    }
  }

  ml.addLayer({
    id: layerId,
    type: "line",
    source: sourceId,
    filter: [
      "any",
      ["==", ["geometry-type"], "LineString"],
      ["==", ["geometry-type"], "MultiLineString"],
    ],
    layout: { "line-cap": "round", "line-join": "round" },
    paint,
  });
  addedLayers.push(layerId);

  setupClickHandler(ml, layerId, config);
}

/**
 * Fill — solid polygon fills
 */
function addFillLayer(ml: MapLibreMap, data: FeatureCollection, config: LayerConfig): void {
  const sourceId = nextId("viz-fill-src");
  const fillId = nextId("viz-fill");
  const outlineId = nextId("viz-fill-outline");

  ml.addSource(sourceId, { type: "geojson", data });
  addedSources.push(sourceId);

  const opacity = config.fill_opacity ?? 0.7;

  const paint: NonNullable<Extract<LayerSpecification, { type: "fill" }>["paint"]> = {
    "fill-color": "#3b82f6",
    "fill-opacity": opacity,
  };

  if (config.color_property) {
    const range = computePropertyRange(data, config.color_property);
    const [minColor, maxColor] = config.color_scale || ["#2196F3", "#F44336"];
    if (range && range.min !== range.max) {
      paint["fill-color"] = [
        "interpolate",
        ["linear"],
        ["get", config.color_property],
        range.min,
        minColor,
        range.max,
        maxColor,
      ];
    }
  }

  const polygonFilter: FilterSpecification = [
    "any",
    ["==", ["geometry-type"], "Polygon"],
    ["==", ["geometry-type"], "MultiPolygon"],
  ];

  ml.addLayer({
    id: fillId,
    type: "fill",
    source: sourceId,
    filter: polygonFilter,
    paint,
  });
  addedLayers.push(fillId);

  // Outline
  ml.addLayer({
    id: outlineId,
    type: "line",
    source: sourceId,
    filter: polygonFilter,
    paint: {
      "line-color": "#374151",
      "line-width": 1,
      "line-opacity": 0.6,
    },
  });
  addedLayers.push(outlineId);

  setupClickHandler(ml, fillId, config);
}

/**
 * Choropleth — data-driven polygon coloring with legend
 */
function addChoroplethLayer(ml: MapLibreMap, data: FeatureCollection, config: LayerConfig): void {
  const sourceId = nextId("viz-choro-src");
  const fillId = nextId("viz-choro-fill");
  const outlineId = nextId("viz-choro-outline");

  ml.addSource(sourceId, { type: "geojson", data });
  addedSources.push(sourceId);

  const colorProp = config.color_property!;
  const [minColor, maxColor] = config.color_scale || ["#2196F3", "#F44336"];
  const opacity = config.fill_opacity ?? 0.7;
  const range = computePropertyRange(data, colorProp);

  const paint: NonNullable<Extract<LayerSpecification, { type: "fill" }>["paint"]> = {
    "fill-opacity": opacity,
  };

  if (range && range.min !== range.max) {
    paint["fill-color"] = [
      "interpolate",
      ["linear"],
      ["get", colorProp],
      range.min,
      minColor,
      range.max,
      maxColor,
    ];
  } else {
    paint["fill-color"] = minColor;
  }

  const polygonFilter: FilterSpecification = [
    "any",
    ["==", ["geometry-type"], "Polygon"],
    ["==", ["geometry-type"], "MultiPolygon"],
  ];

  ml.addLayer({
    id: fillId,
    type: "fill",
    source: sourceId,
    filter: polygonFilter,
    paint,
  });
  addedLayers.push(fillId);

  ml.addLayer({
    id: outlineId,
    type: "line",
    source: sourceId,
    filter: polygonFilter,
    paint: {
      "line-color": "#374151",
      "line-width": 1.5,
      "line-opacity": 0.7,
    },
  });
  addedLayers.push(outlineId);

  setupClickHandler(ml, fillId, config);

  // Add legend
  if (range) {
    addChoroplethLegend(colorProp, range.min, range.max, minColor, maxColor);
  }
}

// ---------------------------------------------------------------------------
// Legend for choropleth
// ---------------------------------------------------------------------------

function addChoroplethLegend(
  property: string,
  min: number,
  max: number,
  minColor: string,
  maxColor: string
): void {
  const existing = document.getElementById("viz-legend");
  if (existing) existing.remove();

  const legend = document.createElement("div");
  legend.id = "viz-legend";
  legend.className = "viz-legend";
  legend.innerHTML = `
    <div class="viz-legend-title">${escapeHtml(property)}</div>
    <div class="viz-legend-bar" style="background: linear-gradient(to right, ${minColor}, ${maxColor})"></div>
    <div class="viz-legend-labels">
      <span>${formatNumber(min)}</span>
      <span>${formatNumber(max)}</span>
    </div>
  `;

  const mapContainer = document.getElementById("sdk-map");
  if (mapContainer) mapContainer.appendChild(legend);
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// ---------------------------------------------------------------------------
// Title overlay
// ---------------------------------------------------------------------------

function addTitleOverlay(title: string): void {
  const existing = document.getElementById("viz-title-overlay");
  if (existing) existing.remove();

  const el = document.createElement("div");
  el.id = "viz-title-overlay";
  el.className = "viz-title";
  el.textContent = title;

  const mapContainer = document.getElementById("sdk-map");
  if (mapContainer) mapContainer.appendChild(el);
}

// ---------------------------------------------------------------------------
// Main render orchestrator
// ---------------------------------------------------------------------------

function renderVisualization(vizData: VizData): void {
  if (!map || !mapReady) return;

  const ml = map.mapLibreMap;

  // Store for restore after theme change
  currentVizData = vizData;

  // Clear previous layers
  clearLayers();
  layerCounter = 0;

  const { geojson, layers, title, bbox } = vizData;

  // Add title overlay
  if (title) addTitleOverlay(title);

  // Render each layer
  for (const layerConfig of layers) {
    const data = filterFeatures(geojson, layerConfig);
    if (data.features.length === 0) continue;

    switch (layerConfig.type) {
      case "markers":
        addMarkersLayer(ml, data, layerConfig);
        break;
      case "heatmap":
        addHeatmapLayer(ml, data, layerConfig);
        break;
      case "clusters":
        addClustersLayer(ml, data, layerConfig);
        break;
      case "line":
        addLineLayer(ml, data, layerConfig);
        break;
      case "fill":
        addFillLayer(ml, data, layerConfig);
        break;
      case "choropleth":
        addChoroplethLayer(ml, data, layerConfig);
        break;
    }
  }

  // Fit to data bounds
  if (bbox) {
    ml.fitBounds(
      [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      { padding: 50, maxZoom: 15, duration: 1500 }
    );
  }
}

// ---------------------------------------------------------------------------
// MCP App lifecycle
// ---------------------------------------------------------------------------

app.ontoolinput = async (params) => {
  const args = (params.arguments || {}) as Record<string, unknown>;
  const showUI = args.show_ui !== false;

  if (!showUI) return;

  showMapUI();
  await initializeMap();
};

app.ontoolresult = async (r) => {
  if (r.isError) {
    showErrorUI();
    return;
  }

  try {
    if (r.content[0]?.type !== "text") return;
    const agentResponse = JSON.parse(r.content[0].text) as unknown;

    if (!shouldShowUI(agentResponse)) {
      hideMapUI();
      return;
    }

    showMapUI();
    await initializeMap(); // Deduplicates & waits for full map load

    // Fetch full data from vizCache
    const vizData = (await extractFullData(app, agentResponse)) as VizData;

    if (!vizData?.geojson || !vizData?.layers) {
      console.error("Data viz: extractFullData returned incomplete data", {
        hasGeojson: !!vizData?.geojson,
        hasLayers: !!vizData?.layers,
        keys: vizData ? Object.keys(vizData) : [],
      });
      return;
    }

    renderVisualization(vizData);
  } catch (e) {
    console.error("Error rendering data visualization:", e);
  }
};

app.onteardown = async () => {
  clearLayers();
  return {};
};

app.connect();

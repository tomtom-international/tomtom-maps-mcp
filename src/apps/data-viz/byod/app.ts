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
import type { BBox } from "@tomtom-org/maps-sdk/core";
import {
  type CustomGeoJSONLayerSpec,
  CustomGeoJSONModule,
  type CustomGeoJSONModuleConfig,
  MAP_REGULAR_FONT,
  TomTomMap,
} from "@tomtom-org/maps-sdk/map";
import { reverseGeocode } from "@tomtom-org/maps-sdk/services";
import type { FeatureCollection, Geometry } from "geojson";
import type {
  CircleLayerSpecification,
  FillLayerSpecification,
  FilterSpecification,
  GeoJSONSource,
  HeatmapLayerSpecification,
  LineLayerSpecification,
  Map as MapLibreMap,
  Source,
} from "maplibre-gl";
import { Popup } from "maplibre-gl";
import { trackAppData } from "../../shared/appData";
import { createMapControls } from "../../shared/map-controls";
import { injectPoiPopupStyles } from "../../shared/poi-popup";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import { hideMapUI, shouldShowUI, showErrorUI, showMapUI } from "../../shared/ui-visibility";
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
let vizModule: CustomGeoJSONModule | null = null;
let vizSignature = "";
const layerConfigBySource = new Map<string, LayerConfig>();

const app = new App({ name: "TomTom Data Viz", version: "1.0.0" });
const appData = trackAppData(app, { refetch: true, tool: "tomtom-data-viz" });

// Reusable DOM element for HTML escaping
const _escapeDiv = document.createElement("div");
function escapeHtml(text: string): string {
  _escapeDiv.textContent = text;
  return _escapeDiv.innerHTML;
}

// Keyed by "lng,lat" rounded to 5 decimals
const reverseGeocodeCache = new Map<string, string>();

function coordKey(lng: number, lat: number): string {
  return `${lng.toFixed(5)},${lat.toFixed(5)}`;
}

async function enrichPopupWithAddress(lngLat: [number, number], popup: Popup): Promise<void> {
  const key = coordKey(lngLat[0], lngLat[1]);

  const cached = reverseGeocodeCache.get(key);
  if (cached) {
    appendAddressToPopup(popup, cached);
    return;
  }

  try {
    const result = await reverseGeocode({ position: lngLat });
    // Where no address is near, the SDK returns the feature without properties, though its type has them
    const address = result.properties?.address?.freeformAddress;
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

function clearOverlays(): void {
  document.getElementById("viz-title-overlay")?.remove();
  document.getElementById("viz-legend")?.remove();
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
}

/**
 * A custom GeoJSON module keeps the sources it was created with. A result
 * whose layers differ drops the map, and the next one builds a module for them.
 * MapLibre's remove() can take the container with it.
 */
function discardMap(): void {
  clearOverlays();
  vizModule = null;
  vizSignature = "";
  mapReady = false;
  mapInitPromise = null;
  map?.mapLibreMap.remove();
  map = null;
  if (!document.getElementById("sdk-map")) {
    const container = document.createElement("div");
    container.id = "sdk-map";
    document.body.appendChild(container);
  }
}

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

function computePropertyRange(
  fc: FeatureCollection,
  prop: string
): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  let found = false;

  for (const f of fc.features) {
    const val = f.properties?.[prop];
    if (typeof val === "number" && Number.isFinite(val)) {
      found = true;
      if (val < min) min = val;
      if (val > max) max = val;
    }
  }

  return found ? { min, max } : null;
}

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

  if (needsEnrichment && !reverseGeocodeCache.has(coordKey(lngLat[0], lngLat[1]))) {
    enrichPopupWithAddress(lngLat, activePopup);
  }
}

const POINT_FILTER: FilterSpecification = [
  "any",
  ["==", ["geometry-type"], "Point"],
  ["==", ["geometry-type"], "MultiPoint"],
];
const LINE_FILTER: FilterSpecification = [
  "any",
  ["==", ["geometry-type"], "LineString"],
  ["==", ["geometry-type"], "MultiLineString"],
];
const POLYGON_FILTER: FilterSpecification = [
  "any",
  ["==", ["geometry-type"], "Polygon"],
  ["==", ["geometry-type"], "MultiPolygon"],
];

/** Lines and areas stay under the map's labels. Points stay on top. */
const UNDER_LABELS = "lowestLabel" as const;

interface DrawableLayer {
  name: string;
  config: LayerConfig;
  data: FeatureCollection;
}

function layersFor(data: FeatureCollection, config: LayerConfig): CustomGeoJSONLayerSpec[] {
  const scale = config.color_scale ?? ["#2196F3", "#F44336"];
  switch (config.type) {
    case "markers":
      return [markerLayer(data, config, scale)];
    case "heatmap":
      return [heatmapLayer(data, config)];
    case "clusters":
      return clusterLayers();
    case "line":
      return [lineLayer(data, config, scale)];
    case "fill":
      return areaLayers(data, config, scale, config.fill_opacity ?? 0.7, 1, 0.6);
    case "choropleth":
      return choroplethLayers(data, config, scale);
  }
}

function markerLayer(
  data: FeatureCollection,
  config: LayerConfig,
  scale: [string, string]
): CustomGeoJSONLayerSpec {
  const paint: NonNullable<CircleLayerSpecification["paint"]> = {
    "circle-radius": 6,
    "circle-color": "#3b82f6",
    "circle-stroke-width": 1,
    "circle-stroke-color": "#ffffff",
    "circle-opacity": 0.85,
  };
  if (config.color_property) {
    const range = computePropertyRange(data, config.color_property);
    if (range && range.min !== range.max) {
      paint["circle-color"] = [
        "interpolate",
        ["linear"],
        ["get", config.color_property],
        range.min,
        scale[0],
        range.max,
        scale[1],
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
  return { type: "circle", filter: POINT_FILTER, paint };
}

function heatmapLayer(data: FeatureCollection, config: LayerConfig): CustomGeoJSONLayerSpec {
  const intensity = config.heatmap_intensity ?? 1;
  const paint: NonNullable<HeatmapLayerSpecification["paint"]> = {
    "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, intensity, 9, intensity * 3],
    "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 15, 5, 20, 15, 30],
    "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.8, 9, 0.6, 15, 0.3],
    "heatmap-color": [
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
    ],
  };
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
  return { type: "heatmap", beforeLayerConfig: UNDER_LABELS, paint };
}

function clusterLayers(): CustomGeoJSONLayerSpec[] {
  return [
    {
      type: "circle",
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
    },
    {
      type: "symbol",
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": [MAP_REGULAR_FONT],
        "text-size": 12,
      },
      paint: { "text-color": "#333333" },
    },
    {
      type: "circle",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-color": "#3b82f6",
        "circle-radius": 6,
        "circle-stroke-width": 1,
        "circle-stroke-color": "#ffffff",
      },
    },
  ];
}

function lineLayer(
  data: FeatureCollection,
  config: LayerConfig,
  scale: [string, string]
): CustomGeoJSONLayerSpec {
  const paint: NonNullable<LineLayerSpecification["paint"]> = {
    "line-color": "#3b82f6",
    "line-width": config.line_width ?? 2,
    "line-opacity": 0.85,
  };
  if (config.color_property) {
    const range = computePropertyRange(data, config.color_property);
    if (range && range.min !== range.max) {
      paint["line-color"] = [
        "interpolate",
        ["linear"],
        ["get", config.color_property],
        range.min,
        scale[0],
        range.max,
        scale[1],
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
  return {
    type: "line",
    beforeLayerConfig: UNDER_LABELS,
    filter: LINE_FILTER,
    layout: { "line-cap": "round", "line-join": "round" },
    paint,
  };
}

function areaLayers(
  data: FeatureCollection,
  config: LayerConfig,
  scale: [string, string],
  opacity: number,
  outlineWidth: number,
  outlineOpacity: number
): CustomGeoJSONLayerSpec[] {
  const paint: NonNullable<FillLayerSpecification["paint"]> = {
    "fill-color": "#3b82f6",
    "fill-opacity": opacity,
  };
  if (config.color_property) {
    const range = computePropertyRange(data, config.color_property);
    if (range && range.min !== range.max) {
      paint["fill-color"] = [
        "interpolate",
        ["linear"],
        ["get", config.color_property],
        range.min,
        scale[0],
        range.max,
        scale[1],
      ];
    }
  }
  return [
    { type: "fill", beforeLayerConfig: UNDER_LABELS, filter: POLYGON_FILTER, paint },
    {
      type: "line",
      beforeLayerConfig: UNDER_LABELS,
      filter: POLYGON_FILTER,
      paint: {
        "line-color": "#374151",
        "line-width": outlineWidth,
        "line-opacity": outlineOpacity,
      },
    },
  ];
}

function choroplethLayers(
  data: FeatureCollection,
  config: LayerConfig,
  scale: [string, string]
): CustomGeoJSONLayerSpec[] {
  const colorProperty = config.color_property;
  const range = colorProperty ? computePropertyRange(data, colorProperty) : null;
  const layers = areaLayers(
    data,
    range ? config : { ...config, color_property: undefined },
    scale,
    config.fill_opacity ?? 0.7,
    1.5,
    0.7
  );
  const fill = layers[0];
  if (fill?.type === "fill" && (!range || range.min === range.max)) {
    fill.paint = { ...fill.paint, "fill-color": scale[0] };
  }
  if (range && colorProperty) {
    addChoroplethLegend(colorProperty, range.min, range.max, scale[0], scale[1]);
  }
  return layers;
}

function moduleConfig(layers: DrawableLayer[]): CustomGeoJSONModuleConfig {
  const sources: CustomGeoJSONModuleConfig["sources"] = {};
  for (const layer of layers) {
    sources[layer.name] = {
      ...(layer.config.type === "clusters"
        ? {
            cluster: {
              cluster: true,
              clusterMaxZoom: 14,
              clusterRadius: layer.config.cluster_radius ?? 50,
            },
          }
        : {}),
      layers: layersFor(layer.data, layer.config),
    };
  }
  return { sources };
}

function layerSignature(layers: DrawableLayer[]): string {
  return layers
    .map(({ config }) =>
      config.type === "clusters" ? `clusters:${config.cluster_radius ?? 50}` : config.type
    )
    .join(",");
}

function isGeoJSONSource(source: Source | undefined): source is GeoJSONSource {
  return source?.type === "geojson";
}

function zoomToCluster(
  sourceName: string,
  feature: { properties?: object | null; geometry: Geometry }
): boolean {
  const properties = feature.properties ?? {};
  if (!("cluster" in properties) || properties.cluster !== true || !map || !vizModule) return false;
  const clusterId = "cluster_id" in properties ? properties.cluster_id : undefined;
  const [lng, lat] = feature.geometry.type === "Point" ? feature.geometry.coordinates : [];
  const sourceId = vizModule.sourceAndLayerIDs[sourceName]?.sourceID;
  const source = sourceId ? map.mapLibreMap.getSource(sourceId) : undefined;
  if (
    typeof clusterId !== "number" ||
    !isGeoJSONSource(source) ||
    typeof lng !== "number" ||
    typeof lat !== "number"
  ) {
    return false;
  }
  source
    .getClusterExpansionZoom(clusterId)
    .then((zoom) => map?.mapLibreMap.easeTo({ center: [lng, lat], zoom }))
    .catch(() => undefined);
  return true;
}

function bindSource(module: CustomGeoJSONModule, sourceName: string): void {
  module.events[sourceName].on("click", (feature, lngLat) => {
    const config = layerConfigBySource.get(sourceName);
    if (!config || !map) return;
    if (config.type === "clusters" && zoomToCluster(sourceName, feature)) return;
    showPopup(
      map.mapLibreMap,
      [lngLat.lng, lngLat.lat],
      { ...(feature.properties ?? {}) },
      config,
      feature.geometry.type
    );
  });
}

function fitToBBox(bbox: BBox): void {
  map?.mapLibreMap.fitBounds(
    [
      [bbox[0], bbox[1]],
      [bbox[2], bbox[3]],
    ],
    { padding: 50, maxZoom: 15, duration: 1500 }
  );
}

function drawableLayers(vizData: VizData): DrawableLayer[] {
  const drawable: DrawableLayer[] = [];
  for (const config of vizData.layers) {
    const data = filterFeatures(vizData.geojson, config);
    if (data.features.length === 0) continue;
    drawable.push({ name: `layer-${drawable.length}`, config, data });
  }
  return drawable;
}

async function moduleFor(
  drawable: DrawableLayer[],
  signature: string
): Promise<CustomGeoJSONModule | null> {
  if (vizModule && signature !== vizSignature) {
    discardMap();
    await initializeMap();
  }
  if (!map) return null;
  const config = moduleConfig(drawable);
  if (!vizModule) {
    vizModule = await CustomGeoJSONModule.create(map, config);
    for (const name of layerConfigBySource.keys()) bindSource(vizModule, name);
  } else {
    vizModule.applyConfig(config);
  }
  vizSignature = signature;
  return vizModule;
}

async function renderVisualization(vizData: VizData): Promise<void> {
  if (!map || !mapReady) return;

  clearOverlays();
  if (vizData.title) addTitleOverlay(vizData.title);

  const drawable = drawableLayers(vizData);
  if (drawable.length === 0) {
    if (vizModule) await vizModule.clear();
    if (vizData.bbox) fitToBBox(vizData.bbox);
    return;
  }

  layerConfigBySource.clear();
  for (const layer of drawable) {
    if (layer.config.type !== "heatmap") layerConfigBySource.set(layer.name, layer.config);
  }

  const module = await moduleFor(drawable, layerSignature(drawable));
  if (!module) return;
  await Promise.all(drawable.map((layer) => module.show(layer.data, layer.name)));
  if (vizData.bbox) fitToBBox(vizData.bbox);
}

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

    if (!shouldShowUI(r)) {
      hideMapUI();
      return;
    }

    showMapUI();
    await initializeMap(); // Deduplicates & waits for full map load

    const vizData = await appData.load<VizData>(r, agentResponse);
    if (!vizData?.geojson || !vizData?.layers) {
      throw new Error("The data-viz data has no geojson or no layers");
    }

    await renderVisualization(vizData);
    appData.drawn();
  } catch (error) {
    console.error("Error rendering data visualization:", error);
    showErrorUI();
    appData.failed(error);
  }
};

app.onteardown = async () => {
  clearOverlays();
  if (vizModule) await vizModule.clear();
  return {};
};

app.connect();

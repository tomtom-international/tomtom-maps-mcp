/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import {
  type CustomGeoJSONImageSpec,
  type CustomGeoJSONLayerSpec,
  CustomGeoJSONModule,
  type CustomGeoJSONModuleConfig,
  TomTomMap,
  TrafficIncidentsModule,
} from "@tomtom-org/maps-sdk/map";
import type { FeatureCollection, Geometry } from "geojson";
import type { LayerSpecification } from "maplibre-gl";
import { Marker, Popup } from "maplibre-gl";
import type {
  GeoJSONFeatureCollection,
  MapState as ServerMapState,
} from "../../../services/map/dynamicMapTypes";
import { extractSvgPaths, POI_ICON_SVGS } from "../../../services/map/poiIconData";
import { trackAppData } from "../../shared/appData";
import { fitMapToBounds as fitToBounds } from "../../shared/fit-bounds";
import { buildIncidentPopupHtml } from "../../shared/incident-popup";
import { createMapControls } from "../../shared/map-controls";
import { escapeHtml, injectPoiPopupStyles } from "../../shared/poi-popup";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import { hideMapUI, shouldShowUI, showErrorUI, showMapUI } from "../../shared/ui-visibility";
import "./styles.css";

// Subset of MapLibre layer types used by the dynamic map tool
type LayerDefinition = Extract<LayerSpecification, { type: "circle" | "line" | "fill" | "symbol" }>;

type MapState = Omit<ServerMapState, "layers"> & { layers: LayerDefinition[] };

type DynamicSources = {
  polygons: FeatureCollection;
  routes: FeatureCollection;
  routeLabels: FeatureCollection;
  markers: FeatureCollection;
};

const CUSTOM_SOURCES = [
  "polygons",
  "routes",
  "routeLabels",
  "markers",
] as const satisfies ReadonlyArray<keyof DynamicSources>;

const GEOJSON_GEOMETRY_TYPES: ReadonlySet<string> = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
]);

// State tracking
let map: TomTomMap | null = null;
let mapReady = false;
let pendingData: MapState | null = null;
let activePopup: Popup | null = null;
let polygonLabelMarkers: Marker[] = [];
let trafficIncidentsModule: TrafficIncidentsModule | null = null;
let customModule: CustomGeoJSONModule<DynamicSources> | null = null;

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
    const path = new Path2D(p.d);
    ctx.fillStyle = "#ffffff";
    ctx.fill(path, p.fillRule);
  }

  ctx.restore();

  return ctx.getImageData(0, 0, w, h);
}

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
function addPolygonLabelMarkers(mapState: MapState): void {
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

const app = new App({ name: "TomTom Dynamic Map", version: "1.0.0" });
const appData = trackAppData(app);

async function initializeMap(mapState: MapState): Promise<void> {
  if (map) {
    await updateMapState(mapState);
    return;
  }

  injectPoiPopupStyles();

  await ensureTomTomConfigured(app);

  map = new TomTomMap({
    mapLibre: {
      container: "sdk-map",
      center: mapState.view.center,
      zoom: mapState.view.zoom,
    },
  });

  // Initialize traffic incidents module (hidden by default, user toggles via button)
  trafficIncidentsModule = await TrafficIncidentsModule.get(map, { visible: false });

  trafficIncidentsModule.events.on("click", (feature, lngLat) => {
    showPopup([lngLat.lng, lngLat.lat], buildIncidentPopupHtml(feature.properties), [0, -12]);
  });

  await createMapControls(map, {
    position: "top-right",
    showTrafficToggle: true,
    showIncidentsToggle: true,
    showThemeToggle: true,
    externalIncidentsModule: trafficIncidentsModule,
  });

  return new Promise<void>((resolve, reject) => {
    const onReady = () => {
      mapReady = true;
      void (async () => {
        try {
          await syncCustomLayers(mapState);
          fitMapToBounds(mapState.view.bounds);
          if (pendingData) {
            const next = pendingData;
            pendingData = null;
            await updateMapState(next);
          }
          resolve();
        } catch (error) {
          reject(error);
        }
      })();
    };

    if (map!.mapLibreMap.loaded()) {
      onReady();
    } else {
      map!.mapLibreMap.on("load", onReady);
    }
  });
}

type CoordinateGeometry = Exclude<Geometry, { type: "GeometryCollection" }>;

function isCoordinateGeometry(geometry: {
  type: string;
  coordinates: unknown;
}): geometry is CoordinateGeometry {
  return GEOJSON_GEOMETRY_TYPES.has(geometry.type) && Array.isArray(geometry.coordinates);
}

function featureCollection(data: GeoJSONFeatureCollection): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: data.features.flatMap((feature) =>
      isCoordinateGeometry(feature.geometry)
        ? [{ type: "Feature" as const, geometry: feature.geometry, properties: feature.properties }]
        : []
    ),
  };
}

/** Lines and areas stay under the map's labels. Markers and route summaries stay on top. */
function customLayer(layer: LayerDefinition, underLabels: boolean): CustomGeoJSONLayerSpec {
  const { source: _source, ...rest } = layer;
  return underLabels ? { ...rest, beforeLayerConfig: "lowestLabel" } : rest;
}

function layersFor(mapState: MapState, sourceName: keyof DynamicSources): CustomGeoJSONLayerSpec[] {
  const layers = mapState.layers.filter(
    (layer) => layer.source === sourceName && layer.id !== "polygon-labels"
  );
  if (layers.length === 0) {
    return [{ id: `${sourceName}-hidden`, type: "circle", layout: { visibility: "none" } }];
  }
  const underLabels = sourceName === "polygons" || sourceName === "routes";
  return layers.map((layer) => customLayer(layer, underLabels));
}

function imagesFor(mapState: MapState): Record<string, CustomGeoJSONImageSpec> | undefined {
  if (!mapState.layers.some((layer) => layer.source === "markers")) return undefined;

  const images: Record<string, CustomGeoJSONImageSpec> = {
    "pin-marker": { image: generatePinImage(), options: { pixelRatio: 2 } },
  };
  for (const feature of mapState.sources.markers?.data.features ?? []) {
    const props = feature.properties;
    if (props?.markerType !== "icon") continue;
    const iconKey = props.iconKey;
    const color = props.color;
    const imageId = props.iconImageId;
    if (typeof iconKey !== "string" || typeof color !== "string" || typeof imageId !== "string")
      continue;
    if (images[imageId]) continue;
    const svgContent = POI_ICON_SVGS[iconKey];
    if (!svgContent) continue;
    images[imageId] = {
      image: generateIconMarkerImage(svgContent, color),
      options: { pixelRatio: 2 },
    };
  }
  return images;
}

function customConfig(mapState: MapState): CustomGeoJSONModuleConfig<DynamicSources> {
  return {
    sources: {
      polygons: { layers: layersFor(mapState, "polygons") },
      routes: { layers: layersFor(mapState, "routes") },
      routeLabels: { layers: layersFor(mapState, "routeLabels") },
      markers: { layers: layersFor(mapState, "markers") },
    },
    images: imagesFor(mapState),
  };
}

function featureProps(properties: object | null): Record<string, unknown> {
  return properties ? { ...properties } : {};
}

function bindCustomEvents(module: CustomGeoJSONModule<DynamicSources>): void {
  module.events.markers.on("click", (feature, lngLat) => {
    const props = featureProps(feature.properties);
    const offset: [number, number] = props.markerType === "pin" ? [0, -20] : [0, -10];
    const coordinates: [number, number] =
      feature.geometry.type === "Point"
        ? [feature.geometry.coordinates[0], feature.geometry.coordinates[1]]
        : [lngLat.lng, lngLat.lat];
    showPopup(coordinates, buildMarkerPopupHtml(props), offset);
  });
  module.events.routes.on("click", (feature, lngLat) => {
    showPopup([lngLat.lng, lngLat.lat], buildRoutePopupHtml(featureProps(feature.properties)));
  });
  module.events.polygons.on("click", (feature, lngLat) => {
    showPopup([lngLat.lng, lngLat.lat], buildPolygonPopupHtml(featureProps(feature.properties)));
  });
}

/**
 * Draw the map's GeoJSON through one custom module. Source names stay fixed for the
 * map's life, so a style change restores the layers. Polygon pills stay HTML markers.
 */
async function syncCustomLayers(mapState: MapState): Promise<void> {
  if (!map) return;

  const config = customConfig(mapState);
  let module = customModule;
  if (!module) {
    module = await CustomGeoJSONModule.create<DynamicSources>(map, config);
    customModule = module;
    bindCustomEvents(module);
  } else {
    module.applyConfig(config);
  }

  await Promise.all(
    CUSTOM_SOURCES.map((name) => {
      const data = mapState.sources[name]?.data;
      if (!data || data.features.length === 0) return module.clear(name);
      return module.show(featureCollection(data), name);
    })
  );
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

  html += `<h3 class="dm-popup-title">${label}</h3>`;

  if (description) {
    html += `<div class="dm-popup-description">${escapeHtml(description)}</div>`;
  }

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

/**
 * Fit map view to the specified bounds
 */
function fitMapToBounds(bounds: MapState["view"]["bounds"]): void {
  if (!map) return;
  fitToBounds(map, bounds, { padding: 50, maxZoom: 17 });
}

/** Replace the drawn GeoJSON and frame the new view. */
async function updateMapState(mapState: MapState): Promise<void> {
  if (!map || !mapReady) {
    pendingData = mapState;
    return;
  }

  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }

  await syncCustomLayers(mapState);
  fitMapToBounds(mapState.view.bounds);
}

async function clearMap(): Promise<void> {
  if (activePopup) {
    activePopup.remove();
    activePopup = null;
  }
  clearPolygonLabelMarkers();
  if (customModule) await customModule.clear();
}

/**
 * Process incoming map data
 */
async function processMapData(mapState: MapState): Promise<void> {
  if (!mapReady) {
    pendingData = mapState;
    await initializeMap(mapState);
    return;
  }
  await updateMapState(mapState);
}

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

    const mapState = await appData.load<MapState>(r, agentResponse);
    if (!mapState?.sources) throw new Error("The map state has no sources");
    await processMapData(mapState);
    appData.drawn();
  } catch (error) {
    console.error("Error processing dynamic map data:", error);
    showErrorUI();
    appData.failed(error);
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
    await clearMap();
  }
  return {};
};

app.connect();

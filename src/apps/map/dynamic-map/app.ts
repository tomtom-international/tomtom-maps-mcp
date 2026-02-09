/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { TomTomMap } from "@tomtom-org/maps-sdk/map";
import { Popup } from "maplibre-gl";
import { createMapControls } from "../../shared/map-controls";
import { shouldShowUI, showMapUI, hideMapUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
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
  });

  // Wait for map to load
  return new Promise<void>((resolve) => {
    const onReady = () => {
      mapReady = true;
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
 * Setup click handlers for markers, routes, and polygons
 */
function setupInteractivity(mapState: CachedMapState): void {
  if (!map) return;

  const mlMap = map.mapLibreMap;

  // Make markers clickable (use the main marker layer)
  const markerLayerId = "marker-layer";
  if (mapState.sources.markers && mlMap.getLayer(markerLayerId)) {
    mlMap.on("click", markerLayerId, (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const coordinates = (feature.geometry as GeoJSON.Point).coordinates.slice() as [
          number,
          number,
        ];
        const props = (feature.properties as Record<string, unknown>) || {};

        const priority = props.priority as string;
        const priorityClass = priority ? `priority ${priority}` : "";

        new Popup()
          .setLngLat(coordinates)
          .setHTML(
            `
            <div class="marker-popup">
              <h3>${props.label || "Marker"}</h3>
              ${priority ? `<span class="${priorityClass}">${priority}</span>` : ""}
            </div>
          `
          )
          .addTo(mlMap);
      }
    });

    // Change cursor on hover
    mlMap.on("mouseenter", markerLayerId, () => {
      mlMap.getCanvas().style.cursor = "pointer";
    });
    mlMap.on("mouseleave", markerLayerId, () => {
      mlMap.getCanvas().style.cursor = "";
    });
  }

  // Make routes clickable
  const routeLayerId = "route-layer";
  if (mapState.sources.routes && mlMap.getLayer(routeLayerId)) {
    mlMap.on("click", routeLayerId, (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const props = (feature.properties as Record<string, unknown>) || {};

        let statsHtml = "";
        if (props.distance) {
          statsHtml += `<span class="stat">Distance: ${props.distance}</span>`;
        }
        if (props.travelTime) {
          statsHtml += `<span class="stat">Time: ${props.travelTime}</span>`;
        }
        if (props.trafficDelayInSeconds && Number(props.trafficDelayInSeconds) > 0) {
          statsHtml += `<span class="stat traffic-delay">+${props.trafficDelay} delay</span>`;
        }

        new Popup()
          .setLngLat(e.lngLat)
          .setHTML(
            `
            <div class="route-popup">
              <div class="route-name">${props.routeName || "Route"}</div>
              ${statsHtml ? `<div class="route-stats">${statsHtml}</div>` : ""}
            </div>
          `
          )
          .addTo(mlMap);
      }
    });

    mlMap.on("mouseenter", routeLayerId, () => {
      mlMap.getCanvas().style.cursor = "pointer";
    });
    mlMap.on("mouseleave", routeLayerId, () => {
      mlMap.getCanvas().style.cursor = "";
    });
  }

  // Make polygons clickable
  const polygonLayerId = "polygon-fill";
  if (mapState.sources.polygons && mlMap.getLayer(polygonLayerId)) {
    mlMap.on("click", polygonLayerId, (e) => {
      if (e.features && e.features.length > 0) {
        const feature = e.features[0];
        const props = (feature.properties as Record<string, unknown>) || {};

        new Popup()
          .setLngLat(e.lngLat)
          .setHTML(
            `
            <div class="polygon-popup">
              <h3>${props.label || props.name || "Area"}</h3>
            </div>
          `
          )
          .addTo(mlMap);
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
  addSourcesAndLayers(mapState);
  setupInteractivity(mapState);
  fitMapToBounds(mapState.view.bounds);
}

/**
 * Clear custom layers and sources from the map
 */
function clearMap(): void {
  if (!map) return;

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
  if (r.isError) return;

  try {
    // Find the text content with _meta
    const textContent = r.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return;

    const agentResponse = JSON.parse(textContent.text);

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

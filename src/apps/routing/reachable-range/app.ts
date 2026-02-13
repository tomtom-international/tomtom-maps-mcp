/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { bboxFromGeoJSON } from "@tomtom-org/maps-sdk/core";
import { TomTomMap, PlacesModule } from "@tomtom-org/maps-sdk/map";
import { createMapControls } from "../../shared/map-controls";
import { parseReachableRangeResponse } from "../../shared/sdk-parsers";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import "./styles.css";

// State tracking - map initialized lazily only when show_ui is true
let map: TomTomMap | null = null;
let placesModule: PlacesModule | null = null;
let isReady = false;
let pendingData: any = null;

const rangeSourceId = "range-source";
const rangeFillId = "range-fill";
const rangeLineId = "range-line";

// App instance created early so we can reference it
const app = new App({ name: "TomTom Reachable Range", version: "1.0.0" });

async function initializeMap() {
  if (map) return; // Already initialized

  // Ensure TomTom SDK is configured with API key from server
  await ensureTomTomConfigured(app);

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [4.8156, 52.4414], zoom: 8 },
  });

  placesModule = await PlacesModule.get(map, {
    text: { title: () => "Center" },
    theme: "pin",
  });

  // Add map controls for theme and traffic
  await createMapControls(map, {
    position: "top-right",
    showTrafficToggle: true,
    showThemeToggle: true,
  });

  // Handle map ready state
  return new Promise<void>((resolve) => {
    const setupLayers = () => {
      map!.mapLibreMap.addSource(rangeSourceId, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map!.mapLibreMap.addLayer({
        id: rangeFillId,
        type: "fill",
        source: rangeSourceId,
        paint: { "fill-color": "#4a90e2", "fill-opacity": 0.3 },
      });
      map!.mapLibreMap.addLayer({
        id: rangeLineId,
        type: "line",
        source: rangeSourceId,
        paint: { "line-color": "#4a90e2", "line-width": 2 },
      });

      isReady = true;
      if (pendingData) {
        processData(pendingData);
        pendingData = null;
      }
      resolve();
    };

    if (map!.mapLibreMap.loaded()) {
      setupLayers();
    } else {
      map!.mapLibreMap.on("load", setupLayers);
    }
  });
}

function processData(apiResponse: any) {
  if (!map) return;

  // Use SDK's built-in parser for correct format
  // parseReachableRangeResponse returns a single PolygonFeature, not a FeatureCollection
  const rangeFeature = parseReachableRangeResponse(apiResponse) as any;

  if (!rangeFeature) {
    clear();
    return;
  }

  const geometry = rangeFeature.geometry;

  // Handle polygon geometry from SDK parser
  if (geometry?.type === "Polygon") {
    const src = map.mapLibreMap.getSource(rangeSourceId) as any;
    if (src) src.setData(rangeFeature);

    // Show center marker if available in properties
    const center = rangeFeature.properties?.center;
    if (placesModule && center) {
      placesModule.show([
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [center.longitude, center.latitude] },
          properties: {},
        } as any,
      ]);
    }

    // Fit bounds using SDK utility
    const bbox = bboxFromGeoJSON(rangeFeature);
    if (bbox) {
      map.mapLibreMap.fitBounds(bbox as [number, number, number, number], {
        padding: 50,
      });
    }
  }
}

async function displayRange(apiResponse: any) {
  if (!isReady) {
    pendingData = apiResponse;
    return;
  }
  processData(apiResponse);
}

async function clear() {
  if (!map) return;
  const src = map.mapLibreMap.getSource(rangeSourceId) as any;
  if (src) src.setData({ type: "FeatureCollection", features: [] });
  if (placesModule) await placesModule.clear();
}

app.ontoolresult = async (r) => {
  if (r.isError) {
    showErrorUI();
    return;
  }
  try {
    if (r.content[0].type === "text") {
      const apiResponse = JSON.parse(r.content[0].text);
      if (!shouldShowUI(apiResponse)) {
        hideMapUI();
        return;
      }
      // Only initialize map when we actually need to show UI
      showMapUI();
      await initializeMap();
      // Fetch full data from cache using viz_id
      displayRange(await extractFullData(app, apiResponse));
    }
  } catch (e) {
    console.error(e);
  }
};

app.onteardown = async () => {
  await clear();
  return {};
};

app.connect();

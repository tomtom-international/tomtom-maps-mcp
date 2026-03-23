/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { bboxFromGeoJSON, type BBox, type Places, type Place } from "@tomtom-org/maps-sdk/core";
import { TomTomMap, PlacesModule } from "@tomtom-org/maps-sdk/map";
import { createMapControls } from "../../shared/map-controls";
import { setupPoiPopups, closePoiPopup } from "../../shared/poi-popup";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import "./styles.css";

// State tracking - map initialized lazily only when show_ui is true
let map: TomTomMap | null = null;
let placesModule: PlacesModule | null = null;
let isReady = false;
let pendingData: Places | null = null;

// App instance created early so we can reference it
const app = new App({ name: "TomTom Nearby Search", version: "1.0.0" });

async function initializeMap() {
  if (map) return; // Already initialized

  // Ensure TomTom SDK is configured with API key from server
  await ensureTomTomConfigured(app);

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [0, 20], zoom: 2 },
  });

  placesModule = await PlacesModule.get(map, {
    text: {
      title: (p: Place) =>
        (
          p.properties as Record<string, unknown> & {
            poi?: { name?: string };
            address?: { freeformAddress?: string };
          }
        ).poi?.name ||
        p.properties.address?.freeformAddress ||
        "Unknown",
    },
    theme: "pin",
  });

  // Setup click handlers for POI popups
  setupPoiPopups(map, placesModule);

  // Add map controls for theme and traffic
  await createMapControls(map, {
    position: "top-right",
    showTrafficToggle: true,
    showThemeToggle: true,
  });

  // Handle map ready state
  return new Promise<void>((resolve) => {
    const onReady = () => {
      isReady = true;
      if (pendingData) {
        processData(pendingData);
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

function processData(sdkResponse: Places) {
  if (!placesModule || !map) return;

  // SDK response is already GeoJSON FeatureCollection — no parsing needed
  if (!sdkResponse.features?.length) {
    placesModule.clear();
    return;
  }

  placesModule.show(sdkResponse.features);

  const bbox = bboxFromGeoJSON(sdkResponse);
  if (bbox) {
    map.mapLibreMap.fitBounds(bbox as BBox, {
      padding: 50,
      maxZoom: 15,
    });
  }
}

async function displayResults(apiResponse: Places) {
  if (!isReady || !placesModule) {
    pendingData = apiResponse;
    return;
  }
  processData(apiResponse);
}

app.ontoolresult = async (r) => {
  if (r.isError) {
    showErrorUI();
    return;
  }
  try {
    if (r.content[0].type !== "text") return;
    const agentResponse = JSON.parse(r.content[0].text) as unknown;
    if (!shouldShowUI(agentResponse)) {
      hideMapUI();
      return;
    }
    // Only initialize map when we actually need to show UI
    showMapUI();
    await initializeMap();
    displayResults((await extractFullData(app, agentResponse)) as Places);
  } catch (e) {
    console.error(e);
  }
};

app.onteardown = async () => {
  closePoiPopup();
  if (placesModule) await placesModule.clear();
  return {};
};

app.connect();

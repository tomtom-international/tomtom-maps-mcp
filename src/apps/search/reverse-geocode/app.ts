/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { type Place } from "@tomtom-org/maps-sdk/core";
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
let pendingData: Place | null = null;

// App instance created early so we can reference it
const app = new App({ name: "TomTom Reverse Geocode", version: "1.0.0" });

async function initializeMap() {
  if (map) return; // Already initialized

  // Ensure TomTom SDK is configured with API key from server
  await ensureTomTomConfigured(app);

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [0, 20], zoom: 2 },
  });

  placesModule = await PlacesModule.get(map, {
    text: { title: (p: Place) => p.properties.address?.freeformAddress || "Unknown" },
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

function processData(sdkResponse: Place) {
  if (!placesModule || !map) return;

  // SDK reverseGeocode returns a single Place (GeoJSON Feature) — no parsing needed.
  if (!sdkResponse?.geometry) {
    placesModule.clear();
    return;
  }

  placesModule.show([sdkResponse]);

  // Fly to the single point (fitBounds is not meaningful for one point)
  const coords = sdkResponse.geometry.coordinates;
  if (coords) {
    map.mapLibreMap.flyTo({ center: coords as [number, number], zoom: 15 });
  }
}

async function displayResults(apiResponse: Place) {
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
    displayResults((await extractFullData(app, agentResponse)) as Place);
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

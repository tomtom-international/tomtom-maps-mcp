/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { TomTomConfig, bboxFromGeoJSON } from "@tomtom-org/maps-sdk/core";
import { TomTomMap, PlacesModule } from "@tomtom-org/maps-sdk/map";
import { createMapControls } from "../../shared/map-controls";
import { setupPoiPopups, closePoiPopup } from "../../shared/poi-popup";
import { parseSearchResponse } from "../../shared/sdk-parsers";
import { shouldShowUI, showMapUI, hideMapUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { API_KEY } from "../../shared/config";
import "./styles.css";

TomTomConfig.instance.put({ apiKey: API_KEY, language: "en-GB" });

// State tracking - map initialized lazily only when show_ui is true
let map: TomTomMap | null = null;
let placesModule: PlacesModule | null = null;
let isReady = false;
let pendingData: any = null;

async function initializeMap() {
  if (map) return; // Already initialized

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [4.8156, 52.4414], zoom: 8 },
  });

  placesModule = await PlacesModule.get(map, {
    text: {
      title: (p: any) =>
        p.properties.poi?.name || p.properties.address?.freeformAddress || "Unknown",
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

function processData(apiResponse: any) {
  if (!placesModule || !map) return;

  // Use SDK's built-in parser for correct format
  const searchResult = parseSearchResponse(apiResponse);

  if (!searchResult.features?.length) {
    placesModule.clear();
    return;
  }

  placesModule.show(searchResult.features as any);

  // Fit bounds using SDK utility
  const bbox = bboxFromGeoJSON(searchResult);
  if (bbox) {
    map.mapLibreMap.fitBounds(bbox as [number, number, number, number], {
      padding: 50,
      maxZoom: 15,
    });
  }
}

async function displayResults(apiResponse: any) {
  if (!isReady || !placesModule) {
    pendingData = apiResponse;
    return;
  }
  processData(apiResponse);
}

const app = new App({ name: "TomTom Nearby Search", version: "1.0.0" });

app.ontoolresult = async (r) => {
  if (r.isError) return;
  try {
    if (r.content[0].type !== "text") return;
    const agentResponse = JSON.parse(r.content[0].text);
    if (!shouldShowUI(agentResponse)) {
      hideMapUI();
      return;
    }
    // Only initialize map when we actually need to show UI
    showMapUI();
    await initializeMap();
    displayResults(extractFullData(agentResponse));
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

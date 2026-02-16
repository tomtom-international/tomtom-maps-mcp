/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 *
 * EV Charging Station Search App
 * Displays EV charging stations on an interactive map with availability indicators.
 * Data comes from SDK (already in GeoJSON format) — no parseSearchResponse() needed.
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { bboxFromGeoJSON } from "@tomtom-org/maps-sdk/core";
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
let pendingData: any = null;

const app = new App({ name: "TomTom EV Charging Search", version: "1.0.0" });

async function initializeMap() {
  if (map) return;

  await ensureTomTomConfigured(app);

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [0, 20], zoom: 2 },
  });

  placesModule = await PlacesModule.get(map, {
    text: {
      title: (place: any) =>
        place.properties.poi?.name || place.properties.address?.freeformAddress || "EV Station",
    },
    theme: "pin",
  });

  // Setup click handlers for POI popups
  setupPoiPopups(map, placesModule);

  await createMapControls(map, {
    position: "top-right",
    showTrafficToggle: false,
    showThemeToggle: true,
  });

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

function processData(sdkResponse: any) {
  if (!placesModule || !map) return;

  // SDK response is already GeoJSON — pass features directly to PlacesModule
  // No parseSearchResponse() needed (unlike raw API-based tools)
  if (!sdkResponse.features?.length) {
    placesModule.clear();
    return;
  }

  placesModule.show(sdkResponse.features as any);

  const bbox = bboxFromGeoJSON(sdkResponse);
  if (bbox) {
    map.mapLibreMap.fitBounds(bbox as [number, number, number, number], {
      padding: 50,
      maxZoom: 15,
    });
  }
}

async function displayStations(sdkResponse: any) {
  if (!isReady || !placesModule) {
    pendingData = sdkResponse;
    return;
  }
  processData(sdkResponse);
}

app.ontoolresult = async (r) => {
  if (r.isError) {
    showErrorUI();
    return;
  }
  try {
    if (r.content[0].type !== "text") return;
    const agentResponse = JSON.parse(r.content[0].text);
    if (!shouldShowUI(agentResponse)) {
      hideMapUI();
      return;
    }
    showMapUI();
    await initializeMap();
    displayStations(await extractFullData(app, agentResponse));
  } catch (e) {
    console.error("Error displaying EV stations:", e);
  }
};

app.onteardown = async () => {
  closePoiPopup();
  if (placesModule) await placesModule.clear();
  return {};
};

app.connect();

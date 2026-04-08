/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 *
 * Area/Geometry Search App
 * Displays POIs found within a geographic area (circle, polygon, bounding box).
 * Data comes from SDK (already in GeoJSON format) — no parseSearchResponse() needed.
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { bboxFromGeoJSON, type BBox, type Places } from "@tomtom-org/maps-sdk/core";
import { TomTomMap, PlacesModule, GeometriesModule } from "@tomtom-org/maps-sdk/map";
import type { PolygonFeatures } from "@tomtom-org/maps-sdk/core";
import type { Feature, Polygon } from "geojson";
import { createMapControls } from "../../shared/map-controls";
import { setupPoiPopups, closePoiPopup } from "../../shared/poi-popup";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import "./styles.css";

let map: TomTomMap | null = null;
let placesModule: PlacesModule | null = null;
let geometriesModule: GeometriesModule | null = null;
let isReady = false;
let pendingData: (Places & { _searchBoundary?: Feature<Polygon> }) | null = null;

const app = new App({ name: "TomTom Area Search", version: "1.0.0" });

async function initializeMap() {
  if (map) return;

  await ensureTomTomConfigured(app);

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [0, 20], zoom: 2 },
  });

  placesModule = await PlacesModule.get(map, { theme: "pin" });

  geometriesModule = await GeometriesModule.get(map, {
    theme: "outline",
    colorConfig: { fillColor: "#007bff", fillOpacity: 0.08 },
    lineConfig: { lineColor: "#007bff", lineWidth: 2 },
  });

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

function processData(sdkResponse: Places & { _searchBoundary?: Feature<Polygon> }) {
  if (!placesModule || !map) return;

  // Display search boundary via GeometriesModule
  if (sdkResponse._searchBoundary && geometriesModule) {
    const boundaryCollection = {
      type: "FeatureCollection" as const,
      features: [sdkResponse._searchBoundary],
    };
    geometriesModule.show(boundaryCollection as PolygonFeatures);
  }

  // SDK response is already GeoJSON — pass features directly
  if (!sdkResponse.features?.length) {
    placesModule.clear();
    return;
  }

  placesModule.show(sdkResponse.features);

  // Fit bounds to include both POIs and boundary
  const allFeatures = [
    ...sdkResponse.features,
    ...(sdkResponse._searchBoundary ? [sdkResponse._searchBoundary] : []),
  ];
  const bbox = bboxFromGeoJSON({ type: "FeatureCollection" as const, features: allFeatures });
  if (bbox) {
    map.mapLibreMap.fitBounds(bbox as BBox, {
      padding: 50,
      maxZoom: 15,
    });
  }
}

async function displayResults(sdkResponse: Places & { _searchBoundary?: Feature<Polygon> }) {
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
    const agentResponse = JSON.parse(r.content[0].text) as unknown;
    if (!shouldShowUI(agentResponse)) {
      hideMapUI();
      return;
    }
    showMapUI();
    await initializeMap();
    displayResults(
      (await extractFullData(app, agentResponse)) as Places & { _searchBoundary?: Feature<Polygon> }
    );
  } catch (e) {
    console.error("Error displaying area search:", e);
  }
};

app.onteardown = async () => {
  closePoiPopup();
  if (placesModule) await placesModule.clear();
  if (geometriesModule) await geometriesModule.clear();
  return {};
};

app.connect();

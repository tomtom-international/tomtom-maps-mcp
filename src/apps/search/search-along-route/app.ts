/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 *
 * Search Along Route App
 * Displays both a route and POIs found along its corridor.
 * Data comes from SDK (route + POIs both in GeoJSON format).
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { bboxFromGeoJSON, type BBox, type Routes, type Places } from "@tomtom-org/maps-sdk/core";
import { TomTomMap, RoutingModule, PlacesModule } from "@tomtom-org/maps-sdk/map";
import { createMapControls } from "../../shared/map-controls";
import { setupPoiPopups, closePoiPopup } from "../../shared/poi-popup";
import { extractWaypointPositionsFromRoutes } from "../../shared/sdk-parsers";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import "./styles.css";

let map: TomTomMap | null = null;
let routingModule: RoutingModule | null = null;
let placesModule: PlacesModule | null = null;
let isReady = false;
let pendingData: { route: Routes; pois: Places } | null = null;

const app = new App({ name: "TomTom Search Along Route", version: "1.0.0" });

async function initializeMap() {
  if (map) return;

  await ensureTomTomConfigured(app);

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [0, 20], zoom: 2 },
  });

  routingModule = await RoutingModule.get(map);

  placesModule = await PlacesModule.get(map, { theme: "pin" });

  setupPoiPopups(map, placesModule);

  await createMapControls(map, {
    position: "top-right",
    showTrafficToggle: true,
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

function processData(data: { route: Routes; pois: Places }) {
  if (!routingModule || !placesModule || !map) return;

  // Display route (SDK GeoJSON format — no parsing needed)
  if (data.route?.features?.length) {
    const waypoints = extractWaypointPositionsFromRoutes(data.route);
    routingModule.showRoutes(data.route);
    routingModule.showWaypoints(waypoints);
  }

  // Display POIs along route (SDK GeoJSON format — no parsing needed)
  if (data.pois?.features?.length) {
    placesModule.show(data.pois.features);
  }

  // Fit map to show both route and POIs
  const allFeatures = [...(data.route?.features || []), ...(data.pois?.features || [])];

  if (allFeatures.length) {
    const combined = { type: "FeatureCollection" as const, features: allFeatures };
    const bbox = bboxFromGeoJSON(combined);
    if (bbox) {
      map.mapLibreMap.fitBounds(bbox as BBox, {
        padding: 80,
        maxZoom: 15,
      });
    }
  }
}

async function displayResults(data: { route: Routes; pois: Places }) {
  if (!isReady || !routingModule || !placesModule) {
    pendingData = data;
    return;
  }
  processData(data);
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
    displayResults((await extractFullData(app, agentResponse)) as { route: Routes; pois: Places });
  } catch (e) {
    console.error("Error displaying search along route:", e);
  }
};

app.onteardown = async () => {
  closePoiPopup();
  if (routingModule) {
    await routingModule.clearRoutes();
    await routingModule.clearWaypoints();
  }
  if (placesModule) await placesModule.clear();
  return {};
};

app.connect();

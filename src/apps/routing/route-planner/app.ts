/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { bboxFromGeoJSON, type BBox, type Routes } from "@tomtom-org/maps-sdk/core";
import { TomTomMap, RoutingModule } from "@tomtom-org/maps-sdk/map";
import { createMapControls } from "../../shared/map-controls";
import { extractWaypointsFromRoutes } from "../../shared/sdk-parsers";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import "./styles.css";

// State tracking - map initialized lazily only when show_ui is true
let map: TomTomMap | null = null;
let routingModule: RoutingModule | null = null;
let mapReady = false;
let pendingData: Routes | null = null;

// App instance created early so we can reference it
const app = new App({ name: "TomTom Route Planner", version: "1.0.0" });

async function initializeMap() {
  if (map) return; // Already initialized

  // Ensure TomTom SDK is configured with API key from server
  await ensureTomTomConfigured(app);

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [0, 20], zoom: 2 },
  });

  routingModule = await RoutingModule.get(map);

  // Add map controls for theme and traffic
  await createMapControls(map, {
    position: "top-right",
    showTrafficToggle: true,
    showThemeToggle: true,
  });

  // Handle map ready state
  return new Promise<void>((resolve) => {
    const onReady = () => {
      mapReady = true;
      if (pendingData) {
        processRouteData(pendingData);
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

function processRouteData(routes: Routes) {
  if (!routingModule || !map) return;

  // Routes is already in SDK GeoJSON format — no parsing needed
  if (!routes.features?.length) {
    clear();
    return;
  }

  // Extract waypoints from parsed routes
  const waypoints = extractWaypointsFromRoutes(routes);

  // Show route and waypoints
  routingModule.showRoutes(routes);
  routingModule.showWaypoints(waypoints);

  // Fit map to route bounds using SDK utility
  const bbox = bboxFromGeoJSON(routes);
  if (bbox) {
    map.mapLibreMap.fitBounds(bbox as BBox, {
      padding: 80,
      maxZoom: 15,
    });
  }
}

async function clear() {
  if (!routingModule) return;
  await routingModule.clearRoutes();
  await routingModule.clearWaypoints();
}

async function displayRoute(data: Routes) {
  if (!mapReady || !routingModule) {
    pendingData = data;
    return;
  }
  processRouteData(data);
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
    displayRoute((await extractFullData(app, agentResponse)) as Routes);
  } catch (e) {
    console.error("Error parsing route data:", e);
  }
};

app.onteardown = async () => {
  await clear();
  return {};
};

app.connect();

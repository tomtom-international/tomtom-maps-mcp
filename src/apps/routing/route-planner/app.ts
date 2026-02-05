/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { TomTomConfig, bboxFromGeoJSON } from "@tomtom-org/maps-sdk/core";
import { TomTomMap, RoutingModule } from "@tomtom-org/maps-sdk/map";
import { createMapControls } from "../../shared/map-controls";
import { parseRoutingResponse, extractWaypointsFromRoutes } from "../../shared/sdk-parsers";
import { shouldShowUI, showMapUI, hideMapUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { API_KEY } from "../../shared/config";
import "./styles.css";

TomTomConfig.instance.put({ apiKey: API_KEY, language: "en-GB" });

// State tracking - map initialized lazily only when show_ui is true
let map: TomTomMap | null = null;
let routingModule: RoutingModule | null = null;
let mapReady = false;
let pendingData: any = null;

async function initializeMap() {
  if (map) return; // Already initialized

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [-0.5, 51.5], zoom: 8 },
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

function processRouteData(apiResponse: any) {
  if (!routingModule || !map) return;

  // Use SDK's built-in parser for correct format
  const routes = parseRoutingResponse(apiResponse, {
    language: "en-GB",
    units: "metric",
  });

  if (!routes.features?.length) {
    clear();
    return;
  }

  // Extract waypoints from parsed routes
  const waypoints = extractWaypointsFromRoutes(routes);

  // Show route and waypoints
  routingModule.showRoutes(routes);
  routingModule.showWaypoints(waypoints as any);

  // Fit map to route bounds using SDK utility
  const bbox = bboxFromGeoJSON(routes);
  if (bbox) {
    map.mapLibreMap.fitBounds(bbox as [number, number, number, number], {
      padding: 80,
      maxZoom: 15,
    });
  }
}

async function clear() {
  if (routingModule) {
    await routingModule.clearRoutes();
    await routingModule.clearWaypoints();
  }
}

async function displayRoute(data: any) {
  if (!mapReady || !routingModule) {
    pendingData = data;
    return;
  }
  processRouteData(data);
}

const app = new App({ name: "TomTom Route Planner", version: "1.0.0" });

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
    displayRoute(extractFullData(agentResponse));
  } catch (e) {
    console.error("Error parsing route data:", e);
  }
};

app.onteardown = async () => {
  await clear();
  return {};
};

app.connect();

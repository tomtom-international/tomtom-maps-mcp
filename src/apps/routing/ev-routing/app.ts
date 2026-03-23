/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 *
 * EV Routing App
 * Displays EV routes with charging stops on an interactive map.
 * RoutingModule.showRoutes() natively extracts and renders charging stops
 * from leg sections — no custom layers or processing required.
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { bboxFromGeoJSON, type BBox, type Routes, type Waypoints } from "@tomtom-org/maps-sdk/core";
import { TomTomMap, RoutingModule } from "@tomtom-org/maps-sdk/map";
import { createMapControls } from "../../shared/map-controls";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import "./styles.css";

let map: TomTomMap | null = null;
let routingModule: RoutingModule | null = null;
let mapReady = false;
let pendingData: Routes | null = null;

const app = new App({ name: "TomTom EV Route Planner", version: "1.0.0" });

async function initializeMap() {
  if (map) return;

  await ensureTomTomConfigured(app);

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [0, 20], zoom: 2 },
  });

  routingModule = await RoutingModule.get(map);

  await createMapControls(map, {
    position: "top-right",
    showTrafficToggle: true,
    showThemeToggle: true,
  });

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

/**
 * Extract start/end waypoints from route coordinates for RoutingModule pins.
 */
function extractStartEndWaypoints(routes: Routes): Waypoints {
  if (!routes.features?.length) {
    return { type: "FeatureCollection" as const, features: [] } as Waypoints;
  }

  const coordinates = routes.features[0].geometry.coordinates as [number, number][];
  if (coordinates.length < 2) {
    return { type: "FeatureCollection" as const, features: [] } as Waypoints;
  }

  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: coordinates[0] },
        properties: {
          type: "Geography",
          address: { freeformAddress: "Start" },
          index: 0,
          indexType: "start",
        },
      },
      {
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: coordinates[coordinates.length - 1] },
        properties: {
          type: "Geography",
          address: { freeformAddress: "End" },
          index: 1,
          indexType: "finish",
        },
      },
    ],
  } as Waypoints;
}

function processRouteData(routes: Routes) {
  if (!routingModule || !map) return;

  if (!routes.features?.length) {
    clear();
    return;
  }

  // showRoutes automatically extracts and renders charging stops from leg sections
  routingModule.showRoutes(routes);

  // Show start/end waypoint pins
  const waypoints = extractStartEndWaypoints(routes);
  routingModule.showWaypoints(waypoints);

  const bbox = bboxFromGeoJSON(routes);
  if (bbox) {
    map.mapLibreMap.fitBounds(bbox as BBox, { padding: 80, maxZoom: 15 });
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
    showMapUI();
    await initializeMap();
    displayRoute((await extractFullData(app, agentResponse)) as Routes);
  } catch (e) {
    console.error("Error displaying EV route:", e);
  }
};

app.onteardown = async () => {
  await clear();
  return {};
};

app.connect();

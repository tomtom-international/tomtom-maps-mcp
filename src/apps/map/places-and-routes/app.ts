/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 *
 * Places and Routes App
 * One app for every tool that shows places, routes or a search area: the
 * search tools, search along route and routing. A host reads each app's HTML
 * while connecting, one after another, so sharing one app saves a read per tool.
 * What to draw comes from the shape of the result, not from the tool's name,
 * which a host need not pass.
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { bboxFromGeoJSON, type BBox, type PolygonFeatures } from "@tomtom-org/maps-sdk/core";
import { TomTomMap, PlacesModule, RoutingModule, GeometriesModule } from "@tomtom-org/maps-sdk/map";
import { createMapControls } from "../../shared/map-controls";
import { setupPoiPopups, closePoiPopup } from "../../shared/poi-popup";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { extractWaypointPositionsFromRoutes } from "../../shared/sdk-parsers";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import { type MapContent, type ToolData, toMapContent } from "./mapContent";
import "./styles.css";

// State tracking - map initialized lazily only when show_ui is true
let map: TomTomMap | null = null;
let placesModule: PlacesModule | null = null;
let routingModule: RoutingModule | null = null;
let geometriesModule: GeometriesModule | null = null;
let isReady = false;
let pendingContent: MapContent | null = null;

const app = new App({ name: "TomTom Maps", version: "1.0.0" });

/**
 * Creates the map, and the modules the first result needs while its style
 * loads, as the separate apps did, rather than after.
 */
async function initializeMap(firstContent: Promise<MapContent>) {
  if (map) return;

  await ensureTomTomConfigured(app);

  const tomtomMap = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [0, 20], zoom: 2 },
  });
  map = tomtomMap;
  // Listened for before anything is awaited, so the event cannot pass unseen.
  const loaded = new Promise<void>((resolve) =>
    tomtomMap.mapLibreMap.once("load", () => resolve())
  );

  await ensureModules(tomtomMap, await firstContent);

  await createMapControls(tomtomMap, {
    position: "top-right",
    showTrafficToggle: true,
    showThemeToggle: true,
  });

  await loaded;
  isReady = true;
  if (pendingContent) {
    await render(pendingContent);
    pendingContent = null;
  }
}

/**
 * Creates the modules a result needs, and only those: each one costs time
 * before the map shows anything. Created in the order the separate apps used,
 * routing before places (search along route) and places before the boundary
 * (area search).
 */
async function ensureModules(map: TomTomMap, { places, routes, boundary }: MapContent) {
  if (routes?.features?.length && !routingModule) {
    routingModule = await RoutingModule.create(map);
  }
  if (places.length && !placesModule) {
    placesModule = await PlacesModule.create(map, { markerType: "pin" });
    setupPoiPopups(map, placesModule);
  }
  if (boundary && !geometriesModule) {
    geometriesModule = await GeometriesModule.create(map, {
      fill: { style: "outline", color: "#007bff", opacity: 0.08 },
      line: { color: "#007bff", width: 2 },
    });
  }
}

/** Replaces whatever a previous result drew. */
async function render(content: MapContent) {
  if (!map) return;
  await ensureModules(map, content);
  const { places, routes, boundary, single } = content;

  if (routes?.features?.length) {
    routingModule?.showRoutes(routes);
    routingModule?.showWaypoints(extractWaypointPositionsFromRoutes(routes));
  } else {
    routingModule?.clearRoutes();
    routingModule?.clearWaypoints();
  }

  if (places.length) placesModule?.show(places);
  else placesModule?.clear();

  if (boundary) {
    geometriesModule?.show({ type: "FeatureCollection", features: [boundary] } as PolygonFeatures);
  } else {
    geometriesModule?.clear();
  }

  const position = single ? places[0]?.geometry.coordinates : undefined;
  if (position) {
    map.mapLibreMap.flyTo({ center: position as [number, number], zoom: 15 });
    return;
  }

  const features = [...(routes?.features ?? []), ...places, ...(boundary ? [boundary] : [])];
  if (!features.length) return;
  const bbox = bboxFromGeoJSON({ type: "FeatureCollection" as const, features });
  if (bbox) {
    map.mapLibreMap.fitBounds(bbox as BBox, {
      padding: routes?.features?.length ? 80 : 50,
      maxZoom: 15,
    });
  }
}

async function display(content: MapContent) {
  if (!isReady) {
    pendingContent = content;
    return;
  }
  await render(content);
}

app.ontoolresult = async (r) => {
  if (r.isError) {
    showErrorUI();
    return;
  }
  try {
    if (r.content[0].type !== "text") return;
    const agentResponse = JSON.parse(r.content[0].text) as unknown;
    // POI categories always ends here: its result has nothing to map.
    if (!shouldShowUI(agentResponse)) {
      hideMapUI();
      return;
    }
    showMapUI();
    // Fetched while the map is created, which needs it only to pick its modules.
    const content = extractFullData<ToolData>(app, agentResponse).then(toMapContent);
    await initializeMap(content);
    await display(await content);
  } catch (e) {
    console.error("Error displaying results:", e);
  }
};

app.onteardown = async () => {
  closePoiPopup();
  if (routingModule) {
    await routingModule.clearRoutes();
    await routingModule.clearWaypoints();
  }
  if (placesModule) await placesModule.clear();
  if (geometriesModule) await geometriesModule.clear();
  return {};
};

app.connect();

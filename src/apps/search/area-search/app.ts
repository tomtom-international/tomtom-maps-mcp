/*
 * Copyright (C) 2025 TomTom Navigation B.V.
 * Licensed under the Apache License, Version 2.0
 *
 * Area/Geometry Search App
 * Displays POIs found within a geographic area (circle, polygon, bounding box).
 * Data comes from SDK (already in GeoJSON format) — no parseSearchResponse() needed.
 */

import { App } from "@modelcontextprotocol/ext-apps";
import { bboxFromGeoJSON, type BBox, type Places, type Place } from "@tomtom-org/maps-sdk/core";
import { TomTomMap, PlacesModule } from "@tomtom-org/maps-sdk/map";
import type { Feature, Polygon } from "geojson";
import { createMapControls } from "../../shared/map-controls";
import { setupPoiPopups, closePoiPopup } from "../../shared/poi-popup";
import { shouldShowUI, showMapUI, hideMapUI, showErrorUI } from "../../shared/ui-visibility";
import { extractFullData } from "../../shared/decompress";
import { ensureTomTomConfigured } from "../../shared/sdk-config";
import "./styles.css";

let map: TomTomMap | null = null;
let placesModule: PlacesModule | null = null;
let isReady = false;
let pendingData: (Places & { _searchBoundary?: Feature<Polygon> }) | null = null;

const app = new App({ name: "TomTom Area Search", version: "1.0.0" });

async function initializeMap() {
  if (map) return;

  await ensureTomTomConfigured(app);

  map = new TomTomMap({
    mapLibre: { container: "sdk-map", center: [0, 20], zoom: 2 },
  });

  placesModule = await PlacesModule.get(map, {
    text: {
      title: (place: Place) =>
        (
          place.properties as Record<string, unknown> & {
            poi?: { name?: string };
            address?: { freeformAddress?: string };
          }
        ).poi?.name ||
        place.properties.address?.freeformAddress ||
        "Unknown",
    },
    theme: "pin",
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

/**
 * Draw the search boundary (polygon/circle/bbox) on the map.
 */
function drawSearchBoundary(boundary: Feature<Polygon>) {
  if (!map || !boundary?.geometry) return;

  const mlMap = map.mapLibreMap;
  const sourceId = "search-boundary";

  // Remove previous boundary layers/source if they exist
  if (mlMap.getLayer("search-boundary-fill")) mlMap.removeLayer("search-boundary-fill");
  if (mlMap.getLayer("search-boundary-line")) mlMap.removeLayer("search-boundary-line");
  if (mlMap.getSource(sourceId)) mlMap.removeSource(sourceId);

  mlMap.addSource(sourceId, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [boundary],
    },
  });

  mlMap.addLayer({
    id: "search-boundary-fill",
    type: "fill",
    source: sourceId,
    paint: {
      "fill-color": "#007bff",
      "fill-opacity": 0.08,
    },
  });

  mlMap.addLayer({
    id: "search-boundary-line",
    type: "line",
    source: sourceId,
    paint: {
      "line-color": "#007bff",
      "line-width": 2,
    },
  });
}

function processData(sdkResponse: Places & { _searchBoundary?: Feature<Polygon> }) {
  if (!placesModule || !map) return;

  // Draw search boundary if present
  if (sdkResponse._searchBoundary) {
    drawSearchBoundary(sdkResponse._searchBoundary);
  }

  // SDK response is already GeoJSON — pass features directly
  if (!sdkResponse.features?.length) {
    placesModule.clear();
    return;
  }

  placesModule.show(sdkResponse.features);

  // Fit bounds to include both POIs and boundary
  const bbox = bboxFromGeoJSON(sdkResponse);
  if (bbox) {
    // If we have a boundary, expand bbox to include it
    if (sdkResponse._searchBoundary?.geometry?.coordinates?.[0]) {
      const boundaryCoords = sdkResponse._searchBoundary.geometry.coordinates[0];
      for (const coord of boundaryCoords) {
        bbox[0] = Math.min(bbox[0], coord[0]); // west
        bbox[1] = Math.min(bbox[1], coord[1]); // south
        bbox[2] = Math.max(bbox[2], coord[0]); // east
        bbox[3] = Math.max(bbox[3], coord[1]); // north
      }
    }
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
  if (map) {
    const mlMap = map.mapLibreMap;
    if (mlMap.getLayer("search-boundary-fill")) mlMap.removeLayer("search-boundary-fill");
    if (mlMap.getLayer("search-boundary-line")) mlMap.removeLayer("search-boundary-line");
    if (mlMap.getSource("search-boundary")) mlMap.removeSource("search-boundary");
  }
  return {};
};

app.connect();
